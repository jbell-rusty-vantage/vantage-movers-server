const GRANOT_PLACEHOLDERS = new Set(["0", "na", "n/a", "none", "null", "-", "--"]);

export type GranotCityState = {
  city: string;
  state: string;
};

export function parseGranotCityState(value?: string | null): GranotCityState | undefined {
  const cleaned = cleanGranotLocationValue(value);
  if (!cleaned) return undefined;

  const separatorIndex = cleaned.lastIndexOf(",");
  if (separatorIndex < 1) return undefined;

  const city = cleaned.slice(0, separatorIndex).trim();
  const state = cleaned.slice(separatorIndex + 1).trim().toUpperCase();
  if (!city || !/^[A-Z]{2}$/.test(state)) return undefined;

  return { city, state };
}

export function parseGranotZip(value?: string | null): string | undefined {
  const cleaned = cleanGranotLocationValue(value);
  if (!cleaned || !/^\d{5}$/.test(cleaned) || /^0+$/.test(cleaned)) {
    return undefined;
  }
  return cleaned;
}

function cleanGranotLocationValue(value?: string | null): string | undefined {
  const cleaned = value?.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned || GRANOT_PLACEHOLDERS.has(cleaned.toLowerCase())) {
    return undefined;
  }
  return cleaned;
}
