import { connectMongo } from "../../../db";
import { Agent } from "../../../models/Agent";
import { Merchant } from "../../../models/Merchant";
import { getLeadSourceCompanyModel } from "../../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../../models/LeadSourceGranularity";
import { getAdminProxySigningSecret } from "../config";
import type { RegistryHealthFinding, RegistryHealthResult } from "../types";

export async function getRegistryHealth(): Promise<RegistryHealthResult> {
  await connectMongo();

  const findings: RegistryHealthFinding[] = [];

  if (!getAdminProxySigningSecret()) {
    findings.push({
      code: "registry.signing_secret_missing",
      severity: "warn",
      summary: "Admin proxy signing secret is not configured.",
      remediation: {
        summary: "Set VANTAGE_ADMIN_PROXY_SIGNING_SECRET before enforcing registry mutations.",
        action: "configure_env",
      },
    });
  }

  const [
    inactiveAgentsUsedRecently,
    inactiveMerchantsCount,
    sourceCompanies,
    sourceGranularities,
  ] = await Promise.all([
    Agent.countDocuments({ active: false }),
    Merchant.countDocuments({ active: false }),
    getLeadSourceCompanyModel().find({}).lean().exec(),
    getLeadSourceGranularityModel().find({}).lean().exec(),
  ]);

  if (inactiveAgentsUsedRecently > 0) {
    findings.push({
      code: "registry.inactive_agents_present",
      severity: "info",
      summary: `${inactiveAgentsUsedRecently} inactive Agent record(s) are retained for historical references.`,
      entity_type: "agent",
      remediation: {
        summary: "Inactive agents remain valid for explicit owner selection but not automatic matching.",
      },
    });
  }

  if (inactiveMerchantsCount > 0) {
    findings.push({
      code: "registry.inactive_merchants_present",
      severity: "info",
      summary: `${inactiveMerchantsCount} inactive Merchant record(s) are retained for booking snapshots.`,
      entity_type: "merchant",
      remediation: {
        summary: "Inactive merchants remain valid for explicit owner booking selection.",
      },
    });
  }

  findings.push(
    ...buildSourceRegistryHealthFindings(
      sourceCompanies.map((company) => ({
        id: String(company._id),
        active: company.active,
        default_form_granularity: company.default_form_granularity
          ? String(company.default_form_granularity)
          : undefined,
        default_call_granularity: company.default_call_granularity
          ? String(company.default_call_granularity)
          : undefined,
      })),
      sourceGranularities.map((granularity) => ({
        id: String(granularity._id),
        source_company: String(granularity.source_company),
        channel: granularity.channel,
        active: granularity.active,
        crm_label: granularity.crm_label,
        source_sites: [...(granularity.source_sites ?? [])],
        aliases: [...(granularity.aliases ?? [])],
        priority: granularity.priority,
      })),
    ),
  );

  return {
    generated_at: new Date().toISOString(),
    findings,
  };
}

type HealthCompany = {
  id: string;
  active: boolean;
  default_form_granularity?: string;
  default_call_granularity?: string;
};

type HealthGranularity = {
  id: string;
  source_company: string;
  channel: "form" | "call";
  active: boolean;
  crm_label: string;
  source_sites: string[];
  aliases: string[];
  priority: number;
};

export function buildSourceRegistryHealthFindings(
  companies: readonly HealthCompany[],
  granularities: readonly HealthGranularity[],
): RegistryHealthFinding[] {
  const findings: RegistryHealthFinding[] = [];
  const activeCompanies = new Map(
    companies.filter((company) => company.active).map((company) => [company.id, company]),
  );
  const activeGranularities = granularities.filter((granularity) => granularity.active);

  for (const granularity of activeGranularities) {
    if (!activeCompanies.has(granularity.source_company)) {
      findings.push({
        code: "registry.source_granularity_inactive_company",
        severity: "error",
        summary: "Active Source Granularity belongs to a missing or inactive Source Company.",
        entity_type: "source_granularity",
        entity_id: granularity.id,
        remediation: {
          summary: "Activate the Source Company or deactivate this granularity.",
          action: "review_source_lifecycle",
        },
      });
    }
  }

  for (const company of activeCompanies.values()) {
    for (const channel of ["form", "call"] as const) {
      const channelRows = activeGranularities.filter(
        (granularity) =>
          granularity.source_company === company.id &&
          granularity.channel === channel,
      );
      if (!channelRows.length) continue;
      const defaultId =
        channel === "form"
          ? company.default_form_granularity
          : company.default_call_granularity;
      if (!defaultId || !channelRows.some((row) => row.id === defaultId)) {
        findings.push({
          code: "registry.source_default_invalid",
          severity: "error",
          summary: `Active ${channel} Source Granularities lack an active same-company default.`,
          entity_type: "source_company",
          entity_id: company.id,
          remediation: {
            summary: `Select an active ${channel} Source Granularity as the default.`,
            action: "set_source_default",
          },
        });
      }
    }
  }

  findings.push(
    ...collisionFindings(activeGranularities, "crm_label"),
    ...collisionFindings(activeGranularities, "source_site"),
    ...fallbackCollisionFindings(activeGranularities),
  );
  return findings.sort(
    (left, right) =>
      left.code.localeCompare(right.code) ||
      (left.entity_id ?? "").localeCompare(right.entity_id ?? ""),
  );
}

function collisionFindings(
  rows: readonly HealthGranularity[],
  kind: "crm_label" | "source_site",
): RegistryHealthFinding[] {
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    const values = kind === "crm_label" ? [row.crm_label] : row.source_sites;
    for (const rawValue of values) {
      const value = normalize(rawValue);
      if (!value) continue;
      const key = `${row.channel}:${value}`;
      groups.set(key, [...(groups.get(key) ?? []), row.id]);
    }
  }
  return [...groups.entries()]
    .filter(([, ids]) => new Set(ids).size > 1)
    .map(([identifier, ids]) => ({
      code: `registry.source_${kind}_ambiguous`,
      severity: "error" as const,
      summary: `Active Source Granularities share an exact ${kind.replace("_", " ")} identifier.`,
      remediation: {
        summary: `Make ${identifier} unique before automatic source resolution.`,
        action: "resolve_exact_identifier_conflict",
      },
    }));
}

function fallbackCollisionFindings(
  rows: readonly HealthGranularity[],
): RegistryHealthFinding[] {
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    for (const rawAlias of row.aliases) {
      const alias = normalize(rawAlias);
      if (!alias) continue;
      const key = `${row.channel}:${alias}:${row.priority}`;
      groups.set(key, [...(groups.get(key) ?? []), row.id]);
    }
  }
  return [...groups.entries()]
    .filter(([, ids]) => new Set(ids).size > 1)
    .map(([identifier]) => ({
      code: "registry.source_fallback_priority_ambiguous",
      severity: "error" as const,
      summary: "Fallback source alias has an equal-priority ambiguity.",
      remediation: {
        summary: `Change alias ownership or priority for ${identifier}.`,
        action: "resolve_fallback_priority_conflict",
      },
    }));
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}
