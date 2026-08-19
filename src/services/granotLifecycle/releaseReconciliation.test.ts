import assert from "node:assert/strict";
import { describe, it } from "node:test";
import mongoose from "mongoose";
import {
  classifyReleaseReconciliation,
  createGranotReleaseReconciliation,
  type PreparedReleaseReconciliationDecision,
  type ReleaseReconciliationCurrentContext,
  type ReleaseReconciliationPersistenceStore,
} from "./releaseReconciliation";
import type { GranotReleaseReconciliationCaseDocument } from "../../models/GranotReleaseReconciliationCase";
import type { SynchronizationDecisionDocument } from "../../models/SynchronizationDecision";

const oid = () => new mongoose.Types.ObjectId().toHexString();

function context(
  overrides: Partial<ReleaseReconciliationCurrentContext> = {},
): ReleaseReconciliationCurrentContext {
  return {
    observation_id: oid(),
    receipt_id: oid(),
    captured_at: new Date("2026-08-19T12:00:00.000Z"),
    normalized_job_no: "U26-JOB",
    job_no_snapshot: "U26 Job",
    booking_action: "release",
    identity: {
      outcome: "linked",
      reason_code: "record_link_established",
      match_method: "call_job_no_exact",
      target: { model: "CallLead", id: oid() },
      candidates: [],
      target_eligibility: "full",
    },
    ...overrides,
  };
}

describe("Release Reconciliation classification", () => {
  it("[AC-25] active deterministic Booking opens Release review even without a Lead", () => {
    const bookingId = oid();
    assert.deepEqual(
      classifyReleaseReconciliation(context({
        booking: {
          id: bookingId,
          domain_revision: 7,
          has_lead: false,
          officially_cancelled: false,
        },
      })),
      {
        kind: "case",
        deterministic_booking_id: bookingId,
        booking_revision_at_open: 7,
      },
    );
  });

  it("[AC-26] already officially cancelled Release is already-current and never a case", () => {
    const bookingId = oid();
    const cancellationId = oid();
    assert.deepEqual(
      classifyReleaseReconciliation(context({
        booking: {
          id: bookingId,
          domain_revision: 8,
          has_lead: true,
          officially_cancelled: true,
          cancellation_id: cancellationId,
        },
      })),
      {
        kind: "already_current",
        reason_code: "booking_already_cancelled",
        booking_id: bookingId,
        cancellation_id: cancellationId,
      },
    );
  });

  it("[AC-27] missing Booking and exact identity conflicts route to the typed discrepancy seam", () => {
    assert.deepEqual(classifyReleaseReconciliation(context()), {
      kind: "release_discrepancy_required",
      reason_code: "release_without_vantage_booking",
    });
    for (const [reason, expected] of [
      ["record_link_conflict", "release_record_link_conflict"],
      ["job_number_conflict", "release_job_number_conflict"],
      ["source_scope_conflict", "release_source_scope_conflict"],
    ] as const) {
      assert.deepEqual(
        classifyReleaseReconciliation(context({
          identity: { outcome: "conflict", reason_code: reason, candidates: [] },
        })),
        { kind: "release_discrepancy_required", reason_code: expected },
      );
    }
  });

  it("[AC-40] ignores non-Release evidence and never contact-selects a Booking", () => {
    assert.deepEqual(classifyReleaseReconciliation(context({ booking_action: "booked" })), {
      kind: "none",
      reason: "not_release_evidence",
    });
    assert.deepEqual(classifyReleaseReconciliation(context({ normalized_job_no: undefined })), {
      kind: "none",
      reason: "missing_job_number",
    });
  });
});

describe("Release Reconciliation persistence", () => {
  function prepared(current: ReleaseReconciliationCurrentContext): PreparedReleaseReconciliationDecision {
    return {
      receipt_id: new mongoose.Types.ObjectId(current.receipt_id),
      observation_id: new mongoose.Types.ObjectId(current.observation_id),
      attempt: 1,
      execution_mode: "live",
      outcome: "already_current",
      reason_code: "desired_state_already_current",
      candidates: [],
      evaluated_gates: [{ gate: "global_effect_flag", allowed: true }],
      effects: [],
      decided_at: new Date("2026-08-19T12:01:00.000Z"),
    };
  }

  function memoryStore(current: ReleaseReconciliationCurrentContext) {
    const cases: GranotReleaseReconciliationCaseDocument[] = [];
    const decisions: SynchronizationDecisionDocument[] = [];
    const store: ReleaseReconciliationPersistenceStore = {
      withTransaction: async (work) => work({} as never),
      loadCurrentContext: async () => current,
      findOpenCase: async (job) => cases.find(
        (row) => row.normalized_job_no === job && row.state === "open",
      ) ?? null,
      findMaxSequence: async (job) => Math.max(
        0,
        ...cases.filter((row) => row.normalized_job_no === job)
          .map((row) => row.sequence_number),
      ),
      insertCase: async (row) => {
        cases.push(row);
        return row;
      },
      refreshCase: async (input) => {
        const row = cases.find((candidate) => String(candidate._id) === String(input.case_id));
        assert.ok(row);
        if (!row.evidence.some(
          (evidence) => String(evidence.observation_id) === String(input.evidence.observation_id),
        )) {
          row.evidence.push(input.evidence);
          row.evidence_revision += 1;
          if (input.owner_state_changed) row.case_revision += 1;
          row.last_evidence_at = input.evidence.captured_at;
          row.observed_context = input.observed_context;
        }
        return row;
      },
      insertDecision: async (decision) => {
        decisions.push(decision);
      },
    };
    return { store, cases, decisions };
  }

  it("[AC-25] atomically opens and refreshes one Release case with immutable opening Booking revision", async () => {
    const bookingId = oid();
    const first = context({
      booking: {
        id: bookingId,
        domain_revision: 4,
        has_lead: false,
        officially_cancelled: false,
      },
    });
    const memory = memoryStore(first);
    const firstResult = await createGranotReleaseReconciliation({
      prepared: prepared(first),
      store: memory.store,
    }).reconcileObservation({ observation_id: first.observation_id, decision_id: oid() });
    assert.equal(firstResult.kind, "opened");
    assert.equal(memory.cases.length, 1);
    assert.equal(String(memory.cases[0]!.deterministic_booking_id), bookingId);
    assert.equal(memory.cases[0]!.booking_revision_at_open, 4);
    assert.equal(memory.decisions[0]!.reason_code, "release_case_opened");

    const second = context({
      observation_id: oid(),
      captured_at: new Date("2026-08-19T13:00:00.000Z"),
      booking: {
        id: bookingId,
        domain_revision: 5,
        has_lead: false,
        officially_cancelled: false,
      },
    });
    memory.store.loadCurrentContext = async () => second;
    const secondResult = await createGranotReleaseReconciliation({
      prepared: prepared(second),
      store: memory.store,
    }).reconcileObservation({ observation_id: second.observation_id, decision_id: oid() });
    assert.equal(secondResult.kind, "refreshed");
    assert.equal(memory.cases[0]!.case_revision, 2);
    assert.equal(memory.cases[0]!.evidence_revision, 2);
    assert.equal(memory.cases[0]!.booking_revision_at_open, 4);
  });
});
