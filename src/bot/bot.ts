import { Bot } from "grammy";
import { getEnv } from "../config/env";
import { logger } from "../lib/logger";
import { createSessionMiddleware } from "./session";
import { trackMembersMiddleware } from "./middleware/trackMembers";
import { registerAllHandlers } from "../handlers";
import type { MyContext } from "./context";

export function createBot(): Bot<MyContext> {
  const env = getEnv();
  const bot = new Bot<MyContext>(env.BOT_TOKEN);

  bot.use(createSessionMiddleware());
  bot.use(trackMembersMiddleware());
  bot.use(registerAllHandlers());

  bot.catch((err) => {
    logger.error("Unhandled error in bot middleware", {
      updateId: err.ctx.update.update_id,
      chatId: err.ctx.chat?.id,
      error: err.error instanceof Error ? err.error.stack ?? err.error.message : String(err.error),
    });
  });

  return bot;
}
