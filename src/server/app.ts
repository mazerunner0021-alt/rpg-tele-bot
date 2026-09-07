import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { webhookCallback, type Bot } from "grammy";
import type { MyContext } from "../bot/context";
import { getEnv } from "../config/env";
import { logger } from "../lib/logger";

/**
 * Express app exposing:
 *   GET  /health            — 200 OK, for Render/external keep-warm pings
 *   POST /webhook/:secret   — Telegram update delivery
 *
 * The webhook is validated twice, as required: the :secret path segment is
 * checked manually before grammY ever sees the request, and grammY's own
 * `secretToken` option additionally validates the X-Telegram-Bot-Api-Secret-Token
 * header (returning 401 on mismatch).
 */
export function createApp(bot: Bot<MyContext>): Express {
  const env = getEnv();
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.status(200).send("OK");
  });

  const handleUpdate = webhookCallback(bot, "express", { secretToken: env.WEBHOOK_SECRET });

  app.post("/webhook/:secret", (req: Request, res: Response, next: NextFunction) => {
    if (req.params.secret !== env.WEBHOOK_SECRET) {
      logger.warn("Rejected webhook request with an invalid path secret");
      res.sendStatus(404);
      return;
    }
    handleUpdate(req, res).catch(next);
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    logger.error("Unhandled error in HTTP layer", { err: err instanceof Error ? err.stack : String(err) });
    if (!res.headersSent) res.sendStatus(500);
  });

  return app;
}
