import assert from "node:assert/strict";
import { test } from "node:test";
import { unknownCoverageFixture } from "../fixtures";
import { outreachAssessmentDtoSchema } from "./dto";
import type { ArtifactRow, RunRow, SnapshotRow } from "./presentation";
import { readAssessment, readAssessmentEvidence, readAssessmentOutput, readOutreachAssessment, readRunOutput, readRunPresentation, type AssessmentStore, type RecordLite } from "./reads";
import {
  IDS, artifact, conversationRow, hex, legacyActions, legacyEffects, legacyFindings, legacyRun, oldArtifact, purgedArtifact, snapshot, structuredRun, summaryArtifactResponse,
} from "./presentation.fixtures";

type World = { records?: RecordLite[]; artifacts?: ArtifactRow[]; pending?: string[]; purgePending?: string[]; runs?: RunRow[]; snapshots?: SnapshotRow[] };
/** In-memory store with the same contract as the Mongo store; records every query so tests can assert no per-row or write traffic. */
function store(world: World) {
  const calls: string[] = [];
  const log = <T>(name: string, value: T) => { calls.push(name); return Promise.resolve(value); };
  const s: AssessmentStore = {
    record: id => log("record", world.records?.find(r => String(r._id) === id) ?? null),
    artifacts: key => log("artifacts", (world.artifacts ?? []).filter(a => a.subject_key === key && !a.shadow).sort((a, b) => +b.createdAt! - +a.createdAt!)),
    artifact: id => log("artifact", world.artifacts?.find(a => String(a._id) === id) ?? null),
    pendingJob: key => log("pendingJob", Boolean(world.pending?.includes(key))),
    purgePending: id => log("purgePending", Boolean(world.purgePending?.includes(id))),
    run: id => log("run", world.runs?.find(r => String(r._id) === id) ?? null),
    runs: ids => log("runs", (world.runs ?? []).filter(r => ids.includes(String(r._id)))),
    findings: runId => log("findings", runId === IDS.legacyRun ? legacyFindings() : []),
    findingsById: ids => log("findingsById", legacyFindings().filter(f => ids.includes(String(f._id)))),
    effects: runId => log("effects", runId === IDS.legacyRun ? legacyEffects() : []),
    followups: ids => log("followups", legacyActions().filter(a => ids.includes(String(a._id)))),
    snapshots: ids => log("snapshots", (world.snapshots ?? []).filter(row => ids.includes(String(row._id)))),
    conversations: ids => log("conversations", ids.includes(IDS.conversation) ? [conversationRow()] : []),
    leads: refs => log("leads", new Set(refs.map(ref => `${ref.model}:${ref.id}`))),
  };
  return { deps: { store: s, coverage: async () => unknownCoverageFixture }, calls };
}
const lead = (over: Partial<RecordLite> = {}): RecordLite => ({ _id: IDS.record, state: "open", subject: { kind: "lead", model: "FormLead", id: IDS.lead, contact_number_id: null },
  primary_contact_number_id: IDS.number, lead_progress: null, move_assessment: null, ...over });
const projection = (artifactId = IDS.artifactNew, extra: Record<string, unknown> = {}) => ({ artifact_id: artifactId, status: "ready", transaction_intent: 50, move_likelihood: 75,
  stale: false, stale_reason: null, context_as_of: new Date(), published_at: new Date(), ...extra });
const SUBJECT = `lead:FormLead:${IDS.lead}`;

test("no assessment and nothing queued → not_assessed; a queued job or in-flight artifact → pending; closure precedes both", async () => {
  const none = await readOutreachAssessment(IDS.record, store({ records: [lead()] }).deps);
  assert.deepEqual([none!.data.availability, none!.data.current, none!.data.versions], ["not_assessed", null, []]);
  outreachAssessmentDtoSchema.parse(none!.data);
  assert.equal(none!.as_of.length > 0, true);
  const queued = await readOutreachAssessment(IDS.record, store({ records: [lead()], pending: [SUBJECT] }).deps);
  assert.equal(queued!.data.availability, "pending");
  const inFlight = await readOutreachAssessment(IDS.record, store({ records: [lead()], artifacts: [artifact({ status: "pending", scores: null })] }).deps);
  assert.deepEqual([inFlight!.data.availability, inFlight!.data.versions.length], ["pending", 0], "a pending artifact is not a version");
  const closed = await readOutreachAssessment(IDS.record, store({ records: [lead({ state: "closed" })], pending: [SUBJECT] }).deps);
  assert.deepEqual([closed!.data.availability, closed!.data.subject.applicability], ["not_applicable", "closed"]);
  assert.equal(await readOutreachAssessment(hex(999), store({ records: [lead()] }).deps), null);
});

test("current is the projection's artifact; versions list every non-shadow artifact newest first with labels; stale comes from the projection", async () => {
  const world = { records: [lead({ move_assessment: projection(IDS.artifactOld, { stale: true, stale_reason: "move_date_passed" }) })],
    artifacts: [artifact(), oldArtifact(), purgedArtifact(), artifact({ _id: IDS.artifactInsufficient, status: "insufficient_evidence", createdAt: new Date(Date.UTC(2026, 8, 13)) }),
      artifact({ _id: IDS.artifactFailed, status: "failed", createdAt: new Date(Date.UTC(2026, 8, 12)), scores: null }), artifact({ _id: hex(75), shadow: true })] };
  const read = (await readOutreachAssessment(IDS.record, store(world).deps))!.data;
  assert.equal(read.current?.artifact_id, IDS.artifactOld, "the projection wins over a newer unpublished artifact");
  assert.equal(read.current?.transaction_intent.label, "Unknown");
  assert.equal(read.current?.move_likelihood.stale, true);
  assert.deepEqual(read.versions.map(v => [v.artifact_id, v.label, v.current]), [
    [IDS.artifactNew, "Assessed", false], [IDS.artifactOld, "Assessed", true], [IDS.artifactPurged, "Purged", false],
    [IDS.artifactInsufficient, "Insufficient evidence", false], [IDS.artifactFailed, "Failed", false]]);
  assert.ok(!read.versions.some(v => v.artifact_id === hex(75)), "shadow artifacts are never versions");
  // No projection yet (e.g. backfill shadow promoted later): the newest settled artifact is shown, not marked current.
  const unpublished = (await readOutreachAssessment(IDS.record, store({ ...world, records: [lead()] }).deps))!.data;
  assert.deepEqual([unpublished.current?.artifact_id, unpublished.current?.current, unpublished.availability], [IDS.artifactNew, false, "ready"]);
});

test("legacy analysis plus a new assessment, assessment-only and Lead-only subjects without a Contact Number read independently", async () => {
  const world = { records: [lead({ move_assessment: projection() })], artifacts: [artifact()], runs: [legacyRun()],
    snapshots: [snapshot(IDS.transcriptSnapshot, { t: 1 }), snapshot(IDS.recordSnapshot, { r: 1 })] };
  const { deps } = store(world);
  const assessment = (await readOutreachAssessment(IDS.record, deps))!.data;
  const run = (await readRunPresentation(IDS.legacyRun, deps))!.data;
  assert.equal(assessment.current?.generated_at, "2026-09-20T12:00:00.000Z");
  assert.equal(run.summary_findings.source.generated_at, "2026-09-10T12:00:00.000Z", "sections keep their own time and source");
  assert.equal(run.summary_findings.applied_actions.length, 1);
  // Assessment-only: no run exists for the subject; the assessment is complete on its own.
  const only = store({ records: [lead({ move_assessment: projection() })], artifacts: [artifact()] });
  assert.equal((await readOutreachAssessment(IDS.record, only.deps))!.data.availability, "ready");
  assert.equal(await readRunPresentation(IDS.legacyRun, only.deps), null);
  // Lead-only subject without any Contact Number: no retention probe is attempted and the read succeeds.
  const leadOnly = store({ records: [lead({ primary_contact_number_id: null, move_assessment: projection() })], artifacts: [artifact({ contact_number_id: null, input_mode: "lead_only" })] });
  const read = (await readOutreachAssessment(IDS.record, leadOnly.deps))!.data;
  assert.deepEqual([read.availability, read.subject.contact_number_id, read.current?.input_mode], ["ready", null, "lead_only"]);
  assert.ok(!leadOnly.calls.includes("purgePending"));
  assert.equal((await readAssessmentOutput(IDS.artifactNew, leadOnly.deps))!.data.availability, "ready");
});

test("retention: purged artifacts return tombstones; content_purge_pending returns unavailable for assessment, output, evidence and runs", async () => {
  const purged = store({ records: [lead()], artifacts: [purgedArtifact()] });
  const section = (await readAssessment(IDS.artifactPurged, purged.deps))!.data;
  assert.deepEqual([section.availability, section.transaction_intent.score, section.inventory.items.length], ["purged", null, 0]);
  assert.deepEqual((await readAssessmentOutput(IDS.artifactPurged, purged.deps))!.data.model_output, null);
  assert.deepEqual((await readAssessmentEvidence(IDS.artifactPurged, purged.deps))!.data, { availability: "purged", items: [] });
  const pending = store({ records: [lead({ move_assessment: projection() })], artifacts: [artifact()], purgePending: [IDS.number], runs: [legacyRun()] });
  assert.equal((await readOutreachAssessment(IDS.record, pending.deps))!.data.current?.availability, "unavailable");
  assert.equal((await readAssessment(IDS.artifactNew, pending.deps))!.data.availability, "unavailable");
  assert.deepEqual((await readAssessmentOutput(IDS.artifactNew, pending.deps))!.data.model_output, null);
  assert.deepEqual((await readAssessmentEvidence(IDS.artifactNew, pending.deps))!.data, { availability: "unavailable", items: [] });
  assert.equal((await readRunPresentation(IDS.legacyRun, pending.deps))!.data.summary_findings.availability, "unavailable");
  // Shadow artifacts are not readable through the Owner detail routes.
  assert.equal(await readAssessment(hex(75), store({ artifacts: [artifact({ _id: hex(75), shadow: true })] }).deps), null);
});

test("evidence read batches one query per source collection and resolves every citation kind", async () => {
  const world = { records: [lead({ move_assessment: projection() })], artifacts: [artifact()], runs: [legacyRun()], snapshots: [snapshot(IDS.summarySnapshot, summaryArtifactResponse())] };
  const { deps, calls } = store(world);
  const evidence = (await readAssessmentEvidence(IDS.artifactNew, deps))!.data;
  assert.equal(evidence.availability, "ready");
  assert.deepEqual(evidence.items.map(i => [i.id, i.availability]), [["e1", "retained"], ["e3", "retained"], ["e2", "retained"], ["e4", "retained"], ["e5", "retained"], ["e6", "retained"], ["e7", "retained"]]);
  for (const name of ["snapshots", "runs", "conversations", "findingsById", "leads"]) assert.equal(calls.filter(c => c === name).length, 1, name);
});

test("structured run presentation and its full outputs: the captured summary and the findings envelope are separately addressable", async () => {
  const summary = snapshot(IDS.summarySnapshot, summaryArtifactResponse(), { run_id: IDS.structuredRun });
  const { deps } = store({ runs: [structuredRun()], snapshots: [summary] });
  const view = (await readRunPresentation(IDS.structuredRun, deps))!.data;
  assert.equal(view.summary_findings.source.kind, "structured_run");
  assert.equal(view.summary_findings.said_on_call.length, 1);
  assert.deepEqual(view.full_output.map(r => r.kind), ["conversation_summary", "findings"]);
  assert.equal((await readRunOutput(IDS.structuredRun, IDS.summarySnapshot, deps))!.data.kind, "conversation_summary");
  assert.equal((await readRunOutput(IDS.structuredRun, IDS.structuredRun, deps))!.data.kind, "findings");
  assert.equal(await readRunOutput(IDS.structuredRun, hex(404), deps), null);
  assert.equal(await readRunPresentation(hex(404), deps), null);
});
