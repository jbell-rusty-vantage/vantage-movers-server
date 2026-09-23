import mongoose from "mongoose";
import { csiDataset, csiFlag, type CsiErrorCode } from "../../../config/domain/salesIntelligence";
import { getIntelligenceRunModel } from "../../../models/IntelligenceRun";
import { getContactNumberModel } from "../../../models/ContactNumber";
import { getLeadConversationModel } from "../../../models/LeadConversation";
import { getSalesIntelligenceAuditEventModel } from "../../../models/SalesIntelligenceAuditEvent";
import type { OutreachSuggestedNextStepDto } from "../dto";
import { payloadHash } from "../transactions";
import type { RecordRow } from "./types";

type FollowupLite = { _id: unknown; status: string };

/**
 * S1-SUGGEST (final spec §5.5 case 2, §18 row `next_step_suggestion`). The card's line 6 is, in order:
 * (1) the open follow-up, (2) `Suggested: {description}` + `Apply` when the newest analysis suggestion
 * is not applied, (3) `No next step set`, (4) `Closed · {outcome}`. The server decides case 2 here and
 * serves `outreach.suggested_next_step` only when it holds at `as_of`; the Admin never decides.
 *
 * Reads are batched per publish page (never per row): one aggregation for the newest completed run per
 * Number (the `newest_run_id` rule on `csi_run_number`, projecting only the suggestion), then in parallel
 * one `$in` of `analysis.suggestion_applied` audit rows, one `$in` of the conversations' published run
 * pointers and one `$in` of the Numbers' published run pointer / purge flag (the fence `apply_suggestion`
 * enforces). Only candidate records (open, no open next action, a Number) enter the reads.
 */

/** Same words as `assessment/presentation.ts` `SUGGESTION_ACTION_LABELS` (§11.3 col 2); `suggestion.test.ts` pins equality with `runPresentation`. */
const SUGGESTION_ACTION_LABELS: Record<string, string> = { call: "Call", text_customer_via_lead_message: "Text via Lead Message", send_estimate: "Send estimate",
  check_availability: "Check availability", review: "Review", wait: "Wait for the customer", reconcile_identity: "Reconcile identity", other: "Other" };
const words = (value: string) => { const text = value.replace(/_/g, " ").trim(); return text ? text[0]!.toUpperCase() + text.slice(1) : value; };
export const suggestionActionLabel = (kind: string) => SUGGESTION_ACTION_LABELS[kind] ?? words(kind);

export type NextStepSuggestion = { action_kind: string; description: string; date_text: string | null; timezone_text?: string | null; target_followup_id?: string | null };
/** The newest completed run of a Number with only what case 2 and the Apply fence need. */
export type SuggestionRun = { _id: unknown; revision: number; subject_key: string; contact_number_id: unknown; conversation_id?: unknown; outreach_record_id?: unknown;
  suggestion: NextStepSuggestion | null };
export type SuggestionSide = {
  /** Newest completed, unpurged run per Number id (string). */
  runs: ReadonlyMap<string, SuggestionRun>;
  /** Run ids with an `analysis.suggestion_applied` audit row. */
  applied: ReadonlySet<string>;
  /** Run ids that are the published pointer `apply_suggestion` fences on (conversation `latest_completed_run_id` / Number `running_summary.run_id`). */
  current: ReadonlySet<string>;
  /** Number ids whose content purge is pending: no model text is shown (the run read's own guard). */
  purgePending: ReadonlySet<string>;
};
export const EMPTY_SUGGESTION_SIDE: SuggestionSide = { runs: new Map(), applied: new Set(), current: new Set(), purgePending: new Set() };

type SuggestionRecord = Pick<RecordRow, "_id" | "state" | "subject" | "primary_contact_number_id" | "revision"> & { next_action?: { followup_id?: unknown } | null };

/** The Number whose newest run feeds the card: the primary Number, else the Number-review subject (same as `readOutreach`'s `newest_run_id`). */
export function suggestionNumberId(record: Pick<RecordRow, "subject" | "primary_contact_number_id">): string | null {
  const id = record.primary_contact_number_id ?? (record.subject.kind === "number_review" ? record.subject.contact_number_id : null);
  return id ? String(id) : null;
}

const hasOpenNextAction = (record: SuggestionRecord, followups: readonly FollowupLite[]) => {
  const id = record.next_action?.followup_id;
  return id != null && followups.some(row => String(row._id) === String(id) && row.status === "open");
};

/** Case 1 and case 4 exclusions that need no read: a record that can never show case 2 does not enter the batched reads. */
export function isSuggestionCandidate(record: SuggestionRecord, followups: readonly FollowupLite[]): boolean {
  return record.state !== "closed" && !hasOpenNextAction(record, followups) && suggestionNumberId(record) !== null;
}

/** `apply_suggestion` creates the follow-up on the run's record, or on the Number-review record when the run names none. */
const runTargetsRecord = (run: SuggestionRun, record: SuggestionRecord) => run.outreach_record_id
  ? String(run.outreach_record_id) === String(record._id)
  : record.subject.kind === "number_review" && String(record.subject.contact_number_id) === String(run.contact_number_id);

/**
 * Case 2 at `as_of`, pure. Null for: closed record (case 4), an open `next_action` follow-up (case 1), no Number, no
 * completed run, a newest run without `next_step_suggestion`, an applied suggestion, a pending content purge, or a run
 * whose Apply would land on another record. `apply.enabled` mirrors the preconditions `apply_suggestion` enforces:
 * the feature flags, the published-pointer fence (`REVISION_CONFLICT`), and `create_followup`'s disposition guards
 * (`dispositionBlockers`, the same codes `toOutreachDto` puts on `create_followup`).
 */
export function suggestedNextStep(input: { record: SuggestionRecord; followups: readonly FollowupLite[]; side: SuggestionSide;
  dispositionBlockers: readonly CsiErrorCode[]; featureEnabled?: boolean }): OutreachSuggestedNextStepDto | null {
  const { record, side } = input;
  if (!isSuggestionCandidate(record, input.followups)) return null;
  const numberId = suggestionNumberId(record)!;
  const run = side.runs.get(numberId);
  if (!run?.suggestion || side.purgePending.has(numberId)) return null;
  const runId = String(run._id);
  if (side.applied.has(runId) || !runTargetsRecord(run, record)) return null;
  const featureEnabled = input.featureEnabled ?? (csiFlag("ENABLED") && csiFlag("OUTREACH_ENSURE"));
  const blockers: CsiErrorCode[] = [...(featureEnabled ? [] : ["FEATURE_DISABLED" as const]), ...(side.current.has(runId) ? [] : ["REVISION_CONFLICT" as const]),
    ...input.dispositionBlockers];
  const suggestion = run.suggestion;
  return { run_id: runId, action_kind: suggestion.action_kind, action_label: suggestionActionLabel(suggestion.action_kind),
    // Same text as `runPresentation`'s `suggested_next_step.description` (S3-PRES passes it as stored).
    description: suggestion.description, date_text: suggestion.date_text ?? null, timezone_text: suggestion.timezone_text ?? null,
    apply: { action: "apply_suggestion", target_id: runId, expected_revision: run.revision, enabled: blockers.length === 0, blocker_codes: [...new Set(blockers)],
      suggestion_output_digest: payloadHash(suggestion), outreach_id: String(record._id), outreach_expected_revision: record.revision } };
}

/** The four batched reads, injectable so the unit test can count them. */
export type SuggestionStore = {
  newestRuns(numberIds: readonly mongoose.Types.ObjectId[]): Promise<SuggestionRun[]>;
  appliedRunIds(runs: readonly Pick<SuggestionRun, "_id" | "subject_key">[]): Promise<string[]>;
  conversationPointers(conversationIds: readonly unknown[]): Promise<{ _id: unknown; latest_completed_run_id?: unknown }[]>;
  numberPointers(numberIds: readonly unknown[]): Promise<{ _id: unknown; running_summary?: { run_id?: unknown } | null; content_purge_pending?: boolean | null }[]>;
};

const oid = (value: unknown) => (value instanceof mongoose.Types.ObjectId ? value : new mongoose.Types.ObjectId(String(value)));

export const mongoSuggestionStore: SuggestionStore = {
  // `newest_run_id` rule (`reads.ts` `newestCompletedRun`): completed, dataset, output, unpurged; newest by createdAt then _id.
  // The $match + leading sort keys ride `csi_run_number` {contact_number_id, createdAt:-1}; the projection keeps the
  // sorted working set to a few small fields per run (no output body, no step artifacts).
  newestRuns: async numberIds => (numberIds.length ? getIntelligenceRunModel().aggregate<SuggestionRun>([
    { $match: { contact_number_id: { $in: [...numberIds] }, status: "completed", ...csiDataset(), output: { $ne: null }, purged_at: null, purge_started_at: null } },
    { $sort: { contact_number_id: 1, createdAt: -1, _id: -1 } },
    { $group: { _id: "$contact_number_id", run_id: { $first: "$_id" }, revision: { $first: "$revision" }, subject_key: { $first: "$subject_key" },
      conversation_id: { $first: "$conversation_id" }, outreach_record_id: { $first: "$outreach_record_id" }, suggestion: { $first: "$output.next_step_suggestion" } } },
    { $project: { _id: "$run_id", contact_number_id: "$_id", revision: 1, subject_key: 1, conversation_id: 1, outreach_record_id: 1, suggestion: { $ifNull: ["$suggestion", null] } } },
  ]) : []),
  // Same row `readRunPresentation`'s `appliedSuggestion` reads, for every candidate run at once (`csi_audit_subject`).
  appliedRunIds: async runs => {
    if (!runs.length) return [];
    const rows = await getSalesIntelligenceAuditEventModel().find({ subject_key: { $in: [...new Set(runs.map(run => run.subject_key))] }, event_kind: "analysis.suggestion_applied",
      "invalidation.target_id": { $in: runs.map(run => String(run._id)) } }).select({ "invalidation.target_id": 1 }).lean();
    return rows.map(row => String(row.invalidation.target_id));
  },
  conversationPointers: async ids => (ids.length ? getLeadConversationModel().find({ _id: { $in: ids.map(oid) } }).select({ latest_completed_run_id: 1 }).lean() : []),
  numberPointers: async ids => (ids.length ? getContactNumberModel().find({ _id: { $in: ids.map(oid) } }).select({ "running_summary.run_id": 1, content_purge_pending: 1 }).lean() : []),
};

/**
 * Case-2 side data for a page. `followupsOf` gives each record's follow-ups (the page's `inputs`); records that cannot
 * show case 2 are skipped before any read, and an empty candidate set costs no read at all.
 */
export async function loadSuggestionSide(records: readonly SuggestionRecord[], followupsOf: (record: SuggestionRecord) => readonly FollowupLite[],
  store: SuggestionStore = mongoSuggestionStore): Promise<SuggestionSide> {
  const numberIds = [...new Set(records.filter(record => isSuggestionCandidate(record, followupsOf(record))).map(record => suggestionNumberId(record)!))];
  if (!numberIds.length) return EMPTY_SUGGESTION_SIDE;
  const found = (await store.newestRuns(numberIds.map(oid))).filter(run => run.suggestion);
  if (!found.length) return EMPTY_SUGGESTION_SIDE;
  const conversationIds = [...new Set(found.flatMap(run => (run.conversation_id ? [String(run.conversation_id)] : [])))];
  const [applied, conversations, numbers] = await Promise.all([store.appliedRunIds(found), store.conversationPointers(conversationIds),
    store.numberPointers([...new Set(found.map(run => String(run.contact_number_id)))])]);
  const conversationPointer = new Map(conversations.map(row => [String(row._id), row.latest_completed_run_id ? String(row.latest_completed_run_id) : null]));
  const numberPointer = new Map(numbers.map(row => [String(row._id), row.running_summary?.run_id ? String(row.running_summary.run_id) : null]));
  const current = new Set(found.filter(run => (run.conversation_id ? conversationPointer.get(String(run.conversation_id)) : numberPointer.get(String(run.contact_number_id))) === String(run._id))
    .map(run => String(run._id)));
  return { runs: new Map(found.map(run => [String(run.contact_number_id), run])), applied: new Set(applied), current,
    purgePending: new Set(numbers.filter(row => row.content_purge_pending).map(row => String(row._id))) };
}
