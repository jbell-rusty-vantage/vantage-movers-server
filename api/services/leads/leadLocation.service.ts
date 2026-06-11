import type { LocalType } from "../../config/domain";
import { shouldCaptureZipStateEvents } from "../../config/domain/observability";
import { FORM_LEAD_UNKNOWN_STATE } from "../../models/FormLead";
import { getStateCodeForZip } from "../../utils/location/pickupZipState";
import { recordOperationalEvent } from "../observability";

export type LocationWorkflowContext = {
  workflow?: string;
};

export type RequiredLocationInput = {
  pickup_zip: string;
  destination_zip: string;
  pickup_state?: string;
  delivery_state?: string;
};

export type RequiredLocationResult = {
  pickup_state: string;
  delivery_state: string;
};

/**
 * Resolves pickup/delivery state codes for form-lead-style inputs that always
 * provide both zip codes. Falls back to `FORM_LEAD_UNKNOWN_STATE` when the zip
 * lookup and the caller-supplied state are both missing.
 */
export async function resolveRequiredLocation(
  input: RequiredLocationInput,
  context: LocationWorkflowContext = {},
): Promise<RequiredLocationResult> {
  const [pickupStateFromZip, deliveryStateFromZip] = await Promise.all([
    getStateCodeForZip(input.pickup_zip),
    getStateCodeForZip(input.destination_zip),
  ]);
  const pickup_state =
    normalizeState(pickupStateFromZip ?? input.pickup_state) ?? FORM_LEAD_UNKNOWN_STATE;
  const delivery_state =
    normalizeState(deliveryStateFromZip ?? input.delivery_state) ?? FORM_LEAD_UNKNOWN_STATE;

  const missingPickup = pickup_state === FORM_LEAD_UNKNOWN_STATE;
  const missingDelivery = delivery_state === FORM_LEAD_UNKNOWN_STATE;
  if ((missingPickup || missingDelivery) && shouldCaptureZipStateEvents()) {
    await recordOperationalEvent({
      level: "warn",
      eventKey: "zip_state.lookup.missing",
      category: "zip_state",
      workflow: context.workflow ?? "form_lead_create",
      summary: "ZIP did not resolve to a state and caller-supplied state was missing.",
      details: {
        pickup_zip: input.pickup_zip,
        delivery_zip: input.destination_zip,
        missing_pickup_state: missingPickup,
        missing_delivery_state: missingDelivery,
        fallback_state: FORM_LEAD_UNKNOWN_STATE,
        workflow: context.workflow ?? "form_lead_create",
      },
      notificationCandidate: false,
    });
  }

  return { pickup_state, delivery_state };
}

export type OptionalLocationInput = {
  pickup_zip?: string;
  delivery_zip?: string;
  pickup_state?: string;
  delivery_state?: string;
  local?: LocalType;
};

export type OptionalLocationResult = {
  pickup_state: string | undefined;
  delivery_state: string | undefined;
  local: LocalType | undefined;
};

/**
 * Resolves pickup/delivery state codes for call-lead-style inputs where zip
 * codes are optional. Also derives `local` when both states are known; falls
 * back to the caller-supplied `local` otherwise.
 */
export async function resolveOptionalLocation(
  input: OptionalLocationInput,
  context: LocationWorkflowContext = {},
): Promise<OptionalLocationResult> {
  const [pickupStateFromZip, deliveryStateFromZip] = await Promise.all([
    input.pickup_zip ? getStateCodeForZip(input.pickup_zip) : undefined,
    input.delivery_zip ? getStateCodeForZip(input.delivery_zip) : undefined,
  ]);
  const pickup_state = normalizeState(pickupStateFromZip ?? input.pickup_state);
  const delivery_state = normalizeState(deliveryStateFromZip ?? input.delivery_state);
  const local =
    pickup_state && delivery_state ? deriveLocal(pickup_state, delivery_state) : input.local;

  const missingPickup = Boolean(input.pickup_zip) && !pickup_state;
  const missingDelivery = Boolean(input.delivery_zip) && !delivery_state;
  if ((missingPickup || missingDelivery) && shouldCaptureZipStateEvents()) {
    await recordOperationalEvent({
      level: "info",
      eventKey: "zip_state.optional_lookup.missing",
      category: "zip_state",
      workflow: context.workflow ?? "call_lead_create",
      summary: "Optional call lead ZIP did not resolve to a state.",
      details: {
        pickup_zip: input.pickup_zip ?? null,
        delivery_zip: input.delivery_zip ?? null,
        missing_pickup_state: missingPickup,
        missing_delivery_state: missingDelivery,
        workflow: context.workflow ?? "call_lead_create",
      },
      notificationCandidate: false,
      reportable: false,
    });
  }

  return { pickup_state, delivery_state, local };
}

/**
 * Derives `local` strictly from two known state codes. Equal states means
 * `local`, otherwise `long_distance`.
 */
export function deriveLocal(pickupState: string, deliveryState: string): LocalType {
  return pickupState === deliveryState ? "local" : "long_distance";
}

/**
 * Form-lead variant of `deriveLocal` that treats unknown states as
 * `long_distance` to keep classification conservative when the zip lookup
 * has failed on either side.
 */
export function deriveFormLeadLocal(pickupState: string, deliveryState: string): LocalType {
  if (pickupState === FORM_LEAD_UNKNOWN_STATE || deliveryState === FORM_LEAD_UNKNOWN_STATE) {
    return "long_distance";
  }

  return deriveLocal(pickupState, deliveryState);
}

/**
 * Normalizes a state code: trims, upper-cases, but preserves the literal
 * `FORM_LEAD_UNKNOWN_STATE` sentinel value when supplied.
 */
export function normalizeState(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.toLowerCase() === FORM_LEAD_UNKNOWN_STATE
    ? FORM_LEAD_UNKNOWN_STATE
    : trimmed.toUpperCase();
}
