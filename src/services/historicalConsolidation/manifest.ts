import { assertArtifactHash, sha256, stableJson } from "./stableJson";
import {
  HISTORICAL_MANIFEST_SCHEMA_VERSION,
  HISTORICAL_RULE_VERSION,
  type ConflictCase,
  type DecisionBundle,
  type HistoricalManifest,
  type HistoricalManifestBody,
  type HistoricalOperation,
} from "./types";
import { validateManifestOperations } from "./schemaValidation";

export type BuildHistoricalManifestInput = Omit<HistoricalManifestBody, "schema_version" | "rule_version" | "manifest_id" | "operations" | "conflicts"> & {
  manifest_id?: string;
  operations: Omit<HistoricalOperation, "operation_id">[];
  conflicts: ConflictCase[];
  decisions: DecisionBundle;
};

export function buildHistoricalManifest(input: BuildHistoricalManifestInput): HistoricalManifest {
  validateDecisions(input.conflicts, input.decisions);
  const decisionsByCase = new Map(input.decisions.decisions.map((entry) => [entry.case_id, entry]));
  const operations = input.operations
    .map((operation) => ({ ...operation, operation_id: sha256({ migration_key: operation.migration_key, action: operation.action, collection: operation.collection, target_id: operation.target_id, set: operation.set, document: operation.document, after: operation.after }) }))
    .sort((left, right) => left.order - right.order || left.operation_id.localeCompare(right.operation_id));
  if (new Set(operations.map((entry) => entry.operation_id)).size !== operations.length) throw new Error("Manifest contains duplicate operation IDs");
  validateManifestOperations(operations);
  const conflicts = input.conflicts.map((conflict) => ({ ...conflict, status: decisionsByCase.has(conflict.case_id) ? "decision_supplied" as const : conflict.status }));
  const manifestId = input.manifest_id ?? `historical-${sha256({ source_snapshot_hash: input.source_snapshot_hash, planning_timestamp: input.planning_timestamp, git_sha: input.git_sha, operations, conflicts, decisions: input.decisions }).slice(0, 32)}`;
  const body: HistoricalManifestBody = {
    schema_version: HISTORICAL_MANIFEST_SCHEMA_VERSION,
    rule_version: HISTORICAL_RULE_VERSION,
    manifest_id: manifestId,
    created_at: input.created_at,
    planning_timestamp: input.planning_timestamp,
    git_sha: input.git_sha,
    target_database: input.target_database,
    target_cluster_fingerprint: input.target_cluster_fingerprint,
    source_inventory_checksum: input.source_inventory_checksum,
    source_snapshot_hash: input.source_snapshot_hash,
    historical_snapshot_hash: input.historical_snapshot_hash,
    production_snapshot_hash: input.production_snapshot_hash,
    target_collection_checksums: input.target_collection_checksums,
    policy_hashes: input.policy_hashes,
    decision_bundle_hash: sha256(input.decisions),
    expected_indexes: input.expected_indexes,
    expected_counts: input.expected_counts,
    operations,
    conflicts,
    quarantine: [...new Map([...input.quarantine, ...input.conflicts.filter((conflict) => decisionsByCase.get(conflict.case_id)?.resolution === "quarantine")].map((entry) => [entry.case_id, entry])).values()],
  };
  return { ...body, manifest_hash: sha256(body) };
}

export function parseHistoricalManifest(bytes: string): HistoricalManifest {
  const parsed = JSON.parse(bytes) as HistoricalManifest;
  assertArtifactHash(parsed);
  if (parsed.schema_version !== HISTORICAL_MANIFEST_SCHEMA_VERSION || parsed.rule_version !== HISTORICAL_RULE_VERSION) throw new Error("Unsupported historical manifest schema or rule version");
  if (stableJson(parsed) !== stableJson(JSON.parse(stableJson(parsed)))) throw new Error("Manifest is not canonically serializable");
  return parsed;
}

function validateDecisions(conflicts: ConflictCase[], bundle: DecisionBundle): void {
  const byId = new Map(conflicts.map((entry) => [entry.case_id, entry]));
  const seen = new Set<string>();
  for (const decision of bundle.decisions) {
    if (seen.has(decision.case_id)) throw new Error(`Duplicate decision for ${decision.case_id}`);
    seen.add(decision.case_id);
    const conflict = byId.get(decision.case_id);
    if (!conflict) throw new Error(`Decision references unknown conflict ${decision.case_id}`);
    if (decision.expected_evidence_hash !== conflict.evidence_hash || decision.rule_version !== conflict.rule_version) throw new Error(`Stale decision for ${decision.case_id}`);
    if (!decision.rationale.trim() || !decision.decided_by.trim()) throw new Error(`Decision ${decision.case_id} requires reviewer and rationale`);
    if (!conflict.allowed_resolutions.includes(decision.resolution)) throw new Error(`Resolution ${decision.resolution} is not allowed for ${decision.case_id}`);
    if (!["quarantine", "preserve_production"].includes(decision.resolution)) {
      throw new Error(`Resolution ${decision.resolution} for ${decision.case_id} changes the plan and must be supplied through a reviewed mapping/input before replanning`);
    }
    for (const selected of decision.selected_candidate_ids ?? []) if (!conflict.candidate_ids.includes(selected)) throw new Error(`Decision ${decision.case_id} selected unknown candidate ${selected}`);
  }
}
