import type { CplResolution } from "../operationsRegistry";
import {
  resolveCpl,
  storedLeadTimestampToCplInstant,
} from "../operationsRegistry";
import { recordOperationalEvent } from "../observability";

export const LEAD_CPL_RESOLUTION_VERSION = "operations-registry-cpl-v1";

export type LeadCplSnapshot = {
  cpl: number;
  cpl_rate_period?: string | null;
  cpl_resolution_status: CplResolution["status"];
  cpl_resolved_at: Date;
  cpl_resolution_version: typeof LEAD_CPL_RESOLUTION_VERSION;
};

type ResolveLeadCplSnapshotInput = {
  sourceGranularityId?: string | null;
  storedBusinessTimestamp: Date;
  duplicate?: boolean;
  applicable?: boolean;
};

type LeadCplResolver = typeof resolveCpl;

export async function resolveLeadCplSnapshot(
  input: ResolveLeadCplSnapshotInput,
  deps: { resolver?: LeadCplResolver; now?: () => Date } = {},
): Promise<LeadCplSnapshot> {
  const resolution = await (deps.resolver ?? resolveCpl)({
    source_granularity_id: input.sourceGranularityId,
    business_timestamp: storedLeadTimestampToCplInstant(
      input.storedBusinessTimestamp,
    ),
    duplicate: input.duplicate,
    applicable: input.applicable,
  });
  const common = {
    cpl_resolution_status: resolution.status,
    cpl_resolved_at: (deps.now ?? (() => new Date()))(),
    cpl_resolution_version: LEAD_CPL_RESOLUTION_VERSION,
  } as const;

  switch (resolution.status) {
    case "resolved":
      return {
        ...common,
        cpl: resolution.amount,
        cpl_rate_period: resolution.period_id,
      };
    case "duplicate_zero":
      return {
        ...common,
        cpl: 0,
        cpl_rate_period: resolution.base_period_id ?? null,
      };
    case "missing_rate":
      return {
        ...common,
        cpl: resolution.fallback_amount,
        cpl_rate_period: null,
      };
    case "not_applicable":
      return { ...common, cpl: resolution.amount, cpl_rate_period: null };
  }
}

export async function recordMissingLeadCplRate(input: {
  leadModel: "FormLead" | "CallLead";
  leadId: string;
  sourceCompany: string;
  sourceGranularityId?: string | null;
  sourceGranularityKey?: string | null;
}): Promise<void> {
  await recordOperationalEvent({
    level: "error",
    eventKey: "lead.cpl.missing_rate",
    category: "lead",
    workflow: "lead_cpl_resolution",
    summary: "Lead saved without a covering CPL rate period.",
    sourceCompany: input.sourceCompany,
    entity: {
      type: input.leadModel === "FormLead" ? "form_lead" : "call_lead",
      id: input.leadId,
    },
    details: {
      lead_model: input.leadModel,
      source_granularity_id: input.sourceGranularityId ?? null,
      source_granularity_key: input.sourceGranularityKey ?? null,
      remediation: "Add or correct CPL schedule coverage, then run a correction job.",
    },
    dedupeKey: `lead.cpl.missing_rate:${input.leadModel}:${input.leadId}`,
    notificationCandidate: true,
    ownerVisible: true,
    piiPolicy: "none",
  });
}
