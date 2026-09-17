import type { CONTACT_NUMBER_KINDS } from "../../config/domain/salesIntelligence";
import { normalizePhoneNumberToE164Like } from "../ringcentral/phone-normalization";
import type { DirectoryLookup } from "./directory";

export type EndpointKind = (typeof CONTACT_NUMBER_KINDS)[number];

/**
 * Classified telephone endpoint. `e164` is present only when the provider
 * value normalizes to a plausible E.164 number; withheld, malformed, short
 * extension and service-code endpoints keep the provider original in `raw`
 * and never become a Contact Number identity. Company-side kinds
 * (`company_did`, `extension`) may carry an E.164 DID for `company_e164`.
 */
export type ClassifiedEndpoint = Readonly<{
  kind: EndpointKind;
  raw: string | null;
  e164: string | null;
  national_ten: string | null;
  digits_reversed: string | null;
  country: string;
  extension_id: string | null;
  extension_number: string | null;
}>;

const WITHHELD_TOKENS = new Set([
  "anonymous",
  "restricted",
  "unavailable",
  "unknown",
  "private",
  "blocked",
  "withheld",
  "no caller id",
  "nocallerid",
  "outofarea",
  "out of area",
]);

/** N11 codes (`911`, `411`) and vertical service codes (`*67`, `#31#`). Other short strings are extensions. */
const SERVICE_CODE_PATTERN = /^(\*|#)[\d*#]{1,6}$|^[2-9]11$/;

export function toE164(value: string | null | undefined): string | null {
  return normalizePhoneNumberToE164Like(value ?? null);
}

/** North American ten-digit form for RingCentral `phoneNumber=` query parity. Null outside NANP. */
export function toNationalTenDigit(e164: string | null): string | null {
  if (!e164) return null;
  const match = /^\+1(\d{10})$/.exec(e164);
  return match ? match[1]! : null;
}

export function reverseDigits(e164: string): string {
  return e164.replace(/\D/g, "").split("").reverse().join("");
}

/**
 * Classifies one provider endpoint. Directory evidence marks company DIDs and
 * extensions; the normalizer marks withheld, service-code and malformed values.
 * Never fabricates an E.164 value for an endpoint that lacks one.
 */
export function classifyEndpoint(
  input: {
    phoneNumber: string | null | undefined;
    name?: string | null;
    extensionId?: string | null;
    extensionNumber?: string | null;
  },
  directory: DirectoryLookup,
): ClassifiedEndpoint {
  const raw = input.phoneNumber?.trim() ? input.phoneNumber.trim() : null;
  const extensionId = input.extensionId?.trim() || null;
  const extensionNumber = input.extensionNumber?.trim() || null;
  const digits = raw ? raw.replace(/\D/g, "") : "";
  const lowered = raw?.toLowerCase() ?? "";
  const loweredName = input.name?.trim().toLowerCase() ?? "";

  const withheld =
    raw !== null && (WITHHELD_TOKENS.has(lowered) || /^\+?0+$/.test(raw));
  const knownExtensionNumber = digits ? directory.extensionByNumber(digits) : null;
  const serviceCode =
    raw !== null && !knownExtensionNumber && SERVICE_CODE_PATTERN.test(raw);
  const shortDial =
    raw !== null &&
    !serviceCode &&
    digits.length >= 2 &&
    digits.length <= 6 &&
    !raw.startsWith("+");
  const e164 =
    raw && !withheld && !serviceCode && !shortDial ? toE164(raw) : null;
  const companyEntry = e164 ? directory.companyNumberByE164(e164) : null;
  const directoryExtension = extensionId
    ? directory.extensionById(extensionId)
    : null;
  // A short dial string is an extension only with evidence: the directory
  // knows that extension number, or the provider itself labelled the endpoint
  // with an extension number/id. An unknown short string (garbled caller id,
  // truncated number) is `malformed`, never a fabricated company extension —
  // otherwise a real customer call would be stored as Internal and lose its
  // Contact Number, outreach and recording discovery.
  const shortDialIsExtension =
    shortDial && (knownExtensionNumber !== null || extensionNumber !== null || extensionId !== null);

  const base = {
    raw,
    e164,
    national_ten: toNationalTenDigit(e164),
    digits_reversed: e164 ? reverseDigits(e164) : null,
    country: "US",
    extension_id: extensionId ?? companyEntry?.extension_id ?? knownExtensionNumber?.id ?? null,
    extension_number:
      extensionNumber ??
      directoryExtension?.extension_number ??
      (shortDial && knownExtensionNumber ? digits : null),
  };

  let kind: EndpointKind;
  if (directoryExtension || (extensionId && !e164)) kind = "extension";
  else if (companyEntry) kind = "company_did";
  else if (raw === null) kind = extensionNumber ? "extension" : "withheld";
  else if (withheld) kind = "withheld";
  else if (!digits) kind = WITHHELD_TOKENS.has(loweredName) ? "withheld" : "malformed";
  else if (serviceCode) kind = "service_code";
  else if (shortDial) kind = shortDialIsExtension ? "extension" : "malformed";
  else if (!e164) kind = "malformed";
  else if (extensionId) kind = "extension";
  else kind = "external";

  return { ...base, kind };
}

export function isCompanySide(kind: EndpointKind): boolean {
  return kind === "company_did" || kind === "extension";
}
