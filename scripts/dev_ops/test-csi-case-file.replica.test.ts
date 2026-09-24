import assert from "node:assert/strict";
import { test } from "node:test";
import express, { type Request } from "express";
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { csiDataset } from "../../src/config/domain/salesIntelligence";
import { applyCsiMigration } from "../migrations/sales-intelligence.lib";
import { getIntelligenceRunModel } from "../../src/models/IntelligenceRun";
import { getIntelligenceEvidenceSnapshotModel } from "../../src/models/IntelligenceEvidenceSnapshot";
import { getIntelligenceSubmissionModel } from "../../src/models/IntelligenceSubmission";
import { getSalesIntelligenceJobModel } from "../../src/models/SalesIntelligenceJob";
import { getSalesIntelligenceSyncStateModel } from "../../src/models/SalesIntelligenceSyncState";
import { initializeCsiBudgetPeriod } from "../../src/services/salesIntelligence/aiBudget";
import { enqueueCsiJob } from "../../src/services/salesIntelligence/jobs";
import { runIntelligenceJob, type AnalysisDependencies } from "../../src/services/salesIntelligence/analysis/worker";
import { runIntelligenceApplicationJob } from "../../src/services/salesIntelligence/analysis/apply";
import { commandAnalysis } from "../../src/services/salesIntelligence/analysis/ownerCommands";
import { requireCsiOwner } from "../../src/services/salesIntelligence/auth";
import { computeAdminActorSignature } from "../../src/services/operationsRegistry/trustedActor";
import { payloadHash } from "../../src/services/salesIntelligence/transactions";
import { DEFAULT_RUNTIME_LIMITS } from "../../src/services/salesIntelligence/analysis/runtime";
import { StructuredYield } from "../../src/services/salesIntelligence/analysis/structuredGeneration";
import { scheduleNumberIntelligence } from "../../src/services/salesIntelligence/analysis/scheduling";
import { ensureLead, workerContext } from "../../src/services/salesIntelligence/outreach/ensure";
import { intelligenceEnvelopeSchema } from "../../src/validation/intelligence/intelligenceEnvelope.validation";
import { FINDINGS_PROMPT_V5 } from "../../src/services/salesIntelligence/analysis/structuredPrompt";
import { caseFileFromReadContent } from "../../src/services/salesIntelligence/casefile/page";
import { readContentSchema } from "../../src/services/salesIntelligence/analysis/reads";

/**
 * K12 (spec §4.14) and K10 on the replica, stubbed model, SALES_INTELLIGENCE_CASE_FILE on: a full
 * structured run persists the `case_file` artifact and `step_artifacts.case_file` and completes; a
 * retry and an original-evidence replay restore the same text; the summary step reads `call.at` and
 * `vantage_side` with a v3 cache key; flag off stays legacy; a run keeps the layout it was prepared with.
 */
type Message = { role: string; content: unknown };
const textOf = (message: Message | undefined) => !message ? "" : typeof message.content === "string" ? message.content
  : Array.isArray(message.content) ? message.content.map(p => (p && typeof p === "object" && "text" in p ? String((p as { text: unknown }).text) : "")).join("") : "";

test("Case File layout: K12 persistence, retry, replay; K10 summary inputs; flag-off and per-run layout", {
  skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 300_000,
}, async t => {
  assert.equal(process.env.TEST_MODE, "true");
  assert.match(getMongoDatabaseName(), /^testvantagemovers_t4bcf[a-f0-9]+$/);
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  t.after(async () => { await db.dropDatabase(); await mongoose.disconnect(); });
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  assert.equal((await applyCsiMigration()).ready, true);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("External traffic forbidden in the Case File replica proof"); });
  const now = new Date(), month = now.toISOString().slice(0, 7);
  await initializeCsiBudgetPeriod({ month, policy_version: "csi-policy-v1", timezone: "UTC", ceiling_cents: 8000,
    period_start: new Date(`${month}-01T00:00:00Z`), period_end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) });
  await getSalesIntelligenceSyncStateModel().create({ scope: "call_log_all_directions", known_complete_through: new Date(Date.now() + 3600_000), gaps: [] });
  const Runs = getIntelligenceRunModel(), Snapshots = getIntelligenceEvidenceSnapshotModel(), Submissions = getIntelligenceSubmissionModel(), Jobs = getSalesIntelligenceJobModel();
  const dataset = csiDataset();
  const { MockLanguageModelV4 } = await import("ai/test");
  const O = (hex: string) => new mongoose.Types.ObjectId(hex);
  await db.collection("agents").insertOne({ _id: O("6b9000000000000000000041"), name: "Jordan Bell", normalized_name: "jordan bell", active: true, role: "agent", created_from: "booked_lead" });
  await db.collection("rep_identity_links").insertMany([
    { _id: O("6b9000000000000000000042"), revision: 1, agent_id: O("6b9000000000000000000041"), agent_name_snapshot: "Jordan Bell", rc_account_id: "synthetic", rc_extension_id: "104",
      rc_extension_number: "104", rc_extension_name_snapshot: "Jordan Bell", rc_direct_numbers: [], role_kind: "sales_rep", status: "reviewed",
      effective_from: new Date("2026-01-01T00:00:00Z"), effective_to: null, reviewed_by: "owner@example.test", reviewed_at: new Date("2026-01-01T00:00:00Z"), history: [] },
    { _id: O("6b9000000000000000000043"), revision: 1, agent_id: O("6b9000000000000000000044"), agent_name_snapshot: "Mike Rivera", rc_account_id: "synthetic", rc_extension_id: "118",
      rc_extension_number: "118", rc_extension_name_snapshot: null, rc_direct_numbers: [], role_kind: "sales_rep", status: "proposed",
      effective_from: new Date("2026-01-01T00:00:00Z"), effective_to: null, reviewed_by: null, reviewed_at: null, history: [] }]);
  await db.collection("ringcentral_directory_snapshots").insertOne({ provider_account_id: "synthetic", taken_at: new Date("2026-09-20T00:00:00Z"), digest: "d",
    extensions: [{ id: "118", extension_number: "118", type: "User", name: "Mike R.", status: "Enabled", direct_numbers: [], sms_sender_numbers: [] }], company_numbers: [],
    queues: [{ id: "900", extension_number: "900", name: "Sales", member_extension_ids: ["104", "118"] }], counts: { extensions: 1, users: 1, departments: 0, company_numbers: 0, queues: 1 } });
  await db.collection("ringcentral_inbound_routes").insertOne({ provider: "ringcentral", phone_number: "+18885550100", phone_locked: false, display_label: "Top10", active: true,
    ever_activated: true, observed_target_names: [], validation_status: "valid", created_from: "admin", created_by: { actor_type: "user", actor_id: "o", actor_label: "o", actor_role: "owner" } });

  let serial = 0;
  async function fixture() {
    serial++;
    const hex = (n: number) => `6c${String(serial).padStart(2, "0")}${String(n).padStart(20, "0")}`;
    const ten = `75755${String(50000 + serial).slice(-5)}`, e164 = `+1${ten}`;
    const t0 = (iso: string, plus = 0) => new Date(Date.parse(iso) + plus);
    const number = hex(1), lead = hex(2);
    await db.collection("contact_numbers").insertOne({ _id: O(number), e164, national_ten: ten, digits_reversed: ten.split("").reverse().join(""), kind: "external", classification: "customer",
      first_observed_at: t0("2026-09-15T22:30:00Z"), last_activity_at: t0("2026-09-21T19:40:00Z"), provider_names: ["M LOPEZ"], revision: 1,
      contact_eligibility: { state: "eligible", reasons: [], decided_at: t0("2026-09-15T22:30:00Z") }, purged_at: null, content_purge_pending: false });
    await db.collection("form_leads").insertOne({ _id: O(lead), name: "Maria Lopez", timestamp: t0("2026-09-15T22:30:00Z"), createdAt: t0("2026-09-15T22:30:20Z"), updatedAt: t0("2026-09-15T22:30:20Z"),
      phone_number: `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`, normalized_phone_number: ten, source_company: "Top10", source_company_label_snapshot: "Top10",
      job_no: `845${serial}`, normalized_job_no: `845${serial}`, quoted: true, granot_priority: "1", domain_revision: 2, cpl: 0, pickup_city: "Norfolk", pickup_state: "VA", pickup_zip: "23510",
      delivery_city: "Raleigh", delivery_state: "NC", destination_zip: "27601", move_size: "2 Bedrooms", move_date: t0("2026-10-10T00:00:00Z"), post_to_granot: true,
      ingestion_origin: "wordpress_form", receiver_agent: O("6b9000000000000000000041"), receiver_agent_name_snapshot: "Jordan Bell", receiver_agent_source: "granot_username_match",
      receiver_agent_set_at: t0("2026-09-17T15:20:00Z"), ingested_move_snapshot: { pickup_city: "Norfolk", pickup_state: "VA", pickup_zip: "23510", delivery_city: "Raleigh",
        delivery_state: "NC", destination_zip: "27601", move_size: "2 Bedrooms", move_date: t0("2026-10-10T00:00:00Z"), captured_at: t0("2026-09-15T22:30:00Z"), evidence_status: "captured_at_ingestion" } });
    await db.collection("number_lead_attachments").insertOne({ contact_number_id: O(number), lead_ref: { model: "FormLead", id: O(lead) }, state: "attached", certainty: "exact", revision: 1,
      evidence: [{ source: "lead_phone_live", field_path: "form_leads.normalized_phone_number", observed_at: t0("2026-09-15T22:30:00Z"), window_from: t0("2026-09-15T22:30:00Z"), window_to: t0("2027-01-01T00:00:00Z") }],
      lead_snapshot: { name: "Maria Lopez", job_no: `845${serial}`, lead_timestamp: t0("2026-09-15T22:30:00Z"), refreshed_at: t0("2026-09-15T22:30:00Z") }, decided_by: "automatic",
      auto_decision: { confidence: 0.97, reason: "sole phone match", decided_at: t0("2026-09-15T22:35:00Z") },
      history: [{ from: "candidate", to: "attached", at: t0("2026-09-15T22:35:00Z"), by: "automatic", reason: "sole phone match" }], createdAt: t0("2026-09-15T22:30:00Z"), updatedAt: t0("2026-09-15T22:35:00Z") });
    const call = (id: string, iso: string, direction: "Inbound" | "Outbound", human: boolean, parties: Array<{ role: string; extension_id?: string; connected: boolean }>, conv: string | null, secs: number) => ({
      _id: O(id), provider: "ringcentral", provider_account_id: "synthetic", telephony_session_id: `cf-${id}`, identity_basis: "telephony_session_id", direction, contact_number_id: O(number),
      external_e164: e164, external_endpoint_kind: "external", company_e164: "+18885550100", started_at: t0(iso), answered_at: human ? t0(iso, 8000) : null, ended_at: t0(iso, secs * 1000),
      duration_seconds: secs, provider_result: human ? "Call connected" : "No Answer", provider_connected: human, contact_type: human ? "human_conversation" : "unknown",
      contact_type_basis: human ? "transcript:v1" : null, parties: [{ role: "external", direction, e164, phone_number_raw: e164, name_raw: "M LOPEZ", connected: human },
        ...parties.map(p => ({ role: p.role, direction, extension_id: p.extension_id ?? null, extension_number: p.extension_id ?? null, connected: p.connected }))],
      legs: [], legs_overflow_count: 0, connected_user_extension_ids: parties.filter(p => p.connected && p.role === "user").map(p => p.extension_id), queue_fanout: parties.some(p => p.role === "queue"),
      transfer: false, monitoring: false, recordings: conv ? [{ provider_recording_id: `rec-${id}`, recording_type: "Automatic", observed_at: t0(iso, 60_000), lead_conversation_id: O(conv) }] : [],
      sources: ["webhook"], terminal: true, projection_revision: 1, first_observed_at: t0(iso, 40_000), last_observed_at: t0(iso, 3_600_000), merged_into_id: null, purged_at: null });
    const [c1, c2, c3, v1, v2, x1, x2] = [hex(11), hex(12), hex(13), hex(21), hex(22), hex(31), hex(32)];
    await db.collection("call_interactions").insertMany([
      call(c1, "2026-09-17T14:04:00Z", "Outbound", true, [{ role: "user", extension_id: "104", connected: true }], v1, 252),
      call(c3, "2026-09-18T15:00:00Z", "Outbound", false, [{ role: "user", extension_id: "104", connected: false }], null, 30),
      call(c2, "2026-09-21T19:40:00Z", "Inbound", true, [{ role: "queue", extension_id: "900", connected: false }, { role: "user", extension_id: "104", connected: false },
        { role: "user", extension_id: "118", connected: true }], v2, 362)]);
    const segs = (lines: string[]) => lines.map((text, i) => ({ sid: i + 1, start_ms: i * 5000, end_ms: i * 5000 + 4000, timing_source: "provider", speaker: i % 2 ? "customer" : "rep", text }));
    for (const [conv, callId, iso, tx, direction, lines] of [[v1, c1, "2026-09-17T14:04:00Z", x1, "Outbound", ["This is Jordan with Vantage.", "We move October tenth.", "I will call you back Monday after five.", "Monday works."]],
      [v2, c2, "2026-09-21T19:40:00Z", x2, "Inbound", ["Vantage, Mike speaking.", "I am calling back about the estimate.", "Someone will call you tomorrow.", "Thanks."]]] as const) {
      await db.collection("lead_conversations").insertOne({ _id: O(conv), provider: "ringcentral", provider_account_id: "synthetic", provider_recording_id: `rec-${callId}`, call_interaction_id: O(callId),
        contact_number_id: O(number), contact_type: "human_conversation", contact_type_basis: "transcript:v1", started_at: t0(iso), duration_seconds: direction === "Outbound" ? 252 : 362, direction,
        rc_result: "Call connected", lead_ref: { model: "FormLead", id: O(lead) }, match_method: "call_interaction_number_candidate", match_confidence: "medium", state: "transcribed",
        latest_transcript_version: `cf-tv-${conv}`, media_digest_sha256: "b".repeat(64), media: null, transcript: null, summary: null, latest_completed_run_id: null, content_purged_at: null, attempts: 0,
        analysis_eligibility: { eligible: true, status: "eligible", missing_inputs: [], scope: "lead", reasons: [], decided_at: t0(iso, 3_600_000), policy_version: "csi-policy-v1" },
        createdAt: t0(iso, 90_000), updatedAt: t0(iso, 7_200_000) });
      const segments = segs([...lines]);
      await Snapshots.create({ _id: O(tx), ...dataset, conversation_id: O(conv), transcript_version: `cf-tv-${conv}`, source_type: "transcript", source_id: conv, source_revision: "b".repeat(64),
        arguments: {}, response: {}, retrieved_at: t0(iso, 3_600_000), happened_at: t0(iso), content_digest: payloadHash(segments), subject_key: `conversation:${conv}`,
        completeness: { complete: true, missing_ranges: [] }, segments });
    }
    const obs = (n: number, iso: string, money: Record<string, unknown>) => ({ _id: O(hex(50 + n)), receipt_id: O(hex(60 + n)), schema_version: 1, kind: "lead_snapshot", normalization_result: "valid",
      normalized_source_label: "top10", captured_at: t0(iso), identity: { job_no_raw: `845${serial}`, normalized_job_no: `845${serial}` }, contact: { normalized_phone: ten },
      move: { move_date: t0("2026-10-12T00:00:00Z"), estimated_cubic_feet: 540 }, priority: { raw: "1", canonical: "1", valid: true }, booking_action: {}, display_money: money,
      agent_identity: { rep_raw: "JBELL", user_raw: "JBELL" }, provider_context: {}, issues: [], createdAt: t0(iso, 5000), updatedAt: t0(iso, 5000) });
    await db.collection("granot_observations").insertMany([obs(1, "2026-09-17T15:20:00Z", { estimate: { raw: "7100.00" } }), obs(2, "2026-09-19T19:02:00Z", { estimate: { raw: "6600.00" } }),
      obs(3, "2026-09-20T13:00:00Z", {})]);
    await db.collection("entity_changes").insertOne({ entity: { model: "FormLead", id: lead }, command_execution_id: O(hex(70)), command_name: "granot.observe_lead",
      provenance: { source_system: "granot", observation_channel: "granot_webhook", observation_id: O(hex(51)), actor: { actor_type: "system", actor_id: "granot-lifecycle" } },
      changed_paths: ["granot_priority"], fields: [{ path: "granot_priority", value_mode: "stored", before: "0", after: "1" }], revision_before: 0, revision_after: 1, applied_at: t0("2026-09-17T15:21:00Z") });
    await withTransaction(session => ensureLead({ model: "FormLead", id: lead }, workerContext(session, hex(80), t0("2026-09-15T22:30:00Z")), number));
    const job = async (conv: string, tx: string) => withTransaction(session => enqueueCsiJob({ stage: "analysis", subject_key: `conversation:${conv}`, input_revision: 1,
      dedupe_key: `cf:${conv}`, input_refs: [conv, tx] }, session));
    return { number, lead, v1, v2, x1, x2, job, hex };
  }

  function provider(options: { citeFirstUncaptured?: boolean; always?: boolean } = {}) {
    const calls: string[] = [], prompts: Array<{ kind: string; system: string; user: string }> = [];
    const model = new MockLanguageModelV4({ doGenerate: async input => {
      const messages = input.prompt as unknown as Message[];
      const system = textOf(messages.find(m => m.role === "system")), user = textOf(messages.find(m => m.role === "user"));
      const isSummary = system.includes("Summarize one redacted moving-sales conversation");
      calls.push(isSummary ? "summary" : "findings");
      prompts.push({ kind: isSummary ? "summary" : "findings", system, user });
      let object: unknown;
      if (isSummary) object = { summary: { overview: "Customer is moving and waits for a callback.", customer_wanted: "Estimate.", money_and_dates: "", outcome: "Callback promised.",
        commitments: "Call back.", discrepancies: "" }, said_on_call: [{ kind: "promised_callback", claim: "Rep promised a callback.", value: { action_kind: "call", description: "Call back",
        date_text: null, timezone_text: null, target_followup_id: null }, actor: "rep", clarity: "clear", action_status: "promised", speaker: "rep", segment_ids: [3], quote: null }],
      move_evidence: { observations: [], inventory: [], intent_signals: [] } };
      else {
        // A repair request appends the refusal after the original JSON line; the evidence is the first line.
        const payload = JSON.parse(user.split(String.fromCharCode(10))[0]!) as { appendix?: { calls: Array<{ call_index: number; segments_available: boolean; said_on_call: Array<{ segment_ids: number[] }> }> };
          calls?: Array<{ call_index: number; said_on_call: Array<{ segment_ids: number[] }> }> };
        const firstFindings = calls.filter(c => c === "findings").length === 1;
        const cited = payload.appendix ? (options.citeFirstUncaptured && (firstFindings || options.always) ? payload.appendix.calls.find(c => !c.segments_available) : payload.appendix.calls.find(c => c.segments_available))
          : payload.calls?.[0];
        object = { summary: { overview: "Current state.", customer_wanted: "", money_and_dates: "", outcome: "", commitments: "", discrepancies: "" },
          findings: [{ kind: "intent", claim: "Customer is planning a move.", value: { intent: "moving_inquiry" }, actor: "customer", clarity: "clear", action_status: null, basis: "said_on_call",
            evidence: [{ source: "transcript", call_index: cited?.call_index ?? 0, segment_ids: cited?.said_on_call[0]?.segment_ids ?? [3], quote: null }] }],
          next_step: null, owner_instruction_assessments: [], prior_finding_relations: [], story_discrepancies: [] };
      }
      return { content: [{ type: "text", text: JSON.stringify(object) }], finishReason: { unified: "stop", raw: "synthetic" },
        usage: { inputTokens: { total: 120, noCache: 120, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 40, text: 30, reasoning: 10 } }, warnings: [], providerMetadata: { gateway: { cost: 0.001 } } };
    } });
    const deps: AnalysisDependencies = { model, configuration: { endpoint: "", key: "", model_id: "openai/gpt-5-mini",
      pricing: { version: "synthetic", input_cents_per_million: 1, output_cents_per_million: 1 }, limits: DEFAULT_RUNTIME_LIMITS }, publish: async () => {}, onError: error => { console.error(error); } };
    return { calls, prompts, deps };
  }
  function owner(path: string) {
    const fields = { adminId: "synthetic-owner", email: "owner@example.test", role: "owner", timestamp: String(Date.now()), requestId: `cf-proof-${serial}-${Math.random()}`, method: "POST", path };
    const request: Request = Object.assign(Object.create(express.request), { method: fields.method, originalUrl: fields.path,
      vantageAuth: { kind: "user", userId: fields.adminId, email: fields.email, roles: ["owner"] }, headers: {
        "x-vantage-admin-user-id": fields.adminId, "x-vantage-admin-email": fields.email, "x-vantage-admin-role": fields.role, "x-vantage-admin-timestamp": fields.timestamp,
        "x-vantage-admin-request-id": fields.requestId, "x-vantage-admin-signature": computeAdminActorSignature(fields, process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET!) } });
    return requireCsiOwner(request);
  }
  async function replay(sourceId: string, suffix: string) {
    const source = await Runs.findById(sourceId).orFail();
    const result = await commandAnalysis({ actor: owner("/api/v1/admin/sales-intelligence/analysis-runs"), target_id: String(source.conversation_id ?? source.contact_number_id),
      idempotency_key: `cf-proof:${sourceId}:${suffix}`, application_disabled: true,
      command: { command: "reanalyze", mode: "original_evidence", expected_revision: source.revision, source_run_id: sourceId, owner_correction_ids: [], reason: "Synthetic Case File proof" } });
    return result.response as { job_id: string; run_id: string };
  }
  const apply = async (runId: unknown) => {
    const receipt = await Submissions.findOne({ run_id: runId }).orFail();
    assert.equal((await runIntelligenceApplicationJob(String(receipt.application_job_id))).status, "completed");
  };
  const caseFileSnapshot = async (runId: unknown) => {
    const row = await Snapshots.findOne({ run_id: runId, source_type: "case_file" }).lean();
    return row ? caseFileFromReadContent(readContentSchema.parse(row.response)) : null;
  };

  let firstRunId = "";
  await t.test("K12 + K10: a conversation run persists the case_file artifact and step_artifacts.case_file, and completes", async () => {
    const f = await fixture(), p = provider();
    const job = await f.job(f.v1, f.x1);
    assert.equal((await runIntelligenceJob(String(job._id), "analysis", p.deps)).status, "submitted");
    assert.deepEqual(p.calls, ["summary", "findings"]);
    const summaryInput = JSON.parse(p.prompts[0]!.user) as { call: Record<string, unknown>; subject_binding: unknown; segments: unknown[] };
    assert.deepEqual(Object.keys(summaryInput), ["call", "subject_binding", "segments"]);
    assert.equal(summaryInput.call.at, "Thu Sep 17, 2026 10:04 AM ET");
    assert.equal(summaryInput.call.at_iso, "2026-09-17T14:04:00.000Z");
    assert.equal(summaryInput.call.direction, "outbound");
    assert.equal(summaryInput.call.duration, "4m12s");
    assert.equal(summaryInput.call.vantage_side, "Outbound from Top10 line (+18885550100) by Jordan Bell (ext 104, reviewed)");
    assert.match(String(summaryInput.call.lead_origin), /^Lead \[Vantage intake\] Form submitted Tue Sep 15, 2026 6:30 PM ET on Top10:/);
    assert.ok(p.prompts[0]!.system.includes("call.at is the call date"), "the v3 summary prompt");
    const findings = JSON.parse(p.prompts[1]!.user) as Record<string, unknown> & { case_file: string; appendix: { story_event_ids: string[]; calls: Array<{ segments_available: boolean }> } };
    assert.deepEqual(Object.keys(findings), ["subject_scope", "case_file", "appendix", "instructions", "owner_corrections"]);
    assert.equal(p.prompts[1]!.system, FINDINGS_PROMPT_V5);
    assert.match(findings.case_file, /^CASE FILE \(data\) · Number \+1\d{10} · as of /);
    assert.ok(findings.case_file.includes("C0 outbound from Top10 line by Jordan Bell (ext 104, reviewed)"));
    assert.ok(findings.case_file.includes("· inbound to Top10 line, queue \"Sales\" rang 2; answered by ext 118 (identity not reviewed; directory name \"Mike R.\")"));
    assert.ok(findings.case_file.includes("Estimate $6,600"), "the last known estimate survives the money-less newest observation");
    assert.ok(findings.case_file.includes("Priority 0 Fresh → 1 Quoted by JBELL · estimate $7,100"), "entity_changes line enriched with the observation");
    assert.deepEqual(findings.appendix.calls.map(c => c.segments_available), [true], "only summarized calls are C calls; the later call has no summary yet");
    const run = await Runs.findOne({ job_id: job._id }).orFail();
    firstRunId = String(run._id);
    assert.equal((run.step_contracts as { layout?: string }).layout, "case_file");
    assert.equal(run.prompt_version, "sales_intelligence_analyze_v5", "run.ts records the layout's prompt version (coordinator diff)");
    assert.equal(run.rendered_prompt, FINDINGS_PROMPT_V5);
    const artifacts = run.step_artifacts as { case_file: { bytes: number; trimmed_steps: unknown[]; over_hard_budget: boolean; digest: string; snapshot_id: string }; story: unknown; summaries: string[] };
    assert.equal(artifacts.case_file.bytes, Buffer.byteLength(findings.case_file));
    assert.deepEqual(artifacts.case_file.trimmed_steps, []);
    assert.equal(artifacts.case_file.over_hard_budget, false);
    assert.equal(artifacts.case_file.digest, payloadHash(findings.case_file));
    assert.equal(artifacts.story, null);
    const stored = await caseFileSnapshot(run._id);
    assert.equal(stored?.text, findings.case_file, "the artifact holds the exact text the model read");
    assert.equal(String((await Snapshots.findOne({ run_id: run._id, source_type: "case_file" }).lean())?._id), artifacts.case_file.snapshot_id);
    assert.equal(findings.appendix.story_event_ids.length, stored!.story_events);
    await apply(run._id);
    const done = await Runs.findById(run._id).orFail();
    assert.equal(done.status, "completed");
    intelligenceEnvelopeSchema.parse(done.output);
    // K10: the canonical summary is keyed by csi-summary-v3, never by the v2 key.
    const keyFor = (prompt: string) => payloadHash({ ...dataset, conversation_id: f.v1, transcript_version: `cf-tv-${f.v1}`, prompt, model: "openai/gpt-5-mini" });
    const canonical = await Snapshots.findOne({ conversation_id: O(f.v1), artifact_key: { $type: "string" } }).lean();
    assert.equal(canonical?.artifact_key, keyFor("csi-summary-v3"));
    assert.notEqual(keyFor("csi-summary-v3"), keyFor("csi-summary-v2"));
  });

  let retriedRunId = "";
  await t.test("K12: a retry restores the frozen Case File; an uncaptured call cannot be cited by transcript", async () => {
    const f = await fixture(), p = provider({ citeFirstUncaptured: true });
    // C0 already has a canonical summary (from a first run) so the C1 run lists it without segments.
    const first = provider();
    const job1 = await f.job(f.v1, f.x1);
    assert.equal((await runIntelligenceJob(String(job1._id), "analysis", first.deps)).status, "submitted");
    await apply((await Runs.findOne({ job_id: job1._id }).orFail())._id);
    const job = await f.job(f.v2, f.x2);
    let attempts = 0;
    const yielded = await runIntelligenceJob(String(job._id), "analysis", { ...p.deps, beforeProvider: async () => { if (++attempts === 2) throw new StructuredYield(); } });
    assert.equal(yielded.status, "retry", JSON.stringify(yielded));
    const run = await Runs.findOne({ job_id: job._id }).orFail();
    const frozen = await caseFileSnapshot(run._id);
    assert.ok(frozen, "the case_file artifact is persisted before the findings step");
    // New world facts after the freeze must not appear in the retried prompt.
    await db.collection("granot_observations").insertOne({ receipt_id: O(f.hex(69)), schema_version: 1, kind: "lead_snapshot", normalization_result: "valid", captured_at: new Date("2026-09-21T19:00:00Z"),
      identity: { normalized_job_no: `845${serial}` }, contact: {}, move: {}, priority: { raw: "1", canonical: "1", valid: true }, booking_action: {}, display_money: { estimate: { raw: "5000.00" } },
      agent_identity: {}, provider_context: {}, issues: [], createdAt: new Date(), updatedAt: new Date() });
    await Jobs.updateOne({ _id: job._id }, { $set: { next_attempt_at: new Date() } });
    assert.equal((await runIntelligenceJob(String(job._id), "analysis", p.deps)).status, "submitted");
    const findingsPrompts = p.prompts.filter(x => x.kind === "findings");
    assert.equal(findingsPrompts.length, 2, "one refused citation, one repair");
    const retried = JSON.parse(findingsPrompts[0]!.user.split(String.fromCharCode(10))[0]!) as { case_file: string; appendix: { calls: Array<{ segments_available: boolean }> } };
    assert.equal(retried.case_file, frozen!.text, "the retry reads the frozen text");
    assert.ok(!retried.case_file.includes("$5,000"));
    assert.deepEqual(retried.appendix.calls.map(c => c.segments_available), [false, true], "C0 is context without segments; C1 is this run's call");
    const done = await Runs.findOne({ job_id: job._id }).orFail();
    assert.equal(done.schema_failures, 1, "citing the uncaptured C0 by transcript was refused and repaired");
    assert.ok(retried.case_file.includes("◀ THIS RUN"));
    retriedRunId = String(done._id);
    await apply(done._id);
  });

  await t.test("a model that keeps citing a call without segments pauses as schema_exhausted after two repairs (no step-timeout loop)", async () => {
    const f = await fixture();
    const job1 = await f.job(f.v1, f.x1);
    assert.equal((await runIntelligenceJob(String(job1._id), "analysis", provider().deps)).status, "submitted");
    const stubborn = provider({ citeFirstUncaptured: true, always: true });
    const job = await f.job(f.v2, f.x2);
    const result = await runIntelligenceJob(String(job._id), "analysis", stubborn.deps);
    assert.deepEqual(result, { status: "paused", reason: "schema_exhausted" });
    assert.equal(stubborn.calls.filter(c => c === "findings").length, 3, "the original answer and two repairs");
    const run = await Runs.findOne({ job_id: job._id }).orFail();
    assert.equal(run.status, "paused");
    assert.equal(run.schema_failures, 2);
    assert.equal(await Submissions.countDocuments({ run_id: run._id }), 0);
  });

  await t.test("K12: an original-evidence replay restores the same Case File text, even with the flag off", async () => {
    for (const [flag, suffix] of [["true", "on"], ["false", "off"]] as const) {
      process.env.SALES_INTELLIGENCE_CASE_FILE = flag;
      const p = provider();
      const job = await replay(retriedRunId, suffix);
      assert.equal((await runIntelligenceJob(job.job_id, "analysis", p.deps)).status, "submitted");
      assert.deepEqual(p.calls, ["findings"]);
      const original = await caseFileSnapshot(O(retriedRunId)), copy = await caseFileSnapshot(O(job.run_id));
      assert.equal(copy?.text, original?.text);
      assert.equal((JSON.parse(p.prompts[0]!.user) as { case_file: string }).case_file, original!.text, `replay with the flag ${suffix}`);
      const replayRun = await Runs.findById(job.run_id).orFail();
      assert.equal((replayRun.step_contracts as { layout?: string }).layout, "case_file", "a replay keeps its parent's layout");
    }
    process.env.SALES_INTELLIGENCE_CASE_FILE = "true";
  });

  await t.test("flag off: the legacy layout, byte-for-byte shapes, no case_file artifact", async () => {
    process.env.SALES_INTELLIGENCE_CASE_FILE = "false";
    try {
      const f = await fixture(), p = provider();
      const job = await f.job(f.v1, f.x1);
      assert.equal((await runIntelligenceJob(String(job._id), "analysis", p.deps)).status, "submitted");
      assert.deepEqual(Object.keys(JSON.parse(p.prompts[0]!.user)), ["subject_binding", "segments"]);
      assert.deepEqual(Object.keys(JSON.parse(p.prompts[1]!.user)), ["subject_scope", "calls", "context", "story", "prior", "instructions", "owner_corrections"]);
      const run = await Runs.findOne({ job_id: job._id }).orFail();
      assert.equal((run.step_contracts as { layout?: string }).layout, undefined);
      assert.equal(await Snapshots.countDocuments({ run_id: run._id, source_type: "case_file" }), 0);
      assert.equal(run.prompt_version, "sales_intelligence_analyze_v4");
    } finally { process.env.SALES_INTELLIGENCE_CASE_FILE = "true"; }
  });

  await t.test("a run keeps the layout it was prepared with when the flag flips mid-flight (no step_contracts trap)", async () => {
    process.env.SALES_INTELLIGENCE_CASE_FILE = "false";
    const f = await fixture(), p = provider();
    const job = await f.job(f.v1, f.x1);
    let attempts = 0;
    assert.equal((await runIntelligenceJob(String(job._id), "analysis", { ...p.deps, beforeProvider: async () => { if (++attempts === 2) throw new StructuredYield(); } })).status, "retry");
    process.env.SALES_INTELLIGENCE_CASE_FILE = "true";
    await Jobs.updateOne({ _id: job._id }, { $set: { next_attempt_at: new Date() } });
    assert.equal((await runIntelligenceJob(String(job._id), "analysis", p.deps)).status, "submitted");
    const findings = p.prompts.find(x => x.kind === "findings")!;
    assert.ok("story" in JSON.parse(findings.user), "prepared legacy, finished legacy");
    assert.equal(await Snapshots.countDocuments({ run_id: (await Runs.findOne({ job_id: job._id }).orFail())._id, source_type: "case_file" }), 0);
  });

  await t.test("a Number run with the flag on: every summarized call is a C call with segments; the rolling summary is absent on the first synthesis", async () => {
    const f = await fixture(), p = provider();
    for (const [conv, tx] of [[f.v1, f.x1], [f.v2, f.x2]] as const) {
      const job = await f.job(conv, tx);
      assert.equal((await runIntelligenceJob(String(job._id), "analysis", provider().deps)).status, "submitted");
      await apply((await Runs.findOne({ job_id: job._id }).orFail())._id);
    }
    const jobId = await withTransaction(session => scheduleNumberIntelligence(f.number, session));
    assert(jobId);
    await Jobs.updateOne({ _id: jobId }, { $set: { next_attempt_at: new Date() } });
    assert.equal((await runIntelligenceJob(jobId, "number_refresh", p.deps)).status, "submitted");
    const findings = JSON.parse(p.prompts.find(x => x.kind === "findings")!.user) as { subject_scope: string; case_file: string; appendix: { calls: Array<{ segments_available: boolean }> } };
    assert.equal(findings.subject_scope, "number");
    assert.deepEqual(findings.appendix.calls.map(c => c.segments_available), [true, true]);
    assert.match(findings.case_file, /Analyze: C0 \(.*\), C1 \(.*\)\. Earlier calls are context\./);
    const run = await Runs.findOne({ job_id: jobId }).orFail();
    await apply(run._id);
    assert.equal((await Runs.findById(run._id).orFail()).status, "completed");
    assert.ok(firstRunId);
  });
});
