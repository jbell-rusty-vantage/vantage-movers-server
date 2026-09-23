import assert from "node:assert/strict";
import test from "node:test";
import { LEVEL_SCORES } from "./contract";
import { levelLabel, moveAssessmentProjectionDto, projectionLevel } from "./presentation";

test("projectionLevel maps every contract score back to its level (final spec §5.4)", () => {
  for (const [level, score] of Object.entries(LEVEL_SCORES)) {
    if (score === null) continue;
    assert.equal(projectionLevel(score, true), level);
  }
  assert.equal(projectionLevel(null, true), "unknown", "a scored status without a number is the model's unknown");
  assert.equal(projectionLevel(75, false), null, "not actionable: no level");
  assert.equal(projectionLevel(62, true), null, "a number outside the contract never invents a level");
  assert.deepEqual([levelLabel("strong"), levelLabel("unknown"), levelLabel(null)], ["Strong", "Unknown", null]);
});

test("the card projection carries the level word next to the number", () => {
  const projection = { artifact_id: "a".repeat(24), status: "ready", transaction_intent: 75, move_likelihood: 100,
    transaction_intent_confidence: "high", move_likelihood_confidence: "medium", context_as_of: new Date("2026-09-20T12:00:00Z"),
    latest_conversation_at: new Date("2026-09-20T11:00:00Z"), stale: false, stale_reason: null, published_at: new Date("2026-09-20T12:00:00Z") };
  const record = { state: "open", subject: { kind: "lead", model: "FormLead", id: "b".repeat(24) }, lead_progress: null, move_assessment: projection } as never;
  const dto = moveAssessmentProjectionDto(record)!;
  assert.deepEqual([dto.transaction_intent, dto.transaction_intent_level, dto.transaction_intent_level_label], [75, "strong", "Strong"]);
  assert.deepEqual([dto.move_likelihood, dto.move_likelihood_level, dto.move_likelihood_level_label], [100, "confirmed", "Confirmed"]);
  const closed = moveAssessmentProjectionDto({ ...(record as object), state: "closed" } as never)!;
  assert.deepEqual([closed.transaction_intent, closed.transaction_intent_level, closed.transaction_intent_level_label], [null, null, null]);
});
