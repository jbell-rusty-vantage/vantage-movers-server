import { ObjectId, type Db, type Document } from "mongodb";
import { OperatorError } from "./local-safety";

export const READ_LIMIT = 25;
export const QUERY_TIMEOUT_MS = 2_000;
const enums = {
  status: ["pending", "retrying", "processing", "synced", "failed", "cancelled", "deferred", "running", "completed", "partial_failure"],
  resource: ["source_lead", "booked_lead", "booking_chain", "cancellation_chain", "delete_source_lead", "delete_booked_lead", "delete_cancelled_lead"],
  scope: ["sheet-sync:drain", "lead-reporting:tab-migration"],
  op_class: ["read", "write"],
  action: ["lookup", "update", "append", "delete", "ensure_headers"],
};
/** Project bounded scalar values on Mongo itself; never fetch payloads, errors or arbitrary strings. */
function projection(fields: readonly string[]): Document {
  return Object.fromEntries(fields.map((field) => {
    if (field === "deferral_reason") {
      // Only the writer-owned prefix can cross the Mongo boundary. Causes may contain customer data.
      const reason = { $arrayElemAt: [{ $split: [{ $cond: [
        { $eq: [{ $type: "$error" }, "string"] }, "$error", "",
      ] }, ":"] }, 0] };
      return [field, { $cond: [{ $eq: ["$status", "deferred"] }, { $let: {
        vars: { reason }, in: { $cond: [{ $in: ["$$reason", [
          "structural_write_unconfirmed", "delivery_guard_stopped", "destination_upsert_pending", "quota_budget_exhausted",
        ]] }, "$$reason", "unknown"] },
      } }, null] }];
    }
    const values = enums[field as keyof typeof enums];
    if (values) return [field, { $cond: [{ $in: [`$${field}`, values] }, `$${field}`, "unknown"] }];
    const type = field.endsWith("id") ? "objectId" : (field === "attempts" || field === "count") ? "number" : "date";
    return [field, { $cond: [type === "number" ? { $isNumber: `$${field}` } : { $eq: [{ $type: `$${field}` }, type] }, `$${field}`, null] }];
  }));
}
const JOB_FIELDS = ["_id", "status", "resource", "attempts", "due_at", "leased_until", "createdAt", "updatedAt", "run_id"];

async function readRows(
  db: Db,
  collection: string,
  match: Document,
  sort: Document,
  fields: string[],
  hint: string | Document,
) {
  return db.collection(collection).aggregate([
    { $match: match }, { $sort: sort }, { $limit: READ_LIMIT + 1 }, { $project: projection(fields) },
  ], { maxTimeMS: QUERY_TIMEOUT_MS, allowDiskUse: false, batchSize: READ_LIMIT + 1, hint }).toArray();
}
const historyLimitations = [
  "Mongo evidence only; Google delivery and current row membership are not verified.",
  "Runs and attempts expire after 90 days; no archive is queried. Missing history is not proof of no delivery.",
  "At most 25 rows per section; observations are not a transactional snapshot or a complete health assessment.",
];

export async function inspectSheetSync(db: Db) {
  // _id order uses the built-in index; no collection-wide count/group or sort is needed.
  const rows = await readRows(db, "sheet_sync_jobs", {}, { _id: -1 }, JOB_FIELDS, "_id_");
  return { status: "partial", scope: "newest_job_sample", limit: READ_LIMIT,
    more: rows.length > READ_LIMIT, jobs: rows.slice(0, READ_LIMIT), limitations: historyLimitations };
}
async function readDrainGuards(db: Db) {
  const observedAt = new Date();
  const windowStart = new Date(Math.floor(observedAt.getTime() / 60_000) * 60_000);
  const scopes = ["sheet-sync:drain", "lead-reporting:tab-migration"];
  const options = { maxTimeMS: QUERY_TIMEOUT_MS, allowDiskUse: false };
  const leases = await db.collection("sheet_sync_leases").aggregate([
    { $match: { scope: { $in: scopes } } }, { $limit: 3 },
    { $project: { _id: 0, ...projection(["scope", "leased_until"]), expiry_type: { $type: "$leased_until" } } },
  ], { ...options, hint: { scope: 1 } }).toArray();
  const quota = await db.collection("sheet_sync_quota_buckets").aggregate([
    { $match: { scope: "user", op_class: { $in: ["read", "write"] }, window_start: windowStart } },
    { $limit: 3 }, { $project: { _id: 0, ...projection(["op_class", "count"]) } },
  ], { ...options, hint: { scope: 1, op_class: 1, window_start: 1 } }).toArray();
  return { observed_at: observedAt, leases: scopes.map((scope) => {
    const matches = leases.filter((lease) => lease.scope === scope);
    const lease = matches[0];
    let state = "unknown";
    if (leases.length <= 2 && matches.length <= 1) {
      if (!lease) state = "no_record";
      else if (lease.leased_until instanceof Date) state = lease.leased_until > observedAt ? "held" : "expired";
      else if (lease.expiry_type === "null" || lease.expiry_type === "missing") state = "no_expiry_recorded";
    }
    return { scope, state, leased_until: lease?.leased_until ?? null };
  }), quota: { scope: "user", window_start: windowStart, reservations: quota.slice(0, 2),
    more: quota.length > 2, remaining_budget: "unknown" } };
}

export async function traceSheetSync(db: Db, job: string) {
  if (!/^[a-fA-F0-9]{24}$/.test(job)) throw new OperatorError("invalid_arguments", 2);
  const id = new ObjectId(job);
  const rows = await readRows(db, "sheet_sync_jobs", { _id: id }, { _id: 1 }, JOB_FIELDS, "_id_");
  const attempts = await readRows(db, "sheet_sync_attempts", { job_id: id }, { createdAt: -1 },
    ["_id", "job_id", "run_id", "action", "status", "deferral_reason", "createdAt"], { job_id: 1, createdAt: 1 });
  // Each attempt's canonical run_id is preserved. A job's latest run is only one part of its history.
  const runIds = [...new Map([...rows, ...attempts.slice(0, READ_LIMIT)].flatMap((row) =>
    row.run_id instanceof ObjectId ? [[row.run_id.toHexString(), row.run_id] as const] : [])).values()];
  const runs = runIds.length ? await readRows(db, "sheet_sync_runs", { _id: { $in: runIds } }, { _id: -1 },
    ["_id", "status", "started_at", "finished_at"], "_id_") : [];
  return { status: "partial", evidence: rows.length ? "job_found" : "job_not_found", job: rows[0] ?? null,
    guards: await readDrainGuards(db), attempts: attempts.slice(0, READ_LIMIT), runs: runs.slice(0, READ_LIMIT), limit: READ_LIMIT,
    more_attempts: attempts.length > READ_LIMIT, more_runs: runs.length > READ_LIMIT,
    limitations: historyLimitations };
}
