/**
 * All multi-step ("forced-reply") conversation flows are modeled as a single
 * discriminated union stored in session data, rather than global mutable
 * state. Session data is persisted to Postgres (see session.ts) so an
 * in-progress flow survives a Render restart/redeploy.
 */
export type Flow =
  | { kind: "propose_character_name" }
  | { kind: "propose_character_description"; name: string }
  | { kind: "propose_character_photo"; name: string; description: string }
  | { kind: "set_scene_description"; sceneId: string }
  | { kind: "set_scene_banner"; sceneId: string }
  | { kind: "new_scene_name" }
  | { kind: "assign_cast"; sceneId: string; characterId?: string; memberPage: number }
  | { kind: "await_account_pick"; purpose: "post" | "manage" }
  | { kind: "await_account_name"; purpose: "post" | "manage" }
  | { kind: "await_post_photo"; feedAccountId: string };

export interface SessionData {
  flow?: Flow;
  /** epoch ms the current flow was started; used to expire abandoned flows (see FLOW_TTL_MS in bot/flow.ts) */
  flowStartedAt?: number;
}

export function initialSession(): SessionData {
  return {};
}
