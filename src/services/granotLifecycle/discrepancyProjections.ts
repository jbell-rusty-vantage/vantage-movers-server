import { getGranotBookingDiscrepancyModel } from "../../models/GranotBookingDiscrepancy";
import { getGranotReleaseDiscrepancyModel } from "../../models/GranotReleaseDiscrepancy";
import type { GranotDiscrepancyDocument } from "../../models/granotDiscrepancyModel";
import { getGranotRecordLinkModel } from "../../models/GranotRecordLink";
import { getSynchronizationDecisionModel } from "../../models/SynchronizationDecision";
import { toObjectId } from "../../utils/objectId";
import type { GranotLifecycleDiscrepancyListQuery } from "../../validation/v1/granotLifecycle.validation";
import { searchBookingLeadCandidates, type BookingLeadCandidateProjection } from "./bookingReconciliation";
import { GRANOT_LIFECYCLE_ERROR_CODES, GranotLifecycleError } from "./errors";
import type { EntityRef } from "./types";

export type GranotDiscrepancyListItem = {
  discrepancy_id: string;
  kind: "booking" | "release";
  state: "open" | "resolved";
  reason_code: string;
  normalized_job_no: string;
  masked_contact_label: "Contact masked";
  evidence_count: number;
  revision: number;
  evidence_revision: number;
  opened_at: string;
  last_evidence_at: string;
  resolved_at?: string;
};

export type GranotDiscrepancyDetail = GranotDiscrepancyListItem & {
  reason_fingerprint: string;
  record_link?: {
    id: string; state: "active" | "superseded"; disputed: boolean; domain_revision: number;
    lead_ref?: EntityRef; booking_ref?: string;
  };
  lead_ref?: EntityRef;
  booking_id?: string;
  cancellation_id?: string;
  evidence: Array<{ observation_id: string; decision_id: string; captured_at: string; action: "priority_5" | "booked" | "release" }>;
  candidates: BookingLeadCandidateProjection[];
  resolution?: { outcome: "re_evaluated" | "record_link_corrected" | "no_action"; resolved_at: string; reason_code?: string; reason_text?: string };
  capabilities: { re_evaluate: boolean; correct_record_link: boolean; no_action: boolean };
};

type Cursor = { value: string; id: string };

export async function listGranotLifecycleDiscrepancies(query: GranotLifecycleDiscrepancyListQuery) {
  const filter: Record<string, unknown> = {};
  if (query.state) filter.state = query.state;
  if (query.reason_code) filter.reason_code = query.reason_code;
  if (query.normalized_job_no) filter.normalized_job_no = query.normalized_job_no;
  if (query.source_id) {
    const decisionIds = await getSynchronizationDecisionModel().distinct("_id", {
      "source_scope.granot_crm_source_id": toObjectId(query.source_id),
    });
    filter["evidence.decision_id"] = { $in: decisionIds };
  }
  if (query.opened_from || query.opened_to) filter.opened_at = {
    ...(query.opened_from ? { $gte: new Date(query.opened_from) } : {}),
    ...(query.opened_to ? { $lte: new Date(query.opened_to) } : {}),
  };
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  const sortField = query.sort ?? "last_evidence_at";
  const direction = (query.order ?? "desc") === "asc" ? 1 : -1;
  if (cursor) filter.$or = [
    { [sortField]: direction === 1 ? { $gt: new Date(cursor.value) } : { $lt: new Date(cursor.value) } },
    { [sortField]: new Date(cursor.value), _id: direction === 1 ? { $gt: cursor.id } : { $lt: cursor.id } },
  ];
  const models = query.kind === "booking" ? [["booking", getGranotBookingDiscrepancyModel()]] as const
    : query.kind === "release" ? [["release", getGranotReleaseDiscrepancyModel()]] as const
    : [["booking", getGranotBookingDiscrepancyModel()], ["release", getGranotReleaseDiscrepancyModel()]] as const;
  const rows = (await Promise.all(models.map(async ([kind, model]) =>
    (await model.find(filter).sort({ [sortField]: direction, _id: direction }).limit(query.limit + 1).lean().exec())
      .map((row) => ({ kind, row: row as GranotDiscrepancyDocument })),
  ))).flat().sort((a, b) => {
    const delta = new Date(a.row[sortField]).getTime() - new Date(b.row[sortField]).getTime();
    return direction * (delta || String(a.row._id).localeCompare(String(b.row._id)));
  });
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map(({ kind, row }) => listItem(kind, row)),
    next_cursor: rows.length > query.limit && last ? encodeCursor({ value: new Date(last.row[sortField]).toISOString(), id: String(last.row._id) }) : null,
  };
}

export async function getGranotLifecycleDiscrepancyDetail(id: string): Promise<GranotDiscrepancyDetail> {
  const booking = await getGranotBookingDiscrepancyModel().findById(id).lean().exec();
  const kind = booking ? "booking" as const : "release" as const;
  const row = (booking ?? await getGranotReleaseDiscrepancyModel().findById(id).lean().exec()) as GranotDiscrepancyDocument | null;
  if (!row) throw new GranotLifecycleError("Granot discrepancy not found", GRANOT_LIFECYCLE_ERROR_CODES.DISCREPANCY_NOT_FOUND, 404);
  const link = row.record_link_id ? await getGranotRecordLinkModel().findById(row.record_link_id).lean().exec() : null;
  const canCorrect = row.state === "open" && Boolean(link?.state === "active" && link.disputed) && !["booked_after_official_cancellation", "release_without_vantage_booking"].includes(row.reason_code);
  const newest = row.evidence.at(-1);
  const candidates = canCorrect && newest
    ? await searchBookingLeadCandidates({ observation_id: String(newest.observation_id), opened_at: row.opened_at })
    : [];
  return {
    ...listItem(kind, row), reason_fingerprint: row.reason_fingerprint,
    ...(row.lead_ref ? { lead_ref: { model: row.lead_ref.model, id: String(row.lead_ref.id) } } : {}),
    ...(row.booking_id ? { booking_id: String(row.booking_id) } : {}),
    ...(row.cancellation_id ? { cancellation_id: String(row.cancellation_id) } : {}),
    ...(link ? { record_link: { id: String(link._id), state: link.state, disputed: link.disputed, domain_revision: link.domain_revision,
      ...(link.lead_ref ? { lead_ref: { model: link.lead_ref.model, id: String(link.lead_ref.id) } } : {}),
      ...(link.booking_ref ? { booking_ref: String(link.booking_ref) } : {}) } } : {}),
    evidence: row.evidence.map((item) => ({ observation_id: String(item.observation_id), decision_id: String(item.decision_id), captured_at: item.captured_at.toISOString(), action: item.action })),
    candidates,
    ...(row.resolution ? { resolution: { outcome: row.resolution.outcome, resolved_at: row.resolution.resolved_at.toISOString(), ...(row.resolution.reason_code ? { reason_code: row.resolution.reason_code } : {}), ...(row.resolution.reason_text ? { reason_text: row.resolution.reason_text } : {}) } } : {}),
    capabilities: { re_evaluate: row.state === "open", correct_record_link: canCorrect, no_action: row.state === "open" },
  };
}

function listItem(kind: "booking" | "release", row: GranotDiscrepancyDocument): GranotDiscrepancyListItem {
  return { discrepancy_id: String(row._id), kind, state: row.state, reason_code: row.reason_code, normalized_job_no: row.normalized_job_no,
    masked_contact_label: "Contact masked", evidence_count: row.evidence.length, revision: row.revision, evidence_revision: row.evidence_revision,
    opened_at: row.opened_at.toISOString(), last_evidence_at: row.last_evidence_at.toISOString(),
    ...(row.resolution ? { resolved_at: row.resolution.resolved_at.toISOString() } : {}) };
}

function encodeCursor(cursor: Cursor) { return Buffer.from(JSON.stringify(cursor)).toString("base64url"); }
function decodeCursor(value: string): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Cursor;
    if (!parsed.value || !parsed.id) throw new Error();
    return parsed;
  } catch {
    throw new GranotLifecycleError("Invalid discrepancy cursor", GRANOT_LIFECYCLE_ERROR_CODES.VALIDATION_FAILED, 400);
  }
}
