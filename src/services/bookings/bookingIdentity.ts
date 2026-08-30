export function normalizeJobNo(value?: string | null): string | undefined {
  return normalizeToken(value, { uppercase: true });
}

const DIGIT_CORE_JOB = /^[A-Z]*(\d+)$/;

export function jobNumberDigitCore(normalized?: string | null): string | undefined {
  if (!normalized) return undefined;
  return DIGIT_CORE_JOB.exec(normalized)?.[1];
}

export function jobNumbersEquivalent(
  left?: string | null,
  right?: string | null,
): boolean {
  if (!left || !right) return false;
  if (left === right) return true;
  const leftCore = jobNumberDigitCore(left);
  const rightCore = jobNumberDigitCore(right);
  return Boolean(leftCore && leftCore === rightCore);
}

export function equivalentNormalizedJobFilter(
  normalizedJobNo: string,
): { normalized_job_no: string } | { $or: Array<{ normalized_job_no: string | { $regex: string } }> } {
  const core = jobNumberDigitCore(normalizedJobNo);
  if (!core) return { normalized_job_no: normalizedJobNo };
  const escaped = core.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return {
    $or: [
      { normalized_job_no: normalizedJobNo },
      { normalized_job_no: core },
      { normalized_job_no: { $regex: `^[A-Z]+${escaped}$` } },
    ],
  };
}

export function remapNormalizedJobFilter<T extends string>(
  filter: ReturnType<typeof equivalentNormalizedJobFilter>,
  field: T,
): Record<T, string> | { $or: Array<Record<T, string | { $regex: string }>> } {
  if ("normalized_job_no" in filter) {
    return { [field]: filter.normalized_job_no } as Record<T, string>;
  }
  return {
    $or: filter.$or.map((clause) => ({
      [field]: clause.normalized_job_no,
    }) as Record<T, string | { $regex: string }>),
  };
}

export function equivalentNormalizedJobSnapshotFilter(
  normalizedJobNo: string,
): ReturnType<typeof remapNormalizedJobFilter<"normalized_job_no_snapshot">> {
  return remapNormalizedJobFilter(
    equivalentNormalizedJobFilter(normalizedJobNo),
    "normalized_job_no_snapshot",
  );
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
