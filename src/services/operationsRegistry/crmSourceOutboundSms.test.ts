import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { DEFAULT_GRANOT_LEAD_CREATED_SMS_TEMPLATE } from "../leadMessaging/granotCreatedLead";
import {
  listRecentGranotCrmSourceSms,
  setGranotCrmSourceOutboundSms,
  toSmsView,
} from "./crmSourceOutboundSms";
import type { RegistryActorContext } from "./types";

const owner: RegistryActorContext = {
  actorType: "owner",
  actorId: "owner-1",
  actorLabel: "Owner",
  actorRole: "owner",
  requestId: "req-sms-1",
};

const admin: RegistryActorContext = {
  ...owner,
  actorRole: "admin",
  requestId: "req-sms-admin",
};

test("toSmsView defaults a missing policy to off and not attested", () => {
  const view = toSmsView("aaaaaaaaaaaaaaaaaaaaaaaa", undefined);
  assert.equal(view.enabled, false);
  assert.equal(view.consent_basis, "not_attested");
  assert.equal(view.body_template, DEFAULT_GRANOT_LEAD_CREATED_SMS_TEMPLATE);
  assert.equal(view.template_version, 1);
  assert.equal(view.daily_cap, 0);
});

test("setGranotCrmSourceOutboundSms rejects non-owners and not_attested enable", async () => {
  await assert.rejects(
    () =>
      setGranotCrmSourceOutboundSms(
        {
          granot_crm_source_id: new mongoose.Types.ObjectId().toString(),
          enabled: true,
          body_template: DEFAULT_GRANOT_LEAD_CREATED_SMS_TEMPLATE,
          consent_basis: "existing_relationship",
          reason: "Turning on confirmation texts after counsel review",
        },
        admin,
      ),
    /Owner actor/,
  );
  await assert.rejects(
    () =>
      setGranotCrmSourceOutboundSms(
        {
          granot_crm_source_id: new mongoose.Types.ObjectId().toString(),
          enabled: true,
          body_template: DEFAULT_GRANOT_LEAD_CREATED_SMS_TEMPLATE,
          consent_basis: "not_attested",
          reason: "Turning on confirmation texts after counsel review",
        },
        owner,
      ),
    /consent basis/,
  );
  await assert.rejects(
    () =>
      setGranotCrmSourceOutboundSms(
        {
          granot_crm_source_id: new mongoose.Types.ObjectId().toString(),
          enabled: true,
          body_template: "Hi {job_no}",
          consent_basis: "existing_relationship",
          reason: "Turning on confirmation texts after counsel review",
        },
        owner,
      ),
    /\{first_name\} and \{company\}/,
  );
});

test("listRecentGranotCrmSourceSms never returns a message body", async () => {
  await assert.rejects(
    () => listRecentGranotCrmSourceSms({ granot_crm_source_id: "bad" }),
    /valid ObjectId/,
  );
});
