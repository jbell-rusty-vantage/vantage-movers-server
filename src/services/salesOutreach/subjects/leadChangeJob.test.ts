import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConfigurationInspection, ConfigurationLoader } from "../config/load";
import { OutreachError } from "../errors";
import { fixedConfigurationLoader } from "../reads/testing";
import { runOutreachLeadChangeJob, type LeadChangeJobDeps } from "./leadChangeJob";
import { accepted, deskConfiguration, fakeSession, leadFacts, MemoryDeskSubjectStore } from "./testing";

const at = (iso: string) => new Date(iso);
const qualifiedRevision = () => fixedConfigurationLoader(deskConfiguration({ estimates_revision_nomination_ref: "replica-w1-proof" }));

function harness(
  lead = leadFacts(),
  loader: ConfigurationLoader = fixedConfigurationLoader(deskConfiguration({ transition: { intake_admission_enabled: true, intake_admission_at: "2026-10-01T00:00:00.000Z" } })),
  dedupeKey = `sod:lead-change:${lead.ref.model}:${lead.ref.id}:r1`,
) {
  const store = new MemoryDeskSubjectStore();
  store.addLead(lead);
  const calls: string[] = [];
  let queued = 1;
  const deps: LeadChangeJobDeps = {
    loader,
    store,
    now: () => at("2026-10-01T15:00:00Z"),
    claim: (async (_owner: string, _id?: string, _ttl?: number, stage?: string) => {
      calls.push(`claim:${stage}`);
      if (queued-- <= 0) return null;
      return { _id: "j".repeat(24), lease_owner: "w", lease_epoch: 1, dedupe_key: dedupeKey, subject_key: `outreach-lead:${lead.ref.model}:${lead.ref.id}`, input_refs: [lead.ref.id] };
    }) as never,
    complete: (async (_lease: unknown, mutation: (s: typeof fakeSession) => Promise<unknown>) => {
      calls.push("complete");
      return mutation(fakeSession);
    }) as never,
    fail: (async (_lease: unknown, reason: string) => {
      calls.push(`fail:${reason}`);
      return { status: "retry", next_attempt_at: new Date() };
    }) as never,
  };
  return { store, calls, deps, lead };
}

test("outreach_lead_change job: claims its own stage and enrolls a fresh intake Lead in the job transaction", async () => {
  const { store, calls, deps } = harness();
  const result = await runOutreachLeadChangeJob(undefined, deps);
  assert.equal(result.status, "completed");
  assert.equal(result.result?.outcome, "created");
  assert.deepEqual(calls, ["claim:outreach_lead_change", "complete"]);
  assert.equal(store.subjects.length, 1);
});

test("a configuration pointer that moved after admission aborts the write and retries", async () => {
  const first = deskConfiguration({}, "v1", 3);
  const second = deskConfiguration({}, "v2", 4);
  const loader: ConfigurationLoader = {
    inspect: async () => first as ConfigurationInspection,
    load: async () => first,
    requireActive: async () => second,
  };
  const { store, calls, deps } = harness(leadFacts(), loader);
  deps.complete = (async (_lease: unknown, mutation: (s: typeof fakeSession) => Promise<unknown>) => {
    calls.push("complete");
    try {
      return await mutation(fakeSession);
    } catch (error) {
      assert.ok(error instanceof OutreachError);
      throw error;
    }
  }) as never;
  assert.deepEqual(await runOutreachLeadChangeJob(undefined, deps), { status: "retry" });
  assert.deepEqual(calls, ["claim:outreach_lead_change", "complete", "fail:transient"]);
  assert.equal(store.subjects.length, 0, "nothing written under the old revision");
});

test("related wakes validate both refs, recheck relation, and never admit absent or closed Forms", async () => {
  const lead = leadFacts(), callId = 'a'.repeat(24);
  const key = `sod:lead-change:FormLead:${lead.ref.id}:related:CallLead:${callId}:change:${'b'.repeat(24)}`;
  const relatedHarness = (refs: string[] = [lead.ref.id, callId], relation: string | null = lead.ref.id) => {
    const h = harness(lead, undefined, key), claim = h.deps.claim!;
    h.deps.claim = (async (...args: Parameters<typeof claim>) => { const row = await claim(...args); return row ? { ...row, input_refs: refs } : null; }) as typeof claim;
    h.deps.relatedForm = async () => relation;
    return h;
  };
  const missing = relatedHarness();
  assert.equal((await runOutreachLeadChangeJob(undefined, missing.deps)).result?.reason, 'related_form_existing_open_only');
  assert.equal(missing.store.writes.length, 0);
  const malformed = relatedHarness([lead.ref.id]);
  assert.equal((await runOutreachLeadChangeJob(undefined, malformed.deps)).status, 'retry');
  assert.ok(malformed.calls.includes('fail:schema_invalid'));
  const changed = relatedHarness(undefined, 'c'.repeat(24));
  assert.equal((await runOutreachLeadChangeJob(undefined, changed.deps)).result?.reason, 'related_form_changed');
  const initial = harness(lead); await runOutreachLeadChangeJob(undefined, initial.deps);
  const closed = relatedHarness(); closed.store.subjects.push({ ...initial.store.subjects[0]!, status: 'closed' });
  assert.equal((await runOutreachLeadChangeJob(undefined, closed.deps)).result?.reason, 'related_form_existing_open_only');
  assert.equal(closed.store.writes.length, 0);
  const active = relatedHarness(); active.store.subjects.push(...structuredClone(initial.store.subjects)); active.store.periods.push(...structuredClone(initial.store.periods));
  assert.equal((await runOutreachLeadChangeJob(undefined, active.deps)).result?.outcome, 'unchanged');
  assert.deepEqual(active.store.periods, initial.store.periods);
  assert.equal(active.store.writes.length, 0);
});

test("Estimates refresh suppresses only the revision evaluation committed by this sync", async () => {
  const lead = leadFacts({ ...accepted("0", "2026-10-01T14:00:00Z") });
  const initial = harness(lead);
  await runOutreachLeadChangeJob(undefined, initial.deps);
  const newFacts = { ...lead, ...accepted("0", "2026-10-01T14:30:00Z") };
  const legacy = harness(newFacts, undefined, `sod:lead-change:FormLead:${lead.ref.id}:estimates-refresh:legacy`);
  legacy.store.subjects.push(...structuredClone(initial.store.subjects));
  legacy.store.periods.push(...structuredClone(initial.store.periods));
  let legacyNominations = 0;
  legacy.deps.enqueue = async () => { legacyNominations++; };
  assert.equal((await runOutreachLeadChangeJob(undefined, legacy.deps)).result?.evaluation_requested, true);
  assert.equal(legacyNominations, 1, "retain both nominations until the W1 evidence is recorded");
  const refresh = harness(newFacts, qualifiedRevision(),
    `sod:lead-change:FormLead:${lead.ref.id}:estimates-refresh:receipt-2`);
  refresh.store.subjects.push(...structuredClone(initial.store.subjects));
  refresh.store.periods.push(...structuredClone(initial.store.periods));
  const receiptJobs: unknown[] = [];
  refresh.deps.enqueue = async job => { receiptJobs.push(job); };
  const result = await runOutreachLeadChangeJob(undefined, refresh.deps);
  assert.equal(result.result?.evaluation_requested, true);
  assert.equal(result.result?.outcome, "updated");
  assert.equal(refresh.store.evaluations.length, 1, "fresh accepted evidence still evaluates");
  assert.equal(receiptJobs.length, 0, "the same transaction already persisted evaluation");
  assert.deepEqual(refresh.store.periods, initial.store.periods, "same priority preserves periods");
});

test("failed durable revision nomination aborts the callback and cannot suppress its retry", async () => {
  const initial = harness();
  await runOutreachLeadChangeJob(undefined, initial.deps);
  const refresh = harness({ ...initial.lead, name: "Changed display" }, undefined,
    `sod:lead-change:FormLead:${initial.lead.ref.id}:estimates-refresh:failed-write`);
  refresh.store.subjects.push(...structuredClone(initial.store.subjects));
  refresh.store.periods.push(...structuredClone(initial.store.periods));
  const request = refresh.store.requestEvaluation.bind(refresh.store);
  refresh.store.requestEvaluation = async () => { throw new Error("durable nomination failed"); };
  refresh.deps.complete = (async (_lease: unknown, mutation: (s: typeof fakeSession) => Promise<unknown>) => {
    const rollback = refresh.store.snapshot();
    try { return await mutation(fakeSession); } catch (error) { rollback(); throw error; }
  }) as never;
  let extra = 0;
  refresh.deps.enqueue = async () => { extra++; };
  assert.equal((await runOutreachLeadChangeJob(undefined, refresh.deps)).status, "retry");
  assert.deepEqual(refresh.store.subjects, initial.store.subjects);
  assert.equal(extra, 0);
  refresh.store.requestEvaluation = request;
  const retry = harness(refresh.lead, qualifiedRevision(), `sod:lead-change:FormLead:${initial.lead.ref.id}:estimates-refresh:failed-write`);
  retry.deps.store = refresh.store;
  retry.deps.enqueue = refresh.deps.enqueue;
  assert.equal((await runOutreachLeadChangeJob(undefined, retry.deps)).result?.evaluation_requested, true);
  assert.equal(refresh.store.evaluations.length, 1);
  assert.equal(extra, 0);
});
