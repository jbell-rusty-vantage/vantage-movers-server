/**
 * Shared constants for the Sales Intelligence final-UI seed, its state assertion, the contract
 * capture and the fixture validation (S0-SEED). Loopback replica only; no production name appears.
 */
import { resolve } from "node:path";

export const SI_SEED_DATABASE = "testvantagemovers_finalui";
export const SI_SEED_REPLICA = "mongodb://127.0.0.1:27189/?replicaSet=csi01";
export const SI_SEED_MANIFEST = "si_seed_manifest";
export const SI_SEED_DEPLOYMENT = "csi-local-proof";
export const SI_WORKSPACE = resolve(__dirname, "../../../../sales-intelligence-ui-ux-workspace");
export const SI_CONTRACTS_DIR = resolve(SI_WORKSPACE, "contracts");

export function assertSeedDatabase(name: string) {
  if (name !== SI_SEED_DATABASE || !/^testvantagemovers_[a-z0-9]+$/.test(name)) throw new Error(`refusing database ${name}: only ${SI_SEED_DATABASE}`);
}

/**
 * Every state the final spec prints (TEAM-1 §5 seed coverage). The assertion counts each one in the
 * source collections; the manifest names the subject(s) that carry it so the capture can call reads.
 */
export const SI_SEED_STATES = [
  "number_only", "multi_lead_phone",
  "closed_booked", "closed_cancelled", "closed_bad_lead", "closed_duplicate", "closed_no_sync", "closed_crm_dead", "closed_crm_bad_unusable",
  "closed_owner", "closed_over_90d",
  "followup_due", "followup_overdue", "followup_no_due_date", "followup_none",
  "move_date_future", "move_date_passed",
  "newer_call_after_assessment", "conflict_details_disagree", "conflict_other",
  "assessment_lead_only", "assessment_not_applicable", "assessment_pending",
  "work_applied", "work_blocked", "work_needs_review_effect", "work_needs_review_item", "work_not_applicable", "work_superseded", "work_retracted",
  "relation_bookkeeping_effects", "relations_all_kinds", "story_discrepancies",
  "engagement_created_and_skipped",
  "legacy_conversation", "audio_purged_transcript_kept", "media_retained",
  "priority_change_paired", "priority_change_unpaired", "quoted_change",
  "lead_message", "booking", "cancellation",
  "transcript_segments", "summary_snapshot_move_evidence",
  "number_run", "conversation_run", "suggestion_applied",
  "calls_50", "timeline_300",
] as const;
export type SiSeedState = (typeof SI_SEED_STATES)[number];

/** One manifest row per seeded subject: a stable label, the states it shows and every id a read needs. */
export type SiManifestRow = {
  label: string;
  kind: "outreach" | "number";
  states: SiSeedState[];
  outreach_record_id: string | null;
  contact_number_id: string | null;
  lead_refs: Array<{ model: "FormLead" | "CallLead"; id: string }>;
  conversation_ids: string[];
  run_ids: string[];
  artifact_ids: string[];
  finding_ids: string[];
  note: string;
};
