import type {
  GranotLeadCreatedPolicy,
  GranotLifecycleDisposition,
  LeadModel,
} from "../services/granotLifecycle/types";
import {
  hasControlOrBidiCharacters,
  normalizeGranotSourceLabel,
} from "../services/granotLifecycle/sourceLabel";

export const GRANOT_LIFECYCLE_DISPOSITIONS = [
  "source_scoped_lead",
  "referral_booking",
  "deferred",
] as const satisfies readonly GranotLifecycleDisposition[];

export const GRANOT_LEAD_CREATED_POLICIES = [
  "link_only",
  "create_if_missing",
  "observation_only",
] as const satisfies readonly GranotLeadCreatedPolicy[];

export const GRANOT_LIFECYCLE_LEAD_MODELS = [
  "FormLead",
  "CallLead",
] as const satisfies readonly LeadModel[];

export const GRANOT_LIFECYCLE_MOVE_TYPES = [
  "local",
  "long_distance",
  "any",
] as const;

export type GranotLifecycleMoveType = (typeof GRANOT_LIFECYCLE_MOVE_TYPES)[number];

export type GranotCrmSourceRouteInput = {
  route_key: string;
  lead_model: LeadModel;
  move_type: GranotLifecycleMoveType;
  source_granularity_id: string;
};

export type GranotCrmSourceSemanticsInput = {
  granot_label?: string;
  normalized_granot_label?: string;
  enabled: boolean;
  lifecycle_enabled: boolean;
  lifecycle_disposition: GranotLifecycleDisposition;
  lead_created_policy: GranotLeadCreatedPolicy;
  lead_source_company?: string;
  lifecycle_routes: GranotCrmSourceRouteInput[];
  lifecycle_policy_version?: string;
};

export type LoadedSourceCompanyRef = {
  id: string;
  active: boolean;
};

export type LoadedGranularityRef = {
  id: string;
  source_company_id: string;
  active: boolean;
  channel: "form" | "call";
  local?: "local" | "long_distance";
};

export type GranotCrmSourceSemanticsRefs = {
  company?: LoadedSourceCompanyRef | null;
  granularities?: ReadonlyMap<string, LoadedGranularityRef | null>;
};

export type GranotCrmSourceSemanticsResult =
  | { ok: true; normalized_granot_label?: string }
  | { ok: false; message: string };

export function validateGranotCrmSourceSemantics(
  input: GranotCrmSourceSemanticsInput,
  refs?: GranotCrmSourceSemanticsRefs,
): GranotCrmSourceSemanticsResult {
  const normalizedFromLabel =
    input.granot_label !== undefined
      ? normalizeGranotSourceLabel(input.granot_label)
      : undefined;
  const suppliedNormalized = optionalText(input.normalized_granot_label);

  if (input.granot_label !== undefined && !normalizedFromLabel) {
    return fail("granot_label must normalize to a nonempty control/bidi-safe label.");
  }
  if (suppliedNormalized) {
    if (hasControlOrBidiCharacters(suppliedNormalized)) {
      return fail("normalized_granot_label must not contain control or bidirectional characters.");
    }
    const reNormalized = normalizeGranotSourceLabel(suppliedNormalized);
    if (!reNormalized || reNormalized !== suppliedNormalized) {
      return fail("normalized_granot_label must already be NFKC, trimmed, collapsed, and lowercase.");
    }
    if (normalizedFromLabel && suppliedNormalized !== normalizedFromLabel) {
      return fail("normalized_granot_label must match the server-normalized granot_label.");
    }
  }

  const routes = input.lifecycle_routes ?? [];
  const structural = validateRouteStructure(input.lifecycle_disposition, routes);
  if (!structural.ok) {
    return structural;
  }

  if (
    input.lead_created_policy === "create_if_missing" &&
    input.lifecycle_disposition !== "source_scoped_lead"
  ) {
    return fail("create_if_missing is legal only for source_scoped_lead.");
  }

  if (
    (input.lifecycle_disposition === "referral_booking" ||
      input.lifecycle_disposition === "deferred") &&
    input.lead_created_policy !== "observation_only"
  ) {
    return fail("referral_booking and deferred require observation_only.");
  }

  if (input.lifecycle_disposition === "source_scoped_lead") {
    if (!optionalText(input.lead_source_company)) {
      return fail("source_scoped_lead requires a Source Company reference.");
    }
    if (routes.length === 0) {
      return fail("source_scoped_lead requires at least one lifecycle route.");
    }
  } else if (routes.length > 0) {
    return fail("referral_booking and deferred must not have Lead routes.");
  }

  if (input.lifecycle_enabled) {
    if (!input.enabled) {
      return fail("lifecycle_enabled requires operational enabled.");
    }
    if (!optionalText(input.lifecycle_policy_version)) {
      return fail("lifecycle_enabled requires a nonempty lifecycle_policy_version.");
    }
    if (input.lifecycle_disposition === "source_scoped_lead" && !normalizedFromLabel && !suppliedNormalized) {
      return fail("lifecycle_enabled requires a normalized Granot source label.");
    }
  }

  if (refs) {
    const contextual = validateContextualRefs(input, refs);
    if (!contextual.ok) {
      return contextual;
    }
  }

  return {
    ok: true,
    normalized_granot_label: suppliedNormalized ?? normalizedFromLabel,
  };
}

function validateRouteStructure(
  disposition: GranotLifecycleDisposition,
  routes: GranotCrmSourceRouteInput[],
): GranotCrmSourceSemanticsResult {
  const keys = new Set<string>();
  const selectors = new Set<string>();
  for (const route of routes) {
    const key = optionalText(route.route_key);
    if (!key) {
      return fail("route_key must be nonempty.");
    }
    if (hasControlOrBidiCharacters(key)) {
      return fail("route_key must not contain control or bidirectional characters.");
    }
    if (keys.has(key)) {
      return fail("route_key must be unique within the source.");
    }
    keys.add(key);

    if (!GRANOT_LIFECYCLE_LEAD_MODELS.includes(route.lead_model)) {
      return fail("route lead_model is invalid.");
    }
    if (!GRANOT_LIFECYCLE_MOVE_TYPES.includes(route.move_type)) {
      return fail("route move_type is invalid.");
    }
    if (!optionalText(route.source_granularity_id)) {
      return fail("each route requires a source_granularity_id.");
    }

    const selector = `${route.lead_model}:${route.move_type}`;
    if (selectors.has(selector)) {
      return fail("duplicate route selectors are not allowed.");
    }
    selectors.add(selector);
  }

  if (disposition !== "source_scoped_lead") {
    return { ok: true };
  }

  const formRoutes = routes.filter((route) => route.lead_model === "FormLead");
  const callRoutes = routes.filter((route) => route.lead_model === "CallLead");
  if (formRoutes.length > 0 && callRoutes.length > 0) {
    return fail("Call and Form routes cannot be mixed on one source.");
  }

  if (callRoutes.length > 0) {
    if (
      callRoutes.length !== 1 ||
      callRoutes[0]?.move_type !== "any" ||
      formRoutes.length > 0
    ) {
      return fail("Call routing must be exactly one CallLead + any route and no Form route.");
    }
    return { ok: true };
  }

  if (formRoutes.length === 1 && formRoutes[0]?.move_type === "any") {
    return { ok: true };
  }
  if (
    formRoutes.length === 2 &&
    formRoutes.some((route) => route.move_type === "local") &&
    formRoutes.some((route) => route.move_type === "long_distance") &&
    formRoutes.every((route) => route.move_type !== "any")
  ) {
    return { ok: true };
  }
  return fail(
    "Form routing must be exactly one FormLead + any route, or exactly one local plus one long-distance route.",
  );
}

function validateContextualRefs(
  input: GranotCrmSourceSemanticsInput,
  refs: GranotCrmSourceSemanticsRefs,
): GranotCrmSourceSemanticsResult {
  const companyId = optionalText(input.lead_source_company);
  if (companyId) {
    if (refs.company === undefined) {
      return fail("Source Company reference was not loaded.");
    }
    if (refs.company === null) {
      return fail("Source Company reference is missing.");
    }
    if (refs.company.id !== companyId) {
      return fail("Source Company reference does not match the loaded company.");
    }
    if (input.lifecycle_enabled && !refs.company.active) {
      return fail("source_scoped_lead requires an active Source Company.");
    }
  }

  for (const route of input.lifecycle_routes) {
    const granularityId = optionalText(route.source_granularity_id);
    if (!granularityId) {
      return fail("each route requires a source_granularity_id.");
    }
    if (!refs.granularities) {
      return fail("Source Granularity references were not loaded.");
    }
    const granularity = refs.granularities.get(granularityId);
    if (granularity === undefined) {
      return fail("Source Granularity reference was not loaded.");
    }
    if (granularity === null) {
      return fail("Source Granularity reference is missing.");
    }
    if (companyId && granularity.source_company_id !== companyId) {
      return fail("each route must belong to the source Source Company.");
    }
    const expectedChannel = route.lead_model === "FormLead" ? "form" : "call";
    if (granularity.channel !== expectedChannel) {
      return fail("route lead_model must match the Source Granularity channel.");
    }
    if (route.move_type !== "any") {
      if (granularity.local !== route.move_type) {
        return fail("route move_type must match the Source Granularity local semantics.");
      }
    }
    if (input.lifecycle_enabled && !granularity.active) {
      return fail("lifecycle-enabled routes require an active Source Granularity.");
    }
  }

  return { ok: true };
}

function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function fail(message: string): GranotCrmSourceSemanticsResult {
  return { ok: false, message };
}
