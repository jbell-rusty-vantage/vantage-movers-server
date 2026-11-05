import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyContactSources } from '../contacts/apply';
import { ContextBuilder, MemoryContactEventStore, outboundCall, subjectFacts } from '../contacts/testing';
import { evaluateAndProject, evaluationAdmissionOf } from '../evaluation/evaluateJob';
import { capturedCoverage, completeConfigurationInput, MemoryEvaluationStore } from '../evaluation/testing';
import { activeInspection } from '../reads/testing';
import { refreshLeadForOutreach } from './leadChangeJob';
import { accepted, deskConfiguration, fakeSession, leadFacts, MemoryDeskSubjectStore, objectId } from './testing';

test('Granot refresh and late contact derivation converge in either order without duplicate credit or period resets', async () => {
  for (const contactFirst of [false, true]) {
    const now = new Date('2026-10-05T14:40:00Z');
    const subjects = new MemoryDeskSubjectStore();
    const config = deskConfiguration({ transition: { intake_admission_enabled:true, intake_admission_at:'2026-10-01T00:00:00Z' } });
    let lead = subjects.addLead(leadFacts({ timestamp:new Date('2026-10-05T10:00:00Z'), created_at:new Date('2026-10-05T14:00:05Z'), ...accepted('0', '2026-10-05T14:00:00Z') }));
    await refreshLeadForOutreach(lead.ref, config, now, subjects, fakeSession);
    const subject = subjects.subjects[0]!;
    const periods = structuredClone(subjects.periods);
    const number = objectId(), agent = objectId();
    const context = new ContextBuilder().link(agent, '101');
    const key = `FormLead:${lead.ref.id}` as const;
    context.attached.set(number, [key]);
    context.subjects.set(key, subjectFacts({ id:subject.id, revision:subject.revision, activation_at:subject.enrollment.activation_at, periods:subjects.periods }));
    const contacts = new MemoryContactEventStore(context.build());
    const call = outboundCall('101', number, '2026-10-05T14:12:00Z', { call_log_state:null });
    contacts.calls.set(call.id, call);
    const source = { source_kind:'call' as const, source_id:call.id };
    const derive = () => applyContactSources([source], { now, queueRepDays:true }, contacts, fakeSession);
    const evaluator = new MemoryEvaluationStore();
    const admission = evaluationAdmissionOf(activeInspection(completeConfigurationInput({ cadence_shadow_enabled:true })));
    assert.ok(admission.ok);
    const evaluate = async () => {
      evaluator.subjects.set(subject.id, subjects.subjects[0]!);
      evaluator.periods = subjects.periods;
      evaluator.events = [...contacts.events.values()].filter(e => e.subject_id !== null).map(e => ({ ...e, subject_id:e.subject_id! }));
      return evaluateAndProject(subject.id, admission.context, now, evaluator, fakeSession);
    };
    // A provider outage at the deadline must not turn missing evidence into a verified miss.
    evaluator.coverage = capturedCoverage(new Date('2026-10-05T14:20:00Z'));
    await evaluate();
    assert.equal((evaluator.projections.get(subject.id)!.doc.call as {status:string}).status, 'due');
    const refresh = async () => {
      lead = subjects.addLead({ ...lead, ...accepted('0', '2026-10-05T14:35:00Z') });
      await refreshLeadForOutreach(lead.ref, config, now, subjects, fakeSession);
      context.subjects.set(key, { ...context.subjects.get(key)!, revision:subjects.subjects[0]!.revision });
    };
    if (contactFirst) { await derive(); await refresh(); } else { await refresh(); await derive(); }
    await evaluate();
    assert.equal((evaluator.projections.get(subject.id)!.doc.call as {verified_completed:number}).verified_completed, 0);
    contacts.calls.set(call.id, { ...call, call_log_state:'settled', projection_revision:call.projection_revision + 1 });
    await derive();
    evaluator.coverage = capturedCoverage(new Date('2026-10-05T14:40:00Z'));
    await evaluate();
    assert.equal((evaluator.projections.get(subject.id)!.doc.call as {verified_completed:number}).verified_completed, 1);
    assert.deepEqual(subjects.periods, periods);
    const contactWrites = contacts.writes, evaluationWrites = evaluator.writes.length;
    await derive(); await evaluate();
    assert.equal(contacts.writes, contactWrites);
    assert.equal(evaluator.writes.length, evaluationWrites);
    assert.equal(contacts.events.size, 1);
  }
});

