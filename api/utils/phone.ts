export function normalizePhoneNumberForMatch(value?: string | null): string | undefined {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (digits.length < 10) {
    return undefined;
  }

  return digits.slice(-10);
}
