import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { payloadHash } from "../transactions";
import { VANTAGE_COMPANY_CONTEXT, VANTAGE_DOMAIN_CONTEXT } from "../companyContext";
import { minimalFindingsSchema, minimalFindingsSchemaHandles } from "./structuredContract";
import { structuredProviderSchema } from "./structuredProviderSchema";
import {
  CASE_FILE_CONTEXT_STEP_VERSION, CASE_FILE_FINDINGS_PROMPT_VERSION, CASE_FILE_SUMMARY_PROMPT_VERSION, FINDINGS_PROMPT, FINDINGS_PROMPT_V5, FINDINGS_PROMPT_VERSION,
  STRUCTURED_FINDINGS_PROMPT_VERSIONS, STRUCTURED_PIPELINE, SUMMARY_PROMPT, SUMMARY_PROMPT_V3, currentAnalysisLayout, findingsPromptFor, layoutOfContracts, structuredStepContracts,
  summaryPromptFor, CASE_FILE_FINDINGS_HANDLES_PROMPT_VERSION, FINDINGS_PROMPT_V6, citationsOfContracts, currentCitationMode,
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
  assert.deepEqual([...STRUCTURED_FINDINGS_PROMPT_VERSIONS], ["sales_intelligence_analyze_v4", "sales_intelligence_analyze_v5", "sales_intelligence_analyze_v6"]);
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

// ---------------------------------------------------------------------------------------------
// Citation handles spec §7 CH-T1 (flag off: byte-identical to c99b011e) and CH-T5 (per-run mode).
// ---------------------------------------------------------------------------------------------
const withFlags = <T>(flags: { CASE_FILE?: string; CITATION_HANDLES?: string }, run: () => T): T => {
  const names = ["SALES_INTELLIGENCE_CASE_FILE", "SALES_INTELLIGENCE_CITATION_HANDLES"] as const;
  const saved = names.map(name => process.env[name]);
  const set = (name: string, value: string | undefined) => { if (value === undefined) delete process.env[name]; else process.env[name] = value; };
  set(names[0], flags.CASE_FILE); set(names[1], flags.CITATION_HANDLES);
  try { return run(); } finally { names.forEach((name, i) => set(name, saved[i])); }
};
/** Digests computed at `c99b011e`: the contracts, prompts and provider schema a flag-off run pins. */
const C99 = { legacy: "a3c4c1608f914d8224d738447d26d7ae3522e5e5a79bebc88cb2f887fc174641", case_file: "969a6a28fb8582aa85a1a4cb52da40a404830fab7aabc2eea87aa25423997ae4",
  v5_prompt: "80a9ba6199a59ae3059352e8ea7c6954c977894bc212c639dfce72fb2079cfb2", v4_prompt: "e2ee3fe776e6e4acdd7f6827c447427cb0d4db48dad754d3a6dccf1afbd73277",
  summary_v3: "5fac831236f141a6038887e5b729b6dc433ce87b2a2fad5d8213e1198187c202", findings_schema: "d448572510744b143c89250f4a9ca8b94350f783dba1e41fdbfdcc882b2e5a11",
  provider_findings: "776fb17b4957666f93c21fffe307c5c732c26160f6647bbe2bd94956cdd6fca0" };

test("CH-T1: citation handles off (or without CASE_FILE), every prompt, schema and step_contracts hash is c99b011e's", async () => {
  for (const flags of [{ CASE_FILE: "true" }, { CASE_FILE: "true", CITATION_HANDLES: "false" }, { CASE_FILE: "true", CITATION_HANDLES: "TRUE-ish" }]) withFlags(flags, () => {
    assert.equal(currentCitationMode(currentAnalysisLayout()), "ids");
    const contracts = structuredStepContracts();
    assert.deepEqual(Object.keys(contracts), ["layout", "summary", "context", "findings"], "no citations key when off");
    assert.equal(payloadHash(contracts), C99.case_file);
  });
  // The handles flag without the Case File layout is ignored (prepare logs a warning).
  for (const flags of [{}, { CITATION_HANDLES: "true" }]) withFlags(flags, () => {
    assert.equal(currentCitationMode(currentAnalysisLayout()), "ids");
    assert.equal(payloadHash(structuredStepContracts()), C99.legacy);
  });
  assert.equal(payloadHash(structuredStepContracts("case_file", "ids")), C99.case_file);
  assert.equal(payloadHash(structuredStepContracts("legacy", "handles")), C99.legacy, "handles never apply to the legacy layout");
  assert.equal(payloadHash(FINDINGS_PROMPT_V5), C99.v5_prompt);
  assert.equal(payloadHash(FINDINGS_PROMPT), C99.v4_prompt);
  assert.equal(payloadHash(SUMMARY_PROMPT_V3), C99.summary_v3);
  assert.equal(payloadHash(z.toJSONSchema(minimalFindingsSchema)), C99.findings_schema);
  assert.equal(payloadHash(await (await structuredProviderSchema(minimalFindingsSchema)).jsonSchema), C99.provider_findings);
  assert.deepEqual(findingsPromptFor("case_file"), { prompt: FINDINGS_PROMPT_V5, version: CASE_FILE_FINDINGS_PROMPT_VERSION });
});

test("handles on: citations recorded with the v6 findings contract; summary and context unchanged; v6 = v5 with the citation sentences replaced", () => {
  withFlags({ CASE_FILE: "true", CITATION_HANDLES: "true" }, () => {
    assert.equal(currentCitationMode(currentAnalysisLayout()), "handles");
    const on = structuredStepContracts(), v5 = structuredStepContracts("case_file", "ids");
    assert.deepEqual(Object.keys(on), ["layout", "citations", "summary", "context", "findings"]);
    assert.equal(on.layout === "case_file" && "citations" in on ? on.citations : null, "handles");
    assert.deepEqual([on.summary, on.context], [v5.summary, v5.context], "the summary cache still hits");
    assert.deepEqual(on.findings, { prompt_version: "sales_intelligence_analyze_v6", prompt_digest: payloadHash(FINDINGS_PROMPT_V6),
      schema_digest: payloadHash(z.toJSONSchema(minimalFindingsSchemaHandles)) });
  });
  assert.equal(CASE_FILE_FINDINGS_HANDLES_PROMPT_VERSION, "sales_intelligence_analyze_v6");
  assert.deepEqual(findingsPromptFor("case_file", "handles"), { prompt: FINDINGS_PROMPT_V6, version: CASE_FILE_FINDINGS_HANDLES_PROMPT_VERSION });
  assert.deepEqual(findingsPromptFor("legacy", "handles"), { prompt: FINDINGS_PROMPT, version: FINDINGS_PROMPT_VERSION });
  // Only the two citation sentences differ.
  const v5End = "from appendix.context.", v6End = "name the story event by story_index.";
  const v5Cite = FINDINGS_PROMPT_V5.slice(FINDINGS_PROMPT_V5.indexOf("Cite story events by their T number"), FINDINGS_PROMPT_V5.indexOf(v5End) + v5End.length);
  const v6Cite = FINDINGS_PROMPT_V6.slice(FINDINGS_PROMPT_V6.indexOf("Cite evidence by handle."), FINDINGS_PROMPT_V6.indexOf(v6End) + v6End.length);
  assert.ok(v5Cite.length > 100 && v6Cite.startsWith('Cite evidence by handle. A story event is cited by its T number ({"source":"context","ref":"T14"})'));
  assert.equal(FINDINGS_PROMPT_V6.replace(v6Cite, v5Cite).replace("or context by handle.", "or context by record and id."), FINDINGS_PROMPT_V5);
  for (const gone of ["appendix.story_event_ids", "by record and id"]) assert.ok(!FINDINGS_PROMPT_V6.includes(gone), gone);
  assert.ok(FINDINGS_PROMPT_V6.includes("F-n is the follow-up at appendix.context.allowed_followup_ids at index n."));
});

test("CH-T5: a run keeps the citation mode it was prepared with across a flag flip, and a replay keeps its parent's", () => {
  // What invokeStructuredAnalysis checks: the recorded contracts against the contracts of their own recorded mode.
  const resumes = (recorded: unknown) => payloadHash(recorded) === payloadHash(structuredStepContracts(layoutOfContracts(recorded), citationsOfContracts(recorded)));
  const v5 = withFlags({ CASE_FILE: "true" }, () => JSON.parse(JSON.stringify(structuredStepContracts())) as unknown);
  const v6 = withFlags({ CASE_FILE: "true", CITATION_HANDLES: "true" }, () => JSON.parse(JSON.stringify(structuredStepContracts())) as unknown);
  withFlags({ CASE_FILE: "true", CITATION_HANDLES: "true" }, () => {
    assert.equal(citationsOfContracts(v5), "ids");
    assert.ok(resumes(v5), "prepared off, flipped on: finishes as v5");
    assert.equal(findingsPromptFor(layoutOfContracts(v5), citationsOfContracts(v5)).version, "sales_intelligence_analyze_v5");
  });
  withFlags({ CASE_FILE: "true" }, () => {
    assert.equal(citationsOfContracts(v6), "handles");
    assert.ok(resumes(v6), "prepared on, flipped off: finishes as v6");
    assert.equal(findingsPromptFor(layoutOfContracts(v6), citationsOfContracts(v6)).version, "sales_intelligence_analyze_v6");
  });
  // An original_evidence replay copies the parent's step_contracts (run.ts), so its mode is the parent's whatever the flag says.
  withFlags({ CASE_FILE: "true", CITATION_HANDLES: "true" }, () => assert.equal(citationsOfContracts(JSON.parse(JSON.stringify(v5))), "ids"));
  assert.equal(citationsOfContracts({ layout: "legacy", citations: "handles" }), "ids");
  assert.equal(citationsOfContracts(null), "ids");
  const { citations: _mode, ...stripped } = v6 as { citations: string };
  assert.ok(!resumes(stripped), "a v6 contract without its mode no longer matches (ORIGINAL_EVIDENCE_UNAVAILABLE), never silently v5");
});
