import type { OutreachActor } from "./auth";

/** Job navigation follows Desk read scope: coordinators, own assignment, or freshly eligible shared Pool. */
export function canOpenGranotLink(actor: OutreachActor, receiver: string | null | undefined, sharedPool = false): boolean {
  if (actor.role === "owner" || actor.role === "manager") return true;
  return actor.role === "rep" && Boolean(actor.agent_id) && (receiver === actor.agent_id || sharedPool);
}
