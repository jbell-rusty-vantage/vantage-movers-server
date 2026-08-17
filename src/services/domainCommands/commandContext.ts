import type { ObservationChannel } from "../granotLifecycle/types";
import { DomainCommandContextError } from "./types";
import type { CanonicalCommandContext } from "./types";
import {
  GRANOT_LIFECYCLE_PROCESSOR_ACTOR_ID,
  GRANOT_LIFECYCLE_PROCESSOR_ACTOR_LABEL,
  GRANOT_WEBHOOK_INITIATOR_ID,
  RINGCENTRAL_CALL_INGEST_ACTOR_ID,
} from "./types";
import { verifyTrustedRingCentralTelephonyProvenance } from "./ringcentralProvenance";

const OBSERVATION_CHANNELS = new Set<ObservationChannel>([
  "granot_webhook",
  "browser_extension",
  "granot_http_automation",
]);

export type CommandContextVerifier = {
  verifyRingCentralTelephony: (input: {
    source_receipt_id: string | null;
    source_connection_key: string | null;
  }) => Promise<boolean>;
};

const defaultVerifier: CommandContextVerifier = {
  verifyRingCentralTelephony: verifyTrustedRingCentralTelephonyProvenance,
};

export async function assertCommandContext(
  context: CanonicalCommandContext,
  verifier: CommandContextVerifier = defaultVerifier,
): Promise<void> {
  if (
    !context.command_id.trim() ||
    !context.idempotency_key.trim() ||
    !/^[a-f0-9]{64}$/i.test(context.payload_checksum)
  ) {
    throw new DomainCommandContextError(
      "Command id, idempotency key, and SHA-256 payload checksum are required.",
    );
  }

  switch (context.provenance.origin) {
    case "external_sheet_ingestion":
      assertExternalSheetIngestionContext(context);
      return;
    case "vantage_admin":
      assertVantageAdminContext(context);
      return;
    case "granot_lifecycle":
      assertGranotLifecycleContext(context);
      return;
    case "ringcentral":
      await assertRingCentralContext(context, verifier);
      return;
    default:
      throw new DomainCommandContextError(
        "Unsupported command origin.",
      );
  }
}

function assertExternalSheetIngestionContext(
  context: CanonicalCommandContext,
): void {
  if (
    context.actor.actor_type !== "system" ||
    context.actor.actor_id !== "best-relocation-ingestion" ||
    context.actor.actor_role !== "system" ||
    context.actor.origin !== "external_sheet_ingestion" ||
    !isTrustedHumanActor(context.initiator, "vantage_admin") ||
    !context.provenance.run_id ||
    !context.provenance.source_receipt_id ||
    !context.provenance.source_connection_key
  ) {
    throw new DomainCommandContextError(
      "External ingestion commands require the dedicated ingestion actor, a trusted human initiator, and complete source provenance.",
    );
  }
}

function assertVantageAdminContext(context: CanonicalCommandContext): void {
  if (
    !isTrustedHumanActor(context.actor, "vantage_admin") ||
    !isTrustedHumanActor(context.initiator, "vantage_admin")
  ) {
    throw new DomainCommandContextError(
      "Admin commands require trusted owner/admin actor and initiator snapshots.",
    );
  }
}

function assertGranotLifecycleContext(context: CanonicalCommandContext): void {
  if (!isGranotLifecycleProcessorActor(context.actor)) {
    throw new DomainCommandContextError(
      "Granot lifecycle commands require the fixed processor system actor.",
    );
  }
  const receiptId = nonblank(context.provenance.source_receipt_id);
  const observationId = nonblank(context.provenance.observation_id);
  const decisionId = nonblank(context.provenance.decision_id);
  if (!receiptId || !observationId || !decisionId) {
    throw new DomainCommandContextError(
      "Granot lifecycle commands require nonblank receipt, Observation, and Decision IDs.",
    );
  }
  if (
    context.actor.request_id !== receiptId ||
    context.provenance.source_receipt_id !== context.actor.request_id
  ) {
    throw new DomainCommandContextError(
      "Granot lifecycle source_receipt_id must match the processor request ID.",
    );
  }
  const channel = context.provenance.observation_channel;
  if (!channel || !OBSERVATION_CHANNELS.has(channel)) {
    throw new DomainCommandContextError(
      "Granot lifecycle commands require an Observation Channel that agrees with the initiator path.",
    );
  }
  if (isGranotWebhookInitiator(context.initiator, receiptId)) {
    if (channel !== "granot_webhook") {
      throw new DomainCommandContextError(
        "Webhook-initiated lifecycle commands require observation_channel granot_webhook.",
      );
    }
    return;
  }
  if (isTrustedOwnerActor(context.initiator, "browser_extension")) {
    if (channel !== "browser_extension") {
      throw new DomainCommandContextError(
        "Browser-extension-initiated lifecycle commands require observation_channel browser_extension.",
      );
    }
    return;
  }
  if (isTrustedHumanActor(context.initiator, "vantage_admin")) {
    return;
  }
  throw new DomainCommandContextError(
    "Granot lifecycle commands require the webhook system initiator or a server-authenticated Owner.",
  );
}

async function assertRingCentralContext(
  context: CanonicalCommandContext,
  verifier: CommandContextVerifier,
): Promise<void> {
  if (
    !isRingCentralCallIngestActor(context.actor) ||
    !isRingCentralCallIngestActor(context.initiator)
  ) {
    throw new DomainCommandContextError(
      "RingCentral commands require the fixed ringcentral-call-ingest system actor and initiator.",
    );
  }
  const verified = await verifier.verifyRingCentralTelephony({
    source_receipt_id: context.provenance.source_receipt_id,
    source_connection_key: context.provenance.source_connection_key,
  });
  if (!verified) {
    throw new DomainCommandContextError(
      "RingCentral commands require server-verified telephony provenance.",
    );
  }
}

function isGranotLifecycleProcessorActor(
  actor: CanonicalCommandContext["actor"],
): boolean {
  return (
    actor.actor_type === "system" &&
    actor.actor_id === GRANOT_LIFECYCLE_PROCESSOR_ACTOR_ID &&
    actor.actor_label === GRANOT_LIFECYCLE_PROCESSOR_ACTOR_LABEL &&
    actor.actor_role === "system" &&
    actor.origin === "granot_lifecycle" &&
    Boolean(actor.request_id.trim())
  );
}

function isGranotWebhookInitiator(
  actor: CanonicalCommandContext["actor"],
  receiptId: string,
): boolean {
  return (
    actor.actor_type === "system" &&
    actor.actor_id === GRANOT_WEBHOOK_INITIATOR_ID &&
    actor.actor_role === "system" &&
    actor.origin === "granot_lifecycle" &&
    actor.request_id === receiptId
  );
}

function isRingCentralCallIngestActor(
  actor: CanonicalCommandContext["actor"],
): boolean {
  return (
    actor.actor_type === "system" &&
    actor.actor_id === RINGCENTRAL_CALL_INGEST_ACTOR_ID &&
    actor.actor_role === "system" &&
    actor.origin === "ringcentral" &&
    Boolean(actor.request_id.trim())
  );
}

function isTrustedHumanActor(
  actor: CanonicalCommandContext["actor"],
  origin: "vantage_admin" | "browser_extension",
): boolean {
  return (
    (actor.actor_type === "owner" || actor.actor_type === "admin") &&
    actor.actor_role === actor.actor_type &&
    actor.origin === origin &&
    Boolean(actor.actor_id.trim()) &&
    Boolean(actor.request_id.trim())
  );
}

function isTrustedOwnerActor(
  actor: CanonicalCommandContext["actor"],
  origin: "browser_extension",
): boolean {
  return (
    actor.actor_type === "owner" &&
    actor.actor_role === "owner" &&
    actor.origin === origin &&
    Boolean(actor.actor_id.trim()) &&
    Boolean(actor.request_id.trim())
  );
}

function nonblank(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
