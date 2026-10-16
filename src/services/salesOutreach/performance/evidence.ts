import { createHash } from "node:crypto";
import { getRingCentralRepSmsEvidenceModel } from "../../../models/salesOutreach/repSmsEvidence";
import { getSalesOutreachContactEventModel } from "../../../models/salesOutreach/contactEvents";
import type { ClientSession } from "mongoose";
import {
  getSalesOutreachPerformancePolicyModel,
  getSalesOutreachSmsRequirementDayModel,
  getSalesOutreachSmsVolumeContributionModel,
} from "../../../models/salesOutreach/performance";
import {
  evaluateSubject,
  stableStringify,
  type EnginePolicy,
  type EvaluateSubjectInput,
  type EvaluateSubjectResult,
} from "../engine";
import type { SmsSourceRow } from "../contacts/derive";
import { newYorkBusinessDay, newYorkDayBounds } from "../reads/businessDay";
const fingerprint = (value: unknown) =>
  createHash("sha256").update(stableStringify(value)).digest("hex");

/** Reviewed mailbox origin is independent of cadence association and recipient count. */
export function smsVolumeContribution(row: SmsSourceRow) {
  const reviewed =
    row.identity_state === "reviewed" && row.reviewed_agent_id !== null;
  const eventAt = row.send_at ?? row.provider_created_at;
  const disposition =
    row.direction !== "outbound" ||
    ["send_failed", "delivery_failed"].includes(row.status)
      ? "excluded"
      : reviewed && row.send_at && ["sent", "delivered"].includes(row.status)
        ? "confirmed"
        : "pending";
  const value = {
    canonical_logical_id: row.canonical_logical_id,
    source_id: row.id,
    source_revision: row.source_revision,
    agent_id: reviewed ? row.reviewed_agent_id : null,
    business_date: newYorkBusinessDay(eventAt),
    disposition,
    event_at: eventAt,
  };
  return { ...value, fingerprint: fingerprint(value) };
}

export async function retainSmsVolume(
  rows: readonly SmsSourceRow[],
  session: ClientSession,
): Promise<void> {
  const Model = getSalesOutreachSmsVolumeContributionModel();
  for (const logicalId of new Set(
    rows.map((row) => row.canonical_logical_id),
  )) {
    const winner = await getRingCentralRepSmsEvidenceModel()
      .findOne({ canonical_logical_id: logicalId })
      .sort({ _id: 1 })
      .session(session)
      .lean();
    if (!winner) continue;
    const row: SmsSourceRow = {
      id: String(winner._id),
      canonical_logical_id: winner.canonical_logical_id,
      direction: winner.direction,
      status: winner.status,
      send_at: winner.send_at ?? null,
      provider_created_at: winner.provider_created_at,
      counterpart_numbers: winner.counterpart_numbers,
      is_group: winner.is_group,
      reviewed_agent_id: winner.reviewed_rep_ref?.agent_id
        ? String(winner.reviewed_rep_ref.agent_id)
        : null,
      identity_state: winner.identity_state,
      source_revision: winner.source_revision,
      duplicate_copy: false,
    };
    const next = smsVolumeContribution(row);
    const prior = await Model.findOne({
      canonical_logical_id: row.canonical_logical_id,
    })
      .session(session)
      .lean();
    if (prior?.fingerprint === next.fingerprint) continue;
    await Model.updateOne(
      { canonical_logical_id: row.canonical_logical_id },
      { $set: next, $inc: { revision: 1 } },
      { upsert: true, session },
    );
  }
}

/** Old dates are evaluated under their frozen policy; disappeared slots replace only proven dates. */
export async function retainSmsRequirements(
  input: EvaluateSubjectInput,
  result: EvaluateSubjectResult,
  policy: EnginePolicy,
  policyFingerprint: string,
  session: ClientSession,
): Promise<void> {
  const Model = getSalesOutreachSmsRequirementDayModel();
  await getSalesOutreachPerformancePolicyModel().updateOne(
    { policy_fingerprint: policyFingerprint },
    { $setOnInsert: { policy_snapshot: policy } },
    { upsert: true, session },
  );
  const previous = await Model.find({ subject_id: result.subject_id })
    .session(session)
    .lean();
  const priorByDate = new Map(previous.map((row) => [row.business_date, row]));
  const currentEvents = new Set(
    input.contact_events.map((event) => event.event_id),
  );
  const absentSourceIds = [
    ...new Set(
      previous.flatMap((row) =>
        row.obligations.flatMap((obligation) => {
          const eventId = obligation.fulfilled_by_event_id;
          return eventId &&
            !currentEvents.has(eventId) &&
            /^sms:[a-f\d]{24}$/.test(eventId)
            ? [eventId.slice(4)]
            : [];
        }),
      ),
    ),
  ];
  // A moved or disassociated event still exists globally: that is a correction, not source retention.
  const movedEvents = absentSourceIds.length
    ? await getSalesOutreachContactEventModel()
        .find(
          { source_kind: "sms", source_id: { $in: absentSourceIds } },
          { source_id: 1 },
        )
        .session(session)
        .lean()
    : [];
  const existingElsewhere = new Set(
    movedEvents.map((event) => `sms:${String(event.source_id)}`),
  );
  const dates = new Set([
    result.business_date,
    ...previous.map((row) => row.business_date),
    ...result.obligations
      .filter(
        (row) =>
          row.channel === "sms" && row.business_date === result.business_date,
      )
      .map((row) => row.business_date),
  ]);
  const cached = new Map<string, EvaluateSubjectResult>();
  for (const business_date of dates) {
    const prior = priorByDate.get(business_date);
    let evaluated = result;
    if (prior && prior.policy_fingerprint !== policyFingerprint) {
      const frozen = await getSalesOutreachPerformancePolicyModel()
        .findOne({ policy_fingerprint: prior.policy_fingerprint })
        .session(session)
        .lean();
      if (!frozen) continue;
      evaluated =
        cached.get(prior.policy_fingerprint) ??
        evaluateSubject(
          input,
          frozen.policy_snapshot as unknown as EnginePolicy,
          result.computed_as_of,
        );
      cached.set(prior.policy_fingerprint, evaluated);
    }
    if (
      prior?.coverage_through &&
      +prior.coverage_through >
        Date.parse(input.coverage.sms.complete_through ?? "1970-01-01")
    ) {
      const frozen =
        prior.policy_fingerprint === policyFingerprint
          ? policy
          : ((
              await getSalesOutreachPerformancePolicyModel()
                .findOne({ policy_fingerprint: prior.policy_fingerprint })
                .session(session)
                .lean()
            )?.policy_snapshot as unknown as EnginePolicy | undefined);
      if (!frozen) continue;
      evaluated = evaluateSubject(
        {
          ...input,
          coverage: {
            ...input.coverage,
            sms: { complete_through: prior.coverage_through.toISOString() },
          },
        },
        frozen,
        result.computed_as_of,
      );
    }
    const obligations = evaluated.obligations
      .filter(
        (row) => row.channel === "sms" && row.business_date === business_date,
      )
      .map((row) => {
        const retained = prior?.obligations.find(
          (old) => old.obligation_id === row.obligation_id,
        );
        // Source retention cannot revoke confirmed historical evidence. Explicit excluded corrections remain present.
        return retained?.fulfilled_by_event_id &&
          !currentEvents.has(retained.fulfilled_by_event_id) &&
          !existingElsewhere.has(retained.fulfilled_by_event_id)
          ? {
              ...row,
              outcome: retained.outcome,
              fulfilled_at: retained.fulfilled_at,
              fulfilled_by_event_id: retained.fulfilled_by_event_id,
              deadline_missed: retained.deadline_missed,
            }
          : row;
      });
    if (!obligations.length && business_date !== result.business_date) {
      await Model.deleteOne({
        subject_id: result.subject_id,
        business_date,
      }).session(session);
      continue;
    }
    const through = input.coverage.sms.complete_through;
    const observedThrough = through
      ? Math.min(Date.parse(through), +newYorkDayBounds(business_date).end)
      : 0;
    const retainedThrough = prior?.coverage_through
      ? +prior.coverage_through
      : 0;
    const coverageThrough = Math.max(observedThrough, retainedThrough)
      ? new Date(Math.max(observedThrough, retainedThrough)).toISOString()
      : null;
    const facts = {
      obligations,
      input_fingerprint: evaluated.input_fingerprint,
      coverage_through: coverageThrough,
      engine_version: evaluated.engine_version,
    };
    const nextFingerprint = fingerprint({
      obligations,
      coverage_through: coverageThrough,
      engine_version: evaluated.engine_version,
      policy_fingerprint: prior?.policy_fingerprint ?? policyFingerprint,
      input_complete: true,
    });
    if (prior?.fingerprint === nextFingerprint && prior.input_complete)
      continue;
    await Model.updateOne(
      { subject_id: result.subject_id, business_date },
      {
        $set: {
          ...facts,
          input_complete: true,
          coverage_through: facts.coverage_through
            ? new Date(facts.coverage_through)
            : null,
          computed_at: new Date(result.computed_as_of),
          fingerprint: nextFingerprint,
        },
        $setOnInsert: { policy_fingerprint: policyFingerprint },
        $inc: { revision: 1 },
      },
      { upsert: true, session },
    );
  }
}

export async function retainSmsRequirementGap(
  subjectId: string,
  businessDate: string,
  policy: EnginePolicy,
  policyFingerprint: string,
  session: ClientSession,
): Promise<void> {
  await getSalesOutreachPerformancePolicyModel().updateOne(
    { policy_fingerprint: policyFingerprint },
    { $setOnInsert: { policy_snapshot: policy } },
    { upsert: true, session },
  );
  const Model = getSalesOutreachSmsRequirementDayModel();
  await Model.updateMany(
    { subject_id: subjectId },
    { $set: { input_complete: false } },
    { session },
  );
  await Model.updateOne(
    { subject_id: subjectId, business_date: businessDate },
    {
      $set: { input_complete: false },
      $setOnInsert: {
        obligations: [],
        policy_fingerprint: policyFingerprint,
        input_fingerprint: "input_capped",
        engine_version: "input_capped",
        computed_at: new Date(),
        fingerprint: "input_capped",
        revision: 1,
      },
    },
    { upsert: true, session },
  );
}
