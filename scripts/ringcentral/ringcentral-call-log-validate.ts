import { promises as fs } from "node:fs";
import mongoose from "mongoose";
import { getRequiredEnv } from "../../api/config/domain";
import type { RingCentralTokenCache } from "../../api/services/ringcentral/types";

process.env.RC_TOKEN_STORE = "file";

const ARTIFACT_PATH = "ringcentral-call-log-validation-output.json";
const SAMPLE_LIMIT = 5;

type RingCentralClientModule = typeof import("../../api/services/ringcentral/client");

type EndpointResult = {
  label: string;
  method: string;
  endpoint: string;
  ok: boolean;
  status: number | null;
  statusText: string | null;
  data?: any;
  error?: string;
  responseBody?: unknown;
};

type NormalizedCallLogRecord = {
  id?: string;
  sessionId?: string;
  telephonySessionId?: string;
  startTime?: string;
  duration?: number;
  direction?: string;
  type?: string;
  result?: string;
  action?: string;
  fromPhoneNumber?: string;
  fromName?: string;
  toPhoneNumber?: string;
  toName?: string;
  extensionId?: string;
  extensionNumber?: string;
  recordingId?: string;
};

type CallLogAnalysis = {
  recordCount: number;
  samples: NormalizedCallLogRecord[];
  uniqueExtensionIds: string[];
  uniqueFromPhoneNumbers: string[];
  uniqueToPhoneNumbers: string[];
  companyPhoneNumbersInLogs: string[];
  dateRange: {
    earliest: string | null;
    latest: string | null;
  };
  appearsToSpanMultipleExtensionsOrNumbers: "yes" | "no" | "unclear";
};

type ValidationSummary = {
  authSucceeded: boolean;
  tokenScopes: string;
  authenticatedExtensionId: string;
  authenticatedExtensionNumber: string;
  authenticatedExtensionName: string;
  authenticatedExtensionEmail: string;
  accountId: string;
  accountName: string;
  canListAccountExtensions: boolean;
  visibleExtensionCount: number;
  canListAccountPhoneNumbers: boolean;
  visiblePhoneNumberCount: number;
  canReadAccountLevelCallLogs: boolean;
  accountLevelCallLogRecordsReturned: number;
  canReadOwnExtensionCallLogs: boolean;
  extensionLevelCallLogRecordsReturned: number;
  accountLevelLogsIncludeMultipleExtensionsNumbers: "yes" | "no" | "unclear";
  likelyOrganizationLevelCallAccess: "yes" | "no" | "unclear";
  recommendedNextStep: string;
};

async function main(): Promise<void> {
  const client = await import("../../api/services/ringcentral/client.js");
  const serverUrl = getRequiredEnv("RC_SERVER_URL");

  console.log("RingCentral Phase 1 Call Log Validation");
  console.log(`RC_SERVER_URL: ${serverUrl}`);
  console.log("Token store: file (.ringcentral-token-cache.json)");
  console.log("");

  const token = await getToken(client);
  logTokenSummary(token);

  const artifact: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    rcServerUrl: serverUrl,
    token: safeTokenSummary(token),
    endpoints: {},
    analyses: {},
    summary: null,
  };

  const extensionResult = await checkEndpoint(
    client,
    "Current authenticated extension",
    "GET",
    "/restapi/v1.0/account/~/extension/~",
  );
  logExtension(extensionResult);

  const accountResult = await checkEndpoint(
    client,
    "Current account",
    "GET",
    "/restapi/v1.0/account/~",
  );
  logAccount(accountResult);

  const extensionsResult = await checkEndpoint(
    client,
    "Account extensions",
    "GET",
    "/restapi/v1.0/account/~/extension?perPage=100",
  );
  logExtensions(extensionsResult);

  const phoneNumbersResult = await checkEndpoint(
    client,
    "Account phone numbers",
    "GET",
    "/restapi/v1.0/account/~/phone-number?perPage=100",
  );
  logPhoneNumbers(phoneNumbersResult);

  const companyPhoneNumbers = extractPhoneNumbers(phoneNumbersResult.data);

  const accountCallLogsResult = await checkEndpoint(
    client,
    "Account-level call logs",
    "GET",
    "/restapi/v1.0/account/~/call-log?perPage=20&view=Detailed",
  );
  const accountCallLogAnalysis = analyzeCallLogs(
    accountCallLogsResult.data,
    companyPhoneNumbers,
  );
  logCallLogAnalysis(accountCallLogsResult, accountCallLogAnalysis);

  const extensionCallLogsResult = await checkEndpoint(
    client,
    "Own extension-level call logs",
    "GET",
    "/restapi/v1.0/account/~/extension/~/call-log?perPage=20&view=Detailed",
  );
  const extensionCallLogAnalysis = analyzeCallLogs(
    extensionCallLogsResult.data,
    companyPhoneNumbers,
  );
  logCallLogAnalysis(extensionCallLogsResult, extensionCallLogAnalysis);

  const timeWindowResults = await runOptionalTimeWindowValidation(
    client,
    companyPhoneNumbers,
  );

  const summary = buildSummary({
    token,
    extensionResult,
    accountResult,
    extensionsResult,
    phoneNumbersResult,
    accountCallLogsResult,
    accountCallLogAnalysis,
    extensionCallLogsResult,
    extensionCallLogAnalysis,
  });

  artifact.endpoints = sanitize({
    extension: extensionResult,
    account: accountResult,
    extensions: extensionsResult,
    phoneNumbers: phoneNumbersResult,
    accountCallLogs: accountCallLogsResult,
    extensionCallLogs: extensionCallLogsResult,
    timeWindow: timeWindowResults,
  });
  artifact.analyses = sanitize({
    accountCallLogs: accountCallLogAnalysis,
    extensionCallLogs: extensionCallLogAnalysis,
    timeWindow: timeWindowResults.map((result) => ({
      label: result.endpoint.label,
      analysis: result.analysis,
    })),
  });
  artifact.summary = summary;

  await fs.writeFile(ARTIFACT_PATH, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log("");
  console.log(`Wrote sanitized diagnostic artifact: ${ARTIFACT_PATH}`);
  printSummary(summary);
}

async function getToken(
  client: RingCentralClientModule,
): Promise<RingCentralTokenCache> {
  try {
    return await client.getValidToken();
  } catch (error) {
    console.error(
      `RingCentral auth failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    throw error;
  }
}

async function checkEndpoint(
  client: RingCentralClientModule,
  label: string,
  method: string,
  endpoint: string,
): Promise<EndpointResult> {
  console.log(`Calling ${method} ${endpoint}`);
  try {
    const data = await client.ringCentralRequest(method, endpoint);
    console.log(`${label}: success (200 OK)`);
    return {
      label,
      method,
      endpoint,
      ok: true,
      status: 200,
      statusText: "OK",
      data,
    };
  } catch (error) {
    const apiError = toRingCentralApiError(error);
    if (apiError) {
      console.log(
        `${label}: failed (${apiError.status} ${apiError.statusText})`,
      );
      return {
        label,
        method: apiError.method,
        endpoint: apiError.endpoint,
        ok: false,
        status: apiError.status,
        statusText: apiError.statusText,
        error: apiError.message,
        responseBody: apiError.responseBody,
      };
    }

    const message = error instanceof Error ? error.message : String(error);
    console.log(`${label}: failed (${message})`);
    return {
      label,
      method,
      endpoint,
      ok: false,
      status: null,
      statusText: null,
      error: message,
    };
  } finally {
    console.log("");
  }
}

async function runOptionalTimeWindowValidation(
  client: RingCentralClientModule,
  companyPhoneNumbers: Set<string>,
): Promise<Array<{ endpoint: EndpointResult; analysis: CallLogAnalysis }>> {
  const dateFrom = process.env.RC_VALIDATE_DATE_FROM?.trim();
  const dateTo = process.env.RC_VALIDATE_DATE_TO?.trim();
  if (!dateFrom && !dateTo) {
    console.log(
      "Targeted time window test: skipped (set RC_VALIDATE_DATE_FROM and RC_VALIDATE_DATE_TO)",
    );
    console.log("");
    return [];
  }

  if (!dateFrom || !dateTo) {
    console.log(
      "Targeted time window test: skipped (both RC_VALIDATE_DATE_FROM and RC_VALIDATE_DATE_TO are required)",
    );
    console.log("");
    return [];
  }

  const query = new URLSearchParams({
    dateFrom,
    dateTo,
    perPage: "100",
    view: "Detailed",
  });
  const endpoints = [
    {
      label: "Account-level call logs for targeted time window",
      endpoint: `/restapi/v1.0/account/~/call-log?${query.toString()}`,
    },
    {
      label: "Own extension-level call logs for targeted time window",
      endpoint: `/restapi/v1.0/account/~/extension/~/call-log?${query.toString()}`,
    },
  ];

  const results: Array<{ endpoint: EndpointResult; analysis: CallLogAnalysis }> =
    [];
  for (const item of endpoints) {
    const endpointResult = await checkEndpoint(
      client,
      item.label,
      "GET",
      item.endpoint,
    );
    const analysis = analyzeCallLogs(endpointResult.data, companyPhoneNumbers);
    logCallLogAnalysis(endpointResult, analysis);
    results.push({ endpoint: endpointResult, analysis });
  }

  return results;
}

function logTokenSummary(token: RingCentralTokenCache): void {
  console.log("Token summary");
  console.log(`token_type: ${token.token_type ?? ""}`);
  console.log(`scope: ${token.scope ?? ""}`);
  console.log(`owner_id: ${token.owner_id ?? ""}`);
  console.log(`endpoint_id: ${token.endpoint_id ?? ""}`);
  console.log(
    `access_token_expires_at: ${new Date(
      token.access_token_expires_at,
    ).toISOString()}`,
  );
  console.log(
    `refresh_token_expires_at: ${
      token.refresh_token_expires_at
        ? new Date(token.refresh_token_expires_at).toISOString()
        : ""
    }`,
  );
  console.log("");
}

function logExtension(result: EndpointResult): void {
  const data = result.data;
  console.log("Authenticated extension details");
  console.log(`id: ${valueToString(data?.id) ?? ""}`);
  console.log(`extensionNumber: ${valueToString(data?.extensionNumber) ?? ""}`);
  console.log(`name: ${valueToString(data?.name) ?? ""}`);
  console.log(`status: ${valueToString(data?.status) ?? ""}`);
  console.log(`type: ${valueToString(data?.type) ?? ""}`);
  console.log(`contact.email: ${valueToString(data?.contact?.email) ?? ""}`);
  console.log(
    `contact.firstName: ${valueToString(data?.contact?.firstName) ?? ""}`,
  );
  console.log(
    `contact.lastName: ${valueToString(data?.contact?.lastName) ?? ""}`,
  );
  console.log("");
}

function logAccount(result: EndpointResult): void {
  const data = result.data;
  console.log("Account details");
  console.log(`id: ${valueToString(data?.id) ?? ""}`);
  console.log(`name: ${valueToString(data?.name) ?? ""}`);
  console.log(`status: ${valueToString(data?.status) ?? ""}`);
  console.log(
    `serviceInfo.brand.name: ${
      valueToString(data?.serviceInfo?.brand?.name) ?? ""
    }`,
  );
  console.log(`mainNumber: ${valueToString(data?.mainNumber) ?? ""}`);
  console.log("");
}

function logExtensions(result: EndpointResult): void {
  const records = getRecords(result.data);
  console.log("Account extension visibility");
  console.log(`success: ${yesNo(result.ok)}`);
  console.log(`record count: ${records.length}`);
  console.log(
    `first 10: ${JSON.stringify(
      records.slice(0, 10).map((record) => ({
        id: record.id,
        extensionNumber: record.extensionNumber,
        name: record.name,
      })),
      null,
      2,
    )}`,
  );
  console.log(`multiple extensions visible: ${yesNo(records.length > 1)}`);
  console.log("");
}

function logPhoneNumbers(result: EndpointResult): void {
  const records = getRecords(result.data);
  console.log("Account phone-number visibility");
  console.log(`success: ${yesNo(result.ok)}`);
  console.log(`record count: ${records.length}`);
  console.log(
    `first 20: ${JSON.stringify(
      records.slice(0, 20).map((record) => ({
        phoneNumber: record.phoneNumber,
        usageType: record.usageType,
        type: record.type,
        status: record.status,
        extension: record.extension
          ? {
              id: record.extension.id,
              extensionNumber: record.extension.extensionNumber,
            }
          : undefined,
      })),
      null,
      2,
    )}`,
  );
  console.log("");
}

function logCallLogAnalysis(
  result: EndpointResult,
  analysis: CallLogAnalysis,
): void {
  console.log(result.label);
  console.log(`success: ${yesNo(result.ok)}`);
  console.log(`HTTP status: ${result.status ?? ""} ${result.statusText ?? ""}`);
  console.log(`record count: ${analysis.recordCount}`);
  console.log(
    `sample normalized records: ${JSON.stringify(analysis.samples, null, 2)}`,
  );
  console.log(
    `unique extension IDs present: ${analysis.uniqueExtensionIds.join(", ")}`,
  );
  console.log(
    `unique from phone numbers: ${analysis.uniqueFromPhoneNumbers.join(", ")}`,
  );
  console.log(`unique to phone numbers: ${analysis.uniqueToPhoneNumbers.join(", ")}`);
  console.log(
    `company phone numbers in logs: ${analysis.companyPhoneNumbersInLogs.join(
      ", ",
    )}`,
  );
  console.log(
    `date range: ${analysis.dateRange.earliest ?? ""} to ${
      analysis.dateRange.latest ?? ""
    }`,
  );
  console.log(
    `appears to span multiple users/extensions/numbers: ${analysis.appearsToSpanMultipleExtensionsOrNumbers}`,
  );
  console.log("");
}

function analyzeCallLogs(
  payload: any,
  companyPhoneNumbers: Set<string>,
): CallLogAnalysis {
  const records = getRecords(payload);
  const normalized = records.map(normalizeCallLogRecord);
  const uniqueExtensionIds = new Set<string>();
  const uniqueFromPhoneNumbers = new Set<string>();
  const uniqueToPhoneNumbers = new Set<string>();
  const companyPhoneNumbersInLogs = new Set<string>();
  const startTimes: string[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const item = normalized[index];

    addIfPresent(uniqueExtensionIds, item.extensionId);
    for (const extensionId of extractExtensionIds(record)) {
      addIfPresent(uniqueExtensionIds, extensionId);
    }

    addIfPresent(uniqueFromPhoneNumbers, item.fromPhoneNumber);
    addIfPresent(uniqueToPhoneNumbers, item.toPhoneNumber);
    addCompanyPhoneNumber(companyPhoneNumbersInLogs, companyPhoneNumbers, item.fromPhoneNumber);
    addCompanyPhoneNumber(companyPhoneNumbersInLogs, companyPhoneNumbers, item.toPhoneNumber);

    if (item.startTime) {
      startTimes.push(item.startTime);
    }
  }

  startTimes.sort();

  return {
    recordCount: records.length,
    samples: normalized.slice(0, SAMPLE_LIMIT),
    uniqueExtensionIds: [...uniqueExtensionIds].sort(),
    uniqueFromPhoneNumbers: [...uniqueFromPhoneNumbers].sort(),
    uniqueToPhoneNumbers: [...uniqueToPhoneNumbers].sort(),
    companyPhoneNumbersInLogs: [...companyPhoneNumbersInLogs].sort(),
    dateRange: {
      earliest: startTimes[0] ?? null,
      latest: startTimes[startTimes.length - 1] ?? null,
    },
    appearsToSpanMultipleExtensionsOrNumbers: inferMultipleCallSources({
      recordCount: records.length,
      uniqueExtensionIds,
      companyPhoneNumbersInLogs,
    }),
  };
}

function normalizeCallLogRecord(record: any): NormalizedCallLogRecord {
  return {
    id: valueToString(record?.id),
    sessionId: valueToString(record?.sessionId),
    telephonySessionId: valueToString(record?.telephonySessionId),
    startTime: valueToString(record?.startTime),
    duration:
      typeof record?.duration === "number" ? record.duration : undefined,
    direction: valueToString(record?.direction),
    type: valueToString(record?.type),
    result: valueToString(record?.result),
    action: valueToString(record?.action),
    fromPhoneNumber: valueToString(record?.from?.phoneNumber),
    fromName: valueToString(record?.from?.name),
    toPhoneNumber: valueToString(record?.to?.phoneNumber),
    toName: valueToString(record?.to?.name),
    extensionId: valueToString(record?.extension?.id),
    extensionNumber: valueToString(record?.extension?.extensionNumber),
    recordingId: valueToString(record?.recording?.id),
  };
}

function buildSummary(input: {
  token: RingCentralTokenCache;
  extensionResult: EndpointResult;
  accountResult: EndpointResult;
  extensionsResult: EndpointResult;
  phoneNumbersResult: EndpointResult;
  accountCallLogsResult: EndpointResult;
  accountCallLogAnalysis: CallLogAnalysis;
  extensionCallLogsResult: EndpointResult;
  extensionCallLogAnalysis: CallLogAnalysis;
}): ValidationSummary {
  const likelyOrganizationLevelCallAccess =
    inferLikelyOrganizationLevelCallAccess(input);
  return {
    authSucceeded: input.extensionResult.ok,
    tokenScopes: input.token.scope ?? "",
    authenticatedExtensionId:
      valueToString(input.extensionResult.data?.id) ?? "",
    authenticatedExtensionNumber:
      valueToString(input.extensionResult.data?.extensionNumber) ?? "",
    authenticatedExtensionName:
      valueToString(input.extensionResult.data?.name) ?? "",
    authenticatedExtensionEmail:
      valueToString(input.extensionResult.data?.contact?.email) ?? "",
    accountId: valueToString(input.accountResult.data?.id) ?? "",
    accountName: valueToString(input.accountResult.data?.name) ?? "",
    canListAccountExtensions: input.extensionsResult.ok,
    visibleExtensionCount: getRecords(input.extensionsResult.data).length,
    canListAccountPhoneNumbers: input.phoneNumbersResult.ok,
    visiblePhoneNumberCount: getRecords(input.phoneNumbersResult.data).length,
    canReadAccountLevelCallLogs: input.accountCallLogsResult.ok,
    accountLevelCallLogRecordsReturned:
      input.accountCallLogAnalysis.recordCount,
    canReadOwnExtensionCallLogs: input.extensionCallLogsResult.ok,
    extensionLevelCallLogRecordsReturned:
      input.extensionCallLogAnalysis.recordCount,
    accountLevelLogsIncludeMultipleExtensionsNumbers:
      input.accountCallLogAnalysis.appearsToSpanMultipleExtensionsOrNumbers,
    likelyOrganizationLevelCallAccess,
    recommendedNextStep: recommendedNextStep(input, likelyOrganizationLevelCallAccess),
  };
}

function inferLikelyOrganizationLevelCallAccess(input: {
  extensionResult: EndpointResult;
  accountCallLogsResult: EndpointResult;
  accountCallLogAnalysis: CallLogAnalysis;
  extensionCallLogsResult: EndpointResult;
}): "yes" | "no" | "unclear" {
  if (
    input.accountCallLogsResult.ok &&
    input.accountCallLogAnalysis.recordCount > 0 &&
    input.accountCallLogAnalysis.appearsToSpanMultipleExtensionsOrNumbers === "yes"
  ) {
    return "yes";
  }

  if (
    input.extensionCallLogsResult.ok &&
    !input.accountCallLogsResult.ok &&
    isPermissionStatus(input.accountCallLogsResult.status)
  ) {
    return "no";
  }

  if (
    !input.extensionResult.ok ||
    (!input.accountCallLogsResult.ok && !input.extensionCallLogsResult.ok)
  ) {
    return "no";
  }

  return "unclear";
}

function recommendedNextStep(
  input: {
    extensionResult: EndpointResult;
    accountCallLogsResult: EndpointResult;
    extensionCallLogsResult: EndpointResult;
  },
  likelyOrganizationLevelCallAccess: "yes" | "no" | "unclear",
): string {
  if (
    !input.extensionResult.ok ||
    (!input.accountCallLogsResult.ok && !input.extensionCallLogsResult.ok)
  ) {
    return "RingCentral authentication or call-log permissions are not correctly configured. Verify RC_SERVER_URL, Client ID, Client Secret, JWT, app scopes, and JWT user permissions.";
  }

  if (likelyOrganizationLevelCallAccess === "no") {
    return "Authentication works, but the JWT user likely lacks account-level call-log permissions. Check the RingCentral app scopes and the JWT user's RingCentral role/admin permissions.";
  }

  if (likelyOrganizationLevelCallAccess === "yes") {
    return "Run a controlled test-call window, then proceed to designing lead ingestion around account-level call-log data.";
  }

  return "Run controlled test calls and rerun with RC_VALIDATE_DATE_FROM/RC_VALIDATE_DATE_TO to prove whether account-level logs include all expected organization calls.";
}

function printSummary(summary: ValidationSummary): void {
  console.log("");
  console.log("RingCentral Phase 1 Call Log Validation Summary");
  console.log(`Auth succeeded: ${yesNo(summary.authSucceeded)}`);
  console.log(`Token scopes returned by RingCentral: ${summary.tokenScopes}`);
  console.log(
    `Authenticated extension ID: ${summary.authenticatedExtensionId}`,
  );
  console.log(
    `Authenticated extension number: ${summary.authenticatedExtensionNumber}`,
  );
  console.log(
    `Authenticated extension name: ${summary.authenticatedExtensionName}`,
  );
  console.log(
    `Authenticated extension email: ${summary.authenticatedExtensionEmail}`,
  );
  console.log(`Account ID: ${summary.accountId}`);
  console.log(`Account name: ${summary.accountName}`);
  console.log(
    `Can list account extensions: ${yesNo(summary.canListAccountExtensions)}`,
  );
  console.log(`Visible extension count: ${summary.visibleExtensionCount}`);
  console.log(
    `Can list account phone numbers: ${yesNo(
      summary.canListAccountPhoneNumbers,
    )}`,
  );
  console.log(`Visible phone number count: ${summary.visiblePhoneNumberCount}`);
  console.log(
    `Can read account-level call logs: ${yesNo(
      summary.canReadAccountLevelCallLogs,
    )}`,
  );
  console.log(
    `Account-level call-log records returned: ${summary.accountLevelCallLogRecordsReturned}`,
  );
  console.log(
    `Can read own extension call logs: ${yesNo(
      summary.canReadOwnExtensionCallLogs,
    )}`,
  );
  console.log(
    `Extension-level call-log records returned: ${summary.extensionLevelCallLogRecordsReturned}`,
  );
  console.log(
    `Account-level logs include multiple extensions/numbers: ${summary.accountLevelLogsIncludeMultipleExtensionsNumbers}`,
  );
  console.log(
    `Likely organization-level call access: ${summary.likelyOrganizationLevelCallAccess}`,
  );
  console.log(`Recommended next step: ${summary.recommendedNextStep}`);
}

function extractPhoneNumbers(payload: any): Set<string> {
  const phoneNumbers = new Set<string>();
  for (const record of getRecords(payload)) {
    addIfPresent(phoneNumbers, normalizePhoneNumber(record?.phoneNumber));
  }
  return phoneNumbers;
}

function extractExtensionIds(record: any): string[] {
  const extensionIds = new Set<string>();
  addIfPresent(extensionIds, valueToString(record?.extension?.id));

  const legs = Array.isArray(record?.legs) ? record.legs : [];
  for (const leg of legs) {
    addIfPresent(extensionIds, valueToString(leg?.extension?.id));
    addIfPresent(extensionIds, valueToString(leg?.from?.extensionId));
    addIfPresent(extensionIds, valueToString(leg?.to?.extensionId));
  }

  return [...extensionIds];
}

function inferMultipleCallSources(input: {
  recordCount: number;
  uniqueExtensionIds: Set<string>;
  companyPhoneNumbersInLogs: Set<string>;
}): "yes" | "no" | "unclear" {
  if (
    input.uniqueExtensionIds.size > 1 ||
    input.companyPhoneNumbersInLogs.size > 1
  ) {
    return "yes";
  }

  if (input.recordCount === 0) {
    return "unclear";
  }

  return "unclear";
}

function addCompanyPhoneNumber(
  target: Set<string>,
  companyPhoneNumbers: Set<string>,
  value: string | undefined,
): void {
  const normalized = normalizePhoneNumber(value);
  if (normalized && companyPhoneNumbers.has(normalized)) {
    target.add(normalized);
  }
}

function addIfPresent(target: Set<string>, value: string | undefined): void {
  if (value) {
    target.add(value);
  }
}

function getRecords(payload: any): any[] {
  return Array.isArray(payload?.records) ? payload.records : [];
}

function isPermissionStatus(status: number | null): boolean {
  return status === 401 || status === 403;
}

function safeTokenSummary(token: RingCentralTokenCache): Record<string, unknown> {
  return {
    token_type: token.token_type ?? null,
    scope: token.scope ?? null,
    owner_id: token.owner_id ?? null,
    endpoint_id: token.endpoint_id ?? null,
    issued_at: new Date(token.issued_at).toISOString(),
    access_token_expires_at: new Date(token.access_token_expires_at).toISOString(),
    refresh_token_expires_at: token.refresh_token_expires_at
      ? new Date(token.refresh_token_expires_at).toISOString()
      : null,
  };
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitize);
  }

  if (value && typeof value === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (isSensitiveKey(key)) {
        sanitized[key] = "[REDACTED]";
      } else {
        sanitized[key] = sanitize(entry);
      }
    }
    return sanitized;
  }

  return value;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized.includes("access_token") ||
    normalized.includes("refresh_token") ||
    normalized.includes("authorization") ||
    normalized.includes("client_secret") ||
    normalized.includes("jwt") ||
    normalized === "assertion" ||
    normalized === "token"
  );
}

function toRingCentralApiError(error: unknown):
  | {
      message: string;
      status: number;
      statusText: string;
      endpoint: string;
      method: string;
      responseBody: unknown;
    }
  | null {
  if (
    error &&
    typeof error === "object" &&
    "name" in error &&
    error.name === "RingCentralApiError" &&
    "status" in error &&
    "endpoint" in error
  ) {
    return error as unknown as {
      message: string;
      status: number;
      statusText: string;
      endpoint: string;
      method: string;
      responseBody: unknown;
    };
  }

  return null;
}

function normalizePhoneNumber(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const digits = value.replace(/\D/g, "");
  if (!digits) {
    return undefined;
  }

  return digits.length === 11 && digits.startsWith("1")
    ? `+${digits}`
    : value.startsWith("+")
      ? `+${digits}`
      : digits;
}

function valueToString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return undefined;
}

function yesNo(value: boolean): "yes" | "no" {
  return value ? "yes" : "no";
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });
