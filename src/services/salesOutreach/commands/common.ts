import mongoose, { type ClientSession } from "mongoose";
import { logger } from "../../../logger";
import { publishRunnableWakeups } from "../../numberActivity/webhookFanout";
import type { appendCsiAudit, executeCsiCommand } from "../../salesIntelligence/transactions";
import type { OutreachActor } from "../auth";
import { salesOutreachConfigurationLoader, type ActiveConfiguration, type ConfigurationLoader } from "../config/load";
import { BusinessCalendar, type EnginePolicy } from "../engine";
import { OutreachError } from "../errors";
import { publishOutreachLive, type OutreachLivePublication } from "../live/publish";
import { deskEnginePolicy } from "../evaluation/policyAdapter";
import type { DeskPlanRow } from "../evaluation/store";
import type { DeskSubjectRow } from "../subjects/store";
import { mongoDeskCommandStore, type DeskCommandStore, type LeadAssignment } from "./store";

/** Shared seams of the desk commands (SRV-7). Tests inject in-memory stand-ins for every one. */
export type DeskCommandDeps = {
  loader?: ConfigurationLoader;
  store?: DeskCommandStore;
  run?: typeof executeCsiCommand;
  audit?: typeof appendCsiAudit;
  /** After-commit wake of the jobs a command created (Vercel Queue publish); never throws into the command. */
  publish?: (jobIds: readonly string[]) => Promise<unknown>;
  /** After-commit live invalidation (`GET /live`); never throws into the command. */
  publishLive?: typeof publishOutreachLive;
};

/** Publishes a committed desk command's live invalidations (ids and revisions only). */
export async function publishCommandLive(publications: readonly OutreachLivePublication[], deps: DeskCommandDeps): Promise<void> {
  if (!publications.length) return;
  await (deps.publishLive ?? publishOutreachLive)(publications);
}

export const subjectAuditKey = (subjectId: string) => `outreach-subject:${subjectId}`;

/**
 * The active configuration for a desk command, read inside the command transaction (CONTRACTS load
 * semantics: the pointer is re-read at every command). `desk` commands also need `desk_enabled`;
 * Owner settings commands (restrictions, day overrides) stay available while the desk is muted.
 */
export async function requireCommandConfiguration(
  loader: ConfigurationLoader,
  session: ClientSession,
  options: { desk: boolean },
): Promise<ActiveConfiguration> {
  const configuration = await loader.requireActive(session);
  if (options.desk && !configuration.value.controls.desk_enabled)
    throw new OutreachError("CONFIGURATION_UNAVAILABLE", [{ path: "controls.desk_enabled", code: "desk_disabled" }]);
  return configuration;
}

/** The engine policy a planning command validates against; an unresolvable cadence fails closed (503). */
export function requireCommandPolicy(configuration: ActiveConfiguration): { policy: EnginePolicy; calendar: BusinessCalendar } {
  const resolved = deskEnginePolicy(configuration.value);
  if (!resolved.ok)
    throw new OutreachError(
      "CONFIGURATION_UNAVAILABLE",
      resolved.reasons.slice(0, 20).map((reason) => ({ path: "cadence", code: "policy_unavailable", message: reason.slice(0, 200) })),
    );
  return { policy: resolved.policy, calendar: new BusinessCalendar(resolved.policy.calendar) };
}

/**
 * Loads the subject a command targets and authorizes the actor for it (CONTRACTS "current-assignment
 * scope"). Owner and Manager reach any subject; a Rep only a subject whose Lead's `receiver_agent` —
 * the authoritative assignment, re-read here at the command boundary — is its own Agent. An absent,
 * malformed or foreign id is the same 404 (no existence leak).
 */
export async function authorizedSubject(
  actor: OutreachActor,
  subjectId: string,
  store: DeskCommandStore,
  session: ClientSession,
): Promise<{ subject: DeskSubjectRow; lead: LeadAssignment | null }> {
  if (!mongoose.isValidObjectId(subjectId) || !/^[a-f\d]{24}$/i.test(subjectId)) throw new OutreachError("NOT_FOUND");
  const subject = await store.loadSubject(subjectId, session);
  if (!subject) throw new OutreachError("NOT_FOUND");
  const lead = await store.loadLeadAssignment(subject.lead, session);
  if (actor.role === "rep" && (!actor.agent_id || lead?.receiver_agent_id !== actor.agent_id)) throw new OutreachError("NOT_FOUND");
  return { subject, lead };
}

/** The subject's shared human-plan revision (P06f: Quoted dates and callbacks serialize on it). */
export const planRevisionOf = (plans: readonly DeskPlanRow[]) => plans.reduce((max, p) => Math.max(max, p.revision), 0);

export const activePlanOf = (plans: readonly DeskPlanRow[]) => plans.find((p) => p.status === "active") ?? null;

/** Publishes the wake-ups of the jobs a committed command created. Logged, never thrown. */
export async function wakeCommandJobs(jobIds: readonly string[], publish?: DeskCommandDeps["publish"]): Promise<void> {
  if (!jobIds.length) return;
  try {
    await (publish ?? ((ids: readonly string[]) => publishRunnableWakeups(ids)))(jobIds);
  } catch (error) {
    logger.warn({ msg: "sales_outreach.command.wake_failed", jobs: jobIds.length, errorName: error instanceof Error ? error.name : "Error" });
  }
}

export const commandLoader = (deps: DeskCommandDeps) => deps.loader ?? salesOutreachConfigurationLoader;
export const commandStore = (deps: DeskCommandDeps) => deps.store ?? mongoDeskCommandStore;

/** New York business date and minute of an instant (display of an appointment, P06e). */
export function newYorkLocal(calendar: BusinessCalendar, at: Date) {
  return { business_date: calendar.dateOf(+at), minute: calendar.minuteOf(+at) };
}
