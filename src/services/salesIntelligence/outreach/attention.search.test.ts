import assert from "node:assert/strict";
import { test } from "node:test";
import { attentionCursorDigest, attentionQuerySchema, attentionSearchKeys, parseAttentionSearch, rowMatchesAttentionQuery, rowSearchKeys, searchKeysMatch } from "./attention";
import { closedHistoryDigest, closedHistoryQuerySchema } from "./closedHistory";

/** S11-SEARCH (UX22): the `q` matcher, its parsing and its cursor binding. */
const parse = (input: Record<string, unknown>) => attentionQuerySchema.parse(input);
const keys = attentionSearchKeys({ name: "Maria  del Carmen Ruiz", job_no: "VM-104233", e164: "+15550104477" });
const matches = (q: string) => searchKeysMatch(keys, parseAttentionSearch(parse({ q }).q));

test("q parsing: trimmed, whitespace collapsed, lower-cased; empty is no search", () => {
  assert.equal(parse({ q: "  Maria   DEL " }).q, "maria del");
  assert.equal(parse({ q: "" }).q, undefined);
  assert.equal(parse({ q: "   " }).q, undefined);
  assert.equal(parse({}).q, undefined);
  assert.throws(() => parse({ q: "x".repeat(101) }), "q is at most 100 characters");
  assert.throws(() => parse({ q: ["a", "b"] }), "one q only");
  assert.deepEqual(parseAttentionSearch("(555) 010-4477"), { text: "(555) 010-4477", digits: "5550104477" });
  assert.deepEqual(parseAttentionSearch("104"), { text: "104", digits: null }, "under 4 digits: no phone match");
  assert.equal(parseAttentionSearch(undefined), null);
});

test("name: case-insensitive substring", () => {
  assert.equal(matches("maria"), true);
  assert.equal(matches("DEL CARMEN"), true);
  assert.equal(matches("del  carmen"), true, "the stored name's double space is collapsed too");
  assert.equal(matches("ruiz"), true);
  assert.equal(matches("carmen maria"), false);
});

test("Job number: exact or prefix, never an inner substring", () => {
  assert.equal(matches("VM-104233"), true);
  assert.equal(matches("vm-104"), true);
  assert.equal(matches("vm"), true);
  assert.equal(matches("104233"), false, "inner substring of the Job number (and only 6 digits that aren't in the phone)");
});

test("phone: 4+ digits are a digit substring of the e164; 3 digits are ignored", () => {
  assert.equal(matches("4477"), true);
  assert.equal(matches("555-010-4477"), true);
  assert.equal(matches("+1 (555) 010 4477"), true);
  assert.equal(matches("0104"), true);
  assert.equal(matches("447"), false, "3 digits never match the phone");
  assert.equal(matches("9999"), false);
  // Under 4 digits the name and Job number still match.
  const job = attentionSearchKeys({ name: null, job_no: "123-A", e164: "+15551230000" });
  assert.equal(searchKeysMatch(job, parseAttentionSearch("123")), true, "3 digits still match a Job number prefix");
  const phoneOnly = attentionSearchKeys({ name: null, job_no: null, e164: "+15551230000" });
  assert.equal(searchKeysMatch(phoneOnly, parseAttentionSearch("123")), false);
  assert.equal(searchKeysMatch(phoneOnly, parseAttentionSearch("1230")), true);
  assert.equal(searchKeysMatch(null, parseAttentionSearch("maria")), false, "a row without keys (review-only) never matches a search");
  assert.equal(searchKeysMatch(null, null), true, "no search matches everything");
});

test("rowMatchesAttentionQuery: q is combined with the view (closed included) and the other filters", () => {
  const row = (partition: "active" | "closed", over: Record<string, unknown> = {}) => ({ subject_key: `lead:FormLead:${partition}`, partition, in_attention: partition === "active",
    derived: { attention_band: partition === "active" ? 2 : null, review_badges: [] as string[], reasons: [] as string[] },
    outreach: { state: partition === "closed" ? "closed" : "open", assignment: { agent: null }, followups: [], lead_display: { name: "Maria Ruiz", job_no: "VM-104233", source_company: null },
      primary_number: { id: "n", e164: "+15550104477" }, ...over } }) as unknown as Parameters<typeof rowMatchesAttentionQuery>[0];
  const closed = row("closed"), active = row("active");
  assert.equal(rowMatchesAttentionQuery(closed, parse({ view: "closed", q: "ruiz" })), true);
  assert.equal(rowMatchesAttentionQuery(closed, parse({ view: "closed", q: "smith" })), false);
  assert.equal(rowMatchesAttentionQuery(active, parse({ view: "closed", q: "ruiz" })), false, "the view still decides the partition");
  assert.equal(rowMatchesAttentionQuery(active, parse({ q: "4477" })), true);
  assert.equal(rowMatchesAttentionQuery(active, parse({ q: "4477", band: "1" })), false, "q never widens another filter");
  assert.equal(rowMatchesAttentionQuery(active, parse({ view: "all_outreach", q: "vm-10" })), true);
  const numberOnly = row("active", { lead_display: null });
  assert.equal(rowMatchesAttentionQuery(numberOnly, parse({ q: "ruiz" })), false);
  assert.equal(rowMatchesAttentionQuery(numberOnly, parse({ q: "0104477" })), true, "a Number-only row is found by its phone");
  assert.deepEqual(rowSearchKeys({ outreach: null }), { name: null, job_no: null, digits: null });
});

test("cursor: q is part of the digest; its spelling isn't; no q hashes exactly as before", () => {
  const digest = (input: Record<string, unknown>) => {
    const { cursor: _c, limit: _l, direction, ...rest } = parse(input);
    return attentionCursorDigest({ ...rest, direction: direction ?? "asc" });
  };
  assert.notEqual(digest({ q: "ruiz" }), digest({}), "a cursor from a different q is rejected");
  assert.notEqual(digest({ q: "ruiz" }), digest({ q: "maria" }));
  assert.equal(digest({ q: "  RUIZ " }), digest({ q: "ruiz" }));
  assert.equal(digest({ q: "" }), digest({}), "an empty q is no q (and doesn't throw on the undefined key)");
  assert.equal(digest({ band: "" }), digest({}), "an empty filter no longer throws in the digest either");
  assert.notEqual(digest({ view: "closed", q: "ruiz" }), digest({ view: "closed" }));
  const history = (input: Record<string, unknown>) => { const { cursor: _c, limit: _l, ...filters } = closedHistoryQuerySchema.parse(input); return closedHistoryDigest(filters, null); };
  assert.notEqual(history({ q: "ruiz" }), history({}));
  assert.equal(history({ q: " Ruiz" }), history({ q: "ruiz" }));
  assert.equal(history({ q: "" }), history({}));
});
