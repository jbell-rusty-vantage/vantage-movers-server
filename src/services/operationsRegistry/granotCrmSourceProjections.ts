import { GranotAutomationSource } from "../../models/GranotAutomationSource";
import { OperationsRegistryChange } from "../../models/OperationsRegistryChange";
import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../models/LeadSourceGranularity";
import {
  evaluateGranotAutomationCompatibility,
  type GranotAutomationSourceCompatibility,
} from "../granotLifecycle/automationCompatibility";
import {
  getRegistryGranotCrmSource,
  listRegistryGranotCrmSources,
  type GranotCrmSourceLifecycleRoute,
  type GranotCrmSourceRecord,
} from "./granotCrmSources";

export type GranotCrmSourceDependencyStatus =
  | "active"
  | "inactive"
  | "missing"
  | "wrong_channel"
  | "wrong_move_type";

export type GranotCrmSourceRouteProjection = GranotCrmSourceLifecycleRoute & {
  source_granularity_key?: string;
  source_granularity_label?: string;
  source_granularity_status: GranotCrmSourceDependencyStatus;
};

export type GranotCrmSourceAuditProjection = {
  id: string;
  action: string;
  actor_label: string;
  actor_role: string;
  reason?: string;
  created_at: string;
};

export type GranotCrmSourceProjection = GranotCrmSourceRecord & {
  lead_source_company_label?: string;
  lead_source_company_status?: GranotCrmSourceDependencyStatus;
  lifecycle_routes: GranotCrmSourceRouteProjection[];
  automation_sources: Array<{
    id: string;
    label: string;
    active: boolean;
    compatibility: GranotAutomationSourceCompatibility;
  }>;
  latest_audit?: GranotCrmSourceAuditProjection;
};

export async function listProjectedGranotCrmSources(): Promise<
  GranotCrmSourceProjection[]
> {
  const records = await listRegistryGranotCrmSources({ includeDisabled: true });
  return projectRecords(records);
}

export async function getProjectedGranotCrmSource(
  id: string,
): Promise<GranotCrmSourceProjection> {
  const record = await getRegistryGranotCrmSource(id);
  const [projected] = await projectRecords([record]);
  if (!projected) {
    throw new Error("Failed to project Granot CRM source.");
  }
  return projected;
}

async function projectRecords(
  records: GranotCrmSourceRecord[],
): Promise<GranotCrmSourceProjection[]> {
  const companyIds = unique(
    records
      .map((record) => record.lead_source_company)
      .filter((id): id is string => Boolean(id)),
  );
  const granularityIds = unique(
    records.flatMap((record) =>
      record.lifecycle_routes.map((route) => route.source_granularity_id),
    ),
  );
  const recordIds = records.map((record) => record.id);
  const [companies, granularities, automationRows, audits] = await Promise.all([
    companyIds.length
      ? getLeadSourceCompanyModel()
          .find({ _id: { $in: companyIds } })
          .select({ owner_label: 1, name: 1, active: 1 })
          .lean()
          .exec()
      : [],
    granularityIds.length
      ? getLeadSourceGranularityModel()
          .find({ _id: { $in: granularityIds } })
          .select({
            granularity_key: 1,
            owner_label: 1,
            channel: 1,
            local: 1,
            active: 1,
          })
          .lean()
          .exec()
      : [],
    recordIds.length
      ? GranotAutomationSource.find({ granot_crm_source: { $in: recordIds } })
          .select({ label: 1, active: 1, granot_crm_source: 1, supported_operations: 1 })
          .sort({ label: 1 })
          .lean()
          .exec()
      : [],
    recordIds.length
      ? OperationsRegistryChange.find({
          entity_type: "granot_crm_source",
          entity_id: { $in: recordIds },
        })
          .sort({ created_at: -1 })
          .lean()
          .exec()
      : [],
  ]);

  const companyById = new Map(
    companies.map((row) => [
      String(row._id),
      {
        label: String(row.owner_label ?? row.name ?? ""),
        active: row.active === true,
      },
    ]),
  );
  const granularityById = new Map<
    string,
    {
      key: string;
      label: string;
      channel: "form" | "call";
      local?: "local" | "long_distance";
      active: boolean;
    }
  >(
    granularities.map((row) => [
      String(row._id),
      {
        key: String(row.granularity_key ?? ""),
        label: String(row.owner_label ?? ""),
        channel: row.channel === "call" ? "call" : "form",
        local: row.local === "local" || row.local === "long_distance" ? row.local : undefined,
        active: row.active === true,
      },
    ]),
  );
  const labelCounts = new Map<string, number>();
  for (const record of records) {
    if (!record.normalized_granot_label) continue;
    labelCounts.set(
      record.normalized_granot_label,
      (labelCounts.get(record.normalized_granot_label) ?? 0) + 1,
    );
  }
  const latestAuditById = new Map<string, GranotCrmSourceAuditProjection>();
  for (const audit of audits) {
    const entityId = String(audit.entity_id);
    if (latestAuditById.has(entityId)) continue;
    latestAuditById.set(entityId, {
      id: String(audit._id),
      action: String(audit.action),
      actor_label: String(audit.actor_label),
      actor_role: String(audit.actor_role),
      ...(typeof audit.reason === "string" && audit.reason
        ? { reason: audit.reason }
        : {}),
      created_at:
        audit.created_at instanceof Date
          ? audit.created_at.toISOString()
          : String(audit.created_at),
    });
  }

  return records.map((record) => {
    const company = record.lead_source_company
      ? companyById.get(record.lead_source_company)
      : undefined;
    const lifecycle_routes = record.lifecycle_routes.map((route) => {
      const granularity = granularityById.get(route.source_granularity_id);
      return {
        ...route,
        ...(granularity?.key ? { source_granularity_key: granularity.key } : {}),
        ...(granularity?.label
          ? { source_granularity_label: granularity.label }
          : {}),
        source_granularity_status: routeStatus(route, granularity),
      };
    });
    const automation_sources = automationRows
      .filter((row) => String(row.granot_crm_source) === record.id)
      .map((row) => ({
        id: String(row._id),
        label: String(row.label),
        active: row.active !== false,
        compatibility: evaluateGranotAutomationCompatibility({
          granot_crm_source_id: record.id,
          requested_operations: (row.supported_operations ?? []).filter(
            (value): value is "form_leads" | "call_leads" =>
              value === "form_leads" || value === "call_leads",
          ),
          referenced: {
            id: record.id,
            enabled: record.enabled,
            lifecycle_enabled: record.lifecycle_enabled,
            lifecycle_disposition: record.lifecycle_disposition,
            lifecycle_routes: record.lifecycle_routes,
            normalized_granot_label: record.normalized_granot_label,
          },
          normalized_label_match_count: record.normalized_granot_label
            ? labelCounts.get(record.normalized_granot_label) ?? 1
            : 1,
        }),
      }));
    return {
      ...record,
      lifecycle_routes,
      ...(record.lead_source_company
        ? {
            lead_source_company_label: company?.label,
            lead_source_company_status: company
              ? company.active
                ? "active"
                : "inactive"
              : "missing",
          }
        : {}),
      automation_sources,
      ...(latestAuditById.get(record.id)
        ? { latest_audit: latestAuditById.get(record.id) }
        : {}),
    };
  });
}

function routeStatus(
  route: GranotCrmSourceLifecycleRoute,
  granularity:
    | {
        channel: "form" | "call";
        local?: "local" | "long_distance";
        active: boolean;
      }
    | undefined,
): GranotCrmSourceDependencyStatus {
  if (!granularity) return "missing";
  const expectedChannel = route.lead_model === "CallLead" ? "call" : "form";
  if (granularity.channel !== expectedChannel) return "wrong_channel";
  if (
    route.move_type !== "any" &&
    granularity.local &&
    granularity.local !== route.move_type
  ) {
    return "wrong_move_type";
  }
  return granularity.active ? "active" : "inactive";
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
