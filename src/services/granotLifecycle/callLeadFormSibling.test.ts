import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Types } from "mongoose";
import { hasSyncedCallsRow, planFormSiblingUpdate, type SiblingCallLead, type SiblingFormLead } from "./callLeadFormSibling";

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
  ringcentral: { call_log_id: "call-log-1", duration_seconds: 120, ingestion_source: "call_log_sync", qualification_reason: "call_log_inbound_target_answered_over_120s" },
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
    assert.deepEqual(plan.set.granot_form_sibling, {
      basis: "phone_source_company",
      form_lead_id: new Types.ObjectId(String(form()._id)),
      linked_at: NOW,
      normalized_job_no: "P5562894",
    });
    const linked = call({
      job_no: "P5562894",
      normalized_job_no: "P5562894",
      granot_priority: "1",
      receiver_agent: AGENT,
      receiver_agent_source: "granot_username_match",
      granot_form_sibling: {
        form_lead_id: form()._id,
        normalized_job_no: "P5562894",
      },
    });
    assert.deepEqual(planFormSiblingUpdate(form(), [linked], [], NOW), {
      kind: "skip", reason: "already_current",
    });
    assert.deepEqual(planFormSiblingUpdate(form({ _id: "650000000000000000000099" }), [linked], [], NOW), {
      kind: "skip", reason: "sibling_of_other_form",
    });
  });

  test("duplicates and booking anchors are never siblings; two eligible siblings are not guessed", () => {
    assert.deepEqual(planFormSiblingUpdate(form(), [], [call({ duplicate: true }), call({ _id: "650000000000000000000021", created_on_unmatched: true })], NOW),
      { kind: "skip", reason: "no_call_sibling" });
    assert.deepEqual(planFormSiblingUpdate(form(), [], [call(), call({ _id: "650000000000000000000021" })], NOW), { kind: "skip", reason: "multiple_call_siblings" });
  });

  test("a matching job or phone cannot qualify a sibling", () => {
    const unqualified = call({ ringcentral: null, normalized_job_no: "P5562894" });
    assert.deepEqual(planFormSiblingUpdate(form(), [unqualified], [call({ ringcentral: null })], NOW), { kind: "skip", reason: "no_call_sibling" });
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
});

test("exception destinations retain delivery under No-Sync, unsupported Calls never gain admission", () => {
  for (const target of ['master_calls', 'master_duplicate_calls', 'master_bad_calls']) {
    const sheet_sync = [{ target, status: 'synced', row_number: 2 }];
    assert.equal(hasSyncedCallsRow(call({ form_fill: true, no_sync: true, sheet_sync })), true);
    assert.equal(hasSyncedCallsRow(call({ ringcentral: null, form_fill: true, sheet_sync })), false);
    assert.equal(hasSyncedCallsRow(call({ created_on_unmatched: true, sheet_sync })), false);
  }
});
