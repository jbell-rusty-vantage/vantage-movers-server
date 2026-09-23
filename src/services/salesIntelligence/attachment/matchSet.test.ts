import assert from "node:assert/strict";
import { test } from "node:test";
import { decideMatchSet, isAutomaticEdge, matchedSources, numberLookupDigits, planSoleMatch, type MatchLeadRow, type PlanEdge } from "./matchSet";

const digits = ["2025550142"];
const at = new Date("2026-09-01T12:00:00Z");
let serial = 0;
const oid = () => (++serial).toString(16).padStart(24, "0");
const pad = (n: string) => n.padStart(24, "0");
const row = (extra: Partial<MatchLeadRow> = {}): MatchLeadRow => ({ _id: oid(), timestamp: at, normalized_phone_number: digits[0], ...extra });
const form = (r: MatchLeadRow) => ({ model: "FormLead" as const, row: r });
const call = (r: MatchLeadRow) => ({ model: "CallLead" as const, row: r });

test("match set: duplicate Leads are neither targets nor competitors", () => {
  const real = row(), dup = row({ duplicate: true });
  const set = decideMatchSet({ digits, rows: [form(real), form(dup), call(row({ duplicate: true }))] });
  assert.equal(set.status, "complete");
  assert.deepEqual(set.candidates.map(c => c.lead_ref.id), [String(real._id)]);
  assert.deepEqual(set.target, { model: "FormLead", id: String(real._id) });
});
test("match set: a Bad Lead / No-Sync competitor blocks; a sole Bad Lead / No-Sync Lead is never a target", () => {
  const blocked = decideMatchSet({ digits, rows: [form(row()), form(row({ bad_lead: "fake_info" }))] });
  assert.equal(blocked.status, "complete"); assert.equal(blocked.candidates.length, 2); assert.equal(blocked.target, null);
  assert.equal(decideMatchSet({ digits, rows: [form(row({ bad_lead: "fake_info" }))] }).target, null);
  assert.equal(decideMatchSet({ digits, rows: [call(row({ no_sync: true }))] }).target, null);
});
test("match set: one Form Lead plus one Call Lead on the same phone are two candidates (§13.4)", () => {
  const shared = oid();
  const set = decideMatchSet({ digits, rows: [form(row({ _id: shared })), call(row({ _id: shared }))] });
  assert.equal(set.status, "complete"); assert.equal(set.candidates.length, 2); assert.equal(set.target, null);
});
test("match set: several matching fields on one Lead are one candidate; repeated rows dedupe by {model,id}", () => {
  const r = row({ ingested_contact_snapshot: { normalized_phone_number: digits[0] }, granot_contact_snapshot: { normalized_phone_number: digits[0] },
    ringcentral: { original_caller: { normalized_phone_number: digits[0] } } });
  assert.deepEqual(matchedSources("CallLead", r, digits), ["normalized_phone_number", "ingested_contact_snapshot.normalized_phone_number",
    "granot_contact_snapshot.normalized_phone_number", "ringcentral.original_caller.normalized_phone_number"]);
  assert.equal(matchedSources("FormLead", r, digits).length, 3);
  const set = decideMatchSet({ digits, rows: [call(r), call(r)] });
  assert.equal(set.candidates.length, 1); assert.equal(set.candidates[0]!.sources.length, 4);
  assert.deepEqual(set.target, { model: "CallLead", id: String(r._id) });
});
test("match set: Booked/Cancelled Leads can be the identity target; Source Company is reported, never used to narrow", () => {
  const set = decideMatchSet({ digits, rows: [form(row({ booked: "b", cancelled: "c", source_company: "partner-a" }))] });
  assert.ok(set.target);
  assert.equal(set.candidates[0]!.booked, true); assert.equal(set.candidates[0]!.cancelled, true);
  assert.equal(set.candidates[0]!.source_company, "partner-a");
  const across = decideMatchSet({ digits, rows: [form(row({ source_company: "partner-a" })), form(row({ source_company: "partner-b" }))] });
  assert.equal(across.target, null);
});
test("match set: page exceeded, no digits and unindexed raw Granot evidence are Unknown, never a match", () => {
  const one = [form(row())];
  const shape = (s: ReturnType<typeof decideMatchSet>) => [s.status, s.reason, s.target];
  assert.deepEqual(shape(decideMatchSet({ digits, rows: one, pageExceeded: true })), ["unknown", "page_exceeded", null]);
  assert.deepEqual(shape(decideMatchSet({ digits: numberLookupDigits({ national_ten: null, e164: null }), rows: [] })), ["unknown", "no_digits", null]);
  assert.deepEqual(shape(decideMatchSet({ digits, rows: one, unindexed: true })), ["unknown", "unindexed_evidence", null]);
  assert.deepEqual(shape(decideMatchSet({ digits, rows: [] })), ["complete", undefined, null]);
});

const lead = (n: string) => ({ model: "FormLead" as const, id: n });
const edge = (n: string, extra: Partial<PlanEdge> = {}): PlanEdge => ({ id: `e${n}`, lead_ref: lead(n), state: "candidate", certainty: "likely",
  decided_at: null, automatic: false, has_phone_evidence: true, ...extra });
const auto = (n: string) => edge(n, { state: "attached", automatic: true });
const complete = (...ids: string[]) => decideMatchSet({ digits, rows: ids.map(n => form(row({ _id: pad(n) }))) });

test("plan: sole candidate attaches; Owner-decided, rejected, missing edge and competing Attached edges block", () => {
  const a = pad("a");
  assert.equal(planSoleMatch(complete("a"), [edge(a)]).attach, `e${a}`);
  assert.equal(planSoleMatch(complete("a"), [edge(a, { state: "ambiguous", certainty: "unsure" })]).attach, `e${a}`);
  assert.equal(planSoleMatch(complete("a"), [edge(a, { decided_at: at })]).blocked, "owner_decision");
  assert.equal(planSoleMatch(complete("a"), [edge(a, { state: "rejected", certainty: "rejected" })]).blocked, "owner_decision");
  assert.equal(planSoleMatch(complete("a"), []).blocked, "target_edge_missing");
  assert.equal(planSoleMatch(complete("a"), [edge(a, { has_phone_evidence: false })]).blocked, "no_phone_evidence");
  const owner = edge(pad("z"), { state: "attached", certainty: "owner_confirmed", decided_at: at });
  const exact = edge(pad("y"), { state: "attached", certainty: "exact" });
  assert.equal(planSoleMatch(complete("a"), [edge(a), owner]).blocked, "competing_attached");
  assert.equal(planSoleMatch(complete("a"), [edge(a), exact]).blocked, "competing_attached");
  assert.equal(planSoleMatch(complete("a"), [auto(a)]).blocked, "already_attached");
  assert.equal(planSoleMatch(complete("a", "b"), [edge(a)]).blocked, "competing_candidates");
});
test("plan: a stale automatic edge for a Lead outside the complete set is withdrawn and does not block", () => {
  const a = pad("a"), gone = pad("g");
  const plan = planSoleMatch(complete("a"), [edge(a), auto(gone)]);
  assert.deepEqual(plan.withdraw, [`e${gone}`]); assert.equal(plan.attach, `e${a}`);
  // An incomplete lookup withdraws nothing.
  assert.deepEqual(planSoleMatch(decideMatchSet({ digits, rows: [], unindexed: true }), [auto(gone)]).withdraw, []);
});
test("plan: a later non-duplicate competitor contests only the automatic edge; Owner/exact edges are never demoted", () => {
  const a = pad("a"), b = pad("b");
  const plan = planSoleMatch(complete("a", "b"), [auto(a), edge(b)]);
  assert.deepEqual(plan.contest, [`e${a}`]); assert.equal(plan.attach, null);
  const owner = edge(a, { state: "attached", certainty: "owner_confirmed", decided_at: at, automatic: true });
  assert.equal(isAutomaticEdge(owner), false);
  assert.deepEqual(planSoleMatch(complete("a", "b"), [owner, edge(b)]).contest, []);
  assert.deepEqual(planSoleMatch(complete("a", "b"), [edge(a, { state: "attached", certainty: "exact", automatic: true }), edge(b)]).contest, []);
  // Page overflow is known competition even when the automatic Lead is not on the first page.
  assert.deepEqual(planSoleMatch(decideMatchSet({ digits, rows: [form(row())], pageExceeded: true }), [auto(a)]).contest, [`e${a}`]);
});
