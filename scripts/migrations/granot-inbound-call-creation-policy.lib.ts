import { LINK_ONLY_AUTOMATION_GRANULARITY_KEYS } from "./granot-lifecycle-source-registry.manifest";

export const INBOUND_CALL_CREATION_POLICY_SCRIPT_VERSION =
  "granot-inbound-call-creation-policy/1";

export const INBOUND_CALL_CREATION_POLICY_ACTOR_ID =
  "granot-inbound-call-creation-policy";

export const INBOUND_CALL_CREATION_POLICY_REASON =
  "Owner-authorized inbound Call create_if_missing flip for Main Site, 10best (TBM Call), TBM Prime, and Top10 Inbounds.";

export type InboundCallCreationFamily =
  | "main_site_call"
  | "tbm_call"
  | "tbm_prime_call"
  | "top10_call";

export type InboundCallCreationTarget = {
  family: InboundCallCreationFamily;
  granot_label: string;
  normalized_labels: readonly string[];
  company_slug: string;
  granularity_key: string;
};

export const INBOUND_CALL_CREATION_TARGETS: readonly InboundCallCreationTarget[] =
  [
    {
      family: "main_site_call",
      granot_label: "Main Site Inbounds",
      normalized_labels: ["main site inbounds"],
      company_slug: "main_site",
      granularity_key: LINK_ONLY_AUTOMATION_GRANULARITY_KEYS.main_site_call,
    },
    {
      family: "tbm_call",
      granot_label: "10best Inbounds",
      normalized_labels: ["10best inbounds"],
      company_slug: "tbm_leads",
      granularity_key: LINK_ONLY_AUTOMATION_GRANULARITY_KEYS.tbm_call,
    },
    {
      family: "tbm_prime_call",
      granot_label: "TBM Prime Inbounds",
      normalized_labels: ["tbm prime inbounds"],
      company_slug: "tbm_prime_leads",
      granularity_key: LINK_ONLY_AUTOMATION_GRANULARITY_KEYS.tbm_prime_call,
    },
    {
      family: "top10_call",
      granot_label: "Top10 Inbounds",
      normalized_labels: ["top10 inbounds"],
      company_slug: "top10_leads",
      granularity_key: LINK_ONLY_AUTOMATION_GRANULARITY_KEYS.top10_call,
    },
  ];

export type InboundCallCreationSourceRow = {
  id: string;
  granot_label: string;
  normalized_granot_label: string;
  crm_origin: string;
  workspace_slug: string;
  default_channel: "form" | "call" | "unknown";
  source_company: string;
  enabled: boolean;
  lifecycle_enabled: boolean;
  lifecycle_disposition: string;
  lead_created_policy: string;
  lead_source_company?: string;
  lifecycle_routes: Array<{
    route_key: string;
    lead_model: string;
    move_type: string;
    source_granularity_id: string;
  }>;
  lifecycle_policy_version: string;
  outbound_sms_enabled: boolean;
};

export type InboundCallCreationCompanyRow = {
  id: string;
  company_slug: string;
  active: boolean;
};

export type InboundCallCreationGranularityRow = {
  id: string;
  granularity_key: string;
  source_company_id: string;
  channel: string;
  active: boolean;
};

export type InboundCallCreationAssignmentRow = {
  id: string;
  source_company_id: string;
  source_granularity_id: string;
  route_id: string;
  active: boolean;
  effective_from: Date;
  effective_until?: Date | null;
};

export type InboundCallCreationRouteRow = {
  id: string;
  active: boolean;
  validation_status: string;
};

export type InboundCallCreationInventory = {
  sources: InboundCallCreationSourceRow[];
  companies: InboundCallCreationCompanyRow[];
  granularities: InboundCallCreationGranularityRow[];
  assignments: InboundCallCreationAssignmentRow[];
  routes: InboundCallCreationRouteRow[];
  now: Date;
};

export type InboundCallCreationFinding = {
  family: InboundCallCreationFamily;
  granot_label: string;
  source_id: string;
  company_slug: string;
  granularity_key: string;
  company_matches: boolean;
  granularity_matches: boolean;
  route_is_call_any: boolean;
  assignment_count: number;
  active_valid_assignment_count: number;
  current_policy: string;
  outbound_sms_enabled: boolean;
  ready: boolean;
  errors: string[];
};

export function targetForNormalizedLabel(
  normalized: string,
): InboundCallCreationTarget | undefined {
  return INBOUND_CALL_CREATION_TARGETS.find((target) =>
    target.normalized_labels.includes(normalized),
  );
}

export function isActiveAssignment(
  assignment: InboundCallCreationAssignmentRow,
  now: Date,
): boolean {
  return (
    assignment.active === true &&
    assignment.effective_from.getTime() <= now.getTime() &&
    (!assignment.effective_until ||
      assignment.effective_until.getTime() > now.getTime())
  );
}

export function verifyInboundCallCreationTargets(
  inventory: InboundCallCreationInventory,
): InboundCallCreationFinding[] {
  const findings: InboundCallCreationFinding[] = [];
  const seenFamilies = new Set<InboundCallCreationFamily>();

  for (const target of INBOUND_CALL_CREATION_TARGETS) {
    const matched = inventory.sources.filter((source) =>
      target.normalized_labels.includes(source.normalized_granot_label),
    );
    if (matched.length !== 1) {
      findings.push({
        family: target.family,
        granot_label: target.granot_label,
        source_id: "",
        company_slug: target.company_slug,
        granularity_key: target.granularity_key,
        company_matches: false,
        granularity_matches: false,
        route_is_call_any: false,
        assignment_count: 0,
        active_valid_assignment_count: 0,
        current_policy: "",
        outbound_sms_enabled: false,
        ready: false,
        errors: [
          matched.length === 0
            ? `Missing Granot CRM Source for ${target.granot_label}.`
            : `More than one Granot CRM Source matched ${target.granot_label}.`,
        ],
      });
      continue;
    }

    const source = matched[0]!;
    seenFamilies.add(target.family);
    const errors: string[] = [];
    const company = inventory.companies.find(
      (row) => row.id === source.lead_source_company,
    );
    const route = source.lifecycle_routes[0];
    const granularity = route
      ? inventory.granularities.find((row) => row.id === route.source_granularity_id)
      : undefined;
    const assignments = inventory.assignments.filter(
      (row) =>
        row.source_company_id === source.lead_source_company &&
        row.source_granularity_id === route?.source_granularity_id,
    );
    const active = assignments.filter((row) =>
      isActiveAssignment(row, inventory.now),
    );
    const activeValid = active.filter((row) => {
      const inboundRoute = inventory.routes.find((candidate) => candidate.id === row.route_id);
      return inboundRoute?.active === true && inboundRoute.validation_status === "valid";
    });

    const companyMatches =
      company?.company_slug === target.company_slug && company.active === true;
    const granularityMatches =
      granularity?.granularity_key === target.granularity_key &&
      granularity.channel === "call" &&
      granularity.active === true &&
      granularity.source_company_id === source.lead_source_company;
    const routeIsCallAny =
      source.lifecycle_routes.length === 1 &&
      route?.route_key === "call_any" &&
      route.lead_model === "CallLead" &&
      route.move_type === "any";

    if (source.default_channel !== "call") {
      errors.push(`${target.granot_label} default_channel is ${source.default_channel}, not call.`);
    }
    if (source.lifecycle_enabled !== true) {
      errors.push(`${target.granot_label} is not lifecycle_enabled.`);
    }
    if (source.lifecycle_disposition !== "source_scoped_lead") {
      errors.push(
        `${target.granot_label} disposition is ${source.lifecycle_disposition}, not source_scoped_lead.`,
      );
    }
    if (!company) {
      errors.push(`${target.granot_label} lead_source_company is missing.`);
    } else if (!companyMatches) {
      errors.push(
        `${target.granot_label} must reference active Source Company ${target.company_slug}.`,
      );
    }
    if (!granularity) {
      errors.push(`${target.granot_label} does not reference a loaded Source Granularity.`);
    } else if (!granularityMatches) {
      errors.push(
        `${target.granot_label} must reference active Call Source Granularity ${target.granularity_key} on ${target.company_slug}.`,
      );
    }
    if (!routeIsCallAny) {
      errors.push(`${target.granot_label} must have exactly one CallLead call_any route.`);
    }
    if (assignments.length > 0 && activeValid.length !== 1) {
      errors.push(
        `${target.granot_label} must have 0 assignment rows or exactly one active valid RingCentral assignment.`,
      );
    }
    if (source.outbound_sms_enabled) {
      errors.push(
        `${target.granot_label} already has outbound_sms enabled; this flip must not change texting.`,
      );
    }

    findings.push({
      family: target.family,
      granot_label: source.granot_label,
      source_id: source.id,
      company_slug: target.company_slug,
      granularity_key: target.granularity_key,
      company_matches: Boolean(companyMatches),
      granularity_matches: Boolean(granularityMatches),
      route_is_call_any: routeIsCallAny,
      assignment_count: assignments.length,
      active_valid_assignment_count: activeValid.length,
      current_policy: source.lead_created_policy,
      outbound_sms_enabled: source.outbound_sms_enabled,
      ready: errors.length === 0,
      errors,
    });
  }

  if (seenFamilies.size !== INBOUND_CALL_CREATION_TARGETS.length) {
    const missing = INBOUND_CALL_CREATION_TARGETS.filter(
      (target) => !seenFamilies.has(target.family),
    ).map((target) => target.family);
    if (missing.length > 0 && !findings.some((finding) => finding.errors.some((error) => error.includes("Missing")))) {
      throw new Error(`Missing inbound Call families: ${missing.join(", ")}.`);
    }
  }

  return findings;
}

export function assertInboundCallCreationReady(
  findings: InboundCallCreationFinding[],
): void {
  const blocked = findings.filter((finding) => !finding.ready);
  if (blocked.length > 0) {
    throw new Error(
      `Refusing inbound Call create_if_missing flip: ${blocked
        .flatMap((finding) => finding.errors)
        .join(" ")}`,
    );
  }
}
