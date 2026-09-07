import { session } from "grammy";
import type { StorageAdapter } from "grammy";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import { initialSession, type SessionData } from "./sessionTypes";
import type { MyContext } from "./context";

/**
 * Persists session data (in-progress flows) to Postgres via the BotSession
 * table instead of keeping it only in memory, so Render restarting/
 * redeploying the free-tier web service doesn't silently drop a user's
 * in-progress "propose a character" or "assign cast" flow.
 */
function prismaStorage(): StorageAdapter<SessionData> {
  return {
    async read(key) {
      const row = await prisma.botSession.findUnique({ where: { key } });
      return row ? (row.value as unknown as SessionData) : undefined;
    },
    async write(key, value) {
      const json = value as unknown as Prisma.InputJsonValue;
      await prisma.botSession.upsert({
        where: { key },
        create: { key, value: json },
        update: { value: json },
      });
    },
    async delete(key) {
      try {
        await prisma.botSession.delete({ where: { key } });
      } catch {
        // already gone — fine
      }
    },
  };
}

export function createSessionMiddleware() {
  return session<SessionData, MyContext>({
    initial: initialSession,
    storage: prismaStorage(),
    getSessionKey: (ctx) => {
      const chatId = ctx.chat?.id;
      const userId = ctx.from?.id;
      if (chatId === undefined || userId === undefined) {
        logger.debug("No session key for update (missing chat or from)");
        return undefined;
      }
      return `${chatId}:${userId}`;
    },
  });
}
