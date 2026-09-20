import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { intelligenceEnvelopeSchema } from "../../../validation/intelligence/intelligenceEnvelope.validation";
import { repPromiseVsCustomerCallbackFixture } from "../../../validation/intelligence/fixtures";

// Exercise the same structural conversion used by MCP and the worker against
// the authoritative validator. Synthetic evidence only; no model or database.
const structural = z.fromJSONSchema(z.toJSONSchema(intelligenceEnvelopeSchema));

test("MCP structural validation cannot teach or enforce cross-field envelope rules", () => {
  const cases = [
    { path: "summary.finding_keys.0", mutate: (e: z.infer<typeof intelligenceEnvelopeSchema>) => { e.summary.finding_keys[0] = "missing-finding"; } },
    { path: "findings", mutate: (e: z.infer<typeof intelligenceEnvelopeSchema>) => { e.findings.push(structuredClone(e.findings[0])); } },
    { path: "summary", mutate: (e: z.infer<typeof intelligenceEnvelopeSchema>) => { e.summary.overview = "x".repeat(4001); } },
  ];
  for (const { path, mutate } of cases) {
    const envelope = intelligenceEnvelopeSchema.parse(structuredClone(repPromiseVsCustomerCallbackFixture));
    mutate(envelope);
    assert.equal(structural.safeParse(envelope).success, true, path);
    const result = intelligenceEnvelopeSchema.safeParse(envelope);
    assert.equal(result.success, false, path);
    if (!result.success) assert(result.error.issues.some(issue => issue.path.join(".") === path), path);
  }
});

test("required nullable fields and closed finding kinds are already enforced structurally", () => {
  const base = intelligenceEnvelopeSchema.parse(structuredClone(repPromiseVsCustomerCallbackFixture));
  assert.equal(structural.safeParse(base).success, true);
  for (const field of ["speaker_ref", "action_status", "confidence"]) {
    const envelope = structuredClone(base);
    Reflect.deleteProperty(envelope.findings[0], field);
    assert.equal(structural.safeParse(envelope).success, false, field);
  }
  const envelope = structuredClone(base);
  Reflect.set(envelope.findings[0], "kind", "attention_band");
  assert.equal(structural.safeParse(envelope).success, false);
});
