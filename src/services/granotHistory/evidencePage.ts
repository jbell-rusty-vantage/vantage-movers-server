import {
  BSON,
  type ClientSession,
  type ObjectId,
  type Db,
  type Document,
} from "mongodb";
import { gzipSync, gunzipSync } from "node:zlib";
import { digest, type ArchivedChain } from "./archiveCodec";
import { readArchiveObject } from "./archiveObjects";

export const evidenceFormat = "granot-lead-evidence-v1";
/**
 * End of life (`endOfLife.ts`): a locator or catalog row past its `expires_at` reads as absent. The
 * TTL monitor may lag; the object itself leaves GCS at least a day later.
 */
export const liveRow = (now = new Date()) => ({ $or: [{ expires_at: { $exists: false } }, { expires_at: { $gt: now } }] });
export type EvidenceLocator = {
  hash: string;
  generation: string;
  job: string;
  format: typeof evidenceFormat;
};
const maxBytes = 8 * 1024 * 1024;

export function packEvidence(rows: ArchivedChain[]) {
  const bytes = BSON.serialize({ format: evidenceFormat, rows });
  if (bytes.length > maxBytes)
    throw new Error("Granot evidence page exceeds size limit");
  return gzipSync(bytes);
}

export function unpackEvidence(bytes: Buffer, hash: string): ArchivedChain[] {
  if (digest(bytes) !== hash)
    throw new Error("Granot evidence checksum mismatch");
  const doc = BSON.deserialize(
    gunzipSync(bytes, { maxOutputLength: maxBytes }),
  );
  if (
    doc.format !== evidenceFormat ||
    !Array.isArray(doc.rows) ||
    !doc.rows.length
  )
    throw new Error("Invalid Granot evidence page");
  return doc.rows;
}

export async function readEvidencePage(
  db: Db,
  locator: EvidenceLocator,
  read = readArchiveObject,
) {
  if (locator.format !== evidenceFormat || !locator.generation)
    throw new Error("Invalid Granot evidence locator");
  return unpackEvidence(
    await read(db.databaseName, locator.hash, locator.generation),
    locator.hash,
  );
}

export function evidenceForReceipt(
  rows: ArchivedChain[],
  receipt: Document,
  locator: EvidenceLocator,
) {
  const row = rows.find((c) => String(c.receipt._id) === String(receipt._id));
  if (
    !row ||
    row.observation.identity?.normalized_job_no !== locator.job ||
    String(row.observation.receipt_id) !== String(receipt._id) ||
    row.decisions.some(
      (d) => String(d.observation_id) !== String(row.observation._id),
    )
  )
    throw new Error("Granot archived evidence identity mismatch");
  return row;
}

/** Original-ID lookup for archive-aware replay and case readers. Only committed IDs appear in the catalog. */
export async function readEvidenceIds(
  db: Db,
  ids: ObjectId[],
  kind: "observation" | "decision",
  session?: ClientSession,
  read = readArchiveObject,
) {
  if (!ids.length) return [];
  const entries = await db
    .collection("granot_history_archive_chunks")
    .find({ format: evidenceFormat, evidence_ids: { $in: ids }, ...liveRow() }, { session })
    .toArray();
  const wanted = new Set(ids.map(String)),
    pages = new Map<string, ArchivedChain[]>(),
    found = new Map<string, Document>();
  for (const entry of entries) {
    let rows = pages.get(entry.hash);
    if (!rows) {
      rows = await readEvidencePage(
        db,
        {
          format: evidenceFormat,
          hash: entry.hash,
          generation: entry.generation,
          job: entry.job,
        },
        read,
      );
      pages.set(entry.hash, rows);
    }
    const committed = new Set(entry.evidence_ids.map(String));
    for (const chain of rows) {
      if (
        chain.observation.identity?.normalized_job_no !== entry.job ||
        !committed.has(String(chain.observation._id))
      )
        continue;
      for (const d of kind === "observation"
        ? [chain.observation]
        : chain.decisions) {
        const id = String(d._id);
        if (wanted.has(id) && committed.has(id)) found.set(id, d);
      }
    }
  }
  return Array.from(found.values());
}
