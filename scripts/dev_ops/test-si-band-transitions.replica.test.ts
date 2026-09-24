import assert from "node:assert/strict";
import { test } from "node:test";
import express, { type Request } from "express";
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { applyCsiMigration } from "../migrations/sales-intelligence.lib";
import { getContactNumberModel } from "../../src/models/ContactNumber";
import { getCallInteractionModel } from "../../src/models/CallInteraction";
import { getEntityChangeModel } from "../../src/models/EntityChange";
import { getFormLeadModel } from "../../src/models/FormLead";
import { getOutreachRecordModel } from "../../src/models/OutreachRecord";
import { getOutreachFollowupModel } from "../../src/models/OutreachFollowup";
import { getRepIdentityLinkModel } from "../../src/models/RepIdentityLink";
import { getSalesIntelligenceJobModel } from "../../src/models/SalesIntelligenceJob";
import { getSalesIntelligenceAttentionSnapshotModel } from "../../src/models/SalesIntelligenceAttentionSnapshot";
import { getIntelligenceRunModel } from "../../src/models/IntelligenceRun";
import { getIntelligenceFindingModel } from "../../src/models/IntelligenceFinding";
import { getOutreachBandTransitionModel } from "../../src/models/salesIntelligence/outreach";
import { requireCsiOwner } from "../../src/services/salesIntelligence/auth";
import { computeAdminActorSignature } from "../../src/services/operationsRegistry/trustedActor";
import { persistLeadAttachments } from "../../src/services/salesIntelligence/attachment/store";
import { ensureLead, workerContext } from "../../src/services/salesIntelligence/outreach/ensure";
import { runOutreachEnsureJob } from "../../src/services/salesIntelligence/outreach/worker";
import { applyOutreachEffect, outreachEffectInputSchema } from "../../src/services/salesIntelligence/outreach/effects";
import { commandOutreach } from "../../src/services/salesIntelligence/followups/commands";
import { enqueueCsiJob } from "../../src/services/salesIntelligence/jobs";
import { readOutreach } from "../../src/services/salesIntelligence/outreach/reads";
import { clearParsedAttentionSnapshots, publishAttentionSnapshot, readAttention } from "../../src/services/salesIntelligence/outreach/attention";
import { readOutreachTimeline } from "../../src/services/salesIntelligence/outreach/timelineRead";
import { readCaptureCoverage } from "../../src/services/numberActivity/coverage";
import type { AttentionRowDto } from "../../src/services/salesIntelligence/dto";
import type { CsiCommand } from "../../src/validation/v1/salesIntelligence";

/**
 * S9-PUBLISH (assignment addendum §6.3, reconciliation §4.3 / G8; C12, C23) on the csi01 loopback replica,
 * `testvantagemovers_t3bbands`, with ATTENTION_V2, ATTENTION_EVOLUTION, CASE_FILE, PROGRESS_PLAN, LEAD_PROGRESS and OVERVIEW on.
 *
 * 1. The first publish writes one `baseline` row per active row (estimated); the second writes none (C12, C23).
 * 2. A band change writes exactly one row, with the cause of the real path that moved it: a call applied through
 *    `runOutreachEnsureJob`, a recovered call (`capture_recovery`), accepted Lead progress, an LLM follow-up effect
 *    and an Owner command.
 * 3. A `publish_meta` flip (ATTENTION_EVOLUTION) with unchanged records writes `policy` rows only.
 * 4. The publish adds one snapshot header read in steady state and one audit `$in` when rows change, independent of
 *    the row count; `GET /attention`, the detail and the timeline reads stay flat as transition rows grow.
 * 5. The detail and the timeline carry `band_since` and `band_changed`.
 * No paid job runs; Owner commands enqueue their usual `csi:owner-outreach:` Number refresh, which is never run.
 */
const READ_METHODS = new Set(["find", "findOne", "aggregate", "distinct", "countDocuments", "estimatedDocumentCount", "count"]);
const MIN = 60_000, DAY = 86_400_000;

test("S9-PUBLISH band transitions replica", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 600_000 }, async t => {
  assert.equal(getMongoDatabaseName(), "testvantagemovers_t3bbands");
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  for (const flag of ["ATTENTION_V2", "ATTENTION_EVOLUTION", "CASE_FILE", "PROGRESS_PLAN", "OVERVIEW", "LEAD_PROGRESS"]) assert.equal(process.env[`SALES_INTELLIGENCE_${flag}`], "true", flag);
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  await db.dropDatabase();
  t.after(async () => { await db.dropDatabase(); await mongoose.disconnect(); });
  assert.equal((await applyCsiMigration()).ready, true);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("External traffic forbidden in the S9 replica proof"); });

  const oid = () => new mongoose.Types.ObjectId();
  const request: Request = Object.assign(Object.create(express.request), { method: "POST", originalUrl: "/api/v1/admin/sales-intelligence/outreach/commands", headers: {},
    vantageAuth: { kind: "user", userId: "synthetic-owner", email: "owner@example.test", roles: ["owner"] } });
  const fields = { adminId: "synthetic-owner", email: "owner@example.test", role: "owner", timestamp: String(Date.now()), requestId: "t3b-proof", method: request.method, path: request.originalUrl };
  request.headers = { "x-vantage-admin-user-id": fields.adminId, "x-vantage-admin-email": fields.email, "x-vantage-admin-role": fields.role, "x-vantage-admin-timestamp": fields.timestamp,
    "x-vantage-admin-request-id": fields.requestId, "x-vantage-admin-signature": computeAdminActorSignature(fields, process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET!) };
  const actor = requireCsiOwner(request);
  const Records = getOutreachRecordModel(), Actions = getOutreachFollowupModel(), Jobs = getSalesIntelligenceJobModel(), Transitions = getOutreachBandTransitionModel();
  const jordan = oid();
  await getRepIdentityLinkModel().create({ agent_id: jordan, agent_name_snapshot: "Jordan", rc_account_id: "synthetic", rc_extension_id: "101", role_kind: "sales_rep", status: "reviewed",
    effective_from: new Date(Date.now() - 400 * DAY) });
  let serial = 0, domainRevision = 0;
  /** A Form Lead three days old with its Number and an assigned record: band 2 `no_call_yet` (band 6 never masks it). */
  async function fixture() {
    const at = new Date(Date.now() - 3 * DAY);
    const n = await getContactNumberModel().create({ e164: `+120255509${String(++serial).padStart(2, "0")}`, digits_reversed: `t3b${serial}`, first_observed_at: at, last_activity_at: at });
    const lead = { _id: oid(), timestamp: at, createdAt: at, updatedAt: at, name: `Synthetic T3B ${serial}`, normalized_phone_number: n.e164,
      ingested_contact_snapshot: { normalized_phone_number: n.e164, captured_at: at }, quoted: false, domain_revision: 0 };
    await getFormLeadModel().collection.insertOne(lead);
    await withTransaction(async session => {
      await ensureLead({ model: "FormLead", id: String(lead._id) }, workerContext(session, String(oid()), at), String(n._id));
      await persistLeadAttachments(lead, "FormLead", session, String(oid()), at);
    });
    const record = await Records.findOne({ "subject.id": lead._id }).orFail();
    await Records.collection.updateOne({ _id: record._id }, { $set: { responsible_agent_id: jordan, assignment: { origin: "first_conversation", assigned_at: at } } });
    return { n, lead, record, key: `lead:FormLead:${lead._id}`, ref: { id: String(lead._id), _id: lead._id } };
  }
  const attempt = (number: mongoose.Types.ObjectId, extra: Record<string, unknown> = {}) => {
    const started_at = new Date(Date.now() - 10 * MIN);
    return getCallInteractionModel().create({ provider_account_id: "synthetic", telephony_session_id: String(oid()), identity_basis: "telephony_session_id", contact_number_id: number,
      direction: "Outbound", started_at, ended_at: new Date(+started_at + 60_000), first_observed_at: started_at, last_observed_at: started_at, terminal: true, provider_connected: false,
      contact_type: "unknown", parties: [{ role: "user", extension_id: "101", direction: "Outbound", connected: true }], ...extra });
  };
  /** The production path: one `outreach_ensure` job per call, run through `runOutreachEnsureJob`. */
  async function viaJob(c: { _id: unknown; contact_number_id?: unknown }) {
    const job = await withTransaction(s => enqueueCsiJob({ stage: "outreach_ensure", subject_key: `number:${c.contact_number_id}`, dedupe_key: `csi:t3b:interaction:${c._id}`,
      input_revision: 1, input_refs: [String(c._id)] }, s));
    assert.equal((await runOutreachEnsureJob(String(job._id))).status, "completed");
  }
  /** An accepted Granot write: the Lead value plus the EntityChange the lifecycle command appends, then `ensureLead` with it. */
  async function acceptProgress(ref: { id: string; _id: mongoose.Types.ObjectId }, patch: { granot_priority?: string | null; quoted?: boolean }) {
    const before = await getFormLeadModel().collection.findOne({ _id: ref._id });
    await getFormLeadModel().collection.updateOne({ _id: ref._id }, { $set: { ...patch, domain_revision: ++domainRevision } });
    const change = await getEntityChangeModel().collection.insertOne({ entity: { model: "FormLead", id: ref.id }, command_execution_id: oid(), command_name: "synchronizeLeadFromGranot",
      provenance: { source_system: "granot", actor: { actor_type: "system", actor_id: "test" }, initiator: { actor_type: "system", actor_id: "test" }, request_id: String(oid()), observation_id: oid(), decision_id: oid() },
      changed_paths: Object.keys(patch).sort(), fields: Object.entries(patch).map(([path, after]) => ({ path, value_mode: "stored", before: before?.[path] ?? null, after })),
      revision_before: domainRevision - 1, revision_after: domainRevision, applied_at: new Date(Date.now() - MIN) } as never);
    await withTransaction(s => ensureLead({ model: "FormLead", id: ref.id }, workerContext(s, String(oid())), undefined, { changeId: String(change.insertedId) }));
  }
  const command = (target: unknown, body: CsiCommand) => commandOutreach({ actor, target_id: String(target), command: body, idempotency_key: String(oid()) });
  async function rows(): Promise<AttentionRowDto[]> {
    const out: AttentionRowDto[] = [];
    let cursor: string | undefined;
    do {
      const page = await readAttention({ view: "all_outreach", limit: 200, ...(cursor ? { cursor } : {}) });
      out.push(...page.data.items);
      cursor = page.data.cursor ?? undefined;
    } while (cursor);
    return out;
  }
  const rowFor = async (key: string) => (await rows()).find(r => r.subject_key === key)!;
  async function publish() {
    const result = await publishAttentionSnapshot() as { status: string; snapshot_id: string; band_transitions?: number };
    assert.equal(result.status, "published");
    return result;
  }
  const rowsOf = (snapshotId: string) => Transitions.find({ snapshot_id: snapshotId }).lean();
  async function countReads<T>(work: () => Promise<T>) {
    const byCollection: Record<string, number> = {};
    let reads = 0;
    mongoose.set("debug", (collection: string, method: string) => {
      if (!READ_METHODS.has(method) && method !== "insertMany") return;
      if (READ_METHODS.has(method)) reads++;
      byCollection[`${collection}.${method}`] = (byCollection[`${collection}.${method}`] ?? 0) + 1;
    });
    try { return { result: await work(), reads, byCollection }; } finally { mongoose.set("debug", false); }
  }
  const paidJobs = () => Jobs.countDocuments({ stage: { $in: ["transcription", "analysis", "move_assessment"] } });
  const automaticRefresh = () => Jobs.countDocuments({ stage: "number_refresh", dedupe_key: { $not: /^csi:owner-outreach:/ } });

  const fx = [] as Awaited<ReturnType<typeof fixture>>[];
  for (let i = 0; i < 6; i++) fx.push(await fixture());
  const [fCall, fRepair, fProgress, fOwner, fPolicy, fEffect] = fx as [typeof fx[number], typeof fx[number], typeof fx[number], typeof fx[number], typeof fx[number], typeof fx[number]];
  // An overdue exact callback the customer asked for: band 1 with ATTENTION_EVOLUTION (F8), band 4 without. Written
  // directly, so the record revision never moves (the `policy` case).
  await Actions.create({ outreach_record_id: fPolicy.record._id, commitment_key: `t3b:${oid()}`, kind: "call", description: "Customer asked for a call back", origin: "customer_request",
    requested_by: "customer", due_at: new Date(Date.now() - 2 * DAY), base_attention_due_at: new Date(Date.now() - 2 * DAY), responsible_agent_id: jordan,
    date_resolution: { precision: "exact", timezone: "America/New_York", anchor: new Date(Date.now() - 3 * DAY), policy_version: "csi-policy-v1" } });
  // fEffect: one attempt first, so it is an open record with no next step (band 5) before the follow-up effect.
  const effectCall = await attempt(fEffect.n._id);
  await viaJob(effectCall);

  await t.test("C23: the first OVERVIEW publish writes one estimated baseline row per active row; the second writes none (C12)", async () => {
    assert.equal(await Transitions.countDocuments({}), 0);
    const first = await publish();
    const active = (await rows()).filter(r => r.partition !== "closed" && r.outreach);
    const baseline = await rowsOf(first.snapshot_id);
    assert.equal(first.band_transitions, active.length);
    assert.equal(baseline.length, active.length, "one row per active row");
    assert.ok(baseline.every(r => r.cause.kind === "baseline" && r.estimated === true && r.from_band === null));
    assert.equal(new Set(baseline.map(r => String(r.record_id))).size, baseline.length);
    for (const row of active) {
      const b = baseline.find(r => r.subject_key === row.subject_key)!;
      assert.equal(b.to_band, row.derived.attention_band);
      if (row.derived.attention_band == null) assert.equal(row.outreach!.band_since, null);
      else assert.deepEqual(row.outreach!.band_since, { at: b.at.toISOString(), estimated: true });
      assert.equal(row.filter_keys?.responsible, String(jordan));
      assert.equal(typeof row.filter_keys?.overdue, "boolean");
    }
    const band2 = baseline.find(r => r.subject_key === fCall.key)!;
    assert.equal(band2.to_band, 2);
    assert.equal(band2.to_reason, "no_call_yet");
    assert.equal(+band2.at, +(await Records.findById(fCall.record._id).orFail()).first_action_due_at!, "band 2 no_call_yet: first_action_due_at");
    assert.equal((await rowFor(fPolicy.key)).derived.attention_band, 1);
    const header = await getSalesIntelligenceAttentionSnapshotModel().findOne({ snapshot_id: first.snapshot_id }).lean();
    assert.equal((header as { publish_meta?: { flags: Record<string, boolean> } }).publish_meta?.flags.OVERVIEW, true);
    const before = await rows();
    const second = await publish();
    assert.equal(second.band_transitions, 0);
    assert.equal(await Transitions.countDocuments({}), baseline.length, "the baseline is written once");
    const after = await rows();
    for (const row of after.filter(r => r.outreach)) assert.deepEqual(row.outreach!.band_since, before.find(b => b.subject_key === row.subject_key)!.outreach!.band_since, "band_since carried forward");
  });

  const onlyRow = async (snapshotId: string, key: string) => {
    const written = await rowsOf(snapshotId);
    assert.deepEqual(written.map(r => r.subject_key), [key], "exactly one row, for the changed record only");
    return written[0]!;
  };

  await t.test("C12: a call applied through the worker writes one `call` row naming the call", async () => {
    const c = await attempt(fCall.n._id);
    await viaJob(c);
    const published = await publish();
    const row = await onlyRow(published.snapshot_id, fCall.key);
    assert.equal(row.from_band, 2);
    assert.notEqual(row.to_band, 2);
    assert.deepEqual([row.cause.kind, row.cause.event_kind, row.cause.target_id], ["call", "outreach_call_applied", String(c._id)]);
    assert.ok(row.cause.audit_id);
    assert.equal(row.estimated, false);
    const published2 = await publish();
    assert.equal(published2.band_transitions, 0, "an unchanged publish writes none");
  });

  await t.test("C23: a recovered call (capture_recovery) writes `capture_repair`", async () => {
    const c = await attempt(fRepair.n._id, { capture_recovery: { run_id: "call-log-repair-proof", at: new Date(), kind: "added" } });
    await viaJob(c);
    const row = await onlyRow((await publish()).snapshot_id, fRepair.key);
    assert.deepEqual([row.cause.kind, row.cause.target_id], ["capture_repair", String(c._id)]);
  });

  await t.test("C12: accepted Lead progress writes one `lead_progress` row", async () => {
    await acceptProgress(fProgress.ref, { granot_priority: "1", quoted: true });
    const row = await onlyRow((await publish()).snapshot_id, fProgress.key);
    assert.equal(row.from_band, 2);
    assert.equal(row.cause.kind, "lead_progress");
    assert.ok(["lead_progress_updated", "progress_default_created"].includes(row.cause.event_kind!), String(row.cause.event_kind));
  });

  await t.test("C12: an LLM follow-up effect writes one `followup` row", async () => {
    const before = (await rowFor(fEffect.key)).derived.attention_band;
    assert.equal(before, 5, "open with no next step");
    const record = await Records.findById(fEffect.record._id).orFail();
    const run_id = oid(), finding_id = oid();
    await getIntelligenceRunModel().collection.insertOne({ _id: run_id, subject_key: fEffect.key, contact_number_id: fEffect.n._id, job_id: oid() } as never);
    await getIntelligenceFindingModel().collection.insertOne({ _id: finding_id, run_id, key: "promise" } as never);
    const applied = await withTransaction(s => applyOutreachEffect(outreachEffectInputSchema.parse({ run_id: String(run_id), finding_id: String(finding_id), finding_key: "promise",
      outreach_record_id: String(record._id), interaction_id: String(effectCall._id), expected_revision: record.revision, kind: "create_followup", action_kind: "call",
      description: "Call next week", origin: "rep_promise", promising_agent_id: String(jordan), clear: true, history_complete: true,
      date: { exact: new Date(Date.now() + 7 * DAY).toISOString() } }), workerContext(s, String(oid()))));
    assert.equal(applied.status, "applied");
    const row = await onlyRow((await publish()).snapshot_id, fEffect.key);
    assert.deepEqual([row.from_band, row.cause.kind], [5, "followup"]);
    assert.equal(row.to_band, null, "a future plan takes the record off the desk");
    assert.equal(row.band_since, null);
  });

  await t.test("C12: an Owner command writes one `owner` row", async () => {
    const revision = (await Records.findById(fOwner.record._id).orFail()).revision;
    await command(fOwner.record._id, { command: "set_waiting", expected_revision: revision, until: new Date(Date.now() + 3 * DAY).toISOString(), reason: "Customer travelling" } as CsiCommand);
    const row = await onlyRow((await publish()).snapshot_id, fOwner.key);
    assert.deepEqual([row.from_band, row.cause.kind], [2, "owner"]);
    assert.ok(["set_waiting", "owner_followup_created"].includes(row.cause.event_kind!), String(row.cause.event_kind));
  });

  await t.test("C23: a flag flip with unchanged records writes `policy` rows only", async () => {
    const revision = (await Records.findById(fPolicy.record._id).orFail()).revision;
    process.env.SALES_INTELLIGENCE_ATTENTION_EVOLUTION = "false";
    let offRows;
    try {
      const published = await publish();
      offRows = await rowsOf(published.snapshot_id);
    } finally { process.env.SALES_INTELLIGENCE_ATTENTION_EVOLUTION = "true"; }
    const mine = offRows.find(r => r.subject_key === fPolicy.key)!;
    // Flag off, a customer-requested callback is not band 1 (F8); the never-called Form Lead is band 2 `no_call_yet`.
    assert.deepEqual([mine.from_band, mine.to_band, mine.cause.kind], [1, 2, "policy"]);
    assert.ok(offRows.every(r => r.cause.kind === "policy"), JSON.stringify(offRows.map(r => [r.subject_key, r.cause.kind])));
    assert.equal((await Records.findById(fPolicy.record._id).orFail()).revision, revision, "no record write");
    const back = await rowsOf((await publish()).snapshot_id);
    assert.deepEqual(back.find(r => r.subject_key === fPolicy.key)?.cause.kind, "policy");
    assert.ok(back.every(r => r.cause.kind === "policy"));
    assert.equal((await publish()).band_transitions, 0, "stable again");
  });

  await t.test("detail and timeline show band_since and band_changed", async () => {
    const row = await rowFor(fCall.key);
    const detail = await readOutreach(String(fCall.record._id));
    assert.ok(row.outreach!.band_since && row.outreach!.band_since.estimated === false);
    assert.deepEqual(detail?.data.outreach.band_since, row.outreach!.band_since, "detail reads the newest transition row");
    const timeline = await readOutreachTimeline(String(fCall.record._id), { limit: 50 }, {});
    const bands = timeline!.data.items.filter(e => e.kind === "band_changed");
    assert.deepEqual(bands.map(e => (e.detail as { cause?: { kind?: string } }).cause?.kind), ["call", "baseline"], "the call, then the baseline (newest first)");
    const call = bands.find(e => (e.detail as { cause?: { kind?: string } }).cause?.kind === "call")!;
    assert.equal(call.routine, false, "a call cause is not routine");
    assert.match(call.title, /^Moved from band 2 to /);
    const baseline = bands.find(e => (e.detail as { cause?: { kind?: string } }).cause?.kind === "baseline")!;
    assert.equal(baseline.routine, true);
    const only = await readOutreachTimeline(String(fCall.record._id), { limit: 1, kinds: ["band_changed"] }, {});
    assert.equal(only!.data.items.length, 1);
    assert.equal(only!.data.items[0]!.id, bands[0]!.id, "newest first");
    const next = await readOutreachTimeline(String(fCall.record._id), { limit: 1, kinds: ["band_changed"], cursor: only!.data.cursor! }, {});
    assert.equal(next!.data.items[0]!.id, bands[1]!.id, "the keyset pages without loss");
    assert.equal(next!.data.cursor, null);
  });

  await t.test("publish: one header read in steady state, one audit $in when rows change; reads flat as rows grow", async () => {
    await readCaptureCoverage();
    const steady1 = await countReads(() => publish());
    const unexpected = await rowsOf(steady1.result.snapshot_id);
    assert.deepEqual(unexpected.map(r => [r.subject_key, r.from_band, r.to_band, r.from_reason, r.to_reason, r.cause.kind]), [], "steady publish");
    const detail1 = await countReads(() => readOutreach(String(fCall.record._id)));
    const timeline1 = await countReads(() => readOutreachTimeline(String(fCall.record._id), { limit: 50 }, {}));
    clearParsedAttentionSnapshots();
    const page1 = await countReads(() => readAttention({ view: "all_outreach", limit: 50 }));
    // More records and more transition rows.
    const more = [] as Awaited<ReturnType<typeof fixture>>[];
    for (let i = 0; i < 24; i++) more.push(await fixture());
    await publish(); // they join the active set (from null)
    for (const f of more.slice(0, 12)) await viaJob(await attempt(f.n._id));
    const changed = await countReads(() => publish());
    assert.equal(changed.result.band_transitions, 12);
    assert.equal(changed.byCollection["sales_intelligence_audit_events.find"], steady1.byCollection["sales_intelligence_audit_events.find"]! + 1, "one cause $in for 12 changed rows");
    assert.equal(changed.byCollection["outreach_band_transitions.insertMany"], 1, "one bounded insertMany");
    assert.equal(changed.byCollection["call_interactions.find"], steady1.byCollection["call_interactions.find"]! + 1, "one capture_recovery $in when calls moved bands");
    await readCaptureCoverage();
    const steady2 = await countReads(() => publish());
    assert.equal(steady2.result.band_transitions, 0);
    assert.deepEqual(steady2.byCollection, steady1.byCollection, "a steady publish reads the same per collection at 12 and 36 records");
    assert.equal(steady1.byCollection["outreach_band_transitions.find"] ?? 0, 0);
    const detail2 = await countReads(() => readOutreach(String(fCall.record._id)));
    const timeline2 = await countReads(() => readOutreachTimeline(String(fCall.record._id), { limit: 50 }, {}));
    clearParsedAttentionSnapshots();
    const page2 = await countReads(() => readAttention({ view: "all_outreach", limit: 50 }));
    assert.deepEqual(detail2.byCollection, detail1.byCollection, "detail reads are flat");
    assert.equal(detail1.byCollection["outreach_band_transitions.findOne"], 1, "detail: one indexed transition read");
    assert.deepEqual(timeline2.byCollection, timeline1.byCollection, "timeline reads are flat");
    assert.deepEqual(page2.byCollection, page1.byCollection, "GET /attention reads are flat");
    assert.equal(page1.byCollection["outreach_band_transitions.find"] ?? 0, 0, "GET /attention never reads transitions");
    console.log(`# S9 publish reads: steady 6 records → ${steady1.reads}, 30 records → ${steady2.reads}; with 12 changes → ${changed.reads}`, JSON.stringify({ steady: steady2.byCollection, changed: changed.byCollection }));
  });

  await t.test("no paid job ran or was nominated by the automatic paths", async () => {
    assert.equal(await paidJobs(), 0);
    assert.equal(await automaticRefresh(), 0);
  });
});
