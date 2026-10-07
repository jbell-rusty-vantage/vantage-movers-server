import type {
  CatalogCreateInput,
  CatalogUpdateInput,
} from "../../validation/v1.validation";
import {
  createOrUpdateAgent,
  createOrUpdateMerchant,
  getRegistryAgent,
  getRegistryMerchant,
  listRegistryAgents,
  listRegistryMerchants,
  resolveRegistryAgentByName,
  resolveRegistryMerchantByName,
  type RegistryActorContext,
  type RegistryCatalogItem,
} from "../operationsRegistry";
import { V1ServiceError } from "../v1ServiceError";
import { normalizeAgentName } from "../agents/agentName";
import type { OutreachDeskSetting } from "../../config/domain/salesOutreach";
import { deskMembershipsNow } from "../salesOutreach/roster/store";
import type { DeskMembership } from "../salesOutreach/roster/rule";

export type CatalogKind = "agents" | "merchants";

export type CatalogItem = {
  id: string;
  _id: string;
  name: string;
  normalized_name: string;
  active: boolean;
  created_from: string;
  role?: string;
  granot_crm_username?: string;
  name_aliases?: string[];
  archived_at?: Date;
  deactivation_reason?: string;
  /** Agents: the Owner's Outreach Desk control (`auto` when never set). */
  outreach_desk?: OutreachDeskSetting;
  /** Agents, on reads: whether the Agent is a desk rep now, and why (`deskMembership`). */
  desk_membership?: DeskMembership;
  createdAt?: Date;
  updatedAt?: Date;
};

export function normalizeCatalogName(name: string): string {
  return normalizeAgentName(name);
}

export type CatalogReadDeps = { deskMemberships?: typeof deskMembershipsNow };

export async function listCatalogItems(
  kind: CatalogKind,
  options: { includeInactive?: boolean } = {},
  deps: CatalogReadDeps = {},
): Promise<CatalogItem[]> {
  if (kind === "merchants") {
    return (await listRegistryMerchants(options)).map(toLegacyCatalogItem);
  }
  return withDeskMembership(await listRegistryAgents(options), deps);
}

export async function getCatalogItem(kind: CatalogKind, id: string): Promise<CatalogItem> {
  if (kind === "merchants") return toLegacyCatalogItem(await getRegistryMerchant(id));
  const [item] = await withDeskMembership([await getRegistryAgent(id)]);
  return item;
}

/** Agents with their current desk membership (one bounded link read for the whole list). */
async function withDeskMembership(agents: RegistryCatalogItem[], deps: CatalogReadDeps = {}): Promise<CatalogItem[]> {
  const memberships = await (deps.deskMemberships ?? deskMembershipsNow)(
    agents.map((agent) => ({
      _id: agent.id,
      id: agent.id,
      name: agent.name,
      active: agent.active,
      outreach_desk: agent.outreach_desk ?? null,
      granot_crm_username: agent.granot_crm_username ?? null,
      granot_identity: agent.granot_identity ?? null,
    })),
  );
  return agents.map((agent) => {
    const membership = memberships.get(agent.id);
    return { ...toLegacyCatalogItem(agent), ...(membership ? { desk_membership: membership } : {}) };
  });
}

export async function createCatalogItem(
  kind: CatalogKind,
  input: CatalogCreateInput,
  actor: RegistryActorContext,
): Promise<CatalogItem> {
  const item =
    kind === "agents"
      ? await createOrUpdateAgent(
          {
            name: input.name,
            role: input.role,
            granot_crm_username: input.granot_crm_username,
            outreach_desk: input.outreach_desk,
            active: input.active,
            created_from: input.created_from,
          },
          actor,
        )
      : await createOrUpdateMerchant(
          {
            name: input.name,
            created_from: input.created_from,
            active: input.active,
          },
          actor,
        );
  return toLegacyCatalogItem(item);
}

export async function updateCatalogItem(
  kind: CatalogKind,
  id: string,
  input: CatalogUpdateInput,
  actor: RegistryActorContext,
): Promise<CatalogItem> {
  const item =
    kind === "agents"
      ? await createOrUpdateAgent(
          {
            id,
            name: input.name,
            role: input.role,
            granot_crm_username: input.granot_crm_username,
            outreach_desk: input.outreach_desk,
            active: input.active,
            reason: input.reason,
          },
          actor,
        )
      : await createOrUpdateMerchant(
          {
            id,
            name: input.name,
            active: input.active,
            reason: input.reason,
          },
          actor,
        );
  return toLegacyCatalogItem(item);
}

export async function resolveActiveAgentByName(name: string): Promise<RegistryCatalogItem> {
  return resolveAgentByName(name);
}

export async function resolveAgentByName(
  name: string,
  options: { includeInactive?: boolean } = {},
): Promise<RegistryCatalogItem> {
  const agent = await resolveRegistryAgentByName(name, options);
  if (!agent) {
    throw new V1ServiceError(
      options.includeInactive ? `Unknown agent: ${name}` : `Unknown or inactive agent: ${name}`,
      400,
    );
  }
  return agent;
}

export async function resolveActiveMerchantName(name: string): Promise<string> {
  const merchant = await resolveRegistryMerchantByName(name);
  if (!merchant) {
    throw new V1ServiceError(`Unknown or inactive merchant: ${name}`, 400);
  }
  return merchant.name;
}

function toLegacyCatalogItem(item: RegistryCatalogItem): CatalogItem {
  const username =
    item.granot_crm_username ?? item.granot_identity?.username;
  return {
    id: item.id,
    _id: item.id,
    name: item.name,
    normalized_name: item.normalized_name,
    active: item.active,
    created_from: item.created_from,
    ...(item.role ? { role: item.role } : {}),
    ...(username ? { granot_crm_username: username } : {}),
    ...(item.name_aliases?.length ? { name_aliases: item.name_aliases } : {}),
    ...(item.archived_at ? { archived_at: item.archived_at } : {}),
    ...(item.deactivation_reason ? { deactivation_reason: item.deactivation_reason } : {}),
    ...(item.outreach_desk ? { outreach_desk: item.outreach_desk } : {}),
    ...(item.createdAt ? { createdAt: item.createdAt } : {}),
    ...(item.updatedAt ? { updatedAt: item.updatedAt } : {}),
  };
}
