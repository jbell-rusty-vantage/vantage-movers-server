import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { planLeadLink, type NumberLeadSnapshot, type StoredLeadLink } from "./leadLink";
import { allNumbersFilter, decodeAllNumbersCursor, displayPhone, encodeAllNumbersCursor } from "./allNumbers";
import { canMessage, strongestCandidate } from "../salesIntelligence/repIdentity/accounts";
import { CsiError } from "../salesIntelligence/auth";

const id = () => new mongoose.Types.ObjectId();
const at = (iso: string) => new Date(iso);

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
