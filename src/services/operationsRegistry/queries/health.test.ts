import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCplRegistryHealthFindings,
  buildGranotSourceHealthFindings,
  buildLabelMappingHealthFindings,
  type GranotHealthSourceInput,
} from "./health";

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
