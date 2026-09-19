import assert from "node:assert/strict";
import test from "node:test";
import { createScopedRingCentralGet, projectScopedJobTimeline, readOperationalRecords } from "./operational";
import { OPERATIONAL_DATASETS, type IntelligenceRead, type ReadScope } from "./contracts";

const scope: ReadScope = {run_id: "aaaaaaaaaaaaaaaaaaaaaaaa", subject_key: "number:bbbbbbbbbbbbbbbbbbbbbbbb", contact_number_id: "bbbbbbbbbbbbbbbbbbbbbbbb", conversation_id: null, outreach_record_id: null, account_id: "synthetic-account", e164: "+12025550101", lead_refs: []};
const search = {tool: "search_ringcentral_calls" as const, args: {from: "2026-09-01T00:00:00.000Z", to: "2026-09-02T00:00:00.000Z", limit: 2}};
const call = (id = "call-1", phone = scope.e164) => ({id, from: {phoneNumber: phone, name: "private provider name"}, to: {phoneNumber: "+12025550102"}, startTime: "2026-09-01T12:00:00Z", direction: "Inbound", duration: 25, result: "Accepted", recording: {contentUri: "https://private.invalid/audio"}, access_token: "never-return"});

test("RingCentral search derives account/phone, bounds pages and excludes unrelated/provider-private content", async () => {
  const paths: string[] = [];
  const first = await readOperationalRecords(scope, search, {providerEnabled: true, providerGet: async path => {paths.push(path); return {records: [call(), call("foreign", "+12025550103")], paging: {page: 1, totalPages: 2}};}});
  const url = new URL(paths[0]!, "https://platform.ringcentral.com");
  assert.equal(url.pathname, "/restapi/v1.0/account/synthetic-account/call-log");
  assert.equal(url.searchParams.get("phoneNumber"), scope.e164);
  assert.equal(url.searchParams.get("perPage"), "2");
  assert.equal(first.records.length, 1); assert.equal(first.complete, false); assert.ok(first.next_cursor);
  const serialized = JSON.stringify(first);
  for (const forbidden of ["private.invalid", "access_token", "never-return", "private provider name"]) assert.equal(serialized.includes(forbidden), false);
  const second = await readOperationalRecords(scope, {...search, args: {...search.args, cursor: first.next_cursor!}}, {providerEnabled: true, providerGet: async path => { assert.equal(new URL(path, "https://platform.ringcentral.com").searchParams.get("page"), "2"); return {records: [call("call-2")], paging: {page: 2, totalPages: 2}}; }});
  assert.equal(second.complete, true); assert.equal(second.next_cursor, null);
  await assert.rejects(() => readOperationalRecords({...scope, run_id: "cccccccccccccccccccccccc"}, {...search, args: {...search.args, cursor: first.next_cursor!}}, {providerEnabled: true, providerGet: async () => {throw new Error("must not call");}}), /INVALID_INPUT/);
});

test("RingCentral reads disabled by default; invalid bounds and caller-supplied authority never reach provider", async () => {
  let calls = 0; const providerGet = async () => { calls++; return {}; };
  const disabled = await readOperationalRecords(scope, search, {providerEnabled: false, providerGet});
  assert.deepEqual(disabled.missing_ranges, ["ringcentral_provider_reads_disabled"]);
  for (const args of [{...search.args, account_id: "foreign"}, {...search.args, phone: "+12025550103"}, {...search.args, url: "https://bad.invalid"}, {...search.args, to: "2027-01-01T00:00:00.000Z"}, {...search.args, to: search.args.from}]) {
    await assert.rejects(() => readOperationalRecords(scope, {tool: "search_ringcentral_calls", args} as IntelligenceRead as Parameters<typeof readOperationalRecords>[1], {providerEnabled: true, providerGet}));
  }
  assert.equal(calls, 0);
});

test("call detail requires prior server admission and rechecks returned subject and id", async () => {
  const input = {tool: "get_ringcentral_call" as const, args: {call_log_id: "call-1"}};
  let calls = 0;
  await assert.rejects(() => readOperationalRecords(scope, input, {providerEnabled: true, admittedCall: async () => false, providerGet: async () => {calls++; return call();}}), /EVIDENCE_SCOPE_INVALID/);
  assert.equal(calls, 0);
  const result = await readOperationalRecords(scope, input, {providerEnabled: true, admittedCall: async () => true, providerGet: async () => call()});
  assert.equal(result.records[0]?.record_id, "ringcentral:synthetic-account:call-1");
  for (const raw of [call("call-1", "+12025550103"), call("different")]) await assert.rejects(() => readOperationalRecords(scope, input, {providerEnabled: true, admittedCall: async () => true, providerGet: async () => raw}), /EVIDENCE_SCOPE_INVALID/);
});

test("provider errors are coverage failures with no raw body; unknown pagination never claims complete", async () => {
  const missing = await readOperationalRecords(scope, search, {providerEnabled: true, providerGet: async () => {throw new Error("raw transcript credential value");}});
  assert.deepEqual(missing, {records: [], next_cursor: null, complete: false, missing_ranges: ["ringcentral_provider_unavailable"]});
  const unknown = await readOperationalRecords(scope, search, {providerEnabled: true, providerGet: async () => ({records: [call()]})});
  assert.equal(unknown.complete, false); assert.ok(unknown.missing_ranges.includes("provider_pagination_unknown"));
});

test("Job Timeline requires authorized resolved Lead and matching server-derived source", () => {
  const lead = {model: "FormLead" as const, id: "cccccccccccccccccccccccc"};
  const subject = {...scope, lead_refs: [lead]};
  const source = {source_company_id: null, source_company_label: null, source_granularity_id: "source-a", source_granularity_label: null};
  const page = {current: {lead_ref: lead}, source, events: [], limitations: []};
  assert.equal(projectScopedJobTimeline(subject, page, "9001001", "source-a").complete, true);
  assert.deepEqual(projectScopedJobTimeline(subject, {...page, current: {lead_ref: {...lead, id: "dddddddddddddddddddddddd"}}}, "9001001").missing_ranges, ["timeline_subject_ambiguous"]);
  assert.equal(projectScopedJobTimeline(subject, page, "9001001", "source-b").complete, false);
  assert.equal(projectScopedJobTimeline(subject, {...page, current: {}}, "9001001").complete, false);
});

test("operational dataset facilitator is closed, paginated, revision-bound, and treats query as literal data", async () => {
  const source = {records: [1, 2, 3].map(id => ({record_type: "agent" as const, record_id: String(id), revision: "v1", fields: {name: `Agent ${id}`}})), next_cursor: null, complete: true, missing_ranges: []};
  for (const dataset of OPERATIONAL_DATASETS) {
    const page = await readOperationalRecords(scope, {tool: "query_operational_records", args: {dataset, limit: 2}}, {load: async (_scope, selected) => {assert.equal(selected, dataset); return source;}});
    assert.equal(page.records.length, 2); assert.equal(page.complete, false);
    const end = await readOperationalRecords(scope, {tool: "query_operational_records", args: {dataset, limit: 2, cursor: page.next_cursor!}}, {load: async () => source});
    assert.deepEqual(end.records.map(r => r.record_id), ["3"]); assert.equal(end.complete, true);
  }
  const literal = await readOperationalRecords(scope, {tool: "query_operational_records", args: {dataset: "agents", limit: 20, query: "$where"}}, {load: async () => source});
  assert.equal(literal.records.length, 0);
  for (const args of [{dataset: "agents", limit: 20, filter: {$where: "evil"}}, {dataset: "integration_tokens", limit: 20}, {dataset: "agents", limit: 20, fields: ["password"]}]) await assert.rejects(() => readOperationalRecords(scope, {tool: "query_operational_records", args} as Parameters<typeof readOperationalRecords>[1], {load: async () => source}));
});

test("fixed provider HTTP adapter uses cached token GET only, no refresh, redirects, alternate host or unbounded body", async () => {
  let calls = 0;
  const cachedToken = async () => ({access_token: "synthetic-token", issued_at: Date.now(), access_token_expires_at: Date.now() + 120_000});
  const get = createScopedRingCentralGet({origin: "https://platform.ringcentral.com", cachedToken, fetchImpl: async (url, init) => {
    calls++; assert.equal(new URL(String(url)).hostname, "platform.ringcentral.com"); assert.equal(init?.method, "GET"); assert.equal(init?.redirect, "error"); assert.equal(init?.body, undefined);
    return Response.json({records: []});
  }});
  assert.deepEqual(await get("/restapi/v1.0/account/synthetic-account/call-log?page=1"), {records: []});
  await assert.rejects(() => get("/restapi/v1.0/account/synthetic-account/sms"));
  await assert.rejects(() => get("https://evil.invalid/"));
  assert.equal(calls, 1);
  await assert.rejects(() => createScopedRingCentralGet({origin: "https://evil.invalid", cachedToken})("/restapi/v1.0/account/a/call-log"));
  await assert.rejects(() => createScopedRingCentralGet({origin: "https://platform.ringcentral.com", cachedToken: async () => null})("/restapi/v1.0/account/a/call-log"));
  await assert.rejects(() => createScopedRingCentralGet({origin: "https://platform.ringcentral.com", cachedToken, fetchImpl: async () => new Response("x".repeat(1_000_001))})("/restapi/v1.0/account/a/call-log"));
});
