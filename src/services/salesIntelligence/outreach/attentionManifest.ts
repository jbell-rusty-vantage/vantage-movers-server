import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { z } from "zod";
import { attentionRowDtoSchema } from "../dto";
import { staffedMinutesBetween, type Staffing } from "./staffing";
import type { AttentionIndexEntry } from "./attentionIndex";

export const ATTENTION_ENCODING = "attention-manifest-v1";
export const ATTENTION_BUCKETS = 512;
const MAX_RAW_BYTES = 8_000_000;
const MAX_BINARY_BYTES = 8_000_000;
type Row = z.infer<typeof attentionRowDtoSchema>;
export type ArtifactKind = "rows" | "index" | "order";
export type AttentionArtifact = { hash: string; kind: ArtifactKind; bytes: Buffer; raw_bytes: number };
export const attentionManifestSchema = z.object({
  encoding: z.literal(ATTENTION_ENCODING),
  buckets: z.number().int().positive(),
  rows: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
  indexes: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
  order: z.string().regex(/^[a-f0-9]{64}$/),
  staffing: z.object({ timezone: z.string(), staffed_hours: z.array(z.object({ day: z.number(), start_minute: z.number(), end_minute: z.number() })) }),
}).strict();
export type AttentionManifest = z.infer<typeof attentionManifestSchema>;
export type ManifestEntry = AttentionIndexEntry & { bucket: string };
type StableRow = { row: Row; age_from: string | null };
export const attentionIdentity = (row: { subject_key: string; partition?: string }) => `${row.partition ?? "active"}:${row.subject_key}`;
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
function artifact(kind: ArtifactKind, value: unknown): AttentionArtifact {
  const raw = Buffer.from(JSON.stringify(value));
  const bytes = gzipSync(raw);
  if (raw.length > MAX_RAW_BYTES || bytes.length > MAX_BINARY_BYTES) throw new Error("Attention artifact exceeds size limit");
  return { kind, hash: digest(Buffer.concat([Buffer.from(`${ATTENTION_ENCODING}:${kind}:`), bytes])), bytes, raw_bytes: raw.length };
}
export function decodeAttentionArtifact(kind: ArtifactKind, hash: string, bytes: Buffer): unknown {
  if (digest(Buffer.concat([Buffer.from(`${ATTENTION_ENCODING}:${kind}:`), bytes])) !== hash) throw new Error("Attention artifact hash mismatch");
  return JSON.parse(gunzipSync(bytes, { maxOutputLength: MAX_RAW_BYTES }).toString("utf8"));
}
function stableRow(row: Row): StableRow {
  // These are the actual source instants, including future instants. Never infer from clamped ages.
  const age_from = row.outreach ? row.outreach.last_meaningful_contact_at ?? row.outreach.trigger_at : null;
  if (row.outreach && (!age_from || !Number.isFinite(Date.parse(age_from)))) throw new Error("Attention age source missing");
  const derived = { ...row.derived, age_wall_ms: 0, age_staffed_ms: 0 };
  return { age_from: age_from ?? null, row: { ...row, derived, outreach: row.outreach ? { ...row.outreach, derived: { ...row.outreach.derived, age_wall_ms: 0, age_staffed_ms: 0 } } : null } };
}
export function restoreAttentionRow(value: unknown, asOf: Date, staffing: Staffing): Row {
  const stable = value as StableRow;
  const row = stable.row;
  if (!row || (row.outreach && (!stable.age_from || !Number.isFinite(Date.parse(stable.age_from))))) throw new Error("Invalid stable Attention row");
  const from = stable.age_from ? new Date(stable.age_from) : null;
  const ages = { age_wall_ms: from ? Math.max(0, +asOf - +from) : 0,
    age_staffed_ms: from ? staffedMinutesBetween(from, asOf, staffing) * 60_000 : 0 };
  return attentionRowDtoSchema.parse({ ...row, derived: { ...row.derived, ...ages },
    outreach: row.outreach ? { ...row.outreach, derived: { ...row.outreach.derived, ...ages } } : null });
}
/** Fixed hash buckets; oversized buckets split on successive hash bits, never list positions. */
export function encodeAttentionManifest(rows: readonly Row[], staffing: Staffing,
  entryFor: (row: Row, position: number) => AttentionIndexEntry, buckets = ATTENTION_BUCKETS) {
  if (!Number.isInteger(Math.log2(buckets)) || buckets < 1 || buckets > 4096) throw new Error("Invalid Attention bucket count");
  const groups = new Map<string, Row[]>();
  const hashes = new Map<string, string>();
  for (const row of rows) {
    const id = attentionIdentity(row);
    if (hashes.has(id)) throw new Error("Duplicate Attention identity");
    const hash = digest(id); hashes.set(id, hash);
    const bucket = String(Number.parseInt(hash.slice(0, 8), 16) % buckets);
    const group = groups.get(bucket) ?? []; group.push(row); groups.set(bucket, group);
  }
  const artifacts: AttentionArtifact[] = [];
  const manifest: AttentionManifest = { encoding: ATTENTION_ENCODING, buckets, rows: {}, indexes: {}, order: "", staffing: structuredClone(staffing) };
  const entries: ManifestEntry[] = [];
  function encodeGroup(bucket: string, group: Row[], depth = 0) {
    group.sort((a, b) => attentionIdentity(a).localeCompare(attentionIdentity(b)));
    const stable = group.map(stableRow);
    const index = group.map((row, position) => ({ ...entryFor(row, position), bucket }));
    // Split before compression to bound both the Mongo document and decode memory.
    if (Buffer.byteLength(JSON.stringify(stable)) > MAX_RAW_BYTES || Buffer.byteLength(JSON.stringify(index)) > MAX_RAW_BYTES) {
      if (group.length === 1 || depth >= 192) throw new Error("Attention row exceeds size limit");
      const halves: Row[][] = [[], []];
      for (const row of group) {
        const hash = hashes.get(attentionIdentity(row))!;
        const bit = (Number.parseInt(hash[8 + Math.floor(depth / 4)]!, 16) >> (depth % 4)) & 1;
        halves[bit]!.push(row);
      }
      halves.forEach((half, bit) => { if (half.length) encodeGroup(`${bucket}.${bit}`, half, depth + 1); });
      return;
    }
    const payload = artifact("rows", stable), compact = artifact("index", index);
    artifacts.push(payload, compact); entries.push(...index);
    manifest.rows[bucket] = payload.hash; manifest.indexes[bucket] = compact.hash;
  }
  for (const [bucket, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) encodeGroup(bucket, group);
  const order = artifact("order", rows.map(attentionIdentity)); artifacts.push(order); manifest.order = order.hash;
  return { manifest, artifacts, entries };
}
export function orderManifestEntries(entries: ManifestEntry[], order: unknown): ManifestEntry[] {
  if (!Array.isArray(order) || order.length !== entries.length) throw new Error("Invalid Attention order");
  const byId = new Map(entries.map(entry => [attentionIdentity(entry), entry]));
  if (byId.size !== entries.length) throw new Error("Duplicate Attention index identity");
  return order.map(id => {
    const entry = byId.get(id); if (!entry) throw new Error("Attention order/index mismatch");
    byId.delete(id); return entry;
  });
}
export function attentionArtifactHashes(manifest: AttentionManifest) {
  return [...Object.values(manifest.rows), ...Object.values(manifest.indexes), manifest.order];
}
