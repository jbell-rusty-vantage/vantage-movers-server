import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { applyCsiMigration } from "../migrations/sales-intelligence.lib";
import { getCallInteractionModel } from "../../src/models/CallInteraction";
import { getSalesIntelligenceJobModel } from "../../src/models/SalesIntelligenceJob";
import { applyInteractionObservation } from "../../src/services/numberActivity/persistInteraction";
import { at, callLogRecord, SYNTHETIC_ACCOUNT_ID, SYNTHETIC_COMPANY_DID, SYNTHETIC_CUSTOMER, SYNTHETIC_CUSTOMER_B, SYNTHETIC_QUEUE_EXTENSION, SYNTHETIC_SALES_DID,
  SYNTHETIC_USER_EXTENSION, syntheticDirectory } from "../../src/services/numberActivity/fixtures";
import { intelligenceSources } from "../../src/services/salesIntelligence/analysis/sources";
import { readOwnerConversations } from "../../src/services/salesIntelligence/analysis/ownerConversations";
import { assembleCaseFile, caseFileInputFor } from "../../src/services/salesIntelligence/casefile/assemble";
import { caseFileToReadContent } from "../../src/services/salesIntelligence/casefile/page";
import { readNumberTimelineV2 } from "../../src/services/salesIntelligence/outreach/timelineRead";
import { assembleSubjectStory, resolveStorySubject } from "../../src/services/salesIntelligence/story/assemble";
import { storyToReadContent } from "../../src/services/salesIntelligence/story/page";
import { OWNER_ONLY_CALL_DETAIL_KEYS } from "../../src/services/salesIntelligence/story/sources";
import { runStampCaptureRecovery } from "./stamp-capture-recovery";

/**
 * S5c-CALLS (G2; C16, C17) and S5c-RECOVERY (G4; C19, C25 for its script) on the csi01 loopback
 * replica, database `testvantagemovers_t3arecov`. Calls are stored through the real capture path
 * (`applyInteractionObservation`), so the repair audit rows have the production shape.
 *
 * 1. The stamp's dry run is write-free: the database profiler (level 2) records zero insert, update,
 *    delete or findAndModify against the target database, and the job table does not move.
 * 2. Apply stamps exactly the manifest's matched `added` and `completed` calls, never bumps
 *    `projection_revision` or `updatedAt`, leaves the Number fingerprint byte-identical, creates no job.
 * 3. Re-apply is a no-op (checkpoint resume, and a fresh run without a checkpoint), again write-free.
 * 4. The timeline shows `recovered` / `late_capture` / null; the Case File says "recovered by a capture repair".
 * 5. A webhook-only in-progress call: `in_progress: true` with null result and duration on the timeline
 *    (Calls tab) and `other_calls`; absent from the model story and the Case File (`excluded_in_progress = 1`),
 *    whose pages are otherwise unchanged; final everywhere after its settle.
 */
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const coverage = { known_through: new Date("2026-09-30T00:00:00Z").toISOString(), gaps: [], capabilities: {}, ai_paused: false };
const OWNER_KEYS: readonly string[] = OWNER_ONLY_CALL_DETAIL_KEYS;

test("S5c capture state and recovery stamp on the replica", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 600_000 }, async t => {
  assert.equal(process.env.TEST_MODE, "true");
  const dbName = getMongoDatabaseName();
  assert.equal(dbName, "testvantagemovers_t3arecov");
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  await connectMongo();
  const db = mongoose.connection.useDb(dbName, { useCache: true }).db!;
  await db.dropDatabase();
  const out = await mkdtemp(join(tmpdir(), "s5c-recovery-"));
  t.after(async () => { await db.command({ profile: 0 }).catch(() => undefined); await rm(out, { recursive: true, force: true }); await db.dropDatabase(); await mongoose.disconnect(); });
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  assert.equal((await applyCsiMigration()).ready, true);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("External traffic forbidden in the S5c replica proof"); });

  const directory = syntheticDirectory();
  const routeId = new mongoose.Types.ObjectId().toHexString();
  const Calls = getCallInteractionModel(), Jobs = getSalesIntelligenceJobModel();
  const observe = (record: ReturnType<typeof callLogRecord>, proof: string, when: Date) =>
    applyInteractionObservation(SYNTHETIC_ACCOUNT_ID, { kind: "call_log", record, proof_ref: proof, source: "backfill" }, { now: () => when, directory, resolveRoute: () => routeId });
  const inbound = (id: string, customer: string, start: Date, seconds: number, result = "Call connected") => callLogRecord({ id, telephonySessionId: `s-${id}`,
    direction: "Inbound", result, startTime: start, duration: seconds, from: { phoneNumber: customer }, to: { phoneNumber: SYNTHETIC_SALES_DID, name: "Sales Line" },
    legs: [{ startTime: start.toISOString(), duration: seconds, direction: "Inbound", action: "Accept Call", result: "Accepted", legType: "Accept",
      from: { phoneNumber: customer }, to: { phoneNumber: SYNTHETIC_SALES_DID, extensionId: SYNTHETIC_USER_EXTENSION.id }, extension: { id: SYNTHETIC_USER_EXTENSION.id } }] });
  const REPAIR_AT = at(3 * 86_400); // the repair ran three days after the calls

  // ── Stored state, as production had it before and after the 09-20 repair ─────────────────
  // STALE: a queue call stored from its mid-call snapshot (Internal, no Number) and completed by the repair.
  const snapshot = callLogRecord({ id: "cl-stale", telephonySessionId: "s-cl-stale", direction: "Inbound", result: "Stopped", startTime: at(0), duration: 0, lastModifiedTime: at(40),
    from: { phoneNumber: SYNTHETIC_COMPANY_DID, name: "Main" }, to: { phoneNumber: SYNTHETIC_SALES_DID, name: "Sales Line" },
    legs: [{ startTime: at(0).toISOString(), duration: 0, direction: "Outbound", action: "Call Queue", result: "Stopped", legType: "PstnToSip",
      from: { phoneNumber: SYNTHETIC_SALES_DID }, to: { extensionId: SYNTHETIC_USER_EXTENSION.id }, extension: { id: SYNTHETIC_QUEUE_EXTENSION.id } }] });
  await observe(snapshot, "call_log:cl-stale", at(60));
  const staleFinal = { ...inbound("cl-stale", SYNTHETIC_CUSTOMER, at(0), 1500), telephonySessionId: "s-cl-stale", lastModifiedTime: at(1560).toISOString() };
  const stale = await observe(staleFinal, "call_log_repair:cl-stale", REPAIR_AT);
  // MISSING: never stored until the repair inserted it.
  const missing = await observe(inbound("cl-missing", "+15550100202", at(7200), 1200), "call_log_repair:cl-missing", REPAIR_AT);
  // Unchanged: captured normally (the repair re-read it and wrote nothing).
  const ok = await observe(inbound("cl-ok", SYNTHETIC_CUSTOMER_B, at(3600), 20, "Missed"), "call_log:cl-ok", at(3700));
  // Late capture: first stored 2 h 30 min after it started, by the ordinary reconcile.
  const late = await observe(inbound("cl-late", "+15550100203", at(10_000), 300), "call_log:cl-late", new Date(+at(10_000) + 2.5 * HOUR));
  assert.equal(stale.created, false);
  assert.ok(missing.created && ok.created && late.created);
  for (const r of [stale, missing, ok, late]) assert.ok(r.contact_number_id, "every call has a Contact Number");

  // The repair manifest: its `interactions[]` as the 09-20 repair wrote them, plus an entry with no repair audit row.
  const manifest = { version: "call-log-repair-v1", run_id: new mongoose.Types.ObjectId().toHexString(), mode: "apply", created_at: REPAIR_AT.toISOString(),
    range: { from: at(-3600).toISOString(), to: REPAIR_AT.toISOString() }, dataset: { deployment: "csi-local-proof", database: dbName }, days: [], holds: [],
    interactions: [
      { interaction_id: stale.interaction_id, day: "2026-09-17", record_id: "cl-stale", classification: "STALE", created: false, contact_number_id: stale.contact_number_id, job_keys: [], downstream: "none", stages: [] },
      { interaction_id: missing.interaction_id, day: "2026-09-17", record_id: "cl-missing", classification: "MISSING", created: true, contact_number_id: missing.contact_number_id, job_keys: [], downstream: "none", stages: [] },
      { interaction_id: ok.interaction_id, day: "2026-09-17", record_id: "cl-ok", classification: "unchanged", created: false, contact_number_id: ok.contact_number_id, job_keys: [], downstream: "none", stages: [] },
      // Claims STALE, but no `call_log_repair:cl-late` audit row exists: reported, never stamped.
      { interaction_id: late.interaction_id, day: "2026-09-17", record_id: "cl-late", classification: "STALE", created: false, contact_number_id: late.contact_number_id, job_keys: [], downstream: "none", stages: [] },
    ] };
  const manifestPath = join(out, "call-log-repair-proof.json");
  await (await import("node:fs/promises")).writeFile(manifestPath, JSON.stringify(manifest));

  const rowsOf = async () => new Map((await Calls.find({}).select("projection_revision updatedAt capture_recovery").lean()).map(r => [String(r._id), r]));
  const fingerprint = (numberId: string) => withTransaction(session => intelligenceSources(numberId, session)).then(r => r.fingerprint);
  const before = await rowsOf();
  const fingerprintsBefore = await Promise.all([stale, missing, ok, late].map(r => fingerprint(r.contact_number_id!)));
  const jobsBefore = await Jobs.countDocuments({});
  assert.equal(await Jobs.countDocuments({ stage: { $in: ["transcription", "analysis", "number_refresh", "move_assessment"] } }), 0, "the seed created no paid job");

  /** Runs `fn` with the profiler at level 2 and returns the write operations it recorded against this database. */
  async function profiled<T>(fn: () => Promise<T>): Promise<{ result: T; writes: unknown[]; reads: number }> {
    await db.command({ profile: 0 });
    await db.collection("system.profile").drop().catch(() => undefined);
    await db.createCollection("system.profile", { capped: true, size: 32 * 1024 * 1024 });
    await db.command({ profile: 2 });
    let result: T;
    try { result = await fn(); } finally { await db.command({ profile: 0 }); }
    const profile = db.collection("system.profile");
    const mine = { ns: { $regex: `^${dbName}\\.`, $ne: `${dbName}.system.profile` } };
    const writes = await profile.find({ ...mine, $or: [{ op: { $in: ["insert", "update", "remove"] } }, { "command.insert": { $exists: true } },
      { "command.update": { $exists: true } }, { "command.delete": { $exists: true } }, { "command.findAndModify": { $exists: true } }, { "command.findandmodify": { $exists: true } }] }).toArray();
    const reads = await profile.countDocuments({ ...mine, op: { $in: ["query", "command"] } });
    return { result: result!, writes, reads };
  }

  // ── 1. Dry run: write-free (C25) ────────────────────────────────────────────────────────
  const reportPath = join(out, "S10-5-replica.md");
  const dry = await profiled(() => runStampCaptureRecovery({ manifestPath, apply: false, outDir: out, reportPath, log: () => undefined }));
  assert.deepEqual(dry.writes, [], "the dry run issues no insert, update, delete or findAndModify");
  assert.ok(dry.reads > 0, "the profiler was on (the dry run's reads are recorded)");
  assert.deepEqual({ total: dry.result.candidates.total, added: dry.result.candidates.added, completed: dry.result.candidates.completed }, { total: 3, added: 1, completed: 2 });
  assert.equal(dry.result.outcomes.would_stamp, 2);
  assert.equal(dry.result.outcomes.unmatched_audit, 1);
  assert.deepEqual(dry.result.unmatched, [late.interaction_id]);
  assert.equal(dry.result.jobs.created, 0);
  assert.equal(dry.result.dataset_matches, true);
  assert.ok((await Calls.find({ capture_recovery: { $ne: null } }).lean()).length === 0, "nothing stamped by the dry run");
  assert.match(await readFile(reportPath, "utf8"), /S10 step 5: capture_recovery stamp \(replica\)[\s\S]*would_stamp \| 2/);

  // ── 2. Apply ─────────────────────────────────────────────────────────────────────────────
  const applied = await runStampCaptureRecovery({ manifestPath, apply: true, outDir: out, reportPath, log: () => undefined });
  assert.equal(applied.outcomes.stamped, 2);
  assert.deepEqual(applied.by_kind, { added: { stamped: 1 }, completed: { stamped: 1, unmatched_audit: 1 } });
  assert.equal(applied.jobs.created, 0, "zero jobs created");
  assert.equal(await Jobs.countDocuments({}), jobsBefore);
  const after = await rowsOf();
  const staleRow = after.get(stale.interaction_id)!, missingRow = after.get(missing.interaction_id)!;
  assert.deepEqual([staleRow.capture_recovery?.kind, staleRow.capture_recovery?.run_id], ["completed", manifest.run_id]);
  assert.deepEqual([missingRow.capture_recovery?.kind, missingRow.capture_recovery?.run_id], ["added", manifest.run_id]);
  assert.equal(+staleRow.capture_recovery!.at, +REPAIR_AT, "`at` is the repair's audit time");
  assert.ok(!after.get(ok.interaction_id)!.capture_recovery && !after.get(late.interaction_id)!.capture_recovery);
  for (const [id, row] of before) {
    assert.equal(after.get(id)!.projection_revision, row.projection_revision, "projection_revision never moves");
    assert.equal(+after.get(id)!.updatedAt!, +row.updatedAt!, "updatedAt never moves");
  }
  const fingerprintsAfter = await Promise.all([stale, missing, ok, late].map(r => fingerprint(r.contact_number_id!)));
  assert.deepEqual(fingerprintsAfter, fingerprintsBefore, "the Number fingerprint is byte-identical: no paid job can be nominated");

  // ── 3. Re-apply: a no-op, write-free ─────────────────────────────────────────────────────
  const resumed = await profiled(() => runStampCaptureRecovery({ manifestPath, apply: true, outDir: out, reportPath: null, log: () => undefined }));
  assert.deepEqual(resumed.writes, []);
  assert.equal(resumed.result.skipped_by_checkpoint, 2);
  assert.equal(resumed.result.outcomes.stamped, 0);
  const fresh = join(out, "fresh");
  const again = await profiled(() => runStampCaptureRecovery({ manifestPath, apply: true, outDir: fresh, reportPath: null, log: () => undefined }));
  assert.deepEqual(again.writes, [], "without a checkpoint, already-stamped rows are not written again");
  assert.equal(again.result.outcomes.already_stamped, 2);
  assert.equal(again.result.outcomes.stamped, 0);
  const jsonl = (await readFile(join(out, `stamp-capture-recovery-${manifest.run_id}-apply.jsonl`), "utf8")).trim().split("\n").map(l => JSON.parse(l) as { event: string });
  assert.ok(jsonl.some(l => l.event === "entry") && jsonl.some(l => l.event === "summary"), "the JSONL log records every entry and the summary");

  // ── 4. Readers: observed_reason (C19) and the Case File suffix ──────────────────────────
  const AS_OF = new Date(+at(0) + 4 * DAY);
  const callsOf = async (numberId: string) => (await readNumberTimelineV2(numberId, { kinds: ["call"], limit: 50 }, { now: () => AS_OF, coverage }))!.data.items;
  assert.equal((await callsOf(stale.contact_number_id!))[0]!.call!.observed_reason, "recovered");
  assert.equal((await callsOf(missing.contact_number_id!))[0]!.call!.observed_reason, "recovered", "recovered wins over late (inserted three days later)");
  assert.equal((await callsOf(late.contact_number_id!))[0]!.call!.observed_reason, "late_capture");
  assert.equal((await callsOf(ok.contact_number_id!))[0]!.call!.observed_reason, null);
  const caseFile = async (numberId: string, as_of = AS_OF) => assembleCaseFile(await caseFileInputFor({ contact_number_id: numberId, as_of, audience: "findings", prior: null, coverage }));
  const recoveredFile = await caseFile(missing.contact_number_id!);
  assert.match(recoveredFile.rendered.text, /\(recovered by a capture repair on Sun Sep 20\)/);
  assert.doesNotMatch(recoveredFile.rendered.text, /\(recorded Sun Sep 20\)/, "the recovery replaces the late-write wording");
  assert.doesNotMatch((await caseFile(late.contact_number_id!)).rendered.text, /recovered by a capture repair/);
  assert.match((await caseFile(late.contact_number_id!)).rendered.text, /\(recorded /);

  // ── 5. An in-progress webhook call on the ok Number (C16, C17) ──────────────────────────
  const okNumber = ok.contact_number_id!;
  const storyPage = async () => {
    const story = await assembleSubjectStory((await resolveStorySubject({ contact_number_id: okNumber, as_of: AS_OF }))!);
    return { story, page: storyToReadContent(story, coverage) };
  };
  const fileBase = await caseFile(okNumber);
  const storyBase = await storyPage();
  for (const record of [...storyBase.page.page.records, ...caseFileToReadContent(fileBase.file, fileBase.rendered, coverage).page.records])
    if (record.record_type === "story_event" && record.fields.kind === "call") for (const key of OWNER_KEYS) assert.ok(!String(record.fields.details).includes(`"${key}"`), `no ${key} on a model page`);
  const template = (await Calls.findById(ok.interaction_id).lean())!;
  const liveId = new mongoose.Types.ObjectId();
  const started = new Date(+AS_OF - 10 * MIN);
  await Calls.collection.insertOne({ ...template, _id: liveId, telephony_session_id: "s-live", call_log_ids: [], session_ids: [], direction: "Unknown", started_at: started,
    answered_at: null, ended_at: null, duration_seconds: null, provider_result: null, provider_connected: false, recordings: [], sources: ["webhook"], terminal: false,
    call_log_state: null, projection_revision: 1, first_observed_at: new Date(+started + 5000), last_observed_at: new Date(+started + 60_000) });

  const liveCalls = await callsOf(okNumber);
  assert.equal(liveCalls[0]!.id, `call:${liveId}`);
  assert.deepEqual([liveCalls[0]!.call!.in_progress, liveCalls[0]!.call!.terminal, liveCalls[0]!.call!.call_log_state, liveCalls[0]!.call!.result, liveCalls[0]!.call!.duration_seconds,
    liveCalls[0]!.call!.direction], [true, false, null, null, null, "Unknown"]);
  assert.equal(liveCalls[0]!.title, "Unknown call · In progress");
  // C17: the ok call has call_log_state settled from the Call Log; a historical null row is final (unit-proved); both read final here.
  assert.deepEqual([liveCalls[1]!.call!.in_progress, liveCalls[1]!.call!.result], [false, "Missed"]);
  const conversations = (await readOwnerConversations(okNumber, {}, { now: () => AS_OF, coverage: async () => coverage }))!;
  const liveOther = conversations.data.other_calls.find(c => c.interaction_id === String(liveId))!;
  assert.deepEqual([liveOther.in_progress, liveOther.result, liveOther.duration_seconds, liveOther.direction], [true, null, null, "Unknown"]);

  const storyLive = await storyPage();
  assert.equal(storyLive.story.coverage.excluded_in_progress, 1);
  assert.ok(!storyLive.story.events.some(e => e.id === `call:${liveId}`));
  assert.equal(storyLive.story.digest, storyBase.story.digest, "the model's story digest is unchanged");
  assert.deepEqual(storyLive.page.page.records, storyBase.page.page.records, "the model's story records are unchanged");
  const fileLive = await caseFile(okNumber);
  assert.equal(fileLive.file.coverage.excluded_in_progress, 1);
  assert.equal(fileLive.rendered.customer_evidence_digest, fileBase.rendered.customer_evidence_digest);
  const differing = fileLive.rendered.text.split("\n").filter((l, i) => l !== fileBase.rendered.text.split("\n")[i]);
  assert.equal(differing.length, 1, "only the §7 coverage line differs");
  assert.match(differing[0]!, /; 1 call still in progress not shown\./);
  assert.deepEqual(caseFileToReadContent(fileLive.file, fileLive.rendered, coverage).page.records, caseFileToReadContent(fileBase.file, fileBase.rendered, coverage).page.records);

  // The settle: terminal, settled, its real direction, result and duration.
  await Calls.collection.updateOne({ _id: liveId }, { $set: { terminal: true, call_log_state: "settled", direction: "Inbound", provider_result: "Call connected",
    provider_connected: true, duration_seconds: 420, ended_at: new Date(+started + 7 * MIN), sources: ["webhook", "call_log_reconcile"] } });
  const settled = (await callsOf(okNumber))[0]!;
  assert.deepEqual([settled.call!.in_progress, settled.call!.result, settled.call!.duration_seconds, settled.call!.call_log_state], [false, "Call connected", 420, "settled"]);
  const storySettled = await storyPage();
  assert.equal(storySettled.story.coverage.excluded_in_progress, undefined);
  // Final now, it is story again (here folded with the earlier unrecorded call into one attempt run, as the story collapses them).
  assert.ok(storySettled.story.events.some(e => e.id === `call:${liveId}` || (e.collapsed_ids ?? []).includes(`call:${liveId}`)), "the model reads it once final");
  const fileSettled = await caseFile(okNumber);
  assert.equal(fileSettled.file.coverage.excluded_in_progress, undefined);
  assert.ok(fileSettled.file.story_events.some(e => e.id === `call:${liveId}`), "the Case File carries it once final");
  assert.equal(await Jobs.countDocuments({}), jobsBefore, "no job was created by any read");
});
