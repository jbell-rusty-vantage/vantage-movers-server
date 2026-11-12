import { bestRelocationRetiredError } from "../ingestion/retirementPolicy";
import type { IngestPlan } from "./types";

export type ApplyResult = {
  idempotency_key: string;
  status: "created" | "existing";
  entity_id?: string;
  http_status: number;
};

export async function applyIngestPlan(
  plan: IngestPlan,
  options: {
    apiSecret?: string;
    fetchImpl?: typeof fetch;
    confirmProductionApply: boolean;
    initialResults?: ApplyResult[];
    onProgress?: (results: ApplyResult[]) => void | Promise<void>;
  },
): Promise<ApplyResult[]> {
  throw bestRelocationRetiredError();
}
