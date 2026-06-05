import type { Model } from "mongoose";
import { Agent, type AgentDocument } from "../../models/Agent";
import { Merchant, type MerchantDocument } from "../../models/Merchant";
import type {
  CatalogCreateInput,
  CatalogUpdateInput,
} from "../../validation/v1.validation";
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
  createdAt?: Date;
  updatedAt?: Date;
};

type CatalogDocument = AgentDocument | MerchantDocument;

type CatalogModel = Model<CatalogDocument>;

type CatalogConfig = {
  model: CatalogModel;
  label: string;
  defaults: Record<string, unknown>;
};

const CATALOGS: Record<CatalogKind, CatalogConfig> = {
  agents: {
    model: Agent as CatalogModel,
    label: "Agent",
    defaults: { role: "agent", created_from: "admin" },
  },
  merchants: {
    model: Merchant as CatalogModel,
    label: "Merchant",
    defaults: { created_from: "admin" },
  },
};

export function normalizeCatalogName(name: string): string {
  return normalizeAgentName(name);
}

export async function listCatalogItems(
  kind: CatalogKind,
  options: { includeInactive?: boolean } = {},
): Promise<CatalogItem[]> {
  const config = CATALOGS[kind];
  const filter = options.includeInactive ? {} : { active: true };
  const docs = await config.model
    .find(filter)
    .sort({ name: 1 })
    .lean({ virtuals: true })
    .exec();
  return docs.map(toCatalogItem);
}

export async function getCatalogItem(kind: CatalogKind, id: string): Promise<CatalogItem> {
  const config = CATALOGS[kind];
  const doc = await config.model.findById(id).lean({ virtuals: true }).exec();
  if (!doc) {
    throw new V1ServiceError(`${config.label} not found`, 404);
  }
  return toCatalogItem(doc);
}

export async function createCatalogItem(
  kind: CatalogKind,
  input: CatalogCreateInput,
): Promise<CatalogItem> {
  const config = CATALOGS[kind];
  const name = canonicalName(input.name);
  const normalized_name = normalizeCatalogName(name);
  try {
    const doc = await config.model.create({
      ...config.defaults,
      name,
      normalized_name,
      active: input.active ?? true,
      ...(kind === "agents" && input.role ? { role: input.role } : {}),
    });
    return toCatalogItem(doc.toObject({ virtuals: true }));
  } catch (error) {
    if (isMongoDuplicateKeyError(error)) {
      throw new V1ServiceError(`${config.label} already exists: ${name}`, 409);
    }
    throw error;
  }
}

export async function updateCatalogItem(
  kind: CatalogKind,
  id: string,
  input: CatalogUpdateInput,
): Promise<CatalogItem> {
  const config = CATALOGS[kind];
  const update: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = canonicalName(input.name);
    update.name = name;
    update.normalized_name = normalizeCatalogName(name);
  }
  if (input.active !== undefined) {
    update.active = input.active;
  }
  if (kind === "agents" && input.role !== undefined) {
    update.role = input.role;
  }

  try {
    const doc = await config.model
      .findByIdAndUpdate(id, { $set: update }, { returnDocument: "after", runValidators: true })
      .orFail();
    return toCatalogItem(doc.toObject({ virtuals: true }));
  } catch (error) {
    if (isMongoDuplicateKeyError(error)) {
      throw new V1ServiceError(`${config.label} already exists: ${input.name}`, 409);
    }
    if (error instanceof Error && error.name === "DocumentNotFoundError") {
      throw new V1ServiceError(`${config.label} not found`, 404);
    }
    throw error;
  }
}

export async function resolveActiveAgentByName(name: string): Promise<AgentDocument> {
  const normalized_name = normalizeCatalogName(name);
  const agent = await Agent.findOne({ normalized_name, active: true }).exec();
  if (!agent) {
    throw new V1ServiceError(`Unknown or inactive agent: ${name}`, 400);
  }
  return agent;
}

export async function resolveActiveMerchantName(name: string): Promise<string> {
  const normalized_name = normalizeCatalogName(name);
  const merchant = await Merchant.findOne({ normalized_name, active: true }).exec();
  if (!merchant) {
    throw new V1ServiceError(`Unknown or inactive merchant: ${name}`, 400);
  }
  return merchant.name;
}

function canonicalName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

function toCatalogItem(doc: Record<string, unknown>): CatalogItem {
  const id = String(doc._id ?? doc.id ?? "");
  return {
    id,
    _id: id,
    name: String(doc.name ?? ""),
    normalized_name: String(doc.normalized_name ?? ""),
    active: doc.active === true,
    created_from: String(doc.created_from ?? ""),
    ...(typeof doc.role === "string" ? { role: doc.role } : {}),
    ...(doc.createdAt instanceof Date ? { createdAt: doc.createdAt } : {}),
    ...(doc.updatedAt instanceof Date ? { updatedAt: doc.updatedAt } : {}),
  };
}

function isMongoDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}
