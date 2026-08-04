import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { randomBytes } from "node:crypto";
import { BadRequestError } from "../errors";
import { NotFoundError } from "../errors";
import {
  FOLDER_MIME_TYPE,
  SPREADSHEET_MIME_TYPE,
  type DriveMetadataClient,
} from "./driveMetadata.service";
import {
  createOperationalWorkbookRegistry,
  setOperationalWorkbookRegistryForTests,
  type OperationalWorkbookRegistration,
} from "../operationalWorkbooks";
import {
  consumePickerSelectionReference,
  InMemoryPickerNonceStore,
  InMemoryPickerSelectionStore,
  resetPickerVerificationStoresForTests,
  setPickerNonceStoreForTests,
  setPickerSelectionStoreForTests,
  verifyGooglePickerSelection,
} from "./picker.service";
import {
  hashPickerNonce,
  hashPickerSelectionReference,
} from "../reporting/destinationIdentity";

const OWNER_EMAIL = "owner@example.com";
const NONCE = "picker-test-nonce-value-12345678901234567890123456789012";
const REFERENCE =
  "picker-test-selection-reference-123456789012345678901234567890";
const FOLDER_ID = "1FolderIdExample00000000000001";
const WORKBOOK_ID = "1WorkbookIdExample000000000000001";
const PARENT_FOLDER_ID = "1ParentFolderExample0000000000001";
const DENYLISTED_WORKBOOK_ID = "1OperationalWorkbookExample00001";
const ENCRYPTION_KEY = randomBytes(32).toString("base64");

const denylistRegistrations: OperationalWorkbookRegistration[] = [
  {
    registration_key: "master_leads",
    purpose: "operational_projection",
    env_key: "MASTER_LEADS_SHEET_ID",
    required_in_production: true,
    owner_module: "operations",
    display_label: "Master Leads",
  },
];

function configureOAuthEnv(): void {
  process.env.GOOGLE_OAUTH_CLIENT_ID = "client-id.apps.googleusercontent.com";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret";
  process.env.GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY = ENCRYPTION_KEY;
  process.env.GOOGLE_OAUTH_OWNER_EMAIL = OWNER_EMAIL;
  process.env.GOOGLE_OAUTH_TRUSTED_ADMIN_ORIGIN = "https://admin.example.com";
}

function seedFolderNonce(store: InMemoryPickerNonceStore): string {
  const nonceHash = hashPickerNonce(NONCE);
  store.seed({
    nonce_hash: nonceHash,
    owner_email: OWNER_EMAIL,
    flow: "folder",
    expires_at: new Date(Date.now() + 60_000),
    consumed_at: null,
  });
  return nonceHash;
}

function createDriveClient(input: {
  mimeType?: string;
  trashed?: boolean;
  ownedByMe?: boolean;
  inaccessible?: boolean;
  parentFolderIds?: string[];
  fileId?: string;
}): DriveMetadataClient {
  return {
    async getFileMetadata(fileId) {
      if (input.inaccessible) {
        throw new NotFoundError(
          "Google Drive could not access the selected file. Re-authorize it through Picker.",
        );
      }
      const resolvedId = input.fileId ?? fileId;
      const mimeType = input.mimeType ?? FOLDER_MIME_TYPE;
      return {
        id: resolvedId,
        name: mimeType === SPREADSHEET_MIME_TYPE ? "Report Workbook" : "Reports",
        mimeType,
        trashed: input.trashed ?? false,
        url:
          mimeType === SPREADSHEET_MIME_TYPE
            ? `https://docs.google.com/spreadsheets/d/${resolvedId}/edit`
            : `https://drive.google.com/drive/folders/${resolvedId}`,
        parentFolderIds: input.parentFolderIds ?? [],
        ownedByMe: input.ownedByMe ?? true,
      };
    },
  };
}

function seedFolderSelection(store: InMemoryPickerSelectionStore): string {
  const referenceHash = hashPickerSelectionReference(REFERENCE);
  store.seed({
    reference_hash: referenceHash,
    owner_email: OWNER_EMAIL,
    flow: "folder",
    file_id: FOLDER_ID,
    mime_type: FOLDER_MIME_TYPE,
    name: "Reports",
    url: `https://drive.google.com/drive/folders/${FOLDER_ID}`,
    expires_at: new Date(Date.now() + 60_000),
    consumed_at: null,
  });
  return referenceHash;
}

function seedSpreadsheetSelection(store: InMemoryPickerSelectionStore): string {
  const referenceHash = hashPickerSelectionReference(REFERENCE);
  store.seed({
    reference_hash: referenceHash,
    owner_email: OWNER_EMAIL,
    flow: "spreadsheet",
    file_id: WORKBOOK_ID,
    mime_type: SPREADSHEET_MIME_TYPE,
    name: "Report Workbook",
    url: `https://docs.google.com/spreadsheets/d/${WORKBOOK_ID}/edit`,
    parent_folder_id: PARENT_FOLDER_ID,
    expires_at: new Date(Date.now() + 60_000),
    consumed_at: null,
  });
  return referenceHash;
}

function configureAllowingDenylistRegistry(): void {
  setOperationalWorkbookRegistryForTests(
    createOperationalWorkbookRegistry({
      registrations: denylistRegistrations,
      env: { MASTER_LEADS_SHEET_ID: DENYLISTED_WORKBOOK_ID },
      production: true,
    }),
  );
}

afterEach(() => {
  resetPickerVerificationStoresForTests();
  setOperationalWorkbookRegistryForTests(undefined);
});

test("invalid picker selection preserves nonce until metadata validates", async () => {
  configureOAuthEnv();
  const nonceStore = new InMemoryPickerNonceStore();
  const selectionStore = new InMemoryPickerSelectionStore();
  setPickerNonceStoreForTests(nonceStore);
  setPickerSelectionStoreForTests(selectionStore);
  const nonceHash = seedFolderNonce(nonceStore);

  await assert.rejects(
    () =>
      verifyGooglePickerSelection({
        selectionNonce: NONCE,
        fileId: "1FolderIdExample00000000000001",
        driveClient: createDriveClient({ mimeType: SPREADSHEET_MIME_TYPE }),
      }),
    (error: unknown) =>
      error instanceof BadRequestError &&
      error.metadata?.code === "picker_invalid_selection",
  );
  assert.equal(nonceStore.get(nonceHash)?.consumed_at, null);
  assert.equal(selectionStore.records.length, 0);

  await assert.rejects(
    () =>
      verifyGooglePickerSelection({
        selectionNonce: NONCE,
        fileId: "1FolderIdExample00000000000001",
        driveClient: createDriveClient({ inaccessible: true }),
      }),
    (error: unknown) =>
      error instanceof BadRequestError &&
      error.metadata?.code === "picker_selection_unavailable",
  );
  assert.equal(nonceStore.get(nonceHash)?.consumed_at, null);

  const verified = await verifyGooglePickerSelection({
    selectionNonce: NONCE,
    fileId: "1FolderIdExample00000000000001",
    driveClient: createDriveClient({}),
  });
  assert.ok(verified.selection_reference);
  assert.notEqual(nonceStore.get(nonceHash)?.consumed_at, null);
  assert.equal(selectionStore.records.length, 1);
  assert.doesNotMatch(JSON.stringify(verified), /refresh_token|client_secret/i);
});

test("picker nonce replay is rejected after successful verification", async () => {
  configureOAuthEnv();
  const nonceStore = new InMemoryPickerNonceStore();
  const selectionStore = new InMemoryPickerSelectionStore();
  setPickerNonceStoreForTests(nonceStore);
  setPickerSelectionStoreForTests(selectionStore);
  seedFolderNonce(nonceStore);

  await verifyGooglePickerSelection({
    selectionNonce: NONCE,
    fileId: "1FolderIdExample00000000000001",
    driveClient: createDriveClient({}),
  });

  await assert.rejects(
    () =>
      verifyGooglePickerSelection({
        selectionNonce: NONCE,
        fileId: "1FolderIdExample00000000000001",
        driveClient: createDriveClient({}),
      }),
    (error: unknown) =>
      error instanceof BadRequestError &&
      error.metadata?.code === "picker_invalid_nonce",
  );
  assert.equal(selectionStore.records.length, 1);
});

test("concurrent valid picker verifications issue at most one selection reference", async () => {
  configureOAuthEnv();
  const nonceStore = new InMemoryPickerNonceStore();
  const selectionStore = new InMemoryPickerSelectionStore();
  setPickerNonceStoreForTests(nonceStore);
  setPickerSelectionStoreForTests(selectionStore);
  seedFolderNonce(nonceStore);

  const driveClient = createDriveClient({});
  const attempts = await Promise.allSettled([
    verifyGooglePickerSelection({
      selectionNonce: NONCE,
      fileId: "1FolderIdExample00000000000001",
      driveClient,
    }),
    verifyGooglePickerSelection({
      selectionNonce: NONCE,
      fileId: "1FolderIdExample00000000000001",
      driveClient,
    }),
  ]);

  const fulfilled = attempts.filter((result) => result.status === "fulfilled");
  const rejected = attempts.filter((result) => result.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(selectionStore.records.length, 1);

  const failure = rejected[0];
  assert.equal(failure?.status, "rejected");
  if (failure?.status === "rejected") {
    assert.ok(failure.reason instanceof BadRequestError);
    assert.equal(failure.reason.metadata?.code, "picker_invalid_nonce");
  }
});

test("invalid selection reference metadata preserves reference until validation passes", async () => {
  configureOAuthEnv();
  configureAllowingDenylistRegistry();
  const selectionStore = new InMemoryPickerSelectionStore();
  setPickerSelectionStoreForTests(selectionStore);
  const referenceHash = seedFolderSelection(selectionStore);

  await assert.rejects(
    () =>
      consumePickerSelectionReference({
        reference: REFERENCE,
        flow: "folder",
        driveClient: createDriveClient({ mimeType: SPREADSHEET_MIME_TYPE }),
      }),
    (error: unknown) =>
      error instanceof BadRequestError &&
      error.metadata?.code === "picker_invalid_selection",
  );
  assert.equal(selectionStore.get(referenceHash)?.consumed_at, null);

  await assert.rejects(
    () =>
      consumePickerSelectionReference({
        reference: REFERENCE,
        flow: "folder",
        driveClient: createDriveClient({ trashed: true }),
      }),
    (error: unknown) =>
      error instanceof BadRequestError &&
      error.metadata?.code === "picker_invalid_selection",
  );
  assert.equal(selectionStore.get(referenceHash)?.consumed_at, null);

  await assert.rejects(
    () =>
      consumePickerSelectionReference({
        reference: REFERENCE,
        flow: "folder",
        driveClient: createDriveClient({ inaccessible: true }),
      }),
    (error: unknown) =>
      error instanceof BadRequestError &&
      error.metadata?.code === "picker_selection_unavailable",
  );
  assert.equal(selectionStore.get(referenceHash)?.consumed_at, null);

  const consumed = await consumePickerSelectionReference({
    reference: REFERENCE,
    flow: "folder",
    driveClient: createDriveClient({}),
  });
  assert.equal(consumed.fileId, FOLDER_ID);
  assert.notEqual(selectionStore.get(referenceHash)?.consumed_at, null);
  assert.doesNotMatch(JSON.stringify(consumed), /refresh_token|client_secret/i);
});

test("denylisted workbook preserves reference until denylist clears", async () => {
  configureOAuthEnv();
  const selectionStore = new InMemoryPickerSelectionStore();
  setPickerSelectionStoreForTests(selectionStore);
  const referenceHash = seedSpreadsheetSelection(selectionStore);

  setOperationalWorkbookRegistryForTests(
    createOperationalWorkbookRegistry({
      registrations: denylistRegistrations,
      env: { MASTER_LEADS_SHEET_ID: WORKBOOK_ID },
      production: true,
    }),
  );

  await assert.rejects(
    () =>
      consumePickerSelectionReference({
        reference: REFERENCE,
        flow: "spreadsheet",
        expectedParentFolderId: PARENT_FOLDER_ID,
        driveClient: createDriveClient({
          mimeType: SPREADSHEET_MIME_TYPE,
          parentFolderIds: [PARENT_FOLDER_ID],
          fileId: WORKBOOK_ID,
        }),
      }),
    (error: unknown) =>
      error instanceof BadRequestError &&
      error.metadata?.code === "picker_invalid_selection",
  );
  assert.equal(selectionStore.get(referenceHash)?.consumed_at, null);

  configureAllowingDenylistRegistry();
  const consumed = await consumePickerSelectionReference({
    reference: REFERENCE,
    flow: "spreadsheet",
    expectedParentFolderId: PARENT_FOLDER_ID,
    driveClient: createDriveClient({
      mimeType: SPREADSHEET_MIME_TYPE,
      parentFolderIds: [PARENT_FOLDER_ID],
      fileId: WORKBOOK_ID,
    }),
  });
  assert.equal(consumed.fileId, WORKBOOK_ID);
  assert.notEqual(selectionStore.get(referenceHash)?.consumed_at, null);
});

test("denylist configuration fails closed without consuming reference", async () => {
  configureOAuthEnv();
  const selectionStore = new InMemoryPickerSelectionStore();
  setPickerSelectionStoreForTests(selectionStore);
  const referenceHash = seedSpreadsheetSelection(selectionStore);

  setOperationalWorkbookRegistryForTests(
    createOperationalWorkbookRegistry({
      registrations: denylistRegistrations,
      env: {},
      production: true,
    }),
  );

  await assert.rejects(
    () =>
      consumePickerSelectionReference({
        reference: REFERENCE,
        flow: "spreadsheet",
        expectedParentFolderId: PARENT_FOLDER_ID,
        driveClient: createDriveClient({
          mimeType: SPREADSHEET_MIME_TYPE,
          parentFolderIds: [PARENT_FOLDER_ID],
          fileId: WORKBOOK_ID,
        }),
      }),
    (error: unknown) =>
      error instanceof BadRequestError &&
      error.metadata?.code === "picker_invalid_selection",
  );
  assert.equal(selectionStore.get(referenceHash)?.consumed_at, null);
});

test("selection reference replay is rejected after successful consume", async () => {
  configureOAuthEnv();
  configureAllowingDenylistRegistry();
  const selectionStore = new InMemoryPickerSelectionStore();
  setPickerSelectionStoreForTests(selectionStore);
  seedFolderSelection(selectionStore);

  await consumePickerSelectionReference({
    reference: REFERENCE,
    flow: "folder",
    driveClient: createDriveClient({}),
  });

  await assert.rejects(
    () =>
      consumePickerSelectionReference({
        reference: REFERENCE,
        flow: "folder",
        driveClient: createDriveClient({}),
      }),
    (error: unknown) =>
      error instanceof BadRequestError &&
      error.metadata?.code === "picker_invalid_reference",
  );
});

test("concurrent valid selection reference consumes yield at most one winner", async () => {
  configureOAuthEnv();
  configureAllowingDenylistRegistry();
  const selectionStore = new InMemoryPickerSelectionStore();
  setPickerSelectionStoreForTests(selectionStore);
  seedFolderSelection(selectionStore);

  const driveClient = createDriveClient({});
  const attempts = await Promise.allSettled([
    consumePickerSelectionReference({
      reference: REFERENCE,
      flow: "folder",
      driveClient,
    }),
    consumePickerSelectionReference({
      reference: REFERENCE,
      flow: "folder",
      driveClient,
    }),
  ]);

  const fulfilled = attempts.filter((result) => result.status === "fulfilled");
  const rejected = attempts.filter((result) => result.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);

  const failure = rejected[0];
  assert.equal(failure?.status, "rejected");
  if (failure?.status === "rejected") {
    assert.ok(failure.reason instanceof BadRequestError);
    assert.equal(failure.reason.metadata?.code, "picker_invalid_reference");
  }
});
