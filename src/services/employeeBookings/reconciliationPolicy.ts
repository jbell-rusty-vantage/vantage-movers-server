import type { VantageAuthContext } from "../../middleware/requireApiSecret";
import { V1ServiceError } from "../v1ServiceError";

export const OVERRIDEABLE_RECONCILIATION_WARNINGS = [
  "duplicate_lead",
  "source_conflict",
  "channel_conflict",
  "source_unassigned",
  "same_company_legacy",
  "created_on_unmatched",
] as const;

export type ReconciliationWarning =
  | (typeof OVERRIDEABLE_RECONCILIATION_WARNINGS)[number]
  | "lead_already_booked"
  | "lead_cancelled";

export function deriveTrustedOwnerActor(
  auth: VantageAuthContext | undefined,
  headers: {
    adminUserId?: string | null;
    adminEmail?: string | null;
    adminRole?: string | null;
  },
): { actor: string; ownerId?: string; ownerEmail?: string } {
  if (auth?.kind === "user" && auth.role === "owner") {
    return {
      actor: `owner:${auth.userId}`,
      ownerId: auth.userId,
      ownerEmail: auth.email,
    };
  }

  const ownerId = headers.adminUserId?.trim();
  const ownerEmail = headers.adminEmail?.trim().toLowerCase();
  const adminRole = headers.adminRole?.trim().toLowerCase();
  if (auth?.kind === "secret" && adminRole === "owner" && ownerId && ownerEmail) {
    return {
      actor: `owner:${ownerEmail}`,
      ownerId,
      ownerEmail,
    };
  }

  throw new V1ServiceError("Forbidden", 403);
}

export function getOverrideableWarnings(
  warnings: readonly string[],
): ReconciliationWarning[] {
  return normalizeWarningCodes(warnings).filter((warning) =>
    OVERRIDEABLE_RECONCILIATION_WARNINGS.includes(
      warning as (typeof OVERRIDEABLE_RECONCILIATION_WARNINGS)[number],
    ),
  );
}

export function assertExactWarningOverrides(
  requiredWarnings: readonly string[],
  providedWarnings: readonly string[] | undefined,
): void {
  const required = [...new Set(getOverrideableWarnings(requiredWarnings))].sort();
  const provided = [...new Set(normalizeWarningCodes(providedWarnings ?? []))].sort();
  if (required.length !== provided.length) {
    throw new V1ServiceError(
      `Warning overrides must exactly match current warnings: ${required.join(", ") || "none"}`,
      409,
    );
  }
  for (let index = 0; index < required.length; index += 1) {
    if (required[index] !== provided[index]) {
      throw new V1ServiceError(
        `Warning overrides must exactly match current warnings: ${required.join(", ") || "none"}`,
        409,
      );
    }
  }
}

export function normalizeWarningCodes(
  warnings: readonly string[],
): ReconciliationWarning[] {
  return warnings
    .map((warning) => warning.trim())
    .filter(Boolean)
    .filter((warning): warning is ReconciliationWarning =>
      [
        ...OVERRIDEABLE_RECONCILIATION_WARNINGS,
        "lead_already_booked",
        "lead_cancelled",
      ].includes(warning as ReconciliationWarning),
    );
}

export function assertAllowedCaseAction(
  status: "pending" | "resolved" | "dismissed",
  action:
    | "dismiss"
    | "attach_existing"
    | "create_and_attach"
    | "reassign"
    | "reopen"
    | "update_pending",
): void {
  const allowed =
    (status === "pending" &&
      ["dismiss", "attach_existing", "create_and_attach", "update_pending"].includes(
        action,
      )) ||
    ((status === "resolved" || status === "dismissed") &&
      ["reassign", "reopen"].includes(action));
  if (!allowed) {
    throw new V1ServiceError(
      `Case status ${status} does not allow ${action}`,
      409,
    );
  }
}

export function assertLiveBookingState(args: {
  cancelled: boolean;
  hasLead: boolean;
  action:
    | "dismiss"
    | "attach_existing"
    | "create_and_attach"
    | "reassign"
    | "reopen"
    | "update_pending";
}): void {
  if (args.cancelled && !["reopen", "dismiss"].includes(args.action)) {
    throw new V1ServiceError("Booking is cancelled", 409);
  }
  if (
    ["attach_existing", "create_and_attach", "update_pending", "dismiss"].includes(
      args.action,
    ) &&
    args.hasLead
  ) {
    throw new V1ServiceError("Booking is already attached to a lead", 409);
  }
  if (args.action === "reassign" && !args.hasLead) {
    throw new V1ServiceError("Booking has no attached lead to reassign", 409);
  }
}

export function applyCursorFilter<T extends { sortDate?: Date; id: string }>(
  items: T[],
  cursor: { date: Date; id: string } | null,
  direction: "asc" | "desc",
): T[] {
  if (!cursor) {
    return items;
  }
  return items.filter((item) => {
    const time = item.sortDate?.getTime() ?? 0;
    const cursorTime = cursor.date.getTime();
    if (direction === "asc") {
      return time > cursorTime || (time === cursorTime && item.id > cursor.id);
    }
    return time < cursorTime || (time === cursorTime && item.id < cursor.id);
  });
}

export function encodeDateIdCursor(date: Date, id: string): string {
  return Buffer.from(JSON.stringify({ date: date.toISOString(), id })).toString(
    "base64url",
  );
}

export function decodeDateIdCursor(
  cursor: string | undefined,
): { date: Date; id: string } | null {
  if (!cursor?.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      date: string;
      id: string;
    };
    return { date: new Date(parsed.date), id: parsed.id };
  } catch {
    throw new V1ServiceError("Invalid cursor", 400);
  }
}
