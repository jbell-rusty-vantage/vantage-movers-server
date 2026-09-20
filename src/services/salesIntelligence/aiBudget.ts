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
};
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
      const budget = await Budget.updateOne(
        {
          month: input.month,
          $expr: {
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
      const { kind: _kind, ...record } = input;
      const [reservation] = await Reservations.create(
        [{ ...record, status: "reserved", reserved_at: new Date() }],
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
    const totals = await getSalesIntelligenceAiBudgetModel().updateOne(
      { month: row.month, reserved_cents: { $gte: row.estimated_cents } },
      {
        $inc: {
          reserved_cents: -row.estimated_cents,
          actual_cents: actualCents,
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

/** Budget headroom returned; analysis/STT jobs paused for admission stay on their saved stage. */
export async function resumeBudgetPausedJobs(now = new Date(), session?: ClientSession) {
  const active = await getSalesIntelligenceAiBudgetModel().exists({ period_start: { $lte: now }, period_end: { $gt: now },
    activated_at: { $ne: null }, $expr: { $lt: [{ $add: ["$actual_cents", "$reserved_cents"] }, "$ceiling_cents"] } }).session(session ?? null);
  if (!active) return { modifiedCount: 0 };
  const filter = { ...csiDataset(), status: "paused" as const, reason: "budget_exhausted" as const };
  const update = { $set: { status: "pending" as const, reason: null, next_attempt_at: now } };
  const Jobs = getSalesIntelligenceJobModel();
  if (session) return Jobs.updateMany(filter, update, { session });
  return Jobs.updateMany(filter, update);
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
