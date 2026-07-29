import { connectMongo } from "../../../db";
import { Agent } from "../../../models/Agent";
import { Merchant } from "../../../models/Merchant";
import { getLeadSourceCompanyModel } from "../../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../../models/LeadSourceGranularity";
import { getCplRatePeriodModel } from "../../../models/CplRatePeriod";
import { getFormLeadModel } from "../../../models/FormLead";
import { getCallLeadModel } from "../../../models/CallLead";
import { getCplCorrectionJobModel } from "../../../models/CplCorrectionJob";
import { getRingCentralInboundRouteModel } from "../../../models/RingCentralInboundRoute";
import { getRingCentralInboundRouteAssignmentModel } from "../../../models/RingCentralInboundRouteAssignment";
import { OperationsRegistryChange } from "../../../models/OperationsRegistryChange";
import { getOperationalEventModel } from "../../../models/OperationalEvent";
import { getAdminProxySigningSecret } from "../config";
import {
  validateCplSchedule,
  type CplSchedulePeriod,
} from "../cplSchedule";
import type { RegistryHealthFinding, RegistryHealthResult } from "../types";
import {
  getRegistryRuntimeTelemetry,
  mergeDurableCompatibilityTelemetry,
  type RegistryCompatibilityConsumer,
  type RegistryRuntimeTelemetry,
} from "../runtimeTelemetry";

type RegistryHealthFindingDraft = Omit<
  RegistryHealthFinding,
  "first_observed_at" | "last_observed_at" | "actionable"
> &
  Partial<
    Pick<
      RegistryHealthFinding,
      "first_observed_at" | "last_observed_at" | "actionable"
    >
  >;

export async function getRegistryHealth(): Promise<RegistryHealthResult> {
  await connectMongo();

  const findings: RegistryHealthFindingDraft[] = [];
  const observationCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

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
    cplPeriods,
    unresolvedFormLeads,
    unresolvedCallLeads,
    failedCorrectionJobs,
    stalledCorrectionJobs,
    ringCentralRoutes,
    ringCentralAssignments,
    sourceResolutionEvents,
    compatibilityEvents,
    latestMigrationChange,
  ] = await Promise.all([
    Agent.countDocuments({ active: false }),
    Merchant.countDocuments({ active: false }),
    getLeadSourceCompanyModel().find({}).lean().exec(),
    getLeadSourceGranularityModel().find({}).lean().exec(),
    getCplRatePeriodModel()
      .find({ archived_at: { $exists: false } })
      .sort({ source_granularity: 1, effective_from: 1 })
      .lean()
      .exec(),
    getFormLeadModel().countDocuments({
      cpl_resolution_status: "missing_rate",
    }),
    getCallLeadModel().countDocuments({
      cpl_resolution_status: "missing_rate",
    }),
    getCplCorrectionJobModel().countDocuments({ status: "failed" }),
    getCplCorrectionJobModel().countDocuments({
      status: "processing",
      leased_until: { $lte: new Date() },
    }),
    getRingCentralInboundRouteModel().find({}).lean().exec(),
    getRingCentralInboundRouteAssignmentModel().find({
      effective_until: { $exists: false },
    }).lean().exec(),
    getOperationalEventModel()
      .find({
        event_key: {
          $in: [
            "operations_registry.source_resolution_ambiguous",
            "operations_registry.source_resolution_not_found",
          ],
        },
        occurred_at: { $gte: observationCutoff },
      })
      .sort({ occurred_at: -1 })
      .limit(100)
      .lean()
      .exec(),
    getOperationalEventModel()
      .find({
        event_key: "operations_registry.compatibility_read",
        occurred_at: { $gte: observationCutoff },
      })
      .sort({ occurred_at: -1 })
      .limit(100)
      .lean()
      .exec(),
    OperationsRegistryChange.findOne({
      actor_id: { $regex: /^operations-registry-m\d+$/ },
    })
      .sort({ created_at: -1 })
      .lean()
      .exec(),
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
  const sourceCompanyById = new Map(
    sourceCompanies.map((company) => [String(company._id), company]),
  );
  const sourceGranularityById = new Map(
    sourceGranularities.map((granularity) => [String(granularity._id), granularity]),
  );
  const openAssignmentsByRoute = new Map<string, typeof ringCentralAssignments>();
  for (const assignment of ringCentralAssignments) {
    const routeId = String(assignment.route);
    openAssignmentsByRoute.set(routeId, [
      ...(openAssignmentsByRoute.get(routeId) ?? []),
      assignment,
    ]);
  }
  for (const route of ringCentralRoutes) {
    if (route.validation_status === "invalid") {
      findings.push({
        code: "registry.ringcentral_validation_failed",
        severity: "error",
        summary: "RingCentral route failed provider-account validation.",
        entity_type: "ringcentral_route",
        entity_id: String(route._id),
        last_observed_at:
          route.validated_at?.toISOString() ?? new Date().toISOString(),
        actionable: true,
        evidence: {
          validation_code: route.validation_code ?? "invalid",
        },
        remediation: {
          summary: "Correct the route metadata and re-run provider validation.",
          action: "validate_ringcentral_route",
        },
      });
    }
    if (!route.active) continue;
    const open = openAssignmentsByRoute.get(String(route._id)) ?? [];
    if (route.validation_status !== "valid" || open.length !== 1) {
      findings.push({
        code: "registry.ringcentral_route_inconsistent",
        severity: "error",
        summary:
          "Active RingCentral route requires valid account validation and exactly one open assignment.",
        entity_type: "ringcentral_route",
        entity_id: String(route._id),
        remediation: {
          summary: "Validate the route and repair its current assignment.",
          action: "edit_ringcentral_route",
        },
      });
      continue;
    }
    const assignment = open[0]!;
    const granularity = sourceGranularityById.get(
      String(assignment.source_granularity),
    );
    const company = sourceCompanyById.get(String(assignment.source_company));
    if (
      !assignment.active ||
      !granularity?.active ||
      granularity.channel !== "call" ||
      !company?.active ||
      String(granularity.source_company) !== String(company._id)
    ) {
      findings.push({
        code: "registry.ringcentral_assignment_inconsistent",
        severity: "error",
        summary:
          "RingCentral route assignment targets an inactive or invalid source.",
        entity_type: "ringcentral_route",
        entity_id: String(route._id),
        remediation: {
          summary: "Reassign the route to an active call granularity.",
          action: "reassign_ringcentral_route",
        },
      });
    }
  }
  findings.push(
    ...buildCplRegistryHealthFindings(
      sourceGranularities
        .filter((granularity) => granularity.active)
        .map((granularity) => String(granularity._id)),
      cplPeriods.map((period) => ({
        id: String(period._id),
        source_granularity_id: String(period.source_granularity),
        amount_cents: period.amount_cents,
        effective_from: period.effective_from,
        effective_until: period.effective_until ?? undefined,
        effective_from_date: period.effective_from_date,
        effective_until_date_exclusive:
          period.effective_until_date_exclusive ?? undefined,
        business_timezone: "America/New_York" as const,
      })),
      unresolvedFormLeads + unresolvedCallLeads,
      failedCorrectionJobs,
      stalledCorrectionJobs,
    ),
  );
  const runtimeTelemetry = mergeDurableCompatibilityTelemetry(
    getRegistryRuntimeTelemetry(),
    compatibilityEvents
      .map((event) => {
        const path = event.details.compatibility_path;
        const consumer = event.details.consumer_category;
        return typeof path === "string" && isCompatibilityConsumer(consumer)
          ? {
              path,
              consumer_category: consumer,
              occurred_at: event.occurred_at,
            }
          : null;
      })
      .filter(
        (
          event,
        ): event is {
          path: string;
          consumer_category: RegistryCompatibilityConsumer;
          occurred_at: Date;
        } => event !== null,
      ),
  );
  findings.push(...buildRuntimeRegistryHealthFindings(runtimeTelemetry));
  findings.push(
    ...buildSourceResolutionEventFindings(
      sourceResolutionEvents.map((event) => ({
        event_key: event.event_key,
        occurred_at: event.occurred_at,
      })),
    ),
  );
  findings.push(
    latestMigrationChange
      ? {
          code: "registry.migration_evidence_present",
          severity: "info",
          summary: "An applied Operations Registry migration audit record is present.",
          entity_type: "registry_migration",
          entity_id: latestMigrationChange.actor_id,
          first_observed_at: latestMigrationChange.created_at.toISOString(),
          last_observed_at: latestMigrationChange.created_at.toISOString(),
          actionable: false,
          evidence: {
            request_id: latestMigrationChange.request_id,
          },
          remediation: {
            summary: "Retain the corresponding migration manifest with rollout evidence.",
          },
        }
      : {
          code: "registry.migration_evidence_missing",
          severity: "warn",
          summary: "No applied Operations Registry migration audit record is present.",
          entity_type: "registry_migration",
          actionable: true,
          remediation: {
            summary:
              "Run approved migrations in order and retain their manifests before cutover.",
            action: "review_migration_manifests",
          },
        },
  );

  return {
    generated_at: new Date().toISOString(),
    findings: finalizeHealthFindings(findings),
  };
}

export function buildSourceResolutionEventFindings(
  events: readonly { event_key: string; occurred_at: Date }[],
): RegistryHealthFindingDraft[] {
  if (!events.length) return [];
  const ordered = [...events].sort(
    (left, right) => left.occurred_at.getTime() - right.occurred_at.getTime(),
  );
  const ambiguous = events.filter((event) =>
    event.event_key.endsWith("_ambiguous"),
  ).length;
  const missing = events.length - ambiguous;
  return [
    {
      code: "registry.source_resolution_failures",
      severity: "error",
      summary: `${missing} missing and ${ambiguous} ambiguous source resolution event(s) were observed in the latest bounded sample.`,
      entity_type: "source_granularity",
      first_observed_at: ordered[0]!.occurred_at.toISOString(),
      last_observed_at: ordered.at(-1)!.occurred_at.toISOString(),
      actionable: true,
      evidence: {
        sample_size: events.length,
        missing,
        ambiguous,
      },
      remediation: {
        summary:
          "Add or correct active source identifiers, aliases, priorities, and defaults.",
        action: "review_source_resolution",
      },
    },
  ];
}

export function buildRuntimeRegistryHealthFindings(
  telemetry: RegistryRuntimeTelemetry,
): RegistryHealthFindingDraft[] {
  const findings: RegistryHealthFindingDraft[] = [];
  for (const [resolver, state] of Object.entries(telemetry.resolvers)) {
    const expired =
      state.age_ms !== null &&
      state.max_age_ms !== null &&
      state.age_ms > state.max_age_ms;
    if (!state.serving_stale && !expired) continue;
    findings.push({
      code: "registry.cache_stale",
      severity: "error",
      summary: `${resolver} registry resolver is serving or holding a stale snapshot.`,
      entity_type: "registry_cache",
      entity_id: resolver,
      last_observed_at: state.last_success_at ?? new Date().toISOString(),
      actionable: true,
      evidence: {
        age_ms: state.age_ms,
        max_age_ms: state.max_age_ms,
        refresh_failures: state.refresh_failures,
        last_error_code: state.last_error_code,
        serving_stale: state.serving_stale,
      },
      remediation: {
        summary: "Restore registry refresh access and force a safe snapshot reload.",
        action: "refresh_registry_cache",
      },
    });
  }

  if (telemetry.compatibility_reads.length > 0) {
    const lastUsedAt = telemetry.compatibility_reads
      .map((item) => item.last_used_at)
      .sort()
      .at(-1)!;
    findings.push({
      code: "registry.compatibility_reads_remaining",
      severity: "warn",
      summary: `${telemetry.compatibility_reads.reduce(
        (sum, item) => sum + item.count,
        0,
      )} retained compatibility read(s) were observed in this server process.`,
      entity_type: "registry_compatibility",
      last_observed_at: lastUsedAt,
      actionable: true,
      evidence: {
        path_count: telemetry.compatibility_reads.length,
      },
      remediation: {
        summary:
          "Review consumer categories and retire each path after usage reaches zero.",
        action: "review_compatibility_reads",
      },
    });
  }
  return findings.sort((left, right) => left.code.localeCompare(right.code));
}

export function buildCplRegistryHealthFindings(
  activeGranularityIds: readonly string[],
  periods: readonly CplSchedulePeriod[],
  unresolvedLeadCount: number,
  failedCorrectionJobs = 0,
  stalledCorrectionJobs = 0,
): RegistryHealthFindingDraft[] {
  const findings: RegistryHealthFindingDraft[] = [];
  for (const granularityId of activeGranularityIds) {
    const schedule = periods.filter(
      (period) => period.source_granularity_id === granularityId,
    );
    try {
      validateCplSchedule(schedule, { active: true });
    } catch {
      findings.push({
        code: "registry.cpl_schedule_invalid",
        severity: "error",
        summary:
          "Active Source Granularity lacks continuous, non-overlapping CPL coverage.",
        entity_type: "source_granularity",
        entity_id: granularityId,
        remediation: {
          summary:
            "Add or correct periods so coverage is continuous with one open final period.",
          action: "edit_cpl_schedule",
        },
      });
    }
  }
  if (unresolvedLeadCount > 0) {
    findings.push({
      code: "registry.cpl_missing_rate_leads",
      severity: "error",
      summary: `${unresolvedLeadCount} production Lead(s) have unresolved CPL.`,
      entity_type: "cpl_schedule",
      remediation: {
        summary:
          "Correct schedule coverage, preview affected Leads, and run a correction job.",
        action: "preview_cpl_correction",
      },
    });
  }
  if (failedCorrectionJobs > 0 || stalledCorrectionJobs > 0) {
    findings.push({
      code: "registry.cpl_correction_jobs_unhealthy",
      severity: "error",
      summary: `${failedCorrectionJobs} failed and ${stalledCorrectionJobs} stalled CPL correction job(s).`,
      entity_type: "cpl_correction_job",
      remediation: {
        summary: "Review sanitized job errors and resume or replace the job.",
        action: "review_cpl_correction_jobs",
      },
    });
  }
  return findings;
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
): RegistryHealthFindingDraft[] {
  const findings: RegistryHealthFindingDraft[] = [];
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
): RegistryHealthFindingDraft[] {
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
): RegistryHealthFindingDraft[] {
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

function isCompatibilityConsumer(
  value: unknown,
): value is RegistryCompatibilityConsumer {
  return [
    "admin_list",
    "booking_legacy_parse",
    "enrichment",
    "reconciliation",
    "unknown",
  ].includes(String(value));
}

function finalizeHealthFindings(
  findings: readonly RegistryHealthFindingDraft[],
  observedAt = new Date(),
): RegistryHealthFinding[] {
  const fallbackObservedAt = observedAt.toISOString();
  return findings.map((finding) => ({
    ...finding,
    first_observed_at: finding.first_observed_at ?? fallbackObservedAt,
    last_observed_at: finding.last_observed_at ?? fallbackObservedAt,
    actionable:
      finding.actionable ?? Boolean(finding.remediation?.action),
  }));
}
