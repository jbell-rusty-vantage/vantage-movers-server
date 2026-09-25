import type { Collection } from "mongodb";
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../config/domain";
import { logger } from "../../logger";

/**
 * Shared, cross-invocation RingCentral rate-limit gate.
 *
 * RingCentral limits each app + user pair per API group. Every server path
 * authenticates as the same JWT user, so every cron, queue consumer and job
 * shares one bucket per group. Production 2026-09-25 answered the Heavy group
 * with `429 CMN-301`, `X-Rate-Limit-Group: heavy`, `X-Rate-Limit-Limit: 10`,
 * `X-Rate-Limit-Window: 60`, `Retry-After: 60`.
 *
 * One Mongo document per group (`ringcentral_rate_limit_gates`) holds:
 * - `open_until`: set by any observed 429 (Retry-After, else the window). While
 *   it is in the future no caller sends a request in that group.
 * - `grants`: send times inside the sliding 60 s window. A Heavy request is
 *   sent only when fewer than the budget were sent in the last 60 s. Low
 *   priority work (per-session refreshes, recording downloads, model-driven
 *   provider reads) may use only part of the budget, so the authoritative
 *   Call Log reconcile always has headroom.
 *
 * The decision is one atomic `findOneAndUpdate` with a pipeline update, so
 * concurrent invocations cannot overspend. Without a Mongo connection (unit
 * tests, scripts that never connect) and when `RINGCENTRAL_RATE_GATE=off`, the
 * gate is a no-op. A gate read failure fails open: the gate protects the
 * provider budget, it must never stop capture on a Mongo hiccup.
 */

export type RingCentralGateGroup = "heavy" | "other";
export type RingCentralCallPriority = "high" | "low";

export const RINGCENTRAL_RATE_WINDOW_MS = 60_000;
const COLLECTION = "ringcentral_rate_limit_gates";
const MAX_OPEN_MS = 15 * 60_000;

/**
 * Heavy group endpoints this server calls: Call Log list / by id, Call Log
 * Sync and recording metadata / content. Everything else is `other`: never
 * budgeted, but a 429 on it still opens its gate.
 */
export function ringCentralGateGroup(endpoint: string): RingCentralGateGroup {
  const path = endpoint.split("?")[0] ?? endpoint;
  return /\/restapi\/v1\.0\/account\/[^/]+\/(?:call-log(?:-sync)?(?:\/[^/]+)?|recording\/[^/]+(?:\/content)?)$/.test(path)
    ? "heavy"
    : "other";
}

export type RingCentralGateConfig = {
  enabled: boolean;
  /** Heavy sends per sliding minute for high-priority callers (provider limit 10). */
  heavyPerMinute: number;
  /** Heavy sends per sliding minute low-priority callers may reach. */
  heavyLowPriorityPerMinute: number;
  /** How long a high-priority caller may wait for a slot before it reports a throttle. */
  highPriorityMaxWaitMs: number;
};

export function ringCentralGateConfig(env: NodeJS.ProcessEnv = process.env): RingCentralGateConfig {
  const int = (name: string, fallback: number, min: number, max: number) => {
    const raw = env[name]?.trim();
    if (!raw) return fallback;
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
  };
  const heavyPerMinute = int("RINGCENTRAL_HEAVY_REQUESTS_PER_MINUTE", 8, 1, 10);
  return {
    enabled: env.RINGCENTRAL_RATE_GATE?.trim().toLowerCase() !== "off",
    heavyPerMinute,
    heavyLowPriorityPerMinute: Math.min(heavyPerMinute, int("RINGCENTRAL_HEAVY_LOW_PRIORITY_PER_MINUTE", 4, 0, 10)),
    highPriorityMaxWaitMs: int("RINGCENTRAL_RATE_GATE_MAX_WAIT_MS", 70_000, 0, 300_000),
  };
}

export type GateDecision =
  | { granted: true }
  | { granted: false; reason: "gate_open" | "budget"; waitMs: number };

export type GateDocument = {
  _id: string;
  open_until?: Date | null;
  grants?: Date[];
  last_granted?: boolean;
  last_throttle?: Record<string, unknown> | null;
  throttle_count?: number;
};

export type RingCentralRateGate = {
  /** One atomic try: grant a send now, or say how long until one could be granted. */
  tryAcquire(group: RingCentralGateGroup, priority: RingCentralCallPriority, now: Date): Promise<GateDecision>;
  /** Records a provider 429: nobody in the group sends before `now + retryAfterMs`. */
  trip(group: RingCentralGateGroup, retryAfterMs: number, now: Date, detail: Record<string, unknown>): Promise<void>;
};

export const noopRingCentralRateGate: RingCentralRateGate = {
  tryAcquire: async () => ({ granted: true }),
  trip: async () => undefined,
};

/** Pure decision used by the Mongo pipeline and by tests: sliding-window count against the priority's limit. */
export function decideGate(
  state: { open_until?: Date | null; grants?: readonly Date[] },
  input: { group: RingCentralGateGroup; priority: RingCentralCallPriority; now: Date; config: RingCentralGateConfig },
): GateDecision {
  const now = input.now.getTime();
  const openUntil = state.open_until?.getTime() ?? 0;
  if (openUntil > now) return { granted: false, reason: "gate_open", waitMs: openUntil - now };
  if (input.group !== "heavy") return { granted: true };
  const limit = input.priority === "low" ? input.config.heavyLowPriorityPerMinute : input.config.heavyPerMinute;
  const live = (state.grants ?? []).map((d) => d.getTime()).filter((t) => t > now - RINGCENTRAL_RATE_WINDOW_MS).sort((a, b) => a - b);
  if (live.length < limit) return { granted: true };
  if (limit <= 0) return { granted: false, reason: "budget", waitMs: RINGCENTRAL_RATE_WINDOW_MS };
  // The slot frees when the grant that keeps the count at the limit leaves the window.
  const freeing = live[live.length - limit] ?? now;
  return { granted: false, reason: "budget", waitMs: Math.max(1, freeing + RINGCENTRAL_RATE_WINDOW_MS - now) };
}

export function createMongoRingCentralRateGate(
  config: RingCentralGateConfig = ringCentralGateConfig(),
  /** Replica tests pass an isolated collection. */
  gateCollection?: () => Collection<GateDocument>,
): RingCentralRateGate {
  const collection = (): Collection<GateDocument> => {
    if (gateCollection) return gateCollection();
    const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db;
    if (!db) throw new Error("MongoDB connection is not ready");
    return db.collection<GateDocument>(COLLECTION);
  };
  return {
    async tryAcquire(group, priority, now) {
      const cutoff = new Date(now.getTime() - RINGCENTRAL_RATE_WINDOW_MS);
      const limit = group !== "heavy" ? Number.MAX_SAFE_INTEGER : priority === "low" ? config.heavyLowPriorityPerMinute : config.heavyPerMinute;
      const live = { $filter: { input: { $ifNull: ["$grants", []] }, cond: { $gt: ["$$this", cutoff] } } };
      const doc = await collection().findOneAndUpdate(
        { _id: `ringcentral:${group}` },
        [
          { $set: { grants: live } },
          {
            $set: {
              last_granted: {
                $and: [
                  { $not: [{ $gt: [{ $ifNull: ["$open_until", new Date(0)] }, now] }] },
                  { $lt: [{ $size: "$grants" }, limit] },
                ],
              },
            },
          },
          // Only budgeted (Heavy) sends are recorded; `other` keeps an empty log.
          { $set: { grants: { $cond: [{ $and: ["$last_granted", group === "heavy"] }, { $concatArrays: ["$grants", [now]] }, "$grants"] } } },
        ],
        { upsert: true, returnDocument: "after" },
      );
      if (doc?.last_granted) return { granted: true };
      // Recompute the wait from the stored state (the grant was not recorded).
      const decision = decideGate(doc ?? {}, { group, priority, now, config });
      return decision.granted ? { granted: false, reason: "budget", waitMs: 1_000 } : decision;
    },
    async trip(group, retryAfterMs, now, detail) {
      const openUntil = new Date(now.getTime() + Math.min(MAX_OPEN_MS, Math.max(1_000, retryAfterMs)));
      await collection().updateOne(
        { _id: `ringcentral:${group}` },
        [
          {
            $set: {
              open_until: { $max: [{ $ifNull: ["$open_until", new Date(0)] }, openUntil] },
              last_throttle: { $literal: { at: now, retry_after_ms: retryAfterMs, ...detail } },
              throttle_count: { $add: [{ $ifNull: ["$throttle_count", 0] }, 1] },
            },
          },
        ],
        { upsert: true },
      );
    },
  };
}

let gateOverride: RingCentralRateGate | null = null;
let mongoGate: RingCentralRateGate | null = null;

/** Tests inject a gate; `null` restores the default. */
export function setRingCentralRateGateForTests(gate: RingCentralRateGate | null): void {
  gateOverride = gate;
}

export function currentRingCentralRateGate(): RingCentralRateGate {
  if (gateOverride) return gateOverride;
  if (!ringCentralGateConfig().enabled || mongoose.connection.readyState !== 1) return noopRingCentralRateGate;
  mongoGate ??= createMongoRingCentralRateGate();
  return mongoGate;
}

export class RingCentralGateDeniedError extends Error {
  constructor(
    readonly group: RingCentralGateGroup,
    readonly reason: "gate_open" | "budget",
    readonly retryAfterMs: number,
  ) {
    super(`ringcentral_${group}_${reason}`);
    this.name = "RingCentralGateDeniedError";
  }
}

export type AcquireOptions = {
  priority?: RingCentralCallPriority;
  /** Longest total wait for a slot; 0 means one try. Defaults: high → config, low → 0. */
  maxWaitMs?: number;
  signal?: AbortSignal;
  gate?: RingCentralRateGate;
  now?: () => Date;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

/**
 * Waits (bounded) for a send slot in the endpoint's group. Throws
 * `RingCentralGateDeniedError` with the wait a caller should defer by. A gate
 * failure is logged and the request goes ahead (fail open).
 */
export async function acquireRingCentralSlot(endpoint: string, options: AcquireOptions = {}): Promise<void> {
  const group = ringCentralGateGroup(endpoint);
  const gate = options.gate ?? currentRingCentralRateGate();
  if (gate === noopRingCentralRateGate) return;
  const priority = options.priority ?? "high";
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? abortableSleep;
  const maxWaitMs = options.maxWaitMs ?? (priority === "high" ? ringCentralGateConfig().highPriorityMaxWaitMs : 0);
  const started = now().getTime();
  for (;;) {
    options.signal?.throwIfAborted();
    let decision: GateDecision;
    try {
      decision = await gate.tryAcquire(group, priority, now());
    } catch (error) {
      logger.warn({ msg: "ringcentral.rate_gate.unavailable", group, errorName: error instanceof Error ? error.name : "Error" });
      return;
    }
    if (decision.granted) return;
    const waited = now().getTime() - started;
    // Small jitter so waiting invocations do not all fire on the same millisecond.
    const wait = decision.waitMs + Math.floor(Math.random() * 500);
    if (waited + wait > maxWaitMs) {
      logger.info({ msg: "ringcentral.rate_gate.denied", group, priority, reason: decision.reason, waitMs: decision.waitMs });
      throw new RingCentralGateDeniedError(group, decision.reason, decision.waitMs);
    }
    await sleep(wait, options.signal);
  }
}

/** Opens the group's gate after a provider 429. Never throws. */
export async function recordRingCentralThrottle(
  endpoint: string,
  input: { retryAfterMs: number; headerGroup: string | null; gate?: RingCentralRateGate; now?: Date },
): Promise<void> {
  const gate = input.gate ?? currentRingCentralRateGate();
  const now = input.now ?? new Date();
  const groups = new Set<RingCentralGateGroup>([ringCentralGateGroup(endpoint)]);
  if (input.headerGroup?.toLowerCase() === "heavy") groups.add("heavy");
  for (const group of groups) {
    try {
      await gate.trip(group, input.retryAfterMs, now, { header_group: input.headerGroup, endpoint_kind: ringCentralGateGroup(endpoint) });
    } catch (error) {
      logger.warn({ msg: "ringcentral.rate_gate.trip_failed", group, errorName: error instanceof Error ? error.name : "Error" });
    }
  }
  logger.warn({ msg: "ringcentral.rate_gate.tripped", groups: [...groups], retryAfterMs: input.retryAfterMs, headerGroup: input.headerGroup });
}

/**
 * Provider wait after a 429: `Retry-After` (seconds or HTTP date), else
 * `X-Rate-Limit-Window` seconds, else 60 s (the Heavy penalty window).
 */
export function providerRetryAfterMs(headers: Pick<Headers, "get">, now: Date = new Date()): { ms: number; observed: boolean } {
  const retryAfter = headers.get("retry-after")?.trim();
  if (retryAfter) {
    if (/^\d+(\.\d+)?$/.test(retryAfter)) return { ms: Math.max(1_000, Number(retryAfter) * 1000), observed: true };
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return { ms: Math.max(1_000, date - now.getTime()), observed: true };
  }
  const window = headers.get("x-rate-limit-window")?.trim();
  if (window && /^\d+$/.test(window)) return { ms: Math.max(1_000, Number(window) * 1000), observed: true };
  return { ms: RINGCENTRAL_RATE_WINDOW_MS, observed: false };
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }
    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason);
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
