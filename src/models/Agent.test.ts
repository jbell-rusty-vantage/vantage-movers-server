import assert from "node:assert/strict";
import { test } from "node:test";
import { Agent } from "./Agent";

test("Agent Granot username index is unique and partial, never also sparse", () => {
  const entries = Agent.schema.indexes() as Array<[Record<string, unknown>, Record<string, unknown>]>;
  const usernameIndexes = entries.filter(([key]) =>
    JSON.stringify(key) === JSON.stringify({ "granot_identity.username": 1 }));
  assert.equal(usernameIndexes.length, 1);
  const [, options] = usernameIndexes[0]!;
  assert.equal(options.unique, true);
  assert.deepEqual(options.partialFilterExpression, {
    "granot_identity.username": { $type: "string" },
  });
  // Mongo refuses an index that mixes `sparse` and `partialFilterExpression`
  // (CannotCreateIndex 67); Mongoose autoIndex swallows that error.
  assert.equal(options.sparse, undefined);
});

test("no Agent index mixes sparse with a partial filter", () => {
  for (const [key, options] of Agent.schema.indexes() as Array<[Record<string, unknown>, Record<string, unknown>]>) {
    assert.ok(
      !(options.sparse && options.partialFilterExpression),
      `index ${JSON.stringify(key)} mixes sparse and partialFilterExpression`,
    );
  }
});
