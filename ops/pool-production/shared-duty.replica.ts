/** Production services against synthetic data on the fixed csi01 loopback replica. No .env/provider traffic. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import mongoose from "mongoose";
import express from "express";
import type { AddressInfo } from "node:net";
import { csiEnqueueReplicaTarget } from "../lib/csi-enqueue-replica-target";

const database = `testvantagemovers_pool20261014${randomUUID().replaceAll("-", "")}`;
for (const key of Object.keys(process.env)) if (/RINGCENTRAL|^RC_|BLOB|GATEWAY|OPENAI|ANTHROPIC|VERCEL|KV_REST|REDIS|UPSTASH|QSTASH|GOOGLE|MONGO|DOTENV/i.test(key)) delete process.env[key];
process.env.DOTENV_CONFIG_PATH = `${__dirname}/.pool-replica-no-dotenv.env`;
process.env.MONGO_URI = csiEnqueueReplicaTarget(process.argv);
process.env.TEST_MODE = "true";
process.env.TEST_MONGO_DATABASE_NAME = database;
process.env.SHEET_SYNC_MODE = "disabled";
process.env.LEAD_MESSAGING_MODE = "disabled";
process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID = "pool-replica";
mongoose.set("autoIndex", false); mongoose.set("autoCreate", false);

async function main() {
  const { connectMongo, withTransaction } = await import("../../src/db.js");
  const models = await import("../../src/models/salesOutreach/index.js");
  const { getCallInteractionModel } = await import("../../src/models/CallInteraction.js");
  const { getContactNumberModel } = await import("../../src/models/ContactNumber.js");
  const { getRepIdentityLinkModel } = await import("../../src/models/RepIdentityLink.js");
  const { getSalesIntelligenceJobModel } = await import("../../src/models/SalesIntelligenceJob.js");
  const { getSalesIntelligenceSyncStateModel } = await import("../../src/models/SalesIntelligenceSyncState.js");
  const { getSalesIntelligenceContactRestrictionModel } = await import("../../src/models/SalesIntelligenceContactRestriction.js");
  const { getFormLeadModel } = await import("../../src/models/FormLead.js");
  const { getCallLeadModel } = await import("../../src/models/CallLead.js");
  const { Agent } = await import("../../src/models/Agent.js");
  const { activeInspection } = await import("../../src/services/salesOutreach/reads/testing.js");
  const { applyContactSources } = await import("../../src/services/salesOutreach/contacts/apply.js");
  const { mongoContactEventStore } = await import("../../src/services/salesOutreach/contacts/mongoStore.js");
  const { contactEventId } = await import("../../src/services/salesOutreach/contacts/derive.js");
  const { recomputePoolDuty } = await import("../../src/services/salesOutreach/pool/duties.js");
  const { inspectPoolCandidate } = await import("../../src/services/salesOutreach/pool/admission.js");
  const { poolDutyWindow, poolDay } = await import("../../src/services/salesOutreach/pool/policy.js");
  const { FINAL01_CADENCE, final01Evidence } = await import("../lib/sales-outreach-final01.js");
  await connectMongo();
  assert.equal(mongoose.connection.name, database);
  assert.equal(mongoose.connection.host, "127.0.0.1");
  assert.equal(mongoose.connection.port, 27189);
  const db = mongoose.connection.db!;
  const hello = await db.admin().command({ hello: 1 });
  assert.equal(hello.setName, "csi01");
  assert.ok(hello.hosts.every((host: string) => host === "127.0.0.1:27189"));
  for (const Model of [...models.SALES_OUTREACH_MODEL_REGISTRY.map(r => r.model()), getCallInteractionModel(), getContactNumberModel(), getRepIdentityLinkModel(),
    getSalesIntelligenceJobModel(), getSalesIntelligenceSyncStateModel(), getSalesIntelligenceContactRestrictionModel(), getFormLeadModel(), getCallLeadModel(), Agent] as unknown as Array<mongoose.Model<unknown>>) {
    assert.equal(Model.db.name, database, `refuse model ${Model.modelName} targeting another database`);
    await Model.createCollection(); await Model.createIndexes();
  }
  const oid = () => new mongoose.Types.ObjectId();
  const callerA = oid(), callerB = oid(), assigned = callerB, lead = oid(), subject = oid(), number = oid(), observation = oid();
  const now = new Date("2026-10-14T20:00:00Z"), activation = new Date("2026-10-14T12:00:00Z"), account = "pool-replica-account";
  const config = activeInspection({ controls: { desk_enabled: true, cadence_shadow_enabled: true },
    pool: { enabled: true, admission_enabled: false, policy_version: "pool-approved-2026-10-14", approval_ref: "replica" },
    cadence: FINAL01_CADENCE, evidence: final01Evidence("replica"),
    goals: { roster_version: "replica", default_scheduled_goal: 100, zero_goal_rule: "no_goal_today_excluded_from_denominator",
      rep_work_schedules: [callerA, callerB].map(agent => ({ agent_id: String(agent), working_days: [1, 2, 3, 4, 5, 6, 7] })), effective_day_overrides: [] },
  });
  assert.equal(config.state, "active"); if (config.state !== "active") throw new Error("fixture configuration unavailable");
  for (const [agent, extension] of [[callerA, "101"], [callerB, "102"]] as const) {
    await Agent.collection.insertOne({ _id: agent, name: `Synthetic ${extension}`, normalized_name: `synthetic ${extension}`, active: true, outreach_desk: "on" });
    await getRepIdentityLinkModel().create({ agent_id: agent, agent_name_snapshot: `Synthetic ${extension}`, rc_account_id: account, rc_extension_id: extension,
      role_kind: "sales_rep", status: "reviewed", effective_from: new Date("2026-01-01T00:00:00Z"), reviewed_at: new Date("2026-01-01T00:00:00Z"), reviewed_by: "fixture-owner" });
  }
  await getFormLeadModel().collection.insertOne({ _id: lead, name: "Synthetic Pool Lead", domain_revision: 1, granot_priority: "9", receiver_agent: assigned,
    job_no: "POOLTEST100", normalized_job_no: "POOLTEST100", timestamp: activation, ingestion_origin: "wordpress_form", last_accepted_granot_observation: { observation_id: observation, captured_at: activation } });
  await models.getSalesOutreachSubjectModel().create({ _id: subject, lead_model: "FormLead", lead_id: lead,
    enrollment: { cohort_id: "pool-replica", kind: "pilot", enrolled_at: activation, activation_at: activation, manifest_hash: null },
    status: "active", received_quality: "instant", adapter_version: "v1", assigned_agent_id: assigned, contact_number_ids: [number] });
  await models.getSalesOutreachPolicyPeriodModel().create({ subject_id: subject, transition_key: "pool-replica", policy_version: "pool-test", activation_boundary: activation,
    workflow: "none", priority: "9", start_kind: "activation", started_at: activation, time_basis: "activation_boundary" });
  await getContactNumberModel().create({ _id: number, e164: "+15550109000", digits_reversed: "00090105551", first_observed_at: activation, last_activity_at: activation,
    lead: { model: "FormLead", id: lead, received_at: activation, state: "open", receiver_agent_id: assigned } });
  const Work = models.getSalesOutreachPoolWorkModel(), Duties = models.getSalesOutreachPoolDutyModel(), Events = models.getSalesOutreachContactEventModel();
  await Work.create({ lead_model: "FormLead", lead_id: lead, subject_id: subject, active: true, episodes: [{ started_at: activation, ended_at: null, observation_id: observation }],
    policy_version: "pool-test", approval_ref: "replica", accepted_observation_id: observation, lead_revision_seen: 1, revision: 1 });
  const recompute = (date = "2026-10-14") => withTransaction(session => recomputePoolDuty(String(subject), date, config, new Date(`${date}T20:00:00Z`), session));
  const duty = (date = "2026-10-14") => Duties.findOne({ subject_id: subject, business_date: date }).lean();
  await recompute(); assert.equal((await duty())?.state, "open");
  assert.equal(await Duties.countDocuments({}), 1);
  const call = async (extension: string, time: string, id: string) => {
    const started = new Date(time);
    return getCallInteractionModel().create({ provider_account_id: account, telephony_session_id: id, identity_basis: "telephony_session_id", direction: "Outbound",
      contact_number_id: number, external_endpoint_kind: "external", started_at: started, provider_connected: true, provider_result: "Call connected",
      parties: [{ role: "user", direction: "Outbound", extension_id: extension }], legs: [{ extension_id: extension, direction: "Outbound", start_time: started, result: "Call connected" }],
      call_log_state: "settled", terminal: true, first_observed_at: started, last_observed_at: started });
  };
  const source = (id: unknown) => ({ source_kind: "call" as const, source_id: String(id) });
  const apply = (id: unknown) => withTransaction(session => applyContactSources([source(id)], { now, queueRepDays: true, configuration: config }, mongoContactEventStore, session));
  const a = await call("101", "2026-10-14T14:10:00Z", "call-a"), b = await call("102", "2026-10-14T14:11:00Z", "call-b");
  const race = await Promise.allSettled([apply(a._id), apply(b._id)]);
  for (const [i, result] of race.entries()) if (result.status === "rejected") await apply(i === 0 ? a._id : b._id);
  assert.equal(await Events.countDocuments({}), 2, "distinct actual calls remain separate");
  assert.equal(await Duties.countDocuments({}), 1, "concurrent callers cannot multiply daily quota");
  assert.equal((await duty())?.state, "completed");
  assert.equal(String((await duty())?.completed_by_agent_id), String(callerA), "actual caller A wins, assignment stays B");
  assert.equal(String((await getFormLeadModel().collection.findOne({ _id: lead }))?.receiver_agent), String(assigned));
  assert.equal(await Events.countDocuments({ goal_credit: "confirmed" }), 2, "each real outbound retains one caller credit");
  const beforeReplay = await duty();
  const replay = await Promise.all([apply(a._id), apply(a._id), apply(a._id)]);
  assert.ok(replay.every(r => r.changed === 0)); assert.equal(await Events.countDocuments({}), 2);
  assert.equal((await duty())?.revision, beforeReplay?.revision, "retry-after-commit does not rewrite completion");
  const late = await call("102", "2026-10-14T14:00:00Z", "call-late-earlier"); await apply(late._id);
  assert.equal(String((await duty())?.completed_by_agent_id), String(callerB), "late earlier evidence corrects the stable winner");
  assert.ok((await duty())!.corrections.length >= 1);
  await getCallInteractionModel().updateOne({ _id: late._id }, { $set: { terminal: false }, $inc: { projection_revision: 1 } }); await apply(late._id);
  assert.equal(String((await duty())?.completed_by_agent_id), String(callerA), "provider correction revokes earlier winner");
  assert.equal(await Duties.countDocuments({}), 1, "correction preserves quota identity");
  const correctedStart = new Date("2026-10-14T14:05:00Z");
  const winnerId = String((await duty())?.completion_event_id);
  await getCallInteractionModel().updateOne({ _id: a._id }, { $set: { started_at: correctedStart, "legs.0.start_time": correctedStart }, $inc: { projection_revision: 1 } }); await apply(a._id);
  assert.equal(String((await duty())?.completion_event_id), winnerId);
  assert.equal((await duty())?.completed_at?.toISOString(), correctedStart.toISOString(), "same event timestamp correction changes completion time");
  await recompute("2026-10-15"); assert.equal((await duty("2026-10-15"))?.state, "open");
  assert.equal((await duty("2026-10-14"))?.state, "completed", "new day does not erase previous completion");
  await Work.updateOne({ subject_id: subject }, { $set: { active: false, "episodes.0.ended_at": new Date("2026-10-14T18:00:00Z") }, $inc: { revision: 1 } });
  await Work.updateOne({ subject_id: subject }, { $set: { active: true }, $push: { episodes: { started_at: new Date("2026-10-14T19:00:00Z"), ended_at: null, observation_id: observation } }, $inc: { revision: 1 } });
  await recompute(); assert.equal(await Duties.countDocuments({ business_date: "2026-10-14" }), 1);
  assert.equal((await duty())?.state, "completed", "same-day exit/reentry retains completion");
  await Agent.collection.updateOne({ _id: callerA }, { $set: { outreach_desk: "off" } });
  const offCall = await call("101", "2026-10-15T14:10:00Z", "off-caller"); await apply(offCall._id);
  assert.equal((await duty("2026-10-15"))?.state, "open", "Owner-off caller cannot fulfill shared duty");
  await Agent.collection.updateOne({ _id: callerA }, { $set: { outreach_desk: "on" } });
  await recompute("2026-10-15"); assert.equal((await duty("2026-10-15"))?.state, "open", "later membership change does not rewrite the original event eligibility");
  const inboundAt = new Date("2026-10-15T15:00:00Z");
  const inbound = await getCallInteractionModel().create({ provider_account_id: account, telephony_session_id: "answered-inbound", identity_basis: "telephony_session_id", direction: "Inbound",
    contact_number_id: number, external_endpoint_kind: "external", started_at: new Date(+inboundAt - 30_000), answered_at: inboundAt, provider_connected: true, provider_result: "Answered",
    parties: [{ role: "user", direction: "Inbound", extension_id: "102", connected: true, answered_at: inboundAt }],
    legs: [{ extension_id: "102", direction: "Inbound", start_time: inboundAt, result: "Answered" }], call_log_state: "settled", terminal: true,
    first_observed_at: inboundAt, last_observed_at: inboundAt });
  await apply(inbound._id);
  const inboundEvent = await Events.findById(contactEventId("call", String(inbound._id))).lean();
  assert.equal(inboundEvent?.kind, "inbound_answered"); assert.equal(inboundEvent?.goal_credit, "none"); assert.equal(inboundEvent?.goal_agent_id, null);
  assert.equal((await duty("2026-10-15"))?.state, "completed", "answered inbound fulfills shared duty without outbound goal credit");
  assert.equal(await Events.countDocuments({ subject_workflow: "none", goal_scope_eligible: true }), 0, "Pool does not enter eligible_new_quoted goal scope");
  await getFormLeadModel().collection.updateOne({ _id: lead }, { $set: { receiver_agent: null } });
  await models.getSalesOutreachSubjectModel().updateOne({ _id: subject }, { $set: { assigned_agent_id: null } });
  const unassignedCall = await call("101", "2026-10-14T16:00:00Z", "unassigned-call");
  assert.equal((await apply(unassignedCall._id)).receivers_filled, 0);
  assert.equal((await getFormLeadModel().collection.findOne({ _id: lead }))?.receiver_agent, null, "shared calling does not assign an unassigned Pool Lead");
  await getFormLeadModel().collection.updateOne({ _id: lead }, { $set: { receiver_agent: assigned } });
  await models.getSalesOutreachSubjectModel().updateOne({ _id: subject }, { $set: { assigned_agent_id: assigned } });
  const poolEntry = new Date("2026-10-14T13:00:00Z");
  await models.getSalesOutreachPolicyPeriodModel().updateOne({ subject_id: subject, ended_at: null }, { $set: { workflow: "new", ended_at: poolEntry } });
  await models.getSalesOutreachPolicyPeriodModel().create({ subject_id: subject, transition_key: "ordinary-to-pool", policy_version: "pool-test", activation_boundary: activation,
    workflow: "none", priority: "9", start_kind: "activation", started_at: poolEntry, time_basis: "activation_boundary" });
  await Work.updateOne({ subject_id: subject }, { $set: { "episodes.0.started_at": poolEntry }, $inc: { revision: 1 } });
  const ordinary = await call("101", "2026-10-14T12:40:00Z", "ordinary-before-pool"); await apply(ordinary._id);
  const ordinaryEvent = await Events.findById(contactEventId("call", String(ordinary._id))).lean();
  assert.equal(ordinaryEvent?.subject_workflow, "new"); assert.equal(ordinaryEvent?.goal_scope_eligible, true);
  assert.equal(String((await duty())?.completion_event_id), String(ordinaryEvent?._id), "qualified same-date ordinary call covers Pool entry without relabeling event");
  await models.getSalesOutreachPolicyPeriodModel().deleteOne({ subject_id: subject, workflow: "new" });
  await models.getSalesOutreachSubjectModel().updateOne({ _id: subject }, { $set: { "enrollment.activation_at": poolEntry } });
  const beforeSubject = await call("101", "2026-10-14T12:30:00Z", "same-date-before-first-subject"); await apply(beforeSubject._id);
  const priorEvent = await Events.findById(contactEventId("call", String(beforeSubject._id))).lean();
  assert.equal(priorEvent?.association, "none"); assert.equal(priorEvent?.association_reason, "before_activation"); assert.equal(priorEvent?.verification, "confirmed");
  assert.equal(String((await duty())?.completion_event_id), String(priorEvent?._id), "same-date verified pre-admission contact covers first Pool subject");
  assert.equal(await Events.countDocuments({ source_id: beforeSubject._id }), 1, "transfer never adds another actual event");

  // Disabling closes episodes at its commit boundary. Late evidence can correct old duties,
  // while calls in the disabled interval cannot fulfill a reentry's shared work.
  const { closePoolSharing } = await import("../../src/services/salesOutreach/pool/admission.js");
  await recompute("2026-10-17");
  const disableAt = new Date("2026-10-17T14:00:00Z"), reenableAt = new Date("2026-10-17T16:00:00Z");
  await withTransaction(session => closePoolSharing(disableAt, session));
  assert.equal((await Work.findOne({ subject_id: subject }).lean())?.active, false);
  const disabled = { ...config, value: { ...config.value, pool: { ...config.value.pool!, enabled: false, admission_enabled: false } } };
  const applyDisabled = (id: unknown) => withTransaction(session => applyContactSources([source(id)], { now: disableAt, queueRepDays: true, configuration: disabled }, mongoContactEventStore, session));
  const gapCall = await call("101", "2026-10-17T15:00:00Z", "disabled-gap-call"); await applyDisabled(gapCall._id);
  assert.equal((await duty("2026-10-17"))?.state, "open");
  await getCallInteractionModel().updateOne({ _id: beforeSubject._id }, { $set: { terminal: false }, $inc: { projection_revision: 1 } }); await applyDisabled(beforeSubject._id);
  assert.equal(String((await duty())?.completion_event_id), String(ordinaryEvent?._id), "disabled historical correction revokes only the original winner");
  await withTransaction(session => recomputePoolDuty(String(subject), "2026-10-18", disabled, disableAt, session));
  assert.equal(await duty("2026-10-18"), null, "disabled sharing creates no new future duty");
  await Work.updateOne({ subject_id: subject }, { $set: { active: true }, $push: { episodes: { started_at: reenableAt, ended_at: null, observation_id: observation } }, $inc: { revision: 1 } });
  await recompute("2026-10-17");
  assert.equal((await duty("2026-10-17"))?.state, "open", "delayed gap call does not cover same-day reenable");
  const resumed = await call("102", "2026-10-17T16:05:00Z", "after-reenable-call"); await apply(resumed._id);
  assert.equal((await duty("2026-10-17"))?.state, "completed");
  const episode = (at: string) => [{ started_at: new Date(at), ended_at: null }];
  assert.equal(poolDutyWindow(episode("2026-10-14T23:30:00Z"), "2026-10-14", config.value).required, true, "19:30 entry inclusive");
  assert.equal(poolDutyWindow(episode("2026-10-14T23:30:00.001Z"), "2026-10-14", config.value).required, false, "late entry starts next day");
  assert.equal(poolDay("2026-10-18", config.value).closed, false, "Sunday independent of Rep schedule");
  const closedDay = { ...config.value, cadence: { ...config.value.cadence, holidays: ["2026-10-18"] } };
  assert.equal(poolDutyWindow(episode("2026-10-14T12:00:00Z"), "2026-10-18", closedDay).waived, true);
  assert.equal(new Date(poolDutyWindow(episode("2026-10-14T12:00:00Z"), "2026-11-01", config.value).due).toISOString(), "2026-11-02T01:00:00.000Z", "DST fallback uses New York close");
  assert.equal(poolDutyWindow(episode("2026-10-14T12:00:00Z"), "2026-10-13", config.value).required, false, "admission creates no historical debt");

  // Canonical source/evidence fixtures let the actual router exercise current shared entitlement.
  const company = oid(), feed = oid(), crm = oid(), receipt = oid(), decision = oid(), link = oid();
  await getFormLeadModel().collection.updateOne({ _id: lead }, { $set: { lead_source_company: company, source_granularity_id: feed, normalized_phone_number: "+15550109000" } });
  await db.collection("lead_source_companies").insertOne({ _id: company, active: true });
  await db.collection("lead_source_granularities").insertOne({ _id: feed, source_company: company, active: true, channel: "form", local: "local" });
  await db.collection("granot_crm_sources").insertOne({ _id: crm, enabled: true, lifecycle_enabled: true, lifecycle_disposition: "source_scoped_lead",
    lifecycle_policy_version: "replica-policy", lead_source_company: company, lifecycle_routes: [{ route_key: "form", lead_model: "FormLead", move_type: "any", source_granularity_id: feed }] });
  await db.collection("granot_observations").insertOne({ _id: observation, receipt_id: receipt, normalization_result: "valid", captured_at: activation,
    identity: { normalized_job_no: "POOLTEST100" }, priority: { raw: "9", canonical: "9", valid: true } });
  await db.collection("granot_webhook_receipts").insertOne({ _id: receipt, processing: { state: "completed" } });
  await db.collection("synchronization_decisions").insertOne({ _id: decision, observation_id: observation, attempt: 1, execution_mode: "live", outcome: "applied",
    target: { model: "FormLead", id: String(lead) }, source_scope: { granot_crm_source_id: crm, lead_source_company: company, source_granularity_id: feed, policy_version: "replica-policy" } });
  await db.collection("granot_record_links").insertOne({ _id: link, provider: "granot", state: "active", normalized_job_no: "POOLTEST100", lead_ref: { model: "FormLead", id: lead },
    source_scope: { lead_source_company: company, source_granularity_id: feed }, disputed: false, domain_revision: 1 });
  assert.equal((await inspectPoolCandidate({ model: "FormLead", id: String(lead) })).eligible, true);
  // Legacy Booking storage must outrank missing Lead.booked / Record Link booking mirrors.
  // Raw-driver fixtures preserve string pointers and incomplete anchors that Mongoose would cast.
  const bookingAnchorCases = [
    { name: "string_lead_ref_without_normalized_job", values: { lead_model: "FormLead", lead_ref: String(lead), job_no: "OTHER901" }, blocked: true },
    { name: "missing_lead_model_objectid_pointer", values: { lead_ref: lead, job_no: "OTHER902" }, blocked: true },
    { name: "mismatched_lead_model_string_pointer", values: { lead_model: "CallLead", lead_ref: String(lead), job_no: "OTHER903" }, blocked: true },
    { name: "uppercase_string_pointer_without_model_or_job", values: { lead_ref: String(lead).toUpperCase() }, blocked: true },
    { name: "raw_numeric_job_alias_without_pointer", values: { job_no: "100" }, blocked: true },
    { name: "raw_prefixed_job_alias_partial_dangling_pointer", values: { lead_ref: oid(), job_no: "p100" }, blocked: true },
    { name: "raw_NFKC_job_alias_outranks_conflicting_normalized_key", values: { job_no: " Ｐ１００ ", normalized_job_no: "OTHER904" }, blocked: true },
    { name: "unrelated_booking_ignored", values: { lead_model: "CallLead", lead_ref: oid(), job_no: "OTHER999", normalized_job_no: "OTHER999" }, blocked: false },
  ];
  const leadBeforeBookingReads = await getFormLeadModel().collection.findOne({ _id: lead });
  const sheetJobsBeforeBookingReads = await db.collection("sheet_sync_jobs").countDocuments({});
  for (const scenario of bookingAnchorCases) {
    const bookingId = oid();
    await db.collection("booked_leads").insertOne({ _id: bookingId, ...scenario.values, cancelled: false });
    try {
      const inspected = await inspectPoolCandidate({ model: "FormLead", id: String(lead) });
      assert.equal(inspected.eligible, !scenario.blocked, `${scenario.name}: canonical Pool admission must respect the raw Booking anchor`);
      if (scenario.blocked) assert.equal(inspected.reason, "official_booking", scenario.name);
      assert.deepEqual(await getFormLeadModel().collection.findOne({ _id: lead }), leadBeforeBookingReads, "eligibility inspection never repairs Lead/Sheet fields");
      assert.equal(await db.collection("sheet_sync_jobs").countDocuments({}), sheetJobsBeforeBookingReads, "eligibility inspection never requests Sheet Sync");
    } finally { await db.collection("booked_leads").deleteOne({ _id: bookingId }); }
    assert.equal((await inspectPoolCandidate({ model: "FormLead", id: String(lead) })).eligible, true, "removing only the synthetic anchor restores base eligibility");
  }
  const { evaluateAndProject, evaluationAdmissionOf } = await import("../../src/services/salesOutreach/evaluation/evaluateJob.js");
  const { mongoEvaluationStore } = await import("../../src/services/salesOutreach/evaluation/store.js");
  const admission = evaluationAdmissionOf(config); assert.equal(admission.ok, true); if (!admission.ok) throw new Error("fixture cadence unavailable");
  await withTransaction(session => evaluateAndProject(String(subject), admission.context, now, mongoEvaluationStore, session));
  const { createSalesOutreachRouter } = await import("../../src/routes/sales-outreach.routes.js");
  const { fixedConfigurationLoader } = await import("../../src/services/salesOutreach/reads/testing.js");
  const { computeAdminActorSignature, signAdminActorPayload } = await import("../../src/services/operationsRegistry/trustedActor.js");
  const { buildCanonicalRepActorPayload } = await import("../../src/services/operationsRegistry/trustedActorCanonical.js");
  process.env.VANTAGE_API_SECRET = "synthetic-pool-api";
  process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET = "synthetic-pool-signing";
  const app = express(); app.use(express.json());
  let requestNow = now;
  app.use(createSalesOutreachRouter({ loader: fixedConfigurationLoader(config), now: () => requestNow, live: { clockMs: 150, lifetimeMs: 3_000 } }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`, prefix = "/api/v1/admin/sales-outreach";
  const headers = (role: string, path: string, agent = String(callerA)) => {
    const timestamp = String(Date.now()), requestId = randomUUID(), adminId = `synthetic-${role}`, email = `${role}@example.invalid`;
    const fields = { adminId, email, role, timestamp, requestId, method: "GET", path: path.split("?")[0]! };
    const signature = role === "rep" ? signAdminActorPayload(buildCanonicalRepActorPayload({ ...fields, agentId: agent }), "synthetic-pool-signing") : computeAdminActorSignature(fields, "synthetic-pool-signing");
    return { "x-api-secret": "synthetic-pool-api", "x-vantage-admin-user-id": adminId, "x-vantage-admin-email": email, "x-vantage-admin-role": role,
      "x-vantage-admin-request-id": requestId, "x-vantage-admin-timestamp": timestamp, "x-vantage-admin-signature": signature, ...(role === "rep" ? { "x-vantage-admin-agent-id": agent } : {}) };
  };
  const get = async (role: string, suffix: string, agent?: string) => { const path = `${prefix}${suffix}`;
    const response = await fetch(`${base}${path}`, { headers: headers(role, path, agent) }); return { status: response.status, body: await response.json() as any }; };
  const streamControllers: AbortController[] = [];
  let benchmark: Record<string, unknown> | null = null;
  const smallerBenchmarks: Record<string, unknown>[] = [];
  try {
    const shared = await get("rep", "/queue?queue_scope=pool&state=all_active");
    assert.equal(shared.status, 200, JSON.stringify(shared.body));
    assert.equal(shared.body.data.rows.length, 1, "non-assigned eligible Rep sees shared Pool row");
    assert.equal(shared.body.data.rows[0].pool.state, "completed");
    await models.getSalesOutreachProjectionModel().collection.updateOne({ subject_id: subject }, { $set: { "status_flags.needs_contact": true, "call.remaining": 1, "call.status": "due" } });
    assert.equal((await get("rep", "/queue?queue_scope=pool&state=needs_contact")).body.data.rows.length, 0, "fresh duty completion overrides stale projection before needs_contact filtering");
    requestNow = new Date("2026-10-16T20:00:00Z");
    assert.equal((await get("rep", "/queue?queue_scope=pool&state=needs_contact")).body.data.rows.length, 1, "NY rollover supplies fresh due work before evaluator delivery");
    requestNow = now;
    const privateQueue = await get("rep", "/queue?state=all_active"); assert.equal(privateQueue.status, 200); assert.equal(privateQueue.body.data.rows.length, 0, "ordinary own queue remains private");
    const detailPath = `/outreach/${subject}`;
    assert.equal((await get("rep", detailPath)).status, 200, "shared detail grants only current Pool entitlement");
    assert.equal((await get("owner", "/queue?queue_scope=pool&state=all_active")).status, 200);
    assert.equal((await get("manager", "/queue?queue_scope=pool&state=all_active")).status, 200);
    assert.equal((await get("admin", "/queue?queue_scope=pool&state=all_active")).status, 403);
    assert.equal((await fetch(`${base}${prefix}/queue?queue_scope=pool`, { headers: { "x-api-secret": "synthetic-pool-api" } })).status, 403);
    await Agent.collection.updateOne({ _id: callerA }, { $set: { active: false } });
    assert.equal((await get("rep", "/queue?queue_scope=pool&state=all_active")).status, 403, "inactive signed Rep denied");
    await Agent.collection.updateOne({ _id: callerA }, { $set: { active: true } });
    const openSse = async (agent: string) => {
      const controller = new AbortController(); streamControllers.push(controller);
      const path = `${prefix}/live?version=1`;
      const response = await fetch(`${base}${path}`, { headers: headers("rep", path, agent), signal: controller.signal });
      assert.equal(response.status, 200); const reader = response.body!.getReader(); let buffer = "";
      return { async frame(reason: string) { for (let i = 0; i < 30; i++) { const next = await reader.read(); if (next.done) throw new Error("SSE ended before expected frame");
        buffer += new TextDecoder().decode(next.value); const chunks = buffer.split("\n\n"); buffer = chunks.pop()!;
        for (const chunk of chunks) { const data = chunk.split("\n").find(line => line.startsWith("data:")); if (data) { const frame = JSON.parse(data.slice(5)); if (frame.reason === reason) return frame; } } }
        throw new Error("Expected SSE frame not received"); } };
    };
    const sseA = await openSse(String(callerA)), sseB = await openSse(String(callerB));
    assert.equal((await sseA.frame("connect")).refetch, "all"); assert.equal((await sseB.frame("connect")).refetch, "all");
    const { poolInvalidation } = await import("../../src/services/salesOutreach/pool/admission.js");
    const hints = Promise.all([sseA.frame("change"), sseB.frame("change")]);
    await withTransaction(session => poolInvalidation(session, now));
    for (const frame of await hints) { assert.ok(frame.topics.includes("outreach_pool")); assert.deepEqual(frame.changes.find((c: any) => c.topic === "outreach_pool").agent_ids, []); }
    await getFormLeadModel().collection.updateOne({ _id: lead }, { $set: { granot_priority: "3" } });
    assert.equal((await get("rep", detailPath)).status, 404, "exit immediately revokes non-assigned detail");
    assert.equal((await get("rep", "/queue?queue_scope=pool&state=all_active")).body.data.rows.length, 0, "resnapshot evicts exited row");
    assert.equal((await get("rep", detailPath, String(callerB))).status, 200, "assigned Rep retains ordinary detail");
    await getFormLeadModel().collection.updateOne({ _id: lead }, { $set: { granot_priority: "9" } });
    // Bulk fixture expansion measures actual canonical inspection + queue rendering with 601 shared records.
    const templateSubject = (await models.getSalesOutreachSubjectModel().collection.findOne({ _id: subject }))!;
    const templateProjection = (await models.getSalesOutreachProjectionModel().collection.findOne({ subject_id: subject }))!;
    const bulk = { leads: [] as any[], subjects: [] as any[], works: [] as any[], projections: [] as any[], observations: [] as any[], receipts: [] as any[], decisions: [] as any[], links: [] as any[] };
    for (let i = 0; i < 600; i++) {
      const leadId = oid(), subjectId = oid(), obsId = oid(), receiptId = oid(), job = `POOLBENCH${10000 + i}`;
      bulk.leads.push({ _id: leadId, name: "Synthetic benchmark", domain_revision: 1, granot_priority: "9", receiver_agent: assigned, job_no: job, normalized_job_no: job,
        lead_source_company: company, source_granularity_id: feed, normalized_phone_number: "+15550109000", timestamp: activation, ingestion_origin: "wordpress_form", last_accepted_granot_observation: { observation_id: obsId, captured_at: activation } });
      bulk.subjects.push({ ...templateSubject, _id: subjectId, lead_id: leadId, contact_number_ids: [], display: { ...templateSubject.display, job_no: job, normalized_job_no: job } });
      bulk.works.push({ _id: oid(), lead_model: "FormLead", lead_id: leadId, subject_id: subjectId, active: true, episodes: [{ started_at: activation, ended_at: null, observation_id: obsId }],
        policy_version: "pool-test", approval_ref: "replica", accepted_observation_id: obsId, lead_revision_seen: 1, revision: 1 });
      bulk.projections.push({ ...templateProjection, _id: oid(), subject_id: subjectId, display: { ...templateProjection.display, job_no: job, normalized_job_no: job } });
      bulk.observations.push({ _id: obsId, receipt_id: receiptId, normalization_result: "valid", captured_at: activation, identity: { normalized_job_no: job }, priority: { canonical: "9", valid: true } });
      bulk.receipts.push({ _id: receiptId, processing: { state: "completed" } });
      bulk.decisions.push({ _id: oid(), observation_id: obsId, attempt: 1, execution_mode: "live", outcome: "applied", target: { model: "FormLead", id: String(leadId) },
        source_scope: { granot_crm_source_id: crm, lead_source_company: company, source_granularity_id: feed, policy_version: "replica-policy" } });
      bulk.links.push({ _id: oid(), provider: "granot", state: "active", normalized_job_no: job, lead_ref: { model: "FormLead", id: leadId }, source_scope: { lead_source_company: company, source_granularity_id: feed }, disputed: false, domain_revision: 1 });
    }
    for (const [collection, rows] of [["form_leads", bulk.leads], ["sales_outreach_subjects", bulk.subjects], ["sales_outreach_pool_work", bulk.works], ["sales_outreach_projections", bulk.projections],
      ["granot_observations", bulk.observations], ["granot_webhook_receipts", bulk.receipts], ["synchronization_decisions", bulk.decisions], ["granot_record_links", bulk.links]] as const) await db.collection(collection).insertMany(rows);
    await db.collection("booked_leads").insertMany(Array.from({ length: 911 }, (_, i) => ({ _id: oid(), job_no: `unrelatedlegacy${90000 + i}`,
      ...(i % 2 ? { normalized_job_no: `UNRELATEDLEGACY${90000 + i}`, lead_ref: oid(), lead_model: "CallLead" } : { lead_ref: String(oid()) }), cancelled: false })));
    let queryCount = 0; mongoose.set("debug", () => { queryCount++; });
    const benchmarkStarted = performance.now();
    const benchmarkQueue = await get("rep", "/queue?queue_scope=pool&state=all_active&limit=50");
    const elapsedMs = performance.now() - benchmarkStarted; mongoose.set("debug", false);
    assert.equal(benchmarkQueue.status, 200, JSON.stringify(benchmarkQueue.body)); assert.equal(benchmarkQueue.body.data.rows.length, 50);
    assert.equal(benchmarkQueue.body.data.pool_summary.team_due, 600); assert.equal(benchmarkQueue.body.data.pool_summary.team_completed, 1);
    assert.ok(queryCount < 100, `600-record authorization/summary must batch reads, observed ${queryCount}`);
    const searched = await get("rep", "/queue?queue_scope=pool&state=all_active&search=POOLBENCH10000");
    assert.equal(searched.status, 200); assert.equal(searched.body.data.rows.length, 1);
    assert.equal(searched.body.data.counts.projection_pending, 0, "search does not turn filtered-out shared rows into pending projections");
    benchmark = { shared_records: 601, rendered_rows: 50, unrelated_raw_bookings: 911, mongoose_queries: queryCount, elapsed_ms: Math.round(elapsedMs), environment: "local_loopback_replica_synthetic_data", limit: "Not an Atlas latency guarantee; raw-driver Booking lookup is additional to Mongoose debug count" };
    const originalWork = (await Work.findOne({ subject_id: subject }).lean())!;
    for (const size of [100, 20]) {
      await Work.collection.updateMany({}, { $set: { active: false } });
      await Work.collection.updateMany({ _id: { $in: [originalWork._id, ...bulk.works.slice(0, size - 1).map(w => w._id)] } }, { $set: { active: true } });
      let smallQueries = 0; mongoose.set("debug", () => { smallQueries++; });
      const smallStart = performance.now(), small = await get("rep", "/queue?queue_scope=pool&state=all_active&limit=50");
      const smallElapsed = performance.now() - smallStart; mongoose.set("debug", false);
      assert.equal(small.status, 200); assert.equal(small.body.data.rows.length, Math.min(size, 50));
      assert.equal(small.body.data.pool_summary.team_due, size - 1); assert.ok(smallQueries < 100);
      smallerBenchmarks.push({ shared_records: size, rendered_rows: small.body.data.rows.length, mongoose_queries: smallQueries, elapsed_ms: Math.round(smallElapsed) });
    }
  } finally { for (const controller of streamControllers) controller.abort(); await new Promise<void>(resolve => server.close(() => resolve())); }
  await models.getSalesOutreachSubjectModel().updateOne({ _id: subject }, { $set: { status: "closed" } });
  assert.equal((await inspectPoolCandidate({ model: "FormLead", id: String(lead) })).reason, "closed_subject_reopening_required");
  const summary = { captured_at: new Date().toISOString(), target: "fixed_loopback_csi01_unique_test_database", production_writes: 0, provider_requests: 0, customer_contact: false,
    benchmark, smaller_benchmarks: smallerBenchmarks,
    legacy_booking_anchor_cases: bookingAnchorCases.map(scenario => ({ name: scenario.name, expected_hold: scenario.blocked, lead_and_sheet_unchanged: true })),
    passed: ["strict_models_and_unique_indexes", "concurrent_distinct_calls_one_duty", "distinct_caller_credit_preserved", "assigned_receiver_preserved", "same_event_three_worker_replay", "retry_after_commit_no_completion_rewrite", "late_earlier_winner_correction", "provider_revocation_recounts_original_date", "same_event_timestamp_correction", "Owner_off_caller_denied_and_snapshot_preserved", "answered_inbound_zero_outbound_credit", "Pool_excluded_eligible_new_quoted", "unassigned_Pool_call_does_not_assign", "ordinary_same_date_coverage_transfer_preserves_original_event", "first_subject_same_date_pre_activation_transfer", "disable_closes_episodes", "disabled_historical_correction_remains_active", "disabled_no_new_duties", "same_date_reenable_rejects_delayed_gap_call", "next_date_fresh_no_catchup", "same_date_reentry_retains_completion", "19_30_cutoff", "Sunday", "Owner_closed_day", "NY_DST_fallback", "no_retroactive_debt", "closed_subject_refused", "actual_router_shared_and_private_scopes", "actual_router_owner_manager_rep_admin_unsigned_inactive_matrix", "actual_router_detail_revocation_and_assigned_retention", "actual_Mongo_SSE_shared_hint_two_readers", "SSE_connect_resnapshot", "completion_before_evaluator_filters_fresh_state", "NY_rollover_before_evaluator_filters_fresh_state", "search_does_not_inflate_projection_pending", "601_record_actual_queue_batched_read_benchmark"],
    limits: ["Synthetic provider source rows; no external RingCentral delivery", "Browser cache eviction requires separate acceptance", "Provider capture merge/dedupe remains covered by retained capture tests"] };
  Object.assign(summary, { total_passed_scenarios: summary.passed.length + summary.legacy_booking_anchor_cases.length });
  writeFileSync("docs/rep-desk-and-pool/evidence/release/shared-duty-replica.json", JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  await db.dropDatabase();
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (mongoose.connection.name === database && mongoose.connection.db) await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
});
