export const OWNER_BOOKING_CASE_INTAKE_VERSION =
  "granot-lifecycle-owner-booking-case-intake/1";

export const OPERATOR_BOOKING_CASE_INTAKE_REASON =
  "owner_approved_booking_case_intake_for_todays_booked_observations";

export const OPERATOR_BOOKING_CASE_INTAKE_GATE =
  "operator_owner_booking_case_intake";

export type OwnerBookingCaseIntakeMode = "report" | "apply" | "verify";

export type OwnerBookingCaseIntakeAction =
  | "open_booking_case_operator_exception"
  | "already_open"
  | "leave_unclassified";

export type OwnerBookingCaseIntakeFacts = {
  observation_id: string;
  receipt_id?: string;
  latest_decision_id: string;
  attempt: number;
  execution_mode: "historical_shadow" | "live_shadow" | "live";
  captured_at?: string;
  observation_job?: string;
  source_label?: string;
  booking_action?: "booked" | "release";
  lifecycle_disposition?: string;
  identity_outcome?: string;
  identity_reason_code?: string;
  identity_match_method?: string;
  identity_target_id?: string;
  identity_target_model?: string;
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
    deterministic_booking_id?: string;
  };
};

export type PlannedOwnerBookingCaseIntakeRow = {
  observation_id: string;
  receipt_id?: string;
  latest_decision_id: string;
  attempt: number;
  next_attempt: number;
  execution_mode: OwnerBookingCaseIntakeFacts["execution_mode"];
  captured_at?: string;
  observation_job?: string;
  source_label?: string;
  booking_action?: "booked" | "release";
  lifecycle_disposition?: string;
  identity_outcome?: string;
  identity_reason_code?: string;
  identity_match_method?: string;
  identity_target_id?: string;
  identity_target_model?: string;
  record_link_id?: string;
  booking_exists: boolean;
  booking_id?: string;
  case_exists: boolean;
  case_id?: string;
  booking_classification?: OwnerBookingCaseIntakeFacts["booking_classification"];
  action: OwnerBookingCaseIntakeAction;
  apply_eligible: boolean;
  open_booking_case: boolean;
  booking_case_mode?: string;
  create_official_booking: false;
  mutate_original_decision: false;
  operator_reason?: string;
};

export type OwnerBookingCaseIntakeWrite =
  | {
      kind: "insert_booking_reconciliation_case";
      observation_id: string;
      receipt_id?: string;
      latest_decision_id: string;
      normalized_job_no: string;
      mode?: string;
      operator_reason: string;
    }
  | {
      kind: "insert_repair_decision";
      observation_id: string;
      receipt_id?: string;
      latest_decision_id: string;
      next_attempt: number;
      reason_code: "booking_case_opened";
      normalized_job_no?: string;
    }
  | {
      kind: "insert_official_booking";
      normalized_job_no: string;
    }
  | {
      kind: "update_original_decision";
      decision_id: string;
    };

export function planOwnerBookingCaseIntakeRow(
  facts: OwnerBookingCaseIntakeFacts,
): PlannedOwnerBookingCaseIntakeRow {
  const booked = facts.booking_action === "booked";
  const wouldOpenCase = facts.booking_classification?.kind === "case";
  const base: PlannedOwnerBookingCaseIntakeRow = {
    observation_id: facts.observation_id,
    receipt_id: facts.receipt_id,
    latest_decision_id: facts.latest_decision_id,
    attempt: facts.attempt,
    next_attempt: facts.attempt + 1,
    execution_mode: facts.execution_mode,
    captured_at: facts.captured_at,
    observation_job: facts.observation_job,
    source_label: facts.source_label,
    booking_action: facts.booking_action,
    lifecycle_disposition: facts.lifecycle_disposition,
    identity_outcome: facts.identity_outcome,
    identity_reason_code: facts.identity_reason_code,
    identity_match_method: facts.identity_match_method,
    identity_target_id: facts.identity_target_id,
    identity_target_model: facts.identity_target_model,
    record_link_id: facts.record_link_id,
    booking_exists: facts.booking_exists,
    booking_id: facts.booking_id,
    case_exists: facts.case_exists,
    case_id: facts.case_id,
    booking_classification: facts.booking_classification,
    action: "leave_unclassified",
    apply_eligible: false,
    open_booking_case: false,
    create_official_booking: false,
    mutate_original_decision: false,
  };

  if (facts.case_exists) {
    return { ...base, action: "already_open" };
  }

  if (!booked || !wouldOpenCase || !facts.observation_job) {
    return base;
  }

  return {
    ...base,
    action: "open_booking_case_operator_exception",
    apply_eligible: true,
    open_booking_case: true,
    booking_case_mode: facts.booking_classification?.mode,
    operator_reason: OPERATOR_BOOKING_CASE_INTAKE_REASON,
  };
}

export function planOwnerBookingCaseIntakeWrites(
  rows: readonly PlannedOwnerBookingCaseIntakeRow[],
): OwnerBookingCaseIntakeWrite[] {
  const writes: OwnerBookingCaseIntakeWrite[] = [];
  for (const row of rows) {
    if (!row.apply_eligible || !row.open_booking_case) continue;
    const job = row.observation_job;
    if (!job) {
      throw new Error(`Intake row ${row.observation_id} is eligible but missing observation_job.`);
    }
    writes.push({
      kind: "insert_booking_reconciliation_case",
      observation_id: row.observation_id,
      receipt_id: row.receipt_id,
      latest_decision_id: row.latest_decision_id,
      normalized_job_no: job,
      mode: row.booking_case_mode,
      operator_reason: row.operator_reason ?? OPERATOR_BOOKING_CASE_INTAKE_REASON,
    });
    writes.push({
      kind: "insert_repair_decision",
      observation_id: row.observation_id,
      receipt_id: row.receipt_id,
      latest_decision_id: row.latest_decision_id,
      next_attempt: row.next_attempt,
      reason_code: "booking_case_opened",
      normalized_job_no: job,
    });
  }
  return writes;
}

export function assertOwnerBookingCaseIntakeApplyAllowed(input: {
  rows: readonly PlannedOwnerBookingCaseIntakeRow[];
  writes: readonly OwnerBookingCaseIntakeWrite[];
}): void {
  if (input.writes.some((write) => write.kind === "update_original_decision")) {
    throw new Error("Refusing apply: original Decisions must stay immutable.");
  }
  if (input.writes.some((write) => write.kind === "insert_official_booking")) {
    throw new Error("Refusing apply: official Bookings are not part of this intake.");
  }
  for (const row of input.rows) {
    if (row.apply_eligible && row.booking_action !== "booked") {
      throw new Error(`Refusing apply: ${row.observation_id} is not a Booked observation.`);
    }
    if (row.apply_eligible && row.booking_classification?.kind !== "case") {
      throw new Error(`Refusing apply: ${row.observation_id} did not classify as a booking case.`);
    }
    if (row.action === "leave_unclassified" && row.apply_eligible) {
      throw new Error(`Refusing apply: ${row.observation_id} is unclassified.`);
    }
  }
}

export type OwnerBookingCaseIntakeManifest = {
  script_version: string;
  database_name: string;
  mode: OwnerBookingCaseIntakeMode;
  operator_reason: string;
  captured_from: string;
  captured_to: string;
  summary: {
    booked_jobs: number;
    already_open: number;
    unclassified: number;
    apply_eligible: number;
    booking_cases_planned: number;
    official_bookings_planned: number;
  };
  rows: readonly PlannedOwnerBookingCaseIntakeRow[];
  writes: readonly OwnerBookingCaseIntakeWrite[];
  applied: {
    booking_cases: number;
    repair_decisions: number;
  };
  verify: {
    ok: boolean;
    failures: string[];
  } | null;
};

export function buildOwnerBookingCaseIntakeManifest(input: {
  databaseName: string;
  mode: OwnerBookingCaseIntakeMode;
  capturedFrom: string;
  capturedTo: string;
  rows: readonly PlannedOwnerBookingCaseIntakeRow[];
  writes: readonly OwnerBookingCaseIntakeWrite[];
  applied?: { booking_cases: number; repair_decisions: number };
  verify?: { ok: boolean; failures: string[] };
}): OwnerBookingCaseIntakeManifest {
  return {
    script_version: OWNER_BOOKING_CASE_INTAKE_VERSION,
    database_name: input.databaseName,
    mode: input.mode,
    operator_reason: OPERATOR_BOOKING_CASE_INTAKE_REASON,
    captured_from: input.capturedFrom,
    captured_to: input.capturedTo,
    summary: {
      booked_jobs: input.rows.length,
      already_open: input.rows.filter((row) => row.action === "already_open").length,
      unclassified: input.rows.filter((row) => row.action === "leave_unclassified").length,
      apply_eligible: input.rows.filter((row) => row.apply_eligible).length,
      booking_cases_planned: input.writes.filter((write) => write.kind === "insert_booking_reconciliation_case").length,
      official_bookings_planned: input.writes.filter((write) => write.kind === "insert_official_booking").length,
    },
    rows: input.rows,
    writes: input.writes,
    applied: input.applied ?? { booking_cases: 0, repair_decisions: 0 },
    verify: input.verify ?? null,
  };
}

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

export function scanOwnerBookingCaseIntakeManifestForPii(value: unknown): string[] {
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
