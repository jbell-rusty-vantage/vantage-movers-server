const FORM_SOURCE_OWNED_PATHS = new Set([
  "name",
  "phone_number",
  "email",
  "pickup_city",
  "pickup_zip",
  "delivery_city",
  "destination_zip",
  "move_date",
  "move_size",
  "local",
]);

const CALL_SOURCE_OWNED_PATHS = new Set([
  "name",
  "phone_number",
  "email",
  "pickup_city",
  "pickup_zip",
  "delivery_city",
  "delivery_zip",
  "local",
]);

const FINANCIAL_OR_PROTECTED =
  /(?:^|_)(?:binder|deposit|refund|amount|merchant|agent|job_no|source_company|quoted|booked|cancelled|cpl|receiver_agent)(?:_|$)/i;

export type ThreeWayUpdateDecision =
  | {
      classification: "unchanged";
      patch: Record<string, never>;
      conflicts: [];
    }
  | {
      classification: "safe_update";
      patch: Record<string, unknown>;
      conflicts: [];
    }
  | {
      classification: "conflict";
      patch: Record<string, never>;
      conflicts: Array<{
        path: string;
        type: "changed_protected_field" | "canonical_divergence";
        previous_source_value: unknown;
        current_source_value: unknown;
        canonical_value: unknown;
      }>;
    };

export function evaluateSourceOwnedLeadUpdate(input: {
  lead_model: "FormLead" | "CallLead";
  originated_from_best_relocation: boolean;
  last_applied: Record<string, unknown>;
  current_source: Record<string, unknown>;
  current_canonical: Record<string, unknown>;
}): ThreeWayUpdateDecision {
  const allowlist =
    input.lead_model === "FormLead"
      ? FORM_SOURCE_OWNED_PATHS
      : CALL_SOURCE_OWNED_PATHS;
  const patch: Record<string, unknown> = {};
  const conflicts: Extract<
    ThreeWayUpdateDecision,
    { classification: "conflict" }
  >["conflicts"] = [];

  for (const [path, nextRaw] of Object.entries(input.current_source)) {
    const previousRaw = input.last_applied[path];
    if (equal(path, previousRaw, nextRaw)) continue;
    const canonicalRaw = input.current_canonical[path];
    if (
      !input.originated_from_best_relocation ||
      !allowlist.has(path) ||
      FINANCIAL_OR_PROTECTED.test(path)
    ) {
      conflicts.push({
        path,
        type: "changed_protected_field",
        previous_source_value: previousRaw,
        current_source_value: nextRaw,
        canonical_value: canonicalRaw,
      });
      continue;
    }
    if (!equal(path, canonicalRaw, previousRaw)) {
      conflicts.push({
        path,
        type: "canonical_divergence",
        previous_source_value: previousRaw,
        current_source_value: nextRaw,
        canonical_value: canonicalRaw,
      });
      continue;
    }
    patch[path] = normalizeForWrite(path, nextRaw);
  }

  if (conflicts.length) {
    return { classification: "conflict", patch: {}, conflicts };
  }
  if (!Object.keys(patch).length) {
    return { classification: "unchanged", patch: {}, conflicts: [] };
  }
  return { classification: "safe_update", patch, conflicts: [] };
}

export function sourceOwnedPaths(
  leadModel: "FormLead" | "CallLead",
): readonly string[] {
  return Object.freeze([
    ...(leadModel === "FormLead"
      ? FORM_SOURCE_OWNED_PATHS
      : CALL_SOURCE_OWNED_PATHS),
  ].sort());
}

function equal(path: string, left: unknown, right: unknown): boolean {
  return Object.is(normalize(path, left), normalize(path, right));
}

function normalize(path: string, value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) {
    return path === "move_date"
      ? value.toISOString().slice(0, 10)
      : value.toISOString();
  }
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (path === "email") return trimmed.toLowerCase();
  if (path === "phone_number") return trimmed.replace(/\D/g, "").slice(-10);
  if (path.endsWith("_zip")) {
    const digits = trimmed.replace(/\D/g, "");
    return digits ? digits.padStart(5, "0").slice(-5) : null;
  }
  if (path === "name" || path.endsWith("_city")) {
    return trimmed.toLowerCase().replace(/\s+/g, " ");
  }
  if (path === "move_date") {
    const timestamp = Date.parse(trimmed);
    return Number.isFinite(timestamp)
      ? new Date(timestamp).toISOString().slice(0, 10)
      : trimmed;
  }
  return trimmed;
}

function normalizeForWrite(path: string, value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (path === "email") return trimmed.toLowerCase();
  if (path === "phone_number") return trimmed.replace(/\D/g, "").slice(-10);
  if (path.endsWith("_zip")) {
    const digits = trimmed.replace(/\D/g, "");
    return digits ? digits.padStart(5, "0").slice(-5) : null;
  }
  if (path === "move_date") {
    const timestamp = Date.parse(trimmed);
    return Number.isFinite(timestamp)
      ? new Date(timestamp).toISOString().slice(0, 10)
      : trimmed;
  }
  return trimmed.replace(/\s+/g, " ");
}
