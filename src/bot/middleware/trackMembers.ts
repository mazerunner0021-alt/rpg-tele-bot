import type { NextFunction } from "grammy";
import { getGroupIdCached } from "../../lib/scope";
import { trackGroupMember } from "../../lib/memberTracker";
import type { MyContext } from "../context";

/**
 * Runs on every update in a group. Builds the "known members" roster the
 * cast-assignment picker and @username shorthand resolution depend on,
 * since the Bot API has no endpoint to list all group members directly.
 */
export function trackMembersMiddleware() {
  return async (ctx: MyContext, next: NextFunction): Promise<void> => {
    const chat = ctx.chat;
    const user = ctx.from;
    if (chat && (chat.type === "group" || chat.type === "supergroup") && user) {
      const groupId = await getGroupIdCached(chat);
      await trackGroupMember(groupId, chat.id, user);
    }
    return next();
  };
}
