import assert from "node:assert/strict";
import { describe, it } from "node:test";
import mongoose from "mongoose";
import {
  classifyBookingReconciliation,
  createGranotBookingReconciliation,
  isBookingCandidateRefreshEligible,
  projectBookingLeadCandidates,
  toBookingLeadSuggestion,
  type BookingReconciliationCurrentContext,
  type BookingReconciliationPersistenceStore,
  type PreparedBookingReconciliationDecision,
} from "./bookingReconciliation";
import type { GranotBookingReconciliationCaseDocument } from "../../models/GranotBookingReconciliationCase";
import type { SynchronizationDecisionDocument } from "../../models/SynchronizationDecision";
import {
  clearCapturedOperationalEvents,
  getCapturedOperationalEvents,
} from "../observability";
import { getGranotLifecycleOpenBookingCases } from "./metrics";

const oid = () => new mongoose.Types.ObjectId().toHexString();

function context(
  overrides: Partial<BookingReconciliationCurrentContext> = {},
): BookingReconciliationCurrentContext {
  return {
    observation_id: oid(),
    receipt_id: oid(),
    captured_at: new Date("2026-08-18T12:00:00.000Z"),
    normalized_job_no: "JOB-22",
    job_no_snapshot: "Job 22",
    priority: { canonical: "5", valid: true },
    booking_action: undefined,
    identity: {
      outcome: "linked",
      reason_code: "record_link_established",
      match_method: "form_ref_no_exact",
      target: { model: "FormLead", id: oid() },
      candidates: [],
      target_eligibility: "full",
    },
    ...overrides,
  };
}

describe("Booking Reconciliation classification", () => {
  it("[AC-18] Priority 5 opens create-missing only for an eligible matched Lead without Booking", () => {
    assert.deepEqual(classifyBookingReconciliation(context()), {
      kind: "case",
      mode: "create_missing_booking",
      evidence_action: "priority_5",
    });
    assert.deepEqual(
      classifyBookingReconciliation(context({ booking: { id: oid(), has_lead: true, officially_cancelled: false, referral: false } })),
      { kind: "none", reason: "priority_5_existing_booking" },
    );
    assert.deepEqual(
      classifyBookingReconciliation(context({ identity: { outcome: "conflict", reason_code: "record_link_conflict", candidates: [] } })),
      { kind: "booking_discrepancy_required", reason_code: "booked_record_link_conflict" },
    );
  });

  it("[AC-19] actual Booked opens create-missing or review-existing and never treats ambiguity as no-case", () => {
    const missing = classifyBookingReconciliation(
      context({ booking_action: "booked", priority: { valid: false } }),
    );
    assert.equal(missing.kind, "case");
    assert.equal(missing.kind === "case" ? missing.mode : undefined, "create_missing_booking");
    const bookingId = oid();
    assert.deepEqual(
      classifyBookingReconciliation(context({
        booking_action: "booked",
        booking: { id: bookingId, has_lead: true, officially_cancelled: false, referral: false },
      })),
      { kind: "case", mode: "review_existing_booking", evidence_action: "booked", deterministic_booking_id: bookingId },
    );
    assert.equal(
      classifyBookingReconciliation(context({
        booking_action: "booked",
        identity: { outcome: "ambiguous", reason_code: "multiple_eligible_matches", candidates: [] },
      })).kind,
      "case",
    );
  });

  it("[AC-39] delegates Booking-without-Lead and routes cancellation/referral without Granot case", () => {
    const employeeCase = oid();
    assert.deepEqual(
      classifyBookingReconciliation(context({
        booking_action: "booked",
        booking: { id: oid(), has_lead: false, officially_cancelled: false, referral: false, employee_reconciliation_case_id: employeeCase },
      })),
      { kind: "employee_booking_lead_reconciliation", case_id: employeeCase },
    );
    assert.deepEqual(
      classifyBookingReconciliation(context({
        booking_action: "booked",
        booking: { id: oid(), has_lead: true, officially_cancelled: true, referral: false },
      })),
      { kind: "booking_discrepancy_required", reason_code: "booked_after_official_cancellation" },
    );
    assert.deepEqual(
      classifyBookingReconciliation(context({
        booking_action: "booked",
        lifecycle_disposition: "referral_booking",
      })),
      { kind: "none", reason: "referral_owned_by_unit_28" },
    );
    assert.equal(
      classifyBookingReconciliation(context({
        booking_action: "booked",
        identity: { outcome: "conflict", reason_code: "job_number_conflict", candidates: [] },
        booking: {
          id: oid(),
          has_lead: false,
          officially_cancelled: false,
          referral: false,
          employee_reconciliation_case_id: employeeCase,
        },
      })).kind,
      "employee_booking_lead_reconciliation",
    );
  });

  it("[AC-40] ignores Release work and excludes Bad/Duplicate or ambiguous suggestions", () => {
    assert.deepEqual(classifyBookingReconciliation(context({ booking_action: "release" })), {
      kind: "none",
      reason: "opposite_action_kind",
    });
    assert.equal(toBookingLeadSuggestion(context().identity)?.confidence, "high");
    assert.equal(toBookingLeadSuggestion({
      ...context().identity,
      match_method: "source_scoped_contact",
    })?.confidence, "medium");
    assert.equal(toBookingLeadSuggestion({
      outcome: "linked",
      reason_code: "bad_form_lead_priority_only",
      match_method: "form_ref_no_exact",
      target: { model: "FormLead", id: oid() },
      candidates: [],
      target_eligibility: "priority_only",
    }), undefined);
    assert.equal(toBookingLeadSuggestion({
      outcome: "ambiguous",
      reason_code: "multiple_eligible_matches",
      candidates: [],
    }), undefined);
  });

  it("[AC-18][AC-19] projects only canonical eligible candidates and bounds refresh to 24 hours", () => {
    const eligible = oid();
    const duplicate = oid();
    const projected = projectBookingLeadCandidates({
      outcome: "ambiguous",
      reason_code: "multiple_eligible_matches",
      candidates: [
        { target: { model: "FormLead", id: eligible }, reason_codes: ["source_scoped_contact"] },
        { target: { model: "FormLead", id: duplicate }, reason_codes: ["duplicate_form_lead_ineligible"] },
      ],
    });
    assert.deepEqual(projected, [{
      lead_ref: { model: "FormLead", id: eligible },
      confidence: "medium",
      match_method: "source_scoped_contact",
      reason_codes: ["source_scoped_contact"],
      suggested: false,
    }]);
    const opened = new Date("2026-08-18T12:00:00.000Z");
    assert.equal(isBookingCandidateRefreshEligible(opened, new Date("2026-08-19T12:00:00.000Z")), true);
    assert.equal(isBookingCandidateRefreshEligible(opened, new Date("2026-08-19T12:00:00.001Z")), false);
  });
});

describe("Booking Reconciliation persistence", () => {
  function prepared(contextValue: BookingReconciliationCurrentContext): PreparedBookingReconciliationDecision {
    return {
      receipt_id: new mongoose.Types.ObjectId(contextValue.receipt_id),
      observation_id: new mongoose.Types.ObjectId(contextValue.observation_id),
      attempt: 1,
      execution_mode: "live",
      outcome: "already_current",
      reason_code: "desired_state_already_current",
      candidates: [],
      evaluated_gates: [{ gate: "global_effect_flag", allowed: true }],
      effects: [],
      decided_at: new Date("2026-08-18T12:01:00.000Z"),
    };
  }

  function memoryStore(contextValue: BookingReconciliationCurrentContext) {
    const cases: GranotBookingReconciliationCaseDocument[] = [];
    const decisions: SynchronizationDecisionDocument[] = [];
    const store: BookingReconciliationPersistenceStore = {
      withTransaction: async (work) => work({} as never),
      loadCurrentContext: async () => contextValue,
      findOpenCase: async (job) => cases.find((row) => row.normalized_job_no === job && row.state === "open") ?? null,
      findMaxSequence: async (job) => Math.max(0, ...cases.filter((row) => row.normalized_job_no === job).map((row) => row.sequence_number)),
      insertCase: async (row) => { cases.push(row); return row; },
      refreshCase: async (input) => {
        const row = cases.find((candidate) => String(candidate._id) === String(input.case_id));
        assert.ok(row);
        if (!row.evidence.some((evidence) => String(evidence.observation_id) === String(input.evidence.observation_id))) {
          row.evidence.push(input.evidence);
          row.evidence_revision += 1;
          row.last_evidence_at = input.evidence.captured_at;
          row.observed_context = input.observed_context;
        }
        return row;
      },
      insertDecision: async (decision) => { decisions.push(decision); },
      countOpenCasesByMode: async () => [
        {
          mode: "create_missing_booking",
          count: cases.filter((row) => row.state === "open" && row.mode === "create_missing_booking").length,
        },
      ],
    };
    return { store, cases, decisions };
  }

  it("[AC-18] atomically opens one create-missing case with causal evidence and Decision", async () => {
    clearCapturedOperationalEvents();
    const current = context();
    const memory = memoryStore(current);
    const decisionId = oid();
    const service = createGranotBookingReconciliation({
      prepared: prepared(current),
      store: memory.store,
    });
    const result = await service.reconcileObservation({
      observation_id: current.observation_id,
      decision_id: decisionId,
    });
    assert.equal(result.kind, "opened");
    assert.equal(memory.cases.length, 1);
    assert.equal(memory.cases[0]!.mode, "create_missing_booking");
    assert.equal(memory.cases[0]!.case_revision, 1);
    assert.equal(memory.cases[0]!.evidence_revision, 1);
    assert.equal(String(memory.cases[0]!.evidence[0]!.decision_id), decisionId);
    assert.equal(memory.decisions[0]!.reason_code, "booking_case_opened");
    assert.equal(memory.decisions[0]!.effects[0]!.kind, "booking_case_opened");
    const audit = getCapturedOperationalEvents().find(
      (event) => event.input.eventKey === "granot_lifecycle.booking_case_opened",
    );
    assert.ok(audit);
    assert.equal(JSON.stringify(audit).includes(current.observation_id), false);
    assert.equal(JSON.stringify(audit).includes(decisionId), false);
    assert.equal(getGranotLifecycleOpenBookingCases("create_missing_booking"), 1);
  });

  it("[AC-20] refreshes new evidence without staling case revision and dedupes Observation replay", async () => {
    const first = context();
    const memory = memoryStore(first);
    await createGranotBookingReconciliation({ prepared: prepared(first), store: memory.store })
      .reconcileObservation({ observation_id: first.observation_id, decision_id: oid() });
    const second = context({ observation_id: oid(), captured_at: new Date("2026-08-18T13:00:00.000Z") });
    memory.store.loadCurrentContext = async () => second;
    const result = await createGranotBookingReconciliation({ prepared: prepared(second), store: memory.store })
      .reconcileObservation({ observation_id: second.observation_id, decision_id: oid() });
    assert.equal(result.kind, "refreshed");
    assert.equal(memory.cases[0]!.case_revision, 1);
    assert.equal(memory.cases[0]!.evidence_revision, 2);
    assert.equal(memory.cases[0]!.evidence.length, 2);
  });

  it("[AC-20] allocates next sequence after a resolved case and never reopens it", async () => {
    const first = context({ booking_action: "booked" });
    const memory = memoryStore(first);
    await createGranotBookingReconciliation({ prepared: prepared(first), store: memory.store })
      .reconcileObservation({ observation_id: first.observation_id, decision_id: oid() });
    memory.cases[0]!.state = "resolved";
    const second = context({ observation_id: oid(), booking_action: "booked" });
    memory.store.loadCurrentContext = async () => second;
    await createGranotBookingReconciliation({ prepared: prepared(second), store: memory.store })
      .reconcileObservation({ observation_id: second.observation_id, decision_id: oid() });
    assert.deepEqual(memory.cases.map((row) => row.sequence_number), [1, 2]);
    assert.equal(memory.cases[0]!.state, "resolved");
  });

  it("[AC-39] fails closed when expected employee reconciliation work is absent", async () => {
    const current = context({
      booking_action: "booked",
      booking: {
        id: oid(),
        has_lead: false,
        officially_cancelled: false,
        referral: false,
      },
    });
    const memory = memoryStore(current);
    const result = await createGranotBookingReconciliation({
      prepared: prepared(current),
      store: memory.store,
    }).reconcileObservation({ observation_id: current.observation_id, decision_id: oid() });
    assert.deepEqual(result, { kind: "none", reason: "employee_reconciliation_missing" });
    assert.equal(memory.cases.length, 0);
    assert.equal(memory.decisions.length, 1);
  });
});
