/**
 * S0-SEED: the Sales Intelligence final-UI seed on the local csi01 replica only.
 *
 *   node --import tsx scripts/dev_ops/seed-csi-final-ui.ts
 *
 * Drops and rebuilds `testvantagemovers_finalui` (refuses any other name; the URI is hard-coded to
 * loopback). Builds the full CSI index inventory first, writes synthetic source documents (fake
 * names, 555 numbers) through the real models and writers, stores model outputs as documents
 * (analysis runs, findings, effects) or runs the real Move assessment runtime against a mocked,
 * deterministic model (no network, no paid call), then derives every projection with the real code:
 * the Number rebuild job for every Number, the assessment publish, and finally
 * `publishAttentionSnapshot()`. Times are relative to `Date.now()` at seed time.
 *
 * Every subject gets a stable label in `si_seed_manifest` (label, states, ids), which the contract
 * capture reads. `assert-si-seed-states.ts` checks every state against the source collections.
 *
 * Attention flag (CF-PREP, 2026-09-23). The final publish uses `SALES_INTELLIGENCE_ATTENTION_V2` off
 * unless `--attention-v2` is passed (closed partition, header metrics, index). To switch an existing
 * seed between the two contract-capture modes without rebuilding it:
 *
 *   node --import tsx scripts/dev_ops/seed-csi-final-ui.ts --publish-attention on    # flag-on snapshot
 *   node --import tsx scripts/dev_ops/seed-csi-final-ui.ts --publish-attention off   # flag-off snapshot
 *
 * That mode only publishes a new Attention snapshot of `testvantagemovers_finalui` (the manifest must
 * exist) and writes nothing else; the newest published snapshot is the one `GET /attention` reads.
 *
 * SEED-FIX (2026-09-23): `S-findings`' relations (five kinds) and story discrepancy moved onto R3, the Number's newest run
 * (`newest_run_id`), with the real `applyPriorRelations` bookkeeping; R3 also assesses three Owner instructions. New subject
 * `S-suggestion-open` (no follow-up, newest Number run with an unapplied suggestion and no relations). Rep Identity Links:
 * extension 101 reviewed (Dana Reyes), 103 proposed only, 102 none.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import mongoose from "mongoose";
import { SI_CONTRACTS_DIR, SI_SEED_DATABASE, SI_SEED_DEPLOYMENT, SI_SEED_MANIFEST, SI_SEED_REPLICA, assertSeedDatabase,
  type SiManifestRow, type SiSeedState } from "./lib/si-contract-common";

const DATABASE = process.env.SI_SEED_DATABASE ?? SI_SEED_DATABASE;
assertSeedDatabase(DATABASE);
const ARGS = process.argv.slice(2);
const PUBLISH_ONLY = (() => {
  const i = ARGS.indexOf("--publish-attention");
  if (i < 0) return null;
  const value = ARGS[i + 1];
  if (value !== "on" && value !== "off") throw new Error("--publish-attention on|off");
  return value;
})();
/** ATTENTION_V2 for the snapshot this run publishes. */
const ATTENTION_V2 = PUBLISH_ONLY ? PUBLISH_ONLY === "on" : ARGS.includes("--attention-v2");
Object.assign(process.env, {
  CSI_REPLICA_TEST: "true", TEST_MODE: "true", TEST_MONGO_DATABASE_NAME: DATABASE, MONGO_URI: SI_SEED_REPLICA, MONGODB_URI: SI_SEED_REPLICA,
  SALES_INTELLIGENCE_DEPLOYMENT_ID: SI_SEED_DEPLOYMENT, SHEET_SYNC_MODE: "disabled",
  SALES_INTELLIGENCE_ENABLED: "true", SALES_INTELLIGENCE_MOVE_ASSESSMENT: "true", SALES_INTELLIGENCE_EXTRACTION_ENABLED: "false",
  SALES_INTELLIGENCE_CAPTURE_CALL_LOG: "false", SALES_INTELLIGENCE_CAPTURE_WEBHOOK: "false", SALES_INTELLIGENCE_DIRECTORY_SYNC: "false",
  SALES_INTELLIGENCE_MEDIA_ENABLED: "false", SALES_INTELLIGENCE_STT_ENABLED: "false", SALES_INTELLIGENCE_ATTACHMENT_REFRESH: "false",
  SALES_INTELLIGENCE_OUTREACH_ENSURE: "true", SALES_INTELLIGENCE_AUTO_ATTACH: "false", SALES_INTELLIGENCE_LEAD_PROGRESS: "true",
  SALES_INTELLIGENCE_ATTENTION_V2: ATTENTION_V2 ? "true" : "false", SALES_INTELLIGENCE_TIMELINE_V2: "false",
  SALES_INTELLIGENCE_ANALYSIS_PRICING_VERSION: "synthetic", SALES_INTELLIGENCE_ANALYSIS_INPUT_CENTS_PER_MILLION: "1",
  SALES_INTELLIGENCE_ANALYSIS_OUTPUT_CENTS_PER_MILLION: "1", SALES_INTELLIGENCE_EXTRACTION_MODEL: "openai/gpt-5-mini",
  // Empty, not absent: a transitive dotenv/config import must not refill provider credentials from .env.
  AI_GATEWAY_API_KEY: "", PERSONAL_AI_GATEWAY_API_KEY: "", VERCEL_OIDC_TOKEN: "", OPENAI_API_KEY: "", SALES_INTELLIGENCE_MCP_ENDPOINT: "",
  RINGCENTRAL_ACCOUNT_ID: "", CRON_SECRET: "synthetic-cron-secret", VANTAGE_API_SECRET: "synthetic-global",
  // In-process only: signs the synthetic Owner actor the seed uses for real Owner commands (close, retract, apply suggestion).
  VANTAGE_ADMIN_PROXY_SIGNING_SECRET: "synthetic-owner-signature-for-the-seed-process",
});

// ── deterministic helpers ─────────────────────────────────────────────────────────────────────
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rand = mulberry32(20260923);
const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)]!;
const HOUR = 3_600_000, DAY = 24 * HOUR;
const NOW = Date.now();
const ago = (days: number, hours = 0) => new Date(NOW - days * DAY - hours * HOUR);
const ahead = (days: number, hours = 0) => new Date(NOW + days * DAY + hours * HOUR);
const plus = (at: Date, ms: number) => new Date(+at + ms);
const etDay = (at: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
const utcMidnight = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const O = (id?: string) => (id ? new mongoose.Types.ObjectId(id) : new mongoose.Types.ObjectId());
const FIRST = ["Maria", "James", "Priya", "Derek", "Alicia", "Tom", "Keisha", "Victor", "Hannah", "Omar", "Lena", "Carlos", "Grace", "Ivan", "Nora", "Felix", "Rosa", "Sam"];
const LAST = ["Lopez", "Carter", "Nair", "Whitfield", "Moreno", "Baxter", "Owens", "Hale", "Sato", "Reyes", "Klein", "Duarte", "Pham", "Brandt", "Quinn", "Ellis"];
const CITIES = [["Tampa", "FL"], ["Orlando", "FL"], ["Miami", "FL"], ["Atlanta", "GA"], ["Charlotte", "NC"], ["Austin", "TX"], ["Denver", "CO"], ["Phoenix", "AZ"],
  ["Nashville", "TN"], ["Raleigh", "NC"], ["Boston", "MA"], ["Chicago", "IL"], ["Seattle", "WA"], ["Portland", "OR"]] as const;
const AREAS = ["305", "407", "813", "404", "617", "702", "512", "303", "615", "919", "206", "503"];
let numberSerial = 0, jobSerial = 5_590_000, keySerial = 0;
const fakeName = () => `${pick(FIRST)} ${pick(LAST)}`;
const nextJob = () => String(++jobSerial);

/** `--publish-attention on|off`: republish the Attention snapshot of an existing seed; nothing else is written. */
async function republishAttention() {
  globalThis.fetch = (async () => { throw new Error("External traffic forbidden in the final-UI seed"); }) as typeof fetch;
  const { connectMongo } = await import("../../src/db");
  const { getMongoDatabaseName } = await import("../../src/config/domain/runtime");
  const { publishAttentionSnapshot } = await import("../../src/services/salesIntelligence/outreach/attention");
  await connectMongo();
  if (getMongoDatabaseName() !== DATABASE) throw new Error("wrong database");
  const db = mongoose.connection.useDb(DATABASE, { useCache: true }).db!;
  if ((await db.admin().command({ hello: 1 })).setName !== "csi01") throw new Error("not the csi01 replica");
  if (!(await db.collection(SI_SEED_MANIFEST).countDocuments({}))) throw new Error(`no ${SI_SEED_MANIFEST} in ${DATABASE}: run the full seed first`);
  const snapshot = await publishAttentionSnapshot({ attentionV2: ATTENTION_V2 });
  if (snapshot.status !== "published") throw new Error(`attention publish: ${JSON.stringify(snapshot)}`);
  console.log(`Attention snapshot republished on ${DATABASE} with ATTENTION_V2 ${ATTENTION_V2 ? "on" : "off"}: ${JSON.stringify(snapshot)}`);
  await mongoose.disconnect();
}

async function main() {
  globalThis.fetch = (async () => { throw new Error("External traffic forbidden in the final-UI seed"); }) as typeof fetch;
  const { connectMongo, withTransaction } = await import("../../src/db");
  const { getMongoDatabaseName } = await import("../../src/config/domain/runtime");
  const { csiDataset } = await import("../../src/config/domain/salesIntelligence");
  const { applyCsiMigration } = await import("../migrations/sales-intelligence.lib");
  const { initializeCsiBudgetPeriod } = await import("../../src/services/salesIntelligence/aiBudget");
  const { getContactNumberModel } = await import("../../src/models/ContactNumber");
  const { getCallInteractionModel } = await import("../../src/models/CallInteraction");
  const { getLeadConversationModel } = await import("../../src/models/LeadConversation");
  const { getIntelligenceEvidenceSnapshotModel } = await import("../../src/models/IntelligenceEvidenceSnapshot");
  const { getIntelligenceRunModel } = await import("../../src/models/IntelligenceRun");
  const { getIntelligenceFindingModel } = await import("../../src/models/IntelligenceFinding");
  const { getIntelligenceEffectModel } = await import("../../src/models/IntelligenceEffect");
  const { getOutreachRecordModel } = await import("../../src/models/OutreachRecord");
  const { getOutreachFollowupModel } = await import("../../src/models/OutreachFollowup");
  const { getNumberLeadAttachmentModel } = await import("../../src/models/NumberLeadAttachment");
  const { getEntityChangeModel } = await import("../../src/models/EntityChange");
  const { getGranotObservationModel } = await import("../../src/models/GranotObservation");
  const { getLeadMessageModel } = await import("../../src/models/LeadMessage");
  const { getMoveAssessmentArtifactModel } = await import("../../src/models/MoveAssessmentArtifact");
  const { getRepIdentityLinkModel } = await import("../../src/models/RepIdentityLink");
  const { getSalesIntelligenceOwnerInstructionModel } = await import("../../src/models/SalesIntelligenceOwnerInstruction");
  const { getIntelligenceOwnerAssessmentModel } = await import("../../src/models/IntelligenceOwnerAssessment");
  const { applyPriorRelations } = await import("../../src/services/salesIntelligence/analysis/relations");
  const { ensureLead, workerContext, latestProgressEvidence } = await import("../../src/services/salesIntelligence/outreach/ensure");
  const { ensureNumberReview } = await import("../../src/services/salesIntelligence/outreach/numberReview");
  const { recordForUpdate, refreshRecord, saveFollowup } = await import("../../src/services/salesIntelligence/outreach/store");
  const { projectLeadProgress } = await import("../../src/services/salesIntelligence/outreach/leadProgress");
  const { subjectKey } = await import("../../src/services/salesIntelligence/outreach/types");
  const { commandOutreach } = await import("../../src/services/salesIntelligence/followups/commands");
  const { commandAnalysis } = await import("../../src/services/salesIntelligence/analysis/ownerCommands");
  const { openReview } = await import("../../src/services/salesIntelligence/review/items");
  const { resolvePolicy } = await import("../../src/services/salesIntelligence/policy");
  const { enqueueCsiJob } = await import("../../src/services/salesIntelligence/jobs");
  const { drainRebuildJobs } = await import("../../src/services/numberActivity/rebuild");
  const { publishAttentionSnapshot } = await import("../../src/services/salesIntelligence/outreach/attention");
  const { payloadHash } = await import("../../src/services/salesIntelligence/transactions");
  const { requireCsiOwner } = await import("../../src/services/salesIntelligence/auth");
  const { computeAdminActorSignature } = await import("../../src/services/operationsRegistry/trustedActor");
  const { readContentSchema } = await import("../../src/services/salesIntelligence/analysis/reads");
  const { intelligenceEnvelopeSchema, intelligenceFindingSchema } = await import("../../src/validation/intelligence/intelligenceEnvelope.validation");
  const runtime = await import("../../src/services/salesIntelligence/assessment/runtime");
  const fx = await import("./csi-move-assessment-fixtures");

  const started = Date.now();
  await connectMongo();
  if (getMongoDatabaseName() !== DATABASE) throw new Error("wrong database");
  const conn = mongoose.connection.useDb(DATABASE, { useCache: true });
  const db = conn.db!;
  if ((await db.admin().command({ hello: 1 })).setName !== "csi01") throw new Error("not the csi01 replica");
  await db.dropDatabase();
  const migration = await applyCsiMigration();
  if (!migration.ready) throw new Error("CSI migration not ready");
  const month = new Date(NOW).toISOString().slice(0, 7);
  await initializeCsiBudgetPeriod({ month, policy_version: "csi-policy-v1", timezone: "UTC", ceiling_cents: 8000,
    period_start: new Date(`${month}-01T00:00:00Z`), period_end: new Date(Date.UTC(new Date(NOW).getUTCFullYear(), new Date(NOW).getUTCMonth() + 1, 1)) });
  const policy = await resolvePolicy();
  const dataset = csiDataset();

  // ── agents (fake reps) ────────────────────────────────────────────────────────────────────
  const agents = ["Dana Reyes", "Marcus Bell", "Tina Cho"].map(name => ({ _id: O(), name, normalized_name: name.toLowerCase(), active: true, role: "agent",
    created_from: "booked_lead", createdAt: ago(200), updatedAt: ago(200) }));
  await db.collection("agents").insertMany(agents);
  const agentId = (i: number) => String(agents[i]!._id);

  // ── Rep Identity Links (SEED-FIX): extension 101 reviewed → Dana Reyes, 103 proposed only, 102 none ─────────
  // Every call defaults to extension 101 on `synthetic-account`, so `rep.name` reads "Dana Reyes" (reviewed at the call time,
  // `repIdentity/resolve.ts`). S-calls-60 rotates its plain calls over 101 / 102 (no link → unknown) / 103 (proposed → name null).
  const REP_ACCOUNT = "synthetic-account";
  await getRepIdentityLinkModel().create([
    { agent_id: agents[0]!._id, agent_name_snapshot: agents[0]!.name, rc_account_id: REP_ACCOUNT, rc_extension_id: "101", rc_extension_number: "101",
      rc_extension_name_snapshot: "Dana Reyes", role_kind: "sales_rep", status: "reviewed", proposal_basis: "exact_full_name", effective_from: ago(400),
      reviewed_by: "owner@example.test", reviewed_at: ago(399), history: [{ at: ago(400), by: "system", change: "proposed" }, { at: ago(399), by: "owner@example.test", change: "reviewed" }] },
    { agent_id: agents[2]!._id, agent_name_snapshot: agents[2]!.name, rc_account_id: REP_ACCOUNT, rc_extension_id: "103", rc_extension_number: "103",
      rc_extension_name_snapshot: "T. Cho", role_kind: "sales_rep", status: "proposed", proposal_basis: "first_token", effective_from: ago(400),
      history: [{ at: ago(400), by: "system", change: "proposed" }] },
  ]);

  // ── manifest ──────────────────────────────────────────────────────────────────────────────
  const manifest: SiManifestRow[] = [];
  const row = (label: string, states: SiSeedState[], ids: Partial<SiManifestRow> & { note: string }) => {
    const entry: SiManifestRow = { label, kind: ids.outreach_record_id ? "outreach" : "number", states, outreach_record_id: ids.outreach_record_id ?? null,
      contact_number_id: ids.contact_number_id ?? null, lead_refs: ids.lead_refs ?? [], conversation_ids: ids.conversation_ids ?? [], run_ids: ids.run_ids ?? [],
      artifact_ids: ids.artifact_ids ?? [], finding_ids: ids.finding_ids ?? [], note: ids.note };
    manifest.push(entry);
    return entry;
  };

  // ── Owner actor (signed exactly like the admin proxy, in-process) ──────────────────────────
  const OWNER_ID = "5eed00000000000000000001";
  function ownerActor(path: string) {
    const timestamp = String(Date.now()), requestId = randomUUID(), email = "owner@example.test";
    const signature = computeAdminActorSignature({ adminId: OWNER_ID, email, role: "owner", timestamp, requestId, method: "POST", path },
      process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET!);
    const headers: Record<string, string> = { "x-vantage-admin-user-id": OWNER_ID, "x-vantage-admin-email": email, "x-vantage-admin-role": "owner",
      "x-vantage-admin-request-id": requestId, "x-vantage-admin-timestamp": timestamp, "x-vantage-admin-signature": signature };
    const req = { method: "POST", originalUrl: path, url: path, header: (name: string) => headers[name.toLowerCase()], vantageAuth: { kind: "secret" } };
    return requireCsiOwner(req as unknown as Parameters<typeof requireCsiOwner>[0]);
  }
  const ADMIN = "/api/v1/admin/sales-intelligence";

  // ── source-document writers ───────────────────────────────────────────────────────────────
  const Numbers = getContactNumberModel(), Calls = getCallInteractionModel(), Conversations = getLeadConversationModel();
  const Snapshots = getIntelligenceEvidenceSnapshotModel(), Runs = getIntelligenceRunModel(), Findings = getIntelligenceFindingModel();
  const Effects = getIntelligenceEffectModel(), Records = getOutreachRecordModel(), Followups = getOutreachFollowupModel();

  async function seedNumber(firstAt: Date) {
    const area = AREAS[numberSerial % AREAS.length]!;
    const ten = `${area}555${String(1000 + ++numberSerial).slice(-4)}`;
    const number = await Numbers.create({ e164: `+1${ten}`, national_ten: ten, digits_reversed: ten.split("").reverse().join(""),
      first_observed_at: firstAt, last_activity_at: firstAt, kind: "external", classification: "customer" });
    return { id: String(number._id), e164: `+1${ten}`, ten };
  }

  type LeadModel = "FormLead" | "CallLead";
  type LeadRef = { model: LeadModel; id: string };
  async function seedLead(model: LeadModel, ten: string, at: Date, fields: Record<string, unknown> = {}) {
    const _id = O(), name = String(fields.name ?? fakeName()), job = String(fields.job_no ?? nextJob());
    const [pickupCity, pickupState] = pick(CITIES), [deliveryCity, deliveryState] = pick(CITIES);
    const base = { _id, name, timestamp: at, createdAt: plus(at, 20_000), updatedAt: plus(at, 20_000), phone_number: `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`,
      normalized_phone_number: ten, source_company: "Top10", source_company_label_snapshot: pick(["Top10 Movers", "MoveBuddy", "Relo Compare"]), job_no: job,
      normalized_job_no: job, quoted: false, domain_revision: 0, cpl: 0, pickup_city: pickupCity, pickup_state: pickupState, delivery_city: deliveryCity,
      delivery_state: deliveryState, receiver_agent_name_snapshot: agents[0]!.name };
    const doc = model === "FormLead"
      ? { ...base, pickup_zip: "33601", destination_zip: "28202", move_size: "2 Bedroom", move_date: utcMidnight(etDay(ahead(30))), post_to_granot: true,
        ingestion_origin: "wordpress_form", ...fields }
      : { ...base, captured_at: at, delivery_zip: "28202", ringcentral: { telephony_session_id: `s-${_id}`, qualification_reason: "Answered inbound call over 60 seconds",
        start_time: at, original_caller: { captured_at: at } }, ...fields };
    await db.collection(model === "FormLead" ? "form_leads" : "call_leads").insertOne(doc);
    return { model, id: String(_id), job, name } as LeadRef & { job: string; name: string };
  }

  async function attach(numberId: string, lead: LeadRef & { name: string; job: string }, at: Date, certainty: "exact" | "likely" = "likely") {
    await getNumberLeadAttachmentModel().create({ contact_number_id: numberId, lead_ref: { model: lead.model, id: lead.id }, state: "attached", certainty,
      evidence: [{ source: lead.model === "CallLead" ? "call_lead_ringcentral_identity" : "lead_phone_live", field_path: `${lead.model === "CallLead" ? "call_leads" : "form_leads"}.normalized_phone_number`, observed_at: at }],
      lead_snapshot: { name: lead.name, job_no: lead.job, lead_timestamp: at, refreshed_at: at }, decided_by: "automatic",
      auto_decision: { confidence: 0.92, reason: "automatic_high_confidence", decided_at: plus(at, 5 * 60_000) },
      history: [{ from: "candidate", to: "attached", at: plus(at, 5 * 60_000), by: "automatic", reason: "automatic_high_confidence" }] });
  }

  /** The Outreach Record exactly as the Lead projection creates it (optionally closing it at `now`). */
  async function seedRecord(ref: LeadRef, numberId: string | null, now = new Date()) {
    const record = await withTransaction(session => ensureLead(ref, workerContext(session, String(O()), now), numberId ?? undefined));
    if (!record) throw new Error("ensureLead returned no record");
    return String(record._id);
  }

  type CallSpec = { at: Date; direction: "Inbound" | "Outbound"; result?: string; connected?: boolean; duration?: number; contact?: "unknown" | "voicemail" | "human_conversation";
    recording?: boolean; extension?: string; name?: string };
  function callDoc(numberId: string, e164: string, spec: CallSpec) {
    const key = `fui-${++keySerial}`;
    const connected = spec.connected ?? spec.result === "Call connected";
    return { provider: "ringcentral", provider_account_id: "synthetic-account", telephony_session_id: key, identity_basis: "telephony_session_id",
      direction: spec.direction, contact_number_id: new mongoose.Types.ObjectId(numberId), external_e164: e164, external_endpoint_kind: "external", company_e164: "+15615550100",
      started_at: spec.at, answered_at: connected ? plus(spec.at, 8_000) : null, ended_at: plus(spec.at, (spec.duration ?? 30) * 1000), duration_seconds: spec.duration ?? 30,
      provider_result: spec.result ?? "Call connected", provider_connected: connected, contact_type: spec.contact ?? "unknown",
      contact_type_basis: spec.contact === "voicemail" ? "provider:voicemail" : spec.contact === "human_conversation" ? "transcript:v1" : null,
      parties: [{ role: "external", direction: spec.direction, e164, phone_number_raw: e164, name_raw: spec.name ?? null, connected },
        { role: "user", direction: spec.direction, extension_id: spec.extension ?? "101", extension_number: spec.extension ?? "101", connected }],
      legs: [], legs_overflow_count: 0, connected_user_extension_ids: connected ? [spec.extension ?? "101"] : [], queue_fanout: false, transfer: false, monitoring: false,
      recordings: spec.recording ? [{ provider_recording_id: `rec-${key}`, recording_type: "Automatic", observed_at: plus(spec.at, 60_000), lead_conversation_id: null }] : [],
      sources: ["webhook"], terminal: true, projection_revision: 1, first_observed_at: plus(spec.at, spec.direction === "Inbound" ? 40_000 : 2 * HOUR),
      last_observed_at: plus(spec.at, 3 * HOUR), merged_into_id: null, purged_at: null, createdAt: plus(spec.at, 40_000), updatedAt: plus(spec.at, 3 * HOUR) };
  }
  async function seedCalls(numberId: string, e164: string, specs: CallSpec[]) {
    if (!specs.length) return [];
    const docs = specs.map(spec => callDoc(numberId, e164, spec));
    const result = await Calls.collection.insertMany(docs as never[]);
    return Object.values(result.insertedIds).map(String);
  }

  type Segment = { sid: number; start_ms: number; end_ms: number; timing_source: "provider"; speaker: "rep" | "customer"; text: string };
  const transcriptFor = (lines: Array<["rep" | "customer", string]>): Segment[] => {
    let t = 0;
    return lines.map(([speaker, text], i) => { const len = 4000 + text.length * 55; const seg = { sid: i + 1, start_ms: t, end_ms: t + len, timing_source: "provider" as const, speaker, text }; t += len + 700; return seg; });
  };
  const defaultLines = (from: string, to: string, when: string): Array<["rep" | "customer", string]> => [
    ["rep", "Thanks for calling Vantage Movers, this is Dana. How can I help?"],
    ["customer", `Hi, we are moving from ${from} to ${to}, probably ${when}.`],
    ["rep", "Great. Roughly how big is the home, and anything heavy like a piano?"],
    ["customer", "It is a two bedroom apartment, a sofa, a king bed and a dining table."],
    ["rep", "I can put together an estimate and call you back Thursday morning."],
    ["customer", "Thursday works. We got another quote around four thousand dollars."],
  ];

  type SummaryText = { overview: string; customer_wanted: string; money_and_dates: string; outcome: string; commitments: string; discrepancies: string };
  type ConversationSpec = { call: CallSpec; lead?: LeadRef | null; lines?: Array<["rep" | "customer", string]>; summary?: SummaryText | null;
    said?: Array<Record<string, unknown>>; moveEvidence?: Record<string, unknown>; media?: "retained" | "purged" | null; state?: string };

  /** One Call Interaction with a recording, its Lead Conversation, a transcript snapshot and (unless `summary: null`) the step-1 summary snapshot. */
  async function seedConversation(number: { id: string; e164: string }, spec: ConversationSpec) {
    const doc = callDoc(number.id, number.e164, { ...spec.call, recording: true, contact: spec.call.contact ?? "human_conversation" });
    const callId = O();
    await Calls.collection.insertOne({ _id: callId, ...doc } as never);
    const version = `fui-tv-${keySerial}`;
    const at = spec.call.at;
    const convId = O();
    const media = spec.media === "retained" ? { blob_pathname: `conversations/${doc.recordings[0]!.provider_recording_id}.mp3`, blob_url: null, bytes: 482_113,
      content_type: "audio/mpeg", stored_at: plus(at, HOUR), purged_at: null }
      : spec.media === "purged" ? { blob_pathname: `conversations/${doc.recordings[0]!.provider_recording_id}.mp3`, blob_url: null, bytes: 391_022,
        content_type: "audio/mpeg", stored_at: plus(at, HOUR), purged_at: ago(1) } : null;
    await Conversations.collection.insertOne({ _id: convId, provider: "ringcentral", provider_account_id: "synthetic-account", provider_recording_id: doc.recordings[0]!.provider_recording_id,
      call_interaction_id: callId, contact_number_id: new mongoose.Types.ObjectId(number.id), contact_type: doc.contact_type, contact_type_basis: doc.contact_type_basis,
      started_at: at, duration_seconds: doc.duration_seconds, direction: doc.direction, rc_result: doc.provider_result,
      lead_ref: spec.lead ? { model: spec.lead.model, id: new mongoose.Types.ObjectId(spec.lead.id) } : null,
      match_method: spec.lead ? "call_interaction_number_candidate" : "number_only", match_confidence: spec.lead ? "medium" : "low",
      state: spec.state ?? "transcribed", latest_transcript_version: version, media_digest_sha256: "b".repeat(64), media, transcript: null, summary: null,
      latest_completed_run_id: null, content_purged_at: null, attempts: 0, receiver_agent_name_snapshot: agents[0]!.name,
      analysis_eligibility: { eligible: true, status: "eligible", missing_inputs: [], scope: spec.lead ? "lead" : "number", reasons: [], decided_at: plus(at, HOUR), policy_version: "csi-policy-v1" },
      createdAt: plus(at, 90_000), updatedAt: plus(at, 2 * HOUR) } as never);
    await Calls.collection.updateOne({ _id: callId }, { $set: { "recordings.0.lead_conversation_id": convId } });
    const segments = transcriptFor(spec.lines ?? defaultLines("Tampa", "Charlotte", "next month"));
    const transcript = await Snapshots.create({ ...dataset, conversation_id: convId, transcript_version: version, source_type: "transcript", source_id: String(convId),
      source_revision: "b".repeat(64), arguments: {}, response: {}, retrieved_at: plus(at, HOUR), happened_at: at, content_digest: payloadHash(segments),
      subject_key: `conversation:${convId}`, completeness: { complete: true, missing_ranges: [] }, segments });
    let summaryId: string | null = null, summaryDigest: string | null = null;
    if (spec.summary !== null) {
      const summary = spec.summary ?? { overview: "Customer asked for a moving estimate and compared prices.", customer_wanted: "A written estimate for a two bedroom move.",
        money_and_dates: "Another quote of about $4,000; moving next month.", outcome: "Rep will send an estimate.", commitments: "Rep promised a callback Thursday morning.",
        discrepancies: "" };
      const response = readContentSchema.parse({ page: { records: [], complete: true, next_cursor: null, missing_ranges: [] },
        coverage: { known_through: null, gaps: [], capabilities: { call_log: "unknown" }, ai_paused: false }, instructions: [], speaker_refs: [], allowed_followup_ids: [],
        transcript: { conversation_id: String(convId), transcript_version: version, source_snapshot_id: String(transcript._id), segments: [] },
        analysis_summary: { summary, said_on_call: spec.said ?? defaultSaid(), move_evidence: spec.moveEvidence ?? defaultMoveEvidence() } });
      const artifact = await Snapshots.create({ ...dataset, conversation_id: convId, source_type: "summary", artifact_key: payloadHash({ seed: "finalui", version, n: ++keySerial }),
        source_id: String(transcript._id), arguments: {}, response, retrieved_at: plus(at, HOUR + 60_000), happened_at: at, content_digest: payloadHash(response),
        subject_key: `conversation:${convId}`, completeness: { complete: true, missing_ranges: [] }, segments: [] });
      summaryId = String(artifact._id); summaryDigest = artifact.content_digest;
    }
    return { conversationId: String(convId), callId: String(callId), transcriptId: String(transcript._id), summaryId, summaryDigest, version, at, segments };
  }
  type SeededConversation = Awaited<ReturnType<typeof seedConversation>>;

  const defaultSaid = () => [
    { kind: "intent", claim: "Customer is planning a move next month.", value: { intent: "moving_inquiry" }, actor: "customer", clarity: "clear", action_status: null,
      speaker: "customer", segment_ids: [2], quote: null },
    { kind: "promised_callback", claim: "Rep promised to call back Thursday morning with an estimate.", value: { action_kind: "call", description: "Call back with the estimate",
      date_text: "Thursday morning", timezone_text: null, target_followup_id: null }, actor: "rep", clarity: "clear", action_status: "promised", speaker: "rep", segment_ids: [5], quote: null },
    { kind: "quoted_amount", claim: "Customer mentioned another quote of about $4,000.", value: { amount_text: "around four thousand dollars", currency: "USD", meaning: "competitor_quote" },
      actor: "customer", clarity: "clear", action_status: null, speaker: "customer", segment_ids: [6], quote: null },
  ];
  const defaultMoveEvidence = () => ({
    observations: [
      { field: "pickup_location", value: { line: null, city: "Tampa", state: "FL", zip: null, precision: "city" }, status: "stated", speaker: "customer", segment_ids: [2] },
      { field: "move_date", value: { raw_text: "next month", date: null, end_date: null, applies_to: "pickup", flexibility: "flexible", precision: "month" }, status: "stated", speaker: "customer", segment_ids: [2] },
      { field: "move_size", value: { value: { min: 2, max: 2 }, unit: "bedrooms", text: "two bedroom apartment", basis: "customer_stated" }, status: "stated", speaker: "customer", segment_ids: [4] },
      { field: "money", value: { basis: "competitor_quote", amount: { min: 4000, max: 4000 }, currency: "USD", text: "another quote around four thousand dollars" }, status: "stated", speaker: "customer", segment_ids: [6] },
    ],
    inventory: [
      { label: "Sofa", quantity: { min: 1, max: 1 }, room: "Living room", dimensions: null, handling: null, status: "included", speaker: "customer", segment_ids: [4] },
      { label: "King bed", quantity: { min: 1, max: 1 }, room: "Bedroom", dimensions: null, handling: null, status: "included", speaker: "customer", segment_ids: [4] },
      { label: "Dining table", quantity: { min: 1, max: 1 }, room: null, dimensions: null, handling: null, status: "included", speaker: "customer", segment_ids: [4] },
    ],
    intent_signals: [{ signal: "definite_move", text: "We are moving next month.", speaker: "customer", segment_ids: [2] },
      { signal: "price_objection", text: "Has a competing quote around $4,000.", speaker: "customer", segment_ids: [6] }],
  });

  // ── analysis runs, findings, effects (model outputs stored as documents) ─────────────────
  const COVERAGE = { known_through: null, gaps: [], capabilities: { call_log: "unknown" }, ai_paused: false };
  type RecordRef = { record_type: string; record_id: string; revision?: string | null; fields: Record<string, unknown> };
  type InstructionRef = { id: string; revision: number };
  async function pageSnapshot(runId: mongoose.Types.ObjectId, kind: "context" | "story" | "prior", subject: string, records: RecordRef[], at: Date, story?: Record<string, unknown>,
    instructions: InstructionRef[] = []) {
    const response = readContentSchema.parse({ page: { records: records.map(r => ({ revision: null, ...r })), complete: true, next_cursor: null, missing_ranges: [] },
      coverage: COVERAGE, instructions, speaker_refs: [], allowed_followup_ids: [], ...(story ? { story } : {}) });
    const row = await Snapshots.create({ ...dataset, run_id: runId, source_type: kind, source_id: `${kind}:${runId}`, arguments: {}, response, retrieved_at: at, happened_at: at,
      content_digest: payloadHash(response), subject_key: subject, completeness: { complete: true, missing_ranges: [] }, segments: [] });
    return String(row._id);
  }
  type FindingSpec = { key: string; kind: string; claim: string; basis?: string; actor?: string; action_status?: string | null; clarity?: string; value: Record<string, unknown>;
    evidence: Array<Record<string, unknown>>; resolved?: Record<string, unknown> | null; review_state?: string };
  type RunSpec = { number: { id: string }; recordId: string | null; conversation: SeededConversation | null; summaries: SeededConversation[]; at: Date; prompt: string;
    summary: SummaryText; findings: FindingSpec[]; relations?: Array<Record<string, unknown>>; discrepancies?: Array<Record<string, unknown>>; suggestion?: Record<string, unknown> | null;
    context?: RecordRef[]; story?: RecordRef[]; prior?: RecordRef[]; legacy?: boolean; runId?: mongoose.Types.ObjectId;
    /** Owner instructions the run was shown (context page `instructions`) and its assessment of each (`structuredContract.ts`: `finding_keys: []`). */
    instructions?: Array<InstructionRef & { assessment: "agrees" | "disagrees" | "cannot_determine"; reason: string }> };
  async function seedRun(spec: RunSpec) {
    const runId = spec.runId ?? O();
    const subject = spec.conversation ? `conversation:${spec.conversation.conversationId}` : `number:${spec.number.id}`;
    const shown = (spec.instructions ?? []).map(({ id, revision }) => ({ id, revision }));
    const contextId = spec.legacy ? null : await pageSnapshot(runId, "context", subject, spec.context ?? [], spec.at, undefined, shown);
    const storyId = spec.story ? await pageSnapshot(runId, "story", subject, spec.story, spec.at, { as_of: spec.at.toISOString(), opening: "Synthetic story opening.",
      prose: "Synthetic story prose for the final-UI seed.", tail: "", coverage: {}, candidates: [], granot: [], digest: payloadHash(spec.story) }) : null;
    const priorId = spec.prior ? await pageSnapshot(runId, "prior", subject, spec.prior, spec.at) : null;
    // Record citations name their page by placeholder; the page snapshots exist only now.
    const pages: Record<string, string | null> = { __context__: contextId, __story__: storyId, __prior__: priorId };
    const sub = (refs: Array<Record<string, unknown>>) => refs.map(ref => {
      const key = String(ref.snapshot_id);
      if (!(key in pages)) return ref;
      if (!pages[key]) throw new Error(`run cites ${key} but has no such page`);
      return { ...ref, snapshot_id: pages[key] };
    });
    const findings = spec.findings.map(f => intelligenceFindingSchema.parse({ key: f.key, kind: f.kind, claim: f.claim, basis: f.basis ?? "said_on_call", actor: f.actor ?? "customer",
      speaker_ref: null, action_status: f.action_status ?? null, clarity: f.clarity ?? "clear", evidence: sub(f.evidence), confidence: null, value: f.value }));
    const output = intelligenceEnvelopeSchema.parse({ schema_version: "csi-envelope-v1", summary: { ...spec.summary, finding_keys: findings.map(f => f.key) }, findings,
      next_step_suggestion: spec.suggestion ?? null,
      owner_instruction_assessments: (spec.instructions ?? []).map(i => ({ instruction_id: i.id, instruction_revision: i.revision, assessment: i.assessment, reason: i.reason, finding_keys: [] })),
      ...(spec.relations ? { prior_finding_relations: spec.relations.map(r => ({ ...r, evidence: sub(r.evidence as Array<Record<string, unknown>>) })) } : {}),
      ...(spec.discrepancies ? { story_discrepancies: spec.discrepancies.map(d => ({ ...d, evidence: sub(d.evidence as Array<Record<string, unknown>>) })) } : {}) });
    const summaryIds = spec.summaries.flatMap(s => (s.summaryId ? [s.summaryId] : []));
    const manifestIds = [...summaryIds, ...[contextId, storyId, priorId].filter((id): id is string => Boolean(id))].map(id => O(id));
    await Runs.collection.insertOne({ _id: runId, ...dataset, subject_key: subject, contact_number_id: O(spec.number.id),
      conversation_id: spec.conversation ? O(spec.conversation.conversationId) : null, outreach_record_id: spec.recordId ? O(spec.recordId) : null,
      mode: "initial", parent_run_id: null, predecessor_run_id: null, job_id: O(), triggering_event_ids: [], input_fingerprint: `fui-${runId}`, prompt_version: spec.prompt,
      schema_version: "csi-envelope-v1", schema_digest: "synthetic", model_version: "openai/gpt-5.6-luna", rendered_prompt: null, owner_correction_ids: [], owner_correction_context: [],
      manifest_digest: payloadHash(manifestIds.map(String)), manifest_snapshot_ids: manifestIds, evidence_count: manifestIds.length, evidence_bytes: 4000, application_cursor: findings.length,
      schema_failures: 0, schema_rejections: [], invocation_complete: true, processing_reason: null, finalized_at: plus(spec.at, 60_000), output,
      raw_output: spec.legacy ? null : { summary: spec.summary, findings: findings.map(({ key: _key, confidence: _c, speaker_ref: _s, ...rest }) => rest), next_step: spec.suggestion ?? null,
        owner_instruction_assessments: (spec.instructions ?? []).map((i, index) => ({ instruction_index: index, assessment: i.assessment, reason: i.reason })),
        prior_finding_relations: output.prior_finding_relations ?? [], story_discrepancies: output.story_discrepancies ?? [] },
      usage: { input_tokens: 5200, output_tokens: 900, reasoning_tokens: 300, cached_input_tokens: 0, actual_cents: 4, usage_complete: true }, pricing_snapshot: null,
      analysis_pipeline: spec.legacy ? null : "csi-analysis-steps-v1", application_disabled: false, step_contracts: null,
      step_artifacts: spec.legacy ? null : { summaries: summaryIds, context: contextId, context_digest: "synthetic", story: storyId, prior: priorId,
        lineage: { prior_run_ids: [], prior_summary_ids: [], prior_finding_ids: (spec.prior ?? []).filter(r => r.record_type === "prior_finding").map(r => r.record_id),
          assessment_artifact_id: null, story_events: (spec.story ?? []).length, story_from: null, story_to: null } },
      per_recording_ceiling_exceeded: false, status: "completed", result_counts: { applied: 0, blocked: 0, review: 0 }, deployment: dataset.deployment, database: dataset.database,
      permitted_tools: [], tool_grant_reason: null, token_nonce: null, started_at: spec.at, submitted_at: plus(spec.at, 50_000), completed_at: plus(spec.at, 60_000), revision: 3,
      purged_at: null, purge_started_at: null, createdAt: spec.at, updatedAt: plus(spec.at, 60_000) } as never);
    const ids: Record<string, string> = {};
    for (const [i, finding] of findings.entries()) {
      const _id = O(); ids[finding.key] = String(_id);
      // As `apply.ts` stores it: the single conversation the finding's transcript citations name, else the run's conversation.
      const sources = [...new Set(finding.evidence.flatMap(e => (e.source === "transcript" ? [e.conversation_id] : [])))];
      const conversationId = sources.length === 1 ? sources[0]! : spec.conversation?.conversationId ?? null;
      await Findings.collection.insertOne({ _id, run_id: runId, key: finding.key, assertion: finding, revision: 1,
        conversation_id: conversationId ? O(conversationId) : null, contact_number_id: O(spec.number.id), outreach_record_id: spec.recordId ? O(spec.recordId) : null,
        kind: finding.kind, prompt_version: spec.prompt, schema_version: "csi-envelope-v1", model_version: "openai/gpt-5.6-luna", resolved: spec.findings[i]!.resolved ?? null,
        review_state: spec.findings[i]!.review_state ?? "unreviewed", superseded_by: null,
        validation: { schema_ok: true, source_snapshots_valid: true, locator_status: "not_run", entailment_check: "not_run" },
        purged_at: null, purge_started_at: null, createdAt: plus(spec.at, 60_000 + i), updatedAt: plus(spec.at, 60_000 + i) } as never);
    }
    // The application step's bookkeeping in `apply.ts` order: the real `applyPriorRelations` (supersede links, relation and
    // record-dispute review items on the run's subject), then one Owner assessment row per instruction and an `owner_conflict`
    // review for each disagreement. Work effects of the findings themselves are seeded by the caller.
    if (output.prior_finding_relations?.length || output.story_discrepancies?.length || output.owner_instruction_assessments.length) {
      await withTransaction(async session => {
        const context = workerContext(session, String(O()), plus(spec.at, 55_000));
        await applyPriorRelations({ _id: runId, subject_key: subject, contact_number_id: O(spec.number.id) }, output,
          Object.entries(ids).map(([key, id]) => ({ _id: O(id), key })), context, session);
        for (const { finding_keys: _keys, ...value } of output.owner_instruction_assessments) {
          await getIntelligenceOwnerAssessmentModel().create([{ ...value, run_id: runId, finding_ids: [] }], { session });
          if (value.assessment === "disagrees") await openReview(context, subject, "owner_conflict", `instruction:${value.instruction_id}:${value.instruction_revision}`, []);
        }
      });
    }
    // Publication pointers exactly as `apply.ts` `publishCurrent` writes them.
    if (spec.conversation) {
      const s = spec.summary;
      await Conversations.collection.updateOne({ _id: O(spec.conversation.conversationId) }, { $set: { latest_completed_run_id: runId, state: "complete", pending_stage: null,
        summary: { text: [s.overview, s.customer_wanted, s.money_and_dates, s.outcome, s.commitments, s.discrepancies].filter(Boolean).join("\n"), model: "openai/gpt-5.6-luna",
          prompt_version: spec.prompt, created_at: plus(spec.at, 60_000), sections: { overview: s.overview, customer_wanted: s.customer_wanted, money_dates: s.money_and_dates,
            outcome: s.outcome, promised: s.commitments, mismatch: s.discrepancies } } } });
    } else {
      await Numbers.collection.updateOne({ _id: O(spec.number.id) }, { $set: { running_summary: { text: spec.summary.overview, run_id: runId,
        evidence_digest: payloadHash(manifestIds.map(String)), computed_at: plus(spec.at, 60_000) } }, $inc: { revision: 1 } });
    }
    return { runId: String(runId), ids, contextId, storyId, priorId, output };
  }
  async function seedEffect(input: { runId: string; findingId: string; findingKey: string; kind: string; target: string; targetId?: string | null; status: string;
    reason?: string | null; at: Date; current?: Record<string, unknown> }) {
    await Effects.collection.insertOne({ _id: O(), run_id: O(input.runId), finding_id: O(input.findingId), finding_key: input.findingKey, commitment_key: null,
      effect_kind: input.kind, target_key: input.target, target_id: input.targetId ? O(input.targetId) : null, revision_before: null, revision_after: null,
      previous: {}, current: input.current ?? {}, status: input.status, reason: input.reason ?? null, applied_at: input.at, superseding_effect_id: null, reversing_effect_id: null,
      createdAt: input.at, updatedAt: input.at } as never);
  }
  /** An intelligence follow-up created through the shared store (audited), then the record refreshed. */
  async function intelligenceFollowup(recordId: string, input: { kind: string; description: string; due: Date | null; findingId: string; runId: string; anchor: Date;
    promisedBy?: string | null; commitment: string }) {
    return withTransaction(async session => {
      const context = workerContext(session, String(O()), input.anchor);
      const record = await recordForUpdate(recordId, context);
      const prior = record.toObject();
      const row = new Followups({ outreach_record_id: record._id, commitment_key: input.commitment, kind: input.kind, description: input.description, due_at: input.due,
        base_attention_due_at: input.due, source_due_at: input.due, date_text: input.due ? null : "sometime next week",
        date_resolution: { precision: input.due ? "exact" : "unresolved", timezone: policy.timezone, anchor: input.anchor, policy_version: policy.version },
        origin: "rep_promise", requested_by: "rep", promised_by_agent_id: input.promisedBy ?? null, source_finding_ids: [O(input.findingId)], origin_run_id: O(input.runId) });
      await saveFollowup(row, null, context, subjectKey(record.subject), "intelligence_followup_created");
      await refreshRecord(record, context, "intelligence_effects_applied", prior, { run_id: input.runId });
      return String(row._id);
    });
  }
  /** An Owner follow-up through the real Owner command (creates, audits and refreshes the record's next action). */
  async function ownerFollowup(recordId: string, dueInHours: number | null, description = "Promised callback about the quote") {
    const record = await Records.findById(recordId).lean().orFail();
    await commandOutreach({ actor: ownerActor(`${ADMIN}/followups`), target_id: recordId, idempotency_key: `fui-followup-${recordId}-${++keySerial}`,
      command: { command: "create_followup", expected_revision: record.revision, outreach_record_id: recordId,
        action: { kind: "call", description, due_at: dueInHours === null ? null : new Date(Date.now() + dueInHours * HOUR).toISOString() } } });
  }

  // ── Move assessment runtime with a deterministic mocked model ──────────────────────────────
  type Tag = "default" | "conflict_move" | "conflict_other" | "engagement" | "lead_only" | "unknown";
  let currentTag: Tag = "default";
  const dim = fx.syntheticDimension;
  const decide = (payload: import("../../src/services/salesIntelligence/assessment/context").AssessmentPromptPayload) => {
    const convs = [...payload.conversations].sort((a, b) => a.call_at.localeCompare(b.call_at));
    const first = convs[0]?.entries[0]?.id, latest = convs.at(-1)?.entries.at(-1)?.id ?? first, early = convs[0]?.entries.at(-1)?.id ?? first;
    const leadEntry = payload.views.canonical_current?.entries[0]?.id;
    const inTwoDays = etDay(ahead(2)), inFour = etDay(ahead(4));
    switch (currentTag) {
      case "lead_only": return { move_likelihood: dim("active", leadEntry ? [leadEntry] : []), transaction_intent: dim("unknown", []), move_details: [],
        inventory: { items: [], coverage: "none", limitations: [] }, conflicts: [], engagement: fx.noEngagement() };
      case "conflict_move": return { move_likelihood: dim("strong", [first!]), transaction_intent: dim("active", [latest!], { conditions: ["Awaiting a written quote"] }),
        move_details: [
          { field: "pickup_location", status: "stated", evidence_ids: [first!], value: { line: "4521 Palmetto Grove Boulevard, Apartment 12B", city: "Tampa", state: "FL", zip: "33606", precision: "address" } },
          { field: "delivery_location", status: "changed", evidence_ids: [latest!], value: { line: null, city: "Raleigh", state: "NC", zip: null, precision: "city" } },
          { field: "move_date", status: "changed", evidence_ids: [latest!], value: { raw_text: "first week of next month, maybe earlier", date: etDay(ahead(12)), end_date: etDay(ahead(16)),
            applies_to: "pickup", flexibility: "flexible", precision: "window" } },
          { field: "service", status: "stated", evidence_ids: [first!], value: { service: "packing", status: "requested", detail: "Kitchen and fragile items only", duration_text: null } },
          { field: "service", status: "stated", evidence_ids: [latest!], value: { service: "storage", status: "declined", detail: null, duration_text: null } },
          { field: "access", status: "stated", evidence_ids: [first!], value: { end: "pickup", constraint: "stairs", detail: "Third floor walk-up" } },
          { field: "access", status: "stated", evidence_ids: [latest!], value: { end: "delivery", constraint: "elevator", detail: "Freight elevator must be reserved 48 hours ahead" } },
          { field: "money", status: "stated", evidence_ids: [latest!], value: { basis: "competitor_quote", amount: { min: 3800, max: 3800 }, currency: "USD", text: "Another mover quoted $3,800" } },
          { field: "money", status: "stated", evidence_ids: [first!], value: { basis: "budget", amount: { min: 3000, max: 3500 }, currency: "USD", text: "Budget between $3,000 and $3,500" } },
        ],
        inventory: { items: ["Sectional sofa", "King bed frame", "Dining table", "Six dining chairs", "Upright piano"].map((label, i) => ({ label, quantity: i === 3 ? { min: 6, max: 6 } : { min: 1, max: 1 },
          room: i < 2 ? "Living room" : null, dimensions: i === 4 ? { text: "58 in wide", unit: "in" } : null, handling: i === 4 ? "Piano dolly; three movers" : null,
          status: "included", evidence_ids: [i % 2 ? latest! : first!] })), coverage: "partial", limitations: ["Garage contents not discussed"] },
        conflicts: [{ affects: "move_date", explanation: "The first call said mid-month; the later call moved it to the first week of next month.", evidence_ids: [first!, latest!] },
          { affects: "delivery_location", explanation: "Delivery city changed from Charlotte to Raleigh between calls.", evidence_ids: [first!, latest!] }],
        engagement: { work_status: "worked_no_next_step", rationale: "The rep spoke with the customer; no follow-up was agreed.", evidence_ids: [latest!], promised_callbacks: [], next_steps: [] } };
      case "conflict_other": return { ...fx.defaultAssessment(payload),
        conflicts: [{ affects: "transaction_intent", explanation: "The customer said they are ready to book, then said they are waiting on a competitor.", evidence_ids: [first!, latest!] },
          { affects: "inventory", explanation: "The piano was included on one call and excluded on the other.", evidence_ids: [first!, latest!] }] };
      case "engagement": return { ...fx.defaultAssessment(payload), move_likelihood: dim("strong", [first!]), transaction_intent: dim("strong", [latest!]),
        engagement: { work_status: "worked_with_next_step", rationale: "The rep worked the customer on the latest call and agreed next steps.", evidence_ids: [latest!],
          promised_callbacks: [
            { by: "rep", raw_text: "I'll call you Thursday morning with the estimate", date: inTwoDays, time_text: "morning", status: "pending", evidence_ids: [latest!] },
            { by: "customer", raw_text: "I'll call back after I talk to my wife", date: null, time_text: null, status: "pending", evidence_ids: [early!] },
            { by: "rep", raw_text: "Called back as promised last week", date: null, time_text: null, status: "fulfilled", evidence_ids: [latest!] }],
          next_steps: [
            { action: "send_estimate", owner: "rep", description: "Email the written estimate", date: inFour, date_text: "by Monday", status: "planned", evidence_ids: [latest!] },
            { action: "call", owner: "rep", description: "Confirm the inventory list", date: null, date_text: "next week", status: "planned", evidence_ids: [latest!] },
            { action: "wait", owner: "customer", description: "Customer checks the lease end date", date: null, date_text: null, status: "conditional", evidence_ids: [latest!] }] } };
      case "unknown": return { move_likelihood: dim("unknown", []), transaction_intent: dim("unknown", []), move_details: [], inventory: { items: [], coverage: "none", limitations: [] },
        conflicts: [], engagement: fx.noEngagement() };
      default: return fx.defaultAssessment(payload);
    }
  };
  const mock = await fx.mockAssessmentModel(decide);
  async function assess(recordId: string, tag: Tag) {
    currentTag = tag;
    const jobId = await withTransaction(session => runtime.nominateMoveAssessment({ outreach_record_id: recordId, trigger: `seed:${tag}:${recordId}`, force: true }, session));
    if (!jobId) throw new Error(`no nomination for ${recordId}`);
    const result = await runtime.runMoveAssessmentJob(jobId, { model: mock.model, onError: (error: unknown) => console.error(error) });
    if (!["completed", "reused"].includes(result.status)) throw new Error(`assessment ${tag}: ${JSON.stringify(result)}`);
    return String((result as { artifact_id?: string }).artifact_id ?? "");
  }

  // ── Granot: observations and Lead changes ─────────────────────────────────────────────────
  const revisionByLead = new Map<string, number>();
  async function observation(lead: LeadRef & { job: string }, ten: string, at: Date, priority: string, rep = "Dana R.", quoted = false) {
    const _id = O();
    await getGranotObservationModel().collection.insertOne({ _id, receipt_id: O(), schema_version: 1, kind: "lead_snapshot", normalization_result: "valid",
      normalized_source_label: "top10", captured_at: at, identity: { job_no_raw: lead.job, normalized_job_no: lead.job }, contact: { normalized_phone: ten },
      move: {}, priority: { raw: priority, canonical: priority, valid: true }, booking_action: {}, display_money: { estimate: { raw: "4200.00", canonical: "4200.00" } },
      agent_identity: { rep_raw: rep, user_raw: rep }, provider_context: {}, issues: [], quoted, createdAt: plus(at, 5_000), updatedAt: plus(at, 5_000) } as never);
    return String(_id);
  }
  async function leadChange(lead: LeadRef, at: Date, changes: Array<{ path: "granot_priority" | "quoted"; before: unknown; after: unknown }>, observationId: string | null) {
    const before = revisionByLead.get(lead.id) ?? 0;
    revisionByLead.set(lead.id, before + 1);
    const sorted = [...changes].sort((a, b) => a.path.localeCompare(b.path));
    await getEntityChangeModel().collection.insertOne({ _id: O(), entity: { model: lead.model, id: lead.id }, command_execution_id: O(), command_name: observationId ? "granot.observe_lead" : "vantage.update_lead",
      provenance: { source_system: observationId ? "granot" : "vantage", ...(observationId ? { observation_channel: "granot_webhook", observation_id: O(observationId) } : {}),
        actor: { actor_type: "system", actor_id: "granot-lifecycle" }, initiator: { actor_type: "system", actor_id: "granot-lifecycle" } },
      changed_paths: sorted.map(c => c.path), fields: sorted.map(c => ({ path: c.path, value_mode: "stored", before: c.before, after: c.after })),
      revision_before: before, revision_after: before + 1, applied_at: at } as never);
  }
  async function leadMessage(lead: LeadRef, e164: string, at: Date, status = "delivered") {
    const _id = O();
    await getLeadMessageModel().collection.insertOne({ _id, lead_ref: { model: lead.model, id: O(lead.id) }, origin: lead.model === "FormLead" ? "public_form" : "granot_lead_created",
      provider: "twilio", channel: "sms", purpose: lead.model === "FormLead" ? "quote_request_confirmation" : "granot_lead_created_confirmation", message_key: `fui:${_id}`,
      template_version: 1, to: e164, from: "+15615550199", body: "Thanks for your request. A Vantage Movers rep will call you shortly.", dispatch_mode: "inline", status,
      attempt_count: 1, manual_retry_count: 0, sent_at: plus(at, 30_000), delivered_at: status === "delivered" ? plus(at, 45_000) : null, attempts: [], createdAt: at, updatedAt: plus(at, 45_000) } as never);
    return String(_id);
  }
  async function booking(lead: LeadRef & { job: string }, bookDate: Date, amount = 4200) {
    const _id = O();
    await db.collection("booked_leads").insertOne({ _id, agent: agents[1]!._id, agent_name_snapshot: agents[1]!.name, binder_amount: amount, timestamp: plus(bookDate, 30 * 60_000),
      book_date: bookDate, lead_ref: O(lead.id), lead_model: lead.model, agents: [{ agent: agents[1]!._id, share: 1 }], total_binder_amount: amount, deposit_amount: Math.round(amount * 0.25),
      merchant: "Synthetic Merchant", source: "Top10", job_no: lead.job, is_referral_booking: false, is_leadless_booking: false, over_2000: amount > 2000, over_4000: amount > 4000,
      cancelled: false, createdAt: plus(bookDate, 30 * 60_000), updatedAt: plus(bookDate, 30 * 60_000) });
    await db.collection(lead.model === "FormLead" ? "form_leads" : "call_leads").updateOne({ _id: O(lead.id) }, { $set: { booked: _id } });
    return String(_id);
  }
  async function cancellation(lead: LeadRef & { job: string }, bookingId: string, cancelDate: Date, reason: string) {
    const _id = O();
    await db.collection("cancelled_leads").insertOne({ _id, timestamp: plus(cancelDate, 20 * 60_000), booked_lead: O(bookingId), lead_ref: O(lead.id), lead_model: lead.model,
      cancel_date: cancelDate, reason, refund_amount: 250, job_no: lead.job, createdAt: plus(cancelDate, 20 * 60_000), updatedAt: plus(cancelDate, 20 * 60_000) });
    await db.collection("booked_leads").updateOne({ _id: O(bookingId) }, { $set: { cancelled: true } });
    await db.collection(lead.model === "FormLead" ? "form_leads" : "call_leads").updateOne({ _id: O(lead.id) }, { $set: { cancelled: _id } });
    return String(_id);
  }
  const ownerClose = async (recordId: string, reason: "lost" | "not_sales", note: string) => {
    const record = await Records.findById(recordId).lean().orFail();
    await commandOutreach({ actor: ownerActor(`${ADMIN}/outreach/${recordId}/commands`), target_id: recordId, idempotency_key: `fui-close-${recordId}`,
      command: { command: "close", expected_revision: record.revision, reason, note } });
  };
  const ownerNote = async (recordId: string, text: string) => {
    const record = await Records.findById(recordId).lean().orFail();
    await commandOutreach({ actor: ownerActor(`${ADMIN}/outreach/${recordId}/commands`), target_id: recordId, idempotency_key: `fui-note-${recordId}-${keySerial++}`,
      command: { command: "add_note", expected_revision: record.revision, text } });
  };

  /** A typical Lead subject: Number, Lead, attachment, Outreach record, a few calls. */
  async function leadSubject(opts: { model?: LeadModel; receivedDaysAgo: number; fields?: Record<string, unknown>; calls?: CallSpec[]; noNumber?: boolean; closeAt?: Date }) {
    const receivedAt = ago(opts.receivedDaysAgo);
    const number = opts.noNumber ? null : await seedNumber(receivedAt);
    const lead = await seedLead(opts.model ?? "FormLead", number?.ten ?? `999555${String(1000 + ++numberSerial).slice(-4)}`, receivedAt, opts.fields);
    if (number) await attach(number.id, lead, receivedAt);
    if (number && opts.calls) await seedCalls(number.id, number.e164, opts.calls);
    const recordId = await seedRecord(lead, number?.id ?? null, opts.closeAt ?? plus(receivedAt, 60_000));
    return { number, lead, recordId, receivedAt };
  }
  const leadIds = (lead: LeadRef) => [{ model: lead.model, id: lead.id }];

  // ════════════════════════════════════════════════════════════════════════════════════════
  // Subjects
  // ════════════════════════════════════════════════════════════════════════════════════════

  // 1. Number-only subject (no Lead): Owner-opened number review.
  {
    const number = await seedNumber(ago(6));
    await seedCalls(number.id, number.e164, [{ at: ago(6), direction: "Inbound", result: "Missed", connected: false, duration: 0, name: "WIRELESS CALLER" },
      { at: ago(5, 3), direction: "Outbound", result: "Voicemail", connected: true, duration: 42, contact: "voicemail" },
      { at: ago(2, 5), direction: "Inbound", result: "Call connected", duration: 95, name: "WIRELESS CALLER" }]);
    const record = await withTransaction(session => ensureNumberReview(number.id, "owner_open", workerContext(session, String(O()))));
    row("S-number-only", ["number_only"], { outreach_record_id: String(record._id), contact_number_id: number.id, note: "Number review Outreach; no Lead attached" });
  }

  // 2. Multiple Leads attached to one phone.
  {
    const number = await seedNumber(ago(40));
    const first = await seedLead("FormLead", number.ten, ago(40), { name: "Hannah Sato", move_date: utcMidnight(etDay(ago(10))) });
    const second = await seedLead("CallLead", number.ten, ago(8), { name: "Hannah Sato" });
    await attach(number.id, first, ago(40)); await attach(number.id, second, ago(8), "exact");
    await seedCalls(number.id, number.e164, [{ at: ago(39), direction: "Outbound", result: "No Answer", connected: false, duration: 0 },
      { at: ago(8), direction: "Inbound", result: "Call connected", duration: 240, name: "SATO HANNAH" }, { at: ago(3), direction: "Outbound", result: "Call connected", duration: 64 }]);
    const a = await seedRecord(first, number.id, ago(40)), b = await seedRecord(second, number.id, ago(8));
    row("S-multi-lead-a", ["multi_lead_phone"], { outreach_record_id: a, contact_number_id: number.id, lead_refs: [...leadIds(first), ...leadIds(second)], note: "Form Lead on a phone with two attached Leads" });
    row("S-multi-lead-b", ["multi_lead_phone"], { outreach_record_id: b, contact_number_id: number.id, lead_refs: [...leadIds(first), ...leadIds(second)], note: "Call Lead on the same phone" });
  }

  // 3. Closed outcomes through the real closure writers.
  {
    // Booked 8 days after trigger_at; the Booking closes the record through ensureLead (official).
    const receivedAt = ago(20), bookAt = plus(receivedAt, 8 * DAY);
    const number = await seedNumber(receivedAt);
    const lead = await seedLead("FormLead", number.ten, receivedAt);
    await attach(number.id, lead, receivedAt);
    await seedCalls(number.id, number.e164, [{ at: plus(receivedAt, 20 * 60_000), direction: "Outbound", result: "Call connected", duration: 310, contact: "human_conversation" },
      { at: plus(receivedAt, 2 * DAY), direction: "Outbound", result: "Voicemail", connected: true, duration: 35, contact: "voicemail" },
      { at: plus(receivedAt, 5 * DAY), direction: "Inbound", result: "Call connected", duration: 420 }, { at: plus(receivedAt, 8 * DAY - HOUR), direction: "Outbound", result: "Call connected", duration: 600 }]);
    const recordId = await seedRecord(lead, number.id, plus(receivedAt, 60_000));
    const bookingId = await booking(lead, bookAt, 5200);
    await seedRecord(lead, number.id, plus(bookAt, 40 * 60_000));
    row("S-closed-booked", ["closed_booked", "booking"], { outreach_record_id: recordId, contact_number_id: number.id, lead_refs: leadIds(lead), note: `Booked 8 days after trigger_at (booking ${bookingId})` });
  }
  {
    const receivedAt = ago(30), bookAt = ago(25), cancelAt = ago(21);
    const s = await leadSubject({ receivedDaysAgo: 30, calls: [{ at: plus(receivedAt, HOUR), direction: "Outbound", result: "Call connected", duration: 280 }] });
    const bookingId = await booking(s.lead, bookAt, 3900);
    await cancellation(s.lead, bookingId, cancelAt, "Customer found a cheaper mover");
    await seedRecord(s.lead, s.number!.id, plus(cancelAt, HOUR));
    row("S-closed-cancelled", ["closed_cancelled", "booking", "cancellation"], { outreach_record_id: s.recordId, contact_number_id: s.number!.id, lead_refs: leadIds(s.lead), note: "Booked, then cancelled with a reason" });
  }
  for (const [label, state, fields, days] of [["S-closed-bad-lead", "closed_bad_lead", { bad_lead: "Wrong number" }, 12], ["S-closed-duplicate", "closed_duplicate", { duplicate: true }, 9],
    ["S-closed-no-sync", "closed_no_sync", { no_sync: true }, 15]] as const) {
    const s = await leadSubject({ receivedDaysAgo: days, calls: [{ at: ago(days - 1), direction: "Outbound", result: "No Answer", connected: false, duration: 0 }] });
    await db.collection("form_leads").updateOne({ _id: O(s.lead.id) }, { $set: fields });
    await seedRecord(s.lead, s.number!.id, ago(days - 2));
    row(label, [state], { outreach_record_id: s.recordId, contact_number_id: s.number!.id, lead_refs: leadIds(s.lead), note: `Official closure (${state.replace("closed_", "")})` });
  }
  {
    // CRM dead: Priority 8 from Granot, the change paired to its observation; Lead progress closes the record.
    const s = await leadSubject({ receivedDaysAgo: 18, fields: { granot_priority: "1", quoted: true }, calls: [{ at: ago(17), direction: "Outbound", result: "Call connected", duration: 200 }] });
    const obsAt = ago(6, 1);
    const obs = await observation(s.lead, s.number!.ten, obsAt, "8", "Marcus B.");
    await leadChange(s.lead, plus(obsAt, 20 * 60_000), [{ path: "granot_priority", before: "1", after: "8" }], obs);
    await db.collection("form_leads").updateOne({ _id: O(s.lead.id) }, { $set: { granot_priority: "8" } });
    await seedRecord(s.lead, s.number!.id, plus(obsAt, 25 * 60_000));
    row("S-closed-crm-dead", ["closed_crm_dead", "priority_change_paired"], { outreach_record_id: s.recordId, contact_number_id: s.number!.id, lead_refs: leadIds(s.lead), note: "Priority 8 paired to an observation; CRM disposition closure" });
  }
  {
    // CRM bad/unusable: Priority 7 recorded by Vantage with no observation (unpaired change).
    const s = await leadSubject({ receivedDaysAgo: 14, calls: [{ at: ago(13), direction: "Outbound", result: "Call connected", duration: 45 }] });
    await leadChange(s.lead, ago(4), [{ path: "granot_priority", before: null, after: "7" }], null);
    await db.collection("form_leads").updateOne({ _id: O(s.lead.id) }, { $set: { granot_priority: "7" } });
    await seedRecord(s.lead, s.number!.id, plus(ago(4), 5 * 60_000));
    row("S-closed-crm-bad", ["closed_crm_bad_unusable", "priority_change_unpaired"], { outreach_record_id: s.recordId, contact_number_id: s.number!.id, lead_refs: leadIds(s.lead), note: "Priority 7 with no paired observation; CRM disposition closure" });
  }
  {
    const s = await leadSubject({ receivedDaysAgo: 11, calls: [{ at: ago(10), direction: "Outbound", result: "Call connected", duration: 150, contact: "human_conversation" }] });
    await ownerNote(s.recordId, "Customer said they will move themselves with family.");
    await ownerClose(s.recordId, "lost", "Customer chose to move themselves.");
    row("S-closed-owner", ["closed_owner"], { outreach_record_id: s.recordId, contact_number_id: s.number!.id, lead_refs: leadIds(s.lead), note: "Closed by the Owner (reason lost, note)" });
  }
  {
    const receivedAt = ago(130), bookAt = ago(122);
    const s = await leadSubject({ receivedDaysAgo: 130, calls: [{ at: plus(receivedAt, HOUR), direction: "Outbound", result: "Call connected", duration: 300 }] });
    await booking(s.lead, bookAt, 2800);
    await seedRecord(s.lead, s.number!.id, plus(bookAt, HOUR));
    row("S-closed-over-90d", ["closed_over_90d", "booking"], { outreach_record_id: s.recordId, contact_number_id: s.number!.id, lead_refs: leadIds(s.lead), note: "Booked and closed more than 90 days ago; excluded from the closed partition" });
  }

  // 4. Follow-up states.
  for (const [label, state, due] of [["S-followup-due", "followup_due", 20], ["S-followup-overdue", "followup_overdue", -30], ["S-followup-no-due", "followup_no_due_date", null],
    ["S-followup-none", "followup_none", undefined]] as const) {
    const s = await leadSubject({ receivedDaysAgo: 3, calls: [{ at: ago(2, 20), direction: "Outbound", result: "Call connected", duration: 130, contact: "human_conversation" }] });
    if (due !== undefined) await ownerFollowup(s.recordId, due);
    row(label, [state], { outreach_record_id: s.recordId, contact_number_id: s.number!.id, lead_refs: leadIds(s.lead), note: due === undefined ? "Open record with no follow-up" : `Owner follow-up due ${due === null ? "unset" : `${due}h`}` });
  }

  // 5. Assessments: engagement (created + skipped), conflicts, move dates, newer call, lead-only, not applicable, pending.
  {
    const s = await leadSubject({ receivedDaysAgo: 8, fields: { move_date: utcMidnight(etDay(ahead(25))) } });
    const c1 = await seedConversation(s.number!, { call: { at: ago(6), direction: "Inbound", result: "Call connected", duration: 380 }, lead: s.lead });
    const c2 = await seedConversation(s.number!, { call: { at: ago(2), direction: "Outbound", result: "Call connected", duration: 510 }, lead: s.lead });
    const artifact = await assess(s.recordId, "engagement");
    row("S-engagement", ["engagement_created_and_skipped", "move_date_future", "summary_snapshot_move_evidence", "transcript_segments"], { outreach_record_id: s.recordId,
      contact_number_id: s.number!.id, lead_refs: leadIds(s.lead), conversation_ids: [c1.conversationId, c2.conversationId], artifact_ids: [artifact],
      note: "Engagement created follow-ups and skipped items (superseded_by_later_call, status_fulfilled, open_action_exists, status_conditional)" });
  }
  {
    const s = await leadSubject({ receivedDaysAgo: 9, fields: { pickup_city: "Tampa", pickup_state: "FL", delivery_city: "Charlotte", delivery_state: "NC",
      ingested_move_snapshot: { pickup_city: "Tampa", pickup_state: "FL", pickup_zip: "33606", delivery_city: "Charlotte", delivery_state: "NC", destination_zip: "28202",
        move_date: utcMidnight(etDay(ahead(8))), move_size: "2 Bedroom", captured_at: ago(9), evidence_status: "captured_at_ingestion" } } });
    const c1 = await seedConversation(s.number!, { call: { at: ago(7), direction: "Inbound", result: "Call connected", duration: 450 }, lead: s.lead });
    const c2 = await seedConversation(s.number!, { call: { at: ago(3), direction: "Outbound", result: "Call connected", duration: 390 }, lead: s.lead,
      lines: defaultLines("Tampa", "Raleigh", "the first week of next month") });
    const artifact = await assess(s.recordId, "conflict_move");
    // A newer call after the assessment's latest conversation (no recording).
    await seedCalls(s.number!.id, s.number!.e164, [{ at: ago(0, 10), direction: "Outbound", result: "No Answer", connected: false, duration: 0 }]);
    row("S-conflict-move", ["conflict_details_disagree", "newer_call_after_assessment"], { outreach_record_id: s.recordId, contact_number_id: s.number!.id, lead_refs: leadIds(s.lead),
      conversation_ids: [c1.conversationId, c2.conversationId], artifact_ids: [artifact], note: "Conflicts on move_date and delivery_location; a newer outbound call after the assessment" });
  }
  {
    const s = await leadSubject({ receivedDaysAgo: 25, fields: { move_date: utcMidnight(etDay(ago(5))) } });
    const c1 = await seedConversation(s.number!, { call: { at: ago(22), direction: "Inbound", result: "Call connected", duration: 300 }, lead: s.lead });
    const c2 = await seedConversation(s.number!, { call: { at: ago(12), direction: "Outbound", result: "Call connected", duration: 260 }, lead: s.lead });
    const artifact = await assess(s.recordId, "conflict_other");
    row("S-conflict-other", ["conflict_other", "move_date_passed"], { outreach_record_id: s.recordId, contact_number_id: s.number!.id, lead_refs: leadIds(s.lead),
      conversation_ids: [c1.conversationId, c2.conversationId], artifact_ids: [artifact], note: "Conflicts affect transaction_intent and inventory only; the Lead's move date has passed" });
  }
  {
    const s = await leadSubject({ receivedDaysAgo: 2, noNumber: true });
    const artifact = await assess(s.recordId, "lead_only");
    row("S-lead-only", ["assessment_lead_only"], { outreach_record_id: s.recordId, lead_refs: leadIds(s.lead), artifact_ids: [artifact], note: "Lead-only Outreach (no primary Contact Number); input_mode lead_only" });
  }
  {
    // Not applicable: Priority 7 accepted on an open Lead. In the live flow the projection closes such a record in the same
    // transaction; here the assessment is published first and the accepted Lead progress is then written with the real pure
    // projection (`projectLeadProgress` over `latestProgressEvidence`) without the closure, so the record stays open.
    process.env.SALES_INTELLIGENCE_LEAD_PROGRESS = "false";
    const s = await leadSubject({ receivedDaysAgo: 7 });
    const c1 = await seedConversation(s.number!, { call: { at: ago(6), direction: "Inbound", result: "Call connected", duration: 280 }, lead: s.lead });
    const artifact = await assess(s.recordId, "default");
    const obsAt = ago(1, 4), obs = await observation(s.lead, s.number!.ten, obsAt, "7", "Tina C.");
    await leadChange(s.lead, plus(obsAt, 10 * 60_000), [{ path: "granot_priority", before: null, after: "7" }], obs);
    await db.collection("form_leads").updateOne({ _id: O(s.lead.id) }, { $set: { granot_priority: "7" } });
    await withTransaction(async session => {
      const evidence = await latestProgressEvidence({ model: s.lead.model, id: s.lead.id }, session, { granot_priority: "7", quoted: false });
      const progress = projectLeadProgress({ lead: { granot_priority: "7", quoted: false }, prior: null, evidence, now: new Date() });
      await Records.collection.updateOne({ _id: O(s.recordId) }, { $set: { lead_progress: progress } }, { session });
    });
    process.env.SALES_INTELLIGENCE_LEAD_PROGRESS = "true";
    row("S-not-applicable", ["assessment_not_applicable", "priority_change_paired"], { outreach_record_id: s.recordId, contact_number_id: s.number!.id, lead_refs: leadIds(s.lead),
      conversation_ids: [c1.conversationId], artifact_ids: [artifact], note: "Open Lead with accepted Granot Priority 7 (CRM bad/unusable); applicability not_applicable" });
  }
  {
    const s = await leadSubject({ receivedDaysAgo: 1 });
    const c1 = await seedConversation(s.number!, { call: { at: ago(0, 20), direction: "Inbound", result: "Call connected", duration: 200 }, lead: s.lead });
    await withTransaction(session => runtime.nominateMoveAssessment({ outreach_record_id: s.recordId, trigger: "seed:pending" }, session));
    row("S-assessment-pending", ["assessment_pending"], { outreach_record_id: s.recordId, contact_number_id: s.number!.id, lead_refs: leadIds(s.lead), conversation_ids: [c1.conversationId],
      note: "A move_assessment job is queued; no artifact yet" });
  }


  // 6. Findings showcase: every work_result, relations of all five kinds, story discrepancies, a Number run and an applied suggestion.
  {
    const receivedAt = ago(9);
    const s = await leadSubject({ receivedDaysAgo: 9, fields: { name: "Priya Nair", granot_priority: "1", quoted: true, move_date: utcMidnight(etDay(ahead(21))),
      pickup_city: "Tampa", pickup_state: "FL", delivery_city: "Charlotte", delivery_state: "NC" } });
    const n = s.number!, key = `lead:${s.lead.model}:${s.lead.id}`;
    const lm = await leadMessage(s.lead, n.e164, plus(receivedAt, 2 * 60_000));
    await seedCalls(n.id, n.e164, [{ at: plus(receivedAt, 15 * 60_000), direction: "Outbound", result: "No Answer", connected: false, duration: 0 },
      { at: plus(receivedAt, 3 * HOUR), direction: "Outbound", result: "Voicemail", connected: true, duration: 31, contact: "voicemail" }]);
    const c1 = await seedConversation(n, { call: { at: ago(7), direction: "Inbound", result: "Call connected", duration: 540 }, lead: s.lead });
    const said2 = [
      { kind: "completion_claim", claim: "Rep is following up on the estimate as promised.", value: { action_kind: "call", description: "Follow-up call", date_text: null, timezone_text: null,
        target_followup_id: null }, actor: "rep", clarity: "clear", action_status: "completed", speaker: "rep", segment_ids: [1], quote: null },
      { kind: "objection", claim: "Customer says the confirmation text never arrived.", value: { description: "Confirmation text not received" }, actor: "customer", clarity: "clear",
        action_status: null, speaker: "customer", segment_ids: [2], quote: null },
      { kind: "next_step", claim: "Rep will send the written estimate tonight.", value: { action_kind: "send_estimate", description: "Send the written estimate", date_text: "tonight",
        timezone_text: null, target_followup_id: null }, actor: "rep", clarity: "clear", action_status: "promised", speaker: "rep", segment_ids: [3], quote: null },
      { kind: "quoted_amount", claim: "The other mover came down to $3,500.", value: { amount_text: "thirty five hundred", currency: "USD", meaning: "competitor_quote" }, actor: "customer",
        clarity: "clear", action_status: null, speaker: "customer", segment_ids: [4], quote: null },
      { kind: "promised_callback", claim: "Rep will call Friday.", value: { action_kind: "call", description: "Call Friday", date_text: "Friday", timezone_text: null, target_followup_id: null },
        actor: "rep", clarity: "clear", action_status: "promised", speaker: "rep", segment_ids: [3, 6], quote: null },
    ];
    const c2 = await seedConversation(n, { call: { at: ago(4), direction: "Outbound", result: "Call connected", duration: 610 }, lead: s.lead, said: said2,
      summary: { overview: "Follow-up call: the customer never received the confirmation text; the competing quote dropped to $3,500. Rep will send the estimate tonight and call Friday.",
        customer_wanted: "A written estimate that beats $3,500.", money_and_dates: "Competing quote $3,500; callback Friday.", outcome: "Estimate to be sent tonight.",
        commitments: "Rep will send the estimate tonight and call Friday.", discrepancies: "Customer says the confirmation text never arrived." },
      lines: [["rep", "Hi Priya, it is Dana from Vantage Movers following up on the estimate."], ["customer", "Thanks. I never got the confirmation text you mentioned."],
        ["rep", "Sorry about that. I will send the written estimate tonight and call you Friday."], ["customer", "The other mover actually came down to thirty five hundred."],
        ["rep", "Understood, I will see what we can do on price."], ["customer", "Okay, talk Friday then."]] });
    const c3 = await seedConversation(n, { call: { at: ago(1), direction: "Outbound", result: "Voicemail", connected: true, duration: 38, contact: "voicemail" }, lead: s.lead, media: "retained",
      lines: [["rep", "Hi Priya, Dana from Vantage again, calling about your estimate."], ["rep", "Please call me back at your convenience."]],
      said: [{ kind: "contact_type", claim: "The rep left a voicemail.", value: { type: "voicemail", voicemail_left_by: "rep" }, actor: "rep", clarity: "clear", action_status: null,
        speaker: "rep", segment_ids: [1, 2], quote: null }], moveEvidence: { observations: [], inventory: [], intent_signals: [] },
      summary: { overview: "Voicemail left about the estimate.", customer_wanted: "", money_and_dates: "", outcome: "Voicemail.", commitments: "", discrepancies: "" } });
    const t = (c: SeededConversation, segs: number[], quote: string | null = null) => ({ source: "transcript", snapshot_id: c.summaryId!, conversation_id: c.conversationId,
      transcript_version: c.version, segment_ids: segs, quote });
    const rec = (page: "__context__" | "__story__" | "__prior__", record_type: string, record_id: string, field_paths: string[]) => ({ source: "vantage_record", snapshot_id: page, record_type, record_id, field_paths });
    const leadRecord: RecordRef = { record_type: "lead", record_id: `FormLead:${s.lead.id}`, fields: { model: "FormLead", name: "Priya Nair", job_no: s.lead.job,
      received_at: receivedAt.toISOString(), pickup: "Tampa, FL", delivery: "Charlotte, NC", move_date: etDay(ahead(21)), granot_priority: "1", priority_label: "Quoted", quoted: true } };
    const outreachRecord: RecordRef = { record_type: "outreach", record_id: s.recordId, fields: { status: "open", description: "Outreach for Priya Nair" } };

    // R1: conversation run on the first call (analyze_v3, before relations existed).
    const r1At = plus(c1.at, HOUR);
    const r1 = await seedRun({ number: n, recordId: s.recordId, conversation: c1, summaries: [c1], at: r1At, prompt: "sales_intelligence_analyze_v3",
      summary: { overview: "Priya is moving a two bedroom apartment from Tampa to Charlotte next month and is comparing quotes. She asked for a written estimate and a callback Thursday.",
        customer_wanted: "A written estimate and a price close to a competing quote.", money_and_dates: "Competing quote about $4,000; move next month.", outcome: "Rep will send an estimate.",
        commitments: "Rep promised a Thursday morning callback.", discrepancies: "" },
      context: [leadRecord, outreachRecord, { record_type: "contact_number", record_id: n.id, fields: { phone: n.e164 } }],
      findings: [
        { key: "finding-1", kind: "promised_callback", actor: "rep", action_status: "promised", claim: "Rep promised to call back Thursday morning with the estimate.",
          value: { action_kind: "call", description: "Call back with the estimate", date_text: "Thursday morning", timezone_text: null, target_followup_id: null },
          evidence: [t(c1, [5], "I can put together an estimate and call you back Thursday morning.")],
          resolved: { due_at: plus(c1.at, 2 * DAY), amount_cents: null, original_wording: "Thursday morning", assumptions: ["Thursday 10:00 AM ET"], uncertain: false } },
        { key: "finding-2", kind: "contact_restriction", claim: "Customer asked not to be texted until after the weekend.", value: { channels: ["text"], restriction: "until", until_text: "after the weekend" },
          evidence: [t(c1, [2])] },
        { key: "finding-3", kind: "customer_requested_callback", action_status: "requested", claim: "Customer asked for a callback sometime next week.",
          value: { action_kind: "call", description: "Customer wants a callback", date_text: "sometime next week", timezone_text: null, target_followup_id: null }, evidence: [t(c1, [6])] },
        { key: "finding-4", kind: "quoted_amount", claim: "Customer mentioned another quote of about $4,000.", value: { amount_text: "around four thousand dollars", currency: "USD", meaning: "competitor_quote" },
          evidence: [t(c1, [6])], resolved: { due_at: null, amount_cents: 400000, original_wording: "around four thousand dollars", assumptions: [], uncertain: true } },
        { key: "finding-5", kind: "contact_type", claim: "The call was a human conversation.", basis: "model_inference", actor: "unknown", value: { type: "human_conversation", voicemail_left_by: null },
          evidence: [t(c1, [1, 2])] },
        { key: "finding-6", kind: "next_step", actor: "rep", action_status: "promised", claim: "Rep will email the estimate before the callback.", value: { action_kind: "send_estimate",
          description: "Email the estimate", date_text: "before Thursday", timezone_text: null, target_followup_id: null }, evidence: [t(c1, [5])] },
        { key: "finding-7", kind: "objection", claim: "Customer thinks the price may be too high.", value: { description: "Price may be too high" }, evidence: [t(c1, [6])] },
        { key: "finding-8", kind: "competitor_mention", clarity: "uncertain", claim: "Customer may already have a deposit with another mover.", value: { description: "Possible deposit with another mover" },
          evidence: [t(c1, [6])] },
        { key: "finding-9", kind: "move_fact", claim: "Customer is moving from Tampa.", value: { field: "origin", stated_value: "Tampa, FL" }, evidence: [t(c1, [2])] },
        { key: "finding-10", kind: "intent", basis: "vantage_record", actor: "unknown", claim: "The Lead on file shows an active move request.", value: { intent: "moving_inquiry" },
          evidence: [rec("__context__", "lead", leadRecord.record_id, ["move_date"])] },
      ] });
    const f = r1.ids;
    const fu1 = await intelligenceFollowup(s.recordId, { kind: "call", description: "Call back with the estimate", due: plus(c1.at, 2 * DAY), findingId: f["finding-1"]!, runId: r1.runId,
      anchor: r1At, promisedBy: agentId(0), commitment: `run:${r1.runId}:finding-1` });
    await seedEffect({ runId: r1.runId, findingId: f["finding-1"]!, findingKey: "finding-1", kind: "create_followup", target: `followup:run:${r1.runId}:finding-1`, targetId: fu1, status: "applied", at: r1At });
    await seedEffect({ runId: r1.runId, findingId: f["finding-2"]!, findingKey: "finding-2", kind: "pause_channel", target: `restriction:${n.id}:text`, status: "blocked_owner",
      reason: "owner_instruction_active", at: r1At });
    await seedEffect({ runId: r1.runId, findingId: f["finding-3"]!, findingKey: "finding-3", kind: "create_followup", target: `followup:run:${r1.runId}:finding-3`, status: "needs_review",
      reason: "missing_date", at: r1At });
    await seedEffect({ runId: r1.runId, findingId: f["finding-5"]!, findingKey: "finding-5", kind: "set_contact_type", target: `interaction:${c1.callId}`, targetId: c1.callId, status: "no_change", at: r1At });
    await withTransaction(session => openReview(workerContext(session, String(O()), r1At), key, "unclear_commitment", `finding:${f["finding-8"]}`, [f["finding-8"]!]));

    // R2: conversation run on the second call (analyze_v4). It owns the call's work effects (fu1 completed, fu2 created). The
    // relations and the story discrepancy live on R3, the Number's newest run, which is what the analysis page reads (SEED-FIX,
    // DECISIONS 2026-09-23 "Relations and record disputes come from the newest run").
    const r2At = plus(c2.at, HOUR);
    const story: RecordRef[] = [{ record_type: "story_event", record_id: `lead_message_sent:${lm}`, fields: { kind: "lead_message_sent", happened_at: plus(receivedAt, 150_000).toISOString(),
      description: "A quote request confirmation text was sent to the customer and delivered." } },
      { record_type: "granot_state", record_id: `FormLead:${s.lead.id}`, fields: { granot_priority: "1", priority_label: "Quoted", quoted: true, estimate: "4200.00" } }];
    const r2 = await seedRun({ number: n, recordId: s.recordId, conversation: c2, summaries: [c2], at: r2At, prompt: "sales_intelligence_analyze_v4",
      summary: { overview: "Priya still plans the Tampa to Charlotte move next month. The competing quote dropped to $3,500 and she never received the confirmation text. Rep will send the estimate tonight and call Friday.",
        customer_wanted: "A written estimate that beats $3,500.", money_and_dates: "Competing quote $3,500; callback Friday; move next month.", outcome: "Estimate to be sent tonight.",
        commitments: "Rep will send the estimate tonight and call Friday.", discrepancies: "Customer says the confirmation text never arrived." },
      context: [leadRecord, outreachRecord, { record_type: "followup", record_id: fu1, fields: { status: "open", description: "Call back with the estimate", due_at: plus(c1.at, 2 * DAY).toISOString(), origin: "rep_promise" } },
        { record_type: "interaction", record_id: c2.callId, fields: { direction: "Outbound", result: "Call connected", duration_seconds: 610, occurred_at: c2.at.toISOString() } }],
      story,
      findings: [
        { key: "finding-1", kind: "next_step", actor: "rep", action_status: "promised", claim: "Rep will send the written estimate tonight.", value: { action_kind: "send_estimate",
          description: "Send the written estimate", date_text: "tonight", timezone_text: null, target_followup_id: null }, evidence: [t(c2, [3], "I will send the written estimate tonight"),
          rec("__story__", "story_event", `lead_message_sent:${lm}`, ["description"])] },
        { key: "finding-2", kind: "completion_claim", actor: "rep", action_status: "completed", claim: "This call is the callback the rep promised on the first call.",
          value: { action_kind: "call", description: "Promised callback made", date_text: null, timezone_text: null, target_followup_id: fu1 }, evidence: [t(c2, [1]),
          rec("__context__", "followup", fu1, ["status", "due_at"])] },
        { key: "finding-3", kind: "quoted_amount", claim: "The competing quote is now $3,500.", value: { amount_text: "thirty five hundred", currency: "USD", meaning: "competitor_quote" },
          evidence: [t(c2, [4])], resolved: { due_at: null, amount_cents: 350000, original_wording: "thirty five hundred", assumptions: [], uncertain: false } },
        { key: "finding-4", kind: "promised_callback", actor: "rep", action_status: "promised", claim: "Rep promised to call Friday.", value: { action_kind: "call", description: "Call Friday about the estimate",
          date_text: "Friday", timezone_text: null, target_followup_id: null }, evidence: [t(c2, [3, 6])],
          resolved: { due_at: ahead(1, 3), amount_cents: null, original_wording: "Friday", assumptions: ["Friday 10:00 AM ET"], uncertain: false } },
      ] });
    const g = r2.ids;
    // The completion claim completes the first call's follow-up through the shared store.
    await withTransaction(async session => {
      const context = workerContext(session, String(O()), r2At);
      const record = await recordForUpdate(s.recordId, context);
      const prior = record.toObject();
      const action = await Followups.findById(fu1).session(session).orFail();
      const before = action.toObject();
      Object.assign(action, { status: "completed", completed_at: c2.at, completion_basis: "rep_confirmation", disposition: "spoke_with_customer", evidence_interaction_id: O(c2.callId),
        completion_finding_id: O(g["finding-2"]) });
      await saveFollowup(action, before, context, key, "intelligence_followup_completed");
      await refreshRecord(record, context, "intelligence_effects_applied", prior, { run_id: r2.runId });
    });
    await seedEffect({ runId: r2.runId, findingId: g["finding-2"]!, findingKey: "finding-2", kind: "complete_followup", target: `followup:run:${r1.runId}:finding-1`, targetId: fu1, status: "applied", at: r2At });
    const fu2 = await intelligenceFollowup(s.recordId, { kind: "call", description: "Call Friday about the estimate", due: ahead(1, 3), findingId: g["finding-4"]!, runId: r2.runId,
      anchor: r2At, promisedBy: agentId(1), commitment: `run:${r2.runId}:finding-4` });
    await seedEffect({ runId: r2.runId, findingId: g["finding-4"]!, findingKey: "finding-4", kind: "create_followup", target: `followup:run:${r2.runId}:finding-4`, targetId: fu2, status: "applied", at: r2At });

    // Three Owner notes through the real `add_note` command (each writes a `description` Owner instruction) before the Number run,
    // which is shown them and assesses each one: agrees / disagrees / cannot_determine (final spec §11.5, §18 row 7).
    await ownerNote(s.recordId, "Customer asked for the estimate in writing, not by text.");
    await ownerNote(s.recordId, "Customer already booked with another mover; stop working this Lead.");
    await ownerNote(s.recordId, "Customer prefers calls after 5 PM ET.");
    const notes = await getSalesIntelligenceOwnerInstructionModel().find({ subject_key: key, field: "description" }).sort({ happened_at: 1, _id: 1 }).lean();
    if (notes.length !== 3) throw new Error(`S-findings: expected 3 Owner instructions, found ${notes.length}`);
    const shown = notes.map(row => ({ id: String(row.instruction_id), revision: row.revision }));

    // R3: the Number's newest run (synthesis over all three calls; a Number run owns no work effects). It carries the prior
    // relations of all five kinds (to R1's findings), the story discrepancy, the Owner instruction assessments and a
    // next-step suggestion the Owner applies. `seedRun` runs the real `applyPriorRelations` for its bookkeeping.
    const r3At = plus(c3.at, 2 * HOUR);
    const r3 = await seedRun({ number: n, recordId: s.recordId, conversation: null, summaries: [c1, c2, c3], at: r3At, prompt: "sales_intelligence_analyze_v4",
      summary: { overview: "Priya is moving a two bedroom apartment from Tampa to Charlotte next month. She is comparing Vantage against a $3,500 competing quote and is waiting on the written estimate. The latest call reached voicemail. A Friday callback is promised.",
        customer_wanted: "A written estimate below $3,500.", money_and_dates: "Competing quote $3,500; Friday callback; move next month.", outcome: "Waiting on the estimate; voicemail left.",
        commitments: "Rep promised a Friday callback.", discrepancies: "Customer says the confirmation text never arrived." },
      context: [leadRecord, outreachRecord, { record_type: "followup", record_id: fu1, fields: { status: "completed", description: "Call back with the estimate",
        due_at: plus(c1.at, 2 * DAY).toISOString(), origin: "rep_promise" } }],
      story,
      prior: [
        ...(["finding-1", "finding-2", "finding-4", "finding-6", "finding-9"] as const).map(k => ({ record_type: "prior_finding", record_id: f[k]!, fields: { kind: k, run_id: r1.runId,
          conversation_id: c1.conversationId, review_state: "unreviewed", happened_at: c1.at.toISOString(), description: `Earlier finding ${k}` } })),
        { record_type: "prior_summary", record_id: c1.summaryId!, fields: { conversation_id: c1.conversationId, happened_at: c1.at.toISOString(), description: "First call summary" } },
      ],
      instructions: [
        { ...shown[0]!, assessment: "agrees", reason: "The customer asked not to be texted, and the rep promised to send the written estimate." },
        { ...shown[1]!, assessment: "disagrees", reason: "On the latest calls the customer is still waiting on Vantage's written estimate and comparing a $3,500 quote." },
        { ...shown[2]!, assessment: "cannot_determine", reason: "The calls do not mention a preferred time of day." },
      ],
      findings: [
        { key: "finding-1", kind: "intent", claim: "Customer is still actively planning the move.", value: { intent: "moving_inquiry" },
          evidence: [t(c2, [4]), rec("__context__", "lead", leadRecord.record_id, ["move_date"])] },
        { key: "finding-2", kind: "next_step", actor: "rep", action_status: "promised", claim: "Rep will send the revised written estimate before the Friday call.",
          value: { action_kind: "send_estimate", description: "Send the revised written estimate", date_text: "before Friday", timezone_text: null, target_followup_id: null },
          evidence: [t(c2, [3], "I will send the written estimate tonight")] },
        { key: "finding-3", kind: "completion_claim", actor: "rep", action_status: "completed", claim: "The second call was the callback the rep promised on the first call.",
          value: { action_kind: "call", description: "Promised callback made", date_text: null, timezone_text: null, target_followup_id: fu1 },
          evidence: [t(c2, [1]), rec("__context__", "followup", fu1, ["status", "due_at"])] },
        { key: "finding-4", kind: "quoted_amount", claim: "The competing quote is now $3,500.", value: { amount_text: "thirty five hundred", currency: "USD", meaning: "competitor_quote" },
          evidence: [t(c2, [4]), rec("__prior__", "prior_finding", f["finding-4"]!, ["description"])],
          resolved: { due_at: null, amount_cents: 350000, original_wording: "thirty five hundred", assumptions: [], uncertain: false } },
      ],
      relations: [
        { prior_finding_id: f["finding-6"], relation: "superseded", by_finding_key: "finding-2", evidence: [t(c2, [3])], note: "The estimate is now promised before the Friday call." },
        { prior_finding_id: f["finding-1"], relation: "fulfilled", by_finding_key: "finding-3", evidence: [t(c2, [1])], note: "The second call is the promised callback." },
        { prior_finding_id: f["finding-4"], relation: "contradicted", by_finding_key: "finding-4", evidence: [t(c2, [4])], note: "The competing quote changed from $4,000 to $3,500." },
        { prior_finding_id: f["finding-9"], relation: "still_true", by_finding_key: null, evidence: [t(c2, [1])], note: null },
        { prior_finding_id: f["finding-2"], relation: "cannot_determine", by_finding_key: null, evidence: [], note: "Texting was not discussed on the later calls." },
      ],
      discrepancies: [{ story_event_id: `lead_message_sent:${lm}`, claim: "Customer says the confirmation text never arrived.",
        evidence: [t(c2, [2], "I never got the confirmation text you mentioned."), rec("__story__", "story_event", `lead_message_sent:${lm}`, ["description"])] }],
      suggestion: { action_kind: "send_estimate", description: "Send the revised written estimate before the Friday call", date_text: "before Friday", timezone_text: null, target_followup_id: null,
        rationale: "The customer is waiting on the estimate and has a lower competing quote.", finding_keys: ["finding-2"] } });
    const artifact = await assess(s.recordId, "default");

    // Owner commands through the real command paths: retract one finding, apply the Number run's suggestion.
    await commandAnalysis({ actor: ownerActor(`${ADMIN}/findings/${f["finding-7"]}/retract`), target_id: f["finding-7"]!, idempotency_key: `fui-retract-${f["finding-7"]}`,
      command: { command: "retract_finding", expected_revision: 1, expected_output_digest: payloadHash((await Runs.findById(r1.runId).lean())!.output), reason: "The customer was joking about the price." } });
    const run3 = (await Runs.findById(r3.runId).lean())!, record = (await Records.findById(s.recordId).lean())!;
    await commandAnalysis({ actor: ownerActor(`${ADMIN}/analysis-runs/${r3.runId}/apply-suggestion`), target_id: r3.runId, idempotency_key: `fui-apply-${r3.runId}`,
      command: { command: "apply_suggestion", expected_revision: run3.revision, run_id: r3.runId, suggestion_output_digest: payloadHash(run3.output!.next_step_suggestion),
        due_at: ahead(2).toISOString(), expected_revisions: [{ target: "outreach", id: s.recordId, revision: record.revision }] } });
    row("S-findings", ["work_applied", "work_blocked", "work_needs_review_effect", "work_needs_review_item", "work_not_applicable", "work_superseded", "work_retracted",
      "relation_bookkeeping_effects", "relations_all_kinds", "story_discrepancies", "newest_run_relations", "newest_run_story_discrepancies", "owner_instruction_assessments",
      "lead_message", "number_run", "conversation_run", "suggestion_applied", "suggestion_applied_followup", "rep_identity_reviewed", "media_retained",
      "transcript_segments", "summary_snapshot_move_evidence", "move_date_future"], { outreach_record_id: s.recordId, contact_number_id: n.id, lead_refs: leadIds(s.lead),
      conversation_ids: [c1.conversationId, c2.conversationId, c3.conversationId], run_ids: [r1.runId, r2.runId, r3.runId], artifact_ids: [artifact],
      finding_ids: [...Object.values(f), ...Object.values(g), ...Object.values(r3.ids)],
      note: "R1 conversation run (every work_result); R2 conversation run (its call's effects: fu1 completed, fu2 created); R3 = newest_run_id, Number run with relations of five kinds + "
        + "story discrepancy (real applyPriorRelations bookkeeping), 3 Owner instruction assessments (agrees/disagrees/cannot_determine) and an applied suggestion" });
  }

  // 6b. Card suggestion (final spec §5.5 case 2) and the empty relations state (SEED-FIX): an open Lead with no follow-up whose
  // newest run is a Number run with an unapplied next_step_suggestion and no prior_finding_relations / story_discrepancies.
  // The call carries no commitment, so its conversation run records no findings and no work; nothing creates a follow-up.
  {
    const s = await leadSubject({ receivedDaysAgo: 5, fields: { move_date: utcMidnight(etDay(ahead(40))), pickup_city: "Orlando", pickup_state: "FL",
      delivery_city: "Atlanta", delivery_state: "GA", move_size: "3 Bedroom" } });
    const n = s.number!;
    const c1 = await seedConversation(n, { call: { at: ago(3), direction: "Inbound", result: "Call connected", duration: 260 }, lead: s.lead,
      lines: [["rep", "Thanks for calling Vantage Movers, this is Dana. How can I help?"], ["customer", "We are moving from Orlando to Atlanta in about six weeks."],
        ["rep", "Is it a house or an apartment?"], ["customer", "A three bedroom house. I want to see a price before I decide anything."],
        ["rep", "Understood, I have your details on file."], ["customer", "Okay, thanks."]],
      said: [{ kind: "intent", claim: "Customer is planning a move in about six weeks.", value: { intent: "moving_inquiry" }, actor: "customer", clarity: "clear", action_status: null,
        speaker: "customer", segment_ids: [2], quote: null }],
      moveEvidence: { observations: [
        { field: "pickup_location", value: { line: null, city: "Orlando", state: "FL", zip: null, precision: "city" }, status: "stated", speaker: "customer", segment_ids: [2] },
        { field: "delivery_location", value: { line: null, city: "Atlanta", state: "GA", zip: null, precision: "city" }, status: "stated", speaker: "customer", segment_ids: [2] },
        { field: "move_size", value: { value: { min: 3, max: 3 }, unit: "bedrooms", text: "three bedroom house", basis: "customer_stated" }, status: "stated", speaker: "customer", segment_ids: [4] }],
        inventory: [], intent_signals: [{ signal: "definite_move", text: "We are moving in about six weeks.", speaker: "customer", segment_ids: [2] }] },
      summary: { overview: "Customer is moving a three bedroom house from Orlando to Atlanta in about six weeks and wants a price first.", customer_wanted: "A price before deciding.",
        money_and_dates: "No price discussed; moving in about six weeks.", outcome: "No next step agreed.", commitments: "", discrepancies: "" } });
    const t = (segs: number[]) => ({ source: "transcript", snapshot_id: c1.summaryId!, conversation_id: c1.conversationId, transcript_version: c1.version, segment_ids: segs, quote: null });
    const ra = await seedRun({ number: n, recordId: s.recordId, conversation: c1, summaries: [c1], at: plus(c1.at, HOUR), prompt: "sales_intelligence_analyze_v4",
      summary: { overview: "Customer is moving a three bedroom house from Orlando to Atlanta in about six weeks and wants a price first.", customer_wanted: "A price before deciding.",
        money_and_dates: "No price discussed; moving in about six weeks.", outcome: "No next step agreed.", commitments: "", discrepancies: "" }, findings: [] });
    const rb = await seedRun({ number: n, recordId: s.recordId, conversation: null, summaries: [c1], at: plus(c1.at, 3 * HOUR), prompt: "sales_intelligence_analyze_v4",
      summary: { overview: "The customer is moving a three bedroom house from Orlando to Atlanta in about six weeks. They want a price before deciding and no next step is set.",
        customer_wanted: "A price for the move.", money_and_dates: "No price yet; move in about six weeks.", outcome: "No next step agreed.", commitments: "", discrepancies: "" },
      context: [{ record_type: "outreach", record_id: s.recordId, fields: { status: "open", description: `Outreach for ${s.lead.name}` } }],
      prior: [{ record_type: "prior_summary", record_id: c1.summaryId!, fields: { conversation_id: c1.conversationId, happened_at: c1.at.toISOString(), description: "Call summary" } }],
      findings: [{ key: "finding-1", kind: "intent", claim: "Customer is actively planning the move and wants a price.", value: { intent: "moving_inquiry" }, evidence: [t([2, 4])] }],
      suggestion: { action_kind: "call", description: "Call with a price for the Orlando to Atlanta move", date_text: "tomorrow", timezone_text: null, target_followup_id: null,
        rationale: "The customer asked for a price before deciding and no follow-up is set.", finding_keys: [] } });
    row("S-suggestion-open", ["suggestion_unapplied_no_followup", "newest_number_run_no_relations", "followup_none", "number_run", "conversation_run"], { outreach_record_id: s.recordId,
      contact_number_id: n.id, lead_refs: leadIds(s.lead), conversation_ids: [c1.conversationId], run_ids: [ra.runId, rb.runId],
      note: "Open record, no follow-up; newest run (Number run) has an unapplied next_step_suggestion and no relations or discrepancies (§5.5 case 2, empty §11.1/§11.5 lists)" });
  }

  // 7. Legacy (pre-structured) conversation: analyze_v2 envelope, no step-1 summary snapshot, legacy summary keys.
  {
    const s = await leadSubject({ model: "CallLead", receivedDaysAgo: 16 });
    const c = await seedConversation(s.number!, { call: { at: ago(15), direction: "Inbound", result: "Call connected", duration: 330 }, lead: s.lead, summary: null });
    const run = await seedRun({ number: s.number!, recordId: s.recordId, conversation: c, summaries: [], at: plus(c.at, 2 * HOUR), prompt: "sales_intelligence_analyze_v2", legacy: true,
      summary: { overview: "Legacy analysis: the caller asked about a local move and wanted a quote by phone.", customer_wanted: "A phone quote for a local move.",
        money_and_dates: "No price discussed; moving in about three weeks.", outcome: "Rep took the details.", commitments: "Rep said someone would call back.",
        discrepancies: "Caller gave a different last name than the Lead." }, findings: [] });
    const artifact = await assess(s.recordId, "default");
    row("S-legacy", ["legacy_conversation", "conversation_run"], { outreach_record_id: s.recordId, contact_number_id: s.number!.id, lead_refs: leadIds(s.lead), conversation_ids: [c.conversationId],
      run_ids: [run.runId], artifact_ids: [artifact], note: "Legacy analyze_v2 run; LeadConversation.summary.sections under money_dates/promised/mismatch; no summary snapshot" });
  }

  // 8. Purged audio with the transcript kept, and retained media; the newest run is a conversation run.
  {
    const s = await leadSubject({ receivedDaysAgo: 12 });
    const c1 = await seedConversation(s.number!, { call: { at: ago(11), direction: "Inbound", result: "Call connected", duration: 290 }, lead: s.lead, media: "purged" });
    const c2 = await seedConversation(s.number!, { call: { at: ago(5), direction: "Outbound", result: "Call connected", duration: 180 }, lead: s.lead, media: "retained" });
    const t = (c: SeededConversation, segs: number[]) => ({ source: "transcript", snapshot_id: c.summaryId!, conversation_id: c.conversationId, transcript_version: c.version, segment_ids: segs, quote: null });
    const run = await seedRun({ number: s.number!, recordId: s.recordId, conversation: c1, summaries: [c1], at: plus(c1.at, HOUR), prompt: "sales_intelligence_analyze_v4",
      summary: { overview: "Customer described the move; the recording audio was later removed under retention but the transcript is kept.", customer_wanted: "An estimate.",
        money_and_dates: "About $4,000 competing quote.", outcome: "Rep will call back.", commitments: "Callback Thursday.", discrepancies: "" },
      findings: [{ key: "finding-1", kind: "promised_callback", actor: "rep", action_status: "promised", claim: "Rep promised a Thursday callback.", value: { action_kind: "call",
        description: "Thursday callback", date_text: "Thursday", timezone_text: null, target_followup_id: null }, evidence: [t(c1, [5])] }] });
    row("S-audio-purged", ["audio_purged_transcript_kept", "media_retained", "conversation_run"], { outreach_record_id: s.recordId, contact_number_id: s.number!.id, lead_refs: leadIds(s.lead),
      conversation_ids: [c1.conversationId, c2.conversationId], run_ids: [run.runId], note: "First conversation: media.purged_at set, transcript snapshot kept; second: media retained" });
  }

  // 9. Open Lead with Granot progress: Priority set (unpaired), Priority changed (paired), Quoted changed (paired).
  {
    const receivedAt = ago(10);
    const number = await seedNumber(receivedAt);
    const lead = await seedLead("FormLead", number.ten, receivedAt, { granot_priority: "1", quoted: true });
    await attach(number.id, lead, receivedAt);
    await seedCalls(number.id, number.e164, [{ at: plus(receivedAt, 30 * 60_000), direction: "Outbound", result: "Call connected", duration: 240, contact: "human_conversation" }]);
    await leadChange(lead, plus(receivedAt, 5 * 60_000), [{ path: "granot_priority", before: null, after: "0" }, { path: "quoted", before: null, after: false }], null);
    const o1At = ago(3, 2), o1 = await observation(lead, number.ten, o1At, "1", "Marcus B.", true);
    await leadChange(lead, plus(o1At, 15 * 60_000), [{ path: "granot_priority", before: "0", after: "1" }], o1);
    const o2At = ago(3), o2 = await observation(lead, number.ten, o2At, "1", "Marcus B.", true);
    await leadChange(lead, plus(o2At, 12 * 60_000), [{ path: "quoted", before: false, after: true }], o2);
    const recordId = await seedRecord(lead, number.id);
    row("S-granot-open", ["priority_change_paired", "priority_change_unpaired", "quoted_change"], { outreach_record_id: recordId, contact_number_id: number.id, lead_refs: leadIds(lead),
      note: "Priority 0 set with no observation; Priority 0→1 and Quoted paired through provenance.observation_id" });
  }

  // 10. A subject with 60 calls (timeline timing A17).
  {
    const s = await leadSubject({ receivedDaysAgo: 45 });
    const specs: CallSpec[] = Array.from({ length: 54 }, (_, i) => {
      const inbound = rand() < 0.35, connected = rand() < 0.5;
      return { at: ago(45 - i * 0.8, rand() * 5), direction: inbound ? "Inbound" : "Outbound", result: connected ? "Call connected" : inbound ? "Missed" : pick(["No Answer", "Voicemail", "Busy"]),
        connected, duration: connected ? Math.floor(20 + rand() * 500) : 0, name: inbound ? "WIRELESS CALLER" : undefined,
        // Rep identity mix (no extra rand draw): 101 reviewed → name, 102 no link → unknown, 103 proposed only → name null.
        extension: (["101", "102", "103"] as const)[i % 3] };
    });
    await seedCalls(s.number!.id, s.number!.e164, specs);
    const conversations: SeededConversation[] = [];
    for (let i = 0; i < 6; i++) conversations.push(await seedConversation(s.number!, { call: { at: ago(40 - i * 7), direction: i % 2 ? "Outbound" : "Inbound", result: "Call connected",
      duration: 200 + i * 30 }, lead: s.lead }));
    const last = conversations.at(-1)!;
    const run = await seedRun({ number: s.number!, recordId: s.recordId, conversation: last, summaries: [last], at: plus(last.at, HOUR), prompt: "sales_intelligence_analyze_v4",
      summary: { overview: "Long-running customer with many calls; still comparing quotes.", customer_wanted: "A lower price.", money_and_dates: "Around $4,000.", outcome: "No decision yet.",
        commitments: "", discrepancies: "" }, findings: [] });
    row("S-calls-60", ["calls_50", "conversation_run", "rep_identity_reviewed", "rep_identity_unreviewed"], { outreach_record_id: s.recordId, contact_number_id: s.number!.id, lead_refs: leadIds(s.lead),
      conversation_ids: conversations.map(c => c.conversationId), run_ids: [run.runId], note: "60 canonical calls (54 plain on extensions 101 reviewed / 102 unlinked / 103 proposed, + 6 with conversations on 101)" });
  }

  // 11. A subject with 300+ mixed timeline events (cursor exactness B12).
  {
    const s = await leadSubject({ receivedDaysAgo: 88, fields: { granot_priority: "1", quoted: false } });
    const n = s.number!;
    const specs: CallSpec[] = Array.from({ length: 150 }, (_, i) => {
      const inbound = rand() < 0.3, connected = rand() < 0.45;
      return { at: ago(87 - i * 0.55, rand() * 3), direction: inbound ? "Inbound" : "Outbound", result: connected ? "Call connected" : inbound ? "Missed" : pick(["No Answer", "Voicemail"]),
        connected, duration: connected ? Math.floor(15 + rand() * 400) : 0, contact: connected && rand() < 0.3 ? "voicemail" : "unknown" };
    });
    await seedCalls(n.id, n.e164, specs);
    const chain = ["0", "1", "3", "1", "0", "1"];
    let priorPriority: string | null = null;
    for (let i = 0; i < 60; i++) {
      const at = ago(86 - i * 1.4, rand() * 2), next = chain[i % chain.length]!;
      const paired = i % 3 === 0 ? await observation(s.lead, n.ten, plus(at, -(5 + Math.floor(rand() * 40)) * 60_000), next, pick(["Dana R.", "Marcus B."]), false) : null;
      if (i % 7 === 3) {
        await leadChange(s.lead, at, [{ path: "quoted", before: false, after: true }], paired);
        await leadChange(s.lead, plus(at, 30 * 60_000), [{ path: "quoted", before: true, after: false }], null);
      } else {
        await leadChange(s.lead, at, [{ path: "granot_priority", before: priorPriority, after: next }], paired);
        priorPriority = next;
      }
    }
    await db.collection("form_leads").updateOne({ _id: O(s.lead.id) }, { $set: { granot_priority: priorPriority, quoted: false } });
    for (let i = 0; i < 45; i++) await leadMessage(s.lead, n.e164, ago(85 - i * 1.8, rand() * 4), pick(["delivered", "sent", "failed"]));
    for (let i = 0; i < 25; i++) await ownerFollowup(s.recordId, Math.floor(-200 + rand() * 400), `Follow-up ${i + 1}: check in about the estimate`);
    const conversations: SeededConversation[] = [];
    for (let i = 0; i < 8; i++) conversations.push(await seedConversation(n, { call: { at: ago(80 - i * 9), direction: i % 2 ? "Outbound" : "Inbound", result: "Call connected",
      duration: 150 + i * 20 }, lead: s.lead }));
    await seedRecord(s.lead, n.id);
    row("S-timeline-300", ["timeline_300", "calls_50", "lead_message", "priority_change_paired", "priority_change_unpaired", "quoted_change"], { outreach_record_id: s.recordId,
      contact_number_id: n.id, lead_refs: leadIds(s.lead), conversation_ids: conversations.map(c => c.conversationId),
      note: "158 calls, 60+ Lead changes (priority churn and quoted flips, a third paired), 45 Lead Messages, 25 follow-ups, 8 conversations" });
  }

  // ════════════════════════════════════════════════════════════════════════════════════════
  // Projections through the real code paths
  // ════════════════════════════════════════════════════════════════════════════════════════
  const numberIds = (await Numbers.find({}).select("_id revision").lean()).map(r => ({ id: String(r._id), revision: r.revision }));
  await withTransaction(async session => {
    for (const { id, revision } of numberIds) await enqueueCsiJob({ stage: "rebuild", subject_key: `number:${id}`, dedupe_key: `csi:rebuild:number:${id}:seed-finalui`,
      input_revision: revision, input_refs: [id] }, session);
  });
  const rebuild = await drainRebuildJobs(numberIds.length + 10);
  if (rebuild.completed !== numberIds.length) throw new Error(`rebuild completed ${rebuild.completed} of ${numberIds.length}: ${JSON.stringify(rebuild)}`);
  const snapshot = await publishAttentionSnapshot({ attentionV2: ATTENTION_V2 });
  if (snapshot.status !== "published") throw new Error(`attention publish: ${JSON.stringify(snapshot)}`);

  // ── manifest: collection in the seed DB + a copy for the contract workspace ──────────────
  await db.collection(SI_SEED_MANIFEST).insertMany(manifest.map(m => ({ ...m, seeded_at: new Date(NOW) })));
  mkdirSync(SI_CONTRACTS_DIR, { recursive: true });
  writeFileSync(resolve(SI_CONTRACTS_DIR, "seed-manifest.json"), `${JSON.stringify({ database: DATABASE, seeded_at: new Date(NOW).toISOString(),
    snapshot_id: "snapshot_id" in snapshot ? snapshot.snapshot_id : null, rows: manifest }, null, 2)}\n`);
  const artifacts = await getMoveAssessmentArtifactModel().countDocuments({});
  console.log(`\nFinal-UI seed: database ${DATABASE} (loopback csi01). Subjects ${manifest.length}, Numbers ${numberIds.length}, artifacts ${artifacts}, ` +
    `mocked model calls ${mock.calls()}. Rebuild ${JSON.stringify(rebuild)}. Attention ${JSON.stringify(snapshot)}. ${((Date.now() - started) / 1000).toFixed(1)} s`);
  console.table(manifest.map(m => ({ label: m.label, states: m.states.join(","), outreach: m.outreach_record_id, number: m.contact_number_id })));
  await mongoose.disconnect();
}
(PUBLISH_ONLY ? republishAttention() : main()).then(() => process.exit(0)).catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exit(1); });
