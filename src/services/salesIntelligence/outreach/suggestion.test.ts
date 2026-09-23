import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { outreachSuggestedNextStepDtoSchema } from "../dto";
import { payloadHash } from "../transactions";
import { runPresentation } from "../assessment/presentation";
import { legacyActions, legacyEffects, legacyEnvelope, legacyFindings, legacyRun } from "../assessment/presentation.fixtures";
import { EMPTY_SUGGESTION_SIDE, isSuggestionCandidate, loadSuggestionSide, suggestedNextStep, suggestionActionLabel, type SuggestionRun, type SuggestionSide, type SuggestionStore } from "./suggestion";

/**
 * S1-SUGGEST unit proof: final spec §5.5 case table for card line 6 (the server decides case 2), the Apply
 * availability against `apply_suggestion`'s preconditions, label parity with the run presentation, and a
 * read-count proof (constant reads for 10 and 60 records). The replica repeats it on a real mongod
 * (`scripts/dev_ops/test-si-suggest.ts`).
 */
const oid = () => new mongoose.Types.ObjectId();
const SUGGESTION = { action_kind: "send_estimate", description: "Send the estimate", date_text: "tomorrow", timezone_text: null, target_followup_id: null,
  rationale: "Customer asked for a quote", finding_keys: ["f1"] };

function fixture(over: { record?: Record<string, unknown>; run?: Partial<SuggestionRun>; side?: Partial<SuggestionSide> } = {}) {
  const numberId = oid(), recordId = oid(), runId = oid();
  const record = { _id: recordId, revision: 4, state: "unworked", subject: { kind: "lead", model: "FormLead", id: oid() }, primary_contact_number_id: numberId,
    next_action: null, ...over.record } as unknown as Parameters<typeof suggestedNextStep>[0]["record"];
  const run: SuggestionRun = { _id: runId, revision: 2, subject_key: "lead:FormLead:x", contact_number_id: numberId, conversation_id: oid(), outreach_record_id: recordId,
    suggestion: SUGGESTION, ...over.run };
  const side: SuggestionSide = { runs: new Map([[String(numberId), run]]), applied: new Set(), current: new Set([String(runId)]), purgePending: new Set(), ...over.side };
  return { record, run, side, numberId, recordId, runId };
}

test("§5.5 case table: only case 2 carries suggested_next_step", () => {
  const followupId = oid();
  const open = [{ _id: followupId, status: "open" }];
  const cases: Array<[string, ReturnType<typeof fixture>, readonly { _id: unknown; status: string }[], boolean]> = [
    ["case 1: open next_action follow-up", fixture({ record: { next_action: { followup_id: followupId } } }), open, false],
    ["case 1 over: next_action points at a completed follow-up → case 2", fixture({ record: { next_action: { followup_id: followupId } } }), [{ _id: followupId, status: "completed" }], true],
    ["case 4: closed record", fixture({ record: { state: "closed" } }), [], false],
    ["no Number (Lead-only subject)", fixture({ record: { primary_contact_number_id: null } }), [], false],
    ["no suggestion on the newest run", fixture({ run: { suggestion: null } }), [], false],
    ["applied suggestion", (() => { const f = fixture(); return { ...f, side: { ...f.side, applied: new Set([String(f.runId)]) } }; })(), [], false],
    ["content purge pending on the Number", (() => { const f = fixture(); return { ...f, side: { ...f.side, purgePending: new Set([String(f.numberId)]) } }; })(), [], false],
    ["run's Apply lands on another record", fixture({ run: { outreach_record_id: oid() } }), [], false],
    ["no completed run for the Number", (() => { const f = fixture(); return { ...f, side: { ...f.side, runs: new Map() } }; })(), [], false],
    ["case 2", fixture(), [], true],
  ];
  for (const [name, f, followups, shown] of cases) {
    const dto = suggestedNextStep({ record: f.record, followups, side: f.side, dispositionBlockers: [], featureEnabled: true });
    assert.equal(dto !== null, shown, name);
    if (dto) outreachSuggestedNextStepDtoSchema.parse(dto);
  }
});

test("case 2: fields and an enabled Apply that carries the command's fences", () => {
  const f = fixture();
  const dto = outreachSuggestedNextStepDtoSchema.parse(suggestedNextStep({ record: f.record, followups: [], side: f.side, dispositionBlockers: [], featureEnabled: true }));
  assert.deepEqual(dto, { run_id: String(f.runId), action_kind: "send_estimate", action_label: "Send estimate", description: "Send the estimate", date_text: "tomorrow",
    timezone_text: null, apply: { action: "apply_suggestion", target_id: String(f.runId), expected_revision: 2, enabled: true, blocker_codes: [],
      suggestion_output_digest: payloadHash(SUGGESTION), outreach_id: String(f.recordId), outreach_expected_revision: 4 } });
});

test("case 2 with Apply blocked: flags off, stale pointer, disposition guards (same codes as create_followup)", () => {
  const f = fixture();
  const blocked = (over: Partial<Parameters<typeof suggestedNextStep>[0]>) =>
    suggestedNextStep({ record: f.record, followups: [], side: f.side, dispositionBlockers: [], featureEnabled: true, ...over })!.apply;
  assert.deepEqual(blocked({ featureEnabled: false }), { ...blocked({}), enabled: false, blocker_codes: ["FEATURE_DISABLED"] });
  assert.deepEqual(blocked({ side: { ...f.side, current: new Set() } }).blocker_codes, ["REVISION_CONFLICT"], "not the published run: apply_suggestion's fence refuses it");
  assert.deepEqual(blocked({ dispositionBlockers: ["CRM_DISPOSITION_CLOSED", "DISPOSITION_REVIEW"] }).blocker_codes, ["CRM_DISPOSITION_CLOSED", "DISPOSITION_REVIEW"]);
  assert.equal(blocked({ dispositionBlockers: ["DISPOSITION_REVIEW"] }).enabled, false);
});

test("Number-review record: a run that names no Outreach record targets the Number-review record of its Number", () => {
  const numberId = oid();
  const f = fixture({ record: { subject: { kind: "number_review", contact_number_id: numberId }, primary_contact_number_id: null }, run: { contact_number_id: numberId, outreach_record_id: null } });
  const side = { ...f.side, runs: new Map([[String(numberId), f.run]]) };
  assert.ok(suggestedNextStep({ record: f.record, followups: [], side, dispositionBlockers: [], featureEnabled: true }));
  const lead = fixture({ run: { outreach_record_id: null } });
  assert.equal(suggestedNextStep({ record: lead.record, followups: [], side: lead.side, dispositionBlockers: [], featureEnabled: true }), null, "a Lead record never shows a Number-level suggestion");
});

test("action_label and description equal the run presentation's suggested_next_step for every action kind", () => {
  for (const kind of ["call", "text_customer_via_lead_message", "send_estimate", "check_availability", "review", "wait", "reconcile_identity", "other"]) {
    const envelope = legacyEnvelope();
    envelope.next_step_suggestion = { ...envelope.next_step_suggestion, action_kind: kind };
    const view = runPresentation({ run: legacyRun({ output: envelope }), findings: legacyFindings(), effects: legacyEffects(), actions: legacyActions(), summaries: [], snapshots: new Map() });
    assert.equal(suggestionActionLabel(kind), view.summary_findings.suggested_next_step?.action_label, kind);
    const f = fixture({ run: { suggestion: envelope.next_step_suggestion } });
    assert.equal(suggestedNextStep({ record: f.record, followups: [], side: f.side, dispositionBlockers: [], featureEnabled: true })?.description,
      view.summary_findings.suggested_next_step?.description);
  }
});

test("reads are batched: 10 and 60 records cost the same four reads; non-candidates cost none", async () => {
  const counts: Record<number, string[]> = {};
  for (const n of [10, 60]) {
    const reads: string[] = [];
    const records = Array.from({ length: n }, (_, i) => fixture({ record: i % 5 === 0 ? { state: "closed" } : {} }));
    const runs = records.map(r => r.run);
    const store: SuggestionStore = {
      newestRuns: async ids => { reads.push("runs.aggregate"); assert.equal(ids.length, records.filter(r => r.record.state !== "closed").length, "closed records do not enter the read"); return runs.filter(run => ids.some(id => String(id) === String(run.contact_number_id))); },
      appliedRunIds: async list => { reads.push("audit.find"); return [String(list[0]!._id)]; },
      conversationPointers: async ids => { reads.push("conversations.find"); return runs.filter(run => ids.includes(String(run.conversation_id))).map(run => ({ _id: run.conversation_id, latest_completed_run_id: run._id })); },
      numberPointers: async ids => { reads.push("numbers.find"); return ids.map(id => ({ _id: id, running_summary: null, content_purge_pending: false })); },
    };
    const side = await loadSuggestionSide(records.map(r => r.record), () => [], store);
    counts[n] = reads.sort();
    const shown = records.filter(r => suggestedNextStep({ record: r.record, followups: [], side, dispositionBlockers: [], featureEnabled: true }));
    assert.equal(shown.length, records.filter(r => r.record.state !== "closed").length - 1, "every open record but the applied one shows case 2");
    assert.ok(shown.every(r => suggestedNextStep({ record: r.record, followups: [], side, dispositionBlockers: [], featureEnabled: true })!.apply.enabled), "conversation pointers mark each run current");
  }
  assert.deepEqual(counts[10], counts[60]);
  assert.equal(counts[10]!.length, 4);
  let called = 0;
  const idle: SuggestionStore = { newestRuns: async () => { called++; return []; }, appliedRunIds: async () => { called++; return []; },
    conversationPointers: async () => { called++; return []; }, numberPointers: async () => { called++; return []; } };
  assert.equal(await loadSuggestionSide([fixture({ record: { state: "closed" } }).record], () => [], idle), EMPTY_SUGGESTION_SIDE);
  assert.equal(called, 0, "no candidate → no read");
  assert.equal(await loadSuggestionSide([fixture().record], () => [], idle), EMPTY_SUGGESTION_SIDE);
  assert.equal(called, 1, "no run with a suggestion → only the run read");
  assert.equal(isSuggestionCandidate(fixture({ record: { primary_contact_number_id: null } }).record, []), false);
});
