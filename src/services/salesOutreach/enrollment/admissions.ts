import { csiDataset } from "../../../config/domain/salesIntelligence";
import {
  SALES_OUTREACH_CONTRACT_VERSION,
  SALES_OUTREACH_LEAD_MODELS,
  SALES_OUTREACH_TIMEZONE,
  type SalesOutreachLeadModel,
} from "../../../config/domain/salesOutreach";
import { getSalesIntelligenceJobModel } from "../../../models/SalesIntelligenceJob";
import { CSI_JOB_RETENTION_SECONDS } from "../../../models/salesIntelligence/infrastructure";
import type { SalesOutreachAdmissions } from "../../../validation/v1/salesOutreachEnrollment";
import { OutreachError } from "../errors";
import { newYorkBusinessDay, newYorkDayBounds } from "../reads/businessDay";
import type { DeskLeadRef } from "../subjects/leadFacts";

/**
 * Intake admissions read (olr B8, `GET /enrollment/admissions?business_day`): what the
 * `outreach_lead_change` jobs that completed on one New York day decided for Leads that were not desk
 * subjects. Every intake refusal is the job's stored `result` (`leadChangeJob.ts` `LeadRefreshResult`),
 * so this is a read over the job ledger, not a new collection: completed jobs are kept
 * `CSI_JOB_RETENTION_SECONDS` (14 days, the `csi_job_completed_ttl` index), so older days answer 400
 * `retention_exceeded`. Read-only; no configuration is needed (the history stands whatever is active).
 */

/** Days a completed job (and so its admission result) is kept. */
export const ADMISSIONS_RETENTION_DAYS = CSI_JOB_RETENTION_SECONDS / 86_400;
/** Most recent refusals listed (newest first). */
export const ADMISSIONS_RECENT_LIMIT = 50;
/** The job outcomes this read counts; `updated`/`unchanged`/`lead_missing` are subject refreshes, not admissions. */
export const ADMISSION_OUTCOMES = ["created", "not_admitted", "deferred"] as const;

/** One group of completed results: how many jobs stored this outcome / reason / subject status / admission path. */
export type AdmissionGroup = Readonly<{
  outcome: string;
  reason: string | null;
  status: string | null;
  admission: string | null;
  count: number;
}>;

/** One `not_admitted` job, as the recent-refusals list needs it. */
export type AdmissionRefusalRow = Readonly<{ subject_key: string; input_refs: readonly string[]; reason: string | null; completed_at: Date }>;

export type AdmissionsStore = {
  /** Completed `outreach_lead_change` results in `[from, to)` by `completed_at`: grouped counts and the newest refusals. */
  leadChangeResults(window: Readonly<{ from: Date; to: Date }>, recentLimit: number): Promise<{ groups: AdmissionGroup[]; recent: AdmissionRefusalRow[] }>;
};

type GroupLean = { _id: { outcome?: unknown; reason?: unknown; status?: unknown; admission?: unknown }; count: number };
type RecentLean = { subject_key?: unknown; input_refs?: unknown; reason?: unknown; completed_at?: unknown };
const text = (value: unknown) => (typeof value === "string" ? value : null);

/**
 * One aggregation over `sales_intelligence_jobs`: the dataset, the stage, `status: completed` (the
 * equality prefix of `csi_job_claim`) and the day's `completed_at` range (`csi_job_completed_ttl`); the
 * planner picks between the two. Only the three admission outcomes are grouped.
 */
export const mongoAdmissionsStore: AdmissionsStore = {
  async leadChangeResults(window, recentLimit) {
    const [row] = (await getSalesIntelligenceJobModel().aggregate([
      {
        $match: {
          ...csiDataset(),
          stage: "outreach_lead_change",
          status: "completed",
          completed_at: { $gte: window.from, $lt: window.to },
          "result.outcome": { $in: [...ADMISSION_OUTCOMES] },
        },
      },
      {
        $facet: {
          groups: [
            {
              $group: {
                _id: { outcome: "$result.outcome", reason: "$result.reason", status: "$result.status", admission: "$result.admission" },
                count: { $sum: 1 },
              },
            },
          ],
          recent: [
            { $match: { "result.outcome": "not_admitted" } },
            { $sort: { completed_at: -1, _id: -1 } },
            { $limit: recentLimit },
            { $project: { _id: 0, subject_key: 1, input_refs: 1, completed_at: 1, reason: "$result.reason" } },
          ],
        },
      },
    ])) as Array<{ groups: GroupLean[]; recent: RecentLean[] }>;
    return {
      groups: (row?.groups ?? []).map((group) => ({
        outcome: text(group._id.outcome) ?? "unknown",
        reason: text(group._id.reason),
        status: text(group._id.status),
        admission: text(group._id.admission),
        count: group.count,
      })),
      recent: (row?.recent ?? []).map((refusal) => ({
        subject_key: text(refusal.subject_key) ?? "",
        input_refs: Array.isArray(refusal.input_refs) ? refusal.input_refs.map(String) : [],
        reason: text(refusal.reason),
        completed_at: refusal.completed_at as Date,
      })),
    };
  },
};

/** Counts of one day (the DTO's `counts`). */
export type AdmissionCounts = SalesOutreachAdmissions["counts"];

/**
 * Folds the grouped results into the day's counts. A created subject counts once: `admitted_expansion`
 * when its admission path was expansion (olr B6), else `admitted_review` when it was created `review`
 * (held, or its priority needs review), else `admitted_intake`. A `created` result stored before B8
 * carries no status and counts as `admitted_intake`. Refusals count by their stored reason (`unknown`
 * when none). Pure.
 */
export function admissionCountsOf(groups: readonly AdmissionGroup[]): AdmissionCounts {
  const counts = { admitted_intake: 0, admitted_review: 0, admitted_expansion: 0, deferred: 0, not_admitted: {} as Record<string, number> };
  for (const group of groups) {
    if (group.outcome === "created") {
      if (group.admission === "expansion") counts.admitted_expansion += group.count;
      else if (group.status === "review") counts.admitted_review += group.count;
      else counts.admitted_intake += group.count;
    } else if (group.outcome === "deferred") counts.deferred += group.count;
    else if (group.outcome === "not_admitted") {
      const reason = group.reason ?? "unknown";
      counts.not_admitted[reason] = (counts.not_admitted[reason] ?? 0) + group.count;
    }
  }
  counts.not_admitted = Object.fromEntries(Object.entries(counts.not_admitted).sort(([a], [b]) => a.localeCompare(b)));
  return counts;
}

const LEAD_MODELS: ReadonlySet<string> = new Set(SALES_OUTREACH_LEAD_MODELS);

/** The Lead of an `outreach_lead_change` job (`subject_key` `outreach-lead:<model>:<id>`), or null when malformed. */
export function leadRefOfJob(row: Pick<AdmissionRefusalRow, "subject_key" | "input_refs">): DeskLeadRef | null {
  const [prefix, model, id] = row.subject_key.split(":");
  const leadId = id ?? row.input_refs[0];
  if (prefix !== "outreach-lead" || !model || !LEAD_MODELS.has(model) || !leadId || !/^[a-f\d]{24}$/i.test(leadId)) return null;
  return { model: model as SalesOutreachLeadModel, id: leadId };
}

export type AdmissionsDeps = { store?: AdmissionsStore; now?: () => Date };

/**
 * `GET /enrollment/admissions?business_day=YYYY-MM-DD` (default: today in New York). A day whose start
 * is more than `ADMISSIONS_RETENTION_DAYS` before now is 400 `retention_exceeded` (its jobs may already
 * be gone); a day after today is 400 `business_day_in_future`.
 */
export async function readEnrollmentAdmissions(query: Readonly<{ business_day?: string }>, deps: AdmissionsDeps = {}): Promise<SalesOutreachAdmissions> {
  const asOf = (deps.now ?? (() => new Date()))();
  const businessDay = query.business_day ?? newYorkBusinessDay(asOf);
  const bounds = newYorkDayBounds(businessDay);
  if (+bounds.start > +asOf) throw new OutreachError("INVALID_INPUT", [{ path: "business_day", code: "business_day_in_future" }]);
  if (+bounds.start < +asOf - CSI_JOB_RETENTION_SECONDS * 1000)
    throw new OutreachError("INVALID_INPUT", [{ path: "business_day", code: "retention_exceeded", message: `completed jobs are kept ${ADMISSIONS_RETENTION_DAYS} days` }]);
  const { groups, recent } = await (deps.store ?? mongoAdmissionsStore).leadChangeResults({ from: bounds.start, to: bounds.end }, ADMISSIONS_RECENT_LIMIT);
  return {
    contract_version: SALES_OUTREACH_CONTRACT_VERSION,
    business_day: businessDay,
    as_of: asOf.toISOString(),
    timezone: SALES_OUTREACH_TIMEZONE,
    retention_days: ADMISSIONS_RETENTION_DAYS,
    counts: admissionCountsOf(groups),
    recent_refusals: recent.flatMap((row) => {
      const lead = leadRefOfJob(row);
      return lead ? [{ lead, reason: row.reason ?? "unknown", at: row.completed_at.toISOString() }] : [];
    }),
  };
}
