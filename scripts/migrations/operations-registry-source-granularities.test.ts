import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import { test } from "node:test";
import {
  advanceSourceGranularitiesResumeCursor,
  buildSourceGranularitiesManifest,
  buildSourceGranularitiesPlan,
  companyMigrationUpdateFilter,
  granularityMigrationInsertDocument,
  redactSourceGranularitiesManifestForOutput,
  type SourceGranularitiesSnapshot,
} from "./operations-registry-source-granularities.lib";
import { TEST_DATABASE } from "./operations-registry-migration.lib";

const embeddedId = new mongoose.Types.ObjectId().toString();
const companyId = new mongoose.Types.ObjectId().toString();

const baseSnapshot = (): SourceGranularitiesSnapshot => ({
  companies: [
    {
      id: companyId,
      company_slug: "tbm_leads",
      default_form_granularity_key: "tbm_forms",
      default_call_granularity_key: "tbm_inbounds",
      sheet_config: {
        has_bad_tabs: false,
      },
      granularities: [
        {
          id: embeddedId,
          granularity_key: "tbm_forms",
          channel: "form",
          owner_label: "TBM Forms",
          crm_label: "TBM Forms",
          aliases: ["tbm-form"],
          active: true,
          local: "local",
          source_sites: ["example.com"],
          inbound_phone_numbers: [],
          priority: 1,
          sheet_tab_name: "Forms",
          cpl: 190,
        },
        {
          id: new mongoose.Types.ObjectId().toString(),
          granularity_key: "tbm_inbounds",
          channel: "call",
          owner_label: "10best Inbounds",
          crm_label: "10best Inbounds",
          aliases: [],
          active: true,
          source_sites: [],
          inbound_phone_numbers: ["+18883164387"],
          priority: 0,
          cpl: 190,
        },
      ],
    },
  ],
  existingGranularities: [],
});

test("M3 maps embedded granularities to first-class records preserving valid unique ids", () => {
  const plan = buildSourceGranularitiesPlan(baseSnapshot());
  const forms = plan.granularities.find((entry) => entry.granularity_key === "tbm_forms");

  assert.equal(forms?.action, "create_granularity");
  assert.equal(forms?.target_id, embeddedId);
  assert.equal(forms?.document?.source_company, companyId);
  assert.equal(forms?.document?.owner_label, "TBM Forms");
  assert.equal(forms?.document?.source_sites[0], "example.com");

  const insertDoc = granularityMigrationInsertDocument(forms!);
  assert.equal(String(insertDoc?._id), embeddedId);
  assert.equal(insertDoc?.created_from, "migration");
  assert.equal(insertDoc?.schedule_revision, 0);
});

test("M3 maps company defaults to ObjectIds while retaining compatibility keys", () => {
  const plan = buildSourceGranularitiesPlan(baseSnapshot());
  const companyPlan = plan.companies[0];

  assert.equal(companyPlan.action, "update_company");
  assert.equal(
    companyPlan.update?.default_form_granularity,
    plan.mappings.find((entry) => entry.granularity_key === "tbm_forms")?.first_class_id,
  );
  assert.equal(
    companyPlan.update?.default_call_granularity,
    plan.mappings.find((entry) => entry.granularity_key === "tbm_inbounds")?.first_class_id,
  );
  assert.equal(companyPlan.update?.sheet_config?.projection_mode, "derived_import");

  const update = companyMigrationUpdateFilter(companyPlan);
  const setPayload = update?.$set as Record<string, unknown> | undefined;
  assert.ok(setPayload?.default_form_granularity);
  assert.ok(setPayload?.default_call_granularity);
});

test("M3 retains compatibility default keys when company defaults need normalization", () => {
  const snapshot = baseSnapshot();
  snapshot.companies[0].default_form_granularity_key = " TBM_FORMS ";
  snapshot.companies[0].default_call_granularity_key = undefined;

  const plan = buildSourceGranularitiesPlan(snapshot);
  const companyPlan = plan.companies[0];

  assert.equal(companyPlan.update?.default_form_granularity_key, "tbm_forms");
});

test("M3 noop when first-class granularity already exists with matching fields", () => {
  const snapshot = baseSnapshot();
  snapshot.existingGranularities = [
    {
      id: embeddedId,
      source_company: companyId,
      granularity_key: "tbm_forms",
      channel: "form",
      owner_label: "TBM Forms",
      crm_label: "TBM Forms",
      aliases: ["tbm-form"],
      active: true,
      local: "local",
      source_sites: ["example.com"],
      priority: 1,
      sheet_tab_name: "Forms",
    },
  ];

  const plan = buildSourceGranularitiesPlan(snapshot);
  const forms = plan.granularities.find((entry) => entry.granularity_key === "tbm_forms");
  assert.equal(forms?.action, "noop_granularity");
});

test("M3 reports granularity key collisions", () => {
  const snapshot = baseSnapshot();
  snapshot.companies[0].granularities.push({
    ...snapshot.companies[0].granularities[0],
    id: new mongoose.Types.ObjectId().toString(),
  });

  const plan = buildSourceGranularitiesPlan(snapshot);
  assert.ok(
    plan.collisions.some(
      (collision) =>
        collision.code === "granularity_key_collision" && collision.severity === "blocking",
    ),
  );
});

test("M3 manifest checksum is stable and records mappings", () => {
  const snapshot = baseSnapshot();
  const plan = buildSourceGranularitiesPlan(snapshot);
  const first = buildSourceGranularitiesManifest({
    snapshot,
    plan,
    databaseName: TEST_DATABASE,
    mode: "dry_run",
    runId: "run-a",
    startedAt: "2026-07-29T12:00:00.000Z",
    completedAt: "2026-07-29T12:00:01.000Z",
  });
  const second = buildSourceGranularitiesManifest({
    snapshot,
    plan,
    databaseName: TEST_DATABASE,
    mode: "dry_run",
    runId: "run-b",
    startedAt: "2026-07-29T13:00:00.000Z",
    completedAt: "2026-07-29T13:00:01.000Z",
  });

  assert.equal(first.mapping_checksum, second.mapping_checksum);
  assert.equal(first.mappings.length, 2);
  assert.equal(first.validation_summary.embedded_arrays_untouched, true);
  assert.equal(first.validation_summary.one_mapped_document_per_embedded, true);
  assert.equal(first.validation_summary.defaults_resolve_to_mapped_ids, true);
});

test("M3 manifest output redacts spreadsheet IDs", () => {
  const snapshot = baseSnapshot();
  snapshot.companies[0]!.sheet_config = {
    spreadsheet_id: "private-workbook-id",
    has_bad_tabs: false,
  };
  const plan = buildSourceGranularitiesPlan(snapshot);
  const manifest = buildSourceGranularitiesManifest({
    snapshot,
    plan,
    databaseName: TEST_DATABASE,
    mode: "dry_run",
    runId: "redaction-test",
    startedAt: "2026-07-29T12:00:00.000Z",
    completedAt: "2026-07-29T12:00:01.000Z",
  });

  const redacted = redactSourceGranularitiesManifestForOutput(manifest);
  assert.equal(
    redacted.plan.companies[0]?.update?.sheet_config?.spreadsheet_id,
    "[redacted]",
  );
});

test("M3 resume cursor skips completed granularities and companies", () => {
  const snapshot = baseSnapshot();
  const initial = buildSourceGranularitiesPlan(snapshot);
  const cursor = advanceSourceGranularitiesResumeCursor(
    initial.resume_cursor,
    ["tbm_forms"],
    [],
  );
  const resumed = buildSourceGranularitiesPlan(snapshot, cursor);

  assert.ok(!resumed.granularities.some((entry) => entry.granularity_key === "tbm_forms"));
  assert.ok(resumed.granularities.some((entry) => entry.granularity_key === "tbm_inbounds"));
});

test("M3 CLI does not mutate embedded arrays", () => {
  const cliSource = readFileSync(
    path.join(process.cwd(), "scripts/migrations/operations-registry-source-granularities.ts"),
    "utf8",
  );
  assert.match(cliSource, /assertMigrationApplyAuthorized/);
  assert.match(cliSource, /assertMigrationDatabaseAllowed/);
  assert.doesNotMatch(cliSource, /\$set:\s*\{[^}]*granularities/);
  assert.doesNotMatch(cliSource, /\$pull/);
  assert.doesNotMatch(cliSource, /updateMany\(/);
});
