import { createHash } from "node:crypto";
import mongoose, { type ClientSession } from "mongoose";
import { getCallLeadModel } from "../../models/CallLead";
import { getFormLeadModel } from "../../models/FormLead";
import { createRingCentralCallIngestActor } from "../durableWork/actors";
import type { DurableActor } from "../durableWork/types";
import {
  CALL_LEAD_CHANGE_PATHS,
  collectDocumentFieldChanges,
  FORM_LEAD_CHANGE_PATHS,
  persistEntityChangeMutations,
} from "./entityChange";
import type { CanonicalCommandContext } from "./types";

/**
 * Lead `EntityChange` emission for Lead writes that run outside the canonical
 * command executor (LP-03 / H4): RingCentral Call Lead creation, the
 * employee-booking mirror/link/clear paths, the Booking source resolver and
 * the `form_fill` flip.
 *
 * These writes are not idempotent canonical commands. Each emission mints its
 * own `command_execution_id` (no `DomainCommandExecution` row is written); the
 * owning workflow keeps its own idempotency (processed-call store, submission
 * id, reconciliation case revision). The change is persisted in the caller's
 * session so it commits or rolls back with the Lead write, and the Lead's
 * `domain_revision` is stamped with the same CAS as canonical commands.
 *
 * A semantic no-op (no tracked path changed) emits nothing.
 */

export type LeadChangeModel = "FormLead" | "CallLead";

export type LeadChangeStamp = {
  model: LeadChangeModel;
  id: string;
  change_id: mongoose.Types.ObjectId;
  revision_after: number;
  applied_at: Date;
};

export function leadChangePaths(model: LeadChangeModel): readonly string[] {
  return model === "FormLead" ? FORM_LEAD_CHANGE_PATHS : CALL_LEAD_CHANGE_PATHS;
}

/** Reads the stored Lead document (raw, so `before`/`after` compare like for like). */
function leadModel(model: LeadChangeModel) {
  return model === "FormLead" ? getFormLeadModel() : getCallLeadModel();
}

export async function loadLeadSnapshot(
  model: LeadChangeModel,
  id: string,
  session?: ClientSession,
): Promise<Record<string, unknown> | null> {
  const found = await leadModel(model).collection.findOne(
    { _id: new mongoose.Types.ObjectId(id) },
    session ? { session } : {},
  );
  return (found as Record<string, unknown> | null) ?? null;
}

/**
 * Tracks every Lead a non-canonical workflow writes inside one transaction and
 * emits exactly one `EntityChange` per changed Lead on `flush()`.
 *
 * Create a recorder inside the transaction callback (so a retried attempt
 * starts fresh), call `track()` before the first write to an existing Lead or
 * `trackCreated()` after inserting a new Lead, then `flush()` before commit.
 */
export class LeadChangeRecorder {
  readonly command_execution_id = new mongoose.Types.ObjectId();
  private readonly tracked = new Map<
    string,
    { model: LeadChangeModel; id: string; before: Record<string, unknown> | null }
  >();

  constructor(
    private readonly options: {
      command_name: string;
      context: CanonicalCommandContext;
      session?: ClientSession;
      now?: Date;
    },
  ) {}

  get session(): ClientSession | undefined {
    return this.options.session;
  }

  async track(model: LeadChangeModel, id: string): Promise<void> {
    const key = `${model}:${id}`;
    if (this.tracked.has(key)) return;
    const before = await loadLeadSnapshot(model, id, this.options.session);
    this.tracked.set(key, { model, id, before });
  }

  trackCreated(model: LeadChangeModel, id: string): void {
    const key = `${model}:${id}`;
    if (this.tracked.has(key)) return;
    this.tracked.set(key, { model, id, before: null });
  }

  async flush(): Promise<LeadChangeStamp[]> {
    const stamps: LeadChangeStamp[] = [];
    const now = this.options.now ?? new Date();
    for (const entry of this.tracked.values()) {
      const stamp = await emitLeadChange({
        model: entry.model,
        id: entry.id,
        before: entry.before,
        session: this.options.session,
        now,
        command_name: this.options.command_name,
        command_execution_id: this.command_execution_id,
        context: this.options.context,
      });
      if (stamp) stamps.push(stamp);
    }
    this.tracked.clear();
    return stamps;
  }
}

/**
 * Emits one Lead `EntityChange` for the difference between `before` and the
 * Lead as currently stored in `session`. `before: null` records a create
 * (`revision_before` is the new document's stored revision, normally 0).
 * Returns null for a semantic no-op or a Lead that no longer exists.
 */
export async function emitLeadChange(input: {
  model: LeadChangeModel;
  id: string;
  before: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  session?: ClientSession;
  now: Date;
  command_name: string;
  command_execution_id?: mongoose.Types.ObjectId;
  context: CanonicalCommandContext;
  /** Restricts the compared paths (default: the model's full change paths). */
  paths?: readonly string[];
}): Promise<LeadChangeStamp | null> {
  const after =
    input.after !== undefined
      ? input.after
      : await loadLeadSnapshot(input.model, input.id, input.session);
  if (!after) return null;
  const fields = collectDocumentFieldChanges(
    input.before,
    after,
    input.paths ?? leadChangePaths(input.model),
  );
  if (fields.length === 0) return null;
  const storedRevision = (after as { domain_revision?: unknown }).domain_revision;
  if (storedRevision === undefined || storedRevision === null) {
    // A Lead written before the aggregate-revision backfill has no stored
    // revision; initialize it (in the same session) so the CAS stamp below
    // does not abort the owning workflow.
    await leadModel(input.model).collection.updateOne(
      {
        _id: new mongoose.Types.ObjectId(input.id),
        $or: [{ domain_revision: { $exists: false } }, { domain_revision: null }],
      },
      { $set: { domain_revision: 0 } },
      input.session ? { session: input.session } : {},
    );
  }
  const revision_before = Number(storedRevision ?? 0);
  const change_id = new mongoose.Types.ObjectId();
  await persistEntityChangeMutations({
    session: input.session,
    now: input.now,
    command_name: input.command_name,
    command_execution_id:
      input.command_execution_id ?? new mongoose.Types.ObjectId(),
    context: input.context,
    mutations: [
      {
        change_id,
        entity: { model: input.model, id: input.id },
        revision_before,
        fields,
      },
    ],
  });
  return {
    model: input.model,
    id: input.id,
    change_id,
    revision_after: revision_before + 1,
    applied_at: input.now,
  };
}

/**
 * Keeps a hydrated Lead document's revision fields equal to the stamped values
 * without marking them modified, so a later canonical mutation that reads
 * `lead.domain_revision` uses the current CAS value.
 */
export function applyLeadChangeStamp(
  doc: {
    set(path: string, value: unknown): unknown;
    unmarkModified(path: string): void;
  },
  stamp: LeadChangeStamp | null | undefined,
): void {
  if (!stamp) return;
  doc.set("domain_revision", stamp.revision_after);
  doc.set("last_change_id", stamp.change_id);
  doc.set("last_changed_at", stamp.applied_at);
  doc.unmarkModified("domain_revision");
  doc.unmarkModified("last_change_id");
  doc.unmarkModified("last_changed_at");
}

// ── Contexts ────────────────────────────────────────────────

export const EMPLOYEE_BOOKING_SUBMISSION_ACTOR_ID = "employee-booking-submission";
export const BOOKING_RECONCILIATION_REMATCH_ACTOR_ID =
  "booking-reconciliation-rematch";
export const BOOKING_LEAD_MIRROR_ACTOR_ID = "booking-lead-mirror";
export const BOOKING_SOURCE_RESOLVER_ACTOR_ID = "booking-source-resolver";
export const FORM_FILL_DETECTOR_ACTOR_ID = "form-fill-detector";

const SYSTEM_ACTOR_LABELS: Record<string, string> = {
  [EMPLOYEE_BOOKING_SUBMISSION_ACTOR_ID]: "Employee booking submission",
  [BOOKING_RECONCILIATION_REMATCH_ACTOR_ID]: "Booking reconciliation rematch",
  [BOOKING_LEAD_MIRROR_ACTOR_ID]: "Booking Lead mirror",
  [BOOKING_SOURCE_RESOLVER_ACTOR_ID]: "Booking source resolver",
  [FORM_FILL_DETECTOR_ACTOR_ID]: "Form fill detector",
};

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/**
 * Fixed system actor for a non-canonical server workflow. It records who wrote
 * the Lead; it is not an authorization claim and is never passed to
 * `assertCommandContext`.
 */
export function systemLeadChangeContext(input: {
  actor_id: string;
  command_name: string;
  request_id?: string;
  payload?: unknown;
}): CanonicalCommandContext {
  const command_id = new mongoose.Types.ObjectId().toHexString();
  const request_id = input.request_id?.trim() || command_id;
  const actor: DurableActor = {
    actor_type: "system",
    actor_id: input.actor_id,
    actor_label: SYSTEM_ACTOR_LABELS[input.actor_id] ?? input.actor_id,
    actor_role: "system",
    request_id,
    origin: "vantage_admin",
  };
  return {
    command_id,
    idempotency_key: `${input.actor_id}:${input.command_name}:${command_id}`,
    payload_checksum: sha256({
      command_name: input.command_name,
      payload: input.payload ?? null,
    }),
    actor,
    initiator: actor,
    provenance: {
      origin: "vantage_admin",
      run_id: null,
      source_receipt_id: null,
      source_connection_key: null,
    },
  };
}

/**
 * Owner context for the Owner reconciliation routes. Uses the server-derived
 * Owner identity (`deriveTrustedOwnerActor`) when present; otherwise falls back
 * to the fixed mirror system actor.
 */
export function ownerLeadChangeContext(input: {
  owner: { actor: string; ownerId?: string; ownerEmail?: string };
  command_name: string;
  payload?: unknown;
}): CanonicalCommandContext {
  const ownerId = input.owner.ownerId?.trim();
  if (!ownerId) {
    return systemLeadChangeContext({
      actor_id: BOOKING_LEAD_MIRROR_ACTOR_ID,
      command_name: input.command_name,
      payload: { owner_actor: input.owner.actor, payload: input.payload ?? null },
    });
  }
  const command_id = new mongoose.Types.ObjectId().toHexString();
  const actor: DurableActor = {
    actor_type: "owner",
    actor_id: ownerId,
    actor_label: input.owner.ownerEmail?.trim() || input.owner.actor,
    actor_role: "owner",
    request_id: command_id,
    origin: "vantage_admin",
  };
  return {
    command_id,
    idempotency_key: `owner:${input.command_name}:${command_id}`,
    payload_checksum: sha256({
      command_name: input.command_name,
      payload: input.payload ?? null,
    }),
    actor,
    initiator: actor,
    provenance: {
      origin: "vantage_admin",
      run_id: null,
      source_receipt_id: null,
      source_connection_key: null,
    },
  };
}

/**
 * RingCentral-origin context for a Call Lead created by the call ingest, built
 * the same way as `buildRingCentralCommandContext` in
 * `ringcentral/callLeadConvergence.service.ts`.
 */
export function ringCentralCallLeadCreateContext(input: {
  lead_id: string;
  telephony_session_id?: string | null;
  call_log_id?: string | null;
  ingestion_source?: string | null;
}): CanonicalCommandContext {
  const identity =
    input.telephony_session_id?.trim() ||
    input.call_log_id?.trim() ||
    `call-lead:${input.lead_id}`;
  const actor = createRingCentralCallIngestActor(identity);
  const ingestionSource = input.ingestion_source ?? "webhook";
  return {
    command_id: new mongoose.Types.ObjectId().toHexString(),
    idempotency_key: `ringcentral:create-call-lead:${identity}`,
    payload_checksum: sha256({
      operation: "create-call-lead",
      identity,
      lead_id: input.lead_id,
    }),
    actor,
    initiator: actor,
    provenance: {
      origin: "ringcentral",
      run_id: null,
      source_receipt_id: identity,
      source_connection_key: `ringcentral:${ingestionSource}:${identity}`,
      observation_id: null,
      decision_id: null,
      case_id: null,
      discrepancy_id: null,
      observation_channel: null,
    },
  };
}
