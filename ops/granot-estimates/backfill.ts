/** Resumable report-first Estimates backfill. No contacts or monetary values are written to its manifest. */
import { createHash } from "node:crypto";
import { readFile, writeFile, lstat, mkdir } from "node:fs/promises";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { ownerApi, RUNS_PATH } from "./api-client";

type Window = { from: string; to: string };
type Action = { action_id: string; classification?: string; syncable?: boolean; reason?: string; warnings?: string[]; patch?: Record<string, unknown>; desired_state_summary?: { changed_paths: string[]; outcome: string; target_revision?: number }; lifecycle_apply?: { expected_target?: { model: string; id: string } } };
type Run = { id: string; status: string; workflow?: "preview" | "apply"; plan_checksum?: string; expires_at?: string; counters?: Record<string, number>; collection?: { coverage?: { complete?: boolean; rows?: number; captured_at?: string }; held_rows?: number }; plan?: { actions: Action[] }; receipts?: Array<{ outcome: string }> };
type Entry = { window: Window; run_id?: string; status?: string; checksum?: string; selected_action_ids?: string[]; counters?: Record<string, number>; target_models?: Record<string, number>; field_groups?: string[]; warning_counts?: Record<string, number>; outcomes?: Record<string, number>; approved?: boolean };
type Manifest = { version: 1; from: string; to: string; created_at: string; entries: Entry[]; review_checksum?: string };
const argument = (name: string) => process.argv.find((v) => v.startsWith(`--${name}=`))?.slice(name.length + 3);

export function windows(from: string, to: string, days = 7): Window[] {
  if (!Number.isInteger(days) || days < 1 || days > 7) throw new Error("Invalid backfill chunk size.");
  const parse = (value: string) => {
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(value)) throw new Error("Dates must use MM/DD/YYYY.");
    const [m, d, y] = value.split("/").map(Number);
    const date = new Date(Date.UTC(y!, m! - 1, d!));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m! - 1 || date.getUTCDate() !== d) throw new Error("Invalid calendar date.");
    return +date;
  };
  const start = parse(from), end = parse(to), day = 86_400_000;
  if (start > end || end - start > 5 * 366 * day) throw new Error("Invalid backfill horizon.");
  const format = (n: number) => { const d = new Date(n); return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`; };
  const result: Window[] = [];
  for (let n = start; n <= end; n += days * day) result.push({ from: format(n), to: format(Math.min(end, n + (days - 1) * day)) });
  return result;
}

export function reviewChecksum(manifest: Manifest): string {
  return createHash("sha256").update(JSON.stringify(manifest.entries.map((e) => ({ window: e.window, run_id: e.run_id, checksum: e.checksum, selected_action_ids: e.selected_action_ids })))).digest("hex");
}

async function privatePath(value: string): Promise<string> {
  const path = resolve(value), repo = resolve(__dirname, "../..");
  const rel = relative(repo, path);
  if (!rel || (!rel.startsWith("..") && !isAbsolute(rel))) throw new Error("Manifest must be outside the repository.");
  try { if ((await lstat(path)).isSymbolicLink()) throw new Error("Manifest symlinks are refused."); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  return path;
}

async function main() {
  const mode = argument("mode");
  if (!process.argv.includes("--run") || !["inventory", "preview", "apply", "verify"].includes(mode ?? "")) throw new Error("Use --run --mode=inventory|preview|apply|verify.");
  if (mode === "inventory") {
    const summary: Record<string, unknown> = {};
    for (const resource of ["form-leads", "call-leads"]) {
      let count = 0, olderActive = 0, oldest: string | null = null;
      const seen = new Set<string>(), totals = new Set<number>();
      for (let page = 1; page <= 100; page++) {
        const data = await ownerApi<{ items: Array<Record<string, unknown>>; total: number; has_next_page: boolean }>("GET", `/api/v1/admin/${resource}`, undefined, { database_scope: "production", limit: "250", page: String(page), sort: "createdAt", direction: "asc" });
        totals.add(data.total);
        for (const row of data.items) {
          const id = String(row._id ?? row.id); if (seen.has(id)) throw new Error("Inventory repeated an identity; rerun against a stable traversal."); seen.add(id); count++;
          const stamp = row.timestamp ?? row.createdAt;
          const instant = typeof stamp === "string" ? Date.parse(stamp) : NaN;
          if (Number.isFinite(instant) && (!oldest || instant < Date.parse(oldest))) oldest = new Date(instant).toISOString();
          if (!row.booked && !row.cancelled && !row.bad_lead && !row.created_on_unmatched && Number.isFinite(instant) && instant < Date.now() - 90 * 86_400_000) olderActive++;
        }
        if (!data.has_next_page) break;
        if (page === 100) throw new Error("Inventory page budget exhausted.");
      }
      summary[resource] = { observed_count: count, total: [...totals], traversal_counts_match: totals.size === 1 && totals.has(count), oldest_ingested_at: oldest, older_than_90_days_without_closure_flags: olderActive, provider_open_date_is_not_ingestion_time: true };
    }
    console.log(JSON.stringify({ kind: "canonical_inventory", at: new Date().toISOString(), summary, domain_mutations: 0 })); return;
  }
  const filename = argument("manifest"); if (!filename) throw new Error("--manifest=<outside-repo path> is required.");
  const path = await privatePath(filename);
  let manifest: Manifest;
  try { manifest = JSON.parse(await readFile(path, "utf8")) as Manifest; } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const from = argument("from"), to = argument("to");
    if (mode !== "preview" || !from || !to) throw new Error("Create a preview with --from and --to first.");
    manifest = { version: 1, from, to, created_at: new Date().toISOString(), entries: windows(from, to).map((window) => ({ window })) };
  }
  if (manifest.version !== 1 || !Array.isArray(manifest.entries)) throw new Error("Invalid manifest format.");
  const save = () => writeFile(path, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  if (mode === "preview") {
    for (const entry of manifest.entries) {
      if (!entry.run_id) {
        const created = await ownerApi<{ run_id: string }>("POST", RUNS_PATH, { operation: "estimates_in_process", workflow: "preview", ...entry.window });
        entry.run_id = created.run_id; await save();
      }
      let run: Run | undefined;
      for (let attempt = 0; attempt < 250; attempt++) {
        run = await ownerApi<Run>("GET", `${RUNS_PATH}/${entry.run_id}`, undefined, { details: "owner" });
        if (["completed", "failed", "expired"].includes(run.status)) break;
        const worker = await ownerApi<{ claimed?: boolean }>("POST", `${RUNS_PATH}/worker`, { action: "execute" });
        if (!worker.claimed) await new Promise((done) => setTimeout(done, 2000));
      }
      if (!run || run.status !== "completed" || !run.plan || !run.plan_checksum) throw new Error(`Preview incomplete for ${entry.window.from}; inspect run ${entry.run_id}.`);
      if (run.collection?.coverage?.complete !== true) throw new Error("Preview incomplete: deployed collector did not attest complete coverage.");
      entry.status = run.status; entry.checksum = run.plan_checksum; entry.counters = run.counters;
      const selected = run.plan.actions.filter((a) => a.classification === "update" || a.syncable === true);
      entry.selected_action_ids = selected.map((a) => a.action_id);
      entry.target_models = selected.reduce<Record<string, number>>((out, a) => { const m = a.lifecycle_apply?.expected_target?.model ?? "unknown"; out[m] = (out[m] ?? 0) + 1; return out; }, {});
      entry.field_groups = [...new Set(selected.flatMap((a) => a.desired_state_summary?.changed_paths ?? Object.keys(a.patch ?? {})))].sort();
      entry.warning_counts = run.plan.actions.reduce<Record<string, number>>((out, a) => { for (const code of a.warnings ?? []) out[code] = (out[code] ?? 0) + 1; return out; }, {});
      await save(); console.log(JSON.stringify({ kind: "preview", window: entry.window, run_id: entry.run_id, selected: selected.length, counters: entry.counters, target_models: entry.target_models, field_groups: entry.field_groups, warnings: entry.warning_counts }));
    }
    manifest.review_checksum = reviewChecksum(manifest); await save();
    console.log(JSON.stringify({ kind: "review_manifest", checksum: manifest.review_checksum, windows: manifest.entries.length, selected: manifest.entries.reduce((n, e) => n + (e.selected_action_ids?.length ?? 0), 0) }));
    return;
  }
  if (mode === "apply") {
    if (!manifest.review_checksum || argument("review-checksum") !== manifest.review_checksum || reviewChecksum(manifest) !== manifest.review_checksum) throw new Error("Exact reviewed manifest checksum is required.");
    for (const entry of manifest.entries) {
      if (!entry.run_id || !entry.checksum || !entry.selected_action_ids) throw new Error("Manifest lacks a completed preview.");
      if (!entry.approved && entry.selected_action_ids.length > 0) {
        const run = await ownerApi<Run>("GET", `${RUNS_PATH}/${entry.run_id}`, undefined, { details: "owner" });
        if (run.plan_checksum !== entry.checksum) throw new Error("Run checksum changed; recollect and review.");
        if (run.status === "completed" && run.workflow === "preview") await ownerApi("POST", `${RUNS_PATH}/${entry.run_id}/apply-reviewed-estimates`, { plan_checksum: entry.checksum, selected_action_ids: entry.selected_action_ids });
        else if (!(run.workflow === "apply" && ["applying", "completed"].includes(run.status))) throw new Error("Run cannot safely resume its reviewed promotion.");
        entry.approved = true; await save();
      }
    }
  }
  for (let pass = 0; pass < (mode === "apply" ? 800 : 1); pass++) {
    let pending = 0;
    for (const entry of manifest.entries) {
      if (!entry.run_id) continue;
      const run = await ownerApi<Run>("GET", `${RUNS_PATH}/${entry.run_id}`, undefined, { details: "owner" });
      entry.status = run.status;
      entry.outcomes = (run.receipts ?? []).reduce<Record<string, number>>((out, r) => { out[r.outcome] = (out[r.outcome] ?? 0) + 1; return out; }, {});
      if (run.status === "applying") pending++;
      if (["failed", "expired"].includes(run.status)) throw new Error(`Backfill run requires review: ${entry.run_id} ${run.status}`);
    }
    await save();
    console.log(JSON.stringify({ kind: "backfill_status", at: new Date().toISOString(), pending_runs: pending, outcomes: manifest.entries.reduce<Record<string, number>>((out, e) => { for (const [key, count] of Object.entries(e.outcomes ?? {})) out[key] = (out[key] ?? 0) + count; return out; }, {}), ...(!pending || mode === "verify" ? { statuses: manifest.entries.map((e) => ({ window: e.window, run_id: e.run_id, status: e.status, outcomes: e.outcomes })) } : {}) }));
    if (!pending || mode === "verify") return;
    const worker = await ownerApi<{ claimed?: boolean }>("POST", `${RUNS_PATH}/worker`, { action: "execute" });
    if (!worker.claimed) await new Promise((done) => setTimeout(done, 2000));
  }
  throw new Error("Backfill execution budget reached; manifest is resumable.");
}

if (require.main === module) main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  console.error(JSON.stringify({ ok: false, reason: /^(API HTTP|Use --|Missing runtime|Manifest|Exact reviewed|Invalid|Dates|Create a|Preview incomplete|Run |Backfill|Inventory|--manifest|Path is)/.test(message) ? message : "Backfill stopped; use the retained manifest to inspect and resume." }));
  process.exitCode = 1;
});
