import mongoose, { type ClientSession } from "mongoose";
import { Agent, type AgentDocument } from "../../models/Agent";
import { BookedLead } from "../../models/BookedLead";
import { CallLead } from "../../models/CallLead";
import { FormLead } from "../../models/FormLead";
import { Merchant, type MerchantDocument } from "../../models/Merchant";
import { normalizeAgentName } from "../agents/agentName";
import { REGISTRY_ERROR_CODES } from "../errors/registryErrorCodes";
import { OUTREACH_DESK_SETTINGS, type OutreachDeskSetting } from "../../config/domain/salesOutreach";
import { publishOutreachLive } from "../salesOutreach/live/publish";
import { enqueueDeskResyncForAgents } from "../salesOutreach/subjects/agentWake";
import { normalizeGranotCrmUsername } from "./catalogNormalization";
import { RegistryError } from "./errors";
import { withRegistryMutation } from "./registryAudit";
import type { RegistryActorContext, RegistryAuditInput } from "./types";

export type RegistryCatalogKind = "agents" | "merchants";

export type RegistryCatalogItem = {
  id: string;
  name: string;
  normalized_name: string;
  name_aliases: string[];
  active: boolean;
  role?: string;
  granot_identity?: {
    username: string;
    verified: boolean;
    verified_at?: Date;
    last_observed_at?: Date;
  };
  granot_crm_username?: string;
  outreach_desk?: OutreachDeskSetting;
  archived_at?: Date;
  deactivation_reason?: string;
  created_from: string;
  createdAt?: Date;
  updatedAt?: Date;
};

export type AgentRegistryCommand = {
  id?: string;
  name?: string;
  role?: string;
  /** A username sets or corrects it; `null` clears it (the Agent has no Granot login). */
  granot_crm_username?: string | null;
  outreach_desk?: OutreachDeskSetting;
  created_from?: string;
  active?: boolean;
  reason?: string;
};

export type MerchantRegistryCommand = {
  id?: string;
  name?: string;
  created_from?: string;
  active?: boolean;
  reason?: string;
};

export type CatalogActivationCommand = {
  id: string;
  active: boolean;
  reason?: string;
};

export type RegistryDependencyPreview = {
  entity_type: "agent" | "merchant";
  entity_id: string;
  active: boolean;
  dependencies: Record<string, number>;
  total: number;
};

type CatalogLeanDocument = Record<string, unknown> & {
  _id: mongoose.Types.ObjectId;
  name: string;
  normalized_name: string;
  name_aliases?: string[];
  active?: boolean;
  role?: string;
  created_from?: string;
  granot_identity?: {
    username?: string;
    verified?: boolean;
    verified_at?: Date;
    last_observed_at?: Date;
  };
  granot_crm_username?: string;
  outreach_desk?: string;
  archived_at?: Date;
  deactivation_reason?: string;
  createdAt?: Date;
  updatedAt?: Date;
};

export async function listRegistryAgents(
  options: { includeInactive?: boolean } = {},
): Promise<RegistryCatalogItem[]> {
  const rows = (await Agent.find(options.includeInactive ? {} : { active: true })
    .sort({ name: 1 })
    .lean()
    .exec()) as CatalogLeanDocument[];
  return rows.map(toCatalogItem);
}

export async function listRegistryMerchants(
  options: { includeInactive?: boolean } = {},
): Promise<RegistryCatalogItem[]> {
  const rows = (await Merchant.find(options.includeInactive ? {} : { active: true })
    .sort({ name: 1 })
    .lean()
    .exec()) as CatalogLeanDocument[];
  return rows.map(toCatalogItem);
}

export async function getRegistryAgent(id: string): Promise<RegistryCatalogItem> {
  const row = (await Agent.findById(id).lean().exec()) as CatalogLeanDocument | null;
  if (!row) {
    throw registryNotFound("Agent");
  }
  return toCatalogItem(row);
}

export async function getRegistryMerchant(id: string): Promise<RegistryCatalogItem> {
  const row = (await Merchant.findById(id).lean().exec()) as CatalogLeanDocument | null;
  if (!row) {
    throw registryNotFound("Merchant");
  }
  return toCatalogItem(row);
}

export async function resolveRegistryAgentByName(
  name: string,
  options: { includeInactive?: boolean } = {},
): Promise<RegistryCatalogItem | undefined> {
  const normalized_name = normalizeAgentName(name);
  const row = await Agent.findOne({
    $or: [{ normalized_name }, { name_aliases: normalized_name }],
    ...(options.includeInactive ? {} : { active: true }),
  })
    .exec();
  return row ? toCatalogItem(documentToCatalogLean(row)) : undefined;
}

export async function resolveRegistryMerchantByName(
  name: string,
  options: { includeInactive?: boolean } = {},
): Promise<RegistryCatalogItem | undefined> {
  const normalized_name = normalizeAgentName(name);
  const row = await Merchant.findOne({
    $or: [{ normalized_name }, { name_aliases: normalized_name }],
    ...(options.includeInactive ? {} : { active: true }),
  })
    .exec();
  return row ? toCatalogItem(documentToCatalogLean(row)) : undefined;
}

export async function resolveAgentByGranotUsername(
  value: string | null | undefined,
  options: { includeInactive?: boolean } = {},
): Promise<RegistryCatalogItem | undefined> {
  const username = normalizeGranotCrmUsername(value);
  if (!username) return undefined;
  const row = await Agent.findOne({
    "granot_identity.username": username,
    ...(options.includeInactive ? {} : { active: true }),
  })
    .exec();
  return row ? toCatalogItem(documentToCatalogLean(row)) : undefined;
}

export async function createOrUpdateAgent(
  command: AgentRegistryCommand,
  actor: RegistryActorContext,
): Promise<RegistryCatalogItem> {
  assertOwner(actor);
  const audit = mutableAudit("agent", command.id, command.reason);
  // A change to who may be a desk rep (the Granot username's presence, the Owner's Outreach Desk
  // control, activation) re-syncs the Agent's open desk subjects, as `setCatalogActivation` does.
  let deskSubjectIds: string[] = [];

  const item = await withRegistryMutation({
    actor,
    audit,
    invalidateKeys: ["agents", "catalog", "facets"],
    mutate: async (session) => {
      const before = command.id
        ? ((await Agent.findById(command.id).session(session).lean().exec()) as
            | CatalogLeanDocument
            | null)
        : null;
      if (command.id && !before) {
        throw registryNotFound("Agent");
      }

      const resolvedName = command.name?.trim()
        ? canonicalName(command.name)
        : before?.name;
      if (!resolvedName) {
        throw registryValidationError("Name is required.");
      }

      const normalizedName = normalizeAgentName(resolvedName);
      const username = normalizeGranotCrmUsername(command.granot_crm_username);
      const existingUsername = normalizeGranotCrmUsername(
        before?.granot_identity?.username ?? before?.granot_crm_username,
      );
      const usernameChanging =
        username !== undefined && username !== existingUsername;
      const usernameClearing =
        command.granot_crm_username === null && existingUsername !== undefined;

      const normalizedNameChanging =
        !before || before.normalized_name !== normalizedName;
      if (normalizedNameChanging) {
        await assertCatalogNameAvailable("agents", normalizedName, command.id, session);
      }

      if (usernameChanging && username) {
        await assertGranotUsernameAvailable(username, command.id, session);
      }

      const nameAliases = before
        ? mergeAlias(before.name_aliases, before.normalized_name, normalizedName)
        : [];

      const update: Record<string, unknown> = {
        name: resolvedName,
        normalized_name: normalizedName,
        name_aliases: nameAliases,
        role: command.role?.trim() || before?.role || "agent",
        created_from:
          command.created_from?.trim() || before?.created_from || "admin",
      };

      if (command.active !== undefined) {
        update.active = command.active;
        if (!command.active) {
          update.archived_at = new Date();
          update.deactivation_reason = command.reason?.trim() || undefined;
        }
      } else if (!before) {
        update.active = true;
      }

      // Owner may set or correct a Granot username (e.g. misspelling). Uniqueness
      // remains global; changing resets verification on the nested identity.
      if (usernameChanging && username) {
        update.granot_identity = { username, verified: false };
        update.granot_crm_username = username;
      }
      if (command.outreach_desk !== undefined) {
        update.outreach_desk = command.outreach_desk;
      }

      // Clearing the Granot username drops the whole nested identity. It runs unvalidated on its own: an
      // `$unset` of `granot_identity` under `runValidators` trips the nested `verified` required rule.
      if (command.id && usernameClearing) {
        await Agent.updateOne({ _id: command.id }, { $unset: { granot_identity: 1, granot_crm_username: 1 } }, { session });
      }
      const doc = command.id
        ? ((await Agent.findByIdAndUpdate(
            command.id,
            {
              $set: update,
              ...(command.active === true
                ? { $unset: { archived_at: 1, deactivation_reason: 1 } }
                : {}),
            },
            { returnDocument: "after", runValidators: true, session },
          ).orFail()) as AgentDocument)
        : await createAgentDocument(update, session);

      const item = toCatalogItem(documentToCatalogLean(doc));
      audit.entityId = item.id;
      audit.action = !before
        ? "create"
        : command.active !== undefined && command.active !== before.active
          ? command.active
            ? "activate"
            : "deactivate"
          : before.normalized_name === normalizedName
            ? "update"
            : "rename";
      audit.before = record(before);
      audit.after = item as unknown as Record<string, unknown>;
      if (before && deskInputsChanged(before, item)) {
        deskSubjectIds = await enqueueDeskResyncForAgents([item.id], `agent-update:${new mongoose.Types.ObjectId().toHexString()}`, session, new Date());
      }
      return item;
    },
  });
  if (deskSubjectIds.length) {
    await publishOutreachLive({ topic: "outreach_desk", subject_ids: deskSubjectIds, agent_ids: [item.id], cause: "command" });
  }
  return item;
}

/** Whether an Agent update moved any input of `deskMembership`: activation, the Granot username's presence, or the Owner's control. */
function deskInputsChanged(before: CatalogLeanDocument, after: RegistryCatalogItem): boolean {
  const hadUsername = Boolean(before.granot_identity?.username ?? before.granot_crm_username);
  const hasUsername = Boolean(after.granot_identity?.username ?? after.granot_crm_username);
  return (
    (before.active !== false) !== after.active ||
    hadUsername !== hasUsername ||
    (before.outreach_desk ?? "auto") !== (after.outreach_desk ?? "auto")
  );
}

export async function createOrUpdateMerchant(
  command: MerchantRegistryCommand,
  actor: RegistryActorContext,
): Promise<RegistryCatalogItem> {
  assertOwner(actor);
  const audit = mutableAudit("merchant", command.id, command.reason);

  return withRegistryMutation({
    actor,
    audit,
    invalidateKeys: ["merchants", "catalog", "facets"],
    mutate: async (session) => {
      const before = command.id
        ? ((await Merchant.findById(command.id)
            .session(session)
            .lean()
            .exec()) as CatalogLeanDocument | null)
        : null;
      if (command.id && !before) {
        throw registryNotFound("Merchant");
      }

      const resolvedName = command.name?.trim()
        ? canonicalName(command.name)
        : before?.name;
      if (!resolvedName) {
        throw registryValidationError("Name is required.");
      }

      const normalizedName = normalizeAgentName(resolvedName);
      const normalizedNameChanging =
        !before || before.normalized_name !== normalizedName;
      if (normalizedNameChanging) {
        await assertCatalogNameAvailable("merchants", normalizedName, command.id, session);
      }

      const update: Record<string, unknown> = {
        name: resolvedName,
        normalized_name: normalizedName,
        name_aliases: before
          ? mergeAlias(before.name_aliases, before.normalized_name, normalizedName)
          : [],
        created_from:
          command.created_from?.trim() || before?.created_from || "admin",
      };

      if (command.active !== undefined) {
        update.active = command.active;
        if (!command.active) {
          update.archived_at = new Date();
          update.deactivation_reason = command.reason?.trim() || undefined;
        }
      } else if (!before) {
        update.active = true;
      }

      const doc = command.id
        ? ((await Merchant.findByIdAndUpdate(
            command.id,
            {
              $set: update,
              ...(command.active === true
                ? { $unset: { archived_at: 1, deactivation_reason: 1 } }
                : {}),
            },
            { returnDocument: "after", runValidators: true, session },
          ).orFail()) as MerchantDocument)
        : await createMerchantDocument(update, session);

      const item = toCatalogItem(documentToCatalogLean(doc));
      audit.entityId = item.id;
      audit.action = !before
        ? "create"
        : command.active !== undefined && command.active !== before.active
          ? command.active
            ? "activate"
            : "deactivate"
          : before.normalized_name === normalizedName
            ? "update"
            : "rename";
      audit.before = record(before);
      audit.after = item as unknown as Record<string, unknown>;
      return item;
    },
  });
}

export async function setAgentActivation(
  command: CatalogActivationCommand,
  actor: RegistryActorContext,
): Promise<RegistryCatalogItem> {
  return setCatalogActivation("agents", command, actor);
}

export async function setMerchantActivation(
  command: CatalogActivationCommand,
  actor: RegistryActorContext,
): Promise<RegistryCatalogItem> {
  return setCatalogActivation("merchants", command, actor);
}

export async function previewRegistryDependency(input: {
  entity_type: "agent" | "merchant";
  entity_id: string;
}): Promise<RegistryDependencyPreview> {
  if (input.entity_type === "agent") {
    const [bookings, formLeads, callLeads, agent] = await Promise.all([
      BookedLead.countDocuments({ "agent_allocations.agent": input.entity_id }),
      FormLead.countDocuments({ receiver_agent: input.entity_id }),
      CallLead.countDocuments({ receiver_agent: input.entity_id }),
      Agent.findById(input.entity_id).select({ active: 1 }).lean().exec(),
    ]);
    if (!agent) throw registryNotFound("Agent");
    const dependencies = {
      bookings,
      form_leads_received: formLeads,
      call_leads_received: callLeads,
    };
    return {
      entity_type: "agent",
      entity_id: input.entity_id,
      active: agent.active !== false,
      dependencies,
      total: sum(dependencies),
    };
  }

  const merchant = (await Merchant.findById(input.entity_id).lean().exec()) as
    | MerchantDocument
    | null;
  if (!merchant) throw registryNotFound("Merchant");
  const names = [merchant.name, ...(merchant.name_aliases ?? [])];
  const bookings = await BookedLead.countDocuments({ merchant: { $in: names } });
  return {
    entity_type: "merchant",
    entity_id: input.entity_id,
    active: merchant.active !== false,
    dependencies: { bookings },
    total: bookings,
  };
}

async function setCatalogActivation(
  kind: RegistryCatalogKind,
  command: CatalogActivationCommand,
  actor: RegistryActorContext,
): Promise<RegistryCatalogItem> {
  assertOwner(actor);
  const entityType = kind === "agents" ? "agent" : "merchant";
  const audit = mutableAudit(entityType, command.id, command.reason);
  audit.action = command.active ? "activate" : "deactivate";
  // Sales Outreach Desk (P08a-1, F1/F2): an Agent's activation changes who is a desk rep. The desk
  // assigns a Lead only to an active Agent with a reviewed `sales_rep` link, so the Agent's open
  // subjects are re-synced in this transaction (the same wake an Accounts connect/disconnect uses)
  // and the desk is told after commit. The roster itself is derived at read time, so nothing else moves.
  let deskSubjectIds: string[] = [];
  const item = await withRegistryMutation({
    actor,
    audit,
    invalidateKeys: [kind, "catalog", "facets"],
    mutate: async (session) => {
      const before =
        kind === "agents"
          ? ((await Agent.findById(command.id)
              .session(session)
              .lean()
              .exec()) as CatalogLeanDocument | null)
          : ((await Merchant.findById(command.id)
              .session(session)
              .lean()
              .exec()) as CatalogLeanDocument | null);
      if (!before) throw registryNotFound(kind === "agents" ? "Agent" : "Merchant");
      const update = {
        active: command.active,
        ...(!command.active
          ? {
              archived_at: new Date(),
              deactivation_reason: command.reason?.trim() || undefined,
            }
          : {}),
      };
      const mongoUpdate = {
        $set: update,
        ...(command.active
          ? { $unset: { archived_at: 1, deactivation_reason: 1 } }
          : {}),
      };
      const doc =
        kind === "agents"
          ? ((await Agent.findByIdAndUpdate(
              command.id,
              mongoUpdate,
              { returnDocument: "after", runValidators: true, session },
            ).orFail()) as AgentDocument)
          : ((await Merchant.findByIdAndUpdate(
              command.id,
              mongoUpdate,
              { returnDocument: "after", runValidators: true, session },
            ).orFail()) as MerchantDocument);
      const item = toCatalogItem(documentToCatalogLean(doc));
      audit.before = record(before);
      audit.after = item as unknown as Record<string, unknown>;
      if (kind === "agents" && (before.active !== false) !== command.active)
        deskSubjectIds = await enqueueDeskResyncForAgents([command.id], `activation:${new mongoose.Types.ObjectId().toHexString()}`, session, new Date());
      return item;
    },
  });
  if (kind === "agents" && deskSubjectIds.length)
    await publishOutreachLive({ topic: "outreach_desk", subject_ids: deskSubjectIds, agent_ids: [command.id], cause: "command" });
  return item;
}

async function assertCatalogNameAvailable(
  kind: RegistryCatalogKind,
  normalizedName: string,
  excludeId: string | undefined,
  session: ClientSession,
): Promise<void> {
  const filter = {
    $or: [
      { normalized_name: normalizedName },
      { name_aliases: normalizedName },
    ],
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  };
  const duplicate =
    kind === "agents"
      ? await Agent.findOne(filter)
          .session(session)
          .select({ _id: 1 })
          .lean()
          .exec()
      : await Merchant.findOne(filter)
          .session(session)
          .select({ _id: 1 })
          .lean()
          .exec();
  if (duplicate) {
    throw new RegistryError("A catalog name or alias already uses this identifier.", {
      registryCode: REGISTRY_ERROR_CODES.DUPLICATE_IDENTIFIER,
    });
  }
}

async function assertGranotUsernameAvailable(
  username: string,
  excludeId: string | undefined,
  session: ClientSession,
): Promise<void> {
  const duplicate = await Agent.findOne({
    $or: [
      { "granot_identity.username": username },
      { granot_crm_username: username },
    ],
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  })
    .session(session)
    .select({ _id: 1 })
    .lean()
    .exec();
  if (duplicate) {
    throw new RegistryError("Granot username is already assigned to another Agent.", {
      registryCode: REGISTRY_ERROR_CODES.DUPLICATE_IDENTIFIER,
    });
  }
}

function mutableAudit(
  entityType: "agent" | "merchant",
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

function mergeAlias(
  aliases: readonly string[] | undefined,
  oldNormalizedName: string,
  newNormalizedName: string,
): string[] {
  return [
    ...new Set([
      ...(aliases ?? []).map(normalizeAgentName),
      ...(oldNormalizedName !== newNormalizedName ? [oldNormalizedName] : []),
    ]),
  ].filter((alias) => alias && alias !== newNormalizedName);
}

function documentToCatalogLean(
  doc: AgentDocument | MerchantDocument,
): CatalogLeanDocument {
  const candidate = doc as unknown as {
    toObject?: (options: { virtuals: boolean }) => unknown;
  };
  return (candidate.toObject
    ? candidate.toObject({ virtuals: true })
    : doc) as CatalogLeanDocument;
}

async function createAgentDocument(
  update: Record<string, unknown>,
  session: ClientSession,
): Promise<AgentDocument> {
  const doc = new Agent({ ...update, active: update.active ?? true });
  await doc.save({ session });
  return doc;
}

async function createMerchantDocument(
  update: Record<string, unknown>,
  session: ClientSession,
): Promise<MerchantDocument> {
  const doc = new Merchant({ ...update, active: update.active ?? true });
  await doc.save({ session });
  return doc;
}

function toCatalogItem(doc: CatalogLeanDocument): RegistryCatalogItem {
  const granot = doc.granot_identity;
  return {
    id: String(doc._id),
    name: String(doc.name ?? ""),
    normalized_name: String(doc.normalized_name ?? ""),
    name_aliases: strings(doc.name_aliases),
    active: doc.active !== false,
    ...(typeof doc.role === "string" ? { role: doc.role } : {}),
    ...(granot && typeof granot.username === "string"
      ? {
          granot_identity: {
            username: granot.username,
            verified: granot.verified === true,
            ...(granot.verified_at instanceof Date
              ? { verified_at: granot.verified_at }
              : {}),
            ...(granot.last_observed_at instanceof Date
              ? { last_observed_at: granot.last_observed_at }
              : {}),
          },
        }
      : {}),
    ...(typeof doc.granot_crm_username === "string"
      ? { granot_crm_username: doc.granot_crm_username }
      : {}),
    ...(typeof doc.outreach_desk === "string" &&
    (OUTREACH_DESK_SETTINGS as readonly string[]).includes(doc.outreach_desk)
      ? { outreach_desk: doc.outreach_desk as OutreachDeskSetting }
      : {}),
    ...(doc.archived_at instanceof Date ? { archived_at: doc.archived_at } : {}),
    ...(typeof doc.deactivation_reason === "string"
      ? { deactivation_reason: doc.deactivation_reason }
      : {}),
    created_from: String(doc.created_from ?? ""),
    ...(doc.createdAt instanceof Date ? { createdAt: doc.createdAt } : {}),
    ...(doc.updatedAt instanceof Date ? { updatedAt: doc.updatedAt } : {}),
  };
}

function assertOwner(actor: RegistryActorContext): void {
  if (actor.actorRole !== "owner") {
    throw new RegistryError("Registry mutations require an Owner actor.", {
      registryCode: REGISTRY_ERROR_CODES.FORBIDDEN,
    });
  }
}

function registryNotFound(label: string): RegistryError {
  return new RegistryError(`${label} not found.`, {
    registryCode: REGISTRY_ERROR_CODES.NOT_FOUND,
  });
}

function registryValidationError(message: string): RegistryError {
  return new RegistryError(message, {
    registryCode: REGISTRY_ERROR_CODES.IMMUTABLE_FIELD,
    statusCode: 400,
  });
}

function canonicalName(value: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) {
    throw registryValidationError("Name is required.");
  }
  return name;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function sum(values: Record<string, number>): number {
  return Object.values(values).reduce((total, value) => total + value, 0);
}
