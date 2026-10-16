/** Bounded inventory/report, apply, and verification. Re-run pages using the returned cursors. */
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { assertTargetMatchesDatabase } from "../lib/sales-outreach-indexes";
import { assertProductionWriterMatchesDeployment } from "../lib/production-writer-guard";
import { getRingCentralRepSmsEvidenceModel } from "../../src/models/salesOutreach/repSmsEvidence";
import { getSalesOutreachSubjectModel } from "../../src/models/salesOutreach/subjects";
import {
  getSalesOutreachPerformanceStateModel,
  getSalesOutreachSmsRequirementDayModel,
  getSalesOutreachSmsVolumeContributionModel,
} from "../../src/models/salesOutreach/performance";
import { mongoContactEventStore } from "../../src/services/salesOutreach/contacts/mongoStore";
import { retainSmsVolume } from "../../src/services/salesOutreach/performance/evidence";
import {
  evaluateAndProject,
  evaluationAdmissionOf,
} from "../../src/services/salesOutreach/evaluation/evaluateJob";
import { mongoEvaluationStore } from "../../src/services/salesOutreach/evaluation/store";
import { salesOutreachConfigurationLoader } from "../../src/services/salesOutreach/config/load";
import { newYorkBusinessDay } from "../../src/services/salesOutreach/reads/businessDay";
async function eachBounded<T>(
  rows: readonly T[],
  work: (row: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  let stopped = false;
  const results = await Promise.allSettled(
    Array.from({ length: Math.min(4, rows.length) }, async () => {
      while (!stopped && cursor < rows.length) {
        const row = rows[cursor++]!;
        try {
          await work(row);
        } catch (error) {
          stopped = true;
          throw error;
        }
      }
    }),
  );
  const failed = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failed) throw failed.reason;
}
async function main() {
  const args = process.argv.slice(2);
  const value = (name: string) =>
    args.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
  if (
    args.some(
      (arg) =>
        !["--apply", "--verify"].includes(arg) &&
        !/^--(target|limit|sms-after|subject-after)=/.test(arg),
    )
  )
    throw new Error(
      "Use --target=<database> [--apply|--verify] [--limit=100] [--sms-after=<id>] [--subject-after=<id>]",
    );
  const target = value("target");
  if (!target) throw new Error("Explicit --target required");
  assertTargetMatchesDatabase(target, getMongoDatabaseName());
  const limit = Number(value("limit") ?? 100);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500)
    throw new Error("limit must be 1..500");
  if (args.includes("--apply") && args.includes("--verify"))
    throw new Error("Choose apply or verify");
  mongoose.set("autoIndex", false);
  mongoose.set("autoCreate", false);
  await connectMongo();
  const after = (name: string) => {
    const id = value(name);
    if (id && !mongoose.isValidObjectId(id)) throw new Error("Invalid cursor");
    return id ? { _id: { $gt: new mongoose.Types.ObjectId(id) } } : {};
  };
  const sms = await getRingCentralRepSmsEvidenceModel()
    .find(after("sms-after"), { _id: 1, canonical_logical_id: 1 })
    .sort({ _id: 1 })
    .limit(limit)
    .lean();
  const subjects = await getSalesOutreachSubjectModel()
    .find(after("subject-after"), { _id: 1 })
    .sort({ _id: 1 })
    .limit(limit)
    .lean();
  const reportStorage: Record<
    string,
    { documents: number; bytes: number; index_bytes: number }
  > = {};
  for (const Model of [
    getSalesOutreachSmsRequirementDayModel(),
    getSalesOutreachSmsVolumeContributionModel(),
  ]) {
    try {
      const stats = await Model.db.db!.command({
        collStats: Model.collection.name,
        scale: 1,
      });
      reportStorage[Model.collection.name] = {
        documents: Number(stats.count),
        bytes: Number(stats.size),
        index_bytes: Number(stats.totalIndexSize),
      };
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== 26)
        throw error;
      reportStorage[Model.collection.name] = {
        documents: 0,
        bytes: 0,
        index_bytes: 0,
      };
    }
  }
  const now = new Date();
  const apply = args.includes("--apply");
  const verify = args.includes("--verify");
  let missingSms = 0;
  let missingSubjects = 0;
  for (const row of sms)
    if (
      !(await getSalesOutreachSmsVolumeContributionModel().exists({
        canonical_logical_id: row.canonical_logical_id,
      }))
    )
      missingSms++;
  for (const row of subjects)
    if (
      !(await getSalesOutreachSmsRequirementDayModel().exists({
        subject_id: String(row._id),
        input_complete: true,
      }))
    )
      missingSubjects++;
  if (apply) {
    await assertProductionWriterMatchesDeployment();
    const checkpoint = await getSalesOutreachPerformanceStateModel()
      .findOne({ key: "team" })
      .lean();
    if (
      (checkpoint?.sms_cursor ?? null) !== (value("sms-after") ?? null) ||
      (checkpoint?.subject_cursor ?? null) !== (value("subject-after") ?? null)
    )
      throw new Error(
        "Cursors must match saved checkpoint; report/verify remain read-only",
      );
    const admission = evaluationAdmissionOf(
      await salesOutreachConfigurationLoader.inspect(),
    );
    if (!admission.ok) throw new Error(admission.status);
    const logicalSources = [
      ...new Map(sms.map((row) => [row.canonical_logical_id, row])).values(),
    ];
    await eachBounded(logicalSources, async (row) => {
      await withTransaction(async (session) => {
        await retainSmsVolume(
          await mongoContactEventStore.loadSms([String(row._id)], session),
          session,
        );
      });
    });
    await eachBounded(subjects, async (row) => {
      await withTransaction(async (session) => {
        const current =
          await salesOutreachConfigurationLoader.requireActive(session);
        if (
          current.version !== admission.context.configuration.version ||
          current.revision !== admission.context.configuration.revision
        )
          throw new Error("Configuration changed; restart this checkpoint");
        await evaluateAndProject(
          String(row._id),
          admission.context,
          now,
          mongoEvaluationStore,
          session,
        );
        if (
          !(await getSalesOutreachSmsRequirementDayModel()
            .exists({ subject_id: String(row._id), input_complete: true })
            .session(session))
        )
          throw new Error(
            "Subject reporting input incomplete; checkpoint held",
          );
      });
    });
    // Historical policy cannot be proved by first-time reconstruction. Reliability starts at capture.
    await getSalesOutreachPerformanceStateModel().updateOne(
      { key: "team" },
      {
        $setOnInsert: { captured_at: now, full_inventory_completed: false },
        $set: {
          volume_reliable_from:
            checkpoint?.volume_reliable_from ?? newYorkBusinessDay(now),
          requirements_reliable_from:
            checkpoint?.requirements_reliable_from ?? newYorkBusinessDay(now),
          reconciled_at: now,
          sms_cursor: sms.at(-1)?._id
            ? String(sms.at(-1)!._id)
            : (value("sms-after") ?? null),
          subject_cursor: subjects.at(-1)?._id
            ? String(subjects.at(-1)!._id)
            : (value("subject-after") ?? null),
          sms_exhausted: sms.length < limit,
          subjects_exhausted: subjects.length < limit,
        },
      },
      { upsert: true },
    );
  }
  if (apply && sms.length < limit && subjects.length < limit)
    await getSalesOutreachPerformanceStateModel().updateOne(
      { key: "team" },
      { $set: { full_inventory_completed: true } },
    );
  console.log(
    JSON.stringify({
      mode: apply ? "apply" : verify ? "verify" : "report",
      sms: sms.length,
      subjects: subjects.length,
      missing_sms: missingSms,
      missing_subjects: missingSubjects,
      sms_after: sms.at(-1)?._id ?? value("sms-after") ?? null,
      subject_after: subjects.at(-1)?._id ?? value("subject-after") ?? null,
      sms_exhausted: sms.length < limit,
      subjects_exhausted: subjects.length < limit,
      storage_before: reportStorage,
      new_day_documents_upper_bound: subjects.length,
      new_volume_documents_upper_bound: sms.length,
      historical_policy: "unproven_before_first_capture",
    }),
  );
  if (verify && (missingSms || missingSubjects)) process.exitCode = 2;
}
main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Backfill failed");
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
