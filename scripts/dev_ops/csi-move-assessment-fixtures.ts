/**
 * Synthetic Move assessment fixtures shared by the MA-02 replica proof and the browser
 * demo seed. Loopback replica only; callers set the environment before importing.
 * Nothing here calls a model or the network: `mockAssessmentModel` is `MockLanguageModelV4`.
 */
import mongoose from "mongoose";
import { withTransaction } from "../../src/db";
import { csiDataset } from "../../src/config/domain/salesIntelligence";
import { getFormLeadModel } from "../../src/models/FormLead";
import { getCallLeadModel } from "../../src/models/CallLead";
import { getContactNumberModel } from "../../src/models/ContactNumber";
import { getCallInteractionModel } from "../../src/models/CallInteraction";
import { getLeadConversationModel } from "../../src/models/LeadConversation";
import { getIntelligenceEvidenceSnapshotModel } from "../../src/models/IntelligenceEvidenceSnapshot";
import { getIntelligenceRunModel } from "../../src/models/IntelligenceRun";
import { ensureLead, workerContext } from "../../src/services/salesIntelligence/outreach/ensure";
import { readContentSchema } from "../../src/services/salesIntelligence/analysis/reads";
import { payloadHash } from "../../src/services/salesIntelligence/transactions";
import type { AssessmentPromptPayload } from "../../src/services/salesIntelligence/assessment/context";
import type { MoveAssessmentModelOutput } from "../../src/services/salesIntelligence/assessment/contract";

export const MARK = { segment: "SECRET-TRANSCRIPT-SEGMENT-TEXT", rationale: "RATIONALE-MARKER" } as const;
export type LeadModel = "FormLead" | "CallLead";
const oid = () => new mongoose.Types.ObjectId();
let serial = 0;

export async function seedNumber(digits = `202556${String(1000 + ++serial).slice(-4)}`) {
  return getContactNumberModel().create({ e164: `+1${digits}`, national_ten: digits, digits_reversed: digits.split("").reverse().join(""),
    first_observed_at: new Date("2026-09-01T12:00:00Z"), last_activity_at: new Date("2026-09-01T12:00:00Z"), kind: "external", classification: "customer" });
}

export async function seedLead(model: LeadModel, digits: string, fields: Record<string, unknown> = {}) {
  const _id = oid(), at = new Date("2026-09-01T12:00:00Z");
  await (model === "FormLead" ? getFormLeadModel() : getCallLeadModel()).collection.insertOne({ _id, timestamp: at, createdAt: at, updatedAt: at,
    name: `Synthetic ${model} ${++serial}`, normalized_phone_number: digits, source_company: "Top10", quoted: false, domain_revision: 0, ...fields } as never);
  return { model, id: String(_id), _id };
}

/** The Outreach Record exactly as the Lead projection creates it, linked to the Number. */
export async function seedRecord(ref: { model: LeadModel; id: string }, numberId: string) {
  const record = await withTransaction(session => ensureLead(ref, workerContext(session, String(oid())), numberId));
  if (!record) throw new Error("ensureLead returned no record");
  return String(record._id);
}

async function conversation(numberId: string, at: Date, version: string) {
  const key = `ma-${++serial}-${Date.now()}`;
  const call = await getCallInteractionModel().create({ provider_account_id: "synthetic", telephony_session_id: key, identity_basis: "telephony_session_id",
    contact_number_id: numberId, direction: "Inbound", started_at: at, first_observed_at: at, last_observed_at: at, terminal: true,
    inbound_route_id: "a".repeat(24), parties: [], recordings: [{ provider_recording_id: key, observed_at: at }] });
  const row = await getLeadConversationModel().create({ provider: "ringcentral", provider_account_id: "synthetic", provider_recording_id: key,
    call_interaction_id: call._id, contact_number_id: numberId, started_at: at, direction: "Inbound", match_method: "number_only",
    match_confidence: "low", state: "transcribed", latest_transcript_version: version, media_digest_sha256: "b".repeat(64) });
  const segments = [{ sid: 1, text: `${MARK.segment} customer describes the move in detail.`, start_ms: null, end_ms: null, speaker: "customer", timing_source: "unavailable" }];
  const transcript = await getIntelligenceEvidenceSnapshotModel().create({ ...csiDataset(), conversation_id: row._id, transcript_version: version,
    source_type: "transcript", source_id: String(row._id), source_revision: "b".repeat(64), arguments: {}, response: {}, retrieved_at: at, happened_at: at,
    content_digest: payloadHash(segments), subject_key: `conversation:${row._id}`, completeness: { complete: true, missing_ranges: [] }, segments });
  return { conversation: row, transcript };
}

export type SummaryText = { overview: string; customer_wanted?: string; money_and_dates?: string; outcome?: string; commitments?: string; discrepancies?: string };
export type SaidFact = { claim: string; speaker?: "customer" | "rep" | "unknown" };

/** A conversation whose canonical structured summary artifact covers its current transcript version. */
export async function seedSummaryConversation(numberId: string, at: Date, summary: SummaryText, said: SaidFact[] = []) {
  const version = `ma-v${++serial}`;
  const { conversation: row, transcript } = await conversation(numberId, at, version);
  const response = readContentSchema.parse({ page: { records: [], complete: true, next_cursor: null, missing_ranges: [] },
    coverage: { known_through: null, gaps: [], capabilities: { call_log: "unknown" }, ai_paused: false }, instructions: [], speaker_refs: [], allowed_followup_ids: [],
    transcript: { conversation_id: String(row._id), transcript_version: version, source_snapshot_id: String(transcript._id), segments: [] },
    analysis_summary: { summary: { customer_wanted: "", money_and_dates: "", outcome: "", commitments: "", discrepancies: "", ...summary },
      said_on_call: said.map(fact => ({ kind: "intent", claim: fact.claim, value: { intent: "moving_inquiry" }, actor: fact.speaker === "rep" ? "rep" : "customer",
        clarity: "clear", action_status: null, speaker: fact.speaker ?? "customer", segment_ids: [1], quote: null })) } });
  const artifact = await getIntelligenceEvidenceSnapshotModel().create({ ...csiDataset(), conversation_id: row._id,
    source_type: "summary", artifact_key: payloadHash({ synthetic: serial, version }), source_id: String(transcript._id), arguments: {}, response,
    retrieved_at: at, happened_at: at, content_digest: payloadHash(response), subject_key: `conversation:${row._id}`,
    completeness: { complete: true, missing_ranges: [] }, segments: [] });
  return { conversation: row, transcript, artifact };
}

/** A conversation with only a retained completed legacy (pre-structured) run. */
export async function seedLegacyConversation(numberId: string, at: Date, summary: SummaryText) {
  const version = `ma-legacy-v${++serial}`;
  const { conversation: row, transcript } = await conversation(numberId, at, version);
  const run = oid();
  await getIntelligenceRunModel().collection.insertOne({ _id: run, ...csiDataset(), conversation_id: row._id, contact_number_id: new mongoose.Types.ObjectId(numberId),
    subject_key: `conversation:${row._id}`, status: "completed", completed_at: at, analysis_pipeline: null, purged_at: null, purge_started_at: null,
    // Real legacy runs always carry their pinned versions (schema-required); readers see the same shape here.
    schema_version: "csi-envelope-v1", prompt_version: "sales_intelligence_analyze_v2", model_version: "openai/gpt-5-mini", mode: "initial", revision: 1,
    input_fingerprint: "synthetic", manifest_snapshot_ids: [], evidence_count: 0, evidence_bytes: 0, createdAt: at, updatedAt: at,
    output: { schema_version: "csi-envelope-v1", summary: { customer_wanted: "", money_and_dates: "", outcome: "", commitments: "", discrepancies: "", ...summary, finding_keys: [] },
      findings: [], next_step_suggestion: null, owner_instruction_assessments: [] } } as never);
  return { conversation: row, transcript, run_id: String(run) };
}

export function payloadFromPrompt(prompt: unknown): AssessmentPromptPayload {
  const messages = prompt as Array<{ role: string; content: unknown }>;
  const user = messages.find(m => m.role === "user");
  const text = Array.isArray(user?.content) ? user!.content.map(part => (part as { text?: string }).text ?? "").join("") : String(user?.content ?? "");
  const cut = text.indexOf("\nThe previous");
  return JSON.parse(cut >= 0 ? text.slice(0, cut) : text) as AssessmentPromptPayload;
}

const dimension = (level: MoveAssessmentModelOutput["move_likelihood"]["level"], evidence_ids: string[], extra: Partial<MoveAssessmentModelOutput["move_likelihood"]> = {}) =>
  ({ level, confidence: "medium" as const, rationale: `${MARK.rationale}: ${level} from the cited evidence.`, evidence_ids, conditions: [], ...extra });
export { dimension as syntheticDimension };

/** Default deterministic judgment: conversation evidence → strong/active with one date and one item; Lead-only → active/unknown. */
export function defaultAssessment(payload: AssessmentPromptPayload): MoveAssessmentModelOutput {
  const entries = payload.conversations.flatMap(c => c.entries);
  const lead = [...(payload.views.canonical_current?.entries ?? []), ...(payload.views.original_ingestion?.entries ?? [])];
  if (!entries.length) return { move_likelihood: dimension(lead.length ? "active" : "unknown", lead.slice(0, 1).map(e => e.id)),
    transaction_intent: dimension("unknown", []), move_details: [], inventory: { items: [], coverage: "none", limitations: [] }, conflicts: [] };
  const first = entries[0].id, last = entries.at(-1)!.id;
  return {
    move_likelihood: dimension("strong", [first]), transaction_intent: dimension("active", [last]),
    move_details: [{ field: "move_date", status: "stated", evidence_ids: [first],
      value: { raw_text: "October 15", date: "2026-10-15", end_date: null, applies_to: "pickup", flexibility: "fixed", precision: "exact" } }],
    inventory: { items: [{ label: "Sofa", quantity: { min: 1, max: 1 }, room: "Living room", dimensions: null, handling: null, status: "included", evidence_ids: [first] }],
      coverage: "partial", limitations: [] },
    conflicts: [],
  };
}

export type AssessmentDecider = (payload: AssessmentPromptPayload, attempt: number) => unknown;
export async function mockAssessmentModel(decide: AssessmentDecider = defaultAssessment, options: { cost?: number } = {}) {
  const { MockLanguageModelV4 } = await import("ai/test");
  const prompts: string[] = [], payloads: AssessmentPromptPayload[] = [];
  const model = new MockLanguageModelV4({ doGenerate: async input => {
    if (input.tools?.length) throw new Error("the assessment step never offers tools");
    const text = JSON.stringify(input.prompt);
    prompts.push(text);
    const payload = payloadFromPrompt(input.prompt);
    payloads.push(payload);
    const value = decide(payload, prompts.length);
    if (value instanceof Error) throw value;
    return { content: [{ type: "text", text: JSON.stringify(value) }], finishReason: { unified: "stop", raw: "synthetic" },
      usage: { inputTokens: { total: 900, noCache: 900, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 120, text: 100, reasoning: 20 } },
      warnings: [], providerMetadata: { gateway: { cost: options.cost ?? 0.013 } } };
  } });
  return { model, prompts, payloads, calls: () => prompts.length };
}
