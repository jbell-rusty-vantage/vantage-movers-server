/**
 * AC1 K3 + K4 (Attention and Case File spec §3.4) on the csi01 replica.
 *
 * K3: a Number whose only change is a K1 write (system_default actions, automatic assignment,
 *     crm_disposition closure, unworked→open) enqueues no `number_refresh` through
 *     `scanIntelligenceChanges` → `scheduleNumberIntelligence`; an Owner assignment does.
 * K4: `refingerprint-numbers.ts` dry run writes nothing (Mongo op log = reads only, dbHash equal);
 *     `--apply` rewrites only settled Numbers' stored fingerprint, enqueues nothing, and a following
 *     scan enqueues nothing for them.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { applyCsiMigration } from "../migrations/sales-intelligence.lib";
import { getContactNumberModel } from "../../src/models/ContactNumber";
import { getCallInteractionModel } from "../../src/models/CallInteraction";
import { getLeadConversationModel } from "../../src/models/LeadConversation";
import { getOutreachRecordModel } from "../../src/models/OutreachRecord";
import { getOutreachFollowupModel } from "../../src/models/OutreachFollowup";
import { getSalesIntelligenceJobModel } from "../../src/models/SalesIntelligenceJob";
import { scanIntelligenceChanges, scheduleNumberIntelligence } from "../../src/services/salesIntelligence/analysis/scheduling";
import { intelligenceSources } from "../../src/services/salesIntelligence/analysis/sources";
import { workerContext } from "../../src/services/salesIntelligence/outreach/ensure";
import { auditChange, closeRecord, recordForUpdate, saveFollowup } from "../../src/services/salesIntelligence/outreach/store";
import { subjectKey } from "../../src/services/salesIntelligence/outreach/types";
import { legacyFingerprint, refingerprintNumbers } from "./refingerprint-numbers";

const WRITE_METHODS = /^(insert|update|replace|delete|findOneAndUpdate|findOneAndReplace|findOneAndDelete|findAndModify|bulkWrite|createIndex|drop|rename)/i;

test("AC1 K3/K4 fingerprint split on the replica", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 240_000 }, async (t) => {
  assert.match(getMongoDatabaseName(), /^testvantagemovers_t4c[a-z0-9]+$/);
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  t.after(async () => { await db.dropDatabase(); await mongoose.disconnect(); });
  assert.equal((await applyCsiMigration()).ready, true);
  const Jobs = getSalesIntelligenceJobModel(), Numbers = getContactNumberModel(), Records = getOutreachRecordModel(), Actions = getOutreachFollowupModel();
  const analysisJobs = () => Jobs.countDocuments({ stage: "number_refresh", dedupe_key: { $regex: "^csi:number-analysis:" } });
  let serial = 0;
  async function fixture(options: { transcript?: boolean; record?: boolean } = {}) {
    serial++;
    const at = new Date("2026-09-17T14:04:00Z");
    const number = await Numbers.create({ e164: `+1757555${String(1000 + serial)}`, digits_reversed: `t4c-${serial}`, first_observed_at: at, last_activity_at: at });
    const call = await getCallInteractionModel().create({ provider_account_id: "synthetic", telephony_session_id: `t4c-${serial}`, identity_basis: "telephony_session_id",
      contact_number_id: number._id, direction: "Outbound", started_at: at, first_observed_at: at, last_observed_at: at, terminal: true, parties: [], recordings: [] });
    if (options.transcript) await getLeadConversationModel().create({ provider: "ringcentral", provider_account_id: "synthetic", provider_recording_id: `t4c-rec-${serial}`,
      call_interaction_id: call._id, contact_number_id: number._id, started_at: at, direction: "Outbound", match_method: "number_only", match_confidence: "low",
      state: "transcribed", latest_transcript_version: `t4c-v-${serial}`, media_digest_sha256: "c".repeat(64) });
    const record = options.record === false ? null : await Records.create({ subject: { kind: "lead", model: "FormLead", id: new mongoose.Types.ObjectId() },
      primary_contact_number_id: number._id, trigger_kind: "lead_arrival", trigger_at: at, first_action_due_at: at, state: "unworked", revision: 1, policy_version: "csi-policy-v1" });
    return { number, call, record };
  }
  /** The scheduled state the old build leaves: a completed generation-1 job and the stored fingerprint. */
  async function settle(numberId: string, rule: "new" | "legacy" = "new") {
    const jobId = await withTransaction(s => scheduleNumberIntelligence(numberId, s));
    assert(jobId);
    await Jobs.updateOne({ _id: jobId }, { $set: { status: "completed" } });
    if (rule === "legacy") {
      const legacy = await withTransaction(async s => legacyFingerprint(await intelligenceSources(numberId, s)));
      await Numbers.updateOne({ _id: numberId }, { $set: { "intelligence_schedule.fingerprint": legacy } });
    }
    // The K4 script cases inspect a legacy-settled Number before any scheduling pass (the T4-D4 scheduler re-stamp was removed by Team 3, rewrite = 0).
    if (rule === "new") assert.equal(await withTransaction(s => scheduleNumberIntelligence(numberId, s)), null, "settled: the stored fingerprint matches");
    return jobId;
  }
  /** K1 writes through the real Outreach store paths (each appends the audit event the scan reads). */
  async function k1Writes(record: NonNullable<Awaited<ReturnType<typeof fixture>>["record"]>, callId: mongoose.Types.ObjectId) {
    await withTransaction(async s => {
      const context = workerContext(s, "t4c-k1"), key = subjectKey(record.subject);
      const row = await recordForUpdate(String(record._id), context);
      const prior = row.toObject();
      row.state = "open"; row.responsible_agent_id = new mongoose.Types.ObjectId(); row.first_attributable_outbound_at = new Date("2026-09-17T14:04:00Z");
      row.assignment = { origin: "first_conversation", assigned_at: context.now, evidence_id: callId } as never;
      row.revision++;
      await row.save({ session: s });
      await auditChange(context, "outreach", key, row, prior, row.toObject(), "first_conversation_assigned");
      for (const [n, description, extra] of [[1, "Return missed call", { missed_episode_key: "t4c-episode" }], [2, "Follow up on the quote", {}], [3, "Try again: promised callback not reached", {}]] as const) {
        const action = new Actions({ outreach_record_id: row._id, commitment_key: `t4c:${row._id}:${n}`, kind: "call", description, origin: "system_default",
          due_at: new Date("2026-09-18T14:00:00Z"), responsible_agent_id: row.responsible_agent_id, ...extra });
        await saveFollowup(action, null, context, key, "missed_call_episode");
      }
      const missed = await Actions.findOne({ outreach_record_id: row._id, commitment_key: `t4c:${row._id}:1` }).session(s).orFail();
      const before = missed.toObject();
      missed.status = "completed"; missed.disposition = "no_answer"; missed.completion_basis = "call_attempt"; missed.completed_at = new Date(); missed.evidence_interaction_id = callId;
      await saveFollowup(missed, before, context, key, "call_fulfilled_action");
      await closeRecord(row, "crm_dead", "crm_disposition", context);
    });
  }

  await t.test("K3: a K1-only change enqueues no number_refresh; an Owner assignment does", async () => {
    const f = await fixture({ transcript: true });
    await settle(String(f.number._id));
    const before = await withTransaction(s => intelligenceSources(String(f.number._id), s));
    const jobsBefore = await analysisJobs();
    await k1Writes(f.record!, f.call._id);
    const after = await withTransaction(s => intelligenceSources(String(f.number._id), s));
    assert.equal(after.actions.length, 3, "three system_default actions exist");
    assert.equal((await Records.findById(f.record!._id).lean())!.closure_origin, "crm_disposition");
    assert.equal(after.fingerprint, before.fingerprint, "K1 writes leave the new fingerprint byte-identical");
    assert.notEqual(legacyFingerprint(after), legacyFingerprint(before), "control: the 01bcf18 rule would have changed");
    const scan = await scanIntelligenceChanges();
    assert.equal(scan.status, "scanned");
    assert.ok(scan.changed >= 1, "the audit stream nominated the Number");
    assert.deepEqual(scan.job_ids, [], "no job woken");
    assert.equal(await analysisJobs(), jobsBefore, "no number_refresh enqueued");
    // K2 control through the same scan: an Owner assignment registers.
    await withTransaction(async s => {
      const context = workerContext(s, "t4c-owner"), row = await recordForUpdate(String(f.record!._id), context), prior = row.toObject();
      row.responsible_agent_id = new mongoose.Types.ObjectId(); row.assignment = { origin: "owner", assigned_at: context.now, actor_id: "owner-1" } as never; row.revision++;
      await row.save({ session: s });
      await auditChange(context, "outreach", subjectKey(row.subject), row, prior, row.toObject(), "assign");
    });
    const second = await scanIntelligenceChanges();
    assert.equal(second.job_ids.length, 1, "the Owner assignment enqueues exactly one run");
    assert.equal(await analysisJobs(), jobsBefore + 1);
  });

  await t.test("K4: dry run is write-free; --apply rewrites settled Numbers only; the next scan enqueues nothing", async () => {
    // A: settled under the old rule, then a K1-only write → the old rule differs, the new one would re-run: "rewrite".
    const a = await fixture({ transcript: true });
    await settle(String(a.number._id), "legacy");
    // B: settled under the old rule, nothing Outreach-specific differs between rules → "rewrite" only if the rules disagree.
    const b = await fixture({ record: false });
    await settle(String(b.number._id), "legacy");
    // C: settled under the old rule, then a real change (a new call) → "pending_change", scheduled normally.
    const c = await fixture({ transcript: true });
    await settle(String(c.number._id), "legacy");
    await getCallInteractionModel().create({ provider_account_id: "synthetic", telephony_session_id: `t4c-c-new`, identity_basis: "telephony_session_id",
      contact_number_id: c.number._id, direction: "Inbound", started_at: new Date("2026-09-19T15:00:00Z"), first_observed_at: new Date(), last_observed_at: new Date(), terminal: true, parties: [], recordings: [] });
    // D: a scheduled job still pending → "active_job".
    const d = await fixture({ transcript: true });
    const dJob = await withTransaction(s => scheduleNumberIntelligence(String(d.number._id), s));
    assert(dJob);
    // E: never scheduled → counted as without_schedule, untouched.
    await fixture({ record: false });
    const legacyA = (await Numbers.findById(a.number._id).lean())!.intelligence_schedule!.fingerprint;
    const newA = (await withTransaction(s => intelligenceSources(String(a.number._id), s))).fingerprint;
    assert.notEqual(legacyA, newA, "A has an Outreach record, so the rules differ (subject/state/actions shape)");

    // Dry run: op log and dbHash.
    const ops: string[] = [];
    mongoose.set("debug", (collection: string, method: string) => { ops.push(`${collection}.${method}`); });
    const hashBefore = await db.command({ dbHash: 1 });
    const jobsBefore = await Jobs.countDocuments({});
    const dry = await refingerprintNumbers({ apply: false, limit: 1000 });
    mongoose.set("debug", false);
    const hashAfter = await db.command({ dbHash: 1 });
    const writes = ops.filter(op => WRITE_METHODS.test(op.split(".").at(-1)!));
    assert.deepEqual(writes, [], `dry run issued only reads (${ops.length} ops)`);
    assert.equal(hashAfter.md5, hashBefore.md5, "dbHash identical before/after the dry run");
    assert.equal(await Jobs.countDocuments({}), jobsBefore);
    console.log(JSON.stringify({ k4_dry_run: dry, ops: ops.length, distinct_methods: [...new Set(ops.map(o => o.split(".").at(-1)))].sort() }));
    assert.equal(dry.mode, "dry_run");
    assert.equal(dry.without_schedule, 1);
    assert.equal(dry.counts.active_job, 2, "D, and the K3 Number whose Owner-assignment run is still pending");
    assert.equal(dry.counts.unchanged, 1, "B: without an Outreach record both rules hash the same");
    assert.equal(dry.counts.pending_change, 1);
    assert.ok(dry.counts.rewrite >= 1, "A would be rewritten");
    assert.ok(dry.sample_rewrite.includes(String(a.number._id)));
    assert.equal(dry.applied, 0);
    // Bounded: --limit stops the walk and says so.
    const bounded = await refingerprintNumbers({ apply: false, limit: 2 });
    assert.equal(bounded.scanned, 2);
    assert.equal(bounded.truncated, true);

    // Apply.
    const applied = await refingerprintNumbers({ apply: true, limit: 1000 });
    console.log(JSON.stringify({ k4_apply: applied }));
    assert.equal(applied.applied, dry.counts.rewrite);
    assert.equal(await Jobs.countDocuments({}), jobsBefore, "apply enqueues nothing");
    assert.equal((await Numbers.findById(a.number._id).lean())!.intelligence_schedule!.fingerprint, newA);
    assert.equal((await Numbers.findById(c.number._id).lean())!.intelligence_schedule!.fingerprint, (await Numbers.findById(c.number._id).lean())!.intelligence_schedule!.fingerprint);
    const again = await refingerprintNumbers({ apply: false, limit: 1000 });
    assert.equal(again.counts.rewrite, 0, "idempotent: nothing left to rewrite");
    // The next scheduling pass: A and B enqueue nothing; C (the real change) enqueues one; D returns its active job.
    const before = await analysisJobs();
    assert.equal(await withTransaction(s => scheduleNumberIntelligence(String(a.number._id), s)), null);
    assert.equal(await withTransaction(s => scheduleNumberIntelligence(String(b.number._id), s)), null);
    assert.equal(await withTransaction(s => scheduleNumberIntelligence(String(d.number._id), s)), dJob);
    assert.equal(await analysisJobs(), before, "no run for settled or active Numbers");
    assert.ok(await withTransaction(s => scheduleNumberIntelligence(String(c.number._id), s)), "the pending real change is still scheduled");
    assert.equal(await analysisJobs(), before + 1);
  });

  await t.test("V-AC N3: system_default actions no longer push a Number into the paused overflow intent", async () => {
    const f = await fixture({ transcript: true });
    await Actions.insertMany(Array.from({ length: 250 }, (_, i) => ({ outreach_record_id: f.record!._id, commitment_key: `t4c-n3:${f.record!._id}:${i}`, kind: "call",
      description: "Return missed call", status: "completed", origin: "system_default", completion_basis: "call_attempt", missed_episode_key: `t4c-n3-${i}`,
      due_at: new Date("2026-09-18T14:00:00Z") })));
    await Actions.insertMany(Array.from({ length: 3 }, (_, i) => ({ outreach_record_id: f.record!._id, commitment_key: `t4c-n3-promise:${f.record!._id}:${i}`, kind: "call",
      description: "Call back", status: "open", origin: "rep_promise", due_at: new Date("2026-09-19T14:00:00Z") })));
    const jobId = await withTransaction(s => scheduleNumberIntelligence(String(f.number._id), s));
    const job = await Jobs.findById(jobId).lean();
    console.log(JSON.stringify({ n3: { actions: 253, dedupe_key: job?.dedupe_key, status: job?.status } }));
    assert.match(String(job?.dedupe_key), /^csi:number-analysis:[a-f0-9]{24}:1$/, "a normal generation-1 run, not csi:number-analysis:overflow");
    assert.equal(job?.status, "pending");
    // 201 fingerprinted actions still overflow, exactly as before.
    await Actions.insertMany(Array.from({ length: 198 }, (_, i) => ({ outreach_record_id: f.record!._id, commitment_key: `t4c-n3-more:${f.record!._id}:${i}`, kind: "call",
      description: "Call back", status: "open", origin: "rep_promise", due_at: new Date("2026-09-19T14:00:00Z") })));
    await Jobs.updateOne({ _id: jobId }, { $set: { status: "completed" } });
    const overflow = await Jobs.findById(await withTransaction(s => scheduleNumberIntelligence(String(f.number._id), s))).lean();
    assert.equal(overflow?.dedupe_key, `csi:number-analysis:overflow:${f.number._id}`);
    assert.equal(overflow?.status, "paused");
  });
});
