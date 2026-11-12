import assert from "node:assert/strict";
import test from "node:test";
import { cachedCanonicalAdoptionStore } from "./sourcePlanCache";
import { applyFinalReceiptPolicy } from "./sourcePlan";
import { applyCanonicalAdoptionPolicy } from "../../src/services/bestRelocationSheetIngest/canonicalLeadAdoption";
import type { BestRelocationApplicationPlan, BestRelocationPlanAction } from "../../src/services/bestRelocationSheetIngest/applicationPlan";

const id = "507f1f77bcf86cd799439001", linked = "507f1f77bcf86cd799439002";
function plan(actions: BestRelocationPlanAction[]): BestRelocationApplicationPlan {
  return { adapter_key: "best_relocation", schema_version: 2, trigger: "manual", cutoff: "2026-04-30T04:00:00Z", source_read_through: "2026-11-03T12:00:00Z", timezone: "America/New_York",
    source_snapshot: { leads: { id: "synthetic", title: "Synthetic" }, booked: { id: "synthetic", title: "Synthetic" } }, calibration_version: "best-relocation-conservative-v2", actions, counters: {}, warnings: [] };
}
function action(key: string): BestRelocationPlanAction {
  return { action_key: key, command: "create_form_lead", classification: "create", dataset_key: "forms", stable_source_row_id: key,
    content_hash: "a".repeat(64), schema_profile: "forms:v2", schema_version: 2, depends_on: [],
    command_payload: { name: "Synthetic", phone_number: "+15550001111", ref_no: key, timestamp: "2026-05-01T16:00:00Z" }, source_owned_values: { name: "Synthetic" },
    provenance: { workbook_id: "synthetic", workbook_title: "Synthetic", tab: "Forms", sheet_row: 2, source_row_key: key, raw: {} } };
}
test("cached adoption retains conservative identity, phone/name/date and financial uniqueness decisions", async () => {
  const store = cachedCanonicalAdoptionStore({ forms: [{ _id: id, ref_no: "synthetic-id", name: "Synthetic", phone_number: "5550001111", normalized_phone_number: "5550001111", timestamp: new Date("2026-05-01T16:00:00Z") }],
    bookings: [{ _id: linked, normalized_job_no: "SYNTHETICJOB" }], cancellations: [{ _id: "507f1f77bcf86cd799439003", booked_lead: linked }] });
  const exact = action("synthetic-id"), fallback = action("synthetic-other-id");
  const adopted = await applyCanonicalAdoptionPolicy({ plan: plan([exact, fallback]), store });
  assert.ok(adopted.actions.every(action => action.command === "adopt_existing" && action.adopted_entity_refs?.[0]?.id === id));
  assert.equal((await store.findBookingsByJob("SYNTHETICJOB"))[0]?.id, linked);
  assert.equal((await store.findCancellationsByBooking(linked))[0]?.booked_lead, linked);
  await assert.rejects(store.findCallLeadsByPhoneTimestamp({ phone: "5550001111", timestamp: new Date() }), /cannot_adopt_or_create_calls/);
});
test("batched receipt policy keeps canonical IDs primary and only unchanged source values adopt", () => {
  const first = action("first"), changed = action("changed"), dependent = { ...action("dependent"), depends_on: [first.action_key] };
  const previous = { resulting_canonical_model: "FormLead", resulting_canonical_ids: [id], content_hash: first.content_hash };
  const evidence = { latest: new Map([
    ["forms:first", { ...previous, content_hash: "review-hash", observation_type: "final_review" }],
    ["forms:changed", { ...previous, content_hash: "older-hash" }],
  ]), canonical: new Map([["forms:first", previous], ["forms:changed", { ...previous, content_hash: "older-hash" }]]), states: new Map() };
  const transformed = applyFinalReceiptPolicy(plan([first, changed, dependent]), evidence);
  assert.equal(transformed.actions[0]?.command, "adopt_existing");
  assert.equal(transformed.actions[0]?.adopted_entity_refs?.[0]?.id, id);
  assert.equal(transformed.actions[1]?.command, "record_conflict");
  assert.equal(transformed.actions[1]?.conflict?.severity, "blocking");
  assert.deepEqual(transformed.actions[2]?.depends_on, [transformed.actions[0]!.action_key]);
  assert.equal(transformed.actions.some(action => action.command === "update_source_owned_lead"), false);
});

test("cached source adoption carries timestamp provenance and includes the wall-clock midnight cutoff", async () => {
  const store = cachedCanonicalAdoptionStore({ forms: [
    { _id: id, name: "Synthetic", phone_number: "5550001111", normalized_phone_number: "5550001111", timestamp: new Date("2026-04-30T00:30:00Z"), createdAt: new Date("2026-04-30T04:30:01Z"), ingestion_origin: "legacy_unknown", duplicate: false },
    { _id: linked, name: "Other", phone_number: "5550002222", normalized_phone_number: "5550002222", timestamp: new Date("2026-08-28T03:30:00Z"), createdAt: new Date("2026-08-28T03:30:01Z"), ingestion_origin: "granot_lead_created", duplicate: false },
  ], bookings: [], cancellations: [] });
  const midnight = action("cutoff-new-ref");
  midnight.command_payload = { name: "Synthetic", phone_number: "5550001111", timestamp: "2026-04-30T16:00:00Z" };
  const instant = action("granot-new-ref");
  instant.command_payload = { name: "Other", phone_number: "5550002222", timestamp: "2026-08-28T16:00:00Z" };
  const result = await applyCanonicalAdoptionPolicy({ plan: plan([midnight, instant]), store });
  assert.equal(result.actions[0]?.command, "adopt_existing");
  assert.equal(result.actions[0]?.adopted_entity_refs?.[0]?.id, id);
  assert.equal(result.actions[1]?.command, "create_form_lead");
});
