import { FORM_LEAD_UNKNOWN_STATE } from "../../src/models/FormLead.js";

export const FORM_LEAD_UNKNOWN_STATE_LOCAL_SCRIPT_VERSION =
  "form-lead-unknown-state-local/1";

/** Florida-stamped `timestamp` window for September 2026. */
export const SEPTEMBER_2026_FLORIDA_START = new Date("2026-09-01T00:00:00.000Z");
export const OCTOBER_2026_FLORIDA_START = new Date("2026-10-01T00:00:00.000Z");

export type UnknownStateLocalWindow = {
  start: Date;
  end: Date;
};

export type UnknownStateLocalInventoryRow = {
  id: string;
  timestamp: string | null;
  pickup_state: string | null;
  delivery_state: string | null;
  local: string | null;
  source_company: string | null;
  duplicate: boolean;
  no_sync: boolean;
  booked: boolean;
  needs_update: boolean;
};

export type UnknownStateLocalSummary = {
  scanned: number;
  needs_update: number;
  already_local: number;
};

export function september2026FloridaWindow(): UnknownStateLocalWindow {
  return {
    start: SEPTEMBER_2026_FLORIDA_START,
    end: OCTOBER_2026_FLORIDA_START,
  };
}

export function unknownStateFormLeadFilter(window: UnknownStateLocalWindow) {
  return {
    timestamp: { $gte: window.start, $lt: window.end },
    $or: [
      { pickup_state: FORM_LEAD_UNKNOWN_STATE },
      { delivery_state: FORM_LEAD_UNKNOWN_STATE },
    ],
  };
}

export function classifyUnknownStateLocalRow(row: {
  _id?: unknown;
  timestamp?: Date | string | null;
  pickup_state?: string | null;
  delivery_state?: string | null;
  local?: string | null;
  source_company?: string | null;
  duplicate?: boolean | null;
  no_sync?: boolean | null;
  booked?: unknown;
}): UnknownStateLocalInventoryRow {
  return {
    id: asId(row._id),
    timestamp: toIso(row.timestamp),
    pickup_state: row.pickup_state ?? null,
    delivery_state: row.delivery_state ?? null,
    local: row.local ?? null,
    source_company: row.source_company ?? null,
    duplicate: row.duplicate === true,
    no_sync: row.no_sync === true,
    booked: Boolean(row.booked),
    needs_update: row.local !== "local",
  };
}

export function summarizeUnknownStateLocalInventory(
  rows: readonly UnknownStateLocalInventoryRow[],
): UnknownStateLocalSummary {
  let needs_update = 0;
  let already_local = 0;
  for (const row of rows) {
    if (row.needs_update) needs_update += 1;
    else already_local += 1;
  }
  return {
    scanned: rows.length,
    needs_update,
    already_local,
  };
}

function asId(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && "toHexString" in value) {
    return String((value as { toHexString: () => string }).toHexString());
  }
  return String(value);
}

function toIso(value: Date | string | null | undefined): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "string" && value.trim()) return value;
  return null;
}
