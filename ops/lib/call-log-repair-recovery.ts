/**
 * S5c-RECOVERY (reconciliation addendum §3.3, G4): `CallInteraction.capture_recovery` provenance for
 * calls a capture repair inserted (`added`) or completed (`completed`).
 *
 * Shared by the repair library (`call-log-repair.ts`, stamped as it writes) and the one-time
 * `stamp-capture-recovery.ts` (the 2026-09-20 repair's calls, from its manifest and audit rows).
 *
 * The write is provenance only: one `$set` of `capture_recovery` on a row that has none. It never
 * touches `projection_revision` (the Number fingerprint input), `updatedAt`, rollups or jobs, so it
 * wakes no consumer and no paid work. Re-running it is a no-op.
 */
import mongoose from "mongoose";
import { getCallInteractionModel } from "../../src/models/CallInteraction";

export type CaptureRecoveryKind = "added" | "completed";
export type CaptureRecovery = { run_id: string; at: Date; kind: CaptureRecoveryKind };

/**
 * A repair outcome to the recovery it records: a row the repair inserted → `added`; a STALE row it
 * rewrote → `completed`; an unchanged (label-only) rewrite → none.
 */
export function recoveryKindFor(classification: string, created: boolean): CaptureRecoveryKind | null {
  if (created) return "added";
  return classification === "STALE" ? "completed" : null;
}

/** `$set` once: true when this call wrote it, false when the row already carries one (or is missing). */
export async function stampCaptureRecovery(interactionId: string, recovery: CaptureRecovery): Promise<boolean> {
  if (!mongoose.isValidObjectId(interactionId)) return false;
  const result = await getCallInteractionModel().updateOne(
    { _id: new mongoose.Types.ObjectId(interactionId), capture_recovery: null },
    { $set: { capture_recovery: { run_id: recovery.run_id, at: recovery.at, kind: recovery.kind } } },
    { timestamps: false, strict: true },
  );
  return result.modifiedCount === 1;
}
