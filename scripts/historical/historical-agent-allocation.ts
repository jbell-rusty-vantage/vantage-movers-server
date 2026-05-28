export function normalizeHistoricalAgentName(value: string): string | undefined {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, " ");
  return normalized || undefined;
}

export function splitHistoricalAgentNames(rawName: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];

  for (const part of rawName.split("/")) {
    const name = part.trim().replace(/\s+/g, " ");
    const normalized = normalizeHistoricalAgentName(name);
    if (!normalized || seen.has(normalized)) continue;

    seen.add(normalized);
    names.push(name);
  }

  return names;
}

export function splitBinderAmountEvenly(
  totalBinderAmount: number | undefined,
  allocationCount: number,
): Array<number | undefined> {
  if (allocationCount <= 0) return [];
  if (totalBinderAmount === undefined || !Number.isFinite(totalBinderAmount)) {
    return Array.from({ length: allocationCount }, () => undefined);
  }

  const cents = Math.round(totalBinderAmount * 100);
  const baseCents = Math.floor(cents / allocationCount);
  const remainderCents = cents - baseCents * allocationCount;

  return Array.from({ length: allocationCount }, (_, index) => {
    const allocationCents = baseCents + (index < remainderCents ? 1 : 0);
    return allocationCents / 100;
  });
}
