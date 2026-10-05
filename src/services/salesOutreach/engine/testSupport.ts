/**
 * Test-only builders for the engine's fixture suites (imported by *.test.ts only).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FINAL_01_CADENCE_VALUE } from "./approvedStartingValues";
import { localInstant } from "./calendar";
import { evaluateSubject } from "./evaluate";
import { resolveEnginePolicy, type CadenceConfigurationValue } from "./policy";
import type {
  EngineAssignmentInterval,
  EngineCallbackPlan,
  EngineContactEvent,
  EngineHumanPlan,
  EnginePolicy,
  EnginePolicyPeriod,
  EngineQuotedDatePlan,
  EngineRestrictionInterval,
  EvaluateSubjectInput,
  EvaluateSubjectResult,
  OutreachWorkflow,
  PeriodStartKind,
} from "./types";

export const TZ = "America/New_York";

export function policyWith(patch: Partial<CadenceConfigurationValue> = {}): EnginePolicy {
  const resolved = resolveEnginePolicy({ ...FINAL_01_CADENCE_VALUE, ...patch });
  if (!resolved.ok) throw new Error(resolved.reasons.join("; "));
  return resolved.policy;
}

export const POLICY = policyWith();

/** New York local `date` + `HH:MM` → UTC ISO. */
export function ny(date: string, hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(localInstant(date, h! * 60 + m!, TZ)).toISOString();
}

/** New York local `date` + minute of day → UTC ISO. */
export function nyMinute(date: string, minute: number): string {
  return new Date(localInstant(date, minute, TZ)).toISOString();
}

export function minutesAfter(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString();
}

export function period(id: string, workflow: OutreachWorkflow, startedAt: string, startKind: PeriodStartKind, endedAt: string | null = null, priority?: string | null): EnginePolicyPeriod {
  return { period_id: id, workflow, priority_raw: priority !== undefined ? priority : workflow === "new" ? "0" : workflow === "quoted" ? "1" : null, start_kind: startKind, started_at: startedAt, ended_at: endedAt };
}

/** Sequential periods: each ends when the next starts. */
export function periods(...list: Array<[id: string, workflow: OutreachWorkflow, startedAt: string, startKind: PeriodStartKind, priority?: string]>): EnginePolicyPeriod[] {
  return list.map(([id, workflow, startedAt, startKind, priority], i) => period(id, workflow, startedAt, startKind, list[i + 1]?.[2] ?? null, priority));
}

let seq = 0;
interface EventOptions {
  id?: string;
  agent?: string | null;
  outcome?: EngineContactEvent["outcome"];
  verification?: EngineContactEvent["verification"];
  restricted?: boolean;
}

export function outbound(at: string, opts: EventOptions = {}): EngineContactEvent {
  const id = opts.id ?? `c${++seq}`;
  const agent = opts.agent === undefined ? "alice" : opts.agent;
  return {
    event_id: `call:${id}`,
    source_kind: "call",
    source_id: id,
    channel: "call",
    direction: "outbound",
    event_at: at,
    kind: "outbound_attempt",
    verification: opts.verification ?? "confirmed",
    exclusion_reason: null,
    actor_agent_id: agent,
    goal_agent_id: (opts.verification ?? "confirmed") === "confirmed" ? agent : null,
    outcome: opts.outcome ?? "unanswered",
    restricted_at_contact: opts.restricted ?? false,
  };
}

export function inbound(at: string, opts: EventOptions & { answered?: boolean } = {}): EngineContactEvent {
  const id = opts.id ?? `c${++seq}`;
  const answered = opts.answered ?? true;
  return {
    event_id: `call:${id}`,
    source_kind: "call",
    source_id: id,
    channel: "call",
    direction: "inbound",
    event_at: at,
    kind: answered ? "inbound_answered" : "inbound_missed",
    verification: opts.verification ?? "confirmed",
    exclusion_reason: null,
    actor_agent_id: answered ? (opts.agent === undefined ? "alice" : opts.agent) : null,
    goal_agent_id: null,
    outcome: answered ? "answered" : "unanswered",
    restricted_at_contact: opts.restricted ?? false,
  };
}

export function sms(at: string, opts: EventOptions & { kind?: EngineContactEvent["kind"] } = {}): EngineContactEvent {
  const id = opts.id ?? `s${++seq}`;
  return {
    event_id: `sms:${id}`,
    source_kind: "sms",
    source_id: id,
    channel: "sms",
    direction: opts.kind === "sms_inbound" ? "inbound" : "outbound",
    event_at: at,
    kind: opts.kind ?? "sms_sent",
    verification: opts.verification ?? "confirmed",
    exclusion_reason: null,
    actor_agent_id: opts.agent === undefined ? "alice" : opts.agent,
    goal_agent_id: null,
    outcome: "unknown",
    restricted_at_contact: opts.restricted ?? false,
  };
}

export function quotedPlan(id: string, periodId: string, selected: string, effectiveAt: string, endedAt: string | null = null, revision = 1): EngineQuotedDatePlan {
  return { kind: "quoted_date", plan_id: id, period_id: periodId, selected_date: selected, effective_at: effectiveAt, ended_at: endedAt, end_reason: endedAt ? "replaced" : null, revision };
}

export function callbackPlan(id: string, periodId: string, appointment: string, effectiveAt: string, endedAt: string | null = null, endReason: EngineCallbackPlan["end_reason"] = null, revision = 1): EngineCallbackPlan {
  return { kind: "callback", plan_id: id, period_id: periodId, appointment_at: appointment, effective_at: effectiveAt, ended_at: endedAt, end_reason: endedAt ? endReason ?? "replaced" : null, revision };
}

export function restriction(id: string, channels: Array<"call" | "sms">, effectiveAt: string, releasedAt: string | null, reason = "customer_request"): EngineRestrictionInterval {
  return { restriction_id: id, channels, effective_at: effectiveAt, released_at: releasedAt, reason };
}

const FAR = "2099-01-01T00:00:00.000Z";

export interface ScenarioOptions {
  received_at?: string | null;
  periods: EnginePolicyPeriod[];
  events?: EngineContactEvent[];
  plans?: EngineHumanPlan[];
  restrictions?: EngineRestrictionInterval[];
  assignments?: EngineAssignmentInterval[];
  activation_at?: string;
  status?: EvaluateSubjectInput["subject"]["status"];
  closed_at?: string | null;
  move_date?: string | null;
  priority_uncertain?: boolean;
  originating_contact_event_id?: string | null;
  call_complete_through?: string | null;
  sms_complete_through?: string | null;
}

export function scenario(opts: ScenarioOptions): EvaluateSubjectInput {
  const received = opts.received_at === undefined ? opts.periods[0]!.started_at : opts.received_at;
  return {
    subject: {
      subject_id: "subject-1",
      status: opts.status ?? "active",
      closed_at: opts.closed_at ?? null,
      received_at: received,
      move_date: opts.move_date === undefined ? "2026-12-01" : opts.move_date,
      priority_uncertain: opts.priority_uncertain ?? false,
      activation_at: opts.activation_at ?? (received ?? opts.periods[0]!.started_at),
      originating_contact_event_id: opts.originating_contact_event_id ?? null,
    },
    periods: opts.periods,
    human_plans: opts.plans ?? [],
    restrictions: opts.restrictions ?? [],
    assignments: opts.assignments ?? [{ agent_id: "alice", from: "2000-01-01T00:00:00.000Z", to: null }],
    contact_events: opts.events ?? [],
    coverage: {
      call: { complete_through: opts.call_complete_through === undefined ? FAR : opts.call_complete_through },
      sms: { complete_through: opts.sms_complete_through === undefined ? FAR : opts.sms_complete_through },
    },
  };
}

export function evaluate(input: EvaluateSubjectInput, asOf: string, policy: EnginePolicy = POLICY): EvaluateSubjectResult {
  return evaluateSubject(input, policy, asOf);
}

/** Obligations of a channel/kind dated `date`. */
export function obligationsOn(result: EvaluateSubjectResult, date: string, channel: "call" | "sms", kinds: string[] = ["ordinary", "quoted"]) {
  return result.obligations.filter((o) => o.business_date === date && o.channel === channel && kinds.includes(o.kind));
}

export function fixture<T = Record<string, unknown>>(name: string): T {
  return JSON.parse(readFileSync(join(process.cwd(), "docs/sales-outreach-desk/contracts/fixtures", name), "utf8")) as T;
}

export interface FixtureFile<C> {
  cases: C[];
  [key: string]: unknown;
}
