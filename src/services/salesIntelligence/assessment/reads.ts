import mongoose from "mongoose";
import { csiDataset } from "../../../config/domain/salesIntelligence";
import { getMongoDatabaseName } from "../../../config/domain/runtime";
import { getMoveAssessmentArtifactModel } from "../../../models/MoveAssessmentArtifact";
import { getOutreachRecordModel } from "../../../models/OutreachRecord";
import { getOutreachFollowupModel } from "../../../models/OutreachFollowup";
import { getContactNumberModel } from "../../../models/ContactNumber";
import { getLeadConversationModel } from "../../../models/LeadConversation";
import { getSalesIntelligenceJobModel } from "../../../models/SalesIntelligenceJob";
import { getIntelligenceRunModel } from "../../../models/IntelligenceRun";
import { getIntelligenceFindingModel } from "../../../models/IntelligenceFinding";
import { getIntelligenceEffectModel } from "../../../models/IntelligenceEffect";
import { getIntelligenceEvidenceSnapshotModel } from "../../../models/IntelligenceEvidenceSnapshot";
import { csiIdSchema, csiSubjectSchema } from "../../../validation/v1/salesIntelligence";
import { ownerRead } from "../../numberActivity/coverage";
import type { CoverageDto } from "../dto";
import { subjectKey } from "../outreach/types";
import {
  outreachAssessmentDtoSchema, type AssessmentSection, type EvidenceSection, type FullOutput, type OutreachAssessmentDto, type RunPresentation,
} from "./dto";
import {
  assessmentApplicability, assessmentEvidenceRefs, assessmentFullOutput, assessmentSection, assessmentVersion, evidenceSection, noAssessmentAvailability,
  runFullOutput, runPresentation, type ApplicabilityInput, type ArtifactRow, type ConversationRow, type EffectRow, type FindingRow, type FollowupLite,
  type ProjectionRow, type RunRow, type SnapshotRow,
} from "./presentation";

/**
 * MA-04 Owner reads for Move assessment and the shared analysis presentation (MA-01 §10).
 *
 * GET-only: no writes, no jobs, no model calls. Every read goes through an
 * `AssessmentStore` so the adapters are exercised without Mongo; the default
 * store is dataset-scoped and batch-loads (one query per collection).
 * Retention wins everywhere: purged artifacts and runs return tombstone
 * availability, a Number with `content_purge_pending` returns `unavailable`.
 */
export const PENDING_ASSESSMENT_JOB_STATUSES = ["pending", "leased", "retry"] as const;
const VERSION_LIMIT = 50;

export type RecordLite = ApplicabilityInput & {
  _id: unknown; subject: { kind: string; model?: string | null; id?: unknown; contact_number_id?: unknown };
  primary_contact_number_id?: unknown; move_assessment?: ProjectionRow | null;
};
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
  /** `${model}:${id}` keys of Leads that exist. */
  leads(refs: readonly { model: "FormLead" | "CallLead"; id: string }[]): Promise<Set<string>>;
};

const ids = (values: readonly string[]) => [...new Set(values)].filter(value => csiIdSchema.safeParse(value).success);
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
  conversations: async list => (ids(list).length ? getLeadConversationModel().find({ _id: { $in: ids(list) } }).select("_id summary content_purged_at").lean() as Promise<ConversationRow[]> : []),
  leads: async refs => {
    const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true });
    const out = new Set<string>();
    for (const [model, collection] of [["FormLead", "form_leads"], ["CallLead", "call_leads"]] as const) {
      const wanted = ids(refs.filter(ref => ref.model === model).map(ref => ref.id));
      if (!wanted.length) continue;
      const rows = await db.collection(collection).find({ _id: { $in: wanted.map(id => new mongoose.Types.ObjectId(id)) } }, { projection: { _id: 1 } }).toArray();
      for (const row of rows) out.add(`${model}:${String(row._id)}`);
    }
    return out;
  },
};

/** Injectable for tests; production reads use Mongo and the live Coverage read. */
export type AssessmentReadDeps = { store?: AssessmentStore; coverage?: () => Promise<CoverageDto> };
const respond = async <T>(data: T, deps: AssessmentReadDeps) => ownerRead(data, undefined, deps.coverage ? await deps.coverage() : undefined);

const numberOf = (record: RecordLite | null, artifact?: ArtifactRow | null) => {
  const value = artifact?.contact_number_id ?? record?.primary_contact_number_id ?? (record?.subject.kind === "number_review" ? record.subject.contact_number_id : null);
  return value == null ? null : String(value);
};
const retentionPending = async (store: AssessmentStore, numberId: string | null) => (numberId ? store.purgePending(numberId) : false);
const isCurrent = (record: RecordLite | null, artifact: ArtifactRow) => record?.move_assessment?.artifact_id != null && String(record.move_assessment.artifact_id) === String(artifact._id);

/** `GET /outreach/:id/assessment`: the subject, its current assessment (or Not assessed / Pending / Not applicable) and every version. */
export async function readOutreachAssessment(outreachId: string, deps: AssessmentReadDeps = {}) {
  const store = deps.store ?? mongoAssessmentStore;
  const record = await store.record(csiIdSchema.parse(outreachId));
  if (!record) return null;
  const key = subjectKey(record.subject as Parameters<typeof subjectKey>[0]);
  const numberId = numberOf(record);
  const [artifacts, pending, purgePending] = await Promise.all([store.artifacts(key), store.pendingJob(key), retentionPending(store, numberId)]);
  const applicability = assessmentApplicability(record);
  // A `pending` artifact is a generation in flight: it signals Pending but is not a version.
  const settled = artifacts.filter(artifact => artifact.status !== "pending" && !artifact.shadow);
  const inFlight = pending || artifacts.some(artifact => artifact.status === "pending");
  const pointed = record.move_assessment?.artifact_id != null ? settled.find(artifact => isCurrent(record, artifact))
    ?? await store.artifact(String(record.move_assessment.artifact_id)) : null;
  const current = pointed && !pointed.shadow ? pointed : settled[0] ?? null;
  const section: AssessmentSection | null = current ? assessmentSection(current, { applicability, projection: record.move_assessment ?? null,
    current: isCurrent(record, current), retention_pending: purgePending }) : null;
  const availability = applicability !== "active" ? "not_applicable" : section ? section.availability : noAssessmentAvailability(applicability, inFlight);
  const dto: OutreachAssessmentDto = outreachAssessmentDtoSchema.parse({
    subject: { outreach_record_id: String(record._id), subject_key: key, state: record.state, contact_number_id: numberId, applicability,
      subject: csiSubjectSchema.parse(record.subject.kind === "lead" ? { kind: "lead", model: record.subject.model, id: String(record.subject.id) }
        : { kind: "number_review", contact_number_id: String(record.subject.contact_number_id) }) },
    availability, current: section,
    versions: settled.map(artifact => assessmentVersion(artifact, isCurrent(record, artifact), purgePending)),
  });
  return respond(dto, deps);
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
  const loaded = await loadArtifact(artifactId, store);
  if (!loaded) return null;
  const { artifact, record, purgePending } = loaded;
  return respond(assessmentSection(artifact, { applicability: record ? assessmentApplicability(record) : "active",
    projection: record?.move_assessment ?? null, current: isCurrent(record, artifact), retention_pending: purgePending }), deps);
}

/** `GET /assessments/:artifactId/output`: exact retained model object plus the accepted envelope, labelled separately. */
export async function readAssessmentOutput(artifactId: string, deps: AssessmentReadDeps = {}) {
  const store = deps.store ?? mongoAssessmentStore;
  const loaded = await loadArtifact(artifactId, store);
  return loaded ? respond<FullOutput>(assessmentFullOutput(loaded.artifact, loaded.purgePending), deps) : null;
}

/** `GET /assessments/:artifactId/evidence`: every citation resolved with retention-aware availability. */
export async function readAssessmentEvidence(artifactId: string, deps: AssessmentReadDeps = {}) {
  const store = deps.store ?? mongoAssessmentStore;
  const loaded = await loadArtifact(artifactId, store);
  if (!loaded) return null;
  const { artifact, purgePending } = loaded;
  const section = assessmentSection(artifact, { applicability: "active", current: false, retention_pending: purgePending });
  if (!["ready", "insufficient_evidence"].includes(section.availability)) {
    const availability = section.availability === "purged" ? "purged" : section.availability === "unsupported" ? "unsupported" : "unavailable";
    return respond<EvidenceSection>({ availability, items: [] }, deps);
  }
  const refs = assessmentEvidenceRefs(artifact);
  const want = (source: string) => refs.flatMap(ref => ref.locator.source === source ? [ref.locator] : []);
  const [snapshots, runs, conversations, findings, leads] = await Promise.all([
    store.snapshots(want("summary_artifact").map(locator => "snapshot_id" in locator ? locator.snapshot_id : "")),
    store.runs([...want("legacy_run"), ...want("finding")].map(locator => "run_id" in locator ? locator.run_id : "")),
    store.conversations(want("conversation_summary").map(locator => "conversation_id" in locator && locator.conversation_id ? locator.conversation_id : "")),
    store.findingsById(want("finding").map(locator => "finding_id" in locator ? locator.finding_id : "")),
    store.leads(want("lead").flatMap(locator => locator.source === "lead" ? [{ model: locator.model, id: locator.id }] : [])),
  ]);
  return respond(evidenceSection(refs, { snapshots: new Map(snapshots.map(row => [String(row._id), row])), runs: new Map(runs.map(row => [String(row._id), row])),
    conversations: new Map(conversations.map(row => [String(row._id), row])), findings: new Map(findings.map(row => [String(row._id), row])), leads }), deps);
}

async function loadRun(runId: string, store: AssessmentStore) {
  const run = await store.run(csiIdSchema.parse(runId));
  if (!run) return null;
  const summaryIds = (() => { const value = (run.step_artifacts as { summaries?: unknown } | null | undefined)?.summaries; return Array.isArray(value) ? value.map(String) : []; })();
  const [summaries, purgePending] = await Promise.all([store.snapshots(summaryIds), retentionPending(store, run.contact_number_id == null ? null : String(run.contact_number_id))]);
  return { run, summaries, purgePending };
}

/** `GET /analysis-runs/:id/presentation`: Summary & findings, Evidence and Full output references for a legacy or structured run. */
export async function readRunPresentation(runId: string, deps: AssessmentReadDeps = {}) {
  const store = deps.store ?? mongoAssessmentStore;
  const loaded = await loadRun(runId, store);
  if (!loaded) return null;
  const { run, summaries, purgePending } = loaded;
  const [findings, effects] = await Promise.all([store.findings(String(run._id)), store.effects(String(run._id))]);
  const cited = findings.flatMap(finding => {
    const evidence = (finding.assertion as { evidence?: unknown } | null)?.evidence;
    return Array.isArray(evidence) ? evidence.flatMap(ref => typeof ref === "object" && ref && "snapshot_id" in ref ? [String(ref.snapshot_id)] : []) : [];
  });
  const envelopeFindings = (run.output as { findings?: { evidence?: { snapshot_id?: string }[] }[] } | null | undefined)?.findings ?? [];
  const envelopeCited = envelopeFindings.flatMap(finding => (finding.evidence ?? []).flatMap(ref => (ref.snapshot_id ? [ref.snapshot_id] : [])));
  const targets = effects.filter(effect => effect.target_id && ["create_followup", "revise_followup", "complete_followup"].includes(effect.effect_kind)).map(effect => String(effect.target_id));
  const [snapshots, actions] = await Promise.all([store.snapshots([...cited, ...envelopeCited]), store.followups(targets)]);
  return respond<RunPresentation>(runPresentation({ run, findings, effects, actions, summaries, retention_pending: purgePending,
    snapshots: new Map(snapshots.map(row => [String(row._id), row])) }), deps);
}

/** `GET /analysis-runs/:id/output/:outputId`: one retained run output (the run's envelope, or a captured conversation summary). */
export async function readRunOutput(runId: string, outputId: string, deps: AssessmentReadDeps = {}) {
  const store = deps.store ?? mongoAssessmentStore;
  const loaded = await loadRun(runId, store);
  if (!loaded) return null;
  const output = runFullOutput({ run: loaded.run, summaries: loaded.summaries, retention_pending: loaded.purgePending }, csiIdSchema.parse(outputId));
  return output ? respond<FullOutput>(output, deps) : null;
}
