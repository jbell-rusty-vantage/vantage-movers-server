const CONTACT_KEYS = new Set([
  "name",
  "first_name",
  "last_name",
  "display_name",
  "phone",
  "phone_number",
  "phone_raw",
  "normalized_phone",
  "email",
  "email_raw",
  "normalized_email",
  "to",
  "from",
  "body",
  "last_error",
  "spreadsheet_id",
  "contact",
  "display_money",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function redactTimelineValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactTimelineValue(item));
  }
  if (!isPlainObject(value)) {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (CONTACT_KEYS.has(key)) continue;
    out[key] = redactTimelineValue(item);
  }
  return out;
}

export function maskName(value: string): string {
  const first = value.trim()[0];
  return first ? `${first}•••` : "";
}

export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? `•••${digits.slice(-4)}` : "•••";
}

export function maskEmail(value: string): string {
  const [local, domain] = value.split("@");
  if (!domain || !local) return "•••";
  return `${local[0] ?? ""}•••@${domain}`;
}

export function maskSmsBody(_value: string): string {
  return "[redacted]";
}

export function stripForbiddenKeys<T>(value: T): T {
  return redactTimelineValue(value) as T;
}

export function pageContainsForbiddenContact(
  serialized: string,
  extras: string[] = [],
): boolean {
  if (extras.some((token) => token && serialized.includes(token))) return true;
  return /phone_raw|"body"|spreadsheet_id|last_error/.test(serialized);
}

export function serializedPageLooksSafe(serialized: string): boolean {
  return !pageContainsForbiddenContact(serialized);
}

export function assertPageSafe(serialized: string): void {
  const forbidden = [
    "spreadsheet_id",
    "last_error",
    '"body"',
    "phone_raw",
    "normalized_phone",
    "email_raw",
  ];
  for (const token of forbidden) {
    if (serialized.includes(token)) {
      throw new Error(`Serialized timeline leaked ${token}`);
    }
  }
}
