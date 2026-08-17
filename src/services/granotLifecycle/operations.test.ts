import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { GRANOT_LIFECYCLE_ERROR_CODES } from "./errors";
import {
  activateGranotLifecycle,
  durableActorFromOwnerActor,
  projectActivation,
  type ActivationCommandDeps,
} from "./operations";
import { getGranotLifecycleActivationsTotal, resetGranotLifecycleMetrics } from "./metrics";
import type { RegistryActorContext } from "../operationsRegistry/types";
import {
  getGranotLifecycleActivationModel,
  type GranotLifecycleActivationDocument,
} from "../../models/GranotLifecycleActivation";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { connectMongo } from "../../db";

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

function memoryActivation(existing?: GranotLifecycleActivationDocument | null): ActivationCommandDeps & {
  stored: GranotLifecycleActivationDocument[];
  audits: GranotLifecycleActivationDocument[];
} {
  const stored: GranotLifecycleActivationDocument[] = existing ? [existing] : [];
  const audits: GranotLifecycleActivationDocument[] = [];
  let draft: GranotLifecycleActivationDocument | null = null;
  return {
    stored,
    audits,
    now: () => new Date("2026-08-17T16:00:00.000Z"),
    findActivation: async () => stored[0] ?? draft,
    persistActivation: async (document) => {
      if (stored[0]) {
        const error = new Error("duplicate") as Error & { code: number };
        error.code = 11000;
        throw error;
      }
      draft = document;
    },
    persistAudit: async (document) => {
      audits.push(document);
    },
    withTransaction: async (fn) => {
      try {
        const result = await fn({} as never);
        if (draft) {
          stored.push(draft);
          draft = null;
        }
        return result;
      } catch (error) {
        draft = null;
        throw error;
      }
    },
  };
}

test("[AC-31] foundation Owner activation is write-once and returns a safe projection", async () => {
  resetGranotLifecycleMetrics();
  const deps = memoryActivation();
  const created = await activateGranotLifecycle(
    {
      reason: "Synthetic activation for local classification proof",
      processor_version: "granot-lifecycle-processor-v1",
    },
    OWNER,
    deps,
  );
  assert.equal(created.key, "granot_lifecycle");
  assert.equal(created.processor_version, "granot-lifecycle-processor-v1");
  assert.equal("reason" in created, false);
  assert.equal("activated_by" in created, false);
  assert.equal(deps.audits.length, 1);
  assert.equal(getGranotLifecycleActivationsTotal(), 1);
  await assert.rejects(
    () =>
      activateGranotLifecycle(
        {
          reason: "Synthetic activation retry must not edit the row",
          processor_version: "granot-lifecycle-processor-v1",
        },
        OWNER,
        deps,
      ),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error as { code: string }).code === GRANOT_LIFECYCLE_ERROR_CODES.ALREADY_ACTIVATED,
  );
});

test("[AC-31] foundation Admin without Owner cannot activate", () => {
  assert.throws(
    () => durableActorFromOwnerActor(ADMIN),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error as { code: string }).code === GRANOT_LIFECYCLE_ERROR_CODES.OWNER_REQUIRED,
  );
});

test("[AC-31] foundation audit failure aborts activation", async () => {
  const deps = memoryActivation();
  deps.persistAudit = async () => {
    throw new Error("audit unavailable");
  };
  await assert.rejects(
    () =>
      activateGranotLifecycle(
        {
          reason: "Synthetic activation for local classification proof",
          processor_version: "granot-lifecycle-processor-v1",
        },
        OWNER,
        deps,
      ),
    /audit unavailable/,
  );
  assert.equal(deps.stored.length, 0);
});

test("[AC-31] foundation replica-set concurrent activation has one winner", async (t) => {
  if (process.env.GRANOT_LIFECYCLE_REPLICA_TESTS !== "true") {
    t.skip("Replica-set proof is opt-in via GRANOT_LIFECYCLE_REPLICA_TESTS=true.");
    return;
  }
  if (getMongoDatabaseName() !== "testvantagemovers") {
    t.skip("Replica-set proof requires TEST_MODE=true before process start.");
    return;
  }
  await connectMongo();
  if (mongoose.connection.db?.databaseName !== "testvantagemovers") {
    t.skip("Refusing replica-set proof against a non-test database.");
    return;
  }
  const hello = await mongoose.connection.db?.admin().command({ hello: 1 });
  if (!hello || hello.setName == null) {
    t.skip("Connected Mongo is not a replica set.");
    return;
  }
  const Activation = getGranotLifecycleActivationModel();
  await Activation.deleteMany({ key: "granot_lifecycle" });
  const first = activateGranotLifecycle(
    {
      reason: "Synthetic activation winner for concurrent proof",
      processor_version: "granot-lifecycle-processor-v1",
    },
    { ...OWNER, requestId: `req-activation-win-${Date.now()}` },
  );
  const second = activateGranotLifecycle(
    {
      reason: "Synthetic activation loser for concurrent proof",
      processor_version: "granot-lifecycle-processor-v1",
    },
    { ...OWNER, requestId: `req-activation-lose-${Date.now()}` },
  );
  const results = await Promise.allSettled([first, second]);
  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(await Activation.countDocuments({ key: "granot_lifecycle" }), 1);
});

test("[AC-35] portion activation projection omits reason and actor PII", () => {
  const projected = projectActivation({
    _id: new mongoose.Types.ObjectId(),
    key: "granot_lifecycle",
    activated_at: new Date("2026-08-17T16:00:00.000Z"),
    activated_by: {
      actor_type: "owner",
      actor_id: "owner-1",
      actor_label: "owner@example.invalid",
      actor_role: "owner",
      request_id: "req-1",
      origin: "vantage_admin",
    },
    reason: "do-not-project-this-reason",
    processor_version: "granot-lifecycle-processor-v1",
    createdAt: new Date("2026-08-17T16:00:00.000Z"),
  });
  const serialized = JSON.stringify(projected);
  assert.equal(serialized.includes("do-not-project-this-reason"), false);
  assert.equal(serialized.includes("owner@example.invalid"), false);
  assert.equal(serialized.includes("activated_by"), false);
});
