import { createHash } from "node:crypto";
import mongoose, { type ClientSession, type PipelineStage } from "mongoose";
import { BookedLead } from "../../../models/BookedLead";
import { BookingLeadReconciliationCase } from "../../../models/BookingLeadReconciliationCase";
import { getCallLeadModel } from "../../../models/CallLead";
import { CancelledLead } from "../../../models/CancelledLead";
import { getFormLeadModel } from "../../../models/FormLead";
import { IngestionConflict } from "../../../models/IngestionConflict";
import { toObjectId } from "../../../utils/objectId";
import { canonicalJson, computeChecksum } from "../../durableWork";
import {
  EXCEPTION_TYPES,
  reportingError,
  type ReportingCandidateManifestEntryV1,
  type ReportingCandidateManifestV1,
  type QueryPage,
  type ValidatedReportingRequest,
} from "../catalog";
import { registryMongoPredicate } from "../registryFilters";
import { displayInstant, halfOpenDatePredicate } from "../timezone";
import {
  compareSortTuple,
  compareTuple,
  encodeCursor,
  paginateRows,
} from "./pagination";
import {
  REPORTING_MAX_COHORT_ROWS,
  REPORTING_MAX_MANIFEST_ENTRIES,
  REPORTING_MAX_PAGE_SIZE,
  REPORTING_MAX_RELATED_ROWS,
  REPORTING_QUERY_MAX_TIME_MS,
} from "../../../config/domain/reporting";
import { getReportingSnapshotAdapter } from "../snapshotAdapter";

type Row = Record<string, unknown>;
type Lead = Row & { _id: unknown; timestamp: Date; leadType: "form" | "call" };
type Booking = Row & { _id: unknown; lead_ref?: unknown; lead_model?: string; book_date: Date };
type Cancellation = Row & { _id: unknown; booked_lead: unknown; cancel_date: Date };

const LEAD_REPORTING_PROJECTION = {
  _id: 1, timestamp: 1, createdAt: 1, updatedAt: 1,
  lead_source_company: 1, source_granularity_key: 1,
  source_company: 1, source_company_label_snapshot: 1,
  source_granularity_label_snapshot: 1,
  name: 1, phone_number: 1, email: 1,
  pickup_zip: 1, pickup_state: 1, destination_zip: 1, delivery_zip: 1,
  delivery_state: 1, local: 1, move_date: 1, move_size: 1,
  quoted: 1, duplicate: 1, bad_lead: 1, cpl: 1,
  cpl_resolution_status: 1,
} as const;

const BOOKING_REPORTING_PROJECTION = {
  _id: 1, lead_ref: 1, lead_model: 1, timestamp: 1, book_date: 1,
  createdAt: 1, updatedAt: 1, job_no: 1, agent_allocations: 1,
  merchant: 1, total_binder_amount: 1, deposit_amount: 1,
  employee_source_snapshot: 1,
} as const;

const CANCELLATION_REPORTING_PROJECTION = {
  _id: 1, booked_lead: 1, timestamp: 1, cancel_date: 1,
  refund_amount: 1, createdAt: 1, updatedAt: 1,
  lead_ref: 1, lead_model: 1,
} as const;

export async function executeReportingQuery(input: ValidatedReportingRequest): Promise<Row[]> {
  const rows = await executeReportingQueryInternal(input);
  return projectRows(rows, input.selectedColumns.map((column) => column.id));
}

async function executeReportingQueryInternal(input: ValidatedReportingRequest): Promise<Row[]> {
  const cohort = await loadCanonicalLeadCohort(input);
  const bookingData = await loadRelatedOutcomes(cohort, input.sourceReadThrough);
  let rows: Row[];
  if (input.datasetKey === "lead_outcome_detail") {
    rows = detailRows(cohort, bookingData, input);
  } else if (input.datasetKey === "source_performance") {
    rows = performanceRows(cohort, bookingData, input);
  } else {
    rows = await exceptionRows(cohort, bookingData, input);
  }
  return rows.sort((a, b) =>
    compareSortTuple(
      input.effectiveSort.map((term) => a[term.id]),
      input.effectiveSort.map((term) => b[term.id]),
      input.effectiveSort,
    ),
  );
}

export async function estimateReportingQuery(input: ValidatedReportingRequest) {
  const cohortRows = await countCanonicalCohort(input);
  if (input.datasetKey === "lead_outcome_detail") {
    const hasOutcomeFilters = [
      "agentKeys",
      "merchantKeys",
      "route",
      "bookingStatus",
      "cancellationStatus",
    ].some((key) => input.filters[key] !== undefined);
    return deriveReportingEstimate({
      datasetKey: input.datasetKey,
      cohortRows,
      hasOutcomeFilters,
      orphanUpper: 0,
    });
  }
  const orphanUpper =
    input.datasetKey === "lead_quality_exceptions"
      ? await countExceptionOrphanUpperBound(input)
      : 0;
  return deriveReportingEstimate({
    datasetKey: input.datasetKey,
    cohortRows,
    hasOutcomeFilters: false,
    orphanUpper,
  });
}

export function deriveReportingEstimate(input: {
  datasetKey: ValidatedReportingRequest["datasetKey"];
  cohortRows: number;
  hasOutcomeFilters: boolean;
  orphanUpper: number;
}) {
  if (
    !Number.isSafeInteger(input.cohortRows) ||
    input.cohortRows < 0 ||
    !Number.isSafeInteger(input.orphanUpper) ||
    input.orphanUpper < 0
  ) {
    throw new TypeError("Invalid reporting estimate inputs.");
  }
  if (input.datasetKey === "lead_outcome_detail") {
    return input.hasOutcomeFilters
      ? {
          kind: "upper_bound" as const,
          rows: input.cohortRows,
          explanation:
            "Cohort count is a safe upper bound before outcome filters.",
        }
      : { kind: "exact" as const, rows: input.cohortRows };
  }
  if (input.datasetKey === "source_performance") {
    return input.cohortRows === 0
      ? { kind: "exact" as const, rows: 0 }
      : {
          kind: "upper_bound" as const,
          rows: input.cohortRows,
          explanation:
            "Each output group contains at least one cohort lead; cohort count bounds all time/source groups.",
        };
  }
  return {
    kind: "upper_bound" as const,
    rows: input.cohortRows * 4 + input.orphanUpper,
    explanation:
      "At most four lead exceptions per cohort lead plus independently counted orphan exception branches.",
  };
}

export async function previewReportingQuery(
  input: ValidatedReportingRequest,
  limit = 50,
) {
  const rows = await executeReportingQueryInternal(input);
  const estimate = await estimateReportingQuery(input);
  const sampled = representativeSampleRows(input.datasetKey, rows, limit);
  return {
    estimate,
    sample: projectRows(sampled, input.selectedColumns.map((column) => column.id)),
  };
}

async function countCanonicalCohort(
  input: ValidatedReportingRequest,
): Promise<number> {
  const baseFilter = {
    timestamp: halfOpenDatePredicate(input.resolvedWindow),
    ...registryMongoPredicate(input.registry),
    ...(input.sourceReadThrough
      ? { createdAt: { $lte: new Date(input.sourceReadThrough) } }
      : {}),
  };
  const leadType = input.filters.leadType;
  const [forms, calls] = await Promise.all([
    leadType === "call"
      ? 0
      : getFormLeadModel()
          .countDocuments(baseFilter)
          .maxTimeMS(REPORTING_QUERY_MAX_TIME_MS)
          .exec(),
    leadType === "form"
      ? 0
      : getCallLeadModel()
          .countDocuments(baseFilter)
          .maxTimeMS(REPORTING_QUERY_MAX_TIME_MS)
          .exec(),
  ]);
  return forms + calls;
}

async function countExceptionOrphanUpperBound(
  input: ValidatedReportingRequest,
): Promise<number> {
  const window = halfOpenDatePredicate(input.resolvedWindow);
  const createdFence = input.sourceReadThrough
    ? { createdAt: { $lte: new Date(input.sourceReadThrough) } }
    : {};
  const counts = await Promise.all([
    BookedLead.countDocuments({
      is_leadless_booking: true,
      timestamp: window,
      ...registryHierarchyPredicate(input.registry, {
        companyPath: "employee_source_snapshot.lead_source_company",
        granularityPath: "employee_source_snapshot.source_granularity_key",
        companyValue: "id",
      }),
      ...createdFence,
    }).maxTimeMS(REPORTING_QUERY_MAX_TIME_MS),
    BookingLeadReconciliationCase.countDocuments({
      status: "pending",
      createdAt: {
        ...window,
        ...(input.sourceReadThrough
          ? { $lte: new Date(input.sourceReadThrough) }
          : {}),
      },
      ...registryHierarchyPredicate(input.registry, {
        companyPath: "submission.source_assignment.lead_source_company",
        granularityPath: "submission.source_assignment.source_granularity_key",
        companyValue: "id",
      }),
    }).maxTimeMS(REPORTING_QUERY_MAX_TIME_MS),
    IngestionConflict.countDocuments({
      status: "open",
      type: "canonical_divergence",
      createdAt: {
        ...window,
        ...(input.sourceReadThrough
          ? { $lte: new Date(input.sourceReadThrough) }
          : {}),
      },
      ...registryHierarchyPredicate(input.registry, {
        companyPath: "source_company_key",
        granularityPath: "source_granularity_key",
        companyValue: "key",
      }),
    }).maxTimeMS(REPORTING_QUERY_MAX_TIME_MS),
    CancelledLead.countDocuments({
      $or: [{ lead_ref: null }, { lead_ref: { $exists: false } }],
      timestamp: window,
      ...createdFence,
    }).maxTimeMS(REPORTING_QUERY_MAX_TIME_MS),
  ]);
  return counts.reduce((sum, count) => sum + count, 0);
}

export async function sampleReportingQuery(input: ValidatedReportingRequest, limit = 50) {
  const rows = await executeReportingQueryInternal(input);
  return projectRows(
    representativeSampleRows(input.datasetKey, rows, limit),
    input.selectedColumns.map((column) => column.id),
  );
}

export function representativeSampleRows(
  datasetKey: ValidatedReportingRequest["datasetKey"],
  rows: Row[],
  limit: number,
): Row[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new RangeError("Reporting sample limit must be between 1 and 50.");
  }
  if (rows.length <= limit) return rows;
  const selected = new Map<number, Row>();
  const add = (index: number) => {
    if (selected.size < limit && rows[index]) selected.set(index, rows[index]!);
  };
  add(0);
  add(rows.length - 1);
  const categoryFields =
    datasetKey === "lead_outcome_detail"
      ? ["lead_type", "booked", "cancelled_or_refunded"]
      : datasetKey === "lead_quality_exceptions"
        ? ["exception_type"]
        : ["period", "_source_company_id", "_source_granularity_key"];
  for (const field of categoryFields) {
    const seen = new Set<string>();
    for (let index = 0; index < rows.length && selected.size < limit; index += 1) {
      const category = canonicalJson(rows[index]?.[field] ?? null);
      if (!seen.has(category)) {
        seen.add(category);
        add(index);
      }
    }
  }
  for (let index = 0; index < limit && selected.size < limit; index += 1) {
    const position = Math.round((index * (rows.length - 1)) / (limit - 1));
    add(position);
  }
  return [...selected.entries()].sort(([a], [b]) => a - b).map(([, row]) => row);
}

export async function queryReportingPage(
  input: ValidatedReportingRequest,
  pageSize: number,
  after?: string,
): Promise<QueryPage> {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > REPORTING_MAX_PAGE_SIZE) {
    throw new RangeError(`Reporting page size must be between 1 and ${REPORTING_MAX_PAGE_SIZE}.`);
  }
  const rows = await executeReportingQueryInternal(input);
  const page = paginateRows(rows, input.effectiveSort, pageSize, after);
  const projected = projectRows(page.rows, input.selectedColumns.map((column) => column.id));
  return {
    ...page,
    rows: projected,
    canonicalPageChecksum: computeChecksum({
      checksum_version: 1,
      artifact_kind: "reporting_page",
      schema_version: 1,
      payload: projected,
    }),
  };
}

export async function openReportingPageReader(
  input: ValidatedReportingRequest,
): Promise<(pageSize: number, after?: string) => Promise<QueryPage>> {
  const rows = await executeReportingQueryInternal(input);
  return async (pageSize, after) => {
    if (
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > REPORTING_MAX_PAGE_SIZE
    ) {
      throw new RangeError(
        `Reporting page size must be between 1 and ${REPORTING_MAX_PAGE_SIZE}.`,
      );
    }
    const page = paginateRows(rows, input.effectiveSort, pageSize, after);
    const projected = projectRows(
      page.rows,
      input.selectedColumns.map((column) => column.id),
    );
    return {
      ...page,
      rows: projected,
      canonicalPageChecksum: computeChecksum({
        checksum_version: 1,
        artifact_kind: "reporting_page",
        schema_version: 1,
        payload: projected,
      }),
    };
  };
}

async function loadCanonicalLeadCohort(
  input: ValidatedReportingRequest,
  session?: ClientSession,
): Promise<Lead[]> {
  const baseFilter = {
    timestamp: halfOpenDatePredicate(input.resolvedWindow),
    ...registryMongoPredicate(input.registry),
    ...(input.sourceReadThrough ? { createdAt: { $lte: new Date(input.sourceReadThrough) } } : {}),
  };
  const leadType = input.filters.leadType;
  const [forms, calls] = await Promise.all([
    leadType === "call" ? [] : getFormLeadModel().find(baseFilter).session(session ?? null).select(LEAD_REPORTING_PROJECTION).limit(REPORTING_MAX_COHORT_ROWS + 1).maxTimeMS(REPORTING_QUERY_MAX_TIME_MS).lean().exec(),
    leadType === "form" ? [] : getCallLeadModel().find(baseFilter).session(session ?? null).select(LEAD_REPORTING_PROJECTION).limit(REPORTING_MAX_COHORT_ROWS + 1).maxTimeMS(REPORTING_QUERY_MAX_TIME_MS).lean().exec(),
  ]);
  const normalized = [
    ...forms.map((lead) => ({ ...(lead as unknown as Row), leadType: "form" as const }) as Lead),
    ...calls.map((lead) => ({ ...(lead as unknown as Row), leadType: "call" as const }) as Lead),
  ];
  assertWithinQueryBudget(normalized.length, REPORTING_MAX_COHORT_ROWS, "cohort");
  assertSourceFence(normalized, input.sourceReadThrough);
  return normalized.sort((a, b) => compareTuple(
    [a.timestamp.toISOString(), a.leadType, String(a._id)],
    [b.timestamp.toISOString(), b.leadType, String(b._id)],
  ));
}

async function loadRelatedOutcomes(
  leads: Lead[],
  sourceReadThrough?: string,
  session?: ClientSession,
) {
  const leadIds = leads.map((lead) => lead._id);
  const readFence = sourceReadThrough ? { createdAt: { $lte: new Date(sourceReadThrough) } } : {};
  const bookings = await BookedLead.find({ lead_ref: { $in: leadIds }, ...readFence } as any)
    .session(session ?? null)
    .select(BOOKING_REPORTING_PROJECTION)
    .limit(REPORTING_MAX_RELATED_ROWS + 1)
    .maxTimeMS(REPORTING_QUERY_MAX_TIME_MS)
    .lean().exec() as unknown as Booking[];
  assertWithinQueryBudget(bookings.length, REPORTING_MAX_RELATED_ROWS, "related bookings");
  const remainingRelatedBudget = REPORTING_MAX_RELATED_ROWS - bookings.length;
  const cancellations = await CancelledLead.find({
    booked_lead: { $in: bookings.map((booking) => booking._id) },
    ...readFence,
  } as any)
    .session(session ?? null)
    .select(CANCELLATION_REPORTING_PROJECTION)
    .limit(remainingRelatedBudget + 1)
    .maxTimeMS(REPORTING_QUERY_MAX_TIME_MS)
    .lean().exec() as unknown as Cancellation[];
  assertGlobalMaterializationBudget(
    [
      { label: "related bookings", count: bookings.length },
      { label: "related cancellations", count: cancellations.length },
    ],
    REPORTING_MAX_RELATED_ROWS,
  );
  assertSourceFence(bookings, sourceReadThrough);
  assertSourceFence(cancellations, sourceReadThrough);
  const byLead = groupBy(bookings, (booking) => String(booking.lead_ref));
  const cancellationByBooking = groupBy(cancellations, (cancellation) => String(cancellation.booked_lead));
  return { bookings, cancellations, byLead, cancellationByBooking };
}

function detailRows(
  leads: Lead[],
  outcomes: Awaited<ReturnType<typeof loadRelatedOutcomes>>,
  input: ValidatedReportingRequest,
): Row[] {
  const rows = leads.map((lead) => {
    const bookings = outcomes.byLead.get(String(lead._id)) ?? [];
    const primary = choosePrimaryBooking(bookings, outcomes.cancellationByBooking);
    const cancellations = bookings.flatMap((booking) => outcomes.cancellationByBooking.get(String(booking._id)) ?? []);
    const primaryCancellation = primary
      ? (outcomes.cancellationByBooking.get(String(primary._id)) ?? []).sort(byCancellationDateDesc)[0]
      : undefined;
    return {
      _dependencyKeys: [
        `${lead.leadType === "form" ? "FormLead" : "CallLead"}:${String(lead._id)}`,
        ...bookings.map((booking) => `BookedLead:${String(booking._id)}`),
        ...cancellations.map(
          (cancellation) => `CancelledLead:${String(cancellation._id)}`,
        ),
      ],
      lead_id: String(lead._id),
      lead_type: lead.leadType,
      lead_timestamp: displayInstant(lead.timestamp, input.resolvedWindow.timezone),
      source_company: lead.source_company_label_snapshot ?? lead.source_company ?? null,
      source_granularity: lead.source_granularity_label_snapshot ?? lead.source_granularity_key ?? null,
      customer_name: lead.name ?? null,
      customer_phone: lead.phone_number ?? null,
      customer_email: lead.email ?? null,
      pickup_zip: lead.pickup_zip ?? null,
      pickup_state: lead.pickup_state ?? null,
      delivery_zip: lead.destination_zip ?? lead.delivery_zip ?? null,
      delivery_state: lead.delivery_state ?? null,
      route_classification: lead.local === true || lead.local === "local" ? "local" : lead.local === false || lead.local === "long_distance" ? "long_distance" : null,
      move_date: dateOnly(lead.move_date, input.resolvedWindow.timezone),
      move_size: lead.move_size ?? null,
      quoted: lead.leadType === "call" ? "not_applicable" : lead.quoted === true,
      duplicate_state: lead.duplicate === true,
      bad_lead_state: Boolean(lead.bad_lead),
      cpl_value: finiteOrNull(lead.cpl),
      cpl_resolution_status: lead.cpl_resolution_status ?? null,
      booked: bookings.length > 0,
      booking_count: bookings.length,
      primary_job_number: primary?.job_no ?? null,
      book_date: primary ? displayInstant(primary.book_date, input.resolvedWindow.timezone) : null,
      assigned_agents: primary ? agentNames(primary) : null,
      _agentKeys: primary ? agentKeys(primary) : [],
      merchant: primary?.merchant ?? null,
      binder: primary ? finiteOrNull(primary.total_binder_amount) : null,
      deposit: primary ? finiteOrNull(primary.deposit_amount) : null,
      cancelled_or_refunded: cancellations.length > 0,
      cancellation_or_refund_date: primaryCancellation ? displayInstant(primaryCancellation.cancel_date, input.resolvedWindow.timezone) : null,
      refund_amount: primaryCancellation ? finiteOrNull(primaryCancellation.refund_amount) : null,
    };
  });
  return rows.filter((row) => detailFilter(row, input.filters));
}

export function choosePrimaryBooking(
  bookings: Booking[],
  cancellations: Map<string, Cancellation[]>,
): Booking | undefined {
  return [...bookings].sort((a, b) => {
    const activeA = (cancellations.get(String(a._id)) ?? []).length === 0 ? 1 : 0;
    const activeB = (cancellations.get(String(b._id)) ?? []).length === 0 ? 1 : 0;
    return activeB - activeA || b.book_date.getTime() - a.book_date.getTime() || String(a._id).localeCompare(String(b._id));
  })[0];
}

function performanceRows(
  leads: Lead[],
  outcomes: Awaited<ReturnType<typeof loadRelatedOutcomes>>,
  input: ValidatedReportingRequest,
): Row[] {
  const groups = new Map<string, { dimensions: Row; leads: Lead[] }>();
  for (const lead of leads) {
    const identity = sourcePerformanceGroupIdentity(lead, input);
    const { period, companyId, granularityKey } = identity;
    const companySnapshot = input.registry.companies.find(
      (company) => company.id === companyId,
    );
    const granularitySnapshot = input.registry.granularities.find(
      (granularity) =>
        granularity.companyId === companyId &&
        granularity.key === granularityKey,
    );
    const key = identity.key;
    const group = groups.get(key) ?? {
      dimensions: {
        period,
        source_company:
          companySnapshot?.label ??
          lead.source_company_label_snapshot ??
          lead.source_company ??
          null,
        source_granularity: granularityKey
          ? granularitySnapshot?.label ??
            lead.source_granularity_label_snapshot ??
            granularityKey
          : null,
        _source_company_id: companyId,
        _source_granularity_key: granularityKey,
      },
      leads: [],
    };
    group.leads.push(lead);
    groups.set(key, group);
  }
  const rows: Row[] = [...groups.values()].map(({ dimensions, leads: groupedLeads }) => {
    const bookings = groupedLeads.flatMap((lead) => outcomes.byLead.get(String(lead._id)) ?? []);
    const cancellations = bookings.flatMap(
      (booking) =>
        outcomes.cancellationByBooking.get(String(booking._id)) ?? [],
    );
    return {
      ...dimensions,
      _dependencyKeys: [
        ...groupedLeads.map(
          (lead) =>
            `${lead.leadType === "form" ? "FormLead" : "CallLead"}:${String(lead._id)}`,
        ),
        ...bookings.map((booking) => `BookedLead:${String(booking._id)}`),
        ...cancellations.map(
          (cancellation) => `CancelledLead:${String(cancellation._id)}`,
        ),
      ],
      ...aggregateSourcePerformance(
        groupedLeads,
        bookings,
        outcomes.cancellationByBooking,
      ),
    };
  });
  return rows.sort((a, b) => compareTuple(
    [a.period, a.source_company, a.source_granularity],
    [b.period, b.source_company, b.source_granularity],
  ));
}

export function sourcePerformanceGroupIdentity(
  lead: Row & { timestamp: Date },
  input: ValidatedReportingRequest,
) {
  const period = periodFor(
    lead.timestamp,
    String(input.filters.timeDimension ?? "none"),
    input.resolvedWindow.timezone,
  );
  const companyId = String(lead.lead_source_company ?? "");
  const granularityKey =
    input.filters.includeGranularity === true
      ? String(lead.source_granularity_key ?? "")
      : "";
  return {
    key: JSON.stringify([period, companyId, granularityKey]),
    period,
    companyId,
    granularityKey,
  };
}

export function aggregateSourcePerformance(
  leads: Array<Row & { _id: unknown; leadType: "form" | "call" }>,
  bookings: Array<Row & { _id: unknown; lead_ref?: unknown }>,
  cancellationsByBooking: Map<string, unknown[]>,
): Row {
  const bookingsByLead = groupBy(bookings, (booking) => String(booking.lead_ref));
  const cancelled = bookings.filter(
    (booking) => (cancellationsByBooking.get(String(booking._id)) ?? []).length > 0,
  );
  const totalLeads = leads.length;
  const bookedLeads = leads.filter(
    (lead) => (bookingsByLead.get(String(lead._id)) ?? []).length > 0,
  ).length;
  const netBookings = bookings.length - cancelled.length;
  return {
    total_leads: totalLeads,
    valid_leads: leads.filter((lead) => lead.duplicate !== true && !lead.bad_lead).length,
    duplicates: leads.filter((lead) => lead.duplicate === true).length,
    bad_leads: leads.filter((lead) => Boolean(lead.bad_lead)).length,
    quoted_form_leads: leads.filter((lead) => lead.leadType === "form" && lead.quoted === true).length,
    booked_leads: bookedLeads,
    cancelled_bookings: cancelled.length,
    net_bookings: netBookings,
    lead_to_booking_conversion: totalLeads === 0 ? null : bookedLeads / totalLeads,
    net_conversion: totalLeads === 0 ? null : netBookings / totalLeads,
    resolved_cpl_spend: roundMoney(leads.filter((lead) => lead.cpl_resolution_status === "resolved").reduce((sum, lead) => sum + number(lead.cpl), 0)),
    unresolved_cpl_count: leads.filter((lead) =>
      isUnresolvedCplStatus(lead.cpl_resolution_status),
    ).length,
    total_binder: roundMoney(bookings.reduce((sum, booking) => sum + number(booking.total_binder_amount), 0)),
    total_deposit: roundMoney(bookings.reduce((sum, booking) => sum + number(booking.deposit_amount), 0)),
  };
}

async function exceptionRows(
  leads: Lead[],
  outcomes: Awaited<ReturnType<typeof loadRelatedOutcomes>>,
  input: ValidatedReportingRequest,
  session?: ClientSession,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (const lead of leads) {
    const common = exceptionCommon(lead, input);
    if (lead.duplicate === true) rows.push(exception("duplicate", common, "Lead is marked duplicate.", 1));
    if (lead.bad_lead) rows.push(exception("bad_lead", common, "Lead is marked bad.", 1));
    if (isUnresolvedCplStatus(lead.cpl_resolution_status) || !lead.lead_source_company) {
      rows.push(exception("unresolved_cpl_or_source_attribution", common, "CPL or source attribution is unresolved.", 1));
    }
    const bookings = outcomes.byLead.get(String(lead._id)) ?? [];
    if (bookings.length > 1) {
      rows.push(
        exception(
          "multiple_booking_anomaly",
          {
            ...common,
            _dependencyKeys: [
              ...(common._dependencyKeys as string[]),
              ...bookings.map(
                (booking) => `BookedLead:${String(booking._id)}`,
              ),
            ],
          },
          "Lead has multiple related bookings.",
          bookings.length,
        ),
      );
    }
  }
  const fence = input.sourceReadThrough ? { createdAt: { $lte: new Date(input.sourceReadThrough) } } : {};
  const observationWindow = halfOpenDatePredicate(input.resolvedWindow);
  assertGlobalMaterializationBudget(
    [{ label: "lead exceptions", count: rows.length }],
    REPORTING_MAX_RELATED_ROWS,
  );
  let remaining = REPORTING_MAX_RELATED_ROWS - rows.length;
  const leadless = await BookedLead.find({
      is_leadless_booking: true,
      timestamp: observationWindow,
      ...registryHierarchyPredicate(input.registry, {
        companyPath: "employee_source_snapshot.lead_source_company",
        granularityPath: "employee_source_snapshot.source_granularity_key",
        companyValue: "id",
      }),
      ...fence,
    }).session(session ?? null).select({
      _id: 1, timestamp: 1, createdAt: 1, updatedAt: 1, job_no: 1,
      "employee_source_snapshot.source_company_label_snapshot": 1,
      "employee_source_snapshot.source_granularity_label_snapshot": 1,
    }).limit(remaining + 1).maxTimeMS(REPORTING_QUERY_MAX_TIME_MS).lean().exec();
  assertWithinQueryBudget(leadless.length, remaining, "leadless bookings");
  remaining -= leadless.length;
  const reconciliation = await BookingLeadReconciliationCase.find({
      status: "pending",
      createdAt: {
        ...observationWindow,
        ...(input.sourceReadThrough
          ? { $lte: new Date(input.sourceReadThrough) }
          : {}),
      },
      ...registryHierarchyPredicate(input.registry, {
        companyPath: "submission.source_assignment.lead_source_company",
        granularityPath: "submission.source_assignment.source_granularity_key",
        companyValue: "id",
      }),
    }).session(session ?? null).select({
      _id: 1, booking: 1, status: 1, createdAt: 1, updatedAt: 1,
      "submission.job_no": 1,
      "submission.source_assignment.source_company_label_snapshot": 1,
      "submission.source_assignment.source_granularity_label_snapshot": 1,
    }).limit(remaining + 1).maxTimeMS(REPORTING_QUERY_MAX_TIME_MS).lean().exec();
  assertWithinQueryBudget(reconciliation.length, remaining, "reconciliation cases");
  remaining -= reconciliation.length;
  const conflicts = await IngestionConflict.find({
      status: "open",
      type: "canonical_divergence",
      createdAt: {
        ...observationWindow,
        ...(input.sourceReadThrough
          ? { $lte: new Date(input.sourceReadThrough) }
          : {}),
      },
      ...registryHierarchyPredicate(input.registry, {
        companyPath: "source_company_key",
        granularityPath: "source_granularity_key",
        companyValue: "key",
      }),
    }).session(session ?? null).select({
      _id: 1, status: 1, createdAt: 1, updatedAt: 1,
      source_company_label: 1, source_granularity_label: 1,
      source_company_key: 1, source_granularity_key: 1,
    }).limit(remaining + 1).maxTimeMS(REPORTING_QUERY_MAX_TIME_MS).lean().exec();
  assertWithinQueryBudget(conflicts.length, remaining, "source divergences");
  remaining -= conflicts.length;
  const unresolvedCancellations = await CancelledLead.aggregate(
    buildScopedUnresolvedCancellationPipeline(input, remaining),
  ).session(session ?? null).option({ maxTimeMS: REPORTING_QUERY_MAX_TIME_MS }).exec();
  assertWithinQueryBudget(
    unresolvedCancellations.length,
    remaining,
    "unresolved cancellations",
  );
  assertGlobalMaterializationBudget(
    [
      { label: "lead exceptions", count: rows.length },
      { label: "leadless bookings", count: leadless.length },
      { label: "reconciliation cases", count: reconciliation.length },
      { label: "source divergences", count: conflicts.length },
      {
        label: "unresolved cancellations",
        count: unresolvedCancellations.length,
      },
    ],
    REPORTING_MAX_RELATED_ROWS,
  );
  assertSourceFence(
    [...leadless, ...reconciliation, ...conflicts, ...unresolvedCancellations] as Row[],
    input.sourceReadThrough,
  );
  for (const booking of leadless) rows.push(orphanException("leadless_booking", booking, "Booking has no canonical lead.", input));
  for (const item of reconciliation) rows.push(orphanException("ambiguous_or_unresolved_booking_match", { ...item, dependency_id: item._id, _id: item.booking }, "Booking match is unresolved.", input));
  for (const item of conflicts) rows.push(orphanException("source_canonical_divergence", item, "Canonical data diverges from source-owned values.", input));
  for (const item of unresolvedCancellations) rows.push(orphanException("unresolved_cancellation_or_refund_relationship", item, "Cancellation/refund relationship is unresolved.", input));
  const selected = Array.isArray(input.filters.exceptionTypes) ? new Set(input.filters.exceptionTypes as string[]) : null;
  return rows
    .filter((row) => !selected || selected.has(String(row.exception_type)))
    .filter((row) => !input.filters.leadType || row.lead_type === input.filters.leadType)
    .sort((a, b) => compareTuple(
      [a.exception_timestamp, a.exception_type, a.exception_key],
      [b.exception_timestamp, b.exception_type, b.exception_key],
    ));
}

export function isUnresolvedCplStatus(status: unknown): boolean {
  return (
    status === undefined ||
    status === null ||
    status === "" ||
    status === "missing_rate"
  );
}

export function buildScopedUnresolvedCancellationPipeline(
  input: ValidatedReportingRequest,
  limit = REPORTING_MAX_RELATED_ROWS,
): PipelineStage[] {
  const companyPredicates = input.registry.companies.map((company) => {
    const selectedGranularities = input.registry.granularities
      .filter((granularity) => granularity.companyId === company.id)
      .map((granularity) => granularity.key);
    return {
      source_company_id: toObjectId(company.id),
      ...(selectedGranularities.length
        ? {
            source_granularity_key: {
              $in: selectedGranularities,
            },
          }
        : {}),
    };
  });
  return [
    {
      $match: {
        $or: [{ lead_ref: null }, { lead_ref: { $exists: false } }],
        timestamp: halfOpenDatePredicate(input.resolvedWindow),
        ...(input.sourceReadThrough
          ? {
              createdAt: { $lte: new Date(input.sourceReadThrough) },
            }
          : {}),
      },
    },
    {
      $lookup: {
        from: "booked_leads",
        localField: "booked_lead",
        foreignField: "_id",
        as: "booking",
      },
    },
    { $unwind: "$booking" },
    {
      $lookup: {
        from: "form_leads",
        localField: "booking.lead_ref",
        foreignField: "_id",
        as: "form_lead",
      },
    },
    {
      $lookup: {
        from: "call_leads",
        localField: "booking.lead_ref",
        foreignField: "_id",
        as: "call_lead",
      },
    },
    {
      $set: {
        source_company_id: {
          $ifNull: [
            "$booking.employee_source_snapshot.lead_source_company",
            {
              $ifNull: [
                { $arrayElemAt: ["$form_lead.lead_source_company", 0] },
                { $arrayElemAt: ["$call_lead.lead_source_company", 0] },
              ],
            },
          ],
        },
        source_granularity_key: {
          $ifNull: [
            "$booking.employee_source_snapshot.source_granularity_key",
            {
              $ifNull: [
                { $arrayElemAt: ["$form_lead.source_granularity_key", 0] },
                { $arrayElemAt: ["$call_lead.source_granularity_key", 0] },
              ],
            },
          ],
        },
      },
    },
    { $match: { $or: companyPredicates } },
    { $limit: limit + 1 },
    {
      $project: {
        _id: 1,
        timestamp: 1,
        createdAt: 1,
        updatedAt: 1,
        booked_lead: 1,
        lead_ref: 1,
        lead_model: 1,
        booking_id: "$booking._id",
        booking_updatedAt: "$booking.updatedAt",
        booking_source: "$booking.employee_source_snapshot",
        booking_lead_ref: "$booking.lead_ref",
        booking_lead_model: "$booking.lead_model",
        booking_job_no: "$booking.job_no",
        form_lead_id: { $arrayElemAt: ["$form_lead._id", 0] },
        form_lead_updatedAt: { $arrayElemAt: ["$form_lead.updatedAt", 0] },
        form_lead_timestamp: { $arrayElemAt: ["$form_lead.timestamp", 0] },
        form_lead_source_company: {
          $arrayElemAt: ["$form_lead.lead_source_company", 0],
        },
        form_lead_source_granularity: {
          $arrayElemAt: ["$form_lead.source_granularity_key", 0],
        },
        call_lead_id: { $arrayElemAt: ["$call_lead._id", 0] },
        call_lead_updatedAt: { $arrayElemAt: ["$call_lead.updatedAt", 0] },
        call_lead_timestamp: { $arrayElemAt: ["$call_lead.timestamp", 0] },
        call_lead_source_company: {
          $arrayElemAt: ["$call_lead.lead_source_company", 0],
        },
        call_lead_source_granularity: {
          $arrayElemAt: ["$call_lead.source_granularity_key", 0],
        },
        job_no: { $ifNull: ["$job_no", "$booking.job_no"] },
        source_company: {
          $ifNull: [
            "$booking.employee_source_snapshot.source_company_label_snapshot",
            {
              $ifNull: [
                { $arrayElemAt: ["$form_lead.source_company_label_snapshot", 0] },
                { $arrayElemAt: ["$call_lead.source_company_label_snapshot", 0] },
              ],
            },
          ],
        },
        source_granularity: {
          $ifNull: [
            "$booking.employee_source_snapshot.source_granularity_label_snapshot",
            {
              $ifNull: [
                { $arrayElemAt: ["$form_lead.source_granularity_label_snapshot", 0] },
                { $arrayElemAt: ["$call_lead.source_granularity_label_snapshot", 0] },
              ],
            },
          ],
        },
      },
    },
  ];
}

export function registryHierarchyPredicate(
  registry: ValidatedReportingRequest["registry"],
  paths: {
    companyPath: string;
    granularityPath: string;
    companyValue: "id" | "key";
  },
): Record<string, unknown> {
  return {
    $or: registry.companies.map((company) => {
      const selectedGranularities = registry.granularities
        .filter((granularity) => granularity.companyId === company.id)
        .map((granularity) => granularity.key);
      return {
        [paths.companyPath]:
          paths.companyValue === "id" ? company.id : company.key,
        ...(selectedGranularities.length
          ? {
              [paths.granularityPath]: {
                $in: selectedGranularities,
              },
            }
          : {}),
      };
    }),
  };
}

function exceptionCommon(lead: Lead, input: ValidatedReportingRequest): Row {
  return {
    _dependencyKeys: [
      `${lead.leadType === "form" ? "FormLead" : "CallLead"}:${String(lead._id)}`,
    ],
    date_basis: "lead_timestamp",
    exception_timestamp: displayInstant(lead.timestamp, input.resolvedWindow.timezone),
    source_company: lead.source_company_label_snapshot ?? lead.source_company ?? null,
    source_granularity: lead.source_granularity_label_snapshot ?? lead.source_granularity_key ?? null,
    lead_id: String(lead._id),
    lead_type: lead.leadType,
    job_number: null,
    operational_status: "open",
    relatedIds: [String(lead._id)],
  };
}

function exception(type: typeof EXCEPTION_TYPES[number], common: Row, summary: string, count: number): Row {
  const relatedIds = common.relatedIds as string[];
  return {
    ...common, relatedIds: undefined, exception_type: type, summary,
    related_record_count: count, exception_key: syntheticExceptionKey(type, relatedIds),
  };
}

function orphanException(type: typeof EXCEPTION_TYPES[number], value: Row, summary: string, input: ValidatedReportingRequest): Row {
  const timestamp = value.timestamp ?? value.createdAt ?? value.updatedAt ?? new Date(0);
  const employeeSource = record(value.employee_source_snapshot);
  const submission = record(value.submission);
  const submissionSource = record(submission?.source_assignment);
  return {
    _dependencyKeys: orphanDependencyKeys(type, value),
    exception_type: type,
    date_basis: type === "unresolved_cancellation_or_refund_relationship" ? "cancellation_timestamp" : "booking_or_observation_timestamp",
    exception_timestamp: displayInstant(timestamp as Date, input.resolvedWindow.timezone),
    source_company: value.source_company_label ?? value.source_company ??
      employeeSource?.source_company_label_snapshot ??
      submissionSource?.source_company_label_snapshot ?? null,
    source_granularity: value.source_granularity_label ?? value.source_granularity_key ??
      employeeSource?.source_granularity_label_snapshot ??
      submissionSource?.source_granularity_label_snapshot ?? null,
    lead_id: null, lead_type: "none",
    job_number: value.job_no ?? submission?.job_no ?? null, summary,
    operational_status: value.status ?? "open", related_record_count: 1,
    exception_key: syntheticExceptionKey(type, [String(value._id)]),
  };
}

function orphanDependencyKeys(
  type: typeof EXCEPTION_TYPES[number],
  value: Row,
): string[] {
  if (type === "leadless_booking") {
    return [`BookedLead:${String(value._id)}`];
  }
  if (type === "ambiguous_or_unresolved_booking_match") {
    return [
      `BookingLeadReconciliationCase:${String(value.dependency_id ?? value._id)}`,
      `BookedLead:${String(value._id)}`,
    ];
  }
  if (type === "source_canonical_divergence") {
    return [`IngestionConflict:${String(value._id)}`];
  }
  return [
    `CancelledLead:${String(value._id)}`,
    ...(value.booking_id
      ? [`BookedLead:${String(value.booking_id)}`]
      : []),
    ...(value.form_lead_id
      ? [`FormLead:${String(value.form_lead_id)}`]
      : []),
    ...(value.call_lead_id
      ? [`CallLead:${String(value.call_lead_id)}`]
      : []),
  ];
}

function record(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Row
    : null;
}

function syntheticExceptionKey(type: string, ids: string[]): string {
  return createHash("sha256").update(`${type}:${[...ids].sort().join(":")}`).digest("hex");
}

function detailFilter(row: Row, filters: Row): boolean {
  if (filters.bookingStatus === "booked" && row.booked !== true) return false;
  if (filters.bookingStatus === "unbooked" && row.booked !== false) return false;
  if (filters.cancellationStatus === "cancelled_or_refunded" && row.cancelled_or_refunded !== true) return false;
  if (filters.cancellationStatus === "active" && row.cancelled_or_refunded !== false) return false;
  if (filters.route && row.route_classification !== filters.route) return false;
  if (Array.isArray(filters.merchantKeys) && !filters.merchantKeys.includes(row.merchant)) return false;
  const requestedAgents = Array.isArray(filters.agentKeys)
    ? filters.agentKeys as unknown[]
    : null;
  if (
    requestedAgents &&
    !(row._agentKeys as string[]).some((key) => requestedAgents.includes(key))
  ) return false;
  return true;
}

function periodFor(date: Date, dimension: string, timezone: string): string | null {
  if (dimension === "none") return null;
  const local = displayInstant(date, timezone);
  return dimension === "month" ? local.slice(0, 7) : local.slice(0, 10);
}

function dateOnly(value: unknown, timezone: string): string | null {
  return value instanceof Date ? displayInstant(value, timezone).slice(0, 10) : null;
}

function agentNames(booking: Booking): string | null {
  const allocations = Array.isArray(booking.agent_allocations) ? booking.agent_allocations as Row[] : [];
  const names = allocations.map((entry) => entry.agent_name_snapshot).filter((entry): entry is string => typeof entry === "string");
  return names.length ? names.join(", ") : null;
}

function agentKeys(booking: Booking): string[] {
  const allocations = Array.isArray(booking.agent_allocations) ? booking.agent_allocations as Row[] : [];
  return allocations.map((entry) => String(entry.agent ?? "")).filter(Boolean);
}

function groupBy<T>(values: T[], key: (value: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const value of values) grouped.set(key(value), [...(grouped.get(key(value)) ?? []), value]);
  return grouped;
}

function byCancellationDateDesc(a: Cancellation, b: Cancellation): number {
  return b.cancel_date.getTime() - a.cancel_date.getTime() || String(a._id).localeCompare(String(b._id));
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function projectRows(rows: Row[], selectedIds: string[]): Row[] {
  return rows.map((row) => Object.fromEntries(selectedIds.map((id) => [id, row[id] ?? null])));
}

function assertSourceFence(rows: Row[], sourceReadThrough?: string): void {
  if (!sourceReadThrough) return;
  const readThrough = new Date(sourceReadThrough).getTime();
  for (const row of rows) {
    if (row.updatedAt instanceof Date && row.updatedAt.getTime() > readThrough) {
      throw new CanonicalSourceChangedError();
    }
  }
}

export function assertWithinQueryBudget(count: number, limit: number, label: string): void {
  if (count > limit) {
    throw reportingError(
      "reporting_query_budget_exceeded",
      `${label} exceeds the safe query bound of ${limit}; narrow the date or source selection.`,
      409,
    );
  }
}

export function assertGlobalMaterializationBudget(
  branches: Array<{ label: string; count: number }>,
  limit: number,
): void {
  let total = 0;
  for (const branch of branches) {
    if (!Number.isSafeInteger(branch.count) || branch.count < 0) {
      throw new TypeError(`Invalid materialization count: ${branch.label}`);
    }
    total += branch.count;
    if (total > limit) {
      throw reportingError(
        "reporting_query_budget_exceeded",
        `Combined reporting branches exceed the safe query bound of ${limit}; narrow the date or source selection.`,
        409,
      );
    }
  }
}

export function computeQueryInputChecksum(input: ValidatedReportingRequest): string {
  return computeChecksum({ checksum_version: 1, artifact_kind: "reporting_query_input", schema_version: 1, payload: input });
}

export function computeQueryPlanChecksum(input: ValidatedReportingRequest & { destinationSnapshotChecksum: string; sourceReadThrough: string }): string {
  return computeChecksum({ checksum_version: 1, artifact_kind: "reporting_query_plan", schema_version: 1, payload: input });
}

export async function buildReportingCandidateManifest(
  input: ValidatedReportingRequest & { sourceReadThrough: string },
) : Promise<ReportingCandidateManifestV1> {
  const captured = await getReportingSnapshotAdapter().capture(
    async (session) => {
      const cohort = await loadCanonicalLeadCohort(input, session);
      const outcomes = await loadRelatedOutcomes(
        cohort,
        input.sourceReadThrough,
        session,
      );
  const baseEntries: ReportingCandidateManifestEntryV1[] = [
    ...cohort.map((lead) =>
      candidateManifestEntry(
        lead.leadType === "form" ? "FormLead" : "CallLead",
        lead,
      ),
    ),
    ...outcomes.bookings.map((booking) =>
      candidateManifestEntry("BookedLead", booking),
    ),
    ...outcomes.cancellations.map((cancellation) =>
      candidateManifestEntry("CancelledLead", cancellation),
    ),
  ];
  assertWithinQueryBudget(
    baseEntries.length,
    REPORTING_MAX_MANIFEST_ENTRIES,
    "candidate manifest",
  );
  const exceptionEntries =
    input.datasetKey === "lead_quality_exceptions"
      ? await collectExceptionManifestEntries(
          input,
          REPORTING_MAX_MANIFEST_ENTRIES - baseEntries.length,
          session,
        )
      : [];
  const candidateEntries = [...baseEntries, ...exceptionEntries];
  assertWithinQueryBudget(
    candidateEntries.length,
    REPORTING_MAX_MANIFEST_ENTRIES,
    "candidate manifest",
  );
  const uniqueEntries = new Map<string, ReportingCandidateManifestEntryV1>();
  for (const entry of candidateEntries) {
    const key = `${entry.model}:${entry.id}`;
    if (!uniqueEntries.has(key)) uniqueEntries.set(key, entry);
  }
  const entries = [...uniqueEntries.values()].sort((left, right) =>
    compareTuple([left.model, left.id], [right.model, right.id]),
  );
      let outputRows: Row[];
      if (input.datasetKey === "lead_outcome_detail") {
        outputRows = detailRows(cohort, outcomes, input);
      } else if (input.datasetKey === "source_performance") {
        outputRows = performanceRows(cohort, outcomes, input);
      } else {
        outputRows = await exceptionRows(cohort, outcomes, input, session);
      }
      outputRows.sort((left, right) =>
        compareSortTuple(
          input.effectiveSort.map((term) => left[term.id]),
          input.effectiveSort.map((term) => right[term.id]),
          input.effectiveSort,
        ),
      );
      return {
        entries,
        outputPages: buildOutputPageMappings(
          outputRows,
          input.effectiveSort,
          500,
          new Set(entries.map((entry) => `${entry.model}:${entry.id}`)),
        ),
      };
    },
  );
  const { entries, outputPages } = captured.value;
  return {
    version: 1 as const,
    sourceReadThrough: input.sourceReadThrough,
    manifestCapturedAt: captured.token.capturedAt,
    snapshotToken: captured.token,
    entries,
    outputPages,
    checksum: computeChecksum({
      checksum_version: 1,
      artifact_kind: "reporting_data",
      schema_version: 1,
      payload: {
        sourceReadThrough: input.sourceReadThrough,
        manifestCapturedAt: captured.token.capturedAt,
        snapshotToken: captured.token,
        entries,
        outputPages,
      },
    }),
  };
}

export class CanonicalSourceChangedError extends Error {
  readonly code = "canonical_source_changed";
  readonly retryable = true;

  constructor() {
    super(
      "Canonical production data changed after sourceReadThrough; retry as a new run.",
    );
    this.name = "CanonicalSourceChangedError";
  }
}

export function buildOutputPageMappings(
  rows: Row[],
  sort: ValidatedReportingRequest["effectiveSort"],
  pageSize: number,
  manifestEntryKeys?: ReadonlySet<string>,
) {
  const mappings = [];
  let afterCursor: string | null = null;
  for (let offset = 0; offset < rows.length; offset += pageSize) {
    const pageRows = rows.slice(offset, offset + pageSize);
    const last = pageRows.at(-1);
    const nextCursor =
      last && offset + pageRows.length < rows.length
        ? encodeCursor(sort.map((term) => last[term.id]))
        : null;
    const dependencyKeys = [
      ...new Set(
        pageRows.flatMap((row) =>
          Array.isArray(row._dependencyKeys)
            ? (row._dependencyKeys as string[])
            : [],
        ),
      ),
    ].sort();
    if (pageRows.length > 0 && dependencyKeys.length === 0) {
      throw new Error("reporting_output_dependency_mapping_missing");
    }
    if (
      manifestEntryKeys &&
      dependencyKeys.some((key) => !manifestEntryKeys.has(key))
    ) {
      throw new Error("reporting_output_dependency_mapping_missing");
    }
    mappings.push({
      pageNumber: mappings.length,
      afterCursor,
      nextCursor,
      dependencyKeys,
    });
    afterCursor = nextCursor;
  }
  return mappings;
}

export async function assertReportingCandidateManifestUnchanged(
  input: ValidatedReportingRequest & { sourceReadThrough: string },
  expected: Awaited<ReturnType<typeof buildReportingCandidateManifest>>,
): Promise<void> {
  const current = await buildReportingCandidateManifest(input);
  if (
    current.sourceReadThrough !== expected.sourceReadThrough ||
    computeChecksum({
      checksum_version: 1,
      artifact_kind: "reporting_data",
      schema_version: 1,
      payload: {
        entries: current.entries,
        outputPages: current.outputPages,
      },
    }) !==
      computeChecksum({
        checksum_version: 1,
        artifact_kind: "reporting_data",
        schema_version: 1,
        payload: {
          entries: expected.entries,
          outputPages: expected.outputPages,
        },
      })
  ) {
    throw new Error("reporting_candidate_manifest_changed");
  }
}

export async function validateReportingManifestEntries(
  entries: ReportingCandidateManifestEntryV1[],
  sourceReadThrough: string,
): Promise<void> {
  const readThrough = new Date(sourceReadThrough);
  if (!Number.isFinite(readThrough.getTime())) {
    throw new TypeError("Invalid manifest sourceReadThrough.");
  }
  const byModel = new Map<
    ReportingCandidateManifestEntryV1["model"],
    ReportingCandidateManifestEntryV1[]
  >();
  for (const entry of entries) {
    byModel.set(entry.model, [...(byModel.get(entry.model) ?? []), entry]);
  }
  for (const [model, expectedEntries] of byModel) {
    const Model = manifestModel(model) as mongoose.Model<any>;
    const rows = await Model
      .find({ _id: { $in: expectedEntries.map((entry) => entry.id) } })
      .select(manifestProjection(model))
      .maxTimeMS(REPORTING_QUERY_MAX_TIME_MS)
      .lean()
      .exec() as Row[];
    const currentById = new Map(
      rows.map((row) => [String(row._id), row]),
    );
    for (const expected of expectedEntries) {
      const row = currentById.get(expected.id);
      if (!row) throw new CanonicalSourceChangedError();
      if (
        !(row.updatedAt instanceof Date) ||
        row.updatedAt > readThrough
      ) {
        throw new CanonicalSourceChangedError();
      }
      const current = candidateManifestEntry(model, row);
      if (
        current.version !== expected.version ||
        current.fingerprint !== expected.fingerprint
      ) {
        throw new CanonicalSourceChangedError();
      }
    }
  }
}

function manifestModel(model: ReportingCandidateManifestEntryV1["model"]) {
  switch (model) {
    case "FormLead":
      return getFormLeadModel();
    case "CallLead":
      return getCallLeadModel();
    case "BookedLead":
      return BookedLead;
    case "CancelledLead":
      return CancelledLead;
    case "BookingLeadReconciliationCase":
      return BookingLeadReconciliationCase;
    case "IngestionConflict":
      return IngestionConflict;
  }
}

function manifestProjection(
  model: ReportingCandidateManifestEntryV1["model"],
): Record<string, 1> {
  if (model === "FormLead" || model === "CallLead") {
    return {
      _id: 1,
      updatedAt: 1,
      timestamp: 1,
      lead_source_company: 1,
      source_granularity_key: 1,
    };
  }
  if (model === "BookedLead") {
    return {
      _id: 1,
      updatedAt: 1,
      lead_ref: 1,
      lead_model: 1,
      job_no: 1,
      employee_source_snapshot: 1,
    };
  }
  if (model === "CancelledLead") {
    return {
      _id: 1,
      updatedAt: 1,
      booked_lead: 1,
      lead_ref: 1,
      lead_model: 1,
    };
  }
  return { _id: 1, updatedAt: 1 };
}

function candidateManifestEntry(
  model: ReportingCandidateManifestEntryV1["model"],
  row: Row,
): ReportingCandidateManifestEntryV1 {
  const updatedAt = row.updatedAt;
  if (!(updatedAt instanceof Date) || !Number.isFinite(updatedAt.getTime())) {
    throw new Error(`reporting_candidate_missing_version:${model}:${String(row._id)}`);
  }
  const normalized = JSON.parse(
    JSON.stringify(manifestFingerprintPayload(model, row)),
  ) as Row;
  return {
    model,
    id: String(row._id),
    version: updatedAt.toISOString(),
    fingerprint: computeChecksum({
      checksum_version: 1,
      artifact_kind: "reporting_data",
      schema_version: 1,
      payload: normalized,
    }),
  };
}

function manifestFingerprintPayload(
  model: ReportingCandidateManifestEntryV1["model"],
  row: Row,
): Row {
  const shared = { _id: row._id, updatedAt: row.updatedAt };
  if (model === "FormLead" || model === "CallLead") {
    return {
      ...shared,
      lead_source_company: row.lead_source_company ?? null,
      source_granularity_key: row.source_granularity_key ?? null,
      timestamp: row.timestamp ?? null,
    };
  }
  if (model === "BookedLead") {
    return {
      ...shared,
      lead_ref: row.lead_ref ?? null,
      lead_model: row.lead_model ?? null,
      job_no: row.job_no ?? null,
      employee_source_snapshot: row.employee_source_snapshot ?? null,
    };
  }
  if (model === "CancelledLead") {
    return {
      ...shared,
      booked_lead: row.booked_lead ?? null,
      lead_ref: row.lead_ref ?? null,
      lead_model: row.lead_model ?? null,
    };
  }
  return shared;
}

async function collectExceptionManifestEntries(
  input: ValidatedReportingRequest & { sourceReadThrough: string },
  budget: number,
  session: ClientSession,
): Promise<ReportingCandidateManifestEntryV1[]> {
  const observationWindow = halfOpenDatePredicate(input.resolvedWindow);
  const createdFence = { createdAt: { $lte: new Date(input.sourceReadThrough) } };
  let remaining = budget;
  const leadless = await BookedLead.find({
        is_leadless_booking: true,
        timestamp: observationWindow,
        ...registryHierarchyPredicate(input.registry, {
          companyPath: "employee_source_snapshot.lead_source_company",
          granularityPath: "employee_source_snapshot.source_granularity_key",
          companyValue: "id",
        }),
        ...createdFence,
      })
        .session(session)
        .select(manifestProjection("BookedLead"))
        .limit(remaining + 1)
        .maxTimeMS(REPORTING_QUERY_MAX_TIME_MS)
        .lean()
        .exec();
  assertWithinQueryBudget(leadless.length, remaining, "manifest leadless bookings");
  remaining -= leadless.length;
  const reconciliation = await BookingLeadReconciliationCase.find({
        status: "pending",
        createdAt: {
          ...observationWindow,
          $lte: new Date(input.sourceReadThrough),
        },
        ...registryHierarchyPredicate(input.registry, {
          companyPath: "submission.source_assignment.lead_source_company",
          granularityPath: "submission.source_assignment.source_granularity_key",
          companyValue: "id",
        }),
      })
        .session(session)
        .select({ _id: 1, updatedAt: 1, booking: 1 })
        .limit(remaining + 1)
        .maxTimeMS(REPORTING_QUERY_MAX_TIME_MS)
        .lean()
        .exec();
  assertWithinQueryBudget(
    reconciliation.length,
    remaining,
    "manifest reconciliation cases",
  );
  remaining -= reconciliation.length;
  const conflicts = await IngestionConflict.find({
        status: "open",
        type: "canonical_divergence",
        createdAt: {
          ...observationWindow,
          $lte: new Date(input.sourceReadThrough),
        },
        ...registryHierarchyPredicate(input.registry, {
          companyPath: "source_company_key",
          granularityPath: "source_granularity_key",
          companyValue: "key",
        }),
      })
        .session(session)
        .select({ _id: 1, updatedAt: 1 })
        .limit(remaining + 1)
        .maxTimeMS(REPORTING_QUERY_MAX_TIME_MS)
        .lean()
        .exec();
  assertWithinQueryBudget(conflicts.length, remaining, "manifest divergences");
  remaining -= conflicts.length;
  const unresolvedCancellations = await CancelledLead.aggregate(
    buildScopedUnresolvedCancellationPipeline(
      input,
      Math.floor(remaining / 4),
    ),
  )
    .session(session)
    .option({ maxTimeMS: REPORTING_QUERY_MAX_TIME_MS })
    .exec();
  assertWithinQueryBudget(
    unresolvedCancellations.length * 4,
    remaining,
    "manifest unresolved cancellations",
  );
  const candidates: Array<[
    ReportingCandidateManifestEntryV1["model"],
    Row[],
  ]> = [
    ["BookedLead", leadless as Row[]],
    ["BookingLeadReconciliationCase", reconciliation as Row[]],
    ["IngestionConflict", conflicts as Row[]],
    ["CancelledLead", unresolvedCancellations as Row[]],
  ];
  const entries = candidates.flatMap(([model, rows]) =>
    rows.map((row) => candidateManifestEntry(model, row)),
  );
  const reconciliationBookings = await BookedLead.find({
    _id: {
      $in: reconciliation
        .map((item) => item.booking)
        .filter(Boolean),
    },
  })
    .session(session)
    .select(manifestProjection("BookedLead"))
    .limit(remaining + 1)
    .maxTimeMS(REPORTING_QUERY_MAX_TIME_MS)
    .lean()
    .exec() as Row[];
  assertWithinQueryBudget(
    reconciliationBookings.length,
    remaining,
    "manifest reconciliation bookings",
  );
  entries.push(
    ...reconciliationBookings.map((booking) =>
      candidateManifestEntry("BookedLead", booking),
    ),
  );
  for (const cancellation of unresolvedCancellations as Row[]) {
    if (cancellation.booking_id && cancellation.booking_updatedAt) {
      entries.push(
        candidateManifestEntry("BookedLead", {
          _id: cancellation.booking_id,
          updatedAt: cancellation.booking_updatedAt,
          employee_source_snapshot: cancellation.booking_source ?? null,
          lead_ref: cancellation.booking_lead_ref ?? null,
          lead_model: cancellation.booking_lead_model ?? null,
          job_no: cancellation.booking_job_no ?? null,
        }),
      );
    }
    if (cancellation.form_lead_id && cancellation.form_lead_updatedAt) {
      entries.push(
        candidateManifestEntry("FormLead", {
          _id: cancellation.form_lead_id,
          updatedAt: cancellation.form_lead_updatedAt,
          timestamp: cancellation.form_lead_timestamp ?? null,
          lead_source_company: cancellation.form_lead_source_company ?? null,
          source_granularity_key:
            cancellation.form_lead_source_granularity ?? null,
        }),
      );
    }
    if (cancellation.call_lead_id && cancellation.call_lead_updatedAt) {
      entries.push(
        candidateManifestEntry("CallLead", {
          _id: cancellation.call_lead_id,
          updatedAt: cancellation.call_lead_updatedAt,
          timestamp: cancellation.call_lead_timestamp ?? null,
          lead_source_company: cancellation.call_lead_source_company ?? null,
          source_granularity_key:
            cancellation.call_lead_source_granularity ?? null,
        }),
      );
    }
  }
  assertSourceFence(
    candidates.flatMap(([, rows]) => rows),
    input.sourceReadThrough,
  );
  assertWithinQueryBudget(entries.length, budget, "manifest exception dependencies");
  return entries;
}
