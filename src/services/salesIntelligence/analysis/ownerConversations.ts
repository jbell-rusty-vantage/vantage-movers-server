import mongoose from "mongoose";
import { z } from "zod";
import { csiDataset } from "../../../config/domain/salesIntelligence";
import { getCallInteractionModel } from "../../../models/CallInteraction";
import { getContactNumberModel } from "../../../models/ContactNumber";
import { getIntelligenceEvidenceSnapshotModel } from "../../../models/IntelligenceEvidenceSnapshot";
import { getLeadConversationModel } from "../../../models/LeadConversation";
import { getRepIdentityLinkModel } from "../../../models/RepIdentityLink";
import { csiDateSchema, csiIdSchema } from "../../../validation/v1/salesIntelligence";
import { redactTranscript } from "../../conversations/redaction";
import { ownerRead } from "../../numberActivity/coverage";
import { ownerReadSchema, type CoverageDto } from "../dto";
import { CsiError } from "../auth";
import { formatEtDateTime } from "../assessment/presentation";
import { resolveRepIdentityAt, type TemporalRepLink } from "../repIdentity/resolve";
import { summaryStepSchema } from "./structuredContract";

/**
 * S4-CONV Owner conversation reads (data spec V20, §6.7, §6.8; final spec §11.7).
 *
 * `GET /numbers/:id/conversations`: one card per canonical Call Interaction with a Lead Conversation,
 * newest first, keyset on `(started_at desc, _id desc)` over `call_interactions`
 * (`call_interaction_number_started_id`); calls on the same page without a conversation are listed
 * compactly in `other_calls`. The per-call summary is the **step-1 canonical summary snapshot**
 * (`source_type: "summary"`, the one matching the conversation's current transcript version, else the
 * newest — the selection `prior.ts` uses), never `LeadConversation.summary` (the findings step's
 * synthesis) unless no step-1 snapshot exists (`summary_source: "legacy"`).
 *
 * `GET /conversations/:id/transcript`: the Owner mirror of the worker's `get_call_transcript`
 * (`analysis/reads.ts`): the current `latest_transcript_version` snapshot, a `$slice` of its segments,
 * redacted, with `completeness.missing_ranges`, segment ids, speaker labels and each segment's `at`.
 *
 * GET-only, pure over an injectable store. Query shape is fixed per page (no per-row read): Number,
 * calls, conversations, summary snapshots, transcript snapshots, rep links. No blob URL or pathname is
 * ever selected into a DTO: `media_available` is a boolean.
 */
export const OWNER_CONVERSATIONS_MAX_LIMIT = 100;
export const OWNER_TRANSCRIPT_MAX_LIMIT = 100;

export const CALL_SUMMARY_KEYS = ["overview", "customer_wanted", "money_and_dates", "outcome", "commitments", "discrepancies"] as const;
export type CallSummaryKey = (typeof CALL_SUMMARY_KEYS)[number];
/**
 * The server's section labels. Same strings as `SUMMARY_LABELS` in `assessment/presentation.ts` (not exported
 * there; `ownerConversations.test.ts` reads that literal and fails on any drift). The coordinator patch
 * `S4-CONV-presentation-exports.patch` exports it so this copy can become a re-export.
 */
export const CALL_SUMMARY_LABELS: Readonly<Record<CallSummaryKey, string>> = { overview: "Overview", customer_wanted: "What the customer wanted",
  money_and_dates: "Money and dates", outcome: "Outcome", commitments: "Commitments", discrepancies: "Discrepancies" };
/** `LeadConversation.summary.sections` legacy key for each canonical key (data spec §6.7 legacy fallback). */
export const LEGACY_SUMMARY_KEY: Readonly<Record<CallSummaryKey, string>> = { overview: "overview", customer_wanted: "customer_wanted",
  money_and_dates: "money_dates", outcome: "outcome", commitments: "promised", discrepancies: "mismatch" };
/** Same strings as `PARTY_LABELS` in `assessment/presentation.ts` (evidence `speaker_label`, S3-PRES). */
export const SPEAKER_LABELS = { rep: "Rep", customer: "Customer", unknown: "Speaker unknown" } as const;
export const CONTACT_TYPE_LABELS = { human_conversation: "Human conversation", voicemail: "Voicemail", unknown: "Contact unknown" } as const;
export const DIRECTION_LABELS = { Inbound: "Inbound", Outbound: "Outbound", Internal: "Internal", Unknown: "Direction unknown" } as const;
export const RECORDING_STATES = ["available", "not_recorded", "audio_removed"] as const;
export type RecordingState = (typeof RECORDING_STATES)[number];
export const SUMMARY_SOURCES = ["call_summary", "legacy"] as const;

// ── Query schemas ─────────────────────────────────────────────────────
const CURSOR = /^(\d{1,16})\.([a-f\d]{24})$/i;
export const ownerConversationsQuerySchema = z.object({
  scope: z.literal("production").optional(),
  /** `<started_at ms>.<call interaction id>` from `next_cursor`. */
  cursor: z.string().regex(CURSOR).optional(),
  limit: z.coerce.number().int().min(1).max(OWNER_CONVERSATIONS_MAX_LIMIT).default(50),
}).strict();
export type OwnerConversationsQuery = z.infer<typeof ownerConversationsQuerySchema>;
export const ownerTranscriptQuerySchema = z.object({
  scope: z.literal("production").optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  limit: z.coerce.number().int().min(1).max(OWNER_TRANSCRIPT_MAX_LIMIT).default(100),
}).strict();
export type OwnerTranscriptQuery = z.infer<typeof ownerTranscriptQuerySchema>;

export const encodeConversationCursor = (startedAt: Date, id: unknown) => `${startedAt.getTime()}.${String(id)}`;
export function decodeConversationCursor(cursor: string): { started_at: Date; id: string } {
  const match = CURSOR.exec(cursor);
  if (!match) throw new CsiError("INVALID_INPUT");
  const at = new Date(Number(match[1]));
  if (Number.isNaN(+at)) throw new CsiError("INVALID_INPUT");
  return { started_at: at, id: match[2]!.toLowerCase() };
}

// ── Response schemas (strict; exported for contract fixtures) ─────────
const directionSchema = z.enum(["Inbound", "Outbound", "Internal", "Unknown"]);
const contactTypeSchema = z.enum(["unknown", "voicemail", "human_conversation"]);
export const conversationRepDtoSchema = z.object({
  /** Agent name only when the Rep Identity Link is reviewed at the call time; otherwise null. */
  name: z.string().nullable(),
  status: z.enum(["reviewed", "proposed", "unknown"]),
}).strict();
export const callSummarySectionDtoSchema = z.object({
  key: z.enum(CALL_SUMMARY_KEYS), label: z.string(),
  /** Redacted text; null when the model left the section empty. */
  text: z.string().nullable(),
}).strict();
const callHeaderShape = {
  interaction_id: csiIdSchema,
  started_at: csiDateSchema,
  /** `Tue Sep 23, 3:12 PM ET`. */
  started_at_label: z.string(),
  direction: directionSchema, direction_label: z.string(),
  duration_seconds: z.number().nonnegative().nullable(),
  rep: conversationRepDtoSchema,
  contact_type: contactTypeSchema,
  /** `Human conversation` / `Voicemail` / `Contact unknown`. */
  contact_type_label: z.string(),
  recording_count: z.number().int().nonnegative(),
};
export const conversationCardDtoSchema = z.object({
  ...callHeaderShape,
  conversation_id: csiIdSchema,
  recording_state: z.enum(RECORDING_STATES),
  /** Text after `Recording:` — `available`, `not recorded`, `audio removed under retention; transcript kept`. */
  recording_label: z.string(),
  /** True exactly when `recording_state` is `available`: the player may load `GET /conversations/:id/media`. Never a URL. */
  media_available: z.boolean(),
  /** A retained transcript snapshot exists for the conversation's current transcript version. */
  transcript_available: z.boolean(),
  transcript_version: z.string().nullable(),
  /** `LeadConversation.latest_completed_run_id`. */
  run_id: csiIdSchema.nullable(),
  /** Null when neither a step-1 summary nor a legacy summary is retained (not analysed yet, or content purged). */
  summary_source: z.enum(SUMMARY_SOURCES).nullable(),
  /** The six sections in canonical order when `summary_source` is set; empty otherwise. */
  summary_sections: z.array(callSummarySectionDtoSchema).max(6),
}).strict();
export const otherCallDtoSchema = z.object({
  ...callHeaderShape,
  /** Provider result (`Missed`, `Voicemail`, `Call connected`, …). */
  result: z.string().nullable(),
}).strict();
export const ownerConversationsDataSchema = z.object({
  contact_number_id: csiIdSchema,
  items: z.array(conversationCardDtoSchema),
  other_calls: z.array(otherCallDtoSchema),
  /** Keyset over the page's calls (cards and other calls together); null on the last page. */
  next_cursor: z.string().nullable(),
}).strict();
export const ownerConversationsResponseSchema = ownerReadSchema(ownerConversationsDataSchema);
export type OwnerConversationsData = z.infer<typeof ownerConversationsDataSchema>;

export const transcriptSegmentDtoSchema = z.object({
  /** Segment id: what evidence `segment_ids` and `Open in transcript` highlight. */
  sid: z.number().int().nonnegative(),
  start_ms: z.number().nullable(), end_ms: z.number().nullable(),
  timing_source: z.enum(["provider", "unavailable"]),
  speaker: z.enum(["rep", "customer", "unknown"]),
  speaker_label: z.string(),
  text: z.string(),
  /** Call `started_at` + `start_ms`; null when the segment has no timing. */
  at: csiDateSchema.nullable(),
}).strict();
export const ownerTranscriptDataSchema = z.object({
  conversation_id: csiIdSchema,
  started_at: csiDateSchema.nullable(),
  available: z.boolean(),
  transcript_version: z.string().nullable(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  next_offset: z.number().int().nonnegative().nullable(),
  segments: z.array(transcriptSegmentDtoSchema).max(OWNER_TRANSCRIPT_MAX_LIMIT),
  completeness: z.object({ complete: z.boolean(), missing_ranges: z.array(z.string()) }).strict(),
}).strict();
export const ownerTranscriptResponseSchema = ownerReadSchema(ownerTranscriptDataSchema);
export type OwnerTranscriptData = z.infer<typeof ownerTranscriptDataSchema>;

// ── Store ─────────────────────────────────────────────────────────────
export type NumberRow = { _id: unknown; purged_at?: Date | null; content_purge_pending?: boolean | null };
export type CallPartyRow = { role: string; extension_id?: string | null; connected?: boolean | null };
export type CallRow = {
  _id: unknown; started_at: Date; direction: string; duration_seconds?: number | null; provider_result?: string | null;
  contact_type?: string | null; provider_account_id: string; parties?: CallPartyRow[] | null;
  recordings?: Array<{ provider_recording_id: string; lead_conversation_id?: unknown }> | null;
};
export type ConversationRow = {
  _id: unknown; started_at?: Date | null; contact_number_id?: unknown; latest_completed_run_id?: unknown; latest_transcript_version?: string | null;
  content_purged_at?: Date | null; duration_seconds?: number | null;
  media?: { blob_pathname?: string | null; purged_at?: Date | null } | null;
  summary?: { text?: string | null; sections?: Record<string, unknown> | null } | null;
};
export type SummarySnapshotRow = { _id: unknown; conversation_id: unknown; transcript_version: string | null; analysis_summary: unknown };
export type TranscriptPresenceRow = { conversation_id: unknown; transcript_version: string };
export type RepLinkRow = TemporalRepLink & { agent_name_snapshot?: string | null };
export type TranscriptSnapshotRow = { _id: unknown; transcript_version: string; completeness: { complete: boolean; missing_ranges?: string[] | null } };

export type OwnerConversationsStore = {
  number(id: string): Promise<NumberRow | null>;
  /** Canonical calls strictly after `after` in `(started_at desc, _id desc)`, at most `fetch` rows. */
  calls(numberId: string, after: { started_at: Date; id: string } | null, fetch: number): Promise<CallRow[]>;
  conversations(ids: string[]): Promise<ConversationRow[]>;
  /** Retained step-1 summary snapshots of these conversations, newest `_id` first. */
  summaries(conversationIds: string[]): Promise<SummarySnapshotRow[]>;
  /** Retained transcript snapshots for exactly these `(conversation, version)` pairs. */
  transcripts(pairs: Array<{ conversation_id: string; transcript_version: string }>): Promise<TranscriptPresenceRow[]>;
  repLinks(accounts: string[], extensions: string[]): Promise<RepLinkRow[]>;
};
export type OwnerTranscriptStore = {
  conversation(id: string): Promise<ConversationRow | null>;
  number(id: string): Promise<NumberRow | null>;
  transcript(conversationId: string, version: string): Promise<TranscriptSnapshotRow | null>;
  /** `$slice` of the snapshot's segments plus the total; null when the snapshot is gone. */
  segments(snapshotId: string, offset: number, limit: number): Promise<{ total: number; segments: unknown[] } | null>;
};

const SUMMARY_ROWS_PER_CONVERSATION = 5;
const oid = (value: string) => new mongoose.Types.ObjectId(value);

export const mongoOwnerConversationsStore: OwnerConversationsStore = {
  number: async id => (await getContactNumberModel().findById(id).select("purged_at content_purge_pending").lean()) as NumberRow | null,
  calls: async (numberId, after, fetch) => (await getCallInteractionModel().find({ contact_number_id: oid(numberId), merged_into_id: null, purged_at: null,
    ...(after ? { $or: [{ started_at: { $lt: after.started_at } }, { started_at: after.started_at, _id: { $lt: oid(after.id) } }] } : {}) })
    .select("started_at direction duration_seconds provider_result contact_type provider_account_id parties.role parties.extension_id parties.connected recordings.provider_recording_id recordings.lead_conversation_id")
    .sort({ started_at: -1, _id: -1 }).limit(fetch).lean()) as unknown as CallRow[],
  // Never selects `media.blob_url`; `media.blob_pathname` is read only to derive the recording state.
  conversations: async ids => ids.length ? (await getLeadConversationModel().find({ _id: { $in: ids.map(oid) } })
    .select("started_at contact_number_id latest_completed_run_id latest_transcript_version content_purged_at duration_seconds media.blob_pathname media.purged_at summary.text summary.sections")
    .limit(ids.length).lean()) as unknown as ConversationRow[] : [],
  // Newest ≤ 5 summary rows per conversation in one aggregate (prior.ts reads `limit(5)` per conversation).
  summaries: async conversationIds => conversationIds.length ? (await getIntelligenceEvidenceSnapshotModel().aggregate([
    { $match: { ...csiDataset(), source_type: "summary", artifact_key: { $type: "string" }, conversation_id: { $in: conversationIds.map(oid) }, purged_at: null, purge_started_at: null } },
    { $group: { _id: "$conversation_id", rows: { $topN: { n: SUMMARY_ROWS_PER_CONVERSATION, sortBy: { _id: -1 },
      output: { _id: "$_id", transcript_version: "$response.transcript.transcript_version", analysis_summary: "$response.analysis_summary" } } } } },
  ])).flatMap((group: { _id: unknown; rows: Array<{ _id: unknown; transcript_version?: string | null; analysis_summary?: unknown }> }) =>
    group.rows.map(row => ({ _id: row._id, conversation_id: group._id, transcript_version: row.transcript_version ?? null, analysis_summary: row.analysis_summary ?? null }))) : [],
  transcripts: async pairs => pairs.length ? (await getIntelligenceEvidenceSnapshotModel().find({ ...csiDataset(), source_type: "transcript", purged_at: null, purge_started_at: null,
    conversation_id: { $in: [...new Set(pairs.map(p => p.conversation_id))].map(oid) }, transcript_version: { $in: [...new Set(pairs.map(p => p.transcript_version))] } })
    .select("conversation_id transcript_version").limit(pairs.length * 2).lean()) as unknown as TranscriptPresenceRow[] : [],
  repLinks: async (accounts, extensions) => accounts.length && extensions.length ? (await getRepIdentityLinkModel().find({ rc_account_id: { $in: accounts }, rc_extension_id: { $in: extensions } })
    .limit(500).lean()) as unknown as RepLinkRow[] : [],
};

export const mongoOwnerTranscriptStore: OwnerTranscriptStore = {
  conversation: async id => (await getLeadConversationModel().findById(id).select("started_at contact_number_id latest_transcript_version content_purged_at").lean()) as ConversationRow | null,
  number: async id => (await getContactNumberModel().findById(id).select("purged_at content_purge_pending").lean()) as NumberRow | null,
  transcript: async (conversationId, version) => (await getIntelligenceEvidenceSnapshotModel().findOne({ ...csiDataset(), source_type: "transcript", purged_at: null, purge_started_at: null,
    conversation_id: oid(conversationId), transcript_version: version }).select("transcript_version completeness").lean()) as unknown as TranscriptSnapshotRow | null,
  segments: async (snapshotId, offset, limit) => {
    const [part] = await getIntelligenceEvidenceSnapshotModel().aggregate([{ $match: { _id: oid(snapshotId), purged_at: null, purge_started_at: null } },
      { $project: { total: { $size: { $ifNull: ["$segments", []] } }, segments: { $slice: [{ $ifNull: ["$segments", []] }, offset, limit] } } }]);
    return part ? { total: Number(part.total), segments: part.segments as unknown[] } : null;
  },
};

// ── Pure presentation ─────────────────────────────────────────────────
const sid = (value: unknown) => (value == null ? null : String(value));
const clean = (value: unknown): string | null => (typeof value === "string" && value.trim() ? redactTranscript(value.trim()).text : null);
const labelOf = <T extends Record<string, string>>(labels: T, value: unknown, fallback: string) => labels[String(value) as keyof T] ?? fallback;
const asDirection = (value: unknown): z.infer<typeof directionSchema> => (["Inbound", "Outbound", "Internal"].includes(String(value)) ? value as "Inbound" : "Unknown");
const asContactType = (value: unknown): z.infer<typeof contactTypeSchema> => (value === "voicemail" || value === "human_conversation" ? value : "unknown");

/** Data spec §6.7: stored media and not purged → available; purged → removed; otherwise not recorded. */
export function recordingState(conversation: Pick<ConversationRow, "media"> | null | undefined): RecordingState {
  const media = conversation?.media;
  if (media?.purged_at) return "audio_removed";
  return media?.blob_pathname ? "available" : "not_recorded";
}
export function recordingLabel(state: RecordingState, transcriptKept: boolean): string {
  if (state === "available") return "available";
  if (state === "not_recorded") return "not recorded";
  return transcriptKept ? "audio removed under retention; transcript kept" : "audio removed under retention";
}

/** The six canonical sections, in order, labelled and redacted. */
export function callSummarySections(read: (key: CallSummaryKey) => unknown) {
  return CALL_SUMMARY_KEYS.map(key => ({ key, label: CALL_SUMMARY_LABELS[key], text: clean(read(key)) }));
}

/** prior.ts selection: the newest retained step-1 summary for the current transcript version, else the newest one. */
export function selectCanonicalSummary(rows: readonly SummarySnapshotRow[], latestVersion: string | null | undefined) {
  const ordered = [...rows].sort((a, b) => String(b._id).localeCompare(String(a._id)));
  const pick = ordered.find(row => row.transcript_version === latestVersion) ?? ordered[0];
  if (!pick) return null;
  const parsed = summaryStepSchema.safeParse(pick.analysis_summary);
  // An unreadable newest row does not fall through to an older transcript's summary silently: prior.ts skips it too.
  return parsed.success ? { snapshot_id: String(pick._id), summary: parsed.data.summary } : null;
}

/** Card summary: step-1 snapshot, else the legacy `LeadConversation.summary.sections` mapped to the canonical keys. */
export function cardSummary(conversation: ConversationRow, summaries: readonly SummarySnapshotRow[]) {
  const canonical = selectCanonicalSummary(summaries, conversation.latest_transcript_version);
  if (canonical) {
    const summary = canonical.summary as Record<string, unknown>;
    return { summary_source: "call_summary" as const, summary_sections: callSummarySections(key => summary[key]) };
  }
  const legacy = conversation.content_purged_at ? null : conversation.summary;
  if (legacy && (legacy.sections || clean(legacy.text))) {
    const sections = legacy.sections ?? null;
    // A legacy summary stored without sections is its text; it reads as the overview.
    return { summary_source: "legacy" as const, summary_sections: callSummarySections(key => sections ? sections[LEGACY_SUMMARY_KEY[key]] : key === "overview" ? legacy.text : null) };
  }
  return { summary_source: null, summary_sections: [] };
}

const userParty = (call: CallRow) => {
  const parties = call.parties ?? [];
  return parties.find(p => p.role === "user" && p.connected && p.extension_id) ?? parties.find(p => p.role === "user" && p.extension_id) ?? null;
};
/** Same rule as the story `call` source: a name only when the link is reviewed at the call time. */
export function repFor(call: CallRow, links: readonly RepLinkRow[]): z.infer<typeof conversationRepDtoSchema> {
  const party = userParty(call);
  if (!party?.extension_id) return { name: null, status: "unknown" };
  const resolution = resolveRepIdentityAt(links, call.provider_account_id, party.extension_id, call.started_at);
  if (resolution.status === "reviewed") {
    const link = links.find(l => String(l._id) === resolution.link_id);
    return { name: clean(link?.agent_name_snapshot)?.slice(0, 80) ?? null, status: "reviewed" };
  }
  return { name: null, status: resolution.status === "proposed_only" ? "proposed" : "unknown" };
}

function callHeader(call: CallRow, links: readonly RepLinkRow[], fallbackDuration?: number | null) {
  const direction = asDirection(call.direction);
  const contactType = asContactType(call.contact_type);
  const duration = typeof call.duration_seconds === "number" ? call.duration_seconds : typeof fallbackDuration === "number" ? fallbackDuration : null;
  return {
    interaction_id: String(call._id), started_at: call.started_at.toISOString(), started_at_label: formatEtDateTime(call.started_at) ?? call.started_at.toISOString(),
    direction, direction_label: DIRECTION_LABELS[direction], duration_seconds: duration !== null && duration >= 0 ? duration : null,
    rep: repFor(call, links), contact_type: contactType, contact_type_label: labelOf(CONTACT_TYPE_LABELS, contactType, CONTACT_TYPE_LABELS.unknown),
    recording_count: (call.recordings ?? []).length,
  };
}

/** A call's conversation: the first linked one that exists, preferring an analysed one. */
function conversationOf(call: CallRow, byId: ReadonlyMap<string, ConversationRow>) {
  const linked = (call.recordings ?? []).map(r => sid(r.lead_conversation_id)).filter((id): id is string => id !== null && byId.has(id)).map(id => byId.get(id)!);
  return linked.find(c => c.latest_completed_run_id) ?? linked[0] ?? null;
}

export type OwnerConversationsDeps = { store?: OwnerConversationsStore; coverage?: () => Promise<CoverageDto>; now?: () => Date };

/** `GET /numbers/:id/conversations`. Null when the Number does not exist, is purged, or has a retention purge pending. */
export async function readOwnerConversations(numberId: string, raw: unknown = {}, deps: OwnerConversationsDeps = {}) {
  const id = csiIdSchema.parse(numberId);
  const query = ownerConversationsQuerySchema.parse(raw);
  const store = deps.store ?? mongoOwnerConversationsStore;
  const after = query.cursor ? decodeConversationCursor(query.cursor) : null;
  const [number, rows] = await Promise.all([store.number(id), store.calls(id, after, query.limit + 1)]);
  if (!number || number.purged_at || number.content_purge_pending) return null;
  const page = rows.slice(0, query.limit);
  const linkedIds = [...new Set(page.flatMap(call => (call.recordings ?? []).map(r => sid(r.lead_conversation_id)).filter((v): v is string => v !== null)))];
  const pairs = [...new Map(page.flatMap(call => { const party = userParty(call); return party?.extension_id ? [[`${call.provider_account_id}:${party.extension_id}`,
    { account: call.provider_account_id, extension: party.extension_id }] as const] : []; })).values()];
  const [conversations, links] = await Promise.all([
    store.conversations(linkedIds),
    store.repLinks([...new Set(pairs.map(p => p.account))], [...new Set(pairs.map(p => p.extension))]),
  ]);
  const byId = new Map(conversations.map(c => [String(c._id), c]));
  const chosen = page.map(call => conversationOf(call, byId));
  const chosenIds = [...new Set(chosen.flatMap(c => (c ? [String(c._id)] : [])))];
  const versionPairs = chosen.flatMap(c => (c && c.latest_transcript_version ? [{ conversation_id: String(c._id), transcript_version: c.latest_transcript_version }] : []));
  const [summaries, transcripts] = await Promise.all([store.summaries(chosenIds), store.transcripts(versionPairs)]);
  const summariesOf = new Map<string, SummarySnapshotRow[]>();
  for (const row of summaries) { const key = String(row.conversation_id); summariesOf.set(key, [...(summariesOf.get(key) ?? []), row]); }
  const kept = new Set(transcripts.map(t => `${String(t.conversation_id)}:${t.transcript_version}`));

  const items: OwnerConversationsData["items"] = [];
  const other_calls: OwnerConversationsData["other_calls"] = [];
  page.forEach((call, index) => {
    const conversation = chosen[index];
    if (!conversation) {
      other_calls.push({ ...callHeader(call, links), result: clean(call.provider_result)?.slice(0, 60) ?? null });
      return;
    }
    const conversationId = String(conversation._id);
    const state = recordingState(conversation);
    const transcriptAvailable = Boolean(conversation.latest_transcript_version && kept.has(`${conversationId}:${conversation.latest_transcript_version}`));
    items.push({ ...callHeader(call, links, conversation.duration_seconds), conversation_id: conversationId,
      recording_state: state, recording_label: recordingLabel(state, transcriptAvailable), media_available: state === "available",
      transcript_available: transcriptAvailable, transcript_version: conversation.latest_transcript_version ?? null,
      run_id: sid(conversation.latest_completed_run_id), ...cardSummary(conversation, summariesOf.get(conversationId) ?? []) });
  });
  const last = rows.length > query.limit ? page[page.length - 1] : null;
  const data = ownerConversationsDataSchema.parse({ contact_number_id: id, items, other_calls, next_cursor: last ? encodeConversationCursor(last.started_at, last._id) : null });
  return ownerRead(data, deps.now, deps.coverage ? await deps.coverage() : undefined);
}

export type OwnerTranscriptDeps = { store?: OwnerTranscriptStore; coverage?: () => Promise<CoverageDto>; now?: () => Date };
const segmentRowSchema = z.object({ sid: z.number().int().nonnegative(), start_ms: z.number().nullable().default(null), end_ms: z.number().nullable().default(null),
  timing_source: z.enum(["provider", "unavailable"]), speaker: z.enum(["rep", "customer", "unknown"]), text: z.string() });

/** `GET /conversations/:id/transcript`. Null when the conversation does not exist. */
export async function readOwnerTranscript(conversationId: string, raw: unknown = {}, deps: OwnerTranscriptDeps = {}) {
  const id = csiIdSchema.parse(conversationId);
  const query = ownerTranscriptQuerySchema.parse(raw);
  const store = deps.store ?? mongoOwnerTranscriptStore;
  const conversation = await store.conversation(id);
  if (!conversation) return null;
  const startedAt = conversation.started_at instanceof Date && !Number.isNaN(+conversation.started_at) ? conversation.started_at : null;
  const respond = async (data: OwnerTranscriptData) => ownerRead(ownerTranscriptDataSchema.parse(data), deps.now, deps.coverage ? await deps.coverage() : undefined);
  const unavailable = (reason: string) => respond({ conversation_id: id, started_at: startedAt?.toISOString() ?? null, available: false,
    transcript_version: conversation.latest_transcript_version ?? null, offset: query.offset, limit: query.limit, total: 0, next_offset: null, segments: [],
    completeness: { complete: false, missing_ranges: [reason] } });
  const numberId = sid(conversation.contact_number_id);
  const number = numberId ? await store.number(numberId) : null;
  if (number && (number.purged_at || number.content_purge_pending)) return unavailable("retention_pending");
  if (conversation.content_purged_at || !conversation.latest_transcript_version) return unavailable("transcript_unavailable");
  const snapshot = await store.transcript(id, conversation.latest_transcript_version);
  if (!snapshot) return unavailable("transcript_unavailable");
  const part = await store.segments(String(snapshot._id), query.offset, query.limit);
  if (!part) return unavailable("transcript_unavailable");
  if (query.offset > part.total) throw new CsiError("INVALID_INPUT");
  const segments = z.array(segmentRowSchema).max(OWNER_TRANSCRIPT_MAX_LIMIT).parse(part.segments).map(segment => ({
    sid: segment.sid, start_ms: segment.start_ms, end_ms: segment.end_ms, timing_source: segment.timing_source, speaker: segment.speaker,
    speaker_label: SPEAKER_LABELS[segment.speaker], text: redactTranscript(segment.text).text,
    at: startedAt && typeof segment.start_ms === "number" ? new Date(startedAt.getTime() + segment.start_ms).toISOString() : null,
  }));
  const next = query.offset + segments.length;
  return respond({ conversation_id: id, started_at: startedAt?.toISOString() ?? null, available: true, transcript_version: snapshot.transcript_version,
    offset: query.offset, limit: query.limit, total: part.total, next_offset: next < part.total ? next : null, segments,
    completeness: { complete: snapshot.completeness.complete && query.offset === 0 && next === part.total,
      missing_ranges: [...(snapshot.completeness.missing_ranges ?? []), ...(query.offset ? [`segments_before:${query.offset}`] : []), ...(next < part.total ? [`segments_after:${next}`] : [])] } });
}
