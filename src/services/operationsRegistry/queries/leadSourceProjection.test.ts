import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import mongoose from "mongoose";
import { getLeadSourceCompanyModel } from "../../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../../models/LeadSourceGranularity";
import { getLeadSourceLabelMappingModel } from "../../../models/LeadSourceLabelMapping";
import { getGranotCrmSourceModel } from "../../../models/GranotCrmSource";
import { getCplRatePeriodModel } from "../../../models/CplRatePeriod";
import { getRingCentralInboundRouteAssignmentModel } from "../../../models/RingCentralInboundRouteAssignment";
import { getRingCentralInboundRouteModel } from "../../../models/RingCentralInboundRoute";
import { getEntityChangeModel } from "../../../models/EntityChange";
import { OperationsRegistryChange } from "../../../models/OperationsRegistryChange";
import {
  getLeadSourceProjection,
  listLeadSourceProjections,
  PROJECTION_ROUND_TRIP_BOUNDS,
} from "./leadSourceProjection";

const companyId = new mongoose.Types.ObjectId();
const localFeedId = new mongoose.Types.ObjectId();
const longFeedId = new mongoose.Types.ObjectId();
const callFeedId = new mongoose.Types.ObjectId();
const emptyCompanyId = new mongoose.Types.ObjectId();
const emptyFeedId = new mongoose.Types.ObjectId();
const zeroFeedCompanyId = new mongoose.Types.ObjectId();
const mappingLocalId = new mongoose.Types.ObjectId();
const mappingLongId = new mongoose.Types.ObjectId();
const granotSplitId = new mongoose.Types.ObjectId();
const granotOneId = new mongoose.Types.ObjectId();
const routeId = new mongoose.Types.ObjectId();
const assignmentId = new mongoose.Types.ObjectId();

type MutableModel = Record<string, unknown>;

const Company = getLeadSourceCompanyModel();
const Feed = getLeadSourceGranularityModel();
const Mapping = getLeadSourceLabelMappingModel();
const Granot = getGranotCrmSourceModel();
const Cpl = getCplRatePeriodModel();
const Assignment = getRingCentralInboundRouteAssignmentModel();
const Route = getRingCentralInboundRouteModel();
const EntityChange = getEntityChangeModel();

const originals = {
  companyFind: Company.find,
  companyFindById: Company.findById,
  feedFind: Feed.find,
  mappingFind: Mapping.find,
  granotFind: Granot.find,
  cplFind: Cpl.find,
  assignmentFind: Assignment.find,
  routeFind: Route.find,
  entityCreate: EntityChange.create,
  changeCreate: OperationsRegistryChange.create,
};

let mutationWrites = 0;

afterEach(() => {
  (Company as unknown as MutableModel).find = originals.companyFind;
  (Company as unknown as MutableModel).findById = originals.companyFindById;
  (Feed as unknown as MutableModel).find = originals.feedFind;
  (Mapping as unknown as MutableModel).find = originals.mappingFind;
  (Granot as unknown as MutableModel).find = originals.granotFind;
  (Cpl as unknown as MutableModel).find = originals.cplFind;
  (Assignment as unknown as MutableModel).find = originals.assignmentFind;
  (Route as unknown as MutableModel).find = originals.routeFind;
  (EntityChange as unknown as MutableModel).create = originals.entityCreate;
  (OperationsRegistryChange as unknown as MutableModel).create = originals.changeCreate;
  mutationWrites = 0;
});

function lean(result: unknown) {
  return {
    session() {
      return this;
    },
    select() {
      return this;
    },
    sort() {
      return this;
    },
    lean() {
      return this;
    },
    exec: async () => result,
  };
}

const skipConnect = { connect: async () => undefined };

function companyDoc(id: mongoose.Types.ObjectId, overrides: Record<string, unknown> = {}) {
  return {
    _id: id,
    company_slug: "best_relocation_leads",
    name: "Best Relocation",
    owner_label: "Best Relocation",
    aliases: ["Best Relo"],
    active: true,
    sheet_config: { has_bad_tabs: false, projection_mode: "derived_import" },
    ...overrides,
  };
}

function feedDoc(
  id: mongoose.Types.ObjectId,
  overrides: Record<string, unknown> = {},
) {
  return {
    _id: id,
    source_company: companyId,
    granularity_key: "best_relocation_forms",
    channel: "form",
    owner_label: "Web forms",
    crm_label: "Best Relocation Forms",
    aliases: [],
    source_sites: [],
    priority: 0,
    active: true,
    ...overrides,
  };
}

function stubMutationGuards(): void {
  (EntityChange as unknown as MutableModel).create = async () => {
    mutationWrites += 1;
    return [];
  };
  (OperationsRegistryChange as unknown as MutableModel).create = async () => {
    mutationWrites += 1;
    return [];
  };
}

function stubCompleteLeadSource(): void {
  stubMutationGuards();
  const companies = [
    companyDoc(companyId),
    companyDoc(emptyCompanyId, {
      company_slug: "empty_draft",
      name: "Empty Draft",
      owner_label: "Empty Draft",
      active: false,
    }),
    companyDoc(zeroFeedCompanyId, {
      company_slug: "zero_feed_draft",
      name: "Zero Feed Draft",
      owner_label: "Zero Feed Draft",
      active: false,
    }),
  ];
  const feeds = [
    feedDoc(localFeedId, {
      granularity_key: "best_relocation_local",
      owner_label: "Web forms — local moves",
      crm_label: "Best Relocation Locals",
      local: "local",
    }),
    feedDoc(longFeedId, {
      granularity_key: "best_relocation_long",
      owner_label: "Web forms — long-distance",
      crm_label: "Best Relocation Forms",
      local: "long_distance",
    }),
    feedDoc(callFeedId, {
      granularity_key: "best_relocation_calls",
      channel: "call",
      owner_label: "Inbound calls",
      crm_label: "Best Relocation Inbounds",
    }),
    feedDoc(emptyFeedId, {
      source_company: emptyCompanyId,
      granularity_key: "empty_draft_call",
      channel: "call",
      owner_label: "Inbound calls",
      crm_label: "Empty Draft Calls",
      active: false,
    }),
  ];
  (Company as unknown as MutableModel).find = () => lean(companies);
  (Company as unknown as MutableModel).findById = (id: unknown) =>
    lean(companies.find((row) => String(row._id) === String(id)) ?? null);
  (Feed as unknown as MutableModel).find = (query: Record<string, unknown>) => {
    const companyFilter = query.source_company;
    if (companyFilter && typeof companyFilter === "object" && "$in" in companyFilter) {
      const allowed = new Set(
        (companyFilter.$in as mongoose.Types.ObjectId[]).map((value) => String(value)),
      );
      return lean(feeds.filter((feed) => allowed.has(String(feed.source_company))));
    }
    return lean(feeds.filter((feed) => String(feed.source_company) === String(companyFilter)));
  };
  (Mapping as unknown as MutableModel).find = () =>
    lean([
      {
        _id: mappingLocalId,
        label: "Best Relocation Locals",
        namespace: "sheet_lead_source",
        source_company: companyId,
        source_granularity: localFeedId,
        active: true,
        normalized_label: "best relocation locals",
      },
      {
        _id: mappingLongId,
        label: "Best Relocation Forms",
        namespace: "sheet_lead_source",
        source_company: companyId,
        source_granularity: longFeedId,
        active: true,
        normalized_label: "best relocation forms",
      },
    ]);
  (Granot as unknown as MutableModel).find = () =>
    lean([
      {
        _id: granotSplitId,
        granot_label: "Best Relocation",
        lead_created_policy: "create_if_missing",
        outbound_sms: { enabled: true },
        lifecycle_routes: [
          { move_type: "local", source_granularity_id: String(localFeedId) },
          { move_type: "long_distance", source_granularity_id: String(longFeedId) },
        ],
        lead_source_company: companyId,
        enabled: true,
        lifecycle_disposition: "source_scoped_lead",
      },
      {
        _id: granotOneId,
        granot_label: "Best Relocation Calls",
        lead_created_policy: "link_only",
        lifecycle_routes: [
          { move_type: "any", source_granularity_id: String(callFeedId) },
        ],
        lead_source_company: companyId,
        enabled: true,
        lifecycle_disposition: "source_scoped_lead",
      },
    ]);
  (Cpl as unknown as MutableModel).find = () =>
    lean([
      {
        _id: new mongoose.Types.ObjectId(),
        source_granularity: localFeedId,
        amount_cents: 4000,
        effective_from: new Date("2026-01-01T00:00:00.000Z"),
        effective_from_date: "2026-01-01",
      },
    ]);
  (Assignment as unknown as MutableModel).find = () =>
    lean([
      {
        _id: assignmentId,
        route: routeId,
        source_company: companyId,
        source_granularity: callFeedId,
        effective_from: new Date("2026-08-01T00:00:00.000Z"),
        active: true,
      },
    ]);
  (Route as unknown as MutableModel).find = () =>
    lean([
      {
        _id: routeId,
        phone_number: "+19545550142",
        display_label: "Best Relocation inbound queue",
        active: true,
        validation_status: "valid",
      },
    ]);
}

test("detail returns every connection in one request for §7.2", async () => {
  stubCompleteLeadSource();
  const beforeWrites = mutationWrites;
  const detail = await getLeadSourceProjection(String(companyId), skipConnect);
  assert.equal(detail.feeds.items.length, 3);
  const local = detail.feeds.items.find((feed) => feed.id === String(localFeedId));
  const long = detail.feeds.items.find((feed) => feed.id === String(longFeedId));
  const call = detail.feeds.items.find((feed) => feed.id === String(callFeedId));
  assert.ok(local && long && call);
  assert.equal(local.accepted_labels?.items[0]?.label, "Best Relocation Locals");
  assert.equal(long.accepted_labels?.items[0]?.label, "Best Relocation Forms");
  assert.notEqual(local.crm_label, long.crm_label);
  const splitOnLocal = local.granot_names?.items.find((item) => item.id === String(granotSplitId));
  const splitOnLong = long.granot_names?.items.find((item) => item.id === String(granotSplitId));
  assert.ok(splitOnLocal && splitOnLong);
  assert.equal(splitOnLocal.route.shape, "form_by_move_type");
  if (splitOnLocal.route.shape === "form_by_move_type") {
    assert.ok(splitOnLocal.route.selection_rule.includes("move"));
  }
  const oneFeedOnCall = call.granot_names?.items.find((item) => item.id === String(granotOneId));
  assert.ok(oneFeedOnCall);
  assert.equal(oneFeedOnCall.route.shape, "one_feed");
  assert.equal(
    local.granot_names?.items.some((item) => item.id === String(granotOneId)),
    false,
  );
  assert.equal(call.inbound_numbers?.items[0]?.phone_number, "+19545550142");
  assert.ok(local.readiness.lead_cost);
  assert.ok(detail.generated_at);
  assert.ok((detail._round_trips ?? 99) <= PROJECTION_ROUND_TRIP_BOUNDS.detail);
  assert.equal(mutationWrites, beforeWrites);
});

test("two move-type feeds keep separate label sets", async () => {
  stubCompleteLeadSource();
  const detail = await getLeadSourceProjection(String(companyId), skipConnect);
  const labels = detail.feeds.items
    .filter((feed) => feed.channel === "form")
    .map((feed) => feed.accepted_labels?.items.map((item) => item.label));
  assert.deepEqual(labels, [["Best Relocation Locals"], ["Best Relocation Forms"]]);
});

test("empty states are present sections, never absent", async () => {
  stubCompleteLeadSource();
  const list = await listLeadSourceProjections(skipConnect);
  const emptyCompany = list.items.find((item) => item.id === String(emptyCompanyId));
  const zeroFeeds = list.items.find((item) => item.id === String(zeroFeedCompanyId));
  assert.ok(emptyCompany);
  assert.ok(zeroFeeds);
  assert.equal(zeroFeeds.feeds.empty, true);
  assert.deepEqual(zeroFeeds.feeds.items, []);
  const zeroDetail = await getLeadSourceProjection(String(zeroFeedCompanyId), skipConnect);
  assert.equal(zeroDetail.feeds.empty, true);
  const detail = await getLeadSourceProjection(String(emptyCompanyId), skipConnect);
  const feed = detail.feeds.items[0];
  assert.equal(feed.accepted_labels?.empty, true);
  assert.deepEqual(feed.accepted_labels?.items, []);
  assert.equal(feed.granot_names?.empty, true);
  assert.equal(feed.inbound_numbers?.empty, true);
  assert.ok(feed.inbound_numbers);
});

test("list and detail stay under the round-trip bound and write nothing", async () => {
  stubCompleteLeadSource();
  const list = await listLeadSourceProjections(skipConnect);
  assert.ok((list._round_trips ?? 99) <= PROJECTION_ROUND_TRIP_BOUNDS.list);
  const detail = await getLeadSourceProjection(String(companyId), skipConnect);
  assert.ok((detail._round_trips ?? 99) <= PROJECTION_ROUND_TRIP_BOUNDS.detail);
  assert.equal(mutationWrites, 0);
});

test("Owner-facing finding strings keep implementation words out of copy", async () => {
  stubCompleteLeadSource();
  const detail = await getLeadSourceProjection(String(companyId), skipConnect);
  const banned = ["lifecycle", "disposition", "route_key", "lead_model", "policy_version"];
  for (const finding of detail.findings) {
    const blob = `${finding.owner_message} ${finding.owner_action}`;
    for (const word of banned) {
      assert.equal(blob.includes(word), false, `finding copy leaked ${word}`);
    }
    assert.ok(finding.owner_action);
    assert.ok(finding.deep_link);
    assert.ok(finding.advanced.raw_code);
  }
});
