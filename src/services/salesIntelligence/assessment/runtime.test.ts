import assert from "node:assert/strict";
import { test } from "node:test";
import type { ClientSession } from "mongoose";
import { Types } from "mongoose";
import type { AssessmentContext, AssessmentSkip } from "./context";
import {
  assessmentProviderFailure, assessmentStatusFor, changeTriggersMoveAssessment, drainMoveAssessmentJobs, moveAssessmentRuntimeConfiguration,
  nominateMoveAssessment, nominateMoveAssessmentForNumber, projectionFor, publicationDecision, runMoveAssessmentJob,
} from "./runtime";

function withEnv<T>(values: Record<string, string | undefined>, fn: () => Promise<T>) {
  const prior = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  return fn().finally(() => { for (const [key, value] of Object.entries(prior)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
}
// No Mongo is reachable here: a disabled path that touched the queue would fail on the missing session/connection.
const noSession = {} as ClientSession;

test("flag off returns disabled before any claim unless forced; ENABLED off always disables", async () => {
  await withEnv({ SALES_INTELLIGENCE_ENABLED: "true", SALES_INTELLIGENCE_MOVE_ASSESSMENT: "false" }, async () => {
    assert.deepEqual(await runMoveAssessmentJob(), { status: "disabled" });
    assert.equal((await drainMoveAssessmentJobs()).status, "disabled");
    assert.equal(await nominateMoveAssessment({ outreach_record_id: String(new Types.ObjectId()), trigger: "summary:x" }, noSession), null);
    assert.deepEqual(await nominateMoveAssessmentForNumber(String(new Types.ObjectId()), "summary:x", noSession), []);
  });
  await withEnv({ SALES_INTELLIGENCE_ENABLED: "false", SALES_INTELLIGENCE_MOVE_ASSESSMENT: "true" }, async () => {
    assert.deepEqual(await runMoveAssessmentJob(undefined, { force: true }), { status: "disabled" });
    assert.equal((await drainMoveAssessmentJobs({ force: true })).status, "disabled");
  });
});

test("runtime configuration names the company credential and reads analysis pricing", async () => {
  await withEnv({ SALES_INTELLIGENCE_EXTRACTION_MODEL: "openai/gpt-5-mini", SALES_INTELLIGENCE_ANALYSIS_PRICING_VERSION: "p1",
    SALES_INTELLIGENCE_ANALYSIS_INPUT_CENTS_PER_MILLION: "25", SALES_INTELLIGENCE_ANALYSIS_OUTPUT_CENTS_PER_MILLION: "200" }, async () => {
    const config = moveAssessmentRuntimeConfiguration();
    assert.equal(config.model_id, "openai/gpt-5-mini");
    assert.equal(config.credential, "AI_GATEWAY_API_KEY");
    assert.deepEqual(config.pricing, { version: "p1", input_cents_per_million: 25, output_cents_per_million: 200 });
  });
  await withEnv({ SALES_INTELLIGENCE_ANALYSIS_PRICING_VERSION: undefined }, async () => assert.equal(moveAssessmentRuntimeConfiguration().pricing, null));
});

const dim = (level: "unknown" | "active" | "confirmed", score: number | null) => ({ level, score, confidence: "medium" as const, rationale: "r",
  evidence_ids: [], conditions: [], evidence: [] });
test("insufficient evidence only when both dimensions are unknown and nothing was stated", () => {
  const empty = { scores: { move_likelihood: dim("unknown", null), transaction_intent: dim("unknown", null) }, move_details: [],
    inventory: { items: [], coverage: "none" as const, limitations: [] } };
  assert.equal(assessmentStatusFor(empty), "insufficient_evidence");
  assert.equal(assessmentStatusFor({ ...empty, scores: { ...empty.scores, move_likelihood: dim("active", 50) } }), "ready");
  assert.equal(assessmentStatusFor({ ...empty, inventory: { ...empty.inventory, items: [{} as never] } }), "ready");
});

test("only meaningful canonical move paths on Leads trigger a nomination", () => {
  assert.equal(changeTriggersMoveAssessment({ entity: { model: "FormLead" }, changed_paths: ["move_date"] }), true);
  assert.equal(changeTriggersMoveAssessment({ entity: { model: "CallLead" }, changed_paths: ["current_move_provenance.changed_at"] }), true);
  assert.equal(changeTriggersMoveAssessment({ entity: { model: "FormLead" }, changed_paths: ["granot_priority", "quoted"] }), false);
  assert.equal(changeTriggersMoveAssessment({ entity: { model: "Booking" }, changed_paths: ["move_date"] }), false);
});

test("provider failures follow analysis semantics", () => {
  assert.equal(assessmentProviderFailure({ statusCode: 429, responseHeaders: { "retry-after": "120" } })?.retryAfterMs, 120_000);
  assert.equal(assessmentProviderFailure({ statusCode: 401 })?.kind, "permission_denied");
  assert.equal(assessmentProviderFailure({ status: 503 })?.kind, "transient");
  assert.equal(assessmentProviderFailure(new Error("validation")), null);
});

const artifactId = new Types.ObjectId();
const artifact = { _id: artifactId, status: "ready", input_fingerprint: "fp1", schema_version: "move-assessment-v1", subject_key: "lead:FormLead:x",
  shadow: false, context_as_of: new Date("2026-09-22T12:00:00Z"), latest_conversation_at: null,
  scores: { move_likelihood: { score: 100, confidence: "high" }, transaction_intent: { score: 0, confidence: "medium" } } };
const fresh = (fingerprint: string) => ({ fingerprint } as AssessmentContext);
const skip = (kind: AssessmentSkip["skip"]): AssessmentSkip => ({ skip: kind, reason: kind, subject_key: "s", outreach_record_id: "r" });
const open = { state: "open", lead_progress: null, move_assessment: null };

test("projection carries numeric scores, confidences and the fenced revision", () => {
  const now = new Date("2026-09-22T13:00:00Z");
  const projection = projectionFor(artifact, 7, now);
  assert.equal(projection.move_likelihood, 100);
  assert.equal(projection.transaction_intent, 0);
  assert.equal(projection.move_likelihood_confidence, "high");
  assert.equal(projection.eligibility_revision, 7);
  assert.equal(projection.stale, false);
  assert.equal(projection.published_at, now);
  assert.equal(projectionFor({ ...artifact, status: "insufficient_evidence", scores: null }, 1, now).move_likelihood, null);
});

test("publication fence: changed inputs are stale, closed/terminal work is fenced, current is a no-op", () => {
  const decide = (over: Partial<Parameters<typeof publicationDecision>[0]>) =>
    publicationDecision({ artifact, fresh: fresh("fp1"), record: open, closure: null, ...over });
  assert.equal(decide({}), "published");
  assert.equal(decide({ fresh: fresh("fp2") }), "stale_input");
  assert.equal(decide({ fresh: skip("skipped_no_summary") }), "stale_input");
  assert.equal(decide({ fresh: skip("not_applicable") }), "fenced");
  assert.equal(decide({ fresh: skip("ambiguous_subject") }), "fenced");
  assert.equal(decide({ record: { ...open, state: "closed" } }), "fenced");
  assert.equal(decide({ record: null }), "fenced");
  assert.equal(decide({ closure: "booked" }), "fenced");
  assert.equal(decide({ record: { ...open, lead_progress: { disposition: "crm_dead", provenance: "accepted", override: null } } }), "fenced");
  assert.equal(decide({ record: { ...open, lead_progress: { disposition: "crm_dead", provenance: "uncertain", override: null } } }), "published");
  assert.equal(decide({ artifact: { ...artifact, status: "pending" } }), "fenced");
  assert.equal(decide({ record: { ...open, move_assessment: { artifact_id: artifactId, status: "ready", stale: false } } }), "current");
  assert.equal(decide({ record: { ...open, move_assessment: { artifact_id: artifactId, status: "ready", stale: true } } }), "published");
  assert.equal(decide({ record: { ...open, move_assessment: { artifact_id: new Types.ObjectId(), status: "ready", stale: false,
    context_as_of: new Date("2026-09-23T00:00:00Z") } } }), "fenced", "an older artifact never replaces newer context");
  assert.equal(decide({ record: { ...open, move_assessment: { artifact_id: new Types.ObjectId(), status: "ready", stale: false,
    context_as_of: new Date("2026-09-21T00:00:00Z") } } }), "published");
});
