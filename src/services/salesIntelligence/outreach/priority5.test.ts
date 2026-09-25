/**
 * S6-P5 unit proofs (assignment addendum §2, E1/E2; reconciliation §4.2 G8), fixed clock.
 * The ensure-level cases (C1, C2, C22 on a real transaction) are in `scripts/dev_ops/test-si-priority5.replica.test.ts`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import {
  closureBasisFor, CRM_CLOSURE_REASONS, dispositionFor, dispositionLabel, isTerminal, priorityLabel, projectLeadProgress, TERMINAL_DISPOSITIONS, type ProgressEvidence,
} from "./leadProgress";
import { isGranotBookedUpgrade } from "./store";
import { closedOutcome, outcomeReason } from "./facts";
import { attentionMetrics } from "./attention";
import { leadProgressDto } from "./reads";
import { ATTENTION_OUTCOMES, attentionOutcomeDtoSchema, leadProgressDtoSchema, type AttentionRowDto } from "../dto";
import { fingerprintOutreachInputs, type FingerprintOutreachAction, type FingerprintOutreachRecord } from "../analysis/sources";
import { payloadHash } from "../transactions";
import { jsonValue } from "./store";

const FLAG = "SALES_INTELLIGENCE_PRIORITY5_CLOSURE";
const NOW = new Date("2026-09-24T15:00:00Z"), APPLIED = new Date("2026-09-24T14:00:00Z"), TRIGGER = new Date("2026-09-20T13:00:00Z");
const id = () => new mongoose.Types.ObjectId();
function withFlag<T>(value: string | undefined, run: () => T): T {
  const prior = process.env[FLAG];
  if (value === undefined) delete process.env[FLAG]; else process.env[FLAG] = value;
  try { return run(); } finally { if (prior === undefined) delete process.env[FLAG]; else process.env[FLAG] = prior; }
}
const change = (fields: ProgressEvidence["fields"]): ProgressEvidence => ({ change_id: id(), applied_at: APPLIED, source_system: "granot", fields });
const both = (fields: ProgressEvidence["fields"]) => { const one = change(fields); return { priority: one, quoted: one }; };

test("flag off: 5 keeps today's mapping (unmapped, 'Unknown meaning', nonterminal); a quoted 5 still vouches through Quoted", () => withFlag(undefined, () => {
  assert.equal(dispositionFor("5"), "unmapped"); assert.equal(priorityLabel("5"), "Unknown meaning"); assert.equal(isTerminal(dispositionFor("5")), false);
  const row = projectLeadProgress({ lead: { granot_priority: "5", quoted: true }, prior: null, evidence: both([{ path: "granot_priority", after: "5" }, { path: "quoted", after: true }]), now: NOW });
  assert.equal(row.disposition, "unmapped"); assert.equal(row.provenance, "accepted"); assert.equal(row.work_observed, true); assert.equal(row.basis, "quoted");
  // "false" and junk are off too.
  assert.equal(withFlag("false", () => dispositionFor("5")), "unmapped");
  assert.equal(withFlag("yes", () => dispositionFor("5")), "unmapped");
}));

test("flag on: 5 is crm_booked 'Booked in Granot', terminal, closure basis granot_booked; other codes unchanged", () => withFlag("true", () => {
  assert.equal(dispositionFor("5"), "crm_booked");
  assert.equal(priorityLabel("5"), "Booked in Granot"); assert.equal(dispositionLabel("crm_booked"), "Booked in Granot");
  assert.ok(isTerminal("crm_booked")); assert.ok(TERMINAL_DISPOSITIONS.includes("crm_booked"));
  assert.equal(closureBasisFor("crm_booked"), "granot_booked"); assert.ok((CRM_CLOSURE_REASONS as readonly string[]).includes("granot_booked"));
  for (const [code, disposition] of [["0", "fresh"], ["1", "quoted"], ["3", "rep_discretion"], ["7", "crm_bad_unusable"], ["8", "crm_dead"], ["9", "unmapped"], ["4", "unmapped"]] as const)
    assert.equal(dispositionFor(code), disposition, `code ${code}`);
  assert.equal(dispositionFor(null), "unknown");
}));

test("flag on: accepted 5 needs its own Priority change (like 7/8); Quoted evidence alone leaves it uncertain; 1 → 5 → 1 revisions differ", () => withFlag("true", () => {
  const accepted = projectLeadProgress({ lead: { granot_priority: "5", quoted: true }, prior: null, evidence: both([{ path: "granot_priority", before: "1", after: "5" }, { path: "quoted", after: true }]), now: NOW });
  assert.equal(accepted.disposition, "crm_booked"); assert.equal(accepted.provenance, "accepted"); assert.equal(accepted.last_progress_at?.toISOString(), APPLIED.toISOString());
  const quotedOnly = projectLeadProgress({ lead: { granot_priority: "5", quoted: true }, prior: null, evidence: { priority: null, quoted: change([{ path: "quoted", after: true }]) }, now: NOW });
  assert.equal(quotedOnly.provenance, "uncertain", "a terminal code is never vouched for by Quoted evidence");
  const one = projectLeadProgress({ lead: { granot_priority: "1", quoted: true }, prior: null, evidence: both([{ path: "granot_priority", after: "1" }]), now: NOW });
  const back = projectLeadProgress({ lead: { granot_priority: "1", quoted: true }, prior: accepted, evidence: both([{ path: "granot_priority", before: "5", after: "1" }]), now: NOW });
  assert.notEqual(accepted.disposition_revision, one.disposition_revision); assert.equal(back.disposition_revision, one.disposition_revision);
  assert.equal(back.disposition, "quoted"); assert.equal(back.work_observed, true);
}));

test("E2 upgrade rule: only an official booked over a crm_disposition granot_booked closure (C2)", () => {
  const closed = { state: "closed" as const, closure_origin: "crm_disposition" as const, closed_reason: "granot_booked" };
  assert.equal(isGranotBookedUpgrade(closed, "booked", "official"), true);
  assert.equal(isGranotBookedUpgrade(closed, "cancelled", "official"), false, "cancelled after granot_booked works as today");
  assert.equal(isGranotBookedUpgrade(closed, "booked", "owner"), false);
  assert.equal(isGranotBookedUpgrade({ ...closed, closed_reason: "granot_dead_opportunity" }, "booked", "official"), false, "7/8 → booked is today's re-close");
  assert.equal(isGranotBookedUpgrade({ ...closed, state: "open" as const }, "booked", "official"), false);
});

const record = (over: Record<string, unknown>) => ({ subject: { kind: "lead", model: "FormLead", id: id() }, state: "closed", trigger_at: TRIGGER,
  closed_at: new Date("2026-09-22T16:00:00Z"), lead_progress: { granot_priority: "5" }, ...over }) as never;

test("outcomes: crm_disposition granot_booked → granot_booked with the Priority label; after the upgrade the booked line (C2)", () => withFlag("true", () => {
  assert.ok((ATTENTION_OUTCOMES as readonly string[]).includes("granot_booked"));
  assert.equal(outcomeReason({ state: "closed", closure_origin: "crm_disposition", closed_reason: "granot_booked" }), "granot_booked");
  assert.equal(outcomeReason({ state: "closed", closure_origin: "official", closed_reason: "granot_booked" }), null, "only a CRM-disposition closure carries it");
  assert.equal(outcomeReason({ state: "open", closure_origin: null, closed_reason: null }), null);
  const granot = closedOutcome({ record: record({ closure_origin: "crm_disposition", closed_reason: "granot_booked" }), bookings: [], cancellations: [] }, 3)!;
  assert.deepEqual(attentionOutcomeDtoSchema.parse(granot), granot);
  assert.equal(granot.reason, "granot_booked"); assert.equal(granot.origin, "crm_disposition"); assert.deepEqual(granot.priority, { code: "5", label: "Booked in Granot" });
  assert.equal(granot.time_to_close_ms, +new Date("2026-09-22T16:00:00Z") - +TRIGGER); assert.equal(granot.booking, null);
  // Upgraded: same closed_at, official booked, time to close from book_date.
  const booking = { _id: id(), book_date: new Date("2026-09-23T00:00:00Z"), total_binder_amount: 1200, job_no: "J1" };
  const upgraded = closedOutcome({ record: record({ closure_origin: "official", closed_reason: "booked" }), bookings: [booking], cancellations: [] }, 3)!;
  assert.equal(upgraded.reason, "booked"); assert.equal(upgraded.closed_at, "2026-09-22T16:00:00.000Z"); assert.equal(upgraded.priority, null);
  // book_date is an ET calendar day at UTC midnight; it counts from the trigger's ET wall clock (13:00Z = 09:00 EDT → 09:00Z).
  assert.equal(upgraded.time_to_close_ms, +booking.book_date - +new Date("2026-09-20T09:00:00Z"), "2 d 15 h");
}));

test("metrics: booked_7d / booked_7d_median_days stay official-only (granot_booked never counts)", () => {
  const closedRow = (reason: string, days: number) => ({ partition: "closed", derived: { attention_band: null, reasons: [] }, outreach: { state: "closed" },
    outcome: { reason, closed_at: new Date(+NOW - 86_400_000).toISOString(), time_to_close_ms: days * 86_400_000 } }) as unknown as AttentionRowDto;
  const metrics = attentionMetrics([closedRow("granot_booked", 1), closedRow("granot_booked", 2), closedRow("booked", 4)], 0, NOW);
  assert.equal(metrics.booked_7d, 1); assert.equal(metrics.booked_7d_median_days, 4);
  const onlyGranot = attentionMetrics([closedRow("granot_booked", 1)], 0, NOW);
  assert.equal(onlyGranot.booked_7d, 0); assert.equal(onlyGranot.booked_7d_median_days, null);
});

test("lead_progress DTO: disposition crm_booked and closure basis granot_booked parse; flag-off rows parse unchanged", () => {
  const row = withFlag("true", () => projectLeadProgress({ lead: { granot_priority: "5", quoted: true }, prior: null, evidence: both([{ path: "granot_priority", after: "5" }]), now: NOW }));
  const subject = { kind: "lead" as const, model: "FormLead" as const, id: id() };
  const dto = leadProgressDto({ subject, lead_progress: row, closure_origin: "crm_disposition", closed_reason: "granot_booked", closed_at: NOW, first_attributable_outbound_at: null, first_human_conversation_at: null } as never)!;
  assert.equal(dto.disposition, "crm_booked"); assert.deepEqual(dto.closure, { basis: "granot_booked", closed_at: NOW.toISOString() });
  assert.deepEqual(leadProgressDtoSchema.parse(dto), dto);
  const off = withFlag(undefined, () => projectLeadProgress({ lead: { granot_priority: "5", quoted: false }, prior: null, evidence: both([{ path: "granot_priority", after: "5" }]), now: NOW }));
  const offDto = withFlag(undefined, () => leadProgressDto({ subject, lead_progress: off, closure_origin: null, closed_reason: null, closed_at: null, first_attributable_outbound_at: null, first_human_conversation_at: null } as never)!);
  assert.equal(offDto.disposition, "unmapped"); assert.equal(offDto.closure, null); assert.equal(offDto.priority_label, "Unknown meaning");
});

test("zero model calls: a Priority 5 closure leaves the Number fingerprint byte-identical; the E2 upgrade registers", () => {
  const RECORD = "650000000000000000000001", REP = "650000000000000000000003";
  const hash = (outreach: FingerprintOutreachRecord[], actions: FingerprintOutreachAction[]) => payloadHash(jsonValue(fingerprintOutreachInputs(outreach, actions)));
  const rec = (patch: Partial<FingerprintOutreachRecord>): FingerprintOutreachRecord => ({ _id: RECORD, subject: { kind: "lead", model: "FormLead", id: "650000000000000000000009" },
    state: "open", closed_reason: null, closure_origin: null, responsible_agent_id: REP, assignment: { origin: "first_conversation" }, ...patch });
  const action = (patch: Partial<FingerprintOutreachAction>): FingerprintOutreachAction => ({ _id: "650000000000000000000010", outreach_record_id: RECORD, kind: "call", description: "Call back",
    status: "open", due_at: new Date("2026-09-25T15:00:00Z"), origin: "rep_promise", responsible_agent_id: REP, assignment: { origin: "rep_promise" },
    completion_basis: null, cancel_reason: null, owner_instruction_ids: [], ...patch });
  const quoteDefault = action({ _id: "650000000000000000000011", origin: "system_default", description: "Follow up on the quote" });
  const open = hash([rec({})], [action({}), quoteDefault]);
  // closeRecord cancels every open action with the closure reason; an Owner-edited promise too.
  const closed = hash([rec({ state: "closed", closure_origin: "crm_disposition", closed_reason: "granot_booked" })],
    [action({ status: "cancelled", cancel_reason: "granot_booked" }), { ...quoteDefault, status: "cancelled", cancel_reason: "granot_booked" }]);
  assert.equal(closed, open, "a granot_booked closure (and its cancels) is not model input");
  const ownerEdited = (closure: Partial<FingerprintOutreachRecord>, status: string, cancel: string | null) =>
    hash([rec(closure)], [action({ status, cancel_reason: cancel, owner_instruction_ids: [id()] })]);
  assert.equal(ownerEdited({ state: "closed", closure_origin: "crm_disposition", closed_reason: "granot_booked" }, "cancelled", "granot_booked"),
    ownerEdited({}, "open", null), "an Owner-edited action cancelled by the closure is not an Owner cancel");
  const upgraded = hash([rec({ state: "closed", closure_origin: "official", closed_reason: "booked" })], [action({ status: "cancelled", cancel_reason: "granot_booked" })]);
  assert.notEqual(upgraded, open, "the official Booking (E2) is model input, as any official closure");
});
