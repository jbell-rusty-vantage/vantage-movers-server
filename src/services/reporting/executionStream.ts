import { computeChecksum } from "../durableWork";
import type {
  QueryPage,
  ReportingCandidateManifestV1,
  ReportingExecutionPageV1,
  ReportingOutputPageMapV1,
  ReportingStreamCheckpointV1,
  ValidatedReportingRequest,
} from "./catalog";
import {
  buildReportingCandidateManifest,
  validateReportingManifestEntries,
} from "./query/canonicalReporting";

export interface ReportingStage4StreamV1 {
  contractVersion: 1;
  lifecycle: readonly [
    "capture_source_read_through",
    "build_and_persist_manifest_once",
    "open_page_reader_once",
    "validate_page_dependencies",
    "emit_and_checkpoint",
  ];
  captureSourceReadThrough(instant: Date): string;
  prepareManifest(
    input: ValidatedReportingRequest & { sourceReadThrough: string },
    persist: (manifest: ReportingCandidateManifestV1) => Promise<void>,
  ): Promise<ReportingCandidateManifestV1>;
  stream(
    input: ValidatedReportingRequest & { sourceReadThrough: string },
    manifest: ReportingCandidateManifestV1,
    checkpoint?: ReportingStreamCheckpointV1,
  ): AsyncIterable<ReportingExecutionPageV1>;
}

export interface ReportingManifestPageAdapter {
  open(
    input: ValidatedReportingRequest & { sourceReadThrough: string },
    manifest: ReportingCandidateManifestV1,
  ): Promise<(mapping: ReportingOutputPageMapV1) => Promise<QueryPage>>;
}

export class ManifestPageAdapterUnavailableError extends Error {
  readonly code = "manifest_page_adapter_unavailable";
  readonly retryable = false;

  constructor() {
    super("A dataset-specific persisted-manifest page adapter is required.");
    this.name = "ManifestPageAdapterUnavailableError";
  }
}

let manifestPageAdapter: ReportingManifestPageAdapter = {
  async open() {
    throw new ManifestPageAdapterUnavailableError();
  },
};

export function setReportingManifestPageAdapter(
  adapter: ReportingManifestPageAdapter,
): void {
  manifestPageAdapter = adapter;
}

type StreamDependencies = {
  pageSize: number;
  buildManifest(
    input: ValidatedReportingRequest & { sourceReadThrough: string },
  ): Promise<ReportingCandidateManifestV1>;
  validateEntries(
    entries: ReportingCandidateManifestV1["entries"],
    sourceReadThrough: string,
  ): Promise<void>;
  openPageReader(
    input: ValidatedReportingRequest & { sourceReadThrough: string },
    manifest: ReportingCandidateManifestV1,
  ): Promise<(mapping: ReportingOutputPageMapV1) => Promise<QueryPage>>;
};

export function createReportingStage4StreamV1(
  dependencies: StreamDependencies,
): ReportingStage4StreamV1 {
  return {
    contractVersion: 1,
    lifecycle: [
      "capture_source_read_through",
      "build_and_persist_manifest_once",
      "open_page_reader_once",
      "validate_page_dependencies",
      "emit_and_checkpoint",
    ],
    captureSourceReadThrough(instant: Date): string {
      if (!Number.isFinite(instant.getTime())) {
        throw new TypeError("sourceReadThrough must be a valid Stage 4 instant.");
      }
      return instant.toISOString();
    },
    async prepareManifest(input, persist) {
      const manifest = await dependencies.buildManifest(input);
      await persist(manifest);
      return manifest;
    },
    async *stream(input, manifest, checkpoint) {
      if (manifest.sourceReadThrough !== input.sourceReadThrough) {
        throw new Error("reporting_manifest_read_through_mismatch");
      }
      if (checkpoint?.version !== undefined && checkpoint.version !== 1) {
        throw new Error("unsupported_reporting_checkpoint_version");
      }
      if (checkpoint && checkpoint.rowCount > 0 && checkpoint.cursor === null) {
        return;
      }
      let cursor = checkpoint?.cursor ?? undefined;
      let pageNumber = checkpoint?.pageNumber ?? 0;
      let rowCount = checkpoint?.rowCount ?? 0;
      let checksumAccumulator =
        checkpoint?.checksumAccumulator ??
        initialChecksumAccumulator(input, manifest);
      if (checkpoint) {
        await validateCompleteManifestBatched(
          manifest,
          dependencies.pageSize,
          dependencies.validateEntries,
        );
      }
      const readPage = await dependencies.openPageReader(input, manifest);
      if (checkpoint) {
        await validateCompleteManifestBatched(
          manifest,
          dependencies.pageSize,
          dependencies.validateEntries,
        );
      }
      for (;;) {
        const mapping = manifest.outputPages[pageNumber];
        if (
          !mapping ||
          mapping.pageNumber !== pageNumber ||
          mapping.afterCursor !== (cursor ?? null)
        ) {
          throw new Error("reporting_output_dependency_mapping_missing");
        }
        const entryByKey = new Map(
          manifest.entries.map((entry) => [
            `${entry.model}:${entry.id}`,
            entry,
          ]),
        );
        const dependenciesForPage = mapping.dependencyKeys.map((key) => {
          const entry = entryByKey.get(key);
          if (!entry) {
            throw new Error("reporting_output_dependency_mapping_missing");
          }
          return entry;
        });
        await dependencies.validateEntries(
          dependenciesForPage,
          manifest.sourceReadThrough,
        );
        const page = await readPage(mapping);
        await dependencies.validateEntries(
          dependenciesForPage,
          manifest.sourceReadThrough,
        );
        if (page.rowCount === 0) return;
        if (page.nextCursor !== mapping.nextCursor) {
          throw new Error("reporting_page_cursor_mapping_mismatch");
        }
        if (page.nextCursor !== null && page.nextCursor === cursor) {
          throw new Error("reporting_cursor_did_not_advance");
        }
        pageNumber += 1;
        rowCount += page.rowCount;
        checksumAccumulator = advanceChecksumAccumulator({
          previous: checksumAccumulator,
          pageNumber,
          pageChecksum: page.canonicalPageChecksum,
          nextCursor: page.nextCursor,
          rowCount,
        });
        const nextCheckpoint: ReportingStreamCheckpointV1 = {
          version: 1,
          cursor: page.nextCursor,
          pageNumber,
          rowCount,
          checksumAccumulator,
        };
        yield { page, checkpoint: nextCheckpoint };
        if (page.nextCursor === null) return;
        cursor = page.nextCursor;
      }
    },
  };
}

export async function validateCompleteManifestBatched(
  manifest: ReportingCandidateManifestV1,
  batchSize: number,
  validate: StreamDependencies["validateEntries"],
): Promise<void> {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
    throw new TypeError("Invalid manifest validation batch size.");
  }
  for (let index = 0; index < manifest.entries.length; index += batchSize) {
    await validate(
      manifest.entries.slice(index, index + batchSize),
      manifest.sourceReadThrough,
    );
  }
}

export function initialChecksumAccumulator(
  input: ValidatedReportingRequest,
  manifest: ReportingCandidateManifestV1,
): string {
  return computeChecksum({
    checksum_version: 1,
    artifact_kind: "reporting_data",
    schema_version: 1,
    payload: {
      datasetKey: input.datasetKey,
      datasetSchemaVersion: input.datasetSchemaVersion,
      selectedColumns: input.selectedColumns,
      effectiveSort: input.effectiveSort,
      manifestChecksum: manifest.checksum,
      sourceReadThrough: manifest.sourceReadThrough,
    },
  });
}

export function advanceChecksumAccumulator(input: {
  previous: string;
  pageNumber: number;
  pageChecksum: string;
  nextCursor: string | null;
  rowCount: number;
}): string {
  return computeChecksum({
    checksum_version: 1,
    artifact_kind: "reporting_data",
    schema_version: 1,
    payload: input,
  });
}

export const reportingStage4StreamV1 = createReportingStage4StreamV1({
  pageSize: 500,
  buildManifest: buildReportingCandidateManifest,
  validateEntries: validateReportingManifestEntries,
  openPageReader: (input, manifest) =>
    manifestPageAdapter.open(input, manifest),
});
