import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import {
  ObservationIntegrityError,
  normalizeGranotReceipt,
  persistObservationCandidate,
  upsertGranotObservation,
  type ObservationStore,
  type NormalizedObservationCandidate,
} from "./normalization";

const capturedAt = new Date("2026-08-17T16:00:00.000Z");
const receiptId = new mongoose.Types.ObjectId("aaaaaaaaaaaaaaaaaaaaaaaa");

function candidate(
  overrides: Partial<NormalizedObservationCandidate> = {},
): NormalizedObservationCandidate {
  return {
    schema_version: 1,
    kind: "lead_snapshot",
    normalization_result: "valid",
    route_event_class: "lead_created",
    payload_event_type_raw: "lead_created",
    captured_at: capturedAt,
    identity: {},
    contact: {},
    move: {},
    priority: { raw: "1", canonical: "1", valid: true },
    booking_action: {},
    display_money: {},
    agent_identity: {},
    provider_context: {},
    issues: [],
    ...overrides,
  };
}

function memoryStore(): ObservationStore & {
  rows: Array<NormalizedObservationCandidate & { _id: mongoose.Types.ObjectId; receipt_id: mongoose.Types.ObjectId; createdAt: Date; updatedAt: Date }>;
  failNextInsert?: Error;
} {
  const rows: Array<
    NormalizedObservationCandidate & {
      _id: mongoose.Types.ObjectId;
      receipt_id: mongoose.Types.ObjectId;
      createdAt: Date;
      updatedAt: Date;
    }
  > = [];
  const store: ObservationStore & {
    rows: typeof rows;
    failNextInsert?: Error;
  } = {
    rows,
    async findByReceiptId(id) {
      return rows.find((row) => String(row.receipt_id) === String(id)) ?? null;
    },
    async insert(document) {
      if (store.failNextInsert) {
        const error = store.failNextInsert;
        store.failNextInsert = undefined;
        throw error;
      }
      if (rows.some((row) => String(row.receipt_id) === String(document.receipt_id))) {
        const error = new Error("duplicate");
        (error as { code?: number }).code = 11000;
        throw error;
      }
      const created = {
        ...document,
        _id: new mongoose.Types.ObjectId(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      rows.push(created);
      return created;
    },
  };
  return store;
}

test("[AC-05][AC-06] one receipt upserts one Observation and sequential reprocess reuses it", async () => {
  const store = memoryStore();
  const first = await persistObservationCandidate(
    { receipt_id: receiptId, candidate: candidate() },
    store,
  );
  const second = await persistObservationCandidate(
    { receipt_id: receiptId, candidate: candidate() },
    store,
  );
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(store.rows.length, 1);
  assert.equal(String(second.observation._id), String(first.observation._id));
});

test("[AC-05] concurrent same-candidate inserts collapse to one stored row", async () => {
  const rows: ReturnType<typeof memoryStore>["rows"] = [];
  let inserted = false;
  const store: ObservationStore = {
    async findByReceiptId() {
      return rows[0] ?? null;
    },
    async insert(document) {
      if (inserted) {
        const error = new Error("duplicate");
        (error as { code?: number }).code = 11000;
        throw error;
      }
      inserted = true;
      const created = {
        ...document,
        _id: new mongoose.Types.ObjectId(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      rows.push(created);
      return created;
    },
  };
  const [left, right] = await Promise.all([
    persistObservationCandidate({ receipt_id: receiptId, candidate: candidate() }, store),
    persistObservationCandidate({ receipt_id: receiptId, candidate: candidate() }, store),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(left.created !== right.created, true);
  assert.equal(String(left.observation._id), String(right.observation._id));
});

test("[AC-05] a differing candidate fails closed and does not overwrite stored evidence", async () => {
  const store = memoryStore();
  await persistObservationCandidate(
    { receipt_id: receiptId, candidate: candidate() },
    store,
  );
  await assert.rejects(
    persistObservationCandidate(
      {
        receipt_id: receiptId,
        candidate: candidate({ priority: { raw: "5", canonical: "5", valid: true } }),
      },
      store,
    ),
    (error: unknown) => {
      assert.ok(error instanceof ObservationIntegrityError);
      assert.equal(error.receipt_id, String(receiptId));
      return true;
    },
  );
  assert.equal(store.rows.length, 1);
  assert.equal(store.rows[0]?.priority.canonical, "1");
});

test("[AC-06] invalid and unsupported results persist as completed classifications", async () => {
  const store = memoryStore();
  const invalid = normalizeGranotReceipt({
    observation_channel: "granot_webhook",
    captured_at: capturedAt,
    route_event_class: "lead_created",
    payload: ["not-object"],
  });
  const persisted = await persistObservationCandidate(
    { receipt_id: receiptId, candidate: invalid },
    store,
  );
  assert.equal(persisted.created, true);
  assert.equal(persisted.observation.normalization_result, "invalid");
  assert.equal(store.rows.length, 1);
});

test("[AC-05] technical insert failure creates no partial second row", async () => {
  const store = memoryStore();
  store.failNextInsert = new Error("synthetic database unavailable");
  await assert.rejects(
    persistObservationCandidate({ receipt_id: receiptId, candidate: candidate() }, store),
    /synthetic database unavailable/,
  );
  assert.equal(store.rows.length, 0);
});

test("[AC-05][AC-29] upsertGranotObservation normalizes an already-read receipt without Registry or aggregate fields", async () => {
  const store = memoryStore();
  const result = await upsertGranotObservation(
    {
      receipt: {
        _id: receiptId,
        observation_channel: "granot_http_automation",
        captured_at: capturedAt,
        channel_operation_kind: "lead_snapshot_apply",
        channel_operation_id: "synthetic-run-ac29:synthetic-action-provider-type-auto",
        payload: { label: "Synthetic Forms", type: "AUTO" },
      },
    },
    store,
  );
  assert.equal(result.created, true);
  assert.equal(result.observation.provider_context.type_raw, "AUTO");
  assert.equal(result.observation.normalized_source_label, "synthetic forms");
  assert.equal("quoted" in result.observation, false);
  assert.equal("granot_crm_source_id" in result.observation, false);
});
