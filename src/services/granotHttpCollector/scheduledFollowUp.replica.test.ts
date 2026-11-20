/**
 * Scheduled Estimates follow-up work for already-current Leads (November 20 review, `5137f06f` regressions):
 * the Form -> Call sibling catch-up, the Record Link, the Record Link dispute, and bounded post-commit steps.
 * Opt-in: GRANOT_LIFECYCLE_REPLICA_TESTS=true with TEST_MODE=true against a loopback replica.
 * Phone numbers are reserved fictional 555-01xx values.
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import mongoose from "mongoose";
import { GRANOT_LIFECYCLE_FLAG_DEFAULTS } from "../../config/domain/granotLifecycle";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { connectMongo } from "../../db";
import { getCallLeadModel } from "../../models/CallLead";
import { getEntityChangeModel } from "../../models/EntityChange";
import { getFormLeadModel } from "../../models/FormLead";
import { GranotAutomationRun } from "../../models/GranotAutomationRun";
import { getGranotCrmSourceModel } from "../../models/GranotCrmSource";
import { getGranotLifecycleActivationModel } from "../../models/GranotLifecycleActivation";
import { getGranotRecordLinkModel } from "../../models/GranotRecordLink";
import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../models/LeadSourceGranularity";
import { getSynchronizationDecisionModel } from "../../models/SynchronizationDecision";
import { computeChecksum } from "../durableWork";
import type { DurableActor } from "../durableWork/types";
import { reviewScheduledRun } from "../granotHistory/scheduledRunArchive";
import {
  BEST_RELOCATION_ADMISSION_CALL_FEED_ID,
  BEST_RELOCATION_ADMISSION_COMPANY_ID,
} from "../leads/callLeadAdmission";
import { LEGACY_BEST_RELOCATION_CALL_IDS } from "../leads/legacyBestRelocationCalls";
import { getCallLeadReportingDecision } from "../leads/callLeadReportingDisposition";
import type { EstimatesPlanAction } from "./estimatesIdentityPlanning";
import type { GranotSourceCollection } from "./index";
import { assembleEstimatesPlan, runGranotWorker } from "./runWorkflow";
import { applyScheduledLeadChange } from "./scheduledLeadChange";

const writeFlags = { ...GRANOT_LIFECYCLE_FLAG_DEFAULTS, shadow_mode: false, lead_writes_enabled: true, processing_enabled: true };
const RC = { call_log_id: "fu-call-log", duration_seconds: 180, ingestion_source: "call_log_sync", qualification_reason: "call_log_inbound_target_answered_over_120s" } as const;

async function replicaReady(t: { skip: (reason: string) => void }): Promise<boolean> {
  if (process.env.GRANOT_LIFECYCLE_REPLICA_TESTS !== "true") {
    t.skip("Replica-set proof is opt-in via GRANOT_LIFECYCLE_REPLICA_TESTS=true.");
    return false;
  }
  if (!/^testvantagemovers(?:_[a-z0-9]+)?$/i.test(getMongoDatabaseName())) {
    t.skip("Replica-set proof requires TEST_MODE=true before process start.");
    return false;
  }
  await connectMongo();
  if (!/^testvantagemovers(?:_[a-z0-9]+)?$/i.test(mongoose.connection.db?.databaseName ?? "")) {
    t.skip("Refusing replica-set proof against a non-test database.");
    return false;
  }
  const hello = await mongoose.connection.db?.admin().command({ hello: 1 });
  if (!hello || hello.setName == null) {
    t.skip("Connected Mongo is not a replica set.");
    return false;
  }
  return true;
}

after(async () => {
  await mongoose.disconnect().catch(() => undefined);
});

const oid = () => new mongoose.Types.ObjectId();

async function postActivationCaptureAt(): Promise<Date> {
  const Activation = getGranotLifecycleActivationModel();
  const existing = await Activation.findOne({ key: "granot_lifecycle" }).lean();
  if (existing?.activated_at) return new Date(+new Date(existing.activated_at) + 60 * 60 * 1000);
  const activated_at = new Date("2026-08-17T14:00:00.000Z");
  await Activation.create({ key: "granot_lifecycle", activated_at, reason: "Synthetic follow-up replica activation.",
    processor_version: "follow-up-replica", activated_by: { actor_type: "owner", actor_id: "fu-replica", actor_label: "Follow-up Replica Owner",
      actor_role: "owner", request_id: "fu-replica-activation", origin: "vantage_admin" } }).catch(() => undefined);
  const row = await Activation.findOne({ key: "granot_lifecycle" }).lean().orFail();
  return new Date(+new Date(row.activated_at) + 60 * 60 * 1000);
}

/** One synthetic Lead Source Company with a Form feed and a Call feed, each with its own Granot label. */
async function fixture() {
  const suffix = oid().toHexString();
  const company = oid(), formFeed = oid(), callFeed = oid();
  const formLabel = `FU Form ${suffix}`, callLabel = `FU Call ${suffix}`;
  const digits = String(parseInt(suffix.slice(-6), 16) % 100_000).padStart(5, "0");
  const job = (n: number) => `7${n}${digits}`;
  // Reserved fictional (201) 555-01xx numbers; matching is scoped to this fixture's own Lead Source Company.
  const phone = (n: number) => `201555${String(100 + n).padStart(4, "0")}`;
  await getLeadSourceCompanyModel().create({ _id: company, company_slug: `fu-${suffix}`, name: `FU ${suffix}`, owner_label: `FU ${suffix}`, active: true, created_from: "test" });
  await getLeadSourceGranularityModel().create([
    { _id: formFeed, source_company: company, granularity_key: `fu-form-${suffix}`, channel: "form", owner_label: "FU Form", crm_label: "FU Form", active: true, created_from: "test" },
    { _id: callFeed, source_company: company, granularity_key: `fu-call-${suffix}`, channel: "call", owner_label: "FU Call", crm_label: "FU Call", active: true, created_from: "test" },
  ]);
  const sources = await getGranotCrmSourceModel().create([
    { label: formLabel, model: "FormLead", feed: formFeed, channel: "form" },
    { label: callLabel, model: "CallLead", feed: callFeed, channel: "call" },
  ].map((s) => ({ crm_origin: `fu-${s.channel}-${suffix}`, workspace_slug: `fu-${s.channel}-${suffix}`, granot_label: s.label,
    normalized_granot_label: s.label.toLowerCase(), default_channel: s.channel, enabled: true, lifecycle_enabled: true,
    lifecycle_disposition: "source_scoped_lead", lead_created_policy: "link_only", lead_source_company: company,
    lifecycle_policy_version: "granot-lifecycle-source-policy-v1",
    lifecycle_routes: [{ route_key: `${s.channel}_any`, lead_model: s.model, move_type: "any", source_granularity_id: s.feed }] })) as never[]);
  const forms: mongoose.Types.ObjectId[] = [], calls: mongoose.Types.ObjectId[] = [], jobs: string[] = [];
  const form = async (n: number, extra: Record<string, unknown> = {}) => {
    const id = oid(); forms.push(id); jobs.push(job(n));
    await getFormLeadModel().create({ _id: id, source_company: "synthetic", name: "Follow Up Form", phone_number: phone(n), normalized_phone_number: phone(n),
      pickup_zip: "10001", destination_zip: "10002", pickup_state: "NY", delivery_state: "NY", local: "local", ref_no: `fu-ref-${n}-${suffix}`, lead_source_company: company, source_granularity_id: formFeed,
      ingestion_origin: "wordpress_form", quoted: false, job_no: job(n), normalized_job_no: job(n), granot_priority: "0", domain_revision: 2, ...extra });
    return id;
  };
  const link = async (normalized: string, lead: { model: "FormLead" | "CallLead"; id: mongoose.Types.ObjectId }, feed = formFeed) => {
    await getGranotRecordLinkModel().create({ provider: "granot", normalized_job_no: normalized, job_no_snapshot: normalized, state: "active",
      lead_ref: lead, source_scope: { lead_source_company: company, source_granularity_id: feed }, disputed: false,
      established_by_decision_id: oid(), established_at: new Date(), last_observation_id: oid(), last_observed_at: new Date(), domain_revision: 0 });
    jobs.push(normalized);
  };
  const call = async (n: number, extra: Record<string, unknown> = {}) => {
    const id = (extra._id as mongoose.Types.ObjectId | undefined) ?? oid(); calls.push(id);
    await getCallLeadModel().create({ source_company: "not_provided", lead_source_company: company, source_granularity_id: callFeed,
      name: "Follow Up Caller", phone_number: phone(n), normalized_phone_number: phone(n), ingestion_origin: "ringcentral", quoted: false,
      granot_priority: "8", domain_revision: 3, timestamp: new Date(), ringcentral: { ...RC, call_log_id: `fu-${n}-${suffix}` }, ...extra, _id: id });
    return id;
  };
  const source = (label: string, rows: Array<Record<string, string>>, collectedAt: Date): GranotSourceCollection => ({
    sourceLabel: label, contentHash: "synthetic", sectionSchemas: { bookedJobs: "missing", followUpEstimates: "table" },
    sections: { bookedJobs: [], followUpEstimates: rows.map((values, i) => ({ id: `estimates:${i}`, rowIndex: i, collectedAt: collectedAt.toISOString(),
      values: { source: label, prior: "0", from: "Miami, FL", to: "Tampa, FL", ...values } })) } });
  const cleanup = async () => {
    const db = mongoose.connection.db!;
    const ids = [...forms, ...calls];
    await getFormLeadModel().deleteMany({ _id: { $in: forms } });
    await getCallLeadModel().deleteMany({ _id: { $in: calls } });
    await getGranotCrmSourceModel().deleteMany({ _id: { $in: sources.map((s) => s._id) } });
    await getLeadSourceGranularityModel().deleteMany({ _id: { $in: [formFeed, callFeed] } });
    await getLeadSourceCompanyModel().deleteOne({ _id: company });
    const linkIds = (await db.collection("granot_record_links").find({ normalized_job_no: { $in: jobs } }, { projection: { _id: 1 } }).toArray()).map((row) => String(row._id));
    await db.collection("entity_changes").deleteMany({ "entity.id": { $in: [...ids.map(String), ...linkIds] } });
    await db.collection("granot_record_links").deleteMany({ normalized_job_no: { $in: jobs } });
    await db.collection("synchronization_decisions").deleteMany({ "target.id": { $in: ids.map(String) } });
    await db.collection("granot_observations").deleteMany({ "identity.normalized_job_no": { $in: jobs } });
    await db.collection("domain_command_executions").deleteMany({ "entity_refs.id": { $in: ids.map(String) } });
    await db.collection("sheet_sync_jobs").deleteMany({ entity_id: { $in: ids.map(String) } });
  };
  return { suffix, company, formFeed, callFeed, formLabel, callLabel, job, phone, form, link, call, source, cleanup };
}

function initiatorFor(runId: string): DurableActor {
  return { actor_type: "system", actor_id: "granot-estimates-in-process-cron", actor_label: "Estimates in Process", actor_role: "system", request_id: runId, origin: "vantage_admin" };
}

function actionFor(plan: { actions: EstimatesPlanAction[] }, job: string): EstimatesPlanAction {
  const action = plan.actions.find((entry) => entry.lifecycle_apply?.granot_statement.job_no === job);
  assert.ok(action?.lifecycle_apply, `missing action for ${job}`);
  return action;
}

const callState = async (id: mongoose.Types.ObjectId) => {
  const row = await getCallLeadModel().findById(id).lean().orFail();
  return { row, disposition: getCallLeadReportingDecision(row).disposition, changes: await getEntityChangeModel().countDocuments({ "entity.id": String(id) }) };
};

test("an already-current Form catches up its later qualified Call: Form Fill stays on Duplicate Calls; ineligible Calls are never written; Best Relocation is reached; replay is idempotent", async (t) => {
  if (!(await replicaReady(t))) return;
  const f = await fixture();
  try {
    const capturedAt = await postActivationCaptureAt();
    const runId = oid().toHexString();
    // A: the Form already holds its job and Record Link; its customer's qualified call arrived later and is a Form Fill.
    const formA = await f.form(1);
    await f.link(f.job(1), { model: "FormLead", id: formA });
    const formFill = await f.call(1, { form_fill: true });
    // C: only a 90-day repeat duplicate and an unqualified Call share the Form's phone.
    const formC = await f.form(3);
    await f.link(f.job(3), { model: "FormLead", id: formC });
    const repeat = await f.call(3, { duplicate: true });
    const unqualified = await f.call(3, { ringcentral: null });
    const unmatched = await f.call(3, { created_on_unmatched: true });
    // D: the preserved Best Relocation inventory already holds the Form's job (job basis); its priority is behind.
    const legacyId = new mongoose.Types.ObjectId(LEGACY_BEST_RELOCATION_CALL_IDS[0]!);
    assert.equal(await getCallLeadModel().exists({ _id: legacyId }), null, "test database must not already hold the legacy Call");
    const formD = await f.form(4, { granot_priority: "2" });
    await f.link(f.job(4), { model: "FormLead", id: formD });
    const legacy = await f.call(4, { _id: legacyId, source_company: "best_relocation_leads", ringcentral: null,
      lead_source_company: new mongoose.Types.ObjectId(BEST_RELOCATION_ADMISSION_COMPANY_ID),
      source_granularity_id: new mongoose.Types.ObjectId(BEST_RELOCATION_ADMISSION_CALL_FEED_ID),
      job_no: f.job(4), normalized_job_no: f.job(4), granot_priority: "8" });

    const before = { formFill: await callState(formFill), repeat: await callState(repeat), unqualified: await callState(unqualified), unmatched: await callState(unmatched) };
    assert.equal(before.formFill.disposition, "duplicate_calls");
    assert.equal(before.repeat.disposition, "duplicate_calls");
    assert.equal(before.unqualified.disposition, "excluded");

    const plan = await assembleEstimatesPlan([f.source(f.formLabel, [
      { job_no: f.job(1), ref_no: `fu-ref-1-${f.suffix}` },
      { job_no: f.job(3), ref_no: `fu-ref-3-${f.suffix}` },
      { job_no: f.job(4), ref_no: `fu-ref-4-${f.suffix}`, prior: "2" },
    ], capturedAt)], { runId });
    const a = actionFor(plan, f.job(1)), c = actionFor(plan, f.job(3)), d = actionFor(plan, f.job(4));
    assert.equal(a.desired_state_summary?.outcome, "already_current", JSON.stringify(a.desired_state_summary));
    assert.equal(a.classification, "update");
    assert.deepEqual(a.follow_up, ["form_sibling"]);
    assert.deepEqual(a.desired_state_summary?.changed_paths, []);
    assert.equal(c.classification, "unchanged", "no eligible sibling: no follow-up, no history");
    assert.deepEqual(d.follow_up, ["form_sibling"]);

    const apply = (action: EstimatesPlanAction) => applyScheduledLeadChange({ action_id: action.action_id, lifecycle_apply: action.lifecycle_apply!,
      initiator: initiatorFor(runId), captured_at: capturedAt, request_id: runId }, writeFlags);
    const formBefore = await getFormLeadModel().findById(formA).lean().orFail();
    const first = await apply(a);
    assert.equal(first.outcome, "already_current");
    assert.deepEqual(first.post_commit, { form_sibling: "updated" });
    assert.ok(first.decision_id && first.observation_id);
    const decision = await getSynchronizationDecisionModel().findById(first.decision_id).lean().orFail();
    assert.equal(decision.outcome, "already_current");
    const formAfter = await getFormLeadModel().findById(formA).lean().orFail();
    assert.equal(formAfter.domain_revision, formBefore.domain_revision, "the Form Lead itself is unchanged");
    assert.deepEqual(formAfter.last_accepted_granot_observation, formBefore.last_accepted_granot_observation);

    const mirrored = await callState(formFill);
    assert.equal(mirrored.row.job_no, f.job(1));
    assert.equal(mirrored.row.normalized_job_no, f.job(1));
    assert.equal(mirrored.row.granot_priority, "0");
    assert.equal(String(mirrored.row.granot_form_sibling?.form_lead_id), String(formA));
    assert.equal(mirrored.row.form_fill, true, "form_fill is never changed");
    assert.equal(mirrored.row.duplicate, before.formFill.row.duplicate);
    assert.deepEqual(mirrored.row.ringcentral, before.formFill.row.ringcentral, "qualification is never changed");
    assert.equal(mirrored.disposition, "duplicate_calls", "updated in place on Duplicate Calls; never moved to Calls");
    assert.equal(mirrored.changes, before.formFill.changes + 1);
    assert.equal(await getCallLeadModel().countDocuments({ lead_source_company: f.company }), 4, "no Call Lead is created");

    // Idempotent replay of the same sealed action: same Decision, no second Call change.
    const replay = await apply(a);
    assert.equal(replay.outcome, "already_current");
    assert.equal(replay.decision_id, first.decision_id);
    assert.equal(replay.post_commit?.form_sibling, "already_current");
    assert.equal((await callState(formFill)).changes, mirrored.changes);
    assert.equal(await getSynchronizationDecisionModel().countDocuments({ "target.id": String(formA) }), 1);

    // C applied anyway (a stale plan) still never writes the ineligible Calls and leaves no history.
    const cResult = await apply(c);
    assert.equal(cResult.outcome, "already_current");
    assert.equal(cResult.decision_id, undefined);
    for (const [key, id] of [["repeat", repeat], ["unqualified", unqualified], ["unmatched", unmatched]] as const) {
      const now = await callState(id);
      assert.equal(now.row.normalized_job_no, undefined, `${key} Call gets no job`);
      assert.equal(now.row.granot_form_sibling, undefined);
      assert.equal(now.changes, before[key].changes);
      assert.equal(now.disposition, before[key].disposition);
    }

    const dResult = await apply(d);
    assert.equal(dResult.post_commit?.form_sibling, "updated");
    const legacyAfter = await callState(legacy);
    assert.equal(legacyAfter.row.granot_priority, "2", "the preserved Best Relocation Call is reached");
    assert.equal(String(legacyAfter.row.granot_form_sibling?.form_lead_id), String(formD));
    assert.equal(legacyAfter.row.ringcentral, null);

    // The next run after catch-up plans nothing for these rows.
    const again = await assembleEstimatesPlan([f.source(f.formLabel, [
      { job_no: f.job(1), ref_no: `fu-ref-1-${f.suffix}` }, { job_no: f.job(4), ref_no: `fu-ref-4-${f.suffix}`, prior: "2" },
    ], new Date(+capturedAt + 60_000))], { runId: oid().toHexString() });
    assert.ok(again.actions.every((action) => action.classification === "unchanged"), JSON.stringify(again.actions.map((x) => [x.classification, x.follow_up])));
  } finally {
    await f.cleanup();
  }
});

test("an unlinked current Lead gets its Record Link once; a contested Record Link records its dispute once", async (t) => {
  if (!(await replicaReady(t))) return;
  const f = await fixture();
  try {
    const capturedAt = await postActivationCaptureAt();
    const runId = oid().toHexString();
    const unlinked = await f.form(5);
    const plan = await assembleEstimatesPlan([f.source(f.formLabel, [{ job_no: f.job(5), ref_no: `fu-ref-5-${f.suffix}` }], capturedAt)], { runId });
    const action = actionFor(plan, f.job(5));
    assert.equal(action.desired_state_summary?.outcome, "already_current", JSON.stringify(action.desired_state_summary));
    assert.deepEqual(action.follow_up, ["record_link"]);
    const apply = (entry: EstimatesPlanAction, run = runId, at = capturedAt) => applyScheduledLeadChange({ action_id: entry.action_id,
      lifecycle_apply: entry.lifecycle_apply!, initiator: initiatorFor(run), captured_at: at, request_id: run }, writeFlags);
    const before = await getFormLeadModel().findById(unlinked).lean().orFail();
    const linked = await apply(action);
    assert.equal(linked.outcome, "linked");
    assert.equal(linked.post_commit?.lead_link_wake, "done");
    assert.equal(linked.post_commit?.form_sibling, "no_call_sibling");
    const link = await getGranotRecordLinkModel().findOne({ normalized_job_no: f.job(5), state: "active" }).lean().orFail();
    assert.equal(String(link.lead_ref?.id), String(unlinked));
    const after = await getFormLeadModel().findById(unlinked).lean().orFail();
    assert.equal(after.granot_priority, before.granot_priority);
    assert.equal(after.job_no, before.job_no);
    assert.equal(String(after.last_accepted_granot_observation?.observation_id), linked.observation_id, "temporal winner advances");
    assert.ok(after.last_accepted_granot_observation?.evidence, "the linked observation is certified for Pool admission");
    assert.equal((await apply(action)).decision_id, linked.decision_id, "replay");
    assert.equal(await getGranotRecordLinkModel().countDocuments({ normalized_job_no: f.job(5) }), 1);
    const next = await assembleEstimatesPlan([f.source(f.formLabel, [{ job_no: f.job(5), ref_no: `fu-ref-5-${f.suffix}` }], new Date(+capturedAt + 60_000))], { runId: oid().toHexString() });
    assert.equal(actionFor(next, f.job(5)).classification, "unchanged");

    // Dispute: the Lead command finds the job's exact Record Link naming another Lead. Identity follows that link
    // first, so the seam stands in for the link the Lead command reads inside the transaction.
    const contestedLead = await f.form(6);
    const other = await f.form(7);
    await f.link(f.job(7), { model: "FormLead", id: other });
    const contestedLink = () => getGranotRecordLinkModel().findOne({ normalized_job_no: f.job(7), state: "active" }).lean().orFail();
    const disputeRun = oid().toHexString();
    const disputePlan = await assembleEstimatesPlan([f.source(f.formLabel, [{ job_no: f.job(6), ref_no: `fu-ref-6-${f.suffix}` }], capturedAt)], { runId: disputeRun });
    const dispute = actionFor(disputePlan, f.job(6));
    assert.deepEqual(dispute.follow_up, ["record_link"]);
    const applyContested = (run: string, at: Date) => applyScheduledLeadChange({ action_id: dispute.action_id, initiator: initiatorFor(run), captured_at: at, request_id: run,
      lifecycle_apply: { ...dispute.lifecycle_apply!, operation_id: `${run}:${dispute.action_id}` } }, writeFlags,
      { findActiveLink: async (_job, session) => getGranotRecordLinkModel().findOne({ normalized_job_no: f.job(7), state: "active" }).session(session ?? null).lean() });
    const contested = await applyContested(disputeRun, capturedAt);
    assert.equal(contested.outcome, "conflict");
    assert.ok(contested.decision_id);
    assert.equal(contested.post_commit?.form_sibling, undefined, "no sibling update after a conflict");
    const disputed = await contestedLink();
    assert.equal(disputed.disputed, true, "the dispute is persisted, not discarded");
    assert.equal(disputed.dispute_reason, "record_link_conflict");
    assert.equal(String(disputed.lead_ref?.id), String(other), "the contested link keeps its Lead");
    assert.equal((await getSynchronizationDecisionModel().findById(contested.decision_id).lean().orFail()).outcome, "conflict");
    assert.equal(await getEntityChangeModel().countDocuments({ "entity.id": String(disputed._id), "entity.model": "GranotRecordLink" }), 1);
    assert.equal((await getFormLeadModel().findById(contestedLead).lean().orFail()).last_accepted_granot_observation, undefined, "the Lead is untouched");
    assert.equal((await applyContested(disputeRun, capturedAt)).decision_id, contested.decision_id, "replay");
    const laterRun = oid().toHexString();
    const later = await applyContested(laterRun, new Date(+capturedAt + 60_000));
    assert.equal(later.outcome, "conflict");
    assert.equal(later.decision_id, undefined, "an already-disputed link leaves no hourly history");
  } finally {
    await f.cleanup();
  }
});

test("a sibling update that always fails is recorded and the rest of the scheduled run completes", async (t) => {
  if (!(await replicaReady(t))) return;
  const f = await fixture();
  const runId = oid().toHexString();
  try {
    const capturedAt = await postActivationCaptureAt();
    const failing = await f.form(8);
    await f.link(f.job(8), { model: "FormLead", id: failing });
    const sibling = await f.call(8);
    const unlinked = await f.form(9);
    const hanging = await f.form(10);
    await f.link(f.job(10), { model: "FormLead", id: hanging });
    await f.call(10);
    const plan = await assembleEstimatesPlan([f.source(f.formLabel, [
      { job_no: f.job(8), ref_no: `fu-ref-8-${f.suffix}` },
      { job_no: f.job(9), ref_no: `fu-ref-9-${f.suffix}` },
      { job_no: f.job(10), ref_no: `fu-ref-10-${f.suffix}` },
    ], capturedAt)], { runId });
    const selected = plan.actions.filter((action) => action.classification === "update");
    assert.equal(selected.length, 3, JSON.stringify(plan.actions.map((x) => [x.classification, x.reason, x.follow_up])));
    const sealed = { ...plan, actions: selected };
    const checksum = computeChecksum({ checksum_version: 1, artifact_kind: "ingestion_plan", schema_version: 1, payload: sealed });
    const initiator = initiatorFor(runId);
    await GranotAutomationRun.create({ _id: runId, schema_version: 3, status: "applying", operation: "estimates_in_process", workflow: "apply", initiator,
      collection_summary: { coverage: { complete: true } }, request_snapshot: { auto_apply: true, scheduled_slot_key: runId, scheduled_coverage: { slotKey: runId } },
      expires_at: new Date(Date.now() + 60_000), plan_locked_at: new Date(), plan_snapshot: sealed, plan_checksum: checksum,
      approval: { approved_by: initiator, selected_action_ids: selected.map((action) => action.action_id), plan_checksum: checksum } });
    let mirrorCalls = 0;
    const env = { GRANOT_LIFECYCLE_PROCESSING_ENABLED: "true", GRANOT_LIFECYCLE_LEAD_WRITES_ENABLED: "true", GRANOT_LIFECYCLE_SHADOW_MODE: "false" };
    const saved = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
    try {
      Object.assign(process.env, env);
      const worker = await runGranotWorker({ applyAction: (input) => applyScheduledLeadChange(input, writeFlags, {
        postCommitTimeoutMs: 200,
        mirrorFormSibling: async (formLeadId) => {
          mirrorCalls++;
          if (formLeadId === String(hanging)) return new Promise(() => undefined);
          throw new Error("synthetic persistent sibling failure");
        },
      }) });
      assert.equal(worker.status, "completed");
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
    const run = await GranotAutomationRun.findById(runId).lean().orFail();
    const receipt = (job: string) => run.receipts.find((r: { action_id: string }) => r.action_id === actionFor(plan, job).action_id);
    assert.equal(receipt(f.job(8))?.outcome, "already_current");
    assert.equal(receipt(f.job(8))?.post_commit?.form_sibling, "failed");
    assert.equal(receipt(f.job(9))?.outcome, "linked");
    assert.equal(receipt(f.job(9))?.post_commit?.form_sibling, "failed");
    assert.equal(receipt(f.job(10))?.post_commit?.form_sibling, "timeout");
    assert.ok(run.receipts.every((r: { outreach_refresh_completed?: boolean }) => r.outreach_refresh_completed === true));
    assert.equal(mirrorCalls, 3, "each failure is bounded once; nothing blocks the run until expiry");
    assert.equal(String((await getGranotRecordLinkModel().findOne({ normalized_job_no: f.job(9) }).lean().orFail()).lead_ref?.id), String(unlinked));
    assert.equal((await getCallLeadModel().findById(sibling).lean().orFail()).normalized_job_no, undefined, "the failed mirror wrote nothing");
    const review = await reviewScheduledRun(mongoose.connection.db!, run._id, new Date(+run.expires_at + 1));
    assert.equal(review.status, "ready", "a run with linked and follow-up receipts can still retire");
  } finally {
    await GranotAutomationRun.deleteOne({ _id: runId });
    await f.cleanup();
  }
});
