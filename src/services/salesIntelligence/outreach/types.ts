import type { InferSchemaType, HydratedDocument, Types } from "mongoose";
import type { OutreachRecordSchema, OutreachFollowupSchema } from "../../../models/salesIntelligence/outreach";
import type { CallInteractionSchema } from "../../../models/CallInteraction";
import { csiFlag } from "../../../config/domain/salesIntelligence";
export type RecordRow = InferSchemaType<typeof OutreachRecordSchema> & { _id: Types.ObjectId };
export type FollowupRow = InferSchemaType<typeof OutreachFollowupSchema> & { _id: Types.ObjectId; createdAt?: Date };
export type RecordDocument = HydratedDocument<RecordRow>;
export type FollowupDocument = HydratedDocument<FollowupRow>;
export type InteractionRow = InferSchemaType<typeof CallInteractionSchema> & { _id: Types.ObjectId };
export function subjectKey(subject: RecordRow["subject"]): string {
  return subject.kind === "lead" ? `lead:${subject.model}:${subject.id}` : `number:${subject.contact_number_id}`;
}

/** Team 4 §5.4/§7.3: the record fields written at ensure time and read from the row (no query in the Attention walk). */
export const CONTACT_FACT_FIELDS = ["last_inbound_human_at", "last_attributable_outbound_at", "prior_contact_at", "last_activity_at"] as const;

/** AC3–AC5: band semantics, completion quality, progress default, first attempts, last activity. Default off. */
export const attentionEvolutionEnabled = () => csiFlag("ATTENTION_EVOLUTION");
/** AC6-PLAN: the Move assessment re-plan on accepted progress to Quoted (needs MOVE_ASSESSMENT too). Default off. */
export const progressPlanEnabled = () => csiFlag("PROGRESS_PLAN");
/**
 * S10 step 6 (`scripts/dev_ops/reensure-outreach.ts --no-progress-plan`): a process-level override that
 * suppresses the AC6-PLAN re-plan nomination and hands the record id to the suppressor instead, so the
 * lap can count what it would have nominated. Null (the default, and every server process) changes nothing.
 */
let progressPlanSuppressor: ((recordId: string) => void) | null = null;
export function setProgressPlanSuppressor(suppressor: ((recordId: string) => void) | null) { progressPlanSuppressor = suppressor; }
export function progressPlanSuppressed(recordId: string): boolean {
  if (!progressPlanSuppressor) return false;
  progressPlanSuppressor(recordId);
  return true;
}

/**
 * Spec §7.2: the one precedence of assignment origins. An automatic assignment may replace only a
 * strictly lower rank; `owner` is never replaced automatically. A missing origin ranks 0.
 *
 * S6-AGENT (assignment addendum E4/E5, DECISIONS 2026-09-24 "Team 4 hooks for Team 3"): the two
 * Team 3 rows are inserted here and nowhere else.
 * - `crm_receiver` 60: the Outreach rep follows the Lead's `receiver_agent` (Owner > receiver_agent >
 *   first conversation / rep promise).
 * - `ringcentral_answered` 20: not an origin of its own. It is the rank of a `crm_receiver`
 *   assignment whose receiver came from the weakest source, `ringcentral_answered` (E5: the one
 *   reviewed rep who answered a Call Lead's creating call). It outranks only `first_attempts`, so
 *   phone evidence (`first_conversation`, `rep_promise`) and `inherited_outreach` are never displaced
 *   by it, and it never blocks them (see `receiverBlocksPhoneEvidence`).
 */
export const ASSIGNMENT_RANKS = Object.freeze({
  owner: 100,
  crm_receiver: 60,
  rep_promise: 40,
  first_conversation: 40,
  inherited_outreach: 30,
  ringcentral_answered: 20,
  first_attempts: 10,
} as const);
/** A key of the precedence table: an assignment origin, or the `ringcentral_answered` receiver rank. */
export type AssignmentOrigin = keyof typeof ASSIGNMENT_RANKS;
/** The Lead receiver source whose `crm_receiver` assignment ranks as `ringcentral_answered` (E5). */
export const WEAKEST_RECEIVER_SOURCE = "ringcentral_answered";
/** The rank key of a `crm_receiver` assignment backed by this `receiver_agent_source`. */
export const receiverRankKey = (source: string | null | undefined): "crm_receiver" | "ringcentral_answered" =>
  source === WEAKEST_RECEIVER_SOURCE ? "ringcentral_answered" : "crm_receiver";
export function assignmentRank(origin: string | null | undefined, receiverSource?: string | null): number {
  const key = origin === "crm_receiver" ? receiverRankKey(receiverSource) : origin;
  return key && key in ASSIGNMENT_RANKS ? ASSIGNMENT_RANKS[key as AssignmentOrigin] : 0;
}
/** True when an automatic assignment with `next` origin may replace the record's current one. */
export function mayReplaceAssignment(current: { responsible_agent_id?: unknown; assignment?: { origin?: string | null; receiver_source?: string | null } | null }, next: AssignmentOrigin): boolean {
  if (!current.responsible_agent_id) return current.assignment?.origin !== "owner";
  // An agent with no recorded origin is of unknown strength (legacy rows): never replaced automatically.
  if (!current.assignment?.origin) return false;
  return assignmentRank(next) > assignmentRank(current.assignment.origin, current.assignment.receiver_source);
}
/** S6-AGENT: the Outreach `crm_receiver` assignment (§3.2), default off. */
export const receiverAssignmentEnabled = () => csiFlag("RECEIVER_ASSIGNMENT");
/**
 * E4 (flag on): `first_conversation` / `rep_promise` responsibility is set only when the Lead has no
 * `receiver_agent` that outranks the phone evidence. A `ringcentral_answered` receiver (rank 20) never
 * blocks it; every other source does. Flag off: never blocks (today's rule).
 */
export function receiverBlocksPhoneEvidence(lead: object | null | undefined, next: "first_conversation" | "rep_promise"): boolean {
  const row = lead as { receiver_agent?: unknown; receiver_agent_source?: string | null } | null | undefined;
  if (!receiverAssignmentEnabled() || !row?.receiver_agent) return false;
  return ASSIGNMENT_RANKS[receiverRankKey(row.receiver_agent_source)] >= ASSIGNMENT_RANKS[next];
}
