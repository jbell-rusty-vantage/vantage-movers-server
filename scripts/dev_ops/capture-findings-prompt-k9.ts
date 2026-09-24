/**
 * K9 (Case File spec §4.14): capture the exact findings and summary prompts the structured pipeline
 * sends for one deterministic fixture, with a stubbed model (no network, no paid call).
 *
 *   node --import tsx scripts/dev_ops/capture-findings-prompt-k9.ts --db <suffix> --out <file.json> [--case-file]
 *   node --import tsx scripts/dev_ops/capture-findings-prompt-k9.ts --compare <before.json> <after.json>
 *
 * The fixture (a Form Lead Number with two recorded conversations, an unanswered attempt, Granot
 * observations, a Lead message and a rep link) is written with fixed ids and fixed times into a
 * disposable `testvantagemovers_t4bk9<suffix>` on the loopback replica, then three real worker runs
 * go through `runIntelligenceJob` (conversation C1, conversation C2, number synthesis) with their
 * applications. Every provider request is recorded. It imports only modules that exist at the base
 * (`01bcf18`), so the same file runs in the base worktree (before) and the working tree (after).
 *
 * Normalization, applied identically to both captures: ObjectIds and ISO instants that the run itself
 * generates (run ids, finding ids, `started_at`, `createdAt`) are replaced by `<OID:n>` / `<T:n>` in
 * order of first appearance; fixture ids and fixture times stay verbatim. Relative day counts depend
 * on the calendar day, so the capture runs on a shifted clock that starts at Wed Sep 23, 2026 4:10 PM ET.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const REPLICA = "mongodb://127.0.0.1:27189/?replicaSet=csi01";
const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };

function compare(beforePath: string, afterPath: string) {
  const before = JSON.parse(readFileSync(beforePath, "utf8")) as { prompts: Array<{ step: string; text: string }>; digests: Record<string, string> };
  const after = JSON.parse(readFileSync(afterPath, "utf8")) as typeof before;
  let same = before.prompts.length === after.prompts.length;
  for (let i = 0; i < Math.max(before.prompts.length, after.prompts.length); i++) {
    const x = before.prompts[i]?.text ?? "", y = after.prompts[i]?.text ?? "";
    if (x === y) { console.log(`prompt ${i} (${before.prompts[i]?.step}): identical, ${Buffer.byteLength(x)} bytes`); continue; }
    same = false;
    let at = 0; while (at < Math.min(x.length, y.length) && x[at] === y[at]) at++;
    console.error(`prompt ${i} (${before.prompts[i]?.step} vs ${after.prompts[i]?.step}) DIFFERENT at ${at}: before …${x.slice(Math.max(0, at - 160), at + 160)}… after …${y.slice(Math.max(0, at - 160), at + 160)}…`);
  }
  for (const key of Object.keys({ ...before.digests, ...after.digests })) {
    const equal = before.digests[key] === after.digests[key];
    console.log(`digest ${key}: ${equal ? "identical" : "DIFFERENT"} ${before.digests[key]} ${equal ? "" : `→ ${after.digests[key]}`}`);
    if (!equal && !key.startsWith("info:")) same = false;
  }
  console.log(same ? "K9 prompts identical" : "K9 prompts DIFFER");
  if (!same) process.exitCode = 1;
}

const FIXED = {
  number: "6b9000000000000000000001", lead: "6b9000000000000000000002", edge: "6b9000000000000000000003",
  call1: "6b9000000000000000000011", call2: "6b9000000000000000000012", call3: "6b9000000000000000000013",
  conv1: "6b9000000000000000000021", conv2: "6b9000000000000000000022", tx1: "6b9000000000000000000031", tx2: "6b9000000000000000000032",
  agent: "6b9000000000000000000041", link: "6b9000000000000000000042",
  obs1: "6b9000000000000000000051", obs2: "6b9000000000000000000052", obs3: "6b9000000000000000000053",
  change1: "6b9000000000000000000061", message: "6b9000000000000000000071", job1: "6b9000000000000000000081", job2: "6b9000000000000000000082",
};
const T = {
  received: "2026-09-15T22:30:00.000Z", message: "2026-09-15T22:31:00.000Z", call1: "2026-09-17T14:04:00.000Z", obs1: "2026-09-17T15:20:00.000Z",
  attempt: "2026-09-18T15:00:00.000Z", call2: "2026-09-21T19:40:00.000Z", obs2: "2026-09-22T19:02:00.000Z", obs3: "2026-09-22T21:00:00.000Z",
  sync: "2026-09-30T00:00:00.000Z",
};
const FAKE_NOW = "2026-09-23T20:10:00.000Z";

async function capture(suffix: string, out: string, caseFile: boolean) {
  const database = `testvantagemovers_t4bk9${suffix}`;
  if (!/^testvantagemovers_[a-z0-9]+$/.test(database)) throw new Error(`refusing database ${database}`);
  Object.assign(process.env, {
    CSI_REPLICA_TEST: "true", TEST_MODE: "true", TEST_MONGO_DATABASE_NAME: database, MONGO_URI: REPLICA, MONGODB_URI: REPLICA,
    SALES_INTELLIGENCE_DEPLOYMENT_ID: "csi-local-proof", SHEET_SYNC_MODE: "disabled", SALES_INTELLIGENCE_ENABLED: "true",
    SALES_INTELLIGENCE_EXTRACTION_ENABLED: "true", SALES_INTELLIGENCE_OUTREACH_ENSURE: "true", SALES_INTELLIGENCE_ANALYSIS_V3: "true",
    SALES_INTELLIGENCE_MOVE_ASSESSMENT: "false", SALES_INTELLIGENCE_LEAD_PROGRESS: "false", SALES_INTELLIGENCE_CASE_FILE: caseFile ? "true" : "false",
    SALES_INTELLIGENCE_SCOPED_KEY_NAME: "synthetic-intelligence", SALES_INTELLIGENCE_RUN_TOKEN_SECRET: "synthetic-intelligence-run-signature",
    AI_GATEWAY_API_KEY: "", OPENAI_API_KEY: "", RINGCENTRAL_ACCOUNT_ID: "",
  });
  globalThis.fetch = (async () => { throw new Error("External traffic forbidden in the K9 capture"); }) as typeof fetch;
  // A fixed clock (Wed Sep 23, 2026 4:10 PM ET) that still advances in real time, installed before any module
  // loads, so the relative day counts and every "now"-derived value are the same on every capture day.
  const RealDate = Date, offset = Date.parse(FAKE_NOW) - RealDate.now();
  const shiftedNow = () => RealDate.now() + offset;
  globalThis.Date = new Proxy(RealDate, {
    construct: (target, args) => (args.length ? new target(...(args as [number])) : new target(shiftedNow())),
    apply: () => new RealDate(shiftedNow()).toString(),
    get: (target, prop, receiver) => (prop === "now" ? shiftedNow : Reflect.get(target, prop, receiver)),
  });
  const mongoose = (await import("mongoose")).default;
  const { connectMongo, withTransaction } = await import("../../src/db");
  const { getMongoDatabaseName } = await import("../../src/config/domain/runtime");
  const { csiDataset } = await import("../../src/config/domain/salesIntelligence");
  const { applyCsiMigration } = await import("../migrations/sales-intelligence.lib");
  const { initializeCsiBudgetPeriod } = await import("../../src/services/salesIntelligence/aiBudget");
  const { enqueueCsiJob } = await import("../../src/services/salesIntelligence/jobs");
  const { runIntelligenceJob } = await import("../../src/services/salesIntelligence/analysis/worker");
  const { runIntelligenceApplicationJob } = await import("../../src/services/salesIntelligence/analysis/apply");
  const { scheduleNumberIntelligence } = await import("../../src/services/salesIntelligence/analysis/scheduling");
  const { DEFAULT_RUNTIME_LIMITS } = await import("../../src/services/salesIntelligence/analysis/runtime");
  const { ensureLead, workerContext } = await import("../../src/services/salesIntelligence/outreach/ensure");
  const { payloadHash } = await import("../../src/services/salesIntelligence/transactions");
  const { getIntelligenceSubmissionModel } = await import("../../src/models/IntelligenceSubmission");
  const { getSalesIntelligenceJobModel } = await import("../../src/models/SalesIntelligenceJob");
  const { getIntelligenceRunModel } = await import("../../src/models/IntelligenceRun");
  const { getSalesIntelligenceSyncStateModel } = await import("../../src/models/SalesIntelligenceSyncState");
  const { minimalFindingsSchema, summaryGenerationSchema } = await import("../../src/services/salesIntelligence/analysis/structuredContract");
  const { intelligenceSchemaDigest } = await import("../../src/services/salesIntelligence/analysis/schemaArtifact");
  const prompts = await import("../../src/services/salesIntelligence/analysis/structuredPrompt");
  const { z } = await import("zod");
  const { MockLanguageModelV4 } = await import("ai/test");

  await connectMongo();
  if (getMongoDatabaseName() !== database) throw new Error("wrong database");
  const db = mongoose.connection.useDb(database, { useCache: true }).db!;
  if ((await db.admin().command({ hello: 1 })).setName !== "csi01") throw new Error("not the csi01 replica");
  await db.dropDatabase();
  try {
    if (!(await applyCsiMigration()).ready) throw new Error("CSI migration not ready");
    const now = new Date(), month = now.toISOString().slice(0, 7);
    await initializeCsiBudgetPeriod({ month, policy_version: "csi-policy-v1", timezone: "UTC", ceiling_cents: 8000,
      period_start: new Date(`${month}-01T00:00:00Z`), period_end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) });
    await getSalesIntelligenceSyncStateModel().create({ scope: "call_log_all_directions", known_complete_through: new Date(T.sync), gaps: [] });
    const O = (hex: string) => new mongoose.Types.ObjectId(hex), at = (iso: string) => new Date(iso);
    const plus = (iso: string, ms: number) => new Date(Date.parse(iso) + ms);
    const dataset = csiDataset();
    const e164 = "+17575550143", ten = "7575550143";
    await db.collection("agents").insertOne({ _id: O(FIXED.agent), name: "Jordan Bell", normalized_name: "jordan bell", active: true, role: "agent", created_from: "booked_lead" });
    await db.collection("contact_numbers").insertOne({ _id: O(FIXED.number), e164, national_ten: ten, digits_reversed: ten.split("").reverse().join(""), kind: "external",
      classification: "customer", first_observed_at: at(T.received), last_activity_at: at(T.call2), provider_names: ["M LOPEZ"], revision: 1,
      contact_eligibility: { state: "eligible", reasons: [], decided_at: at(T.received) }, purged_at: null, content_purge_pending: false, createdAt: at(T.received), updatedAt: at(T.call2) });
    await db.collection("form_leads").insertOne({ _id: O(FIXED.lead), name: "Maria Lopez", timestamp: at(T.received), createdAt: plus(T.received, 20_000), updatedAt: plus(T.received, 20_000),
      phone_number: "(757) 555-0143", normalized_phone_number: ten, source_company: "Top10", source_company_label_snapshot: "Top10 Movers", job_no: "84521", normalized_job_no: "84521",
      quoted: true, granot_priority: "1", domain_revision: 2, cpl: 0, pickup_city: "Norfolk", pickup_state: "VA", pickup_zip: "23510", delivery_city: "Raleigh", delivery_state: "NC",
      destination_zip: "27601", move_size: "2 Bedrooms", move_date: at("2026-10-10T00:00:00.000Z"), post_to_granot: true, ingestion_origin: "wordpress_form",
      receiver_agent: O(FIXED.agent), receiver_agent_name_snapshot: "Jordan Bell", receiver_agent_source: "granot_username_match", receiver_agent_set_at: at(T.obs1),
      ingested_move_snapshot: { pickup_city: "Norfolk", pickup_state: "VA", pickup_zip: "23510", delivery_city: "Raleigh", delivery_state: "NC", destination_zip: "27601",
        move_size: "2 Bedrooms", move_date: at("2026-10-10T00:00:00.000Z"), captured_at: at(T.received), evidence_status: "captured_at_ingestion" } });
    await db.collection("number_lead_attachments").insertOne({ _id: O(FIXED.edge), contact_number_id: O(FIXED.number), lead_ref: { model: "FormLead", id: O(FIXED.lead) }, state: "attached",
      certainty: "exact", revision: 1, evidence: [{ source: "lead_phone_live", field_path: "form_leads.normalized_phone_number", observed_at: at(T.received),
        window_from: at(T.received), window_to: at("2027-01-01T00:00:00.000Z") }],
      lead_snapshot: { name: "Maria Lopez", job_no: "84521", lead_timestamp: at(T.received), refreshed_at: at(T.received) }, decided_by: "automatic",
      auto_decision: { confidence: 0.97, reason: "sole phone match", decided_at: plus(T.received, 300_000) },
      history: [{ from: "candidate", to: "attached", at: plus(T.received, 300_000), by: "automatic", reason: "sole phone match" }], createdAt: at(T.received), updatedAt: plus(T.received, 300_000) });
    await db.collection("rep_identity_links").insertOne({ _id: O(FIXED.link), revision: 1, agent_id: O(FIXED.agent), agent_name_snapshot: "Jordan Bell", rc_account_id: "synthetic-account",
      rc_extension_id: "104", rc_extension_number: "104", rc_extension_name_snapshot: "Jordan Bell", rc_direct_numbers: [], role_kind: "sales_rep", status: "reviewed",
      effective_from: at("2026-01-01T00:00:00.000Z"), effective_to: null, reviewed_by: "owner@example.test", reviewed_at: at("2026-01-01T00:00:00.000Z"), history: [] });
    const call = (id: string, iso: string, direction: "Inbound" | "Outbound", human: boolean, extension: string, conv: string | null, duration: number) => ({
      _id: O(id), provider: "ringcentral", provider_account_id: "synthetic-account", telephony_session_id: `k9-${id}`, identity_basis: "telephony_session_id", direction,
      contact_number_id: O(FIXED.number), external_e164: e164, external_endpoint_kind: "external", company_e164: "+18885550100", started_at: at(iso),
      answered_at: human ? plus(iso, 8_000) : null, ended_at: plus(iso, duration * 1000), duration_seconds: duration, provider_result: human ? "Call connected" : "No Answer",
      provider_connected: human, contact_type: human ? "human_conversation" : "unknown", contact_type_basis: human ? "transcript:v1" : null,
      parties: [{ role: "external", direction, e164, phone_number_raw: e164, name_raw: "M LOPEZ", connected: human },
        { role: "user", direction, extension_id: extension, extension_number: extension, connected: human }],
      legs: [], legs_overflow_count: 0, connected_user_extension_ids: human ? [extension] : [], queue_fanout: false, transfer: false, monitoring: false,
      recordings: conv ? [{ provider_recording_id: `rec-${id}`, recording_type: "Automatic", observed_at: plus(iso, 60_000), lead_conversation_id: O(conv) }] : [],
      sources: ["webhook"], terminal: true, projection_revision: 1, first_observed_at: plus(iso, 40_000), last_observed_at: plus(iso, 3_600_000), merged_into_id: null, purged_at: null,
      createdAt: plus(iso, 40_000), updatedAt: plus(iso, 3_600_000) });
    await db.collection("call_interactions").insertMany([call(FIXED.call1, T.call1, "Outbound", true, "104", FIXED.conv1, 252),
      call(FIXED.call3, T.attempt, "Outbound", false, "104", null, 30), call(FIXED.call2, T.call2, "Inbound", true, "118", FIXED.conv2, 362)]);
    const segments = (lines: Array<["rep" | "customer", string]>) => lines.map(([speaker, text], i) => ({ sid: i + 1, start_ms: i * 5000, end_ms: i * 5000 + 4000, timing_source: "provider", speaker, text }));
    const lines1 = segments([["rep", "This is Jordan with Vantage Movers."], ["customer", "We are moving from Norfolk to Raleigh around October tenth."],
      ["rep", "I will email the estimate today and call you back Monday after five."], ["customer", "My husband decides, so Monday works."]]);
    const lines2 = segments([["customer", "I am calling back about the estimate."], ["rep", "The estimate is six thousand six hundred."], ["customer", "That is still more than the other quote."]]);
    for (const [conv, callId, iso, tx, segs, direction] of [[FIXED.conv1, FIXED.call1, T.call1, FIXED.tx1, lines1, "Outbound"], [FIXED.conv2, FIXED.call2, T.call2, FIXED.tx2, lines2, "Inbound"]] as const) {
      await db.collection("lead_conversations").insertOne({ _id: O(conv), provider: "ringcentral", provider_account_id: "synthetic-account", provider_recording_id: `rec-${callId}`,
        call_interaction_id: O(callId), contact_number_id: O(FIXED.number), contact_type: "human_conversation", contact_type_basis: "transcript:v1", started_at: at(iso),
        duration_seconds: direction === "Outbound" ? 252 : 362, direction, rc_result: "Call connected", lead_ref: { model: "FormLead", id: O(FIXED.lead) },
        match_method: "call_interaction_number_candidate", match_confidence: "medium", state: "transcribed", latest_transcript_version: `k9-tv-${conv}`, media_digest_sha256: "b".repeat(64),
        media: null, transcript: null, summary: null, latest_completed_run_id: null, content_purged_at: null, attempts: 0,
        analysis_eligibility: { eligible: true, status: "eligible", missing_inputs: [], scope: "lead", reasons: [], decided_at: plus(iso, 3_600_000), policy_version: "csi-policy-v1" },
        createdAt: plus(iso, 90_000), updatedAt: plus(iso, 7_200_000) });
      await db.collection("intelligence_evidence_snapshots").insertOne({ _id: O(tx), ...dataset, conversation_id: O(conv), transcript_version: `k9-tv-${conv}`, source_type: "transcript",
        source_id: conv, source_revision: "b".repeat(64), arguments: {}, response: {}, retrieved_at: plus(iso, 3_600_000), happened_at: at(iso), content_digest: payloadHash(segs),
        subject_key: `conversation:${conv}`, completeness: { complete: true, missing_ranges: [] }, segments: segs, purged_at: null, purge_started_at: null,
        run_id: null, artifact_key: null, tool_name: null, tool_call_id: null, createdAt: plus(iso, 3_600_000), updatedAt: plus(iso, 3_600_000) });
    }
    const obs = (id: string, iso: string, priority: string, money: Record<string, unknown>) => ({ _id: O(id), receipt_id: new mongoose.Types.ObjectId(id.replace(/^6b9/, "6ba")), schema_version: 1,
      kind: "lead_snapshot", normalization_result: "valid", normalized_source_label: "top10", captured_at: at(iso), identity: { job_no_raw: "84521", normalized_job_no: "84521" },
      contact: { normalized_phone: ten }, move: { move_date: at("2026-10-12T00:00:00.000Z"), move_date_raw: "10/12/2026", service_type_raw: "Long distance", estimated_cubic_feet: 540 },
      priority: { raw: priority, canonical: priority, valid: true }, booking_action: {}, display_money: money, agent_identity: { rep_raw: "JBELL", user_raw: "JBELL" },
      provider_context: {}, issues: [], createdAt: plus(iso, 5_000), updatedAt: plus(iso, 5_000) });
    await db.collection("granot_observations").insertMany([obs(FIXED.obs1, T.obs1, "1", { estimate: { raw: "7100.00", canonical: "7100.00" } }),
      obs(FIXED.obs2, T.obs2, "1", { estimate: { raw: "6600.00", canonical: "6600.00" } }), obs(FIXED.obs3, T.obs3, "1", {})]);
    await db.collection("entity_changes").insertOne({ _id: O(FIXED.change1), entity: { model: "FormLead", id: FIXED.lead }, command_execution_id: O(FIXED.change1), command_name: "granot.observe_lead",
      provenance: { source_system: "granot", observation_channel: "granot_webhook", observation_id: O(FIXED.obs1), actor: { actor_type: "system", actor_id: "granot-lifecycle" } },
      changed_paths: ["granot_priority", "quoted"], fields: [{ path: "granot_priority", value_mode: "stored", before: "0", after: "1" }, { path: "quoted", value_mode: "stored", before: false, after: true }],
      revision_before: 0, revision_after: 1, applied_at: plus(T.obs1, 60_000) });
    await db.collection("lead_messages").insertOne({ _id: O(FIXED.message), lead_ref: { model: "FormLead", id: O(FIXED.lead) }, origin: "public_form", provider: "twilio", channel: "sms",
      purpose: "quote_request_confirmation", message_key: `k9:${FIXED.message}`, template_version: 1, to: e164, from: "+15615550199", body: "Thanks.", dispatch_mode: "inline", status: "delivered",
      attempt_count: 1, manual_retry_count: 0, sent_at: at(T.message), delivered_at: plus(T.message, 15_000), attempts: [], createdAt: at(T.message), updatedAt: plus(T.message, 15_000) });
    await withTransaction(session => ensureLead({ model: "FormLead", id: FIXED.lead }, workerContext(session, FIXED.job1, at(T.received)), FIXED.number));

    const captured: Array<{ step: string; text: string }> = [];
    const summary = { overview: "Customer is moving from Norfolk to Raleigh and waits for an estimate.", customer_wanted: "A written estimate.", money_and_dates: "Around October 10.",
      outcome: "Rep will email the estimate.", commitments: "Rep promised to call back Monday after 5 PM.", discrepancies: "" };
    const said = [{ kind: "promised_callback", claim: "Rep promised to call back Monday after 5 PM.", value: { action_kind: "call", description: "Call back Monday after 5 PM",
      date_text: "Monday after 5 PM", timezone_text: null, target_followup_id: null }, actor: "rep", clarity: "clear", action_status: "promised", speaker: "rep", segment_ids: [3], quote: null },
    { kind: "intent", claim: "Customer is planning a move.", value: { intent: "moving_inquiry" }, actor: "customer", clarity: "clear", action_status: null, speaker: "customer", segment_ids: [1], quote: null }];
    // The legacy layout numbers only this run's calls (C0 = the call); the Case File numbers every summarized call by time,
    // so the stub cites the first call whose segments are available (a deterministic choice in both layouts).
    const citedCall = (serialized: string) => {
      const match = /\\?"call_index\\?":(\d+),\\?"segments_available\\?":true/.exec(serialized);
      return match ? Number(match[1]) : 0;
    };
    const model = new MockLanguageModelV4({ doGenerate: async input => {
      const text = JSON.stringify(input.prompt);
      const isSummary = text.includes("Summarize one redacted moving-sales conversation");
      captured.push({ step: isSummary ? "summary" : "findings", text });
      console.error(`k9: provider request ${captured.length} (${isSummary ? "summary" : "findings"})`);
      const object = isSummary ? { summary, said_on_call: said, move_evidence: { observations: [], inventory: [], intent_signals: [] } }
        : { summary, findings: [{ kind: "intent", claim: "Customer is planning a move.", value: { intent: "moving_inquiry" }, actor: "customer", clarity: "clear", action_status: null,
          basis: "said_on_call", evidence: [{ source: "transcript", call_index: citedCall(text), segment_ids: [1], quote: null }] }], next_step: null, owner_instruction_assessments: [],
        prior_finding_relations: [], story_discrepancies: [] };
      return { content: [{ type: "text", text: JSON.stringify(object) }], finishReason: { unified: "stop", raw: "synthetic" },
        usage: { inputTokens: { total: 120, noCache: 120, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 40, text: 30, reasoning: 10 } }, warnings: [],
        providerMetadata: { gateway: { cost: 0.001 } } };
    } });
    const deps = { model, configuration: { endpoint: "", key: "", model_id: "openai/gpt-5-mini",
      pricing: { version: "synthetic", input_cents_per_million: 1, output_cents_per_million: 1 }, limits: DEFAULT_RUNTIME_LIMITS },
    publish: async () => {}, onError: (error: unknown) => { console.error(error); } } as Parameters<typeof runIntelligenceJob>[2];
    const apply = async (jobId: string) => {
      const run = await getIntelligenceRunModel().findOne({ job_id: jobId }).orFail();
      const receipt = await getIntelligenceSubmissionModel().findOne({ run_id: run._id }).orFail();
      const result = await runIntelligenceApplicationJob(String(receipt.application_job_id));
      if (result.status !== "completed") throw new Error(`application ${JSON.stringify(result)}`);
    };
    for (const [conv, tx, jobHex] of [[FIXED.conv1, FIXED.tx1, FIXED.job1], [FIXED.conv2, FIXED.tx2, FIXED.job2]] as const) {
      const job = await withTransaction(session => enqueueCsiJob({ stage: "analysis", subject_key: `conversation:${conv}`, input_revision: 1,
        dedupe_key: `k9:${jobHex}`, input_refs: [conv, tx] }, session));
      console.error(`k9: conversation run ${conv}`);
      const result = await runIntelligenceJob(String(job._id), "analysis", deps);
      if (result.status !== "submitted") throw new Error(`conversation run ${conv}: ${JSON.stringify(result)}`);
      await apply(String(job._id));
    }
    const numberJob = await withTransaction(session => scheduleNumberIntelligence(FIXED.number, session));
    if (!numberJob) throw new Error("no number job");
    await getSalesIntelligenceJobModel().updateOne({ _id: numberJob }, { $set: { next_attempt_at: new Date() } });
    const numberResult = await runIntelligenceJob(numberJob, "number_refresh", deps);
    if (numberResult.status !== "submitted") throw new Error(`number run: ${JSON.stringify(numberResult)}`);

    const fixedIds = new Set(Object.values(FIXED)), fixedTimes = new Set(Object.values(T));
    const ids = new Map<string, string>(), times = new Map<string, string>();
    const normalize = (text: string) => text
      .replace(/\b[a-f0-9]{24}\b/g, id => fixedIds.has(id) ? id : (ids.get(id) ?? (ids.set(id, `<OID:${ids.size}>`), ids.get(id)!)))
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/g, iso => fixedTimes.has(iso) ? iso : (times.get(iso) ?? (times.set(iso, `<T:${times.size}>`), times.get(iso)!)));
    const stepContracts = (prompts as { structuredStepContracts: () => { findings: { schema_digest: string; prompt_version: string } } }).structuredStepContracts();
    const digests: Record<string, string> = {
      minimal_findings_schema: payloadHash(z.toJSONSchema(minimalFindingsSchema)), summary_generation_schema: payloadHash(z.toJSONSchema(summaryGenerationSchema)),
      intelligence_envelope_schema: intelligenceSchemaDigest(), step_contract_findings_schema: stepContracts.findings.schema_digest,
      "info:step_contracts": payloadHash(stepContracts), "info:findings_prompt_version": stepContracts.findings.prompt_version,
    };
    writeFileSync(out, JSON.stringify({ database, case_file: caseFile, prompts: captured.map(p => ({ step: p.step, text: normalize(p.text) })), digests }, null, 1));
    console.log(`captured ${captured.length} provider requests (${captured.map(p => p.step).join(", ")}) from ${database} → ${out}`);
  } finally {
    await db.dropDatabase();
    await mongoose.disconnect();
  }
}

const compareIndex = process.argv.indexOf("--compare");
if (compareIndex >= 0) compare(process.argv[compareIndex + 1]!, process.argv[compareIndex + 2]!);
else if (process.argv.includes("--child")) capture(arg("--db") ?? "", arg("--out") ?? "k9.json", process.argv.includes("--case-file")).catch(error => { console.error(error); process.exitCode = 1; });
else {
  // A fresh child with a clean environment: no provider keys and no flags inherited from the shell.
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/RINGCENTRAL|BLOB|GATEWAY|OPENAI|VERCEL|KV_REST|SALES_INTELLIGENCE/.test(key)) delete env[key];
  const child = spawnSync(process.execPath, ["--import", "tsx", "--import", "./scripts/test-setup.ts", process.argv[1]!, ...process.argv.slice(2), "--child"], { stdio: "inherit", env });
  process.exitCode = child.status ?? 1;
}
