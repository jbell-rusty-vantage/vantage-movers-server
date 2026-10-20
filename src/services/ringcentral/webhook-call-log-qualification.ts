import { loadRingCentralRouteSnapshot } from "../operationsRegistry";
import { ringCentralRequest } from "./client";
import { qualifiedCallFromCallLog, vetRingCentralCallLogRecord } from "./call-log-vetting";
import { ingestRingCentralQualifiedCall } from "./ringcentral-call-lead-ingest.service";

type Dependencies = {
  readRecords: (telephonySessionId: string) => Promise<unknown[]>;
  loadSnapshot: typeof loadRingCentralRouteSnapshot;
  ingest: typeof ingestRingCentralQualifiedCall;
};

/** A party ending is a wake-up only; a finished caller record authorizes ingest. */
export async function qualifyWebhookCallFromCallLog(
  telephonySessionId: string,
  dependencies: Partial<Dependencies> = {},
): Promise<string> {
  const deps: Dependencies = {
    readRecords: async (id) => {
      const query = new URLSearchParams({ telephonySessionId: id, type: "Voice", direction: "Inbound", view: "Detailed", perPage: "100" });
      const response = await ringCentralRequest("GET", `/restapi/v1.0/account/~/call-log?${query}`);
      // Never choose from an incomplete response. The scheduled scanner handles recovery.
      if (response.navigation?.nextPage) return [];
      return response.records ?? [];
    },
    loadSnapshot: loadRingCentralRouteSnapshot,
    ingest: ingestRingCentralQualifiedCall,
    ...dependencies,
  };
  const snapshot = await deps.loadSnapshot();
  const records = await deps.readRecords(telephonySessionId);
  const qualified = records
    .filter((record) => record !== null && typeof record === "object" &&
      (record as { telephonySessionId?: unknown }).telephonySessionId === telephonySessionId)
    .map((record) => vetRingCentralCallLogRecord(record, snapshot))
    .filter((vet) => vet.qualifies);
  // Multiple eligible parent records need reconciliation, never a first-match guess.
  if (qualified.length !== 1) return "awaiting_final_call_log";
  return (await deps.ingest(qualifiedCallFromCallLog(qualified[0]!, "webhook"))).action;
}
