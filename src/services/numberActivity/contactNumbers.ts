import type mongoose from "mongoose";
import { getCallInteractionModel } from "../../models/CallInteraction";
import { getContactNumberModel, resolveCreatedVia, type ContactNumberCreatedVia } from "../../models/ContactNumber";
import { getNumberLeadAttachmentModel } from "../../models/NumberLeadAttachment";
import { getSalesIntelligenceContactRestrictionModel } from "../../models/SalesIntelligenceContactRestriction";
import { csiIdSchema } from "../../validation/v1/salesIntelligence";
import { csiFlag } from "../../config/domain/salesIntelligence";
import { ownerRead, readCaptureCoverage } from "./coverage";
import { loadAttachedLeadForEdges } from "./leadContext";
import {
  numberDetailReadDtoSchema,
  numberSearchItemDtoSchema,
  type NumberAttachedLeadDto,
  type NumberDetailReadDto,
  type NumberRollupsDto,
  type NumberSearchItemDto,
} from "./dto";

/**
 * Contact Number reads (`GET /numbers/:id`). Reads never mutate: no upsert,
 * no `$set`, no `save()`. Interactions are recounted with `merged_into_id: null`
 * because merge tombstones keep `contact_number_id` after their rollup
 * contribution was removed. Every source is a retained deterministic
 * collection: Contact Numbers, Call Interactions, attachments, the canonical
 * Lead/Booking/Cancellation rows and contact restrictions.
 */
export type ContactNumberLean = {
  _id: mongoose.Types.ObjectId;
  revision: number;
  e164: string;
  national_ten: string | null;
  digits_reversed: string;
  kind: NumberSearchItemDto["kind"];
  classification: NumberSearchItemDto["classification"];
  contact_eligibility: { state: NumberSearchItemDto["eligibility"] };
  provider_names: string[];
  search_terms: string[];
  first_observed_at: Date;
  last_activity_at: Date;
  /** G7: absent or null on call-created and historical rows (= `call`). */
  created_via?: ContactNumberCreatedVia | null;
  rollups: {
    interactions_total: number;
    inbound_total: number;
    outbound_total: number;
    human_conversations_total: number;
    last_inbound_at: Date | null;
    last_outbound_at: Date | null;
    last_human_conversation_at?: Date | null;
    attached_lead_count: number;
    candidate_lead_count: number;
    /** Missing on rows written before the rollup existed. */
    recordings_total?: number;
  };
};

type AttachmentLean = {
  _id: mongoose.Types.ObjectId;
  revision: number;
  lead_ref: { model: "FormLead" | "CallLead"; id: mongoose.Types.ObjectId };
  state: "candidate" | "ambiguous" | "attached" | "rejected";
  certainty: "exact" | "likely" | "unsure" | "owner_confirmed" | "rejected";
  lead_snapshot?: { name?: string | null; job_no?: string | null } | null;
  decided_at?: Date | null;
  decided_by?: string | null;
  decision_reason?: string | null;
};

type RestrictionLean = {
  _id: mongoose.Types.ObjectId;
  revision: number;
  channels: Array<"call" | "text">;
  until?: Date | null;
  origin: "owner" | "intelligence";
  state: "active" | "expired" | "resolved";
};

const iso = (value: Date | null | undefined): string | null =>
  value ? new Date(value).toISOString() : null;

export function toRollupsDto(row: ContactNumberLean): NumberRollupsDto {
  const r = row.rollups;
  return {
    interactions_total: r.interactions_total ?? 0,
    inbound_total: r.inbound_total ?? 0,
    outbound_total: r.outbound_total ?? 0,
    human_conversations_total: r.human_conversations_total ?? 0,
    last_inbound_at: iso(r.last_inbound_at),
    last_outbound_at: iso(r.last_outbound_at),
    last_human_conversation_at: iso(r.last_human_conversation_at),
    attached_lead_count: r.attached_lead_count ?? 0,
    candidate_lead_count: r.candidate_lead_count ?? 0,
    recordings_total: r.recordings_total ?? 0,
  };
}

/**
 * Pure mapper for one Numbers row. `search_terms` is deliberately not copied.
 * `attached` is the page-batched Lead context for this Number (`leadContext.ts`).
 */
export function toNumberSearchItem(
  row: ContactNumberLean,
  match: NumberSearchItemDto["match"],
  attached: NumberAttachedLeadDto,
): NumberSearchItemDto {
  const rollups = toRollupsDto(row);
  return numberSearchItemDtoSchema.parse({
    id: String(row._id),
    revision: row.revision,
    e164: row.e164,
    national_ten: row.national_ten ?? null,
    kind: row.kind,
    classification: row.classification,
    eligibility: row.contact_eligibility?.state ?? "unknown",
    provider_names: [...(row.provider_names ?? [])],
    first_observed_at: new Date(row.first_observed_at).toISOString(),
    last_activity_at: new Date(row.last_activity_at).toISOString(),
    rollups,
    linked: rollups.attached_lead_count > 0 || rollups.candidate_lead_count > 0,
    match,
    attached_lead: attached,
    created_via: resolveCreatedVia(row.created_via),
    has_calls: rollups.interactions_total > 0,
  });
}

/**
 * Number detail. `null` when the id is malformed or the row is missing. The
 * Number, its attachment edges and its restrictions are each read once; the
 * attached Lead reuses the edges, and coverage is resolved once for the response.
 */
export async function getContactNumberDetail(
  numberId: string,
  deps: { now?: () => Date } = {},
): Promise<NumberDetailReadDto | null> {
  if (!csiIdSchema.safeParse(numberId).success) return null;
  const row = (await getContactNumberModel()
    .findOne({ _id: numberId, purged_at: null })
    .lean()) as unknown as ContactNumberLean | null;
  if (!row) return null;
  const now = deps.now?.() ?? new Date();

  const [attachments, recount, restrictions, coverage] = await Promise.all([
    getNumberLeadAttachmentModel()
      .find({ contact_number_id: row._id })
      .sort({ createdAt: 1, _id: 1 })
      .lean() as unknown as Promise<AttachmentLean[]>,
    getCallInteractionModel().countDocuments({
      contact_number_id: row._id,
      merged_into_id: null,
    }),
    getSalesIntelligenceContactRestrictionModel()
      .find({ contact_number_id: row._id })
      .sort({ _id: 1 })
      .lean() as unknown as Promise<RestrictionLean[]>,
    readCaptureCoverage(),
  ]);
  const attached = await loadAttachedLeadForEdges(attachments);

  const byState = (state: AttachmentLean["state"]) =>
    attachments.filter((a) => a.state === state).length;
  const id = String(row._id);
  const attachEnabled = csiFlag("ENABLED") && csiFlag("ATTACHMENT_REFRESH");

  const data = {
    id,
    revision: row.revision,
    e164: row.e164,
    national_ten: row.national_ten ?? null,
    kind: row.kind,
    classification: row.classification,
    eligibility: row.contact_eligibility?.state ?? "unknown",
    provider_names: [...(row.provider_names ?? [])],
    search_terms: [...(row.search_terms ?? [])],
    first_observed_at: new Date(row.first_observed_at).toISOString(),
    last_activity_at: new Date(row.last_activity_at).toISOString(),
    created_via: resolveCreatedVia(row.created_via),
    has_calls: (row.rollups.interactions_total ?? 0) > 0,
    rollups: toRollupsDto(row),
    attached_lead: attached,
    attachments: attachments.map((a) => ({
      id: String(a._id),
      revision: a.revision,
      lead_ref: { model: a.lead_ref.model, id: String(a.lead_ref.id) },
      state: a.state,
      certainty: a.certainty,
      lead_display: a.lead_snapshot
        ? { name: a.lead_snapshot.name ?? null, job_no: a.lead_snapshot.job_no ?? null }
        : null,
      decided_at: iso(a.decided_at),
      decided_by: a.decided_by ?? null,
      decision_reason: a.decision_reason ?? null,
    })),
    restrictions: restrictions.map((r) => ({
      id: String(r._id),
      revision: r.revision,
      channels: [...r.channels],
      until: iso(r.until),
      origin: r.origin,
      state: r.state,
    })),
    connections: {
      attachments_total: attachments.length,
      attached: byState("attached"),
      candidate: byState("candidate"),
      ambiguous: byState("ambiguous"),
      rejected: byState("rejected"),
      interactions_total_recount: recount,
    },
    allowed_actions: [
      {
        action: "attach_lead",
        enabled: attachEnabled,
        blocker_codes: attachEnabled ? [] : ["FEATURE_DISABLED"],
        target_id: id,
        expected_revision: row.revision,
      },
      {
        action: "rebuild_number",
        enabled: true,
        blocker_codes: [],
        target_id: id,
        expected_revision: row.revision,
      },
    ],
  };

  return numberDetailReadDtoSchema.parse(await ownerRead(data, () => now, coverage));
}
