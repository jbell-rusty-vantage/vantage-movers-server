import assert from "node:assert/strict";
import { test } from "node:test";
import { actionsOverBound, ACTION_READ_LIMIT, fingerprintOutreachInputs, type FingerprintOutreachAction, type FingerprintOutreachRecord } from "./sources";
import { payloadHash } from "../transactions";
import { jsonValue } from "../outreach/store";

/**
 * AC1 (Attention and Case File spec §3.1, §3.4 K1/K2). The Number fingerprint is
 * `payloadHash(jsonValue({ ...base, ...fingerprintOutreachInputs(outreach, actions) }))`
 * (`intelligenceSources`); these tests hash exactly that composition over a fixed base.
 */
const RECORD = "650000000000000000000001", NUMBER = "650000000000000000000002", REP = "650000000000000000000003", OTHER_REP = "650000000000000000000004";
const T0 = new Date("2026-09-17T14:04:00Z"), DUE = new Date("2026-09-21T21:00:00Z");
const base = {
  number: { kind: "external", classification: "customer", eligibility: { state: "eligible" } },
  calls: [{ id: "c0", revision: 3 }], transcripts: [{ id: "v0", version: "t1", media: "sha" }],
  identities: [], official: [], bookings: [], cancellations: [], assertions: [], edges: [], restrictions: [], instructions: [],
};
type Base = typeof base;
const hash = (outreach: FingerprintOutreachRecord[], actions: FingerprintOutreachAction[], b: Base = base) =>
  payloadHash(jsonValue({ ...b, ...fingerprintOutreachInputs(outreach, actions) }));

const record = (patch: Partial<FingerprintOutreachRecord> = {}): FingerprintOutreachRecord => ({
  _id: RECORD, subject: { kind: "lead", model: "FormLead", id: "650000000000000000000009", contact_number_id: null },
  state: "unworked", closed_reason: null, closure_origin: null, responsible_agent_id: null, assignment: null, ...patch });
const promise = (patch: Partial<FingerprintOutreachAction> = {}): FingerprintOutreachAction => ({
  _id: "650000000000000000000010", outreach_record_id: RECORD, kind: "call", description: "Call back Monday after 5 PM", status: "open",
  due_at: DUE, origin: "rep_promise", responsible_agent_id: REP, assignment: { origin: "rep_promise" },
  completion_basis: null, cancel_reason: null, owner_instruction_ids: [], ...patch });
const systemDefault = (id: string, patch: Partial<FingerprintOutreachAction> = {}): FingerprintOutreachAction => ({
  _id: id, outreach_record_id: RECORD, kind: "call", description: "Return missed call", status: "open", due_at: DUE, origin: "system_default",
  responsible_agent_id: REP, assignment: null, completion_basis: null, cancel_reason: null, owner_instruction_ids: [], ...patch });

const before = { outreach: [record({ state: "open", responsible_agent_id: REP, assignment: { origin: "first_conversation" } })], actions: [promise()] };
const baseline = hash(before.outreach, before.actions);

test("K1: deterministic system writes leave the Number fingerprint byte-identical", async (t) => {
  const cases: Array<[string, FingerprintOutreachRecord[], FingerprintOutreachAction[]]> = [
    ["a P4 progress default created (system_default, day precision)", before.outreach,
      [...before.actions, systemDefault("650000000000000000000011", { description: "Follow up on the quote" })]],
    ["a P9 retry successor created", before.outreach,
      [...before.actions, systemDefault("650000000000000000000012", { description: "Try again: promised callback not reached" })]],
    ["a missed episode created", before.outreach, [...before.actions, systemDefault("650000000000000000000013")]],
    ["a missed episode completed by a call", before.outreach,
      [...before.actions, systemDefault("650000000000000000000013", { status: "completed", completion_basis: "call_attempt" })]],
    ["the rep promise completed by a call attempt", before.outreach,
      [promise({ status: "completed", completion_basis: "call_attempt" })]],
    ["the rep promise completed by Vantage evidence", before.outreach,
      [promise({ status: "completed", completion_basis: "vantage_evidence" })]],
    ["the rep promise superseded by a later model plan", before.outreach, [promise({ status: "superseded" })]],
    ["first_attempts assignment (future origin, excluded by construction)",
      [record({ state: "open", responsible_agent_id: OTHER_REP, assignment: { origin: "first_attempts" } })], before.actions],
    ["first_conversation assignment replacing none", [record({ state: "open", responsible_agent_id: OTHER_REP, assignment: { origin: "first_conversation" } })], before.actions],
    ["rep_promise / inherited_outreach assignment", [record({ state: "open", responsible_agent_id: OTHER_REP, assignment: { origin: "inherited_outreach" } })], before.actions],
    ["Team 3 crm_receiver / ringcentral_answered assignment", [record({ state: "open", responsible_agent_id: OTHER_REP, assignment: { origin: "crm_receiver" } })], before.actions],
    ["a 7/8 crm_disposition closure (actions cancelled by the closure)",
      [record({ state: "closed", closed_reason: "crm_dead", closure_origin: "crm_disposition", responsible_agent_id: REP, assignment: { origin: "first_conversation" } })],
      [promise({ status: "cancelled", cancel_reason: "crm_dead" })]],
    ["a crm_disposition closure cancelling an action the Owner edited earlier",
      [record({ state: "closed", closed_reason: "crm_dead", closure_origin: "crm_disposition", responsible_agent_id: REP, assignment: { origin: "first_conversation" } })],
      [promise({ status: "cancelled", cancel_reason: "crm_dead", owner_instruction_ids: [] })]],
    ["Team 3 granot_booked closure (future origin)", [record({ state: "closed", closed_reason: "granot_booked", closure_origin: "granot_booked", responsible_agent_id: REP, assignment: { origin: "first_conversation" } })], before.actions],
    ["unworked → open", [record({ state: "unworked", responsible_agent_id: REP, assignment: { origin: "first_conversation" } })], before.actions],
    ["open → waiting_on_customer", [record({ state: "waiting_on_customer", responsible_agent_id: REP, assignment: { origin: "first_conversation" } })], before.actions],
    ["an automatic re-assignment of the action (not Owner)", before.outreach, [promise({ responsible_agent_id: OTHER_REP, assignment: { origin: "rep_promise" } })]],
    ["a wait expiring / snooze bookkeeping (not hashed)", before.outreach, [{ ...promise(), ...{ snoozed_until: new Date(), wait_expired_at: new Date() } }]],
  ];
  for (const [name, outreach, actions] of cases) await t.test(name, () => assert.equal(hash(outreach, actions), baseline));
});

test("K2: new evidence and human intent change the Number fingerprint", async (t) => {
  const cases: Array<[string, () => string]> = [
    ["an Owner assignment", () => hash([record({ state: "open", responsible_agent_id: OTHER_REP, assignment: { origin: "owner" } })], before.actions)],
    ["an Owner un-assignment (owner → null)", () => hash([record({ state: "open", responsible_agent_id: null, assignment: { origin: "owner" } })], before.actions)],
    ["an Owner follow-up created", () => hash(before.outreach, [...before.actions,
      { ...promise({ _id: "650000000000000000000020", origin: "owner", description: "Call about deposit", assignment: { origin: "inherited_outreach" } }) }])],
    ["an Owner re-date", () => hash(before.outreach, [promise({ due_at: new Date("2026-09-22T21:00:00Z") })])],
    ["an Owner description edit", () => hash(before.outreach, [promise({ description: "Call back Tuesday" })])],
    ["an Owner re-assignment of the action", () => hash(before.outreach, [promise({ responsible_agent_id: OTHER_REP, assignment: { origin: "owner" } })])],
    ["an Owner cancel", () => hash(before.outreach, [promise({ status: "cancelled", cancel_reason: "customer asked not to", owner_instruction_ids: ["i1"] })])],
    ["an Owner completion", () => hash(before.outreach, [promise({ status: "completed", completion_basis: "owner" })])],
    ["a customer-confirmed completion", () => hash(before.outreach, [promise({ status: "completed", completion_basis: "customer_confirmation" })])],
    ["an official Booking closure", () => hash([record({ state: "closed", closed_reason: "booked", closure_origin: "official", responsible_agent_id: REP, assignment: { origin: "first_conversation" } })],
      [promise({ status: "cancelled", cancel_reason: "booked" })])],
    ["an Owner closure", () => hash([record({ state: "closed", closed_reason: "lost", closure_origin: "owner", responsible_agent_id: REP, assignment: { origin: "first_conversation" } })],
      [promise({ status: "cancelled", cancel_reason: "lost" })])],
    ["a new call", () => hash(before.outreach, before.actions, { ...base, calls: [...base.calls, { id: "c1", revision: 1 }] })],
    ["a new transcript version", () => hash(before.outreach, before.actions, { ...base, transcripts: [{ id: "v0", version: "t2", media: "sha" }] })],
    ["a new customer_request callback from a model run", () => hash(before.outreach, [...before.actions,
      promise({ _id: "650000000000000000000021", origin: "customer_request", description: "Customer asked for a call at 3" })])],
  ];
  for (const [name, compute] of cases) await t.test(name, () => {
    const value = compute();
    assert.notEqual(value, baseline);
  });
});

test("allow-lists: unknown origins, closures and completion bases are excluded by construction", () => {
  const result = fingerprintOutreachInputs(
    [record({ state: "closed", closed_reason: "x", closure_origin: "some_future_closure", responsible_agent_id: REP, assignment: { origin: "some_future_origin" } })],
    [promise({ origin: "some_future_origin" }), promise({ _id: "650000000000000000000030", status: "completed", completion_basis: "some_future_basis" })]);
  assert.deepEqual(result.outreach, [{ id: RECORD, subject: record().subject, closure: null, assignment: null }]);
  assert.equal(result.actions.length, 1, "an action with an unknown origin is dropped");
  assert.equal(result.actions[0].status, null, "an unknown completion basis never hashes the status");
});

test("only the listed action fields are hashed", () => {
  const [row] = fingerprintOutreachInputs([record()], [promise()]).actions;
  assert.deepEqual(Object.keys(row).sort(), ["description", "due", "id", "kind", "origin", "responsible", "status"]);
  assert.equal(row.responsible, null, "a model-assigned responsible rep is not hashed");
  assert.equal(fingerprintOutreachInputs([record()], [promise({ assignment: { origin: "owner" } })]).actions[0].responsible, REP);
});

test("deterministic: identical input hashes identically; record state is out", () => {
  assert.equal(hash(before.outreach, before.actions), hash(structuredClone(before.outreach), structuredClone(before.actions)));
  for (const state of ["unworked", "open", "waiting_on_customer", "identity_review"])
    assert.equal(hash([record({ ...before.outreach[0], state })], before.actions), baseline);
});

test("V-AC N3: the 200-action bound counts only fingerprinted origins; the read stays bounded", () => {
  const many = (n: number, origin: string) => Array.from({ length: n }, () => ({ origin }));
  assert.equal(actionsOverBound(many(200, "rep_promise")), false);
  assert.equal(actionsOverBound(many(201, "rep_promise")), true, "unchanged for fingerprinted actions");
  assert.equal(actionsOverBound([...many(150, "owner"), ...many(51, "customer_request")]), true);
  assert.equal(actionsOverBound(many(900, "system_default")), false, "missed episodes, retries and defaults no longer overflow a Number");
  assert.equal(actionsOverBound([...many(200, "rep_promise"), ...many(700, "system_default")]), false);
  assert.equal(actionsOverBound(many(ACTION_READ_LIMIT + 1, "system_default")), true, "the read itself is still bounded");
});

