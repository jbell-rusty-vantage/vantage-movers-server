export function normalizeGranotCrmUsername(
  value: string | null | undefined,
): string | undefined {
  const normalized = value?.trim().toUpperCase();
  return normalized || undefined;
}
