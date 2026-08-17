import assert from "node:assert/strict";
import { after, test } from "node:test";
import mongoose from "mongoose";
import {
  anyLifecycleEffectEnabled,
  getGranotLifecycleFlags,
} from "../../config/domain/granotLifecycle";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { connectMongo } from "../../db";
import { CallLead } from "../../models/CallLead";
import { getFormLeadModel } from "../../models/FormLead";
import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../models/LeadSourceGranularity";
import { BookedLead } from "../../models/BookedLead";
import { CancelledLead } from "../../models/CancelledLead";
import { createRingCentralCallLeadInTransaction } from "./callLead.service";
import { createFormLeadInTransaction } from "./formLead.service";
import { formLeadCreationProvenanceFields } from "./leadIngestionProvenance";
import { createFormLeadSchema } from "../../validation/v1/leads.validation";

async function replicaReady(t: { skip: (reason: string) => void }): Promise<boolean> {
  if (process.env.GRANOT_LIFECYCLE_REPLICA_TESTS !== "true") {
    t.skip("Replica-set proof is opt-in via GRANOT_LIFECYCLE_REPLICA_TESTS=true.");
    return false;
  }
  if (getMongoDatabaseName() !== "testvantagemovers") {
    t.skip("Replica-set proof requires TEST_MODE=true before process start.");
    return false;
  }
  await connectMongo();
  if (mongoose.connection.db?.databaseName !== "testvantagemovers") {
    t.skip("Refusing replica-set proof against a non-test database.");
    return false;
  }
  const hello = await mongoose.connection.db?.admin().command({ hello: 1 });
  if (!hello || hello.setName == null) {
    t.skip("Connected Mongo is not a replica set.");
    return false;
  }
  return true;
}

after(async () => {
  await mongoose.disconnect().catch(() => undefined);
});

async function seedFormSource(prefix: string) {
  const Company = getLeadSourceCompanyModel();
  const Granularity = getLeadSourceGranularityModel();
  const company = await Company.create({
    company_slug: `${prefix}_co`,
    name: "U12 Synthetic",
    owner_label: "U12 Synthetic",
    active: true,
    created_from: "test",
  });
  const granularity = await Granularity.create({
    source_company: company._id,
    granularity_key: `${prefix}_form`,
    channel: "form",
    owner_label: "U12 Synthetic Forms",
    crm_label: "U12 Synthetic Forms",
    active: true,
    activated_at: new Date(),
    created_from: "test",
  });
  company.default_form_granularity = granularity._id;
  company.default_form_granularity_key = granularity.granularity_key;
  await company.save();
  return { company, granularity };
}

function ringCentralInput(prefix: string) {
  const companyId = new mongoose.Types.ObjectId().toHexString();
  const granularityId = new mongoose.Types.ObjectId().toHexString();
  return {
    source_company: "main_site" as const,
    source_resolution: {
      route_id: new mongoose.Types.ObjectId().toHexString(),
      assignment_id: new mongoose.Types.ObjectId().toHexString(),
      normalized_target_number: "5550100999",
      company_id: companyId,
      company_slug: "main_site",
      granularity_id: granularityId,
      granularity_key: `${prefix}_call`,
      company_label_snapshot: "U12 Synthetic",
      granularity_label_snapshot: "U12 Synthetic Calls",
      crm_label_snapshot: "U12 Synthetic Calls",
    },
    phone_number: "5550100120",
    name: "U12 RC Synthetic",
    duplicate: false,
    ringcentral: {
      telephony_session_id: `${prefix}-session`,
      ingestion_source: "webhook" as const,
      route_id: new mongoose.Types.ObjectId().toHexString(),
      route_assignment_id: new mongoose.Types.ObjectId().toHexString(),
      target_phone_number: "5550100999",
    },
  };
}

test("[AC-10] [AC-11] replica WordPress Form create captures origin and snapshots atomically", async (t) => {
  if (!(await replicaReady(t))) return;
  const previousMode = process.env.SHEET_SYNC_MODE;
  process.env.SHEET_SYNC_MODE = "disabled";
  t.after(() => {
    if (previousMode === undefined) delete process.env.SHEET_SYNC_MODE;
    else process.env.SHEET_SYNC_MODE = previousMode;
  });

  const prefix = `u12f-${Date.now()}`;
  const { company, granularity } = await seedFormSource(prefix);
  const now = new Date("2026-08-17T16:20:00.000Z");
  const pending = await createFormLeadInTransaction(
    createFormLeadSchema.parse({
      source_company: company.company_slug,
      name: "U12 Form Synthetic",
      phone_number: "5550100110",
      pickup_zip: "10001",
      destination_zip: "94105",
      move_size: "Studio",
      ref_no: "DT_u12ref",
      post_to_granot: false,
    }),
    { now, ingestion_origin: "wordpress_form" },
  );
  const lead = pending.lead;
  t.after(async () => {
    await getFormLeadModel().deleteOne({ _id: lead._id });
    await getLeadSourceGranularityModel().deleteOne({ _id: granularity._id });
    await getLeadSourceCompanyModel().deleteOne({ _id: company._id });
  });

  assert.equal(lead.ingestion_origin, "wordpress_form");
  assert.equal(lead.ingested_contact_snapshot?.evidence_status, "captured_at_ingestion");
  assert.equal(lead.ingested_move_snapshot?.evidence_status, "captured_at_ingestion");
  assert.equal(lead.ingested_contact_snapshot?.captured_at?.getTime(), now.getTime());
  assert.equal(lead.ingested_move_snapshot?.captured_at?.getTime(), now.getTime());
  assert.equal(lead.ref_no, "DT_u12ref");
  assert.notEqual(lead.ref_no, lead.job_no);
  assert.equal(lead.ingested_contact_snapshot?.normalized_phone_number, "5550100110");

  lead.ingestion_origin = "vantage_admin";
  await assert.rejects(() => lead.save(), /ingestion_origin is immutable/);

  const flags = getGranotLifecycleFlags();
  assert.equal(flags.lead_writes_enabled, false);
  assert.equal(flags.lead_creation_enabled, false);
  assert.equal(anyLifecycleEffectEnabled(flags), false);
  assert.equal(await BookedLead.countDocuments({ _id: lead._id }), 0);
  assert.equal(await CancelledLead.countDocuments({ _id: lead._id }), 0);
});

test("[AC-10] replica Form origin/snapshot insert rolls back with the Lead", async (t) => {
  if (!(await replicaReady(t))) return;
  const FormLead = getFormLeadModel();
  const marker = `u12-rollback-${Date.now()}`;
  const now = new Date("2026-08-17T16:21:00.000Z");
  await assert.rejects(async () => {
    await mongoose.connection.transaction(async (session) => {
      const created = new FormLead({
        name: marker,
        phone_number: "5550100111",
        pickup_zip: "10001",
        destination_zip: "94105",
        move_size: "Studio",
        local: "long_distance",
        ...formLeadCreationProvenanceFields({
          origin: "wordpress_form",
          now,
          contact: { name: marker, phone_number: "5550100111" },
          move: { pickup_zip: "10001", destination_zip: "94105", move_size: "Studio" },
        }),
      });
      await created.save({ session });
      throw new Error("forced unit 12 form rollback");
    });
  }, /forced unit 12 form rollback/);
  assert.equal(await FormLead.countDocuments({ name: marker }), 0);
});

test("[AC-12] replica RingCentral Call create captures origin, quoted false, and rolls back atomically", async (t) => {
  if (!(await replicaReady(t))) return;
  const previousMode = process.env.SHEET_SYNC_MODE;
  process.env.SHEET_SYNC_MODE = "disabled";
  t.after(() => {
    if (previousMode === undefined) delete process.env.SHEET_SYNC_MODE;
    else process.env.SHEET_SYNC_MODE = previousMode;
  });

  const prefix = `u12c-${Date.now()}`;
  const now = new Date("2026-08-17T16:22:00.000Z");
  const pending = await createRingCentralCallLeadInTransaction(
    ringCentralInput(prefix),
    { now },
  );
  t.after(async () => {
    await CallLead.deleteOne({ _id: pending.lead._id });
  });
  assert.equal(pending.lead.ingestion_origin, "ringcentral");
  assert.equal(pending.lead.quoted, false);
  assert.equal(
    pending.lead.ingested_contact_snapshot?.evidence_status,
    "captured_at_ingestion",
  );
  assert.equal(pending.lead.ingested_contact_snapshot?.captured_at?.getTime(), now.getTime());
  assert.equal(pending.lead.ringcentral?.ingestion_source, "webhook");

  const rollbackPhone = "5550100121";
  await assert.rejects(async () => {
    await mongoose.connection.transaction(async (session) => {
      await createRingCentralCallLeadInTransaction(
        {
          ...ringCentralInput(`${prefix}-rb`),
          phone_number: rollbackPhone,
          ringcentral: {
            ...ringCentralInput(`${prefix}-rb`).ringcentral,
            telephony_session_id: `${prefix}-rb-session`,
          },
        },
        { session, now },
      );
      throw new Error("forced unit 12 call rollback");
    });
  }, /forced unit 12 call rollback/);
  assert.equal(await CallLead.countDocuments({ phone_number: rollbackPhone }), 0);
  assert.equal(getGranotLifecycleFlags().lead_creation_enabled, false);
});
