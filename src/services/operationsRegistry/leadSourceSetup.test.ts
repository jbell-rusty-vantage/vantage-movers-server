import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { ClientSession } from "mongoose";
import mongoose from "mongoose";
import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../models/LeadSourceGranularity";
import { getGranotCrmSourceModel } from "../../models/GranotCrmSource";
import { RegistryError } from "./errors";
import { resetRegistryCacheInvalidationForTests } from "./cacheInvalidation";
import { resetGranotCrmSourceCachesForTests } from "./granotCrmSources";
import {
  createLeadSourceSetup,
  deriveSetupKeys,
  previewLeadSourceSetup,
  type LeadSourceSetupCommand,
} from "./leadSourceSetup";
import type { RegistryActorContext, TransactionRunner } from "./types";

const OWNER: RegistryActorContext = {
  actorType: "owner",
  actorId: "admin_owner_ors3",
  actorLabel: "owner@example.test",
  actorRole: "owner",
  requestId: "req_ors3_setup_1",
};

type MutableModel = Record<string, unknown>;

const Company = getLeadSourceCompanyModel();
const Feed = getLeadSourceGranularityModel();
const Granot = getGranotCrmSourceModel();

const originals = {
  companyFind: Company.find,
  companyFindOne: Company.findOne,
  companyFindById: Company.findById,
  companyCreate: Company.create,
  feedFind: Feed.find,
  feedFindOne: Feed.findOne,
  feedFindById: Feed.findById,
  feedCreate: Feed.create,
  granotFindOne: Granot.findOne,
  granotCreate: Granot.create,
};

type Store = {
  companies: Record<string, unknown>[];
  feeds: Record<string, unknown>[];
  granot: Record<string, unknown>[];
};

let store: Store = { companies: [], feeds: [], granot: [] };

afterEach(() => {
  (Company as unknown as MutableModel).find = originals.companyFind;
  (Company as unknown as MutableModel).findOne = originals.companyFindOne;
  (Company as unknown as MutableModel).findById = originals.companyFindById;
  (Company as unknown as MutableModel).create = originals.companyCreate;
  (Feed as unknown as MutableModel).find = originals.feedFind;
  (Feed as unknown as MutableModel).findOne = originals.feedFindOne;
  (Feed as unknown as MutableModel).findById = originals.feedFindById;
  (Feed as unknown as MutableModel).create = originals.feedCreate;
  (Granot as unknown as MutableModel).findOne = originals.granotFindOne;
  (Granot as unknown as MutableModel).create = originals.granotCreate;
  store = { companies: [], feeds: [], granot: [] };
  resetRegistryCacheInvalidationForTests();
  resetGranotCrmSourceCachesForTests();
});

function lean(result: unknown) {
  return {
    session() {
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

function setupDeps(options: { failOnFeed?: boolean } = {}) {
  return {
    withTransaction: rollbackRunner(),
    insertAudit: async () => undefined,
  };
}

function rollbackRunner(): TransactionRunner {
  return async (fn) => {
    const snapshot: Store = {
      companies: store.companies.map((row) => ({ ...row })),
      feeds: store.feeds.map((row) => ({ ...row })),
      granot: store.granot.map((row) => ({ ...row })),
    };
    try {
      return await fn({} as ClientSession);
    } catch (error) {
      store = snapshot;
      throw error;
    }
  };
}

function createdDoc(fields: Record<string, unknown>) {
  return {
    ...fields,
    toObject() {
      return { ...this };
    },
  };
}

function stubHappyPath(options: { failOnFeed?: boolean } = {}): void {
  (Company as unknown as MutableModel).findOne = () => lean(null);
  (Company as unknown as MutableModel).find = () => lean([]);
  (Company as unknown as MutableModel).findById = (id: unknown) =>
    lean(store.companies.find((row) => String(row._id) === String(id)) ?? null);
  (Company as unknown as MutableModel).create = async (docs: Record<string, unknown>[]) => {
    const doc = createdDoc({
      _id: new mongoose.Types.ObjectId(),
      active: false,
      granularities: [],
      ...docs[0],
    });
    store.companies.push(doc);
    return [doc];
  };
  (Feed as unknown as MutableModel).findOne = () => lean(null);
  (Feed as unknown as MutableModel).find = () => lean([]);
  (Feed as unknown as MutableModel).findById = (id: unknown) =>
    lean(store.feeds.find((row) => String(row._id) === String(id)) ?? null);
  (Feed as unknown as MutableModel).create = async (docs: Record<string, unknown>[]) => {
    if (options.failOnFeed) {
      throw new Error("forced mid-transaction feed failure");
    }
    const doc = createdDoc({
      _id: new mongoose.Types.ObjectId(),
      active: false,
      schedule_revision: 0,
      ...docs[0],
    });
    store.feeds.push(doc);
    return [doc];
  };
  (Granot as unknown as MutableModel).findOne = () => lean(null);
  (Granot as unknown as MutableModel).create = async (docs: Record<string, unknown>[]) => {
    const doc = createdDoc({
      _id: new mongoose.Types.ObjectId(),
      enabled: false,
      lifecycle_enabled: false,
      ...docs[0],
    });
    store.granot.push(doc);
    return [doc];
  };
}

function command(overrides: Partial<LeadSourceSetupCommand> = {}): LeadSourceSetupCommand {
  return {
    name: "Synthetic Harbor Leads",
    channel: "form",
    crm_label: "Synthetic Harbor Forms",
    reason: "Owner created this draft lead source from the guided setup",
    ...overrides,
  };
}

test("derives company_slug and granularity_key like paid_overflow", () => {
  assert.deepEqual(deriveSetupKeys("Paid Overflow"), {
    company_slug: "paid_overflow",
    granularity_key: "paid_overflow",
  });
  assert.deepEqual(deriveSetupKeys("TBM Leads"), {
    company_slug: "tbm_leads",
    granularity_key: "tbm_leads",
  });
  assert.deepEqual(deriveSetupKeys("Best Relocation Leads", "local"), {
    company_slug: "best_relocation_leads",
    granularity_key: "best_relocation_leads_local",
  });
});

test("creates one inactive lead source and feed and returns the readiness plan", async () => {
  stubHappyPath();
  const result = await createLeadSourceSetup(command({
    granot: {
      name_received_from_granot: "Synthetic Harbor",
      when_lead_arrives: "create_if_missing",
    },
  }), OWNER, setupDeps());
  assert.equal(result.lead_source.active, false);
  assert.equal(result.feed.active, false);
  assert.equal(result.lead_source.company_slug, "synthetic_harbor_leads");
  assert.equal(result.feed.granularity_key, "synthetic_harbor_leads");
  assert.equal(result.feed.display_name, "Web forms");
  assert.ok(result.granot_name);
  assert.equal(result.granot_name?.text_state, "off");
  assert.deepEqual(
    result.readiness_plan.map((row) => row.gate),
    [
      "Set the lead cost",
      "Activate the lead source",
      "Activate the feed",
      "Switch the Granot name live",
      "Turn on the customer text",
    ],
  );
  assert.equal(result.readiness_plan[2]?.blocked_until, "lead source active and lead cost valid");
  assert.equal(result.readiness_plan[3]?.blocked_until, "feed active");
  assert.equal(
    result.readiness_plan[4]?.blocked_until,
    "Granot name live and create-if-missing and consent attested",
  );
  assert.equal(store.companies.length, 1);
  assert.equal(store.feeds.length, 1);
  assert.equal(store.granot.length, 1);
});

test("skippable Granot still creates a valid inactive lead source and feed", async () => {
  stubHappyPath();
  const result = await createLeadSourceSetup(command(), OWNER, setupDeps());
  assert.equal(result.granot_name, null);
  assert.equal(store.granot.length, 0);
  assert.equal(result.lead_source.active, false);
  assert.equal(result.readiness_plan.at(-1)?.gate, "Connect a Granot name");
  assert.equal(result.readiness_plan.at(-1)?.suggested, true);
});

test("collision on company_slug writes nothing", async () => {
  stubHappyPath();
  (Company as unknown as MutableModel).findOne = () =>
    lean({
      _id: new mongoose.Types.ObjectId(),
      name: "Paid Overflow",
      owner_label: "Paid Overflow",
      company_slug: "synthetic_harbor_leads",
    });
  const before = {
    companies: store.companies.length,
    feeds: store.feeds.length,
    granot: store.granot.length,
  };
  await assert.rejects(
    () => createLeadSourceSetup(command(), OWNER, setupDeps()),
    RegistryError,
  );
  assert.deepEqual(
    {
      companies: store.companies.length,
      feeds: store.feeds.length,
      granot: store.granot.length,
    },
    before,
  );
});

test("crm_label collision against an active same-channel feed writes nothing", async () => {
  stubHappyPath();
  (Feed as unknown as MutableModel).find = (query: Record<string, unknown>) => {
    if (query.active === true && query.channel === "form") {
      return lean([{ _id: new mongoose.Types.ObjectId(), owner_label: "Paid Overflow" }]);
    }
    return lean([]);
  };
  const before = store.companies.length + store.feeds.length;
  await assert.rejects(
    () => createLeadSourceSetup(command(), OWNER, setupDeps()),
    RegistryError,
  );
  assert.equal(store.companies.length + store.feeds.length, before);
});

test("alias collision names both sides and writes nothing", async () => {
  stubHappyPath();
  (Company as unknown as MutableModel).find = () =>
    lean([
      {
        _id: new mongoose.Types.ObjectId(),
        owner_label: "TBM Leads",
        name: "TBM Leads",
        company_slug: "tbm_leads",
      },
    ]);
  await assert.rejects(
    () =>
      createLeadSourceSetup(
        command({ aliases: ["tbm_leads"] }),
        OWNER,
        setupDeps(),
      ),
    (error: unknown) => {
      assert.ok(error instanceof RegistryError);
      assert.match(error.message, /TBM Leads/);
      return true;
    },
  );
  assert.equal(store.companies.length, 0);
});

test("granot label collision writes nothing", async () => {
  stubHappyPath();
  (Granot as unknown as MutableModel).findOne = () =>
    lean({ _id: new mongoose.Types.ObjectId(), granot_label: "Paid Overflow" });
  await assert.rejects(
    () =>
      createLeadSourceSetup(
        command({
          granot: {
            name_received_from_granot: "Paid Overflow",
            when_lead_arrives: "watch_only",
          },
        }),
        OWNER,
        setupDeps(),
      ),
    RegistryError,
  );
  assert.equal(store.companies.length, 0);
  assert.equal(store.granot.length, 0);
});

test("mid-transaction feed failure leaves none of the three", async () => {
  stubHappyPath({ failOnFeed: true });
  await assert.rejects(
    () =>
      createLeadSourceSetup(
        command({
          granot: {
            name_received_from_granot: "Synthetic Harbor",
            when_lead_arrives: "existing_only",
          },
        }),
        OWNER,
        setupDeps(),
      ),
    /forced mid-transaction feed failure/,
  );
  assert.equal(store.companies.length, 0);
  assert.equal(store.feeds.length, 0);
  assert.equal(store.granot.length, 0);
});

test("Paid Overflow-shaped setup creates a new first-class feed and leaves paid_overflow alone", async () => {
  const paidOverflowFeed = {
    _id: new mongoose.Types.ObjectId(),
    granularity_key: "paid_overflow",
    owner_label: "Paid Overflow",
    crm_label: "Paid Overflow",
    source_company: new mongoose.Types.ObjectId(),
  };
  stubHappyPath();
  const existingFeeds = [paidOverflowFeed];
  (Feed as unknown as MutableModel).findOne = (query: Record<string, unknown>) =>
    lean(query.granularity_key === "paid_overflow" ? paidOverflowFeed : null);
  const result = await createLeadSourceSetup(
    command({
      name: "Harbor Overflow Partner",
      crm_label: "Harbor Overflow",
    }),
    OWNER,
    setupDeps(),
  );
  assert.equal(result.feed.granularity_key, "harbor_overflow_partner");
  assert.notEqual(result.feed.granularity_key, "paid_overflow");
  assert.equal(existingFeeds[0]?.crm_label, "Paid Overflow");
  assert.equal(existingFeeds[0]?.granularity_key, "paid_overflow");
});

test("preview runs the same validation and writes nothing", async () => {
  stubHappyPath();
  const preview = await previewLeadSourceSetup(
    command({
      granot: {
        name_received_from_granot: "Synthetic Harbor",
        when_lead_arrives: "create_if_missing",
      },
    }),
  );
  assert.equal(preview.valid, true);
  assert.equal(preview.derived.company_slug, "synthetic_harbor_leads");
  assert.equal(preview.derived.normalized_granot_label, "synthetic harbor");
  assert.equal(store.companies.length, 0);
  assert.equal(store.feeds.length, 0);
  assert.equal(store.granot.length, 0);
  assert.equal(preview.readiness_plan[4]?.gate, "Turn on the customer text");
});

test("preview reports every collision type without writing", async () => {
  stubHappyPath();
  (Company as unknown as MutableModel).findOne = () =>
    lean({ _id: new mongoose.Types.ObjectId(), owner_label: "Taken", name: "Taken" });
  (Feed as unknown as MutableModel).findOne = () =>
    lean({ _id: new mongoose.Types.ObjectId(), owner_label: "Taken Feed" });
  (Feed as unknown as MutableModel).find = () =>
    lean([{ _id: new mongoose.Types.ObjectId(), owner_label: "Active CRM twin" }]);
  (Company as unknown as MutableModel).find = () =>
    lean([
      {
        _id: new mongoose.Types.ObjectId(),
        owner_label: "Alias Owner",
        name: "Alias Owner",
        company_slug: "alias_owner",
      },
    ]);
  (Granot as unknown as MutableModel).findOne = () =>
    lean({ _id: new mongoose.Types.ObjectId(), granot_label: "Taken Granot" });
  const preview = await previewLeadSourceSetup(
    command({
      aliases: ["alias owner"],
      granot: {
        name_received_from_granot: "Taken Granot",
        when_lead_arrives: "watch_only",
      },
    }),
  );
  assert.equal(preview.valid, false);
  const fields = preview.collisions.map((collision) => collision.field);
  assert.ok(fields.includes("company_slug"));
  assert.ok(fields.includes("granularity_key"));
  assert.ok(fields.includes("crm_label"));
  assert.ok(fields.includes("aliases"));
  assert.ok(fields.includes("granot.name_received_from_granot"));
  assert.equal(store.companies.length, 0);
});
