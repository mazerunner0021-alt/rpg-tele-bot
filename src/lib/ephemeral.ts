import type { Api } from "grammy";
import { prisma } from "./prisma";
import { logger } from "./logger";
import { safeCall } from "./telegram";
import { getGroupIdCached, currentThreadId } from "./scope";
import type { MyContext } from "../bot/context";

/**
 * Records a message as "clutter" — a flow prompt, confirmation, error, or
 * the raw input that fed one — so /cleanup can remove it later. Never call
 * this for RP dialogue, pinned control cards, character proposal cards,
 * banners, or anything meant to persist. See README "Design decisions".
 */
export async function trackEphemeral(groupId: string, telegramTopicId: number, messageId: number): Promise<void> {
  try {
    await prisma.ephemeralMessage.create({ data: { groupId, telegramTopicId, messageId } });
  } catch (err) {
    logger.warn("Failed to track ephemeral message", { groupId, telegramTopicId, messageId, err: String(err) });
  }
}

/** Convenience: track the message that triggered the current update (a consumed flow reply). */
export async function trackIncoming(ctx: MyContext): Promise<void> {
  if (!ctx.chat || !ctx.message) return;
  const groupId = await getGroupIdCached(ctx.chat);
  await trackEphemeral(groupId, currentThreadId(ctx), ctx.message.message_id);
}

/** ctx.reply(), but the sent message is tracked as ephemeral for future /cleanup. */
export async function replyEphemeral(
  ctx: MyContext,
  text: string,
  extra?: NonNullable<Parameters<MyContext["reply"]>[1]>
): Promise<Awaited<ReturnType<MyContext["reply"]>>> {
  const msg = await ctx.reply(text, extra);
  if (ctx.chat) {
    const groupId = await getGroupIdCached(ctx.chat);
    await trackEphemeral(groupId, currentThreadId(ctx), msg.message_id);
  }
  return msg;
}

export interface CleanupResult {
  deleted: number;
  failed: number;
}

/** Bulk-deletes every tracked ephemeral message for one topic and clears the tracking rows. */
export async function cleanupTopic(api: Api, chatId: number, groupId: string, telegramTopicId: number): Promise<CleanupResult> {
  const rows = await prisma.ephemeralMessage.findMany({ where: { groupId, telegramTopicId } });
  if (rows.length === 0) return { deleted: 0, failed: 0 };

  let deleted = 0;
  let failed = 0;
  const ids = rows.map((r) => r.messageId);

  // Telegram's bulk deleteMessages caps out at 100 ids per call.
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const ok = await safeCall("deleteMessages", () => api.deleteMessages(chatId, chunk));
    if (ok) {
      deleted += chunk.length;
      continue;
    }
    // One bad/already-gone id fails the whole batch — retry one at a time.
    for (const id of chunk) {
      const single = await safeCall("deleteMessage", () => api.deleteMessage(chatId, id));
      if (single) deleted += 1;
      else failed += 1;
    }
  }

  await prisma.ephemeralMessage.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  return { deleted, failed };
}
