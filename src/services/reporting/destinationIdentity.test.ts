import assert from "node:assert/strict";
import test from "node:test";
import { ReportingDestination } from "../../models/ReportingDestination";
import { ownerIdentitySnapshotFromEmail } from "./destinationIdentity";

test("ownerIdentitySnapshotFromEmail persists snake_case keys required by ReportingDestination", () => {
  const snapshot = ownerIdentitySnapshotFromEmail("Owner@Example.com");
  assert.deepEqual(Object.keys(snapshot).sort(), [
    "masked_email",
    "stable_owner_id",
  ]);
  assert.match(snapshot.stable_owner_id, /^[a-f0-9]{32}$/);
  assert.equal(typeof snapshot.masked_email, "string");
  assert.notEqual(snapshot.masked_email.toLowerCase(), "owner@example.com");
});

test("ReportingDestination rejects camelCase owner identity snapshots", () => {
  const doc = new ReportingDestination({
    provider: "google_sheets",
    drive_connection_id: "64b000000000000000000001",
    owner_identity_snapshot: {
      stableOwnerId: "abc",
      maskedEmail: "o***@example.com",
    },
    folder: {
      id: "folder-1",
      name: "Exports",
      url: "https://drive.google.com/drive/folders/folder-1",
    },
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
    created_by: { kind: "system", id: "test" },
    updated_by: { kind: "system", id: "test" },
  });

  const error = doc.validateSync();
  assert.ok(error, "expected mongoose validation failure for camelCase owner identity");
  assert.match(String(error.message), /stable_owner_id|masked_email/);
});

test("ReportingDestination accepts snake_case owner identity from helper", () => {
  const doc = new ReportingDestination({
    provider: "google_sheets",
    drive_connection_id: "64b000000000000000000001",
    owner_identity_snapshot: ownerIdentitySnapshotFromEmail("owner@example.com"),
    folder: {
      id: "folder-1",
      name: "Exports",
      url: "https://drive.google.com/drive/folders/folder-1",
    },
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
    created_by: { kind: "system", id: "test" },
    updated_by: { kind: "system", id: "test" },
  });

  assert.equal(doc.validateSync(), undefined);
});
