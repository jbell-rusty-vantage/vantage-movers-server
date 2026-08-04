import { randomBytes } from "node:crypto";
import { getGooglePickerConfig } from "../../config/domain/googlePicker";
import {
  REPORTING_PICKER_NONCE_TTL_MS,
  REPORTING_PICKER_SELECTION_TTL_MS,
} from "../../config/domain/reporting";
import { connectMongo } from "../../db";
import { GooglePickerNonce } from "../../models/GooglePickerNonce";
import { getOperationalWorkbookRegistry } from "../operationalWorkbooks";
import { BadRequestError } from "../errors";
import {
  assertDriveAccessible,
  assertDriveMimeType,
  assertDriveOwnedByConnectedUser,
  assertParentFolderRelationship,
  createDriveMetadataClient,
  FOLDER_MIME_TYPE,
  SPREADSHEET_MIME_TYPE,
  type DriveFileMetadata,
  type DriveMetadataClient,
} from "./driveMetadata.service";
import {
  getGoogleDriveAccessTokenHealth,
  getGoogleDriveConnectionStatus,
} from "./googleDriveOAuth.service";
import {
  expectedConfiguredOwnerEmail,
  hashPickerNonce,
  hashPickerSelectionReference,
} from "../reporting/destinationIdentity";
import { getPickerNonceStore } from "./pickerNonceStore";
import { getPickerSelectionStore } from "./pickerSelectionStore";
import type { PickerFlow } from "./picker.types";

export type { PickerFlow } from "./picker.types";

export type PickerBootstrapResponse = {
  picker_api_key: string;
  picker_app_id: string;
  access_token: string;
  access_token_expires_at: string;
  flow: PickerFlow;
  views: Array<{ mime_type: string; mode: "folder" | "spreadsheet" }>;
  selection_nonce: string;
  connection_health: {
    connected: boolean;
    token_healthy: boolean;
    google_email?: string;
  };
};

export type VerifiedPickerSelection = {
  selection_reference: string;
  expires_at: string;
  flow: PickerFlow;
  file: {
    id: string;
    name: string;
    mime_type: string;
    url: string;
    parent_folder_id?: string;
  };
};

const BOOTSTRAP_RESPONSE_KEYS = new Set([
  "picker_api_key",
  "picker_app_id",
  "access_token",
  "access_token_expires_at",
  "flow",
  "views",
  "selection_nonce",
  "connection_health",
]);

export function assertPickerBootstrapAllowlist(payload: Record<string, unknown>): void {
  for (const key of Object.keys(payload)) {
    if (!BOOTSTRAP_RESPONSE_KEYS.has(key)) {
      throw new Error(`Unexpected Picker bootstrap field: ${key}`);
    }
  }
}

export function validatePickerSelectionMetadata(input: {
  metadata: DriveFileMetadata;
  flow: PickerFlow;
}): void {
  assertDriveAccessible(input.metadata);
  assertDriveOwnedByConnectedUser(input.metadata);
  assertDriveMimeType(
    input.metadata,
    input.flow === "folder" ? FOLDER_MIME_TYPE : SPREADSHEET_MIME_TYPE,
  );
  if (input.flow === "spreadsheet") {
    const safety = getOperationalWorkbookRegistry().evaluateReportingDestination(
      input.metadata.id,
    );
    if (!safety.allowed) {
      throw new BadRequestError(safety.safe_message, {
        metadata: { code: safety.code },
      });
    }
  }
}

export function validatePickerSelectionReferenceMetadata(input: {
  metadata: DriveFileMetadata;
  flow: PickerFlow;
  expectedParentFolderId?: string;
}): void {
  assertDriveAccessible(input.metadata);
  assertDriveOwnedByConnectedUser(input.metadata);
  assertDriveMimeType(
    input.metadata,
    input.flow === "folder" ? FOLDER_MIME_TYPE : SPREADSHEET_MIME_TYPE,
  );
  if (input.expectedParentFolderId && input.flow === "spreadsheet") {
    assertParentFolderRelationship(
      input.metadata,
      input.expectedParentFolderId,
    );
  }
  if (input.flow === "spreadsheet") {
    const safety = getOperationalWorkbookRegistry().evaluateReportingDestination(
      input.metadata.id,
    );
    if (!safety.allowed) {
      throw new BadRequestError(safety.safe_message, {
        metadata: { code: safety.code },
      });
    }
  }
}

export function pickerSelectionVerificationError(
  code: "invalid_nonce" | "invalid_selection" | "selection_unavailable",
): BadRequestError {
  const messages = {
    invalid_nonce:
      "Picker selection nonce is invalid, expired, or already used.",
    invalid_selection: "The selected Google Drive item could not be verified.",
    selection_unavailable:
      "Picker selection verification is temporarily unavailable.",
  } as const;
  return new BadRequestError(messages[code], {
    metadata: { code: `picker_${code}` },
  });
}

export function pickerSelectionReferenceError(
  code: "invalid_reference" | "invalid_selection" | "selection_unavailable",
): BadRequestError {
  const messages = {
    invalid_reference:
      "Picker selection reference is invalid, expired, or already used.",
    invalid_selection: "The selected Google Drive item could not be verified.",
    selection_unavailable:
      "Picker selection verification is temporarily unavailable.",
  } as const;
  return new BadRequestError(messages[code], {
    metadata: { code: `picker_${code}` },
  });
}

export async function bootstrapGooglePicker(
  flow: PickerFlow,
): Promise<PickerBootstrapResponse> {
  const picker = getGooglePickerConfig();
  const ownerEmail = expectedConfiguredOwnerEmail();
  const [connectionStatus, tokenHealth] = await Promise.all([
    getGoogleDriveConnectionStatus(),
    getGoogleDriveAccessTokenHealth(),
  ]);
  if (!connectionStatus.connected) {
    throw new BadRequestError(
      "Google Drive is not connected. Complete the owner authorization first.",
    );
  }
  if (!tokenHealth.healthy) {
    const message =
      tokenHealth.reason === "scope_violation"
        ? "Google Drive authorization scopes are not permitted. Reconnect owner OAuth."
        : "Google Drive access token refresh failed. Reconnect owner OAuth.";
    throw new BadRequestError(message);
  }

  const selectionNonce = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + REPORTING_PICKER_NONCE_TTL_MS);
  await connectMongo();
  await GooglePickerNonce.create({
    nonce_hash: hashPickerNonce(selectionNonce),
    owner_email: ownerEmail,
    flow,
    expires_at: expiresAt,
  });

  const response: PickerBootstrapResponse = {
    picker_api_key: picker.apiKey,
    picker_app_id: picker.appId,
    access_token: tokenHealth.access_token,
    access_token_expires_at: tokenHealth.expires_at.toISOString(),
    flow,
    views: [
      flow === "folder"
        ? { mime_type: FOLDER_MIME_TYPE, mode: "folder" }
        : { mime_type: SPREADSHEET_MIME_TYPE, mode: "spreadsheet" },
    ],
    selection_nonce: selectionNonce,
    connection_health: {
      connected: true,
      token_healthy: true,
      google_email: tokenHealth.google_email,
    },
  };
  assertPickerBootstrapAllowlist(response as unknown as Record<string, unknown>);
  return response;
}

export async function verifyGooglePickerSelection(input: {
  selectionNonce: string;
  fileId: string;
  displayName?: string;
  displayUrl?: string;
  parentFolderId?: string;
  driveClient?: DriveMetadataClient;
}): Promise<VerifiedPickerSelection> {
  const ownerEmail = expectedConfiguredOwnerEmail();
  const nonceHash = hashPickerNonce(input.selectionNonce);
  const pendingNonce = await getPickerNonceStore().findActive({
    nonceHash,
    ownerEmail,
  });
  if (!pendingNonce) {
    throw pickerSelectionVerificationError("invalid_nonce");
  }

  const driveClient = input.driveClient ?? (await createDriveMetadataClient());
  let metadata: DriveFileMetadata;
  try {
    metadata = await driveClient.getFileMetadata(input.fileId);
    validatePickerSelectionMetadata({
      metadata,
      flow: pendingNonce.flow,
    });
  } catch (error) {
    if (error instanceof BadRequestError) {
      throw pickerSelectionVerificationError("invalid_selection");
    }
    throw pickerSelectionVerificationError("selection_unavailable");
  }

  const consumedNonce = await getPickerNonceStore().consumeActive({
    nonceHash,
    ownerEmail,
  });
  if (!consumedNonce) {
    throw pickerSelectionVerificationError("invalid_nonce");
  }

  const selectionReference = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + REPORTING_PICKER_SELECTION_TTL_MS);
  await getPickerSelectionStore().create({
    reference_hash: hashPickerSelectionReference(selectionReference),
    owner_email: ownerEmail,
    flow: consumedNonce.flow,
    file_id: metadata.id,
    mime_type: metadata.mimeType,
    name: metadata.name,
    url: metadata.url,
    parent_folder_id:
      consumedNonce.flow === "spreadsheet"
        ? metadata.parentFolderIds[0]
        : undefined,
    expires_at: expiresAt,
  });

  return {
    selection_reference: selectionReference,
    expires_at: expiresAt.toISOString(),
    flow: consumedNonce.flow,
    file: {
      id: metadata.id,
      name: metadata.name,
      mime_type: metadata.mimeType,
      url: metadata.url,
      ...(consumedNonce.flow === "spreadsheet" && metadata.parentFolderIds[0]
        ? { parent_folder_id: metadata.parentFolderIds[0] }
        : {}),
    },
  };
}

export async function consumePickerSelectionReference(input: {
  reference: string;
  flow: PickerFlow;
  expectedParentFolderId?: string;
  driveClient?: DriveMetadataClient;
}): Promise<{
  fileId: string;
  name: string;
  url: string;
  mimeType: string;
  parentFolderId?: string;
}> {
  const ownerEmail = expectedConfiguredOwnerEmail();
  const referenceHash = hashPickerSelectionReference(input.reference);
  const pendingSelection = await getPickerSelectionStore().findActive({
    referenceHash,
    ownerEmail,
    flow: input.flow,
  });
  if (!pendingSelection) {
    throw pickerSelectionReferenceError("invalid_reference");
  }

  const driveClient = input.driveClient ?? (await createDriveMetadataClient());
  let metadata: DriveFileMetadata;
  try {
    metadata = await driveClient.getFileMetadata(pendingSelection.file_id);
    validatePickerSelectionReferenceMetadata({
      metadata,
      flow: input.flow,
      expectedParentFolderId: input.expectedParentFolderId,
    });
  } catch (error) {
    if (error instanceof BadRequestError) {
      throw pickerSelectionReferenceError("invalid_selection");
    }
    throw pickerSelectionReferenceError("selection_unavailable");
  }

  const consumedSelection = await getPickerSelectionStore().consumeActive({
    referenceHash,
    ownerEmail,
    flow: input.flow,
  });
  if (!consumedSelection) {
    throw pickerSelectionReferenceError("invalid_reference");
  }

  return {
    fileId: metadata.id,
    name: metadata.name,
    url: metadata.url,
    mimeType: metadata.mimeType,
    parentFolderId: metadata.parentFolderIds[0],
  };
}

export async function assertWorkbookNotDenylisted(workbookId: string): Promise<void> {
  const safety =
    getOperationalWorkbookRegistry().evaluateReportingDestination(workbookId);
  if (!safety.allowed) {
    throw new BadRequestError(safety.safe_message, {
      metadata: { code: safety.code },
    });
  }
}

export async function revalidateSpreadsheetMetadata(
  spreadsheetId: string,
  folderId?: string,
  driveClient?: DriveMetadataClient,
): Promise<{ id: string; name: string; url: string }> {
  await assertWorkbookNotDenylisted(spreadsheetId);
  const client = driveClient ?? (await createDriveMetadataClient());
  const metadata = await client.getFileMetadata(spreadsheetId);
  assertDriveAccessible(metadata);
  assertDriveOwnedByConnectedUser(metadata);
  assertDriveMimeType(metadata, SPREADSHEET_MIME_TYPE);
  if (folderId) {
    assertParentFolderRelationship(metadata, folderId);
  }
  return { id: metadata.id, name: metadata.name, url: metadata.url };
}

export async function revalidateFolderMetadata(
  folderId: string,
  driveClient?: DriveMetadataClient,
): Promise<{ id: string; name: string; url: string }> {
  const client = driveClient ?? (await createDriveMetadataClient());
  const metadata = await client.getFileMetadata(folderId);
  assertDriveAccessible(metadata);
  assertDriveOwnedByConnectedUser(metadata);
  assertDriveMimeType(metadata, FOLDER_MIME_TYPE);
  return { id: metadata.id, name: metadata.name, url: metadata.url };
}

export {
  resetPickerVerificationStoresForTests,
  setPickerSelectionStoreForTests,
} from "./pickerSelectionStore";
export {
  InMemoryPickerNonceStore,
  setPickerNonceStoreForTests,
} from "./pickerNonceStore";
export { InMemoryPickerSelectionStore } from "./pickerSelectionStore";
