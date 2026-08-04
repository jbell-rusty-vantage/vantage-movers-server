import { DATASET_KEYS, type DatasetKey } from "../../services/reporting/catalog/types";

export const REPORTING_DEFAULT_TIMEZONE = "America/New_York";
export const REPORTING_PREVIEW_LIMIT = 50;
export const REPORTING_PREVIEW_TTL_MS = 15 * 60 * 1000;
export const REPORTING_RUN_CONFIRMATION_TTL_MS = 10 * 60 * 1000;
export const REPORTING_PAGE_SIZE = 500;
export const REPORTING_MAX_PAGE_SIZE = 1_000;
export const REPORTING_MAX_WINDOW_DAYS = 366;
export const REPORTING_MAX_COHORT_ROWS = 50_000;
export const REPORTING_MAX_RELATED_ROWS = 200_000;
export const REPORTING_MAX_MANIFEST_ENTRIES = 250_000;
export const REPORTING_QUERY_MAX_TIME_MS = 15_000;
export const REPORTING_DESTINATION_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

export function parseReportingEnabledDatasets(
  raw = process.env.REPORTING_ENABLED_DATASETS,
): ReadonlySet<DatasetKey> {
  if (!raw?.trim()) return new Set(DATASET_KEYS);
  const tokens = raw.split(",").map((token) => token.trim());
  if (tokens.some((token) => !token)) {
    throw new Error("REPORTING_ENABLED_DATASETS contains a blank token.");
  }
  if (new Set(tokens).size !== tokens.length) {
    throw new Error("REPORTING_ENABLED_DATASETS contains duplicate tokens.");
  }
  for (const token of tokens) {
    if (!(DATASET_KEYS as readonly string[]).includes(token)) {
      throw new Error(`Unknown reporting dataset: ${token}`);
    }
  }
  return new Set(tokens as DatasetKey[]);
}
