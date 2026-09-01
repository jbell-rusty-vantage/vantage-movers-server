import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { ClientSession } from "mongoose";
import mongoose from "mongoose";
import { getGranotCrmSourceModel } from "../../models/GranotCrmSource";
import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../models/LeadSourceGranularity";
import { RegistryError } from "./errors";
import {
  resetRegistryCacheInvalidationForTests,
} from "./cacheInvalidation";
import { resetGranotCrmSourceCachesForTests } from "./granotCrmSources";
import {
  createGranotNameFromOwnerIntent,
  translateOwnerArrivalPolicy,
  translateOwnerHandling,
  workspaceSlugFromNormalizedLabel,
  type OwnerGranotNameCommand,
} from "./ownerGranotNames";
import type { RegistryActorContext, TransactionRunner } from "./types";

const companyId = new mongoose.Types.ObjectId();
const otherCompanyId = new mongoose.Types.ObjectId();
const formFeedId = new mongoose.Types.ObjectId();
const callFeedId = new mongoose.Types.ObjectId();
const localFeedId = new mongoose.Types.ObjectId();
const longFeedId = new mongoose.Types.ObjectId();
const otherLocalFeedId = new mongoose.Types.ObjectId();
const sourceId = new mongoose.Types.ObjectId();

const OWNER: RegistryActorContext = {
  actorType: "owner",
  actorId: "admin_owner_ors2",
  actorLabel: "owner@example.test",
  actorRole: "owner",
  requestId: "req_owner_granot_1",
};

const ADMIN: RegistryActorContext = {
  ...OWNER,
  actorRole: "admin",
  requestId: "req_owner_granot_admin",
};

type MutableModel = Record<string, unknown>;

const Source = getGranotCrmSourceModel();
const Company = getLeadSourceCompanyModel();
const Granularity = getLeadSourceGranularityModel();

const originals = {
  sourceFindById: Source.findById,
  sourceFindOne: Source.findOne,
  sourceCreate: Source.create,
  sourceFindByIdAndUpdate: Source.findByIdAndUpdate,
  companyFindById: Company.findById,
  granularityFindById: Granularity.findById,
};

afterEach(() => {
  (Source as unknown as MutableModel).findById = originals.sourceFindById;
  (Source as unknown as MutableModel).findOne = originals.sourceFindOne;
  (Source as unknown as MutableModel).create = originals.sourceCreate;
  (Source as unknown as MutableModel).findByIdAndUpdate =
    originals.sourceFindByIdAndUpdate;
  (Company as unknown as MutableModel).findById = originals.companyFindById;
  (Granularity as unknown as MutableModel).findById = originals.granularityFindById;
  resetRegistryCacheInvalidationForTests();
  resetGranotCrmSourceCachesForTests();
});

function leanById(result: unknown) {
  return {
    session() {
      return this;
    },
    lean() {
      return this;
    },
    exec: async () => result,
  };
}

function leanFindOne(result: unknown) {
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

function feedDoc(id: mongoose.Types.ObjectId, overrides: Record<string, unknown> = {}) {
  return {
    _id: id,
    source_company: companyId,
    active: true,
    channel: "form",
    local: "local",
    ...overrides,
  };
}

function stubCatalog(): void {
  (Company as unknown as MutableModel).findById = (id: unknown) => {
    const value = String(id);
    if (value === String(otherCompanyId)) {
      return leanById({ _id: otherCompanyId, active: true });
    }
    if (value === String(companyId)) {
      return leanById({ _id: companyId, active: true });
    }
    return leanById(null);
  };
  (Granularity as unknown as MutableModel).findById = (id: unknown) => {
    const value = String(id);
    const rows: Record<string, Record<string, unknown>> = {
      [String(formFeedId)]: feedDoc(formFeedId, { channel: "form", local: undefined }),
      [String(callFeedId)]: feedDoc(callFeedId, { channel: "call", local: undefined }),
      [String(localFeedId)]: feedDoc(localFeedId, { channel: "form", local: "local" }),
      [String(longFeedId)]: feedDoc(longFeedId, { channel: "form", local: "long_distance" }),
      [String(otherLocalFeedId)]: feedDoc(otherLocalFeedId, {
        channel: "form",
        local: "local",
        source_company: otherCompanyId,
      }),
    };
    return leanById(rows[value] ?? null);
  };
}

function stubCreatePath(created: Record<string, unknown>): void {
  (Source as unknown as MutableModel).findOne = () => leanFindOne(null);
  (Source as unknown as MutableModel).create = async () => [
    {
      ...created,
      toObject() {
        return { ...this };
      },
    },
  ];
}

function ownerIntent(
  overrides: Partial<OwnerGranotNameCommand> = {},
): OwnerGranotNameCommand {
  return {
    name_received_from_granot: "Synthetic TBM Forms Prime",
    handling: "our_lead_source",
    destination: { kind: "one_feed", feed_id: String(formFeedId) },
    when_lead_arrives: "create_if_missing",
    reason: "Owner created this Granot name for a form Feed",
    ...overrides,
  };
}

function createdRecord(overrides: Record<string, unknown> = {}) {
  return {
    _id: sourceId,
    crm_origin: "https://eagle.example.test",
    workspace_slug: "synthetic-tbm-forms-prime",
    granot_label: "Synthetic TBM Forms Prime",
    normalized_granot_label: "synthetic tbm forms prime",
    default_channel: "form",
    source_company: "not_provided",
    enabled: false,
    lifecycle_enabled: false,
    lifecycle_disposition: "source_scoped_lead",
    lead_created_policy: "create_if_missing",
    lead_source_company: companyId,
    lifecycle_routes: [
      {
        route_key: "any",
        lead_model: "FormLead",
        move_type: "any",
        source_granularity_id: formFeedId,
      },
    ],
    lifecycle_policy_version: "",
    ...overrides,
  };
}

const passthroughTx: TransactionRunner = async (fn) => fn({} as ClientSession);
const auditDeps = {
  withTransaction: passthroughTx,
  insertAudit: async () => undefined,
};

test("translation table maps handling and arrival policy exactly", () => {
  assert.equal(translateOwnerHandling("our_lead_source"), "source_scoped_lead");
  assert.equal(translateOwnerHandling("referral_booking"), "referral_booking");
  assert.equal(translateOwnerHandling("watch_only"), "deferred");
  assert.equal(translateOwnerArrivalPolicy("watch_only"), "observation_only");
  assert.equal(translateOwnerArrivalPolicy("existing_only"), "link_only");
  assert.equal(translateOwnerArrivalPolicy("create_if_missing"), "create_if_missing");
  assert.equal(
    workspaceSlugFromNormalizedLabel("synthetic tbm forms prime"),
    "synthetic-tbm-forms-prime",
  );
});

test("one_feed create is inactive, SMS-off, one any route, lead_model derived from the Feed", async () => {
  stubCatalog();
  stubCreatePath(createdRecord());
  const captured: Record<string, unknown>[] = [];
  const originalCreate = Source.create;
  (Source as unknown as MutableModel).create = async (docs: unknown[]) => {
    captured.push(docs[0] as Record<string, unknown>);
    return originalCreate.call.length
      ? [
          {
            ...createdRecord(),
            toObject() {
              return { ...this };
            },
          },
        ]
      : [
          {
            ...createdRecord(),
            toObject() {
              return { ...this };
            },
          },
        ];
  };

  const audits: Array<{ entityType?: string; action?: string; reason?: string }> = [];
  const result = await createGranotNameFromOwnerIntent(ownerIntent(), OWNER, {
    ...auditDeps,
    insertAudit: async (_session, input) => {
      audits.push({
        entityType: input.entityType,
        action: input.action,
        reason: input.reason,
      });
    },
  });
  assert.equal(result.enabled, false);
  assert.equal(result.lifecycle_enabled, false);
  assert.equal(result.lead_created_policy, "create_if_missing");
  assert.equal(result.lifecycle_disposition, "source_scoped_lead");
  assert.equal(result.lifecycle_routes.length, 1);
  assert.equal(result.lifecycle_routes[0]?.route_key, "any");
  assert.equal(result.lifecycle_routes[0]?.lead_model, "FormLead");
  assert.equal(result.lifecycle_routes[0]?.source_granularity_id, String(formFeedId));
  assert.equal(result.outbound_sms?.enabled, false);
  assert.equal("source_company" in result, false);
  assert.equal(result.gates.this_name_is_switched_on, false);
  assert.equal(result.gates.this_name_is_used_in_live_processing, false);
  assert.equal(result.gates.customer_text_is_on, false);
  assert.equal(result.gates.choosing_create_if_missing_does_not_make_texting_live, true);
  assert.equal(captured[0]?.enabled, false);
  assert.equal(captured[0]?.lifecycle_enabled, false);
  assert.equal(captured[0]?.source_company, "not_provided");
  assert.equal(captured[0]?.workspace_slug, "synthetic-tbm-forms-prime");
  assert.equal(audits[0]?.entityType, "granot_crm_source");
  assert.equal(audits[0]?.action, "create");
  assert.equal(audits[0]?.reason, "Owner created this Granot name for a form Feed");
});

test("one_feed Call Feed derives CallLead", async () => {
  stubCatalog();
  stubCreatePath(
    createdRecord({
      default_channel: "call",
      lifecycle_routes: [
        {
          route_key: "any",
          lead_model: "CallLead",
          move_type: "any",
          source_granularity_id: callFeedId,
        },
      ],
    }),
  );
  const captured: Record<string, unknown>[] = [];
  (Source as unknown as MutableModel).create = async (docs: unknown[]) => {
    captured.push(docs[0] as Record<string, unknown>);
    return [
      {
        ...createdRecord({
          default_channel: "call",
          lifecycle_routes: [
            {
              route_key: "any",
              lead_model: "CallLead",
              move_type: "any",
              source_granularity_id: callFeedId,
            },
          ],
        }),
        toObject() {
          return { ...this };
        },
      },
    ];
  };

  const result = await createGranotNameFromOwnerIntent(
    ownerIntent({
      destination: { kind: "one_feed", feed_id: String(callFeedId) },
    }),
    OWNER,
    auditDeps,
  );
  assert.equal(result.lifecycle_routes[0]?.lead_model, "CallLead");
  const routes = captured[0]?.lifecycle_routes as Array<{ lead_model: string }>;
  assert.equal(routes[0]?.lead_model, "CallLead");
});

test("Owner create accepts an inactive Feed on an inactive Lead Source as a draft", async () => {
  stubCatalog();
  (Company as unknown as MutableModel).findById = (id: unknown) => {
    if (String(id) === String(companyId)) {
      return leanById({ _id: companyId, active: false });
    }
    return leanById(null);
  };
  (Granularity as unknown as MutableModel).findById = (id: unknown) => {
    if (String(id) === String(formFeedId)) {
      return leanById(feedDoc(formFeedId, { channel: "form", local: undefined, active: false }));
    }
    return leanById(null);
  };
  stubCreatePath(createdRecord());
  const result = await createGranotNameFromOwnerIntent(ownerIntent(), OWNER, auditDeps);
  assert.equal(result.enabled, false);
  assert.equal(result.lifecycle_enabled, false);
  assert.equal(String(result.lifecycle_routes[0]?.source_granularity_id), String(formFeedId));
});

test("submitted lead_source_id that disagrees with the Feed is rejected naming both sides", async () => {
  stubCatalog();
  (Source as unknown as MutableModel).findOne = () => leanFindOne(null);
  await assert.rejects(
    () =>
      createGranotNameFromOwnerIntent(
        ownerIntent({ lead_source_id: String(otherCompanyId) }),
        OWNER,
        auditDeps,
      ),
    (error: unknown) =>
      error instanceof RegistryError &&
      String(error.message).includes(String(otherCompanyId)) &&
      String(error.message).includes(String(companyId)),
  );
});

test("watch_only with a non-null destination is rejected", async () => {
  stubCatalog();
  (Source as unknown as MutableModel).findOne = () => leanFindOne(null);
  await assert.rejects(
    () =>
      createGranotNameFromOwnerIntent(
        ownerIntent({
          handling: "watch_only",
          when_lead_arrives: "watch_only",
          destination: { kind: "one_feed", feed_id: String(formFeedId) },
        }),
        OWNER,
        auditDeps,
      ),
    /cannot have a destination/,
  );
});

test("duplicate normalized name is rejected before write", async () => {
  stubCatalog();
  (Source as unknown as MutableModel).findOne = () =>
    leanFindOne({ _id: sourceId, granot_label: "Synthetic TBM Forms Prime" });
  let created = false;
  (Source as unknown as MutableModel).create = async () => {
    created = true;
    return [];
  };
  await assert.rejects(
    () => createGranotNameFromOwnerIntent(ownerIntent(), OWNER, auditDeps),
    /already held/,
  );
  assert.equal(created, false);
});

test("short reason is rejected after the name check", async () => {
  stubCatalog();
  (Source as unknown as MutableModel).findOne = () => leanFindOne(null);
  await assert.rejects(
    () =>
      createGranotNameFromOwnerIntent(ownerIntent({ reason: "too short" }), OWNER, auditDeps),
    /10 to 1000/,
  );
});

test("form_by_move_type with two Call Feeds is rejected", async () => {
  stubCatalog();
  (Source as unknown as MutableModel).findOne = () => leanFindOne(null);
  const callA = String(callFeedId);
  const callB = String(formFeedId);
  (Granularity as unknown as MutableModel).findById = (id: unknown) =>
    leanById(feedDoc(new mongoose.Types.ObjectId(String(id)), { channel: "call" }));
  await assert.rejects(
    () =>
      createGranotNameFromOwnerIntent(
        ownerIntent({
          destination: {
            kind: "form_by_move_type",
            local_feed_id: callA,
            long_distance_feed_id: callB,
          },
        }),
        OWNER,
        auditDeps,
      ),
    /two Form Feeds/,
  );
});

test("form_by_move_type with two local Feeds is rejected", async () => {
  stubCatalog();
  (Source as unknown as MutableModel).findOne = () => leanFindOne(null);
  await assert.rejects(
    () =>
      createGranotNameFromOwnerIntent(
        ownerIntent({
          destination: {
            kind: "form_by_move_type",
            local_feed_id: String(localFeedId),
            long_distance_feed_id: String(otherLocalFeedId),
          },
        }),
        OWNER,
        auditDeps,
      ),
    /long-distance Form Feed/,
  );
});

test("form_by_move_type with the same Feed twice is rejected", async () => {
  stubCatalog();
  (Source as unknown as MutableModel).findOne = () => leanFindOne(null);
  await assert.rejects(
    () =>
      createGranotNameFromOwnerIntent(
        ownerIntent({
          destination: {
            kind: "form_by_move_type",
            local_feed_id: String(localFeedId),
            long_distance_feed_id: String(localFeedId),
          },
        }),
        OWNER,
        auditDeps,
      ),
    /same Feed twice/,
  );
});

test("form_by_move_type with Feeds from different Lead Sources is rejected", async () => {
  stubCatalog();
  (Source as unknown as MutableModel).findOne = () => leanFindOne(null);
  await assert.rejects(
    () =>
      createGranotNameFromOwnerIntent(
        ownerIntent({
          destination: {
            kind: "form_by_move_type",
            local_feed_id: String(otherLocalFeedId),
            long_distance_feed_id: String(longFeedId),
          },
        }),
        OWNER,
        auditDeps,
      ),
    /different Lead Sources/,
  );
});

test("form_by_move_type writes two FormLead routes keyed by move type", async () => {
  stubCatalog();
  (Source as unknown as MutableModel).findOne = () => leanFindOne(null);
  const captured: Record<string, unknown>[] = [];
  (Source as unknown as MutableModel).create = async (docs: unknown[]) => {
    captured.push(docs[0] as Record<string, unknown>);
    return [
      {
        ...createdRecord({
          lifecycle_routes: [
            {
              route_key: "form_local",
              lead_model: "FormLead",
              move_type: "local",
              source_granularity_id: localFeedId,
            },
            {
              route_key: "form_long",
              lead_model: "FormLead",
              move_type: "long_distance",
              source_granularity_id: longFeedId,
            },
          ],
        }),
        toObject() {
          return { ...this };
        },
      },
    ];
  };
  const result = await createGranotNameFromOwnerIntent(
    ownerIntent({
      destination: {
        kind: "form_by_move_type",
        local_feed_id: String(localFeedId),
        long_distance_feed_id: String(longFeedId),
      },
    }),
    OWNER,
    auditDeps,
  );
  assert.equal(result.lifecycle_routes.length, 2);
  assert.equal(result.lifecycle_routes[0]?.move_type, "local");
  assert.equal(result.lifecycle_routes[1]?.move_type, "long_distance");
  const routes = captured[0]?.lifecycle_routes as Array<{ lead_model: string }>;
  assert.equal(routes.every((route) => route.lead_model === "FormLead"), true);
});

test("referral_booking translates to referral disposition and observation_only", async () => {
  stubCatalog();
  (Source as unknown as MutableModel).findOne = () => leanFindOne(null);
  const captured: Record<string, unknown>[] = [];
  (Source as unknown as MutableModel).create = async (docs: unknown[]) => {
    captured.push(docs[0] as Record<string, unknown>);
    return [
      {
        ...createdRecord({
          lifecycle_disposition: "referral_booking",
          lead_created_policy: "observation_only",
          lead_source_company: undefined,
          lifecycle_routes: [],
        }),
        toObject() {
          return { ...this };
        },
      },
    ];
  };
  const result = await createGranotNameFromOwnerIntent(
    ownerIntent({
      handling: "referral_booking",
      destination: null,
      when_lead_arrives: "watch_only",
    }),
    OWNER,
    auditDeps,
  );
  assert.equal(result.lifecycle_disposition, "referral_booking");
  assert.equal(result.lead_created_policy, "observation_only");
  assert.equal(captured[0]?.lifecycle_disposition, "referral_booking");
  assert.equal(captured[0]?.lead_created_policy, "observation_only");
});

test("watch_only translates to deferred and observation_only", async () => {
  stubCatalog();
  (Source as unknown as MutableModel).findOne = () => leanFindOne(null);
  const captured: Record<string, unknown>[] = [];
  (Source as unknown as MutableModel).create = async (docs: unknown[]) => {
    captured.push(docs[0] as Record<string, unknown>);
    return [
      {
        ...createdRecord({
          lifecycle_disposition: "deferred",
          lead_created_policy: "observation_only",
          lead_source_company: undefined,
          lifecycle_routes: [],
        }),
        toObject() {
          return { ...this };
        },
      },
    ];
  };
  const result = await createGranotNameFromOwnerIntent(
    ownerIntent({
      handling: "watch_only",
      destination: null,
      when_lead_arrives: "watch_only",
    }),
    OWNER,
    auditDeps,
  );
  assert.equal(result.lifecycle_disposition, "deferred");
  assert.equal(captured[0]?.lifecycle_disposition, "deferred");
});

test("non-Owner actors cannot create a Granot name", async () => {
  await assert.rejects(
    () => createGranotNameFromOwnerIntent(ownerIntent(), ADMIN),
    (error: unknown) =>
      error instanceof RegistryError && error.registryCode === "REGISTRY_FORBIDDEN",
  );
});

