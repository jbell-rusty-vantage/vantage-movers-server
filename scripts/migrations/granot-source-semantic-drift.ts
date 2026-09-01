/**
 * ORS-2 — report-only Granot CRM Source semantic drift.
 *
 * Lists every existing Granot name that would fail the §6.5 health findings
 * today. Fixes nothing. Does not apply indexes. Does not read live production
 * payloads unless the inventory production-confirm flag is present (this pass
 * does not pass that flag).
 *
 *   TEST_MODE=true pnpm migration:granot-source-semantic-drift
 */
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../src/config/domain/runtime.js";
import { connectMongo } from "../../src/db.js";
import { getGranotCrmSourceModel } from "../../src/models/GranotCrmSource.js";
import { getLeadSourceCompanyModel } from "../../src/models/LeadSourceCompany.js";
import { getLeadSourceGranularityModel } from "../../src/models/LeadSourceGranularity.js";
import { buildGranotSourceHealthFindings } from "../../src/services/operationsRegistry/queries/health.js";
import {
  assertInventoryDatabaseAllowed,
  assertNoApplyFlag,
} from "./operations-registry-inventory.lib.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  assertNoApplyFlag(args);
  const databaseName = getMongoDatabaseName();
  assertInventoryDatabaseAllowed(databaseName, args);
  await connectMongo();

  const [sources, companies, feeds] = await Promise.all([
    getGranotCrmSourceModel().find({}).lean().exec(),
    getLeadSourceCompanyModel().find({}).lean().exec(),
    getLeadSourceGranularityModel().find({}).lean().exec(),
  ]);

  const findings = buildGranotSourceHealthFindings(
    sources.map((source) => ({
      id: String(source._id),
      enabled: source.enabled !== false,
      granot_label: source.granot_label,
      normalized_granot_label: source.normalized_granot_label ?? undefined,
      lifecycle_disposition: source.lifecycle_disposition ?? "deferred",
      lead_created_policy: source.lead_created_policy ?? "observation_only",
      lead_source_company: source.lead_source_company
        ? String(source.lead_source_company)
        : undefined,
      lifecycle_routes: (source.lifecycle_routes ?? []).map((route) => ({
        route_key: String(route.route_key ?? ""),
        lead_model: route.lead_model,
        move_type: route.move_type,
        source_granularity_id: String(route.source_granularity_id ?? ""),
      })),
      outbound_sms: source.outbound_sms
        ? {
            enabled: source.outbound_sms.enabled === true,
            consent_basis: source.outbound_sms.consent_basis,
            daily_cap: source.outbound_sms.daily_cap,
          }
        : undefined,
    })),
    companies.map((company) => ({
      id: String(company._id),
      active: company.active === true,
    })),
    feeds.map((feed) => ({
      id: String(feed._id),
      source_company: String(feed.source_company),
      active: feed.active === true,
      channel: feed.channel,
      local: feed.local ?? undefined,
    })),
  );

  const report = {
    script: "granot-source-semantic-drift",
    mode: "report",
    database: databaseName,
    source_count: sources.length,
    finding_count: findings.length,
    findings: findings.map((finding) => ({
      code: finding.code,
      severity: finding.severity,
      entity_id: finding.entity_id ?? null,
      summary: finding.summary,
      evidence: finding.evidence ?? {},
    })),
  };
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });
