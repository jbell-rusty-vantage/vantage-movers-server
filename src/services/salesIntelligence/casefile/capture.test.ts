import assert from "node:assert/strict";
import { test } from "node:test";
import { applyCaseFileBudget } from "./budget";
import { buildCaseFile } from "./build";
import { FIXTURES, formLeadOneCall } from "./fixtures/sources";
import { caseFileFromReadContent, caseFileToReadContent } from "./page";
import type { CaseFileSources } from "./types";

/**
 * S5c (reconciliation addendum §3.1 G2, §3.3 G4; C16, C19) on the pure builder. The assembler
 * (`assemble.ts`) drops in-progress calls, strips the Owner-only call keys and hands the builder
 * `excluded_in_progress` and `recovered_calls` only when non-empty; the replica proof
 * (`scripts/dev_ops/test-si-capture-recovery.ts`) repeats this through `assembleCaseFile`.
 */
const fresh = (make: () => CaseFileSources) => JSON.parse(JSON.stringify(make())) as CaseFileSources;

test("C19: a recovered call's observed suffix reads 'recovered by a capture repair on {date}'; nothing else moves", () => {
  const base = fresh(formLeadOneCall);
  const call = base.events.find(e => e.kind === "call")!;
  const before = applyCaseFileBudget(buildCaseFile(base));
  const withRecovery = { ...fresh(formLeadOneCall), recovered_calls: { [call.id]: "2026-09-24T03:40:00.000Z" } };
  const file = buildCaseFile(withRecovery), after = applyCaseFileBudget(file);
  const changed = after.text.split("\n").filter((line, i) => line !== before.text.split("\n")[i]);
  assert.ok(changed.length >= 1 && changed.length <= 2, "the call's head line (and at most the §7 size footer)");
  if (changed[1]) assert.match(changed[1], /^Coverage: /);
  assert.match(changed[0]!, /\(recovered by a capture repair on Wed Sep 23\)/, "the repair date in ET (03:40Z on Sep 24 is Sep 23 ET)");
  assert.doesNotMatch(changed[0]!, /\(recorded /, "the recovery suffix replaces the late-write suffix");
  assert.equal(after.customer_evidence_digest, before.customer_evidence_digest, "the assessment fingerprint input (§2 + §4 summaries) is unchanged");
  const t = file.story_events.findIndex(e => e.id === call.id);
  assert.match(file.story_events[t]!.sentence, /recovered by a capture repair/);
});

test("C16: excluded in-progress calls are counted in the Case File coverage; absent when zero (other files byte-identical)", () => {
  for (const [name, make] of Object.entries(FIXTURES)) {
    const src = fresh(make);
    const file = buildCaseFile(src), rendered = applyCaseFileBudget(file);
    assert.equal(file.coverage.excluded_in_progress, undefined, name);
    assert.doesNotMatch(rendered.text, /still in progress/, name);
    const artifact = caseFileFromReadContent(caseFileToReadContent(file, rendered, src.coverage!))!;
    assert.ok(!("excluded_in_progress" in artifact), `${name}: the artifact carries no new key`);
  }
  const src = { ...fresh(formLeadOneCall), excluded_in_progress: 1 };
  const file = buildCaseFile(src), rendered = applyCaseFileBudget(file);
  assert.equal(file.coverage.excluded_in_progress, 1);
  assert.match(file.run.coverage, /; 1 call still in progress not shown\.$/);
  const artifact = caseFileFromReadContent(caseFileToReadContent(file, rendered, src.coverage!))!;
  assert.equal(artifact.excluded_in_progress, 1);
});
