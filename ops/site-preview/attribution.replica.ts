/** Local-only Mongo proof. No .env, external services or live database access. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { MongoClient } from "mongodb";

async function main() {
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.startsWith("https://api.zippopotam.us/us/")) {
      return new Response(JSON.stringify({ places: [{ "state abbreviation": url.endsWith("53703") ? "WI" : "FL" }] }), { status: 200 });
    }
    throw new Error("External fetch disabled in local attribution proof");
  };
  for (const key of Object.keys(process.env)) if (/MONGO|DOTENV|RINGCENTRAL|^RC_|GOOGLE|SHEET|GRANOT|TWILIO|SENDGRID|BLOB|VERCEL|REDIS|UPSTASH/.test(key)) delete process.env[key];
  const dbName = `testvantagemovers_website${Date.now()}`;
  const uri = "mongodb://127.0.0.1:27219/?replicaSet=websiteProof";
  Object.assign(process.env, { DOTENV_CONFIG_PATH: ".website-proof-no-env", MONGO_URI: uri, TEST_MODE: "true", TEST_MONGO_DATABASE_NAME: dbName,
    CRM_FORM_LEAD_POSTING_ENABLED: "false", SHEET_SYNC_MODE: "disabled", WRITE_SOURCE_LEAD_SHEETS: "false", LEAD_MESSAGING_MODE: "disabled", LEAD_MESSAGING_ALLOW_TEST_MODE: "false", SALES_INTELLIGENCE_ENABLED: "false" });
  const direct = new MongoClient("mongodb://127.0.0.1:27219/?directConnection=true", { serverSelectionTimeoutMS: 5000 });
  await direct.connect();
  try {
    try { await direct.db("admin").command({ replSetInitiate: { _id: "websiteProof", members: [{ _id: 0, host: "127.0.0.1:27219" }] } }); }
    catch (error) { if ((error as { code?: number }).code !== 23) throw error; }
  } finally { await direct.close(); }
  const { default: mongoose } = await import("mongoose");
  await import("../test-setup.js");
  const { connectMongo } = await import("../../src/db.js");
  const { getLeadSourceCompanyModel } = await import("../../src/models/LeadSourceCompany.js");
  const { getLeadSourceGranularityModel } = await import("../../src/models/LeadSourceGranularity.js");
  const { FormLead } = await import("../../src/models/FormLead.js");
  const { Agent } = await import("../../src/models/Agent.js");
  const { Merchant } = await import("../../src/models/Merchant.js");
  const { BookedLead } = await import("../../src/models/BookedLead.js");
  const { CancelledLead } = await import("../../src/models/CancelledLead.js");
  const { runExistingCreateFormLead, runExistingCreateBookingFromLead, runExistingCreateCancellation } = await import("../../src/services/domainCommands/existingWrites.js");
  const { createVantageApiSecretActor } = await import("../../src/services/domainCommands/existingWriteContext.js");
  const { getWebsiteOutcomes } = await import("../../src/services/analytics/websiteOutcomes.service.js");
  const { getAdminModels } = await import("../../src/services/admin/adminScope.service.js");
  type Context = import("../../src/services/domainCommands/types.js").CanonicalCommandContext;
  await connectMongo();
  assert.equal(mongoose.connection.name, dbName);
  assert.equal(mongoose.connection.host, "127.0.0.1");
  const checks: string[] = [];
  try {
    for (const model of Object.values(mongoose.models)) await model.createCollection();
    const companyId = new mongoose.Types.ObjectId();
    const feed = await getLeadSourceGranularityModel().create({ source_company: companyId, granularity_key: "main_site_form", channel: "form", owner_label: "Synthetic Main Site", crm_label: "Synthetic Main Site", active: true });
    await getLeadSourceCompanyModel().create({ _id: companyId, company_slug: "main_site", name: "Synthetic Main Site", owner_label: "Synthetic Main Site", active: true, default_form_granularity: feed._id, default_form_granularity_key: "main_site_form" });
    await Agent.create({ name: "Synthetic Agent", normalized_name: "synthetic agent", active: true });
    await Merchant.create({ name: "Synthetic Merchant", normalized_name: "synthetic merchant", active: true });
    function context(label: string, data: unknown): Context {
      const actor = createVantageApiSecretActor(label);
      return { command_id: String(new mongoose.Types.ObjectId()), idempotency_key: `website-proof:${label}`, payload_checksum: createHash("sha256").update(JSON.stringify(data)).digest("hex"), actor, initiator: actor, provenance: { origin: "vantage_admin", run_id: null, source_receipt_id: null, source_connection_key: null } };
    }
    const touch = { path: "/resources/moving-cost-guide", occurred_at: new Date().toISOString(), channel: "campaign", referring_host: "none", campaign: { source: "review", medium: "review", name: "preview-qualification" } };
    const data = { source_company: "main_site", source_company_site: "vantagehomemovers.com", name: "Synthetic Website Proof", phone_number: "2025550188", email: "website-proof@example.com", pickup_zip: "33426", destination_zip: "53703", pickup_state: "FL", delivery_state: "WI", move_size: "Studio", lid: "LID6a6255e58ad8d", ref_no: "MS-LOCAL-ATTRIBUTION", post_to_granot: true, sms_consent: false,
      website_attribution: { version: 1, first_touch: touch, latest_non_direct_touch: touch, capture_page: { path: "/es/servicios/mudanzas-larga-distancia" }, design: { id: "main-site-optimization", version: "2026-11-12" }, email: "must-not-persist@example.com" } };
    const input = { data, context: context("lead", data) };
    const created = await runExistingCreateFormLead(input);
    const leadId = created.data.lead._id;
    const lead = await FormLead.findById(leadId).lean();
    assert.ok(lead?.website_attribution);
    assert.equal(lead.website_attribution.capture_page?.locale, "es");
    assert.equal(lead.website_attribution.first_touch?.content_id, "moving-cost-guide");
    assert.equal(lead.source_company, "main_site");
    assert.equal(lead.lid, data.lid);
    assert.equal(lead.post_to_granot, false);
    assert.doesNotMatch(JSON.stringify(lead.website_attribution), /must-not-persist/);
    checks.push("Canonical Form Lead ingestion persisted sanitized source/page/campaign/locale and identities; CRM disabled");
    await runExistingCreateFormLead(input);
    assert.equal(await FormLead.countDocuments({ ref_no: data.ref_no }), 1);
    checks.push("Same canonical command replay created no second Lead");
    await assert.rejects(FormLead.updateOne({ _id: leadId }, { $set: { "website_attribution.first_touch.path": "/" } }).exec(), /immutable/);
    await assert.rejects(FormLead.updateOne({ _id: leadId }, { $unset: { website_attribution: 1 } }).exec(), /immutable/);
    await FormLead.updateOne({ _id: leadId }, { $set: { name: "Synthetic Edited Name" } });
    assert.equal((await FormLead.findById(leadId).lean())?.website_attribution?.first_touch?.path, touch.path);
    checks.push("Attribution remained immutable during later Lead correction");
    const date = new Date().toISOString().slice(0, 10);
    const bookingData = { lead_ref: String(leadId), lead_model: "FormLead", book_date: date, job_no: "WEBSITE-PROOF", deposit_amount: 500, total_binder_amount: 300, merchant: "Synthetic Merchant", source: "main_site", agent_allocations: [{ agent_name: "Synthetic Agent", binder_amount: 300 }] };
    await runExistingCreateBookingFromLead({ data: bookingData, context: context("booking", bookingData) });
    const booking = await BookedLead.findOne({ lead_ref: leadId }).lean();
    assert.ok(booking);
    const cancellationData = { booked_lead: String(booking._id), cancel_date: date, refund_amount: 125, reason: "Synthetic qualification" };
    await runExistingCreateCancellation({ data: cancellationData, context: context("cancellation", cancellationData) });
    const cancellation = await CancelledLead.findOne({ booked_lead: booking._id }).lean();
    assert.ok(cancellation);
    checks.push("Official Booking and Cancellation created through canonical commands in loopback disposable database");
    // Fixture for a historical unknown. Raw insert is intentionally fixture construction, not an ingestion claim.
    await FormLead.collection.insertOne({ ...lead, _id: new mongoose.Types.ObjectId(), ref_no: "MS-LOCAL-LEGACY", website_attribution: undefined, booked: undefined, cancelled: undefined } as never);
    const now = new Date();
    const report = await getWebsiteOutcomes(getAdminModels(), { lead_type: "FormLead", granularity: "month", from: new Date(now.getTime() - 2 * 86_400_000), to: now }, now);
    assert.equal(report.totals.form_leads, 2);
    assert.equal(report.totals.attributed_leads, 1);
    assert.equal(report.totals.unknown_attribution_leads, 1);
    assert.equal(report.totals.bookings, 1);
    assert.equal(report.totals.cancelled_bookings, 1);
    assert.equal(report.totals.total_refund_amount, 125);
    assert.equal(report.totals.deposit_less_recorded_refunds, 375);
    assert.equal(await mongoose.connection.db!.collection("lead_messages").countDocuments({}), 0);
    checks.push("Real Mongo report joins and legacy unknowns matched exact fixture totals; no Lead Messages");
    await mkdir("docs/website-attribution/evidence", { recursive: true });
    await writeFile("docs/website-attribution/evidence/local-replica.json", JSON.stringify({ captured_at: now.toISOString(), database: dbName, host: "127.0.0.1:27219", checks, report, production_access: false }, null, 2));
    console.log(JSON.stringify({ passed: true, database: dbName, checks }));
  } finally { await mongoose.disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
