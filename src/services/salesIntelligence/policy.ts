import {
  csiPolicySchema,
  csiStoredPolicySchema,
  withRetiredPolicyFields,
  type CsiPolicy,
} from "../../validation/v1/salesIntelligence";
import { SALES_INTELLIGENCE_POLICY_VERSION } from "../../config/domain/salesIntelligence";
import { getSalesIntelligencePolicyVersionModel } from "../../models/SalesIntelligencePolicyVersion";
import { getSalesIntelligencePolicyPointerModel } from "../../models/SalesIntelligencePolicyPointer";
import { executeCsiCommand, appendCsiAudit, csiCas } from "./transactions";
import { CsiError, type CsiActor } from "./auth";
import type { ClientSession } from "mongoose";
/** Accepted defaults before the Owner installs a policy. */
export function defaultCsiPolicy(): CsiPolicy {
  return csiPolicySchema.parse({
    version: SALES_INTELLIGENCE_POLICY_VERSION,
    timezone: "America/New_York",
    staffed_hours: [1, 2, 3, 4, 5, 6].map((day) => ({
      day,
      start_minute: 480,
      end_minute: 1200,
    })),
    enabled_capabilities: [],
    retention: { audit_days: 730 },
  });
}
/** The active policy, or the defaults when none is installed. Never writes. */
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
  return csiStoredPolicySchema.parse(row.policy);
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
      const Version = getSalesIntelligencePolicyVersionModel();
      // Rollback safety (SLIM-09): carry the retired fields of the active version forward, so a
      // pre-slimming build's strict policy reader still parses the version written here.
      const previous = await Version.findOne({ version: current.version })
        .session(context.session)
        .lean();
      await Version.create(
        [
          {
            version: policy.version,
            policy: withRetiredPolicyFields(policy, previous?.policy),
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
      const policy = defaultCsiPolicy();
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
