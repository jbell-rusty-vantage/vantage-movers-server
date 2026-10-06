import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ClientSession } from "mongoose";
import { salesOutreachConfigurationValueSchema } from "../../../validation/v1/salesOutreach";
import type { JobInput } from "../../salesIntelligence/jobs";
import { configurationContentHash } from "../config/store";
import { CONFIGURATION_REVISION_5_HASH, configurationRevision5Value } from "../config/testing";
import { fixedConfigurationLoader } from "../reads/testing";
import {
  DECISION_RECONCILE_DEFAULT_PER_RUN,
  decisionJobInput,
  decisionReconcilePerRunOf,
  feedLoopOf,
  holdJobInput,
  holdRecheckBucketOf,
  leadChangeJobInput,
  nominateLeadChanges,
  OUTREACH_FEED_LOOP_DEFAULTS,
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
const change = (ref: DeskLeadRef, revisionBefore: number, appliedAt: string, id = objectId()): LeadChangeRow => ({
  id,
  lead: ref,
  revision_before: revisionBefore,
  revision_after: revisionBefore + 1,
  applied_at: at(appliedAt),
});

describe("entity_changes tail (IMPL-05, outreach_lead_change)", () => {
  test("nominations: subjects on every change, creations only while the intake gate is on, one per revision", () => {
    const subject = lead();
    const fresh = lead("CallLead");
    const other = lead();
    const changes = [change(subject, 3, "2026-10-04T14:00:00Z"), change(subject, 3, "2026-10-04T14:00:00Z"), change(fresh, 0, "2026-10-04T14:00:01Z"), change(other, 5, "2026-10-04T14:00:02Z")];
    const keys = new Set([deskLeadKey(subject)]);
    assert.deepEqual(nominateLeadChanges(changes, keys, false), [{ lead: subject, revision: 4 }]);
    assert.deepEqual(nominateLeadChanges(changes, keys, true), [{ lead: subject, revision: 4 }, { lead: fresh, revision: 1 }]);
  });

  test("the job identity is per Lead revision (tail, reconcile and wake converge)", () => {
    const ref = { model: "CallLead" as const, id: "a".repeat(24) };
    assert.deepEqual(leadChangeJobInput(ref, 9), {
      stage: "outreach_lead_change",
      subject_key: `outreach-lead:CallLead:${"a".repeat(24)}`,
      dedupe_key: `sod:lead-change:CallLead:${"a".repeat(24)}:r9`,
      input_revision: 9,
      input_refs: ["a".repeat(24)],
    });
  });

  test("fails closed without an active configuration: nothing nominated, cursor untouched", async () => {
    const store = new MemoryFeedStore();
    for (const inspection of [{ state: "uninitialized" as const }, { state: "unavailable" as const, reason: "hash_mismatch" as const, version: "v", revision: 1, updated_at: null, updated_by: null }]) {
      const result = await scanOutreachLeadChanges(at("2026-10-04T14:05:00Z"), { store, transaction, loader: fixedConfigurationLoader(inspection) });
      assert.equal(result.skipped, true);
      assert.equal(store.tail, null);
    }
  });

  test("durable cursor (applied_at, _id): first pass starts at now − overlap, pages of 100, strictly after the cursor", async () => {
    const store = new MemoryFeedStore();
    const ref = lead();
    store.subjects.push({ id: objectId(), lead: ref, lead_revision_seen: 0 });
    store.changes.push(change(ref, 0, "2026-10-04T13:00:00Z")); // before the first-pass window: enrollment's, not the tail's
    for (let i = 0; i < 150; i++) store.changes.push(change(ref, i + 1, `2026-10-04T14:04:${String(i % 60).padStart(2, "0")}Z`, String(i).padStart(24, "0")));
    const deps = { store, transaction, loader: fixedConfigurationLoader(deskConfiguration() as never) };
    const now = at("2026-10-04T14:05:00Z");
    const first = await scanOutreachLeadChanges(now, deps);
    assert.equal(first.scanned, 100);
    assert.equal(store.jobs.size, 100);
    const second = await scanOutreachLeadChanges(now, deps);
    assert.equal(store.jobs.size, 150, "the rest of the backlog, nothing twice");
    assert.ok(second.scanned >= 50);
    const third = await scanOutreachLeadChanges(now, deps);
    assert.equal(third.cursor?.id, second.cursor?.id, "an empty page keeps the cursor");
  });

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

  test("a stored job with a different payload is skipped and never pins the cursor", async () => {
    const store = new MemoryFeedStore();
    const ref = lead();
    store.subjects.push({ id: objectId(), lead: ref, lead_revision_seen: 0 });
    store.changes.push(change(ref, 1, "2026-10-04T14:04:30Z"));
    store.conflictKeys.add(`sod:lead-change:FormLead:${ref.id}:r2`);
    const result = await scanOutreachLeadChanges(at("2026-10-04T14:05:00Z"), { store, transaction, loader: fixedConfigurationLoader(deskConfiguration() as never) });
    assert.equal(result.conflicts, 1);
    assert.ok(store.tail);
  });
});

describe("revision reconcile (outreach_revision_reconcile)", () => {
  const deps = (store: MemoryFeedStore, acquired = true) => ({
    store,
    transaction,
    loader: fixedConfigurationLoader(deskConfiguration() as never),
    lease: { acquire: async () => acquired, release: async () => undefined },
  });

  test("open subjects whose Lead domain_revision ≠ lead_revision_seen get a lead-change job; closed ones are skipped", async () => {
    const store = new MemoryFeedStore();
    const stale = lead();
    const fresh = lead();
    const closed = lead();
    store.subjects.push({ id: "1".padStart(24, "0"), lead: stale, lead_revision_seen: 2 }, { id: "2".padStart(24, "0"), lead: fresh, lead_revision_seen: 4 }, { id: "3".padStart(24, "0"), lead: closed, lead_revision_seen: 1, closed: true });
    store.revisions.set(deskLeadKey(stale), 5).set(deskLeadKey(fresh), 4).set(deskLeadKey(closed), 9);
    const result = await reconcileOutreachRevisions(at("2026-10-04T14:05:00Z"), deps(store));
    assert.deepEqual([...store.jobs.keys()], [`sod:lead-change:FormLead:${stale.id}:r5`]);
    assert.equal(result.wrapped, true);
    assert.equal(store.reconcileCursor, null, "a short page wraps the cursor");
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

describe("hold re-check (olr B8, ambiguous_identity admission hold)", () => {
  const run = (store: MemoryFeedStore, iso: string, configuration = deskConfiguration()) =>
    reconcileOutreachRevisions(at(iso), {
      store,
      transaction,
      loader: fixedConfigurationLoader(configuration as never),
      lease: { acquire: async () => true, release: async () => undefined },
    });
  const holdKeys = (store: MemoryFeedStore) => [...store.jobs.keys()].filter((key) => key.includes(":hold:")).sort();

  test("the hold job identity: one per subject per 15-minute bucket (UTC), input_revision 1", () => {
    const ref = { model: "CallLead" as const, id: "b".repeat(24) };
    assert.equal(holdRecheckBucketOf(at("2026-10-06T19:44:59.999Z")), "20261006T1930");
    assert.equal(holdRecheckBucketOf(at("2026-10-06T19:45:00.000Z")), "20261006T1945");
    assert.deepEqual(holdJobInput(ref, at("2026-10-06T00:07:00Z")), {
      stage: "outreach_lead_change",
      subject_key: `outreach-lead:CallLead:${"b".repeat(24)}`,
      dedupe_key: `sod:lead-change:CallLead:${"b".repeat(24)}:hold:20261006T0000`,
      input_revision: 1,
      input_refs: ["b".repeat(24)],
    });
  });

  test("held ambiguous review subjects are re-nominated at most once per 15 minutes", async () => {
    const store = new MemoryFeedStore();
    const held = lead();
    const priorityReview = lead();
    const active = lead();
    const heldMoved = lead();
    store.subjects.push(
      { id: "1".padStart(24, "0"), lead: held, lead_revision_seen: 2, status: "review", review_reasons: ["ambiguous_identity"] },
      { id: "2".padStart(24, "0"), lead: priorityReview, lead_revision_seen: 2, status: "review", review_reasons: ["priority_needs_review"] },
      { id: "3".padStart(24, "0"), lead: active, lead_revision_seen: 2 },
      { id: "4".padStart(24, "0"), lead: heldMoved, lead_revision_seen: 2, status: "review", review_reasons: ["received_time_missing", "ambiguous_identity"] },
    );
    for (const ref of [held, priorityReview, active]) store.revisions.set(deskLeadKey(ref), 2);
    store.revisions.set(deskLeadKey(heldMoved), 3);
    const first = await run(store, "2026-10-06T14:05:00Z");
    assert.equal(first.hold_nominated, 1);
    assert.deepEqual(holdKeys(store), [`sod:lead-change:FormLead:${held.id}:hold:20261006T1400`], "only the held subject; priority review and active subjects are not re-checked");
    assert.ok(store.jobs.has(`sod:lead-change:FormLead:${heldMoved.id}:r3`), "a held subject whose Lead moved gets its revision job (it re-checks too)");
    // The 5-minute reconcile runs twice more in the same bucket: the same identity (insert-only enqueue dedupes).
    await run(store, "2026-10-06T14:10:00Z");
    await run(store, "2026-10-06T14:14:59Z");
    assert.equal(holdKeys(store).length, 1, "at most one hold job per 15 minutes");
    await run(store, "2026-10-06T14:15:00Z");
    assert.deepEqual(holdKeys(store), [
      `sod:lead-change:FormLead:${held.id}:hold:20261006T1400`,
      `sod:lead-change:FormLead:${held.id}:hold:20261006T1415`,
    ]);
    // The hold cleared (the job synced the subject active): nothing more.
    store.subjects[0]!.status = "active";
    store.subjects[0]!.review_reasons = [];
    const settled = await run(store, "2026-10-06T14:30:00Z");
    assert.equal(settled.hold_nominated, 0);
    assert.equal(holdKeys(store).length, 2);
  });

  test("a held subject with a decision job this run gets no hold job; deferred by the cap, it still does", async () => {
    const MAP = APPROVED_MAPPING!.priority_map!;
    const remapped = (migration: Record<string, unknown>) =>
      deskConfiguration({ migration, cadence: { priority_map: { ...MAP, codes: [...MAP.codes, { code: "9", workflow: "quoted" as const, closure_reason: null }] } } }, "v7", 7);
    const store = new MemoryFeedStore();
    const first = lead();
    const second = lead();
    store.subjects.push(
      { id: "1".padStart(24, "0"), lead: first, lead_revision_seen: 1, status: "review", review_reasons: ["ambiguous_identity"] },
      { id: "2".padStart(24, "0"), lead: second, lead_revision_seen: 1, status: "review", review_reasons: ["ambiguous_identity"] },
    );
    for (const ref of [first, second]) store.revisions.set(deskLeadKey(ref), 1);
    const result = await run(store, "2026-10-06T14:05:00Z", remapped({ decision_reconcile_per_run: 1 }));
    assert.deepEqual([result.decision_nominated, result.decision_deferred, result.hold_nominated], [1, 1, 1]);
    assert.ok([...store.jobs.keys()].some((key) => key.startsWith(`sod:lead-change:FormLead:${first.id}:decision:`)));
    assert.deepEqual(holdKeys(store), [`sod:lead-change:FormLead:${second.id}:hold:20261006T1400`]);
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
  test("a backlog of 250 changes is consumed in one run in 3 passes; the overlap is scanned once", async () => {
    const store = new CountingFeedStore();
    const rows = backlog(store, 250);
    cursorBefore(store, rows);
    const result = await scanOutreachLeadChangesUntilCaughtUp(at("2026-10-04T14:05:00Z"), loopDeps(store));
    assert.equal(result.passes, 3);
    assert.equal(store.overlapScans, 1, "only the first pass re-scans the overlap");
    assert.equal(store.jobs.size, 250, "every change of the burst nominated in the same run");
    assert.equal(result.nominated, 250);
    assert.deepEqual([result.caught_up, result.stopped_by], [true, "caught_up"]);
    assert.equal(store.tail?.id, rows.at(-1)!.id, "the cursor reaches the last change");
    assert.equal(result.cursor?.id, rows.at(-1)!.id);
    assert.deepEqual([result.max_passes, result.budget_seconds], [10, 15], "code defaults when the keys are absent");
  });

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

  test("the loop stops at the time budget with the cursor at the last committed page", async () => {
    const store = new CountingFeedStore();
    const rows = backlog(store, 1000);
    cursorBefore(store, rows);
    store.msPerPage = 8_000; // each pass "takes" 8 s: with the 15 s default budget the second pass is the last
    const result = await scanOutreachLeadChangesUntilCaughtUp(at("2026-10-04T14:05:00Z"), loopDeps(store));
    assert.deepEqual([result.passes, result.stopped_by, result.caught_up], [2, "budget", false]);
    assert.equal(store.tail?.id, rows[199]!.id);
    // A configured budget widens it: 40 s → 5 passes of 8 s.
    const wide = new CountingFeedStore();
    const wideRows = backlog(wide, 1000);
    cursorBefore(wide, wideRows);
    wide.msPerPage = 8_000;
    const widened = await scanOutreachLeadChangesUntilCaughtUp(at("2026-10-04T14:05:00Z"), loopDeps(wide, { feed_budget_seconds: 40 }));
    assert.deepEqual([widened.passes, widened.stopped_by, widened.budget_seconds], [5, "budget", 40]);
    assert.equal(wide.tail?.id, wideRows[499]!.id);
  });

  test("a 1,000-change burst is admitted in 2 cron runs with the defaults", async () => {
    const store = new CountingFeedStore();
    const rows = backlog(store, 1000);
    cursorBefore(store, rows);
    const deps = loopDeps(store);
    const first = await scanOutreachLeadChangesUntilCaughtUp(at("2026-10-04T14:05:00Z"), deps);
    assert.deepEqual([first.passes, first.stopped_by], [10, "max_passes"]);
    const second = await scanOutreachLeadChangesUntilCaughtUp(at("2026-10-04T14:06:00Z"), deps);
    assert.deepEqual([second.passes, second.caught_up], [1, true]);
    assert.equal(store.jobs.size, 1000);
    assert.equal(store.tail?.id, rows.at(-1)!.id);
  });

  test("an empty or short page ends the loop", async () => {
    const empty = new CountingFeedStore();
    const none = await scanOutreachLeadChangesUntilCaughtUp(at("2026-10-04T14:05:00Z"), loopDeps(empty));
    assert.deepEqual([none.passes, none.caught_up, none.scanned], [1, true, 0]);
    assert.ok(empty.tail, "a first run stores the starting cursor");

    const short = new CountingFeedStore();
    const shortRows = backlog(short, 40, "2026-10-04T14:04:00Z");
    const shortRun = await scanOutreachLeadChangesUntilCaughtUp(at("2026-10-04T14:05:00Z"), loopDeps(short));
    assert.deepEqual([shortRun.passes, shortRun.caught_up, short.pages], [1, true, 1]);
    assert.equal(short.tail?.id, shortRows.at(-1)!.id);

    // Exactly one full page: the second pass finds an empty page and ends the loop.
    const full = new CountingFeedStore();
    const fullRows = backlog(full, OUTREACH_FEED_PAGE);
    cursorBefore(full, fullRows);
    const fullRun = await scanOutreachLeadChangesUntilCaughtUp(at("2026-10-04T14:05:00Z"), loopDeps(full));
    assert.deepEqual([fullRun.passes, fullRun.caught_up, full.overlapScans], [2, true, 1]);
    assert.equal(full.tail?.id, fullRows.at(-1)!.id);
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

  test("fails closed without an active configuration: no pass, cursor untouched", async () => {
    const store = new CountingFeedStore();
    backlog(store, 150);
    const result = await scanOutreachLeadChangesUntilCaughtUp(at("2026-10-04T14:05:00Z"), {
      store,
      transaction,
      loader: fixedConfigurationLoader({ state: "uninitialized" }),
    });
    assert.deepEqual([result.skipped, result.reason, result.passes], [true, "configuration_uninitialized", 0]);
    assert.deepEqual([store.tail, store.pages, store.jobs.size], [null, 0, 0]);
  });

  test("a single pass still re-scans the overlap by default and can skip it", async () => {
    const store = new CountingFeedStore();
    const rows = backlog(store, 5, "2026-10-04T14:04:00Z");
    store.tail = { applied_at: rows.at(-1)!.applied_at, id: rows.at(-1)!.id };
    const deps = loopDeps(store);
    const pass = await scanOutreachLeadChanges(at("2026-10-04T14:05:00Z"), deps);
    assert.deepEqual([pass.page_size, pass.scanned, store.overlapScans], [0, 4, 1]);
    const noOverlap = await scanOutreachLeadChanges(at("2026-10-04T14:05:00Z"), deps, { overlap: false });
    assert.deepEqual([noOverlap.scanned, store.overlapScans], [0, 1]);
  });

  test("configuration: the keys are optional without default (R0), bounded, and resolved by feedLoopOf", () => {
    const stored = configurationRevision5Value();
    const parsed = salesOutreachConfigurationValueSchema.parse(stored);
    assert.equal(configurationContentHash(parsed), CONFIGURATION_REVISION_5_HASH, "the revision-5 value re-parses to the same content hash");
    assert.equal("feed_max_passes_per_run" in parsed.migration, false);
    assert.equal("feed_budget_seconds" in parsed.migration, false);
    assert.deepEqual(feedLoopOf(parsed), { max_passes: 10, budget_ms: 15_000 });
    assert.deepEqual(feedLoopOf(null), {
      max_passes: OUTREACH_FEED_LOOP_DEFAULTS.feed_max_passes_per_run,
      budget_ms: OUTREACH_FEED_LOOP_DEFAULTS.feed_budget_seconds * 1000,
    });

    const withKeys = configurationRevision5Value();
    withKeys.migration = { ...withKeys.migration, feed_max_passes_per_run: 1, feed_budget_seconds: 40 };
    const set = salesOutreachConfigurationValueSchema.parse(withKeys);
    assert.deepEqual(feedLoopOf(set), { max_passes: 1, budget_ms: 40_000 });
    assert.notEqual(configurationContentHash(set), CONFIGURATION_REVISION_5_HASH, "a set key is hashed");

    for (const bad of [{ feed_max_passes_per_run: 0 }, { feed_max_passes_per_run: 51 }, { feed_max_passes_per_run: 2.5 }, { feed_budget_seconds: 0 }, { feed_budget_seconds: 41 }]) {
      const value = configurationRevision5Value();
      value.migration = { ...value.migration, ...bad };
      assert.equal(salesOutreachConfigurationValueSchema.safeParse(value).success, false, JSON.stringify(bad));
    }
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

  test("the decision job identity: one per subject per decision fingerprint and configuration revision", () => {
    const ref = { model: "FormLead" as const, id: "a".repeat(24) };
    const fp = "0123456789abcdef".repeat(4);
    assert.deepEqual(decisionJobInput(ref, fp, 6), {
      stage: "outreach_lead_change",
      subject_key: `outreach-lead:FormLead:${"a".repeat(24)}`,
      dedupe_key: `sod:lead-change:FormLead:${"a".repeat(24)}:decision:0123456789abcdef:c6`,
      input_revision: 6,
      input_refs: ["a".repeat(24)],
    });
  });

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

  test("a subject whose Lead revision moved gets only the r<rev> job (it stamps the fingerprint too)", async () => {
    const store = new MemoryFeedStore();
    const moved = lead();
    store.subjects.push({ id: "1".padStart(24, "0"), lead: moved, lead_revision_seen: 3, decision_fingerprint: fpOf("A") });
    store.revisions.set(deskLeadKey(moved), 4);
    const result = await run(store, configOf("B", 6));
    assert.deepEqual([...store.jobs.keys()], [`sod:lead-change:FormLead:${moved.id}:r4`]);
    assert.deepEqual([result.nominated, result.decision_nominated], [1, 0]);
  });

  test("decision nominations are capped per run; revision nominations are not", async () => {
    const store = new MemoryFeedStore();
    for (let i = 0; i < 500; i++) {
      const ref = lead();
      // Even ids: Lead revision moved (revision job); odd ids: current revision, decided under A (decision job).
      store.subjects.push({ id: String(i).padStart(24, "0"), lead: ref, lead_revision_seen: 1, decision_fingerprint: fpOf("A") });
      store.revisions.set(deskLeadKey(ref), i % 2 === 0 ? 2 : 1);
    }
    const capped = await run(store, configOf("B", 6, { decision_reconcile_per_run: 100 }));
    assert.deepEqual([capped.pages, capped.checked, capped.wrapped], [6, 500, true], "the cursor still moves and wraps");
    assert.deepEqual([capped.nominated, capped.decision_nominated, capped.decision_deferred, capped.decision_cap], [250, 100, 150, 100]);
    assert.equal([...store.jobs.keys()].filter((key) => key.includes(":decision:")).length, 100);
    assert.equal([...store.jobs.keys()].filter((key) => /:r2$/.test(key)).length, 250);
    // The next run takes the next 100 (the first 100 still queued count against the cap: the wave follows the drain).
    for (const subject of store.subjects.filter((s) => store.jobs.has(decisionKey(s.lead, "B", 6)))) subject.decision_fingerprint = fpOf("B");
    for (const subject of store.subjects) subject.lead_revision_seen = store.revisions.get(deskLeadKey(subject.lead))!;
    const next = await run(store, configOf("B", 6, { decision_reconcile_per_run: 100 }));
    assert.deepEqual([next.nominated, next.decision_nominated, next.decision_deferred], [0, 100, 300]);
    assert.equal([...store.jobs.keys()].filter((key) => key.includes(":decision:")).length, 200);
    // Absent key → the code default.
    assert.equal(decisionReconcilePerRunOf(configOf("B", 6).value), DECISION_RECONCILE_DEFAULT_PER_RUN);
    assert.equal(decisionReconcilePerRunOf(null), 300);
  });

  test("closed subjects are never re-decided", async () => {
    const store = new MemoryFeedStore();
    const closed = lead();
    store.subjects.push({ id: "1".padStart(24, "0"), lead: closed, lead_revision_seen: 3, decision_fingerprint: fpOf("A"), closed: true });
    store.revisions.set(deskLeadKey(closed), 3);
    const result = await run(store, configOf("B", 6));
    assert.equal(store.jobs.size, 0);
    assert.deepEqual([result.checked, result.decision_nominated], [0, 0]);
  });

  test("migration.decision_reconcile_per_run is optional with no schema default (R0) and bounded 1–5,000", () => {
    const parsed = salesOutreachConfigurationValueSchema.parse(configurationRevision5Value());
    assert.equal(configurationContentHash(parsed), CONFIGURATION_REVISION_5_HASH);
    assert.equal("decision_reconcile_per_run" in parsed.migration, false, "no default leaks into old versions");
    for (const ok of [1, 300, 5000]) {
      const value = configurationRevision5Value();
      value.migration = { ...value.migration, decision_reconcile_per_run: ok };
      assert.equal(salesOutreachConfigurationValueSchema.safeParse(value).success, true, String(ok));
    }
    for (const bad of [0, 5001, 2.5, "300"]) {
      const value = configurationRevision5Value();
      value.migration = { ...value.migration, decision_reconcile_per_run: bad };
      assert.equal(salesOutreachConfigurationValueSchema.safeParse(value).success, false, JSON.stringify(bad));
    }
  });
});
