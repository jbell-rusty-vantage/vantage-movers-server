import assert from "node:assert/strict";
import { describe, it } from "node:test";
import mongoose from "mongoose";
import {
  classifyBookingReconciliation,
  createGranotBookingReconciliation,
  isBookingCandidateRefreshEligible,
  projectBookingCandidateBrowserPolicy,
  projectBookingLeadCandidates,
  toBookingLeadSuggestion,
  type BookingReconciliationCurrentContext,
  type BookingReconciliationPersistenceStore,
  type PreparedBookingReconciliationDecision,
} from "./bookingReconciliation";

it("[AC-35] candidate browser preserves source scope metadata and override warning", () => {
  const policy = projectBookingCandidateBrowserPolicy({
    lead_ref: { model: "CallLead", id: "aaaaaaaaaaaaaaaaaaaaaaaa" },
    lead_normalized_job_no: "SYNTHETIC 23",
    lead_source_company: "bbbbbbbbbbbbbbbbbbbbbbbb",
    lead_source_granularity_id: "cccccccccccccccccccccccc",
    case_normalized_job_no: "SYNTHETIC 23",
    case_source_scope: {
      lead_source_company: "dddddddddddddddddddddddd",
      source_granularity_id: "eeeeeeeeeeeeeeeeeeeeeeee",
    },
    canonical_candidates: [],
  });
  assert.equal(policy.confidence, "high");
  assert.equal(policy.match_method, "call_job_no_exact");
  assert.equal(policy.in_source_scope, false);
  assert.equal(policy.requires_override_reason, true);
});
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
    ];
    assert.equal(
      classified.some((row) => row.kind === "case" && row.evidence_action === "priority_5"),
      false,
    );
  });

  it("[AC-18a] Referral Priority 5 only remains not_booking_evidence", () => {
    assert.deepEqual(
      classifyBookingReconciliation(context({
        lifecycle_disposition: "referral_booking",
        priority: { canonical: "5", valid: true },
        booking_action: undefined,
      })),
      { kind: "none", reason: "not_booking_evidence" },
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
  });

  it("[AC-19] actual Booked opens create-missing or review-existing and never treats ambiguity as no-case", () => {
    for (const priority of [
      undefined,
      { valid: false },
      { valid: true, canonical: "1" },
    ] as Array<BookingReconciliationCurrentContext["priority"] | undefined>) {
      const opened = classifyBookingReconciliation(
        context({ booking_action: "booked", priority }),
      );
      assert.equal(opened.kind, "case");
      assert.equal(opened.kind === "case" ? opened.mode : undefined, "create_missing_booking");
      assert.equal(opened.kind === "case" ? opened.evidence_action : undefined, "booked");
    }
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

  it("[AC-28][AC-39] delegates employee work, routes cancellation, and owns Referral cases", () => {
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
      source_policy: contextValue.reviewed_source_policy
        ? {
            granot_crm_source_id: new mongoose.Types.ObjectId(contextValue.reviewed_source_policy.granot_crm_source_id),
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

  it("[AC-19] atomically opens one create-missing case with causal evidence and Decision", async () => {
    clearCapturedOperationalEvents();
    const current = context({ booking_action: "booked" });
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
      (event) => event.input.eventKey === "granot_lifecycle.booking_case.opened",
    );
    assert.ok(audit);
    assert.equal(JSON.stringify(audit).includes(current.observation_id), false);
    assert.equal(JSON.stringify(audit).includes(decisionId), false);
    assert.equal(getGranotLifecycleOpenBookingCases("create_missing_booking"), 1);
  });

  it("[AC-20] refreshes new evidence without staling case revision and dedupes Observation replay", async () => {
    const first = context({ booking_action: "booked" });
    const memory = memoryStore(first);
    await createGranotBookingReconciliation({ prepared: prepared(first), store: memory.store })
      .reconcileObservation({ observation_id: first.observation_id, decision_id: oid() });
    const second = context({
      observation_id: oid(),
      booking_action: "booked",
      captured_at: new Date("2026-08-18T13:00:00.000Z"),
    });
    memory.store.loadCurrentContext = async () => second;
    const result = await createGranotBookingReconciliation({ prepared: prepared(second), store: memory.store })
      .reconcileObservation({ observation_id: second.observation_id, decision_id: oid() });
    assert.equal(result.kind, "refreshed");
    assert.equal(memory.cases[0]!.case_revision, 1);
    assert.equal(memory.cases[0]!.evidence_revision, 2);
    assert.equal(memory.cases[0]!.evidence.length, 2);
  });

  it("[AC-28] opens and refreshes a Referral case without Source Scope or Lead suggestion", async () => {
    const first = context({
      booking_action: "booked",
      lifecycle_disposition: "referral_booking",
      reviewed_source_policy: {
        granot_crm_source_id: oid(),
        disposition: "referral_booking",
        policy_version: "unit28-referral-v1",
      },
      priority: { valid: false },
    });
    const memory = memoryStore(first);
    await createGranotBookingReconciliation({ prepared: prepared(first), store: memory.store })
      .reconcileObservation({ observation_id: first.observation_id, decision_id: oid() });
    assert.equal(memory.cases[0]!.mode, "create_referral_booking");
    assert.equal(memory.cases[0]!.source_scope, undefined);
    assert.equal(memory.cases[0]!.suggested_lead, undefined);
    const second = context({
      observation_id: oid(),
      booking_action: "booked",
      lifecycle_disposition: "referral_booking",
      reviewed_source_policy: first.reviewed_source_policy,
      priority: { valid: false },
    });
    memory.store.loadCurrentContext = async () => second;
    await createGranotBookingReconciliation({ prepared: prepared(second), store: memory.store })
      .reconcileObservation({ observation_id: second.observation_id, decision_id: oid() });
    assert.equal(memory.cases[0]!.case_revision, 1);
    assert.equal(memory.cases[0]!.evidence_revision, 2);
    assert.equal(memory.cases[0]!.mode, "create_referral_booking");
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

  it("[AC-P1][AC-P8] persists Booked pairing snapshot, replay is a no-op, later Priority 5 does not write", async () => {
    const booked = context({
      booking_action: "booked",
      priority: { valid: true, canonical: "5" },
    });
    const memory = memoryStore(booked);
    const opened = await createGranotBookingReconciliation({
      prepared: prepared(booked),
      store: memory.store,
    }).reconcileObservation({ observation_id: booked.observation_id, decision_id: oid() });
    assert.equal(opened.kind, "opened");
    assert.equal(memory.cases[0]!.priority_pairing?.pairing, "booked_carries_priority_5");
    assert.equal(memory.cases[0]!.priority_pairing?.creating_booked_priority_is_5, true);
    assert.equal(memory.cases[0]!.evidence.length, 1);
    assert.equal(memory.cases[0]!.evidence[0]!.action, "booked");

    const snapshot = memory.cases[0]!.priority_pairing;
    const replay = await createGranotBookingReconciliation({
      prepared: prepared(booked),
      store: memory.store,
    }).reconcileObservation({ observation_id: booked.observation_id, decision_id: oid() });
    assert.equal(replay.kind, "refreshed");
    assert.equal(memory.cases[0]!.evidence.length, 1);
    assert.equal(memory.cases[0]!.evidence_revision, 1);
    assert.deepEqual(memory.cases[0]!.priority_pairing, snapshot);

    const laterPriority = context({
      observation_id: oid(),
      captured_at: new Date("2026-08-18T14:00:00.000Z"),
      priority: { valid: true, canonical: "5" },
    });
    memory.store.loadCurrentContext = async () => laterPriority;
    const ignored = await createGranotBookingReconciliation({
      prepared: prepared(laterPriority),
      store: memory.store,
    }).reconcileObservation({
      observation_id: laterPriority.observation_id,
      decision_id: oid(),
    });
    assert.deepEqual(ignored, { kind: "none", reason: "not_booking_evidence" });
    assert.equal(memory.cases[0]!.evidence.length, 1);
    assert.equal(memory.cases[0]!.evidence_revision, 1);
    assert.deepEqual(memory.cases[0]!.priority_pairing, snapshot);
    assert.equal(memory.decisions.length, 1);
  });

  it("[AC-P1] persist snapshot is priority_5_then_booked and evidence is Booked only", async () => {
    const precedingId = oid();
    const booked = context({
      booking_action: "booked",
      priority: { valid: true, canonical: "5" },
      captured_at: new Date("2026-08-18T13:00:00.000Z"),
    });
    const memory = memoryStore(booked);
    memory.store.listJobObservations = async () => [
      {
        _id: new mongoose.Types.ObjectId(precedingId),
        receipt_id: new mongoose.Types.ObjectId(),
        captured_at: new Date("2026-08-18T12:00:00.000Z"),
        route_event_class: "priority_updated",
        payload_event_type_raw: "Priority",
        identity: { normalized_job_no: booked.normalized_job_no },
        priority: { valid: true, canonical: "5" },
        booking_action: {},
      },
    ];
    await createGranotBookingReconciliation({
      prepared: prepared(booked),
      store: memory.store,
    }).reconcileObservation({ observation_id: booked.observation_id, decision_id: oid() });
    assert.equal(memory.cases[0]!.priority_pairing?.pairing, "priority_5_then_booked");
    assert.equal(
      String(memory.cases[0]!.priority_pairing?.preceding_priority_5_observation_id),
      precedingId,
    );
    assert.deepEqual(memory.cases[0]!.evidence.map((row) => row.action), ["booked"]);
  });

  it("[AC-P5] Releas writes no Booking case and later Booked refreshes the same open case", async () => {
    const first = context({ booking_action: "booked" });
    const memory = memoryStore(first);
    await createGranotBookingReconciliation({
      prepared: prepared(first),
      store: memory.store,
    }).reconcileObservation({ observation_id: first.observation_id, decision_id: oid() });
    const openId = String(memory.cases[0]!._id);

    const release = context({
      observation_id: oid(),
      booking_action: "release",
      captured_at: new Date("2026-08-18T12:30:00.000Z"),
    });
    memory.store.loadCurrentContext = async () => release;
    const ignored = await createGranotBookingReconciliation({
      prepared: prepared(release),
      store: memory.store,
    }).reconcileObservation({
      observation_id: release.observation_id,
      decision_id: oid(),
    });
    assert.deepEqual(ignored, { kind: "none", reason: "opposite_action_kind" });
    assert.equal(memory.cases.length, 1);
    assert.equal(memory.cases[0]!.evidence.length, 1);
    assert.equal(memory.cases[0]!.evidence_revision, 1);

    const later = context({
      observation_id: oid(),
      booking_action: "booked",
      captured_at: new Date("2026-08-18T13:00:00.000Z"),
    });
    memory.store.loadCurrentContext = async () => later;
    const refreshed = await createGranotBookingReconciliation({
      prepared: prepared(later),
      store: memory.store,
    }).reconcileObservation({ observation_id: later.observation_id, decision_id: oid() });
    assert.equal(refreshed.kind, "refreshed");
    assert.equal(memory.cases.length, 1);
    assert.equal(String(memory.cases[0]!._id), openId);
    assert.equal(memory.cases[0]!.evidence.length, 2);
    assert.equal(memory.cases[0]!.evidence_revision, 2);
  });

  it("[AC-P2][AC-P3][AC-P4] second Booked refreshes evidence and pairing snapshot", async () => {
    const first = context({
      booking_action: "booked",
      priority: { valid: true, canonical: "5" },
    });
    const memory = memoryStore(first);
    await createGranotBookingReconciliation({
      prepared: prepared(first),
      store: memory.store,
    }).reconcileObservation({ observation_id: first.observation_id, decision_id: oid() });
    assert.equal(memory.cases[0]!.priority_pairing?.pairing, "booked_carries_priority_5");

    const second = context({
      observation_id: oid(),
      booking_action: "booked",
      priority: { valid: false },
      captured_at: new Date("2026-08-18T13:00:00.000Z"),
    });
    memory.store.loadCurrentContext = async () => second;
    await createGranotBookingReconciliation({
      prepared: prepared(second),
      store: memory.store,
    }).reconcileObservation({ observation_id: second.observation_id, decision_id: oid() });
    assert.equal(memory.cases[0]!.evidence.length, 2);
    assert.equal(memory.cases[0]!.evidence_revision, 2);
    assert.equal(memory.cases[0]!.case_revision, 1);
    assert.equal(memory.cases[0]!.priority_pairing?.pairing, "booked_without_priority_5");
    assert.equal(memory.cases[0]!.priority_pairing?.creating_booked_priority_is_5, false);
    assert.equal(
      String(memory.cases[0]!.priority_pairing?.creating_booked_observation_id),
      second.observation_id,
    );

    const laterPriority = context({
      observation_id: oid(),
      captured_at: new Date("2026-08-18T14:00:00.000Z"),
      priority: { valid: true, canonical: "5" },
    });
    memory.store.loadCurrentContext = async () => laterPriority;
    const ignored = await createGranotBookingReconciliation({
      prepared: prepared(laterPriority),
      store: memory.store,
    }).reconcileObservation({
      observation_id: laterPriority.observation_id,
      decision_id: oid(),
    });
    assert.deepEqual(ignored, { kind: "none", reason: "not_booking_evidence" });
    assert.equal(memory.cases[0]!.evidence.length, 2);
    assert.equal(memory.cases[0]!.evidence_revision, 2);
    assert.equal(memory.cases[0]!.priority_pairing?.pairing, "booked_without_priority_5");
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
