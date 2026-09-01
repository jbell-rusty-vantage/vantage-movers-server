import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertLabelMappingManifestChecksum,
  blockingLabelMappingProposals,
  buildLabelMappingManifest,
  collectLabelMappingInventoryLabels,
  proposeLabelMappings,
  reportEmbeddedGranularitiesUsage,
  summarizeLabelInventoryOrigins,
  summarizeLabelMappingClassifications,
} from "./operations-registry-inventory.lib";

test("--report on a fixture with one cross_company label exits without a manifest and names the label", () => {
  const proposals = proposeLabelMappings({
    labels: [
      {
        label: "Best Relocation Forms",
        namespace: "sheet_lead_source",
        static_company_slug: "best_relocation_leads",
      },
    ],
    feeds: [
      {
        id: "feed-tbm",
        company_id: "company-tbm",
        company_slug: "tbm_leads",
        crm_label: "Best Relocation Forms",
        aliases: [],
        active: true,
      },
    ],
  });
  assert.equal(proposals[0]?.classification, "cross_company");
  assert.equal(proposals[0]?.label, "Best Relocation Forms");
  const blocking = blockingLabelMappingProposals(proposals);
  assert.equal(blocking.length, 1);
  assert.throws(
    () => buildLabelMappingManifest(proposals),
    /Best Relocation Forms \(cross_company\)/,
  );
  assert.deepEqual(summarizeLabelMappingClassifications(proposals), {
    ok: 0,
    zero_match: 0,
    multiple_match: 0,
    cross_company: 1,
  });
});

test("--apply refuses a manifest whose checksum does not match its content", () => {
  const proposals = proposeLabelMappings({
    labels: [
      {
        label: "Paid Overflow",
        namespace: "legacy_api_source",
        static_company_slug: "paid_overflow",
      },
    ],
    feeds: [
      {
        id: "feed-paid",
        company_id: "company-paid",
        company_slug: "paid_overflow",
        crm_label: "Paid Overflow",
        aliases: [],
        active: true,
      },
    ],
  });
  const manifest = buildLabelMappingManifest(proposals);
  assert.throws(
    () =>
      assertLabelMappingManifestChecksum({
        ...manifest,
        checksum: "0".repeat(64),
      }),
    /checksum mismatch/,
  );
});

test("inventory collects Feed crm_label, alias, and Lead snapshot labels once each", () => {
  const labels = collectLabelMappingInventoryLabels({
    staticLabels: [
      {
        label: "Best Relocation Forms",
        namespace: "sheet_lead_source",
        static_company_slug: "best_relocation_leads",
      },
    ],
    feeds: [
      {
        crm_label: "Best Relocation Forms",
        aliases: ["BestRelocation Forms", "BR Forms"],
      },
    ],
    leadSnapshots: ["Best Relocation Forms", "Observed Sheet Spelling"],
  });
  const byLabel = Object.fromEntries(labels.map((item) => [item.label, item]));
  assert.equal(byLabel["Best Relocation Forms"]?.origin, "static_map");
  assert.equal(byLabel["BestRelocation Forms"]?.origin, "feed_alias");
  assert.equal(byLabel["BR Forms"]?.origin, "feed_alias");
  assert.equal(byLabel["Observed Sheet Spelling"]?.origin, "lead_snapshot");
  const proposals = proposeLabelMappings({
    labels,
    feeds: [
      {
        id: "feed-br",
        company_id: "company-br",
        company_slug: "best_relocation_leads",
        crm_label: "Best Relocation Forms",
        aliases: ["BestRelocation Forms", "BR Forms"],
        active: true,
      },
    ],
  });
  assert.deepEqual(summarizeLabelInventoryOrigins(proposals), {
    static_map: 1,
    feed_crm_label: 0,
    feed_alias: 2,
    lead_snapshot: 1,
  });
});

test("§9.2 embedded granularities report lists readers and removes nothing", () => {
  const report = reportEmbeddedGranularitiesUsage();
  assert.equal(report.removed_in_this_pass, false);
  assert.equal(report.indexes.length, 3);
  assert.ok(
    report.readers.some((reader) =>
      reader.path.includes("LeadSourceCompany.ts"),
    ),
  );
  assert.ok(
    report.readers.some((reader) => reader.still_live && reader.kind === "read"),
  );
});
