export function normalizePhoneNumberToE164Like(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  const hasLeadingPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) {
    return null;
  }

  if (hasLeadingPlus && isPlausibleE164DigitCount(digits.length)) {
    return `+${digits}`;
  }

  if (digits.length === 10) {
    return `+1${digits}`;
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  if (isPlausibleE164DigitCount(digits.length)) {
    return `+${digits}`;
  }

  return null;
}

function isPlausibleE164DigitCount(length: number): boolean {
  return length >= 8 && length <= 15;
}
