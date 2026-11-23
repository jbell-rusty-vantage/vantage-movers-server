import { z } from "zod";

const id = z.string().regex(/^[a-f0-9]{24}$/);
const outcome = z.enum(["updated", "unchanged"]);
const evaluation = z.strictObject({
  outcome,
  subject_id: id,
  publication_revision: z.number().int().positive(),
  next_evaluation_at: z.iso.datetime({ precision: 3 }).nullable(),
  agent_ids: z.array(id.nullable()).optional(),
});
const refresh = z.strictObject({
  outcome,
  subject_id: id,
  reason: z.literal("repeated_priority").nullable(),
  admission: z.null(),
  status: z.enum(["active", "review", "closed"]),
  evaluation_requested: z.boolean().optional(),
});
const contactProgress = z.strictObject({
  derived: z.literal(1), missing: z.literal(0), changed: z.union([z.literal(0), z.literal(1)]),
  evaluations: z.number().int().min(0).max(2), rep_days: z.number().int().min(0).max(2),
});
const repDayProgress = z.strictObject({
  outcome: z.enum(["written", "unchanged"]), publication_revision: z.number().int().positive(),
});
const callRevision = /^sod:contact_change:(call:[a-f0-9]{24}):r[1-9]\d*$/;
const repDay = /^sod:rep-day:([a-f0-9]{24}:\d{4}-\d{2}-\d{2}):[a-f0-9]{16}$/;
const contactEvaluation = /^sod:evaluate:([a-f0-9]{24}):r[1-9]\d*:contacts:[a-f0-9]{16}$/;
const estimates = /^sod:lead-change:(?:FormLead|CallLead):[a-f0-9]{24}:estimates-refresh:[a-f0-9]{24}$/;
/** The minute sweep's clock and coverage wakes (`evaluateJob.ts`): `due:<ms>` and `coverage:<channel>:<wait ms>:<bucket>`. */
const sweepCause = /^(?:due:[1-9]\d*|coverage:(?:call|sms):[1-9]\d*:\d+)$/;
const captureKey = /^csi:capture_projection:(receipt|receipt_id):(\S+)$/;
/**
 * A clean capture's key stays as long as its stored receipt can still be re-ensured. Receipt recovery resumes from
 * its stored watermark, which can lag by days (capture disabled, recovery stalled), so the only hard bound is the
 * receipt TTL (`WEBHOOK_EVENT_RETENTION_SECONDS` in `ringcentral/webhook-capture.ts`, 7 days on `receivedAt`).
 */
export const CAPTURE_RECEIPT_RETENTION_DAYS = 7;
const DAY_MS = 86_400_000;
const captureSession = z.strictObject({
  telephony_session_id: z.string().min(1), ok: z.literal(true), interaction_id: id, contact_number_id: id.nullable(),
  projection_revision: z.number().int().min(0), noop: z.boolean(), created: z.boolean(), newly_terminal: z.boolean(),
  jobs: z.number().int().min(0),
});
const capture = z.strictObject({
  receipt_id: id, receipt_uuid: z.string().min(1).nullable(), sessions: z.number().int().min(0),
  ok: z.number().int().min(0), failed: z.literal(0), results: z.array(captureSession), call_log_refresh: z.array(z.string().min(1)),
});

/** These two evaluation producers do not expose a per-cause job identity to callers. */
export function isRoutineEvaluationKey(key: string, subjectId: string | undefined): boolean {
  if (!subjectId || !id.safeParse(subjectId).success) return false;
  const prefix = `sod:evaluate:${subjectId}:`;
  if (!key.startsWith(prefix)) return false;
  const cause = key.slice(prefix.length);
  return /^r[1-9]\d*$/.test(cause)
    || (cause.startsWith("estimates-refresh:") && estimates.test(cause.slice("estimates-refresh:".length)));
}

/**
 * Sweep wakes are routed to the job queue, never to the refresh coalescer, so this stays separate from
 * `isRoutineEvaluationKey`. Their identity fences only the sweep: a completed evaluation leaves the projection's
 * `next_evaluation_at` after its own clock and moves `coverage_wait`, so the same key is never nominated again.
 */
function isSweepEvaluationKey(key: string, subjectId: string) {
  const prefix = `sod:evaluate:${subjectId}:`;
  return key.startsWith(prefix) && sweepCause.test(key.slice(prefix.length));
}

/** A capture whose every session projected. Failed sessions keep their diagnostics for the ordinary window. */
function isCleanCapture(key: string, result: unknown, subjectKey: string | undefined) {
  const match = captureKey.exec(key);
  const parsed = capture.safeParse(result);
  if (!match || !parsed.success) return false;
  const { receipt_id, receipt_uuid, sessions, ok, results } = parsed.data;
  const identity = match[1] === "receipt" ? receipt_uuid : receipt_id;
  return identity === match[2] && subjectKey === "webhook_receipt:" + match[2]
    && (match[1] === "receipt" || receipt_uuid === null) && ok === sessions && results.length === sessions;
}

/** Classify the committed result. Repair, admission and unknown producers keep their existing dedupe window. */
export function routineJobExpiry(stage: string, key: string, result: unknown, completed: Date, subjectKey?: string): Date | undefined {
  let qualifies = false;
  let days = 3;
  if (stage === "outreach_lead_change" && estimates.test(key)) {
    const parsed = refresh.safeParse(result);
    qualifies = parsed.success && (parsed.data.reason === null || parsed.data.outcome === "unchanged");
  } else if (stage === "outreach_evaluate") {
    const parsed = evaluation.safeParse(result);
    if (parsed.success) {
      const subjectId = parsed.data.subject_id;
      qualifies = isRoutineEvaluationKey(key, subjectId) || isSweepEvaluationKey(key, subjectId)
        || (contactEvaluation.exec(key)?.[1] === subjectId && subjectKey === "outreach-subject:" + subjectId);
    }
  } else if (stage === "outreach_contact_change") {
    const source = callRevision.exec(key)?.[1];
    qualifies = source !== undefined && source === subjectKey && contactProgress.safeParse(result).success;
  } else if (stage === "capture_projection") {
    qualifies = isCleanCapture(key, result, subjectKey);
    days = CAPTURE_RECEIPT_RETENTION_DAYS;
  } else if (stage === "outreach_rep_day") {
    const day = repDay.exec(key)?.[1];
    qualifies = day !== undefined && subjectKey === "outreach-rep-day:" + day && repDayProgress.safeParse(result).success;
  }
  return qualifies ? new Date(completed.getTime() + days * DAY_MS) : undefined;
}

/** Cross-check the actual worker input against the subject and producer-scoped key. */
export function routineJobSubjectMatches(stage: string, key: string, subject: string, refs: readonly string[]) {
  if (refs.length !== 1 || !id.safeParse(refs[0]).success) return false;
  const ref = refs[0];
  if (stage === "outreach_evaluate") return subject === "outreach-subject:" + ref && key.startsWith("sod:evaluate:" + ref + ":");
  if (stage === "outreach_contact_change") return subject === "call:" + ref && key.startsWith("sod:contact_change:" + subject + ":");
  if (stage === "outreach_rep_day") return subject.startsWith("outreach-rep-day:" + ref + ":");
  if (stage === "capture_projection") {
    const match = captureKey.exec(key);
    return match !== null && subject === "webhook_receipt:" + match[2] && (match[1] === "receipt" || match[2] === ref);
  }
  return ["FormLead", "CallLead"].some(model => stage === "outreach_lead_change" &&
    subject === "outreach-lead:" + model + ":" + ref && key.startsWith("sod:lead-change:" + model + ":" + ref + ":"));
}

/** Fields that can no longer be used once a qualified worker commits its effects and handoffs. */
export function finishedExecutionFields(stage: string) {
  return {
    lease_owner: "", leased_until: "", lease_epoch: "", attempts: "", max_attempts: "",
    next_attempt_at: "", reason: "", priority: "",
    ...(stage === "outreach_lead_change" ? {} : { result: "" }),
  } as const;
}
