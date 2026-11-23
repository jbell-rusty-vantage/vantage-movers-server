import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { inspect } from "node:util";
import mongoose from "mongoose";
import { Agent } from "../../models/Agent";
import { Merchant } from "../../models/Merchant";
import { BookedLead } from "../../models/BookedLead";
import { CallLead } from "../../models/CallLead";
import { FormLead } from "../../models/FormLead";
import { getLeadMessageModel } from "../../models/LeadMessage";
import { adminBrowseQuerySchema } from "../../validation/v1.validation";
import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../models/LeadSourceGranularity";
import { browseAdminResource } from "./adminBrowse.service";
import { resetAdminFacetsCacheForTests } from "./adminFacets.service";
import { exportAdminResourceCsv } from "./adminExport.service";

type MutableModel = Record<string, unknown>;
type QueryCapture = {
  filter?: unknown;
  sort?: unknown;
  skip?: number;
  limit?: number;
  populated: string[];
};

const originalFormLeadFind = FormLead.find as unknown;
const originalFormLeadCount = FormLead.countDocuments as unknown;
const LeadMessage = getLeadMessageModel();
const originalLeadMessageAggregate = LeadMessage.aggregate as unknown;
const originalCallLeadFind = CallLead.find as unknown;
const originalCallLeadCount = CallLead.countDocuments as unknown;
const originalAgentFind = Agent.find as unknown;
const originalMerchantFind = Merchant.find as unknown;
const originalBookedLeadFind = BookedLead.find as unknown;
const originalBookedLeadAggregate = BookedLead.aggregate as unknown;
const originalBookedLeadCount = BookedLead.countDocuments as unknown;
const SourceCompany = getLeadSourceCompanyModel();
const SourceGranularity = getLeadSourceGranularityModel();
const originalCompanyFind = SourceCompany.find as unknown;
const originalGranularityFind = SourceGranularity.find as unknown;

afterEach(() => {
  (FormLead as unknown as MutableModel).find = originalFormLeadFind;
  (FormLead as unknown as MutableModel).countDocuments = originalFormLeadCount;
  (LeadMessage as unknown as MutableModel).aggregate = originalLeadMessageAggregate;
  (CallLead as unknown as MutableModel).find = originalCallLeadFind;
  (CallLead as unknown as MutableModel).countDocuments = originalCallLeadCount;
  (Agent as unknown as MutableModel).find = originalAgentFind;
  (Merchant as unknown as MutableModel).find = originalMerchantFind;
  (BookedLead as unknown as MutableModel).aggregate = originalBookedLeadAggregate;
  (BookedLead as unknown as MutableModel).find = originalBookedLeadFind;
  (BookedLead as unknown as MutableModel).countDocuments =
    originalBookedLeadCount;
  (SourceCompany as unknown as MutableModel).find = originalCompanyFind;
  (SourceGranularity as unknown as MutableModel).find = originalGranularityFind;
  resetAdminFacetsCacheForTests();
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
  stubAggregateExec(LeadMessage, [{ _id: id }]);

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
  assert.equal("database_scope" in result.items[0], false);
  assert.equal(result.items[0].sms_message_sent, true);
  assert.deepEqual(capture.sort, { timestamp: 1 });
  assert.equal(capture.skip, 3);
  assert.equal(capture.limit, 3);
  assert.deepEqual(capture.populated, ["booked", "cancelled"]);
  const filterPreview = inspect(capture.filter, { depth: null });
  assert.match(filterPreview, /Main Site Forms/);
  assert.match(filterPreview, /booked/);
});

test("admin form lead browse matches source_granularity_key exactly and does not substring-match source_company", async () => {
  const capture: QueryCapture = { populated: [] };
  stubFind(FormLead, capture, []);
  stubCount(FormLead, 0);
  stubCatalogFind([
    {
      _id: "company-top10",
      company_slug: "top10_leads",
      owner_label: "Top 10 Forms",
      active: true,
    },
  ], [
    {
      _id: "aaaaaaaaaaaaaaaaaaaaaaaa",
      source_company: "company-top10",
      granularity_key: "top10_leads_form",
      owner_label: "Top10 Forms",
      crm_label: "Top10 Forms",
      channel: "form",
      active: true,
    },
  ]);

  const query = adminBrowseQuerySchema.parse({
    source_granularity_key: "top10_leads_form",
    source_company: "tbm_leads",
    limit: 10,
  });
  await browseAdminResource("form-leads", query);

  const filterPreview = inspect(capture.filter, { depth: null });
  assert.match(filterPreview, /source_granularity_key/);
  assert.match(filterPreview, /top10_leads_form/);
  assert.match(filterPreview, /source_granularity_id/);
  assert.doesNotMatch(filterPreview, /tbm_leads/);
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

test("booking summary counts and sums the full filtered list before pagination", async () => {
  const capture: QueryCapture = { populated: [] };
  stubFind(BookedLead, capture, [{ deposit_amount: 1 }]);
  const totals = { count: 4, total_binder_amount: 921.25, total_deposit_amount: 190, cancelled_count: 1 };
  (BookedLead as unknown as MutableModel).aggregate = (pipeline: { $match?: unknown }[]) => {
    assert.deepEqual(pipeline[0].$match, capture.filter);
    return { exec: async () => [totals] };
  };
  const query = adminBrowseQuerySchema.parse({ referral: true, limit: 1, include_totals: true });
  const result = await browseAdminResource("booked-leads", query);
  assert.deepEqual(capture.filter, { is_referral_booking: true });
  assert.deepEqual(result.totals, totals);
  assert.equal(result.total, 4);
  assert.equal(result.has_next_page, true);
});

test("admin call lead browse Manual attach filters (name/email/phone without q) include snapshot paths", async () => {
  const capture: QueryCapture = { populated: [] };
  stubFind(CallLead, capture, []);
  stubCount(CallLead, 0);

  const query = adminBrowseQuerySchema.parse({
    name: "Granot-only Name",
    email: "granot@example.invalid",
    phone_number: "555-9999",
    limit: 10,
  });
  await browseAdminResource("call-leads", query);

  const filterPreview = inspect(capture.filter, { depth: null });
  assert.match(filterPreview, /granot_contact_snapshot\.name/);
  assert.match(filterPreview, /ingested_contact_snapshot\.name/);
  assert.match(filterPreview, /granot_contact_snapshot\.email/);
  assert.match(filterPreview, /ingested_contact_snapshot\.email/);
  assert.match(filterPreview, /granot_contact_snapshot\.phone_number/);
  assert.match(filterPreview, /ingested_contact_snapshot\.normalized_phone_number/);
  assert.match(filterPreview, /555-9999/);
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

test("admin form lead browse no_sync false uses $ne true so missing-field rows count", async () => {
  const capture: QueryCapture = { populated: [] };
  stubFind(FormLead, capture, []);
  stubCount(FormLead, 0);

  const query = adminBrowseQuerySchema.parse({ no_sync: "false", limit: 10 });
  await browseAdminResource("form-leads", query);

  const filterPreview = inspect(capture.filter, { depth: null });
  assert.match(filterPreview, /no_sync:\s*\{\s*['"]?\$ne['"]?:\s*true\s*\}/);
  assert.doesNotMatch(filterPreview, /no_sync:[\s\S]*\$exists/);
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
  stubAggregateExec(LeadMessage, []);

  const query = adminBrowseQuerySchema.parse({ limit: 10 });
  const result = await exportAdminResourceCsv("form-leads", query);

  assert.equal(result.filename, "form-leads.csv");
  assert.match(result.csv, /^_id,timestamp/);
  assert.match(result.csv, /"Jane ""JJ"" Customer"/);
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



function stubCount(model: unknown, count: number) {
  (model as MutableModel).countDocuments = () => ({
    exec: async () => count,
  });
}

function stubCatalogFind(
  companies: Record<string, unknown>[],
  granularities: Record<string, unknown>[],
) {
  const queryResult = (rows: Record<string, unknown>[]) => {
    const query = {
      sort: () => query,
      lean: () => query,
      exec: () => Promise.resolve(rows),
    };
    return query;
  };
  (SourceCompany as unknown as MutableModel).find = () => queryResult(companies);
  (SourceGranularity as unknown as MutableModel).find = () => queryResult(granularities);
  (Agent as unknown as MutableModel).find = () => queryResult([]);
  (Merchant as unknown as MutableModel).find = () => queryResult([]);
}

function stubAggregateExec(model: unknown, rows: Record<string, unknown>[]) {
  (model as MutableModel).aggregate = () => ({
    exec: async () => rows,
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
    select() {
      return this;
    },
    lean() {
      return this;
    },
    exec: async () => result,
  };
}
