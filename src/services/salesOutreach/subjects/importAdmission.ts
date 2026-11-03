import type { DeskLeadFacts } from "./leadFacts";

type ImportAdmissionFacts = Pick<DeskLeadFacts,
  "ref" | "outreach_automation_suppressed" | "created_at" | "accepted_observation">;

/** The immutable marker prevents import-time automatic admission. A later
 * accepted canonical Granot observation restores ordinary admission checks;
 * the imported business timestamp is never evidence of a new interaction. */
export function isImportOutreachSuppressed(facts: ImportAdmissionFacts): boolean {
  if (facts.ref.model !== "FormLead" || facts.outreach_automation_suppressed !== true) return false;
  const created = facts.created_at, observation = facts.accepted_observation;
  return !(created instanceof Date) || !Number.isFinite(+created) || !observation?.observation_id.trim() ||
    !(observation.captured_at instanceof Date) || !Number.isFinite(+observation.captured_at) ||
    +observation.captured_at <= +created;
}
