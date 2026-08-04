import assert from "node:assert/strict";
import test from "node:test";
import {
  OperationalWorkbookConfigurationError,
  composeOperationalWorkbookRegistrations,
  createOperationalWorkbookRegistry,
  maskSpreadsheetId,
  normalizeSpreadsheetId,
  type OperationalWorkbookRegistration,
} from "./registry";
import {
  BEST_RELOCATION_INGESTION_WORKBOOK_REGISTRATIONS,
  CURRENT_OPERATIONAL_WORKBOOK_REGISTRATIONS,
} from "./registrations";

const masterId = "1MasterWorkbookIdentifier_1234567890";
const sourceId = "1SourceWorkbookIdentifier_1234567890";

const registrations: OperationalWorkbookRegistration[] = [
  {
    registration_key: "master",
    purpose: "sheet_sync_target",
    env_key: "MASTER_ID",
    required_in_production: true,
    owner_module: "sheet_sync",
    display_label: "Master",
  },
  {
    registration_key: "source",
    purpose: "ingestion_source",
    env_key: "SOURCE_ID",
    required_in_production: false,
    owner_module: "best_relocation_ingestion",
    display_label: "Source",
  },
];

test("registry denies exact IDs and normalized Google spreadsheet URLs", () => {
  const registry = createOperationalWorkbookRegistry({
    registrations,
    env: { MASTER_ID: ` ${masterId} `, SOURCE_ID: sourceId },
    production: true,
  });
  assert.deepEqual(registry.evaluateReportingDestination(masterId), {
    allowed: false,
    code: "OPERATIONAL_WORKBOOK",
    matched_registration_key: "master",
    safe_message:
      "This spreadsheet is reserved for an operational workflow and cannot be a reporting destination.",
  });
  assert.equal(
    registry.evaluateReportingDestination(
      `https://docs.google.com/spreadsheets/d/${sourceId}/edit#gid=0`,
    ).allowed,
    false,
  );
  assert.deepEqual(
    registry.evaluateReportingDestination(
      "1DifferentWorkbookIdentifier_1234567890",
    ),
    { allowed: true },
  );
});

test("production registry fails closed when required registration is absent", () => {
  const registry = createOperationalWorkbookRegistry({
    registrations,
    env: { SOURCE_ID: sourceId },
    production: true,
  });
  assert.throws(
    () => registry.assertConfigurationComplete(),
    OperationalWorkbookConfigurationError,
  );
  assert.equal(
    registry.evaluateReportingDestination(
      "1DifferentWorkbookIdentifier_1234567890",
    ).allowed,
    false,
  );
});

test("spreadsheet normalization is strict and masking does not expose IDs", () => {
  assert.equal(normalizeSpreadsheetId(` ${masterId} `), masterId);
  assert.equal(normalizeSpreadsheetId("not-an-id"), undefined);
  const masked = maskSpreadsheetId(masterId);
  assert.equal(masked.includes(masterId), false);
  assert.match(masked, /^1Mas…7890$/);
});

test("registration groups compose without mutable global state", () => {
  const extra: OperationalWorkbookRegistration = {
    registration_key: "best_relocation.booked",
    purpose: "ingestion_source",
    env_key: "BOOKED_ID",
    required_in_production: true,
    owner_module: "best_relocation_ingestion",
    display_label: "Booked responses",
  };
  const composed = composeOperationalWorkbookRegistrations(
    registrations,
    [extra],
  );
  assert.equal(composed.length, 3);
  assert.equal(registrations.length, 2);
});

test("Stage 2 registers both ingestion sources as production-required", () => {
  assert.deepEqual(
    BEST_RELOCATION_INGESTION_WORKBOOK_REGISTRATIONS.map((entry) => ({
      env_key: entry.env_key,
      purpose: entry.purpose,
      required: entry.required_in_production,
      owner: entry.owner_module,
    })),
    [
      {
        env_key: "BEST_RELOCATION_SYNC_SHEET_ID",
        purpose: "ingestion_source",
        required: true,
        owner: "best_relocation_ingestion",
      },
      {
        env_key: "BOOKED_DEALS_FORM_RESPONSES_SYNC_SHEET_ID",
        purpose: "ingestion_source",
        required: true,
        owner: "best_relocation_ingestion",
      },
    ],
  );
  assert.equal(
    CURRENT_OPERATIONAL_WORKBOOK_REGISTRATIONS.filter(
      (entry) => entry.owner_module === "best_relocation_ingestion",
    ).length,
    2,
  );
});
