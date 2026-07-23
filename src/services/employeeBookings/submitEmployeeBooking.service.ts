import { createHash } from "node:crypto";
import mongoose from "mongoose";
import {
  getBookingReconciliationConfig,
  getEmployeeBookingMatchingConfig,
  type BookingLeadReconciliationReason,
} from "../../config/domain";
import { BookedLead } from "../../models/BookedLead";
import { BookingLeadReconciliationCase } from "../../models/BookingLeadReconciliationCase";
import { PublicSubmissionThrottleBucket } from "../../models/PublicSubmissionThrottleBucket";
import { floridaCalendarToday, toFloridaTimestamp } from "../../utils/easternTime";
import type { CreateEmployeeBookingSubmissionInput } from "../../validation/v1.validation";
import { AppError, ConflictError } from "../errors";
import { recordOperationalEvent } from "../observability";
import { getLinkedLead } from "../leads";
import { claimAvailableLeadForBooking } from "../bookings";
import { upsertCustomerFromBookingContact } from "../customers/customerFromLead.service";
import {
  finalizeSheetSync,
  persistSheetSyncIntent,
  runSheetSyncWrite,
  type FullSheetSyncJob,
} from "../sheetSync";
import { evaluateEmployeeBookingMatch } from "./leadMatchEvaluator";
import { queryEmployeeBookingCandidates } from "./leadCandidateQueries";
import { prepareEmployeeBookingSubmission } from "./employeeBookingPreparation";
import type {
  EmployeeBookingMatchOutcome,
  EvaluatedLeadCandidate,
} from "./types";

export type SubmitEmployeeBookingContext = {
  clientKeyHash?: string;
};

export type SubmitEmployeeBookingResult = {
  outcome:
    | "booked_and_linked"
    | "booked_pending_lead"
    | "duplicate_submission";
  booking_id: string;
  confirmation_code: string;
  lead_connection: "connected" | "pending";
  statusCode: 200 | 201;
};

export async function submitEmployeeBooking(
  input: CreateEmployeeBookingSubmissionInput,
  context: SubmitEmployeeBookingContext = {},
): Promise<SubmitEmployeeBookingResult> {
  await enforceEmployeeBookingThrottle(context.clientKeyHash);

  const prepared = await prepareEmployeeBookingSubmission(input);
  const existingSubmission = await BookedLead.findOne({
    booking_origin: "employee_booking",
    submission_id: prepared.submissionId,
  })
    .select("_id is_leadless_booking")
    .lean()
    .exec();
  if (existingSubmission?._id) {
    await recordOperationalEvent({
      level: "info",
      eventKey: "booking.employee_submission.duplicate_ignored",
      category: "booking",
      workflow: "employee_booking_submission",
      summary: "Duplicate employee booking submission ignored.",
      entity: { type: "booked_lead", id: String(existingSubmission._id) },
      details: {
        submission_id: prepared.submissionId,
        normalized_job_no: prepared.normalizedJobNo,
      },
      notificationCandidate: false,
    });
    return buildDuplicateResult(
      String(existingSubmission._id),
      existingSubmission.is_leadless_booking === true ? "pending" : "connected",
    );
  }

  const conflictingJob = await BookedLead.findOne({
    normalized_job_no: prepared.normalizedJobNo,
  })
    .select("_id submission_id")
    .lean()
    .exec();
  if (conflictingJob?._id) {
    throw new ConflictError("A booking already exists with this job number");
  }

  try {
    const outcome = await runSheetSyncWrite(
      async (session) => {
        const duplicate = await BookedLead.findOne({
          booking_origin: "employee_booking",
          submission_id: prepared.submissionId,
        })
          .session(session ?? null)
          .select("_id is_leadless_booking")
          .exec();
        if (duplicate) {
          return {
            kind: "duplicate" as const,
            bookingId: duplicate._id.toString(),
            leadConnection:
              duplicate.is_leadless_booking === true ? "pending" : "connected",
          } as const;
        }

        const jobOwner = await BookedLead.findOne({
          normalized_job_no: prepared.normalizedJobNo,
        })
          .session(session ?? null)
          .select("_id")
          .exec();
        if (jobOwner) {
          throw new ConflictError("A booking already exists with this job number");
        }

        let matchOutcome: EmployeeBookingMatchOutcome;
        try {
          const candidateQuery = await queryEmployeeBookingCandidates(prepared, session);
          matchOutcome = await evaluateEmployeeBookingMatch(
            prepared,
            candidateQuery.candidates,
            candidateQuery.hasOverflow,
          );
        } catch (error) {
          if (error instanceof AppError && error.statusCode === 409) {
            throw error;
          }
          matchOutcome = {
            kind: "pending",
            reason: "matching_unavailable",
            candidates: [],
          };
        }

        const customer = await upsertCustomerFromBookingContact(
          {
            customer_name: prepared.leadName,
            customer_phone: prepared.phoneNumber,
          },
          session,
        );
        const bookingBase = {
          timestamp: toFloridaTimestamp(new Date()),
          book_date: prepared.bookDate ?? floridaCalendarToday(),
          job_no: prepared.jobNo,
          normalized_job_no: prepared.normalizedJobNo,
          customer_name: prepared.leadName,
          ...(customer ? { customer: customer._id } : {}),
          agent_allocations: prepared.agentAllocations,
          total_binder_amount: prepared.binderAmount,
          deposit_amount: prepared.depositAmount,
          merchant: prepared.merchant,
          source: prepared.sourceDisplayLabel,
          booking_origin: "employee_booking" as const,
          submission_id: prepared.submissionId,
          employee_source_snapshot: prepared.sourceAssignment,
          local: prepared.local,
          over_2000: prepared.depositAmount > 2000,
          over_4000: prepared.depositAmount > 4000,
        };

        if (matchOutcome.kind === "linked") {
          const lead = await getLinkedLead(
            matchOutcome.leadModel,
            matchOutcome.leadId,
            session,
          );
          if (lead.cancelled) {
            matchOutcome = pendingFromClaimFailure(
              "lead_cancelled",
              matchOutcome.candidates,
            );
          } else if (lead.booked) {
            matchOutcome = pendingFromClaimFailure(
              "lead_already_booked",
              matchOutcome.candidates,
            );
          } else if (lead.get("duplicate") === true) {
            matchOutcome = pendingFromClaimFailure(
              "duplicate_lead",
              matchOutcome.candidates,
            );
          } else if (
            matchOutcome.leadModel === "CallLead" &&
            lead.get("created_on_unmatched") === true
          ) {
            matchOutcome = pendingFromClaimFailure("no_match", matchOutcome.candidates);
          } else {
            const booking = new BookedLead({
              ...bookingBase,
              lead_ref: new mongoose.Types.ObjectId(matchOutcome.leadId),
              lead_model: matchOutcome.leadModel,
              is_leadless_booking: false,
              auto_match: {
                rule: matchOutcome.rule,
                policy_version: getEmployeeBookingMatchingConfig().policyVersion,
                enabled_rules_snapshot:
                  getEmployeeBookingMatchingConfig().enabledRules,
                attached_at: new Date(),
              },
            });
            const claimed = await claimAvailableLeadForBooking(
              lead,
              matchOutcome.leadModel,
              booking._id,
              booking.over_2000,
              booking.over_4000,
              booking.local ?? undefined,
              session,
            );
            if (claimed) {
              await booking.save({ session });
              const job: FullSheetSyncJob = {
                resource: "booking_chain",
                operation: "employee_booking.create_linked",
                bookingId: booking._id.toString(),
              };
              await persistSheetSyncIntent(job, session);
              return {
                kind: "linked" as const,
                bookingId: booking._id.toString(),
                job,
              };
            }

            const liveLead = await getLinkedLead(
              matchOutcome.leadModel,
              matchOutcome.leadId,
              session,
            );
            matchOutcome = pendingFromClaimFailure(
              liveLead.cancelled
                ? "lead_cancelled"
                : liveLead.get("duplicate") === true
                  ? "duplicate_lead"
                  : "lead_already_booked",
              matchOutcome.candidates,
            );
          }
        }

        const booking = new BookedLead({
          ...bookingBase,
          is_leadless_booking: true,
        });
        await booking.save({ session });
        const pendingOutcome = matchOutcome as Extract<
          EmployeeBookingMatchOutcome,
          { kind: "pending" }
        >;
        const caseDoc = new BookingLeadReconciliationCase({
          booking: booking._id,
          status: "pending",
          reason: pendingOutcome.reason,
          submission: {
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
            book_date: prepared.bookDate,
            source_assignment: prepared.sourceAssignment,
          },
          latest_candidates: pendingOutcome.candidates.map(toCaseCandidate),
          match_attempts: [
            {
              attempted_at: new Date(),
              trigger: "initial",
              outcome: pendingOutcome.reason === "matching_unavailable"
                ? "error"
                : pendingOutcome.candidates.length > 0
                  ? "conflict"
                  : "no_match",
              reason: pendingOutcome.reason,
              candidate_count: pendingOutcome.candidates.length,
              candidate_snapshot_hash: hashCandidates(pendingOutcome.candidates),
              auto_match_policy_version:
                getEmployeeBookingMatchingConfig().policyVersion,
              enabled_auto_match_rules:
                getEmployeeBookingMatchingConfig().enabledRules,
            },
          ],
          retry: buildRetryState(pendingOutcome.reason),
          resolution_history: [],
          revision: 0,
        });
        await caseDoc.save({ session });
        const job: FullSheetSyncJob = {
          resource: "booked_lead",
          operation: "employee_booking.create_pending",
          bookingId: booking._id.toString(),
        };
        await persistSheetSyncIntent(job, session);
        return {
          kind: "pending" as const,
          bookingId: booking._id.toString(),
          job,
          reason: pendingOutcome.reason,
        };
      },
      { forceTransaction: true },
    );

    if (outcome.kind === "duplicate") {
      return buildDuplicateResult(outcome.bookingId, outcome.leadConnection);
    }

    await finalizeSheetSync(outcome.job);
    if (outcome.kind === "linked") {
      await recordOperationalEvent({
        level: "info",
        eventKey: "booking.employee_submission.created_linked",
        category: "booking",
        workflow: "employee_booking_submission",
        summary: "Employee booking created and auto-linked.",
        entity: { type: "booked_lead", id: outcome.bookingId },
        details: {
          submission_id: prepared.submissionId,
          normalized_job_no: prepared.normalizedJobNo,
        },
      });
      return {
        outcome: "booked_and_linked",
        booking_id: outcome.bookingId,
        confirmation_code: confirmationCodeFor(outcome.bookingId),
        lead_connection: "connected",
        statusCode: 201,
      };
    }

    await recordOperationalEvent({
      level: outcome.reason === "matching_unavailable" ? "error" : "warn",
      eventKey:
        outcome.reason === "matching_unavailable"
          ? "booking.employee_submission.matching_unavailable"
          : "booking.employee_submission.created_pending",
      category: "booking",
      workflow: "employee_booking_submission",
      summary: "Employee booking created pending reconciliation.",
      entity: { type: "booked_lead", id: outcome.bookingId },
      details: {
        submission_id: prepared.submissionId,
        normalized_job_no: prepared.normalizedJobNo,
        reason: outcome.reason,
      },
      notificationCandidate: false,
    });
    return {
      outcome: "booked_pending_lead",
      booking_id: outcome.bookingId,
      confirmation_code: confirmationCodeFor(outcome.bookingId),
      lead_connection: "pending",
      statusCode: 201,
    };
  } catch (error) {
    if (isDuplicateSubmissionError(error)) {
      const booking = await BookedLead.findOne({
        booking_origin: "employee_booking",
        submission_id: prepared.submissionId,
      })
        .select("_id")
        .select("_id is_leadless_booking")
        .lean()
        .exec();
      if (booking?._id) {
        return buildDuplicateResult(
          String(booking._id),
          booking.is_leadless_booking === true ? "pending" : "connected",
        );
      }
    }
    if (isNormalizedJobNoDuplicateError(error)) {
      throw new ConflictError("A booking already exists with this job number");
    }
    throw error;
  }
}

function buildRetryState(reason: BookingLeadReconciliationReason) {
  const config = getBookingReconciliationConfig();
  if (!config.autoRematchEnabled || !config.autoRematchReasons.includes(reason)) {
    return { attempt_count: 0 };
  }
  const [firstDelayMinutes] = config.autoRematchDelaysMinutes;
  return {
    attempt_count: 0,
    next_attempt_at: new Date(Date.now() + firstDelayMinutes * 60_000),
  };
}

function pendingFromClaimFailure(
  reason: BookingLeadReconciliationReason,
  candidates: EvaluatedLeadCandidate[],
): EmployeeBookingMatchOutcome {
  return { kind: "pending", reason, candidates };
}

function toCaseCandidate(candidate: EvaluatedLeadCandidate) {
  return {
    lead_model: candidate.leadModel,
    lead_id: new mongoose.Types.ObjectId(candidate.leadId),
    confidence: candidate.confidence,
    match_methods: candidate.matchMethods,
    eligibility: candidate.eligibility,
    source_compatibility: candidate.sourceCompatibility,
    warnings: candidate.warnings,
    snapshot: candidate.snapshot,
  };
}

function hashCandidates(candidates: EvaluatedLeadCandidate[]): string {
  const input = JSON.stringify(
    candidates.map((candidate) => ({
      leadId: candidate.leadId,
      leadModel: candidate.leadModel,
      methods: [...candidate.matchMethods].sort(),
      eligibility: candidate.eligibility,
      sourceCompatibility: candidate.sourceCompatibility,
    })),
  );
  return createHash("sha256").update(input).digest("hex");
}

function buildDuplicateResult(
  bookingId: string,
  leadConnection: "connected" | "pending" = "pending",
): SubmitEmployeeBookingResult {
  return {
    outcome: "duplicate_submission",
    booking_id: bookingId,
    confirmation_code: confirmationCodeFor(bookingId),
    lead_connection: leadConnection,
    statusCode: 200,
  };
}

function confirmationCodeFor(bookingId: string): string {
  return bookingId.replace(/[^a-fA-F0-9]/g, "").slice(-8).toUpperCase();
}

function isDuplicateSubmissionError(error: unknown): boolean {
  return isDuplicateKeyFor(error, "submission_id");
}

function isNormalizedJobNoDuplicateError(error: unknown): boolean {
  return isDuplicateKeyFor(error, "normalized_job_no");
}

function isDuplicateKeyFor(error: unknown, field: string): boolean {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    (error as { code?: unknown }).code !== 11000
  ) {
    return false;
  }
  const keyPattern =
    "keyPattern" in error
      ? (error as { keyPattern?: Record<string, unknown> }).keyPattern
      : undefined;
  if (keyPattern && field in keyPattern) {
    return true;
  }
  return String(error).includes(field);
}

async function enforceEmployeeBookingThrottle(
  clientKeyHash: string | undefined,
): Promise<void> {
  const config = getBookingReconciliationConfig();
  const keys = ["global"];
  if (clientKeyHash?.trim()) {
    keys.push(clientKeyHash.trim());
  }

  for (const key of keys) {
    const limit =
      key === "global"
        ? config.publicThrottleGlobalLimit
        : config.publicThrottlePerClientLimit;
    const bucket = await bumpThrottleBucket(
      key,
      config.publicThrottleWindowSeconds,
    );
    if (bucket.count > limit) {
      await recordOperationalEvent({
        level: "warn",
        eventKey: "booking.employee_submission.rate_limited",
        category: "booking",
        workflow: "employee_booking_submission",
        summary: "Employee booking submission rate-limited.",
        details: {
          scope: key === "global" ? "global" : "client",
        },
        notificationCandidate: false,
      });
      throw new AppError("Too many booking submissions. Please retry shortly.", {
        statusCode: 429,
      });
    }
  }
}

async function bumpThrottleBucket(keyHash: string, windowSeconds: number) {
  const now = new Date();
  const windowStart = new Date(
    Math.floor(now.getTime() / (windowSeconds * 1000)) *
      windowSeconds *
      1000,
  );
  const expiresAt = new Date(windowStart.getTime() + windowSeconds * 2000);
  return PublicSubmissionThrottleBucket.findOneAndUpdate(
    { key_hash: keyHash, window_start: windowStart },
    {
      $setOnInsert: { expires_at: expiresAt },
      $inc: { count: 1 },
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  ).orFail();
}
