import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import {
  decryptGoogleRefreshToken,
  encryptGoogleRefreshToken,
} from "./tokenEncryption";
import { hashOAuthState } from "./googleDriveOAuth.service";
import {
  createGoogleDriveFolderRequest,
  normalizeFolderId,
} from "./spreadsheet.service";

test("Google refresh tokens round-trip through authenticated encryption", () => {
  const key = randomBytes(32);
  const ownerEmail = "jbell@vantagehomemovers.com";
  const encrypted = encryptGoogleRefreshToken(
    "refresh-token-value",
    key,
    ownerEmail,
  );

  assert.notEqual(
    encrypted.encrypted_refresh_token,
    "refresh-token-value",
  );
  assert.equal(
    decryptGoogleRefreshToken(encrypted, key, ownerEmail),
    "refresh-token-value",
  );
});

test("encrypted Google refresh tokens are bound to the owner identity", () => {
  const key = randomBytes(32);
  const encrypted = encryptGoogleRefreshToken(
    "refresh-token-value",
    key,
    "jbell@vantagehomemovers.com",
  );

  assert.throws(() =>
    decryptGoogleRefreshToken(
      encrypted,
      key,
      "different@vantagehomemovers.com",
    ),
  );
});

test("OAuth state is stored as a deterministic SHA-256 digest", () => {
  const state = "one-time-random-oauth-state";
  const digest = hashOAuthState(state);

  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(digest, hashOAuthState(state));
  assert.notEqual(digest, state);
});

test("Google Drive folder IDs can be read from IDs or shared URLs", () => {
  const folderId = "1Dyy9PrV-W-JpCwAOp3SPMyOG4CU0GzSg";
  assert.equal(normalizeFolderId(folderId), folderId);
  assert.equal(
    normalizeFolderId(
      `https://drive.google.com/drive/folders/${folderId}?usp=drive_link`,
    ),
    folderId,
  );
  assert.equal(normalizeFolderId(undefined), undefined);
});

test("invalid Google Drive folder IDs are rejected", () => {
  assert.throws(
    () => normalizeFolderId("https://example.com/not-a-folder"),
    /folder ID is invalid/,
  );
});

test("a requested folder is created under the normalized configured parent", () => {
  assert.deepEqual(
    createGoogleDriveFolderRequest({
      name: "Vantage API Folder Test",
      parentFolderId:
        "https://drive.google.com/drive/folders/1Dyy9PrV-W-JpCwAOp3SPMyOG4CU0GzSg",
    }),
    {
      name: "Vantage API Folder Test",
      mimeType: "application/vnd.google-apps.folder",
      parents: ["1Dyy9PrV-W-JpCwAOp3SPMyOG4CU0GzSg"],
    },
  );
});
