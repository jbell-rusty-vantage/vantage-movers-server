import type mongoose from "mongoose";
import { getCallInteractionModel } from "../../models/CallInteraction";
import { getContactNumberModel } from "../../models/ContactNumber";
import { getNumberLeadAttachmentModel } from "../../models/NumberLeadAttachment";
import { getOutreachRecordModel } from "../../models/OutreachRecord";
import { csiIdSchema } from "../../validation/v1/salesIntelligence";
import { ownerRead } from "./coverage";
import {
  numberDetailReadDtoSchema,
  numberSearchItemDtoSchema,
  type NumberDetailReadDto,
  type NumberRollupsDto,
  type NumberSearchItemDto,
} from "./dto";

/**
 * Contact Number reads (04 §1 `GET /numbers/:id`). Reads never mutate: no
 * upsert, no `$set`, no `save()`. Interactions are recounted with
 * `merged_into_id: null` because merge tombstones keep `contact_number_id`
 * after their rollup contribution was removed (CSI-02 handoff).
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
  rollups: {
    interactions_total: number;
    inbound_total: number;
    outbound_total: number;
    human_conversations_total: number;
    last_inbound_at: Date | null;
    last_outbound_at: Date | null;
    attached_lead_count: number;
    candidate_lead_count: number;
    open_outreach_count: number;
  };
  running_summary: {
    text: string;
    run_id: mongoose.Types.ObjectId;
    evidence_digest: string;
    computed_at: Date;
  } | null;
};

type AttachmentLean = {
  _id: mongoose.Types.ObjectId;
  revision: number;
  lead_ref: { model: "FormLead" | "CallLead"; id: mongoose.Types.ObjectId };
  state: "candidate" | "ambiguous" | "attached" | "rejected";
  certainty: "exact" | "likely" | "unsure" | "owner_confirmed" | "rejected";
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
    attached_lead_count: r.attached_lead_count ?? 0,
    candidate_lead_count: r.candidate_lead_count ?? 0,
    open_outreach_count: r.open_outreach_count ?? 0,
  };
}

/** Pure mapper shared with `search.ts`. `search_terms` is deliberately not copied. */
export function toNumberSearchItem(
  row: ContactNumberLean,
  match: NumberSearchItemDto["match"],
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
  });
}

/**
 * Number detail. `null` when the id is malformed or the row is missing.
 * `outreach_records`, `restrictions` and `review_items` are empty until Team C
 * publishes their read mappers; `connections` carries the counts meanwhile.
 */
export async function getContactNumberDetail(
  numberId: string,
  deps: { now?: () => Date } = {},
): Promise<NumberDetailReadDto | null> {
  if (!csiIdSchema.safeParse(numberId).success) return null;
  const row = (await getContactNumberModel()
    .findById(numberId)
    .lean()) as unknown as ContactNumberLean | null;
  if (!row) return null;

  const [attachments, outreach, recount] = await Promise.all([
    getNumberLeadAttachmentModel()
      .find({ contact_number_id: row._id })
      .sort({ createdAt: 1, _id: 1 })
      .lean() as unknown as Promise<AttachmentLean[]>,
    getOutreachRecordModel()
      .find(
        {
          $or: [
            { "subject.contact_number_id": row._id },
            { primary_contact_number_id: row._id },
          ],
        },
        { state: 1 },
      )
      .lean() as unknown as Promise<Array<{ state: string }>>,
    getCallInteractionModel().countDocuments({
      contact_number_id: row._id,
      merged_into_id: null,
    }),
  ]);

  const byState = (state: AttachmentLean["state"]) =>
    attachments.filter((a) => a.state === state).length;
  const id = String(row._id);

  const data = {
    id,
    revision: row.revision,
    e164: row.e164,
    classification: row.classification,
    eligibility: row.contact_eligibility?.state ?? "unknown",
    attachments: attachments.map((a) => ({
      id: String(a._id),
      revision: a.revision,
      lead_ref: { model: a.lead_ref.model, id: String(a.lead_ref.id) },
      state: a.state,
      certainty: a.certainty,
    })),
    outreach_records: [],
    running_analysis: row.running_summary
      ? {
          text: row.running_summary.text,
          run_id: String(row.running_summary.run_id),
          evidence_digest: row.running_summary.evidence_digest,
          computed_at: new Date(row.running_summary.computed_at).toISOString(),
        }
      : null,
    restrictions: [],
    review_items: [],
    allowed_actions: [
      {
        action: "rebuild_number",
        enabled: true,
        blocker_codes: [],
        target_id: id,
        expected_revision: row.revision,
      },
    ],
    kind: row.kind,
    national_ten: row.national_ten ?? null,
    provider_names: [...(row.provider_names ?? [])],
    search_terms: [...(row.search_terms ?? [])],
    first_observed_at: new Date(row.first_observed_at).toISOString(),
    last_activity_at: new Date(row.last_activity_at).toISOString(),
    rollups: toRollupsDto(row),
    connections: {
      attachments_total: attachments.length,
      attached: byState("attached"),
      candidate: byState("candidate"),
      ambiguous: byState("ambiguous"),
      rejected: byState("rejected"),
      outreach_records_total: outreach.length,
      open_outreach: outreach.filter((o) => o.state !== "closed").length,
      interactions_total_recount: recount,
    },
  };

  return numberDetailReadDtoSchema.parse(await ownerRead(data, deps.now));
}
