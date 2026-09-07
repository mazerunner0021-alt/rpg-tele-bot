import type { MyContext } from "./context";
import type { Flow } from "./sessionTypes";

/** Abandoned flows (user never finished replying) expire instead of trapping a random later message. */
export const FLOW_TTL_MS = 15 * 60 * 1000;

export function setFlow(ctx: MyContext, flow: Flow): void {
  ctx.session.flow = flow;
  ctx.session.flowStartedAt = Date.now();
}

export function clearFlow(ctx: MyContext): void {
  ctx.session.flow = undefined;
  ctx.session.flowStartedAt = undefined;
}

export function isFlowExpired(ctx: MyContext): boolean {
  const startedAt = ctx.session.flowStartedAt;
  return !startedAt || Date.now() - startedAt > FLOW_TTL_MS;
}
