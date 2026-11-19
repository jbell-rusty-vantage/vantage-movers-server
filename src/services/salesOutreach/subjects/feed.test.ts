import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ClientSession } from "mongoose";
import type { JobInput } from "../../salesIntelligence/jobs";
import { fixedConfigurationLoader } from "../reads/testing";
import {
  expansionAdmissionOpenOf,
  DECISION_RECONCILE_DEFAULT_PER_RUN,
  leadChangeJobInput,
  nominateLeadChanges,
  OUTREACH_FEED_PAGE,
  OUTREACH_LEAD_CHANGE_OVERLAP_MS,
  reconcileOutreachRevisions,
  scanOutreachLeadChanges,
  scanOutreachLeadChangesUntilCaughtUp,
  type FeedCursor,
  type LeadChangeRow,
  type OutreachFeedStore,
} from "./feed";
import { deskLeadKey, type DeskLeadRef } from "./leadFacts";
import { deskDecisionFingerprint } from "./policyMapping";
import { APPROVED_MAPPING, deskConfiguration, fakeSession, objectId } from "./testing";

const at = (iso: string) => new Date(iso);
const transaction = <T>(fn: (session: ClientSession) => Promise<T>) => fn(fakeSession);

class MemoryFeedStore implements OutreachFeedStore {
  relations = new Map<string, string>();
  relationReads: string[][] = [];
  async relatedForms(ids: readonly string[]) { this.relationReads.push([...ids]); return new Map(ids.flatMap(id => this.relations.has(id) ? [[id, this.relations.get(id)!]] : [])); }
  changes: LeadChangeRow[] = [];
  subjects: Array<{
    id: string;
    lead: DeskLeadRef;
    lead_revision_seen: number;
    closed?: boolean;
    decision_fingerprint?: string | null;
    status?: "active" | "review";
    review_reasons?: string[];
  }> = [];
  /** Fingerprint of subjects that set none: the default test configuration's (already decided under it). */
  defaultFingerprint = deskDecisionFingerprint(deskConfiguration().value.cadence);
  revisions = new Map<string, number>();
  tail: FeedCursor | null = null;
  reconcileCursor: string | null = null;
  jobs = new Map<string, JobInput>();
  conflictKeys = new Set<string>();
  async readTailCursor() { return this.tail; }
  async writeTailCursor(cursor: FeedCursor) { this.tail = cursor; }
  private after(row: LeadChangeRow, c: FeedCursor) { return +row.applied_at > +c.applied_at || (+row.applied_at === +c.applied_at && row.id > c.id); }
  private sorted() { return [...this.changes].sort((a, b) => +a.applied_at - +b.applied_at || a.id.localeCompare(b.id)); }
  async changesAfter(cursor: FeedCursor, limit: number) { return this.sorted().filter((r) => this.after(r, cursor)).slice(0, limit); }
  async changesInOverlap(cursor: FeedCursor, overlapMs: number, limit: number) {
    return this.sorted().filter((r) => +r.applied_at > +cursor.applied_at - overlapMs && +r.applied_at <= +cursor.applied_at && r.id !== cursor.id).slice(0, limit);
  }
  async subjectLeadKeys(leads: readonly DeskLeadRef[]) {
    const keys = new Set(this.subjects.map((s) => deskLeadKey(s.lead)));
    return new Set(leads.map(deskLeadKey).filter((k) => keys.has(k)));
  }
  async readReconcileCursor() { return this.reconcileCursor; }
  async writeReconcileCursor(id: string | null) { this.reconcileCursor = id; }
  async subjectsAfter(afterId: string | null, limit: number) {
    return this.subjects
      .filter((s) => !s.closed && (!afterId || s.id > afterId))
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, limit)
      .map((s) => ({
        id: s.id,
        lead: s.lead,
        lead_revision_seen: s.lead_revision_seen,
        decision_fingerprint: s.decision_fingerprint === undefined ? this.defaultFingerprint : s.decision_fingerprint,
        status: s.status ?? "active",
        review_reasons: s.review_reasons ?? [],
      }));
  }
  async leadRevisions(leads: readonly DeskLeadRef[]) {
    return new Map(leads.flatMap((l) => (this.revisions.has(deskLeadKey(l)) ? [[deskLeadKey(l), this.revisions.get(deskLeadKey(l))!] as const] : [])));
  }
  async enqueue(job: JobInput) {
    if (this.conflictKeys.has(job.dedupe_key)) return "conflict" as const;
    this.jobs.set(job.dedupe_key, job);
    return "enqueued" as const;
  }
}

const lead = (model: DeskLeadRef["model"] = "FormLead"): DeskLeadRef => ({ model, id: objectId() });
const change = (ref: DeskLeadRef, revisionBefore: number, appliedAt: string, id = objectId(), changedPaths: string[] = ["notes"]): LeadChangeRow => ({
  id,
  lead: ref,
  revision_before: revisionBefore,
  revision_after: revisionBefore + 1,
  applied_at: at(appliedAt),
  changed_paths: changedPaths,
});

describe("entity_changes tail (IMPL-05, outreach_lead_change)", () => {

  test("short overlap: a change committed behind the cursor is still picked up", async () => {
    const store = new MemoryFeedStore();
    const ref = lead();
    store.subjects.push({ id: objectId(), lead: ref, lead_revision_seen: 0 });
    const deps = { store, transaction, loader: fixedConfigurationLoader(deskConfiguration() as never) };
    store.changes.push(change(ref, 1, "2026-10-04T14:04:30Z", "b".repeat(24)));
    await scanOutreachLeadChanges(at("2026-10-04T14:05:00Z"), deps);
    // A slower transaction commits with an earlier applied_at, inside the overlap window.
    store.changes.push(change(ref, 2, "2026-10-04T14:04:00Z", "a".repeat(24)));
    await scanOutreachLeadChanges(at("2026-10-04T14:05:30Z"), deps);
    assert.ok(store.jobs.has(`sod:lead-change:FormLead:${ref.id}:r3`));
    assert.ok(OUTREACH_LEAD_CHANGE_OVERLAP_MS <= 300_000, "the overlap stays short");
  });
});

describe("revision reconcile (outreach_revision_reconcile)", () => {
  const deps = (store: MemoryFeedStore, acquired = true) => ({
    store,
    transaction,
    loader: fixedConfigurationLoader(deskConfiguration() as never),
    lease: { acquire: async () => acquired, release: async () => undefined },
  });

  test("bounded pages of 100 carry a durable cursor; a held lease skips the run", async () => {
    const store = new MemoryFeedStore();
    for (let i = 0; i < 250; i++) {
      const ref = lead();
      store.subjects.push({ id: String(i).padStart(24, "0"), lead: ref, lead_revision_seen: 1 });
      store.revisions.set(deskLeadKey(ref), 2);
    }
    const result = await reconcileOutreachRevisions(at("2026-10-04T14:05:00Z"), deps(store));
    assert.equal(result.pages, 3);
    assert.equal(result.checked, 250);
    assert.equal(store.jobs.size, 250);
    assert.deepEqual(await reconcileOutreachRevisions(at("2026-10-04T14:05:00Z"), deps(store, false)), {
      skipped: true,
      reason: "lease_held",
      pages: 0,
      checked: 0,
      nominated: 0,
      wrapped: false,
      decision_nominated: 0,
      decision_deferred: 0,
      decision_cap: DECISION_RECONCILE_DEFAULT_PER_RUN,
      hold_nominated: 0,
    });
  });
});

// ---- olr B10: the tail loops while the page is full ------------------------------------------

/** A feed store that counts overlap re-scans, can advance a fake clock per page and can fail a pass. */
class CountingFeedStore extends MemoryFeedStore {
  overlapScans = 0;
  pages = 0;
  clockMs = 0;
  msPerPage = 0;
  failOnPage: number | null = null;
  override async changesInOverlap(cursor: FeedCursor, overlapMs: number, limit: number) {
    this.overlapScans++;
    return super.changesInOverlap(cursor, overlapMs, limit);
  }
  override async changesAfter(cursor: FeedCursor, limit: number) {
    this.pages++;
    this.clockMs += this.msPerPage;
    if (this.failOnPage === this.pages) throw new Error("transient");
    return super.changesAfter(cursor, limit);
  }
}

/** A subject Lead with `count` changes, one second apart from `startIso`; change ids sort in insertion order. */
function backlog(store: MemoryFeedStore, count: number, startIso = "2026-10-04T14:00:00Z"): LeadChangeRow[] {
  const ref = lead();
  store.subjects.push({ id: objectId(), lead: ref, lead_revision_seen: 0 });
  const rows: LeadChangeRow[] = [];
  for (let i = 0; i < count; i++) rows.push(change(ref, i + 1, new Date(+at(startIso) + i * 1000).toISOString(), `c${String(i).padStart(23, "0")}`));
  store.changes.push(...rows);
  return rows;
}

/** Puts the stored tail cursor one second before the first change of `rows`. */
const cursorBefore = (store: MemoryFeedStore, rows: readonly LeadChangeRow[]) => {
  store.tail = { applied_at: new Date(+rows[0]!.applied_at - 1000), id: "0".repeat(24) };
};

const loopDeps = (store: CountingFeedStore, migration: Record<string, number> = {}) => ({
  store,
  transaction,
  clock: () => store.clockMs,
  loader: fixedConfigurationLoader(deskConfiguration({ migration } as never) as never),
});

describe("tail loop (olr B10, migration.feed_max_passes_per_run / feed_budget_seconds)", () => {

  test("the loop stops at the pass cap with the cursor at the last committed page; the next run carries on", async () => {
    const store = new CountingFeedStore();
    const rows = backlog(store, 500);
    cursorBefore(store, rows);
    const deps = loopDeps(store, { feed_max_passes_per_run: 2 });
    const first = await scanOutreachLeadChangesUntilCaughtUp(at("2026-10-04T14:05:00Z"), deps);
    assert.deepEqual([first.passes, first.stopped_by, first.caught_up, first.max_passes], [2, "max_passes", false, 2]);
    assert.equal(store.tail?.id, rows[2 * OUTREACH_FEED_PAGE - 1]!.id, "cursor at the 200th change");
    assert.equal(store.jobs.size, 200);
    const second = await scanOutreachLeadChangesUntilCaughtUp(at("2026-10-04T14:06:00Z"), deps);
    assert.equal(second.passes, 2);
    assert.equal(store.tail?.id, rows[399]!.id);
    assert.equal(store.jobs.size, 400, "nothing nominated twice, nothing skipped");
  });

  test("a later pass that fails ends the loop with what was committed; a failed first pass propagates", async () => {
    const store = new CountingFeedStore();
    const rows = backlog(store, 300);
    cursorBefore(store, rows);
    store.failOnPage = 2;
    const result = await scanOutreachLeadChangesUntilCaughtUp(at("2026-10-04T14:05:00Z"), loopDeps(store));
    assert.deepEqual([result.passes, result.stopped_by, result.caught_up], [1, "error", false]);
    assert.equal(store.tail?.id, rows[99]!.id, "the first page stays committed");
    const failing = new CountingFeedStore();
    failing.failOnPage = 1;
    await assert.rejects(scanOutreachLeadChangesUntilCaughtUp(at("2026-10-04T14:05:00Z"), loopDeps(failing)), /transient/);
  });
});

// ---- olr B6: event-driven expansion admission (transition.expansion_admission_enabled) ----------

describe("expansion admission nomination (olr B6)", () => {
  const admissionOn = (paused = false) =>
    deskConfiguration({ transition: { backfill_lookback_days: 90, backfill_include_upcoming_moves: true, expansion_admission_enabled: true }, migration: { paused } });

  test("non-subject changes with decision paths nominate an admission job only while expansion admission is on and migration is not paused", async () => {
    const pre = lead();
    const changes = [change(pre, 6, "2026-10-06T14:04:30Z", objectId(), ["granot_priority", "last_accepted_granot_observation"])];
    assert.deepEqual(nominateLeadChanges(changes, new Set(), true, false), [], "switch off: nothing");
    assert.deepEqual(nominateLeadChanges(changes, new Set(), false, true), [{ lead: pre, revision: 7, kind: "admission" }]);
    assert.equal(expansionAdmissionOpenOf(deskConfiguration().value), false, "absent key = off");
    assert.equal(expansionAdmissionOpenOf(admissionOn().value), true);
    assert.equal(expansionAdmissionOpenOf(admissionOn(true).value), false, "a paused migration closes admission");

    for (const [configuration, expected] of [[deskConfiguration(), 0], [admissionOn(true), 0], [admissionOn(), 1]] as const) {
      const store = new MemoryFeedStore();
      store.tail = { applied_at: at("2026-10-06T14:04:00Z"), id: "0".repeat(24) };
      store.changes.push(...changes);
      const result = await scanOutreachLeadChanges(at("2026-10-06T14:05:00Z"), { store, transaction, loader: fixedConfigurationLoader(configuration as never) });
      assert.equal(result.nominated, expected);
      assert.equal(store.jobs.has(`sod:lead-change:FormLead:${pre.id}:admission:r7`), expected === 1);
      assert.equal(store.jobs.has(`sod:lead-change:FormLead:${pre.id}:r7`), false, "never the intake/refresh identity");
    }
  });

  test("canonical updates of legacy revision-zero Leads use expansion, not intake", async () => {
    const pre = lead();
    const updated = { ...change(pre, 0, "2026-10-06T14:04:10Z", objectId(), ["granot_priority"]), command_name: "synchronizeLeadFromGranot" };
    assert.deepEqual(nominateLeadChanges([updated], new Set(), true, true), [{ lead: pre, revision: 1, kind: "admission" }]);
    assert.deepEqual(nominateLeadChanges([updated], new Set(), false, true), [{ lead: pre, revision: 1, kind: "admission" }]);
    assert.deepEqual(nominateLeadChanges([updated], new Set(), true, false), [], "expansion off: no intake fallback");
    assert.deepEqual(nominateLeadChanges([{ ...updated, changed_paths: ["receiver_agent"] }], new Set(), true, true), []);
    assert.deepEqual(nominateLeadChanges([updated], new Set([deskLeadKey(pre)]), true, true), [{ lead: pre, revision: 1, kind: "change" }]);
    for (const command_name of ["createFormLead", "createCallLead", "createLeadFromGranot"]) {
      assert.deepEqual(nominateLeadChanges([{ ...updated, command_name }], new Set(), true, true), [{ lead: pre, revision: 1, kind: "change" }]);
      assert.deepEqual(nominateLeadChanges([{ ...updated, command_name }], new Set(), false, true), []);
    }
    const store = new MemoryFeedStore();
    store.tail = { applied_at: at("2026-10-06T14:04:00Z"), id: "0".repeat(24) };
    store.changes.push(updated);
    await scanOutreachLeadChangesUntilCaughtUp(at("2026-10-06T14:05:00Z"), { store, transaction, loader: fixedConfigurationLoader(admissionOn() as never) });
    assert.deepEqual([...store.jobs.keys()], [`sod:lead-change:FormLead:${pre.id}:admission:r1`]);
  });
});

// ---- olr B2: the reconcile re-decides subjects decided under another configuration -----------

describe("decision reconcile (olr B2, migration.decision_reconcile_per_run)", () => {
  const MAP = APPROVED_MAPPING!.priority_map!;
  /** Configuration A (FINAL-01 map) or B (code 9 mapped → quoted) at a revision. */
  const configOf = (kind: "A" | "B", revision: number, migration: Record<string, unknown> = {}) =>
    deskConfiguration(
      { migration, cadence: kind === "A" ? {} : { priority_map: { ...MAP, codes: [...MAP.codes, { code: "9", workflow: "quoted" as const, closure_reason: null }] } } },
      `v${revision}`,
      revision,
    );
  const fpOf = (kind: "A" | "B") => deskDecisionFingerprint(configOf(kind, 1).value.cadence);
  const run = (store: MemoryFeedStore, configuration: ReturnType<typeof configOf>) =>
    reconcileOutreachRevisions(at("2026-10-06T14:05:00Z"), {
      store,
      transaction,
      loader: fixedConfigurationLoader(configuration as never),
      lease: { acquire: async () => true, release: async () => undefined },
    });
  const decisionKey = (ref: DeskLeadRef, kind: "A" | "B", revision: number) => `sod:lead-change:${ref.model}:${ref.id}:decision:${fpOf(kind).slice(0, 16)}:c${revision}`;

  test("a subject decided under another decision fingerprint is nominated once per configuration revision; replays dedupe; an A→B→A flip re-nominates", async () => {
    const store = new MemoryFeedStore();
    const decided = lead();
    const unstamped = lead();
    const current = lead();
    store.subjects.push(
      { id: "1".padStart(24, "0"), lead: decided, lead_revision_seen: 3, decision_fingerprint: fpOf("A") },
      { id: "2".padStart(24, "0"), lead: unstamped, lead_revision_seen: 3, decision_fingerprint: null },
      { id: "3".padStart(24, "0"), lead: current, lead_revision_seen: 3, decision_fingerprint: fpOf("B") },
    );
    for (const ref of [decided, unstamped, current]) store.revisions.set(deskLeadKey(ref), 3);
    // Active B at revision 6: A-decided and unstamped (null) subjects are nominated; the B-decided one is not.
    const first = await run(store, configOf("B", 6));
    assert.deepEqual([...store.jobs.keys()], [decisionKey(decided, "B", 6), decisionKey(unstamped, "B", 6)]);
    assert.deepEqual([first.nominated, first.decision_nominated, first.decision_deferred, first.decision_cap], [0, 2, 0, 300]);
    assert.equal(store.jobs.get(decisionKey(decided, "B", 6))!.input_revision, 6, "input_revision = configuration revision");
    // The jobs have not run yet: the next run proposes the same identities (insert-only enqueue dedupes them).
    await run(store, configOf("B", 6));
    assert.equal(store.jobs.size, 2);
    // The jobs ran (stamped B); the Owner flips back to A (revision 7), then to B again (revision 8).
    for (const subject of store.subjects) subject.decision_fingerprint = fpOf("B");
    assert.equal((await run(store, configOf("B", 6))).decision_nominated, 0, "settled: nothing to re-decide");
    await run(store, configOf("A", 7));
    for (const subject of store.subjects) subject.decision_fingerprint = fpOf("A");
    await run(store, configOf("B", 8));
    assert.deepEqual(
      [...store.jobs.keys()].filter((key) => key.includes(decided.id)),
      [decisionKey(decided, "B", 6), decisionKey(decided, "A", 7), decisionKey(decided, "B", 8)],
      "each flip is a new identity",
    );
  });
});

test("related Form wake batches current relations and survives completed Form revisions and overlap replay", async () => {
  const store = new MemoryFeedStore(), form = lead(), call = lead('CallLead');
  const changed = { ...change(call, 1, '2026-10-04T14:00:00Z', objectId(), ['granot_form_sibling']), command_name: 'mirrorFormLeadToCallSibling' };
  store.changes = [changed, changed]; store.relations.set(call.id, form.id);
  store.jobs.set(leadChangeJobInput(form, 1).dedupe_key, leadChangeJobInput(form, 1));
  const deps = { store, transaction, loader: fixedConfigurationLoader(deskConfiguration()) };
  await scanOutreachLeadChanges(at('2026-10-04T14:00:01Z'), deps);
  const related = [...store.jobs.values()].filter(job => job.dedupe_key.includes(':related:'));
  assert.equal(related.length, 1);
  assert.deepEqual(related[0]!.input_refs, [form.id, call.id]);
  assert.deepEqual(store.relationReads, [[call.id]]);
  await scanOutreachLeadChanges(at('2026-10-04T14:00:02Z'), deps);
  assert.equal([...store.jobs.values()].filter(job => job.dedupe_key.includes(':related:')).length, 1);
});
