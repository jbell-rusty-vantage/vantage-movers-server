import type { ClientSession } from "mongoose";
import { withTransaction } from "../../../db";
import { logger } from "../../../logger";
import { enqueueCsiJob } from "../../salesIntelligence/jobs";
import { publishRunnableWakeups } from "../../numberActivity/webhookFanout";
import type { TouchedInteraction } from "../../numberActivity/callLogApplier";
import { salesOutreachConfigurationLoader } from "../config/load";

/**
 * Desk wake for changed capture evidence (RINGCENTRAL-CAPTURE §4.5, IMPLEMENTATION-PLAN §6.2).
 *
 * Capture writes `call_interactions` (webhook projection, Call Log ISync, window reconcile) and
 * `ringcentral_rep_sms_evidence` (mailbox sync). After each of those commits, the touched rows are
 * handed here, which enqueues one deduplicated `outreach_contact_change` job per (source, revision)
 * in `sales_intelligence_jobs`. The SRV-6 consumer resolves association and rep identity and
 * upserts `sales_outreach_contact_events`; a minute sweep of `call_interactions` by revision is the
 * net for any wake lost here.
 *
 * Fail-safe by construction (no env flag gates it, CONTRACTS "Persisted configuration and
 * environment boundary"):
 * - the stage has a registered consumer (`contacts/jobs.ts` via `numberActivity/jobDispatch.ts`, plus
 *   the contact-events cron drain), so no row is written without something to run it;
 * - nothing is enqueued unless the persisted desk configuration is active and `desk_enabled` or
 *   `goal_metrics_enabled` is on (missing or broken configuration ⇒ no work, fail closed);
 * - the post-commit wake never throws into capture; a failure is logged and the sweep repairs it.
 */
export const OUTREACH_CONTACT_CHANGE_STAGE = "outreach_contact_change" as const;

export type ContactChangeSource = {
  source_kind: "call" | "sms";
  /** `call_interactions._id` or `ringcentral_rep_sms_evidence._id`. */
  source_id: string;
  /** Distinguishes evidence versions in the dedupe key (e.g. `r12`, or `m<winner>` for a merged row). */
  source_revision: string;
};

export function contactChangeDedupeKey(source: ContactChangeSource): string {
  return `sod:contact_change:${source.source_kind}:${source.source_id}:${source.source_revision}`;
}

export function contactChangeSubjectKey(source: ContactChangeSource): string {
  return `${source.source_kind}:${source.source_id}`;
}

/** Touched call rows → wake sources (a merged loser carries the winner so its credit is revoked). */
export function sourcesFromTouchedCalls(touched: readonly TouchedInteraction[]): ContactChangeSource[] {
  const out = new Map<string, ContactChangeSource>();
  for (const row of touched) {
    const source_revision = row.merged_into ? `m${row.merged_into}` : `r${row.projection_revision ?? 0}`;
    const source: ContactChangeSource = { source_kind: "call", source_id: row.interaction_id, source_revision };
    out.set(contactChangeDedupeKey(source), source);
  }
  return [...out.values()];
}

export type ContactChangeDeps = {
  /** True when the desk configuration is active and wants contact evidence. */
  wanted?: (session?: ClientSession) => Promise<boolean>;
  enqueue?: typeof enqueueCsiJob;
  transaction?: <T>(work: (session: ClientSession) => Promise<T>) => Promise<T>;
  publish?: (jobIds: readonly string[]) => Promise<unknown>;
  now?: () => Date;
};

/** Persisted desk controls decide; an uninitialized or broken configuration wants nothing. */
export async function deskWantsContactEvidence(session?: ClientSession): Promise<boolean> {
  try {
    const loaded = await salesOutreachConfigurationLoader.load(session);
    if (loaded.state !== "active") return false;
    return loaded.value.controls.desk_enabled || loaded.value.controls.goal_metrics_enabled;
  } catch {
    return false;
  }
}

/**
 * In-transaction enqueue (the capture-projection completion transaction). Returns the jobs it
 * created so the caller publishes their wake-ups after commit.
 */
export async function enqueueOutreachContactChangeJobs(
  sources: readonly ContactChangeSource[],
  session: ClientSession,
  now: Date,
  deps: ContactChangeDeps = {},
): Promise<Array<{ job_id: string; created: boolean }>> {
  if (!sources.length) return [];
  if (!(await (deps.wanted ?? deskWantsContactEvidence)(session))) return [];
  const enqueue = deps.enqueue ?? enqueueCsiJob;
  const out: Array<{ job_id: string; created: boolean }> = [];
  for (const source of sources) {
    const row = await enqueue(
      {
        dedupe_key: contactChangeDedupeKey(source),
        stage: OUTREACH_CONTACT_CHANGE_STAGE,
        subject_key: contactChangeSubjectKey(source),
        input_revision: 1,
        input_refs: [source.source_id],
        priority: 20,
      },
      session,
      now,
    );
    // `enqueueCsiJob` is insert-only and stamps `createdAt: now` on insert, so a row created by
    // this call carries exactly this call's instant; an existing duplicate keeps its own.
    const created = (row as { createdAt?: Date }).createdAt?.getTime() === now.getTime();
    out.push({ job_id: String(row._id), created });
  }
  return out;
}

export type WakeOutcome =
  | { status: "skipped"; reason: "nothing_touched" | "not_wanted" }
  | { status: "enqueued"; jobs: number; created: number; published: number }
  | { status: "failed"; error_name: string };

/**
 * Post-commit wake in its own transaction (Call Log ISync batches, window reconcile, SMS evidence).
 * Never throws.
 */
export async function wakeOutreachContactChange(
  sources: readonly ContactChangeSource[],
  deps: ContactChangeDeps = {},
): Promise<WakeOutcome> {
  if (!sources.length) return { status: "skipped", reason: "nothing_touched" };
  try {
    if (!(await (deps.wanted ?? deskWantsContactEvidence)())) return { status: "skipped", reason: "not_wanted" };
    const now = (deps.now ?? (() => new Date()))();
    const transaction = deps.transaction ?? withTransaction;
    const jobs = await transaction((session) =>
      enqueueOutreachContactChangeJobs(sources, session, now, { ...deps, wanted: async () => true }),
    );
    const createdIds = jobs.filter((j) => j.created).map((j) => j.job_id);
    const published = createdIds.length
      ? await (deps.publish ?? ((ids: readonly string[]) => publishRunnableWakeups(ids)))(createdIds)
      : { published: 0 };
    return {
      status: "enqueued",
      jobs: jobs.length,
      created: createdIds.length,
      published: Number((published as { published?: number } | null)?.published ?? 0),
    };
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "Error";
    logger.warn({ msg: "sales_outreach.contact_change.wake_failed", sources: sources.length, errorName });
    return { status: "failed", error_name: errorName };
  }
}

/** The reconcile / ISync lane seam: wake for the rows one batch changed. */
export function wakeOutreachForTouchedCalls(touched: readonly TouchedInteraction[]): Promise<WakeOutcome> {
  return wakeOutreachContactChange(sourcesFromTouchedCalls(touched));
}
