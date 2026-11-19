import assert from "node:assert/strict";
import { test } from "node:test";
import { ValidationError } from "../errors";
import {
  deriveCallLeadIngestionOrigin,
  deriveFormLeadIngestionOrigin,
  omitForbiddenLeadLifecycleFields,
} from "./leadIngestionProvenance";

test("[AC-10] Form origin derivation uses trusted entry points and fails closed", () => {
  assert.equal(deriveFormLeadIngestionOrigin({}), "wordpress_form");
  assert.equal(
    deriveFormLeadIngestionOrigin({
      commandOrigin: "vantage_admin",
      actorType: "system",
    }),
    "wordpress_form",
  );
  assert.equal(
    deriveFormLeadIngestionOrigin({
      commandOrigin: "vantage_admin",
      actorType: "owner",
    }),
    "vantage_admin",
  );
  assert.equal(
    deriveFormLeadIngestionOrigin({
      commandOrigin: "vantage_admin",
      actorType: "admin",
    }),
    "vantage_admin",
  );
  assert.equal(
    deriveFormLeadIngestionOrigin({ commandOrigin: "external_sheet_ingestion" }),
    "best_relocation_sheet",
  );
  assert.equal(
    deriveFormLeadIngestionOrigin({ commandOrigin: "granot_lifecycle" }),
    "granot_lead_created",
  );
  assert.throws(
    () => deriveFormLeadIngestionOrigin({ commandOrigin: "ringcentral" }),
    ValidationError,
  );
});

test("[AC-12] Call origin derivation uses trusted entry points and fails closed", () => {
  assert.equal(deriveCallLeadIngestionOrigin({}), "vantage_admin");
  assert.equal(
    deriveCallLeadIngestionOrigin({ commandOrigin: "vantage_admin" }),
    "vantage_admin",
  );
  assert.equal(
    deriveCallLeadIngestionOrigin({ commandOrigin: "external_sheet_ingestion" }),
    "best_relocation_sheet",
  );
  assert.equal(
    deriveCallLeadIngestionOrigin({ commandOrigin: "ringcentral" }),
    "ringcentral",
  );
  assert.equal(
    deriveCallLeadIngestionOrigin({ commandOrigin: "granot_lifecycle" }),
    "granot_lead_created",
  );
});

test("compatibility updates cannot forge reporting review, RingCentral evidence or final-import automation guards", () => {
 const result = omitForbiddenLeadLifecycleFields({ name: "Corrected name", external_sheet_review: { kind: "bad_call" },
  external_call_admission: { policy_version: "best-relocation-final-import-v1" }, "external_call_admission.applied_at": new Date(),
  "external_sheet_review.raw_value": "bad", ringcentral: { qualification: { qualified: true } },
  "ringcentral.final_call_result": "Missed", outreach_automation_suppressed: false,
 });
 assert.deepEqual(result, { name: "Corrected name" });
});
