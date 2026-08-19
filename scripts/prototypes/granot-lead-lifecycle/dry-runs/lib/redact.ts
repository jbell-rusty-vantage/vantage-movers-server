const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /\+?\d[\d\s().-]{7,}\d/g;

export function redactText(value: unknown): string | undefined {
  if (value == null) return undefined;
  const text = String(value);
  if (!text.trim()) return undefined;
  return text.replace(EMAIL, "[redacted-email]").replace(PHONE, "[redacted-phone]");
}

export function redactContact<T extends Record<string, unknown>>(value: T | null | undefined): T | undefined {
  if (!value) return undefined;
  const next = { ...value };
  for (const key of Object.keys(next)) {
    const folded = key.toLowerCase();
    if (
      folded.includes("name") ||
      folded.includes("phone") ||
      folded.includes("email") ||
      folded.includes("user") ||
      folded.includes("rep")
    ) {
      const current = next[key];
      if (typeof current === "string") {
        (next as Record<string, unknown>)[key] = current ? "[redacted]" : current;
      }
    }
  }
  return next;
}

export function maskId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.length <= 10 ? "***" : `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function classifyRefNo(value: string | undefined): "uuid" | "mob" | "object_id" | "other" | "empty" {
  if (!value?.trim()) return "empty";
  const trimmed = value.trim();
  if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(trimmed) || /^[0-9a-f-]{36}$/i.test(trimmed)) {
    return "uuid";
  }
  if (/^Mob_/i.test(trimmed)) return "mob";
  if (/^[0-9a-f]{24}$/i.test(trimmed)) return "object_id";
  return "other";
}
