import { ObjectId } from "mongodb";

export function materializeMongoValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(materializeMongoValue);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (typeof record.$oid === "string" && Object.keys(record).length === 1) return new ObjectId(record.$oid);
  if (typeof record.$date === "string" && Object.keys(record).length === 1) return new Date(record.$date);
  return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, materializeMongoValue(entry)]));
}

export function mongoDocument(value: Record<string, unknown>): Record<string, unknown> {
  return materializeMongoValue(value) as Record<string, unknown>;
}

export function comparable(value: unknown): unknown {
  if (value instanceof ObjectId) return { $oid: value.toHexString() };
  if (value instanceof Date) return { $date: value.toISOString() };
  if (Array.isArray(value)) return value.map(comparable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, comparable(entry)]));
  return value;
}

export function matchesPlanned(actual: Record<string, unknown>, planned: Record<string, unknown>): boolean {
  return Object.entries(planned).every(([key, expected]) => JSON.stringify(comparable(actual[key])) === JSON.stringify(comparable(materializeMongoValue(expected))));
}
