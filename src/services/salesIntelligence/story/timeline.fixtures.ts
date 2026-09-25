/**
 * S4-TIMELINE fixture: deterministic documents (fixed ids, fixed times) for the timeline proofs B12,
 * B13, B15 and B22, as plain documents keyed by collection. The pure tests feed them to the in-memory
 * Mongo fake (`story/fakeMongo.fixtures.ts`); the replica seed (`ops/lib/si-timeline-seed.ts`)
 * inserts the same documents. Synthetic data only (555 numbers, fake names). Test-only.
 *
 * Subjects:
 *  - N1 "timeline": 2 attached Leads (Form A, Call B) + a rejected Lead C, 2 Outreach records, 130 calls,
 *    conversations (analyzed, recorded, standalone, one legacy without `contact_number_id`), 40 Lead
 *    Messages with `sent_at` up to 1 h before and 20 h after `createdAt`, 50 Lead changes (half paired
 *    with observations captured up to 23 h earlier), follow-ups in every status with audit-timed cancels,
 *    audit rows of every mapped kind (plus excluded and unmapped ones), assessments, a Booking with and
 *    one without `book_date`, a Cancellation, Owner corrections. Many rows share an instant.
 *  - N2 "measure": 50 calls plus a realistic mix of every other source (B15).
 *  - L "lead-only": a Form Lead with no Contact Number and its Outreach record.
 */
import mongoose from "mongoose";

/** The fixed `as_of` every proof reads at (after every seeded instant). */
export const S4_AS_OF = new Date("2026-09-23T12:00:00.000Z");
const T0 = Date.parse("2026-07-01T12:00:00.000Z");
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

const oidFor = (tag: string, n: number) => new mongoose.Types.ObjectId(`${tag}${n.toString(16).padStart(24 - tag.length, "0")}`);
const at = (ms: number) => new Date(T0 + ms);
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const S4_IDS = {
  n1: oidFor("a1", 1), n2: oidFor("a1", 2),
  leadA: oidFor("b1", 1), leadB: oidFor("b2", 2), leadC: oidFor("b1", 3), leadM: oidFor("b1", 4), leadL: oidFor("b1", 5),
  recordA: oidFor("c1", 1), recordB: oidFor("c1", 2), recordM: oidFor("c1", 3), recordL: oidFor("c1", 4),
  /** Paired / unpaired Priority changes asserted by B13. */
  pairedChange: oidFor("d1", 1), unpairedChange: oidFor("d1", 2), pairedObservation: oidFor("d2", 1),
  legacyConversation: oidFor("e9", 1), legacyCall: oidFor("e8", 1),
  bookingNoDate: oidFor("f1", 2), cancelledFollowupWithAudit: oidFor("f5", 1), cancelAudit: oidFor("f6", 1),
} as const;
export const S4_E164 = { n1: "+13055550101", n2: "+14075550102" } as const;
export const S4_CAPTURED_MS = 23 * HOUR;

/** Logical collection keys; the fake and the replica seed map them to the real collections. */
export const S4_COLLECTIONS = ["contactNumbers", "calls", "conversations", "messages", "observations", "attachments", "records", "followups", "audits",
  "artifacts", "instructions", "repLinks", "form_leads", "call_leads", "entity_changes", "booked_leads", "cancelled_leads"] as const;
export type S4Collection = (typeof S4_COLLECTIONS)[number];
export type S4Docs = Record<S4Collection, Record<string, unknown>[]>;

/** Every seeded document, keyed by logical collection. Pure and deterministic. */
export function buildS4TimelineDocs(): S4Docs {
  const rand = mulberry32(20260923);
  const out = Object.fromEntries(S4_COLLECTIONS.map(name => [name, [] as Record<string, unknown>[]])) as S4Docs;
  const insert = (name: S4Collection, docs: Record<string, unknown>[]) => { out[name].push(...docs); };
  const ids = S4_IDS;

  // ── Numbers ──
  insert("contactNumbers", [
    { _id: ids.n1, e164: S4_E164.n1, national_ten: "3055550101", digits_reversed: "1010555503", kind: "external", classification: "customer", provider_names: ["WIRELESS CALLER"],
      first_observed_at: at(0), last_activity_at: at(80 * DAY), revision: 1, purged_at: null, createdAt: at(0), updatedAt: at(80 * DAY) },
    { _id: ids.n2, e164: S4_E164.n2, national_ten: "4075550102", digits_reversed: "2010555704", kind: "external", classification: "customer", provider_names: [],
      first_observed_at: at(0), last_activity_at: at(80 * DAY), revision: 1, purged_at: null, createdAt: at(0), updatedAt: at(80 * DAY) },
  ]);

  // ── Leads ──
  const formLead = (_id: mongoose.Types.ObjectId, name: string, job: string, ms: number, phone: string | null) => ({
    _id, name, timestamp: at(ms), createdAt: at(ms + 3 * HOUR), updatedAt: at(ms + 3 * HOUR), normalized_phone_number: phone, source_company: "Top10",
    source_company_label_snapshot: "Top10 Movers", job_no: job, normalized_job_no: job, pickup_city: "Tampa", pickup_state: "FL", pickup_zip: "33601",
    delivery_city: "Raleigh", delivery_state: "NC", destination_zip: "27601", move_size: "2 Bedroom", move_date: new Date("2026-10-15T00:00:00Z"),
    ingestion_origin: "wordpress_form", quoted: false, receiver_agent_name_snapshot: "Dana Reyes" });
  insert("form_leads", [
    formLead(ids.leadA, "Maria Lopez", "5590101", 0, "3055550101"), formLead(ids.leadC, "Other Person", "5590103", 2 * DAY, "3055550101"),
    formLead(ids.leadM, "James Carter", "5590104", 0, "4075550102"), formLead(ids.leadL, "Priya Nair", "5590105", DAY, null),
  ]);
  insert("call_leads", [{ _id: ids.leadB, name: "Maria L", timestamp: at(5 * DAY), createdAt: at(5 * DAY + 2 * MIN),
    updatedAt: at(5 * DAY + 2 * MIN), normalized_phone_number: "3055550101", source_company: "Google Ads", source_company_label_snapshot: "Google Ads", job_no: "5590102",
    normalized_job_no: "5590102", ringcentral: { telephony_session_id: "s4-session-b", qualification_reason: "Answered inbound call over 60 seconds", start_time: at(5 * DAY - MIN),
      original_caller: { captured_at: at(5 * DAY - MIN) } } }]);

  // ── Attachments (history transitions, auto decision, a rejected edge) ──
  const edge = (n: number, number: mongoose.Types.ObjectId, model: string, lead: mongoose.Types.ObjectId, state: string, extra: Record<string, unknown>) => ({
    _id: oidFor("a2", n), contact_number_id: number, lead_ref: { model, id: lead }, state, certainty: "likely", evidence: [{ source: "lead_phone_live" }],
    lead_snapshot: { name: "Lead" }, createdAt: at(DAY), ...extra });
  insert("attachments", [
    edge(1, ids.n1, "FormLead", ids.leadA, "attached", { history: [{ from: "candidate", to: "ambiguous", at: at(DAY + HOUR), by: "automatic", reason: "two Leads share the phone" },
      { from: "ambiguous", to: "attached", at: at(3 * DAY), by: "owner@example.test", reason: "owner confirmed" }], certainty: "owner_confirmed", updatedAt: at(3 * DAY) }),
    edge(2, ids.n1, "CallLead", ids.leadB, "attached", { history: [], auto_decision: { confidence: 0.9, reason: "call lead identity", decided_at: at(5 * DAY + 5 * MIN) }, updatedAt: at(5 * DAY + 5 * MIN) }),
    edge(3, ids.n1, "FormLead", ids.leadC, "rejected", { history: [{ from: "candidate", to: "rejected", at: at(4 * DAY), by: "owner@example.test", reason: "different person" }], updatedAt: at(4 * DAY) }),
    edge(4, ids.n2, "FormLead", ids.leadM, "attached", { history: [{ from: "candidate", to: "attached", at: at(HOUR), by: "automatic", reason: "sole phone match" }], updatedAt: at(HOUR) }),
  ]);

  // ── Outreach records ──
  const record = (_id: mongoose.Types.ObjectId, model: string, lead: mongoose.Types.ObjectId, number: mongoose.Types.ObjectId | null, artifact: mongoose.Types.ObjectId | null) => ({
    _id, subject: { kind: "lead", model, id: lead }, primary_contact_number_id: number, state: "open", revision: 1,
    move_assessment: artifact ? { artifact_id: artifact, stale: false } : null, createdAt: at(DAY), updatedAt: at(DAY) });
  insert("records", [
    record(ids.recordA, "FormLead", ids.leadA, ids.n1, oidFor("a5", 3)), record(ids.recordB, "CallLead", ids.leadB, ids.n1, null),
    record(ids.recordM, "FormLead", ids.leadM, ids.n2, oidFor("a5", 12)), record(ids.recordL, "FormLead", ids.leadL, null, null),
  ]);

  // ── Rep identity links ──
  insert("repLinks", [
    { _id: oidFor("a3", 1), revision: 1, agent_id: oidFor("a4", 1), agent_name_snapshot: "Dana Reyes", rc_account_id: "synthetic-account", rc_extension_id: "101",
      role_kind: "sales_rep", status: "reviewed", effective_from: at(-DAY), effective_to: null, reviewed_at: at(-DAY), reviewed_by: "owner" },
    { _id: oidFor("a3", 2), revision: 1, agent_id: oidFor("a4", 2), agent_name_snapshot: "Marcus Bell", rc_account_id: "synthetic-account", rc_extension_id: "102",
      role_kind: "sales_rep", status: "proposed", effective_from: at(-DAY), effective_to: null },
  ]);

  // ── Calls and conversations ──
  let callSerial = 0, convSerial = 0;
  const calls: Record<string, unknown>[] = [], conversations: Record<string, unknown>[] = [];
  const addCall = (number: mongoose.Types.ObjectId, e164: string, ms: number, opts: { recorded?: boolean; analyzed?: boolean; late?: boolean; lead?: { model: string; id: mongoose.Types.ObjectId } }) => {
    const _id = oidFor("e1", ++callSerial);
    const inbound = rand() < 0.35, connected = rand() < 0.5, ext = rand() < 0.7 ? "101" : "102";
    const contact = connected && rand() < 0.4 ? "human_conversation" : !connected && rand() < 0.3 ? "voicemail" : "unknown";
    const convId = opts.recorded ? oidFor("e2", ++convSerial) : null;
    const started = at(ms);
    calls.push({ _id, provider: "ringcentral", provider_account_id: "synthetic-account", telephony_session_id: `s4-${callSerial}`, direction: inbound ? "Inbound" : "Outbound",
      contact_number_id: number, external_e164: e164, company_e164: "+15615550100", started_at: started, answered_at: connected ? new Date(+started + 8000) : null,
      ended_at: new Date(+started + 120_000), duration_seconds: connected ? 30 + Math.floor(rand() * 400) : 0, provider_result: connected ? "Call connected" : inbound ? "Missed" : "No Answer",
      provider_connected: connected, contact_type: contact, contact_type_basis: contact === "unknown" ? null : "transcript:v1",
      parties: [{ role: "external", direction: inbound ? "Inbound" : "Outbound", e164, connected }, { role: "user", extension_id: ext, extension_number: ext, connected }],
      recordings: convId ? [{ provider_recording_id: `rec-s4-${callSerial}`, recording_type: "Automatic", lead_conversation_id: convId }] : [],
      sources: ["webhook"], terminal: true, projection_revision: 1, transfer: false, queue_fanout: false,
      first_observed_at: new Date(+started + (opts.late ? 2 * HOUR + 17 * MIN : 40_000)), last_observed_at: new Date(+started + 3 * HOUR),
      merged_into_id: null, purged_at: null, createdAt: new Date(+started + 40_000), updatedAt: new Date(+started + 3 * HOUR) });
    if (convId) conversations.push({ _id: convId, provider: "ringcentral", provider_account_id: "synthetic-account", provider_recording_id: `rec-s4-${callSerial}`,
      call_interaction_id: _id, contact_number_id: number, contact_type: contact, started_at: started, duration_seconds: 200, direction: inbound ? "Inbound" : "Outbound",
      lead_ref: opts.lead ?? null, state: opts.analyzed ? "complete" : "transcribed", latest_transcript_version: `tv-${convSerial}`,
      latest_completed_run_id: opts.analyzed ? oidFor("e3", convSerial) : null,
      summary: opts.analyzed ? { sections: { overview: `Customer asked about a 2 bedroom move, call ${convSerial}. They will decide next week.` }, created_at: new Date(+started + 5 * HOUR) } : null,
      createdAt: new Date(+started + 90_000), updatedAt: new Date(+started + 5 * HOUR) });
  };
  const leadA = { model: "FormLead", id: ids.leadA };
  let ms = 6 * DAY;
  for (let i = 0; i < 130; i++) {
    if (!(i % 10 === 5)) ms += Math.floor(rand() * 14 * HOUR) + MIN; // every tenth call shares the previous instant
    addCall(ids.n1, S4_E164.n1, ms, { recorded: i % 6 === 0, analyzed: i % 12 === 0, late: i % 4 === 0, lead: i % 3 === 0 ? leadA : undefined });
  }
  for (let i = 0; i < 50; i++) addCall(ids.n2, S4_E164.n2, 2 * DAY + i * 26 * HOUR, { recorded: i % 5 === 0, analyzed: i % 8 === 0, late: i % 7 === 0 });
  // A standalone conversation (no call) and a legacy one (no contact_number_id) linked from an N1 call recording.
  conversations.push({ _id: oidFor("e2", 900), provider: "ringcentral", provider_account_id: "synthetic-account", provider_recording_id: "rec-s4-standalone", call_interaction_id: null,
    contact_number_id: ids.n1, contact_type: "unknown", started_at: at(9 * DAY + 7 * MIN), duration_seconds: 80, direction: "Inbound", lead_ref: null, state: "transcribed",
    latest_completed_run_id: null, summary: null, createdAt: at(9 * DAY + 10 * MIN), updatedAt: at(9 * DAY + 10 * MIN) });
  calls.push({ ...calls[0], _id: ids.legacyCall, telephony_session_id: "s4-legacy", started_at: at(5 * DAY + 3 * HOUR), first_observed_at: at(5 * DAY + 3 * HOUR),
    recordings: [{ provider_recording_id: "rec-s4-legacy", recording_type: "Automatic", lead_conversation_id: null }] });
  conversations.push({ _id: ids.legacyConversation, provider: "ringcentral", provider_account_id: "synthetic-account", provider_recording_id: "rec-s4-legacy", call_interaction_id: null,
    contact_number_id: null, contact_type: "unknown", started_at: at(5 * DAY + 3 * HOUR), duration_seconds: 60, direction: "Inbound", lead_ref: null, state: "transcribed",
    latest_completed_run_id: null, summary: null, createdAt: at(5 * DAY + 3 * HOUR + MIN), updatedAt: at(5 * DAY + 3 * HOUR + MIN) });
  insert("calls", calls);
  insert("conversations", conversations);

  // ── Lead Messages: out-of-order sent_at within the slack (−1 h … +20 h) ──
  const messages: Record<string, unknown>[] = [];
  // Every fourth message is created 30 min after the previous one yet sent 50 min *before* its own creation,
  // while the previous one was sent 20 h after creation: sent order ≠ created order inside one source.
  let createdMs = 6 * DAY;
  for (let i = 0; i < 40; i++) {
    createdMs += i % 4 === 1 ? 30 * MIN : 40 * HOUR + (i % 5 === 0 ? 0 : Math.floor(rand() * 5 * HOUR));
    const created = at(createdMs);
    const offset = i % 7 === 0 ? null : i % 4 === 0 ? 20 * HOUR - i * MIN : i % 4 === 1 ? -(50 * MIN) : Math.floor(rand() * 30 * MIN);
    const byLead = i < 20 ? leadA : i < 30 ? { model: "CallLead", id: ids.leadB } : null;
    messages.push({ _id: oidFor("e4", i + 1), to: i % 2 ? S4_E164.n1 : "3055550101", lead_ref: byLead, purpose: i % 2 ? "quote_request_confirmation" : "granot_lead_created_confirmation",
      status: i % 9 === 0 ? "failed" : "delivered", sent_at: offset === null ? null : new Date(+created + offset), delivered_at: null, origin: "system", dispatch_mode: "immediate",
      body: "SYNTHETIC BODY NEVER READ", createdAt: created, updatedAt: created });
  }
  for (let i = 0; i < 6; i++) messages.push({ _id: oidFor("e4", 100 + i), to: S4_E164.n2, lead_ref: { model: "FormLead", id: ids.leadM }, purpose: "quote_request_confirmation",
    status: "delivered", sent_at: at(3 * DAY + i * 5 * DAY + 2 * MIN), origin: "system", dispatch_mode: "immediate", createdAt: at(3 * DAY + i * 5 * DAY), updatedAt: at(3 * DAY + i * 5 * DAY) });
  for (let i = 0; i < 3; i++) messages.push({ _id: oidFor("e4", 200 + i), to: "+15125550199", lead_ref: { model: "FormLead", id: ids.leadL }, purpose: "quote_request_confirmation",
    status: "sent", sent_at: at(2 * DAY + i * DAY), origin: "system", createdAt: at(2 * DAY + i * DAY), updatedAt: at(2 * DAY + i * DAY) });
  insert("messages", messages);

  // ── Lead changes + observations (half paired; captured up to 23 h before applied) ──
  const changes: Record<string, unknown>[] = [], observations: Record<string, unknown>[] = [];
  const chain = ["0", "1", "3", "1", "0", "1", "5"];
  const prior: Record<string, string | null> = { A: null, B: null, M: null };
  const addChange = (key: "A" | "B" | "M", n: number, appliedMs: number, paired: boolean, quoted: boolean, fixedId?: mongoose.Types.ObjectId, capturedBeforeMs?: number) => {
    const lead = key === "A" ? { model: "FormLead", id: String(ids.leadA), job: "5590101" } : key === "B" ? { model: "CallLead", id: String(ids.leadB), job: "5590102" }
      : { model: "FormLead", id: String(ids.leadM), job: "5590104" };
    const _id = fixedId ?? oidFor("d3", n);
    const observationId = paired ? (fixedId && fixedId.equals(ids.pairedChange) ? ids.pairedObservation : oidFor("d4", n)) : null;
    const applied = at(appliedMs);
    if (observationId) observations.push({ _id: observationId, kind: "lead_snapshot", captured_at: new Date(+applied - (capturedBeforeMs ?? Math.floor(rand() * S4_CAPTURED_MS))),
      identity: { normalized_job_no: lead.job, job_no_raw: lead.job }, priority: { raw: chain[n % chain.length], canonical: chain[n % chain.length], valid: true },
      agent_identity: { rep_raw: n % 2 ? "DREYES" : "MBELL" }, createdAt: applied });
    const next = chain[n % chain.length]!;
    const fields = quoted ? [{ path: "quoted", before: n % 2 === 0, after: n % 2 !== 0 }] : [{ path: "granot_priority", before: prior[key], after: next }];
    if (!quoted) prior[key] = next;
    changes.push({ _id, entity: { model: lead.model, id: lead.id }, changed_paths: quoted ? ["quoted"] : ["granot_priority"], fields, applied_at: applied,
      provenance: { source_system: "granot", observation_id: observationId } });
  };
  let changeMs = 7 * DAY;
  for (let i = 0; i < 50; i++) {
    const key = i % 5 === 4 ? "B" : "A";
    if (i % 8 !== 3) changeMs += Math.floor(rand() * 30 * HOUR) + MIN;
    addChange(key, i + 1, changeMs, i % 2 === 0, i % 9 === 4);
  }
  addChange("A", 500, 70 * DAY, true, false, ids.pairedChange, 3 * HOUR + 12 * MIN);
  addChange("A", 501, 71 * DAY, false, false, ids.unpairedChange);
  for (let i = 0; i < 10; i++) addChange("M", 600 + i, 4 * DAY + i * 6 * DAY, i % 2 === 0, false);
  insert("entity_changes", changes);
  insert("observations", observations);

  // ── Follow-ups (every status) and their audit rows ──
  const followups: Record<string, unknown>[] = [], audits: Record<string, unknown>[] = [];
  const statuses = ["open", "completed", "cancelled", "superseded", "completed", "open"];
  const keyOf = (record: mongoose.Types.ObjectId) => record.equals(ids.recordA) ? `lead:FormLead:${ids.leadA}` : record.equals(ids.recordB) ? `lead:CallLead:${ids.leadB}`
    : record.equals(ids.recordM) ? `lead:FormLead:${ids.leadM}` : `lead:FormLead:${ids.leadL}`;
  const addFollowup = (n: number, record: mongoose.Types.ObjectId, createdMs: number, status: string, fixedId?: mongoose.Types.ObjectId) => {
    const _id = fixedId ?? oidFor("f2", n);
    const created = at(createdMs), updated = at(createdMs + 9 * DAY);
    followups.push({ _id, commitment_key: `fixture:${String(_id)}`, outreach_record_id: record, kind: n % 3 ? "call" : "send_estimate", description: `Follow-up ${n}: call back about the estimate`, status,
      due_at: n % 4 ? at(createdMs + 2 * DAY) : null, origin: n % 2 ? "rep_promise" : "owner", source_finding_ids: [], completion_basis: status === "completed" ? "owner" : null,
      completed_at: status === "completed" ? at(createdMs + 3 * DAY) : null, cancel_reason: status === "cancelled" ? "customer booked elsewhere" : null,
      revision: 2, createdAt: created, updatedAt: updated });
    // A cancel or supersede leaves an audit row days before `updatedAt` (the reader fix times the event by it); follow-up 9 has none.
    if ((status === "cancelled" || status === "superseded") && n !== 9) audits.push({ _id: fixedId ? ids.cancelAudit : oidFor("f3", n), semantic_key: `fixture:f3:${n}`, subject_key: keyOf(record),
      event_kind: status === "cancelled" ? "cancel_followup" : "intelligence_commitment_evidence", happened_at: at(createdMs + 4 * DAY), recorded_at: at(createdMs + 4 * DAY + 2 * MIN),
      prior: { status: "open" }, current: { status }, actor: { kind: "owner", id: "owner@example.test" }, invalidation: { kind: "followup", target_id: String(_id) }, revision: 2 });
  };
  for (let i = 0; i < 30; i++) addFollowup(i + 1, i % 3 === 2 ? ids.recordB : ids.recordA, 8 * DAY + i * 2 * DAY + (i % 4 === 1 ? 0 : Math.floor(rand() * HOUR)), statuses[i % statuses.length]!);
  addFollowup(99, ids.recordA, 60 * DAY, "cancelled", ids.cancelledFollowupWithAudit);
  for (let i = 0; i < 8; i++) addFollowup(200 + i, ids.recordM, 3 * DAY + i * 5 * DAY, statuses[i % statuses.length]!);
  for (let i = 0; i < 3; i++) addFollowup(300 + i, ids.recordL, 2 * DAY + i * DAY, "open");
  insert("followups", followups);

  // ── Audit rows: every mapped kind, same instants, excluded and unmapped kinds ──
  const auditKinds: Array<[string, string, Record<string, unknown>]> = [
    ["assign", "outreach", { responsible_agent_id: String(oidFor("a4", 1)), agent_name: "Dana Reyes" }], ["add_note", "outreach", { note: "Customer prefers texts" }],
    ["set_waiting", "outreach", { wait_until: at(40 * DAY).toISOString(), wait_reason: "customer travelling" }], ["close", "outreach", { closed_reason: "booked" }],
    ["reopen", "outreach", { reason: "customer called back" }], ["snooze_followup", "followup", { snoozed_until: at(45 * DAY).toISOString(), status: "open" }],
    ["intelligence.submitted", "analysis", { status: "submitted" }], ["outreach_call_applied", "interaction", { interaction_id: "x" }], ["start_call", "outreach", {}],
    ["end_call", "outreach", { call_progress: { note: "left a voicemail" } }], ["review_opened", "review", { cause_kind: "attachment_ambiguous" }], ["resolve_review", "review", {}],
    ["nudge.sent", "nudge", { channel: "sms_to_rep" }], ["restriction_set", "restriction", { channels: ["call"], until: at(50 * DAY).toISOString() }], ["unmapped_kind", "outreach", {}],
  ];
  let auditMs = 6 * DAY;
  const auditFor = (n: number, key: string, whenMs: number) => {
    const [event_kind, kind, current] = auditKinds[n % auditKinds.length]!;
    audits.push({ _id: oidFor("f4", n), semantic_key: `fixture:f4:${n}`, subject_key: event_kind === "intelligence.submitted" ? `number:${key === "M" ? ids.n2 : ids.n1}` : key === "M" ? `lead:FormLead:${ids.leadM}` : key === "B" ? `lead:CallLead:${ids.leadB}` : `lead:FormLead:${ids.leadA}`,
      event_kind, happened_at: at(whenMs), recorded_at: at(whenMs + (n % 5 === 0 ? 3 * HOUR : MIN)), prior: { state: "open" }, current, actor: { kind: n % 4 ? "owner" : "worker", id: "owner@example.test" },
      invalidation: { kind, target_id: String(kind === "followup" ? oidFor("f2", 1) : ids.recordA) }, revision: 1 });
  };
  for (let i = 0; i < 60; i++) { if (i % 4 !== 2) auditMs += Math.floor(rand() * 20 * HOUR) + MIN; auditFor(i + 1, i % 6 === 5 ? "B" : "A", auditMs); }
  for (let i = 0; i < 20; i++) auditFor(300 + i, "M", 2 * DAY + i * 2 * DAY + HOUR);
  insert("audits", audits);

  // ── Move assessments (one shadow, one not ready; published after creation) ──
  const artifact = (n: number, key: string, createdMs: number, publishDelayMs: number, extra: Record<string, unknown> = {}) => ({ _id: oidFor("a5", n), subject_key: key, input_fingerprint: `fixture:a5:${n}`,
    status: "ready", shadow: false, purged_at: null, published_at: at(createdMs + publishDelayMs), createdAt: at(createdMs), updatedAt: at(createdMs + publishDelayMs),
    scores: { transaction_intent: { score: 40 + n * 5 }, move_likelihood: { score: 50 + n * 3 } }, engagement: { work_status: n % 2 ? "worked_with_next_step" : "not_contacted" }, ...extra });
  insert("artifacts", [
    artifact(1, `lead:FormLead:${ids.leadA}`, 20 * DAY, 2 * HOUR), artifact(2, `lead:FormLead:${ids.leadA}`, 40 * DAY, 30 * HOUR), artifact(3, `lead:FormLead:${ids.leadA}`, 60 * DAY, 5 * MIN),
    artifact(4, `lead:CallLead:${ids.leadB}`, 30 * DAY, 0), artifact(5, `lead:CallLead:${ids.leadB}`, 50 * DAY, 3 * DAY),
    artifact(6, `lead:FormLead:${ids.leadA}`, 55 * DAY, HOUR, { shadow: true }), artifact(7, `lead:FormLead:${ids.leadA}`, 56 * DAY, HOUR, { status: "failed" }),
    artifact(11, `lead:FormLead:${ids.leadM}`, 10 * DAY, HOUR), artifact(12, `lead:FormLead:${ids.leadM}`, 40 * DAY, 2 * HOUR),
  ]);

  // ── Bookings: one dated, one without book_date; a Cancellation ──
  insert("booked_leads", [
    { _id: oidFor("f1", 1), lead_ref: ids.leadA, lead_model: "FormLead", job_no: "5590101", book_date: at(65 * DAY), timestamp: at(65 * DAY), createdAt: at(65 * DAY + 4 * HOUR),
      total_binder_amount: 1200, deposit_amount: 300, source: "Top10", cancelled: oidFor("f7", 1), agent_allocations: [{ agent: oidFor("a4", 1), agent_name_snapshot: "Dana Reyes", binder_amount: 1200 }] },
    { _id: ids.bookingNoDate, lead_ref: ids.leadB, lead_model: "CallLead", job_no: "5590102", book_date: null, timestamp: at(66 * DAY), createdAt: at(66 * DAY),
      total_binder_amount: 800, deposit_amount: 100, source: "Google Ads", agent_allocations: [{ agent: oidFor("a4", 2), agent_name_snapshot: "Marcus Bell", binder_amount: 800 }] },
    { _id: oidFor("f1", 3), lead_ref: ids.leadM, lead_model: "FormLead", job_no: "5590104", book_date: at(45 * DAY), timestamp: at(45 * DAY), createdAt: at(45 * DAY + HOUR),
      total_binder_amount: 950, deposit_amount: 200, source: "Top10", agent_allocations: [{ agent: oidFor("a4", 1), agent_name_snapshot: "Dana Reyes", binder_amount: 950 }] },
  ]);
  insert("cancelled_leads", [{ _id: oidFor("f7", 1), booked_lead: oidFor("f1", 1), lead_ref: ids.leadA, lead_model: "FormLead",
    cancel_date: at(68 * DAY), reason: "customer found a cheaper mover", refund_amount: 300, job_no: "5590101", createdAt: at(69 * DAY) }]);

  // ── Owner corrections ──
  const instructions: Record<string, unknown>[] = [];
  for (let i = 0; i < 8; i++) instructions.push({ _id: oidFor("f8", i + 1), instruction_id: oidFor("f9", i + 1), revision: 1, subject_key: i < 6 ? `lead:FormLead:${ids.leadA}` : `lead:FormLead:${ids.leadM}`,
    field: ["due_at", "status", "assignment", "contact_type"][i % 4], current: { value: `v${i}` }, prior: { value: null }, actor: { kind: "owner", id: "owner@example.test" },
    happened_at: at(10 * DAY + i * 7 * DAY), state: "active" });
  insert("instructions", instructions);
  return out;
}

