import type { User } from "grammy/types";
import { prisma } from "./prisma";
import { displayNameOf } from "./format";
import { logger } from "./logger";

const RESYNC_INTERVAL_MS = 10 * 60 * 1000;
const lastSynced = new Map<string, number>();

/**
 * Telegram's Bot API has no "list all group members" endpoint (only
 * getChatAdministrators and getChatMember-by-id). To offer a member picker
 * for cast assignment and to resolve @username in the cast shorthand, the
 * bot builds its own roster from users it has actually observed messaging —
 * see README "Design decisions".
 *
 * Called on every incoming group message; throttled with an in-memory
 * last-synced timestamp so we're not writing to Postgres on every message,
 * only at most once per user per RESYNC_INTERVAL_MS.
 */
export async function trackGroupMember(groupId: string, chatId: number, user: User): Promise<void> {
  if (user.is_bot) return;

  const cacheKey = `${chatId}:${user.id}`;
  const last = lastSynced.get(cacheKey);
  const now = Date.now();
  if (last && now - last < RESYNC_INTERVAL_MS) return;

  try {
    await prisma.groupMember.upsert({
      where: { groupId_userId: { groupId, userId: BigInt(user.id) } },
      create: {
        groupId,
        userId: BigInt(user.id),
        username: user.username ?? null,
        displayName: displayNameOf(user),
        lastSeenAt: new Date(),
      },
      update: {
        username: user.username ?? null,
        displayName: displayNameOf(user),
        lastSeenAt: new Date(),
      },
    });
    lastSynced.set(cacheKey, now);
  } catch (err) {
    logger.warn("Failed to track group member", { chatId, userId: user.id, err: String(err) });
  }
}
