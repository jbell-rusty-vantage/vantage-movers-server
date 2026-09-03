import { normalizeGranotCarrierCode } from "../../config/domain/granotCarrierCodes";
import { MovingCarrier } from "../../models/MovingCarrier";
import { normalizeCsvCell, normalizeCsvHeader, parseCsvRecords } from "../../utils/csvParse";
import type {
  ListMovingCarriersQuery,
  MovingCarrierCreateInput,
  MovingCarrierImportInput,
  MovingCarrierUpdateInput,
} from "../../validation/v1.validation";
import { V1ServiceError } from "../v1ServiceError";

export type MovingCarrierItem = {
  id: string;
  _id: string;
  name: string;
  normalized_name: string;
  dot_number: string;
  mc_number: string;
  granot_carrier_code?: string;
  active: boolean;
  created_from: string;
  createdAt?: Date;
  updatedAt?: Date;
};

export type ListMovingCarriersResult = {
  items: MovingCarrierItem[];
  page: number;
  limit: number;
  total: number;
  has_next_page: boolean;
};

export type MovingCarrierImportResult = {
  mode: MovingCarrierImportInput["mode"];
  total_rows: number;
  valid_rows: number;
  created: number;
  updated: number;
  deactivated: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
  items: MovingCarrierItem[];
};

type ParsedCarrierRow = {
  row: number;
  name: string;
  normalized_name: string;
  dot_number: string;
  mc_number: string;
  granot_carrier_code?: string;
};

export async function listMovingCarriers(
  query: ListMovingCarriersQuery,
): Promise<ListMovingCarriersResult> {
  const filter = buildMovingCarrierFilter(query);
  const skip = (query.page - 1) * query.limit;

  const [docs, total] = await Promise.all([
    MovingCarrier.find(filter)
      .sort({ name: 1, dot_number: 1, mc_number: 1 })
      .skip(skip)
      .limit(query.limit)
      .lean()
      .exec(),
    MovingCarrier.countDocuments(filter).exec(),
  ]);

  return {
    items: docs.map(toMovingCarrierItem),
    page: query.page,
    limit: query.limit,
    total,
    has_next_page: skip + docs.length < total,
  };
}

export async function createMovingCarrier(
  input: MovingCarrierCreateInput,
): Promise<MovingCarrierItem> {
  const payload = toCarrierPayload(input);
  try {
    const doc = await MovingCarrier.create(payload);
    return toMovingCarrierItem(doc.toObject({ virtuals: true }));
  } catch (error) {
    if (isMongoDuplicateKeyError(error)) {
      throw duplicateCarrierError(error, payload);
    }
    throw error;
  }
}

export async function updateMovingCarrier(
  id: string,
  input: MovingCarrierUpdateInput,
): Promise<MovingCarrierItem> {
  const set: Record<string, unknown> = {};
  const unset: Record<string, 1> = {};

  if (input.name !== undefined) {
    const name = canonicalCarrierName(input.name);
    set.name = name;
    set.normalized_name = normalizeCarrierName(name);
  }
  if (input.dot_number !== undefined) {
    set.dot_number = normalizeCarrierNumber(input.dot_number);
  }
  if (input.mc_number !== undefined) {
    set.mc_number = normalizeCarrierNumber(input.mc_number);
  }
  if (input.active !== undefined) {
    set.active = input.active;
  }
  if (input.created_from !== undefined) {
    set.created_from = input.created_from.trim();
  }
  assignGranotCarrierCodeWrite(input.granot_carrier_code, set, unset);

  try {
    const doc = await MovingCarrier.findByIdAndUpdate(
      id,
      {
        ...(Object.keys(set).length > 0 ? { $set: set } : {}),
        ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
      },
      { returnDocument: "after", runValidators: true },
    ).orFail();
    return toMovingCarrierItem(doc.toObject({ virtuals: true }));
  } catch (error) {
    if (isMongoDuplicateKeyError(error)) {
      throw duplicateCarrierError(error);
    }
    if (error instanceof Error && error.name === "DocumentNotFoundError") {
      throw new V1ServiceError("Moving carrier not found", 404);
    }
    throw error;
  }
}

export async function importMovingCarriersFromCsv(
  input: MovingCarrierImportInput,
): Promise<MovingCarrierImportResult> {
  const parsed = parseMovingCarrierCsv(input.csv_text);
  const importedItems: MovingCarrierItem[] = [];
  let created = 0;
  let updated = 0;

  for (const row of parsed.rows) {
    const existing = await MovingCarrier.findOne({
      dot_number: row.dot_number,
      mc_number: row.mc_number,
    }).exec();

    if (!existing) {
      try {
        const doc = await MovingCarrier.create({
          name: row.name,
          normalized_name: row.normalized_name,
          dot_number: row.dot_number,
          mc_number: row.mc_number,
          ...(row.granot_carrier_code ? { granot_carrier_code: row.granot_carrier_code } : {}),
          active: true,
          created_from: "csv_import",
        });
        created += 1;
        importedItems.push(toMovingCarrierItem(doc.toObject({ virtuals: true })));
      } catch (error) {
        if (isMongoDuplicateKeyError(error)) {
          throw duplicateCarrierError(error, {
            dot_number: row.dot_number,
            mc_number: row.mc_number,
          });
        }
        throw error;
      }
      continue;
    }

    const updates: Record<string, unknown> = {};
    if (existing.name !== row.name) updates.name = row.name;
    if (existing.normalized_name !== row.normalized_name) {
      updates.normalized_name = row.normalized_name;
    }
    if (existing.active !== true) updates.active = true;
    if (
      row.granot_carrier_code &&
      existing.granot_carrier_code !== row.granot_carrier_code
    ) {
      updates.granot_carrier_code = row.granot_carrier_code;
    }

    if (Object.keys(updates).length > 0) {
      existing.set(updates);
      try {
        await existing.save();
      } catch (error) {
        if (isMongoDuplicateKeyError(error)) {
          throw duplicateCarrierError(error);
        }
        throw error;
      }
      updated += 1;
    }
    importedItems.push(toMovingCarrierItem(existing.toObject({ virtuals: true })));
  }

  let deactivated = 0;
  if (input.mode === "replace" && parsed.identityKeys.size > 0) {
    const activeDocs = await MovingCarrier.find({ active: true }).exec();
    for (const carrier of activeDocs) {
      const key = identityKey(carrier.dot_number, carrier.mc_number);
      if (parsed.identityKeys.has(key)) {
        continue;
      }
      carrier.active = false;
      await carrier.save();
      deactivated += 1;
    }
  }

  return {
    mode: input.mode,
    total_rows: parsed.totalRows,
    valid_rows: parsed.rows.length,
    created,
    updated,
    deactivated,
    skipped: parsed.skipped,
    errors: parsed.errors,
    items: importedItems,
  };
}

export function parseMovingCarrierCsv(csvText: string): {
  totalRows: number;
  rows: ParsedCarrierRow[];
  skipped: number;
  errors: Array<{ row: number; message: string }>;
  identityKeys: Set<string>;
} {
  const records = parseCsvRecords(csvText);
  if (records.length === 0) {
    throw new V1ServiceError("CSV is empty", 400);
  }

  const headers = records[0].map(normalizeCsvHeader);
  const rows: ParsedCarrierRow[] = [];
  const errors: Array<{ row: number; message: string }> = [];
  const identityKeys = new Set<string>();
  const granotCodes = new Set<string>();
  let skipped = 0;

  for (let index = 1; index < records.length; index += 1) {
    const record = cellsToRecord(headers, records[index]);
    const rowNumber = index + 1;
    const name = canonicalCarrierName(record.carrier_name ?? record.name ?? "");
    const dot_number = normalizeCarrierNumber(record.dot ?? record.dot_number ?? "");
    const mc_number = normalizeCarrierNumber(record.mc ?? record.mc_number ?? "");
    const granot_carrier_code = normalizeOptionalGranotCarrierCode(
      record.granot_carrier_code ?? record.granot_code ?? record.agent ?? "",
    );

    if (!name || !dot_number || !mc_number) {
      skipped += 1;
      errors.push({
        row: rowNumber,
        message: "Carrier Name, DOT, and MC are required",
      });
      continue;
    }

    const key = identityKey(dot_number, mc_number);
    if (identityKeys.has(key)) {
      skipped += 1;
      errors.push({
        row: rowNumber,
        message: `Duplicate carrier identity in CSV: DOT ${dot_number}, MC ${mc_number}`,
      });
      continue;
    }

    if (granot_carrier_code && granotCodes.has(granot_carrier_code)) {
      skipped += 1;
      errors.push({
        row: rowNumber,
        message: `Duplicate Granot Carrier Code in CSV: ${granot_carrier_code}`,
      });
      continue;
    }

    identityKeys.add(key);
    if (granot_carrier_code) {
      granotCodes.add(granot_carrier_code);
    }
    rows.push({
      row: rowNumber,
      name,
      normalized_name: normalizeCarrierName(name),
      dot_number,
      mc_number,
      ...(granot_carrier_code ? { granot_carrier_code } : {}),
    });
  }

  return {
    totalRows: Math.max(records.length - 1, 0),
    rows,
    skipped,
    errors,
    identityKeys,
  };
}

export function normalizeCarrierName(name: string): string {
  return canonicalCarrierName(name).toLowerCase();
}

function buildMovingCarrierFilter(query: ListMovingCarriersQuery): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (query.include_inactive !== true) {
    filter.active = query.active;
  }

  if (query.q) {
    const expression = new RegExp(escapeRegex(query.q), "i");
    filter.$or = [
      { name: expression },
      { normalized_name: expression },
      { dot_number: expression },
      { mc_number: expression },
      { granot_carrier_code: expression },
    ];
  }

  return filter;
}

function toCarrierPayload(input: MovingCarrierCreateInput): Record<string, unknown> {
  const name = canonicalCarrierName(input.name);
  return {
    name,
    normalized_name: normalizeCarrierName(name),
    dot_number: normalizeCarrierNumber(input.dot_number),
    mc_number: normalizeCarrierNumber(input.mc_number),
    ...optionalGranotCarrierCodePayload(input.granot_carrier_code),
    active: input.active ?? true,
    created_from: input.created_from?.trim() || "admin",
  };
}

function canonicalCarrierName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

function normalizeCarrierNumber(value: string): string {
  return value.trim().replace(/\s+/g, "");
}

function identityKey(dotNumber: string, mcNumber: string): string {
  return `${dotNumber}::${mcNumber}`;
}

function cellsToRecord(headers: string[], cells: string[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (let index = 0; index < headers.length; index += 1) {
    const header = headers[index];
    if (!header) {
      continue;
    }
    record[header] = normalizeCsvCell(cells[index] ?? "");
  }
  return record;
}

function toMovingCarrierItem(doc: Record<string, unknown>): MovingCarrierItem {
  const id = String(doc._id ?? doc.id ?? "");
  return {
    id,
    _id: id,
    name: String(doc.name ?? ""),
    normalized_name: String(doc.normalized_name ?? ""),
    dot_number: String(doc.dot_number ?? ""),
    mc_number: String(doc.mc_number ?? ""),
    ...(typeof doc.granot_carrier_code === "string" && doc.granot_carrier_code
      ? { granot_carrier_code: doc.granot_carrier_code }
      : {}),
    active: doc.active === true,
    created_from: String(doc.created_from ?? ""),
    ...(doc.createdAt instanceof Date ? { createdAt: doc.createdAt } : {}),
    ...(doc.updatedAt instanceof Date ? { updatedAt: doc.updatedAt } : {}),
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isMongoDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

function duplicateCarrierError(
  error: unknown,
  payload?: Record<string, unknown>,
): V1ServiceError {
  if (duplicateKeyIncludes(error, "granot_carrier_code")) {
    return new V1ServiceError("Granot Carrier Code already in use", 409);
  }
  if (payload?.dot_number && payload.mc_number) {
    return new V1ServiceError(
      `Moving carrier already exists for DOT ${payload.dot_number} and MC ${payload.mc_number}`,
      409,
    );
  }
  return new V1ServiceError("Moving carrier already exists for that DOT and MC", 409);
}

function duplicateKeyIncludes(error: unknown, field: string): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const keyPattern = (error as { keyPattern?: Record<string, unknown> }).keyPattern;
  const keyValue = (error as { keyValue?: Record<string, unknown> }).keyValue;
  return Boolean(keyPattern?.[field] !== undefined || keyValue?.[field] !== undefined);
}

function assignGranotCarrierCodeWrite(
  value: string | undefined,
  set: Record<string, unknown>,
  unset: Record<string, 1>,
): void {
  if (value === undefined) {
    return;
  }
  if (value === "") {
    unset.granot_carrier_code = 1;
    return;
  }
  set.granot_carrier_code = normalizeGranotCarrierCode(value);
}

function optionalGranotCarrierCodePayload(
  value: string | undefined,
): { granot_carrier_code: string } | Record<string, never> {
  const code = normalizeOptionalGranotCarrierCode(value ?? "");
  return code ? { granot_carrier_code: code } : {};
}

function normalizeOptionalGranotCarrierCode(value: string): string | undefined {
  const code = normalizeGranotCarrierCode(value);
  return code || undefined;
}
