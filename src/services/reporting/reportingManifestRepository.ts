import mongoose from "mongoose";
import { ReportingRunManifest } from "../../models/ReportingRunManifest";
import type { ReportingCandidateManifestV1 } from "./catalog";

export const REPORTING_MANIFEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function persistReportingCandidateManifest(input: {
  runId: string;
  manifest: ReportingCandidateManifestV1;
  now?: Date;
}): Promise<{ inserted: boolean }> {
  assertNoRowPayload(input.manifest);
  const now = input.now ?? new Date();
  try {
    await ReportingRunManifest.collection.insertOne({
      run_id: asObjectId(input.runId),
      version: 1,
      source_read_through: new Date(input.manifest.sourceReadThrough),
      manifest_captured_at: new Date(input.manifest.manifestCapturedAt),
      snapshot_token: input.manifest.snapshotToken,
      entries: input.manifest.entries.map((entry) => ({
        model: entry.model,
        id: entry.id,
        version: entry.version,
        fingerprint: entry.fingerprint,
      })),
      output_pages: input.manifest.outputPages.map((page) => ({
        pageNumber: page.pageNumber,
        afterCursor: page.afterCursor,
        nextCursor: page.nextCursor,
        dependencyKeys: [...page.dependencyKeys],
      })),
      checksum: input.manifest.checksum,
      expires_at: new Date(now.getTime() + REPORTING_MANIFEST_TTL_MS),
      created_at: now,
      updated_at: now,
    });
    return { inserted: true };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const existing = await loadReportingCandidateManifest(input.runId);
      if (!existing || existing.checksum !== input.manifest.checksum) {
        throw new Error("reporting_manifest_checksum_conflict");
      }
      return { inserted: false };
    }
    throw error;
  }
}

export async function loadReportingCandidateManifest(
  runId: string,
): Promise<ReportingCandidateManifestV1 | null> {
  const doc = await ReportingRunManifest.collection.findOne({
    run_id: asObjectId(runId),
  });
  if (!doc) return null;
  return {
    version: 1,
    sourceReadThrough: new Date(doc.source_read_through).toISOString(),
    manifestCapturedAt: new Date(doc.manifest_captured_at).toISOString(),
    snapshotToken: doc.snapshot_token,
    entries: (doc.entries ?? []).map((entry: any) => ({
      model: entry.model,
      id: entry.id,
      version: entry.version,
      fingerprint: entry.fingerprint,
    })),
    outputPages: (doc.output_pages ?? []).map((page: any) => ({
      pageNumber: page.pageNumber,
      afterCursor: page.afterCursor ?? null,
      nextCursor: page.nextCursor ?? null,
      dependencyKeys: [...(page.dependencyKeys ?? [])],
    })),
    checksum: String(doc.checksum),
  };
}

export function assertNoRowPayload(manifest: ReportingCandidateManifestV1): void {
  const forbidden = ["rows", "sample", "values", "cells", "payload"];
  const json = JSON.stringify(manifest);
  for (const key of forbidden) {
    if (new RegExp(`"${key}"\\s*:`).test(json) && key !== "version") {
      // entries/outputPages are expected; reject only if nested row arrays appear.
    }
  }
  for (const entry of manifest.entries) {
    if ("row" in entry || "values" in entry || "cells" in entry) {
      throw new TypeError(
        "Reporting candidate manifests must not persist row payloads.",
      );
    }
  }
  for (const page of manifest.outputPages) {
    if ("rows" in page || "values" in page || "cells" in page) {
      throw new TypeError(
        "Reporting output page maps must not persist row payloads.",
      );
    }
  }
}

function asObjectId(value: string) {
  if (!/^[a-f\d]{24}$/i.test(value)) {
    throw new TypeError("Invalid reporting run ID.");
  }
  return new mongoose.Types.ObjectId(value);
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: number }).code === 11000
  );
}
