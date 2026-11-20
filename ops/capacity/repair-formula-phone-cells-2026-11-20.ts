/**
 * Re-deliver Master Leads rows whose Phone Number cell Google stored as a formula.
 *
 * Before the November 20 projection fix (`textCell`), a phone written with USER_ENTERED and a
 * leading "+" became a formula: "+15628418170" showed as a number and "+44 (0)20 3314 8208"
 * showed #ERROR!. The fix writes those values as text. This tool queues the ordinary Sheet Sync
 * re-delivery for each affected Lead, so the drainer rewrites the row from current canonical
 * state. It never writes a cell itself.
 *
 *   node --env-file=.env --import tsx ops/capacity/repair-formula-phone-cells-2026-11-20.ts            # read-only scan
 *   ... --apply --tabs="Duplicate Calls,Bad Call Leads"                                                # queue those tabs
 *   ... --apply --tabs=Calls --limit=400                                                               # queue in bounded batches
 *
 * Run --apply only after production serves the textCell fix. Evidence goes to
 * docs/operations/evidence/ and records tab, row and Mongo ID only, never phone numbers.
 */
import fs from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { getSheetsClient } from "../../src/services/googleSheets/auth";
import { enqueueSheetSyncJob } from "../../src/services/sheetSync/sheetSyncOutbox.service";
import { getFormLeadModel } from "../../src/models/FormLead";
import { getCallLeadModel } from "../../src/models/CallLead";

const TABS: Record<string, "FormLead" | "CallLead"> = {
  Forms: "FormLead", "Duplicate Forms": "FormLead", "Bad Form Leads": "FormLead",
  Calls: "CallLead", "Duplicate Calls": "CallLead", "Bad Call Leads": "CallLead",
};
const arg = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const apply = process.argv.includes("--apply");
const onlyTabs = arg("tabs")?.split(",").map(t => t.trim()).filter(Boolean);
const limit = Number(arg("limit") ?? Infinity);
const column = (i: number) => { let s = ""; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

async function main() {
  const spreadsheetId = process.env.MASTER_LEADS_SHEET_ID;
  if (!spreadsheetId) throw new Error("MASTER_LEADS_SHEET_ID is not set");
  for (const tab of onlyTabs ?? []) if (!TABS[tab]) throw new Error(`unknown tab ${tab}`);
  const sheets = getSheetsClient();
  const found: Array<{ tab: string; row: number; mongoId: string; model: "FormLead" | "CallLead" }> = [];
  const summary: Record<string, { formulaPhones: number; invalidId: number }> = {};
  for (const [tab, model] of Object.entries(TABS)) {
    const header = (await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${tab}'!1:1` })).data.values?.[0] ?? [];
    const phone = header.indexOf("Phone Number");
    const id = header.indexOf("Mongo ID");
    if (phone < 0 || id < 0) throw new Error(`${tab}: Phone Number or Mongo ID header missing`);
    const { data } = await sheets.spreadsheets.get({
      spreadsheetId,
      ranges: [`'${tab}'!${column(phone)}2:${column(phone)}`, `'${tab}'!${column(id)}2:${column(id)}`],
      fields: "sheets(data(rowData(values(userEnteredValue))))",
    });
    const [phones, ids] = [data.sheets?.[0]?.data?.[0]?.rowData ?? [], data.sheets?.[0]?.data?.[1]?.rowData ?? []];
    summary[tab] = { formulaPhones: 0, invalidId: 0 };
    phones.forEach((r, i) => {
      if (!r.values?.[0]?.userEnteredValue?.formulaValue) return;
      summary[tab]!.formulaPhones++;
      const mongoId = ids[i]?.values?.[0]?.userEnteredValue?.stringValue ?? "";
      if (!mongoose.isValidObjectId(mongoId)) { summary[tab]!.invalidId++; return; }
      found.push({ tab, row: i + 2, mongoId, model });
    });
  }
  const selected = found.filter(f => !onlyTabs || onlyTabs.includes(f.tab)).slice(0, limit);
  const queued: Array<{ tab: string; row: number; mongoId: string; job_id?: string; skipped?: string }> = [];
  if (apply) {
    await connectMongo();
    for (const f of selected) {
      const Model = f.model === "FormLead" ? getFormLeadModel() : getCallLeadModel();
      const exists = await Model.exists({ _id: f.mongoId });
      if (!exists) { queued.push({ tab: f.tab, row: f.row, mongoId: f.mongoId, skipped: "lead_missing" }); continue; }
      const job = await enqueueSheetSyncJob(
        { resource: "source_lead", operation: "sheet_phone_text_repair", leadModel: f.model, leadId: f.mongoId },
        { createdBy: "script" },
      );
      queued.push({ tab: f.tab, row: f.row, mongoId: f.mongoId, job_id: String(job._id) });
    }
    await mongoose.disconnect();
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = path.join(process.cwd(), "docs", "operations", "evidence", `formula-phone-repair-${apply ? "apply" : "scan"}-${stamp}.json`);
  fs.writeFileSync(out, JSON.stringify({ at: new Date(), apply, onlyTabs: onlyTabs ?? null, limit: Number.isFinite(limit) ? limit : null, summary, selected: selected.length, queued }, null, 2));
  console.log(JSON.stringify({ apply, summary, selected: selected.length, queued: queued.filter(q => q.job_id).length, skipped: queued.filter(q => q.skipped).length, evidence: path.relative(process.cwd(), out) }, null, 2));
}

main().catch(error => { console.error("error", error instanceof Error ? error.message : error); process.exitCode = 1; });
