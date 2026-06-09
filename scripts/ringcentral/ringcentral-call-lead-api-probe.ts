import { promises as fs } from "node:fs";
import mongoose from "mongoose";
import {
  RINGCENTRAL_INBOUND_NUMBER_TO_SOURCE,
  resolveRingCentralInboundSource,
} from "../../api/services/ringcentral/call-lead-sources";
import { CALL_LEAD_MINIMUM_ANSWERED_SECONDS } from "../../api/services/ringcentral/call-candidate-evaluator";
import { vetRingCentralCallLogRecord } from "../../api/services/ringcentral/call-log-vetting";
import { normalizePhoneNumberToE164Like } from "../../api/services/ringcentral/phone-normalization";

process.env.RC_TOKEN_STORE = "file";

const ARTIFACT_PATH = "ringcentral-call-lead-api-probe-output.json";
const DEFAULT_LOOKBACK_HOURS = 48;
const DEFAULT_LIMIT = 200;
const DEFAULT_ANALYTICS_END_BUFFER_MS = 2 * 60 * 1000;
const MAX_CALL_LOG_PAGES = 20;

const DEFAULT_TARGET_CALLERS = [
  "(541) 982-5333",
  "(602) 391-8047",
  "(240) 426-1067",
  "(207) 266-8865",
  "(323) 514-4985",
] as const;

const TARGET_QUEUES = [
  { extensionNumber: "514", name: "10BEST LANDING" },
  { extensionNumber: "516", name: "TBM Prime Inbounds" },
  { extensionNumber: "529", name: "TOP 10 INBOUNDS" },
  { extensionNumber: "519", name: "Main Site Inbounds" },
] as const;

type RingCentralClientModule = typeof import("../../api/services/ringcentral/client");

type ProbeOptions = {
  dateFrom: string;
  dateTo: string;
  limit: number;
  json: boolean;
  callerNumbers: string[];
  sourceNumbers: string[];
};

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

type QueueExtension = {
  id: string | null;
  extensionNumber: string;
  name: string;
};

type LeadCandidateProbe = {
  callLogId: string | null;
  sessionId: string | null;
  telephonySessionId: string | null;
  startTime: string | null;
  durationSeconds: number | null;
  direction: string | null;
  type: string | null;
  result: string | null;
  action: string | null;
  callerPhoneNumber: string | null;
  callerName: string | null;
  targetPhoneNumber: string | null;
  targetName: string | null;
  sourceLabel: string | null;
  sourceCompany: string | null;
  matchedTargetNumber: boolean;
  matchedQueue: boolean;
  matchedQueueExtensions: QueueExtension[];
  answered: boolean;
  overMinimumDuration: boolean;
  wouldCreateCallLead: boolean;
  rejectionReasons: string[];
  productionQualifies: boolean;
  productionRejectionReasons: string[];
  matchedExplicitCaller: boolean;
  matchedExplicitSource: boolean;
  rawSummary: {
    legCount: number;
    legTypes: string[];
    legResults: string[];
    legExtensionIds: string[];
  };
};

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const client = await import("../../api/services/ringcentral/client.js");

  console.log("RingCentral Call Lead API Probe");
  console.log(`Window: ${options.dateFrom} to ${options.dateTo}`);
  console.log(`Minimum answered duration: ${CALL_LEAD_MINIMUM_ANSWERED_SECONDS}s`);
  console.log("Token store: file (.ringcentral-token-cache.json)");
  console.log(`Explicit caller search: ${options.callerNumbers.join(", ") || "(none)"}`);
  console.log(`Explicit source search: ${options.sourceNumbers.join(", ") || "(none)"}`);
  console.log("");

  const extensionDirectoryResult = await checkEndpoint(
    client,
    "Account extensions",
    "GET",
    "/restapi/v1.0/account/~/extension?perPage=1000",
  );
  const queueExtensions = resolveTargetQueueExtensions(extensionDirectoryResult.data);
  printQueueResolution(queueExtensions);

  const callLogResult = await fetchDetailedInboundCallLogs(client, options);
  const candidates = analyzeCallLogs(callLogResult.data, queueExtensions, options);
  printCandidateSummary(candidates, options);
  printExplicitCallerSummary(candidates, options);

  const analyticsResults = await runAnalyticsProbes(client, options, queueExtensions);
  printAnalyticsSummary(analyticsResults);

  const artifact = {
    generatedAt: new Date().toISOString(),
    options,
    targetNumbers: Object.keys(RINGCENTRAL_INBOUND_NUMBER_TO_SOURCE),
    targetQueues: TARGET_QUEUES,
    queueExtensions,
    endpoints: {
      extensionDirectory: extensionDirectoryResult,
      callLog: callLogResult,
      analytics: analyticsResults,
    },
    callLogProbe: {
      totalRecords: getRecords(callLogResult.data).length,
      candidateCount: candidates.length,
      qualifiedCount: candidates.filter((candidate) => candidate.wouldCreateCallLead)
        .length,
      explicitCallerNumbers: options.callerNumbers,
      explicitSourceNumbers: options.sourceNumbers,
      explicitCallerMatches: candidates.filter((candidate) => candidate.matchedExplicitCaller)
        .length,
      candidates,
    },
    researchNotes: {
      callLog:
        "Detailed account Call Log returns individual records and legs, so it is the best fit for promoting exact call leads.",
      analyticsAggregate:
        "Analytics Aggregate can filter and group inbound answered calls over a duration threshold, but it returns grouped counters/timers rather than caller-level lead records.",
      webhooks:
        "RingCentral notification event filters include telephony session events; the docs did not show Call Log or Analytics result subscriptions, so precise Call Log/Analytics ingestion likely needs polling/cron.",
    },
  };

  await fs.writeFile(ARTIFACT_PATH, `${JSON.stringify(sanitize(artifact), null, 2)}\n`);
  console.log("");
  console.log(`Wrote sanitized probe artifact: ${ARTIFACT_PATH}`);

  if (options.json) {
    console.log(JSON.stringify(sanitize(artifact), null, 2));
  }
}

async function checkEndpoint(
  client: RingCentralClientModule,
  label: string,
  method: string,
  endpoint: string,
  body?: unknown,
): Promise<EndpointResult> {
  console.log(`Calling ${method} ${endpoint}`);
  try {
    const data = await client.ringCentralRequest(method, endpoint, body);
    console.log(`${label}: success`);
    console.log("");
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
      console.log(`${label}: failed (${apiError.status} ${apiError.statusText})`);
      console.log("");
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
    console.log("");
    return {
      label,
      method,
      endpoint,
      ok: false,
      status: null,
      statusText: null,
      error: message,
    };
  }
}

async function fetchDetailedInboundCallLogs(
  client: RingCentralClientModule,
  options: ProbeOptions,
): Promise<EndpointResult> {
  const records: any[] = [];
  const pageResults: EndpointResult[] = [];
  for (let page = 1; page <= MAX_CALL_LOG_PAGES; page += 1) {
    const endpoint = buildCallLogEndpoint(options, page);
    const result = await checkEndpoint(
      client,
      `Detailed account call logs page ${page}`,
      "GET",
      endpoint,
    );
    pageResults.push(result);
    if (!result.ok) {
      return {
        ...result,
        label: "Detailed account call logs",
        data: { records },
        responseBody: { pages: pageResults },
      };
    }
    const pageRecords = getRecords(result.data);
    records.push(...pageRecords);
    if (pageRecords.length < options.limit) {
      break;
    }
  }

  return {
    label: "Detailed account call logs",
    method: "GET",
    endpoint: buildCallLogEndpoint(options, 1),
    ok: true,
    status: 200,
    statusText: "OK",
    data: { records },
    responseBody: { pages: pageResults },
  };
}

async function runAnalyticsProbes(
  client: RingCentralClientModule,
  options: ProbeOptions,
  queueExtensions: QueueExtension[],
): Promise<EndpointResult[]> {
  const results: EndpointResult[] = [];
  const endpoint = "/analytics/calls/v1/accounts/~/aggregation/fetch?page=1&perPage=200";

  results.push(
    await checkEndpoint(
      client,
      "Analytics aggregate by company numbers",
      "POST",
      endpoint,
      buildAnalyticsAggregateBody(options, {
        groupBy: "CompanyNumbers",
        keys: [],
      }),
    ),
  );

  const queueIds = queueExtensions
    .map((extension) => extension.id)
    .filter((id): id is string => id !== null);
  results.push(
    await checkEndpoint(
      client,
      "Analytics aggregate by queues",
      "POST",
      endpoint,
      buildAnalyticsAggregateBody(options, {
        groupBy: "Queues",
        keys: queueIds,
      }),
    ),
  );

  return results;
}

function buildAnalyticsAggregateBody(
  options: ProbeOptions,
  grouping: { groupBy: "CompanyNumbers" | "Queues"; keys: string[] },
): Record<string, unknown> {
  return {
    grouping,
    timeSettings: {
      timeZone: "America/New_York",
      timeRange: {
        timeFrom: options.dateFrom,
        timeTo: options.dateTo,
      },
    },
    callFilters: {
      directions: ["Inbound"],
      callResponses: ["Answered"],
      callDuration: {
        minSeconds: CALL_LEAD_MINIMUM_ANSWERED_SECONDS,
      },
      calledNumbers: Object.keys(RINGCENTRAL_INBOUND_NUMBER_TO_SOURCE),
    },
    responseOptions: {
      counters: {
        allCalls: { aggregationType: "Sum" },
        callsByDirection: { aggregationType: "Sum" },
        callsByResponse: { aggregationType: "Sum" },
        callsByResult: { aggregationType: "Sum" },
        callsByType: { aggregationType: "Sum" },
      },
      timers: {
        allCallsDuration: { aggregationType: "Sum" },
        callsDurationByResponse: { aggregationType: "Sum" },
        callsDurationByResult: { aggregationType: "Sum" },
        callsDurationByType: { aggregationType: "Sum" },
      },
    },
  };
}

function buildCallLogEndpoint(options: ProbeOptions, page = 1): string {
  const query = new URLSearchParams({
    dateFrom: options.dateFrom,
    dateTo: options.dateTo,
    direction: "Inbound",
    type: "Voice",
    view: "Detailed",
    perPage: String(options.limit),
    page: String(page),
  });
  return `/restapi/v1.0/account/~/call-log?${query.toString()}`;
}

function analyzeCallLogs(
  payload: any,
  queueExtensions: QueueExtension[],
  options: ProbeOptions,
): LeadCandidateProbe[] {
  return getRecords(payload)
    .map((record) => analyzeCallLogRecord(record, queueExtensions, options))
    .filter(
      (candidate) =>
        candidate.matchedTargetNumber ||
        candidate.matchedQueue ||
        candidate.matchedExplicitCaller ||
        candidate.matchedExplicitSource,
    );
}

function analyzeCallLogRecord(
  record: any,
  queueExtensions: QueueExtension[],
  options: ProbeOptions,
): LeadCandidateProbe {
  const productionVet = vetRingCentralCallLogRecord(record);
  const legs = getLegs(record);
  const allParts = [record, ...legs];
  const targetPhoneNumber = productionVet.targetPhoneNumber;
  const source = resolveRingCentralInboundSource(targetPhoneNumber);
  const matchedQueueExtensions = findMatchingQueueExtensions(allParts, queueExtensions);
  const caller = {
    phoneNumber: productionVet.callerPhoneNumber,
    name: productionVet.callerName,
  };
  const matchedExplicitCaller = options.callerNumbers.includes(caller.phoneNumber ?? "");
  const matchedExplicitSource =
    targetPhoneNumber !== null && options.sourceNumbers.includes(targetPhoneNumber);

  return {
    callLogId: productionVet.callLogId,
    sessionId: productionVet.sessionId,
    telephonySessionId: productionVet.telephonySessionId,
    startTime: productionVet.startTime?.toISOString() ?? null,
    durationSeconds: productionVet.durationSeconds,
    direction: productionVet.direction,
    type: valueToString(record?.type),
    result: productionVet.result,
    action: valueToString(record?.action),
    callerPhoneNumber: caller.phoneNumber,
    callerName: caller.name,
    targetPhoneNumber,
    targetName: productionVet.targetName,
    sourceLabel: source?.sourceLabel ?? null,
    sourceCompany: source?.sourceCompany ?? null,
    matchedTargetNumber: productionVet.matchedTargetNumber,
    matchedQueue: matchedQueueExtensions.length > 0,
    matchedQueueExtensions,
    answered: productionVet.answered,
    overMinimumDuration: productionVet.overMinimumDuration,
    wouldCreateCallLead: productionVet.qualifies,
    rejectionReasons: productionVet.rejectionReasons,
    productionQualifies: productionVet.qualifies,
    productionRejectionReasons: productionVet.rejectionReasons,
    matchedExplicitCaller,
    matchedExplicitSource,
    rawSummary: {
      legCount: legs.length,
      legTypes: uniqueStrings(legs.map((leg) => valueToString(leg?.legType))),
      legResults: uniqueStrings(legs.map((leg) => valueToString(leg?.result))),
      legExtensionIds: uniqueStrings(
        allParts.flatMap((part) => extractExtensionIds(part)),
      ),
    },
  };
}

function findMatchingQueueExtensions(
  parts: any[],
  queueExtensions: QueueExtension[],
): QueueExtension[] {
  const queueExtensionNumbers = new Set<string>(
    TARGET_QUEUES.map((queue) => queue.extensionNumber),
  );
  const queueNames = new Set(TARGET_QUEUES.map((queue) => queue.name.toLowerCase()));
  const queueIds = new Set(
    queueExtensions.map((extension) => extension.id).filter((id) => id !== null),
  );
  const matches = new Map<string, QueueExtension>();

  for (const part of parts) {
    for (const id of extractExtensionIds(part)) {
      if (queueIds.has(id)) {
        const queue = queueExtensions.find((extension) => extension.id === id);
        if (queue) {
          matches.set(queue.extensionNumber, queue);
        }
      }
    }

    const names = [
      valueToString(part?.to?.name),
      valueToString(part?.from?.name),
      valueToString(part?.extension?.name),
    ];
    for (const name of names) {
      if (name && queueNames.has(name.toLowerCase())) {
        const queue =
          queueExtensions.find(
            (extension) => extension.name.toLowerCase() === name.toLowerCase(),
          ) ??
          TARGET_QUEUES.find((target) => target.name.toLowerCase() === name.toLowerCase());
        if (queue) {
          matches.set(queue.extensionNumber, {
            id: "id" in queue ? queue.id : null,
            extensionNumber: queue.extensionNumber,
            name: queue.name,
          });
        }
      }
    }

    const extensionNumber = valueToString(part?.extension?.extensionNumber);
    if (extensionNumber && queueExtensionNumbers.has(extensionNumber)) {
      const queue =
        queueExtensions.find(
          (extension) => extension.extensionNumber === extensionNumber,
        ) ?? TARGET_QUEUES.find((target) => target.extensionNumber === extensionNumber);
      if (queue) {
        matches.set(queue.extensionNumber, {
          id: "id" in queue ? queue.id : null,
          extensionNumber: queue.extensionNumber,
          name: queue.name,
        });
      }
    }
  }

  return [...matches.values()].sort((left, right) =>
    left.extensionNumber.localeCompare(right.extensionNumber),
  );
}

function resolveTargetQueueExtensions(payload: any): QueueExtension[] {
  const records = getRecords(payload);
  return TARGET_QUEUES.map((target) => {
    const match = records.find((record) => {
      const extensionNumber = valueToString(record?.extensionNumber);
      const name = valueToString(record?.name);
      return (
        extensionNumber === target.extensionNumber ||
        name?.toLowerCase() === target.name.toLowerCase()
      );
    });

    return {
      id: valueToString(match?.id),
      extensionNumber: target.extensionNumber,
      name: valueToString(match?.name) ?? target.name,
    };
  });
}

function extractExtensionIds(recordOrLeg: any): string[] {
  return uniqueStrings([
    valueToString(recordOrLeg?.extension?.id),
    valueToString(recordOrLeg?.from?.extensionId),
    valueToString(recordOrLeg?.to?.extensionId),
  ]);
}

function printQueueResolution(queueExtensions: QueueExtension[]): void {
  console.log("Target queue extension resolution");
  for (const extension of queueExtensions) {
    console.log(
      `  ext ${extension.extensionNumber} | id=${extension.id ?? "not found"} | name=${extension.name}`,
    );
  }
  console.log("");
}

function printCandidateSummary(
  candidates: LeadCandidateProbe[],
  options: ProbeOptions,
): void {
  const qualified = candidates.filter((candidate) => candidate.wouldCreateCallLead);
  console.log("Call Log candidate vetting");
  console.log(`  candidate records matching target number or queue: ${candidates.length}`);
  console.log(`  qualified call leads: ${qualified.length}`);
  console.log(`  printed sample limit: ${Math.min(options.limit, 20)}`);
  for (const candidate of candidates.slice(0, 20)) {
    console.log(
      [
        `  ${candidate.wouldCreateCallLead ? "QUALIFIED" : "rejected"}`,
        `start=${candidate.startTime ?? "?"}`,
        `duration=${candidate.durationSeconds ?? "?"}s`,
        `result=${candidate.result ?? "?"}`,
        `from=${candidate.callerPhoneNumber ?? "?"}`,
        `to=${candidate.targetPhoneNumber ?? "?"}`,
        `source=${candidate.sourceLabel ?? "?"}`,
        `queue=${candidate.matchedQueueExtensions
          .map((queue) => `${queue.name}/${queue.extensionNumber}`)
          .join(",") || "?"}`,
        candidate.rejectionReasons.length
          ? `reasons=${candidate.rejectionReasons.join(",")}`
          : null,
        candidate.matchedExplicitCaller ? "EXPLICIT_CALLER_MATCH" : null,
      ]
        .filter((value) => value !== null)
        .join(" | "),
    );
  }
  console.log("");
}

function printExplicitCallerSummary(
  candidates: LeadCandidateProbe[],
  options: ProbeOptions,
): void {
  console.log("Explicit missing-caller search");
  for (const callerNumber of options.callerNumbers) {
    const matches = candidates.filter(
      (candidate) => candidate.callerPhoneNumber === callerNumber,
    );
    console.log(`  ${callerNumber}: ${matches.length} call-log record(s) found`);
    for (const candidate of matches) {
      console.log(
        [
          `    ${candidate.productionQualifies ? "QUALIFIED" : "rejected"}`,
          `start=${candidate.startTime ?? "?"}`,
          `duration=${candidate.durationSeconds ?? "?"}s`,
          `result=${candidate.result ?? "?"}`,
          `to=${candidate.targetPhoneNumber ?? "?"}`,
          `source=${candidate.sourceLabel ?? "?"}`,
          candidate.productionRejectionReasons.length
            ? `reasons=${candidate.productionRejectionReasons.join(",")}`
            : null,
          `callLogId=${candidate.callLogId ?? "?"}`,
          `session=${candidate.telephonySessionId ?? candidate.sessionId ?? "?"}`,
        ]
          .filter((value) => value !== null)
          .join(" | "),
      );
    }
  }
  console.log("");
}

function printAnalyticsSummary(results: EndpointResult[]): void {
  console.log("Analytics aggregate probes");
  for (const result of results) {
    const records = getAnalyticsRecords(result.data);
    const nonZeroRecords = records
      .map(summarizeAnalyticsRecord)
      .filter((record) => record.allCalls > 0 || record.durationSeconds > 0);
    console.log(
      `  ${result.label}: ${result.ok ? "success" : `failed (${result.status ?? "unknown"})`} | records=${records.length}`,
    );
    for (const record of nonZeroRecords.slice(0, 20)) {
      console.log(
        [
          `    key=${record.key}`,
          record.name ? `name=${record.name}` : null,
          `allCalls=${record.allCalls}`,
          `answered=${record.answeredCalls}`,
          `duration=${Math.round(record.durationSeconds)}s`,
        ]
          .filter((value) => value !== null)
          .join(" | "),
      );
    }
  }
}

function parseOptions(args: string[]): ProbeOptions {
  const normalizedArgs = args.filter((arg) => arg !== "--");
  const now = new Date();
  const defaultDateTo = new Date(now.getTime() - DEFAULT_ANALYTICS_END_BUFFER_MS);
  let dateTo = defaultDateTo.toISOString();
  let dateFrom = new Date(
    defaultDateTo.getTime() - DEFAULT_LOOKBACK_HOURS * 60 * 60 * 1000,
  ).toISOString();
  let limit = DEFAULT_LIMIT;
  let json = false;
  let callerNumbers = DEFAULT_TARGET_CALLERS.map((value) =>
    normalizeRequiredPhoneNumber(value, "default caller"),
  );
  let sourceNumbers = Object.keys(RINGCENTRAL_INBOUND_NUMBER_TO_SOURCE).map((value) =>
    normalizeRequiredPhoneNumber(value, "default source"),
  );

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    const next = normalizedArgs[index + 1];
    if (arg === "--from" && next) {
      dateFrom = parseDateArg(next, "--from");
      index += 1;
    } else if (arg === "--to" && next) {
      dateTo = parseDateArg(next, "--to");
      index += 1;
    } else if (arg === "--hours" && next) {
      const hours = Number(next);
      if (!Number.isFinite(hours) || hours <= 0) {
        throw new Error("--hours must be a positive number");
      }
      dateTo = defaultDateTo.toISOString();
      dateFrom = new Date(defaultDateTo.getTime() - hours * 60 * 60 * 1000).toISOString();
      index += 1;
    } else if (arg === "--limit" && next) {
      const parsedLimit = Number(next);
      if (!Number.isInteger(parsedLimit) || parsedLimit <= 0 || parsedLimit > 1000) {
        throw new Error("--limit must be an integer from 1 to 1000");
      }
      limit = parsedLimit;
      index += 1;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--caller" && next) {
      callerNumbers = uniqueStrings([
        ...callerNumbers,
        ...parsePhoneList(next, "--caller"),
      ]);
      index += 1;
    } else if (arg === "--source" && next) {
      sourceNumbers = uniqueStrings([
        ...sourceNumbers,
        ...parsePhoneList(next, "--source"),
      ]);
      index += 1;
    } else if (arg === "--only-default-callers") {
      callerNumbers = DEFAULT_TARGET_CALLERS.map((value) =>
        normalizeRequiredPhoneNumber(value, "default caller"),
      );
    } else if (arg === "--no-default-callers") {
      callerNumbers = [];
    } else if (arg === "--help") {
      printUsageAndExit();
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (new Date(dateFrom).getTime() >= new Date(dateTo).getTime()) {
    throw new Error("--from must be earlier than --to");
  }

  return { dateFrom, dateTo, limit, json, callerNumbers, sourceNumbers };
}

function parseDateArg(value: string, flag: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${flag} must be a valid ISO date/time`);
  }
  return date.toISOString();
}

function printUsageAndExit(): never {
  console.log(`Usage:
  pnpm ringcentral:call-lead:api-probe
  pnpm ringcentral:call-lead:api-probe -- --hours 48
  pnpm ringcentral:call-lead:api-probe -- --from 2026-06-03T13:00:00Z --to 2026-06-03T16:00:00Z --limit 100
  pnpm ringcentral:call-lead:api-probe -- --caller "(602) 391-8047" --caller "(240) 426-1067"

Options:
  --hours <number>  Look back from now. Defaults to ${DEFAULT_LOOKBACK_HOURS}.
  --from <iso>      Start time for Call Log and Analytics queries.
  --to <iso>        End time for Call Log and Analytics queries.
  --limit <number>  Call Log perPage limit, 1-1000. Defaults to ${DEFAULT_LIMIT}.
  --caller <phone>  Add a caller phone number to the explicit missing-caller search.
  --source <phone>  Add a RingCentral source/target phone number to match.
  --no-default-callers
                    Only use caller numbers provided with --caller.
  --json            Also print the full sanitized artifact to stdout.
`);
  process.exit(0);
}

function parsePhoneList(value: string, flag: string): string[] {
  return value
    .split(",")
    .map((entry) => normalizeRequiredPhoneNumber(entry, flag))
    .filter((entry, index, all) => all.indexOf(entry) === index);
}

function normalizeRequiredPhoneNumber(value: string, label: string): string {
  const normalized = normalizePhoneNumberToE164Like(value);
  if (!normalized) {
    throw new Error(`${label} must be a valid phone number: ${value}`);
  }
  return normalized;
}

function getRecords(payload: any): any[] {
  return Array.isArray(payload?.records) ? payload.records : [];
}

function getAnalyticsRecords(payload: any): any[] {
  if (Array.isArray(payload?.data?.records)) {
    return payload.data.records;
  }
  return getRecords(payload);
}

function summarizeAnalyticsRecord(record: any): {
  key: string;
  name: string | null;
  allCalls: number;
  answeredCalls: number;
  durationSeconds: number;
} {
  return {
    key: valueToString(record?.key) ?? "?",
    name: valueToString(record?.info?.name),
    allCalls: valueToNumber(record?.counters?.allCalls?.values) ?? 0,
    answeredCalls:
      valueToNumber(record?.counters?.callsByResponse?.values?.answered) ?? 0,
    durationSeconds: valueToNumber(record?.timers?.allCalls?.values) ?? 0,
  };
}

function getLegs(record: any): any[] {
  return Array.isArray(record?.legs) ? record.legs : [];
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}

function valueToString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function valueToNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitize);
  }

  if (value && typeof value === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      sanitized[key] = isSensitiveKey(key) ? "[REDACTED]" : sanitize(entry);
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
