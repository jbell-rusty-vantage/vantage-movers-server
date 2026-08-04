import assert from "node:assert/strict";
import test from "node:test";
import {
  createOperationalWorkbookRegistry,
  type OperationalWorkbookRegistration,
} from "../operationalWorkbooks/registry";
import {
  destinationSnapshotChecksum,
  validateDestinationSnapshot,
  type ValidatedReportingDestinationSnapshotV1,
} from "./destinationContract";
import {
  ownershipMarkerMatchesDestination,
  serializeReportingOwnershipMarker,
} from "./ownershipMarker";
import {
  verifyManagedTabOwnership,
  type SheetsWorkbookClient,
} from "../googleDriveOAuth/managedTab.service";
import { BadRequestError } from "../errors";
import { safeReportingDestinationForRead } from "./reportingDestinationRepository";
import { calculateWorkbookCapacity } from "./reportingDestination.service";

const registrations: OperationalWorkbookRegistration[] = [
  {
    registration_key: "master_leads",
    purpose: "operational_projection",
    env_key: "MASTER_LEADS_SHEET_ID",
    required_in_production: true,
    owner_module: "operations",
    display_label: "Master Leads",
  },
];

test("operational workbook denylist rejects registered workbook IDs", () => {
  const registry = createOperationalWorkbookRegistry({
    registrations,
    env: { MASTER_LEADS_SHEET_ID: "1OperationalWorkbookExample00001" },
    production: true,
  });
  const result = registry.evaluateReportingDestination(
    "1OperationalWorkbookExample00001",
  );
  assert.equal(result.allowed, false);
  if (!result.allowed) {
    assert.equal(result.code, "OPERATIONAL_WORKBOOK");
  }
});

test("operational workbook denylist fails closed when configuration is incomplete", () => {
  const registry = createOperationalWorkbookRegistry({
    registrations,
    env: {},
    production: true,
  });
  const result = registry.evaluateReportingDestination(
    "1SafeWorkbookExample000000000001",
  );
  assert.equal(result.allowed, false);
  if (!result.allowed) {
    assert.equal(result.code, "DENYLIST_INCOMPLETE");
  }
});

test("managed tab verification rejects human-created name collisions", async () => {
  const client: SheetsWorkbookClient = {
    async listSheets() {
      return [
        { sheetId: 100, title: "Report" },
        { sheetId: 200, title: "Report" },
      ];
    },
    async readCell() {
      return serializeReportingOwnershipMarker("64b000000000000000000099");
    },
    async createManagedTab() {
      throw new Error("not used");
    },
    async renameManagedTab() {
      throw new Error("not used");
    },
  };

  await assert.rejects(
    () =>
      verifyManagedTabOwnership({
        spreadsheetId: "sheet-1",
        destinationId: "64b000000000000000000099",
        immutableSheetId: 100,
        tabName: "Report",
        client,
      }),
    (error: unknown) =>
      error instanceof BadRequestError &&
      /human-created tab already uses the managed tab name/.test(error.message),
  );
});

test("managed tab verification rejects tabs without a Vantage ownership marker", async () => {
  const client: SheetsWorkbookClient = {
    async listSheets() {
      return [{ sheetId: 100, title: "Report" }];
    },
    async readCell() {
      return "not-a-vantage-marker";
    },
    async createManagedTab() {
      throw new Error("not used");
    },
    async renameManagedTab() {
      throw new Error("not used");
    },
  };

  await assert.rejects(
    () =>
      verifyManagedTabOwnership({
        spreadsheetId: "sheet-1",
        destinationId: "64b000000000000000000099",
        immutableSheetId: 100,
        tabName: "Report",
        client,
      }),
    (error: unknown) =>
      error instanceof BadRequestError &&
      /not a Vantage-managed reporting tab/.test(error.message),
  );
});

test("managed tab verification accepts a matching Vantage marker", async () => {
  const destinationId = "64b000000000000000000099";
  const marker = serializeReportingOwnershipMarker(destinationId);
  assert.equal(ownershipMarkerMatchesDestination(marker, destinationId), true);

  const client: SheetsWorkbookClient = {
    async listSheets() {
      return [{ sheetId: 100, title: "Report" }];
    },
    async readCell() {
      return marker;
    },
    async createManagedTab() {
      throw new Error("not used");
    },
    async renameManagedTab() {
      throw new Error("not used");
    },
  };

  const result = await verifyManagedTabOwnership({
    spreadsheetId: "sheet-1",
    destinationId,
    immutableSheetId: 100,
    tabName: "Report",
    client,
  });
  assert.deepEqual(result, { humanCreatedTabTakeover: false });
});

function snapshot(
  overrides: Partial<ValidatedReportingDestinationSnapshotV1> = {},
): ValidatedReportingDestinationSnapshotV1 {
  const payload = {
    contractVersion: 1 as const,
    destinationId: "64b000000000000000000099",
    provider: "google_sheets" as const,
    driveConnectionId: "64b000000000000000000001",
    ownerIdentitySnapshot: {
      stableOwnerId: "owner",
      maskedEmail: "o***@example.com",
    },
    folder: {
      id: "1FolderIdExample00000000000001",
      name: "Reports",
      url: "https://example.test/folder",
    },
    strategy: "replace_tab" as const,
    workbook: {
      id: "1WorkbookIdExample000000000001",
      name: "Workbook",
      url: "https://example.test/workbook",
    },
    managedTab: {
      immutableSheetId: 100,
      name: "Report",
      managed: true as const,
    },
    destinationType: "owner_drive",
    ownershipPolicy: "vantage_managed_tab",
    accessStatus: "verified" as const,
    healthVerifiedAt: new Date().toISOString(),
    archived: false as const,
    safety: {
      denylistCheckedAt: new Date().toISOString(),
      operationalWorkbookMatch: false as const,
      humanCreatedTabTakeover: false as const,
    },
    capacity: {
      providerMaxCells: 10_000_000,
      destinationAvailableCells: 10_000_000,
    },
  };
  const merged = {
    ...payload,
    ...overrides,
    safety: {
      ...payload.safety,
      ...(overrides.safety ?? {}),
    },
  };
  return {
    ...merged,
    snapshotChecksum: destinationSnapshotChecksum(merged),
  };
}

test("destination snapshot validation rejects operational workbook matches", () => {
  const unsafe = snapshot({
    safety: {
      denylistCheckedAt: new Date().toISOString(),
      operationalWorkbookMatch: true as false,
      humanCreatedTabTakeover: false as const,
    },
  });
  assert.throws(
    () =>
      validateDestinationSnapshot(unsafe, {
        destinationId: unsafe.destinationId,
        checksum: unsafe.snapshotChecksum,
        strategy: "replace_tab",
      }),
    /Destination safety validation failed/,
  );
});

test("managed tab rename preserves immutable sheet ID and revalidates ownership", async () => {
  const destinationId = "64b000000000000000000099";
  const marker = serializeReportingOwnershipMarker(destinationId);
  let title = "Report";
  const client: SheetsWorkbookClient = {
    async listSheets() {
      return [{ sheetId: 100, title }];
    },
    async readCell(_spreadsheetId, range) {
      return range.startsWith("Renamed") ? marker : marker;
    },
    async createManagedTab() {
      throw new Error("rename must not create a tab");
    },
    async renameManagedTab(input) {
      title = input.nextTabName;
      await verifyManagedTabOwnership({
        spreadsheetId: input.spreadsheetId,
        destinationId: input.destinationId,
        immutableSheetId: input.immutableSheetId,
        tabName: title,
        client: this,
      });
      return {
        immutableSheetId: input.immutableSheetId,
        name: title,
      };
    },
  };

  const renamed = await client.renameManagedTab({
    spreadsheetId: "sheet-1",
    destinationId,
    immutableSheetId: 100,
    currentTabName: "Report",
    nextTabName: "Renamed Report",
  });
  assert.equal(renamed.immutableSheetId, 100);
  assert.equal(renamed.name, "Renamed Report");
});

test("destination read projection omits connection and actor credentials", () => {
  const safe = safeReportingDestinationForRead({
    _id: "64b000000000000000000099",
    provider: "google_sheets",
    drive_connection_id: "64b000000000000000000001",
    owner_identity_snapshot: {
      stable_owner_id: "owner",
      masked_email: "o***@example.com",
    },
    folder: { id: "folder", name: "Reports", url: "https://example.test/folder" },
    strategy: "snapshot",
    destination_type: "owner_drive",
    ownership_policy: "vantage_managed_tab",
    access_status: "verified",
    health_verified_at: new Date(),
    denylist_checked_at: new Date(),
    capacity: {
      provider_max_cells: 10_000_000,
      destination_available_cells: 10_000_000,
    },
    state: "active",
    version: 1,
    created_by: { actor_id: "owner", refresh_token: "secret" },
    updated_by: { actor_id: "owner" },
  });
  assert.equal("drive_connection_id" in safe, false);
  assert.equal("created_by" in safe, false);
  assert.equal("updated_by" in safe, false);
  assert.equal(safe.owner_identity_snapshot, safe.owner_identity_snapshot);
});

test("destination snapshot validation rejects stale health timestamps", () => {
  const stale = snapshot({
    healthVerifiedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    safety: {
      denylistCheckedAt: new Date().toISOString(),
      operationalWorkbookMatch: false as const,
      humanCreatedTabTakeover: false as const,
    },
  });
  assert.throws(
    () =>
      validateDestinationSnapshot(stale, {
        destinationId: stale.destinationId,
        checksum: stale.snapshotChecksum,
        strategy: "replace_tab",
      }),
    /stale/,
  );
});

test("replace-tab capacity subtracts every existing workbook grid", async () => {
  const capacity = await calculateWorkbookCapacity("workbook", {
    async listSheets() {
      return [
        { sheetId: 1, title: "Published", rowCount: 1_000, columnCount: 26 },
        { sheetId: 2, title: "Human", rowCount: 100, columnCount: 10 },
      ];
    },
  } as unknown as SheetsWorkbookClient);
  assert.deepEqual(capacity, {
    provider_max_cells: 10_000_000,
    destination_available_cells: 9_973_000,
  });
});

test("replace-tab capacity fails closed without grid metadata", async () => {
  await assert.rejects(
    () =>
      calculateWorkbookCapacity("workbook", {
        async listSheets() {
          return [{ sheetId: 1, title: "Published" }];
        },
      } as unknown as SheetsWorkbookClient),
    /capacity metadata is unavailable/,
  );
});
