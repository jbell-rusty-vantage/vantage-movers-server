import type { ClientSession } from "mongoose";
import { getFormLeadModel } from "../../../models/FormLead";
import { getCallLeadModel } from "../../../models/CallLead";
import { getCallInteractionModel } from "../../../models/CallInteraction";
import { toE164 } from "../../numberActivity/phone";
import { configuredRingCentralAccountId } from "../../numberActivity/accountIdentity";
import { payloadHash } from "../transactions";
import { jsonValue } from "../outreach/store";
import { leadWindow, type Evidence, type LeadRef } from "./suggest";
import { SOLE_MATCH_POLICY_VERSION } from "./matchSet";

type ContactSnapshot = { normalized_phone_number?: string | null; phone_number?: string | null; phone?: string | null; captured_at: Date };
export type LeadSource = {
  _id: { toString(): string }; timestamp: Date; updatedAt?: Date; createdAt?: Date;
  normalized_phone_number?: string | null; name?: string | null; job_no?: string | null;
  source_company_label_snapshot?: string | null; receiver_agent_name_snapshot?: string | null;
  booked?: unknown; cancelled?: unknown; duplicate?: boolean; bad_lead?: string | null; no_sync?: boolean; ingestion_origin?: string | null;
  ingested_contact_snapshot?: ContactSnapshot | null; granot_contact_snapshot?: ContactSnapshot | null;
  current_contact_provenance?: { changed_at: Date } | null;
  ringcentral?: { telephony_session_id?: string | null; session_id?: string | null; call_log_id?: string | null;
    original_caller?: ContactSnapshot | null } | null;
};
export async function loadLead(ref: LeadRef, session: ClientSession): Promise<LeadSource | null> {
  return ref.model === "FormLead" ? getFormLeadModel().findById(ref.id).session(session).lean() :
    getCallLeadModel().findById(ref.id).session(session).lean();
}
export function phoneEvidence(lead: LeadSource, model: LeadRef["model"]) {
  const window = leadWindow(model, lead.timestamp);
  const evidence: Array<{ e164: string; evidence: Evidence }> = [];
  const add = (value: string | null | undefined, source: Evidence["source"], field: string, at: Date, later: boolean) => {
    const e164 = toE164(value ?? "");
    if (!e164) return;
    const from = later && at > window.window_from ? at : window.window_from;
    if (from > window.window_to) return;
    evidence.push({ e164, evidence: { source, field_path: field, observed_at: at, window_from: from, window_to: window.window_to } });
  };
  // Mutable evidence starts when that contact was observed. It never backdates a later edit.
  const changed = lead.current_contact_provenance?.changed_at;
  const liveAt = changed ?? lead.updatedAt ?? lead.createdAt ?? lead.timestamp;
  add(lead.normalized_phone_number, "lead_phone_live", "normalized_phone_number", liveAt,
    Boolean(changed || (lead.createdAt && +liveAt > +lead.createdAt)));
  const ingested = lead.ingested_contact_snapshot;
  if (ingested) add(ingested.normalized_phone_number, "ingested_contact_snapshot", "ingested_contact_snapshot.normalized_phone_number", ingested.captured_at, false);
  const granot = lead.granot_contact_snapshot;
  if (granot) {
    const field = granot.normalized_phone_number ? "normalized_phone_number" : granot.phone_number ? "phone_number" : "phone";
    add(granot[field], "granot_contact_snapshot", `granot_contact_snapshot.${field}`, granot.captured_at, true);
  }
  const original = lead.ringcentral?.original_caller;
  if (original) add(original.normalized_phone_number, "ringcentral_original_caller", "ringcentral.original_caller.normalized_phone_number", original.captured_at, false);
  return evidence;
}
export async function exactEvidence(lead: LeadSource, model: LeadRef["model"], session: ClientSession) {
  const rc = lead.ringcentral;
  if (model !== "CallLead" || !rc) return [];
  const aliases = ["telephony_session_id", "session_id", "call_log_id"] as const;
  const clauses = aliases.filter(k => rc[k]).map(k => ({ [k === "call_log_id" ? "call_log_ids" : k]: rc[k] }));
  if (!clauses.length) return [];
  const account = configuredRingCentralAccountId();
  const rows = await getCallInteractionModel().find({ merged_into_id: null, $or: clauses,
    ...(account ? { provider_account_id: account } : {}) }).limit(501).session(session).lean();
  // Legacy Call Leads have no account column. Cross-account collisions cannot authorize identity.
  if (rows.length > 500 || new Set(rows.map(r => r.provider_account_id)).size > 1) return [];
  return rows.filter(r => r.contact_number_id).map(row => {
    const kind = aliases.find(k => rc[k] && (k === "call_log_id" ? row.call_log_ids.includes(rc[k]!) : row[k] === rc[k]))!;
    const evidence: Evidence = {
      source: lead.ingestion_origin === "granot_lead_created" ? "ringcentral_call_adoption" : "call_lead_ringcentral_identity",
      field_path: `ringcentral.${kind}`, observed_at: row.started_at, window_from: null, window_to: null,
      interaction_id: String(row._id), provider_account_id: row.provider_account_id, identity_kind: kind, identity_value: rc[kind]!,
    };
    return { number_id: String(row.contact_number_id), evidence };
  });
}
/**
 * Everything `persistLeadAttachments` can turn into a write for this Lead:
 * the phone paths `phoneEvidence` reads with their observation times, the
 * RingCentral aliases `exactEvidence` joins on, and the display snapshot.
 * `updatedAt` is deliberately absent, so a Lead edit that touches none of
 * these (a note, a CPL correction, a sheet-sync stamp) raises no job (17 §7).
 */
export function leadAttachmentFingerprint(lead: LeadSource): string {
  const contact = (snapshot: ContactSnapshot | null | undefined) => snapshot
    ? { normalized: snapshot.normalized_phone_number ?? null, phone: snapshot.phone_number ?? snapshot.phone ?? null, captured_at: snapshot.captured_at }
    : null;
  const { refreshed_at: _refreshed, ...display } = leadSnapshot(lead, new Date(0));
  return payloadHash(jsonValue({
    timestamp: lead.timestamp, created_at: lead.createdAt ?? null,
    // H5: No-Sync decides target eligibility; duplicate/bad_lead ride in `display`.
    no_sync: lead.no_sync === true,
    live: lead.normalized_phone_number ?? null, changed_at: lead.current_contact_provenance?.changed_at ?? null,
    ingested: contact(lead.ingested_contact_snapshot), granot: contact(lead.granot_contact_snapshot),
    original_caller: contact(lead.ringcentral?.original_caller), ingestion_origin: lead.ingestion_origin ?? null,
    ringcentral: lead.ringcentral ? { telephony_session_id: lead.ringcentral.telephony_session_id ?? null,
      session_id: lead.ringcentral.session_id ?? null, call_log_id: lead.ringcentral.call_log_id ?? null } : null,
    display,
  }));
}
/**
 * The one `attachment-lead:` job identity, shared by the watermark backstop and the Outreach
 * entity-change trigger. Keyed by policy version and identity fingerprint, never `updatedAt`.
 */
export function leadAttachmentJobInput(model: LeadRef["model"], id: string, lead: LeadSource) {
  const fingerprint = leadAttachmentFingerprint(lead);
  return { stage: "attachment_refresh" as const, subject_key: `attachment-lead:${model}:${id}`,
    dedupe_key: `csi:attachment-lead:${SOLE_MATCH_POLICY_VERSION}:${model}:${id}:${fingerprint}`,
    input_revision: parseInt(payloadHash(fingerprint).slice(0, 12), 16) + 1, input_refs: [id] };
}
export function leadSnapshot(lead: LeadSource, now: Date) {
  return { name: lead.name ?? null, job_no: lead.job_no ?? null, source_label: lead.source_company_label_snapshot ?? null,
    lead_timestamp: lead.timestamp, booked: Boolean(lead.booked), cancelled: Boolean(lead.cancelled),
    duplicate: Boolean(lead.duplicate), bad_lead: Boolean(lead.bad_lead), receiver_agent_name: lead.receiver_agent_name_snapshot ?? null, refreshed_at: now };
}
