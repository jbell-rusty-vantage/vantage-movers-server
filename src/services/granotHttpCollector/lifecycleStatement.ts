import { assertChannelOperationId } from "../../models/granotLifecycleSchemas";
import {
  parseGranotCityState,
  parseGranotZip,
} from "../../utils/location/granotLocation";
import { resolveForbiddenCredentialKey } from "../granotLifecycle/receiptEvidence";
import type { GranotApplyItem } from "../granotLifecycle/applyItem";
import type { ChannelOperationKind } from "../granotLifecycle/types";
import { GranotRunConflict } from "./errors";
import type { GranotReportRow, GranotSourceCollection } from "./index";

export type GranotTableSection = "bookedJobs" | "followUpEstimates";

export type GranotAutomationLifecycleApply = GranotApplyItem;

export type SealableAutomationAction = {
  action_id: string;
  table_section?: GranotTableSection;
  operation?: "enrichment" | "booked_reconciliation";
  classification?: string;
  syncable?: boolean;
  lead_id?: string;
  source_label?: string;
  row_id?: string;
  row?: Record<string, unknown>;
  target_binding?: { call_lead_id?: string | null };
  lifecycle_apply?: GranotAutomationLifecycleApply;
};

export type SealableAutomationPlan = {
  kind: "form_leads" | "call_leads";
  schema_version: number;
  actions: SealableAutomationAction[];
  counters: Record<string, number>;
};

const CREDENTIAL_LIKE_KEY = /authorization|cookie|password|secret|token|api[_-]?key/i;
const CONTROL_OR_BIDI = /[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/;
const STATEMENT_KEY_MAX = 64;
const STATEMENT_VALUE_MAX = 300;

const RAW_PASSTHROUGH_KEYS = [
  "job_no",
  "ref_no",
  "phone",
  "email",
  "user",
  "rep",
  "prior",
  "customer",
  "from",
  "from_zip",
  "to",
  "to_zip",
  "est_cf",
  "type",
  "move_date",
  "service",
  "service_type",
  "size",
  "move_size",
  "estimate",
  "payment",
  "balance",
  "book_date",
] as const;

export function buildAutomationOperationId(
  runId: string,
  actionId: string,
): string {
  return `${runId}:${actionId}`;
}

export function assertSafeAutomationOperationId(operationId: string): void {
  try {
    assertChannelOperationId(operationId, "granot_http_automation");
  } catch (error) {
    throw new GranotRunConflict(
      "UNSAFE_OPERATION_ID",
      error instanceof Error
        ? error.message
        : "Automation operation identity is unsafe or exceeds 300 characters.",
    );
  }
}

export function buildGranotStatementFromCollectedRow(input: {
  row: GranotReportRow | { values: Record<string, string | number | null | undefined> };
  sourceLabel: string;
  section: GranotTableSection;
}): Record<string, string | number | null> {
  const statement: Record<string, string | number | null> = {};
  const values = input.row.values ?? {};

  for (const key of RAW_PASSTHROUGH_KEYS) {
    assignStatementValue(statement, key, values[key]);
  }
  for (const [key, value] of Object.entries(values)) {
    if (key in statement) continue;
    assignStatementValue(statement, key, value);
  }

  const source = scalarText(values.source) || input.sourceLabel;
  assignStatementValue(statement, "source", source);
  assignStatementValue(statement, "priority", values.prior ?? values.priority);
  assignStatementValue(statement, "customer_name", values.customer ?? values.customer_name);

  const origin = parseGranotCityState(scalarText(values.from));
  if (origin) {
    assignStatementValue(statement, "from_city", origin.city);
    assignStatementValue(statement, "from_state", origin.state);
  }
  const originZip = parseGranotZip(scalarText(values.from_zip)) ?? scalarText(values.from_zip);
  assignStatementValue(statement, "from_zip", originZip);

  const destination = parseGranotCityState(scalarText(values.to));
  if (destination) {
    assignStatementValue(statement, "to_city", destination.city);
    assignStatementValue(statement, "to_state", destination.state);
  }
  const destinationZip = parseGranotZip(scalarText(values.to_zip)) ?? scalarText(values.to_zip);
  assignStatementValue(statement, "to_zip", destinationZip);

  if (input.section === "bookedJobs") {
    statement.event_type = "Booked";
  }

  delete statement.granot_crm_username;
  return statement;
}

export function resolveAutomationOperationKind(
  section: GranotTableSection,
): ChannelOperationKind {
  return section === "bookedJobs" ? "booking_action_apply" : "lead_snapshot_apply";
}

export function buildLifecycleApply(input: {
  runId: string;
  actionId: string;
  row: GranotReportRow | { values: Record<string, string | number | null | undefined> };
  sourceLabel: string;
  section: GranotTableSection;
  expectedTarget?: GranotAutomationLifecycleApply["expected_target"];
}): GranotAutomationLifecycleApply {
  const operation_id = buildAutomationOperationId(input.runId, input.actionId);
  assertSafeAutomationOperationId(operation_id);
  const granot_statement = buildGranotStatementFromCollectedRow({
    row: input.row,
    sourceLabel: input.sourceLabel,
    section: input.section,
  });
  return {
    operation_id,
    operation_kind: resolveAutomationOperationKind(input.section),
    granot_statement,
    ...(input.expectedTarget ? { expected_target: input.expectedTarget } : {}),
  };
}

export function sealAutomationPlan<T extends SealableAutomationPlan>(
  plan: T,
  runId: string,
  sources: GranotSourceCollection[],
): T {
  const actions = plan.actions.map((action) => {
    const collected = findCollectedRow(sources, action, plan.kind);
    if (!collected) {
      throw new GranotRunConflict(
        "RUN_REPLAN_REQUIRED",
        "Immutable plan is missing the collected Granot row required for a lifecycle statement.",
      );
    }
    return {
      ...action,
      table_section: collected.section,
      lifecycle_apply: buildLifecycleApply({
        runId,
        actionId: action.action_id,
        row: collected.row,
        sourceLabel: collected.sourceLabel,
        section: collected.section,
        expectedTarget: expectedTargetFor(action, plan.kind),
      }),
    };
  });
  return {
    ...plan,
    schema_version: 2,
    actions,
  };
}

export function isSealedAutomationPlan(plan: SealableAutomationPlan): boolean {
  if (plan.schema_version !== 2) return false;
  return plan.actions.every(
    (action) =>
      action.lifecycle_apply != null &&
      action.lifecycle_apply.operation_id ===
        buildAutomationOperationId(
          action.lifecycle_apply.operation_id.slice(
            0,
            action.lifecycle_apply.operation_id.indexOf(":"),
          ),
          action.action_id,
        ) &&
      typeof action.lifecycle_apply.operation_kind === "string" &&
      action.lifecycle_apply.granot_statement != null &&
      typeof action.lifecycle_apply.granot_statement === "object",
  );
}

export function assertSealedAutomationPlan(plan: SealableAutomationPlan): void {
  if (plan.schema_version !== 2 || !isSealedAutomationPlan(plan)) {
    throw new GranotRunConflict(
      "RUN_REPLAN_REQUIRED",
      "Schema-v1 automation plans cannot be reconstructed; collect and approve a schema-v2 plan.",
    );
  }
}

export function isPendingAutomationActionOutcome(outcome: string): boolean {
  return outcome === "accepted_for_processing" || outcome === "pending_match";
}

export function isTerminalAutomationActionOutcome(outcome: string): boolean {
  return !isPendingAutomationActionOutcome(outcome);
}

export function automationRunCompletionStatus(
  receipts: Array<{ action_id?: string; outcome?: string }>,
  selectedActionIds: string[],
): "applying" | "completed" | "completed_with_errors" {
  const byAction = new Map(
    receipts
      .filter((receipt) => typeof receipt.action_id === "string")
      .map((receipt) => [receipt.action_id as string, receipt.outcome ?? ""]),
  );
  let hasError = false;
  for (const actionId of selectedActionIds) {
    const outcome = byAction.get(actionId);
    if (!outcome || isPendingAutomationActionOutcome(outcome)) {
      return "applying";
    }
    if (outcome === "technical_failure") {
      hasError = true;
    }
  }
  return hasError ? "completed_with_errors" : "completed";
}

function expectedTargetFor(
  action: SealableAutomationAction,
  kind: SealableAutomationPlan["kind"],
): GranotAutomationLifecycleApply["expected_target"] | undefined {
  if (kind === "form_leads" && typeof action.lead_id === "string" && action.lead_id) {
    return { model: "FormLead", id: action.lead_id };
  }
  const callLeadId = action.target_binding?.call_lead_id;
  if (kind === "call_leads" && typeof callLeadId === "string" && callLeadId) {
    return { model: "CallLead", id: callLeadId };
  }
  return undefined;
}

function findCollectedRow(
  sources: GranotSourceCollection[],
  action: SealableAutomationAction,
  kind: SealableAutomationPlan["kind"],
): { row: GranotReportRow; sourceLabel: string; section: GranotTableSection } | null {
  if (kind === "form_leads") {
    const source = sources.find((entry) => entry.sourceLabel === action.source_label);
    if (!source || !action.row_id) return null;
    const section =
      action.table_section ?? inferFormSection(source, action.row_id);
    const row = source.sections[section].find((entry) => entry.id === action.row_id);
    return row
      ? { row, sourceLabel: source.sourceLabel, section }
      : null;
  }

  const section: GranotTableSection =
    action.operation === "booked_reconciliation" ||
    action.table_section === "bookedJobs"
      ? "bookedJobs"
      : "followUpEstimates";
  const mappedRowId =
    typeof action.row?.row_id === "string" ? action.row.row_id : "";
  for (const source of sources) {
    const row = source.sections[section].find(
      (entry) => `${source.sourceLabel}:${entry.id}` === mappedRowId,
    );
    if (row) {
      return { row, sourceLabel: source.sourceLabel, section };
    }
  }
  return null;
}

function inferFormSection(
  source: GranotSourceCollection,
  rowId: string,
): GranotTableSection {
  if (source.sections.bookedJobs.some((row) => row.id === rowId)) {
    return "bookedJobs";
  }
  return "followUpEstimates";
}

function assignStatementValue(
  statement: Record<string, string | number | null>,
  key: string,
  value: unknown,
): void {
  if (!key || key.length > STATEMENT_KEY_MAX) return;
  if (isUnsafeStatementKey(key)) return;
  if (value === undefined) return;
  if (value === null) {
    statement[key] = null;
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return;
    statement[key] = Object.is(value, -0) ? 0 : value;
    return;
  }
  if (typeof value !== "string") return;
  if (CONTROL_OR_BIDI.test(value) || value.length > STATEMENT_VALUE_MAX) return;
  statement[key] = value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function isUnsafeStatementKey(key: string): boolean {
  return (
    resolveForbiddenCredentialKey(key) !== undefined ||
    CREDENTIAL_LIKE_KEY.test(key)
  );
}

function scalarText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  return trimmed || undefined;
}
