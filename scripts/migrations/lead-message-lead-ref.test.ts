import assert from "node:assert/strict";
import { test } from "node:test";
import {
  leadRefBackfillUpdate,
  leadRefMatchesFormLead,
  needsLeadRefBackfill,
  summarizeLeadRefInventory,
  toLeadRefInventoryRow,
} from "./lead-message-lead-ref.lib";

test("lead_ref backfill is idempotent and keeps form_lead aligned", () => {
  const formLead = "aaaaaaaaaaaaaaaaaaaaaaaa";
  assert.equal(needsLeadRefBackfill({}), true);
  assert.equal(needsLeadRefBackfill({ lead_ref: { id: formLead } }), false);
  const first = leadRefBackfillUpdate(formLead);
  const second = leadRefBackfillUpdate(formLead);
  assert.deepEqual(first, second);
  assert.equal(first.origin, "public_form");
  assert.equal(first.lead_ref.model, "FormLead");
  assert.equal(
    leadRefMatchesFormLead({ form_lead: formLead, lead_ref: { id: formLead } }),
    true,
  );
  assert.equal(
    leadRefMatchesFormLead({
      form_lead: formLead,
      lead_ref: { id: "bbbbbbbbbbbbbbbbbbbbbbbb" },
    }),
    false,
  );

  const summary = summarizeLeadRefInventory([
    toLeadRefInventoryRow({ _id: "1", form_lead: formLead }),
    toLeadRefInventoryRow({
      _id: "2",
      form_lead: formLead,
      lead_ref: { model: "FormLead", id: formLead },
    }),
    toLeadRefInventoryRow({ _id: "3" }),
  ]);
  assert.equal(summary.total, 3);
  assert.equal(summary.missing_lead_ref, 2);
  assert.equal(summary.orphaned_form_lead, 1);
});
