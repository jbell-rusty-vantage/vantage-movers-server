import assert from "node:assert/strict";
import { test } from "node:test";
import { jobNumbersEquivalent } from "../bookings/bookingIdentity";
import type { LeadIdentityStore, IdentityCallLead, IdentityFormLead, IdentityRecordLink } from "../granotLifecycle/identity";
import type { SourcePolicyStore } from "../granotLifecycle/sourcePolicy";
import type { GranotSourceCollection } from "./index";
import { assembleEstimatesPlan } from "./runWorkflow";
import type { GranotFormPlanAction } from "./formWorkflow";

const company = "64b000000000000000000001", granularity = "64b000000000000000000002", leadId = "64b000000000000000000003";
const runId = "64b000000000000000000004";
function formAction(plan: Awaited<ReturnType<typeof assembleEstimatesPlan>>, index = 0): GranotFormPlanAction {
  const action = plan.actions[index]!;
  assert.ok("classification" in action);
  return action;
}
function source(label: string, rows: Array<Record<string, string>>): GranotSourceCollection {
  return { sourceLabel: label, contentHash: "synthetic", sectionSchemas: { bookedJobs: "missing", followUpEstimates: "table" },
    sections: { bookedJobs: [], followUpEstimates: rows.map((values, i) => ({ id: `estimates:${i}`, rowIndex: i,
      collectedAt: "2026-10-14T15:00:00.000Z", values: { source: label, job_no: "123", prior: "0", from: "Miami, FL", to: "Tampa, FL", ...values } })) } };
}
function stores(model: "FormLead" | "CallLead", seed: { link?: IdentityRecordLink; forms?: IdentityFormLead[]; calls?: IdentityCallLead[] } = {}) {
  let labelReads = 0, identityReads = 0;
  const policy: SourcePolicyStore = {
    async findByNormalizedLabel(label) { labelReads++; return label === "unknown" ? [] : [{ id: "64b000000000000000000010", enabled: true, lifecycle_enabled: true,
      lifecycle_disposition: "source_scoped_lead", lead_created_policy: "link_only", lead_source_company: company,
      lifecycle_policy_version: "synthetic-v1", lifecycle_routes: [{ route_key: "any", lead_model: model, move_type: "any", source_granularity_id: granularity }] }]; },
    async findCompany(id) { return { id, active: true }; },
    async findGranularity(id) { return { id, source_company_id: company, active: true, channel: model === "FormLead" ? "form" : "call" }; },
  };
  const identity: LeadIdentityStore = {
    async findActiveRecordLink() { identityReads++; return seed.link ?? null; },
    async findFormLeadsByRefNo(ref) { return (seed.forms ?? []).filter((lead) => lead.ref_no === ref); },
    async findFormLeadById(id) { return (seed.forms ?? []).find((lead) => lead.id === id) ?? null; },
    async findFormLeadsByScopedContact({ lead_source_company_id, source_granularity_id, phones, emails }) {
      return (seed.forms ?? []).filter((lead) => lead.lead_source_company === lead_source_company_id && lead.source_granularity_id === source_granularity_id &&
        (phones.includes(lead.normalized_phone_number ?? "") || emails.includes(lead.email ?? "")));
    },
    async findCallLeadsByScopedJob({ source_granularity_id, normalized_job_no }) { return (seed.calls ?? []).filter((lead) => lead.source_granularity_id === source_granularity_id && jobNumbersEquivalent(lead.normalized_job_no, normalized_job_no)); },
    async findCallLeadsByScopedPhone({ source_granularity_id, phones }) { return (seed.calls ?? []).filter((lead) => lead.source_granularity_id === source_granularity_id && phones.includes(lead.normalized_phone_number ?? "")); },
    async findCallLeadById(id) { return (seed.calls ?? []).find((lead) => lead.id === id) ?? null; },
    async findActiveAgentsByUsername() { return []; },
    async findBookingsByNormalizedJob() { return []; },
  };
  return { canonical: { sourcePolicyStore: policy, identityStore: identity,
    loadLeadProjection: async (target: { id: string }) => ({ ...(model === "FormLead" ? seed.forms : seed.calls)?.find((lead) => lead.id === target.id), model, id: target.id, domain_revision: 1, quoted: false }) }, reads: () => ({ labelReads, identityReads }) };
}

test("assembly admits a canonical Form Record Link without ref/contact and caches Registry reads", async () => {
  const deps = stores("FormLead", { link: { id: "link", normalized_job_no: "123", disputed: false, lead_ref: { model: "FormLead", id: leadId } },
    forms: [{ id: leadId, duplicate: false, lead_source_company: company, source_granularity_id: granularity, normalized_job_no: "123" }] });
  const plan = await assembleEstimatesPlan([source("Synthetic", [{}, { job_no: "P123" }])], { runId, canonical: deps.canonical });
  assert.deepEqual(plan.actions.map((action) => "classification" in action && action.classification), ["update", "update"]);
  assert.deepEqual(plan.actions[0]!.lifecycle_apply?.expected_target, { model: "FormLead", id: leadId });
  assert.equal(plan.actions[0]!.collection_captured_at, "2026-10-14T15:00:00.000Z");
  assert.deepEqual("desired_state_summary" in plan.actions[0]! && plan.actions[0].desired_state_summary?.changed_paths, ["granot_priority"]);
  assert.equal(deps.reads().labelReads, 1);
  assert.equal(formAction(plan).report_identity?.match_method, "granot_record_link");
  assert.match(formAction(plan).report_identity?.normalized_job_sha256 ?? "", /^[a-f\d]{64}$/);
});

test("assembly admits prefix-equivalent Call Job without phone", async () => {
  const deps = stores("CallLead", { calls: [{ id: leadId, duplicate: false, source_granularity_id: granularity, normalized_job_no: "P123" }] });
  const plan = await assembleEstimatesPlan([source("Synthetic", [{}])], { runId, canonical: deps.canonical });
  assert.equal("classification" in plan.actions[0]! && plan.actions[0].classification, "update");
  assert.deepEqual(plan.actions[0]!.lifecycle_apply?.expected_target, { model: "CallLead", id: leadId });
  assert.equal(formAction(plan).report_identity?.match_method, "call_job_no_exact");
});

test("assembly attaches sparse Call phone despite duplicate sibling; genuine competing eligible matches stay held", async () => {
  const calls = [
    { id: leadId, duplicate: false, source_granularity_id: granularity, normalized_phone_number: "5550001111" },
    { id: "64b000000000000000000099", duplicate: true, source_granularity_id: granularity, normalized_phone_number: "5550001111", normalized_job_no: "OTHER JOB" },
  ];
  const sources = [source("Synthetic", [{ phone: "5550001111" }])];
  const first = await assembleEstimatesPlan(sources, { runId, canonical: stores("CallLead", { calls }).canonical });
  assert.deepEqual(first.actions[0]!.lifecycle_apply?.expected_target, { model: "CallLead", id: leadId });
  assert.deepEqual("desired_state_summary" in first.actions[0]! && first.actions[0].desired_state_summary?.changed_paths, ["granot_priority", "job_no", "normalized_job_no"]);
  calls[1]!.duplicate = false;
  delete calls[1]!.normalized_job_no;
  const conflicting = await assembleEstimatesPlan(sources, { runId, canonical: stores("CallLead", { calls }).canonical });
  assert.equal("classification" in conflicting.actions[0]! && conflicting.actions[0].classification, "conflict");
  assert.equal(formAction(conflicting).reason, "multiple_eligible_matches");
});

test("assembly preserves malformed row/source/duplicate holds and never creates an unmatched Lead", async () => {
  const deps = stores("CallLead", { calls: [{ id: leadId, duplicate: true, source_granularity_id: granularity, normalized_phone_number: "5550001111" }] });
  const plan = await assembleEstimatesPlan([
    source("Synthetic", [{ estimates_hold_reason: "missing_or_ambiguous_priority" }, { phone: "5550001111" }, { job_no: "999" }]),
    source("Unknown", [{ job_no: "888" }]),
  ], { runId, canonical: deps.canonical });
  assert.deepEqual(plan.actions.map((action) => "classification" in action && action.classification), ["invalid", "no_match", "no_match", "no_match"]);
  assert.ok(plan.actions.every((action) => !action.lifecycle_apply?.expected_target));
  assert.equal(formAction(plan).reason, "missing_or_ambiguous_priority");
  assert.equal(formAction(plan, 3).reason, "source_unclassified");
});

test("assembly holds every conflicting exact Job priority/rep/source assertion before identity reads", async () => {
  for (const variants of [
    [source("Synthetic", [{ prior: "0" }, { prior: "1" }])],
    [source("Synthetic", [{ user: "REP_A" }, { user: "REP_B" }])],
    [source("Synthetic", [{}]), source("Other Source", [{}])],
  ]) {
    const deps = stores("CallLead", { calls: [{ id: leadId, duplicate: false, source_granularity_id: granularity, normalized_job_no: "123" }] });
    const plan = await assembleEstimatesPlan(variants, { runId, canonical: deps.canonical });
    assert.equal(plan.actions.length, 2);
    assert.ok(plan.actions.every((action) => "classification" in action && action.classification === "conflict" && action.reason === "conflicting_report_job_assertions"));
    assert.ok(plan.actions.every((action) => !action.lifecycle_apply?.expected_target));
    assert.deepEqual(deps.reads(), { labelReads: 0, identityReads: 0 });
  }
});

test("identical repeated Job assertions and a single Job remain eligible snapshots", async () => {
  const deps = stores("CallLead", { calls: [{ id: leadId, duplicate: false, source_granularity_id: granularity, normalized_job_no: "123" }] });
  const plan = await assembleEstimatesPlan([source("Synthetic", [{ user: " REP_A " }, { user: "rep_a" }, { job_no: "124" }])], { runId, canonical: deps.canonical });
  assert.deepEqual(plan.actions.map((action) => "classification" in action && action.classification), ["update", "update", "no_match"]);
});

test("assembly keeps Bad exact Form authority priority-only and holds conflicting exact source scope", async () => {
  const forms = [{ id: leadId, duplicate: false, bad_lead: "spam", ref_no: "exact", lead_source_company: company, source_granularity_id: granularity }];
  const deps = stores("FormLead", { forms });
  const plan = await assembleEstimatesPlan([source("Synthetic", [{ ref_no: "exact", prior: "1" }])], { runId, canonical: deps.canonical });
  assert.equal("classification" in plan.actions[0]! && plan.actions[0].classification, "update");
  assert.deepEqual("desired_state_summary" in plan.actions[0]! && plan.actions[0].desired_state_summary?.changed_paths, ["granot_priority"]);
  assert.ok(formAction(plan).warnings?.includes("priority_only_target"));
  forms[0]!.source_granularity_id = "64b000000000000000000099";
  const held = await assembleEstimatesPlan([source("Synthetic", [{ ref_no: "exact", prior: "1" }])], { runId, canonical: deps.canonical });
  assert.equal("classification" in held.actions[0]! && held.actions[0].classification, "conflict");
  assert.equal(formAction(held).reason, "source_scope_conflict");
});
