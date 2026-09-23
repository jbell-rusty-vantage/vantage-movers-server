import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { z } from "zod";
import { CONTACT_NUMBER_CLASSIFICATIONS } from "../../config/domain/salesIntelligence";
import { getContactNumberModel } from "../../models/ContactNumber";
import { csiDateSchema, csiIdSchema } from "../../validation/v1/salesIntelligence";
import { canonicalJson } from "../durableWork/checksum";
import { CsiError } from "../salesIntelligence/auth";
import { loadAttachedLeadProgressForNumbers } from "../salesIntelligence/outreach/reads";
import { toNumberSearchItem, type ContactNumberLean } from "./contactNumbers";
import { ownerRead } from "./coverage";
import {
  NUMBER_SEARCH_DIRECTIONS,
  NUMBER_SEARCH_SORTS,
  numberSearchPageDtoSchema,
  type AttachedLeadProgressItemDto,
  type NumberSearchDirection,
  type NumberSearchPageDto,
  type NumberSearchSort,
} from "./dto";
import { toE164 } from "./phone";

/**
 * Number Activity search (04 §1 `GET /numbers`, §3). Pure filter and cursor
 * helpers plus one read. Reads never mutate. Non-external kinds are hidden
 * unless `hygiene=true`, which then shows only non-external kinds (02 §1).
 */
/**
 * Query-string safe boolean. `z.coerce.boolean()` treats every non-empty
 * string as true, so `?x=false` would invert the meaning.
 */
const queryBoolean = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .optional()
  .transform((value) => value === true || value === "true")
  .default(false);

function repeatedQuery<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => {
    if (value == null || value === "") return undefined;
    const parts = (Array.isArray(value) ? value : [value])
      .flatMap((item) => String(item).split(","))
      .map((item) => item.trim())
      .filter(Boolean);
    return parts.length ? [...new Set(parts)].sort() : undefined;
  }, z.array(schema).min(1).optional());
}

export const numberSearchQuerySchema = z
  .object({
    scope: z.literal("production").optional(),
    q: z.string().trim().max(200).optional(),
    classification: repeatedQuery(z.enum(CONTACT_NUMBER_CLASSIFICATIONS)),
    attachment: z.enum(["any", "linked", "unlinked"]).default("any"),
    active_from: csiDateSchema.optional(),
    active_to: csiDateSchema.optional(),
    /** Query-string safe (`queryBoolean`): `?hygiene=false` keeps the Owner default. */
    hygiene: queryBoolean,
    /**
     * Data spec §4.2 (final spec §9.2 region Analysis). `true` narrows to
     * `rollups.recordings_total > 0` / `rollups.outreach_records_total > 0`;
     * `false` or absent does not narrow (there is no "has none" filter).
     */
    has_recording: queryBoolean,
    has_outreach: queryBoolean,
    cursor: z.string().max(2000).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    /**
     * LP-06 (§14.2). Both optional: when neither is given the request runs the
     * historical `(last_activity_at desc, _id desc)` path unchanged, including
     * its legacy cursor. Effective defaults are `last_activity` / `desc`.
     */
    sort: z.enum(NUMBER_SEARCH_SORTS).optional(),
    direction: z.enum(NUMBER_SEARCH_DIRECTIONS).optional(),
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
  /** `reversed` is always present so an exact miss still tries the suffix. */
  | { kind: "e164"; e164: string; reversed: string }
  | { kind: "suffix"; reversed: string }
  | { kind: "term"; term: string };

const PHONE_FORMATTING = /[\s().+\-]/g;

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Digits-only (after stripping phone formatting) with >= 10 digits → exact
 * E.164 **or** the same digits as a suffix; 3..9 digits → suffix over
 * `digits_reversed`; anything else is a lowercased term matched as an anchored
 * prefix against `search_terms` (customer/provider names, Job Numbers, agent
 * names).
 *
 * The suffix arm on long digit input matters: a pasted number carrying a wrong
 * or extra country prefix normalizes to an E.164 value the system never
 * stored, and exact-only matching reported "the number isn't in the system"
 * for what is really a search miss (14 §10). Both arms are index-served, so
 * widening the predicate does not widen the work.
 */
export function parseSearchTerm(q: string | undefined): ParsedSearchTerm {
  const trimmed = q?.trim() ?? "";
  if (!trimmed) return { kind: "none" };
  const stripped = trimmed.replace(PHONE_FORMATTING, "");
  if (/^\d+$/.test(stripped)) {
    const reversed = stripped.split("").reverse().join("");
    if (stripped.length >= 10) {
      const e164 = toE164(trimmed);
      if (e164) return { kind: "e164", e164, reversed };
    }
    if (stripped.length >= 3) {
      return { kind: "suffix", reversed };
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
    purged_at: null,
    kind: query.hygiene ? { $ne: "external" } : "external",
  };
  const and: Array<Record<string, unknown>> = [];
  if (query.classification?.length) filter.classification = { $in: query.classification };
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
  // Residual predicates on the `kind`-prefixed indexes (no index of their own).
  if (query.has_recording) filter["rollups.recordings_total"] = { $gt: 0 };
  if (query.has_outreach) filter["rollups.outreach_records_total"] = { $gt: 0 };
  if (term.kind === "e164") {
    // Exact identity first, then the same digits as a suffix: both arms are
    // anchored index lookups, so the `$or` stays a bounded index union.
    and.push({
      $or: [{ e164: term.e164 }, { digits_reversed: { $regex: `^${term.reversed}` } }],
    });
  } else if (term.kind === "suffix") filter.digits_reversed = { $regex: `^${term.reversed}` };
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

// ---------------------------------------------------------------------------
// LP-06 time sorts (§14.2): live keyset, nulls last in both directions
// ---------------------------------------------------------------------------

/**
 * Data spec §4.2 / V13: `last_call` **is** `last_activity` (the field is only
 * written from interactions) and `first_call` is `first_observed`. An alias
 * resolves to its canonical sort for the field, the index, the cursor and the
 * digest, so a cursor minted under one name continues under the other.
 */
export const NUMBER_SORT_CANONICAL = {
  last_activity: "last_activity",
  last_call: "last_activity",
  last_human_conversation: "last_human_conversation",
  first_observed: "first_observed",
  first_call: "first_observed",
  interactions: "interactions",
} as const satisfies Record<NumberSearchSort, NumberSearchSort>;
export type CanonicalNumberSort = (typeof NUMBER_SORT_CANONICAL)[NumberSearchSort];
const CANONICAL_NUMBER_SORTS = ["last_activity", "last_human_conversation", "first_observed", "interactions"] as const satisfies readonly CanonicalNumberSort[];

export const NUMBER_SORT_FIELDS = {
  last_activity: "last_activity_at",
  last_call: "last_activity_at",
  last_human_conversation: "rollups.last_human_conversation_at",
  first_observed: "first_observed_at",
  first_call: "first_observed_at",
  interactions: "rollups.interactions_total",
} as const satisfies Record<NumberSearchSort, string>;

/** Sorts whose value is a count, not a date: the cursor carries a number. */
export const NUMERIC_NUMBER_SORTS: ReadonlySet<CanonicalNumberSort> = new Set(["interactions"]);

/**
 * Largest q-narrowed candidate set the planner may sort in memory for a
 * non-activity sort. Above it the page is read in the sort index's own order
 * (a `hint`), so the requested order is kept and no blocking sort runs.
 */
export const NUMBER_SORT_CANDIDATE_CAP = 2_000;
/** The `{kind, field, _id}` index that carries each non-activity sort (`models/ContactNumber.ts`). */
export const NUMBER_SORT_INDEXES = {
  last_human_conversation: "contact_number_kind_human_conversation",
  first_observed: "contact_number_kind_first_observed",
  interactions: "contact_number_kind_interactions",
} as const satisfies Record<Exclude<CanonicalNumberSort, "last_activity">, string>;
/** The sort-carrying `{kind, field, _id}` index for every canonical sort, activity included. */
export const NUMBER_SORT_KIND_INDEXES = {
  ...NUMBER_SORT_INDEXES,
  last_activity: "contact_number_kind_activity",
} as const satisfies Record<CanonicalNumberSort, string>;
const DEFAULT_SORT: NumberSortSpec = { sort: "last_activity", direction: "desc" };

/**
 * Hint for an unsearched (`q`-less) request that carries `has_recording` or
 * `has_outreach`. Those are residual predicates with no index of their own,
 * and on a positioned page the planner can otherwise plan the keyset `$or`
 * through `_id_` and sort the survivors in memory (seen on the replica). The
 * hint keeps the page on the sort's own `kind`-prefixed index. `q` requests
 * keep the candidate-cap rule; unfiltered requests are unchanged.
 */
export function numberFilterHint(query: NumberSearchQuery, sort: NumberSearchSort, parsed: ParsedSearchTerm): string | undefined {
  if (parsed.kind !== "none" || !(query.has_recording || query.has_outreach)) return undefined;
  return NUMBER_SORT_KIND_INDEXES[canonicalNumberSort(sort)];
}

export type NumberSortSpec = { sort: NumberSearchSort; direction: NumberSearchDirection };
export type NumberSortSegment = "value" | "null";
/**
 * v2 cursor: the canonical order, the segment (`value` or `null`) and the last
 * row's position in it. `value` is an ISO date for the time sorts and a number
 * for `interactions`. `digest` binds the filters plus the sort and direction.
 */
export type NumberSortCursor = {
  v: 2;
  sort: CanonicalNumberSort;
  direction: NumberSearchDirection;
  segment: NumberSortSegment;
  value: string | number | null;
  id: string;
  digest: string;
};
const numberSortCursorSchema = z
  .object({
    v: z.literal(2),
    sort: z.enum(CANONICAL_NUMBER_SORTS),
    direction: z.enum(NUMBER_SEARCH_DIRECTIONS),
    segment: z.enum(["value", "null"]),
    value: z.union([csiDateSchema, z.number().finite()]).nullable(),
    id: csiIdSchema,
    digest: z.string().regex(/^[a-f0-9]{16}$/),
  })
  .strict()
  .refine((c) => (c.segment === "null") === (c.value === null))
  .refine((c) => c.value === null || (typeof c.value === "number") === NUMERIC_NUMBER_SORTS.has(c.sort));

export function canonicalNumberSort(sort: NumberSearchSort): CanonicalNumberSort {
  return NUMBER_SORT_CANONICAL[sort];
}

export function encodeNumberSortCursor(cursor: NumberSortCursor): string {
  return Buffer.from(JSON.stringify(numberSortCursorSchema.parse(cursor))).toString("base64url");
}

export function resolveNumberSort(query: Pick<NumberSearchQuery, "sort" | "direction">): NumberSortSpec {
  return { sort: query.sort ?? DEFAULT_SORT.sort, direction: query.direction ?? DEFAULT_SORT.direction };
}

/**
 * Filters that change the result set, plus the canonical order. `limit` and
 * `cursor` are excluded. `has_recording` / `has_outreach` enter only when set,
 * so a digest minted before those filters existed is unchanged.
 */
export function numberSearchDigest(query: NumberSearchQuery, requested: NumberSortSpec): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        v: 2,
        term: parseSearchTerm(query.q),
        classification: query.classification ?? null,
        attachment: query.attachment,
        active_from: query.active_from ?? null,
        active_to: query.active_to ?? null,
        hygiene: query.hygiene,
        ...(query.has_recording ? { has_recording: true } : {}),
        ...(query.has_outreach ? { has_outreach: true } : {}),
        sort: canonicalNumberSort(requested.sort),
        direction: requested.direction,
      }),
    )
    .digest("hex")
    .slice(0, 16);
}

/**
 * Decodes a cursor for an explicitly sorted request. A legacy
 * `{last_activity_at, id}` cursor is accepted only for `last_activity desc`
 * (it is the value segment of that order). A v2 cursor must carry this
 * request's digest, sort and direction. Anything else is `INVALID_INPUT`.
 */
export function decodeNumberSortCursor(
  encoded: string,
  query: NumberSearchQuery,
  requested: NumberSortSpec,
): NumberSortCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new CsiError("INVALID_INPUT");
  }
  const digest = numberSearchDigest(query, requested);
  const canonical = canonicalNumberSort(requested.sort);
  const legacy = numberCursorSchema.safeParse(parsed);
  if (legacy.success) {
    if (canonical !== "last_activity" || requested.direction !== "desc") throw new CsiError("INVALID_INPUT");
    return { v: 2, sort: "last_activity", direction: "desc", segment: "value", value: legacy.data.last_activity_at, id: legacy.data.id, digest };
  }
  const v2 = numberSortCursorSchema.safeParse(parsed);
  if (!v2.success || v2.data.digest !== digest) throw new CsiError("INVALID_INPUT");
  if (v2.data.sort !== canonical || v2.data.direction !== requested.direction) throw new CsiError("INVALID_INPUT");
  return v2.data;
}

/** The row's value for a sort: a Date for the time sorts, a number for `interactions`, null when absent. */
export function sortFieldValue(row: ContactNumberLean, sort: NumberSearchSort): Date | number | null {
  const canonical = canonicalNumberSort(sort);
  if (canonical === "interactions") {
    const count = row.rollups?.interactions_total;
    return typeof count === "number" ? count : null;
  }
  const value =
    canonical === "last_human_conversation"
      ? row.rollups?.last_human_conversation_at
      : canonical === "first_observed"
        ? row.first_observed_at
        : row.last_activity_at;
  return value ? new Date(value) : null;
}

/** Cursor encoding of a sort value: ISO for dates, the number itself for counts. */
function cursorValue(value: Date | number | null): string | number | null {
  if (value === null) return null;
  return typeof value === "number" ? value : value.toISOString();
}

/** Mongo operand for a cursor value under a sort. */
function keysetOperand(sort: NumberSearchSort, value: string | number): Date | number {
  if (NUMERIC_NUMBER_SORTS.has(canonicalNumberSort(sort))) {
    if (typeof value !== "number") throw new CsiError("INVALID_INPUT");
    return value;
  }
  if (typeof value !== "string") throw new CsiError("INVALID_INPUT");
  return new Date(value);
}

/**
 * Pure filter for one segment of a sorted listing. The value segment is
 * `field != null` with the `(field, _id)` keyset in the requested direction;
 * the null segment is `field == null` (null or missing) keyed on `_id` alone.
 * Conditions go into `$and` so the activity range on `last_activity_at` is
 * never overwritten.
 */
export function buildSortedNumberSearchFilter(
  query: NumberSearchQuery,
  applied: NumberSortSpec,
  segment: NumberSortSegment,
  position: Pick<NumberSortCursor, "segment" | "value" | "id"> | null,
  term: ParsedSearchTerm = parseSearchTerm(query.q),
): Record<string, unknown> {
  const filter = buildNumberSearchFilter(query, null, term);
  const and = [...((filter.$and as Array<Record<string, unknown>> | undefined) ?? [])];
  const field = NUMBER_SORT_FIELDS[applied.sort];
  const after = applied.direction === "desc" ? "$lt" : "$gt";
  const inSegment = position && position.segment === segment ? position : null;
  if (segment === "value") {
    and.push({ [field]: { $ne: null } });
    if (inSegment) {
      const at = keysetOperand(applied.sort, inSegment.value!);
      const id = new mongoose.Types.ObjectId(inSegment.id);
      and.push({ $or: [{ [field]: { [after]: at } }, { [field]: at, _id: { [after]: id } }] });
    }
  } else {
    and.push({ [field]: null });
    if (inSegment) and.push({ _id: { [after]: new mongoose.Types.ObjectId(inSegment.id) } });
  }
  filter.$and = and;
  return filter;
}

export function sortedNumberMongoSort(applied: NumberSortSpec, segment: NumberSortSegment): Record<string, 1 | -1> {
  const dir = applied.direction === "desc" ? -1 : 1;
  return segment === "value" ? { [NUMBER_SORT_FIELDS[applied.sort]]: dir, _id: dir } : { _id: dir };
}

/** Row access used by the pager; Mongo in production, an in-memory evaluator in unit tests. */
export type NumberRowSource = {
  find(
    filter: Record<string, unknown>,
    sort: Record<string, 1 | -1>,
    limit: number,
    hint?: string,
  ): Promise<ContactNumberLean[]>;
  count(filter: Record<string, unknown>, limit: number): Promise<number>;
};

export type NumberSearchPageResult = {
  page: ContactNumberLean[];
  next: string | null;
  applied: NumberSortSpec;
  /** The index hinted for this page (q-narrowed set above the cap), if any. */
  hint?: string;
};

export function mongoNumberRowSource(): NumberRowSource {
  const Model = getContactNumberModel();
  return {
    find: async (filter, sort, limit, hint) => {
      const q = Model.find(filter).sort(sort).limit(limit);
      if (hint) q.hint(hint);
      return (await q.lean()) as unknown as ContactNumberLean[];
    },
    count: (filter, limit) => Model.countDocuments(filter, { limit }),
  };
}

/**
 * One page of the Numbers list. With neither `sort` nor `direction` this is
 * the historical single keyset query and legacy cursor, unchanged. Otherwise
 * it pages the non-null segment of the sort field, then the null segment by
 * `_id`, in at most two index-served queries.
 */
export async function pageNumberSearch(
  query: NumberSearchQuery,
  parsed: ParsedSearchTerm,
  source: NumberRowSource,
): Promise<NumberSearchPageResult> {
  if (query.sort === undefined && query.direction === undefined) {
    const cursor = query.cursor ? decodeNumberCursor(query.cursor) : null;
    const legacyHint = numberFilterHint(query, "last_activity", parsed);
    const rows = await source.find(
      buildNumberSearchFilter(query, cursor, parsed),
      { last_activity_at: -1, _id: -1 },
      query.limit + 1,
      ...(legacyHint ? [legacyHint] : []),
    );
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    const next =
      rows.length > query.limit && last
        ? encodeNumberCursor({
            last_activity_at: new Date(last.last_activity_at).toISOString(),
            id: String(last._id),
          })
        : null;
    return { page, next, applied: DEFAULT_SORT, ...(legacyHint ? { hint: legacyHint } : {}) };
  }

  const requested = resolveNumberSort(query);
  const digest = numberSearchDigest(query, requested);
  const position = query.cursor ? decodeNumberSortCursor(query.cursor, query, requested) : null;
  // The page echoes the requested name (an alias stays an alias); the field,
  // index and cursor use the canonical sort.
  const applied = requested;
  const canonical = canonicalNumberSort(applied.sort);
  let hint: string | undefined = numberFilterHint(query, applied.sort, parsed);
  if (parsed.kind !== "none" && canonical !== "last_activity") {
    // A q-narrowed set may be sorted in memory by the planner; bound that. Above
    // the cap, read in the sort index's own order instead. Both plans return
    // the same total order, so this is decided per page and needs no cursor state.
    const candidates = await source.count(buildNumberSearchFilter(query, null, parsed), NUMBER_SORT_CANDIDATE_CAP + 1);
    if (candidates > NUMBER_SORT_CANDIDATE_CAP) hint = NUMBER_SORT_INDEXES[canonical];
  }

  const want = query.limit + 1;
  const rows: ContactNumberLean[] = [];
  if (!position || position.segment === "value") {
    rows.push(
      ...(await source.find(
        buildSortedNumberSearchFilter(query, applied, "value", position, parsed),
        sortedNumberMongoSort(applied, "value"),
        want,
        hint,
      )),
    );
  }
  if (rows.length < want) {
    rows.push(
      ...(await source.find(
        buildSortedNumberSearchFilter(query, applied, "null", position, parsed),
        sortedNumberMongoSort(applied, "null"),
        want - rows.length,
        hint,
      )),
    );
  }
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  const lastValue = last ? sortFieldValue(last, applied.sort) : null;
  // `!= null`, never truthiness: `interactions_total: 0` is a value, not the null segment.
  const next =
    rows.length > query.limit && last
      ? encodeNumberSortCursor({
          v: 2,
          sort: canonical,
          direction: applied.direction,
          segment: lastValue != null ? "value" : "null",
          value: cursorValue(lastValue),
          id: String(last._id),
          digest,
        })
      : null;
  return { page, next, applied, ...(hint ? { hint } : {}) };
}

export type NumberSearchDeps = {
  now?: () => Date;
  /** Injection seam for tests; production uses the Outreach batch helper. */
  attachedLeadProgress?: (
    numberIds: readonly string[],
    now: Date,
  ) => Promise<ReadonlyMap<string, AttachedLeadProgressItemDto>>;
  source?: NumberRowSource;
};

export async function searchNumberActivity(
  query: NumberSearchQuery,
  deps: NumberSearchDeps = {},
): Promise<NumberSearchPageDto> {
  const parsed = parseSearchTerm(query.q);
  const match = { kind: parsed.kind };
  const { page, next, applied } = await pageNumberSearch(query, parsed, deps.source ?? mongoNumberRowSource());

  // One batched Lead progress read per page, never one per card.
  const now = deps.now?.() ?? new Date();
  const loadAttached = deps.attachedLeadProgress ?? loadAttachedLeadProgressForNumbers;
  const attached: ReadonlyMap<string, AttachedLeadProgressItemDto> = page.length
    ? await loadAttached(
        page.map((row) => String(row._id)),
        now,
      )
    : new Map();
  return numberSearchPageDtoSchema.parse(
    await ownerRead(
      {
        items: page.map((row) => toNumberSearchItem(row, match, attached.get(String(row._id)))),
        cursor: next,
        sort: applied,
      },
      deps.now,
    ),
  );
}
