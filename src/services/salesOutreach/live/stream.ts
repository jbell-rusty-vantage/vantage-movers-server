import type { Request, Response } from "express";
import mongoose from "mongoose";
import {
  SALES_OUTREACH_CONTRACT_VERSION,
  SALES_OUTREACH_LIVE_TOPICS,
  SALES_OUTREACH_LIVE_VERSIONS,
  type SalesOutreachLiveTopic,
} from "../../../config/domain/salesOutreach";
import { getMongoDatabaseName } from "../../../config/domain/runtime";
import { ENTITY_CHANGE_COLLECTION } from "../../../models/EntityChange";
import { isMetricEntityChange, metricEntityChangeHint, METRIC_ENTITY_MODELS } from "./repMetrics";
import { getSalesOutreachLiveEventModel } from "../../../models/salesOutreach/liveEvents";
import type { SalesOutreachLiveChange, SalesOutreachLiveFrame } from "../../../validation/v1/salesOutreachReads";
import { streamLiveInvalidations, type LiveChanges, type LiveFrameReason } from "../../salesIntelligence/live";
import type { OutreachActor } from "../auth";
import { OutreachError } from "../errors";

/**
 * `GET /live` — the desk's scoped SSE invalidation stream (CONTRACTS "SSE"; IMPLEMENTATION-PLAN §5).
 *
 * It reuses the Sales Intelligence transport (`streamLiveInvalidations`: full refetch on connect,
 * reconnect and clock frames, 250 ms coalescing, ~240 s lifetime, slow-consumer close) behind a separate
 * endpoint, over committed `sales_outreach_live_events` and metric-relevant `entity_changes` inserts. The database pipeline scopes ordinary desk hints to a Rep
 * (plus configuration invalidations); the domain adapter resolves metric owners from canonical records
 * and allocation/receiver history before every hint is re-filtered in process. A Rep's hints carry only its own Agent id.
 * The Rep's reviewed link and the desk configuration are re-checked on every clock tick; a failure
 * closes the stream (the reconnect then meets the route's own refusal).
 */

export const OUTREACH_LIVE_CLOCK_MS = 30_000;
export const OUTREACH_LIVE_MAX_CHANGES = 200;

export type LiveScope = Readonly<{ role: OutreachActor["role"]; agent_id: string | null }>;

/** The frame version a client asked for; unknown versions are refused before streaming (400). */
export function negotiateLiveVersion(requested: number | undefined): (typeof SALES_OUTREACH_LIVE_VERSIONS)[number] {
  const version = requested ?? SALES_OUTREACH_LIVE_VERSIONS[0];
  if (!(SALES_OUTREACH_LIVE_VERSIONS as readonly number[]).includes(version))
    throw new OutreachError("INVALID_INPUT", [{ path: "version", code: "unsupported_live_version", message: `supported: ${SALES_OUTREACH_LIVE_VERSIONS.join(",")}` }]);
  return version as (typeof SALES_OUTREACH_LIVE_VERSIONS)[number];
}

/** The change-stream pipeline for a viewer: inserts only, a Rep's own Agent (or configuration) only, safe fields only. */
export function liveWatchPipeline(scope: LiveScope): Record<string, unknown>[] {
  const match: Record<string, unknown> = { operationType: "insert" };
  if (scope.role === "rep")
    match.$or = [
      { "fullDocument.agent_ids": scope.agent_id ? new mongoose.Types.ObjectId(scope.agent_id) : null },
      { "fullDocument.topic": "outreach_configuration" },
    ];
  return [
    { $match: match },
    {
      $project: {
        "fullDocument.topic": 1,
        "fullDocument.subject_ids": 1,
        "fullDocument.agent_ids": 1,
        "fullDocument.business_day": 1,
        "fullDocument.revision": 1,
      },
    },
  ];
}

/** One database change stream serves desk hints and committed domain metric changes. */
export function outreachCombinedWatchPipeline(scope: LiveScope, liveCollection: string): Record<string, unknown>[] {
  const deskMatch = liveWatchPipeline(scope)[0]!.$match as Record<string, unknown>;
  return [
    { $match: { operationType: "insert", $or: [
      { ...deskMatch, "ns.coll": liveCollection },
      { "ns.coll": ENTITY_CHANGE_COLLECTION, "fullDocument.entity.model": { $in: METRIC_ENTITY_MODELS } },
    ] } },
    { $project: {
      "ns.coll": 1, "fullDocument.topic": 1, "fullDocument.subject_ids": 1,
      "fullDocument.agent_ids": 1, "fullDocument.business_day": 1, "fullDocument.revision": 1,
      "fullDocument.entity": 1, "fullDocument.changed_paths": 1,
      // A field allowlist excludes contact fields and provenance; only safe scoped hints leave the adapter.
      "fullDocument.fields": { $map: {
        input: { $filter: { input: { $ifNull: ["$fullDocument.fields", []] }, as: "field", cond: { $in: ["$$field.path", ["receiver_agent", "agent_allocations"]] } } },
        as: "field", in: { path: "$$field.path", value_mode: "$$field.value_mode", before: "$$field.before", after: "$$field.after" },
      } },
    } },
  ];
}

export function watchOutreachLiveEvents(scope: LiveScope): LiveChanges & { tryNext(): Promise<unknown> } {
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db;
  if (!db) throw new Error("Outreach database unavailable");
  const source = db.watch(outreachCombinedWatchPipeline(scope, getSalesOutreachLiveEventModel().collection.collectionName), { maxAwaitTimeMS: 1000 });
  return {
    async next() {
      for (;;) {
        const change = await source.next();
        if (!isMetricEntityChange(change)) return change;
        const hint = await metricEntityChangeHint(change, scope);
        if (hint) return { fullDocument: hint };
      }
    },
    async tryNext() {
      const change = await source.tryNext();
      if (!change || !isMetricEntityChange(change)) return change;
      const hint = await metricEntityChangeHint(change, scope);
      return hint ? { fullDocument: hint } : null;
    },
    close: () => source.close(),
  };
}

const ids = (value: unknown): string[] => (Array.isArray(value) ? value.map(String).filter((id) => /^[a-f\d]{24}$/.test(id)) : []);

/** One change event to the hint this viewer may see, or null (never forwards anything else). */
export function outreachLiveHint(change: unknown, scope: LiveScope): SalesOutreachLiveChange | null {
  const doc = (change as { fullDocument?: Record<string, unknown> } | null)?.fullDocument;
  if (!doc) return null;
  const topic = doc.topic as SalesOutreachLiveTopic;
  if (!SALES_OUTREACH_LIVE_TOPICS.includes(topic)) return null;
  const agents = ids(doc.agent_ids);
  if (scope.role === "rep" && topic !== "outreach_configuration" && (!scope.agent_id || !agents.includes(scope.agent_id))) return null;
  const businessDay = typeof doc.business_day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(doc.business_day) ? doc.business_day : null;
  const revision = typeof doc.revision === "number" && Number.isSafeInteger(doc.revision) && doc.revision >= 0 ? doc.revision : null;
  return {
    topic,
    subject_ids: ids(doc.subject_ids).slice(0, 100),
    agent_ids: scope.role === "rep" ? (topic === "outreach_configuration" ? [] : [scope.agent_id!]) : agents.slice(0, 10),
    business_day: businessDay,
    revision,
  };
}

/** The frame for a reason and the hints coalesced since the last change frame. */
export function outreachLiveFrame(reason: LiveFrameReason, hints: readonly SalesOutreachLiveChange[], now = new Date()): SalesOutreachLiveFrame {
  const base = { version: SALES_OUTREACH_LIVE_VERSIONS[0], contract_version: SALES_OUTREACH_CONTRACT_VERSION, reason, as_of: now.toISOString() } as const;
  if (reason !== "change" || hints.length > OUTREACH_LIVE_MAX_CHANGES) return { ...base, refetch: "all", topics: [], changes: [] };
  const topics = [...new Set(hints.map((h) => h.topic))].sort();
  return { ...base, refetch: "scoped", topics, changes: [...hints] };
}

export type OutreachLiveDeps = {
  watch?: (scope: LiveScope) => LiveChanges;
  /** Re-run each clock tick: the actor is still authorized and the desk still available. */
  revalidate?: () => Promise<boolean>;
  clockMs?: number;
  lifetimeMs?: number;
};

export function streamOutreachLive(req: Request, res: Response, scope: LiveScope, deps: OutreachLiveDeps = {}) {
  return streamLiveInvalidations<SalesOutreachLiveChange>(req, res, {
    watch: () => (deps.watch ?? watchOutreachLiveEvents)(scope),
    classify: (change) => outreachLiveHint(change, scope),
    frame: (reason, hints) => outreachLiveFrame(reason, hints),
    revalidate: deps.revalidate,
    clockMs: deps.clockMs ?? OUTREACH_LIVE_CLOCK_MS,
    lifetimeMs: deps.lifetimeMs,
  });
}
