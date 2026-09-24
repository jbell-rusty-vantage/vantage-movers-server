import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { payloadHash } from "../transactions";
import { VANTAGE_COMPANY_CONTEXT, VANTAGE_DOMAIN_CONTEXT } from "../companyContext";
import { minimalFindingsSchema } from "./structuredContract";
import {
  CASE_FILE_CONTEXT_STEP_VERSION, CASE_FILE_FINDINGS_PROMPT_VERSION, CASE_FILE_SUMMARY_PROMPT_VERSION, FINDINGS_PROMPT, FINDINGS_PROMPT_V5, FINDINGS_PROMPT_VERSION,
  STRUCTURED_FINDINGS_PROMPT_VERSIONS, STRUCTURED_PIPELINE, SUMMARY_PROMPT, SUMMARY_PROMPT_V3, currentAnalysisLayout, findingsPromptFor, layoutOfContracts, structuredStepContracts,
  summaryPromptFor,
} from "./structuredPrompt";

/**
 * Case File spec §4.11–§4.12 (K9 contract half): the flag is read into a per-run layout; flag off keeps
 * the exact legacy contracts object; the v5 findings prompt keeps every v4 sentence that is not about
 * the old block layout; the output schema digest never moves; no double quotes in the new text.
 */
const withFlag = <T>(value: string | undefined, run: () => T): T => {
  const saved = process.env.SALES_INTELLIGENCE_CASE_FILE;
  if (value === undefined) delete process.env.SALES_INTELLIGENCE_CASE_FILE; else process.env.SALES_INTELLIGENCE_CASE_FILE = value;
  try { return run(); } finally { if (saved === undefined) delete process.env.SALES_INTELLIGENCE_CASE_FILE; else process.env.SALES_INTELLIGENCE_CASE_FILE = saved; }
};

test("flag off: the pinned contracts are exactly the pre-Case-File object; the pipeline id and versions are unchanged", () => {
  for (const value of [undefined, "", "false", "TRUE-ish"]) withFlag(value, () => {
    assert.equal(currentAnalysisLayout(), "legacy");
    const contracts = structuredStepContracts();
    assert.deepEqual(Object.keys(contracts), ["summary", "context", "findings"], "no layout key when off");
    assert.equal(contracts.summary.prompt_version, "csi-summary-v2");
    assert.equal(contracts.context.prompt_version, "csi-context-v2");
    assert.equal(contracts.findings.prompt_version, "sales_intelligence_analyze_v4");
    assert.equal(payloadHash(contracts), "a3c4c1608f914d8224d738447d26d7ae3522e5e5a79bebc88cb2f887fc174641", "the 01bcf18 step_contracts hash");
  });
  assert.equal(STRUCTURED_PIPELINE, "csi-analysis-steps-v1");
  assert.equal(FINDINGS_PROMPT_VERSION, "sales_intelligence_analyze_v4");
});

test("flag on: the case_file layout is recorded; versions v3/v3/v5; the findings output schema digest is unchanged", () => {
  withFlag("true", () => {
    assert.equal(currentAnalysisLayout(), "case_file");
    const on = structuredStepContracts(), off = structuredStepContracts("legacy");
    assert.equal(on.layout, "case_file");
    assert.deepEqual([on.summary.prompt_version, on.context.prompt_version, on.findings.prompt_version],
      [CASE_FILE_SUMMARY_PROMPT_VERSION, CASE_FILE_CONTEXT_STEP_VERSION, CASE_FILE_FINDINGS_PROMPT_VERSION]);
    assert.deepEqual([CASE_FILE_SUMMARY_PROMPT_VERSION, CASE_FILE_CONTEXT_STEP_VERSION, CASE_FILE_FINDINGS_PROMPT_VERSION], ["csi-summary-v3", "csi-context-v3", "sales_intelligence_analyze_v5"]);
    assert.equal(on.findings.schema_digest, off.findings.schema_digest);
    assert.equal(on.findings.schema_digest, payloadHash(z.toJSONSchema(minimalFindingsSchema)));
    assert.equal(on.summary.schema_digest, off.summary.schema_digest);
    assert.equal(on.context.schema_digest, off.context.schema_digest);
  });
  assert.equal(layoutOfContracts({ layout: "case_file" }), "case_file");
  assert.equal(layoutOfContracts(structuredStepContracts("legacy")), "legacy");
  assert.equal(layoutOfContracts(null), "legacy");
  assert.deepEqual(findingsPromptFor("legacy"), { prompt: FINDINGS_PROMPT, version: FINDINGS_PROMPT_VERSION });
  assert.deepEqual(summaryPromptFor("legacy"), { prompt: SUMMARY_PROMPT, version: "csi-summary-v2" });
  assert.deepEqual([...STRUCTURED_FINDINGS_PROMPT_VERSIONS], ["sales_intelligence_analyze_v4", "sales_intelligence_analyze_v5"]);
});

test("v5 keeps every v4 sentence not about the old blocks, replaces the story paragraph, and adds the Case File rules", () => {
  const [v4Head, v4Blocks] = FINDINGS_PROMPT.slice(FINDINGS_PROMPT.indexOf("Analyze the supplied")).split("\n");
  assert.ok(FINDINGS_PROMPT_V5.includes(v4Head!), "the whole first v4 paragraph is kept verbatim");
  assert.ok(FINDINGS_PROMPT_V5.startsWith(`${VANTAGE_COMPANY_CONTEXT}\n\n`));
  for (const line of VANTAGE_DOMAIN_CONTEXT.split("\n").filter(l => !l.startsWith("- The story block is"))) assert.ok(FINDINGS_PROMPT_V5.includes(line), `domain line kept: ${line.slice(0, 40)}`);
  assert.ok(!FINDINGS_PROMPT_V5.includes("The story block lists"), "the old block paragraph is gone");
  assert.ok(!FINDINGS_PROMPT_V5.includes("- The story block is"));
  for (const kept of ["never repeat a prior finding unless the supplied calls support it again", "return its relation in prior_finding_relations (still_true, superseded, fulfilled, contradicted, or cannot_determine), citing evidence for every determined relation",
    "you may only suggest reconcile_identity", "Write the six-section summary as the current state of this customer's move with Vantage, not as a recap of one call."])
    assert.ok(v4Blocks!.includes(kept) && FINDINGS_PROMPT_V5.includes(kept), `v4 sentence kept: ${kept.slice(0, 40)}`);
  for (const rule of ["The case_file field is the Case File", "Read §3 and §5 before judging whether a quote, deposit, booking or callback", "Cite story events by their T number",
    "calls by their C number as call_index", "prior findings by their P number", "§6 is earlier model output", "story_discrepancies citing both the T number",
    "An unreviewed extension's directory name is a label, not a verified identity: cite the extension; never attribute a promise to that name.", "A Granot Priority is not a Booking"])
    assert.ok(FINDINGS_PROMPT_V5.includes(rule), rule);
  assert.ok(!/"/.test(FINDINGS_PROMPT_V5.slice(FINDINGS_PROMPT_V5.indexOf("Analyze the supplied"))), "no double quotes in the instruction text");
  assert.ok(SUMMARY_PROMPT_V3.startsWith(SUMMARY_PROMPT), "v3 is v2 plus the call-input sentences");
  assert.ok(SUMMARY_PROMPT_V3.includes("call.at is the call date: anchor relative dates (Monday, tomorrow, next week) to it in America/New_York."));
  assert.ok(!/"/.test(SUMMARY_PROMPT_V3.slice(SUMMARY_PROMPT.length)));
});
