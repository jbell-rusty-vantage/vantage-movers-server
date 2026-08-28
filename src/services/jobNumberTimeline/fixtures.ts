import { emptyJobTimelineRows, type JobTimelineRows } from "./rows.js";

export const T0 = "2026-03-01T10:00:00.000Z";
export const T_SHEET = "2026-03-01T10:30:00.000Z";
export const T1 = "2026-03-01T11:00:00.000Z";
export const T2 = "2026-03-01T12:00:00.000Z";
export const T3 = "2026-03-01T13:00:00.000Z";
export const WP_JOB = "9001001";
export const GRANOT_JOB = "8002002";
export const LEAD_NAME = "Ada Lovelace";
export const LEAD_PHONE = "5550001234";
export const SMS_BODY = "Thanks for requesting a quote, Ada.";
export const OBS_CONTACT = "Ada L contact";

export function wordpressRows(): JobTimelineRows {
  return {
    ...emptyJobTimelineRows(),
    observations: [
      {
        id: "obs-wp-1",
        captured_at: T2,
        normalized_job_no: WP_JOB,
        job_no_snapshot: WP_JOB,
        receipt_id: "rcpt-wp-1",
        route_event_class: "priority_updated",
        normalization_result: "usable",
        granot_crm_source_id: "src-a",
        priority_canonical: "3",
        priority_valid: true,
        contact: { display_name: OBS_CONTACT, phone_raw: LEAD_PHONE },
      },
    ],
    decisions: [
      {
        id: "dec-wp-1",
        observation_id: "obs-wp-1",
        attempt: 1,
        decided_at: T2,
        execution_mode: "live",
        outcome: "applied",
        reason_code: "lead_synchronized",
        match_method: "job_number",
        target: { model: "FormLead", id: "lead-wp-1" },
        source_granularity_id: "gran-a",
        source_company_id: "co-a",
        effect_kinds: ["lead_updated"],
        evaluated_gates: [{ gate: "source_scope", allowed: true }],
      },
    ],
    booking_cases: [
      {
        id: "case-wp-1",
        kind: "booking",
        normalized_job_no: WP_JOB,
        job_no_snapshot: WP_JOB,
        state: "open",
        mode: "confirm",
        sequence_number: 1,
        case_revision: 1,
        evidence_revision: 1,
        evidence: [{ observation_id: "obs-wp-1", captured_at: T3 }],
      },
    ],
    leads: [
      {
        id: "lead-wp-1",
        model: "FormLead",
        ingestion_origin: "wordpress_form",
        source_granularity_id: "gran-a",
        source_company_id: "co-a",
        source_company_label: "Company A",
        source_granularity_label: "Site A",
        timestamp: T0,
        createdAt: T0,
        name: LEAD_NAME,
        phone: LEAD_PHONE,
        email: "ada@example.invalid",
        ingested_contact_snapshot: {
          name: LEAD_NAME,
          phone_number: LEAD_PHONE,
          email: "ada@example.invalid",
        },
        ingested_move_snapshot: {
          pickup_state: "NY",
          pickup_zip: "10001",
          delivery_state: "FL",
          destination_zip: "33101",
          move_date: "2026-04-01T00:00:00.000Z",
          move_size: "2 Bedrooms",
        },
      },
    ],
    entity_changes: [
      {
        id: "chg-wp-create",
        entity_model: "FormLead",
        entity_id: "lead-wp-1",
        command_name: "createFormLead",
        applied_at: T0,
        changed_paths: ["name", "phone_number"],
      },
      {
        id: "chg-wp-sync",
        entity_model: "FormLead",
        entity_id: "lead-wp-1",
        command_name: "synchronizeLeadFromGranot",
        applied_at: T2,
        decision_id: "dec-wp-1",
        changed_paths: ["job_no", "normalized_job_no"],
      },
    ],
    lead_messages: [
      {
        id: "msg-wp-1",
        lead_id: "lead-wp-1",
        form_lead: "lead-wp-1",
        origin: "public_form",
        purpose: "quote_request_confirmation",
        status: "delivered",
        delivered_at: T1,
        createdAt: T1,
        to: LEAD_PHONE,
        body: SMS_BODY,
      },
    ],
    sheet_sync_jobs: [
      {
        id: "sheet-wp-create",
        entity_id: "lead-wp-1",
        entity_model: "FormLead",
        resource: "source_lead",
        operation: "form_lead.create",
        status: "synced",
        attempts: 1,
        created_by: "api",
        createdAt: T_SHEET,
        updatedAt: T_SHEET,
        target_hints: ["Leads"],
        last_error: "row text must never leak",
        spreadsheet_id: "spread-secret",
      },
    ],
    source_granularities: [
      { id: "gran-a", owner_label: "Site A", source_company_id: "co-a" },
    ],
    granot_crm_sources: [
      { id: "src-a", source_granularity_id: "gran-a", review_state: "reviewed" },
    ],
  };
}

export function wordpressReceiptRows(): JobTimelineRows {
  return {
    ...wordpressRows(),
    wordpress_form_submission_receipts: [
      {
        id: "wp-rcpt-1",
        received_at: T0,
        createdAt: T0,
        processing_status: "lead_created",
        lead_id: "lead-wp-1",
      },
    ],
  };
}

export function granotRows(): JobTimelineRows {
  return {
    ...emptyJobTimelineRows(),
    observations: [
      {
        id: "obs-gr-create",
        captured_at: T0,
        normalized_job_no: GRANOT_JOB,
        job_no_snapshot: GRANOT_JOB,
        receipt_id: "rcpt-gr-1",
        route_event_class: "lead_created",
        normalization_result: "usable",
      },
      {
        id: "obs-gr-priority",
        captured_at: T2,
        normalized_job_no: GRANOT_JOB,
        route_event_class: "priority_updated",
        normalization_result: "usable",
        priority_canonical: "2",
        priority_valid: true,
      },
    ],
    decisions: [
      {
        id: "dec-gr-create",
        observation_id: "obs-gr-create",
        attempt: 1,
        decided_at: T0,
        execution_mode: "live",
        outcome: "created",
        reason_code: "lead_created",
        target: { model: "FormLead", id: "lead-gr-1" },
      },
      {
        id: "dec-gr-priority",
        observation_id: "obs-gr-priority",
        attempt: 1,
        decided_at: T2,
        execution_mode: "live",
        outcome: "applied",
        reason_code: "priority_updated",
        target: { model: "FormLead", id: "lead-gr-1" },
      },
    ],
    leads: [
      {
        id: "lead-gr-1",
        model: "FormLead",
        ingestion_origin: "granot_lead_created",
        timestamp: T0,
        createdAt: T0,
        job_no: GRANOT_JOB,
        normalized_job_no: GRANOT_JOB,
      },
    ],
    entity_changes: [
      {
        id: "chg-gr-create",
        entity_model: "FormLead",
        entity_id: "lead-gr-1",
        command_name: "createLeadFromGranot",
        applied_at: T0,
        changed_paths: ["job_no", "normalized_job_no", "name"],
      },
    ],
    lead_messages: [
      {
        id: "msg-gr-1",
        lead_id: "lead-gr-1",
        origin: "granot_lead_created",
        purpose: "granot_lead_created_confirmation",
        status: "delivered",
        observation_id: "obs-gr-create",
        delivered_at: T1,
        createdAt: T1,
      },
    ],
  };
}
