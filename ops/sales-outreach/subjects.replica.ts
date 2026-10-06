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
 *   jobs nominated once per Lead revision; the revision reconcile nominates a drifted Lead;
 * - olr B1: a review subject whose priority is accepted a day later opens one late first period
 *   (`activation`, at the observation time), and the repair script moves a pre-B1 row (intake start
 *   at the boundary) to that start in one audited transaction with its evaluate nomination, once;
 * - olr B7: `GET /enrollment/candidates` lists only the report's backfill scope (review count = the
 *   report's, in_scope = its selection, older unchanged), and the explained plans stay bounded: the
 *   upcoming-move branch reads `sod_form_lead_move_date`, the window branch examines only Leads created
 *   since its `_id` bound.
 */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
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
  const { reportEnrollment, applyEnrollment, verifyEnrollment, listEnrollmentCandidates, candidateLegs } = await import("../../src/services/salesOutreach/enrollment/service.js");
  const { mongoEnrollmentStore, leadScanQuery } = await import("../../src/services/salesOutreach/enrollment/store.js");
  const { SALES_OUTREACH_READ_INDEXES, createIndexOptions } = await import("../lib/sales-outreach-indexes.js");
  const { getSalesOutreachEnrollmentRunModel } = await import("../../src/models/salesOutreach/enrollmentRuns.js");
  const { FINAL01_CADENCE } = await import("../lib/sales-outreach-final01.js");
  const { applyRepair, reportRepair, REPAIR_EVENT_KIND } = await import("../lib/sales-outreach-repair-late-first-periods.js");
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
  for (const name of ["form_leads", "call_leads", "rep_identity_links", "granot_observations"]) await db.createCollection(name);

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
    const _id = (overrides._id as mongoose.Types.ObjectId | undefined) ?? oid();
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

  // 4. olr B1: intake review subject, priority accepted one day later, on real transactions.
  const refreshLead = (ref: { model: "FormLead"; id: string }, asOf: string) =>
    withTransaction(async (session) => refreshLeadForOutreach(ref, (await loader.requireActive(session)), at(asOf), mongoDeskSubjectStore, session));
  const granotLead = (received: string) =>
    insertLead({ ingestion_origin: "granot_lead_created", timestamp: at(received), createdAt: at(received), last_changed_at: at(received) });
  const review = await granotLead("2026-10-04T14:00:00Z");
  assert.equal((await refreshLead(review, "2026-10-04T14:05:00Z")).outcome, "created", "admitted as a review subject");
  const reviewSubject = await Subjects.findOne({ lead_id: new mongoose.Types.ObjectId(review.id) }).lean();
  assert.equal(reviewSubject?.status, "review");
  assert.equal(await Periods.countDocuments({ subject_id: reviewSubject!._id }), 0, "no guessed cadence while in review");
  const acceptedAt = at("2026-10-05T15:00:00Z");
  await forms.updateOne(
    { _id: new mongoose.Types.ObjectId(review.id) },
    { $set: { granot_priority: "0", last_accepted_granot_observation: { observation_id: oid(), captured_at: acceptedAt }, domain_revision: 2, last_changed_at: acceptedAt } },
  );
  await refreshLead(review, "2026-10-05T16:00:00Z");
  const latePeriods = await Periods.find({ subject_id: reviewSubject!._id }).lean();
  assert.equal(latePeriods.length, 1, "one period");
  assert.deepEqual(
    [latePeriods[0]!.workflow, latePeriods[0]!.start_kind, latePeriods[0]!.started_at.toISOString(), latePeriods[0]!.time_basis],
    ["new", "activation", acceptedAt.toISOString(), "accepted_observation_captured_at"],
    "late first period: activation at the observation time, not at received",
  );
  assert.equal((await Subjects.findOne({ _id: reviewSubject!._id }).lean())?.status, "active");

  // 5. olr B1 repair script: a pre-B1 row (intake start at the boundary, written a day after its subject).
  const legacy = await granotLead("2026-10-04T15:00:00Z");
  await refreshLead(legacy, "2026-10-04T15:05:00Z");
  const legacySubject = (await Subjects.findOne({ lead_id: new mongoose.Types.ObjectId(legacy.id) }).lean())!;
  await Subjects.collection.updateOne({ _id: legacySubject._id }, { $set: { createdAt: new Date(Date.now() - 86_400_000) } });
  const observationId = oid();
  const observedAt = at("2026-10-05T17:30:00Z");
  await db.collection("granot_observations").insertOne({ _id: observationId, captured_at: observedAt });
  const legacyPeriodId = oid();
  await Periods.collection.insertOne({
    _id: legacyPeriodId,
    subject_id: legacySubject._id,
    transition_key: `priority:observation:${observationId}:quoted:1`,
    policy_version: "replica",
    activation_boundary: legacySubject.enrollment.activation_at,
    workflow: "quoted",
    start_kind: "intake",
    priority: "1",
    priority_source_ref: String(observationId),
    priority_source_revision: 2,
    started_at: legacySubject.enrollment.activation_at,
    ended_at: null,
    end_reason: null,
    time_basis: "activation_boundary",
    age_anchor: "2026-10-04",
    anchor_quality: "instant",
    adapter_version: "lead-instant-v1",
    revision: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const dry = await reportRepair();
  assert.equal(dry.summary.repairable, 1, "only the pre-B1 row (step 1's intake period was written with its subject)");
  assert.equal(await Periods.countDocuments({ _id: legacyPeriodId, start_kind: "intake" }), 1, "the dry run writes nothing");
  const repairRun = await applyRepair({ actor: owner, run_id: "replica-repair" });
  assert.deepEqual([repairRun.repaired, repairRun.conflicts], [[String(legacyPeriodId)], []]);
  const repaired = (await Periods.findById(legacyPeriodId).lean())!;
  assert.deepEqual(
    [repaired.start_kind, repaired.started_at.toISOString(), repaired.time_basis, repaired.revision],
    ["activation", observedAt.toISOString(), "accepted_observation_captured_at", 2],
  );
  assert.equal(await getSalesIntelligenceAuditEventModel().countDocuments({ event_kind: REPAIR_EVENT_KIND, "invalidation.target_id": String(legacyPeriodId) }), 1, "one audit row");
  assert.ok(await Jobs.exists({ dedupe_key: `sod:evaluate:${String(legacySubject._id)}:repair:${String(legacyPeriodId)}`, stage: "outreach_evaluate" }), "evaluate nominated");
  assert.equal((await reportRepair()).summary.repairable, 0, "dry run reports 0 after the apply");
  assert.deepEqual((await applyRepair({ actor: owner, run_id: "replica-repair-2" })).repaired, [], "a re-run writes nothing");

  // 6. olr B7: GET /enrollment/candidates is scoped like the report, and its Mongo plans are bounded.
  for (const { collection, indexes } of SALES_OUTREACH_READ_INDEXES)
    for (const spec of indexes) await db.collection(collection).createIndex(spec.key as Record<string, 1 | -1>, createIndexOptions(spec));
  const nowMs = Date.now();
  const daysAgo = (days: number) => new Date(nowMs - days * 86_400_000);
  const upcomingMove = new Date(Date.UTC(daysAgo(-30).getUTCFullYear(), daysAgo(-30).getUTCMonth(), daysAgo(-30).getUTCDate()));
  const unmapped = (capturedAt: Date) => ({ granot_priority: "42", last_accepted_granot_observation: { observation_id: oid(), captured_at: capturedAt } });
  /** An older Lead: inserted (its `_id` time) and received 300 days ago. */
  const olderLead = (overrides: Record<string, unknown>) =>
    insertLead({ _id: new mongoose.Types.ObjectId(Math.floor(+daysAgo(300) / 1000).toString(16).padStart(8, "0") + randomBytes(8).toString("hex")), timestamp: wallClock(daysAgo(300).toISOString()), createdAt: daysAgo(300), last_changed_at: daysAgo(300), ...overrides });
  const recentReviewLead = await insertLead({ timestamp: wallClock(daysAgo(2).toISOString()), createdAt: daysAgo(2), ...unmapped(daysAgo(2)) });
  const olderUpcomingReview = await olderLead({ move_date: upcomingMove, ...unmapped(daysAgo(300)) });
  const olderUpcomingReady = await olderLead({ move_date: upcomingMove });
  const olderOutOfScope: string[] = [];
  for (let i = 0; i < 30; i++) olderOutOfScope.push((await olderLead(i % 2 ? unmapped(daysAgo(300)) : {})).id);
  const scopeReport = await reportEnrollment({ selection: { mode: "backfill_scope" } });
  const pages = async (partition: "review" | "in_scope" | "older") => {
    const keys: string[] = [];
    let cursor: string | undefined;
    for (let n = 0; n < 50; n++) {
      const page = await listEnrollmentCandidates({ partition, cursor, limit: 7 });
      keys.push(...page.items.map((item) => item.lead.id));
      if (!page.next_cursor) return keys;
      cursor = page.next_cursor;
    }
    throw new Error("candidate paging did not finish");
  };
  const reviewIds = await pages("review");
  assert.equal(reviewIds.length, scopeReport.counts.review, "the review list holds exactly the report's review partition");
  assert.ok(reviewIds.includes(recentReviewLead.id) && reviewIds.includes(olderUpcomingReview.id), "window and upcoming-move review Leads are listed");
  assert.ok(!reviewIds.some((leadId) => olderOutOfScope.includes(leadId)), "older review Leads outside the scope are not");
  assert.deepEqual((await pages("in_scope")).sort(), scopeReport.lead_refs.map((ref) => ref.id).sort(), "in_scope = the report's selection (Ready to enroll)");
  assert.ok(scopeReport.lead_refs.some((ref) => ref.id === olderUpcomingReady.id));
  assert.equal((await pages("older")).filter((leadId) => olderOutOfScope.includes(leadId)).length, 15, "the 15 older New Leads stay on the older list");

  const backfillScope = scopeReport.scope as Parameters<typeof candidateLegs>[1];
  const [windowLeg, upcomingLeg] = candidateLegs("review", backfillScope);
  assert.equal(upcomingLeg?.b, "u");
  const explain = async (filter: Parameters<typeof leadScanQuery>[1]["filter"]) => {
    const q = leadScanQuery("FormLead", { after_id: null, limit: 200, direction: -1, filter });
    return (await forms.find(q.filter).sort(q.sort).limit(q.limit).explain("executionStats")) as unknown as { queryPlanner: unknown; executionStats: { totalDocsExamined: number; nReturned: number } };
  };
  const indexNames = (node: unknown): string[] =>
    !node || typeof node !== "object" ? [] : Object.entries(node).flatMap(([key, value]) => (key === "indexName" && typeof value === "string" ? [value] : indexNames(value)));
  const upcomingPlan = await explain(upcomingLeg!.filter);
  assert.ok(indexNames(upcomingPlan.queryPlanner).includes("sod_form_lead_move_date"), `upcoming-move branch reads its index: ${indexNames(upcomingPlan.queryPlanner).join(",")}`);
  assert.equal(upcomingPlan.executionStats.nReturned, 2);
  assert.ok(upcomingPlan.executionStats.totalDocsExamined <= 2, `upcoming-move branch examines only its matches (${upcomingPlan.executionStats.totalDocsExamined})`);
  const windowPlan = await explain(windowLeg!.filter);
  const sinceBound = await forms.countDocuments({ _id: { $gte: new mongoose.Types.ObjectId(windowLeg!.filter.id_from!) } });
  assert.ok(windowPlan.executionStats.totalDocsExamined <= sinceBound, `window branch examines only Leads created since the bound (${windowPlan.executionStats.totalDocsExamined} ≤ ${sinceBound})`);
  assert.ok(sinceBound <= (await forms.countDocuments({})) - 32, "the 32 older Leads lie below the bound");

  console.log("PASS: period transition atomicity/uniqueness, enrollment report/apply/crash-resume/re-apply/verify, tail cursor + overlap, revision reconcile, B1 late first period + repair, B7 scoped candidates + bounded plans");
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
