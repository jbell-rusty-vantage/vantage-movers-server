import { z } from "zod";
import { DATASET_KEYS, REPORTING_DATASETS, reportingError, type DatasetContract, type DatasetKey, type SortTerm } from "../services/reporting/catalog";
import { resolveReportingDateWindow } from "../services/reporting/timezone";
import { validateRegistrySelection } from "../services/reporting/registryFilters";
import { REPORTING_MAX_WINDOW_DAYS } from "../config/domain/reporting";

const key = z.string().trim().min(1).max(128).regex(/^[a-z0-9][a-z0-9_-]*$/);
const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const checksum = z.string().regex(/^[a-f\d]{64}$/i);
const sourceSelection = z.object({
  companyKeys: z.array(key).min(1).max(50),
  granularityKeys: z.array(key).max(200).default([]),
}).strict();
const localBoundary = z.string().trim().min(10).max(32);
const explicitDateWindow = z.object({
  kind: z.literal("explicit"),
  fromLocal: localBoundary,
  throughLocal: localBoundary.optional(),
  toExclusiveLocal: localBoundary.optional(),
  repeatedTimeDisambiguation: z.enum(["earlier", "later"]).optional(),
}).strict().refine(
  (value) =>
    Number(Boolean(value.throughLocal)) +
      Number(Boolean(value.toExclusiveLocal)) ===
    1,
  "Explicit windows require exactly one end boundary.",
);
const rollingDateWindow = z.object({
  kind: z.literal("rolling"),
  preset: z.literal("last_n_days"),
  days: z.number().int().min(1).max(REPORTING_MAX_WINDOW_DAYS),
  anchor: z.literal("preview_or_run_time"),
  endPolicy: z.literal("include_current_local_day"),
}).strict();
export const reportingDateWindowSchema = z.union([
  explicitDateWindow,
  rollingDateWindow,
]);
const selectedColumn = z.object({
  id: key,
  label: z.string().trim().min(1).max(100)
    .refine((value) => !/[\r\n\t]/.test(value))
    .refine((value) => !/^[=+\-@]/.test(value), "Column labels cannot begin with spreadsheet formula characters."),
}).strict();
const sortTerm = z.object({ id: key, direction: z.enum(["asc", "desc"]) }).strict();

const detailFilters = z.object({
  leadType: z.enum(["form", "call"]).optional(),
  agentKeys: z.array(key).max(100).optional(),
  merchantKeys: z.array(z.string().trim().min(1).max(128)).max(100).optional(),
  route: z.enum(["local", "long_distance"]).optional(),
  bookingStatus: z.enum(["booked", "unbooked"]).optional(),
  cancellationStatus: z.enum(["active", "cancelled_or_refunded"]).optional(),
}).strict();
const exceptionFilters = z.object({
  exceptionTypes: z.array(z.enum([
    "duplicate", "bad_lead", "unresolved_cpl_or_source_attribution", "leadless_booking",
    "ambiguous_or_unresolved_booking_match", "multiple_booking_anomaly",
    "source_canonical_divergence", "unresolved_cancellation_or_refund_relationship",
  ])).max(8).optional(),
  leadType: z.enum(["form", "call", "none"]).optional(),
}).strict();
const performanceFilters = z.object({
  timeDimension: z.enum(["none", "day", "month"]).default("none"),
  includeGranularity: z.boolean().default(false),
  leadType: z.enum(["form", "call"]).optional(),
}).strict();

export const reportingDraftSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).default(""),
  datasetKey: z.enum(DATASET_KEYS),
  datasetSchemaVersion: z.literal(1),
  timezone: z.string().trim().min(1),
  dateWindow: reportingDateWindowSchema,
  sources: sourceSelection,
  filters: z.record(z.string(), z.unknown()).default({}),
  selectedColumns: z.array(selectedColumn).min(1).max(64),
  sort: z.array(sortTerm).min(1).max(12),
  destinationId: z.string().trim().min(1).max(256),
  destinationSnapshotChecksum: checksum,
  strategy: z.enum(["replace_tab", "snapshot"]),
}).strict();

export const saveDefinitionSchema = z.object({
  draft: reportingDraftSchema,
  previewId: objectId,
  previewChecksum: checksum,
}).strict();
export const runRequestSchema = z.object({
  revisionId: objectId.optional(),
  confirmationToken: z.string().min(1).max(4096).optional(),
  idempotencyKey: z.string().trim().min(8).max(200)
    .regex(/^[A-Za-z0-9._:-]+$/),
}).strict();

export async function validateReportingDraft(input: unknown) {
  const draft = reportingDraftSchema.parse(input);
  const contract = REPORTING_DATASETS[draft.datasetKey];
  const filters = parseFilters(draft.datasetKey, draft.filters);
  const columnIds = new Set(contract.columns.map((column) => column.id));
  if (draft.selectedColumns.some((column) => !columnIds.has(column.id))) {
    throw reportingError("invalid_column", "Selected columns must come from the dataset catalog.");
  }
  if (new Set(draft.selectedColumns.map((column) => column.id)).size !== draft.selectedColumns.length) {
    throw reportingError("invalid_column", "Selected column IDs must be unique.");
  }
  const effectiveSort = validateAndBuildEffectiveSort(contract, draft.sort);
  const resolvedWindow = resolveReportingDateWindow(
    draft.dateWindow,
    draft.timezone,
    new Date(),
  );
  const windowDays =
    (new Date(resolvedWindow.toExclusiveUtc).getTime() -
      new Date(resolvedWindow.fromUtc).getTime()) /
    86_400_000;
  if (windowDays > REPORTING_MAX_WINDOW_DAYS) {
    throw reportingError(
      "invalid_date_window",
      `Reporting windows cannot exceed ${REPORTING_MAX_WINDOW_DAYS} days.`,
    );
  }
  const registry = await validateRegistrySelection(draft.sources);
  return { draft, contract, filters, registry, resolvedWindow, effectiveSort };
}

export function validateAndBuildEffectiveSort(
  contract: DatasetContract,
  ownerSort: SortTerm[],
): SortTerm[] {
  const allowedSorts = new Set(contract.allowedSorts);
  if (ownerSort.some((term) => !allowedSorts.has(term.id))) {
    throw reportingError(
      "invalid_sort",
      "Sort terms must come from the owner-visible dataset allowlist.",
    );
  }
  if (new Set(ownerSort.map((term) => term.id)).size !== ownerSort.length) {
    throw reportingError("invalid_sort", "Sort terms must be unique.");
  }
  return [
    ...ownerSort,
    ...contract.requiredTieBreakers.map((term) => ({
      id: term.id,
      direction: "asc" as const,
    })),
  ];
}

function parseFilters(datasetKey: DatasetKey, value: unknown): Record<string, unknown> {
  const schema = datasetKey === "lead_outcome_detail"
    ? detailFilters
    : datasetKey === "lead_quality_exceptions"
      ? exceptionFilters
      : performanceFilters;
  return schema.parse(value) as Record<string, unknown>;
}
