import assert from "node:assert/strict";
import { test } from "node:test";
import type { OutreachActor } from "../auth";
import { OutreachError } from "../errors";
import { evaluateAndProject, evaluationAdmissionOf } from "../evaluation/evaluateJob";
import { capturedCoverage, completeConfigurationInput, periodRow, runInFakeTransaction, subjectRow } from "../evaluation/testing";
import type { DeskPlanRow } from "../evaluation/store";
import { salesOutreachDetailSchema } from "../../../validation/v1/salesOutreachReads";
import { MemoryDeskReadStore } from "./deskTesting";
import { readOutreachDetail } from "./detail";
import { activeInspection, fixedConfigurationLoader, MemoryReadStore } from "./testing";

/**
 * SRV-8 `GET /outreach/:id` and the team cadence cards: authorization before serialization (foreign and
 * absent ids are the same 404; reassignment revokes immediately), plan and assignment revisions,
 * provenance/explanation, shadow masking (Owner keeps the reconciliation labels), metadata-only history.
 */

const REP_A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const REP_B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const NOW = new Date("2026-10-05T15:00:00.000Z");
const at = (iso: string) => new Date(iso);
const owner: OutreachActor = { role: "owner", actor: { kind: "owner", id: "o", request_id: "r", run_id: null }, agent_id: null };
const manager: OutreachActor = { role: "manager", actor: { kind: "manager", id: "m", request_id: "r", run_id: null }, agent_id: null };
const rep = (agent: string): OutreachActor => ({ role: "rep", actor: { kind: "rep", id: agent, request_id: "r", run_id: null } as never, agent_id: agent });

const config = (controls: Parameters<typeof completeConfigurationInput>[0] = { cadence_enforcement_enabled: true }) =>
  activeInspection(completeConfigurationInput({ goal_metrics_enabled: true, ...controls }), "v-detail", 5);

async function seeded(controls?: Parameters<typeof completeConfigurationInput>[0]) {
  const store = new MemoryDeskReadStore();
  const inspection = config(controls);
  const received = at("2026-10-05T14:00:00.000Z");
  const subject = subjectRow({
    assigned_agent_id: REP_A,
    assignment_revision: 2,
    enrollment: { cohort_id: "intake:t", kind: "intake", enrolled_at: received, activation_at: received, manifest_hash: null },
    received_at: received,
    contact_number_ids: ["c".repeat(24)],
  });
  store.evaluation.subjects.set(subject.id, subject);
  store.evaluation.periods.push(periodRow(subject.id, { started_at: received }));
  store.setLead(subject.lead, REP_A);
  store.evaluation.events.push({
    subject_id: subject.id,
    id: "e".repeat(24),
    source_kind: "call",
    source_id: "f".repeat(24),
    channel: "call",
    direction: "outbound",
    event_at: at("2026-10-05T14:45:00.000Z"),
    kind: "outbound_attempt",
    verification: "confirmed",
    exclusion_reason: null,
    actor_agent_id: REP_A,
    goal_agent_id: REP_A,
    restricted_at_contact: false,
  });
  const ended: DeskPlanRow = {
    id: "1".repeat(24),
    subject_id: subject.id,
    period_id: null,
    kind: "callback",
    selected_date: null,
    appointment_at: at("2026-10-05T14:20:00.000Z"),
    due_at: at("2026-10-05T14:35:00.000Z"),
    window_minutes: 15,
    effective_at: at("2026-10-05T14:05:00.000Z"),
    status: "cancelled",
    ended_at: at("2026-10-05T14:10:00.000Z"),
    end_reason: "cancelled",
    revision: 3,
  };
  store.evaluation.plans.push(ended);
  store.evaluation.restrictions.push({
    id: "9".repeat(24),
    contact_number_id: "c".repeat(24),
    channels: ["text"],
    until: null,
    origin: "intelligence",
    state: "active",
    created_at: at("2026-10-01T12:00:00.000Z"),
    updated_at: null,
    reason: "customer_requested_no_texts",
    confirmed_at: null,
    confirmed_by: null,
    resolved_at: null,
    resolved_by: null,
    resolution_reason: null,
    revision: 1,
  });
  store.evaluation.coverage = capturedCoverage(at("2026-10-05T14:58:00.000Z"));
  const admission = evaluationAdmissionOf(inspection);
  assert.ok(admission.ok);
  await runInFakeTransaction((session) => evaluateAndProject(subject.id, admission.context, at("2026-10-05T14:59:00.000Z"), store.evaluation, session));
  // The reads see the same call coverage the evaluation used (olr A2 read-time verification).
  const readStore = new MemoryReadStore().coverCalls(at("2026-10-05T14:58:00.000Z"));
  readStore.names = new Map([[REP_A, "Alice Rep"], [REP_B, "Bob Rep"]]);
  const deps = { loader: fixedConfigurationLoader(inspection), store: readStore, queueStore: store, now: NOW };
  return { store, subject, deps };
}

async function notFound(promise: Promise<unknown>) {
  await assert.rejects(promise, (e: unknown) => e instanceof OutreachError && e.code === "NOT_FOUND");
}

test("outreach view: Owner/Manager any subject; Rep only its current assignment; absent/malformed/foreign are the same 404", async () => {
  const { subject, deps } = await seeded();
  for (const actor of [owner, manager, rep(REP_A)]) {
    const body = salesOutreachDetailSchema.parse(await readOutreachDetail(actor, subject.id, deps));
    assert.equal(body.subject.subject_id, subject.id);
  }
  await notFound(readOutreachDetail(rep(REP_B), subject.id, deps));
  await notFound(readOutreachDetail(owner, "0".repeat(24), deps));
  await notFound(readOutreachDetail(owner, "not-an-id", deps));
  await notFound(readOutreachDetail(rep(REP_A), "0".repeat(24), deps));
});

test("Unassigned/late assignment/reassignment (read part): reassigning the Lead revokes the former Rep at once; detail shows the lag", async () => {
  const { store, subject, deps } = await seeded();
  store.setLead(subject.lead, REP_B);
  await notFound(readOutreachDetail(rep(REP_A), subject.id, deps));
  const body = await readOutreachDetail(owner, subject.id, deps);
  assert.deepEqual([body.assignment.assigned_agent_id, body.assignment.lead_receiver_agent_id, body.assignment.in_sync], [REP_A, REP_B, false]);
});

test("shadow: no overdue or missed label for Manager/Rep; the Owner keeps the reconciliation labels", async () => {
  const { subject, deps } = await seeded({ cadence_shadow_enabled: true });
  const late = { ...deps, now: at("2026-10-05T16:00:00.000Z") };
  const repView = salesOutreachDetailSchema.parse(await readOutreachDetail(rep(REP_A), subject.id, late));
  assert.equal(repView.status_flags.overdue, false);
  assert.notEqual(repView.requirements.call.status, "overdue");
  assert.equal(repView.shadow_labels, null);
  assert.equal(repView.history.missed_labels_hidden, true);
  assert.ok(repView.history.window_history.every((w) => w.call.missed === null && w.sms.missed === null));
  const ownerView = salesOutreachDetailSchema.parse(await readOutreachDetail(owner, subject.id, late));
  assert.ok(ownerView.shadow_labels, "the Owner sees the unmasked labels in shadow");
  assert.equal(ownerView.history.missed_labels_hidden, false);
  assert.ok(ownerView.policy.explanation.some((e) => e.code === "cadence_shadow"));
});
