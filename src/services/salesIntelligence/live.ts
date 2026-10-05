import mongoose from "mongoose";
import type { Request, Response } from "express";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { csiFlag } from "../../config/domain/salesIntelligence";

/** Durable committed sources only. No documents, ids, phone numbers or provider bodies cross SSE.
 * A frame carries the changed collections' stable topic slugs and nothing else: a collection slug
 * is safe, a subject id is not, so nothing here is ever keyed by the document that changed.
 */
export const CSI_LIVE_COLLECTIONS = [
  "sales_intelligence_audit_events",
  "contact_numbers", "call_interactions", "number_lead_attachments",
  "sales_intelligence_contact_restrictions",
  "sales_intelligence_policy_versions", "sales_intelligence_policy_pointers",
  "rep_identity_links", "owner_rep_nudges", "sales_intelligence_sync_state",
] as const;

/** Changed collection to the Numbers / RingCentral Accounts topic slug. Unmapped watched collections
 * coalesce to "other", which the client treats as "refetch everything" — a new collection is never
 * silently ignored. */
export const CSI_LIVE_TOPICS: Readonly<Record<string, string>> = {
  number_lead_attachments: "attachment",
  contact_numbers: "number", call_interactions: "number",
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

export type LiveFrameReason = "connect" | "reconnect" | "change" | "clock";

/**
 * The shared SSE invalidation transport (CSI Numbers/Accounts stream and the Sales Outreach Desk stream).
 * - Every connect, reconnect and clock frame asks for a full scoped refetch; the cursor is advisory.
 * - Changes are classified into small hints (`classify` never forwards a raw change), collected for
 *   250 ms and sent as one `change` frame (`frame` decides the payload).
 * - The stream closes after `lifetimeMs` (~240 s) so EventSource reconnects and re-authorizes, when the
 *   consumer is slow (no unbounded transport buffer), when `enabled` turns false, when `revalidate`
 *   (run on every clock tick) answers false or throws, and on any watch error. Nothing about a database
 *   or provider error is exposed.
 */
export type LiveStreamOptions<H> = {
  watch: () => LiveChanges;
  /** A change to the hint it contributes, or null to drop it. */
  classify: (change: unknown) => H | null;
  /** The JSON payload of one frame from the hints collected since the last change frame. */
  frame: (reason: LiveFrameReason, hints: readonly H[]) => unknown;
  enabled?: () => boolean;
  revalidate?: () => Promise<boolean>;
  clockMs?: number;
  lifetimeMs?: number;
  coalesceMs?: number;
};

export function streamLiveInvalidations<H>(req: Request, res: Response, options: LiveStreamOptions<H>) {
  const changes = options.watch();
  let closed = false, pending = false, sequence = 0, revalidating = false;
  let hints: H[] = [];
  const connection = Date.now().toString(36);
  res.status(200).set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  const send = (reason: LiveFrameReason, collected: readonly H[] = []) => {
    if (closed) return;
    if (!(options.enabled ?? (() => true))()) { close(); return; }
    // Slow consumers reconnect/refetch rather than accumulate an unbounded transport buffer.
    if (!res.write(`id: ${connection}:${++sequence}\nevent: invalidation\ndata: ${JSON.stringify(options.frame(reason, collected))}\n\n`)) close();
  };
  const tick = () => {
    if (!options.revalidate) { send("clock"); return; }
    if (revalidating) return;
    revalidating = true;
    options.revalidate().then((ok) => (ok ? send("clock") : close()), () => close()).finally(() => { revalidating = false; });
  };
  const clock = setInterval(tick, options.clockMs ?? 15_000);
  const lifetime = setTimeout(() => close(), options.lifetimeMs ?? 240_000);
  const coalesce = setInterval(() => { if (pending) { pending = false; const collected = hints; hints = []; send("change", collected); } }, options.coalesceMs ?? 250);
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
        const hint = options.classify(await changes.next());
        if (hint !== null) { hints.push(hint); pending = true; }
      }
    }
    catch { close(); } // No provider/database errors are exposed. EventSource reconnects and refetches.
  })();
  return close;
}

/** Cursor is advisory: every connection explicitly resyncs, including unknown/expired cursors.
 * Oplog delivery accelerates reads; periodic resync also closes the initial watch/read race.
 * Clock frames trigger server DTO reads, never client deadline/ranking calculations.
 * `topics` narrows those reads; `refetch: "all"` stays so a version 1 client keeps resyncing.
 * The stream is Owner-only (the admin router refuses a rep), so no per-viewer topic filter exists.
 * A connect, reconnect or clock frame carries no topics, so the client resyncs everything.
 */
export function streamCsiInvalidations(req: Request, res: Response, deps: {
  watch?: () => LiveChanges; clockMs?: number; lifetimeMs?: number; enabled?: () => boolean;
} = {}) {
  return streamLiveInvalidations<string>(req, res, {
    watch: deps.watch ?? watchCsiChanges,
    classify: csiLiveTopic,
    frame: (reason, topics) => ({ version: 2, reason, as_of: new Date().toISOString(), refetch: "all", topics: [...new Set(topics)].sort() }),
    enabled: deps.enabled ?? (() => csiFlag("ENABLED")),
    clockMs: deps.clockMs,
    lifetimeMs: deps.lifetimeMs,
  });
}
