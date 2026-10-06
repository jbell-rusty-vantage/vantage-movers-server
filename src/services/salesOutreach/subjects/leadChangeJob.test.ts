import assert from "node:assert/strict";
import { test } from "node:test";
import { CsiError } from "../../salesIntelligence/auth";
import type { ConfigurationInspection, ConfigurationLoader } from "../config/load";
import { OutreachError } from "../errors";
import { fixedConfigurationLoader } from "../reads/testing";
import { drainOutreachLeadChangeJobs, runOutreachLeadChangeJob, triggerOfJob, type LeadChangeJobDeps } from "./leadChangeJob";
import { accepted, deskConfiguration, fakeSession, leadFacts, MemoryDeskSubjectStore } from "./testing";

const at = (iso: string) => new Date(iso);

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

test("olr B8: the stored job result names the subject status and the admission path (read by GET /enrollment/admissions)", async () => {
  const { deps, store } = harness();
  let stored: unknown;
  deps.complete = (async (_lease: unknown, mutation: (s: typeof fakeSession) => Promise<unknown>, options: { resultFrom: (value: unknown) => unknown }) => {
    stored = options.resultFrom(await mutation(fakeSession));
    return stored;
  }) as never;
  await runOutreachLeadChangeJob(undefined, deps);
  assert.deepEqual(stored, { outcome: "created", subject_id: store.subjects[0]!.id, reason: null, status: "active", admission: "intake" });
  const refused = harness(leadFacts({ created_at: at("2026-09-30T12:00:00Z") }));
  refused.deps.complete = deps.complete;
  await runOutreachLeadChangeJob(undefined, refused.deps);
  assert.deepEqual(stored, { outcome: "not_admitted", subject_id: null, reason: "created_before_intake", status: null, admission: null });
});

test("olr B6: the claimed row's dedupe_key picks the trigger; an :admission: job admits a pre-gate Lead as expansion, a plain r<rev> job does not", async () => {
  assert.equal(triggerOfJob("sod:lead-change:FormLead:abc:admission:r7"), "admission");
  assert.equal(triggerOfJob("sod:lead-change:FormLead:abc:r7"), "default");
  assert.equal(triggerOfJob("sod:lead-change:FormLead:abc:decision:0123456789abcdef:c6"), "default");
  assert.equal(triggerOfJob("sod:lead-change:FormLead:abc:hold:20261006T1445"), "default");
  const configuration = deskConfiguration({
    transition: {
      intake_admission_enabled: true,
      intake_admission_at: "2026-10-01T00:00:00.000Z",
      backfill_lookback_days: 90,
      backfill_include_upcoming_moves: true,
      expansion_admission_enabled: true,
    },
    migration: { paused: false },
  });
  const pre = leadFacts({ created_at: at("2026-09-20T14:00:05Z"), timestamp: at("2026-09-20T10:00:00Z"), ...accepted("1", "2026-10-01T14:50:00Z") });
  const plain = harness(pre, fixedConfigurationLoader(configuration), `sod:lead-change:FormLead:${pre.ref.id}:r4`);
  assert.equal((await runOutreachLeadChangeJob(undefined, plain.deps)).result?.reason, "created_before_intake");
  const admission = harness(pre, fixedConfigurationLoader(configuration), `sod:lead-change:FormLead:${pre.ref.id}:admission:r4`);
  const result = await runOutreachLeadChangeJob(undefined, admission.deps);
  assert.deepEqual([result.result?.outcome, result.result?.admission], ["created", "expansion"]);
  assert.equal(admission.store.subjects[0]!.enrollment.cohort_id, "admission:2026-10-01");
});

test("no active configuration at admission: nothing is claimed", async () => {
  const { calls, deps } = harness(leadFacts(), fixedConfigurationLoader({ state: "uninitialized" }));
  assert.deepEqual(await runOutreachLeadChangeJob(undefined, deps), { status: "configuration_unavailable" });
  assert.deepEqual(calls, []);
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

test("a malformed job row dead-letters fast (schema_invalid); a lost lease is reported, not failed", async () => {
  const { calls, deps } = harness();
  deps.claim = (async () => ({ _id: "j".repeat(24), lease_owner: "w", lease_epoch: 1, subject_key: "outreach-lead:Nope:x", input_refs: ["x"] })) as never;
  assert.deepEqual(await runOutreachLeadChangeJob(undefined, deps), { status: "retry" });
  assert.equal(calls.at(-1), "fail:schema_invalid");
  const lost = harness();
  lost.deps.complete = (async () => {
    throw new CsiError("LEASE_LOST");
  }) as never;
  assert.deepEqual(await runOutreachLeadChangeJob(undefined, lost.deps), { status: "lease_lost" });
});

test("drain stops when nothing is claimable and is bounded to 100", async () => {
  const { deps } = harness();
  const { outcomes } = await drainOutreachLeadChangeJobs(500, 10_000, deps);
  assert.deepEqual(outcomes, { completed: 1, not_claimable: 1 });
});
