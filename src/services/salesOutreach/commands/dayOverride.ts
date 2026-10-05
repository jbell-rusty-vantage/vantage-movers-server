import { SALES_OUTREACH_COMMAND_KINDS, SALES_OUTREACH_CONTRACT_VERSION } from "../../../config/domain/salesOutreach";
import { salesOutreachConfigurationValueSchema } from "../../../validation/v1/salesOutreach";
import type { SalesOutreachDayOverrideResponse } from "../../../validation/v1/salesOutreachCommands";
import { CsiError } from "../../salesIntelligence/auth";
import { appendCsiAudit, duplicateKey, executeCsiCommand } from "../../salesIntelligence/transactions";
import type { OutreachActor } from "../auth";
import {
  configurationContentHash,
  configurationVersionFor,
  mongoConfigurationStore,
  mongoConfigurationWriter,
  type ConfigurationStore,
  type ConfigurationWriter,
} from "../config/store";
import { OutreachError, zodIssues } from "../errors";
import { newYorkBusinessDay } from "../reads/businessDay";
import { commandLoader, type DeskCommandDeps } from "./common";

/**
 * `PATCH /goals/:agent_id/day-override` — Owner, or Manager prospectively (P08a, P09b).
 *
 * One effective-dated goal for one roster rep and New York date: `absence` (goal 0) or `partial_day`
 * (an explicit reduced goal). The override lives in the persisted configuration
 * (`goals.effective_day_overrides`), so the command writes a new immutable configuration version and
 * moves the pointer with `expected_revision` CAS — its own command kind and audit event, never the
 * general configuration edit. A Manager may set today or a future date only; a past date is a
 * historical edit, Owner-only. The base roster, schedules and default goal are untouched.
 */

type DayOverrideResult = Omit<SalesOutreachDayOverrideResponse, "replayed">;

export type DayOverrideDeps = DeskCommandDeps & { configStore?: ConfigurationStore; writer?: ConfigurationWriter };

export type DayOverrideInput = Readonly<{
  actor: OutreachActor;
  agent_id: string;
  idempotency_key: string;
  expected_revision: number;
  business_date: string;
  goal: number;
  reason: "absence" | "partial_day";
}>;

export async function setGoalDayOverride(input: DayOverrideInput, deps: DayOverrideDeps = {}): Promise<SalesOutreachDayOverrideResponse> {
  if (input.actor.role === "rep") throw new OutreachError("FORBIDDEN");
  const agentId = input.agent_id.toLowerCase();
  const loader = commandLoader(deps);
  const writer = deps.writer ?? mongoConfigurationWriter;
  const store = deps.configStore ?? mongoConfigurationStore;
  try {
    const { response, replayed } = await (deps.run ?? executeCsiCommand)<DayOverrideResult>({
      actor: input.actor.actor,
      command: SALES_OUTREACH_COMMAND_KINDS.goal_day_override,
      idempotency_key: input.idempotency_key,
      payload: { agent_id: agentId, expected_revision: input.expected_revision, business_date: input.business_date, goal: input.goal, reason: input.reason },
      operation: async (context) => {
        const configuration = await loader.requireActive(context.session);
        if (configuration.revision !== input.expected_revision) throw new CsiError("REVISION_CONFLICT");
        const goals = configuration.value.goals;
        if (!goals.rep_work_schedules)
          throw new OutreachError("CONFIGURATION_UNAVAILABLE", [{ path: "goals.rep_work_schedules", code: "goals_not_installed" }]);
        if (!goals.rep_work_schedules.some((r) => r.agent_id === agentId))
          throw new OutreachError("INVALID_INPUT", [{ path: "agent_id", code: "agent_not_on_roster" }]);
        if (input.actor.role === "manager" && input.business_date < newYorkBusinessDay(context.now))
          throw new OutreachError("FORBIDDEN", [{ path: "business_date", code: "historical_edit_owner_only" }]);
        const overrides = goals.effective_day_overrides ?? [];
        const existing = overrides.find((o) => o.agent_id === agentId && o.business_date === input.business_date) ?? null;
        const previous = existing ? { goal: existing.goal, reason: existing.reason } : null;
        const override = { goal: input.goal, reason: input.reason };
        const base = {
          contract_version: SALES_OUTREACH_CONTRACT_VERSION,
          agent_id: agentId,
          business_date: input.business_date,
          override,
          previous,
        };
        if (existing && existing.goal === input.goal && existing.reason === input.reason)
          return { ...base, revision: configuration.revision, version: configuration.version, changed: false };

        const nextOverrides = [
          ...overrides.filter((o) => !(o.agent_id === agentId && o.business_date === input.business_date)),
          { agent_id: agentId, business_date: input.business_date, goal: input.goal, reason: input.reason },
        ].sort((a, b) => a.business_date.localeCompare(b.business_date) || a.agent_id.localeCompare(b.agent_id));
        const parsed = salesOutreachConfigurationValueSchema.safeParse({ ...configuration.value, goals: { ...goals, effective_day_overrides: nextOverrides } });
        if (!parsed.success) throw new OutreachError("INVALID_INPUT", zodIssues(parsed.error));
        const value = parsed.data;
        const content_hash = configurationContentHash(value);
        const version = configurationVersionFor(`${context.actor.kind}:${context.actor.id}:day-override`, input.idempotency_key);
        const pointer = await store.readPointer(context.session);
        if (!pointer || pointer.revision !== input.expected_revision) throw new CsiError("REVISION_CONFLICT");
        await writer.insertVersion({ version, value, content_hash, approval_ref: value.cadence.approval_ref, actor: context.actor }, context.session);
        const moved = await writer.movePointer(
          { expected_revision: pointer.revision, version, content_hash, updated_by: context.actor.id },
          context.session,
        );
        if (!moved) throw new CsiError("REVISION_CONFLICT");
        const revision = pointer.revision + 1;
        await (deps.audit ?? appendCsiAudit)(context, {
          subject_key: "sales_outreach_configuration:active",
          event_kind: "sales_outreach_goal_day_override_set",
          prior: { agent_id: agentId, business_date: input.business_date, override: previous, version: pointer.version, revision: pointer.revision },
          current: { agent_id: agentId, business_date: input.business_date, override, version, revision, actor_role: input.actor.role },
          target_id: pointer.id,
          revision,
          kind: "policy",
        });
        return { ...base, revision, version, changed: true };
      },
    });
    return { ...response, replayed };
  } catch (error) {
    if (duplicateKey(error)) throw new OutreachError("REVISION_CONFLICT");
    throw error;
  }
}
