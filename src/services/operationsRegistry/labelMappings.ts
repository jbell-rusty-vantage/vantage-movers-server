import type { ClientSession } from "mongoose";
import { resolveSourceCompanyFromLabel } from "../../config/domain/sources";
import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../models/LeadSourceGranularity";
import {
  getLeadSourceLabelMappingModel,
  LABEL_MAPPING_NAMESPACES,
  type LabelMappingNamespace,
} from "../../models/LeadSourceLabelMapping";
import { recordOperationalEvent } from "../observability";
import { REGISTRY_ERROR_CODES } from "../errors/registryErrorCodes";
import { toObjectId } from "../../utils/objectId";
import { RegistryError } from "./errors";
import { withRegistryMutation, type RegistryAuditDeps } from "./registryAudit";
import {
  recordDurableCompatibilityRead,
  recordRegistryResolverFailure,
  type RegistryCompatibilityConsumer,
} from "./runtimeTelemetry";
import { normalizeSourceLabel } from "./sourceLabelNormalize";
import type { RegistryActorContext, RegistryAuditInput } from "./types";

export { normalizeSourceLabel } from "./sourceLabelNormalize";
export { LABEL_MAPPING_NAMESPACES, type LabelMappingNamespace };

export const STATIC_SOURCE_LABEL_MAP_PATH = "SOURCE_LABEL_TO_COMPANY";
export const SHEET_LEGACY_COMPATIBILITY_CONSUMER =
  "sheet_legacy_resolution" satisfies RegistryCompatibilityConsumer;

export type CreateLabelMappingCommand = {
  label: string;
  namespace: LabelMappingNamespace;
  source_company: string;
  source_granularity: string;
  change_reason: string;
  normalized_label?: unknown;
};

export type LabelMappingRecord = {
  id: string;
  label: string;
  normalized_label: string;
  namespace: LabelMappingNamespace;
  source_company: string;
  source_granularity: string;
  active: boolean;
  created_by: RegistryActorContext;
  change_reason?: string;
  archived_at?: Date;
};

export type LabelResolution =
  | {
      status: "resolved";
      source: "mapping";
      namespace: LabelMappingNamespace;
      raw_label: string;
      normalized_label: string;
      mapping_id: string;
      source_company_id: string;
      source_granularity_id: string;
      company_slug: string;
      company_label_snapshot: string;
      granularity_key: string;
      granularity_label_snapshot: string;
      crm_label_snapshot: string;
      feed_active: boolean;
      company_active: boolean;
    }
  | {
      status: "resolved";
      source: "compatibility";
      namespace: LabelMappingNamespace;
      raw_label: string;
      normalized_label: string;
      source_company_slug: string;
    }
  | {
      status: "not_found";
      namespace: LabelMappingNamespace;
      raw_label: string;
      normalized_label: string;
    }
  | {
      status: "ambiguous";
      namespace: LabelMappingNamespace;
      raw_label: string;
      normalized_label: string;
      candidates: Array<{
        mapping_id: string;
        source_company_id: string;
        source_granularity_id: string;
      }>;
    }
  | {
      status: "inactive_destination";
      namespace: LabelMappingNamespace;
      raw_label: string;
      normalized_label: string;
      mapping_id: string;
      source_company_id: string;
      source_granularity_id: string;
    };

export type SheetLegacyResolutionDeps = {
  consultStaticMap?: (rawLabel: string) => string | undefined;
  recordCompatibilityRead?: typeof recordDurableCompatibilityRead;
  recordResolutionFailure?: (
    kind: "ambiguous" | "not_found" | "inactive_destination",
    details: Record<string, unknown>,
  ) => Promise<void>;
};

let staticMapConsultCount = 0;

export function getStaticSourceLabelMapConsultCount(): number {
  return staticMapConsultCount;
}

export function resetStaticSourceLabelMapConsultsForTests(): void {
  staticMapConsultCount = 0;
}

export function consultStaticSourceLabelMap(rawLabel: string): string | undefined {
  staticMapConsultCount += 1;
  return resolveSourceCompanyFromLabel(rawLabel);
}

export async function createLabelMapping(
  command: CreateLabelMappingCommand,
  actor: RegistryActorContext,
  deps: RegistryAuditDeps = {},
): Promise<LabelMappingRecord> {
  assertOwner(actor);
  if ("normalized_label" in command && command.normalized_label !== undefined) {
    throw invalid(
      "normalized_label is server-derived and must not be submitted by the client.",
    );
  }
  const reason = requiredReason(command.change_reason);
  const label = command.label;
  if (typeof label !== "string" || !label.trim()) {
    throw invalid("label is required.");
  }
  if (!LABEL_MAPPING_NAMESPACES.includes(command.namespace)) {
    throw invalid("namespace must be sheet_lead_source or legacy_api_source.");
  }
  const normalizedLabel = normalizeSourceLabel(label);
  const Company = getLeadSourceCompanyModel();
  const Granularity = getLeadSourceGranularityModel();
  const Mapping = getLeadSourceLabelMappingModel();
  const audit = mutableAudit(undefined, reason, "create");

  return withRegistryMutation(
    {
    actor,
    audit,
    invalidateKeys: ["source_label_mappings", "source_attribution"],
    mutate: async (session) => {
      const feed = await Granularity.findById(command.source_granularity)
        .session(session)
        .lean()
        .exec();
      if (!feed) {
        throw notFound("Feed");
      }
      const company = await Company.findById(command.source_company)
        .session(session)
        .lean()
        .exec();
      if (!company) {
        throw notFound("Lead Source");
      }
      const feedCompanyId = String(feed.source_company);
      const submittedCompanyId = String(company._id);
      if (feedCompanyId !== submittedCompanyId) {
        throw invalid(
          `Feed ${String(feed._id)} belongs to Lead Source ${feedCompanyId}, not the submitted Lead Source ${submittedCompanyId}.`,
        );
      }
      if (feed.active !== true) {
        throw invalid("Feed must be active before it can accept a label mapping.");
      }
      const collision = await Mapping.findOne({
        namespace: command.namespace,
        normalized_label: normalizedLabel,
        active: true,
      })
        .session(session)
        .select({ _id: 1 })
        .lean()
        .exec();
      if (collision) {
        throw duplicateLabel(command.namespace, normalizedLabel);
      }

      try {
        const created = first(
          await Mapping.create(
            [
              {
                label,
                normalized_label: normalizedLabel,
                namespace: command.namespace,
                source_company: toObjectId(submittedCompanyId),
                source_granularity: toObjectId(String(feed._id)),
                active: true,
                created_by: persistActor(actor),
                change_reason: reason,
              },
            ],
            { session },
          ),
        );
        const record = toRecord(created.toObject({ virtuals: true }));
        audit.entityId = record.id;
        audit.after = record as unknown as Record<string, unknown>;
        return record;
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          throw duplicateLabel(command.namespace, normalizedLabel);
        }
        throw error;
      }
    },
    },
    deps,
  );
}

export async function setLabelMappingActivation(
  id: string,
  active: boolean,
  reason: string,
  actor: RegistryActorContext,
  deps: RegistryAuditDeps = {},
): Promise<LabelMappingRecord> {
  assertOwner(actor);
  const trimmedReason = requiredReason(reason);
  const Mapping = getLeadSourceLabelMappingModel();
  const audit = mutableAudit(id, trimmedReason, active ? "activate" : "deactivate");

  return withRegistryMutation(
    {
    actor,
    audit,
    invalidateKeys: ["source_label_mappings", "source_attribution"],
    mutate: async (session) => {
      const before = await Mapping.findById(id).session(session).lean().exec();
      if (!before) {
        throw notFound("Label mapping");
      }
      if (active && before.active !== true) {
        const collision = await Mapping.findOne({
          namespace: before.namespace,
          normalized_label: before.normalized_label,
          active: true,
          _id: { $ne: before._id },
        })
          .session(session)
          .select({ _id: 1 })
          .lean()
          .exec();
        if (collision) {
          throw duplicateLabel(
            before.namespace as LabelMappingNamespace,
            before.normalized_label,
          );
        }
      }
      const doc = await Mapping.findByIdAndUpdate(
        id,
        {
          $set: {
            active,
            change_reason: trimmedReason,
            ...(active
              ? {}
              : { archived_at: before.archived_at ?? new Date() }),
          },
          ...(active ? { $unset: { archived_at: 1 } } : {}),
        },
        { session, returnDocument: "after", runValidators: true },
      ).orFail();
      const record = toRecord(doc.toObject({ virtuals: true }));
      audit.before = toRecord(before) as unknown as Record<string, unknown>;
      audit.after = record as unknown as Record<string, unknown>;
      return record;
    },
    },
    deps,
  );
}

export async function listLabelMappings(filter: {
  source_company?: string;
  source_granularity?: string;
  namespace?: string;
}): Promise<LabelMappingRecord[]> {
  const Mapping = getLeadSourceLabelMappingModel();
  const query: Record<string, unknown> = {};
  if (filter.source_company) {
    query.source_company = toObjectId(filter.source_company);
  }
  if (filter.source_granularity) {
    query.source_granularity = toObjectId(filter.source_granularity);
  }
  if (filter.namespace) {
    if (
      !LABEL_MAPPING_NAMESPACES.includes(
        filter.namespace as LabelMappingNamespace,
      )
    ) {
      throw invalid("namespace must be sheet_lead_source or legacy_api_source.");
    }
    query.namespace = filter.namespace;
  }
  const docs = await Mapping.find(query).sort({ namespace: 1, normalized_label: 1 }).lean().exec();
  return docs.map((doc) => toRecord(doc));
}

export async function resolveLabelToFeed(
  namespace: LabelMappingNamespace,
  rawLabel: string,
  session?: ClientSession,
): Promise<LabelResolution> {
  const normalizedLabel = normalizeSourceLabel(rawLabel);
  const Mapping = getLeadSourceLabelMappingModel();
  const matches = await Mapping.find({
    namespace,
    normalized_label: normalizedLabel,
    active: true,
  })
    .session(session ?? null)
    .lean()
    .exec();

  if (matches.length === 0) {
    return {
      status: "not_found",
      namespace,
      raw_label: rawLabel,
      normalized_label: normalizedLabel,
    };
  }
  if (matches.length > 1) {
    return {
      status: "ambiguous",
      namespace,
      raw_label: rawLabel,
      normalized_label: normalizedLabel,
      candidates: matches.map((match) => ({
        mapping_id: String(match._id),
        source_company_id: String(match.source_company),
        source_granularity_id: String(match.source_granularity),
      })),
    };
  }

  const mapping = matches[0]!;
  const Granularity = getLeadSourceGranularityModel();
  const Company = getLeadSourceCompanyModel();
  const feed = await Granularity.findById(mapping.source_granularity)
    .session(session ?? null)
    .lean()
    .exec();
  const storedCompanyId = String(mapping.source_company);
  const company = await Company.findById(mapping.source_company)
    .session(session ?? null)
    .lean()
    .exec();
  const feedCompanyId = feed ? String(feed.source_company) : "";
  const destinationOk =
    Boolean(feed) &&
    Boolean(company) &&
    feed?.active === true &&
    company?.active === true &&
    feedCompanyId === storedCompanyId;

  if (!destinationOk) {
    return {
      status: "inactive_destination",
      namespace,
      raw_label: rawLabel,
      normalized_label: normalizedLabel,
      mapping_id: String(mapping._id),
      source_company_id: storedCompanyId,
      source_granularity_id: String(mapping.source_granularity),
    };
  }

  return {
    status: "resolved",
    source: "mapping",
    namespace,
    raw_label: rawLabel,
    normalized_label: normalizedLabel,
    mapping_id: String(mapping._id),
    source_company_id: storedCompanyId,
    source_granularity_id: String(feed!._id),
    company_slug: String(company!.company_slug ?? ""),
    company_label_snapshot: String(company!.owner_label ?? company!.name ?? ""),
    granularity_key: String(feed!.granularity_key ?? ""),
    granularity_label_snapshot: String(feed!.owner_label ?? ""),
    crm_label_snapshot: String(feed!.crm_label ?? ""),
    feed_active: true,
    company_active: true,
  };
}

/**
 * Collection-first sheet/legacy attribution seam (spec §5.1).
 * Consults the static map only on `not_found`. Ambiguous and inactive-Feed
 * mappings fail closed and never fall back.
 */
export async function resolveSheetOrLegacyLabel(
  namespace: LabelMappingNamespace,
  rawLabel: string,
  deps: SheetLegacyResolutionDeps = {},
): Promise<LabelResolution> {
  const consultStaticMap = deps.consultStaticMap ?? consultStaticSourceLabelMap;
  const recordCompatibility =
    deps.recordCompatibilityRead ?? recordDurableCompatibilityRead;
  const recordFailure =
    deps.recordResolutionFailure ?? recordSheetLegacyResolutionFailure;

  const collectionResult = await resolveLabelToFeed(namespace, rawLabel);
  if (collectionResult.status === "resolved") {
    return collectionResult;
  }
  if (collectionResult.status === "ambiguous") {
    await recordFailure("ambiguous", {
      namespace,
      normalized_label: collectionResult.normalized_label,
      candidate_ids: collectionResult.candidates.map((item) => item.mapping_id),
    });
    return collectionResult;
  }
  if (collectionResult.status === "inactive_destination") {
    await recordFailure("inactive_destination", {
      namespace,
      normalized_label: collectionResult.normalized_label,
      mapping_id: collectionResult.mapping_id,
      source_granularity_id: collectionResult.source_granularity_id,
    });
    return collectionResult;
  }

  const fallbackCompany = consultStaticMap(rawLabel);
  if (fallbackCompany) {
    await recordCompatibility(
      STATIC_SOURCE_LABEL_MAP_PATH,
      SHEET_LEGACY_COMPATIBILITY_CONSUMER,
    );
    return {
      status: "resolved",
      source: "compatibility",
      namespace,
      raw_label: rawLabel,
      normalized_label: collectionResult.normalized_label,
      source_company_slug: fallbackCompany,
    };
  }

  await recordFailure("not_found", {
    namespace,
    normalized_label: collectionResult.normalized_label,
  });
  return collectionResult;
}

export async function previewLabelResolution(input: {
  namespace: LabelMappingNamespace;
  label: string;
}): Promise<LabelResolution> {
  return resolveSheetOrLegacyLabel(input.namespace, input.label);
}

export async function recordSheetLegacyResolutionFailure(
  kind: "ambiguous" | "not_found" | "inactive_destination",
  details: Record<string, unknown>,
): Promise<void> {
  const eventKey =
    kind === "ambiguous"
      ? "operations_registry.source_resolution_ambiguous"
      : "operations_registry.source_resolution_not_found";
  recordRegistryResolverFailure(
    "source",
    kind === "ambiguous" ? "ambiguous_resolution" : "not_found",
  );
  try {
    await recordOperationalEvent({
      level: kind === "ambiguous" ? "error" : "warn",
      eventKey,
      category: "admin",
      workflow: "operations_registry",
      summary:
        kind === "ambiguous"
          ? "Sheet or legacy label attribution failed because the mapping was ambiguous."
          : kind === "inactive_destination"
            ? "Sheet or legacy label mapping points at an inactive or invalid Feed."
            : "Sheet or legacy label attribution did not match an active mapping or static fallback.",
      details: {
        identifier_kind: "label_mapping",
        ...details,
      },
      notificationCandidate: kind === "ambiguous",
      ownerVisible: true,
      piiPolicy: "none",
    });
  } catch {
    // Fail-closed recording must never hide the resolution result.
  }
}

function persistActor(actor: RegistryActorContext) {
  return {
    actor_type: actor.actorType,
    actor_id: actor.actorId,
    actor_label: actor.actorLabel,
    actor_role: actor.actorRole,
    request_id: actor.requestId,
  };
}

function readActor(value: unknown): RegistryActorContext {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    actorType: String(record.actor_type ?? record.actorType ?? "system") as RegistryActorContext["actorType"],
    actorId: String(record.actor_id ?? record.actorId ?? ""),
    actorLabel: String(record.actor_label ?? record.actorLabel ?? ""),
    actorRole: String(record.actor_role ?? record.actorRole ?? "owner") as RegistryActorContext["actorRole"],
    requestId: String(record.request_id ?? record.requestId ?? ""),
  };
}

function toRecord(doc: Record<string, unknown>): LabelMappingRecord {
  return {
    id: String(doc._id ?? doc.id ?? ""),
    label: String(doc.label ?? ""),
    normalized_label: String(doc.normalized_label ?? ""),
    namespace: doc.namespace as LabelMappingNamespace,
    source_company: String(doc.source_company ?? ""),
    source_granularity: String(doc.source_granularity ?? ""),
    active: doc.active !== false,
    created_by: readActor(doc.created_by),
    ...(typeof doc.change_reason === "string"
      ? { change_reason: doc.change_reason }
      : {}),
    ...(doc.archived_at instanceof Date ? { archived_at: doc.archived_at } : {}),
  };
}

function mutableAudit(
  entityId: string | undefined,
  reason: string,
  action: "create" | "activate" | "deactivate",
): RegistryAuditInput {
  return {
    entityType: "source_label_mapping",
    entityId: entityId ?? "pending",
    action,
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
  const trimmed = reason?.trim() ?? "";
  if (trimmed.length < 10 || trimmed.length > 1000) {
    throw invalid("change_reason must be between 10 and 1000 characters.");
  }
  return trimmed;
}

function invalid(message: string): RegistryError {
  return new RegistryError(message, {
    registryCode: REGISTRY_ERROR_CODES.DEPENDENCY_CONFLICT,
    statusCode: 400,
  });
}

function duplicateLabel(
  namespace: LabelMappingNamespace,
  normalizedLabel: string,
): RegistryError {
  return new RegistryError(
    `An active mapping already holds ${namespace} / ${normalizedLabel}.`,
    {
      registryCode: REGISTRY_ERROR_CODES.DUPLICATE_IDENTIFIER,
    },
  );
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

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}
