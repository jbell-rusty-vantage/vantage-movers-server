export function normalizeJobNo(value?: string | null): string | undefined {
  return normalizeToken(value, { uppercase: true });
}

export function normalizeSubmissionLid(value?: string | null): string | undefined {
  return normalizeToken(value, { uppercase: true, preserveInternalPunctuation: true });
}

export function normalizeComparisonEmail(value?: string | null): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  return trimmed || undefined;
}

export function normalizeComparisonName(value?: string | null): string | undefined {
  const trimmed = value?.normalize("NFKC").trim();
  if (!trimmed) {
    return undefined;
  }

  const punctuationNormalized = trimmed
    .replace(/[\u2018\u2019\u201A\u201B']/g, " ")
    .replace(/[\u2010-\u2015-]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ");

  const collapsed = punctuationNormalized
    .toLocaleLowerCase("en-US")
    .replace(/\s+/g, " ")
    .trim();

  return collapsed || undefined;
}

function normalizeToken(
  value: string | null | undefined,
  options: {
    uppercase?: boolean;
    preserveInternalPunctuation?: boolean;
  } = {},
): string | undefined {
  const trimmed = value?.normalize("NFKC").trim();
  if (!trimmed) {
    return undefined;
  }

  const collapsed = options.preserveInternalPunctuation
    ? trimmed.replace(/\s+/g, " ")
    : trimmed.replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ");
  const normalized = options.uppercase
    ? collapsed.toLocaleUpperCase("en-US")
    : collapsed;

  return normalized.trim() || undefined;
}
