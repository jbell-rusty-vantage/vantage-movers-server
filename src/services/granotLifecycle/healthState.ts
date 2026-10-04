import mongoose from "mongoose";
import { logger } from "../../logger";
import {
  getGranotLifecycleHealthStateModel,
  type GranotLifecycleHealthCounterMetric,
  type GranotLifecycleHealthRunTrigger,
  type GranotLifecycleHealthStateDocument,
} from "../../models/GranotLifecycleHealthState";

/**
 * Bounded Health aggregates that replace the OperationalEvents reads.
 *
 * Counting started unseeded at the first write of this code (the cutover).
 * A lookback window reads as unknown (null) until counting has covered the
 * whole window, when the state has gone stale, or when a counter write was
 * missed inside the window. Unknown never reads as zero.
 */
export const GRANOT_LIFECYCLE_HEALTH_BUCKET_MS = 60 * 1000;
export const GRANOT_LIFECYCLE_HEALTH_RETENTION_MS = 48 * 60 * 60 * 1000;
/** Cron drains every 5 minutes and each run writes; four missed runs is stale. */
export const GRANOT_LIFECYCLE_HEALTH_STALE_MS = 20 * 60 * 1000;
export const GRANOT_LIFECYCLE_HEALTH_LONG_WINDOW_MS = 24 * 60 * 60 * 1000;
export const GRANOT_LIFECYCLE_HEALTH_CLAIM_WINDOW_MS = 60 * 60 * 1000;

const COVERAGE_ID = "coverage";
const ALL_DIMENSION = "all";
const DIMENSION_PATTERN = /^(all|[A-Z][A-Z0-9_]{0,63})$/;

export type GranotLifecycleHealthCoverage = {
  counters_since: Date | null;
  last_write_at: Date | null;
  gap_at: Date | null;
};

export type GranotLifecycleHealthCounters = {
  capture_failures_24h: number | null;
  claim_recoveries_1h: number | null;
  command_conflicts_24h: Array<{ code: string; count: number }> | null;
};

export type GranotLifecycleHealthLastRun = {
  at: string;
  status: "completed" | "failed";
} | null;

export type GranotLifecycleHealthAlertRow = {
  key: string;
  state: "firing" | "ok";
  since: Date | null;
};

let missedWriteAt: Date | null = null;

export function bucketStart(at: Date): Date {
  return new Date(
    Math.floor(at.getTime() / GRANOT_LIFECYCLE_HEALTH_BUCKET_MS)
      * GRANOT_LIFECYCLE_HEALTH_BUCKET_MS,
  );
}

function bucketId(
  metric: GranotLifecycleHealthCounterMetric,
  dimension: string,
  start: Date,
): string {
  return `bucket:${metric}:${dimension}:${start.toISOString()}`;
}

function isDuplicateKeyError(error: unknown): boolean {
  return Boolean(
    error
      && typeof error === "object"
      && "code" in error
      && (error as { code?: number }).code === 11000,
  );
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "codeName" in error) {
    const codeName = (error as { codeName?: unknown }).codeName;
    if (typeof codeName === "string" && /^[A-Za-z]{1,64}$/.test(codeName)) {
      return codeName;
    }
  }
  return error instanceof Error && /^[A-Za-z]{1,64}$/.test(error.name)
    ? error.name
    : "unknown";
}

function noteMissedWrite(at: Date, reason: string, error?: unknown): void {
  if (!missedWriteAt || missedWriteAt.getTime() < at.getTime()) {
    missedWriteAt = at;
  }
  logger.warn({
    msg: "granot_lifecycle.health_state.write_missed",
    reason,
    ...(error ? { error_code: errorCode(error) } : {}),
  });
  installReconnectFence();
}

let reconnectFenceInstalled = false;

/**
 * A miss noted while Mongo was unreachable is fenced by the first (re)connection this process sees,
 * not only by its next health-state write: a webhook instance that saw one capture failure may never
 * write health state again before it is recycled. Installed once, on the first miss.
 */
function installReconnectFence(): void {
  if (reconnectFenceInstalled) return;
  reconnectFenceInstalled = true;
  const fence = () => {
    void fenceMissedWriteNow();
  };
  mongoose.connection.on("connected", fence);
  mongoose.connection.on("reconnected", fence);
}

/**
 * Applies one health-state write and then refreshes the coverage row.
 *
 * A failed write while Mongo is connected fences the window at once with a
 * separate coverage `gap_at` write, so the gap survives this process. When
 * Mongo is unreachable (or that fence write fails too) the miss is held in
 * this process until its next successful write or its next Mongo
 * (re)connection, whichever comes first. A process recycled before either
 * still loses the marker (residual risk, recorded in the slimming evidence).
 * The 20-minute staleness rule still turns a full writer outage into unknown,
 * but a single lost miss can undercount a window.
 */
async function writeHealthState(
  at: Date,
  write: (model: ReturnType<typeof getGranotLifecycleHealthStateModel>) => Promise<unknown>,
): Promise<void> {
  if (mongoose.connection.readyState !== 1) {
    noteMissedWrite(at, "mongo_unavailable");
    return;
  }
  try {
    const model = getGranotLifecycleHealthStateModel();
    await write(model);
    const gap = missedWriteAt;
    await upsertWithRetry(() =>
      model.updateOne(
        { _id: COVERAGE_ID },
        {
          $setOnInsert: { kind: "coverage", counters_since: at },
          $max: { last_write_at: at, ...(gap ? { gap_at: gap } : {}) },
        },
        { upsert: true },
      ),
    );
    if (gap && missedWriteAt === gap) {
      missedWriteAt = null;
    }
  } catch (error) {
    noteMissedWrite(at, "write_failed", error);
    await fenceMissedWriteNow();
  }
}

/** Best effort: persists the remembered miss as the coverage `gap_at` right away. */
async function fenceMissedWriteNow(): Promise<void> {
  const gap = missedWriteAt;
  if (!gap || mongoose.connection.readyState !== 1) return;
  try {
    await getGranotLifecycleHealthStateModel().updateOne(
      { _id: COVERAGE_ID },
      { $setOnInsert: { kind: "coverage", counters_since: gap }, $max: { gap_at: gap } },
      { upsert: true },
    );
    if (missedWriteAt === gap) missedWriteAt = null;
  } catch {
    // Kept in memory; the next successful write fences it.
  }
}

async function upsertWithRetry(write: () => Promise<unknown>): Promise<void> {
  try {
    await write();
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    await write();
  }
}

export async function incrementGranotLifecycleHealthCounter(
  metric: GranotLifecycleHealthCounterMetric,
  dimension: string = ALL_DIMENSION,
  at: Date = new Date(),
): Promise<void> {
  if (!DIMENSION_PATTERN.test(dimension)) {
    return;
  }
  const start = bucketStart(at);
  await writeHealthState(at, (model) =>
    upsertWithRetry(() =>
      model.updateOne(
        { _id: bucketId(metric, dimension, start) },
        {
          $setOnInsert: {
            kind: "bucket",
            metric,
            dimension,
            bucket_start: start,
            expires_at: new Date(start.getTime() + GRANOT_LIFECYCLE_HEALTH_RETENTION_MS),
          },
          $inc: { count: 1 },
        },
        { upsert: true },
      ),
    ),
  );
}

/** Newest run wins; an older run that arrives late loses the compare-and-set. */
export async function recordGranotLifecycleLastRun(
  trigger: GranotLifecycleHealthRunTrigger,
  status: "completed" | "failed",
  at: Date = new Date(),
): Promise<void> {
  await writeHealthState(at, async (model) => {
    try {
      await model.updateOne(
        {
          _id: `last_run:${trigger}`,
          $or: [{ at: { $lt: at } }, { at: { $exists: false } }],
        },
        { $set: { kind: "last_run", trigger, status, at } },
        { upsert: true },
      );
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
    }
  });
}

export async function readGranotLifecycleLastRun(
  trigger: GranotLifecycleHealthRunTrigger,
): Promise<GranotLifecycleHealthLastRun> {
  const row = await getGranotLifecycleHealthStateModel()
    .findById(`last_run:${trigger}`)
    .lean<GranotLifecycleHealthStateDocument | null>();
  if (!row?.at || (row.status !== "completed" && row.status !== "failed")) {
    return null;
  }
  return { at: new Date(row.at).toISOString(), status: row.status };
}

export function isHealthWindowCovered(
  coverage: GranotLifecycleHealthCoverage | null,
  now: Date,
  windowMs: number,
): boolean {
  if (!coverage?.counters_since || !coverage.last_write_at) return false;
  if (now.getTime() - coverage.last_write_at.getTime() > GRANOT_LIFECYCLE_HEALTH_STALE_MS) {
    return false;
  }
  const windowStart = now.getTime() - windowMs;
  if (coverage.counters_since.getTime() > windowStart) return false;
  if (coverage.gap_at && coverage.gap_at.getTime() >= windowStart) return false;
  return true;
}

export function summarizeGranotLifecycleHealthCounters(input: {
  coverage: GranotLifecycleHealthCoverage | null;
  buckets: ReadonlyArray<Pick<GranotLifecycleHealthStateDocument, "metric" | "dimension" | "bucket_start" | "count">>;
  now: Date;
}): GranotLifecycleHealthCounters {
  const { coverage, buckets, now } = input;
  const longStart = bucketStart(new Date(now.getTime() - GRANOT_LIFECYCLE_HEALTH_LONG_WINDOW_MS));
  const claimStart = bucketStart(new Date(now.getTime() - GRANOT_LIFECYCLE_HEALTH_CLAIM_WINDOW_MS));
  let captureFailures = 0;
  let claimRecoveries = 0;
  const conflicts = new Map<string, number>();
  for (const row of buckets) {
    if (!row.bucket_start || typeof row.count !== "number") continue;
    const start = new Date(row.bucket_start).getTime();
    if (start > now.getTime()) continue;
    if (row.metric === "capture_failed" && start >= longStart.getTime()) {
      captureFailures += row.count;
    } else if (row.metric === "claim_recovered" && start >= claimStart.getTime()) {
      claimRecoveries += row.count;
    } else if (
      row.metric === "owner_command_conflict"
      && start >= longStart.getTime()
      && row.dimension
      && row.dimension !== ALL_DIMENSION
    ) {
      conflicts.set(row.dimension, (conflicts.get(row.dimension) ?? 0) + row.count);
    }
  }
  const longCovered = isHealthWindowCovered(coverage, now, GRANOT_LIFECYCLE_HEALTH_LONG_WINDOW_MS);
  const claimCovered = isHealthWindowCovered(coverage, now, GRANOT_LIFECYCLE_HEALTH_CLAIM_WINDOW_MS);
  return {
    capture_failures_24h: longCovered ? captureFailures : null,
    claim_recoveries_1h: claimCovered ? claimRecoveries : null,
    command_conflicts_24h: longCovered
      ? [...conflicts.entries()]
          .map(([code, count]) => ({ code, count }))
          .sort((a, b) => a.code.localeCompare(b.code))
      : null,
  };
}

export async function readGranotLifecycleHealthCoverage(): Promise<GranotLifecycleHealthCoverage | null> {
  const row = await getGranotLifecycleHealthStateModel()
    .findById(COVERAGE_ID)
    .lean<GranotLifecycleHealthStateDocument | null>();
  if (!row) return null;
  return {
    counters_since: row.counters_since ? new Date(row.counters_since) : null,
    last_write_at: row.last_write_at ? new Date(row.last_write_at) : null,
    gap_at: row.gap_at ? new Date(row.gap_at) : null,
  };
}

export async function readGranotLifecycleHealthCounters(
  now: Date,
): Promise<GranotLifecycleHealthCounters & { coverage: GranotLifecycleHealthCoverage | null }> {
  const since = bucketStart(new Date(now.getTime() - GRANOT_LIFECYCLE_HEALTH_LONG_WINDOW_MS));
  const [coverage, buckets] = await Promise.all([
    readGranotLifecycleHealthCoverage(),
    getGranotLifecycleHealthStateModel()
      .find({ kind: "bucket", bucket_start: { $gte: since, $lte: now } })
      .select({ _id: 0, metric: 1, dimension: 1, bucket_start: 1, count: 1 })
      .lean<Array<Pick<GranotLifecycleHealthStateDocument, "metric" | "dimension" | "bucket_start" | "count">>>(),
  ]);
  return { ...summarizeGranotLifecycleHealthCounters({ coverage, buckets, now }), coverage };
}

export async function readGranotLifecycleAlertRows(): Promise<Map<string, GranotLifecycleHealthAlertRow>> {
  const rows = await getGranotLifecycleHealthStateModel()
    .find({ kind: "alert" })
    .select({ _id: 1, state: 1, since: 1 })
    .lean<GranotLifecycleHealthStateDocument[]>();
  return new Map(
    rows
      .filter((row) => row.state === "firing" || row.state === "ok")
      .map((row) => [
        row._id,
        {
          key: row._id,
          state: row.state as "firing" | "ok",
          since: row.since ? new Date(row.since) : null,
        },
      ]),
  );
}

/**
 * Compare-and-set the alert row into firing. Returns the persisted firing
 * start and whether this caller won the transition.
 */
export async function markGranotLifecycleAlertFiring(input: {
  key: string;
  code: string;
  scope_ref?: string;
  now: Date;
}): Promise<{ transitioned: boolean; since: Date | null }> {
  const model = getGranotLifecycleHealthStateModel();
  try {
    const result = await model.updateOne(
      { _id: input.key, state: { $ne: "firing" } },
      {
        $set: {
          kind: "alert",
          code: input.code,
          state: "firing",
          since: input.now,
          transitioned_at: input.now,
          ...(input.scope_ref ? { scope_ref: input.scope_ref } : {}),
        },
      },
      { upsert: true },
    );
    if (result.modifiedCount > 0 || result.upsertedCount > 0) {
      return { transitioned: true, since: input.now };
    }
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }
  const current = await model
    .findById(input.key)
    .lean<GranotLifecycleHealthStateDocument | null>();
  return { transitioned: false, since: current?.since ? new Date(current.since) : null };
}

/** Compare-and-set the alert row from firing to ok. Returns whether this caller won. */
export async function markGranotLifecycleAlertRecovered(input: {
  key: string;
  now: Date;
}): Promise<boolean> {
  const result = await getGranotLifecycleHealthStateModel().updateOne(
    { _id: input.key, state: "firing" },
    { $set: { state: "ok", transitioned_at: input.now }, $unset: { since: "" } },
  );
  return result.modifiedCount > 0;
}

export function resetGranotLifecycleHealthStateMissedWrite(): void {
  missedWriteAt = null;
}
