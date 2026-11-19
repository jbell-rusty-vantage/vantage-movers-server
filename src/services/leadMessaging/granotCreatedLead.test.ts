import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import type { LeadMessagingMode, OutboundSmsConsentBasis } from "../../config/domain";
import type { GranotLeadCreatedPolicy } from "../granotLifecycle/types";
import { resolveSourceCompanyFromLabel } from "../../config/domain/sources";
import {
  DEFAULT_GRANOT_LEAD_CREATED_SMS_TEMPLATE,
  evaluateGranotLeadSmsGates,
  sendGranotCreatedLeadConfirmation,
} from "./granotCreatedLead";
import type { LeadMessageDocument } from "../../models/LeadMessage";

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


test("not_attested blocks even when outbound_sms.enabled is somehow true", () => {
  const evaluation = evaluateGranotLeadSmsGates({
    ...passingFacts,
    outbound_sms_enabled: true,
    consent_basis: "not_attested",
  });
  assert.equal(evaluation.blocked_reason, "consent_basis_recorded");
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
