import mongoose from "mongoose";
import { toObjectId } from "../../../utils/objectId";
import { computeChecksum } from "../../durableWork";
import type { ReportingCandidateManifestV1 } from "../catalog";
import { buildOutputPageMappings } from "../query/canonicalReporting";
import type { ReportingSnapshotTokenV1 } from "../snapshotAdapter";
import { setReportingSnapshotAdapter } from "../snapshotAdapter";
import { liveTestSyntheticRows, LIVE_TEST_COLUMNS } from "./liveTestRunFactory";

const LIVE_TEST_FORM_LEAD_IDS = [
  "64b0000000000000000a0001",
  "64b0000000000000000a0002",
  "64b0000000000000000a0003",
] as const;

export const LIVE_TEST_HARNESS_LIMITATION =
  "Canonical Mongo row payloads are not read for page content; synthetic rows are injected via the live-test manifest page adapter while the production worker lease/checkpoint/verify/promotion/Google OAuth path executes. The harness invokes runReportingDeliveryWorker directly (in-process) and does not exercise HTTP routes, Vercel cron, or the reporting queue consumer path.";

export function liveTestFormLeadObjectIds(): mongoose.Types.ObjectId[] {
  return LIVE_TEST_FORM_LEAD_IDS.map(toObjectId);
}

export async function seedLiveTestCanonicalFormLeads(): Promise<void> {
  const { FormLead } = await import("../../../models/FormLead.js");
  const updatedAt = new Date("2026-01-15T12:00:00.000Z");
  const timestamp = new Date("2026-01-10T12:00:00.000Z");
  await FormLead.collection.insertMany(
    LIVE_TEST_FORM_LEAD_IDS.map((id) => ({
      _id: toObjectId(id),
      updatedAt,
      createdAt: updatedAt,
      timestamp,
      lead_source_company: "live-test-co",
      source_granularity_key: "live-test-granularity",
      source_company: "live-test-co",
      name: "Synthetic Live Lead",
      phone_number: "+15555550100",
      email: "live-test@example.invalid",
    })),
    { ordered: false },
  ).catch((error: unknown) => {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: number }).code !== 11000
    ) {
      throw error;
    }
  });
}

export function registerSyntheticLiveTestSnapshotAdapter(): void {
  setReportingSnapshotAdapter({
    async capture<T>(
      read: (session: mongoose.ClientSession) => Promise<T>,
    ): Promise<{ value: T; token: ReportingSnapshotTokenV1 }> {
      const session = await mongoose.connection.startSession();
      try {
        session.startTransaction({ readConcern: { level: "snapshot" } });
        const value = await read(session);
        await session.commitTransaction();
        return {
          value,
          token: {
            adapter: "mongodb_snapshot",
            operationTime: "1",
            capturedAt: new Date().toISOString(),
          },
        };
      } catch (error) {
        if (session.inTransaction()) await session.abortTransaction();
        throw error;
      } finally {
        await session.endSession();
      }
    },
  });
}

export function buildSyntheticLiveTestManifest(input: {
  sourceReadThrough: string;
}): ReportingCandidateManifestV1 {
  const rows = liveTestSyntheticRows();
  const entries = LIVE_TEST_FORM_LEAD_IDS.map((id, index) => ({
    model: "FormLead" as const,
    id,
    version: "2026-01-15T12:00:00.000Z",
    fingerprint: computeChecksum({
      checksum_version: 1,
      artifact_kind: "reporting_data",
      schema_version: 1,
      payload: {
        _id: id,
        updatedAt: "2026-01-15T12:00:00.000Z",
        lead_source_company: "live-test-co",
        source_granularity_key: "live-test-granularity",
        timestamp: "2026-01-10T12:00:00.000Z",
      },
    }),
    ...(index >= rows.length ? {} : {}),
  }));
  const outputPages = buildOutputPageMappings(
    rows.map((row, index) => ({
      lead_id: row.lead_id,
      cohort_day: row.cohort_day,
      outcome: row.outcome,
      _dependencyKeys: [`FormLead:${LIVE_TEST_FORM_LEAD_IDS[index]}`],
    })),
    [{ id: "lead_id", direction: "asc" as const }],
    500,
    new Set(entries.map((entry) => `${entry.model}:${entry.id}`)),
  );
  const manifestCapturedAt = new Date().toISOString();
  const snapshotToken = {
    adapter: "mongodb_snapshot" as const,
    operationTime: "1",
    capturedAt: manifestCapturedAt,
  };
  return {
    version: 1,
    sourceReadThrough: input.sourceReadThrough,
    manifestCapturedAt,
    snapshotToken,
    entries,
    outputPages,
    checksum: computeChecksum({
      checksum_version: 1,
      artifact_kind: "reporting_data",
      schema_version: 1,
      payload: {
        sourceReadThrough: input.sourceReadThrough,
        manifestCapturedAt,
        snapshotToken,
        entries,
        outputPages,
      },
    }),
  };
}

export { LIVE_TEST_COLUMNS };
