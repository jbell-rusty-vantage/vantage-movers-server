import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import mongoose from "mongoose";
import { toObjectId } from "../../utils/objectId";
import {
  classifyBookingReconciliation,
  createGranotBookingReconciliation,
  toBookingLeadSuggestion,
  type BookingReconciliationCurrentContext,
  type BookingReconciliationPersistenceStore,
  type PreparedBookingReconciliationDecision,
} from "./bookingReconciliation";

import type { GranotBookingReconciliationCaseDocument } from "../../models/GranotBookingReconciliationCase";
import type { SynchronizationDecisionDocument } from "../../models/SynchronizationDecision";
import {
  clearCapturedDailyOperationsFacts,
} from "../dailyOperations/testDailyOperationsSink";

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
  it("[AC-18] Priority 5 never opens or refreshes a Booking case", () => {
    assert.deepEqual(classifyBookingReconciliation(context()), {
      kind: "none",
      reason: "not_booking_evidence",
    });
    assert.deepEqual(
      classifyBookingReconciliation(context({
        booking: { id: oid(), has_lead: true, officially_cancelled: false, referral: false },
      })),
      { kind: "none", reason: "not_booking_evidence" },
    );
    assert.deepEqual(
      classifyBookingReconciliation(context({
        identity: { outcome: "conflict", reason_code: "record_link_conflict", candidates: [] },
      })),
      { kind: "none", reason: "not_booking_evidence" },
    );
    const classified = [
      classifyBookingReconciliation(context()),
      classifyBookingReconciliation(context({ booking_action: "booked" })),
      classifyBookingReconciliation(context({ booking_action: "release" })),
    ];
    assert.equal(
      classified.some((row) => row.kind === "case" && row.evidence_action === "priority_5"),
      false,
    );
  });

  it("[AC-28][AC-39] delegates employee work, routes cancellation, and owns Referral cases", () => {
    const employeeCase = oid();
    assert.deepEqual(
      classifyBookingReconciliation(context({
        booking_action: "booked",
        booking: { id: oid(), has_lead: false, officially_cancelled: false, referral: false, booking_origin: "employee_booking", employee_reconciliation_case_id: employeeCase },
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
      { kind: "case", mode: "create_referral_booking", evidence_action: "booked" },
    );
    const referralBookingId = oid();
    assert.deepEqual(
      classifyBookingReconciliation(context({
        booking_action: "booked",
        lifecycle_disposition: "referral_booking",
        booking: {
          id: referralBookingId,
          has_lead: false,
          officially_cancelled: false,
          referral: true,
        },
      })),
      {
        kind: "case",
        mode: "review_existing_booking",
        evidence_action: "booked",
        deterministic_booking_id: referralBookingId,
      },
    );
    assert.deepEqual(
      classifyBookingReconciliation(context({
        booking_action: "booked",
        lifecycle_disposition: "source_scoped_lead",
        booking: {
          id: referralBookingId,
          has_lead: false,
          officially_cancelled: false,
          referral: true,
        },
      })),
      { kind: "booking_discrepancy_required", reason_code: "booked_booking_lead_conflict" },
    );
    assert.deepEqual(
      classifyBookingReconciliation(context({
        lifecycle_disposition: "referral_booking",
        priority: { canonical: "5", valid: true },
        booking_action: undefined,
      })),
      { kind: "none", reason: "not_booking_evidence" },
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
          booking_origin: "employee_booking",
          employee_reconciliation_case_id: employeeCase,
        },
      })).kind,
      "employee_booking_lead_reconciliation",
    );
  });

  it("[AC-40] excludes Bad/Duplicate or ambiguous suggestions", () => {
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

});

describe("Booking Reconciliation persistence", () => {
  afterEach(() => {
    clearCapturedDailyOperationsFacts();
  });

  function prepared(contextValue: BookingReconciliationCurrentContext): PreparedBookingReconciliationDecision {
    return {
      receipt_id: toObjectId(contextValue.receipt_id),
      observation_id: toObjectId(contextValue.observation_id),
      attempt: 1,
      execution_mode: "live",
      outcome: "already_current",
      reason_code: "desired_state_already_current",
      source_policy: contextValue.reviewed_source_policy
        ? {
            granot_crm_source_id: toObjectId(contextValue.reviewed_source_policy.granot_crm_source_id),
            disposition: contextValue.reviewed_source_policy.disposition,
            policy_version: contextValue.reviewed_source_policy.policy_version,
          }
        : undefined,
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
          if (input.priority_pairing) row.priority_pairing = input.priority_pairing;
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

  it("[AC-R4] officially cancelled Booking + Releas is already_current and writes no booking case", async () => {
    const bookingId = oid();
    const cancellationId = oid();
    const current = context({
      booking_action: "release",
      booking: {
        id: bookingId,
        has_lead: true,
        officially_cancelled: true,
        referral: false,
        cancellation_id: cancellationId,
      },
    });
    assert.deepEqual(classifyBookingReconciliation(current), {
      kind: "already_current",
      reason_code: "booking_already_cancelled",
      booking_id: bookingId,
      cancellation_id: cancellationId,
    });
    const memory = memoryStore(current);
    const result = await createGranotBookingReconciliation({
      prepared: prepared(current),
      store: memory.store,
    }).reconcileObservation({ observation_id: current.observation_id, decision_id: oid() });
    assert.deepEqual(result, {
      kind: "already_current",
      outcome: "already_current",
      reason_code: "booking_already_cancelled",
      target: { model: "CancelledLead", id: cancellationId },
    });
    assert.equal(memory.cases.length, 0);
    assert.equal(memory.decisions[0]!.outcome, "already_current");
    assert.equal(memory.decisions[0]!.reason_code, "booking_already_cancelled");
    assert.notEqual(memory.decisions[0]!.reason_code, "release_without_vantage_booking");
  });

  it("[AC-R5] officially cancelled Booking + Booked still opens booked_after_official_cancellation", async () => {
    const current = context({
      booking_action: "booked",
      booking: { id: oid(), has_lead: true, officially_cancelled: true, referral: false },
    });
    assert.deepEqual(classifyBookingReconciliation(current), {
      kind: "booking_discrepancy_required",
      reason_code: "booked_after_official_cancellation",
    });
    const memory = memoryStore(current);
    const result = await createGranotBookingReconciliation({
      prepared: prepared(current),
      store: memory.store,
    }).reconcileObservation({ observation_id: current.observation_id, decision_id: oid() });
    assert.deepEqual(result, {
      kind: "booking_discrepancy_required",
      reason_code: "booked_after_official_cancellation",
    });
    assert.equal(memory.cases.length, 0);
  });

  it("[AC-R6] identity conflict on Release opens a release_* discrepancy and no booking case", async () => {
    for (const [reason, expected] of [
      ["record_link_conflict", "release_record_link_conflict"],
      ["job_number_conflict", "release_job_number_conflict"],
      ["source_scope_conflict", "release_source_scope_conflict"],
    ] as const) {
      const current = context({
        booking_action: "release",
        identity: { outcome: "conflict", reason_code: reason, candidates: [] },
      });
      assert.deepEqual(classifyBookingReconciliation(current), {
        kind: "booking_discrepancy_required",
        reason_code: expected,
      });
      const memory = memoryStore(current);
      const result = await createGranotBookingReconciliation({
        prepared: prepared(current),
        store: memory.store,
      }).reconcileObservation({ observation_id: current.observation_id, decision_id: oid() });
      assert.deepEqual(result, {
        kind: "booking_discrepancy_required",
        reason_code: expected,
      });
      assert.equal(memory.cases.length, 0);
    }
  });

  it("actual Booked on a Granot official Leadless Booking opens review_existing_booking", async () => {
    const bookingId = oid();
    assert.deepEqual(
      classifyBookingReconciliation(context({
        booking_action: "booked",
        booking: {
          id: bookingId,
          has_lead: false,
          officially_cancelled: false,
          referral: false,
        },
      })),
      {
        kind: "case",
        mode: "review_existing_booking",
        evidence_action: "booked",
        deterministic_booking_id: bookingId,
      },
    );
    const current = context({
      booking_action: "booked",
      booking: {
        id: bookingId,
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
    assert.equal(result.kind, "opened");
    assert.equal(memory.cases.length, 1);
    assert.equal(memory.cases[0]?.mode, "review_existing_booking");
    assert.equal(String(memory.cases[0]?.deterministic_booking_id), bookingId);
    assert.deepEqual(
      classifyBookingReconciliation(context({
        booking_action: "release",
        booking: {
          id: bookingId,
          has_lead: false,
          officially_cancelled: false,
          referral: false,
        },
      })),
      {
        kind: "case",
        mode: "review_existing_booking",
        evidence_action: "release",
        deterministic_booking_id: bookingId,
      },
    );
  });
});
