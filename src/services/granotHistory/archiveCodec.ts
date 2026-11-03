import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { BSON, type Document } from "mongodb";
import { jobNumberDigitCore } from "../bookings/bookingIdentity";

export type ArchivedChain = { observation: Document; receipt: Document; decisions: Document[] };
export const ARCHIVE_BUCKET = "vantage-mongodb-backups-496816";
const MAX_BYTES = 8 * 1024 * 1024;
export const archiveJobKey = (job: string) => jobNumberDigitCore(job) ?? job;
export const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export function archiveObject(database: string, hash: string) {
  if (!/^(vantagemovers|testvantagemovers(?:_[a-z0-9]+)?)$/.test(database) || !/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid Granot archive address");
  return `history/granot/v1/${database}/${hash.slice(0, 2)}/${hash}.bson.gz`;
}

function validateChains(chains: ArchivedChain[], job: string) {
  if (!job || !Array.isArray(chains) || !chains.length || chains.length > 512) throw new Error("Invalid Granot archive chunk");
  const seen = new Set<string>();
  for (const { observation: o, receipt: r, decisions } of chains) {
    if (!o?._id || !r?._id || String(o.receipt_id) !== String(r._id) || o.identity?.normalized_job_no !== job
      || !(o.captured_at instanceof Date) || seen.has(String(o._id)) || !Array.isArray(decisions) || !decisions.length
      || decisions.some(d => !d._id || String(d.observation_id) !== String(o._id))) throw new Error("Granot archive evidence mismatch");
    seen.add(String(o._id));
  }
}
export function encodeChains(job: string, chains: ArchivedChain[]) {
  validateChains(chains, job);
  const bson = BSON.serialize({ version: 1, job, chains });
  if (bson.length > MAX_BYTES) throw new Error("Granot archive chunk too large");
  return gzipSync(bson);
}
export function decodeChains(bytes: Buffer, expected: string, job: string): ArchivedChain[] {
  if (digest(bytes) !== expected) throw new Error("Granot archive checksum mismatch");
  const doc = BSON.deserialize(gunzipSync(bytes, { maxOutputLength: MAX_BYTES }));
  if (doc.version !== 1 || doc.job !== job) throw new Error("Granot archive identity mismatch");
  validateChains(doc.chains, job);
  return doc.chains;
}
