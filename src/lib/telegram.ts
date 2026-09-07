import type { Api } from "grammy";
import { logger } from "./logger";

/** Runs a Telegram API call, logging and swallowing failures instead of throwing. */
export async function safeCall<T>(
  label: string,
  fn: () => Promise<T>,
  meta?: Record<string, unknown>
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    logger.warn(`Telegram API call failed: ${label}`, {
      ...meta,
      err: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

/**
 * Deletes a message, returning whether it succeeded. The boolean return
 * matters: callers use it to decide whether to fall back to "send the
 * reformatted message without deleting the original" so content is never
 * silently dropped.
 */
export async function safeDeleteMessage(api: Api, chatId: number, messageId: number): Promise<boolean> {
  const result = await safeCall(
    "deleteMessage",
    () => api.deleteMessage(chatId, messageId),
    { chatId, messageId }
  );
  return result === true;
}

export async function safePinMessage(
  api: Api,
  chatId: number,
  messageId: number,
  disableNotification = true
): Promise<void> {
  await safeCall(
    "pinChatMessage",
    () => api.pinChatMessage(chatId, messageId, { disable_notification: disableNotification }),
    { chatId, messageId }
  );
}
