import assert from "node:assert/strict";
import { test } from "node:test";
import type { ClientSession } from "mongoose";
import type { GranotAutomationActionReceipt } from "../granotLifecycle/automationApply";
import { refreshExistingEstimatesOutreach } from "./estimatesOutreachRefresh";

const receipt: GranotAutomationActionReceipt = { action_id: "synthetic-action", lifecycle_receipt_id: "a".repeat(24), decision_id: "b".repeat(24), outcome: "already_current", applied_at: new Date("2026-10-14T17:00:00Z") };
const session = {} as ClientSession;

test("shadow/suppressed/held/failed/missing-target decisions and absent or closed subjects cannot enroll or refresh", async () => {
  for (const decision of [null, { execution_mode: "shadow", outcome: "applied" }, { execution_mode: "live", outcome: "suppressed" }, { execution_mode: "live", outcome: "already_current" }, { execution_mode: "live", outcome: "linked", target: { model: "Booking", id: "c".repeat(24) } }]) {
    assert.equal(await refreshExistingEstimatesOutreach(receipt, {
      transaction: async (work) => work(session), decision: async () => decision,
      openSubject: async () => { throw new Error("No authoritative successful Lead target"); },
      enqueue: async () => { throw new Error("Must never enqueue"); },
    }), "skipped");
  }
  assert.equal(await refreshExistingEstimatesOutreach(receipt, {
    transaction: async (work) => work(session), decision: async () => ({ execution_mode: "live", outcome: "linked", target: { model: "FormLead", id: "c".repeat(24) } }),
    openSubject: async () => false, enqueue: async () => { throw new Error("Absent/closed subjects must never enroll"); },
  }), "skipped");
});
