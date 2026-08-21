import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import type { LeadMessagingMode, OutboundSmsConsentBasis } from "../../config/domain";
import type { GranotLeadCreatedPolicy } from "../granotLifecycle/types";
import {
  DEFAULT_GRANOT_LEAD_CREATED_SMS_TEMPLATE,
  GRANOT_LEAD_CREATED_SMS_OPT_OUT,
  evaluateGranotLeadSmsGates,
  renderGranotLeadSmsBody,
  sendGranotCreatedLeadConfirmation,
  unknownOutboundSmsPlaceholders,
  type GranotSmsGate,
} from "./granotCreatedLead";

const passingFacts = {
  messaging_mode: "inline" as LeadMessagingMode,
  granot_sms_flag: true,
  lead_created_policy: "create_if_missing" as GranotLeadCreatedPolicy,
  outbound_sms_enabled: true,
  consent_basis: "existing_relationship" as OutboundSmsConsentBasis,
  destination: "+19545550142",
};

const gateFacts: Record<GranotSmsGate, Partial<typeof passingFacts>> = {
  messaging_mode_enabled: { messaging_mode: "disabled" },
  granot_sms_flag: { granot_sms_flag: false },
  source_policy_create_if_missing: { lead_created_policy: "link_only" },
  lead_source_sms_enabled: { outbound_sms_enabled: false },
  consent_basis_recorded: { consent_basis: "not_attested" },
  destination_and_capacity: { destination: null as unknown as string },
};

test("Granot SMS gates evaluate every named gate and report the first blocker", () => {
  const allPass = evaluateGranotLeadSmsGates(passingFacts);
  assert.equal(allPass.allowed, true);
  assert.equal(allPass.blocked_reason, null);
  assert.equal(allPass.evaluated_gates.length, 6);
  assert.equal(
    allPass.evaluated_gates.every((gate) => gate.allowed),
    true,
  );

  for (const [gate, override] of Object.entries(gateFacts) as Array<
    [GranotSmsGate, Partial<typeof passingFacts>]
  >) {
    const evaluation = evaluateGranotLeadSmsGates({
      ...passingFacts,
      ...override,
    });
    assert.equal(evaluation.allowed, false, gate);
    assert.equal(evaluation.blocked_reason, gate);
    assert.equal(evaluation.evaluated_gates.length, 6, gate);
    assert.equal(
      evaluation.evaluated_gates.filter((row) => !row.allowed).length >= 1,
      true,
      gate,
    );
  }
});

test("link_only never texts even when every other gate passes", () => {
  const evaluation = evaluateGranotLeadSmsGates({
    ...passingFacts,
    lead_created_policy: "link_only",
  });
  assert.equal(evaluation.allowed, false);
  assert.equal(evaluation.blocked_reason, "source_policy_create_if_missing");
  assert.equal(
    evaluation.evaluated_gates.find((row) => row.gate === "lead_source_sms_enabled")
      ?.allowed,
    true,
  );
});

test("not_attested blocks even when outbound_sms.enabled is somehow true", () => {
  const evaluation = evaluateGranotLeadSmsGates({
    ...passingFacts,
    outbound_sms_enabled: true,
    consent_basis: "not_attested",
  });
  assert.equal(evaluation.blocked_reason, "consent_basis_recorded");
});

test("renderer substitutes allowlisted placeholders and always appends one opt-out", () => {
  assert.equal(
    renderGranotLeadSmsBody({
      template: DEFAULT_GRANOT_LEAD_CREATED_SMS_TEMPLATE,
      first_name: "Maria",
      lead_source_name: "Best Relocation",
    }),
    `Hi Maria, this is Vantage Movers. We got your request and we'll call you shortly to go over your move. ${GRANOT_LEAD_CREATED_SMS_OPT_OUT}`,
  );
  assert.equal(
    renderGranotLeadSmsBody({
      template: "Hello {first_name} from {company}",
      lead_source_name: "Best Relocation",
    }),
    `Hello there from Best Relocation ${GRANOT_LEAD_CREATED_SMS_OPT_OUT}`,
  );
  assert.equal(
    renderGranotLeadSmsBody({
      template: "Hi {first_name}. Reply STOP to opt out. Extra {unknown}",
      first_name: "Ada",
      lead_source_name: "Best Relocation",
    }),
    `Hi Ada. Extra {unknown} ${GRANOT_LEAD_CREATED_SMS_OPT_OUT}`,
  );
  assert.deepEqual(unknownOutboundSmsPlaceholders("Hi {first_name} {job_no}"), [
    "job_no",
  ]);
});

test("sendGranotCreatedLeadConfirmation never throws and reports already_sent on duplicate key", async () => {
  const duplicate = Object.assign(new Error("E11000 duplicate"), { code: 11000 });
  const result = await sendGranotCreatedLeadConfirmation(
    {
      lead_ref: { model: "FormLead", id: new mongoose.Types.ObjectId().toString() },
      observation_id: new mongoose.Types.ObjectId().toString(),
      lead_source_company_id: new mongoose.Types.ObjectId().toString(),
      granot_crm_source_id: new mongoose.Types.ObjectId().toString(),
      destination_phone: "+19545550142",
      first_name: "Ada",
    },
    {
      persist: async () => {
        throw duplicate;
      },
      messagingMode: "inline",
      granotSmsFlag: true,
      loadContext: async () => ({
        lead_created_policy: "create_if_missing",
        outbound_sms: {
          enabled: true,
          consent_basis: "existing_relationship",
          body_template: DEFAULT_GRANOT_LEAD_CREATED_SMS_TEMPLATE,
          template_version: 1,
        },
        company_name: "Best Relocation",
      }),
    },
  );
  assert.deepEqual(result, { message_id: null, status: "already_sent" });

  const failed = await sendGranotCreatedLeadConfirmation(
    {
      lead_ref: { model: "CallLead", id: "not-an-id" },
      observation_id: "also-bad",
      lead_source_company_id: "nope",
      granot_crm_source_id: "no",
    },
    {
      persist: async () => {
        throw new Error("must not persist invalid refs");
      },
    },
  );
  assert.equal(failed.status, "blocked:invalid_refs");
});
