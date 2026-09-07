import { InlineKeyboard, InputFile, type Composer } from "grammy";
import type { Group, Scene } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { escapeHtml, mentionHtml, slugify, topicDeepLink } from "../lib/format";
import { safeCall, safePinMessage } from "../lib/telegram";
import { getOrCreateGroup, getSceneForCurrentTopic, currentThreadId } from "../lib/scope";
import { replyEphemeral, trackIncoming } from "../lib/ephemeral";
import { isGroupAdmin } from "../lib/adminCheck";
import { requireGroupAdmin, requireGroupAdminCallback } from "../bot/guards";
import { setFlow, clearFlow } from "../bot/flow";
import type { Flow } from "../bot/sessionTypes";
import type { MyContext } from "../bot/context";
import { parseCastShorthand, looksLikeCastShorthand } from "../lib/castParser";
import { paginate } from "../lib/pagination";

const MEMBERS_PAGE_SIZE = 6;

async function renderSceneCard(scene: Scene): Promise<string> {
  const lines = [`<b>🎬 ${escapeHtml(scene.title)}</b>`];
  lines.push(scene.description ? escapeHtml(scene.description) : "<i>No description yet.</i>");

  const casts = await prisma.sceneCast.findMany({ where: { sceneId: scene.id }, include: { character: true } });
  if (casts.length > 0) {
    lines.push("", "<b>Cast:</b>");
    for (const c of casts) lines.push(`• ${escapeHtml(c.character.name)}`);
  }

  lines.push("", `Status: <b>${scene.status}</b>`);
  return lines.join("\n");
}

function sceneCardKeyboard(scene: Scene): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (scene.status === "CLOSED") {
    kb.text("📄 Export transcript", "scene:export");
    return kb;
  }

  kb.text("📝 Set description", "scene:setdesc").text("🖼 Set banner", "scene:setbanner").row();
  kb.text("🎭 Assign cast", "scene:assigncast").row();

  if (scene.status === "CASTING") {
    kb.text("▶️ Start scene", "scene:start").row();
  } else {
    kb.text("🔀 Switch character", "role:switch").row();
    kb.text("🖼 Add scene photo", "scene:addpic").row();
  }

  kb.text("🛑 Close scene", "scene:close");
  return kb;
}

/**
 * Posts (once) or edits (thereafter) the single evolving "scene control
 * message" — it doubles as the CASTING-phase setup card and, once the scene
 * opens, the pinned "Switch character" control surface, per Scene.controlMessageId.
 */
async function refreshSceneCard(ctx: MyContext, chatId: number, threadId: number, scene: Scene): Promise<void> {
  const text = await renderSceneCard(scene);
  const keyboard = sceneCardKeyboard(scene);

  if (!scene.controlMessageId) {
    const sent = await safeCall("send scene card", () =>
      ctx.api.sendMessage(chatId, text, { message_thread_id: threadId, parse_mode: "HTML", reply_markup: keyboard })
    );
    if (sent) {
      await prisma.scene.update({ where: { id: scene.id }, data: { controlMessageId: sent.message_id } });
      await safePinMessage(ctx.api, chatId, sent.message_id);
    }
    return;
  }

  await safeCall("edit scene card", () =>
    ctx.api.editMessageText(chatId, scene.controlMessageId!, text, { parse_mode: "HTML", reply_markup: keyboard })
  );
}

const SCENE_STATUS_ORDER = { OPEN: 0, CASTING: 1, CLOSED: 2 } as const;
const SCENE_STATUS_ICON = { OPEN: "🎬", CASTING: "🎭", CLOSED: "🔒" } as const;

/**
 * Posts (once) or edits (thereafter) a single pinned message in the Casting
 * topic listing every scene, with buttons that deep-link straight to each
 * one's topic — Telegram has no folder/nesting for forum topics, so this is
 * the closest thing to "grouping" scenes together. See README "Design
 * decisions". Silently does nothing if /setup hasn't created Casting yet.
 */
async function refreshSceneIndex(ctx: MyContext, groupId: string): Promise<void> {
  const chat = ctx.chat;
  if (!chat) return;

  const [castingTopic, scenes, group] = await Promise.all([
    prisma.topic.findFirst({ where: { groupId, type: "CASTING" } }),
    prisma.scene.findMany({ where: { groupId }, include: { topic: true }, orderBy: [{ createdAt: "desc" }] }),
    prisma.group.findUnique({ where: { id: groupId } }),
  ]);
  if (!castingTopic || !group) return;

  scenes.sort((a, b) => SCENE_STATUS_ORDER[a.status] - SCENE_STATUS_ORDER[b.status]);

  const text =
    scenes.length === 0
      ? "<b>📚 Scenes</b>\n\nNo scenes yet. Create one with /scene."
      : `<b>📚 Scenes</b> (${scenes.length})\n\nTap a scene to jump straight to its topic.`;

  const kb = new InlineKeyboard();
  for (const s of scenes) {
    kb.url(`${SCENE_STATUS_ICON[s.status]} ${s.title}`, topicDeepLink(chat.id, s.topic.telegramTopicId)).row();
  }

  if (!group.sceneIndexMessageId) {
    const sent = await safeCall("send scene index", () =>
      ctx.api.sendMessage(chat.id, text, {
        message_thread_id: castingTopic.telegramTopicId,
        parse_mode: "HTML",
        reply_markup: kb,
      })
    );
    if (sent) {
      await prisma.group.update({ where: { id: groupId }, data: { sceneIndexMessageId: sent.message_id } });
      await safePinMessage(ctx.api, chat.id, sent.message_id);
    }
    return;
  }

  await safeCall("edit scene index", () =>
    ctx.api.editMessageText(chat.id, group.sceneIndexMessageId!, text, { parse_mode: "HTML", reply_markup: kb })
  );
}

async function createScene(ctx: MyContext, group: Group, title: string, description: string | null): Promise<void> {
  const chat = ctx.chat;
  if (!chat || !ctx.from) return;

  const forumTopic = await safeCall("createForumTopic(scene)", () => ctx.api.createForumTopic(chat.id, `🎬 ${title}`));
  if (!forumTopic) {
    await replyEphemeral(ctx, "Couldn't create the scene's topic. Make sure I'm an admin with the Manage Topics permission.");
    return;
  }

  const topic = await prisma.topic.create({
    data: { groupId: group.id, telegramTopicId: forumTopic.message_thread_id, type: "SCENE" },
  });
  const scene = await prisma.scene.create({
    data: {
      topicId: topic.id,
      groupId: group.id,
      title,
      description,
      createdByUserId: BigInt(ctx.from.id),
      status: "CASTING",
    },
  });

  await refreshSceneCard(ctx, chat.id, topic.telegramTopicId, scene);
  await refreshSceneIndex(ctx, group.id);
  await replyEphemeral(ctx, `Scene <b>${escapeHtml(title)}</b> created! Head to its topic to finish setting it up.`, {
    parse_mode: "HTML",
  });
}

async function promptNewScene(ctx: MyContext, group: Group): Promise<void> {
  const templates = await prisma.sceneTemplate.findMany({ where: { groupId: group.id }, orderBy: { name: "asc" } });

  if (templates.length === 0) {
    setFlow(ctx, { kind: "new_scene_name" });
    await replyEphemeral(ctx, "Send a name for the new scene. (Tip: /scene <name> also works directly.)", {
      message_thread_id: currentThreadId(ctx),
      reply_markup: { force_reply: true, selective: true },
    });
    return;
  }

  const kb = new InlineKeyboard();
  for (const t of templates) kb.text(t.name, `tmpl:use:${t.id}`).row();
  kb.text("🆕 Blank scene", "tmpl:blank");

  await replyEphemeral(ctx, "Start from a saved template, or a blank scene?", {
    message_thread_id: currentThreadId(ctx),
    reply_markup: kb,
  });
}

async function renderCharacterPicker(ctx: MyContext, sceneId: string): Promise<void> {
  const scene = await prisma.scene.findUnique({ where: { id: sceneId } });
  if (!scene) {
    await ctx.answerCallbackQuery({ text: "This scene no longer exists.", show_alert: true });
    return;
  }

  const characters = await prisma.character.findMany({
    where: { groupId: scene.groupId, status: "APPROVED", sceneCasts: { none: { sceneId } } },
    orderBy: { name: "asc" },
  });

  const kb = new InlineKeyboard();
  for (const c of characters) kb.text(c.name, `char:pick:${c.id}`).row();
  kb.text("✅ Done", "cast:done");

  const text =
    characters.length === 0
      ? "No approved characters left to cast in this scene.\n\nEither propose more characters in Casting, or tap Done."
      : "Pick a character to cast:";

  await safeCall("render character picker", () => ctx.editMessageText(text, { reply_markup: kb }));
}

async function renderMemberPicker(ctx: MyContext, sceneId: string, characterId: string, page: number): Promise<void> {
  const scene = await prisma.scene.findUnique({ where: { id: sceneId } });
  const character = await prisma.character.findUnique({ where: { id: characterId } });
  if (!scene || !character) {
    await ctx.answerCallbackQuery({ text: "That scene or character no longer exists.", show_alert: true });
    return;
  }

  const members = await prisma.groupMember.findMany({ where: { groupId: scene.groupId }, orderBy: { displayName: "asc" } });
  const pageResult = paginate(members, page, MEMBERS_PAGE_SIZE);

  const kb = new InlineKeyboard();
  for (const m of pageResult.items) {
    const label = m.username ? `${m.displayName} (@${m.username})` : m.displayName;
    kb.text(label, `mem:pick:${m.userId}`).row();
  }
  if (pageResult.hasPrev || pageResult.hasNext) {
    if (pageResult.hasPrev) kb.text("◀️", `mem:page:${pageResult.page - 1}`);
    if (pageResult.hasNext) kb.text("▶️", `mem:page:${pageResult.page + 1}`);
    kb.row();
  }
  kb.text("◀️ Back to characters", "cast:back");

  const text =
    `Casting <b>${escapeHtml(character.name)}</b>\n\n` +
    (members.length === 0
      ? "No known group members yet — they need to send at least one message in the group first.\n\nYou can also use the text shorthand instead:\n<code>CharacterName: @username</code>"
      : `Pick who plays this character (page ${pageResult.page + 1}/${pageResult.pageCount}):`);

  await safeCall("render member picker", () => ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb }));
}

async function announceSceneLive(ctx: MyContext, scene: Scene): Promise<void> {
  const chat = ctx.chat!;
  const casts = await prisma.sceneCast.findMany({ where: { sceneId: scene.id }, include: { character: true } });
  const members = await prisma.groupMember.findMany({
    where: { groupId: scene.groupId, userId: { in: casts.map((c) => c.userId) } },
  });
  const nameByUserId = new Map(members.map((m) => [m.userId.toString(), m.displayName]));

  const castLines = casts.map((c) => {
    const label = nameByUserId.get(c.userId.toString()) ?? "a player";
    return `• <b>${escapeHtml(c.character.name)}</b> — ${mentionHtml(c.userId, label)}`;
  });

  const text = [`🎬 <b>${escapeHtml(scene.title)}</b> is now open!`, "", "<b>Cast:</b>", ...castLines].join("\n");
  await safeCall("announce scene live", () =>
    ctx.api.sendMessage(chat.id, text, { message_thread_id: currentThreadId(ctx), parse_mode: "HTML" })
  );
}

async function closeScene(ctx: MyContext, scene: Scene): Promise<void> {
  const chat = ctx.chat!;
  const threadId = currentThreadId(ctx);
  const updated = await prisma.scene.update({ where: { id: scene.id }, data: { status: "CLOSED" } });
  await refreshSceneCard(ctx, chat.id, threadId, updated);
  await refreshSceneIndex(ctx, scene.groupId);
  await safeCall("announce scene closed", () =>
    ctx.api.sendMessage(chat.id, `🛑 <b>${escapeHtml(scene.title)}</b> is now closed.`, {
      message_thread_id: threadId,
      parse_mode: "HTML",
    })
  );

  const topic = await prisma.topic.findUnique({ where: { id: scene.topicId } });
  if (topic) {
    await safeCall("closeForumTopic", () => ctx.api.closeForumTopic(chat.id, topic.telegramTopicId));
  }
}

async function exportTranscript(ctx: MyContext, scene: Scene): Promise<void> {
  const chat = ctx.chat!;
  const messages = await prisma.sceneMessage.findMany({ where: { sceneId: scene.id }, orderBy: { createdAt: "asc" } });

  if (messages.length === 0) {
    await replyEphemeral(
      ctx,
      "No messages logged for this scene yet. (I can only export messages sent while I've been running and watching this topic — the Bot API doesn't let bots read Telegram's older history.)",
      { message_thread_id: currentThreadId(ctx) }
    );
    return;
  }

  const lines = messages.map((m) => `[${m.createdAt.toISOString()}] ${m.displayName}: ${m.text}`);
  const content = `Transcript — ${scene.title}\n${"=".repeat(40)}\n\n${lines.join("\n")}\n`;

  await safeCall("send transcript", () =>
    ctx.api.sendDocument(
      chat.id,
      new InputFile(Buffer.from(content, "utf-8"), `${slugify(scene.title)}-transcript.txt`),
      { message_thread_id: currentThreadId(ctx), caption: `📄 Transcript for ${scene.title} (${messages.length} messages)` }
    )
  );
}

async function applyCastShorthand(ctx: MyContext, scene: Scene, text: string): Promise<void> {
  const { assignments, unparsed } = parseCastShorthand(text);

  const applied: string[] = [];
  const errors: string[] = unparsed.map((line) => `Couldn't parse: "${line}"`);

  for (const a of assignments) {
    const character = await prisma.character.findFirst({
      where: { groupId: scene.groupId, status: "APPROVED", name: { equals: a.characterName, mode: "insensitive" } },
    });
    if (!character) {
      errors.push(`No approved character named "${a.characterName}".`);
      continue;
    }

    const member = await prisma.groupMember.findFirst({
      where: { groupId: scene.groupId, username: { equals: a.username, mode: "insensitive" } },
    });
    if (!member) {
      errors.push(`Couldn't find @${a.username} — they need to have sent at least one message in this group.`);
      continue;
    }

    await prisma.sceneCast.upsert({
      where: { sceneId_characterId: { sceneId: scene.id, characterId: character.id } },
      create: { sceneId: scene.id, characterId: character.id, userId: member.userId },
      update: { userId: member.userId },
    });
    applied.push(`${character.name} → @${a.username}`);
  }

  const parts: string[] = [];
  if (applied.length) parts.push(`✅ Assigned:\n${applied.map((l) => `• ${l}`).join("\n")}`);
  if (errors.length) parts.push(`⚠️ Couldn't apply:\n${errors.map((l) => `• ${l}`).join("\n")}`);
  if (parts.length === 0) parts.push("Nothing to apply.");

  await trackIncoming(ctx);
  await replyEphemeral(ctx, parts.join("\n\n"), { message_thread_id: currentThreadId(ctx) });

  if (applied.length > 0) {
    const updatedScene = await prisma.scene.findUnique({ where: { id: scene.id } });
    if (updatedScene) await refreshSceneCard(ctx, ctx.chat!.id, currentThreadId(ctx), updatedScene);
  }
}

/** Continues a scene-setup flow. Returns true if the update was consumed. */
export async function continueSceneFlow(ctx: MyContext, flow: Flow): Promise<boolean> {
  if (flow.kind === "set_scene_description") {
    const description = ctx.message?.text?.trim();
    if (!description) {
      await replyEphemeral(ctx, "Please send the description as text.");
      return true;
    }
    await trackIncoming(ctx);
    const scene = await prisma.scene.update({ where: { id: flow.sceneId }, data: { description } });
    clearFlow(ctx);
    await refreshSceneCard(ctx, ctx.chat!.id, currentThreadId(ctx), scene);
    await replyEphemeral(ctx, "Description updated.");
    return true;
  }

  if (flow.kind === "set_scene_banner") {
    const photos = ctx.message?.photo;
    if (!photos || photos.length === 0) {
      await replyEphemeral(ctx, "Please send a photo.");
      return true;
    }
    await trackIncoming(ctx);
    const fileId = photos[photos.length - 1]!.file_id;
    const scene = await prisma.scene.update({ where: { id: flow.sceneId }, data: { bannerFileId: fileId } });
    clearFlow(ctx);

    const sentPhoto = await safeCall("send banner photo", () =>
      ctx.api.sendPhoto(ctx.chat!.id, fileId, {
        caption: `📸 Banner for <b>${escapeHtml(scene.title)}</b>`,
        parse_mode: "HTML",
        message_thread_id: currentThreadId(ctx),
      })
    );
    if (sentPhoto) await safePinMessage(ctx.api, ctx.chat!.id, sentPhoto.message_id);
    await refreshSceneCard(ctx, ctx.chat!.id, currentThreadId(ctx), scene);
    return true;
  }

  if (flow.kind === "new_scene_name") {
    const name = ctx.message?.text?.trim();
    if (!name) {
      await replyEphemeral(ctx, "Please send a name as text.");
      return true;
    }
    await trackIncoming(ctx);
    clearFlow(ctx);
    const group = await getOrCreateGroup(ctx.chat!);
    await createScene(ctx, group, name, null);
    return true;
  }

  // "assign_cast" is entirely button-driven (see char:pick/mem:pick/mem:page
  // callbacks below) and doesn't expect text/photo input, so let it fall
  // through untouched (e.g. to the role-repost engine) rather than eating it.
  return false;
}

export function registerSceneHandlers(composer: Composer<MyContext>): void {
  composer.command("scene", async (ctx) => {
    if (!(await requireGroupAdmin(ctx))) return;
    if (!ctx.chat) return;
    const group = await getOrCreateGroup(ctx.chat);
    const name = (ctx.match ?? "").toString().trim();
    if (name) {
      await createScene(ctx, group, name, null);
      return;
    }
    await promptNewScene(ctx, group);
  });

  composer.command("scenes", async (ctx) => {
    if (!ctx.chat) return;
    const group = await getOrCreateGroup(ctx.chat);
    await refreshSceneIndex(ctx, group.id);
    const castingTopic = await prisma.topic.findFirst({ where: { groupId: group.id, type: "CASTING" } });
    if (castingTopic && currentThreadId(ctx) !== castingTopic.telegramTopicId) {
      await replyEphemeral(ctx, "📚 Scene index updated — see the pinned message in 📋 Casting.", {
        message_thread_id: currentThreadId(ctx),
      });
    }
  });

  composer.command("closescene", async (ctx) => {
    if (!(await requireGroupAdmin(ctx))) return;
    const scene = await getSceneForCurrentTopic(ctx);
    if (!scene) {
      await replyEphemeral(ctx, "This only works inside a scene topic.");
      return;
    }
    if (scene.status === "CLOSED") {
      await replyEphemeral(ctx, "This scene is already closed.");
      return;
    }
    await closeScene(ctx, scene);
  });

  composer.command("addscenepic", async (ctx) => {
    if (!(await requireGroupAdmin(ctx))) return;
    const scene = await getSceneForCurrentTopic(ctx);
    if (!scene || scene.status === "CLOSED") {
      await replyEphemeral(ctx, "This only works inside an open scene topic.");
      return;
    }
    setFlow(ctx, { kind: "set_scene_banner", sceneId: scene.id });
    await replyEphemeral(ctx, "Send the new scene photo.", {
      message_thread_id: currentThreadId(ctx),
      reply_markup: { force_reply: true, selective: true },
    });
  });

  composer.command("savetemplate", async (ctx) => {
    if (!(await requireGroupAdmin(ctx))) return;
    const scene = await getSceneForCurrentTopic(ctx);
    if (!scene) {
      await replyEphemeral(ctx, "Run this inside a scene topic.");
      return;
    }
    const name = (ctx.match ?? "").toString().trim();
    if (!name) {
      await replyEphemeral(ctx, "Usage: /savetemplate <name>");
      return;
    }

    await prisma.sceneTemplate.upsert({
      where: { groupId_name: { groupId: scene.groupId, name } },
      create: {
        groupId: scene.groupId,
        name,
        title: scene.title,
        description: scene.description,
        createdByUserId: BigInt(ctx.from!.id),
      },
      update: { title: scene.title, description: scene.description },
    });
    await replyEphemeral(ctx, `Saved this scene as template "${escapeHtml(name)}". Reuse it later with /scene (no arguments).`, {
      parse_mode: "HTML",
      message_thread_id: currentThreadId(ctx),
    });
  });

  composer.command("export", async (ctx) => {
    if (!(await requireGroupAdmin(ctx))) return;
    const scene = await getSceneForCurrentTopic(ctx);
    if (!scene) {
      await replyEphemeral(ctx, "Run this inside a scene topic.");
      return;
    }
    await exportTranscript(ctx, scene);
  });

  composer.callbackQuery("scene:new", async (ctx) => {
    if (!(await requireGroupAdminCallback(ctx))) return;
    if (!ctx.chat) return;
    const group = await getOrCreateGroup(ctx.chat);
    await ctx.answerCallbackQuery();
    await promptNewScene(ctx, group);
  });

  composer.callbackQuery(/^tmpl:use:(.+)$/, async (ctx) => {
    if (!(await requireGroupAdminCallback(ctx))) return;
    const template = await prisma.sceneTemplate.findUnique({ where: { id: ctx.match[1]! } });
    if (!template) {
      await ctx.answerCallbackQuery({ text: "Template not found.", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    const group = await prisma.group.findUniqueOrThrow({ where: { id: template.groupId } });
    await createScene(ctx, group, template.title, template.description);
  });

  composer.callbackQuery("tmpl:blank", async (ctx) => {
    if (!(await requireGroupAdminCallback(ctx))) return;
    await ctx.answerCallbackQuery();
    setFlow(ctx, { kind: "new_scene_name" });
    await replyEphemeral(ctx, "Send a name for the new scene.", {
      message_thread_id: currentThreadId(ctx),
      reply_markup: { force_reply: true, selective: true },
    });
  });

  composer.callbackQuery("scene:setdesc", async (ctx) => {
    if (!(await requireGroupAdminCallback(ctx))) return;
    const scene = await getSceneForCurrentTopic(ctx);
    if (!scene || scene.status === "CLOSED") {
      await ctx.answerCallbackQuery({ text: "No open scene here.", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    setFlow(ctx, { kind: "set_scene_description", sceneId: scene.id });
    await replyEphemeral(ctx, "Send the new description for this scene.", {
      message_thread_id: currentThreadId(ctx),
      reply_markup: { force_reply: true, selective: true },
    });
  });

  composer.callbackQuery(["scene:setbanner", "scene:addpic"], async (ctx) => {
    if (!(await requireGroupAdminCallback(ctx))) return;
    const scene = await getSceneForCurrentTopic(ctx);
    if (!scene || scene.status === "CLOSED") {
      await ctx.answerCallbackQuery({ text: "No open scene here.", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    setFlow(ctx, { kind: "set_scene_banner", sceneId: scene.id });
    await replyEphemeral(ctx, "Send a photo to use as this scene's banner.", {
      message_thread_id: currentThreadId(ctx),
      reply_markup: { force_reply: true, selective: true },
    });
  });

  composer.callbackQuery("scene:assigncast", async (ctx) => {
    if (!(await requireGroupAdminCallback(ctx))) return;
    const scene = await getSceneForCurrentTopic(ctx);
    if (!scene || scene.status === "CLOSED") {
      await ctx.answerCallbackQuery({ text: "No open scene here.", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    setFlow(ctx, { kind: "assign_cast", sceneId: scene.id, memberPage: 0 });
    await renderCharacterPicker(ctx, scene.id);
  });

  composer.callbackQuery(/^char:pick:(.+)$/, async (ctx) => {
    if (!(await requireGroupAdminCallback(ctx))) return;
    const flow = ctx.session.flow;
    if (!flow || flow.kind !== "assign_cast") {
      await ctx.answerCallbackQuery({ text: 'Tap "Assign cast" first.', show_alert: true });
      return;
    }
    const characterId = ctx.match[1]!;
    setFlow(ctx, { kind: "assign_cast", sceneId: flow.sceneId, characterId, memberPage: 0 });
    await ctx.answerCallbackQuery();
    await renderMemberPicker(ctx, flow.sceneId, characterId, 0);
  });

  composer.callbackQuery(/^mem:page:(\d+)$/, async (ctx) => {
    if (!(await requireGroupAdminCallback(ctx))) return;
    const flow = ctx.session.flow;
    if (!flow || flow.kind !== "assign_cast" || !flow.characterId) {
      await ctx.answerCallbackQuery({ text: "This menu expired — tap Assign cast again.", show_alert: true });
      return;
    }
    const page = Number(ctx.match[1]);
    setFlow(ctx, { ...flow, memberPage: page });
    await ctx.answerCallbackQuery();
    await renderMemberPicker(ctx, flow.sceneId, flow.characterId, page);
  });

  composer.callbackQuery(/^mem:pick:(\d+)$/, async (ctx) => {
    if (!(await requireGroupAdminCallback(ctx))) return;
    const flow = ctx.session.flow;
    if (!flow || flow.kind !== "assign_cast" || !flow.characterId) {
      await ctx.answerCallbackQuery({ text: "This menu expired — tap Assign cast again.", show_alert: true });
      return;
    }

    const userId = BigInt(ctx.match[1]!);
    const scene = await prisma.scene.findUnique({ where: { id: flow.sceneId } });
    if (!scene) {
      await ctx.answerCallbackQuery({ text: "Scene no longer exists.", show_alert: true });
      return;
    }

    const member = await prisma.groupMember.findUnique({ where: { groupId_userId: { groupId: scene.groupId, userId } } });

    await prisma.sceneCast.upsert({
      where: { sceneId_characterId: { sceneId: flow.sceneId, characterId: flow.characterId } },
      create: { sceneId: flow.sceneId, characterId: flow.characterId, userId },
      update: { userId },
    });

    await ctx.answerCallbackQuery({ text: `Cast ${member?.displayName ?? "member"}!` });
    setFlow(ctx, { kind: "assign_cast", sceneId: flow.sceneId, memberPage: 0 });
    await renderCharacterPicker(ctx, flow.sceneId);
  });

  composer.callbackQuery("cast:back", async (ctx) => {
    if (!(await requireGroupAdminCallback(ctx))) return;
    const flow = ctx.session.flow;
    if (!flow || flow.kind !== "assign_cast") {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    setFlow(ctx, { kind: "assign_cast", sceneId: flow.sceneId, memberPage: 0 });
    await renderCharacterPicker(ctx, flow.sceneId);
  });

  composer.callbackQuery("cast:done", async (ctx) => {
    if (!(await requireGroupAdminCallback(ctx))) return;
    const flow = ctx.session.flow;
    const sceneId = flow && flow.kind === "assign_cast" ? flow.sceneId : (await getSceneForCurrentTopic(ctx))?.id;
    clearFlow(ctx);
    await ctx.answerCallbackQuery();
    if (!sceneId || !ctx.chat) return;
    const scene = await prisma.scene.findUnique({ where: { id: sceneId } });
    if (scene) await refreshSceneCard(ctx, ctx.chat.id, currentThreadId(ctx), scene);
  });

  composer.callbackQuery("scene:start", async (ctx) => {
    if (!(await requireGroupAdminCallback(ctx))) return;
    const scene = await getSceneForCurrentTopic(ctx);
    if (!scene) {
      await ctx.answerCallbackQuery({ text: "No scene here.", show_alert: true });
      return;
    }
    if (scene.status !== "CASTING") {
      await ctx.answerCallbackQuery({ text: `Scene is already ${scene.status.toLowerCase()}.`, show_alert: true });
      return;
    }

    const castCount = await prisma.sceneCast.count({ where: { sceneId: scene.id } });
    if (castCount === 0) {
      await ctx.answerCallbackQuery({ text: "Assign at least one character before starting the scene.", show_alert: true });
      return;
    }

    const updated = await prisma.scene.update({ where: { id: scene.id }, data: { status: "OPEN" } });
    await ctx.answerCallbackQuery({ text: "Scene is live!" });
    await refreshSceneCard(ctx, ctx.chat!.id, currentThreadId(ctx), updated);
    await refreshSceneIndex(ctx, scene.groupId);
    await announceSceneLive(ctx, updated);
  });

  composer.callbackQuery("scene:close", async (ctx) => {
    if (!(await requireGroupAdminCallback(ctx))) return;
    const scene = await getSceneForCurrentTopic(ctx);
    if (!scene) {
      await ctx.answerCallbackQuery({ text: "No scene here.", show_alert: true });
      return;
    }
    if (scene.status === "CLOSED") {
      await ctx.answerCallbackQuery({ text: "Already closed.", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    await closeScene(ctx, scene);
  });

  composer.callbackQuery("scene:export", async (ctx) => {
    if (!(await requireGroupAdminCallback(ctx))) return;
    const scene = await getSceneForCurrentTopic(ctx);
    if (!scene) {
      await ctx.answerCallbackQuery({ text: "No scene here.", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    await exportTranscript(ctx, scene);
  });
}

/**
 * Registered separately (not inside registerSceneHandlers) so index.ts can
 * place it precisely between the flow dispatcher and the role-repost engine
 * — see bot/flowDispatcher.ts and handlers/index.ts for why order matters.
 */
export function registerCastShorthandHandler(composer: Composer<MyContext>): void {
  composer.on("message:text", async (ctx, next) => {
    if (!ctx.chat || !ctx.from) return next();
    if (ctx.message.text.startsWith("/")) return next();
    if (!looksLikeCastShorthand(ctx.message.text)) return next();

    const scene = await getSceneForCurrentTopic(ctx);
    if (!scene || scene.status === "CLOSED") return next();

    const isAdmin = await isGroupAdmin(ctx.api, ctx.chat.id, ctx.from.id);
    if (!isAdmin) return next();

    await applyCastShorthand(ctx, scene, ctx.message.text);
  });
}
