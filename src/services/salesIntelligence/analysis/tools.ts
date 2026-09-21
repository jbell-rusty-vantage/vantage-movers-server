import { CSI_TOOLS } from "../../../config/domain/salesIntelligence";

export type CsiTool = (typeof CSI_TOOLS)[number];
export type AnalysisMode = "initial" | "current_context" | "number_refresh" | "backfill" | "original_evidence";

/**
 * Per-run tool authority (22 §4.1).
 *
 * Two different questions, deliberately answered separately:
 *
 * - `permittedToolsForRun` is *authority*. It is what the run token carries,
 *   what `lease.ts` and the MCP's auth check every call against, and what the
 *   MCP registers for the request. It must include every tool the run will
 *   ever call — including the ones the trusted worker itself calls to capture
 *   evidence before the model runs, because capture uses the same run token.
 * - `modelToolsForRun` is *surface*. It is what the model is shown, through
 *   `activeTools`. After capture there is nothing left for the model to search:
 *   every pre-captured read was followed to the end of its pagination, so
 *   offering the search and activity tools again only buys `bounds_exhausted`
 *   (ten production runs reached it). Keeping them out of the model's view also
 *   keeps their definitions off the wire on every step.
 *
 * A tool the model is not shown is still refused by authority if the SDK emits
 * it anyway; `runtime.ts` fails the call rather than trusting `activeTools`.
 */

/** Read tools the worker calls itself to capture a conversation run's evidence. */
const CONVERSATION_CAPTURE: readonly CsiTool[] = [
  "get_intelligence_context",
  "list_number_activity",
  "search_leads",
  "search_bookings",
  "get_rep_identity",
  "get_call_transcript",
];

/**
 * Discovery beyond the captured subject. Never granted to an ordinary run: the
 * capture already supplies context, activity, leads, bookings, rep identity and
 * the transcript, and RingCentral reads are additionally gated by
 * `PROVIDER_READS` inside `readOperationalRecords`. Granted only against a
 * reason recorded on the run.
 */
export const CSI_DISCOVERY_TOOLS: readonly CsiTool[] = [
  "get_lead",
  "get_booking",
  "query_operational_records",
  "search_ringcentral_calls",
  "get_ringcentral_call",
];

export type ToolGrantReason = "owner_reanalysis" | "coverage_gap";
export type ToolGrantInput = {
  mode: AnalysisMode;
  /** Tool names the parent run actually used, for an `original_evidence` replay. */
  original_tools?: readonly string[];
  /** Set only with an explicit reason; see `CSI_DISCOVERY_TOOLS`. */
  discovery_reason?: ToolGrantReason | null;
};

const order = (tools: Iterable<CsiTool>) => CSI_TOOLS.filter((name) => new Set(tools).has(name));

export function permittedToolsForRun(input: ToolGrantInput): CsiTool[] {
  const granted = new Set<CsiTool>(["submit_intelligence_analysis", "get_intelligence_context"]);
  if (input.mode === "original_evidence") {
    // A replay calls exactly the parent's reads and nothing else. An unknown
    // name is dropped here and then fails the reproduction in `runtime.ts`,
    // which is the loud failure the contract wants, not a silent widening.
    for (const name of input.original_tools ?? [])
      if ((CSI_TOOLS as readonly string[]).includes(name)) granted.add(name as CsiTool);
  } else {
    for (const name of CONVERSATION_CAPTURE) granted.add(name);
  }
  if (input.discovery_reason) for (const name of CSI_DISCOVERY_TOOLS) granted.add(name);
  return order(granted);
}

export function modelToolsForRun(input: ToolGrantInput): CsiTool[] {
  const permitted = new Set(permittedToolsForRun(input));
  // The transcript tool stays visible: it is the one captured read that can
  // legitimately have segments outside the captured window, which the page's
  // `segments_before` / `segments_after` ranges name.
  const shown = new Set<CsiTool>(
    (["submit_intelligence_analysis", "get_intelligence_context", "get_call_transcript"] as CsiTool[])
      .filter((name) => permitted.has(name)),
  );
  if (input.discovery_reason) for (const name of CSI_DISCOVERY_TOOLS) if (permitted.has(name)) shown.add(name);
  return order(shown);
}
