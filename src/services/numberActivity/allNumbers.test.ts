import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { callResult, summarizeCalls, type SummaryCallRow } from "./callSummary";
import { agentNameAt, type RepLinkLean } from "./callRep";
import { planLeadLink, leadSnapshot, leadState, type NumberLeadSnapshot, type StoredLeadLink } from "./leadLink";
import { changeTriggersLeadLink, leadLinkFingerprint } from "./leadLinkJobs";
import { allNumbersFilter, decodeAllNumbersCursor, displayPhone, encodeAllNumbersCursor, leadSearchFilters, toNumberRow } from "./allNumbers";
import { canMessage, strongestCandidate } from "../salesIntelligence/repIdentity/accounts";
import { CsiError } from "../salesIntelligence/auth";
import { enqueueDeskWakeForLeadLink, movedLeads } from "../salesOutreach/capture/leadLinkWake";
import { parseSearchTerm } from "./numberSearch";

const id = () => new mongoose.Types.ObjectId();
const at = (iso: string) => new Date(iso);
const call = (iso: string, direction: string, extra: Partial<SummaryCallRow> = {}): SummaryCallRow =>
  ({ _id: id(), direction, started_at: at(iso), provider_connected: false, contact_type: "unknown", provider_result: "Missed", duration_seconds: 0, parties: [], ...extra });

test("call result: answered when connected, voicemail when declared or by result, else missed", () => {
  assert.equal(callResult({ provider_connected: true, contact_type: "voicemail", provider_result: "Voicemail" }), "answered");
  assert.equal(callResult({ provider_connected: false, contact_type: "voicemail" }), "voicemail");
  assert.equal(callResult({ provider_connected: false, contact_type: "unknown", provider_result: "Sent to Voicemail" }), "voicemail");
  assert.equal(callResult({ provider_connected: false, contact_type: "unknown", provider_result: "No Answer" }), "missed");
});

test("call summary: counts, last call and the waiting rule (CONTRACT §3)", () => {
  const rows = [
    call("2026-10-01T09:00:00Z", "Inbound", { provider_connected: true, duration_seconds: 60, parties: [{ role: "user", connected: true, extension_id: "e1" }] }),
    call("2026-10-01T10:00:00Z", "Inbound"),
    call("2026-10-01T11:00:00Z", "Outbound", { provider_result: "No Answer" }),
    call("2026-10-01T12:00:00Z", "Inbound", { contact_type: "voicemail" }),
    call("2026-10-01T13:00:00Z", "Inbound"),
    call("2026-10-01T08:00:00Z", "Internal"),
  ];
  const summary = summarizeCalls([...rows].reverse());
  assert.deepEqual(summary.calls, { inbound: 4, outbound: 1, missed: 3 });
  assert.deepEqual(summary.waiting_since, at("2026-10-01T12:00:00Z"), "the earliest unanswered inbound after the latest handled call");
  assert.equal(summary.last_call?.result, "missed");
  assert.equal(summary.last_call?.direction, "inbound");
  assert.deepEqual(summary.last_inbound_at, at("2026-10-01T13:00:00Z"));
  assert.deepEqual(summary.last_outbound_at, at("2026-10-01T11:00:00Z"));
  // Any outbound call (connected or not) handles the wait; an answered inbound does too.
  assert.equal(summarizeCalls([...rows, call("2026-10-01T14:00:00Z", "Outbound")]).waiting_since, null);
  assert.equal(summarizeCalls([...rows, call("2026-10-01T14:00:00Z", "Inbound", { provider_connected: true })]).waiting_since, null);
  // An outbound call that never connected keeps `missed` as its result, but is never counted missed.
  const outbound = summarizeCalls([call("2026-10-01T09:00:00Z", "Outbound")]);
  assert.deepEqual(outbound.calls, { inbound: 0, outbound: 1, missed: 0 });
  assert.equal(outbound.last_call?.result, "missed");
  assert.equal(outbound.waiting_since, null);
  const first = summarizeCalls(rows.slice(0, 1));
  assert.equal(first.last_call?.rc_extension_id, "e1");
  assert.equal(first.last_call?.duration_seconds, 60);
  assert.deepEqual(summarizeCalls([]), { calls: { inbound: 0, outbound: 0, missed: 0 }, last_call: null, last_inbound_at: null, last_outbound_at: null, waiting_since: null });
});

const lead = (model: "FormLead" | "CallLead", iso: string, name = "Lead"): NumberLeadSnapshot =>
  ({ model, id: id(), name, job_no: null, receiver_agent_id: null, receiver_agent_name: null, received_at: at(iso), state: "open" });

test("lead link: automatic newest, Owner pin until a newer Lead, unlinked Leads stay out (CONTRACT §3)", () => {
  const now = at("2026-10-05T12:00:00Z");
  const a = lead("FormLead", "2026-09-01T00:00:00Z", "A"), b = lead("CallLead", "2026-09-03T00:00:00Z", "B"), c = lead("FormLead", "2026-09-02T00:00:00Z", "C");
  const automatic = planLeadLink({ candidates: [a, b, c], current: { lead: null, lead_link: null }, pinned: null, now });
  assert.equal(automatic.lead, b);
  assert.deepEqual(automatic.other_leads, [c, a]);
  assert.deepEqual(automatic.lead_link, { source: "automatic", set_at: now, set_by: null, excluded: [] });
  // An unchanged automatic link keeps its `set_at`, so a recompute writes nothing.
  const later = planLeadLink({ candidates: [a, b, c], current: { lead: b, lead_link: automatic.lead_link }, pinned: null, now: at("2026-10-06T00:00:00Z") });
  assert.deepEqual(later.lead_link.set_at, now);
  // Owner pin: holds while no candidate is received after `set_at`.
  const pinLink: StoredLeadLink = { source: "owner", set_at: at("2026-09-04T00:00:00Z"), set_by: "owner-1", excluded: [] };
  const held = planLeadLink({ candidates: [a, b, c], current: { lead: a, lead_link: pinLink }, pinned: a, now });
  assert.equal(held.lead, a);
  assert.equal(held.lead_link.source, "owner");
  assert.deepEqual(held.other_leads, [b, c]);
  const newer = lead("FormLead", "2026-09-05T00:00:00Z", "D");
  const reverted = planLeadLink({ candidates: [a, b, c, newer], current: { lead: a, lead_link: pinLink }, pinned: a, now });
  assert.equal(reverted.lead, newer, "a Lead received after the pin reverts to automatic: the newest wins");
  assert.equal(reverted.lead_link.source, "automatic");
  // A pin whose Lead is gone or became a Duplicate (pinned null) is automatic.
  assert.equal(planLeadLink({ candidates: [a], current: { lead: b, lead_link: pinLink }, pinned: null, now }).lead, a);
  // Other Leads are capped at 10.
  const many = Array.from({ length: 14 }, (_, i) => lead("FormLead", `2026-09-${String(i + 10).padStart(2, "0")}T00:00:00Z`));
  assert.equal(planLeadLink({ candidates: many, current: { lead: null, lead_link: null }, pinned: null, now }).other_leads.length, 10);
});

test("lead snapshot: state from the Lead's own stamps; triggers and fingerprint ignore unrelated edits", () => {
  assert.equal(leadState({ booked: id(), cancelled: id() }), "cancelled");
  assert.equal(leadState({ booked: id() }), "booked");
  assert.equal(leadState({}), "open");
  const snapshot = leadSnapshot("CallLead", { _id: id(), timestamp: at("2026-09-01T00:00:00Z"), name: " Bo ", receiver_agent_name_snapshot: "Dana" });
  assert.equal(snapshot.name, "Bo");
  assert.equal(snapshot.receiver_agent_name, "Dana");
  assert.equal(changeTriggersLeadLink({ revision_before: 0, changed_paths: [] }), true);
  assert.equal(changeTriggersLeadLink({ revision_before: 3, changed_paths: ["receiver_agent_name_snapshot"] }), true);
  assert.equal(changeTriggersLeadLink({ revision_before: 3, changed_paths: ["granot_contact_snapshot.phone_number"] }), true);
  assert.equal(changeTriggersLeadLink({ revision_before: 3, changed_paths: ["cpl", "sheet_sync"] }), false);
  const row = { _id: id(), timestamp: at("2026-09-01T00:00:00Z"), name: "Bo", normalized_phone_number: "5550100200" };
  assert.equal(leadLinkFingerprint(row), leadLinkFingerprint({ ...row, updatedAt: new Date() } as typeof row));
  assert.notEqual(leadLinkFingerprint(row), leadLinkFingerprint({ ...row, normalized_phone_number: "5550100201" }));
});

test("All Numbers list: display, cursor per view, filter and sort", () => {
  assert.equal(displayPhone("+15551234567"), "(555) 123-4567");
  assert.equal(displayPhone("+442071234567"), "+442071234567");
  const cursor = encodeAllNumbersCursor({ view: "waiting", at: "2026-10-01T12:00:00.000Z", id: "a".repeat(24) });
  assert.deepEqual(decodeAllNumbersCursor(cursor, "waiting"), { view: "waiting", at: "2026-10-01T12:00:00.000Z", id: "a".repeat(24) });
  assert.throws(() => decodeAllNumbersCursor(cursor, "all"), (error: unknown) => error instanceof CsiError && error.code === "CURSOR_EXPIRED");
  assert.throws(() => decodeAllNumbersCursor("nonsense", "all"), CsiError);
  const waiting = allNumbersFilter({ view: "waiting", q: undefined }, decodeAllNumbersCursor(cursor, "waiting"));
  assert.deepEqual(waiting.sort, { waiting_since: 1, _id: 1 });
  assert.deepEqual(waiting.filter.waiting_since, { $type: "date" });
  assert.ok(JSON.stringify(waiting.filter.$and).includes("$gt"), "the longest wait comes first, so the keyset moves forward");
  const all = allNumbersFilter({ view: "all", q: "Smith" }, null);
  assert.deepEqual(all.sort, { last_activity_at: -1, _id: -1 });
  assert.deepEqual(all.filter, { purged_at: null, search_terms: { $regex: "^smith" } });
  assert.deepEqual(allNumbersFilter({ view: "all", q: "4567" }, null).filter, { purged_at: null, digits_reversed: { $regex: "^7654" } });
});

test("All Numbers row: unmigrated numbers read as zero calls; caller name is the newest; agent named at the call time", () => {
  const links: RepLinkLean[] = [{ _id: id(), revision: 1, agent_id: id(), agent_name_snapshot: "Dana Rep", rc_account_id: "acc", rc_extension_id: "e1",
    role_kind: "sales_rep", status: "reviewed", effective_from: at("2026-09-01T00:00:00Z"), effective_to: null, reviewed_at: at("2026-09-01T00:00:00Z"), reviewed_by: "o" }];
  assert.equal(agentNameAt(links, "e1", at("2026-09-10T00:00:00Z")), "Dana Rep");
  assert.equal(agentNameAt(links, "e1", at("2026-08-10T00:00:00Z")), null, "before the link took effect");
  assert.equal(agentNameAt([{ ...links[0]!, status: "proposed" }], "e1", at("2026-09-10T00:00:00Z")), null);
  assert.equal(agentNameAt([{ ...links[0]!, role_kind: "service" }], "e1", at("2026-09-10T00:00:00Z")), "Dana Rep", "any reviewed role but excluded names the Agent");
  const pinned = lead("FormLead", "2026-09-01T00:00:00Z", "Ann");
  const row = toNumberRow({ _id: id(), revision: 3, e164: "+15550100200", provider_names: ["OLD NAME", "NEW NAME"], created_via: "form_lead",
    first_observed_at: at("2026-09-01T00:00:00Z"), last_activity_at: at("2026-09-02T00:00:00Z"), lead: pinned,
    lead_link: { source: "owner", set_at: null, set_by: null, excluded: [] },
    last_call: { at: at("2026-09-02T00:00:00Z"), direction: "inbound", result: "missed", rc_extension_id: "e1" } },
  { subjects: new Map([[`FormLead:${String(pinned.id)}`, "b".repeat(24)]]), links });
  assert.equal(row.caller_name, "NEW NAME");
  assert.equal(row.source, "form_lead");
  assert.equal(row.lead_link, "owner");
  assert.deepEqual(row.calls, { inbound: 0, outbound: 0, missed: 0 });
  assert.equal(row.lead?.desk_subject_id, "b".repeat(24));
  assert.deepEqual(row.last_call, { at: "2026-09-02T00:00:00.000Z", direction: "inbound", result: "missed", duration_seconds: null, agent_name: "Dana Rep" });
});

test("lead search filters: Job Number prefix, ten-digit phone on the indexed paths, name anywhere; Duplicates excluded", () => {
  const phone = leadSearchFilters("(555) 010-0302");
  assert.deepEqual(phone.FormLead!.duplicate, { $ne: true });
  assert.ok(JSON.stringify(phone.FormLead).includes('"normalized_phone_number":"5550100302"'));
  assert.ok(JSON.stringify(phone.CallLead).includes("ringcentral.original_caller.normalized_phone_number"));
  const name = leadSearchFilters("o'neil (smith)");
  assert.ok(JSON.stringify(name.FormLead).includes('"$options":"i"'));
  assert.ok(JSON.stringify(name.FormLead).includes("\\\\(smith\\\\)"), "regex characters are escaped");
});

test("Accounts: strongest unique name candidate and the Message availability", () => {
  const agents = [{ _id: "a1", name: "Dana Rep" }, { _id: "a2", name: "Dana Other" }, { _id: "a3", name: "Eli Service", name_aliases: ["Elijah S"] }];
  assert.deepEqual(strongestCandidate({ id: "1", type: "User", name: "Dana Rep" }, agents), { agent_id: "a1", agent_name: "Dana Rep" });
  assert.equal(strongestCandidate({ id: "2", type: "User", name: "Dana Smith" }, agents), null, "two first-token matches suggest nobody");
  assert.deepEqual(strongestCandidate({ id: "3", type: "User", name: "Elijah S" }, agents), { agent_id: "a3", agent_name: "Eli Service" });
  assert.equal(strongestCandidate({ id: "4", type: "Department", name: "Dana Rep" }, agents), null);
  const config = { account: "acc", senderExtension: "e9", senderExtensionNumber: "109", senderPerson: "p9", senderDid: "", recordBaseUrl: "", hourlyLimit: 6,
    channels: { team_messaging: true, sms_to_rep: false, pager: true } };
  const extension = { id: "e1", type: "User", status: "Enabled", extension_number: "101" };
  assert.equal(canMessage({ extension, link: null, account: "acc", nudgesOn: true, config }), true, "pager by extension number");
  assert.equal(canMessage({ extension, link: null, account: "acc", nudgesOn: false, config }), false);
  assert.equal(canMessage({ extension: { ...extension, status: "Disabled" }, link: null, account: "acc", nudgesOn: true, config }), false);
  assert.equal(canMessage({ extension: { ...extension, id: "e9" }, link: null, account: "acc", nudgesOn: true, config }), false, "never the sender itself");
  const link = { status: "reviewed" as const, role_kind: "sales_rep" as const, nudge_channels_allowed: ["team_messaging"], rc_team_messaging_person_id: "77" };
  assert.equal(canMessage({ extension: { ...extension, extension_number: null }, link, account: "acc", nudgesOn: true, config }), true, "Team Messaging through the link");
  assert.equal(canMessage({ extension: { ...extension, extension_number: null }, link: { ...link, nudge_channels_allowed: [] }, account: "acc", nudgesOn: true, config }), false);
});

test("search term: long digits are exact-or-suffix, short digits a suffix, anything else a term prefix", () => {
  assert.deepEqual(parseSearchTerm("(555) 010-0200"), { kind: "e164", e164: "+15550100200", reversed: "0020010555" });
  assert.deepEqual(parseSearchTerm(" 0200 "), { kind: "suffix", reversed: "0020" });
  assert.deepEqual(parseSearchTerm("Smith"), { kind: "term", term: "smith" });
  assert.deepEqual(parseSearchTerm("12"), { kind: "term", term: "12" });
  assert.deepEqual(parseSearchTerm("   "), { kind: "none" });
});

test("desk wake: only Leads that entered or left the link move; nothing is enqueued when the desk wants no evidence", async () => {
  const a = { model: "FormLead", id: "a" }, b = { model: "CallLead", id: "b" }, c = { model: "FormLead", id: "c" };
  assert.deepEqual(movedLeads({ before: { lead: a, leads: [a, b] }, after: { lead: b, leads: [b, a] } }), [], "a swap of lead and other Lead moves no membership");
  assert.deepEqual(movedLeads({ before: { lead: a, leads: [a, b] }, after: { lead: c, leads: [c, b] } }), [a, c]);
  const session = {} as never;
  assert.deepEqual(await enqueueDeskWakeForLeadLink({ number_id: "n", changed: false, revision: 2, before: { lead: a, leads: [a] }, after: { lead: c, leads: [c] } },
    session, new Date(), { wanted: async () => { throw new Error("not consulted"); } }), []);
  assert.deepEqual(await enqueueDeskWakeForLeadLink({ number_id: "n", changed: true, revision: 2, before: { lead: a, leads: [a] }, after: { lead: c, leads: [c] } },
    session, new Date(), { wanted: async () => false }), []);
});
