/** CSI-16 read-only local certification. No .env, providers, production or fixture edits. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultCsiPolicy } from "../src/services/salesIntelligence/policy";
import { addStaffedMinutes } from "../src/services/salesIntelligence/outreach/staffing";

async function main() {
  const local = JSON.parse(await readFile(join(tmpdir(), "vantage-csi07-local/session.json"), "utf8"));
  assert.equal(local.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  assert.equal(local.env.TEST_MONGO_DATABASE_NAME, "testvantagemovers_csi07preview");
  assert.equal(local.env.TEST_MODE, "true");
  assert.equal(local.env.VANTAGE_API_BASE_URL, "http://127.0.0.1:3107");
  const start = new Date("2026-09-19T19:50:00-04:00");
  const policy = defaultCsiPolicy();
  const first = addStaffedMinutes(start, 30, policy).toISOString();
  const missed = addStaffedMinutes(start, 15, policy).toISOString();
  assert.equal(first, "2026-09-21T12:20:00.000Z");
  assert.equal(missed, "2026-09-21T12:05:00.000Z");
  const base = "http://127.0.0.1:3108";
  const login = await fetch(base + "/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "owner@csi07.example.test", password: local.password }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const prefix = "/api/proxy/api/v1/admin/sales-intelligence";
  const get = async (suffix: string) => {
    const response = await fetch(base + prefix + suffix, { headers: { cookie } });
    return { status: response.status, body: await response.json() };
  };
  const coverage = await get("/coverage?scope=production");
  assert.equal(coverage.status, 200);
  const value = coverage.body.data.coverage;
  assert.equal(value.backfill.available, false); // Day count zero disables executable planning.
  assert.equal(value.backfill.days, 0);
  assert.equal(value.backfill.planned, null);
  assert.ok(Array.isArray(value.backfill.gaps));
  const scopes = [];
  for (const scope of ["historical", "combined"]) {
    const result = await get("/coverage?scope=" + scope);
    assert.equal(result.status, 403);
    scopes.push({ scope, status: result.status });
  }
  const lead = await get("/outreach/by-lead/FormLead/000000000000000000001006?scope=production");
  assert.equal(lead.status, 200);
  const named = [];
  for (const id of ["6a761d3d7ceae445794c57bd", "6aaaf552ca2df3ab6f396b5d"]) {
    const result = await get(`/outreach/by-lead/CallLead/${id}?scope=production`);
    // Named production subjects must not be imported to make a preview test pass.
    assert.equal(result.status, 404);
    named.push({ lead_id: id, preview_status: result.status, result: "not seeded in isolated preview" });
  }
  const proof = {
    at: new Date().toISOString(), environment: "loopback csi01; guarded CSI07 preview databases",
    clocks: { saturday: start.toISOString(), first_action: first, missed_callback: missed },
    coverage: { backfill: value.backfill }, scopes, synthetic_lead_entry_status: lead.status,
    named_subject_reads: named,
    limitations: ["No production capability probe", "No audio or model invocation", "Clocks use accepted defaults; preview retains Owner-edited first-action setting"],
  };
  await writeFile("docs/call-sales-intelligence/workspace/evidence/csi-16/local-http.json", JSON.stringify(proof, null, 2) + "\n");
  console.log("PASS CSI-16 accepted Saturday clocks, current Coverage contract, scope denial, synthetic Lead entry and named-subject preview absence.");
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "CSI-16 local certification failed");
  process.exitCode = 1;
});
