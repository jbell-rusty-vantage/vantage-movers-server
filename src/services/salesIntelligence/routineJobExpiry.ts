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

/** These two evaluation producers do not expose a per-cause job identity to callers. */
export function isRoutineEvaluationKey(key: string, subjectId: string | undefined): boolean {
  if (!subjectId || !id.safeParse(subjectId).success) return false;
  const prefix = `sod:evaluate:${subjectId}:`;
  if (!key.startsWith(prefix)) return false;
  const cause = key.slice(prefix.length);
  return /^r[1-9]\d*$/.test(cause)
    || (cause.startsWith("estimates-refresh:") && estimates.test(cause.slice("estimates-refresh:".length)));
}

/** Classify the committed result. Repair, admission and unknown producers keep their existing dedupe window. */
export function routineJobExpiry(stage: string, key: string, result: unknown, completed: Date, subjectKey?: string): Date | undefined {
  let qualifies = false;
  if (stage === "outreach_lead_change" && estimates.test(key)) {
    const parsed = refresh.safeParse(result);
    qualifies = parsed.success && (parsed.data.reason === null || parsed.data.outcome === "unchanged");
  } else if (stage === "outreach_evaluate") {
    const parsed = evaluation.safeParse(result);
    if (parsed.success) {
      const subjectId = parsed.data.subject_id;
      qualifies = isRoutineEvaluationKey(key, subjectId)
        || (contactEvaluation.exec(key)?.[1] === subjectId && subjectKey === "outreach-subject:" + subjectId);
    }
  } else if (stage === "outreach_contact_change") {
    const source = callRevision.exec(key)?.[1];
    qualifies = source !== undefined && source === subjectKey && contactProgress.safeParse(result).success;
  } else if (stage === "outreach_rep_day") {
    const day = repDay.exec(key)?.[1];
    qualifies = day !== undefined && subjectKey === "outreach-rep-day:" + day && repDayProgress.safeParse(result).success;
  }
  return qualifies ? new Date(completed.getTime() + 3 * 86_400_000) : undefined;
}
