import assert from "node:assert/strict";
import { test } from "node:test";
import { openGranotNetworkSession, type GranotSessionRequest } from "./index";
import { GranotSessionJobLinkError, searchGranotJobInUserSession } from "./sessionJobLink";

const context = "11111111-2222-3333-4444-555555555555";
const resultContext = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const jobPage = (job = "P5550001") => `<table><tr><td>Job No:</td><td>${job}</td></tr></table><a href="/wc.dll?mpcharge~chargeswc~${resultContext}">Job</a>`;
const isFailure = (reason: string) => (error: unknown) => error instanceof GranotSessionJobLinkError && error.reason === reason;

test("network-only authentication stops before the user login and retains its transport cookies", async () => {
  const requests: { url: string; body: string; cookie: string | null }[] = [];
  const responses = [new Response('<form action="/network"><input name="SAVEPASS" value="1"></form>', { headers: { "Set-Cookie": "network=initial; Path=/" } }), new Response('<form action="/wc.dll?mp~loginret~network-context~login"></form>', { headers: { "Set-Cookie": "network=accepted; Path=/" } }), new Response("Logged in as JOSH")];
  const session = await openGranotNetworkSession({ networkUsername: "company", networkPassword: "network-password" }, { fetch: async (input, init) => {
    requests.push({ url: String(input), body: init?.body?.toString() ?? "", cookie: new Headers(init?.headers).get("Cookie") });
    const response = responses.shift(); assert.ok(response); return response;
  } });
  assert.equal(requests.length, 2);
  assert.equal(new URLSearchParams(requests[1]!.body).get("LOGON_USER"), "company");
  assert.equal(new URLSearchParams(requests[1]!.body).has("SAVEPASS"), false);
  await session.request(`/wc.dll?mv~mainmenuwc~${context}~LOGIN`);
  assert.equal(requests[2]?.cookie, "network=accepted");
  assert.ok(requests.every(request => !request.url.includes("~loginret~") && !new URLSearchParams(request.body).has("USERNAME")));
});

test("the rep's username is checked before search; the returned job context is never reopened as a menu", async () => {
  const calls: { path: string; body: string }[] = [];
  const request: GranotSessionRequest = async (path, init) => { calls.push({ path, body: init?.body?.toString() ?? "" }); return calls.length === 1 ? '<p>Logged in as <font>JOSH</font> (Dept P)</p>' : jobPage(); };
  const result = await searchGranotJobInUserSession(request, context, "5550001", "josh");
  assert.equal(result.url, `https://eagle.hellomoving.com/wc.dll?mpcharge~chargeswc~${resultContext}`);
  assert.deepEqual(calls, [{ path: `/wc.dll?mv~mainmenuwc~${context}~LOGIN`, body: "" }, { path: `/wc.dll?mv~searchret~${context}~QSEARCH`, body: "VALUE=5550001&B5=Search" }]);
});

test("an agent-account or expired context is rejected before any job lookup", async () => {
  for (const [page, reason] of [['Logged in as AUTOMATION (Dept P)', 'account_mismatch'], ['<body onload="window.close()"></body>', 'session_expired']]) {
    let calls = 0;
    await assert.rejects(searchGranotJobInUserSession(async () => { calls++; return page!; }, context, "P5550001", "JOSH"), isFailure(reason!));
    assert.equal(calls, 1);
  }
});

test("a mismatched or ambiguous job never becomes a navigation link", async () => {
  let calls = 0;
  await assert.rejects(searchGranotJobInUserSession(async () => ++calls === 1 ? 'Logged in as JOSH' : jobPage("P5550002"), context, "P5550001", "JOSH"), isFailure("unverified"));
  await assert.rejects(searchGranotJobInUserSession(async () => { throw new Error("unexpected I/O"); }, "invalid", "P5550001", "JOSH"), isFailure("session_expired"));
});
