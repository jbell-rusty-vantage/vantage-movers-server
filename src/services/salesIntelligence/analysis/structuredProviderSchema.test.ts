import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { minimalFindingsSchema, summaryStepSchema } from "./structuredContract";
import { structuredStepContracts } from "./structuredPrompt";
import { providerCompatibleSchema, structuredProviderSchema } from "./structuredProviderSchema";

test("both CSI schemas reach strict providers without oneOf while retaining the pinned contracts", async () => {
  const before = structuredStepContracts();
  for (const schema of [summaryStepSchema, minimalFindingsSchema]) {
    const wire = await structuredProviderSchema(schema);
    const json = JSON.stringify(await wire.jsonSchema);
    assert.equal(json.includes('"oneOf"'), false);
    assert.equal(json.includes('"anyOf"'), true);
    assert.equal((await wire.validate!({}))?.success, false);
  }
  assert.deepEqual(structuredStepContracts(), before);
});

test("provider adaptation preserves strict discriminator/value validation and does not mutate input", async () => {
  const logical = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("a"), value: z.string() }).strict(),
    z.object({ kind: z.literal("b"), value: z.number() }).strict(),
  ]);
  const { zodSchema } = await import("ai");
  const original = await zodSchema(logical).jsonSchema;
  const copy = structuredClone(original);
  providerCompatibleSchema(original);
  assert.deepEqual(original, copy);
  const wire = await structuredProviderSchema(logical);
  for (const value of [{ kind: "a", value: "text" }, { kind: "b", value: 1 }])
    assert.equal((await wire.validate!(value)).success, true);
  for (const value of [{ kind: "a", value: 1 }, { kind: "c", value: "text" }, { kind: "b", value: 1, invented: true }])
    assert.equal((await wire.validate!(value)).success, false);
  assert.throws(() => providerCompatibleSchema({ oneOf: [{ type: "string" }, { type: "string", minLength: 1 }] }), /Unsupported/);
});

test("overlapping, optional and referenced tags cannot justify rewriting exclusive unions", () => {
  const branch = (tag: string) => ({ type: "object" as const, required: ["kind"], properties: { kind: { const: tag } } });
  for (const schema of [
    { oneOf: [branch("same"), branch("same")] },
    { oneOf: [branch("a"), { ...branch("b"), required: [] }] },
    { oneOf: [branch("a"), { ...branch("b"), $ref: "#/definitions/other" }] },
    { oneOf: [branch("a"), { ...branch("b"), properties: { kind: { const: "b", $ref: "#/definitions/tag" } } }] },
    { oneOf: [branch("a"), branch("b")], anyOf: [{ type: "object" as const }] },
  ]) assert.throws(() => providerCompatibleSchema(schema), /Unsupported/);
});
