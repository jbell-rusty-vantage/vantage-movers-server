/**
 * SRV-3 replica proof for the transactional desk paths (local csi01 loopback replica only; synthetic
 * rows in a unique database that is dropped afterwards). Run with `pnpm test:outreach:replica`.
 * Never loads production env.
 *
 * Proves on real Mongo transactions what the unit tests prove on in-memory stand-ins:
 * - policy-period transition: close + open in one transaction, one active period (partial unique
 *   index), unique semantic transition key, a repeated priority and a concurrent duplicate refresh
 *   open nothing extra;
 * - enrollment: report writes nothing; apply in checkpointed batches; a crashed lease holder blocks
 *   until its lease expires, then the run resumes from the checkpoint with no duplicates and the same
 *   activation boundary; re-apply is idempotent; verify is consistent;
 * - the entity_changes tail: durable (applied_at, _id) cursor, overlap pick-up of a late commit,
 *   jobs nominated once per Lead revision; the revision reconcile nominates a drifted Lead.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { csiEnqueueReplicaTarget } from "../lib/csi-enqueue-replica-target";

const database = `testvantagemovers_sodsubjects${randomUUID().replaceAll("-", "")}`;
for (const key of Object.keys(process.env))
  if (/RINGCENTRAL|^RC_|BLOB|GATEWAY|OPENAI|ANTHROPIC|VERCEL|KV_REST|REDIS|UPSTASH|QSTASH|GOOGLE|MONGO|DOTENV/i.test(key)) delete process.env[key];
process.env.DOTENV_CONFIG_PATH = `${__dirname}/.sod-subjects-replica-no-dotenv.env`;
process.env.MONGO_URI = csiEnqueueReplicaTarget(process.argv);
process.env.TEST_MODE = "true";
process.env.TEST_MONGO_DATABASE_NAME = database;
process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID = "sod-subjects-replica";
process.env.SHEET_SYNC_MODE = "disabled";

const oid = () => new mongoose.Types.ObjectId();
const at = (iso: string) => new Date(iso);
/** ET wall clock stored in a UTC Date, as every live ingestion path writes `timestamp`. */
const wallClock = (iso: string) => {
  const date = at(iso);
  const ny = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const part = (type: string) => Number(ny.find((p) => p.type === type)!.value);
  return new Date(Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second")));
};

async function main() {
  const { connectMongo, withTransaction } = await import("../../src/db.js");
  const { SALES_OUTREACH_MODEL_REGISTRY } = await import("../../src/models/salesOutreach/registry.js");
  const { getSalesIntelligenceJobModel } = await import("../../src/models/SalesIntelligenceJob.js");
  const { getSalesIntelligenceSyncStateModel } = await import("../../src/models/SalesIntelligenceSyncState.js");
  const { getSalesIntelligenceCommandExecutionModel } = await import("../../src/models/SalesIntelligenceCommandExecution.js");
  const { getSalesIntelligenceAuditEventModel } = await import("../../src/models/SalesIntelligenceAuditEvent.js");
  const { getEntityChangeModel } = await import("../../src/models/EntityChange.js");
  const { csiOperatorActor } = await import("../../src/services/salesIntelligence/auth.js");
  const { patchSalesOutreachConfiguration } = await import("../../src/services/salesOutreach/config/commands.js");
  const { createConfigurationLoader } = await import("../../src/services/salesOutreach/config/load.js");
  const { mongoDeskSubjectStore } = await import("../../src/services/salesOutreach/subjects/store.js");
  const { refreshLeadForOutreach, runOutreachLeadChangeJob } = await import("../../src/services/salesOutreach/subjects/leadChangeJob.js");
  const { scanOutreachLeadChanges, reconcileOutreachRevisions, OUTREACH_LEAD_CHANGE_SCOPE } = await import("../../src/services/salesOutreach/subjects/feed.js");
  const { reportEnrollment, applyEnrollment, verifyEnrollment } = await import("../../src/services/salesOutreach/enrollment/service.js");
  const { mongoEnrollmentStore } = await import("../../src/services/salesOutreach/enrollment/store.js");
  const { getSalesOutreachEnrollmentRunModel } = await import("../../src/models/salesOutreach/enrollmentRuns.js");
  const { FINAL01_CADENCE } = await import("../lib/sales-outreach-final01.js");
  await connectMongo();
  assert.equal(mongoose.connection.name, database);

  const csiModels = [
    getSalesIntelligenceJobModel(),
    getSalesIntelligenceSyncStateModel(),
    getSalesIntelligenceCommandExecutionModel(),
    getSalesIntelligenceAuditEventModel(),
    getEntityChangeModel(),
    ...SALES_OUTREACH_MODEL_REGISTRY.map((e) => e.model()),
  ];
  for (const Model of csiModels) {
    await Model.createCollection();
    await Model.createIndexes();
  }
  const db = mongoose.connection.useDb(database, { useCache: true }).db!;
  for (const name of ["form_leads", "call_leads", "number_lead_attachments", "rep_identity_links", "granot_observations"]) await db.createCollection(name);

  const owner = csiOperatorActor("sod-subjects-replica");
  const loader = createConfigurationLoader();
  const configure = async (key: string, expected: number, intakeAt: string | null) =>
    patchSalesOutreachConfiguration({
      actor: owner,
      idempotency_key: key,
      expected_revision: expected,
      value: {
        cadence: FINAL01_CADENCE,
        transition: {
          backfill_lookback_days: 90,
          backfill_include_upcoming_moves: true,
          intake_admission_enabled: intakeAt !== null,
          intake_admission_at: intakeAt,
        },
        migration: { paused: false, batch_size: 25, interval_seconds: 0 },
      },
    });
  await configure("sod-subjects-1", 0, "2026-10-01T00:00:00.000Z");

  const forms = db.collection("form_leads");
  const insertLead = async (overrides: Record<string, unknown> = {}) => {
    const _id = oid();
    await forms.insertOne({
      _id,
      ingestion_origin: "wordpress_form",
      timestamp: wallClock("2026-10-02T14:00:00Z"),
      createdAt: at("2026-10-02T14:00:03Z"),
      domain_revision: 1,
      last_changed_at: at("2026-10-02T14:00:03Z"),
      phone_number: "(555) 010-0000",
      normalized_phone_number: "5550100000",
      name: "Synthetic Customer",
      duplicate: false,
      no_sync: false,
      ...overrides,
    });
    return { model: "FormLead" as const, id: String(_id) };
  };
  const Periods = SALES_OUTREACH_MODEL_REGISTRY.find((e) => e.name === "SalesOutreachPolicyPeriod")!.model();
  const Subjects = SALES_OUTREACH_MODEL_REGISTRY.find((e) => e.name === "SalesOutreachSubject")!.model();

  // 1. Period transition on real transactions.
  const lead = await insertLead({ granot_priority: "0", last_accepted_granot_observation: { observation_id: oid(), captured_at: at("2026-10-02T14:01:00Z") } });
  const refresh = (asOf: string) =>
    withTransaction(async (session) => refreshLeadForOutreach(lead, (await loader.requireActive(session)), at(asOf), mongoDeskSubjectStore, session));
  assert.equal((await refresh("2026-10-02T15:00:00Z")).outcome, "created", "intake admission");
  const quotedObservation = oid();
  await forms.updateOne({ _id: new mongoose.Types.ObjectId(lead.id) }, { $set: { granot_priority: "1", last_accepted_granot_observation: { observation_id: quotedObservation, captured_at: at("2026-10-03T14:00:00Z") }, domain_revision: 2 } });
  const concurrent = await Promise.allSettled([refresh("2026-10-03T15:00:00Z"), refresh("2026-10-03T15:00:00Z")]);
  assert.ok(concurrent.some((r) => r.status === "fulfilled"), "at least one refresh commits");
  assert.equal(await Periods.countDocuments({}), 2, "exactly one transition despite the concurrent refresh");
  assert.equal(await Periods.countDocuments({ ended_at: null }), 1, "one active period");
  await refresh("2026-10-03T16:00:00Z");
  assert.equal(await Periods.countDocuments({}), 2, "a repeated accepted priority is a no-op");
  const active = await Periods.findOne({ ended_at: null }).lean();
  await assert.rejects(Periods.collection.insertOne({ ...active, _id: oid() }), /E11000/, "unique transition key / one active period");

  // 2. Enrollment: report zero writes, apply, crash-resume, re-apply, verify.
  for (let i = 0; i < 60; i++)
    await insertLead({
      ingestion_origin: "best_relocation_sheet",
      createdAt: at("2026-09-01T14:00:00Z"),
      timestamp: wallClock("2026-08-20T14:00:00Z"),
      granot_priority: i % 2 ? "1" : "0",
      last_accepted_granot_observation: { observation_id: oid(), captured_at: at("2026-08-20T15:00:00Z") },
    });
  const counts = async () => Object.fromEntries(await Promise.all(csiModels.map(async (M) => [M.collection.collectionName, await M.collection.countDocuments({})])));
  const before = await counts();
  const report = await reportEnrollment({ selection: { mode: "backfill_scope" } });
  assert.deepEqual(await counts(), before, "report writes nothing");
  assert.equal(report.lead_refs.length, 60);
  const body = { actor: owner, run_key: "replica-backfill", kind: report.kind, cohort_id: report.cohort_id, lead_refs: report.lead_refs, manifest_hash: report.manifest_hash };
  const first = await applyEnrollment({ ...body, deadline_ms: 0 });
  assert.deepEqual([first.status, first.next_index], ["running", 25]);
  const crashed = await mongoEnrollmentStore.acquireRunLease("replica-backfill", "dead-worker", new Date(), 300_000);
  assert.ok(crashed, "a second worker takes the lease and dies");
  assert.equal((await applyEnrollment(body)).status, "lease_held");
  await getSalesOutreachEnrollmentRunModel().updateOne({ run_key: "replica-backfill" }, { $set: { leased_until: new Date(Date.now() - 1_000) } });
  const resumed = await applyEnrollment(body);
  assert.deepEqual([resumed.status, resumed.counts.enrolled], ["completed", 60]);
  assert.equal(resumed.activation_at, first.activation_at, "the boundary is never repriced");
  assert.equal(await Subjects.countDocuments({ "enrollment.manifest_hash": report.manifest_hash }), 60, "no duplicates");
  const afterApply = await counts();
  const again = await applyEnrollment(body);
  assert.deepEqual([again.status, again.replayed], ["completed", true]);
  assert.deepEqual(await counts(), afterApply, "re-apply writes nothing");
  const verified = await verifyEnrollment({ actor: owner, run_key: "replica-backfill" });
  assert.deepEqual([verified.consistent, verified.counts.enrolled_by_run], [true, 60]);

  // 3. entity_changes tail and revision reconcile.
  const Jobs = getSalesIntelligenceJobModel();
  const changes = getEntityChangeModel().collection;
  const change = (revisionBefore: number, appliedAt: Date) => ({
    _id: oid(),
    entity: { model: "FormLead", id: lead.id },
    command_execution_id: oid(),
    command_name: "replica",
    provenance: { source_system: "vantage", actor: { kind: "system", id: "replica" }, initiator: { kind: "system", id: "replica" } },
    changed_paths: ["granot_priority"],
    fields: [{ path: "granot_priority", value_mode: "stored", before: "1", after: "1" }],
    revision_before: revisionBefore,
    revision_after: revisionBefore + 1,
    applied_at: appliedAt,
  });
  const now = new Date();
  await changes.insertOne(change(2, new Date(+now - 30_000)));
  const pass = await scanOutreachLeadChanges(now);
  assert.equal(pass.nominated, 1);
  const cursor = await getSalesIntelligenceSyncStateModel().findOne({ scope: OUTREACH_LEAD_CHANGE_SCOPE }).lean();
  assert.ok(cursor?.cursor?.entity_change_applied_at, "durable cursor stored");
  await changes.insertOne(change(3, new Date(+now - 60_000))); // committed late, behind the cursor
  await scanOutreachLeadChanges(new Date(+now + 5_000));
  assert.ok(await Jobs.exists({ dedupe_key: `sod:lead-change:FormLead:${lead.id}:r4` }), "overlap picks up the late commit");
  assert.equal(await Jobs.countDocuments({ stage: "outreach_lead_change" }), 2, "one job per Lead revision");
  assert.equal((await runOutreachLeadChangeJob()).status, "completed");
  await forms.updateOne({ _id: new mongoose.Types.ObjectId(lead.id) }, { $set: { domain_revision: 9 } }); // a write that skipped its EntityChange
  const reconciled = await reconcileOutreachRevisions(new Date());
  assert.ok(reconciled.nominated >= 1);
  assert.ok(await Jobs.exists({ dedupe_key: `sod:lead-change:FormLead:${lead.id}:r9` }));
  console.log("PASS: period transition atomicity/uniqueness, enrollment report/apply/crash-resume/re-apply/verify, tail cursor + overlap, revision reconcile");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.name === database) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
