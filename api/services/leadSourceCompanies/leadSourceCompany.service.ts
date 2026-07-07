import mongoose from "mongoose";
import {
  CPL_RATE_DEFINITIONS,
  SOURCE_COMPANY_CONFIGS,
  type LocalType,
} from "../../config/domain";
import {
  getLeadSourceCompanyModel,
  type LeadSourceCompanyDocument,
  type LeadSourceGranularity,
} from "../../models/LeadSourceCompany";
import { ValidationError } from "../errors";
import { V1ServiceError } from "../v1ServiceError";

export type LeadSourceChannel = "form" | "call";

export type LeadSourceCompanyInput = {
  company_slug: string;
  name: string;
  owner_label?: string;
  aliases?: string[];
  active?: boolean;
  default_form_granularity_key?: string;
  default_call_granularity_key?: string;
  sheet_config?: {
    spreadsheet_id?: string;
    has_bad_tabs?: boolean;
  };
  granularities?: LeadSourceGranularityInput[];
  created_from?: string;
};

export type LeadSourceGranularityInput = {
  granularity_key: string;
  channel: LeadSourceChannel;
  owner_label: string;
  crm_label: string;
  aliases?: string[];
  active?: boolean;
  cpl?: number;
  local?: LocalType;
  source_sites?: string[];
  inbound_phone_numbers?: string[];
  priority?: number;
  sheet_tab_name?: string;
};

export type LeadSourceCompanyItem = {
  id: string;
  _id: string;
  company_slug: string;
  name: string;
  owner_label: string;
  aliases: string[];
  active: boolean;
  archived_at?: Date;
  default_form_granularity_key?: string;
  default_call_granularity_key?: string;
  sheet_config?: {
    spreadsheet_id?: string;
    has_bad_tabs: boolean;
  };
  granularities: LeadSourceGranularityItem[];
  created_from: string;
  createdAt?: Date;
  updatedAt?: Date;
};

export type LeadSourceGranularityItem = {
  id: string;
  _id: string;
  granularity_key: string;
  channel: LeadSourceChannel;
  owner_label: string;
  crm_label: string;
  aliases: string[];
  active: boolean;
  archived_at?: Date;
  cpl: number;
  local?: LocalType;
  source_sites: string[];
  inbound_phone_numbers: string[];
  priority: number;
  sheet_tab_name?: string;
};

export type LeadSourceResolution = {
  company: LeadSourceCompanyItem;
  granularity: LeadSourceGranularityItem;
};

export type LeadSourceResolveInput = {
  value?: string | null;
  company_slug?: string | null;
  granularity_key?: string | null;
  channel: LeadSourceChannel;
  local?: LocalType;
  source_site?: string | null;
  inbound_phone_number?: string | null;
  requireActive?: boolean;
};

let seedPromise: Promise<void> | undefined;

const LEGACY_RINGCENTRAL_INBOUND_NUMBERS_BY_LABEL: Record<string, string[]> = {
  "10best Inbounds": ["+18883164387"],
  "TBM Prime Inbounds": ["+18883083612"],
  "Top10 Inbounds": ["+18887240625"],
  "Main Site Inbounds": ["+18884779232"],
  "GetMovers Inbounds": ["+18883971005"],
};

export async function ensureLeadSourceCompaniesSeeded(): Promise<void> {
  if (!seedPromise) {
    seedPromise = seedKnownLeadSourceCompanies();
  }
  return seedPromise;
}

export async function listLeadSourceCompanies(
  options: { includeInactive?: boolean } = {},
): Promise<LeadSourceCompanyItem[]> {
  await ensureLeadSourceCompaniesSeeded();
  const Model = getLeadSourceCompanyModel();
  const filter = options.includeInactive ? {} : { active: true };
  const docs = await Model.find(filter).sort({ owner_label: 1 }).lean().exec();
  return docs.map(toCompanyItem);
}

export async function getLeadSourceCompany(id: string): Promise<LeadSourceCompanyItem> {
  const Model = getLeadSourceCompanyModel();
  const doc = await Model.findById(id).lean().exec();
  if (!doc) {
    throw new V1ServiceError("Lead source company not found", 404);
  }
  return toCompanyItem(doc);
}

export async function createLeadSourceCompany(
  input: LeadSourceCompanyInput,
): Promise<LeadSourceCompanyItem> {
  const Model = getLeadSourceCompanyModel();
  try {
    const doc = await Model.create(normalizeCompanyInput(input));
    return toCompanyItem(doc.toObject({ virtuals: true }));
  } catch (error) {
    if (isMongoDuplicateKeyError(error)) {
      throw new V1ServiceError(
        `Lead source company already exists: ${input.company_slug}`,
        409,
      );
    }
    throw error;
  }
}

export async function updateLeadSourceCompany(
  id: string,
  input: Partial<LeadSourceCompanyInput>,
): Promise<LeadSourceCompanyItem> {
  const Model = getLeadSourceCompanyModel();
  const update: Record<string, unknown> = {};
  if (input.name !== undefined) update.name = canonicalLabel(input.name);
  if (input.owner_label !== undefined) update.owner_label = canonicalLabel(input.owner_label);
  if (input.aliases !== undefined) update.aliases = normalizeStringList(input.aliases);
  if (input.active !== undefined) {
    update.active = input.active;
    update.archived_at = input.active ? undefined : new Date();
  }
  if (input.default_form_granularity_key !== undefined) {
    update.default_form_granularity_key = normalizeKey(input.default_form_granularity_key);
  }
  if (input.default_call_granularity_key !== undefined) {
    update.default_call_granularity_key = normalizeKey(input.default_call_granularity_key);
  }
  if (input.sheet_config !== undefined) {
    update.sheet_config = {
      spreadsheet_id: optionalTrim(input.sheet_config.spreadsheet_id),
      has_bad_tabs: input.sheet_config.has_bad_tabs === true,
    };
  }
  if (input.granularities !== undefined) {
    update.granularities = input.granularities.map(normalizeGranularityInput);
  }

  try {
    const doc = await Model.findByIdAndUpdate(
      id,
      { $set: update },
      { returnDocument: "after", runValidators: true },
    ).orFail();
    return toCompanyItem(doc.toObject({ virtuals: true }));
  } catch (error) {
    if (error instanceof Error && error.name === "DocumentNotFoundError") {
      throw new V1ServiceError("Lead source company not found", 404);
    }
    throw error;
  }
}

export async function resolveLeadSource(
  input: LeadSourceResolveInput,
): Promise<LeadSourceResolution> {
  await ensureLeadSourceCompaniesSeeded();
  const requireActive = input.requireActive !== false;
  const companies = await listLeadSourceCompanies({ includeInactive: !requireActive });
  const candidates = requireActive
    ? companies.filter((company) => company.active)
    : companies;
  const normalizedCompanySlug = normalizeMaybe(input.company_slug);
  const normalizedValue = normalizeMaybe(input.value);
  const fallbackCompanySlug =
    normalizedCompanySlug === "not_provided" || normalizedValue === "not_provided"
      ? "main_site"
      : input.company_slug;

  const company =
    matchCompany(candidates, fallbackCompanySlug) ??
    matchCompany(candidates, input.value) ??
    matchCompanyByGranularity(candidates, input);

  if (!company) {
    throw new ValidationError(`Unknown source_company "${input.value ?? input.company_slug ?? ""}"`, {
      metadata: {
        field: "source_company",
        value: input.value ?? input.company_slug ?? null,
      },
    });
  }

  const granularity = selectGranularity(company, input, requireActive);
  if (!granularity) {
    throw new ValidationError(
      `Unknown ${input.channel} source granularity for "${company.company_slug}"`,
      {
        metadata: {
          field: "source_granularity",
          source_company: company.company_slug,
          value: input.granularity_key ?? input.value ?? null,
        },
      },
    );
  }

  return { company, granularity };
}

export function leadSourceAssignmentFields(resolution: LeadSourceResolution) {
  return {
    source_company: resolution.company.company_slug,
    lead_source_company: new mongoose.Types.ObjectId(resolution.company.id),
    source_granularity_id: new mongoose.Types.ObjectId(resolution.granularity.id),
    source_granularity_key: resolution.granularity.granularity_key,
    source_company_label_snapshot: resolution.company.owner_label,
    source_granularity_label_snapshot: resolution.granularity.owner_label,
    crm_source_label_snapshot: resolution.granularity.crm_label,
  };
}

export async function getCplForLeadSource(
  input: LeadSourceResolveInput,
): Promise<number> {
  const resolution = await resolveLeadSource(input);
  return resolution.granularity.cpl;
}

async function seedKnownLeadSourceCompanies(): Promise<void> {
  const Model = getLeadSourceCompanyModel();
  const existing = await Model.find({}, { company_slug: 1 }).lean().exec();
  const existingSlugs = new Set(existing.map((doc) => doc.company_slug));
  const seeds = knownLeadSourceCompanySeeds().filter(
    (seed) => !existingSlugs.has(seed.company_slug),
  );
  if (!seeds.length) {
    return;
  }

  await Promise.all(
    seeds.map((seed) =>
      Model.updateOne(
        { company_slug: seed.company_slug },
        { $setOnInsert: normalizeCompanyInput(seed) },
        { upsert: true },
      ).exec(),
    ),
  );
}

function knownLeadSourceCompanySeeds(): LeadSourceCompanyInput[] {
  return Object.values(SOURCE_COMPANY_CONFIGS)
    .filter((config) => config.slug !== "not_provided")
    .map((config) => {
      const definitions = CPL_RATE_DEFINITIONS.filter(
        (definition) => definition.sourceCompany === config.slug,
      );
      const granularities = definitions.map<LeadSourceGranularityInput>((definition) => ({
        granularity_key: granularityKeyForDefinition(definition),
        channel: definition.leadType,
        owner_label: definition.label,
        crm_label: definition.label,
        aliases: [definition.label],
        active: true,
        cpl: definition.defaultCpl,
        ...(definition.local ? { local: definition.local } : {}),
        inbound_phone_numbers:
          definition.leadType === "call"
            ? LEGACY_RINGCENTRAL_INBOUND_NUMBERS_BY_LABEL[definition.label] ?? []
            : [],
        priority: definition.local ? 10 : 0,
      }));
      const defaultForm = granularities.find(
        (granularity) =>
          granularity.channel === "form" &&
          (granularity.local === "long_distance" || !granularity.local),
      );
      const defaultCall = granularities.find((granularity) => granularity.channel === "call");
      return {
        company_slug: config.slug,
        name: config.label,
        owner_label: config.label,
        aliases: [...config.aliases],
        active: true,
        default_form_granularity_key: defaultForm?.granularity_key,
        default_call_granularity_key: defaultCall?.granularity_key,
        sheet_config: { has_bad_tabs: config.hasBadTabs },
        granularities,
        created_from: "legacy_seed",
      };
    });
}

function selectGranularity(
  company: LeadSourceCompanyItem,
  input: LeadSourceResolveInput,
  requireActive: boolean,
): LeadSourceGranularityItem | undefined {
  const granularities = company.granularities
    .filter((granularity) => granularity.channel === input.channel)
    .filter((granularity) => !requireActive || granularity.active)
    .sort((a, b) => b.priority - a.priority);

  const byKey = normalizeMaybe(input.granularity_key);
  if (byKey) {
    return granularities.find((granularity) => normalizeKey(granularity.granularity_key) === byKey);
  }

  const byPhone = normalizePhone(input.inbound_phone_number);
  if (byPhone) {
    const matched = granularities.find((granularity) =>
      granularity.inbound_phone_numbers.some((phone) => normalizePhone(phone) === byPhone),
    );
    if (matched) return matched;
  }

  const bySite = normalizeMaybe(input.source_site);
  if (bySite) {
    const matched = granularities.find((granularity) =>
      granularity.source_sites.some((site) => normalizeMaybe(site) === bySite),
    );
    if (matched) return matched;
  }

  const byLabel = normalizeMaybe(input.value);
  if (byLabel) {
    const matched = granularities.find((granularity) =>
      labelsForGranularity(granularity).some((label) => normalizeMaybe(label) === byLabel),
    );
    if (matched) return matched;
  }

  if (input.local) {
    const localMatched = granularities.find((granularity) => granularity.local === input.local);
    if (localMatched) return localMatched;
  }

  const defaultKey =
    input.channel === "form"
      ? company.default_form_granularity_key
      : company.default_call_granularity_key;
  if (defaultKey) {
    return granularities.find(
      (granularity) => granularity.granularity_key === normalizeKey(defaultKey),
    );
  }

  return granularities[0];
}

function matchCompany(
  companies: LeadSourceCompanyItem[],
  value?: string | null,
): LeadSourceCompanyItem | undefined {
  const normalized = normalizeMaybe(value);
  if (!normalized) {
    return undefined;
  }
  return companies.find((company) =>
    [company.company_slug, company.name, company.owner_label, ...company.aliases].some(
      (candidate) => normalizeMaybe(candidate) === normalized,
    ),
  );
}

function matchCompanyByGranularity(
  companies: LeadSourceCompanyItem[],
  input: LeadSourceResolveInput,
): LeadSourceCompanyItem | undefined {
  const normalized = normalizeMaybe(input.value);
  const phone = normalizePhone(input.inbound_phone_number);
  const site = normalizeMaybe(input.source_site);
  return companies.find((company) =>
    company.granularities.some((granularity) => {
      if (granularity.channel !== input.channel) return false;
      if (normalized && labelsForGranularity(granularity).some((label) => normalizeMaybe(label) === normalized)) {
        return true;
      }
      if (phone && granularity.inbound_phone_numbers.some((candidate) => normalizePhone(candidate) === phone)) {
        return true;
      }
      if (site && granularity.source_sites.some((candidate) => normalizeMaybe(candidate) === site)) {
        return true;
      }
      return false;
    }),
  );
}

function labelsForGranularity(granularity: LeadSourceGranularityItem): string[] {
  return [
    granularity.granularity_key,
    granularity.owner_label,
    granularity.crm_label,
    ...granularity.aliases,
  ];
}

function normalizeCompanyInput(input: LeadSourceCompanyInput): Record<string, unknown> {
  return {
    company_slug: normalizeKey(input.company_slug),
    name: canonicalLabel(input.name),
    owner_label: canonicalLabel(input.owner_label ?? input.name),
    aliases: normalizeStringList(input.aliases),
    active: input.active ?? true,
    ...(input.active === false ? { archived_at: new Date() } : {}),
    default_form_granularity_key: optionalKey(input.default_form_granularity_key),
    default_call_granularity_key: optionalKey(input.default_call_granularity_key),
    sheet_config: {
      spreadsheet_id: optionalTrim(input.sheet_config?.spreadsheet_id),
      has_bad_tabs: input.sheet_config?.has_bad_tabs === true,
    },
    granularities: (input.granularities ?? []).map(normalizeGranularityInput),
    created_from: input.created_from?.trim() || "admin",
  };
}

function normalizeGranularityInput(input: LeadSourceGranularityInput): Record<string, unknown> {
  return {
    granularity_key: normalizeKey(input.granularity_key),
    channel: input.channel,
    owner_label: canonicalLabel(input.owner_label),
    crm_label: canonicalLabel(input.crm_label),
    aliases: normalizeStringList(input.aliases),
    active: input.active ?? true,
    ...(input.active === false ? { archived_at: new Date() } : {}),
    cpl: input.cpl ?? 0,
    ...(input.local ? { local: input.local } : {}),
    source_sites: normalizeStringList(input.source_sites),
    inbound_phone_numbers: normalizeStringList(input.inbound_phone_numbers),
    priority: input.priority ?? 0,
    sheet_tab_name: optionalTrim(input.sheet_tab_name),
  };
}

function toCompanyItem(doc: Record<string, unknown>): LeadSourceCompanyItem {
  const id = String(doc._id ?? doc.id ?? "");
  const sheetConfig = doc.sheet_config as
    | { spreadsheet_id?: unknown; has_bad_tabs?: unknown }
    | undefined;
  return {
    id,
    _id: id,
    company_slug: String(doc.company_slug ?? ""),
    name: String(doc.name ?? ""),
    owner_label: String(doc.owner_label ?? doc.name ?? ""),
    aliases: arrayOfStrings(doc.aliases),
    active: doc.active !== false,
    ...(doc.archived_at instanceof Date ? { archived_at: doc.archived_at } : {}),
    ...(typeof doc.default_form_granularity_key === "string"
      ? { default_form_granularity_key: doc.default_form_granularity_key }
      : {}),
    ...(typeof doc.default_call_granularity_key === "string"
      ? { default_call_granularity_key: doc.default_call_granularity_key }
      : {}),
    sheet_config: {
      ...(typeof sheetConfig?.spreadsheet_id === "string"
        ? { spreadsheet_id: sheetConfig.spreadsheet_id }
        : {}),
      has_bad_tabs: sheetConfig?.has_bad_tabs === true,
    },
    granularities: Array.isArray(doc.granularities)
      ? doc.granularities.map(toGranularityItem)
      : [],
    created_from: String(doc.created_from ?? ""),
    ...(doc.createdAt instanceof Date ? { createdAt: doc.createdAt } : {}),
    ...(doc.updatedAt instanceof Date ? { updatedAt: doc.updatedAt } : {}),
  };
}

function toGranularityItem(doc: Record<string, unknown>): LeadSourceGranularityItem {
  const id = String(doc._id ?? doc.id ?? "");
  return {
    id,
    _id: id,
    granularity_key: String(doc.granularity_key ?? ""),
    channel: doc.channel === "call" ? "call" : "form",
    owner_label: String(doc.owner_label ?? ""),
    crm_label: String(doc.crm_label ?? ""),
    aliases: arrayOfStrings(doc.aliases),
    active: doc.active !== false,
    ...(doc.archived_at instanceof Date ? { archived_at: doc.archived_at } : {}),
    cpl: typeof doc.cpl === "number" ? doc.cpl : 0,
    ...(doc.local === "local" || doc.local === "long_distance" ? { local: doc.local } : {}),
    source_sites: arrayOfStrings(doc.source_sites),
    inbound_phone_numbers: arrayOfStrings(doc.inbound_phone_numbers),
    priority: typeof doc.priority === "number" ? doc.priority : 0,
    ...(typeof doc.sheet_tab_name === "string" ? { sheet_tab_name: doc.sheet_tab_name } : {}),
  };
}

function granularityKeyForDefinition(definition: {
  sourceCompany: string;
  leadType: string;
  local?: string;
}): string {
  return normalizeKey(
    [definition.sourceCompany, definition.leadType, definition.local]
      .filter(Boolean)
      .join("_"),
  );
}

function canonicalLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeStringList(values?: string[]): string[] {
  return [...new Set((values ?? []).map(optionalTrim).filter(Boolean) as string[])];
}

function optionalTrim(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function optionalKey(value?: string | null): string | undefined {
  return value ? normalizeKey(value) : undefined;
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function normalizeMaybe(value?: string | null): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

function normalizePhone(value?: string | null): string | undefined {
  const digits = value?.replace(/\D/g, "");
  return digits || undefined;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isMongoDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}
