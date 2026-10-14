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

import { collectVerifiedEstimates, type EstimatesCollectionControls } from "./estimatesCollection";

export type { EstimatesCollectionCoverage } from "./estimatesCollection";

const REQUIRED_HEADERS = ["job_no", "open_date", "follow_up", "user", "customer", "source", "ref_no", "email", "phone1", "phone2", "from_city", "from_state", "from_zip", "to_city", "to_state", "to_zip", "move_date", "cf"];

export type EstimatesRoute = "form_leads" | "call_leads" | "unresolved";

export type EstimatesCollectionRequest = EstimatesCollectionControls & {
  additionalDateWindows?: Array<{ from: string; to: string }>;
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
  const transport = dependencies.fetch ?? globalThis.fetch;
  const guardedDependencies = input.beforeRequest ? {
    ...dependencies,
    fetch: (async (url, init) => {
      await input.beforeRequest?.();
      const response = await transport(url, init);
      await input.beforeRequest?.();
      return response;
    }) as typeof fetch,
  } : dependencies;
  const session = await openGranotAuthenticatedSession(
    input.credentials,
    guardedDependencies,
  );
  for (const window of input.additionalDateWindows ?? []) {
    const problem = getGranotDateWindowProblem(window);
    if (problem) throw new GranotCollectorError("invalid_request", problem);
  }
  return collectVerifiedEstimates(session, input.dateWindow, { ...input, beforeRequest: undefined });
}

export function parseEstimatesInProcessHtml(html: string): {
  recognized: boolean;
  sources: GranotSourceCollection[];
  diagnostics: string[];
  reportedTotal: number | null;
  pageNumber: number | null;
  pageCount: number | null;
  rowCount: number;
} {
  const $ = cheerio.load(html);
  $("script,style").remove();
  $("p,div,h1,h2,h3").prepend(" ").append(" ");
  const text = $("body").text().replace(/\s+/g, " ");
  const diagnostics: string[] = [];
  const totals = [...text.matchAll(/Total\s+of:\s*([\d,]+)\s+Transactions/gi)].map(m => Number(m[1]!.replaceAll(',', '')));
  if (new Set(totals).size > 1) diagnostics.push("conflicting_transaction_totals");
  const summaries = [...text.matchAll(/\bPage\s+(\d+)\s+(?:of|\/)\s*(\d+)\b/gi)];
  const pageNumber = summaries.length ? Number(summaries[0]![1]) : null;
  const pageCount = summaries.length ? Number(summaries[0]![2]) : null;
  if (summaries.some(m => Number(m[1]) !== pageNumber || Number(m[2]) !== pageCount) || (pageNumber !== null && (pageNumber < 1 || pageNumber > pageCount!))) diagnostics.push("invalid_page_summary");
  const pager = $('a,button,input,select').toArray().some(el => /^(next|previous|prev|first|last|[<>]{1,2})$/i.test($(el).text().trim() || $(el).attr('value') || '') || /next|prev/i.test($(el).attr('rel') ?? '') || /^(page|pageno|page_no|offset)$/i.test($(el).attr('name') ?? ''));
  if (pager && pageCount === null) diagnostics.push("unsupported_pagination");
  const result = { recognized: false, sources: [] as GranotSourceCollection[], diagnostics, reportedTotal: totals[0] ?? null, pageNumber, pageCount, rowCount: 0 };
  const candidates: Array<{ table: Element; headerRow: Element }> = [];
  $("table").each((_index, element) => {
    for (const row of ownRows($, element)) {
      const headers = headerNames($, row);
      if (headers.includes("job_no") && headers.includes("customer")) { candidates.push({ table: element, headerRow: row }); break; }
    }
  });
  if (!candidates.length && /Follow[- ]Up Estimates/i.test(text) && result.reportedTotal === 0) return { ...result, recognized: diagnostics.length === 0 };
  if (candidates.length !== 1) { diagnostics.push(candidates.length ? "multiple_results_tables" : "expected_results_table_missing"); return result; }
  const { table, headerRow } = candidates[0]!;
  const headers = headerNames($, headerRow);
  if (REQUIRED_HEADERS.some(header => !headers.includes(header)) || headers.filter(Boolean).length !== new Set(headers.filter(Boolean)).size || headers.includes("no")) {
    diagnostics.push("required_headers_missing_or_ambiguous"); return result;
  }
  const rows = ownRows($, table), headerIndex = rows.indexOf(headerRow);
  const grouped = new Map<string, GranotReportRow[]>();
  for (const [offset, row] of rows.slice(headerIndex + 1).entries()) {
    const cells = directCellTexts($, row);
    if (!cells.some(Boolean)) continue;
    const raw: Record<string, string> = {};
    headers.forEach((header, index) => { if (header) raw[header] = cells[index] ?? ""; });
    if (!raw.job_no?.trim() && (/^totals?$/i.test(raw.customer ?? '') || cells.every((cell,index) => !cell || ['cf','miles','lbs','rate','estimate'].includes(headers[index] ?? '')))) continue;
    if (cells.length !== headers.length) { diagnostics.push("data_row_cell_count_mismatch"); continue; }
    const values = adaptEstimatesRow(raw);
    if (!values.job_no) values.estimates_hold_reason = "missing_job_number";
    else if (!values.source) values.estimates_hold_reason = "missing_source";
    else if (!values.open_date || getGranotDateWindowProblem({ from:values.open_date, to:values.open_date })) values.estimates_hold_reason = "invalid_open_date";
    const rowIndex = headerIndex + 1 + offset;
    const source = values.source ?? "", list = grouped.get(source) ?? [];
    list.push({ id: `estimates:${rowIndex}:${values.job_no ?? 'missing'}`, rowIndex, values });
    grouped.set(source, list);
    result.rowCount++;
  }
  if (!result.rowCount && result.reportedTotal !== 0) diagnostics.push("empty_without_explicit_zero_total");
  result.sources = [...grouped.entries()].map(([source, rows]) => collectionFor(source, rows));
  result.recognized = diagnostics.length === 0;
  return result;
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
  put("phone2", raw.phone2);
  put("open_date_evidence", raw.open_date);
  const opened = raw.open_date?.match(/^(\d{1,2}\/\d{1,2}\/\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?)?$/i)?.[1];
  if (opened) {
    const [month, day, year] = opened.split('/');
    put("open_date", `${month!.padStart(2,'0')}/${day!.padStart(2,'0')}/${year}`);
  }
  put("email", raw.email);
  put("customer", raw.customer);
  put("user", raw.user);
  put("source", raw.source);
  for (const key of ["from_city", "from_state", "to_city", "to_state"]) put(key, raw[key]);
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
  if (priority !== undefined) {
    values.prior = priority;
    values.priority = priority;
  } else {
    values.estimates_hold_reason = "missing_or_ambiguous_priority";
    put("follow_up", raw.follow_up);
  }
  return values;
}

function priorityDigit(followUp: string | undefined): string | undefined {
  const matches = [...(followUp ?? "").matchAll(/\bprior:\s*(\d{1,12}|Pool)(?=\s|$)/gi)].map(match => /^pool$/i.test(match[1]!) ? "9" : match[1]!);
  const markers = (followUp ?? "").match(/\bprior:/gi) ?? [];
  return markers.length === matches.length && new Set(matches).size === 1 && /^[0-9]$/.test(matches[0]!) ? matches[0] : undefined;
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
