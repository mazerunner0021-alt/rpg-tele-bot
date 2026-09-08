import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { webhookCallback, type Bot } from "grammy";
import type { MyContext } from "../bot/context";
import { getEnv } from "../config/env";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { fetchTelegramFile } from "../lib/media";
import { renderPostPage, renderNotFoundPage } from "./miniapp";

/**
 * Express app exposing:
 *   GET  /health              — 200 OK, for Render/external keep-warm pings
 *   POST /webhook/:secret     — Telegram update delivery
 *   GET  /media/:fileId       — proxies a Telegram file_id's bytes; never stored
 *   GET  /app/post/:postId    — the Mini App "view as post" page
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

  // Proxies the image bytes on every request rather than storing them —
  // Telegram's own getFile link expires after ~1 hour, so this always
  // resolves fresh. See README "Design decisions".
  app.get("/media/:fileId", async (req: Request, res: Response) => {
    const fileId = req.params.fileId;
    if (!fileId) {
      res.sendStatus(400);
      return;
    }
    const file = await fetchTelegramFile(bot.api, fileId);
    if (!file) {
      res.sendStatus(404);
      return;
    }
    res.setHeader("Content-Type", file.contentType);
    if (file.contentLength !== null) res.setHeader("Content-Length", String(file.contentLength));
    res.setHeader("Cache-Control", "public, max-age=3600");
    file.stream.on("error", (err) => {
      logger.warn("Error streaming media", { err: String(err) });
      if (!res.headersSent) res.sendStatus(502);
      else res.end();
    });
    file.stream.pipe(res);
  });

  // Server-rendered Mini App page for one Post — no build step, no client
  // fetch round-trip; data is queried and embedded directly.
  app.get("/app/post/:postId", async (req: Request, res: Response) => {
    const post = await prisma.post.findUnique({
      where: { id: req.params.postId },
      include: {
        feedAccount: true,
        comments: { orderBy: { createdAt: "asc" }, include: { feedAccount: true } },
        _count: { select: { reactions: true } },
      },
    });

    if (!post) {
      res.status(404).type("html").send(renderNotFoundPage());
      return;
    }

    res.type("html").send(
      renderPostPage({
        accountName: post.feedAccount.name,
        photoUrl: `/media/${post.fileId}`,
        caption: post.caption,
        likeCount: post._count.reactions,
        createdAt: post.createdAt,
        comments: post.comments.map((c) => ({
          accountName: c.feedAccount.name,
          text: c.text,
          createdAt: c.createdAt,
        })),
      })
    );
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    logger.error("Unhandled error in HTTP layer", { err: err instanceof Error ? err.stack : String(err) });
    if (!res.headersSent) res.sendStatus(500);
  });

  return app;
}
