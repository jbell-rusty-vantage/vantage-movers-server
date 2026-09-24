import mongoose from "mongoose";
import type { Request, Response } from "express";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { csiFlag } from "../../config/domain/salesIntelligence";

/** Durable committed sources only. No documents, ids, phone numbers or provider bodies cross SSE.
 * A frame carries the changed collections' stable topic slugs and nothing else: a collection slug
 * is safe, a subject id is not, so nothing here is ever keyed by the document that changed.
 */
export const CSI_LIVE_COLLECTIONS = [
  "sales_intelligence_audit_events", "sales_intelligence_attention_snapshots",
  "contact_numbers", "call_interactions", "number_lead_attachments", "lead_conversations",
  "outreach_records", "outreach_followups", "intelligence_runs", "intelligence_findings",
  "intelligence_effects", "intelligence_owner_assessments", "sales_intelligence_owner_instructions",
  "sales_intelligence_review_items", "sales_intelligence_contact_restrictions",
  "sales_intelligence_policy_versions", "sales_intelligence_policy_pointers",
  "rep_identity_links", "owner_rep_nudges", "sales_intelligence_sync_state",
] as const;

/** Changed collection to Owner-facing topic slug. Unmapped watched collections coalesce to "other",
 * which the client treats as "refetch everything" — a new collection is never silently ignored. */
export const CSI_LIVE_TOPICS: Readonly<Record<string, string>> = {
  outreach_records: "outreach", outreach_followups: "outreach",
  number_lead_attachments: "attachment",
  intelligence_runs: "analysis", intelligence_findings: "analysis",
  intelligence_effects: "analysis", intelligence_owner_assessments: "analysis",
  contact_numbers: "number", call_interactions: "number", lead_conversations: "number",
  sales_intelligence_attention_snapshots: "attention",
  sales_intelligence_review_items: "review",
  sales_intelligence_contact_restrictions: "restriction",
  rep_identity_links: "rep", owner_rep_nudges: "nudge",
};
/** Reads only `ns.coll` from a change. No other change-event field is inspected or forwarded. */
export function csiLiveTopic(change: unknown): string {
  const coll = (change as { ns?: { coll?: unknown } } | null)?.ns?.coll;
  return (typeof coll === "string" && CSI_LIVE_TOPICS[coll]) || "other";
}

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
 * `topics` narrows those reads; `refetch: "all"` stays so a version 1 client keeps resyncing.
 * A connect, reconnect or clock frame carries no topics, so the client resyncs everything.
 */
/**
 * S8-REP: the topics a rep's stream carries. The stream never carries a subject for anyone (only collection
 * slugs), so a rep's stream is scoped by topic: the surfaces the rep reads (the desk snapshot, Outreach work,
 * analysis and a Number's calls). Changes on Owner-only surfaces (attachments, reviews, restrictions, rep links,
 * nudges and unmapped collections) are dropped, not coalesced to "other"; the rep refetches only through its
 * scoped reads. Connect, reconnect and clock frames are unchanged.
 */
export const REP_LIVE_TOPICS: ReadonlySet<string> = new Set(["attention", "outreach", "analysis", "number"]);
export function streamCsiInvalidations(req: Request, res: Response, deps: {
  watch?: () => LiveChanges; clockMs?: number; lifetimeMs?: number; enabled?: () => boolean;
  /** S8-REP: when set, only these topics are forwarded (`REP_LIVE_TOPICS` for a rep). Absent: every topic, as before. */
  topics?: ReadonlySet<string> | null;
} = {}) {
  const changes = (deps.watch ?? watchCsiChanges)();
  let closed = false, pending = false, sequence = 0;
  const topics = new Set<string>();
  const connection = Date.now().toString(36);
  res.status(200).set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  const send = (reason: "connect" | "reconnect" | "change" | "clock", changed: readonly string[] = []) => {
    if (closed) return;
    if (!(deps.enabled ?? (() => csiFlag("ENABLED")))()) { close(); return; }
    // Slow consumers reconnect/refetch rather than accumulate an unbounded transport buffer.
    if (!res.write(`id: ${connection}:${++sequence}\nevent: invalidation\ndata: ${JSON.stringify({ version: 2, reason, as_of: new Date().toISOString(), refetch: "all", topics: [...changed].sort() })}\n\n`)) close();
  };
  const clock = setInterval(() => send("clock"), deps.clockMs ?? 15_000);
  const lifetime = setTimeout(() => close(), deps.lifetimeMs ?? 240_000);
  const coalesce = setInterval(() => { if (pending) { pending = false; const changed = [...topics]; topics.clear(); send("change", changed); } }, 250);
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
    try {
      while (!closed) {
        const topic = csiLiveTopic(await changes.next());
        if (deps.topics && !deps.topics.has(topic)) continue;
        topics.add(topic); pending = true;
      }
    }
    catch { close(); } // No provider/database errors are exposed. EventSource reconnects and refetches.
  })();
  return close;
}
