/**
 * Single NFKC + whitespace-collapse + trim + lowercase normalizer for
 * sheet/legacy label mapping keys. Used on write and read.
 *
 * Do not reuse sourceResolution.ts's private normalize() (trim+lowercase only).
 */
export function normalizeSourceLabel(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[\u00A0\u202F\u2007\u2009\u200A\u200B\uFEFF]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
