import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultCsiPolicy } from "../policy";
import { buildLedger, followupChain, type LedgerInput } from "./commitments";
import { assignTiers, digestOutcome, saidOrder } from "./digest";
import { finding, followup, promise, summary, fact } from "./fixtures/sources";
import type { StoryEvent } from "../story/types";

/** §4.7 ledger statuses (strongest first, linked through records only) and §4.6 tiers. Fixed clock. */
const policy = defaultCsiPolicy();
const staffing = { timezone: policy.timezone, staffed_hours: policy.staffed_hours };
const AS_OF = "2026-09-23T20:10:00.000Z";
const hex = (n: number) => `6c00000000000000000${String(n).padStart(5, "0")}`;
const call = (c: number, said = [promise("Rep promised to call back Monday after 5 PM.", 4)]) =>
  ({ conversation_id: hex(20 + c), c, started_at: `2026-09-1${7 + c}T14:04:00.000Z`, summary: summary("Overview.", {}, said) });
const input = (over: Partial<LedgerInput> = {}): LedgerInput => ({ calls: [call(0)], findings: [], followups: [], events: [], as_of: AS_OF, staffing,
  followupLabel: id => `F-${Number(id.slice(-3)) - 30}`, ...over });
const status = (ledger: ReturnType<typeof buildLedger>) => ledger.lines.map(l => l.text.split(" → ").slice(1).join(" → "));

test("an unlinked claim is only ever 'no record it was done' or 'pending' — free text never links", () => {
  const ledger = buildLedger(input({ followups: [followup(31, { description: "Rep promised to call back Monday after 5 PM." })] }));
  assert.deepEqual(status(ledger).slice(0, 1), ["no record it was done"], "same words, no link");
  assert.match(ledger.lines[1]!.text, /^K2 rep promise follow-up: call "Rep promised to call back Monday after 5 PM\."/, "the follow-up is its own commitment");
  const recent = buildLedger(input({ calls: [{ ...call(0), started_at: "2026-09-23T14:04:00.000Z" }] }));
  assert.match(status(recent)[0]!, /^pending \(undated; grace until Fri Sep 25, 2026 10:04 AM ET\)$/, "two staffed days of grace");
});

test("linked through the finding (same conversation, kind, overlapping segments): kept, open, not reached, superseded", () => {
  const linked = (over: Parameters<typeof followup>[1]) => input({ findings: [finding(41, 20, "promised_callback", "call back", [4])], followups: [followup(31, { source_finding_ids: [hex(41)], ...over })] });
  const completed: StoryEvent = { id: `followup_completed:${hex(31)}`, kind: "followup_completed", happened_at: "2026-09-21T21:10:00.000Z", observed_at: "2026-09-21T21:10:00.000Z",
    subject_key: "number:x", actor: { kind: "vantage", agent_id: null, name: null, identity_status: null }, record: { record_type: "story_event", record_id: "x" }, sentence: "",
    detail: { followup_id: hex(31) }, evidence_refs: [] };
  assert.deepEqual(status(buildLedger({ ...linked({ status: "completed", disposition: "spoke_with_customer", completion_basis: "call_attempt", completed_at: "2026-09-21T21:10:00.000Z" }), events: [completed] })), ["kept at T0"]);
  assert.deepEqual(status(buildLedger(linked({}))), ["open (F-1, due Mon Sep 21, 2026 5:00 PM ET, overdue 2 days)"]);
  assert.deepEqual(status(buildLedger(linked({ status: "completed", disposition: "no_answer", completion_basis: "call_attempt" }))), ["attempted, not reached (1 attempt)"]);
  const superseded = input({ calls: [call(0), call(1, [])], findings: [finding(41, 20, "promised_callback", "call back", [4], { superseded_by: hex(42) }), finding(42, 21, "promised_callback", "later", [2])] });
  assert.deepEqual(status(buildLedger(superseded)), ["superseded by C1"]);
  const otherSegment = input({ findings: [finding(41, 20, "promised_callback", "call back", [9])], followups: [followup(31, { source_finding_ids: [hex(41)] })] });
  assert.equal(status(buildLedger(otherSegment))[0], "no record it was done", "a finding on other segments is not this claim");
});

test("retry chains: an open retry after unreached attempts is 'attempted, not reached' with the retry; the chain is followed by key", () => {
  const root = followup(31, { source_finding_ids: [hex(41)], status: "completed", disposition: "no_answer", created_at: "2026-09-17T14:30:00.000Z" });
  const retry = followup(32, { origin: "system_default", commitment_key: `retry:${hex(31)}:1`, due_at: "2026-09-22T15:00:00.000Z", created_at: "2026-09-21T21:05:00.000Z" });
  assert.deepEqual(followupChain(root, [root, retry]).map(f => f.id), [hex(31), hex(32)]);
  const ledger = buildLedger(input({ findings: [finding(41, 20, "promised_callback", "call back", [4])], followups: [root, retry] }));
  assert.deepEqual(status(ledger), ["attempted, not reached (1 attempt; retry F-2 due Tue Sep 22, 2026 11:00 AM ET, overdue 1 day)"]);
  assert.equal(ledger.lines.length, 1, "the system_default retry is part of the chain, not its own commitment");
});

test("the ledger is bounded at 40, newest kept; claims carry their K tag for digests", () => {
  const many = Array.from({ length: 45 }, (_, i) => ({ ...call(0, [promise(`Promise ${i}`, 4)]), conversation_id: hex(100 + i), c: i, started_at: new Date(Date.parse("2026-08-01T12:00:00.000Z") + i * 3_600_000).toISOString() }));
  const ledger = buildLedger(input({ calls: many }));
  assert.equal(ledger.lines.length, 40);
  assert.equal(ledger.omitted, 5);
  assert.match(ledger.lines[0]!.text, /^K1 rep promised "Promise 5"/);
  assert.equal(ledger.claims.get(`${hex(144)}:0`)?.tag, "K40 → no record");
});

test("tiers: focus and the three newest others are full; the rest digest; SAID puts commitments, money, objections first", () => {
  const tiers = assignTiers(["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"].map((d, i) => ({ conversation_id: `c${i}`, started_at: `${d}T12:00:00.000Z`, focus: i === 0 })));
  assert.deepEqual([...tiers.entries()].sort(), [["c0", { tier: "full", full_rank: null }], ["c1", { tier: "digest", full_rank: null }], ["c2", { tier: "full", full_rank: 2 }],
    ["c3", { tier: "full", full_rank: 1 }], ["c4", { tier: "full", full_rank: 0 }]]);
  const s = summary("x", {}, [{ ...fact("intent", 1), kind: "intent", value: { intent: "moving_inquiry" } } as never, promise("call", 2), fact("too pricey", 3)]);
  assert.deepEqual(saidOrder(s), [1, 2, 0]);
  assert.equal(digestOutcome(summary("x", { outcome: "o", commitments: "c" }), ["K1 → open F-0"]), "o | commitments: c [K1 → open F-0]");
  assert.equal(digestOutcome(summary("x"), []), null);
});
