export const RELEASE_CASES_INTO_BOOKING_INTAKE_VERSION =
  "granot-lifecycle-release-cases-into-booking-intake/1";

export const RELEASE_CASE_MIGRATE_REASON = "migrated_to_booking_intake";

export const RELEASE_CASE_NO_ACTION_REASON_CODE = "already_handled_elsewhere";

export const RELEASE_DISCREPANCY_MIGRATE_CHOICE = "leave_historical" as const;

export type ReleaseCasesIntoBookingIntakeMode = "report" | "apply" | "verify";

export type ReleaseCaseEvidenceFact = {
  observation_id: string;
  decision_id: string;
  captured_at: string;
};

export type ReleaseCasesIntoBookingIntakeFacts = {
  release_case_id: string;
  normalized_job_no: string;
  job_no_snapshot?: string;
  release_evidence: readonly ReleaseCaseEvidenceFact[];
  open_booking_case?: {
    id: string;
    mode: string;
    evidence_observation_ids: readonly string[];
    deterministic_booking_id?: string;
  };
  max_booking_sequence: number;
  live_official_booking?: {
    id: string;
    officially_cancelled: boolean;
    domain_revision?: number;
  };
  official_cancellation?: {
    id: string;
    domain_revision?: number;
  };
};

export type ReleaseCasesIntoBookingIntakeAction =
  | "open_booking_case"
  | "append_release_evidence"
  | "resolve_release_case_only";

export type BookingIntakeMigrateMode = "create_missing_booking" | "review_existing_booking";

export type PlannedReleaseCasesIntoBookingIntakeRow = {
  release_case_id: string;
  normalized_job_no: string;
  job_no_snapshot?: string;
  action: ReleaseCasesIntoBookingIntakeAction;
  apply_eligible: boolean;
  open_booking_case: boolean;
  booking_case_id?: string;
  planned_sequence?: number;
  booking_case_mode: BookingIntakeMigrateMode;
  deterministic_booking_id?: string;
  append_observation_ids: string[];
  set_review_mode: boolean;
  resolve_release_case: {
    state: "resolved";
    outcome: "no_action";
    reason: typeof RELEASE_CASE_MIGRATE_REASON;
    reason_code: typeof RELEASE_CASE_NO_ACTION_REASON_CODE;
  };
  official_booking_id?: string;
  official_booking_domain_revision?: number;
  official_cancellation_id?: string;
  official_cancellation_domain_revision?: number;
  create_official_booking: false;
  create_official_cancellation: false;
  mutate_official_booking: false;
  mutate_official_cancellation: false;
};

export type ReleaseCasesIntoBookingIntakeWrite =
  | {
      kind: "insert_booking_reconciliation_case";
      release_case_id: string;
      normalized_job_no: string;
      sequence: number;
      mode: BookingIntakeMigrateMode;
      append_observation_ids: readonly string[];
      deterministic_booking_id?: string;
    }
  | {
      kind: "append_booking_case_evidence";
      release_case_id: string;
      booking_case_id: string;
      normalized_job_no: string;
      append_observation_ids: readonly string[];
    }
  | {
      kind: "set_booking_case_review_mode";
      release_case_id: string;
      booking_case_id: string;
      deterministic_booking_id: string;
    }
  | {
      kind: "resolve_release_case";
      release_case_id: string;
      outcome: "no_action";
      reason: typeof RELEASE_CASE_MIGRATE_REASON;
    }
  | {
      kind: "insert_official_booking";
      normalized_job_no: string;
    }
  | {
      kind: "insert_official_cancellation";
      normalized_job_no: string;
    }
  | {
      kind: "update_official_booking";
      booking_id: string;
    }
  | {
      kind: "update_official_cancellation";
      cancellation_id: string;
    };

export type ReleaseDiscrepancyMigratePlan = {
  action: typeof RELEASE_DISCREPANCY_MIGRATE_CHOICE;
  reason_code: "release_without_vantage_booking";
  invent_booking_intake_from_discrepancy: false;
};

function liveOfficialBooking(
  facts: ReleaseCasesIntoBookingIntakeFacts,
): { id: string; domain_revision?: number } | undefined {
  const booking = facts.live_official_booking;
  if (!booking || booking.officially_cancelled) return undefined;
  return { id: booking.id, domain_revision: booking.domain_revision };
}

function appendObservationIds(facts: ReleaseCasesIntoBookingIntakeFacts): string[] {
  const already = new Set(facts.open_booking_case?.evidence_observation_ids ?? []);
  const ids: string[] = [];
  for (const row of facts.release_evidence) {
    if (already.has(row.observation_id)) continue;
    if (ids.includes(row.observation_id)) continue;
    ids.push(row.observation_id);
  }
  return ids;
}

export function planReleaseCasesIntoBookingIntakeRow(
  facts: ReleaseCasesIntoBookingIntakeFacts,
): PlannedReleaseCasesIntoBookingIntakeRow {
  const live = liveOfficialBooking(facts);
  const append_observation_ids = appendObservationIds(facts);
  const booking_case_mode: BookingIntakeMigrateMode = live
    ? "review_existing_booking"
    : "create_missing_booking";
  const existing = facts.open_booking_case;
  const set_review_mode = Boolean(
    live &&
      existing &&
      (existing.mode !== "review_existing_booking" || !existing.deterministic_booking_id),
  );
  const base: PlannedReleaseCasesIntoBookingIntakeRow = {
    release_case_id: facts.release_case_id,
    normalized_job_no: facts.normalized_job_no,
    job_no_snapshot: facts.job_no_snapshot,
    action: "resolve_release_case_only",
    apply_eligible: Boolean(facts.normalized_job_no),
    open_booking_case: false,
    booking_case_mode,
    deterministic_booking_id: live?.id,
    append_observation_ids,
    set_review_mode,
    resolve_release_case: {
      state: "resolved",
      outcome: "no_action",
      reason: RELEASE_CASE_MIGRATE_REASON,
      reason_code: RELEASE_CASE_NO_ACTION_REASON_CODE,
    },
    official_booking_id: facts.live_official_booking?.id,
    official_booking_domain_revision: facts.live_official_booking?.domain_revision,
    official_cancellation_id: facts.official_cancellation?.id,
    official_cancellation_domain_revision: facts.official_cancellation?.domain_revision,
    create_official_booking: false,
    create_official_cancellation: false,
    mutate_official_booking: false,
    mutate_official_cancellation: false,
  };

  if (!facts.normalized_job_no) {
    return { ...base, apply_eligible: false };
  }

  if (!existing) {
    const planned_sequence =
      Number.isInteger(facts.max_booking_sequence) && facts.max_booking_sequence > 0
        ? facts.max_booking_sequence + 1
        : 1;
    return {
      ...base,
      action: "open_booking_case",
      open_booking_case: true,
      planned_sequence,
      set_review_mode: false,
    };
  }

  return {
    ...base,
    action: append_observation_ids.length > 0 ? "append_release_evidence" : "resolve_release_case_only",
    booking_case_id: existing.id,
    deterministic_booking_id: live?.id ?? existing.deterministic_booking_id,
  };
}

export function planReleaseCasesIntoBookingIntakeWrites(
  rows: readonly PlannedReleaseCasesIntoBookingIntakeRow[],
): ReleaseCasesIntoBookingIntakeWrite[] {
  const writes: ReleaseCasesIntoBookingIntakeWrite[] = [];
  for (const row of rows) {
    if (!row.apply_eligible) continue;
    const job = row.normalized_job_no;
    if (!job) {
      throw new Error(`Release case ${row.release_case_id} is eligible but missing normalized_job_no.`);
    }
    if (row.open_booking_case) {
      writes.push({
        kind: "insert_booking_reconciliation_case",
        release_case_id: row.release_case_id,
        normalized_job_no: job,
        sequence: row.planned_sequence ?? 1,
        mode: row.booking_case_mode,
        append_observation_ids: row.append_observation_ids,
        ...(row.deterministic_booking_id
          ? { deterministic_booking_id: row.deterministic_booking_id }
          : {}),
      });
    } else if (row.append_observation_ids.length > 0) {
      if (!row.booking_case_id) {
        throw new Error(`Release case ${row.release_case_id} plans append without a booking case id.`);
      }
      writes.push({
        kind: "append_booking_case_evidence",
        release_case_id: row.release_case_id,
        booking_case_id: row.booking_case_id,
        normalized_job_no: job,
        append_observation_ids: row.append_observation_ids,
      });
    }
    if (row.set_review_mode) {
      if (!row.booking_case_id || !row.deterministic_booking_id) {
        throw new Error(
          `Release case ${row.release_case_id} plans review mode without booking case or Booking id.`,
        );
      }
      writes.push({
        kind: "set_booking_case_review_mode",
        release_case_id: row.release_case_id,
        booking_case_id: row.booking_case_id,
        deterministic_booking_id: row.deterministic_booking_id,
      });
    }
    writes.push({
      kind: "resolve_release_case",
      release_case_id: row.release_case_id,
      outcome: "no_action",
      reason: RELEASE_CASE_MIGRATE_REASON,
    });
  }
  return writes;
}

export function planReleaseWithoutVantageBookingDiscrepancies(): ReleaseDiscrepancyMigratePlan {
  return {
    action: RELEASE_DISCREPANCY_MIGRATE_CHOICE,
    reason_code: "release_without_vantage_booking",
    invent_booking_intake_from_discrepancy: false,
  };
}

const FORBIDDEN_OFFICIAL_WRITE_KINDS = new Set([
  "insert_official_booking",
  "insert_official_cancellation",
  "update_official_booking",
  "update_official_cancellation",
]);

export function assertReleaseCasesIntoBookingIntakeApplyAllowed(input: {
  rows: readonly PlannedReleaseCasesIntoBookingIntakeRow[];
  writes: readonly ReleaseCasesIntoBookingIntakeWrite[];
}): void {
  if (input.writes.some((write) => FORBIDDEN_OFFICIAL_WRITE_KINDS.has(write.kind))) {
    throw new Error("Refusing apply: official Bookings and Cancellations are not part of this migrate.");
  }
  for (const row of input.rows) {
    if (!row.apply_eligible) continue;
    if (row.create_official_booking || row.create_official_cancellation) {
      throw new Error(`Refusing apply: ${row.release_case_id} plans an official Booking or Cancellation.`);
    }
    if (row.mutate_official_booking || row.mutate_official_cancellation) {
      throw new Error(`Refusing apply: ${row.release_case_id} mutates an official Booking or Cancellation.`);
    }
    if (row.resolve_release_case.outcome !== "no_action") {
      throw new Error(`Refusing apply: ${row.release_case_id} does not resolve the Release case with No Action.`);
    }
    if (row.resolve_release_case.reason !== RELEASE_CASE_MIGRATE_REASON) {
      throw new Error(`Refusing apply: ${row.release_case_id} is missing the migrate reason.`);
    }
    if (!row.normalized_job_no) {
      throw new Error(`Refusing apply: ${row.release_case_id} is missing normalized_job_no.`);
    }
  }
}

export type ReleaseCasesIntoBookingIntakeManifest = {
  script_version: string;
  database_name: string;
  mode: ReleaseCasesIntoBookingIntakeMode;
  migrate_reason: typeof RELEASE_CASE_MIGRATE_REASON;
  discrepancy: ReleaseDiscrepancyMigratePlan;
  summary: {
    open_release_cases: number;
    apply_eligible: number;
    booking_cases_to_open: number;
    booking_cases_to_refresh: number;
    release_cases_to_resolve: number;
    official_bookings_planned: number;
    official_cancellations_planned: number;
    open_release_without_vantage_booking_discrepancies: number;
    discrepancy_action: typeof RELEASE_DISCREPANCY_MIGRATE_CHOICE;
  };
  rows: readonly PlannedReleaseCasesIntoBookingIntakeRow[];
  writes: readonly ReleaseCasesIntoBookingIntakeWrite[];
  applied: {
    booking_cases_opened: number;
    booking_cases_refreshed: number;
    release_cases_resolved: number;
  };
  verify: {
    ok: boolean;
    failures: string[];
  } | null;
};

export function buildReleaseCasesIntoBookingIntakeManifest(input: {
  databaseName: string;
  mode: ReleaseCasesIntoBookingIntakeMode;
  rows: readonly PlannedReleaseCasesIntoBookingIntakeRow[];
  writes: readonly ReleaseCasesIntoBookingIntakeWrite[];
  openReleaseWithoutVantageBookingDiscrepancies?: number;
  applied?: {
    booking_cases_opened: number;
    booking_cases_refreshed: number;
    release_cases_resolved: number;
  };
  verify?: { ok: boolean; failures: string[] };
}): ReleaseCasesIntoBookingIntakeManifest {
  const discrepancy = planReleaseWithoutVantageBookingDiscrepancies();
  return {
    script_version: RELEASE_CASES_INTO_BOOKING_INTAKE_VERSION,
    database_name: input.databaseName,
    mode: input.mode,
    migrate_reason: RELEASE_CASE_MIGRATE_REASON,
    discrepancy,
    summary: {
      open_release_cases: input.rows.length,
      apply_eligible: input.rows.filter((row) => row.apply_eligible).length,
      booking_cases_to_open: input.writes.filter((write) => write.kind === "insert_booking_reconciliation_case")
        .length,
      booking_cases_to_refresh: input.writes.filter((write) => write.kind === "append_booking_case_evidence")
        .length,
      release_cases_to_resolve: input.writes.filter((write) => write.kind === "resolve_release_case").length,
      official_bookings_planned: input.writes.filter(
        (write) => write.kind === "insert_official_booking" || write.kind === "update_official_booking",
      ).length,
      official_cancellations_planned: input.writes.filter(
        (write) => write.kind === "insert_official_cancellation" || write.kind === "update_official_cancellation",
      ).length,
      open_release_without_vantage_booking_discrepancies:
        input.openReleaseWithoutVantageBookingDiscrepancies ?? 0,
      discrepancy_action: discrepancy.action,
    },
    rows: input.rows,
    writes: input.writes,
    applied: input.applied ?? {
      booking_cases_opened: 0,
      booking_cases_refreshed: 0,
      release_cases_resolved: 0,
    },
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

export function scanReleaseCasesIntoBookingIntakeManifestForPii(value: unknown): string[] {
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
