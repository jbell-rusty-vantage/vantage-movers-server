import assert from "node:assert/strict";
import test from "node:test";
import { allocateCents, normalizeExact, parseAgentNames, parseCustomerName, parseMoneyToCents } from "./normalization";
import { googleSerialToEastern, parseEasternDate } from "./dateParsing";

test("exact normalization applies NFKC, whitespace collapse, and case folding", () => {
  assert.equal(normalizeExact("  Ｊane\t DOE  "), "jane doe");
});

test("agent parsing removes terminal metadata and preserves slash order", () => {
  const parsed = parseAgentNames(" Nick / Mike / Nick 40% ");
  assert.equal(parsed.disposition, "accepted");
  assert.deepEqual(parsed.tokens, ["Nick", "Mike"]);
  assert.deepEqual(parsed.normalized_tokens, ["nick", "mike"]);
  assert.equal(parsed.metadata.terminal_percentage, "40%");
});

test("agent parsing rejects repeated and unrecognized separators", () => {
  assert.equal(parseAgentNames("Nick // Mike").disposition, "ambiguous");
  assert.equal(parseAgentNames("Nick & Mike").disposition, "ambiguous");
  assert.equal(parseAgentNames("Nick Split / Mike").disposition, "ambiguous");
});

test("customer parsing preserves compound display text as one customer", () => {
  const parsed = parseCustomerName(" Jane / John & Co. ");
  assert.equal(parsed.disposition, "accepted");
  assert.equal(parsed.display_value, "Jane / John & Co.");
  assert.deepEqual(parsed.tokens, ["Jane / John & Co."]);
});

test("money parser uses cents and rejects blank, negative, and over-precision", () => {
  assert.deepEqual(parseMoneyToCents("$1,234.50"), { disposition: "accepted", value: 123450, reason_codes: [] });
  assert.equal(parseMoneyToCents("").disposition, "empty");
  assert.equal(parseMoneyToCents("-1").disposition, "invalid");
  assert.equal(parseMoneyToCents("1.001").disposition, "invalid");
  assert.equal(parseMoneyToCents(Number.POSITIVE_INFINITY).disposition, "invalid");
});

test("integer-cent allocations are exact for one, two, and three agents", () => {
  assert.deepEqual(allocateCents(101, ["a"]), [{ agent_id: "a", cents: 101 }]);
  assert.deepEqual(allocateCents(101, ["a", "b"]), [{ agent_id: "a", cents: 51 }, { agent_id: "b", cents: 50 }]);
  assert.deepEqual(allocateCents(100, ["a", "b", "c"]), [{ agent_id: "a", cents: 34 }, { agent_id: "b", cents: 33 }, { agent_id: "c", cents: 33 }]);
  assert.equal(allocateCents(100, ["a", "b", "c"]).reduce((sum, entry) => sum + entry.cents, 0), 100);
  assert.throws(() => allocateCents(-1, ["a"]));
});

test("Eastern parser handles DST and the reviewed malformed-year correction", () => {
  assert.equal(parseEasternDate("3/8/2026 2:30 AM").disposition, "invalid");
  assert.deepEqual(parseEasternDate("11/1/2026 1:30 AM"), { disposition: "accepted", value: "2026-11-01T06:30:00.000Z", reason_codes: [] });
  assert.deepEqual(parseEasternDate("7/20/0205", { allow_known_0205_correction: true }), { disposition: "accepted", value: "2025-07-20T04:00:00.000Z", reason_codes: ["corrected_7_20_0205_to_2025_07_20"] });
  assert.equal(parseEasternDate("7/20/0205").disposition, "invalid");
});

test("Google serial dates are interpreted as Eastern wall-clock values", () => {
  const parsed = googleSerialToEastern(46_000);
  assert.equal(parsed.disposition, "accepted");
});
