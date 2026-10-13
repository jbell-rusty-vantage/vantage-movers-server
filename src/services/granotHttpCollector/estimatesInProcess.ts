import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import type { Element } from "domhandler" with { "resolution-mode": "import" };
import {
  evaluateGranotAutomationCompatibility,
  type GranotAutomationCompatibilitySource,
} from "../granotLifecycle/automationCompatibility";
import {
  createMongoSourcePolicyStore,
  type SourcePolicyRow,
  type SourcePolicyStore,
} from "../granotLifecycle/sourcePolicy";
import { normalizeGranotSourceLabel } from "../granotLifecycle/sourceLabel";
import {
  getGranotDateWindowProblem,
  GranotCollectorError,
  openGranotAuthenticatedSession,
  type GranotCollectorCredentials,
  type GranotCollectorDependencies,
  type GranotReportRow,
  type GranotSourceCollection,
} from "./index";

const PRIOR_DIGIT = /prior:\s*(\d{1,12})(?!\d)/i;

export type EstimatesRoute = "form_leads" | "call_leads" | "unresolved";

export type EstimatesCollectionRequest = {
  dateWindow: { from: string; to: string };
  credentials: GranotCollectorCredentials;
};

export type EstimatesLabelLookup = (
  label: string,
) => Promise<readonly GranotAutomationCompatibilitySource[]>;

export type EstimatesPartition = {
  form: GranotSourceCollection[];
  call: GranotSourceCollection[];
  unresolved: Array<{ source: GranotSourceCollection; reason: string }>;
};

/**
 * Follow-Up Estimates on Estimates in Process. Reuses the two-page login.
 * Does not call `collectGranotReport` and does not request `mprep`.
 */
export async function collectEstimatesInProcess(
  input: EstimatesCollectionRequest,
  dependencies: GranotCollectorDependencies = {},
): Promise<GranotSourceCollection[]> {
  const dateProblem = getGranotDateWindowProblem(input.dateWindow);
  if (dateProblem) {
    throw new GranotCollectorError("invalid_request", dateProblem);
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await collectEstimatesInProcessOnce(input, dependencies);
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

async function collectEstimatesInProcessOnce(
  input: EstimatesCollectionRequest,
  dependencies: GranotCollectorDependencies,
): Promise<GranotSourceCollection[]> {
  const session = await openGranotAuthenticatedSession(
    input.credentials,
    dependencies,
  );
  const formPage = await session.request(
    `/wc.dll?mv~estprocesswc~${session.sessionToken}`,
  );
  if (pageLooksLoggedOut(formPage)) {
    throw new GranotCollectorError(
      "invalid_session",
      "Granot session became invalid before Estimates in Process",
    );
  }

  const body = new URLSearchParams();
  body.set("STATUS", "V9");
  body.set("TYPEDTE", "OPEN");
  body.set("DATE1", input.dateWindow.from);
  body.set("DATE2", input.dateWindow.to);
  body.set("FUSTATUS", "10");
  body.set("USER", "");
  body.set("DEPT", "ALL");
  body.set("TYPE", "V1");
  body.set("SORT", "V6");
  const resultsPage = await session.request(
    `/wc.dll?mv~estprocessret~${session.sessionToken}`,
    { method: "POST", body },
  );
  if (pageLooksLoggedOut(resultsPage)) {
    throw new GranotCollectorError(
      "invalid_session",
      "Granot session became invalid before Follow-Up Estimates",
    );
  }
  const parsed = parseEstimatesInProcessHtml(resultsPage);
  if (!parsed.recognized) {
    throw new GranotCollectorError(
      "schema_drift",
      "Granot Estimates in Process did not return a Follow-Up Estimates table",
    );
  }
  return parsed.sources;
}

export function parseEstimatesInProcessHtml(html: string): {
  recognized: boolean;
  sources: GranotSourceCollection[];
} {
  const $ = cheerio.load(html);
  let table: Element | undefined;
  let headerRow: Element | undefined;
  $("table").each((_index, element) => {
    if (table) return;
    for (const row of ownRows($, element)) {
      const headers = headerNames($, row);
      if (headers.includes("job_no") && headers.includes("customer")) {
        table = element;
        headerRow = row;
        return;
      }
    }
  });
  if (!table || !headerRow) return { recognized: false, sources: [] };

  const headers = headerNames($, headerRow);
  const rows = ownRows($, table);
  const headerIndex = rows.indexOf(headerRow);
  const adapted: Array<{ source: string; row: GranotReportRow }> = [];
  rows.slice(headerIndex + 1).forEach((row, offset) => {
    const cells = directCellTexts($, row);
    const raw: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (!header) return;
      raw[header] = cells[index] ?? "";
    });
    if (!raw.job_no?.trim()) return;
    const values = adaptEstimatesRow(raw);
    const rowIndex = headerIndex + 1 + offset;
    adapted.push({
      source: values.source ?? "",
      row: {
        id: `estimates:${rowIndex}:${values.job_no}`,
        rowIndex,
        values,
      },
    });
  });

  const grouped = new Map<string, GranotReportRow[]>();
  for (const entry of adapted) {
    const list = grouped.get(entry.source) ?? [];
    list.push(entry.row);
    grouped.set(entry.source, list);
  }
  const sources = [...grouped.entries()].map(([sourceLabel, sectionRows]) =>
    collectionFor(sourceLabel, sectionRows),
  );
  return { recognized: true, sources };
}

/** Registry route for one source label. Both routes, or neither, stay unresolved. */
export function estimatesRouteForMatches(
  matches: readonly GranotAutomationCompatibilitySource[],
): { route: EstimatesRoute; reason: string } {
  if (matches.length === 0) {
    return { route: "unresolved", reason: "missing_registry" };
  }
  if (matches.length !== 1) {
    return { route: "unresolved", reason: "ambiguous_label" };
  }
  const referenced = matches[0]!;
  const ready = (operation: "form_leads" | "call_leads") =>
    evaluateGranotAutomationCompatibility({
      granot_crm_source_id: referenced.id,
      requested_operations: [operation],
      referenced,
      normalized_label_match_count: 1,
    }).available_for_apply;
  const form = ready("form_leads");
  const call = ready("call_leads");
  if (form && call) return { route: "unresolved", reason: "both_routes" };
  if (form) return { route: "form_leads", reason: "form_leads" };
  if (call) return { route: "call_leads", reason: "call_leads" };
  return { route: "unresolved", reason: "not_ready" };
}

export async function partitionEstimatesSources(
  sources: GranotSourceCollection[],
  lookup: EstimatesLabelLookup,
): Promise<EstimatesPartition> {
  const form: GranotSourceCollection[] = [];
  const call: GranotSourceCollection[] = [];
  const unresolved: EstimatesPartition["unresolved"] = [];
  for (const source of sources) {
    const decision = estimatesRouteForMatches(await lookup(source.sourceLabel));
    if (decision.route === "form_leads") form.push(source);
    else if (decision.route === "call_leads") call.push(source);
    else unresolved.push({ source, reason: decision.reason });
  }
  return { form, call, unresolved };
}

export function estimatesRegistryLookup(
  store: SourcePolicyStore = createMongoSourcePolicyStore(),
): EstimatesLabelLookup {
  return async (label) => {
    const normalized = normalizeGranotSourceLabel(label);
    if (!normalized) return [];
    const rows = await store.findByNormalizedLabel(normalized);
    return rows.map(compatibilitySource);
  };
}

function compatibilitySource(row: SourcePolicyRow): GranotAutomationCompatibilitySource {
  return {
    id: row.id,
    enabled: row.enabled,
    lifecycle_enabled: row.lifecycle_enabled,
    lifecycle_disposition: row.lifecycle_disposition,
    lifecycle_routes: row.lifecycle_routes.map((route) => ({
      lead_model: route.lead_model,
    })),
    normalized_granot_label: row.normalized_granot_label,
  };
}

function adaptEstimatesRow(raw: Record<string, string>): Record<string, string> {
  const values: Record<string, string> = {};
  const put = (key: string, value: string | undefined) => {
    const trimmed = value?.trim();
    if (trimmed) values[key] = trimmed;
  };
  put("job_no", raw.job_no);
  put("phone", raw.phone1);
  put("email", raw.email);
  put("customer", raw.customer);
  put("user", raw.user);
  put("source", raw.source);
  put("from", joinCityState(raw.from_city, raw.from_state));
  put("from_zip", raw.from_zip);
  put("to", joinCityState(raw.to_city, raw.to_state));
  put("to_zip", raw.to_zip);
  put("est_cf", raw.cf);
  put("move_date", raw.move_date);
  put("ref_no", raw.ref_no);
  put("type", raw.type);
  put("estimate", raw.estimate);
  const priority = priorityDigit(raw.follow_up);
  if (priority) {
    values.prior = priority;
    values.priority = priority;
  }
  return values;
}

function priorityDigit(followUp: string | undefined): string | undefined {
  const match = followUp?.match(PRIOR_DIGIT);
  return match?.[1];
}

function joinCityState(city: string | undefined, state: string | undefined): string | undefined {
  const trimmedCity = city?.trim();
  const trimmedState = state?.trim();
  if (!trimmedCity || !trimmedState) return undefined;
  return `${trimmedCity}, ${trimmedState}`;
}

function collectionFor(
  sourceLabel: string,
  rows: GranotReportRow[],
): GranotSourceCollection {
  const sections = {
    bookedJobs: [] as GranotReportRow[],
    followUpEstimates: rows,
  };
  return {
    sourceLabel,
    contentHash: createHash("sha256")
      .update(JSON.stringify({ sourceLabel, sections }))
      .digest("hex"),
    sectionSchemas: {
      bookedJobs: "missing",
      followUpEstimates: rows.length > 0 ? "table" : "empty",
    },
    sections,
  };
}

function pageLooksLoggedOut(html: string): boolean {
  const text = cheerio.load(html)("body").text().replace(/\s+/g, " ").toLowerCase();
  return (
    text.includes("security alert") ||
    text.includes("close window") ||
    text.includes("user login") ||
    text.includes("network login")
  );
}

function ownRows($: cheerio.CheerioAPI, table: Element): Element[] {
  return $(table)
    .find("tr")
    .filter((_index, row) => $(row).closest("table").get(0) === table)
    .toArray();
}

function headerNames($: cheerio.CheerioAPI, row: Element): string[] {
  return $(row)
    .children("th,td")
    .toArray()
    .map((cell) =>
      $(cell).find("table").length > 0
        ? ""
        : normalizeHeader(directCellText($, cell)),
    );
}

function directCellTexts($: cheerio.CheerioAPI, row: Element): string[] {
  return $(row)
    .children("th,td")
    .toArray()
    .map((cell) => directCellText($, cell));
}

function directCellText($: cheerio.CheerioAPI, cell: Element): string {
  const clone = $(cell).clone();
  clone.find("table").remove();
  return clone.text().replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "_");
}
