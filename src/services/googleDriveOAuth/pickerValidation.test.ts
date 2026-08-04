import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestError } from "../errors";
import {
  assertDriveAccessible,
  assertDriveMimeType,
  assertDriveOwnedByConnectedUser,
  FOLDER_MIME_TYPE,
  SPREADSHEET_MIME_TYPE,
  type DriveFileMetadata,
} from "./driveMetadata.service";
import {
  hashPickerNonce,
  hashPickerSelectionReference,
} from "../reporting/destinationIdentity";

function metadata(
  overrides: Partial<DriveFileMetadata> = {},
): DriveFileMetadata {
  return {
    id: "1FolderIdExample00000000000001",
    name: "Reports",
    mimeType: FOLDER_MIME_TYPE,
    trashed: false,
    url: "https://drive.google.com/drive/folders/1FolderIdExample00000000000001",
    parentFolderIds: [],
    ownedByMe: true,
    ...overrides,
  };
}

test("drive metadata validation rejects wrong mime types", () => {
  assert.throws(
    () => assertDriveMimeType(metadata({ mimeType: SPREADSHEET_MIME_TYPE }), FOLDER_MIME_TYPE),
    BadRequestError,
  );
});

test("drive metadata validation rejects trashed files", () => {
  assert.throws(
    () => assertDriveAccessible(metadata({ trashed: true })),
    /trash/,
  );
});

test("drive metadata validation rejects non-owned files", () => {
  assert.throws(
    () => assertDriveOwnedByConnectedUser(metadata({ ownedByMe: false })),
    /owned by the connected Google account/,
  );
});

test("picker nonce and selection references hash to stable digests", () => {
  const nonce = "one-time-nonce";
  const reference = "selection-reference";
  assert.match(hashPickerNonce(nonce), /^[a-f0-9]{64}$/);
  assert.notEqual(hashPickerNonce(nonce), nonce);
  assert.equal(hashPickerNonce(nonce), hashPickerNonce(nonce));
  assert.equal(
    hashPickerSelectionReference(reference),
    hashPickerSelectionReference(reference),
  );
});
