import assert from "node:assert/strict";
import { test } from "node:test";
import { selectFormMoveType } from "../../src/services/granotLifecycle/sourceLabel";
import {
  EXCLUDED_PROVIDER_TYPES,
  LINK_ONLY_AUTOMATION_FAMILY_KEYS,
  LINK_ONLY_AUTOMATION_GRANULARITY_KEYS,
  REVIEWED_SOURCE_CLASSIFICATION_MANIFEST,
  REVIEWED_SOURCE_COMPANY_SLUG,
  REVIEWED_GRANULARITY_KEYS,
  isExcludedProviderType,
} from "./granot-lifecycle-source-registry.manifest";
import {
  assertPlanHasNoForbiddenPayload,
  intendedPolicyEqualsCurrent,
  planGranotLifecycleSourceRegistry,
  readSourceRegistryApplyScope,
  selectCrmMutationsForApply,
  type InventoryAutomationSource,
  type InventoryCompany,
  type InventoryCrmSource,
  type InventoryGranularity,
  type SourceRegistryInventory,
} from "./granot-lifecycle-source-registry.lib";

const company: InventoryCompany = {
  id: "cccccccccccccccccccccccc",
  company_slug: REVIEWED_SOURCE_COMPANY_SLUG,
  owner_label: "Best Relocation Leads",
  active: true,
};

const linkOnlyCompanies: InventoryCompany[] = [
  { id: "cccccccccccccccccccccc01", company_slug: "main_site", owner_label: "main site", active: true },
  { id: "cccccccccccccccccccccc02", company_slug: "tbm_leads", owner_label: "TBM Leads", active: true },
  { id: "cccccccccccccccccccccc03", company_slug: "tbm_prime_leads", owner_label: "TBM Prime Leads", active: true },
  { id: "cccccccccccccccccccccc04", company_slug: "top10_leads", owner_label: "Top 10 Forms", active: true },
  { id: "cccccccccccccccccccccc05", company_slug: "paid_overflow", owner_label: "Paid Overflow", active: true },
];

const granularities: InventoryGranularity[] = [
  {
    id: "111111111111111111111111",
    granularity_key: REVIEWED_GRANULARITY_KEYS.call,
    owner_label: "Best Relocation Call",
    source_company_id: company.id,
    channel: "call",
    active: true,
  },
  {
    id: "222222222222222222222222",
    granularity_key: REVIEWED_GRANULARITY_KEYS.form_local,
    owner_label: "Best Relocation Form Local",
    source_company_id: company.id,
    channel: "form",
    local: "local",
    active: true,
  },
  {
    id: "333333333333333333333333",
    granularity_key: REVIEWED_GRANULARITY_KEYS.form_long_distance,
    owner_label: "Best Relocation Form Long Distance",
    source_company_id: company.id,
    channel: "form",
    local: "long_distance",
    active: true,
  },
  {
    id: "444444444444444444444401",
    granularity_key: LINK_ONLY_AUTOMATION_GRANULARITY_KEYS.main_site_form,
    owner_label: "Main Site Forms",
    source_company_id: "cccccccccccccccccccccc01",
    channel: "form",
    active: true,
  },
  {
    id: "444444444444444444444402",
    granularity_key: LINK_ONLY_AUTOMATION_GRANULARITY_KEYS.main_site_call,
    owner_label: "Main Site Inbounds",
    source_company_id: "cccccccccccccccccccccc01",
    channel: "call",
    active: true,
  },
  {
    id: "444444444444444444444403",
    granularity_key: LINK_ONLY_AUTOMATION_GRANULARITY_KEYS.tbm_form,
    owner_label: "TBM Forms",
    source_company_id: "cccccccccccccccccccccc02",
    channel: "form",
    active: true,
  },
  {
    id: "444444444444444444444404",
    granularity_key: LINK_ONLY_AUTOMATION_GRANULARITY_KEYS.tbm_call,
    owner_label: "10best Inbounds",
    source_company_id: "cccccccccccccccccccccc02",
    channel: "call",
    active: true,
  },
  {
    id: "444444444444444444444405",
    granularity_key: LINK_ONLY_AUTOMATION_GRANULARITY_KEYS.tbm_prime_form,
    owner_label: "TBM Prime Forms",
    source_company_id: "cccccccccccccccccccccc03",
    channel: "form",
    active: true,
  },
  {
    id: "444444444444444444444406",
    granularity_key: LINK_ONLY_AUTOMATION_GRANULARITY_KEYS.tbm_prime_call,
    owner_label: "TBM Prime Inbounds",
    source_company_id: "cccccccccccccccccccccc03",
    channel: "call",
    active: true,
  },
  {
    id: "444444444444444444444407",
    granularity_key: LINK_ONLY_AUTOMATION_GRANULARITY_KEYS.top10_form,
    owner_label: "Top10 Forms",
    source_company_id: "cccccccccccccccccccccc04",
    channel: "form",
    active: true,
  },
  {
    id: "444444444444444444444408",
    granularity_key: LINK_ONLY_AUTOMATION_GRANULARITY_KEYS.top10_call,
    owner_label: "Top10 Inbounds",
    source_company_id: "cccccccccccccccccccccc04",
    channel: "call",
    active: true,
  },
  {
    id: "121212121212121212121212",
    granularity_key: REVIEWED_GRANULARITY_KEYS.paid_overflow,
    owner_label: "Paid Overflow",
    source_company_id: "cccccccccccccccccccccc05",
    channel: "form",
    active: true,
  },
];

function crm(
  overrides: Partial<InventoryCrmSource> & Pick<InventoryCrmSource, "id" | "granot_label">,
): InventoryCrmSource {
  return {
    enabled: true,
    lifecycle_enabled: false,
    lifecycle_disposition: "deferred",
    lead_created_policy: "observation_only",
    lifecycle_routes: [],
    lifecycle_policy_version: "",
    crm_origin: "https://eagle.example.test",
    workspace_slug: `ws-${overrides.id.slice(-4)}`,
    default_channel: "unknown",
    source_company: "not_provided",
    ...overrides,
  };
}

function automation(
  overrides: Partial<InventoryAutomationSource> & Pick<InventoryAutomationSource, "id" | "label">,
): InventoryAutomationSource {
  return {
    active: true,
    supported_operations: ["form_leads"],
    ...overrides,
  };
}

function inventory(
  overrides: Partial<SourceRegistryInventory> = {},
): SourceRegistryInventory {
  return {
    crm_sources: [
      crm({ id: "aaaaaaaaaaaaaaaaaaaaaaa1", granot_label: "BestRelocation Inbounds" }),
      crm({ id: "aaaaaaaaaaaaaaaaaaaaaaa2", granot_label: "Best Relocation Inbounds" }),
      crm({ id: "aaaaaaaaaaaaaaaaaaaaaaa3", granot_label: "BestRelocation Forms" }),
      crm({ id: "aaaaaaaaaaaaaaaaaaaaaaa4", granot_label: "Best Relocation Forms" }),
      crm({ id: "aaaaaaaaaaaaaaaaaaaaaaa5", granot_label: "Referral" }),
      crm({ id: "aaaaaaaaaaaaaaaaaaaaaaa6", granot_label: "Paid Overflow" }),
      crm({ id: "aaaaaaaaaaaaaaaaaaaaaaa7", granot_label: "Auto" }),
      crm({ id: "aaaaaaaaaaaaaaaaaaaaaaa8", granot_label: "TBM Forms" }),
      crm({ id: "aaaaaaaaaaaaaaaaaaaaaa16", granot_label: "Main Site Forms" }),
      crm({ id: "aaaaaaaaaaaaaaaaaaaaaa17", granot_label: "Main Site Inbounds" }),
      crm({ id: "aaaaaaaaaaaaaaaaaaaaaa18", granot_label: "10best Inbounds" }),
      crm({ id: "aaaaaaaaaaaaaaaaaaaaaa19", granot_label: "TBM Forms Prime" }),
      crm({ id: "aaaaaaaaaaaaaaaaaaaaaa20", granot_label: "TBM Prime Inbounds" }),
      crm({ id: "aaaaaaaaaaaaaaaaaaaaaa21", granot_label: "Top10 Forms" }),
      crm({ id: "aaaaaaaaaaaaaaaaaaaaaa22", granot_label: "Top10 Inbounds" }),
    ],
    automation_sources: [
      automation({
        id: "bbbbbbbbbbbbbbbbbbbbbbb1",
        label: "BestRelocation Inbounds",
        supported_operations: ["call_leads"],
      }),
      automation({
        id: "bbbbbbbbbbbbbbbbbbbbbbb2",
        label: "Best Relocation Forms",
        supported_operations: ["form_leads"],
      }),
      automation({
        id: "bbbbbbbbbbbbbbbbbbbbbbb3",
        label: "Unknown Automation",
        supported_operations: ["form_leads"],
      }),
    ],
    companies: [company, ...linkOnlyCompanies],
    granularities,
    ...overrides,
  };
}

test("[AC-29] reviewed manifest contains only the locked normalized labels and excludes provider type AUTO", () => {
  assert.deepEqual(
    REVIEWED_SOURCE_CLASSIFICATION_MANIFEST.families.flatMap((family) => [
      ...family.normalized_labels,
    ]),
    [
      "bestrelocation inbounds",
      "best relocation inbounds",
      "bestrelocation forms",
      "best relocation forms",
      "main site forms",
      "main site inbounds",
      "tbm forms",
      "10best inbounds",
      "tbm forms prime",
      "tbm prime inbounds",
      "top10 forms",
      "top10 inbounds",
      "referral",
      "paid overflow",
      "auto",
    ],
  );
  assert.deepEqual([...EXCLUDED_PROVIDER_TYPES], ["AUTO"]);
  assert.equal(isExcludedProviderType("AUTO"), true);
  assert.equal(isExcludedProviderType("auto"), true);
  const plan = planGranotLifecycleSourceRegistry(
    inventory({ provider_types: ["AUTO", "FORM"] }),
  );
  assert.equal(plan.provider_type_auto_excluded, true);
  assert.equal(
    plan.crm_mutations.some((mutation) => mutation.family === "auto" && mutation.granot_label === "AUTO"),
    false,
  );
});

test("[AC-09] Best Relocation Form plans exact local/long-distance routes with create_if_missing", () => {
  const plan = planGranotLifecycleSourceRegistry(inventory());
  const forms = plan.crm_mutations.filter(
    (mutation) => mutation.family === "best_relocation_form",
  );
  assert.equal(forms.length, 2);
  for (const mutation of forms) {
    assert.equal(mutation.refused, false);
    assert.equal(mutation.intended.lead_created_policy, "create_if_missing");
    assert.equal(mutation.intended.lifecycle_enabled, true);
    assert.deepEqual(
      mutation.intended.lifecycle_routes.map((route) => route.route_key),
      ["form_local", "form_long_distance"],
    );
    assert.equal(
      mutation.intended.lifecycle_routes.some((route) => route.lead_model === "CallLead"),
      false,
    );
  }
  assert.equal(selectFormMoveType({ origin_state: "NY", destination_state: "NY" }), "local");
  assert.equal(selectFormMoveType({ origin_state: "NY", destination_state: "CA" }), "long_distance");
  assert.equal(selectFormMoveType({ origin_state: "NY" }), undefined);
  assert.equal(selectFormMoveType({}), undefined);
});

test("[AC-09] Best Relocation Call plans exactly one Call/any route with create_if_missing", () => {
  const plan = planGranotLifecycleSourceRegistry(inventory());
  const calls = plan.crm_mutations.filter(
    (mutation) => mutation.family === "best_relocation_call",
  );
  assert.equal(calls.length, 2);
  for (const mutation of calls) {
    assert.equal(mutation.intended.lead_created_policy, "create_if_missing");
    assert.deepEqual(mutation.intended.lifecycle_routes, [
      {
        route_key: "call_any",
        lead_model: "CallLead",
        move_type: "any",
        source_granularity_id: "111111111111111111111111",
      },
    ]);
  }
});

test("[AC-29] Referral is observation_only; source Auto stays deferred; Paid Overflow is create_if_missing", () => {
  const plan = planGranotLifecycleSourceRegistry(inventory());
  const referral = plan.crm_mutations.find((mutation) => mutation.family === "referral");
  const overflow = plan.crm_mutations.find((mutation) => mutation.family === "paid_overflow");
  const auto = plan.crm_mutations.find((mutation) => mutation.family === "auto");
  assert.equal(referral?.intended.lifecycle_enabled, true);
  assert.equal(referral?.intended.lifecycle_disposition, "referral_booking");
  assert.equal(referral?.intended.lead_created_policy, "observation_only");
  assert.deepEqual(referral?.intended.lifecycle_routes, []);
  assert.equal(overflow?.intended.lifecycle_enabled, true);
  assert.equal(overflow?.intended.lifecycle_disposition, "source_scoped_lead");
  assert.equal(overflow?.intended.lead_created_policy, "create_if_missing");
  assert.deepEqual(overflow?.intended.lifecycle_routes, [
    {
      route_key: "form_any",
      lead_model: "FormLead",
      move_type: "any",
      source_granularity_id: "121212121212121212121212",
    },
  ]);
  assert.equal(overflow?.intended.default_channel, "form");
  assert.equal(auto?.intended.lifecycle_enabled, false);
  assert.equal(auto?.intended.lifecycle_disposition, "deferred");
});

test("[AC-38] unmatched and colliding rows stay deferred and never guess a route", () => {
  const plan = planGranotLifecycleSourceRegistry(
    inventory({
      crm_sources: [
        crm({ id: "aaaaaaaaaaaaaaaaaaaaaaa8", granot_label: "Unknown Forms" }),
        crm({ id: "aaaaaaaaaaaaaaaaaaaaaaa9", granot_label: "BestRelocation Forms" }),
        crm({ id: "aaaaaaaaaaaaaaaaaaaaaa10", granot_label: "BestRelocation Forms" }),
      ],
    }),
  );
  const unmatched = plan.crm_mutations.find((mutation) => mutation.granot_label === "Unknown Forms");
  const collided = plan.crm_mutations.filter(
    (mutation) => mutation.normalized_label === "bestrelocation forms",
  );
  assert.ok(unmatched?.action === "defer" || unmatched?.action === "noop");
  assert.equal(unmatched?.intended.lifecycle_enabled, false);
  assert.equal(unmatched?.intended.lifecycle_disposition, "deferred");
  assert.deepEqual(unmatched?.intended.lifecycle_routes, []);
  assert.equal(plan.unique_index_ready, false);
  assert.equal(collided.every((mutation) => mutation.refused), true);
  assert.equal(plan.refused_families.includes("best_relocation_form"), true);
  const collision = plan.normalized_label_collisions.find(
    (group) => group.normalized_granot_label === "bestrelocation forms",
  );
  assert.ok(collision);
  assert.ok(collision.count >= 2);
  assert.equal(collision.masked_ids.includes("aaaaaaaaaaaaaaaaaaaaaaa9"), false);
  assert.equal(
    collision.masked_ids.every((id) => id.includes("…")),
    true,
  );
});

test("[AC-38] inactive or wrong-channel Best Relocation dependencies refuse the whole family", () => {
  const plan = planGranotLifecycleSourceRegistry(
    inventory({
      granularities: granularities.map((row) =>
        row.granularity_key === REVIEWED_GRANULARITY_KEYS.form_local
          ? { ...row, channel: "call" }
          : row,
      ),
    }),
  );
  assert.equal(plan.required_dependencies_ok, false);
  assert.ok(
    plan.dependency_findings.some(
      (finding) =>
        finding.key === REVIEWED_GRANULARITY_KEYS.form_local &&
        finding.code === "wrong_channel",
    ),
  );
  assert.equal(plan.refused_families.includes("best_relocation_form"), true);
  assert.equal(
    plan.crm_mutations
      .filter((mutation) => mutation.family === "best_relocation_form")
      .every((mutation) => mutation.intended.lifecycle_enabled === false),
    true,
  );
});

test("[AC-38] automation references write only for one exact-normalized reviewed match", () => {
  const plan = planGranotLifecycleSourceRegistry(inventory());
  const inbound = plan.automation_mutations.find(
    (mutation) => mutation.label === "BestRelocation Inbounds",
  );
  const forms = plan.automation_mutations.find(
    (mutation) => mutation.label === "Best Relocation Forms",
  );
  const unknown = plan.automation_mutations.find(
    (mutation) => mutation.label === "Unknown Automation",
  );
  assert.equal(inbound?.action, "link");
  assert.equal(inbound?.intended_reference, "aaaaaaaaaaaaaaaaaaaaaaa1");
  assert.equal(forms?.action, "link");
  assert.equal(forms?.intended_reference, "aaaaaaaaaaaaaaaaaaaaaaa4");
  assert.equal(unknown?.action, "skip");
  assert.equal(unknown?.intended_reference, undefined);
});

test("[AC-38] replay with the same intended state is a no-op", () => {
  const source = crm({
    id: "aaaaaaaaaaaaaaaaaaaaaaa5",
    granot_label: "Referral",
    lifecycle_enabled: true,
    lifecycle_disposition: "referral_booking",
    lead_created_policy: "observation_only",
    lifecycle_policy_version: "granot-lifecycle-source-policy-v1",
  });
  const plan = planGranotLifecycleSourceRegistry(
    inventory({ crm_sources: [source] }),
  );
  const referral = plan.crm_mutations[0];
  assert.equal(referral?.action, "noop");
  assert.equal(intendedPolicyEqualsCurrent(source, referral!.intended), true);
});

test("[AC-38] manifests stay PII-safe and never include payload or contact keys", () => {
  const plan = planGranotLifecycleSourceRegistry(inventory());
  assertPlanHasNoForbiddenPayload(plan);
  const serialized = JSON.stringify(plan);
  assert.equal(serialized.includes("payload"), false);
  assert.equal(serialized.includes("555"), false);
});

test("[AC-09][AC-38] scoped policy apply admits only Best Relocation lead_created_policy drift", () => {
  const base = inventory();
  const intendedById = new Map(
    planGranotLifecycleSourceRegistry(base).crm_mutations.map((mutation) => [
      mutation.id,
      mutation.intended,
    ]),
  );
  const scopedInventory = inventory({
    crm_sources: base.crm_sources.map((source) => {
      const intended = intendedById.get(source.id);
      if (!intended || !source.granot_label.toLowerCase().includes("best relocation") && !source.granot_label.toLowerCase().includes("bestrelocation")) {
        return source;
      }
      return { ...source, ...intended, lead_created_policy: "link_only" };
    }),
  });
  const plan = planGranotLifecycleSourceRegistry(scopedInventory);
  const selected = selectCrmMutationsForApply(
    plan,
    "best_relocation_creation_policy",
  );
  assert.equal(selected.length, 4);
  assert.equal(
    selected.every(
      (mutation) =>
        mutation.action === "classify" &&
        mutation.drift_fields.join(",") === "lead_created_policy",
    ),
    true,
  );
  assert.throws(
    () =>
      selectCrmMutationsForApply(
        planGranotLifecycleSourceRegistry(inventory()),
        "best_relocation_creation_policy",
      ),
    /drift is not limited/,
  );
  assert.equal(
    readSourceRegistryApplyScope([
      "--scope=best_relocation_creation_policy",
    ]),
    "best_relocation_creation_policy",
  );
  assert.throws(
    () => readSourceRegistryApplyScope(["--scope=unknown"]),
    /Unsupported source Registry apply scope/,
  );
});

test("[AC-09] Main Site, TBM, TBM Prime, Top10, and 10best classify as link_only source_scoped_lead", () => {
  const plan = planGranotLifecycleSourceRegistry(inventory());
  const selected = selectCrmMutationsForApply(plan, "link_only_automation_sources");
  assert.equal(selected.length, LINK_ONLY_AUTOMATION_FAMILY_KEYS.length);
  assert.equal(
    selected.every(
      (mutation) =>
        mutation.refused === false &&
        mutation.intended.lifecycle_enabled === true &&
        mutation.intended.lifecycle_disposition === "source_scoped_lead" &&
        mutation.intended.lead_created_policy === "link_only" &&
        mutation.intended.lifecycle_routes.length === 1,
    ),
    true,
  );
  const tbm = selected.find((mutation) => mutation.granot_label === "TBM Forms");
  assert.deepEqual(tbm?.intended.lifecycle_routes, [
    {
      route_key: "form_any",
      lead_model: "FormLead",
      move_type: "any",
      source_granularity_id: "444444444444444444444403",
    },
  ]);
  assert.equal(tbm?.intended.lead_source_company, "cccccccccccccccccccccc02");
  assert.equal(tbm?.intended.default_channel, "form");
  assert.equal(
    readSourceRegistryApplyScope(["--scope=link_only_automation_sources"]),
    "link_only_automation_sources",
  );
});
