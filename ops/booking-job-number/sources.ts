/** Every stored Job Number field the Booking rule must accept (inventory of 2026-11-20). */
export const JOB_NUMBER_SOURCES: Readonly<Record<string, readonly string[]>> = {
  booked_leads: ["job_no", "normalized_job_no"],
  cancelled_leads: ["job_no", "job_no_snapshot", "normalized_job_no_snapshot"],
  form_leads: ["job_no", "normalized_job_no", "granot_job_form_link.job_no", "last_accepted_granot_observation.evidence.normalized_job_no"],
  call_leads: ["job_no", "normalized_job_no", "granot_form_sibling.normalized_job_no", "last_accepted_granot_observation.evidence.normalized_job_no"],
  granot_record_links: ["normalized_job_no", "job_no_snapshot"],
  granot_observations: ["identity.job_no_raw", "identity.normalized_job_no"],
  granot_case_observations: ["identity.job_no_raw", "identity.normalized_job_no"],
  granot_webhook_receipts: ["payload.job_no", "payload.granot_statement.job_no", "evidence_archive.job"],
  granot_archived_receipts: ["evidence_archive.job"],
  granot_booking_reconciliation_cases: ["normalized_job_no", "job_no_snapshot"],
  granot_release_reconciliation_cases: ["normalized_job_no", "job_no_snapshot"],
  granot_booking_discrepancies: ["normalized_job_no"],
  granot_release_discrepancies: ["normalized_job_no"],
  granot_case_statements: ["payload.job_no", "payload.granot_statement.job_no"],
  granot_history_archive_chunks: ["job", "job_key"],
  booking_lead_reconciliation_cases: ["submission.job_no", "submission.normalized_job_no"],
  source_row_receipts: ["last_applied_source_values.job_no"],
  source_row_states: ["last_applied_source_values.job_no"],
  contact_numbers: ["lead.job_no"],
  sales_outreach_subjects: ["display.job_no", "display.normalized_job_no"],
  daily_operations_events: ["job_no", "card.job_no"],
};

/** Shape of a value with letters, digits and spaces folded (`A9{7}_A{3}`), safe to print. */
export function jobNumberShape(value: string): string {
  return value.replace(/[A-Z]/g, "A").replace(/[a-z]/g, "a").replace(/\d/g, "9").replace(/\s/g, "_")
    .replace(/(.)\1*/g, (run, ch: string) => (run.length > 1 ? `${ch}{${run.length}}` : ch));
}
