import { setTimeout as sleep } from "node:timers/promises";
import { RingCentralApiError, ringCentralRequest } from "../../src/services/ringcentral/client";

const GATE_WAIT_MS = 70_000;
const READ_BUDGET_MS = 240_000;
const MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_AFTER_MS = 60_000;

type Dependencies = {
  request: typeof ringCentralRequest;
  now(): number;
  sleep(ms: number): Promise<void>;
};

/** Account-scoped read-only recovery. Every retry still acquires the shared low-priority gate. */
export function createCallBackfillProviderReader(overrides: Partial<Dependencies> = {}) {
  const deps: Dependencies = { request: ringCentralRequest, now: Date.now, sleep: async ms => { await sleep(ms); }, ...overrides };
  // This reader is shared across rows. A provider cooldown survives an exhausted
  // lookup, so the following row cannot immediately send another denied request.
  let notBefore = 0;
  return async function read(endpoint: string): Promise<any> {
    if (!/^\/restapi\/v1\.0\/account\/~(?:\/call-log(?:\/[^/?]+)?)?(?:\?.*)?$/.test(endpoint)) throw new Error("invalid_backfill_provider_read_endpoint");
    const deadline = deps.now() + READ_BUDGET_MS;
    let lastThrottle: RingCentralApiError | undefined;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const delay = Math.max(0, notBefore - deps.now());
      if (delay > deadline - deps.now()) throw lastThrottle ?? new Error("backfill_provider_cooldown_exceeds_read_budget");
      let waiting = delay;
      while (waiting > 0) {
        const chunk = Math.min(waiting, 60_000);
        await deps.sleep(chunk);
        waiting -= chunk;
      }
      const remaining = deadline - deps.now();
      if (remaining <= 0) throw lastThrottle ?? new Error("backfill_provider_read_budget_exhausted");
      try {
        return await deps.request("GET", endpoint, undefined, { priority: "low", maxWaitMs: Math.min(GATE_WAIT_MS, remaining) });
      } catch (error) {
        if (!(error instanceof RingCentralApiError) || error.status !== 429) throw error;
        lastThrottle = error;
        const retryAfter = typeof error.retryAfterMs === "number" && Number.isFinite(error.retryAfterMs) && error.retryAfterMs >= 0
          ? Math.max(1000, error.retryAfterMs) : DEFAULT_RETRY_AFTER_MS;
        notBefore = Math.max(notBefore, deps.now() + retryAfter);
        if (attempt === MAX_ATTEMPTS - 1) throw error;
      }
    }
    throw lastThrottle ?? new Error("backfill_provider_retries_exhausted");
  };
}
