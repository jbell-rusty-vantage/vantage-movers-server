import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { LeadSourceCompany } from "../../models/LeadSourceCompany";
import { LeadSourceGranularity } from "../../models/LeadSourceGranularity";
import { leadSourceCompanyCreateSchema } from "../../validation/v1/admin.validation";

test("first-class Source Granularity applies draft and revision defaults", async () => {
  const document = new LeadSourceGranularity({
    source_company: new mongoose.Types.ObjectId(),
    granularity_key: "dynamic_forms",
    channel: "form",
    owner_label: "Dynamic Forms",
    crm_label: "Dynamic Web Leads",
    created_from: "admin",
  });

  await document.validate();

  assert.equal(document.active, false);
  assert.equal(document.schedule_revision, 0);
  assert.deepEqual(document.aliases, []);
  assert.deepEqual(document.source_sites, []);
});

test("Source Company defaults sheet projection to derived import", async () => {
  const embeddedId = new mongoose.Types.ObjectId();
  const document = new LeadSourceCompany({
    company_slug: "dynamic_source",
    name: "Dynamic Source",
    owner_label: "Dynamic Source",
    sheet_config: { has_bad_tabs: false },
    granularities: [
      {
        _id: embeddedId,
        granularity_key: "dynamic_forms",
        channel: "form",
        owner_label: "Dynamic Forms",
        crm_label: "Dynamic Web Leads",
      },
    ],
  });

  await document.validate();

  assert.equal(document.sheet_config?.projection_mode, "derived_import");
  assert.equal(document.granularities[0]?._id.toString(), embeddedId.toString());
});

test("source company write schema rejects embedded granularities and active flag", () => {
  const granularitiesResult = leadSourceCompanyCreateSchema.safeParse({
    company_slug: "dynamic_source",
    name: "Dynamic Source",
    granularities: [
      {
        granularity_key: "dynamic_form",
        channel: "form",
        owner_label: "Dynamic Forms",
        crm_label: "Dynamic Web Leads",
      },
    ],
  });
  assert.equal(granularitiesResult.success, false);
  assert.equal(granularitiesResult.error?.issues[0]?.path[0], "granularities");

  const activeResult = leadSourceCompanyCreateSchema.safeParse({
    company_slug: "dynamic_source",
    name: "Dynamic Source",
    active: true,
  });
  assert.equal(activeResult.success, false);
  assert.equal(activeResult.error?.issues[0]?.path[0], "active");
});
