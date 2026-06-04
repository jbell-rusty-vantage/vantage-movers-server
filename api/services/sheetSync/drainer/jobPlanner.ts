import {
  BOOKED_SHEET_HEADERS,
  CALL_SHEET_HEADERS,
  CANCELLED_SHEET_HEADERS,
  FORM_SHEET_HEADERS,
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
import { getHeadersForSyncTarget, getLeadTargets } from "../../googleSheets/targets";
import type {
  BookedLeadSheetSource,
  CallLeadSheetSource,
  CancelledLeadSheetSource,
  FormLeadSheetSource,
  SyncTarget,
} from "../../googleSheets/types";
import { getLinkedLead } from "../../leads/sourceLeadLookup.service";
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

function formLeadTargetBase(duplicate?: boolean | null) {
  return duplicate
    ? { masterTarget: "master_duplicates", sourceTarget: "source_duplicates", tabName: SHEET_TAB_NAMES.duplicates }
    : { masterTarget: "master_forms", sourceTarget: "source_forms", tabName: SHEET_TAB_NAMES.forms };
}

function callLeadTargetBase(duplicate?: boolean | null) {
  return duplicate
    ? { masterTarget: "master_duplicate_calls", sourceTarget: "source_duplicate_calls", tabName: SHEET_TAB_NAMES.duplicateCalls }
    : { masterTarget: "master_calls", sourceTarget: "source_calls", tabName: SHEET_TAB_NAMES.calls };
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
  if (leadModel === "CallLead" && lead.get("created_on_unmatched") === true) {
    logger.info({ msg: "sheet_sync.drain.call_lead.created_on_unmatched.skipped", leadId });
    return [];
  }
  const looseDoc = lead as unknown as SheetSyncDocument;
  await looseDoc.populate({ path: "booked", populate: { path: "customer" } });

  const sourceCompany = lead.get("source_company") as SourceCompany;
  const duplicate = lead.get("duplicate") as boolean | undefined;
  const docKey = `${leadModel}:${leadId}`;

  if (leadModel === "FormLead") {
    const base = formLeadTargetBase(duplicate);
    const targets = getLeadTargets(
      base.masterTarget,
      base.sourceTarget,
      sourceCompany,
      base.tabName,
      FORM_SHEET_HEADERS,
    );
    const row = formLeadToRow(lead as unknown as FormLeadSheetSource);
    const selectedTargets = filterTargets(job, targets);
    return [{ docKey, doc: looseDoc, writes: targetsToWrites(jobId, docKey, leadId, looseDoc, selectedTargets, row) }];
  }

  const base = callLeadTargetBase(duplicate);
  const targets = getLeadTargets(
    base.masterTarget,
    base.sourceTarget,
    sourceCompany,
    base.tabName,
    CALL_SHEET_HEADERS,
  );
  const row = callLeadToRow(lead as unknown as CallLeadSheetSource);
  const selectedTargets = filterTargets(job, targets);
  return [{ docKey, doc: looseDoc, writes: targetsToWrites(jobId, docKey, leadId, looseDoc, selectedTargets, row) }];
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
  for (const previous of tombstone.previous_targets ?? []) {
    if (!targetAllowed(job, previous.target)) {
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
