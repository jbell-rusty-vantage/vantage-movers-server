import type { ClientSession } from "mongoose";
import { csiDataset } from "../../../config/domain/salesIntelligence";
import { withTransaction } from "../../../db";
import { getAttentionArtifactModel } from "../../../models/salesIntelligence/attentionArtifact";
import { getSalesIntelligenceAttentionSnapshotModel } from "../../../models/SalesIntelligenceAttentionSnapshot";
import { getSalesIntelligenceSyncStateModel } from "../../../models/SalesIntelligenceSyncState";
import { ConcurrentAttentionPublishError, attentionPublishFenceScope } from "./bandTransitions";
import { ATTENTION_ENCODING, attentionArtifactHashes, attentionManifestSchema, decodeAttentionArtifact, orderManifestEntries,
  type ArtifactKind, type AttentionArtifact, type AttentionManifest, type ManifestEntry } from "./attentionManifest";

export const ATTENTION_READ_GRACE_MS = 5 * 60_000;
const GC_MIN_AGE_MS = 15 * 60_000;
const GC_BATCH = 256;
const scope = () => `attention_artifacts:${csiDataset().deployment}:${csiDataset().database}`;
/** Epoch changes only on evidence erasure. A build begun before erasure cannot republish its content. */
export async function attentionArtifactEpoch() {
  const state = await getSalesIntelligenceSyncStateModel().collection.findOne({ scope: scope() });
  return Number(state?.artifact_epoch ?? 0);
}
/** Publisher, collector and erasure all write this document first, in their transaction. */
export async function lockAttentionArtifacts(session: ClientSession, expectedEpoch?: number, purge = false) {
  const filter = { scope: scope(), ...(expectedEpoch === undefined ? {} : { artifact_epoch: expectedEpoch }) };
  try {
    await getSalesIntelligenceSyncStateModel().collection.updateOne(filter,
      { $inc: { artifact_serial: 1, ...(purge ? { artifact_epoch: 1 } : {}) },
        ...(!purge ? { $setOnInsert: { artifact_epoch: 0 } } : {}) }, { session, upsert: true });
    if (purge) {
      // Erasure expires every comparison header. Reset its publication bound in
      // the same transaction so the new epoch can rebuild immediately; builders
      // from before erasure still fail the epoch check before touching this fence.
      await getSalesIntelligenceSyncStateModel().collection.updateOne(
        { scope: attentionPublishFenceScope(csiDataset()) },
        { $set: { last_as_of: new Date(0) }, $unset: { last_snapshot_id: "" } }, { session });
    }
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw new ConcurrentAttentionPublishError();
    throw error;
  }
}
export async function writeAttentionArtifacts(artifacts: AttentionArtifact[], session: ClientSession) {
  const Model = getAttentionArtifactModel();
  const dataset = csiDataset();
  const existing = new Set((await Model.find({ ...dataset, encoding: ATTENTION_ENCODING, hash: { $in: artifacts.map(a => a.hash) } })
    .select("hash").session(session).lean()).map(a => a.hash));
  const missing = artifacts.filter(a => !existing.has(a.hash));
  if (missing.length) await Model.insertMany(missing.map(a => ({ ...a, ...dataset, encoding: ATTENTION_ENCODING, created_at: new Date() })), { session });
  return { inserted_artifacts: missing.length, reused_artifacts: artifacts.length - missing.length,
    artifact_bytes: missing.reduce((sum, a) => sum + a.bytes.length, 0) };
}

/** Bounded cross-snapshot reuse. Headers are still checked on every read, including warm reads. */
const CACHE = new Map<string, { value: unknown; size: number }>();
let cacheBytes = 0;
const CACHE_BYTES = 24_000_000;
function binaryBytes(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value && typeof value === "object" && "buffer" in value && value.buffer instanceof Uint8Array) return Buffer.from(value.buffer);
  throw new Error("Invalid Attention Binary payload");
}
export function clearAttentionArtifacts() { CACHE.clear(); cacheBytes = 0; }
export async function loadAttentionArtifacts(kind: ArtifactKind, hashes: string[]) {
  const unique = [...new Set(hashes)];
  const dataset = csiDataset();
  const key = (hash: string) => `${dataset.deployment}:${dataset.database}:${ATTENTION_ENCODING}:${kind}:${hash}`;
  const result = new Map<string, unknown>();
  const missing: string[] = [];
  for (const hash of unique) {
    const cached = CACHE.get(key(hash));
    if (cached) result.set(hash, cached.value); else missing.push(hash);
  }
  if (missing.length) {
    const rows = await getAttentionArtifactModel().find({ ...dataset, encoding: ATTENTION_ENCODING, kind, hash: { $in: missing } }).lean();
    if (rows.length !== missing.length) throw new Error("Attention artifact missing");
    for (const row of rows) {
      // Mongoose lean Buffer values are BSON Binary; hydrated/test values can be Buffers.
      const bytes = binaryBytes(row.bytes);
      const value = decodeAttentionArtifact(kind, row.hash, bytes);
      result.set(row.hash, value);
      if (row.raw_bytes <= CACHE_BYTES) {
        while (cacheBytes + row.raw_bytes > CACHE_BYTES && CACHE.size) {
          const oldest = CACHE.keys().next().value!; cacheBytes -= CACHE.get(oldest)!.size; CACHE.delete(oldest);
        }
        if (!CACHE.has(key(row.hash))) { CACHE.set(key(row.hash), { value, size: row.raw_bytes }); cacheBytes += row.raw_bytes; }
      }
    }
  }
  return result;
}
export async function readManifestIndex(manifest: AttentionManifest): Promise<ManifestEntry[]> {
  if (JSON.stringify(Object.keys(manifest.rows).sort()) !== JSON.stringify(Object.keys(manifest.indexes).sort())) throw new Error("Attention manifest bucket mismatch");
  const [indexes, orders] = await Promise.all([loadAttentionArtifacts("index", Object.values(manifest.indexes)), loadAttentionArtifacts("order", [manifest.order])]);
  const entries: ManifestEntry[] = [];
  for (const [bucket, hash] of Object.entries(manifest.indexes)) {
    const part = indexes.get(hash);
    if (!Array.isArray(part) || !manifest.rows[bucket]) throw new Error("Invalid Attention index bucket");
    for (const [position, value] of part.entries()) {
      const entry = value as ManifestEntry;
      if (entry.bucket !== bucket || entry.position !== position) throw new Error("Attention bucket/index mismatch");
      entries.push(entry);
    }
  }
  return orderManifestEntries(entries, orders.get(manifest.order));
}
/** Mark from retained headers and sweep a bounded batch under the same transaction lock as publication.
 * Headers remain physically retained through cursor expiry + read grace; shared artifacts have NO TTL.
 */
export async function collectAttentionArtifacts(now = new Date()) {
  return withTransaction(async session => {
    await lockAttentionArtifacts(session);
    const headers = await getSalesIntelligenceAttentionSnapshotModel().find({ ...csiDataset(), manifest: { $ne: null },
      $or: [{ expires_at: null }, { expires_at: { $gt: now } }] }).select("manifest").session(session).lean();
    const pins = [...new Set(headers.flatMap(header => attentionArtifactHashes(attentionManifestSchema.parse(header.manifest))))];
    const Model = getAttentionArtifactModel();
    const candidates = await Model.find({ ...csiDataset(), created_at: { $lt: new Date(+now - GC_MIN_AGE_MS) }, hash: { $nin: pins } })
      .select("_id").sort({ created_at: 1 }).limit(GC_BATCH).session(session).lean();
    if (!candidates.length) return 0;
    const result = await Model.collection.deleteMany({ ...csiDataset(), _id: { $in: candidates.map(a => a._id) } }, { session });
    return result.deletedCount;
  });
}
