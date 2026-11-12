import type { Db } from "mongodb";
import { archiveJobKey, decodeChains, encodeChains, type ArchivedChain } from "./archiveCodec";
import { archiveCatalog } from "./archiveReads";
import { readArchiveObject, storeArchiveObject } from "./archiveObjects";

/** Readers discover a chunk only after it has been uploaded, fetched and decoded. */
export async function publishArchiveChunk(db: Db, job: string, chains: ArchivedChain[]) {
  const bytes = encodeChains(job, chains);
  const hash = await storeArchiveObject(db.databaseName, bytes);
  const restored = decodeChains(await readArchiveObject(db.databaseName, hash), hash, job);
  const times = restored.map(c => +c.observation.captured_at);
  const entry = { _id: hash, job, job_key: archiveJobKey(job), oldest: new Date(Math.min(...times)),
    newest: new Date(Math.max(...times)), count: restored.length };
  const result = await archiveCatalog(db).updateOne(entry, { $setOnInsert: entry }, { upsert: true, writeConcern: { w: "majority" } });
  return { hash, bytes: bytes.length, count: restored.length, inserted: result.upsertedCount === 1 };
}
