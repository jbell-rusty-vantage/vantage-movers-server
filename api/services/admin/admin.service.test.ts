import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { inspect } from "node:util";
import mongoose from "mongoose";
import { Agent } from "../../models/Agent";
import { BookedLead } from "../../models/BookedLead";
import { CallLead } from "../../models/CallLead";
import { FormLead } from "../../models/FormLead";
import { registerHistoricalModels } from "../../../scripts/dev_ops/historical/models";
import { toCsv } from "../../utils/csv";
import {
  adminBrowseQuerySchema,
  adminSearchQuerySchema,
} from "../../validation/v1.validation";
import {
  browseAdminResource,
  getAdminResourceDetail,
} from "./adminBrowse.service";
import { exportAdminResourceCsv } from "./adminExport.service";
import { globalAdminSearch } from "./adminSearch.service";

type MutableModel = Record<string, unknown>;
type QueryCapture = {
  filter?: unknown;
  sort?: unknown;
  skip?: number;
  limit?: number;
  populated: string[];
};

const originalFormLeadFind = FormLead.find as unknown;
const originalFormLeadFindById = FormLead.findById as unknown;
const originalFormLeadCount = FormLead.countDocuments as unknown;
const originalCallLeadFind = CallLead.find as unknown;
const originalCallLeadCount = CallLead.countDocuments as unknown;
const originalAgentFind = Agent.find as unknown;
const originalAgentFindById = Agent.findById as unknown;
const originalAgentCount = Agent.countDocuments as unknown;
const originalBookedLeadFind = BookedLead.find as unknown;
const originalBookedLeadCount = BookedLead.countDocuments as unknown;
const originalBookedLeadAggregate = BookedLead.aggregate as unknown;
const historicalModels = registerHistoricalModels();
const originalHistoricalFormLeadFind = historicalModels.FormLead
  .find as unknown;
const originalHistoricalFormLeadCount = historicalModels.FormLead
  .countDocuments as unknown;

afterEach(() => {
  (FormLead as unknown as MutableModel).find = originalFormLeadFind;
  (FormLead as unknown as MutableModel).findById = originalFormLeadFindById;
  (FormLead as unknown as MutableModel).countDocuments = originalFormLeadCount;
  (CallLead as unknown as MutableModel).find = originalCallLeadFind;
  (CallLead as unknown as MutableModel).countDocuments = originalCallLeadCount;
  (Agent as unknown as MutableModel).find = originalAgentFind;
  (Agent as unknown as MutableModel).findById = originalAgentFindById;
  (Agent as unknown as MutableModel).countDocuments = originalAgentCount;
  (BookedLead as unknown as MutableModel).find = originalBookedLeadFind;
  (BookedLead as unknown as MutableModel).countDocuments =
    originalBookedLeadCount;
  (BookedLead as unknown as MutableModel).aggregate =
    originalBookedLeadAggregate;
  (historicalModels.FormLead as unknown as MutableModel).find =
    originalHistoricalFormLeadFind;
  (historicalModels.FormLead as unknown as MutableModel).countDocuments =
    originalHistoricalFormLeadCount;
});

test("admin browse builds filters, pagination, sorting, and response shape", async () => {
  const capture: QueryCapture = { populated: [] };
  const id = new mongoose.Types.ObjectId();
  stubFind(FormLead, capture, [
    {
      _id: id,
      name: "Jane Customer",
      source_company: "Main Site Forms",
      phone_number: "555-111-2222",
    },
  ]);
  stubCount(FormLead, 9);

  const query = adminBrowseQuerySchema.parse({
    q: "Jane",
    source_company: "Main Site Forms",
    booked: "false",
    page: "2",
    limit: "3",
    sort: "timestamp",
    direction: "asc",
  });
  const result = await browseAdminResource("form-leads", query);

  assert.equal(result.page, 2);
  assert.equal(result.limit, 3);
  assert.equal(result.total, 9);
  assert.equal(result.has_next_page, true);
  assert.equal(result.items[0]._id, id.toString());
  assert.equal(result.items[0].database_scope, "production");
  assert.deepEqual(capture.sort, { timestamp: 1 });
  assert.equal(capture.skip, 3);
  assert.equal(capture.limit, 3);
  assert.deepEqual(capture.populated, ["booked", "cancelled"]);
  const filterPreview = inspect(capture.filter, { depth: null });
  assert.match(filterPreview, /Main Site Forms/);
  assert.match(filterPreview, /booked/);
});

test("admin form lead browse excludes duplicates by default", async () => {
  const capture: QueryCapture = { populated: [] };
  stubFind(FormLead, capture, []);
  stubCount(FormLead, 0);

  const query = adminBrowseQuerySchema.parse({ limit: 10 });
  await browseAdminResource("form-leads", query);

  const filterPreview = inspect(capture.filter, { depth: null });
  assert.match(filterPreview, /duplicate/);
  assert.doesNotMatch(filterPreview, /duplicate:\s*true/);
});

test("admin form lead browse filters receiver agent by ObjectId equality", async () => {
  const capture: QueryCapture = { populated: [] };
  const receiverAgentId = new mongoose.Types.ObjectId();
  stubFind(FormLead, capture, []);
  stubCount(FormLead, 0);

  const query = adminBrowseQuerySchema.parse({
    receiver_agent: receiverAgentId.toString(),
    limit: 10,
  });
  await browseAdminResource("form-leads", query);

  const filterPreview = inspect(capture.filter, { depth: null });
  assert.match(filterPreview, /receiver_agent/);
  assert.match(filterPreview, new RegExp(receiverAgentId.toString()));
  assert.doesNotMatch(filterPreview, /\/.*receiver_agent.*\//);
  assert.throws(() =>
    adminBrowseQuerySchema.parse({ receiver_agent: "not-an-object-id" }),
  );
});

test("admin booked lead browse filters source company slugs on the source field", async () => {
  const capture: QueryCapture = { populated: [] };
  stubFind(BookedLead, capture, []);
  stubCount(BookedLead, 0);

  const query = adminBrowseQuerySchema.parse({
    source: "top10_leads",
    limit: 10,
  });
  await browseAdminResource("booked-leads", query);

  const filterPreview = inspect(capture.filter, { depth: null });
  assert.match(filterPreview, /source/);
  assert.match(filterPreview, /top10_leads/);
  assert.doesNotMatch(filterPreview, /source_company/);
});

test("admin booked lead browse resolves legacy source company labels onto source", async () => {
  const capture: QueryCapture = { populated: [] };
  stubFind(BookedLead, capture, []);
  stubCount(BookedLead, 0);

  const query = adminBrowseQuerySchema.parse({
    source_company: "Top10 Forms",
    limit: 10,
  });
  await browseAdminResource("booked-leads", query);

  const filterPreview = inspect(capture.filter, { depth: null });
  assert.match(filterPreview, /top10_leads/);
});

test("admin booked lead browse filters leadless bookings", async () => {
  const capture: QueryCapture = { populated: [] };
  stubFind(BookedLead, capture, []);
  stubCount(BookedLead, 0);

  const query = adminBrowseQuerySchema.parse({ leadless: "true", limit: 10 });
  await browseAdminResource("booked-leads", query);

  assert.equal(query.leadless, true);
  const filterPreview = inspect(capture.filter, { depth: null });
  assert.match(filterPreview, /is_leadless_booking/);
  assert.match(filterPreview, /true/);
});

test("admin agents browse returns metrics for list rows", async () => {
  const agentId = new mongoose.Types.ObjectId();
  stubFind(Agent, { populated: [] }, [
    {
      _id: agentId,
      name: "Alice Agent",
      active: true,
      role: "sales",
    },
  ]);
  stubCount(Agent, 1);
  stubAggregate(BookedLead, [
    {
      agent_key: "alice agent",
      booking_count: 3,
      total_binder_amount: 725.5,
      total_deposit_amount: 1900,
      cancellation_count: 1,
      cancellation_rate: 1 / 3,
    },
  ]);

  const query = adminBrowseQuerySchema.parse({
    limit: 10,
    sort: "name",
    direction: "asc",
  });
  const result = await browseAdminResource("agents", query);

  assert.equal(result.items[0]._id, agentId.toString());
  assert.equal(result.items[0].booking_count, 3);
  assert.equal(result.items[0].total_binder_amount, 725.5);
  assert.equal(result.items[0].total_deposit_amount, 1900);
  assert.equal(result.items[0].cancellation_count, 1);
  assert.equal(result.items[0].cancellation_rate, 1 / 3);
});

test("admin agents browse applies date range to booked lead metrics", async () => {
  const aggregateCapture: { pipeline?: unknown[] } = {};
  stubFind(Agent, { populated: [] }, [
    { _id: new mongoose.Types.ObjectId(), name: "Alice Agent" },
  ]);
  stubCount(Agent, 1);
  stubAggregate(BookedLead, [], aggregateCapture);

  const from = "2026-01-01T00:00:00.000Z";
  const to = "2026-01-31T23:59:59.999Z";
  const query = adminBrowseQuerySchema.parse({ from, to, limit: 10 });
  await browseAdminResource("agents", query);

  const pipelinePreview = inspect(aggregateCapture.pipeline, { depth: null });
  assert.match(pipelinePreview, /book_date/);
  assert.match(pipelinePreview, /\$unwind/);
  assert.match(pipelinePreview, /agent_allocations\.binder_amount/);
  assert.match(pipelinePreview, /is_cancelled/);
  assert.doesNotMatch(pipelinePreview, /createdAt: \{/);
});

test("admin agents browse returns zero metric fields for agents without bookings", async () => {
  stubFind(Agent, { populated: [] }, [
    { _id: new mongoose.Types.ObjectId(), name: "No Booking Agent" },
  ]);
  stubCount(Agent, 1);
  stubAggregate(BookedLead, []);

  const query = adminBrowseQuerySchema.parse({ limit: 10 });
  const result = await browseAdminResource("agents", query);

  assert.equal(result.items[0].booking_count, 0);
  assert.equal(result.items[0].total_binder_amount, 0);
  assert.equal(result.items[0].total_deposit_amount, 0);
  assert.equal(result.items[0].cancellation_count, 0);
  assert.equal(result.items[0].cancellation_rate, 0);
});

test("admin form lead browse can filter to duplicates only", async () => {
  const capture: QueryCapture = { populated: [] };
  stubFind(FormLead, capture, []);
  stubCount(FormLead, 0);

  const query = adminBrowseQuerySchema.parse({ duplicate: "true", limit: 10 });
  await browseAdminResource("form-leads", query);

  const filterPreview = inspect(capture.filter, { depth: null });
  assert.match(filterPreview, /duplicate:\s*true/);
});

test("admin call lead browse excludes duplicates by default", async () => {
  const capture: QueryCapture = { populated: [] };
  stubFind(CallLead, capture, []);
  stubCount(CallLead, 0);

  const query = adminBrowseQuerySchema.parse({ limit: 10 });
  await browseAdminResource("call-leads", query);

  const filterPreview = inspect(capture.filter, { depth: null });
  assert.match(filterPreview, /duplicate/);
  assert.doesNotMatch(filterPreview, /duplicate:\s*true/);
});

test("admin call lead browse can filter to duplicates only", async () => {
  const capture: QueryCapture = { populated: [] };
  stubFind(CallLead, capture, []);
  stubCount(CallLead, 0);

  const query = adminBrowseQuerySchema.parse({ duplicate: "true", limit: 10 });
  await browseAdminResource("call-leads", query);

  const filterPreview = inspect(capture.filter, { depth: null });
  assert.match(filterPreview, /duplicate:\s*true/);
});

test("admin detail lookup returns normalized production record", async () => {
  const id = new mongoose.Types.ObjectId();
  const capture: QueryCapture = { populated: [] };
  stubFindById(FormLead, capture, {
    _id: id,
    name: "Detail Customer",
  });

  const detail = await getAdminResourceDetail(
    "form-leads",
    id.toString(),
    "production",
  );

  assert.equal(detail._id, id.toString());
  assert.equal(detail.database_scope, "production");
  assert.deepEqual(capture.populated, ["booked", "cancelled"]);
});

test("admin agent detail returns metrics consistent with browse enrichment", async () => {
  const id = new mongoose.Types.ObjectId();
  const aggregateCapture: { pipeline?: unknown[] } = {};
  stubFindById(
    Agent,
    { populated: [] },
    {
      _id: id,
      name: "Alice Agent",
      active: true,
      role: "sales",
    },
  );
  stubAggregate(
    BookedLead,
    [
      {
        agent_key: "alice agent",
        booking_count: 2,
        total_binder_amount: 500,
        total_deposit_amount: 1200,
        cancellation_count: 1,
        cancellation_rate: 0.5,
      },
    ],
    aggregateCapture,
  );

  const query = adminBrowseQuerySchema.parse({
    database_scope: "production",
    from: "2026-01-01T00:00:00.000Z",
    to: "2026-01-31T23:59:59.999Z",
  });
  const detail = await getAdminResourceDetail(
    "agents",
    id.toString(),
    "production",
    query,
  );

  assert.equal(detail._id, id.toString());
  assert.equal(detail.booking_count, 2);
  assert.equal(detail.total_binder_amount, 500);
  assert.equal(detail.total_deposit_amount, 1200);
  assert.equal(detail.cancellation_count, 1);
  assert.equal(detail.cancellation_rate, 0.5);
  assert.match(
    inspect(aggregateCapture.pipeline, { depth: null }),
    /book_date/,
  );
});

test("admin historical browse uses historical models and remains read-only", async () => {
  const capture: QueryCapture = { populated: [] };
  stubFind(historicalModels.FormLead, capture, [
    { _id: new mongoose.Types.ObjectId(), name: "Historical" },
  ]);
  stubCount(historicalModels.FormLead, 1);
  (FormLead as unknown as MutableModel).find = () => {
    throw new Error("production model should not be used for historical scope");
  };

  const query = adminBrowseQuerySchema.parse({ database_scope: "historical" });
  const result = await browseAdminResource("form-leads", query);

  assert.equal(result.total, 1);
  assert.equal(result.items[0].database_scope, "historical");
  assert.equal(
    typeof (historicalModels.FormLead as unknown as MutableModel).deleteOne,
    "function",
  );
});

test("global admin search returns grouped results", async () => {
  stubFind(FormLead, { populated: [] }, [
    {
      _id: new mongoose.Types.ObjectId(),
      name: "Jane Customer",
      phone_number: "555-111-2222",
      booked: new mongoose.Types.ObjectId(),
    },
  ]);
  stubOtherSearchModelsEmpty();

  const query = adminSearchQuerySchema.parse({ q: "Jane", limit: 3 });
  const result = await globalAdminSearch(query);

  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].record_type, "form-leads");
  assert.equal(result.groups[0].items[0].database_scope, "production");
  assert.deepEqual(result.groups[0].items[0].badges, ["booked"]);
});

test("admin CSV export uses browse rows and escapes CSV body", async () => {
  stubFind(FormLead, { populated: [] }, [
    {
      _id: new mongoose.Types.ObjectId(),
      name: 'Jane "JJ" Customer',
      email: "jane@example.com",
      phone_number: "555-111-2222",
      source_company: "Main Site Forms",
    },
  ]);
  stubCount(FormLead, 1);

  const query = adminBrowseQuerySchema.parse({ limit: 10 });
  const result = await exportAdminResourceCsv("form-leads", query);

  assert.equal(result.filename, "form-leads-production.csv");
  assert.match(result.csv, /^_id,database_scope,timestamp/);
  assert.match(result.csv, /"Jane ""JJ"" Customer"/);
  assert.match(result.csv, /production/);
});

test("csv helper emits text/csv-compatible header and rows", () => {
  const csv = toCsv([{ name: "A, B", notes: "Line\nTwo" }], ["name", "notes"]);

  assert.equal(csv, 'name,notes\r\n"A, B","Line\nTwo"\r\n');
});

function stubFind(
  model: unknown,
  capture: QueryCapture,
  docs: Record<string, unknown>[],
) {
  (model as MutableModel).find = (filter: unknown) => {
    capture.filter = filter;
    return chain(capture, docs);
  };
}

function stubFindById(
  model: unknown,
  capture: QueryCapture,
  doc: Record<string, unknown> | null,
) {
  (model as MutableModel).findById = (id: string) => {
    capture.filter = { _id: id };
    return chain(capture, doc);
  };
}

function stubCount(model: unknown, count: number) {
  (model as MutableModel).countDocuments = () => ({
    exec: async () => count,
  });
}

function stubAggregate(
  model: unknown,
  rows: Record<string, unknown>[],
  capture?: { pipeline?: unknown[] },
) {
  (model as MutableModel).aggregate = (pipeline: unknown[]) => {
    if (capture) {
      capture.pipeline = pipeline;
    }
    return Promise.resolve(rows);
  };
}

function chain(capture: QueryCapture, result: unknown) {
  return {
    sort(sort: unknown) {
      capture.sort = sort;
      return this;
    },
    skip(skip: number) {
      capture.skip = skip;
      return this;
    },
    limit(limit: number) {
      capture.limit = limit;
      return this;
    },
    populate(path: string) {
      capture.populated.push(path);
      return this;
    },
    lean() {
      return this;
    },
    exec: async () => result,
  };
}

function stubOtherSearchModelsEmpty() {
  const models = [
    "CallLead",
    "BookedLead",
    "CancelledLead",
    "Customer",
    "Agent",
  ] as const;
  for (const modelName of models) {
    const model = mongoose.models[modelName] as unknown as
      | MutableModel
      | undefined;
    if (model) {
      model.find = () => chain({ populated: [] }, []);
    }
  }
}
