import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ClientSession } from "mongoose";
import type { JobInput } from "../../salesIntelligence/jobs";
import { fixedConfigurationLoader } from "../reads/testing";
import {
  leadChangeJobInput,
  nominateLeadChanges,
  OUTREACH_LEAD_CHANGE_OVERLAP_MS,
  reconcileOutreachRevisions,
  scanOutreachLeadChanges,
  type FeedCursor,
  type LeadChangeRow,
  type OutreachFeedStore,
} from "./feed";
import { deskLeadKey, type DeskLeadRef } from "./leadFacts";
import { deskConfiguration, fakeSession, objectId } from "./testing";

const at = (iso: string) => new Date(iso);
const transaction = <T>(fn: (session: ClientSession) => Promise<T>) => fn(fakeSession);

class MemoryFeedStore implements OutreachFeedStore {
  changes: LeadChangeRow[] = [];
  subjects: Array<{ id: string; lead: DeskLeadRef; lead_revision_seen: number; closed?: boolean }> = [];
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
    return this.subjects.filter((s) => !s.closed && (!afterId || s.id > afterId)).sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit);
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
    assert.deepEqual(await reconcileOutreachRevisions(at("2026-10-04T14:05:00Z"), deps(store, false)), { skipped: true, reason: "lease_held", pages: 0, checked: 0, nominated: 0, wrapped: false });
  });
});
