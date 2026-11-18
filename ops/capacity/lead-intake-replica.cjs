// Run on a fresh, disposable single-member rs0 at 127.0.0.1:27983.
// node --import tsx ops/capacity/lead-intake-replica.cjs before|after <fresh alphanumeric suffix>
const assert = require("node:assert/strict");
const fromRepo = require("node:module").createRequire(
  require("node:path").resolve("package.json"),
);
const { ObjectId } = fromRepo("mongodb");
const mongoose = fromRepo("mongoose");
const [mode, suffix] = process.argv.slice(2);
assert.ok(["before", "after"].includes(mode));
assert.match(suffix ?? "", /^[a-z0-9]+$/);
const database = "testvantagemovers_intake" + suffix;
const uri = "mongodb://127.0.0.1:27983/?replicaSet=rs0&directConnection=true";
Object.assign(process.env, {
  TEST_MODE: "true",
  TEST_MONGO_DATABASE_NAME: database,
  MONGO_URI: uri,
  SHEET_SYNC_MODE: "queued",
  RINGCENTRAL_CREATE_CALL_LEADS: "true",
});
fromRepo("./ops/test-setup");
const { connectMongo } = fromRepo("./src/db");
const { ingestRingCentralQualifiedCall } = fromRepo(
  "./src/services/ringcentral/ringcentral-call-lead-ingest.service",
);
const { existingWriteContextFromRequest } = fromRepo(
  "./src/services/domainCommands/existingWriteContext",
);
const { runExistingCreateFormLead } = fromRepo(
  "./src/services/domainCommands/existingWrites",
);

async function main() {
  await mongoose.connect(uri, {
    dbName: database,
    autoCreate: false,
    autoIndex: false,
    monitorCommands: true,
  });
  const db = mongoose.connection.db;
  const hello = await db.admin().command({ hello: 1 });
  assert.equal(hello.setName, "rs0");
  assert.deepEqual(hello.hosts, ["127.0.0.1:27983"]);
  assert.equal(hello.isWritablePrimary, true);
  assert.equal(db.databaseName, database);
  assert.equal(
    (await db.listCollections().toArray()).length,
    0,
    "Supply a fresh suffix",
  );
  global.__mongooseCache = { conn: mongoose, promise: null };
  await connectMongo();
  const company = new ObjectId(),
    formFeed = new ObjectId(),
    callFeed = new ObjectId();
  await db
    .collection("lead_source_companies")
    .insertOne({
      _id: company,
      company_slug: "main_site",
      name: "Synthetic",
      owner_label: "Synthetic",
      active: true,
      default_form_granularity: formFeed,
      default_call_granularity: callFeed,
    });
  for (const [channel, id] of [
    ["form", formFeed],
    ["call", callFeed],
  ]) {
    await db
      .collection("lead_source_granularities")
      .insertOne({
        _id: id,
        source_company: company,
        granularity_key: "main_site_" + channel,
        channel,
        owner_label: channel,
        crm_label: channel,
        active: true,
        activated_at: new Date(0),
      });
  }
  await db
    .collection("domain_command_executions")
    .createIndex({ origin: 1, idempotency_key: 1 }, { unique: true });
  // Create transaction namespaces before measurement.
  for (const c of [
    "form_leads",
    "call_leads",
    "entity_changes",
    "sheet_sync_jobs",
    "form_fill_work",
  ])
    await db.createCollection(c);
  let writes = [];
  mongoose.connection
    .getClient()
    .on("commandStarted", ({ commandName, command }) => {
      if (["insert", "update", "delete", "findAndModify"].includes(commandName))
        writes.push(commandName + ":" + command[commandName]);
    });
  async function snapshot() {
    const rows = {};
    for (const { name } of await db.listCollections().toArray()) {
      if (name.startsWith("system.")) continue;
      const [row] = await db
        .collection(name)
        .aggregate([
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              bytes: { $sum: { $bsonSize: "$$ROOT" } },
            },
          },
        ])
        .toArray();
      if (row) rows[name] = row;
    }
    return rows;
  }
  async function measure(label, fn) {
    const before = await snapshot();
    writes = [];
    const result = await fn();
    const issued = writes.slice();
    const after = await snapshot();
    const delta = {};
    for (const name of new Set([
      ...Object.keys(before),
      ...Object.keys(after),
    ])) {
      const count = (after[name]?.count ?? 0) - (before[name]?.count ?? 0);
      const bytes = (after[name]?.bytes ?? 0) - (before[name]?.bytes ?? 0);
      if (count || bytes) delta[name] = { count, bytes };
    }
    console.log("MEASURE " + JSON.stringify({ label, delta, writes: issued }));
    return result;
  }
  const start = new Date("2026-11-17T14:00:00Z");
  const observation = (minute, result = "Accepted") => ({
    result,
    answered: result === "Accepted",
    callLogId: "intake-parent-log",
    observedAt: new Date(+start + minute * 60000),
  });
  const descriptor = {
    ingestionSource: "call_log_sync",
    telephonySessionId: "intake-session",
    sessionId: "intake-session",
    partyId: null,
    callLogId: "intake-parent-log",
    sourceCompany: "main_site",
    sourceLabel: "call",
    routeResolution: {
      route_id: new ObjectId().toHexString(),
      assignment_id: new ObjectId().toHexString(),
      normalized_target_number: "+15550000001",
      company_id: company.toHexString(),
      company_slug: "main_site",
      company_label_snapshot: "Synthetic",
      granularity_id: callFeed.toHexString(),
      granularity_key: "main_site_call",
      granularity_label_snapshot: "call",
      crm_label_snapshot: "call",
    },
    callerPhoneNumber: "5550002001",
    callerName: "Synthetic Caller",
    targetPhoneNumber: "+15550000001",
    targetName: "Synthetic Queue",
    answeredAt: start,
    terminalAt: new Date(+start + 180000),
    startTime: start,
    durationSeconds: 180,
    qualificationReason: "call_log_inbound_target_answered_over_120s",
    finalCallLogResult: observation(4),
  };
  const poll = (fact) =>
    ingestRingCentralQualifiedCall(
      { ...descriptor, finalCallLogResult: fact },
      new Date(),
      {
        resolveWriteMode: () => "create",
        adoptionEnabled: () => false,
      },
    );
  const created = await measure("qualified_call", () => poll(observation(4)));
  assert.equal(created.action, "lead_created");
  const lead = () =>
    db
      .collection("call_leads")
      .findOne({ _id: new ObjectId(created.callLeadId) });
  const payload = {
    name: "Synthetic Caller",
    source_company: "main_site",
    phone_number: "5550002001",
    pickup_zip: "10001",
    destination_zip: "94105",
    move_size: "Studio",
    post_to_granot: false,
  };
  const form = (id) => {
    const data = payload;
    return runExistingCreateFormLead({
      data,
      context: existingWriteContextFromRequest({
        req: { id, vantageAuth: { kind: "secret" }, header: () => undefined },
        command_name: "createFormLead",
        payload: data,
      }),
    });
  };
  await measure("external_form", () => form("original"));
  await measure("submission_replay", () => form("original"));
  await measure("duplicate_form", () => form("duplicate"));
  assert.equal(await db.collection("form_leads").countDocuments(), 2);
  assert.equal(
    await db.collection("form_leads").countDocuments({ duplicate: true }),
    1,
  );
  assert.equal((await lead()).form_fill, true);
  const original = await lead(),
    commandFilter = { command_name: "recordRingCentralFinalCallLogResult" };
  const receipts = () =>
    db.collection("domain_command_executions").countDocuments(commandFilter);
  const changes = () =>
    db.collection("entity_changes").countDocuments(commandFilter);
  const jobs = () => db.collection("sheet_sync_jobs").countDocuments();
  const initialJobs = await jobs();
  await measure("newer_identical", () => poll(observation(8)));
  assert.equal(await receipts(), mode === "before" ? 1 : 0);
  await measure("exact_replay", () => poll(observation(8)));
  await measure("concurrent_identical", () =>
    Promise.all(Array.from({ length: 5 }, () => poll(observation(10)))),
  );
  await measure("delayed_correction", () => poll(observation(9, "Missed")));
  assert.equal(
    +(await lead()).ringcentral.final_result_observed_at,
    +observation(10).observedAt,
  );
  assert.equal((await lead()).domain_revision, original.domain_revision);
  assert.equal(await receipts(), mode === "before" ? 2 : 0);
  assert.equal(await jobs(), initialJobs);
  assert.equal(await changes(), 0);
  // Force the outbox write to fail after the Lead and audit writes.
  const beforeFailure = await lead();
  await db.command({
    collMod: "sheet_sync_jobs",
    validator: { operation: { $ne: "call_lead.update" } },
  });
  await assert.rejects(
    () => poll(observation(12, "Missed")),
    (e) => e.code === 121,
  );
  assert.deepEqual(await lead(), beforeFailure);
  assert.equal(await changes(), 0);
  assert.equal(await jobs(), initialJobs);
  assert.equal(await receipts(), mode === "before" ? 2 : 0);
  await db.command({ collMod: "sheet_sync_jobs", validator: {} });
  await measure("genuine_correction", () => poll(observation(12, "Missed")));
  await measure("correction_replay", () => poll(observation(12, "Missed")));
  const corrected = await lead();
  assert.equal(corrected.ringcentral.final_result, "Missed");
  assert.equal(corrected.domain_revision, original.domain_revision + 1);
  assert.equal(await changes(), 1);
  assert.equal(await jobs(), initialJobs);
  assert.equal(
    await db
      .collection("sheet_sync_jobs")
      .countDocuments({ operation: "call_lead.update" }),
    1,
  );
  assert.equal(await receipts(), mode === "before" ? 3 : 1);
  await Promise.all([poll(observation(13, "Missed")), poll(observation(14))]);
  const latest = await lead();
  assert.equal(latest.ringcentral.final_result, "Accepted");
  assert.equal(
    +latest.ringcentral.final_result_observed_at,
    +observation(14).observedAt,
  );
  assert.equal(await db.collection("call_leads").countDocuments(), 1);
  console.log("PASS", mode, database);
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
