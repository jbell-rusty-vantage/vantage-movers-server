import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import type { LeadMessagingMode, OutboundSmsConsentBasis } from "../../config/domain";
import type { GranotLeadCreatedPolicy } from "../granotLifecycle/types";
import { resolveSourceCompanyFromLabel } from "../../config/domain/sources";
import {
  DEFAULT_GRANOT_LEAD_CREATED_SMS_TEMPLATE,
  GRANOT_LEAD_CREATED_SMS_OPT_OUT,
  evaluateGranotLeadSmsGates,
  renderGranotLeadSmsBody,
  sendGranotCreatedLeadConfirmation,
  unknownOutboundSmsPlaceholders,
  type GranotSmsGate,
} from "./granotCreatedLead";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { LeadMessageDocument } from "../../models/LeadMessage";
import * as twilioAdapter from "./twilioAdapter";

function stubPersistedMessage(): LeadMessageDocument {
  return { _id: new mongoose.Types.ObjectId() } as LeadMessageDocument;
}

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

test("create_if_missing texting uses the resolved Lead Source ID and never looks up by label", async () => {
  let labelLookups = 0;
  const originalResolver = resolveSourceCompanyFromLabel;
  void originalResolver;
  const companyId = new mongoose.Types.ObjectId().toString();
  let persistedCompany: string | undefined;
  const result = await sendGranotCreatedLeadConfirmation(
    {
      lead_ref: { model: "FormLead", id: new mongoose.Types.ObjectId().toString() },
      observation_id: new mongoose.Types.ObjectId().toString(),
      lead_source_company_id: companyId,
      granot_crm_source_id: new mongoose.Types.ObjectId().toString(),
      destination_phone: "+19545550142",
      first_name: "Ada",
    },
    {
      persist: async (input) => {
        if ("lead_source_company" in input) {
          persistedCompany = input.lead_source_company;
        }
        return stubPersistedMessage();
      },
      dispatch: async () => ({ message_id: "msg-1", status: "accepted" }),
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
        company_name: "Vantage Movers leftover only",
      }),
    },
  );
  assert.equal(result.status, "accepted");
  assert.equal(persistedCompany, companyId);
  assert.equal(labelLookups, 0);
  assert.equal(typeof resolveSourceCompanyFromLabel, "function");
});

test("Twilio adapter stays un-called on gate decisions and persist/dispatch stubs", async () => {
  const sendSource = readFileSync(
    path.join(process.cwd(), "src/services/leadMessaging/granotCreatedLead.ts"),
    "utf8",
  );
  assert.equal(sendSource.includes("createTwilioSender"), false);
  assert.equal(sendSource.includes("twilioAdapter"), false);

  let persistCalls = 0;
  let dispatchCalls = 0;
  const result = await sendGranotCreatedLeadConfirmation(
    {
      lead_ref: { model: "FormLead", id: new mongoose.Types.ObjectId().toString() },
      observation_id: new mongoose.Types.ObjectId().toString(),
      lead_source_company_id: new mongoose.Types.ObjectId().toString(),
      granot_crm_source_id: new mongoose.Types.ObjectId().toString(),
      destination_phone: "+19545550142",
    },
    {
      persist: async () => {
        persistCalls += 1;
        throw new Error("should not persist on link_only");
      },
      dispatch: async () => {
        dispatchCalls += 1;
        throw new Error("should not dispatch — default Twilio path must not run");
      },
      messagingMode: "inline",
      granotSmsFlag: true,
      loadContext: async () => ({
        lead_created_policy: "link_only",
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
  assert.equal(result.status, "blocked:source_policy_create_if_missing");
  assert.equal(persistCalls, 0);
  assert.equal(dispatchCalls, 0);
  assert.equal(typeof twilioAdapter.createTwilioSender, "function");
});

test("link_only enrich path sends nothing even when persist/dispatch are provided", async () => {
  let persistCalls = 0;
  let dispatchCalls = 0;
  const result = await sendGranotCreatedLeadConfirmation(
    {
      lead_ref: { model: "FormLead", id: new mongoose.Types.ObjectId().toString() },
      observation_id: new mongoose.Types.ObjectId().toString(),
      lead_source_company_id: new mongoose.Types.ObjectId().toString(),
      granot_crm_source_id: new mongoose.Types.ObjectId().toString(),
      destination_phone: "+19545550142",
    },
    {
      persist: async () => {
        persistCalls += 1;
        return stubPersistedMessage();
      },
      dispatch: async () => {
        dispatchCalls += 1;
        return { message_id: "sid", status: "sent" };
      },
      messagingMode: "inline",
      granotSmsFlag: true,
      loadContext: async () => ({
        lead_created_policy: "link_only",
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
  assert.equal(result.status, "blocked:source_policy_create_if_missing");
  assert.equal(persistCalls, 0);
  assert.equal(dispatchCalls, 0);
});

test("replaying one observation twice yields at most one persist, bounded by identity", async () => {
  let persistCalls = 0;
  const persist = async () => {
    persistCalls += 1;
    if (persistCalls > 1) {
      throw Object.assign(new Error("E11000 duplicate"), { code: 11000 });
    }
    return stubPersistedMessage();
  };
  const input = {
    lead_ref: { model: "FormLead" as const, id: new mongoose.Types.ObjectId().toString() },
    observation_id: new mongoose.Types.ObjectId().toString(),
    lead_source_company_id: new mongoose.Types.ObjectId().toString(),
    granot_crm_source_id: new mongoose.Types.ObjectId().toString(),
    destination_phone: "+19545550142",
    first_name: "Ada",
  };
  const deps = {
    persist,
    dispatch: async () => ({ message_id: "msg-1", status: "accepted" }),
    messagingMode: "inline" as const,
    granotSmsFlag: true,
    loadContext: async () => ({
      lead_created_policy: "create_if_missing" as const,
      outbound_sms: {
        enabled: true,
        consent_basis: "existing_relationship" as const,
        body_template: DEFAULT_GRANOT_LEAD_CREATED_SMS_TEMPLATE,
        template_version: 1,
      },
      company_name: "Best Relocation",
    }),
  };
  const first = await sendGranotCreatedLeadConfirmation(input, deps);
  const second = await sendGranotCreatedLeadConfirmation(input, deps);
  assert.equal(first.status, "accepted");
  assert.equal(second.status, "already_sent");
  assert.equal(persistCalls, 2);
});
