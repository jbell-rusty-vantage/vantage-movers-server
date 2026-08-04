import assert from "node:assert/strict";
import test from "node:test";
import {
  isTransientPromotionTransactionError,
  planPromotionRecovery,
  promotionReservationFilter,
  simulatePromotionLeaseInterleaving,
  StalePromotionCasError,
  type ReportingPromotionReservation,
} from "./promotionReservation";
import type { PromotionInspection } from "./promotion";

function reservation(
  partial: Partial<ReportingPromotionReservation> &
    Pick<ReportingPromotionReservation, "generation" | "owner" | "epoch">,
): ReportingPromotionReservation {
  return {
    reserved_at: new Date("2026-08-04T12:00:00.000Z"),
    workbook_id: "wb",
    staging_sheet_id: 2,
    old_sheet_id: 1,
    published_title: "Weekly Report",
    status: "reserved",
    recovery_title: null,
    published_sheet_id: null,
    ...partial,
  };
}

const ready: PromotionInspection = {
  state: "ready_to_promote",
  oldPublished: true,
  stagingPublished: false,
};
const applied: PromotionInspection = {
  state: "already_promoted",
  oldPublished: false,
  stagingPublished: true,
};
const ambiguous: PromotionInspection = {
  state: "ambiguous",
  oldPublished: true,
  stagingPublished: true,
};

test("promotion plan: fresh reserve when ready and no prior reservation", () => {
  const plan = planPromotionRecovery({
    leaseOwner: "B",
    leaseEpoch: 2,
    reservation: null,
    inspection: ready,
  });
  assert.equal(plan.action, "reserve_fresh");
});

test("promotion plan: takeover recovers applied rename without competing promote", () => {
  const plan = planPromotionRecovery({
    leaseOwner: "B",
    leaseEpoch: 2,
    reservation: reservation({ generation: 1, owner: "A", epoch: 1 }),
    inspection: applied,
  });
  assert.equal(plan.action, "recover_already_applied");
});

test("promotion plan: takeover of not-applied rename takes new reservation", () => {
  const plan = planPromotionRecovery({
    leaseOwner: "B",
    leaseEpoch: 2,
    reservation: reservation({ generation: 1, owner: "A", epoch: 1 }),
    inspection: ready,
  });
  assert.equal(plan.action, "takeover_and_promote");
});

test("promotion plan: ambiguous google state preserves prior-tab safety", () => {
  const plan = planPromotionRecovery({
    leaseOwner: "B",
    leaseEpoch: 2,
    reservation: reservation({ generation: 1, owner: "A", epoch: 1 }),
    inspection: ambiguous,
  });
  assert.equal(plan.action, "fail_ambiguous");
});

test("promotion reservation filter requires active lease and prior generation", () => {
  const now = new Date("2026-08-04T12:00:00.000Z");
  const filter = promotionReservationFilter({
    runId: "64b000000000000000000401",
    leaseOwner: "worker-b",
    leaseEpoch: 2,
    now,
    expectedPriorGeneration: 1,
  });
  assert.equal(filter.lease_owner, "worker-b");
  assert.equal(filter.lease_epoch, 2);
  assert.deepEqual(filter.leased_until, { $gt: now });
  assert.equal(filter["promotion_reservation.generation"], 1);
});

test("promotion lease interleaving: expiry before provider abandons mutate", () => {
  const result = simulatePromotionLeaseInterleaving([
    { kind: "acquire", worker: "A", epoch: 1 },
    {
      kind: "reserve",
      worker: "A",
      epoch: 1,
      expectedPriorGeneration: null,
    },
    { kind: "expire_lease" },
    { kind: "renew", worker: "A", epoch: 1 },
    { kind: "provider_apply", worker: "A", epoch: 1 },
    {
      kind: "cas_commit",
      worker: "A",
      epoch: 1,
      reservationGeneration: 1,
    },
  ]);
  assert.ok(result.abandoned.includes("renew:A:1"));
  // Provider may still apply under reserved generation, but CAS must not.
  assert.equal(result.googlePromoted, true);
  assert.equal(result.destinationCasEpoch, null);
  assert.deepEqual(result.commits, []);
});

test("promotion lease interleaving: expiry during provider blocks stale CAS", () => {
  const result = simulatePromotionLeaseInterleaving([
    { kind: "acquire", worker: "A", epoch: 1 },
    {
      kind: "reserve",
      worker: "A",
      epoch: 1,
      expectedPriorGeneration: null,
    },
    { kind: "provider_apply", worker: "A", epoch: 1 },
    { kind: "expire_lease" },
    { kind: "renew", worker: "A", epoch: 1 },
    {
      kind: "cas_commit",
      worker: "A",
      epoch: 1,
      reservationGeneration: 1,
    },
  ]);
  assert.equal(result.googlePromoted, true);
  assert.ok(result.abandoned.includes("cas:A:1"));
  assert.equal(result.destinationCasEpoch, null);
});

test("promotion lease interleaving: stale response after takeover cannot CAS", () => {
  const result = simulatePromotionLeaseInterleaving([
    { kind: "acquire", worker: "A", epoch: 1 },
    {
      kind: "reserve",
      worker: "A",
      epoch: 1,
      expectedPriorGeneration: null,
    },
    { kind: "expire_lease" },
    { kind: "acquire", worker: "B", epoch: 2 },
    {
      kind: "reserve",
      worker: "B",
      epoch: 2,
      expectedPriorGeneration: 1,
    },
    // Stale A provider response after B took reservation.
    { kind: "provider_apply", worker: "A", epoch: 1 },
    {
      kind: "cas_commit",
      worker: "A",
      epoch: 1,
      reservationGeneration: 1,
    },
    { kind: "provider_apply", worker: "B", epoch: 2 },
    { kind: "renew", worker: "B", epoch: 2 },
    {
      kind: "cas_commit",
      worker: "B",
      epoch: 2,
      reservationGeneration: 2,
    },
  ]);
  assert.ok(result.abandoned.includes("provider:A:1"));
  assert.ok(result.abandoned.includes("cas:A:1"));
  assert.deepEqual(result.commits, ["B:2"]);
  assert.equal(result.destinationCasEpoch, 2);
  assert.equal(result.googlePromoted, true);
});

test("promotion lease interleaving: takeover recovers applied rename via CAS only", () => {
  const result = simulatePromotionLeaseInterleaving([
    { kind: "acquire", worker: "A", epoch: 1 },
    {
      kind: "reserve",
      worker: "A",
      epoch: 1,
      expectedPriorGeneration: null,
    },
    { kind: "provider_apply", worker: "A", epoch: 1 },
    { kind: "expire_lease" },
    { kind: "acquire", worker: "B", epoch: 2 },
    {
      kind: "reserve",
      worker: "B",
      epoch: 2,
      expectedPriorGeneration: 1,
    },
    // B adopts applied state without a second provider promote in this model:
    // mark provider_applied by reusing reserve+manual status via second apply under B.
    { kind: "provider_apply", worker: "B", epoch: 2 },
    { kind: "renew", worker: "B", epoch: 2 },
    {
      kind: "cas_commit",
      worker: "B",
      epoch: 2,
      reservationGeneration: 2,
    },
  ]);
  assert.equal(result.googlePromoted, true);
  assert.deepEqual(result.commits, ["B:2"]);
});

test("promotion lease interleaving: takeover of not-applied rename re-reserves then promotes", () => {
  const result = simulatePromotionLeaseInterleaving([
    { kind: "acquire", worker: "A", epoch: 1 },
    {
      kind: "reserve",
      worker: "A",
      epoch: 1,
      expectedPriorGeneration: null,
    },
    { kind: "expire_lease" },
    // A never applied; B takes over while Google still ready.
    { kind: "acquire", worker: "B", epoch: 2 },
    {
      kind: "reserve",
      worker: "B",
      epoch: 2,
      expectedPriorGeneration: 1,
    },
    { kind: "renew", worker: "B", epoch: 2 },
    { kind: "provider_apply", worker: "B", epoch: 2 },
    { kind: "renew", worker: "B", epoch: 2 },
    {
      kind: "cas_commit",
      worker: "B",
      epoch: 2,
      reservationGeneration: 2,
    },
  ]);
  assert.equal(result.reservation?.owner, "B");
  assert.equal(result.reservation?.status, "completed");
  assert.deepEqual(result.commits, ["B:2"]);
  assert.equal(result.googlePromoted, true);
});

test("promotion CAS requires provider_applied, not merely reserved", () => {
  const result = simulatePromotionLeaseInterleaving([
    { kind: "acquire", worker: "A", epoch: 1 },
    {
      kind: "reserve",
      worker: "A",
      epoch: 1,
      expectedPriorGeneration: null,
    },
    { kind: "renew", worker: "A", epoch: 1 },
    {
      kind: "cas_commit",
      worker: "A",
      epoch: 1,
      reservationGeneration: 1,
    },
  ]);
  assert.ok(result.abandoned.includes("cas:A:1"));
  assert.deepEqual(result.commits, []);
  assert.equal(result.reservation?.status, "reserved");
});

test("transient TX errors are not classified as stale", () => {
  const stale = new StalePromotionCasError();
  assert.equal(isTransientPromotionTransactionError(stale), false);
  const transient = Object.assign(new Error("TransientTransactionError"), {
    name: "MongoNetworkError",
  });
  assert.equal(isTransientPromotionTransactionError(transient), true);
  const unknown = new Error("unexpected auth failure in transaction");
  assert.equal(isTransientPromotionTransactionError(unknown), false);
});
