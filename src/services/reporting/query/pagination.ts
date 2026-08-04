import { Buffer } from "node:buffer";
import { computeChecksum } from "../../durableWork";
import type { QueryPage, SortTerm } from "../catalog";

type CursorV1 = { version: 1; values: unknown[] };

export function encodeCursor(values: unknown[]): string {
  return Buffer.from(JSON.stringify({ version: 1, values } satisfies CursorV1), "utf8").toString("base64url");
}

export function decodeCursor(value: string): CursorV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new TypeError("Invalid reporting cursor.");
  }
  if (
    !parsed || typeof parsed !== "object" ||
    (parsed as CursorV1).version !== 1 || !Array.isArray((parsed as CursorV1).values)
  ) throw new TypeError("Unsupported reporting cursor.");
  return parsed as CursorV1;
}

export function paginateRows<Row extends Record<string, unknown>>(
  rows: Row[],
  sort: SortTerm[],
  pageSize: number,
  after?: string,
): QueryPage<Row> {
  const cursor = after ? decodeCursor(after).values : undefined;
  const start = cursor
    ? rows.findIndex((row) => compareSortTuple(sort.map((term) => row[term.id]), cursor, sort) > 0)
    : 0;
  const safeStart = start < 0 ? rows.length : start;
  const pageRows = rows.slice(safeStart, safeStart + pageSize);
  const last = pageRows.at(-1);
  const nextCursor =
    last && safeStart + pageRows.length < rows.length
      ? encodeCursor(sort.map((term) => last[term.id]))
      : null;
  return {
    rows: pageRows,
    nextCursor,
    rowCount: pageRows.length,
    canonicalPageChecksum: computeChecksum({
      checksum_version: 1,
      artifact_kind: "reporting_page",
      schema_version: 1,
      payload: pageRows,
    }),
  };
}

export function compareSortTuple(a: unknown[], b: unknown[], sort: SortTerm[]): number {
  for (let index = 0; index < sort.length; index += 1) {
    const comparison = compareTuple([a[index]], [b[index]]);
    if (comparison) return sort[index]?.direction === "desc" ? -comparison : comparison;
  }
  return 0;
}

export function compareTuple(a: unknown[], b: unknown[]): number {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const left = a[index] ?? "";
    const right = b[index] ?? "";
    const comparison = String(left).localeCompare(String(right), "en", { numeric: true });
    if (comparison) return comparison;
  }
  return 0;
}
