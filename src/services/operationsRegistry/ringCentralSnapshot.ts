import {
  getRingCentralInboundRouteModel,
} from "../../models/RingCentralInboundRoute";
import {
  getRingCentralInboundRouteAssignmentModel,
} from "../../models/RingCentralInboundRouteAssignment";
import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../models/LeadSourceGranularity";
import { normalizePhoneNumberToE164Like } from "../ringcentral/phone-normalization";
import { recordOperationalEvent } from "../observability";
import { onRegistryCacheInvalidation } from "./cacheInvalidation";

export const RINGCENTRAL_ROUTE_CACHE_KEY = "ringcentral_routes";
const DEFAULT_SNAPSHOT_MAX_AGE_MS = 5 * 60 * 1000;
const DEFAULT_LAST_KNOWN_VALID_MAX_AGE_MS = 30 * 60 * 1000;

export type RingCentralRouteResolution = {
  route_id: string;
  assignment_id: string;
  normalized_target_number: string;
  company_id: string;
  company_slug: string;
  company_label_snapshot: string;
  granularity_id: string;
  granularity_key: string;
  granularity_label_snapshot: string;
  crm_label_snapshot: string;
};

export type RingCentralRouteSnapshotEntry = RingCentralRouteResolution & {
  effective_from: Date;
  effective_until?: Date;
};

export type RingCentralRouteSnapshot = Readonly<{
  version: 1;
  built_at: Date;
  max_age_ms: number;
  mapping_checksum?: string;
  entries_by_phone: ReadonlyMap<string, readonly RingCentralRouteSnapshotEntry[]>;
}>;

export type RingCentralSnapshotInput = {
  routes: Array<Record<string, unknown>>;
  assignments: Array<Record<string, unknown>>;
  companies: Array<Record<string, unknown>>;
  granularities: Array<Record<string, unknown>>;
  mappingChecksum?: string;
};

let cachedSnapshot: RingCentralRouteSnapshot | null = null;
let refreshPromise: Promise<RingCentralRouteSnapshot> | null = null;
let cacheGeneration = 0;
let snapshotLoader = loadSnapshotFromDatabase;

onRegistryCacheInvalidation((keys) => {
  if (
    keys.some((key) =>
      [
        RINGCENTRAL_ROUTE_CACHE_KEY,
        "source_companies",
        "source_granularities",
      ].includes(key),
    )
  ) {
    cacheGeneration += 1;
    cachedSnapshot = null;
  }
});

export async function loadRingCentralRouteSnapshot(
  options: { forceRefresh?: boolean; now?: Date } = {},
): Promise<RingCentralRouteSnapshot> {
  const now = options.now ?? new Date();
  if (
    !options.forceRefresh &&
    cachedSnapshot &&
    now.getTime() - cachedSnapshot.built_at.getTime() <= cachedSnapshot.max_age_ms
  ) {
    return cachedSnapshot;
  }
  if (refreshPromise) return refreshPromise;
  const pendingRefresh = refreshSnapshot(now)
    .catch(async (error) => {
      const staleAge = cachedSnapshot
        ? now.getTime() - cachedSnapshot.built_at.getTime()
        : Number.POSITIVE_INFINITY;
      await recordOperationalEvent({
        level: "error",
        eventKey: "ringcentral.route_cache.refresh_failed",
        category: "ringcentral",
        workflow: "operations_registry_ringcentral_cache",
        summary: "RingCentral route registry cache refresh failed.",
        details: {
          staleAgeMs: Number.isFinite(staleAge) ? staleAge : null,
          causeMessage: error instanceof Error ? error.message : String(error),
        },
        errorMessage: error instanceof Error ? error.message : String(error),
        notificationCandidate: true,
      });
      if (cachedSnapshot && staleAge <= getLastKnownValidMaxAgeMs()) {
        return cachedSnapshot;
      }
      throw error;
    })
    .finally(() => {
      if (refreshPromise === pendingRefresh) refreshPromise = null;
    });
  refreshPromise = pendingRefresh;
  return refreshPromise;
}

async function refreshSnapshot(startedAt: Date): Promise<RingCentralRouteSnapshot> {
  let loadAt = startedAt;
  while (true) {
    const startedGeneration = cacheGeneration;
    const snapshot = await snapshotLoader(loadAt);
    if (startedGeneration === cacheGeneration) {
      cachedSnapshot = snapshot;
      return snapshot;
    }
    loadAt = new Date();
  }
}

async function loadSnapshotFromDatabase(now: Date): Promise<RingCentralRouteSnapshot> {
  const Route = getRingCentralInboundRouteModel();
  const Assignment = getRingCentralInboundRouteAssignmentModel();
  const Company = getLeadSourceCompanyModel();
  const Granularity = getLeadSourceGranularityModel();
  const [routes, assignments, companies, granularities] = await Promise.all([
    Route.find({ ever_activated: true, validation_status: "valid" }).lean().exec(),
    Assignment.find({}).sort({ effective_from: 1 }).lean().exec(),
    Company.find({}).lean().exec(),
    Granularity.find({ channel: "call" }).lean().exec(),
  ]);
  return buildRingCentralRouteSnapshot(
    {
      routes: routes as unknown as Record<string, unknown>[],
      assignments: assignments as unknown as Record<string, unknown>[],
      companies: companies as unknown as Record<string, unknown>[],
      granularities: granularities as unknown as Record<string, unknown>[],
      mappingChecksum: process.env.RINGCENTRAL_REGISTRY_MAPPING_CHECKSUM?.trim(),
    },
    now,
  );
}

export function buildRingCentralRouteSnapshot(
  input: RingCentralSnapshotInput,
  builtAt = new Date(),
): RingCentralRouteSnapshot {
  const routes = new Map(input.routes.map((row) => [String(row._id), row]));
  const companies = new Map(input.companies.map((row) => [String(row._id), row]));
  const granularities = new Map(
    input.granularities.map((row) => [String(row._id), row]),
  );
  const byPhone = new Map<string, RingCentralRouteSnapshotEntry[]>();
  for (const assignment of input.assignments) {
    const route = routes.get(String(assignment.route));
    const company = companies.get(String(assignment.source_company));
    const granularity = granularities.get(String(assignment.source_granularity));
    if (!route || !company || !granularity) continue;
    if (company.active === false || granularity.active === false) continue;
    if (granularity.channel && granularity.channel !== "call") continue;
    if (String(granularity.source_company) !== String(company._id)) continue;
    const phone = normalizePhoneNumberToE164Like(String(route.phone_number ?? ""));
    const effectiveFrom = toDate(assignment.effective_from);
    const effectiveUntil = toDate(assignment.effective_until);
    if (!phone || !effectiveFrom) continue;
    const entry: RingCentralRouteSnapshotEntry = Object.freeze({
      route_id: String(route._id),
      assignment_id: String(assignment._id),
      normalized_target_number: phone,
      company_id: String(company._id),
      company_slug: String(company.company_slug),
      company_label_snapshot: String(company.owner_label ?? company.name ?? ""),
      granularity_id: String(granularity._id),
      granularity_key: String(granularity.granularity_key),
      granularity_label_snapshot: String(granularity.owner_label ?? ""),
      crm_label_snapshot: String(granularity.crm_label ?? ""),
      effective_from: effectiveFrom,
      ...(effectiveUntil ? { effective_until: effectiveUntil } : {}),
    });
    byPhone.set(phone, [...(byPhone.get(phone) ?? []), entry]);
  }
  for (const [phone, entries] of byPhone) {
    entries.sort(
      (left, right) =>
        left.effective_from.getTime() - right.effective_from.getTime(),
    );
    byPhone.set(phone, Object.freeze(entries) as RingCentralRouteSnapshotEntry[]);
  }
  return Object.freeze({
    version: 1,
    built_at: new Date(builtAt),
    max_age_ms: readPositiveMs(
      process.env.RINGCENTRAL_REGISTRY_SNAPSHOT_MAX_AGE_MS,
      DEFAULT_SNAPSHOT_MAX_AGE_MS,
    ),
    ...(input.mappingChecksum ? { mapping_checksum: input.mappingChecksum } : {}),
    entries_by_phone: byPhone,
  });
}

export function resolveRingCentralInboundRoute(
  snapshot: RingCentralRouteSnapshot,
  phoneNumber: string | null | undefined,
  callStartedAt: Date,
): RingCentralRouteResolution | null {
  const phone = normalizePhoneNumberToE164Like(phoneNumber);
  if (!phone || Number.isNaN(callStartedAt.getTime())) return null;
  const at = callStartedAt.getTime();
  const matched = [...(snapshot.entries_by_phone.get(phone) ?? [])]
    .reverse()
    .find(
      (entry) =>
        entry.effective_from.getTime() <= at &&
        (!entry.effective_until || at < entry.effective_until.getTime()),
    );
  if (!matched) return null;
  const {
    effective_from: _effectiveFrom,
    effective_until: _effectiveUntil,
    ...resolution
  } = matched;
  return resolution;
}

export function listRingCentralSnapshotNumbers(
  snapshot: RingCentralRouteSnapshot,
): string[] {
  return [...snapshot.entries_by_phone.keys()].sort();
}

export function listActiveRingCentralSnapshotNumbers(
  snapshot: RingCentralRouteSnapshot,
  at = new Date(),
): string[] {
  return listRingCentralSnapshotNumbers(snapshot).filter((phoneNumber) =>
    resolveRingCentralInboundRoute(snapshot, phoneNumber, at) !== null,
  );
}

export function resetRingCentralRouteSnapshotForTests(): void {
  cacheGeneration += 1;
  cachedSnapshot = null;
  refreshPromise = null;
}

export function setRingCentralSnapshotLoaderForTests(
  loader?: (now: Date) => Promise<RingCentralRouteSnapshot>,
): void {
  snapshotLoader = loader ?? loadSnapshotFromDatabase;
}

function getLastKnownValidMaxAgeMs(): number {
  return readPositiveMs(
    process.env.RINGCENTRAL_REGISTRY_LAST_KNOWN_VALID_MAX_AGE_MS,
    DEFAULT_LAST_KNOWN_VALID_MAX_AGE_MS,
  );
}

function readPositiveMs(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function toDate(value: unknown): Date | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  return undefined;
}
