import assert from "node:assert/strict";
import test from "node:test";
import { computeChecksum } from "../durableWork";
import type {
  QueryPage,
  ReportingCandidateManifestV1,
  ReportingExecutionPageV1,
} from "./catalog";
import {
  createReportingStage4StreamV1,
  initialChecksumAccumulator,
} from "./executionStream";

const manifest: ReportingCandidateManifestV1 = {
  version: 1,
  sourceReadThrough: "2026-06-01T00:00:00.000Z",
  manifestCapturedAt: "2026-06-01T00:00:01.000Z",
  snapshotToken: {
    adapter: "mongodb_snapshot",
    operationTime: "100:1",
    capturedAt: "2026-06-01T00:00:01.000Z",
  },
  entries: [{
    model: "FormLead",
    id: "64b000000000000000000001",
    version: "2026-05-01T00:00:00.000Z",
    fingerprint: "a".repeat(64),
  }],
  outputPages: [
    {
      pageNumber: 0,
      afterCursor: null,
      nextCursor: "cursor-2",
      dependencyKeys: ["FormLead:64b000000000000000000001"],
    },
    {
      pageNumber: 1,
      afterCursor: "cursor-2",
      nextCursor: null,
      dependencyKeys: ["FormLead:64b000000000000000000001"],
    },
  ],
  checksum: "b".repeat(64),
};

test("Stage 4 stream resumes without duplicates and preserves checksum state", async () => {
  const pages = fixturePages();
  const stream = createReportingStage4StreamV1({
    pageSize: 2,
    buildManifest: async () => manifest,
    validateEntries: async () => undefined,
    openPageReader: async () => async (mapping) =>
      mapping.afterCursor ? pages[1]! : pages[0]!,
  });
  const input = queryInput();
  const uninterrupted = await collect(stream.stream(input, manifest));
  assert.equal(uninterrupted.length, 2);
  assert.deepEqual(
    uninterrupted.flatMap((entry) => entry.page.rows),
    [{ lead_id: "1" }, { lead_id: "2" }, { lead_id: "3" }],
  );
  const firstOnly = uninterrupted[0]!;
  const resumed = await collect(
    stream.stream(input, manifest, firstOnly.checkpoint),
  );
  assert.deepEqual(resumed.map((entry) => entry.page.rows), [[{ lead_id: "3" }]]);
  assert.equal(
    resumed[0]?.checkpoint.checksumAccumulator,
    uninterrupted[1]?.checkpoint.checksumAccumulator,
  );
  assert.equal(
    initialChecksumAccumulator(input, manifest),
    initialChecksumAccumulator(structuredClone(input), structuredClone(manifest)),
  );
});

test("Stage 4 stream validates current page dependencies before and after query", async () => {
  let changed = false;
  let validations = 0;
  const stream = createReportingStage4StreamV1({
    pageSize: 2,
    buildManifest: async () => manifest,
    validateEntries: async () => {
      validations += 1;
      if (changed) throw new Error("reporting_candidate_manifest_changed");
    },
    openPageReader: async () => async () => {
        changed = true;
        return fixturePages()[0]!;
      },
  });
  await assert.rejects(
    collect(stream.stream(queryInput(), manifest)),
    /manifest_changed/,
  );
  assert.equal(validations, 2);
});

test("Stage 4 source read-through is supplied once as a valid UTC instant", () => {
  const stream = createReportingStage4StreamV1({
    pageSize: 2,
    buildManifest: async () => manifest,
    validateEntries: async () => undefined,
    openPageReader: async () => async () => fixturePages()[0]!,
  });
  assert.equal(
    stream.captureSourceReadThrough(new Date("2026-06-01T00:00:00Z")),
    "2026-06-01T00:00:00.000Z",
  );
  assert.throws(
    () => stream.captureSourceReadThrough(new Date("invalid")),
    /valid Stage 4 instant/,
  );
});

test("manifest builds once and validations are page-targeted across pages", async () => {
  let builds = 0;
  let opens = 0;
  const validatedIds: string[][] = [];
  const expandedManifest: ReportingCandidateManifestV1 = {
    ...manifest,
    entries: Array.from({ length: 5 }, (_, index) => ({
      model: "FormLead" as const,
      id: `64b00000000000000000000${index}`,
      version: "2026-05-01T00:00:00.000Z",
      fingerprint: String(index).repeat(64),
    })),
    outputPages: [
      {
        pageNumber: 0,
        afterCursor: null,
        nextCursor: "cursor-2",
        dependencyKeys: [
          "FormLead:64b000000000000000000000",
          "FormLead:64b000000000000000000004",
        ],
      },
      {
        pageNumber: 1,
        afterCursor: "cursor-2",
        nextCursor: null,
        dependencyKeys: [
          "FormLead:64b000000000000000000002",
        ],
      },
    ],
  };
  const pages = fixturePages();
  const stream = createReportingStage4StreamV1({
    pageSize: 2,
    buildManifest: async () => {
      builds += 1;
      return expandedManifest;
    },
    validateEntries: async (entries) => {
      validatedIds.push(entries.map((entry) => entry.id));
    },
    openPageReader: async () => {
      opens += 1;
      return async (mapping) =>
        mapping.afterCursor ? pages[1]! : pages[0]!;
    },
  });
  let persisted = 0;
  const prepared = await stream.prepareManifest(queryInput(), async () => {
    persisted += 1;
  });
  await collect(stream.stream(queryInput(), prepared));
  assert.equal(builds, 1);
  assert.equal(persisted, 1);
  assert.equal(opens, 1);
  assert.deepEqual(validatedIds, [
    ["64b000000000000000000000", "64b000000000000000000004"],
    ["64b000000000000000000000", "64b000000000000000000004"],
    ["64b000000000000000000002"],
    ["64b000000000000000000002"],
  ]);
});

test("resume validates the complete manifest before reopening reader", async () => {
  let opened = 0;
  const expandedManifest: ReportingCandidateManifestV1 = {
    ...manifest,
    entries: Array.from({ length: 5 }, (_, index) => ({
      model: "FormLead" as const,
      id: `64b00000000000000000000${index}`,
      version: "2026-05-01T00:00:00.000Z",
      fingerprint: String(index).repeat(64),
    })),
  };
  const stream = createReportingStage4StreamV1({
    pageSize: 2,
    buildManifest: async () => expandedManifest,
    validateEntries: async (entries) => {
      if (entries.some((entry) => entry.id.endsWith("0"))) {
        throw new Error("canonical_source_changed");
      }
    },
    openPageReader: async () => {
      opened += 1;
      return async () => fixturePages()[1]!;
    },
  });
  await assert.rejects(
    collect(stream.stream(queryInput(), expandedManifest, {
      version: 1,
      cursor: "cursor-2",
      pageNumber: 1,
      rowCount: 2,
      checksumAccumulator: "a".repeat(64),
    })),
    /canonical_source_changed/,
  );
  assert.equal(opened, 0);
});

test("mapped contributing dependency fails before output without O(N) validation", async () => {
  const entries = Array.from({ length: 100 }, (_, index) => ({
    model: "FormLead" as const,
    id: `64b000000000000000000${String(index).padStart(3, "0")}`,
    version: "2026-05-01T00:00:00.000Z",
    fingerprint: "a".repeat(64),
  }));
  const mappedKey = `${entries[99]!.model}:${entries[99]!.id}`;
  const mappedManifest: ReportingCandidateManifestV1 = {
    ...manifest,
    entries,
    outputPages: [{
      pageNumber: 0,
      afterCursor: null,
      nextCursor: null,
      dependencyKeys: [mappedKey],
    }],
  };
  let openedRows = 0;
  let validatedCount = 0;
  const stream = createReportingStage4StreamV1({
    pageSize: 500,
    buildManifest: async () => mappedManifest,
    validateEntries: async (dependencies) => {
      validatedCount += dependencies.length;
      if (dependencies.some((entry) => entry.id === entries[99]!.id)) {
        throw new Error("canonical_source_changed");
      }
    },
    openPageReader: async () => async () => {
      openedRows += 1;
      return fixturePages()[1]!;
    },
  });
  await assert.rejects(
    collect(stream.stream(queryInput(), mappedManifest)),
    /canonical_source_changed/,
  );
  assert.equal(validatedCount, 1);
  assert.equal(openedRows, 0);
});

function fixturePages(): QueryPage[] {
  const firstRows = [{ lead_id: "1" }, { lead_id: "2" }];
  const secondRows = [{ lead_id: "3" }];
  return [
    {
      rows: firstRows,
      nextCursor: "cursor-2",
      rowCount: 2,
      canonicalPageChecksum: pageChecksum(firstRows),
    },
    {
      rows: secondRows,
      nextCursor: null,
      rowCount: 1,
      canonicalPageChecksum: pageChecksum(secondRows),
    },
  ];
}

function pageChecksum(rows: unknown): string {
  return computeChecksum({
    checksum_version: 1,
    artifact_kind: "reporting_page",
    schema_version: 1,
    payload: rows,
  });
}

function queryInput() {
  return {
    datasetKey: "lead_outcome_detail" as const,
    datasetSchemaVersion: 1 as const,
    resolvedWindow: {
      timezone: "America/New_York",
      fromUtc: "2026-05-01T04:00:00.000Z",
      toExclusiveUtc: "2026-06-01T04:00:00.000Z",
    },
    registry: {
      companies: [{
        id: "64b000000000000000000001",
        key: "best_relocation",
        label: "Best Relocation",
      }],
      granularities: [],
    },
    filters: {},
    selectedColumns: [{ id: "lead_id", label: "Lead ID" }],
    effectiveSort: [
      { id: "lead_timestamp", direction: "asc" as const },
      { id: "lead_type", direction: "asc" as const },
      { id: "lead_id", direction: "asc" as const },
    ],
    sourceReadThrough: manifest.sourceReadThrough,
  };
}

async function collect(
  iterable: AsyncIterable<ReportingExecutionPageV1>,
): Promise<ReportingExecutionPageV1[]> {
  const values: ReportingExecutionPageV1[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}
