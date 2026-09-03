import {
  INBOUND_CALL_CREATION_TARGETS,
  type InboundCallCreationCompanyRow,
  type InboundCallCreationFinding,
  type InboundCallCreationGranularityRow,
  type InboundCallCreationInventory,
  type InboundCallCreationSourceRow,
  type InboundCallCreationTarget,
} from "./granot-inbound-call-creation-policy.lib";

export const INBOUND_CALL_CREATION_REVERT_SCRIPT_VERSION =
  "granot-inbound-call-creation-policy-revert/1";

export const INBOUND_CALL_CREATION_REVERT_ACTOR_ID =
  "granot-inbound-call-creation-policy-revert";

export const INBOUND_CALL_CREATION_REVERT_REASON =
  "Owner-authorized inbound Granot CRM Source backfill: take create_if_missing off Main Site, 10best, TBM Prime, and Top10 Inbounds. Best Relocation Forms and Inbounds keep create_if_missing. Call Qualification remains the Call Lead qualifier for mapped inbound streams.";

export type InboundCallCreationRevertFamily = InboundCallCreationTarget["family"];

export type InboundCallCreationRevertTarget = InboundCallCreationTarget;

export const INBOUND_CALL_CREATION_REVERT_TARGETS: readonly InboundCallCreationRevertTarget[] =
  INBOUND_CALL_CREATION_TARGETS;

export type InboundCallCreationRevertFinding = InboundCallCreationFinding & {
  family: InboundCallCreationRevertFamily;
  would_deactivate_sms: boolean;
};

export function revertTargetForNormalizedLabel(
  normalized: string,
): InboundCallCreationRevertTarget | undefined {
  return INBOUND_CALL_CREATION_REVERT_TARGETS.find((target) =>
    target.normalized_labels.includes(normalized),
  );
}

export function verifyInboundCallCreationRevertTargets(
  inventory: InboundCallCreationInventory,
): InboundCallCreationRevertFinding[] {
  const findings: InboundCallCreationRevertFinding[] = [];
  const seenFamilies = new Set<InboundCallCreationRevertFamily>();

  for (const target of INBOUND_CALL_CREATION_REVERT_TARGETS) {
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
        would_deactivate_sms: false,
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

    const wouldDeactivateSms =
      source.lead_created_policy === "create_if_missing" &&
      source.outbound_sms_enabled === true;

    findings.push({
      family: target.family,
      granot_label: source.granot_label,
      source_id: source.id,
      company_slug: target.company_slug,
      granularity_key: target.granularity_key,
      company_matches: Boolean(companyMatches),
      granularity_matches: Boolean(granularityMatches),
      route_is_call_any: routeIsCallAny,
      assignment_count: 0,
      active_valid_assignment_count: 0,
      current_policy: source.lead_created_policy,
      outbound_sms_enabled: source.outbound_sms_enabled,
      would_deactivate_sms: wouldDeactivateSms,
      ready: errors.length === 0,
      errors,
    });
  }

  if (seenFamilies.size !== INBOUND_CALL_CREATION_REVERT_TARGETS.length) {
    const missing = INBOUND_CALL_CREATION_REVERT_TARGETS.filter(
      (target) => !seenFamilies.has(target.family),
    ).map((target) => target.family);
    if (
      missing.length > 0 &&
      !findings.some((finding) => finding.errors.some((error) => error.includes("Missing")))
    ) {
      throw new Error(`Missing inbound Call families: ${missing.join(", ")}.`);
    }
  }

  return findings;
}

export function assertInboundCallCreationRevertReady(
  findings: InboundCallCreationRevertFinding[],
): void {
  const blocked = findings.filter((finding) => !finding.ready);
  if (blocked.length > 0) {
    throw new Error(
      `Refusing inbound Call create_if_missing revert: ${blocked
        .flatMap((finding) => finding.errors)
        .join(" ")}`,
    );
  }
}

export function sourcesNeedingRevert(
  findings: InboundCallCreationRevertFinding[],
): InboundCallCreationRevertFinding[] {
  return findings.filter((finding) => finding.current_policy !== "link_only");
}

export type {
  InboundCallCreationCompanyRow,
  InboundCallCreationGranularityRow,
  InboundCallCreationInventory,
  InboundCallCreationSourceRow,
};
