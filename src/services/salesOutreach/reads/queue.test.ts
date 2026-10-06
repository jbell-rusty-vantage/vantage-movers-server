import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConfigurationInspection } from "../config/load";
import type { OutreachActor } from "../auth";
import { OutreachError } from "../errors";
import { evaluateAndProject, evaluationAdmissionOf } from "../evaluation/evaluateJob";
import { QUEUE_KEY_EPOCH, QUEUE_KEY_FAR_FUTURE } from "../evaluation/projection";
import { capturedCoverage, completeConfigurationInput, periodRow, runInFakeTransaction, subjectRow } from "../evaluation/testing";
import { objectId } from "../subjects/testing";
import { salesOutreachQueueQuerySchema, salesOutreachQueueSchema, type SalesOutreachQueueQuery } from "../../../validation/v1/salesOutreachReads";
import { MemoryDeskReadStore } from "./deskTesting";
import { readQueue } from "./queue";
import { decodeQueueCursor, encodeQueueCursor } from "./queueCursor";
import { mongoQueueQuery, queueSortSpec, type QueuePagePlan } from "./queueQuery";
import { activeInspection, fixedConfigurationLoader, MemoryReadStore } from "./testing";

/**
 * SRV-8 `GET /queue`: Mongo-side filter/sort semantics (shared plan, in-memory twin), multi-page keyset
 * paging, the signed scope-bound cursor (tamper/expiry/reassignment/filters/configuration → 409
 * CURSOR_EXPIRED), Rep scope and authoritative revocation, read-time status and exposure.
 */

const SECRET = "synthetic-queue-cursor-secret";
const REP_A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const REP_B = "bbbbbbbbbbbbbbbbbbbbbbbb";
// Monday 2026-10-05, 11:00 New York (EDT).
const NOW = new Date("2026-10-05T15:00:00.000Z");
const at = (iso: string) => new Date(iso);

const owner: OutreachActor = { role: "owner", actor: { kind: "owner", id: "owner-1", request_id: "r1", run_id: null }, agent_id: null };
const manager: OutreachActor = { role: "manager", actor: { kind: "manager", id: "manager-1", request_id: "r2", run_id: null }, agent_id: null };
const repA: OutreachActor = { role: "rep", actor: { kind: "rep", id: "rep-a", request_id: "r3", run_id: null, agent_id: REP_A } as never, agent_id: REP_A };
const repB: OutreachActor = { role: "rep", actor: { kind: "rep", id: "rep-b", request_id: "r4", run_id: null, agent_id: REP_B } as never, agent_id: REP_B };

const config = (controls: Parameters<typeof completeConfigurationInput>[0] = { cadence_enforcement_enabled: true }, version = "v-q", revision = 4) =>
  activeInspection(completeConfigurationInput(controls), version, revision);

type RowSpec = {
  agent?: string | null;
  status?: "active" | "review" | "closed";
  workflow?: string | null;
  priority?: string | null;
  urgency?: string | null;
  next?: string | null;
  call_due?: string | null;
  received?: string | null;
  last?: string | null;
  needs?: boolean;
  blocked?: boolean;
  pending?: boolean;
  call_status?: string;
  name?: string | null;
  job?: string | null;
  phone?: string | null;
  move?: string | null;
  exposure?: "shadow" | "enforcement";
};

/** Seeds one subject (+ its Lead's receiver) and a stored projection row with consistent queue keys. */
function seed(store: MemoryDeskReadStore, spec: RowSpec, id = objectId()) {
  const agent = spec.agent === undefined ? REP_A : spec.agent;
  const subject = subjectRow({
    id,
    assigned_agent_id: agent,
    status: spec.status ?? "active",
    display: {
      job_no: spec.job === undefined ? "J-100" : spec.job,
      normalized_job_no: spec.job === undefined ? "J100" : spec.job?.replace(/[^A-Z0-9]/gi, "").toUpperCase() ?? null,
      phone: spec.phone ?? "(555) 010-0000",
      normalized_phone: (spec.phone ?? "5550100000").replace(/\D/g, ""),
      name: spec.name === undefined ? "Synthetic Customer" : spec.name,
      move_date: spec.move ?? null,
    },
  });
  store.evaluation.subjects.set(id, subject);
  store.setLead(subject.lead, agent);
  const received = spec.received === undefined ? "2026-10-05T14:00:00.000Z" : spec.received;
  const callDue = spec.call_due ?? spec.urgency ?? null;
  const channel = (status: string, due: string | null) => ({
    required: 1,
    verified_completed: 0,
    remaining: 1,
    due_at: due ? at(due) : null,
    oldest_actionable_due_at: null,
    status,
    completion_kind: null,
    coverage: { state: "complete", known_complete_through: "2026-10-05T14:58:00.000Z", gaps: [] },
    blocked_reason: null,
  });
  store.evaluation.projections.set(id, {
    revision: 1,
    doc: {
      assigned_agent_id: agent,
      subject_status: spec.status ?? "active",
      workflow: spec.workflow === undefined ? "new" : spec.workflow,
      priority_raw: spec.priority === undefined ? "0" : spec.priority,
      display: {
        job_no: subject.display.job_no,
        normalized_job_no: subject.display.normalized_job_no,
        phone: subject.display.phone,
        normalized_phone: subject.display.normalized_phone,
        name: subject.display.name,
        name_folded: subject.display.name?.toLowerCase() ?? null,
        move_date: subject.display.move_date,
      },
      call: channel(spec.call_status ?? (spec.urgency ? "due" : "not_required"), callDue),
      sms: channel("not_required", null),
      status_flags: {
        needs_contact: spec.needs ?? Boolean(spec.urgency),
        overdue: false,
        blocked: spec.blocked ?? false,
        pending: spec.pending ?? false,
        move_date_passed: false,
        move_date_unknown: !spec.move,
        job_pending: false,
        advisory_cooldown: false,
      },
      queue_keys: {
        urgency_due: spec.urgency ? at(spec.urgency) : QUEUE_KEY_FAR_FUTURE,
        urgency_next: spec.next ? at(spec.next) : QUEUE_KEY_FAR_FUTURE,
        call_due: callDue ? at(callDue) : QUEUE_KEY_FAR_FUTURE,
        received_asc: received ? at(received) : QUEUE_KEY_FAR_FUTURE,
        received_desc: received ? at(received) : QUEUE_KEY_EPOCH,
        last_interaction: spec.last ? at(spec.last) : QUEUE_KEY_EPOCH,
      },
      oldest_actionable_due_at: null,
      next_action_due_at: spec.next ? at(spec.next) : null,
      last_interaction_at: spec.last ? at(spec.last) : null,
      received_at: received ? at(received) : null,
      exposure: spec.exposure ?? "enforcement",
      computed_as_of: at("2026-10-05T14:59:00.000Z"),
      publication_revision: 3,
      result_fingerprint: `fp-${id}`,
      policy_fingerprint: "set-below",
    },
  });
  return id;
}

/** Aligns every seeded row's policy fingerprint with the configuration's snapshot. */
function alignSnapshot(store: MemoryDeskReadStore, inspection: ConfigurationInspection) {
  const admission = evaluationAdmissionOf(inspection);
  const fp = admission.ok ? admission.context.policy_fingerprint : null;
  for (const row of store.evaluation.projections.values()) (row.doc as Record<string, unknown>).policy_fingerprint = fp;
}

function deps(store: MemoryDeskReadStore, inspection: ConfigurationInspection = config(), now = NOW) {
  const readStore = new MemoryReadStore();
  readStore.names = new Map([
    [REP_A, "Alice Rep"],
    [REP_B, "Bob Rep"],
  ]);
  return { loader: fixedConfigurationLoader(inspection), store: readStore, queueStore: store, now, cursorSecret: SECRET };
}

const q = (query: Record<string, string>): SalesOutreachQueueQuery => salesOutreachQueueQuerySchema.parse(query);

async function allPages(actor: OutreachActor, query: Record<string, string>, store: MemoryDeskReadStore, inspection = config()) {
  const ids: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page++) {
    const body = await readQueue(actor, q(cursor ? { ...query, cursor } : query), deps(store, inspection));
    salesOutreachQueueSchema.parse(body);
    ids.push(...body.rows.map((r) => r.subject_id));
    cursor = body.next_cursor;
    if (!cursor) break;
  }
  return ids;
}

async function rejects(promise: Promise<unknown>, code: string, issue?: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof OutreachError, String(error));
    assert.equal(error.code, code);
    if (issue) assert.equal(error.issues?.[0]?.code, issue);
    return true;
  });
}

test("urgency: overdue by oldest deadline, then due soonest, then next action, then received oldest-first, then id — over several pages", async () => {
  const store = new MemoryDeskReadStore();
  const ids = {
    overdueOld: seed(store, { urgency: "2026-10-05T12:00:00.000Z" }),
    overdueNew: seed(store, { urgency: "2026-10-05T14:30:00.000Z" }),
    dueSoon: seed(store, { urgency: "2026-10-05T16:00:00.000Z" }),
    dueLater: seed(store, { urgency: "2026-10-05T20:00:00.000Z" }),
    tieA: seed(store, { urgency: "2026-10-05T21:00:00.000Z", received: "2026-10-01T14:00:00.000Z" }, "1".repeat(24)),
    tieB: seed(store, { urgency: "2026-10-05T21:00:00.000Z", received: "2026-10-01T14:00:00.000Z" }, "2".repeat(24)),
    tieNewer: seed(store, { urgency: "2026-10-05T21:00:00.000Z", received: "2026-10-03T14:00:00.000Z" }),
  };
  seed(store, { needs: false, next: "2026-10-07T00:00:00.000Z" }); // future-only: All active, not Needs contact
  seed(store, { status: "review", needs: false }); // review: All active/pending only
  seed(store, { status: "closed", urgency: "2026-10-05T10:00:00.000Z" }); // closed: never listed
  alignSnapshot(store, config());
  const order = await allPages(owner, { limit: "3" }, store);
  assert.deepEqual(order, [ids.overdueOld, ids.overdueNew, ids.dueSoon, ids.dueLater, ids.tieA, ids.tieB, ids.tieNewer]);
  assert.equal(new Set(order).size, order.length, "no row repeats across pages");
  // Every page's filter and order ran in the store over the full set (not a sorted page).
  assert.ok(store.pages.every((p) => p.limit === 4));
  assert.equal((await allPages(owner, { limit: "2", state: "all_active" }, store)).length, 9);
});

test("lead received: newest first by default, oldest first on request, unknown received last in both directions", async () => {
  const store = new MemoryDeskReadStore();
  const a = seed(store, { needs: true, received: "2026-10-01T14:00:00.000Z" });
  const b = seed(store, { needs: true, received: "2026-10-03T14:00:00.000Z" });
  const c = seed(store, { needs: true, received: "2026-10-04T14:00:00.000Z" });
  const unknown = seed(store, { needs: true, received: null });
  alignSnapshot(store, config());
  assert.deepEqual(await allPages(owner, { sort: "lead_received", limit: "2" }, store), [c, b, a, unknown]);
  assert.deepEqual(await allPages(owner, { sort: "lead_received", direction: "asc", limit: "2" }, store), [a, b, c, unknown]);
});

test("last interaction: oldest first with never-contacted first; newest first puts never-contacted last", async () => {
  const store = new MemoryDeskReadStore();
  const never = seed(store, { needs: true, last: null });
  const old = seed(store, { needs: true, last: "2026-10-02T15:00:00.000Z" });
  const recent = seed(store, { needs: true, last: "2026-10-05T13:00:00.000Z" });
  alignSnapshot(store, config());
  assert.deepEqual(await allPages(owner, { sort: "last_interaction", limit: "1" }, store), [never, old, recent]);
  assert.deepEqual(await allPages(owner, { sort: "last_interaction", direction: "desc", limit: "1" }, store), [recent, old, never]);
  await assert.rejects(async () => q({ sort: "urgency", direction: "desc" }));
});

test("filters: priority, workflow, move-date range with the unknown-date count, literal search and state", async () => {
  const store = new MemoryDeskReadStore();
  const quoted = seed(store, { needs: true, workflow: "quoted", priority: "1", move: "2026-10-10", name: "O'Brien (Senior)" });
  const fresh = seed(store, { needs: true, workflow: "new", priority: "0", move: "2026-10-20", job: "P556123", phone: "(305) 555-0199" });
  const unknownMove = seed(store, { needs: true, workflow: "new", priority: null, move: null, name: "Ana Lopez" });
  const blocked = seed(store, { needs: false, blocked: true, workflow: "new", priority: "0" });
  const review = seed(store, { needs: false, status: "review", priority: null, workflow: null });
  const pending = seed(store, { needs: false, pending: true, workflow: "new" });
  alignSnapshot(store, config());
  const ids = async (query: Record<string, string>) => (await allPages(owner, query, store)).sort();
  assert.deepEqual(await ids({ priority: "1" }), [quoted]);
  assert.deepEqual(await ids({ priority: "unknown" }), [unknownMove]);
  assert.deepEqual(await ids({ workflow: "quoted" }), [quoted]);
  assert.deepEqual(await ids({ move_date_from: "2026-10-05", move_date_to: "2026-10-15" }), [quoted]);
  assert.deepEqual(await ids({ move_date_from: "2026-10-05", move_date_unknown: "include" }), [quoted, fresh, unknownMove].sort());
  assert.deepEqual(await ids({ move_date_unknown: "only" }), [unknownMove]);
  const ranged = await readQueue(owner, q({ move_date_from: "2026-10-05" }), deps(store));
  assert.equal(ranged.counts.excluded_unknown_move_date, 1, "the unknown-date exclusion is counted, never silent");
  // Literal search: regex characters are literal; name case-insensitive; Job prefix; phone digits (≥ 4).
  assert.deepEqual(await ids({ search: "o'brien (s" }), [quoted]);
  assert.deepEqual(await ids({ search: ".*" }), []);
  assert.deepEqual(await ids({ search: "  p556 " }), [fresh]);
  assert.deepEqual(await ids({ search: "0199" }), [fresh]);
  assert.deepEqual(await ids({ search: "019" }), [], "three digits never match a phone");
  await assert.rejects(async () => q({ search: "x".repeat(101) }));
  // State.
  assert.deepEqual(await ids({}), [quoted, fresh, unknownMove].sort());
  assert.deepEqual(await ids({ state: "blocked" }), [blocked]);
  assert.deepEqual(await ids({ state: "pending" }), [review, pending].sort());
  assert.deepEqual(await ids({ state: "all_active" }), [quoted, fresh, unknownMove, blocked, review, pending].sort());
});

test("scope: a Rep is forced to its own current assignment; foreign agent and Unassigned are refused, never broadened", async () => {
  const store = new MemoryDeskReadStore();
  const mine = seed(store, { agent: REP_A, urgency: "2026-10-05T13:00:00.000Z" });
  const theirs = seed(store, { agent: REP_B, urgency: "2026-10-05T13:00:00.000Z" });
  const nobody = seed(store, { agent: null, urgency: "2026-10-05T13:00:00.000Z" });
  alignSnapshot(store, config());
  assert.deepEqual(await allPages(repA, {}, store), [mine]);
  assert.deepEqual(await allPages(repA, { agent_id: REP_A }, store), [mine]);
  await rejects(readQueue(repA, q({ agent_id: REP_B }), deps(store)), "FORBIDDEN", "foreign_agent");
  await rejects(readQueue(repA, q({ unassigned: "true" }), deps(store)), "FORBIDDEN", "unassigned_not_permitted");
  assert.deepEqual(await allPages(manager, { agent_id: REP_B }, store), [theirs]);
  assert.deepEqual(await allPages(manager, { unassigned: "true" }, store), [nobody]);
  assert.equal((await allPages(owner, {}, store)).length, 3);
  await assert.rejects(async () => q({ agent_id: REP_A, unassigned: "true" }));
  const body = await readQueue(repA, q({}), deps(store));
  assert.deepEqual(body.scope, { role: "rep", agent_id: REP_A });
  assert.deepEqual([body.filters.agent_id, body.filters.unassigned], [REP_A, false]);
});

test("Unassigned/late assignment/reassignment (read part): the former Rep loses the row at once, even while the projection lags", async () => {
  const store = new MemoryDeskReadStore();
  const moved = seed(store, { agent: REP_A, urgency: "2026-10-05T13:00:00.000Z" });
  const kept = seed(store, { agent: REP_A, urgency: "2026-10-05T14:00:00.000Z" });
  alignSnapshot(store, config());
  // The Lead's authoritative receiver changed to Rep B; the subject/projection still say Rep A.
  store.setLead(store.evaluation.subjects.get(moved)!.lead, REP_B);
  assert.deepEqual(await allPages(repA, {}, store), [kept]);
  assert.deepEqual(await allPages(repB, {}, store), [], "the new Rep sees it once the desk copy catches up, never earlier through this read");
});

test("cursor: tamper, expiry, changed filters, foreign scope, reassignment, configuration and business day all answer 409 CURSOR_EXPIRED", async () => {
  const store = new MemoryDeskReadStore();
  for (let i = 0; i < 4; i++) seed(store, { agent: REP_A, urgency: `2026-10-05T1${i}:00:00.000Z` });
  alignSnapshot(store, config());
  const first = await readQueue(repA, q({ limit: "2" }), deps(store));
  assert.ok(first.next_cursor);
  const cursor = first.next_cursor!;
  // The second page reuses page one's reference instant.
  const second = await readQueue(repA, q({ limit: "2", cursor }), deps(store, config(), new Date(+NOW + 60_000)));
  assert.equal(second.as_of, NOW.toISOString());
  assert.equal(second.counts.projection_pending, null);

  const [payload, signature] = cursor.split(".");
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload!, "base64url").toString()), a: REP_B }), "utf8").toString("base64url");
  await rejects(readQueue(repA, q({ limit: "2", cursor: `${forged}.${signature}` }), deps(store)), "CURSOR_EXPIRED", "cursor_signature");
  await rejects(readQueue(repA, q({ limit: "2", cursor: "garbage" }), deps(store)), "CURSOR_EXPIRED", "cursor_malformed");
  await rejects(readQueue(repA, q({ limit: "2", cursor }), deps(store, config(), new Date(+NOW + 11 * 60_000))), "CURSOR_EXPIRED", "cursor_expired");
  await rejects(readQueue(repA, q({ limit: "2", cursor, priority: "1" }), deps(store)), "CURSOR_EXPIRED", "filters_changed");
  await rejects(readQueue(repA, q({ limit: "2", cursor, sort: "lead_received" }), deps(store)), "CURSOR_EXPIRED", "filters_changed");
  await rejects(readQueue(repB, q({ limit: "2", cursor }), deps(store)), "CURSOR_EXPIRED", "scope_changed");
  await rejects(readQueue(owner, q({ limit: "2", cursor, agent_id: REP_A }), deps(store)), "CURSOR_EXPIRED", "scope_changed");
  await rejects(readQueue(repA, q({ limit: "2", cursor }), deps(store, config(undefined, "v-other", 5))), "CURSOR_EXPIRED", "configuration_changed");
  await rejects(
    readQueue(repA, q({ limit: "2", cursor }), deps(store, config({ cadence_shadow_enabled: true }))),
    "CURSOR_EXPIRED",
    "projection_snapshot_changed",
  );
  // A signed cursor from just before New York midnight is refused just after it.
  const lateNight = new Date("2026-10-06T03:59:00.000Z");
  const late = decodeQueueCursor(cursor, SECRET);
  const lateCursor = encodeQueueCursor({ ...late, t: +lateNight, e: +lateNight + 600_000 }, SECRET);
  await rejects(readQueue(repA, q({ limit: "2", cursor: lateCursor }), deps(store, config(), new Date("2026-10-06T04:01:00.000Z"))), "CURSOR_EXPIRED", "business_day_changed");
  // Reassignment inside the scope changes its generation.
  const subject = [...store.evaluation.subjects.values()][0]!;
  store.evaluation.subjects.set(subject.id, { ...subject, assigned_agent_id: REP_B, assignment_revision: subject.assignment_revision + 1 });
  await rejects(readQueue(repA, q({ limit: "2", cursor }), deps(store)), "CURSOR_EXPIRED", "assignment_changed");
});

test("read-time status: a due requirement past its deadline reads overdue under enforcement and due in shadow (row or current control), with no row rewrite", async () => {
  const store = new MemoryDeskReadStore();
  const id = seed(store, { urgency: "2026-10-05T14:30:00.000Z", call_status: "due" });
  for (const [inspection, expected, labels] of [
    [config({ cadence_enforcement_enabled: true }), "overdue", true],
    [config({ cadence_shadow_enabled: true }), "due", false],
  ] as const) {
    alignSnapshot(store, inspection);
    const body = await readQueue(owner, q({}), deps(store, inspection));
    const row = body.rows.find((r) => r.subject_id === id)!;
    assert.equal(row.call.status, expected);
    assert.equal(row.status_flags.overdue, labels);
    assert.equal(body.enforcement_labels, labels);
    assert.equal(row.oldest_actionable_due_at, "2026-10-05T14:30:00.000Z", "deadlines stay visible in shadow");
  }
  assert.deepEqual(store.evaluation.writes, [], "reads never write projections");
});

test("schedule_day (S4): the stored New schedule day, null for other workflows or when the evaluator stored none; never recomputed", async () => {
  const store = new MemoryDeskReadStore();
  const withDay = (id: string, day: unknown) => ((store.evaluation.projections.get(id)!.doc as Record<string, unknown>).detail = { schedule_day: day });
  const fresh = seed(store, { urgency: "2026-10-05T14:30:00.000Z" });
  const old = seed(store, { urgency: "2026-10-05T14:40:00.000Z", received: "2026-09-20T14:00:00.000Z" });
  const quoted = seed(store, { urgency: "2026-10-05T14:50:00.000Z", workflow: "quoted", priority: "1" });
  const unknownAge = seed(store, { urgency: "2026-10-05T14:55:00.000Z" });
  withDay(fresh, 1);
  // A stored day that disagrees with the received date wins: the read copies, it does not compute.
  withDay(old, 9);
  withDay(quoted, 12);
  withDay(unknownAge, null);
  alignSnapshot(store, config());
  const body = salesOutreachQueueSchema.parse(await readQueue(owner, q({}), deps(store)));
  const day = (id: string) => body.rows.find((r) => r.subject_id === id)!.schedule_day;
  assert.deepEqual([day(fresh), day(old), day(quoted), day(unknownAge)], [1, 9, null, null]);
});

test("fail closed: desk off or uninitialized is 503 CONFIGURATION_UNAVAILABLE; cadence off is 503 PROJECTION_PENDING; pending subjects are counted", async () => {
  const store = new MemoryDeskReadStore();
  seed(store, { urgency: "2026-10-05T13:00:00.000Z" });
  store.evaluation.subjects.set("e".repeat(24), subjectRow({ id: "e".repeat(24), assigned_agent_id: REP_A }));
  alignSnapshot(store, config());
  await rejects(readQueue(owner, q({}), deps(store, config({ desk_enabled: false, cadence_enforcement_enabled: true }))), "CONFIGURATION_UNAVAILABLE");
  await rejects(readQueue(owner, q({}), { ...deps(store), loader: fixedConfigurationLoader({ state: "uninitialized" } as ConfigurationInspection) }), "CONFIGURATION_UNAVAILABLE");
  await rejects(readQueue(owner, q({}), deps(store, config({}))), "PROJECTION_PENDING", "cadence_disabled");
  const body = await readQueue(owner, q({}), deps(store));
  assert.equal(body.counts.projection_pending, 1, "a subject with no projection is pending, never an empty-ready queue");
  await rejects(readQueue(owner, q({}), { ...deps(store), cursorSecret: null }), "SERVICE_UNAVAILABLE");
});

test("the Mongo plan: filter, keyset and sort translate the same semantics (escaped literals, never-null keys)", () => {
  const plan: QueuePagePlan = {
    match: {
      assignment: { kind: "agent", agent_id: REP_A },
      state: "needs_contact",
      priority: { kind: "code", code: "1" },
      workflow: "quoted",
      move_date: { from: "2026-10-05", to: null, unknown: "exclude" },
      search: { name: "o'brien (s", job_prefix: "OBRIENS", phone_digits: null },
    },
    sort: queueSortSpec("lead_received", "desc"),
    after: ["2026-10-03T14:00:00.000Z", "1".repeat(24)],
    limit: 26,
  };
  const { filter, sort } = mongoQueueQuery(plan);
  assert.deepEqual(sort, { "queue_keys.received_desc": -1, subject_id: -1 });
  const text = JSON.stringify(filter);
  assert.match(text, /"assigned_agent_id":"a{24}"/);
  assert.match(text, /"subject_status":"active","status_flags.needs_contact":true/);
  assert.match(text, /"priority_raw":"1"/);
  assert.match(text, /"display.move_date":\{"\$gte":"2026-10-05"\}/);
  assert.match(text, /"display.name_folded":\{"\$regex":"o'brien \\\\\(s"\}/);
  assert.match(text, /"display.normalized_job_no":\{"\$regex":"\^OBRIENS"\}/);
  assert.match(text, /"queue_keys.received_desc":\{"\$lt":"2026-10-03T14:00:00.000Z"\}/);
  assert.match(text, /"subject_id":\{"\$lt":"1{24}"\}/);
  assert.deepEqual(Object.keys(queueSortSpec("urgency", "asc").map((s) => s.field)), ["0", "1", "2", "3"]);
});

test("end to end through the evaluator: real projections order by urgency and are read without a rewrite", async () => {
  const store = new MemoryDeskReadStore();
  const inspection = config({ cadence_enforcement_enabled: true });
  const admission = evaluationAdmissionOf(inspection);
  assert.ok(admission.ok);
  const intake = (iso: string) => ({ cohort_id: "intake:test", kind: "intake" as const, enrolled_at: at(iso), activation_at: at(iso), manifest_hash: null });
  const early = subjectRow({ received_at: at("2026-10-05T13:00:00.000Z"), enrollment: intake("2026-10-05T13:00:00.000Z"), assigned_agent_id: REP_A });
  const late = subjectRow({ received_at: at("2026-10-05T14:40:00.000Z"), enrollment: intake("2026-10-05T14:40:00.000Z"), assigned_agent_id: REP_A });
  for (const s of [late, early]) {
    store.evaluation.subjects.set(s.id, s);
    store.evaluation.periods.push(periodRow(s.id, { started_at: s.received_at! }));
    store.setLead(s.lead, REP_A);
  }
  store.evaluation.coverage = capturedCoverage(at("2026-10-05T14:58:00.000Z"));
  for (const s of [late, early])
    await runInFakeTransaction((session) => evaluateAndProject(s.id, admission.context, at("2026-10-05T14:59:00.000Z"), store.evaluation, session));
  const writes = store.evaluation.writes.length;
  const body = salesOutreachQueueSchema.parse(await readQueue(repA, q({}), deps(store, inspection)));
  assert.deepEqual(body.rows.map((r) => r.subject_id), [early.id, late.id], "the older initial-response deadline comes first");
  assert.equal(body.rows[0]!.call.status, "overdue", "13:30 initial response has passed at 15:00");
  assert.equal(store.evaluation.writes.length, writes);
});
