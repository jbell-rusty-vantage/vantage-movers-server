import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import mongoose from "mongoose";
import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../models/LeadSourceGranularity";
import { getRingCentralInboundRouteModel } from "../../models/RingCentralInboundRoute";
import { getRingCentralInboundRouteAssignmentModel } from "../../models/RingCentralInboundRouteAssignment";
import { getCallLeadModel } from "../../models/CallLead";
import type { ClientSession } from "mongoose";
import { RegistryError } from "./errors";
import {
  activateRingCentralRoute,
  getRingCentralInboundRoute,
  previewRingCentralRouteDependencies,
  reassignRingCentralRoute,
} from "./ringCentralRegistry";
import type { TransactionRunner } from "./types";
import { ringCentralRouteAssignmentSchema } from "../../validation/v1/operationsRegistry.validation";
import type { RegistryActorContext } from "./types";

const OWNER: RegistryActorContext = {
  actorType: "owner",
  actorId: "admin_owner_ors3_rc",
  actorLabel: "owner@example.test",
  actorRole: "owner",
  requestId: "req_ors3_rc_1",
};

const routeId = new mongoose.Types.ObjectId();
const companyId = new mongoose.Types.ObjectId();
const callFeedId = new mongoose.Types.ObjectId();
const formFeedId = new mongoose.Types.ObjectId();
const inactiveFeedId = new mongoose.Types.ObjectId();
const assignmentId = new mongoose.Types.ObjectId();

type MutableModel = Record<string, unknown>;

const Route = getRingCentralInboundRouteModel();
const Assignment = getRingCentralInboundRouteAssignmentModel();
const CallLead = getCallLeadModel();
const Company = getLeadSourceCompanyModel();
const Feed = getLeadSourceGranularityModel();

const originals = {
  routeFindById: Route.findById,
  routeExists: Route.exists,
  assignmentFind: Assignment.find,
  assignmentCount: Assignment.countDocuments,
  callLeadCount: CallLead.countDocuments,
  companyFind: Company.find,
  companyFindById: Company.findById,
  feedFind: Feed.find,
  feedFindById: Feed.findById,
};

afterEach(() => {
  (Route as unknown as MutableModel).findById = originals.routeFindById;
  (Route as unknown as MutableModel).exists = originals.routeExists;
  (Assignment as unknown as MutableModel).find = originals.assignmentFind;
  (Assignment as unknown as MutableModel).countDocuments = originals.assignmentCount;
  (CallLead as unknown as MutableModel).countDocuments = originals.callLeadCount;
  (Company as unknown as MutableModel).find = originals.companyFind;
  (Company as unknown as MutableModel).findById = originals.companyFindById;
  (Feed as unknown as MutableModel).find = originals.feedFind;
  (Feed as unknown as MutableModel).findById = originals.feedFindById;
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

test("assignment DTO carries Lead Source and Feed labels from one bounded join", async () => {
  (Route as unknown as MutableModel).findById = () =>
    lean({
      _id: routeId,
      phone_number: "+19545550142",
      phone_locked: true,
      display_label: "Best Relocation inbound queue",
      active: true,
      ever_activated: true,
      observed_target_names: [],
      validation_status: "valid",
      created_from: "admin",
    });
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
  (Company as unknown as MutableModel).find = () =>
    lean([
      {
        _id: companyId,
        name: "Best Relocation",
        owner_label: "Best Relocation",
        company_slug: "best_relocation_leads",
      },
    ]);
  (Feed as unknown as MutableModel).find = () =>
    lean([
      {
        _id: callFeedId,
        owner_label: "Inbound calls",
        granularity_key: "best_relocation_calls",
        channel: "call",
      },
    ]);

  const item = await getRingCentralInboundRoute(String(routeId));
  assert.equal(item.current_assignment?.lead_source_name, "Best Relocation");
  assert.equal(item.current_assignment?.lead_source_company_slug, "best_relocation_leads");
  assert.equal(item.current_assignment?.feed_display_name, "Inbound calls");
  assert.equal(item.current_assignment?.granularity_key, "best_relocation_calls");
  assert.equal(item.current_assignment?.channel, "call");
  assert.ok(item.current_assignment?.effective_from);
  assert.equal(item.assignment_history?.[0]?.lead_source_name, "Best Relocation");
});

test("reassignment request carrying a company ID is still rejected", () => {
  const result = ringCentralRouteAssignmentSchema.safeParse({
    source_granularity_id: String(callFeedId),
    source_company_id: String(companyId),
    reason: "Move this number to another live call feed",
  });
  assert.equal(result.success, false);
  assert.equal(result.error?.issues[0]?.code, "unrecognized_keys");
});

test("activation still rejects an inactive or non-call feed", async () => {
  (Route as unknown as MutableModel).findById = () =>
    lean({
      _id: routeId,
      active: false,
      validation_status: "valid",
      validated_at: new Date(),
    });
  (Feed as unknown as MutableModel).findById = (id: unknown) => {
    const value = String(id);
    if (value === String(formFeedId)) {
      return lean({
        _id: formFeedId,
        active: true,
        channel: "form",
        source_company: companyId,
      });
    }
    return lean({
      _id: inactiveFeedId,
      active: false,
      channel: "call",
      source_company: companyId,
    });
  };
  (Company as unknown as MutableModel).findById = () =>
    lean({ _id: companyId, active: true });

  const passthrough: TransactionRunner = async (fn) => fn({} as ClientSession);
  const deps = { withTransaction: passthrough, insertAudit: async () => undefined };
  await assert.rejects(
    () =>
      activateRingCentralRoute(
        {
          id: String(routeId),
          source_granularity_id: String(formFeedId),
          reason: "Try to file calls under a form feed",
        },
        OWNER,
        deps,
      ),
    (error: unknown) => {
      assert.ok(error instanceof RegistryError);
      assert.match(error.message, /active call/i);
      return true;
    },
  );
  await assert.rejects(
    () =>
      reassignRingCentralRoute(
        {
          id: String(routeId),
          source_granularity_id: String(inactiveFeedId),
          reason: "Try to file calls under an inactive feed",
        },
        OWNER,
        deps,
      ),
    RegistryError,
  );
});

test("dependency preview no longer returns a hardcoded can_deactivate gate", async () => {
  (Route as unknown as MutableModel).exists = async () => ({ _id: routeId });
  (Assignment as unknown as MutableModel).countDocuments = async () => 1;
  (CallLead as unknown as MutableModel).countDocuments = async () => 0;
  const preview = await previewRingCentralRouteDependencies(String(routeId));
  assert.equal("can_deactivate" in preview, false);
  assert.equal(preview.active_assignment_count, 1);
});
