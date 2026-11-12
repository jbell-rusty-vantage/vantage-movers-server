import { getCallLeadReportingDecision } from "../../leads/callLeadReportingDisposition";
import { allFormLeadTargets, callLeadTargets, formLeadTargets, staleFormTargets, staleFormTargetKeys, FORM_REPORTING_TARGET_KEYS, CALL_REPORTING_TARGET_KEYS, staleCallTargetKeys } from "../../googleSheets/leadReportingTargets";
import {
  BOOKED_SHEET_HEADERS,
  CANCELLED_SHEET_HEADERS,
  getMasterBookedSheetContainerId,
  SHEET_TAB_NAMES,
  type LeadModelName,
  type SourceCompany,
} from "../../../config/domain";
import { logger } from "../../../logger";
import "../../../models/Agent";
import { BookedLead } from "../../../models/BookedLead";
import { CancelledLead } from "../../../models/CancelledLead";
import "../../../models/Customer";
import type { SheetSyncJobDocument } from "../../../models/SheetSyncJob";
import { bookedLeadToRow } from "../../googleSheets/projections/bookedLeadRow";
import { callLeadToRow } from "../../googleSheets/projections/callLeadRow";
import { cancelledLeadToRow } from "../../googleSheets/projections/cancelledLeadRow";
import { formLeadToRow } from "../../googleSheets/projections/formLeadRow";
import {
  getDeleteTargets,
  getHeadersForSyncTarget,
} from "../../googleSheets/targets";
import type {
  BookedLeadSheetSource,
  CallLeadSheetSource,
  CancelledLeadSheetSource,
  FormLeadSheetSource,
  SyncTarget,
} from "../../googleSheets/types";
import { getLinkedLead } from "../../leads/sourceLeadLookup.service";
import { noSyncAppliesToNormalTabs } from "../noSyncLead";
import type { SheetSyncDocument } from "../sheetSyncPersistence";
import type { PlannedWrite } from "./types";

/**
 * A document whose row(s) the drainer will write, plus the planned writes.
 * `doc` is omitted for delete tombstones (the document is already gone, so
 * there is no `sheet_sync` metadata to persist).
 */
export type PlannedDoc = {
  docKey: string;
  doc?: SheetSyncDocument;
  writes: PlannedWrite[];
};

type SheetSyncMeta = { target: string; row_number?: number }[];

function targetAllowed(job: SheetSyncJobDocument, target: string): boolean {
  const hints = job.target_hints ?? [];
  return hints.length === 0 || hints.includes(target);
}

function filterTargets(job: SheetSyncJobDocument, targets: SyncTarget[]): SyncTarget[] {
  return targets.filter((target) => targetAllowed(job, target.target));
}

function knownRowFor(doc: { sheet_sync?: unknown }, target: string): number | undefined {
  const entries = (doc as { sheet_sync?: SheetSyncMeta }).sheet_sync ?? [];
  return entries.find((entry) => entry.target === target)?.row_number;
}

function targetsToWrites(
  jobId: string,
  docKey: string,
  mongoId: string,
  doc: { sheet_sync?: unknown },
  targets: SyncTarget[],
  row: string[],
): PlannedWrite[] {
  return targets.map((target) => ({
    jobId,
    docKey,
    mongoId,
    target: target.target,
    spreadsheetId: target.spreadsheetId,
    tabName: target.tabName,
    headers: target.headers,
    row,
    knownRowNumber: knownRowFor(doc, target.target),
    op: "upsert" as const,
  }));
}

function targetToDeleteWrite(
  jobId: string,
  docKey: string,
  mongoId: string,
  doc: { sheet_sync?: unknown },
  target: SyncTarget,
): PlannedWrite {
  return {
    jobId,
    docKey,
    mongoId,
    target: target.target,
    spreadsheetId: target.spreadsheetId,
    tabName: target.tabName,
    headers: target.headers,
    row: [],
    knownRowNumber: knownRowFor(doc, target.target),
    op: "delete",
  };
}

function bookedTarget(): SyncTarget {
  return {
    target: "master_booked",
    spreadsheetId: getMasterBookedSheetContainerId(),
    tabName: SHEET_TAB_NAMES.bookedDeals,
    headers: BOOKED_SHEET_HEADERS,
    ensureTabs: [],
  };
}

function cancelledTarget(): SyncTarget {
  return {
    target: "master_cancelled",
    spreadsheetId: getMasterBookedSheetContainerId(),
    tabName: SHEET_TAB_NAMES.cancelledDeals,
    headers: CANCELLED_SHEET_HEADERS,
    ensureTabs: [],
  };
}

async function planSourceLead(
  job: SheetSyncJobDocument,
  leadModel: LeadModelName,
  leadId: string,
): Promise<PlannedDoc[]> {
  const jobId = job._id.toString();
  const lead = await getLinkedLead(leadModel, leadId);
  const looseDoc = lead as unknown as SheetSyncDocument;
  const docKey = `${leadModel}:${leadId}`;
  if (
    noSyncAppliesToNormalTabs({
      _id: lead._id,
      created_on_unmatched: lead.get("created_on_unmatched") as boolean | null | undefined,
      no_sync: lead.get("no_sync") as boolean | null | undefined,
      duplicate: lead.get("duplicate") as boolean | null | undefined,
      bad_lead: lead.get("bad_lead"),
      ringcentral: lead.get("ringcentral"),
      external_call_admission: lead.get("external_call_admission"),
      source_company: lead.get("source_company"),
      lead_source_company: lead.get("lead_source_company"),
      source_granularity_id: lead.get("source_granularity_id"),
      timestamp: lead.get("timestamp"),
      form_fill: lead.get("form_fill") as boolean | null | undefined,
      external_sheet_review: lead.get("external_sheet_review"),
    })
  ) {
    const sourceCompany = lead.get("source_company") as SourceCompany;
    const selected = leadModel === "CallLead"
      ? getDeleteTargets(lead as unknown as CallLeadSheetSource, callLeadTargets(lead as unknown as CallLeadSheetSource, true), CALL_REPORTING_TARGET_KEYS)
      : getDeleteTargets(lead as unknown as FormLeadSheetSource, allFormLeadTargets(sourceCompany), FORM_REPORTING_TARGET_KEYS);
    const writes = selected.map((target) =>
      targetToDeleteWrite(jobId, docKey, leadId, looseDoc, target),
    );
    return [{ docKey, doc: looseDoc, writes }];
  }
  if (leadModel === "CallLead" && lead.get("created_on_unmatched") === true) {
    logger.info({ msg: "sheet_sync.drain.call_lead.created_on_unmatched.skipped", leadId });
    return [];
  }
  if (leadModel === "CallLead" && getCallLeadReportingDecision(lead).disposition === "excluded") return [];
  await looseDoc.populate({ path: "booked", populate: { path: "customer" } });

  if (leadModel === "FormLead") {
    const form = lead as unknown as FormLeadSheetSource;
    // A stale retry hint must not omit the current destination or primary
    // cleanup. The batch writer fences deletes until all upserts succeed.
    const writes = targetsToWrites(jobId, docKey, leadId, looseDoc, formLeadTargets(form), formLeadToRow(form));
    const stale = getDeleteTargets(form, staleFormTargets(form), staleFormTargetKeys(form));
    writes.push(...stale.map(target => targetToDeleteWrite(jobId, docKey, leadId, looseDoc, target)));
    return [{ docKey, doc: looseDoc, writes }];
  }

  const call = lead as unknown as CallLeadSheetSource;
  const targets = callLeadTargets(call);
  const row = callLeadToRow(call);
  // Target hints describe a previous failed attempt; disposition can change
  // before retry. Always replan the complete current call membership.
  const writes = targetsToWrites(jobId, docKey, leadId, looseDoc, targets, row);
  const staleTargets = callLeadTargets(call, true).filter((target) => !targets.some((desired) => desired.target === target.target));
  const stale = getDeleteTargets(call, staleTargets, staleCallTargetKeys(call));
  writes.push(...stale.map((target) => targetToDeleteWrite(jobId, docKey, leadId, looseDoc, target)));
  return [{ docKey, doc: looseDoc, writes }];
}

async function planBookedLead(job: SheetSyncJobDocument, bookingId: string): Promise<PlannedDoc[]> {
  const jobId = job._id.toString();
  const booking = await BookedLead.findById(bookingId)
    .populate("customer")
    .populate("agent_allocations.agent");
  if (!booking) {
    logger.warn({ msg: "sheet_sync.drain.booking_missing", bookingId });
    return [];
  }
  const docKey = `BookedLead:${bookingId}`;
  const row = bookedLeadToRow(booking as unknown as BookedLeadSheetSource);
  return [
    {
      docKey,
      doc: booking as unknown as SheetSyncDocument,
      writes: targetsToWrites(jobId, docKey, bookingId, booking, filterTargets(job, [bookedTarget()]), row),
    },
  ];
}

async function planBookingChain(job: SheetSyncJobDocument, bookingId: string): Promise<PlannedDoc[]> {
  const jobId = job._id.toString();
  const booking = await BookedLead.findById(bookingId)
    .populate("customer")
    .populate("agent_allocations.agent");
  if (!booking) {
    logger.warn({ msg: "sheet_sync.drain.booking_missing", bookingId });
    return [];
  }
  const docKey = `BookedLead:${bookingId}`;
  const row = bookedLeadToRow(booking as unknown as BookedLeadSheetSource);
  const plans: PlannedDoc[] = [
    {
      docKey,
      doc: booking as unknown as SheetSyncDocument,
      writes: targetsToWrites(jobId, docKey, bookingId, booking, filterTargets(job, [bookedTarget()]), row),
    },
  ];

  if (booking.lead_ref && booking.lead_model) {
    plans.push(
      ...(await planSourceLead(
        job,
        booking.lead_model as LeadModelName,
        booking.lead_ref.toString(),
      )),
    );
  }
  return plans;
}

async function planCancellationChain(
  job: SheetSyncJobDocument,
  cancellationId: string,
): Promise<PlannedDoc[]> {
  const jobId = job._id.toString();
  const cancellation = await CancelledLead.findById(cancellationId);
  if (!cancellation) {
    logger.warn({ msg: "sheet_sync.drain.cancellation_missing", cancellationId });
    return [];
  }
  const plans: PlannedDoc[] = [];
  plans.push(...(await planBookingChain(job, cancellation.booked_lead.toString())));

  const docKey = `CancelledLead:${cancellationId}`;
  const row = cancelledLeadToRow(cancellation as unknown as CancelledLeadSheetSource);
  plans.push({
    docKey,
    doc: cancellation as unknown as SheetSyncDocument,
    writes: targetsToWrites(jobId, docKey, cancellationId, cancellation, filterTargets(job, [cancelledTarget()]), row),
  });
  return plans;
}

/**
 * Plans the row deletions captured by a delete tombstone. The document is gone,
 * so the planner relies entirely on the tombstone's `previous_targets` snapshot
 * (target + spreadsheet/tab + last-known row). The batch writer validates each
 * row against the live tab map before deleting, so stale row numbers fall back
 * to a Mongo-id lookup (or a no-op if already removed).
 */
function planTombstone(job: SheetSyncJobDocument): PlannedDoc[] {
  const tombstone = job.tombstone;
  if (!tombstone) {
    logger.warn({ msg: "sheet_sync.drain.tombstone_missing", jobId: job._id.toString() });
    return [];
  }
  const jobId = job._id.toString();
  const mongoId = tombstone.mongo_id;
  const docKey = `tombstone:${job.resource}:${mongoId}`;
  const writes: PlannedWrite[] = [];
  const previousTargets: { target: string; spreadsheet_id: string; tab_name: string; row_number?: number | null }[] = [...(tombstone.previous_targets ?? [])];
  if (job.resource === "delete_source_lead") {
    const sourceCompany = tombstone.source_company as SourceCompany | undefined;
    const model = job.entity_model;
    if (sourceCompany && (model === "CallLead" || model === "FormLead")) {
      const targets = model === "CallLead" ? callLeadTargets({ source_company: sourceCompany }, true) : allFormLeadTargets(sourceCompany);
      previousTargets.push(...targets.map((target) => ({ target: target.target, spreadsheet_id: target.spreadsheetId, tab_name: target.tabName })));
    }
    // Old tombstones with one known workbook still enumerate every possible
    // call destination, and historical Form titles remain delete-only.
    for (const previous of [...previousTargets]) {
      const isCall = ["master_calls", "master_duplicate_calls", "master_bad_calls", "source_calls", "source_duplicate_calls", "source_bad_calls"].includes(previous.target);
      if (isCall) {
        const prefix = previous.target.startsWith("master_") ? "master" : "source";
        for (const [suffix, title] of [["calls", SHEET_TAB_NAMES.calls], ["duplicate_calls", SHEET_TAB_NAMES.duplicateCalls], ["bad_calls", SHEET_TAB_NAMES.badCalls]]) {
          previousTargets.push({ target: `${prefix}_${suffix}`, spreadsheet_id: previous.spreadsheet_id, tab_name: title });
        }
      } else if (["master_duplicates", "source_duplicates", "master_bad_leads", "source_bad_leads"].includes(previous.target)) {
        const titles = previous.target.endsWith("duplicates") ? ["Duplicates", SHEET_TAB_NAMES.duplicates] : ["Bad Leads", SHEET_TAB_NAMES.badLeads];
        for (const title of titles) previousTargets.push({ ...previous, tab_name: title });
      }
    }
  }
  const uniqueTargets = new Map<string, (typeof previousTargets)[number]>();
  for (const previous of previousTargets) {
    const key = `${previous.spreadsheet_id}:${previous.tab_name}`;
    if (!uniqueTargets.has(key)) uniqueTargets.set(key, previous);
  }
  for (const previous of uniqueTargets.values()) {
    if (job.resource !== "delete_source_lead" && !targetAllowed(job, previous.target)) {
      continue;
    }
    const headers = getHeadersForSyncTarget(previous.target);
    if (!headers) {
      continue;
    }
    writes.push({
      jobId,
      docKey,
      mongoId,
      target: previous.target,
      spreadsheetId: previous.spreadsheet_id,
      tabName: previous.tab_name,
      headers,
      row: [],
      knownRowNumber: previous.row_number ?? undefined,
      op: "delete",
    });
  }
  return [{ docKey, writes }];
}

/**
 * Reloads current Mongo state for a job and returns the documents + planned
 * sheet writes. Returns an empty array when the underlying document is gone or
 * intentionally skipped (e.g. an unmatched-booking call lead).
 */
export async function planJobWrites(job: SheetSyncJobDocument): Promise<PlannedDoc[]> {
  switch (job.resource) {
    case "source_lead":
      return planSourceLead(job, job.entity_model as LeadModelName, job.entity_id);
    case "booked_lead":
      return planBookedLead(job, job.entity_id);
    case "booking_chain":
      return planBookingChain(job, job.entity_id);
    case "cancellation_chain":
      return planCancellationChain(job, job.entity_id);
    case "delete_source_lead":
    case "delete_booked_lead":
    case "delete_cancelled_lead":
      return planTombstone(job);
  }
}
