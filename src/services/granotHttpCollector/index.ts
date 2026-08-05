import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import type { Element } from "domhandler" with { "resolution-mode": "import" };
import type {
  BookedCallLeadReconciliationRowInput,
  CallLeadEnrichmentRowInput,
} from "../../validation/v1.validation";

export type GranotSectionKey = "bookedJobs" | "followUpEstimates";

export type GranotReportRow = {
  id: string;
  rowIndex: number;
  values: Record<string, string>;
};

export type GranotSourceCollection = {
  sourceLabel: string;
  contentHash: string;
  sectionSchemas: Record<
    GranotSectionKey,
    "table" | "empty" | "missing" | "invalid"
  >;
  sections: Record<GranotSectionKey, GranotReportRow[]>;
};

export type GranotCollectorCredentials = {
  networkUsername: string;
  networkPassword: string;
  username: string;
  password: string;
};

export type GranotCollectionRequest = {
  dateWindow: { from: string; to: string };
  sourceLabels: string[];
  credentials: GranotCollectorCredentials;
  filters?: {
    dateFactor?: "OPEN" | "BOOK";
    type?: string;
    department?: string;
    state?: string;
    status?: string;
  };
};

export type GranotCollectionResult = {
  requestedDateWindow: GranotCollectionRequest["dateWindow"];
  discoveredSourceLabels: string[];
  notObservedSourceLabels: string[];
  sources: GranotSourceCollection[];
};

export type GranotOperationPayloads = {
  enrichmentRows: CallLeadEnrichmentRowInput[];
  bookedReconciliationRows: BookedCallLeadReconciliationRowInput[];
};

export type GranotCollectorDependencies = {
  fetch?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  beforeSource?: (sourceLabel: string) => void | Promise<void>;
};

export class GranotCollectorError extends Error {
  constructor(
    public readonly code:
      | "authentication_failed"
      | "invalid_request"
      | "invalid_session"
      | "schema_drift"
      | "response_too_large"
      | "provider_error",
    message: string,
  ) {
    super(message);
    this.name = "GranotCollectorError";
  }
}

const SECTION_HEADINGS: Record<GranotSectionKey, string> = {
  bookedJobs: "booked jobs",
  followUpEstimates: "follow up estimates",
};

const SESSION_TOKEN_RE = /~([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:~|["'<\s]|$)/i;

export async function collectGranotReport(
  input: GranotCollectionRequest,
  dependencies: GranotCollectorDependencies = {},
): Promise<GranotCollectionResult> {
  const dateProblem = getGranotDateWindowProblem(input.dateWindow);
  if (dateProblem) {
    throw new GranotCollectorError("invalid_request", dateProblem);
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await collectGranotReportOnce(input, dependencies);
    } catch (error) {
      if (
        attempt === 0 &&
        error instanceof GranotCollectorError &&
        error.code === "invalid_session"
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new GranotCollectorError(
    "invalid_session",
    "Granot session retry was exhausted",
  );
}

async function collectGranotReportOnce(
  input: GranotCollectionRequest,
  dependencies: GranotCollectorDependencies,
): Promise<GranotCollectionResult> {
  const client = new GranotHttpClient(dependencies);
  const loginPage = await client.request("/wc.dll?mp~NetLogonWc~VANTAGE");
  const networkAction = readFormAction(loginPage);
  if (!networkAction) {
    throw classifyExpectedPageError(loginPage, "network login");
  }

  const networkForm = readFormValues(loginPage);
  networkForm.set("LOGON_USER", input.credentials.networkUsername);
  networkForm.set("PASSWORD", input.credentials.networkPassword);
  networkForm.delete("SAVEPASS");
  const userLoginPage = await client.request(networkAction, {
    method: "POST",
    body: networkForm,
  });
  const userAction = readFormAction(userLoginPage);
  if (!userAction) {
    throw new GranotCollectorError(
      "authentication_failed",
      "Granot network login did not reach the user login page",
    );
  }

  const userForm = readFormValues(userLoginPage);
  userForm.set("USERNAME", input.credentials.username);
  userForm.set("PASSWORD", input.credentials.password);
  userForm.set("LOGON", "Login");
  const mainPage = await client.request(userAction, {
    method: "POST",
    body: userForm,
  });
  const sessionToken = mainPage.match(SESSION_TOKEN_RE)?.[1];
  if (!sessionToken) {
    throw new GranotCollectorError(
      "authentication_failed",
      "Granot user login did not create an authenticated session",
    );
  }

  await client.request(`/wc.dll?mprep~repmenuwc~${sessionToken}`);
  const filterPage = await client.request(
    `/wc.dll?mprep~repmenuret~${sessionToken}~10`,
  );
  if (!hasInput(filterPage, "DATE1") || !hasInput(filterPage, "DATE2")) {
    throw classifyExpectedPageError(filterPage, "Leads & Advertising filter");
  }

  const selectorPage = await client.request(
    `/wc.dll?mprep~refret~${sessionToken}~1`,
    {
      method: "POST",
      body: new URLSearchParams({
        DATE1: input.dateWindow.from,
        DATE2: input.dateWindow.to,
        TYPEDTE: input.filters?.dateFactor ?? "OPEN",
        TYPE: input.filters?.type ?? "ALL",
        DEPT: input.filters?.department ?? "",
        SSTATE: input.filters?.state ?? "",
        FUSTATUS: input.filters?.status ?? "10",
      }),
    },
  );
  const discoveredSources = parseSourceSelector(selectorPage);
  if (discoveredSources.length === 0) {
    throw classifyExpectedPageError(selectorPage, "source selector");
  }

  const requested = new Set(input.sourceLabels);
  const selectedSources = discoveredSources.filter((source) =>
    requested.has(source.label),
  );
  const sources: GranotSourceCollection[] = [];
  for (const source of selectedSources) {
    await dependencies.beforeSource?.(source.label);
    const sourcePage = await client.request(source.href);
    const parsed = parseGranotSourceReport(sourcePage, source.label);
    const hasRecognizedTable =
      parsed.sectionSchemas.bookedJobs === "table" ||
      parsed.sectionSchemas.followUpEstimates === "table";
    if (!hasRecognizedTable) {
      throw classifyExpectedPageError(
        sourcePage,
        `source report ${source.label}`,
      );
    }
    if (
      parsed.sectionSchemas.bookedJobs === "invalid" ||
      parsed.sectionSchemas.followUpEstimates === "invalid"
    ) {
      throw new GranotCollectorError(
        "schema_drift",
        `Granot source report schema changed for ${source.label} (${parsed.sectionSchemas.bookedJobs}/${parsed.sectionSchemas.followUpEstimates})`,
      );
    }
    sources.push(parsed);
  }

  return {
    requestedDateWindow: input.dateWindow,
    discoveredSourceLabels: discoveredSources.map((source) => source.label),
    notObservedSourceLabels: input.sourceLabels.filter(
      (label) => !discoveredSources.some((source) => source.label === label),
    ),
    sources,
  };
}

export function getGranotDateWindowProblem(
  dateWindow: GranotCollectionRequest["dateWindow"],
): string | undefined {
  const from = parseCalendarDate(dateWindow.from);
  const to = parseCalendarDate(dateWindow.to);
  if (!from) return "Granot from date must be a real MM/DD/YYYY calendar date";
  if (!to) return "Granot to date must be a real MM/DD/YYYY calendar date";
  if (from.getTime() > to.getTime()) {
    return "Granot to date must be on or after the from date";
  }
  return undefined;
}

export function parseGranotSourceReport(
  html: string,
  sourceLabel: string,
): GranotSourceCollection {
  const $ = cheerio.load(html);
  const parsedSections = {
    bookedJobs: parseSection($, "bookedJobs"),
    followUpEstimates: parseSection($, "followUpEstimates"),
  };
  const sections = {
    bookedJobs: parsedSections.bookedJobs.rows,
    followUpEstimates: parsedSections.followUpEstimates.rows,
  };
  const sectionSchemas = {
    bookedJobs: parsedSections.bookedJobs.schema,
    followUpEstimates: parsedSections.followUpEstimates.schema,
  };

  return {
    sourceLabel,
    contentHash: createHash("sha256")
      .update(JSON.stringify({ sourceLabel, sections }))
      .digest("hex"),
    sectionSchemas,
    sections,
  };
}

export function buildGranotOperationPayloads(
  sources: GranotSourceCollection[],
): GranotOperationPayloads {
  return {
    enrichmentRows: sources.flatMap((source) =>
      source.sections.followUpEstimates.map((row) =>
        mapEnrichmentRow(source.sourceLabel, row),
      ),
    ),
    bookedReconciliationRows: sources.flatMap((source) =>
      source.sections.bookedJobs.map((row) =>
        mapBookedRow(source.sourceLabel, row),
      ),
    ),
  };
}

function mapEnrichmentRow(
  sourceLabel: string,
  row: GranotReportRow,
): CallLeadEnrichmentRowInput {
  const payload: CallLeadEnrichmentRowInput = {
    row_id: `${sourceLabel}:${row.id}`,
    row_index: row.rowIndex,
  };
  assignValue(payload, "job_no", row.values.job_no);
  assignValue(payload, "source", row.values.source || sourceLabel);
  assignValue(payload, "customer", row.values.customer);
  assignValue(payload, "phone", row.values.phone);
  assignValue(
    payload,
    "granot_crm_username",
    row.values.user || row.values.rep,
  );
  assignValue(payload, "email", row.values.email);
  assignValue(payload, "from", row.values.from);
  assignValue(payload, "from_zip", row.values.from_zip);
  assignValue(payload, "to", row.values.to);
  assignValue(payload, "to_zip", row.values.to_zip);
  assignValue(payload, "est_cf", row.values.est_cf);
  return payload;
}

function mapBookedRow(
  sourceLabel: string,
  row: GranotReportRow,
): BookedCallLeadReconciliationRowInput {
  const payload: BookedCallLeadReconciliationRowInput = {
    row_id: `${sourceLabel}:${row.id}`,
    row_index: row.rowIndex,
    section: "bookedJobs",
  };
  assignValue(payload, "job_no", row.values.job_no);
  assignValue(payload, "source", row.values.source || sourceLabel);
  assignValue(payload, "prior", row.values.prior);
  assignValue(payload, "book_date", row.values.book_date);
  assignValue(payload, "customer", row.values.customer);
  assignValue(payload, "phone", row.values.phone);
  assignValue(
    payload,
    "granot_crm_username",
    row.values.user || row.values.rep,
  );
  assignValue(payload, "email", row.values.email);
  assignValue(payload, "from", row.values.from);
  assignValue(payload, "from_zip", row.values.from_zip);
  assignValue(payload, "to", row.values.to);
  assignValue(payload, "to_zip", row.values.to_zip);
  assignValue(payload, "est_cf", row.values.est_cf);
  return payload;
}

function assignValue<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: unknown,
): void {
  if (typeof value === "string" && value.trim()) {
    target[key] = value.trim() as T[K];
  }
}

function parseSection(
  $: cheerio.CheerioAPI,
  section: GranotSectionKey,
): {
  schema: "table" | "empty" | "missing" | "invalid";
  rows: GranotReportRow[];
} {
  const expectedHeading = SECTION_HEADINGS[section];
  let activeHeading = "";
  let headingFound = false;
  let invalidHeaderFound = false;
  let tableElement: Element | undefined;
  $("h1,h2,h3,h4,table").each((_index, element) => {
    if (/^h[1-4]$/i.test(element.tagName)) {
      activeHeading = normalizeText($(element).text()).toLowerCase();
      if (activeHeading.includes(expectedHeading)) {
        headingFound = true;
      }
      return;
    }
    if (tableElement || !activeHeading.includes(expectedHeading)) {
      return;
    }
    const ownRows = getOwnRows($, element);
    const hasHeaderCells = ownRows.some(
      (row) => $(row).children("th").length > 0,
    );
    const hasRequiredHeader = ownRows.some((row) => {
      const headers = readCells($, row).map(normalizeHeader);
      return headers.includes("job_no") && headers.includes("customer");
    });
    if (hasRequiredHeader) {
      tableElement = element;
    } else if (hasHeaderCells) {
      invalidHeaderFound = true;
    }
  });

  if (!tableElement) {
    return {
      schema: !headingFound
        ? "missing"
        : invalidHeaderFound
          ? "invalid"
          : "empty",
      rows: [],
    };
  }

  const rows = getOwnRows($, tableElement);
  const headerRowIndex = rows.findIndex((row) => {
    const headers = readCells($, row).map(normalizeHeader);
    return headers.includes("job_no") && headers.includes("customer");
  });
  if (headerRowIndex < 0) {
    return { schema: "invalid", rows: [] };
  }

  const headers = readCells($, rows[headerRowIndex]).map(normalizeHeader);
  return {
    schema: "table",
    rows: rows
      .slice(headerRowIndex + 1)
      .map((row, offset) => {
        const values = Object.fromEntries(
          headers.map((header, index) => [
            header || `column_${index + 1}`,
            readCells($, row)[index] ?? "",
          ]),
        );
        const rowIndex = headerRowIndex + 1 + offset;
        return {
          id: `${section}:${rowIndex}:${values.job_no || values.customer || "row"}`,
          rowIndex,
          values,
        };
      })
      .filter(
        (row) =>
          /^\d+$/.test(row.values.no ?? "") &&
          Boolean(row.values.job_no || row.values.customer),
      ),
  };
}

function getOwnRows(
  $: cheerio.CheerioAPI,
  table: Element,
): Element[] {
  return $(table)
    .find("tr")
    .filter((_index, row) => $(row).closest("table").get(0) === table)
    .toArray();
}

function readCells(
  $: cheerio.CheerioAPI,
  row: Element,
): string[] {
  return $(row)
    .children("th,td")
    .map((_index, cell) => normalizeText($(cell).text()))
    .get();
}

function normalizeHeader(value: string): string {
  return normalizeText(value).toLowerCase().replace(/\s+/g, "_");
}

function normalizeText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function parseCalendarDate(value: string): Date | undefined {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return undefined;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : undefined;
}

class GranotHttpClient {
  private readonly cookies = new Map<string, string>();
  private readonly fetchImplementation: typeof fetch;
  private readonly baseUrl: URL;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(dependencies: GranotCollectorDependencies) {
    this.fetchImplementation = dependencies.fetch ?? fetch;
    this.baseUrl = new URL(
      dependencies.baseUrl ?? "https://eagle.hellomoving.com",
    );
    this.timeoutMs = dependencies.timeoutMs ?? 20_000;
    this.maxResponseBytes = dependencies.maxResponseBytes ?? 10_000_000;
  }

  async request(
    path: string,
    init: { method?: "GET" | "POST"; body?: URLSearchParams } = {},
  ): Promise<string> {
    let url = new URL(path.replace(/&amp;/g, "&"), this.baseUrl);
    let method = init.method ?? "GET";
    let body = init.body;

    for (let redirects = 0; redirects < 10; redirects += 1) {
      if (url.origin !== this.baseUrl.origin) {
        throw new GranotCollectorError(
          "provider_error",
          "Granot attempted a cross-origin redirect",
        );
      }
      const headers = new Headers();
      const cookie = [...this.cookies]
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");
      if (cookie) headers.set("cookie", cookie);
      if (method === "POST") {
        headers.set("content-type", "application/x-www-form-urlencoded");
      }

      let response: Response;
      try {
        response = await this.fetchImplementation(url.href, {
          method,
          headers,
          body,
          redirect: "manual",
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        throw new GranotCollectorError(
          "provider_error",
          `Granot request failed: ${error instanceof Error ? error.name : "unknown error"}`,
        );
      }
      this.absorbCookies(response.headers);

      if (
        response.status >= 300 &&
        response.status < 400 &&
        response.headers.has("location")
      ) {
        url = new URL(response.headers.get("location")!, url);
        method =
          response.status === 307 || response.status === 308 ? method : "GET";
        if (method === "GET") body = undefined;
        continue;
      }
      if (!response.ok) {
        throw new GranotCollectorError(
          "provider_error",
          `Granot returned HTTP ${response.status}`,
        );
      }

      const declaredLength = Number(response.headers.get("content-length"));
      if (
        Number.isFinite(declaredLength) &&
        declaredLength > this.maxResponseBytes
      ) {
        throw new GranotCollectorError(
          "response_too_large",
          "Granot response exceeded the configured size limit",
        );
      }
      const bytes = await readResponseBody(response, this.maxResponseBytes);
      return new TextDecoder().decode(bytes);
    }

    throw new GranotCollectorError(
      "provider_error",
      "Granot exceeded the redirect limit",
    );
  }

  private absorbCookies(headers: Headers): void {
    const values =
      "getSetCookie" in headers &&
      typeof (headers as Headers & { getSetCookie(): string[] }).getSetCookie ===
        "function"
        ? (headers as Headers & { getSetCookie(): string[] }).getSetCookie()
        : [headers.get("set-cookie")].filter(
            (value): value is string => Boolean(value),
          );
    for (const raw of values) {
      const pair = raw.split(";", 1)[0] ?? "";
      const separator = pair.indexOf("=");
      if (separator > 0) {
        this.cookies.set(
          pair.slice(0, separator),
          pair.slice(separator + 1),
        );
      }
    }
  }
}

async function readResponseBody(
  response: Response,
  maxResponseBytes: number,
): Promise<Uint8Array> {
  if (!response.body) {
    return new Uint8Array();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxResponseBytes) {
      await reader.cancel();
      throw new GranotCollectorError(
        "response_too_large",
        "Granot response exceeded the configured size limit",
      );
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function readFormAction(html: string): string | undefined {
  const $ = cheerio.load(html);
  const action = $("form").first().attr("action")?.trim();
  if (action) return action;
  return html.match(/\.action\s*=\s*["']([^"']+)["']/i)?.[1];
}

function readFormValues(html: string): URLSearchParams {
  const $ = cheerio.load(html);
  const values = new URLSearchParams();
  $("form")
    .first()
    .find("input[name]")
    .each((_index, input) => {
      const name = $(input).attr("name");
      if (name) values.set(name, $(input).attr("value") ?? "");
    });
  return values;
}

function hasInput(html: string, name: string): boolean {
  const $ = cheerio.load(html);
  return $(`input[name="${name}"]`).length > 0;
}

function parseSourceSelector(
  html: string,
): Array<{ label: string; href: string }> {
  const $ = cheerio.load(html);
  return $("a[href*='adverlistwc']")
    .map((_index, anchor) => ({
      label: normalizeText($(anchor).text()),
      href: $(anchor).attr("href")?.trim() ?? "",
    }))
    .get()
    .filter(
      (source) =>
        Boolean(source.label && source.href) &&
        !/~USERLIST(?:[?#]|$)/i.test(source.href),
    );
}

function classifyExpectedPageError(
  html: string,
  expected: string,
): GranotCollectorError {
  const text = normalizeText(cheerio.load(html)("body").text()).toLowerCase();
  if (
    text.includes("security alert") ||
    text.includes("close window") ||
    text.includes("user login") ||
    text.includes("network login")
  ) {
    return new GranotCollectorError(
      "invalid_session",
      `Granot session became invalid before ${expected}`,
    );
  }
  return new GranotCollectorError(
    "schema_drift",
    `Granot did not return the expected ${expected} page`,
  );
}
