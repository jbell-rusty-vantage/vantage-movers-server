import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestError } from "../../errors";
import {
  assertRegistryContainerBinding,
  isJanitorEligibleCleanupStatus,
  type LiveTestHarnessRunRecord,
} from "./liveTestHarnessRunRegistry";
import {
  DENYLIST_PROOF_REJECTION_CODE,
  interpretDenylistProductionRejection,
} from "./liveTestDenylistProof";
import {
  restoreExportFolderEnv,
  snapshotExportFolderEnv,
} from "./liveTestEnv";
import { SPREADSHEET_MIME_TYPE } from "../../googleDriveOAuth/driveMetadata.service";
import { validatePickerSelectionReferenceMetadata } from "../../googleDriveOAuth/picker.service";

function registryRecord(
  overrides: Partial<LiveTestHarnessRunRecord> = {},
): LiveTestHarnessRunRecord {
  return {
    run_tag: "vantage-live-test-abc123-2026-01-01T00-00-00-000Z-a1b2c3",
    export_root_folder_id: "export-root",
    container_folder_ids: ["container-a"],
    cleanup_status: "pending",
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

test("needs_janitor cleanup status remains janitor-eligible", () => {
  assert.equal(isJanitorEligibleCleanupStatus("pending"), true);
  assert.equal(isJanitorEligibleCleanupStatus("needs_janitor"), true);
  assert.equal(isJanitorEligibleCleanupStatus("completed"), false);
});

test("registry binding rejects copied-marker sibling not registered for run", () => {
  assert.throws(
    () =>
      assertRegistryContainerBinding({
        record: registryRecord({ container_folder_ids: ["container-a"] }),
        exportRootFolderId: "export-root",
        containerFolderId: "copied-marker-sibling",
      }),
    /not registered/,
  );
});

test("registry binding rejects export root mismatch", () => {
  assert.throws(
    () =>
      assertRegistryContainerBinding({
        record: registryRecord(),
        exportRootFolderId: "other-root",
        containerFolderId: "container-a",
      }),
    /export root/,
  );
});

test("denylist proof accepts only OPERATIONAL_WORKBOOK rejection code", () => {
  const accepted = interpretDenylistProductionRejection(
    new BadRequestError("Denied", {
      metadata: { code: DENYLIST_PROOF_REJECTION_CODE },
    }),
  );
  assert.equal(accepted.ok, true);
  assert.equal(accepted.rejectionCode, "OPERATIONAL_WORKBOOK");

  const incomplete = interpretDenylistProductionRejection(
    new BadRequestError("Incomplete", {
      metadata: { code: "DENYLIST_INCOMPLETE" },
    }),
  );
  assert.equal(incomplete.ok, false);
  assert.equal(incomplete.rejectionCode, "DENYLIST_INCOMPLETE");

  const other = interpretDenylistProductionRejection(
    new BadRequestError("Other", {
      metadata: { code: "INVALID_SPREADSHEET_ID" },
    }),
  );
  assert.equal(other.ok, false);
  assert.notEqual(other.rejectionCode, DENYLIST_PROOF_REJECTION_CODE);
});

test("picker parent mismatch fails before destination denylist check", () => {
  assert.throws(
    () =>
      validatePickerSelectionReferenceMetadata({
        metadata: {
          id: "1AbCdEfGhIjKlMnOpQrStUv",
          name: "Workbook",
          mimeType: SPREADSHEET_MIME_TYPE,
          trashed: false,
          url: "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUv/edit",
          parentFolderIds: ["actual-parent"],
          ownedByMe: true,
        },
        flow: "spreadsheet",
        expectedParentFolderId: "wrong-parent",
      }),
    /authorized destination folder/,
  );
});

test("export folder env snapshot restores unset variable after early throw path", () => {
  const snapshot = snapshotExportFolderEnv();
  try {
    delete process.env.GOOGLE_DRIVE_EXPORT_FOLDER_ID;
    applyThenThrow();
    assert.fail("expected throw");
  } catch {
    restoreExportFolderEnv(snapshot);
    if (snapshot.present) {
      assert.equal(process.env.GOOGLE_DRIVE_EXPORT_FOLDER_ID, snapshot.value);
    } else {
      assert.equal(process.env.GOOGLE_DRIVE_EXPORT_FOLDER_ID, undefined);
    }
  }
});

test("export folder env snapshot restores prior value when variable was set", () => {
  const saved = process.env.GOOGLE_DRIVE_EXPORT_FOLDER_ID;
  try {
    process.env.GOOGLE_DRIVE_EXPORT_FOLDER_ID = "original-root";
    const snapshot = snapshotExportFolderEnv();
    process.env.GOOGLE_DRIVE_EXPORT_FOLDER_ID = "temporary-root";
    assert.throws(() => {
      try {
        throw new Error("early harness failure");
      } finally {
        restoreExportFolderEnv(snapshot);
      }
    }, /early harness failure/);
    assert.equal(process.env.GOOGLE_DRIVE_EXPORT_FOLDER_ID, "original-root");
  } finally {
    if (saved === undefined) delete process.env.GOOGLE_DRIVE_EXPORT_FOLDER_ID;
    else process.env.GOOGLE_DRIVE_EXPORT_FOLDER_ID = saved;
  }
});

function applyThenThrow(): never {
  process.env.GOOGLE_DRIVE_EXPORT_FOLDER_ID = "temporary-root";
  throw new Error("early harness failure");
}
