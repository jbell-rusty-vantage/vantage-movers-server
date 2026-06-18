import process from "node:process";
import { createGoogleSheetsClient, requiredEnv } from "./google_sheets/google-sheets-auth";

const PRODUCTION_BASE_URL = "https://vantage-movers-main-server.vercel.app";
const SPREADSHEET_ID_ENV = "TBM_PRIME_BACKFILL_UPDATED_SHEET_ID";
const API_SECRET_ENV = "VANTAGE_API_SECRET";
const SOURCE_COMPANY = "tbm_prime_leads";
const TAB_NAME = "Calls";
const DEFAULT_FROM = "2026-05-01";
const DEFAULT_TO = "2026-06-12";
const EASTERN_DST_OFFSET = "-04:00";

const REQUIRED_HEADERS = [
  "PHONE NUMBER",
  "Date",
  "Time",
  "Booked",
  "Over 2000",
  "Over 4000",
  "Cubic Feet",
  "Form Fill Checker",
] as const;

type Options = {
  apply: boolean;
  baseUrl: string;
  from: DateKey;
  to: DateKey;
};

type DateKey = {
  year: number;
  month: number;
  day: number;
  value: number;
  isoDate: string;
};

type SheetBackfillRow = {
  rowNumber: number;
  phoneNumber: string;
  date: DateKey;
  timestampIso: string;
  cubicFeet?: number;
  raw: Record<string, string>;
};

type ApiResponse<T> = {
  ok: boolean;
  data?: T;
  error?: string;
};

type CallLeadSummary = {
  _id: string;
  source_company?: string;
  phone_number?: string;
  timestamp?: string;
  cubic_feet?: number;
};

type SearchCallLeadsResponse = CallLeadSummary[];

type ActionResult = {
  rowNumber: number;
  phoneNumber: string;
  timestampIso: string;
  action: "create" | "noop_update" | "dry_create" | "dry_noop_update";
  leadId?: string;
};

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const spreadsheetId = requiredEnv(SPREADSHEET_ID_ENV);
  const apiSecret = requiredEnv(API_SECRET_ENV);

  console.log("TBM Prime updated Calls backfill");
  console.log(`Mode: ${options.apply ? "APPLY" : "DRY RUN"}`);
  console.log(`Production API: ${options.baseUrl}`);
  console.log(`Sheet: ${spreadsheetId}`);
  console.log(`Tab: ${TAB_NAME}`);
  console.log(`Date window: ${options.from.isoDate} through ${options.to.isoDate}`);
  console.log("");

  const rows = await readCallsRows(spreadsheetId, options);
  console.log(`Qualifying rows: ${rows.length}`);
  for (const row of rows) {
    console.log(
      `  row ${row.rowNumber}: ${row.phoneNumber} | ${row.timestampIso} | cubic_feet=${
        row.cubicFeet ?? ""
      }`,
    );
  }
  console.log("");

  const results: ActionResult[] = [];
  for (const row of rows) {
    const existing = await findExistingCallLead(options.baseUrl, apiSecret, row.phoneNumber);

    if (existing) {
      const payload = { phone_number: existing.phone_number || row.phoneNumber };
      if (!options.apply) {
        results.push({
          rowNumber: row.rowNumber,
          phoneNumber: row.phoneNumber,
          timestampIso: row.timestampIso,
          action: "dry_noop_update",
          leadId: existing._id,
        });
        console.log(`DRY row ${row.rowNumber}: would PATCH existing ${existing._id}`);
        continue;
      }

      await apiRequest<CallLeadSummary>(
        options.baseUrl,
        apiSecret,
        "PATCH",
        `/api/v1/call-leads/${existing._id}`,
        payload,
      );
      results.push({
        rowNumber: row.rowNumber,
        phoneNumber: row.phoneNumber,
        timestampIso: row.timestampIso,
        action: "noop_update",
        leadId: existing._id,
      });
      console.log(`APPLY row ${row.rowNumber}: patched existing ${existing._id}`);
      continue;
    }

    const payload: Record<string, unknown> = {
      source_company: SOURCE_COMPANY,
      phone_number: row.phoneNumber,
      timestamp: row.timestampIso,
    };
    if (row.cubicFeet !== undefined) {
      payload.cubic_feet = row.cubicFeet;
    }

    if (!options.apply) {
      results.push({
        rowNumber: row.rowNumber,
        phoneNumber: row.phoneNumber,
        timestampIso: row.timestampIso,
        action: "dry_create",
      });
      console.log(`DRY row ${row.rowNumber}: would POST new call lead`);
      continue;
    }

    const created = await apiRequest<CallLeadSummary>(
      options.baseUrl,
      apiSecret,
      "POST",
      "/api/v1/call-leads",
      payload,
    );
    results.push({
      rowNumber: row.rowNumber,
      phoneNumber: row.phoneNumber,
      timestampIso: row.timestampIso,
      action: "create",
      leadId: created._id,
    });
    console.log(`APPLY row ${row.rowNumber}: created ${created._id}`);
  }

  console.log("");
  console.log("Summary");
  console.log(JSON.stringify(results, null, 2));

  if (!options.apply) {
    console.log("");
    console.log("Dry run only. Re-run with --apply to write through the production API.");
  }
}

async function readCallsRows(
  spreadsheetId: string,
  options: Options,
): Promise<SheetBackfillRow[]> {
  const sheets = createGoogleSheetsClient();
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${escapeSheetTitle(TAB_NAME)}!A1:H1000`,
    majorDimension: "ROWS",
    valueRenderOption: "FORMATTED_VALUE",
  });

  const matrix = (data.values ?? []).map((row) =>
    Array.isArray(row) ? row.map((value) => cell(value)) : [],
  );
  const headerIndex = findHeaderIndex(matrix);
  if (headerIndex === -1) {
    throw new Error(`Could not find expected ${TAB_NAME} headers`);
  }

  const headers = matrix[headerIndex];
  const rows: SheetBackfillRow[] = [];
  for (let index = headerIndex + 1; index < matrix.length; index += 1) {
    const values = matrix[index];
    if (values.every((value) => !value.trim())) {
      continue;
    }

    const raw = mapRow(headers, values);
    const phoneNumber = cell(raw["PHONE NUMBER"]);
    const date = parseSheetDate(raw.Date);
    if (!date || date.value < options.from.value || date.value > options.to.value) {
      continue;
    }
    if (!phoneNumber) {
      console.warn(`Skipping row ${index + 1}: missing PHONE NUMBER`);
      continue;
    }

    rows.push({
      rowNumber: index + 1,
      phoneNumber,
      date,
      timestampIso: buildEasternTimestampIso(date, raw.Time),
      cubicFeet: parseOptionalNumber(raw["Cubic Feet"]),
      raw,
    });
  }

  return rows;
}

async function findExistingCallLead(
  baseUrl: string,
  apiSecret: string,
  phoneNumber: string,
): Promise<CallLeadSummary | undefined> {
  const matches = await apiRequest<SearchCallLeadsResponse>(
    baseUrl,
    apiSecret,
    "POST",
    "/api/v1/call-leads/search",
    { phone_number: phoneNumber, limit: 25 },
  );

  const sameSource = matches.filter((lead) => lead.source_company === SOURCE_COMPANY);
  if (sameSource.length > 1) {
    console.warn(
      `Found ${sameSource.length} existing ${SOURCE_COMPANY} call leads for ${phoneNumber}; using newest ${sameSource[0]._id}`,
    );
  }
  return sameSource[0];
}

async function apiRequest<T>(
  baseUrl: string,
  apiSecret: string,
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-api-secret": apiSecret,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => null)) as ApiResponse<T> | null;
  if (!response.ok || !payload?.ok) {
    throw new Error(
      `${method} ${path} failed (${response.status}): ${
        payload?.error ?? response.statusText
      }`,
    );
  }
  if (payload.data === undefined) {
    throw new Error(`${method} ${path} returned no data`);
  }
  return payload.data;
}

function parseOptions(args: string[]): Options {
  const normalizedArgs = args.filter((arg) => arg !== "--");
  const options: Options = {
    apply: false,
    baseUrl: PRODUCTION_BASE_URL,
    from: parseDateKey(DEFAULT_FROM, "--from"),
    to: parseDateKey(DEFAULT_TO, "--to"),
  };

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    const next = normalizedArgs[index + 1];
    if (arg === "--apply") {
      options.apply = true;
    } else if (arg === "--base-url" && next) {
      options.baseUrl = next.replace(/\/+$/, "");
      index += 1;
    } else if (arg === "--from" && next) {
      options.from = parseDateKey(next, "--from");
      index += 1;
    } else if (arg === "--to" && next) {
      options.to = parseDateKey(next, "--to");
      index += 1;
    } else if (arg === "--help") {
      printUsageAndExit();
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.from.value > options.to.value) {
    throw new Error("--from must be on or before --to");
  }

  if (options.apply && options.baseUrl !== PRODUCTION_BASE_URL) {
    throw new Error(`Refusing --apply against non-production URL: ${options.baseUrl}`);
  }

  return options;
}

function findHeaderIndex(matrix: string[][]): number {
  return matrix.findIndex((row) => {
    const normalized = new Set(row.map(normalizeHeader));
    return REQUIRED_HEADERS.every((header) => normalized.has(normalizeHeader(header)));
  });
}

function mapRow(headers: string[], values: string[]): Record<string, string> {
  const row: Record<string, string> = {};
  headers.forEach((header, index) => {
    row[header] = cell(values[index]);
  });
  return row;
}

function parseSheetDate(value: string | undefined): DateKey | undefined {
  const raw = cell(value);
  if (!raw) {
    return undefined;
  }

  const match = raw
    .replace(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+/i, "")
    .match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) {
    return undefined;
  }

  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  return toDateKey(year, month, day);
}

function parseDateKey(value: string, label: string): DateKey {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error(`${label} must be YYYY-MM-DD`);
  }
  return toDateKey(Number(match[1]), Number(match[2]), Number(match[3]));
}

function toDateKey(year: number, month: number, day: number): DateKey {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    throw new Error(`Invalid date components: ${year}-${month}-${day}`);
  }

  const isoDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return {
    year,
    month,
    day,
    value: year * 10_000 + month * 100 + day,
    isoDate,
  };
}

function buildEasternTimestampIso(date: DateKey, timeValue: string | undefined): string {
  const time = parseTime(timeValue);
  return `${date.isoDate}T${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(
    2,
    "0",
  )}:${String(time.second).padStart(2, "0")}.000${EASTERN_DST_OFFSET}`;
}

function parseTime(value: string | undefined): { hour: number; minute: number; second: number } {
  const raw = cell(value);
  if (!raw) {
    return { hour: 0, minute: 0, second: 0 };
  }

  const match = raw.match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) {
    throw new Error(`Invalid Time value: ${raw}`);
  }

  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const second = Number(match[3] ?? 0);
  const meridiem = match[4]?.toUpperCase();

  if (meridiem === "PM" && hour < 12) {
    hour += 12;
  }
  if (meridiem === "AM" && hour === 12) {
    hour = 0;
  }
  if (hour > 23 || minute > 59 || second > 59) {
    throw new Error(`Invalid Time value: ${raw}`);
  }

  return { hour, minute, second };
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  const raw = cell(value).replace(/,/g, "");
  if (!raw) {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeHeader(value: string): string {
  return cell(value).replace(/\s+/g, " ").trim().toLowerCase();
}

function cell(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function escapeSheetTitle(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

function printUsageAndExit(): never {
  console.log(`Usage:
  pnpm backfill:tbm-prime-updated-calls
  pnpm backfill:tbm-prime-updated-calls -- --apply

Options:
  --apply             Write through the production API. Omit for dry-run.
  --from YYYY-MM-DD   Inclusive Date lower bound. Defaults to ${DEFAULT_FROM}.
  --to YYYY-MM-DD     Inclusive Date upper bound. Defaults to ${DEFAULT_TO}.
  --base-url URL      API base URL. Defaults to production; --apply refuses non-production.
`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
