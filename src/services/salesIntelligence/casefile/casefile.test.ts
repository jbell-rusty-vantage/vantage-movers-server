import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { applyCaseFileBudget, renderCaseFile, trimCandidates } from "./budget";
import { buildCaseFile, customerEvidenceDigest } from "./build";
import { findingsAppendix, isPriorFindingTimelineRecord } from "./appendix";
import { caseFileFromReadContent, caseFileToReadContent } from "./page";
import { emptyTrimState, renderBody } from "./render";
import { FIXTURES, busyNumber, estimateChange, formLeadOneCall, priorPage } from "./fixtures/sources";
import type { CaseFile, CaseFileSources } from "./types";

/**
 * K5 (golden texts, byte-stable), K6 (T/C numbering), K8 (budget) — spec §4.14. Goldens live in
 * `fixtures/<name>.txt`; `UPDATE_CASE_FILE_GOLDEN=1` rewrites them (review the diff before committing).
 */
const DIR = join(__dirname, "fixtures");
const update = process.env.UPDATE_CASE_FILE_GOLDEN === "1";
const build = (make: () => CaseFileSources) => buildCaseFile(JSON.parse(JSON.stringify(make())) as CaseFileSources);

test("K5: six golden Case Files render byte-identically, twice, from fresh inputs", () => {
  for (const [name, make] of Object.entries(FIXTURES)) {
    const first = applyCaseFileBudget(build(make)), second = applyCaseFileBudget(build(make));
    assert.equal(second.text, first.text, `${name}: re-render is byte-identical`);
    assert.equal(second.digest, first.digest);
    const path = join(DIR, `${name}.txt`);
    if (update || !existsSync(path)) writeFileSync(path, first.text);
    assert.equal(first.text, readFileSync(path, "utf8"), `${name}: golden text`);
    assert.ok(!/\bundefined\b|\bNaN\b|\[object Object\]/.test(first.text), `${name}: no rendering artifacts`);
    assert.ok(first.text.startsWith("CASE FILE (data) · "), name);
    const headers = ["§1 WHO AND WHAT", "§2 HOW THE LEAD STARTED", "§3 GRANOT NOW", "§4 TIMELINE", "§5 OPEN WORK NOW", "§6 PRIOR ANALYSIS", "§7 THIS RUN"];
    const positions = headers.map(h => first.text.indexOf(`\n${h}`));
    assert.ok(positions.every((p, i) => p > 0 && (i === 0 || p > positions[i - 1]!)), `${name}: exact section order`);
  }
});

function numbering(file: CaseFile, text: string) {
  const ts = [...text.matchAll(/^\[T(\d+)\] /gm)].map(m => Number(m[1]));
  for (const t of ts) assert.ok(t < file.story_events.length, `T${t} resolves`);
  assert.deepEqual(ts, [...ts].sort((a, b) => a - b), "T numbers ascend down the timeline");
  const cs = [...text.matchAll(/\bC(\d+) (?:SUMMARY|DIGEST|SAID|OUTCOME|inbound|outbound)/g)].map(m => Number(m[1]));
  for (const c of cs) assert.ok(c < file.call_conversation_ids.length, `C${c} resolves`);
  return { ts, cs };
}

test("K6: every [Tn] is story_event_ids[n] and every Cn is call_index, calls ordered by started_at", () => {
  for (const [name, make] of Object.entries(FIXTURES)) {
    const sources = make(), file = buildCaseFile(sources), rendered = applyCaseFileBudget(file);
    const { ts } = numbering(file, rendered.text);
    const page = caseFileToReadContent(file, rendered, sources.coverage!);
    const storyIds = page.page.records.filter(r => r.record_type === "story_event").map(r => r.record_id);
    assert.deepEqual(storyIds, file.story_events.map(e => e.id), `${name}: the artifact's story_event records are the T order`);
    for (const t of ts) {
      const line = rendered.text.split("\n").find(l => l.startsWith(`[T${t}] `))!;
      assert.equal(`[T${t}] ${file.story_events[t]!.sentence}`, line.slice(0, file.story_events[t]!.sentence.length + `[T${t}] `.length), `${name}: T${t} sentence is its story record`);
    }
    const started = file.call_conversation_ids.map(id => sources.conversations.find(c => c.id === id)!.started_at);
    assert.deepEqual(started, [...started].sort(), `${name}: C order is started_at order`);
    const artifact = caseFileFromReadContent(page)!;
    assert.equal(artifact.text, rendered.text);
    assert.deepEqual(artifact.call_conversation_ids, file.call_conversation_ids);
  }
  // Calls arrive in LeadConversation id order (V2) but are numbered by time.
  const sources = busyNumber();
  sources.conversations = [...sources.conversations].reverse();
  const file = buildCaseFile(sources);
  assert.equal(file.call_conversation_ids[0], busyNumber().conversations[0]!.id);
});

test("K8: at or below 60 KB nothing is trimmed", () => {
  for (const name of ["form-lead-one-call", "call-lead", "no-lead-candidates", "estimate-change", "unreviewed-extension"]) {
    const file = build(FIXTURES[name]!), rendered = applyCaseFileBudget(file);
    assert.ok(rendered.bytes <= 60_000);
    assert.deepEqual(rendered.trimmed_steps, [], name);
    assert.match(rendered.text, /Trimmed: none\. Size \d+\.\d KB\.$/);
    assert.equal(Buffer.byteLength(rendered.text), rendered.bytes);
  }
});

test("K8: the busy Number is trimmed in spec order until ≤ 60 KB; never-trim content stays; §7 counts are exact", () => {
  const file = build(busyNumber);
  const untrimmed = Buffer.byteLength(renderBody(file, emptyTrimState()).join("\n"));
  const rendered = applyCaseFileBudget(file);
  assert.ok(untrimmed > 60_000, `fixture is over the soft budget (${untrimmed})`);
  assert.ok(rendered.bytes <= 60_000, `trimmed to ${rendered.bytes}`);
  const order: string[] = ["digest_overview_only", "digest_to_fact", "old_attempts_dropped", "owner_notes_dropped", "full_to_digest", "resolved_prior_findings_dropped"];
  const used: string[] = rendered.trimmed_steps.map(s => s.step);
  assert.deepEqual(used, order.filter(step => used.includes(step)), "steps in spec order");
  // Every step before the last one used was exhausted.
  const candidates = trimCandidates(file);
  for (const step of used.slice(0, -1)) assert.equal(rendered.trimmed_steps.find(s => s.step === step)!.count, candidates.filter(c => c.step === step).length, `${step} exhausted before the next`);
  const labels: Record<string, string> = { digest_overview_only: "digests? to (?:its|their) overview sentence", digest_to_fact: "digests? to (?:a )?fact lines?",
    old_attempts_dropped: "attempt lines? older than 30 days", owner_notes_dropped: "Owner notes? beyond the newest 5", full_to_digest: "full summar(?:y|ies) to (?:a )?digests?",
    resolved_prior_findings_dropped: "resolved or retracted prior findings?" };
  for (const s of rendered.trimmed_steps) assert.match(rendered.text, new RegExp(`${s.count} ${labels[s.step]}`), `§7 states ${s.step} = ${s.count}`);
  for (const section of [file.who, file.origins, file.granot, file.open_work, file.prior.rolling]) for (const line of section) assert.ok(rendered.text.includes(line), `never trimmed: ${line.slice(0, 60)}`);
  for (const item of file.timeline.filter(i => i.protected)) for (const line of item.lines) assert.ok(rendered.text.includes(line), `never trimmed: ${line.slice(0, 60)}`);
  for (const block of file.timeline.flatMap(i => i.calls).filter(b => b.focus)) for (const line of block.full) assert.ok(rendered.text.includes(line), `focus call at full depth: C${block.c}`);
});

test("K8: every step, one at a time, and the hard budget: never-trim content alone over 100 KB is still rendered and flagged", () => {
  const file = build(busyNumber);
  const tiny = applyCaseFileBudget(file, { soft_bytes: 1_000, hard_bytes: 2_000 });
  assert.equal(tiny.over_hard_budget, true);
  assert.deepEqual(tiny.trimmed_steps.map(s => s.step), ["digest_overview_only", "digest_to_fact", "old_attempts_dropped", "owner_notes_dropped", "full_to_digest", "resolved_prior_findings_dropped"]);
  assert.match(tiny.text, /Over the hard budget: only never-trimmed content remains\.$/);
  for (const line of [...file.who, ...file.origins, ...file.granot, ...file.open_work]) assert.ok(tiny.text.includes(line));
  assert.ok(!tiny.text.includes("Owner note 0:"), "older Owner notes went");
  assert.ok(tiny.text.includes("Owner note 10:"), "the newest five stay");
  const unreviewedPrior = file.prior.findings.filter(f => f.review_state === "unreviewed");
  for (const f of unreviewedPrior) assert.ok(tiny.text.includes(f.text), "unreviewed prior findings are not trimmed by step 6");
});

test("customer-evidence digest ignores §3 and §5 (the assessment fingerprint input, §4.10)", () => {
  const a = formLeadOneCall(), b = estimateChange();
  b.focus_conversation_ids = a.focus_conversation_ids;
  b.summaries = a.summaries;
  b.followups = [];
  const fa = buildCaseFile(a), fb = buildCaseFile(b);
  assert.notEqual(applyCaseFileBudget(fa).digest, applyCaseFileBudget(fb).digest, "the full text differs");
  assert.equal(customerEvidenceDigest(fa), customerEvidenceDigest(fb), "Granot and Outreach changes do not move the customer-evidence digest");
  const c = formLeadOneCall();
  c.summaries = [{ ...c.summaries[0]!, summary: { ...c.summaries[0]!.summary, summary: { ...c.summaries[0]!.summary.summary, outcome: "Customer booked." } } }];
  assert.notEqual(customerEvidenceDigest(buildCaseFile(c)), customerEvidenceDigest(fa), "a call summary change does");
});

test("appendix (§4.9): calls keep segment ids only for captured calls; job_timeline finding duplicates are dropped", () => {
  const sources = formLeadOneCall();
  const file = buildCaseFile(sources);
  const context = priorPage([
    { record_type: "job_timeline", record_id: "f1", revision: "1", fields: { description: "claim", status: "unreviewed", details: JSON.stringify({ kind: "objection", value: {}, evidence: [], run_id: "r1" }) } },
    { record_type: "job_timeline", record_id: "m1", revision: null, fields: { description: "Lead Message delivered", status: "lead_message", details: JSON.stringify({ status: "delivered" }) } },
    { record_type: "outreach", record_id: "o1", revision: "1", fields: { status: "open" } }]);
  context.allowed_followup_ids = ["x"];
  const appendix = findingsAppendix({ calls: [{ summary: sources.summaries[0]!.summary, segments_available: true }, null], context,
    story_event_ids: file.story_events.map(e => e.id), prior_finding_ids: [] });
  assert.deepEqual(appendix.context.records.map(r => r.record_id), ["m1", "o1"]);
  assert.deepEqual(appendix.calls.map(c => [c.call_index, c.segments_available, c.said_on_call.length]), [[0, true, 3], [1, false, 0]]);
  assert.deepEqual(appendix.calls[0]!.said_on_call[0], { kind: "promised_callback", claim: "Rep promised to email the estimate today.", speaker: "rep", action_status: "promised", segment_ids: [3] });
  assert.equal(isPriorFindingTimelineRecord({ record_type: "job_timeline", record_id: "t", revision: null, fields: { details: '{"kind":"objection","value":{"description":"x…[truncated]' } }), true);
});

test("renderCaseFile is the budgeted text", () => {
  const file = build(formLeadOneCall);
  assert.equal(renderCaseFile(file), applyCaseFileBudget(file).text);
});
