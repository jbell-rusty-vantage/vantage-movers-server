import {
  csiPolicySchema,
  CSI_POLICY_EVOLUTION_DEFAULTS,
  type CsiPolicy,
} from "../../validation/v1/salesIntelligence";
import {
  SALES_INTELLIGENCE_POLICY_VERSION,
  csiBootstrapNumbers,
  csiDataset,
  csiFlag,
} from "../../config/domain/salesIntelligence";
import { getSalesIntelligencePolicyVersionModel } from "../../models/SalesIntelligencePolicyVersion";
import { getSalesIntelligencePolicyPointerModel } from "../../models/SalesIntelligencePolicyPointer";
import { getSalesIntelligenceAiBudgetModel } from "../../models/SalesIntelligenceAiBudget";
import { CSI_WAKEUP_PUBLISH_LIMIT } from "./aiBudget";
import { getSalesIntelligenceJobModel } from "../../models/SalesIntelligenceJob";
import { executeCsiCommand, appendCsiAudit, csiCas } from "./transactions";
import { publishRunnableWakeups } from "../numberActivity/webhookFanout";
import { CsiError, type CsiActor } from "./auth";
import type { ClientSession } from "mongoose";
export function defaultCsiPolicy(): CsiPolicy {
  return csiPolicySchema.parse({
    version: SALES_INTELLIGENCE_POLICY_VERSION,
    timezone: "America/New_York",
    staffed_hours: [1, 2, 3, 4, 5, 6].map((day) => ({
      day,
      start_minute: 480,
      end_minute: 1200,
    })),
    first_action_due_staffed_minutes: 30,
    missed_callback_due_staffed_minutes: 15,
    going_cold_staffed_minutes: 1440,
    monthly_ceiling_cents: 8000,
    per_recording_ceiling_cents: 25,
    cooldown_attempts_24h: 3,
    enabled_capabilities: [],
    retention: { audio_days: 90, redacted_days: 365, audit_days: 730 },
  });
}
export async function resolvePolicy(session?: ClientSession): Promise<CsiPolicy> {
  const pointer = await getSalesIntelligencePolicyPointerModel()
    .findOne({ key: "active" })
    .session(session ?? null)
    .lean();
  if (!pointer) return defaultCsiPolicy();
  const row = await getSalesIntelligencePolicyVersionModel()
    .findOne({ version: pointer.version })
    .session(session ?? null)
    .lean();
  if (!row) throw new CsiError("INVALID_INPUT");
  return csiPolicySchema.parse(row.policy);
}
/**
 * V-AC S5 (2026-09-24): the seven Attention-evolution policy fields may be stored only while
 * SALES_INTELLIGENCE_ATTENTION_EVOLUTION is on. A policy stored with them is rejected by the strict
 * `csiPolicySchema` of any build before this one (`01bcf18`), so persisting them with the flag off would
 * make a code rollback stop every policy read. Rejected (not stripped) so the caller sees why its value
 * was not kept. Pure; the flag is passed in.
 */
export function assertEvolutionPolicyWritable(policy: Partial<Record<keyof typeof CSI_POLICY_EVOLUTION_DEFAULTS, unknown>>, evolutionEnabled: boolean) {
  if (evolutionEnabled) return;
  const present = (Object.keys(CSI_POLICY_EVOLUTION_DEFAULTS) as (keyof typeof CSI_POLICY_EVOLUTION_DEFAULTS)[]).filter(key => policy[key] !== undefined);
  if (present.length) throw new CsiError("INVALID_INPUT", present.map(key => ({ path: `policy.${key}`, code: "requires_attention_evolution" })));
}
export async function updateCsiPolicy(input: {
  actor: CsiActor;
  idempotency_key: string;
  expected_revision: number;
  policy: CsiPolicy;
}) {
  const policy = csiPolicySchema.parse(input.policy);
  assertEvolutionPolicyWritable(policy, csiFlag("ATTENTION_EVOLUTION"));
  // Jobs this change makes runnable, woken after the command commits. An
  // idempotent replay resumes nothing and so publishes nothing (22 §3).
  const resumed: string[] = [];
  const result = await executeCsiCommand({
    ...input,
    command: "update_settings",
    payload: { expected_revision: input.expected_revision, policy },
    operation: async (context) => {
      const Pointer = getSalesIntelligencePolicyPointerModel();
      const current = await Pointer.findOne({ key: "active" }).session(
        context.session,
      );
      if (!current || current.revision !== input.expected_revision)
        throw new CsiError("REVISION_CONFLICT");
      const previous = await getSalesIntelligencePolicyVersionModel()
        .findOne({ version: current.version })
        .session(context.session)
        .lean();
      if (!previous) throw new CsiError("INVALID_INPUT");
      const previousPolicy = csiPolicySchema.parse(previous.policy);
      await getSalesIntelligencePolicyVersionModel().create(
        [
          {
            version: policy.version,
            policy,
            actor: input.actor,
            effective_at: context.now,
          },
        ],
        { session: context.session },
      );
      await csiCas(
        Pointer,
        String(current._id),
        input.expected_revision,
        { version: policy.version },
        context.session,
      );
      await getSalesIntelligenceAiBudgetModel().updateMany(
        {
          period_start: { $lte: context.now },
          period_end: { $gt: context.now },
        },
        {
          $set: {
            ceiling_cents: policy.monthly_ceiling_cents,
            policy_version: policy.version,
          },
        },
        { session: context.session },
      );
      // Each pause reason resumes only on the change that can admit it again;
      // a monthly increase cannot help a job whose single invocation exceeds
      // the per-recording ceiling, and resuming it would only churn (17 §5).
      const resume: Array<"budget_exhausted" | "per_recording_ceiling"> = [];
      if (policy.monthly_ceiling_cents > previousPolicy.monthly_ceiling_cents) resume.push("budget_exhausted");
      if (policy.per_recording_ceiling_cents > previousPolicy.per_recording_ceiling_cents) resume.push("budget_exhausted", "per_recording_ceiling");
      if (resume.length) {
        const filter = { ...csiDataset(), status: "paused" as const, reason: { $in: [...new Set(resume)] } };
        for (const row of await getSalesIntelligenceJobModel()
          .find(filter, { _id: 1 })
          .sort({ _id: 1 })
          .limit(CSI_WAKEUP_PUBLISH_LIMIT)
          .session(context.session)
          .lean())
          resumed.push(String(row._id));
        await getSalesIntelligenceJobModel().updateMany(
          filter,
          { $set: { status: "pending", reason: null, next_attempt_at: context.now } },
          { session: context.session },
        );
      }
      await appendCsiAudit(context, {
        subject_key: "policy:active",
        event_kind: "policy_changed",
        prior: { version: current.version },
        current: { version: policy.version },
        target_id: String(current._id),
        revision: current.revision + 1,
        kind: "policy",
      });
      return { version: policy.version, revision: current.revision + 1 };
    },
  });
  await publishRunnableWakeups(resumed);
  return result;
}

/** First policy install is an explicit Owner mutation; GET/resolvePolicy never writes. */
export async function initializeCsiPolicy(input: {
  actor: CsiActor;
  idempotency_key: string;
}) {
  return executeCsiCommand({
    ...input,
    command: "initialize_settings",
    payload: {},
    operation: async (context) => {
      const Pointer = getSalesIntelligencePolicyPointerModel();
      const existing = await Pointer.findOne({ key: "active" }).session(
        context.session,
      );
      if (existing)
        return { version: existing.version, revision: existing.revision };
      const policy = csiPolicySchema.parse({
        ...defaultCsiPolicy(),
        ...csiBootstrapNumbers(),
      });
      await getSalesIntelligencePolicyVersionModel().create(
        [
          {
            version: policy.version,
            policy,
            actor: input.actor,
            effective_at: context.now,
          },
        ],
        { session: context.session },
      );
      const [pointer] = await Pointer.create(
        [{ key: "active", version: policy.version, revision: 1 }],
        { session: context.session },
      );
      await appendCsiAudit(context, {
        subject_key: "policy:active",
        event_kind: "policy_initialized",
        prior: {},
        current: { version: policy.version },
        target_id: String(pointer!._id),
        revision: 1,
        kind: "policy",
      });
      return { version: policy.version, revision: 1 };
    },
  });
}
