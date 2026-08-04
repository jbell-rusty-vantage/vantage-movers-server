export type OperationalWorkbookPurpose =
  | "ingestion_source"
  | "sheet_sync_target"
  | "operational_projection";

export type OperationalWorkbookRegistration = {
  registration_key: string;
  purpose: OperationalWorkbookPurpose;
  env_key: string;
  required_in_production: boolean;
  owner_module:
    | "best_relocation_ingestion"
    | "sheet_sync"
    | "operations";
  display_label: string;
};

export type ResolvedOperationalWorkbook =
  OperationalWorkbookRegistration & {
    spreadsheet_id: string;
  };

export type DestinationSafetyResult =
  | { allowed: true }
  | {
      allowed: false;
      code:
        | "OPERATIONAL_WORKBOOK"
        | "DENYLIST_INCOMPLETE"
        | "INVALID_SPREADSHEET_ID";
      matched_registration_key?: string;
      safe_message: string;
    };

export interface OperationalWorkbookRegistry {
  listResolved(): ResolvedOperationalWorkbook[];
  assertConfigurationComplete(): void;
  evaluateReportingDestination(
    spreadsheetId: string,
  ): DestinationSafetyResult;
}

export class OperationalWorkbookConfigurationError extends Error {
  readonly code = "DENYLIST_INCOMPLETE";
  readonly missing_registration_keys: readonly string[];

  constructor(missingRegistrationKeys: readonly string[]) {
    super("Required operational workbook safety configuration is incomplete.");
    this.name = "OperationalWorkbookConfigurationError";
    this.missing_registration_keys = [...missingRegistrationKeys];
  }
}

export function createOperationalWorkbookRegistry(input: {
  registrations: readonly OperationalWorkbookRegistration[];
  env?: Readonly<Record<string, string | undefined>>;
  production?: boolean;
}): OperationalWorkbookRegistry {
  const env = input.env ?? process.env;
  const production =
    input.production ?? process.env.NODE_ENV === "production";
  const registrations = validateRegistrations(input.registrations);

  function resolveAll(): {
    resolved: ResolvedOperationalWorkbook[];
    missing: string[];
  } {
    const resolved: ResolvedOperationalWorkbook[] = [];
    const missing: string[] = [];
    for (const registration of registrations) {
      const raw = env[registration.env_key]?.trim();
      const spreadsheetId = raw
        ? normalizeSpreadsheetId(raw)
        : undefined;
      if (!spreadsheetId) {
        if (production && registration.required_in_production) {
          missing.push(registration.registration_key);
        }
        continue;
      }
      resolved.push({ ...registration, spreadsheet_id: spreadsheetId });
    }
    return { resolved, missing };
  }

  return {
    listResolved() {
      return resolveAll().resolved;
    },
    assertConfigurationComplete() {
      const { missing } = resolveAll();
      if (missing.length > 0) {
        throw new OperationalWorkbookConfigurationError(missing);
      }
    },
    evaluateReportingDestination(
      spreadsheetId: string,
    ): DestinationSafetyResult {
      const normalized = normalizeSpreadsheetId(spreadsheetId);
      if (!normalized) {
        return {
          allowed: false,
          code: "INVALID_SPREADSHEET_ID",
          safe_message: "A valid Google spreadsheet ID is required.",
        };
      }
      const { resolved, missing } = resolveAll();
      if (missing.length > 0) {
        return {
          allowed: false,
          code: "DENYLIST_INCOMPLETE",
          safe_message:
            "Reporting destinations are disabled until operational workbook safety configuration is complete.",
        };
      }
      const matched = resolved.find(
        (entry) => entry.spreadsheet_id === normalized,
      );
      if (matched) {
        return {
          allowed: false,
          code: "OPERATIONAL_WORKBOOK",
          matched_registration_key: matched.registration_key,
          safe_message:
            "This spreadsheet is reserved for an operational workflow and cannot be a reporting destination.",
        };
      }
      return { allowed: true };
    },
  };
}

export function composeOperationalWorkbookRegistrations(
  ...groups: readonly (readonly OperationalWorkbookRegistration[])[]
): readonly OperationalWorkbookRegistration[] {
  return validateRegistrations(groups.flat());
}

export function normalizeSpreadsheetId(value: string): string | undefined {
  const trimmed = value.trim();
  const urlMatch = trimmed.match(
    /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:\/|$)/i,
  );
  const candidate = urlMatch?.[1] ?? trimmed;
  return /^[A-Za-z0-9_-]{20,}$/.test(candidate)
    ? candidate
    : undefined;
}

export function maskSpreadsheetId(value: string): string {
  const normalized = normalizeSpreadsheetId(value);
  if (!normalized) return "[invalid]";
  if (normalized.length <= 8) return "********";
  return `${normalized.slice(0, 4)}…${normalized.slice(-4)}`;
}

function validateRegistrations(
  registrations: readonly OperationalWorkbookRegistration[],
): readonly OperationalWorkbookRegistration[] {
  const keys = new Set<string>();
  for (const registration of registrations) {
    if (
      !registration.registration_key.trim() ||
      !registration.env_key.trim() ||
      !registration.display_label.trim()
    ) {
      throw new TypeError(
        "Operational workbook registrations require a key, env key, and label.",
      );
    }
    if (keys.has(registration.registration_key)) {
      throw new TypeError(
        `Duplicate operational workbook registration key: ${registration.registration_key}`,
      );
    }
    keys.add(registration.registration_key);
  }
  return Object.freeze(registrations.map((entry) => Object.freeze({ ...entry })));
}
