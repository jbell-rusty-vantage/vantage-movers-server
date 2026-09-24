/**
 * The Case File (Attention and Case File spec §4). Consumers:
 * - the findings step (`analysis/structuredRuntime.ts`, layout `case_file`): `assembleCaseFile`, `caseFileToReadContent`, `findingsAppendix`;
 * - the Move assessment (AC2-ASSESS): `assembleCaseFile({ ..., audience: "assessment", evidence_lines })` → `rendered.text`
 *   for the payload's `case_file`, and `rendered.customer_evidence_digest` (§2 plus the §4 call summaries, never §3/§5)
 *   for its fingerprint;
 * - `scripts/dev_ops/inspect-case-file.ts`.
 */
export { assembleCaseFile, assembleCaseFileSources, caseFileInputFor, type AssembledCaseFile } from "./assemble";
export { buildCaseFile, customerEvidenceDigest, callRanges } from "./build";
export { applyCaseFileBudget, renderCaseFile, trimCandidates } from "./budget";
export { caseFileArtifactSchema, caseFileFromReadContent, caseFileToReadContent, type CaseFileArtifact } from "./page";
export { findingsAppendix, isPriorFindingTimelineRecord, type FindingsAppendix } from "./appendix";
export { CASE_FILE_FLAG, caseFileEnabled } from "./flag";
export { summaryCallContext, type SummaryCallContext } from "./summaryInput";
export * from "./types";
