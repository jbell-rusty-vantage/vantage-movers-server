import { BSON, type Db } from "mongodb";
import { gzipSync, gunzipSync } from "node:zlib";
import { digest } from "./archiveCodec";
import type { GranotApplyItem } from "../granotLifecycle/applyItem";
import { hashCredentialRedactedPayload } from "../granotLifecycle/receiptEvidence";
import { OperationIdempotencyConflictError } from "../granotLifecycle/errors";
import type { ProcessorResult } from "../granotLifecycle/drainer";

export type ClosedOperation = {
  operation: string; kind: string; hash: string; receipt: string; result: ProcessorResult;
};
type RunIndex = { _id: string; hash: string; count: number; closed_at: Date };
export const closedRuns = (db: Db) => db.collection<RunIndex>("granot_closed_automation_runs");
export const automationRunId = (operation: string) => /^([a-f0-9]{24}):.+$/i.exec(operation)?.[1] ?? null;

export function checkClosedOperation(rows: ClosedOperation[], item: GranotApplyItem, receiptId?: string) {
  const row = rows.find(r => r.operation === item.operation_id);
  if (!row || row.kind !== item.operation_kind || row.hash !== hashCredentialRedactedPayload(item).payload_sha256 ||
      (receiptId && row.receipt !== receiptId)) throw new OperationIdempotencyConflictError();
  return row;
}
export function packClosedRun(run: string, rows: ClosedOperation[]) {
  if (!rows.length || rows.length > 5000 || rows.some(r => automationRunId(r.operation) !== run)
    || new Set(rows.map(r => r.operation)).size !== rows.length) throw new Error("Invalid closed Granot run");
  const raw = BSON.serialize({ version: 1, run, rows: [...rows].sort((a,b) => a.operation.localeCompare(b.operation)) });
  if (raw.length > 8 * 1024 * 1024) throw new Error("Closed Granot run too large");
  return gzipSync(raw);
}
export function unpackClosedRun(index: RunIndex, bytes: Buffer): ClosedOperation[] {
  if (digest(bytes) !== index.hash) throw new Error("Closed Granot run checksum mismatch");
  const data = BSON.deserialize(gunzipSync(bytes, { maxOutputLength: 8 * 1024 * 1024 }));
  if (data.version !== 1 || data.run !== index._id || !Array.isArray(data.rows) || data.rows.length !== index.count) {
    throw new Error("Closed Granot run index mismatch");
  }
  return data.rows;
}
export async function readClosedRun(db: Db, run: string) {
  const index = await closedRuns(db).findOne({ _id: run });
  if (!index) return null;
  const { readArchiveObject } = await import("./archiveObjects.js");
  return unpackClosedRun(index, await readArchiveObject(db.databaseName, index.hash));
}
