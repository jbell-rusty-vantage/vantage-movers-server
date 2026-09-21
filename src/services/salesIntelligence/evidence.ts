import { z } from "zod";
import { CsiError, type CsiIssue } from "./auth";
import type { IntelligenceEnvelope } from "../../validation/intelligence/intelligenceEnvelope.validation";
/** Trusted manifest assembled from stored snapshots by Team D, never model output. Exact quote/segment accuracy is intentionally not checked. */
export const evidenceManifestEntrySchema = z
  .object({
    snapshot_id: z.string(),
    subject_key: z.string(),
    source: z.enum(["transcript", "vantage_record"]),
    conversation_id: z.string().nullable(),
    transcript_version: z.string().nullable(),
    record_type: z.string().nullable(),
    record_id: z.string().nullable(),
    field_paths: z.array(z.string()),
  })
  .strict();
export type EvidenceManifestEntry = z.infer<typeof evidenceManifestEntrySchema>;

/**
 * Citation membership, reported as paths rather than as a bare refusal.
 *
 * This check is a *definite* rejection: nothing is committed, exactly as for a
 * schema-invalid submission. It used to reach the model as the code
 * `EVIDENCE_SCOPE_INVALID` and nothing else, which the runtime then treated as
 * an uncertain outcome and aborted the run — so the one repair allowance could
 * never be spent on the failure class 22 §4.4 names first. Naming the offending
 * finding and reference lets the model correct the citation instead, and lets
 * the run record what went wrong.
 *
 * The paths name positions and reasons only. No claim text, quote or submitted
 * identifier is echoed: an id the model invented is not safe to reflect back,
 * and the position is enough to locate it.
 */
function evidenceIssues(
  envelope: IntelligenceEnvelope,
  scope: {
    subject_key: string;
    snapshots: EvidenceManifestEntry[];
    allowed_followup_ids: string[];
    instructions: Array<{ id: string; revision: number }>;
    speaker_refs: string[];
  },
): CsiIssue[] {
  const issues: CsiIssue[] = [];
  const add = (path: string, code: string) => {
    if (issues.length < 16) issues.push({ path, code });
  };
  envelope.findings.forEach((finding, index) => {
    const at = `findings.${index}`;
    if (finding.speaker_ref && !scope.speaker_refs.includes(finding.speaker_ref))
      add(`${at}.speaker_ref`, "speaker_ref_not_listed");
    finding.evidence.forEach((ref, refIndex) => {
      const refAt = `${at}.evidence.${refIndex}`;
      const snapshot = scope.snapshots.find(
        (entry) =>
          entry.snapshot_id === ref.snapshot_id &&
          entry.source === ref.source &&
          (ref.source === "transcript"
            ? entry.conversation_id === ref.conversation_id &&
              entry.transcript_version === ref.transcript_version
            : entry.record_type === ref.record_type && entry.record_id === ref.record_id),
      );
      if (!snapshot || snapshot.subject_key !== scope.subject_key) {
        // A snapshot id that exists for some other source or subject is not a
        // near miss to be explained; it is outside this run either way.
        const known = scope.snapshots.some((entry) => entry.snapshot_id === ref.snapshot_id);
        add(`${refAt}.snapshot_id`, known ? "citation_not_on_snapshot" : "snapshot_not_captured");
        return;
      }
      if (ref.source === "vantage_record") {
        const missing = ref.field_paths.filter((path) => !snapshot.field_paths.includes(path));
        if (missing.length) add(`${refAt}.field_paths`, "field_path_not_exposed");
      }
    });
    if (
      "target_followup_id" in finding.value &&
      finding.value.target_followup_id &&
      !scope.allowed_followup_ids.includes(finding.value.target_followup_id)
    )
      add(`${at}.value.target_followup_id`, "followup_not_allowed");
  });
  const target = envelope.next_step_suggestion?.target_followup_id;
  if (target && !scope.allowed_followup_ids.includes(target))
    add("next_step_suggestion.target_followup_id", "followup_not_allowed");
  envelope.owner_instruction_assessments.forEach((assessment, index) => {
    if (
      !scope.instructions.some(
        (v) => v.id === assessment.instruction_id && v.revision === assessment.instruction_revision,
      )
    )
      add(`owner_instruction_assessments.${index}.instruction_id`, "instruction_revision_not_observed");
  });
  return issues;
}

export function validateEnvelopeEvidence(
  envelope: IntelligenceEnvelope,
  scope: {
    subject_key: string;
    snapshots: EvidenceManifestEntry[];
    allowed_followup_ids: string[];
    instructions: Array<{ id: string; revision: number }>;
    speaker_refs: string[];
  },
) {
  const issues = evidenceIssues(envelope, scope);
  if (issues.length) throw new CsiError("EVIDENCE_SCOPE_INVALID", issues);
}
