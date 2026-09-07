import { Composer } from "grammy";
import type { MyContext } from "../bot/context";
import { useFlowDispatcher } from "../bot/flowDispatcher";
import { registerSetupHandlers } from "./setup";
import { registerCastingHandlers } from "./casting";
import { registerSceneHandlers, registerCastShorthandHandler } from "./scenes";
import { registerRoleCommands, registerRoleCallbacks, registerRoleRepostHandler } from "./roles";
import { registerUtilityHandlers } from "./utility";

/**
 * Wires up every feature module in the one order that matters: commands and
 * callback queries are independent update types and can be registered in any
 * order relative to each other, but the three generic message:text handlers
 * (flow dispatcher, cast shorthand, role repost) MUST stay in this relative
 * order — each is a catch-all that would otherwise misinterpret input meant
 * for the next stage. See bot/flowDispatcher.ts for the detailed reasoning.
 */
export function registerAllHandlers(): Composer<MyContext> {
  const composer = new Composer<MyContext>();

  // Commands (self-contained; each only reacts to its own /command).
  registerSetupHandlers(composer);
  registerSceneHandlers(composer);
  registerRoleCommands(composer);
  registerUtilityHandlers(composer);

  // 1) Continue an in-progress forced-reply flow, if any.
  useFlowDispatcher(composer);
  // 2) Admin free-text cast shorthand ("Name: @user") in a CASTING-status scene topic.
  registerCastShorthandHandler(composer);
  // 3) Catch-all: delete-and-repost as the sender's active character, or log+passthrough.
  registerRoleRepostHandler(composer);

  // Callback queries (button presses) — distinct update type, order-independent.
  registerCastingHandlers(composer);
  registerRoleCallbacks(composer);

  return composer;
}
