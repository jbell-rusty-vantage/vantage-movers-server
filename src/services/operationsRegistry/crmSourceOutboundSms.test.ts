import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { ClientSession } from "mongoose";
import mongoose from "mongoose";
import { DEFAULT_GRANOT_LEAD_CREATED_SMS_TEMPLATE } from "../leadMessaging/granotCreatedLead";
import { getGranotCrmSourceModel } from "../../models/GranotCrmSource";
import {
  listRecentGranotCrmSourceSms,
  setGranotCrmSourceOutboundSms,
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

const Source = getGranotCrmSourceModel();
type MutableModel = Record<string, unknown>;
const originalFindById = Source.findById;
const originalFindByIdAndUpdate = Source.findByIdAndUpdate;

afterEach(() => {
  (Source as unknown as MutableModel).findById = originalFindById;
  (Source as unknown as MutableModel).findByIdAndUpdate = originalFindByIdAndUpdate;
});

function leanById(result: unknown) {
  return {
    session() {
      return this;
    },
    lean() {
      return this;
    },
    exec: async () => result,
  };
}

test("enabling SMS is rejected unless lead_created_policy is create_if_missing", async () => {
  const id = new mongoose.Types.ObjectId();
  (Source as unknown as MutableModel).findById = () =>
    leanById({
      _id: id,
      enabled: true,
      lead_created_policy: "link_only",
      outbound_sms: { enabled: false },
    });
  await assert.rejects(
    () =>
      setGranotCrmSourceOutboundSms(
        {
          granot_crm_source_id: String(id),
          enabled: true,
          body_template: DEFAULT_GRANOT_LEAD_CREATED_SMS_TEMPLATE,
          consent_basis: "existing_relationship",
          reason: "Turning on confirmation texts after counsel review",
        },
        owner,
        {
          withTransaction: async (fn) => fn({} as ClientSession),
          insertAudit: async () => undefined,
        },
      ),
    /does not create leads/,
  );
});
