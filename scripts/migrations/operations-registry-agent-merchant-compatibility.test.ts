import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  advanceAgentMerchantResumeCursor,
  agentMigrationUpdateFilter,
  buildAgentMerchantCompatibilityManifest,
  buildAgentMerchantCompatibilityPlan,
  type AgentMerchantCompatibilitySnapshot,
} from "./operations-registry-agent-merchant-compatibility.lib";
import {
  assertMigrationDatabaseAllowed,
  HISTORICAL_DATABASE,
  PRODUCTION_CONFIRMATION,
  PRODUCTION_DATABASE,
  TEST_DATABASE,
} from "./operations-registry-migration.lib";

const baseSnapshot = (): AgentMerchantCompatibilitySnapshot => ({
  agents: [
    {
      id: "agent-1",
      name: "Mike M",
      active: true,
      granot_crm_username: "mikem",
      name_aliases: [],
    },
    {
      id: "agent-2",
      name: "Jacob",
      active: true,
      granot_identity: {
        username: "JACOB",
        verified: true,
      },
      granot_crm_username: "JACOB",
      name_aliases: ["jacob b"],
    },
  ],
  merchants: [
    {
      id: "merchant-1",
      name: "Stripe",
      name_aliases: [],
    },
    {
      id: "merchant-2",
      name: "PayPal",
    },
  ],
});

test("M2 copies normalized flat username to nested identity without inventing verified_at", () => {
  const plan = buildAgentMerchantCompatibilityPlan(baseSnapshot());
  const update = plan.agents.find((entry) => entry.agent_id === "agent-1");

  assert.equal(update?.action, "update_identity");
  assert.equal(update?.planned_identity?.username, "MIKEM");
  assert.equal(update?.planned_identity?.verified, true);
  assert.equal(update?.planned_identity?.verified_at, undefined);

  const updateDoc = agentMigrationUpdateFilter(update!);
  const identity = (updateDoc?.$set as { granot_identity?: Record<string, unknown> } | undefined)
    ?.granot_identity;
  assert.deepEqual(identity, {
    username: "MIKEM",
    verified: true,
  });
});

test("M2 preserves existing verified_at when present and keeps flat field untouched", () => {
  const snapshot = baseSnapshot();
  snapshot.agents[0].granot_identity = {
    verified_at: "2026-01-15T10:00:00.000Z",
  };

  const plan = buildAgentMerchantCompatibilityPlan(snapshot);
  const update = plan.agents.find((entry) => entry.agent_id === "agent-1");

  assert.equal(update?.planned_identity?.verified_at, "2026-01-15T10:00:00.000Z");
  assert.equal(update?.flat_username, "MIKEM");
});

test("M2 initializes missing Agent aliases in the same pass as nested identity", () => {
  const snapshot = baseSnapshot();
  snapshot.agents[0].name_aliases = null;

  const plan = buildAgentMerchantCompatibilityPlan(snapshot);
  const update = plan.agents.find((entry) => entry.agent_id === "agent-1");
  const updateDoc = agentMigrationUpdateFilter(update!);

  assert.equal(update?.action, "update_identity");
  assert.equal(update?.initialize_aliases, true);
  assert.deepEqual(
    (updateDoc?.$set as { name_aliases?: string[] } | undefined)?.name_aliases,
    [],
  );
});

test("M2 noop when nested identity already matches flat username", () => {
  const plan = buildAgentMerchantCompatibilityPlan(baseSnapshot());
  const jacob = plan.agents.find((entry) => entry.agent_id === "agent-2");
  assert.equal(jacob?.action, "noop");
});

test("M2 detects duplicate configured usernames as blocking collisions", () => {
  const snapshot = baseSnapshot();
  snapshot.agents.push({
    id: "agent-3",
    name: "Mike Clone",
    active: true,
    granot_crm_username: "MIKEM",
    name_aliases: [],
  });

  const plan = buildAgentMerchantCompatibilityPlan(snapshot);
  assert.ok(
    plan.collisions.some(
      (collision) =>
        collision.code === "agent_granot_username_collision" &&
        collision.severity === "blocking",
    ),
  );
});

test("M2 flags flat and embedded username mismatch as blocking", () => {
  const snapshot = baseSnapshot();
  snapshot.agents[0].granot_identity = { username: "OTHER" };

  const plan = buildAgentMerchantCompatibilityPlan(snapshot);
  assert.ok(
    plan.collisions.some((collision) => collision.code === "agent_granot_identity_flat_mismatch"),
  );
});

test("M2 initializes merchant alias arrays only when missing", () => {
  const plan = buildAgentMerchantCompatibilityPlan(baseSnapshot());
  const stripe = plan.merchants.find((entry) => entry.merchant_id === "merchant-1");
  const paypal = plan.merchants.find((entry) => entry.merchant_id === "merchant-2");

  assert.equal(stripe?.action, "noop");
  assert.equal(paypal?.action, "init_aliases");
});

test("M2 manifest checksum is stable for unchanged input", () => {
  const snapshot = baseSnapshot();
  const plan = buildAgentMerchantCompatibilityPlan(snapshot);
  const first = buildAgentMerchantCompatibilityManifest({
    snapshot,
    plan,
    databaseName: TEST_DATABASE,
    mode: "dry_run",
    runId: "run-a",
    startedAt: "2026-07-29T12:00:00.000Z",
    completedAt: "2026-07-29T12:00:01.000Z",
  });
  const second = buildAgentMerchantCompatibilityManifest({
    snapshot,
    plan,
    databaseName: TEST_DATABASE,
    mode: "dry_run",
    runId: "run-b",
    startedAt: "2026-07-29T13:00:00.000Z",
    completedAt: "2026-07-29T13:00:01.000Z",
  });

  assert.equal(first.mapping_checksum, second.mapping_checksum);
  assert.equal(first.validation_summary.booking_snapshots_untouched, true);
  assert.equal(first.validation_summary.receiver_matching_parity, true);
});

test("M2 resume cursor skips already completed records", () => {
  const snapshot = baseSnapshot();
  const firstPass = buildAgentMerchantCompatibilityPlan(snapshot);
  const cursor = advanceAgentMerchantResumeCursor(firstPass.resume_cursor, ["agent-1"], []);
  const resumed = buildAgentMerchantCompatibilityPlan(snapshot, cursor);

  assert.ok(!resumed.agents.some((entry) => entry.agent_id === "agent-1"));
  assert.ok(resumed.agents.some((entry) => entry.agent_id === "agent-2"));
});

test("M2 database guard rejects historical and unknown databases", () => {
  assert.doesNotThrow(() => assertMigrationDatabaseAllowed(TEST_DATABASE, []));
  assert.throws(
    () => assertMigrationDatabaseAllowed(HISTORICAL_DATABASE, []),
    /historical database/,
  );
  assert.throws(
    () => assertMigrationDatabaseAllowed(PRODUCTION_DATABASE, []),
    /confirm-production-db/,
  );
  assert.doesNotThrow(() =>
    assertMigrationDatabaseAllowed(PRODUCTION_DATABASE, [PRODUCTION_CONFIRMATION]),
  );
  assert.throws(
    () => assertMigrationDatabaseAllowed("staging-db", []),
    /unknown database/,
  );
});

test("M2 CLI defaults to dry run and uses production apply guards", () => {
  const cliSource = readFileSync(
    path.join(process.cwd(), "scripts/migrations/operations-registry-agent-merchant-compatibility.ts"),
    "utf8",
  );
  assert.match(cliSource, /isMigrationApplyRequested/);
  assert.match(cliSource, /assertMigrationApplyAuthorized/);
  assert.match(cliSource, /assertMigrationDatabaseAllowed/);
  assert.doesNotMatch(cliSource, /BookedLead/);
});
