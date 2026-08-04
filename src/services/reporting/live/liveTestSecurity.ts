import { existsSync } from "node:fs";
import { google, type drive_v3 } from "googleapis";
import { GOOGLE_SERVICE_ACCOUNT_ENV_VARS } from "../../../config/domain/googleAuth";
import {
  FOLDER_MIME_TYPE,
  type DriveFileMetadata,
} from "../../googleDriveOAuth/driveMetadata.service";
import {
  getConnectedGoogleOAuthClient,
  getGoogleDriveAccessTokenHealth,
  getGoogleDriveConnectionStatus,
} from "../../googleDriveOAuth/googleDriveOAuth.service";
import { getGoogleDriveOAuthConfig } from "../../../config/domain";
import {
  LIVE_TEST_JANITOR_ARTIFACT_ROLES,
  LIVE_TEST_RUN_TAG_PREFIX_PATTERN,
  REPORTING_LIVE_TEST_APP_PROPERTY_KEY,
  REPORTING_LIVE_TEST_MARKER_VERSION,
  REPORTING_LIVE_TEST_ROOT_MARKER_KEY,
  REPORTING_LIVE_TEST_TAG_PROPERTY_KEY,
  type ReportingLiveTestConfig,
} from "../../../config/domain/reportingLiveTest";
import { isJanitorContainerAuthorized } from "./liveTestHarnessRunRegistry";

const SERVICE_ACCOUNT_FILE_CANDIDATES = [
  "google-service-account.json",
  "google-service-account.one-line.json",
  "service-account.json",
] as const;

const EXTRA_SERVICE_ACCOUNT_ENV_VARS = [
  "SERVICE_ACCOUNT_LOCAL_FILE",
  "SERVICE_ACCOUNT_LOCAL_FILE_JSON",
] as const;

export type LiveTestOAuthPrincipal = {
  googleEmail: string;
  ownerEmail: string;
  clientId: string;
};

export type LiveTestExportRootValidation = {
  fileId: string;
  ownedByMe: true;
  mimeType: typeof FOLDER_MIME_TYPE;
  appProperties: Record<string, string>;
};

export type HarnessContainerTrashExpectation = {
  runTag: string;
  runId: string;
  destinationId: string;
  exportRootFolderId: string;
  runTagPrefix: string;
};

export function listConfiguredServiceAccountIndicators(): string[] {
  const present: string[] = listConfiguredServiceAccountEnvVars();
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()) {
    present.push("GOOGLE_APPLICATION_CREDENTIALS");
  }
  for (const name of EXTRA_SERVICE_ACCOUNT_ENV_VARS) {
    if (process.env[name]?.trim()) present.push(name);
  }
  for (const file of SERVICE_ACCOUNT_FILE_CANDIDATES) {
    if (existsSync(file)) present.push(`file:${file}`);
  }
  return present;
}

export function listConfiguredServiceAccountEnvVars(): string[] {
  return [
    GOOGLE_SERVICE_ACCOUNT_ENV_VARS.json,
    GOOGLE_SERVICE_ACCOUNT_ENV_VARS.testJson,
    GOOGLE_SERVICE_ACCOUNT_ENV_VARS.base64Json,
    GOOGLE_SERVICE_ACCOUNT_ENV_VARS.testBase64Json,
    ...EXTRA_SERVICE_ACCOUNT_ENV_VARS,
  ].filter((name) => Boolean(process.env[name]?.trim()));
}

export function rejectServiceAccountCredentialsForLiveTest(): void {
  const present = listConfiguredServiceAccountIndicators();
  if (present.length > 0) {
    throw new Error(
      `Live reporting Google tests reject service-account credentials. Remove: ${present.join(", ")}`,
    );
  }
}

export async function assertLiveTestOAuthPrincipal(): Promise<LiveTestOAuthPrincipal> {
  rejectServiceAccountCredentialsForLiveTest();
  const config = getGoogleDriveOAuthConfig();
  const [connection, tokenHealth] = await Promise.all([
    getGoogleDriveConnectionStatus(),
    getGoogleDriveAccessTokenHealth(),
  ]);
  if (!connection.connected || !tokenHealth.healthy) {
    throw new Error(
      `Live test OAuth principal unavailable: ${tokenHealth.healthy ? "connected" : tokenHealth.reason}`,
    );
  }
  if (connection.google_email !== tokenHealth.google_email) {
    throw new Error("Live test OAuth principal email mismatch.");
  }
  if (connection.google_email.toLowerCase() !== config.ownerEmail.toLowerCase()) {
    throw new Error("Connected OAuth principal does not match configured test owner email.");
  }
  return {
    googleEmail: connection.google_email,
    ownerEmail: config.ownerEmail,
    clientId: config.clientId,
  };
}

export function assertProductionIdentitySeparation(): void {
  const testClientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const testOwner = process.env.GOOGLE_OAUTH_OWNER_EMAIL?.trim()?.toLowerCase();
  const prodClientId = process.env.REPORTING_PRODUCTION_GOOGLE_OAUTH_CLIENT_ID?.trim();
  const prodOwner = process.env.REPORTING_PRODUCTION_GOOGLE_OAUTH_OWNER_EMAIL
    ?.trim()
    ?.toLowerCase();
  if (!testClientId || !testOwner) {
    throw new Error("Test OAuth client ID and owner email must be configured.");
  }
  if (!prodClientId || !prodOwner) {
    throw new Error(
      "REPORTING_PRODUCTION_GOOGLE_OAUTH_CLIENT_ID and REPORTING_PRODUCTION_GOOGLE_OAUTH_OWNER_EMAIL are required for live-test separation checks.",
    );
  }
  if (testClientId === prodClientId) {
    throw new Error("Live test OAuth client ID must differ from production client ID.");
  }
  if (testOwner === prodOwner) {
    throw new Error("Live test owner email must differ from production owner email.");
  }
}

export function validateLiveTestRunTagFormat(runTag: string, prefix: string): void {
  if (!runTag.startsWith(`${prefix}-`)) {
    throw new Error(`Live test run tag must start with prefix ${prefix}.`);
  }
  if (!LIVE_TEST_RUN_TAG_PREFIX_PATTERN.test(runTag)) {
    throw new Error("Live test run tag format is invalid.");
  }
}

export async function validateDedicatedExportRoot(input: {
  exportRootFolderId: string;
  expectedOwnerEmail: string;
}): Promise<LiveTestExportRootValidation> {
  await assertLiveTestOAuthPrincipal();
  const auth = await getConnectedGoogleOAuthClient();
  const drive = google.drive({ version: "v3", auth } as unknown as drive_v3.Options);
  const response = await drive.files.get({
    fileId: input.exportRootFolderId,
    fields: "id,mimeType,ownedByMe,appProperties,trashed",
    supportsAllDrives: true,
  });
  if (response.data.trashed) {
    throw new Error("Dedicated live-test export root is trashed.");
  }
  if (response.data.mimeType !== FOLDER_MIME_TYPE) {
    throw new Error("Dedicated live-test export root must be a folder.");
  }
  if (!response.data.ownedByMe) {
    throw new Error("Dedicated live-test export root must be owned by the connected test user.");
  }
  const appProperties = (response.data.appProperties ?? {}) as Record<string, string>;
  if (appProperties[REPORTING_LIVE_TEST_ROOT_MARKER_KEY] !== REPORTING_LIVE_TEST_MARKER_VERSION) {
    throw new Error("Dedicated export root missing required live-test root marker.");
  }
  if (!response.data.id) {
    throw new Error("Dedicated export root returned no file ID.");
  }
  return {
    fileId: response.data.id,
    ownedByMe: true,
    mimeType: FOLDER_MIME_TYPE,
    appProperties,
  };
}

export function assertDirectChildOfExportRoot(input: {
  parentFolderIds: readonly string[];
  exportRootFolderId: string;
}): void {
  if (!input.parentFolderIds.includes(input.exportRootFolderId)) {
    throw new Error("Artifact is not a direct child of the dedicated export root.");
  }
}

export function assertKnownHarnessRunEvidence(input: {
  appProperties: Record<string, string>;
  runTag: string;
  runTagPrefix: string;
  expectedRole?: (typeof LIVE_TEST_JANITOR_ARTIFACT_ROLES)[number];
}): void {
  validateLiveTestRunTagFormat(input.runTag, input.runTagPrefix);
  if (input.appProperties[REPORTING_LIVE_TEST_APP_PROPERTY_KEY] !== REPORTING_LIVE_TEST_MARKER_VERSION) {
    throw new Error("Artifact missing live-test marker.");
  }
  if (input.appProperties.vantage_reporting_marker_version !== REPORTING_LIVE_TEST_MARKER_VERSION) {
    throw new Error("Artifact missing reporting marker version.");
  }
  const tagged = input.appProperties[REPORTING_LIVE_TEST_TAG_PROPERTY_KEY]?.trim();
  if (!tagged || tagged !== input.runTag) {
    throw new Error("Artifact run tag does not match expected harness run tag.");
  }
  const role = input.appProperties.vantage_reporting_role;
  const allowedRoles = input.expectedRole
    ? [input.expectedRole]
    : LIVE_TEST_JANITOR_ARTIFACT_ROLES;
  if (!role || !allowedRoles.includes(role as (typeof LIVE_TEST_JANITOR_ARTIFACT_ROLES)[number])) {
    throw new Error("Artifact role is not on the live-test janitor allowlist.");
  }
  if (!input.appProperties.vantage_reporting_run_id?.trim()) {
    throw new Error("Artifact missing reporting run ID marker.");
  }
  if (!input.appProperties.vantage_reporting_destination_id?.trim()) {
    throw new Error("Artifact missing reporting destination ID marker.");
  }
}

export async function refetchDriveFileMetadata(
  drive: drive_v3.Drive,
  fileId: string,
): Promise<DriveFileMetadata & { appProperties: Record<string, string> }> {
  const response = await drive.files.get({
    fileId,
    fields:
      "id,name,mimeType,trashed,webViewLink,parents,ownedByMe,appProperties",
    supportsAllDrives: true,
  });
  if (!response.data.id || !response.data.mimeType || !response.data.name) {
    throw new Error("Drive metadata refetch incomplete.");
  }
  return {
    id: response.data.id,
    name: response.data.name,
    mimeType: response.data.mimeType,
    trashed: Boolean(response.data.trashed),
    url: response.data.webViewLink ?? "",
    parentFolderIds: response.data.parents ?? [],
    ownedByMe: Boolean(response.data.ownedByMe),
    appProperties: (response.data.appProperties ?? {}) as Record<string, string>,
  };
}

export async function assertHarnessContainerSafeToTrash(input: {
  drive: drive_v3.Drive;
  fileId: string;
  exportRootFolderId: string;
  runTagPrefix: string;
  expectation: HarnessContainerTrashExpectation;
}): Promise<void> {
  const metadata = await refetchDriveFileMetadata(input.drive, input.fileId);
  if (metadata.trashed) return;
  if (!metadata.ownedByMe) {
    throw new Error("Refusing to trash container not owned by connected test user.");
  }
  if (metadata.mimeType !== FOLDER_MIME_TYPE) {
    throw new Error("Refusing to trash non-folder harness container.");
  }
  assertDirectChildOfExportRoot({
    parentFolderIds: metadata.parentFolderIds,
    exportRootFolderId: input.exportRootFolderId,
  });
  const runTag = metadata.appProperties[REPORTING_LIVE_TEST_TAG_PROPERTY_KEY]?.trim();
  if (!runTag || runTag !== input.expectation.runTag) {
    throw new Error("Refusing to trash container with unexpected run tag.");
  }
  assertKnownHarnessRunEvidence({
    appProperties: metadata.appProperties,
    runTag: input.expectation.runTag,
    runTagPrefix: input.runTagPrefix,
    expectedRole: "harness_container",
  });
  if (
    metadata.appProperties.vantage_reporting_run_id?.trim() !== input.expectation.runId ||
    metadata.appProperties.vantage_reporting_destination_id?.trim() !==
      input.expectation.destinationId
  ) {
    throw new Error("Refusing to trash container with mismatched run/destination markers.");
  }
  const authorized = await isJanitorContainerAuthorized({
    runTag: input.expectation.runTag,
    exportRootFolderId: input.exportRootFolderId,
    containerFolderId: input.fileId,
  });
  if (!authorized) {
    throw new Error(
      "Refusing to trash container without janitor-eligible registry binding for this folder ID.",
    );
  }
}

export function buildExportRootAppProperties(): Record<string, string> {
  return {
    [REPORTING_LIVE_TEST_ROOT_MARKER_KEY]: REPORTING_LIVE_TEST_MARKER_VERSION,
  };
}

export type { ReportingLiveTestConfig };
