export const DATASET_KEYS = [
  "lead_outcome_detail",
  "lead_quality_exceptions",
  "source_performance",
] as const;

export type DatasetKey = (typeof DATASET_KEYS)[number];
export type Sensitivity = "public" | "internal" | "confidential_pii";
export type ScalarType =
  | "string"
  | "boolean"
  | "integer"
  | "decimal"
  | "money"
  | "date_time"
  | "date"
  | "enum"
  | "not_applicable_boolean";

export type SortDirection = "asc" | "desc";
export type SortTerm = { id: string; direction: SortDirection };
export type SelectedColumn = { id: string; label: string };

export interface DatasetColumn {
  id: string;
  defaultLabel: string;
  type: ScalarType;
  sensitivity: Sensitivity;
  default: boolean;
}

export interface MeasureContract {
  id: string;
  definition: string;
  type: ScalarType;
}

export interface DatasetContract {
  key: DatasetKey;
  schemaVersion: 1;
  grain: string;
  dateSemantic: string;
  columns: readonly DatasetColumn[];
  measures: readonly MeasureContract[];
  filterKeys: readonly string[];
  filterSchema: {
    unknownKeys: "reject";
    fields: readonly FilterFieldContract[];
  };
  allowedSorts: readonly string[];
  defaultSort: readonly SortTerm[];
  requiredTieBreakers: readonly SortTerm[];
  samplePolicyVersion: 1;
}

export interface FilterFieldContract {
  id: string;
  type: "enum" | "boolean" | "string_array" | "enum_array";
  required: boolean;
  options?: readonly string[];
  maxItems?: number;
}

export type RegistrySelectionSnapshot = {
  companies: Array<{ id: string; key: string; label: string }>;
  granularities: Array<{
    id: string;
    key: string;
    label: string;
    companyId: string;
  }>;
};

export type ResolvedWindow = {
  timezone: string;
  fromUtc: string;
  toExclusiveUtc: string;
};

export type VolumeEstimate = {
  kind: "exact" | "upper_bound";
  rows: number;
  explanation?: string;
};

export interface QueryPage<Row = Record<string, unknown>> {
  rows: Row[];
  nextCursor: string | null;
  rowCount: number;
  canonicalPageChecksum: string;
}

export interface ValidatedReportingRequest {
  datasetKey: DatasetKey;
  datasetSchemaVersion: 1;
  resolvedWindow: ResolvedWindow;
  registry: RegistrySelectionSnapshot;
  filters: Record<string, unknown>;
  selectedColumns: SelectedColumn[];
  effectiveSort: SortTerm[];
  sourceReadThrough?: string;
}

export type ReportingCandidateModel =
  | "FormLead"
  | "CallLead"
  | "BookedLead"
  | "CancelledLead"
  | "BookingLeadReconciliationCase"
  | "IngestionConflict";

export interface ReportingCandidateManifestEntryV1 {
  model: ReportingCandidateModel;
  id: string;
  version: string;
  fingerprint: string;
}

export interface ReportingCandidateManifestV1 {
  version: 1;
  sourceReadThrough: string;
  manifestCapturedAt: string;
  snapshotToken: {
    adapter: "mongodb_snapshot";
    operationTime: string;
    capturedAt: string;
  };
  entries: ReportingCandidateManifestEntryV1[];
  outputPages: ReportingOutputPageMapV1[];
  checksum: string;
}

export interface ReportingOutputPageMapV1 {
  pageNumber: number;
  afterCursor: string | null;
  nextCursor: string | null;
  dependencyKeys: string[];
}

export interface ReportingStreamCheckpointV1 {
  version: 1;
  cursor: string | null;
  pageNumber: number;
  rowCount: number;
  checksumAccumulator: string;
}

export interface ReportingExecutionPageV1<Row = Record<string, unknown>> {
  page: QueryPage<Row>;
  checkpoint: ReportingStreamCheckpointV1;
}
