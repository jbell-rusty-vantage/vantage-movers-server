import { z } from "zod";
import { CsiError } from "./auth";
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
  for (const finding of envelope.findings) {
    if (
      finding.speaker_ref &&
      !scope.speaker_refs.includes(finding.speaker_ref)
    )
      throw new CsiError("EVIDENCE_SCOPE_INVALID");
    for (const ref of finding.evidence) {
      const snapshot = scope.snapshots.find((entry) => entry.snapshot_id === ref.snapshot_id &&
        entry.source === ref.source && (ref.source === "transcript"
          ? entry.conversation_id === ref.conversation_id && entry.transcript_version === ref.transcript_version
          : entry.record_type === ref.record_type && entry.record_id === ref.record_id));
      if (
        !snapshot ||
        snapshot.subject_key !== scope.subject_key ||
        snapshot.source !== ref.source
      )
        throw new CsiError("EVIDENCE_SCOPE_INVALID");
      if (
        ref.source === "transcript"
          ? snapshot.conversation_id !== ref.conversation_id ||
            snapshot.transcript_version !== ref.transcript_version
          : snapshot.record_type !== ref.record_type ||
            snapshot.record_id !== ref.record_id ||
            ref.field_paths.some((path) => !snapshot.field_paths.includes(path))
      )
        throw new CsiError("EVIDENCE_SCOPE_INVALID");
    }
    if (
      "target_followup_id" in finding.value &&
      finding.value.target_followup_id &&
      !scope.allowed_followup_ids.includes(finding.value.target_followup_id)
    )
      throw new CsiError("EVIDENCE_SCOPE_INVALID");
  }
  const target = envelope.next_step_suggestion?.target_followup_id;
  if (target && !scope.allowed_followup_ids.includes(target))
    throw new CsiError("EVIDENCE_SCOPE_INVALID");
  for (const assessment of envelope.owner_instruction_assessments)
    if (
      !scope.instructions.some(
        (v) =>
          v.id === assessment.instruction_id &&
          v.revision === assessment.instruction_revision,
      )
    )
      throw new CsiError("EVIDENCE_SCOPE_INVALID");
}
