import { connectMongo } from "../../../db";
import { Agent } from "../../../models/Agent";
import { Merchant } from "../../../models/Merchant";
import { getLeadSourceCompanyModel } from "../../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../../models/LeadSourceGranularity";
import { getLeadSourceLabelMappingModel } from "../../../models/LeadSourceLabelMapping";
import { getGranotCrmSourceModel } from "../../../models/GranotCrmSource";
import {
  validateGranotCrmSourceSemantics,
  type GranotCrmSourceRouteInput,
} from "../../../models/granotCrmSourceSemantics";
import type {
  GranotLeadCreatedPolicy,
  GranotLifecycleDisposition,
} from "../../granotLifecycle/types";
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
    labelMappings,
    granotSources,
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
    getLeadSourceLabelMappingModel().find({}).lean().exec(),
    getGranotCrmSourceModel().find({}).lean().exec(),
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
  findings.push(
    ...buildRingCentralHealthFindings(
      ringCentralRoutes.map((route) => ({
        id: String(route._id),
        active: route.active === true,
        validation_status: String(route.validation_status ?? "unvalidated"),
        validation_code: route.validation_code ?? undefined,
        validated_at: route.validated_at instanceof Date ? route.validated_at : undefined,
        phone_number: route.phone_number,
      })),
      ringCentralAssignments.map((assignment) => ({
        route_id: String(assignment.route),
        source_company_id: String(assignment.source_company),
        source_granularity_id: String(assignment.source_granularity),
        active: assignment.active === true,
      })),
      sourceCompanies.map((company) => ({
        id: String(company._id),
        active: company.active === true,
      })),
      sourceGranularities.map((granularity) => ({
        id: String(granularity._id),
        source_company: String(granularity.source_company),
        active: granularity.active === true,
        channel: granularity.channel,
      })),
    ),
  );
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

  findings.push(
    ...buildLabelMappingHealthFindings(
      labelMappings.map((mapping) => ({
        id: String(mapping._id),
        namespace: String(mapping.namespace),
        normalized_label: String(mapping.normalized_label),
        source_company: String(mapping.source_company),
        source_granularity: String(mapping.source_granularity),
        active: mapping.active !== false,
      })),
      sourceCompanies.map((company) => ({
        id: String(company._id),
        active: company.active,
      })),
      sourceGranularities.map((granularity) => ({
        id: String(granularity._id),
        source_company: String(granularity.source_company),
        active: granularity.active,
      })),
    ),
  );

  findings.push(
    ...buildGranotSourceHealthFindings(
      granotSources.map((source) => ({
        id: String(source._id),
        enabled: source.enabled !== false,
        granot_label: source.granot_label,
        normalized_granot_label: source.normalized_granot_label ?? undefined,
        lifecycle_disposition: source.lifecycle_disposition ?? "deferred",
        lead_created_policy: source.lead_created_policy ?? "observation_only",
        lead_source_company: source.lead_source_company
          ? String(source.lead_source_company)
          : undefined,
        lifecycle_routes: (source.lifecycle_routes ?? []).map((route) => ({
          route_key: String(route.route_key ?? ""),
          lead_model: route.lead_model,
          move_type: route.move_type,
          source_granularity_id: String(route.source_granularity_id ?? ""),
        })),
        outbound_sms: source.outbound_sms
          ? {
              enabled: source.outbound_sms.enabled === true,
              consent_basis: source.outbound_sms.consent_basis,
              daily_cap: source.outbound_sms.daily_cap,
            }
          : undefined,
      })),
      sourceCompanies.map((company) => ({
        id: String(company._id),
        active: company.active === true,
      })),
      sourceGranularities.map((granularity) => ({
        id: String(granularity._id),
        source_company: String(granularity.source_company),
        active: granularity.active === true,
        channel: granularity.channel,
        local: granularity.local ?? undefined,
      })),
    ),
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
    const readCount = telemetry.compatibility_reads.reduce(
      (sum, item) => sum + item.count,
      0,
    );
    findings.push({
      code: "registry.compatibility_reads_remaining",
      severity: "warn",
      summary: `${readCount} compatibility read(s) used the old static list since the observation window opened on 2026-09-01. Removal is blocked until this count holds at zero.`,
      entity_type: "registry_compatibility",
      last_observed_at: lastUsedAt,
      actionable: true,
      evidence: {
        path_count: telemetry.compatibility_reads.length,
        read_count: readCount,
        observation_window_started_at: "2026-09-01",
        removal_blocked_until_zero: true,
      },
      remediation: {
        summary:
          "Removal of the old static list is blocked until compatibility reads hold at zero. Add official sheet or leftover names on the lead source that should own them.",
        action: "review_compatibility_reads",
      },
    });
  }
  return findings.sort((left, right) => left.code.localeCompare(right.code));
}

export function buildLabelMappingHealthFindings(
  mappings: readonly {
    id: string;
    namespace: string;
    normalized_label: string;
    source_company: string;
    source_granularity: string;
    active: boolean;
  }[],
  companies: readonly { id: string; active: boolean }[],
  granularities: readonly {
    id: string;
    source_company: string;
    active: boolean;
  }[],
): RegistryHealthFindingDraft[] {
  const findings: RegistryHealthFindingDraft[] = [];
  const companyById = new Map(companies.map((company) => [company.id, company]));
  const granularityById = new Map(
    granularities.map((granularity) => [granularity.id, granularity]),
  );
  const activeByKey = new Map<string, string[]>();

  for (const mapping of mappings) {
    if (mapping.active !== true) continue;
    const key = `${mapping.namespace}\0${mapping.normalized_label}`;
    activeByKey.set(key, [...(activeByKey.get(key) ?? []), mapping.id]);

    const feed = granularityById.get(mapping.source_granularity);
    const company = companyById.get(mapping.source_company);
    const destinationInvalid =
      !feed ||
      !company ||
      feed.active !== true ||
      company.active !== true ||
      feed.source_company !== mapping.source_company;
    if (!destinationInvalid) continue;
    findings.push({
      code: "registry.label_mapping_destination_invalid",
      severity: "error",
      summary:
        "Active label mapping points at a missing, inactive, or mismatched Feed / Lead Source.",
      entity_type: "source_label_mapping",
      entity_id: mapping.id,
      actionable: true,
      evidence: {
        namespace: mapping.namespace,
        normalized_label: mapping.normalized_label,
        source_company: mapping.source_company,
        source_granularity: mapping.source_granularity,
      },
      remediation: {
        summary:
          "Deactivate the mapping and create a replacement that points at an active Feed of the stored Lead Source.",
        action: "review_label_mapping",
      },
    });
  }

  for (const [key, ids] of activeByKey) {
    if (ids.length < 2) continue;
    const [namespace, normalizedLabel] = key.split("\0");
    findings.push({
      code: "registry.label_mapping_collision",
      severity: "error",
      summary: `Two active mappings share ${namespace} / ${normalizedLabel}. The unique index is missing or bypassed.`,
      entity_type: "source_label_mapping",
      entity_id: ids.slice().sort()[0],
      actionable: true,
      evidence: {
        namespace: namespace ?? "",
        normalized_label: normalizedLabel ?? "",
        mapping_count: ids.length,
      },
      remediation: {
        summary:
          "Restore the partial unique index and deactivate all but one of the colliding mappings.",
        action: "review_label_mapping_collision",
      },
    });
  }

  return findings;
}

export type GranotHealthSourceInput = {
  id: string;
  enabled: boolean;
  granot_label?: string;
  normalized_granot_label?: string;
  lifecycle_disposition: GranotLifecycleDisposition;
  lead_created_policy: GranotLeadCreatedPolicy;
  lead_source_company?: string;
  lifecycle_routes: Array<{
    route_key: string;
    lead_model: GranotCrmSourceRouteInput["lead_model"];
    move_type: GranotCrmSourceRouteInput["move_type"];
    source_granularity_id: string;
  }>;
  outbound_sms?: {
    enabled?: boolean;
    consent_basis?: string;
    daily_cap?: number;
  };
};

export function buildGranotSourceHealthFindings(
  sources: readonly GranotHealthSourceInput[],
  companies: readonly { id: string; active: boolean }[],
  feeds: readonly {
    id: string;
    source_company: string;
    active: boolean;
    channel?: "form" | "call";
    local?: "local" | "long_distance";
  }[],
): RegistryHealthFindingDraft[] {
  const findings: RegistryHealthFindingDraft[] = [];
  const companyById = new Map(companies.map((company) => [company.id, company]));
  const feedById = new Map(feeds.map((feed) => [feed.id, feed]));
  const byNormalized = new Map<string, string[]>();

  for (const source of sources) {
    const normalized = source.normalized_granot_label?.trim();
    if (normalized) {
      byNormalized.set(normalized, [...(byNormalized.get(normalized) ?? []), source.id]);
    }

    if (source.enabled) {
      const destinationInvalid = granotDestinationInvalid(source, companyById, feedById);
      if (destinationInvalid) {
        findings.push({
          code: "registry.granot_source_destination_invalid",
          severity: "error",
          summary:
            "Enabled Granot name points at a missing, inactive, or mismatched Lead Source or Feed.",
          entity_type: "granot_crm_source",
          entity_id: source.id,
          actionable: true,
          evidence: destinationInvalid,
          remediation: {
            summary:
              "Point this Granot name at an active Feed of an active Lead Source, or switch the name off.",
            action: "review_granot_name",
          },
        });
      }
    }

    const shape = validateGranotCrmSourceSemantics({
      granot_label: source.granot_label,
      normalized_granot_label: source.normalized_granot_label,
      enabled: source.enabled,
      lifecycle_enabled: false,
      lifecycle_disposition: source.lifecycle_disposition,
      lead_created_policy: source.lead_created_policy,
      lead_source_company: source.lead_source_company,
      lifecycle_routes: source.lifecycle_routes,
    });
    if (!shape.ok && isRouteShapeFailure(shape.message)) {
      findings.push({
        code: "registry.granot_source_route_shape_invalid",
        severity: "error",
        summary: "Granot name route shape is not one Feed, or one local plus one long-distance Form Feed.",
        entity_type: "granot_crm_source",
        entity_id: source.id,
        actionable: true,
        evidence: { message: shape.message },
        remediation: {
          summary: "Replace the routes with one Feed, or two Form Feeds keyed by move type.",
          action: "review_granot_name",
        },
      });
    }

    const smsOn = source.outbound_sms?.enabled === true;
    const sourceLevelGateFalse =
      source.lead_created_policy !== "create_if_missing" ||
      source.enabled !== true ||
      source.outbound_sms?.consent_basis === "not_attested" ||
      !source.outbound_sms?.consent_basis;
    if (smsOn && sourceLevelGateFalse) {
      findings.push({
        code: "registry.granot_sms_gate_inconsistent",
        severity: "error",
        summary: "Customer text is shown as on while a source-level gate is false.",
        entity_type: "granot_crm_source",
        entity_id: source.id,
        actionable: true,
        evidence: {
          outbound_sms_enabled: true,
          lead_created_policy: source.lead_created_policy,
          source_enabled: source.enabled,
          consent_basis: source.outbound_sms?.consent_basis ?? "not_attested",
        },
        remediation: {
          summary:
            "Turn customer text off, or restore create_if_missing, an enabled name, and an attested consent basis.",
          action: "review_granot_sms",
        },
      });
    }

    const dailyCap = source.outbound_sms?.daily_cap;
    if (typeof dailyCap === "number" && dailyCap > 0) {
      findings.push({
        code: "registry.granot_sms_daily_cap_configured",
        severity: "warn",
        summary: "A stored SMS daily cap is configured, but enforcement does not exist.",
        entity_type: "granot_crm_source",
        entity_id: source.id,
        actionable: true,
        evidence: { daily_cap: dailyCap },
        remediation: {
          summary:
            "Do not treat daily_cap as a working safety control. Leave the stored value until a reviewed migration removes it.",
          action: "review_granot_sms",
        },
      });
    }
  }

  for (const [normalized, ids] of byNormalized) {
    if (ids.length < 2) continue;
    findings.push({
      code: "registry.granot_source_label_collision",
      severity: "error",
      summary: `Two Granot names share the normalized spelling ${normalized}.`,
      entity_type: "granot_crm_source",
      entity_id: ids.slice().sort()[0],
      actionable: true,
      evidence: {
        normalized_granot_label: normalized,
        source_count: ids.length,
      },
      remediation: {
        summary: "Keep one exact spelling and deactivate or rename the other.",
        action: "review_granot_name_collision",
      },
    });
  }

  return findings;
}

function granotDestinationInvalid(
  source: GranotHealthSourceInput,
  companyById: Map<string, { id: string; active: boolean }>,
  feedById: Map<
    string,
    {
      id: string;
      source_company: string;
      active: boolean;
    }
  >,
): Record<string, string | number | boolean | null> | null {
  if (source.lifecycle_disposition !== "source_scoped_lead") {
    return null;
  }
  const companyId = source.lead_source_company;
  const company = companyId ? companyById.get(companyId) : undefined;
  if (!companyId || !company || company.active !== true) {
    return {
      lead_source_company: companyId ?? null,
      company_missing: !company,
      company_active: company?.active === true,
    };
  }
  if (source.lifecycle_routes.length === 0) {
    return { route_count: 0 };
  }
  for (const route of source.lifecycle_routes) {
    const feed = feedById.get(route.source_granularity_id);
    if (!feed || feed.active !== true || feed.source_company !== companyId) {
      return {
        feed_id: route.source_granularity_id,
        feed_missing: !feed,
        feed_active: feed?.active === true,
        feed_lead_source: feed?.source_company ?? null,
        source_lead_source: companyId,
      };
    }
  }
  return null;
}

function isRouteShapeFailure(message: string): boolean {
  return (
    message.includes("route") ||
    message.includes("Form routing") ||
    message.includes("Call routing") ||
    message.includes("Call and Form") ||
    message.includes("duplicate route")
  );
}

export function buildRingCentralHealthFindings(
  routes: readonly {
    id: string;
    active: boolean;
    validation_status: string;
    validation_code?: string | null;
    validated_at?: Date | null;
    phone_number?: string;
  }[],
  openAssignments: readonly {
    route_id: string;
    source_company_id: string;
    source_granularity_id: string;
    active: boolean;
  }[],
  companies: readonly { id: string; active: boolean }[],
  granularities: readonly {
    id: string;
    source_company: string;
    active: boolean;
    channel: "form" | "call";
  }[],
): RegistryHealthFindingDraft[] {
  const findings: RegistryHealthFindingDraft[] = [];
  const companyById = new Map(companies.map((company) => [company.id, company]));
  const granularityById = new Map(
    granularities.map((granularity) => [granularity.id, granularity]),
  );
  const openAssignmentsByRoute = new Map<string, typeof openAssignments[number][]>();
  for (const assignment of openAssignments) {
    openAssignmentsByRoute.set(assignment.route_id, [
      ...(openAssignmentsByRoute.get(assignment.route_id) ?? []),
      assignment,
    ]);
  }
  for (const route of routes) {
    if (route.validation_status === "invalid") {
      findings.push({
        code: "registry.ringcentral_validation_failed",
        severity: "error",
        summary: "RingCentral route failed provider-account validation.",
        entity_type: "ringcentral_route",
        entity_id: route.id,
        last_observed_at:
          route.validated_at?.toISOString() ?? new Date().toISOString(),
        actionable: true,
        evidence: {
          validation_code: route.validation_code ?? "invalid",
          ...(route.phone_number ? { phone_number: route.phone_number } : {}),
        },
        remediation: {
          summary: "Correct the route metadata and re-run provider validation.",
          action: "validate_ringcentral_route",
        },
      });
    }
    if (!route.active) continue;
    const open = openAssignmentsByRoute.get(route.id) ?? [];
    if (route.validation_status !== "valid" || open.length !== 1) {
      findings.push({
        code: "registry.ringcentral_route_inconsistent",
        severity: "error",
        summary:
          "Active RingCentral route requires valid account validation and exactly one open assignment.",
        entity_type: "ringcentral_route",
        entity_id: route.id,
        evidence: route.phone_number ? { phone_number: route.phone_number } : undefined,
        remediation: {
          summary: "Validate the route and repair its current assignment.",
          action: "edit_ringcentral_route",
        },
      });
      continue;
    }
    const assignment = open[0]!;
    const granularity = granularityById.get(assignment.source_granularity_id);
    const company = companyById.get(assignment.source_company_id);
    if (
      !assignment.active ||
      !granularity?.active ||
      granularity.channel !== "call" ||
      !company?.active ||
      granularity.source_company !== company.id
    ) {
      findings.push({
        code: "registry.ringcentral_assignment_inconsistent",
        severity: "error",
        summary:
          "RingCentral route assignment targets an inactive or invalid source.",
        entity_type: "ringcentral_route",
        entity_id: route.id,
        evidence: route.phone_number ? { phone_number: route.phone_number } : undefined,
        remediation: {
          summary: "Reassign the route to an active call granularity.",
          action: "reassign_ringcentral_route",
        },
      });
    }
  }
  return findings;
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
    "sheet_legacy_resolution",
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
