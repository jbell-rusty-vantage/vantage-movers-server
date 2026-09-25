import assert from "node:assert/strict";
import { test } from "node:test";
import { payloadHash } from "../transactions";
import { attentionQuerySchema, rowMatchesAttentionQuery } from "./attention";

const AGENT_A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const AGENT_B = "bbbbbbbbbbbbbbbbbbbbbbbb";

const parse = (input: Record<string, unknown>) => attentionQuerySchema.parse(input);

function digestOf(input: Record<string, unknown>) {
  const { cursor, limit, ...filters } = parse(input);
  void cursor;
  void limit;
  return payloadHash(filters);
}

test("attentionQuerySchema accepts repeated or comma-separated filters and empty means all", () => {
  assert.deepEqual(parse({ band: "3" }).band, [3]);
  assert.deepEqual(parse({ band: ["3", "1", "1"] }).band, [1, 3]);
  assert.deepEqual(parse({ band: "1,3" }).band, [1, 3]);
  assert.deepEqual(parse({ state: ["open", "unworked"] }).state, ["open", "unworked"]);
  assert.deepEqual(parse({ agent_id: [AGENT_B, AGENT_A] }).agent_id, [AGENT_A, AGENT_B]);
  assert.equal(parse({}).band, undefined);
  assert.equal(parse({}).state, undefined);
  assert.equal(parse({}).agent_id, undefined);
});

test("attention filter digest is stable across key order", () => {
  assert.equal(
    digestOf({ band: ["3", "1"], state: ["unworked", "open"] }),
    digestOf({ state: "open,unworked", band: "1,3" }),
  );
});

test("rowMatchesAttentionQuery treats empty selection as all", () => {
  const row = {
    derived: { attention_band: 3, review_badges: [] as string[] },
    outreach: {
      state: "open",
      assignment: { agent: { id: AGENT_A } },
      followups: [],
    },
  } as unknown as Parameters<typeof rowMatchesAttentionQuery>[0];
  assert.equal(rowMatchesAttentionQuery(row, parse({})), true);
  assert.equal(rowMatchesAttentionQuery(row, parse({ band: ["3", "1"] })), true);
  assert.equal(rowMatchesAttentionQuery(row, parse({ band: "1" })), false);
  assert.equal(rowMatchesAttentionQuery(row, parse({ state: "open" })), true);
  assert.equal(rowMatchesAttentionQuery(row, parse({ state: "closed" })), false);
  assert.equal(rowMatchesAttentionQuery(row, parse({ agent_id: [AGENT_A, AGENT_B] })), true);
  assert.equal(rowMatchesAttentionQuery(row, parse({ agent_id: AGENT_B })), false);
});

test("rowMatchesAttentionQuery: view marker, closed work and freshness (Move assessment §8)", () => {
  const make = (over: Record<string, unknown>) => ({ derived: { attention_band: null, review_badges: [] as string[] },
    outreach: { state: "open", assignment: { agent: null }, followups: [] }, ...over }) as unknown as Parameters<typeof rowMatchesAttentionQuery>[0];
  const noBand = make({ in_attention: false });
  assert.equal(rowMatchesAttentionQuery(noBand, parse({})), false, "Attention view hides rows without a band or badge");
  assert.equal(rowMatchesAttentionQuery(noBand, parse({ view: "all_outreach" })), true);
  assert.equal(rowMatchesAttentionQuery(make({}), parse({})), true, "older rows without the marker stay in Attention");
  const closed = make({ in_attention: true, outreach: { state: "closed", assignment: { agent: null }, followups: [] } });
  assert.equal(rowMatchesAttentionQuery(closed, parse({ view: "all_outreach" })), true, "UX-C1: a badge keeps closed work in All Outreach");
  const closedOut = make({ in_attention: false, outreach: { state: "closed", assignment: { agent: null }, followups: [] } });
  assert.equal(rowMatchesAttentionQuery(closedOut, parse({ view: "all_outreach" })), false, "closed work out of Attention stays hidden");
  assert.equal(rowMatchesAttentionQuery(closedOut, parse({ view: "all_outreach", state: "closed" })), true);
  assert.equal(rowMatchesAttentionQuery(closed, parse({ view: "all_outreach", state: "closed" })), true);
  assert.equal(rowMatchesAttentionQuery(closed, parse({})), true, "default Attention population is unchanged");
  const stale = make({ in_attention: false, sort_keys: { assessment_stale: true } });
  assert.equal(rowMatchesAttentionQuery(stale, parse({ view: "all_outreach", freshness: "fresh" })), false);
  assert.equal(rowMatchesAttentionQuery(stale, parse({ view: "all_outreach", freshness: "all" })), true);
});
