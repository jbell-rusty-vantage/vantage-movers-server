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
import {
  listLeadSourceCompanies,
  type LeadSourceGranularityItem,
} from "../leadSourceCompanies";
import { recordDurableCompatibilityRead } from "../operationsRegistry/runtimeTelemetry";

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
  await recordDurableCompatibilityRead("legacy_cpl_rates", "unknown");
  const key = cplRateCacheKey(sourceCompany, leadType, local);
  const loaded = await loadCache();
  if (loaded.has(key)) {
    return loaded.get(key)!;
  }
  return fallbackDefault(sourceCompany, leadType, local);
}

export async function listCplRates(): Promise<CplRateItem[]> {
  await recordDurableCompatibilityRead("legacy_cpl_rates", "admin_list");
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
