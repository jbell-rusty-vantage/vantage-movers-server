import fs from "node:fs/promises";
import path from "node:path";
import mongoose, { type Connection, type mongo } from "mongoose";
import { connectMongo } from "../../src/db";
import { resolveSourceCompany } from "../../src/config/domain/sources";
import {
  normalizeComparisonName,
  normalizeJobNo,
  normalizeSubmissionLid,
} from "../../src/services/bookings/bookingIdentity";
import { normalizePhoneNumberForMatch } from "../../src/utils/phone";

type Doc = {
  _id: mongo.BSON.ObjectId;
  [key: string]: unknown;
};

type MatchAudit = {
  total: number;
  unique_matches: number;
  ambiguous_matches: number;
  unmatched: number;
  matched_by: Record<string, number>;
  by_window: Record<
    string,
    {
      total: number;
      unique_matches: number;
      ambiguous_matches: number;
      unmatched: number;
    }
  >;
};

const PRODUCTION_DB = "vantagemovers";
const HISTORICAL_DB = "vantagemovershistorical";
const OUTPUT_DIR = path.join(
  process.cwd(),
  "scripts",
  "historical",
  "reports",
);
const OVERLAP_START = new Date("2026-04-30T00:00:00.000Z");
const OVERLAP_END = new Date("2026-05-26T00:00:00.000Z");

const COLLECTION_FIELDS = {
  form_leads: [
    "source_company",
    "lead_source_company",
    "source_granularity_id",
    "source_granularity_key",
    "source_company_label_snapshot",
    "source_granularity_label_snapshot",
    "crm_source_label_snapshot",
    "name",
    "timestamp",
    "lid",
    "normalized_lid",
    "pickup_zip",
    "destination_zip",
    "move_size",
    "move_date",
    "ref_no",
    "booked",
    "cancelled",
    "local",
    "phone_number",
    "normalized_phone_number",
    "normalized_contact_name",
    "cpl",
    "receiver_agent",
    "receiver_agent_name_snapshot",
    "receiver_agent_source",
  ],
  call_leads: [
    "source_company",
    "lead_source_company",
    "source_granularity_id",
    "source_granularity_key",
    "source_company_label_snapshot",
    "source_granularity_label_snapshot",
    "crm_source_label_snapshot",
    "timestamp",
    "job_no",
    "normalized_job_no",
    "phone_number",
    "normalized_phone_number",
    "booked",
    "cancelled",
    "local",
    "form_fill",
    "duplicate",
    "cpl",
    "receiver_agent",
    "receiver_agent_name_snapshot",
    "receiver_agent_source",
  ],
  booked_leads: [
    "timestamp",
    "book_date",
    "job_no",
    "normalized_job_no",
    "customer",
    "lead_ref",
    "lead_model",
    "customer_name",
    "agent_allocations",
    "total_binder_amount",
    "deposit_amount",
    "merchant",
    "source",
    "is_referral_booking",
    "is_leadless_booking",
    "submission_id",
    "local",
    "cancelled",
  ],
  cancelled_leads: [
    "timestamp",
    "booked_lead",
    "customer",
    "lead_ref",
    "lead_model",
    "cancel_date",
    "job_no",
    "customer_name",
    "refund_amount",
    "merchant",
    "source",
  ],
  customers: ["full_name", "normalized_name", "phone_number", "email"],
  agents: [
    "name",
    "normalized_name",
    "active",
    "role",
    "created_from",
    "name_aliases",
    "granot_identity",
    "granot_crm_username",
  ],
} as const;

function getDb(connection: Connection): mongo.Db {
  if (!connection.db) {
    throw new Error(`Mongo connection ${connection.name} has no active Db`);
  }
  return connection.db;
}

async function loadCollection(
  db: mongo.Db,
  name: string,
): Promise<Doc[]> {
  return db.collection<Doc>(name).find({}).toArray();
}

function objectIdString(value: unknown): string | undefined {
  if (value instanceof mongoose.Types.ObjectId) {
    return value.toHexString();
  }
  if (
    value &&
    typeof value === "object" &&
    "toHexString" in value &&
    typeof value.toHexString === "function"
  ) {
    return String(value.toHexString());
  }
  return undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function dateValue(value: unknown): Date | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  return undefined;
}

function populated(value: unknown): boolean {
  if (value === null || value === undefined || value === "") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return true;
}

function dateWindow(value: unknown): string {
  const date = dateValue(value);
  if (!date) {
    return "undated";
  }
  if (date < OVERLAP_START) {
    return "before_2026-04-30";
  }
  if (date < OVERLAP_END) {
    return "2026-04-30_through_2026-05-25";
  }
  return "after_2026-05-25";
}

function dateSummary(docs: Doc[], field: string) {
  const dates = docs
    .map((doc) => dateValue(doc[field]))
    .filter((date): date is Date => Boolean(date));
  const byWindow: Record<string, number> = {};
  for (const doc of docs) {
    const window = dateWindow(doc[field]);
    byWindow[window] = (byWindow[window] ?? 0) + 1;
  }
  return {
    populated: dates.length,
    outside_2020_through_2030: dates.filter(
      (date) => date.getUTCFullYear() < 2020 || date.getUTCFullYear() > 2030,
    ).length,
    earliest:
      dates.length > 0
        ? new Date(Math.min(...dates.map((date) => date.getTime()))).toISOString()
        : null,
    latest:
      dates.length > 0
        ? new Date(Math.max(...dates.map((date) => date.getTime()))).toISOString()
        : null,
    by_window: byWindow,
  };
}

function dateAnomalies(docs: Doc[], field: string) {
  return docs
    .filter((doc) => {
      const date = dateValue(doc[field]);
      return (
        date &&
        (date.getUTCFullYear() < 2020 || date.getUTCFullYear() > 2030)
      );
    })
    .map((doc) => {
      const rawRow =
        doc.raw_row && typeof doc.raw_row === "object"
          ? (doc.raw_row as Record<string, unknown>)
          : {};
      return {
        mongo_id: objectIdString(doc._id),
        field,
        stored_value: dateValue(doc[field])?.toISOString(),
        source_row_key: stringValue(doc.source_row_key),
        source_workbook: stringValue(doc.source_workbook),
        source_tab: stringValue(doc.source_tab),
        source_row:
          typeof doc.source_row === "number" ? doc.source_row : undefined,
        raw_date_value:
          stringValue(rawRow["Book Date"]) ||
          stringValue(rawRow["Timestamp"]) ||
          stringValue(rawRow["Refund Request Date"]),
        raw_submission_timestamp: stringValue(rawRow["Timestamp"]),
      };
    });
}

function fieldCoverage(docs: Doc[], fields: readonly string[]) {
  return Object.fromEntries(
    fields.map((field) => {
      const count = docs.filter((doc) => populated(doc[field])).length;
      return [
        field,
        {
          populated: count,
          missing: docs.length - count,
          percent:
            docs.length > 0
              ? Number(((count / docs.length) * 100).toFixed(2))
              : 0,
        },
      ];
    }),
  );
}

function duplicateSummary(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values.filter(Boolean)) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const duplicateCounts = [...counts.values()].filter((count) => count > 1);
  return {
    populated: values.filter(Boolean).length,
    distinct: counts.size,
    duplicate_values: duplicateCounts.length,
    duplicate_rows: duplicateCounts.reduce((sum, count) => sum + count, 0),
    extra_rows_beyond_one:
      duplicateCounts.reduce((sum, count) => sum + count, 0) -
      duplicateCounts.length,
    max_rows_per_value:
      duplicateCounts.length > 0 ? Math.max(...duplicateCounts) : 0,
  };
}

function groupedCounts(
  docs: Doc[],
  fields: readonly string[],
): Record<string, number> {
  const counts = new Map<string, number>();
  for (const doc of docs) {
    const key = fields
      .map((field) => stringValue(doc[field]) || "(empty)")
      .join(" | ");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries(
    [...counts.entries()].sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    ),
  );
}

function normalizedSource(value: unknown): string {
  return resolveSourceCompany(stringValue(value)) ?? stringValue(value).toLowerCase();
}

function normalizedLid(doc: Doc): string {
  return (
    normalizeSubmissionLid(stringValue(doc.normalized_lid)) ??
    normalizeSubmissionLid(stringValue(doc.lid)) ??
    ""
  );
}

function normalizedReference(doc: Doc): string {
  return (
    normalizeJobNo(stringValue(doc.normalized_ref_no)) ??
    normalizeJobNo(stringValue(doc.ref_no)) ??
    ""
  );
}

function normalizedJob(doc: Doc): string {
  return (
    normalizeJobNo(stringValue(doc.normalized_job_no)) ??
    normalizeJobNo(stringValue(doc.job_no)) ??
    ""
  );
}

function normalizedPhone(doc: Doc): string {
  return (
    normalizePhoneNumberForMatch(stringValue(doc.normalized_phone_number)) ??
    normalizePhoneNumberForMatch(stringValue(doc.phone_number)) ??
    ""
  );
}

function minuteKey(value: unknown): string {
  const date = dateValue(value);
  if (!date) {
    return "";
  }
  return date.toISOString().slice(0, 16);
}

function dayKey(value: unknown): string {
  const date = dateValue(value);
  return date ? date.toISOString().slice(0, 10) : "";
}

function addIndex(
  index: Map<string, Doc[]>,
  key: string,
  doc: Doc,
): void {
  if (!key) {
    return;
  }
  const docs = index.get(key) ?? [];
  docs.push(doc);
  index.set(key, docs);
}

function buildIndex(
  docs: Doc[],
  keyFor: (doc: Doc) => string,
): Map<string, Doc[]> {
  const index = new Map<string, Doc[]>();
  for (const doc of docs) {
    addIndex(index, keyFor(doc), doc);
  }
  return index;
}

function auditMatches(
  historical: Doc[],
  timestampField: string,
  matchers: readonly {
    name: string;
    historicalKey: (doc: Doc) => string;
    productionIndex: Map<string, Doc[]>;
  }[],
): MatchAudit {
  const result: MatchAudit = {
    total: historical.length,
    unique_matches: 0,
    ambiguous_matches: 0,
    unmatched: 0,
    matched_by: {},
    by_window: {},
  };

  for (const doc of historical) {
    const window = dateWindow(doc[timestampField]);
    const windowResult = (result.by_window[window] ??= {
      total: 0,
      unique_matches: 0,
      ambiguous_matches: 0,
      unmatched: 0,
    });
    windowResult.total++;

    let candidates: Doc[] = [];
    let matchedBy = "";
    for (const matcher of matchers) {
      const key = matcher.historicalKey(doc);
      if (!key) {
        continue;
      }
      const found = matcher.productionIndex.get(key) ?? [];
      if (found.length > 0) {
        candidates = found;
        matchedBy = matcher.name;
        break;
      }
    }

    if (candidates.length === 1) {
      result.unique_matches++;
      windowResult.unique_matches++;
      result.matched_by[matchedBy] = (result.matched_by[matchedBy] ?? 0) + 1;
    } else if (candidates.length > 1) {
      result.ambiguous_matches++;
      windowResult.ambiguous_matches++;
      const key = `${matchedBy}:ambiguous`;
      result.matched_by[key] = (result.matched_by[key] ?? 0) + 1;
    } else {
      result.unmatched++;
      windowResult.unmatched++;
    }
  }

  return result;
}

function brokenReferenceCount(
  docs: Doc[],
  field: string,
  validIds: Set<string>,
): { populated: number; missing_target: number } {
  let present = 0;
  let missing = 0;
  for (const doc of docs) {
    const id = objectIdString(doc[field]);
    if (!id) {
      continue;
    }
    present++;
    if (!validIds.has(id)) {
      missing++;
    }
  }
  return { populated: present, missing_target: missing };
}

function idSet(docs: Doc[]): Set<string> {
  return new Set(
    docs
      .map((doc) => objectIdString(doc._id))
      .filter((id): id is string => Boolean(id)),
  );
}

function allocationAgentReferences(
  bookings: Doc[],
  agentIds: Set<string>,
): { allocations: number; missing_target: number; bookings_without_allocations: number } {
  let allocations = 0;
  let missing = 0;
  let bookingsWithoutAllocations = 0;
  for (const booking of bookings) {
    const values = Array.isArray(booking.agent_allocations)
      ? booking.agent_allocations
      : [];
    if (values.length === 0) {
      bookingsWithoutAllocations++;
    }
    for (const value of values) {
      if (!value || typeof value !== "object" || !("agent" in value)) {
        missing++;
        allocations++;
        continue;
      }
      allocations++;
      const id = objectIdString(value.agent);
      if (!id || !agentIds.has(id)) {
        missing++;
      }
    }
  }
  return {
    allocations,
    missing_target: missing,
    bookings_without_allocations: bookingsWithoutAllocations,
  };
}

function relationshipAudit(collections: Record<string, Doc[]>) {
  const formIds = idSet(collections.form_leads);
  const callIds = idSet(collections.call_leads);
  const bookingIds = idSet(collections.booked_leads);
  const cancellationIds = idSet(collections.cancelled_leads);
  const customerIds = idSet(collections.customers);
  const agentIds = idSet(collections.agents);

  let bookingLeadRefs = 0;
  let bookingMissingLeadTargets = 0;
  for (const booking of collections.booked_leads) {
    const leadId = objectIdString(booking.lead_ref);
    if (!leadId) {
      continue;
    }
    bookingLeadRefs++;
    const model = stringValue(booking.lead_model);
    const valid =
      model === "FormLead"
        ? formIds.has(leadId)
        : model === "CallLead"
          ? callIds.has(leadId)
          : false;
    if (!valid) {
      bookingMissingLeadTargets++;
    }
  }

  return {
    bookings: {
      lead_ref: {
        populated: bookingLeadRefs,
        missing_or_wrong_model_target: bookingMissingLeadTargets,
      },
      customer: brokenReferenceCount(
        collections.booked_leads,
        "customer",
        customerIds,
      ),
      cancelled: brokenReferenceCount(
        collections.booked_leads,
        "cancelled",
        cancellationIds,
      ),
      agent_allocations: allocationAgentReferences(
        collections.booked_leads,
        agentIds,
      ),
    },
    cancellations: {
      booked_lead: brokenReferenceCount(
        collections.cancelled_leads,
        "booked_lead",
        bookingIds,
      ),
      customer: brokenReferenceCount(
        collections.cancelled_leads,
        "customer",
        customerIds,
      ),
    },
    form_leads: {
      booked: brokenReferenceCount(
        collections.form_leads,
        "booked",
        bookingIds,
      ),
      cancelled: brokenReferenceCount(
        collections.form_leads,
        "cancelled",
        cancellationIds,
      ),
      receiver_agent: brokenReferenceCount(
        collections.form_leads,
        "receiver_agent",
        agentIds,
      ),
    },
    call_leads: {
      booked: brokenReferenceCount(
        collections.call_leads,
        "booked",
        bookingIds,
      ),
      cancelled: brokenReferenceCount(
        collections.call_leads,
        "cancelled",
        cancellationIds,
      ),
      receiver_agent: brokenReferenceCount(
        collections.call_leads,
        "receiver_agent",
        agentIds,
      ),
    },
  };
}

function allocationNames(bookings: Doc[]): string[] {
  const names: string[] = [];
  for (const booking of bookings) {
    if (!Array.isArray(booking.agent_allocations)) {
      continue;
    }
    for (const allocation of booking.agent_allocations) {
      if (
        allocation &&
        typeof allocation === "object" &&
        "agent_name_snapshot" in allocation
      ) {
        const name = stringValue(allocation.agent_name_snapshot);
        if (name) {
          names.push(name);
        }
      }
    }
  }
  return names;
}

function normalizedCatalogNames(docs: Doc[]): Set<string> {
  const values = new Set<string>();
  for (const doc of docs) {
    const name =
      normalizeComparisonName(stringValue(doc.normalized_name)) ??
      normalizeComparisonName(stringValue(doc.name));
    if (name) {
      values.add(name);
    }
    if (Array.isArray(doc.name_aliases)) {
      for (const alias of doc.name_aliases) {
        const normalized = normalizeComparisonName(stringValue(alias));
        if (normalized) {
          values.add(normalized);
        }
      }
    }
  }
  return values;
}

function catalogAudit(
  historical: Record<string, Doc[]>,
  production: Record<string, Doc[]>,
) {
  const productionAgentNames = normalizedCatalogNames(production.agents);
  const historicalAgentLabels = new Set([
    ...historical.agents.map((agent) => stringValue(agent.name)),
    ...allocationNames(historical.booked_leads),
  ]);
  const missingAgents = [...historicalAgentLabels]
    .filter(Boolean)
    .filter((name) => {
      const normalized = normalizeComparisonName(name);
      return normalized ? !productionAgentNames.has(normalized) : false;
    })
    .sort();

  const productionMerchantNames = normalizedCatalogNames(production.merchants);
  const merchantCounts = new Map<string, number>();
  for (const booking of historical.booked_leads) {
    const raw = stringValue(booking.merchant);
    if (!raw) {
      continue;
    }
    const mapped = raw.toLowerCase() === "elavon cc" ? "Elavon" : raw;
    merchantCounts.set(mapped, (merchantCounts.get(mapped) ?? 0) + 1);
  }
  const merchants = [...merchantCounts.entries()]
    .map(([name, count]) => {
      const normalized = normalizeComparisonName(name) ?? name.toLowerCase();
      return {
        name,
        count,
        exists_in_production: productionMerchantNames.has(normalized),
      };
    })
    .sort((left, right) => right.count - left.count);

  const sourceCounts = new Map<string, number>();
  for (const booking of historical.booked_leads) {
    const raw = stringValue(booking.source);
    if (raw) {
      sourceCounts.set(raw, (sourceCounts.get(raw) ?? 0) + 1);
    }
  }
  const bookingSources = [...sourceCounts.entries()]
    .map(([label, count]) => ({
      label,
      count,
      resolved_company: resolveSourceCompany(label) ?? null,
    }))
    .sort((left, right) => right.count - left.count);

  return {
    agents: {
      historical_distinct_labels: historicalAgentLabels.size,
      missing_in_production: missingAgents,
      creation_policy: "create inactive",
    },
    merchants: {
      historical_mapped_values: merchants,
      alias_policy: { "Elavon CC": "Elavon" },
      creation_policy: "create inactive",
    },
    booking_sources: bookingSources,
  };
}

async function loadCoreCollections(db: mongo.Db) {
  const names = [
    "form_leads",
    "call_leads",
    "booked_leads",
    "cancelled_leads",
    "customers",
    "agents",
    "merchants",
    "lead_source_companies",
    "lead_source_granularities",
  ] as const;
  const entries = await Promise.all(
    names.map(async (name) => [name, await loadCollection(db, name)] as const),
  );
  return Object.fromEntries(entries) as Record<(typeof names)[number], Doc[]>;
}

function collectionAudit(
  collections: Record<string, Doc[]>,
  collection: keyof typeof COLLECTION_FIELDS,
  dateField?: string,
) {
  const docs = collections[collection] ?? [];
  return {
    count: docs.length,
    date: dateField ? dateSummary(docs, dateField) : undefined,
    field_coverage: fieldCoverage(docs, COLLECTION_FIELDS[collection]),
  };
}

function markdownReport(report: {
  generated_at: string;
  production: Record<string, ReturnType<typeof collectionAudit>>;
  historical: Record<string, ReturnType<typeof collectionAudit>>;
  overlap: Record<string, MatchAudit>;
  historical_relationships: ReturnType<typeof relationshipAudit>;
  catalogs: ReturnType<typeof catalogAudit>;
}): string {
  const lines = [
    "# Historical consolidation database audit",
    "",
    `Generated: ${report.generated_at}`,
    "",
    "Read-only aggregate audit of `vantagemovers` and `vantagemovershistorical`.",
    "",
    "## Collection counts",
    "",
    "| Collection | Production | Historical |",
    "|---|---:|---:|",
  ];
  for (const collection of Object.keys(COLLECTION_FIELDS)) {
    lines.push(
      `| ${collection} | ${report.production[collection]?.count ?? 0} | ${report.historical[collection]?.count ?? 0} |`,
    );
  }

  lines.push(
    "",
    "## Historical-to-production identity overlap",
    "",
    "| Entity | Historical | Unique overlap | Ambiguous | Unmatched |",
    "|---|---:|---:|---:|---:|",
  );
  for (const [entity, audit] of Object.entries(report.overlap)) {
    lines.push(
      `| ${entity} | ${audit.total} | ${audit.unique_matches} | ${audit.ambiguous_matches} | ${audit.unmatched} |`,
    );
  }

  const historicalBookings =
    report.historical_relationships.bookings as Record<string, unknown>;
  const leadRef = historicalBookings.lead_ref as {
    populated: number;
    missing_or_wrong_model_target: number;
  };
  const allocations = historicalBookings.agent_allocations as {
    bookings_without_allocations: number;
    missing_target: number;
  };
  lines.push(
    "",
    "## Immediate migration gates",
    "",
    `- Historical bookings with a lead link: ${leadRef.populated}; broken/wrong-model targets: ${leadRef.missing_or_wrong_model_target}.`,
    `- Historical bookings without agent allocations: ${allocations.bookings_without_allocations}; allocation refs missing an Agent target: ${allocations.missing_target}.`,
    `- Historical agent labels missing from production: ${report.catalogs.agents.missing_in_production.length}; policy is to create them inactive.`,
    "- `Elavon CC` is normalized to the existing `Elavon` merchant before lookup or creation.",
    "",
    "The JSON twin contains field coverage, date windows, match-method counts, relationship integrity, merchant/source inventories, and catalog gaps.",
    "",
  );
  return lines.join("\n");
}

async function main(): Promise<void> {
  await connectMongo();
  const productionDb = getDb(
    mongoose.connection.useDb(PRODUCTION_DB, { useCache: true }),
  );
  const historicalDb = getDb(
    mongoose.connection.useDb(HISTORICAL_DB, { useCache: true }),
  );
  const [production, historical] = await Promise.all([
    loadCoreCollections(productionDb),
    loadCoreCollections(historicalDb),
  ]);

  const productionFormByLid = buildIndex(
    production.form_leads,
    normalizedLid,
  );
  const productionFormByRef = buildIndex(
    production.form_leads,
    normalizedReference,
  );
  const productionFormByPhoneMinute = buildIndex(
    production.form_leads,
    (doc) => {
      const phone = normalizedPhone(doc);
      const minute = minuteKey(doc.timestamp);
      return phone && minute
        ? `${normalizedSource(doc.source_company)}|${phone}|${minute}`
        : "";
    },
  );
  const productionCallByJob = buildIndex(
    production.call_leads,
    normalizedJob,
  );
  const productionCallByPhoneMinute = buildIndex(
    production.call_leads,
    (doc) => {
      const phone = normalizedPhone(doc);
      const minute = minuteKey(doc.timestamp);
      return phone && minute
        ? `${normalizedSource(doc.source_company)}|${phone}|${minute}`
        : "";
    },
  );
  const productionCallByPhoneDay = buildIndex(
    production.call_leads,
    (doc) => {
      const phone = normalizedPhone(doc);
      const day = dayKey(doc.timestamp);
      return phone && day
        ? `${normalizedSource(doc.source_company)}|${phone}|${day}`
        : "";
    },
  );
  const productionCallByPhone = buildIndex(
    production.call_leads,
    (doc) => {
      const phone = normalizedPhone(doc);
      return phone
        ? `${normalizedSource(doc.source_company)}|${phone}`
        : "";
    },
  );
  const productionBookingByJob = buildIndex(
    production.booked_leads,
    normalizedJob,
  );
  const productionCancellationByJob = buildIndex(
    production.cancelled_leads,
    normalizedJob,
  );

  const overlap = {
    form_leads: auditMatches(historical.form_leads, "timestamp", [
      {
        name: "lid_exact",
        historicalKey: normalizedLid,
        productionIndex: productionFormByLid,
      },
      {
        name: "ref_no_exact",
        historicalKey: normalizedReference,
        productionIndex: productionFormByRef,
      },
      {
        name: "source_phone_timestamp_minute",
        historicalKey: (doc) => {
          const phone = normalizedPhone(doc);
          const minute = minuteKey(doc.timestamp);
          return phone && minute
            ? `${normalizedSource(doc.source_company)}|${phone}|${minute}`
            : "";
        },
        productionIndex: productionFormByPhoneMinute,
      },
    ]),
    call_leads: auditMatches(historical.call_leads, "timestamp", [
      {
        name: "job_no_exact",
        historicalKey: normalizedJob,
        productionIndex: productionCallByJob,
      },
      {
        name: "source_phone_timestamp_minute",
        historicalKey: (doc) => {
          const phone = normalizedPhone(doc);
          const minute = minuteKey(doc.timestamp);
          return phone && minute
            ? `${normalizedSource(doc.source_company)}|${phone}|${minute}`
            : "";
        },
        productionIndex: productionCallByPhoneMinute,
      },
      {
        name: "source_phone_utc_day",
        historicalKey: (doc) => {
          const phone = normalizedPhone(doc);
          const day = dayKey(doc.timestamp);
          return phone && day
            ? `${normalizedSource(doc.source_company)}|${phone}|${day}`
            : "";
        },
        productionIndex: productionCallByPhoneDay,
      },
      {
        name: "source_phone_only",
        historicalKey: (doc) => {
          const phone = normalizedPhone(doc);
          return phone
            ? `${normalizedSource(doc.source_company)}|${phone}`
            : "";
        },
        productionIndex: productionCallByPhone,
      },
    ]),
    booked_leads: auditMatches(historical.booked_leads, "book_date", [
      {
        name: "job_no_exact",
        historicalKey: normalizedJob,
        productionIndex: productionBookingByJob,
      },
    ]),
    cancelled_leads: auditMatches(
      historical.cancelled_leads,
      "cancel_date",
      [
        {
          name: "job_no_exact",
          historicalKey: normalizedJob,
          productionIndex: productionCancellationByJob,
        },
      ],
    ),
  };

  const productionAudit = {
    form_leads: collectionAudit(production, "form_leads", "timestamp"),
    call_leads: collectionAudit(production, "call_leads", "timestamp"),
    booked_leads: collectionAudit(production, "booked_leads", "book_date"),
    cancelled_leads: collectionAudit(
      production,
      "cancelled_leads",
      "cancel_date",
    ),
    customers: collectionAudit(production, "customers"),
    agents: collectionAudit(production, "agents"),
  };
  const historicalAudit = {
    form_leads: {
      ...collectionAudit(historical, "form_leads", "timestamp"),
      duplicate_identities: {
        lid: duplicateSummary(historical.form_leads.map(normalizedLid)),
        ref_no: duplicateSummary(
          historical.form_leads.map(normalizedReference),
        ),
      },
    },
    call_leads: {
      ...collectionAudit(historical, "call_leads", "timestamp"),
      duplicate_identities: {
        job_no: duplicateSummary(historical.call_leads.map(normalizedJob)),
      },
    },
    booked_leads: {
      ...collectionAudit(historical, "booked_leads", "book_date"),
      duplicate_identities: {
        job_no: duplicateSummary(historical.booked_leads.map(normalizedJob)),
      },
    },
    cancelled_leads: {
      ...collectionAudit(historical, "cancelled_leads", "cancel_date"),
      duplicate_identities: {
        job_no: duplicateSummary(
          historical.cancelled_leads.map(normalizedJob),
        ),
      },
    },
    customers: collectionAudit(historical, "customers"),
    agents: collectionAudit(historical, "agents"),
  };

  const generatedAt = new Date().toISOString();
  const report = {
    generated_at: generatedAt,
    mode: "read-only",
    pii_policy: "aggregate-only; staff/catalog labels only",
    databases: {
      production: PRODUCTION_DB,
      historical: HISTORICAL_DB,
    },
    windows: {
      overlap_start_inclusive: OVERLAP_START.toISOString(),
      overlap_end_exclusive: OVERLAP_END.toISOString(),
    },
    production: productionAudit,
    historical: historicalAudit,
    overlap,
    production_relationships: relationshipAudit(production),
    historical_relationships: relationshipAudit(historical),
    catalogs: catalogAudit(historical, production),
    source_company_counts: {
      historical_form_leads: duplicateSummary(
        historical.form_leads.map((doc) => stringValue(doc.source_company)),
      ),
      historical_call_leads: duplicateSummary(
        historical.call_leads.map((doc) => stringValue(doc.source_company)),
      ),
    },
    historical_provenance_counts: {
      form_leads: groupedCounts(historical.form_leads, [
        "source_company",
        "source_workbook",
        "source_tab",
      ]),
      call_leads: groupedCounts(historical.call_leads, [
        "source_company",
        "source_workbook",
        "source_tab",
      ]),
      booked_leads: groupedCounts(historical.booked_leads, [
        "source_workbook",
        "source_tab",
      ]),
      cancelled_leads: groupedCounts(historical.cancelled_leads, [
        "source_workbook",
        "source_tab",
      ]),
    },
    historical_date_anomalies: {
      form_leads: dateAnomalies(historical.form_leads, "timestamp"),
      call_leads: dateAnomalies(historical.call_leads, "timestamp"),
      booked_leads: dateAnomalies(historical.booked_leads, "book_date"),
      cancelled_leads: dateAnomalies(
        historical.cancelled_leads,
        "cancel_date",
      ),
    },
  };

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const jsonPath = path.join(OUTPUT_DIR, "database-audit.json");
  const markdownPath = path.join(OUTPUT_DIR, "database-audit.md");
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(
    markdownPath,
    markdownReport({
      generated_at: generatedAt,
      production: productionAudit,
      historical: historicalAudit,
      overlap,
      historical_relationships: report.historical_relationships,
      catalogs: report.catalogs,
    }),
  );
  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${markdownPath}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
