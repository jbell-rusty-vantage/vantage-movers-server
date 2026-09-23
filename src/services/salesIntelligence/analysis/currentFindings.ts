import mongoose from "mongoose";
import { z } from "zod";
import { csiDataset } from "../../../config/domain/salesIntelligence";
import { getIntelligenceEffectModel } from "../../../models/IntelligenceEffect";
import { getIntelligenceFindingModel } from "../../../models/IntelligenceFinding";
import { getIntelligenceRunModel } from "../../../models/IntelligenceRun";
import { getLeadConversationModel } from "../../../models/LeadConversation";
import { getSalesIntelligenceReviewItemModel } from "../../../models/SalesIntelligenceReviewItem";
import { intelligenceFindingSchema, type IntelligenceEvidenceRef } from "../../../validation/intelligence/intelligenceEnvelope.validation";
import { csiActionAvailabilitySchema, csiDateSchema, csiIdSchema } from "../../../validation/v1/salesIntelligence";
import { ownerRead } from "../../numberActivity/coverage";
import { ownerReadSchema, type CoverageDto } from "../dto";
import { subjectKey } from "../outreach/types";
import { evidenceItemDtoSchema, FINDING_CATEGORIES, WORK_RESULTS, type EvidenceRefDto, type FindingCategory } from "../assessment/dto";
import {
  actionStatusWord, envelopeEvidenceRef, evidenceSection, FINDING_CATEGORY_LABELS, findingCategory, findingSourceWord, findingValueLine, findingWorkResult,
  type ConversationRow, type EffectRow, type FindingRow, type FollowupLite, type ReviewItemRow, type RunRow, type SnapshotRow, type TranscriptRow,
} from "../assessment/presentation";
import { mongoAssessmentStore, type RecordLite } from "../assessment/reads";

/**
 * S3-FINDINGS: the Findings section's read (data spec §6.11 A, final spec §11.5, RD3).
 *
 * `GET /outreach/:id/findings` serves the **current findings** of the record's Number: for each
 * Lead Conversation, the findings of its `latest_completed_run_id`, without superseded findings
 * unless asked; retracted findings stay listed. A Number run's findings (a synthesis that never
 * owns effects) and an older run's findings are not current and are never served here.
 *
 * GET-only and pure over a `CurrentFindingsStore`. The query shape is fixed (no per-finding,
 * per-conversation or per-citation read): record, Number retention, conversations; findings + runs;
 * effects + review items + cited snapshots; follow-ups + source transcripts. Every presented
 * field comes from the S3-PRES functions in `assessment/presentation.ts`, never a second copy.
 */
export const CURRENT_FINDINGS_CONVERSATION_LIMIT = 200;
export const CURRENT_FINDINGS_REASONS = ["no_number", "retention_pending"] as const;
/** The finding review commands the section offers (final spec §11.5: `Confirm`, `Correct`, `Retract` under `More`). */
export const FINDING_REVIEW_ACTIONS = ["confirm_finding", "correct_finding", "retract_finding"] as const;

export const currentFindingsQuerySchema = z.object({
  scope: z.literal("production").optional(),
  include_superseded: z.enum(["true", "false"]).optional(),
}).strict();
export type CurrentFindingsQuery = z.infer<typeof currentFindingsQuerySchema>;

export const currentFindingItemDtoSchema = z.object({
  id: csiIdSchema, run_id: csiIdSchema, conversation_id: csiIdSchema,
  /** `LeadConversation.started_at` of the call the finding came from. */
  call_at: csiDateSchema.nullable(),
  kind: z.string(),
  /** Final spec §11.5 category; null only for a kind outside the server's 16-value enum. */
  category: z.enum(FINDING_CATEGORIES).nullable(), category_label: z.string().nullable(),
  claim: z.string(), source_word: z.string(), action_status_word: z.string().nullable(),
  clarity: z.enum(["clear", "uncertain"]), value_line: z.string().nullable(),
  work_result: z.enum(WORK_RESULTS), work_result_detail: z.string().nullable(),
  review_state: z.enum(["unreviewed", "confirmed", "corrected", "retracted"]),
  superseded_by: csiIdSchema.nullable(),
  /** The finding's citations resolved as on the run presentation (`GET /analysis-runs/:id/presentation` `evidence.items`). */
  evidence: z.array(evidenceItemDtoSchema),
  allowed_actions: z.array(csiActionAvailabilitySchema),
}).strict();
export type CurrentFindingItemDto = z.infer<typeof currentFindingItemDtoSchema>;
export const currentFindingsDataSchema = z.object({
  items: z.array(currentFindingItemDtoSchema),
  /** Why the list is empty without being "no findings": no Number on the record, or its content purge is in progress. */
  reason: z.enum(CURRENT_FINDINGS_REASONS).nullable(),
  /** More than `CURRENT_FINDINGS_CONVERSATION_LIMIT` analysed conversations: only the newest are read. */
  truncated: z.boolean(),
}).strict();
export type CurrentFindingsData = z.infer<typeof currentFindingsDataSchema>;
/** The whole response, `ownerRead`-shaped; contract fixtures validate against this. */
export const currentFindingsResponseSchema = ownerReadSchema(currentFindingsDataSchema);

export type CurrentConversationRow = { _id: unknown; latest_completed_run_id: unknown; started_at?: Date | null };
/** Only the run fields the presentation needs: availability, open targets, subject and editability. */
export type CurrentRunRow = Pick<RunRow, "_id" | "conversation_id" | "contact_number_id" | "status" | "purged_at" | "purge_started_at" | "manifest_snapshot_ids" | "step_artifacts" | "subject_key">
  & { output?: { schema_version?: unknown } | null };
export type CurrentFindingsStore = {
  record(id: string): Promise<RecordLite | null>;
  purgePending(numberId: string): Promise<boolean>;
  /** Analysed, unpurged conversations of the Number, newest first, at most `limit` (`lead_conversation_number_started`). */
  conversations(numberId: string, limit: number): Promise<CurrentConversationRow[]>;
  /** Unpurged findings of exactly these (conversation, run) pairs (`csi_finding_conversation`). */
  findings(pairs: ReadonlyArray<{ conversation_id: string; run_id: string }>, includeSuperseded: boolean): Promise<FindingRow[]>;
  runs(ids: readonly string[]): Promise<CurrentRunRow[]>;
  effects(runIds: readonly string[], findingIds: readonly string[]): Promise<EffectRow[]>;
  /** Open review items on these subjects whose `evidence_ids` name any of the findings. */
  reviewItems(subjectKeys: readonly string[], findingIds: readonly string[]): Promise<ReviewItemRow[]>;
  snapshots(ids: readonly string[]): Promise<SnapshotRow[]>;
  followups(ids: readonly string[]): Promise<FollowupLite[]>;
  transcripts(ids: readonly string[], segmentIds: readonly number[]): Promise<TranscriptRow[]>;
};

const REVIEW_ITEM_LIMIT = 500;
const validIds = (values: readonly string[]) => [...new Set(values)].filter(value => csiIdSchema.safeParse(value).success);
export const mongoCurrentFindingsStore: CurrentFindingsStore = {
  record: mongoAssessmentStore.record,
  purgePending: mongoAssessmentStore.purgePending,
  conversations: (numberId, limit) => getLeadConversationModel().find({ contact_number_id: numberId, latest_completed_run_id: { $ne: null }, content_purged_at: null })
    .sort({ started_at: -1, _id: -1 }).limit(limit).select("_id latest_completed_run_id started_at").lean() as Promise<CurrentConversationRow[]>,
  findings: async (pairs, includeSuperseded) => (pairs.length ? getIntelligenceFindingModel().find({
    $or: pairs.map(pair => ({ conversation_id: pair.conversation_id, run_id: pair.run_id })), purged_at: null,
    ...(includeSuperseded ? {} : { superseded_by: null }) }).lean() as Promise<FindingRow[]> : []),
  runs: async list => (validIds(list).length ? getIntelligenceRunModel().find({ _id: { $in: validIds(list) }, ...csiDataset() })
    .select("_id conversation_id contact_number_id status purged_at purge_started_at manifest_snapshot_ids step_artifacts.summaries subject_key output.schema_version")
    .lean() as Promise<CurrentRunRow[]> : []),
  effects: async (runIds, findingIds) => (validIds(runIds).length && validIds(findingIds).length ? getIntelligenceEffectModel()
    .find({ run_id: { $in: validIds(runIds) }, finding_id: { $in: validIds(findingIds) } }).sort({ _id: 1 })
    .select("_id finding_id effect_kind status reason target_id").lean() as Promise<EffectRow[]> : []),
  reviewItems: async (subjectKeys, findingIds) => (subjectKeys.length && validIds(findingIds).length ? getSalesIntelligenceReviewItemModel()
    .find({ subject_key: { $in: [...new Set(subjectKeys)] }, state: "open", evidence_ids: { $in: validIds(findingIds).map(id => new mongoose.Types.ObjectId(id)) } })
    .select("_id cause_kind cause_key state evidence_ids").limit(REVIEW_ITEM_LIMIT).lean() as Promise<ReviewItemRow[]> : []),
  snapshots: mongoAssessmentStore.snapshots,
  followups: mongoAssessmentStore.followups,
  transcripts: mongoAssessmentStore.transcripts,
};

export type CurrentFindingsDeps = { store?: CurrentFindingsStore; coverage?: () => Promise<CoverageDto> };

const FOLLOWUP_EFFECTS = ["create_followup", "revise_followup", "complete_followup"];
const categoryRank = (category: FindingCategory | null) => (category ? FINDING_CATEGORIES.indexOf(category) : FINDING_CATEGORIES.length);
type Sortable = { category: FindingCategory | null; call_at: string | null; conversation_id: string; id: string };
const callTime = (value: string | null) => (value ? +new Date(value) : Number.NEGATIVE_INFINITY);
const byCallDesc = (a: Sortable, b: Sortable) => { const x = callTime(a.call_at), y = callTime(b.call_at); return x === y ? 0 : x > y ? -1 : 1; };
/** Final spec §11.5: category order, then newest call first (unknown call time last); a call's findings keep their stored order. */
export function compareCurrentFindings(a: Sortable, b: Sortable): number {
  return categoryRank(a.category) - categoryRank(b.category) || byCallDesc(a, b)
    || (a.conversation_id < b.conversation_id ? 1 : a.conversation_id > b.conversation_id ? -1 : 0)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * The review commands for a current finding. Enabled only while the finding is `unreviewed` and its run is a completed
 * conversation run with an output, which is when `commandAnalysis` accepts them and the run can own effects
 * (`readOwnerRun` calls this `editable`; a Number run never owns effects).
 */
export function findingReviewActions(finding: { id: string; revision: number; review_state: string }, run: Pick<CurrentRunRow, "status" | "conversation_id" | "output"> | undefined) {
  const editable = Boolean(run && run.status === "completed" && run.output && run.conversation_id != null);
  const unreviewed = finding.review_state === "unreviewed";
  return FINDING_REVIEW_ACTIONS.map(action => ({ action, target_id: finding.id, expected_revision: finding.revision, enabled: editable && unreviewed,
    blocker_codes: !editable ? ["REVISION_CONFLICT" as const] : !unreviewed ? ["ILLEGAL_TRANSITION" as const] : [] }));
}

export type CurrentFindingsInput = {
  conversations: readonly CurrentConversationRow[];
  findings: readonly FindingRow[];
  runs: readonly CurrentRunRow[];
  effects: readonly EffectRow[];
  review_items: readonly ReviewItemRow[];
  followups: readonly FollowupLite[];
  snapshots: readonly SnapshotRow[];
  transcripts: readonly TranscriptRow[];
  include_superseded: boolean;
};
const envelopeRefs = (assertion: unknown): IntelligenceEvidenceRef[] => {
  const parsed = intelligenceFindingSchema.safeParse(assertion);
  return parsed.success ? parsed.data.evidence : [];
};

/**
 * Pure: loaded rows → ordered items. Keeps only findings of each conversation's latest completed run (the store is asked
 * for exactly those pairs; this re-checks so a stray row can never leak), drops superseded findings unless asked, keeps
 * retracted ones, and skips a stored assertion that no longer parses (it cannot be presented without guessing).
 */
export function currentFindingItems(input: CurrentFindingsInput): CurrentFindingItemDto[] {
  const latest = new Map(input.conversations.map(row => [String(row._id), String(row.latest_completed_run_id)] as const));
  const conversations = new Map<string, ConversationRow>(input.conversations.map(row => [String(row._id), { _id: row._id, started_at: row.started_at ?? null }] as const));
  const runs = new Map(input.runs.map(run => [String(run._id), run] as const));
  const snapshots = new Map(input.snapshots.map(row => [String(row._id), row] as const));
  const transcripts = new Map(input.transcripts.map(row => [String(row._id), row] as const));
  const sources = { snapshots, runs: runs as unknown as ReadonlyMap<string, RunRow>, conversations, findings: new Map(), leads: new Set<string>(), transcripts };
  const items: CurrentFindingItemDto[] = [];
  for (const row of input.findings) {
    const id = String(row._id), runId = String(row.run_id), conversationId = row.conversation_id == null ? null : String(row.conversation_id);
    const run = runs.get(runId);
    if (!conversationId || latest.get(conversationId) !== runId || row.purged_at || !run || run.purged_at || run.purge_started_at) continue;
    if (row.superseded_by != null && !input.include_superseded) continue;
    const parsed = intelligenceFindingSchema.safeParse(row.assertion);
    if (!parsed.success) continue;
    const finding = parsed.data;
    const effects = input.effects.filter(effect => String(effect.finding_id) === id);
    const category = findingCategory(finding.kind);
    const quotes = new Map<string, string>();
    const refs: EvidenceRefDto[] = finding.evidence.map(ref => {
      const dto = envelopeEvidenceRef(runId, ref);
      if (ref.source === "transcript" && ref.quote) quotes.set(dto.id, ref.quote);
      return dto;
    });
    const started = conversations.get(conversationId)?.started_at;
    items.push(currentFindingItemDtoSchema.parse({
      id, run_id: runId, conversation_id: conversationId, call_at: started ? new Date(started).toISOString() : null,
      kind: finding.kind, category, category_label: category ? FINDING_CATEGORY_LABELS[category] : null,
      claim: finding.claim, source_word: findingSourceWord(finding.basis, finding.actor), action_status_word: actionStatusWord(finding.action_status),
      clarity: finding.clarity, value_line: findingValueLine(finding, row.resolved),
      ...findingWorkResult({ finding_id: id, review_state: row.review_state, superseded_by: row.superseded_by ?? null, effects, review_items: input.review_items,
        actions: input.followups }),
      review_state: row.review_state, superseded_by: row.superseded_by == null ? null : String(row.superseded_by),
      evidence: evidenceSection(refs, sources, { quotes }).items,
      allowed_actions: findingReviewActions({ id, revision: row.revision, review_state: row.review_state }, run),
    }));
  }
  return items.sort(compareCurrentFindings);
}

const numberOf = (record: RecordLite) => {
  const value = record.primary_contact_number_id ?? (record.subject.kind === "number_review" ? record.subject.contact_number_id : null);
  return value == null ? null : String(value);
};
type SnapshotRef = { source?: string; snapshot_id?: string; segment_ids?: number[] };
const sourceSnapshotOf = (row: SnapshotRow) => {
  const transcript = (row.response as { transcript?: { source_snapshot_id?: unknown } } | null | undefined)?.transcript;
  return typeof transcript?.source_snapshot_id === "string" ? transcript.source_snapshot_id : null;
};

/** `GET /outreach/:id/findings`. Null when the Outreach record does not exist (404). */
export async function readCurrentFindings(outreachId: string, raw: unknown = {}, deps: CurrentFindingsDeps = {}) {
  const query = currentFindingsQuerySchema.parse(raw);
  const includeSuperseded = query.include_superseded === "true";
  const store = deps.store ?? mongoCurrentFindingsStore;
  const respond = async (data: CurrentFindingsData) => ownerRead(currentFindingsDataSchema.parse(data), undefined, deps.coverage ? await deps.coverage() : undefined);
  const record = await store.record(csiIdSchema.parse(outreachId));
  if (!record) return null;
  const numberId = numberOf(record);
  // Lead-only subjects (no primary Contact Number) are common in production: never `String(null)`.
  if (!numberId) return respond({ items: [], reason: "no_number", truncated: false });
  const [purgePending, bounded] = await Promise.all([store.purgePending(numberId), store.conversations(numberId, CURRENT_FINDINGS_CONVERSATION_LIMIT + 1)]);
  if (purgePending) return respond({ items: [], reason: "retention_pending", truncated: false });
  const truncated = bounded.length > CURRENT_FINDINGS_CONVERSATION_LIMIT;
  const conversations = bounded.slice(0, CURRENT_FINDINGS_CONVERSATION_LIMIT);
  const pairs = conversations.map(row => ({ conversation_id: String(row._id), run_id: String(row.latest_completed_run_id) }));
  const [findings, runs] = await Promise.all([store.findings(pairs, includeSuperseded), store.runs(pairs.map(pair => pair.run_id))]);
  const findingIds = findings.map(row => String(row._id));
  const refs: SnapshotRef[] = findings.flatMap(row => envelopeRefs(row.assertion));
  const subjects = [subjectKey(record.subject as Parameters<typeof subjectKey>[0]), ...runs.flatMap(run => (run.subject_key ? [run.subject_key] : []))];
  const [effects, reviewItems, snapshots] = await Promise.all([
    store.effects(runs.map(run => String(run._id)), findingIds),
    store.reviewItems(subjects, findingIds),
    store.snapshots(refs.flatMap(ref => (ref.snapshot_id ? [ref.snapshot_id] : []))),
  ]);
  // Transcript citations whose own snapshot (a structured summary artifact) carries no segments read them from the source transcript.
  const byId = new Map(snapshots.map(row => [String(row._id), row]));
  const transcriptRefs = refs.filter(ref => ref.source === "transcript" && ref.snapshot_id);
  const needsSource = [...new Set(transcriptRefs.flatMap(ref => {
    const row = byId.get(String(ref.snapshot_id));
    const inline = (row?.response as { transcript?: { segments?: { sid?: number }[] } } | null | undefined)?.transcript?.segments ?? [];
    const complete = (ref.segment_ids ?? []).length > 0 && (ref.segment_ids ?? []).every(sid => inline.some(segment => segment.sid === sid));
    const source = row && !complete ? sourceSnapshotOf(row) : null;
    return source ? [source] : [];
  }))];
  const targets = [...new Set(effects.filter(effect => effect.target_id != null && FOLLOWUP_EFFECTS.includes(effect.effect_kind)).map(effect => String(effect.target_id)))];
  const [followups, transcripts] = await Promise.all([
    targets.length ? store.followups(targets) : Promise.resolve([]),
    needsSource.length ? store.transcripts(needsSource, transcriptRefs.flatMap(ref => ref.segment_ids ?? [])) : Promise.resolve([]),
  ]);
  return respond({ items: currentFindingItems({ conversations, findings, runs, effects, review_items: reviewItems, followups, snapshots, transcripts,
    include_superseded: includeSuperseded }), reason: null, truncated });
}
