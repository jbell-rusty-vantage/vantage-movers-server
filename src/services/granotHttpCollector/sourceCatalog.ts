import mongoose from "mongoose";
import { connectMongo } from "../../db";
import { GranotAutomationSource } from "../../models/GranotAutomationSource";
import type { DurableActor } from "../durableWork";

export const GRANOT_AUTOMATION_SOURCE_LIMIT = 200;
export type GranotSourceOperation = "form_leads" | "call_leads";

export const DEFAULT_GRANOT_AUTOMATION_SOURCES = [
  { label: "10best Inbounds", supported_operations: ["call_leads"] },
  { label: "Best Relocation Forms", supported_operations: ["form_leads"] },
  { label: "BestRelocation Inbounds", supported_operations: ["call_leads"] },
  { label: "Main Site Forms", supported_operations: ["form_leads"] },
  { label: "TBM Forms", supported_operations: ["form_leads"] },
  { label: "TBM Forms Prime", supported_operations: ["form_leads"] },
  { label: "TBM Prime Inbounds", supported_operations: ["call_leads"] },
  { label: "Top10 Forms", supported_operations: ["form_leads"] },
  { label: "Top10 Inbounds", supported_operations: ["call_leads"] },
] as const;
export const DEFAULT_GRANOT_AUTOMATION_SOURCE_LABELS =
  DEFAULT_GRANOT_AUTOMATION_SOURCES.map((source) => source.label);

export type GranotAutomationSourceItem = {
  id: string;
  label: string;
  active: boolean;
  supported_operations: GranotSourceOperation[];
  created_from: "seed" | "admin";
  created_at?: Date;
};

export class GranotAutomationSourceConflict extends Error {
  readonly code = "GRANOT_SOURCE_ALREADY_EXISTS";

  constructor() {
    super("That exact Granot automation source already exists.");
    this.name = "GranotAutomationSourceConflict";
  }
}

export class GranotAutomationSourceLimitReached extends Error {
  readonly code = "GRANOT_SOURCE_CATALOG_FULL";

  constructor() {
    super(`The Granot automation source catalog is limited to ${GRANOT_AUTOMATION_SOURCE_LIMIT} labels.`);
    this.name = "GranotAutomationSourceLimitReached";
  }
}

export class GranotAutomationSourceValidationError extends Error {
  readonly code = "INVALID_GRANOT_SOURCES";

  constructor(
    message: string,
    readonly issues: Array<{ path: string[]; message: string }>,
  ) {
    super(message);
    this.name = "GranotAutomationSourceValidationError";
  }
}

export async function listGranotAutomationSources(
  operation?: GranotSourceOperation,
): Promise<GranotAutomationSourceItem[]> {
  await connectMongo();
  const rows = await GranotAutomationSource.find({
    active: true,
    supported_operations: operation
      ? operation
      : { $in: ["form_leads", "call_leads"] },
  })
    .sort({ label: 1 })
    .limit(GRANOT_AUTOMATION_SOURCE_LIMIT)
    .lean()
    .exec();
  return rows.map(toItem);
}

export async function createGranotAutomationSource(input: {
  label: string;
  supportedOperations: GranotSourceOperation[];
  createdBy: DurableActor;
}): Promise<GranotAutomationSourceItem> {
  await connectMongo();
  const label = input.label.trim();
  if (
    (await GranotAutomationSource.countDocuments({}).exec()) >=
    GRANOT_AUTOMATION_SOURCE_LIMIT
  ) {
    throw new GranotAutomationSourceLimitReached();
  }
  try {
    const row = await GranotAutomationSource.create({
      label,
      active: true,
      supported_operations: input.supportedOperations,
      created_from: "admin",
      created_by: input.createdBy,
    });
    return toItem(row.toObject());
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new GranotAutomationSourceConflict();
    }
    throw error;
  }
}

export type GranotSourceSeedResult = {
  inserted: number;
  updated: number;
  unchanged: number;
  missing: number;
};

export async function seedGranotAutomationSources(): Promise<GranotSourceSeedResult> {
  await connectMongo();
  const results = await Promise.all(
    DEFAULT_GRANOT_AUTOMATION_SOURCES.map((source) =>
      GranotAutomationSource.updateOne(
        { label: source.label },
        {
          $set: {
            supported_operations: [...source.supported_operations],
          },
          $setOnInsert: {
            label: source.label,
            active: true,
            created_from: "seed",
          },
        },
        {
          upsert: true,
          setDefaultsOnInsert: true,
          timestamps: false,
        },
      ).exec(),
    ),
  );
  const present = await GranotAutomationSource.find({
    label: { $in: DEFAULT_GRANOT_AUTOMATION_SOURCE_LABELS },
  })
    .select({ label: 1, supported_operations: 1 })
    .lean()
    .exec();
  const expectedByLabel = new Map<string, string[]>(
    DEFAULT_GRANOT_AUTOMATION_SOURCES.map((source) => [
      source.label,
      [...source.supported_operations].sort(),
    ]),
  );
  const misclassified = present.filter((source) => {
    const expected = expectedByLabel.get(source.label);
    const actual = Array.isArray(source.supported_operations)
      ? [...source.supported_operations].sort()
      : [];
    return (
      !expected ||
      expected.length !== actual.length ||
      expected.some((operation, index) => operation !== actual[index])
    );
  });
  const result = {
    inserted: results.reduce((count, item) => count + item.upsertedCount, 0),
    updated: results.reduce((count, item) => count + item.modifiedCount, 0),
    unchanged: results.reduce(
      (count, item) => count + Math.max(0, item.matchedCount - item.modifiedCount),
      0,
    ),
    missing:
      DEFAULT_GRANOT_AUTOMATION_SOURCE_LABELS.length -
      new Set(present.map((item) => item.label)).size,
  };
  if (result.missing > 0) {
    throw new GranotAutomationSourceValidationError(
      "One or more required seeded Granot source labels are missing after backfill.",
      [{ path: ["sources"], message: `${result.missing} required labels are missing` }],
    );
  }
  if (misclassified.length > 0) {
    throw new GranotAutomationSourceValidationError(
      "One or more seeded Granot sources have incorrect workflow compatibility.",
      [{
        path: ["supported_operations"],
        message: `${misclassified.length} seeded labels are misclassified`,
      }],
    );
  }
  return result;
}

export async function resolveGranotAutomationSources(input: {
  sourceIds: string[];
  operations: GranotSourceOperation[];
}): Promise<Map<GranotSourceOperation, GranotAutomationSourceItem[]>> {
  await connectMongo();
  const sourceIds = canonicalizeGranotSourceIds(input.sourceIds);
  const rows = await GranotAutomationSource.find({
    _id: { $in: sourceIds },
  })
    .lean()
    .exec();
  const byId = new Map(rows.map((row) => [String(row._id), row]));
  const missing = sourceIds.filter((id) => !byId.has(id));
  const inactive = rows.filter((row) => !row.active).map((row) => String(row._id));
  const unclassified = rows
    .filter((row) => !validSupportedOperations(row.supported_operations))
    .map((row) => String(row._id));
  if (missing.length || inactive.length || unclassified.length) {
    throw new GranotAutomationSourceValidationError(
      "Selected Granot sources are unavailable.",
      [
        ...(missing.length
          ? [{ path: ["source_ids"], message: "One or more source IDs do not exist" }]
          : []),
        ...(inactive.length
          ? [{ path: ["source_ids"], message: "Inactive sources cannot be selected" }]
          : []),
        ...(unclassified.length
          ? [{ path: ["source_ids"], message: "Unclassified sources cannot be selected" }]
          : []),
      ],
    );
  }

  const ordered = sourceIds.map((id) => toItem(byId.get(id)!));
  return partitionGranotAutomationSources(ordered, input.operations);
}

export function canonicalizeGranotSourceIds(sourceIds: string[]): string[] {
  if (sourceIds.some((id) => !mongoose.isValidObjectId(id))) {
    throw new GranotAutomationSourceValidationError(
      "Selected Granot source IDs are invalid.",
      [{ path: ["source_ids"], message: "One or more source IDs are malformed" }],
    );
  }
  const canonical = sourceIds.map((id) =>
    String(new mongoose.Types.ObjectId(id)),
  );
  if (new Set(canonical).size !== canonical.length) {
    throw new GranotAutomationSourceValidationError(
      "Selected Granot source IDs are invalid.",
      [{ path: ["source_ids"], message: "Duplicate source IDs are not allowed" }],
    );
  }
  return canonical;
}

export function partitionGranotAutomationSources(
  sources: GranotAutomationSourceItem[],
  operations: GranotSourceOperation[],
): Map<GranotSourceOperation, GranotAutomationSourceItem[]> {
  const partitions = new Map<GranotSourceOperation, GranotAutomationSourceItem[]>();
  for (const operation of operations) {
    const compatible = sources.filter((source) =>
      source.supported_operations.includes(operation),
    );
    if (compatible.length === 0) {
      throw new GranotAutomationSourceValidationError(
        `No selected Granot sources support ${operation}.`,
        [{
          path: ["source_ids"],
          message: `Select at least one source that supports ${operation}`,
        }],
      );
    }
    partitions.set(operation, compatible);
  }
  return partitions;
}

function validSupportedOperations(values: unknown): values is GranotSourceOperation[] {
  return (
    Array.isArray(values) &&
    values.length >= 1 &&
    values.length <= 2 &&
    new Set(values).size === values.length &&
    values.every(
      (value) => value === "form_leads" || value === "call_leads",
    )
  );
}

function toItem(row: {
  _id: unknown;
  label: string;
  active: boolean;
  supported_operations?: string[] | null;
  created_from: "seed" | "admin";
  createdAt?: Date | null;
}): GranotAutomationSourceItem {
  return {
    id: String(row._id),
    label: row.label,
    active: row.active,
    supported_operations: (row.supported_operations ?? []).filter(
      (value): value is GranotSourceOperation =>
        value === "form_leads" || value === "call_leads",
    ),
    created_from: row.created_from,
    ...(row.createdAt ? { created_at: row.createdAt } : {}),
  };
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}
