import assert from "node:assert/strict";
import { test } from "node:test";
import { Types } from "mongoose";
import type { OutreachActor } from "./auth";
import { OutreachError } from "./errors";
import { canOpenGranotLink } from "./granotLinkAccess";
import { resolveOutreachGranotLink, type GranotLinkStore } from "./granotLink";
import { GranotJobLinkError } from "../granotHttpCollector/jobFormLink";
import { activeInspection, fixedConfigurationLoader } from "./reads/testing";
import { completeConfigurationInput, subjectRow } from "./evaluation/testing";
import { MemoryDeskReadStore } from "./reads/deskTesting";
import { getFormLeadModel } from "../../models/FormLead";
import { getCallLeadModel } from "../../models/CallLead";

const NOW = new Date();
const REP = "a".repeat(24);
const URL = "https://eagle.hellomoving.com/wc.dll?mpcharge~chargeswc~11111111-2222-4333-8444-555555555555";
const actor: OutreachActor = { role: "rep", agent_id: REP, actor: { kind: "rep", id: REP, agent_id: REP, request_id: "synthetic", run_id: null } };
function fixture() {
  const queueStore = new MemoryDeskReadStore();
  const subject = subjectRow({ assigned_agent_id: REP });
  queueStore.evaluation.subjects.set(subject.id, subject);
  let lead: Awaited<ReturnType<GranotLinkStore["read"]>> = { job_no: "5566822", receiver_agent: new Types.ObjectId(REP) };
  let saves = 0, requests = 0;
  const linkStore: GranotLinkStore = { read: async () => lead, save: async (_ref, _expected, cache) => { saves++; lead = { ...lead, granot_job_form_link: cache }; return true; } };
  const deps = { loader: fixedConfigurationLoader(activeInspection(completeConfigurationInput(), "synthetic", 1)), queueStore, linkStore, now: NOW, hasPoolAccess: async () => false, retrieve: async () => { requests++; return { job_no: "P5566822", url: URL }; } };
  return { deps, subject, setLead: (next: typeof lead) => { lead = next; }, counts: () => ({ saves, requests }) };
}
const code = (expected: string) => (error: unknown) => error instanceof OutreachError && error.code === expected;
test("unlinked reps and foreign non-Pool assignments are refused before provider I/O", async () => {
  const f = fixture();
  const unlinked = { ...actor, agent_id: null };
  assert.equal(canOpenGranotLink(unlinked, REP), false);
  await assert.rejects(resolveOutreachGranotLink(unlinked, f.subject.id, false, f.deps), code("FORBIDDEN"));
  f.setLead({ job_no: "5566822", receiver_agent: new Types.ObjectId("b".repeat(24)) });
  await assert.rejects(resolveOutreachGranotLink(actor, f.subject.id, false, f.deps), code("NOT_FOUND"));
  assert.deepEqual(f.counts(), { saves: 0, requests: 0 });
});
test("every rep can resolve its own assignment; owner and manager can resolve unassigned Leads", async () => {
  for (const rep of [REP, "b".repeat(24)]) {
    const f = fixture();
    f.setLead({ job_no: "5566822", receiver_agent: new Types.ObjectId(rep) });
    assert.equal((await resolveOutreachGranotLink({ ...actor, agent_id: rep }, f.subject.id, false, f.deps)).url, URL);
  }
  for (const role of ["owner", "manager"] as const) {
    const f = fixture();
    f.setLead({ job_no: "5566822" });
    assert.equal((await resolveOutreachGranotLink({ ...actor, role, agent_id: null }, f.subject.id, false, f.deps)).url, URL);
  }
});
test("shared Pool access is checked again before returning a link", async () => {
  const f = fixture();
  f.setLead({ job_no: "5566822", receiver_agent: new Types.ObjectId("b".repeat(24)) });
  assert.equal((await resolveOutreachGranotLink(actor, f.subject.id, false, { ...f.deps, hasPoolAccess: async () => true })).url, URL);
  let checks = 0;
  await assert.rejects(resolveOutreachGranotLink(actor, f.subject.id, true, { ...f.deps, hasPoolAccess: async () => ++checks === 1 }), code("NOT_FOUND"));
  assert.equal(checks, 2);
  assert.equal(f.counts().saves, 1);
});
test("retrieval caches on the Lead, a fresh hit skips Granot, explicit refresh retrieves again", async () => {
  const f = fixture();
  assert.equal((await resolveOutreachGranotLink(actor, f.subject.id, false, f.deps)).cached, false);
  assert.equal((await resolveOutreachGranotLink(actor, f.subject.id, false, { ...f.deps, now: new Date(Date.now() + 1000) })).cached, true);
  await resolveOutreachGranotLink(actor, f.subject.id, true, f.deps);
  assert.equal(f.counts().requests, 2);
});
test("reassignment during lookup returns no link and saves nothing", async () => {
  const f = fixture();
  const retrieve = async () => { f.setLead({ job_no: "5566822", receiver_agent: new Types.ObjectId("b".repeat(24)) }); return { job_no: "P5566822", url: URL }; };
  await assert.rejects(resolveOutreachGranotLink(actor, f.subject.id, false, { ...f.deps, retrieve }), code("NOT_FOUND"));
  assert.equal(f.counts().saves, 0);
});
test("changed Job Number, expired cache and provider failures never return the old URL", async () => {
  for (const cache of [{ job_no: "P9999", url: URL, captured_at: NOW }, { job_no: "P5566822", url: URL, captured_at: new Date(+NOW - 11 * 60_000) }]) {
    const f = fixture();
    f.setLead({ job_no: "5566822", receiver_agent: new Types.ObjectId(REP), granot_job_form_link: cache });
    await assert.rejects(resolveOutreachGranotLink(actor, f.subject.id, false, { ...f.deps, retrieve: async () => { throw new GranotJobLinkError("busy"); } }), code("SERVICE_UNAVAILABLE"));
    assert.equal(f.counts().saves, 0);
  }
});
test("normal Form and Call Lead selections exclude the navigation cache", () => {
  for (const model of [getFormLeadModel(), getCallLeadModel()]) assert.equal(model.schema.path("granot_job_form_link").options.select, false);
});
