export function normalizePhoneNumberForMatch(value?: string | null): string | undefined {
  const normalized = normalizePhoneNumberForStorage(value ?? "");
  const digits = normalized.replace(/\D/g, "");
  if (digits.length < 8) {
    return undefined;
  }

  if (digits.length === 10) {
    return digits;
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.slice(1);
  }

  if (normalized.startsWith("+") || digits.length <= 15) {
    return digits;
  }

  return digits.slice(-10);
}

export function normalizePhoneNumberForStorage(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const hasInternationalPrefix = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");

  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.slice(1);
  }

  if (digits.length === 10) {
    return digits;
  }

  if (hasInternationalPrefix && digits.length >= 8) {
    return `+${digits}`;
  }

  return digits || trimmed;
}
