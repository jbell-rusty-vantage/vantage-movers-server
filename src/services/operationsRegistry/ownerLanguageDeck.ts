/**
 * Owner language deck — banned implementation terms.
 *
 * Must match vantage-admin/lib/operations-registry/ownerLanguageDeck.ts.
 * Do not change one copy without the other.
 *
 * Database fields stay `source_company` / `source_granularity`. Owner-facing
 * strings say Lead source and Feed. Specification §7.6.
 */
export const OWNER_LANGUAGE_DECK_BANNED_TERMS = [
  "granularity",
  "lifecycle",
  "disposition",
  "route_key",
  "lead_model",
  "policy_version",
] as const;

export const OWNER_LANGUAGE_DECK_OBJECT_ID = /^[a-f0-9]{24}$/i;

const ID_KEY = /(^id$|_id$|^deep_link$)/i;

export type OwnerFacingLeak = {
  path: string;
  value: string;
  reason: "banned_term" | "raw_object_id";
  term?: string;
};

function isAdvancedPath(path: string): boolean {
  return path.split(".").some((part) => part === "advanced");
}

function isIdBearingKey(key: string): boolean {
  return ID_KEY.test(key);
}

/**
 * Walk an Owner-facing DTO. Skips `advanced` trees. Raw 24-char hex IDs are
 * allowed only on fields named as IDs (or `deep_link`).
 */
export function findOwnerLanguageLeaks(
  value: unknown,
  path = "",
): OwnerFacingLeak[] {
  const leaks: OwnerFacingLeak[] = [];
  visit(value, path, leaks);
  return leaks;
}

function visit(value: unknown, path: string, leaks: OwnerFacingLeak[]): void {
  if (isAdvancedPath(path)) {
    return;
  }
  if (typeof value === "string") {
    inspectString(value, path, leaks);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => visit(item, `${path}[${index}]`, leaks));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const next = path ? `${path}.${key}` : key;
      if (typeof child === "string" && isIdBearingKey(key)) {
        continue;
      }
      visit(child, next, leaks);
    }
  }
}

function inspectString(value: string, path: string, leaks: OwnerFacingLeak[]): void {
  const lower = value.toLowerCase();
  for (const term of OWNER_LANGUAGE_DECK_BANNED_TERMS) {
    if (lower.includes(term)) {
      leaks.push({ path, value, reason: "banned_term", term });
    }
  }
  if (OWNER_LANGUAGE_DECK_OBJECT_ID.test(value.trim())) {
    leaks.push({ path, value, reason: "raw_object_id" });
  }
}
