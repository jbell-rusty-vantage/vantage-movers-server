import type { ClientSession } from "mongoose";
import type { JobInput } from "../../salesIntelligence/jobs";
import type { DeskLeadRef } from "../subjects/leadFacts";
import type { DeskPeriodRow, DeskSubjectRow } from "../subjects/store";
import { objectId } from "../subjects/testing";
import type {
  AssignmentChangeRow,
  CoverageFacts,
  DeskPlanRow,
  DeskRestrictionRow,
  EvaluationStore,
  ProjectionHead,
  ProjectionWrite,
  RepLinkPeriod,
  StoredContactEvent,
} from "./store";

/** Unit-test stand-in for the evaluation store (no Mongo); it records every write and nomination. */
export class MemoryEvaluationStore implements EvaluationStore {
  subjects = new Map<string, DeskSubjectRow>();
  periods: DeskPeriodRow[] = [];
  plans: DeskPlanRow[] = [];
  restrictions: DeskRestrictionRow[] = [];
  changes = new Map<string, AssignmentChangeRow[]>();
  links: RepLinkPeriod[] = [];
  events: Array<StoredContactEvent & { subject_id: string }> = [];
  coverage: CoverageFacts = { calls_known_complete_through: null, sms_known_complete_through: null };
  projections = new Map<string, { doc: ProjectionWrite; revision: number }>();
  jobs = new Map<string, JobInput>();
  cursor: string | null = null;
  writes: string[] = [];

  async loadSubject(id: string) {
    const row = this.subjects.get(id);
    return row ? structuredClone(row) : null;
  }
  async loadPeriods(subjectId: string) {
    return this.periods.filter((p) => p.subject_id === subjectId);
  }
  async loadPlans(subjectId: string) {
    return this.plans.filter((p) => p.subject_id === subjectId);
  }
  async loadRestrictions(ids: readonly string[]) {
    return this.restrictions.filter((r) => ids.includes(r.contact_number_id));
  }
  async loadAssignmentChanges(lead: DeskLeadRef) {
    return this.changes.get(`${lead.model}:${lead.id}`) ?? [];
  }
  async loadRepLinks(agentIds: readonly string[]) {
    return this.links.filter((l) => agentIds.includes(l.agent_id));
  }
  async loadContactEvents(subjectId: string) {
    return this.events.filter((e) => e.subject_id === subjectId);
  }
  async loadCoverage(smsEnabled: boolean) {
    return { ...this.coverage, sms_known_complete_through: smsEnabled ? this.coverage.sms_known_complete_through : null };
  }
  async readProjection(subjectId: string): Promise<ProjectionHead | null> {
    const row = this.projections.get(subjectId);
    if (!row) return null;
    return {
      revision: row.revision,
      publication_revision: Number(row.doc.publication_revision ?? 0),
      result_fingerprint: row.doc.result_fingerprint,
      policy_fingerprint: (row.doc.policy_fingerprint as string | undefined) ?? null,
    };
  }
  async insertProjection(subjectId: string, doc: ProjectionWrite) {
    if (this.projections.has(subjectId)) throw Object.assign(new Error("E11000"), { code: 11000 });
    this.projections.set(subjectId, { doc: structuredClone(doc), revision: 1 });
    this.writes.push(`insertProjection:${subjectId}`);
  }
  async updateProjection(subjectId: string, expectedRevision: number, doc: ProjectionWrite) {
    const row = this.projections.get(subjectId);
    if (!row || row.revision !== expectedRevision) return false;
    this.projections.set(subjectId, { doc: structuredClone(doc), revision: expectedRevision + 1 });
    this.writes.push(`updateProjection:${subjectId}`);
    return true;
  }
  async dueProjections(now: Date, after: { at: Date; subject_id: string } | null, limit: number) {
    return [...this.projections.entries()]
      .flatMap(([subject_id, row]) => {
        const at = row.doc.next_evaluation_at as Date | null;
        return at && +at <= +now ? [{ subject_id, next_evaluation_at: at }] : [];
      })
      .sort((a, b) => +a.next_evaluation_at - +b.next_evaluation_at || a.subject_id.localeCompare(b.subject_id))
      .filter((r) => !after || +r.next_evaluation_at > +after.at || (+r.next_evaluation_at === +after.at && r.subject_id > after.subject_id))
      .slice(0, limit);
  }
  async readReconcileCursor() {
    return this.cursor;
  }
  async writeReconcileCursor(id: string | null) {
    this.cursor = id;
  }
  async subjectIdsAfter(afterId: string | null, limit: number) {
    return [...this.subjects.keys()].sort().filter((id) => !afterId || id > afterId).slice(0, limit);
  }
  async projectionPolicies(ids: readonly string[]) {
    return new Map(ids.flatMap((id) => (this.projections.has(id) ? [[id, (this.projections.get(id)!.doc.policy_fingerprint as string) ?? null] as const] : [])));
  }
  async enqueue(job: JobInput) {
    this.jobs.set(job.dedupe_key, job);
    return "enqueued" as const;
  }
}

export const fakeSession = { inTransaction: () => true } as unknown as ClientSession;
export const runInFakeTransaction = <T>(work: (session: ClientSession) => Promise<T>) => work(fakeSession);

/** An enrolled active subject row with an intake boundary (override what a test needs). */
export function subjectRow(overrides: Partial<DeskSubjectRow> = {}): DeskSubjectRow {
  const received = new Date("2026-10-05T14:00:00.000Z");
  return {
    id: objectId(),
    lead: { model: "FormLead", id: objectId() },
    enrollment: { cohort_id: "intake:test", kind: "intake", enrolled_at: received, activation_at: received, manifest_hash: null },
    status: "active",
    review_reasons: [],
    received_at: received,
    received_date: "2026-10-05",
    received_quality: "instant",
    adapter_version: "lead-instant-v1",
    display: { job_no: "J-100", normalized_job_no: "J100", phone: "(555) 010-0000", normalized_phone: "5550100000", name: "Synthetic Customer", move_date: null },
    priority: { raw: null, accepted_at: null, observation_id: null, basis: "intake_default", uncertain: false },
    assigned_agent_id: null,
    assignment_revision: 0,
    lead_revision_seen: 1,
    contact_number_ids: [],
    revision: 1,
    ...overrides,
  } as DeskSubjectRow;
}

export function periodRow(subjectId: string, overrides: Partial<DeskPeriodRow> = {}): DeskPeriodRow {
  return {
    id: objectId(),
    subject_id: subjectId,
    transition_key: "intake_default:website_form",
    workflow: "new",
    start_kind: "intake",
    priority: null,
    started_at: new Date("2026-10-05T14:00:00.000Z"),
    ended_at: null,
    end_reason: null,
    ...overrides,
  };
}

/** The FINAL-01 cadence in the persisted encoding (test copy; `ops/lib/sales-outreach-final01.test.ts` proves the installer's equals it). */
export const TEST_FINAL01_CADENCE = {
  policy_version: "final-policy-2026-10-03-v1",
  approval_ref: "owner-session-2026-10-03-FINAL-01",
  timezone: "America/New_York",
  calendar_mode: "new_york_calendar_date",
  working_days: [1, 2, 3, 4, 5, 6, 7].map((iso_weekday) => ({ iso_weekday, open_minute: 480, close_minute: 1200 })),
  holidays: [],
  initial_response_working_minutes: 30,
  new_days_1_3_calls: { required: 2, optional: 1 },
  new_call_slots: [
    { from_day: 1, to_day: 5, deadline_minutes: [720, 1200] },
    { from_day: 6, to_day: null, deadline_minutes: [1200] },
  ],
  new_call_min_spacing_minutes: 60,
  sms_cutoff_minute: 1200,
  sms_mode: "fixed_sequence",
  sms_sequence: { initial_days: [1, 2, 3], repeat_from_day: 6, repeat_every_days: 3 },
  quoted_open_minute: 480,
  quoted_due_minute: 1200,
  quoted_same_day_cutoff_minute: 1170,
  return_to_new_mode: "original_age_partial_day",
  late_arrival_rule: { two_calls_before_minute: 1080, one_call_through_minute: 1170, sms_through_minute: 1170 },
  catchup_mode: "one_per_channel",
  restriction_clock_rule: "waive_pause_resume_next_working_date",
  callback_window_minutes: 15,
  callback_mode: "explicit_human_appointment",
  cooldown_warning_threshold: 3,
  cooldown_warning_hours: 24,
  cooldown_mode: "advisory_warning",
  assignment_timeline_rule: "continuous_timeline",
  intake_default_rule: { website_form: "new", best_relocation: "new", ringcentral_call: "new", manual: "new", granot_created: "review" },
  uncertain_priority_rule: "retain_last_verified",
  priority_map: {
    codes: [
      { code: "0", workflow: "new", closure_reason: null },
      { code: "1", workflow: "quoted", closure_reason: null },
      { code: "3", workflow: "discretion", closure_reason: null },
      { code: "5", workflow: "closed", closure_reason: "granot_booked" },
      { code: "7", workflow: "closed", closure_reason: "crm_bad_disposition" },
      { code: "8", workflow: "closed", closure_reason: "crm_dead_disposition" },
    ],
    unmapped_workflow: "none",
    official_booking_workflow: "closed",
  },
  transition_day_rule: "partial_day_allowance",
  move_date_rule: "review_label_only",
  lead_eligibility_rule: "no_sync_viable_duplicates_excluded",
  precedence_rule: "closure_restriction_schedule_priority",
} as const;

export const TEST_AGENT_A = "a".repeat(24);
export const TEST_AGENT_B = "b".repeat(24);

/** A complete FINAL-01-like configuration value with the given controls on (roster: agents A and B). */
export function completeConfigurationInput(controls: Partial<Record<"desk_enabled" | "cadence_shadow_enabled" | "cadence_enforcement_enabled" | "rep_sms_capture_enabled" | "goal_metrics_enabled", boolean>> = {}) {
  return {
    controls: { desk_enabled: true, ...controls },
    cadence: structuredClone(TEST_FINAL01_CADENCE) as unknown as Record<string, unknown>,
    evidence: {
      qualifying_call_rule: "terminal_call_log_attempt",
      goal_rep_rule: "reviewed_initiator_only",
      helping_rep_rule: "reviewed_helper_cadence_only",
      sms_success_rule: "sent_or_delivered",
      sms_failure_correction_rule: "revoke_on_confirmed_failure",
      roster_version: "roster-test",
      event_time_rule: "outbound_start_inbound_handled_sms_sent",
      operating_window_rule: "goal_full_date_cadence_open_hours",
      originating_inbound_rule: "unique_association_initial_response",
      restricted_contact_rule: "history_only_zero_credit",
    },
    goals: {
      roster_version: "roster-test",
      rep_work_schedules: [TEST_AGENT_A, TEST_AGENT_B].map((agent_id) => ({ agent_id, working_days: [1, 2, 3, 4, 5, 6, 7], scheduled_goal: null })),
      default_scheduled_goal: 100,
      effective_day_overrides: [],
      zero_goal_rule: "no_goal_today_excluded_from_denominator",
    },
  };
}
