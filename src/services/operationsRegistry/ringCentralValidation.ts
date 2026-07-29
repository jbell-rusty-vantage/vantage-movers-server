import { RingCentralApiError, ringCentralRequest } from "../ringcentral/client";
import { normalizePhoneNumberToE164Like } from "../ringcentral/phone-normalization";

export type RingCentralRouteValidationResult =
  | {
      status: "valid";
      code: "RINGCENTRAL_NUMBER_ACCESSIBLE";
      message: string;
      phoneNumberId?: string;
      extensionId?: string;
      queueId?: string;
      queueName?: string;
      observedTargetNames: string[];
    }
  | {
      status: "invalid";
      code: "RINGCENTRAL_NUMBER_NOT_FOUND" | "RINGCENTRAL_NUMBER_INVALID";
      message: string;
    }
  | {
      status: "unavailable";
      code: "RINGCENTRAL_VALIDATION_UNAVAILABLE";
      message: string;
    };

export type RingCentralRouteValidator = (
  normalizedPhoneNumber: string,
) => Promise<RingCentralRouteValidationResult>;

export const validateRingCentralNumberAgainstAccount: RingCentralRouteValidator =
  async (normalizedPhoneNumber) => {
    if (!normalizePhoneNumberToE164Like(normalizedPhoneNumber)) {
      return {
        status: "invalid",
        code: "RINGCENTRAL_NUMBER_INVALID",
        message: "The phone number could not be normalized.",
      };
    }

    try {
      const records = await loadAccessiblePhoneNumbers();
      const matched = records.find(
        (record) =>
          normalizePhoneNumberToE164Like(valueToString(record.phoneNumber)) ===
          normalizedPhoneNumber,
      );
      if (!matched) {
        return {
          status: "invalid",
          code: "RINGCENTRAL_NUMBER_NOT_FOUND",
          message:
            "The number was not found among phone numbers accessible to the configured RingCentral account.",
        };
      }

      const extension = asRecord(matched.extension);
      const usageType = valueToString(matched.usageType);
      const type = valueToString(matched.type);
      const queueName =
        valueToString(extension?.name) ??
        valueToString(matched.label) ??
        valueToString(matched.features);
      return {
        status: "valid",
        code: "RINGCENTRAL_NUMBER_ACCESSIBLE",
        message: "The number exists and is accessible in the configured RingCentral account.",
        phoneNumberId: valueToString(matched.id) ?? undefined,
        extensionId: valueToString(extension?.id) ?? undefined,
        queueId:
          usageType === "CompanyNumber" || type === "TollFree"
            ? valueToString(extension?.id) ?? undefined
            : undefined,
        queueName: queueName ?? undefined,
        observedTargetNames: queueName ? [queueName] : [],
      };
    } catch (error) {
      return {
        status: "unavailable",
        code: "RINGCENTRAL_VALIDATION_UNAVAILABLE",
        message: safeValidationFailureMessage(error),
      };
    }
  };

async function loadAccessiblePhoneNumbers(): Promise<Record<string, unknown>[]> {
  const records: Record<string, unknown>[] = [];
  let page = 1;
  const perPage = 100;
  while (page <= 20) {
    const payload = await ringCentralRequest(
      "GET",
      `/restapi/v1.0/account/~/phone-number?page=${page}&perPage=${perPage}`,
    );
    const pageRecords = Array.isArray(payload?.records)
      ? payload.records.map(asRecord).filter(isRecord)
      : [];
    records.push(...pageRecords);
    if (pageRecords.length < perPage) break;
    page += 1;
  }
  return records;
}

function safeValidationFailureMessage(error: unknown): string {
  if (error instanceof RingCentralApiError) {
    if (error.status === 401 || error.status === 403) {
      return "RingCentral validation credentials do not have access to account phone numbers.";
    }
    if (error.status === 429) {
      return "RingCentral validation is temporarily rate limited. Retry later.";
    }
    return `RingCentral validation is unavailable (HTTP ${error.status}).`;
  }
  return "RingCentral validation is temporarily unavailable. Retry later.";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isRecord(value: Record<string, unknown> | null): value is Record<string, unknown> {
  return value !== null;
}

function valueToString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) {
    const values = value.filter((item): item is string => typeof item === "string");
    return values.length ? values.join(", ") : null;
  }
  return null;
}
