import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isCadenceQualifying } from "../engine/credit";
import { deriveSmsContactEvent, toEngineContactEvent, type ContactEventDraft, type SmsSourceRow } from "./derive";
import { ContextBuilder, newId, subjectFacts } from "./testing";

/** SRV-6 SMS contact events from `ringcentral_rep_sms_evidence` (P07d/P07e/P07g). */

const ALICE = newId();
const T0 = "2026-10-05T14:00:00.000Z";
const engine = (draft: ContactEventDraft) => toEngineContactEvent(draft);

const SMS_NUMBER = newId();
function smsContext() {
  const ctx = new ContextBuilder().number("+15550100200", SMS_NUMBER);
  ctx.lead(SMS_NUMBER);
  return ctx.build();
}
function smsRow(input: Partial<SmsSourceRow> = {}): SmsSourceRow {
  return {
    id: newId(),
    canonical_logical_id: `800000000001:${newId()}`,
    direction: "outbound",
    status: "sent",
    send_at: new Date(T0),
    provider_created_at: new Date(T0),
    counterpart_numbers: ["+15550100200"],
    is_group: false,
    reviewed_agent_id: ALICE,
    identity_state: "reviewed",
    source_revision: 1,
    duplicate_copy: false,
    ...input,
  };
}

describe("SMS contact events (P07d/P07e)", () => {
  test("p07g sms_later_delivery: SMS credit is at the confirmed sent time", () => {
    const sms = smsRow({ status: "delivered", send_at: new Date("2026-10-05T23:59:00Z") });
    const draft = deriveSmsContactEvent(sms, smsContext());
    assert.equal(draft.event_at.toISOString(), "2026-10-05T23:59:00.000Z");
  });

  test("Sent and Delivered credit the reviewed sender's SMS at the sent time; never outbound-goal credit", () => {
    for (const status of ["sent", "delivered"] as const) {
      const draft = deriveSmsContactEvent(smsRow({ status }), smsContext());
      assert.equal(draft.kind, "sms_sent");
      assert.equal(draft.verification, "confirmed");
      assert.equal(draft.actor_agent_id, ALICE);
      assert.equal(isCadenceQualifying(engine(draft), "sms"), true);
      assert.equal(draft.goal_credit, "none");
    }
  });
  test("SendingFailed/DeliveryFailed revoke: the re-derived event earns nothing and its fingerprint changes", () => {
    const row = smsRow();
    const sent = deriveSmsContactEvent(row, smsContext());
    for (const status of ["send_failed", "delivery_failed"] as const) {
      const failed = deriveSmsContactEvent({ ...row, status, source_revision: 2 }, smsContext());
      assert.equal(failed.kind, "sms_failed");
      assert.equal(isCadenceQualifying(engine(failed), "sms"), false);
      assert.notEqual(failed.input_fingerprint, sent.input_fingerprint);
    }
  });
  test("Received is history / last interaction only", () => {
    const draft = deriveSmsContactEvent(smsRow({ direction: "inbound", status: "received", send_at: null, reviewed_agent_id: null }), smsContext());
    assert.equal(draft.kind, "sms_inbound");
    assert.equal(isCadenceQualifying(engine(draft), "sms"), false);
  });
  test("a shared/company sender or a non-reviewed owner is pending identity", () => {
    const draft = deriveSmsContactEvent(smsRow({ identity_state: "pending_identity", reviewed_agent_id: null }), smsContext());
    assert.equal(draft.verification, "pending_identity");
  });
  test("group messages are ambiguous association; another mailbox copy of one logical message is excluded", () => {
    assert.equal(deriveSmsContactEvent(smsRow({ is_group: true }), smsContext()).verification, "pending_association");
    assert.equal(deriveSmsContactEvent(smsRow({ duplicate_copy: true }), smsContext()).exclusion_reason, "duplicate_copy");
  });
  test("a text restriction makes the SMS restricted contact", () => {
    const ctx = new ContextBuilder().number("+15550100200", SMS_NUMBER);
    ctx.lead(SMS_NUMBER);
    ctx.restrict(SMS_NUMBER, ["text"], "2026-10-01T00:00:00Z");
    const draft = deriveSmsContactEvent(smsRow(), ctx.build());
    assert.equal(draft.restricted_at_contact, true);
    assert.equal(isCadenceQualifying(engine(draft), "sms"), false);
  });

  test("P05f/P10a (olr C4): an SMS sent earlier on the activation date carries the subject for the same-date SMS reuse, never credit", () => {
    const ctx = new ContextBuilder().number("+15550100200", SMS_NUMBER);
    const lead = ctx.lead(SMS_NUMBER, subjectFacts({ activation_at: new Date("2026-10-05T19:00:00Z") }));
    const draft = deriveSmsContactEvent(smsRow(), ctx.build());
    assert.deepEqual([draft.association, draft.subject_id, draft.subject_workflow, draft.kind, draft.verification], ["none", lead.subject!.id, null, "sms_sent", "confirmed"]);
    assert.equal(isCadenceQualifying(engine(draft), "sms"), true);
    const dayBefore = deriveSmsContactEvent(smsRow({ send_at: new Date("2026-10-04T20:00:00Z"), provider_created_at: new Date("2026-10-04T20:00:00Z") }), ctx.build());
    assert.deepEqual([dayBefore.subject_id, dayBefore.verification], [null, "excluded"]);
  });
});
