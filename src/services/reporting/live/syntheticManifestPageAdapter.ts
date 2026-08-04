import type {
  QueryPage,
  ReportingCandidateManifestV1,
  ReportingOutputPageMapV1,
  ValidatedReportingRequest,
} from "../catalog";
import {
  setReportingManifestPageAdapter,
  type ReportingManifestPageAdapter,
} from "../executionStream";

export type SyntheticLiveTestPageAdapterOptions = {
  rows: Array<Record<string, unknown>>;
  /** When set, emit this many rows (may differ from manifest estimate to force verify failure). */
  emitRowCount?: number;
};

/**
 * Live-test limitation: canonical Mongo rows are not read. Synthetic rows are
 * injected through this adapter while the real worker lease/checkpoint/write/
 * verify/promotion path executes against owner OAuth Google adapters.
 */
export function createSyntheticLiveTestManifestPageAdapter(
  options: SyntheticLiveTestPageAdapterOptions,
): ReportingManifestPageAdapter {
  return {
    async open(_input, manifest) {
      assertManifestCompatible(_input, manifest);
      const emitCount = options.emitRowCount ?? options.rows.length;
      const rows = options.rows.slice(0, emitCount);
      return async (_mapping: ReportingOutputPageMapV1): Promise<QueryPage> => ({
        rows,
        rowCount: rows.length,
        nextCursor: null,
        canonicalPageChecksum: "",
      });
    },
  };
}

export function registerSyntheticLiveTestManifestPageAdapter(
  options: SyntheticLiveTestPageAdapterOptions,
): void {
  setReportingManifestPageAdapter(
    createSyntheticLiveTestManifestPageAdapter(options),
  );
}

function assertManifestCompatible(
  input: ValidatedReportingRequest & { sourceReadThrough: string },
  manifest: ReportingCandidateManifestV1,
): void {
  if (manifest.version !== 1) {
    throw new Error("unsupported_reporting_manifest_version");
  }
  if (manifest.sourceReadThrough !== input.sourceReadThrough) {
    throw new Error("reporting_manifest_read_through_mismatch");
  }
}
