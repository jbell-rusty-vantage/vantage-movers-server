import { createHash, randomBytes } from "node:crypto";
import {
  CSI_FLAGS,
  csiBootstrapNumbers,
  csiFlag,
  csiProviderConfiguration,
} from "../../config/domain/salesIntelligence";
import { getSalesIntelligencePolicyPointerModel } from "../../models/SalesIntelligencePolicyPointer";
import { getSalesIntelligencePolicyVersionModel } from "../../models/SalesIntelligencePolicyVersion";
import { csiSettingsCommandSchema } from "../../validation/v1/salesIntelligence";
import { CsiError, type CsiActor } from "./auth";
import { csiSettingsReadDtoSchema, type CsiSettingsReadDto } from "./dto";
import { defaultCsiPolicy, initializeCsiPolicy, updateCsiPolicy } from "./policy";

export function nextPolicyVersion(now = new Date()) {
  return `csi-policy-${now.toISOString()}-${randomBytes(4).toString("hex")}`;
}

/** Stable per Idempotency-Key so a lost-response retry does not rewrite the payload hash. */
export function policyVersionForCommand(idempotency_key: string) {
  return `csi-policy-${createHash("sha256").update(idempotency_key).digest("hex").slice(0, 24)}`;
}

export function displayFlags() {
  return Object.fromEntries(CSI_FLAGS.map((flag) => [flag, csiFlag(flag)])) as Record<
    (typeof CSI_FLAGS)[number],
    boolean
  >;
}

export function displayModels() {
  const config = csiProviderConfiguration();
  return {
    extraction: { name: config.extractionModel, enabled: csiFlag("EXTRACTION_ENABLED") },
    transcription: { name: config.transcriptionModel, enabled: csiFlag("STT_ENABLED") },
  };
}

export async function readCsiSettings(): Promise<CsiSettingsReadDto> {
  const flags = displayFlags();
  const models = displayModels();
  const pointer = await getSalesIntelligencePolicyPointerModel().findOne({ key: "active" }).lean();
  if (!pointer) {
    return csiSettingsReadDtoSchema.parse({
      persisted: false,
      revision: 1,
      source: "accepted_defaults",
      policy: { ...defaultCsiPolicy(), ...csiBootstrapNumbers() },
      flags,
      models,
      updated_at: null,
      updated_by: null,
    });
  }
  const row = await getSalesIntelligencePolicyVersionModel().findOne({ version: pointer.version }).lean();
  if (!row) throw new CsiError("INVALID_INPUT");
  return csiSettingsReadDtoSchema.parse({
    persisted: true,
    revision: pointer.revision,
    source: "persisted",
    policy: row.policy,
    flags,
    models,
    updated_at: row.effective_at.toISOString(),
    updated_by: row.actor?.id ?? null,
  });
}

export async function commandCsiSettings(input: {
  actor: CsiActor;
  idempotency_key: string;
  command: unknown;
}) {
  const body = csiSettingsCommandSchema.parse(input.command);
  const policy = { ...body.policy, version: policyVersionForCommand(input.idempotency_key) };
  const pointer = await getSalesIntelligencePolicyPointerModel().findOne({ key: "active" }).lean();
  if (!pointer) {
    if (body.expected_revision !== 1) throw new CsiError("REVISION_CONFLICT");
    const initialized = await initializeCsiPolicy({
      actor: input.actor,
      idempotency_key: `${input.idempotency_key}:initialize`,
    });
    return updateCsiPolicy({
      actor: input.actor,
      idempotency_key: input.idempotency_key,
      expected_revision: initialized.response.revision,
      policy,
    });
  }
  return updateCsiPolicy({
    actor: input.actor,
    idempotency_key: input.idempotency_key,
    expected_revision: body.expected_revision,
    policy,
  });
}
