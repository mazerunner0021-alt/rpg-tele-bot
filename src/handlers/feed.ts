import { randomUUID } from "node:crypto";
import { InlineKeyboard, type Composer } from "grammy";
import type { Character } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { getEnv } from "../config/env";
import { escapeHtml } from "../lib/format";
import { safeCall, safeDeleteMessage } from "../lib/telegram";
import { getOrCreateGroup, getGroupIdCached, getCurrentTopic, currentThreadId } from "../lib/scope";
import { replyEphemeral, trackIncoming } from "../lib/ephemeral";
import { setFlow, clearFlow } from "../bot/flow";
import type { Flow } from "../bot/sessionTypes";
import type { MyContext } from "../bot/context";
import { logger } from "../lib/logger";

/** Every character a user currently plays anywhere in the group — their available Feed personas. */
async function getAvailableCharacters(groupId: string, userId: number): Promise<Character[]> {
  const casts = await prisma.sceneCast.findMany({
    where: { userId: BigInt(userId), scene: { groupId } },
    distinct: ["characterId"],
    include: { character: true },
  });
  return casts.map((c) => c.character);
}

type PersonaResolution =
  | { kind: "resolved"; character: Character }
  | { kind: "none" }
  | { kind: "ambiguous"; options: Character[] };

async function resolvePersona(groupId: string, userId: number): Promise<PersonaResolution> {
  const existing = await prisma.feedPersona.findUnique({
    where: { groupId_userId: { groupId, userId: BigInt(userId) } },
    include: { character: true },
  });
  if (existing) return { kind: "resolved", character: existing.character };

  const available = await getAvailableCharacters(groupId, userId);
  if (available.length === 0) return { kind: "none" };
  if (available.length === 1) {
    await prisma.feedPersona.create({
      data: { groupId, userId: BigInt(userId), characterId: available[0]!.id },
    });
    return { kind: "resolved", character: available[0]! };
  }
  return { kind: "ambiguous", options: available };
}

async function sendPersonaPicker(ctx: MyContext, options: Character[]): Promise<void> {
  const kb = new InlineKeyboard();
  for (const c of options) kb.text(c.name, `persona:pick:${c.id}`).row();
  await replyEphemeral(ctx, "Which character do you want to be?", {
    message_thread_id: currentThreadId(ctx),
    reply_markup: kb,
  });
}

async function publishPost(ctx: MyContext, characterId: string, fileId: string, caption: string | null): Promise<void> {
  const chat = ctx.chat;
  if (!chat || !ctx.from) return;
  const character = await prisma.character.findUnique({ where: { id: characterId } });
  if (!character) return;

  const threadId = currentThreadId(ctx);
  const originalMessageId = ctx.message!.message_id;

  const deleted = await safeDeleteMessage(ctx.api, chat.id, originalMessageId);
  if (!deleted) {
    logger.warn("Could not delete original post photo; reposting anyway", { chatId: chat.id, originalMessageId });
  }

  const postId = randomUUID();
  const captionHtml = `<b>${escapeHtml(character.name)}</b>${caption ? `\n${escapeHtml(caption)}` : ""}`;
  const env = getEnv();
  const keyboard = env.RENDER_EXTERNAL_URL
    ? new InlineKeyboard().webApp("📱 View as Post", `${env.RENDER_EXTERNAL_URL}/app/post/${postId}`)
    : undefined;

  const sent = await safeCall("repost as post", () =>
    ctx.api.sendPhoto(chat.id, fileId, {
      caption: captionHtml,
      parse_mode: "HTML",
      message_thread_id: threadId,
      reply_markup: keyboard,
    })
  );
  if (!sent) {
    await replyEphemeral(ctx, "Something went wrong posting that — please try again.", { message_thread_id: threadId });
    return;
  }

  await prisma.post.create({
    data: {
      id: postId,
      groupId: character.groupId,
      messageId: sent.message_id,
      characterId: character.id,
      authorUserId: BigInt(ctx.from.id),
      fileId,
      caption,
    },
  });
}

/** Continues an await_post_photo flow. Returns true if the update was consumed. */
export async function continueFeedFlow(ctx: MyContext, flow: Flow): Promise<boolean> {
  if (flow.kind !== "await_post_photo") return false;

  const photos = ctx.message?.photo;
  if (!photos || photos.length === 0) {
    await replyEphemeral(ctx, "Please send a photo.");
    return true;
  }

  await trackIncoming(ctx);
  clearFlow(ctx);
  await publishPost(ctx, flow.characterId, photos[photos.length - 1]!.file_id, ctx.message?.caption ?? null);
  return true;
}

export function registerFeedCommands(composer: Composer<MyContext>): void {
  composer.command("post", async (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    const topic = await getCurrentTopic(ctx);
    if (!topic || topic.type !== "FEED") {
      await replyEphemeral(ctx, "This only works in the 📸 Feed topic.", { message_thread_id: currentThreadId(ctx) });
      return;
    }

    const group = await getOrCreateGroup(ctx.chat);
    const resolution = await resolvePersona(group.id, ctx.from.id);

    if (resolution.kind === "none") {
      await replyEphemeral(
        ctx,
        "You need to be cast as a character in a scene before you can post to the Feed. Ask an admin to cast you first.",
        { message_thread_id: currentThreadId(ctx) }
      );
      return;
    }

    if (resolution.kind === "ambiguous") {
      setFlow(ctx, { kind: "await_persona_pick", purpose: "post" });
      await sendPersonaPicker(ctx, resolution.options);
      return;
    }

    setFlow(ctx, { kind: "await_post_photo", characterId: resolution.character.id });
    await replyEphemeral(
      ctx,
      `Posting as <b>${escapeHtml(resolution.character.name)}</b>. Send the photo you want to post (add a caption if you like).`,
      { parse_mode: "HTML", message_thread_id: currentThreadId(ctx), reply_markup: { force_reply: true, selective: true } }
    );
  });

  composer.command("persona", async (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    const group = await getOrCreateGroup(ctx.chat);
    const available = await getAvailableCharacters(group.id, ctx.from.id);

    if (available.length === 0) {
      await replyEphemeral(ctx, "You're not cast as any character yet. Ask an admin to cast you in a scene first.", {
        message_thread_id: currentThreadId(ctx),
      });
      return;
    }

    if (available.length === 1) {
      await prisma.feedPersona.upsert({
        where: { groupId_userId: { groupId: group.id, userId: BigInt(ctx.from.id) } },
        create: { groupId: group.id, userId: BigInt(ctx.from.id), characterId: available[0]!.id },
        update: { characterId: available[0]!.id },
      });
      await replyEphemeral(ctx, `You post and comment in the Feed as <b>${escapeHtml(available[0]!.name)}</b>.`, {
        parse_mode: "HTML",
        message_thread_id: currentThreadId(ctx),
      });
      return;
    }

    setFlow(ctx, { kind: "await_persona_pick", purpose: "persona" });
    await sendPersonaPicker(ctx, available);
  });

  composer.callbackQuery(/^persona:pick:(.+)$/, async (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    const flow = ctx.session.flow;
    if (!flow || flow.kind !== "await_persona_pick") {
      await ctx.answerCallbackQuery({ text: "This menu expired.", show_alert: true });
      return;
    }

    const characterId = ctx.match[1]!;
    const character = await prisma.character.findUnique({ where: { id: characterId } });
    if (!character) {
      await ctx.answerCallbackQuery({ text: "That character no longer exists.", show_alert: true });
      return;
    }

    const group = await getOrCreateGroup(ctx.chat);
    await prisma.feedPersona.upsert({
      where: { groupId_userId: { groupId: group.id, userId: BigInt(ctx.from.id) } },
      create: { groupId: group.id, userId: BigInt(ctx.from.id), characterId },
      update: { characterId },
    });

    if (flow.purpose === "persona") {
      clearFlow(ctx);
      await ctx.answerCallbackQuery({ text: `You're now ${character.name}.` });
      await safeCall("delete persona picker", () => ctx.deleteMessage());
      return;
    }

    await ctx.answerCallbackQuery({ text: `Posting as ${character.name}.` });
    await safeCall("delete persona picker", () => ctx.deleteMessage());
    setFlow(ctx, { kind: "await_post_photo", characterId });
    await replyEphemeral(ctx, "Send the photo you want to post (add a caption if you like).", {
      message_thread_id: currentThreadId(ctx),
      reply_markup: { force_reply: true, selective: true },
    });
  });
}

/**
 * Silently mirrors chat replies to a tracked Post into PostComment, for the
 * Mini App's comment thread. Never consumes the update — comments stay as
 * normal, visible chat replies in the topic (see README "Design decisions").
 */
export function registerFeedCommentHandler(composer: Composer<MyContext>): void {
  composer.on("message:text", async (ctx, next) => {
    if (!ctx.chat || !ctx.from) return next();
    if (ctx.message.text.startsWith("/")) return next();
    const replyTo = ctx.message.reply_to_message;
    if (!replyTo) return next();

    const topic = await getCurrentTopic(ctx);
    if (!topic || topic.type !== "FEED") return next();

    const groupId = await getGroupIdCached(ctx.chat);
    const post = await prisma.post.findUnique({
      where: { groupId_messageId: { groupId, messageId: replyTo.message_id } },
    });
    if (!post) return next();

    const persona = await prisma.feedPersona.findUnique({
      where: { groupId_userId: { groupId, userId: BigInt(ctx.from.id) } },
    });
    if (!persona) return next(); // no resolvable persona — leave the reply un-mirrored, don't nag on every comment

    await prisma.postComment
      .create({
        data: {
          postId: post.id,
          messageId: ctx.message.message_id,
          userId: BigInt(ctx.from.id),
          characterId: persona.characterId,
          text: ctx.message.text,
        },
      })
      .catch((err) => logger.warn("Failed to log post comment", { postId: post.id, err: String(err) }));

    return next();
  });
}

/** Mirrors Telegram's native message reactions onto a Post as Instagram-style "likes" (existence, not emoji, is what's tracked). */
export function registerFeedReactionHandler(composer: Composer<MyContext>): void {
  composer.on("message_reaction", async (ctx) => {
    const mr = ctx.messageReaction;
    if (!mr.user) return; // anonymous/chat-actor reactions aren't attributable to a user

    const groupId = await getGroupIdCached(mr.chat);
    const post = await prisma.post.findUnique({
      where: { groupId_messageId: { groupId, messageId: mr.message_id } },
    });
    if (!post) return;

    if (mr.new_reaction.length > 0) {
      await prisma.postReaction.upsert({
        where: { postId_userId: { postId: post.id, userId: BigInt(mr.user.id) } },
        create: { postId: post.id, userId: BigInt(mr.user.id) },
        update: {},
      });
    } else {
      await prisma.postReaction.deleteMany({ where: { postId: post.id, userId: BigInt(mr.user.id) } });
    }
  });
}
