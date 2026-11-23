/**
 * Backlog half of the November 22 routine-expiry extension (`docs/operations/SI-JOBS-VOLUME-BRIEF-2026-11-22.md`).
 *
 * A completed job keeps the expiry it was given when it completed. Since this release the completion transaction
 * gives sweep-woken `outreach_evaluate` jobs (`due:` and `coverage:` keys) and `capture_projection` jobs whose every
 * session projected the routine three-day purge. This operator gives already-completed rows the same instant through
 * the same function (`routinePurgeAt`), so a row qualifies here exactly when it would qualify at completion today.
 *
 * It only sets `routine_purge_at`. The `csi_job_routine_ttl` monitor then removes the row; a row completed more than
 * three days ago leaves on the monitor's next pass. Nothing else on the row changes, and nothing is archived: no
 * reader uses these results (the Service docs list the readers).
 */
import type { CsiJobStage } from "../../src/config/domain/salesIntelligence";
import { routinePurgeAt } from "../../src/services/salesIntelligence/jobs";

export const BACKLOG_STAGES = ["outreach_evaluate", "capture_projection"] as const satisfies readonly CsiJobStage[];
export const MAX_BACKLOG_BATCH = 500;

export type BacklogArgs = Readonly<{
  target: string;
  apply: boolean;
  /** Rows to change in this run; required with `--apply`. */
  limit: number | null;
  /** Resume strictly after this `_id`. */
  after: string | null;
  batch: number;
  pause_ms: number;
}>;

const positive = (name: string, raw: string, max = Number.MAX_SAFE_INTEGER) => {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`${name} must be an integer from 1 to ${max}`);
  return value;
};

export function parseBacklogArgs(argv: readonly string[]): BacklogArgs {
  let target: string | null = null, apply = false, limit: number | null = null, after: string | null = null;
  let batch = MAX_BACKLOG_BATCH, pause_ms = 250;
  for (const arg of argv) {
    const [flag, value = ""] = arg.split(/=(.*)/s, 2);
    if (arg === "--apply") apply = true;
    else if (arg === "--allow-schema-drift") continue;
    else if (flag === "--target") target = value.trim();
    else if (flag === "--limit") limit = positive("--limit", value);
    else if (flag === "--batch") batch = positive("--batch", value, MAX_BACKLOG_BATCH);
    else if (flag === "--pause-ms") pause_ms = value === "0" ? 0 : positive("--pause-ms", value, 60_000);
    else if (flag === "--after") {
      if (!/^[a-f0-9]{24}$/.test(value)) throw new Error("--after must be a job _id");
      after = value;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!target || !/^[A-Za-z0-9_]+$/.test(target)) throw new Error("--target=<database name> is required (for example --target=vantagemovers)");
  if (apply && limit === null) throw new Error("--apply requires --limit=<rows>");
  return { target, apply, limit, after, batch, pause_ms };
}

export type BacklogRow = {
  _id: unknown; stage: CsiJobStage; dedupe_key: string; subject_key: string; input_revision: number;
  input_refs: readonly unknown[]; payload_hash: string; deployment: string; database: string;
  result?: unknown; completed_at: Date;
};

/** The report label: the evaluation cause or the capture outcome. */
export function backlogClass(row: Pick<BacklogRow, "stage" | "dedupe_key">): string {
  if (row.stage === "capture_projection") return "capture_projection";
  const cause = row.dedupe_key.split(":")[3] ?? "";
  if (row.dedupe_key.includes(":contacts:")) return "outreach_evaluate:contacts";
  return `outreach_evaluate:${/^r\d+$/.test(cause) ? "revision" : cause}`;
}

export type BacklogTally = { rows: number; bytes: number; leave_now: number };
export type BacklogPlan = {
  eligible: Record<string, BacklogTally>;
  held: Record<string, number>;
  first_purge_at: string | null;
  last_purge_at: string | null;
};

export const emptyPlan = (): BacklogPlan => ({ eligible: {}, held: {}, first_purge_at: null, last_purge_at: null });

/** Classify one completed row into `plan`; returns its purge instant when it qualifies. */
export function planBacklogRow(plan: BacklogPlan, row: BacklogRow, bytes: number, now: Date): Date | undefined {
  const cls = backlogClass(row);
  const purge = routinePurgeAt(row, row.result, row.completed_at);
  if (!purge) {
    plan.held[cls] = (plan.held[cls] ?? 0) + 1;
    return undefined;
  }
  const tally = (plan.eligible[cls] ??= { rows: 0, bytes: 0, leave_now: 0 });
  tally.rows++;
  tally.bytes += bytes;
  if (+purge <= +now) tally.leave_now++;
  const iso = purge.toISOString();
  if (!plan.first_purge_at || iso < plan.first_purge_at) plan.first_purge_at = iso;
  if (!plan.last_purge_at || iso > plan.last_purge_at) plan.last_purge_at = iso;
  return purge;
}
