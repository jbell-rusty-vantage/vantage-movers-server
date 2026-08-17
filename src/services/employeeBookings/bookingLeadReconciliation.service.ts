import mongoose, { type ClientSession } from "mongoose";
import { BookedLead } from "../../models/BookedLead";
import { BookingLeadReconciliationCase } from "../../models/BookingLeadReconciliationCase";
import { CallLead } from "../../models/CallLead";
import { FormLead } from "../../models/FormLead";
import {
  normalizeJobNo,
  normalizeSubmissionLid,
} from "../bookings/bookingIdentity";
import { normalizePhoneNumberForMatch } from "../../utils/phone";
import { upsertCustomerFromBookingContact } from "../customers/customerFromLead.service";
import { getLinkedLead } from "../leads";
import { classifyLeadSourceCompatibility } from "../leads/leadSourceCompatibility";
import type {
  BookingLeadCandidateSearchInput,
  BookingLeadReconciliationListQuery,
  RefreshBookingLeadCandidatesInput,
  ResolveBookingLeadReconciliationInput,
  ReopenBookingLeadReconciliationInput,
  UpdatePendingEmployeeBookingInput,
} from "../../validation/v1.validation";
import { ConflictError, NotFoundError } from "../errors";
import { recordOperationalEvent } from "../observability";
import { finalizeSheetSync, persistSheetSyncIntent, runSheetSyncWrite } from "../sheetSync";
import { V1ServiceError } from "../v1ServiceError";
import { prepareEmployeeBookingSubmission } from "./employeeBookingPreparation";
import { queryEmployeeBookingCandidates } from "./leadCandidateQueries";
import { evaluateEmployeeBookingMatch } from "./leadMatchEvaluator";
import {
  attachLeadToEmployeeBooking,
  createAndAttachReconciliationCallLead,
  createAndAttachReconciliationFormLead,
  reassignEmployeeBookingLead,
} from "./bookingLeadAttachment.service";
import {
  assertAllowedCaseAction,
  assertExactWarningOverrides,
  decodeDateIdCursor,
  encodeDateIdCursor,
  getOverrideableWarnings,
} from "./reconciliationPolicy";
import type {
  EmployeeBookingActorContext,
  EvaluatedLeadCandidate,
  PreparedEmployeeBookingSubmission,
} from "./types";
import { createHash } from "node:crypto";
import { toObjectId } from "../../utils/objectId";

export async function listBookingLeadReconciliationCases(
  query: BookingLeadReconciliationListQuery,
) {
  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;
  if (query.origin) filter.origin = query.origin;
  if (query.reason) filter.reason = query.reason;
  if (query.lead_source_company) {
    filter["submission.source_assignment.lead_source_company"] =
      toObjectId(query.lead_source_company);
  }
  if (query.source_granularity_key) {
    filter["submission.source_assignment.source_granularity_key"] =
      query.source_granularity_key.trim().toLowerCase();
  }
  if (query.q?.trim()) {
    const regex = new RegExp(escapeRegex(query.q.trim()), "i");
    const orClauses = [
      { "submission.job_no": regex },
      { "submission.lead_name": regex },
      { "submission.phone_number": regex },
      { "submission.lid": regex },
      { "submission.email": regex },
      { "submission.source_assignment.crm_source_label_snapshot": regex },
      ...(mongoose.isValidObjectId(query.q.trim())
        ? [{ booking: toObjectId(query.q.trim()) }]
        : []),
    ];
    filter.$or = orClauses;
  }
  if (query.from || query.to) {
    filter.createdAt = {
      ...(query.from ? { $gte: query.from } : {}),
      ...(query.to ? { $lte: query.to } : {}),
    };
  }
  if (query.cursor) {
    const parsed = decodeDateIdCursor(query.cursor);
    const directionOperator = query.direction === "asc" ? "$gt" : "$lt";
    if (parsed) {
      filter.$and = [
        ...(Array.isArray(filter.$and) ? (filter.$and as Record<string, unknown>[]) : []),
        {
          $or: [
            { [query.sort]: { [directionOperator]: parsed.date } },
            {
              [query.sort]: parsed.date,
              _id: {
                [directionOperator]: toObjectId(parsed.id),
              },
            },
          ],
        },
      ];
    }
  }

  const docs = await BookingLeadReconciliationCase.find(filter)
    .sort({ [query.sort]: query.direction === "asc" ? 1 : -1, _id: query.direction === "asc" ? 1 : -1 })
    .limit(query.limit + 1)
    .lean()
    .exec();
  const items = docs.slice(0, query.limit).map(summarizeCase);
  const next = docs.length > query.limit ? docs[query.limit - 1] : undefined;
  return {
    items,
    next_cursor: next
      ? encodeDateIdCursor(next[query.sort] as Date, String(next._id))
      : null,
  };
}

export async function getBookingLeadReconciliationCase(id: string) {
  const doc = await BookingLeadReconciliationCase.findById(id)
    .populate("booking")
    .lean()
    .exec();
  if (!doc) {
    throw new NotFoundError("Booking lead reconciliation case not found");
  }
  return detailCase(doc);
}

export async function searchBookingLeadCandidates(
  caseId: string,
  query: BookingLeadCandidateSearchInput,
) {
  const caseDoc = await BookingLeadReconciliationCase.findById(caseId)
    .populate("booking")
    .lean()
    .exec();
  if (!caseDoc) {
    throw new NotFoundError("Booking lead reconciliation case not found");
  }
  const booking = (caseDoc as any).booking;
  if (!booking?._id) {
    throw new NotFoundError("Booked lead not found");
  }
  const prepared = preparedFromCase(caseDoc);
  const results = await searchCandidates(query);
  const next = results.length > query.limit ? results[query.limit - 1] : undefined;
  return {
    items: results
      .slice(0, query.limit)
      .map((lead) => toLeadSearchResult(lead, booking, prepared)),
    next_cursor:
      next?.createdAt && next?._id
        ? encodeDateIdCursor(next.createdAt, String(next._id))
        : null,
  };
}

export async function refreshBookingLeadCandidates(
  caseId: string,
  input: RefreshBookingLeadCandidatesInput,
  context: EmployeeBookingActorContext,
) {
  const jobs = await runSheetSyncWrite(async (session) => {
    const caseDoc = (await BookingLeadReconciliationCase.findById(caseId)
      .session(session ?? null)
      .exec()) as any;
    if (!caseDoc) {
      throw new NotFoundError("Booking lead reconciliation case not found");
    }
    assertRevision(caseDoc.revision, input.revision);
    const prepared = preparedFromCase(caseDoc);
    const candidateQuery = await queryEmployeeBookingCandidates(prepared, session);
    const evaluated = await evaluateEmployeeBookingMatch(
      prepared,
      candidateQuery.candidates,
      candidateQuery.hasOverflow,
    );
    caseDoc.latest_candidates = evaluated.candidates.map(toCaseCandidate) as any;
    caseDoc.match_attempts.push(
      buildMatchAttempt("owner_refresh", evaluated, hashCandidates(evaluated.candidates)) as any,
    );
    caseDoc.retry ??= { attempt_count: 0 };
    caseDoc.retry.last_error = undefined;
    caseDoc.revision += 1;
    await caseDoc.save({ session });
    return [];
  }, { forceTransaction: true });
  for (const job of jobs) {
    await finalizeSheetSync(job);
  }
  await recordOperationalEvent({
    level: "info",
    eventKey: "booking.lead_reconciliation.candidates_refreshed",
    category: "booking",
    workflow: "booking_lead_reconciliation",
    summary: "Booking lead reconciliation candidates refreshed.",
    entity: { type: "booking_lead_reconciliation_case", id: caseId },
    details: { actor: context.actor },
    notificationCandidate: false,
  });
  return getBookingLeadReconciliationCase(caseId);
}

export async function updatePendingEmployeeBooking(
  caseId: string,
  patch: UpdatePendingEmployeeBookingInput,
  context: EmployeeBookingActorContext,
) {
  const finalizedJobs = await runSheetSyncWrite(async (session) => {
    const caseDoc = (await BookingLeadReconciliationCase.findById(caseId)
      .session(session ?? null)
      .exec()) as any;
    if (!caseDoc) {
      throw new NotFoundError("Booking lead reconciliation case not found");
    }
    assertRevision(caseDoc.revision, patch.revision);
    if (caseDoc.status !== "pending") {
      throw new ConflictError("Only pending reconciliation cases can edit the booking");
    }
    const submission = caseDoc.submission as any;
    const booking = await BookedLead.findById(caseDoc.booking)
      .session(session ?? null)
      .exec();
    if (!booking) {
      throw new NotFoundError("Booked lead not found");
    }
    assertLiveBookingStateForAction(booking, "update_pending");
    const nextInput = {
      submission_id: submission.submission_id,
      lead_source_company_id:
        patch.lead_source_company_id ??
        submission.source_assignment.lead_source_company.toString(),
      source_granularity_key:
        patch.source_granularity_key ??
        submission.source_assignment.source_granularity_key,
      agent: patch.agent ?? submission.agent,
      split_agent: patch.split_agent ?? submission.split_agent,
      lead_name: patch.lead_name ?? submission.lead_name,
      binder_amount: patch.binder_amount ?? submission.binder_amount,
      deposit_amount: patch.deposit_amount ?? submission.deposit_amount,
      merchant: patch.merchant ?? submission.merchant,
      phone_number: patch.phone_number ?? submission.phone_number,
      email: patch.email ?? submission.email,
      lid: patch.lid ?? submission.lid,
      job_no: patch.job_no ?? submission.job_no,
    };
    const prepared = await prepareEmployeeBookingSubmission(nextInput as any);
    const jobOwner = await BookedLead.findOne({
      _id: { $ne: booking._id },
      normalized_job_no: prepared.normalizedJobNo,
    })
      .session(session ?? null)
      .select("_id")
      .lean()
      .exec();
    if (jobOwner?._id) {
      throw new ConflictError("A different booking already exists with this job number");
    }
    const candidateQuery = await queryEmployeeBookingCandidates(prepared, session);
    const evaluated = await evaluateEmployeeBookingMatch(
      prepared,
      candidateQuery.candidates,
      candidateQuery.hasOverflow,
    );
    const customer = await upsertCustomerFromBookingContact(
      {
        customer_name: prepared.leadName,
        customer_phone: prepared.phoneNumber,
        customer_email: prepared.email,
      },
      session,
    );
    Object.assign(booking, {
      book_date: patch.book_date ?? booking.book_date,
      job_no: prepared.jobNo,
      normalized_job_no: prepared.normalizedJobNo,
      customer_name: prepared.leadName,
      agent_allocations: prepared.agentAllocations,
      total_binder_amount: prepared.binderAmount,
      deposit_amount: prepared.depositAmount,
      merchant: prepared.merchant,
      source: prepared.sourceDisplayLabel,
      employee_source_snapshot: prepared.sourceAssignment,
      local: prepared.local,
      over_2000: prepared.depositAmount > 2000,
      over_4000: prepared.depositAmount > 4000,
      ...(customer ? { customer: customer._id } : {}),
    });
    await booking.save({ session });
    Object.assign(caseDoc.submission ?? {}, {
      submission_id: prepared.submissionId,
      lead_name: prepared.leadName,
      normalized_name: prepared.normalizedLeadName,
      phone_number: prepared.phoneNumber,
      normalized_phone_number: prepared.normalizedPhoneNumber,
      email: prepared.email,
      normalized_email: prepared.normalizedEmail,
      lid: prepared.lid,
      normalized_lid: prepared.normalizedLid,
      job_no: prepared.jobNo,
      normalized_job_no: prepared.normalizedJobNo,
      binder_amount: prepared.binderAmount,
      deposit_amount: prepared.depositAmount,
      merchant: prepared.merchant,
      agent: prepared.agent,
      split_agent: prepared.splitAgent,
      book_date: patch.book_date ?? submission.book_date,
      source_assignment: prepared.sourceAssignment,
    });
    if (evaluated.kind !== "linked") {
      caseDoc.reason = evaluated.reason;
    }
    caseDoc.latest_candidates = evaluated.candidates.map(toCaseCandidate) as any;
    caseDoc.match_attempts.push(
      buildMatchAttempt("owner_refresh", evaluated, hashCandidates(evaluated.candidates)) as any,
    );
    caseDoc.resolution_history.push({
      action: "update_submission",
      actor: context.actor,
      notes: patch.notes,
      occurred_at: new Date(),
    } as any);
    caseDoc.revision += 1;
    await caseDoc.save({ session });
    const job = {
      resource: "booked_lead" as const,
      operation: "employee_booking.update_pending",
      bookingId: booking._id.toString(),
    };
    await persistSheetSyncIntent(job, session);
    return [job];
  }, { forceTransaction: true });
  for (const job of finalizedJobs) {
    await finalizeSheetSync(job);
  }
  return getBookingLeadReconciliationCase(caseId);
}

export async function resolveBookingLeadReconciliation(
  caseId: string,
  command: ResolveBookingLeadReconciliationInput,
  context: EmployeeBookingActorContext,
) {
  const jobs = await runSheetSyncWrite(
    (session) =>
      persistBookingLeadReconciliationResolveInTransaction(
        caseId,
        command,
        context,
        { session, now: new Date() },
      ),
    { forceTransaction: true },
  );
  for (const job of jobs) {
    await finalizeSheetSync(job);
  }
  await recordOperationalEvent({
    level: command.action === "reassign" ? "warn" : command.action === "dismiss" ? "info" : "info",
    eventKey:
      command.action === "reassign"
        ? "booking.lead_reconciliation.reassigned"
        : command.action === "dismiss"
          ? "booking.lead_reconciliation.dismissed"
          : "booking.lead_reconciliation.resolved",
    category: "booking",
    workflow: "booking_lead_reconciliation",
    summary: "Booking lead reconciliation command completed.",
    entity: { type: "booking_lead_reconciliation_case", id: caseId },
    details: { actor: context.actor, action: command.action },
    notificationCandidate: false,
  });
  return getBookingLeadReconciliationCase(caseId);
}

export async function resolveBookingLeadReconciliationInTransaction(
  caseId: string,
  command: ResolveBookingLeadReconciliationInput,
  context: EmployeeBookingActorContext,
  tx: { session?: ClientSession; now: Date },
) {
  return persistBookingLeadReconciliationResolveInTransaction(
    caseId,
    command,
    context,
    tx,
  );
}

export async function persistBookingLeadReconciliationResolveInTransaction(
  caseId: string,
  command: ResolveBookingLeadReconciliationInput,
  context: EmployeeBookingActorContext,
  tx: { session?: ClientSession; now: Date },
) {
  const session = tx.session;
    const caseDoc = (await BookingLeadReconciliationCase.findById(caseId)
      .session(session ?? null)
      .exec()) as any;
    if (!caseDoc) {
      throw new NotFoundError("Booking lead reconciliation case not found");
    }
    assertRevision(caseDoc.revision, command.revision);
    assertAllowedCaseAction(caseDoc.status, command.action);
    const booking = await BookedLead.findById(caseDoc.booking)
      .session(session ?? null)
      .exec();
    if (!booking) {
      throw new NotFoundError("Booked lead not found");
    }
    assertLiveBookingStateForAction(booking, command.action);
    const prepared = preparedFromCase(caseDoc);
    const jobsToFinalize: any[] = [];
    if (command.action === "dismiss") {
      caseDoc.status = "dismissed";
      caseDoc.resolution_history.push({
        action: "dismiss",
        actor: context.actor,
        notes: command.notes,
        occurred_at: new Date(),
      } as any);
    } else if (command.action === "attach_existing") {
      const liveLead = await getLinkedLead(command.lead_model, command.lead_id, session);
      const liveWarnings = deriveLiveLeadWarnings(liveLead, command.lead_model, booking, prepared);
      assertLeadAttachable(liveLead, booking, liveWarnings);
      if (liveWarnings.includes("source_conflict") && !command.source_resolution) {
        throw new V1ServiceError("source_resolution is required for source conflicts", 409);
      }
      assertExactWarningOverrides(liveWarnings, command.overridden_warnings);
      const job = await attachLeadToEmployeeBooking({
        booking,
        prepared,
        leadModel: command.lead_model,
        leadId: command.lead_id,
        operation: "booking_reconciliation.attach_existing",
        sourceResolution: command.source_resolution,
        session,
      });
      await persistSheetSyncIntent(job, session);
      jobsToFinalize.push(job);
      caseDoc.status = "resolved";
      caseDoc.resolution_history.push({
        action: "attach_existing",
        lead_model: command.lead_model,
        lead_id: toObjectId(command.lead_id),
        source_resolution: command.source_resolution,
        overridden_warnings: command.overridden_warnings,
        actor: context.actor,
        notes: command.notes,
        occurred_at: new Date(),
      } as any);
    } else if (command.action === "create_and_attach") {
      caseDoc.status = "resolved";
      if (command.lead_model === "CallLead") {
        const result = await createAndAttachReconciliationCallLead({
          booking,
          prepared,
          leadFields: command.lead_fields as any,
          session,
        });
        for (const extraJob of result.extraJobs) {
          await persistSheetSyncIntent(extraJob, session);
          jobsToFinalize.push(extraJob);
        }
        await persistSheetSyncIntent(result.job, session);
        jobsToFinalize.push(result.job);
        caseDoc.resolution_history.push({
          action: "create_and_attach",
          lead_model: "CallLead",
          lead_id: toObjectId(result.leadId),
          actor: context.actor,
          notes: command.notes,
          occurred_at: new Date(),
        } as any);
      } else {
        const result = await createAndAttachReconciliationFormLead({
          booking,
          prepared,
          leadFields: command.lead_fields as any,
          session,
        });
        for (const extraJob of result.extraJobs) {
          await persistSheetSyncIntent(extraJob, session);
          jobsToFinalize.push(extraJob);
        }
        await persistSheetSyncIntent(result.job, session);
        jobsToFinalize.push(result.job);
        caseDoc.resolution_history.push({
          action: "create_and_attach",
          lead_model: "FormLead",
          lead_id: toObjectId(result.leadId),
          actor: context.actor,
          notes: command.notes,
          occurred_at: new Date(),
        } as any);
      }
    } else if (command.action === "reassign") {
      const liveLead = await getLinkedLead(command.lead_model, command.lead_id, session);
      const liveWarnings = deriveLiveLeadWarnings(liveLead, command.lead_model, booking, prepared);
      assertLeadAttachable(liveLead, booking, liveWarnings, { allowSameBooking: false });
      if (liveWarnings.includes("source_conflict") && !command.source_resolution) {
        throw new V1ServiceError("source_resolution is required for source conflicts", 409);
      }
      assertExactWarningOverrides(liveWarnings, command.overridden_warnings);
      const reassignmentJobs = await reassignEmployeeBookingLead({
        booking,
        prepared,
        nextLeadModel: command.lead_model,
        nextLeadId: command.lead_id,
        sourceResolution: command.source_resolution,
        session,
      });
      for (const job of reassignmentJobs) {
        await persistSheetSyncIntent(job, session);
      }
      jobsToFinalize.push(...reassignmentJobs);
      caseDoc.status = "resolved";
      caseDoc.resolution_history.push({
        action: "reassign",
        lead_model: command.lead_model,
        lead_id: toObjectId(command.lead_id),
        source_resolution: command.source_resolution,
        overridden_warnings: command.overridden_warnings,
        actor: context.actor,
        notes: command.notes,
        occurred_at: new Date(),
      } as any);
    }
    caseDoc.revision += 1;
    await caseDoc.save({ session });
    return jobsToFinalize;
}

export async function reopenBookingLeadReconciliation(
  caseId: string,
  command: ReopenBookingLeadReconciliationInput,
  context: EmployeeBookingActorContext,
) {
  await runSheetSyncWrite(async (session) => {
    const caseDoc = (await BookingLeadReconciliationCase.findById(caseId)
      .session(session ?? null)
      .exec()) as any;
    if (!caseDoc) {
      throw new NotFoundError("Booking lead reconciliation case not found");
    }
    assertRevision(caseDoc.revision, command.revision);
    const prepared = preparedFromCase(caseDoc);
    const candidateQuery = await queryEmployeeBookingCandidates(prepared, session);
    const evaluated = await evaluateEmployeeBookingMatch(
      prepared,
      candidateQuery.candidates,
      candidateQuery.hasOverflow,
    );
    caseDoc.status = "pending";
    // A reopened cancelled booking is for owner inspection only. It remains
    // actionable for dismissal, but must not re-enter the automatic rematch
    // queue while cancellation is still active.
    caseDoc.retry ??= { attempt_count: 0 };
    caseDoc.retry.next_attempt_at = undefined;
    caseDoc.retry.leased_until = undefined;
    caseDoc.retry.lease_owner = undefined;
    if (evaluated.kind !== "linked") {
      caseDoc.reason = evaluated.reason;
    }
    caseDoc.latest_candidates = evaluated.candidates.map(toCaseCandidate) as any;
    caseDoc.match_attempts.push(
      buildMatchAttempt("owner_refresh", evaluated, hashCandidates(evaluated.candidates)) as any,
    );
    caseDoc.resolution_history.push({
      action: "reopen",
      actor: context.actor,
      notes: command.notes,
      occurred_at: new Date(),
    } as any);
    caseDoc.revision += 1;
    await caseDoc.save({ session });
  }, { forceTransaction: true });
  await recordOperationalEvent({
    level: "info",
    eventKey: "booking.lead_reconciliation.reopened",
    category: "booking",
    workflow: "booking_lead_reconciliation",
    summary: "Booking lead reconciliation case reopened.",
    entity: { type: "booking_lead_reconciliation_case", id: caseId },
    details: { actor: context.actor },
    notificationCandidate: false,
  });
  return getBookingLeadReconciliationCase(caseId);
}

async function searchCandidates(query: BookingLeadCandidateSearchInput) {
  const clauses: Record<string, unknown>[] = [];
  if (query.mongo_id) clauses.push({ _id: toObjectId(query.mongo_id) });
  const normalizedLid = normalizeSubmissionLid(query.lid);
  if (normalizedLid) clauses.push({ normalized_lid: normalizedLid });
  const normalizedJobNo = normalizeJobNo(query.job_no);
  if (normalizedJobNo) clauses.push({ normalized_job_no: normalizedJobNo });
  if (query.email?.trim()) clauses.push({ email: query.email.trim().toLowerCase() });
  if (query.phone_number?.trim()) {
    const normalizedPhone = normalizePhoneNumberForMatch(query.phone_number);
    clauses.push({
      $or: [
        ...(normalizedPhone
          ? [{ normalized_phone_number: normalizedPhone }]
          : []),
        { phone_number: new RegExp(escapeRegex(query.phone_number), "i") },
      ],
    });
  }
  const cursor = decodeDateIdCursor(query.cursor);
  if (cursor) {
    clauses.push({
      $or: [
        { createdAt: { $lt: cursor.date } },
        {
          createdAt: cursor.date,
          _id: { $lt: toObjectId(cursor.id) },
        },
      ],
    });
  }
  if (query.name?.trim()) clauses.push({ name: new RegExp(escapeRegex(query.name.trim()), "i") });
  if (query.lead_source_company) {
    clauses.push({
      lead_source_company: toObjectId(query.lead_source_company),
    });
  }
  if (query.source_granularity_key?.trim()) {
    clauses.push({
      source_granularity_key: query.source_granularity_key.trim().toLowerCase(),
    });
  }
  if (typeof query.duplicate === "boolean") clauses.push({ duplicate: query.duplicate });
  if (typeof query.booked === "boolean") {
    clauses.push(query.booked ? { booked: { $ne: null } } : { $or: [{ booked: null }, { booked: { $exists: false } }] });
  }
  if (typeof query.cancelled === "boolean") {
    clauses.push(query.cancelled ? { cancelled: { $ne: null } } : { $or: [{ cancelled: null }, { cancelled: { $exists: false } }] });
  }
  if (query.q?.trim()) {
    const regex = new RegExp(escapeRegex(query.q.trim()), "i");
    clauses.push({
      $or: [
        { name: regex },
        { email: regex },
        { phone_number: regex },
        { job_no: regex },
        { lid: regex },
        { source_company_label_snapshot: regex },
        { source_granularity_label_snapshot: regex },
      ],
    });
  }
  const createdAtFilter =
    query.from || query.to
      ? {
          createdAt: {
            ...(query.from ? { $gte: query.from } : {}),
            ...(query.to ? { $lt: startOfNextUtcDay(query.to) } : {}),
          },
        }
      : {};
  const filter = clauses.length === 0
    ? createdAtFilter
    : clauses.length === 1
      ? { ...createdAtFilter, ...clauses[0] }
      : { ...createdAtFilter, $and: clauses };
  const models =
    query.lead_model === "FormLead"
      ? [["FormLead", FormLead] as const]
      : query.lead_model === "CallLead"
        ? [["CallLead", CallLead] as const]
        : [
            ["FormLead", FormLead] as const,
            ["CallLead", CallLead] as const,
          ];
  const results = await Promise.all(
    models.map(async ([leadModel, Model]) => {
      const docs = await (Model as any)
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .limit(query.limit + 1)
        .lean()
        .exec();
      return docs.map((doc: any) => ({ lead_model: leadModel, ...doc }));
    }),
  );
  const flattened = results
    .flat()
    .map((doc: any) => ({
      ...doc,
      _id: String(doc._id),
      createdAt: doc.createdAt ? new Date(doc.createdAt) : undefined,
    }))
    .sort(compareCreatedAtDesc);
  return flattened.map((item) => ({
    ...item,
    id: item._id,
    sortDate: item.createdAt,
  }));
}

function preparedFromCase(caseDoc: any): PreparedEmployeeBookingSubmission {
  return {
    submissionId: caseDoc.submission.submission_id,
    leadName: caseDoc.submission.lead_name,
    normalizedLeadName: caseDoc.submission.normalized_name,
    phoneNumber: caseDoc.submission.phone_number,
    normalizedPhoneNumber: caseDoc.submission.normalized_phone_number,
    email: caseDoc.submission.email,
    normalizedEmail: caseDoc.submission.normalized_email,
    lid: caseDoc.submission.lid,
    normalizedLid: caseDoc.submission.normalized_lid,
    jobNo: caseDoc.submission.job_no,
    normalizedJobNo: caseDoc.submission.normalized_job_no,
    binderAmount: caseDoc.submission.binder_amount,
    depositAmount: caseDoc.submission.deposit_amount,
    merchant: caseDoc.submission.merchant,
    agent: caseDoc.submission.agent,
    splitAgent: caseDoc.submission.split_agent,
    bookDate: caseDoc.submission.book_date,
    sourceAssignment: caseDoc.submission.source_assignment,
    sourceDisplayLabel:
      caseDoc.submission.source_assignment.crm_source_label_snapshot ||
      caseDoc.submission.source_assignment.source_granularity_label_snapshot ||
      caseDoc.submission.source_assignment.source_company_label_snapshot,
    local: undefined,
    agentAllocations: [],
  };
}

function toCaseCandidate(candidate: EvaluatedLeadCandidate) {
  return {
    lead_model: candidate.leadModel,
    lead_id: toObjectId(candidate.leadId),
    confidence: candidate.confidence,
    match_methods: candidate.matchMethods,
    eligibility: candidate.eligibility,
    source_compatibility: candidate.sourceCompatibility,
    warnings: candidate.warnings,
    snapshot: candidate.snapshot,
  };
}

function summarizeCase(doc: any) {
  const id = String(doc._id);
  return {
    id,
    _id: id,
    booking_id: bookingIdFromCase(doc),
    origin: doc.origin ?? "employee_booking",
    status: doc.status,
    reason: doc.reason,
    revision: doc.revision,
    candidate_count: doc.latest_candidates?.length ?? 0,
    submission: doc.submission,
    retry: doc.retry,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function detailCase(doc: any) {
  const id = String(doc._id);
  const booking = doc.booking ?? null;
  const attachedLead =
    booking?.lead_ref && booking?.lead_model
      ? {
          id: String(booking.lead_ref),
          _id: String(booking.lead_ref),
          lead_model: booking.lead_model,
        }
      : null;
  return {
    id,
    _id: id,
    booking_id: bookingIdFromCase(doc),
    origin: doc.origin ?? "employee_booking",
    booking,
    attached_lead: attachedLead,
    status: doc.status,
    reason: doc.reason,
    submission: doc.submission,
    latest_candidates: doc.latest_candidates,
    match_attempts: doc.match_attempts,
    retry: doc.retry,
    resolution_history: doc.resolution_history,
    revision: doc.revision,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function bookingIdFromCase(doc: any): string {
  const booking = doc.booking;
  if (booking && typeof booking === "object" && "_id" in booking) {
    return String(booking._id);
  }
  return String(booking);
}

function assertRevision(actual: number, expected: number) {
  if (actual !== expected) {
    throw new ConflictError("Booking lead reconciliation case is stale");
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hashCandidates(candidates: EvaluatedLeadCandidate[]): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        candidates.map((candidate) => ({
          leadId: candidate.leadId,
          leadModel: candidate.leadModel,
          methods: [...candidate.matchMethods].sort(),
          eligibility: candidate.eligibility,
          sourceCompatibility: candidate.sourceCompatibility,
        })),
      ),
    )
    .digest("hex");
}

function buildMatchAttempt(
  trigger: "owner_refresh",
  evaluated: ReturnType<typeof evaluateEmployeeBookingMatch> extends Promise<infer T> ? T : never,
  candidateHash: string,
) {
  return {
    attempted_at: new Date(),
    trigger,
    outcome:
      evaluated.kind === "linked"
        ? "high_confidence"
        : evaluated.reason === "no_match"
          ? "no_match"
          : evaluated.reason === "matching_unavailable"
            ? "error"
            : "conflict",
    reason:
      evaluated.kind === "linked"
        ? "high_confidence_candidate_available"
        : evaluated.reason,
    candidate_count: evaluated.candidates.length,
    candidate_snapshot_hash: candidateHash,
    auto_match_policy_version:
      process.env.EMPLOYEE_BOOKING_AUTO_MATCH_POLICY_VERSION?.trim() ||
      "employee-booking-v1",
    enabled_auto_match_rules:
      (
        process.env.EMPLOYEE_BOOKING_AUTO_MATCH_RULES?.trim() ||
        "form_lid_exact,call_job_no_exact,form_contact_triple_exact,form_email_phone_exact,channel_phone_exact"
      )
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
  };
}

function deriveLiveLeadWarnings(
  lead: any,
  leadModel: "FormLead" | "CallLead",
  booking: any,
  prepared: PreparedEmployeeBookingSubmission,
): string[] {
  const warnings = new Set<string>();
  if (lead.duplicate === true) warnings.add("duplicate_lead");
  if (lead.cancelled) warnings.add("lead_cancelled");
  if (lead.booked && lead.booked.toString() !== booking._id.toString()) {
    warnings.add("lead_already_booked");
  }
  if (leadModel === "CallLead" && lead.created_on_unmatched === true) {
    warnings.add("created_on_unmatched");
  }
  if (prepared.sourceAssignment.channel === "form" && leadModel === "CallLead") {
    warnings.add("channel_conflict");
  }
  if (prepared.sourceAssignment.channel === "call" && leadModel === "FormLead") {
    warnings.add("channel_conflict");
  }
  const sourceCompatibility = classifyLeadSourceCompatibility(lead, {
    source_company: prepared.sourceAssignment.source_company,
    lead_source_company: prepared.sourceAssignment.lead_source_company.toString(),
    source_granularity_key: prepared.sourceAssignment.source_granularity_key,
  });
  if (sourceCompatibility === "conflict") warnings.add("source_conflict");
  if (sourceCompatibility === "unassigned") warnings.add("source_unassigned");
  if (sourceCompatibility === "same_company") warnings.add("same_company_legacy");
  return [...warnings].sort();
}

function toLeadSearchResult(
  lead: any,
  booking: any,
  prepared: PreparedEmployeeBookingSubmission,
) {
  const warnings = deriveLiveLeadWarnings(
    lead,
    lead.lead_model,
    booking,
    prepared,
  );
  const id = String(lead._id);
  return {
    id,
    _id: id,
    lead_model: lead.lead_model,
    name: lead.name,
    phone_number: lead.phone_number,
    email: lead.email,
    lid: lead.lid,
    job_no: lead.job_no,
    duplicate: lead.duplicate === true,
    booked: lead.booked ? String(lead.booked) : false,
    cancelled: lead.cancelled ? String(lead.cancelled) : false,
    is_current_attachment:
      Boolean(lead.booked) && String(lead.booked) === String(booking._id),
    source_company:
      lead.source_company_label_snapshot ?? lead.source_company,
    source_granularity_key: lead.source_granularity_key,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
    warnings,
  };
}

function assertLeadAttachable(
  lead: any,
  booking: any,
  warnings: readonly string[],
  options: { allowSameBooking?: boolean } = {},
) {
  if (warnings.includes("lead_cancelled")) {
    throw new V1ServiceError("Lead is cancelled and cannot be attached", 409);
  }
  if (warnings.includes("lead_already_booked")) {
    throw new V1ServiceError("Lead is already attached to another booking", 409);
  }
  if (
    lead.booked &&
    lead.booked.toString() === booking._id.toString() &&
    options.allowSameBooking !== true
  ) {
    throw new V1ServiceError("Lead is already attached to this booking", 409);
  }
}

function assertLiveBookingStateForAction(
  booking: any,
  action:
    | "dismiss"
    | "attach_existing"
    | "create_and_attach"
    | "reassign"
    | "reopen"
    | "update_pending",
) {
  if (booking.cancelled && !["reopen", "dismiss"].includes(action)) {
    throw new V1ServiceError("Booking is cancelled", 409);
  }
  const hasLead = Boolean(booking.lead_ref && booking.lead_model);
  if (
    ["dismiss", "attach_existing", "create_and_attach", "update_pending"].includes(
      action,
    ) &&
    hasLead
  ) {
    throw new V1ServiceError("Booking is already attached to a lead", 409);
  }
  if (action === "reassign" && !hasLead) {
    throw new V1ServiceError("Booking has no current lead attachment", 409);
  }
}

function compareCreatedAtDesc(
  left: { createdAt?: Date; _id: string },
  right: { createdAt?: Date; _id: string },
) {
  const timeDelta =
    (right.createdAt?.getTime() ?? 0) - (left.createdAt?.getTime() ?? 0);
  return timeDelta !== 0 ? timeDelta : right._id.localeCompare(left._id);
}

function startOfNextUtcDay(value: Date): Date {
  return new Date(
    Date.UTC(
      value.getUTCFullYear(),
      value.getUTCMonth(),
      value.getUTCDate() + 1,
    ),
  );
}
