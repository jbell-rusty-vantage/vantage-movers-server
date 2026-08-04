import { randomUUID } from "node:crypto";
import { canonicalJson, computeChecksum } from "../durableWork";
import { normalizeJobNo } from "./parsing";
import type {
  ParsedBookedDeal,
  ParsedCallLead,
  ParsedFormLead,
  ParsedRefund,
  SheetRow,
} from "./types";

export const MANAGED_ID_HEADER = "vantage_ingestion_id";
const MANAGED_ID_ALIASES = [
  MANAGED_ID_HEADER,
  "Vantage Ingestion ID",
  "vantage ingestion id",
] as const;

export type AuthoritativeObservation =
  | ParsedFormLead
  | ParsedCallLead
  | ParsedBookedDeal
  | ParsedRefund;

export function managedId(raw: SheetRow): string | undefined {
  for (const alias of MANAGED_ID_ALIASES) {
    const value = raw[alias]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function stableSourceRowId(row: AuthoritativeObservation): string {
  if ("kind" in row && row.kind === "form") {
    const durable = row.lead_id?.trim() || row.ref_no?.trim();
    if (!durable) {
      throw new Error(
        `${row.source_tab} row ${row.sheet_row} has no durable lead identity`,
      );
    }
    return `lead:${durable.toLowerCase()}`;
  }
  if ("kind" in row && row.kind === "call") {
    return managedIdentity(row.provenance.raw, row.source_tab, row.sheet_row);
  }
  if (row.source_tab === "Booked Deals") {
    const job = row.normalized_job_no ?? normalizeJobNo(row.job_no);
    if (!job) {
      throw new Error(`Booked Deals row ${row.sheet_row} has no job number`);
    }
    return `booking:${job}`;
  }
  return managedIdentity(row.provenance.raw, row.source_tab, row.sheet_row);
}

export function sourceOwnedContentHash(
  row: AuthoritativeObservation,
  sourceOwnedValues: Record<string, unknown>,
  schemaVersion: number,
): string {
  return computeChecksum({
    checksum_version: 1,
    artifact_kind: "ingestion_plan",
    schema_version: schemaVersion,
    payload: {
      stable_source_row_id: stableSourceRowId(row),
      source_owned_values: sourceOwnedValues,
    },
  });
}

export function assertUniqueSourceIdentities(
  rows: readonly AuthoritativeObservation[],
): void {
  const seen = new Map<string, AuthoritativeObservation>();
  for (const row of rows) {
    const id = stableSourceRowId(row);
    const prior = seen.get(id);
    if (prior) {
      if (
        prior.source_tab === "Booked Deals" &&
        row.source_tab === "Booked Deals"
      ) {
        continue;
      }
      throw new Error(
        `Duplicate source identity ${id} at ${prior.source_tab} row ${prior.sheet_row} and ${row.source_tab} row ${row.sheet_row}`,
      );
    }
    seen.set(id, row);
  }
}

export function newManagedIngestionId(): string {
  return `vantage:${randomUUID()}`;
}

export function isValidManagedIngestionId(value: string): boolean {
  return /^vantage:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim(),
  );
}

export function canonicalSourceValues(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return JSON.parse(canonicalJson(value)) as Record<string, unknown>;
}

function managedIdentity(
  raw: SheetRow,
  tab: string,
  rowNumber: number,
): string {
  const value = managedId(raw);
  if (!value || !/^vantage:[0-9a-f-]{36}$/i.test(value)) {
    throw new Error(
      `${tab} row ${rowNumber} requires a valid ${MANAGED_ID_HEADER}`,
    );
  }
  return value.toLowerCase();
}
