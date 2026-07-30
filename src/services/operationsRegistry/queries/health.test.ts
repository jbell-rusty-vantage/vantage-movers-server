import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCplRegistryHealthFindings,
  buildRuntimeRegistryHealthFindings,
  buildSourceRegistryHealthFindings,
} from "./health";

test("source registry health reports invalid defaults and deterministic conflicts", () => {
  const findings = buildSourceRegistryHealthFindings(
    [
      {
        id: "company-a",
        active: true,
        default_form_granularity: "inactive-default",
      },
    ],
    [
      {
        id: "form-a",
        source_company: "company-a",
        channel: "form",
        active: true,
        crm_label: "Shared CRM",
        source_sites: ["shared.example"],
        aliases: ["legacy"],
        priority: 10,
      },
      {
        id: "form-b",
        source_company: "company-a",
        channel: "form",
        active: true,
        crm_label: " shared crm ",
        source_sites: ["SHARED.EXAMPLE"],
        aliases: ["Legacy"],
        priority: 10,
      },
    ],
  );

  assert.deepEqual(
    findings.map((finding) => finding.code),
    [
      "registry.source_crm_label_ambiguous",
      "registry.source_default_invalid",
      "registry.source_fallback_priority_ambiguous",
      "registry.source_source_site_ambiguous",
    ],
  );
});

test("source registry health reports active granularity under inactive company", () => {
  const findings = buildSourceRegistryHealthFindings(
    [{ id: "company-a", active: false }],
    [
      {
        id: "call-a",
        source_company: "company-a",
        channel: "call",
        active: true,
        crm_label: "Calls",
        source_sites: [],
        aliases: [],
        priority: 0,
      },
    ],
  );

  assert.equal(findings[0]?.code, "registry.source_granularity_inactive_company");
  assert.equal(findings[0]?.entity_id, "call-a");
});

test("CPL health discloses invalid active schedules and unresolved production Leads", () => {
  const findings = buildCplRegistryHealthFindings(
    ["granularity-a"],
    [],
    3,
    1,
    1,
  );
  assert.deepEqual(
    findings.map((finding) => finding.code),
    [
      "registry.cpl_schedule_invalid",
      "registry.cpl_missing_rate_leads",
      "registry.cpl_correction_jobs_unhealthy",
    ],
  );
});

test("runtime health discloses stale cache service and remaining compatibility reads", () => {
  const findings = buildRuntimeRegistryHealthFindings({
    resolvers: {
      source: {
        mode: "direct_db",
        last_success_at: null,
        age_ms: null,
        max_age_ms: null,
        refresh_attempts: 0,
        refresh_failures: 0,
        last_error_code: null,
        serving_stale: false,
      },
      cpl: {
        mode: "direct_db",
        last_success_at: null,
        age_ms: null,
        max_age_ms: null,
        refresh_attempts: 0,
        refresh_failures: 0,
        last_error_code: null,
        serving_stale: false,
      },
      ringcentral: {
        mode: "snapshot",
        last_success_at: "2026-07-29T12:00:00.000Z",
        age_ms: 360_000,
        max_age_ms: 300_000,
        refresh_attempts: 2,
        refresh_failures: 1,
        last_error_code: "snapshot_refresh_failed",
        serving_stale: true,
      },
    },
    compatibility_reads: [
      {
        path: "legacy_cpl_rates",
        consumer_category: "admin_list",
        count: 2,
        last_used_at: "2026-07-29T12:01:00.000Z",
      },
    ],
  });

  assert.deepEqual(
    findings.map((finding) => finding.code),
    [
      "registry.cache_stale",
      "registry.compatibility_reads_remaining",
    ],
  );
});
