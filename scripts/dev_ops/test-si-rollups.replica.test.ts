import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { applyCsiMigration } from "../migrations/sales-intelligence.lib";
import { getCallInteractionModel } from "../../src/models/CallInteraction";
import { getContactNumberModel } from "../../src/models/ContactNumber";
import { getFormLeadModel } from "../../src/models/FormLead";
import { getLeadConversationModel } from "../../src/models/LeadConversation";
import { getOutreachRecordModel } from "../../src/models/OutreachRecord";
import { getSalesIntelligenceJobModel } from "../../src/models/SalesIntelligenceJob";
import { applyInteractionObservation } from "../../src/services/numberActivity/persistInteraction";
import { callLogRecord, SYNTHETIC_ACCOUNT_ID, SYNTHETIC_SALES_DID, SYNTHETIC_USER_EXTENSION, syntheticDirectory, T0 } from "../../src/services/numberActivity/fixtures";
import { countNewlyAnalyzedConversation } from "../../src/services/salesIntelligence/analysis/apply";
import { ensureInteraction, ensureLead, workerContext } from "../../src/services/salesIntelligence/outreach/ensure";
import { runRetentionOnce } from "../../src/services/salesIntelligence/retention";
import { sweepDedupeKey, sweepNumberRollups, DEFAULT_SWEEP_ID } from "./sweep-number-rollups";

// S1-ROLLUP B1 (data spec §8, §9 S1): after the rebuild sweep every Number's new rollups equal their
// definitions, and the incremental writers (capture, apply, ensure, retention) already agreed with the
// rebuild before the sweep. Synthetic data only, on a disposable loopback replica database.
const enabled = process.env.CSI_REPLICA_TEST === "true";
const directory = syntheticDirectory();
const route = "a".repeat(24);
const resolveRoute = () => route;
const oid = () => new mongoose.Types.ObjectId();
const DAY = 86_400_000;
const OLD = new Date(T0.getTime() - 100 * DAY); // older than the 30-day retention windows set by the runner
const RETENTION_NOW = new Date(T0.getTime() + DAY);
const FIELDS = ["recordings_total", "conversations_analyzed_total", "last_analyzed_at", "outreach_records_total"] as const;

type Rollups = Record<(typeof FIELDS)[number], number | string | null | undefined>;
const phone = (n: number) => `+1202555${String(7000 + n)}`;

/** A Call Log record from `external` with `recordings` recordings (0, 1 or 2). */
function call(id: string, external: string, recordings: number, startTime: Date, options: { result?: string; direction?: "Inbound" | "Outbound"; sessionId?: string | null; telephonySessionId?: string | null } = {}) {
  const direction = options.direction ?? "Inbound";
  const customer = { phoneNumber: external, name: `Synthetic ${external.slice(-4)}` };
  const company = { phoneNumber: SYNTHETIC_SALES_DID, name: "Sales Line" };
  const rec = (i: number) => ({ id: `rec-${id}-${i}`, type: "Automatic" });
  const leg = (i: number) => ({ startTime: startTime.toISOString(), duration: 40, type: "Voice", direction, action: "Accept Call", result: "Accepted", legType: "Accept",
    ...(i === 0 ? { master: true } : {}), from: direction === "Inbound" ? customer : company, to: direction === "Inbound" ? company : customer,
    extension: { id: SYNTHETIC_USER_EXTENSION.id }, ...(i < recordings ? { recording: rec(i + 1) } : {}) });
  return callLogRecord({ id: `cl-${id}`, telephonySessionId: options.telephonySessionId === undefined ? id : options.telephonySessionId, sessionId: options.sessionId,
    direction, result: options.result ?? "Call connected", startTime, duration: 80,
    from: direction === "Inbound" ? customer : company, to: direction === "Inbound" ? company : customer,
    recording: recordings > 0 ? rec(1) : null, legs: options.result === "Missed" ? [] : Array.from({ length: Math.max(1, recordings) }, (_, i) => leg(i)) });
}

test("S1-ROLLUP B1: incremental rollups equal the rebuild, and the sweep recounts every Number", { skip: !enabled, timeout: 240_000 }, async (t) => {
  assert.equal(process.env.TEST_MODE, "true");
  assert.equal(getMongoDatabaseName(), "testvantagemovers_s1rollup");
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  await db.dropDatabase();
  assert.equal((await applyCsiMigration()).ready, true);
  t.after(async () => { await mongoose.disconnect(); });

  const Numbers = getContactNumberModel(), Interactions = getCallInteractionModel(), Conversations = getLeadConversationModel(), Records = getOutreachRecordModel();
  const capture = (record: ReturnType<typeof call>, now = T0) => applyInteractionObservation(SYNTHETIC_ACCOUNT_ID,
    { kind: "call_log", record, proof_ref: `call_log:${record.id}` }, { now: () => now, directory, resolveRoute });
  const numberOf = async (e164: string) => (await Numbers.findOne({ e164 }).lean())!;

  // --- Capture: 0 / 1 / 2 recordings, an update that adds a recording, a merge, an old call to purge.
  await capture(call("n1-a", phone(1), 0, T0));
  await capture(call("n1-b", phone(1), 1, new Date(+T0 + 60_000)));
  await capture(call("n1-c", phone(1), 2, new Date(+T0 + 120_000)));
  await capture(call("n2-a", phone(2), 1, T0));
  await capture(call("n2-a", phone(2), 2, T0), new Date(+T0 + 5_000)); // same call, a second recording observed later
  // Merge: A is known by telephony session only, B by session id only; the bridge names both.
  await capture(call("n3-m", phone(3), 1, T0, { sessionId: null }));
  const b = await capture({ ...call("n3-m-b", phone(3), 2, T0, { telephonySessionId: null, sessionId: "n3-m-sid" }) });
  const merged = await capture({ ...call("n3-m", phone(3), 1, T0, { sessionId: "n3-m-sid" }) }, new Date(+T0 + 10_000));
  assert.deepEqual(merged.merged_interaction_ids, [b.interaction_id], "the merge happened");
  // Retention: an old call with 2 recordings on a Number that also has a recent call.
  await capture(call("n4-old", phone(4), 2, OLD));
  await capture(call("n4-new", phone(4), 1, T0));

  const n1 = await numberOf(phone(1)), n2 = await numberOf(phone(2)), n3 = await numberOf(phone(3)), n4 = await numberOf(phone(4));
  assert.equal(n1.rollups.recordings_total, 3, "0 + 1 + 2");
  assert.equal(n2.rollups.recordings_total, 2, "update adds next − prev");
  assert.equal((await Interactions.findById(merged.interaction_id).lean())!.recordings.length, 3, "survivor holds A (1) + B (2)");
  assert.equal(n3.rollups.recordings_total, 3, "the tombstone's 2 moved to the survivor, not double counted");
  assert.equal(n4.rollups.recordings_total, 3);

  // --- Analysed conversations: the apply CAS (null -> run) plus its rollup write, a re-analysis, unanalysed and purged rows.
  const interactionOn = async (numberId: unknown) => (await Interactions.findOne({ contact_number_id: numberId, merged_into_id: null }).lean())!;
  let serial = 0;
  async function conversation(numberId: mongoose.Types.ObjectId, startedAt: Date, extra: Record<string, unknown> = {}) {
    const source = await interactionOn(numberId);
    return Conversations.create({ provider: "ringcentral", provider_account_id: SYNTHETIC_ACCOUNT_ID, provider_recording_id: `s1-rec-${++serial}`,
      call_interaction_id: source._id, contact_number_id: numberId, started_at: startedAt, direction: "Inbound", match_method: "number_only",
      match_confidence: "low", state: "transcribed", ...extra });
  }
  /** What `publishCurrent` does for a conversation run, in one transaction. */
  const publish = (conversationId: unknown) => withTransaction(async (session) => {
    const row = await Conversations.findById(conversationId).session(session).orFail();
    const result = await Conversations.updateOne({ _id: row._id, latest_completed_run_id: row.latest_completed_run_id }, { $set: { latest_completed_run_id: oid(), state: "complete" } }, { session });
    assert.equal(result.matchedCount, 1);
    await countNewlyAnalyzedConversation(row, session);
  });
  const c1 = await conversation(n1._id, new Date(+T0 + 60_000));
  const c2 = await conversation(n1._id, new Date(+T0 + 120_000));
  await conversation(n1._id, new Date(+T0 + 180_000)); // never analysed
  await publish(c1._id); await publish(c2._id);
  await publish(c2._id); // re-analysis replaces a non-null run: not a new analysed conversation
  // A purged row still carrying a run id is excluded by the definition (the retention purge nulls both in practice).
  await conversation(n2._id, T0, { latest_completed_run_id: oid(), content_purged_at: T0 });
  const c4 = await conversation(n2._id, new Date(+T0 + 30_000));
  await publish(c4._id);
  // n4: one analysed conversation whose summary is older than the transcript window: the retention purge zeroes the count.
  const c5 = await conversation(n4._id, T0, { summary: { text: "Synthetic summary", model: "synthetic", prompt_version: "synthetic", created_at: OLD } });
  await publish(c5._id);
  assert.equal((await numberOf(phone(1))).rollups.conversations_analyzed_total, 2);
  assert.equal(new Date((await numberOf(phone(1))).rollups.last_analyzed_at!).toISOString(), c2.started_at.toISOString());
  assert.equal((await numberOf(phone(4))).rollups.conversations_analyzed_total, 1);

  // --- Outreach: created with a primary, linked later, a Number review (primary and subject are one Number).
  async function formLead(numberE164: string) {
    const lead = { _id: oid(), timestamp: T0, createdAt: T0, updatedAt: T0, name: "Synthetic S1", normalized_phone_number: numberE164,
      ingested_contact_snapshot: { normalized_phone_number: numberE164, captured_at: T0 }, receiver_agent: oid() };
    await getFormLeadModel().collection.insertOne(lead);
    return { model: "FormLead" as const, id: String(lead._id) };
  }
  const ensure = (ref: { model: "FormLead"; id: string }, numberId?: string) => withTransaction((session) => ensureLead(ref, workerContext(session, String(oid()), T0), numberId));
  await ensure(await formLead(phone(1)), String(n1._id)); // outreach_created with primary
  const later = await formLead(phone(2));
  await ensure(later); // no Number yet
  await ensure(later, String(n2._id)); // outreach_number_linked
  await ensure(later, String(n2._id)); // already linked: no second count
  assert.equal((await numberOf(phone(1))).rollups.outreach_records_total, 1);
  assert.equal((await numberOf(phone(2))).rollups.outreach_records_total, 1);
  // Number review from an unanswered inbound call on an unlinked Number.
  await capture(call("n5-miss", phone(5), 0, T0, { result: "Missed" }));
  const n5 = await numberOf(phone(5));
  const missed = (await Interactions.findOne({ contact_number_id: n5._id, merged_into_id: null }).lean())!;
  assert.equal(missed.provider_connected, false);
  const review = await withTransaction((session) => ensureInteraction(missed as never, workerContext(session, String(oid()), T0)));
  assert.equal(review?.subject.kind, "number_review");
  await withTransaction((session) => ensureInteraction(missed as never, workerContext(session, String(oid()), T0))); // replay: no new record
  assert.equal(await Records.countDocuments({ primary_contact_number_id: n5._id, "subject.contact_number_id": n5._id }), 1);
  assert.equal((await numberOf(phone(5))).rollups.outreach_records_total, 1, "primary and subject: counted once");

  // --- Concurrency: captures and Outreach creations on one Number at the same time lose nothing.
  await capture(call("n6-seed", phone(6), 1, T0));
  const n6 = await numberOf(phone(6));
  const leads = await Promise.all(Array.from({ length: 6 }, () => formLead(phone(6))));
  await Promise.all([
    ...leads.map((ref) => ensure(ref, String(n6._id))),
    ...Array.from({ length: 4 }, (_, i) => capture(call(`n6-${i}`, phone(6), i % 3, new Date(+T0 + (i + 1) * 60_000)))),
  ]);
  const n6After = await numberOf(phone(6));
  assert.equal(n6After.rollups.outreach_records_total, 6, "no $inc lost to a concurrent capture");
  assert.equal(n6After.rollups.interactions_total, 5, "no capture lost to a concurrent $inc");
  assert.equal(n6After.rollups.recordings_total, 1 + 0 + 1 + 2 + 0);

  // --- Retention: the old n4 call's recordings leave the rollup; the old summary purges n4's analysed conversations.
  const retention = await runRetentionOnce({ now: () => RETENTION_NOW, deleteAudio: async () => { throw new Error("no audio in this proof"); } });
  assert.equal(retention.skipped, false, JSON.stringify(retention));
  assert.ok(retention.activity_purged >= 1 && retention.redacted_purged >= 1, JSON.stringify(retention));
  const n4After = await numberOf(phone(4));
  assert.equal(n4After.purged_at, null, "the Number itself has recent activity and stays");
  assert.equal(n4After.rollups.recordings_total, 1, "3 − the purged call's 2");
  assert.equal(n4After.rollups.conversations_analyzed_total, 0);
  assert.equal(n4After.rollups.last_analyzed_at, null);

  // --- A Number stored before S1 (no new rollup fields) with evidence: only the sweep can fill it.
  const legacyId = oid();
  await Numbers.collection.insertOne({ _id: legacyId, revision: 1, e164: phone(9), national_ten: phone(9).slice(2), digits_reversed: [...phone(9).slice(1)].reverse().join(""),
    country: "US", kind: "external", classification: "unknown", contact_eligibility: { state: "allowed" }, provider_names: [], search_terms: [],
    first_observed_at: T0, last_activity_at: T0, rollups: { interactions_total: 1, inbound_total: 1, outbound_total: 0, human_conversations_total: 0,
      attached_lead_count: 0, candidate_lead_count: 0, open_outreach_count: 0 }, createdAt: T0, updatedAt: T0 });
  await Interactions.create({ provider_account_id: SYNTHETIC_ACCOUNT_ID, telephony_session_id: "legacy-1", identity_basis: "telephony_session_id",
    contact_number_id: legacyId, direction: "Inbound", started_at: T0, first_observed_at: T0, last_observed_at: T0, terminal: true, parties: [],
    recordings: [{ provider_recording_id: "legacy-r1", observed_at: T0 }, { provider_recording_id: "legacy-r2", observed_at: T0 }] });
  await conversation(legacyId, T0).then((row) => publishDirect(row._id));
  async function publishDirect(id: unknown) { await Conversations.updateOne({ _id: id }, { $set: { latest_completed_run_id: oid() } }); }

  // --- Definitions, straight from the evidence.
  async function definition(numberId: mongoose.Types.ObjectId): Promise<Rollups> {
    const canonical = await Interactions.find({ contact_number_id: numberId, merged_into_id: null, purged_at: null }, { recordings: 1 }).lean();
    const analysed = await Conversations.find({ contact_number_id: numberId, latest_completed_run_id: { $ne: null }, content_purged_at: null }, { started_at: 1 }).lean();
    const latest = analysed.reduce<Date | null>((max, row) => (!max || row.started_at > max ? row.started_at : max), null);
    return {
      recordings_total: canonical.reduce((sum, row) => sum + row.recordings.length, 0),
      conversations_analyzed_total: analysed.length,
      last_analyzed_at: latest ? latest.toISOString() : null,
      outreach_records_total: await Records.countDocuments({ purged_at: null, $or: [{ primary_contact_number_id: numberId }, { "subject.contact_number_id": numberId }] }),
    };
  }
  const stored = (row: { rollups: Record<string, unknown> }): Rollups => Object.fromEntries(FIELDS.map((field) => {
    const value = row.rollups[field];
    return [field, value instanceof Date ? value.toISOString() : (value as number | null | undefined)];
  })) as Rollups;

  const all = await Numbers.find({}).sort({ _id: 1 }).lean();
  assert.equal(all.length, 7);
  const before = new Map(all.map((row) => [String(row._id), stored(row)]));
  // Incremental == definition (== what the rebuild writes) for every Number the incremental writers built.
  for (const row of all.filter((r) => !r._id.equals(legacyId))) assert.deepEqual(before.get(String(row._id)), await definition(row._id), `incremental ${row.e164}`);
  assert.equal(before.get(String(legacyId))!.recordings_total, undefined, "legacy row has no field until the sweep");

  // --- The sweep: dry run counts, write enqueues the existing rebuild job, inline drains it.
  const dry = await sweepNumberRollups({ write: false, inline: false });
  assert.equal(dry.numbers, 7);
  assert.equal(dry.jobs_created, 0);
  assert.equal(await getSalesIntelligenceJobModel().countDocuments({ dedupe_key: { $regex: `:all:${DEFAULT_SWEEP_ID}$` } }), 0, "a dry run writes nothing");
  const swept = await sweepNumberRollups({ write: true, inline: true });
  assert.equal(swept.jobs_created, 7);
  assert.equal(swept.inline_outcomes.completed, 7, JSON.stringify(swept.inline_outcomes));
  const job = await getSalesIntelligenceJobModel().findOne({ dedupe_key: sweepDedupeKey(String(n1._id), DEFAULT_SWEEP_ID) }).lean();
  assert.equal(job?.stage, "rebuild");
  assert.equal(job?.status, "completed");
  const rerun = await sweepNumberRollups({ write: true, inline: true });
  assert.equal(rerun.jobs_created, 0);
  assert.equal(rerun.jobs_existing, 7, "a rerun with the same sweep id creates nothing");

  for (const row of await Numbers.find({}).sort({ _id: 1 }).lean()) {
    const expected = await definition(row._id);
    assert.deepEqual(stored(row), expected, `after sweep ${row.e164}`);
    if (!row._id.equals(legacyId)) assert.deepEqual(before.get(String(row._id)), expected, `incremental equalled the rebuild ${row.e164}`);
  }
  const legacy = await Numbers.findById(legacyId).lean();
  assert.equal(legacy!.rollups.recordings_total, 2);
  assert.equal(legacy!.rollups.conversations_analyzed_total, 1);

  // A second rebuild of an unchanged Number changes nothing (no revision bump).
  const revision = (await Numbers.findById(n1._id).lean())!.revision;
  await sweepNumberRollups({ write: true, inline: true, sweepId: "s1-rollups-again" });
  assert.equal((await Numbers.findById(n1._id).lean())!.revision, revision);
});
