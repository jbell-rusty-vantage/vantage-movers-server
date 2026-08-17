/**
 * Shared Granot source-label normalizer.
 *
 * Used by Observation normalization, Registry model/commands, runtime policy
 * resolution, and later source migration. Do not fork a weaker trim/lowercase
 * variant.
 */

export const CONTROL_OR_BIDI_CHARACTERS = /[\p{Cc}\p{Cf}]/u;

const USPS_STATE_CODES = new Set([
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "DC",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
]);

export function hasControlOrBidiCharacters(value: string): boolean {
  return CONTROL_OR_BIDI_CHARACTERS.test(value);
}

export function normalizeGranotSourceLabel(raw: string): string | undefined {
  const normalized = raw.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  if (!normalized || hasControlOrBidiCharacters(normalized)) {
    return undefined;
  }
  return normalized;
}

export function normalizeUsStateCode(raw: string): string | undefined {
  const normalized = raw.normalize("NFKC").trim().toUpperCase();
  if (!normalized || hasControlOrBidiCharacters(normalized)) {
    return undefined;
  }
  if (!USPS_STATE_CODES.has(normalized)) {
    return undefined;
  }
  return normalized;
}

export function selectFormMoveType(input: {
  origin_state?: string;
  destination_state?: string;
}): "local" | "long_distance" | undefined {
  const origin = input.origin_state
    ? normalizeUsStateCode(input.origin_state)
    : undefined;
  const destination = input.destination_state
    ? normalizeUsStateCode(input.destination_state)
    : undefined;
  if (!origin || !destination) {
    return undefined;
  }
  return origin === destination ? "local" : "long_distance";
}
