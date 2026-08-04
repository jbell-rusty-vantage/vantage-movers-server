import { GOOGLE_SERVICE_ACCOUNT_ENV_VARS } from "./googleAuth";
import { randomBytes } from "node:crypto";

const GOOGLE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

/** App-property key marking positively identified live-test artifacts. */
export const REPORTING_LIVE_TEST_APP_PROPERTY_KEY = "vantage_live_test";
export const REPORTING_LIVE_TEST_TAG_PROPERTY_KEY = "vantage_live_test_run_tag";
export const REPORTING_LIVE_TEST_ROOT_MARKER_KEY = "vantage_live_test_root";
export const REPORTING_LIVE_TEST_MARKER_VERSION = "1";

export const LIVE_TEST_ALLOWED_ARTIFACT_ROLES = [
  "harness_container",
  "snapshot",
  "staging_workbook",
] as const;

export const LIVE_TEST_JANITOR_ARTIFACT_ROLES = ["harness_container"] as const;

export const LIVE_TEST_ALLOWED_MIME_TYPES = [
  GOOGLE_FOLDER_MIME_TYPE,
  "application/vnd.google-apps.spreadsheet",
] as const;

/** `{prefix}-{sha}-{iso}-{nonce}` */
export const LIVE_TEST_RUN_TAG_PREFIX_PATTERN =
  /^[a-zA-Z0-9_-]+-[a-zA-Z0-9_-]+-\d{4}-\d{2}-\d{2}T[\d-]+Z-[a-f0-9]{6}$/;

export type ReportingLiveTestConfig = {
  enabled: boolean;
  exportRootFolderId: string;
  artifactMaxAgeMs: number;
  denylistWorkbookId: string;
  runTagPrefix: string;
  injectTransientFailures: number;
  oauthPath: "owner_oauth";
};

export type ReportingLiveTestPrerequisiteResult =
  | { ok: true; config: ReportingLiveTestConfig }
  | { ok: false; code: string; message: string; missing: string[] };

const REQUIRED_OAUTH_ENV = [
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY",
  "GOOGLE_OAUTH_TRUSTED_ADMIN_ORIGIN",
  "GOOGLE_OAUTH_OWNER_EMAIL",
  "MONGO_URI",
] as const;

const REQUIRED_WHEN_ENABLED = [
  "REPORTING_LIVE_TEST_EXPORT_ROOT_FOLDER_ID",
  "REPORTING_LIVE_TEST_DENYLIST_WORKBOOK_ID",
  "REPORTING_LIVE_TEST_RUN_TAG_PREFIX",
  "REPORTING_PRODUCTION_GOOGLE_OAUTH_CLIENT_ID",
  "REPORTING_PRODUCTION_GOOGLE_OAUTH_OWNER_EMAIL",
  "GOOGLE_PICKER_API_KEY",
  "GOOGLE_PICKER_APP_ID",
] as const;

const SERVICE_ACCOUNT_ENV_NAMES = [
  GOOGLE_SERVICE_ACCOUNT_ENV_VARS.json,
  GOOGLE_SERVICE_ACCOUNT_ENV_VARS.testJson,
  GOOGLE_SERVICE_ACCOUNT_ENV_VARS.base64Json,
  GOOGLE_SERVICE_ACCOUNT_ENV_VARS.testBase64Json,
  "SERVICE_ACCOUNT_LOCAL_FILE",
  "SERVICE_ACCOUNT_LOCAL_FILE_JSON",
] as const;

export function listConfiguredServiceAccountEnvVars(): string[] {
  const present: string[] = SERVICE_ACCOUNT_ENV_NAMES.filter((name) =>
    Boolean(process.env[name]?.trim()),
  );
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()) {
    present.push("GOOGLE_APPLICATION_CREDENTIALS");
  }
  return present;
}

export function rejectServiceAccountCredentialsForLiveTest(): void {
  const present = listConfiguredServiceAccountEnvVars();
  if (present.length > 0) {
    throw new Error(
      `Live reporting Google tests reject service-account credentials. Unset: ${present.join(", ")}`,
    );
  }
}

export function isReportingLiveTestEnabled(): boolean {
  return process.env.REPORTING_LIVE_TEST_ENABLED?.trim() === "true";
}

export function isReportingLiveTestConfigured(): boolean {
  return validateReportingLiveTestPrerequisites().ok;
}

export function validateReportingLiveTestPrerequisites(): ReportingLiveTestPrerequisiteResult {
  const missing: string[] = [];
  for (const name of REQUIRED_OAUTH_ENV) {
    if (!process.env[name]?.trim()) missing.push(name);
  }

  const enabled = isReportingLiveTestEnabled();
  if (enabled) {
    for (const name of REQUIRED_WHEN_ENABLED) {
      if (!process.env[name]?.trim()) missing.push(name);
    }
  } else {
    const exportRoot = process.env.REPORTING_LIVE_TEST_EXPORT_ROOT_FOLDER_ID?.trim();
    if (!exportRoot) missing.push("REPORTING_LIVE_TEST_EXPORT_ROOT_FOLDER_ID");
  }

  const serviceAccounts = listConfiguredServiceAccountEnvVars();
  if (serviceAccounts.length > 0) {
    return {
      ok: false,
      code: "SERVICE_ACCOUNT_REJECTED",
      message:
        "Live Google tests require owner OAuth only; service-account credentials must not be present.",
      missing: serviceAccounts,
    };
  }

  if (missing.length > 0) {
    return {
      ok: false,
      code: "MISSING_CONFIG",
      message: enabled
        ? "Reporting live Google test prerequisites are incomplete for enabled live mode."
        : "Reporting live Google test prerequisites are incomplete.",
      missing,
    };
  }

  const exportRoot = process.env.REPORTING_LIVE_TEST_EXPORT_ROOT_FOLDER_ID!.trim();
  const runTagPrefix =
    process.env.REPORTING_LIVE_TEST_RUN_TAG_PREFIX?.trim() || "vantage-live-test";

  return {
    ok: true,
    config: {
      enabled,
      exportRootFolderId: exportRoot,
      artifactMaxAgeMs: parseArtifactMaxAgeMs(
        process.env.REPORTING_LIVE_TEST_ARTIFACT_MAX_AGE_MS,
      ),
      denylistWorkbookId: enabled
        ? process.env.REPORTING_LIVE_TEST_DENYLIST_WORKBOOK_ID!.trim()
        : process.env.REPORTING_LIVE_TEST_DENYLIST_WORKBOOK_ID?.trim() ?? "",
      runTagPrefix,
      injectTransientFailures: parseTransientFailures(
        process.env.REPORTING_LIVE_TEST_INJECT_TRANSIENT_FAILURES,
      ),
      oauthPath: "owner_oauth",
    },
  };
}

export function getReportingLiveTestConfig(): ReportingLiveTestConfig {
  const result = validateReportingLiveTestPrerequisites();
  if (!result.ok) {
    throw new Error(`${result.code}: ${result.message}`);
  }
  if (!result.config.denylistWorkbookId && result.config.enabled) {
    throw new Error("REPORTING_LIVE_TEST_DENYLIST_WORKBOOK_ID is required when live tests are enabled.");
  }
  return result.config;
}

export function buildLiveTestRunTag(input?: {
  commitSha?: string;
  prefix?: string;
}): string {
  const prefix =
    input?.prefix?.trim() ||
    process.env.REPORTING_LIVE_TEST_RUN_TAG_PREFIX?.trim() ||
    "vantage-live-test";
  const sha = (input?.commitSha ?? process.env.GITHUB_SHA ?? "local")
    .slice(0, 12)
    .replace(/[^a-zA-Z0-9_-]/g, "");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const nonce = randomBytes(3).toString("hex");
  return `${prefix}-${sha}-${stamp}-${nonce}`;
}

export function buildLiveTestAppProperties(input: {
  runTag: string;
  runId: string;
  destinationId: string;
  role: (typeof LIVE_TEST_ALLOWED_ARTIFACT_ROLES)[number];
}): Record<string, string> {
  return {
    vantage_reporting_run_id: input.runId,
    vantage_reporting_destination_id: input.destinationId,
    vantage_reporting_role: input.role,
    vantage_reporting_marker_version: "1",
    [REPORTING_LIVE_TEST_APP_PROPERTY_KEY]: REPORTING_LIVE_TEST_MARKER_VERSION,
    [REPORTING_LIVE_TEST_TAG_PROPERTY_KEY]: input.runTag,
  };
}

export function isPositivelyMarkedHarnessContainer(input: {
  appProperties: Record<string, string> | null | undefined;
  exportRootFolderId: string;
  parentFolderIds: readonly string[];
  createdTimeMs: number;
  nowMs: number;
  artifactMaxAgeMs: number;
  expectedRunTagPrefix: string;
  mimeType?: string;
}): boolean {
  const props = input.appProperties ?? {};
  if (props.vantage_reporting_role !== "harness_container") return false;
  if (input.mimeType && input.mimeType !== GOOGLE_FOLDER_MIME_TYPE) return false;
  return isPositivelyMarkedLiveTestArtifact({
    ...input,
    mimeType: GOOGLE_FOLDER_MIME_TYPE,
  });
}
export function isPositivelyMarkedLiveTestArtifact(input: {
  appProperties: Record<string, string> | null | undefined;
  exportRootFolderId: string;
  parentFolderIds: readonly string[];
  createdTimeMs: number;
  nowMs: number;
  artifactMaxAgeMs: number;
  expectedRunTagPrefix: string;
  mimeType?: string;
}): boolean {
  const props = input.appProperties ?? {};
  if (props[REPORTING_LIVE_TEST_APP_PROPERTY_KEY] !== REPORTING_LIVE_TEST_MARKER_VERSION) {
    return false;
  }
  const runTag = props[REPORTING_LIVE_TEST_TAG_PROPERTY_KEY]?.trim();
  if (!runTag || !runTag.startsWith(`${input.expectedRunTagPrefix}-`)) return false;
  if (!LIVE_TEST_RUN_TAG_PREFIX_PATTERN.test(runTag)) return false;
  if (!input.parentFolderIds.includes(input.exportRootFolderId)) return false;
  if (input.mimeType && !LIVE_TEST_ALLOWED_MIME_TYPES.includes(input.mimeType as any)) {
    return false;
  }
  const role = props.vantage_reporting_role;
  if (!role || !LIVE_TEST_ALLOWED_ARTIFACT_ROLES.includes(role as any)) return false;
  const ageMs = input.nowMs - input.createdTimeMs;
  if (ageMs < input.artifactMaxAgeMs) return false;
  return Boolean(
    props.vantage_reporting_run_id?.trim() &&
      props.vantage_reporting_destination_id?.trim(),
  );
}

function parseArtifactMaxAgeMs(raw: string | undefined): number {
  const fallback = 60 * 60 * 1000;
  if (!raw?.trim()) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 60_000) {
    throw new Error(
      "REPORTING_LIVE_TEST_ARTIFACT_MAX_AGE_MS must be at least 60000.",
    );
  }
  return parsed;
}

function parseTransientFailures(raw: string | undefined): number {
  if (!raw?.trim()) return 0;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 3) {
    throw new Error(
      "REPORTING_LIVE_TEST_INJECT_TRANSIENT_FAILURES must be an integer from 0 to 3.",
    );
  }
  return parsed;
}
