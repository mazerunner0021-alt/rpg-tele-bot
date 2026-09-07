import type { Bot } from "grammy";
import type { MyContext } from "../bot/context";
import { getEnv } from "../config/env";
import { logger } from "../lib/logger";

/** Boot step: point Telegram's webhook at this deployment. No-ops with a warning if RENDER_EXTERNAL_URL isn't set (local dev). */
export async function registerWebhook(bot: Bot<MyContext>): Promise<void> {
  const env = getEnv();
  if (!env.RENDER_EXTERNAL_URL) {
    logger.warn(
      "RENDER_EXTERNAL_URL is not set — skipping setWebhook. Set it (e.g. to a tunnel URL) to receive updates, or use `npm run dev:poll` for local long polling instead."
    );
    return;
  }

  const url = `${env.RENDER_EXTERNAL_URL}/webhook/${env.WEBHOOK_SECRET}`;
  await bot.api.setWebhook(url, { secret_token: env.WEBHOOK_SECRET });
  logger.info("Webhook registered", { url });
}
