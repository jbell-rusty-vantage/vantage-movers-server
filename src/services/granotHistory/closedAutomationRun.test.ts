import assert from "node:assert/strict";
import test from "node:test";
import { checkClosedOperation, packClosedRun, unpackClosedRun } from "./closedAutomationRun";
import { hashCredentialRedactedPayload } from "../granotLifecycle/receiptEvidence";
import { digest } from "./archiveCodec";

test("closed runs replay the exact original and refuse changed, unknown or misbound operations", () => {
  const run = "5f0000000000000000000000";
  const item = { operation_id: run + ":action", operation_kind: "lead_snapshot_apply" as const, granot_statement: { priority: 2 } };
  const operation = { operation:item.operation_id, kind:item.operation_kind, hash:hashCredentialRedactedPayload(item).payload_sha256,
    receipt:"receipt", result:{ decision_id:"decision",observation_id:"observation",outcome:"already_current" as const,effects:[] } };
  const bytes = packClosedRun(run,[operation]);
  const index = { _id:run,hash:digest(bytes),count:1,closed_at:new Date() };
  const rows = unpackClosedRun(index,bytes);
  assert.deepEqual(checkClosedOperation(rows,item,"receipt"),operation);
  assert.throws(()=>checkClosedOperation(rows,{...item,granot_statement:{priority:3}}));
  assert.throws(()=>checkClosedOperation(rows,{...item,operation_kind:"booking_action_apply"}));
  assert.throws(()=>checkClosedOperation(rows,{...item,operation_id:run+":new"}));
  assert.throws(()=>checkClosedOperation(rows,item,"wrong"));
  assert.throws(()=>unpackClosedRun({...index,hash:"0".repeat(64)},bytes));
  assert.throws(()=>packClosedRun(run,[operation,operation]));
});
