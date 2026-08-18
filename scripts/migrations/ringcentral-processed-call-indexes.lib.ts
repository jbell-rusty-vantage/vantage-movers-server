import { createHash } from "node:crypto";

export const RINGCENTRAL_PROCESSED_CALL_INDEX_SCRIPT_VERSION =
  "ringcentral-processed-call-indexes/1";

export type ProcessedCallIdentityCollision = {
  identity_hash: string;
  count: number;
  masked_ids: string[];
};

export function summarizeProcessedCallIdentityCollisions(
  rows: readonly {
    _id: unknown;
    callLogId?: unknown;
  }[],
): ProcessedCallIdentityCollision[] {
  const groups = new Map<
    string,
    { count: number; masked_ids: string[] }
  >();
  for (const row of rows) {
    if (
      typeof row.callLogId !== "string" ||
      row.callLogId.trim() === ""
    ) {
      continue;
    }
    const identity = row.callLogId.trim();
    const current = groups.get(identity) ?? {
      count: 0,
      masked_ids: [],
    };
    current.count += 1;
    current.masked_ids.push(maskId(String(row._id)));
    groups.set(identity, current);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.count > 1)
    .map(([identity, group]) => ({
      identity_hash: createHash("sha256")
        .update(identity)
        .digest("hex")
        .slice(0, 16),
      count: group.count,
      masked_ids: group.masked_ids.sort(),
    }))
    .sort((left, right) =>
      left.identity_hash.localeCompare(right.identity_hash),
    );
}

export function hasRequiredUniqueCallLogIndex(
  indexes: readonly {
    key: Record<string, unknown>;
    unique?: boolean;
    sparse?: boolean;
  }[],
): boolean {
  return indexes.some(
    (index) =>
      index.key.callLogId === 1 &&
      Object.keys(index.key).length === 1 &&
      index.unique === true &&
      index.sparse === true,
  );
}

function maskId(value: string): string {
  if (value.length <= 8) return "…";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
