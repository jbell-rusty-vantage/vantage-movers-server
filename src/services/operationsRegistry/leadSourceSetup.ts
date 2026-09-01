import mongoose, { type ClientSession } from "mongoose";
import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../models/LeadSourceGranularity";
import { GRANOT_LIFECYCLE_SOURCE_CACHE_KEYS } from "./granotCrmSourceCache";
import { persistGranotCrmSourceInSession } from "./granotCrmSources";
import {
  assembleOwnerGranotCreateForKnownFeed,
  assertGranotNameAvailable,
} from "./ownerGranotNames";
import type { RegistryAuditDeps } from "./registryAudit";
import { withMultiEntityRegistryMutation } from "./registryAudit";
import { RegistryError } from "./errors";
import { REGISTRY_ERROR_CODES } from "../errors/registryErrorCodes";
import {
  assertExactIdentifiersAvailable,
  deriveRegistryKey,
  persistNewSourceCompanyInSession,
  persistNewSourceGranularityInSession,
  type SourceCompanyItem,
  type SourceGranularityItem,
} from "./sourceRegistry";
import type { RegistryActorContext, RegistryAuditInput } from "./types";

export type LeadSourceSetupCommand = {
  name: string;
  owner_label?: string;
  aliases?: string[];
  channel: "form" | "call";
  feed_display_name?: string;
  crm_label: string;
  move_type?: "local" | "long_distance";
  feed_aliases?: string[];
  source_sites?: string[];
  granot?: {
    name_received_from_granot: string;
    when_lead_arrives: "watch_only" | "existing_only" | "create_if_missing";
  } | null;
  reason: string;
};

export type SetupCollision = {
  field: string;
  message: string;
  existing_id?: string;
  existing_kind?: "lead_source" | "feed" | "granot_name";
  existing_name?: string;
};

export type ReadinessPlanRow = {
  gate: string;
  command: string;
  blocked_until?: string;
  suggested?: boolean;
};

export type LeadSourceSetupDerived = {
  company_slug: string;
  granularity_key: string;
  owner_label: string;
  feed_display_name: string;
  normalized_granot_label?: string;
  workspace_slug?: string;
};

export type LeadSourceSetupPreview = {
  valid: boolean;
  derived: LeadSourceSetupDerived;
  collisions: SetupCollision[];
  readiness_plan: ReadinessPlanRow[];
};

export type LeadSourceSetupResult = {
  lead_source: {
    id: string;
    company_slug: string;
    name: string;
    owner_label: string;
    active: boolean;
    aliases: string[];
  };
  feed: {
    id: string;
    granularity_key: string;
    channel: "form" | "call";
    display_name: string;
    crm_label: string;
    move_type?: "local" | "long_distance";
    active: boolean;
  };
  granot_name: {
    id: string;
    name_received_from_granot: string;
    when_lead_arrives: "watch_only" | "existing_only" | "create_if_missing";
    when_lead_arrives_copy: string;
    text_state: "off";
  } | null;
  readiness_plan: ReadinessPlanRow[];
};

const ARRIVAL_COPY = {
  watch_only: "Watch only",
  existing_only: "Use an existing lead only",
  create_if_missing: "Use an existing lead, or create it if missing",
} as const;

export function defaultFeedDisplayName(channel: "form" | "call"): string {
  return channel === "call" ? "Inbound calls" : "Web forms";
}

export function deriveSetupKeys(
  name: string,
  moveType?: "local" | "long_distance",
): {
  company_slug: string;
  granularity_key: string;
} {
  const company_slug = deriveRegistryKey(name);
  if (!company_slug) {
    throw invalid("name does not produce a usable lead-source key.");
  }
  const granularity_key = moveType ? `${company_slug}_${moveType}` : company_slug;
  return { company_slug, granularity_key };
}

export function buildReadinessPlan(input: {
  granotOmitted: boolean;
  createIfMissing: boolean;
}): ReadinessPlanRow[] {
  const rows: ReadinessPlanRow[] = [
    {
      gate: "Set the lead cost",
      command: "open_cpl",
    },
    {
      gate: "Activate the lead source",
      command: "setSourceCompanyActivation",
    },
    {
      gate: "Activate the feed",
      command: "setSourceGranularityActivation",
      blocked_until: "lead source active and lead cost valid",
    },
  ];
  if (input.granotOmitted) {
    rows.push({
      gate: "Connect a Granot name",
      command: "createGranotNameFromOwnerIntent",
      suggested: true,
    });
    return rows;
  }
  rows.push({
    gate: "Switch the Granot name live",
    command: "setGranotCrmSourceLifecycleEnabled",
    blocked_until: "feed active",
  });
  if (input.createIfMissing) {
    rows.push({
      gate: "Turn on the customer text",
      command: "setGranotCrmSourceOutboundSms",
      blocked_until: "Granot name live and create-if-missing and consent attested",
    });
  }
  return rows;
}

export async function previewLeadSourceSetup(
  command: LeadSourceSetupCommand,
): Promise<LeadSourceSetupPreview> {
  const validated = await validateLeadSourceSetup(command);
  return {
    valid: validated.collisions.length === 0,
    derived: validated.derived,
    collisions: validated.collisions,
    readiness_plan: validated.readiness_plan,
  };
}

export async function createLeadSourceSetup(
  command: LeadSourceSetupCommand,
  actor: RegistryActorContext,
  deps: RegistryAuditDeps = {},
): Promise<LeadSourceSetupResult> {
  if (actor.actorRole !== "owner") {
    throw new RegistryError("Registry mutations require an Owner actor.", {
      registryCode: REGISTRY_ERROR_CODES.FORBIDDEN,
    });
  }
  const validated = await validateLeadSourceSetup(command);
  if (validated.collisions.length) {
    throw new RegistryError(
      validated.collisions.map((collision) => collision.message).join(" "),
      {
        registryCode: REGISTRY_ERROR_CODES.DUPLICATE_IDENTIFIER,
        statusCode: 400,
        remediation: {
          summary: "Resolve every named collision before saving.",
        },
      },
    );
  }

  return withMultiEntityRegistryMutation(
    {
      actor,
      invalidateKeys: [
        "source_companies",
        "source_granularities",
        "source_attribution",
        "facets",
        ...GRANOT_LIFECYCLE_SOURCE_CACHE_KEYS,
      ],
      mutate: async (session, writeAudit) => {
        const company = await persistNewSourceCompanyInSession(
          {
            company_slug: validated.derived.company_slug,
            name: command.name.trim(),
            owner_label: validated.derived.owner_label,
            aliases: command.aliases ?? [],
            created_from: "lead_source_setup",
          },
          session,
        );
        await writeAudit(companyAudit(company, command.reason, actor.requestId));

        const feed = await persistNewSourceGranularityInSession(
          {
            source_company_id: company.id,
            granularity_key: validated.derived.granularity_key,
            channel: command.channel,
            owner_label: validated.derived.feed_display_name,
            crm_label: command.crm_label.trim(),
            aliases: command.feed_aliases ?? [],
            ...(command.move_type ? { local: command.move_type } : {}),
            source_sites: command.source_sites ?? [],
            created_from: "lead_source_setup",
          },
          session,
        );
        if (feed.active) {
          throw invalid("Setup must create an inactive feed.");
        }
        await writeAudit(feedAudit(feed, command.reason, actor.requestId));

        let granotView: LeadSourceSetupResult["granot_name"] = null;
        if (command.granot) {
          const assembled = assembleOwnerGranotCreateForKnownFeed({
            name_received_from_granot: command.granot.name_received_from_granot,
            when_lead_arrives: command.granot.when_lead_arrives,
            reason: command.reason,
            feed: {
              id: feed.id,
              source_company_id: company.id,
              channel: command.channel,
            },
          });
          const persisted = await persistGranotCrmSourceInSession(
            assembled.command,
            actor,
            session,
          );
          if (
            persisted.item.enabled ||
            persisted.item.lifecycle_enabled ||
            persisted.item.outbound_sms?.enabled
          ) {
            throw invalid("Setup must create an inactive Granot name with texting unset.");
          }
          await writeAudit(persisted.audit);
          granotView = {
            id: persisted.item.id,
            name_received_from_granot: command.granot.name_received_from_granot,
            when_lead_arrives: command.granot.when_lead_arrives,
            when_lead_arrives_copy: ARRIVAL_COPY[command.granot.when_lead_arrives],
            text_state: "off",
          };
        }

        if (company.active || feed.active) {
          throw invalid("Setup must create inactive records.");
        }

        return {
          lead_source: {
            id: company.id,
            company_slug: company.company_slug,
            name: company.name,
            owner_label: company.owner_label,
            active: company.active,
            aliases: company.aliases,
          },
          feed: {
            id: feed.id,
            granularity_key: feed.granularity_key,
            channel: feed.channel,
            display_name: feed.owner_label,
            crm_label: feed.crm_label,
            ...(feed.local ? { move_type: feed.local } : {}),
            active: feed.active,
          },
          granot_name: granotView,
          readiness_plan: validated.readiness_plan,
        };
      },
    },
    deps,
  );
}

export async function validateLeadSourceSetup(
  command: LeadSourceSetupCommand,
  session?: ClientSession | null,
): Promise<{
  derived: LeadSourceSetupDerived;
  collisions: SetupCollision[];
  readiness_plan: ReadinessPlanRow[];
}> {
  const collisions: SetupCollision[] = [];
  const reason = command.reason.trim();
  if (reason.length < 10 || reason.length > 1000) {
    collisions.push({
      field: "reason",
      message: "An explicit reason of 10 to 1000 characters is required.",
    });
  }

  const { company_slug, granularity_key } = deriveSetupKeys(
    command.name,
    command.move_type,
  );
  const owner_label = (command.owner_label ?? command.name).trim();
  const feed_display_name = (command.feed_display_name ?? defaultFeedDisplayName(command.channel)).trim();
  const derived: LeadSourceSetupDerived = {
    company_slug,
    granularity_key,
    owner_label,
    feed_display_name,
  };

  const Company = getLeadSourceCompanyModel();
  const Feed = getLeadSourceGranularityModel();

  const slugQuery = Company.findOne({ company_slug }).select({ _id: 1, name: 1, owner_label: 1 });
  const existingCompany = await (session ? slugQuery.session(session) : slugQuery).lean().exec();
  if (existingCompany) {
    collisions.push({
      field: "company_slug",
      message: `Derived lead-source key ${company_slug} is already held by ${String(existingCompany.owner_label ?? existingCompany.name)}.`,
      existing_id: String(existingCompany._id),
      existing_kind: "lead_source",
      existing_name: String(existingCompany.owner_label ?? existingCompany.name),
    });
  }

  const keyQuery = Feed.findOne({ granularity_key }).select({
    _id: 1,
    owner_label: 1,
    granularity_key: 1,
  });
  const existingFeed = await (session ? keyQuery.session(session) : keyQuery).lean().exec();
  if (existingFeed) {
    collisions.push({
      field: "granularity_key",
      message: `Derived feed key ${granularity_key} is already held by ${String(existingFeed.owner_label)}.`,
      existing_id: String(existingFeed._id),
      existing_kind: "feed",
      existing_name: String(existingFeed.owner_label),
    });
  }

  try {
    await assertExactIdentifiersAvailable(
      {
        _id: new mongoose.Types.ObjectId(),
        channel: command.channel,
        crm_label: command.crm_label.trim(),
        source_sites: command.source_sites ?? [],
      },
      session,
    );
  } catch (error) {
    collisions.push({
      field: "crm_label",
      message:
        error instanceof RegistryError
          ? `What Vantage sends to Granot collides with an active feed of the same kind.`
          : "What Vantage sends to Granot collides with an active feed of the same kind.",
      existing_kind: "feed",
    });
  }

  collisions.push(
    ...(await collectAliasCollisions(command.aliases ?? [], "lead source", session)),
    ...(await collectAliasCollisions(command.feed_aliases ?? [], "feed", session)),
  );

  if (command.granot) {
    try {
      const available = await assertGranotNameAvailable(
        command.granot.name_received_from_granot,
        session,
      );
      derived.normalized_granot_label = available.normalized;
      derived.workspace_slug = available.workspace_slug;
    } catch (error) {
      collisions.push({
        field: "granot.name_received_from_granot",
        message:
          error instanceof Error
            ? error.message
            : "Name received from Granot collides with an existing Granot name.",
        existing_kind: "granot_name",
        ...(error instanceof RegistryError && error.remediation?.entity_id
          ? { existing_id: error.remediation.entity_id }
          : {}),
      });
    }
  }

  return {
    derived,
    collisions,
    readiness_plan: buildReadinessPlan({
      granotOmitted: !command.granot,
      createIfMissing: command.granot?.when_lead_arrives === "create_if_missing",
    }),
  };
}

async function collectAliasCollisions(
  aliases: readonly string[],
  side: "lead source" | "feed",
  session?: ClientSession | null,
): Promise<SetupCollision[]> {
  const collisions: SetupCollision[] = [];
  const seen = new Set<string>();
  for (const raw of aliases) {
    const alias = normalizeAlias(raw);
    if (!alias || seen.has(alias)) continue;
    seen.add(alias);
    const Company = getLeadSourceCompanyModel();
    const Feed = getLeadSourceGranularityModel();
    const companyQuery = Company.find({
      active: true,
      $or: [
        { company_slug: alias },
        { aliases: alias },
      ],
    }).select({ _id: 1, name: 1, owner_label: 1, company_slug: 1 });
    const companies = await (session ? companyQuery.session(session) : companyQuery).lean().exec();
    for (const company of companies) {
      collisions.push({
        field: "aliases",
        message: `Alias "${raw.trim()}" on the new ${side} collides with active lead source ${String(company.owner_label ?? company.name)} (${company.company_slug}).`,
        existing_id: String(company._id),
        existing_kind: "lead_source",
        existing_name: String(company.owner_label ?? company.name),
      });
    }
    const feedQuery = Feed.find({
      active: true,
      $or: [
        { aliases: alias },
        { granularity_key: alias },
        { crm_label: new RegExp(`^${escapeRegex(raw.trim())}$`, "i") },
      ],
    }).select({ _id: 1, owner_label: 1, granularity_key: 1 });
    const feeds = await (session ? feedQuery.session(session) : feedQuery).lean().exec();
    for (const feed of feeds) {
      collisions.push({
        field: "aliases",
        message: `Alias "${raw.trim()}" on the new ${side} collides with active feed ${String(feed.owner_label)} (${feed.granularity_key}).`,
        existing_id: String(feed._id),
        existing_kind: "feed",
        existing_name: String(feed.owner_label),
      });
    }
  }
  return collisions;
}

function companyAudit(
  company: SourceCompanyItem,
  reason: string,
  requestId: string,
): RegistryAuditInput {
  return {
    entityType: "source_company",
    entityId: company.id,
    action: "create",
    reason,
    before: null,
    after: company as unknown as Record<string, unknown>,
    metadata: { request_id: requestId, created_from: "lead_source_setup" },
  };
}

function feedAudit(
  feed: SourceGranularityItem,
  reason: string,
  requestId: string,
): RegistryAuditInput {
  return {
    entityType: "source_granularity",
    entityId: feed.id,
    action: "create",
    reason,
    before: null,
    after: feed as unknown as Record<string, unknown>,
    metadata: { request_id: requestId, created_from: "lead_source_setup" },
  };
}

function normalizeAlias(value: string): string {
  return value.trim().toLowerCase();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function invalid(message: string): RegistryError {
  return new RegistryError(message, {
    registryCode: REGISTRY_ERROR_CODES.DEPENDENCY_CONFLICT,
    statusCode: 400,
  });
}
