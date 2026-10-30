import type { OutreachActor } from "./auth";

/** Owner-requested Josh pilot. Stable Agent identity, never a display-name or browser-supplied flag. */
export const GRANOT_LINK_PILOT_AGENT = "6a1dc03e419f58fdad44944f";
export function canUseGranotLinkPilot(actor: OutreachActor, receiver: string | null | undefined): boolean {
  return actor.role === "rep" && actor.agent_id === GRANOT_LINK_PILOT_AGENT && receiver === GRANOT_LINK_PILOT_AGENT;
}
