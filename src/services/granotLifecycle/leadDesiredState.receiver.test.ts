import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import type { GranotObservationDocument } from "../../models/GranotObservation";
import type { LeadIdentityResult } from "./identity";
import { planLeadDesiredState, receiverReplaceableByGranot, type LeadDesiredStateProjection } from "./leadDesiredState";
import type { SourcePolicySnapshot } from "./sourcePolicy";

/**
 * S6-AGENT C3 (assignment addendum §3.1, E3/E6), fixed clock. The latest-wins rule is passed explicitly
 * (`receiver_latest_wins`); the default reads SALES_INTELLIGENCE_RECEIVER_LATEST_WINS (unset here: off).
 */
const capturedAt = new Date("2026-09-24T15:00:00.000Z");
const now = new Date("2026-09-24T15:00:05.000Z");
const oid = () => new mongoose.Types.ObjectId();
const OLD = String(oid()), NEW = String(oid());

function observation(overrides: Partial<GranotObservationDocument> = {}): GranotObservationDocument {
  return { _id: oid(), receipt_id: oid(), schema_version: 1, kind: "lead_snapshot", normalization_result: "valid", route_event_class: "priority_updated",
    captured_at: capturedAt, source_label_raw: "Synthetic Forms", normalized_source_label: "synthetic forms",
    identity: { job_no_raw: "synthetic-job-100", normalized_job_no: "SYNTHETIC JOB 100" }, contact: {}, move: {},
    priority: { valid: true, canonical: "3" }, booking_action: {}, display_money: {}, agent_identity: { rep_raw: "new.rep" }, provider_context: {}, issues: [],
    createdAt: capturedAt, updatedAt: capturedAt, ...overrides } as GranotObservationDocument;
}
const policy = (): SourcePolicySnapshot => ({ granot_crm_source_id: String(oid()), lead_source_company_id: String(oid()), source_granularity_id: String(oid()),
  selected_route_key: "form_local", selected_lead_model: "FormLead", selected_move_type: "local", lifecycle_disposition: "source_scoped_lead", lead_created_policy: "link_only" });
function identity(leadId: string, agentId: string | null, assertion: "single" | "conflict" | "empty" = "single"): LeadIdentityResult {
  return { outcome: "linked", reason_code: "record_link_confirmed", match_method: "form_ref_no_exact", target: { model: "FormLead", id: leadId }, target_eligibility: "full",
    candidates: [{ target: { model: "FormLead", id: leadId }, reason_codes: ["form_ref_no_exact"] }], agent_assertion: assertion,
    ...(agentId && assertion === "single" ? { agent: { target: { model: "Agent", id: agentId }, normalized_username: "new.rep" } } : {}) };
}
const lead = (overrides: Partial<LeadDesiredStateProjection> = {}): LeadDesiredStateProjection => ({ model: "FormLead", id: String(oid()), ingestion_origin: "wordpress_form",
  quoted: false, granot_priority: "3", receiver_agent: OLD, receiver_agent_source: "granot_username_match", receiver_agent_set_at: new Date("2026-09-20T12:00:00Z"), ...overrides });
function plan(row: LeadDesiredStateProjection, options: { latestWins?: boolean; agent?: string | null; assertion?: "single" | "conflict" | "empty"; observation?: GranotObservationDocument; temporal?: "newer" | "older" } = {}) {
  return planLeadDesiredState({ observation: options.observation ?? observation(), identity: identity(row.id, options.agent === undefined ? NEW : options.agent, options.assertion),
    lead: row, policy: policy(), now, attempt: 1, temporal_order: options.temporal ?? "newer", receiver_latest_wins: options.latestWins ?? true });
}
const receiverPaths = ["receiver_agent", "receiver_agent_source", "receiver_agent_source_value"];

test("C3: a different Granot rep replaces a Granot / extension / sheet / RingCentral receiver (flag on)", () => {
  for (const source of ["granot_username_match", "extension_crm_username_match", "extension_match", "extension_selected", "extension_created", "best_relocation_sheet", "ringcentral_answered"]) {
    const result = plan(lead({ receiver_agent_source: source }));
    assert.equal(result.desired_values.receiver_agent, NEW, source);
    assert.equal(result.desired_values.receiver_agent_source, source === "granot_username_match" ? undefined : "granot_username_match", source);
    assert.ok(result.agent_changed_paths.includes("receiver_agent"), source);
  }
});

test("C3: a manual (or source-less) receiver is never replaced; the same Agent plans nothing", () => {
  for (const row of [lead({ receiver_agent_source: "manual" }), lead({ receiver_agent_source: undefined })]) {
    const result = plan(row);
    assert.equal(result.desired_values.receiver_agent, undefined);
    assert.deepEqual(result.agent_changed_paths, []);
  }
  const same = plan(lead({ receiver_agent_source: "extension_match" }), { agent: OLD });
  assert.equal(same.desired_values.receiver_agent, undefined, "same Agent: no source re-stamp");
  assert.deepEqual(same.agent_changed_paths, []);
});

test("C3: an older observation delivered late never replaces a newer rep", () => {
  // Granot vs Granot: the Lead's temporal winner is newer, so the whole observation plans `stale`.
  const stale = plan(lead(), { temporal: "older" });
  assert.equal(stale.outcome, "stale");
  assert.equal(stale.desired_values.receiver_agent, undefined);
  // Extension / sheet set after the observation was captured: kept.
  for (const source of ["extension_crm_username_match", "best_relocation_sheet"]) {
    const kept = plan(lead({ receiver_agent_source: source, receiver_agent_set_at: new Date(+capturedAt + 60_000) }));
    assert.equal(kept.desired_values.receiver_agent, undefined, source);
  }
  // The RingCentral answer is the weakest source: replaced whatever its time (E5).
  assert.equal(plan(lead({ receiver_agent_source: "ringcentral_answered", receiver_agent_set_at: new Date(+capturedAt + 60_000) })).desired_values.receiver_agent, NEW);
});

test("C3: user ≠ rep, an ambiguous username or an invalid Priority changes nothing", () => {
  assert.equal(plan(lead(), { assertion: "conflict", agent: null }).desired_values.receiver_agent, undefined, "user ≠ rep");
  assert.equal(plan(lead(), { agent: null }).desired_values.receiver_agent, undefined, "no single active Agent");
  assert.equal(plan(lead(), { observation: observation({ priority: { valid: false } } as Partial<GranotObservationDocument>) }).desired_values.receiver_agent, undefined, "invalid Priority");
});

test("flag off: byte-identical fill-empty rule", () => {
  for (const source of ["granot_username_match", "extension_match", "best_relocation_sheet", "ringcentral_answered", "manual"]) {
    const off = plan(lead({ receiver_agent_source: source }), { latestWins: false });
    assert.equal(off.desired_values.receiver_agent, undefined, source);
  }
  const emptyLead = lead({ receiver_agent: undefined, receiver_agent_source: undefined, receiver_agent_set_at: undefined });
  const empty = plan(emptyLead, { latestWins: false });
  assert.equal(empty.desired_values.receiver_agent, NEW);
  assert.deepEqual(empty.agent_changed_paths, receiverPaths);
  // The same empty Lead plans the same with the flag on.
  assert.deepEqual(plan(emptyLead), empty);
});

test("the default reads SALES_INTELLIGENCE_RECEIVER_LATEST_WINS", () => {
  const row = lead({ receiver_agent_source: "extension_match" });
  const input = { observation: observation(), identity: identity(row.id, NEW), lead: row, policy: policy(), now, attempt: 1, temporal_order: "newer" as const };
  const prior = process.env.SALES_INTELLIGENCE_RECEIVER_LATEST_WINS;
  try {
    delete process.env.SALES_INTELLIGENCE_RECEIVER_LATEST_WINS;
    assert.equal(planLeadDesiredState(input).desired_values.receiver_agent, undefined);
    process.env.SALES_INTELLIGENCE_RECEIVER_LATEST_WINS = "true";
    assert.equal(planLeadDesiredState(input).desired_values.receiver_agent, NEW);
  } finally {
    if (prior === undefined) delete process.env.SALES_INTELLIGENCE_RECEIVER_LATEST_WINS; else process.env.SALES_INTELLIGENCE_RECEIVER_LATEST_WINS = prior;
  }
});

test("receiverReplaceableByGranot table", () => {
  const at = capturedAt, later = new Date(+at + 1), earlier = new Date(+at - 1);
  const rows: Array<[string, Parameters<typeof receiverReplaceableByGranot>[0], string | undefined, boolean]> = [
    ["empty", {}, NEW, true],
    ["no resolved agent", { receiver_agent: OLD, receiver_agent_source: "extension_match" }, undefined, false],
    ["same agent", { receiver_agent: NEW, receiver_agent_source: "extension_match" }, NEW, false],
    ["manual", { receiver_agent: OLD, receiver_agent_source: "manual" }, NEW, false],
    ["no source", { receiver_agent: OLD }, NEW, false],
    ["granot", { receiver_agent: OLD, receiver_agent_source: "granot_username_match", receiver_agent_set_at: later }, NEW, true],
    ["ringcentral later", { receiver_agent: OLD, receiver_agent_source: "ringcentral_answered", receiver_agent_set_at: later }, NEW, true],
    ["extension earlier", { receiver_agent: OLD, receiver_agent_source: "extension_selected", receiver_agent_set_at: earlier }, NEW, true],
    ["extension same instant", { receiver_agent: OLD, receiver_agent_source: "extension_selected", receiver_agent_set_at: at }, NEW, false],
    ["sheet later", { receiver_agent: OLD, receiver_agent_source: "best_relocation_sheet", receiver_agent_set_at: later }, NEW, false],
    ["extension, unknown set time", { receiver_agent: OLD, receiver_agent_source: "extension_match" }, NEW, true],
  ];
  for (const [name, row, agent, expected] of rows) assert.equal(receiverReplaceableByGranot(row, agent, at), expected, name);
});
