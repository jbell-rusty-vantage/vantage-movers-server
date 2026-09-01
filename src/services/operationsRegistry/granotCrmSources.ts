import type { ClientSession } from "mongoose";
import { getGranotCrmSourceModel } from "../../models/GranotCrmSource";
import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../models/LeadSourceGranularity";
import {
  validateGranotCrmSourceSemantics,
  type GranotCrmSourceRouteInput,
  type GranotCrmSourceSemanticsInput,
  type LoadedGranularityRef,
  type LoadedSourceCompanyRef,
} from "../../models/granotCrmSourceSemantics";
import { GRANOT_CRM_DEFAULT_ORIGIN } from "../../config/domain";
import { toObjectId, toObjectIdOrUndefined } from "../../utils/objectId";
import { REGISTRY_ERROR_CODES } from "../errors/registryErrorCodes";
import { RegistryError } from "./errors";
import { withRegistryMutation, type RegistryAuditDeps } from "./registryAudit";
import {
  GRANOT_LIFECYCLE_SOURCE_CACHE_KEYS,
  readGranotCrmSourceDetailCache,
  readGranotCrmSourceListCache,
  resetGranotCrmSourceCachesForTests,
  writeGranotCrmSourceDetailCache,
  writeGranotCrmSourceListCache,
} from "./granotCrmSourceCache";
import { normalizeGranotSourceLabel } from "../granotLifecycle/sourceLabel";
import type {
  GranotLeadCreatedPolicy,
  GranotLifecycleDisposition,
  LeadModel,
} from "../granotLifecycle/types";
import { toSmsView, type OwnerOutboundSmsView } from "./crmSourceOutboundSms";
import type { RegistryActorContext, RegistryAuditInput } from "./types";

export type GranotCrmSourceLifecycleRoute = {
  route_key: string;
  lead_model: LeadModel;
  move_type: "local" | "long_distance" | "any";
  source_granularity_id: string;
};

export type GranotCrmSourceRecord = {
  id: string;
  crm_origin: string;
  workspace_slug: string;
  granot_label: string;
  normalized_granot_label?: string;
  default_channel: "form" | "call" | "unknown";
  source_company: string;
  enabled: boolean;
  notes?: string;
  lifecycle_enabled: boolean;
  lifecycle_disposition: GranotLifecycleDisposition;
  lead_created_policy: GranotLeadCreatedPolicy;
  lead_source_company?: string;
  lifecycle_routes: GranotCrmSourceLifecycleRoute[];
  lifecycle_policy_version: string;
  outbound_sms?: OwnerOutboundSmsView;
  customer_text_turned_off_due_to_policy_change?: boolean;
};

export type GranotCrmSourceCommand = {
  id?: string;
  crm_origin?: string;
  workspace_slug?: string;
  granot_label?: string;
  normalized_granot_label?: string;
  default_channel?: "form" | "call" | "unknown";
  source_company?: string;
  enabled?: boolean;
  notes?: string | null;
  lifecycle_enabled?: boolean;
  lifecycle_disposition?: GranotLifecycleDisposition;
  lead_created_policy?: GranotLeadCreatedPolicy;
  lead_source_company?: string | null;
  lifecycle_routes?: GranotCrmSourceLifecycleRoute[];
  lifecycle_policy_version?: string;
  reason: string;
};

export type GranotCrmSourceLifecycleActivationCommand = {
  id: string;
  lifecycle_enabled: boolean;
  reason: string;
};

export async function listRegistryGranotCrmSources(options: {
  includeDisabled?: boolean;
} = {}): Promise<GranotCrmSourceRecord[]> {
  const cacheKey = options.includeDisabled ? "all" : "lifecycle_or_operational";
  const cached = readGranotCrmSourceListCache<GranotCrmSourceRecord[]>(cacheKey);
  if (cached) {
    return cached;
  }
  const rows = await getGranotCrmSourceModel()
    .find(options.includeDisabled ? {} : {})
    .sort({ workspace_slug: 1 })
    .lean()
    .exec();
  const items = rows.map((row) => toRecord(row as unknown as Record<string, unknown>));
  writeGranotCrmSourceListCache(cacheKey, items);
  return items;
}

export async function getRegistryGranotCrmSource(
  id: string,
): Promise<GranotCrmSourceRecord> {
  const cached = readGranotCrmSourceDetailCache<GranotCrmSourceRecord>(id);
  if (cached) {
    return cached;
  }
  const row = await getGranotCrmSourceModel().findById(id).lean().exec();
  if (!row) {
    throw notFound("Granot CRM source");
  }
  const item = toRecord(row as unknown as Record<string, unknown>);
  writeGranotCrmSourceDetailCache(id, item);
  return item;
}

export async function persistGranotCrmSourceInSession(
  command: GranotCrmSourceCommand,
  actor: RegistryActorContext,
  session: ClientSession,
): Promise<{ item: GranotCrmSourceRecord; audit: RegistryAuditInput }> {
  const reason = requiredReason(command.reason);
  const Source = getGranotCrmSourceModel();
  const audit = mutableAudit(command.id, reason);
  const before = command.id
    ? await Source.findById(command.id).session(session).lean().exec()
    : null;
  if (command.id && !before) {
    throw notFound("Granot CRM source");
  }
  const intended = intendedSemantics(command, before as Record<string, unknown> | null);
  const refs = await loadSemanticsRefs(intended, session);
  const validated = validateGranotCrmSourceSemantics(intended, refs);
  if (!validated.ok) {
    throw invalid(validated.message);
  }
  if (validated.normalized_granot_label) {
    const duplicate = await Source.findOne({
      normalized_granot_label: validated.normalized_granot_label,
      ...(command.id ? { _id: { $ne: command.id } } : {}),
    })
      .session(session)
      .select({ _id: 1 })
      .lean()
      .exec();
    if (duplicate) {
      throw duplicateNormalizedLabel();
    }
  }

  const update = buildUpdate(command, before as Record<string, unknown> | null, validated.normalized_granot_label);
  const smsOff = applySmsOffWhenPolicyLeavesCreateIfMissing(
    update,
    before as Record<string, unknown> | null,
    command,
  );
  const doc = command.id
    ? await Source.findByIdAndUpdate(
        command.id,
        { $set: update },
        { session, returnDocument: "after", runValidators: true },
      ).orFail()
    : first(
        await Source.create(
          [update as never],
          { session },
        ),
      );
  const item = toRecord(doc.toObject() as unknown as Record<string, unknown>);
  if (smsOff) {
    item.customer_text_turned_off_due_to_policy_change = true;
  }
  audit.entityId = item.id;
  audit.before = policyProjection(before as Record<string, unknown> | null);
  audit.after = policyProjection(item);
  audit.metadata = {
    request_id: actor.requestId,
    reason,
    ...(smsOff
      ? {
          customer_text_turned_off_due_to_policy_change: true,
          customer_text_review_sentence:
            "Customer text will be turned off because this Granot name will no longer create Leads.",
        }
      : {}),
  };
  return { item, audit };
}

export async function createOrUpdateGranotCrmSource(
  command: GranotCrmSourceCommand,
  actor: RegistryActorContext,
  deps: RegistryAuditDeps = {},
): Promise<GranotCrmSourceRecord> {
  assertOwner(actor);
  const audit = mutableAudit(command.id, requiredReason(command.reason));
  return withRegistryMutation({
    actor,
    audit,
    invalidateKeys: [...GRANOT_LIFECYCLE_SOURCE_CACHE_KEYS],
    mutate: async (session) => {
      const persisted = await persistGranotCrmSourceInSession(command, actor, session);
      audit.entityId = persisted.audit.entityId;
      audit.before = persisted.audit.before;
      audit.after = persisted.audit.after;
      audit.metadata = persisted.audit.metadata;
      return persisted.item;
    },
  }, deps);
}

export async function setGranotCrmSourceLifecycleEnabled(
  command: GranotCrmSourceLifecycleActivationCommand,
  actor: RegistryActorContext,
  deps: RegistryAuditDeps = {},
): Promise<GranotCrmSourceRecord> {
  const existing = await getGranotCrmSourceModel().findById(command.id).lean().exec();
  if (!existing) {
    throw notFound("Granot CRM source");
  }
  const current = toRecord(existing as unknown as Record<string, unknown>);
  return createOrUpdateGranotCrmSource(
    {
      id: command.id,
      crm_origin: current.crm_origin,
      workspace_slug: current.workspace_slug,
      granot_label: current.granot_label,
      normalized_granot_label: current.normalized_granot_label,
      default_channel: current.default_channel,
      source_company: current.source_company,
      enabled: current.enabled,
      notes: current.notes,
      lifecycle_enabled: command.lifecycle_enabled,
      lifecycle_disposition: current.lifecycle_disposition,
      lead_created_policy: current.lead_created_policy,
      lead_source_company: current.lead_source_company ?? null,
      lifecycle_routes: current.lifecycle_routes,
      lifecycle_policy_version: current.lifecycle_policy_version,
      reason: command.reason,
    },
    actor,
    deps,
  );
}

export { resetGranotCrmSourceCachesForTests };

function intendedSemantics(
  command: GranotCrmSourceCommand,
  before: Record<string, unknown> | null,
): GranotCrmSourceSemanticsInput {
  const granotLabel = command.granot_label ?? stringValue(before?.granot_label);
  const routes = (command.lifecycle_routes ??
    toRoutes(before?.lifecycle_routes)).map((route) => ({
    route_key: route.route_key,
    lead_model: route.lead_model,
    move_type: route.move_type,
    source_granularity_id: route.source_granularity_id,
  }));
  return {
    granot_label: granotLabel,
    normalized_granot_label: command.normalized_granot_label,
    enabled: command.enabled ?? booleanValue(before?.enabled, true),
    lifecycle_enabled:
      command.lifecycle_enabled ?? booleanValue(before?.lifecycle_enabled, false),
    lifecycle_disposition:
      command.lifecycle_disposition ??
      (stringValue(before?.lifecycle_disposition) as GranotLifecycleDisposition | undefined) ??
      "deferred",
    lead_created_policy:
      command.lead_created_policy ??
      (stringValue(before?.lead_created_policy) as GranotLeadCreatedPolicy | undefined) ??
      "observation_only",
    lead_source_company:
      command.lead_source_company === null
        ? undefined
        : command.lead_source_company ??
          (before?.lead_source_company ? String(before.lead_source_company) : undefined),
    lifecycle_routes: routes,
    lifecycle_policy_version:
      command.lifecycle_policy_version ??
      stringValue(before?.lifecycle_policy_version),
  };
}

function buildUpdate(
  command: GranotCrmSourceCommand,
  before: Record<string, unknown> | null,
  normalizedLabel: string | undefined,
): Record<string, unknown> {
  const granotLabel = command.granot_label ?? stringValue(before?.granot_label);
  if (!granotLabel) {
    throw invalid("granot_label is required.");
  }
  const crmOrigin =
    command.crm_origin?.trim() ||
    stringValue(before?.crm_origin) ||
    GRANOT_CRM_DEFAULT_ORIGIN;
  const workspaceSlug =
    command.workspace_slug?.trim() || stringValue(before?.workspace_slug);
  if (!workspaceSlug) {
    throw invalid("workspace_slug is required.");
  }
  return {
    crm_origin: crmOrigin,
    workspace_slug: workspaceSlug,
    granot_label: granotLabel,
    default_channel:
      command.default_channel ??
      (stringValue(before?.default_channel) as "form" | "call" | "unknown" | undefined) ??
      "unknown",
    source_company:
      command.source_company?.trim() ||
      stringValue(before?.source_company) ||
      "not_provided",
    enabled: command.enabled ?? booleanValue(before?.enabled, true),
    notes:
      command.notes === null
        ? undefined
        : command.notes ?? stringValue(before?.notes),
    normalized_granot_label: normalizedLabel,
    lifecycle_enabled:
      command.lifecycle_enabled ?? booleanValue(before?.lifecycle_enabled, false),
    lifecycle_disposition:
      command.lifecycle_disposition ??
      stringValue(before?.lifecycle_disposition) ??
      "deferred",
    lead_created_policy:
      command.lead_created_policy ??
      stringValue(before?.lead_created_policy) ??
      "observation_only",
    lead_source_company:
      command.lead_source_company === null
        ? undefined
        : toObjectIdOrUndefined(
            command.lead_source_company ??
              (before?.lead_source_company
                ? String(before.lead_source_company)
                : undefined),
          ),
    lifecycle_routes: (
      command.lifecycle_routes ?? toRoutes(before?.lifecycle_routes)
    ).map((route) => ({
      route_key: route.route_key,
      lead_model: route.lead_model,
      move_type: route.move_type,
      source_granularity_id: toObjectId(route.source_granularity_id),
    })),
    lifecycle_policy_version:
      command.lifecycle_policy_version ??
      stringValue(before?.lifecycle_policy_version) ??
      "",
  };
}

function applySmsOffWhenPolicyLeavesCreateIfMissing(
  update: Record<string, unknown>,
  before: Record<string, unknown> | null,
  command: GranotCrmSourceCommand,
): boolean {
  if (!before) {
    return false;
  }
  const previousPolicy =
    (stringValue(before.lead_created_policy) as GranotLeadCreatedPolicy | undefined) ??
    "observation_only";
  const nextPolicy =
    command.lead_created_policy ??
    (stringValue(before.lead_created_policy) as GranotLeadCreatedPolicy | undefined) ??
    "observation_only";
  const previousSms = record(before.outbound_sms);
  if (
    previousPolicy !== "create_if_missing" ||
    nextPolicy === "create_if_missing" ||
    previousSms?.enabled !== true
  ) {
    return false;
  }
  const now = new Date();
  update.outbound_sms = {
    ...previousSms,
    enabled: false,
    deactivated_at: now,
    deactivation_reason: "lead_created_policy_changed_from_create_if_missing",
  };
  return true;
}

async function loadSemanticsRefs(
  intended: GranotCrmSourceSemanticsInput,
  session: ClientSession,
): Promise<{
  company?: LoadedSourceCompanyRef | null;
  granularities: Map<string, LoadedGranularityRef | null>;
}> {
  const granularities = new Map<string, LoadedGranularityRef | null>();
  let company: LoadedSourceCompanyRef | null | undefined;
  if (intended.lead_source_company) {
    const row = await getLeadSourceCompanyModel()
      .findById(intended.lead_source_company)
      .session(session)
      .lean()
      .exec();
    company = row
      ? { id: String(row._id), active: row.active === true }
      : null;
  }
  for (const route of intended.lifecycle_routes) {
    const row = await getLeadSourceGranularityModel()
      .findById(route.source_granularity_id)
      .session(session)
      .lean()
      .exec();
    granularities.set(
      route.source_granularity_id,
      row
        ? {
            id: String(row._id),
            source_company_id: String(row.source_company),
            active: row.active === true,
            channel: row.channel,
            local: row.local ?? undefined,
          }
        : null,
    );
  }
  return { company, granularities };
}

function toRecord(row: Record<string, unknown>): GranotCrmSourceRecord {
  return {
    id: String(row._id ?? row.id),
    crm_origin: String(row.crm_origin ?? ""),
    workspace_slug: String(row.workspace_slug ?? ""),
    granot_label: String(row.granot_label ?? ""),
    normalized_granot_label: stringValue(row.normalized_granot_label),
    default_channel:
      (stringValue(row.default_channel) as "form" | "call" | "unknown" | undefined) ??
      "unknown",
    source_company: String(row.source_company ?? "not_provided"),
    enabled: row.enabled !== false,
    notes: stringValue(row.notes),
    lifecycle_enabled: row.lifecycle_enabled === true,
    lifecycle_disposition:
      (stringValue(row.lifecycle_disposition) as GranotLifecycleDisposition | undefined) ??
      "deferred",
    lead_created_policy:
      (stringValue(row.lead_created_policy) as GranotLeadCreatedPolicy | undefined) ??
      "observation_only",
    lead_source_company: row.lead_source_company
      ? String(row.lead_source_company)
      : undefined,
    lifecycle_routes: toRoutes(row.lifecycle_routes),
    lifecycle_policy_version: stringValue(row.lifecycle_policy_version) ?? "",
    outbound_sms: toSmsView(String(row._id ?? row.id), row.outbound_sms),
  };
}

function toRoutes(value: unknown): GranotCrmSourceLifecycleRoute[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((route) => {
    const row = record(route) ?? {};
    return {
      route_key: String(row.route_key ?? ""),
      lead_model: row.lead_model as LeadModel,
      move_type: row.move_type as GranotCrmSourceLifecycleRoute["move_type"],
      source_granularity_id: String(row.source_granularity_id ?? ""),
    };
  });
}

function policyProjection(
  value: GranotCrmSourceRecord | Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  const recordValue = "id" in value && !("_id" in value)
    ? (value as GranotCrmSourceRecord)
    : toRecord(value as Record<string, unknown>);
  return {
    id: recordValue.id,
    granot_label: recordValue.granot_label,
    normalized_granot_label: recordValue.normalized_granot_label ?? null,
    enabled: recordValue.enabled,
    lifecycle_enabled: recordValue.lifecycle_enabled,
    lifecycle_disposition: recordValue.lifecycle_disposition,
    lead_created_policy: recordValue.lead_created_policy,
    lead_source_company: recordValue.lead_source_company ?? null,
    lifecycle_routes: recordValue.lifecycle_routes,
    lifecycle_policy_version: recordValue.lifecycle_policy_version,
  };
}

function mutableAudit(
  entityId: string | undefined,
  reason: string,
): RegistryAuditInput {
  return {
    entityType: "granot_crm_source",
    entityId: entityId ?? "pending",
    action: entityId ? "update" : "create",
    reason,
  };
}

function assertOwner(actor: RegistryActorContext): void {
  if (actor.actorRole !== "owner") {
    throw new RegistryError("Registry mutations require an Owner actor.", {
      registryCode: REGISTRY_ERROR_CODES.FORBIDDEN,
    });
  }
}

function requiredReason(reason: string | undefined): string {
  const trimmed = reason?.trim();
  if (!trimmed) {
    throw invalid("An explicit reason is required for Granot CRM source policy changes.");
  }
  return trimmed;
}

function invalid(message: string): RegistryError {
  return new RegistryError(message, {
    registryCode: REGISTRY_ERROR_CODES.DEPENDENCY_CONFLICT,
    statusCode: 400,
  });
}

function duplicateNormalizedLabel(): RegistryError {
  return new RegistryError("normalized_granot_label is already in use.", {
    registryCode: REGISTRY_ERROR_CODES.DUPLICATE_IDENTIFIER,
  });
}

function notFound(label: string): RegistryError {
  return new RegistryError(`${label} not found.`, {
    registryCode: REGISTRY_ERROR_CODES.NOT_FOUND,
  });
}

function first<T>(items: T[]): T {
  const item = items[0];
  if (!item) {
    throw new Error("Mongo create returned no document");
  }
  return item;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function normalizeCommandLabel(raw: string): string | undefined {
  return normalizeGranotSourceLabel(raw);
}

export type { GranotCrmSourceRouteInput };
