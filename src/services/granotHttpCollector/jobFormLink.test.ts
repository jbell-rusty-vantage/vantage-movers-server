import assert from "node:assert/strict";
import { test } from "node:test";
import { GranotJobLinkError, isGranotJobFormUrl, searchGranotJobForm, verifiedJobLinkFromPage } from "./jobFormLink";
import type { GranotSessionRequest } from "./index";

const path = "/wc.dll?mpcharge~chargeswc~11111111-2222-4333-8444-555555555555";
const page = (job: string) => `<table><tr><td>Job No:</td><td><span>P</span>${job}</td></tr></table><script>location.href='${path}';</script>`;
test("only the observed form URL and equivalent visible Job Number qualify", () => {
  assert.equal(verifiedJobLinkFromPage(page("5566822"), "5566822")?.job_no, "P5566822");
  assert.equal(verifiedJobLinkFromPage(page("5566822"), "P5566823"), null);
  assert.equal(verifiedJobLinkFromPage("<h1>User Login</h1>", "5566822"), null);
  assert.equal(verifiedJobLinkFromPage(page("5566822") + `<script>const x='${path.replace("11111111", "aaaaaaaa")}'</script>`, "5566822"), null);
  for (const suffix of ["#x", "&next=evil", "/", "~extra"]) assert.equal(isGranotJobFormUrl(`https://eagle.hellomoving.com${path}${suffix}`), false);
  assert.equal(isGranotJobFormUrl(`https://evil.example${path}`), false);
});
test("search performs no job mutations and tries History only when no form returned", async () => {
  const calls: Array<{ path: string; body: string }> = [];
  const request: GranotSessionRequest = async (url, init) => {
    calls.push({ path: url, body: init?.body?.toString() ?? "" });
    return init?.body?.has("HISTORY") ? page("5566822") : "<p>No results</p>";
  };
  assert.equal((await searchGranotJobForm(request, "synthetic-session", "5566822")).job_no, "P5566822");
  assert.deepEqual(calls.map(c => c.path.split("~")[1]), ["searchwc", "searchret", "searchret"]);
  assert.equal(calls[2]!.body, "ORDNO=5566822&HISTORY=ON");
  await assert.rejects(searchGranotJobForm(async () => page("9999"), "s", "5566822"), (error: unknown) => error instanceof GranotJobLinkError && error.reason === "unverified");
});
