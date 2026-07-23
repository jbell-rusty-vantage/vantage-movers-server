const ALLOWED_AUTO_MATCH_RULES = [
  "form_lid_exact",
  "call_job_no_exact",
  "form_contact_triple_exact",
  "form_email_phone_exact",
  "channel_phone_exact",
] as const;

export type EmployeeBookingAutoMatchRule =
  (typeof ALLOWED_AUTO_MATCH_RULES)[number];

export type EmployeeBookingMatchingConfig = {
  policyVersion: string;
  enabledRules: EmployeeBookingAutoMatchRule[];
};

export function getEmployeeBookingMatchingConfig(): EmployeeBookingMatchingConfig {
  const policyVersion =
    process.env.EMPLOYEE_BOOKING_AUTO_MATCH_POLICY_VERSION?.trim() ||
    "employee-booking-v1";
  const configuredRules =
    process.env.EMPLOYEE_BOOKING_AUTO_MATCH_RULES?.trim() ||
    ALLOWED_AUTO_MATCH_RULES.join(",");

  return {
    policyVersion,
    enabledRules: parseEmployeeBookingAutoMatchRules(configuredRules),
  };
}

export function parseEmployeeBookingAutoMatchRules(
  raw: string,
): EmployeeBookingAutoMatchRule[] {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    throw new Error("EMPLOYEE_BOOKING_AUTO_MATCH_RULES is empty");
  }

  if (normalized === "none") {
    return [];
  }

  const seen = new Set<string>();
  const parsed = normalized
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      if (!ALLOWED_AUTO_MATCH_RULES.includes(value as EmployeeBookingAutoMatchRule)) {
        throw new Error(
          `Unknown employee auto-match rule "${value}" in EMPLOYEE_BOOKING_AUTO_MATCH_RULES`,
        );
      }
      if (seen.has(value)) {
        throw new Error(
          `Duplicate employee auto-match rule "${value}" in EMPLOYEE_BOOKING_AUTO_MATCH_RULES`,
        );
      }
      seen.add(value);
      return value as EmployeeBookingAutoMatchRule;
    });

  if (parsed.length === 0) {
    throw new Error("EMPLOYEE_BOOKING_AUTO_MATCH_RULES is empty");
  }

  return parsed;
}

export const EMPLOYEE_BOOKING_AUTO_MATCH_RULES = ALLOWED_AUTO_MATCH_RULES;
