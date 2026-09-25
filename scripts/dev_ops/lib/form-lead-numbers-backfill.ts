/**
 * S10 step 1 (`backfill-form-lead-contact-numbers.ts`) safety rules, V-T3 M5a / M6.
 *
 * M6: its dry run executes and ABORTS real transactions (DECISIONS S5c-NUMBERS: never dry-run it in production),
 * so against the production database it runs only as `--apply --allow-production`, and every other combination
 * is refused before the process connects.
 *
 * M5a: each group's transaction reaches `persistLeadAttachments` → `onAttachmentChanged` → `ensureLead`, which can
 * enqueue an official-closure `number_refresh` or (PROGRESS_PLAN) a `move_assessment` re-plan. As in
 * `backfill-sole-match-attachments.ts`, every paid-stage job created inside the group's transaction is put on
 * `operator_hold` in that same transaction, re-plans are suppressed and counted, and the run fails if a recorded
 * hold is not on hold at the end.
 */
import mongoose from "mongoose";
import { getSalesIntelligenceJobModel } from "../../../src/models/SalesIntelligenceJob";
import { OPERATOR_HOLD_REASON } from "./call-log-repair";
import { P5_PAID_STAGES } from "./priority5-reconcile";

export const PRODUCTION_DATABASE = "vantagemovers";

/** Null when the run may proceed; otherwise the refusal. Pure (M6). */
export function formLeadBackfillProductionRefusal(database: string, argv: readonly string[]): string | null {
  if (database !== PRODUCTION_DATABASE) return null;
  const apply = argv.includes("--apply"), allow = argv.includes("--allow-production");
  if (apply && allow) return null;
  return `Refusing ${PRODUCTION_DATABASE}: this script's dry run executes and aborts real transactions, so production runs only as --apply --allow-production (got ${[apply ? "--apply" : null, allow ? "--allow-production" : null].filter(Boolean).join(" ") || "neither"})`;
}

export type FormLeadHold = { job_id: string; stage: string; dedupe_key: string; creator_lead_id: string; held_at: string };

/**
 * Inside one group transaction: the job-window snapshot first (a job that is new afterwards is this transaction's),
 * then the work, then every new paid-stage job put on `operator_hold` in the same transaction. A job that can't be
 * held aborts the transaction (the group reports an error and is retried by a re-run).
 */
export async function withHeldPaidJobs<T>(session: mongoose.ClientSession, creatorLeadId: string, work: () => Promise<T>):
  Promise<{ value: T; holds: FormLeadHold[]; nonpaid: Record<string, number> }> {
  const Jobs = getSalesIntelligenceJobModel();
  // Real time: job ids carry the wall-clock creation second.
  const window = { _id: { $gte: mongoose.Types.ObjectId.createFromTime(Math.floor(Date.now() / 1000) - 300) } };
  const existing = new Set((await Jobs.find(window).select({ _id: 1 }).session(session).lean()).map(j => String(j._id)));
  const value = await work();
  const created = (await Jobs.find(window).select({ _id: 1, stage: 1, dedupe_key: 1, status: 1 }).session(session).lean()).filter(j => !existing.has(String(j._id)));
  const holds: FormLeadHold[] = [], nonpaid: Record<string, number> = {};
  for (const job of created) {
    if (!(P5_PAID_STAGES as readonly string[]).includes(job.stage)) { nonpaid[job.stage] = (nonpaid[job.stage] ?? 0) + 1; continue; }
    const held = await Jobs.updateOne({ _id: job._id, status: { $in: ["pending", "retry"] } }, { $set: { status: "paused", reason: OPERATOR_HOLD_REASON } }, { session });
    if (held.modifiedCount !== 1) throw new Error(`could not hold ${job.stage} ${job.dedupe_key} (status ${job.status}); transaction aborted`);
    holds.push({ job_id: String(job._id), stage: job.stage, dedupe_key: String(job.dedupe_key), creator_lead_id: creatorLeadId, held_at: new Date().toISOString() });
  }
  return { value, holds, nonpaid };
}

/** How many of the recorded holds are no longer on `operator_hold` (the run fails unless 0). */
export async function unheldCount(holds: readonly FormLeadHold[]): Promise<number> {
  if (!holds.length) return 0;
  const heldNow = await getSalesIntelligenceJobModel().countDocuments({ _id: { $in: holds.map(h => new mongoose.Types.ObjectId(h.job_id)) }, status: "paused", reason: OPERATOR_HOLD_REASON });
  return holds.length - heldNow;
}

/** Operator decision (after S10 step 9): hand the held jobs back to the production consumers. */
export async function releaseFormLeadHolds(holds: readonly FormLeadHold[]): Promise<number> {
  let released = 0;
  for (const hold of holds) {
    const result = await getSalesIntelligenceJobModel().updateOne({ _id: hold.job_id, status: "paused", reason: OPERATOR_HOLD_REASON },
      { $set: { status: "pending", reason: null, next_attempt_at: new Date() } });
    released += result.modifiedCount;
  }
  return released;
}
