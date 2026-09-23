/**
 * Independent verifier probes (LP-VERIFY). Throwaway: adversarial scenarios against the
 * LP-01/03 implementation on an isolated csi01 replica database. Every probe records the
 * ACTUAL behaviour in a JSON line so the report can quote it; assertions state the spec.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { applyCsiMigration } from "../migrations/sales-intelligence.lib";
import { getFormLeadModel } from "../../src/models/FormLead";
import { getCallLeadModel } from "../../src/models/CallLead";
import { getEntityChangeModel } from "../../src/models/EntityChange";
import { getOutreachRecordModel } from "../../src/models/OutreachRecord";
import { getOutreachFollowupModel } from "../../src/models/OutreachFollowup";
import { getSalesIntelligenceReviewItemModel } from "../../src/models/SalesIntelligenceReviewItem";
import { getSalesIntelligenceJobModel } from "../../src/models/SalesIntelligenceJob";
import { getSalesIntelligenceSyncStateModel } from "../../src/models/SalesIntelligenceSyncState";
import { ensureLead, restoreFromIdentityReview, workerContext } from "../../src/services/salesIntelligence/outreach/ensure";
import { runOutreachEnsureOnce } from "../../src/services/salesIntelligence/outreach/worker";
import { createOwnerFollowup } from "../../src/services/salesIntelligence/followups/commands";
import { readOutreach } from "../../src/services/salesIntelligence/outreach/reads";
import { enqueueCsiJob } from "../../src/services/salesIntelligence/jobs";

const say = (probe: string, actual: unknown) => console.log(JSON.stringify({ probe, actual }));

test("LP-VERIFY probes", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 300000 }, async t => {
  assert.match(getMongoDatabaseName(), /^testvantagemovers_lpverify[a-z0-9]+$/);
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  await applyCsiMigration();
  const at = new Date("2026-09-01T12:00:00Z"), oid = () => new mongoose.Types.ObjectId();
  const Records = getOutreachRecordModel(), Actions = getOutreachFollowupModel(), Changes = getEntityChangeModel(), Reviews = getSalesIntelligenceReviewItemModel();
  let serial = 0; const revisions = new Map<string, number>();
  type Model = "FormLead" | "CallLead";
  async function lead(model: Model, extra: Record<string, unknown> = {}) {
    const _id = oid();
    const doc = { _id, timestamp: at, createdAt: at, updatedAt: at, name: `Synthetic LP-VERIFY ${++serial}`, normalized_phone_number: `120255509${String(serial).padStart(2, "0")}`, quoted: false, domain_revision: 0, ...extra };
    await (model === "FormLead" ? getFormLeadModel() : getCallLeadModel()).collection.insertOne(doc as never);
    return { model, id: String(_id), _id };
  }
  const leadDoc = (ref: { model: Model; _id: mongoose.Types.ObjectId }) => (ref.model === "FormLead" ? getFormLeadModel() : getCallLeadModel()).collection.findOne({ _id: ref._id });
  async function accept(ref: { model: Model; id: string; _id: mongoose.Types.ObjectId }, patch: Record<string, unknown>, options: { source?: "granot" | "vantage"; applied_at?: Date; skipChange?: boolean; command?: string } = {}) {
    const before = await leadDoc(ref);
    const revision = (revisions.get(ref.id) ?? 0) + 1; revisions.set(ref.id, revision);
    await (ref.model === "FormLead" ? getFormLeadModel() : getCallLeadModel()).collection.updateOne({ _id: ref._id }, { $set: { ...patch, domain_revision: revision } });
    if (options.skipChange) return null;
    const changeFields = Object.entries(patch).map(([path, after]) => ({ path, value_mode: "stored", before: before?.[path] ?? null, after }));
    const change = await Changes.collection.insertOne({ entity: { model: ref.model, id: ref.id }, command_execution_id: oid(), command_name: options.command ?? (options.source === "vantage" ? "updateSourceOwnedLead" : "synchronizeLeadFromGranot"),
      provenance: { source_system: options.source ?? "granot", actor: { actor_type: "system", actor_id: "verify" }, initiator: { actor_type: "system", actor_id: "verify" }, request_id: String(oid()), ...(options.source === "vantage" ? {} : { observation_id: oid(), decision_id: oid() }) },
      changed_paths: Object.keys(patch).sort(), fields: changeFields, revision_before: revision - 1, revision_after: revision, applied_at: options.applied_at ?? new Date() } as never);
    return String(change.insertedId);
  }
  const ensure = (ref: { model: Model; id: string }, changeId: string | null = null) => withTransaction(s => ensureLead(ref, workerContext(s, String(oid())), undefined, { changeId }));
  const record = (ref: { model: Model; _id: mongoose.Types.ObjectId }) => Records.findOne({ "subject.model": ref.model, "subject.id": ref._id }).orFail();
  const followup = (ref: { model: Model; _id: mongoose.Types.ObjectId }) => withTransaction(async s => { const r = await Records.findById((await record(ref))._id).session(s).orFail(); await createOwnerFollowup(r, { kind: "call", description: "Promised callback", due_at: null }, workerContext(s, String(oid()))); });
  const reviews = (ref: { model: Model; id: string }, kind: string) => Reviews.find({ subject_key: `lead:${ref.model}:${ref.id}`, cause_kind: kind }).lean();

  await t.test("P1a: in-order jobs for two rapid changes (1 then 8) — does the stale first job open a spurious disposition review?", async () => {
    const form = await lead("FormLead");
    await ensure(form);
    const c1 = await accept(form, { granot_priority: "1" }, { applied_at: new Date(+at + 1000) });
    const c2 = await accept(form, { granot_priority: "8" }, { applied_at: new Date(+at + 2000) });
    await ensure(form, c1);
    const afterStale = await record(form);
    const reviewAfterStale = await reviews(form, "disposition_review");
    say("P1a.after_job_for_c1", { state: afterStale.state, provenance: afterStale.lead_progress?.provenance, disposition: afterStale.lead_progress?.disposition, disposition_reviews: reviewAfterStale.map(r => r.state) });
    await ensure(form, c2);
    const afterBoth = await record(form);
    say("P1a.after_job_for_c2", { state: afterBoth.state, provenance: afterBoth.lead_progress?.provenance, closure_origin: afterBoth.closure_origin, disposition_reviews: (await reviews(form, "disposition_review")).map(r => r.state) });
    assert.equal(afterBoth.state, "closed");
    assert.equal(reviewAfterStale.length, 0, "SPEC: a stale triggering change must not regress provenance to uncertain (§6: old events do not win current display)");
  });

  await t.test("P1b: out-of-order jobs (8 processed, then the older 1 job) — provenance regression, spurious review, reopen unblocked?", async () => {
    const form = await lead("FormLead");
    await ensure(form);
    const c1 = await accept(form, { granot_priority: "1" }, { applied_at: new Date(+at + 1000) });
    await ensure(form, c1);
    await followup(form);
    const c2 = await accept(form, { granot_priority: "8" }, { applied_at: new Date(+at + 2000) });
    await ensure(form, c2);
    const closed = await record(form);
    assert.equal(closed.state, "closed"); assert.equal(closed.lead_progress?.provenance, "accepted");
    assert.equal(await Actions.countDocuments({ outreach_record_id: closed._id, status: "cancelled" }), 1);
    // The older job (retry, reorder, or overlap re-scan of an already-consumed change on a delayed worker) runs last.
    await ensure(form, c1);
    const regressed = await record(form);
    const read = await readOutreach(String(regressed._id));
    const reopen = read?.data.outreach.allowed_actions.find(a => a.action === "reopen");
    say("P1b.after_stale_job", { state: regressed.state, closure_origin: regressed.closure_origin, provenance: regressed.lead_progress?.provenance, source_change_id: String(regressed.lead_progress?.source_change_id), stale_change: c1, current_change: c2,
      disposition_reviews: (await reviews(form, "disposition_review")).map(r => r.state), reopen_enabled: reopen?.enabled, reopen_blockers: reopen?.blocker_codes, override_enabled: read?.data.outreach.allowed_actions.find(a => a.action === "override_disposition")?.enabled, revision_before: closed.revision, revision_after: regressed.revision });
    assert.equal(regressed.lead_progress?.provenance, "accepted", "SPEC §6: a late job cannot regress newer facts");
    assert.equal(String(regressed.lead_progress?.source_change_id), c2);
    assert.equal((await reviews(form, "disposition_review")).length, 0, "no spurious disposition review");
  });

  await t.test("P2: a creation change carrying quoted:false vouches for a legacy Priority 8 written without a change — closes and cancels on uncertain provenance", async () => {
    const form = await lead("FormLead");
    // WordPress Form Lead creation change (as production writes it: quoted:false, no granot_priority field).
    await Changes.collection.insertOne({ entity: { model: "FormLead", id: form.id }, command_execution_id: oid(), command_name: "createFormLead", provenance: { source_system: "vantage", actor: { actor_type: "system", actor_id: "verify" }, initiator: { actor_type: "system", actor_id: "verify" }, request_id: String(oid()) },
      changed_paths: ["normalized_phone_number", "quoted"], fields: [{ path: "normalized_phone_number", value_mode: "reference_only" }, { path: "quoted", value_mode: "stored", after: false }], revision_before: 0, revision_after: 1, applied_at: new Date(+at + 1000) } as never);
    await ensure(form);
    await withTransaction(async s => { const r = await Records.findById((await record(form))._id).session(s).orFail(); r.state = "open"; r.first_attributable_outbound_at = new Date(+at + 2000); await r.save({ session: s }); });
    await followup(form);
    // The Priority arrives on a path that writes no EntityChange (legacy / non-emitting writer).
    await accept(form, { granot_priority: "8" }, { skipChange: true });
    await ensure(form);
    const r = await record(form);
    const actions = await Actions.find({ outreach_record_id: r._id }).lean();
    say("P2.after_ensure", { state: r.state, closure_origin: r.closure_origin, provenance: r.lead_progress?.provenance, basis: r.lead_progress?.basis, source_change_command: (await Changes.findById(r.lead_progress?.source_change_id).lean())?.command_name, actions: actions.map(a => `${a.status}/${a.cancel_reason ?? "-"}`), disposition_reviews: (await reviews(form, "disposition_review")).length });
    assert.equal(r.lead_progress?.provenance, "uncertain", "SPEC §6: a Priority value of uncertain origin is displayed but neither establishes work nor cancels actions");
    assert.equal(actions.filter(a => a.status === "cancelled").length, 0, "no cancellation on uncertain provenance");
  });

  await t.test("P2b: same vouching flaw establishes work from a legacy Priority 1 with no change (creation change vouches)", async () => {
    const form = await lead("FormLead");
    await Changes.collection.insertOne({ entity: { model: "FormLead", id: form.id }, command_execution_id: oid(), command_name: "createFormLead", provenance: { source_system: "vantage", actor: { actor_type: "system", actor_id: "verify" }, initiator: { actor_type: "system", actor_id: "verify" }, request_id: String(oid()) },
      changed_paths: ["quoted"], fields: [{ path: "quoted", value_mode: "stored", after: false }], revision_before: 0, revision_after: 1, applied_at: new Date(+at + 1000) } as never);
    await accept(form, { granot_priority: "1" }, { skipChange: true });
    await ensure(form);
    const r = await record(form);
    say("P2b.after_ensure", { state: r.state, provenance: r.lead_progress?.provenance, basis: r.lead_progress?.basis, work_observed: r.lead_progress?.work_observed, first_work_observed_at: r.lead_progress?.first_work_observed_at, source_origin: r.lead_progress?.source_origin });
    assert.equal(r.lead_progress?.provenance, "uncertain", "SPEC §6: valid stored 1/3 needs accepted assignment/change provenance to establish work");
  });

  await t.test("P3: H2 overlap re-scan against a job row enqueued by the pre-change code (input_refs [id] only) — IDEMPOTENCY_CONFLICT stalls the scan", async () => {
    const State = getSalesIntelligenceSyncStateModel(), Jobs = getSalesIntelligenceJobModel();
    const form = await lead("FormLead");
    const now = new Date();
    const consumed = await accept(form, { granot_priority: "1" }, { applied_at: new Date(+now - 30_000) });
    const change = await Changes.findById(consumed).lean();
    // The old scan enqueued this change before the deploy, with the old job identity.
    await withTransaction(s => enqueueCsiJob({ stage: "outreach_ensure", subject_key: `outreach-lead:FormLead:${form.id}`, dedupe_key: `csi:outreach:entity-change:${consumed}`, input_revision: Math.max(1, change!.revision_after), input_refs: [form.id] }, s));
    // Cursor sits just past it (as production's does at 2026-09-21T19:15:46Z with jobs created up to 19:16:36Z).
    await State.updateOne({ scope: "outreach_entity_changes" }, { $set: { "cursor.entity_change_applied_at": new Date(+now - 20_000), "cursor.entity_change_id": oid() } }, { upsert: true });
    // A newer change waits beyond the cursor.
    const newer = await accept(form, { granot_priority: "3" }, { applied_at: new Date(+now - 5_000) });
    let error: unknown = null;
    try { await runOutreachEnsureOnce({ deadline: Date.now() + 30_000 }); } catch (e) { error = e; }
    const cursor = await State.findOne({ scope: "outreach_entity_changes" }).lean();
    const newerKey = { dedupe_key: { $in: [`csi:outreach:entity-change:${newer}`, `csi:outreach:entity-change:v2:${newer}`] } };
    say("P3.scan", { threw: error ? String((error as { code?: string }).code ?? (error as Error).message) : null, cursor_applied_at: cursor?.cursor?.entity_change_applied_at, cursor_advanced: +(cursor?.cursor?.entity_change_applied_at ?? 0) > +now - 20_000, newer_enqueued: Boolean(await Jobs.exists(newerKey)), old_job_input_refs: (await Jobs.findOne({ dedupe_key: `csi:outreach:entity-change:${consumed}` }).lean())?.input_refs, v2_row_for_consumed: Boolean(await Jobs.exists({ dedupe_key: `csi:outreach:entity-change:v2:${consumed}` })) });
    // Run it a second time: does the scan ever advance?
    let error2: unknown = null;
    try { await runOutreachEnsureOnce({ deadline: Date.now() + 30_000 }); } catch (e) { error2 = e; }
    say("P3.scan_again", { threw: error2 ? String((error2 as { code?: string }).code ?? (error2 as Error).message) : null, newer_enqueued: Boolean(await Jobs.exists(newerKey)) });
    assert.equal(error, null, "SPEC H2: a re-enqueue of an already-consumed change is a no-op; the scan must advance");
    assert.ok(await Jobs.exists(newerKey));
  });

  await t.test("P4: progress accepted while the record is in identity review; leaving identity review restores Unworked instead of Open", async () => {
    const form = await lead("FormLead");
    await ensure(form);
    await withTransaction(async s => { const r = await Records.findById((await record(form))._id).session(s).orFail(); r.state_before_identity_review = "unworked"; r.state = "identity_review"; await r.save({ session: s }); });
    const c = await accept(form, { granot_priority: "1" });
    await ensure(form, c);
    const during = await record(form);
    say("P4.during_identity_review", { state: during.state, work_observed: during.lead_progress?.work_observed, basis: during.lead_progress?.basis, provenance: during.lead_progress?.provenance, disposition: during.lead_progress?.disposition });
    await withTransaction(async s => { const r = await Records.findById(during._id).session(s).orFail(); restoreFromIdentityReview(r); await r.save({ session: s }); });
    const restored = await record(form);
    say("P4.after_restore", { state: restored.state, work_observed: restored.lead_progress?.work_observed });
    // Is it self-healing on the next ensureLead without a new change?
    await ensure(form);
    say("P4.after_next_ensure_no_change", { state: (await record(form)).state, work_observed: (await record(form)).lead_progress?.work_observed });
    assert.equal(restored.state, "open", "SPEC §4: on resolution include progress rather than blindly returning to Unworked");
  });

  await t.test("P5: legacy quoted=true with no change history, then an accepted Priority-only change to 0 — basis/time stamped from the unrelated change", async () => {
    const form = await lead("FormLead", { quoted: true });
    const c = await accept(form, { granot_priority: "0" }, { applied_at: new Date(+at + 5_000_000) });
    await ensure(form, c);
    const r = await record(form);
    say("P5.after_ensure", { state: r.state, basis: r.lead_progress?.basis, work_observed: r.lead_progress?.work_observed, first_work_observed_at: r.lead_progress?.first_work_observed_at, last_progress_at: r.lead_progress?.last_progress_at, source_applied_at: r.lead_progress?.source_applied_at, provenance: r.lead_progress?.provenance });
    assert.equal(r.lead_progress?.basis, "historical_snapshot", "SPEC §6: stored quoted=true with unknown time is labelled time unknown; the Priority-only change is not the quote time");
    assert.equal(r.lead_progress?.first_work_observed_at, null, "do not backdate/stamp a work time from an unrelated change");
  });

  await t.test("P6: closed by 8 then Lead deleted/unavailable → command path; and 7→8 keeps closed_at (history)", async () => {
    const form = await lead("FormLead");
    await ensure(form, await accept(form, { granot_priority: "7" }, { applied_at: new Date(+at + 1000) }));
    const first = await record(form);
    await ensure(form, await accept(form, { granot_priority: "8" }, { applied_at: new Date(+at + 2000) }));
    const second = await record(form);
    say("P6.seven_to_eight", { closed_reason: second.closed_reason, closed_at_kept: +second.closed_at! === +first.closed_at!, revision_delta: second.revision - first.revision });
    assert.equal(second.closed_reason, "granot_dead_opportunity");
    assert.equal(+second.closed_at!, +first.closed_at!);
  });

  await db.dropDatabase();
  await mongoose.disconnect();
});
