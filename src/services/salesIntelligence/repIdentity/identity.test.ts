import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveRepIdentityAt, type TemporalRepLink } from "./resolve";
import { defaultStageHandlers } from "../../numberActivity/jobDispatch";
import { CSI_RETIRED_JOB_STAGES } from "../../../config/domain/salesIntelligence";

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
test("identity re-evaluation is a retired stage: no consumer, and old rows are terminalized by the fence", () => {
  // Call attribution resolves the Rep Identity Link effective at the call, at read time, so a review needs no job.
  assert.equal("rep_identity_reevaluate" in defaultStageHandlers(), false);
  assert.ok((CSI_RETIRED_JOB_STAGES as readonly string[]).includes("rep_identity_reevaluate"));
});
