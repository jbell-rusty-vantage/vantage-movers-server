import { resolveSourceCompany, type SourceCompany } from "../../config/domain";
import { V1ServiceError } from "../v1ServiceError";

/**
 * Service-level wrapper around `resolveSourceCompany` that converts an
 * unresolved source company into a 400 `V1ServiceError`.
 *
 * Centralizing this here keeps the rejection contract for unknown
 * `source_company` values in one place, even when callers (form lead, call
 * lead, booking-from-source) come from different service folders.
 */
export function parseSourceCompany(value?: string | null): SourceCompany {
  const sourceCompany = resolveSourceCompany(value);
  if (!sourceCompany) {
    throw new V1ServiceError(`Unknown source_company "${value}"`, 400);
  }

  return sourceCompany;
}
