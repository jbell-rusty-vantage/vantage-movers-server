import assert from "node:assert/strict";
import { test } from "node:test";
import { sameCallSummaryContribution, summarizeCalls, hasInitializedCallSummary, type SummaryContributionRow } from "./callSummary";

const row = (patch: Partial<SummaryContributionRow> = {}): SummaryContributionRow => ({
  _id: "000000000000000000000001", contact_number_id: "000000000000000000000010",
  direction: "Inbound", started_at: new Date("2026-11-01T10:00:00Z"), terminal: true,
  call_log_state: "settled", provider_connected: false, provider_result: "Missed",
  contact_type: "unknown", duration_seconds: 0,
  parties: [{ role: "user", connected: false, extension_id: "rep-1" }], ...patch,
});

test("summary contribution ignores metadata only when exact summary semantics stay equal", () => {
  const before = row();
  const variants = [
    row({ provider_result: "No Answer" }),
    row({ call_log_state: null }),
    row({ parties: [...before.parties!, { role: "external", connected: true, extension_id: "irrelevant" }] }),
  ];
  const histories = [[], [row({ _id: "000000000000000000000002", started_at: new Date("2026-11-01T09:00:00Z") })],
    [row({ _id: "000000000000000000000003", direction: "Outbound", started_at: new Date("2026-11-01T11:00:00Z") })]];
  for (const after of variants) {
    assert.equal(sameCallSummaryContribution(before, after), true);
    for (const history of histories) assert.deepEqual(summarizeCalls([...history, before]), summarizeCalls([...history, after]));
  }
});

test("summary contribution detects all reporting inputs and membership changes", () => {
  const before = row();
  const changes: Partial<SummaryContributionRow>[] = [
    { _id: "000000000000000000000002" }, { contact_number_id: "other-number" },
    { direction: "Outbound" }, { direction: "Internal" }, { started_at: new Date("2026-11-01T09:00:00Z") },
    { provider_connected: true }, { contact_type: "voicemail" }, { provider_result: "Voicemail" },
    { duration_seconds: 1 }, { duration_seconds: null },
    { parties: [{ role: "user", connected: true, extension_id: "rep-2" }] },
    { terminal: false }, { call_log_state: "provisional" }, { purged_at: new Date() }, { merged_into_id: "winner" },
  ];
  for (const change of changes) assert.equal(sameCallSummaryContribution(before, row(change)), false, JSON.stringify(change));
});

test("settlement and chosen user attribution invalidate a previously equal contribution", () => {
  assert.equal(sameCallSummaryContribution(row({ terminal: false }), row({ call_log_state: "provisional" })), true);
  assert.equal(sameCallSummaryContribution(row({ call_log_state: "provisional" }), row()), false);
  const parties = [{ role: "user", connected: false, extension_id: "rep-1" }, { role: "user", connected: false, extension_id: "rep-2" }];
  assert.equal(sameCallSummaryContribution(row({ parties }), row({ parties: [parties[0]!, { ...parties[1]!, connected: true }] })), false);
  assert.equal(sameCallSummaryContribution(row({ parties }), row({ parties: [...parties].reverse() })), false);
});


test("summary initialization refuses absent persisted fields and legacy markers", () => {
  const valid = { summary_version: 1, calls: { inbound: 0, outbound: 0, missed: 0 }, last_call: null,
    last_inbound_at: null, last_outbound_at: null, waiting_since: null };
  assert.equal(hasInitializedCallSummary(valid), true);
  for (const key of Object.keys(valid)) {
    const missing: Record<string, unknown> = { ...valid };
    delete missing[key];
    assert.equal(hasInitializedCallSummary(missing), false, key);
  }
  assert.equal(hasInitializedCallSummary({ ...valid, calls: { inbound: 1, outbound: 0, missed: 0 } }), false);
  assert.equal(hasInitializedCallSummary({ ...valid, calls: { inbound: NaN, outbound: 0, missed: 0 } }), false);
});


test("summary initialization requires complete valid nested last-call fields", () => {
  const last = { interaction_id: "000000000000000000000001", at: new Date("2026-11-01T10:00:00Z"),
    direction: "inbound", result: "answered", duration_seconds: 95, rc_extension_id: "rep-1" };
  const stored = { summary_version: 1, calls: { inbound: 1, outbound: 0, missed: 0 }, last_call: last,
    last_inbound_at: last.at, last_outbound_at: null, waiting_since: null };
  assert.equal(hasInitializedCallSummary(stored), true);
  for (const key of ["duration_seconds", "rc_extension_id"]) {
    const partial: Record<string, unknown> = { ...last };
    delete partial[key];
    assert.equal(hasInitializedCallSummary({ ...stored, last_call: partial }), false, key);
  }
  for (const duration_seconds of [undefined, -1, NaN, Infinity, "95"])
    assert.equal(hasInitializedCallSummary({ ...stored, last_call: { ...last, duration_seconds } }), false);
  for (const rc_extension_id of [undefined, 123, {}, []])
    assert.equal(hasInitializedCallSummary({ ...stored, last_call: { ...last, rc_extension_id } }), false);
  assert.equal(hasInitializedCallSummary({ ...stored, last_call: { ...last, duration_seconds: null, rc_extension_id: null } }), true);
  assert.equal(hasInitializedCallSummary({ ...stored, last_call: { ...last, duration_seconds: 0, rc_extension_id: "" } }), true);
});
