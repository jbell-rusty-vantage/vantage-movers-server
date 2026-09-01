/**
 * Owner Granot name create command.
 *
 * A Granot CRM Source is the exact Granot spelling plus arrival policy.
 * Creating one is how the extension and automation know which source
 * companies exist. `create_if_missing` is the ingest path for partners
 * whose leads are born in Granot, not on a form or RingCentral queue —
 * and it is the only policy that may text the customer. The persisted
 * Feed route (`lifecycle_routes[].source_granularity_id`) is how
 * create-if-missing writes `lead_source_company` and
 * `source_granularity_id` on the new Lead. This command derives the
 * Lead Source from the Feed; it never accepts a contradictory pair.
 *
 * This module is a translation layer. It does not invent a second Granot
 * write path. `validateGranotCrmSourceSemantics` wins if translation
 * disagrees.
 */
import type { ClientSession } from "mongoose";
import { GRANOT_CRM_DEFAULT_ORIGIN } from "../../config/domain";
import { getGranotCrmSourceModel } from "../../models/GranotCrmSource";
import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../models/LeadSourceGranularity";
import {
  validateGranotCrmSourceSemantics,
  type GranotCrmSourceRouteInput,
} from "../../models/granotCrmSourceSemantics";
import { REGISTRY_ERROR_CODES } from "../errors/registryErrorCodes";
import { normalizeGranotSourceLabel } from "../granotLifecycle/sourceLabel";
import type {
  GranotLeadCreatedPolicy,
  GranotLifecycleDisposition,
  LeadModel,
} from "../granotLifecycle/types";
import { RegistryError } from "./errors";
import {
  createOrUpdateGranotCrmSource,
  type GranotCrmSourceCommand,
  type GranotCrmSourceLifecycleRoute,
  type GranotCrmSourceRecord,
} from "./granotCrmSources";
import type { RegistryAuditDeps } from "./registryAudit";
import type { RegistryActorContext } from "./types";

export type OwnerGranotNameCommand = {
  name_received_from_granot: string;
  handling: "our_lead_source" | "referral_booking" | "watch_only";
  lead_source_id?: string;
  destination:
    | { kind: "one_feed"; feed_id: string }
    | { kind: "form_by_move_type"; local_feed_id: string; long_distance_feed_id: string }
    | null;
  when_lead_arrives: "watch_only" | "existing_only" | "create_if_missing";
  reason: string;
};

export type OwnerGranotNameGateState = {
  this_name_is_switched_on: boolean;
  this_name_is_used_in_live_processing: boolean;
  customer_text_is_on: boolean;
  when_a_lead_arrives: GranotLeadCreatedPolicy;
  choosing_create_if_missing_does_not_make_texting_live: true;
};

export type OwnerGranotNameCreateResult = Omit<GranotCrmSourceRecord, "source_company"> & {
  gates: OwnerGranotNameGateState;
};

type LoadedFeed = {
  id: string;
  source_company_id: string;
  active: boolean;
  channel: "form" | "call";
  local?: "local" | "long_distance";
};

const HANDLING_TO_DISPOSITION = {
  our_lead_source: "source_scoped_lead",
  referral_booking: "referral_booking",
  watch_only: "deferred",
} as const satisfies Record<
  OwnerGranotNameCommand["handling"],
  GranotLifecycleDisposition
>;

const ARRIVAL_TO_POLICY = {
  watch_only: "observation_only",
  existing_only: "link_only",
  create_if_missing: "create_if_missing",
} as const satisfies Record<
  OwnerGranotNameCommand["when_lead_arrives"],
  GranotLeadCreatedPolicy
>;

export function translateOwnerHandling(
  handling: OwnerGranotNameCommand["handling"],
): GranotLifecycleDisposition {
  return HANDLING_TO_DISPOSITION[handling];
}

export function translateOwnerArrivalPolicy(
  whenLeadArrives: OwnerGranotNameCommand["when_lead_arrives"],
): GranotLeadCreatedPolicy {
  return ARRIVAL_TO_POLICY[whenLeadArrives];
}

export function workspaceSlugFromNormalizedLabel(normalized: string): string {
  const slug = normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!slug) {
    throw invalid("Name received from Granot does not produce a usable workspace slug.");
  }
  return slug;
}

export function assembleOneFeedRoutes(feed: {
  id: string;
  channel: "form" | "call";
}): GranotCrmSourceLifecycleRoute[] {
  return [
    {
      route_key: "any",
      lead_model: leadModelFromFeedChannel(feed.channel),
      move_type: "any",
      source_granularity_id: feed.id,
    },
  ];
}

export type KnownFeedForGranot = {
  id: string;
  source_company_id: string;
  channel: "form" | "call";
};

export function assembleOwnerGranotCreateForKnownFeed(input: {
  name_received_from_granot: string;
  when_lead_arrives: OwnerGranotNameCommand["when_lead_arrives"];
  reason: string;
  feed: KnownFeedForGranot;
}): {
  command: GranotCrmSourceCommand;
  normalized: string;
  workspace_slug: string;
} {
  const normalized = normalizeGranotSourceLabel(input.name_received_from_granot);
  if (!normalized) {
    throw invalid("name_received_from_granot must normalize to a nonempty control/bidi-safe label.");
  }
  const reason = input.reason.trim();
  if (reason.length < 10 || reason.length > 1000) {
    throw invalid("An explicit reason of 10 to 1000 characters is required.");
  }
  const disposition = translateOwnerHandling("our_lead_source");
  const policy = translateOwnerArrivalPolicy(input.when_lead_arrives);
  const routes = assembleOneFeedRoutes(input.feed);
  const assembled = validateGranotCrmSourceSemantics({
    granot_label: input.name_received_from_granot,
    enabled: false,
    lifecycle_enabled: false,
    lifecycle_disposition: disposition,
    lead_created_policy: policy,
    lead_source_company: input.feed.source_company_id,
    lifecycle_routes: routes.map((route) => ({
      route_key: route.route_key,
      lead_model: route.lead_model,
      move_type: route.move_type,
      source_granularity_id: route.source_granularity_id,
    })),
    lifecycle_policy_version: "",
  });
  if (!assembled.ok) {
    throw invalid(assembled.message);
  }
  const workspace_slug = workspaceSlugFromNormalizedLabel(normalized);
  return {
    normalized,
    workspace_slug,
    command: {
      crm_origin: GRANOT_CRM_DEFAULT_ORIGIN,
      workspace_slug,
      granot_label: input.name_received_from_granot,
      default_channel: input.feed.channel,
      source_company: "not_provided",
      enabled: false,
      lifecycle_enabled: false,
      lifecycle_disposition: disposition,
      lead_created_policy: policy,
      lead_source_company: input.feed.source_company_id,
      lifecycle_routes: routes,
      lifecycle_policy_version: "",
      reason,
    },
  };
}

export async function assertGranotNameAvailable(
  nameReceivedFromGranot: string,
  session?: ClientSession | null,
): Promise<{ normalized: string; workspace_slug: string }> {
  const normalized = normalizeGranotSourceLabel(nameReceivedFromGranot);
  if (!normalized) {
    throw invalid("name_received_from_granot must normalize to a nonempty control/bidi-safe label.");
  }
  const Source = getGranotCrmSourceModel();
  const duplicateQuery = Source.findOne({
    normalized_granot_label: normalized,
  }).select({ _id: 1, granot_label: 1 });
  const duplicateLabel = await (session ? duplicateQuery.session(session) : duplicateQuery)
    .lean()
    .exec();
  if (duplicateLabel) {
    throw new RegistryError(
      `Name received from Granot normalizes to a value already held by Granot name ${String(duplicateLabel._id)}.`,
      {
        registryCode: REGISTRY_ERROR_CODES.DUPLICATE_IDENTIFIER,
        remediation: {
          summary: "Use the existing Granot name or confirm a different exact spelling.",
          action: "open_granot_names",
          entity_type: "granot_crm_source",
          entity_id: String(duplicateLabel._id),
        },
      },
    );
  }
  const workspaceSlug = workspaceSlugFromNormalizedLabel(normalized);
  const slugQuery = Source.findOne({
    crm_origin: GRANOT_CRM_DEFAULT_ORIGIN,
    workspace_slug: workspaceSlug,
  }).select({ _id: 1, granot_label: 1 });
  const slugCollision = await (session ? slugQuery.session(session) : slugQuery)
    .lean()
    .exec();
  if (slugCollision) {
    throw new RegistryError(
      `Derived workspace_slug collides with Granot name ${String(slugCollision._id)}.`,
      {
        registryCode: REGISTRY_ERROR_CODES.DUPLICATE_IDENTIFIER,
        remediation: {
          summary:
            "The derived workspace slug is already held. Do not suffix it; choose a different exact Granot spelling.",
          action: "open_granot_names",
          entity_type: "granot_crm_source",
          entity_id: String(slugCollision._id),
        },
      },
    );
  }
  return { normalized, workspace_slug: workspaceSlug };
}

export async function createGranotNameFromOwnerIntent(
  command: OwnerGranotNameCommand,
  actor: RegistryActorContext,
  deps: RegistryAuditDeps = {},
): Promise<OwnerGranotNameCreateResult> {
  if (actor.actorRole !== "owner") {
    throw new RegistryError("Registry mutations require an Owner actor.", {
      registryCode: REGISTRY_ERROR_CODES.FORBIDDEN,
    });
  }

  const normalized = normalizeGranotSourceLabel(command.name_received_from_granot);
  if (!normalized) {
    throw invalid("name_received_from_granot must normalize to a nonempty control/bidi-safe label.");
  }

  const Source = getGranotCrmSourceModel();
  const duplicateLabel = await Source.findOne({
    normalized_granot_label: normalized,
  })
    .select({ _id: 1, granot_label: 1 })
    .lean()
    .exec();
  if (duplicateLabel) {
    throw new RegistryError(
      `Name received from Granot normalizes to a value already held by Granot name ${String(duplicateLabel._id)}.`,
      {
        registryCode: REGISTRY_ERROR_CODES.DUPLICATE_IDENTIFIER,
        remediation: {
          summary: "Use the existing Granot name or confirm a different exact spelling.",
          action: "open_granot_names",
          entity_type: "granot_crm_source",
          entity_id: String(duplicateLabel._id),
        },
      },
    );
  }

  const reason = command.reason.trim();
  if (reason.length < 10 || reason.length > 1000) {
    throw invalid("An explicit reason of 10 to 1000 characters is required.");
  }

  if (command.handling === "watch_only") {
    if (command.destination !== null) {
      throw invalid("Watch-only Granot names cannot have a destination.");
    }
    if (command.when_lead_arrives !== "watch_only") {
      throw invalid("Watch-only handling requires when_lead_arrives to be watch_only.");
    }
  }

  const disposition = translateOwnerHandling(command.handling);
  const policy = translateOwnerArrivalPolicy(command.when_lead_arrives);
  const destination = command.destination;
  let routes: GranotCrmSourceLifecycleRoute[] = [];
  let leadSourceId: string | undefined;
  let defaultChannel: "form" | "call" | "unknown" = "unknown";

  if (destination?.kind === "one_feed") {
    const feed = await loadDestinationFeed(destination.feed_id);
    leadSourceId = resolveLeadSourceId(command.lead_source_id, [feed]);
    const leadModel = leadModelFromFeedChannel(feed.channel);
    defaultChannel = feed.channel;
    routes = [
      {
        route_key: "any",
        lead_model: leadModel,
        move_type: "any",
        source_granularity_id: feed.id,
      },
    ];
  } else if (destination?.kind === "form_by_move_type") {
    if (destination.local_feed_id === destination.long_distance_feed_id) {
      throw invalid("form_by_move_type cannot use the same Feed twice.");
    }
    const localFeed = await loadDestinationFeed(destination.local_feed_id);
    const longFeed = await loadDestinationFeed(destination.long_distance_feed_id);
    if (localFeed.channel !== "form" || longFeed.channel !== "form") {
      throw invalid("form_by_move_type requires two Form Feeds.");
    }
    if (localFeed.local !== "local") {
      throw invalid("form_by_move_type local_feed_id must be the local Form Feed.");
    }
    if (longFeed.local !== "long_distance") {
      throw invalid(
        "form_by_move_type long_distance_feed_id must be the long-distance Form Feed.",
      );
    }
    leadSourceId = resolveLeadSourceId(command.lead_source_id, [localFeed, longFeed]);
    defaultChannel = "form";
    routes = [
      {
        route_key: "form_local",
        lead_model: "FormLead",
        move_type: "local",
        source_granularity_id: localFeed.id,
      },
      {
        route_key: "form_long",
        lead_model: "FormLead",
        move_type: "long_distance",
        source_granularity_id: longFeed.id,
      },
    ];
  } else if (command.lead_source_id) {
    leadSourceId = command.lead_source_id;
  }

  const assembledRoutes: GranotCrmSourceRouteInput[] = routes.map((route) => ({
    route_key: route.route_key,
    lead_model: route.lead_model,
    move_type: route.move_type,
    source_granularity_id: route.source_granularity_id,
  }));
  const assembled = validateGranotCrmSourceSemantics({
    granot_label: command.name_received_from_granot,
    enabled: false,
    lifecycle_enabled: false,
    lifecycle_disposition: disposition,
    lead_created_policy: policy,
    lead_source_company: leadSourceId,
    lifecycle_routes: assembledRoutes,
    lifecycle_policy_version: "",
  });
  if (!assembled.ok) {
    throw invalid(assembled.message);
  }

  const workspaceSlug = workspaceSlugFromNormalizedLabel(normalized);
  const slugCollision = await Source.findOne({
    crm_origin: GRANOT_CRM_DEFAULT_ORIGIN,
    workspace_slug: workspaceSlug,
  })
    .select({ _id: 1, granot_label: 1 })
    .lean()
    .exec();
  if (slugCollision) {
    throw new RegistryError(
      `Derived workspace_slug collides with Granot name ${String(slugCollision._id)}.`,
      {
        registryCode: REGISTRY_ERROR_CODES.DUPLICATE_IDENTIFIER,
        remediation: {
          summary: "The derived workspace slug is already held. Do not suffix it; choose a different exact Granot spelling.",
          action: "open_granot_names",
          entity_type: "granot_crm_source",
          entity_id: String(slugCollision._id),
        },
      },
    );
  }

  const created = await createOrUpdateGranotCrmSource(
    {
      crm_origin: GRANOT_CRM_DEFAULT_ORIGIN,
      workspace_slug: workspaceSlug,
      granot_label: command.name_received_from_granot,
      default_channel: defaultChannel,
      source_company: "not_provided",
      enabled: false,
      lifecycle_enabled: false,
      lifecycle_disposition: disposition,
      lead_created_policy: policy,
      lead_source_company: leadSourceId ?? null,
      lifecycle_routes: routes,
      lifecycle_policy_version: "",
      reason,
    },
    actor,
    deps,
  );

  return toOwnerCreateResult(created);
}

export function toOwnerCreateResult(
  record: GranotCrmSourceRecord,
): OwnerGranotNameCreateResult {
  const { source_company: _legacyCsv, ...ownerRecord } = record;
  return {
    ...ownerRecord,
    gates: {
      this_name_is_switched_on: record.enabled === true,
      this_name_is_used_in_live_processing: record.lifecycle_enabled === true,
      customer_text_is_on: record.outbound_sms?.enabled === true,
      when_a_lead_arrives: record.lead_created_policy,
      choosing_create_if_missing_does_not_make_texting_live: true,
    },
  };
}

function leadModelFromFeedChannel(channel: "form" | "call"): LeadModel {
  return channel === "form" ? "FormLead" : "CallLead";
}

function resolveLeadSourceId(
  submitted: string | undefined,
  feeds: LoadedFeed[],
): string {
  const derived = feeds[0]?.source_company_id;
  if (!derived) {
    throw invalid("A destination Feed is required to derive the Lead Source.");
  }
  const mismatchedFeed = feeds.find((feed) => feed.source_company_id !== derived);
  if (mismatchedFeed) {
    throw invalid(
      `Feeds belong to different Lead Sources (${derived} vs ${mismatchedFeed.source_company_id}).`,
    );
  }
  if (submitted && submitted !== derived) {
    throw invalid(
      `Submitted Lead Source ${submitted} does not match Feed Lead Source ${derived}.`,
    );
  }
  return derived;
}

async function loadDestinationFeed(feedId: string): Promise<LoadedFeed> {
  const row = await getLeadSourceGranularityModel().findById(feedId).lean().exec();
  if (!row) {
    throw new RegistryError("Feed not found.", {
      registryCode: REGISTRY_ERROR_CODES.NOT_FOUND,
    });
  }
  const companyId = String(row.source_company);
  const company = await getLeadSourceCompanyModel().findById(companyId).lean().exec();
  if (!company) {
    throw invalid(
      `Feed ${String(row._id)} belongs to a missing Lead Source ${companyId}.`,
    );
  }
  return {
    id: String(row._id),
    source_company_id: companyId,
    active: row.active === true,
    channel: row.channel,
    local: row.local ?? undefined,
  };
}

function invalid(message: string): RegistryError {
  return new RegistryError(message, {
    registryCode: REGISTRY_ERROR_CODES.DEPENDENCY_CONFLICT,
    statusCode: 400,
  });
}
