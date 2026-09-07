import { run } from "@grammyjs/runner";
import { logger } from "./lib/logger";
import { createBot } from "./bot/bot";

/**
 * Local-development-only entrypoint using long polling via @grammyjs/runner,
 * so the bot can be exercised without a public URL/tunnel. Render always
 * runs src/index.ts in webhook mode — see README "Design decisions" for why
 * long polling and webhook mode aren't mixed in the same deployment.
 */
async function main(): Promise<void> {
  const bot = createBot();
  await bot.init();
  logger.info("Starting long polling (dev mode)", { username: bot.botInfo.username });

  // A webhook and long polling can't both be active for the same bot token.
  await bot.api.deleteWebhook({ drop_pending_updates: false });

  const runner = run(bot);

  const stop = (): void => {
    if (runner.isRunning()) {
      logger.info("Stopping long polling runner");
      void runner.stop();
    }
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((err) => {
  logger.error("Fatal error in dev-poll", { err: err instanceof Error ? err.stack : String(err) });
  process.exit(1);
});
