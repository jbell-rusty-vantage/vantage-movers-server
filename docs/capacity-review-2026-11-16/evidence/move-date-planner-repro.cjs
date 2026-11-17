// Pure synthetic planner reproduction. Does not load credentials, connect to Mongo,
// call providers, or mutate runtime code/data. Run from repository root:
// node --import tsx docs/capacity-review-2026-11-16/evidence/move-date-planner-repro.cjs
const assert = require('node:assert/strict');
const { planLeadDesiredState } = require('../../../src/services/granotLifecycle/leadDesiredState.ts');
const capturedAt = new Date('2026-11-16T12:00:00Z');
const moveDate = new Date('2026-12-01T00:00:00Z');
const lead = { model: 'CallLead', id: '000000000000000000000001', normalized_job_no: 'TEST100', granot_priority: '0' };
const input = {
  observation: { _id: '000000000000000000000002', captured_at: capturedAt, kind: 'lead_snapshot', normalization_result: 'valid', priority: { valid: true, canonical: '0' }, identity: { normalized_job_no: 'TEST100' }, move: { move_date: moveDate }, issues: [] },
  identity: { outcome: 'linked', reason_code: 'record_link_confirmed', target: { model: 'CallLead', id: lead.id }, target_eligibility: 'full', candidates: [], agent_assertion: 'empty' },
  policy: {}, temporal_order: 'newer', now: capturedAt, attempt: 1, receiver_latest_wins: false,
};
const missing = planLeadDesiredState({ ...input, lead });
const complete = planLeadDesiredState({ ...input, lead: { ...lead, move_date: moveDate } });
assert.equal(missing.outcome, 'applied');
assert.deepEqual(missing.changed_paths, ['move_date']);
assert.equal(complete.outcome, 'already_current');
assert.deepEqual(complete.changed_paths, []);
assert.equal(missing.temporal_winner_should_advance, true);
assert.equal(complete.temporal_winner_should_advance, true);
console.log(JSON.stringify({
  scope: 'pure planner, synthetic values; actual projection omission verified by source inspection',
  current_missing_projection: { outcome: missing.outcome, changed_paths: missing.changed_paths, advances: missing.temporal_winner_should_advance },
  complete_projection: { outcome: complete.outcome, changed_paths: complete.changed_paths, advances: complete.temporal_winner_should_advance },
}, null, 2));
