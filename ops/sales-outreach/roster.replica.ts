/**
 * P08a-1 (F1/F2) replica proof (local csi01 loopback replica only; synthetic rows in a unique database
 * that is dropped afterwards). Part of `pnpm test:outreach:replica`. Never loads production env.
 *
 * Proves on real Mongo:
 * - `findDeskRepsAt` joins the temporal reviewed `sales_rep` links to `Agent.active`: an inactive Agent
 *   with a current link, a retired link, a `service` link and a link effective in the future are not desk
 *   reps; the narrowed form and `isDeskRepAt` agree; the read store serves the same map;
 * - the rep-day recount under `goals.roster_rule: desk_reps` writes a frozen C5 zero row (through the
 *   strict model, in a real transaction) for a desk rep without a schedule entry — goal 100, every weekday,
 *   `roster_version` a `roster-desk-…` digest — and writes nothing for a configured Agent who is inactive;
 * - the Agent activation command re-syncs the Agent's open subjects (one `outreach_lead_change` job per
 *   subject received by that Agent) and a no-op activation enqueues nothing.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { csiEnqueueReplicaTarget } from "../lib/csi-enqueue-replica-target";

const database = `testvantagemovers_sodroster${randomUUID().replaceAll("-", "")}`;
for (const key of Object.keys(process.env))
  if (/RINGCENTRAL|^RC_|BLOB|GATEWAY|OPENAI|ANTHROPIC|VERCEL|KV_REST|REDIS|UPSTASH|QSTASH|GOOGLE|MONGO|DOTENV/i.test(key)) delete process.env[key];
process.env.DOTENV_CONFIG_PATH = `${__dirname}/.sod-roster-replica-no-dotenv.env`;
process.env.MONGO_URI = csiEnqueueReplicaTarget(process.argv);
process.env.TEST_MODE = "true";
process.env.TEST_MONGO_DATABASE_NAME = database;
process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID = "sod-roster-replica";
process.env.SHEET_SYNC_MODE = "disabled";

const at = (iso: string) => new Date(iso);

async function main() {
  const { connectMongo, withTransaction } = await import("../../src/db.js");
  const { Agent } = await import("../../src/models/Agent.js");
  const { getRepIdentityLinkModel } = await import("../../src/models/RepIdentityLink.js");
  const { getSalesIntelligenceJobModel } = await import("../../src/models/SalesIntelligenceJob.js");
  const { getFormLeadModel } = await import("../../src/models/FormLead.js");
  const { SALES_OUTREACH_MODEL_REGISTRY } = await import("../../src/models/salesOutreach/registry.js");
  const { getSalesOutreachRepDayProjectionModel, getSalesOutreachSubjectModel } = await import("../../src/models/salesOutreach/index.js");
  const { findDeskRepsAt, isDeskRepAt } = await import("../../src/services/salesOutreach/roster/store.js");
  const { effectiveRoster } = await import("../../src/services/salesOutreach/roster/rule.js");
  const { mongoSalesOutreachReadStore } = await import("../../src/services/salesOutreach/reads/store.js");
  const { mongoRepDayStore, recountRepDay } = await import("../../src/services/salesOutreach/contacts/repDayService.js");
  const { activeInspection } = await import("../../src/services/salesOutreach/reads/testing.js");
  const { completeConfigurationInput } = await import("../../src/services/salesOutreach/evaluation/testing.js");
  const { setAgentActivation } = await import("../../src/services/operationsRegistry/catalogRegistry.js");
  await connectMongo();
  assert.equal(mongoose.connection.name, database);
  for (const entry of SALES_OUTREACH_MODEL_REGISTRY) {
    const Model = entry.model();
    await Model.createCollection();
    await Model.createIndexes();
  }
  await getSalesIntelligenceJobModel().createCollection();
  await getSalesIntelligenceJobModel().createIndexes();
  await getFormLeadModel().createCollection();

  // 1. Agents and links.
  const now = at("2026-10-07T15:00:00.000Z");
  const mk = async (name: string, active: boolean) => String((await Agent.create({ name, normalized_name: name.toLowerCase(), active }))._id);
  const [alice, bob, carol, dan, eve, finn] = await Promise.all([
    mk("Alice Replica", true),
    mk("Bob Replica", true),
    mk("Carol Replica", false),
    mk("Dan Replica", true),
    mk("Eve Replica", true),
    mk("Finn Replica", true),
  ]);
  const Link = getRepIdentityLinkModel();
  const link = (agent: string, name: string, ext: string, extra: Record<string, unknown> = {}) => ({
    agent_id: new mongoose.Types.ObjectId(agent),
    agent_name_snapshot: name,
    rc_account_id: "acct-replica",
    rc_extension_id: ext,
    role_kind: "sales_rep",
    status: "reviewed",
    effective_from: at("2026-10-01T00:00:00.000Z"),
    effective_to: null,
    reviewed_at: at("2026-10-01T00:00:00.000Z"),
    reviewed_by: "owner",
    ...extra,
  });
  await Link.collection.insertMany([
    link(alice, "Alice", "101"),
    link(bob, "Bob", "102"),
    link(carol, "Carol", "103"), // Agent inactive
    link(dan, "Dan", "104", { effective_from: at("2026-10-08T00:00:00.000Z") }), // future
    link(eve, "Eve", "105", { status: "retired", effective_to: at("2026-10-06T16:52:00.000Z") }), // retired
    link(finn, "Finn", "106", { role_kind: "service" }), // not a sales rep
  ]);
  const reps = await findDeskRepsAt(now);
  assert.deepEqual(reps, [alice, bob].sort().map((agent_id) => ({ agent_id, agent_name: agent_id === alice ? "Alice" : "Bob" })), "active Agents with a current reviewed sales_rep link only");
  assert.deepEqual((await findDeskRepsAt(at("2026-10-09T00:00:00.000Z"))).map((r) => r.agent_id), [alice, bob, dan].sort(), "Dan once his link is effective");
  assert.deepEqual((await findDeskRepsAt(at("2026-10-06T12:00:00.000Z"))).map((r) => r.agent_id), [alice, bob, eve].sort(), "Eve before her link was retired");
  assert.deepEqual((await findDeskRepsAt(now, null, [alice, carol, eve])).map((r) => r.agent_id), [alice], "narrowed");
  assert.equal(await isDeskRepAt(carol, now), false);
  assert.equal(await isDeskRepAt(bob, now), true);
  assert.deepEqual([...(await mongoSalesOutreachReadStore.findDeskReps(now)).entries()].sort(), [[alice, "Alice"], [bob, "Bob"]].sort());
  console.log("roster replica step 1 PASS: findDeskRepsAt joins links to Agent.active");

  // 2. Recount under desk_reps: a frozen zero row for Bob (no schedule entry), none for Carol (configured, inactive).
  const base = completeConfigurationInput({ goal_metrics_enabled: true });
  const configuration = activeInspection(
    {
      ...base,
      goals: {
        ...base.goals,
        roster_rule: "desk_reps",
        rep_work_schedules: [{ agent_id: carol, working_days: [1, 2, 3, 4, 5, 6, 7], scheduled_goal: null }],
      },
    },
    "v-roster-replica",
    4,
  );
  assert.equal(configuration.state, "active");
  const yesterday = "2026-10-06";
  const bobRow = await withTransaction((session) => recountRepDay({ agent_id: bob, business_day: yesterday, materialize: true }, configuration, now, mongoRepDayStore, session, { materialize: true }));
  assert.equal(bobRow.outcome, "written");
  const stored = (await getSalesOutreachRepDayProjectionModel().findOne({ agent_id: new mongoose.Types.ObjectId(bob), business_day: yesterday }).lean()) as {
    goal_snapshot?: { roster_version?: string | null; configuration_version?: string | null; goal?: number | null; scheduled?: boolean };
    goal_state?: string;
    actual_confirmed?: number;
  } | null;
  assert.ok(stored, "the zero row exists through the strict model");
  const version = effectiveRoster(configuration.value.goals, [alice, bob]).roster_version;
  assert.deepEqual(
    [stored.goal_snapshot?.roster_version, stored.goal_snapshot?.configuration_version, stored.goal_snapshot?.goal, stored.goal_snapshot?.scheduled, stored.goal_state, stored.actual_confirmed],
    [version, "v-roster-replica", 100, true, "goal", 0],
    "frozen with the derived roster version, the default goal and every weekday",
  );
  const carolRow = await withTransaction((session) => recountRepDay({ agent_id: carol, business_day: yesterday, materialize: true }, configuration, now, mongoRepDayStore, session, { materialize: true }));
  assert.equal(carolRow.outcome, "no_activity", "configured but inactive: no zero row");
  assert.equal(await getSalesOutreachRepDayProjectionModel().countDocuments({ business_day: yesterday }), 1);
  console.log("roster replica step 2 PASS: desk_reps recount materializes desk reps only, frozen with the derived version");

  // 3. Agent activation re-syncs the Agent's open subjects (and a no-op activation enqueues nothing).
  const lead = await getFormLeadModel().collection.insertOne({ receiver_agent: new mongoose.Types.ObjectId(bob), timestamp: now, name: "Replica Lead", phone: "3055550199" });
  await getSalesOutreachSubjectModel().collection.insertOne({
    lead_model: "FormLead",
    lead_id: lead.insertedId,
    status: "active",
    assigned_agent_id: new mongoose.Types.ObjectId(bob),
    assignment_revision: 1,
    revision: 1,
  });
  const actor = (): Parameters<typeof setAgentActivation>[1] => ({
    actorType: "owner",
    actorId: "owner-replica",
    actorLabel: "Owner (replica)",
    actorRole: "owner",
    requestId: `req-${randomUUID()}`,
  });
  const jobsBefore = await getSalesIntelligenceJobModel().countDocuments({ stage: "outreach_lead_change" });
  const deactivated = await setAgentActivation({ id: bob, active: false, reason: "replica proof" }, actor());
  assert.equal(deactivated.active, false);
  const jobs = (await getSalesIntelligenceJobModel().find({ stage: "outreach_lead_change" }).lean()) as Array<{ dedupe_key: string }>;
  assert.equal(jobs.length - jobsBefore, 1, "one re-sync job for Bob's subject");
  assert.match(jobs[jobs.length - 1]!.dedupe_key, new RegExp(`^sod:lead-change:FormLead:${String(lead.insertedId)}:activation:[a-f\\d]{24}$`));
  assert.equal(await isDeskRepAt(bob, now), false, "deactivated: no longer a desk rep though the link stays reviewed");
  const again = await setAgentActivation({ id: bob, active: false, reason: "replica proof again" }, actor());
  assert.equal(again.active, false);
  assert.equal(await getSalesIntelligenceJobModel().countDocuments({ stage: "outreach_lead_change" }), jobs.length, "a no-op activation enqueues nothing");
  console.log("roster replica step 3 PASS: activation re-syncs the Agent's subjects and removes eligibility");
}

main()
  .then(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log("roster replica PASS");
  })
  .catch(async (error: unknown) => {
    console.error(error);
    try {
      await mongoose.connection.dropDatabase();
    } catch {}
    await mongoose.disconnect();
    process.exitCode = 1;
  });
