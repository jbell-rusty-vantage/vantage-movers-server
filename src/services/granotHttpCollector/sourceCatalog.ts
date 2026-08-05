import { connectMongo } from "../../db";
import { GranotAutomationSource } from "../../models/GranotAutomationSource";
import type { DurableActor } from "../durableWork";

export const GRANOT_AUTOMATION_SOURCE_LIMIT = 200;

export const DEFAULT_GRANOT_AUTOMATION_SOURCE_LABELS = [
  "10best Inbounds",
  "Best Relocation Forms",
  "BestRelocation Inbounds",
  "Main Site Forms",
  "TBM Forms",
  "TBM Forms Prime",
  "TBM Prime Inbounds",
  "Top10 Forms",
  "Top10 Inbounds",
] as const;

export type GranotAutomationSourceItem = {
  id: string;
  label: string;
  active: boolean;
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

export async function listGranotAutomationSources(): Promise<
  GranotAutomationSourceItem[]
> {
  await connectMongo();
  const rows = await GranotAutomationSource.find({ active: true })
    .sort({ label: 1 })
    .limit(GRANOT_AUTOMATION_SOURCE_LIMIT)
    .lean()
    .exec();
  return rows.map(toItem);
}

export async function createGranotAutomationSource(input: {
  label: string;
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

export async function seedGranotAutomationSources(): Promise<number> {
  await connectMongo();
  const results = await Promise.all(
    DEFAULT_GRANOT_AUTOMATION_SOURCE_LABELS.map((label) =>
      GranotAutomationSource.updateOne(
        { label },
        {
          $setOnInsert: {
            label,
            active: true,
            created_from: "seed",
          },
        },
        { upsert: true, setDefaultsOnInsert: true },
      ).exec(),
    ),
  );
  return results.reduce((count, result) => count + result.upsertedCount, 0);
}

function toItem(row: {
  _id: unknown;
  label: string;
  active: boolean;
  created_from: "seed" | "admin";
  createdAt?: Date | null;
}): GranotAutomationSourceItem {
  return {
    id: String(row._id),
    label: row.label,
    active: row.active,
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
