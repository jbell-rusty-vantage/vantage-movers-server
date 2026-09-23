import assert from "node:assert/strict";
import { test } from "node:test";
import { moveViewsForLead, type LeadMoveSource } from "./views";

const formLead: LeadMoveSource = {
  pickup_city: " Miami ", pickup_state: "FL", pickup_zip: "33101", delivery_city: "Austin", delivery_state: "not_found",
  destination_zip: "73301", move_date: new Date("2026-10-15T00:00:00Z"), move_size: "2 Bedroom", granot_move_size: "2BR", cubic_feet: 850,
  ingestion_origin: "wordpress_form",
  current_move_provenance: { source_system: "granot", changed_at: new Date("2026-09-10T12:00:00Z"), observation_id: "obs-1" },
  ingested_move_snapshot: { pickup_city: "Miami", pickup_state: "FL", pickup_zip: "33101", delivery_city: "Dallas", delivery_state: "TX",
    destination_zip: "75201", move_date: new Date("2026-10-01T00:00:00Z"), move_size: "1 Bedroom",
    captured_at: new Date("2026-09-01T10:00:00Z"), evidence_status: "captured_at_ingestion" },
};

test("Form Lead destination_zip and Call Lead delivery_zip both become delivery.zip; unknown state is null", () => {
  const form = moveViewsForLead(formLead, "FormLead").canonical_current;
  assert.deepEqual(form.pickup, { city: "Miami", state: "FL", zip: "33101" });
  assert.deepEqual(form.delivery, { city: "Austin", state: null, zip: "73301" });
  const call = moveViewsForLead({ delivery_zip: "10001", delivery_city: "New York", delivery_state: "NY", destination_zip: "99999",
    move_date: new Date("2026-10-15T00:00:00Z"), move_size: "Studio", granot_move_size: "Studio", cubic_feet: 300 }, "CallLead");
  assert.deepEqual(call.canonical_current.delivery, { city: "New York", state: "NY", zip: "10001" });
  // Call Leads have no supported move date/size; they stay null rather than being invented.
  assert.equal(call.canonical_current.move_date, null);
  assert.equal(call.canonical_current.move_size, null);
  assert.equal(call.canonical_current.granot_move_size, "Studio");
  assert.equal(call.original_ingestion, null);
});

test("current values keep their provenance and local calendar date", () => {
  const current = moveViewsForLead(formLead, "FormLead").canonical_current;
  assert.equal(current.move_date, "2026-10-15");
  assert.equal(current.cubic_feet, 850);
  assert.deepEqual(current.provenance, { source_system: "granot", changed_at: "2026-09-10T12:00:00.000Z", observation_id: "obs-1" });
});

test("original form submission, legacy baseline and a changed current move are distinguishable", () => {
  const views = moveViewsForLead(formLead, "FormLead");
  assert.equal(views.original_ingestion?.label, "original_form_submission");
  assert.deepEqual(views.original_ingestion?.delivery, { city: "Dallas", state: "TX", zip: "75201" });
  assert.equal(views.original_ingestion?.move_date, "2026-10-01");
  assert.notDeepEqual(views.original_ingestion?.delivery, views.canonical_current.delivery);
  assert.equal(views.original_ingestion?.provenance, null);

  const baseline = moveViewsForLead({ ...formLead, ingestion_origin: "legacy_unknown",
    ingested_move_snapshot: { ...formLead.ingested_move_snapshot!, evidence_status: "legacy_baseline" } }, "FormLead");
  assert.equal(baseline.original_ingestion?.label, "legacy_baseline");
  // A legacy baseline is still a baseline even if the origin looks like a form.
  const baselineForm = moveViewsForLead({ ...formLead, ingested_move_snapshot: { ...formLead.ingested_move_snapshot!, evidence_status: "legacy_baseline" } }, "FormLead");
  assert.equal(baselineForm.original_ingestion?.label, "legacy_baseline");

  assert.equal(moveViewsForLead({ ...formLead, ingestion_origin: "granot_lead_created" }, "FormLead").original_ingestion?.label, "granot_created");
  assert.equal(moveViewsForLead({ ...formLead, ingestion_origin: "vantage_admin" }, "FormLead").original_ingestion?.label, "unknown");
  assert.equal(moveViewsForLead({ ...formLead, ingested_move_snapshot: null }, "FormLead").original_ingestion, null);
});
