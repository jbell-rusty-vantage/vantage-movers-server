import assert from "node:assert/strict";
import { ObjectId, type Db } from "mongodb";

export const dateWindow = { from: "10/12/2026", to: "10/12/2026" };
export const owner = { actor_type: "owner", actor_id: "measurement-owner", actor_role: "owner", actor_label: "Synthetic Owner",
  request_id: "synthetic-measurement", origin: "vantage_admin" } as const;
const job = "P900001";
const lead = new ObjectId("000000000000000000000101");
const label = "Synthetic Forms";

/** No socket is opened. Every collection must consume exactly the two logins, menu, form and one report. */
export function fakeReport(priority: string) {
  const form = '<form action="/wc.dll?mv~estprocessret~SYNTHETIC" method="post"><input name="STATUS" value="V9"><select name="TYPEDTE"><option value="OPEN">Open Date</option></select><input name="DATE1"><input name="DATE2"><select name="FUSTATUS"><option value="10">ALL</option><option value="9">Pool</option></select><select name="USER"><option value="">All users</option></select><select name="DEPT"><option value="ALL">ALL</option></select><select name="TYPE"><option value="V1">All types</option></select><select name="SORT"><option value="V6">Priority</option></select></form>';
  const cells = { job_no: job, open_date: dateWindow.from, follow_up: "prior: " + priority, user: "", customer: "Synthetic Form", source: label,
    ref_no: String(lead), email: "", phone1: "", phone2: "", from_city: "", from_state: "NY", from_zip: "10001",
    to_city: "", to_state: "NY", to_zip: "10002", move_date: "", cf: "" };
  const report = '<h1>Follow-Up Estimates, Total of: 1 Transactions</h1><table><tr>' +
    Object.keys(cells).map(value => '<th>' + value + '</th>').join("") + '</tr><tr>' +
    Object.values(cells).map(value => '<td>' + value + '</td>').join("") + '</tr></table>';
  const responses = ['<form action="/network-login"></form>', '<form action="/user-login"></form>',
    '<a href="/wc.dll?mv~mainmenuwc~A04F50BA-B981-44A9-9930-9E7FEC2B8201~LOGIN">Menu</a>', form, report];
  globalThis.fetch = async () => {
    const next = responses.shift();
    assert.ok(next, "Unexpected external fetch");
    return new Response(next, { status: 200 });
  };
  return () => assert.equal(responses.length, 0, "Incomplete collection");
}

export async function seedGranotMeasurement(db: Db) {
  const company = new ObjectId(), feed = new ObjectId(), previous = new ObjectId();
  const before = new Date("2026-01-01T00:00:00Z");
  await db.collection("lead_source_companies").insertOne({ _id: company, active: true, company_slug: "main_site" });
  await db.collection("lead_source_granularities").insertOne({ _id: feed, active: true, channel: "form", source_company: company });
  await db.collection("granot_crm_sources").insertOne({ enabled: true, lifecycle_enabled: true, granot_label: label,
    normalized_granot_label: label.toLowerCase(), lifecycle_disposition: "source_scoped_lead", lead_created_policy: "link_only",
    lead_source_company: company, lifecycle_routes: [{ route_key: "form_any", lead_model: "FormLead", move_type: "any", source_granularity_id: feed }],
    lifecycle_policy_version: "granot-lifecycle-source-policy-v1" });
  await db.collection("form_leads").insertOne({ _id: lead, source_company: "main_site", ingestion_origin: "wordpress_form",
    name: "Synthetic Form", phone_number: "2125550100", normalized_phone_number: "2125550100", pickup_zip: "10001",
    destination_zip: "10002", pickup_state: "NY", delivery_state: "NY", local: "local", domain_revision: 4,
    quoted: false, granot_priority: "0", job_no: job, normalized_job_no: job, lead_source_company: company, source_granularity_id: feed,
    last_accepted_granot_observation: { observation_id: previous, captured_at: before } });
  await db.collection("granot_record_links").insertOne({ provider: "granot", state: "active", normalized_job_no: job,
    job_no_snapshot: job, lead_ref: { model: "FormLead", id: lead }, source_scope: { lead_source_company: company, source_granularity_id: feed },
    disputed: false, established_by_decision_id: new ObjectId(), established_at: before, last_observation_id: previous, last_observed_at: before, domain_revision: 1 });
  await db.collection("granot_lifecycle_activations").insertOne({ key: "granot_lifecycle", activated_at: before });
  await db.collection("sales_outreach_subjects").insertOne({ lead_model: "FormLead", lead_id: lead, status: "active" });
  return lead;
}
