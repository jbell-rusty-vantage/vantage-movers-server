import mongoose from "mongoose";
import {
  getValidToken,
  ringCentralRequest,
  RingCentralApiError,
} from "../../api/services/ringcentral/client";

type EndpointResult = {
  ok: boolean;
  status: number | null;
  data?: any;
  error?: string;
};

type ExtensionSummary = {
  id?: string | number;
  extensionNumber?: string;
  name?: string;
  email?: string;
};

type RecordingProbeTarget = {
  id: string;
  contentUri?: string;
};

async function main(): Promise<void> {
  const summary = {
    authSucceeded: false,
    scopes: "",
    extension: {} as ExtensionSummary,
    accountId: "",
    accountName: "",
    canListExtensions: false,
    canListAccountPhoneNumbers: false,
    canReadAccountCallLogs: false,
    canReadDetailedAccountCallLogs: false,
    canReadOwnExtensionCallLogs: false,
    canReadContacts: false,
    canAccessRecordings: "not tested" as "yes" | "no" | "not tested",
    likelyOrganizationLevelAccess: "unclear" as "yes" | "no" | "unclear",
  };

  let tokenRetrieved = false;
  try {
    const token = await getValidToken();
    tokenRetrieved = true;
    summary.scopes = token.scope ?? "";
  } catch (error) {
    printSummary(summary);
    console.error(
      `RingCentral auth failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
    return;
  }

  const extensionResult = await checkEndpoint(
    "JWT user/extension",
    "/restapi/v1.0/account/~/extension/~",
  );
  summary.authSucceeded = tokenRetrieved && extensionResult.ok;
  if (extensionResult.ok) {
    summary.extension = summarizeExtension(extensionResult.data);
  }

  const accountResult = await checkEndpoint(
    "account/org",
    "/restapi/v1.0/account/~",
  );
  if (accountResult.ok) {
    summary.accountId = valueToString(accountResult.data?.id) ?? "";
    summary.accountName = valueToString(accountResult.data?.name) ?? "";
  }

  const extensionsResult = await checkEndpoint(
    "account extensions",
    "/restapi/v1.0/account/~/extension?perPage=100",
  );
  summary.canListExtensions = extensionsResult.ok;

  const phoneNumbersResult = await checkEndpoint(
    "account phone numbers",
    "/restapi/v1.0/account/~/phone-number?perPage=100",
  );
  summary.canListAccountPhoneNumbers = phoneNumbersResult.ok;

  const accountCallLogsResult = await checkEndpoint(
    "account call logs",
    "/restapi/v1.0/account/~/call-log?perPage=10",
  );
  summary.canReadAccountCallLogs = accountCallLogsResult.ok;

  const detailedAccountCallLogsResult = await checkEndpoint(
    "detailed account call logs",
    "/restapi/v1.0/account/~/call-log?perPage=10&view=Detailed",
  );
  summary.canReadDetailedAccountCallLogs = detailedAccountCallLogsResult.ok;

  const extensionCallLogsResult = await checkEndpoint(
    "own extension call logs",
    "/restapi/v1.0/account/~/extension/~/call-log?perPage=10",
  );
  summary.canReadOwnExtensionCallLogs = extensionCallLogsResult.ok;

  const contactsResult = await checkEndpoint(
    "contacts",
    "/restapi/v1.0/account/~/extension/~/address-book/contact?perPage=10",
  );
  summary.canReadContacts = contactsResult.ok;

  const recordingTarget = findRecordingProbeTarget([
    detailedAccountCallLogsResult.data,
    accountCallLogsResult.data,
    extensionCallLogsResult.data,
  ]);
  if (recordingTarget) {
    const recordingResult = await probeRecordingAccess(recordingTarget);
    console.log(
      `recording content: ${
        recordingResult.ok ? "success" : `failed (${recordingResult.status})`
      }`,
    );
    summary.canAccessRecordings = recordingResult.ok ? "yes" : "no";
  }

  summary.likelyOrganizationLevelAccess = inferOrganizationLevelAccess(summary);
  printSummary(summary);
}

async function checkEndpoint(
  label: string,
  endpoint: string,
  method = "GET",
): Promise<EndpointResult> {
  try {
    const data = await ringCentralRequest(method, endpoint);
    console.log(`${label}: success`);
    return { ok: true, status: 200, data };
  } catch (error) {
    if (error instanceof RingCentralApiError) {
      console.log(`${label}: failed (${error.status})`);
      return { ok: false, status: error.status, error: error.message };
    }

    console.log(
      `${label}: failed (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
    return {
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function summarizeExtension(data: any): ExtensionSummary {
  return {
    id: data?.id,
    extensionNumber: valueToString(data?.extensionNumber),
    name: valueToString(data?.name),
    email: valueToString(data?.contact?.email),
  };
}

async function probeRecordingAccess(
  recording: RecordingProbeTarget,
): Promise<EndpointResult> {
  if (!recording.contentUri) {
    return checkEndpoint(
      "recording content",
      `/restapi/v1.0/account/~/recording/${encodeURIComponent(recording.id)}/content`,
      "GET",
    );
  }

  try {
    const token = await getValidToken();
    const response = await fetch(recording.contentUri, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        Range: "bytes=0-0",
      },
    });
    await response.body?.cancel();
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function findRecordingProbeTarget(payloads: any[]): RecordingProbeTarget | null {
  for (const payload of payloads) {
    const records = Array.isArray(payload?.records) ? payload.records : [];
    for (const record of records) {
      const recordingId = valueToString(record?.recording?.id);
      if (recordingId) {
        return {
          id: recordingId,
          contentUri: valueToString(record?.recording?.contentUri),
        };
      }
    }
  }

  return null;
}

function inferOrganizationLevelAccess(summary: {
  canListExtensions: boolean;
  canListAccountPhoneNumbers: boolean;
  canReadAccountCallLogs: boolean;
  canReadDetailedAccountCallLogs: boolean;
  canReadOwnExtensionCallLogs: boolean;
}): "yes" | "no" | "unclear" {
  if (
    summary.canListExtensions &&
    summary.canListAccountPhoneNumbers &&
    (summary.canReadAccountCallLogs || summary.canReadDetailedAccountCallLogs)
  ) {
    return "yes";
  }

  if (
    summary.canReadOwnExtensionCallLogs &&
    !summary.canReadAccountCallLogs &&
    !summary.canReadDetailedAccountCallLogs
  ) {
    return "no";
  }

  return "unclear";
}

function printSummary(summary: {
  authSucceeded: boolean;
  scopes: string;
  extension: ExtensionSummary;
  accountId: string;
  accountName: string;
  canListExtensions: boolean;
  canListAccountPhoneNumbers: boolean;
  canReadAccountCallLogs: boolean;
  canReadDetailedAccountCallLogs: boolean;
  canReadOwnExtensionCallLogs: boolean;
  canReadContacts: boolean;
  canAccessRecordings: "yes" | "no" | "not tested";
  likelyOrganizationLevelAccess: "yes" | "no" | "unclear";
}): void {
  console.log("");
  console.log("RingCentral diagnostic summary");
  console.log(`Auth succeeded: ${yesNo(summary.authSucceeded)}`);
  console.log(`Token scopes returned by RingCentral: ${summary.scopes}`);
  console.log(
    `Authenticated extension ID: ${valueToString(summary.extension.id) ?? ""}`,
  );
  console.log(
    `Authenticated extension number: ${summary.extension.extensionNumber ?? ""}`,
  );
  console.log(`Authenticated extension name: ${summary.extension.name ?? ""}`);
  console.log(`Authenticated extension email: ${summary.extension.email ?? ""}`);
  console.log(`Account ID: ${summary.accountId}`);
  console.log(`Account name: ${summary.accountName}`);
  console.log(`Can list extensions: ${yesNo(summary.canListExtensions)}`);
  console.log(
    `Can list account phone numbers: ${yesNo(
      summary.canListAccountPhoneNumbers,
    )}`,
  );
  console.log(
    `Can read account call logs: ${yesNo(summary.canReadAccountCallLogs)}`,
  );
  console.log(
    `Can read detailed account call logs: ${yesNo(
      summary.canReadDetailedAccountCallLogs,
    )}`,
  );
  console.log(
    `Can read own extension call logs: ${yesNo(
      summary.canReadOwnExtensionCallLogs,
    )}`,
  );
  console.log(`Can read contacts: ${yesNo(summary.canReadContacts)}`);
  console.log(`Can access recordings: ${summary.canAccessRecordings}`);
  console.log(
    `Likely organization-level access: ${summary.likelyOrganizationLevelAccess}`,
  );
}

function yesNo(value: boolean): "yes" | "no" {
  return value ? "yes" : "no";
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
