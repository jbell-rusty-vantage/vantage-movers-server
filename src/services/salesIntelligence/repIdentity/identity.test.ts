import assert from "node:assert/strict";
import { test } from "node:test";
import { proposeRepCandidates } from "./propose";
import { attachedAgentForUser, collectDirectoryUsers, repProposalDtoSchema } from "./reads";
import { resolveRepIdentityAt, type TemporalRepLink } from "./resolve";
import { csiRepInputSchema } from "../../../validation/v1/salesIntelligence";
import { defaultStageHandlers } from "../../numberActivity/jobDispatch";
import { runRepIdentityReevaluationJob } from "./worker";

const agents = [{ _id: "a", name: "Alex Reed", name_aliases: ["Alex R"] }, { _id: "b", name: "Jordan Lee", name_aliases: ["Alex R"] }];
test("directory User DTO carries snapshot destination facts without inventing a person id", () => {
  const parsed = repProposalDtoSchema.parse({
    extension_id: "102", extension_name: "Joshua L", status: "unmatched", candidates: [],
    extension_number: "102", direct_numbers: ["+12025550188"], directory_status: "Enabled",
    rc_account_id: "account-a", attached_agent: { id: "a".repeat(24), name: "Joshua L" },
  });
  assert.equal(parsed.extension_number, "102");
  assert.deepEqual(parsed.direct_numbers, ["+12025550188"]);
  assert.equal(parsed.rc_account_id, "account-a");
  assert.equal(parsed.attached_agent?.name, "Joshua L");
  assert.equal("rc_team_messaging_person_id" in parsed, false);
});
test("directory page omits the owner sender extension and keeps other Users", () => {
  const { page, next_cursor } = collectDirectoryUsers([
    { rc_account_id: "a", snapshot: { extensions: [
      { id: "100", type: "User", name: "Owner" },
      { id: "101", type: "User", name: "Russell" },
      { id: "1", type: "Department" },
    ] } },
  ], undefined, 50, ["100"]);
  assert.deepEqual(page.map(user => `${user.rc_account_id}:${user.id}`), ["a:101"]);
  assert.equal(next_cursor, null);
});
test("directory page lists Users across stored accounts without an Owner-typed account id", () => {
  const { page, next_cursor } = collectDirectoryUsers([
    { rc_account_id: "b", snapshot: { extensions: [{ id: "220", type: "User", name: "Joshua" }, { id: "1", type: "Department" }] } },
    { rc_account_id: "a", snapshot: { extensions: [{ id: "101", type: "User", name: "Russell" }, { id: "102", type: "User", name: "Casey" }] } },
  ], undefined, 2);
  assert.deepEqual(page.map(user => `${user.rc_account_id}:${user.id}`), ["a:101", "a:102"]);
  assert.equal(next_cursor, "a:102");
  const next = collectDirectoryUsers([
    { rc_account_id: "a", snapshot: { extensions: [{ id: "101", type: "User" }, { id: "102", type: "User" }] } },
    { rc_account_id: "b", snapshot: { extensions: [{ id: "220", type: "User" }] } },
  ], "a:102", 10);
  assert.deepEqual(next.page.map(user => user.id), ["220"]);
  assert.equal(next.next_cursor, null);
  assert.deepEqual(attachedAgentForUser([
    { rc_account_id: "a", rc_extension_id: "101", status: "reviewed", effective_to: null, agent_id: "agent-1", agent_name_snapshot: "Russell I" },
    { rc_account_id: "a", rc_extension_id: "101", status: "proposed", effective_to: null, agent_id: "agent-2", agent_name_snapshot: "Other" },
  ], "a", "101"), { id: "agent-1", name: "Russell I" });
  assert.equal(attachedAgentForUser([
    { rc_account_id: "a", rc_extension_id: "101", status: "reviewed", effective_to: new Date("2026-01-01"), agent_id: "agent-1", agent_name_snapshot: "Russell I" },
  ], "a", "101"), null);
});
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
