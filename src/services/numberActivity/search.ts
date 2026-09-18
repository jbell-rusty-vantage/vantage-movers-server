import mongoose from "mongoose";
import { z } from "zod";
import { CONTACT_NUMBER_CLASSIFICATIONS } from "../../config/domain/salesIntelligence";
import { getContactNumberModel } from "../../models/ContactNumber";
import { csiDateSchema, csiIdSchema } from "../../validation/v1/salesIntelligence";
import { CsiError } from "../salesIntelligence/auth";
import { toNumberSearchItem, type ContactNumberLean } from "./contactNumbers";
import { ownerRead } from "./coverage";
import { numberSearchPageDtoSchema, type NumberSearchPageDto } from "./dto";
import { toE164 } from "./phone";

/**
 * Number Activity search (04 §1 `GET /numbers`, §3). Pure filter and cursor
 * helpers plus one read. Reads never mutate. Non-external kinds are hidden
 * unless `hygiene=true`, which then shows only non-external kinds (02 §1).
 */
export const numberSearchQuerySchema = z
  .object({
    scope: z.literal("production").optional(),
    q: z.string().trim().max(200).optional(),
    classification: z.enum(CONTACT_NUMBER_CLASSIFICATIONS).optional(),
    attachment: z.enum(["any", "linked", "unlinked"]).default("any"),
    active_from: csiDateSchema.optional(),
    active_to: csiDateSchema.optional(),
    /**
     * Query-string safe. `z.coerce.boolean()` treats every non-empty string
     * as true, so `?hygiene=false` would invert the Owner default.
     */
    hygiene: z
      .union([z.boolean(), z.enum(["true", "false"])])
      .optional()
      .transform((value) => value === true || value === "true")
      .default(false),
    cursor: z.string().max(2000).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
export type NumberSearchQuery = z.infer<typeof numberSearchQuerySchema>;

export type NumberCursor = { last_activity_at: string; id: string };
const numberCursorSchema = z
  .object({ last_activity_at: csiDateSchema, id: csiIdSchema })
  .strict();

export function encodeNumberCursor(cursor: NumberCursor): string {
  return Buffer.from(JSON.stringify(numberCursorSchema.parse(cursor))).toString("base64url");
}

/** Throws `CsiError("INVALID_INPUT")` on anything that is not an encoded cursor. */
export function decodeNumberCursor(encoded: string): NumberCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return numberCursorSchema.parse(parsed);
  } catch {
    throw new CsiError("INVALID_INPUT");
  }
}

export type ParsedSearchTerm =
  | { kind: "none" }
  | { kind: "e164"; e164: string }
  | { kind: "suffix"; reversed: string }
  | { kind: "term"; term: string };

const PHONE_FORMATTING = /[\s().+\-]/g;

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Digits-only (after stripping phone formatting) with >= 10 digits → exact
 * E.164; 3..9 digits → suffix over `digits_reversed`; anything else is a
 * lowercased term matched as an anchored prefix against `search_terms`
 * (customer/provider names, Job Numbers, agent names).
 */
export function parseSearchTerm(q: string | undefined): ParsedSearchTerm {
  const trimmed = q?.trim() ?? "";
  if (!trimmed) return { kind: "none" };
  const stripped = trimmed.replace(PHONE_FORMATTING, "");
  if (/^\d+$/.test(stripped)) {
    if (stripped.length >= 10) {
      const e164 = toE164(trimmed);
      if (e164) return { kind: "e164", e164 };
    }
    if (stripped.length >= 3) {
      return { kind: "suffix", reversed: stripped.split("").reverse().join("") };
    }
  }
  return { kind: "term", term: trimmed.toLowerCase() };
}

/** Pure Mongo filter over `contact_numbers`; keyset on `(last_activity_at desc, _id desc)`. */
export function buildNumberSearchFilter(
  query: NumberSearchQuery,
  cursor: NumberCursor | null,
  term: ReturnType<typeof parseSearchTerm> = parseSearchTerm(query.q),
): Record<string, unknown> {
  const filter: Record<string, unknown> = {
    kind: query.hygiene ? { $ne: "external" } : "external",
  };
  const and: Array<Record<string, unknown>> = [];
  if (query.classification) filter.classification = query.classification;
  if (query.attachment === "linked") {
    and.push({
      $or: [
        { "rollups.attached_lead_count": { $gt: 0 } },
        { "rollups.candidate_lead_count": { $gt: 0 } },
      ],
    });
  } else if (query.attachment === "unlinked") {
    filter["rollups.attached_lead_count"] = 0;
    filter["rollups.candidate_lead_count"] = 0;
  }
  if (query.active_from || query.active_to) {
    const range: Record<string, Date> = {};
    if (query.active_from) range.$gte = new Date(query.active_from);
    if (query.active_to) range.$lte = new Date(query.active_to);
    filter.last_activity_at = range;
  }
  if (term.kind === "e164") filter.e164 = term.e164;
  else if (term.kind === "suffix") filter.digits_reversed = { $regex: `^${term.reversed}` };
  else if (term.kind === "term") filter.search_terms = { $regex: `^${escapeRegex(term.term)}` };
  if (cursor) {
    const at = new Date(cursor.last_activity_at);
    and.push({
      $or: [
        { last_activity_at: { $lt: at } },
        { last_activity_at: at, _id: { $lt: new mongoose.Types.ObjectId(cursor.id) } },
      ],
    });
  }
  if (and.length) filter.$and = and;
  return filter;
}

export async function searchNumberActivity(
  query: NumberSearchQuery,
  deps: { now?: () => Date } = {},
): Promise<NumberSearchPageDto> {
  const cursor = query.cursor ? decodeNumberCursor(query.cursor) : null;
  const parsed = parseSearchTerm(query.q);
  const filter = buildNumberSearchFilter(query, cursor, parsed);
  const rows = (await getContactNumberModel()
    .find(filter)
    .sort({ last_activity_at: -1, _id: -1 })
    .limit(query.limit + 1)
    .lean()) as unknown as ContactNumberLean[];
  const page = rows.slice(0, query.limit);
  const match = { kind: parsed.kind };
  const last = page[page.length - 1];
  const next =
    rows.length > query.limit && last
      ? encodeNumberCursor({
          last_activity_at: new Date(last.last_activity_at).toISOString(),
          id: String(last._id),
        })
      : null;
  return numberSearchPageDtoSchema.parse(
    await ownerRead(
      { items: page.map((row) => toNumberSearchItem(row, match)), cursor: next },
      deps.now,
    ),
  );
}
