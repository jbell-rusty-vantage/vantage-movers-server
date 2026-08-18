import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ObjectId, type Collection } from "mongodb";
import { normalizeJobNo } from "../../src/services/bookings/bookingIdentity";
import {
  CALL_LEAD_INGESTION_ORIGINS,
  FORM_LEAD_INGESTION_ORIGINS,
} from "../../src/models/granotLifecycleSchemas";
import {
  granotLifecycleOutputDirectory,
  maskReceiptId,
} from "./granot-lifecycle-migration.lib";
import {
  LEAD_REVISION_COLLECTIONS,
  coerceInventoryDate,
  parseReviewedBoundaryIso,
  planRevisionBackfill,
  publicRevisionCollectionSummary,
  revisionManifestChecksum,
  verifyRevisionInventory,
  type RevisionCollectionPlan,
  type RevisionInventoryRow,
} from "./granot-lifecycle-revisions.lib";

export const LEAD_PROVENANCE_REVISION_SCRIPT_VERSION =
  "granot-lifecycle-lead-provenance/1";
export const LEAD_PROVENANCE_MIGRATION_SCRIPT_VERSION =
  "granot-lifecycle-lead-provenance/2";
export const REVIEWED_BASELINE_FILENAME = "reviewed-baseline.json";
export const PROVENANCE_APPLY_BATCH_SIZE = 100;

export const LEAD_PROVENANCE_REVISION_COLLECTIONS = LEAD_REVISION_COLLECTIONS;

const CONTACT_SNAPSHOT_FIELDS = [
  "first_name",
  "last_name",
  "name",
  "phone_number",
  "normalized_phone_number",
  "email",
] as const;

const MOVE_SNAPSHOT_FIELDS = [
  "pickup_city",
  "pickup_zip",
  "pickup_state",
  "delivery_city",
  "destination_zip",
  "delivery_state",
  "move_date",
  "move_size",
] as const;

const FORBIDDEN_PII_KEYS = new Set([
  "job_no",
  "normalized_job_no",
  "name",
  "first_name",
  "last_name",
  "phone_number",
  "normalized_phone_number",
  "email",
  "pickup_city",
  "pickup_zip",
  "pickup_state",
  "delivery_city",
  "destination_zip",
  "delivery_state",
  "move_date",
  "move_size",
  "ref_no",
  "lid",
  "source_company",
  "payload",
  "authorization",
  "cookie",
  "credential",
]);

export type LeadKind = "form" | "call";

export type LeadProvenanceInventoryRow = RevisionInventoryRow & {
  ingestion_origin?: unknown;
  job_no?: unknown;
  ingested_contact_snapshot?: unknown;
  ingested_move_snapshot?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  name?: unknown;
  phone_number?: unknown;
  normalized_phone_number?: unknown;
  email?: unknown;
  pickup_city?: unknown;
  pickup_zip?: unknown;
  pickup_state?: unknown;
  delivery_city?: unknown;
  destination_zip?: unknown;
  delivery_state?: unknown;
  move_date?: unknown;
  move_size?: unknown;
  duplicate?: unknown;
  bad_lead?: unknown;
  source_granularity_id?: unknown;
  ref_no?: unknown;
  lid?: unknown;
  quoted?: unknown;
  booked?: unknown;
  cancelled?: unknown;
  cpl?: unknown;
  sheet_sync?: unknown;
  ringcentral_ingestion_source?: unknown;
};

export type OriginClass =
  | "missing"
  | "valid_deterministic"
  | "valid_legacy_unknown"
  | "contradiction";

export type SnapshotClass =
  | "absent"
  | "captured_at_ingestion"
  | "legacy_baseline"
  | "malformed";

export type PlannedProvenanceRow = {
  id: string;
  masked_id: string;
  set_origin: boolean;
  planned_origin?: string;
  set_normalized_job_no: boolean;
  set_contact_snapshot: boolean;
  set_move_snapshot: boolean;
};

export type ProvenanceBlocker = {
  masked_id: string;
  reasons: string[];
};

export type ReviewedBaselineRecord = {
  baseline_captured_at: string;
  recorded_at: string;
};

export type NormalizationCollision = {
  key_fingerprint: string;
  count: number;
  masked_ids: string[];
};

export type LeadProvenanceCollectionPlan = {
  collection: "form_leads" | "call_leads";
  kind: LeadKind;
  total: number;
  planned: PlannedProvenanceRow[];
  unchanged: number;
  blocked: number;
  blockers: ProvenanceBlocker[];
  origin_counts: Record<string, number>;
  deterministic_origin_count: number;
  legacy_unknown_count: number;
  contradiction_count: number;
  missing_job: number;
  invalid_job: number;
  raw_present_job: number;
  normalized_absent_job: number;
  snapshot_absent: number;
  snapshot_captured_at_ingestion: number;
  snapshot_legacy_baseline: number;
  snapshot_malformed: number;
  move_snapshot_absent: number;
  move_snapshot_captured_at_ingestion: number;
  move_snapshot_legacy_baseline: number;
  move_snapshot_malformed: number;
  duplicate_count: number;
  bad_lead_count: number;
  restriction_relevant_count: number;
  missing_source_scope: number;
  invalid_source_scope: number;
  collision_groups: NormalizationCollision[];
  revision_valid: number;
  revision_would_preserve: number;
  history_boundary_valid: number;
  history_boundary_would_preserve: number;
};

export function planLeadRevisionMigration(input: {
  rowsByCollection: Record<(typeof LEAD_REVISION_COLLECTIONS)[number], readonly RevisionInventoryRow[]>;
}): RevisionCollectionPlan[] {
  return LEAD_REVISION_COLLECTIONS.map((collection) =>
    planRevisionBackfill({
      collection,
      rows: input.rowsByCollection[collection],
    }),
  );
}

export function verifyLeadRevisionMigration(input: {
  rowsByCollection: Record<(typeof LEAD_REVISION_COLLECTIONS)[number], readonly RevisionInventoryRow[]>;
}) {
  const results = LEAD_REVISION_COLLECTIONS.map((collection) =>
    verifyRevisionInventory({
      collection,
      rows: input.rowsByCollection[collection],
    }),
  );
  return {
    ok: results.every((result) => result.ok),
    failures: results.flatMap((result) => result.failures),
  };
}

export function leadRevisionManifestBody(input: {
  databaseName: string;
  databaseCategory: "test" | "production";
  mode: string;
  reviewedBoundary: string;
  boundarySource: string;
  plans: readonly RevisionCollectionPlan[];
  applied: number;
  concurrentMismatch?: boolean;
  verify?: { ok: boolean; failures: string[] };
}) {
  const collections = input.plans.map(publicRevisionCollectionSummary);
  const checksum = revisionManifestChecksum({
    reviewed_change_history_started_at: input.reviewedBoundary,
    collections: collections.map((collection) => ({
      collection: collection.collection,
      total: collection.total,
      missing_revision: collection.missing_revision,
      valid_revision: collection.valid_revision,
      invalid_revision: collection.invalid_revision,
      missing_boundary: collection.missing_boundary,
      valid_boundary: collection.valid_boundary,
      invalid_boundary: collection.invalid_boundary,
      planned_count: collection.planned_count,
      blocker_count: collection.blocker_count,
    })),
  });
  return {
    script_version: LEAD_PROVENANCE_REVISION_SCRIPT_VERSION,
    database_name: input.databaseName,
    database_category: input.databaseCategory,
    mode: input.mode,
    reviewed_change_history_started_at: input.reviewedBoundary,
    reviewed_boundary_source: input.boundarySource,
    collections,
    applied: input.applied,
    concurrent_mismatch: input.concurrentMismatch ?? false,
    last_change_writes: 0,
    fabricated_entity_changes: 0,
    fabricated_decisions: 0,
    fabricated_commands: 0,
    sheet_sync_requests: 0,
    historical_collections_targeted: [],
    checksum,
    verify: input.verify,
  };
}

export function reviewedBaselineDirectory(): string {
  return granotLifecycleOutputDirectory("granot-lifecycle-lead-provenance");
}

export function readReviewedBaselineArg(
  args: readonly string[],
): string | undefined {
  const flag = args.find((arg) => arg.startsWith("--baseline-captured-at="));
  return flag?.slice("--baseline-captured-at=".length).trim() || undefined;
}

export async function loadPersistedReviewedBaseline(
  directory = reviewedBaselineDirectory(),
): Promise<ReviewedBaselineRecord | undefined> {
  try {
    const raw = await readFile(path.join(directory, REVIEWED_BASELINE_FILENAME), "utf8");
    const parsed = JSON.parse(raw) as ReviewedBaselineRecord;
    parseReviewedBoundaryIso(parsed.baseline_captured_at);
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export async function persistReviewedBaseline(
  iso: string,
  directory = reviewedBaselineDirectory(),
): Promise<ReviewedBaselineRecord> {
  parseReviewedBoundaryIso(iso);
  const record: ReviewedBaselineRecord = {
    baseline_captured_at: iso,
    recorded_at: new Date().toISOString(),
  };
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, REVIEWED_BASELINE_FILENAME),
    `${JSON.stringify(record, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  return record;
}

export async function resolveReviewedBaseline(input: {
  requested?: string;
  allowGenerate?: boolean;
  now?: Date;
  directory?: string;
}): Promise<{
  record: ReviewedBaselineRecord;
  source: "requested" | "persisted" | "generated";
}> {
  const directory = input.directory ?? reviewedBaselineDirectory();
  const existing = await loadPersistedReviewedBaseline(directory);
  if (input.requested) {
    const requested = parseReviewedBoundaryIso(input.requested).toISOString();
    if (existing && existing.baseline_captured_at !== requested) {
      throw new Error(
        "Contradictory reviewed baseline: requested ISO does not match the persisted baseline_captured_at.",
      );
    }
    if (existing) {
      return { record: existing, source: "persisted" };
    }
    return {
      record: await persistReviewedBaseline(requested, directory),
      source: "requested",
    };
  }
  if (existing) {
    return { record: existing, source: "persisted" };
  }
  if (!input.allowGenerate) {
    throw new Error(
      "Reviewed baseline_captured_at is missing. Run report first so apply/verify can reuse the recorded ISO.",
    );
  }
  const generated = (input.now ?? new Date()).toISOString();
  return {
    record: await persistReviewedBaseline(generated, directory),
    source: "generated",
  };
}

export function allowedOriginsFor(kind: LeadKind): readonly string[] {
  return kind === "form" ? FORM_LEAD_INGESTION_ORIGINS : CALL_LEAD_INGESTION_ORIGINS;
}

export function classifyLeadIngestionOrigin(input: {
  kind: LeadKind;
  ingestion_origin?: unknown;
}): { status: OriginClass; planned_origin?: string } {
  if (input.ingestion_origin === undefined || input.ingestion_origin === null || input.ingestion_origin === "") {
    return { status: "missing", planned_origin: "legacy_unknown" };
  }
  if (typeof input.ingestion_origin !== "string") {
    return { status: "contradiction" };
  }
  if (!allowedOriginsFor(input.kind).includes(input.ingestion_origin)) {
    return { status: "contradiction" };
  }
  if (input.ingestion_origin === "legacy_unknown") {
    return { status: "valid_legacy_unknown" };
  }
  return { status: "valid_deterministic" };
}

function optionalPresentText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function hasAllowedContactValue(row: LeadProvenanceInventoryRow): boolean {
  return CONTACT_SNAPSHOT_FIELDS.some((field) => optionalPresentText(row[field]));
}

export function hasAllowedMoveValue(row: LeadProvenanceInventoryRow): boolean {
  if (coerceInventoryDate(row.move_date)) {
    return true;
  }
  return MOVE_SNAPSHOT_FIELDS.filter((field) => field !== "move_date").some((field) =>
    optionalPresentText(row[field]),
  );
}

export function classifyIngestedSnapshot(value: unknown): SnapshotClass {
  if (value === undefined || value === null) {
    return "absent";
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return "malformed";
  }
  const snapshot = value as { evidence_status?: unknown; captured_at?: unknown };
  if (
    snapshot.evidence_status !== "captured_at_ingestion" &&
    snapshot.evidence_status !== "legacy_baseline"
  ) {
    return "malformed";
  }
  if (!coerceInventoryDate(snapshot.captured_at)) {
    return "malformed";
  }
  return snapshot.evidence_status;
}

export function buildLegacyBaselineContactSnapshot(
  row: LeadProvenanceInventoryRow,
  baselineCapturedAt: Date,
): Record<string, unknown> | undefined {
  if (!hasAllowedContactValue(row)) {
    return undefined;
  }
  const snapshot: Record<string, unknown> = {
    captured_at: baselineCapturedAt,
    evidence_status: "legacy_baseline",
  };
  for (const field of CONTACT_SNAPSHOT_FIELDS) {
    const value = optionalPresentText(row[field]);
    if (value) {
      snapshot[field] = value;
    }
  }
  return snapshot;
}

export function buildLegacyBaselineMoveSnapshot(
  row: LeadProvenanceInventoryRow,
  baselineCapturedAt: Date,
): Record<string, unknown> | undefined {
  if (!hasAllowedMoveValue(row)) {
    return undefined;
  }
  const snapshot: Record<string, unknown> = {
    captured_at: baselineCapturedAt,
    evidence_status: "legacy_baseline",
  };
  for (const field of MOVE_SNAPSHOT_FIELDS) {
    if (field === "move_date") {
      const moveDate = coerceInventoryDate(row.move_date);
      if (moveDate) {
        snapshot.move_date = moveDate;
      }
      continue;
    }
    const value = optionalPresentText(row[field]);
    if (value) {
      snapshot[field] = value;
    }
  }
  return snapshot;
}

export function classifyLeadJob(row: LeadProvenanceInventoryRow): {
  missing: boolean;
  invalid: boolean;
  raw_present: boolean;
  normalized_absent: boolean;
  planned_normalized?: string;
  contradiction: boolean;
} {
  const raw = optionalPresentText(row.job_no);
  const existingNormalized =
    typeof row.normalized_job_no === "string" && row.normalized_job_no.trim()
      ? row.normalized_job_no
      : undefined;
  const expected = raw ? normalizeJobNo(raw) : undefined;
  if (raw && !expected) {
    return {
      missing: false,
      invalid: true,
      raw_present: true,
      normalized_absent: !existingNormalized,
      contradiction: false,
    };
  }
  if (raw && expected && existingNormalized && existingNormalized !== expected) {
    return {
      missing: false,
      invalid: false,
      raw_present: true,
      normalized_absent: false,
      contradiction: true,
    };
  }
  if (raw && expected && !existingNormalized) {
    return {
      missing: false,
      invalid: false,
      raw_present: true,
      normalized_absent: true,
      planned_normalized: expected,
      contradiction: false,
    };
  }
  return {
    missing: !raw && !existingNormalized,
    invalid: existingNormalized != null && typeof row.normalized_job_no !== "string",
    raw_present: Boolean(raw),
    normalized_absent: !existingNormalized,
    contradiction: false,
  };
}

function sourceScopeClass(
  value: unknown,
): "missing" | "valid" | "invalid" {
  if (value === undefined || value === null || value === "") {
    return "missing";
  }
  const text = String(value);
  if (ObjectId.isValid(text) && String(new ObjectId(text)) === text) {
    return "valid";
  }
  if (value instanceof ObjectId) {
    return "valid";
  }
  return "invalid";
}

function fingerprintCollisionKey(
  sourceGranularityId: string,
  normalizedJob: string,
): string {
  return createHash("sha256")
    .update(`source_scope:${sourceGranularityId}|normalized_job_no:${normalizedJob}`)
    .digest("hex")
    .slice(0, 16);
}

function emptyOriginCounts(kind: LeadKind): Record<string, number> {
  return Object.fromEntries(allowedOriginsFor(kind).map((origin) => [origin, 0]));
}

export function planLeadProvenanceCollection(input: {
  collection: "form_leads" | "call_leads";
  rows: readonly LeadProvenanceInventoryRow[];
}): LeadProvenanceCollectionPlan {
  const kind: LeadKind = input.collection === "form_leads" ? "form" : "call";
  const planned: PlannedProvenanceRow[] = [];
  const blockers: ProvenanceBlocker[] = [];
  const originCounts = emptyOriginCounts(kind);
  const collisionGroups = new Map<string, { count: number; masked_ids: string[] }>();
  let deterministic = 0;
  let legacyUnknown = 0;
  let contradictions = 0;
  let missingJob = 0;
  let invalidJob = 0;
  let rawPresent = 0;
  let normalizedAbsent = 0;
  let snapshotAbsent = 0;
  let snapshotCaptured = 0;
  let snapshotBaseline = 0;
  let snapshotMalformed = 0;
  let moveAbsent = 0;
  let moveCaptured = 0;
  let moveBaseline = 0;
  let moveMalformed = 0;
  let duplicateCount = 0;
  let badLeadCount = 0;
  let restrictionRelevant = 0;
  let missingSourceScope = 0;
  let invalidSourceScope = 0;
  let revisionValid = 0;
  let revisionWouldPreserve = 0;
  let boundaryValid = 0;
  let boundaryWouldPreserve = 0;
  let unchanged = 0;

  const revisionPlan = planRevisionBackfill({
    collection: input.collection,
    rows: input.rows,
  });
  revisionValid = revisionPlan.valid_revision;
  boundaryValid = revisionPlan.valid_boundary;
  revisionWouldPreserve = revisionPlan.valid_revision;
  boundaryWouldPreserve = revisionPlan.valid_boundary;

  const sorted = [...input.rows].sort((left, right) => left._id.localeCompare(right._id));
  for (const row of sorted) {
    const origin = classifyLeadIngestionOrigin({
      kind,
      ingestion_origin: row.ingestion_origin,
    });
    const job = classifyLeadJob(row);
    const contactClass = classifyIngestedSnapshot(row.ingested_contact_snapshot);
    const moveClass =
      kind === "form" ? classifyIngestedSnapshot(row.ingested_move_snapshot) : "absent";
    const reasons: string[] = [];

    if (origin.status === "contradiction") {
      contradictions += 1;
      reasons.push("origin_contradiction");
    }
    if (origin.status === "valid_deterministic") {
      deterministic += 1;
      originCounts[String(row.ingestion_origin)] += 1;
    }
    if (origin.status === "valid_legacy_unknown") {
      legacyUnknown += 1;
      originCounts.legacy_unknown += 1;
    }
    if (origin.status === "missing") {
      legacyUnknown += 1;
      originCounts.legacy_unknown += 1;
    }

    if (job.missing) missingJob += 1;
    if (job.invalid) invalidJob += 1;
    if (job.raw_present) rawPresent += 1;
    if (job.normalized_absent) normalizedAbsent += 1;
    if (job.contradiction) reasons.push("normalized_job_mismatch");
    if (job.invalid) reasons.push("invalid_job");

    if (contactClass === "absent") snapshotAbsent += 1;
    if (contactClass === "captured_at_ingestion") snapshotCaptured += 1;
    if (contactClass === "legacy_baseline") snapshotBaseline += 1;
    if (contactClass === "malformed") {
      snapshotMalformed += 1;
      reasons.push("malformed_contact_snapshot");
    }
    if (kind === "form") {
      if (moveClass === "absent") moveAbsent += 1;
      if (moveClass === "captured_at_ingestion") moveCaptured += 1;
      if (moveClass === "legacy_baseline") moveBaseline += 1;
      if (moveClass === "malformed") {
        moveMalformed += 1;
        reasons.push("malformed_move_snapshot");
      }
    }

    if (row.duplicate === true) {
      duplicateCount += 1;
      restrictionRelevant += 1;
    }
    if (kind === "form" && optionalPresentText(row.bad_lead)) {
      badLeadCount += 1;
      if (row.duplicate !== true) {
        restrictionRelevant += 1;
      }
    }

    const scope = sourceScopeClass(row.source_granularity_id);
    const normalizedForCollision =
      typeof row.normalized_job_no === "string" && row.normalized_job_no.trim()
        ? row.normalized_job_no
        : job.planned_normalized;
    if (normalizedForCollision) {
      if (scope === "missing") missingSourceScope += 1;
      if (scope === "invalid") invalidSourceScope += 1;
      const scopeKey =
        scope === "valid" ? String(row.source_granularity_id) : `unscoped:${scope}`;
      const fingerprint = fingerprintCollisionKey(scopeKey, normalizedForCollision);
      const current = collisionGroups.get(fingerprint) ?? { count: 0, masked_ids: [] };
      current.count += 1;
      current.masked_ids.push(maskReceiptId(row._id));
      collisionGroups.set(fingerprint, current);
    }

    if (reasons.length > 0) {
      blockers.push({ masked_id: maskReceiptId(row._id), reasons });
      continue;
    }

    const setOrigin = origin.status === "missing";
    const setNormalized = Boolean(job.planned_normalized);
    const setContact =
      contactClass === "absent" && hasAllowedContactValue(row);
    const setMove =
      kind === "form" && moveClass === "absent" && hasAllowedMoveValue(row);
    if (!setOrigin && !setNormalized && !setContact && !setMove) {
      unchanged += 1;
      continue;
    }
    planned.push({
      id: row._id,
      masked_id: maskReceiptId(row._id),
      set_origin: setOrigin,
      planned_origin: setOrigin ? origin.planned_origin : undefined,
      set_normalized_job_no: setNormalized,
      set_contact_snapshot: setContact,
      set_move_snapshot: setMove,
    });
  }

  return {
    collection: input.collection,
    kind,
    total: input.rows.length,
    planned,
    unchanged,
    blocked: blockers.length,
    blockers,
    origin_counts: originCounts,
    deterministic_origin_count: deterministic,
    legacy_unknown_count: legacyUnknown,
    contradiction_count: contradictions,
    missing_job: missingJob,
    invalid_job: invalidJob,
    raw_present_job: rawPresent,
    normalized_absent_job: normalizedAbsent,
    snapshot_absent: snapshotAbsent,
    snapshot_captured_at_ingestion: snapshotCaptured,
    snapshot_legacy_baseline: snapshotBaseline,
    snapshot_malformed: snapshotMalformed,
    move_snapshot_absent: moveAbsent,
    move_snapshot_captured_at_ingestion: moveCaptured,
    move_snapshot_legacy_baseline: moveBaseline,
    move_snapshot_malformed: moveMalformed,
    duplicate_count: duplicateCount,
    bad_lead_count: badLeadCount,
    restriction_relevant_count: restrictionRelevant,
    missing_source_scope: missingSourceScope,
    invalid_source_scope: invalidSourceScope,
    collision_groups: [...collisionGroups.entries()]
      .filter(([, group]) => group.count > 1)
      .map(([key_fingerprint, group]) => ({
        key_fingerprint,
        count: group.count,
        masked_ids: group.masked_ids.sort(),
      }))
      .sort((left, right) => left.key_fingerprint.localeCompare(right.key_fingerprint)),
    revision_valid: revisionValid,
    revision_would_preserve: revisionWouldPreserve,
    history_boundary_valid: boundaryValid,
    history_boundary_would_preserve: boundaryWouldPreserve,
  };
}

export function planLeadProvenanceMigration(input: {
  rowsByCollection: Record<"form_leads" | "call_leads", readonly LeadProvenanceInventoryRow[]>;
}): LeadProvenanceCollectionPlan[] {
  return LEAD_PROVENANCE_REVISION_COLLECTIONS.map((collection) =>
    planLeadProvenanceCollection({
      collection,
      rows: input.rowsByCollection[collection],
    }),
  );
}

export function publicProvenanceCollectionSummary(plan: LeadProvenanceCollectionPlan) {
  return {
    collection: plan.collection,
    total: plan.total,
    planned_count: plan.planned.length,
    unchanged: plan.unchanged,
    blocked: plan.blocked,
    origin_counts: plan.origin_counts,
    deterministic_origin_count: plan.deterministic_origin_count,
    legacy_unknown_count: plan.legacy_unknown_count,
    contradiction_count: plan.contradiction_count,
    missing_job: plan.missing_job,
    invalid_job: plan.invalid_job,
    raw_present_job: plan.raw_present_job,
    normalized_absent_job: plan.normalized_absent_job,
    snapshot_absent: plan.snapshot_absent,
    snapshot_captured_at_ingestion: plan.snapshot_captured_at_ingestion,
    snapshot_legacy_baseline: plan.snapshot_legacy_baseline,
    snapshot_malformed: plan.snapshot_malformed,
    move_snapshot_absent: plan.move_snapshot_absent,
    move_snapshot_captured_at_ingestion: plan.move_snapshot_captured_at_ingestion,
    move_snapshot_legacy_baseline: plan.move_snapshot_legacy_baseline,
    move_snapshot_malformed: plan.move_snapshot_malformed,
    duplicate_count: plan.duplicate_count,
    bad_lead_count: plan.bad_lead_count,
    restriction_relevant_count: plan.restriction_relevant_count,
    missing_source_scope: plan.missing_source_scope,
    invalid_source_scope: plan.invalid_source_scope,
    collision_groups: plan.collision_groups,
    revision_valid: plan.revision_valid,
    revision_would_preserve: plan.revision_would_preserve,
    history_boundary_valid: plan.history_boundary_valid,
    history_boundary_would_preserve: plan.history_boundary_would_preserve,
    planned_masked_ids: plan.planned.map((row) => row.masked_id),
    blockers: plan.blockers,
  };
}

export function leadProvenanceApplyManifest(input: {
  databaseName: string;
  databaseCategory: "test" | "production";
  mode: string;
  baselineCapturedAt: string;
  baselineSource: string;
  reviewedBoundary: string;
  plans: readonly LeadProvenanceCollectionPlan[];
  revisionPlans: readonly RevisionCollectionPlan[];
  applied: number;
  concurrentMismatch?: boolean;
}) {
  const fieldPlan = input.plans.flatMap((plan) =>
    plan.planned.map((row) => ({
      collection: plan.collection,
      id: row.id,
      set_origin: row.set_origin,
      planned_origin: row.planned_origin,
      set_normalized_job_no: row.set_normalized_job_no,
      set_contact_snapshot: row.set_contact_snapshot,
      set_move_snapshot: row.set_move_snapshot,
    })),
  );
  const checksum = revisionManifestChecksum({
    script_version: LEAD_PROVENANCE_MIGRATION_SCRIPT_VERSION,
    database_name: input.databaseName,
    mode: input.mode,
    baseline_captured_at: input.baselineCapturedAt,
    reviewed_change_history_started_at: input.reviewedBoundary,
    field_plan: fieldPlan,
  });
  return {
    script_version: LEAD_PROVENANCE_MIGRATION_SCRIPT_VERSION,
    database_name: input.databaseName,
    database_category: input.databaseCategory,
    mode: input.mode,
    baseline_captured_at: input.baselineCapturedAt,
    baseline_source: input.baselineSource,
    reviewed_change_history_started_at: input.reviewedBoundary,
    approved_field_plan: fieldPlan,
    revision_planned_ids: input.revisionPlans.flatMap((plan) =>
      plan.planned.map((row) => ({ collection: plan.collection, id: row.id })),
    ),
    applied: input.applied,
    concurrent_mismatch: input.concurrentMismatch ?? false,
    last_change_writes: 0,
    fabricated_entity_changes: 0,
    fabricated_decisions: 0,
    fabricated_commands: 0,
    sheet_sync_requests: 0,
    historical_collections_targeted: [],
    checksum,
  };
}

export function leadProvenanceReviewProjection(input: {
  databaseName: string;
  databaseCategory: "test" | "production";
  mode: string;
  baselineCapturedAt: string;
  baselineSource: string;
  reviewedBoundary: string;
  plans: readonly LeadProvenanceCollectionPlan[];
  revisionPlans: readonly RevisionCollectionPlan[];
  applied: number;
  concurrentMismatch?: boolean;
  applyChecksum: string;
  verify?: { ok: boolean; failures: string[] };
}) {
  return {
    script_version: LEAD_PROVENANCE_MIGRATION_SCRIPT_VERSION,
    database_name: input.databaseName,
    database_category: input.databaseCategory,
    mode: input.mode,
    baseline_captured_at: input.baselineCapturedAt,
    baseline_source: input.baselineSource,
    reviewed_change_history_started_at: input.reviewedBoundary,
    collections: input.plans.map(publicProvenanceCollectionSummary),
    revision_collections: input.revisionPlans.map(publicRevisionCollectionSummary),
    applied: input.applied,
    concurrent_mismatch: input.concurrentMismatch ?? false,
    last_change_writes: 0,
    fabricated_entity_changes: 0,
    fabricated_decisions: 0,
    fabricated_commands: 0,
    sheet_sync_requests: 0,
    historical_collections_targeted: [],
    protected_manifest_checksum: input.applyChecksum,
    verify: input.verify,
  };
}

export function scanLeadProvenanceArtifactForPii(value: unknown): string[] {
  const findings: string[] = [];
  const visit = (node: unknown, trail: string): void => {
    if (node == null) {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((entry, index) => visit(entry, `${trail}[${index}]`));
      return;
    }
    if (typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        if (FORBIDDEN_PII_KEYS.has(key)) {
          findings.push(`${trail}.${key}`);
        }
        visit(child, `${trail}.${key}`);
      }
      return;
    }
    if (typeof node === "string") {
      if (node.includes("@") && node.includes(".")) {
        findings.push(`${trail}:email-like`);
      }
      if (
        !/^[a-fA-F0-9]{16,}$/.test(node) &&
        !/^[a-fA-F0-9]{4}…[a-fA-F0-9]{4}$/.test(node) &&
        !/^\d{4}-\d{2}-\d{2}T/.test(node) &&
        /(?:\d[\s().-]*){10,15}/.test(node)
      ) {
        findings.push(`${trail}:phone-like`);
      }
    }
  };
  visit(value, "$");
  return findings;
}

export function assertLeadProvenanceApplyAllowed(input: {
  plans: readonly LeadProvenanceCollectionPlan[];
  revisionPlans: readonly RevisionCollectionPlan[];
}): void {
  const provenanceBlockers = input.plans.reduce((sum, plan) => sum + plan.blockers.length, 0);
  const revisionBlockers = input.revisionPlans.reduce(
    (sum, plan) => sum + plan.blockers.length,
    0,
  );
  if (provenanceBlockers > 0 || revisionBlockers > 0) {
    throw new Error(
      `Refusing apply: ${provenanceBlockers} provenance blocker(s), ${revisionBlockers} revision blocker(s).`,
    );
  }
}

export function verifyLeadProvenanceMigration(input: {
  rowsByCollection: Record<"form_leads" | "call_leads", readonly LeadProvenanceInventoryRow[]>;
  baselineCapturedAt: string;
}): { ok: boolean; failures: string[] } {
  const revision = verifyLeadRevisionMigration(input);
  const plans = planLeadProvenanceMigration(input);
  const failures = [...revision.failures];
  const baseline = coerceInventoryDate(input.baselineCapturedAt);

  for (const plan of plans) {
    if (plan.planned.length > 0) {
      failures.push(`${plan.collection}: ${plan.planned.length} remaining planned provenance row(s)`);
    }
    if (plan.blockers.length > 0) {
      failures.push(`${plan.collection}: ${plan.blockers.length} provenance blocker(s)`);
    }
    if (plan.contradiction_count > 0) {
      failures.push(`${plan.collection}: ${plan.contradiction_count} origin contradiction(s)`);
    }
    if (plan.snapshot_malformed > 0) {
      failures.push(`${plan.collection}: ${plan.snapshot_malformed} malformed contact snapshot(s)`);
    }
    if (plan.move_snapshot_malformed > 0) {
      failures.push(`${plan.collection}: ${plan.move_snapshot_malformed} malformed move snapshot(s)`);
    }
  }

  for (const collection of LEAD_PROVENANCE_REVISION_COLLECTIONS) {
    for (const row of input.rowsByCollection[collection]) {
      const kind: LeadKind = collection === "form_leads" ? "form" : "call";
      const origin = classifyLeadIngestionOrigin({
        kind,
        ingestion_origin: row.ingestion_origin,
      });
      if (origin.status === "missing") {
        failures.push(`${collection}: missing ingestion_origin`);
      }
      const job = classifyLeadJob(row);
      if (job.contradiction) {
        failures.push(`${collection}: normalized_job_no does not match job_no`);
      }
      const contact = classifyIngestedSnapshot(row.ingested_contact_snapshot);
      if (contact === "legacy_baseline") {
        const capturedAt = coerceInventoryDate(
          (row.ingested_contact_snapshot as { captured_at?: unknown }).captured_at,
        );
        if (!baseline || !capturedAt || capturedAt.getTime() !== baseline.getTime()) {
          failures.push(`${collection}: legacy_baseline contact captured_at does not match reviewed baseline`);
        }
      }
      if (kind === "form") {
        const move = classifyIngestedSnapshot(row.ingested_move_snapshot);
        if (move === "legacy_baseline") {
          const capturedAt = coerceInventoryDate(
            (row.ingested_move_snapshot as { captured_at?: unknown }).captured_at,
          );
          if (!baseline || !capturedAt || capturedAt.getTime() !== baseline.getTime()) {
            failures.push(`${collection}: legacy_baseline move captured_at does not match reviewed baseline`);
          }
        }
      }
    }
  }

  return { ok: failures.length === 0, failures };
}

export function projectLeadProvenanceInventoryRow(document: Record<string, unknown>): LeadProvenanceInventoryRow {
  const ringcentral = document.ringcentral as { ingestion_source?: unknown } | undefined;
  return {
    _id: String(document._id),
    domain_revision: document.domain_revision,
    last_change_id: document.last_change_id,
    last_changed_at: document.last_changed_at,
    change_history_started_at: document.change_history_started_at,
    normalized_job_no: document.normalized_job_no,
    ingestion_origin: document.ingestion_origin,
    job_no: document.job_no,
    ingested_contact_snapshot: document.ingested_contact_snapshot,
    ingested_move_snapshot: document.ingested_move_snapshot,
    first_name: document.first_name,
    last_name: document.last_name,
    name: document.name,
    phone_number: document.phone_number,
    normalized_phone_number: document.normalized_phone_number,
    email: document.email,
    pickup_city: document.pickup_city,
    pickup_zip: document.pickup_zip,
    pickup_state: document.pickup_state,
    delivery_city: document.delivery_city,
    destination_zip: document.destination_zip,
    delivery_state: document.delivery_state,
    move_date: document.move_date,
    move_size: document.move_size,
    duplicate: document.duplicate,
    bad_lead: document.bad_lead,
    source_granularity_id: document.source_granularity_id,
    ref_no: document.ref_no,
    lid: document.lid,
    quoted: document.quoted,
    booked: document.booked,
    cancelled: document.cancelled,
    cpl: document.cpl,
    sheet_sync: document.sheet_sync,
    ringcentral_ingestion_source: ringcentral?.ingestion_source,
  };
}

function plannedRowMatches(
  planned: PlannedProvenanceRow,
  recomputed: PlannedProvenanceRow | undefined,
): boolean {
  if (!recomputed) {
    return false;
  }
  return (
    planned.set_origin === recomputed.set_origin &&
    planned.planned_origin === recomputed.planned_origin &&
    planned.set_normalized_job_no === recomputed.set_normalized_job_no &&
    planned.set_contact_snapshot === recomputed.set_contact_snapshot &&
    planned.set_move_snapshot === recomputed.set_move_snapshot
  );
}

export async function applyLeadProvenancePlan(input: {
  collection: Collection;
  collectionName: "form_leads" | "call_leads";
  planned: readonly PlannedProvenanceRow[];
  baselineCapturedAt: Date;
}): Promise<{ updated: number; concurrent_mismatch: boolean }> {
  let updated = 0;
  const ordered = [...input.planned].sort((left, right) => left.id.localeCompare(right.id));
  for (let offset = 0; offset < ordered.length; offset += PROVENANCE_APPLY_BATCH_SIZE) {
    const batch = ordered.slice(offset, offset + PROVENANCE_APPLY_BATCH_SIZE);
    for (const row of batch) {
      const objectId = new ObjectId(row.id);
      const current = await input.collection.findOne({ _id: objectId });
      if (!current) {
        return { updated, concurrent_mismatch: true };
      }
      const recomputed = planLeadProvenanceCollection({
        collection: input.collectionName,
        rows: [projectLeadProvenanceInventoryRow(current as Record<string, unknown>)],
      }).planned[0];
      if (!plannedRowMatches(row, recomputed)) {
        return { updated, concurrent_mismatch: true };
      }
      if (row.set_origin) {
        const result = await input.collection.updateOne(
          { _id: objectId, ingestion_origin: { $exists: false } },
          { $set: { ingestion_origin: row.planned_origin } },
        );
        if (result.matchedCount === 0) {
          return { updated, concurrent_mismatch: true };
        }
        updated += result.modifiedCount;
      }
      if (row.set_normalized_job_no) {
        const job = classifyLeadJob(
          projectLeadProvenanceInventoryRow(current as Record<string, unknown>),
        );
        if (!job.planned_normalized) {
          return { updated, concurrent_mismatch: true };
        }
        const result = await input.collection.updateOne(
          {
            _id: objectId,
            $or: [
              { normalized_job_no: { $exists: false } },
              { normalized_job_no: null },
            ],
          },
          { $set: { normalized_job_no: job.planned_normalized } },
        );
        if (result.matchedCount === 0) {
          return { updated, concurrent_mismatch: true };
        }
        updated += result.modifiedCount;
      }
      if (row.set_contact_snapshot) {
        const snapshot = buildLegacyBaselineContactSnapshot(
          projectLeadProvenanceInventoryRow(current as Record<string, unknown>),
          input.baselineCapturedAt,
        );
        if (!snapshot) {
          return { updated, concurrent_mismatch: true };
        }
        const result = await input.collection.updateOne(
          { _id: objectId, ingested_contact_snapshot: { $exists: false } },
          { $set: { ingested_contact_snapshot: snapshot } },
        );
        if (result.matchedCount === 0) {
          return { updated, concurrent_mismatch: true };
        }
        updated += result.modifiedCount;
      }
      if (row.set_move_snapshot) {
        const snapshot = buildLegacyBaselineMoveSnapshot(
          projectLeadProvenanceInventoryRow(current as Record<string, unknown>),
          input.baselineCapturedAt,
        );
        if (!snapshot) {
          return { updated, concurrent_mismatch: true };
        }
        const result = await input.collection.updateOne(
          { _id: objectId, ingested_move_snapshot: { $exists: false } },
          { $set: { ingested_move_snapshot: snapshot } },
        );
        if (result.matchedCount === 0) {
          return { updated, concurrent_mismatch: true };
        }
        updated += result.modifiedCount;
      }
    }
  }
  return { updated, concurrent_mismatch: false };
}
