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
import { normalizeQueueQuery, readQueue } from "./queue";
import { decodeQueueCursor, encodeQueueCursor } from "./queueCursor";
import { matchesQueue, mongoQueueFilter, mongoQueuePageQueries, queueSortSpec } from "./queueQuery";
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

/** Call capture known through 14:58 (2 min before NOW) ⇒ cadence call coverage 14:56 after the 2-minute allowance. */
const CAPTURED = at("2026-10-05T14:58:00.000Z");

function deps(store: MemoryDeskReadStore, inspection: ConfigurationInspection = config(), now = NOW, capture: Date | null = CAPTURED) {
  const readStore = new MemoryReadStore();
  if (capture) readStore.coverCalls(capture);
  readStore.names = new Map([
    [REP_A, "Alice Rep"],
    [REP_B, "Bob Rep"],
  ]);
  return { loader: fixedConfigurationLoader(inspection), store: readStore, queueStore: store, now, cursorSecret: SECRET };
}

const q = (query: Record<string, string>): SalesOutreachQueueQuery => salesOutreachQueueQuerySchema.parse(query);

test("Other restores ordinary priority 9 when Pool is disabled; enabled Pool excludes it in both stores", async () => {
  const store = new MemoryDeskReadStore();
  const id = seed(store, { workflow: "none", priority: "9", needs: false });
  alignSnapshot(store, config());
  const query = q({ workflow: "other", state: "all_active" });
  assert.deepEqual((await readQueue(repA, query, deps(store))).rows.map((row) => row.subject_id), [id]);
  const row = (await store.findQueuePage({ match: normalizeQueueQuery(repA, query).match, sort: queueSortSpec("urgency", "asc"), after: null, limit: 10 }))[0]!;
  for (const enabled of [false, true]) {
    const match = normalizeQueueQuery(repA, query, enabled).match;
    assert.equal(matchesQueue(match, row), !enabled);
    assert.equal(JSON.stringify(mongoQueueFilter(match)).includes('"priority_raw":{"$ne":"9"}'), enabled);
  }
});

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

test("move date: full-scope soonest first, date and null ties stable over page boundaries, direction fixed ascending", async () => {
  const store = new MemoryDeskReadStore();
  // Deliberately insert later/unknown rows first: ordering must precede limiting.
  const unknownB = seed(store, { needs: true }, "f".repeat(24));
  const later = seed(store, { needs: true, move: "2026-11-01" }, "d".repeat(24));
  const todayB = seed(store, { needs: true, move: "2026-10-05" }, "4".repeat(24));
  const unknownA = seed(store, { needs: true }, "e".repeat(24));
  const earlier = seed(store, { needs: true, move: "2026-10-04" }, "8".repeat(24));
  const todayA = seed(store, { needs: true, move: "2026-10-05" }, "3".repeat(24));
  alignSnapshot(store, config());
  const expected = [earlier, todayA, todayB, later, unknownA, unknownB];
  for (const limit of [1, 2, 3, 4]) {
    const got = await allPages(repA, { sort: "move_date", limit: String(limit) }, store);
    assert.deepEqual(got, expected, `page size ${limit}`);
    assert.equal(new Set(got).size, expected.length, "no repeats or omissions");
  }
  assert.deepEqual(await allPages(repA, { sort: "move_date", direction: "desc", limit: "2" }, store), expected);
  const page = await readQueue(repA, q({ sort: "move_date", direction: "desc", limit: "2" }), deps(store));
  assert.equal(page.direction, "asc");
  assert.deepEqual(store.evaluation.writes, [], "existing projections suffice; reads never backfill");
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

test("read-time verification (olr A2): a passed deadline coverage cannot prove reads due/unverified and stays in Needs contact; once coverage reaches it, overdue/verified", async () => {
  const store = new MemoryDeskReadStore();
  // Deadline 14:57 has passed at NOW (15:00); cadence call coverage = capture − 2 min.
  const id = seed(store, { urgency: "2026-10-05T14:57:00.000Z", call_status: "due" });
  const future = seed(store, { urgency: "2026-10-05T16:00:00.000Z", call_status: "due" });
  alignSnapshot(store, config());
  const rowAt = async (capture: Date | null, inspection = config(), subject = id) => {
    const body = salesOutreachQueueSchema.parse(await readQueue(owner, q({}), deps(store, inspection, NOW, capture)));
    return body.rows.find((r) => r.subject_id === subject)!;
  };

  // Capture through 14:58 ⇒ coverage 14:56 < 14:57: not yet verified, still listed under Needs contact.
  const behind = await rowAt(CAPTURED);
  assert.equal(behind.call.status, "due");
  assert.deepEqual(behind.call.verification, { state: "unverified", verified_through: "2026-10-05T14:56:00.000Z", unverified_since: "2026-10-05T14:57:00.000Z" });
  assert.equal(behind.status_flags.overdue, false);
  assert.equal(behind.status_flags.needs_contact, true);
  assert.equal(behind.oldest_actionable_due_at, null, "no overdue deadline is claimed");
  // The coverage block is the live capture watermark (2 min behind: complete within the 25-min tolerance).
  assert.deepEqual(behind.call.coverage, { state: "complete", known_complete_through: "2026-10-05T14:58:00.000Z", gaps: [] });

  // No capture coverage at all: unverified with no "known through", coverage unknown.
  const none = await rowAt(null);
  assert.deepEqual([none.call.status, none.call.verification], ["due", { state: "unverified", verified_through: null, unverified_since: "2026-10-05T14:57:00.000Z" }]);
  assert.equal(none.call.coverage.state, "unknown");

  // Capture through 15:05 ⇒ coverage 15:03 ≥ 14:57: overdue, verified through the coverage instant.
  const caught = await rowAt(at("2026-10-05T15:05:00.000Z"));
  assert.equal(caught.call.status, "overdue");
  assert.deepEqual(caught.call.verification, { state: "verified", verified_through: "2026-10-05T15:03:00.000Z", unverified_since: null });
  assert.equal(caught.status_flags.overdue, true);
  assert.equal(caught.oldest_actionable_due_at, "2026-10-05T14:57:00.000Z");

  // A deadline still ahead carries no verification; shadow carries none either (no performance label).
  assert.equal((await rowAt(CAPTURED, config(), future)).call.verification, null);
  const shadow = config({ cadence_shadow_enabled: true });
  alignSnapshot(store, shadow);
  const masked = await rowAt(at("2026-10-05T15:05:00.000Z"), shadow);
  assert.deepEqual([masked.call.status, masked.call.verification, masked.status_flags.overdue], ["due", null, false]);
  assert.deepEqual(store.evaluation.writes, [], "reads never write projections");
});

test("move-date Mongo walks preserve the full match, date-only keyset and the one-way unknown phase", () => {
  const match = { assignment: { kind: "agent" as const, agent_id: REP_A }, state: "all_active" as const, priority: { kind: "code" as const, code: "1" }, workflow: "quoted" as const, move_date: null, search: null };
  const plan = { match, sort: queueSortSpec("move_date", "asc"), after: null, limit: 2 };
  const first = mongoQueuePageQueries(plan);
  assert.equal(first.length, 2);
  assert.deepEqual(first.map((q) => q.sort), [{ "display.move_date": 1, subject_id: 1 }, { "display.move_date": 1, subject_id: 1 }]);
  for (const query of first) {
    assert.match(JSON.stringify(query.filter), /"priority_raw":"1"/);
    assert.match(JSON.stringify(query.filter), /"workflow":"quoted"/);
    assert.match(JSON.stringify(query.filter), /"assigned_agent_id":"aaaaaaaaaaaaaaaaaaaaaaaa"/);
  }
  const dated = JSON.stringify(mongoQueuePageQueries({ ...plan, after: ["2026-10-05", "1".repeat(24)] }));
  assert.match(dated, /"display.move_date":\{"\$gt":"2026-10-05"\}/);
  assert.doesNotMatch(dated, /2026-10-05T/);
  const unknown = mongoQueuePageQueries({ ...plan, after: ["", "1".repeat(24)] });
  assert.equal(unknown.length, 1);
  assert.match(JSON.stringify(unknown[0]!.filter), /"display.move_date":null/);
  assert.match(JSON.stringify(unknown[0]!.filter), /"subject_id":\{"\$gt":"111111111111111111111111"\}/);
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
