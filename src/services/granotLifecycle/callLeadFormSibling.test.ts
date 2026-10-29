import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { formSiblingPhones, hasSyncedCallsRow, planFormSiblingUpdate, type SiblingCallLead, type SiblingFormLead } from "./callLeadFormSibling";

const NOW = new Date("2026-10-28T20:00:00.000Z");
const COMPANY = "650000000000000000000001";
const AGENT = "650000000000000000000002";

const form = (over: Partial<SiblingFormLead> = {}): SiblingFormLead => ({
  _id: "650000000000000000000010",
  job_no: "P5562894",
  normalized_job_no: "P5562894",
  granot_priority: "1",
  receiver_agent: AGENT,
  receiver_agent_name_snapshot: "Rep One",
  receiver_agent_source: "granot_username_match",
  receiver_agent_source_value: "repone",
  lead_source_company: COMPANY,
  normalized_phone_number: "5550100000",
  createdAt: new Date("2026-10-20T15:00:00.000Z"),
  ...over,
});

const call = (over: Partial<SiblingCallLead> = {}): SiblingCallLead => ({
  _id: "650000000000000000000020",
  lead_source_company: COMPANY,
  createdAt: new Date("2026-10-20T14:00:00.000Z"),
  domain_revision: 3,
  sheet_sync: [{ target: "master_calls" }],
  ...over,
});

describe("Granot Form sibling update: planFormSiblingUpdate", () => {
  test("a jobless qualified Call Lead with the same phone and Source Company gets the job, priority, receiver and the pair marker", () => {
    const plan = planFormSiblingUpdate(form(), [], [call()], NOW);
    assert.equal(plan.kind, "update");
    if (plan.kind !== "update") return;
    assert.equal(plan.basis, "phone_source_company");
    assert.equal(plan.set.job_no, "P5562894");
    assert.equal(plan.set.normalized_job_no, "P5562894");
    assert.equal(plan.set.granot_priority, "1");
    assert.equal(String(plan.set.receiver_agent), AGENT);
    assert.equal(plan.set.receiver_agent_name_snapshot, "Rep One");
    assert.equal(plan.set.receiver_agent_source, "granot_username_match");
    assert.deepEqual(Object.keys(plan.set.granot_form_sibling as object).sort(), ["basis", "form_lead_id", "linked_at", "normalized_job_no"]);
  });

  test("a Call Lead already holding an equivalent job is matched by job and keeps its own job string", () => {
    const plan = planFormSiblingUpdate(form(), [call({ job_no: "5562894", normalized_job_no: "5562894" })], [], NOW);
    assert.equal(plan.kind, "update");
    if (plan.kind !== "update") return;
    assert.equal(plan.basis, "job_no");
    assert.equal(plan.set.job_no, undefined);
  });

  test("phone matches need the same Source Company, no job of their own and the time window", () => {
    assert.deepEqual(planFormSiblingUpdate(form(), [], [call({ lead_source_company: "650000000000000000000099" })], NOW), { kind: "skip", reason: "no_call_sibling" });
    assert.deepEqual(planFormSiblingUpdate(form(), [], [call({ job_no: "P1", normalized_job_no: "P1" })], NOW), { kind: "skip", reason: "no_call_sibling" });
    assert.deepEqual(planFormSiblingUpdate(form(), [], [call({ createdAt: new Date("2026-06-01T00:00:00.000Z") })], NOW), { kind: "skip", reason: "no_call_sibling" });
  });

  test("duplicates and booking anchors are never siblings; two eligible siblings are not guessed", () => {
    assert.deepEqual(planFormSiblingUpdate(form(), [], [call({ duplicate: true }), call({ _id: "650000000000000000000021", created_on_unmatched: true })], NOW),
      { kind: "skip", reason: "no_call_sibling" });
    assert.deepEqual(planFormSiblingUpdate(form(), [], [call(), call({ _id: "650000000000000000000021" })], NOW), { kind: "skip", reason: "multiple_call_siblings" });
  });

  test("an ineligible Form Lead mirrors nothing", () => {
    for (const over of [{ duplicate: true }, { bad_lead: "spam" }, { job_no: null, normalized_job_no: null }])
      assert.deepEqual(planFormSiblingUpdate(form(over), [], [call()], NOW), { kind: "skip", reason: "form_ineligible" });
  });

  test("a manual or source-less receiver is never replaced; an automatic one is", () => {
    const other = "650000000000000000000003";
    for (const source of ["manual", undefined]) {
      const plan = planFormSiblingUpdate(form(), [], [call({ receiver_agent: other, receiver_agent_source: source })], NOW);
      assert.ok(plan.kind === "update" && plan.set.receiver_agent === undefined);
    }
    const plan = planFormSiblingUpdate(form(), [], [call({ receiver_agent: other, receiver_agent_source: "ringcentral_answered" })], NOW);
    assert.ok(plan.kind === "update" && String(plan.set.receiver_agent) === AGENT);
  });

  test("a Call Lead linked to another Form Lead is left alone; an up-to-date pair writes nothing", () => {
    const linkedElsewhere = call({ job_no: "P5562894", normalized_job_no: "P5562894", granot_form_sibling: { form_lead_id: "650000000000000000000099", normalized_job_no: "P5562894" } });
    assert.deepEqual(planFormSiblingUpdate(form(), [linkedElsewhere], [], NOW), { kind: "skip", reason: "sibling_of_other_form" });
    const current = call({ job_no: "P5562894", normalized_job_no: "P5562894", granot_priority: "1", receiver_agent: AGENT, receiver_agent_source: "granot_username_match",
      granot_form_sibling: { form_lead_id: "650000000000000000000010", normalized_job_no: "P5562894" } });
    assert.deepEqual(planFormSiblingUpdate(form(), [current], [], NOW), { kind: "skip", reason: "already_current" });
  });

  test("formSiblingPhones: current, ingested and Granot phones, deduplicated", () => {
    assert.deepEqual(formSiblingPhones(form({ ingested_contact_snapshot: { normalized_phone_number: "5550100000" }, granot_contact_snapshot: { normalized_phone_number: "5550109999" } })),
      ["5550100000", "5550109999"]);
  });
});

test("hasSyncedCallsRow: only a synced Master Calls entry with a row number counts (a pending or failed entry could append)", () => {
  const base = { _id: "650000000000000000000020" };
  assert.equal(hasSyncedCallsRow({ ...base, sheet_sync: [{ target: "master_calls", status: "synced", row_number: 12 }] }), true);
  assert.equal(hasSyncedCallsRow({ ...base, sheet_sync: [{ target: "master_calls", status: "pending" }] }), false);
  assert.equal(hasSyncedCallsRow({ ...base, sheet_sync: [{ target: "master_calls", status: "synced", row_number: 12 }], no_sync: true }), false);
  assert.equal(hasSyncedCallsRow({ ...base, sheet_sync: [{ target: "master_duplicate_calls", status: "synced", row_number: 3 }] }), false);
});

test("both command origins pass the canonical command context validator (processor result and Owner backfill)", async () => {
  const { assertCommandContext } = await import("../domainCommands/commandContext.js");
  const { createGranotWebhookInitiator } = await import("../durableWork/actors.js");
  const { siblingContext } = await import("./callLeadFormSibling.js");
  const receipt = "650000000000000000000101";
  const checksum = "a".repeat(64);
  const processorActor = { actor_type: "system" as const, actor_id: "granot-lifecycle-processor", actor_label: "Granot Lifecycle Processor",
    actor_role: "system" as const, origin: "granot_lifecycle" as const, request_id: receipt };
  await assertCommandContext(siblingContext({ kind: "granot_lifecycle", actor: processorActor, initiator: createGranotWebhookInitiator(receipt), receipt_id: receipt,
    observation_id: "650000000000000000000102", decision_id: "650000000000000000000103", observation_channel: "granot_webhook" }, "granot-form-sibling:k1", checksum));
  await assertCommandContext(siblingContext({ kind: "owner_backfill", run_id: "call-lead-form-siblings-2026-10-28" }, "granot-form-sibling:k2", checksum));
});
