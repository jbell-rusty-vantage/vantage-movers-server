import { getGranotCrmSourceModel } from "../../models/GranotCrmSource";
import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../models/LeadSourceGranularity";
import type { LoadedGranularityRef, LoadedSourceCompanyRef } from "../../models/granotCrmSourceSemantics";
import { normalizeGranotSourceLabel, selectFormMoveType } from "./sourceLabel";
import type {
  ExecutionMode,
  GranotLeadCreatedPolicy,
  GranotLifecycleDisposition,
  LeadModel,
  SynchronizationOutcome,
  SynchronizationReasonCode,
} from "./types";

export type SourcePolicyRoute = {
  route_key: string;
  lead_model: LeadModel;
  move_type: "local" | "long_distance" | "any";
  source_granularity_id: string;
};

export type SourcePolicyRow = {
  id: string;
  enabled: boolean;
  lifecycle_enabled: boolean;
  lifecycle_disposition: GranotLifecycleDisposition;
  lead_created_policy: GranotLeadCreatedPolicy;
  lead_source_company?: string;
  lifecycle_routes: SourcePolicyRoute[];
  lifecycle_policy_version: string;
  normalized_granot_label?: string;
};

export type SourcePolicyLookupFacts = {
  source_label: string;
  origin_state?: string;
  destination_state?: string;
  provider_type?: unknown;
};

export type SourcePolicySnapshot = {
  granot_crm_source_id: string;
  lead_source_company_id?: string;
  source_granularity_id?: string;
  selected_route_key?: string;
  selected_move_type?: "local" | "long_distance" | "any";
  lifecycle_disposition: GranotLifecycleDisposition;
  lead_created_policy: GranotLeadCreatedPolicy;
  lifecycle_policy_version?: string;
};

export type SourcePolicyResolution =
  | {
      ok: true;
      snapshot: SourcePolicySnapshot;
    }
  | {
      ok: false;
      outcome: SynchronizationOutcome;
      reason: SynchronizationReasonCode;
      snapshot?: SourcePolicySnapshot;
    };

export type SourcePolicyStore = {
  findByNormalizedLabel(label: string): Promise<SourcePolicyRow[]>;
  findCompany(id: string): Promise<LoadedSourceCompanyRef | null>;
  findGranularity(id: string): Promise<LoadedGranularityRef | null>;
};

export type RequestedLifecycleEffect =
  | "lead_created"
  | "lead_link"
  | "lead_enrichment"
  | "booking_reconciliation"
  | "release_reconciliation";

export type EffectGateFacts = {
  global_effect_flag: boolean;
  receipt_post_activation: boolean;
  processor_mode: ExecutionMode;
  operational_enabled: boolean;
  lifecycle_enabled: boolean;
  disposition: GranotLifecycleDisposition;
  source_company_active: boolean;
  source_granularity_active: boolean;
  lead_created_policy: GranotLeadCreatedPolicy;
  requested_effect: RequestedLifecycleEffect;
  source_scope_eligible?: boolean;
};

export type EvaluatedGate = {
  gate: string;
  allowed: boolean;
};

export const EFFECT_GATE_NAMES = [
  "global_effect_flag",
  "post_activation_live_mode",
  "operational_enabled",
  "lifecycle_enabled",
  "disposition_permits_effect",
  "source_company_active",
  "source_granularity_active",
  "policy_permits_effect",
] as const;

export type EffectGateEvaluation = {
  evaluated_gates: EvaluatedGate[];
  allowed: boolean;
  outcome: SynchronizationOutcome;
  reason: SynchronizationReasonCode;
};

export function createMongoSourcePolicyStore(): SourcePolicyStore {
  return {
    async findByNormalizedLabel(label) {
      const rows = await getGranotCrmSourceModel()
        .find({ normalized_granot_label: label })
        .lean()
        .exec();
      return rows.map((row) => ({
        id: String(row._id),
        enabled: row.enabled !== false,
        lifecycle_enabled: row.lifecycle_enabled === true,
        lifecycle_disposition: row.lifecycle_disposition ?? "deferred",
        lead_created_policy: row.lead_created_policy ?? "observation_only",
        lead_source_company: row.lead_source_company
          ? String(row.lead_source_company)
          : undefined,
        lifecycle_routes: (row.lifecycle_routes ?? []).map((route) => ({
          route_key: route.route_key,
          lead_model: route.lead_model,
          move_type: route.move_type,
          source_granularity_id: String(route.source_granularity_id),
        })),
        lifecycle_policy_version: row.lifecycle_policy_version ?? "",
        normalized_granot_label: row.normalized_granot_label ?? undefined,
      }));
    },
    async findCompany(id) {
      const row = await getLeadSourceCompanyModel().findById(id).lean().exec();
      return row ? { id: String(row._id), active: row.active === true } : null;
    },
    async findGranularity(id) {
      const row = await getLeadSourceGranularityModel().findById(id).lean().exec();
      return row
        ? {
            id: String(row._id),
            source_company_id: String(row.source_company),
            active: row.active === true,
            channel: row.channel,
            local: row.local ?? undefined,
          }
        : null;
    },
  };
}

export async function resolveSourcePolicy(
  facts: SourcePolicyLookupFacts,
  store: SourcePolicyStore = createMongoSourcePolicyStore(),
): Promise<SourcePolicyResolution> {
  void facts.provider_type;
  const normalized = normalizeGranotSourceLabel(facts.source_label);
  if (!normalized) {
    return {
      ok: false,
      outcome: "policy_blocked",
      reason: "source_unclassified",
    };
  }

  const matches = await store.findByNormalizedLabel(normalized);
  return resolveNormalizedMatches(matches, facts, store);
}

async function resolveNormalizedMatches(
  matches: SourcePolicyRow[],
  facts: SourcePolicyLookupFacts,
  store: SourcePolicyStore,
): Promise<SourcePolicyResolution> {
  if (matches.length === 0) {
    return {
      ok: false,
      outcome: "policy_blocked",
      reason: "source_unclassified",
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      outcome: "ambiguous",
      reason: "multiple_eligible_matches",
    };
  }

  const row = matches[0];
  if (!row) {
    return {
      ok: false,
      outcome: "policy_blocked",
      reason: "source_unclassified",
    };
  }

  const baseSnapshot: SourcePolicySnapshot = {
    granot_crm_source_id: row.id,
    lead_source_company_id: row.lead_source_company,
    lifecycle_disposition: row.lifecycle_disposition,
    lead_created_policy: row.lead_created_policy,
    lifecycle_policy_version: row.lifecycle_policy_version || undefined,
  };

  if (!row.enabled || !row.lifecycle_enabled) {
    return {
      ok: false,
      outcome: "policy_blocked",
      reason: "source_disabled",
      snapshot: baseSnapshot,
    };
  }

  if (row.lifecycle_disposition === "deferred") {
    return {
      ok: false,
      outcome: "deferred",
      reason: "source_deferred",
      snapshot: baseSnapshot,
    };
  }

  if (row.lifecycle_disposition === "referral_booking") {
    return { ok: true, snapshot: baseSnapshot };
  }

  if (!row.lead_source_company) {
    return {
      ok: false,
      outcome: "policy_blocked",
      reason: "target_source_company_inactive",
      snapshot: baseSnapshot,
    };
  }
  const company = await store.findCompany(row.lead_source_company);
  if (!company || !company.active) {
    return {
      ok: false,
      outcome: "policy_blocked",
      reason: "target_source_company_inactive",
      snapshot: baseSnapshot,
    };
  }

  const selected = await selectRoute(row, facts, store);
  if (!selected.ok) {
    return {
      ...selected,
      snapshot: baseSnapshot,
    };
  }

  return {
    ok: true,
    snapshot: {
      ...baseSnapshot,
      source_granularity_id: selected.route.source_granularity_id,
      selected_route_key: selected.route.route_key,
      selected_move_type: selected.route.move_type,
    },
  };
}

async function selectRoute(
  row: SourcePolicyRow,
  facts: SourcePolicyLookupFacts,
  store: SourcePolicyStore,
): Promise<
  | { ok: true; route: SourcePolicyRoute }
  | { ok: false; outcome: SynchronizationOutcome; reason: SynchronizationReasonCode }
> {
  const formRoutes = row.lifecycle_routes.filter((route) => route.lead_model === "FormLead");
  const callRoutes = row.lifecycle_routes.filter((route) => route.lead_model === "CallLead");
  if (formRoutes.length > 0 && callRoutes.length > 0) {
    return {
      ok: false,
      outcome: "conflict",
      reason: "missing_creation_route_data",
    };
  }

  let candidates = row.lifecycle_routes;
  if (formRoutes.length > 0) {
    const moveType = selectFormMoveType({
      origin_state: facts.origin_state,
      destination_state: facts.destination_state,
    });
    if (!moveType) {
      return {
        ok: false,
        outcome: "insufficient_creation_data",
        reason: "missing_creation_route_data",
      };
    }
    const exact = formRoutes.filter((route) => route.move_type === moveType);
    const any = formRoutes.filter((route) => route.move_type === "any");
    candidates = exact.length > 0 ? exact : any;
    if (candidates.length === 0) {
      return {
        ok: false,
        outcome: "insufficient_creation_data",
        reason: "missing_creation_route_data",
      };
    }
  }

  if (candidates.length !== 1) {
    return {
      ok: false,
      outcome: "ambiguous",
      reason: "missing_creation_route_data",
    };
  }

  const route = candidates[0];
  if (!route) {
    return {
      ok: false,
      outcome: "insufficient_creation_data",
      reason: "missing_creation_route_data",
    };
  }

  const granularity = await store.findGranularity(route.source_granularity_id);
  if (!granularity) {
    return {
      ok: false,
      outcome: "policy_blocked",
      reason: "missing_creation_route_data",
    };
  }
  if (row.lead_source_company && granularity.source_company_id !== row.lead_source_company) {
    return {
      ok: false,
      outcome: "conflict",
      reason: "source_scope_conflict",
    };
  }
  const expectedChannel = route.lead_model === "FormLead" ? "form" : "call";
  if (granularity.channel !== expectedChannel) {
    return {
      ok: false,
      outcome: "conflict",
      reason: "missing_creation_route_data",
    };
  }
  if (!granularity.active) {
    return {
      ok: false,
      outcome: "policy_blocked",
      reason: "target_source_granularity_inactive",
    };
  }
  return { ok: true, route };
}

export function evaluateEffectGates(facts: EffectGateFacts): EffectGateEvaluation {
  const dispositionAllowed = dispositionPermitsEffect(
    facts.disposition,
    facts.requested_effect,
  );
  const policyAllowed =
    policyPermitsEffect(facts.lead_created_policy, facts.requested_effect) &&
    facts.source_scope_eligible !== false;
  const liveMode = facts.receipt_post_activation && facts.processor_mode === "live";

  const evaluated_gates: EvaluatedGate[] = [
    { gate: "global_effect_flag", allowed: facts.global_effect_flag },
    { gate: "post_activation_live_mode", allowed: liveMode },
    { gate: "operational_enabled", allowed: facts.operational_enabled },
    { gate: "lifecycle_enabled", allowed: facts.lifecycle_enabled },
    { gate: "disposition_permits_effect", allowed: dispositionAllowed },
    { gate: "source_company_active", allowed: facts.source_company_active },
    { gate: "source_granularity_active", allowed: facts.source_granularity_active },
    { gate: "policy_permits_effect", allowed: policyAllowed },
  ];

  const allowed = evaluated_gates.every((gate) => gate.allowed);
  const blocking = firstBlockingReason(facts, {
    dispositionAllowed,
    policyAllowed,
    liveMode,
  });
  return {
    evaluated_gates,
    allowed,
    outcome: blocking.outcome,
    reason: blocking.reason,
  };
}

function dispositionPermitsEffect(
  disposition: GranotLifecycleDisposition,
  effect: RequestedLifecycleEffect,
): boolean {
  if (disposition === "deferred") {
    return false;
  }
  if (disposition === "referral_booking") {
    return (
      effect === "booking_reconciliation" || effect === "release_reconciliation"
    );
  }
  return true;
}

function policyPermitsEffect(
  policy: GranotLeadCreatedPolicy,
  effect: RequestedLifecycleEffect,
): boolean {
  if (effect === "booking_reconciliation" || effect === "release_reconciliation") {
    return true;
  }
  if (policy === "observation_only") {
    return false;
  }
  if (policy === "link_only") {
    return effect === "lead_link" || effect === "lead_enrichment";
  }
  return true;
}

function firstBlockingReason(
  facts: EffectGateFacts,
  computed: {
    dispositionAllowed: boolean;
    policyAllowed: boolean;
    liveMode: boolean;
  },
): { outcome: SynchronizationOutcome; reason: SynchronizationReasonCode } {
  if (!facts.global_effect_flag) {
    return { outcome: "policy_blocked", reason: "global_effect_disabled" };
  }
  if (!computed.liveMode) {
    return {
      outcome: "policy_blocked",
      reason:
        facts.processor_mode === "historical_shadow"
          ? "historical_shadow"
          : "shadow_effect_suppressed",
    };
  }
  if (!facts.operational_enabled || !facts.lifecycle_enabled) {
    return { outcome: "policy_blocked", reason: "source_disabled" };
  }
  if (facts.disposition === "deferred") {
    return { outcome: "deferred", reason: "source_deferred" };
  }
  if (!computed.dispositionAllowed) {
    return { outcome: "policy_blocked", reason: "source_deferred" };
  }
  if (!facts.source_company_active) {
    return { outcome: "policy_blocked", reason: "target_source_company_inactive" };
  }
  if (!facts.source_granularity_active) {
    return {
      outcome: "policy_blocked",
      reason: "target_source_granularity_inactive",
    };
  }
  if (facts.source_scope_eligible === false) {
    return { outcome: "conflict", reason: "source_scope_conflict" };
  }
  if (facts.lead_created_policy === "observation_only") {
    return { outcome: "policy_blocked", reason: "creation_policy_observation_only" };
  }
  if (facts.lead_created_policy === "link_only") {
    return { outcome: "policy_blocked", reason: "creation_policy_link_only" };
  }
  return { outcome: "policy_blocked", reason: "source_disabled" };
}
