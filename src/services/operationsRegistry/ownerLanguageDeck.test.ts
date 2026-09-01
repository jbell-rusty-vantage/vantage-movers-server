import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import mongoose from "mongoose";
import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../models/LeadSourceGranularity";
import { getLeadSourceLabelMappingModel } from "../../models/LeadSourceLabelMapping";
import { getGranotCrmSourceModel } from "../../models/GranotCrmSource";
import { getCplRatePeriodModel } from "../../models/CplRatePeriod";
import { getRingCentralInboundRouteAssignmentModel } from "../../models/RingCentralInboundRouteAssignment";
import { getRingCentralInboundRouteModel } from "../../models/RingCentralInboundRoute";
import { getEntityChangeModel } from "../../models/EntityChange";
import { OperationsRegistryChange } from "../../models/OperationsRegistryChange";
import { getLeadSourceProjection } from "./queries/leadSourceProjection";
import {
  findOwnerLanguageLeaks,
  OWNER_LANGUAGE_DECK_BANNED_TERMS,
} from "./ownerLanguageDeck";

const companyId = new mongoose.Types.ObjectId();
const localFeedId = new mongoose.Types.ObjectId();
const longFeedId = new mongoose.Types.ObjectId();
const callFeedId = new mongoose.Types.ObjectId();
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

afterEach(() => {
  (Company as unknown as MutableModel).findById = originals.companyFindById;
  (Feed as unknown as MutableModel).find = originals.feedFind;
  (Mapping as unknown as MutableModel).find = originals.mappingFind;
  (Granot as unknown as MutableModel).find = originals.granotFind;
  (Cpl as unknown as MutableModel).find = originals.cplFind;
  (Assignment as unknown as MutableModel).find = originals.assignmentFind;
  (Route as unknown as MutableModel).find = originals.routeFind;
  (EntityChange as unknown as MutableModel).create = originals.entityCreate;
  (OperationsRegistryChange as unknown as MutableModel).create = originals.changeCreate;
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

test("banned-term constant is the shared six-term list", () => {
  assert.deepEqual([...OWNER_LANGUAGE_DECK_BANNED_TERMS], [
    "granularity",
    "lifecycle",
    "disposition",
    "route_key",
    "lead_model",
    "policy_version",
  ]);
});

test("ORS-3 detail projection Owner strings stay inside the language deck", async () => {
  (EntityChange as unknown as MutableModel).create = async () => [];
  (OperationsRegistryChange as unknown as MutableModel).create = async () => [];
  const company = {
    _id: companyId,
    company_slug: "best_relocation_leads",
    name: "Best Relocation",
    owner_label: "Best Relocation",
    aliases: ["Best Relo"],
    active: true,
    sheet_config: { has_bad_tabs: false, projection_mode: "derived_import" },
  };
  (Company as unknown as MutableModel).findById = () => lean(company);
  (Feed as unknown as MutableModel).find = () =>
    lean([
      {
        _id: localFeedId,
        source_company: companyId,
        granularity_key: "best_relocation_local",
        channel: "form",
        owner_label: "Web forms — local moves",
        crm_label: "Best Relocation Locals",
        aliases: [],
        source_sites: [],
        priority: 0,
        local: "local",
        active: true,
      },
      {
        _id: longFeedId,
        source_company: companyId,
        granularity_key: "best_relocation_long",
        channel: "form",
        owner_label: "Web forms — long-distance",
        crm_label: "Best Relocation Forms",
        aliases: [],
        source_sites: [],
        priority: 0,
        local: "long_distance",
        active: true,
      },
      {
        _id: callFeedId,
        source_company: companyId,
        granularity_key: "best_relocation_calls",
        channel: "call",
        owner_label: "Inbound calls",
        crm_label: "Best Relocation Inbounds",
        aliases: [],
        source_sites: [],
        priority: 0,
        active: true,
      },
    ]);
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
        lifecycle_enabled: true,
        lifecycle_routes: [
          { move_type: "local", source_granularity_id: String(localFeedId) },
          { move_type: "long_distance", source_granularity_id: String(longFeedId) },
        ],
        lead_source_company: companyId,
        enabled: true,
      },
      {
        _id: granotOneId,
        granot_label: "Best Relocation Calls",
        lead_created_policy: "link_only",
        lifecycle_enabled: false,
        lifecycle_routes: [{ move_type: "any", source_granularity_id: String(callFeedId) }],
        lead_source_company: companyId,
        enabled: true,
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

  const detail = await getLeadSourceProjection(String(companyId), {
    connect: async () => undefined,
  });
  const leaks = findOwnerLanguageLeaks(detail);
  assert.deepEqual(
    leaks,
    [],
    leaks.map((leak) => `${leak.path}: ${leak.reason} ${leak.term ?? leak.value}`).join("\n"),
  );
});
