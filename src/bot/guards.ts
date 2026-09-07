import { isGroupAdmin } from "../lib/adminCheck";
import { currentThreadId } from "../lib/scope";
import { replyEphemeral } from "../lib/ephemeral";
import type { MyContext } from "./context";

/** Returns whether the sender is a group admin. Replies with a refusal (in the current topic) and returns false otherwise. */
export async function requireGroupAdmin(ctx: MyContext): Promise<boolean> {
  if (!ctx.chat || !ctx.from) return false;

  const ok = await isGroupAdmin(ctx.api, ctx.chat.id, ctx.from.id);
  if (!ok) {
    await replyEphemeral(ctx, "Only group admins can do that.", {
      message_thread_id: currentThreadId(ctx) || undefined,
    });
  }
  return ok;
}

/** Same check for callback-query-triggered actions, surfaced as a toast alert instead of a chat message. */
export async function requireGroupAdminCallback(ctx: MyContext): Promise<boolean> {
  if (!ctx.chat || !ctx.from) return false;

  const ok = await isGroupAdmin(ctx.api, ctx.chat.id, ctx.from.id);
  if (!ok) {
    await ctx.answerCallbackQuery({ text: "Only group admins can do that.", show_alert: true });
  }
  return ok;
}

export function requireGroupChat(ctx: MyContext): boolean {
  return ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
}
