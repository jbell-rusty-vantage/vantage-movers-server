import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import type { GranotObservationDocument } from "../../models/GranotObservation";
import type { LeadIdentityResult } from "./identity";
import { planLeadDesiredState, type LeadDesiredStateProjection } from "./leadDesiredState";
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

test("ringcentral_rep_call: a different Granot rep replaces it with latest wins on or off; the same Agent plans nothing", () => {
  const placeholder = (extra: Partial<LeadDesiredStateProjection> = {}) =>
    lead({ receiver_agent_source: "ringcentral_rep_call", receiver_agent_set_at: new Date(+capturedAt + 60_000), ...extra });
  for (const latestWins of [true, false]) {
    const replaced = plan(placeholder(), { latestWins });
    assert.equal(replaced.desired_values.receiver_agent, NEW, `latestWins=${latestWins}`);
    assert.equal(replaced.desired_values.receiver_agent_source, "granot_username_match");
    assert.deepEqual(replaced.agent_changed_paths, receiverPaths);
    assert.deepEqual(plan(placeholder({ receiver_agent: NEW }), { latestWins }).agent_changed_paths, [], `same Agent, latestWins=${latestWins}`);
    assert.equal(plan(placeholder(), { latestWins, observation: observation({ priority: { valid: false } } as Partial<GranotObservationDocument>) }).desired_values.receiver_agent, undefined);
  }
});
