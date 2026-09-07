import type { Api } from "grammy";
import { logger } from "./logger";

interface CacheEntry {
  adminIds: Set<number>;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<number, CacheEntry>();

/**
 * Group admin lookups are needed on nearly every button press (approve/
 * reject, scene controls, ...). Calling getChatAdministrators on every press
 * would waste Bot API quota, so results are cached per chat for a few
 * minutes. This cache is intentionally in-memory (not Prisma-backed): it is
 * pure derived data that Telegram is always the source of truth for, so
 * losing it on a restart just means the next check repopulates it — see
 * README "Design decisions".
 */
async function getAdminIds(api: Api, chatId: number): Promise<Set<number>> {
  const cached = cache.get(chatId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.adminIds;
  }

  try {
    const admins = await api.getChatAdministrators(chatId);
    const adminIds = new Set(admins.map((m) => m.user.id));
    cache.set(chatId, { adminIds, expiresAt: Date.now() + CACHE_TTL_MS });
    return adminIds;
  } catch (err) {
    logger.warn("Failed to refresh admin cache", { chatId, err: String(err) });
    return cached?.adminIds ?? new Set();
  }
}

export async function isGroupAdmin(api: Api, chatId: number, userId: number): Promise<boolean> {
  const adminIds = await getAdminIds(api, chatId);
  return adminIds.has(userId);
}

/** Call after any action that could change admin membership (rare) to force a refresh on next check. */
export function invalidateAdminCache(chatId: number): void {
  cache.delete(chatId);
}
