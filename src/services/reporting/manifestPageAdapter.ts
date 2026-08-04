import type {
  QueryPage,
  ReportingCandidateManifestV1,
  ReportingOutputPageMapV1,
  ValidatedReportingRequest,
} from "./catalog";
import {
  setReportingManifestPageAdapter,
  type ReportingManifestPageAdapter,
} from "./executionStream";
import {
  openReportingPageReader,
  validateReportingManifestEntries,
} from "./query/canonicalReporting";
import { REPORTING_PAGE_SIZE } from "../../config/domain/reporting";

/**
 * Stage 4 production page adapter.
 * Opens the Stage 3 page reader once per stream, then serves pages through the
 * exact persisted output-page dependency mappings without changing Stage 3's
 * ReportingStage4StreamV1 interface.
 */
export function createPersistedManifestPageAdapter(deps?: {
  openReader?: typeof openReportingPageReader;
  pageSize?: number;
}): ReportingManifestPageAdapter {
  const openReader = deps?.openReader ?? openReportingPageReader;
  const pageSize = deps?.pageSize ?? REPORTING_PAGE_SIZE;
  return {
    async open(input, manifest) {
      assertManifestCompatible(input, manifest);
      await validateReportingManifestEntries(
        manifest.entries,
        manifest.sourceReadThrough,
      );
      const readByCursor = await openReader(input);
      return async (mapping: ReportingOutputPageMapV1): Promise<QueryPage> => {
        const page = await readByCursor(
          pageSize,
          mapping.afterCursor ?? undefined,
        );
        if (page.nextCursor !== mapping.nextCursor) {
          throw new Error("reporting_page_cursor_mapping_mismatch");
        }
        if (page.rowCount === 0 && mapping.nextCursor !== null) {
          throw new Error("reporting_page_mapping_empty_before_end");
        }
        return page;
      };
    },
  };
}

export function registerPersistedManifestPageAdapter(deps?: {
  openReader?: typeof openReportingPageReader;
  pageSize?: number;
}): void {
  setReportingManifestPageAdapter(createPersistedManifestPageAdapter(deps));
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
