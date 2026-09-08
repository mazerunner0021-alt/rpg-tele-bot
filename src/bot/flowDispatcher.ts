import type { Composer, NextFunction } from "grammy";
import type { MyContext } from "./context";
import { clearFlow, isFlowExpired } from "./flow";
import { continueCastingFlow } from "../handlers/casting";
import { continueSceneFlow } from "../handlers/scenes";
import { continueFeedFlow } from "../handlers/feed";

const CASTING_KINDS = new Set(["propose_character_name", "propose_character_description", "propose_character_photo"]);
const SCENE_KINDS = new Set(["set_scene_description", "set_scene_banner", "new_scene_name", "assign_cast"]);
const FEED_KINDS = new Set(["await_post_photo"]);

/**
 * Routes the next text/photo message to whichever feature module owns the
 * user's in-progress forced-reply flow. Registered once, early in the
 * pipeline, ahead of the cast-shorthand and role-repost catch-alls — so a
 * reply that's part of a flow is never misread as scene dialogue.
 *
 * Command messages ("/...") are explicitly left alone here so they always
 * reach their command handler even mid-flow (e.g. /cancel, /roll).
 */
export function createFlowDispatcher() {
  return async (ctx: MyContext, next: NextFunction): Promise<void> => {
    const flow = ctx.session.flow;
    if (!flow) return next();

    const text = ctx.message?.text;
    const hasPhoto = Boolean(ctx.message?.photo?.length);
    if (!ctx.message || (!text && !hasPhoto)) return next();
    if (text?.startsWith("/")) return next();

    if (isFlowExpired(ctx)) {
      clearFlow(ctx);
      return next();
    }

    if (CASTING_KINDS.has(flow.kind)) {
      const handled = await continueCastingFlow(ctx, flow);
      if (handled) return;
      return next();
    }

    if (SCENE_KINDS.has(flow.kind)) {
      const handled = await continueSceneFlow(ctx, flow);
      if (handled) return;
      return next();
    }

    if (FEED_KINDS.has(flow.kind)) {
      const handled = await continueFeedFlow(ctx, flow);
      if (handled) return;
      return next();
    }

    return next();
  };
}

export function useFlowDispatcher(composer: Composer<MyContext>): void {
  composer.use(createFlowDispatcher());
}
