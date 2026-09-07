import { getEnv } from "./config/env";
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";
import { createBot } from "./bot/bot";
import { createApp } from "./server/app";
import { registerWebhook } from "./server/registerWebhook";

/** Production entrypoint: webhook mode behind an Express HTTP server (see README "Design decisions" for why not long polling). */
async function main(): Promise<void> {
  const env = getEnv();

  const bot = createBot();
  await bot.init();
  logger.info("Bot initialized", { username: bot.botInfo.username });

  const app = createApp(bot);
  const server = app.listen(env.PORT, () => {
    logger.info(`HTTP server listening on port ${env.PORT}`);
  });

  await registerWebhook(bot).catch((err) => {
    logger.error("Failed to register webhook", { err: err instanceof Error ? err.stack : String(err) });
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal}, shutting down`);
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  // Extra safety net: log and keep running rather than crashing the process
  // on a stray unhandled error, per the "don't crash on Telegram API failures" requirement.
  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled promise rejection", { reason: reason instanceof Error ? reason.stack : String(reason) });
  });
  process.on("uncaughtException", (err) => {
    logger.error("Uncaught exception", { err: err instanceof Error ? err.stack : String(err) });
  });
}

main().catch((err) => {
  logger.error("Fatal error during boot", { err: err instanceof Error ? err.stack : String(err) });
  process.exit(1);
});
