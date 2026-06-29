import type { LocalType } from "./constants";
import { normalizeSourceCompany, type SourceCompany } from "./sources";

/**
 * Sole owner of CPL (cost-per-lead) values for each source company.
 *
 * CPL defaults and env-var overrides are snapshot at module load -- this
 * preserves the original `process.env.* ?? <default>` semantics from
 * `api/config/domain.ts`, where toggling an env var at runtime after the
 * module is loaded does not change CPL.
 *
 * `best_relocation_leads` differentiates `local` vs `long_distance`; every
 * other source uses a single CPL regardless of `local` value.
 */

type SourceCpl = number | { local: number; long_distance: number };

// CPL PRICE CHANGES -> Need backfill and sheetupdate

const SOURCE_COMPANY_CPLS = {
  tbm_leads: Number(process.env.TBM_LEADS_CPL ?? 190),
  tbm_prime_leads: Number(process.env.TBM_PRIME_LEADS_CPL ?? 190),
  top10_leads: Number(process.env.TOP10_LEADS_CPL ?? 190),
  best_relocation_leads: {
    local: Number(process.env.BEST_RELOCATION_LOCALS_CPL ?? 40),
    long_distance: Number(process.env.BEST_RELOCATION_LEADS_CPL ?? 195),
  },
  get_movers_leads: Number(process.env.GETMOVERS_LEADS_CPL ?? 0),
  main_site: Number(process.env.MAINSITE_CPL ?? 0),
  not_provided: 0,
} as const satisfies Record<SourceCompany, SourceCpl>;

export function getCplForSource(
  sourceCompany: SourceCompany | string | null | undefined,
  local: LocalType | undefined,
): number {
  const cpl = SOURCE_COMPANY_CPLS[normalizeSourceCompany(sourceCompany)];
  if (typeof cpl === "number") {
    return cpl;
  }

  return cpl[local ?? "long_distance"];
}
