import assert from "node:assert/strict";
import { test } from "node:test";
import { assembleJobNumberTimeline } from "./assemble.js";
import { assertPageSafe, redactTimelineValue } from "./masking.js";
import { emptyJobTimelineRows } from "./rows.js";

const LEAD_NAME = "Ada Lovelace";
const LEAD_PHONE = "5550001234";
const SMS_BODY = "Thanks for requesting a quote, Ada.";
const OBS_CONTACT = "Ada L contact";

test("Masking", () => {
  const result = assembleJobNumberTimeline({
    rawJobNo: "9001001",
    rows: {
      ...emptyJobTimelineRows(),
      observations: [
        {
          id: "obs-wp-1",
          captured_at: "2026-03-01T12:00:00.000Z",
          normalized_job_no: "9001001",
          route_event_class: "priority_updated",
          contact: { display_name: OBS_CONTACT, phone_raw: LEAD_PHONE },
        },
      ],
      decisions: [
        {
          id: "dec-wp-1",
          observation_id: "obs-wp-1",
          attempt: 1,
          decided_at: "2026-03-01T12:00:00.000Z",
          outcome: "applied",
          reason_code: "lead_synchronized",
          target: { model: "FormLead", id: "lead-wp-1" },
        },
      ],
      leads: [
        {
          id: "lead-wp-1",
          model: "FormLead",
          ingestion_origin: "wordpress_form",
          timestamp: "2026-03-01T10:00:00.000Z",
          name: LEAD_NAME,
          phone: LEAD_PHONE,
          email: "ada@example.invalid",
        },
      ],
      entity_changes: [
        {
          id: "chg-wp-create",
          entity_model: "FormLead",
          entity_id: "lead-wp-1",
          command_name: "createFormLead",
          applied_at: "2026-03-01T10:00:00.000Z",
          changed_paths: ["name"],
        },
        {
          id: "chg-wp-sync",
          entity_model: "FormLead",
          entity_id: "lead-wp-1",
          command_name: "synchronizeLeadFromGranot",
          applied_at: "2026-03-01T12:00:00.000Z",
          changed_paths: ["job_no"],
        },
      ],
      lead_messages: [
        {
          id: "msg-wp-1",
          lead_id: "lead-wp-1",
          origin: "public_form",
          purpose: "quote_request_confirmation",
          status: "delivered",
          delivered_at: "2026-03-01T11:00:00.000Z",
          to: LEAD_PHONE,
          body: SMS_BODY,
        },
      ],
      sheet_sync_jobs: [
        {
          id: "sheet-wp-create",
          entity_id: "lead-wp-1",
          resource: "source_lead",
          operation: "form_lead.create",
          status: "synced",
          createdAt: "2026-03-01T10:30:00.000Z",
          last_error: "row text must never leak",
          spreadsheet_id: "spread-secret",
        },
      ],
    },
  });
  assert.equal(result.status, "ok");
  if (result.status !== "ok") throw new Error("expected ok");
  const serialized = JSON.stringify(result.page);
  assert.equal(serialized.includes(LEAD_NAME), false);
  assert.equal(serialized.includes(LEAD_PHONE), false);
  assert.equal(serialized.includes(SMS_BODY), false);
  assert.equal(serialized.includes(OBS_CONTACT), false);
  assert.equal(serialized.includes("9001001"), true);
  assert.equal(serialized.includes("spreadsheet_id"), false);
  assert.equal(serialized.includes("last_error"), false);
  assertPageSafe(serialized);
  const redacted = JSON.stringify(redactTimelineValue(result.page));
  assert.equal(redacted.includes(SMS_BODY), false);
});
