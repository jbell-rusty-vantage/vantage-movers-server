export const HISTORICAL_MANIFEST_SCHEMA_VERSION = "1.0.0";
export const HISTORICAL_RULE_VERSION = "2026-07-31.1";

export type HistoricalEntityModel =
  | "Agent"
  | "Merchant"
  | "LeadSourceCompany"
  | "LeadSourceGranularity"
  | "OperationsRegistryChange"
  | "Customer"
  | "FormLead"
  | "CallLead"
  | "BookedLead"
  | "CancelledLead";

export type HistoricalCollection =
  | "agents"
  | "merchants"
  | "lead_source_companies"
  | "lead_source_granularities"
  | "operations_registry_changes"
  | "customers"
  | "form_leads"
  | "call_leads"
  | "booked_leads"
  | "cancelled_leads";

export type SourceProvenance = {
  spreadsheet_id: string;
  tab_id: number;
  tab_name: string;
  physical_row: number;
  row_checksum: string;
};

export type HistoricalSnapshot = {
  schema_version: "1.0.0";
  stage_run_id: string;
  created_at: string;
  inventory_checksum: string;
  snapshot_hash: string;
  sheets: Array<{
    workbook_key: string;
    spreadsheet_id: string;
    spreadsheet_title: string;
    version_before: string;
    version_after: string;
    tabs: Array<{
      tab_id: number;
      tab_name: string;
      kind: "form" | "call" | "bad_leads" | "booked" | "refund";
      source_company: string | null;
      source_granularity_key: string | null;
      header_row: number;
      headers: string[];
      range: string;
      row_count: number;
      column_count: number;
      rows: Array<{
        physical_row: number;
        formatted: unknown[];
        unformatted: unknown[];
        formulas: unknown[];
        formats: unknown[];
        row_checksum: string;
      }>;
    }>;
  }>;
  mongo: Array<{
    database: "vantagemovershistorical" | "vantagemovers";
    fingerprint: string;
    collections: Record<string, { count: number; checksum: string; documents: unknown[] }>;
  }>;
};

export type ConflictCase = {
  case_id: string;
  evidence_hash: string;
  rule_version: string;
  kind: string;
  blocking: boolean;
  status: "unresolved" | "decision_supplied" | "stale";
  source_provenance: SourceProvenance[];
  normalized_fields: Record<string, unknown>;
  candidate_ids: string[];
  rule_attempted: string;
  evidence: Array<Record<string, unknown>>;
  allowed_resolutions: string[];
};

export type ConflictDecision = {
  case_id: string;
  expected_evidence_hash: string;
  rule_version: string;
  resolution: string;
  selected_candidate_ids?: string[];
  field_choices?: Record<string, unknown>;
  rationale: string;
  decided_by: string;
  decided_at: string;
};

export type DecisionBundle = {
  schema_version: "1.0.0";
  decisions: ConflictDecision[];
};

export type HistoricalOperation = {
  operation_id: string;
  migration_key: string;
  order: number;
  action: "insert" | "update";
  model: HistoricalEntityModel;
  collection: HistoricalCollection;
  target_id: string;
  provenance: SourceProvenance[];
  document?: Record<string, unknown>;
  set?: Record<string, unknown>;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  precondition: Record<string, unknown>;
};

export type HistoricalManifestBody = {
  schema_version: typeof HISTORICAL_MANIFEST_SCHEMA_VERSION;
  rule_version: typeof HISTORICAL_RULE_VERSION;
  manifest_id: string;
  created_at: string;
  planning_timestamp: string;
  git_sha: string;
  target_database: "vantagemovers";
  target_cluster_fingerprint: string;
  source_inventory_checksum: string;
  source_snapshot_hash: string;
  historical_snapshot_hash: string;
  production_snapshot_hash: string;
  target_collection_checksums: Record<string, string>;
  policy_hashes: Record<string, string>;
  decision_bundle_hash: string;
  expected_indexes: Array<{ collection: string; name: string; key: Record<string, number>; unique: boolean }>;
  expected_counts: Record<string, { before: number; inserts: number; after: number }>;
  operations: HistoricalOperation[];
  conflicts: ConflictCase[];
  quarantine: ConflictCase[];
};

export type HistoricalManifest = HistoricalManifestBody & { manifest_hash: string };

export type ApplyResult = {
  manifest_hash: string;
  target_database: string;
  dry_run: boolean;
  inserted: number;
  updated: number;
  already_applied: number;
  batches: number;
};

export type VerificationResult = {
  manifest_hash: string;
  target_database: string;
  ok: boolean;
  checked_operations: number;
  verified_operations: number;
  errors: string[];
  prohibited_side_effect_counts: Record<string, number>;
};

export type RollbackResult = {
  manifest_hash: string;
  target_database: string;
  dry_run: boolean;
  deleted: number;
  restored: number;
  already_rolled_back: number;
  conflicts: string[];
};
