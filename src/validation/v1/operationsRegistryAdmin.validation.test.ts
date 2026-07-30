import assert from "node:assert/strict";
import { test } from "node:test";
import {
  leadSourceCompanyCreateSchema,
  sourceActivationSchema,
  sourceGranularityCreateSchema,
  sourceGranularityUpdateSchema,
  sourceResolutionPreviewSchema,
} from "./admin.validation";

test("Source Company writes reject embedded granularities and compatibility defaults", () => {
  assert.throws(
    () =>
      leadSourceCompanyCreateSchema.parse({
        company_slug: "dynamic_source",
        name: "Dynamic Source",
        granularities: [],
      }),
    /Embedded granularities are read-only/,
  );
  assert.throws(
    () =>
      leadSourceCompanyCreateSchema.parse({
        company_slug: "dynamic_source",
        name: "Dynamic Source",
        default_form_granularity_key: "dynamic_form",
      }),
    /Compatibility default keys are read-only/,
  );
});

test("Source Granularity create requires a first-class company ObjectId", () => {
  assert.throws(
    () =>
      sourceGranularityCreateSchema.parse({
        granularity_key: "dynamic_form",
        channel: "form",
        owner_label: "Dynamic Forms",
        crm_label: "Dynamic Web Leads",
      }),
    /expected string|Invalid input/i,
  );
});

test("Source Granularity update rejects immutable identity fields", () => {
  assert.throws(
    () =>
      sourceGranularityUpdateSchema.parse({
        granularity_key: "renamed_key",
      }),
    /Unrecognized key/,
  );
});

test("source activation and resolution preview parse contract fields", () => {
  assert.deepEqual(
    sourceActivationSchema.parse({
      active: false,
      replacement_default_id: "507f1f77bcf86cd799439011",
      reason: "Campaign retired",
    }),
    {
      active: false,
      replacement_default_id: "507f1f77bcf86cd799439011",
      reason: "Campaign retired",
    },
  );
  assert.deepEqual(
    sourceResolutionPreviewSchema.parse({
      channel: "form",
      fallback_alias: " Legacy Dynamic ",
    }),
    { channel: "form", fallback_alias: "Legacy Dynamic" },
  );
});
