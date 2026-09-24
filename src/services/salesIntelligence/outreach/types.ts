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
 * Spec §7.2: the one precedence of assignment origins. An automatic assignment may replace only a
 * strictly lower rank; `owner` is never replaced automatically. A missing origin ranks 0.
 * Team 3 inserts `crm_receiver` (between `owner` and the conversation origins, E4) and
 * `ringcentral_answered` (above `first_attempts`, E5) here, and nowhere else.
 */
export const ASSIGNMENT_RANKS = Object.freeze({
  owner: 100,
  rep_promise: 40,
  first_conversation: 40,
  inherited_outreach: 30,
  first_attempts: 10,
} as const);
export type AssignmentOrigin = keyof typeof ASSIGNMENT_RANKS;
export function assignmentRank(origin: string | null | undefined): number {
  return origin && origin in ASSIGNMENT_RANKS ? ASSIGNMENT_RANKS[origin as AssignmentOrigin] : 0;
}
/** True when an automatic assignment with `next` origin may replace the record's current one. */
export function mayReplaceAssignment(current: { responsible_agent_id?: unknown; assignment?: { origin?: string | null } | null }, next: AssignmentOrigin): boolean {
  if (!current.responsible_agent_id) return current.assignment?.origin !== "owner";
  // An agent with no recorded origin is of unknown strength (legacy rows): never replaced automatically.
  if (!current.assignment?.origin) return false;
  return assignmentRank(next) > assignmentRank(current.assignment.origin);
}
