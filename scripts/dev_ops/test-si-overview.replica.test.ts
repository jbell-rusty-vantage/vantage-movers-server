import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { applyCsiMigration } from "../migrations/sales-intelligence.lib";
import { getFormLeadModel } from "../../src/models/FormLead";
import { getCallLeadModel } from "../../src/models/CallLead";
import { getOutreachRecordModel } from "../../src/models/OutreachRecord";
import { getOutreachFollowupModel } from "../../src/models/OutreachFollowup";
import { getCallInteractionModel } from "../../src/models/CallInteraction";
import { getRepIdentityLinkModel } from "../../src/models/RepIdentityLink";
import { getSalesIntelligenceAuditEventModel } from "../../src/models/SalesIntelligenceAuditEvent";
import { getOutreachRepDayModel } from "../../src/models/salesIntelligence/overview";
import { ensureLead, workerContext } from "../../src/services/salesIntelligence/outreach/ensure";
import { publishAttentionSnapshot, readAttention, clearParsedAttentionSnapshots } from "../../src/services/salesIntelligence/outreach/attention";
import { csiOperatorActor } from "../../src/services/salesIntelligence/auth";
import { readOverview, clearOverviewCache } from "../../src/services/salesIntelligence/overview/read";
import { clearOverviewIndexCache } from "../../src/services/salesIntelligence/overview/now";
import { rebuildRepDay, runOverviewRefreshOnce, UNMAPPED_REP } from "../../src/services/salesIntelligence/overview/repDays";
import { commandRebuildOverviewDay } from "../../src/services/salesIntelligence/overview/commands";
import { resolveOverviewPeriod } from "../../src/services/salesIntelligence/overview/periods";
import { easternDayKey, easternInstantBounds, previousEasternDayKey } from "../../src/services/dailyOperations/dayDocument";
import { toFloridaTimestamp } from "../../src/utils/easternTime";
import { getAdminModels } from "../../src/services/admin/adminScope.service";
import { getLeadCost } from "../../src/services/analytics/leadCost.service";

/**
 * S9-READS (assignment addendum §6–§7; reconciliation §4.3–§4.4). C8: the Overview "now" band counts equal
 * the Needs Attention counts at the same `as_of` (also under a Priority preset and a rep scope). C9: two
 * rebuilds of a day are byte-identical and unreviewed extensions land in `unmapped`. C10: the spend total is
 * Σ `cpl` over the lead-spend report's Leads minus duplicates and `no_sync`, with legacy and unpriced labelled.
 * C11: a scoped read shows only that rep and the team medians. Reads are bounded and p95 < 500 ms for Last 30 days.
 */
const READ_METHODS = new Set(["find", "findOne", "aggregate", "distinct", "countDocuments", "estimatedDocumentCount", "count"]);
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
const ACCOUNT = "t3c-account";

test("S9-READS disposable replica", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 900_000 }, async (t) => {
  assert.equal(getMongoDatabaseName(), "testvantagemovers_t3coverview");
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  assert.equal(process.env.SALES_INTELLIGENCE_OVERVIEW, "true");
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  await db.dropDatabase();
  await applyCsiMigration();
  try {
  const oid = () => new mongoose.Types.ObjectId();
  const Records = getOutreachRecordModel(), Followups = getOutreachFollowupModel(), Calls = getCallInteractionModel();
  const now = new Date();
  const today = easternDayKey(now), yesterday = previousEasternDayKey(today);
  const agentA = oid(), agentB = oid();
  await db.collection("agents").insertMany([{ _id: agentA, name: "Synthetic Rep A", active: true }, { _id: agentB, name: "Synthetic Rep B", active: true }]);
  const linkRow = (ext: string, agent: mongoose.Types.ObjectId, name: string) => ({ _id: oid(), revision: 1, agent_id: agent, agent_name_snapshot: name, rc_account_id: ACCOUNT,
    rc_extension_id: ext, role_kind: "sales_rep", status: "reviewed", effective_from: new Date(now.getTime() - 400 * DAY), effective_to: null, reviewed_at: new Date(now.getTime() - 400 * DAY),
    reviewed_by: "owner", history: [], rc_direct_numbers: [], nudge_channels_allowed: [], createdAt: now, updatedAt: now });
  await getRepIdentityLinkModel().collection.insertMany([linkRow("201", agentA, "Synthetic Rep A"), linkRow("202", agentB, "Synthetic Rep B")]);

  let serial = 0;
  const callDoc = (o: { ext: string; direction?: string; at: Date; connected?: boolean; human?: boolean; duration?: number; terminal?: boolean; recovered?: boolean; monitoring?: boolean }) => {
    const direction = o.direction ?? "Outbound";
    return { _id: oid(), provider: "ringcentral", provider_account_id: ACCOUNT, telephony_session_id: `t3co-${++serial}`, session_id: null, call_log_ids: [], identity_basis: "telephony_session_id",
      direction, contact_number_id: null, external_e164: "+15550990000", company_e164: null, started_at: o.at, answered_at: null, ended_at: null, duration_seconds: o.duration ?? 60,
      provider_result: null, provider_connected: Boolean(o.connected), contact_type: o.human ? "human_conversation" : "unknown", contact_type_basis: null,
      parties: [{ role: "external", connected: true, direction: null }, { role: "user", extension_id: o.ext, connected: Boolean(o.connected), direction: direction === "Inbound" ? "Inbound" : "Outbound" }],
      legs: [], legs_overflow_count: 0, connected_user_extension_ids: [], queue_fanout: false, transfer: false, monitoring: Boolean(o.monitoring), recordings: [], sources: ["call_log_reconcile"],
      call_log_state: "settled", terminal: o.terminal ?? true, projection_revision: 1, first_observed_at: o.at, last_observed_at: o.at, merged_into_id: null, purged_at: null,
      ...(o.recovered ? { capture_recovery: { run_id: "t3c-repair", at: now, kind: "added" } } : {}), createdAt: now, updatedAt: now };
  };
  const yStart = easternInstantBounds(yesterday).start;
  const tStart = easternInstantBounds(today).start;
  const yAt = (minutes: number) => new Date(+yStart + 10 * HOUR + minutes * MIN);
  const tAt = (seconds: number) => new Date(+tStart + (+now - +tStart) / 2 + seconds * 1000);
  await Calls.collection.insertMany([
    callDoc({ ext: "201", at: yAt(0) }), callDoc({ ext: "201", at: yAt(5) }), callDoc({ ext: "201", at: yAt(10), connected: true, human: true, duration: 300 }),
    callDoc({ ext: "201", direction: "Inbound", at: yAt(15), connected: true, human: true, duration: 120 }),
    callDoc({ ext: "202", at: yAt(20) }), callDoc({ ext: "202", at: yAt(25) }),
    // Recovered by a capture repair today; counts on yesterday, its real day.
    callDoc({ ext: "202", direction: "Inbound", at: yAt(30), connected: true, human: true, duration: 200, recovered: true }),
    callDoc({ ext: "299", direction: "Inbound", at: yAt(35), connected: true }),
    // Excluded: in progress, Internal, a monitoring leg.
    callDoc({ ext: "201", at: yAt(40), terminal: false }), callDoc({ ext: "201", direction: "Internal", at: yAt(45) }), callDoc({ ext: "201", at: yAt(50), monitoring: true }),
    callDoc({ ext: "201", at: tAt(0) }), callDoc({ ext: "201", at: tAt(1) }), callDoc({ ext: "202", at: tAt(2) }),
  ]);

  // Leads (spend + records). Lead `timestamp` is ET wall clock (toFloridaTimestamp).
  const leadTime = toFloridaTimestamp(new Date(+now - 2 * HOUR));
  const period = oid();
  type LeadSpec = { model?: "FormLead" | "CallLead"; agent?: mongoose.Types.ObjectId | null; cpl: number; status?: string | null; rate?: boolean; source: string;
    code?: string | null; quoted?: boolean; duplicate?: boolean; no_sync?: boolean };
  async function lead(spec: LeadSpec) {
    const n = ++serial;
    const row = { _id: oid(), timestamp: leadTime, createdAt: now, updatedAt: now, name: `Synthetic Overview ${n}`, job_no: `T3CO-${n}`, phone_number: `555070${String(n).padStart(4, "0")}`,
      source_granularity_label_snapshot: spec.source, source_company: "Synthetic", cpl: spec.cpl, ...(spec.rate ? { cpl_rate_period: period } : {}),
      ...(spec.status ? { cpl_resolution_status: spec.status } : {}), receiver_agent: spec.agent ?? null, granot_priority: spec.code ?? null, quoted: Boolean(spec.quoted),
      duplicate: Boolean(spec.duplicate), no_sync: Boolean(spec.no_sync), created_on_unmatched: false };
    await (spec.model === "CallLead" ? getCallLeadModel() : getFormLeadModel()).collection.insertOne(row);
    return row;
  }
  const L1 = await lead({ agent: agentA, cpl: 40, status: "resolved", rate: true, source: "TBM Form", code: "0" });
  const L2 = await lead({ agent: agentA, cpl: 40, status: "resolved", rate: true, source: "TBM Form", code: null });
  const L3 = await lead({ agent: agentA, cpl: 35, source: "Legacy Web", code: "1", quoted: true });
  const L4 = await lead({ model: "CallLead", agent: agentB, cpl: 0, status: "missing_rate", source: "Top10 Call" });
  const L5 = await lead({ agent: agentB, cpl: 40, status: "resolved", rate: true, source: "TBM Form", code: "5", quoted: true });
  const L6 = await lead({ agent: null, cpl: 40, status: "resolved", rate: true, source: "TBM Form", code: "0" });
  await lead({ agent: agentA, cpl: 40, status: "resolved", rate: true, source: "TBM Form", duplicate: true });
  await lead({ agent: agentA, cpl: 40, status: "resolved", rate: true, source: "TBM Form", no_sync: true });
  await lead({ model: "CallLead", agent: agentB, cpl: 40, status: "resolved", rate: true, source: "Top10 Call", duplicate: true });
  await lead({ agent: agentA, cpl: 0, status: "duplicate_zero", rate: true, source: "TBM Form" });
  await db.collection("booked_leads").insertOne({ _id: oid(), lead_model: "FormLead", lead_ref: L2._id, agent: agentA, book_date: now, job_no: L2.job_no, total_binder_amount: 900 });

  // Outreach records in several bands.
  const records: Record<string, string> = {};
  for (const [name, row, model] of [["L1", L1, "FormLead"], ["L2", L2, "FormLead"], ["L3", L3, "FormLead"], ["L4", L4, "CallLead"], ["L5", L5, "FormLead"], ["L6", L6, "FormLead"]] as const) {
    const record = await withTransaction(session => ensureLead({ model, id: String(row._id) }, workerContext(session, String(oid()), now)));
    records[name] = String(record!._id);
  }
  const progress = (code: string | null) => code === null ? null : { granot_priority: code, quoted: code === "1", disposition: code === "1" ? "quoted" : "fresh", work_observed: code === "1",
    basis: null, provenance: "accepted", source_origin: "granot", source_applied_at: now, last_progress_at: now, first_work_observed_at: null, override: null, reopen_review_id: null,
    disposition_revision: `r-${code}`, projected_at: now, fingerprint: `f-${code}` };
  const setRecord = (name: string, set: Record<string, unknown>) => Records.collection.updateOne({ _id: new mongoose.Types.ObjectId(records[name]) }, { $set: set });
  const followup = (record: string, over: Record<string, unknown>) => ({ _id: oid(), outreach_record_id: new mongoose.Types.ObjectId(records[record]), commitment_key: `t3co:${++serial}`,
    kind: "call", description: "Synthetic", status: "open", due_at: null, date_text: null, date_resolution: { precision: "exact", timezone: "America/New_York", assumption: "Synthetic promise", anchor: new Date(+now - 3 * DAY), policy_version: "v" },
    base_attention_due_at: null, attention_due_at: null, snoozed_until: null, wait_expired_at: null, missed_episode_key: null, trigger_interaction_ids: [], first_missed_at: null,
    responsible_agent_id: agentA, assignment: null, promised_by_agent_id: null, requested_by: null, origin: "rep_promise", source_finding_ids: [], origin_run_id: null, owner_instruction_ids: [],
    disposition: null, completion_basis: null, completed_at: null, completed_by: null, evidence_interaction_id: null, completion_finding_id: null, supersedes_id: null, cancel_reason: null,
    revision: 1, createdAt: new Date(+now - 3 * DAY), updatedAt: now, ...over });
  await setRecord("L1", { state: "open", responsible_agent_id: agentA, lead_progress: progress("0"), trigger_at: new Date(+now - 26 * HOUR), first_attributable_outbound_at: new Date(+now - 25 * HOUR) });
  await setRecord("L2", { state: "open", responsible_agent_id: agentA, lead_progress: progress(null), trigger_at: new Date(+now - 30 * HOUR) });
  await setRecord("L3", { state: "open", responsible_agent_id: agentB, lead_progress: progress("1") });
  await setRecord("L4", { state: "open", responsible_agent_id: null, lead_progress: progress(null) });
  await setRecord("L5", { state: "closed", closed_at: new Date(+now - 2 * DAY), closed_reason: "granot_dead_opportunity", closure_origin: "crm_disposition", lead_progress: progress("8") });
  await setRecord("L6", { state: "closed", closed_at: new Date(+now - DAY), closed_reason: "lost", closure_origin: "owner", responsible_agent_id: agentB });
  const promisedKept = followup("L1", { status: "completed", due_at: new Date(+now - 2 * DAY), completed_at: new Date(+now - 2 * DAY - 5 * MIN), completion_basis: "call_attempt", disposition: "connected_contact_unknown" });
  const promisedLate = followup("L1", { status: "completed", due_at: new Date(+now - 2 * DAY), completed_at: new Date(+now - 2 * DAY + HOUR), completion_basis: "call_attempt", disposition: "no_answer" });
  const promisedOpen = followup("L1", { due_at: new Date(+now - DAY), base_attention_due_at: new Date(+now - DAY) }); // band 1 for L1
  const promisedByA = followup("L3", { due_at: new Date(+now - DAY), base_attention_due_at: new Date(+now - DAY), responsible_agent_id: agentB, promised_by_agent_id: agentA });
  const missedOnTime = followup("L2", { origin: "system_default", missed_episode_key: "ep1", first_missed_at: new Date(+now - 2 * DAY), due_at: new Date(+now - 2 * DAY + 15 * MIN),
    status: "completed", completed_at: new Date(+now - 2 * DAY + 10 * MIN), completion_basis: "call_attempt", date_resolution: null });
  const missedOpen = followup("L2", { origin: "system_default", missed_episode_key: "ep2", first_missed_at: new Date(+now - DAY), due_at: new Date(+now - DAY + 15 * MIN),
    base_attention_due_at: new Date(+now - DAY + 15 * MIN), date_resolution: null }); // band 3 for L2
  await Followups.collection.insertMany([promisedKept, promisedLate, promisedOpen, promisedByA, missedOnTime, missedOpen]);
  const tr = (record: string, from: number | null, to: number, kind: string, at: Date) => ({ _id: oid(), record_id: new mongoose.Types.ObjectId(records[record]),
    subject_key: `lead:FormLead:${String(({ L1, L2, L3, L5, L6 } as Record<string, { _id: unknown }>)[record]!._id)}`, from_band: from, to_band: to, from_reason: null, to_reason: null, at,
    estimated: kind === "baseline", cause: { kind }, snapshot_id: "outreach:synthetic" });
  await db.collection("outreach_band_transitions").insertMany([tr("L1", null, 2, "baseline", new Date(+now - 3 * DAY)), tr("L2", null, 2, "baseline", new Date(+now - 3 * DAY)),
    tr("L3", 5, 4, "policy", new Date(+now - 2 * DAY)), tr("L2", 2, 3, "capture_repair", new Date(+now - DAY)), tr("L1", 2, 1, "clock", new Date(+now - DAY + HOUR)),
    tr("L3", 4, 1, "call", new Date(+now - DAY + 2 * HOUR))]);
  const auditRow = (record: string, subject: string, prior: string, current: string, agent: mongoose.Types.ObjectId | null, code: string) => ({ _id: oid(), semantic_key: `t3co:${++serial}`,
    subject_key: subject, event_kind: "lead_progress_updated", command_id: null, actor: { kind: "worker", id: "sales-intelligence-worker", request_id: "r", run_id: null },
    happened_at: new Date(+now - DAY), recorded_at: new Date(+now - DAY), prior: { lead_progress: { disposition: prior } },
    current: { lead_progress: { disposition: current, granot_priority: code }, responsible_agent_id: agent ? String(agent) : null }, correlation_id: null, run_id: null,
    invalidation: { kind: "outreach", target_id: records[record], subject_key: subject, revision: 2 }, createdAt: now, updatedAt: now });
  await getSalesIntelligenceAuditEventModel().collection.insertMany([auditRow("L3", `lead:FormLead:${String(L3._id)}`, "fresh", "quoted", agentB, "1"),
    auditRow("L1", `lead:FormLead:${String(L1._id)}`, "quoted", "quoted", agentA, "1")]);

  assert.equal((await publishAttentionSnapshot({ attentionV2: true })).status, "published");
  for (const day of [yesterday, today]) await rebuildRepDay(day);

  async function countReads<T>(work: () => Promise<T>) {
    const byCollection: Record<string, number> = {};
    let reads = 0;
    mongoose.set("debug", (collection: string, method: string) => {
      if (!READ_METHODS.has(method)) return;
      reads++;
      byCollection[`${collection}.${method}`] = (byCollection[`${collection}.${method}`] ?? 0) + 1;
    });
    try { return { result: await work(), reads, byCollection }; } finally { mongoose.set("debug", false); }
  }
  const attentionTotal = async (query: Record<string, unknown>) => (await readAttention({ view: "attention", limit: 1, ...query } as never)).data.total_items ?? 0;
  async function assertNowMatchesDesk(filters: { priority?: string; agent_id?: string }) {
    const overview = await readOverview({ period: "today", ...filters }, { cache: false });
    const page = await readAttention({ view: "attention", limit: 1, ...filters } as never);
    assert.equal(overview.as_of, page.as_of, "same as_of");
    assert.equal(overview.snapshot_id, page.data.snapshot_id);
    for (const band of [1, 2, 3, 4, 5, 6, 7] as const) assert.equal(overview.now.bands[String(band) as "1"], await attentionTotal({ band: String(band), ...filters }), `band ${band} ${JSON.stringify(filters)}`);
    assert.equal(overview.now.needs_review, await attentionTotal({ needs_review: "true", ...filters }));
    if (!filters.agent_id) assert.equal(overview.now.unassigned, await attentionTotal({ unassigned: "true", ...filters }));
    return overview;
  }

  {
    await t.test("C8: the now band counts equal Needs Attention at the same as_of (all, New preset, rep scope)", async () => {
      const all = await assertNowMatchesDesk({});
      assert.ok(Object.values(all.now.bands).filter(n => n > 0).length >= 2, `several bands populated: ${JSON.stringify(all.now.bands)}`);
      assert.ok(all.now.bands["1"] >= 1 && all.now.bands["3"] >= 1);
      await assertNowMatchesDesk({ priority: "0,not_set" });
      await assertNowMatchesDesk({ priority: "1" });
      await assertNowMatchesDesk({ agent_id: String(agentA) });
      assert.ok(["ok", "attention", "broken"].includes(all.now.capture_health.status));
      assert.equal(all.now.live_calls, (await readAttention({ view: "all_outreach", limit: 200 })).data.items.filter(r => r.filter_keys?.live_call).length);
      const repA = all.reps.find(r => r.agent.id === String(agentA))!;
      assert.equal(repA.open_assignments.open, 2, "L1 and L2 name A responsible");
    });

    await t.test("C9: two rebuilds of a day are byte-identical; unreviewed extensions land in unmapped; excluded calls stay out", async () => {
      const read = async () => (await getOutreachRepDayModel().collection.find({ day: yesterday }).sort({ _id: 1 }).toArray());
      const first = await read();
      await rebuildRepDay(yesterday);
      const second = await read();
      assert.ok(Buffer.compare(Buffer.from(mongoose.mongo.BSON.serialize({ d: first })), Buffer.from(mongoose.mongo.BSON.serialize({ d: second }))) === 0, "byte-identical");
      const byKey = new Map(second.map(doc => [doc.agent_key as string, doc]));
      assert.deepEqual([...byKey.keys()].sort(), [String(agentA), String(agentB), UNMAPPED_REP].sort());
      const a = byKey.get(String(agentA))!, b = byKey.get(String(agentB))!, u = byKey.get(UNMAPPED_REP)!;
      assert.deepEqual([a.outbound_attempts, a.outbound_conversations, a.answered_inbound, a.human_conversations, a.talk_seconds, a.calls], [3, 1, 1, 2, 420, 4], "no in-progress, Internal or monitoring call");
      assert.deepEqual([b.outbound_attempts, b.answered_inbound, b.human_conversations, b.talk_seconds, b.calls, b.recovered_calls], [2, 1, 1, 200, 3, 1]);
      assert.deepEqual([u.calls, u.answered_inbound, u.extensions, u.agent_id], [1, 1, ["299"], null]);
      // The Owner command recomputes a day through the idempotent ledger; a retry replays.
      const actor = csiOperatorActor("t3c-overview");
      const command = { command: "rebuild_overview_day", day: yesterday, reason: "Synthetic late capture" };
      const ran = await commandRebuildOverviewDay({ actor, idempotency_key: "t3c-rebuild-1", command });
      assert.deepEqual([ran.day, ran.documents, ran.replayed], [yesterday, 3, false]);
      assert.equal((await commandRebuildOverviewDay({ actor, idempotency_key: "t3c-rebuild-1", command })).replayed, true);
      assert.ok(Buffer.compare(Buffer.from(mongoose.mongo.BSON.serialize({ d: await read() })), Buffer.from(mongoose.mongo.BSON.serialize({ d: first }))) === 0);
      await assert.rejects(commandRebuildOverviewDay({ actor, idempotency_key: "t3c-rebuild-2", command: { ...command, day: "2999-01-01" } }));
      // The cron: today (+ yesterday before 06:00 ET), on its lease.
      const cron = await runOverviewRefreshOnce();
      assert.equal(cron.skipped, false);
      const overview = await readOverview({ period: "yesterday" }, { cache: false });
      const repA = overview.reps.find(r => r.agent.id === String(agentA))!;
      assert.deepEqual([repA.interactions.outbound_attempts, repA.interactions.talk_minutes, repA.interactions.attempt_conversation_rate], [3, 7, 1 / 3]);
      assert.deepEqual([overview.unmapped?.interactions.calls, overview.unmapped?.extensions], [1, ["299"]]);
      const todayView = await readOverview({}, { cache: false });
      assert.equal(todayView.reps.find(r => r.agent.id === String(agentA))!.interactions.outbound_attempts, 2, "activity defaults to Today");
      assert.equal(todayView.periods.spend.key, "last_7_days", "spend defaults to Last 7 days");
    });

    await t.test("C10: spend = Σ cpl over the lead-spend report's Leads minus duplicates and no_sync; legacy and unpriced labelled", async () => {
      const overview = await readOverview({ period: "last_7_days" }, { cache: false });
      const range = resolveOverviewPeriod("last_7_days", now);
      const report = await getLeadCost(getAdminModels("production"), { from: range.lead_start, to: new Date(+range.lead_end - 1) } as never);
      // The report keeps no_sync Leads and Call Lead duplicates (it drops only Form duplicates and unmatched Call Leads).
      assert.equal(report.total, 275);
      assert.equal(overview.spend.total.spend, report.total - 40 - 40, "no_sync Form Lead ($40) and duplicate Call Lead ($40) excluded");
      assert.deepEqual(overview.spend.total, { leads: 7, spend: 195, rate: 160, legacy: 35, unpriced_leads: 1, zero_leads: 1,
        outcomes: { leads: 7, quoted: 2, booked_in_granot: 1, booked_official: 1, bookings: 2, booking_rate: 2 / 7 } });
      const a = overview.reps.find(r => r.agent.id === String(agentA))!;
      assert.deepEqual(a.spend, { leads: 4, spend: 115, rate: 80, legacy: 35, unpriced_leads: 0, zero_leads: 1 });
      assert.equal(a.cost_per_booking, 115, "one official booking");
      assert.equal(overview.unassigned?.spend.spend, 40);
      assert.deepEqual(overview.spend.by_rep.map(r => r.spend).reduce((x, y) => x + y, 0), overview.spend.total.spend, "the rows sum to the total, Unassigned included");
      assert.ok(overview.spend.by_source.some(s => s.source === "Legacy Web" && s.legacy === 35));
      assert.ok(overview.spend.by_source.some(s => s.source === "Top10 Call" && s.unpriced_leads === 1));
    });

    await t.test("desk: speed to lead, callbacks kept, missed calls returned, flow (baseline/policy excluded, capture_repair apart)", async () => {
      const overview = await readOverview({ period: "last_7_days" }, { cache: false });
      const range = resolveOverviewPeriod("last_7_days", now);
      const expectedLeads = await Records.countDocuments({ "subject.model": "FormLead", trigger_kind: "lead_arrival", trigger_at: { $gte: range.start, $lt: range.end } });
      assert.equal(overview.desk.speed_to_lead.leads, expectedLeads);
      assert.deepEqual([overview.desk.callbacks_kept.due, overview.desk.callbacks_kept.kept, overview.desk.callbacks_kept.kept_contact_unknown,
        overview.desk.callbacks_kept.not_kept, overview.desk.callbacks_kept.overdue_now], [4, 1, 1, 1, 2]);
      assert.deepEqual([overview.desk.missed_calls_returned.episodes, overview.desk.missed_calls_returned.returned_on_time, overview.desk.missed_calls_returned.still_open], [2, 1, 1]);
      const flow = overview.desk.flow;
      assert.deepEqual([flow.bands.moves, flow.bands.capture_repair, flow.bands.excluded_baseline_or_policy], [2, 1, 3]);
      assert.equal(flow.moved_to_quoted, 1, "only a disposition change to quoted");
      assert.deepEqual([flow.crm_bad_dead, flow.owner_closed, flow.closed_total], [1, 1, 2]);
      assert.equal(flow.net_active_change, flow.new_outreach - flow.closed_total);
      const scoped = await readOverview({ period: "last_7_days", agent_id: String(agentA) }, { cache: false });
      assert.deepEqual([scoped.desk.callbacks_kept.due, scoped.desk.missed_calls_returned.episodes], [4, 2], "A promised on B's record and is responsible for the rest");
    });

    await t.test("C11: a scoped read shows only that rep's numbers and the team medians", async () => {
      const scoped = await readOverview({ period: "last_7_days" }, { scope: { agent_id: String(agentA) }, cache: false });
      assert.deepEqual(scoped.reps.map(r => r.agent.id), [String(agentA)]);
      assert.equal(scoped.unmapped, null);
      assert.equal(scoped.unassigned, null);
      assert.deepEqual(scoped.spend.by_rep.map(r => r.agent_id), [String(agentA)]);
      assert.equal(scoped.spend.total.spend, 115);
      assert.ok(scoped.team_medians && scoped.team_medians.reps >= 2);
      const text = JSON.stringify(scoped);
      assert.ok(!text.includes(String(agentB)) && !text.includes("Synthetic Rep B"), "no other rep's id or name");
      // The forced scope beats the client's agent_id (S8-REP).
      const forced = await readOverview({ period: "last_7_days", agent_id: String(agentB) }, { scope: { agent_id: String(agentA) }, cache: false });
      assert.deepEqual(forced.reps.map(r => r.agent.id), [String(agentA)]);
      const owner = await readOverview({ period: "last_7_days" }, { cache: false });
      assert.equal(owner.team_medians, undefined, "no medians without a one-rep scope");
      assert.ok(owner.reps.length >= 2 && owner.unmapped && owner.unassigned);
    });

    const small = await countReads(() => readOverview({ period: "last_30_days" }, { cache: false }));

    // Production-like volume: ~4,000 Leads and ~6,000 calls over 30 days, 1,500 Outreach records, their follow-ups and transitions.
    const agents = Array.from({ length: 10 }, () => oid());
    await db.collection("agents").insertMany(agents.map((id, i) => ({ _id: id, name: `Bulk Rep ${i}`, active: true })));
    await getRepIdentityLinkModel().collection.insertMany(agents.map((id, i) => linkRow(`3${String(i).padStart(2, "0")}`, id, `Bulk Rep ${i}`)));
    const bulkLeads = Array.from({ length: 4000 }, (_, i) => ({ _id: oid(), timestamp: toFloridaTimestamp(new Date(+now - (i % 29) * DAY - (i % 7) * HOUR - HOUR)), createdAt: now, updatedAt: now,
      name: `Bulk ${i}`, job_no: `T3COB-${i}`, source_granularity_label_snapshot: ["TBM Form", "Legacy Web", "Top10 Call"][i % 3], source_company: "Synthetic", cpl: i % 5 === 0 ? 0 : 40,
      ...(i % 4 ? { cpl_rate_period: period, cpl_resolution_status: "resolved" } : {}), receiver_agent: i % 11 === 0 ? null : agents[i % 10], granot_priority: ["0", "1", null, "3", "5"][i % 5],
      quoted: i % 3 === 0, duplicate: i % 50 === 0, no_sync: i % 97 === 0 }));
    await getFormLeadModel().collection.insertMany(bulkLeads.slice(0, 3000));
    await getCallLeadModel().collection.insertMany(bulkLeads.slice(3000));
    await db.collection("booked_leads").insertMany(bulkLeads.filter((_, i) => i % 9 === 0).map(l => ({ _id: oid(), lead_model: "FormLead", lead_ref: l._id, book_date: now })));
    const bulkCalls = [];
    for (let d = 0; d < 30; d++) for (let k = 0; k < 200; k++) {
      const at = new Date(+easternInstantBounds(easternDayKey(new Date(+now - d * DAY))).start + 9 * HOUR + k * 3 * MIN);
      if (+at >= +now) continue;
      bulkCalls.push(callDoc({ ext: k % 13 === 0 ? "399" : `3${String(k % 10).padStart(2, "0")}`, direction: k % 3 ? "Outbound" : "Inbound", at, connected: k % 2 === 0, human: k % 4 === 0, duration: 90 }));
    }
    await Calls.collection.insertMany(bulkCalls);
    const days = [...new Set(bulkCalls.map(c => easternDayKey(c.started_at)))];
    for (const day of days) await rebuildRepDay(day);
    const templates = await Records.find({ _id: { $in: Object.values(records).map(id => new mongoose.Types.ObjectId(id)) } }).lean();
    const cloneLeads: Record<string, unknown>[] = [], clones: Record<string, unknown>[] = [], cloneFollowups: Record<string, unknown>[] = [], cloneTransitions: Record<string, unknown>[] = [];
    for (let i = 0; i < 1500; i++) {
      const template = templates[i % templates.length]!;
      const leadId = oid(), recordId = oid();
      cloneLeads.push({ _id: leadId, timestamp: toFloridaTimestamp(new Date(+now - (i % 29) * DAY)), createdAt: now, updatedAt: now, name: `Clone ${i}`, job_no: `T3COC-${i}` });
      const { _id: _ignored, ...rest } = template;
      clones.push({ ...rest, _id: recordId, subject: { kind: "lead", model: "FormLead", id: leadId }, trigger_at: new Date(+now - (i % 29) * DAY - HOUR),
        responsible_agent_id: i % 7 === 0 ? null : agents[i % 10], ...(template.state === "closed" ? { closed_at: new Date(+now - (i % 29) * DAY) } : {}) });
      if (i % 2 === 0) cloneFollowups.push({ ...followup("L1", { due_at: new Date(+now - (i % 29) * DAY - 2 * HOUR), responsible_agent_id: agents[i % 10], status: i % 4 ? "open" : "completed",
        completed_at: i % 4 ? null : new Date(+now - (i % 29) * DAY - 3 * HOUR), completion_basis: i % 4 ? null : "call_attempt" }), outreach_record_id: recordId });
      if (i % 3 === 0) cloneFollowups.push({ ...followup("L2", { origin: "system_default", missed_episode_key: `bulk-${i}`, first_missed_at: new Date(+now - (i % 29) * DAY - 4 * HOUR),
        due_at: new Date(+now - (i % 29) * DAY - 4 * HOUR + 15 * MIN), responsible_agent_id: agents[i % 10], date_resolution: null }), outreach_record_id: recordId });
      for (let k = 0; k < 3; k++) cloneTransitions.push({ _id: oid(), record_id: recordId, subject_key: `lead:FormLead:${String(leadId)}`, from_band: k ? k : null, to_band: k + 1,
        from_reason: null, to_reason: null, at: new Date(+now - (i % 29) * DAY - k * HOUR), estimated: k === 0, cause: { kind: ["baseline", "call", "clock"][k] }, snapshot_id: "outreach:bulk" });
    }
    await getFormLeadModel().collection.insertMany(cloneLeads);
    await Records.collection.insertMany(clones);
    await Followups.collection.insertMany(cloneFollowups);
    await db.collection("outreach_band_transitions").insertMany(cloneTransitions);
    clearParsedAttentionSnapshots(); clearOverviewIndexCache(); clearOverviewCache();
    assert.equal((await publishAttentionSnapshot({ attentionV2: true })).status, "published");

    await t.test("C8 at volume, and reads per request don't grow with the data (no per-row query)", async () => {
      await assertNowMatchesDesk({});
      await assertNowMatchesDesk({ priority: "0,not_set", agent_id: String(agents[3]) });
      const large = await countReads(() => readOverview({ period: "last_30_days" }, { cache: false }));
      console.log(`# overview reads: seed → ${small.reads}, volume → ${large.reads}`, JSON.stringify(large.byCollection));
      assert.deepEqual(large.byCollection, small.byCollection, "per-collection read counts are constant in the data size");
    });

    await t.test("p95 < 500 ms for Last 30 days at production-like volume", async () => {
      const counts = { leads: await getFormLeadModel().countDocuments() + await getCallLeadModel().countDocuments(), calls: await Calls.countDocuments(), records: await Records.countDocuments(),
        followups: await Followups.countDocuments(), transitions: await db.collection("outreach_band_transitions").countDocuments() };
      const times: number[] = [];
      for (let i = 0; i < 12; i++) for (const query of [{ period: "last_30_days" }, { period: "last_30_days", priority: "0,not_set" }] as const) {
        const started = performance.now();
        await readOverview(query, { cache: false });
        times.push(performance.now() - started);
      }
      for (let i = 0; i < 6; i++) {
        const started = performance.now();
        await readOverview({ period: "last_30_days" }, { scope: { agent_id: String(agents[i]) }, cache: false });
        times.push(performance.now() - started);
      }
      times.sort((a, b) => a - b);
      const p95 = times[Math.floor(times.length * 0.95)]!;
      console.log(`# overview p95 ${p95.toFixed(1)} ms, p50 ${times[Math.floor(times.length / 2)]!.toFixed(1)} ms over ${times.length} reads; ${JSON.stringify(counts)}`);
      assert.ok(p95 < 500, `p95 ${p95.toFixed(1)} ms`);
      const cachedStart = performance.now();
      await readOverview({ period: "last_30_days" });
      await readOverview({ period: "last_30_days" });
      console.log(`# overview cached read ${(performance.now() - cachedStart).toFixed(1)} ms for two reads (60 s cache)`);
    });
  }
  } finally {
    await db.dropDatabase();
    await mongoose.disconnect();
  }
});
