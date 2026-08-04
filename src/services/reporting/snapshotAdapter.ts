import mongoose, { type ClientSession } from "mongoose";
import { connectMongo } from "../../db";

export type ReportingSnapshotTokenV1 = {
  adapter: "mongodb_snapshot";
  operationTime: string;
  capturedAt: string;
};

export interface ReportingSnapshotAdapter {
  capture<T>(
    read: (session: ClientSession) => Promise<T>,
  ): Promise<{ value: T; token: ReportingSnapshotTokenV1 }>;
}

export class SnapshotConsistencyUnavailableError extends Error {
  readonly code = "snapshot_consistency_unavailable";
  readonly retryable = true;

  constructor() {
    super("Snapshot-consistent reporting reads are unavailable.");
    this.name = "SnapshotConsistencyUnavailableError";
  }
}

export class MongoReportingSnapshotAdapter implements ReportingSnapshotAdapter {
  async capture<T>(
    read: (session: ClientSession) => Promise<T>,
  ): Promise<{ value: T; token: ReportingSnapshotTokenV1 }> {
    await connectMongo();
    const session = await mongoose.connection.startSession();
    try {
      session.startTransaction({
        readConcern: { level: "snapshot" },
        readPreference: "primary",
      });
      const value = await read(session);
      const operationTime = session.operationTime;
      if (!operationTime) throw new SnapshotConsistencyUnavailableError();
      const token = {
        adapter: "mongodb_snapshot" as const,
        operationTime: operationTime.toString(),
        capturedAt: new Date().toISOString(),
      };
      await session.commitTransaction();
      return { value, token };
    } catch (error) {
      if (session.inTransaction()) await session.abortTransaction();
      if (
        error instanceof SnapshotConsistencyUnavailableError ||
        isSnapshotUnsupported(error)
      ) {
        throw new SnapshotConsistencyUnavailableError();
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }
}

function isSnapshotUnsupported(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /snapshot|transaction numbers are only allowed|replica set/i.test(
    message,
  );
}

let snapshotAdapter: ReportingSnapshotAdapter =
  new MongoReportingSnapshotAdapter();

export function setReportingSnapshotAdapter(
  adapter: ReportingSnapshotAdapter,
): void {
  snapshotAdapter = adapter;
}

export function getReportingSnapshotAdapter(): ReportingSnapshotAdapter {
  return snapshotAdapter;
}
