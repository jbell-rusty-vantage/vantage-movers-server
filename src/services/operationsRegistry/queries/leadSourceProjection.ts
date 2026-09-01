import { connectMongo } from "../../../db";
import { getLeadSourceCompanyModel } from "../../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../../models/LeadSourceGranularity";
import { getLeadSourceLabelMappingModel } from "../../../models/LeadSourceLabelMapping";
import { getGranotCrmSourceModel } from "../../../models/GranotCrmSource";
import { getCplRatePeriodModel, CPL_BUSINESS_TIME_ZONE } from "../../../models/CplRatePeriod";
import { getRingCentralInboundRouteAssignmentModel } from "../../../models/RingCentralInboundRouteAssignment";
import { getRingCentralInboundRouteModel } from "../../../models/RingCentralInboundRoute";
import { RegistryError } from "../errors";
import { REGISTRY_ERROR_CODES } from "../../errors/registryErrorCodes";
import { validateCplSchedule, type CplSchedulePeriod } from "../cplSchedule";
import type { RegistryHealthFinding } from "../types";
import {
  buildCplRegistryHealthFindings,
  buildGranotSourceHealthFindings,
  buildLabelMappingHealthFindings,
  buildRingCentralHealthFindings,
  buildSourceRegistryHealthFindings,
} from "./health";
import {
  translateFindings,
  type OwnerFinding,
} from "./findingTranslation";
import { buildReadinessPlan } from "../leadSourceSetup";

const DETAIL_ROUND_TRIP_BOUND = 10;
const LIST_ROUND_TRIP_BOUND = 6;

let projectionRoundTrips = 0;

export function getProjectionRoundTripCount(): number {
  return projectionRoundTrips;
}

export function resetProjectionRoundTripCount(): void {
  projectionRoundTrips = 0;
}

export const PROJECTION_ROUND_TRIP_BOUNDS = {
  detail: DETAIL_ROUND_TRIP_BOUND,
  list: LIST_ROUND_TRIP_BOUND,
} as const;

export type EmptySection<T> = {
  empty: boolean;
  items: T[];
};

export type FeedReadiness = {
  lead_source_active: boolean;
  feed_active: boolean;
  lead_cost: "ready" | "missing" | "invalid";
  live: boolean;
};

export type AcceptedLabelItem = {
  id: string;
  label: string;
  namespace: string;
  active: boolean;
};

export type GranotLandingItem = {
  id: string;
  name_received_from_granot: string;
  when_lead_arrives: "watch_only" | "existing_only" | "create_if_missing";
  when_lead_arrives_copy: string;
  text_state: "on" | "off" | "not_available";
  live: boolean;
  route:
    | { shape: "one_feed"; lands_in_this_feed: true }
    | {
        shape: "form_by_move_type";
        lands_in_this_feed: true;
        selection_rule: string;
        local_feed_id: string;
        long_distance_feed_id: string;
      };
};

export type InboundNumberItem = {
  id: string;
  phone_number: string;
  nickname: string;
  effective_from: string;
};

export type LeadSourceFeedProjection = {
  id: string;
  granularity_key: string;
  channel: "form" | "call";
  display_name: string;
  crm_label: string;
  move_type?: "local" | "long_distance";
  active: boolean;
  readiness: FeedReadiness;
  accepted_label_count?: number;
  granot_name_count?: number;
  inbound_number_count?: number;
  accepted_labels?: EmptySection<AcceptedLabelItem>;
  granot_names?: EmptySection<GranotLandingItem>;
  inbound_numbers?: EmptySection<InboundNumberItem>;
};

export type LeadSourceListItem = {
  id: string;
  company_slug: string;
  name: string;
  owner_label: string;
  active: boolean;
  aliases: string[];
  sheet_config: {
    spreadsheet_id?: string;
    has_bad_tabs: boolean;
    projection_mode: "derived_import" | "direct_write";
  };
  feeds: EmptySection<LeadSourceFeedProjection>;
  blocking_finding_count: number;
};

export type OwnerReadinessAction =
  | "open_lead_costs"
  | "activate_lead_source"
  | "activate_feed"
  | "switch_granot_name_live"
  | "turn_on_customer_text"
  | "connect_granot_name";

export type OwnerReadinessPlanRow = {
  gate: string;
  action: OwnerReadinessAction;
  status: "done" | "ready" | "blocked" | "suggested";
  blocked_until?: string;
};

export type LeadSourceDetail = LeadSourceListItem & {
  findings: OwnerFinding[];
  readiness_plan: OwnerReadinessPlanRow[];
  advanced: {
    raw_findings: Array<{
      code: string;
      summary: string;
      entity_type?: string;
      entity_id?: string;
    }>;
  };
};

export type LeadSourceListResult = {
  generated_at: string;
  items: LeadSourceListItem[];
  _round_trips?: number;
};

export type LeadSourceDetailResult = LeadSourceDetail & {
  generated_at: string;
  _round_trips?: number;
};

const MOVE_TYPE_SELECTION_RULE =
  "Use the local feed or the long-distance feed based on the move type.";

const ARRIVAL_COPY = {
  watch_only: "Watch only",
  existing_only: "Use an existing lead only",
  create_if_missing: "Use an existing lead, or create it if missing",
} as const;

export type LeadSourceProjectionDeps = {
  connect?: () => Promise<void>;
};

export async function listLeadSourceProjections(
  deps: LeadSourceProjectionDeps = {},
): Promise<LeadSourceListResult> {
  await (deps.connect ?? connectMongo)();
  resetProjectionRoundTripCount();
  const companies = await counted(
    getLeadSourceCompanyModel().find({}).sort({ owner_label: 1 }).lean().exec(),
  );
  const companyIds = companies.map((company) => company._id);
  const feeds = companyIds.length
    ? await counted(
        getLeadSourceGranularityModel()
          .find({ source_company: { $in: companyIds } })
          .sort({ owner_label: 1 })
          .lean()
          .exec(),
      )
    : [];
  const feedIds = feeds.map((feed) => feed._id);
  const [mappings, granotSources, assignments, cplPeriods] = await Promise.all([
    feedIds.length
      ? counted(
          getLeadSourceLabelMappingModel()
            .find({ source_granularity: { $in: feedIds } })
            .select({ source_granularity: 1 })
            .lean()
            .exec(),
        )
      : Promise.resolve([]),
    feedIds.length
      ? counted(
          getGranotCrmSourceModel()
            .find({ "lifecycle_routes.source_granularity_id": { $in: feedIds } })
            .select({ lifecycle_routes: 1 })
            .lean()
            .exec(),
        )
      : Promise.resolve([]),
    feedIds.length
      ? counted(
          getRingCentralInboundRouteAssignmentModel()
            .find({
              source_granularity: { $in: feedIds },
              effective_until: { $exists: false },
              active: true,
            })
            .select({ source_granularity: 1 })
            .lean()
            .exec(),
        )
      : Promise.resolve([]),
    feedIds.length
      ? counted(
          getCplRatePeriodModel()
            .find({
              source_granularity: { $in: feedIds },
              archived_at: { $exists: false },
            })
            .sort({ effective_from: 1 })
            .lean()
            .exec(),
        )
      : Promise.resolve([]),
  ]);

  const feedsByCompany = groupBy(feeds, (feed) => String(feed.source_company));
  const labelCountByFeed = countBy(mappings, (row) => String(row.source_granularity));
  const granotCountByFeed = countGranotByFeed(
    granotSources as unknown as Record<string, unknown>[],
  );
  const numberCountByFeed = countBy(assignments, (row) => String(row.source_granularity));
  const periodsByFeed = groupBy(cplPeriods, (row) => String(row.source_granularity));

  const items = companies.map((company) => {
    const companyFeeds = feedsByCompany.get(String(company._id)) ?? [];
    const feedItems = companyFeeds.map((feed) => {
      const feedId = String(feed._id);
      const readiness = feedReadiness(
        company.active === true,
        feed.active === true,
        periodsByFeed.get(feedId) ?? [],
        feedId,
      );
      return {
        id: feedId,
        granularity_key: String(feed.granularity_key),
        channel: feed.channel === "call" ? "call" : "form",
        display_name: String(feed.owner_label),
        crm_label: String(feed.crm_label),
        ...(feed.local === "local" || feed.local === "long_distance"
          ? { move_type: feed.local }
          : {}),
        active: feed.active === true,
        readiness,
        accepted_label_count: labelCountByFeed.get(feedId) ?? 0,
        granot_name_count: granotCountByFeed.get(feedId) ?? 0,
        inbound_number_count:
          feed.channel === "call" ? numberCountByFeed.get(feedId) ?? 0 : undefined,
      } satisfies LeadSourceFeedProjection;
    });
    return {
      id: String(company._id),
      company_slug: String(company.company_slug),
      name: String(company.name),
      owner_label: String(company.owner_label ?? company.name),
      active: company.active === true,
      aliases: strings(company.aliases),
      sheet_config: sheetConfig(company.sheet_config),
      feeds: section(feedItems),
      blocking_finding_count: 0,
    } satisfies LeadSourceListItem;
  });

  return {
    generated_at: new Date().toISOString(),
    items,
    _round_trips: projectionRoundTrips,
  };
}

export async function getLeadSourceProjection(
  id: string,
  deps: LeadSourceProjectionDeps = {},
): Promise<LeadSourceDetailResult> {
  await (deps.connect ?? connectMongo)();
  resetProjectionRoundTripCount();
  const company = await counted(getLeadSourceCompanyModel().findById(id).lean().exec());
  if (!company) {
    throw new RegistryError("Lead source not found.", {
      registryCode: REGISTRY_ERROR_CODES.NOT_FOUND,
    });
  }
  const feeds = await counted(
    getLeadSourceGranularityModel()
      .find({ source_company: company._id })
      .sort({ owner_label: 1 })
      .lean()
      .exec(),
  );
  const feedIds = feeds.map((feed) => feed._id);
  const feedIdSet = new Set(feedIds.map((value) => String(value)));

  const [mappings, granotSources, assignments, cplPeriods] = await Promise.all([
    feedIds.length
      ? counted(
          getLeadSourceLabelMappingModel()
            .find({ source_granularity: { $in: feedIds } })
            .sort({ namespace: 1, normalized_label: 1 })
            .lean()
            .exec(),
        )
      : Promise.resolve([]),
    feedIds.length
      ? counted(
          getGranotCrmSourceModel()
            .find({
              $or: [
                { "lifecycle_routes.source_granularity_id": { $in: feedIds } },
                { lead_source_company: company._id },
              ],
            })
            .lean()
            .exec(),
        )
      : counted(
          getGranotCrmSourceModel()
            .find({ lead_source_company: company._id })
            .lean()
            .exec(),
        ),
    feedIds.length
      ? counted(
          getRingCentralInboundRouteAssignmentModel()
            .find({
              source_granularity: { $in: feedIds },
              effective_until: { $exists: false },
            })
            .lean()
            .exec(),
        )
      : Promise.resolve([]),
    feedIds.length
      ? counted(
          getCplRatePeriodModel()
            .find({
              source_granularity: { $in: feedIds },
              archived_at: { $exists: false },
            })
            .sort({ effective_from: 1 })
            .lean()
            .exec(),
        )
      : Promise.resolve([]),
  ]);

  const routeIds = [
    ...new Set(assignments.map((row) => String(row.route)).filter(Boolean)),
  ];
  const routes = routeIds.length
    ? await counted(
        getRingCentralInboundRouteModel()
          .find({ _id: { $in: routeIds } })
          .lean()
          .exec(),
      )
    : [];
  const routeById = new Map(routes.map((route) => [String(route._id), route]));

  const mappingsByFeed = groupBy(mappings, (row) => String(row.source_granularity));
  const periodsByFeed = groupBy(cplPeriods, (row) => String(row.source_granularity));
  const assignmentsByFeed = groupBy(assignments, (row) => String(row.source_granularity));

  const feedItems = feeds.map((feed) => {
    const feedId = String(feed._id);
    const channel = feed.channel === "call" ? "call" : "form";
    const readiness = feedReadiness(
      company.active === true,
      feed.active === true,
      periodsByFeed.get(feedId) ?? [],
      feedId,
    );
    const labels = (mappingsByFeed.get(feedId) ?? []).map((mapping) => ({
      id: String(mapping._id),
      label: String(mapping.label),
      namespace: String(mapping.namespace),
      active: mapping.active === true,
    }));
    const granotItems = granotLandingsForFeed(
      granotSources as unknown as Record<string, unknown>[],
      feedId,
      feedIdSet,
    );
    const inboundItems =
      channel === "call"
        ? (assignmentsByFeed.get(feedId) ?? []).flatMap((assignment) => {
            const route = routeById.get(String(assignment.route));
            if (!route) return [];
            return [
              {
                id: String(route._id),
                phone_number: String(route.phone_number),
                nickname: String(route.display_label ?? ""),
                effective_from:
                  assignment.effective_from instanceof Date
                    ? assignment.effective_from.toISOString()
                    : String(assignment.effective_from ?? ""),
              } satisfies InboundNumberItem,
            ];
          })
        : undefined;
    return {
      id: feedId,
      granularity_key: String(feed.granularity_key),
      channel,
      display_name: String(feed.owner_label),
      crm_label: String(feed.crm_label),
      ...(feed.local === "local" || feed.local === "long_distance"
        ? { move_type: feed.local }
        : {}),
      active: feed.active === true,
      readiness,
      accepted_labels: section(labels),
      granot_names: section(granotItems),
      ...(inboundItems ? { inbound_numbers: section(inboundItems) } : {}),
    } satisfies LeadSourceFeedProjection;
  });

  const rawFindings = connectionFindings({
    company: {
      id: String(company._id),
      active: company.active === true,
      default_form_granularity: company.default_form_granularity
        ? String(company.default_form_granularity)
        : undefined,
      default_call_granularity: company.default_call_granularity
        ? String(company.default_call_granularity)
        : undefined,
    },
    feeds: feeds.map((feed) => ({
      id: String(feed._id),
      source_company: String(feed.source_company),
      channel: feed.channel === "call" ? "call" : "form",
      active: feed.active === true,
      crm_label: String(feed.crm_label),
      source_sites: strings(feed.source_sites),
      aliases: strings(feed.aliases),
      priority: typeof feed.priority === "number" ? feed.priority : 0,
      local: feed.local === "local" || feed.local === "long_distance" ? feed.local : undefined,
    })),
    mappings: mappings.map((mapping) => ({
      id: String(mapping._id),
      namespace: String(mapping.namespace),
      normalized_label: String(mapping.normalized_label),
      source_company: String(mapping.source_company),
      source_granularity: String(mapping.source_granularity),
      active: mapping.active === true,
    })),
    granotSources: granotSources.map((source) =>
      toGranotHealth(source as unknown as Record<string, unknown>),
    ),
    routes: routes.map((route) => ({
      id: String(route._id),
      active: route.active === true,
      validation_status: String(route.validation_status ?? "unvalidated"),
      validation_code: route.validation_code ?? undefined,
      validated_at: route.validated_at instanceof Date ? route.validated_at : undefined,
      phone_number: route.phone_number,
    })),
    assignments: assignments.map((assignment) => ({
      route_id: String(assignment.route),
      source_company_id: String(assignment.source_company),
      source_granularity_id: String(assignment.source_granularity),
      active: assignment.active === true,
    })),
    cplPeriods: cplPeriods.map((period) =>
      toCplPeriod(period as unknown as Record<string, unknown>),
    ),
  });

  const phoneByRoute = new Map(
    routes.map((route) => [String(route._id), String(route.phone_number ?? "")]),
  );
  const translated = rawFindings.map((finding) =>
    translateFindings([finding], {
      lead_source_id: String(company._id),
      source_granularity_id:
        finding.entity_type === "source_granularity" ? finding.entity_id : undefined,
      phone_number:
        finding.entity_type === "ringcentral_route" && finding.entity_id
          ? phoneByRoute.get(finding.entity_id)
          : undefined,
    })[0]!,
  );

  return {
    generated_at: new Date().toISOString(),
    id: String(company._id),
    company_slug: String(company.company_slug),
    name: String(company.name),
    owner_label: String(company.owner_label ?? company.name),
    active: company.active === true,
    aliases: strings(company.aliases),
    sheet_config: sheetConfig(company.sheet_config),
    feeds: section(feedItems),
    blocking_finding_count: translated.filter((finding) => finding.severity === "blocking").length,
    findings: translated,
    readiness_plan: ownerReadinessPlan(company.active === true, feedItems, granotSources as unknown as Record<string, unknown>[]),
    advanced: {
      raw_findings: rawFindings.map((finding) => ({
        code: finding.code,
        summary: finding.summary,
        ...(finding.entity_type ? { entity_type: finding.entity_type } : {}),
        ...(finding.entity_id ? { entity_id: finding.entity_id } : {}),
      })),
    },
    _round_trips: projectionRoundTrips,
  };
}

function connectionFindings(input: {
  company: {
    id: string;
    active: boolean;
    default_form_granularity?: string;
    default_call_granularity?: string;
  };
  feeds: Array<{
    id: string;
    source_company: string;
    channel: "form" | "call";
    active: boolean;
    crm_label: string;
    source_sites: string[];
    aliases: string[];
    priority: number;
    local?: "local" | "long_distance";
  }>;
  mappings: Array<{
    id: string;
    namespace: string;
    normalized_label: string;
    source_company: string;
    source_granularity: string;
    active: boolean;
  }>;
  granotSources: ReturnType<typeof toGranotHealth>[];
  routes: Array<{
    id: string;
    active: boolean;
    validation_status: string;
    validation_code?: string;
    validated_at?: Date;
    phone_number?: string;
  }>;
  assignments: Array<{
    route_id: string;
    source_company_id: string;
    source_granularity_id: string;
    active: boolean;
  }>;
  cplPeriods: CplSchedulePeriod[];
}): Array<
  Pick<RegistryHealthFinding, "code" | "severity" | "summary" | "entity_id" | "entity_type" | "evidence">
> {
  const drafts = [
    ...buildSourceRegistryHealthFindings([input.company], input.feeds),
    ...buildLabelMappingHealthFindings(input.mappings, [input.company], input.feeds),
    ...buildGranotSourceHealthFindings(input.granotSources, [input.company], input.feeds),
    ...buildRingCentralHealthFindings(
      input.routes,
      input.assignments,
      [input.company],
      input.feeds,
    ),
    ...buildCplRegistryHealthFindings(
      input.feeds.filter((feed) => feed.active).map((feed) => feed.id),
      input.cplPeriods,
      0,
    ),
  ];
  return drafts.map((draft) => ({
    code: draft.code,
    severity: draft.severity,
    summary: draft.summary,
    entity_id: draft.entity_id,
    entity_type: draft.entity_type,
    evidence: draft.evidence,
  }));
}

function granotLandingsForFeed(
  sources: readonly Record<string, unknown>[],
  feedId: string,
  feedIdSet: Set<string>,
): GranotLandingItem[] {
  const items: GranotLandingItem[] = [];
  for (const source of sources) {
    const routes = Array.isArray(source.lifecycle_routes) ? source.lifecycle_routes : [];
    const routeIds = routes
      .map((route) => String((route as { source_granularity_id?: unknown }).source_granularity_id ?? ""))
      .filter((value) => feedIdSet.has(value));
    if (!routeIds.includes(feedId)) continue;
    const shape = routeShape(routes, feedIdSet);
    if (shape.kind === "one_feed" && shape.feed_id !== feedId) continue;
    items.push({
      id: String(source._id ?? source.id ?? ""),
      name_received_from_granot: String(source.granot_label ?? ""),
      when_lead_arrives: arrivalFromPolicy(String(source.lead_created_policy ?? "")),
      when_lead_arrives_copy:
        ARRIVAL_COPY[arrivalFromPolicy(String(source.lead_created_policy ?? ""))],
      text_state: textState(source),
      live: source.lifecycle_enabled === true,
      route:
        shape.kind === "form_by_move_type"
          ? {
              shape: "form_by_move_type",
              lands_in_this_feed: true,
              selection_rule: MOVE_TYPE_SELECTION_RULE,
              local_feed_id: shape.local_feed_id,
              long_distance_feed_id: shape.long_distance_feed_id,
            }
          : { shape: "one_feed", lands_in_this_feed: true },
    });
  }
  return items;
}

function routeShape(
  routes: unknown[],
  feedIdSet: Set<string>,
):
  | { kind: "one_feed"; feed_id: string }
  | { kind: "form_by_move_type"; local_feed_id: string; long_distance_feed_id: string } {
  const parsed = routes
    .map((route) => {
      const row = route as {
        move_type?: string;
        source_granularity_id?: unknown;
      };
      return {
        move_type: String(row.move_type ?? ""),
        feed_id: String(row.source_granularity_id ?? ""),
      };
    })
    .filter((route) => feedIdSet.has(route.feed_id));
  const local = parsed.find((route) => route.move_type === "local");
  const longDistance = parsed.find((route) => route.move_type === "long_distance");
  if (local && longDistance) {
    return {
      kind: "form_by_move_type",
      local_feed_id: local.feed_id,
      long_distance_feed_id: longDistance.feed_id,
    };
  }
  return { kind: "one_feed", feed_id: parsed[0]?.feed_id ?? "" };
}

function arrivalFromPolicy(
  policy: string,
): "watch_only" | "existing_only" | "create_if_missing" {
  if (policy === "create_if_missing") return "create_if_missing";
  if (policy === "link_only") return "existing_only";
  return "watch_only";
}

function textState(source: Record<string, unknown>): "on" | "off" | "not_available" {
  const policy = String(source.lead_created_policy ?? "");
  if (policy !== "create_if_missing") return "not_available";
  const sms = source.outbound_sms as { enabled?: boolean } | undefined;
  return sms?.enabled === true ? "on" : "off";
}

const GATE_ACTION: Record<string, OwnerReadinessAction> = {
  "Set the lead cost": "open_lead_costs",
  "Activate the lead source": "activate_lead_source",
  "Activate the feed": "activate_feed",
  "Switch the Granot name live": "switch_granot_name_live",
  "Turn on the customer text": "turn_on_customer_text",
  "Connect a Granot name": "connect_granot_name",
};

function ownerReadinessPlan(
  leadSourceActive: boolean,
  feeds: LeadSourceFeedProjection[],
  granotSources: Record<string, unknown>[],
): OwnerReadinessPlanRow[] {
  const leadCostReady =
    feeds.length > 0 && feeds.every((feed) => feed.readiness.lead_cost === "ready");
  const feedActive = feeds.length > 0 && feeds.every((feed) => feed.active);
  const hasGranot = granotSources.length > 0;
  const createIfMissing = granotSources.some(
    (source) => String(source.lead_created_policy ?? "") === "create_if_missing",
  );
  const granotLive =
    hasGranot && granotSources.every((source) => source.lifecycle_enabled === true);
  const textOn = granotSources.some((source) => textState(source) === "on");
  const plan = buildReadinessPlan({
    granotOmitted: !hasGranot,
    createIfMissing,
  });
  return plan.map((row) => {
    const action = GATE_ACTION[row.gate] ?? "open_lead_costs";
    const done =
      (action === "open_lead_costs" && leadCostReady) ||
      (action === "activate_lead_source" && leadSourceActive) ||
      (action === "activate_feed" && feedActive) ||
      (action === "switch_granot_name_live" && granotLive) ||
      (action === "turn_on_customer_text" && textOn);
    if (done) {
      return { gate: row.gate, action, status: "done" };
    }
    if (row.suggested) {
      return { gate: row.gate, action, status: "suggested" };
    }
    if (row.blocked_until) {
      const blocked =
        (action === "activate_feed" && (!leadSourceActive || !leadCostReady)) ||
        (action === "switch_granot_name_live" && !feedActive) ||
        (action === "turn_on_customer_text" && !(granotLive && createIfMissing));
      if (blocked) {
        return {
          gate: row.gate,
          action,
          status: "blocked",
          blocked_until: row.blocked_until,
        };
      }
    }
    return { gate: row.gate, action, status: "ready" };
  });
}

function feedReadiness(
  companyActive: boolean,
  feedActive: boolean,
  periods: Record<string, unknown>[],
  feedId: string,
): FeedReadiness {
  const leadCost = cplState(periods, feedId);
  return {
    lead_source_active: companyActive,
    feed_active: feedActive,
    lead_cost: leadCost,
    live: companyActive && feedActive && leadCost === "ready",
  };
}

function cplState(
  periods: Record<string, unknown>[],
  feedId: string,
): "ready" | "missing" | "invalid" {
  if (!periods.length) return "missing";
  try {
    validateCplSchedule(
      periods.map((period) => toCplPeriod(period, feedId)),
      { active: true },
    );
    return "ready";
  } catch {
    return "invalid";
  }
}

function toCplPeriod(
  period: Record<string, unknown>,
  feedId?: string,
): CplSchedulePeriod {
  return {
    id: String(period._id ?? period.id ?? ""),
    source_granularity_id: String(period.source_granularity ?? feedId ?? ""),
    amount_cents: typeof period.amount_cents === "number" ? period.amount_cents : 0,
    effective_from: period.effective_from instanceof Date ? period.effective_from : new Date(0),
    ...(period.effective_until instanceof Date
      ? { effective_until: period.effective_until }
      : {}),
    effective_from_date: String(period.effective_from_date ?? ""),
    ...(typeof period.effective_until_date_exclusive === "string"
      ? { effective_until_date_exclusive: period.effective_until_date_exclusive }
      : {}),
    business_timezone: CPL_BUSINESS_TIME_ZONE,
  };
}

function toGranotHealth(source: Record<string, unknown>): {
  id: string;
  enabled: boolean;
  granot_label?: string;
  normalized_granot_label?: string;
  lifecycle_disposition: "source_scoped_lead" | "referral_booking" | "deferred";
  lead_created_policy: "observation_only" | "link_only" | "create_if_missing";
  lead_source_company?: string;
  lifecycle_routes: Array<{
    route_key: string;
    lead_model: "FormLead" | "CallLead";
    move_type: "local" | "long_distance" | "any";
    source_granularity_id: string;
  }>;
  outbound_sms?: { enabled?: boolean; consent_basis?: string; daily_cap?: number };
} {
  const sms = (source.outbound_sms ?? {}) as Record<string, unknown>;
  return {
    id: String(source._id ?? source.id ?? ""),
    enabled: source.enabled === true,
    granot_label: typeof source.granot_label === "string" ? source.granot_label : undefined,
    normalized_granot_label:
      typeof source.normalized_granot_label === "string"
        ? source.normalized_granot_label
        : undefined,
    lifecycle_disposition: (typeof source.lifecycle_disposition === "string"
      ? source.lifecycle_disposition
      : "deferred") as "source_scoped_lead" | "referral_booking" | "deferred",
    lead_created_policy: (typeof source.lead_created_policy === "string"
      ? source.lead_created_policy
      : "observation_only") as "observation_only" | "link_only" | "create_if_missing",
    lead_source_company: source.lead_source_company
      ? String(source.lead_source_company)
      : undefined,
    lifecycle_routes: (Array.isArray(source.lifecycle_routes) ? source.lifecycle_routes : []).map(
      (route) => {
        const row = route as Record<string, unknown>;
        return {
          route_key: String(row.route_key ?? ""),
          lead_model: row.lead_model === "CallLead" ? "CallLead" : "FormLead",
          move_type:
            row.move_type === "local" || row.move_type === "long_distance"
              ? row.move_type
              : "any",
          source_granularity_id: String(row.source_granularity_id ?? ""),
        };
      },
    ),
    outbound_sms: {
      enabled: sms.enabled === true,
      consent_basis: typeof sms.consent_basis === "string" ? sms.consent_basis : undefined,
      daily_cap: typeof sms.daily_cap === "number" ? sms.daily_cap : undefined,
    },
  };
}

function countGranotByFeed(sources: readonly Record<string, unknown>[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const source of sources) {
    const seen = new Set<string>();
    for (const route of Array.isArray(source.lifecycle_routes) ? source.lifecycle_routes : []) {
      const feedId = String(
        (route as { source_granularity_id?: unknown }).source_granularity_id ?? "",
      );
      if (!feedId || seen.has(feedId)) continue;
      seen.add(feedId);
      counts.set(feedId, (counts.get(feedId) ?? 0) + 1);
    }
  }
  return counts;
}

function section<T>(items: T[]): EmptySection<T> {
  return { empty: items.length === 0, items };
}

function sheetConfig(value: unknown): LeadSourceListItem["sheet_config"] {
  const sheet = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    ...(typeof sheet.spreadsheet_id === "string" ? { spreadsheet_id: sheet.spreadsheet_id } : {}),
    has_bad_tabs: sheet.has_bad_tabs === true,
    projection_mode: sheet.projection_mode === "direct_write" ? "direct_write" : "derived_import",
  };
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const groupKey = key(row);
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), row]);
  }
  return groups;
}

function countBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const groupKey = key(row);
    counts.set(groupKey, (counts.get(groupKey) ?? 0) + 1);
  }
  return counts;
}

async function counted<T>(promise: Promise<T>): Promise<T> {
  projectionRoundTrips += 1;
  return promise;
}
