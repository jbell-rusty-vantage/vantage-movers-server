import type { ClientSession } from "mongoose";
import mongoose from "mongoose";
import { withTransaction } from "../../db";
import { ReportingDestination } from "../../models/ReportingDestination";
import { ReportingDelivery } from "../../models/ReportingDelivery";
import { ReportingRun } from "../../models/ReportingRun";
import type { PromotionInspection } from "./promotion";

function asObjectId(id: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(id);
}

export type PromotionReservationStatus =
  | "reserved"
  | "provider_applied"
  | "completed";

export type ReportingPromotionReservation = {
  generation: number;
  owner: string;
  epoch: number;
  reserved_at: Date;
  workbook_id: string;
  staging_sheet_id: number;
  old_sheet_id: number;
  published_title: string;
  status: PromotionReservationStatus;
  recovery_title: string | null;
  published_sheet_id: number | null;
};

export type PromotionRecoveryPlan =
  | { action: "reserve_fresh" }
  | { action: "adopt_already_promoted" }
  | { action: "reuse_own_reservation"; reservation: ReportingPromotionReservation }
  | {
      action: "takeover_and_promote";
      prior: ReportingPromotionReservation;
    }
  | {
      action: "recover_already_applied";
      prior: ReportingPromotionReservation | null;
    }
  | { action: "complete_cas_only"; reservation: ReportingPromotionReservation }
  | { action: "fail_ambiguous"; reason: string };

/**
 * Decide promotion next step from persisted reservation + Google inspection.
 * Never blindly issues competing promote when a prior reservation exists.
 */
export function planPromotionRecovery(input: {
  leaseOwner: string;
  leaseEpoch: number;
  reservation: ReportingPromotionReservation | null | undefined;
  inspection: PromotionInspection;
}): PromotionRecoveryPlan {
  const prior = input.reservation ?? null;
  if (!prior) {
    if (
      input.inspection.state === "ready_to_promote" ||
      input.inspection.state === "staging_still_hidden"
    ) {
      return { action: "reserve_fresh" };
    }
    if (input.inspection.state === "already_promoted") {
      // Crash between Google apply and persistence: adopt by IDs, then CAS.
      return { action: "adopt_already_promoted" };
    }
    return { action: "fail_ambiguous", reason: "inspection_ambiguous" };
  }

  const ownsReservation =
    prior.owner === input.leaseOwner && prior.generation === input.leaseEpoch;

  if (ownsReservation) {
    if (prior.status === "provider_applied" || prior.status === "completed") {
      return { action: "complete_cas_only", reservation: prior };
    }
    if (input.inspection.state === "already_promoted") {
      return { action: "recover_already_applied", prior };
    }
    if (
      input.inspection.state === "ready_to_promote" ||
      input.inspection.state === "staging_still_hidden"
    ) {
      return { action: "reuse_own_reservation", reservation: prior };
    }
    return { action: "fail_ambiguous", reason: "own_reservation_ambiguous" };
  }

  // Prior owner/epoch differs — inspect/recover by immutable IDs.
  if (input.inspection.state === "already_promoted") {
    return { action: "recover_already_applied", prior };
  }
  if (
    input.inspection.state === "ready_to_promote" ||
    input.inspection.state === "staging_still_hidden"
  ) {
    // Old Google state unchanged; prior owner gone (we hold lease) → new reservation.
    return { action: "takeover_and_promote", prior };
  }
  return {
    action: "fail_ambiguous",
    reason: "prior_reservation_ambiguous_google_state",
  };
}

export function promotionReservationFilter(input: {
  runId: string;
  leaseOwner: string;
  leaseEpoch: number;
  now: Date;
  expectedPriorGeneration: number | null;
}): Record<string, unknown> {
  const filter: Record<string, unknown> = {
    _id: asObjectId(input.runId),
    lease_owner: input.leaseOwner,
    lease_epoch: input.leaseEpoch,
    leased_until: { $gt: input.now },
  };
  if (input.expectedPriorGeneration === null) {
    filter.$or = [
      { promotion_reservation: null },
      { "promotion_reservation.generation": input.leaseEpoch },
    ];
  } else {
    filter["promotion_reservation.generation"] = input.expectedPriorGeneration;
  }
  return filter;
}

export async function writePromotionReservationUnderLease(input: {
  runId: string;
  leaseOwner: string;
  leaseEpoch: number;
  now: Date;
  expectedPriorGeneration: number | null;
  reservation: Omit<
    ReportingPromotionReservation,
    "generation" | "owner" | "epoch" | "reserved_at"
  > &
    Partial<
      Pick<
        ReportingPromotionReservation,
        "generation" | "owner" | "epoch" | "reserved_at"
      >
    >;
}): Promise<ReportingPromotionReservation | null> {
  const reservation: ReportingPromotionReservation = {
    generation: input.leaseEpoch,
    owner: input.leaseOwner,
    epoch: input.leaseEpoch,
    reserved_at: input.now,
    workbook_id: input.reservation.workbook_id,
    staging_sheet_id: input.reservation.staging_sheet_id,
    old_sheet_id: input.reservation.old_sheet_id,
    published_title: input.reservation.published_title,
    status: input.reservation.status,
    recovery_title: input.reservation.recovery_title ?? null,
    published_sheet_id: input.reservation.published_sheet_id ?? null,
  };
  const updated = await ReportingRun.collection.findOneAndUpdate(
    promotionReservationFilter(input),
    { $set: { promotion_reservation: reservation } },
    { returnDocument: "after" },
  );
  if (!updated) return null;
  return updated.promotion_reservation as ReportingPromotionReservation;
}

export async function markPromotionReservationProviderApplied(input: {
  runId: string;
  leaseOwner: string;
  leaseEpoch: number;
  now: Date;
  recoveryTitle: string;
  publishedSheetId: number;
}): Promise<boolean> {
  const result = await ReportingRun.collection.updateOne(
    {
      _id: asObjectId(input.runId),
      lease_owner: input.leaseOwner,
      lease_epoch: input.leaseEpoch,
      leased_until: { $gt: input.now },
      "promotion_reservation.generation": input.leaseEpoch,
      "promotion_reservation.status": "reserved",
    },
    {
      $set: {
        "promotion_reservation.status": "provider_applied",
        "promotion_reservation.recovery_title": input.recoveryTitle,
        "promotion_reservation.published_sheet_id": input.publishedSheetId,
      },
    },
  );
  return result.matchedCount === 1;
}

/** Conditional CAS predicates failed under the attempted generation/version. */
export class StalePromotionCasError extends Error {
  readonly code = "STALE_PROMOTION_CAS" as const;
  constructor(message = "STALE_PROMOTION_CAS") {
    super(message);
    this.name = "StalePromotionCasError";
  }
}

/**
 * Commit destination managed-sheet CAS + authoritative promotion completion
 * in one Mongo transaction conditioned on active run lease/fence/reservation
 * and destination expected predecessor sheet id + version.
 */
export async function commitPromotionDestinationCas(input: {
  runId: string;
  leaseOwner: string;
  leaseEpoch: number;
  now: Date;
  reservationGeneration: number;
  destinationId: string;
  expectedOldSheetId: number;
  expectedDestinationVersion: number;
  nextSheetId: number;
  publishedTitle: string;
  deliverySet: Record<string, unknown>;
  finalDataChecksum: string;
  session?: ClientSession;
}): Promise<"committed" | "stale"> {
  const commitOnce = async (session: ClientSession): Promise<"committed"> => {
    const runUpdated = await ReportingRun.collection.findOneAndUpdate(
      {
        _id: asObjectId(input.runId),
        status: "promoting",
        lease_owner: input.leaseOwner,
        lease_epoch: input.leaseEpoch,
        leased_until: { $gt: input.now },
        delivery_fence_generation: input.leaseEpoch,
        delivery_fence_owner: input.leaseOwner,
        "promotion_reservation.generation": input.reservationGeneration,
        "promotion_reservation.status": "provider_applied",
      },
      {
        $set: {
          status: "completed",
          completed_at: input.now,
          final_data_checksum: input.finalDataChecksum.toLowerCase(),
          "promotion_reservation.status": "completed",
          "promotion_reservation.published_sheet_id": input.nextSheetId,
        },
      },
      { session, returnDocument: "after" },
    );
    if (!runUpdated) {
      throw new StalePromotionCasError();
    }

    const destinationUpdated = await ReportingDestination.collection.findOneAndUpdate(
      {
        _id: asObjectId(input.destinationId),
        state: "active",
        strategy: "replace_tab",
        version: input.expectedDestinationVersion,
        "managed_tab.immutable_sheet_id": input.expectedOldSheetId,
      },
      {
        $set: {
          "managed_tab.immutable_sheet_id": input.nextSheetId,
          "managed_tab.name": input.publishedTitle,
          access_status: "verified",
          health_verified_at: input.now,
          denylist_checked_at: input.now,
          updated_at: input.now,
        },
        $addToSet: {
          "managed_tab.predecessor_sheet_ids": input.expectedOldSheetId,
        },
        $inc: { version: 1 },
      },
      { session, returnDocument: "after" },
    );
    if (!destinationUpdated) {
      // Idempotent resume: managed sheet already advanced with predecessor recorded.
      const already = await ReportingDestination.collection.findOne(
        {
          _id: asObjectId(input.destinationId),
          state: "active",
          strategy: "replace_tab",
          "managed_tab.immutable_sheet_id": input.nextSheetId,
          "managed_tab.predecessor_sheet_ids": input.expectedOldSheetId,
        },
        { session },
      );
      if (!already) {
        throw new StalePromotionCasError();
      }
    }

    const deliveryUpdated = await ReportingDelivery.collection.updateOne(
      {
        run_id: asObjectId(input.runId),
        fence_owner: input.leaseOwner,
        fence_epoch: input.leaseEpoch,
        fence_generation: input.leaseEpoch,
      },
      {
        $set: {
          ...input.deliverySet,
          updated_at: input.now,
        },
      },
      { session },
    );
    if (deliveryUpdated.matchedCount !== 1) {
      throw new StalePromotionCasError();
    }
    return "committed";
  };

  if (input.session) {
    try {
      return await commitOnce(input.session);
    } catch (error) {
      if (error instanceof StalePromotionCasError) return "stale";
      throw error;
    }
  }
  try {
    return await withTransaction((session) => commitOnce(session));
  } catch (error) {
    if (error instanceof StalePromotionCasError) return "stale";
    // Do not swallow arbitrary TX failures as stale — caller retries or classifies.
    throw error;
  }
}

/** Mongo/transient transaction failures that may be retried under an active lease. */
export function isTransientPromotionTransactionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error instanceof StalePromotionCasError) return false;
  const name = error.name;
  if (
    name === "MongoNetworkError" ||
    name === "MongoNetworkTimeoutError" ||
    name === "MongoServerSelectionError" ||
    name === "MongooseServerSelectionError" ||
    name === "MongoTemporaryUnavailableError" ||
    name === "MongoWriteConcernError"
  ) {
    return true;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes("transienttransactionerror") ||
    message.includes("unknowntransactioncommitresult") ||
    message.includes("writelocktimeout") ||
    message.includes("temporarily unavailable") ||
    message.includes("connection") ||
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("not primary") ||
    message.includes("interrupted due to server step down")
  );
}

/**
 * Deterministic interleaving across Google latency / lease expiry.
 * Models reservation → provider → renew → CAS commit; stale epochs never CAS.
 */
export function simulatePromotionLeaseInterleaving(
  events: Array<
    | { kind: "acquire"; worker: string; epoch: number }
    | { kind: "expire_lease" }
    | {
        kind: "reserve";
        worker: string;
        epoch: number;
        expectedPriorGeneration: number | null;
      }
    | { kind: "provider_apply"; worker: string; epoch: number }
    | { kind: "renew"; worker: string; epoch: number }
    | {
        kind: "cas_commit";
        worker: string;
        epoch: number;
        reservationGeneration: number;
      }
  >,
): {
  leaseOwner: string | null;
  leaseEpoch: number | null;
  leaseActive: boolean;
  reservation: ReportingPromotionReservation | null;
  googlePromoted: boolean;
  destinationCasEpoch: number | null;
  commits: string[];
  abandoned: string[];
} {
  let leaseOwner: string | null = null;
  let leaseEpoch: number | null = null;
  let leaseActive = false;
  let reservation: ReportingPromotionReservation | null = null;
  let googlePromoted = false;
  let destinationCasEpoch: number | null = null;
  const commits: string[] = [];
  const abandoned: string[] = [];

  for (const event of events) {
    if (event.kind === "acquire") {
      leaseOwner = event.worker;
      leaseEpoch = event.epoch;
      leaseActive = true;
      continue;
    }
    if (event.kind === "expire_lease") {
      leaseActive = false;
      continue;
    }
    if (event.kind === "reserve") {
      if (
        !leaseActive ||
        leaseOwner !== event.worker ||
        leaseEpoch !== event.epoch
      ) {
        abandoned.push(`reserve:${event.worker}:${event.epoch}`);
        continue;
      }
      if (event.expectedPriorGeneration === null) {
        if (reservation && reservation.generation !== event.epoch) {
          abandoned.push(`reserve:${event.worker}:${event.epoch}`);
          continue;
        }
      } else if (
        !reservation ||
        reservation.generation !== event.expectedPriorGeneration
      ) {
        abandoned.push(`reserve:${event.worker}:${event.epoch}`);
        continue;
      }
      reservation = {
        generation: event.epoch,
        owner: event.worker,
        epoch: event.epoch,
        reserved_at: new Date(0),
        workbook_id: "wb",
        staging_sheet_id: 2,
        old_sheet_id: 1,
        published_title: "Published",
        status: "reserved",
        recovery_title: null,
        published_sheet_id: null,
      };
      continue;
    }
    if (event.kind === "provider_apply") {
      // Provider may still mutate after lease expiry; Google state persists.
      if (
        reservation?.owner === event.worker &&
        reservation.generation === event.epoch &&
        reservation.status === "reserved"
      ) {
        googlePromoted = true;
        reservation = {
          ...reservation,
          status: "provider_applied",
          published_sheet_id: 2,
          recovery_title: "recovery",
        };
      } else {
        // Competing/blind promote not modeled as success.
        abandoned.push(`provider:${event.worker}:${event.epoch}`);
      }
      continue;
    }
    if (event.kind === "renew") {
      if (
        !leaseActive ||
        leaseOwner !== event.worker ||
        leaseEpoch !== event.epoch
      ) {
        abandoned.push(`renew:${event.worker}:${event.epoch}`);
      }
      continue;
    }
    if (event.kind === "cas_commit") {
      if (
        !leaseActive ||
        leaseOwner !== event.worker ||
        leaseEpoch !== event.epoch ||
        reservation?.generation !== event.reservationGeneration ||
        reservation.status !== "provider_applied"
      ) {
        abandoned.push(`cas:${event.worker}:${event.epoch}`);
        continue;
      }
      destinationCasEpoch = event.epoch;
      reservation = { ...reservation, status: "completed" };
      commits.push(`${event.worker}:${event.epoch}`);
    }
  }

  return {
    leaseOwner,
    leaseEpoch,
    leaseActive,
    reservation,
    googlePromoted,
    destinationCasEpoch,
    commits,
    abandoned,
  };
}
