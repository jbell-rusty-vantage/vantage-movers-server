import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  assertInventoryDatabaseAllowed,
  assertNoApplyFlag,
  buildOperationsRegistryInventoryManifest,
  collectInventoryCollisions,
  computeInventoryChecksum,
  HISTORICAL_DATABASE,
  PRODUCTION_CONFIRMATION,
  PRODUCTION_DATABASE,
  redactInventoryManifestForOutput,
  STATIC_AUTHORITY_REFERENCES,
  TEST_DATABASE,
  type InventorySnapshot,
} from "./operations-registry-inventory.lib";

const baseSnapshot = (): InventorySnapshot => ({
  agents: [
    {
      id: "agent-1",
      name: "Mike M",
      normalized_name: "mike m",
      active: true,
      granot_crm_username: "MIKEM",
      name_aliases: [],
    },
  ],
  merchants: [
    {
      id: "merchant-1",
      name: "Stripe",
      normalized_name: "stripe",
      active: true,
      name_aliases: [],
    },
  ],
  sourceCompanies: [
    {
      id: "company-1",
      company_slug: "tbm_leads",
      name: "TBM Leads",
      owner_label: "TBM Leads",
      aliases: [],
      active: true,
      default_form_granularity_key: "tbm_forms",
      default_call_granularity_key: "tbm_inbounds",
      granularities: [
        {
          id: "gran-1",
          company_slug: "tbm_leads",
          company_id: "company-1",
          granularity_key: "tbm_forms",
          channel: "form",
          owner_label: "TBM Forms",
          crm_label: "TBM Forms",
          aliases: [],
          active: true,
          cpl: 190,
          source_sites: [],
          inbound_phone_numbers: [],
          priority: 0,
        },
        {
          id: "gran-2",
          company_slug: "tbm_leads",
          company_id: "company-1",
          granularity_key: "tbm_inbounds",
          channel: "call",
          owner_label: "10best Inbounds",
          crm_label: "10best Inbounds",
          aliases: [],
          active: true,
          cpl: 190,
          source_sites: [],
          inbound_phone_numbers: ["+18883164387"],
          priority: 0,
        },
      ],
    },
  ],
  cplRates: [
    {
      label: "TBM Forms",
      source_company: "tbm_leads",
      lead_type: "form",
      cpl: 190,
    },
    {
      label: "10best Inbounds",
      source_company: "tbm_leads",
      lead_type: "call",
      cpl: 190,
    },
  ],
  formLeadCounts: [
    {
      source_company: "tbm_leads",
      source_granularity_key: "tbm_forms",
      cpl: 190,
      count: 3,
    },
  ],
  callLeadCounts: [
    {
      source_company: "tbm_leads",
      source_granularity_key: "tbm_inbounds",
      cpl: 190,
      count: 2,
    },
  ],
  bookedLeadMerchantSnapshots: [{ normalized: "stripe", count: 1 }],
});

test("inventory output redacts workbook and secret-like values", () => {
  const manifest = buildOperationsRegistryInventoryManifest({
    snapshot: baseSnapshot(),
    databaseName: TEST_DATABASE,
    runId: "redaction-test",
    startedAt: "2026-07-29T12:00:00.000Z",
    completedAt: "2026-07-29T12:00:01.000Z",
  });
  const source = manifest.inventory.source_companies[0];
  if (source) {
    source.sheet_config = {
      ...source.sheet_config,
      has_bad_tabs: source.sheet_config?.has_bad_tabs ?? false,
      spreadsheet_id: "private-workbook-id",
    };
  }

  const redacted = redactInventoryManifestForOutput(manifest);
  assert.equal(
    redacted.inventory.source_companies[0]?.sheet_config?.spreadsheet_id,
    "[redacted]",
  );
});

test("assertNoApplyFlag rejects apply flags", () => {
  assert.throws(
    () => assertNoApplyFlag(["node", "script", "--apply"]),
    /--apply/,
  );
  assert.throws(
    () => assertNoApplyFlag(["node", "script", "--production-apply"]),
    /--production-apply/,
  );
  assert.doesNotThrow(() => assertNoApplyFlag(["node", "script"]));
});

test("assertInventoryDatabaseAllowed allows test fixtures and guarded production", () => {
  assert.doesNotThrow(() =>
    assertInventoryDatabaseAllowed(TEST_DATABASE, []),
  );
  assert.throws(
    () => assertInventoryDatabaseAllowed(HISTORICAL_DATABASE, []),
    /historical database/,
  );
  assert.throws(
    () => assertInventoryDatabaseAllowed(PRODUCTION_DATABASE, []),
    /confirm-production-db/,
  );
  assert.doesNotThrow(() =>
    assertInventoryDatabaseAllowed(PRODUCTION_DATABASE, [PRODUCTION_CONFIRMATION]),
  );
  assert.throws(
    () => assertInventoryDatabaseAllowed("staging-db", []),
    /unknown database/,
  );
});

test("buildOperationsRegistryInventoryManifest is deterministic for unchanged input", () => {
  const snapshot = baseSnapshot();
  const first = buildOperationsRegistryInventoryManifest({
    snapshot,
    databaseName: TEST_DATABASE,
    runId: "run-a",
    startedAt: "2026-07-29T12:00:00.000Z",
    completedAt: "2026-07-29T12:00:01.000Z",
  });
  const second = buildOperationsRegistryInventoryManifest({
    snapshot,
    databaseName: TEST_DATABASE,
    runId: "run-b",
    startedAt: "2026-07-29T13:00:00.000Z",
    completedAt: "2026-07-29T13:00:01.000Z",
  });

  assert.equal(first.mapping_checksum, second.mapping_checksum);
  assert.equal(first.collisions.length, second.collisions.length);
  assert.deepEqual(first.conflict_summary, second.conflict_summary);
  assert.equal(first.planned.creates, 0);
  assert.equal(first.planned.updates, 0);
  assert.equal(first.applied.failures, 0);
  assert.equal(first.mode, "dry_run");
});

test("collectInventoryCollisions categorizes blocking and reviewable conflicts", () => {
  const snapshot = baseSnapshot();
  snapshot.agents.push({
    id: "agent-2",
    name: "Mike M",
    normalized_name: "mike m",
    active: true,
    granot_crm_username: "MIKEM",
    name_aliases: [],
  });
  snapshot.sourceCompanies[0].granularities[0].cpl = 175;
  snapshot.bookedLeadMerchantSnapshots.push({
    normalized: "unknown merchant",
    count: 4,
  });

  const collisions = collectInventoryCollisions(snapshot);
  assert.ok(
    collisions.some(
      (collision) =>
        collision.code === "agent_normalized_name_collision" &&
        collision.severity === "blocking",
    ),
  );
  assert.ok(
    collisions.some(
      (collision) =>
        collision.code === "agent_granot_username_collision" &&
        collision.severity === "blocking",
    ),
  );
  assert.ok(
    collisions.some(
      (collision) =>
        collision.code === "embedded_cpl_vs_legacy_cpl_rate_disagreement" &&
        collision.severity === "reviewable",
    ),
  );
  assert.ok(
    collisions.some(
      (collision) =>
        collision.code === "booked_lead_merchant_snapshot_unmatched" &&
        collision.severity === "reviewable",
    ),
  );
});

test("manifest includes static authority references and required counts", () => {
  const manifest = buildOperationsRegistryInventoryManifest({
    snapshot: baseSnapshot(),
    databaseName: TEST_DATABASE,
    runId: "run-counts",
    startedAt: "2026-07-29T12:00:00.000Z",
    completedAt: "2026-07-29T12:00:01.000Z",
  });

  assert.equal(manifest.source_counts.agents, 1);
  assert.equal(manifest.source_counts.form_leads, 3);
  assert.equal(manifest.source_counts.call_leads, 2);
  assert.equal(
    manifest.validation_summary.static_authority_reference_count,
    STATIC_AUTHORITY_REFERENCES.length,
  );
  assert.ok(manifest.static_authority_references.length > 0);
  assert.equal(manifest.inventory.static_ringcentral_numbers.length, 5);
});

test("computeInventoryChecksum changes when snapshot data changes", () => {
  const snapshot = baseSnapshot();
  const baseline = computeInventoryChecksum(snapshot);
  snapshot.formLeadCounts[0].count = 99;
  const changed = computeInventoryChecksum(snapshot);
  assert.notEqual(baseline, changed);
});

test("CLI entrypoint has no apply flag and no write methods", () => {
  const cliSource = readFileSync(
    path.join(process.cwd(), "scripts/migrations/operations-registry-inventory.ts"),
    "utf8",
  );
  assert.doesNotThrow(() => assertNoApplyFlag(["--help"]));
  assert.match(cliSource, /assertNoApplyFlag/);
  assert.match(cliSource, /assertInventoryDatabaseAllowed/);
  assert.doesNotMatch(cliSource, /\.save\(/);
  assert.doesNotMatch(cliSource, /\.insertMany\(/);
  assert.doesNotMatch(cliSource, /\.updateMany\(/);
  assert.doesNotMatch(cliSource, /\.deleteMany\(/);
  assert.doesNotMatch(cliSource, /\.bulkWrite\(/);
});

test("importing inventory lib does not connect to MongoDB", async () => {
  const snapshot = baseSnapshot();
  assert.equal(typeof computeInventoryChecksum(snapshot), "string");
});
