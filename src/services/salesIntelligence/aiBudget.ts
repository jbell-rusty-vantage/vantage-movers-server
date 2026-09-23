import { withTransaction } from "../../db";
import {
  getSalesIntelligenceAiBudgetModel,
  SALES_INTELLIGENCE_AI_BUDGET_INDEXES,
} from "../../models/SalesIntelligenceAiBudget";
import {
  getSalesIntelligenceAiReservationModel,
  SALES_INTELLIGENCE_AI_RESERVATION_INDEXES,
} from "../../models/SalesIntelligenceAiReservation";
import { CsiError } from "./auth";
import { assertIndexes, duplicateKey } from "./transactions";
import { csiIdSchema } from "../../validation/v1/salesIntelligence";
import { csiDataset } from "../../config/domain/salesIntelligence";
import { getSalesIntelligenceJobModel } from "../../models/SalesIntelligenceJob";
import type { ClientSession } from "mongoose";
export type ReservationInput = {
  reservation_id: string;
  month: string;
  job_id: string;
  run_id: string | null;
  step: string;
  stage: "transcription" | "analysis";
  estimated_cents: number;
  kind?: "stt";
  /** Structured model steps may start while there is headroom; admitted repairs finish. */
  soft_stop?: boolean;
  /** `personal`: spend on an operator's own gateway key. Recorded per run, never reserved against or added to the Owner's monthly ceiling. */
  ledger?: "owner" | "personal";
};
/** Process-local: an in-process backfill on PERSONAL_AI_GATEWAY_API_KEY sets this so its steps book to the personal ledger. Never set in production. */
export const personalLedger = () => process.env.SALES_INTELLIGENCE_PERSONAL_LEDGER === "true";
export const currentLedger = (): "owner" | "personal" => (personalLedger() ? "personal" : "owner");
export async function reserveCsiBudget(input: ReservationInput) {
  if (input.kind && input.stage !== "transcription") throw new CsiError("INVALID_INPUT");
  csiIdSchema.parse(input.job_id);
  if (input.run_id) csiIdSchema.parse(input.run_id);
  if (
    !Number.isSafeInteger(input.estimated_cents) ||
    input.estimated_cents < 0 ||
    !input.reservation_id ||
    !input.step
  )
    throw new CsiError("INVALID_INPUT");
  const Budget = getSalesIntelligenceAiBudgetModel();
  const Reservations = getSalesIntelligenceAiReservationModel();
  await assertIndexes(Budget.collection, SALES_INTELLIGENCE_AI_BUDGET_INDEXES);
  await assertIndexes(
    Reservations.collection,
    SALES_INTELLIGENCE_AI_RESERVATION_INDEXES,
  );
  const check = (row: {
    month: string;
    job_id: { toString(): string };
    run_id?: { toString(): string } | null;
    step: string;
    stage: string;
    estimated_cents: number;
  }) => {
    if (
      row.month !== input.month ||
      String(row.job_id) !== input.job_id ||
      (row.run_id ? String(row.run_id) : null) !== input.run_id ||
      row.step !== input.step ||
      row.stage !== input.stage ||
      row.estimated_cents !== input.estimated_cents
    )
      throw new CsiError("IDEMPOTENCY_CONFLICT");
    return row;
  };
  try {
    return await withTransaction(async (session) => {
      const prior = await Reservations.findOne({
        reservation_id: input.reservation_id,
      }).session(session);
      if (prior) return check(prior);
      const ledger = input.ledger ?? "owner";
      const budget = ledger === "personal" ? { matchedCount: 1, modifiedCount: 1 } : await Budget.updateOne(
        {
          month: input.month,
          $expr: input.soft_stop ? { $lt: [{ $add: ["$actual_cents", "$reserved_cents"] }, "$ceiling_cents"] } : {
            $lte: [
              {
                $add: [
                  "$actual_cents",
                  "$reserved_cents",
                  input.estimated_cents,
                ],
              },
              "$ceiling_cents",
            ],
          },
        },
        { $inc: { reserved_cents: input.estimated_cents } },
        { session },
      );
      if (budget.modifiedCount !== 1 && input.estimated_cents !== 0)
        throw new CsiError("BUDGET_EXHAUSTED");
      if (budget.matchedCount !== 1) throw new CsiError("BUDGET_EXHAUSTED");
      const { kind: _kind, soft_stop: _softStop, ...record } = input;
      const [reservation] = await Reservations.create(
        [{ ...record, ledger, status: "reserved", reserved_at: new Date() }],
        { session },
      );
      return reservation;
    });
  } catch (error) {
    if (duplicateKey(error)) {
      const prior = await Reservations.findOne({
        reservation_id: input.reservation_id,
      });
      if (prior) return check(prior);
      throw new CsiError("IDEMPOTENCY_CONFLICT");
    }
    throw error;
  }
}
export async function reconcileCsiBudget(
  reservationId: string,
  actualCents: number,
  release = false,
  session?: ClientSession,
) {
  if (
    !Number.isSafeInteger(actualCents) ||
    actualCents < 0 ||
    (release && actualCents !== 0)
  )
    throw new CsiError("INVALID_INPUT");
  const reconcile = async (session: ClientSession) => {
    const Reservations = getSalesIntelligenceAiReservationModel();
    const row = await Reservations.findOne({
      reservation_id: reservationId,
    }).session(session);
    if (!row) throw new CsiError("INVALID_INPUT");
    const status = release ? "released" : "reconciled";
    if (row.status !== "reserved") {
      if (row.status !== status || row.actual_cents !== actualCents)
        throw new CsiError("IDEMPOTENCY_CONFLICT");
      return;
    }
    const updated = await Reservations.updateOne(
      { _id: row._id, status: "reserved" },
      {
        $set: { status, actual_cents: actualCents, reconciled_at: new Date() },
      },
      { session },
    );
    if (updated.modifiedCount !== 1) throw new CsiError("REVISION_CONFLICT");
    if (row.ledger === "personal") return; // Personal spend never moves the Owner's ceiling.
    const totals = await getSalesIntelligenceAiBudgetModel().updateOne(
      { month: row.month, reserved_cents: { $gte: row.estimated_cents } },
      {
        $inc: {
          reserved_cents: -row.estimated_cents,
          actual_cents: actualCents - (row.settled_cents ?? 0),
        },
      },
      { session },
    );
    if (totals.matchedCount !== 1) throw new CsiError("REVISION_CONFLICT");
  };
  if (session) {
    if (!session.inTransaction()) throw new CsiError("INVALID_INPUT");
    return reconcile(session);
  }
  return withTransaction(reconcile);
}

/**
 * A reservation is held until its invocation reports what it actually spent. A
 * function killed mid-invocation reports nothing, so its estimate stays
 * subtracted from the monthly ceiling forever: production reached 59 stranded
 * analysis reservations holding $11.10, which is what paused 377 analysis jobs
 * with `budget_exhausted` (22 §1, measured in 23 §0).
 *
 * Raising the function limit removes the common cause; it cannot remove the
 * case, because any limit can be exceeded. This sweep is the durable answer.
 * It only touches a reservation whose job is demonstrably not running — no
 * live lease — and only after a grace period far longer than the gap between
 * a worker releasing its lease and running its own reconciliation, so it never
 * races the owning invocation.
 *
 * What it books is deliberately conservative and honest: a provider that never
 * started is released at zero, and a started one is reconciled at the cents its
 * steps actually reported. That can under-count a kill between the last step
 * and the response, which is why the row keeps `usage_complete: false` and
 * stays visible in the reservation report rather than being silently trusted.
 */
export const STRANDED_RESERVATION_GRACE_MS = 1_800_000;
export async function recoverStrandedCsiReservations(now = new Date(), limit = 25) {
  const Reservations = getSalesIntelligenceAiReservationModel();
  const rows = await Reservations.find({
    status: "reserved",
    reserved_at: { $lte: new Date(now.getTime() - STRANDED_RESERVATION_GRACE_MS) },
  }).sort({ reserved_at: 1 }).limit(limit).lean();
  let released = 0, reconciled = 0, cents = 0;
  for (const row of rows) {
    const running = await getSalesIntelligenceJobModel().exists({
      _id: row.job_id, status: "leased", leased_until: { $gt: now },
    });
    if (running) continue;
    const settled = row.provider_started ? Math.max(0, Math.trunc(row.observed_cents)) : 0;
    try {
      await reconcileCsiBudget(row.reservation_id, settled, !row.provider_started);
    } catch (error) {
      // `IDEMPOTENCY_CONFLICT`: the owning invocation reconciled between this
      // read and this write, and its accounting wins. `REVISION_CONFLICT`: the
      // period row no longer holds this estimate as reserved, which is a real
      // inconsistency — the row is deliberately left `reserved` and visible in
      // the reservation report rather than force-settled to make the sweep
      // look clean, and the next sweep tries it again.
      if (error instanceof CsiError && ["IDEMPOTENCY_CONFLICT", "REVISION_CONFLICT"].includes(error.code)) continue;
      throw error;
    }
    if (row.provider_started) {
      reconciled++;
      cents += settled;
      await Reservations.updateOne({ reservation_id: row.reservation_id }, { $set: { usage_complete: false } });
    } else released++;
  }
  return { released, reconciled, recovered_cents: cents };
}

/** Budget headroom returned; analysis/STT jobs paused for admission stay on their saved stage. */
/**
 * Ids collected for wake-ups by a resume. The resume itself stays unbounded so
 * a large paused backlog is released in one write; only the messages are
 * bounded, and a job released without one is claimed by the recovery cron on
 * its next pass (22 §3).
 */
export const CSI_WAKEUP_PUBLISH_LIMIT = 100;
export async function resumeBudgetPausedJobs(now = new Date(), session?: ClientSession) {
  const active = await getSalesIntelligenceAiBudgetModel().exists({ period_start: { $lte: now }, period_end: { $gt: now },
    activated_at: { $ne: null }, $expr: { $lt: [{ $add: ["$actual_cents", "$reserved_cents"] }, "$ceiling_cents"] } }).session(session ?? null);
  if (!active) return { modifiedCount: 0, job_ids: [] as string[] };
  const filter = { ...csiDataset(), status: "paused" as const, reason: "budget_exhausted" as const };
  const update = { $set: { status: "pending" as const, reason: null, next_attempt_at: now } };
  const Jobs = getSalesIntelligenceJobModel();
  const job_ids = (await Jobs.find(filter, { _id: 1 }).sort({ _id: 1 }).limit(CSI_WAKEUP_PUBLISH_LIMIT)
    .session(session ?? null).lean()).map(row => String(row._id));
  const result = session ? await Jobs.updateMany(filter, update, { session }) : await Jobs.updateMany(filter, update);
  return { modifiedCount: result.modifiedCount, job_ids };
}

/** Period boundaries are computed by Team C's timezone clock, never by browser scope. */
export async function initializeCsiBudgetPeriod(input: {
  month: string;
  policy_version: string;
  ceiling_cents: number;
  timezone: string;
  period_start: Date;
  period_end: Date;
}, now = new Date()) {
  if (
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month) ||
    !Number.isSafeInteger(input.ceiling_cents) ||
    input.ceiling_cents < 0 ||
    !(input.period_start < input.period_end)
  )
    throw new CsiError("INVALID_INPUT");
  const Budget = getSalesIntelligenceAiBudgetModel();
  await assertIndexes(Budget.collection, SALES_INTELLIGENCE_AI_BUDGET_INDEXES);
  const initialize = () =>
    withTransaction(async (session) => {
      const row = await Budget.findOneAndUpdate(
        { month: input.month },
        { $setOnInsert: { ...input, actual_cents: 0, reserved_cents: 0 } },
        { session, upsert: true, returnDocument: "after", runValidators: true },
      );
      if (
        !row ||
        row.period_start.getTime() !== input.period_start.getTime() ||
        row.period_end.getTime() !== input.period_end.getTime() ||
        row.timezone !== input.timezone
      )
        throw new CsiError("IDEMPOTENCY_CONFLICT");
      if (
        !row.activated_at &&
        row.period_start <= now &&
        row.period_end > now
      ) {
        const activated = await Budget.updateOne(
          { _id: row._id, activated_at: null },
          { $set: { activated_at: now } },
          { session },
        );
        if (activated.modifiedCount !== 1)
          throw new CsiError("REVISION_CONFLICT");
        if (row.actual_cents + row.reserved_cents < row.ceiling_cents)
          await resumeBudgetPausedJobs(now, session);
        row.activated_at = now;
      }
      return row;
    });
  try {
    return await initialize();
  } catch (error) {
    if (duplicateKey(error)) return initialize();
    throw error;
  }
}
