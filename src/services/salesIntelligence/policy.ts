import {
  csiPolicySchema,
  type CsiPolicy,
} from "../../validation/v1/salesIntelligence";
import {
  SALES_INTELLIGENCE_POLICY_VERSION,
  csiBootstrapNumbers,
  csiDataset,
} from "../../config/domain/salesIntelligence";
import { getSalesIntelligencePolicyVersionModel } from "../../models/SalesIntelligencePolicyVersion";
import { getSalesIntelligencePolicyPointerModel } from "../../models/SalesIntelligencePolicyPointer";
import { getSalesIntelligenceAiBudgetModel } from "../../models/SalesIntelligenceAiBudget";
import { getSalesIntelligenceJobModel } from "../../models/SalesIntelligenceJob";
import { executeCsiCommand, appendCsiAudit, csiCas } from "./transactions";
import { CsiError, type CsiActor } from "./auth";
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
export async function resolvePolicy(): Promise<CsiPolicy> {
  const pointer = await getSalesIntelligencePolicyPointerModel()
    .findOne({ key: "active" })
    .lean();
  if (!pointer) return defaultCsiPolicy();
  const row = await getSalesIntelligencePolicyVersionModel()
    .findOne({ version: pointer.version })
    .lean();
  if (!row) throw new CsiError("INVALID_INPUT");
  return csiPolicySchema.parse(row.policy);
}
export async function updateCsiPolicy(input: {
  actor: CsiActor;
  idempotency_key: string;
  expected_revision: number;
  policy: CsiPolicy;
}) {
  const policy = csiPolicySchema.parse(input.policy);
  return executeCsiCommand({
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
      if (policy.monthly_ceiling_cents > previousPolicy.monthly_ceiling_cents)
        await getSalesIntelligenceJobModel().updateMany(
          { ...csiDataset(), status: "paused", reason: "budget_exhausted" },
          { $set: { status: "pending", next_attempt_at: context.now } },
          { session: context.session },
        );
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
