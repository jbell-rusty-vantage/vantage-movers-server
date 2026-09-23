import assert from "node:assert/strict";
import { test } from "node:test";
import { payloadHash } from "../transactions";
import { assessmentSectionSchema, evidenceSectionSchema, fullOutputSchema, runPresentationSchema } from "./dto";
import {
  assessmentApplicability, assessmentEvidenceRefs, assessmentFullOutput, assessmentSection, assessmentVersion, evidenceSection, moveAssessmentProjectionDto,
  runFullOutput, runPresentation, type EvidenceSources,
} from "./presentation";
import {
  IDS, artifact, conversationRow, legacyActions, legacyEffects, legacyEnvelope, legacyFindings, legacyRun, oldArtifact, purgedArtifact, snapshot,
  structuredRun, summaryArtifactResponse,
} from "./presentation.fixtures";

const active = { applicability: "active" as const, current: true };

test("applicability: closed work and an accepted un-overridden terminal disposition are not actionable; override or uncertain provenance stays active", () => {
  assert.equal(assessmentApplicability({ state: "closed" }), "closed");
  assert.equal(assessmentApplicability({ state: "open", lead_progress: { disposition: "crm_dead", provenance: "accepted", override: null } }), "not_applicable");
  assert.equal(assessmentApplicability({ state: "open", lead_progress: { disposition: "crm_bad_unusable", provenance: "accepted", override: { reason: "x" } } }), "active");
  assert.equal(assessmentApplicability({ state: "open", lead_progress: { disposition: "crm_dead", provenance: "uncertain", override: null } }), "active");
  assert.equal(moveAssessmentProjectionDto({ state: "open" }), null, "no projection, nothing queued → Not assessed (absent)");
  assert.equal(moveAssessmentProjectionDto({ state: "closed" })?.status, "not_applicable", "closure precedes the unassessed label");
});

test("assessment section: both scores, labelled views, statements, inventory, conflicts, coverage and freshness from the stored artifact", () => {
  const section = assessmentSection(artifact(), { ...active, projection: { artifact_id: IDS.artifactNew, status: "ready", stale: true, stale_reason: "move_date_passed" } });
  assessmentSectionSchema.parse(section);
  assert.equal(section.availability, "ready");
  assert.deepEqual([section.transaction_intent.score, section.transaction_intent.label, section.move_likelihood.score, section.move_likelihood.label], [50, "50 / 100", 75, "75 / 100"]);
  assert.equal(section.move_likelihood.stale, true);
  assert.equal(section.move_likelihood.stale_reason, "move_date_passed");
  assert.deepEqual(section.transaction_intent.evidence.map(e => e.id), ["e1", "e3"]);
  assert.equal(section.views.original_ingestion?.label, "original_form_submission");
  assert.equal(section.views.original_ingestion?.move_date, "2026-10-01");
  assert.equal(section.views.canonical_current?.move_date, "2026-10-15");
  assert.equal(section.views.customer_stated[0]?.field, "move_date");
  assert.equal(section.inventory.items[0]?.label, "Sofa");
  assert.equal(section.inventory.coverage, "partial");
  assert.equal(section.inventory.source_coverage, "partial", "server-measured coverage is separate from the model's claim");
  assert.equal(section.conflicts[0]?.evidence.length, 6);
  assert.deepEqual(section.coverage, { conversations_available: 2, conversations_selected: 1, findings_selected: 1 });
  assert.equal(section.source_manifest[0]?.kind, "summary_artifact");
});

test("assessment section: assessed Unknown, closed applicability, non-current freshness, purged, failed, unsupported version and unknown citation", () => {
  const unknown = assessmentSection(oldArtifact(), { ...active, current: false, projection: { artifact_id: IDS.artifactNew, status: "ready", stale: true } });
  assert.deepEqual([unknown.transaction_intent.score, unknown.transaction_intent.label, unknown.transaction_intent.level], [null, "Unknown", "unknown"]);
  assert.equal(unknown.move_likelihood.stale, false, "freshness belongs to the current projection only");
  assert.equal(unknown.input_mode, "lead_only");
  const closed = assessmentSection(artifact(), { applicability: "closed", current: true });
  assert.equal(closed.availability, "ready", "explicit review can still inspect historical scores");
  assert.deepEqual([closed.transaction_intent.score, closed.transaction_intent.label, closed.transaction_intent.applicability], [50, "Not applicable", "closed"]);
  const purged = assessmentSection(purgedArtifact(), active);
  assert.equal(purged.availability, "purged");
  assert.deepEqual([purged.transaction_intent.score, purged.views.customer_stated.length, purged.inventory.items.length, purged.source_manifest.length], [null, 0, 0, 0]);
  const tombstoned = assessmentSection(artifact({ purge_started_at: new Date() }), active);
  assert.equal(tombstoned.availability, "purged", "a purge in progress never serves content");
  assert.equal(assessmentSection(artifact({ status: "failed" }), active).transaction_intent.label, "Unavailable");
  assert.equal(assessmentSection(artifact(), { ...active, retention_pending: true }).availability, "unavailable");
  const unsupported = assessmentSection(artifact({ schema_version: "move-assessment-v9" }), active);
  assert.equal(unsupported.availability, "unsupported");
  assert.equal(unsupported.transaction_intent.score, null);
  const drifted = artifact();
  (drifted.scores as { transaction_intent: { evidence: unknown[] } }).transaction_intent.evidence = [{ id: "e9", kind: "summary_section", locator: { source: "mystery" } }];
  assert.equal(assessmentSection(drifted, active).availability, "unsupported", "an unknown citation shape is unsupported, never guessed");
  const extra = artifact();
  (extra.views as { canonical_current: Record<string, unknown> }).canonical_current.future_field = "ignored";
  assert.equal(assessmentSection(extra, active).availability, "ready", "unknown stored keys are dropped, not fatal");
});

test("versions and full output: exact model object and accepted envelope are labelled separately; purged versions keep only their label", () => {
  const version = assessmentVersion(artifact(), true);
  assert.deepEqual([version.status, version.label, version.current, version.transaction_intent, version.move_likelihood], ["ready", "Assessed", true, 50, 75]);
  const purged = assessmentVersion(purgedArtifact(), false);
  assert.deepEqual([purged.status, purged.label, purged.transaction_intent], ["purged", "Purged", null]);
  assert.equal(assessmentVersion(artifact({ status: "insufficient_evidence" }), false).label, "Insufficient evidence");
  const output = fullOutputSchema.parse(assessmentFullOutput(artifact()));
  assert.deepEqual(output.model_output, JSON.parse(JSON.stringify(artifact().model_output)));
  assert.ok(output.accepted && typeof output.accepted === "object" && "scores" in output.accepted);
  assert.equal("score" in ((output.model_output as { move_likelihood: object }).move_likelihood), false, "server-added scores never appear in the model object");
  assert.deepEqual(output.details.digests, { prompt_digest: "pd", schema_digest: "sd", input_fingerprint: "fp-new" });
  const gone = assessmentFullOutput(purgedArtifact());
  assert.deepEqual([gone.availability, gone.model_output, gone.accepted, gone.complete], ["purged", null, null, false]);
});

test("evidence resolution: summary citations stay summary citations; lead/official open records; purged, tampered and missing sources are labelled", () => {
  const summary = snapshot(IDS.summarySnapshot, summaryArtifactResponse());
  const sources: EvidenceSources = { snapshots: new Map([[IDS.summarySnapshot, summary]]), runs: new Map([[IDS.legacyRun, legacyRun()]]),
    conversations: new Map([[IDS.conversation, conversationRow()]]), findings: new Map([[IDS.finding, legacyFindings()[0]!]]), leads: new Set([`FormLead:${IDS.lead}`]) };
  const section = evidenceSectionSchema.parse(evidenceSection(assessmentEvidenceRefs(artifact()), sources));
  const byId = new Map(section.items.map(item => [item.id, item]));
  assert.deepEqual([...byId.keys()].sort(), ["e1", "e2", "e3", "e4", "e5", "e6", "e7"]);
  assert.deepEqual([byId.get("e1")?.availability, byId.get("e1")?.text, byId.get("e1")?.open], ["retained", "Customer said they move October 15", { kind: "summary_artifact", snapshot_id: IDS.summarySnapshot }]);
  assert.deepEqual(byId.get("e2")?.open, { kind: "record", model: "FormLead", id: IDS.lead, href: `/form-leads?record=${IDS.lead}&database_scope=production` });
  assert.deepEqual([byId.get("e3")?.text, byId.get("e3")?.open], ["Moving October 15", { kind: "analysis_run", run_id: IDS.legacyRun }]);
  assert.deepEqual(byId.get("e4")?.open, { kind: "record", model: "BookedLead", id: IDS.booking, href: `/bookings?record=${IDS.booking}&database_scope=production` });
  assert.equal(byId.get("e5")?.text, legacyEnvelope().summary.money_and_dates);
  assert.equal(byId.get("e6")?.text, "Old money");
  assert.equal(byId.get("e7")?.availability, "retained");
  const purgedSources: EvidenceSources = { ...sources, snapshots: new Map([[IDS.summarySnapshot, { ...summary, purged_at: new Date() }]]),
    runs: new Map([[IDS.legacyRun, legacyRun({ purged_at: new Date(), output: null })]]), conversations: new Map([[IDS.conversation, conversationRow({ content_purged_at: new Date() })]]),
    findings: new Map([[IDS.finding, { ...legacyFindings()[0]!, purged_at: new Date() }]]), leads: new Set() };
  const purged = evidenceSection(assessmentEvidenceRefs(artifact()), purgedSources);
  for (const id of ["e1", "e3", "e5", "e6"]) {
    const item = purged.items.find(i => i.id === id)!;
    assert.equal(item.availability, "purged", id);
    assert.equal(item.text, null, `${id} serves no purged content`);
  }
  assert.equal(purged.items.find(i => i.id === "e2")?.availability, "missing");
  const tampered = evidenceSection(assessmentEvidenceRefs(artifact()), { ...sources, snapshots: new Map([[IDS.summarySnapshot, { ...summary, content_digest: "other" }]]) });
  assert.deepEqual([tampered.items.find(i => i.id === "e1")?.availability, tampered.items.find(i => i.id === "e1")?.text], ["missing", null]);
  assert.deepEqual(evidenceSection(assessmentEvidenceRefs(artifact()), sources, { retention_pending: true }), { availability: "unavailable", items: [] });
});

test("legacy run → Summary & findings: six sections, findings with review/effects, suggestion separate from applied actions, evidence opens the run snapshot", () => {
  const snapshots = new Map([[IDS.transcriptSnapshot, snapshot(IDS.transcriptSnapshot, { t: 1 })], [IDS.recordSnapshot, snapshot(IDS.recordSnapshot, { r: 1 }, { purged_at: new Date() })]]);
  const view = runPresentationSchema.parse(runPresentation({ run: legacyRun(), findings: legacyFindings(), effects: legacyEffects(), actions: legacyActions(), summaries: [], snapshots }));
  const s = view.summary_findings;
  assert.deepEqual([s.availability, s.scope, s.source.kind, s.source.prompt_version], ["ready", "conversation", "legacy_run", "csi-agent-v3"]);
  assert.deepEqual(s.summary.sections.map(x => x.key), ["overview", "customer_wanted", "money_and_dates", "outcome", "commitments", "discrepancies"]);
  assert.equal(s.summary.narrative, null);
  assert.deepEqual(s.said_on_call, []);
  assert.deepEqual(s.findings.map(f => [f.id, f.kind, f.review_state]), [[IDS.finding, "move_fact", "confirmed"], [IDS.finding2, "promised_callback", "unreviewed"]]);
  assert.deepEqual(s.findings[1]?.effects, [{ kind: "create_followup", status: "applied", reason: null, target_id: IDS.followup }]);
  assert.equal(s.suggested_next_step?.action_kind, "send_estimate");
  assert.deepEqual(s.applied_actions.map(a => a.id), [IDS.followup]);
  const quote = view.evidence.items.find(i => i.kind === "transcript_quote")!;
  assert.deepEqual([quote.availability, quote.text, quote.open], ["retained", "We move on the fifteenth", { kind: "analysis_evidence", run_id: IDS.legacyRun, snapshot_id: IDS.transcriptSnapshot }]);
  const record = view.evidence.items.find(i => i.kind === "analysis_record")!;
  assert.deepEqual([record.availability, record.open], ["purged", null]);
  assert.deepEqual(view.full_output.map(r => [r.kind, r.available]), [["legacy_analysis", true]]);
  const full = runFullOutput({ run: legacyRun(), summaries: [] }, IDS.legacyRun)!;
  assert.deepEqual([full.kind, full.availability, full.accepted], ["legacy_analysis", "ready", null]);
  assert.deepEqual(full.model_output, legacyEnvelope());
  assert.equal(full.details.digests.output_digest, payloadHash(legacyEnvelope()));
  // Number analysis scope and envelope-only findings (not yet applied) stay readable without invented review state.
  const number = runPresentation({ run: legacyRun({ conversation_id: null }), findings: [], effects: [], actions: [], summaries: [], snapshots: new Map() });
  assert.equal(number.summary_findings.scope, "number");
  assert.deepEqual(number.summary_findings.findings.map(f => [f.id, f.review_state]), [[`${IDS.legacyRun}:f1`, "unreviewed"], [`${IDS.legacyRun}:f2`, "unreviewed"]]);
});

test("structured run → same section from the captured summary artifact; findings from the run; conversation summary and findings outputs listed separately", () => {
  const summary = snapshot(IDS.summarySnapshot, summaryArtifactResponse(), { run_id: IDS.structuredRun });
  const view = runPresentation({ run: structuredRun(), findings: [], effects: [], actions: [], summaries: [summary], snapshots: new Map() });
  const s = view.summary_findings;
  assert.equal(s.source.kind, "structured_run");
  assert.equal(s.summary.sections[0]?.text, "Structured: customer moving a two-bedroom apartment.", "conversation summary comes from the artifact");
  assert.deepEqual(s.said_on_call, [{ index: 0, call_index: 0, kind: "move_fact", speaker: "customer", text: "Customer said they move October 15", segment_ids: [3] }]);
  assert.equal(s.findings.length, 2);
  const summaryItem = view.evidence.items.find(i => i.kind === "summary_section")!;
  assert.deepEqual([summaryItem.availability, summaryItem.open], ["retained", { kind: "summary_artifact", snapshot_id: IDS.summarySnapshot }]);
  const quote = view.evidence.items.find(i => i.kind === "transcript_quote")!;
  assert.deepEqual(quote.open, { kind: "summary_artifact", snapshot_id: IDS.summarySnapshot }, "a summary citation opens the summary, not a reconstructed transcript");
  assert.deepEqual(view.full_output.map(r => [r.kind, r.id, r.available]), [["conversation_summary", IDS.summarySnapshot, true], ["findings", IDS.structuredRun, true]]);
  const summaryOutput = runFullOutput({ run: structuredRun(), summaries: [summary] }, IDS.summarySnapshot)!;
  assert.deepEqual(summaryOutput.model_output, summaryArtifactResponse().analysis_summary);
  const findingsOutput = runFullOutput({ run: structuredRun(), summaries: [summary] }, IDS.structuredRun)!;
  assert.equal(findingsOutput.model_output, null, "the minimal findings model object is not retained; never claimed");
  assert.ok(findingsOutput.accepted);
  assert.equal(runFullOutput({ run: structuredRun(), summaries: [summary] }, IDS.legacyRun), null);
  // A purged captured summary falls back to the run's own retained summary and is labelled unavailable.
  const purged = runPresentation({ run: structuredRun(), findings: [], effects: [], actions: [], summaries: [{ ...summary, purged_at: new Date() }], snapshots: new Map() });
  assert.equal(purged.summary_findings.summary.sections[0]?.text, legacyEnvelope().summary.overview);
  assert.deepEqual(purged.summary_findings.said_on_call, []);
  assert.equal(purged.full_output[0]?.available, false);
  assert.equal(purged.evidence.items.find(i => i.kind === "summary_section")?.availability, "purged");
});

test("run retention and versions: purged run, purge-pending Number, missing output and unknown pipeline each leave only that run unavailable", () => {
  const purged = runPresentation({ run: legacyRun({ purged_at: new Date(), output: null }), findings: legacyFindings(), effects: [], actions: [], summaries: [], snapshots: new Map() });
  assert.deepEqual([purged.summary_findings.availability, purged.summary_findings.findings.length, purged.evidence.availability, purged.full_output[0]?.available], ["purged", 0, "purged", false]);
  const pending = runPresentation({ run: legacyRun(), findings: legacyFindings(), effects: [], actions: [], summaries: [], snapshots: new Map(), retention_pending: true });
  assert.equal(pending.summary_findings.availability, "unavailable");
  assert.equal(runPresentation({ run: legacyRun({ output: null, status: "failed" }), findings: [], effects: [], actions: [], summaries: [], snapshots: new Map() }).summary_findings.availability, "unavailable");
  assert.equal(runPresentation({ run: legacyRun({ analysis_pipeline: "csi-analysis-steps-v9" }), findings: [], effects: [], actions: [], summaries: [], snapshots: new Map() }).summary_findings.availability, "unsupported");
  assert.equal(runFullOutput({ run: legacyRun({ purged_at: new Date(), output: null }), summaries: [] }, IDS.legacyRun)?.availability, "purged");
});
