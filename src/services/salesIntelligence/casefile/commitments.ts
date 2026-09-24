import { addStaffedMinutes, type Staffing } from "../outreach/staffing";
import { followupKindLabel, originLabel } from "../story/catalog";
import type { StoryEvent } from "../story/types";
import type { SummaryStep } from "../analysis/structuredContract";
import { cleanText, clip } from "./digest";
import { etDaysBetween, fullDate, fullTime, parseIso, timelineDate } from "./time";
import type { CaseFinding, CaseFollowup, CaseLedgerLine } from "./types";

/**
 * F7 Commitments ledger (spec §4.7). A commitment is a `said_on_call` claim that is `requested` or
 * `promised`, or a follow-up whose origin is a promise, request, wait or the Owner. Status is
 * deterministic and linked only through records, never free text:
 *
 *   claim → findings of the same conversation and kind whose transcript segments overlap the
 *   claim's → follow-ups whose `source_finding_ids` name one of them → the follow-up chain
 *   (`supersedes_id`, `retry:<root>:<n>` commitment keys).
 *
 * Strongest first: kept at Tn · open (F-n, due, overdue) · attempted, not reached · superseded by
 * Cn · no record it was done (past its date, or 2 staffed days when undated) · pending.
 * An unlinked claim can only be "no record it was done" or "pending".
 */
export const LEDGER_BOUND = 40;
/** The undated grace: two staffed days of the default 12-hour staffed day. */
export const UNDATED_GRACE_STAFFED_MINUTES = 2 * 720;
const COMMITMENT_ORIGINS = new Set(["rep_promise", "customer_request", "customer_wait", "owner"]);
const KEPT_DISPOSITIONS = new Set(["spoke_with_customer", "customer_called", "completed"]);
const KEPT_BASES = new Set(["owner", "customer_confirmation", "rep_confirmation"]);
const UNREACHED = new Set(["no_answer", "left_voicemail", "connected_contact_unknown"]);
/** Automatic confirmations are not a rep keeping a promise to text. */
const AUTOMATIC_MESSAGE_PURPOSES = new Set(["quote_request_confirmation", "granot_lead_created_confirmation"]);

export type LedgerCall = { conversation_id: string; c: number; started_at: string; summary: SummaryStep };
export type LedgerInput = {
  calls: readonly LedgerCall[];
  findings: readonly CaseFinding[];
  followups: readonly CaseFollowup[];
  /** Case File story events in T order (index = Tn). */
  events: readonly StoryEvent[];
  as_of: string;
  staffing: Staffing;
  followupLabel: (id: string) => string;
};
export type LedgerResult = {
  lines: CaseLedgerLine[];
  omitted: number;
  /** `conversation:index` of a claim → its `Kn` and short tag (digests and SAID lines). */
  claims: Map<string, { k: number; tag: string }>;
};

type Status = { rank: number; text: string; short: string };
const segmentsOverlap = (a: readonly number[], b: readonly number[]) => a.some(x => b.includes(x));

/** The follow-up and everything that superseded or retried it, oldest first. */
export function followupChain(root: CaseFollowup, all: readonly CaseFollowup[]): CaseFollowup[] {
  const members = new Map<string, CaseFollowup>([[root.id, root]]);
  for (let grew = true; grew;) {
    grew = false;
    for (const row of all) {
      if (members.has(row.id)) continue;
      const retryRoot = row.commitment_key?.startsWith("retry:") ? row.commitment_key.split(":")[1] : null;
      if ((row.supersedes_id && members.has(row.supersedes_id)) || (retryRoot && members.has(retryRoot))) { members.set(row.id, row); grew = true; }
    }
  }
  return [...members.values()].sort((a, b) => Date.parse(a.created_at ?? "") - Date.parse(b.created_at ?? "") || (a.id < b.id ? -1 : 1));
}

function dueText(iso: string | null, asOf: string): string {
  if (!iso) return "no due date";
  const at = parseIso(iso)!, now = parseIso(asOf)!;
  const days = etDaysBetween(iso, asOf);
  const state = +at <= +now ? (days >= 1 ? `, overdue ${days} day${days === 1 ? "" : "s"}` : ", overdue today") : "";
  return `due ${fullTime(iso)}${state}`;
}

function followupStatus(chain: readonly CaseFollowup[], input: LedgerInput, events: readonly StoryEvent[]): Status | null {
  const tOf = (followupId: string) => events.findIndex(e => e.kind === "followup_completed" && e.detail.followup_id === followupId);
  const kept = chain.find(f => f.status === "completed" && ((f.disposition && KEPT_DISPOSITIONS.has(f.disposition)) || (f.completion_basis && KEPT_BASES.has(f.completion_basis))));
  if (kept) {
    const t = tOf(kept.id);
    return { rank: 1, text: t >= 0 ? `kept at T${t}` : `kept (${input.followupLabel(kept.id)} completed ${fullDate(kept.completed_at)})`, short: t >= 0 ? `kept T${t}` : "kept" };
  }
  const unreached = chain.filter(f => f.status === "completed" && f.disposition && UNREACHED.has(f.disposition));
  const open = chain.filter(f => f.status === "open");
  const retryOpen = open.find(f => f.commitment_key?.startsWith("retry:"));
  if (open.length && !(retryOpen && unreached.length)) {
    const f = open[0]!;
    return { rank: 2, text: `open (${input.followupLabel(f.id)}, ${dueText(f.due_at, input.as_of)})`, short: `open ${input.followupLabel(f.id)}` };
  }
  if (unreached.length) {
    const retry = retryOpen ? `; retry ${input.followupLabel(retryOpen.id)} ${dueText(retryOpen.due_at, input.as_of)}` : "";
    return { rank: 3, text: `attempted, not reached (${unreached.length} attempt${unreached.length === 1 ? "" : "s"}${retry})`, short: "not reached" };
  }
  if (chain.length && chain.every(f => f.status === "superseded")) return { rank: 4, text: "superseded by a later follow-up", short: "superseded" };
  if (chain.length && chain.every(f => f.status === "cancelled" || f.status === "superseded")) {
    const reason = chain.map(f => f.cancel_reason).find(Boolean);
    return { rank: 4, text: `cancelled${reason ? `: ${cleanText(reason, 120)}` : ""}`, short: "cancelled" };
  }
  return null;
}

function dateStatus(due: string | null, since: string, input: LedgerInput): Status {
  const deadline = due ?? addStaffedMinutes(new Date(since), UNDATED_GRACE_STAFFED_MINUTES, input.staffing).toISOString();
  if (Date.parse(input.as_of) > Date.parse(deadline)) return { rank: 5, text: "no record it was done", short: "no record" };
  return { rank: 6, text: `pending (${due ? `due ${fullTime(due)}` : `undated; grace until ${fullTime(deadline)}`})`, short: "pending" };
}

type Entry = { at: string; text: string; conversation_id: string | null; claim_key: string | null; status: Status };

export function buildLedger(input: LedgerInput): LedgerResult {
  const entries: Entry[] = [];
  const linkedFollowups = new Set<string>();
  const callByConversation = new Map(input.calls.map(c => [c.conversation_id, c]));
  const eventIndex = (predicate: (e: StoryEvent) => boolean, after: string) => input.events.findIndex(e => predicate(e) && Date.parse(e.happened_at) >= Date.parse(after));

  for (const call of input.calls) {
    call.summary.said_on_call.forEach((fact, index) => {
      if (fact.action_status !== "requested" && fact.action_status !== "promised") return;
      const findings = input.findings.filter(f => !f.purged && f.conversation_id === call.conversation_id && f.kind === fact.kind && segmentsOverlap(f.segment_ids, fact.segment_ids));
      const findingIds = new Set(findings.map(f => f.id));
      const roots = input.followups.filter(f => f.source_finding_ids.some(id => findingIds.has(id)));
      const chain = [...new Map(roots.flatMap(r => followupChain(r, input.followups)).map(f => [f.id, f])).values()];
      chain.forEach(f => linkedFollowups.add(f.id));
      const action = (fact.value as { action_kind?: string }).action_kind ?? null;
      let status = followupStatus(chain, input, input.events);
      if (!status || status.rank > 1) {
        const byEvent = action === "text_customer_via_lead_message"
          ? eventIndex(e => e.kind === "lead_message_sent" && !AUTOMATIC_MESSAGE_PURPOSES.has(String(e.detail.purpose ?? "")), call.started_at)
          : fact.kind === "booking_claim" ? eventIndex(e => e.kind === "booking_recorded", call.started_at) : -1;
        if (byEvent >= 0) status = { rank: 1, text: `kept at T${byEvent}`, short: `kept T${byEvent}` };
      }
      if (!status) {
        const superseding = findings.map(f => f.superseded_by).find(Boolean);
        const by = superseding ? input.findings.find(f => f.id === superseding) : null;
        const byCall = by?.conversation_id ? callByConversation.get(by.conversation_id) : null;
        if (superseding) status = { rank: 4, text: `superseded by ${byCall ? `C${byCall.c}` : "a later finding"}`, short: "superseded" };
      }
      status ??= dateStatus(findings.map(f => f.resolved_due_at).find(Boolean) ?? null, call.started_at, input);
      const who = fact.speaker === "unknown" ? "someone" : fact.speaker;
      entries.push({ at: call.started_at, conversation_id: call.conversation_id, claim_key: `${call.conversation_id}:${index}`, status,
        text: `${who} ${fact.action_status} "${clip(cleanText(fact.claim, 200), 120)}" (C${call.c}, ${fullDate(call.started_at)})` });
    });
  }

  for (const row of input.followups) {
    if (linkedFollowups.has(row.id) || !COMMITMENT_ORIGINS.has(row.origin) || row.missed_episode_key) continue;
    if (row.supersedes_id && input.followups.some(f => f.id === row.supersedes_id && COMMITMENT_ORIGINS.has(f.origin))) continue;
    const chain = followupChain(row, input.followups);
    chain.forEach(f => linkedFollowups.add(f.id));
    const status = followupStatus(chain, input, input.events) ?? dateStatus(row.due_at, row.created_at ?? input.as_of, input);
    entries.push({ at: row.created_at ?? input.as_of, conversation_id: null, claim_key: null, status,
      text: `${originLabel(row.origin)} follow-up: ${followupKindLabel(row.kind)} "${clip(cleanText(row.description ?? "", 200), 120)}" (${input.followupLabel(row.id)}, created ${timelineDate(row.created_at, input.as_of)})` });
  }

  entries.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
  const omitted = Math.max(0, entries.length - LEDGER_BOUND);
  const kept = entries.slice(omitted);
  const claims = new Map<string, { k: number; tag: string }>();
  const lines = kept.map((entry, index) => {
    const k = index + 1;
    if (entry.claim_key) claims.set(entry.claim_key, { k, tag: `K${k} → ${entry.status.short}` });
    return { k, text: `K${k} ${entry.text} → ${entry.status.text}`, conversation_id: entry.conversation_id, tag: `K${k} → ${entry.status.short}` };
  });
  return { lines, omitted, claims };
}
