import crypto from "node:crypto";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type SanitizedPayloadFamily = {
  schema_version: 1;
  family_id: string;
  schema_fingerprint: string;
  occurrence_count: number;
  route_event_class: string | null;
  content_shape: "object" | "array" | "null" | "primitive";
  sanitized_payloads: JsonValue[];
};

export type SanitizationSummary = {
  schema_version: 1;
  custody: {
    source_category: "owner_approved_external_files";
    custodian_category: "owner" | "approved_operator";
    allowed_operator: "primary_agent";
    retention: "retain" | "delete_after_certification";
  };
  payload_count: number;
  family_count: number;
  families: Array<
    Omit<SanitizedPayloadFamily, "sanitized_payloads"> & {
      field_shape: string[];
    }
  >;
  scanner: { ok: true; violation_count: 0 };
};

export type SanitizerCustody = SanitizationSummary["custody"];

type ScalarCategory =
  | "address"
  | "amount"
  | "date"
  | "email"
  | "free_text"
  | "identifier"
  | "name"
  | "phone"
  | "username";

const credentialKeyPattern =
  /(?:authorization|cookie|credential|password|passwd|secret|signature|token|api[_-]?key|private[_-]?key)/i;
const safeStructuralKeyPattern = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;
const emailPattern = /\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const credentialValuePatterns = [
  /\b(?:bearer|basic)\s+[A-Za-z0-9+/=_-]{8,}/i,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\bhttps?:\/\/[^\s/:]+:[^\s/@]+@/i,
];
const phoneLikePattern = /^\+?[\d().\s-]{10,}$/;
const streetAddressPattern =
  /\b\d{1,6}\s+(?:[A-Za-z0-9.'-]+\s+){0,4}(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|way)\b/i;

const semanticStringKeys = new Set([
  "action",
  "booking_action",
  "content_type",
  "event",
  "event_type",
  "lead_type",
  "move_size",
  "origin_state",
  "destination_state",
  "pickup_state",
  "delivery_state",
  "priority",
  "route_event_class",
  "service_type",
  "source",
  "source_label",
  "status",
  "type",
]);

function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function categoryFor(key: string): ScalarCategory | undefined {
  const normalized = normalizedKey(key);
  if (/(phone|mobile|telephone|caller)/.test(normalized)) return "phone";
  if (/(email|mailaddress)/.test(normalized)) return "email";
  if (/(firstname|lastname|fullname|customername|contactname|displayname)/.test(normalized)) {
    return "name";
  }
  if (normalized === "name") return "name";
  if (/(address|street|city|zip|postal)/.test(normalized)) return "address";
  if (/(jobno|jobnumber|leadno|referenceno|refno|receiptid|observationid)/.test(normalized)) {
    return "identifier";
  }
  if (/^(?:id|_id)$/.test(normalized) || normalized.endsWith("id")) return "identifier";
  if (/(username|user|rep|agent)/.test(normalized)) return "username";
  if (/(date|time|timestamp|occurredat|capturedat|createdat|updatedat)/.test(normalized)) {
    return "date";
  }
  if (/(amount|estimate|deposit|payment|balance|price|cost|total|estcf|cubicfeet)/.test(normalized)) {
    return "amount";
  }
  if (/(note|comment|description|message|reason|text)/.test(normalized)) return "free_text";
  return undefined;
}

function stableJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key]!)}`)
    .join(",")}}`;
}

function preserveWhitespace(original: string, replacement: string): string {
  const leading = original.match(/^\s*/u)?.[0] ?? "";
  const trailing = original.match(/\s*$/u)?.[0] ?? "";
  return `${leading}${replacement}${trailing}`;
}

function substitutePhone(original: string, ordinal: number): string {
  const national = `20255501${String(ordinal % 100).padStart(2, "0")}`;
  const sourceDigits = original.replace(/\D/g, "");
  const digits = sourceDigits.length === 11 ? `1${national}` : national;
  let index = 0;
  const replaced = original.replace(/\d/g, () => digits[index++] ?? "0");
  return replaced === original ? national : replaced;
}

function substituteNumericShape(original: string): string {
  let next = 1;
  return original.replace(/\d/g, () => String((next++ % 9) + 1));
}

class SanitizationContext {
  private readonly replacements = new Map<string, string>();
  private readonly keyReplacements = new Map<string, string>();
  private ordinal = 0;

  sanitizeKey(key: string): string | undefined {
    if (credentialKeyPattern.test(normalizedKey(key))) return undefined;
    if (safeStructuralKeyPattern.test(key)) return key;
    const existing = this.keyReplacements.get(key);
    if (existing) return existing;
    const replacement = `synthetic_field_${this.keyReplacements.size + 1}`;
    this.keyReplacements.set(key, replacement);
    return replacement;
  }

  sanitizeString(value: string, key: string): string {
    if (value.trim() === "") return value;
    const semanticKey = key.toLowerCase();
    const category = categoryFor(key);
    const credentialShaped = credentialValuePatterns.some((pattern) => pattern.test(value));
    const inferredCategory =
      category ??
      (credentialShaped
        ? "free_text"
        : emailPattern.test(value)
          ? "email"
          : phoneLikePattern.test(value)
            ? "phone"
            : streetAddressPattern.test(value)
              ? "address"
              : semanticStringKeys.has(semanticKey) || normalizedKey(key).endsWith("state")
                ? undefined
                : "free_text");
    if (inferredCategory === undefined) return value;

    const relationshipCategory = inferredCategory === "identifier" ? "identifier" : inferredCategory;
    const mapKey = `${relationshipCategory}\u0000${value}`;
    const existing = this.replacements.get(mapKey);
    if (existing !== undefined) return existing;
    this.ordinal += 1;

    let replacement: string;
    switch (inferredCategory) {
      case "phone":
        replacement = substitutePhone(value, this.ordinal);
        break;
      case "email":
        replacement = preserveWhitespace(
          value,
          `synthetic${String(this.ordinal).padStart(3, "0")}@example.invalid`,
        );
        break;
      case "name":
        replacement = preserveWhitespace(
          value,
          normalizedKey(key).includes("last") ? "Customer" : "Synthetic",
        );
        break;
      case "address":
        replacement = preserveWhitespace(
          value,
          normalizedKey(key).includes("city")
            ? "Synthetic City"
            : /(zip|postal)/.test(normalizedKey(key))
              ? "00000"
              : "100 Synthetic Way",
        );
        break;
      case "identifier":
        replacement = /^[a-f\d]{24}$/i.test(value.trim())
          ? `64b00000000000000000${String(this.ordinal).padStart(4, "0")}`.slice(-24)
          : preserveWhitespace(value, `SYNTHETIC-ID-${String(this.ordinal).padStart(4, "0")}`);
        break;
      case "username":
        replacement = preserveWhitespace(value, `synthetic-user-${this.ordinal}`);
        break;
      case "date":
        replacement = preserveWhitespace(
          value,
          /^\d{4}-\d{2}-\d{2}T/.test(value.trim())
            ? "2030-01-15T12:00:00.000Z"
            : /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
              ? "2030-01-15"
              : /^\d{2}\/\d{2}\/\d{4}$/.test(value.trim())
                ? "01/15/2030"
              : substituteNumericShape(value),
        );
        break;
      case "amount":
        replacement = substituteNumericShape(value);
        break;
      case "free_text":
        replacement = preserveWhitespace(value, `[synthetic-text-${this.ordinal}]`);
        break;
    }
    this.replacements.set(mapKey, replacement);
    return replacement;
  }
}

function sanitizeValue(value: JsonValue, key: string, context: SanitizationContext): JsonValue {
  if (typeof value === "string") return context.sanitizeString(value, key);
  if (typeof value === "number") {
    const category = categoryFor(key);
    if (category === "amount") return Number.isInteger(value) ? 123 : 123.45;
    if (category === "identifier") return 1000;
    return value;
  }
  if (value === null || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((entry) => sanitizeValue(entry, key, context));
  const sanitized: Record<string, JsonValue> = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const safeKey = context.sanitizeKey(rawKey);
    if (safeKey === undefined) continue;
    sanitized[safeKey] = sanitizeValue(rawValue, safeKey, context);
  }
  return sanitized;
}

function shapeOf(value: JsonValue, prefix = "$", output: string[] = []): string[] {
  if (value === null) {
    output.push(`${prefix}:null`);
    return output;
  }
  if (Array.isArray(value)) {
    output.push(`${prefix}:array`);
    value.forEach((entry) => shapeOf(entry, `${prefix}[]`, output));
    return [...new Set(output)].sort();
  }
  if (typeof value === "object") {
    output.push(`${prefix}:object`);
    for (const key of Object.keys(value).sort()) shapeOf(value[key]!, `${prefix}.${key}`, output);
    return [...new Set(output)].sort();
  }
  output.push(`${prefix}:${typeof value}`);
  return output;
}

function routeEventClass(value: JsonValue): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  for (const key of ["route_event_class", "routeEventClass", "event_class"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim() !== "") return candidate.trim();
  }
  const eventType = typeof value.event_type === "string" ? value.event_type.trim().toLowerCase() : "";
  if (eventType === "lead_created") return "lead_created";
  if (eventType === "priority_update" || eventType === "priority_updated") return "priority_updated";
  if (eventType === "booking_status_changed") return "booking_status_changed";
  return null;
}

function receiptPayload(value: JsonValue): { payload: JsonValue; route: string | null } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { payload: value, route: null };
  }
  const route = routeEventClass(value);
  if ("payload" in value) {
    return { payload: value.payload!, route };
  }
  return { payload: value, route };
}

function inferRouteEventClass(value: JsonValue): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const eventType = typeof value.event_type === "string" ? value.event_type.trim().toLowerCase() : "";
  if (eventType === "lead_created") return "lead_created";
  if (eventType === "priority_update" || eventType === "priority_updated") {
    return "priority_updated";
  }
  if (["booked", "releas", "release", "released"].includes(eventType)) {
    return "booking_status_changed";
  }
  return null;
}

function contentShape(value: JsonValue): SanitizedPayloadFamily["content_shape"] {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value === "object" ? "object" : "primitive";
}

export function scanSanitizedPayloads(payloads: readonly JsonValue[]): string[] {
  const violations: string[] = [];
  const walk = (value: JsonValue, path: string, key: string): void => {
    if (typeof value === "string") {
      const category = categoryFor(key);
      if (value.trim() === "") return;
      if (credentialValuePatterns.some((pattern) => pattern.test(value))) {
        violations.push(`${path}:credential_value`);
      }
      if (emailPattern.test(value) && !/@example\.invalid\b/i.test(value)) {
        violations.push(`${path}:non_synthetic_email`);
      }
      const digits = value.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
      if (phoneLikePattern.test(value) && digits.length === 10 && !/^20255501\d{2}$/.test(digits)) {
        violations.push(`${path}:non_reserved_phone`);
      }
      if (streetAddressPattern.test(value) && !/\b100 Synthetic Way\b/i.test(value)) {
        violations.push(`${path}:street_address`);
      }
      if (category === "name" && !/^\s*(?:Synthetic|Customer)\s*$/u.test(value)) {
        violations.push(`${path}:non_synthetic_name`);
      }
      if (category === "username" && !/^\s*synthetic-user-\d+\s*$/u.test(value)) {
        violations.push(`${path}:non_synthetic_username`);
      }
      if (
        category === "identifier" &&
        !/^\s*SYNTHETIC-ID-\d+\s*$/u.test(value) &&
        !/^64b0[a-f\d]{20}$/i.test(value.trim())
      ) {
        violations.push(`${path}:non_synthetic_identifier`);
      }
      return;
    }
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, `${path}[${index}]`, key));
      return;
    }
    for (const [childKey, childValue] of Object.entries(value)) {
      if (credentialKeyPattern.test(normalizedKey(childKey))) {
        violations.push(`${path}.${childKey}:credential_key`);
      }
      if (!safeStructuralKeyPattern.test(childKey)) {
        violations.push(`${path}.${childKey}:unsafe_dynamic_key`);
      }
      walk(childValue, `${path}.${childKey}`, childKey);
    }
  };
  payloads.forEach((payload, index) => walk(payload, `$[${index}]`, ""));
  return violations;
}

export function sanitizePayloads(
  rawPayloads: readonly JsonValue[],
  custody: SanitizerCustody,
): { families: SanitizedPayloadFamily[]; summary: SanitizationSummary } {
  const context = new SanitizationContext();
  const sanitizedEntries = rawPayloads.map((raw) => {
    const unwrapped = receiptPayload(raw);
    return {
      route: unwrapped.route,
      payload: sanitizeValue(unwrapped.payload, "", context),
    };
  });
  const sanitizedPayloads = sanitizedEntries.map(({ payload }) => payload);
  const violations = scanSanitizedPayloads(sanitizedPayloads);
  if (violations.length > 0) {
    throw new Error(`UNIT-34 scanner rejected ${violations.join(", ")}`);
  }

  const routesByShape = new Map<string, Set<string>>();
  for (const entry of sanitizedEntries) {
    const shapeKey = stableJson(shapeOf(entry.payload) as unknown as JsonValue);
    const inferred = entry.route ?? inferRouteEventClass(entry.payload);
    if (!inferred) continue;
    const routes = routesByShape.get(shapeKey) ?? new Set<string>();
    routes.add(inferred);
    routesByShape.set(shapeKey, routes);
  }

  const groups = new Map<
    string,
    { route: string | null; shape: string[]; payloads: JsonValue[] }
  >();
  for (const entry of sanitizedEntries) {
    const payload = entry.payload;
    const shape = shapeOf(payload);
    const shapeKey = stableJson(shape as unknown as JsonValue);
    const siblingRoutes = routesByShape.get(shapeKey);
    const route =
      entry.route ??
      routeEventClass(payload) ??
      inferRouteEventClass(payload) ??
      (siblingRoutes?.size === 1 ? [...siblingRoutes][0]! : null);
    const descriptor = stableJson({ route, shape } as unknown as JsonValue);
    const fingerprint = crypto.createHash("sha256").update(descriptor).digest("hex");
    const group = groups.get(fingerprint) ?? { route, shape, payloads: [] };
    group.payloads.push(payload);
    groups.set(fingerprint, group);
  }

  const families = [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([fingerprint, group], index): SanitizedPayloadFamily => ({
      schema_version: 1,
      family_id: `current_shape_${String(index + 1).padStart(3, "0")}`,
      schema_fingerprint: fingerprint,
      occurrence_count: group.payloads.length,
      route_event_class: group.route,
      content_shape: contentShape(group.payloads[0]!),
      sanitized_payloads: group.payloads,
    }));

  return {
    families,
    summary: {
      schema_version: 1,
      custody,
      payload_count: sanitizedPayloads.length,
      family_count: families.length,
      families: families.map(({ sanitized_payloads, ...family }) => ({
        ...family,
        field_shape: shapeOf(sanitized_payloads[0]!),
      })),
      scanner: { ok: true, violation_count: 0 },
    },
  };
}
