import type { Db, Document } from "mongodb";
import { archiveJobKey, decodeChains } from "./archiveCodec";

export type ArchiveEntry = { _id: string; job: string; job_key: string; newest: Date; oldest: Date; count: number };
export const archiveCatalog = (db: Db) => db.collection<ArchiveEntry>("granot_history_archive_chunks");
export function mergeEvidence(hot: Document[], cold: Document[]): Document[] {
  const rows = new Map(cold.map(row => [String(row._id), row]));
  for (const row of hot) rows.set(String(row._id), row);
  return [...rows.values()];
}

export async function* archivedChains(db: Db, job: string, options: { exact?: boolean; since?: () => number } = {}) {
  const cursor = archiveCatalog(db).find({ job_key: archiveJobKey(job), ...(options.exact ? { job } : {}) })
    .sort({ newest: -1 }).batchSize(16).maxTimeMS(5000);
  try {
    for await (const entry of cursor) {
      if (+entry.newest < (options.since?.() ?? -Infinity)) break;
      const { readArchiveObject } = await import("./archiveObjects.js");
      const rows = decodeChains(await readArchiveObject(db.databaseName, entry._id), entry._id, entry.job);
      if (rows.length !== entry.count) throw new Error("Granot archive count mismatch");
      yield rows;
    }
  } finally { await cursor.close(); }
}

export async function recentHistoryObservations(db: Db, job: string, hot: Document[], limit: number) {
  const newest = (rows: Document[]) => rows.sort((a,b) => +b.captured_at - +a.captured_at || String(b._id).localeCompare(String(a._id))).slice(0, limit);
  let rows = newest([...hot]);
  for await (const batch of archivedChains(db, job, { exact: true, since: () => rows.length === limit ? +rows[limit-1].captured_at : -Infinity })) {
    rows = newest(mergeEvidence(rows, batch.map(chain => chain.observation)));
  }
  return rows;
}
