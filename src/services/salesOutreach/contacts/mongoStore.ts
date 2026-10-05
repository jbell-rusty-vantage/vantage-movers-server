import mongoose, { type ClientSession } from "mongoose";
import { getCallInteractionModel } from "../../../models/CallInteraction";
import { getContactNumberModel } from "../../../models/ContactNumber";
import { getNumberLeadAttachmentModel } from "../../../models/NumberLeadAttachment";
import { getRepIdentityLinkModel } from "../../../models/RepIdentityLink";
import { getSalesIntelligenceContactRestrictionModel } from "../../../models/SalesIntelligenceContactRestriction";
import {
  getSalesOutreachContactEventModel,
  getSalesOutreachPolicyPeriodModel,
  getSalesOutreachSubjectModel,
} from "../../../models/salesOutreach";
import { getRingCentralRepSmsEvidenceModel } from "../../../models/salesOutreach/repSmsEvidence";
import type { SalesOutreachWorkflow } from "../../../config/domain/salesOutreach";
import type { RepSmsStatus } from "../../../config/domain/ringcentralRepSms";
import type { TemporalRepLink } from "../../salesIntelligence/repIdentity/resolve";
import { enqueueCsiJob } from "../../salesIntelligence/jobs";
import type { ContactEventStore, StoredContactEvent } from "./apply";
import type { CallSourceRow, DeskLeadKey, RestrictionInterval, SmsSourceRow, SubjectFacts } from "./derive";

/**
 * Mongo side of the contact-event derivation. Every read is bounded by the page of sources and uses an
 * existing index:
 * - `call_interactions` by `_id`; `ringcentral_rep_sms_evidence` by `_id` and `sod_rsms_logical`;
 * - `rep_identity_links` by `ril_extension_current_unique` prefix `{rc_account_id, rc_extension_id}`;
 * - `number_lead_attachments` by `nla_number_state`; `contact_numbers` by `contact_number_e164_unique`;
 * - `sales_outreach_subjects` by `sod_subject_lead_unique`; periods by `sod_period_subject_started`;
 * - `sales_intelligence_contact_restrictions` by `csi_restriction_number`;
 * - `sales_outreach_contact_events` by `_id`.
 */

const oid = (id: string) => new mongoose.Types.ObjectId(id);
const str = (value: unknown) => (value === null || value === undefined ? null : String(value));

type CallLean = {
  _id: unknown;
  provider_account_id: string;
  direction: CallSourceRow["direction"];
  contact_number_id?: unknown;
  external_endpoint_kind?: string | null;
  started_at: Date;
  answered_at?: Date | null;
  provider_connected?: boolean;
  provider_result?: string | null;
  contact_type?: string;
  parties?: Array<{ role: string; direction?: string | null; extension_id?: string | null; connected?: boolean; answered_at?: Date | null }>;
  legs?: Array<{ leg_type?: string | null; direction?: string | null; result?: string | null; start_time?: Date | null; extension_id?: string | null }>;
  call_log_state?: CallSourceRow["call_log_state"];
  terminal?: boolean;
  merged_into_id?: unknown;
  purged_at?: Date | null;
  projection_revision?: number;
};

export const CALL_SOURCE_PROJECTION = {
  provider_account_id: 1,
  direction: 1,
  contact_number_id: 1,
  external_endpoint_kind: 1,
  started_at: 1,
  answered_at: 1,
  provider_connected: 1,
  provider_result: 1,
  contact_type: 1,
  parties: 1,
  legs: 1,
  call_log_state: 1,
  terminal: 1,
  merged_into_id: 1,
  purged_at: 1,
  projection_revision: 1,
} as const;

export function toCallSourceRow(row: CallLean): CallSourceRow {
  return {
    id: String(row._id),
    provider_account_id: row.provider_account_id,
    direction: row.direction,
    contact_number_id: str(row.contact_number_id),
    external_endpoint_kind: row.external_endpoint_kind ?? null,
    started_at: row.started_at,
    answered_at: row.answered_at ?? null,
    provider_connected: row.provider_connected ?? false,
    provider_result: row.provider_result ?? null,
    contact_type: row.contact_type ?? "unknown",
    parties: (row.parties ?? []).map((p) => ({
      role: p.role,
      direction: p.direction ?? null,
      extension_id: p.extension_id ?? null,
      connected: p.connected ?? false,
      answered_at: p.answered_at ?? null,
    })),
    legs: (row.legs ?? []).map((l) => ({
      leg_type: l.leg_type ?? null,
      direction: l.direction ?? null,
      result: l.result ?? null,
      start_time: l.start_time ?? null,
      extension_id: l.extension_id ?? null,
    })),
    call_log_state: row.call_log_state ?? null,
    terminal: row.terminal ?? false,
    merged_into_id: str(row.merged_into_id),
    purged_at: row.purged_at ?? null,
    projection_revision: row.projection_revision ?? 1,
  };
}

type SmsLean = {
  _id: unknown;
  canonical_logical_id: string;
  direction: "inbound" | "outbound";
  status: RepSmsStatus;
  send_at?: Date | null;
  provider_created_at: Date;
  counterpart_numbers?: string[];
  is_group?: boolean;
  reviewed_rep_ref?: { agent_id: unknown } | null;
  identity_state: "reviewed" | "pending_identity";
  source_revision?: number;
};

const SMS_PROJECTION = {
  canonical_logical_id: 1,
  direction: 1,
  status: 1,
  send_at: 1,
  provider_created_at: 1,
  counterpart_numbers: 1,
  is_group: 1,
  reviewed_rep_ref: 1,
  identity_state: 1,
  source_revision: 1,
} as const;

const LEAD_MODELS = ["FormLead", "CallLead"] as const;

export const mongoContactEventStore: ContactEventStore = {
  async loadCalls(ids, session) {
    const rows = await getCallInteractionModel().find({ _id: { $in: ids.map(oid) } }, CALL_SOURCE_PROJECTION).session(session).lean();
    return (rows as unknown as CallLean[]).map(toCallSourceRow);
  },

  async loadSms(ids, session) {
    const Model = getRingCentralRepSmsEvidenceModel();
    const rows = (await Model.find({ _id: { $in: ids.map(oid) } }, SMS_PROJECTION).session(session).lean()) as unknown as SmsLean[];
    const logical = [...new Set(rows.map((row) => row.canonical_logical_id))];
    // The canonical copy of a logical message is its lowest `_id` across mailboxes.
    const firsts = logical.length
      ? ((await Model.aggregate([
          { $match: { canonical_logical_id: { $in: logical } } },
          { $sort: { canonical_logical_id: 1, _id: 1 } },
          { $group: { _id: "$canonical_logical_id", first: { $first: "$_id" } } },
        ]).session(session)) as Array<{ _id: string; first: unknown }>)
      : [];
    const canonical = new Map(firsts.map((row) => [row._id, String(row.first)]));
    return rows.map(
      (row): SmsSourceRow => ({
        id: String(row._id),
        canonical_logical_id: row.canonical_logical_id,
        direction: row.direction,
        status: row.status,
        send_at: row.send_at ?? null,
        provider_created_at: row.provider_created_at,
        counterpart_numbers: row.counterpart_numbers ?? [],
        is_group: row.is_group ?? false,
        reviewed_agent_id: str(row.reviewed_rep_ref?.agent_id),
        identity_state: row.identity_state,
        source_revision: row.source_revision ?? 1,
        duplicate_copy: (canonical.get(row.canonical_logical_id) ?? String(row._id)) !== String(row._id),
      }),
    );
  },

  async loadContext(request, session) {
    const byAccount = new Map<string, string[]>();
    for (const { account, extension } of request.account_extensions) byAccount.set(account, [...(byAccount.get(account) ?? []), extension]);
    const links: TemporalRepLink[] = [];
    for (const [account, extensions] of byAccount) {
      const rows = await getRepIdentityLinkModel()
        .find({ rc_account_id: account, rc_extension_id: { $in: extensions } })
        .session(session)
        .lean();
      links.push(...(rows as unknown as TemporalRepLink[]));
    }

    const numbersByE164 = new Map<string, string>();
    if (request.e164s.length) {
      const numbers = await getContactNumberModel().find({ e164: { $in: [...request.e164s] } }, { e164: 1 }).session(session).lean();
      for (const row of numbers as Array<{ _id: unknown; e164?: string | null }>) if (row.e164) numbersByE164.set(row.e164, String(row._id));
    }
    const numberIds = [...new Set([...request.number_ids, ...numbersByE164.values()])];

    const attached = new Map<string, DeskLeadKey[]>();
    const restrictions = new Map<string, RestrictionInterval[]>();
    const subjects = new Map<DeskLeadKey, SubjectFacts>();
    if (numberIds.length) {
      const attachments = await getNumberLeadAttachmentModel()
        .find({ contact_number_id: { $in: numberIds.map(oid) }, state: "attached", certainty: { $ne: "rejected" } }, { contact_number_id: 1, lead_ref: 1 })
        .session(session)
        .lean();
      for (const row of attachments as Array<{ contact_number_id: unknown; lead_ref: { model: string; id: unknown } }>) {
        const key = `${row.lead_ref.model}:${String(row.lead_ref.id)}` as DeskLeadKey;
        const list = attached.get(String(row.contact_number_id)) ?? [];
        if (!list.includes(key)) list.push(key);
        attached.set(String(row.contact_number_id), list);
      }
      const restrictionRows = await getSalesIntelligenceContactRestrictionModel()
        .find({ contact_number_id: { $in: numberIds.map(oid) } }, { contact_number_id: 1, channels: 1, until: 1, resolved_at: 1, createdAt: 1 })
        .session(session)
        .lean();
      for (const row of restrictionRows as Array<{ contact_number_id: unknown; channels: Array<"call" | "text">; until?: Date | null; resolved_at?: Date | null; createdAt?: Date }>) {
        if (!row.createdAt) continue;
        const ends = [row.until, row.resolved_at].filter((d): d is Date => d instanceof Date);
        const to = ends.length ? new Date(Math.min(...ends.map((d) => d.getTime()))) : null;
        const list = restrictions.get(String(row.contact_number_id)) ?? [];
        list.push({ channels: row.channels, from: row.createdAt, to });
        restrictions.set(String(row.contact_number_id), list);
      }
      const leads = [...new Set([...attached.values()].flat())];
      if (leads.length) {
        const or = LEAD_MODELS.flatMap((model) => {
          const ids = leads.filter((key) => key.startsWith(`${model}:`)).map((key) => oid(key.slice(model.length + 1)));
          return ids.length ? [{ lead_model: model, lead_id: { $in: ids } }] : [];
        });
        const subjectRows = (await getSalesOutreachSubjectModel()
          .find({ $or: or }, { lead_model: 1, lead_id: 1, revision: 1, "enrollment.activation_at": 1 })
          .session(session)
          .lean()) as unknown as Array<{ _id: unknown; lead_model: string; lead_id: unknown; revision: number; enrollment: { activation_at: Date } }>;
        const periods = subjectRows.length
          ? ((await getSalesOutreachPolicyPeriodModel()
              .find({ subject_id: { $in: subjectRows.map((row) => oid(String(row._id))) } }, { subject_id: 1, workflow: 1, started_at: 1, ended_at: 1 })
              .session(session)
              .lean()) as unknown as Array<{ subject_id: unknown; workflow: SalesOutreachWorkflow; started_at: Date; ended_at?: Date | null }>)
          : [];
        for (const row of subjectRows) {
          subjects.set(`${row.lead_model}:${String(row.lead_id)}` as DeskLeadKey, {
            id: String(row._id),
            revision: row.revision,
            activation_at: row.enrollment.activation_at,
            periods: periods
              .filter((p) => String(p.subject_id) === String(row._id))
              .map((p) => ({ workflow: p.workflow, started_at: p.started_at, ended_at: p.ended_at ?? null })),
          });
        }
      }
    }
    return { links, attached_leads: attached, subjects, restrictions, numbers_by_e164: numbersByE164 };
  },

  async loadEvents(ids, session) {
    const rows = await getSalesOutreachContactEventModel()
      .find({ _id: { $in: ids.map(oid) } }, { subject_id: 1, goal_agent_id: 1, business_date: 1, input_fingerprint: 1, revision: 1 })
      .session(session)
      .lean();
    return new Map(
      (rows as unknown as Array<{ _id: unknown; subject_id?: unknown; goal_agent_id?: unknown; business_date: string; input_fingerprint: string; revision: number }>).map(
        (row): [string, StoredContactEvent] => [
          String(row._id),
          {
            id: String(row._id),
            subject_id: str(row.subject_id),
            goal_agent_id: str(row.goal_agent_id),
            business_date: row.business_date,
            input_fingerprint: row.input_fingerprint,
            revision: row.revision,
          },
        ],
      ),
    );
  },

  async writeEvent(id, draft, previous, now, session) {
    const revision = (previous?.revision ?? 0) + 1;
    const fields = {
      ...draft,
      source_id: oid(draft.source_id),
      subject_id: draft.subject_id ? oid(draft.subject_id) : null,
      actor_agent_id: draft.actor_agent_id ? oid(draft.actor_agent_id) : null,
      goal_agent_id: draft.goal_agent_id ? oid(draft.goal_agent_id) : null,
      revision,
    };
    const Model = getSalesOutreachContactEventModel();
    if (previous) {
      // CAS on the revision read in this transaction: a concurrent writer aborts one of us.
      const result = await Model.updateOne({ _id: oid(id), revision: previous.revision }, { $set: { ...fields, updatedAt: now } }, { session, runValidators: true, timestamps: false });
      if (result.matchedCount !== 1) throw Object.assign(new Error("contact event revision moved"), { name: "ContactEventConflict" });
    } else {
      await (Model as unknown as mongoose.Model<Record<string, unknown>>).create([{ _id: oid(id), ...fields, createdAt: now, updatedAt: now }], { session, timestamps: false });
    }
    return revision;
  },

  async subjectRevisions(ids, session) {
    const rows = await getSalesOutreachSubjectModel().find({ _id: { $in: ids.map(oid) } }, { revision: 1 }).session(session).lean();
    return new Map((rows as Array<{ _id: unknown; revision: number }>).map((row) => [String(row._id), row.revision]));
  },

  async enqueue(job, session, now) {
    const row = await enqueueCsiJob(job, session, now);
    return { job_id: String(row._id), created: (row as { createdAt?: Date }).createdAt?.getTime() === now.getTime() };
  },
};
