import assert from "node:assert/strict";
import { test } from "node:test";
import type { InboundCallCreationInventory, InboundCallCreationSourceRow } from "./granot-inbound-call-creation-policy.lib";
import {
  INBOUND_CALL_CREATION_REVERT_TARGETS,
  assertInboundCallCreationRevertReady,
  sourcesNeedingRevert,
  verifyInboundCallCreationRevertTargets,
} from "./granot-inbound-call-creation-policy-revert.lib";

const now = new Date("2026-09-03T15:00:00.000Z");

function source(
  family: (typeof INBOUND_CALL_CREATION_REVERT_TARGETS)[number]["family"],
  overrides: Partial<InboundCallCreationSourceRow> = {},
): InboundCallCreationSourceRow {
  const target = INBOUND_CALL_CREATION_REVERT_TARGETS.find((row) => row.family === family)!;
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
    lead_created_policy: "create_if_missing",
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
    sources: INBOUND_CALL_CREATION_REVERT_TARGETS.map((target) => source(target.family)),
    companies: INBOUND_CALL_CREATION_REVERT_TARGETS.map((target) => ({
      id: `company-${target.family}`,
      company_slug: target.company_slug,
      active: true,
    })),
    granularities: INBOUND_CALL_CREATION_REVERT_TARGETS.map((target) => ({
      id: `granularity-${target.family}`,
      granularity_key: target.granularity_key,
      source_company_id: `company-${target.family}`,
      channel: "call",
      active: true,
    })),
    assignments: [],
    routes: [],
    now,
    ...overrides,
  };
}

test("revert targets are the four 2026-09-02 inbound flips and never Best Relocation", () => {
  assert.deepEqual(
    INBOUND_CALL_CREATION_REVERT_TARGETS.map((target) => target.family),
    ["main_site_call", "tbm_call", "tbm_prime_call", "top10_call"],
  );
  assert.equal(
    INBOUND_CALL_CREATION_REVERT_TARGETS.some((target) =>
      target.normalized_labels.some((label) => label.includes("bestrelocation")),
    ),
    false,
  );
});

test("ready inbound Call sources pass revert identity checks", () => {
  const findings = verifyInboundCallCreationRevertTargets(readyInventory());
  assert.equal(findings.length, 4);
  assert.equal(findings.every((finding) => finding.ready), true);
  assert.equal(findings.every((finding) => finding.would_deactivate_sms === false), true);
  assertInboundCallCreationRevertReady(findings);
  assert.equal(sourcesNeedingRevert(findings).length, 4);
});

test("already link_only inbound sources are ready and skipped", () => {
  const findings = verifyInboundCallCreationRevertTargets(
    readyInventory({
      sources: INBOUND_CALL_CREATION_REVERT_TARGETS.map((target) =>
        source(target.family, {
          lead_created_policy: "link_only",
          outbound_sms_enabled: false,
        }),
      ),
    }),
  );
  assert.equal(findings.every((finding) => finding.ready), true);
  assert.equal(sourcesNeedingRevert(findings).length, 0);
  assert.equal(findings.every((finding) => finding.would_deactivate_sms === false), true);
});

test("wrong Source Granularity or Form route is refused", () => {
  const inventory = readyInventory();
  inventory.granularities[0] = {
    ...inventory.granularities[0]!,
    granularity_key: "main_site_form",
    channel: "form",
  };
  inventory.sources[1] = source("tbm_call", {
    lifecycle_routes: [
      {
        route_key: "form_any",
        lead_model: "FormLead",
        move_type: "any",
        source_granularity_id: "granularity-tbm_call",
      },
    ],
  });
  const findings = verifyInboundCallCreationRevertTargets(inventory);
  const mainSite = findings.find((finding) => finding.family === "main_site_call");
  const tbm = findings.find((finding) => finding.family === "tbm_call");
  assert.equal(mainSite?.ready, false);
  assert.equal(mainSite?.granularity_matches, false);
  assert.equal(tbm?.ready, false);
  assert.equal(tbm?.route_is_call_any, false);
  assert.throws(
    () => assertInboundCallCreationRevertReady(findings),
    /Refusing inbound Call create_if_missing revert/,
  );
});
