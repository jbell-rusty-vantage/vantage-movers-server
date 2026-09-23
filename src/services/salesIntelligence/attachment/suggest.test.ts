import assert from "node:assert/strict";
import { test } from "node:test";
import { ambiguityFanIn, AUTO_ATTACH_REASON, isAutoAttachReason, leadWindow, resolveAtInteraction, suggest, type Attachment, type Evidence } from "./suggest";
import { phoneEvidence } from "./sources";
const at = new Date("2026-09-01T12:00:00Z");
const phone = (timestamp = at): Evidence => ({ source: "ingested_contact_snapshot", field_path: "ingested_contact_snapshot.normalized_phone_number",
  observed_at: timestamp, ...leadWindow("FormLead", timestamp) });
const candidate = (id: string, timestamp = at) => suggest([phone(timestamp)], { model: "FormLead", id });
const interaction = { id: "i", started_at: at, provider_account_id: "account", telephony_session_id: "session", call_log_ids: ["log"] };
test("phone equality is Likely; exact session authorizes only that interaction and account", () => {
  const a = candidate("a");
  assert.equal(resolveAtInteraction([a], interaction).certainty_label, "Likely");
  const exact: Attachment = suggest([{ source: "call_lead_ringcentral_identity", field_path: "ringcentral.telephony_session_id", observed_at: at,
    window_from: null, window_to: null, provider_account_id: "account", identity_kind: "telephony_session_id", identity_value: "session" }, phone()], { model: "CallLead", id: "b" });
  assert.equal(resolveAtInteraction([a, exact], interaction).certainty_label, "Exact");
  assert.equal(resolveAtInteraction([a, exact], { ...interaction, telephony_session_id: "later" }).blocked_reason, "ambiguous_attachment");
  assert.equal(resolveAtInteraction([{ ...exact, evidence: exact.evidence.slice(0, 1) }], { ...interaction, provider_account_id: "other" }).lead_effects_allowed, false);
});
test("overlaps are ambiguous; nonoverlapping moves and outside-overlap events stay independent", () => {
  const edges = ambiguityFanIn([candidate("a"), candidate("b", new Date("2026-09-10T12:00:00Z")), candidate("c", new Date("2026-12-01T12:00:00Z"))]);
  assert.deepEqual(edges.map(e => e.state), ["ambiguous", "ambiguous", "candidate"]);
  assert.equal(resolveAtInteraction(edges, interaction).lead_ref?.id, "a");
  assert.equal(resolveAtInteraction(edges, { ...interaction, started_at: new Date("2026-09-11T12:00:00Z") }).lead_effects_allowed, false);
  assert.equal(resolveAtInteraction(edges, { ...interaction, started_at: new Date("2026-12-02T12:00:00Z") }).lead_ref?.id, "c");
});
test("unique current Attached outranks candidates; competing Attached blocks; reject and detach persist", () => {
  const owner = (id: string): Attachment => ({ ...candidate(id), state: "attached", certainty: "owner_confirmed", decided_at: at,
    evidence: [{ ...phone(), source: "owner_attach" }] });
  assert.equal(resolveAtInteraction([candidate("a"), owner("b")], interaction).certainty_label, "Confirmed by you");
  assert.equal(resolveAtInteraction([owner("a"), owner("b")], interaction).blocked_reason, "competing_attached");
  assert.equal(resolveAtInteraction([{ ...owner("a"), state: "rejected" }, candidate("b")], interaction).lead_ref?.id, "b");
  assert.equal(resolveAtInteraction([{ ...owner("a"), state: "candidate", certainty: "likely" }], interaction).lead_effects_allowed, false);
});
test("Form and Call windows include boundaries; later snapshots never backdate identity", () => {
  const form = leadWindow("FormLead", at), call = leadWindow("CallLead", at);
  assert.equal(+at - +form.window_from, 36 * 3600000); assert.equal(+form.window_to - +at, 14 * 86400000);
  assert.equal(+at - +call.window_from, 12 * 3600000); assert.equal(+call.window_to - +at, 12 * 3600000);
  const evidence = phoneEvidence({ _id: "a", timestamp: at, normalized_phone_number: "2025550101", createdAt: at,
    updatedAt: new Date("2026-09-03T12:00:00Z"), ingested_contact_snapshot: { normalized_phone_number: "2025550100", captured_at: at },
    granot_contact_snapshot: { phone_number: "(202) 555-0102", captured_at: new Date("2026-09-04T12:00:00Z") } }, "FormLead");
  assert.equal(evidence.length, 3);
  assert.equal(resolveAtInteraction([suggest([evidence[0]!.evidence], { model: "FormLead", id: "a" })], interaction).lead_effects_allowed, false);
  assert.equal(evidence[1]!.evidence.window_from?.toISOString(), form.window_from.toISOString());
  for (const time of [form.window_from, form.window_to]) assert.equal(resolveAtInteraction([candidate("a")], { ...interaction, started_at: time }).lead_effects_allowed, true);
});
const live = (timestamp = at): Evidence => ({ ...phone(timestamp), source: "lead_phone_live", field_path: "form_leads.normalized_phone_number" });
const edge = (id: string, ...evidence: Evidence[]) => suggest(evidence, { model: "FormLead", id });
test("H5 automatic reason is sole_non_duplicate_match; the pre-H5 reason stays recognised; exact stays exact", () => {
  assert.equal(AUTO_ATTACH_REASON, "sole_non_duplicate_match");
  assert.equal(isAutoAttachReason("sole_non_duplicate_match"), true);
  assert.equal(isAutoAttachReason("automatic_high_confidence"), true);
  assert.equal(isAutoAttachReason("Synthetic Owner evidence"), false);
  assert.equal(isAutoAttachReason(null), false);
  // Exact telephony identity keeps its own result and never becomes a Likely automatic attach.
  const exact = edge("a", { source: "ringcentral_call_adoption", field_path: "ringcentral.session_id", observed_at: at,
    window_from: null, window_to: null, provider_account_id: "account", identity_kind: "session_id", identity_value: "session" }, live());
  assert.equal(exact.state, "attached"); assert.equal(exact.certainty, "exact");
});
