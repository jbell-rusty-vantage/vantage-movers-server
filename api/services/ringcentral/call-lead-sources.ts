import {
  SOURCE_LABEL_TO_COMPANY,
  type SourceCompany,
} from "../../config/domain/sources";
import { normalizePhoneNumberToE164Like } from "./phone-normalization";

export { SOURCE_COMPANIES, SOURCE_LABEL_TO_COMPANY } from "../../config/domain/sources";
export type { SourceCompany } from "../../config/domain/sources";

export const RINGCENTRAL_INBOUND_NUMBER_TO_SOURCE = {
  "+18883164387": {
    sourceLabel: "10best Inbounds",
    sourceCompany: "tbm_leads",
  },
  "+18883083612": {
    sourceLabel: "TBM Prime Inbounds",
    sourceCompany: "tbm_prime_leads",
  },
  "+18887240625": {
    sourceLabel: "Top10 Inbounds",
    sourceCompany: "top10_leads",
  },
  "+18884779232": {
    sourceLabel: "Main Site Inbounds",
    sourceCompany: "main_site",
  },
} as const satisfies Record<
  string,
  {
    sourceLabel: keyof typeof SOURCE_LABEL_TO_COMPANY;
    sourceCompany: SourceCompany;
  }
>;

export type RingCentralInboundSource =
  (typeof RINGCENTRAL_INBOUND_NUMBER_TO_SOURCE)[keyof typeof RINGCENTRAL_INBOUND_NUMBER_TO_SOURCE];

export const RINGCENTRAL_TELEPHONY_SESSIONS_BASE_FILTER =
  "/restapi/v1.0/account/~/telephony/sessions";

/**
 * Builds the RingCentral subscription event filters for inbound calls.
 *
 * - `account` (default, recommended): a single account-wide inbound filter.
 *   Queue-routed RingCentral calls can move through IVR/queue/agent legs whose
 *   `to.phoneNumber` differs from the original toll-free, so we subscribe
 *   broadly and filter target numbers in code.
 * - `per-number`: one narrow filter per mapped toll-free. RingCentral accepts
 *   `phoneNumber`, but local testing showed these filters can miss routed
 *   inbound traffic even while the subscription remains Active.
 *
 * Queue name is NOT a valid filter key; queue signal stays in the party
 * payload (`to.name`, `uiCallInfo`, `queueCall`) and must be filtered locally.
 *
 * Recreate the subscription after changing this (RingCentral does not always
 * patch filters in place) via `pnpm ringcentral:webhook:create`.
 */
export function buildRingCentralTelephonyEventFilters(
  mode: "per-number" | "account" = "account",
): string[] {
  if (mode === "account") {
    return [`${RINGCENTRAL_TELEPHONY_SESSIONS_BASE_FILTER}?direction=Inbound`];
  }

  return Object.keys(RINGCENTRAL_INBOUND_NUMBER_TO_SOURCE).map(
    (phoneNumber) =>
      `${RINGCENTRAL_TELEPHONY_SESSIONS_BASE_FILTER}?direction=Inbound&phoneNumber=${encodeURIComponent(
        phoneNumber,
      )}`,
  );
}

export function resolveRingCentralInboundSource(
  phoneNumber: string | null | undefined,
): RingCentralInboundSource | null {
  const normalizedPhoneNumber = normalizePhoneNumberToE164Like(phoneNumber);
  if (!normalizedPhoneNumber) {
    return null;
  }

  if (!isRingCentralInboundNumber(normalizedPhoneNumber)) {
    return null;
  }

  return RINGCENTRAL_INBOUND_NUMBER_TO_SOURCE[normalizedPhoneNumber];
}

function isRingCentralInboundNumber(
  value: string,
): value is keyof typeof RINGCENTRAL_INBOUND_NUMBER_TO_SOURCE {
  return value in RINGCENTRAL_INBOUND_NUMBER_TO_SOURCE;
}
