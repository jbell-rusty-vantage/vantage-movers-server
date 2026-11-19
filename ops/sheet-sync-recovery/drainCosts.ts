import assert from "node:assert/strict";
import { mock } from "node:test";
import mongoose from "mongoose";
import { BSON, type CommandStartedEvent, type CommandSucceededEvent } from "mongodb";
import { getSheetSyncDrainGuardrails } from "../../src/config/domain";
import { SheetSyncJob } from "../../src/models/SheetSyncJob";
import { resetEnsuredTabsCache } from "../../src/services/googleSheets/tabs";
import { runSheetSyncDrain, type SheetSyncDrainSummary } from "../../src/services/sheetSync/drainer/runSheetSyncDrain";
import type { statefulWorkbook } from "../../src/services/sheetSync/drainer/statefulWorkbook.fixture";
import type { QuotaLimiter } from "../../src/services/sheetSync/drainer/quotaLimiter";

type Workbook = ReturnType<typeof statefulWorkbook>;
const ids = (rows: { _id: unknown }[]) => rows.map((row) => String(row._id));

/** Called only from the guarded, disposable replica harness. The broad comparison
 * read is outside the observed drain. No fixture has eligibility near the clock boundary. */
export async function measureDrain(
  workload: string, workbook: Workbook, drain: () => Promise<SheetSyncDrainSummary>,
  expected?: { selected: string[]; claimed: string[] },
) {
  const now = new Date();
  const limit = getSheetSyncDrainGuardrails().maxJobsPerDrain;
  const baseline = await SheetSyncJob.find({
    status: { $in: ["pending", "retrying"] }, due_at: { $lte: now },
    $or: [{ leased_until: { $exists: false } }, { leased_until: { $lte: now } }],
  }).sort({ priority: -1, createdAt: 1 }).limit(limit).lean();
  const client = mongoose.connection.getClient();
  const commands: Record<string, number> = {};
  const updates: Record<string, number> = {};
  const claimRequests = new Set<number>();
  const claimed: string[] = [];
  const requestsStart = workbook.requests.length;
  let candidateRequest = -1;
  let discoveryCommand: CommandStartedEvent["command"] | undefined;
  let projectedBytes = 0;
  let candidateFinds = 0;
  let attemptRows = 0;
  let observedIds: string[] | undefined;
  let claimedBytes = 0;
  const started = (event: CommandStartedEvent) => {
    if (event.databaseName !== mongoose.connection.name) return;
    const command = event.command;
    const collection = String(command[event.commandName]);
    const key = event.commandName + "." + collection;
    commands[key] = (commands[key] ?? 0) + 1;
    if (command.find === "sheet_sync_jobs" && command.filter.due_at) {
      candidateFinds++;
      discoveryCommand = command;
      candidateRequest = event.requestId;
    }
    if (command.findAndModify === "sheet_sync_jobs" && command.update?.$set?.status === "processing") {
      claimRequests.add(event.requestId);
    }
    if (command.insert === "sheet_sync_attempts") attemptRows += command.documents.length;
    const payloads = command.updates?.map((entry: { u: object }) => entry.u) ??
      (command.findAndModify && command.update ? [command.update] : []);
    for (const payload of payloads) updates[collection] = (updates[collection] ?? 0) + BSON.calculateObjectSize(payload);
  };
  const succeeded = (event: CommandSucceededEvent) => {
    const reply = event.reply;
    assert.ok(reply && typeof reply === "object");
    if (event.requestId === candidateRequest) {
      assert.ok("cursor" in reply && reply.cursor && typeof reply.cursor === "object");
      assert.ok("firstBatch" in reply.cursor && Array.isArray(reply.cursor.firstBatch));
      const rows = reply.cursor.firstBatch;
      observedIds = ids(rows);
      for (const row of rows) {
        assert.deepEqual(Object.keys(row), ["_id"]);
        projectedBytes += BSON.calculateObjectSize(row);
      }
    }
    if (claimRequests.has(event.requestId)) {
      assert.ok("value" in reply);
      if (reply.value === null) return;
      const job = reply.value;
      assert.ok(job && typeof job === "object" && "_id" in job && "coalescing_key" in job && job.coalescing_key);
      claimed.push(String(job._id));
      claimedBytes += BSON.calculateObjectSize(job);
    }
  };
  client.on("commandStarted", started);
  client.on("commandSucceeded", succeeded);
  try {
    const result = await drain();
    assert.ok(discoveryCommand, JSON.stringify({ commands, result }));
    assert.deepEqual(discoveryCommand.projection, { _id: 1 });
    const sort = discoveryCommand.sort;
    assert.deepEqual(sort instanceof Map ? Object.fromEntries(sort) : sort, { priority: -1, createdAt: 1 });
    assert.equal(candidateFinds, 1);
    assert.equal(discoveryCommand.limit, limit);
    assert.deepEqual(observedIds, ids(baseline));
    assert.deepEqual(observedIds, expected?.selected ?? ids(baseline));
    assert.deepEqual(claimed, expected?.claimed ?? ids(baseline));
    assert.equal(result.claimed, claimed.length);
    const provider: Record<string, number> = {};
    for (const { operation } of workbook.requests.slice(requestsStart)) provider[operation] = (provider[operation] ?? 0) + 1;
    console.log("Sheet cost", JSON.stringify({
      workload, selected: baseline.length, claimed: claimed.length,
      broadBytes: baseline.reduce((sum, row) => sum + BSON.calculateObjectSize(row), 0),
      projectedBytes, claimedBytes, commands, attemptRows, updatePayloadBytes: updates, provider,
    }));
    return result;
  } finally {
    client.off("commandStarted", started);
    client.off("commandSucceeded", succeeded);
  }
}

export async function proveCandidateCosts(
  seed: (copies?: number) => Promise<mongoose.Types.ObjectId>, workbook: () => Workbook, quota: QuotaLimiter,
) {
  for (const [label, copies] of [["idle", 0], ["single", 1], ["duplicate-key", 3]] as const) {
    resetEnsuredTabsCache();
    if (copies) {
      const entity = await seed(copies);
      // Distinct sort keys give an exact ordering contract even for bulk inserts.
      const jobs = await SheetSyncJob.find({ entity_id: String(entity) });
      for (const [index, job] of jobs.entries()) await SheetSyncJob.updateOne({ _id: job._id }, { priority: index });
    }
    const f = workbook();
    const result = await measureDrain(label, f, () => runSheetSyncDrain("cron", { sheets: f.sheets, quota }));
    assert.equal(result.synced, copies);
    assert.equal(f.count("append"), copies ? 1 : 0);
  }
  const entity = await seed(8);
  const jobs = await SheetSyncJob.find({ entity_id: String(entity) }).sort({ _id: 1 });
  const fixtureIds = ids(jobs);
  const future = new Date(Date.now() + 86_400_000);
  const states = [
    { status: "pending", priority: 6 }, { status: "retrying", priority: 6, leased_until: new Date(0), attempts: 2 },
    { status: "pending", priority: 5 }, { status: "pending", priority: 4 },
    { status: "retrying", priority: 20, due_at: future }, { status: "pending", priority: 20, leased_until: future },
    { status: "processing", priority: 20, leased_until: new Date(0) }, { status: "failed", priority: 20 },
  ];
  for (const [index, state] of states.entries()) {
    await SheetSyncJob.collection.updateOne({ _id: jobs[index]!._id }, { $set: { ...state, createdAt: new Date(index) } });
  }
  const original = SheetSyncJob.collection.findOneAndUpdate.bind(SheetSyncJob.collection);
  const losingId = jobs[0]!._id;
  let competed = false;
  const competitor = mock.method(SheetSyncJob.collection, "findOneAndUpdate", async (...args: Parameters<typeof original>) => {
    if (!competed && String(args[0]._id) === String(losingId)) {
      competed = true;
      await SheetSyncJob.collection.updateOne({ _id: losingId }, { $set: { status: "processing", lease_owner: "competitor", leased_until: future } });
    }
    return original(...args);
  });
  const priorLimit = process.env.SHEET_SYNC_MAX_JOBS_PER_DRAIN;
  try {
    process.env.SHEET_SYNC_MAX_JOBS_PER_DRAIN = "3";
    const f = workbook();
    const result = await measureDrain("ordered-race", f, () => runSheetSyncDrain("cron", { sheets: f.sheets, quota }),
      { selected: fixtureIds.slice(0, 3), claimed: fixtureIds.slice(1, 3) });
    assert.equal(competed, true);
    assert.equal(result.synced, 2);
    assert.equal((await SheetSyncJob.findById(losingId))?.lease_owner, "competitor");
    assert.equal((await SheetSyncJob.findById(jobs[3]!._id))?.status, "pending");
  } finally {
    competitor.mock.restore();
    if (priorLimit === undefined) delete process.env.SHEET_SYNC_MAX_JOBS_PER_DRAIN;
    else process.env.SHEET_SYNC_MAX_JOBS_PER_DRAIN = priorLimit;
  }
}
