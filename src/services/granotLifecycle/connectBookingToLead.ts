import { createHash } from "node:crypto";
import mongoose, { type ClientSession } from "mongoose";
import { getGranotLifecycleFlags, type GranotLifecycleFlags } from "../../config/domain/granotLifecycle";
import { BookedLead } from "../../models/BookedLead";
import { DomainCommandExecution } from "../../models/DomainCommandExecution";
import { getCallLeadModel } from "../../models/CallLead";
import { getFormLeadModel } from "../../models/FormLead";
import { getGranotRecordLinkModel, type GranotRecordLinkDocument } from "../../models/GranotRecordLink";
import { newObjectIdHex, toObjectId } from "../../utils/objectId";
import { canonicalJson } from "../durableWork/checksum";
import type { DurableActor } from "../durableWork/types";
import {
  BOOKED_LEAD_CHANGE_PATHS,
  CALL_LEAD_CHANGE_PATHS,
  collectDocumentFieldChanges,
  FORM_LEAD_CHANGE_PATHS,
  persistEntityChangeMutations,
  RECORD_LINK_CHANGE_PATHS,
} from "../domainCommands/entityChange";
import { executeIdempotentCanonicalCommand } from "../domainCommands/idempotency";
import {
  assertOwnerCommandIdempotencyKey,
  type CanonicalCommandContext,
} from "../domainCommands/types";
import { finalizeSheetSync, persistSheetSyncIntent } from "../sheetSync";
import type { GranotLifecycleConnectLeadCommandInput } from "../../validation/v1/granotLifecycle.validation";
import {
  CONNECT_LEAD_OWNER_NOTICE,
  connectSheetIntent,
} from "./confirmAttachment";
import {
  bookingSourceAssignment,
  evaluateConnectPreconditions,
  type ConnectSelectedLead,
} from "./connectLead";
import {
  GRANOT_LIFECYCLE_ERROR_CODES,
  GranotLifecycleError,
} from "./errors";
import type { LeadModel } from "./types";

export const CONNECT_BOOKING_TO_LEAD_COMMAND_NAME = "connectBookingToLead";

export type ConnectBookingToLeadResult = {
  booking_id: string;
  booking_revision: number;
  outcome: "connected" | "already_satisfied";
  command_execution_id: string;
  lead_ref: { model: LeadModel; id: string };
  entity_refs: Array<{ model: string; id: string }>;
  replayed: boolean;
  owner_notice?: string;
};

export type ConnectBookingToLeadInput = GranotLifecycleConnectLeadCommandInput & {
  booking_id: string;
  idempotency_key: string;
  owner: DurableActor;
  request_id?: string;
};

export async function connectBookingToLead(
  input: ConnectBookingToLeadInput,
  options: { flags?: GranotLifecycleFlags } = {},
): Promise<ConnectBookingToLeadResult> {
  assertOwnerCommandIdempotencyKey(input.idempotency_key);
  assertOwner(input.owner, input.request_id);
  const validatedBody = commandBody(input);
  const context: CanonicalCommandContext = {
    command_id: newObjectIdHex(),
    idempotency_key: input.idempotency_key,
    payload_checksum: createHash("sha256").update(canonicalJson({
      command_name: CONNECT_BOOKING_TO_LEAD_COMMAND_NAME,
      booking_id: input.booking_id,
      validated_body: validatedBody,
    })).digest("hex"),
    actor: input.owner,
    initiator: input.owner,
    provenance: {
      origin: "vantage_admin",
      run_id: null,
      source_receipt_id: null,
      source_connection_key: null,
      observation_id: null,
      decision_id: null,
      case_id: null,
      discrepancy_id: null,
    },
  };
  const changeIds = [
    new mongoose.Types.ObjectId(),
    new mongoose.Types.ObjectId(),
    new mongoose.Types.ObjectId(),
  ];
  const outcome = await executeIdempotentCanonicalCommand({
    command_name: CONNECT_BOOKING_TO_LEAD_COMMAND_NAME,
    context,
    operation: ({ session, now, command_execution_id }) => applyConnect({
      input,
      flags: options.flags ?? getGranotLifecycleFlags(),
      session,
      now,
      command_execution_id,
      context,
      change_ids: changeIds,
    }),
  });
  const execution = await DomainCommandExecution.findOne({
    origin: "vantage_admin",
    command_name: CONNECT_BOOKING_TO_LEAD_COMMAND_NAME,
    idempotency_key: input.idempotency_key,
  }).select({ _id: 1 }).lean().exec();
  const bookingId = entityId(outcome.result.entity_refs, "BookedLead");
  const booking = await BookedLead.findById(bookingId).select({ domain_revision: 1 }).lean().exec();
  if (!execution || !booking) {
    throw new Error("Committed Connect Booking to Lead evidence could not be reloaded.");
  }
  const alreadySatisfied = outcome.result.warnings.includes("already_satisfied");
  if (!outcome.replayed && !alreadySatisfied) {
    await finalizeSheetSync({ ...connectSheetIntent(), bookingId });
  }
  return {
    booking_id: bookingId,
    booking_revision: booking.domain_revision,
    outcome: alreadySatisfied ? "already_satisfied" : "connected",
    command_execution_id: String(execution._id),
    lead_ref: {
      model: input.selected_lead.lead_model,
      id: input.selected_lead.lead_id,
    },
    entity_refs: outcome.result.entity_refs.map((row) => ({ ...row })),
    replayed: outcome.replayed,
    owner_notice: CONNECT_LEAD_OWNER_NOTICE,
  };
}

async function applyConnect(input: {
  input: ConnectBookingToLeadInput;
  flags: GranotLifecycleFlags;
  session: ClientSession;
  now: Date;
  command_execution_id: mongoose.Types.ObjectId;
  context: CanonicalCommandContext;
  change_ids: mongoose.Types.ObjectId[];
}) {
  if (!input.flags.booking_commands_enabled) {
    throw lifecycle("Granot Booking commands are disabled", "POLICY_BLOCKED", 422, input.input.request_id);
  }
  const bookingBefore = await BookedLead.findById(input.input.booking_id).session(input.session).lean().exec();
  const selected = input.input.selected_lead;
  const leadBefore = await loadLead(selected, input.session);
  const otherOwner = Boolean(
    leadBefore?.booked && String(leadBefore.booked) !== String(input.input.booking_id)
    || await BookedLead.exists({
      _id: { $ne: toObjectId(input.input.booking_id) },
      lead_ref: toObjectId(selected.lead_id),
      lead_model: selected.lead_model,
    }).session(input.session),
  );
  const linkBefore = await loadActiveLink(bookingBefore, input.session);
  const evaluation = evaluateConnectPreconditions({
    booking: bookingBefore,
    expected_booking_revision: input.input.expected_booking_revision,
    selected_lead: selected,
    lead: leadBefore,
    lead_owned_by_other_booking: otherOwner && !sameAttachedLead(bookingBefore, selected),
    source_assignment: bookingBefore
      ? bookingSourceAssignment(bookingBefore, linkBefore?.source_scope)
      : undefined,
    out_of_scope_override_reason: input.input.out_of_scope_override_reason,
  });
  if (evaluation.kind === "reject") {
    throw lifecycle(
      evaluation.message,
      evaluation.code,
      evaluation.code === "VALIDATION_FAILED" ? 400 : 409,
      input.input.request_id,
      evaluation.code === "VALIDATION_FAILED"
        ? [{ path: "out_of_scope_override_reason", message: "must be 10-500 trimmed characters for all-scope selection" }]
        : undefined,
    );
  }
  if (evaluation.kind === "already_satisfied" && bookingBefore) {
    return {
      entity_refs: connectRefs(bookingBefore._id, selected, linkBefore?._id),
      warnings: ["already_satisfied"],
    };
  }
  if (!bookingBefore || !leadBefore) {
    throw lifecycle("Booking or Lead disappeared during Connect", "IDENTITY_CONFLICT", 409, input.input.request_id);
  }

  const bookingWrite = await BookedLead.collection.updateOne(
    {
      _id: bookingBefore._id,
      domain_revision: input.input.expected_booking_revision,
      is_referral_booking: { $ne: true },
      $and: [
        { $or: [{ cancelled: null }, { cancelled: { $exists: false } }] },
        {
          $or: [
            { is_leadless_booking: true },
            { lead_ref: null },
            { lead_ref: { $exists: false } },
          ],
        },
      ],
    },
    {
      $set: {
        lead_ref: toObjectId(selected.lead_id),
        lead_model: selected.lead_model,
        is_leadless_booking: false,
      },
    },
    { session: input.session },
  );
  if (bookingWrite.matchedCount !== 1) {
    throw lifecycle("Booking revision changed", "DOMAIN_REVISION_CONFLICT", 409, input.input.request_id);
  }
  const bookingAfter = await BookedLead.findById(bookingBefore._id).session(input.session).lean().exec();
  if (!bookingAfter) throw new Error("Updated Booking could not be reloaded.");

  const leadWrite = await updateLeadForBooking(
    selected.lead_model,
    {
      _id: toObjectId(selected.lead_id),
      $and: [
        { $or: [{ booked: null }, { booked: { $exists: false } }] },
        { $or: [{ cancelled: null }, { cancelled: { $exists: false } }] },
      ],
      duplicate: { $ne: true },
      ...(selected.lead_model === "FormLead" ? { bad_lead: { $in: [null, ""] } } : {}),
      ...(selected.lead_model === "CallLead" ? { created_on_unmatched: { $ne: true } } : {}),
    },
    {
      $set: {
        booked: bookingBefore._id,
        over_2000: Boolean(bookingAfter.over_2000),
        over_4000: Boolean(bookingAfter.over_4000),
      },
    },
    input.session,
  );
  if (leadWrite.matchedCount !== 1) {
    throw lifecycle("Selected Lead revision changed", "DOMAIN_REVISION_CONFLICT", 409, input.input.request_id);
  }
  const leadAfter = await loadLead(selected, input.session);
  if (!leadAfter) throw new Error("Selected Lead disappeared during Connect.");

  const link = await persistConnectLink({
    current: linkBefore,
    booking: bookingAfter,
    selected_lead: selected,
    now: input.now,
    session: input.session,
    request_id: input.input.request_id,
  });

  const mutations = [
    {
      change_id: input.change_ids[0]!,
      entity: { model: "BookedLead" as const, id: String(bookingBefore._id) },
      revision_before: Number(bookingBefore.domain_revision ?? 0),
      fields: collectDocumentFieldChanges(
        bookingBefore as Record<string, unknown>,
        bookingAfter as Record<string, unknown>,
        BOOKED_LEAD_CHANGE_PATHS,
      ),
    },
    {
      change_id: input.change_ids[1]!,
      entity: { model: selected.lead_model, id: selected.lead_id },
      revision_before: Number(leadBefore.domain_revision ?? 0),
      fields: collectDocumentFieldChanges(
        leadBefore,
        leadAfter,
        selected.lead_model === "FormLead" ? FORM_LEAD_CHANGE_PATHS : CALL_LEAD_CHANGE_PATHS,
      ),
    },
    ...(link
      ? [{
          change_id: input.change_ids[2]!,
          entity: { model: "GranotRecordLink" as const, id: String(link.after._id) },
          revision_before: Number(link.before?.domain_revision ?? 0),
          fields: collectDocumentFieldChanges(
            (link.before as Record<string, unknown> | null) ?? null,
            link.after as Record<string, unknown>,
            RECORD_LINK_CHANGE_PATHS,
          ),
        }]
      : []),
  ].filter((mutation) => mutation.fields.length > 0);
  await persistEntityChangeMutations({
    session: input.session,
    now: input.now,
    command_name: CONNECT_BOOKING_TO_LEAD_COMMAND_NAME,
    command_execution_id: input.command_execution_id,
    context: input.context,
    mutations,
  });
  await persistSheetSyncIntent({
    ...connectSheetIntent(),
    bookingId: String(bookingBefore._id),
  }, input.session);
  return {
    entity_refs: connectRefs(bookingBefore._id, selected, link?.after._id),
    warnings: [],
  };
}

async function loadActiveLink(
  booking: { _id?: unknown; normalized_job_no?: unknown } | null,
  session: ClientSession,
) {
  if (!booking?._id) return null;
  const Link = getGranotRecordLinkModel();
  const byBooking = await Link.findOne({
    provider: "granot",
    booking_ref: booking._id,
    state: "active",
  }).session(session).lean().exec();
  if (byBooking) return byBooking;
  if (!booking.normalized_job_no) return null;
  return Link.findOne({
    provider: "granot",
    normalized_job_no: booking.normalized_job_no,
    state: "active",
  }).session(session).lean().exec();
}

async function persistConnectLink(input: {
  current: GranotRecordLinkDocument | null;
  booking: { _id: unknown; normalized_job_no?: unknown; job_no?: unknown };
  selected_lead: ConnectSelectedLead;
  now: Date;
  session: ClientSession;
  request_id?: string;
}): Promise<{ before: GranotRecordLinkDocument | null; after: Record<string, unknown> } | null> {
  const Link = getGranotRecordLinkModel();
  const leadRef = { model: input.selected_lead.lead_model, id: toObjectId(input.selected_lead.lead_id) };
  if (!input.current) {
    return null;
  }
  const updated = await Link.collection.updateOne(
    { _id: input.current._id, state: "active", domain_revision: input.current.domain_revision },
    {
      $set: {
        lead_ref: leadRef,
        booking_ref: input.booking._id,
        disputed: false,
        dispute_reason: undefined,
        last_observed_at: input.now,
      },
    },
    { session: input.session },
  );
  if (updated.matchedCount !== 1) {
    throw lifecycle("Record Link revision changed", "DOMAIN_REVISION_CONFLICT", 409, input.request_id);
  }
  const after = await Link.findById(input.current._id).session(input.session).lean().exec();
  if (!after) throw new Error("Updated Record Link could not be reloaded.");
  return { before: input.current, after };
}

async function loadLead(selected: ConnectSelectedLead, session: ClientSession): Promise<Record<string, unknown> | null> {
  if (selected.lead_model === "FormLead") {
    return getFormLeadModel().findById(selected.lead_id).session(session).lean().exec() as Promise<Record<string, unknown> | null>;
  }
  return getCallLeadModel().findById(selected.lead_id).session(session).lean().exec() as Promise<Record<string, unknown> | null>;
}

async function updateLeadForBooking(
  model: LeadModel,
  filter: Record<string, unknown>,
  update: Record<string, unknown>,
  session: ClientSession,
) {
  return model === "FormLead"
    ? getFormLeadModel().collection.updateOne(filter, update, { session })
    : getCallLeadModel().collection.updateOne(filter, update, { session });
}

function commandBody(input: ConnectBookingToLeadInput): GranotLifecycleConnectLeadCommandInput {
  return {
    expected_booking_revision: input.expected_booking_revision,
    selected_lead: input.selected_lead,
    ...(input.out_of_scope_override_reason
      ? { out_of_scope_override_reason: input.out_of_scope_override_reason.trim() }
      : {}),
  };
}

function sameAttachedLead(
  booking: { lead_ref?: unknown; lead_model?: unknown } | null,
  selected: ConnectSelectedLead,
) {
  return Boolean(
    booking
    && String(booking.lead_ref ?? "") === selected.lead_id
    && booking.lead_model === selected.lead_model,
  );
}

function connectRefs(
  bookingId: unknown,
  selected: ConnectSelectedLead,
  linkId?: unknown,
): Array<{ model: string; id: string }> {
  return [
    { model: "BookedLead", id: String(bookingId) },
    { model: selected.lead_model, id: selected.lead_id },
    ...(linkId ? [{ model: "GranotRecordLink", id: String(linkId) }] : []),
  ];
}

function entityId(rows: readonly { model: string; id: string }[], model: string) {
  const row = rows.find((entry) => entry.model === model);
  if (!row) throw new Error(`Committed command result omitted ${model}.`);
  return row.id;
}

function assertOwner(owner: DurableActor, requestId?: string) {
  if (owner.actor_type !== "owner" || owner.actor_role !== "owner" || owner.origin !== "vantage_admin") {
    throw lifecycle("Owner authority is required", "OWNER_REQUIRED", 403, requestId);
  }
}

function lifecycle(
  message: string,
  key: keyof typeof GRANOT_LIFECYCLE_ERROR_CODES,
  status: number,
  requestId?: string,
  issues?: Array<{ path?: string; message: string }>,
) {
  return new GranotLifecycleError(message, GRANOT_LIFECYCLE_ERROR_CODES[key], status, requestId, issues);
}
