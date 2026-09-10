import assert from "node:assert/strict";
import { test } from "node:test";
import { FORM_LEAD_UNKNOWN_STATE } from "../../src/models/FormLead.js";
import {
  classifyUnknownStateLocalRow,
  september2026FloridaWindow,
  summarizeUnknownStateLocalInventory,
  unknownStateFormLeadFilter,
} from "./form-lead-unknown-state-local.lib.js";

test("September 2026 window is the Florida-stamped calendar month", () => {
  const window = september2026FloridaWindow();
  assert.equal(window.start.toISOString(), "2026-09-01T00:00:00.000Z");
  assert.equal(window.end.toISOString(), "2026-10-01T00:00:00.000Z");
});

test("filter is Form Leads in the month with a not_found state", () => {
  const filter = unknownStateFormLeadFilter(september2026FloridaWindow());
  assert.deepEqual(filter.$or, [
    { pickup_state: FORM_LEAD_UNKNOWN_STATE },
    { delivery_state: FORM_LEAD_UNKNOWN_STATE },
  ]);
  assert.equal(filter.timestamp.$gte.toISOString(), "2026-09-01T00:00:00.000Z");
  assert.equal(filter.timestamp.$lt.toISOString(), "2026-10-01T00:00:00.000Z");
});

test("classify marks long_distance unknown-state rows for update", () => {
  const row = classifyUnknownStateLocalRow({
    _id: "6aa2c862c5940557a85a367f",
    timestamp: new Date("2026-09-08T14:00:00.000Z"),
    pickup_state: "NC",
    delivery_state: FORM_LEAD_UNKNOWN_STATE,
    local: "long_distance",
    source_company: "tbm_leads",
    duplicate: false,
    no_sync: false,
  });
  assert.equal(row.needs_update, true);
  assert.equal(row.local, "long_distance");
  assert.equal(row.delivery_state, FORM_LEAD_UNKNOWN_STATE);
});

test("classify skips rows that are already local", () => {
  const row = classifyUnknownStateLocalRow({
    _id: "6aa2c862c5940557a85a367f",
    pickup_state: FORM_LEAD_UNKNOWN_STATE,
    delivery_state: FORM_LEAD_UNKNOWN_STATE,
    local: "local",
  });
  assert.equal(row.needs_update, false);
});

test("summary counts needs_update versus already_local", () => {
  const summary = summarizeUnknownStateLocalInventory([
    classifyUnknownStateLocalRow({ local: "long_distance" }),
    classifyUnknownStateLocalRow({ local: "local" }),
    classifyUnknownStateLocalRow({ local: "long_distance" }),
  ]);
  assert.deepEqual(summary, {
    scanned: 3,
    needs_update: 2,
    already_local: 1,
  });
});
