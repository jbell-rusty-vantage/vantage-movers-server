/**
 * Shared constants for the Sales Intelligence final-UI seed, its state assertion, the contract
 * capture and the fixture validation (S0-SEED). Loopback replica only; no production name appears.
 */
import { resolve } from "node:path";

export const SI_SEED_DATABASE = "testvantagemovers_finalui";
export const SI_SEED_REPLICA = "mongodb://127.0.0.1:27189/?replicaSet=csi01";
export const SI_SEED_MANIFEST = "si_seed_manifest";
export const SI_SEED_DEPLOYMENT = "csi-local-proof";
// SEED-T3: `SI_WORKSPACE_DIR` points a worktree outside the workspace root (e.g. `%TEMP%/t3w-a`) at the real workspace.
export const SI_WORKSPACE = process.env.SI_WORKSPACE_DIR ? resolve(process.env.SI_WORKSPACE_DIR)
  : resolve(__dirname, "../../../../sales-intelligence-ui-ux-workspace");
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
  // SEED-FIX (2026-09-23): what the analysis page reads from the Number's newest run, rep names, instruction assessments, card suggestion.
  "newest_run_relations", "newest_run_story_discrepancies", "newest_number_run_no_relations",
  "owner_instruction_assessments", "rep_identity_reviewed", "rep_identity_unreviewed",
  "suggestion_unapplied_no_followup", "suggestion_applied_followup",
  // AC0-SEED (2026-09-23): source-data states for the Attention evolution and Case File spec (TEAM-4-INSTRUCTION §4).
  // Every one is raw source-collection data written through the real models/writers; none depends on AC1–AC6 code.
  "ac_callback_customer_exact", "ac_callback_owner_exact", "ac_callback_rep_day", "ac_callback_send_estimate_day",
  "ac_attempt_50_early", "ac_attempt_70_early", "ac_inbound_after_promise", "ac_promise_chain_source",
  "ac_formlead_40s", "ac_formlead_3h", "ac_inbound_only_239", "ac_inbound_only_240",
  "ac_called_before_form_6d", "ac_called_before_form_8d",
  "ac_progress_0_to_1", "ac_progress_1_3_1", "ac_progress_uncertain_1", "ac_progress_accepted_3",
  "ac_attempts_same_rep", "ac_attempts_two_reps", "ac_going_cold_unreached",
  "ac_number_25_summaries",
  "ac_granot_estimate_drop", "ac_granot_invalid", "ac_granot_phone_mismatch",
  "ac_extension_directory_name", "ac_extension_unknown",
  "ac_call_lead_ringcentral_route",
  // AC0-SEED phase 2 (2026-09-24): derived states, once Worker A's AC3-AC5 code (`eddad04`) ran the
  // seed's Outreach ensure with SALES_INTELLIGENCE_ATTENTION_EVOLUTION on.
  "ac_retry_successor_1", "ac_retry_successor_2", "ac_promise_chain_unreached",
  "ac_completion_customer_called", "ac_completion_early_window", "ac_completion_not_early_window",
  "ac_new_not_yet_due_vs_no_call_yet",
  "ac_progress_default_created",
  "ac_first_attempts_assigned", "ac_first_attempts_none",
  "ac_unreached_reason",
  // CF-AC (2026-09-24): a quote default superseded by an Owner plan (cancel_reason superseded_by_specific_plan).
  "ac_default_superseded",
  // SEED-T3 (2026-09-24): reconciliation addendum §4.1, the S5c capture states (CF5c, §3.7).
  "t3_call_in_progress", "t3_call_pending_finalization", "t3_call_settled", "t3_call_provisional_then_settled",
  "t3_call_unknown_direction", "t3_call_recovered", "t3_call_late_capture",
  "t3_form_created_number", "t3_quarantined_call_log", "t3_webhook_subscription_healthy", "t3_webhook_subscription_expired",
  // SEED-T3 part 2 (2026-09-24): the assignment addendum's seed list (TEAM-3 §4) for CF6, CF7 and CF9.
  "t3_p5_accepted", "t3_p5_uncertain", "t3_p5_to_1", "t3_p5_booking_upgrade",
  "t3_receiver_manual", "t3_receiver_granot", "t3_receiver_extension", "t3_receiver_sheet", "t3_receiver_ringcentral",
  "t3_granot_rep_change", "t3_granot_observation_out_of_order", "t3_granot_user_not_rep",
  "t3_owner_assign_vs_receiver", "t3_promise_across_reps",
  // CF-FINAL (2026-09-24): S6-AGENT on the seed (crm_receiver, the real ringcentral_answered fill, C13 after a later rep change, the timeline event source).
  "t3_crm_receiver", "t3_crm_receiver_ringcentral", "t3_owner_kept_after_receiver_change", "t3_receiver_change_event", "t3_granot_user_not_rep_unchanged",
  "t3_closed_200d", "t3_no_lead",
  "t3_priority_0", "t3_priority_1", "t3_priority_3", "t3_priority_4", "t3_priority_7", "t3_priority_8", "t3_priority_9", "t3_priority_not_set",
  "t3_rep_days_two_reps", "t3_rep_days_unmapped",
  "t3_spend_rate", "t3_spend_legacy", "t3_spend_missing_rate", "t3_spend_duplicate_zero", "t3_spend_no_sync",
  "t3_band_baseline", "t3_band_transition_call", "t3_band_transition_capture_repair", "t3_band_transition_owner", "t3_band_transition_policy",
  "t3_band_since_estimated",
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
  /** SEED-T3: the Call Interactions a row's states name (optional; older manifests don't carry it). */
  interaction_ids?: string[];
};
