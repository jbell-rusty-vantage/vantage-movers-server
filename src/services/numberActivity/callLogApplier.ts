import { logger } from "../../logger";
import { getCallInteractionAliasModel } from "../../models/CallInteractionAlias";
import { getCallInteractionModel } from "../../models/CallInteraction";
import {
  accountIdFromProviderPath,
  ProviderAccountError,
  resolveProviderAccountId,
} from "./accountIdentity";
import {
  failureLogFields,
  quarantineErrorCode,
  type QuarantineBook,
  type QuarantineErrorCode,
} from "./callLogQuarantine";
import type { DirectoryLookup } from "./directory";
import {
  applyInteractionObservation,
  defaultRouteResolver,
  InteractionPersistenceError,
} from "./persistInteraction";
import {
  aliasesFor,
  identityFromCallLogRecord,
  type CallLogRecordInput,
} from "./interactionProjection";
import type { RouteResolver } from "./types";

/**
 * The per-record half of the Call Log reconcile, shared by the 5-minute window reconcile and the
 * staffed-hours minute ISync lane (RINGCENTRAL-CAPTURE §4). One applier lives for one run under the
 * `call_log_all_directions` lease:
 *
 * - resolves the provider account (never fabricated), the directory and the route resolver once;
 * - skips records whose stored row already holds that provider version (CC-02);
 * - applies the rest oldest-first through `applyInteractionObservation`;
 * - counts failures into the run's `QuarantineBook` so one bad record never holds a window (CC-01);
 * - remembers every `call_interactions` row a non-noop apply touched, so the caller can wake the
 *   Sales Outreach Desk for exactly those rows after the batch committed.
 */
export type CallLogApplierErrorCode = "account_unresolved" | "account_mismatch" | "unknown_error";

export type CallLogApplyOutcome =
  | { ok: true; noop: boolean }
  | { ok: false; quarantined: boolean; code: QuarantineErrorCode };

export type CallLogBatchCounts = {
  upserts: number;
  noops: number;
  failures: number;
  quarantined: number;
  /** First failure of the batch: a `CallLogApplierErrorCode` or `projection_failed`. Callers widen it. */
  error_code: string | null;
};

/** A `call_interactions` row whose stored projection changed in this run (input for the desk wake). */
export type TouchedInteraction = { interaction_id: string; projection_revision: number | null; merged_into: string | null };

export type CallLogApplierInput = {
  now: () => Date;
  apply: typeof applyInteractionObservation;
  directory: (accountId: string) => Promise<DirectoryLookup>;
  resolveRoute?: RouteResolver;
  configuredAccountId: string | null;
  settleHorizonMinutes: number;
  book: QuarantineBook;
  /** Lease renewal on a clock; throws when the lease is lost. */
  renew: () => Promise<void>;
  requestId: string;
  ownerHash: string;
  /** Log message prefix, e.g. `sales_intelligence.call_log_reconcile`. */
  logPrefix: string;
  /** Called once per newly quarantined record. */
  onNewlyQuarantined?: (code: QuarantineErrorCode, errorName: string) => void;
  unchanged?: typeof unchangedRecords;
};

export type CallLogApplier = ReturnType<typeof createCallLogApplier>;

export function createCallLogApplier(input: CallLogApplierInput) {
  let accountId: string | null = null;
  let directory: DirectoryLookup | null = null;
  let resolveRoute = input.resolveRoute;
  let providerWatermark: Date | null = null;
  /** Call Log ids this run already applied or attempted; by-id reads skip them. */
  const attempted = new Set<string>();
  /**
   * Ids that failed in this run. A record in both the rolling window and a gap
   * repair is attempted once: a failure counts once per run toward quarantine.
   */
  const failedThisRun = new Map<string, QuarantineErrorCode>();
  const touched = new Map<string, TouchedInteraction>();
  const unchanged = input.unchanged ?? unchangedRecords;

  /** Resolves the provider account (never fabricated), the directory and the route resolver once per run. */
  const ensureContext = async (records: readonly CallLogRecordInput[]): Promise<CallLogApplierErrorCode | null> => {
    try {
      accountId ??= resolveProviderAccountId(
        records.map((r) => accountIdFromProviderPath(str(r.uri))),
        input.configuredAccountId,
      );
    } catch (error) {
      return error instanceof ProviderAccountError ? error.code : "unknown_error";
    }
    directory ??= await input.directory(accountId);
    resolveRoute ??= await defaultRouteResolver();
    return null;
  };

  const applyOne = async (record: CallLogRecordInput): Promise<CallLogApplyOutcome> => {
    await input.renew();
    const id = str(record.id);
    const earlier = id ? failedThisRun.get(id) : undefined;
    if (id && earlier) return { ok: false, quarantined: input.book.isQuarantined(id), code: earlier };
    if (id) attempted.add(id);
    try {
      const applied = await input.apply(
        accountId!,
        { kind: "call_log", record, proof_ref: `call_log:${id ?? "unknown"}`, source: "call_log_reconcile" },
        {
          now: input.now,
          directory: directory!,
          resolveRoute,
          request_id: input.requestId,
          settleHorizonMinutes: input.settleHorizonMinutes,
        },
      );
      if (id) input.book.recordSuccess(id);
      const modified = dateOf(record.lastModifiedTime);
      if (modified && (!providerWatermark || modified > providerWatermark)) providerWatermark = modified;
      if (!applied.noop) {
        touched.set(applied.interaction_id, {
          interaction_id: applied.interaction_id,
          projection_revision: applied.projection_revision,
          merged_into: null,
        });
        for (const merged of applied.merged_interaction_ids ?? []) {
          touched.set(merged, { interaction_id: merged, projection_revision: null, merged_into: applied.interaction_id });
        }
      }
      return { ok: true, noop: applied.noop };
    } catch (error) {
      const code = quarantineErrorCode(error);
      logger.warn({
        msg: `${input.logPrefix}.record_failed`,
        leaseOwnerHash: input.ownerHash,
        ...failureLogFields(error),
        errorCode: error instanceof InteractionPersistenceError ? error.code : code,
      });
      if (!id) return { ok: false, quarantined: false, code };
      failedThisRun.set(id, code);
      const outcome = input.book.recordFailure(
        {
          call_log_id: id,
          telephony_session_id: str(record.telephonySessionId),
          start_time: startOf(record),
          error_code: code,
          error_name: failureLogFields(error).errorName,
        },
        input.now(),
      );
      if (outcome === "newly_quarantined") input.onNewlyQuarantined?.(code, failureLogFields(error).errorName);
      return { ok: false, quarantined: outcome !== "counted", code };
    }
  };

  /** Oldest-first projection of one fetched batch with the per-row skip and quarantine. */
  const applyBatch = async (records: readonly CallLogRecordInput[], counts: CallLogBatchCounts): Promise<void> => {
    const contextError = await ensureContext(records);
    if (contextError) {
      counts.error_code ??= contextError;
      return;
    }
    // Oldest-first so earlier evidence lands before later callbacks.
    const ordered = [...records].sort(
      (a, b) => (startOf(a)?.getTime() ?? Number.POSITIVE_INFINITY) - (startOf(b)?.getTime() ?? Number.POSITIVE_INFINITY),
    );
    const skip = await unchanged(ordered, accountId!);
    const at = input.now();
    for (const record of ordered) {
      if (skip.has(record)) {
        // Its own stored row already holds this provider version (or a newer
        // one) and every provider identity it carries resolves to that row,
        // so re-projecting it could only rediscover `noop: true` after
        // opening a transaction (14 §4, CC-02).
        counts.noops += 1;
        continue;
      }
      const id = str(record.id);
      if (id && input.book.isHeld(id, at)) {
        // Quarantined and not yet due: its hourly retry handles it and it
        // does not hold this window (CC-01).
        counts.quarantined += 1;
        continue;
      }
      const outcome = await applyOne(record);
      if (outcome.ok) {
        if (outcome.noop) counts.noops += 1;
        else counts.upserts += 1;
        continue;
      }
      counts.failures += 1;
      if (outcome.quarantined) counts.quarantined += 1;
      else counts.error_code ??= outcome.code === "account_mismatch" ? "account_mismatch" : "projection_failed";
    }
  };

  /** Records the shadow comparison would change (records whose stored row is not already this version). */
  const countChanged = async (records: readonly CallLogRecordInput[]): Promise<number> => {
    if (await ensureContext(records)) return records.length;
    return records.length - (await unchanged(records, accountId!)).size;
  };

  return {
    ensureContext,
    applyOne,
    applyBatch,
    countChanged,
    attempted,
    failedThisRun,
    /** Rows touched so far, in apply order. */
    touched: () => [...touched.values()],
    /** Forgets the touched rows (after the caller woke the desk for them). */
    clearTouched: () => touched.clear(),
    providerWatermark: () => providerWatermark,
  };
}

export function emptyBatchCounts(): CallLogBatchCounts {
  return { upserts: 0, noops: 0, failures: 0, quarantined: 0, error_code: null };
}

type InteractionSkipRow = {
  _id: unknown;
  provider_last_modified_at?: Date | null;
  call_log_state?: string | null;
  merged_into_id?: unknown;
};

/**
 * CC-02: records this run can prove cannot change their stored row, with two
 * queries for the whole batch instead of one transaction per record.
 *
 * A record is unchanged only when **every** alias it carries resolves to one
 * canonical row, its `lastModifiedTime` is at or before **that row's**
 * `provider_last_modified_at`, and the row is not provisional. The previous
 * skip compared against the run-wide maximum `lastModifiedTime` of *other*
 * records, so a final version that became visible after a later-modified
 * record was applied could be skipped forever (F6).
 *
 * `call_log_state` is read raw and may be absent; absent is not provisional.
 */
export async function unchangedRecords(
  records: readonly CallLogRecordInput[],
  accountId: string,
): Promise<Set<CallLogRecordInput>> {
  const unchanged = new Set<CallLogRecordInput>();
  type Alias = ReturnType<typeof aliasesFor>[number];
  const keysByRecord = new Map<CallLogRecordInput, { keys: string[]; modified: Date }>();
  const wanted = new Map<string, Alias>();
  for (const record of records) {
    const modified = dateOf(record.lastModifiedTime);
    if (!modified) continue;
    let aliases: Alias[];
    try {
      aliases = aliasesFor(identityFromCallLogRecord(record));
    } catch {
      continue;
    }
    if (!aliases.length) continue;
    keysByRecord.set(record, { keys: aliases.map((a) => `${a.kind}:${a.value}`), modified });
    for (const alias of aliases) wanted.set(`${alias.kind}:${alias.value}`, alias);
  }
  if (!wanted.size) return unchanged;
  const aliasRows = await getCallInteractionAliasModel()
    .find(
      {
        provider: "ringcentral",
        provider_account_id: accountId,
        $or: [...wanted.values()].map((a) => ({ kind: a.kind, value: a.value })),
      },
      { kind: 1, value: 1, interaction_id: 1 },
    )
    .lean();
  const interactionByKey = new Map<string, unknown>();
  for (const row of aliasRows) interactionByKey.set(`${row.kind}:${row.value}`, row.interaction_id);

  // Canonical rows, following `merged_into_id` (rare) with at most a few extra reads.
  const rows = new Map<string, InteractionSkipRow>();
  let pending = [...new Map([...interactionByKey.values()].map((id) => [String(id), id])).values()];
  const collection = getCallInteractionModel().collection;
  for (let hop = 0; pending.length && hop < 4; hop += 1) {
    const found = (await collection
      .find(
        { _id: { $in: pending as never[] } },
        { projection: { provider_last_modified_at: 1, call_log_state: 1, merged_into_id: 1 } },
      )
      .toArray()) as unknown as InteractionSkipRow[];
    pending = [];
    for (const row of found) {
      rows.set(String(row._id), row);
      if (row.merged_into_id && !rows.has(String(row.merged_into_id))) pending.push(row.merged_into_id);
    }
  }
  const canonicalOf = (id: unknown): InteractionSkipRow | null => {
    let row = rows.get(String(id)) ?? null;
    for (let hop = 0; row?.merged_into_id && hop < 8; hop += 1) row = rows.get(String(row.merged_into_id)) ?? null;
    return row && !row.merged_into_id ? row : null;
  };

  for (const [record, { keys, modified }] of keysByRecord) {
    let canonical: InteractionSkipRow | null = null;
    let single = true;
    for (const key of keys) {
      const row = interactionByKey.has(key) ? canonicalOf(interactionByKey.get(key)) : null;
      if (!row || (canonical && String(canonical._id) !== String(row._id))) {
        single = false;
        break;
      }
      canonical = row;
    }
    if (!single || !canonical) continue;
    if (canonical.call_log_state === "provisional") continue;
    const stored = canonical.provider_last_modified_at;
    if (!(stored instanceof Date) || modified > stored) continue;
    unchanged.add(record);
  }
  return unchanged;
}

export function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function dateOf(value: unknown): Date | null {
  const s = str(value);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function startOf(record: CallLogRecordInput): Date | null {
  return dateOf(record.startTime);
}
