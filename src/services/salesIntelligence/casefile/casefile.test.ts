import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { applyCaseFileBudget, renderCaseFile, trimCandidates } from "./budget";
import { anchorFollowupCreation, buildCaseFile, customerEvidenceDigest, customerNameText } from "./build";
import { findingsAppendix, isPriorFindingTimelineRecord } from "./appendix";
import { caseFileFromReadContent, caseFileToReadContent } from "./page";
import { emptyTrimState, renderBody } from "./render";
import { FIXTURES, busyNumber, estimateChange, followup, followupEvents, formLead, formLeadOneCall, priorPage, priorityChange } from "./fixtures/sources";
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

test("V-AC S2: the sentence names the line's source; a Priority change to the same value is not rendered as a change", () => {
  const sources = formLeadOneCall(), lead = sources.leads[0]!;
  const quoted = (id: string, system: string, before: boolean, after: boolean) => ({ ...priorityChange(0, lead, "2026-09-18T12:00:00.000Z", null, "1", null),
    id: `quoted_changed:${id}`, kind: "quoted_changed" as const, record: { record_type: "story_event" as const, record_id: `quoted_changed:${id}` },
    detail: { lead_ref: lead.ref, quoted: after, quoted_before: before, source_system: system } });
  sources.events = [...sources.events, quoted("a", "vantage", true, false), quoted("b", "granot", false, true), quoted("c", "granot", true, true),
    { ...priorityChange(72, lead, "2026-09-19T12:00:00.000Z", "1", "1", "JBELL"), detail: { lead_ref: lead.ref, from: "1", to: "1", granot_rep_raw: "JBELL", source_system: "vantage" } },
    { ...priorityChange(73, lead, "2026-09-20T12:00:00.000Z", "1", "1", null), detail: { lead_ref: lead.ref, from: "1", to: "1", churn_count: 3, source_system: "granot" } }];
  const text = applyCaseFileBudget(buildCaseFile(sources)).text;
  assert.match(text, /· Vantage · Quoted mark removed by a Vantage edit$/m);
  assert.match(text, /· Granot · marked Quoted in Granot$/m);
  assert.match(text, /· Granot · Quoted mark re-recorded in Granot \(no change\)$/m);
  assert.match(text, /· Vantage · Priority re-recorded as 1 Quoted \(no change\) by JBELL$/m);
  assert.match(text, /· Granot · Priority changed and returned to 1 Quoted \(3 changes within an hour\)$/m);
  assert.ok(!/Priority 1 Quoted → 1 Quoted/.test(text));
  assert.ok(!/· Vantage · [^\n]*in Granot/.test(text), "no Vantage line claims Granot");
});

test("V-AC S3: [form name] only for the name captured from the form; otherwise the Lead record or Granot", () => {
  const base = formLead(1);
  assert.equal(customerNameText(base), "Maria Lopez [form name]");
  assert.equal(customerNameText({ ...base, name: "Maria L. Lopez", contact_origin: { ingested_name: "Maria Lopez", ingested_status: "captured_at_ingestion", current_source: "granot" } }),
    'Maria Lopez [form name] · Lead record now "Maria L. Lopez" [Granot]');
  assert.equal(customerNameText({ ...base, contact_origin: null }), "Maria Lopez [Lead record]", "no ingested snapshot: never called the form name");
  assert.equal(customerNameText({ ...base, contact_origin: { ingested_name: "Maria Lopez", ingested_status: "legacy_baseline", current_source: null } }), "Maria Lopez [Lead record]");
  assert.equal(customerNameText({ ...base, ingestion_origin: "granot_lead_created", contact_origin: { ingested_name: "M Lopez", ingested_status: "captured_at_ingestion", current_source: "granot" } }),
    "Maria Lopez [Granot]", "a Granot-created Lead has no form");
  assert.equal(customerNameText({ ...base, name: null, contact_origin: null }), null);
});

test("V-AC S4: a follow-up is never shown completed before it was created; creation sits at the promise with (recorded …)", () => {
  const late = followup(32, { status: "completed", completed_at: "2026-09-17T20:05:00.000Z", created_at: "2026-09-18T16:00:00.000Z", anchor_at: "2026-09-17T14:04:00.000Z" });
  const events = anchorFollowupCreation(followupEvents(late), [late]);
  assert.equal(events[0]!.happened_at, "2026-09-17T14:04:00.000Z");
  assert.equal(events[0]!.observed_at, "2026-09-18T16:00:00.000Z");
  const noAnchor = { ...late, anchor_at: null };
  const clamped = anchorFollowupCreation(followupEvents(noAnchor), [noAnchor]);
  assert.equal(clamped[0]!.happened_at, "2026-09-17T20:05:00.000Z", "without an anchor, creation is clamped to the completion");
  const onTime = followup(33);
  assert.deepEqual(anchorFollowupCreation(followupEvents(onTime), [onTime]), followupEvents(onTime), "an on-time row is untouched");
  const text = applyCaseFileBudget(buildCaseFile(estimateChange())).text;
  const created = text.indexOf("F-1 created"), completed = text.indexOf("F-1 completed");
  assert.ok(created > 0 && completed > created, "created precedes completed");
  assert.match(text, /F-1 created: call "Send the moving checklist"[^\n]*\(recorded Fri Sep 18\)/);
  // Equal instants: created sorts before completed.
  const same = followup(34, { status: "completed", completed_at: "2026-09-17T14:30:00.000Z" });
  const s2 = formLeadOneCall(); s2.followups = [same]; s2.allowed_followup_ids = [same.id];
  s2.events = [...s2.events.filter(e => !e.kind.startsWith("followup_")), ...followupEvents(same)];
  const t2 = applyCaseFileBudget(buildCaseFile(s2)).text;
  assert.ok(t2.indexOf("F-0 created") < t2.indexOf("F-0 completed"));
});

test("V-AC N7: a prior finding's review reads as the Owner's review, and the digest outcome label is not doubled", () => {
  const text = applyCaseFileBudget(build(busyNumber)).text;
  assert.ok(text.includes("not yet reviewed by the Owner") && text.includes("confirmed by the Owner"));
  assert.ok(!/\(C\d+, unreviewed/.test(text), "unreviewed stays an identity word only");
  const untrimmed = renderBody(build(busyNumber), emptyTrimState()).join(String.fromCharCode(10));
  assert.ok(/C0 OUTCOME: Outcome of call 0: waiting on the customer\. \| commitments: /.test(untrimmed), 'the digest line shows the outcome once');
  assert.ok(!/OUTCOME: outcome:/.test(untrimmed) && !/OUTCOME: outcome:/.test(text));
});
