import { Schema } from "mongoose";
import { defineCsiModel, index, str, type CsiIndex } from "./common";

/**
 * S9-READS (assignment addendum §6.4, E17/E22; reconciliation §4.4): one document per (ET day,
 * agent id | `unmapped`), recomputed wholesale from `call_interactions` for that day, so a rebuild
 * is idempotent and byte-identical (C9). The `_id` is the deterministic `"{day}|{agent_key}"`
 * and the rebuild writes through the driver, so no generated id or timestamp enters a document.
 */
const tally = { type: Number, required: true, min: 0, default: 0, validate: Number.isSafeInteger } as const;
export const OUTREACH_REP_DAY_INDEXES: CsiIndex[] = [
  index("rep_day_day_agent", { day: 1, agent_key: 1 }),
];
export const OutreachRepDaySchema = new Schema(
  {
    _id: { type: String, required: true },
    /** YYYY-MM-DD in America/New_York. */
    day: str,
    /** The reviewed Agent id (hex) or `unmapped` (an extension without a reviewed sales-rep identity at the call time). */
    agent_key: str,
    agent_id: { type: Schema.Types.ObjectId, default: null },
    /** Terminal outbound calls with this rep's leg. */
    outbound_attempts: tally,
    /** Outbound attempts that were human conversations (the attempt→conversation rate numerator). */
    outbound_conversations: tally,
    /** Inbound calls this rep's leg answered. */
    answered_inbound: tally,
    /** Calls classified `human_conversation` with this rep's leg connected. */
    human_conversations: tally,
    talk_seconds: tally,
    /** Distinct calls counted in this document. */
    calls: tally,
    /** Of `calls`, how many a capture repair inserted or completed (counted on their real day, reported apart). */
    recovered_calls: tally,
    /** `unmapped` only: the unreviewed extension ids seen that day, sorted. */
    extensions: { type: [String], default: [] },
  },
  { collection: "outreach_rep_days" },
);
export const getOutreachRepDayModel = defineCsiModel("OutreachRepDay", OutreachRepDaySchema, OUTREACH_REP_DAY_INDEXES);
