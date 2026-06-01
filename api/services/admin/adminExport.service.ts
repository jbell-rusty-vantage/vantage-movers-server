import { toCsv, type CsvRow } from "../../utils/csv";
import type { AdminBrowseQuery } from "../../validation/v1.validation";
import { exportAdminResourceRows } from "./adminBrowse.service";
import type { AdminResource } from "./adminScope.service";

const CSV_COLUMNS: Record<AdminResource, string[]> = {
  "form-leads": [
    "_id",
    "database_scope",
    "timestamp",
    "createdAt",
    "source_company",
    "name",
    "email",
    "phone_number",
    "ref_no",
    "pickup_state",
    "pickup_zip",
    "delivery_state",
    "delivery_zip",
    "move_size",
    "local",
    "booked",
    "cancelled",
  ],
  "call-leads": [
    "_id",
    "database_scope",
    "timestamp",
    "createdAt",
    "source_company",
    "name",
    "email",
    "phone_number",
    "job_no",
    "pickup_state",
    "pickup_zip",
    "delivery_state",
    "delivery_zip",
    "local",
    "booked",
    "cancelled",
  ],
  "booked-leads": [
    "_id",
    "database_scope",
    "book_date",
    "createdAt",
    "job_no",
    "source",
    "merchant",
    "local",
    "total_binder_amount",
    "deposit_amount",
    "agent_names",
    "customer_name",
    "cancelled",
  ],
  "cancelled-leads": [
    "_id",
    "database_scope",
    "cancel_date",
    "book_date",
    "createdAt",
    "job_no",
    "customer_name",
    "agent",
    "source",
    "merchant",
    "reason",
    "cancelled_by",
    "refund_amount",
  ],
  customers: ["_id", "database_scope", "createdAt", "full_name", "phone_number", "email"],
  agents: ["_id", "database_scope", "createdAt", "name", "normalized_name", "active", "role", "created_from"],
};

export async function exportAdminResourceCsv(
  resource: AdminResource,
  query: AdminBrowseQuery,
): Promise<{ filename: string; csv: string }> {
  const rows = await exportAdminResourceRows(resource, query);
  const columns = CSV_COLUMNS[resource];
  const csvRows = rows.map(flattenExportRow);
  return {
    filename: `${resource}-${query.database_scope}.csv`,
    csv: toCsv(csvRows, columns),
  };
}

function flattenExportRow(row: Record<string, unknown>): CsvRow {
  const agentAllocations = Array.isArray(row.agent_allocations)
    ? (row.agent_allocations as Record<string, unknown>[])
    : [];
  const customer = objectValue(row.customer);
  return {
    ...row,
    booked: idValue(row.booked),
    cancelled: idValue(row.cancelled),
    agent_names: agentAllocations
      .map((allocation) => allocation.agent_name_snapshot)
      .filter(Boolean)
      .join("; "),
    customer_name: stringValue(row.customer_name) || stringValue(row.customer_name_snapshot) || stringValue(customer?.full_name),
  };
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function idValue(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "_id" in value) {
    return String((value as { _id: unknown })._id);
  }
  return String(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
