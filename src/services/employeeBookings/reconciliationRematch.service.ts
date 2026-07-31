import { randomUUID } from "node:crypto";
import { connectMongo } from "../../db";
import { BookedLead } from "../../models/BookedLead";
import { BookingLeadReconciliationCase } from "../../models/BookingLeadReconciliationCase";
import { getBookingReconciliationConfig } from "../../config/domain";
import { finalizeSheetSync, persistSheetSyncIntent, runSheetSyncWrite } from "../sheetSync";
import { recordOperationalEvent } from "../observability";
import { attachLeadToEmployeeBooking } from "./bookingLeadAttachment.service";
import { evaluateEmployeeBookingMatch } from "./leadMatchEvaluator";
import { queryEmployeeBookingCandidates } from "./leadCandidateQueries";
import type { PreparedEmployeeBookingSubmission } from "./types";
import { acquireLease, releaseLease } from "../sheetSync/drainer/leases";
import { createHash } from "node:crypto";
import { toObjectId } from "../../utils/objectId";

const GLOBAL_REMATCH_LEASE_SCOPE = "booking-reconciliation:rematch";

export async function runDueBookingLeadRematches(context: { actor: string }) {
  const config = getBookingReconciliationConfig();
  if (!config.autoRematchEnabled) {
    return { claimed: 0, attached: 0, updated: 0, skipped: 0 };
  }

  await connectMongo();
  const owner = randomUUID();
  const acquired = await acquireLease(GLOBAL_REMATCH_LEASE_SCOPE, owner, 60_000);
  if (!acquired) {
    return { claimed: 0, attached: 0, updated: 0, skipped: 0 };
  }
  const now = new Date();
  let claimed = 0;
  let attached = 0;
  let updated = 0;
  let skipped = 0;
  try {
    const dueCases = await BookingLeadReconciliationCase.find({
      status: "pending",
      reason: { $in: config.autoRematchReasons },
      "retry.next_attempt_at": { $lte: now },
      $or: [
        { "retry.leased_until": { $exists: false } },
        { "retry.leased_until": null },
        { "retry.leased_until": { $lte: now } },
      ],
    })
      .sort({ "retry.next_attempt_at": 1, createdAt: 1 })
      .limit(config.autoRematchBatchSize)
      .select("_id")
      .lean()
      .exec();

    for (const dueCase of dueCases) {
      const leased = await BookingLeadReconciliationCase.findOneAndUpdate(
        {
          _id: dueCase._id,
          status: "pending",
          $or: [
            { "retry.leased_until": { $exists: false } },
            { "retry.leased_until": null },
            { "retry.leased_until": { $lte: now } },
          ],
        },
        {
          $set: {
            "retry.lease_owner": owner,
            "retry.leased_until": new Date(Date.now() + 60_000),
          },
        },
        { returnDocument: "after" },
      ).exec();
      if (!leased) {
        skipped += 1;
        continue;
      }
      claimed += 1;
      try {
        const jobs = await runSheetSyncWrite(async (session) => {
          const caseDoc = (await BookingLeadReconciliationCase.findById(leased._id)
            .session(session ?? null)
            .exec()) as any;
          if (
            !caseDoc ||
            caseDoc.status !== "pending" ||
            !caseDoc.retry?.next_attempt_at ||
            caseDoc.retry.next_attempt_at > new Date() ||
            !config.autoRematchReasons.includes(caseDoc.reason)
          ) {
            if (caseDoc) {
              caseDoc.retry.leased_until = undefined;
              caseDoc.retry.lease_owner = undefined;
              await caseDoc.save({ session });
            }
            skipped += 1;
            return [] as any[];
          }
          const booking = await BookedLead.findById(caseDoc.booking)
            .session(session ?? null)
            .exec();
          if (!booking || booking.cancelled || (booking.lead_ref && booking.lead_model)) {
            caseDoc.retry ??= { attempt_count: 0 };
            caseDoc.retry.leased_until = undefined;
            caseDoc.retry.lease_owner = undefined;
            caseDoc.retry.next_attempt_at = undefined;
            await caseDoc.save({ session });
            skipped += 1;
            return [] as any[];
          }
          const prepared = preparedFromCase(caseDoc);
          const candidateQuery = await queryEmployeeBookingCandidates(prepared, session);
          const evaluated = await evaluateEmployeeBookingMatch(
            prepared,
            candidateQuery.candidates,
            candidateQuery.hasOverflow,
          );
          caseDoc.latest_candidates = evaluated.candidates.map(toCaseCandidate) as any;
          caseDoc.match_attempts.push({
            attempted_at: new Date(),
            trigger: "delayed_retry",
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
            candidate_snapshot_hash: hashCandidates(evaluated.candidates),
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
          } as any);
          if (evaluated.kind === "linked") {
            const job = await attachLeadToEmployeeBooking({
              booking,
              prepared,
              leadModel: evaluated.leadModel,
              leadId: evaluated.leadId,
              operation: "booking_reconciliation.auto_attach_delayed",
              session,
            });
            await persistSheetSyncIntent(job, session);
            caseDoc.retry ??= { attempt_count: 0 };
            caseDoc.status = "resolved";
            caseDoc.resolution_history.push({
              action: "auto_attach_delayed",
              lead_model: evaluated.leadModel,
              lead_id: toObjectId(evaluated.leadId),
              actor: context.actor,
              occurred_at: new Date(),
            } as any);
            caseDoc.retry.leased_until = undefined;
            caseDoc.retry.lease_owner = undefined;
            caseDoc.retry.next_attempt_at = undefined;
            caseDoc.revision += 1;
            await caseDoc.save({ session });
            attached += 1;
            return [job];
          }
          caseDoc.reason = evaluated.reason;
          caseDoc.retry ??= { attempt_count: 0 };
          caseDoc.retry.attempt_count += 1;
          caseDoc.retry.leased_until = undefined;
          caseDoc.retry.lease_owner = undefined;
          const nextDelayIndex = caseDoc.retry.attempt_count;
          const nextDelay =
            config.autoRematchReasons.includes(evaluated.reason) &&
            config.autoRematchDelaysMinutes[nextDelayIndex];
          caseDoc.retry.next_attempt_at = nextDelay
            ? new Date(Date.now() + nextDelay * 60_000)
            : undefined;
          caseDoc.revision += 1;
          await caseDoc.save({ session });
          updated += 1;
          return [] as any[];
        }, { forceTransaction: true });
        for (const job of jobs) {
          await finalizeSheetSync(job);
        }
      } catch (error) {
        await BookingLeadReconciliationCase.updateOne(
          { _id: leased._id, "retry.lease_owner": owner },
          {
            $set: {
              "retry.leased_until": null,
              "retry.lease_owner": null,
              "retry.last_error":
                error instanceof Error ? error.message : String(error),
            },
          },
        ).exec();
        await recordOperationalEvent({
          level: "error",
          eventKey: "booking.lead_reconciliation.retry_failed",
          category: "booking",
          workflow: "booking_lead_reconciliation",
          summary: "Booking lead reconciliation retry failed.",
          entity: { type: "booking_lead_reconciliation_case", id: leased._id.toString() },
          details: {
            actor: context.actor,
            error: error instanceof Error ? error.message : String(error),
          },
          notificationCandidate: false,
        });
      }
    }
    await recordOperationalEvent({
      level: "info",
      eventKey: "booking.lead_reconciliation.resolved",
      category: "booking",
      workflow: "booking_lead_reconciliation",
      summary: "Booking reconciliation rematch drain completed.",
      details: { claimed, attached, updated, skipped },
      notificationCandidate: false,
    });
    return { claimed, attached, updated, skipped };
  } finally {
    await releaseLease(GLOBAL_REMATCH_LEASE_SCOPE, owner);
  }
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

function toCaseCandidate(candidate: any) {
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

function hashCandidates(candidates: any[]): string {
  const payload = JSON.stringify(
    candidates.map((candidate) => ({
      leadId: candidate.leadId,
      leadModel: candidate.leadModel,
      methods: [...candidate.matchMethods].sort(),
      eligibility: candidate.eligibility,
      sourceCompatibility: candidate.sourceCompatibility,
    })),
  );
  return createHash("sha256").update(payload).digest("hex");
}
