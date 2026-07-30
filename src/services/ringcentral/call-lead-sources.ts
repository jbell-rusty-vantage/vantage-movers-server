import {
  SOURCE_LABEL_TO_COMPANY,
  type SourceCompany,
} from "../../config/domain/sources";
import { normalizePhoneNumberToE164Like } from "./phone-normalization";

export { SOURCE_COMPANIES, SOURCE_LABEL_TO_COMPANY } from "../../config/domain/sources";
export type { SourceCompany } from "../../config/domain/sources";

/**
 * Legacy seed manifest for M5 migration and deterministic fixtures only.
 * Production routing must use the Operations Registry snapshot resolver.
 */
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
  "+18883971005": {
    sourceLabel: "GetMovers Inbounds",
    sourceCompany: "get_movers_leads",
  },
} as const satisfies Record<
  string,
  {
    sourceLabel: keyof typeof SOURCE_LABEL_TO_COMPANY;
    sourceCompany: SourceCompany;
  }
>;

export type RingCentralInboundSource =
  {
    sourceLabel: string;
    sourceCompany: SourceCompany;
  };

/** @deprecated Migration/test fixture helper; never use for runtime routing. */
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
