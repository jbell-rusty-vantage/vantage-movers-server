import type { ClientSession } from "mongoose";
import type { LeadModelName, LocalType } from "../../config/domain";
import { BookedLead } from "../../models/BookedLead";
import {
  createBookedLeadFromSourceSchema,
  type CreateBookedLeadFromSourceInput,
  type CreateLeadlessBookingInput,
} from "../../validation/v1.validation";
import { deriveBookedLeadAgentAllocations } from "../agents";
import { getLinkedLead, type SourceLeadDocument } from "../leads";
import {
  createBookedLead,
  createBookedLeadInTransaction,
  finalizeBookedLeadCreateAfterCommit,
  populateBookedLead,
} from "./bookedLead.service";
import {
  effectiveBookingSourceCompany,
  resolveBookingSourceLead,
} from "./bookingSourceResolver";
import { resolveLeadSourceAssignment } from "../leads/leadSourceCompany";
import {
  recordMissingLeadCplRate,
  resolveLeadCplSnapshot,
} from "../leads/leadCplResolution";
import { requireBestRelocationImportSource } from "./bestRelocationImportGuard";
import { createLeadlessBookingInTransaction } from "./leadlessBooking.service";
import { finalizeSheetSync } from "../sheetSync";
import {
  evaluateOwnerCallLeadMatch,
  isBestRelocationFromSource,
  linkedLeadStillEligible,
  ownerSnapshotLeadName,
  ownerSnapshotPhone,
  type OwnerPendingMatchExtras,
} from "./ownerBookingAttach";

export type FromSourceAttachPlan =
  | {
      kind: "attach";
      lead: SourceLeadDocument;
      leadModel: LeadModelName;
      jobNo?: string;
      bookingOrigin?: "owner_booking";
    }
  | {
      kind: "owner_pending";
      extras: OwnerPendingMatchExtras;
      jobNo: string;
    };

export async function resolveFromSourceAttach(
  input: CreateBookedLeadFromSourceInput,
  session?: ClientSession,
  deps: {
    evaluateOwnerCallLeadMatch?: typeof evaluateOwnerCallLeadMatch;
    resolveBookingSourceLead?: typeof resolveBookingSourceLead;
    getLinkedLead?: typeof getLinkedLead;
    linkedLeadStillEligible?: typeof linkedLeadStillEligible;
  } = {},
): Promise<FromSourceAttachPlan> {
  const resolveSourceLead = deps.resolveBookingSourceLead ?? resolveBookingSourceLead;
  const evaluateOwnerMatch = deps.evaluateOwnerCallLeadMatch ?? evaluateOwnerCallLeadMatch;
  const loadLinkedLead = deps.getLinkedLead ?? getLinkedLead;
  const confirmLinkedEligible = deps.linkedLeadStillEligible ?? linkedLeadStillEligible;

  if (input.lead_type === "FormLead") {
    const resolved = await resolveSourceLead(input);
    return {
      kind: "attach",
      ...resolved,
      bookingOrigin: isBestRelocationFromSource(input) ? undefined : "owner_booking",
    };
  }

  if (isBestRelocationFromSource(input)) {
    const resolved = await resolveSourceLead(input);
    return { kind: "attach", ...resolved };
  }

  let match = await evaluateOwnerMatch(input, session);
  if (match.kind === "linked") {
    match = await confirmLinkedEligible(match, session);
  }
  if (match.kind === "linked") {
    const lead = await loadLinkedLead(match.leadModel, match.leadId, session);
    return {
      kind: "attach",
      lead,
      leadModel: match.leadModel,
      jobNo: input.call_job_no?.trim() || undefined,
      bookingOrigin: "owner_booking",
    };
  }

  return {
    kind: "owner_pending",
    jobNo: (input.call_job_no ?? "").trim(),
    extras: {
      reason: match.reason,
      candidates: match.candidates,
      channel: "call",
      phoneNumber: ownerSnapshotPhone(input.call_phone_number, input.customer_phone),
      leadName: ownerSnapshotLeadName(input.customer_name),
    },
  };
}

/**
 * Bridges Google Form / phone-driven booking submissions onto the generic
 * booking lifecycle.
 *
 * Resolves (or creates) the source lead, decides the canonical
 * `source_company` from any override the form supplied, and writes that
 * back onto the lead before delegating to `createBookedLead`. Behavior
 * matches the original `v1.service.ts` implementation field-for-field,
 * including the `lead.source_company = effectiveSourceCompany` write that
 * only fires when the request actually overrode the source company.
 */
export async function createBookedLeadFromSourceInTransaction(
  rawInput: unknown,
  tx: { session?: import("mongoose").ClientSession; now: Date },
) {
  const input = createBookedLeadFromSourceSchema.parse(rawInput);
  const plan = await resolveFromSourceAttach(input, tx.session);
  if (plan.kind === "owner_pending") {
    return persistOwnerFromSourcePendingInTransaction(input, plan, tx);
  }
  const { lead, leadModel, jobNo, bookingOrigin } = plan;
  const overrideSource = input.source_company?.trim();
  const overrideResolution = overrideSource
    ? await resolveLeadSourceAssignment({
        value: overrideSource,
        channel: leadModel === "CallLead" ? "call" : "form",
        local: lead.local as LocalType | undefined,
        source_site: lead.source_company_site,
      })
    : undefined;
  const effectiveSourceCompany =
    overrideResolution?.assignment.source_company ??
    effectiveBookingSourceCompany(undefined, lead);
  const isBestRelocationImport = requireBestRelocationImportSource(
    input.ingestion_source,
    effectiveSourceCompany,
  );
  if (isBestRelocationImport) {
    requireBestRelocationImportSource(
      input.ingestion_source,
      effectiveBookingSourceCompany(undefined, lead),
    );
  }
  let bookingSource = sourceDisplayLabelFromLead(lead) ?? effectiveSourceCompany;
  const leadMutations: Array<{
    entity: { model: "FormLead" | "CallLead"; id: string };
    revision_before: number;
    fields: Array<{ path: string; before?: unknown; after?: unknown }>;
  }> = [];
  const revisionBefore = Number(lead.domain_revision ?? 0);
  if (overrideResolution) {
    const { assignment } = overrideResolution;
    Object.assign(lead, assignment);
    Object.assign(
      lead,
      await resolveLeadCplSnapshot({
        sourceGranularityId: assignment.source_granularity_id
          ? String(assignment.source_granularity_id)
          : null,
        storedBusinessTimestamp: lead.timestamp,
        duplicate: leadModel === "CallLead" && lead.duplicate === true,
      }),
    );
    bookingSource = sourceDisplayLabelFromAssignment(assignment);
    await lead.save({ session: tx.session });
    leadMutations.push({
      entity: { model: leadModel, id: lead._id.toString() },
      revision_before: revisionBefore,
      fields: [{ path: "source_company", after: assignment.source_company }],
    });
  }
  const pending = await createBookedLeadInTransaction(
    {
      timestamp: input.timestamp,
      book_date: input.book_date,
      job_no: jobNo,
      lead_ref: lead._id.toString(),
      lead_model: leadModel,
      agent_allocations: deriveBookedLeadAgentAllocations(input),
      total_binder_amount: input.binder_amount,
      deposit_amount: input.deposit_amount,
      merchant: input.merchant,
      source: bookingSource,
      local: lead.local as LocalType | undefined,
      submission_id: input.submission_id,
      customer_name: input.customer_name,
      customer_phone: input.customer_phone,
      allow_inactive_agents: isBestRelocationImport,
      set_primary_agent_as_receiver: isBestRelocationImport,
      receiver_agent_source_value: isBestRelocationImport
        ? `Booked Deals:${jobNo ?? "unknown-job"}`
        : undefined,
      ...(bookingOrigin ? { booking_origin: bookingOrigin } : {}),
    },
    tx,
  );
  const mutations = [
    ...leadMutations,
    ...(pending.outcome.kind === "duplicate"
      ? []
      : [
          {
            entity: {
              model: "BookedLead" as const,
              id: String(pending.outcome.bookingId),
            },
            revision_before:
              pending.outcome.kind === "upsert"
                ? Number(
                    (
                      await BookedLead.findById(pending.outcome.bookingId).session(
                        tx.session ?? null,
                      )
                    )?.domain_revision ?? 0,
                  )
                : 0,
            fields: [
              { path: "job_no", after: jobNo },
              { path: "lead_ref", after: lead._id.toString() },
              { path: "lead_model", after: leadModel },
            ],
          },
          {
            entity: { model: leadModel, id: lead._id.toString() },
            revision_before: overrideResolution
              ? revisionBefore + 1
              : Number(lead.domain_revision ?? 0),
            fields: [{ path: "booked", after: String(pending.outcome.bookingId) }],
          },
        ]),
  ];
  return {
    result: undefined as unknown,
    warnings: pending.warnings,
    entity_refs: [
      { model: "BookedLead", id: String(pending.outcome.bookingId) },
      { model: leadModel, id: lead._id.toString() },
    ],
    mutations,
    finalize: async () => {
      const finalized = await finalizeBookedLeadCreateAfterCommit(
        {
          timestamp: input.timestamp,
          book_date: input.book_date,
          job_no: jobNo,
          lead_ref: lead._id.toString(),
          lead_model: leadModel,
          agent_allocations: deriveBookedLeadAgentAllocations(input),
          total_binder_amount: input.binder_amount,
          deposit_amount: input.deposit_amount,
          merchant: input.merchant,
          source: bookingSource,
          local: lead.local as LocalType | undefined,
          submission_id: input.submission_id,
          customer_name: input.customer_name,
          customer_phone: input.customer_phone,
          ...(bookingOrigin ? { booking_origin: bookingOrigin } : {}),
        },
        pending.merchant,
        pending.warnings,
        pending.outcome,
      );
      if (overrideResolution && lead.cpl_resolution_status === "missing_rate") {
        await recordMissingLeadCplRate({
          leadModel,
          leadId: lead._id.toString(),
          sourceCompany: String(overrideResolution.assignment.source_company),
          sourceGranularityId: overrideResolution.assignment.source_granularity_id
            ? String(overrideResolution.assignment.source_granularity_id)
            : null,
          sourceGranularityKey: overrideResolution.assignment.source_granularity_key,
        });
      }
      return finalized;
    },
  };
}

export async function createBookedLeadFromSource(input: CreateBookedLeadFromSourceInput) {
  const plan = await resolveFromSourceAttach(input);
  if (plan.kind === "owner_pending") {
    return persistOwnerFromSourcePending(input, plan);
  }
  const { lead, leadModel, jobNo, bookingOrigin } = plan;
  const overrideSource = input.source_company?.trim();
  const overrideResolution = overrideSource
    ? await resolveLeadSourceAssignment({
        value: overrideSource,
        channel: leadModel === "CallLead" ? "call" : "form",
        local: lead.local as LocalType | undefined,
        source_site: lead.source_company_site,
      })
    : undefined;
  const effectiveSourceCompany =
    overrideResolution?.assignment.source_company ??
    effectiveBookingSourceCompany(undefined, lead);
  const isBestRelocationImport = requireBestRelocationImportSource(
    input.ingestion_source,
    effectiveSourceCompany,
  );
  if (isBestRelocationImport) {
    requireBestRelocationImportSource(
      input.ingestion_source,
      effectiveBookingSourceCompany(undefined, lead),
    );
  }
  let bookingSource = sourceDisplayLabelFromLead(lead) ?? effectiveSourceCompany;
  if (overrideResolution) {
    const { assignment } = overrideResolution;
    Object.assign(lead, assignment);
    Object.assign(
      lead,
      await resolveLeadCplSnapshot({
        sourceGranularityId: assignment.source_granularity_id
          ? String(assignment.source_granularity_id)
          : null,
        storedBusinessTimestamp: lead.timestamp,
        duplicate: leadModel === "CallLead" && lead.duplicate === true,
      }),
    );
    bookingSource = sourceDisplayLabelFromAssignment(assignment);
    await lead.save();
    if (lead.cpl_resolution_status === "missing_rate") {
      await recordMissingLeadCplRate({
        leadModel,
        leadId: lead._id.toString(),
        sourceCompany: String(assignment.source_company),
        sourceGranularityId: assignment.source_granularity_id
          ? String(assignment.source_granularity_id)
          : null,
        sourceGranularityKey: assignment.source_granularity_key,
      });
    }
  }

  return createBookedLead({
    timestamp: input.timestamp,
    book_date: input.book_date,
    job_no: jobNo,
    lead_ref: lead._id.toString(),
    lead_model: leadModel,
    agent_allocations: deriveBookedLeadAgentAllocations(input),
    total_binder_amount: input.binder_amount,
    deposit_amount: input.deposit_amount,
    merchant: input.merchant,
    source: bookingSource,
    local: lead.local as LocalType | undefined,
    submission_id: input.submission_id,
    customer_name: input.customer_name,
    customer_phone: input.customer_phone,
    allow_inactive_agents: isBestRelocationImport,
    set_primary_agent_as_receiver: isBestRelocationImport,
    receiver_agent_source_value: isBestRelocationImport
      ? `Booked Deals:${jobNo ?? "unknown-job"}`
      : undefined,
    ...(bookingOrigin ? { booking_origin: bookingOrigin } : {}),
  });
}

type SourceDisplayLead = {
  crm_source_label_snapshot?: unknown;
  source_granularity_label_snapshot?: unknown;
  source_company_label_snapshot?: unknown;
};

function sourceDisplayLabelFromLead(lead: SourceDisplayLead): string | undefined {
  return (
    stringValue(lead.crm_source_label_snapshot) ??
    stringValue(lead.source_granularity_label_snapshot) ??
    stringValue(lead.source_company_label_snapshot)
  );
}

function sourceDisplayLabelFromAssignment(assignment: {
  crm_source_label_snapshot?: string;
  source_granularity_label_snapshot?: string;
  source_company_label_snapshot?: string;
  source_company: string;
}): string {
  return (
    assignment.crm_source_label_snapshot ??
    assignment.source_granularity_label_snapshot ??
    assignment.source_company_label_snapshot ??
    assignment.source_company
  );
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function leadlessInputFromOwnerCallLead(
  input: CreateBookedLeadFromSourceInput,
  jobNo: string,
): CreateLeadlessBookingInput {
  const callPhone =
    input.lead_type === "CallLead" ? input.call_phone_number : undefined;
  return {
    book_date: input.book_date,
    job_no: jobNo,
    source_company: input.source_company?.trim() || "not_provided",
    source: input.source_company,
    customer_name: input.customer_name,
    customer_phone: callPhone ?? input.customer_phone,
    agent: input.agent,
    split_agent: input.split_agent,
    total_binder_amount: input.binder_amount,
    deposit_amount: input.deposit_amount,
    merchant: input.merchant,
  };
}

async function persistOwnerFromSourcePendingInTransaction(
  input: CreateBookedLeadFromSourceInput,
  plan: Extract<FromSourceAttachPlan, { kind: "owner_pending" }>,
  tx: { session?: ClientSession; now: Date },
) {
  const pending = await createLeadlessBookingInTransaction(
    leadlessInputFromOwnerCallLead(input, plan.jobNo),
    tx,
    plan.extras,
  );
  const bookingId = pending.booking._id.toString();
  return {
    result: undefined as unknown,
    warnings: pending.warnings,
    entity_refs: [{ model: "BookedLead" as const, id: bookingId }],
    mutations: [
      {
        entity: { model: "BookedLead" as const, id: bookingId },
        revision_before: 0,
        fields: [
          { path: "job_no", after: plan.jobNo },
          { path: "is_leadless_booking", after: true },
          { path: "booking_origin", after: "owner_booking" },
        ],
      },
    ],
    finalize: async () => {
      await finalizeSheetSync(pending.sheetJob);
      const booking = await populateBookedLead(pending.booking._id);
      return {
        booking,
        message: "Booking created pending Booking Lead Reconciliation.",
        warnings: pending.warnings,
        total_binder_amount: booking.total_binder_amount,
        reconciliation_case_id: pending.reconciliation_case_id,
      };
    },
  };
}

async function persistOwnerFromSourcePending(
  input: CreateBookedLeadFromSourceInput,
  plan: Extract<FromSourceAttachPlan, { kind: "owner_pending" }>,
) {
  const pending = await createLeadlessBookingInTransaction(
    leadlessInputFromOwnerCallLead(input, plan.jobNo),
    { now: new Date() },
    plan.extras,
  );
  await finalizeSheetSync(pending.sheetJob);
  const booking = await populateBookedLead(pending.booking._id);
  return {
    booking,
    message: "Booking created pending Booking Lead Reconciliation.",
    warnings: pending.warnings,
    total_binder_amount: booking.total_binder_amount,
    reconciliation_case_id: pending.reconciliation_case_id,
  };
}
