/**
 * SRV-8 replica proof (local csi01 loopback replica only; synthetic rows in a unique database that is
 * dropped afterwards). Part of `pnpm test:outreach:replica`. Never loads production env.
 *
 * Proves on real Mongo what the unit suites prove on the in-memory twin:
 * - the queue plan's Mongo translation returns exactly the in-memory semantics (`queueQuery.ts`) for
 *   every sort/direction, state, filter and search, page by page through the keyset, with the
 *   sentinel `queue_keys` (no reliance on Mongo's null ordering);
 * - the default Rep queue (`assigned_agent_id` + Needs contact + urgency) is served by the
 *   `sod_projection_q_urgency` index (IXSCAN, no blocking SORT);
 * - counts, team overdue figures and the assignment generation (changes on reassignment) match;
 * - S4: per-Agent cadence counts (overdue Leads, due call attempts / SMS sends, unknown remaining) equal
 *   the in-memory twin and reconcile with the team card; queue rows carry the stored `schedule_day`;
 *   Agent names resolve in one batched read (history names' fallback).
 * - olr A3-fresh: the Call Log row's projection carries the confirmation instants and the observed
 *   watermark; the newest call webhook receipt is one index walk (no blocking sort) that skips receipts
 *   without a telephony session.
 * - `publishOutreachLive` inserts land on a scoped change stream: a Rep stream sees only its own Agent's
 *   hints (plus configuration), an Owner stream sees all.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { csiEnqueueReplicaTarget } from "../lib/csi-enqueue-replica-target";

const database = `testvantagemovers_sodreads${randomUUID().replaceAll("-", "")}`;
for (const key of Object.keys(process.env))
  if (/RINGCENTRAL|^RC_|BLOB|GATEWAY|OPENAI|ANTHROPIC|VERCEL|KV_REST|REDIS|UPSTASH|QSTASH|GOOGLE|MONGO|DOTENV/i.test(key)) delete process.env[key];
process.env.DOTENV_CONFIG_PATH = `${__dirname}/.sod-reads-replica-no-dotenv.env`;
process.env.MONGO_URI = csiEnqueueReplicaTarget(process.argv);
process.env.TEST_MODE = "true";
process.env.TEST_MONGO_DATABASE_NAME = database;
process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID = "sod-reads-replica";
process.env.SHEET_SYNC_MODE = "disabled";

const at = (iso: string) => new Date(iso);

async function main() {
  const { connectMongo } = await import("../../src/db.js");
  const { SALES_OUTREACH_MODEL_REGISTRY } = await import("../../src/models/salesOutreach/registry.js");
  const { getSalesOutreachProjectionModel, getSalesOutreachSubjectModel } = await import("../../src/models/salesOutreach/index.js");
  const { evaluateAndProject, evaluationAdmissionOf } = await import("../../src/services/salesOutreach/evaluation/evaluateJob.js");
  const { capturedCoverage, completeConfigurationInput, periodRow, runInFakeTransaction, subjectRow, TEST_AGENT_A, TEST_AGENT_B } = await import(
    "../../src/services/salesOutreach/evaluation/testing.js"
  );
  const { activeInspection } = await import("../../src/services/salesOutreach/reads/testing.js");
  const { MemoryDeskReadStore } = await import("../../src/services/salesOutreach/reads/deskTesting.js");
  const { mongoDeskQueueStore } = await import("../../src/services/salesOutreach/reads/deskStore.js");
  const { mongoSalesOutreachReadStore } = await import("../../src/services/salesOutreach/reads/store.js");
  const { Agent } = await import("../../src/models/Agent.js");
  const { mongoQueueQuery, queueSearchOf, queueSortSpec, keysetOf } = await import("../../src/services/salesOutreach/reads/queueQuery.js");
  const { publishOutreachLive } = await import("../../src/services/salesOutreach/live/publish.js");
  const { watchOutreachLiveEvents, outreachLiveHint } = await import("../../src/services/salesOutreach/live/stream.js");
  await connectMongo();
  assert.equal(mongoose.connection.name, database);
  for (const entry of SALES_OUTREACH_MODEL_REGISTRY) {
    const Model = entry.model();
    await Model.createCollection();
    await Model.createIndexes();
  }

  // 1. Synthetic subjects evaluated by the real engine (in memory), then stored in Mongo as-is.
  const memory = new MemoryDeskReadStore();
  const admission = evaluationAdmissionOf(activeInspection(completeConfigurationInput({ cadence_enforcement_enabled: true }), "v-replica", 2));
  assert.ok(admission.ok);
  const names = ["Ana Lopez", "O'Brien (Senior)", "Zed .* Literal", "Kim Park", "Lee Chan", "Max Roe", "Ida Wu", "Bo Li"];
  for (let i = 0; i < 24; i++) {
    const received = new Date(Date.UTC(2026, 9, 5, 12 + (i % 7), (i * 7) % 60));
    const agent = i % 3 === 0 ? TEST_AGENT_A : i % 3 === 1 ? TEST_AGENT_B : null;
    const subject = subjectRow({
      id: new mongoose.Types.ObjectId().toHexString(),
      assigned_agent_id: agent,
      assignment_revision: agent ? 1 : 0,
      status: i % 11 === 10 ? "review" : "active",
      received_at: i % 9 === 8 ? null : received,
      enrollment: { cohort_id: "c", kind: "intake", enrolled_at: received, activation_at: received, manifest_hash: null },
      display: {
        job_no: i % 5 === 4 ? null : `P55612${String(i).padStart(2, "0")}`,
        normalized_job_no: i % 5 === 4 ? null : `P55612${String(i).padStart(2, "0")}`,
        phone: `(305) 555-01${String(i).padStart(2, "0")}`,
        normalized_phone: `30555501${String(i).padStart(2, "0")}`,
        name: names[i % names.length]!,
        move_date: i % 4 === 3 ? null : `2026-10-${String(6 + (i % 20)).padStart(2, "0")}`,
      },
    });
    memory.evaluation.subjects.set(subject.id, subject);
    memory.evaluation.periods.push(periodRow(subject.id, { started_at: received, workflow: i % 6 === 5 ? "quoted" : "new" }));
  }
  memory.evaluation.coverage = capturedCoverage(at("2026-10-05T18:58:00.000Z"));
  for (const id of memory.evaluation.subjects.keys())
    await runInFakeTransaction((session) => evaluateAndProject(id, admission.context, at("2026-10-05T18:59:00.000Z"), memory.evaluation, session));
  const oid = (v: unknown) => (typeof v === "string" && /^[a-f\d]{24}$/.test(v) ? new mongoose.Types.ObjectId(v) : v);
  await getSalesOutreachSubjectModel().collection.insertMany(
    [...memory.evaluation.subjects.values()].map((s) => ({
      _id: new mongoose.Types.ObjectId(s.id),
      lead_model: s.lead.model,
      lead_id: new mongoose.Types.ObjectId(s.lead.id),
      status: s.status,
      assigned_agent_id: oid(s.assigned_agent_id),
      assignment_revision: s.assignment_revision,
    })),
  );
  await getSalesOutreachProjectionModel().collection.insertMany(
    [...memory.evaluation.projections.entries()].map(([id, row]) => ({
      ...row.doc,
      subject_id: new mongoose.Types.ObjectId(id),
      assigned_agent_id: oid(row.doc.assigned_agent_id),
      period_id: oid(row.doc.period_id),
      revision: row.revision,
    })),
  );

  // 2. Every plan: Mongo pages through the keyset equal the in-memory semantics.
  const assignments = [{ kind: "all" as const }, { kind: "agent" as const, agent_id: TEST_AGENT_A }, { kind: "unassigned" as const }];
  const sorts = [["urgency", "asc"], ["lead_received", "desc"], ["lead_received", "asc"], ["last_interaction", "asc"], ["last_interaction", "desc"]] as const;
  const states = ["needs_contact", "all_active", "blocked", "pending"] as const;
  let plans = 0;
  for (const assignment of assignments)
    for (const [sort, direction] of sorts)
      for (const state of states)
        for (const search of [undefined, "o'brien (s", ".*", "p5561", "0107"]) {
          const match = {
            assignment,
            state,
            priority: { kind: "all" as const },
            workflow: null,
            move_date: search === undefined && state === "all_active" ? { from: "2026-10-08", to: null, unknown: "include" as const } : null,
            search: queueSearchOf(search),
          };
          const spec = queueSortSpec(sort, direction);
          const expected = (await memory.findQueuePage({ match, sort: spec, after: null, limit: 1000 })).map((r) => r.subject_id);
          const got: string[] = [];
          let after: string[] | null = null;
          for (let page = 0; page < 40; page++) {
            const rows = await mongoDeskQueueStore.findQueuePage({ match, sort: spec, after, limit: 4 });
            got.push(...rows.map((r) => r.subject_id));
            if (rows.length < 4) break;
            after = keysetOf(spec, rows.at(-1)!);
          }
          assert.deepEqual(got, expected, JSON.stringify({ assignment, sort, direction, state, search }));
          assert.equal(await mongoDeskQueueStore.countQueue(match), expected.length);
          plans++;
        }

  // 3. The Rep default query uses its index with no blocking sort.
  const repPlan = { match: { assignment: { kind: "agent" as const, agent_id: TEST_AGENT_A }, state: "needs_contact" as const, priority: { kind: "all" as const }, workflow: null, move_date: null, search: null }, sort: queueSortSpec("urgency", "asc"), after: null, limit: 26 };
  const { filter, sort } = mongoQueueQuery(repPlan);
  // Judge the winning plan only: the planner's rejected candidates legitimately include blocking sorts.
  const explain = (await getSalesOutreachProjectionModel().find(filter).sort(sort).limit(26).explain("queryPlanner")) as unknown as {
    queryPlanner: { winningPlan: unknown };
  };
  const winning = JSON.stringify(explain.queryPlanner.winningPlan);
  assert.match(winning, /sod_projection_q_urgency/);
  assert.doesNotMatch(winning, /"stage":"SORT"/);

  // 4. Team overdue figures and the assignment generation.
  const asOf = at("2026-10-05T19:00:00.000Z");
  const mongoTeam = await mongoDeskQueueStore.teamOverdue(asOf);
  const memoryTeam = await memory.teamOverdue(asOf);
  assert.deepEqual(mongoTeam, memoryTeam);

  // 4b (S4). Per-Agent cadence counts: Mongo equals the twin, and the per-rep overdue Leads plus the
  // Unassigned overdue part add up to the team's distinct overdue card (one rule).
  const unknownAgent = new mongoose.Types.ObjectId().toHexString();
  const agents = [TEST_AGENT_A, TEST_AGENT_B, unknownAgent, "not-an-id"];
  const sorted = (m: ReadonlyMap<string, unknown>) => [...m].sort(([a], [b]) => (a < b ? -1 : 1));
  const mongoCadence = await mongoDeskQueueStore.agentCadence(asOf, agents);
  assert.deepEqual(sorted(mongoCadence), sorted(await memory.agentCadence(asOf, agents)));
  assert.ok(!mongoCadence.has(unknownAgent), "an Agent without active Leads is absent");
  const perRepOverdue = [...mongoCadence.values()].reduce((sum, c) => sum + c.overdue_leads, 0);
  assert.equal(perRepOverdue + mongoTeam.unassigned_overdue, mongoTeam.distinct_overdue);
  assert.ok([...mongoCadence.values()].some((c) => c.call_due_remaining > 0 || c.overdue_leads > 0), "the fixture exercises the counts");
  assert.ok([...mongoCadence.values()].some((c) => c.sms_due_unknown > 0), "SMS without coverage counts as unknown, never 0");

  // 4c (S4). Queue rows carry the stored schedule day (projection reads only `detail.schedule_day`).
  const allMatch = { assignment: { kind: "all" as const }, state: "all_active" as const, priority: { kind: "all" as const }, workflow: null, move_date: null, search: null };
  const spec = queueSortSpec("urgency", "asc");
  const mongoRows = await mongoDeskQueueStore.findQueuePage({ match: allMatch, sort: spec, after: null, limit: 1000 });
  const memoryDays = new Map((await memory.findQueuePage({ match: allMatch, sort: spec, after: null, limit: 1000 })).map((r) => [r.subject_id, r.schedule_day]));
  assert.ok(mongoRows.length > 0 && mongoRows.some((r) => r.schedule_day !== null));
  for (const row of mongoRows) assert.equal(row.schedule_day, memoryDays.get(row.subject_id), row.subject_id);

  // 4d (S4). Agent names for history rows: one batched read, unknown and malformed ids left out.
  const formerRep = new mongoose.Types.ObjectId();
  await Agent.collection.insertMany([
    { _id: formerRep, name: "Former Rep", normalized_name: "former rep", name_aliases: [] },
    { _id: new mongoose.Types.ObjectId(TEST_AGENT_A), name: "Agent A", normalized_name: "agent a", name_aliases: [] },
  ]);
  const agentNames = await mongoSalesOutreachReadStore.findAgentNames([formerRep.toHexString(), TEST_AGENT_A, unknownAgent, "bad"]);
  assert.deepEqual(sorted(agentNames), sorted(new Map([[formerRep.toHexString(), "Former Rep"], [TEST_AGENT_A, "Agent A"]])));
  const before = await mongoDeskQueueStore.assignmentGeneration({ kind: "agent", agent_id: TEST_AGENT_A });
  const moved = await getSalesOutreachSubjectModel().collection.findOne({ assigned_agent_id: new mongoose.Types.ObjectId(TEST_AGENT_A) });
  await getSalesOutreachSubjectModel().collection.updateOne({ _id: moved!._id }, { $set: { assigned_agent_id: new mongoose.Types.ObjectId(TEST_AGENT_B), assignment_revision: 2 } });
  assert.notEqual(await mongoDeskQueueStore.assignmentGeneration({ kind: "agent", agent_id: TEST_AGENT_A }), before, "reassignment changes the generation");

  // 4e (olr A3-fresh). Calls freshness inputs on real Mongo: the dotted sync-state projection carries the
  // confirmation instants, and the newest call webhook is one covered index read that skips non-telephony receipts.
  const { getSalesIntelligenceSyncStateModel } = await import("../../src/models/SalesIntelligenceSyncState.js");
  const { getRingCentralCollectionName } = await import("../../src/services/ringcentral/ringcentral-config.js");
  const { ensureRingCentralWebhookEventIndexes } = await import("../../src/services/ringcentral/webhook-capture.js");
  assert.equal(await mongoSalesOutreachReadStore.readLastCallWebhookAt(), null, "no receipt yet");
  await getSalesIntelligenceSyncStateModel().collection.insertOne({
    scope: "call_log_all_directions",
    known_complete_through: at("2026-10-05T14:10:00.000Z"),
    observed_complete_through: at("2026-10-05T14:44:00.000Z"),
    reconcile_sync_success_at: at("2026-10-05T14:58:00.000Z"),
    isync_lane: { last_success_at: at("2026-10-05T14:59:20.000Z"), last_error_code: null },
    last_run: { finished_at: at("2026-10-05T14:58:00.000Z"), error_code: null, sync_token_stored: true, sync_error_code: null },
  });
  const callsRow = await mongoSalesOutreachReadStore.readCallsCapture();
  assert.deepEqual(
    [callsRow?.confirmation_success_at?.toISOString(), callsRow?.observed_complete_through?.toISOString(), callsRow?.known_complete_through?.toISOString()],
    ["2026-10-05T14:59:20.000Z", "2026-10-05T14:44:00.000Z", "2026-10-05T14:10:00.000Z"],
  );
  await ensureRingCentralWebhookEventIndexes();
  const receipts = mongoose.connection.db!.collection(getRingCentralCollectionName("webhookEvents"));
  await receipts.insertMany([
    { provider: "ringcentral", receivedAt: at("2026-10-05T14:57:00.000Z"), uuid: "a3f-1", telephonySessionId: "s-1" },
    { provider: "ringcentral", receivedAt: at("2026-10-05T14:58:30.000Z"), uuid: "a3f-2", telephonySessionId: "s-2" },
    { provider: "ringcentral", receivedAt: at("2026-10-05T14:59:50.000Z"), uuid: "a3f-3", telephonySessionId: null },
  ]);
  assert.equal((await mongoSalesOutreachReadStore.readLastCallWebhookAt())?.toISOString(), "2026-10-05T14:58:30.000Z", "the newer non-telephony receipt is skipped");
  const webhookPlan = (await receipts
    .find({ provider: "ringcentral", telephonySessionId: { $type: "string" } }, { projection: { _id: 0, receivedAt: 1 } })
    .sort({ receivedAt: -1 })
    .limit(1)
    .explain("executionStats")) as { queryPlanner: { winningPlan: unknown }; executionStats: { totalKeysExamined: number } };
  const planText = JSON.stringify(webhookPlan.queryPlanner.winningPlan);
  assert.ok(planText.includes("IXSCAN") && !planText.includes('"SORT"'), `index walk without a blocking sort: ${planText}`);
  assert.ok(webhookPlan.executionStats.totalKeysExamined <= 2, "newest-first walk stops at the first telephony receipt");

  // 5. Live: scoped change streams over committed publish rows.
  const repStream = watchOutreachLiveEvents({ role: "rep", agent_id: TEST_AGENT_A });
  const ownerStream = watchOutreachLiveEvents({ role: "owner", agent_id: null });
  // A change stream opens its cursor lazily: prime both (one empty await each) so the publishes below
  // land after the watch point. The SSE route does the same before it reports `connect`.
  const prime = (stream: unknown) => (stream as { tryNext(): Promise<unknown> }).tryNext();
  await prime(repStream);
  await prime(ownerStream);
  const subjectA = "5".repeat(24);
  await publishOutreachLive([
    { topic: "outreach_desk", subject_ids: [subjectA], agent_ids: [TEST_AGENT_B], revision: 1, cause: "evaluation" },
    { topic: "outreach_desk", subject_ids: [subjectA], agent_ids: [TEST_AGENT_A], revision: 2, cause: "evaluation" },
    { topic: "outreach_configuration", revision: 3, cause: "configuration" },
  ]);
  const repSeen = [await repStream.next(), await repStream.next()].map((c) => outreachLiveHint(c, { role: "rep", agent_id: TEST_AGENT_A }));
  assert.deepEqual(repSeen.map((h) => [h?.topic, h?.revision]), [["outreach_desk", 2], ["outreach_configuration", 3]], "the Rep stream skips the other Agent's hint");
  const ownerSeen = [await ownerStream.next(), await ownerStream.next(), await ownerStream.next()].map((c) => outreachLiveHint(c, { role: "owner", agent_id: null })?.revision);
  assert.deepEqual(ownerSeen, [1, 2, 3]);
  await repStream.close();
  await ownerStream.close();
  console.log(
    `PASS: ${plans} queue plans equal the in-memory semantics page by page; index used; team/generation; S4 agent cadence, schedule_day, agent names; A3-fresh calls freshness inputs + webhook index read; scoped live streams`,
  );
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
