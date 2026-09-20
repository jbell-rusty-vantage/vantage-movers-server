import mongoose from "mongoose";
import { z } from "zod";
import { getCallInteractionModel } from "../../models/CallInteraction";
import { getContactNumberModel } from "../../models/ContactNumber";
import { getLeadConversationModel } from "../../models/LeadConversation";
import { getLeadMessageModel } from "../../models/LeadMessage";
import { csiDateSchema, csiIdSchema } from "../../validation/v1/salesIntelligence";
import { CsiError } from "../salesIntelligence/auth";
import type { ContactNumberLean } from "./contactNumbers";
import { ownerRead } from "./coverage";
import { outreachTimelineSource } from "../salesIntelligence/outreach/timeline";
import {
  numberTimelineEventDtoSchema,
  numberTimelinePageDtoSchema,
  type NumberTimelineEventDto,
  type NumberTimelinePageDto,
} from "./dto";

/**
 * Number timeline (04 §1 `GET /numbers/:id/timeline`): a k-way merge of
 * independent, already-sorted sources over one total order
 * `(happened_at desc, kind asc, id desc)`. Each source returns up to `limit`
 * events strictly after the cursor; the merge dedupes on `(kind, id)`.
 * Team C plugs Outreach/nudge events in through `TimelineSource`.
 *
 * Reads never mutate. Merge tombstones (`merged_into_id != null`) are
 * excluded so a canonical interaction appears once; recordings are counted
 * per `recordings[]` entry. No body, transcript or summary text in any DTO.
 */
export type TimelineCursor = { happened_at: string; kind: string; id: string };
const timelineCursorSchema = z
  .object({ happened_at: csiDateSchema, kind: z.string().min(1), id: z.string().min(1) })
  .strict();

export function encodeTimelineCursor(cursor: TimelineCursor): string {
  return Buffer.from(JSON.stringify(timelineCursorSchema.parse(cursor))).toString("base64url");
}

/** Throws `CsiError("INVALID_INPUT")` on anything that is not an encoded cursor. */
export function decodeTimelineCursor(encoded: string): TimelineCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return timelineCursorSchema.parse(parsed);
  } catch {
    throw new CsiError("INVALID_INPUT");
  }
}

export type TimelineSourceInput = {
  number_id: string;
  e164: string;
  national_ten: string | null;
  limit: number;
  cursor: TimelineCursor | null;
};

/** Returns up to `limit` events strictly after `cursor` in the total order, already sorted. */
export type TimelineSource = (input: TimelineSourceInput) => Promise<NumberTimelineEventDto[]>;

/** The three ordering keys; `kind` is open so cursors and Team C sources need no enum change here. */
type Ordered = { happened_at: string; kind: string; id: string };

const compareStrings = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Total order: `happened_at` DESC, then `kind` ASC, then `id` DESC. Negative means `a` comes first. */
export function compareTimelineEvents(a: Ordered, b: Ordered): number {
  const ta = Date.parse(a.happened_at);
  const tb = Date.parse(b.happened_at);
  if (ta !== tb) return ta < tb ? 1 : -1;
  const kind = compareStrings(a.kind, b.kind);
  if (kind !== 0) return kind;
  return compareStrings(b.id, a.id);
}

/** Strictly after the cursor in the total order (the cursor row itself is excluded). */
export function isAfterCursor(event: Ordered, cursor: TimelineCursor): boolean {
  return compareTimelineEvents(event, cursor) > 0;
}

/** Pure k-way merge with `(kind, id)` dedupe; cursor from the last returned item when more remain. */
export function mergeTimeline(
  pages: NumberTimelineEventDto[][],
  limit: number,
): { items: NumberTimelineEventDto[]; cursor: string | null } {
  const seen = new Set<string>();
  const all: NumberTimelineEventDto[] = [];
  for (const page of pages) {
    for (const event of page) {
      const key = `${event.kind}:${event.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(event);
    }
  }
  all.sort(compareTimelineEvents);
  const items = all.slice(0, limit);
  const last = items[items.length - 1];
  const cursor =
    all.length > limit && last
      ? encodeTimelineCursor({ happened_at: last.happened_at, kind: last.kind, id: last.id })
      : null;
  return { items, cursor };
}

/**
 * Mongo keyset predicate equivalent to `isAfterCursor` for one source of a
 * fixed `kind` whose event time is stored in `timeField` and id in `idField`.
 */
export function keysetAfterCursor(
  cursor: TimelineCursor | null,
  kind: string,
  timeField: string,
  idField: string,
  idValue: (id: string) => unknown,
): Record<string, unknown> {
  if (!cursor) return {};
  const at = new Date(cursor.happened_at);
  const kindOrder = compareStrings(kind, cursor.kind);
  if (kindOrder < 0) return { [timeField]: { $lt: at } };
  if (kindOrder > 0) return { [timeField]: { $lte: at } };
  return {
    $or: [
      { [timeField]: { $lt: at } },
      { [timeField]: at, [idField]: { $lt: idValue(cursor.id) } },
    ],
  };
}

const iso = (value: Date | string | null | undefined): string | null =>
  value ? new Date(value).toISOString() : null;
const objectId = (id: string) => new mongoose.Types.ObjectId(id);
const subjectKey = (numberId: string) => `number:${numberId}`;

type InteractionLean = {
  _id: mongoose.Types.ObjectId;
  provider_account_id: string;
  direction: string;
  provider_result: string | null;
  provider_connected: boolean;
  contact_type: string;
  duration_seconds: number | null;
  terminal: boolean;
  started_at: Date;
  answered_at: Date | null;
  ended_at: Date | null;
  company_e164: string | null;
  recordings: Array<{
    provider_recording_id: string;
    recording_type: string | null;
    lead_conversation_id: mongoose.Types.ObjectId | null;
  }>;
  sources: string[];
  projection_revision: number;
  last_observed_at: Date;
  telephony_session_id: string | null;
  transfer: boolean;
  queue_fanout: boolean;
};

function interactionEvent(numberId: string, row: InteractionLean): NumberTimelineEventDto {
  const id = String(row._id);
  const recordingIds = (row.recordings ?? []).map((r) => r.provider_recording_id);
  const parts = [
    `${row.direction} call`,
    row.provider_result ?? "result not reported",
    row.duration_seconds !== null && row.duration_seconds !== undefined
      ? `${row.duration_seconds} s`
      : null,
    `${recordingIds.length} recording${recordingIds.length === 1 ? "" : "s"}`,
  ].filter((p): p is string => p !== null);
  return numberTimelineEventDtoSchema.parse({
    id,
    kind: "interaction",
    happened_at: new Date(row.started_at).toISOString(),
    observed_at: new Date(row.last_observed_at).toISOString(),
    subject_key: subjectKey(numberId),
    description: parts.join(", "),
    evidence_refs: [`interaction:${id}`, ...recordingIds.map((r) => `recording:${r}`)],
    detail: {
      direction: row.direction,
      provider_result: row.provider_result ?? null,
      provider_connected: Boolean(row.provider_connected),
      contact_type: row.contact_type,
      duration_seconds: row.duration_seconds ?? null,
      terminal: Boolean(row.terminal),
      recording_count: recordingIds.length,
      recording_ids: recordingIds,
      projection_revision: row.projection_revision,
      sources: [...(row.sources ?? [])],
      answered_at: iso(row.answered_at),
      ended_at: iso(row.ended_at),
      company_e164: row.company_e164 ?? null,
      transfer: Boolean(row.transfer),
      queue_fanout: Boolean(row.queue_fanout),
    },
  });
}

/** Canonical `call_interactions` rows for the number; tombstones excluded. */
export const interactionSource: TimelineSource = async ({ number_id, limit, cursor }) => {
  const rows = (await getCallInteractionModel()
    .find({
      contact_number_id: objectId(number_id),
      merged_into_id: null,
      purged_at: null,
      ...keysetAfterCursor(cursor, "interaction", "started_at", "_id", objectId),
    })
    .sort({ started_at: -1, _id: -1 })
    .limit(limit)
    .lean()) as unknown as InteractionLean[];
  return rows.map((row) => interactionEvent(number_id, row));
};

type LeadMessageLean = {
  _id: mongoose.Types.ObjectId;
  status: string;
  purpose: string;
  origin: string | null;
  dispatch_mode: string | null;
  lead_ref: { model: string; id: mongoose.Types.ObjectId } | null;
  sent_at: Date | null;
  delivered_at: Date | null;
  createdAt: Date;
  happened_at: Date;
};

function leadMessageEvent(numberId: string, row: LeadMessageLean): NumberTimelineEventDto {
  const id = String(row._id);
  return numberTimelineEventDtoSchema.parse({
    id,
    kind: "lead_message",
    happened_at: new Date(row.happened_at).toISOString(),
    observed_at: new Date(row.createdAt).toISOString(),
    subject_key: subjectKey(numberId),
    description: `Lead Message ${row.status} (${row.purpose})`,
    evidence_refs: [`lead_message:${id}`],
    detail: {
      status: row.status,
      purpose: row.purpose,
      origin: row.origin ?? null,
      dispatch_mode: row.dispatch_mode ?? null,
      sent_at: iso(row.sent_at),
      delivered_at: iso(row.delivered_at),
      lead_ref:
        row.lead_ref && row.lead_ref.model && row.lead_ref.id
          ? { model: row.lead_ref.model, id: String(row.lead_ref.id) }
          : null,
    },
  });
}

/** `lead_messages` addressed to this number; `happened_at = sent_at ?? createdAt`. Body excluded. */
export const leadMessageSource: TimelineSource = async ({ number_id, e164, national_ten, limit, cursor }) => {
  const addresses = [e164, ...(national_ten ? [national_ten, `1${national_ten}`] : [])];
  const rows = (await getLeadMessageModel().aggregate([
    { $match: { to: { $in: addresses } } },
    { $addFields: { happened_at: { $ifNull: ["$sent_at", "$createdAt"] } } },
    ...(cursor
      ? [{ $match: keysetAfterCursor(cursor, "lead_message", "happened_at", "_id", objectId) }]
      : []),
    { $sort: { happened_at: -1, _id: -1 } },
    { $limit: limit },
    {
      $project: {
        status: 1,
        purpose: 1,
        origin: 1,
        dispatch_mode: 1,
        lead_ref: 1,
        sent_at: 1,
        delivered_at: 1,
        createdAt: 1,
        happened_at: 1,
      },
    },
  ])) as LeadMessageLean[];
  return rows.map((row) => leadMessageEvent(number_id, row));
};

type ConversationLean = {
  _id: mongoose.Types.ObjectId;
  provider_account_id: string | null;
  provider_recording_id: string;
  call_interaction_id: mongoose.Types.ObjectId | null;
  state: string;
  direction: string;
  contact_type: string | null;
  duration_seconds: number | null;
  started_at: Date;
  createdAt: Date;
  lead_ref: { model: string; id: mongoose.Types.ObjectId } | null;
};

function conversationEvent(numberId: string, row: ConversationLean): NumberTimelineEventDto {
  const id = String(row._id);
  return numberTimelineEventDtoSchema.parse({
    id,
    kind: "conversation",
    happened_at: new Date(row.started_at).toISOString(),
    observed_at: new Date(row.createdAt).toISOString(),
    subject_key: subjectKey(numberId),
    description: `Recorded conversation, state ${row.state}`,
    evidence_refs: [`conversation:${id}`, `recording:${row.provider_recording_id}`],
    detail: {
      provider_recording_id: row.provider_recording_id,
      started_at: new Date(row.started_at).toISOString(),
      state: row.state,
      direction: row.direction,
      contact_type: row.contact_type ?? "unknown",
      duration_seconds: row.duration_seconds ?? null,
      call_interaction_id: row.call_interaction_id ? String(row.call_interaction_id) : null,
      lead_ref:
        row.lead_ref && row.lead_ref.model && row.lead_ref.id
          ? { model: row.lead_ref.model, id: String(row.lead_ref.id) }
          : null,
    },
  });
}

/** Bounded scan of recording-bearing canonical interactions when resolving conversations. */
const CONVERSATION_LINK_SCAN_LIMIT = 2000;

/**
 * `lead_conversations` linked to this number's canonical interactions: by
 * `recordings[].lead_conversation_id` when set, otherwise by
 * `provider_recording_id` within the same `provider_account_id`.
 */
export const conversationSource: TimelineSource = async ({ number_id, limit, cursor }) => {
  const scanFilter: Record<string, unknown> = {
    purged_at: null,
    contact_number_id: objectId(number_id),
    merged_into_id: null,
    "recordings.0": { $exists: true },
  };
  if (cursor) scanFilter.started_at = { $lte: new Date(cursor.happened_at) };
  const interactions = (await getCallInteractionModel()
    .find(scanFilter, { provider_account_id: 1, recordings: 1 })
    .sort({ started_at: -1, _id: -1 })
    .limit(CONVERSATION_LINK_SCAN_LIMIT)
    .lean()) as unknown as Array<Pick<InteractionLean, "provider_account_id" | "recordings">>;
  const linkedIds: mongoose.Types.ObjectId[] = [];
  const byAccount = new Map<string, Set<string>>();
  for (const row of interactions) {
    for (const recording of row.recordings ?? []) {
      if (recording.lead_conversation_id) {
        linkedIds.push(recording.lead_conversation_id);
        continue;
      }
      const ids = byAccount.get(row.provider_account_id) ?? new Set<string>();
      ids.add(recording.provider_recording_id);
      byAccount.set(row.provider_account_id, ids);
    }
  }
  const or: Array<Record<string, unknown>> = [];
  if (linkedIds.length) or.push({ _id: { $in: linkedIds } });
  for (const [account, ids] of byAccount) {
    or.push({
      provider: "ringcentral",
      provider_account_id: account,
      provider_recording_id: { $in: [...ids] },
    });
  }
  if (!or.length) return [];
  const keyset = keysetAfterCursor(cursor, "conversation", "started_at", "_id", objectId);
  const rows = (await getLeadConversationModel()
    .find(
      cursor ? { $and: [{ $or: or }, keyset] } : { $or: or },
      {
        provider_account_id: 1,
        provider_recording_id: 1,
        call_interaction_id: 1,
        state: 1,
        direction: 1,
        contact_type: 1,
        duration_seconds: 1,
        started_at: 1,
        createdAt: 1,
        lead_ref: 1,
      },
    )
    .sort({ started_at: -1, _id: -1 })
    .limit(limit)
    .lean()) as unknown as ConversationLean[];
  return rows.map((row) => conversationEvent(number_id, row));
};

export const DEFAULT_TIMELINE_SOURCES: readonly TimelineSource[] = [
  interactionSource,
  leadMessageSource,
  conversationSource,
  outreachTimelineSource,
];

export type TimelineDependencies = {
  /** Replaces the default source set (tests). */
  sources?: TimelineSource[];
  /** Appended to the source set (Team C: outreach events, nudges). */
  extraSources?: TimelineSource[];
  now?: () => Date;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** `null` when the id is malformed or the Contact Number is missing. */
export async function getNumberTimeline(
  numberId: string,
  opts: { cursor?: string; limit?: number } = {},
  deps: TimelineDependencies = {},
): Promise<NumberTimelinePageDto | null> {
  if (!csiIdSchema.safeParse(numberId).success) return null;
  const number = (await getContactNumberModel()
    .findOne({ _id: numberId, purged_at: null }, { e164: 1, national_ten: 1 })
    .lean()) as unknown as Pick<ContactNumberLean, "_id" | "e164" | "national_ten"> | null;
  if (!number) return null;
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(opts.limit ?? DEFAULT_LIMIT)));
  const cursor = opts.cursor ? decodeTimelineCursor(opts.cursor) : null;
  const sources = [...(deps.sources ?? DEFAULT_TIMELINE_SOURCES), ...(deps.extraSources ?? [])];
  const input: TimelineSourceInput = {
    number_id: numberId,
    e164: number.e164,
    national_ten: number.national_ten ?? null,
    limit: limit + 1,
    cursor,
  };
  const pages = await Promise.all(sources.map((source) => source(input)));
  const merged = mergeTimeline(pages, limit);
  return numberTimelinePageDtoSchema.parse(
    await ownerRead({ number_id: numberId, items: merged.items, cursor: merged.cursor }, deps.now),
  );
}
