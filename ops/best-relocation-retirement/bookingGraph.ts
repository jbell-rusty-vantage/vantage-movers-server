import { stableSourceRowId } from "../../src/services/bestRelocationSheetIngest/identity";
import { normalizeJobNo, normalizePersonName, toDateKeyFromRaw } from "../../src/services/bestRelocationSheetIngest/parsing";
import { normalizeMerchantName } from "../../src/services/bestRelocationSheetIngest/plan";
import type { ParsedBookedDeal, ParsedCallLead, ParsedFormLead, ParsedRefund, ParsedWorkbookData } from "../../src/services/bestRelocationSheetIngest/types";
import { normalizePhoneNumberForMatch } from "../../src/utils/phone";
import { createHash } from "node:crypto";
import { canonicalJson } from "../../src/services/durableWork";
import type { BestRelocationPlanAction } from "../../src/services/bestRelocationSheetIngest/applicationPlan";

export const FINAL_BOOKING_GRAPH_VERSION = "best-relocation-booking-bounded-v1";
export type DefiniteSourceLead = {
  dataset_key: "forms" | "local_forms" | "calls";
  stable_source_row_id: string;
  method: "lid_ref_and_customer" | "explicit_job_and_phone";
  evidence: string[];
};
export type FinalGraphBooking = {
  job: string;
  rows: ParsedBookedDeal[];
  representative_rows: ParsedBookedDeal[];
  duplicate_response_rows: number[];
  status: "ready" | "conflict";
  conflicts: string[];
  total_binder_amount?: number;
  deposit_amount?: number;
  agent_allocations?: Array<{ agent_name: string; binder_amount: number }>;
  definite_lead?: DefiniteSourceLead;
  lead_match_conflicts: string[];
};
export type FinalGraphRefund = {
  row: ParsedRefund;
  status: "matched" | "duplicate_response" | "review";
  booking_job?: string;
  primary_refund_identity?: string;
  method?: "job_and_corroboration" | "lid_and_customer";
  evidence: string[];
  conflicts: string[];
};
export type FinalBookingGraph = {
  version: typeof FINAL_BOOKING_GRAPH_VERSION;
  bookings: FinalGraphBooking[];
  refunds: FinalGraphRefund[];
  permitted_normal_leads: Array<DefiniteSourceLead & { booking_job: string }>;
  accounting: {
    booking_source_rows: number; booking_identities: number; booking_ready: number; booking_conflicts: number;
    collapsed_booking_responses: number; definite_lead_matches: number; leadless_bookings: number;
    refund_source_rows: number; refund_matches: number; collapsed_refund_responses: number; refund_review: number;
  };
};

const text = (value: string | undefined) => (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const unique = <T>(values: T[]) => [...new Set(values)];
const cents = (value: number | undefined) => value !== undefined && Number.isFinite(value) ? Math.round(value * 100) : undefined;
const provenance = (row: { source_tab: string; sheet_row: number }) => `${row.source_tab}:${row.sheet_row}`;
const sourceIdentity = (row: ParsedFormLead | ParsedCallLead | ParsedRefund) => {
  try { return stableSourceRowId(row); } catch { return null; }
};
const channel = (source: string): "forms" | "local_forms" | "calls" | undefined => {
  const label = text(source).replace(/\s/g, "");
  if (label === "bestrelocationforms") return "forms";
  if (label === "bestrelocationlocals") return "local_forms";
  if (label === "bestrelocationinbounds") return "calls";
  return undefined;
};
const merchant = (value: string) => { try { return normalizeMerchantName(value); } catch { return undefined; } };
const date = (value: string | undefined) => toDateKeyFromRaw(value);
const sourcePhones = (raw: Record<string, string>) => unique(["Phone", "Phone Number", "PHONE NUMBER", "Customer Phone", "Customer Phone Number"]
  .map(key => normalizePhoneNumberForMatch(raw[key])).filter((value): value is string => !!value));
const explicitJobs = (raw: Record<string, string>) => unique(["Job Number:", "Job Number", "Job No", "Job #", "job_no"]
  .map(key => normalizeJobNo(raw[key] ?? "")).filter((value): value is string => !!value));

/** Pure frozen-source graph. There is no DB/network access and no score threshold.
 * Each financial identity is resolved before choosing a Lead or refund, so input
 * iteration order cannot authorize money or consume another row's candidate. */
export function buildFinalBookingGraph(input: { data: ParsedWorkbookData; cutoff?: Date | string; through: Date | string }): FinalBookingGraph {
  const from = +new Date(input.cutoff ?? "2026-04-30T04:00:00.000Z"), through = +new Date(input.through);
  if (!Number.isFinite(from) || !Number.isFinite(through) || through <= from) throw new Error("invalid_final_graph_window");
  const inWindow = (value?: string) => !!value && Date.parse(value) >= from && Date.parse(value) < through;
  const sourceBookings = input.data.booked.filter(row => row.is_best_relocation_source && inWindow(row.timestamp));
  const byJob = new Map<string, ParsedBookedDeal[]>();
  for (const row of sourceBookings) {
    // Invalid identities remain individually reportable rather than disappearing.
    const key = row.normalized_job_no ?? normalizeJobNo(row.job_no) ?? `unresolved:${provenance(row)}`;
    byJob.set(key, [...(byJob.get(key) ?? []), row]);
  }
  const bookings = [...byJob.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([job, rows]) => collapseBooking(job, rows));
  for (const booking of bookings) matchDefiniteSourceLead(booking, [...input.data.forms, ...input.data.localForms, ...input.data.calls]);
  // A source Lead cannot own two jobs, even when each Booking separately has an exact LID.
  const jobsByLead = new Map<string, FinalGraphBooking[]>();
  for (const booking of bookings) if (booking.definite_lead) {
    const key = `${booking.definite_lead.dataset_key}:${booking.definite_lead.stable_source_row_id}`;
    jobsByLead.set(key, [...(jobsByLead.get(key) ?? []), booking]);
  }
  for (const candidates of jobsByLead.values()) if (candidates.length > 1) for (const booking of candidates) {
    delete booking.definite_lead;
    booking.lead_match_conflicts.push("one_source_lead_matches_multiple_jobs");
  }
  const refunds = matchRefunds(input.data.refunds.filter(row => inWindow(row.timestamp)), bookings);
  const permitted = bookings.flatMap(booking => booking.status === "ready" && booking.definite_lead ? [{ ...booking.definite_lead, booking_job: booking.job }] : []);
  return { version: FINAL_BOOKING_GRAPH_VERSION, bookings, refunds, permitted_normal_leads: permitted, accounting: {
    booking_source_rows: sourceBookings.length, booking_identities: bookings.length,
    booking_ready: bookings.filter(row => row.status === "ready").length, booking_conflicts: bookings.filter(row => row.status === "conflict").length,
    collapsed_booking_responses: bookings.reduce((sum, row) => sum + row.duplicate_response_rows.length, 0),
    definite_lead_matches: permitted.length, leadless_bookings: bookings.filter(row => row.status === "ready" && !row.definite_lead).length,
    refund_source_rows: refunds.length, refund_matches: refunds.filter(row => row.status === "matched").length,
    collapsed_refund_responses: refunds.filter(row => row.status === "duplicate_response").length, refund_review: refunds.filter(row => row.status === "review").length,
  } };
}

function collapseBooking(job: string, input: ParsedBookedDeal[]): FinalGraphBooking {
  const rows = [...input].sort((a, b) => a.sheet_row - b.sheet_row), conflicts: string[] = [];
  if (job.startsWith("unresolved:")) conflicts.push("missing_booking_job");
  const consistent = (key: string, values: Array<unknown>, require = true) => {
    if (require && values.some(value => value === undefined || value === "")) conflicts.push(`missing_booking_${key}`);
    if (unique(values.filter(value => value !== undefined && value !== "")).length > 1) conflicts.push(`conflicting_booking_${key}`);
  };
  consistent("customer", rows.map(row => normalizePersonName(row.customer_name)));
  consistent("source_channel", rows.map(row => channel(row.lead_source)));
  consistent("book_date", rows.map(row => date(row.book_date)));
  consistent("merchant", rows.map(row => merchant(row.merchant)));
  consistent("lid", rows.map(row => text(row.lid) || undefined), false);
  consistent("deposit", rows.map(row => cents(row.deposit_amount)));
  if (rows.some(row => !row.agent.trim() || cents(row.binder_amount) === undefined || (row.binder_amount ?? 0) < 0 || (row.deposit_amount ?? 0) < 0)) conflicts.push("missing_or_invalid_booking_financial_value");
  const agents = new Map<string, ParsedBookedDeal[]>();
  for (const row of rows) agents.set(text(row.agent), [...(agents.get(text(row.agent)) ?? []), row]);
  if (!agents.size || agents.size > 2) conflicts.push("unsupported_booking_agent_count");
  const representative: ParsedBookedDeal[] = [], duplicateRows: number[] = [];
  for (const [_agent, agentRows] of [...agents.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (unique(agentRows.map(row => cents(row.binder_amount))).length > 1) conflicts.push("conflicting_same_agent_binder");
    // A duplicate response repeats one agent's allocation; it is never summed twice.
    representative.push(agentRows[0]); duplicateRows.push(...agentRows.slice(1).map(row => row.sheet_row));
  }
  const status = conflicts.length ? "conflict" : "ready";
  return { job, rows, representative_rows: representative, duplicate_response_rows: duplicateRows.sort((a, b) => a - b), status, conflicts: unique(conflicts),
    ...(status === "ready" ? {
      total_binder_amount: representative.reduce((sum, row) => sum + cents(row.binder_amount)!, 0) / 100,
      deposit_amount: cents(rows[0].deposit_amount)! / 100,
      agent_allocations: representative.map(row => ({ agent_name: row.agent.trim(), binder_amount: cents(row.binder_amount)! / 100 })),
    } : {}), lead_match_conflicts: [] };
}

function matchDefiniteSourceLead(booking: FinalGraphBooking, leads: Array<ParsedFormLead | ParsedCallLead>) {
  if (booking.status !== "ready") return;
  const sourceChannel = channel(booking.rows[0].lead_source), lids = unique(booking.rows.map(row => text(row.lid)).filter(Boolean));
  const names = unique(booking.rows.map(row => normalizePersonName(row.customer_name)).filter((value): value is string => !!value));
  const phones = unique(booking.rows.flatMap(row => sourcePhones(row.provenance.raw)));
  const candidates: DefiniteSourceLead[] = [];
  for (const lead of leads) {
    const dataset = lead.source_tab === "Local Forms" ? "local_forms" : lead.kind === "call" ? "calls" : "forms";
    // The configured generic Forms source owns both Local/Long Distance routes.
    // An explicitly Local label and Inbounds remain narrower scopes.
    if (dataset !== sourceChannel && !(sourceChannel === "forms" && dataset === "local_forms")) continue;
    const id = sourceIdentity(lead);
    if (!id) continue;
    const phone = normalizePhoneNumberForMatch(lead.phone);
    if (lead.kind === "form") {
      const ids = [text(lead.lead_id), text(lead.ref_no)].filter(Boolean);
      if (!lids.some(lid => ids.includes(lid))) continue;
      if (!names.includes(normalizePersonName(lead.name) ?? "") || phones.length && (!phone || !phones.includes(phone))) {
        booking.lead_match_conflicts.push(`exact_lid_contact_conflict:${provenance(lead)}`); continue;
      }
      candidates.push({ dataset_key: dataset, stable_source_row_id: id, method: "lid_ref_and_customer",
        evidence: [...booking.rows.map(provenance), provenance(lead), `exact_lid:${lids[0]}`, "exact_customer_name", `source_channel:${dataset}`, `booking_source_label:${text(booking.rows[0].lead_source)}`] });
    } else if (explicitJobs(lead.provenance.raw).includes(booking.job) && phone && phones.length === 1 && phones[0] === phone) {
      candidates.push({ dataset_key: "calls", stable_source_row_id: id, method: "explicit_job_and_phone",
        evidence: [...booking.rows.map(provenance), provenance(lead), `exact_job:${booking.job}`, "exact_booking_phone", "source_channel:calls"] });
    }
  }
  // Multiple physical rows with the same identity are still ambiguous evidence.
  if (candidates.length === 1 && !booking.lead_match_conflicts.length) booking.definite_lead = candidates[0];
  else if (candidates.length > 1) booking.lead_match_conflicts.push("multiple_exact_source_lead_candidates");
}

function refundSemanticKey(row: ParsedRefund) {
  return JSON.stringify([text(row.agent), date(row.book_date), date(row.refund_request_date), row.normalized_job_no ?? normalizeJobNo(row.job_no),
    normalizePersonName(row.customer_name), cents(row.binder_amount), cents(row.deposit_amount), merchant(row.merchant), channel(row.lead_source), text(row.lid), text(row.status)]);
}

function matchRefunds(rows: ParsedRefund[], bookings: FinalGraphBooking[]): FinalGraphRefund[] {
  const relevant = rows.filter(row => row.is_best_relocation_source || !row.lead_source.trim() && bookings.some(booking =>
    booking.job === (row.normalized_job_no ?? normalizeJobNo(row.job_no)) || row.lid && booking.rows.some(book => text(book.lid) === text(row.lid))));
  const result: FinalGraphRefund[] = relevant.sort((a, b) => a.sheet_row - b.sheet_row).map(row => {
    const job = row.normalized_job_no ?? normalizeJobNo(row.job_no), lid = text(row.lid), name = normalizePersonName(row.customer_name);
    const identityCandidates = bookings.filter(booking => job ? booking.job === job : !!lid && booking.rows.some(book => text(book.lid) === lid));
    const base: FinalGraphRefund = { row, status: "review", evidence: [provenance(row)], conflicts: [] };
    if (!sourceIdentity(row)) base.conflicts.push("missing_durable_refund_identity");
    if (identityCandidates.length !== 1) { base.conflicts.push(identityCandidates.length ? "ambiguous_refund_booking_identity" : "unmatched_refund_booking"); return base; }
    const booking = identityCandidates[0]; base.booking_job = booking.job; base.evidence.push(...booking.rows.map(provenance));
    if (booking.status !== "ready") base.conflicts.push("refund_booking_financial_conflict");
    const sameCustomer = !!name && booking.rows.every(book => normalizePersonName(book.customer_name) === name);
    const sameLid = !!lid && booking.rows.some(book => text(book.lid) === lid);
    const sameAgent = !!text(row.agent) && booking.rows.some(book => text(book.agent) === text(row.agent));
    if (name && !sameCustomer) base.conflicts.push("refund_customer_conflict");
    if (lid && booking.rows.some(book => book.lid?.trim()) && !sameLid) base.conflicts.push("refund_lid_conflict");
    if (row.lead_source.trim() && channel(row.lead_source) !== channel(booking.rows[0].lead_source)) base.conflicts.push("refund_source_channel_conflict");
    if (row.book_date && date(row.book_date) !== date(booking.rows[0].book_date)) base.conflicts.push("refund_book_date_conflict");
    if (!row.status.trim() || !row.refund_request_date || !Number.isFinite(Date.parse(row.refund_request_date)) || cents(row.deposit_amount ?? row.binder_amount) === undefined || (row.deposit_amount ?? row.binder_amount ?? -1) < 0) base.conflicts.push("missing_or_invalid_refund_financial_value");
    if (!(job && (sameCustomer || sameLid || sameAgent) || !job && sameLid && sameCustomer)) base.conflicts.push("refund_identity_lacks_corroboration");
    if (!base.conflicts.length) {
      base.status = "matched"; base.method = job ? "job_and_corroboration" : "lid_and_customer";
      base.evidence.push(...[job ? "exact_job" : "exact_lid", sameCustomer ? "exact_customer_name" : "", sameAgent ? "matching_booking_agent" : "", sameLid ? "exact_lid" : ""].filter(Boolean));
    }
    return base;
  });
  // Resolve competing source requests at canonical Booking identity, never one
  // physical split-agent response at a time and never first-row-wins.
  for (const booking of bookings) {
    const candidates = result.filter(row => row.booking_job === booking.job && row.status === "matched");
    if (candidates.length < 2) continue;
    if (unique(candidates.map(candidate => refundSemanticKey(candidate.row))).length > 1) {
      for (const candidate of candidates) { candidate.status = "review"; candidate.conflicts.push("multiple_distinct_refunds_for_one_booking"); }
    } else {
      const [primary, ...duplicates] = [...candidates].sort((a, b) => sourceIdentity(a.row)!.localeCompare(sourceIdentity(b.row)!) || a.row.sheet_row - b.row.sheet_row);
      for (const duplicate of duplicates) { duplicate.status = "duplicate_response"; duplicate.primary_refund_identity = sourceIdentity(primary.row)!; }
    }
  }
  return result;
}

const graphHash = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");

/** Build canonical financial commands independently of Lead creation/attachment.
 * A later adoption pass may replace creates with protected existing identities.
 * Every physical repeated response remains in the action's frozen provenance. */
export function buildFinalFinancialActions(graph: FinalBookingGraph): BestRelocationPlanAction[] {
  const actions: BestRelocationPlanAction[] = [], bookingKeys = new Map<string, string>();
  for (const booking of graph.bookings) {
    const row = booking.rows[0], allocations = booking.agent_allocations ?? [];
    const unequalSplit = allocations.length === 2 && cents(allocations[0].binder_amount) !== cents(allocations[1].binder_amount);
    const payload = booking.status === "ready" ? {
      book_date: row.book_date, job_no: row.job_no, source_company: "best_relocation_leads", source: row.lead_source,
      customer_name: row.customer_name, agent: allocations[0]?.agent_name,
      ...(allocations[1] ? { split_agent: allocations[1].agent_name } : {}),
      total_binder_amount: booking.total_binder_amount, deposit_amount: booking.deposit_amount,
      merchant: merchant(row.merchant), ingestion_source: "best_relocation_sheet",
      ...(channel(row.lead_source) === "local_forms" ? { local: "local" } : {}),
    } : undefined;
    const content = graphHash({ version: graph.version, job: booking.job, payload,
      allocations, conflicts: booking.conflicts, unequal_split: unequalSplit, rows: booking.rows.map(source => source.provenance.raw) });
    const actionKey = `final-booking:${booking.job}:${content}`;
    bookingKeys.set(booking.job, actionKey);
    const ready = booking.status === "ready" && !unequalSplit;
    actions.push({ action_key: actionKey, command: ready ? "create_leadless_booking" : "record_conflict",
      classification: ready ? "leadless_booking" : "conflict", dataset_key: "booked_deals", stable_source_row_id: `booking:${booking.job}`,
      content_hash: content, schema_profile: `${FINAL_BOOKING_GRAPH_VERSION}:booking`, schema_version: 2,
      provenance: { rows: booking.rows.map(source => source.provenance) }, depends_on: [],
      ...(ready ? { command_payload: payload, source_owned_values: payload } : {
        source_owned_values: { conflicts: [...booking.conflicts, ...(unequalSplit ? ["unequal_split_not_supported_by_canonical_create"] : [])],
          ...(payload ? { financial_payload: payload, exact_agent_allocations: allocations } : {}) },
        conflict: { type: "canonical_divergence", severity: "blocking" },
      }),
      matching: { method: "canonical_job_source_graph", calibration_version: graph.version,
        evidence: [`exact_job:${booking.job}`, ...booking.rows.map(provenance)] },
    });
  }
  for (const refund of graph.refunds) {
    if (refund.status === "duplicate_response") continue;
    const identity = sourceIdentity(refund.row) ?? `unresolved:${provenance(refund.row)}`;
    const copies = graph.refunds.filter(candidate => candidate.status === "duplicate_response" && candidate.primary_refund_identity === identity);
    const provenanceRows = [refund, ...copies].map(candidate => candidate.row.provenance).sort((a, b) => a.sheet_row - b.sheet_row);
    const bookingKey = refund.booking_job ? bookingKeys.get(refund.booking_job) : undefined;
    const payload = { booked_lead: `$ref:${bookingKey}`, timestamp: refund.row.timestamp, cancel_date: refund.row.refund_request_date,
      refund_amount: refund.row.deposit_amount ?? refund.row.binder_amount, reason: refund.row.status,
      notes: `Imported from Best Relocation Refunds (${identity}).`, cancelled_by: refund.row.agent, ingestion_source: "best_relocation_sheet" };
    const content = graphHash({ version: graph.version, identity, payload, conflicts: refund.conflicts, rows: provenanceRows.map(row => row.raw) });
    const ready = refund.status === "matched" && !!bookingKey;
    actions.push({ action_key: `final-refund:${identity}:${content}`, command: ready ? "create_cancelled_lead" : "record_conflict",
      classification: ready ? "create" : "conflict", dataset_key: "refunds", stable_source_row_id: identity,
      content_hash: content, schema_profile: `${FINAL_BOOKING_GRAPH_VERSION}:refund`, schema_version: 2,
      provenance: provenanceRows.length === 1 ? provenanceRows[0] : { rows: provenanceRows }, depends_on: bookingKey ? [bookingKey] : [],
      ...(ready ? { command_payload: payload, source_owned_values: payload } : {
        source_owned_values: { conflicts: refund.conflicts, raw: refund.row.provenance.raw }, conflict: { type: "unmatched_refund", severity: "blocking" },
      }), matching: { method: refund.method ?? "refund_review", calibration_version: graph.version, evidence: refund.evidence },
    });
  }
  return actions;
}
