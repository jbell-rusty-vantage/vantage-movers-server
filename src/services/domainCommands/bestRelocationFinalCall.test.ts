import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import type { BestRelocationPlanAction } from "../bestRelocationSheetIngest/applicationPlan";
import type { CanonicalCommandContext } from "./types";
import { assertApprovedFinalCallAction, bestRelocationFinalCallPayloadChecksum, finalCallAdoptionReceiptTarget, selectFinalCallAdoption } from "./bestRelocationFinalCall";
import { BEST_RELOCATION_ADMISSION_COMPANY_ID as company, BEST_RELOCATION_ADMISSION_CALL_FEED_ID as feed } from "../leads/callLeadAdmission";
import { BEST_RELOCATION_TRACKER_ID } from "../leads/externalSheetReview";

const targetId = "600000000000000000000001";
test("only positive present receipt outcomes own Call identity; conflict candidates never admit", () => {
  for (const outcome of ["applied", "already_applied", "adopted"]) {
    assert.equal(finalCallAdoptionReceiptTarget({ outcome, source_state: "present", resulting_canonical_ids: [targetId] }), targetId);
    assert.equal(finalCallAdoptionReceiptTarget({ outcome, resulting_canonical_ids: [targetId] }), targetId);
  }
  for (const outcome of ["failed", "conflict", "conflict_dispositioned", "unchanged", "invalid", ""]) {
    assert.throws(() => finalCallAdoptionReceiptTarget({ outcome, source_state: "present", resulting_canonical_ids: [targetId] }), /receipt is invalid/);
  }
  assert.throws(() => finalCallAdoptionReceiptTarget({ outcome: "adopted", source_state: "source_missing", resulting_canonical_ids: [targetId] }), /receipt is invalid/);
  assert.throws(() => finalCallAdoptionReceiptTarget({ outcome: "applied", resulting_canonical_ids: [targetId, targetId] }), /receipt is invalid/);
});
function action(overrides: Record<string, unknown> = {}): BestRelocationPlanAction {
  return { action_key: "final:call:stable", command: "admit_final_best_relocation_call", classification: "create",
    dataset_key: "calls", stable_source_row_id: "stable", content_hash: "a".repeat(64), schema_profile: "calls:v2", schema_version: 2,
    provenance: { workbook_id: BEST_RELOCATION_TRACKER_ID, workbook_title: "Restricted", tab: "Calls", sheet_row: 2, source_row_key: "stable", raw: { "Form Fill Checker": "Duplicate" } },
    command_payload: { phone_number: "+15550001111", timestamp: "2026-04-30T04:00:00Z", source_company: "best_relocation_leads",
      lead_source_company: company, source_granularity_id: feed, duplicate: true, reviewed_for_insert: false, expected_disposition: "duplicate_calls", ...overrides }, depends_on: [] };
}
function context(row: BestRelocationPlanAction): CanonicalCommandContext {
  const owner = { actor_type: "owner", actor_id: "owner", actor_label: "Owner", actor_role: "owner", request_id: "request", origin: "vantage_admin" } as const;
  return { command_id: "command", idempotency_key: row.action_key, payload_checksum: bestRelocationFinalCallPayloadChecksum(row), actor: owner, initiator: owner,
    provenance: { origin: "external_sheet_ingestion", source_connection_key: "best_relocation", run_id: "600000000000000000000002", source_receipt_id: "600000000000000000000003" } };
}
function run(row: BestRelocationPlanAction) {
  const signed = { canonical_plan: { actions: [row] } };
  const checksum = createHash("sha256").update(JSON.stringify(signed)).digest("hex");
  return { plan_snapshot: { ...signed, checksum }, plan_checksum: checksum, source_read_through: new Date("2026-11-03T12:00:00Z"), initiator: { actor_id: "owner" }, approval: { final_reconciliation: true, owner_released_deferred_ingestion_checksum: checksum } as Record<string, unknown> };
}

test("final Calls require exact stored approval, pinned source scope and immutable action evidence", () => {
  const row = action(), input = { action: row, context: context(row) }, approved = run(row);
  assert.equal(assertApprovedFinalCallAction(input, approved).duplicate, true);
  assert.throws(() => assertApprovedFinalCallAction({ ...input, action: { ...row, content_hash: "b".repeat(64) } }, approved), /context/);
  const changed = action({ duplicate: false });
  assert.throws(() => assertApprovedFinalCallAction({ action: changed, context: context(changed) }, approved), /frozen plan/);
  assert.throws(() => assertApprovedFinalCallAction(input, { ...approved, approval: {} }), /approved frozen/);
  assert.throws(() => assertApprovedFinalCallAction(input, { ...approved, initiator: { actor_id: "another-owner" } }), /approved frozen/);
  const foreign = action({ lead_source_company: targetId });
  assert.throws(() => assertApprovedFinalCallAction({ action: foreign, context: context(foreign) }, run(foreign)));
  const arbitraryStamp = action({ external_call_admission: {} });
  assert.throws(() => assertApprovedFinalCallAction({ action: arbitraryStamp, context: context(arbitraryStamp) }, run(arbitraryStamp)));
});

test("new normal Calls stay held until explicit Owner checksum approval; existing target adoption remains possible", () => {
  const normal = action({ expected_disposition: "calls", duplicate: false }), input = { action: normal, context: context(normal) }, approved = run(normal);
  assert.throws(() => assertApprovedFinalCallAction(input, approved), /explicit Owner checksum/);
  const reviewed = action({ expected_disposition: "calls", duplicate: false, reviewed_for_insert: true });
  const reviewedRun = run(reviewed); reviewedRun.approval.normal_call_insert_approval = "different-checksum";
  assert.throws(() => assertApprovedFinalCallAction({ action: reviewed, context: context(reviewed) }, reviewedRun), /explicit Owner checksum/);
  reviewedRun.approval.normal_call_insert_approval = reviewedRun.plan_checksum;
  assert.throws(() => assertApprovedFinalCallAction({ action: reviewed, context: context(reviewed) }, reviewedRun), /persisted definite Booking/);
  reviewed.matching = { method: "definite_booking", calibration_version: "final-v1", evidence: ["booking_action:booking:job"] };
  const booking: BestRelocationPlanAction = { ...reviewed, action_key: "booking:job", command: "adopt_existing", classification: "adoption", dataset_key: "booked_deals", stable_source_row_id: "booking:job" };
  reviewedRun.plan_snapshot.canonical_plan.actions.push(booking);
  const snapshot = reviewedRun.plan_snapshot as typeof reviewedRun.plan_snapshot & { booking_matches: unknown[] };
  snapshot.booking_matches = [{ lead_action_key: reviewed.action_key, booking_action_key: booking.action_key, booking_identity: booking.stable_source_row_id,
    evidence: ["exact reviewed durable Booking identity"] }];
  const { checksum: _checksum, ...signed } = snapshot;
  snapshot.checksum = createHash("sha256").update(JSON.stringify(signed)).digest("hex");
  reviewedRun.plan_checksum = snapshot.checksum;
  reviewedRun.approval.normal_call_insert_approval = snapshot.checksum;
  reviewedRun.approval.owner_released_deferred_ingestion_checksum = snapshot.checksum;
  assert.equal(assertApprovedFinalCallAction({ action: reviewed, context: context(reviewed) }, reviewedRun).reviewed_for_insert, true);
  const adopted = action({ expected_disposition: "calls", duplicate: false, target_lead_id: targetId, expected_revision: 0 });
  assert.equal(assertApprovedFinalCallAction({ action: adopted, context: context(adopted) }, run(adopted)).target_lead_id, targetId);
});

test("window uses real source arrival and excludes the through watermark", () => {
  for (const timestamp of ["2026-04-30T03:59:59Z", "2026-11-03T12:00:00Z"]) {
    const row = action({ timestamp });
    assert.throws(() => assertApprovedFinalCallAction({ action: row, context: context(row) }, run(row)), /supported source window/);
  }
});

test("adoption requires one exact phone plus real arrival or exact durable receipt; no source field rewrites", () => {
  const row = action({ target_lead_id: targetId, expected_revision: 4 });
  const payload = assertApprovedFinalCallAction({ action: row, context: context(row) }, run(row));
  const saved = { _id: targetId, source_company: "best_relocation_leads", lead_source_company: company, source_granularity_id: feed,
    phone_number: "+15550001111", timestamp: new Date("2026-04-30T00:00:00Z"), createdAt: new Date("2026-05-01T12:00:00Z"),
    ingestion_origin: "legacy_unknown", domain_revision: 4, duplicate: false, over_2000: true, ringcentral: { unrelated_historical_fact: "preserved" } };
  const before = structuredClone(saved);
  assert.equal(selectFinalCallAdoption(payload, [saved]), saved);
  assert.deepEqual(saved, before);
  assert.throws(() => selectFinalCallAdoption(payload, [saved, { ...saved, _id: "600000000000000000000004" }]), /ambiguous/);
  assert.throws(() => selectFinalCallAdoption(payload, [{ ...saved, domain_revision: 5 }]), /revision changed/);
  assert.throws(() => selectFinalCallAdoption(payload, [{ ...saved, lead_source_company: targetId }]), /missing or ambiguous/);
  assert.throws(() => selectFinalCallAdoption(payload, [{ ...saved, timestamp: new Date("2026-05-02T00:00:00Z") }]), /missing or ambiguous/);
  assert.equal(selectFinalCallAdoption(payload, [{ ...saved, phone_number: "+15550002222" }], targetId)?._id, targetId);
  const createRow = action(), create = assertApprovedFinalCallAction({ action: createRow, context: context(createRow) }, run(createRow));
  assert.throws(() => selectFinalCallAdoption(create, [saved]), /replan for adoption/);
  assert.throws(() => selectFinalCallAdoption(create, Array.from({ length: 101 }, () => saved)), /bound exceeded/);
});

test("one original plus duplicate copies adopts only its original; aliases require the same approved primary and exact group", () => {
  const primary = action({ target_lead_id: targetId, expected_revision: 4 });
  primary.classification = "adoption";
  const duplicateId = "600000000000000000000004";
  const alias = action({ target_lead_id: duplicateId, expected_revision: 2, source_stable_row_id: "stable", primary_lead_id: targetId });
  alias.dataset_key = "call_aliases"; alias.stable_source_row_id = `stable:alias:${duplicateId}`;
  alias.action_key = `final:alias:${duplicateId}`; alias.classification = "adoption";
  const approved = run(primary); approved.plan_snapshot.canonical_plan.actions.push(alias);
  const primaryPayload = assertApprovedFinalCallAction({ action: primary, context: context(primary) }, approved);
  const aliasPayload = assertApprovedFinalCallAction({ action: alias, context: context(alias) }, approved);
  const base = { source_company: "best_relocation_leads", lead_source_company: company, source_granularity_id: feed,
    phone_number: "+15550001111", timestamp: new Date("2026-04-30T00:00:00Z"), createdAt: new Date("2026-05-01T12:00:00Z"), ingestion_origin: "legacy_unknown" };
  const group = [{ ...base, _id: targetId, duplicate: false, domain_revision: 4 }, { ...base, _id: duplicateId, duplicate: true, domain_revision: 2 }];
  const before = structuredClone(group);
  assert.equal(selectFinalCallAdoption(primaryPayload, group)?._id, targetId);
  assert.equal(selectFinalCallAdoption(aliasPayload, group)?._id, duplicateId);
  assert.deepEqual(group, before);
  assert.throws(() => selectFinalCallAdoption(aliasPayload, group.map(row => ({ ...row, duplicate: true }))), /ambiguous/);
  assert.throws(() => assertApprovedFinalCallAction({ action: alias, context: context(alias) }, run(alias)), /approved exact primary/);
  const forged = action({ target_lead_id: targetId, expected_revision: 4, source_stable_row_id: "foreign" });
  assert.throws(() => assertApprovedFinalCallAction({ action: forged, context: context(forged) }, run(forged)), /override source identity/);
});
