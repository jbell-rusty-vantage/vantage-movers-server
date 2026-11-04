import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import mongoose from "mongoose";

/** Read-only inventory. No Lead, command, work, receipt or Sheet writes. */
async function main() {
  if (!process.argv.includes("--production-read-only")) throw new Error("Explicit --production-read-only required");
  const output = process.argv[process.argv.indexOf("--output") + 1];
  if (!process.argv.includes("--output") || !output) throw new Error("--output path required");
  process.env.TEST_MODE = "false";
  // Set before importing application models, including their initialization promises.
  mongoose.set("autoCreate", false); mongoose.set("autoIndex", false);
  const { connectMongo } = await import("../../src/db.js");
  const { getCallLeadModel } = await import("../../src/models/CallLead.js");
  const { hasFormFillForCallLead } = await import("../../src/services/leads/duplicateLead.service.js");
  const { reportingEligibleCallLeadFilter } = await import("../../src/services/leads/callLeadAdmission.js");
  const { getCallLeadReportingDecision } = await import("../../src/services/leads/callLeadReportingDisposition.js");
  // Disable automatic collection/index initialization: this process is strictly read-only.
  await connectMongo();
  if (mongoose.connection.name !== "vantagemovers") throw new Error("Expected production database name");
  const started_at = new Date().toISOString();
  let eligible = 0, already_marked = 0, unsupported_marked = 0;
  const repairs: Record<string, unknown>[] = [];
  const marked_without_current_form: string[] = [];
  try {
    for await (const call of getCallLeadModel().collection.find(reportingEligibleCallLeadFilter(), {
      projection: { phone_number: 1, source_company: 1, lead_source_company: 1, source_granularity_id: 1,
        ringcentral: 1, external_call_admission: 1, external_sheet_review: 1, domain_revision: 1,
        duplicate: 1, form_fill: 1, created_on_unmatched: 1, no_sync: 1 }, batchSize: 100,
    })) {
      eligible++;
      const matched = await hasFormFillForCallLead({ sourceCompany: call.source_company, leadSourceCompany: call.lead_source_company }, call.phone_number);
      if (call.form_fill === true) {
        already_marked++;
        if (!matched) { unsupported_marked++; marked_without_current_form.push(String(call._id)); }
      } else if (matched) {
        repairs.push({ lead_id: String(call._id), expected_revision: Number(call.domain_revision ?? 0),
          old: getCallLeadReportingDecision(call), new: getCallLeadReportingDecision({ ...call, form_fill: true }),
          expected_writes: { form_fill: true, domain_revision_delta: 1, entity_changes: 1, sheet_sync_intents: 1 },
          replay_guard: "repairCallFormFillForReporting: expected revision + current eligible Form proof; same owner command idempotency key",
        });
      }
    }
    const plan = { version: "call-form-fill-review-v1", started_at, completed_at: new Date().toISOString(),
      database: "vantagemovers", mode: "read-only-preview", eligible, already_marked,
      newly_nonbillable: repairs.filter(row => (row.old as { billable: boolean }).billable).length,
      repair_count: repairs.length, repairs,
      marked_without_current_form: { count: unsupported_marked, ids: marked_without_current_form,
        action: "no automatic clearing: historic evidence/removal policy needs separate review" },
      limitations: ["Non-snapshot read; current production may change during scan", "No final-result history can reconstruct previously overwritten observations", "No writes or physical Sheet inspection"] };
    const checksum = createHash("sha256").update(JSON.stringify(plan)).digest("hex");
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify({ checksum, plan }, null, 2) + "\n");
    console.log(JSON.stringify({ checksum, eligible, already_marked, repair_count: plan.repair_count, newly_nonbillable: plan.newly_nonbillable, marked_without_current_form: unsupported_marked }));
  } finally { await mongoose.disconnect(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Audit failed"); process.exitCode = 1; });
