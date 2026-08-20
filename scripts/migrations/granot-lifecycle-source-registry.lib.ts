import { maskReceiptId } from "./granot-lifecycle-migration.lib";
import {
  REVIEWED_SOURCE_CLASSIFICATION_MANIFEST,
  REVIEWED_SOURCE_COMPANY_SLUG,
  REVIEWED_GRANULARITY_KEYS,
  isExcludedProviderType,
  reviewedFamilyForNormalizedLabel,
  type ReviewedSourceFamilyKey,
  type ReviewedSourceFamilySpec,
  type ReviewedSourceRouteSpec,
} from "./granot-lifecycle-source-registry.manifest";
import { normalizeGranotSourceLabel } from "../../src/services/granotLifecycle/sourceLabel";
import type {
  GranotLeadCreatedPolicy,
  GranotLifecycleDisposition,
  LeadModel,
} from "../../src/services/granotLifecycle/types";

export const SOURCE_REGISTRY_MIGRATION_SCRIPT_VERSION =
  "granot-lifecycle-source-registry/1";

export const SOURCE_REGISTRY_MIGRATION_ACTOR_ID =
  "granot-lifecycle-source-registry";
export const SOURCE_REGISTRY_MIGRATION_REASON =
  "Unit 06 reviewed Granot source Registry classification apply";

export type InventoryCrmSource = {
  id: string;
  granot_label: string;
  normalized_granot_label?: string;
  enabled: boolean;
  lifecycle_enabled: boolean;
  lifecycle_disposition: GranotLifecycleDisposition;
  lead_created_policy: GranotLeadCreatedPolicy;
  lead_source_company?: string;
  lifecycle_routes: Array<{
    route_key: string;
    lead_model: LeadModel;
    move_type: "local" | "long_distance" | "any";
    source_granularity_id: string;
  }>;
  lifecycle_policy_version: string;
  crm_origin: string;
  workspace_slug: string;
  default_channel: "form" | "call" | "unknown";
  source_company: string;
};

export type InventoryAutomationSource = {
  id: string;
  label: string;
  active: boolean;
  supported_operations: Array<"form_leads" | "call_leads">;
  granot_crm_source?: string;
};

export type InventoryCompany = {
  id: string;
  company_slug: string;
  owner_label: string;
  active: boolean;
};

export type InventoryGranularity = {
  id: string;
  granularity_key: string;
  owner_label: string;
  source_company_id: string;
  channel: "form" | "call";
  local?: "local" | "long_distance";
  active: boolean;
};

export type SourceRegistryInventory = {
  crm_sources: InventoryCrmSource[];
  automation_sources: InventoryAutomationSource[];
  companies: InventoryCompany[];
  granularities: InventoryGranularity[];
  provider_types?: unknown[];
};

export type DependencyFindingCode =
  | "missing"
  | "inactive"
  | "duplicate"
  | "wrong_channel"
  | "wrong_move_type"
  | "company_mismatch";

export type DependencyFinding = {
  kind: "company" | "granularity";
  key: string;
  code: DependencyFindingCode;
  detail: string;
};

export type PlannedCrmMutation = {
  id: string;
  masked_id: string;
  granot_label: string;
  normalized_label: string;
  family?: ReviewedSourceFamilyKey;
  action: "classify" | "defer" | "noop";
  refused: boolean;
  refusal_reasons: string[];
  drift_fields: Array<
    | "lifecycle_enabled"
    | "lifecycle_disposition"
    | "lead_created_policy"
    | "lead_source_company"
    | "lifecycle_routes"
    | "lifecycle_policy_version"
    | "default_channel"
  >;
  intended: {
    lifecycle_enabled: boolean;
    lifecycle_disposition: GranotLifecycleDisposition;
    lead_created_policy: GranotLeadCreatedPolicy;
    lead_source_company?: string;
    lifecycle_routes: Array<{
      route_key: string;
      lead_model: LeadModel;
      move_type: "local" | "long_distance" | "any";
      source_granularity_id: string;
    }>;
    lifecycle_policy_version: string;
    default_channel: "form" | "call" | "unknown";
  };
};

export type PlannedAutomationMutation = {
  id: string;
  masked_id: string;
  label: string;
  normalized_label?: string;
  join_count: 0 | 1 | 2;
  current_reference?: string;
  intended_reference?: string;
  action: "link" | "noop" | "skip";
  refused: boolean;
  refusal_reasons: string[];
};

export type SourceRegistryPlan = {
  script_version: string;
  reviewed_labels: string[];
  excluded_provider_types: readonly string[];
  provider_type_auto_excluded: boolean;
  required_registry_keys: {
    company_slug: string;
    granularity_keys: string[];
  };
  dependency_findings: DependencyFinding[];
  required_dependencies_ok: boolean;
  normalized_label_collisions: Array<{
    normalized_granot_label: string;
    count: number;
    masked_ids: string[];
  }>;
  unknown_labels: Array<{ masked_id: string; granot_label: string; normalized_label?: string }>;
  crm_mutations: PlannedCrmMutation[];
  automation_mutations: PlannedAutomationMutation[];
  refused_families: ReviewedSourceFamilyKey[];
  unique_index_ready: boolean;
};

export type SourceRegistryApplyScope =
  | "all"
  | "best_relocation_creation_policy";

export function readSourceRegistryApplyScope(
  args: readonly string[],
): SourceRegistryApplyScope {
  const raw = args
    .find((arg) => arg.startsWith("--scope="))
    ?.slice("--scope=".length);
  if (!raw || raw === "all") return "all";
  if (raw === "best_relocation_creation_policy") return raw;
  throw new Error(`Unsupported source Registry apply scope: ${raw}`);
}

export function selectCrmMutationsForApply(
  plan: SourceRegistryPlan,
  scope: SourceRegistryApplyScope,
): SourceRegistryPlan["crm_mutations"] {
  if (scope === "all") return plan.crm_mutations;
  const scoped = plan.crm_mutations.filter(
    (mutation) =>
      mutation.family === "best_relocation_call" ||
      mutation.family === "best_relocation_form",
  );
  const families = new Set(scoped.map((mutation) => mutation.family));
  if (
    !families.has("best_relocation_call") ||
    !families.has("best_relocation_form")
  ) {
    throw new Error(
      "Refusing scoped apply: both Best Relocation source families must be present.",
    );
  }
  for (const mutation of scoped) {
    if (
      mutation.refused ||
      mutation.intended.lead_created_policy !== "create_if_missing" ||
      mutation.drift_fields.some((field) => field !== "lead_created_policy")
    ) {
      throw new Error(
        "Refusing scoped apply: Best Relocation drift is not limited to lead_created_policy.",
      );
    }
  }
  return scoped;
}

export function planGranotLifecycleSourceRegistry(
  inventory: SourceRegistryInventory,
): SourceRegistryPlan {
  const provider_type_auto_excluded = (inventory.provider_types ?? []).some(
    (value) => isExcludedProviderType(value),
  );
  const collisions = findCollisions(inventory.crm_sources);
  const collisionLabels = new Set(
    collisions.map((group) => group.normalized_granot_label),
  );
  const dependencies = resolveRequiredDependencies(inventory);
  const refusedFamilies = new Set<ReviewedSourceFamilyKey>();

  for (const family of REVIEWED_SOURCE_CLASSIFICATION_MANIFEST.families) {
    if (family.lifecycle_enabled && family.routes.length > 0) {
      if (!dependencies.ok) {
        refusedFamilies.add(family.family);
      }
    }
    for (const label of family.normalized_labels) {
      if (collisionLabels.has(label)) {
        refusedFamilies.add(family.family);
      }
    }
  }

  const crm_mutations = inventory.crm_sources
    .slice()
    .sort(compareCrm)
    .map((source) =>
      planCrmMutation(source, {
        collisionLabels,
        refusedFamilies,
        dependencies,
      }),
    );

  const classifiedByNormalized = new Map<string, PlannedCrmMutation[]>();
  for (const mutation of crm_mutations) {
    const current = classifiedByNormalized.get(mutation.normalized_label) ?? [];
    current.push(mutation);
    classifiedByNormalized.set(mutation.normalized_label, current);
  }

  const automation_mutations = inventory.automation_sources
    .slice()
    .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id))
    .map((source) =>
      planAutomationMutation(source, classifiedByNormalized, refusedFamilies),
    );

  const unknown_labels = crm_mutations
    .filter((mutation) => !mutation.family)
    .map((mutation) => ({
      masked_id: mutation.masked_id,
      granot_label: mutation.granot_label,
      ...(mutation.normalized_label
        ? { normalized_label: mutation.normalized_label }
        : {}),
    }));

  return {
    script_version: SOURCE_REGISTRY_MIGRATION_SCRIPT_VERSION,
    reviewed_labels: REVIEWED_SOURCE_CLASSIFICATION_MANIFEST.families.flatMap(
      (family) => [...family.normalized_labels],
    ),
    excluded_provider_types: REVIEWED_SOURCE_CLASSIFICATION_MANIFEST.excluded_provider_types,
    provider_type_auto_excluded,
    required_registry_keys: {
      company_slug: REVIEWED_SOURCE_COMPANY_SLUG,
      granularity_keys: Object.values(REVIEWED_GRANULARITY_KEYS),
    },
    dependency_findings: dependencies.findings,
    required_dependencies_ok: dependencies.ok,
    normalized_label_collisions: collisions,
    unknown_labels,
    crm_mutations,
    automation_mutations,
    refused_families: [...refusedFamilies].sort(),
    unique_index_ready: collisions.length === 0,
  };
}

export function intendedPolicyEqualsCurrent(
  source: InventoryCrmSource,
  intended: PlannedCrmMutation["intended"],
): boolean {
  return (
    source.lifecycle_enabled === intended.lifecycle_enabled &&
    source.lifecycle_disposition === intended.lifecycle_disposition &&
    source.lead_created_policy === intended.lead_created_policy &&
    (source.lead_source_company ?? "") === (intended.lead_source_company ?? "") &&
    source.lifecycle_policy_version === intended.lifecycle_policy_version &&
    source.default_channel === intended.default_channel &&
    sameRoutes(source.lifecycle_routes, intended.lifecycle_routes)
  );
}

export function sourcePolicyDriftFields(
  source: InventoryCrmSource,
  intended: PlannedCrmMutation["intended"],
): PlannedCrmMutation["drift_fields"] {
  const fields: PlannedCrmMutation["drift_fields"] = [];
  if (source.lifecycle_enabled !== intended.lifecycle_enabled) fields.push("lifecycle_enabled");
  if (source.lifecycle_disposition !== intended.lifecycle_disposition) fields.push("lifecycle_disposition");
  if (source.lead_created_policy !== intended.lead_created_policy) fields.push("lead_created_policy");
  if ((source.lead_source_company ?? "") !== (intended.lead_source_company ?? "")) fields.push("lead_source_company");
  if (!sameRoutes(source.lifecycle_routes, intended.lifecycle_routes)) fields.push("lifecycle_routes");
  if (source.lifecycle_policy_version !== intended.lifecycle_policy_version) fields.push("lifecycle_policy_version");
  if (source.default_channel !== intended.default_channel) fields.push("default_channel");
  return fields;
}

export function assertPlanHasNoForbiddenPayload(plan: SourceRegistryPlan): void {
  const serialized = JSON.stringify(plan);
  for (const forbidden of [
    "payload",
    "phone",
    "email",
    "authorization",
    "cookie",
    "x-api-secret",
    "password",
  ]) {
    if (serialized.toLowerCase().includes(`"${forbidden}"`)) {
      throw new Error(`Plan leaked forbidden key ${forbidden}.`);
    }
  }
}

function planCrmMutation(
  source: InventoryCrmSource,
  context: {
    collisionLabels: Set<string>;
    refusedFamilies: Set<ReviewedSourceFamilyKey>;
    dependencies: ResolvedDependencies;
  },
): PlannedCrmMutation {
  const normalized_label = effectiveNormalizedLabel(source);
  const family = normalized_label
    ? reviewedFamilyForNormalizedLabel(normalized_label)
    : undefined;
  const refusal_reasons: string[] = [];
  if (!normalized_label) {
    refusal_reasons.push("normalized_label_missing");
  }
  if (family && context.collisionLabels.has(normalized_label)) {
    refusal_reasons.push("normalized_label_collision");
  }
  if (family && context.refusedFamilies.has(family.family)) {
    refusal_reasons.push("reviewed_family_refused");
  }

  const intended = family && refusal_reasons.length === 0
    ? intendedFromFamily(family, context.dependencies)
    : deferredIntended(source);

  const refused = Boolean(family && refusal_reasons.length > 0);
  const drift_fields = sourcePolicyDriftFields(source, intended);
  const already = drift_fields.length === 0;
  return {
    id: source.id,
    masked_id: maskReceiptId(source.id),
    granot_label: source.granot_label,
    normalized_label,
    ...(family ? { family: family.family } : {}),
    action: refused ? "defer" : already ? "noop" : family ? "classify" : "defer",
    refused,
    refusal_reasons,
    drift_fields,
    intended,
  };
}

function planAutomationMutation(
  source: InventoryAutomationSource,
  classifiedByNormalized: Map<string, PlannedCrmMutation[]>,
  refusedFamilies: Set<ReviewedSourceFamilyKey>,
): PlannedAutomationMutation {
  const normalized_label = normalizeGranotSourceLabel(source.label);
  const family = normalized_label
    ? reviewedFamilyForNormalizedLabel(normalized_label)
    : undefined;
  const matches = normalized_label
    ? (classifiedByNormalized.get(normalized_label) ?? []).filter(
        (mutation) => Boolean(mutation.family) && !mutation.refused,
      )
    : [];
  const join_count = (matches.length > 1 ? 2 : matches.length) as 0 | 1 | 2;
  const refusal_reasons: string[] = [];
  if (!family) {
    refusal_reasons.push("unreviewed_label");
  }
  if (family && refusedFamilies.has(family.family)) {
    refusal_reasons.push("reviewed_family_refused");
  }
  if (join_count === 0) {
    refusal_reasons.push("zero_registry_matches");
  }
  if (join_count > 1) {
    refusal_reasons.push("multiple_registry_matches");
  }
  const intended_reference =
    family && join_count === 1 && refusal_reasons.length === 0
      ? matches[0]?.id
      : undefined;
  const already =
    Boolean(intended_reference) && source.granot_crm_source === intended_reference;
  return {
    id: source.id,
    masked_id: maskReceiptId(source.id),
    label: source.label,
    ...(normalized_label ? { normalized_label } : {}),
    join_count,
    ...(source.granot_crm_source
      ? { current_reference: source.granot_crm_source }
      : {}),
    ...(intended_reference ? { intended_reference } : {}),
    action: intended_reference ? (already ? "noop" : "link") : "skip",
    refused: !intended_reference,
    refusal_reasons,
  };
}

function intendedFromFamily(
  family: ReviewedSourceFamilySpec,
  dependencies: ResolvedDependencies,
): PlannedCrmMutation["intended"] {
  const lead_source_company = family.company_slug
    ? dependencies.company?.id
    : undefined;
  const lifecycle_routes = family.routes.map((route) => ({
    route_key: route.route_key,
    lead_model: route.lead_model,
    move_type: route.move_type,
    source_granularity_id: dependencies.granularities[route.granularity_key]!.id,
  }));
  return {
    lifecycle_enabled: family.lifecycle_enabled,
    lifecycle_disposition: family.lifecycle_disposition,
    lead_created_policy: family.lead_created_policy,
    ...(lead_source_company ? { lead_source_company } : {}),
    lifecycle_routes,
    lifecycle_policy_version: family.lifecycle_enabled
      ? REVIEWED_SOURCE_CLASSIFICATION_MANIFEST.policy_version
      : "",
    default_channel: defaultChannelForFamily(family),
  };
}

function deferredIntended(
  source: InventoryCrmSource,
): PlannedCrmMutation["intended"] {
  return {
    lifecycle_enabled: false,
    lifecycle_disposition: "deferred",
    lead_created_policy: "observation_only",
    lifecycle_routes: [],
    lifecycle_policy_version: "",
    default_channel: source.default_channel,
  };
}

function defaultChannelForFamily(
  family: ReviewedSourceFamilySpec,
): "form" | "call" | "unknown" {
  if (family.family === "best_relocation_call") return "call";
  if (family.family === "best_relocation_form") return "form";
  return "unknown";
}

type ResolvedDependencies = {
  ok: boolean;
  findings: DependencyFinding[];
  company?: InventoryCompany;
  granularities: Record<string, InventoryGranularity>;
};

function resolveRequiredDependencies(
  inventory: SourceRegistryInventory,
): ResolvedDependencies {
  const findings: DependencyFinding[] = [];
  const companies = inventory.companies.filter(
    (company) => company.company_slug === REVIEWED_SOURCE_COMPANY_SLUG,
  );
  let company: InventoryCompany | undefined;
  if (companies.length === 0) {
    findings.push({
      kind: "company",
      key: REVIEWED_SOURCE_COMPANY_SLUG,
      code: "missing",
      detail: "Required Source Company is absent.",
    });
  } else if (companies.length > 1) {
    findings.push({
      kind: "company",
      key: REVIEWED_SOURCE_COMPANY_SLUG,
      code: "duplicate",
      detail: "Required Source Company is duplicated.",
    });
  } else if (!companies[0]?.active) {
    findings.push({
      kind: "company",
      key: REVIEWED_SOURCE_COMPANY_SLUG,
      code: "inactive",
      detail: "Required Source Company is inactive.",
    });
  } else {
    company = companies[0];
  }

  const granularities: Record<string, InventoryGranularity> = {};
  const specs: ReviewedSourceRouteSpec[] =
    REVIEWED_SOURCE_CLASSIFICATION_MANIFEST.families.flatMap((family) => [
      ...family.routes,
    ]);
  for (const spec of specs) {
    const matches = inventory.granularities.filter(
      (row) => row.granularity_key === spec.granularity_key,
    );
    if (matches.length === 0) {
      findings.push({
        kind: "granularity",
        key: spec.granularity_key,
        code: "missing",
        detail: "Required Source Granularity is absent.",
      });
      continue;
    }
    if (matches.length > 1) {
      findings.push({
        kind: "granularity",
        key: spec.granularity_key,
        code: "duplicate",
        detail: "Required Source Granularity is duplicated.",
      });
      continue;
    }
    const row = matches[0]!;
    if (!row.active) {
      findings.push({
        kind: "granularity",
        key: spec.granularity_key,
        code: "inactive",
        detail: "Required Source Granularity is inactive.",
      });
    }
    if (row.channel !== spec.expected_channel) {
      findings.push({
        kind: "granularity",
        key: spec.granularity_key,
        code: "wrong_channel",
        detail: `Expected channel ${spec.expected_channel}.`,
      });
    }
    if (spec.expected_local && row.local !== spec.expected_local) {
      findings.push({
        kind: "granularity",
        key: spec.granularity_key,
        code: "wrong_move_type",
        detail: `Expected move type ${spec.expected_local}.`,
      });
    }
    if (company && row.source_company_id !== company.id) {
      findings.push({
        kind: "granularity",
        key: spec.granularity_key,
        code: "company_mismatch",
        detail: "Granularity does not belong to the reviewed Source Company.",
      });
    }
    if (
      row.active &&
      row.channel === spec.expected_channel &&
      (!spec.expected_local || row.local === spec.expected_local) &&
      (!company || row.source_company_id === company.id)
    ) {
      granularities[spec.granularity_key] = row;
    }
  }

  return {
    ok: findings.length === 0 && Boolean(company) && specs.every((spec) => granularities[spec.granularity_key]),
    findings,
    ...(company ? { company } : {}),
    granularities,
  };
}

function findCollisions(sources: InventoryCrmSource[]) {
  const groups = new Map<string, { count: number; masked_ids: string[] }>();
  for (const source of sources) {
    const label = effectiveNormalizedLabel(source);
    if (!label) continue;
    const current = groups.get(label) ?? {
      count: 0,
      masked_ids: [],
    };
    current.count += 1;
    current.masked_ids.push(maskReceiptId(source.id));
    groups.set(label, current);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.count > 1)
    .map(([normalized_granot_label, group]) => ({
      normalized_granot_label,
      count: group.count,
      masked_ids: group.masked_ids.sort(),
    }))
    .sort((left, right) =>
      left.normalized_granot_label.localeCompare(right.normalized_granot_label),
    );
}

function sameRoutes(
  left: PlannedCrmMutation["intended"]["lifecycle_routes"],
  right: PlannedCrmMutation["intended"]["lifecycle_routes"],
): boolean {
  if (left.length !== right.length) return false;
  const sort = (routes: typeof left) =>
    routes
      .slice()
      .sort((a, b) => a.route_key.localeCompare(b.route_key))
      .map((route) =>
        `${route.route_key}:${route.lead_model}:${route.move_type}:${route.source_granularity_id}`,
      );
  return sort(left).join("|") === sort(right).join("|");
}

function effectiveNormalizedLabel(source: InventoryCrmSource): string {
  return (
    source.normalized_granot_label ||
    normalizeGranotSourceLabel(source.granot_label) ||
    ""
  );
}

function compareCrm(left: InventoryCrmSource, right: InventoryCrmSource): number {
  return (
    left.workspace_slug.localeCompare(right.workspace_slug) ||
    left.granot_label.localeCompare(right.granot_label) ||
    left.id.localeCompare(right.id)
  );
}
