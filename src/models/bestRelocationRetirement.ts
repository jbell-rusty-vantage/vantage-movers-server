import { normalizeGranotSourceLabel } from "../services/granotLifecycle/sourceLabel";
export const BEST_RELOCATION_COMPANY_SLUG = "best_relocation_leads";
export const BEST_RELOCATION_RETIRED_LABELS = [
  "best relocation forms", "best relocation locals", "best relocation inbounds",
  "bestrelocation forms", "bestrelocation locals", "bestrelocation inbounds",
] as const;
export function granotCreationRetired(input: {
  normalized_granot_label?: string | null; granot_label?: string | null; company_slug?: string | null;
  granot_creation_retired_at?: Date | string | null;
}): boolean {
  const label = normalizeGranotSourceLabel(input.normalized_granot_label ?? input.granot_label ?? "");
  return Boolean(input.granot_creation_retired_at) ||
    input.company_slug === BEST_RELOCATION_COMPANY_SLUG ||
    BEST_RELOCATION_RETIRED_LABELS.some((value) => value === label);
}
