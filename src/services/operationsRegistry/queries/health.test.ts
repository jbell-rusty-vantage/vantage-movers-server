import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSourceRegistryHealthFindings } from "./health";

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
