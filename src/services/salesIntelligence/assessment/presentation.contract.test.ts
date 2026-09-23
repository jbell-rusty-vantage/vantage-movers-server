import assert from "node:assert/strict";
import { test } from "node:test";
import { CSI_EFFECT_STATUSES } from "../../../config/domain/salesIntelligence";
import { intelligenceFindingSchema, type IntelligenceFinding } from "../../../validation/intelligence/intelligenceEnvelope.validation";
import { EVIDENCE_RECORD_TYPES } from "../analysis/contracts";
import { assessmentSectionSchema, evidenceSectionSchema, outreachMoveAssessmentDtoSchema, runPresentationSchema, type AssessmentSection } from "./dto";
import {
  assessmentEvidenceRefs, assessmentSection, derivedFreshness, envelopeEvidenceRef, evidenceSection, findingCategory, findingValueLine, findingWorkResult,
  formatEtDateTime, leadOnlyMoveTable, moveAssessmentProjectionDto, moveDateHasPassed, moveTable, runPresentation, type EvidenceSources, type ReviewItemRow,
} from "./presentation";
import {
  CONTEXT_SNAPSHOT, IDS, PRIOR, RECORD_FIXTURES, STORY_EVENT, artifact, contextResponse, conversationRow, correctionRef, hex, ingestedRef, instructionRow, leadRef,
  legacyActions, legacyEnvelope, legacyFindings, moveEvidenceRef, officialLeadRef, priorFindings, relationsRun, sectionRef, snapshot, summaryArtifactResponse,
  summaryRef, transcriptRow,
} from "./presentation.fixtures";

// ---------------------------------------------------------------- B10 work_result (data spec §6.5)

const REVIEW_STATES = ["unreviewed", "confirmed", "corrected", "retracted"] as const;
/** Independent oracle for §6.5 rules 1–6 (relation bookkeeping effects already excluded by the caller). */
function expected(reviewState: string, superseded: boolean, status: string | null) {
  if (reviewState === "retracted") return "retracted";
  if (superseded) return "superseded";
  if (status === "applied") return "applied";
  if (status?.startsWith("blocked_")) return "blocked";
  if (status === "needs_review") return "needs_review";
  return "not_applicable";
}

test("B10 work_result: every effect status × review state × superseded_by, with and without relation bookkeeping effects", () => {
  const id = IDS.finding2;
  const relationEffects = [
    { effect_kind: "supersede", status: "applied", reason: "superseded_by_later_finding", target_id: hex(90) },
    { effect_kind: "supersede", status: "blocked_owner", reason: "review_state_confirmed", target_id: hex(91) },
    { effect_kind: "open_review", status: "needs_review", reason: "prior_finding_contradicted", target_id: hex(100) },
    { effect_kind: "open_review", status: "needs_review", reason: "prior_fulfilled_followup_open", target_id: hex(101) },
  ];
  let cases = 0;
  for (const reviewState of REVIEW_STATES) for (const superseded of [false, true]) for (const status of [null, ...CSI_EFFECT_STATUSES])
    for (const withRelations of [false, true]) {
      const own = status ? [{ effect_kind: "create_followup", status, reason: status.startsWith("blocked_") ? "owner_instruction" : null, target_id: IDS.followup }] : [];
      const result = findingWorkResult({ finding_id: id, review_state: reviewState, superseded_by: superseded ? hex(95) : null,
        effects: [...(withRelations ? relationEffects : []), ...own], review_items: [], actions: legacyActions() });
      assert.equal(result.work_result, expected(reviewState, superseded, status), `${reviewState}/${superseded}/${status}/${withRelations}`);
      if (result.work_result === "superseded") assert.equal(result.work_result_detail, hex(95), "detail is the superseding finding id");
      if (result.work_result === "applied") assert.equal(result.work_result_detail, "follow-up due Sep 12, 8:00 AM ET");
      if (result.work_result === "blocked") assert.equal(result.work_result_detail, "Your instruction on this work takes precedence");
      assert.notEqual(result.work_result_detail, "supersede");
      cases++;
    }
  assert.equal(cases, REVIEW_STATES.length * 2 * (CSI_EFFECT_STATUSES.length + 1) * 2);
  // Only relation effects: never `Applied → supersede`, never needs review from the relation's own review.
  assert.deepEqual(findingWorkResult({ finding_id: id, review_state: "unreviewed", effects: relationEffects, review_items: [] }),
    { work_result: "not_applicable", work_result_detail: null });
});

test("B10 work_result: finding-specific open review items count; record_disputed_on_call and closed items do not; applied details", () => {
  const item = (cause_kind: string, state = "open", evidence_ids: string[] = [IDS.finding]): ReviewItemRow => ({ _id: hex(110), cause_kind, state, evidence_ids });
  const base = { finding_id: IDS.finding, review_state: "unreviewed", effects: [] };
  assert.equal(findingWorkResult({ ...base, review_items: [item("unclear_commitment")] }).work_result, "needs_review");
  for (const cause of ["record_disputed_on_call", "prior_contradiction", "prior_fulfilled_unclaimed"])
    assert.equal(findingWorkResult({ ...base, review_items: [item(cause)] }).work_result, "not_applicable", cause);
  assert.equal(findingWorkResult({ ...base, review_items: [item("unclear_commitment", "resolved")] }).work_result, "not_applicable");
  assert.equal(findingWorkResult({ ...base, review_items: [item("unclear_commitment", "open", [IDS.finding2])] }).work_result, "not_applicable");
  const applied = (effect_kind: string, target_id: string | null, actions = legacyActions()) =>
    findingWorkResult({ ...base, effects: [{ effect_kind, status: "applied", reason: null, target_id }], review_items: [], actions }).work_result_detail;
  assert.equal(applied("create_followup", IDS.followup, [{ ...legacyActions()[0]!, due_at: null }]), "follow-up with no due date");
  assert.equal(applied("pause_channel", hex(120)), "contact paused");
  assert.equal(applied("set_contact_type", null), "call type set");
  assert.equal(applied("complete_followup", IDS.followup), "follow-up completed");
});

// ---------------------------------------------------------------- B17 value_line (data spec §6.11 B)

const finding = (kind: string, value: Record<string, unknown>, over: Record<string, unknown> = {}): IntelligenceFinding => intelligenceFindingSchema.parse({
  key: `k-${kind}`, kind, claim: `Claim for ${kind}`, basis: "said_on_call", actor: "customer", speaker_ref: null, action_status: null, clarity: "clear", confidence: null,
  evidence: [{ source: "transcript", snapshot_id: IDS.transcriptSnapshot, conversation_id: IDS.conversation, transcript_version: "v1", segment_ids: [1], quote: null }],
  value, ...over });
const action = (date_text: string | null) => ({ action_kind: "call", description: "Call back", date_text, timezone_text: null, target_followup_id: null });

test("B17 value_line: every one of the 16 finding kinds", () => {
  const due = new Date("2025-09-23T14:00:00Z"); // 10:00 AM EDT, a Tuesday
  assert.equal(formatEtDateTime(due), "Tue Sep 23, 10:00 AM ET");
  const cases: Array<[IntelligenceFinding, { due_at?: Date | null; amount_cents?: number | null } | null, string | null]> = [
    [finding("promised_callback", action("Tuesday morning")), { due_at: due }, "Due Tue Sep 23, 10:00 AM ET"],
    [finding("customer_requested_callback", action("next Tuesday")), { due_at: null }, "Date said: \"next Tuesday\" (not resolved)"],
    [finding("customer_will_call", action(null)), null, null],
    [finding("next_step", action("tomorrow")), { due_at: new Date("2026-01-15T20:30:00Z") }, "Due Thu Jan 15, 3:30 PM ET"],
    [finding("completion_claim", action(null)), { due_at: due }, "Due Tue Sep 23, 10:00 AM ET"],
    [finding("reschedule", action("the week after")), null, "Date said: \"the week after\" (not resolved)"],
    [finding("quoted_amount", { amount_text: "$4,200", currency: "USD", meaning: "quote_total" }), { amount_cents: 420_000 }, "$4,200 · quote total"],
    [finding("quoted_amount", { amount_text: "$500.50", currency: "USD", meaning: "deposit" }), { amount_cents: 50_050 }, "$500.50 · deposit"],
    [finding("quoted_amount", { amount_text: "about four grand", currency: null, meaning: "competitor_quote" }), { amount_cents: null }, "\"about four grand\" (amount unclear)"],
    [finding("contact_restriction", { channels: ["call", "text"], restriction: "until", until_text: "October 1" }), { due_at: new Date("2026-10-01T04:00:00Z") }, "No calls or texts until Oct 1"],
    [finding("contact_restriction", { channels: ["text"], restriction: "ongoing", until_text: null }), null, "No texts until further notice"],
    [finding("contact_restriction", { channels: ["call"], restriction: "unclear", until_text: null }), null, "No calls (unclear)"],
    [finding("contact_restriction", { channels: ["call"], restriction: "until", until_text: "after the holidays" }), { due_at: null }, "No calls until \"after the holidays\" (not resolved)"],
    [finding("move_fact", { field: "move_date", stated_value: "October 15" }), null, "Move date: October 15"],
    [finding("move_fact", { field: "origin", stated_value: "Austin" }), null, "Pickup: Austin"],
    [finding("contact_type", { type: "human_conversation", voicemail_left_by: null }), null, "Human conversation"],
    [finding("contact_type", { type: "voicemail", voicemail_left_by: "rep" }), null, "Voicemail"],
    [finding("contact_type", { type: "unknown", voicemail_left_by: null }), null, "Contact unknown"],
    [finding("intent", { intent: "moving_inquiry" }), null, "Moving inquiry"],
    [finding("intent", { intent: "not_sales" }), null, "Not a sales call"],
    [finding("booking_claim", { description: "Booked" }), null, null],
    [finding("payment_claim", { description: "Paid" }), null, null],
    [finding("objection", { description: "Too expensive" }), null, null],
    [finding("competitor_mention", { description: "Other mover" }), null, null],
    [finding("coaching_note", { description: "Ask for the date" }), null, null],
  ];
  for (const [input, resolved, line] of cases) assert.equal(findingValueLine(input, resolved), line, `${input.kind} ${JSON.stringify(input.value)}`);
  const kinds = new Set(cases.map(([input]) => input.kind));
  assert.equal(kinds.size, 16, "all 16 kinds covered");
  for (const kind of kinds) assert.ok(findingCategory(kind), `${kind} has a category`);
  assert.equal(findingCategory("promised_callback"), "commitments");
  assert.equal(findingCategory("intent"), "move_facts");
  assert.equal(findingCategory("contact_type"), "call_type");
});

// ---------------------------------------------------------------- B18 move table (data spec §6.11 D)

const cite = (id: string, kind = "said_on_call") => ({ id, kind, speaker: null, call_at: null, lineage: [],
  locator: { source: "summary_artifact", snapshot_id: IDS.summarySnapshot, content_digest: "d", conversation_id: IDS.conversation, transcript_version: "v1", section: "said_on_call.0" } });
const place = (city: string, state: string) => ({ line: null, city, state, zip: null, precision: "city" });
function tableArtifact() {
  const base = artifact();
  const views = base.views as Record<string, Record<string, unknown>>;
  return artifact({
    views: { ...views, original_ingestion: { ...views.original_ingestion, label: "granot_created" },
      customer_stated: [
        { field: "pickup_location", value: place("Austin", "TX"), status: "changed", evidence: [cite("c1")] },
        { field: "delivery_location", value: place("Denver", "CO"), status: "stated", evidence: [cite("c2")] },
        { field: "delivery_location", value: place("Boulder", "CO"), status: "retracted", evidence: [cite("c3")] },
        { field: "move_date", value: { raw_text: "mid October", date: "2026-10-15", end_date: "2026-10-20", applies_to: "pickup", flexibility: "flexible", precision: "window" },
          status: "stated", evidence: [cite("c4")] },
        { field: "move_size", value: { value: { min: 2, max: 2 }, unit: "bedrooms", text: "Two-bedroom apartment", basis: "customer_stated" }, status: "conditional", evidence: [cite("c5")] },
        { field: "service", value: { service: "packing", status: "requested", detail: "kitchen only", duration_text: null }, status: "stated", evidence: [cite("c6")] },
        { field: "service", value: { service: "storage", status: "declined", detail: null, duration_text: "two weeks" }, status: "stated", evidence: [cite("c7")] },
        { field: "access", value: { end: "pickup", constraint: "stairs", detail: "third floor walk-up" }, status: "stated", evidence: [cite("c8")] },
        { field: "access", value: { end: "delivery", constraint: "elevator", detail: "freight elevator booked" }, status: "stated", evidence: [cite("c9")] },
        { field: "money", value: { basis: "quote", amount: { min: 4200, max: 4200 }, currency: "USD", text: "$4,200" }, status: "stated", evidence: [cite("c10")] },
        { field: "money", value: { basis: "budget", amount: { min: 3000, max: 3000 }, currency: null, text: "three thousand" }, status: "stated", evidence: [cite("c11")] },
        { field: "money", value: { basis: "competitor_quote", amount: { min: 3500, max: 3800 }, currency: "USD", text: "3,500 to 3,800" }, status: "stated", evidence: [cite("c12")] },
        { field: "money", value: { basis: "deposit", amount: { min: null, max: null }, currency: null, text: "a small deposit" }, status: "stated", evidence: [cite("c13")] },
      ] },
    conflicts: [
      { affects: "pickup_location", explanation: "Lead says Austin; the call says Round Rock", evidence: [cite("c1"), cite("e2", "lead_current")] },
      { affects: "move_likelihood", explanation: "Customer unsure whether the job is confirmed", evidence: [cite("c1"), cite("c4")] },
    ],
  });
}

test("B18 move_table: fixed rows, multi-value customer cells, money basis, markers, customer-only rows, conflict row and origin label", () => {
  const section = assessmentSectionSchema.parse(assessmentSection(tableArtifact(), { applicability: "active", current: true }));
  const table = section.move_table!;
  assert.deepEqual(table.rows.map(row => row.key), ["pickup", "delivery", "move_date", "size", "services", "access", "money", "inventory"]);
  const row = (key: string) => table.rows.find(r => r.key === key)!;
  const cells = (key: string) => row(key).customer.map(c => [c.text, c.marker]);
  assert.deepEqual(cells("pickup"), [["Austin, TX", "changed"]]);
  assert.deepEqual(cells("delivery"), [["Denver, CO", null], ["Boulder, CO", "retracted"]]);
  assert.deepEqual(cells("move_date"), [["Oct 15, 2026 – Oct 20, 2026", "flexible"]]);
  assert.deepEqual(cells("size"), [["Two-bedroom apartment", "conditional"]]);
  assert.deepEqual(cells("services"), [["Packing (kitchen only)", null], ["Storage (two weeks)", "declined"]]);
  assert.deepEqual(cells("access"), [["Pickup · Stairs: third floor walk-up", null], ["Delivery · Elevator: freight elevator booked", null]]);
  assert.deepEqual(cells("money"), [["$4,200 quote", null], ["$3,000 budget", null], ["$3,500–$3,800 competitor quote", null], ["\"a small deposit\" (deposit)", null]]);
  assert.deepEqual(cells("inventory"), [["1 item · coverage partial", null]]);
  for (const key of ["services", "access", "money", "inventory"]) assert.deepEqual([row(key).lead_on_file, row(key).original], [null, null], `${key} has no Lead values`);
  assert.deepEqual([row("pickup").lead_on_file, row("pickup").original], ["Austin, TX 78701", "Austin, TX 78701"]);
  assert.deepEqual([row("move_date").lead_on_file, row("move_date").original], ["Oct 15, 2026", "Oct 1, 2026"]);
  assert.equal(row("size").lead_on_file, "2 bedroom");
  assert.deepEqual(row("pickup").conflict, { explanation: "Lead says Austin; the call says Round Rock",
    evidence: [cite("c1"), cite("e2", "lead_current")], cells: ["customer", "lead_on_file"] });
  assert.equal(row("delivery").conflict, null);
  assert.deepEqual(table.score_conflicts.map(c => [c.affects, c.affects_label]), [["move_likelihood", "Move likelihood"]]);
  assert.equal(table.original_origin_label, "Granot created");
  assert.equal(table.source_coverage_text, "From 1 of 2 conversations");
  assert.equal(row("services").customer[0]!.evidence[0]!.id, "c6", "each cell keeps its citations for View evidence");
  // Customer-only table (Lead-only assessment or no artifact): customer column empty, Lead columns still filled.
  const leadOnly = leadOnlyMoveTable({ original_ingestion: null, canonical_current: (artifact().views as { canonical_current: unknown }).canonical_current });
  assert.ok(leadOnly.rows.every(r => r.customer.length === 0));
  assert.equal(leadOnly.rows.find(r => r.key === "delivery")!.lead_on_file, "Denver, CO 80202");
  assert.equal(leadOnly.original_origin_label, null);
  assert.equal(moveTable({ ...section, views: { ...section.views, customer_stated: [] }, inventory: { items: [], coverage: null, limitations: [], source_coverage: null } })
    .rows.find(r => r.key === "inventory")!.customer.length, 0, "no items and no coverage → Not mentioned");
});

// ---------------------------------------------------------------- §6.2 stale_reason and newer_calls_count

test("stale_reason is the closed enum, derived from move_date_passed; stored reasons outside the enum are ignored; ET midnight boundary", () => {
  const record = (projection: Record<string, unknown>) => ({ state: "open", move_assessment: { artifact_id: IDS.artifactNew, status: "ready", ...projection } });
  const passed = moveAssessmentProjectionDto(record({ stale: false }), false, { moveDatePassed: true })!;
  assert.deepEqual([passed.stale, passed.stale_reason], [true, "move_date_passed"]);
  outreachMoveAssessmentDtoSchema.parse(passed);
  const legacy = moveAssessmentProjectionDto(record({ stale: true, stale_reason: "move_date_window_passed" }))!;
  assert.deepEqual([legacy.stale, legacy.stale_reason], [true, null], "stale kept, unknown reason ignored");
  assert.deepEqual([moveAssessmentProjectionDto(record({ stale: false }))!.stale, moveAssessmentProjectionDto(record({ stale: false }))!.stale_reason], [false, null], "two-argument call unchanged");
  const closed = moveAssessmentProjectionDto({ ...record({}), state: "closed" }, false, { moveDatePassed: true })!;
  assert.deepEqual([closed.stale, closed.stale_reason], [false, null], "non-active work is never stale");
  assert.deepEqual(derivedFreshness("not_applicable", { stale: true, stale_reason: "move_date_passed" }, true), { stale: false, stale_reason: null });
  // 2026-10-15 00:30 ET is 04:30Z: the move date 2026-10-14 has passed in ET although it is still the 15th only 4.5 hours into UTC.
  assert.equal(moveDateHasPassed("2026-10-14", new Date("2026-10-15T03:59:00Z")), false, "23:59 ET on the 14th");
  assert.equal(moveDateHasPassed("2026-10-14", new Date("2026-10-15T04:00:00Z")), true, "00:00 ET on the 15th");
  assert.equal(moveDateHasPassed(null, new Date()), false);
  const section = assessmentSection(artifact(), { applicability: "active", current: true, projection: { artifact_id: IDS.artifactNew, status: "ready" },
    move_date_passed: true, newer_calls_count: 2 });
  assert.deepEqual([section.stale, section.stale_reason, section.move_likelihood.stale_reason, section.newer_calls_count], [true, "move_date_passed", "move_date_passed", 2]);
  const old = assessmentSection(artifact(), { applicability: "active", current: false, move_date_passed: true });
  assert.deepEqual([old.stale, old.stale_reason], [false, null], "freshness belongs to the current version");
});

test("RD11 evidence_missing only above unknown; engagement labels, created follow-ups and skipped reasons are server words", () => {
  const section = assessmentSection(artifact({ scores: {
    move_likelihood: { level: "strong", confidence: "low", rationale: "r", conditions: [], score: 75, evidence: [] },
    transaction_intent: { level: "unknown", confidence: "low", rationale: "r", conditions: [], score: null, evidence: [] } },
  engagement: { work_status: "worked_with_next_step", rationale: "Rep spoke with the customer.", evidence: [],
    promised_callbacks: [{ by: "rep", raw_text: "I'll call you Friday", date: "2026-09-11", time_text: "morning", status: "pending", evidence: [] },
      { by: "customer", raw_text: "I'll call when I know", date: null, time_text: null, status: "unknown", evidence: [] }],
    next_steps: [{ action: "send_estimate", owner: "rep", description: "Email the estimate", date: null, date_text: "tonight", status: "planned", evidence: [] }] },
  engagement_effects: { applied: true, mark_worked: true, blocked: null, followup_ids: [IDS.followup],
    followups: [{ kind: "call", origin: "rep_promise", description: "Promised callback", source: "promised_callback", index: 0, commitment_key: "k" }],
    skipped: [{ source: "promised_callback", index: 1, reason: "status_unknown" }, { source: "next_step", index: 0, reason: "open_action_exists" }] } }),
  { applicability: "active", current: true });
  assessmentSectionSchema.parse(section);
  assert.equal(section.move_likelihood.evidence_missing, true);
  assert.equal(section.transaction_intent.evidence_missing, false, "unknown may cite nothing");
  const engagement = section.engagement!;
  assert.equal(engagement.work_status_label, "Worked, next step agreed");
  assert.deepEqual(engagement.promised_callbacks.map(c => [c.by_label, c.status_label, c.date_label, c.followup_created, c.followup_id]),
    [["Rep", "Pending", "Fri Sep 11, morning", true, IDS.followup], ["Customer", "Unclear", null, false, null]]);
  assert.deepEqual(engagement.next_steps.map(s => [s.action_label, s.status_label, s.date_label, s.followup_created]), [["Send estimate", "Planned", "\"tonight\"", false]]);
  assert.deepEqual(engagement.effects!.skipped.map(s => [s.reason_label, s.text]),
    [["Status unclear", "I'll call when I know"], ["An open follow-up of this kind exists", "Email the estimate"]]);
  assert.equal(engagement.effects!.blocked_label, null);
});

// ---------------------------------------------------------------- B19 evidence text (data spec §6.11 C, D11)

test("B19 assessment evidence: said_on_call, every move_evidence entry (D11 flat index), summary sections, Lead, official and correction refs carry text", () => {
  const summary = snapshot(IDS.summarySnapshot, summaryArtifactResponse());
  const section = assessmentSection(artifact(), { applicability: "active", current: false });
  const sources: EvidenceSources = { snapshots: new Map([[IDS.summarySnapshot, summary]]), runs: new Map(), conversations: new Map([[IDS.conversation, conversationRow()]]),
    findings: new Map([[IDS.finding, legacyFindings()[0]!]]), leads: new Set([`FormLead:${IDS.lead}`]), views: section.views, context_as_of: section.context_as_of,
    lead_flags: new Map([[`FormLead:${IDS.lead}`, { booked: null, cancelled: null }]]), as_of: "2026-09-23T12:00:00.000Z",
    instructions: new Map([[`${IDS.instruction}:2`, instructionRow()]]) };
  const refs = [summaryRef(), moveEvidenceRef(0), moveEvidenceRef(1), moveEvidenceRef(2), sectionRef("money_and_dates"), leadRef(), ingestedRef(), officialLeadRef(), correctionRef()];
  const items = new Map(evidenceSectionSchema.parse(evidenceSection(refs as never, sources)).items.map(item => [item.id, item]));
  assert.deepEqual([items.get("e1")?.text, items.get("e1")?.segment_ids, items.get("e1")?.source_label, items.get("e1")?.call_at],
    ["Customer said they move October 15", [3], "Said on the call", "2026-09-09T12:00:00.000Z"]);
  assert.deepEqual([items.get("e-move-0")?.text, items.get("e-move-0")?.segment_ids, items.get("e-move-0")?.speaker], ["Money: $4,200 quote", [5], "rep"]);
  assert.deepEqual([items.get("e-move-1")?.text, items.get("e-move-1")?.segment_ids], ["Inventory: Piano × 1 (Living room)", [6]]);
  assert.deepEqual([items.get("e-move-2")?.text, items.get("e-move-2")?.segment_ids], ["Ready to book: Ready to book this week", [7]]);
  assert.deepEqual([items.get("e-section-money_and_dates")?.text, items.get("e-section-money_and_dates")?.source_label],
    ["Budget around $2,000; moving October 15.", "Money and dates"]);
  assert.deepEqual([items.get("e2")?.record_label, items.get("e2")?.text, items.get("e2")?.as_of], ["Lead on file", "Move date: Oct 15, 2026", "2026-09-20T12:00:00.000Z"]);
  assert.deepEqual([items.get("e8")?.record_label, items.get("e8")?.text, items.get("e8")?.as_of], ["Original submission", "Move date: Oct 1, 2026", "2026-09-01T00:00:00.000Z"]);
  assert.deepEqual([items.get("e9")?.record_label, items.get("e9")?.text, items.get("e9")?.as_of], ["Official status", "Booked: no", "2026-09-23T12:00:00.000Z"]);
  assert.deepEqual([items.get("e7")?.record_label, items.get("e7")?.text], ["Owner correction", "Corrected a finding: Customer moves on the 20th, not the 15th"]);
  for (const [id, item] of items) assert.ok(item.text, `${id} carries text`);
  // Every citation the artifact itself carries resolves too (existing refs, including the legacy/official shapes of the older fixture).
  assert.ok(assessmentEvidenceRefs(artifact()).length > 0);
});

test("B19 run evidence: transcript items gain quote, speaker, exact time and purged_at; every record type gains label, text and as_of", () => {
  const summary = snapshot(IDS.summarySnapshot, summaryArtifactResponse(), { run_id: IDS.structuredRun });
  const context = snapshot(CONTEXT_SNAPSHOT, contextResponse(), { run_id: IDS.structuredRun, retrieved_at: new Date("2026-09-09T13:00:00Z") });
  const run = relationsRun();
  const recordRefs = RECORD_FIXTURES.map(r => envelopeEvidenceRef(IDS.structuredRun, { source: "vantage_record", snapshot_id: CONTEXT_SNAPSHOT,
    record_type: r.record_type as never, record_id: r.record_id, field_paths: ["status"] }));
  const transcriptRef = envelopeEvidenceRef(IDS.structuredRun, { source: "transcript", snapshot_id: IDS.summarySnapshot, conversation_id: IDS.conversation,
    transcript_version: "v1", segment_ids: [3, 4], quote: null });
  const sources: EvidenceSources = { snapshots: new Map([[IDS.summarySnapshot, summary], [CONTEXT_SNAPSHOT, context]]), runs: new Map([[IDS.structuredRun, run]]),
    conversations: new Map([[IDS.conversation, conversationRow()]]), findings: new Map(), leads: new Set(),
    transcripts: new Map([[IDS.transcriptSnapshot, transcriptRow()]]) };
  const items = evidenceSectionSchema.parse(evidenceSection([transcriptRef, ...recordRefs], sources)).items;
  const quote = items[0]!;
  assert.deepEqual([quote.quote, quote.text, quote.speaker, quote.at, quote.purged_at, quote.conversation_id, quote.segment_ids],
    ["We move on the fifteenth of October.", "We move on the fifteenth of October.", "customer", "2026-09-09T12:01:05.000Z", null, IDS.conversation, [3, 4]]);
  assert.equal(quote.speaker_label, "Customer");
  const types = new Set(RECORD_FIXTURES.map(r => r.record_type));
  assert.deepEqual([...types].sort(), [...EVIDENCE_RECORD_TYPES].sort(), "the fixture covers every citable record type");
  for (const item of items.slice(1)) {
    assert.ok(item.text, `${item.id} text`);
    assert.ok(item.record_label, `${item.id} label`);
    assert.ok(item.as_of, `${item.id} as_of`);
  }
  const byType = new Map(items.slice(1).map((item, i) => [RECORD_FIXTURES[i]!.record_type, item]));
  assert.deepEqual([byType.get("story_event")?.record_label, byType.get("story_event")?.text], ["Lead Message", "Vantage texted the estimate link."]);
  assert.deepEqual([byType.get("lead")?.record_label, byType.get("lead")?.text], ["Lead", "Synthetic Customer · Job J-100 · FormLead · Austin, TX · Denver, CO · 2026-10-15"]);
  assert.equal(byType.get("interaction")?.text, "Inbound · Accepted · Wed Sep 9, 8:00 AM ET · 312s");
  assert.equal(byType.get("prior_finding")?.record_label, "Earlier finding");
  assert.equal(byType.get("outreach")?.as_of, "2026-09-09T13:00:00.000Z", "a record without its own time is as of the snapshot");
  // A purged source transcript serves no text but keeps the citation and says when it was removed.
  const purgedAt = new Date("2026-09-15T00:00:00Z");
  const purged = evidenceSection([transcriptRef], { ...sources, snapshots: new Map([[IDS.summarySnapshot, { ...summary, purged_at: purgedAt }]]) }).items[0]!;
  assert.deepEqual([purged.availability, purged.text, purged.quote, purged.purged_at], ["purged", null, null, purgedAt.toISOString()]);
});

// ---------------------------------------------------------------- run presentation additions (data spec §6.11 B–C)

test("run presentation: finding fields, relations of all five kinds, story discrepancies, applied suggestion and instruction assessments", () => {
  const summary = snapshot(IDS.summarySnapshot, summaryArtifactResponse(), { run_id: IDS.structuredRun });
  const context = snapshot(CONTEXT_SNAPSHOT, contextResponse(), { run_id: IDS.structuredRun });
  const envelope = relationsRun().output as ReturnType<typeof legacyEnvelope>;
  const rows = [
    { _id: IDS.finding, run_id: IDS.structuredRun, revision: 1, key: "f1", assertion: envelope.findings[0], review_state: "unreviewed", purged_at: null, conversation_id: IDS.conversation,
      superseded_by: null, resolved: null },
    { _id: IDS.finding2, run_id: IDS.structuredRun, revision: 1, key: "f2", assertion: envelope.findings[1], review_state: "unreviewed", purged_at: null, conversation_id: IDS.conversation,
      superseded_by: null, resolved: { due_at: new Date("2026-09-12T16:00:00Z") } },
  ];
  const effects = [
    { _id: hex(41), finding_id: IDS.finding2, effect_kind: "supersede", status: "applied", reason: "superseded_by_later_finding", target_id: PRIOR.superseded },
    { _id: hex(42), finding_id: IDS.finding2, effect_kind: "create_followup", status: "applied", reason: null, target_id: IDS.followup },
    { _id: hex(43), finding_id: IDS.finding, effect_kind: "open_review", status: "needs_review", reason: "prior_finding_contradicted", target_id: hex(100) },
  ];
  const reviews: ReviewItemRow[] = [
    { _id: hex(100), cause_kind: "prior_contradiction", cause_key: PRIOR.contradicted, state: "open", evidence_ids: [PRIOR.contradicted, IDS.finding] },
    { _id: hex(101), cause_kind: "prior_fulfilled_unclaimed", cause_key: PRIOR.fulfilled, state: "open", evidence_ids: [PRIOR.fulfilled, IDS.finding2] },
    { _id: hex(102), cause_kind: "record_disputed_on_call", cause_key: STORY_EVENT, state: "open", evidence_ids: [IDS.finding, IDS.finding2] },
  ];
  const view = runPresentationSchema.parse(runPresentation({ run: relationsRun(), findings: rows, effects, actions: legacyActions(), summaries: [summary],
    snapshots: new Map([[CONTEXT_SNAPSHOT, context]]), review_items: reviews, prior_findings: priorFindings(), instructions: [instructionRow()],
    conversations: [conversationRow()], transcripts: [transcriptRow()],
    suggestion: { applied_at: new Date("2026-09-10T15:00:00Z"), followup_id: hex(51), followup_due_at: new Date("2026-09-11T14:00:00Z") } }));
  const s = view.summary_findings;
  const [f1, f2] = s.findings;
  assert.deepEqual([f1!.source_word, f1!.action_status_word, f1!.value_line, f1!.category, f1!.category_label, f1!.work_result, f1!.call_at],
    ["Customer said", null, "Move date: October 15", "move_facts", "Move facts", "not_applicable", "2026-09-09T12:00:00.000Z"],
    "the relation review and the disputed-record review do not make f1 need review");
  assert.deepEqual([f2!.source_word, f2!.action_status_word, f2!.value_line, f2!.category, f2!.work_result, f2!.work_result_detail, f2!.superseded_by],
    ["Rep said", "Promised", "Due Sat Sep 12, 12:00 PM ET", "commitments", "applied", "follow-up due Sep 12, 8:00 AM ET", null],
    "never Applied → supersede");
  assert.deepEqual(s.prior_finding_relations!.map(r => [r.relation, r.relation_word, r.group, r.prior_claim, r.by_finding_id, r.review_item_id]), [
    ["superseded", "Replaced", "changed", "Earlier claim (superseded)", IDS.finding2, null],
    ["fulfilled", "Done", "changed", "Earlier claim (fulfilled)", IDS.finding2, hex(101)],
    ["contradicted", "Contradicted on a later call", "changed", "Earlier claim (contradicted)", IDS.finding, hex(100)],
    ["still_true", "Still true", "unchanged", "Earlier claim (still_true)", null, null],
    ["cannot_determine", "Unclear", "unchanged", "Earlier claim (cannot_determine)", null, null]]);
  assert.equal(s.prior_finding_relations![0]!.by_claim, "Rep will call back Friday");
  assert.deepEqual(s.story_discrepancies, [{ story_event_id: STORY_EVENT, event_kind: "lead_message_sent", claim: "Customer says the estimate text never arrived",
    evidence: s.story_discrepancies![0]!.evidence, review_item_id: hex(102), review_item_state: "open" }]);
  assert.deepEqual(s.owner_instruction_assessments, [{ instruction_id: IDS.instruction, instruction_revision: 2,
    instruction_text: "Corrected a finding: Customer moves on the 20th, not the 15th", assessment: "disagrees", assessment_word: "Disagrees", reason: "The call says the 15th." }]);
  assert.deepEqual([s.suggested_next_step?.action_label, s.suggested_next_step?.applied_at, s.suggested_next_step?.followup_id, s.suggested_next_step?.followup_due_at],
    ["Send estimate", "2026-09-10T15:00:00.000Z", hex(51), "2026-09-11T14:00:00.000Z"]);
  // Relation and discrepancy citations resolve in the run's evidence section with transcript text from the source snapshot.
  const relationEvidence = view.evidence.items.find(item => item.id === s.story_discrepancies![0]!.evidence[0]!.id)!;
  assert.deepEqual([relationEvidence.quote, relationEvidence.at], ["We move on the fifteenth of October.", "2026-09-09T12:01:05.000Z"]);
  const record = view.evidence.items.find(item => item.kind === "analysis_record")!;
  assert.deepEqual([record.record_label, record.text], ["Lead", "Synthetic Customer · Job J-100 · FormLead · Austin, TX · Denver, CO · 2026-10-15"]);
  // Not applied: nulls, never invented.
  const unapplied = runPresentation({ run: relationsRun(), findings: rows, effects: [], actions: [], summaries: [summary], snapshots: new Map() });
  assert.deepEqual([unapplied.summary_findings.suggested_next_step?.applied_at, unapplied.summary_findings.suggested_next_step?.followup_id], [null, null]);
  assert.equal(unapplied.summary_findings.prior_finding_relations![2]!.review_item_id, null);
});

test("superseded and retracted findings read as their work result; envelope-only findings keep the fields", () => {
  const envelope = relationsRun().output as ReturnType<typeof legacyEnvelope>;
  const rows = [{ _id: IDS.finding, run_id: IDS.structuredRun, revision: 2, key: "f1", assertion: envelope.findings[0], review_state: "retracted", purged_at: null },
    { _id: IDS.finding2, run_id: IDS.structuredRun, revision: 2, key: "f2", assertion: envelope.findings[1], review_state: "unreviewed", purged_at: null, superseded_by: hex(96) }];
  const view = runPresentation({ run: relationsRun(), findings: rows, effects: [], actions: [], summaries: [], snapshots: new Map() });
  assert.deepEqual(view.summary_findings.findings.map(f => [f.work_result, f.work_result_detail, f.superseded_by]), [["retracted", null, null], ["superseded", hex(96), hex(96)]]);
  const envelopeOnly = runPresentation({ run: relationsRun(), findings: [], effects: [], actions: [], summaries: [], snapshots: new Map() });
  assert.deepEqual(envelopeOnly.summary_findings.findings.map(f => [f.work_result, f.value_line]), [["not_applicable", "Move date: October 15"],
    ["not_applicable", "Date said: \"Friday\" (not resolved)"]]);
  assert.equal(envelopeOnly.summary_findings.prior_finding_relations![0]!.by_finding_id, `${IDS.structuredRun}:f2`);
});

test("section typing: the new fields parse under the server schema for every availability", () => {
  for (const status of ["ready", "insufficient_evidence", "failed", "purged"]) {
    const section: AssessmentSection = assessmentSection(artifact({ status, ...(status === "purged" ? { purged_at: new Date() } : {}) }),
      { applicability: "active", current: true, newer_calls_count: 0 });
    assessmentSectionSchema.parse(section);
    assert.equal(Boolean(section.move_table), ["ready", "insufficient_evidence"].includes(status), status);
  }
});
