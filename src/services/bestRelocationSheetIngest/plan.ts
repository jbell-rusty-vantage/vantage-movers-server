import { MOVE_SIZES } from "../../config/domain";
import {
  matchLeadsToBookings,
  matchRefundsToBookings,
  selectBestRelocationRefundObservations,
} from "./matching";
import { normalizeJobNo, toDateKeyFromRaw } from "./parsing";
import type {
  CollapsedBooking,
  IngestPlan,
  LeadBookingMatch,
  MutationAction,
  ParsedBookedDeal,
  ParsedCallLead,
  ParsedFormLead,
  ParsedWorkbookData,
  PlannedMutation,
} from "./types";

// Conservative unattended policy: only exact LID/ref matches clear this
// threshold. Lower-confidence name/call heuristics remain review evidence.
export const DEFAULT_MATCH_THRESHOLD = 0.9;
export const DEFAULT_PRODUCTION_BASE_URL =
  "https://vantage-movers-main-server.vercel.app";
export const SOURCE_COMPANY = "best_relocation_leads" as const;

export function normalizeMerchantName(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (normalized === "elavon" || normalized === "elavon cc") return "Elavon";
  if (normalized === "paper check" || normalized === "paper check wf") {
    return "Paper Check";
  }
  throw new Error(`Unsupported Best Relocation merchant "${value}"`);
}

export function normalizeMoveSize(value: string): (typeof MOVE_SIZES)[number] {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (/^studio\b/.test(normalized)) return "Studio";
  if (/^(1|one)\s*(bed|bedroom)/.test(normalized)) return "1 Bedroom";
  if (/^(2|two)\s*(bed|bedroom)/.test(normalized)) return "2 Bedrooms";
  if (/^(3|three)\s*(bed|bedroom)/.test(normalized)) return "3 Bedrooms";
  if (/^(4|four)\s*(bed|bedroom)/.test(normalized)) return "4 Bedrooms";
  if (/^(5|five|\+5|5\+)\s*(\+|plus)?\s*(bed|bedroom)/.test(normalized)) {
    return "5+ Bedrooms";
  }
  if (/office|commercial/.test(normalized)) return "Office";
  const exact = MOVE_SIZES.find((size) => size.toLowerCase() === normalized);
  if (exact) return exact;
  throw new Error(`Unsupported move size "${value}"`);
}

export function normalizeZip(value: string): string {
  const digits = value.trim().match(/^(\d{3,5})(?:-\d{4})?$/)?.[1];
  if (!digits) throw new Error(`Unsupported ZIP code "${value}"`);
  return digits.padStart(5, "0");
}

export function collapseBookingsByJob(rows: ParsedBookedDeal[]): CollapsedBooking[] {
  const groups = new Map<string, ParsedBookedDeal[]>();
  for (const row of rows.filter((candidate) => candidate.is_best_relocation_source)) {
    const key = row.normalized_job_no ?? normalizeJobNo(row.job_no);
    if (!key) throw new Error(`Booked Deals row ${row.sheet_row} has no job number`);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()].map(([normalized_job_no, bookingRows]) => {
    const primary = bookingRows[0];
    const agents = [...new Set(bookingRows.map((row) => row.agent.trim()).filter(Boolean))];
    if (agents.length === 0 || agents.length > 2) {
      throw new Error(
        `Job ${primary.job_no} has ${agents.length} agents; current production booking endpoint supports one or two`,
      );
    }
    const deposits = bookingRows
      .map((row) => row.deposit_amount)
      .filter((value): value is number => value !== undefined);
    return {
      normalized_job_no,
      rows: bookingRows,
      primary,
      agents,
      total_binder_amount: roundMoney(
        bookingRows.reduce((sum, row) => sum + (row.binder_amount ?? 0), 0),
      ),
      // Duplicate split-agent rows repeat the transaction deposit; they do not
      // represent two deposits.
      deposit_amount: Math.max(...deposits, 0),
    };
  });
}

export function buildIngestPlan(
  data: ParsedWorkbookData,
  options: { threshold?: number; baseUrl?: string; limitBookings?: number } = {},
): IngestPlan {
  const threshold = options.threshold ?? DEFAULT_MATCH_THRESHOLD;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error("Match threshold must be between 0 and 1");
  }
  const leadMatchResult = matchLeadsToBookings(data);
  const refundMatchResult = matchRefundsToBookings(data.refunds, data.booked);
  const relevantRefunds = selectBestRelocationRefundObservations(
    data.refunds,
    data.booked,
  );
  const acceptedRefundMatches = refundMatchResult.matches.filter(
    (match) => match.confidence >= threshold,
  );
  const allCollapsed = collapseBookingsByJob(data.booked);
  const collapsed =
    options.limitBookings === undefined
      ? allCollapsed
      : allCollapsed.slice(0, options.limitBookings);
  const includedJobs = new Set(collapsed.map((booking) => booking.normalized_job_no));
  const acceptedMatches = leadMatchResult.matches.filter(
    (match) =>
      match.confidence >= threshold &&
      match.lead.kind !== "lid_best_relo" &&
      includedJobs.has(match.booking.normalized_job_no ?? ""),
  );
  const matchByJob = bestLeadMatchByJob(acceptedMatches);
  const callEnrichment = new Map<string, LeadBookingMatch>();
  for (const match of acceptedMatches) {
    if (match.lead.kind === "call") {
      callEnrichment.set(sourceLeadKey(match.lead.row), match);
    }
  }

  const mutations: PlannedMutation[] = [
    ...data.forms.map(mapFormMutation),
    ...data.localForms.map(mapFormMutation),
    ...data.calls.map((row) => mapCallMutation(row, callEnrichment.get(sourceLeadKey(row)))),
  ];
  for (const booking of collapsed) {
    mutations.push(mapBookingMutation(booking, matchByJob.get(booking.normalized_job_no)));
  }

  const bookingMutationByJob = new Map(
    mutations
      .filter(
        (mutation) =>
          mutation.action === "create_booked_from_source" ||
          mutation.action === "create_leadless_booking",
      )
      .map((mutation) => [mutation.idempotency_key.split(":").at(-1)!, mutation]),
  );
  for (const match of acceptedRefundMatches) {
    const job = match.booking.normalized_job_no;
    if (!job || !includedJobs.has(job)) continue;
    const bookingMutation = bookingMutationByJob.get(job);
    if (bookingMutation) mutations.push(mapCancellationMutation(match, bookingMutation));
  }

  const counts = mutationCounts(mutations);
  const unmatchedJobs = collapsed.filter(
    (booking) => !matchByJob.has(booking.normalized_job_no),
  );
  const warnings: string[] = [];
  const unmatchedRefundCount =
    refundMatchResult.unmatched.length +
    refundMatchResult.matches.length -
    acceptedRefundMatches.length;
  if (unmatchedRefundCount) {
    warnings.push(
      `${unmatchedRefundCount} Best Relocation refund row(s) could not be linked and were not planned.`,
    );
  }
  const lidOnly = leadMatchResult.matches.filter(
    (match) =>
      match.lead.kind === "lid_best_relo" &&
      match.confidence >= threshold &&
      includedJobs.has(match.booking.normalized_job_no ?? ""),
  );
  if (lidOnly.length) {
    warnings.push(
      `${lidOnly.length} LID_BestRelo-only match(es) have no source lead row and were planned as leadless bookings.`,
    );
  }
  warnings.push(
    "Apply calls normal production endpoints, so configured production Google Sheet sync side effects still run.",
  );

  return {
    version: 1,
    generated_at: new Date().toISOString(),
    mode: "dry-run",
    base_url: (options.baseUrl ?? DEFAULT_PRODUCTION_BASE_URL).replace(/\/$/, ""),
    threshold,
    source_company: SOURCE_COMPANY,
    workbooks: {
      leads: data.leadsWorkbook,
      booked: data.bookedWorkbook,
    },
    summary: {
      forms: data.forms.length,
      local_forms: data.localForms.length,
      calls: data.calls.length,
      booking_rows: collapsed.reduce((sum, booking) => sum + booking.rows.length, 0),
      booking_jobs: collapsed.length,
      collapsed_booking_rows: collapsed.reduce(
        (sum, booking) => sum + Math.max(booking.rows.length - 1, 0),
        0,
      ),
      accepted_booking_matches: matchByJob.size,
      leadless_bookings: unmatchedJobs.length,
      refunds: relevantRefunds.length,
      matched_refunds: counts.create_cancelled_lead,
      unmatched_refunds: unmatchedRefundCount,
      mutations: counts,
    },
    unmatched_booking_jobs: unmatchedJobs.map((booking) => {
      const candidates = leadMatchResult.matches
        .filter(
          (match) =>
            match.booking.normalized_job_no === booking.normalized_job_no,
        )
        .sort((a, b) => b.confidence - a.confidence);
      return {
        job_no: booking.primary.job_no,
        rows: booking.rows.map((row) => row.sheet_row),
        best_match_confidence: candidates[0]?.confidence,
        best_match_method: candidates[0]?.method,
      };
    }),
    warnings,
    mutations,
  };
}

function mapFormMutation(row: ParsedFormLead): PlannedMutation {
  const key = sourceLeadKey(row);
  const local = row.local ? "local" : "long_distance";
  const crmLabel = row.local ? "Best Relocation Locals" : "Best Relocation Forms";
  return {
    action: "create_form_lead",
    idempotency_key: key,
    api: {
      method: "POST",
      path: "/api/v1/form-leads",
      body: compact({
        name: row.name,
        timestamp: row.timestamp,
        pickup_zip: normalizeZip(row.pickup_zip),
        destination_zip: normalizeZip(row.destination_zip),
        move_size: normalizeMoveSize(row.move_size),
        move_date: row.move_date,
        phone_number: row.phone,
        lid: row.lead_id,
        ref_no: row.ref_no ?? row.lead_id,
        source_company: SOURCE_COMPANY,
        local,
        ingestion_source: "best_relocation_sheet",
        over_2000: flag(row.over_2k),
        over_4000: flag(row.over_4k),
        crm_company_label: crmLabel,
        post_to_granot: false,
      }),
    },
    sheet: row.provenance,
  };
}

function mapCallMutation(
  row: ParsedCallLead,
  enrichment?: LeadBookingMatch,
): PlannedMutation {
  const booking = enrichment?.booking;
  return {
    action: "create_call_lead",
    idempotency_key: sourceLeadKey(row),
    api: {
      method: "POST",
      path: "/api/v1/call-leads",
      body: compact({
        source_company: SOURCE_COMPANY,
        phone_number: row.phone,
        timestamp: row.timestamp,
        job_no: booking?.job_no,
        name: booking?.customer_name,
        over_2000: flag(row.over_2000),
        over_4000: flag(row.over_4000),
      }),
    },
    sheet: row.provenance,
    ...(enrichment
      ? {
          confidence: enrichment.confidence,
          match_method: enrichment.method,
          notes: ["Name and job number enriched from the accepted booking match."],
        }
      : {}),
  };
}

function mapBookingMutation(
  booking: CollapsedBooking,
  match?: LeadBookingMatch,
): PlannedMutation {
  const bookingKey = `booking:${SOURCE_COMPANY}:${booking.normalized_job_no}`;
  const common = compact({
    book_date: booking.primary.book_date,
    job_no: booking.primary.job_no,
    customer_name: booking.primary.customer_name,
    agent: booking.agents[0],
    split_agent: booking.agents[1],
    deposit_amount: booking.deposit_amount,
    merchant: normalizeMerchantName(booking.primary.merchant),
    ingestion_source: "best_relocation_sheet",
  });
  const sheet = { rows: booking.rows.map((row) => row.provenance) };
  if (!match || match.lead.kind === "lid_best_relo") {
    return {
      action: "create_leadless_booking",
      idempotency_key: bookingKey,
      api: {
        method: "POST",
        path: "/api/v1/leadless-bookings",
        body: {
          ...common,
          source_company: SOURCE_COMPANY,
          source: booking.primary.lead_source,
          total_binder_amount: booking.total_binder_amount,
        },
      },
      sheet,
      notes: [
        "No source lead match met the configured threshold; booking remains stored as leadless.",
      ],
    };
  }

  const leadKey = sourceLeadKey(match.lead.row);
  const body: Record<string, unknown> = {
    ...common,
    source_company: booking.primary.lead_source,
    binder_amount: booking.total_binder_amount,
    lead_type: match.lead.kind === "form" ? "FormLead" : "CallLead",
  };
  const bindings: Record<string, string> = {};
  if (match.lead.kind === "form") {
    body.form_lead_id = `$ref:${leadKey}`;
    bindings.form_lead_id = leadKey;
  } else {
    delete body.job_no;
    body.call_phone_number = match.lead.row.phone;
    body.call_job_no = booking.primary.job_no;
  }
  return {
    action: "create_booked_from_source",
    idempotency_key: bookingKey,
    confidence: match.confidence,
    match_method: match.method,
    depends_on: [leadKey],
    api: {
      method: "POST",
      path: "/api/v1/booked-leads/from-source",
      body,
      ...(Object.keys(bindings).length ? { bindings } : {}),
    },
    sheet,
  };
}

function mapCancellationMutation(
  match: ReturnType<typeof matchRefundsToBookings>["matches"][number],
  bookingMutation: PlannedMutation,
): PlannedMutation {
  const refund = match.refund;
  const bookingKey = bookingMutation.idempotency_key;
  return {
    action: "create_cancelled_lead",
    idempotency_key: `cancellation:${SOURCE_COMPANY}:${match.booking.normalized_job_no}:${refund.sheet_row}`,
    confidence: match.confidence,
    match_method: match.method,
    depends_on: [bookingKey],
    api: {
      method: "POST",
      path: "/api/v1/cancelled-leads",
      body: compact({
        booked_lead: `$ref:${bookingKey}`,
        timestamp: refund.timestamp,
        cancel_date: refund.refund_request_date,
        refund_amount: refund.deposit_amount ?? refund.binder_amount ?? 0,
        reason: refund.status,
        notes: `Imported from Best Relocation Refunds row ${refund.sheet_row}; job ${refund.job_no}.`,
        cancelled_by: refund.agent,
        ingestion_source: "best_relocation_sheet",
      }),
      bindings: { booked_lead: bookingKey },
    },
    sheet: refund.provenance,
  };
}

function bestLeadMatchByJob(matches: LeadBookingMatch[]): Map<string, LeadBookingMatch> {
  const result = new Map<string, LeadBookingMatch>();
  for (const match of matches) {
    const job = match.booking.normalized_job_no;
    if (!job) continue;
    const current = result.get(job);
    if (!current || match.confidence > current.confidence) result.set(job, match);
  }
  return result;
}

function sourceLeadKey(row: ParsedFormLead | ParsedCallLead): string {
  if (row.kind === "form") {
    return `form:${SOURCE_COMPANY}:${(row.lead_id ?? row.ref_no ?? row.provenance.source_row_key).toLowerCase()}`;
  }
  const day = toDateKeyFromRaw(row.date) ?? row.timestamp?.slice(0, 10) ?? "unknown-date";
  return `call:${SOURCE_COMPANY}:${row.normalized_phone ?? row.phone}:${day}:${row.time || row.sheet_row}`;
}

function mutationCounts(mutations: PlannedMutation[]): Record<MutationAction, number> {
  const result: Record<MutationAction, number> = {
    create_form_lead: 0,
    create_call_lead: 0,
    create_booked_from_source: 0,
    create_leadless_booking: 0,
    create_cancelled_lead: 0,
  };
  for (const mutation of mutations) result[mutation.action] += 1;
  return result;
}

function flag(value: string): boolean {
  return /booked|yes|true|>\s*[24]k|over\s*[24]000/i.test(value);
}

function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== ""),
  );
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
