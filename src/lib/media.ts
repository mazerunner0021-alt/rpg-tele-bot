import { Readable } from "node:stream";
import type { Api } from "grammy";
import { logger } from "./logger";

export interface ProxiedFile {
  stream: Readable;
  contentType: string;
  contentLength: number | null;
}

/**
 * Resolves a Telegram file_id to its current download path and streams the
 * bytes straight through — the image is never written to disk or the
 * database, only proxied on request. Telegram's getFile download links
 * expire after roughly an hour, so this always resolves fresh rather than
 * caching the raw Telegram URL.
 */
export async function fetchTelegramFile(api: Api, fileId: string): Promise<ProxiedFile | undefined> {
  try {
    const file = await api.getFile(fileId);
    if (!file.file_path) return undefined;

    const url = `https://api.telegram.org/file/bot${api.token}/${file.file_path}`;
    const res = await fetch(url);
    if (!res.ok || !res.body) {
      logger.warn("Telegram file download failed", { fileId, status: res.status });
      return undefined;
    }

    const contentLength = res.headers.get("content-length");
    return {
      stream: Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
      contentType: extToMime(file.file_path.split(".").pop()?.toLowerCase()),
      contentLength: contentLength ? Number(contentLength) : null,
    };
  } catch (err) {
    logger.warn("Failed to resolve/fetch Telegram file", { fileId, err: String(err) });
    return undefined;
  }
}

function extToMime(ext: string | undefined): string {
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}
