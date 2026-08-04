import { computeChecksum } from "../durableWork";
import {
  buildIngestPlan,
  normalizeMoveSize,
  normalizeZip,
  SOURCE_COMPANY,
} from "./plan";
import {
  assertUniqueSourceIdentities,
  sourceOwnedContentHash,
  stableSourceRowId,
  type AuthoritativeObservation,
} from "./identity";
import {
  matchRefundsToBookings,
  selectBestRelocationRefundObservations,
} from "./matching";
import { isWithinIngestionWindow } from "./sheets";
import type {
  MutationAction,
  ParsedBookedDeal,
  ParsedWorkbookData,
  PlannedMutation,
  SheetProvenance,
} from "./types";

export const BEST_RELOCATION_ADAPTER_KEY = "best_relocation";
export const BEST_RELOCATION_SCHEMA_VERSION = 2;
export const MATCH_CALIBRATION_VERSION = "best-relocation-conservative-v2";
export const AUTO_LINK_THRESHOLD = 0.9;

export type BestRelocationPlanAction = {
  action_key: string;
  command:
    | MutationAction
    | "update_source_owned_lead"
    | "record_conflict"
    | "adopt_existing"
    | "unchanged";
  classification:
    | "create"
    | "leadless_booking"
    | "safe_update"
    | "conflict"
    | "invalid"
    | "unchanged"
    | "adoption";
  dataset_key: string;
  stable_source_row_id: string;
  content_hash: string;
  schema_profile: string;
  schema_version: number;
  provenance: SheetProvenance | { rows: SheetProvenance[] };
  command_payload?: Record<string, unknown>;
  source_owned_values?: Record<string, unknown>;
  depends_on: string[];
  matching?: {
    method?: string;
    score?: number;
    runner_up_margin?: number;
    calibration_version: string;
    evidence: string[];
  };
  conflict?: {
    type:
      | "ambiguous_lead_match"
      | "unmatched_refund"
      | "canonical_divergence"
      | "missing_source_row"
      | "changed_protected_field"
      | "schema_drift"
      | "duplicate_source_identity";
    severity: "warning" | "blocking";
  };
  adopted_entity_refs?: Array<{ model: string; id: string }>;
};

export type BestRelocationApplicationPlan = {
  adapter_key: typeof BEST_RELOCATION_ADAPTER_KEY;
  schema_version: typeof BEST_RELOCATION_SCHEMA_VERSION;
  trigger: "bootstrap" | "preview" | "manual" | "schedule" | "retry";
  cutoff: string;
  timezone: "America/New_York";
  source_read_through: string;
  source_snapshot: {
    leads: { id: string; title: string };
    booked: { id: string; title: string };
  };
  calibration_version: typeof MATCH_CALIBRATION_VERSION;
  actions: BestRelocationPlanAction[];
  counters: Record<string, number>;
  warnings: string[];
  bootstrap_reconciliation?: {
    source_actions: number;
    adopted: number;
    blocking_discrepancies: number;
    financial: {
      binder_amount: number;
      deposit_amount: number;
      refund_amount: number;
    };
    canonical_financial: {
      binder_amount: number;
      deposit_amount: number;
      refund_amount: number;
    };
    financial_difference: {
      binder_amount: number;
      deposit_amount: number;
      refund_amount: number;
    };
  };
};

export function buildBestRelocationApplicationPlan(input: {
  data: ParsedWorkbookData;
  trigger: BestRelocationApplicationPlan["trigger"];
  cutoff: Date;
  sourceReadThrough: Date;
  unchangedEvidence?: ReadonlySet<string>;
}): { plan: BestRelocationApplicationPlan; checksum: string } {
  const windowedData: ParsedWorkbookData = {
    ...input.data,
    refunds: input.data.refunds.filter(
      (row) =>
        !row.timestamp ||
        isWithinIngestionWindow(
          new Date(row.timestamp),
          input.cutoff,
          input.sourceReadThrough,
        ),
    ),
  };
  const observations = authoritativeObservations(windowedData);
  assertUniqueSourceIdentities(observations);
  const initiallyInvalid = observations
    .map((row) => ({ row, reason: invalidReason(row) }))
    .filter(
      (entry): entry is { row: AuthoritativeObservation; reason: string } =>
        Boolean(entry.reason),
    );
  const invalidBookingJobs = new Set(
    initiallyInvalid
      .filter((entry) => entry.row.source_tab === "Booked Deals")
      .map((entry) => stableSourceRowId(entry.row)),
  );
  const invalidByIdentity = new Map(
    initiallyInvalid.map((entry) => [
      `${datasetKeyFor(entry.row)}:${stableSourceRowId(entry.row)}`,
      entry,
    ]),
  );
  for (const row of observations) {
    if (
      row.source_tab === "Booked Deals" &&
      invalidBookingJobs.has(stableSourceRowId(row))
    ) {
      invalidByIdentity.set(`booked_deals:${stableSourceRowId(row)}`, {
        row,
        reason: "booking_group_contains_invalid_row",
      });
    }
  }
  const invalid = [...invalidByIdentity.values()];
  const invalidKeys = new Set(
    invalid.map((entry) => provenanceKey(entry.row.provenance)),
  );
  const validData: ParsedWorkbookData = {
    ...windowedData,
    forms: windowedData.forms.filter(
      (row) => !invalidKeys.has(provenanceKey(row.provenance)),
    ),
    localForms: windowedData.localForms.filter(
      (row) => !invalidKeys.has(provenanceKey(row.provenance)),
    ),
    calls: windowedData.calls.filter(
      (row) => !invalidKeys.has(provenanceKey(row.provenance)),
    ),
    booked: windowedData.booked.filter(
      (row) =>
        !invalidKeys.has(provenanceKey(row.provenance)) &&
        !invalidBookingJobs.has(stableSourceRowId(row)),
    ),
    refunds: windowedData.refunds.filter(
      (row) => !invalidKeys.has(provenanceKey(row.provenance)),
    ),
  };
  const legacy = buildIngestPlan(validData, {
    threshold: AUTO_LINK_THRESHOLD,
    baseUrl: "https://vantage-movers-main-server.vercel.app",
  });
  const byProvenance = new Map(
    authoritativeObservations(validData).map((row) => [
      provenanceKey(row.provenance),
      row,
    ]),
  );
  const mappedActions = legacy.mutations.map((mutation) =>
    mapMutation(mutation, byProvenance, input.unchangedEvidence),
  );
  const actionKeyMap = new Map(
    legacy.mutations.map((mutation, index) => [
      mutation.idempotency_key,
      mappedActions[index].action_key,
    ]),
  );
  const actions: BestRelocationPlanAction[] = mappedActions.map((action) => ({
    ...action,
    depends_on: action.depends_on.map(
      (dependency) => actionKeyMap.get(dependency) ?? dependency,
    ),
    ...(action.classification === "leadless_booking"
      ? leadlessMatchingEvidence(action, legacy.unmatched_booking_jobs)
      : {}),
  }));
  actions.push(
    ...invalid.map(({ row, reason }) => invalidRowAction(row, reason)),
  );
  const refundMatchesByProvenance = new Map(
    matchRefundsToBookings(validData.refunds, validData.booked).matches.map(
      (match) => [provenanceKey(match.refund.provenance), match],
    ),
  );
  for (const refund of selectBestRelocationRefundObservations(
    validData.refunds,
    validData.booked,
  ).filter(
    (row) =>
      !legacy.mutations.some(
        (mutation) =>
          mutation.action === "create_cancelled_lead" &&
          provenanceRows(mutation.sheet).some(
            (source) => provenanceKey(source) === provenanceKey(row.provenance),
          ),
      ),
  )) {
    const action = conflictAction(
      refund,
      "refunds",
      "unmatched_refund",
      "blocking",
    );
    const match = refundMatchesByProvenance.get(
      provenanceKey(refund.provenance),
    );
    if (match) {
      action.matching = {
        method: match.method,
        score: match.confidence,
        calibration_version: MATCH_CALIBRATION_VERSION,
        evidence: [
          provenanceKey(refund.provenance),
          provenanceKey(match.booking.provenance),
        ],
      };
    }
    actions.push(action);
  }
  for (const action of actions.filter(
    (candidate) => candidate.classification === "leadless_booking",
  )) {
    actions.push({
      ...action,
      action_key: `${action.action_key}:reconciliation`,
      command: "record_conflict",
      classification: "conflict",
      depends_on: [action.action_key],
      conflict: { type: "ambiguous_lead_match", severity: "warning" },
    });
  }
  const ordered = orderActions(actions);
  const counters = countClassifications(ordered);
  const plan: BestRelocationApplicationPlan = {
    adapter_key: BEST_RELOCATION_ADAPTER_KEY,
    schema_version: BEST_RELOCATION_SCHEMA_VERSION,
    trigger: input.trigger,
    cutoff: input.cutoff.toISOString(),
    timezone: "America/New_York",
    source_read_through: input.sourceReadThrough.toISOString(),
    source_snapshot: {
      leads: windowedData.leadsWorkbook,
      booked: windowedData.bookedWorkbook,
    },
    calibration_version: MATCH_CALIBRATION_VERSION,
    actions: ordered,
    counters,
    warnings: legacy.warnings.filter(
      (warning) => !warning.includes("production endpoints"),
    ),
  };
  return {
    plan,
    checksum: computeChecksum({
      checksum_version: 1,
      artifact_kind: "ingestion_plan",
      schema_version: BEST_RELOCATION_SCHEMA_VERSION,
      payload: plan,
    }),
  };
}

function mapMutation(
  mutation: PlannedMutation,
  byProvenance: Map<string, AuthoritativeObservation>,
  unchangedEvidence?: ReadonlySet<string>,
): BestRelocationPlanAction {
  const sourceRows = provenanceRows(mutation.sheet);
  const primary = byProvenance.get(provenanceKey(sourceRows[0]));
  if (!primary) {
    throw new Error(`No authoritative observation for ${mutation.idempotency_key}`);
  }
  const datasetKey = datasetKeyFor(primary);
  const sourceId = stableSourceRowId(primary);
  const sourceValues = sourceOwnedValuesForMutation(mutation);
  const contentHash = sourceOwnedContentHash(
    primary,
    sourceValues,
    BEST_RELOCATION_SCHEMA_VERSION,
  );
  const evidenceKey = `${datasetKey}:${sourceId}:${contentHash}`;
  const unchanged = unchangedEvidence?.has(evidenceKey) ?? false;
  const commandPayload = canonicalCommandPayload(mutation);
  if (mutation.action === "create_cancelled_lead") {
    commandPayload.notes = `Imported from Best Relocation Refunds (${sourceId}).`;
  }
  return {
    action_key: `${mutation.action}:${datasetKey}:${sourceId}`,
    command: unchanged ? "unchanged" : mutation.action,
    classification: unchanged
      ? "unchanged"
      : mutation.action === "create_leadless_booking"
        ? "leadless_booking"
        : "create",
    dataset_key: datasetKey,
    stable_source_row_id: sourceId,
    content_hash: contentHash,
    schema_profile: `${datasetKey}:v${BEST_RELOCATION_SCHEMA_VERSION}`,
    schema_version: BEST_RELOCATION_SCHEMA_VERSION,
    provenance: mutation.sheet,
    ...(unchanged ? {} : { command_payload: commandPayload }),
    source_owned_values: sourceValues,
    depends_on: mutation.depends_on ?? [],
    ...(mutation.match_method
      ? {
          matching: {
            method: mutation.match_method,
            score: mutation.confidence,
            calibration_version: MATCH_CALIBRATION_VERSION,
            evidence: sourceRows.map(provenanceKey),
          },
        }
      : {}),
  };
}

function canonicalCommandPayload(
  mutation: PlannedMutation,
): Record<string, unknown> {
  const body = { ...mutation.api.body };
  if (mutation.action === "create_booked_from_source") {
    const agent = String(body.agent ?? "");
    const splitAgent =
      typeof body.split_agent === "string" ? body.split_agent : undefined;
    const total = Number(body.binder_amount ?? 0);
    const agents = [agent, splitAgent].filter(
      (entry): entry is string => Boolean(entry),
    );
    const allocation = total / agents.length;
    return compact({
      timestamp: body.timestamp,
      book_date: body.book_date,
      job_no: body.job_no ?? body.call_job_no,
      lead_ref: body.form_lead_id,
      lead_model: body.lead_type,
      total_binder_amount: total,
      deposit_amount: body.deposit_amount,
      merchant: body.merchant,
      source: body.source_company,
      agent_allocations: agents.map((agentName, index) => ({
        agent_name: agentName,
        binder_amount:
          index === agents.length - 1
            ? total - allocation * index
            : allocation,
      })),
    });
  }
  return body;
}

function conflictAction(
  row: AuthoritativeObservation,
  datasetKey: string,
  type: "ambiguous_lead_match" | "unmatched_refund",
  severity: "warning" | "blocking",
): BestRelocationPlanAction {
  const id = stableSourceRowId(row);
  return {
    action_key: `conflict:${datasetKey}:${id}:${type}`,
    command: "record_conflict",
    classification: "conflict",
    dataset_key: datasetKey,
    stable_source_row_id: id,
    content_hash: sourceOwnedContentHash(
      row,
      row.provenance.raw,
      BEST_RELOCATION_SCHEMA_VERSION,
    ),
    schema_profile: `${datasetKey}:v${BEST_RELOCATION_SCHEMA_VERSION}`,
    schema_version: BEST_RELOCATION_SCHEMA_VERSION,
    provenance: row.provenance,
    depends_on: [],
    conflict: { type, severity },
  };
}

function authoritativeObservations(
  data: ParsedWorkbookData,
): AuthoritativeObservation[] {
  return [
    ...data.forms,
    ...data.localForms,
    ...data.calls,
    ...data.booked.filter((row) => row.is_best_relocation_source),
    ...selectBestRelocationRefundObservations(data.refunds, data.booked),
  ];
}

function invalidReason(row: AuthoritativeObservation): string | undefined {
  if ("kind" in row && row.kind === "form") {
    if (!row.timestamp) return "missing_or_invalid_timestamp";
    if (!row.name.trim()) return "missing_name";
    if (!row.phone.trim()) return "missing_phone";
    try {
      normalizeZip(row.pickup_zip);
      normalizeZip(row.destination_zip);
      normalizeMoveSize(row.move_size);
    } catch {
      return "invalid_move_fields";
    }
    return undefined;
  }
  if ("kind" in row && row.kind === "call") {
    if (!row.timestamp) return "missing_or_invalid_timestamp";
    if (!row.phone.trim()) return "missing_phone";
    return undefined;
  }
  if (row.source_tab === "Booked Deals") {
    if (!row.timestamp || !row.book_date) {
      return "missing_or_invalid_booking_date";
    }
    if (
      !row.normalized_job_no ||
      !row.customer_name.trim() ||
      !row.agent.trim() ||
      !row.merchant.trim() ||
      row.binder_amount === undefined ||
      row.deposit_amount === undefined
    ) {
      return "missing_required_booking_value";
    }
    return undefined;
  }
  if (
    !row.timestamp ||
    !row.refund_request_date ||
    !row.normalized_job_no ||
    !row.status.trim()
  ) {
    return "missing_required_refund_value";
  }
  if (row.deposit_amount === undefined && row.binder_amount === undefined) {
    return "missing_refund_amount";
  }
  return undefined;
}

function invalidRowAction(
  row: AuthoritativeObservation,
  reason: string,
): BestRelocationPlanAction {
  const datasetKey = datasetKeyFor(row);
  const sourceId = stableSourceRowId(row);
  return {
    action_key: `invalid:${datasetKey}:${sourceId}`,
    command: "record_conflict",
    classification: "invalid",
    dataset_key: datasetKey,
    stable_source_row_id: sourceId,
    content_hash: sourceOwnedContentHash(
      row,
      { reason, raw: row.provenance.raw },
      BEST_RELOCATION_SCHEMA_VERSION,
    ),
    schema_profile: `${datasetKey}:v${BEST_RELOCATION_SCHEMA_VERSION}`,
    schema_version: BEST_RELOCATION_SCHEMA_VERSION,
    provenance: row.provenance,
    source_owned_values: row.provenance.raw,
    depends_on: [],
    conflict: { type: "schema_drift", severity: "warning" },
  };
}

function datasetKeyFor(row: AuthoritativeObservation): string {
  switch (row.source_tab) {
    case "Forms":
      return "forms";
    case "Local Forms":
      return "local_forms";
    case "Calls":
      return "calls";
    case "Booked Deals":
      return "booked_deals";
    case "Refunds":
      return "refunds";
  }
}

function provenanceRows(
  provenance: PlannedMutation["sheet"],
): SheetProvenance[] {
  return "rows" in provenance ? provenance.rows : [provenance];
}

function provenanceKey(provenance: SheetProvenance): string {
  return `${provenance.workbook_id}:${provenance.tab}:${provenance.sheet_row}`;
}

function orderActions(
  actions: BestRelocationPlanAction[],
): BestRelocationPlanAction[] {
  const rank = (action: BestRelocationPlanAction): number => {
    if (
      action.command === "create_form_lead" ||
      action.command === "create_call_lead"
    ) return 1;
    if (
      action.command === "create_booked_from_source" ||
      action.command === "create_leadless_booking"
    ) return 2;
    if (action.command === "record_conflict") return 3;
    if (action.command === "create_cancelled_lead") return 4;
    return 0;
  };
  return [...actions].sort((left, right) => rank(left) - rank(right));
}

function countClassifications(
  actions: BestRelocationPlanAction[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const action of actions) {
    counts[action.classification] = (counts[action.classification] ?? 0) + 1;
  }
  return counts;
}

function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}

function sourceOwnedValuesForMutation(
  mutation: PlannedMutation,
): Record<string, unknown> {
  const values = { ...mutation.api.body };
  for (const derived of [
    "booked_lead",
    "form_lead_id",
    "ingestion_source",
    "notes",
  ]) {
    delete values[derived];
  }
  return values;
}

function leadlessMatchingEvidence(
  action: BestRelocationPlanAction,
  unmatched: Array<{
    job_no: string;
    best_match_confidence?: number;
    best_match_method?: string;
  }>,
): Pick<BestRelocationPlanAction, "matching"> {
  const job = String(action.command_payload?.job_no ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const candidate = unmatched.find(
    (entry) =>
      entry.job_no.toUpperCase().replace(/[^A-Z0-9]/g, "") === job,
  );
  return {
    matching: {
      ...(candidate?.best_match_method
        ? { method: candidate.best_match_method }
        : {}),
      ...(candidate?.best_match_confidence !== undefined
        ? { score: candidate.best_match_confidence }
        : {}),
      calibration_version: MATCH_CALIBRATION_VERSION,
      evidence: provenanceRows(action.provenance).map(provenanceKey),
    },
  };
}
