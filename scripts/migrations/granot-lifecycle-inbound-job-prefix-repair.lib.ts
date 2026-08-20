import { jobNumbersEquivalent } from "../../src/services/bookings/bookingIdentity.js";

export const INBOUND_JOB_PREFIX_REPAIR_VERSION =
  "granot-lifecycle-inbound-job-prefix-repair/1";

export const OPERATOR_BOOKING_CASE_REASON =
  "owner_approved_pre_cutoff_booked_case_after_inbound_job_prefix_fix";

export type InboundJobPrefixRepairMode = "report" | "apply" | "verify";

export type InboundJobPrefixRepairAction =
  | "establish_job_level_record_link"
  | "open_booking_case_operator_exception"
  | "already_repaired"
  | "leave_real_conflict"
  | "report_only_live_conflict"
  | "identity_not_linked";

export type InboundJobPrefixRepairFacts = {
  decision_id: string;
  observation_id: string;
  receipt_id?: string;
  attempt: number;
  execution_mode: "historical_shadow" | "live_shadow" | "live";
  old_outcome: string;
  old_reason_code: string;
  decided_at: string;
  captured_at?: string;
  route_event_class?: string;
  booking_action?: "booked" | "release";
  observation_job?: string;
  call_lead_id?: string;
  call_lead_job?: string;
  jobs_prefix_equivalent?: boolean;
  identity: {
    outcome: string;
    reason_code: string;
    match_method?: string;
    target_id?: string;
    target_model?: string;
  };
  record_link_exists: boolean;
  record_link_id?: string;
  booking_exists: boolean;
  booking_id?: string;
  case_exists: boolean;
  case_id?: string;
  booking_classification?: {
    kind: string;
    mode?: string;
    evidence_action?: string;
    reason?: string;
    reason_code?: string;
  };
  live_processor_would_open_case?: boolean;
  live_processor_block_reason?: string;
};

export type PlannedInboundJobPrefixRepairRow = {
  decision_id: string;
  observation_id: string;
  receipt_id?: string;
  attempt: number;
  execution_mode: InboundJobPrefixRepairFacts["execution_mode"];
  old_outcome: string;
  old_reason_code: string;
  decided_at: string;
  captured_at?: string;
  route_event_class?: string;
  booking_action?: "booked" | "release";
  observation_job?: string;
  call_lead_id?: string;
  call_lead_job?: string;
  jobs_prefix_equivalent: boolean;
  identity_outcome: string;
  identity_reason_code: string;
  identity_match_method?: string;
  identity_target_id?: string;
  identity_target_model?: string;
  identity_would_link: boolean;
  record_link_exists: boolean;
  record_link_id?: string;
  booking_exists: boolean;
  booking_id?: string;
  case_exists: boolean;
  case_id?: string;
  booking_classification?: InboundJobPrefixRepairFacts["booking_classification"];
  live_processor_would_open_case?: boolean;
  live_processor_block_reason?: string;
  action: InboundJobPrefixRepairAction;
  apply_eligible: boolean;
  establish_record_link: boolean;
  attach_lead_ref: boolean;
  open_booking_case: boolean;
  booking_case_mode?: string;
  create_official_booking: boolean;
  mutate_original_decision: false;
  operator_reason?: string;
};

export type InboundJobPrefixRepairWrite =
  | {
      kind: "insert_job_level_record_link";
      observation_id: string;
      receipt_id?: string;
      decision_id?: string;
      normalized_job_no: string;
      call_lead_id?: string;
    }
  | {
      kind: "insert_booking_reconciliation_case";
      observation_id: string;
      receipt_id?: string;
      decision_id?: string;
      normalized_job_no: string;
      call_lead_id?: string;
      mode?: string;
      operator_reason: string;
    }
  | {
      kind: "insert_repair_decision";
      observation_id: string;
      receipt_id?: string;
      original_decision_id: string;
      next_attempt: number;
      reason_code: "record_link_established" | "booking_case_opened";
      normalized_job_no?: string;
    }
  | {
      kind: "update_original_decision";
      decision_id: string;
    }
  | {
      kind: "insert_official_booking";
      normalized_job_no: string;
    };

const FORBIDDEN_PII_KEYS = new Set([
  "first_name",
  "last_name",
  "display_name",
  "name",
  "phone",
  "phone_raw",
  "phone_number",
  "normalized_phone",
  "normalized_phone_number",
  "email",
  "email_raw",
  "normalized_email",
  "contact",
]);

export function planInboundJobPrefixRepairRow(
  facts: InboundJobPrefixRepairFacts,
): PlannedInboundJobPrefixRepairRow {
  const jobsPrefixEquivalent =
    facts.jobs_prefix_equivalent ??
    jobNumbersEquivalent(facts.observation_job, facts.call_lead_job);
  const identityWouldLink =
    facts.identity.outcome === "linked" &&
    Boolean(facts.identity.target_id) &&
    jobsPrefixEquivalent;
  const booked = facts.booking_action === "booked";
  const wouldOpenCase =
    facts.booking_classification?.kind === "case" &&
    facts.booking_classification.mode === "create_missing_booking";

  const base: PlannedInboundJobPrefixRepairRow = {
    decision_id: facts.decision_id,
    observation_id: facts.observation_id,
    receipt_id: facts.receipt_id,
    attempt: facts.attempt,
    execution_mode: facts.execution_mode,
    old_outcome: facts.old_outcome,
    old_reason_code: facts.old_reason_code,
    decided_at: facts.decided_at,
    captured_at: facts.captured_at,
    route_event_class: facts.route_event_class,
    booking_action: facts.booking_action,
    observation_job: facts.observation_job,
    call_lead_id: facts.call_lead_id,
    call_lead_job: facts.call_lead_job,
    jobs_prefix_equivalent: jobsPrefixEquivalent,
    identity_outcome: facts.identity.outcome,
    identity_reason_code: facts.identity.reason_code,
    identity_match_method: facts.identity.match_method,
    identity_target_id: facts.identity.target_id,
    identity_target_model: facts.identity.target_model,
    identity_would_link: identityWouldLink,
    record_link_exists: facts.record_link_exists,
    record_link_id: facts.record_link_id,
    booking_exists: facts.booking_exists,
    booking_id: facts.booking_id,
    case_exists: facts.case_exists,
    case_id: facts.case_id,
    booking_classification: facts.booking_classification,
    live_processor_would_open_case: facts.live_processor_would_open_case,
    live_processor_block_reason: facts.live_processor_block_reason,
    action: "identity_not_linked",
    apply_eligible: false,
    establish_record_link: false,
    attach_lead_ref: false,
    open_booking_case: false,
    create_official_booking: false,
    mutate_original_decision: false,
  };

  if (facts.execution_mode === "live" || facts.execution_mode === "live_shadow") {
    return { ...base, action: "report_only_live_conflict" };
  }

  if (!jobsPrefixEquivalent || facts.identity.outcome === "conflict") {
    return { ...base, action: "leave_real_conflict" };
  }

  if (!identityWouldLink) {
    return base;
  }

  const linkNeeded = !facts.record_link_exists;
  const caseNeeded = booked && wouldOpenCase && !facts.case_exists && !facts.booking_exists;

  if (!linkNeeded && !caseNeeded) {
    return { ...base, action: "already_repaired" };
  }

  if (caseNeeded) {
    return {
      ...base,
      action: "open_booking_case_operator_exception",
      apply_eligible: true,
      establish_record_link: linkNeeded,
      open_booking_case: true,
      booking_case_mode: "create_missing_booking",
      operator_reason: OPERATOR_BOOKING_CASE_REASON,
    };
  }

  return {
    ...base,
    action: "establish_job_level_record_link",
    apply_eligible: true,
    establish_record_link: true,
  };
}

export function planInboundJobPrefixRepairWrites(
  rows: readonly PlannedInboundJobPrefixRepairRow[],
): InboundJobPrefixRepairWrite[] {
  const writes: InboundJobPrefixRepairWrite[] = [];
  const jobsWithLinkWrite = new Set<string>();

  for (const row of rows) {
    if (!row.apply_eligible) continue;
    const job = row.observation_job;
    if (!job) {
      throw new Error(`Repair row ${row.decision_id} is eligible but missing observation_job.`);
    }

    if (row.establish_record_link && !jobsWithLinkWrite.has(job)) {
      jobsWithLinkWrite.add(job);
      writes.push({
        kind: "insert_job_level_record_link",
        observation_id: row.observation_id,
        receipt_id: row.receipt_id,
        decision_id: row.decision_id,
        normalized_job_no: job,
        call_lead_id: row.call_lead_id,
      });
    } else if (row.establish_record_link) {
      // Same digit job already has a planned link from an earlier Observation.
    }

    if (row.open_booking_case) {
      writes.push({
        kind: "insert_booking_reconciliation_case",
        observation_id: row.observation_id,
        receipt_id: row.receipt_id,
        decision_id: row.decision_id,
        normalized_job_no: job,
        call_lead_id: row.call_lead_id,
        mode: row.booking_case_mode,
        operator_reason: row.operator_reason ?? OPERATOR_BOOKING_CASE_REASON,
      });
    }

    writes.push({
      kind: "insert_repair_decision",
      observation_id: row.observation_id,
      receipt_id: row.receipt_id,
      original_decision_id: row.decision_id,
      next_attempt: row.attempt + 1,
      reason_code: row.open_booking_case ? "booking_case_opened" : "record_link_established",
      normalized_job_no: job,
    });
  }

  return writes;
}

export function assertInboundJobPrefixRepairApplyAllowed(input: {
  rows: readonly PlannedInboundJobPrefixRepairRow[];
  writes: readonly InboundJobPrefixRepairWrite[];
}): void {
  if (input.writes.some((write) => write.kind === "update_original_decision")) {
    throw new Error("Refusing apply: original conflict Decisions must stay immutable.");
  }
  if (input.writes.some((write) => write.kind === "insert_official_booking")) {
    throw new Error("Refusing apply: official Bookings are not part of this repair.");
  }
  for (const row of input.rows) {
    if (row.apply_eligible && row.execution_mode !== "historical_shadow") {
      throw new Error(
        `Refusing apply: ${row.decision_id} is ${row.execution_mode} and is not part of this historical repair.`,
      );
    }
    if (row.action === "leave_real_conflict" && row.apply_eligible) {
      throw new Error(`Refusing apply: ${row.decision_id} is still a real job-number conflict.`);
    }
  }
  for (const write of input.writes) {
    if (write.kind === "insert_job_level_record_link" || write.kind === "insert_booking_reconciliation_case") {
      const row = input.rows.find((candidate) => candidate.observation_id === write.observation_id);
      if (row && (row.action === "leave_real_conflict" || !row.apply_eligible)) {
        throw new Error(`Refusing apply: write planned for ineligible observation ${write.observation_id}.`);
      }
    }
  }
}

export function buildInboundJobPrefixRepairManifest(input: {
  databaseName: string;
  mode: InboundJobPrefixRepairMode;
  rows: readonly PlannedInboundJobPrefixRepairRow[];
  writes: readonly InboundJobPrefixRepairWrite[];
  applied?: {
    record_links: number;
    booking_cases: number;
    repair_decisions: number;
  };
  verify?: {
    ok: boolean;
    failures: string[];
  };
}): Record<string, unknown> {
  const historical = input.rows.filter((row) => row.execution_mode === "historical_shadow");
  const live = input.rows.filter((row) => row.execution_mode !== "historical_shadow");
  return {
    script_version: INBOUND_JOB_PREFIX_REPAIR_VERSION,
    database_name: input.databaseName,
    mode: input.mode,
    operator_booking_case_reason: OPERATOR_BOOKING_CASE_REASON,
    summary: {
      conflict_decisions: input.rows.length,
      historical_shadow: historical.length,
      live_or_live_shadow: live.length,
      prefix_equivalent: input.rows.filter((row) => row.jobs_prefix_equivalent).length,
      identity_would_link: input.rows.filter((row) => row.identity_would_link).length,
      historical_apply_eligible: historical.filter((row) => row.apply_eligible).length,
      record_links_planned: input.writes.filter((write) => write.kind === "insert_job_level_record_link").length,
      booking_cases_planned: input.writes.filter((write) => write.kind === "insert_booking_reconciliation_case").length,
      official_bookings_planned: input.writes.filter((write) => write.kind === "insert_official_booking").length,
      original_decisions_mutated: input.writes.filter((write) => write.kind === "update_original_decision").length,
      already_repaired: input.rows.filter((row) => row.action === "already_repaired").length,
      real_conflicts_left: input.rows.filter((row) => row.action === "leave_real_conflict").length,
    },
    rows: input.rows,
    writes: input.writes,
    applied: input.applied ?? { record_links: 0, booking_cases: 0, repair_decisions: 0 },
    verify: input.verify ?? null,
  };
}

export function scanInboundJobPrefixRepairManifestForPii(value: unknown): string[] {
  const findings: string[] = [];
  const visit = (node: unknown, trail: string): void => {
    if (node == null) return;
    if (Array.isArray(node)) {
      node.forEach((entry, index) => visit(entry, `${trail}[${index}]`));
      return;
    }
    if (typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        if (FORBIDDEN_PII_KEYS.has(key)) findings.push(`${trail}.${key}`);
        visit(child, `${trail}.${key}`);
      }
      return;
    }
    if (typeof node !== "string") return;
    if (node.includes("@") && node.includes(".")) findings.push(`${trail}:email-like`);
    if (
      !/^[a-fA-F0-9]{16,}$/.test(node) &&
      !/^[a-fA-F0-9]{4}…[a-fA-F0-9]{4}$/.test(node) &&
      !/^\d{4}-\d{2}-\d{2}T/.test(node) &&
      /(?:\d[\s().-]*){10,15}/.test(node)
    ) {
      findings.push(`${trail}:phone-like`);
    }
  };
  visit(value, "$");
  return findings;
}
