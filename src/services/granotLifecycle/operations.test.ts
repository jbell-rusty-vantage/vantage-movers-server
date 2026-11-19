import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { GRANOT_LIFECYCLE_ERROR_CODES } from "./errors";
import {
  durableActorFromOwnerActor,
  requeueDeadLetterReceipt,
  type RequeueCommandDeps,
  type RequeueProvenanceInput,
} from "./operations";
import type { RegistryActorContext } from "../operationsRegistry/types";

const OWNER: RegistryActorContext = {
  actorType: "owner",
  actorId: "owner-1",
  actorLabel: "Owner",
  actorRole: "owner",
  requestId: "req-activation-test",
};

const ADMIN: RegistryActorContext = {
  ...OWNER,
  actorRole: "admin",
  requestId: "req-activation-admin",
};


function memoryRequeue(existing?: {
  state: "dead_letter" | "completed" | "claimed" | "pending";
  match_attempt?: number;
  payload_sha256?: string;
  channel_operation_id?: string;
}): RequeueCommandDeps & {
  provenance: RequeueProvenanceInput[];
  currentState: () => string;
} {
  const receiptId = new mongoose.Types.ObjectId();
  let state = existing?.state ?? "dead_letter";
  const match_attempt = existing?.match_attempt ?? 4;
  const payload_sha256 = existing?.payload_sha256 ?? "b".repeat(64);
  const channel_operation_id = existing?.channel_operation_id ?? "synthetic-op-1";
  let manual_requeue_count = 0;
  const provenance: RequeueProvenanceInput[] = [];
  const sessions: unknown[] = [];
  return {
    provenance,
    currentState: () => state,
    now: () => new Date("2026-08-17T18:00:00.000Z"),
    findReceipt: async () =>
      existing
        ? {
            _id: receiptId,
            processing: { state, match_attempt, manual_requeue_count },
            payload_sha256,
            channel_operation_id,
          }
        : null,
    transitionDeadLetter: async (_id, _now, session) => {
      sessions.push(session);
      if (state !== "dead_letter") {
        return null;
      }
      state = "pending";
      manual_requeue_count += 1;
      return {
        _id: receiptId,
        processing: {
          state: "pending",
          match_attempt,
          next_attempt_at: new Date("2026-08-17T18:00:00.000Z"),
          manual_requeue_count,
        },
        payload_sha256,
        channel_operation_id,
      };
    },
    persistRequeueProvenance: async (input, session) => {
      assert.equal(session, sessions.at(-1), "provenance shares the transition session");
      provenance.push(input);
    },
    withTransaction: async (fn) => {
      const snapshot = { state, manual_requeue_count, provenance: provenance.length };
      const session = { id: Symbol("session") };
      try {
        return await fn(session as never);
      } catch (error) {
        state = snapshot.state;
        manual_requeue_count = snapshot.manual_requeue_count;
        provenance.length = snapshot.provenance;
        throw error;
      }
    },
  };
}

test("[AC-37] Owner requeue moves dead_letter to pending without replacing evidence", async () => {
  const deps = memoryRequeue({
    state: "dead_letter",
    match_attempt: 4,
    payload_sha256: "c".repeat(64),
    channel_operation_id: "synthetic-channel-op",
  });
  const result = await requeueDeadLetterReceipt(
    { id: new mongoose.Types.ObjectId().toHexString(), reason: "Owner requeue of synthetic dead letter" },
    OWNER,
    deps,
  );
  assert.equal(result.state, "pending");
  assert.equal(result.match_attempt, 4);
  assert.equal(result.payload_sha256, "c".repeat(64));
  assert.equal(result.channel_operation_id, "synthetic-channel-op");
  assert.equal(result.manual_requeue_count, 1);
  assert.equal(deps.provenance.length, 1);
  assert.equal(deps.provenance[0]?.reason, "Owner requeue of synthetic dead letter");
  assert.equal(deps.provenance[0]?.actor.actor_id, OWNER.actorId);
  assert.equal(deps.provenance[0]?.actor.actor_role, "owner");
  assert.equal(deps.provenance[0]?.priorState, "dead_letter");
  assert.equal(deps.provenance[0]?.newState, "pending");
  assert.equal(deps.provenance[0]?.manual_requeue_count, 1);
});

test("[AC-37] requeue provenance failure aborts the receipt transition in the same transaction", async () => {
  const deps = memoryRequeue({ state: "dead_letter" });
  deps.persistRequeueProvenance = async () => { throw new Error("provenance unavailable"); };
  await assert.rejects(
    () =>
      requeueDeadLetterReceipt(
        { id: new mongoose.Types.ObjectId().toHexString(), reason: "Owner requeue during provenance outage" },
        OWNER,
        deps,
      ),
    /provenance unavailable/,
  );
  assert.equal(deps.currentState(), "dead_letter");
  assert.equal(deps.provenance.length, 0);
});

test("[AC-37] Admin without Owner cannot requeue", () => {
  assert.throws(
    () => durableActorFromOwnerActor(ADMIN),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error as { code: string }).code === GRANOT_LIFECYCLE_ERROR_CODES.OWNER_REQUIRED,
  );
});
