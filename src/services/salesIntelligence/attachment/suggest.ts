/** CSI-05 pure identity policy. No database, provider or model inference. */
export type LeadRef = { model: "FormLead" | "CallLead"; id: string };
export type Evidence = {
  source: "call_lead_ringcentral_identity" | "ringcentral_call_adoption" | "owner_attach" |
    "lead_phone_live" | "ingested_contact_snapshot" | "granot_contact_snapshot" | "ringcentral_original_caller" | "assignment_context";
  field_path: string; observed_at: Date; window_from: Date | null; window_to: Date | null;
  interaction_id?: string | null; provider_account_id?: string | null;
  identity_kind?: "telephony_session_id" | "session_id" | "call_log_id" | null; identity_value?: string | null;
};
export type Attachment = {
  lead_ref: LeadRef; state: "candidate" | "ambiguous" | "attached" | "rejected";
  certainty: "likely" | "unsure" | "exact" | "owner_confirmed" | "rejected";
  evidence: Evidence[]; decided_at?: Date | null;
};
export type InteractionIdentity = {
  id: string; provider_account_id: string; started_at: Date;
  telephony_session_id?: string | null; session_id?: string | null; call_log_ids: readonly string[];
};
export const exactSource = (source: string) => ["call_lead_ringcentral_identity", "ringcentral_call_adoption"].includes(source);
const phoneSource = (source: string) => ["lead_phone_live", "ingested_contact_snapshot", "granot_contact_snapshot", "ringcentral_original_caller"].includes(source);
export function leadWindow(model: LeadRef["model"], timestamp: Date) {
  const hour = 3_600_000;
  return { window_from: new Date(+timestamp - (model === "FormLead" ? 36 : 12) * hour),
    window_to: new Date(+timestamp + (model === "FormLead" ? 14 * 24 : 12) * hour) };
}
export function suggest(evidence: Evidence[], lead_ref: LeadRef): Attachment {
  const exact = evidence.some(e => exactSource(e.source));
  return { lead_ref, evidence, state: exact ? "attached" : "candidate", certainty: exact ? "exact" : "likely" };
}
const overlaps = (a: Evidence, b: Evidence) => a.window_from && a.window_to && b.window_from && b.window_to &&
  a.window_from <= b.window_to && b.window_from <= a.window_to;
/** Number-level chips may be Ambiguous; resolveAtInteraction always resolves the actual event. */
export function ambiguityFanIn(edges: readonly Attachment[]): Attachment[] {
  return edges.map(edge => {
    if (edge.state === "attached" || edge.state === "rejected" || edge.decided_at) return edge;
    const ambiguous = edges.some(other => other !== edge && other.state !== "rejected" &&
      (other.lead_ref.id !== edge.lead_ref.id || other.lead_ref.model !== edge.lead_ref.model) &&
      edge.evidence.some(a => !exactSource(a.source) && other.evidence.some(b => !exactSource(b.source) && overlaps(a, b))));
    return { ...edge, state: ambiguous ? "ambiguous" : "candidate", certainty: ambiguous ? "unsure" : "likely" };
  });
}
export const AUTO_ATTACH_REASON = "automatic_high_confidence";
const autoAttachSource = (e: Evidence) => ["lead_phone_live", "ringcentral_original_caller"].includes(e.source) && Boolean(e.window_from && e.window_to);
/** Automatic attach confidence, or null when the evidence is not genuinely unambiguous.
 * There is no tier below 0.90: an Owner decision, a rejected pair, a competing Attached edge
 * and anything `ambiguityFanIn` would call Ambiguous all stay Candidate. */
export function autoAttachConfidence(edge: Attachment, edges: readonly Attachment[]): number | null {
  if (edge.state === "rejected" || edge.decided_at) return null;
  if (edges.some(other => other !== edge && other.state === "attached")) return null;
  // Same identity comparison `ambiguityFanIn` uses, whether or not `edge` is a member of `edges`.
  if (ambiguityFanIn([edge, ...edges])[0]!.state === "ambiguous") return null;
  const sources = new Set(edge.evidence.filter(autoAttachSource).map(e => e.source));
  return sources.size === 0 ? null : sources.size >= 2 ? 0.95 : 0.9;
}
function exactApplies(e: Evidence, interaction: InteractionIdentity) {
  if (!exactSource(e.source) || e.provider_account_id !== interaction.provider_account_id) return false;
  if (e.interaction_id === interaction.id) return true;
  if (!e.identity_value) return false;
  return e.identity_kind === "call_log_id" ? interaction.call_log_ids.includes(e.identity_value) :
    e.identity_kind === "session_id" ? interaction.session_id === e.identity_value :
    e.identity_kind === "telephony_session_id" && interaction.telephony_session_id === e.identity_value;
}
export type AttachmentAttribution = {
  lead_ref: LeadRef | null; certainty: "exact" | "likely" | "unsure" | "owner_confirmed";
  certainty_label: "Exact" | "Likely" | "Unsure" | "Confirmed by you";
  lead_effects_allowed: boolean; blocked_reason: "ambiguous_attachment" | "competing_attached" | "unlinked" | null;
  applicable_leads: LeadRef[];
};
export const certaintyLabel = (certainty: Attachment["certainty"]) => ({ exact: "Exact", likely: "Likely", unsure: "Unsure", owner_confirmed: "Confirmed by you", rejected: "Unsure" })[certainty] as AttachmentAttribution["certainty_label"];
export function resolveAtInteraction(edges: readonly Attachment[], interaction: InteractionIdentity): AttachmentAttribution {
  const applicable = edges.filter(e => e.state !== "rejected").flatMap(edge => {
    const exact = !edge.decided_at && edge.evidence.some(e => exactApplies(e, interaction));
    const owner = edge.certainty === "owner_confirmed" && edge.evidence.some(e => e.source === "owner_attach" &&
      e.window_from && e.window_to && e.window_from <= interaction.started_at && e.window_to >= interaction.started_at);
    const phone = edge.evidence.some(e => phoneSource(e.source) &&
      e.window_from && e.window_to && e.window_from <= interaction.started_at && e.window_to >= interaction.started_at);
    if (!exact && !owner && !phone) return [];
    // An exact edge is only Attached for its pinned interaction. Later phone evidence is Likely.
    const certainty = owner ? "owner_confirmed" as const : exact ? "exact" as const : "likely" as const;
    const windowAttached = edge.state === "attached" && phone && !edge.evidence.some(e => exactSource(e.source));
    return [{ edge, certainty, attached: owner || exact || windowAttached }];
  });
  const attached = applicable.filter(a => a.attached);
  const selected = attached.length ? attached : applicable;
  const unique = selected.length === 1 ? selected[0]! : null;
  const certainty = unique?.certainty ?? "unsure";
  return { lead_ref: unique?.edge.lead_ref ?? null, certainty, certainty_label: certaintyLabel(certainty),
    lead_effects_allowed: Boolean(unique), applicable_leads: selected.map(a => a.edge.lead_ref),
    blocked_reason: unique ? null : selected.length ? attached.length > 1 ? "competing_attached" : "ambiguous_attachment" : "unlinked" };
}
