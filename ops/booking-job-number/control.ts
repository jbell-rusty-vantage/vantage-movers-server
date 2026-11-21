/**
 * Booking Job Number validation control (runtime configuration in Mongo, never an env var).
 *
 * Status (read-only): mode, rule version, the records split into blocked (refused in `enforce`:
 * `missing` from a non-Granot write) and recorded only (every `shadow` record, plus `enforce` writes
 * exempt by reason or by Granot lifecycle origin), by reason, write path, mode and exemption, and the
 * normalization invariant (last hourly cron result plus a live count of Bookings whose
 * `normalized_job_no` disagrees with `normalizeJobNo(job_no)`; must be 0).
 *   node --env-file=.env --import tsx ops/booking-job-number/control.ts status
 *
 * Set the mode (the Owner decides `enforce`; `shadow` is the default and the rollback):
 *   node --env-file=.env --import tsx ops/booking-job-number/control.ts set --mode=enforce --reason="<why>" --actor="<who>" --apply
 *
 * Without `--apply`, `set` prints the planned document and writes nothing. Missing or unknown
 * mode values read as `shadow` in the server, so deleting the document is also a rollback.
 */
import { MongoClient } from "mongodb";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { BOOKING_JOB_NUMBER_RULE_VERSION } from "../../src/services/bookings/bookingJobNumber";
import {
  BOOKING_JOB_NORMALIZATION_STATE_ID,
  findBookingJobNormalizationDrift,
} from "../../src/services/bookings/bookingJobNormalizationInvariant";
import {
  BOOKING_JOB_NUMBER_CHECKS_COLLECTION,
  BOOKING_JOB_NUMBER_CONTROL_COLLECTION,
  BOOKING_JOB_NUMBER_CONTROL_ID,
} from "../../src/services/bookings/bookingJobNumberGuard";

const [command = "status", ...rest] = process.argv.slice(2);
const flag = (name: string) => rest.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const uri = process.env.MONGO_URI;
if (!uri) throw new Error("MONGO_URI is required");
// The server's own guarded selector: same TEST_MODE parsing and isolated-name check as the API.
const database = getMongoDatabaseName();
const client = new MongoClient(uri);

async function main() {
  await client.connect();
  const db = client.db(database);
  const control = db.collection<{ _id: string }>(BOOKING_JOB_NUMBER_CONTROL_COLLECTION);
  if (command === "status") {
    const row = await control.findOne({ _id: BOOKING_JOB_NUMBER_CONTROL_ID });
    const checks = db.collection(BOOKING_JOB_NUMBER_CHECKS_COLLECTION);
    const byReason = await checks.aggregate([
      { $group: {
        _id: { blocked: { $eq: ["$enforced", true] }, reason: "$reason", write_path: "$write_path", mode: "$mode", exemption: { $ifNull: ["$exemption", null] } },
        records: { $sum: 1 },
        last_seen_at: { $max: "$last_seen_at" },
      } },
      { $sort: { records: -1 } },
    ]).toArray();
    console.log(JSON.stringify({
      database,
      rule_version: BOOKING_JOB_NUMBER_RULE_VERSION,
      stored_control: row ?? null,
      effective_mode: row && (row as { mode?: unknown }).mode === "enforce" ? "enforce" : "shadow",
      // Blocked = refused in `enforce` (`enforced: true`); everything else was recorded and written.
      blocked_records: await checks.countDocuments({ enforced: true }),
      recorded_only_records: await checks.countDocuments({ enforced: { $ne: true } }),
      recorded_only_by_exemption: {
        shadow: await checks.countDocuments({ enforced: { $ne: true }, mode: { $ne: "enforce" } }),
        reason_not_enforced: await checks.countDocuments({ enforced: false, exemption: "reason_not_enforced" }),
        granot_lifecycle: await checks.countDocuments({ enforced: false, exemption: "granot_lifecycle" }),
      },
      by_reason: byReason,
      booking_ids: (await checks.find({}, { projection: { booking_id: 1, reason: 1, write_path: 1, value_length: 1, first_seen_at: 1, enforced: 1, exemption: 1 } }).sort({ first_seen_at: -1 }).limit(50).toArray()),
      normalization_invariant: {
        last_cron_result: await control.findOne({ _id: BOOKING_JOB_NORMALIZATION_STATE_ID }),
        live: await findBookingJobNormalizationDrift(db).then(({ drift, scanned }) => ({ drift_count: drift.length, booking_ids: drift.slice(0, 20), scanned_candidates: scanned })),
      },
    }, null, 1));
    return;
  }
  if (command !== "set") throw new Error(`unknown command ${command}`);
  const mode = flag("mode"), reason = flag("reason"), actor = flag("actor");
  if (mode !== "shadow" && mode !== "enforce") throw new Error("--mode=shadow|enforce is required");
  if (!reason || reason.length < 10) throw new Error("--reason (10+ characters) is required");
  if (!actor) throw new Error("--actor is required");
  const doc = { mode, reason, updated_by: actor, updated_at: new Date(), rule_version: BOOKING_JOB_NUMBER_RULE_VERSION };
  if (!rest.includes("--apply")) {
    console.log(JSON.stringify({ database, dry_run: true, would_set: { _id: BOOKING_JOB_NUMBER_CONTROL_ID, ...doc } }, null, 1));
    return;
  }
  const before = await control.findOne({ _id: BOOKING_JOB_NUMBER_CONTROL_ID });
  await control.updateOne({ _id: BOOKING_JOB_NUMBER_CONTROL_ID }, { $set: doc, $push: { history: { ...doc, previous_mode: (before as { mode?: unknown } | null)?.mode ?? null } } } as never, { upsert: true });
  console.log(JSON.stringify({ database, applied: true, before, after: await control.findOne({ _id: BOOKING_JOB_NUMBER_CONTROL_ID }) }, null, 1));
}

main().finally(() => client.close()).catch((error) => { console.error(error); process.exitCode = 1; });
