/**
 * Regenerate the Sales Outreach Desk read examples the admin team builds against (M1 goal reads,
 * phase 4b queue / outreach view / team cadence cards / live frames):
 *
 *   node --import tsx ops/sales-outreach/write-dto-examples.ts
 *
 * Writes `docs/sales-outreach-desk/workspace/evidence/dto-examples/*.json` from the real read
 * services over a synthetic in-memory store (no database, no provider, no env). The roster mirrors
 * contracts/fixtures/p08a-roster-goals.json (partial-day and absence overrides, 108/100) plus one
 * rep with no activity yet and one Agent with calls who is not on the roster.
 * `src/routes/sales-outreach.reads.routes.test.ts` parses every file with the exported DTO schemas.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { OutreachActor } from "../../src/services/salesOutreach/auth";
import { OutreachError } from "../../src/services/salesOutreach/errors";
import { evaluateAndProject, evaluationAdmissionOf } from "../../src/services/salesOutreach/evaluation/evaluateJob";
import { capturedCoverage, completeConfigurationInput, periodRow, runInFakeTransaction, subjectRow } from "../../src/services/salesOutreach/evaluation/testing";
import { outreachLiveFrame } from "../../src/services/salesOutreach/live/stream";
import { readOutreachDetail } from "../../src/services/salesOutreach/reads/detail";
import { MemoryDeskReadStore } from "../../src/services/salesOutreach/reads/deskTesting";
import { readQueue } from "../../src/services/salesOutreach/reads/queue";
import { readDeskCapabilities, readRepDays, readTeam, type DeskReadDeps } from "../../src/services/salesOutreach/reads/service";
import { salesOutreachQueueQuerySchema } from "../../src/validation/v1/salesOutreachReads";
import { activeInspection, fixedConfigurationLoader, MemoryReadStore, repDayRow } from "../../src/services/salesOutreach/reads/testing";
import { csiOperatorActor } from "../../src/services/salesIntelligence/auth";
import type { SalesOutreachConfigurationInput } from "../../src/validation/v1/salesOutreach";

export const DTO_EXAMPLES_DIR = path.resolve(__dirname, "../../docs/sales-outreach-desk/workspace/evidence/dto-examples");

const NOW = new Date("2026-10-05T15:00:00.000Z");
const DAY = "2026-10-05";
const [A, B, C, D, E, X] = ["a", "b", "c", "d", "e", "f"].map((suffix) => `6650a1b2c3d4e5f60718293${suffix}`) as [string, string, string, string, string, string];

const desk: SalesOutreachConfigurationInput = {
  controls: { desk_enabled: true, goal_metrics_enabled: true },
  goals: {
    roster_version: "m1-roster-2026-10-05",
    default_scheduled_goal: 100,
    zero_goal_rule: "no_goal_today_excluded_from_denominator",
    rep_work_schedules: [A, B, C, D, E].map((agent_id) => ({ agent_id, working_days: [1, 2, 3, 4, 5, 6, 7] })),
    effective_day_overrides: [
      { agent_id: D, business_date: DAY, goal: 50, reason: "partial_day" },
      { agent_id: E, business_date: DAY, goal: 0, reason: "absence" },
    ],
  },
};

/** `captureKnown`: the Call Log watermark (olr A2 `queue.owner.awaiting-capture` reads a lagging one). */
function exampleStore(captureKnown = new Date("2026-10-05T14:57:00Z")): MemoryReadStore {
  const store = new MemoryReadStore();
  const computed = new Date("2026-10-05T14:58:30Z");
  // olr C1b: rows store both scopes' counts; the headline is all_outbound, the alternate eligible_new_quoted.
  const both = (all: number, eligible: number, awaitingAll = 0, awaitingEligible = 0) => ({
    actual_confirmed: all,
    actual_awaiting_confirmation: awaitingAll,
    unattributed: all - eligible,
    actual_confirmed_all: all,
    actual_confirmed_eligible: eligible,
    actual_awaiting_all: awaitingAll,
    actual_awaiting_eligible: awaitingEligible,
  });
  store.rows = [
    repDayRow({ agent_id: A, business_day: DAY, ...both(108, 14, 2, 1), computed_as_of: computed, publication_revision: 41 }),
    repDayRow({ agent_id: C, business_day: DAY, ...both(37, 18), computed_as_of: computed, publication_revision: 39 }),
    repDayRow({ agent_id: D, business_day: DAY, ...both(25, 25), computed_as_of: computed, publication_revision: 40 }),
    repDayRow({ agent_id: E, business_day: DAY, ...both(10, 3), computed_as_of: computed, publication_revision: 33 }),
    repDayRow({ agent_id: X, business_day: DAY, ...both(4, 0), computed_as_of: computed, publication_revision: 12 }),
  ];
  store.names = new Map([
    [A, "Alice Rep"],
    [B, "Bob Rep"],
    [C, "Cara Rep"],
    [D, "Dan Rep"],
    [E, "Eve Rep"],
  ]);
  // A former rep without a reviewed link: history names fall back to the Agent record.
  store.agentNames = new Map([[X, "Xavier Agent"]]);
  store.calls = {
    scope: "call_log_all_directions",
    known_complete_through: captureKnown,
    last_finished_at: new Date("2026-10-05T14:57:40Z"),
    last_error_code: null,
    // olr A3-fresh: last Call Log confirmation (max of the ISync lane and the reconcile's sync success).
    confirmation_success_at: new Date("2026-10-05T14:59:20Z"),
  };
  // Newest call webhook receipt; 11:00 New York is in the staffed window, so "Calls updated" = min(confirmation, webhook).
  store.callWebhookAt = new Date("2026-10-05T14:58:30Z");
  store.granot = new Date("2026-10-05T14:56:10Z");
  // olr A2: the contact-event derivation watermark (S3 sweep) — the reads' cadence call coverage is
  // min(capture − 2-min settlement allowance, derivation) = 14:55 by default.
  store.derivation = {
    known_complete_through: new Date("2026-10-05T14:57:00Z"),
    observed_complete_through: new Date("2026-10-05T14:57:00Z"),
    coverage_from: new Date("2026-10-01T04:00:00Z"),
  };
  return store;
}

const actor = (role: OutreachActor["role"], agent_id: string | null = null): OutreachActor => ({ role, actor: csiOperatorActor("dto-example"), agent_id });

/** The desk with cadence enforcement on (FINAL-01 cadence) and the example roster. */
const cadenceDesk: SalesOutreachConfigurationInput = {
  ...completeConfigurationInput({ goal_metrics_enabled: true, cadence_enforcement_enabled: true }),
  goals: desk.goals,
};
const SUBJECTS = {
  overdue: "6650a1b2c3d4e5f607182a01",
  due: "6650a1b2c3d4e5f607182a02",
  unassigned: "6650a1b2c3d4e5f607182a03",
  rep_c: "6650a1b2c3d4e5f607182a04",
  awaiting: "6650a1b2c3d4e5f607182a05",
} as const;

/**
 * Five synthetic subjects evaluated by the real engine at 14:59 New York-EDT minus 4 h (14:59Z):
 * Alice's initial response missed at 10:30 (overdue), Alice's 10:50 arrival due at 11:20 (one verified
 * attempt), one Unassigned arrival, one of Cara's, and Alice's 10:27 arrival whose 10:57 deadline has
 * passed but call coverage (capture − 2 min) cannot prove it yet (olr A2: due + "not yet verified").
 * `captureKnown` is the call coverage the evaluation saw. Ids are fixed so the examples are stable.
 */
async function exampleDeskStore(captureKnown = new Date("2026-10-05T14:57:00.000Z")): Promise<MemoryDeskReadStore> {
  const store = new MemoryDeskReadStore();
  const admission = evaluationAdmissionOf(activeInspection(cadenceDesk, "sod-cfg-9d4e", 6));
  if (!admission.ok) throw new Error("example cadence not admitted");
  const seeds = [
    { id: SUBJECTS.overdue, received: "2026-10-05T14:00:00.000Z", agent: A, job: "P5561201", phone: "(305) 555-0101", name: "Jordan Example", move: "2026-10-18" },
    { id: SUBJECTS.due, received: "2026-10-05T14:50:00.000Z", agent: A, job: "P5561202", phone: "(305) 555-0102", name: "Riley Sample", move: null },
    { id: SUBJECTS.unassigned, received: "2026-10-05T14:30:00.000Z", agent: null, job: null, phone: "(305) 555-0103", name: "Casey Placeholder", move: "2026-10-09" },
    { id: SUBJECTS.rep_c, received: "2026-10-05T13:40:00.000Z", agent: C, job: "P5561204", phone: "(305) 555-0104", name: "Morgan Synthetic", move: "2026-11-02" },
    { id: SUBJECTS.awaiting, received: "2026-10-05T14:27:00.000Z", agent: A, job: "P5561205", phone: "(305) 555-0105", name: "Avery Pending", move: "2026-10-21" },
  ];
  for (const [i, s] of seeds.entries()) {
    const received = new Date(s.received);
    const subject = subjectRow({
      id: s.id,
      lead: { model: "FormLead", id: `6650a1b2c3d4e5f607182b0${i + 1}` },
      enrollment: { cohort_id: "intake:2026-10-05T12:00:00.000Z", kind: "intake", enrolled_at: received, activation_at: received, manifest_hash: null },
      received_at: received,
      received_date: DAY,
      assigned_agent_id: s.agent,
      assignment_revision: s.agent ? 1 : 0,
      display: {
        job_no: s.job,
        normalized_job_no: s.job,
        phone: s.phone,
        normalized_phone: s.phone.replace(/\D/g, ""),
        name: s.name,
        move_date: s.move,
      },
    });
    store.evaluation.subjects.set(s.id, subject);
    store.evaluation.periods.push(periodRow(s.id, { id: `6650a1b2c3d4e5f607182c0${i + 1}`, started_at: received }));
    store.setLead(subject.lead, s.agent);
    // Riley's Lead arrived with a rep who has since left (X), then moved to Alice (P06d history).
    if (s.id === SUBJECTS.due)
      store.evaluation.changes.set(`${subject.lead.model}:${subject.lead.id}`, [
        { applied_at: new Date("2026-10-05T14:50:05.000Z"), before: null, after: X },
        { applied_at: new Date("2026-10-05T14:52:00.000Z"), before: X, after: A },
      ]);
  }
  store.evaluation.events.push({
    subject_id: SUBJECTS.due,
    id: "6650a1b2c3d4e5f607182d01",
    source_kind: "call",
    source_id: "6650a1b2c3d4e5f607182e01",
    channel: "call",
    direction: "outbound",
    event_at: new Date("2026-10-05T14:55:00.000Z"),
    kind: "outbound_attempt",
    verification: "confirmed",
    exclusion_reason: null,
    actor_agent_id: A,
    goal_agent_id: A,
    restricted_at_contact: false,
    outcome: "unanswered",
  });
  store.evaluation.coverage = capturedCoverage(captureKnown);
  for (const id of Object.values(SUBJECTS))
    await runInFakeTransaction((session) => evaluateAndProject(id, admission.context, new Date("2026-10-05T14:59:00.000Z"), store.evaluation, session));
  return store;
}

/** Every example file name with its payload. */
export async function buildDtoExamples(): Promise<Record<string, unknown>> {
  const store = exampleStore();
  const deps = (input: SalesOutreachConfigurationInput, version: string, revision: number): DeskReadDeps => ({
    loader: fixedConfigurationLoader(activeInspection(input, version, revision)),
    store,
    queueStore: new MemoryDeskReadStore(),
    now: NOW,
  });
  const live = deps(desk, "sod-cfg-7f3a", 4);
  const ok = (data: unknown) => ({ ok: true, data });
  const refusal = (error: OutreachError) => ({
    ok: false,
    code: error.code,
    error: "Sales Outreach request rejected",
    request_id: "req-example",
    ...(error.issues?.length ? { issues: error.issues } : {}),
  });
  const owner = actor("owner");
  const manager = actor("manager");
  const rep = actor("rep", A);
  const deskStore = await exampleDeskStore();
  const cadence: DeskReadDeps = { ...deps(cadenceDesk, "sod-cfg-9d4e", 6), queueStore: deskStore };
  const queueDeps = { ...cadence, cursorSecret: "dto-example-cursor-secret" };
  const query = (input: Record<string, string>) => salesOutreachQueueQuerySchema.parse(input);
  const ownerFirstPage = await readQueue(owner, query({ limit: "2" }), queueDeps);
  const lagging = exampleStore(new Date("2026-10-05T14:43:00Z"));
  const laggingDesk = await exampleDeskStore(new Date("2026-10-05T14:43:00.000Z"));
  const change = { topic: "outreach_desk" as const, subject_ids: [SUBJECTS.due], agent_ids: [A], business_day: null, revision: 2 };
  return {
    "capabilities.owner.json": ok(await readDeskCapabilities(owner, live)),
    "capabilities.manager.json": ok(await readDeskCapabilities(manager, live)),
    "capabilities.rep.json": ok(await readDeskCapabilities(rep, live)),
    "capabilities.rep.cadence-enforcement.json": ok(await readDeskCapabilities(rep, cadence)),
    "capabilities.owner.desk-disabled.json": ok(
      await readDeskCapabilities(owner, deps({ ...desk, controls: { desk_enabled: false, goal_metrics_enabled: true } }, "sod-cfg-8b21", 5)),
    ),
    "rep-days.owner.json": ok(await readRepDays(owner, {}, live)),
    "rep-days.rep.json": ok(await readRepDays(rep, {}, live)),
    "rep-days.rep.cadence-enforcement.json": ok(await readRepDays(rep, {}, cadence)),
    "rep-days.owner.cadence-enforcement.json": ok(await readRepDays(owner, {}, cadence)),
    "rep-days.goal-metrics-disabled.json": ok(await readRepDays(rep, {}, deps({ controls: { desk_enabled: true } }, "sod-cfg-1c09", 2))),
    "team.owner.json": ok(await readTeam(owner, {}, live)),
    "team.manager.json": ok(await readTeam(manager, {}, live)),
    "team.owner.cadence-enforcement.json": ok(await readTeam(owner, {}, cadence)),
    "queue.owner.page-1.json": ok(ownerFirstPage),
    "queue.owner.page-2.json": ok(await readQueue(owner, query({ limit: "2", cursor: ownerFirstPage.next_cursor! }), queueDeps)),
    "queue.manager.unassigned.json": ok(await readQueue(manager, query({ unassigned: "true", state: "all_active" }), queueDeps)),
    "queue.rep.lead-received.json": ok(await readQueue(rep, query({ sort: "lead_received", state: "all_active" }), queueDeps)),
    // olr A2: call capture 17 min behind (known through 10:43 New York): passed deadlines it cannot prove
    // read due + verification unverified; the ones the evaluation already proved read overdue/verified.
    "queue.owner.awaiting-capture.json": ok(await readQueue(owner, query({}), { ...queueDeps, store: lagging, queueStore: laggingDesk })),
    "outreach.owner.overdue.json": ok(await readOutreachDetail(owner, SUBJECTS.overdue, cadence)),
    "outreach.rep.due.json": ok(await readOutreachDetail(rep, SUBJECTS.due, cadence)),
    "live.change.json": outreachLiveFrame("change", [change], NOW),
    "live.connect.json": outreachLiveFrame("connect", [], NOW),
    "error.cursor-expired.json": refusal(new OutreachError("CURSOR_EXPIRED", [{ path: "cursor", code: "assignment_changed", message: "resnapshot" }])),
    "error.outreach-not-found.json": refusal(new OutreachError("NOT_FOUND")),
    "error.projection-pending.cadence-disabled.json": refusal(new OutreachError("PROJECTION_PENDING", [{ path: "controls", code: "cadence_disabled" }])),
    "error.rep-unassigned-filter.json": refusal(new OutreachError("FORBIDDEN", [{ path: "unassigned", code: "unassigned_not_permitted" }])),
    "error.configuration-unavailable.desk-disabled.json": refusal(
      new OutreachError("CONFIGURATION_UNAVAILABLE", [{ path: "controls.desk_enabled", code: "desk_disabled" }]),
    ),
    "error.rep-foreign-agent.json": refusal(new OutreachError("FORBIDDEN", [{ path: "agent_id", code: "foreign_agent" }])),
  };
}

async function main() {
  mkdirSync(DTO_EXAMPLES_DIR, { recursive: true });
  for (const [name, body] of Object.entries(await buildDtoExamples()))
    writeFileSync(path.join(DTO_EXAMPLES_DIR, name), `${JSON.stringify(body, null, 2)}\n`);
  console.log(`wrote ${DTO_EXAMPLES_DIR}`);
}

if (require.main === module) void main();
