import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import { test } from "node:test";
import { dollarsToCents } from "../../src/services/operationsRegistry/cplSchedule";
import {
  advanceCplSchedulesResumeCursor,
  buildCplSchedulesManifest,
  buildCplSchedulesPlan,
  cplScheduleMigrationInsertDocument,
  resolveCutoverBusinessDate,
  type CplSchedulesSnapshot,
} from "./operations-registry-cpl-schedules.lib";
import { TEST_DATABASE } from "./operations-registry-migration.lib";

const granularityId = new mongoose.Types.ObjectId().toString();
const companyId = new mongoose.Types.ObjectId().toString();
const zeroGranularityId = new mongoose.Types.ObjectId().toString();

const baseSnapshot = (): CplSchedulesSnapshot => ({
  cutover_date: "2026-07-29",
  activeGranularities: [
    {
      id: granularityId,
      source_company_id: companyId,
      company_slug: "tbm_leads",
      granularity_key: "tbm_forms",
      channel: "form",
      owner_label: "TBM Forms",
      crm_label: "TBM Forms",
      active: true,
      schedule_revision: 0,
    },
    {
      id: zeroGranularityId,
      source_company_id: companyId,
      company_slug: "main_site",
      granularity_key: "main_site_forms",
      channel: "form",
      owner_label: "Main Site Forms",
      crm_label: "Main Site Forms",
      active: true,
      schedule_revision: 0,
    },
  ],
  embeddedCpls: [
    {
      company_slug: "tbm_leads",
      granularity_key: "tbm_forms",
      channel: "form",
      crm_label: "TBM Forms",
      cpl: 190,
    },
    {
      company_slug: "main_site",
      granularity_key: "main_site_forms",
      channel: "form",
      crm_label: "Main Site Forms",
      cpl: 0,
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
      label: "Main Site Forms",
      source_company: "main_site",
      lead_type: "form",
      cpl: 0,
    },
  ],
  existingPeriods: [],
});

test("M4 seeds one open-ended cutover period using reconciled cents", () => {
  const plan = buildCplSchedulesPlan(baseSnapshot());
  const forms = plan.schedules.find((entry) => entry.granularity_key === "tbm_forms");

  assert.equal(forms?.action, "create");
  assert.equal(forms?.cutover_date, "2026-07-29");
  assert.equal(forms?.business_timezone, "America/New_York");
  assert.equal(forms?.amount_cents, dollarsToCents(190));
  assert.equal(forms?.source_value, 190);
  assert.equal(forms?.authority, "embedded_granularity+cpl_rates");
  assert.equal(forms?.expected_revision, 0);
  assert.equal(forms?.next_revision, 1);
  assert.equal(forms?.period?.effective_from_date, "2026-07-29");
  assert.equal(forms?.period?.amount_cents, 19000);
  assert.ok(forms?.period);
  assert.ok(!("effective_until_date_exclusive" in (forms?.period ?? {})));

  const insertDoc = cplScheduleMigrationInsertDocument(forms!);
  assert.equal(insertDoc?.amount_cents, 19000);
  assert.equal(insertDoc?.schedule_revision, 1);
  assert.equal(insertDoc?.effective_until, undefined);
  assert.ok(!("effective_until_date_exclusive" in (insertDoc ?? {})));
});

test("M4 allows explicit zero-dollar free-traffic periods", () => {
  const plan = buildCplSchedulesPlan(baseSnapshot());
  const free = plan.schedules.find((entry) => entry.granularity_key === "main_site_forms");

  assert.equal(free?.action, "create");
  assert.equal(free?.amount_cents, 0);
  assert.equal(free?.source_value, 0);
  assert.equal(free?.authority, "embedded_granularity+cpl_rates");
});

test("M4 preserves current authoritative cpl_rates when embedded CPL disagrees", () => {
  const snapshot = baseSnapshot();
  snapshot.cplRates[0]!.cpl = 200;

  const plan = buildCplSchedulesPlan(snapshot);
  const forms = plan.schedules.find((entry) => entry.granularity_key === "tbm_forms");

  assert.equal(forms?.action, "create");
  assert.equal(forms?.amount_cents, 20_000);
  assert.equal(forms?.source_value, 200);
  assert.equal(forms?.authority, "cpl_rates");
  assert.ok(
    plan.collisions.some(
      (collision) =>
        collision.code === "embedded_cpl_vs_cpl_rates_disagreement" &&
        collision.severity === "reviewable",
    ),
  );
  assert.ok(!plan.collisions.some((collision) => collision.severity === "blocking"));
});

test("M4 is idempotent when a non-archived schedule already exists", () => {
  const snapshot = baseSnapshot();
  snapshot.existingPeriods = [
    {
      id: new mongoose.Types.ObjectId().toString(),
      source_granularity_id: granularityId,
      amount_cents: 19000,
      effective_from_date: "2026-07-01",
      archived_at: null,
    },
  ];
  snapshot.activeGranularities[0]!.schedule_revision = 1;

  const plan = buildCplSchedulesPlan(snapshot);
  const forms = plan.schedules.find((entry) => entry.granularity_key === "tbm_forms");

  assert.equal(forms?.action, "noop_existing_schedule");
  assert.equal(forms?.expected_revision, 1);
  assert.equal(cplScheduleMigrationInsertDocument(forms!), null);
});

test("M4 resume cursor skips completed granularities", () => {
  const snapshot = baseSnapshot();
  const initial = buildCplSchedulesPlan(snapshot);
  const cursor = advanceCplSchedulesResumeCursor(initial.resume_cursor, [granularityId]);
  const resumed = buildCplSchedulesPlan(snapshot, cursor);

  assert.ok(!resumed.schedules.some((entry) => entry.source_granularity_id === granularityId));
  assert.ok(
    resumed.schedules.some((entry) => entry.source_granularity_id === zeroGranularityId),
  );
});

test("M4 manifest checksum is deterministic and records proposed schedules", () => {
  const snapshot = baseSnapshot();
  const plan = buildCplSchedulesPlan(snapshot);
  const first = buildCplSchedulesManifest({
    snapshot,
    plan,
    databaseName: TEST_DATABASE,
    mode: "dry_run",
    runId: "run-a",
    startedAt: "2026-07-29T12:00:00.000Z",
    completedAt: "2026-07-29T12:00:01.000Z",
  });
  const second = buildCplSchedulesManifest({
    snapshot,
    plan,
    databaseName: TEST_DATABASE,
    mode: "dry_run",
    runId: "run-b",
    startedAt: "2026-07-29T13:00:00.000Z",
    completedAt: "2026-07-29T13:00:01.000Z",
  });

  assert.equal(first.mapping_checksum, second.mapping_checksum);
  assert.equal(first.cutover_date, "2026-07-29");
  assert.equal(first.business_timezone, "America/New_York");
  assert.equal(first.proposed_schedules.length, 2);
  assert.equal(first.validation_summary.dry_run_performed_no_writes, true);
  assert.equal(first.validation_summary.no_historical_periods_inferred, true);
  assert.equal(first.validation_summary.lead_fields_untouched, true);
  assert.equal(first.validation_summary.existing_schedules_not_overwritten, true);
  assert.ok(
    first.proposed_schedules.every(
      (entry) =>
        entry.cutover_date === "2026-07-29" &&
        typeof entry.amount_cents === "number" &&
        typeof entry.source_value === "number" &&
        typeof entry.authority === "string",
    ),
  );
});

test("M4 cutover date flag validates America/New_York business dates", () => {
  assert.equal(
    resolveCutoverBusinessDate(["--cutover-date=2026-03-08"]),
    "2026-03-08",
  );
  assert.throws(() => resolveCutoverBusinessDate(["--cutover-date=not-a-date"]));
});

test("M4 uses embedded-only or cpl_rates-only authority without inventing a winner", () => {
  const embeddedOnly = baseSnapshot();
  embeddedOnly.cplRates = [];
  const embeddedPlan = buildCplSchedulesPlan(embeddedOnly);
  assert.equal(
    embeddedPlan.schedules.find((entry) => entry.granularity_key === "tbm_forms")?.authority,
    "embedded_granularity",
  );

  const ratesOnly = baseSnapshot();
  ratesOnly.embeddedCpls = [];
  const ratesPlan = buildCplSchedulesPlan(ratesOnly);
  assert.equal(
    ratesPlan.schedules.find((entry) => entry.granularity_key === "tbm_forms")?.authority,
    "cpl_rates",
  );
});

test("M4 migration sources do not import or reference Lead models", () => {
  const libSource = readFileSync(
    path.join(process.cwd(), "scripts/migrations/operations-registry-cpl-schedules.lib.ts"),
    "utf8",
  );
  const cliSource = readFileSync(
    path.join(process.cwd(), "scripts/migrations/operations-registry-cpl-schedules.ts"),
    "utf8",
  );
  const combined = `${libSource}\n${cliSource}`;

  assert.doesNotMatch(combined, /FormLead|CallLead|historical\/FormLead|historical\/CallLead/);
  assert.doesNotMatch(combined, /from ["'].*models\/(FormLead|CallLead)/);
  assert.doesNotMatch(combined, /models\/historical/);
  assert.match(cliSource, /assertMigrationApplyAuthorized/);
  assert.match(cliSource, /assertMigrationDatabaseAllowed/);
  assert.match(cliSource, /isMigrationApplyRequested/);
  assert.match(cliSource, /withTransaction/);
  assert.doesNotMatch(cliSource, /updateMany\(/);
});

test("M4 dry-run path is the default and apply is gated", () => {
  const cliSource = readFileSync(
    path.join(process.cwd(), "scripts/migrations/operations-registry-cpl-schedules.ts"),
    "utf8",
  );
  assert.match(cliSource, /Dry run by default/);
  assert.match(cliSource, /mode: apply \? "apply" : "dry_run"/);
  assert.match(
    cliSource,
    /if \(apply\) \{\s*await assertReviewedDryRunManifest[\s\S]*?if \(hasBlockingMigrationCollisions/,
  );
  assert.match(cliSource, /Refusing --apply while blocking CPL schedule migration collisions remain/);
  assert.match(
    cliSource,
    /Resume manifest does not match this script, database, or cutover date/,
  );
  assert.match(
    cliSource,
    /Resume cursor contains an unverified granularity/,
  );
});
