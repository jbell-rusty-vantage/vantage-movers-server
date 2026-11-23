import { gunzipSync, gzipSync } from "node:zlib";
import mongoose from "mongoose";

/**
 * The driver's BSON through Mongoose. A value import from "mongodb" in runtime code is dropped by the production
 * build (`ReferenceError: mongodb_1 is not defined`, seen on the first cron run 2026-11-23); see src/utils/objectId.ts.
 */
export const bson = (mongoose.mongo as unknown as { BSON: typeof import("mongodb").BSON }).BSON;

/**
 * Validated retirement, step 2: a pack is the exact stored BSON of each job, concatenated in `_id` order and gzipped.
 * Nothing is re-serialized, so a restored row is byte-identical to what MongoDB held.
 */
export type RawRow = { raw: Buffer; id: string };

const MAX_PACK_BYTES = 32 * 1024 * 1024;

export function encodePack(rows: readonly RawRow[]): Buffer {
  return gzipSync(Buffer.concat([...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((r) => r.raw)));
}

export function decodePack(bytes: Buffer): RawRow[] {
  const body = gunzipSync(bytes, { maxOutputLength: MAX_PACK_BYTES });
  const rows: RawRow[] = [];
  for (let at = 0; at < body.length;) {
    const length = body.readInt32LE(at);
    if (length < 5 || at + length > body.length) throw new Error("pack_corrupt");
    const raw = body.subarray(at, at + length);
    rows.push({ raw, id: String(bson.deserialize(raw)._id) });
    at += length;
  }
  return rows;
}

/** The bytes read back from GCS must hold every original row exactly once, byte for byte. */
export function packHoldsExactly(persisted: Buffer, rows: readonly RawRow[]): boolean {
  let decoded: RawRow[];
  try {
    decoded = decodePack(persisted);
  } catch {
    return false;
  }
  if (decoded.length !== rows.length) return false;
  const byId = new Map(decoded.map((r) => [r.id, r.raw]));
  return byId.size === rows.length && rows.every((r) => byId.get(r.id)?.equals(r.raw) === true);
}
