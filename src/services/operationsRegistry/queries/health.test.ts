import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCplRegistryHealthFindings,
  buildGranotSourceHealthFindings,
  buildLabelMappingHealthFindings,
  buildRuntimeRegistryHealthFindings,
  buildSourceRegistryHealthFindings,
  type GranotHealthSourceInput,
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

test("label mapping health reports an invalid destination and a collision", () => {
  const findings = buildLabelMappingHealthFindings(
    [
      {
        id: "map-inactive-feed",
        namespace: "sheet_lead_source",
        normalized_label: "best relocation forms",
        source_company: "company-a",
        source_granularity: "feed-inactive",
        active: true,
      },
      {
        id: "map-a",
        namespace: "legacy_api_source",
        normalized_label: "paid overflow",
        source_company: "company-a",
        source_granularity: "feed-a",
        active: true,
      },
      {
        id: "map-b",
        namespace: "legacy_api_source",
        normalized_label: "paid overflow",
        source_company: "company-a",
        source_granularity: "feed-a",
        active: true,
      },
    ],
    [{ id: "company-a", active: true }],
    [
      {
        id: "feed-inactive",
        source_company: "company-a",
        active: false,
      },
      {
        id: "feed-a",
        source_company: "company-a",
        active: true,
      },
    ],
  );

  assert.deepEqual(
    findings.map((finding) => finding.code).sort(),
    [
      "registry.label_mapping_collision",
      "registry.label_mapping_destination_invalid",
    ],
  );
  assert.equal(
    findings.find((finding) => finding.code === "registry.label_mapping_destination_invalid")
      ?.entity_id,
    "map-inactive-feed",
  );
});

test("Registry Health renders with an empty mappings collection", () => {
  const findings = buildLabelMappingHealthFindings([], [], []);
  assert.deepEqual(findings, []);
});

function healthyGranot(
  overrides: Partial<GranotHealthSourceInput> = {},
): GranotHealthSourceInput {
  return {
    id: "granot-healthy",
    enabled: true,
    granot_label: "Synthetic TBM Forms Prime",
    normalized_granot_label: "synthetic tbm forms prime",
    lifecycle_disposition: "source_scoped_lead",
    lead_created_policy: "link_only",
    lead_source_company: "company-a",
    lifecycle_routes: [
      {
        route_key: "any",
        lead_model: "FormLead",
        move_type: "any",
        source_granularity_id: "feed-a",
      },
    ],
    outbound_sms: { enabled: false, consent_basis: "not_attested", daily_cap: 0 },
    ...overrides,
  };
}

test("Granot health findings raise on one fixture each and stay quiet on a healthy source", () => {
  const companies = [{ id: "company-a", active: true }];
  const feeds = [
    { id: "feed-a", source_company: "company-a", active: true, channel: "form" as const },
    { id: "feed-inactive", source_company: "company-a", active: false, channel: "form" as const },
  ];

  const destination = buildGranotSourceHealthFindings(
    [
      healthyGranot({
        id: "granot-bad-destination",
        lifecycle_routes: [
          {
            route_key: "any",
            lead_model: "FormLead",
            move_type: "any",
            source_granularity_id: "feed-inactive",
          },
        ],
      }),
    ],
    companies,
    feeds,
  );
  assert.equal(
    destination.some((finding) => finding.code === "registry.granot_source_destination_invalid"),
    true,
  );

  const shape = buildGranotSourceHealthFindings(
    [
      healthyGranot({
        id: "granot-bad-shape",
        lifecycle_routes: [
          {
            route_key: "any",
            lead_model: "FormLead",
            move_type: "any",
            source_granularity_id: "feed-a",
          },
          {
            route_key: "extra",
            lead_model: "CallLead",
            move_type: "any",
            source_granularity_id: "feed-a",
          },
        ],
      }),
    ],
    companies,
    feeds,
  );
  assert.equal(
    shape.some((finding) => finding.code === "registry.granot_source_route_shape_invalid"),
    true,
  );

  const collision = buildGranotSourceHealthFindings(
    [
      healthyGranot({ id: "granot-a" }),
      healthyGranot({ id: "granot-b" }),
    ],
    companies,
    feeds,
  );
  assert.equal(
    collision.some((finding) => finding.code === "registry.granot_source_label_collision"),
    true,
  );

  const smsGate = buildGranotSourceHealthFindings(
    [
      healthyGranot({
        id: "granot-sms-inconsistent",
        outbound_sms: {
          enabled: true,
          consent_basis: "existing_relationship",
          daily_cap: 0,
        },
      }),
    ],
    companies,
    feeds,
  );
  assert.equal(
    smsGate.some((finding) => finding.code === "registry.granot_sms_gate_inconsistent"),
    true,
  );

  const dailyCap = buildGranotSourceHealthFindings(
    [
      healthyGranot({
        id: "granot-cap",
        outbound_sms: { enabled: false, consent_basis: "not_attested", daily_cap: 25 },
      }),
    ],
    companies,
    feeds,
  );
  assert.equal(
    dailyCap.some((finding) => finding.code === "registry.granot_sms_daily_cap_configured"),
    true,
  );

  const quiet = buildGranotSourceHealthFindings(
    [healthyGranot()],
    companies,
    feeds,
  );
  assert.deepEqual(
    quiet.map((finding) => finding.code),
    [],
  );
});
