import assert from "node:assert/strict";
import { test } from "node:test";
import { proposeRepCandidates } from "./propose";
import { resolveRepIdentityAt, type TemporalRepLink } from "./resolve";
import { csiRepInputSchema } from "../../../validation/v1/salesIntelligence";
import { defaultStageHandlers } from "../../numberActivity/jobDispatch";
import { runRepIdentityReevaluationJob } from "./worker";

const agents = [{ _id: "a", name: "Alex Reed", name_aliases: ["Alex R"] }, { _id: "b", name: "Jordan Lee", name_aliases: ["Alex R"] }];
test("exact names remain proposed; alias ties, duplicate names, missing names and non-Users remain explicit", () => {
  assert.equal(proposeRepCandidates({ id: "1", name: "Jordan Lee", type: "User" }, agents).status, "proposed");
  assert.equal(proposeRepCandidates({ id: "1", name: "Alex R", type: "User" }, agents).status, "ambiguous");
  assert.equal(proposeRepCandidates({ id: "1", name: "Jordan Lee", type: "User" }, [...agents, { _id: "c", name: "Jordan Lee" }]).status, "ambiguous");
  assert.equal(proposeRepCandidates({ id: "1", name: "Casey Unknown", type: "User" }, agents).status, "unmatched");
  for (const type of ["Department", "Voicemail", "IvrMenu", "Announcement", "CompanyExtension", "Queue"]) {
    assert.deepEqual(proposeRepCandidates({ id: "1", name: "Alex Reed", type }, agents).candidates, []);
  }
});
const boundary = new Date("2026-09-10T12:00:00Z"), from = new Date("2026-09-01T00:00:00Z");
const old: TemporalRepLink = { _id: "1", revision: 2, agent_id: "alex", rc_account_id: "a", rc_extension_id: "101", role_kind: "sales_rep",
  status: "retired", effective_from: from, effective_to: boundary, reviewed_at: from, reviewed_by: "owner" };
const next: TemporalRepLink = { ...old, _id: "2", status: "reviewed", agent_id: "jordan", effective_from: boundary, effective_to: null };
test("account scope, half-open reassignment, retirement and review authority", () => {
  const rows = [old, next, { ...next, _id: "3", rc_account_id: "b", agent_id: "casey" }];
  assert.equal(resolveRepIdentityAt(rows,"a","101",new Date(+boundary - 1)).agent_id,"alex");
  assert.equal(resolveRepIdentityAt(rows,"a","101",boundary).agent_id,"jordan");
  assert.equal(resolveRepIdentityAt(rows,"a","101",new Date(+boundary + 1)).agent_id,"jordan");
  assert.equal(resolveRepIdentityAt(rows,"b","101",boundary).agent_id,"casey");
  assert.equal(resolveRepIdentityAt([old],"a","101",boundary).status,"unknown");
  assert.equal(resolveRepIdentityAt([{ ...old, reviewed_at: null }],"a","101",from).status,"unknown");
  assert.equal(resolveRepIdentityAt([{ ...next, status: "proposed" }],"a","101",boundary).status,"proposed_only");
  assert.equal(resolveRepIdentityAt([next, { ...next, _id:"4" }],"a","101",boundary).status,"conflicting");
  for (const role_kind of ["shared", "service", "manager", "dialer", "excluded"]) assert.equal(resolveRepIdentityAt([{ ...next, role_kind }],"a","101",boundary).status,"excluded_role");
});
test("period validation compares instants and rejects unknown input keys", () => {
  const link = { agent_id: "aaaaaaaaaaaaaaaaaaaaaaaa", rc_account_id: "a", rc_extension_id: "101", role_kind: "sales_rep",
    effective_from: "2026-09-01T00:00:00.100Z", effective_to: "2026-09-01T00:00:00Z", nudge_channels_allowed: [] };
  assert.equal(csiRepInputSchema.safeParse(link).success,false);
  assert.equal(csiRepInputSchema.safeParse({ ...link, effective_to:null, reviewed:true }).success,false);
});
test("registered identity worker is a flag-off no-op", async () => {
  assert.equal(typeof defaultStageHandlers().rep_identity_reevaluate,"function");
  const previous = process.env.SALES_INTELLIGENCE_ENABLED;
  process.env.SALES_INTELLIGENCE_ENABLED = "false";
  try { assert.deepEqual(await runRepIdentityReevaluationJob(), { status:"disabled" }); }
  finally { if (previous === undefined) delete process.env.SALES_INTELLIGENCE_ENABLED; else process.env.SALES_INTELLIGENCE_ENABLED=previous; }
});
