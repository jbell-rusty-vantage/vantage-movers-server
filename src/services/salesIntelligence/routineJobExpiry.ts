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
export function routineJobExpiry(stage: string, key: string, result: unknown, completed: Date): Date | undefined {
  let qualifies = false;
  if (stage === "outreach_lead_change" && estimates.test(key)) {
    const parsed = refresh.safeParse(result);
    qualifies = parsed.success && (parsed.data.reason === null || parsed.data.outcome === "unchanged");
  } else if (stage === "outreach_evaluate") {
    const parsed = evaluation.safeParse(result);
    qualifies = parsed.success && isRoutineEvaluationKey(key, parsed.data.subject_id);
  }
  return qualifies ? new Date(completed.getTime() + 3 * 86_400_000) : undefined;
}
