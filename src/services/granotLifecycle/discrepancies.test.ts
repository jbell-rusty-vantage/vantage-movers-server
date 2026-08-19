import assert from "node:assert/strict";
import { describe, it } from "node:test";
import mongoose from "mongoose";
import {
  createDiscrepancyFingerprint,
  createGranotDiscrepancies,
  type DiscrepancyPersistenceStore,
  type PreparedDiscrepancyDecision,
} from "./discrepancies";

describe("Granot discrepancy fingerprint", () => {
  it("[AC-35][AC-36] freezes versioned canonical non-PII identity", () => {
    assert.equal(
      createDiscrepancyFingerprint({
        discrepancy_kind: "booking",
        normalized_job_no: "U29JOB1",
        reason_code: "booked_record_link_conflict",
        record_link_id: "64B000000000000000000001",
        lead_ref: {
          model: "FormLead",
          id: "64B000000000000000000002",
        },
      }),
      "7fa176a2b2a5a499b106576d5b215022af961c5365f1e741682e81fb2ef94368",
    );
  });

  it("[AC-26][AC-27][AC-35] includes every null identity key and excludes evidence/display data", () => {
    const base = createDiscrepancyFingerprint({
      discrepancy_kind: "release",
      normalized_job_no: "U29JOB2",
      reason_code: "release_without_vantage_booking",
    });
    assert.match(base, /^[a-f0-9]{64}$/);
    assert.notEqual(
      base,
      createDiscrepancyFingerprint({
        discrepancy_kind: "release",
        normalized_job_no: "U29JOB2",
        reason_code: "release_without_vantage_booking",
        booking_id: "64b000000000000000000003",
      }),
    );
  });
});

describe("Granot discrepancy persistence", () => {
  const receiptId = new mongoose.Types.ObjectId();
  const prepared = (observationId: mongoose.Types.ObjectId): PreparedDiscrepancyDecision => ({
    receipt_id: receiptId,
    observation_id: observationId,
    attempt: 1,
    execution_mode: "live",
    outcome: "conflict",
    reason_code: "record_link_conflict",
    candidates: [],
    evaluated_gates: Array.from({ length: 8 }, (_, index) => ({
      gate: `gate-${index}`,
      allowed: true,
    })) as PreparedDiscrepancyDecision["evaluated_gates"],
    effects: [],
    decided_at: new Date("2026-08-19T01:00:00.000Z"),
  });

  it("[AC-26][AC-36] opens, refreshes, and exactly deduplicates one fingerprint", async () => {
    const memory = createMemoryStore();
    const firstObservation = new mongoose.Types.ObjectId();
    memory.contexts.set(String(firstObservation), {
      observation_id: String(firstObservation),
      receipt_id: String(receiptId),
      normalized_job_no: "U29OPEN1",
      captured_at: new Date("2026-08-19T01:00:00.000Z"),
      action: "booked",
      classified_reason_code: "booked_after_official_cancellation",
      booking_id: String(new mongoose.Types.ObjectId()),
      cancellation_id: String(new mongoose.Types.ObjectId()),
    });
    const opened = await createGranotDiscrepancies({
      prepared: prepared(firstObservation),
      store: memory.store,
    }).reconcileObservation({
      discrepancy_kind: "booking",
      reason_code: "booked_after_official_cancellation",
      observation_id: String(firstObservation),
      decision_id: String(new mongoose.Types.ObjectId()),
    });
    assert.equal(opened.kind, "opened");
    assert.equal(memory.rows.length, 1);
    assert.equal(memory.rows[0]!.revision, 1);
    assert.equal(memory.rows[0]!.evidence_revision, 1);

    const secondObservation = new mongoose.Types.ObjectId();
    memory.contexts.set(String(secondObservation), {
      ...memory.contexts.get(String(firstObservation))!,
      observation_id: String(secondObservation),
      captured_at: new Date("2026-08-19T02:00:00.000Z"),
    });
    const refreshed = await createGranotDiscrepancies({
      prepared: prepared(secondObservation),
      store: memory.store,
    }).reconcileObservation({
      discrepancy_kind: "booking",
      reason_code: "booked_after_official_cancellation",
      observation_id: String(secondObservation),
      decision_id: String(new mongoose.Types.ObjectId()),
    });
    assert.equal(refreshed.kind, "refreshed");
    assert.equal(memory.rows.length, 1);
    assert.equal(memory.rows[0]!.evidence_revision, 2);
    assert.equal(memory.rows[0]!.revision, 1);
  });
});

function createMemoryStore() {
  const contexts = new Map<string, Awaited<ReturnType<DiscrepancyPersistenceStore["loadCurrentContext"]>>>();
  const rows: Array<import("../../models/granotDiscrepancyModel").GranotDiscrepancyDocument> = [];
  const decisions: unknown[] = [];
  const store: DiscrepancyPersistenceStore = {
    withTransaction: async (work) => work({} as never),
    loadCurrentContext: async (_kind, observationId) => contexts.get(observationId)!,
    findOpen: async (_kind, fingerprint) =>
      rows.find((row) => row.state === "open" && row.reason_fingerprint === fingerprint) ?? null,
    insert: async (_kind, row) => {
      rows.push(row);
      return row;
    },
    refresh: async (_kind, input) => {
      const row = rows.find((candidate) => String(candidate._id) === String(input.discrepancy_id))!;
      if (!row.evidence.some((item) => String(item.observation_id) === String(input.evidence.observation_id))) {
        row.evidence.push(input.evidence);
        row.evidence_revision += 1;
        row.last_evidence_at = input.evidence.captured_at;
      }
      return row;
    },
    insertDecision: async (decision) => { decisions.push(decision); },
  };
  return { contexts, rows, decisions, store };
}
