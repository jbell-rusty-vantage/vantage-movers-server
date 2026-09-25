import mongoose from "mongoose";
import { csiDataset } from "../../../config/domain/salesIntelligence";
import { getMongoDatabaseName } from "../../../config/domain/runtime";
import { getMoveAssessmentArtifactModel } from "../../../models/MoveAssessmentArtifact";
import { getOutreachRecordModel } from "../../../models/OutreachRecord";
import { getOutreachFollowupModel } from "../../../models/OutreachFollowup";
import { getContactNumberModel } from "../../../models/ContactNumber";
import { getCallInteractionModel } from "../../../models/CallInteraction";
import { getLeadConversationModel } from "../../../models/LeadConversation";
import { getSalesIntelligenceJobModel } from "../../../models/SalesIntelligenceJob";
import { getSalesIntelligenceReviewItemModel } from "../../../models/SalesIntelligenceReviewItem";
import { getSalesIntelligenceAuditEventModel } from "../../../models/SalesIntelligenceAuditEvent";
import { getSalesIntelligenceOwnerInstructionModel } from "../../../models/SalesIntelligenceOwnerInstruction";
import { getIntelligenceRunModel } from "../../../models/IntelligenceRun";
import { getIntelligenceFindingModel } from "../../../models/IntelligenceFinding";
import { getIntelligenceEffectModel } from "../../../models/IntelligenceEffect";
import { getIntelligenceEvidenceSnapshotModel } from "../../../models/IntelligenceEvidenceSnapshot";
import { csiIdSchema, csiSubjectSchema } from "../../../validation/v1/salesIntelligence";
import { ownerRead } from "../../numberActivity/coverage";
import type { CoverageDto } from "../dto";
import { subjectKey } from "../outreach/types";
import { moveViewsForLead, type LeadMoveSource } from "./views";
import {
  outreachAssessmentDtoSchema, type AssessmentSection, type EvidenceSection, type FullOutput, type OutreachAssessmentDto, type RunPresentation,
} from "./dto";
import {
  assessmentApplicability, assessmentEvidenceRefs, assessmentFullOutput, assessmentSection, assessmentVersion, evidenceSection, leadOnlyMoveTable,
  moveDateHasPassed, noAssessmentAvailability, runFullOutput, runPresentation,
  type AppliedSuggestion, type ApplicabilityInput, type ArtifactRow, type ConversationRow, type EffectRow, type FindingRow, type FollowupLite,
  type InstructionRow, type LeadFlagsRow, type ProjectionRow, type ReviewItemRow, type RunRow, type SnapshotRow, type TranscriptRow,
} from "./presentation";

/**
 * MA-04 Owner reads for Move assessment and the shared analysis presentation (MA-01 §10), extended by
 * the model-output presentation contract (data spec §6.2, §6.11 B–D).
 *
 * GET-only: no writes, no jobs, no model calls. Every read goes through an
 * `AssessmentStore` so the adapters are exercised without Mongo; the default
 * store is dataset-scoped and batch-loads (one query per collection, never one
 * per finding, citation or row).
 * Retention wins everywhere: purged artifacts and runs return tombstone
 * availability, a Number with `content_purge_pending` returns `unavailable`.
 */
export const PENDING_ASSESSMENT_JOB_STATUSES = ["pending", "leased", "retry"] as const;
const VERSION_LIMIT = 50;
const REVIEW_ITEM_LIMIT = 500;

export type RecordLite = ApplicabilityInput & {
  _id: unknown; subject: { kind: string; model?: string | null; id?: unknown; contact_number_id?: unknown };
  primary_contact_number_id?: unknown; move_assessment?: ProjectionRow | null;
};
type LeadModel = "FormLead" | "CallLead";
export type LeadRow = LeadMoveSource & LeadFlagsRow & { _id: unknown };
export type ReviewItemQuery = { subject_key: string; finding_ids: readonly string[]; causes: ReadonlyArray<{ cause_kind: string; cause_keys: readonly string[] }> };
export type AssessmentStore = {
  record(id: string): Promise<RecordLite | null>;
  /** Non-shadow artifacts for a subject, newest first, bounded. */
  artifacts(subjectKey: string): Promise<ArtifactRow[]>;
  artifact(id: string): Promise<ArtifactRow | null>;
  pendingJob(subjectKey: string): Promise<boolean>;
  purgePending(numberId: string): Promise<boolean>;
  run(id: string): Promise<RunRow | null>;
  runs(ids: readonly string[]): Promise<RunRow[]>;
  findings(runId: string): Promise<FindingRow[]>;
  findingsById(ids: readonly string[]): Promise<FindingRow[]>;
  effects(runId: string): Promise<EffectRow[]>;
  followups(ids: readonly string[]): Promise<FollowupLite[]>;
  snapshots(ids: readonly string[]): Promise<SnapshotRow[]>;
  conversations(ids: readonly string[]): Promise<ConversationRow[]>;
  /** `${model}:${id}` → the Lead's move fields and official flags, for Leads that exist (one query per Lead collection). */
  leads(refs: readonly { model: LeadModel; id: string }[]): Promise<Map<string, LeadRow>>;
  /** Data spec §6.2: canonical calls on the Number after `after` (`call_interaction_number_started_id`). */
  newerCalls(numberId: string, after: Date): Promise<number>;
  /** Review items naming the findings (open) or opened for the given causes; one query. */
  reviewItems(query: ReviewItemQuery): Promise<ReviewItemRow[]>;
  /** The newest `analysis.suggestion_applied` audit row for the run and the follow-up its command created. */
  appliedSuggestion(subjectKey: string, runId: string): Promise<AppliedSuggestion | null>;
  /** Owner instruction revisions by instruction id (every revision; the caller picks). */
  instructions(ids: readonly string[]): Promise<InstructionRow[]>;
  /** Source transcript snapshots with only the cited segment ids. */
  transcripts(ids: readonly string[], segmentIds: readonly number[]): Promise<TranscriptRow[]>;
};

const ids = (values: readonly string[]) => [...new Set(values)].filter(value => csiIdSchema.safeParse(value).success);
const oids = (values: readonly string[]) => ids(values).map(id => new mongoose.Types.ObjectId(id));
const LEAD_FIELDS = { _id: 1, pickup_city: 1, pickup_state: 1, pickup_zip: 1, delivery_city: 1, delivery_state: 1, destination_zip: 1, delivery_zip: 1,
  move_date: 1, move_size: 1, granot_move_size: 1, cubic_feet: 1, ingestion_origin: 1, current_move_provenance: 1, ingested_move_snapshot: 1,
  booked: 1, cancelled: 1, duplicate: 1, bad_lead: 1, no_sync: 1 } as const;
export const mongoAssessmentStore: AssessmentStore = {
  record: id => getOutreachRecordModel().findOne({ _id: id, purged_at: null }).lean() as Promise<RecordLite | null>,
  artifacts: key => getMoveAssessmentArtifactModel().find({ ...csiDataset(), subject_key: key, shadow: false }).sort({ createdAt: -1, _id: -1 })
    .limit(VERSION_LIMIT).lean() as Promise<ArtifactRow[]>,
  artifact: id => getMoveAssessmentArtifactModel().findOne({ _id: id, ...csiDataset() }).lean() as Promise<ArtifactRow | null>,
  pendingJob: async key => Boolean(await getSalesIntelligenceJobModel().exists({ ...csiDataset(), stage: "move_assessment", subject_key: key,
    status: { $in: [...PENDING_ASSESSMENT_JOB_STATUSES] } })),
  purgePending: async id => Boolean(await getContactNumberModel().exists({ _id: id, content_purge_pending: true })),
  run: id => getIntelligenceRunModel().findOne({ _id: id, ...csiDataset() }).lean() as Promise<RunRow | null>,
  runs: async list => (ids(list).length ? getIntelligenceRunModel().find({ _id: { $in: ids(list) }, ...csiDataset() }).lean() as Promise<RunRow[]> : []),
  findings: runId => getIntelligenceFindingModel().find({ run_id: runId, purged_at: null }).sort({ _id: 1 }).lean() as Promise<FindingRow[]>,
  findingsById: async list => (ids(list).length ? getIntelligenceFindingModel().find({ _id: { $in: ids(list) } }).lean() as Promise<FindingRow[]> : []),
  effects: runId => getIntelligenceEffectModel().find({ run_id: runId }).sort({ _id: 1 }).lean() as Promise<EffectRow[]>,
  followups: async list => (ids(list).length ? getOutreachFollowupModel().find({ _id: { $in: ids(list) } }).lean() as Promise<FollowupLite[]> : []),
  snapshots: async list => (ids(list).length ? getIntelligenceEvidenceSnapshotModel().find({ _id: { $in: ids(list) }, ...csiDataset() })
    .select("_id run_id conversation_id response content_digest purged_at purge_started_at retrieved_at").lean() as Promise<SnapshotRow[]> : []),
  conversations: async list => (ids(list).length ? getLeadConversationModel().find({ _id: { $in: ids(list) } })
    .select("_id summary content_purged_at started_at").lean() as Promise<ConversationRow[]> : []),
  leads: async refs => {
    const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true });
    const out = new Map<string, LeadRow>();
    for (const [model, collection] of [["FormLead", "form_leads"], ["CallLead", "call_leads"]] as const) {
      const wanted = oids(refs.filter(ref => ref.model === model).map(ref => ref.id));
      if (!wanted.length) continue;
      const rows = await db.collection(collection).find({ _id: { $in: wanted } }, { projection: LEAD_FIELDS }).toArray();
      for (const row of rows) out.set(`${model}:${String(row._id)}`, row as unknown as LeadRow);
    }
    return out;
  },
  newerCalls: (numberId, after) => getCallInteractionModel().countDocuments({ contact_number_id: numberId, merged_into_id: null, purged_at: null, started_at: { $gt: after } }),
  reviewItems: async query => {
    const clauses = [...(ids(query.finding_ids).length ? [{ state: "open", evidence_ids: { $in: ids(query.finding_ids) } }] : []),
      ...query.causes.filter(cause => cause.cause_keys.length).map(cause => ({ cause_kind: cause.cause_kind, cause_key: { $in: [...cause.cause_keys] } }))];
    if (!clauses.length) return [];
    return getSalesIntelligenceReviewItemModel().find({ subject_key: query.subject_key, $or: clauses as never[] }).select("_id cause_kind cause_key state evidence_ids")
      .limit(REVIEW_ITEM_LIMIT).lean() as Promise<ReviewItemRow[]>;
  },
  appliedSuggestion: async (key, runId) => {
    const audit = await getSalesIntelligenceAuditEventModel().findOne({ subject_key: key, event_kind: "analysis.suggestion_applied", "invalidation.target_id": runId })
      .sort({ happened_at: -1 }).select("happened_at command_id").lean();
    if (!audit) return null;
    // `apply_suggestion` creates the follow-up through `createOwnerFollowup` in the same command: `owner:{command_id}:action`.
    const followup = audit.command_id ? await getOutreachFollowupModel().findOne({ commitment_key: `owner:${String(audit.command_id)}:action` })
      .select("_id due_at").lean() : null;
    return { applied_at: audit.happened_at ?? null, followup_id: followup ? String(followup._id) : null, followup_due_at: followup?.due_at ?? null };
  },
  instructions: async list => (ids(list).length ? getSalesIntelligenceOwnerInstructionModel().find({ instruction_id: { $in: ids(list) } })
    .select("instruction_id revision field current happened_at").limit(500).lean() as Promise<InstructionRow[]> : []),
  transcripts: async (list, segmentIds) => (oids(list).length ? getIntelligenceEvidenceSnapshotModel().aggregate([
    { $match: { _id: { $in: oids(list) }, ...csiDataset(), source_type: "transcript" } },
    { $project: { conversation_id: 1, purged_at: 1, purge_started_at: 1,
      segments: { $filter: { input: "$segments", as: "segment", cond: { $in: ["$$segment.sid", [...new Set(segmentIds)]] } } } } },
  ]) as Promise<TranscriptRow[]> : []),
};

/** Injectable for tests; production reads use Mongo and the live Coverage read. `now` is the read's `as_of` for derived states. */
export type AssessmentReadDeps = { store?: AssessmentStore; coverage?: () => Promise<CoverageDto>; now?: () => Date };
/** `now` is the clock the derived states were computed at, so `as_of` never disagrees with them (data spec §3.8 rule 4). */
const respond = async <T>(data: T, deps: AssessmentReadDeps, now?: Date) => ownerRead(data, now ? () => now : undefined, deps.coverage ? await deps.coverage() : undefined);

const numberOf = (record: RecordLite | null, artifact?: ArtifactRow | null) => {
  const value = artifact?.contact_number_id ?? record?.primary_contact_number_id ?? (record?.subject.kind === "number_review" ? record.subject.contact_number_id : null);
  return value == null ? null : String(value);
};
const retentionPending = async (store: AssessmentStore, numberId: string | null) => (numberId ? store.purgePending(numberId) : false);
const isCurrent = (record: RecordLite | null, artifact: ArtifactRow) => record?.move_assessment?.artifact_id != null && String(record.move_assessment.artifact_id) === String(artifact._id);
const subjectLead = (record: RecordLite | null) => record?.subject.kind === "lead" && (record.subject.model === "FormLead" || record.subject.model === "CallLead") && record.subject.id != null
  ? { model: record.subject.model as LeadModel, id: String(record.subject.id) } : null;
/** The subject Lead's live views (one Lead read), or null for a Number-review subject or a missing Lead. */
async function loadLeadViews(store: AssessmentStore, record: RecordLite | null) {
  const ref = subjectLead(record);
  if (!ref) return null;
  const row = (await store.leads([ref])).get(`${ref.model}:${ref.id}`);
  return row ? moveViewsForLead(row, ref.model) : null;
}
/** Data spec §6.2 `newer_calls_count`: null when the artifact covers no conversation or the subject has no Number. */
async function newerCallsFor(store: AssessmentStore, artifact: ArtifactRow, numberId: string | null, section: AssessmentSection) {
  if (!numberId || !artifact.latest_conversation_at || !["ready", "insufficient_evidence"].includes(section.availability)) return null;
  return store.newerCalls(numberId, new Date(artifact.latest_conversation_at));
}

/** `GET /outreach/:id/assessment`: the subject, its current assessment (or Not assessed / Pending / Not applicable) and every version. */
export async function readOutreachAssessment(outreachId: string, deps: AssessmentReadDeps = {}) {
  const store = deps.store ?? mongoAssessmentStore;
  const now = deps.now?.() ?? new Date();
  const record = await store.record(csiIdSchema.parse(outreachId));
  if (!record) return null;
  const key = subjectKey(record.subject as Parameters<typeof subjectKey>[0]);
  const numberId = numberOf(record);
  const [artifacts, pending, purgePending, leadViews] = await Promise.all([store.artifacts(key), store.pendingJob(key), retentionPending(store, numberId),
    loadLeadViews(store, record)]);
  const applicability = assessmentApplicability(record);
  // A `pending` artifact is a generation in flight: it signals Pending but is not a version.
  const settled = artifacts.filter(artifact => artifact.status !== "pending" && !artifact.shadow);
  const inFlight = pending || artifacts.some(artifact => artifact.status === "pending");
  const pointed = record.move_assessment?.artifact_id != null ? settled.find(artifact => isCurrent(record, artifact))
    ?? await store.artifact(String(record.move_assessment.artifact_id)) : null;
  const current = pointed && !pointed.shadow ? pointed : settled[0] ?? null;
  const context = { applicability, projection: record.move_assessment ?? null, retention_pending: purgePending,
    move_date_passed: moveDateHasPassed(leadViews?.canonical_current.move_date, now) };
  let section: AssessmentSection | null = current ? assessmentSection(current, { ...context, current: isCurrent(record, current) }) : null;
  if (current && section) section = assessmentSection(current, { ...context, current: isCurrent(record, current),
    newer_calls_count: await newerCallsFor(store, current, numberOf(record, current), section) });
  const availability = applicability !== "active" ? "not_applicable" : section ? section.availability : noAssessmentAvailability(applicability, inFlight);
  const dto: OutreachAssessmentDto = outreachAssessmentDtoSchema.parse({
    subject: { outreach_record_id: String(record._id), subject_key: key, state: record.state, contact_number_id: numberId, applicability,
      subject: csiSubjectSchema.parse(record.subject.kind === "lead" ? { kind: "lead", model: record.subject.model, id: String(record.subject.id) }
        : { kind: "number_review", contact_number_id: String(record.subject.contact_number_id) }) },
    availability, current: section,
    versions: settled.map(artifact => assessmentVersion(artifact, isCurrent(record, artifact), purgePending)),
    ...(!section && leadViews ? { lead_move_table: leadOnlyMoveTable(leadViews) } : {}),
  });
  return respond(dto, deps, now);
}

async function loadArtifact(artifactId: string, store: AssessmentStore) {
  const artifact = await store.artifact(csiIdSchema.parse(artifactId));
  if (!artifact || artifact.shadow) return null;
  const record = artifact.outreach_record_id != null ? await store.record(String(artifact.outreach_record_id)) : null;
  return { artifact, record, purgePending: await retentionPending(store, numberOf(record, artifact)) };
}

/** `GET /assessments/:artifactId`: one version as an `AssessmentSection`. Applicability is read from the current record. */
export async function readAssessment(artifactId: string, deps: AssessmentReadDeps = {}) {
  const store = deps.store ?? mongoAssessmentStore;
  const now = deps.now?.() ?? new Date();
  const loaded = await loadArtifact(artifactId, store);
  if (!loaded) return null;
  const { artifact, record, purgePending } = loaded;
  const current = isCurrent(record, artifact);
  const leadViews = current ? await loadLeadViews(store, record) : null;
  const context = { applicability: record ? assessmentApplicability(record) : "active" as const, projection: record?.move_assessment ?? null, current,
    retention_pending: purgePending, move_date_passed: moveDateHasPassed(leadViews?.canonical_current.move_date, now) };
  const section = assessmentSection(artifact, context);
  return respond(assessmentSection(artifact, { ...context, newer_calls_count: await newerCallsFor(store, artifact, numberOf(record, artifact), section) }), deps, now);
}

/** `GET /assessments/:artifactId/output`: exact retained model object plus the accepted envelope, labelled separately. */
export async function readAssessmentOutput(artifactId: string, deps: AssessmentReadDeps = {}) {
  const store = deps.store ?? mongoAssessmentStore;
  const loaded = await loadArtifact(artifactId, store);
  return loaded ? respond<FullOutput>(assessmentFullOutput(loaded.artifact, loaded.purgePending), deps) : null;
}

/** `GET /assessments/:artifactId/evidence`: every citation resolved with retention-aware availability and its server-built text. */
export async function readAssessmentEvidence(artifactId: string, deps: AssessmentReadDeps = {}) {
  const store = deps.store ?? mongoAssessmentStore;
  const now = deps.now?.() ?? new Date();
  const loaded = await loadArtifact(artifactId, store);
  if (!loaded) return null;
  const { artifact, purgePending } = loaded;
  const section = assessmentSection(artifact, { applicability: "active", current: false, retention_pending: purgePending });
  if (!["ready", "insufficient_evidence"].includes(section.availability)) {
    const availability = section.availability === "purged" ? "purged" : section.availability === "unsupported" ? "unsupported" : "unavailable";
    return respond<EvidenceSection>({ availability, items: [] }, deps, now);
  }
  const refs = assessmentEvidenceRefs(artifact);
  const want = (source: string) => refs.flatMap(ref => ref.locator.source === source ? [ref.locator] : []);
  const leadRefs = [...want("lead"), ...want("official")].flatMap(locator => (locator.source === "lead" || locator.source === "official")
    && (locator.model === "FormLead" || locator.model === "CallLead") ? [{ model: locator.model as LeadModel, id: locator.id }] : []);
  const [snapshots, runs, conversations, findings, leads, instructions] = await Promise.all([
    store.snapshots(want("summary_artifact").map(locator => "snapshot_id" in locator ? locator.snapshot_id : "")),
    store.runs([...want("legacy_run"), ...want("finding")].map(locator => "run_id" in locator ? locator.run_id : "")),
    store.conversations(refs.flatMap(ref => "conversation_id" in ref.locator && ref.locator.conversation_id ? [ref.locator.conversation_id] : [])),
    store.findingsById(want("finding").map(locator => "finding_id" in locator ? locator.finding_id : "")),
    store.leads(leadRefs),
    store.instructions(want("owner_correction").map(locator => "instruction_id" in locator ? locator.instruction_id : "")),
  ]);
  return respond(evidenceSection(refs, { snapshots: new Map(snapshots.map(row => [String(row._id), row])), runs: new Map(runs.map(row => [String(row._id), row])),
    conversations: new Map(conversations.map(row => [String(row._id), row])), findings: new Map(findings.map(row => [String(row._id), row])),
    leads: new Set(leads.keys()), lead_flags: leads, views: section.views, context_as_of: section.context_as_of, as_of: now.toISOString(),
    instructions: new Map(instructions.map(row => [`${String(row.instruction_id)}:${row.revision}`, row])) }), deps, now);
}

async function loadRun(runId: string, store: AssessmentStore) {
  const run = await store.run(csiIdSchema.parse(runId));
  if (!run) return null;
  const summaryIds = (() => { const value = (run.step_artifacts as { summaries?: unknown } | null | undefined)?.summaries; return Array.isArray(value) ? value.map(String) : []; })();
  const [summaries, purgePending] = await Promise.all([store.snapshots(summaryIds), retentionPending(store, run.contact_number_id == null ? null : String(run.contact_number_id))]);
  return { run, summaries, purgePending };
}

type EnvelopeRef = { source?: string; snapshot_id?: string; conversation_id?: string; segment_ids?: number[] };
type LooseEnvelope = {
  findings?: { evidence?: EnvelopeRef[] }[];
  prior_finding_relations?: { prior_finding_id?: string; relation?: string; evidence?: EnvelopeRef[] }[];
  story_discrepancies?: { story_event_id?: string; evidence?: EnvelopeRef[] }[];
  owner_instruction_assessments?: { instruction_id?: string }[];
};
const sourceSnapshotOf = (row: SnapshotRow) => {
  const transcript = (row.response as { transcript?: { source_snapshot_id?: unknown; segments?: unknown[] } } | null | undefined)?.transcript;
  return typeof transcript?.source_snapshot_id === "string" ? transcript.source_snapshot_id : null;
};

/**
 * `GET /analysis-runs/:id/presentation`: Summary & findings, Evidence and Full output references for a legacy or structured run,
 * with the §6.11 B–C additions. Query shape is fixed (no per-finding or per-citation read): run, summaries, findings, effects;
 * then one batch each for snapshots, follow-ups, prior findings, review items, the applied-suggestion audit, instructions and
 * conversations; then source transcripts (only when a transcript citation's snapshot does not carry its segments).
 */
export async function readRunPresentation(runId: string, deps: AssessmentReadDeps = {}) {
  const store = deps.store ?? mongoAssessmentStore;
  const loaded = await loadRun(runId, store);
  if (!loaded) return null;
  const { run, summaries, purgePending } = loaded;
  const [findings, effects] = await Promise.all([store.findings(String(run._id)), store.effects(String(run._id))]);
  const envelope = (run.output ?? null) as LooseEnvelope | null;
  const storedRefs = findings.flatMap(finding => { const evidence = (finding.assertion as { evidence?: unknown } | null)?.evidence; return Array.isArray(evidence) ? evidence as EnvelopeRef[] : []; });
  const envelopeRefs = [...(envelope?.findings ?? []).flatMap(finding => finding.evidence ?? []),
    ...(envelope?.prior_finding_relations ?? []).flatMap(relation => relation.evidence ?? []), ...(envelope?.story_discrepancies ?? []).flatMap(item => item.evidence ?? [])];
  const allRefs = [...storedRefs, ...envelopeRefs];
  const targets = effects.filter(effect => effect.target_id && ["create_followup", "revise_followup", "complete_followup"].includes(effect.effect_kind)).map(effect => String(effect.target_id));
  const priorIds = (envelope?.prior_finding_relations ?? []).flatMap(relation => relation.prior_finding_id ? [relation.prior_finding_id] : []);
  const storyIds = (envelope?.story_discrepancies ?? []).flatMap(item => item.story_event_id ? [item.story_event_id] : []);
  const subject = run.subject_key ?? "";
  const conversationIds = [...new Set([...findings.flatMap(finding => finding.conversation_id != null ? [String(finding.conversation_id)] : []),
    ...(run.conversation_id != null ? [String(run.conversation_id)] : []), ...allRefs.flatMap(ref => ref.conversation_id ? [ref.conversation_id] : [])])];
  const [snapshots, actions, priorFindings, reviewItems, suggestion, instructions, conversations] = await Promise.all([
    store.snapshots(allRefs.flatMap(ref => (ref.snapshot_id ? [String(ref.snapshot_id)] : []))),
    store.followups(targets),
    store.findingsById(priorIds),
    subject ? store.reviewItems({ subject_key: subject, finding_ids: findings.map(finding => String(finding._id)), causes: [
      { cause_kind: "prior_contradiction", cause_keys: priorIds }, { cause_kind: "prior_fulfilled_unclaimed", cause_keys: priorIds },
      { cause_kind: "record_disputed_on_call", cause_keys: storyIds }] }) : Promise.resolve([]),
    subject && envelope && (run.output as { next_step_suggestion?: unknown }).next_step_suggestion ? store.appliedSuggestion(subject, String(run._id)) : Promise.resolve(null),
    store.instructions((envelope?.owner_instruction_assessments ?? []).flatMap(item => item.instruction_id ? [item.instruction_id] : [])),
    store.conversations(conversationIds),
  ]);
  // Transcript citations whose own snapshot (a structured summary artifact) carries no segments read them from the source transcript.
  const byId = new Map([...snapshots, ...summaries].map(row => [String(row._id), row]));
  const transcriptRefs = allRefs.filter(ref => ref.source === "transcript" && ref.snapshot_id);
  const needsSource = transcriptRefs.flatMap(ref => {
    const row = byId.get(String(ref.snapshot_id));
    const inline = (row?.response as { transcript?: { segments?: { sid?: number }[] } } | null | undefined)?.transcript?.segments ?? [];
    const complete = (ref.segment_ids ?? []).length > 0 && (ref.segment_ids ?? []).every(id => inline.some(segment => segment.sid === id));
    const source = row && !complete ? sourceSnapshotOf(row) : null;
    return source ? [source] : [];
  });
  const transcripts = needsSource.length ? await store.transcripts([...new Set(needsSource)], transcriptRefs.flatMap(ref => ref.segment_ids ?? [])) : [];
  return respond<RunPresentation>(runPresentation({ run, findings, effects, actions, summaries, retention_pending: purgePending,
    snapshots: new Map(snapshots.map(row => [String(row._id), row])), prior_findings: priorFindings, review_items: reviewItems, suggestion,
    instructions, conversations, transcripts }), deps);
}

/**
 * S12-REPREADS (UX15): the presentation as a rep reads it. Every section is the Owner's (Summary & findings with
 * `owner_instruction_assessments`, Evidence), except that the Full output references are emptied: the raw and
 * accepted model output (`/analysis-runs/:id/output/:outputId`) stays Owner-only, so a rep gets no picker. Same shape.
 */
export function presentationForRep<T extends { data: RunPresentation }>(result: T): T {
  return { ...result, data: { ...result.data, full_output: [] } };
}

/** `GET /analysis-runs/:id/output/:outputId`: one retained run output (the run's envelope, or a captured conversation summary). */
export async function readRunOutput(runId: string, outputId: string, deps: AssessmentReadDeps = {}) {
  const store = deps.store ?? mongoAssessmentStore;
  const loaded = await loadRun(runId, store);
  if (!loaded) return null;
  const output = runFullOutput({ run: loaded.run, summaries: loaded.summaries, retention_pending: loaded.purgePending }, csiIdSchema.parse(outputId));
  return output ? respond<FullOutput>(output, deps) : null;
}
