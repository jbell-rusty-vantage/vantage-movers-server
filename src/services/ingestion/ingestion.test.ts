import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { CallLead } from "../../models/CallLead";
import { IngestionConflict } from "../../models/IngestionConflict";
import { IngestionRun } from "../../models/IngestionRun";
import { SourceRowReceipt } from "../../models/SourceRowReceipt";
import { SourceRowState } from "../../models/SourceRowState";
import { sendError as sendIngestionRouteError } from "../../routes/ingestion.routes";
import {
  BEST_RELOCATION_CUTOFF,
  buildBestRelocationApplicationPlan,
  classifyKnownEvidence,
  evaluateSourceOwnedLeadUpdate,
  isWithinIngestionWindow,
  inspectOrRepairManagedIdentity,
  makeTab,
  parseBookedDealRows,
  parseCallRows,
  parseFormRows,
  parseLidBestRelo,
  parseDate,
  parseRefundRows,
  planBootstrapAdoption,
  stableSourceRowId,
  sourceOwnedContentHash,
  type ParsedWorkbookData,
} from "../bestRelocationSheetIngest";
import {
  computeChecksum,
  createBestRelocationIngestionActor,
} from "../durableWork";
import { InMemoryLeaseStore } from "../durableWork/testing";
import { applyBestRelocationPlan } from "./applyPlan";
import {
  planHealthSignals,
  shouldAlertIngestionSignal,
  type IngestionHealthSignal,
} from "./health";
import { INGESTION_STATUS_GRAPH } from "./types";
import {
  envGateEnabled,
  ingestionHeartbeatSkipReason,
} from "../../routes/best-relocation-ingestion-cron.routes";

test("recurring source window starts at New York midnight on 2026-04-30", () => {
  assert.equal(BEST_RELOCATION_CUTOFF.toISOString(), "2026-04-30T04:00:00.000Z");
  assert.equal(
    parseDate("4/30/2026")?.toISOString(),
    BEST_RELOCATION_CUTOFF.toISOString(),
  );
  const readThrough = new Date("2026-05-02T00:00:00.000Z");
  assert.equal(
    isWithinIngestionWindow(
      new Date("2026-04-30T03:59:59.999Z"),
      BEST_RELOCATION_CUTOFF,
      readThrough,
    ),
    false,
  );
  assert.equal(
    isWithinIngestionWindow(
      BEST_RELOCATION_CUTOFF,
      BEST_RELOCATION_CUTOFF,
      readThrough,
    ),
    true,
  );
  assert.equal(
    isWithinIngestionWindow(
      readThrough,
      BEST_RELOCATION_CUTOFF,
      readThrough,
    ),
    false,
  );
});

test("stable managed identity survives row reordering", () => {
  const headers = [
    "PHONE NUMBER",
    "Date",
    "Time",
    "vantage_ingestion_id",
  ];
  const first = parseCallRows(
    makeTab("Calls", headers, [
      headers,
      ["5551112222", "5/1/2026", "10:00 AM", managed("1")],
      ["5553334444", "5/1/2026", "11:00 AM", managed("2")],
    ]),
  );
  const reordered = parseCallRows(
    makeTab("Calls", headers, [
      headers,
      ["5553334444", "5/1/2026", "11:00 AM", managed("2")],
      ["5551112222", "5/1/2026", "10:00 AM", managed("1")],
    ]),
  );
  assert.deepEqual(
    first.map(stableSourceRowId).sort(),
    reordered.map(stableSourceRowId).sort(),
  );
  const original = first.find(
    (row) => stableSourceRowId(row) === managed("1"),
  )!;
  const moved = reordered.find(
    (row) => stableSourceRowId(row) === managed("1"),
  )!;
  assert.equal(
    sourceOwnedContentHash(
      original,
      { phone_number: original.phone, timestamp: original.timestamp },
      2,
    ),
    sourceOwnedContentHash(
      moved,
      { phone_number: moved.phone, timestamp: moved.timestamp },
      2,
    ),
  );
});

test("preview never repairs missing managed identities", async () => {
  let writes = 0;
  const tab = makeTab(
    "Calls",
    ["PHONE NUMBER", "Date", "Time", "vantage_ingestion_id"],
    [
      ["PHONE NUMBER", "Date", "Time", "vantage_ingestion_id"],
      ["5551112222", "5/1/2026", "10:00 AM", ""],
    ],
  );
  const result = await inspectOrRepairManagedIdentity(
    {
      spreadsheets: {
        values: {
          update: async () => {
            writes += 1;
            return { data: {} };
          },
          get: async () => ({ data: { values: [] } }),
        },
      },
    } as never,
    tab,
    false,
  );
  assert.equal(result.status, "blocking");
  assert.equal(writes, 0);
});

test("leased identity repair writes empty cells once and verifies read-back", async () => {
  const values = new Map<string, string>();
  const tab = makeTab(
    "Calls",
    ["PHONE NUMBER", "Date", "Time", "vantage_ingestion_id"],
    [
      ["PHONE NUMBER", "Date", "Time", "vantage_ingestion_id"],
      ["5551112222", "5/1/2026", "10:00 AM", ""],
    ],
  );
  const result = await inspectOrRepairManagedIdentity(
    {
      spreadsheets: {
        batchUpdate: async (input: {
          requestBody: {
            requests: Array<{
              findReplace: { replacement: string; range: { startRowIndex: number } };
            }>;
          };
        }) => {
          for (const request of input.requestBody.requests) {
            const row = request.findReplace.range.startRowIndex + 1;
            const range = `'Calls'!D${row}`;
            values.set(range, request.findReplace.replacement);
          }
          return {
            data: {
              replies: input.requestBody.requests.map(() => ({
                findReplace: { occurrencesChanged: 1 },
              })),
            },
          };
        },
        values: {
          batchGet: async (input: { ranges: string[] }) => ({
            data: {
              valueRanges: input.ranges.map((range) => ({
                values: [[values.get(range)]],
              })),
            },
          }),
        },
      },
    } as never,
    tab,
    true,
  );
  assert.equal(result.status, "healthy");
  assert.equal(values.size, 1);
  assert.match([...values.values()][0], /^vantage:[0-9a-f-]{36}$/);
});

test("copied managed identities block repair instead of falling back to row number", async () => {
  const duplicate = managed("1");
  const tab = makeTab(
    "Calls",
    ["PHONE NUMBER", "Date", "Time", "vantage_ingestion_id"],
    [
      ["PHONE NUMBER", "Date", "Time", "vantage_ingestion_id"],
      ["5551112222", "5/1/2026", "10:00 AM", duplicate],
      ["5553334444", "5/1/2026", "11:00 AM", duplicate],
    ],
  );
  const result = await inspectOrRepairManagedIdentity(
    {
      spreadsheets: {
        values: {
          update: async () => ({ data: {} }),
          get: async () => ({ data: { values: [] } }),
        },
      },
    } as never,
    tab,
    true,
  );
  assert.equal(result.status, "blocking");
  assert.match(result.summary, /duplicate/i);
});

test("malformed managed identities block inspection", async () => {
  const tab = makeTab(
    "Calls",
    ["PHONE NUMBER", "Date", "Time", "vantage_ingestion_id"],
    [
      ["PHONE NUMBER", "Date", "Time", "vantage_ingestion_id"],
      ["5551112222", "5/1/2026", "10:00 AM", "copied-row-2"],
    ],
  );
  const result = await inspectOrRepairManagedIdentity(
    { spreadsheets: { values: {} } } as never,
    tab,
    false,
  );
  assert.equal(result.status, "blocking");
  assert.match(result.summary, /malformed/i);
});

test("identity repair never overwrites a value added after inspection", async () => {
  let writes = 0;
  const concurrentId = managed("5");
  const tab = makeTab(
    "Calls",
    ["PHONE NUMBER", "Date", "Time", "vantage_ingestion_id"],
    [
      ["PHONE NUMBER", "Date", "Time", "vantage_ingestion_id"],
      ["5551112222", "5/1/2026", "10:00 AM", ""],
    ],
  );
  const result = await inspectOrRepairManagedIdentity(
    {
      spreadsheets: {
        values: {
          batchGet: async () => ({
            data: { valueRanges: [{ values: [[concurrentId]] }] },
          }),
          batchUpdate: async () => {
            writes += 1;
            return { data: {} };
          },
        },
      },
    } as never,
    tab,
    true,
  );
  assert.equal(result.status, "healthy");
  assert.equal(writes, 0);
});

test("identity repair uses atomic empty-cell replacement", async () => {
  const concurrentId = managed("6");
  let reads = 0;
  let requestedReplacement = "";
  const tab = makeTab(
    "Calls",
    ["PHONE NUMBER", "Date", "Time", "vantage_ingestion_id"],
    [
      ["PHONE NUMBER", "Date", "Time", "vantage_ingestion_id"],
      ["5551112222", "5/1/2026", "10:00 AM", ""],
    ],
  );
  const result = await inspectOrRepairManagedIdentity(
    {
      spreadsheets: {
        batchUpdate: async (input: {
          requestBody: {
            requests: Array<{ findReplace: { replacement: string } }>;
          };
        }) => {
          requestedReplacement =
            input.requestBody.requests[0].findReplace.replacement;
          return {
            data: {
              replies: [{ findReplace: { occurrencesChanged: 0 } }],
            },
          };
        },
        values: {
          batchGet: async () => {
            reads += 1;
            return {
              data: {
                valueRanges: [
                  { values: reads === 1 ? [] : [[concurrentId]] },
                ],
              },
            };
          },
        },
      },
    } as never,
    tab,
    true,
  );
  assert.match(requestedReplacement, /^vantage:/);
  assert.equal(result.status, "healthy");
  assert.doesNotMatch(result.summary, /Repaired 1/);
});

test("application plan is immutable and material changes alter its checksum", () => {
  const data = fixture();
  const first = buildBestRelocationApplicationPlan({
    data,
    trigger: "preview",
    cutoff: BEST_RELOCATION_CUTOFF,
    sourceReadThrough: new Date("2026-05-03T00:00:00.000Z"),
  });
  const second = buildBestRelocationApplicationPlan({
    data,
    trigger: "preview",
    cutoff: BEST_RELOCATION_CUTOFF,
    sourceReadThrough: new Date("2026-05-03T00:00:01.000Z"),
  });
  assert.notEqual(first.checksum, second.checksum);
  assert.match(first.checksum, /^[a-f\d]{64}$/);
});

test("unmatched booking becomes leadless plus one reconciliation conflict", () => {
  const { plan } = buildBestRelocationApplicationPlan({
    data: fixture(),
    trigger: "preview",
    cutoff: BEST_RELOCATION_CUTOFF,
    sourceReadThrough: new Date("2026-05-03T00:00:00.000Z"),
  });
  assert.equal(
    plan.actions.filter(
      (action) => action.command === "create_leadless_booking",
    ).length,
    1,
  );
  assert.equal(
    plan.actions.filter(
      (action) =>
        action.command === "record_conflict" &&
        action.conflict?.type === "ambiguous_lead_match",
    ).length,
    1,
  );
});

test("LID_BestRelo remains matching evidence and never becomes an action", () => {
  const data = fixture(true);
  const { plan } = buildBestRelocationApplicationPlan({
    data,
    trigger: "preview",
    cutoff: BEST_RELOCATION_CUTOFF,
    sourceReadThrough: new Date("2026-05-03T00:00:00.000Z"),
  });
  assert.equal(
    plan.actions.some(
      (action) =>
        action.dataset_key.toLowerCase().includes("lid") ||
        action.stable_source_row_id.includes("lid_best_relo"),
    ),
    false,
  );
});

test("unmatched refund is blocking and cannot guess a cancellation", () => {
  const data = fixture();
  data.refunds = parseRefundRows(
    makeTab(
      "Refunds",
      refundHeaders,
      [
        refundHeaders,
        [
          "5/2/2026",
          "refunded",
          "5/1/2026",
          "Jacob",
          "5/1/2026",
          "UNKNOWN",
          "Other Person",
          "$100",
          "$100",
          "Elavon",
          "Best Relocation Forms",
          managed("3"),
        ],
      ],
      "booked-workbook",
    ),
  );
  const { plan } = buildBestRelocationApplicationPlan({
    data,
    trigger: "preview",
    cutoff: BEST_RELOCATION_CUTOFF,
    sourceReadThrough: new Date("2026-05-03T00:00:00.000Z"),
  });
  assert.equal(
    plan.actions.some(
      (action) => action.command === "create_cancelled_lead",
    ),
    false,
  );
  assert.equal(
    plan.actions.filter(
      (action) => action.conflict?.type === "unmatched_refund",
    ).length,
    1,
  );
});

test("refund matches below the calibrated threshold never cancel", () => {
  const data = fixture();
  data.refunds = parseRefundRows(
    makeTab("Refunds", refundHeaders, [
      refundHeaders,
      [
        "5/2/2026",
        "Pending",
        "5/1/2026 10:00 AM",
        "Different Agent",
        "5/1/2026",
        "P123",
        "Different Customer",
        "$700",
        "$900",
        "Elavon",
        "Best Relocation Forms",
        managed("5"),
      ],
    ]),
  );
  const { plan } = buildBestRelocationApplicationPlan({
    data,
    trigger: "preview",
    cutoff: BEST_RELOCATION_CUTOFF,
    sourceReadThrough: new Date("2026-05-03T00:00:00.000Z"),
  });
  assert.equal(
    plan.actions.some((action) => action.command === "create_cancelled_lead"),
    false,
  );
  assert.equal(
    plan.actions.some(
      (action) => action.conflict?.type === "unmatched_refund",
    ),
    true,
  );
  const conflict = plan.actions.find(
    (action) => action.conflict?.type === "unmatched_refund",
  );
  assert.equal(conflict?.matching?.method, "job_no_unique");
  assert.equal(conflict?.matching?.score, 0.85);
  assert.equal(conflict?.matching?.evidence.length, 2);
});

test("review-only refund evidence does not consume a later corroborated match", () => {
  const data = fixture();
  data.refunds = parseRefundRows(
    makeTab("Refunds", refundHeaders, [
      refundHeaders,
      [
        "5/2/2026",
        "Pending",
        "5/1/2026 9:00 AM",
        "Different Agent",
        "5/1/2026",
        "P123",
        "Different Customer",
        "$700",
        "$900",
        "Elavon",
        "Other Source",
        managed("5"),
      ],
      [
        "5/2/2026",
        "refunded",
        "5/1/2026 10:00 AM",
        "Jacob",
        "5/1/2026",
        "P123",
        "Jane Doe",
        "$700",
        "$900",
        "Elavon",
        "Other Source",
        managed("6"),
      ],
    ]),
  );
  const { plan } = buildBestRelocationApplicationPlan({
    data,
    trigger: "preview",
    cutoff: BEST_RELOCATION_CUTOFF,
    sourceReadThrough: new Date("2026-05-03T00:00:00.000Z"),
  });
  assert.equal(
    plan.actions.filter(
      (action) => action.command === "create_cancelled_lead",
    ).length,
    1,
  );
  assert.equal(
    plan.actions.find(
      (action) => action.command === "create_cancelled_lead",
    )?.matching?.method,
    "job_no_agent",
  );
  assert.equal(
    plan.actions.find(
      (action) => action.conflict?.type === "unmatched_refund",
    )?.matching?.score,
    0.85,
  );
});

test("invalid source rows become isolated conflict actions", () => {
  const data = fixture();
  const headers = [
    "PHONE NUMBER",
    "Date",
    "Time",
    "vantage_ingestion_id",
  ];
  data.calls = parseCallRows(
    makeTab("Calls", headers, [
      headers,
      ["", "5/1/2026", "10:00 AM", managed("4")],
    ]),
  );
  const { plan } = buildBestRelocationApplicationPlan({
    data,
    trigger: "preview",
    cutoff: BEST_RELOCATION_CUTOFF,
    sourceReadThrough: new Date("2026-05-03T00:00:00.000Z"),
  });
  assert.equal(
    plan.actions.filter(
      (action) =>
        action.classification === "invalid" &&
        action.conflict?.type === "schema_drift",
    ).length,
    1,
  );
  assert.equal(
    plan.actions.filter(
      (action) => action.command === "create_leadless_booking",
    ).length,
    1,
  );
});

test("three-way update permits only unchanged canonical source-owned fields", () => {
  assert.deepEqual(
    evaluateSourceOwnedLeadUpdate({
      lead_model: "FormLead",
      originated_from_best_relocation: true,
      last_applied: { name: "Jane Doe", deposit_amount: 100 },
      current_source: { name: "Jane Smith", deposit_amount: 200 },
      current_canonical: { name: "Jane Doe", deposit_amount: 100 },
    }),
    {
      classification: "conflict",
      patch: {},
      conflicts: [
        {
          path: "deposit_amount",
          type: "changed_protected_field",
          previous_source_value: 100,
          current_source_value: 200,
          canonical_value: 100,
        },
      ],
    },
  );
  assert.equal(
    evaluateSourceOwnedLeadUpdate({
      lead_model: "FormLead",
      originated_from_best_relocation: true,
      last_applied: { name: "Jane Doe" },
      current_source: { name: "Jane Smith" },
      current_canonical: { name: "Edited in Vantage" },
    }).classification,
    "conflict",
  );
  assert.deepEqual(
    evaluateSourceOwnedLeadUpdate({
      lead_model: "FormLead",
      originated_from_best_relocation: true,
      last_applied: { name: "Jane Doe" },
      current_source: { name: "Jane Smith" },
      current_canonical: { name: "Jane Doe" },
    }),
    {
      classification: "safe_update",
      patch: { name: "Jane Smith" },
      conflicts: [],
    },
  );
});

test("persistence schemas enforce receipt uniqueness and required indexes", () => {
  assert.ok(
    SourceRowReceipt.schema.indexes().some((entry: unknown) => {
      const [fields, options] = entry as [
        Record<string, unknown>,
        { unique?: boolean },
      ];
      return (
        fields.connection_id === 1 &&
        fields.ingestion_run_id === undefined &&
        fields.dataset_key === 1 &&
        fields.stable_source_row_id === 1 &&
        fields.schema_version === 1 &&
        fields.content_hash === 1 &&
        options.unique === true
      );
    }),
  );
  assert.ok(
    IngestionConflict.schema.indexes().some((entry: unknown) => {
      const [fields] = entry as [Record<string, unknown>];
      return fields.status === 1 && fields.severity === 1;
    }),
  );
  assert.ok(
    SourceRowState.schema.indexes().some((entry: unknown) => {
      const [fields, options] = entry as [
        Record<string, unknown>,
        { unique?: boolean },
      ];
      return (
        fields.connection_id === 1 &&
        fields.dataset_key === 1 &&
        fields.stable_source_row_id === 1 &&
        fields.schema_version === 1 &&
        options.unique === true
      );
    }),
  );
  assert.ok(
    IngestionRun.schema.indexes().some((entry: unknown) => {
      const [fields] = entry as [Record<string, unknown>];
      return fields.status === 1 && fields.createdAt === 1;
    }),
  );
});

test("ingestion run graph makes all terminal states immutable", () => {
  for (const status of [
    "completed",
    "completed_with_errors",
    "failed",
    "skipped",
  ] as const) {
    assert.deepEqual(INGESTION_STATUS_GRAPH[status], []);
  }
  assert.deepEqual(INGESTION_STATUS_GRAPH.awaiting_approval, [
    "applying",
    "failed",
  ]);
});

test("heartbeat gates skip before source reads", () => {
  const now = new Date("2026-05-01T12:00:00.000Z");
  assert.equal(envGateEnabled(undefined), false);
  assert.equal(envGateEnabled("true"), true);
  assert.equal(
    ingestionHeartbeatSkipReason({
      env_enabled: false,
      application_enabled: true,
      next_due_at: null,
      now,
    }),
    "environment_disabled",
  );
  assert.equal(
    ingestionHeartbeatSkipReason({
      env_enabled: true,
      application_enabled: false,
      next_due_at: null,
      now,
    }),
    "application_disabled",
  );
  assert.equal(
    ingestionHeartbeatSkipReason({
      env_enabled: true,
      application_enabled: true,
      next_due_at: new Date("2026-05-02T00:00:00.000Z"),
      now,
    }),
    "not_due",
  );
});

test("apply worker mutates domain state only through canonical commands", async () => {
  for (const file of ["applyPlan.ts", "worker.ts"]) {
    const source = await readFile(path.join(__dirname, file), "utf8");
    assert.doesNotMatch(
      source,
      /models\/(?:FormLead|CallLead|BookedLead|CancelledLead)/,
    );
    assert.doesNotMatch(source, /\/api\/v1\/|fetch\(|axios/i);
  }
});

test("read paths use readonly Sheets scope and repair has a separate writer", async () => {
  const source = await readFile(
    path.join(__dirname, "../bestRelocationSheetIngest/sheets.ts"),
    "utf8",
  );
  assert.match(source, /spreadsheets\.readonly/);
  assert.match(source, /createWritableSheetsClient/);
  const provider = await readFile(
    path.join(__dirname, "../bestRelocationSheetIngest/provider.ts"),
    "utf8",
  );
  assert.match(
    provider,
    /repairIdentity[\s\S]*createWritableSheetsClient\(\)[\s\S]*createSheetsClient\(\)/,
  );
});

test("worker final and failure transitions remain lease-fenced", async () => {
  const source = await readFile(path.join(__dirname, "worker.ts"), "utf8");
  assert.match(source, /finalized\.modifiedCount !== 1/);
  assert.match(source, /lease_owner: lease\.owner/);
  assert.match(source, /lease_epoch: lease\.epoch/);
  const consumer = await readFile(
    path.join(
      __dirname,
      "../../../api/queues/best-relocation-ingestion-consumer.ts",
    ),
    "utf8",
  );
  assert.match(consumer, /status === "lease_busy"/);
  assert.match(consumer, /throw new Error/);
});

test("pre-cutoff observations never enter the application plan", () => {
  const formHeaders = [
    "Time Stamp",
    "Name",
    "Pickup Zip",
    "Destination Zip",
    "Move Size",
    "Move Date",
    "Phone",
    "Lead ID",
    "Ref No",
  ];
  const data = fixture();
  data.forms = parseFormRows(
    makeTab("Forms", formHeaders, [
      formHeaders,
      [
        "4/29/2026 11:00 PM",
        "Early Lead",
        "33101",
        "10001",
        "2 bedrooms",
        "5/10/2026",
        "5550001111",
        "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
        "R-EARLY",
      ],
      [
        "5/1/2026 10:00 AM",
        "In Window",
        "33101",
        "10001",
        "2 bedrooms",
        "5/12/2026",
        "5550002222",
        "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
        "R-WINDOW",
      ],
    ]),
    "Forms",
  ).filter(
    (row) =>
      Boolean(row.timestamp) &&
      isWithinIngestionWindow(
        new Date(row.timestamp!),
        BEST_RELOCATION_CUTOFF,
        new Date("2026-05-03T00:00:00.000Z"),
      ),
  );
  const { plan } = buildBestRelocationApplicationPlan({
    data,
    trigger: "preview",
    cutoff: BEST_RELOCATION_CUTOFF,
    sourceReadThrough: new Date("2026-05-03T00:00:00.000Z"),
  });
  assert.equal(
    plan.actions.filter((action) => action.command === "create_form_lead")
      .length,
    1,
  );
  assert.equal(
    plan.actions.some((action) =>
      JSON.stringify(action).includes("Early Lead"),
    ),
    false,
  );
});

test("refund application window uses Timestamp with exact half-open boundaries", () => {
  const sourceReadThrough = new Date("2026-05-03T00:00:00.000Z");
  const actionsForTimestamp = (timestamp: string) => {
    const data = fixture();
    const [refund] = parseRefundRows(
      makeTab("Refunds", refundHeaders, [
        refundHeaders,
        [
          "5/2/2026",
          "refunded",
          "5/1/2026 10:00 AM",
          "Jacob",
          "5/1/2026",
          "P123",
          "Jane Doe",
          "$700",
          "$900",
          "Elavon",
          "Best Relocation Forms",
          managed("8"),
        ],
      ]),
    );
    refund.timestamp = timestamp;
    data.refunds = [refund];
    return buildBestRelocationApplicationPlan({
      data,
      trigger: "preview",
      cutoff: BEST_RELOCATION_CUTOFF,
      sourceReadThrough,
    }).plan.actions;
  };
  assert.equal(
    actionsForTimestamp("2026-04-30T03:59:59.999Z").some(
      (action) => action.command === "create_cancelled_lead",
    ),
    false,
  );
  assert.equal(
    actionsForTimestamp(BEST_RELOCATION_CUTOFF.toISOString()).filter(
      (action) => action.command === "create_cancelled_lead",
    ).length,
    1,
  );
  assert.equal(
    actionsForTimestamp(sourceReadThrough.toISOString()).some(
      (action) => action.command === "create_cancelled_lead",
    ),
    false,
  );
});

test("one new form lead and one linked refund map to single create actions", () => {
  const lid = "cccccccc-3333-4333-8333-cccccccccccc";
  const formHeaders = [
    "Time Stamp",
    "Name",
    "Pickup Zip",
    "Destination Zip",
    "Move Size",
    "Move Date",
    "Phone",
    "Lead ID",
    "Ref No",
  ];
  const data = fixture();
  data.forms = parseFormRows(
    makeTab("Forms", formHeaders, [
      formHeaders,
      [
        "5/1/2026 9:00 AM",
        "Jane Doe",
        "33101",
        "10001",
        "2 bedrooms",
        "5/15/2026",
        "5551112222",
        lid,
        lid,
      ],
    ]),
    "Forms",
  );
  data.booked = parseBookedDealRows(
    makeTab(
      "Booked Deals",
      bookingHeaders,
      [
        bookingHeaders,
        [
          "5/1/2026 10:00 AM",
          "Jacob",
          "5/1/2026",
          "P123",
          "Jane Doe",
          "$700",
          "$900",
          "Elavon",
          "Best Relocation Forms",
          lid,
          "",
        ],
      ],
      "booked-workbook",
    ),
  );
  data.refunds = parseRefundRows(
    makeTab("Refunds", refundHeaders, [
      refundHeaders,
      [
        "5/2/2026",
        "refunded",
        "5/1/2026 11:00 AM",
        "Different Agent",
        "5/1/2026",
        "P123",
        "Jane Doe",
        "$700",
        "$900",
        "Elavon",
        "Other Source",
        managed("9"),
      ],
    ]),
  );
  const { plan } = buildBestRelocationApplicationPlan({
    data,
    trigger: "preview",
    cutoff: BEST_RELOCATION_CUTOFF,
    sourceReadThrough: new Date("2026-05-03T00:00:00.000Z"),
  });
  assert.equal(
    plan.actions.filter((action) => action.command === "create_form_lead")
      .length,
    1,
  );
  assert.equal(
    plan.actions.filter(
      (action) => action.command === "create_booked_from_source",
    ).length,
    1,
  );
  assert.equal(
    plan.actions.filter(
      (action) => action.command === "create_cancelled_lead",
    ).length,
    1,
  );
  assert.equal(
    plan.actions.find(
      (action) => action.command === "create_cancelled_lead",
    )?.matching?.method,
    "job_no_customer",
  );
});

test("identical evidence is classified unchanged across replans", () => {
  const data = fixture();
  const first = buildBestRelocationApplicationPlan({
    data,
    trigger: "preview",
    cutoff: BEST_RELOCATION_CUTOFF,
    sourceReadThrough: new Date("2026-05-03T00:00:00.000Z"),
  });
  const evidence = new Set(
    first.plan.actions.map(
      (action) =>
        `${action.dataset_key}:${action.stable_source_row_id}:${action.content_hash}`,
    ),
  );
  const second = buildBestRelocationApplicationPlan({
    data,
    trigger: "preview",
    cutoff: BEST_RELOCATION_CUTOFF,
    sourceReadThrough: new Date("2026-05-03T00:00:00.000Z"),
    unchangedEvidence: evidence,
  });
  assert.ok(second.plan.actions.every((action) => action.command === "unchanged"));
  assert.equal(second.plan.counters.unchanged, second.plan.actions.length);
});

test("source evidence reappearance uses the applied baseline, not conflicts", () => {
  assert.equal(
    classifyKnownEvidence({
      previous_applied_content_hash: "hash-a",
      current_source_state: "present",
      incoming_content_hash: "hash-b",
    }),
    "changed",
  );
  assert.equal(
    classifyKnownEvidence({
      // A conflict observing B must not replace this successfully applied A.
      previous_applied_content_hash: "hash-a",
      current_source_state: "present",
      incoming_content_hash: "hash-a",
    }),
    "unchanged",
  );
  assert.equal(
    classifyKnownEvidence({
      previous_applied_content_hash: "hash-a",
      current_source_state: "source_missing",
      incoming_content_hash: "hash-a",
    }),
    "reappeared",
  );
});

test("missing-source actions preserve canonical refs and never delete", () => {
  const action = {
    action_key: "missing:booked_deals:vantage:1:hash",
    command: "record_conflict" as const,
    classification: "conflict" as const,
    dataset_key: "booked_deals",
    stable_source_row_id: managed("1"),
    content_hash: "a".repeat(64),
    schema_profile: "booked_deals:v2",
    schema_version: 2,
    provenance: {
      workbook_id: "booked",
      workbook_title: "Booked",
      tab: "Booked Deals" as const,
      sheet_row: 2,
      source_row_key: managed("1"),
      raw: {},
    },
    depends_on: [],
    adopted_entity_refs: [{ model: "BookedLead", id: "507f1f77bcf86cd799439011" }],
    conflict: { type: "missing_source_row" as const, severity: "warning" as const },
  };
  assert.equal(action.command, "record_conflict");
  assert.equal(action.conflict.type, "missing_source_row");
  assert.equal(action.adopted_entity_refs?.[0]?.model, "BookedLead");
  assert.doesNotMatch(JSON.stringify(action), /delete|soft.?delete/i);
});

test("bootstrap adoption remaps creates to receipt-only adopt_existing", () => {
  assert.equal(typeof planBootstrapAdoption, "function");
  const source = buildBestRelocationApplicationPlan({
    data: fixture(),
    trigger: "bootstrap",
    cutoff: BEST_RELOCATION_CUTOFF,
    sourceReadThrough: new Date("2026-05-03T00:00:00.000Z"),
  }).plan;
  const adopted = {
    ...source,
    actions: source.actions.map((action) =>
      action.command === "create_leadless_booking"
        ? {
            ...action,
            command: "adopt_existing" as const,
            classification: "adoption" as const,
            adopted_entity_refs: [
              { model: "BookedLead", id: "507f1f77bcf86cd799439011" },
            ],
          }
        : action,
    ),
  };
  assert.equal(
    adopted.actions.filter((action) => action.command === "adopt_existing")
      .length,
    1,
  );
  assert.equal(
    adopted.actions.some((action) =>
      [
        "create_form_lead",
        "create_call_lead",
        "create_booked_from_source",
        "create_leadless_booking",
        "create_cancelled_lead",
      ].includes(String(action.command)),
    ),
    false,
  );
});

test("bootstrap adopts nonduplicate calls using DST-aware persisted timestamps", async (t) => {
  const data = fixture();
  data.calls = parseCallRows(
    makeTab("Calls", ["PHONE NUMBER", "Date", "Time", "vantage_ingestion_id"], [
      ["PHONE NUMBER", "Date", "Time", "vantage_ingestion_id"],
      ["305-555-1212", "5/1/2026", "10:00 AM", managed("9")],
    ]),
  );
  const source = buildBestRelocationApplicationPlan({
    data,
    trigger: "bootstrap",
    cutoff: BEST_RELOCATION_CUTOFF,
    sourceReadThrough: new Date("2026-05-03T00:00:00.000Z"),
  }).plan;
  const callAction = source.actions.find(
    (action) => action.command === "create_call_lead",
  )!;
  const winterAction = {
    ...callAction,
    action_key: `${callAction.action_key}:winter`,
    stable_source_row_id: managed("8"),
    content_hash: "f".repeat(64),
    command_payload: {
      ...callAction.command_payload,
      timestamp: "2026-01-15T15:00:00.000Z",
    },
  };
  const capturedFilters: Record<string, unknown>[] = [];
  t.mock.method(CallLead, "find", (filter: Record<string, unknown>) => {
    capturedFilters.push(filter);
    const query = {
      select: () => query,
      limit: () => query,
      lean: () => query,
      exec: async () => [
        {
          _id: "507f1f77bcf86cd799439011",
          ...callAction.source_owned_values,
        },
      ],
    };
    return query as never;
  });

  const summer = await planBootstrapAdoption({
    ...source,
    actions: [callAction],
  });
  const winter = await planBootstrapAdoption({
    ...source,
    actions: [winterAction],
  });

  const summerTimestamp = capturedFilters[0]?.timestamp as
    | { $gte?: Date; $lte?: Date }
    | undefined;
  const winterTimestamp = capturedFilters[1]?.timestamp as
    | { $gte?: Date; $lte?: Date }
    | undefined;
  assert.equal(
    summerTimestamp?.$gte?.toISOString(),
    "2026-05-01T09:59:59.000Z",
  );
  assert.equal(
    summerTimestamp?.$lte?.toISOString(),
    "2026-05-01T10:00:01.000Z",
  );
  assert.equal(
    winterTimestamp?.$gte?.toISOString(),
    "2026-01-15T09:59:59.000Z",
  );
  assert.equal(
    winterTimestamp?.$lte?.toISOString(),
    "2026-01-15T10:00:01.000Z",
  );
  assert.deepEqual(capturedFilters[0]?.duplicate, { $ne: true });
  assert.deepEqual(capturedFilters[1]?.duplicate, { $ne: true });
  assert.equal(summer.actions[0].command, "adopt_existing");
  assert.equal(winter.actions[0].command, "adopt_existing");
});

test("apply resumes from checkpoint without replaying successful actions", async () => {
  const built = buildBestRelocationApplicationPlan({
    data: fixture(),
    trigger: "manual",
    cutoff: BEST_RELOCATION_CUTOFF,
    sourceReadThrough: new Date("2026-05-03T00:00:00.000Z"),
  });
  const leadAction = {
    action_key: "create_form_lead:forms:test",
    command: "create_form_lead" as const,
    classification: "create" as const,
    dataset_key: "forms",
    stable_source_row_id: managed("8"),
    content_hash: "b".repeat(64),
    schema_profile: "forms:v2",
    schema_version: 2,
    provenance: {
      workbook_id: "leads",
      workbook_title: "Leads",
      tab: "Forms" as const,
      sheet_row: 2,
      source_row_key: managed("8"),
      raw: {},
    },
    command_payload: { name: "Lead" },
    depends_on: [],
  };
  const bookingAction = {
    action_key: "create_booked_from_source:booked:test",
    command: "create_booked_from_source" as const,
    classification: "create" as const,
    dataset_key: "booked_deals",
    stable_source_row_id: managed("1"),
    content_hash: "c".repeat(64),
    schema_profile: "booked_deals:v2",
    schema_version: 2,
    provenance: {
      workbook_id: "booked",
      workbook_title: "Booked",
      tab: "Booked Deals" as const,
      sheet_row: 2,
      source_row_key: managed("1"),
      raw: {},
    },
    command_payload: { job_no: "P123" },
    depends_on: [leadAction.action_key],
  };
  const plan = {
    ...built.plan,
    actions: [leadAction, bookingAction],
  };
  const checksum = computeChecksum({
    checksum_version: 1,
    artifact_kind: "ingestion_plan",
    schema_version: plan.schema_version,
    payload: plan,
  });
  const leaseStore = new InMemoryLeaseStore();
  const now = new Date("2026-05-03T12:00:00.000Z");
  const lease = await leaseStore.acquire({
    scope: "ingestion:best_relocation:apply",
    owner: "test-worker",
    ttl_ms: 60_000,
    now,
  });
  assert.ok(lease);
  const commandCalls: string[] = [];
  const receipts: string[] = [];
  const persistence = {
    appendSourceReceipt: async (receipt: Record<string, unknown>) => {
      receipts.push(String(receipt.stable_source_row_id));
      return { id: "r1", inserted: true };
    },
    openIngestionConflict: async () => ({ id: "c1", inserted: true }),
    isIngestionConflictDispositioned: async () => false,
    preallocateReceiptId: () => "507f1f77bcf86cd799439099",
    resolvedActionIdsForRun: async () =>
      new Map([[leadAction.action_key, "507f1f77bcf86cd799439011"]]),
  };
  const actor = createBestRelocationIngestionActor("run-1");
  const result = await applyBestRelocationPlan({
    plan,
    checksum,
    run_id: "507f1f77bcf86cd799439000",
    connection_id: "507f1f77bcf86cd799439001",
    actor,
    initiator: actor,
    lease: lease!,
    leaseStore,
    now: () => now,
    start_action_index: 1,
    initial_completed_units: 3,
    initial_conflict_count: 2,
    initial_skipped_dependency_count: 1,
    commands: {
      createFormLead: async () => {
        commandCalls.push("create_form_lead");
        return {
          status: "applied",
          entity_refs: [{ model: "FormLead", id: "507f1f77bcf86cd799439011" }],
          warnings: [],
        };
      },
      createCallLead: async () => {
        throw new Error("unexpected");
      },
      updateSourceOwnedLead: async () => {
        throw new Error("unexpected");
      },
      createBookingFromLead: async () => {
        commandCalls.push("create_booked_from_source");
        return {
          status: "applied",
          entity_refs: [{ model: "BookedLead", id: "507f1f77bcf86cd799439012" }],
          warnings: [],
        };
      },
      createLeadlessBooking: async () => {
        throw new Error("unexpected");
      },
      attachBookingToLead: async () => {
        throw new Error("unexpected");
      },
      createCancellation: async () => {
        throw new Error("unexpected");
      },
      updateBooking: async () => {
        throw new Error("unexpected");
      },
      createReferralBooking: async () => {
        throw new Error("unexpected");
      },
      createLeadFromGranot: async () => {
        throw new Error("unexpected");
      },
      synchronizeLeadFromGranot: async () => {
        throw new Error("unexpected");
      },
      adoptRingCentralCall: async () => {
        throw new Error("unexpected");
      },
      markRingCentralConvergenceConflict: async () => {
        throw new Error("unexpected");
      },
    },
    persistence,
  });
  assert.deepEqual(commandCalls, ["create_booked_from_source"]);
  assert.equal(result.applied, 1);
  assert.equal(result.completed_units, 4);
  assert.equal(result.conflicts, 2);
  assert.equal(result.skipped_dependencies, 1);
  assert.equal(receipts.length, 1);
});

test("adopt_existing Form Lead supplies the Booking lead_ref without creating a second Lead", async () => {
  const built = buildBestRelocationApplicationPlan({
    data: fixture(),
    trigger: "manual",
    cutoff: BEST_RELOCATION_CUTOFF,
    sourceReadThrough: new Date("2026-05-03T00:00:00.000Z"),
  });
  const leadAction = {
    action_key: "create_form_lead:forms:adopted",
    command: "adopt_existing" as const,
    classification: "adoption" as const,
    dataset_key: "forms",
    stable_source_row_id: managed("8"),
    content_hash: "b".repeat(64),
    schema_profile: "forms:v2",
    schema_version: 2,
    provenance: {
      workbook_id: "leads",
      workbook_title: "Leads",
      tab: "Forms" as const,
      sheet_row: 2,
      source_row_key: managed("8"),
      raw: {},
    },
    depends_on: [],
    adopted_entity_refs: [{ model: "FormLead", id: "507f1f77bcf86cd799439011" }],
  };
  const bookingAction = {
    action_key: "create_booked_from_source:booked:adopted-lead",
    command: "create_booked_from_source" as const,
    classification: "create" as const,
    dataset_key: "booked_deals",
    stable_source_row_id: managed("1"),
    content_hash: "c".repeat(64),
    schema_profile: "booked_deals:v2",
    schema_version: 2,
    provenance: {
      workbook_id: "booked",
      workbook_title: "Booked",
      tab: "Booked Deals" as const,
      sheet_row: 2,
      source_row_key: managed("1"),
      raw: {},
    },
    command_payload: { job_no: "P123" },
    depends_on: [leadAction.action_key],
  };
  const plan = { ...built.plan, actions: [leadAction, bookingAction] };
  const checksum = computeChecksum({
    checksum_version: 1,
    artifact_kind: "ingestion_plan",
    schema_version: plan.schema_version,
    payload: plan,
  });
  const leaseStore = new InMemoryLeaseStore();
  const now = new Date("2026-05-03T12:00:00.000Z");
  const lease = await leaseStore.acquire({
    scope: "ingestion:best_relocation:apply",
    owner: "test-worker",
    ttl_ms: 60_000,
    now,
  });
  assert.ok(lease);
  let bookingLeadRef: unknown;
  const actor = createBestRelocationIngestionActor("run-adopt");
  const result = await applyBestRelocationPlan({
    plan,
    checksum,
    run_id: "507f1f77bcf86cd799439000",
    connection_id: "507f1f77bcf86cd799439001",
    actor,
    initiator: actor,
    lease: lease!,
    leaseStore,
    now: () => now,
    commands: {
      createFormLead: async () => {
        throw new Error("must not mint a second Form Lead");
      },
      createCallLead: async () => {
        throw new Error("unexpected");
      },
      updateSourceOwnedLead: async () => {
        throw new Error("unexpected");
      },
      createBookingFromLead: async (input) => {
        bookingLeadRef = (input.data as { lead_ref?: unknown }).lead_ref;
        return {
          status: "applied",
          entity_refs: [{ model: "BookedLead", id: "507f1f77bcf86cd799439012" }],
          warnings: [],
        };
      },
      createLeadlessBooking: async () => {
        throw new Error("unexpected");
      },
      attachBookingToLead: async () => {
        throw new Error("unexpected");
      },
      createCancellation: async () => {
        throw new Error("unexpected");
      },
      updateBooking: async () => {
        throw new Error("unexpected");
      },
      createReferralBooking: async () => {
        throw new Error("unexpected");
      },
      createLeadFromGranot: async () => {
        throw new Error("unexpected");
      },
      synchronizeLeadFromGranot: async () => {
        throw new Error("unexpected");
      },
      adoptRingCentralCall: async () => {
        throw new Error("unexpected");
      },
      markRingCentralConvergenceConflict: async () => {
        throw new Error("unexpected");
      },
    },
    persistence: {
      appendSourceReceipt: async () => ({ id: "r1", inserted: true }),
      openIngestionConflict: async () => ({ id: "c1", inserted: true }),
      isIngestionConflictDispositioned: async () => false,
      preallocateReceiptId: () => "507f1f77bcf86cd799439099",
      resolvedActionIdsForRun: async () => new Map(),
    },
  });
  assert.equal(bookingLeadRef, "507f1f77bcf86cd799439011");
  assert.equal(result.applied, 1);
  assert.equal(result.completed_units, 2);
});

test("failed lead dependency blocks dependent booking and continues independently", async () => {
  const leadAction = {
    action_key: "create_form_lead:forms:dep",
    command: "create_form_lead" as const,
    classification: "create" as const,
    dataset_key: "forms",
    stable_source_row_id: managed("7"),
    content_hash: "d".repeat(64),
    schema_profile: "forms:v2",
    schema_version: 2,
    provenance: {
      workbook_id: "leads",
      workbook_title: "Leads",
      tab: "Forms" as const,
      sheet_row: 3,
      source_row_key: managed("7"),
      raw: {},
    },
    command_payload: { name: "Bad" },
    depends_on: [],
  };
  const bookingAction = {
    action_key: "create_booked_from_source:booked:dep",
    command: "create_booked_from_source" as const,
    classification: "create" as const,
    dataset_key: "booked_deals",
    stable_source_row_id: managed("1"),
    content_hash: "e".repeat(64),
    schema_profile: "booked_deals:v2",
    schema_version: 2,
    provenance: {
      workbook_id: "booked",
      workbook_title: "Booked",
      tab: "Booked Deals" as const,
      sheet_row: 2,
      source_row_key: managed("1"),
      raw: {},
    },
    command_payload: { job_no: "P123" },
    depends_on: [leadAction.action_key],
  };
  const independent = {
    action_key: "create_call_lead:calls:indep",
    command: "create_call_lead" as const,
    classification: "create" as const,
    dataset_key: "calls",
    stable_source_row_id: managed("6"),
    content_hash: "f".repeat(64),
    schema_profile: "calls:v2",
    schema_version: 2,
    provenance: {
      workbook_id: "leads",
      workbook_title: "Leads",
      tab: "Calls" as const,
      sheet_row: 4,
      source_row_key: managed("6"),
      raw: {},
    },
    command_payload: { phone: "5559998888" },
    depends_on: [],
  };
  const base = buildBestRelocationApplicationPlan({
    data: fixture(),
    trigger: "manual",
    cutoff: BEST_RELOCATION_CUTOFF,
    sourceReadThrough: new Date("2026-05-03T00:00:00.000Z"),
  }).plan;
  const plan = { ...base, actions: [leadAction, bookingAction, independent] };
  const checksum = computeChecksum({
    checksum_version: 1,
    artifact_kind: "ingestion_plan",
    schema_version: plan.schema_version,
    payload: plan,
  });
  const leaseStore = new InMemoryLeaseStore();
  const now = new Date("2026-05-03T12:00:00.000Z");
  const lease = await leaseStore.acquire({
    scope: "ingestion:best_relocation:apply",
    owner: "worker-a",
    ttl_ms: 60_000,
    now,
  });
  const actor = createBestRelocationIngestionActor("run-dep");
  const calls: string[] = [];
  const result = await applyBestRelocationPlan({
    plan,
    checksum,
    run_id: "507f1f77bcf86cd799439000",
    connection_id: "507f1f77bcf86cd799439001",
    actor,
    initiator: actor,
    lease: lease!,
    leaseStore,
    now: () => now,
    commands: {
      createFormLead: async () => {
        calls.push("create_form_lead");
        const error = new Error("invalid lead");
        error.name = "ValidationError";
        throw error;
      },
      createCallLead: async () => {
        calls.push("create_call_lead");
        return {
          status: "applied",
          entity_refs: [{ model: "CallLead", id: "507f1f77bcf86cd799439013" }],
          warnings: [],
        };
      },
      updateSourceOwnedLead: async () => {
        throw new Error("unexpected");
      },
      createBookingFromLead: async () => {
        calls.push("create_booked_from_source");
        return {
          status: "applied",
          entity_refs: [{ model: "BookedLead", id: "507f1f77bcf86cd799439012" }],
          warnings: [],
        };
      },
      createLeadlessBooking: async () => {
        throw new Error("unexpected");
      },
      attachBookingToLead: async () => {
        throw new Error("unexpected");
      },
      createCancellation: async () => {
        throw new Error("unexpected");
      },
      updateBooking: async () => {
        throw new Error("unexpected");
      },
      createReferralBooking: async () => {
        throw new Error("unexpected");
      },
      createLeadFromGranot: async () => {
        throw new Error("unexpected");
      },
      synchronizeLeadFromGranot: async () => {
        throw new Error("unexpected");
      },
      adoptRingCentralCall: async () => {
        throw new Error("unexpected");
      },
      markRingCentralConvergenceConflict: async () => {
        throw new Error("unexpected");
      },
    },
    persistence: {
      appendSourceReceipt: async () => ({ id: "r", inserted: true }),
      openIngestionConflict: async () => ({ id: "c", inserted: true }),
      isIngestionConflictDispositioned: async () => false,
      preallocateReceiptId: () => "507f1f77bcf86cd799439099",
      resolvedActionIdsForRun: async () => new Map(),
    },
  });
  assert.deepEqual(calls, ["create_form_lead", "create_call_lead"]);
  assert.equal(result.failures, 1);
  assert.equal(result.skipped_dependencies, 1);
  assert.equal(result.applied, 1);
});

test("concurrent apply lease acquisition admits only one owner", async () => {
  const store = new InMemoryLeaseStore();
  const now = new Date("2026-05-03T12:00:00.000Z");
  const first = await store.acquire({
    scope: "ingestion:best_relocation:apply",
    owner: "worker-a",
    ttl_ms: 60_000,
    now,
  });
  const second = await store.acquire({
    scope: "ingestion:best_relocation:apply",
    owner: "worker-b",
    ttl_ms: 60_000,
    now,
  });
  assert.ok(first);
  assert.equal(second, null);
});

test("altered plan checksum is rejected before any mutation", async () => {
  const built = buildBestRelocationApplicationPlan({
    data: fixture(),
    trigger: "manual",
    cutoff: BEST_RELOCATION_CUTOFF,
    sourceReadThrough: new Date("2026-05-03T00:00:00.000Z"),
  });
  const leaseStore = new InMemoryLeaseStore();
  const now = new Date();
  const lease = await leaseStore.acquire({
    scope: "ingestion:best_relocation:apply",
    owner: "worker",
    ttl_ms: 60_000,
    now,
  });
  const actor = createBestRelocationIngestionActor("run-check");
  let commands = 0;
  await assert.rejects(
    () =>
      applyBestRelocationPlan({
        plan: built.plan,
        checksum: "0".repeat(64),
        run_id: "507f1f77bcf86cd799439000",
        connection_id: "507f1f77bcf86cd799439001",
        actor,
        initiator: actor,
        lease: lease!,
        leaseStore,
        commands: {
          createFormLead: async () => {
            commands += 1;
            throw new Error("unreachable");
          },
          createCallLead: async () => {
            throw new Error("unreachable");
          },
          updateSourceOwnedLead: async () => {
            throw new Error("unreachable");
          },
          createBookingFromLead: async () => {
            throw new Error("unreachable");
          },
          createLeadlessBooking: async () => {
            throw new Error("unreachable");
          },
          attachBookingToLead: async () => {
            throw new Error("unreachable");
          },
          createCancellation: async () => {
            throw new Error("unreachable");
          },
          updateBooking: async () => {
            throw new Error("unreachable");
          },
          createReferralBooking: async () => {
            throw new Error("unreachable");
          },
          createLeadFromGranot: async () => {
            throw new Error("unreachable");
          },
          synchronizeLeadFromGranot: async () => {
            throw new Error("unreachable");
          },
          adoptRingCentralCall: async () => {
            throw new Error("unreachable");
          },
          markRingCentralConvergenceConflict: async () => {
            throw new Error("unreachable");
          },
        },
      }),
    /checksum/i,
  );
  assert.equal(commands, 0);
});

test("health signals alert on structural and growth thresholds", () => {
  assert.equal(
    shouldAlertIngestionSignal({
      key: "zero_parsed_counts",
      run_id: "r1",
      read_count: 0,
    }),
    true,
  );
  assert.equal(
    shouldAlertIngestionSignal({
      key: "conflict_growth",
      run_id: "r1",
      count: 4,
    }),
    false,
  );
  assert.equal(
    shouldAlertIngestionSignal({
      key: "conflict_growth",
      run_id: "r1",
      count: 5,
    }),
    true,
  );
  const signals = planHealthSignals({
    run_id: "r1",
    read_count: 0,
    counters: { conflict: 5, leadless_booking: 5, unmatched_refund: 5 },
  });
  assert.ok(
    signals.some(
      (signal: IngestionHealthSignal) => signal.key === "zero_parsed_counts",
    ),
  );
  assert.ok(
    signals.some(
      (signal: IngestionHealthSignal) => signal.key === "conflict_growth",
    ),
  );
  assert.ok(
    signals.some(
      (signal: IngestionHealthSignal) => signal.key === "unmatched_refunds",
    ),
  );
});

test("conflict resolve route delegates booking attach to canonical command", async () => {
  const source = await readFile(
    path.join(__dirname, "../../routes/ingestion.routes.ts"),
    "utf8",
  );
  assert.match(source, /canonicalDomainCommands\.attachBookingToLead/);
  assert.doesNotMatch(source, /BookedLead\.(?:updateOne|findByIdAndUpdate|findOneAndUpdate)/);
  assert.doesNotMatch(source, /models\/BookedLead/);
});

const bookingHeaders = [
  "Timestamp",
  "Agent",
  "Book Date",
  "Job Number:",
  "Customer Name",
  "Binder Amount",
  "Deposit Amount",
  "Merchant",
  "Lead Source",
  "LID",
  "Payment Notes",
];

const refundHeaders = [
  "Refund Request Date",
  "Status",
  "Timestamp",
  "Agent",
  "Book Date",
  "Job Number:",
  "Customer Name",
  "Binder Amount",
  "Deposit Amount",
  "Merchant",
  "Lead Source",
  "vantage_ingestion_id",
];

function fixture(includeLidEvidence = false): ParsedWorkbookData {
  const lid = "11111111-1111-4111-8111-111111111111";
  const booked = parseBookedDealRows(
    makeTab(
      "Booked Deals",
      bookingHeaders,
      [
        bookingHeaders,
        [
          "5/1/2026 10:00 AM",
          "Jacob",
          "5/1/2026",
          "P123",
          "Jane Doe",
          "$700",
          "$900",
          "Elavon",
          "Best Relocation Forms",
          includeLidEvidence ? lid : "",
          "",
        ],
      ],
      "booked-workbook",
    ),
  );
  const lidBestRelo = includeLidEvidence
    ? parseLidBestRelo(
        makeTab(
          "LID_BestRelo",
          ["LID", "Bucket"],
          [["LID", "Bucket"], [lid, ">2K"]],
          "booked-workbook",
        ),
      )
    : [];
  return {
    leadsWorkbook: { id: "leads-workbook", title: "Leads" },
    bookedWorkbook: { id: "booked-workbook", title: "Booked" },
    forms: parseFormRows(
      makeTab("Forms", ["Time Stamp"], [["Time Stamp"]]),
      "Forms",
    ),
    localForms: [],
    calls: [],
    booked,
    refunds: [],
    lidBestRelo,
  };
}

function managed(suffix: string): string {
  return `vantage:00000000-0000-4000-8000-00000000000${suffix}`;
}

test("ingestion route errors never expose provider or source details", () => {
  let status = 0;
  let body: Record<string, unknown> | undefined;
  const response = {
    status(value: number) {
      status = value;
      return this;
    },
    json(value: Record<string, unknown>) {
      body = value;
      return this;
    },
  };
  sendIngestionRouteError(
    response as any,
    Object.assign(
      new Error(
        "Google workbook 1abc failed for customer@example.com mongodb://user:pass@host",
      ),
      { statusCode: 500 },
    ),
  );
  assert.equal(status, 500);
  assert.deepEqual(body, {
    ok: false,
    code: "ingestion_internal_error",
    error: "Ingestion request failed",
  });
});
