import type { JobTimelineRows } from "./rows.js";

export type JobNumberTimelineEvidenceLoader = {
  loadRows(normalizedJobNo: string): Promise<JobTimelineRows>;
  loadCompanyGranularityIds(sourceCompanyId: string): Promise<string[]>;
};
