import mongoose from "mongoose";
import type { GranotCrmCsvKind } from "../../config/domain";
import { getGranotCrmCsvIngestionModel } from "../../models/GranotCrmCsvIngestion";
import { getGranotCrmSyncRunModel } from "../../models/GranotCrmSyncRun";
import { getFormLeadModel } from "../../models/FormLead";
import { searchFormLeads } from "../search/formLeadSearch.service";
import { correctFormLead } from "../leads/formLead.service";
import {
  previewCallLeadEnrichment,
  syncCallLeadEnrichment,
} from "../enrichment/callLeadEnrichment.service";
import {
  previewBookedCallLeadReconciliation,
  syncBookedCallLeadReconciliation,
} from "../reconciliation/bookedCallLeadReconciliation.service";
import { getGranotCrmObjectText } from "./storage";
import { parseGranotCsv, cleanValue } from "./parser";
import type { GranotCsvDataRow } from "./types";

export type GranotCrmCsvSyncOptions = {
  workspace?: string;
  csvKind?: GranotCrmCsvKind;
  apply?: boolean;
  limit?: number;
};

export type GranotCrmCsvRowOutcome = {
  ingestion_id: string;
  row_id: string;
  lead_type: "form" | "call";
  status:
    | "updated"
    | "unchanged"
    | "skipped"
    | "invalid"
    | "no_match"
    | "conflict"
    | "duplicate"
    | "failed";
  message: string;
  lead_id?: string;
  changes?: string[];
};

export type GranotCrmCsvSyncResult = {
  run_id: string;
  mode: "dry_run" | "apply";
  outcomes: GranotCrmCsvRowOutcome[];
  counts: Record<GranotCrmCsvRowOutcome["status"], number>;
};

type FormPatch = {
  quoted?: boolean;
  cubic_feet?: number;
};

export async function runGranotCrmCsvSync(
  options: GranotCrmCsvSyncOptions,
): Promise<GranotCrmCsvSyncResult> {
  const mode = options.apply ? "apply" : "dry_run";
  const Run = getGranotCrmSyncRunModel();
  const run = await Run.create({
    mode,
    status: "running",
    workspace_slug: options.workspace,
    csv_kind: options.csvKind,
    options,
  });
  const outcomes: GranotCrmCsvRowOutcome[] = [];
  try {
    const ingestions = await findLatestIngestions(options);
    for (const ingestion of ingestions) {
      const csvText = await getGranotCrmObjectText(ingestion.s3_latest_key);
      const parsed = parseGranotCsv(csvText);
      const rows =
        options.limit && options.limit > 0
          ? parsed.rows.slice(0, options.limit)
          : parsed.rows;
      for (const row of rows) {
        outcomes.push(...(await processRow(ingestion._id.toString(), ingestion.csv_kind, row, options)));
      }
    }
    const counts = countOutcomes(outcomes);
    run.status = "completed";
    run.completed_at = new Date();
    run.row_count = outcomes.length;
    run.ingestion_ids = ingestions.map((ingestion) => ingestion._id);
    run.outcome_counts = counts;
    run.error_summaries = outcomes
      .filter((outcome) => outcome.status === "failed")
      .slice(0, 25)
      .map((outcome) => outcome.message);
    await run.save();
    return {
      run_id: run._id.toString(),
      mode,
      outcomes,
      counts,
    };
  } catch (error) {
    run.status = "failed";
    run.completed_at = new Date();
    run.error_summaries = [error instanceof Error ? error.message : String(error)];
    await run.save();
    throw error;
  }
}

async function findLatestIngestions(options: GranotCrmCsvSyncOptions) {
  const Ingestion = getGranotCrmCsvIngestionModel();
  const filter: Record<string, unknown> = { status: "uploaded" };
  if (options.workspace) {
    filter.workspace_slug = options.workspace;
  }
  if (options.csvKind) {
    filter.csv_kind = options.csvKind;
  }
  const all = await Ingestion.find(filter).sort({ uploaded_at: -1 }).exec();
  const latest = new Map<string, (typeof all)[number]>();
  for (const ingestion of all) {
    const key = `${ingestion.workspace_slug}:${ingestion.csv_kind}`;
    if (!latest.has(key)) {
      latest.set(key, ingestion);
    }
  }
  return [...latest.values()];
}

async function processRow(
  ingestionId: string,
  csvKind: GranotCrmCsvKind,
  row: GranotCsvDataRow,
  options: GranotCrmCsvSyncOptions,
): Promise<GranotCrmCsvRowOutcome[]> {
  if (looksLikeFormLead(row)) {
    return [await processFormRow(ingestionId, row, options)];
  }
  if (csvKind === "booked") {
    return processBookedCallRow(ingestionId, row, options);
  }
  return processFollowUpCallRow(ingestionId, row, options);
}

async function processFormRow(
  ingestionId: string,
  row: GranotCsvDataRow,
  options: GranotCrmCsvSyncOptions,
): Promise<GranotCrmCsvRowOutcome> {
  const rowId = String(row.rowKey);
  try {
    const resolved = await resolveFormLead(row);
    if (!resolved.leadId) {
      return {
        ingestion_id: ingestionId,
        row_id: rowId,
        lead_type: "form",
        status: resolved.status,
        message: resolved.message,
      };
    }

    const patch = buildFormPatch(row);
    if (Object.keys(patch).length === 0) {
      return {
        ingestion_id: ingestionId,
        row_id: rowId,
        lead_type: "form",
        status: "skipped",
        lead_id: resolved.leadId,
        message: "No syncable prior/cubic_feet values on form row.",
      };
    }

    const FormLead = getFormLeadModel();
    const current = await FormLead.findById(resolved.leadId);
    if (!current) {
      return {
        ingestion_id: ingestionId,
        row_id: rowId,
        lead_type: "form",
        status: "no_match",
        message: "Resolved form lead no longer exists.",
      };
    }
    if (current.duplicate) {
      return {
        ingestion_id: ingestionId,
        row_id: rowId,
        lead_type: "form",
        status: "duplicate",
        lead_id: current._id.toString(),
        message: "Duplicate form lead is not updated.",
      };
    }

    const changes = Object.entries(patch)
      .filter(([key, value]) => current.get(key) !== value)
      .map(([key]) => key);
    if (changes.length === 0) {
      return {
        ingestion_id: ingestionId,
        row_id: rowId,
        lead_type: "form",
        status: "unchanged",
        lead_id: current._id.toString(),
        message: "Form lead already matches Granot CSV row.",
      };
    }

    if (options.apply) {
      await correctFormLead(current._id.toString(), patch);
    }
    return {
      ingestion_id: ingestionId,
      row_id: rowId,
      lead_type: "form",
      status: options.apply ? "updated" : "unchanged",
      lead_id: current._id.toString(),
      changes,
      message: options.apply
        ? `Updated form lead fields: ${changes.join(", ")}.`
        : `Dry run would update form lead fields: ${changes.join(", ")}.`,
    };
  } catch (error) {
    return {
      ingestion_id: ingestionId,
      row_id: rowId,
      lead_type: "form",
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function resolveFormLead(row: GranotCsvDataRow): Promise<{
  leadId?: string;
  status: "no_match" | "conflict";
  message: string;
}> {
  const refNo = cleanValue(String(row.ref_no ?? ""));
  if (refNo && mongoose.isValidObjectId(refNo)) {
    return {
      leadId: refNo,
      status: "no_match",
      message: "Matched by Granot ref_no.",
    };
  }

  const search = await searchFormLeads({
    phone_number: cleanValue(String(row.phone ?? "")),
    email: cleanValue(String(row.email ?? "")),
    name: cleanValue(String(row.customer ?? "")),
    limit: 10,
  });
  if (search.status === "found") {
    return {
      leadId: search.lead._id.toString(),
      status: "no_match",
      message: "Matched by fallback search.",
    };
  }
  return {
    status: search.status === "ambiguous" ? "conflict" : "no_match",
    message: search.message,
  };
}

function buildFormPatch(row: GranotCsvDataRow): FormPatch {
  const prior = cleanValue(String(row.prior ?? ""));
  const patch: FormPatch = {};
  if (prior === "0") {
    patch.quoted = false;
  }
  if (prior === "1" || prior === "5") {
    patch.quoted = true;
    const cubicFeet = parseNumber(row.est_cf);
    if (cubicFeet !== undefined) {
      patch.cubic_feet = cubicFeet;
    }
  }
  return patch;
}

async function processFollowUpCallRow(
  ingestionId: string,
  row: GranotCsvDataRow,
  options: GranotCrmCsvSyncOptions,
): Promise<GranotCrmCsvRowOutcome[]> {
  const payload = { rows: [toEnrichmentPayload(row)] };
  const results = options.apply
    ? await syncCallLeadEnrichment(payload)
    : await previewCallLeadEnrichment(payload);
  return results.map((result) => ({
    ingestion_id: ingestionId,
    row_id: result.row_id,
    lead_type: "call",
    status: mapCallStatus(result.status),
    message: result.message,
    lead_id: result.call_lead_id,
    changes: result.changes,
  }));
}

async function processBookedCallRow(
  ingestionId: string,
  row: GranotCsvDataRow,
  options: GranotCrmCsvSyncOptions,
): Promise<GranotCrmCsvRowOutcome[]> {
  const payload = { rows: [toBookedPayload(row)] };
  const results = options.apply
    ? await syncBookedCallLeadReconciliation(payload)
    : await previewBookedCallLeadReconciliation(payload);
  return results.map((result) => ({
    ingestion_id: ingestionId,
    row_id: result.row_id,
    lead_type: "call",
    status: mapCallStatus(result.status),
    message: result.message,
    lead_id: result.call_lead_id,
    changes: result.changes,
  }));
}

function toEnrichmentPayload(row: GranotCsvDataRow) {
  return {
    row_id: String(row.rowKey),
    row_index: Number(row.rowIndex),
    job_no: stringCell(row.job_no),
    source: stringCell(row.source),
    customer: stringCell(row.customer),
    phone: stringCell(row.phone),
    email: stringCell(row.email),
    from_zip: stringCell(row.from_zip),
    to_zip: stringCell(row.to_zip),
    est_cf: stringCell(row.est_cf),
  };
}

function toBookedPayload(row: GranotCsvDataRow) {
  return {
    ...toEnrichmentPayload(row),
    section: "bookedJobs" as const,
    prior: stringCell(row.prior),
    book_date: stringCell(row.book_date),
  };
}

function looksLikeFormLead(row: GranotCsvDataRow): boolean {
  const refNo = cleanValue(String(row.ref_no ?? ""));
  return Boolean(refNo && mongoose.isValidObjectId(refNo));
}

function mapCallStatus(status: string): GranotCrmCsvRowOutcome["status"] {
  switch (status) {
    case "updated":
      return "updated";
    case "unchanged":
    case "updateable":
      return "unchanged";
    case "invalid":
      return "invalid";
    case "conflict":
      return "conflict";
    case "no_match":
    case "booking_missing":
      return "no_match";
    case "failed":
      return "failed";
    default:
      return "skipped";
  }
}

function countOutcomes(outcomes: GranotCrmCsvRowOutcome[]) {
  const counts = {
    updated: 0,
    unchanged: 0,
    skipped: 0,
    invalid: 0,
    no_match: 0,
    conflict: 0,
    duplicate: 0,
    failed: 0,
  };
  for (const outcome of outcomes) {
    counts[outcome.status] += 1;
  }
  return counts;
}

function stringCell(value: unknown): string | undefined {
  return cleanValue(String(value ?? ""));
}

function parseNumber(value: unknown): number | undefined {
  const cleaned = stringCell(value);
  if (!cleaned) {
    return undefined;
  }
  const parsed = Number(cleaned.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}
