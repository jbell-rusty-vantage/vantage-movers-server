import {
  CPL_RATE_DEFINITIONS,
  cplRateCacheKey,
  findCplRateDefinition,
  type CplLeadType,
  type CplRateDefinition,
} from "../../config/domain/cplRateDefinitions";
import type { LocalType } from "../../config/domain/constants";
import type { SourceCompany } from "../../config/domain/sources";
import { CplRate, type CplRateDocument } from "../../models/CplRate";
import { CallLead } from "../../models/CallLead";
import { FormLead } from "../../models/FormLead";
import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import {
  listLeadSourceCompanies,
  type LeadSourceGranularityItem,
} from "../leadSourceCompanies";
import { V1ServiceError } from "../v1ServiceError";

export type CplRateItem = {
  id: string;
  label: string;
  source_company: string;
  lead_source_company?: string;
  source_granularity_key?: string;
  lead_type: CplLeadType;
  local?: LocalType;
  cpl: number;
  createdAt?: Date;
  updatedAt?: Date;
};

export type UpdateCplRateResult = {
  rate: CplRateItem;
  leads_updated: number;
};

/**
 * Short-TTL in-memory mirror of the `cpl_rates` collection.
 *
 * CPL rates change rarely (an owner editing a price), so a short TTL cache
 * keeps `getCplRate` fast on the hot lead-create/update path without ever
 * going more than a few seconds stale across server instances. Any write
 * through `updateCplRate` invalidates the cache in-process immediately, so
 * the instance that served the write always sees the new value right away.
 */
const CACHE_TTL_MS = 30_000;
let cache: Map<string, number> | undefined;
let cacheLoadedAt = 0;
let inflightLoad: Promise<Map<string, number>> | undefined;

export function invalidateCplRateCache(): void {
  cache = undefined;
  cacheLoadedAt = 0;
  inflightLoad = undefined;
}

/**
 * Resolves the CPL for a source company / lead type / local triple, backed
 * by the `cpl_rates` collection. Falls back to `CPL_RATE_DEFINITIONS`
 * defaults if Mongo is unreachable so lead creation never hard-fails on a
 * CPL lookup.
 */
export async function getCplRate(
  sourceCompany: SourceCompany,
  leadType: CplLeadType,
  local: LocalType | undefined,
): Promise<number> {
  const key = cplRateCacheKey(sourceCompany, leadType, local);
  const loaded = await loadCache();
  if (loaded.has(key)) {
    return loaded.get(key)!;
  }
  return fallbackDefault(sourceCompany, leadType, local);
}

export async function listCplRates(): Promise<CplRateItem[]> {
  const sourceCompanies = await listLeadSourceCompanies({ includeInactive: true });
  const catalogRates = sourceCompanies.flatMap((company) =>
    company.granularities.map((granularity) =>
      toCatalogCplRateItem(company, granularity),
    ),
  );
  if (catalogRates.length) {
    return catalogRates;
  }

  await ensureCplRatesSeeded();
  const docs = await CplRate.find().lean().exec();
  const byLabel = new Map(docs.map((doc) => [doc.label, doc]));
  return CPL_RATE_DEFINITIONS.map((definition) => {
    const doc = byLabel.get(definition.label);
    return toCplRateItem(definition, doc);
  });
}

export async function updateCplRate(label: string, cpl: number): Promise<UpdateCplRateResult> {
  const catalogUpdate = await updateCatalogGranularityCpl(label, cpl);
  if (catalogUpdate) {
    invalidateCplRateCache();
    return catalogUpdate;
  }

  const definition = findCplRateDefinition(label);
  if (!definition) {
    throw new V1ServiceError(`Unknown CPL rate label: ${label}`, 404);
  }

  const doc = await CplRate.findOneAndUpdate(
    { label: definition.label },
    {
      $set: {
        cpl,
        source_company: definition.sourceCompany,
        lead_type: definition.leadType,
        ...(definition.local ? { local: definition.local } : { local: undefined }),
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).exec();

  invalidateCplRateCache();

  const leads_updated = await backfillLeadsForDefinition(definition, cpl);

  return { rate: toCplRateItem(definition, doc), leads_updated };
}

async function updateCatalogGranularityCpl(
  label: string,
  cpl: number,
): Promise<UpdateCplRateResult | undefined> {
  const sourceCompanies = await listLeadSourceCompanies({ includeInactive: true });
  const normalizedLabel = label.trim().toLowerCase();
  const sourceCompany = sourceCompanies.find((company) =>
    company.granularities.some((granularity) =>
      [
        granularity.granularity_key,
        granularity.owner_label,
        granularity.crm_label,
        ...granularity.aliases,
      ].some((candidate) => candidate.trim().toLowerCase() === normalizedLabel),
    ),
  );
  const granularity = sourceCompany?.granularities.find((candidate) =>
    [
      candidate.granularity_key,
      candidate.owner_label,
      candidate.crm_label,
      ...candidate.aliases,
    ].some((value) => value.trim().toLowerCase() === normalizedLabel),
  );
  if (!sourceCompany || !granularity) {
    return undefined;
  }

  const Model = getLeadSourceCompanyModel();
  await Model.updateOne(
    {
      _id: sourceCompany.id,
      "granularities.granularity_key": granularity.granularity_key,
    },
    { $set: { "granularities.$.cpl": cpl } },
    { runValidators: true },
  ).exec();

  const leads_updated = await backfillLeadsForGranularity(
    sourceCompany.company_slug,
    granularity,
    cpl,
  );
  return {
    rate: { ...toCatalogCplRateItem(sourceCompany, granularity), cpl },
    leads_updated,
  };
}

async function backfillLeadsForGranularity(
  sourceCompany: string,
  granularity: LeadSourceGranularityItem,
  cpl: number,
): Promise<number> {
  const filter: Record<string, unknown> = {
    source_company: sourceCompany,
    duplicate: { $ne: true },
    $or: [
      { source_granularity_key: granularity.granularity_key },
      { source_granularity_key: { $exists: false } },
      { source_granularity_key: null },
    ],
  };
  if (granularity.local) {
    filter.local = granularity.local;
  }
  const result =
    granularity.channel === "form"
      ? await FormLead.updateMany(filter, { $set: { cpl } }).exec()
      : await CallLead.updateMany(filter, { $set: { cpl } }).exec();
  return result.modifiedCount ?? 0;
}

async function backfillLeadsForDefinition(
  definition: CplRateDefinition,
  cpl: number,
): Promise<number> {
  const filter: Record<string, unknown> = {
    source_company: definition.sourceCompany,
    duplicate: { $ne: true },
  };
  if (definition.local) {
    filter.local = definition.local;
  }

  const result =
    definition.leadType === "form"
      ? await FormLead.updateMany(filter, { $set: { cpl } }).exec()
      : await CallLead.updateMany(filter, { $set: { cpl } }).exec();
  return result.modifiedCount ?? 0;
}

async function ensureCplRatesSeeded(): Promise<void> {
  const existing = await CplRate.find({}, { label: 1 }).lean().exec();
  const existingLabels = new Set(existing.map((doc) => doc.label));
  const missing = CPL_RATE_DEFINITIONS.filter((definition) => !existingLabels.has(definition.label));
  if (!missing.length) {
    return;
  }

  await Promise.all(
    missing.map((definition) =>
      CplRate.updateOne(
        { label: definition.label },
        {
          $setOnInsert: {
            label: definition.label,
            source_company: definition.sourceCompany,
            lead_type: definition.leadType,
            ...(definition.local ? { local: definition.local } : {}),
            cpl: definition.defaultCpl,
          },
        },
        { upsert: true },
      ).exec(),
    ),
  );
}

async function loadCache(): Promise<Map<string, number>> {
  if (cache && Date.now() - cacheLoadedAt < CACHE_TTL_MS) {
    return cache;
  }
  if (inflightLoad) {
    return inflightLoad;
  }

  inflightLoad = (async () => {
    try {
      await ensureCplRatesSeeded();
      const docs = await CplRate.find().lean().exec();
      const next = new Map<string, number>();
      for (const doc of docs) {
        const definition = findCplRateDefinition(doc.label);
        if (!definition) continue;
        next.set(cplRateCacheKey(definition.sourceCompany, definition.leadType, definition.local), doc.cpl);
      }
      cache = next;
      cacheLoadedAt = Date.now();
      return next;
    } catch {
      // Mongo unreachable or not yet connected -- return an empty map so
      // callers fall back to `CPL_RATE_DEFINITIONS` defaults. Do not cache
      // this empty result so the next call retries against Mongo.
      return new Map<string, number>();
    } finally {
      inflightLoad = undefined;
    }
  })();

  return inflightLoad;
}

function fallbackDefault(
  sourceCompany: SourceCompany,
  leadType: CplLeadType,
  local: LocalType | undefined,
): number {
  const matchesOnLocal = sourceCompany === "best_relocation_leads" && leadType === "form";
  const definition = CPL_RATE_DEFINITIONS.find((candidate) => {
    if (candidate.sourceCompany !== sourceCompany || candidate.leadType !== leadType) {
      return false;
    }
    if (!matchesOnLocal) {
      return true;
    }
    return candidate.local === (local ?? "long_distance");
  });
  return definition?.defaultCpl ?? 0;
}

function toCplRateItem(
  definition: CplRateDefinition,
  doc: Pick<CplRateDocument, "cpl" | "createdAt" | "updatedAt"> & { _id?: unknown } | undefined,
): CplRateItem {
  return {
    id: definition.label,
    label: definition.label,
    source_company: definition.sourceCompany,
    lead_type: definition.leadType,
    ...(definition.local ? { local: definition.local } : {}),
    cpl: doc?.cpl ?? definition.defaultCpl,
    ...(doc?.createdAt ? { createdAt: doc.createdAt } : {}),
    ...(doc?.updatedAt ? { updatedAt: doc.updatedAt } : {}),
  };
}

function toCatalogCplRateItem(
  company: { id: string; company_slug: string },
  granularity: LeadSourceGranularityItem,
): CplRateItem {
  return {
    id: granularity.crm_label,
    label: granularity.crm_label,
    source_company: company.company_slug,
    lead_source_company: company.id,
    source_granularity_key: granularity.granularity_key,
    lead_type: granularity.channel,
    ...(granularity.local ? { local: granularity.local } : {}),
    cpl: granularity.cpl,
  };
}
