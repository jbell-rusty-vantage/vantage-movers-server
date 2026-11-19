import assert from "node:assert/strict";
import { test } from "node:test";
import type { OutreachActor } from "./auth";
import { OutreachError } from "./errors";
import { GRANOT_SESSION_PILOT_AGENT, resolveOutreachGranotSessionLink } from "./granotSessionLink";
import { fixedConfigurationLoader, activeInspection } from "./reads/testing";
import { completeConfigurationInput } from "./evaluation/testing";
import type { SalesOutreachDetailDto } from "../../validation/v1/salesOutreachReads";
import { GranotSessionJobLinkError } from "../granotHttpCollector/sessionJobLink";

const actor = (role: OutreachActor["role"], agent_id: string | null): OutreachActor => ({ role, agent_id, actor: { kind: role, id: "synthetic", request_id: "synthetic", run_id: null } });
const josh = actor("rep", GRANOT_SESSION_PILOT_AGENT);
const now = new Date("2026-10-30T21:00:00Z");
const detail = { subject: { job_no: "P5550001", job_pending: false } } as SalesOutreachDetailDto;
const loader = fixedConfigurationLoader(activeInspection(completeConfigurationInput()));
const result = { url: "https://eagle.hellomoving.com/wc.dll?mpcharge~chargeswc~11111111-2222-3333-4444-555555555555", job_no: "P5550001" };
const isFailure = (code: string) => (error: unknown) => error instanceof OutreachError && error.code === code;

test("only Josh's signed Rep identity can reach the session lookup", async () => {
  for (const candidate of [actor("rep", "a".repeat(24)), actor("owner", GRANOT_SESSION_PILOT_AGENT), actor("manager", GRANOT_SESSION_PILOT_AGENT)]) {
    await assert.rejects(resolveOutreachGranotSessionLink(candidate, "subject", "private-context", { loader, now, readDetail: async () => { throw new Error("must not read"); } }), isFailure("FORBIDDEN"));
  }
});

test("job or access changes during lookup cannot release a stale result", async () => {
  let reads = 0;
  await assert.rejects(resolveOutreachGranotSessionLink(josh, "subject", "context", { loader, now, readDetail: async () => ++reads === 1 ? detail : { ...detail, subject: { ...detail.subject, job_no: "P5550002" } }, readUsername: async () => "JOSH", retrieve: async () => result }), isFailure("NOT_FOUND"));
});

test("an account mismatch is a safe explicit refusal with no automation fallback", async () => {
  let calls = 0;
  await assert.rejects(resolveOutreachGranotSessionLink(josh, "subject", "context", { loader, now, readDetail: async () => detail, readUsername: async () => "JOSH", retrieve: async () => { calls++; throw new GranotSessionJobLinkError("account_mismatch"); } }), (error: unknown) => error instanceof OutreachError && error.issues?.[0]?.code === "account_mismatch");
  assert.equal(calls, 1);
});
