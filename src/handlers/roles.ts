import { InlineKeyboard, type Composer } from "grammy";
import type { User } from "grammy/types";
import type { Character, Scene } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { escapeHtml, displayNameOf } from "../lib/format";
import { safeCall, safeDeleteMessage } from "../lib/telegram";
import { getSceneForCurrentTopic, currentThreadId } from "../lib/scope";
import { RateLimiter } from "../lib/rateLimiter";
import { logger } from "../lib/logger";
import type { MyContext } from "../bot/context";

// Caps the delete-and-repost loop per (scene, user) so a bug or spam burst
// can't blow through Bot API rate limits. See README "Design decisions".
const REPOST_LIMIT = 20;
const REPOST_WINDOW_MS = 60_000;
const repostLimiter = new RateLimiter(REPOST_LIMIT, REPOST_WINDOW_MS);

async function logSceneMessage(sceneId: string, user: User, displayName: string, text: string): Promise<void> {
  try {
    await prisma.sceneMessage.create({ data: { sceneId, userId: BigInt(user.id), displayName, text } });
  } catch (err) {
    logger.warn("Failed to log scene message", { sceneId, err: String(err) });
  }
}

async function repostAsCharacter(ctx: MyContext, scene: Scene, character: Character, text: string): Promise<void> {
  const chatId = ctx.chat!.id;
  const threadId = currentThreadId(ctx);
  const originalMessageId = ctx.message!.message_id;
  const caption = `<b>${escapeHtml(character.name)}</b>\n${escapeHtml(text)}`;

  const deleted = await safeDeleteMessage(ctx.api, chatId, originalMessageId);
  if (!deleted) {
    logger.warn("Could not delete original message; posting reformatted copy alongside it", {
      chatId,
      originalMessageId,
    });
  }

  let delivered = false;

  if (character.avatarFileId) {
    const sentPhoto = await safeCall("repost as photo", () =>
      ctx.api.sendPhoto(chatId, character.avatarFileId!, { caption, parse_mode: "HTML", message_thread_id: threadId })
    );
    delivered = Boolean(sentPhoto);
  }

  if (!delivered) {
    const sentText = await safeCall("repost as text", () =>
      ctx.api.sendMessage(chatId, caption, { parse_mode: "HTML", message_thread_id: threadId })
    );
    delivered = Boolean(sentText);
  }

  if (!delivered) {
    logger.error("Failed to repost character message via the Bot API — content is preserved only in the transcript log", {
      chatId,
      characterId: character.id,
    });
  }

  await logSceneMessage(scene.id, ctx.from!, character.name, text);
}

async function sendCharacterSwitchPicker(ctx: MyContext, scene: Scene): Promise<void> {
  if (!ctx.from) return;

  const casts = await prisma.sceneCast.findMany({
    where: { sceneId: scene.id, userId: BigInt(ctx.from.id) },
    include: { character: true },
  });

  if (casts.length === 0) {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: "You don't have a character in this scene.", show_alert: true });
    } else {
      await ctx.reply("You don't have a character in this scene.", { message_thread_id: currentThreadId(ctx) });
    }
    return;
  }

  const kb = new InlineKeyboard();
  for (const c of casts) kb.text(c.character.name, `role:pick:${c.characterId}`).row();

  // Only present when this ran from a button press (not the /switch command).
  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery();
  }
  await ctx.reply("Choose who you're speaking as:", {
    message_thread_id: currentThreadId(ctx),
    reply_markup: kb,
  });
}

export function registerRoleCommands(composer: Composer<MyContext>): void {
  composer.command("switch", async (ctx) => {
    const scene = await getSceneForCurrentTopic(ctx);
    if (!scene || scene.status !== "OPEN") {
      await ctx.reply("This only works inside an open scene topic.");
      return;
    }
    await sendCharacterSwitchPicker(ctx, scene);
  });
}

export function registerRoleCallbacks(composer: Composer<MyContext>): void {
  composer.callbackQuery("role:switch", async (ctx) => {
    const scene = await getSceneForCurrentTopic(ctx);
    if (!scene || scene.status !== "OPEN") {
      await ctx.answerCallbackQuery({ text: "This scene isn't open.", show_alert: true });
      return;
    }
    await sendCharacterSwitchPicker(ctx, scene);
  });

  composer.callbackQuery(/^role:pick:(.+)$/, async (ctx) => {
    const scene = await getSceneForCurrentTopic(ctx);
    if (!scene || scene.status !== "OPEN") {
      await ctx.answerCallbackQuery({ text: "This scene isn't open.", show_alert: true });
      return;
    }
    if (!ctx.from) return;

    const characterId = ctx.match[1]!;
    const cast = await prisma.sceneCast.findUnique({ where: { sceneId_characterId: { sceneId: scene.id, characterId } } });
    if (!cast || cast.userId !== BigInt(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: "That's not your character.", show_alert: true });
      return;
    }

    await prisma.activeRole.upsert({
      where: { userId_sceneId: { userId: BigInt(ctx.from.id), sceneId: scene.id } },
      create: { userId: BigInt(ctx.from.id), sceneId: scene.id, characterId },
      update: { characterId },
    });

    const character = await prisma.character.findUnique({ where: { id: characterId } });
    // Silent per spec: no announcement message, just a private-feeling toast.
    await ctx.answerCallbackQuery({ text: `You're now speaking as ${character?.name ?? "your character"}.` });
    await safeCall("delete role picker", () => ctx.deleteMessage());
  });
}

/**
 * The delete-and-repost engine. Registered last among the message:text
 * handlers (after the flow dispatcher and cast-shorthand parser) so it only
 * ever sees plain scene dialogue, never flow input or admin cast commands.
 */
export function registerRoleRepostHandler(composer: Composer<MyContext>): void {
  composer.on("message:text", async (ctx, next) => {
    if (!ctx.chat || !ctx.from) return next();
    if (ctx.message.text.startsWith("/")) return next();

    const scene = await getSceneForCurrentTopic(ctx);
    if (!scene || scene.status !== "OPEN") return next();

    const activeRole = await prisma.activeRole.findUnique({
      where: { userId_sceneId: { userId: BigInt(ctx.from.id), sceneId: scene.id } },
      include: { character: true },
    });

    if (!activeRole) {
      // OOC / GM narration passes through untouched, but is still logged so
      // /export can produce a complete-as-possible transcript.
      await logSceneMessage(scene.id, ctx.from, displayNameOf(ctx.from), ctx.message.text);
      return next();
    }

    const key = `${scene.id}:${ctx.from.id}`;
    if (!repostLimiter.tryAcquire(key)) {
      logger.warn("Repost rate limit hit — leaving message as sent instead of reformatting", {
        sceneId: scene.id,
        userId: ctx.from.id,
      });
      await logSceneMessage(scene.id, ctx.from, activeRole.character.name, ctx.message.text);
      return next();
    }

    await repostAsCharacter(ctx, scene, activeRole.character, ctx.message.text);
    // Consumed: the original was deleted and replaced, so don't call next().
  });
}
