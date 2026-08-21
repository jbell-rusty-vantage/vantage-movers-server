import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_CRM_SOURCE_OUTBOUND_SMS,
  needsOutboundSmsBackfill,
  summarizeOutboundSmsInventory,
  toInventoryRow,
} from "./granot-crm-source-outbound-sms.lib";

test("outbound SMS backfill only targets missing subdocuments and stays disabled", () => {
  assert.equal(needsOutboundSmsBackfill({}), true);
  assert.equal(needsOutboundSmsBackfill({ outbound_sms: null }), true);
  assert.equal(
    needsOutboundSmsBackfill({
      outbound_sms: { enabled: true, consent_basis: "existing_relationship" },
    }),
    false,
  );
  assert.equal(DEFAULT_CRM_SOURCE_OUTBOUND_SMS.enabled, false);
  assert.equal(DEFAULT_CRM_SOURCE_OUTBOUND_SMS.consent_basis, "not_attested");

  const summary = summarizeOutboundSmsInventory([
    toInventoryRow({ _id: "1", granot_label: "A" }),
    toInventoryRow({
      _id: "2",
      granot_label: "B",
      outbound_sms: { enabled: true },
    }),
    toInventoryRow({
      _id: "3",
      granot_label: "C",
      outbound_sms: { enabled: false },
    }),
  ]);
  assert.deepEqual(summary, {
    total: 3,
    missing_outbound_sms: 1,
    already_configured: 2,
    enabled: 1,
  });
});
