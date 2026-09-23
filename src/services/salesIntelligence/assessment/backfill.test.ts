import assert from "node:assert/strict";
import { test } from "node:test";
import { assessmentStepContract } from "./contract";
import {
  admit, applyCapChanges, assertCountersMonotonic, backfillManifestSchema, backfillReport, BACKFILL_CREDENTIAL, CANARY_SIZE,
  createManifest, estimateAttemptCents, manifestStore, outcomeFromJobResult, promotionDecision, reconcileAttempt, reserveAttempt,
  rowUpdateFor, selectCohort, stratumOf, zeroCounters, ASSUMED_OUTPUT_TOKENS, P95_MIN_SAMPLES, REPAIR_MARGIN,
  type BackfillCandidate, type BackfillCaps, type BackfillManifest, type ReservationSummary,
} from "./backfill";

const hex = (n: number) => n.toString(16).padStart(24, "0");
function candidate(n: number, lead_model: BackfillCandidate["lead_model"], kinds: BackfillCandidate["summary_kinds"], extra: Partial<BackfillCandidate> = {}): BackfillCandidate {
  return { subject_key: `lead:${lead_model ?? "FormLead"}:${hex(n)}`, outreach_record_id: hex(1000 + n), lead_model, cohort: kinds.length ? "summary" : "lead_only",
    summary_kinds: kinds, selected_sources: [{ kind: "summary_artifact", id: hex(5000 + n), version: `digest-${n}` }], fingerprint: `fp-${n}`,
    estimated_input_bytes: 4000, estimated_cents: 3, ...extra };
}
const caps = (over: Partial<BackfillCaps> = {}): BackfillCaps => ({ max_subjects: 25, max_total_cents: 100, max_attempts_per_subject: 2, concurrency: 2, ...over });
const manifest = (candidates: BackfillCandidate[], over: Partial<BackfillCaps> = {}, cohort: "summary" | "lead_only" = "summary") => createManifest({
  manifest_id: "mabf-sum-test-abc123", cohort, cutoff: new Date("2026-09-22T00:00:00Z"), dataset: { deployment: "d", database: "testvantagemovers_x" },
  model: "openai/gpt-5-mini", caps: caps(over), candidates, subject_filter: null, now: new Date("2026-09-22T01:00:00Z"),
  estimate: { basis: "list_pricing", assumption: "test", hold_floor_cents: 0 } });
const population = () => [
  candidate(1, "FormLead", ["structured"]), candidate(2, "FormLead", ["legacy"]), candidate(3, "CallLead", ["structured"]),
  candidate(4, "CallLead", ["conversation_summary"]), candidate(5, "FormLead", ["structured", "legacy"]), candidate(6, "FormLead", ["structured"]),
  candidate(7, "CallLead", ["legacy"]), candidate(8, "FormLead", [], { cohort: "lead_only" }),
];
const reservation = (id: string, over: Partial<ReservationSummary> = {}): ReservationSummary => ({ reservation_id: id,
  step: `assessment:${hex(9)}:${BACKFILL_CREDENTIAL}:1`, status: "reconciled", usage_complete: true, actual_cents: 2, observed_cents: 2,
  input_tokens: 900, output_tokens: 120, ...over });

test("manifest: strict schema, pinned contract and personal credential, rows frozen in stratified order", () => {
  const m = manifest(population());
  assert.deepEqual(m.contract, assessmentStepContract());
  assert.equal(m.credential, "PERSONAL_AI_GATEWAY_API_KEY");
  assert.equal(m.rows.length, 7, "the Lead-only subject is not in the summary cohort");
  assert.ok(m.rows.every(row => row.status === "planned" && row.attempts === 0 && !row.admitted));
  assert.deepEqual(m.counters, zeroCounters());
  const json = JSON.parse(JSON.stringify(m));
  assert.deepEqual(backfillManifestSchema.parse(json), m, "round-trips through JSON");
  assert.throws(() => backfillManifestSchema.parse({ ...json, narrative: "x" }), "unknown top-level field refused");
  assert.throws(() => backfillManifestSchema.parse({ ...json, rows: [{ ...json.rows[0], summary_text: "x" }] }), "unknown row field refused");
  assert.throws(() => backfillManifestSchema.parse({ ...json, credential: "AI_GATEWAY_API_KEY" }), "company credential refused");
  assert.throws(() => backfillManifestSchema.parse({ ...json, model: "openai/gpt-4o" }), "unlisted model refused");
  assert.throws(() => backfillManifestSchema.parse({ ...json, caps: { ...json.caps, concurrency: 5 } }), "concurrency above 4 refused");
  assert.throws(() => backfillManifestSchema.parse({ ...json, counters: { ...json.counters, cents_actual: -1 } }));
  const leadOnly = manifest(population(), {}, "lead_only");
  assert.deepEqual(leadOnly.rows.map(r => [r.stratum, r.summary_kinds]), [["FormLead:lead_only", []]]);
});

test("cohort: deterministic regardless of input order; stratified round-robin; canary is the first five; excess is deferred", () => {
  const rows = population().filter(c => c.cohort === "summary");
  const first = selectCohort(rows, { max_subjects: 5 });
  const shuffled = selectCohort([...rows].reverse().concat(rows.slice(0, 2)), { max_subjects: 5 });
  assert.deepEqual(shuffled, first, "same selection whatever the order (duplicates collapse by subject)");
  assert.deepEqual(first.ordered.map(stratumOf), [
    "CallLead:conversation_summary", "CallLead:legacy", "CallLead:structured", "FormLead:legacy", "FormLead:structured",
    "FormLead:structured", "FormLead:structured"]);
  assert.equal(first.selected.length, 5);
  assert.deepEqual(first.canary, first.selected.slice(0, CANARY_SIZE).map(c => c.subject_key));
  assert.deepEqual(first.deferred.map(d => d.subject_key), first.ordered.slice(5).map(c => c.subject_key));
  assert.equal(stratumOf(candidate(5, "FormLead", ["legacy", "structured"])), "FormLead:structured", "preferred kind decides the stratum");
  const m = manifest(rows, { max_subjects: 5 });
  assert.equal(m.selection.deferred.length, 2);
  assert.deepEqual(m.rows.filter(r => r.canary).map(r => r.subject_key), first.canary);
  const wide = selectCohort(rows, { max_subjects: 25 });
  assert.equal(wide.deferred.length, 0);
  assert.equal(wide.canary.length, 5, "a 25-subject cohort still has a five-subject canary");
});

test("admission: subjects, money (including concurrent in-flight holds) and per-subject attempts", () => {
  const m = manifest(population().filter(c => c.cohort === "summary"), { max_subjects: 3, max_total_cents: 10 });
  m.caps.max_subjects = 2; // three frozen rows, two admissions allowed
  const [a, b, c] = m.rows;
  assert.deepEqual(reserveAttempt(m, a, 4), { ok: true });
  assert.deepEqual(reserveAttempt(m, b, 4), { ok: true });
  assert.equal(m.counters.subjects_admitted, 2);
  // Two holds in flight (8 cents): a third 4-cent attempt would exceed 10 even before any reconciliation.
  assert.deepEqual(admit(m, a, 4), { ok: false, reason: "max_total_cents" });
  assert.deepEqual(admit(m, c, 1), { ok: false, reason: "max_subjects" });
  assert.deepEqual(reserveAttempt(m, c, 1), { ok: false, reason: "max_subjects" });
  assert.equal(c.admitted, false);
  // Reconcile: complete usage charges actual cents and releases the hold.
  assert.equal(reconcileAttempt(m, a, [reservation("r-a", { actual_cents: 2 })]), true);
  assert.equal(a.hold_cents, 0);
  assert.equal(m.counters.cents_reserved, 2);
  assert.deepEqual(admit(m, a, 4), { ok: true }, "2 charged + 4 in flight + 4 = 10");
  assert.deepEqual(admit(m, a, 5), { ok: false, reason: "max_total_cents" });
  // Attempts cap for one subject, independent of money.
  const tight = manifest(population().filter(x => x.cohort === "summary"), { max_attempts_per_subject: 1 });
  reserveAttempt(tight, tight.rows[0], 1);
  reconcileAttempt(tight, tight.rows[0], []);
  assert.deepEqual(admit(tight, tight.rows[0], 1), { ok: false, reason: "max_attempts_per_subject" });
});

test("reconciliation: incomplete usage stays reserved; a reservation is charged once; a non-personal step is flagged", () => {
  const m = manifest(population().filter(c => c.cohort === "summary"));
  const row = m.rows[0];
  reserveAttempt(m, row, 6);
  assert.equal(reconcileAttempt(m, row, [reservation("r1", { usage_complete: false, actual_cents: 1, observed_cents: 1 })]), true);
  assert.equal(m.counters.cents_reserved, 6, "max(observed, hold) stays charged");
  assert.equal(m.counters.cents_actual, 1);
  assert.equal(m.counters.cents_incomplete, 6);
  assert.equal(m.counters.incomplete_attempts, 1);
  assert.equal(row.usage_complete, false);
  reserveAttempt(m, row, 6);
  assert.equal(m.counters.retries, 1);
  assert.equal(reconcileAttempt(m, row, [reservation("r1"), reservation("r2", { status: "reserved", usage_complete: true, actual_cents: null, observed_cents: 0 })]), true);
  assert.equal(m.counters.cents_reserved, 12, "r1 not charged twice; an open reservation holds the full estimate");
  assert.deepEqual(row.reservations, ["r1", "r2"]);
  assert.equal(m.counters.input_tokens, 1800);
  reserveAttempt(m, m.rows[1], 1);
  assert.equal(reconcileAttempt(m, m.rows[1], [reservation("r3", { step: `assessment:${hex(1)}:AI_GATEWAY_API_KEY:1` })]), false);
});

test("resume: attempt caps and counters persist; counters never decrease; max_subjects is frozen; other cap changes are recorded", async () => {
  const m = manifest(population().filter(c => c.cohort === "summary"), { max_attempts_per_subject: 2 });
  const row = m.rows[0];
  reserveAttempt(m, row, 2); reconcileAttempt(m, row, [reservation("a1", { usage_complete: false })]);
  reserveAttempt(m, row, 2); reconcileAttempt(m, row, [reservation("a2", { usage_complete: false })]);
  const saved: BackfillManifest[] = [];
  const store = manifestStore(m, async value => { saved.push(value); });
  await store.checkpoint();
  const resumed = backfillManifestSchema.parse(JSON.parse(JSON.stringify(saved[0])));
  assert.deepEqual(admit(resumed, resumed.rows[0], 1), { ok: false, reason: "max_attempts_per_subject" }, "attempts persist across resume");
  assert.equal(resumed.counters.attempts_total, 2);
  const before = { ...resumed.counters };
  applyCapChanges(resumed, { ...resumed.caps, max_total_cents: 500, max_attempts_per_subject: 3 }, new Date("2026-09-23T00:00:00Z"));
  assert.deepEqual(resumed.counters, before, "cap changes never touch counters");
  assert.deepEqual(resumed.cap_changes.map(c => [c.field, c.from, c.to]), [["max_total_cents", 100, 500], ["max_attempts_per_subject", 2, 3]]);
  assert.throws(() => applyCapChanges(resumed, { ...resumed.caps, max_subjects: 26 }), /INVALID_INPUT/);
  assert.throws(() => assertCountersMonotonic(before, { ...before, cents_reserved: before.cents_reserved - 1 }), /REVISION_CONFLICT/);
  m.counters.attempts_total = 0;
  assert.throws(() => store.checkpoint(), /REVISION_CONFLICT/, "a checkpoint refuses decreased counters");
});

test("promotion: only an accepted shadow artifact whose contract and current fingerprint still match", () => {
  const contract = assessmentStepContract();
  const artifact = { status: "ready", shadow: true, input_fingerprint: "fp-1", purged_at: null, prompt_digest: contract.prompt_digest,
    schema_digest: contract.schema_digest, schema_version: contract.schema_version, rubric_version: contract.rubric_version };
  const base = { manifest_contract: contract, current_contract: contract, artifact, row_fingerprint: "fp-1", fresh: { fingerprint: "fp-1" } };
  assert.deepEqual(promotionDecision(base), { action: "promote" });
  assert.deepEqual(promotionDecision({ ...base, artifact: { ...artifact, status: "insufficient_evidence" } }), { action: "promote" });
  assert.deepEqual(promotionDecision({ ...base, fresh: { fingerprint: "fp-2" } }), { action: "stale_input", reason: "input_changed" });
  assert.deepEqual(promotionDecision({ ...base, current_contract: { ...contract, prompt_digest: "other" } }), { action: "stale_input", reason: "contract_changed" });
  assert.deepEqual(promotionDecision({ ...base, artifact: { ...artifact, schema_digest: "old" } }), { action: "stale_input", reason: "contract_changed" });
  assert.deepEqual(promotionDecision({ ...base, fresh: { skip: "not_applicable" } }), { action: "skip", reason: "not_applicable" });
  assert.deepEqual(promotionDecision({ ...base, artifact: { ...artifact, shadow: false } }), { action: "skip", reason: "shadow_artifact_missing" });
  assert.deepEqual(promotionDecision({ ...base, artifact: { ...artifact, status: "purged" } }), { action: "skip", reason: "purged" });
  assert.deepEqual(promotionDecision({ ...base, artifact: { ...artifact, status: "pending" } }), { action: "skip", reason: "artifact_pending" });
  assert.deepEqual(promotionDecision({ ...base, artifact: null }), { action: "skip", reason: "shadow_artifact_missing" });
});

test("inventory estimate: trailing p95 when sampled, else list pricing from bytes/4 with the stated output and repair margin", () => {
  const pricing = { version: "p", input_cents_per_million: 25, output_cents_per_million: 200 };
  const list = estimateAttemptCents({ input_bytes: 40_000, pricing, p95_cents: null, samples: 0 });
  assert.equal(list.basis, "list_pricing");
  const system = Buffer.byteLength((require("./contract") as typeof import("./contract")).MOVE_ASSESSMENT_PROMPT, "utf8");
  const expected = Math.ceil(((Math.ceil((40_000 + system) / 4) * 25 + ASSUMED_OUTPUT_TOKENS * 200) / 1_000_000) * REPAIR_MARGIN);
  assert.equal(list.cents, Math.max(1, expected));
  assert.equal(estimateAttemptCents({ input_bytes: 10, pricing: { ...pricing, input_cents_per_million: 1, output_cents_per_million: 1 }, p95_cents: null, samples: 0 }).cents, 1, "never below one cent");
  assert.deepEqual(estimateAttemptCents({ input_bytes: 40_000, pricing, p95_cents: 7, samples: P95_MIN_SAMPLES }), { cents: 7, basis: "trailing_p95" });
  assert.equal(estimateAttemptCents({ input_bytes: 40_000, pricing, p95_cents: 7, samples: P95_MIN_SAMPLES - 1 }).basis, "list_pricing", "too few samples");
  assert.deepEqual(estimateAttemptCents({ input_bytes: 40_000, pricing: null, p95_cents: null, samples: 0 }), { cents: 5, basis: "default_nominal" });
});

test("outcome mapping: shadow completes, apply publishes; fences, stale inputs, skips and pauses stay visible", () => {
  assert.deepEqual(rowUpdateFor("shadow", { status: "shadow_completed", artifact_id: hex(1) }), { status: "completed" });
  assert.deepEqual(rowUpdateFor("shadow", { status: "reused" }), { status: "completed", reason: "reused" });
  assert.deepEqual(rowUpdateFor("apply", { status: "completed", reason: "published" }), { status: "published" });
  assert.deepEqual(rowUpdateFor("apply", { status: "completed", reason: "fenced" }), { status: "skipped", reason: "fenced" });
  assert.deepEqual(rowUpdateFor("apply", { status: "reused", reason: "reused_published" }), { status: "published", reason: "reused" });
  assert.deepEqual(rowUpdateFor("apply", { status: "stale_input", reason: "stale_input" }), { status: "stale_input", reason: "input_changed" });
  assert.deepEqual(rowUpdateFor("apply", { status: "paused", reason: "budget_exhausted" }), { status: "paused", reason: "budget_exhausted" });
  assert.deepEqual(rowUpdateFor("shadow", { status: "retry", reason: "assessment_failed" }), { status: "failed", reason: "assessment_failed" });
  assert.deepEqual(rowUpdateFor("shadow", { status: "skipped", reason: "ambiguous_subject" }), { status: "skipped", reason: "ambiguous_subject" });
  assert.deepEqual(outcomeFromJobResult("shadow", { reason: "shadow_completed", artifact_id: hex(2) }), { status: "shadow_completed", artifact_id: hex(2) });
  assert.deepEqual(outcomeFromJobResult("apply", { reason: "published", artifact_id: hex(2) }), { status: "completed", reason: "published", artifact_id: hex(2) });
  assert.deepEqual(outcomeFromJobResult("apply", { reason: "not_applicable" }), { status: "skipped", reason: "not_applicable" });
});

test("report: counts, distributions and reimbursement lines without narrative", () => {
  const m = manifest(population().filter(c => c.cohort === "summary"), { max_subjects: 5 });
  reserveAttempt(m, m.rows[0], 2); reconcileAttempt(m, m.rows[0], [reservation("x")]);
  m.rows[0].status = "completed"; m.rows[0].shadow_artifact_id = hex(77);
  const report = backfillReport(m, [{ _id: hex(77), shadow: true, status: "ready", input_mode: "summaries",
    scores: { move_likelihood: { level: "strong", score: 75, confidence: "medium", rationale: "SECRET" }, transaction_intent: { level: "unknown", score: null, confidence: "low" } },
    inventory: { coverage: "partial", source_coverage: "complete", items: [{ label: "SECRET" }] }, conflicts: [{}, {}] }]);
  assert.deepEqual(report.scores.move_likelihood, { score: { 75: 1 }, confidence: { medium: 1 } });
  assert.deepEqual(report.scores.transaction_intent.score, { unknown: 1 });
  assert.equal(report.conflicts, 2);
  assert.equal(report.deferred, 2);
  assert.deepEqual(report.inventory_coverage, { partial: 1 });
  assert.ok(report.reimbursement.includes("credential: PERSONAL_AI_GATEWAY_API_KEY"));
  assert.ok(report.reimbursement.includes("charged to the operator's personal gateway key; the owner reimburses"));
  assert.ok(report.reimbursement.some(line => line === "actual cost: 2 cents (charged against cap: 2 cents of 100)"));
  assert.equal(JSON.stringify(report).includes("SECRET"), false);
});
