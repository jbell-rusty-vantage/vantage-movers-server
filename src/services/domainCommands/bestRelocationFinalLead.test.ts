import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { computeChecksum } from "../durableWork";
import type { BestRelocationPlanAction } from "../bestRelocationSheetIngest/applicationPlan";
import { BEST_RELOCATION_TRACKER_ID } from "../leads/externalSheetReview";
import { assertApprovedFinalFormCreate, assertFinalNormalLeadBookingMatch, finalFormCreateAuthorization } from "./bestRelocationFinalLead";
import type { CanonicalCommandContext } from "./types";

const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function fixture(note = "") {
  const lead: BestRelocationPlanAction = { action_key: "form:source-id", command: "create_form_lead", classification: "create",
    dataset_key: "forms", stable_source_row_id: "lead:source-id", content_hash: "a".repeat(64), schema_profile: "forms:v2", schema_version: 2,
    command_payload: { source_company: "best_relocation_leads", timestamp: "2026-05-01T12:00:00Z", phone_number: "+15550001111" }, depends_on: [],
    provenance: { workbook_id: BEST_RELOCATION_TRACKER_ID, workbook_title: "Restricted", tab: "Forms", sheet_row: 2,
      source_row_key: "source-id", raw: { "Bad Lead Checker": note } },
    matching: { method: "definite_booking", calibration_version: "final-v1", evidence: ["booking_action:booking:job"] } };
  const booking: BestRelocationPlanAction = { ...lead, action_key: "booking:job", command: "adopt_existing", classification: "adoption",
    dataset_key: "booked_deals", stable_source_row_id: "booking:job", adopted_entity_refs: [{ model: "BookedLead", id: "600000000000000000000004" }] };
  const snapshot = { checksum: "", canonical_plan: { actions: [lead, booking] }, booking_matches: [{ lead_action_key: lead.action_key,
    booking_action_key: booking.action_key, booking_identity: booking.stable_source_row_id, evidence: ["exact durable Lead ID and consistent source/contact"] }] };
  const owner = { actor_type: "owner", actor_id: "owner", actor_label: "Owner", actor_role: "owner", request_id: "request", origin: "vantage_admin" } as const;
  const context: CanonicalCommandContext = { command_id: "command", idempotency_key: lead.action_key, payload_checksum: computeChecksum({
    checksum_version: 1, artifact_kind: "ingestion_plan", schema_version: 2, payload: lead.command_payload }), actor: owner, initiator: owner,
    provenance: { origin: "external_sheet_ingestion", source_connection_key: "best_relocation", run_id: "600000000000000000000002", source_receipt_id: "600000000000000000000003" } };
  const run = { plan_snapshot: snapshot, plan_checksum: "", source_read_through: new Date("2026-11-03T12:00:00Z"),
    initiator: owner, approval: { final_reconciliation: true, owner_released_deferred_ingestion_checksum: "" } };
  const sign = () => { const { checksum: _checksum, ...signed } = snapshot; snapshot.checksum = sha(signed);
    run.plan_checksum = snapshot.checksum; run.approval.owner_released_deferred_ingestion_checksum = snapshot.checksum; };
  sign();
  return { lead, booking, run, input: { data: lead.command_payload, context }, sign };
}

test("normal Form and Call policy rejects action-only evidence, unresolved Bookings and modified frozen graphs", () => {
  const f = fixture();
  assert.doesNotThrow(() => assertFinalNormalLeadBookingMatch(f.lead, f.run));
  f.run.plan_snapshot.booking_matches = []; f.sign();
  assert.throws(() => assertFinalNormalLeadBookingMatch(f.lead, f.run), /persisted definite Booking/);
  const unresolved = fixture(); unresolved.booking.command = "record_conflict"; unresolved.sign();
  assert.throws(() => assertFinalNormalLeadBookingMatch(unresolved.lead, unresolved.run), /unresolved/);
  const wrongIdentity = fixture(); wrongIdentity.run.plan_snapshot.booking_matches[0]!.booking_identity = "booking:another"; wrongIdentity.sign();
  assert.throws(() => assertFinalNormalLeadBookingMatch(wrongIdentity.lead, wrongIdentity.run), /unresolved/);
  const ambiguous = fixture(); ambiguous.run.plan_snapshot.booking_matches.push({ ...ambiguous.run.plan_snapshot.booking_matches[0]! }); ambiguous.sign();
  assert.throws(() => assertFinalNormalLeadBookingMatch(ambiguous.lead, ambiguous.run), /persisted definite Booking/);
  const tampered = fixture(); tampered.run.plan_snapshot.booking_matches[0]!.evidence.push("changed evidence");
  assert.throws(() => assertFinalNormalLeadBookingMatch(tampered.lead, tampered.run), /released frozen plan checksum/);
  const held = fixture(); held.run.approval.owner_released_deferred_ingestion_checksum = "old";
  assert.throws(() => assertFinalNormalLeadBookingMatch(held.lead, held.run), /released frozen plan checksum/);
});

test("final Form creates bind exact payload, source, event window and actor to a released action", () => {
  const f = fixture();
  assert.equal(assertApprovedFinalFormCreate(f.input, f.run), f.lead);
  assert.throws(() => assertApprovedFinalFormCreate({ ...f.input, data: { ...f.input.data, phone_number: "+15550002222" } }, f.run), /released frozen plan/);
  const foreign = fixture(); if ("rows" in foreign.lead.provenance) throw new Error("fixture");
  foreign.lead.provenance.workbook_id = "other-workbook"; foreign.sign();
  assert.throws(() => assertApprovedFinalFormCreate(foreign.input, foreign.run), /released frozen plan/);
  const wrongOwner = fixture();
  assert.throws(() => assertApprovedFinalFormCreate(wrongOwner.input, { ...wrongOwner.run, initiator: { actor_id: "other" } }), /released frozen plan/);
  const outOfRange = fixture(); outOfRange.run.source_read_through = new Date("2026-05-01T12:00:00Z");
  assert.throws(() => assertApprovedFinalFormCreate(outOfRange.input, outOfRange.run), /source window/);
});

test("bad Form exceptions have a protected review before insert; duplicate and normal creation use distinct permissions", () => {
  const bad = fixture("Duplicate Form"); bad.run.plan_snapshot.booking_matches = []; bad.sign();
  const authorization = finalFormCreateAuthorization(bad.input, bad.run, new Date("2026-11-03T11:00:00Z"));
  assert.equal(authorization.review?.kind, "bad_form");
  assert.equal(authorization.review?.raw_value, "Duplicate Form");
  assert.equal(authorization.review?.source_content_hash, sha(["best-relocation-retirement-v1", { "Bad Lead Checker": "Duplicate Form" }]));
  assert.doesNotThrow(() => authorization.assertCreate(false));
  const short = fixture("no"); short.run.plan_snapshot.booking_matches = []; short.sign();
  const normal = finalFormCreateAuthorization(short.input, short.run, new Date());
  assert.equal(normal.review, undefined);
  assert.throws(() => normal.assertCreate(false), /persisted definite Booking/);
  assert.doesNotThrow(() => normal.assertCreate(true));
  const structural = fixture("#REF!");
  assert.throws(() => finalFormCreateAuthorization(structural.input, structural.run, new Date()), /structural_or_error/);
});
