import { V1ServiceError } from "../v1ServiceError";

export const BEST_RELOCATION_INGESTION_SOURCE = "best_relocation_sheet" as const;
export const BEST_RELOCATION_SOURCE_COMPANY = "best_relocation_leads" as const;

export function bestRelocationImportLeadFilter(
  ingestionSource: typeof BEST_RELOCATION_INGESTION_SOURCE | undefined,
): { source_company?: typeof BEST_RELOCATION_SOURCE_COMPANY } {
  return ingestionSource === BEST_RELOCATION_INGESTION_SOURCE
    ? { source_company: BEST_RELOCATION_SOURCE_COMPANY }
    : {};
}

export function requireBestRelocationImportSource(
  ingestionSource: typeof BEST_RELOCATION_INGESTION_SOURCE | undefined,
  sourceCompany: string,
): boolean {
  if (ingestionSource !== BEST_RELOCATION_INGESTION_SOURCE) return false;
  if (sourceCompany !== BEST_RELOCATION_SOURCE_COMPANY) {
    throw new V1ServiceError(
      `Best Relocation import capability is restricted to ${BEST_RELOCATION_SOURCE_COMPANY}`,
      400,
    );
  }
  return true;
}
