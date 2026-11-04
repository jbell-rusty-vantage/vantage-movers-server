import assert from "node:assert/strict";
import { test } from "node:test";
import { finalFormWouldBeDuplicate, selectFinalLeadActions } from "./finalLeadSelection";
import type { FinalBookingGraph } from "./bookingGraph";
import type { BestRelocationPlanAction } from "../../src/services/bestRelocationSheetIngest/applicationPlan";

type Row = Record<string, any>;
const duplicates = (rows: Row[] = []) => ({ feeds: [{ id: "ld", local: "long_distance" as const }, { id: "local", local: "local" as const }], rows });
const emptyGraph = (): FinalBookingGraph => ({ version: "best-relocation-booking-bounded-v1", bookings: [], refunds: [], permitted_normal_leads: [],
  accounting: { booking_source_rows: 0, booking_identities: 0, booking_ready: 0, booking_conflicts: 0, collapsed_booking_responses: 0,
    definite_lead_matches: 0, leadless_bookings: 0, refund_source_rows: 0, refund_matches: 0, collapsed_refund_responses: 0, refund_review: 0 } });
function action(id: string, overrides: Partial<BestRelocationPlanAction> = {}): BestRelocationPlanAction {
  return { action_key: `form:${id}`, command: "create_form_lead", classification: "create", dataset_key: "forms", stable_source_row_id: `lead:${id}`,
    content_hash: "a".repeat(64), schema_profile: "forms:v2", schema_version: 2,
    provenance: { workbook_id: "source", workbook_title: "source", tab: "Forms", sheet_row: 2, source_row_key: id, raw: { "Bad Lead Checker": "" } },
    command_payload: { name: "Test Person", phone_number: "2125550100", timestamp: "2026-06-01T14:00:00Z", local: "long_distance" }, depends_on: [], ...overrides };
}
function withNote(id: string, note: string) {
  const row = action(id); if ("rows" in row.provenance) throw new Error("fixture"); row.provenance.raw["Bad Lead Checker"] = note; return row;
}
function select(actions: BestRelocationPlanAction[], extras: { graph?: FinalBookingGraph; rows?: Row[]; targets?: Map<string, Row> } = {}) {
  return selectFinalLeadActions({ actions, graph: extras.graph ?? emptyGraph(), targets: extras.targets ?? new Map(), duplicates: duplicates(extras.rows) });
}
function financial(id: string): BestRelocationPlanAction {
  return action(id, { action_key: `book:${id}`, command: "create_leadless_booking", classification: "leadless_booking", dataset_key: "booked_deals", stable_source_row_id: `booking:${id}`, depends_on: [] });
}

test("missing and existing unbooked normal rows are explicit skips with no executable payload", () => {
  const missing = action("missing"), existing = action("existing", { command: "adopt_existing", classification: "adoption", command_payload: undefined, adopted_entity_refs: [{ model: "FormLead", id: "saved" }] });
  const result = select([missing, existing], { targets: new Map([["FormLead:saved", { _id: "saved", duplicate: false }]]) });
  assert.equal(result.skipped.length, 2);
  assert.equal(result.booking_matches.length, 0);
  for (const row of result.actions) { assert.equal(row.command, "unchanged"); assert.equal(row.classification, "unchanged"); assert.equal(row.command_payload, undefined); assert.deepEqual(row.depends_on, []); }
  assert.deepEqual(result.actions[1].adopted_entity_refs, existing.adopted_entity_refs);
});

test("bad annotations including duplicate text remain exception entries independent of Booking", () => {
  for (const note of ["Bad phone", "Duplicate", "Duplicate Form"]) {
    const row = withNote("bad", note), result = select([row]);
    assert.equal(result.actions[0].command, "create_form_lead"); assert.equal(result.skipped.length, 0);
  }
  assert.equal(select([withNote("not-bad", "no")]).actions[0].command, "unchanged");
});

test("booked bad/duplicate targets retain exception actions and official financial actions", () => {
  const row = withNote("bad-booked", "Bad phone"); row.command = "adopt_existing"; row.classification = "adoption";
  row.adopted_entity_refs = [{ model: "FormLead", id: "saved" }]; delete row.command_payload;
  const book = financial("JOB"); book.command = "adopt_existing"; book.classification = "adoption"; book.adopted_entity_refs = [{ model: "BookedLead", id: "booked" }];
  const result = select([row, book], { targets: new Map([["FormLead:saved", { duplicate: true, booked: "booked" }]]) });
  assert.equal(result.actions[0].command, "adopt_existing"); assert.deepEqual(result.actions[1], book); assert.equal(result.skipped.length, 0);
});

test("later duplicate create depends on the earlier selected nonduplicate bad Form", () => {
  const first = withNote("first", "Bad phone"), second = action("second"); second.command_payload!.timestamp = "2026-06-02T14:00:00Z";
  const result = select([first, second]);
  assert.equal(result.actions[1].command, "create_form_lead");
  assert.deepEqual(result.actions[1].depends_on, [first.action_key]);
  assert.equal(result.skipped.length, 0);
  const withoutSelectedFirst = select([action("first"), second]);
  assert.equal(withoutSelectedFirst.skipped.length, 2);
});

test("definite Booking allows a new normal Form and supplies duplicate evidence for later source rows", () => {
  const first = action("booked"), second = action("later"); second.command_payload!.timestamp = "2026-06-02T14:00:00Z";
  const graph = emptyGraph(); graph.permitted_normal_leads.push({ dataset_key: "forms", stable_source_row_id: first.stable_source_row_id,
    booking_job: "JOB", method: "lid_ref_and_customer", evidence: ["exact_lid", "exact_customer", "source_channel:forms"] });
  const book = financial("JOB"), result = select([first, second, book], { graph });
  assert.equal(result.actions[0].command, "create_form_lead"); assert.equal(result.actions[0].matching?.method, "definite_booking");
  assert.deepEqual(result.booking_matches[0], { lead_action_key: first.action_key, booking_action_key: book.action_key, booking_identity: "booking:JOB",
    evidence: ["exact_lid", "exact_customer", "source_channel:forms", `booking_action:${book.action_key}`] });
  assert.deepEqual(result.actions[1].depends_on, [first.action_key]); assert.equal(result.skipped.length, 0);
});

test("an unresolved financial identity cannot authorize normal Lead creation", () => {
  const row = action("normal"), graph = emptyGraph(); graph.permitted_normal_leads.push({ dataset_key: "forms", stable_source_row_id: row.stable_source_row_id,
    booking_job: "JOB", method: "lid_ref_and_customer", evidence: ["exact_lid"] });
  const book = financial("JOB"); book.command = "record_conflict"; book.classification = "conflict";
  const result = select([row, book], { graph });
  assert.equal(result.actions[0].command, "unchanged"); assert.equal(result.booking_matches.length, 0); assert.equal(result.actions[1].command, "record_conflict");
});

test("excluded normal divergence preserves canonical references for reporting without a mutation", () => {
  const row = action("divergence", { command: "record_conflict", classification: "conflict", conflict: { type: "changed_protected_field", severity: "blocking" },
    adopted_entity_refs: [{ model: "FormLead", id: "saved" }] });
  const [selected] = select([row], { targets: new Map([["FormLead:saved", { duplicate: false }]]) }).actions;
  assert.equal(selected.command, "unchanged"); assert.equal(selected.command_payload, undefined); assert.equal(selected.conflict, undefined);
  assert.deepEqual(selected.adopted_entity_refs, [{ model: "FormLead", id: "saved" }]);
});

test("duplicate preview respects exact feed, strictly earlier instant and post-cutoff stored cohort", () => {
  const payload = action("normal").command_payload!;
  const same = { _id: "saved", source_granularity_id: "ld", phone_number: "(212) 555-0100", timestamp: new Date("2026-05-01T10:00:00Z"), duplicate: false };
  assert.equal(finalFormWouldBeDuplicate(payload, duplicates([same])), true);
  assert.equal(finalFormWouldBeDuplicate(payload, duplicates([{ ...same, source_granularity_id: "local" }])), false);
  assert.equal(finalFormWouldBeDuplicate(payload, duplicates([{ ...same, duplicate: true }])), false);
  assert.equal(finalFormWouldBeDuplicate(payload, duplicates([{ ...same, timestamp: new Date("2026-06-01T10:00:00Z") }])), false);
  assert.equal(finalFormWouldBeDuplicate(payload, duplicates([{ ...same, timestamp: new Date("2026-04-30T03:59:59.999Z") }])), false);
  assert.equal(finalFormWouldBeDuplicate(payload, duplicates([{ ...same, timestamp: new Date("2026-04-30T04:00:00.000Z") }])), true);
  assert.throws(() => finalFormWouldBeDuplicate(payload, { feeds: [], rows: [] }), /feed_ambiguous/);
});

test("bad and duplicate Calls remain exceptions; an unbooked normal Call stays excluded", () => {
  const call = (id: string, note: string, disposition: string): BestRelocationPlanAction => action(id, { command: "admit_final_best_relocation_call", dataset_key: "calls",
    provenance: { workbook_id: "source", workbook_title: "source", tab: "Calls", sheet_row: 2, source_row_key: id, raw: { "Form Fill Checker": note } },
    command_payload: { phone_number: "2125550100", timestamp: "2026-06-01T14:00:00Z", expected_disposition: disposition } });
  const result = select([call("bad", "Wrong number", "bad_call_leads"), call("duplicate", "", "duplicate_calls"), call("normal", "", "calls")]);
  assert.equal(result.actions[0].command, "admit_final_best_relocation_call"); assert.equal(result.actions[1].command, "admit_final_best_relocation_call");
  assert.equal(result.actions[2].command, "unchanged"); assert.equal(result.skipped.length, 1);
});
