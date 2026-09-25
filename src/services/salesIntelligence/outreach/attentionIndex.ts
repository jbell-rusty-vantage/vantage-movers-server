import { gzipSync, gunzipSync } from "node:zlib";
import type { z } from "zod";
import type { AttentionFilterKeysDto, attentionRowDtoSchema, attentionSortKeysDtoSchema } from "../dto";
import type { AttentionQuery } from "./attention";
import { easternDay } from "./facts";

type Row = z.infer<typeof attentionRowDtoSchema>;
type SortKeys = z.infer<typeof attentionSortKeysDtoSchema>;

/**
 * Data spec §3.7 / D9 (S2): the compact per-row index the read filters, sorts and counts over.
 * Stored gzip+base64 on the snapshot header (`index_gzip_base64`) so a `GET /attention` never
 * decodes the whole row array; only the page's rows are materialized. `chunk_index` is null for
 * an inline snapshot, whose `position` is the row's offset in the stored row array; for a chunked
 * snapshot `position` is the offset inside that chunk. `reasons` feeds `reason_counts`.
 *
 * `legacy` marks an entry built from a row published before S2 (no `filter_keys`): only the
 * pre-S2 parameters (band, state, agent, needs_review, view, freshness) can match it.
 */
export type AttentionIndexEntry = {
  subject_key: string;
  partition: "active" | "closed";
  in_attention: boolean | null;
  sort_keys: Partial<SortKeys>;
  filter_keys: AttentionFilterKeysDto;
  reasons: string[];
  chunk_index: number | null;
  position: number;
  legacy?: true;
  /**
   * S9-PUBLISH (SALES_INTELLIGENCE_OVERVIEW): the active row's `outreach.band_since` and record `revision`, so the next
   * publish compares bands and carries `band_since` from the index alone. Present only on rows published with the flag.
   */
  band_since?: { at: string; estimated: boolean } | null;
  revision?: number;
};

/** The pre-S2 matching inputs, read from the row DTO exactly as the legacy predicate did. */
function legacyFilterKeys(row: Row): AttentionFilterKeysDto {
  const outreach = row.outreach;
  const agents = [...new Set([outreach?.assignment.agent?.id, ...(outreach?.followups ?? []).flatMap(action => [action.assignment.agent?.id, action.promised_by?.id])]
    .filter((value): value is string => Boolean(value)))].sort();
  return { band: row.derived.attention_band ?? null, needs_review: Boolean(row.derived.review_badges?.length), state: outreach?.state ?? null, agents,
    attachment: row.subject?.kind === "lead" ? "lead" : "none", priority: null, has_recording: false, has_assessment: false, newer_call: false,
    ti: null, ml: null, received_at: null, move_date: null, outcome: null, closed_at: null };
}

/**
 * S7-PRIO (addendum §5, E12–E14): per Priority key (a Granot code, `not_set` for a Lead without one,
 * `no_lead`), how many rows each view returns with no other filter: `attention` (the Needs Attention
 * view), `active` (All Outreach: every active row except closed work, which it keeps only while a band
 * or review badge holds it on the desk, UX-C1) and `closed` (the Closed view's partition).
 */
export function attentionPriorityCounts(entries: Iterable<Pick<AttentionIndexEntry, "partition" | "in_attention" | "filter_keys">>) {
  const counts: Record<string, { attention: number; active: number; closed: number }> = {};
  for (const entry of entries) {
    const bucket = (counts[entry.filter_keys.priority ?? "not_set"] ??= { attention: 0, active: 0, closed: 0 });
    if (entry.partition === "closed") { bucket.closed++; continue; }
    if (entry.in_attention !== false) bucket.attention++;
    if (entry.filter_keys.state !== "closed" || entry.in_attention !== false) bucket.active++;
  }
  return counts;
}

export function attentionIndexEntry(row: Row, position: number, chunk_index: number | null = null): AttentionIndexEntry {
  const entry: AttentionIndexEntry = { subject_key: row.subject_key, partition: row.partition ?? "active", in_attention: row.in_attention ?? null,
    sort_keys: row.sort_keys ?? {}, filter_keys: row.filter_keys ?? legacyFilterKeys(row), reasons: row.derived.reasons ?? [], chunk_index, position };
  if (!row.filter_keys) entry.legacy = true;
  if (row.outreach && row.outreach.band_since !== undefined) {
    entry.band_since = row.outreach.band_since;
    entry.revision = row.outreach.revision;
  }
  return entry;
}

/** Parameters that read an S2 filter key; a legacy entry never matches any of them. */
const S2_PARAMS = ["unassigned", "attachment", "priority", "has_recording", "has_assessment", "newer_call", "ti_min", "ml_min", "received_from", "received_to",
  "move_date_within", "move_date_passed", "outcome", "closed_from", "closed_to"] as const;

/** `YYYY-MM-DD` plus `days` calendar days (pure date arithmetic, no time zone). */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Reference instant of the read: the snapshot `as_of` (data spec §3.8). */
export type AttentionMatchContext = { as_of: Date };
const inRange = (value: string | null, from?: string, to?: string) => {
  if (!from && !to) return true;
  if (value == null) return false;
  const at = Date.parse(value);
  return (!from || at >= Date.parse(from)) && (!to || at < Date.parse(to));
};

/**
 * Data spec §3.4: every desk parameter against the frozen keys. Views: `attention` keeps band/badge
 * rows of the active partition (a missing marker counts as in Attention); `all_outreach` adds every
 * active row but still hides closed work unless `state=closed` or the row is in Attention (UX-C1: a
 * review badge keeps closed work on the desk, and the Owner's one Outreach list must show it);
 * `closed` reads only the closed partition.
 * Bounds are half-open `[from, to)`; a null key never matches a bound, a minimum or a boolean.
 */
export function entryMatchesAttentionQuery(entry: AttentionIndexEntry, query: AttentionQuery, context?: AttentionMatchContext): boolean {
  const keys = entry.filter_keys;
  if (query.view === "closed") {
    if (entry.partition !== "closed") return false;
  } else {
    if (entry.partition === "closed") return false;
    if (query.view !== "all_outreach" && entry.in_attention === false) return false;
    if (query.view === "all_outreach" && keys.state === "closed" && entry.in_attention === false && !query.state?.includes("closed")) return false;
  }
  if (entry.legacy && S2_PARAMS.some(param => query[param] !== undefined)) return false;
  if (query.freshness === "fresh" && entry.sort_keys.assessment_stale === true) return false;
  if (query.band?.length && (keys.band == null || !query.band.includes(keys.band))) return false;
  if (query.state?.length && (!keys.state || !query.state.includes(keys.state as NonNullable<AttentionQuery["state"]>[number]))) return false;
  if (query.agent_id?.length && !keys.agents.some(agent => query.agent_id!.includes(agent))) return false;
  if (query.unassigned !== undefined && (keys.agents.length === 0) !== (query.unassigned === "true")) return false;
  if (query.needs_review !== undefined && keys.needs_review !== (query.needs_review === "true")) return false;
  if (query.attachment && keys.attachment !== query.attachment) return false;
  if (query.priority?.length && !query.priority.includes(keys.priority ?? "not_set")) return false;
  if (query.has_recording !== undefined && keys.has_recording !== (query.has_recording === "true")) return false;
  if (query.has_assessment !== undefined && keys.has_assessment !== (query.has_assessment === "true")) return false;
  if (query.newer_call !== undefined && keys.newer_call !== (query.newer_call === "true")) return false;
  if (query.ti_min !== undefined && (keys.ti == null || keys.ti < query.ti_min)) return false;
  if (query.ml_min !== undefined && (keys.ml == null || keys.ml < query.ml_min)) return false;
  if (!inRange(keys.received_at, query.received_from, query.received_to)) return false;
  if (query.move_date_within !== undefined || query.move_date_passed !== undefined) {
    if (!context) throw new Error("move-date filters need the snapshot as_of");
    const today = easternDay(context.as_of);
    if (keys.move_date == null) return false;
    if (query.move_date_within !== undefined && (keys.move_date < today || keys.move_date > addDays(today, query.move_date_within))) return false;
    if (query.move_date_passed !== undefined && (keys.move_date < today) !== (query.move_date_passed === "true")) return false;
  }
  if (query.outcome?.length && (keys.outcome == null || !query.outcome.includes(keys.outcome))) return false;
  if (!inRange(keys.closed_at, query.closed_from, query.closed_to)) return false;
  return true;
}

/**
 * Global order over the filtered set: value order, nulls last in both directions, ties on
 * subject_key. Time keys compare as ISO strings, counts and scores numerically. `attention`
 * keeps the stored band order.
 */
export function sortAttentionEntries<T extends { subject_key: string; sort_keys?: Partial<SortKeys> | null }>(rows: readonly T[], sort: AttentionQuery["sort"], direction: "asc" | "desc"): T[] {
  if (sort === "attention") return [...rows];
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = a.sort_keys?.[sort] ?? null, right = b.sort_keys?.[sort] ?? null;
    if (left === null && right === null) return a.subject_key.localeCompare(b.subject_key);
    if (left === null) return 1;
    if (right === null) return -1;
    const order = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right));
    return sign * order || a.subject_key.localeCompare(b.subject_key);
  });
}

export function encodeAttentionIndex(entries: readonly AttentionIndexEntry[]): string {
  return gzipSync(Buffer.from(JSON.stringify(entries))).toString("base64");
}
const INDEX_DECODE_MAX_BYTES = 64_000_000;
export function decodeAttentionIndex(encoded: string): AttentionIndexEntry[] {
  const entries: unknown = JSON.parse(gunzipSync(Buffer.from(encoded, "base64"), { maxOutputLength: INDEX_DECODE_MAX_BYTES }).toString("utf8"));
  if (!Array.isArray(entries)) throw new Error("Invalid Attention index");
  return entries as AttentionIndexEntry[];
}
