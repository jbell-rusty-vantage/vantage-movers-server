import { randomUUID } from "node:crypto";
import { CsiError } from "../../salesIntelligence/auth";
import { claimCsiJob, completeCsiJob, failCsiJob, type JobLease } from "../../salesIntelligence/jobs";
import { publishRunnableWakeups } from "../../numberActivity/webhookFanout";
import { salesOutreachConfigurationLoader, type ActiveConfiguration, type ConfigurationLoader } from "../config/load";
import { OutreachError } from "../errors";
import { applyContactSources, type ApplyResult, type ContactEventStore, type ContactSource } from "./apply";
import { mongoContactEventStore } from "./mongoStore";
import { mongoRepDayStore, recountRepDay, type RepDayRecount, type RepDayStore } from "./repDayService";

/**
 * The two S3 desk job stages (IMPLEMENTATION-PLAN §6.2), dispatched by `numberActivity/jobDispatch.ts`
 * and drained by the contact-events cron:
 *
 * - `outreach_contact_change` (`subject_key` `call:<id>` / `sms:<id>`): derive the source's contact
 *   event, nominate `outreach_evaluate` for the subjects it moved, enqueue `outreach_rep_day` for the
 *   rep-days it moved; the queue wake-ups for created rep-day jobs are published after commit.
 * - `outreach_rep_day` (`subject_key` `outreach-rep-day:<agent>:<YYYY-MM-DD>`): recount the rep-day.
 *
 * No env flag gates them. Admission reads the persisted configuration: it must be active with
 * `desk_enabled` or `goal_metrics_enabled` on, else nothing is claimed (rows wait; fail closed). The
 * pointer is re-read inside the job transaction and a moved pointer aborts the write (CONTRACTS load
 * semantics); the retry runs under the new revision.
 */

export const OUTREACH_REP_DAY_STAGE = "outreach_rep_day" as const;

export type ContactJobDeps = {
  loader?: ConfigurationLoader;
  store?: ContactEventStore;
  repDayStore?: RepDayStore;
  now?: () => Date;
  claim?: typeof claimCsiJob;
  complete?: typeof completeCsiJob;
  fail?: typeof failCsiJob;
  publish?: (jobIds: readonly string[]) => Promise<unknown>;
};

export type ContactJobStatus = "configuration_unavailable" | "not_wanted" | "not_claimable" | "completed" | "lease_lost" | "retry";

/** Persisted controls decide: the desk or its goal metrics must be on. */
export function wantsContactEvidence(configuration: ActiveConfiguration): boolean {
  return configuration.value.controls.desk_enabled || configuration.value.controls.goal_metrics_enabled;
}

async function admit(loader: ConfigurationLoader): Promise<ActiveConfiguration | "configuration_unavailable" | "not_wanted"> {
  const inspected = await loader.inspect();
  if (inspected.state !== "active") return "configuration_unavailable";
  return wantsContactEvidence(inspected) ? inspected : "not_wanted";
}

async function recheck(loader: ConfigurationLoader, admitted: ActiveConfiguration, session: Parameters<ConfigurationLoader["requireActive"]>[0]) {
  const current = await loader.requireActive(session);
  if (current.revision !== admitted.revision || current.version !== admitted.version || !wantsContactEvidence(current))
    throw new OutreachError("CONFIGURATION_UNAVAILABLE", [{ path: "configuration", code: "revision_changed" }]);
  return current;
}

export function parseContactSubjectKey(subjectKey: string): ContactSource | null {
  const match = /^(call|sms):([0-9a-f]{24})$/.exec(subjectKey);
  return match ? { source_kind: match[1] as "call" | "sms", source_id: match[2]! } : null;
}

export function parseRepDaySubjectKey(subjectKey: string): { agent_id: string; business_day: string } | null {
  const match = /^outreach-rep-day:([0-9a-f]{24}):(\d{4}-\d{2}-\d{2})$/.exec(subjectKey);
  return match ? { agent_id: match[1]!, business_day: match[2]! } : null;
}

const failureReason = (error: unknown) => (error instanceof CsiError && error.code === "INVALID_INPUT" ? "schema_invalid" : "transient");

/** Runs one `outreach_contact_change` job. */
export async function runOutreachContactChangeJob(jobId?: string, deps: ContactJobDeps = {}): Promise<{ status: ContactJobStatus; result?: ApplyResult }> {
  const loader = deps.loader ?? salesOutreachConfigurationLoader;
  const admitted = await admit(loader);
  if (typeof admitted === "string") return { status: admitted };
  const row = await (deps.claim ?? claimCsiJob)(`sod-contact-change:${randomUUID()}`, jobId, 120_000, "outreach_contact_change");
  if (!row) return { status: "not_claimable" };
  const lease: JobLease = { job_id: String(row._id), owner: row.lease_owner!, epoch: row.lease_epoch };
  try {
    const source = parseContactSubjectKey(row.subject_key);
    if (!source) throw new CsiError("INVALID_INPUT");
    const now = (deps.now ?? (() => new Date()))();
    const result = await (deps.complete ?? completeCsiJob)(
      lease,
      async (session) => {
        await recheck(loader, admitted, session);
        return applyContactSources([source], { now, queueRepDays: true }, deps.store ?? mongoContactEventStore, session);
      },
      { resultFrom: (value) => ({ derived: value.derived, changed: value.changed, missing: value.missing, evaluations: value.evaluations, rep_days: value.rep_days.length }) },
    );
    if (result.created_job_ids.length)
      await (deps.publish ?? ((ids: readonly string[]) => publishRunnableWakeups(ids)))(result.created_job_ids).catch(() => undefined);
    return { status: "completed", result };
  } catch (error) {
    if (error instanceof CsiError && error.code === "LEASE_LOST") return { status: "lease_lost" };
    await (deps.fail ?? failCsiJob)(lease, failureReason(error));
    return { status: "retry" };
  }
}

/** Runs one `outreach_rep_day` job. */
export async function runOutreachRepDayJob(jobId?: string, deps: ContactJobDeps = {}): Promise<{ status: ContactJobStatus; result?: RepDayRecount }> {
  const loader = deps.loader ?? salesOutreachConfigurationLoader;
  const admitted = await admit(loader);
  if (typeof admitted === "string") return { status: admitted };
  const row = await (deps.claim ?? claimCsiJob)(`sod-rep-day:${randomUUID()}`, jobId, 120_000, OUTREACH_REP_DAY_STAGE);
  if (!row) return { status: "not_claimable" };
  const lease: JobLease = { job_id: String(row._id), owner: row.lease_owner!, epoch: row.lease_epoch };
  try {
    const key = parseRepDaySubjectKey(row.subject_key);
    if (!key) throw new CsiError("INVALID_INPUT");
    const now = (deps.now ?? (() => new Date()))();
    const result = await (deps.complete ?? completeCsiJob)(
      lease,
      async (session) => recountRepDay(key, await recheck(loader, admitted, session), now, deps.repDayStore ?? mongoRepDayStore, session),
      { resultFrom: (value) => ({ outcome: value.outcome, publication_revision: value.publication_revision }) },
    );
    return { status: "completed", result };
  } catch (error) {
    if (error instanceof CsiError && error.code === "LEASE_LOST") return { status: "lease_lost" };
    await (deps.fail ?? failCsiJob)(lease, failureReason(error));
    return { status: "retry" };
  }
}

const STOP: ReadonlySet<ContactJobStatus> = new Set(["configuration_unavailable", "not_wanted", "not_claimable", "lease_lost"]);

/** Drains up to `max` (≤ 100) runnable jobs of one S3 stage within `deadlineMs`. */
export async function drainContactJobs(
  stage: "outreach_contact_change" | "outreach_rep_day",
  max = 100,
  deadlineMs = 20_000,
  deps: ContactJobDeps = {},
): Promise<{ outcomes: Record<string, number> }> {
  const run = stage === "outreach_contact_change" ? runOutreachContactChangeJob : runOutreachRepDayJob;
  const outcomes: Record<string, number> = {};
  const deadline = Date.now() + deadlineMs;
  for (let i = 0; i < Math.min(100, max) && Date.now() < deadline; i++) {
    const { status } = await run(undefined, deps);
    outcomes[status] = (outcomes[status] ?? 0) + 1;
    if (STOP.has(status)) break;
  }
  return { outcomes };
}
