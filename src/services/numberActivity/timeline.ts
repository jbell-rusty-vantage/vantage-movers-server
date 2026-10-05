import mongoose from "mongoose";
import { z } from "zod";
import { getCallInteractionModel } from "../../models/CallInteraction";
import { getContactNumberModel } from "../../models/ContactNumber";
import { getLeadMessageModel } from "../../models/LeadMessage";
import { getRepIdentityLinkModel } from "../../models/RepIdentityLink";
import { csiDateSchema, csiIdSchema } from "../../validation/v1/salesIntelligence";
import { CsiError } from "../salesIntelligence/auth";
import type { ContactNumberLean } from "./contactNumbers";
import { ownerRead } from "./coverage";
import type { CoverageDto } from "../salesIntelligence/coverageDto";
import { callRepAttribution, callUserParty, type CallRepAttribution, type RepLinkLean } from "./callRep";
import {
  numberTimelineEventDtoSchema,
  numberTimelinePageDtoSchema,
  type NumberTimelineEventDto,
  type NumberTimelinePageDto,
} from "./dto";

/**
 * Number timeline (`GET /numbers/:id/timeline`): a k-way merge of independent,
 * already-sorted sources over one total order `(happened_at desc, kind asc, id desc)`.
 * Each source returns up to `limit` events strictly after the cursor; the merge
 * dedupes on `(kind, id)`. The sources are canonical Call Interactions (provider
 * call metadata, legs and the reviewed rep at call time) and Lead Messages.
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

/** The three ordering keys. */
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

type InteractionParty = {
  role: string;
  connected?: boolean;
  extension_id?: string | null;
  extension_number?: string | null;
};
type InteractionLeg = {
  leg_type?: string | null;
  direction?: string | null;
  result?: string | null;
  start_time?: Date | null;
  duration_seconds?: number | null;
  extension_id?: string | null;
};
type InteractionLean = {
  _id: mongoose.Types.ObjectId;
  provider_account_id: string;
  direction: string;
  provider_result: string | null;
  provider_connected: boolean;
  contact_type: string;
  duration_seconds: number | null;
  terminal: boolean;
  call_log_state?: "provisional" | "settled" | null;
  started_at: Date;
  answered_at: Date | null;
  ended_at: Date | null;
  company_e164: string | null;
  parties?: InteractionParty[];
  legs?: InteractionLeg[];
  legs_overflow_count?: number;
  recordings: Array<{ provider_recording_id: string; recording_type: string | null }>;
  sources: string[];
  projection_revision: number;
  last_observed_at: Date;
  telephony_session_id: string | null;
  transfer: boolean;
  queue_fanout: boolean;
};

export { callRepAttribution, type CallRepAttribution } from "./callRep";

/** One bounded read of the Rep Identity Links a page of calls names (account + extension). */
async function loadRepLinks(rows: readonly InteractionLean[]): Promise<RepLinkLean[]> {
  const accounts = [...new Set(rows.map((row) => row.provider_account_id))];
  const extensions = [...new Set(rows.flatMap((row) => {
    const party = callUserParty(row);
    return party?.extension_id ? [party.extension_id] : [];
  }))];
  if (!accounts.length || !extensions.length) return [];
  return (await getRepIdentityLinkModel()
    .find({ rc_account_id: { $in: accounts }, rc_extension_id: { $in: extensions } })
    .limit(500)
    .lean()) as unknown as RepLinkLean[];
}

function interactionEvent(numberId: string, row: InteractionLean, rep: CallRepAttribution): NumberTimelineEventDto {
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
      // CC-04: "provisional" = the Call Log has only shown a mid-call snapshot (not final);
      // null = never seen in the Call Log.
      call_log_state: row.call_log_state ?? null,
      recording_count: recordingIds.length,
      recording_ids: recordingIds,
      projection_revision: row.projection_revision,
      sources: [...(row.sources ?? [])],
      answered_at: iso(row.answered_at),
      ended_at: iso(row.ended_at),
      company_e164: row.company_e164 ?? null,
      transfer: Boolean(row.transfer),
      queue_fanout: Boolean(row.queue_fanout),
      rep,
      legs: (row.legs ?? []).map((leg) => ({
        leg_type: leg.leg_type ?? null,
        direction: leg.direction ?? null,
        result: leg.result ?? null,
        start_time: iso(leg.start_time),
        duration_seconds: leg.duration_seconds ?? null,
        extension_id: leg.extension_id ?? null,
      })),
      legs_overflow_count: row.legs_overflow_count ?? 0,
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
  const links = await loadRepLinks(rows);
  return rows.map((row) => interactionEvent(number_id, row, callRepAttribution(row, links)));
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

export const DEFAULT_TIMELINE_SOURCES: readonly TimelineSource[] = [interactionSource, leadMessageSource];

export type TimelineDependencies = {
  /** Reuse the worker's captured watermark across evidence pages. */
  coverage?: CoverageDto;
  /** Replaces the default source set (tests). */
  sources?: TimelineSource[];
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
  const sources = deps.sources ?? DEFAULT_TIMELINE_SOURCES;
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
    await ownerRead({ number_id: numberId, items: merged.items, cursor: merged.cursor }, deps.now, deps.coverage),
  );
}
