import { Schema } from "mongoose";
import { SALES_OUTREACH_LIVE_TOPICS } from "../../config/domain/salesOutreach";
import { defineCsiModel, enumeration, refs, str, text, type CsiIndex } from "../salesIntelligence/common";

/** Retention of a live invalidation hint: it only accelerates refetches, so a day is plenty. */
export const SALES_OUTREACH_LIVE_EVENT_TTL_SECONDS = 86_400;

/**
 * `sales_outreach_live_events` — committed invalidation hints for `GET /live` (CONTRACTS "SSE";
 * IMPLEMENTATION-PLAN §5). Written after a desk write commits (`publishOutreachLive`); each stream
 * watches inserts with a server-side scope filter. A row carries ids and revisions only — never a
 * customer or provider record. Rows expire after a day (TTL index built by the index script).
 */
export const SALES_OUTREACH_LIVE_EVENT_INDEXES: CsiIndex[] = [
  { name: "sod_live_event_ttl", key: { createdAt: 1 }, expireAfterSeconds: SALES_OUTREACH_LIVE_EVENT_TTL_SECONDS },
];

export const SalesOutreachLiveEventSchema = new Schema(
  {
    topic: enumeration(SALES_OUTREACH_LIVE_TOPICS),
    /** Desk subjects whose projection/plan/assignment changed (≤ 100). */
    subject_ids: refs,
    /** Agents whose scoped views this touches (assignee, previous assignee, rep-day owner; ≤ 10). */
    agent_ids: refs,
    /** Rep-day business date (`outreach_goal`), else null. */
    business_day: text,
    /** Committed publication revision (projection, rep-day row or configuration pointer); null when none. */
    revision: { type: Number, default: null, min: 0 },
    /** What committed: `evaluation`, `command`, `configuration` or `rep_day`. */
    cause: str,
  },
  { collection: "sales_outreach_live_events" },
);

export const getSalesOutreachLiveEventModel = defineCsiModel(
  "SalesOutreachLiveEvent",
  SalesOutreachLiveEventSchema,
  SALES_OUTREACH_LIVE_EVENT_INDEXES,
);
