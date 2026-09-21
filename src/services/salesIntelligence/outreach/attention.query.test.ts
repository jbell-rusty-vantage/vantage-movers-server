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
