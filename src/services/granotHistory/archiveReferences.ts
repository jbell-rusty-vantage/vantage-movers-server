import type { Db, Document } from "mongodb";

/**
 * True while any MongoDB locator still points at the Granot archive object `hash`: catalog rows,
 * closed runs, retired-receipt locators (every format), evidence pointers and run summaries. This is
 * the `references` guard for `startRecoveryClock` and `deleteIfGeneration` (cloud-storage.md rule 2).
 * It reads at one snapshot so a locator committed during the check cannot be missed between collections.
 */
export async function archiveObjectReferenced(db: Db, hash: string) {
  const checks: [string, Document][] = [
    ["granot_history_archive_chunks", { $or: [{ _id: hash }, { hash }] }],
    ["granot_closed_automation_runs", { $or: [{ hash }, { "run_archive.hash": hash }] }],
    ["granot_archived_receipts", { $or: [{ hash }, { "evidence_archive.hash": hash }, { "history_archive.hash": hash }] }],
    ["granot_webhook_receipts", { $or: [{ "evidence_archive.hash": hash }, { "history_archive.hash": hash }] }],
    ["granot_automation_runs", { "archive_summary.hash": hash }],
  ];
  const session = db.client.startSession();
  try {
    return await session.withTransaction(async () => {
      for (const [name, filter] of checks) {
        if (await db.collection<Document & { _id: unknown }>(name).findOne(filter, { session, projection: { _id: 1 }, maxTimeMS: 5000 })) return true;
      }
      return false;
    }, { readConcern: { level: "snapshot" } });
  } finally { await session.endSession(); }
}
