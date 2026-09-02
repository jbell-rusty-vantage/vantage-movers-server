import assert from "node:assert/strict";
import { test } from "node:test";
import {
  INBOUND_CALL_CREATION_TARGETS,
  assertInboundCallCreationReady,
  verifyInboundCallCreationTargets,
  type InboundCallCreationInventory,
  type InboundCallCreationSourceRow,
} from "./granot-inbound-call-creation-policy.lib";

const now = new Date("2026-09-02T18:00:00.000Z");

function source(
  family: (typeof INBOUND_CALL_CREATION_TARGETS)[number]["family"],
  overrides: Partial<InboundCallCreationSourceRow> = {},
): InboundCallCreationSourceRow {
  const target = INBOUND_CALL_CREATION_TARGETS.find((row) => row.family === family)!;
  return {
    id: `source-${family}`,
    granot_label: target.granot_label,
    normalized_granot_label: target.normalized_labels[0]!,
    crm_origin: "https://example.test",
    workspace_slug: `official/${family}`,
    default_channel: "call",
    source_company: target.company_slug,
    enabled: true,
    lifecycle_enabled: true,
    lifecycle_disposition: "source_scoped_lead",
    lead_created_policy: "link_only",
    lead_source_company: `company-${family}`,
    lifecycle_routes: [
      {
        route_key: "call_any",
        lead_model: "CallLead",
        move_type: "any",
        source_granularity_id: `granularity-${family}`,
      },
    ],
    lifecycle_policy_version: "granot-lifecycle-source-policy-v1",
    outbound_sms_enabled: false,
    ...overrides,
  };
}

function readyInventory(
  overrides: Partial<InboundCallCreationInventory> = {},
): InboundCallCreationInventory {
  return {
    sources: INBOUND_CALL_CREATION_TARGETS.map((target) => source(target.family)),
    companies: INBOUND_CALL_CREATION_TARGETS.map((target) => ({
      id: `company-${target.family}`,
      company_slug: target.company_slug,
      active: true,
    })),
    granularities: INBOUND_CALL_CREATION_TARGETS.map((target) => ({
      id: `granularity-${target.family}`,
      granularity_key: target.granularity_key,
      source_company_id: `company-${target.family}`,
      channel: "call",
      active: true,
    })),
    assignments: INBOUND_CALL_CREATION_TARGETS.map((target) => ({
      id: `assignment-${target.family}`,
      source_company_id: `company-${target.family}`,
      source_granularity_id: `granularity-${target.family}`,
      route_id: `route-${target.family}`,
      active: true,
      effective_from: new Date("2026-07-30T00:00:00.000Z"),
      effective_until: null,
    })),
    routes: INBOUND_CALL_CREATION_TARGETS.map((target) => ({
      id: `route-${target.family}`,
      active: true,
      validation_status: "valid",
    })),
    now,
    ...overrides,
  };
}

test("10best Inbounds is the TBM Call Source Granularity", () => {
  const tbm = INBOUND_CALL_CREATION_TARGETS.find((target) => target.family === "tbm_call");
  assert.equal(tbm?.granot_label, "10best Inbounds");
  assert.equal(tbm?.company_slug, "tbm_leads");
  assert.equal(tbm?.granularity_key, "tbm_leads_call");
});

test("ready inbound Call targets pass company, granularity, and 0-or-1 assignment checks", () => {
  const findings = verifyInboundCallCreationTargets(readyInventory());
  assert.equal(findings.length, 4);
  assert.equal(findings.every((finding) => finding.ready), true);
  assert.equal(
    findings.every((finding) => finding.active_valid_assignment_count === 1),
    true,
  );
  assertInboundCallCreationReady(findings);
});

test("zero RingCentral assignments is still ready", () => {
  const findings = verifyInboundCallCreationTargets(
    readyInventory({ assignments: [], routes: [] }),
  );
  assert.equal(findings.every((finding) => finding.ready), true);
  assert.equal(
    findings.every((finding) => finding.active_valid_assignment_count === 0),
    true,
  );
});

test("wrong Source Granularity or two active assignments is refused", () => {
  const inventory = readyInventory();
  inventory.granularities[0] = {
    ...inventory.granularities[0]!,
    granularity_key: "tbm_leads_form",
    channel: "form",
  };
  inventory.assignments.push({
    id: "assignment-tbm-call-extra",
    source_company_id: "company-tbm_call",
    source_granularity_id: "granularity-tbm_call",
    route_id: "route-tbm_call-extra",
    active: true,
    effective_from: new Date("2026-07-31T00:00:00.000Z"),
    effective_until: null,
  });
  inventory.routes.push({
    id: "route-tbm_call-extra",
    active: true,
    validation_status: "valid",
  });
  const findings = verifyInboundCallCreationTargets(inventory);
  const mainSite = findings.find((finding) => finding.family === "main_site_call");
  const tbm = findings.find((finding) => finding.family === "tbm_call");
  assert.equal(mainSite?.ready, false);
  assert.equal(mainSite?.granularity_matches, false);
  assert.equal(tbm?.ready, false);
  assert.equal(tbm?.active_valid_assignment_count, 2);
  assert.throws(() => assertInboundCallCreationReady(findings), /Refusing inbound Call/);
});

test("Form route or enabled outbound_sms is refused", () => {
  const inventory = readyInventory({
    sources: INBOUND_CALL_CREATION_TARGETS.map((target) =>
      source(target.family, {
        outbound_sms_enabled: target.family === "top10_call",
        lifecycle_routes:
          target.family === "main_site_call"
            ? [
                {
                  route_key: "form_any",
                  lead_model: "FormLead",
                  move_type: "any",
                  source_granularity_id: `granularity-${target.family}`,
                },
              ]
            : source(target.family).lifecycle_routes,
      }),
    ),
  });
  const findings = verifyInboundCallCreationTargets(inventory);
  assert.equal(
    findings.find((finding) => finding.family === "main_site_call")?.route_is_call_any,
    false,
  );
  assert.equal(
    findings.find((finding) => finding.family === "top10_call")?.ready,
    false,
  );
});
