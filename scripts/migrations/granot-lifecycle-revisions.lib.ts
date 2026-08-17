import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ObjectId, type Collection } from "mongodb";
import { isNonnegativeIntegerRevision } from "../../src/models/granotLifecycleSchemas";
import {
  granotLifecycleOutputDirectory,
  maskReceiptId,
} from "./granot-lifecycle-migration.lib";
import {
  HISTORICAL_DATABASE,
  PRODUCTION_DATABASE,
  TEST_DATABASE,
} from "./operations-registry-migration.lib";

export const REVISION_MIGRATION_SHARED_VERSION = "granot-lifecycle-revisions/1";
export const REVIEWED_BOUNDARY_FILENAME = "reviewed-boundary.json";
export const REVISION_APPLY_BATCH_SIZE = 100;

export const LEAD_REVISION_COLLECTIONS = ["form_leads", "call_leads"] as const;
export const BOOKING_REVISION_COLLECTIONS = ["booked_leads", "cancelled_leads"] as const;
export const ALL_REVISION_COLLECTIONS = [
  ...LEAD_REVISION_COLLECTIONS,
  ...BOOKING_REVISION_COLLECTIONS,
] as const;
export const HISTORICAL_REVISION_TARGET_COLLECTIONS = [] as const;

export type RevisionInventoryRow = {
  _id: string;
  domain_revision?: unknown;
  last_change_id?: unknown;
  last_changed_at?: unknown;
  change_history_started_at?: unknown;
  normalized_job_no?: unknown;
};

export type RevisionFieldClass = "missing" | "valid" | "invalid";
export type LastChangeClass = "absent" | "paired" | "one_sided";

export type PlannedRevisionRow = {
  id: string;
  masked_id: string;
  set_revision: boolean;
  set_boundary: boolean;
};

export type RevisionBlocker = {
  masked_id: string;
  reasons: string[];
};

export type RevisionCollectionPlan = {
  collection: string;
  total: number;
  missing_revision: number;
  valid_revision: number;
  invalid_revision: number;
  missing_boundary: number;
  valid_boundary: number;
  invalid_boundary: number;
  one_sided_last_change: number;
  paired_last_change: number;
  planned: PlannedRevisionRow[];
  already_current: number;
  blockers: RevisionBlocker[];
};

export type ReviewedBoundaryRecord = {
  reviewed_change_history_started_at: string;
  recorded_at: string;
};

export type BookingJobCollision = {
  key_fingerprint: string;
  count: number;
  masked_ids: string[];
};

export type BookingJobInventory = {
  missing_normalized_job: number;
  invalid_normalized_job: number;
  collision_groups: BookingJobCollision[];
  unique_index_ready: boolean;
  missing_masked_ids: string[];
  invalid_masked_ids: string[];
};

export function reviewedBoundaryDirectory(): string {
  return granotLifecycleOutputDirectory("granot-lifecycle-revisions");
}

export function granotLifecycleDatabaseCategory(
  databaseName: string,
): "test" | "production" {
  if (databaseName === TEST_DATABASE) return "test";
  if (databaseName === PRODUCTION_DATABASE) return "production";
  throw new Error(`Unknown lifecycle database category for "${databaseName}".`);
}

export function readReviewedBoundaryArg(
  args: readonly string[],
): string | undefined {
  const flag = args.find((arg) => arg.startsWith("--reviewed-boundary="));
  return flag?.slice("--reviewed-boundary=".length).trim() || undefined;
}

export function parseReviewedBoundaryIso(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    throw new Error(
      `Reviewed boundary must be an explicit UTC ISO timestamp, received "${value}".`,
    );
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Reviewed boundary is not a canonical ISO timestamp: "${value}".`);
  }
  return parsed;
}

export async function loadPersistedReviewedBoundary(
  directory = reviewedBoundaryDirectory(),
): Promise<ReviewedBoundaryRecord | undefined> {
  try {
    const raw = await readFile(path.join(directory, REVIEWED_BOUNDARY_FILENAME), "utf8");
    const parsed = JSON.parse(raw) as ReviewedBoundaryRecord;
    parseReviewedBoundaryIso(parsed.reviewed_change_history_started_at);
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export async function persistReviewedBoundary(
  iso: string,
  directory = reviewedBoundaryDirectory(),
): Promise<ReviewedBoundaryRecord> {
  parseReviewedBoundaryIso(iso);
  const record: ReviewedBoundaryRecord = {
    reviewed_change_history_started_at: iso,
    recorded_at: new Date().toISOString(),
  };
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, REVIEWED_BOUNDARY_FILENAME),
    `${JSON.stringify(record, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  return record;
}

export async function resolveReviewedBoundary(input: {
  requested?: string;
  allowGenerate?: boolean;
  now?: Date;
  directory?: string;
}): Promise<{
  record: ReviewedBoundaryRecord;
  source: "requested" | "persisted" | "generated";
}> {
  const directory = input.directory ?? reviewedBoundaryDirectory();
  const existing = await loadPersistedReviewedBoundary(directory);
  if (input.requested) {
    const requested = parseReviewedBoundaryIso(input.requested).toISOString();
    if (
      existing &&
      existing.reviewed_change_history_started_at !== requested
    ) {
      throw new Error(
        "Contradictory reviewed boundary: requested ISO does not match the persisted common boundary.",
      );
    }
    if (existing) {
      return { record: existing, source: "persisted" };
    }
    return {
      record: await persistReviewedBoundary(requested, directory),
      source: "requested",
    };
  }
  if (existing) {
    return { record: existing, source: "persisted" };
  }
  if (!input.allowGenerate) {
    throw new Error(
      "Reviewed history boundary is missing. Run report first so apply/verify can reuse the recorded ISO.",
    );
  }
  const generated = (input.now ?? new Date()).toISOString();
  return {
    record: await persistReviewedBoundary(generated, directory),
    source: "generated",
  };
}

export function classifyRevision(value: unknown): RevisionFieldClass {
  if (value === undefined || value === null) {
    return "missing";
  }
  return isNonnegativeIntegerRevision(value) ? "valid" : "invalid";
}

export function coerceInventoryDate(value: unknown): Date | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  return undefined;
}

export function classifyBoundary(value: unknown): RevisionFieldClass {
  if (value === undefined || value === null || value === "") {
    return "missing";
  }
  if (Array.isArray(value) || (typeof value === "object" && !(value instanceof Date))) {
    return "invalid";
  }
  return coerceInventoryDate(value) ? "valid" : "invalid";
}

export function classifyLastChange(
  lastChangeId: unknown,
  lastChangedAt: unknown,
): LastChangeClass {
  const hasId = lastChangeId != null && lastChangeId !== "";
  const hasAt = lastChangedAt != null && lastChangedAt !== "";
  if (!hasId && !hasAt) return "absent";
  if (hasId && hasAt) return "paired";
  return "one_sided";
}

export function planRevisionBackfill(input: {
  collection: string;
  rows: readonly RevisionInventoryRow[];
}): RevisionCollectionPlan {
  if (
    !(ALL_REVISION_COLLECTIONS as readonly string[]).includes(input.collection)
  ) {
    throw new Error(`Refusing unknown revision collection "${input.collection}".`);
  }
  if ((HISTORICAL_REVISION_TARGET_COLLECTIONS as readonly string[]).includes(input.collection)) {
    throw new Error(`Refusing historical revision target "${input.collection}".`);
  }

  const planned: PlannedRevisionRow[] = [];
  const blockers: RevisionBlocker[] = [];
  let missingRevision = 0;
  let validRevision = 0;
  let invalidRevision = 0;
  let missingBoundary = 0;
  let validBoundary = 0;
  let invalidBoundary = 0;
  let oneSided = 0;
  let paired = 0;
  let alreadyCurrent = 0;

  const sorted = [...input.rows].sort((left, right) => left._id.localeCompare(right._id));
  for (const row of sorted) {
    const revisionClass = classifyRevision(row.domain_revision);
    const boundaryClass = classifyBoundary(row.change_history_started_at);
    const lastChangeClass = classifyLastChange(row.last_change_id, row.last_changed_at);
    if (revisionClass === "missing") missingRevision += 1;
    if (revisionClass === "valid") validRevision += 1;
    if (revisionClass === "invalid") invalidRevision += 1;
    if (boundaryClass === "missing") missingBoundary += 1;
    if (boundaryClass === "valid") validBoundary += 1;
    if (boundaryClass === "invalid") invalidBoundary += 1;
    if (lastChangeClass === "one_sided") oneSided += 1;
    if (lastChangeClass === "paired") paired += 1;

    const reasons: string[] = [];
    if (revisionClass === "invalid") reasons.push("invalid_revision");
    if (boundaryClass === "invalid") reasons.push("invalid_boundary");
    if (lastChangeClass === "one_sided") reasons.push("one_sided_last_change");
    if (reasons.length > 0) {
      blockers.push({ masked_id: maskReceiptId(row._id), reasons });
      continue;
    }

    const setRevision = revisionClass === "missing";
    const setBoundary = boundaryClass === "missing";
    if (!setRevision && !setBoundary) {
      alreadyCurrent += 1;
      continue;
    }
    planned.push({
      id: row._id,
      masked_id: maskReceiptId(row._id),
      set_revision: setRevision,
      set_boundary: setBoundary,
    });
  }

  return {
    collection: input.collection,
    total: input.rows.length,
    missing_revision: missingRevision,
    valid_revision: validRevision,
    invalid_revision: invalidRevision,
    missing_boundary: missingBoundary,
    valid_boundary: validBoundary,
    invalid_boundary: invalidBoundary,
    one_sided_last_change: oneSided,
    paired_last_change: paired,
    planned,
    already_current: alreadyCurrent,
    blockers,
  };
}

export function verifyRevisionInventory(input: {
  collection: string;
  rows: readonly RevisionInventoryRow[];
}): { ok: boolean; failures: string[] } {
  const plan = planRevisionBackfill(input);
  const failures: string[] = [];
  if (plan.missing_revision > 0) {
    failures.push(`${input.collection}: ${plan.missing_revision} missing domain_revision`);
  }
  if (plan.invalid_revision > 0) {
    failures.push(`${input.collection}: ${plan.invalid_revision} invalid domain_revision`);
  }
  if (plan.missing_boundary > 0) {
    failures.push(
      `${input.collection}: ${plan.missing_boundary} unexplained missing change_history_started_at`,
    );
  }
  if (plan.invalid_boundary > 0) {
    failures.push(`${input.collection}: ${plan.invalid_boundary} invalid change_history_started_at`);
  }
  if (plan.one_sided_last_change > 0) {
    failures.push(`${input.collection}: ${plan.one_sided_last_change} one-sided last_change metadata`);
  }
  return { ok: failures.length === 0, failures };
}

export function fingerprintNormalizedJob(value: string): string {
  return createHash("sha256").update(`normalized_job_no:${value}`).digest("hex").slice(0, 16);
}

export function inventoryBookingJobs(
  rows: readonly Pick<RevisionInventoryRow, "_id" | "normalized_job_no">[],
): BookingJobInventory {
  const groups = new Map<string, { count: number; masked_ids: string[] }>();
  let missing = 0;
  let invalid = 0;
  const missingMasked: string[] = [];
  const invalidMasked: string[] = [];

  for (const row of rows) {
    const value = row.normalized_job_no;
    if (value == null || value === "") {
      missing += 1;
      missingMasked.push(maskReceiptId(row._id));
      continue;
    }
    if (typeof value !== "string") {
      invalid += 1;
      invalidMasked.push(maskReceiptId(row._id));
      continue;
    }
    const fingerprint = fingerprintNormalizedJob(value);
    const current = groups.get(fingerprint) ?? { count: 0, masked_ids: [] };
    current.count += 1;
    current.masked_ids.push(maskReceiptId(row._id));
    groups.set(fingerprint, current);
  }

  const collision_groups = [...groups.entries()]
    .filter(([, group]) => group.count > 1)
    .map(([key_fingerprint, group]) => ({
      key_fingerprint,
      count: group.count,
      masked_ids: group.masked_ids.sort(),
    }))
    .sort((left, right) => left.key_fingerprint.localeCompare(right.key_fingerprint));

  return {
    missing_normalized_job: missing,
    invalid_normalized_job: invalid,
    collision_groups,
    unique_index_ready: collision_groups.length === 0,
    missing_masked_ids: missingMasked.sort(),
    invalid_masked_ids: invalidMasked.sort(),
  };
}

export function revisionManifestChecksum(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function publicRevisionCollectionSummary(plan: RevisionCollectionPlan) {
  return {
    collection: plan.collection,
    total: plan.total,
    missing_revision: plan.missing_revision,
    valid_revision: plan.valid_revision,
    invalid_revision: plan.invalid_revision,
    missing_boundary: plan.missing_boundary,
    valid_boundary: plan.valid_boundary,
    invalid_boundary: plan.invalid_boundary,
    one_sided_last_change: plan.one_sided_last_change,
    paired_last_change: plan.paired_last_change,
    planned_count: plan.planned.length,
    already_current: plan.already_current,
    blocker_count: plan.blockers.length,
    blockers: plan.blockers,
    planned_masked_ids: plan.planned.map((row) => row.masked_id),
    last_change_writes: 0,
    fabricated_entity_changes: 0,
    fabricated_decisions: 0,
    fabricated_commands: 0,
    sheet_sync_requests: 0,
  };
}

export function assertRevisionApplyAllowed(input: {
  plans: readonly RevisionCollectionPlan[];
  bookingJobs?: BookingJobInventory;
}): void {
  const blockers = input.plans.reduce((sum, plan) => sum + plan.blockers.length, 0);
  if (blockers > 0) {
    throw new Error(`Refusing apply: ${blockers} revision/boundary blocker(s).`);
  }
  if (input.bookingJobs && !input.bookingJobs.unique_index_ready) {
    throw new Error(
      `Refusing apply: ${input.bookingJobs.collision_groups.length} Booking normalized-Job collision group(s).`,
    );
  }
}

export function plannedRevisionUpdateFields(input: {
  set_revision: boolean;
  set_boundary: boolean;
  reviewedBoundary: Date;
}): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  if (input.set_revision) {
    set.domain_revision = 0;
  }
  if (input.set_boundary) {
    set.change_history_started_at = input.reviewedBoundary;
  }
  if ("last_change_id" in set || "last_changed_at" in set) {
    throw new Error("Revision apply must not write last_change metadata.");
  }
  return set;
}

export async function applyRevisionPlan(input: {
  collection: Collection;
  planned: readonly PlannedRevisionRow[];
  reviewedBoundary: Date;
}): Promise<{ updated: number; concurrent_mismatch: boolean }> {
  let updated = 0;
  const ordered = [...input.planned].sort((left, right) => left.id.localeCompare(right.id));
  for (let offset = 0; offset < ordered.length; offset += REVISION_APPLY_BATCH_SIZE) {
    const batch = ordered.slice(offset, offset + REVISION_APPLY_BATCH_SIZE);
    for (const row of batch) {
      const objectId = new ObjectId(row.id);
      if (row.set_revision) {
        const result = await input.collection.updateOne(
          { _id: objectId, domain_revision: { $exists: false } },
          { $set: { domain_revision: 0 } },
        );
        if (result.matchedCount === 0) {
          return { updated, concurrent_mismatch: true };
        }
        updated += result.modifiedCount;
      }
      if (row.set_boundary) {
        const result = await input.collection.updateOne(
          { _id: objectId, change_history_started_at: { $exists: false } },
          { $set: { change_history_started_at: input.reviewedBoundary } },
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

export function projectRevisionInventoryRow(document: {
  _id: unknown;
  domain_revision?: unknown;
  last_change_id?: unknown;
  last_changed_at?: unknown;
  change_history_started_at?: unknown;
  normalized_job_no?: unknown;
}): RevisionInventoryRow {
  return {
    _id: String(document._id),
    domain_revision: document.domain_revision,
    last_change_id: document.last_change_id,
    last_changed_at: document.last_changed_at,
    change_history_started_at: document.change_history_started_at,
    normalized_job_no: document.normalized_job_no,
  };
}

export function assertNotHistoricalDatabase(databaseName: string): void {
  if (databaseName === HISTORICAL_DATABASE) {
    throw new Error(`Refusing revision migration against historical database ${HISTORICAL_DATABASE}.`);
  }
}
