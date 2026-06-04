import {
  getSheetSyncBudgets,
  type SheetSyncQuotaOpClass,
} from "../../../config/domain";
import { SheetSyncQuotaBucket } from "../../../models/SheetSyncQuotaBucket";

/**
 * Minimal slice of the quota-bucket model the limiter needs. Declared as an
 * interface so tests can inject an in-memory fake without a live Mongo.
 */
export type QuotaBucketStore = {
  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options: Record<string, unknown>,
  ): Promise<{ count: number } | null> | { count: number } | null;
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
  ): Promise<unknown> | unknown;
};

export type QuotaReservation = {
  granted: boolean;
  remaining: number;
};

/**
 * Mongo-backed per-minute token bucket for Google Sheets requests.
 *
 * The drainer reserves tokens before issuing Sheets calls and *defers* work
 * (re-queues the job for a later minute) instead of sleeping when the budget is
 * exhausted, so a single serverless invocation never blocks on quota. The
 * binding constraint for a single service account is the per-user limit, so
 * reservations are tracked under the `user` scope by default.
 */
export class QuotaLimiter {
  private readonly store: QuotaBucketStore;
  private readonly scope: string;
  private readonly readBudget: number;
  private readonly writeBudget: number;

  constructor(options?: {
    store?: QuotaBucketStore;
    scope?: string;
    readBudget?: number;
    writeBudget?: number;
  }) {
    const budgets = getSheetSyncBudgets();
    this.store = options?.store ?? (SheetSyncQuotaBucket as unknown as QuotaBucketStore);
    this.scope = options?.scope ?? "user";
    this.readBudget = options?.readBudget ?? budgets.readsPerMinute;
    this.writeBudget = options?.writeBudget ?? budgets.writesPerMinute;
  }

  private budgetFor(opClass: SheetSyncQuotaOpClass): number {
    return opClass === "read" ? this.readBudget : this.writeBudget;
  }

  private static currentWindowStart(now = Date.now()): Date {
    return new Date(Math.floor(now / 60_000) * 60_000);
  }

  /**
   * Atomically reserves `count` tokens of `opClass` for the current minute.
   * Returns `granted: false` (and rolls the increment back) when the
   * reservation would exceed the budget.
   */
  async reserve(
    opClass: SheetSyncQuotaOpClass,
    count = 1,
  ): Promise<QuotaReservation> {
    if (count <= 0) {
      return { granted: true, remaining: this.budgetFor(opClass) };
    }
    const budget = this.budgetFor(opClass);
    const windowStart = QuotaLimiter.currentWindowStart();
    const filter = { scope: this.scope, op_class: opClass, window_start: windowStart };
    const doc = await this.store.findOneAndUpdate(
      filter,
      { $inc: { count }, $setOnInsert: filter },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    const after = doc?.count ?? count;
    if (after > budget) {
      await this.store.updateOne(filter, { $inc: { count: -count } });
      return { granted: false, remaining: Math.max(0, budget - (after - count)) };
    }
    return { granted: true, remaining: budget - after };
  }
}
