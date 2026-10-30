import { Agent } from "../../models/Agent";
import { jobNumbersEquivalent, normalizeJobNo } from "../bookings/bookingIdentity";
import { GranotSessionJobLinkError, retrieveGranotJobInUserSession } from "../granotHttpCollector/sessionJobLink";
import type { OutreachActor } from "./auth";
import { OutreachError } from "./errors";
import type { DeskReadDeps } from "./reads/common";
import { readOutreachDetail } from "./reads/detail";

export const GRANOT_SESSION_PILOT_AGENT = "6a1dc03e419f58fdad44944f";
type Deps = DeskReadDeps & {
  readDetail?: typeof readOutreachDetail;
  readUsername?: (agent: string) => Promise<string | null>;
  retrieve?: typeof retrieveGranotJobInUserSession;
};
const readUsername = async (id: string): Promise<string | null> => {
  const agent = await Agent.findById(id).select("granot_crm_username active").lean();
  return agent?.active ? agent.granot_crm_username?.trim() || null : null;
};

/** No cache or credential-user login. Both the Desk subject and Granot username must belong to the signed actor. */
export async function resolveOutreachGranotSessionLink(actor: OutreachActor, subjectId: string, context: string, deps: Deps) {
  if (actor.role !== "rep" || actor.agent_id !== GRANOT_SESSION_PILOT_AGENT) throw new OutreachError("FORBIDDEN");
  const readDetail = deps.readDetail ?? readOutreachDetail;
  const before = await readDetail(actor, subjectId, deps);
  const job = before.subject.job_no;
  if (!job || before.subject.job_pending) throw new OutreachError("INVALID_INPUT", [{ path: "granot_link", code: "job_pending" }]);
  const username = await (deps.readUsername ?? readUsername)(actor.agent_id);
  if (!username) throw new OutreachError("SERVICE_UNAVAILABLE", [{ path: "granot_link", code: "identity_unavailable" }]);
  try {
    const result = await (deps.retrieve ?? retrieveGranotJobInUserSession)(context, job, username);
    // Assignment/job changes during provider I/O must not return a stale authorized result.
    const after = await readDetail(actor, subjectId, deps);
    if (!after.subject.job_no || after.subject.job_pending || !jobNumbersEquivalent(normalizeJobNo(after.subject.job_no), normalizeJobNo(result.job_no))) throw new OutreachError("NOT_FOUND");
    return { ...result, account_verified: true as const, captured_at: deps.now.toISOString() };
  } catch (error) {
    if (error instanceof GranotSessionJobLinkError) throw new OutreachError("SERVICE_UNAVAILABLE", [{ path: "granot_link", code: error.reason }]);
    throw error;
  }
}
