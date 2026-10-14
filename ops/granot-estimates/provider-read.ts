/** Explicit read-only Granot rehearsal. Only database access is the shared account lease. */
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import mongoose from "mongoose";
import * as cheerio from "cheerio";
import { MongoLeaseStore } from "../../src/services/durableWork/leases";
import { SheetSyncLease } from "../../src/models/SheetSyncLease";
import { openGranotAuthenticatedSession } from "../../src/services/granotHttpCollector";
import { collectEstimatesInProcess } from "../../src/services/granotHttpCollector/estimatesInProcess";

async function main() {
  if (!process.argv.includes("--run")) throw new Error("Explicit --run is required.");
  const from = process.argv.find((v) => v.startsWith("--from="))?.slice(7);
  const to = process.argv.find((v) => v.startsWith("--to="))?.slice(5);
  if (!from || !to || !/^\d{2}\/\d{2}\/\d{4}$/.test(from) || !/^\d{2}\/\d{2}\/\d{4}$/.test(to)) throw new Error("Use --from=MM/DD/YYYY --to=MM/DD/YYYY.");
  const value = (preferred: string, legacy: string) => process.env[preferred]?.trim() || process.env[legacy]?.trim() || "";
  const credentials = {
    networkUsername: value("GRANOT_NETWORK_USERNAME", "MAIN_LOGIN_USERNAME"),
    networkPassword: value("GRANOT_NETWORK_PASSWORD", "MAIN_LOGIN_PASSWORD"),
    username: value("GRANOT_USERNAME", "SPECIFIC_USERNAME"),
    password: value("GRANOT_PASSWORD", "SPECIFIC_PASSWORD"),
  };
  if (Object.values(credentials).some((v) => !v)) throw new Error("Granot runtime bindings missing.");
  if (!process.env.MONGO_URI) throw new Error("Shared account lease binding missing.");
  mongoose.set("autoIndex", false);
  mongoose.set("autoCreate", false);
  await mongoose.connect(process.env.MONGO_URI, { dbName: "vantagemovers", autoIndex: false, autoCreate: false, maxPoolSize: 1, serverSelectionTimeoutMS: 5000 });
  const store = new MongoLeaseStore(SheetSyncLease);
  const ttl = 10 * 60_000;
  let lease = await store.acquire({ scope: "granot:automation:account", owner: `estimates-read:${randomUUID()}`, now: new Date(), ttl_ms: ttl });
  if (!lease) throw new Error("Shared Granot account lease busy; no login attempted.");
  let requests = 0;
  const started = Date.now();
  try {
    const fencedFetch: typeof fetch = async (input, init) => {
      if (++requests > (process.argv.includes("--verified") ? 128 : 16)) throw new Error("Read-only request budget exhausted.");
      const renewed = await store.renew({ token: lease!, now: new Date(), ttl_ms: ttl });
      if (!renewed) throw new Error("Shared account lease lost.");
      lease = renewed;
      const url = new URL(String(input));
      if (url.origin !== "https://eagle.hellomoving.com") throw new Error("Unexpected Granot host.");
      return fetch(input, init);
    };
    if (process.argv.includes("--verified")) {
      let coverage: unknown;
      const sources = await collectEstimatesInProcess({ dateWindow: { from, to }, credentials, onCoverage: (value) => { coverage = value; } }, { fetch: fencedFetch });
      const rows = sources.flatMap((source) => source.sections.followUpEstimates);
      const holds = rows.reduce<Record<string, number>>((out, row) => { const reason = row.values.estimates_hold_reason; if (reason) out[reason] = (out[reason] ?? 0) + 1; return out; }, {});
      const priorities = rows.reduce<Record<string, number>>((out, row) => { const p = row.values.priority ?? "missing"; out[p] = (out[p] ?? 0) + 1; return out; }, {});
      console.log(JSON.stringify({ at: new Date().toISOString(), from, to, requests, elapsed_ms: Date.now() - started, coverage, sources: sources.map((s) => ({ label: s.sourceLabel, rows: s.sections.followUpEstimates.length })), rows: rows.length, held: holds, priorities, field_presence: Object.fromEntries(["ref_no", "job_no", "phone", "email", "customer", "source", "priority", "user", "from", "from_zip", "to", "to_zip", "move_date", "est_cf", "open_date"].map((key) => [key, rows.filter((r) => !!r.values[key]).length])), database_scope: "shared_account_lease_only", domain_mutations: 0 }));
      return;
    }
    const session = await openGranotAuthenticatedSession(credentials, { fetch: fencedFetch });
    const form = await session.request(`/wc.dll?mv~estprocesswc~${session.sessionToken}`);
    const $ = cheerio.load(form);
    const controls = $("select,input").toArray().map((e) => ({ name: $(e).attr("name"), type: $(e).attr("type"), value: $(e).attr("value"), options: $(e).is("select") ? $(e).find("option").toArray().map((o) => ({ value: $(o).attr("value"), text: $(o).text().trim() })) : undefined })).filter((c) => c.name && !/password|user|session|token/i.test(c.name));
    const body = new URLSearchParams({ STATUS: "V9", TYPEDTE: "OPEN", DATE1: from, DATE2: to, FUSTATUS: "10", USER: "", DEPT: "ALL", TYPE: "V1", SORT: "V6" });
    const report = await session.request(`/wc.dll?mv~estprocessret~${session.sessionToken}`, { method: "POST", body });
    const r = cheerio.load(report);
    const tables = r("table").toArray().map((table) => {
      const rows = r(table).find("tr").toArray().filter((row) => r(row).closest("table")[0] === table);
      const header = rows.find((row) => r(row).children("th,td").toArray().some((cell) => r(cell).text().trim().toLowerCase() === "job_no"));
      if (!header) return null;
      const headers = r(header).children("th,td").toArray().map((cell) => r(cell).text().trim());
      return { headers, direct_rows_after_header: rows.length - rows.indexOf(header) - 1 };
    }).filter(Boolean);
    const text = r("body").text().replace(/\s+/g, " ");
    const summary = { at: new Date().toISOString(), from, to, requests, elapsed_ms: Date.now() - started, controls, tables, totals: [...text.matchAll(/Total\s+of:\s*(\d+)\s+Transactions/gi)].map((m) => Number(m[1])), pages: [...text.matchAll(/Page\s+(\d+)\s+(?:of|\/)\s*(\d+)/gi)].map((m) => [Number(m[1]), Number(m[2])]), database_scope: "shared_account_lease_only", domain_mutations: 0 };
    // Raw provider HTML remains outside the checkout; never print rows, cookies or session URLs.
    const dir = join(tmpdir(), `vantage-estimates-${randomUUID()}`);
    await mkdir(dir, { mode: 0o700 });
    await writeFile(join(dir, "form.html"), form, { mode: 0o600 });
    await writeFile(join(dir, "report.html"), report, { mode: 0o600 });
    await writeFile(join(dir, "summary.json"), JSON.stringify(summary, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ ...summary, private_capture_directory: dir }));
  } finally {
    await store.release({ token: lease, now: new Date() });
  }
}

main().catch((error: unknown) => {
  // Connection/provider errors can contain credential-bearing URLs. Emit only bounded known messages.
  const message = error instanceof Error ? error.message : "";
  console.error(JSON.stringify({ ok: false, reason: /^(Explicit|Use --|Granot runtime|Shared|Unexpected|Read-only)/.test(message) ? message : "Provider read failed; no domain mutation performed." }));
  process.exitCode = 1;
}).finally(() => mongoose.disconnect());
