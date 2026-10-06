import { randomUUID } from "node:crypto";
import type { ClientSession } from "mongoose";
import { CsiError } from "../../salesIntelligence/auth";
import { claimCsiJob, completeCsiJob, failCsiJob, type JobLease } from "../../salesIntelligence/jobs";
import { salesOutreachConfigurationLoader, type ActiveConfiguration, type ConfigurationLoader } from "../config/load";
import { OutreachError } from "../errors";
import type { DeskLeadRef } from "./leadFacts";
import { mongoDeskSubjectStore, type DeskSubjectStore } from "./store";
import { intakeAdmissionOf, loadSubjectPageContext, syncSubject } from "./sync";

/**
 * The job's stored result (`sales_intelligence_jobs.result`, kept 14 days), read by
 * `GET /enrollment/admissions` (olr B8). `status` is the subject's status after the job (null when there
 * is no subject); `admission` names the path that created the subject (`intake`; null otherwise). Results
 * stored before B8 carry neither.
 */
export type LeadRefreshResult = Readonly<{
  outcome: "created" | "updated" | "unchanged" | "not_admitted" | "lead_missing";
  subject_id: string | null;
  reason: string | null;
  status: "active" | "review" | "closed" | null;
  admission: "intake" | null;
}>;

/**
 * The work of one `outreach_lead_change` job, inside its transaction: refresh the Lead's subject from
 * current facts (P05d transition, P05e retention, P05g display, IMPL-01 assignment, IMPL-07 numbers),
 * or — when the Lead is not a subject — run the intake admission gate (`outreach_intake`) and enroll it
 * once as `kind: intake` (held as `review` with no period when its identity or received time is not
 * sound, olr B8). Reads the Lead as it is now, so a job for an older revision is a no-op.
 */
export async function refreshLeadForOutreach(
  lead: DeskLeadRef,
  configuration: ActiveConfiguration,
  asOf: Date,
  store: DeskSubjectStore,
  session: ClientSession,
): Promise<LeadRefreshResult> {
  const [facts] = await store.loadLeads([lead], session);
  const [subject] = await store.findSubjects([lead], session);
  if (!facts) return { outcome: "lead_missing", subject_id: subject?.id ?? null, reason: "lead_not_found", status: subject?.status ?? null, admission: null };
  const context = await loadSubjectPageContext(store, [facts], asOf, session);
  if (subject) {
    const synced = await syncSubject({ facts, subject, configuration, context }, store, session);
    return { outcome: synced.outcome, subject_id: synced.subject_id, reason: synced.period_reason, status: synced.status, admission: null };
  }
  const admission = intakeAdmissionOf(facts, configuration, asOf);
  if (!admission.admit) return { outcome: "not_admitted", subject_id: null, reason: admission.reason, status: null, admission: null };
  // olr B8: an ambiguous Job Number no longer refuses; the subject is admitted held (`admissionHoldOf`).
  const synced = await syncSubject({ facts, subject: null, enrollment: admission.enrollment, configuration, context }, store, session);
  return { outcome: synced.outcome, subject_id: synced.subject_id, reason: null, status: synced.status, admission: "intake" };
}

export type LeadChangeJobDeps = {
  loader?: ConfigurationLoader;
  store?: DeskSubjectStore;
  now?: () => Date;
  claim?: typeof claimCsiJob;
  complete?: typeof completeCsiJob;
  fail?: typeof failCsiJob;
};

export type LeadChangeJobStatus = "configuration_unavailable" | "not_claimable" | "completed" | "lease_lost" | "retry";

/**
 * Runs one `outreach_lead_change` job. The configuration pointer is read at admission (before the
 * claim: no active configuration → nothing is claimed) and re-read inside the job transaction; a moved
 * pointer aborts the write and retries under the new revision (CONTRACTS load semantics).
 */
export async function runOutreachLeadChangeJob(jobId?: string, deps: LeadChangeJobDeps = {}): Promise<{ status: LeadChangeJobStatus; result?: LeadRefreshResult }> {
  const loader = deps.loader ?? salesOutreachConfigurationLoader;
  const admitted = await loader.inspect();
  if (admitted.state !== "active") return { status: "configuration_unavailable" };
  const row = await (deps.claim ?? claimCsiJob)(`sod-lead-change:${randomUUID()}`, jobId, 120_000, "outreach_lead_change");
  if (!row) return { status: "not_claimable" };
  const lease: JobLease = { job_id: String(row._id), owner: row.lease_owner!, epoch: row.lease_epoch };
  const model = row.subject_key.split(":")[1];
  const id = row.input_refs.map(String)[0];
  try {
    if ((model !== "FormLead" && model !== "CallLead") || !id) throw new CsiError("INVALID_INPUT");
    const result = await (deps.complete ?? completeCsiJob)(
      lease,
      async (session) => {
        const current = await loader.requireActive(session);
        if (current.revision !== admitted.revision || current.version !== admitted.version)
          throw new OutreachError("CONFIGURATION_UNAVAILABLE", [{ path: "configuration", code: "revision_changed" }]);
        return refreshLeadForOutreach({ model, id }, current, (deps.now ?? (() => new Date()))(), deps.store ?? mongoDeskSubjectStore, session);
      },
      { resultFrom: (value) => value },
    );
    return { status: "completed", result };
  } catch (error) {
    if (error instanceof CsiError && error.code === "LEASE_LOST") return { status: "lease_lost" };
    await (deps.fail ?? failCsiJob)(lease, error instanceof CsiError && error.code === "INVALID_INPUT" ? "schema_invalid" : "transient");
    return { status: "retry" };
  }
}

/** Drains up to `max` (≤ 100) runnable `outreach_lead_change` jobs within `deadlineMs`. */
export async function drainOutreachLeadChangeJobs(max = 100, deadlineMs = 40_000, deps: LeadChangeJobDeps = {}) {
  const outcomes: Record<string, number> = {};
  const deadline = Date.now() + deadlineMs;
  for (let i = 0; i < Math.min(100, max) && Date.now() < deadline; i++) {
    const { status } = await runOutreachLeadChangeJob(undefined, deps);
    outcomes[status] = (outcomes[status] ?? 0) + 1;
    if (status === "configuration_unavailable" || status === "not_claimable" || status === "lease_lost") break;
  }
  return { outcomes };
}
