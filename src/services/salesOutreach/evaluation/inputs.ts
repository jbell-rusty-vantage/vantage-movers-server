import type {
  ContactEventKind,
  ContactVerification,
  EngineAssignmentInterval,
  EngineContactEvent,
  EngineHumanPlan,
  EngineRestrictionInterval,
  EvaluateSubjectInput,
} from "../engine";
import type { DeskPeriodRow, DeskSubjectRow } from "../subjects/store";
import type { AssignmentChangeRow, CoverageFacts, DeskPlanRow, DeskRestrictionRow, RepLinkPeriod, StoredContactEvent } from "./store";

/**
 * Pure mapping from stored desk rows to the engine input (`EvaluateSubjectInput`). No clock, no I/O:
 * the caller loads the rows (evaluation/store.ts) and passes `as_of`.
 */

/** RINGCENTRAL-CAPTURE §8: a call deadline is provable only 2 minutes after the Call Log covers it. */
export const CALL_SETTLEMENT_ALLOWANCE_MS = 2 * 60_000;
const EPOCH = new Date(0);
const iso = (d: Date) => d.toISOString();

export type EvaluationRows = Readonly<{
  subject: DeskSubjectRow;
  periods: readonly DeskPeriodRow[];
  plans: readonly DeskPlanRow[];
  restrictions: readonly DeskRestrictionRow[];
  assignment_changes: readonly AssignmentChangeRow[];
  rep_links: readonly RepLinkPeriod[];
  contact_events: readonly StoredContactEvent[];
  coverage: CoverageFacts;
}>;

export function buildEngineInput(rows: EvaluationRows): EvaluateSubjectInput {
  const { subject } = rows;
  const closedPeriod = rows.periods.find((p) => p.workflow === "closed");
  return {
    subject: {
      subject_id: subject.id,
      status: subject.status,
      closed_at: subject.status === "closed" && closedPeriod ? iso(closedPeriod.started_at) : null,
      received_at: subject.received_at ? iso(subject.received_at) : null,
      move_date: subject.display.move_date ?? null,
      priority_uncertain: subject.priority.uncertain,
      activation_at: iso(subject.enrollment.activation_at),
      // P07g originating answered inbound: needs S3's contact-event origin marker (open question).
      originating_contact_event_id: null,
    },
    periods: rows.periods.map((p) => ({
      period_id: p.id,
      workflow: p.workflow,
      priority_raw: p.priority,
      start_kind: p.start_kind,
      started_at: iso(p.started_at),
      ended_at: p.ended_at ? iso(p.ended_at) : null,
    })),
    human_plans: rows.plans.flatMap(toEnginePlan),
    restrictions: rows.restrictions.map(toEngineRestriction),
    assignments: assignmentIntervals(subject, rows.assignment_changes, rows.rep_links),
    contact_events: rows.contact_events.map(toEngineEvent),
    coverage: {
      call: {
        complete_through: rows.coverage.calls_known_complete_through
          ? iso(new Date(+rows.coverage.calls_known_complete_through - CALL_SETTLEMENT_ALLOWANCE_MS))
          : null,
      },
      sms: { complete_through: rows.coverage.sms_known_complete_through ? iso(rows.coverage.sms_known_complete_through) : null },
    },
  };
}

/** A command-ended plan carries its end; outcomes (`fulfilled`/`missed`) are the engine's, never stored inputs. */
function toEnginePlan(plan: DeskPlanRow): EngineHumanPlan[] {
  const ended = plan.status === "replaced" || plan.status === "cancelled";
  const common = {
    plan_id: plan.id,
    period_id: plan.period_id ?? "",
    effective_at: iso(plan.effective_at),
    ended_at: ended ? iso(plan.ended_at ?? plan.effective_at) : null,
    end_reason: ended ? (plan.status as "replaced" | "cancelled") : null,
    revision: plan.revision,
  };
  if (plan.kind === "quoted_date") return plan.selected_date ? [{ kind: "quoted_date", ...common, selected_date: plan.selected_date }] : [];
  return plan.appointment_at ? [{ kind: "callback", ...common, appointment_at: iso(plan.appointment_at) }] : [];
}

/**
 * The restriction's effective interval (P06c): from its creation until its release — the Owner's lift
 * (`resolved_at`), its stored `until`, or (an `expired` row without either) its last update. An
 * `active` row without `until` is open-ended. AI-origin rows count exactly like Owner rows until an
 * Owner confirms or lifts them: they are never cleared silently.
 */
export function toEngineRestriction(row: DeskRestrictionRow): EngineRestrictionInterval {
  const releases = [row.resolved_at, row.until, row.state === "expired" ? row.updated_at : null].filter((d): d is Date => d !== null);
  const released = row.state === "active" ? row.until : releases.length ? new Date(Math.min(...releases.map(Number))) : row.updated_at;
  return {
    restriction_id: row.id,
    channels: [...new Set(row.channels.map((c) => (c === "text" ? ("sms" as const) : ("call" as const))))],
    effective_at: iso(row.created_at),
    released_at: released ? iso(released) : null,
    reason: row.reason ?? (row.origin === "intelligence" ? "intelligence_restriction" : "owner_restriction"),
  };
}

const ENGINE_KINDS = new Set<ContactEventKind>(["outbound_attempt", "inbound_answered", "inbound_missed", "sms_sent", "sms_failed", "sms_inbound", "other"]);
const ENGINE_VERIFICATIONS = new Set<ContactVerification>(["confirmed", "awaiting_confirmation", "pending_identity", "pending_association", "excluded"]);

function toEngineEvent(row: StoredContactEvent): EngineContactEvent {
  const outcome =
    row.outcome === "answered" || row.outcome === "unanswered"
      ? row.outcome
      : row.kind === "inbound_answered"
        ? "answered"
        : row.kind === "inbound_missed"
          ? "unanswered"
          : "unknown";
  return {
    event_id: `${row.source_kind}:${row.source_id}`,
    source_kind: row.source_kind,
    source_id: row.source_id,
    channel: row.channel,
    direction: row.direction,
    event_at: iso(row.event_at),
    kind: ENGINE_KINDS.has(row.kind as ContactEventKind) ? (row.kind as ContactEventKind) : "other",
    // An unknown stored verification is never credited.
    verification: ENGINE_VERIFICATIONS.has(row.verification as ContactVerification) ? (row.verification as ContactVerification) : "excluded",
    exclusion_reason: row.exclusion_reason,
    actor_agent_id: row.actor_agent_id,
    goal_agent_id: row.goal_agent_id,
    outcome,
    restricted_at_contact: row.restricted_at_contact,
  };
}

/**
 * P06d assignment history (IMPL-01): the Lead's `receiver_agent` over time from its `entity_changes`,
 * where an Agent counts as the assignee only while it has a reviewed `sales_rep` link (else
 * Unassigned). Without any recorded change the subject's current assignee holds from the start.
 */
export function assignmentIntervals(
  subject: Pick<DeskSubjectRow, "assigned_agent_id">,
  changes: readonly AssignmentChangeRow[],
  links: readonly RepLinkPeriod[],
): EngineAssignmentInterval[] {
  const raw: Array<{ agent: string | null; from: Date; to: Date | null }> = [];
  const ordered = [...changes].sort((a, b) => +a.applied_at - +b.applied_at);
  let agent = ordered.length ? ordered[0]!.before : subject.assigned_agent_id;
  let from = EPOCH;
  for (const change of ordered) {
    if (+change.applied_at > +from) raw.push({ agent, from, to: change.applied_at });
    agent = change.after;
    from = change.applied_at;
  }
  raw.push({ agent, from, to: null });
  const out: EngineAssignmentInterval[] = [];
  for (const interval of raw) for (const piece of withReviewedLinks(interval, links)) out.push(piece);
  return mergeAdjacent(out);
}

/** Splits one raw interval into reviewed-link pieces (the Agent) and gaps (Unassigned). */
function withReviewedLinks(interval: { agent: string | null; from: Date; to: Date | null }, links: readonly RepLinkPeriod[]): EngineAssignmentInterval[] {
  const end = interval.to ? +interval.to : Number.POSITIVE_INFINITY;
  const unassigned = (from: number, to: number): EngineAssignmentInterval => ({
    agent_id: null,
    from: iso(new Date(from)),
    to: Number.isFinite(to) ? iso(new Date(to)) : null,
  });
  if (!interval.agent) return [unassigned(+interval.from, end)];
  const periods = links
    .filter((l) => l.agent_id === interval.agent)
    .map((l) => [Math.max(+l.effective_from, +interval.from), Math.min(l.effective_to ? +l.effective_to : Number.POSITIVE_INFINITY, end)] as const)
    .filter(([s, e]) => s < e)
    .sort((a, b) => a[0] - b[0]);
  const out: EngineAssignmentInterval[] = [];
  let cursor = +interval.from;
  for (const [s, e] of periods) {
    if (e <= cursor) continue;
    if (s > cursor) out.push(unassigned(cursor, s));
    out.push({ agent_id: interval.agent, from: iso(new Date(Math.max(s, cursor))), to: Number.isFinite(e) ? iso(new Date(e)) : null });
    cursor = e;
  }
  if (cursor < end) out.push(unassigned(cursor, end));
  return out;
}

function mergeAdjacent(intervals: EngineAssignmentInterval[]): EngineAssignmentInterval[] {
  const out: EngineAssignmentInterval[] = [];
  for (const interval of intervals) {
    const last = out.at(-1);
    if (last && last.agent_id === interval.agent_id && last.to === interval.from) last.to = interval.to;
    else out.push({ ...interval });
  }
  return out;
}
