import { SALES_OUTREACH_COMMAND_KINDS } from "../../../config/domain/salesOutreach";
import { salesOutreachConfigurationValueSchema } from "../../../validation/v1/salesOutreach";
import { CsiError, type CsiActor } from "../../salesIntelligence/auth";
import { appendCsiAudit, duplicateKey, executeCsiCommand } from "../../salesIntelligence/transactions";
import { OutreachError, zodIssues } from "../errors";
import { publishOutreachLive } from "../live/publish";
import {
  configurationContentHash,
  configurationVersionFor,
  mongoConfigurationStore,
  mongoConfigurationWriter,
  type ConfigurationStore,
  type ConfigurationWriter,
} from "./store";

/** Registered command kind in the CSI command ledger (never a legacy name). */
export const SALES_OUTREACH_CONFIGURATION_COMMAND = SALES_OUTREACH_COMMAND_KINDS.configuration_update;

export type ConfigurationPatchResult = {
  revision: number;
  version: string;
  content_hash: string;
  changed: boolean;
};

export type ConfigurationCommandDeps = {
  run?: typeof executeCsiCommand;
  store?: ConfigurationStore;
  writer?: ConfigurationWriter;
  audit?: typeof appendCsiAudit;
  /** After-commit live publish (tests inject a recorder). */
  publishLive?: typeof publishOutreachLive;
};

/**
 * PATCH /configuration (CONTRACTS): full replacement of the validated value with `expected_revision`
 * (0 = explicit Owner initialization, which creates the pointer at revision 1) and an
 * Idempotency-Key. The new immutable version, the pointer CAS, the audit event and the command
 * ledger row commit in one transaction. A replay returns the original committed result; the same
 * key with a different payload is `IDEMPOTENCY_CONFLICT`. Submitting the value that is already
 * active writes no version, pointer move or audit (`changed: false`).
 *
 * The caller has already authorized the actor (Owner only, `configuration_edit`).
 */
export async function patchSalesOutreachConfiguration(
  input: { actor: CsiActor; idempotency_key: string; expected_revision: number; value: unknown },
  deps: ConfigurationCommandDeps = {},
): Promise<{ response: ConfigurationPatchResult; replayed: boolean }> {
  if (!Number.isSafeInteger(input.expected_revision) || input.expected_revision < 0) throw new OutreachError("INVALID_INPUT");
  const parsed = salesOutreachConfigurationValueSchema.safeParse(input.value);
  if (!parsed.success) throw new OutreachError("INVALID_INPUT", zodIssues(parsed.error));
  const value = parsed.data;
  const content_hash = configurationContentHash(value);
  const version = configurationVersionFor(`${input.actor.kind}:${input.actor.id}`, input.idempotency_key);
  const store = deps.store ?? mongoConfigurationStore;
  const writer = deps.writer ?? mongoConfigurationWriter;
  const audit = deps.audit ?? appendCsiAudit;
  try {
    const committed = await (deps.run ?? executeCsiCommand)<ConfigurationPatchResult>({
      actor: input.actor,
      command: SALES_OUTREACH_CONFIGURATION_COMMAND,
      idempotency_key: input.idempotency_key,
      payload: { expected_revision: input.expected_revision, value },
      operation: async (context) => {
        const pointer = await store.readPointer(context.session);
        if ((pointer?.revision ?? 0) !== input.expected_revision) throw new CsiError("REVISION_CONFLICT");
        if (pointer && pointer.content_hash === content_hash)
          return { revision: pointer.revision, version: pointer.version, content_hash, changed: false };
        await writer.insertVersion(
          { version, value, content_hash, approval_ref: value.cadence.approval_ref, actor: context.actor },
          context.session,
        );
        let revision: number;
        let target_id: string;
        if (!pointer) {
          const created = await writer.createPointer({ version, content_hash, updated_by: context.actor.id }, context.session);
          revision = created.revision;
          target_id = created.id;
        } else {
          const moved = await writer.movePointer(
            { expected_revision: pointer.revision, version, content_hash, updated_by: context.actor.id },
            context.session,
          );
          if (!moved) throw new CsiError("REVISION_CONFLICT");
          revision = pointer.revision + 1;
          target_id = pointer.id;
        }
        await audit(context, {
          subject_key: "sales_outreach_configuration:active",
          event_kind: pointer ? "sales_outreach_configuration_changed" : "sales_outreach_configuration_initialized",
          prior: pointer ? { version: pointer.version, revision: pointer.revision, content_hash: pointer.content_hash } : {},
          current: { version, revision, content_hash, approval_ref: value.cadence.approval_ref },
          target_id,
          revision,
          kind: "policy",
        });
        return { revision, version, content_hash, changed: true };
      },
    });
    // After commit: every desk viewer refetches capabilities and configuration-derived reads.
    if (!committed.replayed && committed.response.changed)
      await (deps.publishLive ?? publishOutreachLive)({ topic: "outreach_configuration", revision: committed.response.revision, cause: "configuration" });
    return committed;
  } catch (error) {
    // A concurrent initialization (unique pointer key) lost the race: the Owner must re-read.
    if (duplicateKey(error)) throw new OutreachError("REVISION_CONFLICT");
    throw error;
  }
}
