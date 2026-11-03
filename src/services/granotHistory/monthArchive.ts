import type { Db } from "mongodb";
import { isDeepStrictEqual } from "node:util";
import {
  archiveJobKey,
  decodeChains,
  digest,
  encodeChains,
  type ArchivedChain,
} from "./archiveCodec";
import { archiveCatalog } from "./archiveReads";
import { readArchiveObject, storeArchiveObject } from "./archiveObjects";

/** One catalog row per job/month/page. Immutable content is uploaded and verified before replacing its pointer. */
export async function appendHistoryMonth(
  db: Db,
  job: string,
  month: string,
  incoming: ArchivedChain[],
) {
  if (
    !/^\d{4}-\d{2}$/.test(month) ||
    incoming.some(
      (c) => c.observation.captured_at.toISOString().slice(0, 7) !== month,
    )
  ) {
    throw new Error("Invalid archive month");
  }
  const catalog = archiveCatalog(db);
  const prefix = digest(Buffer.from(job)) + ":" + month + ":";
  const completed = new Map<string, string>();
  let pending = new Map(incoming.map((c) => [String(c.observation._id), c]));
  for (let page = 0; pending.size; page++) {
    if (page >= 128) throw new Error("Granot archive monthly limit exceeded");
    const key = prefix + page;
    let done = false;
    for (let retry = 0; retry < 5 && !done; retry++) {
      const old = await catalog.findOne({ _id: key });
      const contents = old?.hash
        ? decodeChains(
            await readArchiveObject(db.databaseName, old.hash),
            old.hash,
            job,
          )
        : [];
      const added: ArchivedChain[] = [];
      const found = new Set<string>();
      for (const c of contents) {
        const id = String(c.observation._id),
          candidate = pending.get(id);
        if (candidate) {
          if (!isDeepStrictEqual(c, candidate))
            throw new Error("Archived evidence changed");
          found.add(id);
        }
      }
      let bytes: Buffer | undefined;
      for (const [id, c] of pending) {
        if (found.has(id)) continue;
        if (contents.length + added.length >= 512) break;
        // Limit the final BSON size too. One jumbo chain remains protected if it cannot be archived.
        added.push(c);
      }
      while (added.length) {
        try {
          bytes = encodeChains(job, [...contents, ...added]);
          break;
        } catch (error) {
          if (
            !(error instanceof Error) ||
            error.message !== "Granot archive chunk too large"
          )
            throw error;
          if (!contents.length && added.length === 1) throw error;
          added.splice(Math.floor(added.length / 2));
        }
      }
      let hash = old?.hash;
      if (bytes) {
        hash = await storeArchiveObject(db.databaseName, bytes);
        const verified = decodeChains(
          await readArchiveObject(db.databaseName, hash),
          hash,
          job,
        );
        const dates = verified.map((c) => +c.observation.captured_at);
        const entry = {
          _id: key,
          hash,
          job,
          job_key: archiveJobKey(job),
          count: verified.length,
          oldest: new Date(Math.min(...dates)),
          newest: new Date(Math.max(...dates)),
        };
        try {
          const change = await catalog.replaceOne(
            { _id: key, hash: old?.hash ?? { $exists: false } },
            entry,
            { upsert: !old, writeConcern: { w: "majority" } },
          );
          if (!change.matchedCount && !change.upsertedCount) continue;
        } catch (e) {
          if ((e as { code?: number }).code === 11000) continue;
          throw e;
        }
      }
      if (!hash) throw new Error("Archive publication unavailable");
      for (const id of [
        ...found,
        ...added.map((c) => String(c.observation._id)),
      ]) {
        completed.set(id, hash);
        pending.delete(id);
      }
      done = true;
    }
    if (!done) throw new Error("Granot archive publication contention");
  }
  return completed;
}
