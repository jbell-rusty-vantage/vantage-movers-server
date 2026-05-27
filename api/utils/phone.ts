export function normalizePhoneNumberForMatch(value?: string | null): string | undefined {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (digits.length < 10) {
    return undefined;
  }

  return digits.slice(-10);
}

export function normalizePhoneNumberForStorage(value: string): string {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");

  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.slice(1);
  }

  if (digits.length === 10) {
    return digits;
  }

  return trimmed;
}
