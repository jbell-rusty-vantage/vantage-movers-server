import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { assertReviewedDryRunManifest } from "./operations-registry-migration.lib";

async function source(relativePath: string): Promise<string> {
  return readFile(path.join(process.cwd(), relativePath), "utf8");
}

test("production registry consumers do not read embedded Source Granularities", async () => {
  const [employeeBooking, adminFacets] = await Promise.all([
    source("src/services/employeeBookings/employeeBookingPreparation.ts"),
    source("src/services/admin/adminFacets.service.ts"),
  ]);

  assert.doesNotMatch(employeeBooking, /models\/LeadSourceCompany/);
  assert.doesNotMatch(employeeBooking, /company\.granularities/);
  assert.match(employeeBooking, /listSourceGranularities/);
  assert.doesNotMatch(adminFacets, /listLeadSourceCompanies/);
  assert.match(adminFacets, /listSourceGranularities/);
});

test("receiver Agent analytics use persisted registry snapshots for dynamic labels", async () => {
  const analytics = await source(
    "src/services/analytics/receiverAgentPerformance.service.ts",
  );

  assert.match(analytics, /crm_source_label_snapshot/);
  assert.match(analytics, /source_granularity_label_snapshot/);
  assert.doesNotMatch(analytics, /SOURCE_COMPANIES|SourceCompany\[\]/);
  assert.doesNotMatch(analytics, /getFormLeadSourceCompanyLabel|getCallLeadSourceCompanyLabel/);
});

test("seed-surface dump is redacted and cannot rewrite the reviewed report", async () => {
  const dump = await source(
    "scripts/migrations/dump-operations-registry-seed-surface.ts",
  );
  const report = JSON.parse(
    await source(
      "scripts/migrations/operations-registry-backfill-seed-report.json",
    ),
  ) as {
    lead_source_companies: Array<{
      sheet_config: Record<string, unknown> | null;
    }>;
  };

  assert.doesNotMatch(dump, /checkedInPath|operations-registry-backfill-seed-report\.json/);
  assert.doesNotMatch(dump, /spreadsheet_id:\s*company\.sheet_config\.spreadsheet_id/);
  assert.ok(
    report.lead_source_companies.every(
      (company) =>
        company.sheet_config === null ||
        !Object.hasOwn(company.sheet_config, "spreadsheet_id"),
    ),
  );
});

test("production apply is bound to the exact reviewed dry-run manifest", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "operations-registry-review-"),
  );
  const manifestPath = path.join(directory, "dry-run.json");
  await writeFile(
    manifestPath,
    JSON.stringify({
      mode: "dry_run",
      database_name: "vantagemovers",
      script_version: "m3",
      mapping_checksum: "approved-checksum",
      cutover_date: "2026-07-30",
    }),
  );

  try {
    await assertReviewedDryRunManifest({
      args: [`--reviewed-manifest=${manifestPath}`],
      databaseName: "vantagemovers",
      scriptVersion: "m3",
      mappingChecksum: "approved-checksum",
      cutoverDate: "2026-07-30",
    });
    await assert.rejects(
      () =>
        assertReviewedDryRunManifest({
          args: [`--reviewed-manifest=${manifestPath}`],
          databaseName: "vantagemovers",
          scriptVersion: "m3",
          mappingChecksum: "changed-checksum",
          cutoverDate: "2026-07-30",
        }),
      /does not match/,
    );
    await assert.rejects(
      () =>
        assertReviewedDryRunManifest({
          args: [],
          databaseName: "vantagemovers",
          scriptVersion: "m3",
          mappingChecksum: "approved-checksum",
        }),
      /requires --reviewed-manifest/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
