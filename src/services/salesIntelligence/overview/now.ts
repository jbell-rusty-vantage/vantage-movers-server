import { csiDataset } from "../../../config/domain/salesIntelligence";
import { getSalesIntelligenceAttentionSnapshotModel } from "../../../models/SalesIntelligenceAttentionSnapshot";
import type { AttentionFilterKeysDto, attentionRowDtoSchema } from "../dto";
import { attentionQuerySchema, decompressAttentionRows, type AttentionQuery } from "../outreach/attention";
import { attentionIndexEntry, decodeAttentionIndex, entryMatchesAttentionQuery, type AttentionIndexEntry } from "../outreach/attentionIndex";
import type { z } from "zod";

/**
 * S9 interface ("Why now is read from the index"): the Overview's "now" block is computed at read time
 * from the same published Attention index `GET /attention` filters, with the same predicate
 * (`entryMatchesAttentionQuery`) and the same Priority / agent parameters, so its band counts equal the
 * Needs Attention counts at the same `as_of` by construction (C8), and the publish walk adds nothing.
 *
 * The index is read through its own small per-process cache (newest two snapshots, like B8), so this
 * module needs nothing private from `attention.ts`.
 */
type Row = z.infer<typeof attentionRowDtoSchema>;
export type OverviewIndex = { snapshot_id: string; as_of: Date; entries: AttentionIndexEntry[] };
const CACHE = new Map<string, OverviewIndex>();
const CACHE_LIMIT = 2;
/** Tests only. */
export function clearOverviewIndexCache() { CACHE.clear(); }

/** The newest unexpired snapshot header's index (the same header lookup as `readAttention`), or null when none is published. */
export async function readOverviewIndex(now: Date): Promise<OverviewIndex | null> {
  const Snapshot = getSalesIntelligenceAttentionSnapshotModel();
  const header = await Snapshot.findOne({ ...csiDataset(), $and: [{ $or: [{ expires_at: null }, { expires_at: { $gt: now } }] }, { chunk_index: null }] })
    .select("snapshot_id as_of counts").sort({ as_of: -1 }).lean();
  if (!header) return null;
  const { deployment, database } = csiDataset();
  const key = `${deployment}:${database}:${header.snapshot_id}`;
  const cached = CACHE.get(key);
  if (cached) return cached;
  const payload = await Snapshot.findOne({ _id: header._id }).select("index_gzip_base64 rows rows_gzip_base64").lean() as
    { index_gzip_base64?: string | null; rows?: unknown[]; rows_gzip_base64?: string | null } | null;
  if (!payload) return null;
  let entries: AttentionIndexEntry[];
  if (payload.index_gzip_base64) entries = decodeAttentionIndex(payload.index_gzip_base64);
  else {
    // A snapshot published without an index (ATTENTION_V2 off): derive the entries from its rows, as `readAttention` does.
    let rows = (payload.rows_gzip_base64 ? decompressAttentionRows(payload.rows_gzip_base64) : payload.rows ?? []) as Row[];
    const chunks = header.counts?.chunks ?? 0;
    if (chunks > 0) {
      const parts = await Snapshot.find({ ...csiDataset(), parent_snapshot_id: header.snapshot_id }).sort({ chunk_index: 1 }).lean();
      rows = parts.flatMap(part => (Array.isArray(part.rows) ? part.rows : []) as Row[]);
    }
    entries = rows.map((row, position) => attentionIndexEntry(row, position));
  }
  const value = { snapshot_id: header.snapshot_id, as_of: header.as_of, entries };
  CACHE.set(key, value);
  while (CACHE.size > CACHE_LIMIT) CACHE.delete(CACHE.keys().next().value!);
  return value;
}

/** S9-PUBLISH adds `responsible` / `overdue` to `filter_keys`; until a snapshot carries them, derive them from what the entry holds. */
type NowKeys = AttentionFilterKeysDto & { responsible?: string | null; overdue?: boolean };
const OVERDUE_REASONS = new Set(["promised_callback_overdue", "followups_due", "no_call_yet"]);
export function entryResponsible(entry: Pick<AttentionIndexEntry, "filter_keys">): string | null {
  const keys = entry.filter_keys as NowKeys;
  if (keys.responsible !== undefined) return keys.responsible ?? null;
  return keys.agents.length === 1 ? keys.agents[0]! : null;
}
export function entryOverdue(entry: Pick<AttentionIndexEntry, "filter_keys" | "reasons">): boolean {
  const keys = entry.filter_keys as NowKeys;
  if (keys.overdue !== undefined) return keys.overdue;
  return entry.reasons.some(reason => OVERDUE_REASONS.has(reason));
}

export type BandCounts = { "1": number; "2": number; "3": number; "4": number; "5": number; "6": number; "7": number };
export const emptyBands = (): BandCounts => ({ "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0, "7": 0 });
export type NowRep = { agent_id: string; open: number; bands: BandCounts; overdue: number };
export type NowTally = { bands: BandCounts; needs_review: number; unassigned: number; live_calls: number; active: number; by_rep: Map<string, NowRep> };

/**
 * The "now" numbers over one index with the desk's Priority and agent filters:
 * - `bands`, `needs_review`, `unassigned`: the Needs Attention view (`view=attention`), exactly the
 *   rows `GET /attention?band=…|needs_review=true|unassigned=true` counts with the same filters;
 * - `live_calls`, `active` and per rep `{ open, bands, overdue }`: every active record (`view=all_outreach`),
 *   where "open" counts the record's responsible rep (addendum §6.2 "Open assignments").
 */
export function tallyNow(entries: readonly AttentionIndexEntry[], filters: { priority?: readonly string[] | null; agent_id?: readonly string[] | null }, asOf: Date): NowTally {
  const base = { ...(filters.priority?.length ? { priority: [...filters.priority] } : {}), ...(filters.agent_id?.length ? { agent_id: [...filters.agent_id] } : {}) };
  const attention: AttentionQuery = attentionQuerySchema.parse({ view: "attention", ...base });
  const active: AttentionQuery = attentionQuerySchema.parse({ view: "all_outreach", ...base });
  const context = { as_of: asOf };
  const out: NowTally = { bands: emptyBands(), needs_review: 0, unassigned: 0, live_calls: 0, active: 0, by_rep: new Map() };
  for (const entry of entries) {
    const keys = entry.filter_keys;
    if (entryMatchesAttentionQuery(entry, attention, context)) {
      if (keys.band != null) out.bands[String(keys.band) as keyof BandCounts]++;
      if (keys.needs_review) out.needs_review++;
      if (keys.agents.length === 0) out.unassigned++;
    }
    if (!entryMatchesAttentionQuery(entry, active, context)) continue;
    out.active++;
    if (keys.live_call) out.live_calls++;
    const rep = entryResponsible(entry);
    if (!rep) continue;
    let row = out.by_rep.get(rep);
    if (!row) out.by_rep.set(rep, row = { agent_id: rep, open: 0, bands: emptyBands(), overdue: 0 });
    row.open++;
    if (keys.band != null) row.bands[String(keys.band) as keyof BandCounts]++;
    if (entryOverdue(entry)) row.overdue++;
  }
  return out;
}

/** Subject keys of every row (both partitions) matching the Priority and agent filters: the record set a filtered flow count is limited to. */
export function filteredSubjects(entries: readonly AttentionIndexEntry[], filters: { priority?: readonly string[] | null; agent_id?: readonly string[] | null }, asOf: Date): Set<string> {
  const base = { ...(filters.priority?.length ? { priority: [...filters.priority] } : {}), ...(filters.agent_id?.length ? { agent_id: [...filters.agent_id] } : {}) };
  const views = (["all_outreach", "closed"] as const).map(view => attentionQuerySchema.parse({ view, ...base, ...(view === "all_outreach" ? { state: ["unworked", "open", "waiting_on_customer", "identity_review", "closed"] } : {}) }));
  return new Set(entries.filter(entry => views.some(query => entryMatchesAttentionQuery(entry, query, { as_of: asOf }))).map(entry => entry.subject_key));
}
