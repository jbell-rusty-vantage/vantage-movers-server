import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { inspect } from "node:util";
import mongoose from "mongoose";
import { FormLead } from "../../models/FormLead";
import { registerHistoricalModels } from "../../../scripts/historical/models";
import { toCsv } from "../../utils/csv";
import { adminBrowseQuerySchema, adminSearchQuerySchema } from "../../validation/v1.validation";
import { browseAdminResource, getAdminResourceDetail } from "./adminBrowse.service";
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
const historicalModels = registerHistoricalModels();
const originalHistoricalFormLeadFind = historicalModels.FormLead.find as unknown;
const originalHistoricalFormLeadCount = historicalModels.FormLead.countDocuments as unknown;

afterEach(() => {
  (FormLead as unknown as MutableModel).find = originalFormLeadFind;
  (FormLead as unknown as MutableModel).findById = originalFormLeadFindById;
  (FormLead as unknown as MutableModel).countDocuments = originalFormLeadCount;
  (historicalModels.FormLead as unknown as MutableModel).find = originalHistoricalFormLeadFind;
  (historicalModels.FormLead as unknown as MutableModel).countDocuments = originalHistoricalFormLeadCount;
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

test("admin detail lookup returns normalized production record", async () => {
  const id = new mongoose.Types.ObjectId();
  const capture: QueryCapture = { populated: [] };
  stubFindById(FormLead, capture, {
    _id: id,
    name: "Detail Customer",
  });

  const detail = await getAdminResourceDetail("form-leads", id.toString(), "production");

  assert.equal(detail._id, id.toString());
  assert.equal(detail.database_scope, "production");
  assert.deepEqual(capture.populated, ["booked", "cancelled"]);
});

test("admin historical browse uses historical models and remains read-only", async () => {
  const capture: QueryCapture = { populated: [] };
  stubFind(historicalModels.FormLead, capture, [{ _id: new mongoose.Types.ObjectId(), name: "Historical" }]);
  stubCount(historicalModels.FormLead, 1);
  (FormLead as unknown as MutableModel).find = () => {
    throw new Error("production model should not be used for historical scope");
  };

  const query = adminBrowseQuerySchema.parse({ database_scope: "historical" });
  const result = await browseAdminResource("form-leads", query);

  assert.equal(result.total, 1);
  assert.equal(result.items[0].database_scope, "historical");
  assert.equal(typeof (historicalModels.FormLead as unknown as MutableModel).deleteOne, "function");
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

function stubFind(model: unknown, capture: QueryCapture, docs: Record<string, unknown>[]) {
  (model as MutableModel).find = (filter: unknown) => {
    capture.filter = filter;
    return chain(capture, docs);
  };
}

function stubFindById(model: unknown, capture: QueryCapture, doc: Record<string, unknown> | null) {
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
    const model = mongoose.models[modelName] as unknown as MutableModel | undefined;
    if (model) {
      model.find = () => chain({ populated: [] }, []);
    }
  }
}
