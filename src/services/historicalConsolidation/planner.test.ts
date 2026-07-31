import assert from "node:assert/strict";
import test from "node:test";
import { planHistoricalConsolidation } from "./planner";
import { sha256 } from "./stableJson";
import type { HistoricalSnapshot } from "./types";

test("planner produces a schema-valid deterministic manifest for a new source and form lead", () => {
  const headers = ["Time Stamp", "Name", "Pickup Zip", "Destination Zip", "Move Size", "Move Date", "Phone", "Lead ID", "Ref No", "Booked", ">2K", ">4K"];
  const values = ["7/30/2025 10:00 AM", "Jane Doe", "10001", "33101", "2 Bedrooms", "8/15/2025", "212-555-0100", "L-1", "R-1", "", "", ""];
  const bookedHeaders = ["Timestamp", "Agent", "Book Date", "Job Number:", "Customer Name", "Binder Amount", "Deposit Amount", "Merchant", "Lead Source", "LID", "Payment Notes"];
  const bookedValues = ["7/31/2025 9:00 AM", "Alice", "8/1/2025", "JOB-1", "Jane Doe", "$100.00", "$500.00", "Elavon", "Fixture Forms", "L-1", "paid"];
  const refundHeaders = ["Refund Request Date", "Status", "Timestamp", "Agent", "Book Date", "Job Number:", "Customer Name", "Binder Amount", "Deposit Amount", "Merchant", "Lead Source"];
  const refundValues = ["8/2/2025", "Cancelled", "8/2/2025 11:00 AM", "Alice", "8/1/2025", "JOB-1", "Jane Doe", "$100.00", "$500.00", "Elavon", "Fixture Forms"];
  const emptyCollections = {};
  const snapshotBody = {
    schema_version: "1.0.0" as const,
    stage_run_id: "stage-fixture",
    created_at: "2026-07-31T12:00:00.000Z",
    inventory_checksum: "inventory-fixture",
    sheets: [{ workbook_key: "fixture", spreadsheet_id: "sheet-fixture", spreadsheet_title: "Fixture", version_before: "v1", version_after: "v1", tabs: [
      { tab_id: 1, tab_name: "Forms", kind: "form" as const, source_company: "fixture_source", source_granularity_key: "fixture_source_form", header_row: 1, headers, range: "Forms!A1:L2", row_count: 2, column_count: headers.length, rows: [{ physical_row: 2, formatted: values, unformatted: values, formulas: values.map(() => ""), formats: values.map(() => null), row_checksum: "row-fixture" }] },
      { tab_id: 2, tab_name: "Booked Deals", kind: "booked" as const, source_company: null, source_granularity_key: null, header_row: 1, headers: bookedHeaders, range: "Booked Deals!A1:K2", row_count: 2, column_count: bookedHeaders.length, rows: [{ physical_row: 2, formatted: bookedValues, unformatted: bookedValues, formulas: bookedValues.map(() => ""), formats: bookedValues.map(() => null), row_checksum: "booking-fixture" }] },
      { tab_id: 3, tab_name: "Refunds", kind: "refund" as const, source_company: null, source_granularity_key: null, header_row: 1, headers: refundHeaders, range: "Refunds!A1:K2", row_count: 2, column_count: refundHeaders.length, rows: [{ physical_row: 2, formatted: refundValues, unformatted: refundValues, formulas: refundValues.map(() => ""), formats: refundValues.map(() => null), row_checksum: "refund-fixture" }] },
    ] }],
    mongo: [
      { database: "vantagemovershistorical" as const, fingerprint: "historical-cluster", collections: emptyCollections },
      { database: "vantagemovers" as const, fingerprint: "production-cluster", collections: emptyCollections },
    ],
  };
  const snapshot: HistoricalSnapshot = { ...snapshotBody, snapshot_hash: sha256(snapshotBody) };
  const input = { snapshot, decisions: { schema_version: "1.0.0" as const, decisions: [] }, mappings: { source_mappings: { mappings: { "Fixture Forms": { source_company: "fixture_source", source_granularity_key: "fixture_source_form" } } }, aliases: { merchant_aliases: {}, agent_aliases: {} }, field_matrix_hash: "field-matrix" }, planning_timestamp: "2026-07-31T12:00:00.000Z", git_sha: "fixture-sha", actor: { actor_id: "owner-id", actor_label: "owner@example.com", actor_role: "owner" as const } };

  const first = planHistoricalConsolidation(input);
  const second = planHistoricalConsolidation(input);

  assert.equal(first.manifest.manifest_hash, second.manifest.manifest_hash);
  assert.equal(first.conflicts.length, 0);
  assert.equal(first.manifest.operations.filter((entry) => entry.model === "FormLead").length, 1);
  assert.equal(first.manifest.operations.filter((entry) => entry.model === "BookedLead").length, 1);
  assert.equal(first.manifest.operations.filter((entry) => entry.model === "CancelledLead").length, 1);
  assert.equal(first.manifest.operations.filter((entry) => entry.model === "OperationsRegistryChange").length, 4);
  assert.equal(first.manifest.operations.some((entry) => entry.document?.sheet_sync !== undefined && JSON.stringify(entry.document.sheet_sync) !== "[]"), false);
});
