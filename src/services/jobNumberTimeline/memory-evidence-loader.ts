import type { JobNumberTimelineEvidenceLoader } from "./evidence-loader.port.js";
import { jobsEquivalent } from "./normalize.js";
import { emptyJobTimelineRows, type JobTimelineRows } from "./rows.js";

export type MemoryEvidenceLoaderSeed = {
  rows?: JobTimelineRows;
  rowsForJob?: Record<string, JobTimelineRows>;
  companyGranularityIds?: Record<string, string[]>;
};

export function createMemoryEvidenceLoader(
  seed: MemoryEvidenceLoaderSeed = {},
): JobNumberTimelineEvidenceLoader {
  return {
    async loadRows(normalizedJobNo) {
      if (seed.rowsForJob) {
        const exact = seed.rowsForJob[normalizedJobNo];
        if (exact) return exact;
        const match = Object.entries(seed.rowsForJob).find(([key]) =>
          jobsEquivalent(key, normalizedJobNo),
        );
        if (match) return match[1];
      }
      return seed.rows ?? emptyJobTimelineRows();
    },
    async loadCompanyGranularityIds(sourceCompanyId) {
      return seed.companyGranularityIds?.[sourceCompanyId] ?? [];
    },
  };
}
