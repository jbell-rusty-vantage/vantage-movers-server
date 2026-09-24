import { randomBytes } from "node:crypto";
import { logger } from "../../logger";
import { getCallInteractionModel } from "../../models/CallInteraction";
import { failureLogFields } from "./callLogQuarantine";
import { EMPTY_DIRECTORY_LOOKUP } from "./directory";
import { applyInteractionObservation } from "./persistInteraction";

/**
 * DB-only settle of provisional Call Interactions quiet past the settle horizon.
 *
 * A provisional row normally settles when the reconcile re-reads its Call Log
 * record (in the window, or by id as a straggler). That needs the provider to
 * answer for the record. When it cannot — the id reads 404, the record fails
 * deterministically or sits in quarantine, or Call Log capture is switched off
 * while webhook capture runs — the row would stay provisional forever and
 * never reach Outreach. This pass settles such rows from their **stored**
 * projection through `applyInteractionObservation` (`kind: "settle_stored"`),
 * the same result as a stale record arriving past the horizon: the last
 * observed values become final and the first settled revision drives
 * downstream work once.
 *
 * Only rows whose stored `provider_last_modified_at` is older than the horizon
 * are eligible. `graceMinutes` adds quiet time before a row is settled without
 * a provider read, so the reconcile's straggler re-read gets the first chance
 * at final provider values; `priorityCallLogIds` (quarantined, 404, failed
 * deterministically) skip the grace.
 */
export type SettleFromStoreResult = {
  scanned: number;
  settled: number;
  noops: number;
  failures: number;
  /** Call Log ids of rows settled (or found already final) by this pass. */
  settled_call_log_ids: string[];
};

type ProvisionalRow = {
  _id: unknown;
  provider_account_id: string;
  telephony_session_id?: string | null;
  session_id?: string | null;
  call_log_ids?: string[];
};

export async function settleProvisionalFromStore(input: {
  now: () => Date;
  settleHorizonMinutes: number;
  limit: number;
  graceMinutes?: number;
  priorityCallLogIds?: readonly string[];
  request_id?: string;
  apply?: typeof applyInteractionObservation;
  /** Called between rows (the reconcile renews its lease here). */
  beforeEach?: () => Promise<void>;
}): Promise<SettleFromStoreResult> {
  const result: SettleFromStoreResult = { scanned: 0, settled: 0, noops: 0, failures: 0, settled_call_log_ids: [] };
  if (input.limit <= 0) return result;
  const now = input.now();
  const horizonCutoff = new Date(now.getTime() - input.settleHorizonMinutes * 60_000);
  const graceCutoff = new Date(horizonCutoff.getTime() - (input.graceMinutes ?? 0) * 60_000);
  const priority = [...new Set(input.priorityCallLogIds ?? [])];
  const eligible: Record<string, unknown>[] = [{ provider_last_modified_at: { $lt: graceCutoff } }];
  if (priority.length) eligible.push({ call_log_ids: { $in: priority } });
  const rows = (await getCallInteractionModel()
    .collection.find(
      {
        call_log_state: "provisional",
        merged_into_id: null,
        provider_last_modified_at: { $lt: horizonCutoff },
        $or: eligible,
      },
      { projection: { provider_account_id: 1, telephony_session_id: 1, session_id: 1, call_log_ids: 1 } },
    )
    .sort({ provider_last_modified_at: 1 })
    .limit(input.limit)
    .toArray()) as unknown as ProvisionalRow[];
  const apply = input.apply ?? applyInteractionObservation;
  const requestId = input.request_id ?? randomBytes(12).toString("hex");
  for (const row of rows) {
    result.scanned += 1;
    await input.beforeEach?.();
    try {
      const applied = await apply(
        row.provider_account_id,
        {
          kind: "settle_stored",
          identity: {
            telephony_session_id: row.telephony_session_id ?? null,
            session_id: row.session_id ?? null,
            call_log_ids: row.call_log_ids ?? [],
          },
          proof_ref: `settle_stored:${String(row._id)}`,
          source: "call_log_reconcile",
        },
        {
          now: input.now,
          // Settling reads no provider record: no endpoint to classify, no route to resolve.
          directory: EMPTY_DIRECTORY_LOOKUP,
          resolveRoute: () => null,
          request_id: requestId,
          settleHorizonMinutes: input.settleHorizonMinutes,
        },
      );
      if (applied.noop) result.noops += 1;
      else result.settled += 1;
      if (applied.call_log_state !== "provisional") result.settled_call_log_ids.push(...(row.call_log_ids ?? []));
    } catch (error) {
      result.failures += 1;
      logger.warn({ msg: "sales_intelligence.call_log_settle_stored.failed", ...failureLogFields(error) });
    }
  }
  return result;
}
