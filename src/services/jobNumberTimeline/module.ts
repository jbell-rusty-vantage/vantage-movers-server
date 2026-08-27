import { assembleJobNumberTimeline } from "./assemble.js";
import type { JobNumberTimelineEvidenceLoader } from "./evidence-loader.port.js";
import { redactTimelineValue } from "./masking.js";
import { normalizeTypedJobNo } from "./normalize.js";
import type { JobTimelineAssembleResult } from "./types.js";

export type JobNumberTimelineModule = {
  read(input: {
    job_no: string;
    source_granularity_id?: string;
    source_company_id?: string;
    now?: Date;
  }): Promise<JobTimelineAssembleResult>;
};

export function createJobNumberTimelineModule(deps: {
  loader: JobNumberTimelineEvidenceLoader;
}): JobNumberTimelineModule {
  return {
    async read(input) {
      const normalized = normalizeTypedJobNo(input.job_no);
      if (!normalized) {
        return { status: "invalid_job_number", normalized_job_no: null };
      }

      let company_granularity_ids: string[] | undefined;
      if (input.source_company_id) {
        company_granularity_ids = await deps.loader.loadCompanyGranularityIds(
          input.source_company_id,
        );
        if (
          input.source_granularity_id
          && !company_granularity_ids.includes(input.source_granularity_id)
        ) {
          return { status: "filtered_out", normalized_job_no: normalized, scopes: [] };
        }
      }

      const rows = await deps.loader.loadRows(normalized);
      const result = assembleJobNumberTimeline({
        rawJobNo: input.job_no,
        filters: {
          source_granularity_id: input.source_granularity_id,
          source_company_id: input.source_company_id,
          company_granularity_ids,
        },
        rows,
      });
      if (result.status === "ok") {
        return {
          status: "ok",
          page: redactTimelineValue(result.page) as typeof result.page,
        };
      }
      return result;
    },
  };
}
