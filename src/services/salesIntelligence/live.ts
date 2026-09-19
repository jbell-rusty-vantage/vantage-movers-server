import mongoose from "mongoose";
import type { Request, Response } from "express";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { csiFlag } from "../../config/domain/salesIntelligence";

/** Durable committed sources only. No documents, phone numbers or provider bodies cross SSE. */
export const CSI_LIVE_COLLECTIONS = [
  "sales_intelligence_audit_events", "sales_intelligence_attention_snapshots",
  "contact_numbers", "call_interactions", "number_lead_attachments", "lead_conversations",
  "outreach_records", "outreach_followups", "intelligence_runs", "intelligence_findings",
  "intelligence_effects", "intelligence_owner_assessments", "sales_intelligence_owner_instructions",
  "sales_intelligence_review_items", "sales_intelligence_contact_restrictions",
  "sales_intelligence_policy_versions", "sales_intelligence_policy_pointers",
  "rep_identity_links", "owner_rep_nudges", "sales_intelligence_sync_state",
] as const;

export interface LiveChanges {
  next(): Promise<unknown>;
  close(): Promise<void>;
}
export function watchCsiChanges(): LiveChanges {
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db;
  if (!db) throw new Error("CSI database unavailable");
  return db.watch([{ $match: { "ns.coll": { $in: [...CSI_LIVE_COLLECTIONS] } } }], { maxAwaitTimeMS: 1000 });
}

/** Cursor is advisory: every connection explicitly resyncs, including unknown/expired cursors.
 * Oplog delivery accelerates reads; periodic resync also closes the initial watch/read race.
 * Clock frames trigger server DTO reads, never client deadline/ranking calculations.
 */
export function streamCsiInvalidations(req: Request, res: Response, deps: {
  watch?: () => LiveChanges; clockMs?: number; lifetimeMs?: number; enabled?: () => boolean;
} = {}) {
  const changes = (deps.watch ?? watchCsiChanges)();
  let closed = false, pending = false, sequence = 0;
  const connection = Date.now().toString(36);
  res.status(200).set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  const send = (reason: "connect" | "reconnect" | "change" | "clock") => {
    if (closed) return;
    if (!(deps.enabled ?? (() => csiFlag("ENABLED")))()) { close(); return; }
    // Slow consumers reconnect/refetch rather than accumulate an unbounded transport buffer.
    if (!res.write(`id: ${connection}:${++sequence}\nevent: invalidation\ndata: ${JSON.stringify({ version: 1, reason, as_of: new Date().toISOString(), refetch: "all" })}\n\n`)) close();
  };
  const clock = setInterval(() => send("clock"), deps.clockMs ?? 15_000);
  const lifetime = setTimeout(() => close(), deps.lifetimeMs ?? 240_000);
  const coalesce = setInterval(() => { if (pending) { pending = false; send("change"); } }, 250);
  function close() {
    if (closed) return;
    closed = true;
    clearInterval(clock); clearInterval(coalesce); clearTimeout(lifetime);
    res.off("close", close);
    void changes.close().catch(() => undefined);
    res.end();
  }
  res.once("close", close);
  res.write("retry: 1000\n\n");
  send(req.header("last-event-id") ? "reconnect" : "connect");
  void (async () => {
    try { while (!closed) { await changes.next(); pending = true; } }
    catch { close(); } // No provider/database errors are exposed. EventSource reconnects and refetches.
  })();
  return close;
}
