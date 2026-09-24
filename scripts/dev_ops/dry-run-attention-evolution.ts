/**
 * AC7-DRYRUN (Attention and Case File spec §10): what `SALES_INTELLIGENCE_ATTENTION_EVOLUTION=true`
 * would change on the desk, computed in memory. Read only: no transaction, no write, no enqueue.
 *
 * For every non-closed, non-purged Outreach record it loads the same batched inputs as the Attention
 * publish (`loadOutreachInputsBatch`) and runs the publish's own `deriveOutreachFacts` twice at one
 * `as_of`, flag off and flag on. For the flag-on side the §5.4 record fields (`last_inbound_human_at`,
 * `last_attributable_outbound_at`, `prior_contact_at`, `last_activity_at`) are computed in memory with
 * `computeContactFacts` when the stored record lacks them (production records do until repair laps
 * write them). It also counts the P4 progress defaults and the P7 `first_attempts` assignments the
 * current state qualifies for.
 *
 *   node --env-file=.env --import tsx scripts/dev_ops/dry-run-attention-evolution.ts [--allow-production] [--as-of ISO] [--limit N] [--out <dir>]
 *
 * Writes `AC7-DRYRUN-<env>.json` and `.md` to `--out` (default `scripts/dev_ops/output`); `<env>` is
 * `production` for `vantagemovers`, else `replica`.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { getOutreachRecordModel } from "../../src/models/OutreachRecord";
import { readCaptureCoverage } from "../../src/services/numberActivity/coverage";
import { resolvePolicy } from "../../src/services/salesIntelligence/policy";
import { csiPolicyEvolution } from "../../src/validation/v1/salesIntelligence";
import { deriveOutreachFacts, loadOutreachInputsBatch, type OutreachInputs } from "../../src/services/salesIntelligence/outreach/reads";
import { computeContactFacts, contactFactsMissing, firstAttemptsAgent } from "../../src/services/salesIntelligence/outreach/ensure";
import type { RecordRow } from "../../src/services/salesIntelligence/outreach/types";

const FLAG = "SALES_INTELLIGENCE_ATTENTION_EVOLUTION";
const PAGE = 200;

/** `deriveOutreachFacts` is synchronous and reads the flag at call time; set it for exactly that call. */
function deriveWith(evolution: boolean, record: RecordRow, inputs: OutreachInputs, context: Parameters<typeof deriveOutreachFacts>[2]) {
  const previous = process.env[FLAG];
  process.env[FLAG] = evolution ? "true" : "false";
  try { return deriveOutreachFacts(record, inputs, context); }
  finally { if (previous === undefined) delete process.env[FLAG]; else process.env[FLAG] = previous; }
}

export type DryRunReport = {
  env: "production" | "replica"; database: string; as_of: string; policy_version: string; records: number; truncated: boolean;
  facts_computed_in_memory: number; facts_already_stored: number;
  bands: { off: Record<string, number>; on: Record<string, number> };
  reasons: { off: Record<string, number>; on: Record<string, number>; added: Record<string, number>; removed: Record<string, number> };
  /** "<off band>→<on band>" (band "none" when outside Attention). */
  transitions: Record<string, number>;
  changed_records: number;
  p4_defaults: { eligible_now: number; by_state: Record<string, number>; note: string };
  p7_first_attempts: { eligible_now: number; note: string };
  samples: Array<{ record: string; off: string; on: string; reasons_on: string[] }>;
};
const bandKey = (band: number | null | undefined) => (band ? String(band) : "none");
const bump = (map: Record<string, number>, key: string, by = 1) => { map[key] = (map[key] ?? 0) + by; };

export async function dryRunAttentionEvolution(options: { asOf?: Date; limit?: number; samples?: number; log?: (line: string) => void } = {}): Promise<DryRunReport> {
  const now = options.asOf ?? new Date();
  const database = getMongoDatabaseName();
  const [policy, coverage] = await Promise.all([resolvePolicy(), readCaptureCoverage()]);
  const tuning = csiPolicyEvolution(policy);
  const report: DryRunReport = { env: database === "vantagemovers" ? "production" : "replica", database, as_of: now.toISOString(), policy_version: policy.version,
    records: 0, truncated: false, facts_computed_in_memory: 0, facts_already_stored: 0,
    bands: { off: {}, on: {} }, reasons: { off: {}, on: {}, added: {}, removed: {} }, transitions: {}, changed_records: 0,
    p4_defaults: { eligible_now: 0, by_state: {}, note: "Accepted progress to Quoted, open or unworked-with-work, no open action. ensure creates the default only at the next accepted progress change (not retroactively)." },
    p7_first_attempts: { eligible_now: 0, note: "No responsible rep and no assignment origin; >= first_attempts_threshold attempts by one reviewed rep (firstAttemptsAgent). Assigned at the next processed call, not retroactively." },
    samples: [] };
  // A plain session for the helpers' `.session()` calls; no transaction is opened.
  const session = await mongoose.startSession();
  try {
    let after: mongoose.Types.ObjectId | null = null;
    for (;;) {
      const page = await getOutreachRecordModel().find({ purged_at: null, state: { $ne: "closed" }, ...(after ? { _id: { $gt: after } } : {}) })
        .sort({ _id: 1 }).limit(PAGE).lean() as unknown as RecordRow[];
      if (!page.length) break;
      const inputs = await loadOutreachInputsBatch(page, now);
      for (const stored of page) {
        if (options.limit && report.records >= options.limit) { report.truncated = true; break; }
        report.records++;
        after = stored._id;
        const bundle = inputs.get(String(stored._id));
        if (!bundle) continue;
        const context = { now, policy, coverage };
        const off = deriveWith(false, stored, bundle, context);
        let record = stored;
        if (contactFactsMissing(stored as never)) { record = { ...stored, ...(await computeContactFacts(stored, session)) } as RecordRow; report.facts_computed_in_memory++; }
        else report.facts_already_stored++;
        const on = deriveWith(true, record, bundle, context);
        bump(report.bands.off, bandKey(off.attention_band));
        bump(report.bands.on, bandKey(on.attention_band));
        for (const reason of off.reasons) bump(report.reasons.off, reason);
        for (const reason of on.reasons) bump(report.reasons.on, reason);
        for (const reason of on.reasons.filter(r => !off.reasons.includes(r))) bump(report.reasons.added, reason);
        for (const reason of off.reasons.filter(r => !on.reasons.includes(r))) bump(report.reasons.removed, reason);
        bump(report.transitions, `${bandKey(off.attention_band)}→${bandKey(on.attention_band)}`);
        const changed = off.attention_band !== on.attention_band || off.reasons.join("|") !== on.reasons.join("|");
        if (changed) {
          report.changed_records++;
          if (report.samples.length < (options.samples ?? 25)) report.samples.push({ record: String(stored._id), off: bandKey(off.attention_band), on: bandKey(on.attention_band), reasons_on: on.reasons });
        }
        // P4: the state §7.1 creates a default from (without the progress-change trigger).
        const progress = stored.lead_progress;
        const open = bundle.actions.some(a => a.status === "open");
        if (progress?.provenance === "accepted" && progress.disposition === "quoted" && !open && stored.closure_origin !== "owner" &&
          (stored.state === "open" || (stored.state === "unworked" && progress.work_observed))) {
          report.p4_defaults.eligible_now++; bump(report.p4_defaults.by_state, stored.state);
        }
        // P7: an unassigned record with no stronger origin, two attempts by one reviewed rep.
        if (!stored.responsible_agent_id && !stored.assignment?.origin && stored.primary_contact_number_id &&
          await firstAttemptsAgent(stored, stored.primary_contact_number_id, tuning.first_attempts_threshold, session)) report.p7_first_attempts.eligible_now++;
      }
      options.log?.(JSON.stringify({ progress: report.records, changed: report.changed_records }));
      if (report.truncated || page.length < PAGE) break;
    }
  } finally { await session.endSession(); }
  return report;
}

export function dryRunMarkdown(report: DryRunReport): string {
  const bands = ["1", "2", "3", "4", "5", "6", "7", "none"];
  const table = (map: Record<string, number>) => Object.entries(map).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, v]) => `| ${k} | ${v} |`).join("\n") || "| — | 0 |";
  const matrix = [`| off \\ on | ${bands.join(" | ")} |`, `|---|${bands.map(() => "---").join("|")}|`,
    ...bands.map(off => `| **${off}** | ${bands.map(on => report.transitions[`${off}→${on}`] ?? "").join(" | ")} |`)].join("\n");
  return `# AC7-DRYRUN (${report.env}): Attention evolution, flag off vs on

Generated by \`scripts/dev_ops/dry-run-attention-evolution.ts\` (read only). Database \`${report.database}\`, as of ${report.as_of}, policy ${report.policy_version}.
Records walked (non-closed, non-purged): **${report.records}**${report.truncated ? " (truncated by --limit)" : ""}. §5.4 fields computed in memory for ${report.facts_computed_in_memory}, already stored on ${report.facts_already_stored}.
Records whose band or reasons change: **${report.changed_records}**.

## Bands

| band | off | on |
|---|---|---|
${bands.map(b => `| ${b} | ${report.bands.off[b] ?? 0} | ${report.bands.on[b] ?? 0} |`).join("\n")}

## Transition matrix (rows: flag off band, columns: flag on band)

${matrix}

## Reasons (flag on)

| reason | records |
|---|---|
${table(report.reasons.on)}

Added by the flag:

| reason | records |
|---|---|
${table(report.reasons.added)}

Removed by the flag:

| reason | records |
|---|---|
${table(report.reasons.removed)}

## P4 defaults and P7 assignments

- P4 "Follow up on the quote" defaults the current state qualifies for: **${report.p4_defaults.eligible_now}** (${Object.entries(report.p4_defaults.by_state).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}). ${report.p4_defaults.note}
- P7 \`first_attempts\` assignments the current state qualifies for: **${report.p7_first_attempts.eligible_now}**. ${report.p7_first_attempts.note}

## Samples (first ${report.samples.length} changed records)

| record | off | on | reasons (on) |
|---|---|---|---|
${report.samples.map(s => `| ${s.record} | ${s.off} | ${s.on} | ${s.reasons_on.join(", ")} |`).join("\n")}
`;
}

function option(name: string) {
  const at = process.argv.indexOf(name);
  if (at < 0) return undefined;
  const value = process.argv[at + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing ${name} value`);
  return value;
}
const localDatabase = (database: string, uri: string | undefined) =>
  /^testvantagemovers_[a-z0-9]+$/i.test(database) && /^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(uri ?? "");

async function main() {
  await connectMongo();
  const database = getMongoDatabaseName();
  if (!localDatabase(database, process.env.MONGO_URI) && !process.argv.includes("--allow-production"))
    throw new Error("the database is not a local testvantagemovers_* one; pass --allow-production for the read-only production pass");
  const asOf = option("--as-of") ? new Date(option("--as-of")!) : undefined;
  if (asOf && Number.isNaN(+asOf)) throw new Error("--as-of must be an ISO date");
  const limit = option("--limit") ? Number(option("--limit")) : undefined;
  const report = await dryRunAttentionEvolution({ asOf, limit, log: line => console.error(line) });
  const dir = resolve(option("--out") ?? "scripts/dev_ops/output");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `AC7-DRYRUN-${report.env}.json`), JSON.stringify(report, null, 1) + "\n");
  await writeFile(join(dir, `AC7-DRYRUN-${report.env}.md`), dryRunMarkdown(report));
  console.log(JSON.stringify({ env: report.env, records: report.records, changed: report.changed_records, bands: report.bands, out: dir }));
}

if (require.main === module) {
  main().catch(error => { console.error(JSON.stringify({ stopped: true, error: error instanceof Error ? error.message.slice(0, 200) : "setup_failed" })); process.exitCode = 1; })
    .finally(() => mongoose.disconnect());
}
