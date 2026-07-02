import type { LocalType } from "./constants";
import type { CplLeadType } from "./cplRateDefinitions";
import { normalizeSourceCompany, type SourceCompany } from "./sources";

/**
 * Sole owner of CPL (cost-per-lead) resolution for each granular
 * source-company + lead-type (+ local, for `best_relocation_leads` forms)
 * slot.
 *
 * CPL used to be a static, env-snapshotted table (see git history). It is
 * now owner-editable at runtime through the `cpl_rates` collection -- see
 * `CPL_RATE_DEFINITIONS` in `./cplRateDefinitions.ts` for the canonical
 * 13-slot list and `../../services/cpl/cplRate.service.ts` for the
 * DB-backed cache, seeding, and admin read/write operations. This module
 * intentionally reaches into the service layer (breaking the "pure config"
 * convention the rest of `./domain/` follows) because CPL is no longer
 * build/env-time config -- it is owner-configurable runtime data that must
 * be looked up per lead.
 *
 * `not_provided` is not owner-configurable and always resolves to 0.
 */

export async function getCplForSource(
  sourceCompany: SourceCompany | string | null | undefined,
  leadType: CplLeadType,
  local: LocalType | undefined,
): Promise<number> {
  const resolvedSourceCompany = normalizeSourceCompany(sourceCompany);
  if (resolvedSourceCompany === "not_provided") {
    return 0;
  }

  // Lazy import avoids a load-time cycle: `./cpl` is re-exported from the
  // `./domain` barrel that `../../models/CplRate.ts` (via `../../services/
  // cpl/cplRate.service.ts`) also depends on for its own domain constants.
  const { getCplRate } = await import("../../services/cpl/cplRate.service.js");
  return getCplRate(resolvedSourceCompany, leadType, local);
}
