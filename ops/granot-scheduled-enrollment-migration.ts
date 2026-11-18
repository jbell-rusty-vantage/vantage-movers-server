import { type Db, type ObjectId } from "mongodb";
import { GRANOT_ESTIMATES_CRON_ACTOR_ID } from "../src/services/domainCommands/types";

export const legacyScheduled = {
  operation: "estimates_in_process", workflow: "apply",
  "initiator.actor_type": "system", "initiator.actor_id": GRANOT_ESTIMATES_CRON_ACTOR_ID,
  "request_snapshot.auto_apply": true, "request_snapshot.scheduled_slot_key": { $type: "string" },
  archive_summary: { $exists: false }, archive_review_at: { $exists: false }, purge_at: { $type: "date" },
} as const;

const id = "scheduled-run-archive-enrollment-v1";
const oldInvocationMaxMs = 800_000; // api/index.ts maxDuration in vercel.json
type Progress = {
  _id: string; cutoff: Date; final_after: Date; stage: "initial" | "awaiting_final_pass" | "final" | "complete";
  upper: ObjectId | null; cursor: ObjectId | null; pages: number; examined: number; enrolled: number; completed_at?: Date;
};
const checkpoints = (db: Db) => db.collection<Progress>("granot_retention_control");
export const migrationStatus = (db: Db) => checkpoints(db).findOne({ _id: id });

/** Traverse each fixed hash-ID range in small transactions. The final pass catches overlapping old invocations. */
export async function migrateScheduledEnrollment(db: Db, cutoff: Date, pageLimit: number, size: number, now = new Date()) {
  if (!Number.isFinite(+cutoff) || +cutoff > +now || !Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > 128 ||
      !Number.isInteger(size) || size < 1 || size > 500) throw new Error("Invalid scheduled archive migration bounds");
  const runs = db.collection("granot_automation_runs"), states = checkpoints(db);
  const indices = await runs.indexes();
  if (!indices.some(i => i.name === "granot_scheduled_archive_due" && i.key?.archive_review_at === 1 && i.sparse))
    throw new Error("Scheduled archive review index missing");
  const session = db.client.startSession();
  try {
    for (let page = 0; page < pageLimit; page++) {
      const proceed = await session.withTransaction(async () => {
        let state = await states.findOne({ _id: id }, { session });
        if (state && +state.cutoff !== +cutoff) throw new Error("Existing scheduled archive migration has another cutover");
        if (state?.stage === "complete" || (state?.stage === "awaiting_final_pass" && +now < +state.final_after)) return false;
        if (!state || state.stage === "awaiting_final_pass") {
          const last = await runs.findOne({}, { session, sort: { _id: -1 }, projection: { _id: 1 }, hint: "_id_", maxTimeMS: 3000 });
          const finalAfter = new Date(+cutoff + oldInvocationMaxMs);
          state = {
            _id: id, cutoff, final_after: finalAfter, stage: +now >= +finalAfter ? "final" : "initial",
            cursor: null, upper: last?._id ?? null, pages: state?.pages ?? 0, examined: state?.examined ?? 0, enrolled: state?.enrolled ?? 0,
          };
          await states.replaceOne({ _id: id }, state, { upsert: true, session });
        }
        const ids = state.upper ? await runs.find({
          _id: { $lte: state.upper, ...(state.cursor ? { $gt: state.cursor } : {}) },
        }, { session, sort: { _id: 1 }, projection: { _id: 1 }, hint: "_id_", maxTimeMS: 3000 }).limit(size).toArray() : [];
        const result = ids.length ? await runs.updateMany({
          ...legacyScheduled, _id: { $in: ids.map(x => x._id) }, createdAt: { $lte: state.final_after }, expires_at: { $type: "date" },
        }, [{ $set: { archive_review_at: "$expires_at", purge_at: null } }], { session, maxTimeMS: 5000 }) : null;
        const cursor = ids.at(-1)?._id ?? state.cursor;
        const done = ids.length < size || !!cursor?.equals(state.upper);
        const stage = done ? (state.stage === "final" ? "complete" : "awaiting_final_pass") : state.stage;
        await states.updateOne({ _id: id }, {
          $inc: { pages: 1, examined: ids.length, enrolled: result?.modifiedCount ?? 0 },
          $set: { cursor, stage, ...(stage === "complete" ? { completed_at: now } : {}) },
        }, { session });
        return !done;
      }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
      if (!proceed) break;
    }
    return migrationStatus(db);
  } finally { await session.endSession(); }
}
