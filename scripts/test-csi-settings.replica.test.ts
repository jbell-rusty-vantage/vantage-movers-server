import assert from "node:assert/strict";
import { test } from "node:test";
import express, { type Request } from "express";
import mongoose from "mongoose";
import { connectMongo } from "../src/db";
import { getMongoDatabaseName } from "../src/config/domain/runtime";
import { applyCsiMigration } from "./migrations/sales-intelligence.lib";
import { computeAdminActorSignature } from "../src/services/operationsRegistry/trustedActor";
import { requireCsiOwner, type CsiActor } from "../src/services/salesIntelligence/auth";
import { defaultCsiPolicy } from "../src/services/salesIntelligence/policy";
import { commandCsiSettings, readCsiSettings } from "../src/services/salesIntelligence/settings";
import { readOwnerCoverage } from "../src/services/salesIntelligence/ownerCoverage";
import { getSalesIntelligencePolicyPointerModel } from "../src/models/SalesIntelligencePolicyPointer";
import { getSalesIntelligenceAiBudgetModel } from "../src/models/SalesIntelligenceAiBudget";
import { getSalesIntelligenceJobModel } from "../src/models/SalesIntelligenceJob";
import { getContactNumberModel } from "../src/models/ContactNumber";

const enabled = process.env.CSI_REPLICA_TEST === "true";
test("CSI-09 isolated replica: honest coverage and versioned settings", { skip: !enabled, timeout: 120_000 }, async (t) => {
  assert.equal(process.env.TEST_MODE, "true");
  assert.match(getMongoDatabaseName(), /^testvantagemovers_csi09[a-z0-9]+$/);
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET = "synthetic-owner-signature";
  const actorRequest: Request = Object.assign(Object.create(express.request), {
    method: "PATCH",
    originalUrl: "/api/v1/admin/sales-intelligence/settings",
    headers: {},
    vantageAuth: { kind: "user", userId: "synthetic-owner", email: "owner@example.test", roles: ["owner"] },
  });
  const fields = {
    adminId: "synthetic-owner",
    email: "owner@example.test",
    role: "owner",
    timestamp: String(Date.now()),
    requestId: "csi09",
    method: "PATCH",
    path: "/api/v1/admin/sales-intelligence/settings",
  };
  actorRequest.headers = {
    "x-vantage-admin-user-id": fields.adminId,
    "x-vantage-admin-email": fields.email,
    "x-vantage-admin-role": fields.role,
    "x-vantage-admin-timestamp": fields.timestamp,
    "x-vantage-admin-request-id": fields.requestId,
    "x-vantage-admin-signature": computeAdminActorSignature(fields, process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET),
  };
  const actor: CsiActor = requireCsiOwner(actorRequest);
  try {
    await applyCsiMigration();
    await t.test("GET settings does not persist; coverage keeps unknown distinct from zero", async () => {
      assert.equal(await getSalesIntelligencePolicyPointerModel().countDocuments(), 0);
      const before = await readCsiSettings();
      assert.equal(before.persisted, false);
      assert.equal(before.source, "accepted_defaults");
      assert.equal(before.policy.first_action_due_staffed_minutes, 45);
      assert.equal(before.flags.STT_ENABLED, false);
      assert.equal(await getSalesIntelligencePolicyPointerModel().countDocuments(), 0);
      const coverage = await readOwnerCoverage();
      assert.equal(coverage.known_through, null);
      assert.equal(coverage.capabilities.call_log, "unknown");
      assert.equal(coverage.capabilities.recording_content, "unknown");
      assert.equal(coverage.budget.status, "unknown");
      assert.equal(coverage.budget.actual_cents, null);
      assert.equal(coverage.budget.remaining_cents, null);
      assert.equal(coverage.mapping_hygiene.directory_status, "missing");
      assert.equal(coverage.mapping_hygiene.unmapped_directory_users, null);
      assert.equal(coverage.stages.transcription.oldest_queued_at, null);
      assert.equal(coverage.backfill.available, false);
      assert.equal(coverage.settings.source, "accepted_defaults");
    });
    await t.test("first persist writes env bootstraps then Owner edit wins; later env is ignored", async () => {
      const policy = { ...defaultCsiPolicy(), first_action_due_staffed_minutes: 20, monthly_ceiling_cents: 9000 };
      const first = await commandCsiSettings({
        actor,
        idempotency_key: "csi09-first",
        command: { command: "update_settings", expected_revision: 1, policy, reason: "Owner accepted defaults" },
      });
      assert.equal(first.replayed, false);
      const stored = await readCsiSettings();
      assert.equal(stored.persisted, true);
      assert.equal(stored.policy.first_action_due_staffed_minutes, 20);
      assert.equal(stored.policy.monthly_ceiling_cents, 9000);
      process.env.SALES_INTELLIGENCE_FIRST_ACTION_DUE_STAFFED_MINUTES = "99";
      const second = await commandCsiSettings({
        actor,
        idempotency_key: "csi09-second",
        command: {
          command: "update_settings",
          expected_revision: stored.revision,
          policy: { ...stored.policy, missed_callback_due_staffed_minutes: 12 },
          reason: "Owner shortened missed callback",
        },
      });
      assert.equal(second.replayed, false);
      const after = await readCsiSettings();
      assert.equal(after.policy.first_action_due_staffed_minutes, 20);
      assert.equal(after.policy.missed_callback_due_staffed_minutes, 12);
      const replay = await commandCsiSettings({
        actor,
        idempotency_key: "csi09-second",
        command: {
          command: "update_settings",
          expected_revision: stored.revision,
          policy: { ...stored.policy, missed_callback_due_staffed_minutes: 12 },
          reason: "Owner shortened missed callback",
        },
      });
      assert.equal(replay.replayed, true);
    });
    await t.test("known budget remaining and queued age stay explicit", async () => {
      const now = new Date();
      await getSalesIntelligenceAiBudgetModel().create({
        month: "2026-09",
        ceiling_cents: 8000,
        reserved_cents: 300,
        actual_cents: 500,
        policy_version: "csi-policy-v1",
        timezone: "America/New_York",
        period_start: new Date(now.getTime() - 86400000),
        period_end: new Date(now.getTime() + 86400000),
        activated_at: now,
      });
      await getSalesIntelligenceJobModel().create({
        dedupe_key: "csi:transcription:synthetic",
        payload_hash: "synthetic",
        stage: "transcription",
        subject_key: "conversation:synthetic",
        input_revision: 1,
        deployment: "csi-local-proof",
        database: getMongoDatabaseName(),
        status: "pending",
        next_attempt_at: new Date("2026-09-18T08:00:00.000Z"),
      });
      await getContactNumberModel().create({
        e164: "+12025550199",
        digits_reversed: "9910552021",
        kind: "external",
        classification: "customer",
        first_observed_at: now,
        last_activity_at: now,
        rollups: { interactions_total: 1, inbound_total: 1, outbound_total: 0, human_conversations_total: 0, attached_lead_count: 0, candidate_lead_count: 0, open_outreach_count: 0 },
      });
      const coverage = await readOwnerCoverage();
      assert.equal(coverage.budget.status, "known");
      assert.equal(coverage.budget.actual_cents, 500);
      assert.equal(coverage.budget.reserved_cents, 300);
      assert.equal(coverage.budget.remaining_cents, 7200);
      assert.equal(coverage.stages.transcription.pending, 1);
      assert.equal(coverage.stages.transcription.oldest_queued_at, "2026-09-18T08:00:00.000Z");
      assert.equal(coverage.mapping_hygiene.unmapped_inbound_numbers, 1);
    });
  } finally {
    if (/^testvantagemovers_csi09[a-z0-9]+$/.test(db.databaseName)) {
      await db.dropDatabase().catch(() => undefined);
    }
    await mongoose.disconnect();
  }
});
