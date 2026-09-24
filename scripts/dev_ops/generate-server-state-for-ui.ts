/**
 * HANDOFF (reconciliation addendum §6, C26): generates `sales-intelligence-ui-ux-workspace/SERVER-STATE-FOR-UI.md`
 * from the frozen contracts (`contracts/<stage>/`), for the operator's UI-specification interview and Team 2.
 *
 *   node --import tsx scripts/dev_ops/generate-server-state-for-ui.ts [--workspace <dir>] [--out <file>] [--concurrency 3]
 *
 * Read-only: it reads fixtures, CONTRACT.md files, `_capture-index.json` / `_seed-manifest.json` and
 * `evidence/S10-RUNBOOK.md`, and runs `test-si-contract-fixtures.ts` (a pure Zod parse) for every stage folder and
 * flag-off folder that exists. No database, no network. It is **re-runnable**: stages are discovered from the folders,
 * so the coordinator re-runs it after the last freeze (CF6 recapture, CF8, CF9).
 *
 * The output is deterministic (fixed order, no generation timestamp; the only times are the fixtures' own).
 * Text between `<!-- coordinator:<id>:begin -->` and `<!-- coordinator:<id>:end -->` in an existing output is kept
 * on re-run, so the coordinator's hand completion survives.
 *
 * Exit code 1 when a region field has no fixture (`NO FIXTURE`), a preferred fixture lacks its path, a listed change
 * has no fixture, or any fixture set fails its validation. The coordinator decides each one.
 *
 * Strings in the tables below use a plain `|`; `cell()` escapes it for Markdown.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  cachedReader, cell, citedFixtureNames, decisionIds, discoverStages, findEvidence, formatObserved, listFixtures, markdownTables,
  type Evidence, type EvidenceQuery, type Fixture, type FixtureReader,
} from "./lib/server-state-for-ui";

const SERVER_ROOT = resolve(__dirname, "../..");
const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const WORKSPACE = resolve(arg("workspace") ?? process.env.SI_WORKSPACE_DIR ?? resolve(SERVER_ROOT, "../sales-intelligence-ui-ux-workspace"));
const CONTRACTS = resolve(WORKSPACE, "contracts");
const OUT = resolve(arg("out") ?? resolve(WORKSPACE, "SERVER-STATE-FOR-UI.md"));
const CONCURRENCY = Math.max(1, Number(arg("concurrency") ?? 3));

// ---------------------------------------------------------------------------------------------------------------
// 1. The hand-maintained region map (final spec §4 IA, §5, §6, §8–§12, §18; assignment addendum §4.3, §5, §6;
//    reconciliation §3). The generator fills in and verifies the fixture evidence for every row.
// ---------------------------------------------------------------------------------------------------------------

type RowOptions = Pick<EvidenceQuery, "prefer" | "state" | "expect" | "observe"> & {
  /** The freeze expected to add it (printed next to NO FIXTURE). */
  pending?: string;
  /** Known absent by a settled decision (Phase 5, …): printed `DEFERRED`, never a failure. */
  deferred?: string;
  /** Shown instead of the path when `path` is null. */
  label?: string;
};
type RowInput = [path: string | null, meaning: string, values: string, nullPath: string, copyKey: string, options?: RowOptions];
type Row = EvidenceQuery & RowOptions & { region: string; spec: string; meaning: string; values: string; nullPath: string; copyKey: string };

const ROWS: Row[] = [];
function region(name: string, spec: string, routes: string | string[], prefix: string, rows: RowInput[]) {
  for (const [path, meaning, values, nullPath, copyKey, options] of rows) {
    ROWS.push({ region: name, spec, routes: typeof routes === "string" ? [routes] : routes, path: path === null ? null : prefix + path,
      meaning, values, nullPath, copyKey, ...options });
  }
}

const CARD = "data.items[].outreach.";
const O = "data.outreach.";
const CF6 = "CF6 recapture after S6-AGENT merges";

region("Desk card · line 1 · identity and chips", "final §5.2, §5.7; D1", "attention", "data.items[].", [
  ["subject.kind", "What the row is about", "enum", "never null", "card.subject", { observe: true }],
  ["outreach", "The Outreach object; the card body", "object | null", "null on a Number-review row: identity line, counts line, `Needs review`, `Open` only (§5.7)", "card.number_review_row"],
  ["filter_keys.needs_review", "`Needs review` chip", "boolean", "never null (key absent on pre-S2 snapshots)", "card.chip.needs_review"],
  ["derived.attention_band", "Band tag `Band {n} · {name}` in flat layouts; band header in Attention order", "1–7 | null", "null → `Not in Attention`", "card.band_tag", { observe: true }],
  ["derived.reasons[]", "Primary and secondary reason keys (Team 4 adds `promised_by:*`, `new_not_yet_due`, `no_callback_after_inbound`, `promise_unreached`, `called_before_form`, `rep_discretion`, `unreached`)", "string[]", "empty array = no reason", "reason.{key}", { observe: true }],
]);
region("Desk card · line 1 · identity and chips", "final §5.2; D1; G3; S9", "attention", CARD, [
  ["lead_display.name", "Customer name", "string | null", "null → `Unknown name`; `lead_display: null` (no Lead) → `{e164} · No Lead attached`", "card.identity.name"],
  ["lead_display.job_no", "`Job {job_no}`", "string | null", "null → segment omitted", "card.identity.job"],
  ["lead_display.source_company", "`{source_company}`", "string | null", "null → segment omitted", "card.identity.source"],
  ["primary_number.e164", "Number-only identity `{e164 formatted}`", "E.164 string", "`primary_number: null` on a Lead with no Number", "card.identity.number"],
  ["state", "State label on the right of line 1", "enum", "never null", "card.state.{value}", { observe: true }],
  ["facts.newer_call_since_assessment", "`Newer call since assessment` chip (amber)", "boolean", "never null", "card.chip.newer_call"],
  ["facts.details_disagree", "`Details disagree` chip (amber)", "boolean", "never null", "card.chip.details_disagree"],
  ["live_call", "Live call on the primary Number (G3), computed at publish", "{interaction_id, direction, started_at, rep} | null", "null when no `terminal:false` call on the primary Number in the last 4 h", "card.chip.live_call (\"On the call · {rep} · {minutes}\")"],
  ["live_call.rep.text", "The Vantage-side rep clause for the live chip", "string", "`live_call: null` → no chip", "card.chip.live_call.rep"],
  ["live_call.rep.kind", "How the rep was identified", "enum", "as `live_call`", "card.chip.live_call.rep_kind", { observe: true }],
  ["live_call.started_at", "Start of the live call; `{minutes}` = `as_of − started_at`", "ISO", "as `live_call`", "card.chip.live_call.minutes"],
  ["call_progress.state", "Owner's manual call flag (G3: stays, labelled \"Owner calling\")", "enum | null", "`call_progress: null` → no chip", "card.chip.owner_calling", { observe: true }],
  ["facts.rep_thread", "`Rep replied` chip (Phase 5)", "null until S5", "always null (Phase 5, built last)", "card.chip.rep_replied"],
  ["band_since.at", "`In {band} for {duration}` (band history, S9)", "ISO", "absent before the first `OVERVIEW` publish; null when no transition is known", "card.band_since"],
  ["band_since.estimated", "The start is an estimated baseline (G8)", "boolean", "as `band_since`", "card.band_since.estimated (\"about\")", { observe: true }],
]);
region("Desk card · line 2 · route and move date", "final §5.2, §3.2; D9", "attention", CARD, [
  ["facts.route", "The route line", "object | null", "null (Number-only subject, or Lead not loaded) → the whole line is omitted", "card.route"],
  ["facts.route.pickup_city", "`{pickup_city}, {pickup_state}`", "string | null", "null → `Pickup unknown`", "card.route.pickup"],
  ["facts.route.pickup_state", "Pickup state", "string | null", "null → `Pickup unknown`", "card.route.pickup"],
  ["facts.route.delivery_city", "`{delivery_city}, {delivery_state}`", "string | null", "null → `Delivery unknown`", "card.route.delivery"],
  ["facts.route.delivery_state", "Delivery state", "string | null", "null → `Delivery unknown`", "card.route.delivery"],
  ["facts.route.move_date", "`Move {date} (in {n}d)`", "YYYY-MM-DD | null (Form Leads only)", "null → `Move date not on file`", "card.move_date"],
  ["facts.move_date_passed", "`Move {date} (passed)`", "boolean", "never null", "card.move_date.passed"],
]);
region("Desk card · line 3 · three times", "final §5.2, §3.2; D9; F12", "attention", CARD, [
  ["trigger_at", "`Received {t}`", "ISO", "never null on a record; no Lead → `Not a Lead`", "card.received"],
  ["last_meaningful_contact_at", "`Last conversation {t}`", "ISO | null", "null → `No conversation observed`", "card.last_conversation"],
  ["facts.last_call_at", "`Last call {t}`", "ISO | null", "null (no Number or no call) → `No call observed`", "card.last_call"],
  ["last_activity_at", "Newest activity; going cold runs from here (Team 4)", "ISO | null", "null or absent (flag never on) → not shown", "card.last_activity"],
  ["last_attributable_outbound_at", "Newest attributable outbound attempt (Team 4)", "ISO | null", "null → not shown", "card.last_attempt"],
  ["prior_contact_at", "Rep call in the 7 days before the form (Team 4)", "ISO | null", "null at 8 days or none", "reason.called_before_form.detail (\"Called {date}, before the form\")"],
]);
region("Desk card · line 4 · counts", "final §5.2, §5.3", "attention", CARD, [
  ["facts.calls_total", "`{n} calls`", "int ≥ 0 | null", "null (no primary Number) → `No Number on file`", "card.counts.calls"],
  ["facts.conversations_total", "`{n} conversations`", "int ≥ 0 | null", "as above", "card.counts.conversations"],
  ["facts.recordings_analyzed", "`{n} recordings analyzed`", "int ≥ 0 | null", "as above", "card.counts.recordings_analyzed"],
  ["facts.recordings_available", "`· {n} recording not yet analyzed` when above analyzed", "int ≥ 0 | null", "as above", "card.counts.recordings_pending"],
]);
region("Desk card · line 5 · scores", "final §5.4, §5.6; D6", "attention", CARD, [
  ["move_assessment", "The score projection", "object | null", "null → `Not assessed`", "card.scores"],
  ["move_assessment.status", "Availability word when there is no score", "enum", "never null inside the projection", "card.scores.status.{value}", { observe: true }],
  ["move_assessment.transaction_intent", "`Transaction intent {n} / 100`", "0–100 | null", "null → the status word only", "card.scores.ti"],
  ["move_assessment.transaction_intent_level_label", "`· {Level}`", "string | null", "as above", "card.scores.level"],
  ["move_assessment.move_likelihood", "`Move likelihood {n} / 100`", "0–100 | null", "as above", "card.scores.ml"],
  ["move_assessment.move_likelihood_level_label", "`· {Level}`", "string | null", "as above", "card.scores.level"],
  ["move_assessment.stale_reason", "Score tooltip `Assessment stale: move date passed` (derived on read)", "`move_date_passed` | null", "null → no stale sentence", "card.scores.stale", { observe: true }],
]);
region("Desk card · line 6 · next step", "final §5.5; D7; F9; F11", "attention", CARD, [
  ["next_action", "Case 1: the open follow-up", "object | null", "null → case 2 (suggestion) or case 3 `No next step set`", "card.next.recorded"],
  ["next_action.description", "`Next: {description}`", "string", "as `next_action`", "card.next.recorded"],
  ["next_action.due_at", "`Due {exact}`", "ISO | null", "null → `Due date needed`", "card.next.due"],
  ["next_action.attention_due_at", "Countdown / overdue amount reference", "ISO | null", "null with `due_at: null`", "card.next.countdown"],
  ["next_action.default_kind", "Server default \"Follow up on the quote\" (Team 4)", "`quote_followup` | absent", "absent on a non-default action", "followup.default.quote_followup", { observe: true }],
  ["next_action.promise_chain.attempt", "Retry of an unreached promised callback (Team 4)", "1 | 2", "absent on a non-retry action", "followup.retry (\"Try again ({attempt} of 2)\")"],
  ["suggested_next_step", "Case 2: the newest analysis suggestion, decided by the server", "object | null | absent", "null when not case 2 (see the CF1 table); absent on older snapshots", "card.next.suggested"],
  ["suggested_next_step.description", "`Suggested: {description}`", "string", "as above", "card.next.suggested"],
  ["suggested_next_step.apply.enabled", "Inline `Apply`", "boolean", "as above", "card.next.apply"],
]);
region("Desk card · line 7 · ownership and urgency", "final §5.2; E4; E26; F12; addendum §2.2", "attention", CARD, [
  ["assignment.agent.name", "`Assigned to {name}`", "string", "`assignment.agent: null` → `Unassigned`", "card.assigned_to"],
  ["assignment.origin", "Why the rep is assigned", "enum", "null with no agent", "assignment.origin.{value}", { observe: true }],
  ["assignment.origin", "Assigned from the Lead's Receiver agent (S6-AGENT)", "`crm_receiver`", "only with `RECEIVER_ASSIGNMENT` on", "assignment.origin.crm_receiver (\"Assigned from Granot\")", { expect: "crm_receiver", pending: CF6 }],
  ["next_action.promised_by.name", "`Promised by {name}`", "string", "`promised_by: null` → the assignment wording", "card.promised_by"],
  ["facts.next_action_state", "`· Callback overdue {as_of − attention_due_at}` / `· Due in {…}`", "enum", "never null; `no_due_date` / `none` → nothing", "card.overdue / card.due_in", { observe: true }],
  ["lead_progress.granot_priority", "`Granot Priority {code} ({label})`", "string | null", "`lead_progress: null` → nothing", "card.priority"],
  ["lead_progress.priority_label", "Priority label", "string | null", "as above", "card.priority.label"],
  ["lead_progress.provenance", "An uncertain 5 keeps `Booked in Granot · No Vantage Booking yet` on an active card (addendum §2.2)", "enum", "as above", "card.priority.uncertain", { observe: true }],
  ["lead_progress.disposition", "Lead progress disposition (`crm_booked` for an accepted 5)", "enum", "as above", "card.priority.disposition", { observe: true }],
  ["allowed_actions[].action", "Card actions (`Open analysis`, `Message rep`, …); enabled flags", "enum[]", "empty → `Open` only", "card.action.{value}", { observe: true }],
]);

region("Desk list · metrics strip, presets, sorts", "final §6, §7; D18; D20; addendum §5; E12–E14", "attention", "data.", [
  ["metrics.as_of", "`As of {exact}` under the strip", "ISO", "`metrics` absent (not null) on a flag-off snapshot → every tile `—`", "desk.metrics.as_of"],
  ["metrics.leads_received_7d", "Tile `Leads received 7d`", "int", "as above", "desk.metrics.leads_received_7d"],
  ["metrics.not_called_yet", "Tile `Not called yet` (band 2)", "int", "as above", "desk.metrics.not_called_yet"],
  ["metrics.callbacks_overdue", "Tile `Callbacks overdue` (band 1)", "int", "as above", "desk.metrics.callbacks_overdue"],
  ["metrics.awaiting_assessment", "Tile `Awaiting assessment`", "int", "as above", "desk.metrics.awaiting_assessment"],
  ["metrics.booked_7d", "Tile `Booked 7d`", "int", "as above", "desk.metrics.booked_7d"],
  ["metrics.booked_7d_median_days", "`median {n}d`", "int | null", "null with no booking in 7 d → no median text", "desk.metrics.booked_7d_median"],
  ["priority_counts.*.attention", "Preset / Priority chip counts in Needs Attention", "int per key", "absent without `ATTENTION_V2`", "desk.preset.count"],
  ["priority_counts.*.active", "Chip counts in All Outreach", "int per key", "as above", "desk.preset.count"],
  ["priority_counts.no_lead.active", "`No Lead` chip", "int", "key present only when seen", "desk.priority.no_lead"],
  ["priority_counts.not_set.active", "`Not set` chip (part of `New`)", "int", "key present only when seen", "desk.priority.not_set"],
  ["items[].filter_keys.priority", "The row's Priority key for the chips", "code | `no_lead` | null", "null = a Lead with no code (`Not set`)", "desk.priority.{value}", { observe: true }],
  ["items[].sort_keys.*", "`{Sort label}: {value}` line (not for Lead received)", "per sort", "null → the sort's null label (§7.2)", "desk.sort.{key}"],
  ["view", "Which view the page is", "enum", "never null", "desk.view.{value}", { observe: true }],
  ["stale", "Stale-list banner", "boolean", "never null", "desk.stale_banner"],
  ["total_items", "Server total for the current filters", "int", "never null", "desk.total"],
  ["cursor", "Keyset paging", "string | null", "null on the last page", "desk.load_more"],
]);

region("Now strip · record header on the Outreach route and the side dialog", "final §3.3, §4; reconciliation §3.2; G3; S9", "outreach", "", [
  ["as_of", "Reference time for every relative phrase on the detail (request time)", "ISO", "never null", "time.as_of"],
  [O + "live_call", "Live call, computed at read time (G3)", "object | null", "null when no live call", "now.live_call (\"On the call · {rep} · {minutes}\")", { prefer: "S5c/outreach__t3-live-call.json" }],
  [O + "live_call.rep.text", "Rep clause", "string", "as above", "now.live_call.rep"],
  [O + "live_call.direction", "Direction of the live call", "enum", "as above", "now.live_call.direction", { observe: true }],
  [O + "call_progress.state", "\"Owner calling\" (the Owner's manual flag)", "enum | null", "`call_progress: null` → nothing", "now.owner_calling", { prefer: "S5c/outreach__t3-live-call.json", observe: true }],
  [O + "derived.attention_band", "Current band", "1–7 | null", "null → `Not in Attention`", "now.band", { observe: true }],
  [O + "band_since.at", "`In {band} for {duration}`", "ISO", "absent before `OVERVIEW`", "now.band_since"],
  [O + "band_since.estimated", "Estimated start (G8)", "boolean", "as above", "now.band_since.estimated", { observe: true }],
  [O + "facts.next_action_state", "Due / overdue state of the next step", "enum", "never null", "now.next_action_state", { observe: true }],
  [O + "next_action.due_at", "`Due {exact} ({countdown})`", "ISO | null", "null → `Due date needed`", "now.next_due"],
  [O + "assignment.agent.name", "Assigned rep", "string", "null agent → `Unassigned`", "now.assigned_to"],
]);

region("Detail tabs · Work (and the side dialog)", "final §4, §10.2; D17; F9; F11; T4-D6", "outreach", O, [
  ["id", "Route id `/sales-intelligence/outreach/[id]`", "id", "never null", "detail.route"],
  ["followups[].description", "Follow-up list", "string", "empty array → `No next step set`", "work.followup.description"],
  ["followups[].status", "Follow-up state", "enum", "never null", "work.followup.status.{value}", { observe: true }],
  ["followups[].origin", "Who created it", "enum", "never null", "work.followup.origin.{value}", { observe: true }],
  ["followups[].due_at", "Due time", "ISO | null", "null → `Due date needed`", "work.followup.due"],
  ["followups[].promise_chain.attempt", "Retry attempt", "1 | 2", "absent on a non-retry", "followup.retry"],
  ["followups[].cancel_reason", "`Replaced by a specific plan`", "string", "absent unless superseded", "followup.superseded_by_specific_plan", { observe: true }],
  ["followups[].disposition", "Completion disposition (`customer_called`, …)", "enum | null", "null while open", "work.followup.disposition.{value}", { observe: true }],
  ["followups[].allowed_actions[].action", "Follow-up commands (complete, snooze, re-date, …)", "enum[]", "empty → no buttons", "work.followup.action.{value}", { observe: true }],
  ["followups_cursor", "More follow-ups", "string | null", "null → all shown", "work.load_more"],
]);
region("Detail tabs · Work (and the side dialog)", "final §11.5 (Your changes)", "outreach", "data.", [
  ["owner_instructions[].field", "Owner corrections on this record", "enum", "empty array → none", "work.owner_instruction.{field}", { observe: true }],
  ["nudges.items[]", "Past rep nudges (the send ledger)", "array", "empty array → none", "work.nudges"],
]);
region("Detail tabs · Messages", "final §12; D4; D15; G9", "outreach", O, [
  [null, "Rep thread for this Outreach (`GET /outreach/:id/thread`)", "Phase 5", "not built", "messages.thread", { label: "`GET /outreach/:id/thread` (rep_threads)", deferred: "Phase 5 (D4: built last; G9 design note only)" }],
]);

region("Timeline · both scopes", "final §10; D2; D17; RD8; G2; G4; S9", ["outreach-timeline", "number-timeline"], "data.", [
  ["scope", "Which scope", "`outreach` | `number`", "never null", "timeline.scope", { observe: true }],
  ["items[].kind", "Event kind", "enum", "never null", "timeline.kind.{value}", { observe: true }],
  ["items[].group", "Filter chip group (Calls · Lead updates · Work · Messages · Analysis)", "enum", "never null", "timeline.group.{value}", { observe: true }],
  ["items[].happened_at", "Event time (sort and display)", "ISO", "never null (Booking/Cancellation with no date fall back to `createdAt`, flagged in `detail`)", "timeline.time"],
  ["items[].recorded_late", "`Recorded {t}` when observed > 1 h later", "boolean", "never null", "timeline.recorded_late"],
  ["items[].observed_at", "`{t}` in `Recorded {t}`", "ISO", "never null", "timeline.recorded_at"],
  ["items[].title", "Event title (server copy, §10.2)", "string", "never null", "(server copy)"],
  ["items[].description", "One-line description (Subject Story sentence)", "string", "never null", "(server copy)"],
  ["items[].chips[]", "Chips", "`Recording` | `Analyzed` | `Voicemail` | `Human conversation`", "empty array → none (no `In progress` chip by decision; read `call.in_progress`)", "timeline.chip.{value}", { observe: true }],
  ["items[].action.kind", "`Open conversation` / `Open Booking`", "enum", "`action: null` → no action", "timeline.action.{value}", { observe: true }],
  ["items[].routine", "Collapsed under `Processing details ({n})`", "boolean", "never null", "timeline.processing_details"],
  ["items[].job_no", "`Job {n} ·` prefix on a Number with several Leads", "string | null", "null → no prefix", "timeline.job_prefix"],
  ["items[].actor.name", "Who did it", "string | null", "null → the actor kind's word", "timeline.actor"],
  ["items[].actor.kind", "Actor kind", "enum", "never null", "timeline.actor.{value}", { observe: true }],
  ["items[kind=call].call.in_progress", "In-progress call (G2): \"… the call is in progress\", result and duration null", "boolean", "absent on pre-S5c captures", "timeline.call.in_progress", { observe: true }],
  ["items[kind=call].call.observed_reason", "`Recovered {date}` replaces `Recorded {t}` for `recovered` (G4)", "`recovered` | `late_capture` | null", "null → the `recorded_late` rule", "timeline.call.observed_reason.{value}", { observe: true }],
  ["items[kind=call].detail.capture_recovery.at", "`{date}` in `Recovered {date}`", "ISO", "absent unless recovered", "timeline.call.recovered"],
  ["items[kind=band_changed].detail.cause.kind", "Cause of a band move (routine unless a call or the Owner)", "call | lead_progress | followup | owner | clock | booking | capture_repair | policy | baseline", "never null on the kind", "timeline.band_changed.cause.{value}", { observe: true }],
  ["items[kind=band_changed].detail.to_band", "`Moved from {band} to {band}`", "1–7 | null", "null → left Attention", "timeline.band_changed"],
  ["items[kind=band_changed].detail.estimated", "Baseline estimate (G8)", "boolean", "never null on the kind", "timeline.band_changed.estimated", { observe: true }],
  ["items[kind=followup_superseded].title", "Superseded default (Team 4)", "string", "—", "(server copy)"],
  ["items[kind=receiver_agent_changed].title", "\"Rep changed in Granot: {old} → {new}\" (S6-AGENT, timeline only)", "string", "only with `RECEIVER_ASSIGNMENT` on", "(server copy)", { pending: CF6 }],
  ["cursor", "`Load older activity`", "string | null", "null on the last page", "timeline.load_older"],
  ["kinds", "Echo of the applied kind filter", "string[] | null", "null → no filter", "timeline.filter"],
  ["coverage.truncated_sources[]", "A \"partial\" note when a source was capped", "string[]", "empty array → complete", "timeline.partial"],
]);

region("Analysis page · Situation", "final §11.1; RD5; RD7; E26; addendum §4.3", "outreach", O, [
  ["newest_run_id", "The run whose presentation feeds §11.1, §11.3, §11.5", "id | null", "null → `No analysis has run on this Number yet.`", "analysis.none"],
  ["latest_summary.overview", "Situation paragraph (≤ 280, sentence-cut)", "string", "`latest_summary: null` → no paragraph", "analysis.situation"],
  ["latest_summary.completed_at", "`Latest analysis, {date}`", "ISO", "as above", "analysis.situation.label"],
  ["latest_summary.conversations_covered", "`· {n} conversations` / `From the conversation on {date}`", "int | null", "null → count omitted", "analysis.situation.label"],
  ["latest_summary.run_kind", "Number synthesis or one conversation", "enum", "as above", "analysis.situation.kind", { observe: true }],
  ["official.status", "`Official: {…}`", "enum", "`official: null` (no Lead) → no line", "analysis.official.{value}", { observe: true }],
  ["official.priority.code", "`Granot Priority {code} ({label})`", "string", "`priority: null` → omitted", "analysis.official.priority"],
  ["official.booking_id", "`Open Booking`", "id | null", "null → no link", "analysis.official.open_booking"],
  ["receiver_agent.agent.name", "`Receiver agent in Granot: {name}` beside `Assigned by you` (E26)", "string", "`receiver_agent: null` (no Lead / no receiver); absent with `RECEIVER_ASSIGNMENT` off", "analysis.receiver_agent", { pending: CF6 }],
  ["receiver_agent.source", "Receiver agent source", "enum | null", "null on legacy Leads", "analysis.receiver_agent.source.{value}", { pending: CF6 }],
  ["receiver_agent.set_at", "When it was set", "ISO | null", "null on legacy Leads", "analysis.receiver_agent.set_at", { pending: CF6 }],
  [null, "`Lead cost $X (legacy price)` on the official status line", "—", "no server field", "analysis.official.lead_cost", { label: "Lead cost on the official line (addendum §4.3)" }],
]);
region("Analysis page · Situation", "final §11.1; RD7", "run-presentation", "data.summary_findings.", [
  ["story_discrepancies[].claim", "`Records disputed on a call ({n})`", "string", "empty array → section omitted", "analysis.disputed"],
]);
region("Analysis page · Scores", "final §11.2; D8; RD3; RD11", "outreach-assessment", "data.", [
  ["availability", "Availability when there is no current section", "enum", "never null", "analysis.scores.availability.{value}", { observe: true }],
  ["current.transaction_intent.score", "`{n} / 100`", "0–100 | null", "`current: null` → the availability explanation", "analysis.scores.value"],
  ["current.transaction_intent.level_label", "`· {Level}`", "string", "as above", "analysis.scores.level"],
  ["current.transaction_intent.confidence", "`Confidence {low|medium|high}`", "enum", "as above", "analysis.scores.confidence.{value}", { observe: true }],
  ["current.transaction_intent.rationale", "Rationale paragraph", "string", "as above", "analysis.scores.rationale"],
  ["current.transaction_intent.conditions[]", "`Conditions` list", "string[]", "empty → list omitted", "analysis.scores.conditions"],
  ["current.transaction_intent.evidence_missing", "`This score should cite evidence and does not.` (RD11)", "boolean", "never true in the seed", "analysis.scores.evidence_missing"],
  ["current.move_likelihood.score", "Second card", "0–100 | null", "as above", "analysis.scores.value"],
  ["current.published_at", "`Assessed {exact}`", "ISO", "as above", "analysis.freshness.assessed"],
  ["current.latest_conversation_at", "`covers … through {exact}`", "ISO | null", "null on `lead_only`", "analysis.freshness.through"],
  ["current.coverage.conversations_selected", "`covers {n} conversations`", "int", "as above", "analysis.freshness.count"],
  ["current.newer_calls_count", "`· {k} newer call{s} not yet assessed`", "int | null", "0 or null → clause omitted", "analysis.freshness.newer"],
  ["current.input_mode", "`lead_only` sentence", "enum", "as above", "analysis.freshness.input_mode.{value}", { observe: true }],
  ["current.stale_reason", "`Stale: the move date has passed.`", "enum | null", "null → no sentence", "analysis.freshness.stale"],
  ["current.transaction_intent.applicability", "`closed` / `not_applicable` sentences", "enum", "as above", "analysis.scores.applicability.{value}", { observe: true }],
  ["versions[]", "`Assessment version` picker", "array", "one version → picker hidden", "analysis.scores.version"],
]);
region("Analysis page · Recorded and suggested next step", "final §11.3; RD6; RD8", "run-presentation", "data.summary_findings.suggested_next_step.", [
  ["description", "Column 2 `Suggested next step (not applied)`", "string", "`suggested_next_step: null` → `No suggestion`", "analysis.suggested"],
  ["action_label", "Action word", "string", "as above", "analysis.suggested.action"],
  ["date_text", "Date wording", "string | null", "null → omitted", "analysis.suggested.date"],
  ["rationale", "Rationale", "string", "as above", "analysis.suggested.rationale"],
  ["applied_at", "`Applied {exact} → follow-up due {exact}`", "ISO | null", "null → `Apply` button", "analysis.suggested.applied"],
  ["followup_due_at", "Due of the created follow-up", "ISO | null", "as above", "analysis.suggested.applied_due"],
]);
region("Analysis page · Recorded and suggested next step", "final §11.3; RD6", "outreach-assessment", "data.current.engagement.", [
  ["work_status_label", "Column 3 `From the calls` sentence", "string", "`engagement` absent → column shows `Not assessed`", "analysis.from_calls.work_status"],
  ["rationale", "Rationale", "string", "as above", "analysis.from_calls.rationale"],
  ["promised_callbacks[].by_label", "`Promised callbacks ({n})`: `{by} · {raw_text} · {date} · {status}`", "string", "empty → section omitted", "analysis.from_calls.callbacks"],
  ["promised_callbacks[].status_label", "Status", "string", "as above", "analysis.from_calls.callbacks.status"],
  ["promised_callbacks[].followup_created", "`→ follow-up created`", "boolean", "as above", "analysis.from_calls.followup_created"],
  ["next_steps[].action_label", "`Next steps ({n})`", "string", "empty → section omitted", "analysis.from_calls.next_steps"],
  ["effects.skipped[].reason_label", "`Not applied ({n})`", "string", "empty → disclosure omitted", "analysis.from_calls.not_applied"],
]);
region("Analysis page · Move details", "final §11.4; D11; RD9", "outreach-assessment", "data.", [
  ["current.move_table.rows[].label", "Row label (Pickup · Delivery · Move date · Size · Services · Access · Money · Inventory summary)", "string", "`current: null` → `lead_move_table`", "analysis.move.row"],
  ["current.move_table.rows[].customer[].text", "`Customer said` cell (a short list)", "string", "empty → `Not mentioned`", "analysis.move.customer"],
  ["current.move_table.rows[].customer[].marker", "`(flexible)` / `(conditional)` / `(changed)` / `(retracted)` / `(declined)`", "enum | null", "null → no marker", "analysis.move.marker.{value}", { observe: true }],
  ["current.move_table.rows[].lead_on_file", "`Lead on file` cell", "string | null", "null → `Not on file`", "analysis.move.lead"],
  ["current.move_table.rows[].original", "`Original submission` cell", "string | null", "null → `Not on file`", "analysis.move.original"],
  ["current.move_table.original_origin_label", "`Original submission` header origin word", "string | null", "null → plain header", "analysis.move.original_origin", { observe: true }],
  ["current.move_table.rows[].conflict.explanation", "`Details disagree: {explanation}`", "string", "`conflict: null` → no marker", "analysis.move.conflict"],
  ["current.move_table.score_conflicts[].explanation", "`Conflicts ({n})`", "string", "empty → `No conflicts were recorded.`", "analysis.move.score_conflicts"],
  ["current.move_table.inventory_count", "`{n} items`", "int", "0 → `No inventory items were mentioned.`", "analysis.move.inventory"],
  ["current.move_table.source_coverage_text", "`From {n} of {m} conversations`", "string | null", "null → omitted", "analysis.move.coverage"],
  ["current.inventory.limitations[]", "`Limitations`", "string[]", "empty → omitted", "analysis.move.limitations"],
  ["lead_move_table.rows[].lead_on_file", "Lead-only table when there is no assessment (§11.9)", "string | null", "key absent without a Lead", "analysis.move.lead_only"],
]);
region("Analysis page · Findings", "final §11.5; D12; RD3; RD10", "outreach-findings", "data.", [
  ["items[].category_label", "Category header", "string", "empty items → `This analysis recorded no findings.`", "analysis.findings.category", { observe: true }],
  ["items[].claim", "Finding sentence", "string", "never null", "(model text)"],
  ["items[].source_word", "`Customer said` / `Rep said` / …", "string", "never null", "analysis.findings.source", { observe: true }],
  ["items[].action_status_word", "`· Requested` / `· Promised` / …", "string | null", "null → omitted", "analysis.findings.action_status", { observe: true }],
  ["items[].clarity", "`Uncertain` chip", "enum", "never null", "analysis.findings.uncertain", { observe: true }],
  ["items[].value_line", "Second line (due time, amount, restriction, …)", "string | null", "null → no second line", "(server copy)"],
  ["items[].work_result", "`Work result: …`", "applied | blocked | needs_review | not_applicable | superseded | retracted", "never null", "analysis.findings.work_result.{value}", { observe: true }],
  ["items[].work_result_detail", "`Applied → {detail}` / `Blocked: {reason}`", "string | null", "null → the result word only", "(server copy)"],
  ["items[].review_state", "Review state", "enum", "never null", "analysis.findings.review_state.{value}", { observe: true }],
  ["items[].allowed_actions[].action", "`Confirm` / `Correct` / `Retract`", "enum[]", "empty → no review actions", "analysis.findings.action.{value}", { observe: true }],
  ["reason", "Why the list is empty", "`no_number` | `retention_pending` | null", "null → normal", "analysis.findings.reason.{value}", { observe: true }],
  ["truncated", "List was capped", "boolean", "never null", "analysis.findings.truncated"],
]);
region("Analysis page · Findings", "final §11.5; RD7", "run-presentation", "data.summary_findings.", [
  ["prior_finding_relations[].relation_word", "`Changes since the last analysis ({n})`", "`Replaced` | `Done` | `Contradicted on a later call` | …", "empty → section omitted", "analysis.changes.relation", { observe: true }],
  ["prior_finding_relations[].group", "`changed` vs the `Unchanged or unclear ({n})` disclosure", "enum", "never null", "analysis.changes.group", { observe: true }],
  ["prior_finding_relations[].review_item_id", "Link to the review item", "id | null", "null → no link", "analysis.changes.review_link"],
  ["owner_instruction_assessments[].assessment_word", "`Your changes and what the model made of them`", "`Agrees` | `Disagrees` | `Cannot tell`", "empty → disclosure omitted", "analysis.instructions.assessment", { observe: true }],
]);
region("Analysis page · Evidence (inline)", "final §11.6; D13; RD11", "outreach-findings", "data.items[].evidence[].", [
  ["quote", "Transcript quote", "string | null", "null → the item's `text`", "(model text)"],
  ["speaker_label", "`— Rep` / `Customer` / `Speaker unknown`", "string | null", "null → omitted", "analysis.evidence.speaker", { observe: true }],
  ["at", "Segment time", "ISO | null", "null → call time", "analysis.evidence.at"],
]);
region("Analysis page · Evidence (inline)", "final §11.6; RD11", "assessment-evidence", "data.items[].", [
  ["text", "Evidence text", "string", "never null for a retained citation", "(server copy)"],
  ["source_label", "`From the call summary` / `Said on the call` / section label", "string | null", "null → record label", "analysis.evidence.source", { observe: true }],
  ["record_label", "Record evidence label (15 kinds)", "string | null", "null → not a record citation", "analysis.evidence.record.{value}", { observe: true }],
  ["purged_at", "`Original removed under retention on {t}; the citation is kept.`", "ISO | null", "null → retained (the only value any fixture shows)", "analysis.evidence.purged"],
]);
region("Analysis page · Conversations", "final §11.7; D14; RD4; RD12; G2", "number-conversations", "data.", [
  ["items[].direction_label", "Card header `{Inbound|Outbound}`", "string", "never null", "(server copy)"],
  ["items[].started_at_label", "`{exact time}`", "string", "never null", "(server copy)"],
  ["items[].duration_seconds", "`{duration}`", "int | null", "null → omitted", "conversations.duration"],
  ["items[].rep.name", "`{rep}`", "string | null", "null unless `reviewed` → the status word", "conversations.rep"],
  ["items[].rep.status", "Rep identity state", "reviewed | proposed | unknown", "never null", "conversations.rep.status.{value}", { observe: true }],
  ["items[].contact_type_label", "`Human conversation` / `Voicemail` / `Contact unknown`", "string", "never null", "(server copy)", { observe: true }],
  ["items[].recording_state", "`Recording: available` / `not recorded` / `audio removed …`", "available | not_recorded | audio_removed", "never null", "conversations.recording.{value}", { observe: true }],
  ["items[].media_available", "Show the `<audio>` player", "boolean", "never null", "conversations.player"],
  ["items[].summary_source", "Per-call summary source", "call_summary | legacy | null", "null + empty sections → no summary", "conversations.summary_source", { observe: true }],
  ["items[].summary_sections[].label", "Section labels (server)", "string", "empty → no summary", "(server copy)", { observe: true }],
  ["items[].in_progress", "In-progress call on a card (G2)", "boolean", "result and duration null while true", "conversations.in_progress", { pending: "an S5c-shaped capture of `GET /numbers/:id/conversations`" }],
  ["items[].call_log_state", "Call Log state (G2)", "provisional | settled | null", "null = final unless `terminal: false`", "conversations.call_log_state", { pending: "an S5c-shaped capture of `GET /numbers/:id/conversations`" }],
  ["other_calls[].result", "`Other calls ({n})`", "enum | null", "empty array → section omitted", "conversations.other.result.{value}", { observe: true }],
  ["other_calls[].in_progress", "In-progress call in `Other calls` (G2)", "boolean", "result and duration null while true", "conversations.in_progress", { pending: "an S5c-shaped capture (CF5c notes: unit tests only)" }],
  ["next_cursor", "More cards", "string | null", "null → last page", "conversations.load_more"],
]);
region("Analysis page · Conversations", "final §11.7", "conversation-transcript", "data.", [
  ["segments[].speaker_label", "Speaker turn", "string", "never null", "(server copy)", { observe: true }],
  ["segments[].text", "Transcript text (redacted)", "string", "never null", "(transcript)"],
  ["segments[].sid", "Segment anchor for `Open in transcript`", "string", "never null", "—"],
  ["completeness.missing_ranges[]", "Partial transcript markers", "string[]", "empty → complete", "transcript.missing.{value}", { observe: true }],
  ["available", "Transcript available", "boolean", "false → the unavailable text (no fixture shows false)", "transcript.unavailable"],
  ["next_offset", "Load more segments", "int | null", "null → end", "transcript.load_more"],
]);
region("Analysis page · Conversations", "final §11.7; DECISIONS 2026-09-23/24 (media streams, 2 MiB)", ["conversation-media-purged", "conversation-media-retained"], "", [
  ["status", "Media route status (the player's error path)", "HTTP status", "404 purged; 200/206 audio with a real store (not captured)", "conversations.audio_error", { observe: true }],
  ["body.error", "Error body", "string", "only on errors", "conversations.audio_error", { observe: true }],
]);
region("Analysis page · Full output", "final §11.8", "run-presentation", "data.", [
  ["full_output[].label", "Output picker", "string", "empty → picker hidden", "(server copy)", { observe: true }],
  ["full_output[].available", "Output still stored", "boolean", "never null", "analysis.full_output.available"],
]);

region("Numbers list", "final §9.1–§9.2; D5; G7", "numbers", "data.", [
  ["items[].e164", "Line 1 formatted number", "E.164", "never null", "numbers.number"],
  ["items[].attached_lead_progress.lead_display.name", "Line 1 name", "string | null", "null or no attached Lead → `Unknown name`", "numbers.name"],
  ["items[].provider_names[]", "Provider names (tooltip)", "string[]", "empty → no tooltip", "numbers.provider_names"],
  ["items[].classification", "Line 2 classification word", "enum", "never null", "numbers.classification.{value}", { observe: true }],
  ["items[].eligibility", "`Blocked until {t}` / `Suppressed` (only when not allowed)", "object | string", "allowed → nothing", "numbers.eligibility"],
  ["items[].attached_lead_progress.status", "One Lead / `Multiple Leads · Review matches` / `No Lead attached`", "resolved | multiple | none", "never null", "numbers.lead.{value}", { observe: true }],
  ["items[].attached_lead_progress.lead_display.job_no", "`Lead: Job {n}`", "string | null", "only on `resolved`", "numbers.lead.job"],
  ["items[].attached_lead_progress.lead_status", "`· {Open|Booked|Booked, then cancelled|Not booked}`", "enum | null", "only on `resolved`; null when the Lead row is missing", "numbers.lead_status.{value}", { observe: true }],
  ["items[].last_activity_at", "Line 3 `Last call {t}`", "ISO | null", "null → `No call observed`", "numbers.last_call"],
  ["items[].rollups.last_human_conversation_at", "`Last conversation {t}`", "ISO | null", "null → `No conversation observed`", "numbers.last_conversation"],
  ["items[].first_observed_at", "`First call {t}` (sort First call)", "ISO | null", "null → `Time unknown`", "numbers.first_call"],
  ["items[].rollups.interactions_total", "Line 4 `{n} calls`", "int", "never null", "numbers.counts.calls"],
  ["items[].rollups.human_conversations_total", "`{n} conversations`", "int", "never null", "numbers.counts.conversations"],
  ["items[].rollups.recordings_total", "`{n} recordings`", "int", "absent on older readers", "numbers.counts.recordings"],
  ["items[].attached_lead_progress.outreach_records_total", "Line 5 `Outreach: {n} records`", "int", "never null", "numbers.outreach.count"],
  ["items[].attached_lead_progress.outreach_state", "`Outreach: {state}`", "enum | null", "null → `Outreach: none`", "numbers.outreach.state.{value}", { observe: true }],
  ["items[].attached_lead_progress.move_assessment.transaction_intent", "Scores only with exactly one Lead (D5)", "0–100 | null", "`move_assessment` null / absent → no scores", "numbers.scores"],
  ["items[].created_via", "Form-created Number (G7)", "`form_lead` | absent", "absent = created by a call", "numbers.created_via.{value}", { observe: true }],
  ["items[].has_calls", "Has at least one call (G7)", "boolean", "never null", "numbers.has_calls"],
  ["filters.has_calls", "The resolved default for the `Include form-only numbers` toggle", "boolean | absent", "absent with the flag off and no param", "numbers.include_form_only"],
  ["sort.sort", "Sort echo", "enum", "never null", "numbers.sort.{value}", { observe: true }],
  ["cursor", "Paging", "string | null", "null → last page", "numbers.load_more"],
]);
region("Number route · header and Leads tab", "final §9.3; G7", "number", "data.", [
  ["attachments[].certainty", "Leads tab: certainty of each attachment", "enum", "empty array → `No Lead attached`", "number.leads.certainty.{value}", { observe: true }],
  ["attachments[].state", "Attachment state", "enum", "as above", "number.leads.state.{value}", { observe: true }],
  ["review_items[].cause_kind", "Open review items", "enum", "empty → none", "number.review.{value}", { observe: true }],
  ["restrictions[]", "Contact restrictions", "array", "empty → none", "number.restrictions"],
  ["running_analysis.text", "Running analysis text", "string", "`running_analysis: null` → none", "number.running_analysis"],
  ["created_via", "Form-created Number (G7)", "`form_lead` | absent", "absent = call", "numbers.created_via.{value}", { observe: true }],
  ["allowed_actions[].action", "Decide / attach / reject commands", "enum[]", "empty → none", "number.action.{value}", { observe: true }],
]);

region("Calls (Number route Calls tab)", "final §9.3; G2; G4", "number-timeline", "data.items[kind=call].call.", [
  ["direction", "Direction", "Inbound | Outbound | Unknown (…)", "`Unknown` → a directionless \"Call\"", "calls.direction.{value}", { observe: true }],
  ["result", "Result", "string | null", "null while in progress", "calls.result", { observe: true }],
  ["duration_seconds", "Duration", "int | null", "null while in progress", "calls.duration"],
  ["rep.name", "Rep", "string | null", "null unless reviewed → status word", "calls.rep"],
  ["rep.status", "Rep identity state", "enum", "never null", "calls.rep.status.{value}", { observe: true }],
  ["contact_type", "Contact type", "enum | null", "null → `Contact unknown`", "calls.contact_type.{value}", { observe: true }],
  ["recording_state", "Recording state", "none | recorded | analyzed", "never null", "calls.recording.{value}", { observe: true }],
  ["conversation_id", "`Open conversation` when analysed", "id | null", "null → no link", "calls.open_conversation"],
  ["terminal", "Final call (G2)", "boolean", "absent on pre-S5c captures", "calls.terminal"],
  ["in_progress", "`In progress` chip (G2)", "boolean", "absent on pre-S5c captures", "calls.in_progress", { observe: true }],
  ["call_log_state", "Call Log state (G2)", "provisional | settled | null", "null = final unless `terminal: false`", "calls.call_log_state.{value}", { observe: true }],
  ["observed_reason", "`Recovered {date}` / `Recorded {t}` (G4)", "recovered | late_capture | null", "null → neither", "calls.observed_reason.{value}", { observe: true }],
]);

region("Closed view (+ Closed history)", "final §8; D10; addendum §2.2, §2.2a; E1; E2; E27", "attention-closed", "data.items[].", [
  ["outcome.reason", "Outcome line kind", "booked | cancelled | bad_lead | duplicate | no_sync | crm_dead | crm_bad_unusable | owner | granot_booked", "`outcome` absent on active rows", "closed.outcome.{value}", { observe: true }],
  ["outcome.reason", "`Closed {date} · Booked in Granot · No Vantage Booking yet` (E1)", "`granot_booked`", "only with `PRIORITY5_CLOSURE` on", "closed.outcome.granot_booked", { expect: "granot_booked" }],
  ["outcome.origin", "`Closed by you` wording", "official | crm_disposition | owner", "never null", "closed.origin.{value}", { observe: true }],
  ["outcome.closed_at", "`Closed {date}`", "ISO", "never null", "closed.closed_at"],
  ["outcome.time_to_close_ms", "`({n}d, …)` whole days", "int | null", "null when the named instant is missing (never 0)", "closed.duration"],
  ["outcome.calls_total", "`(…, {n} calls)`", "int | null", "null → no Number", "closed.calls"],
  ["outcome.booking.book_date", "`→ Booked {date}` · `Open Booking`", "ISO", "`booking: null` → not booked", "closed.booking"],
  ["outcome.booking.total_binder_amount", "Binder amount", "number | null", "as above", "closed.booking.amount"],
  ["outcome.cancellation.reason", "`· {reason}`", "string | null", "`cancellation: null` → not cancelled", "closed.cancellation"],
  ["outcome.priority.label", "`Granot Priority {code} ({label})`; after 5 → 1 it shows the current code", "string", "`priority: null` → not a CRM closure", "closed.priority"],
  ["outcome.note", "`Closed by you … · {note}`", "string | null", "null → no note", "closed.note"],
  ["sort_keys.time_to_close", "Sort `Time to close`", "int | null", "absent on active rows", "closed.sort.time_to_close"],
]);
region("Closed view (+ Closed history)", "addendum §2.2a; E27", "closed-history", "data.", [
  ["items[].outcome.reason", "`Older than 90 days · Load closed history` rows (same outcome line)", "enum", "empty items → end of history", "closed.history.outcome.{value}", { observe: true }],
  ["retention.days", "`Closed Outreach is kept for {retention}`", "int | null", "null → no retention limit stated", "closed.history.retention"],
  ["retention.basis", "Retention basis", "string", "—", "closed.history.retention.basis", { observe: true }],
  ["cursor", "`Load closed history` paging", "string | null", "null → end", "closed.history.load_more"],
]);

region("Coverage", "final §4 dated note; G6; DECISIONS 2026-09-24 (S5c-HEALTH rules)", "coverage", "data.coverage.capture_health.", [
  ["status", "Headline", "ok | attention | broken", "never null", "coverage.capture.status.{value}", { observe: true }],
  ["reasons[]", "Reason keys under the headline", "webhook_down | webhook_degraded | quarantine | quarantine_over_24h | pending_finalization", "empty with `ok`", "coverage.capture.reason.{value}", { observe: true }],
  ["as_of", "Reference time", "ISO", "never null", "coverage.capture.as_of"],
  ["known_complete_through", "Capture known complete through", "ISO | null", "null → unknown", "coverage.capture.complete_through"],
  ["call_log.sync_mode", "Call Log sync", "off | shadow | on", "never null", "coverage.call_log.mode.{value}", { observe: true }],
  ["call_log.quarantined_count", "Quarantined Call Log records", "int", "never null", "coverage.call_log.quarantined"],
  ["call_log.oldest_quarantined_at", "Oldest quarantine", "ISO | null", "null when none", "coverage.call_log.oldest_quarantined"],
  ["call_log.last_sweep.recovered_calls", "Calls the last sweep recovered", "int", "`last_sweep: null` → never swept", "coverage.call_log.recovered"],
  ["webhook.state", "Webhook subscription", "healthy | degraded | down | off", "never null", "coverage.webhook.state.{value}", { observe: true }],
  ["webhook.subscription_id_suffix", "Last 6 characters of the subscription id", "string | null", "null when none", "coverage.webhook.subscription"],
  ["webhook.last_receipt_at", "Last receipt", "ISO | null", "null → none", "coverage.webhook.last_receipt"],
  ["webhook.receipts_1h", "Receipts in the last hour", "int", "never null", "coverage.webhook.receipts_1h"],
  ["webhook.last_renewal_error", "Last renewal error", "string | null", "null → none", "coverage.webhook.renewal_error"],
  ["in_progress_calls", "Calls in progress (≤ 4 h)", "int", "never null", "coverage.in_progress"],
  ["pending_finalization", "In progress > 10 min and ≤ 4 h (a long live call counts; settled definition)", "int", "never null", "coverage.pending_finalization"],
]);

region("Overview", "addendum §6; E15–E23; G8; reconciliation §4.3–§4.4", "overview", "data.", [
  ["as_of", "`Updated {as_of}`", "ISO", "never null", "overview.updated"],
  ["now.bands.*", "Now: band counts 1–7 (each links to the band)", "int per band", "never null", "overview.now.band"],
  ["now.needs_review", "Now: Needs review", "int", "never null", "overview.now.needs_review"],
  ["now.unassigned", "Now: Unassigned", "int", "never null", "overview.now.unassigned"],
  ["now.live_calls", "Now: live calls (G3)", "int", "never null", "overview.now.live_calls"],
  ["now.capture_health.status", "Now: capture headline (G6)", "ok | attention | broken", "never null", "overview.now.capture.{value}", { observe: true }],
  ["desk.speed_to_lead.median_staffed_minutes", "Speed to lead median", "number | null", "null → `—`", "overview.desk.speed_to_lead"],
  ["desk.speed_to_lead.p90_staffed_minutes", "Speed to lead p90", "number | null", "null → `—`", "overview.desk.speed_to_lead.p90"],
  ["desk.speed_to_lead.still_waiting", "Still waiting (unworked now)", "int", "never null", "overview.desk.still_waiting"],
  ["desk.speed_to_lead.missed_target", "Missed the 30-minute target", "int", "never null", "overview.desk.missed_target"],
  ["desk.callbacks_kept.kept_share", "Callbacks kept on time", "0–1 | null", "null with no callbacks due → `—`", "overview.desk.callbacks_kept"],
  ["desk.callbacks_kept.overdue_now", "Overdue now", "int", "never null", "overview.desk.callbacks_overdue"],
  ["desk.missed_calls_returned.on_time_share", "Missed calls returned on time", "0–1 | null", "null → `—`", "overview.desk.missed_returned"],
  ["desk.missed_calls_returned.median_staffed_minutes_to_return", "Median time to return", "number | null", "null → `—`", "overview.desk.missed_returned.median"],
  ["desk.flow.new_outreach", "Flow in: new Outreach", "int", "never null", "overview.flow.new"],
  ["desk.flow.moved_to_quoted", "Moved to Quoted", "int", "never null", "overview.flow.quoted"],
  ["desk.flow.booked_in_granot", "Booked in Granot", "int", "never null", "overview.flow.booked_in_granot"],
  ["desk.flow.booked", "Official Booked", "int", "never null", "overview.flow.booked"],
  ["desk.flow.net_active_change", "Net change in active records", "int", "never null", "overview.flow.net"],
  ["desk.flow.bands.into_band.*", "Band flow in (baseline and policy excluded)", "int per band", "never null", "overview.flow.into_band"],
  ["desk.flow.bands.excluded_baseline_or_policy", "Moves excluded from flow (G8)", "int", "never null", "overview.flow.excluded"],
  ["desk.flow.bands.capture_repair", "Moves caused by a capture repair, counted apart (G8)", "int", "never null", "overview.flow.capture_repair"],
  ["desk.flow.time_in_band.*.median_ms", "Median time in band", "int | null", "null when no known start → `—`", "overview.flow.time_in_band"],
  ["reps[].agent.name", "Rep row", "string", "empty array → no reps in period", "overview.reps.name"],
  ["reps[].open_assignments.open", "Open assignments", "int", "never null", "overview.reps.open"],
  ["reps[].open_assignments.overdue", "Overdue actions", "int", "never null", "overview.reps.overdue"],
  ["reps[].interactions.outbound_attempts", "Outbound attempts", "int", "never null", "overview.reps.attempts"],
  ["reps[].interactions.human_conversations", "Human conversations", "int", "never null", "overview.reps.conversations"],
  ["reps[].interactions.talk_minutes", "Talk minutes", "number", "never null", "overview.reps.talk_minutes"],
  ["reps[].interactions.attempt_conversation_rate", "Attempt → conversation rate", "0–1 | null", "null → `—`", "overview.reps.rate"],
  ["reps[].interactions.recovered_calls", "Calls counted from a capture repair", "int", "never null", "overview.reps.recovered"],
  ["reps[].outcomes.booking_rate", "Booking rate", "0–1 | null", "null → `—`", "overview.reps.booking_rate"],
  ["reps[].spend.spend", "Lead spend", "number (dollars)", "never null", "overview.reps.spend"],
  ["reps[].spend.unpriced_leads", "`N unpriced` warning (E20)", "int", "never null", "overview.reps.unpriced"],
  ["reps[].cost_per_booking", "Cost per booking", "number | null", "null with no bookings → `—`", "overview.reps.cost_per_booking"],
  ["reps[].by_source[].source", "Spend by source expansion", "string", "empty → no expansion", "overview.reps.by_source"],
  ["unmapped.interactions.calls", "`Unmapped rep` row (calls only)", "int", "`unmapped: null` → row hidden", "overview.unmapped"],
  ["unmapped.extensions[]", "Unmapped extensions", "string[]", "as above", "overview.unmapped.extensions"],
  ["unassigned.records_now", "`Unassigned` row: records now", "int", "`unassigned: null` → row hidden", "overview.unassigned.records"],
  ["unassigned.spend.spend", "`Unassigned` row: spend", "number", "as above", "overview.unassigned.spend"],
  ["spend.total.spend", "Lead spend total", "number", "never null", "overview.spend.total"],
  ["spend.total.legacy", "`$Y legacy`", "number", "never null", "overview.spend.legacy"],
  ["spend.by_source[].unit_cpl", "`{source} · {n} × ${cpl} = ${spend}`", "number | null", "null when mixed rates", "overview.spend.by_source"],
  ["periods.activity.key", "Activity period (default Today)", "enum", "never null", "overview.period.{value}", { observe: true }],
  ["periods.spend.key", "Spend and outcomes period (default Last 7 days)", "enum", "never null", "overview.period.{value}", { observe: true }],
  ["filters.priority", "Preset applied to record numbers", "string[] | null", "null → All", "overview.preset"],
  ["scope.agent_id", "Scoped to one rep", "id", "`scope: null` → the whole desk", "overview.scope"],
  ["team_medians.reps", "Anonymous team medians (rep view, E23)", "int", "`team_medians` absent or null for the Owner's unscoped read", "overview.team_medians"],
]);

region("Users (Operations Registry, Owner only)", "addendum §4.1; E8; E28", ["admin-users", "admin-user", "admin-users-invite", "admin-user-invite"], "", [
  ["**.email", "User email", "string", "never null", "users.email", { pending: "CF8 (admin-server routes; the fixture slug is a guess)" }],
  ["**.role", "Role", "owner | admin | rep", "never null", "users.role.{value}", { pending: "CF8", observe: true }],
  ["**.agent_id", "Linked Agent (required for a rep)", "id | null", "null unless rep", "users.agent", { pending: "CF8" }],
  ["**.active", "Active", "boolean", "never null", "users.active", { pending: "CF8" }],
  ["**.delivery", "Invite delivery (`sent` / `not_configured` / `failed` / `unreachable`)", "enum", "only on the invite response", "users.invite.delivery.{value}", { pending: "CF8", observe: true }],
  ["**.expires_at", "Invite expiry (72 h)", "ISO", "only on the invite response", "users.invite.expires", { pending: "CF8" }],
]);

const REP = /^rep(?:-|$)/;
region("Rep shell", "addendum §4.2–§4.3; E8–E11; E23", "attention", "data.", [
  ["items[].filter_keys.agents[]", "`My work` / `All my Outreach`: the server forces `agent_id` to the rep", "id[]", "a rep never sees another rep's record", "rep.desk", { state: REP, pending: "CF8 (state names starting `rep`)" }],
  ["metrics.not_called_yet", "Rep tiles computed over the rep's scope", "int", "as the Owner's", "rep.metrics", { state: REP, pending: "CF8" }],
  ["priority_counts.*.active", "Rep chip counts", "int", "as the Owner's", "rep.preset.count", { state: REP, pending: "CF8" }],
]);
region("Rep shell", "addendum §4.2; E9", "outreach", O, [
  ["followups[].allowed_actions[].action", "E9 allowlist: complete, snooze, re-date own follow-ups with a note", "enum[]", "other actions absent or disabled", "rep.followup.action.{value}", { state: REP, pending: "CF8", observe: true }],
]);
region("Rep shell", "addendum §4.2 (404, never 403)", ["outreach", "outreach-timeline", "outreach-assessment", "outreach-findings", "number-conversations", "conversation-transcript", "conversation-media"], "", [
  ["**.status", "A record outside the rep's scope answers 404 (existence doesn't leak)", "404", "—", "rep.not_found", { state: REP, expect: "404", pending: "CF8 (status-fixture naming is a guess)" }],
]);
region("Rep shell", "addendum §6; E23", "overview", "data.", [
  ["team_medians.reps", "Rep Overview: own numbers plus anonymous team medians", "int", "—", "rep.overview.team_medians", { state: REP, pending: "CF8/CF9 (rep Overview)" }],
]);
region("Rep shell", "addendum §2.2a", "closed-history", "data.", [
  ["items[].outcome.reason", "Rep Closed history, forced scope", "enum", "—", "rep.closed_history", { state: REP, pending: "CF8" }],
]);
region("Rep shell", "final §12; addendum §4.1", "outreach", O, [
  [null, "Messages / rep threads for reps", "—", "denied to reps; Phase 5 for everyone", "—", { label: "Messages (rep)", deferred: "Phase 5, and denied to reps (addendum §4.1)" }],
]);

// ---------------------------------------------------------------------------------------------------------------
// 2. Changes since the final spec was written (2026-09-23), each with its decision id(s) and a verified fixture.
// ---------------------------------------------------------------------------------------------------------------
type Change = EvidenceQuery & { what: string; ids: string; pending?: string };
const CHANGES: Change[] = [
  { what: "Card line 6 case 2 has a server field: `outreach.suggested_next_step` (with `apply`), decided at `as_of`", ids: "D7; DECISIONS 2026-09-23 (card suggestion fallback)", routes: ["outreach"], path: "data.outreach.suggested_next_step.apply.enabled", prefer: "S1/outreach__s-suggestion-open.json" },
  { what: "Relations and record disputes come from the newest run (`newest_run_id`)", ids: "RD7; DECISIONS 2026-09-23", routes: ["outreach"], path: "data.outreach.newest_run_id", prefer: "S1/outreach__s-findings.json" },
  { what: "Media route streams the blob (Range, ≤ 2 MiB per response) instead of a 60 s signed redirect; the purged case is 404", ids: "D14; DECISIONS 2026-09-23 (media route), 2026-09-24 (2 MiB)", routes: ["conversation-media-purged"], path: "status", prefer: "S4/conversation-media-purged__s-audio-purged.json" },
  { what: "Multi-value params are sent repeated or comma-separated; `outcome[]=` / `band[]=` are 400", ids: "D20; DECISIONS 2026-09-23 (`outreach[]` style params)", routes: ["attention-closed"], path: "data.items[].outcome.reason", prefer: "S2/attention-closed__closed-outcome-booked-cancelled.json" },
  { what: "Band 1 holds exact callbacks promised by a rep, asked for by the customer, or scheduled by the Owner (`promised_by:*`); day-precision promises move to band 4", ids: "F8; F9", routes: ["attention"], path: "data.items[].derived.reasons[]", expect: "promised_by:customer", prefer: "AC/attention__band-1.json" },
  { what: "New Form Leads show in band 2 at once (`new_not_yet_due`, `sort_keys.band2_due_rank`)", ids: "F10", routes: ["attention"], path: "data.items[].sort_keys.band2_due_rank", prefer: "AC/attention__band-2.json" },
  { what: "`no_callback_after_inbound` and `promise_unreached` in band 4", ids: "F9; F10", routes: ["attention"], path: "data.items[].derived.reasons[]", expect: "promise_unreached", prefer: "AC/attention__band-4.json" },
  { what: "Going cold measures from `last_activity_at`; `unreached` secondary reason; `last_attributable_outbound_at`, `last_inbound_human_at`, `prior_contact_at` on the record", ids: "F10; F12", routes: ["outreach"], path: "data.outreach.last_activity_at", prefer: "AC/outreach__ac-going-cold-unreached.json" },
  { what: "`assignment.origin: first_attempts` (weakest automatic origin)", ids: "F12", routes: ["outreach"], path: "data.outreach.assignment.origin", expect: "first_attempts", prefer: "AC/outreach__ac-attempts-same-rep.json" },
  { what: "Retry successors of an unreached promise (`followups[].promise_chain`, `supersedes_id`)", ids: "F9; T4-VAC-A1; T4-VAC-A4", routes: ["outreach"], path: "data.outreach.followups[].promise_chain.attempt", prefer: "AC/outreach__ac-promise-chain-source.json" },
  { what: "Server default \"Follow up on the quote\" (`default_kind: quote_followup`), superseded by a specific plan (`cancel_reason`, timeline `followup_superseded`)", ids: "F11; T4-D6", routes: ["outreach"], path: "data.outreach.followups[].cancel_reason", prefer: "AC/outreach__ac-default-superseded.json" },
  { what: "`terminal`, `call_log_state`, `in_progress` on every call DTO; in-progress calls show to the Owner with null result and duration", ids: "G2; DECISIONS 2026-09-24 (S5c-CALLS)", routes: ["number-timeline"], path: "data.items[kind=call].call.in_progress", expect: "true", prefer: "S5c/number-timeline__t3-live-call-kinds-call.json" },
  { what: "The model's story and Case File exclude in-progress calls (`excluded_in_progress`)", ids: "G2", routes: ["case-file"], path: "**.excluded_in_progress", prefer: "S5c/case-file__t3-live-call__script.json" },
  { what: "\"On the call\" is the server's `live_call` (not `derived.call_state`); the Owner's `call_progress` stays as \"Owner calling\"; `filter_keys.live_call`", ids: "G3; DECISIONS 2026-09-24 (live_call in the side-data loader)", routes: ["outreach"], path: "data.outreach.live_call.rep.text", prefer: "S5c/outreach__t3-live-call.json" },
  { what: "`observed_reason` (`recovered` / `late_capture`) and `capture_recovery`: `Recovered {date}` replaces `Recorded {t}`", ids: "G4; DECISIONS 2026-09-24 (55 calls, not 58)", routes: ["number-timeline"], path: "data.items[kind=call].call.observed_reason", expect: "recovered", prefer: "S5c/number-timeline__t3-capture-states-kinds-call.json" },
  { what: "`capture_health` block on the Owner coverage read (successor of `call_log_capture`)", ids: "G6; DECISIONS 2026-09-24 (S5c-HEALTH rules)", routes: ["coverage"], path: "data.coverage.capture_health.status", prefer: "S5c/coverage__seed.json" },
  { what: "Form-created Numbers: `created_via`, `has_calls`; the list hides form-only Numbers by default (`filters.has_calls`, `include_form_only`)", ids: "G7; DECISIONS 2026-09-24 (S5c-NUMBERS)", routes: ["numbers"], path: "data.filters.has_calls", prefer: "S5c/numbers__default.json" },
  { what: "Accepted Granot Priority 5 closes Outreach as `granot_booked` (reversible); the exact Booking upgrades it to `booked`", ids: "E1; E2; G8; DECISIONS 2026-09-24 (S6-P5)", routes: ["attention-closed"], path: "data.items[].outcome.reason", expect: "granot_booked", prefer: "S6/attention-closed__closed-outcome-granot-booked.json" },
  { what: "`lead_progress.disposition: crm_booked` for an accepted 5; an uncertain 5 opens a review and stays active", ids: "E1", routes: ["outreach"], path: "data.outreach.lead_progress.disposition", expect: "crm_booked", prefer: "S6/outreach__t3-p5-accepted.json" },
  { what: "Assigned rep follows the Lead's Receiver agent (`assignment.origin: crm_receiver`)", ids: "E3; E4; E5; E6; E26; G10", routes: ["outreach"], path: "data.outreach.assignment.origin", expect: "crm_receiver", pending: CF6 },
  { what: "Detail shows the Receiver agent beside the Assigned rep (`outreach.receiver_agent {agent, source, set_at}`; the addendum wrote `lead.receiver_agent`)", ids: "E26", routes: ["outreach"], path: "data.outreach.receiver_agent.agent.name", pending: CF6 },
  { what: "`filter_keys.priority: \"no_lead\"` (unflagged) and `priority_counts` per key and view `{attention, active, closed}`", ids: "E12; E13; E14; DECISIONS 2026-09-24 (per view; `no_lead` unflagged)", routes: ["attention"], path: "data.items[].filter_keys.priority", expect: "no_lead", prefer: "S7/attention__all-outreach-no-lead.json" },
  { what: "Closed history beyond the 90-day partition (`GET /outreach/closed-history`, `retention`)", ids: "E27", routes: ["closed-history"], path: "data.retention.days", prefer: "S7/closed-history__before-90d.json" },
  { what: "Band history: `band_since {at, estimated}`, timeline `band_changed` with causes incl. `baseline`, `policy`, `capture_repair`", ids: "E25; G8", routes: ["outreach-timeline"], path: "data.items[kind=band_changed].detail.cause.kind", expect: "baseline" },
  { what: "Overview route: now (with `live_calls`, `capture_health.status`), desk health, reps, Unmapped / Unassigned, spend by basis and source", ids: "E15; E16; E17; E18; E19; E20; E22; G8; DECISIONS 2026-09-24 (S9 now from the index)", routes: ["overview"], path: "data.now.live_calls", prefer: "S9/overview__default.json" },
  { what: "Rep role: server-forced scope on every SI route, 404 outside it, E9 command allowlist", ids: "E8; E9; E10; E11", routes: ["attention"], path: "data.items[].filter_keys.agents[]", state: REP, pending: "CF8" },
  { what: "Owner-managed Admin users and invites (admin server)", ids: "E28; DECISIONS 2026-09-24 (S8-USERS details)", routes: ["admin-users"], path: "**.email", pending: "CF8" },
];

// ---------------------------------------------------------------------------------------------------------------
// 3. Left to the UI on purpose (hand-written, from the specs).
// ---------------------------------------------------------------------------------------------------------------
const LEFT_TO_UI = `The server sends states (booleans, enums, counts, times) and a few pre-rendered strings. Everything below is the UI's to decide in the interview; nothing here needs a server change.

- **Copy wording.** Every copy key in section 1 is a proposal. The strings in final spec §3.3, §5, §8, §11 and §14, the Team 4 keys in \`contracts/AC/CONTRACT.md\` and the reconciliation's keys (\`liveCall\`, \`ownerCalling\`) are drafts. Server-rendered strings are shown as sent: \`*_label\`, \`*_word\`, \`value_line\`, \`work_result_detail\`, timeline \`title\` and \`description\`, \`live_call.rep.text\`, \`summary_sections[].label\` (RD10). Relative time is formatted against the response \`as_of\` (RD1, final spec §3.3); the browser never decides a state.
- **Chip set and order.** The server gives the booleans (\`needs_review\`, \`newer_call_since_assessment\`, \`details_disagree\`, \`live_call\`, \`call_progress\`, \`rep_thread\`, \`call.in_progress\`). Which chips appear on card line 1, their order, and whether "Owner calling" and "On the call" share one live style (G3: the row is live when either is on) are the UI's. \`TIMELINE_V2_CHIPS\` deliberately has no \`In progress\` value; the UI reads \`call.in_progress\` (DECISIONS 2026-09-24).
- **Rep vs Owner visibility of each region.** The server enforces only scope: a forced \`agent_id\` on the desk, Closed history and Overview; 404 outside scope on the record, timeline, assessment, findings, conversations, transcript and media reads; the E9 command allowlist. Numbers, the Number route, Coverage, Users, Messages and Operations stay Owner-only on the server. Which of the remaining regions a rep sees, and how (addendum §4.3: tabs Overview · My work · All my Outreach · Closed; no rep filter; no Owner command buttons; lead cost on the official line), is the UI's.
- **Empty states.** Final spec §14 lists the settled empty strings. New ones have a server signal but no settled copy: Numbers with form-only hidden (\`filters.has_calls\`), Closed history at the end of retention (\`retention\`), Overview periods with no reps or no bookings (\`null\` → \`—\`), capture health with each reason key, a band-history start that is \`estimated\`, \`findings.reason\` (\`no_number\` / \`retention_pending\`).
- **Layout choices the specs leave open:** band names, the Priority preset bar's labels (\`0 Fresh\`, \`1 Quoted\`, …), the Overview's arrangement, how the Now strip combines the live call, Owner calling, band and due time, and the reading of "Now strip" itself. This file takes it to be the record header on the Outreach route and the side dialog, read live at the request \`as_of\` (reconciliation §3.2).`;

// ---------------------------------------------------------------------------------------------------------------
// Evidence, validation and rendering.
// ---------------------------------------------------------------------------------------------------------------
type Verdict = "ok" | "null_only" | "no_fixture" | "deferred" | "problem";
type RowResult = { row: Row; evidence: Evidence; verdict: Verdict };
function judge(row: Row, fixtures: Fixture[], read: FixtureReader): RowResult {
  const evidence = findEvidence(row, fixtures, read);
  if (row.deferred && evidence.status === "no_fixture") return { row, evidence, verdict: "deferred" };
  if (evidence.problems.length && evidence.status !== "no_fixture") return { row, evidence, verdict: "problem" };
  return { row, evidence, verdict: evidence.status };
}

type ValidationRun = { stage: string; mode: "on" | "off"; command: string; code: number; output: string; tests: number | null; pass: number | null; fail: number | null };
function runValidation(stage: string, mode: "on" | "off"): Promise<ValidationRun> {
  const argv = ["--import", "tsx", "scripts/dev_ops/test-si-contract-fixtures.ts", "--stage", stage, ...(mode === "off" ? ["--flag-off"] : []), "--dir", CONTRACTS];
  const shown = `node --import tsx scripts/dev_ops/test-si-contract-fixtures.ts --stage ${stage}${mode === "off" ? " --flag-off" : ""} --dir <workspace>/contracts`;
  return new Promise(done => {
    const child = spawn(process.execPath, argv, { cwd: SERVER_ROOT, env: { ...process.env, SI_WORKSPACE_DIR: WORKSPACE } });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    child.on("error", error => { output += String(error); });
    child.on("close", code => {
      const num = (name: string) => { const m = new RegExp(`^# ${name} (\\d+)$`, "m").exec(output); return m ? Number(m[1]) : null; };
      done({ stage, mode, command: shown, code: code ?? 1, output: output.replace(/\r\n/g, "\n").trimEnd(), tests: num("tests"), pass: num("pass"), fail: num("fail") });
    });
  });
}
async function pool<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await work(items[i]!); }
  }));
  return results;
}

const readText = (file: string) => existsSync(file) ? readFileSync(file, "utf8").replace(/\r\n/g, "\n") : null;
const readJson = <T>(file: string): T | null => existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as T : null;

function coordinatorBlocks(previous: string | null) {
  const blocks = new Map<string, string>();
  if (!previous) return blocks;
  for (const m of previous.matchAll(/<!-- coordinator:([a-z0-9-]+):begin -->\n([\s\S]*?)<!-- coordinator:\1:end -->/g)) blocks.set(m[1]!, m[2]!);
  return blocks;
}
function coordinator(blocks: Map<string, string>, id: string, placeholder: string) {
  return `<!-- coordinator:${id}:begin -->\n${blocks.get(id) ?? `> _Coordinator:_ ${placeholder}\n`}<!-- coordinator:${id}:end -->`;
}

type CaptureIndex = { stage?: string; mode?: string; database?: string; captured_at?: string; calls?: Array<{ ok?: boolean }>; notes?: Record<string, string> };
type SeedManifest = { database?: string; seeded_at?: string; snapshot_id?: string; rows?: Array<{ states?: string[] }> };

function contractStateCount(stage: string): string | null {
  const contract = readText(resolve(CONTRACTS, stage, "CONTRACT.md"));
  const m = contract && /\*{0,2}(\d+)\/(\d+)\*{0,2} (?:seeded )?states/.exec(contract);
  return m ? `${m[1]}/${m[2]}` : null;
}
/** Another stage with a CONTRACT.md captured from the same seed run (same `_seed-manifest.json` `seeded_at`). */
function sameSeedStage(stage: string, stages: readonly string[]): string | null {
  const seeded = readJson<SeedManifest>(resolve(CONTRACTS, stage, "_seed-manifest.json"))?.seeded_at;
  if (!seeded) return null;
  return stages.find(other => other !== stage && existsSync(resolve(CONTRACTS, other, "CONTRACT.md"))
    && readJson<SeedManifest>(resolve(CONTRACTS, other, "_seed-manifest.json"))?.seeded_at === seeded) ?? null;
}
/** The asserted seed state count: the stage's CONTRACT.md, else that of a stage captured from the same seed run. */
function stateCount(stage: string, stages: readonly string[]): string {
  const own = contractStateCount(stage);
  if (own) return `${own} (CONTRACT.md)`;
  const other = sameSeedStage(stage, stages);
  const count = other && contractStateCount(other);
  if (count) return `${count} (same seed run as ${other})`;
  const manifest = readJson<SeedManifest>(resolve(CONTRACTS, stage, "_seed-manifest.json"));
  if (manifest?.rows) return `${new Set(manifest.rows.flatMap(row => row.states ?? [])).size} distinct on \`_seed-manifest.json\` rows`;
  return "not recorded";
}
function contractServerTree(stage: string): string | null {
  const contract = readText(resolve(CONTRACTS, stage, "CONTRACT.md"));
  const m = contract && /(?:server tree|from server|Server tree:)\s*`([^`]+)`/.exec(contract);
  return m ? m[1]! : null;
}
function serverTree(stage: string, stages: readonly string[]): string {
  const own = contractServerTree(stage);
  if (own) return `\`${own}\``;
  const other = sameSeedStage(stage, stages);
  const tree = other && contractServerTree(other);
  return tree ? `\`${tree}\` (as ${other})` : "—";
}

function statusText(verdict: Verdict, row: { deferred?: string; pending?: string }) {
  switch (verdict) {
    case "ok": return "ok";
    case "null_only": return "null only";
    case "deferred": return `DEFERRED (${row.deferred})`;
    case "problem": return "**CHECK**";
    case "no_fixture": return row.pending ? `**NO FIXTURE** (expected: ${row.pending})` : "**NO FIXTURE**";
  }
}
const pathLabel = (path: string | null, expect?: string) => path ? `\`${path}\`${expect !== undefined ? ` = \`${expect}\`` : ""}` : "";

async function main() {
  const stages = discoverStages(CONTRACTS);
  if (!stages.length) throw new Error(`no stage folders with _capture-index.json under ${CONTRACTS}`);
  const fixtures = listFixtures(CONTRACTS, stages);
  const read = cachedReader(CONTRACTS);
  const blocks = coordinatorBlocks(readText(OUT));

  const rowResults = ROWS.map(row => judge(row, fixtures, read));
  const changeResults = CHANGES.map(change => ({ change, evidence: findEvidence(change, fixtures, read) }));

  const sets: Array<{ stage: string; mode: "on" | "off" }> = [];
  for (const stage of stages) {
    sets.push({ stage, mode: "on" });
    if (fixtures.some(fx => fx.stage === stage && fx.mode === "off")) sets.push({ stage, mode: "off" });
  }
  process.stderr.write(`validating ${sets.length} fixture sets (${stages.join(", ")})…\n`);
  const runs = await pool(sets, CONCURRENCY, set => runValidation(set.stage, set.mode));

  const noFixture = rowResults.filter(r => r.verdict === "no_fixture");
  const problems = rowResults.filter(r => r.verdict === "problem");
  const changeMissing = changeResults.filter(c => c.evidence.status === "no_fixture" || c.evidence.problems.length);
  const failedRuns = runs.filter(run => run.code !== 0);
  const count = (v: Verdict) => rowResults.filter(r => r.verdict === v).length;
  const total = runs.reduce((acc, run) => ({ tests: acc.tests + (run.tests ?? 0), pass: acc.pass + (run.pass ?? 0), fail: acc.fail + (run.fail ?? 0) }), { tests: 0, pass: 0, fail: 0 });
  const failed = noFixture.length + problems.length + changeMissing.length + failedRuns.length;

  const L: string[] = [];
  L.push("# Server state for the UI", "");
  L.push("**Generated** by `vantage-main-server/scripts/dev_ops/generate-server-state-for-ui.ts` from `contracts/` (reconciliation addendum §6, G10). Re-running the generator rewrites this file and keeps only the text between the `<!-- coordinator:… -->` markers, so the coordinator writes there.", "");
  L.push("```", "node --import tsx scripts/dev_ops/generate-server-state-for-ui.ts --workspace <path to sales-intelligence-ui-ux-workspace>", "```", "");
  L.push(`Stages read: ${stages.map(s => `\`${s}\``).join(", ")} (${fixtures.filter(f => f.mode === "on").length} flags-on fixtures, ${fixtures.filter(f => f.mode === "off").length} flag-off). It is the input to the operator's UI-specification interview (reconciliation §2).`, "");
  L.push("## Summary", "");
  L.push("| Check | Result |", "|---|---|");
  L.push(`| Region fields with a fixture value | ${count("ok")} |`);
  L.push(`| Region fields present only as null or empty | ${count("null_only")} |`);
  L.push(`| Region fields deferred by a settled decision | ${count("deferred")} |`);
  L.push(`| Region fields with **NO FIXTURE** | ${noFixture.length} |`);
  L.push(`| Region fields whose preferred fixture lacks the path | ${problems.length} |`);
  L.push(`| Changes (section 2) without a fixture | ${changeMissing.length} of ${changeResults.length} |`);
  L.push(`| Fixture sets validated (section 5) | ${runs.length - failedRuns.length} of ${runs.length} pass (${total.pass}/${total.tests} fixtures) |`);
  L.push(`| **Validation (C26)** | ${failed ? "**FAIL**" : "pass"} |`, "");
  if (noFixture.length) {
    L.push("**NO FIXTURE rows** (the coordinator decides each):", "");
    for (const r of noFixture) L.push(`- ${r.row.region}: ${r.row.path ? pathLabel(r.row.path, r.row.expect) : r.row.label ?? r.row.meaning} (routes ${r.row.routes.join(", ")})${r.row.pending ? `; expected from ${r.row.pending}` : ""}`);
    L.push("");
  }
  if (changeMissing.length) {
    L.push("**Changes without a fixture:**", "");
    for (const c of changeMissing) L.push(`- ${c.change.what} (${c.change.ids})${c.change.pending ? `; expected from ${c.change.pending}` : ""}${c.evidence.problems.length ? `; ${c.evidence.problems.join("; ")}` : ""}`);
    L.push("");
  }
  for (const r of problems) L.push(`- CHECK ${r.row.region}: \`${r.row.path}\`: ${r.evidence.problems.join("; ")}`);
  if (problems.length) L.push("");
  L.push(coordinator(blocks, "summary", "decisions on the NO FIXTURE rows, and anything the interview should know first."), "");

  // 1
  L.push("## 1. Screen region → DTO fields", "");
  L.push("Built from the hand-maintained region map in the generator. The fixture column is **verified**: the generator walks the JSON of every flags-on fixture of the route, in freeze order (S1 → S9), and cites a preferred fixture, else the first with a value, with the count of fixtures that contain the path. `null only` = the path exists but every captured value is null or empty. `seen:` lists the distinct values captured. Paths are relative to the fixture file: read fixtures start at `data.` (envelope `{ok, data, as_of, coverage}`), status fixtures at `status` / `body`. `[]` = every element, `[k=v]` = elements with `k = v`, `*` = every key, `**` = any depth. Copy keys are proposals (section 3).", "");
  let current = "";
  for (const r of rowResults) {
    if (r.row.region !== current) {
      current = r.row.region;
      const inRegion = rowResults.filter(x => x.row.region === current);
      L.push("", `### ${current}`, "", `Spec: ${[...new Set(inRegion.flatMap(x => x.row.spec.split("; ")))].join("; ")}. Routes: ${[...new Set(inRegion.flatMap(x => x.row.routes))].map(s => `\`${s}\``).join(", ")}.`, "");
      L.push("| Field | Meaning | Values | Null path | Fixture | Copy key |", "|---|---|---|---|---|---|");
    }
    const field = r.row.path ? cell(pathLabel(r.row.path, r.row.expect)) : cell(r.row.label ?? "(no DTO field)");
    const observed = formatObserved(r.evidence.observed);
    const values = [cell(r.row.values), observed ? `seen: ${cell(observed)}` : ""].filter(Boolean).join("<br>");
    const fixture = r.evidence.fixture
      ? `\`${r.evidence.fixture}\` (${r.evidence.count})${r.verdict === "ok" ? "" : ` · ${statusText(r.verdict, r.row)}`}`
      : statusText(r.verdict, r.row);
    const extra = r.verdict === "problem" ? `<br>${cell(r.evidence.problems.join("; "))}` : "";
    L.push(`| ${field} | ${cell(r.row.meaning)} | ${values} | ${cell(r.row.nullPath)} | ${fixture}${extra} | ${cell(r.row.copyKey)} |`);
  }
  L.push("", coordinator(blocks, "regions", "completion of section 1: missing regions, corrected meanings, and the Users / rep fixture names after CF8."), "");

  // 2
  L.push("## 2. Changed since the final spec was written", "");
  L.push("The final spec is dated 2026-09-23 and already carries the readiness amendments R1–R13 (RD1–RD12). Each later change names its decision id(s) (D = final spec, RD = readiness, E = assignment addendum, F / T4-* = Team 4, G = reconciliation; `DECISIONS …` = the delivery log) and a verified fixture.", "");
  L.push("| Change | Decision | Fixture | Status |", "|---|---|---|---|");
  for (const { change, evidence } of changeResults) {
    const where = evidence.fixture ? `\`${evidence.fixture}\` → ${pathLabel(change.path, change.expect)}` : `${pathLabel(change.path, change.expect)} in ${change.routes.join(", ")}`;
    const verdict: Verdict = evidence.status === "no_fixture" ? "no_fixture" : evidence.problems.length ? "problem" : evidence.status;
    const st = verdict === "problem" ? `**CHECK**: ${evidence.problems.join("; ")}` : statusText(verdict, change);
    L.push(`| ${cell(change.what)} | ${cell(change.ids)} | ${cell(where)} | ${cell(st)} |`);
  }
  L.push("", "### 2.1 Field tables of each `CONTRACT.md`", "");
  L.push("Every row of a field or path table in each stage's `CONTRACT.md`, with the decision ids the row names and the plain fixture names it cites, each checked to exist (brace and `-suffix` shorthands are not checked). A stage without a `CONTRACT.md` is listed so the coordinator writes it.", "");
  for (const stage of stages) {
    const contract = readText(resolve(CONTRACTS, stage, "CONTRACT.md"));
    if (!contract) { L.push("", `#### ${stage}`, "", `No \`CONTRACT.md\` yet (fixtures captured; see \`${stage}/_capture-index.json\`).`); continue; }
    const rows = markdownTables(contract).filter(table => /^(field|path|field \/ route|entry|change)\b/i.test(table[0]?.[0] ?? "")).flatMap(table => table.slice(1));
    L.push("", `#### ${stage} (${rows.length} rows)`, "");
    if (!rows.length) { L.push("No field table found."); continue; }
    L.push("| Field | Decision ids | Cited fixtures |", "|---|---|---|");
    for (const row of rows) {
      const text = row.join(" ");
      const cited = citedFixtureNames(text).map(name => {
        const rel = name.startsWith("../") ? name.slice(3) : /^[A-Za-z0-9]+\//.test(name) && !name.startsWith("flag-off/") ? name : `${stage}/${name}`;
        return existsSync(resolve(CONTRACTS, rel)) ? `\`${name}\`` : `\`${name}\` **(missing)**`;
      });
      L.push(`| ${cell(row[0])} | ${decisionIds(text).join(", ") || "—"} | ${cited.join(", ") || "—"} |`);
    }
  }
  L.push("", coordinator(blocks, "changes", "changes the table misses, and which ones the interview must walk through."), "");

  // 3
  L.push("## 3. Left to the UI on purpose", "", LEFT_TO_UI, "", coordinator(blocks, "left-to-ui", "additions from the operator."), "");

  // 4
  L.push("## 4. The data state", "");
  L.push("Where the fixtures came from. The times are the captures' own.", "");
  L.push("| Stage | Database | Captured at | Calls ok / total | Flag-off capture | Seed states | Server tree | Mode |", "|---|---|---|---|---|---|---|---|");
  for (const stage of stages) {
    const index = readJson<CaptureIndex>(resolve(CONTRACTS, stage, "_capture-index.json"));
    const off = readJson<CaptureIndex>(resolve(CONTRACTS, stage, "flag-off", "_capture-index.json"));
    const calls = index?.calls ?? [], offCalls = off?.calls ?? [];
    L.push(`| ${stage} | \`${index?.database ?? "?"}\` | ${index?.captured_at ?? "?"} | ${calls.filter(c => c.ok).length} / ${calls.length} | ${off ? `${off.captured_at ?? "?"} (${offCalls.filter(c => c.ok).length} / ${offCalls.length})` : "—"} | ${stateCount(stage, stages)} | ${serverTree(stage, stages)} | ${cell(index?.mode ?? "")} |`);
  }
  const notes = stages.flatMap(stage => Object.entries(readJson<CaptureIndex>(resolve(CONTRACTS, stage, "_capture-index.json"))?.notes ?? {}).map(([key, text]) => `- ${stage} \`${key}\`: ${text}`));
  if (notes.length) L.push("", "Capture notes:", "", ...notes);
  const manifest = readJson<SeedManifest>(resolve(CONTRACTS, "seed-manifest.json"));
  if (manifest) L.push("", `Shared seed manifest: \`${manifest.database}\`, seeded ${manifest.seeded_at}, snapshot \`${manifest.snapshot_id}\`, ${manifest.rows?.length ?? 0} subjects. A stage with its own \`_seed-manifest.json\` validates against that file; older stages fall back to the shared one (DECISIONS 2026-09-24, per-stage seed manifests).`);
  L.push("", "### What happens in production after the capture", "");
  L.push("The fixtures are seed data. Production reaches this shape only after these operator steps, in order (reconciliation §5, G5):", "");
  const runbook = readText(resolve(WORKSPACE, "evidence", "S10-RUNBOOK.md"));
  const steps = runbook ? [...runbook.matchAll(/^## Step (\d+): (.+)$/gm)].map(m => `${m[1]}. ${m[2]}`) : [];
  if (steps.length) L.push(...steps);
  else L.push("(`evidence/S10-RUNBOOK.md` not found: see reconciliation §5, steps 1–9.)");
  const n = steps.length ? steps.length + 1 : 10;
  L.push(`${n}. The operator's **personal-key LLM backfill in Case File layout**, in its own session (G5; \`../CSI-PERSONAL-KEY-FULL-BACKFILL-HANDOFF.md\`). There is no "waiting on backfill" server state.`);
  L.push(`${n + 1}. **Team 2 recaptures its UI fixtures after the backfill** (G5), so the analysis text, findings and assessments in its fixtures are post-backfill. The contract fixtures here stay the schema reference.`);
  if (steps.length) L.push("", "Steps 1–9: `evidence/S10-RUNBOOK.md` (commands, replica dry runs, stop rules).");
  L.push("", coordinator(blocks, "data-state", "the production state at hand-off: which S10 steps have run, and the flags set in Vercel."), "");

  // 5
  L.push("## 5. Validation (C26)", "");
  L.push("Every fixture of every freeze, parsed with the server Zod DTOs (strict) and, where the registry lists them, the production Admin schemas (`vantage-admin@539a628`), in one generator run: one `test-si-contract-fixtures.ts` call per stage folder and per `flag-off/` folder found.", "");
  L.push("| Set | Tests | Pass | Fail | Exit |", "|---|---|---|---|---|");
  for (const run of runs) L.push(`| ${run.stage}${run.mode === "off" ? " flag-off" : ""} | ${run.tests ?? "?"} | ${run.pass ?? "?"} | ${run.fail ?? "?"} | ${run.code} |`);
  L.push(`| **All** | ${total.tests} | ${total.pass} | ${total.fail} | ${failedRuns.length ? 1 : 0} |`, "", "Command output:", "");
  for (const run of runs) {
    L.push(`<details><summary>${run.stage}${run.mode === "off" ? " flag-off" : ""}: ${run.code === 0 ? "pass" : "FAIL"} (${run.pass ?? "?"}/${run.tests ?? "?"})</summary>`, "", "```", `$ ${run.command}`, run.output, "```", "", "</details>", "");
  }
  L.push(coordinator(blocks, "validation", "the verdict, and the re-run after the last freeze."), "");

  writeFileSync(OUT, L.join("\n").replace(/\n{3,}/g, "\n\n") + "\n", "utf8");
  process.stderr.write(`wrote ${OUT}\nregions: ${count("ok")} ok, ${count("null_only")} null only, ${count("deferred")} deferred, ${noFixture.length} NO FIXTURE, ${problems.length} check; changes without fixture: ${changeMissing.length}/${changeResults.length}; validation: ${runs.length - failedRuns.length}/${runs.length} sets pass (${total.pass}/${total.tests} fixtures)\n`);
  for (const r of noFixture) process.stderr.write(`NO FIXTURE  ${r.row.region} :: ${r.row.path ?? r.row.label}${r.row.expect ? ` = ${r.row.expect}` : ""}\n`);
  for (const r of problems) process.stderr.write(`CHECK       ${r.row.region} :: ${r.row.path} :: ${r.evidence.problems.join("; ")}\n`);
  for (const c of changeMissing) process.stderr.write(`CHANGE      ${c.change.what.slice(0, 90)} :: ${c.evidence.problems.join("; ") || "no fixture"}\n`);
  for (const run of failedRuns) process.stderr.write(`VALIDATION  ${run.stage}${run.mode === "off" ? " flag-off" : ""} exit ${run.code}\n`);
  if (failed) process.exitCode = 1;
}
main().catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
