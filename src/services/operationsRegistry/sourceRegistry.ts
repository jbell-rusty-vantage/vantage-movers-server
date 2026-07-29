import mongoose, { type ClientSession } from "mongoose";
import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import {
  getLeadSourceGranularityModel,
  type LeadSourceGranularityDocument,
} from "../../models/LeadSourceGranularity";
import { getCallLeadModel } from "../../models/CallLead";
import { getFormLeadModel } from "../../models/FormLead";
import { recordOperationalEvent } from "../observability";
import { REGISTRY_ERROR_CODES } from "../errors/registryErrorCodes";
import { RegistryError } from "./errors";
import { withRegistryMutation } from "./registryAudit";
import {
  previewSourceAttribution,
  type RegistrySourceChannel,
  type RegistrySourceCompanyRecord,
  type RegistrySourceGranularityRecord,
  type SourceAttribution,
  type SourceAttributionInput,
  type SourceResolutionPreview,
} from "./sourceResolution";
import type { RegistryActorContext, RegistryAuditInput } from "./types";

export type SourceCompanyCommand = {
  id?: string;
  company_slug?: string;
  name?: string;
  owner_label?: string;
  aliases?: string[];
  spreadsheet_id?: string | null;
  has_bad_tabs?: boolean;
  projection_mode?: "derived_import" | "direct_write";
  default_form_granularity?: string | null;
  default_call_granularity?: string | null;
  created_from?: string;
  reason?: string;
};

export type SourceGranularityCommand = {
  id?: string;
  source_company?: string;
  granularity_key?: string;
  channel?: RegistrySourceChannel;
  owner_label?: string;
  crm_label?: string;
  aliases?: string[];
  local?: "local" | "long_distance" | null;
  source_sites?: string[];
  priority?: number;
  sheet_tab_name?: string | null;
  created_from?: string;
  reason?: string;
};

export type SourceActivationCommand = {
  id: string;
  active: boolean;
  reason?: string;
  replacement_default_id?: string;
  remove_automatic_use_for_channel?: boolean;
};

export type SourceCompanyItem = RegistrySourceCompanyRecord & {
  _id: string;
  name: string;
  archived_at?: Date;
  deactivation_reason?: string;
  sheet_config: {
    spreadsheet_id?: string;
    has_bad_tabs: boolean;
    projection_mode: "derived_import" | "direct_write";
  };
  default_form_granularity_key?: string;
  default_call_granularity_key?: string;
  granularities: Record<string, unknown>[];
  created_from: string;
  createdAt?: Date;
  updatedAt?: Date;
};

export type SourceGranularityItem = RegistrySourceGranularityRecord & {
  _id: string;
  activated_at?: Date;
  archived_at?: Date;
  deactivation_reason?: string;
  local?: "local" | "long_distance";
  sheet_tab_name?: string;
  created_from: string;
};

export async function listSourceCompanies(
  options: { includeInactive?: boolean } = {},
): Promise<SourceCompanyItem[]> {
  const rows = await getLeadSourceCompanyModel()
    .find(options.includeInactive ? {} : { active: true })
    .sort({ owner_label: 1 })
    .lean()
    .exec();
  return rows.map((row) => toCompanyItem(row as Record<string, unknown>));
}

export async function getSourceCompany(
  id: string,
): Promise<SourceCompanyItem> {
  const row = await getLeadSourceCompanyModel().findById(id).lean().exec();
  if (!row) throw notFound("Source Company");
  return toCompanyItem(row as Record<string, unknown>);
}

export async function getSourceCompanyBySlug(
  companySlug: string,
): Promise<SourceCompanyItem> {
  const row = await getLeadSourceCompanyModel()
    .findOne({ company_slug: normalizeKey(companySlug) })
    .lean()
    .exec();
  if (!row) throw notFound("Source Company");
  return toCompanyItem(row as Record<string, unknown>);
}

export async function listSourceGranularities(
  options: {
    includeInactive?: boolean;
    sourceCompanyId?: string;
    channel?: RegistrySourceChannel;
  } = {},
): Promise<SourceGranularityItem[]> {
  const rows = await getLeadSourceGranularityModel()
    .find({
      ...(options.includeInactive ? {} : { active: true }),
      ...(options.sourceCompanyId
        ? { source_company: options.sourceCompanyId }
        : {}),
      ...(options.channel ? { channel: options.channel } : {}),
    })
    .sort({ owner_label: 1 })
    .lean()
    .exec();
  return rows.map((row) =>
    toGranularityItem(row as unknown as Record<string, unknown>),
  );
}

export async function getSourceGranularity(id: string): Promise<SourceGranularityItem> {
  const row = await getLeadSourceGranularityModel().findById(id).lean().exec();
  if (!row) throw notFound("Source Granularity");
  return toGranularityItem(row as unknown as Record<string, unknown>);
}

export async function createOrUpdateSourceCompany(
  command: SourceCompanyCommand,
  actor: RegistryActorContext,
): Promise<SourceCompanyItem> {
  assertOwner(actor);
  const Company = getLeadSourceCompanyModel();
  const audit = mutableAudit("source_company", command.id, command.reason);
  return withRegistryMutation({
    actor,
    audit,
    invalidateKeys: ["source_companies", "source_attribution", "facets"],
    mutate: async (session) => {
      const before = command.id
        ? await Company.findById(command.id).session(session).lean().exec()
        : null;
      if (command.id && !before) throw notFound("Source Company");
      if (
        !command.id &&
        !before &&
        (command.default_form_granularity || command.default_call_granularity)
      ) {
        throw invalid(
          "Set default granularities after creating the Source Company and its granularities.",
        );
      }
      const slug = normalizeKey(command.company_slug ?? before?.company_slug);
      if (!slug) {
        throw invalid("company_slug is required.");
      }
      if (before && slug !== before.company_slug) {
        throw immutable("company_slug");
      }
      if (!command.id && !command.name?.trim()) {
        throw invalid("name is required.");
      }
      const duplicate = await Company.findOne({
        company_slug: slug,
        ...(command.id ? { _id: { $ne: command.id } } : {}),
      })
        .session(session)
        .select({ _id: 1 })
        .lean()
        .exec();
      if (duplicate) throw duplicateIdentifier("company_slug");

      await validateCompanyDefaults(
        String(before?._id ?? command.id ?? ""),
        command.default_form_granularity,
        command.default_call_granularity,
        before?.active === true,
        session,
      );
      const beforeSheet = record(before?.sheet_config) ?? {};
      const resolvedName = command.name ?? before?.name;
      if (!resolvedName) {
        throw invalid("name is required.");
      }
      if (
        command.projection_mode === "direct_write" &&
        !(command.spreadsheet_id ?? beforeSheet.spreadsheet_id)?.toString().trim()
      ) {
        throw invalid(
          "direct_write requires a complete Source Company spreadsheet mapping.",
        );
      }
      const update: Record<string, unknown> = {
        company_slug: slug,
        name: canonical(resolvedName),
        owner_label: canonical(command.owner_label ?? command.name ?? before?.owner_label ?? resolvedName),
        aliases:
          command.aliases !== undefined
            ? normalizedList(command.aliases)
            : strings(before?.aliases),
        sheet_config: {
          spreadsheet_id:
            command.spreadsheet_id !== undefined
              ? optional(command.spreadsheet_id)
              : optional(beforeSheet.spreadsheet_id as string | undefined),
          has_bad_tabs:
            command.has_bad_tabs !== undefined
              ? command.has_bad_tabs === true
              : beforeSheet.has_bad_tabs === true,
          projection_mode:
            command.projection_mode ??
            (beforeSheet.projection_mode === "direct_write"
              ? "direct_write"
              : "derived_import"),
        },
        created_from:
          command.created_from?.trim() || before?.created_from || "admin",
      };
      const unset: Record<string, 1> = {};
      if (command.default_form_granularity !== undefined) {
        if (command.default_form_granularity === null) {
          unset.default_form_granularity = 1;
        } else {
          update.default_form_granularity = objectIdOrUndefined(
            command.default_form_granularity,
          );
        }
      } else if (before?.default_form_granularity) {
        update.default_form_granularity = before.default_form_granularity;
      }
      if (command.default_call_granularity !== undefined) {
        if (command.default_call_granularity === null) {
          unset.default_call_granularity = 1;
        } else {
          update.default_call_granularity = objectIdOrUndefined(
            command.default_call_granularity,
          );
        }
      } else if (before?.default_call_granularity) {
        update.default_call_granularity = before.default_call_granularity;
      }
      const doc = command.id
        ? await Company.findByIdAndUpdate(
            command.id,
            {
              $set: update,
              ...(Object.keys(unset).length ? { $unset: unset } : {}),
            },
            { session, returnDocument: "after", runValidators: true },
          ).orFail()
        : first(
            await Company.create(
              [{ ...update, active: false, granularities: [] }],
              { session },
            ),
          );
      const item = toCompanyItem(
        doc.toObject({ virtuals: true }) as Record<string, unknown>,
      );
      audit.entityId = item.id;
      audit.before = record(before);
      audit.after = item as unknown as Record<string, unknown>;
      return item;
    },
  });
}

export async function createOrUpdateSourceGranularity(
  command: SourceGranularityCommand,
  actor: RegistryActorContext,
): Promise<SourceGranularityItem> {
  assertOwner(actor);
  const Granularity = getLeadSourceGranularityModel();
  const Company = getLeadSourceCompanyModel();
  const audit = mutableAudit("source_granularity", command.id, command.reason);
  return withRegistryMutation({
    actor,
    audit,
    invalidateKeys: ["source_granularities", "source_attribution", "facets"],
    mutate: async (session) => {
      const before = command.id
        ? await Granularity.findById(command.id).session(session).lean().exec()
        : null;
      if (command.id && !before) throw notFound("Source Granularity");
      const sourceCompanyId = command.source_company ?? String(before?.source_company ?? "");
      if (!sourceCompanyId) throw invalid("source_company is required.");
      const company = await Company.findById(sourceCompanyId)
        .session(session)
        .lean()
        .exec();
      if (!company) throw notFound("Source Company");
      if (
        before &&
        String(before.source_company) !== sourceCompanyId
      ) {
        throw immutable("source_company");
      }
      const key = normalizeKey(command.granularity_key ?? before?.granularity_key);
      if (!key) throw invalid("granularity_key is required.");
      if (before && key !== before.granularity_key) {
        throw immutable("granularity_key");
      }
      const channel = command.channel ?? before?.channel;
      if (!channel) throw invalid("channel is required.");
      if (
        before &&
        command.channel &&
        command.channel !== before.channel &&
        (before.active || before.activated_at)
      ) {
        throw immutable("channel");
      }
      if (!command.id) {
        if (!command.owner_label?.trim() || !command.crm_label?.trim()) {
          throw invalid("owner_label and crm_label are required.");
        }
      }
      const duplicate = await Granularity.findOne({
        granularity_key: key,
        ...(command.id ? { _id: { $ne: command.id } } : {}),
      })
        .session(session)
        .select({ _id: 1 })
        .lean()
        .exec();
      if (duplicate) throw duplicateIdentifier("granularity_key");

      const update = {
        source_company: company._id,
        granularity_key: key,
        channel,
        owner_label: canonical(command.owner_label ?? before?.owner_label ?? ""),
        crm_label: canonical(command.crm_label ?? before?.crm_label ?? ""),
        aliases:
          command.aliases !== undefined
            ? normalizedList(command.aliases)
            : strings(before?.aliases),
        local:
          command.local !== undefined ? command.local ?? undefined : before?.local ?? undefined,
        source_sites:
          command.source_sites !== undefined
            ? normalizedList(command.source_sites)
            : strings(before?.source_sites),
        priority:
          command.priority !== undefined
            ? command.priority
            : typeof before?.priority === "number"
              ? before.priority
              : 0,
        sheet_tab_name:
          command.sheet_tab_name !== undefined
            ? optional(command.sheet_tab_name)
            : optional(before?.sheet_tab_name),
        created_from:
          command.created_from?.trim() || before?.created_from || "admin",
      };
      if (!update.owner_label || !update.crm_label) {
        throw invalid("owner_label and crm_label are required.");
      }
      const doc = command.id
        ? await Granularity.findByIdAndUpdate(
            command.id,
            { $set: update },
            { session, returnDocument: "after", runValidators: true },
          ).orFail()
        : first(
            await Granularity.create(
              [{ ...update, active: false, schedule_revision: 0 }],
              { session },
            ),
          );
      const item = toGranularityItem(
        doc.toObject({ virtuals: true }) as unknown as Record<string, unknown>,
      );
      audit.entityId = item.id;
      audit.before = record(before);
      audit.after = item as unknown as Record<string, unknown>;
      return item;
    },
  });
}

export async function setSourceCompanyActivation(
  command: SourceActivationCommand,
  actor: RegistryActorContext,
): Promise<SourceCompanyItem> {
  assertOwner(actor);
  const Company = getLeadSourceCompanyModel();
  const audit = mutableAudit("source_company", command.id, command.reason);
  audit.action = command.active ? "activate" : "deactivate";
  return withRegistryMutation({
    actor,
    audit,
    invalidateKeys: ["source_companies", "source_attribution", "facets"],
    mutate: async (session) => {
      const before = await Company.findById(command.id)
        .session(session)
        .lean()
        .exec();
      if (!before) throw notFound("Source Company");
      if (command.active) {
        await assertActiveDefaultsValid(before, session);
      } else {
        const activeGranularities = await getLeadSourceGranularityModel()
          .countDocuments({ source_company: before._id, active: true })
          .session(session);
        if (activeGranularities > 0) {
          throw dependencyConflict(
            "Deactivate all Source Granularities before deactivating their Source Company.",
          );
        }
      }
      const doc = await Company.findByIdAndUpdate(
        command.id,
        {
          $set: {
            active: command.active,
            ...(!command.active
              ? {
                  archived_at: new Date(),
                  deactivation_reason: optional(command.reason),
                }
              : {}),
          },
          ...(command.active
            ? { $unset: { archived_at: 1, deactivation_reason: 1 } }
            : {}),
        },
        { session, returnDocument: "after", runValidators: true },
      ).orFail();
      const item = toCompanyItem(
        doc.toObject({ virtuals: true }) as Record<string, unknown>,
      );
      audit.before = record(before);
      audit.after = item as unknown as Record<string, unknown>;
      return item;
    },
  });
}

export async function setSourceGranularityActivation(
  command: SourceActivationCommand,
  actor: RegistryActorContext,
): Promise<SourceGranularityItem> {
  assertOwner(actor);
  const Granularity = getLeadSourceGranularityModel();
  const Company = getLeadSourceCompanyModel();
  const audit = mutableAudit("source_granularity", command.id, command.reason);
  audit.action = command.active ? "activate" : "deactivate";
  return withRegistryMutation({
    actor,
    audit,
    invalidateKeys: ["source_granularities", "source_attribution", "facets"],
    mutate: async (session) => {
      const before = await Granularity.findById(command.id)
        .session(session)
        .lean()
        .exec();
      if (!before) throw notFound("Source Granularity");
      const company = await Company.findById(before.source_company)
        .session(session)
        .lean()
        .exec();
      if (!company) throw notFound("Source Company");

      if (command.active) {
        if (!company.active) {
          throw dependencyConflict(
            "Activate the Source Company before activating its granularity.",
          );
        }
        await assertExactIdentifiersAvailable(before, session);
        const defaultId =
          before.channel === "form"
            ? company.default_form_granularity
            : company.default_call_granularity;
        if (!defaultId || String(defaultId) !== command.id) {
          if (command.replacement_default_id !== command.id) {
            throw dependencyConflict(
              `An active ${before.channel} granularity must be selected as its company's active default in the same command.`,
            );
          }
          const defaultField =
            before.channel === "form"
              ? "default_form_granularity"
              : "default_call_granularity";
          await Company.updateOne(
            { _id: company._id },
            { $set: { [defaultField]: before._id } },
            { session },
          ).exec();
        }
      } else {
        const defaultField =
          before.channel === "form"
            ? "default_form_granularity"
            : "default_call_granularity";
        const currentDefault = company[defaultField];
        if (currentDefault && String(currentDefault) === command.id) {
          if (command.replacement_default_id) {
            const replacement = await Granularity.findOne({
              _id: command.replacement_default_id,
              source_company: company._id,
              channel: before.channel,
              active: true,
            })
              .session(session)
              .lean()
              .exec();
            if (!replacement) {
              throw dependencyConflict(
                "Replacement default must be an active same-company, same-channel granularity.",
              );
            }
            await Company.updateOne(
              { _id: company._id },
              { $set: { [defaultField]: replacement._id } },
              { session },
            ).exec();
          } else if (command.remove_automatic_use_for_channel) {
            await Company.updateOne(
              { _id: company._id },
              { $unset: { [defaultField]: 1 } },
              { session },
            ).exec();
          } else {
            throw dependencyConflict(
              "Deactivating a default requires a replacement or removal of automatic use.",
            );
          }
        }
      }

      const doc = await Granularity.findByIdAndUpdate(
        command.id,
        {
          $set: {
            active: command.active,
            activated_at:
              command.active && !before.activated_at
                ? new Date()
                : before.activated_at,
            ...(!command.active
              ? {
                  archived_at: new Date(),
                  deactivation_reason: optional(command.reason),
                }
              : {}),
          },
          ...(command.active
            ? { $unset: { archived_at: 1, deactivation_reason: 1 } }
            : {}),
        },
        { session, returnDocument: "after", runValidators: true },
      ).orFail();
      const item = toGranularityItem(
        doc.toObject({ virtuals: true }) as unknown as Record<string, unknown>,
      );
      audit.before = record(before);
      audit.after = item as unknown as Record<string, unknown>;
      return item;
    },
  });
}

export async function previewSourceResolution(
  input: SourceAttributionInput,
): Promise<SourceResolutionPreview> {
  const [companies, granularities] = await Promise.all([
    listSourceCompanies(),
    listSourceGranularities(),
  ]);
  return previewSourceAttribution(companies, granularities, input);
}

export async function resolveSourceAttribution(
  input: SourceAttributionInput,
): Promise<SourceAttribution> {
  const preview = await previewSourceResolution(input);
  if (preview.status === "resolved") return preview.attribution;
  if (preview.status === "ambiguous") {
    await recordOperationalEvent({
      level: "error",
      eventKey: "operations_registry.source_resolution_ambiguous",
      category: "admin",
      workflow: "operations_registry",
      summary: "Source attribution failed because an identifier was ambiguous.",
      details: {
        identifier_kind: preview.identifier_kind,
        identifier: preview.identifier,
        candidate_ids: preview.candidate_ids,
      },
      notificationCandidate: true,
      ownerVisible: true,
    });
    throw new RegistryError("Source attribution is ambiguous.", {
      registryCode: REGISTRY_ERROR_CODES.AMBIGUOUS_RESOLUTION,
      metadata: { candidate_ids: preview.candidate_ids },
    });
  }
  throw new RegistryError("Source attribution was not found.", {
    registryCode: REGISTRY_ERROR_CODES.NOT_FOUND,
  });
}

export async function previewSourceDependency(input: {
  entity_type: "source_company" | "source_granularity";
  entity_id: string;
}): Promise<{
  entity_type: typeof input.entity_type;
  entity_id: string;
  dependencies: Record<string, number>;
  total: number;
}> {
  const FormLead = getFormLeadModel();
  const CallLead = getCallLeadModel();
  const filter =
    input.entity_type === "source_company"
      ? { lead_source_company: input.entity_id }
      : { source_granularity_id: input.entity_id };
  const [formLeads, callLeads] = await Promise.all([
    FormLead.countDocuments(filter),
    CallLead.countDocuments(filter),
  ]);
  return {
    entity_type: input.entity_type,
    entity_id: input.entity_id,
    dependencies: { form_leads: formLeads, call_leads: callLeads },
    total: formLeads + callLeads,
  };
}

async function validateCompanyDefaults(
  companyId: string,
  formId: string | null | undefined,
  callId: string | null | undefined,
  requireActive: boolean,
  session: ClientSession,
): Promise<void> {
  for (const [channel, id] of [
    ["form", formId],
    ["call", callId],
  ] as const) {
    if (id === undefined) continue;
    if (id === null) continue;
    const row = await getLeadSourceGranularityModel()
      .findOne({
        _id: id,
        ...(companyId ? { source_company: companyId } : {}),
        channel,
        ...(requireActive ? { active: true } : {}),
      })
      .session(session)
      .lean()
      .exec();
    if (!row) {
      throw dependencyConflict(
        `Default ${channel} granularity must belong to the same Source Company and channel${requireActive ? " and be active" : ""}.`,
      );
    }
  }
}

async function assertActiveDefaultsValid(
  company: {
    _id: mongoose.Types.ObjectId;
    default_form_granularity?: mongoose.Types.ObjectId | null;
    default_call_granularity?: mongoose.Types.ObjectId | null;
  },
  session: ClientSession,
): Promise<void> {
  const Granularity = getLeadSourceGranularityModel();
  for (const channel of ["form", "call"] as const) {
    const hasActive = await Granularity.exists({
      source_company: company._id,
      channel,
      active: true,
    }).session(session);
    if (!hasActive) continue;
    const defaultId =
      channel === "form"
        ? company.default_form_granularity
        : company.default_call_granularity;
    const validDefault = defaultId
      ? await Granularity.exists({
          _id: defaultId,
          source_company: company._id,
          channel,
          active: true,
        }).session(session)
      : null;
    if (!validDefault) {
      throw dependencyConflict(
        `Active ${channel} granularities require an active same-company default.`,
      );
    }
  }
}

async function assertExactIdentifiersAvailable(
  granularity: LeadSourceGranularityDocument,
  session: ClientSession,
): Promise<void> {
  const conflicts = await getLeadSourceGranularityModel()
    .find({
      _id: { $ne: granularity._id },
      active: true,
      channel: granularity.channel,
      $or: [
        { crm_label: new RegExp(`^${escapeRegex(granularity.crm_label)}$`, "i") },
        ...(granularity.source_sites ?? []).map((site) => ({
          source_sites: new RegExp(`^${escapeRegex(site)}$`, "i"),
        })),
      ],
    })
    .session(session)
    .select({ _id: 1 })
    .lean()
    .exec();
  if (conflicts.length) {
    throw duplicateIdentifier("active exact source identifier");
  }
}

function toCompanyItem(doc: Record<string, unknown>): SourceCompanyItem {
  const sheet = record(doc.sheet_config) ?? {};
  return {
    id: String(doc._id ?? doc.id ?? ""),
    _id: String(doc._id ?? doc.id ?? ""),
    company_slug: String(doc.company_slug ?? ""),
    name: String(doc.name ?? ""),
    owner_label: String(doc.owner_label ?? doc.name ?? ""),
    aliases: strings(doc.aliases),
    active: doc.active === true,
    ...(doc.default_form_granularity
      ? { default_form_granularity: String(doc.default_form_granularity) }
      : {}),
    ...(doc.default_call_granularity
      ? { default_call_granularity: String(doc.default_call_granularity) }
      : {}),
    ...(doc.archived_at instanceof Date ? { archived_at: doc.archived_at } : {}),
    ...(typeof doc.deactivation_reason === "string"
      ? { deactivation_reason: doc.deactivation_reason }
      : {}),
    sheet_config: {
      ...(typeof sheet.spreadsheet_id === "string"
        ? { spreadsheet_id: sheet.spreadsheet_id }
        : {}),
      has_bad_tabs: sheet.has_bad_tabs === true,
      projection_mode:
        sheet.projection_mode === "direct_write"
          ? "direct_write"
          : "derived_import",
    },
    ...(typeof doc.default_form_granularity_key === "string"
      ? { default_form_granularity_key: doc.default_form_granularity_key }
      : {}),
    ...(typeof doc.default_call_granularity_key === "string"
      ? { default_call_granularity_key: doc.default_call_granularity_key }
      : {}),
    granularities: Array.isArray(doc.granularities)
      ? doc.granularities
          .map(record)
          .filter((item): item is Record<string, unknown> => item !== null)
      : [],
    created_from: String(doc.created_from ?? ""),
    ...(doc.createdAt instanceof Date ? { createdAt: doc.createdAt } : {}),
    ...(doc.updatedAt instanceof Date ? { updatedAt: doc.updatedAt } : {}),
  };
}

function toGranularityItem(
  doc: Record<string, unknown>,
): SourceGranularityItem {
  return {
    id: String(doc._id ?? doc.id ?? ""),
    _id: String(doc._id ?? doc.id ?? ""),
    source_company: String(doc.source_company ?? ""),
    granularity_key: String(doc.granularity_key ?? ""),
    channel: doc.channel === "call" ? "call" : "form",
    owner_label: String(doc.owner_label ?? ""),
    crm_label: String(doc.crm_label ?? ""),
    aliases: strings(doc.aliases),
    active: doc.active === true,
    source_sites: strings(doc.source_sites),
    priority: typeof doc.priority === "number" ? doc.priority : 0,
    schedule_revision:
      typeof doc.schedule_revision === "number" ? doc.schedule_revision : 0,
    ...(doc.activated_at instanceof Date
      ? { activated_at: doc.activated_at }
      : {}),
    ...(doc.archived_at instanceof Date ? { archived_at: doc.archived_at } : {}),
    ...(typeof doc.deactivation_reason === "string"
      ? { deactivation_reason: doc.deactivation_reason }
      : {}),
    ...(doc.local === "local" || doc.local === "long_distance"
      ? { local: doc.local }
      : {}),
    ...(typeof doc.sheet_tab_name === "string"
      ? { sheet_tab_name: doc.sheet_tab_name }
      : {}),
    created_from: String(doc.created_from ?? ""),
  };
}

function mutableAudit(
  entityType: "source_company" | "source_granularity",
  entityId: string | undefined,
  reason: string | undefined,
): RegistryAuditInput {
  return {
    entityType,
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

function invalid(message: string): RegistryError {
  return new RegistryError(message, {
    registryCode: REGISTRY_ERROR_CODES.DEPENDENCY_CONFLICT,
    statusCode: 400,
  });
}

function immutable(field: string): RegistryError {
  return new RegistryError(`${field} is immutable.`, {
    registryCode: REGISTRY_ERROR_CODES.IMMUTABLE_FIELD,
  });
}

function duplicateIdentifier(field: string): RegistryError {
  return new RegistryError(`${field} is already in use.`, {
    registryCode: REGISTRY_ERROR_CODES.DUPLICATE_IDENTIFIER,
  });
}

function dependencyConflict(message: string): RegistryError {
  return new RegistryError(message, {
    registryCode: REGISTRY_ERROR_CODES.DEPENDENCY_CONFLICT,
  });
}

function notFound(label: string): RegistryError {
  return new RegistryError(`${label} not found.`, {
    registryCode: REGISTRY_ERROR_CODES.NOT_FOUND,
  });
}

function first<T>(items: T[]): T {
  const item = items[0];
  if (!item) throw new Error("Mongo create returned no document");
  return item;
}

function normalizedList(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map(normalize).filter(Boolean) as string[])];
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function canonical(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalize(value: string | null | undefined): string | undefined {
  return value?.trim().toLowerCase() || undefined;
}

function normalizeKey(value: unknown): string | undefined {
  return typeof value === "string"
    ? value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "") || undefined
    : undefined;
}

function optional(value: string | null | undefined): string | undefined {
  return value?.trim() || undefined;
}

function objectIdOrUndefined(
  value: string | null | undefined,
): mongoose.Types.ObjectId | undefined {
  return value ? new mongoose.Types.ObjectId(value) : undefined;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
