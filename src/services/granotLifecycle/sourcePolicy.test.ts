import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  resetRegistryCacheInvalidationForTests,
} from "../operationsRegistry/cacheInvalidation";
import {
  resetGranotCrmSourceCachesForTests,
  writeGranotSourcePolicyCache,
} from "../operationsRegistry/granotCrmSourceCache";
import { evaluateGranotLeadSmsGates } from "../leadMessaging/granotCreatedLead";
import {
  evaluateEffectGates,
  resolveSourcePolicy,
  type EffectGateFacts,
  type SourcePolicyRow,
  type SourcePolicyStore,
} from "./sourcePolicy";

const companyId = "64b000000000000000000001";
const localGranularityId = "64b000000000000000000002";
const longGranularityId = "64b000000000000000000003";
const sourceId = "64b000000000000000000010";

afterEach(() => {
  resetRegistryCacheInvalidationForTests();
  resetGranotCrmSourceCachesForTests();
});

function formSource(overrides: Partial<SourcePolicyRow> = {}): SourcePolicyRow {
  return {
    id: sourceId,
    enabled: true,
    lifecycle_enabled: true,
    lifecycle_disposition: "source_scoped_lead",
    lead_created_policy: "link_only",
    lead_source_company: companyId,
    lifecycle_policy_version: "best-relocation-forms/v1",
    normalized_granot_label: "bestrelocation forms",
    lifecycle_routes: [
      {
        route_key: "form_local",
        lead_model: "FormLead",
        move_type: "local",
        source_granularity_id: localGranularityId,
      },
      {
        route_key: "form_long",
        lead_model: "FormLead",
        move_type: "long_distance",
        source_granularity_id: longGranularityId,
      },
    ],
    ...overrides,
  };
}

function store(rows: SourcePolicyRow[]): SourcePolicyStore {
  return {
    async findByNormalizedLabel(label) {
      return rows.filter((row) => row.normalized_granot_label === label);
    },
    async findCompany(id) {
      if (id !== companyId) return null;
      return { id, active: true };
    },
    async findGranularity(id) {
      if (id === localGranularityId) {
        return {
          id,
          source_company_id: companyId,
          active: true,
          channel: "form",
          local: "local",
        };
      }
      if (id === longGranularityId) {
        return {
          id,
          source_company_id: companyId,
          active: true,
          channel: "form",
          local: "long_distance",
        };
      }
      return null;
    },
  };
}

test("[AC-38] zero, multiple, inactive, and ambiguous runtime matches never pick a row or route", async () => {
  const unclassified = await resolveSourcePolicy(
    { source_label: "Unknown Paid Overflow" },
    store([]),
  );
  assert.equal(unclassified.ok, false);
  if (!unclassified.ok) {
    assert.equal(unclassified.outcome, "policy_blocked");
    assert.equal(unclassified.reason, "source_unclassified");
  }

  const ambiguous = await resolveSourcePolicy(
    { source_label: "BestRelocation Forms" },
    store([formSource(), formSource({ id: "64b000000000000000000011" })]),
  );
  assert.equal(ambiguous.ok, false);
  if (!ambiguous.ok) {
    assert.equal(ambiguous.outcome, "ambiguous");
    assert.notEqual(ambiguous.snapshot?.granot_crm_source_id, sourceId);
  }

  const disabled = await resolveSourcePolicy(
    { source_label: "BestRelocation Forms" },
    store([formSource({ lifecycle_enabled: false })]),
  );
  assert.equal(disabled.ok, false);
  if (!disabled.ok) {
    assert.equal(disabled.reason, "source_disabled");
    assert.equal(disabled.outcome, "policy_blocked");
  }

  const inactiveCompany = await resolveSourcePolicy(
    { source_label: "BestRelocation Forms", origin_state: "NY", destination_state: "NY" },
    {
      ...store([formSource()]),
      async findCompany() {
        return { id: companyId, active: false };
      },
    },
  );
  assert.equal(inactiveCompany.ok, false);
  if (!inactiveCompany.ok) {
    assert.equal(inactiveCompany.reason, "target_source_company_inactive");
  }
});

test("[AC-38] policy cache cannot serve a precommit snapshot", async () => {
  writeGranotSourcePolicyCache("bestrelocation forms", {
    ok: true,
    snapshot: {
      granot_crm_source_id: "precommit-not-committed",
      lifecycle_disposition: "source_scoped_lead",
      lead_created_policy: "create_if_missing",
    },
  });
  const resolved = await resolveSourcePolicy(
    { source_label: "BestRelocation Forms" },
    store([]),
  );
  assert.equal(resolved.ok, false);
  if (!resolved.ok) {
    assert.equal(resolved.reason, "source_unclassified");
    assert.notEqual(resolved.snapshot?.granot_crm_source_id, "precommit-not-committed");
  }
});

test("[AC-09] Best Relocation Form same valid states select local; different select long-distance; invalid select none", async () => {
  const local = await resolveSourcePolicy(
    {
      source_label: "BestRelocation Forms",
      origin_state: "ny",
      destination_state: "NY",
    },
    store([formSource()]),
  );
  assert.equal(local.ok, true);
  if (local.ok) {
    assert.equal(local.snapshot.selected_route_key, "form_local");
    assert.equal(local.snapshot.selected_lead_model, "FormLead");
    assert.equal(local.snapshot.selected_move_type, "local");
    assert.equal(local.snapshot.source_granularity_id, localGranularityId);
  }

  const longDistance = await resolveSourcePolicy(
    {
      source_label: "BestRelocation Forms",
      origin_state: "NY",
      destination_state: "CA",
    },
    store([formSource()]),
  );
  assert.equal(longDistance.ok, true);
  if (longDistance.ok) {
    assert.equal(longDistance.snapshot.selected_route_key, "form_long");
    assert.equal(longDistance.snapshot.selected_move_type, "long_distance");
  }

  const missing = await resolveSourcePolicy(
    { source_label: "BestRelocation Forms", origin_state: "NY" },
    store([formSource()]),
  );
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.equal(missing.reason, "missing_creation_route_data");
    assert.equal(missing.snapshot?.source_granularity_id, undefined);
  }

  const invalid = await resolveSourcePolicy(
    {
      source_label: "BestRelocation Forms",
      origin_state: "NY",
      destination_state: "XX",
    },
    store([formSource()]),
  );
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.equal(invalid.reason, "missing_creation_route_data");
  }
});

test("[AC-29] deferred Paid Overflow and Auto authorize no effect; payload type is not classification input", async () => {
  const paidOverflow = await resolveSourcePolicy(
    { source_label: "Paid Overflow", provider_type: "AUTO" },
    store([
      formSource({
        id: "64b000000000000000000020",
        normalized_granot_label: "paid overflow",
        lifecycle_disposition: "deferred",
        lead_created_policy: "observation_only",
        lead_source_company: undefined,
        lifecycle_routes: [],
      }),
    ]),
  );
  assert.equal(paidOverflow.ok, false);
  if (!paidOverflow.ok) {
    assert.equal(paidOverflow.outcome, "deferred");
    assert.equal(paidOverflow.reason, "source_deferred");
  }

  const autoByType = await resolveSourcePolicy(
    { source_label: "BestRelocation Forms", provider_type: "AUTO" },
    store([formSource()]),
  );
  assert.equal(autoByType.ok, false);
  if (!autoByType.ok) {
    assert.equal(autoByType.reason, "missing_creation_route_data");
  }

  const futureAuto = await resolveSourcePolicy(
    { source_label: "Auto", provider_type: "AUTO" },
    store([
      formSource({
        id: "64b000000000000000000021",
        normalized_granot_label: "auto",
        lifecycle_disposition: "deferred",
        lead_created_policy: "observation_only",
        lead_source_company: undefined,
        lifecycle_routes: [],
      }),
    ]),
  );
  assert.equal(futureAuto.ok, false);
  if (!futureAuto.ok) {
    assert.equal(futureAuto.reason, "source_deferred");
  }
});

test("[AC-28] reviewed Referral reconciliation treats absent Lead scope gates as not applicable", () => {
  const evaluation = evaluateEffectGates({
    global_effect_flag: true,
    receipt_post_activation: true,
    processor_mode: "live",
    operational_enabled: true,
    lifecycle_enabled: true,
    disposition: "referral_booking",
    source_company_active: false,
    source_granularity_active: false,
    lead_created_policy: "observation_only",
    requested_effect: "booking_reconciliation",
  });
  assert.equal(evaluation.allowed, true);
  assert.equal(evaluation.evaluated_gates.find((gate) => gate.gate === "source_company_active")?.allowed, true);
  assert.equal(evaluation.evaluated_gates.find((gate) => gate.gate === "source_granularity_active")?.allowed, true);
  assert.equal(evaluateEffectGates({
    ...evaluationFacts(),
    global_effect_flag: false,
  }).allowed, false);
  for (const facts of [
    { receipt_post_activation: false },
    { processor_mode: "live_shadow" as const },
    { processor_mode: "historical_shadow" as const },
    { lifecycle_enabled: false },
  ]) {
    assert.equal(evaluateEffectGates({ ...evaluationFacts(), ...facts }).allowed, false);
  }
});

test("twelve policy × effect outcomes are independent for link, enrich, create, and text", () => {
  const passing: EffectGateFacts = {
    global_effect_flag: true,
    receipt_post_activation: true,
    processor_mode: "live",
    operational_enabled: true,
    lifecycle_enabled: true,
    disposition: "source_scoped_lead",
    source_company_active: true,
    source_granularity_active: true,
    lead_created_policy: "create_if_missing",
    requested_effect: "lead_created",
  };
  const rows: Array<{
    policy: EffectGateFacts["lead_created_policy"];
    effect: "lead_link" | "lead_enrichment" | "lead_created" | "text";
    allowed: boolean;
  }> = [
    { policy: "observation_only", effect: "lead_link", allowed: false },
    { policy: "observation_only", effect: "lead_enrichment", allowed: false },
    { policy: "observation_only", effect: "lead_created", allowed: false },
    { policy: "observation_only", effect: "text", allowed: false },
    { policy: "link_only", effect: "lead_link", allowed: true },
    { policy: "link_only", effect: "lead_enrichment", allowed: true },
    { policy: "link_only", effect: "lead_created", allowed: false },
    { policy: "link_only", effect: "text", allowed: false },
    { policy: "create_if_missing", effect: "lead_link", allowed: true },
    { policy: "create_if_missing", effect: "lead_enrichment", allowed: true },
    { policy: "create_if_missing", effect: "lead_created", allowed: true },
    { policy: "create_if_missing", effect: "text", allowed: true },
  ];

  for (const row of rows) {
    if (row.effect === "text") {
      const evaluation = evaluateGranotLeadSmsGates({
        messaging_mode: "inline",
        granot_sms_flag: true,
        lead_created_policy: row.policy,
        outbound_sms_enabled: true,
        consent_basis: "existing_relationship",
        destination: "+19545550142",
      });
      assert.equal(evaluation.allowed, row.allowed, `${row.policy} × text`);
      continue;
    }
    const evaluation = evaluateEffectGates({
      ...passing,
      lead_created_policy: row.policy,
      requested_effect: row.effect,
    });
    assert.equal(evaluation.allowed, row.allowed, `${row.policy} × ${row.effect}`);
  }
});

function evaluationFacts(): EffectGateFacts {
  return {
    global_effect_flag: true,
    receipt_post_activation: true,
    processor_mode: "live",
    operational_enabled: true,
    lifecycle_enabled: true,
    disposition: "referral_booking",
    source_company_active: false,
    source_granularity_active: false,
    lead_created_policy: "observation_only",
    requested_effect: "booking_reconciliation",
  };
}
