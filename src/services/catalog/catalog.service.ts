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
  createdAt?: Date;
  updatedAt?: Date;
};

export function normalizeCatalogName(name: string): string {
  return normalizeAgentName(name);
}

export async function listCatalogItems(
  kind: CatalogKind,
  options: { includeInactive?: boolean } = {},
): Promise<CatalogItem[]> {
  const items =
    kind === "agents"
      ? await listRegistryAgents(options)
      : await listRegistryMerchants(options);
  return items.map(toLegacyCatalogItem);
}

export async function getCatalogItem(kind: CatalogKind, id: string): Promise<CatalogItem> {
  const item =
    kind === "agents" ? await getRegistryAgent(id) : await getRegistryMerchant(id);
  return toLegacyCatalogItem(item);
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
    ...(item.createdAt ? { createdAt: item.createdAt } : {}),
    ...(item.updatedAt ? { updatedAt: item.updatedAt } : {}),
  };
}
