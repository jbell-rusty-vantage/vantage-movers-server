import mongoose, { type ClientSession } from "mongoose";
import { getRingCentralInboundRouteModel } from "../../models/RingCentralInboundRoute";
import { getRingCentralInboundRouteAssignmentModel } from "../../models/RingCentralInboundRouteAssignment";
import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../models/LeadSourceGranularity";
import { getCallLeadModel } from "../../models/CallLead";
import { normalizePhoneNumberToE164Like } from "../ringcentral/phone-normalization";
import { recordOperationalEvent } from "../observability";
import { REGISTRY_ERROR_CODES } from "../errors/registryErrorCodes";
import { RegistryError } from "./errors";
import { withRegistryMutation, type RegistryAuditDeps } from "./registryAudit";
import { RINGCENTRAL_ROUTE_CACHE_KEY } from "./ringCentralSnapshot";
import type { RegistryActorContext } from "./types";
import {
  validateRingCentralNumberAgainstAccount,
  type RingCentralRouteValidationResult,
  type RingCentralRouteValidator,
} from "./ringCentralValidation";
import { toObjectId } from "../../utils/objectId";

const DEFAULT_VALIDATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type RingCentralRouteCommand = {
  id?: string;
  phone_number?: string;
  display_label?: string;
  created_from?: string;
  reason?: string;
};
export type RingCentralRouteActivationCommand = {
  id: string;
  source_granularity_id: string;
  reason?: string;
  now?: Date;
};
export type RingCentralRouteDeactivationCommand = {
  id: string;
  reason?: string;
  now?: Date;
};
export type RingCentralRouteAssignmentItem = {
  id: string;
  route_id: string;
  source_company_id: string;
  source_granularity_id: string;
  lead_source_name?: string;
  lead_source_company_slug?: string;
  feed_display_name?: string;
  granularity_key?: string;
  channel?: "form" | "call";
  effective_from: Date;
  effective_until?: Date;
  active: boolean;
  change_reason?: string;
};
export type RingCentralRouteItem = {
  id: string;
  provider: "ringcentral";
  phone_number: string;
  phone_locked: boolean;
  display_label: string;
  active: boolean;
  ever_activated: boolean;
  archived_at?: Date;
  deactivation_reason?: string;
  ringcentral_phone_number_id?: string;
  ringcentral_extension_id?: string;
  ringcentral_queue_id?: string;
  ringcentral_queue_name?: string;
  observed_target_names: string[];
  validation_status: "unvalidated" | "valid" | "invalid";
  validation_code?: string;
  validation_message?: string;
  validated_at?: Date;
  last_seen_in_call_log_at?: Date;
  last_seen_in_webhook_at?: Date;
  created_from: string;
  current_assignment?: RingCentralRouteAssignmentItem;
  assignment_history?: RingCentralRouteAssignmentItem[];
};

export async function listRingCentralInboundRoutes(
  options: { includeInactive?: boolean; includeHistory?: boolean } = {},
): Promise<RingCentralRouteItem[]> {
  const Route = getRingCentralInboundRouteModel();
  const Assignment = getRingCentralInboundRouteAssignmentModel();
  const routes = await Route.find(options.includeInactive ? {} : { active: true })
    .sort({ display_label: 1, phone_number: 1 }).lean().exec();
  const assignments = routes.length
    ? await Assignment.find({
        route: { $in: routes.map((route) => route._id) },
        ...(options.includeHistory ? {} : { effective_until: { $exists: false } }),
      }).sort({ effective_from: -1 }).lean().exec()
    : [];
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const assignment of assignments as unknown as Record<string, unknown>[]) {
    const key = String(assignment.route);
    grouped.set(key, [...(grouped.get(key) ?? []), assignment]);
  }
  return enrichRouteAssignments(
    routes.map((route) =>
      toRouteItem(
        route as unknown as Record<string, unknown>,
        grouped.get(String(route._id)) ?? [],
        options.includeHistory === true,
      ),
    ),
  );
}

export async function getRingCentralInboundRoute(
  id: string,
): Promise<RingCentralRouteItem> {
  const route = await getRingCentralInboundRouteModel().findById(id).lean().exec();
  if (!route) throw notFound();
  const assignments = await getRingCentralInboundRouteAssignmentModel()
    .find({ route: id }).sort({ effective_from: -1 }).lean().exec();
  const [item] = await enrichRouteAssignments([
    toRouteItem(
      route as unknown as Record<string, unknown>,
      assignments as unknown as Record<string, unknown>[],
      true,
    ),
  ]);
  return item!;
}

export async function previewRingCentralRouteDependencies(id: string) {
  const Route = getRingCentralInboundRouteModel();
  const Assignment = getRingCentralInboundRouteAssignmentModel();
  if (!(await Route.exists({ _id: id }))) throw notFound();
  const [activeAssignmentCount, historyCount, callLeadCount] = await Promise.all([
    Assignment.countDocuments({
      route: id,
      effective_until: { $exists: false },
      active: true,
    }),
    Assignment.countDocuments({ route: id }),
    getCallLeadModel().countDocuments({ "ringcentral.route_id": id }),
  ]);
  return {
    route_id: id,
    active_assignment_count: activeAssignmentCount,
    assignment_history_count: historyCount,
    call_lead_count: callLeadCount,
  };
}

export async function recordRingCentralRouteObservation(
  routeId: string,
  kind: "call_log" | "webhook",
  observedAt: Date,
  targetName?: string | null,
): Promise<void> {
  const field = kind === "call_log"
    ? "last_seen_in_call_log_at"
    : "last_seen_in_webhook_at";
  await getRingCentralInboundRouteModel().updateOne(
    { _id: routeId },
    {
      $max: { [field]: observedAt },
      ...(targetName?.trim()
        ? { $addToSet: { observed_target_names: targetName.trim() } }
        : {}),
    },
  ).exec();
}

export async function createOrUpdateRingCentralRoute(
  command: RingCentralRouteCommand,
  actor: RegistryActorContext,
): Promise<RingCentralRouteItem> {
  assertOwner(actor);
  const Route = getRingCentralInboundRouteModel();
  const routeId = command.id ?? new mongoose.Types.ObjectId().toString();
  const audit: {
    entityType: "ringcentral_route";
    entityId: string;
    action: "create" | "update";
    reason?: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    metadata?: Record<string, unknown>;
  } = {
    entityType: "ringcentral_route",
    entityId: routeId,
    action: command.id ? "update" : "create",
    reason: command.reason,
  };
  await withRegistryMutation({
    actor,
    audit,
    invalidateKeys: [RINGCENTRAL_ROUTE_CACHE_KEY],
    mutate: async (session) => {
      const before = command.id
        ? await Route.findById(command.id).session(session).lean().exec()
        : null;
      if (command.id && !before) throw notFound();
      const phone = normalizePhoneNumberToE164Like(
        command.phone_number ?? before?.phone_number,
      );
      if (!phone) throw invalid("A valid phone_number is required.");
      if (before?.phone_locked && phone !== before.phone_number) {
        throw new RegistryError("phone_number is immutable after first activation.", {
          registryCode: REGISTRY_ERROR_CODES.IMMUTABLE_FIELD,
          remediation: { summary: "Create a new route for a different number." },
        });
      }
      const duplicate = await Route.findOne({
        phone_number: phone,
        _id: { $ne: routeId },
      }).session(session).lean().exec();
      if (duplicate) {
        throw new RegistryError("This RingCentral phone number already exists.", {
          registryCode: REGISTRY_ERROR_CODES.DUPLICATE_IDENTIFIER,
          remediation: {
            summary: "Edit the existing route instead.",
            entity_type: "ringcentral_route",
            entity_id: String(duplicate._id),
          },
        });
      }
      const phoneChanged = Boolean(before && before.phone_number !== phone);
      const set: Record<string, unknown> = {
        phone_number: phone,
        display_label: (
          command.display_label ?? before?.display_label ?? phone
        ).trim(),
        created_from: command.created_from?.trim() || before?.created_from || "admin",
      };
      if (!before) {
        Object.assign(set, {
          _id: toObjectId(routeId),
          provider: "ringcentral",
          phone_locked: false,
          active: false,
          ever_activated: false,
          validation_status: "unvalidated",
          observed_target_names: [],
          created_by: actorSnapshot(actor),
        });
      }
      const update: Record<string, unknown> = { $set: set };
      if (phoneChanged) {
        Object.assign(set, { validation_status: "unvalidated" });
        update.$unset = {
          validation_code: 1,
          validation_message: 1,
          validated_at: 1,
          validated_by: 1,
          ringcentral_phone_number_id: 1,
          ringcentral_extension_id: 1,
          ringcentral_queue_id: 1,
          ringcentral_queue_name: 1,
        };
      }
      const after = await Route.findOneAndUpdate({ _id: routeId }, update, {
        upsert: !command.id,
        returnDocument: "after",
        session,
        runValidators: true,
      }).lean().exec();
      audit.before = before as unknown as Record<string, unknown> | null;
      audit.after = after as unknown as Record<string, unknown>;
      return after;
    },
  });
  return getRingCentralInboundRoute(routeId);
}

export async function validateRingCentralRoute(
  command: { id: string; reason?: string },
  actor: RegistryActorContext,
  validator: RingCentralRouteValidator = validateRingCentralNumberAgainstAccount,
): Promise<RingCentralRouteItem> {
  assertOwner(actor);
  const Route = getRingCentralInboundRouteModel();
  const route = await Route.findById(command.id).lean().exec();
  if (!route) throw notFound();
  const result = await validator(route.phone_number);
  const validatedAt = new Date();
  const audit: {
    entityType: "ringcentral_route";
    entityId: string;
    action: "validate";
    reason?: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    metadata: Record<string, unknown>;
  } = {
    entityType: "ringcentral_route",
    entityId: command.id,
    action: "validate",
    reason: command.reason,
    metadata: { validation_status: result.status, validation_code: result.code },
  };
  await withRegistryMutation({
    actor,
    audit,
    invalidateKeys: [RINGCENTRAL_ROUTE_CACHE_KEY],
    mutate: async (session) => {
      const before = await Route.findById(command.id).session(session).lean().exec();
      if (!before) throw notFound();
      if (before.phone_number !== route.phone_number) {
        throw new RegistryError("The route changed while validation was running.", {
          registryCode: REGISTRY_ERROR_CODES.STALE_REVISION,
          remediation: { summary: "Validate the current phone number again." },
        });
      }
      const after = await Route.findByIdAndUpdate(
        command.id,
        validationUpdate(result, actor, validatedAt),
        { returnDocument: "after", session, runValidators: true },
      ).lean().exec();
      audit.before = before as unknown as Record<string, unknown>;
      audit.after = after as unknown as Record<string, unknown>;
      return after;
    },
  });
  if (result.status !== "valid") {
    await recordOperationalEvent({
      level: result.status === "unavailable" ? "error" : "warn",
      eventKey: "ringcentral.route.validation_failed",
      category: "ringcentral",
      workflow: "operations_registry_ringcentral_validation",
      summary: "RingCentral route validation did not succeed.",
      entity: { type: "ringcentral_route", id: command.id },
      details: {
        phoneNumber: route.phone_number,
        validationCode: result.code,
        validationMessage: result.message,
      },
      notificationCandidate: result.status === "unavailable",
    });
  }
  return getRingCentralInboundRoute(command.id);
}

export async function activateRingCentralRoute(
  command: RingCentralRouteActivationCommand,
  actor: RegistryActorContext,
  deps: RegistryAuditDeps = {},
): Promise<RingCentralRouteItem> {
  return mutateAssignment("activate", command, actor, deps);
}

export async function reassignRingCentralRoute(
  command: RingCentralRouteActivationCommand,
  actor: RegistryActorContext,
  deps: RegistryAuditDeps = {},
): Promise<RingCentralRouteItem> {
  return mutateAssignment("reassign", command, actor, deps);
}

export async function deactivateRingCentralRoute(
  command: RingCentralRouteDeactivationCommand,
  actor: RegistryActorContext,
): Promise<RingCentralRouteItem> {
  assertOwner(actor);
  const Route = getRingCentralInboundRouteModel();
  const now = command.now ?? new Date();
  const audit: {
    entityType: "ringcentral_route";
    entityId: string;
    action: "deactivate";
    reason?: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    metadata?: Record<string, unknown>;
  } = {
    entityType: "ringcentral_route",
    entityId: command.id,
    action: "deactivate",
    reason: command.reason,
  };
  await withRegistryMutation({
    actor,
    audit,
    invalidateKeys: [RINGCENTRAL_ROUTE_CACHE_KEY],
    mutate: async (session) => {
      const before = await Route.findById(command.id).session(session).lean().exec();
      if (!before) throw notFound();
      const closedAssignment = await closeOpenAssignment(command.id, now, session);
      const after = await Route.findByIdAndUpdate(
        command.id,
        {
          $set: {
            active: false,
            archived_at: now,
            deactivation_reason: command.reason?.trim() || undefined,
          },
        },
        { returnDocument: "after", session },
      ).lean().exec();
      audit.before = before as unknown as Record<string, unknown>;
      audit.after = after as unknown as Record<string, unknown>;
      audit.metadata = { closed_assignment: closedAssignment };
      return after;
    },
  });
  return getRingCentralInboundRoute(command.id);
}

async function mutateAssignment(
  action: "activate" | "reassign",
  command: RingCentralRouteActivationCommand,
  actor: RegistryActorContext,
  deps: RegistryAuditDeps = {},
): Promise<RingCentralRouteItem> {
  assertOwner(actor);
  const Route = getRingCentralInboundRouteModel();
  const Assignment = getRingCentralInboundRouteAssignmentModel();
  const now = command.now ?? new Date();
  const assignmentId = new mongoose.Types.ObjectId();
  const audit: {
    entityType: "ringcentral_route";
    entityId: string;
    action: "activate" | "reassign";
    reason?: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    metadata?: Record<string, unknown>;
  } = {
    entityType: "ringcentral_route",
    entityId: command.id,
    action,
    reason: command.reason,
  };
  await withRegistryMutation({
    actor,
    audit,
    invalidateKeys: [RINGCENTRAL_ROUTE_CACHE_KEY],
    mutate: async (session) => {
      const before = await Route.findById(command.id).session(session).lean().exec();
      if (!before) throw notFound();
      assertValidFreshValidation(before as unknown as Record<string, unknown>, now);
      const target = await loadAssignmentTarget(command.source_granularity_id, session);
      const open = await Assignment.findOne({
        route: command.id,
        effective_until: { $exists: false },
      }).session(session).lean().exec();
      if (action === "activate" && before.active && open) {
        throw dependency("The route is already active. Use reassignment instead.");
      }
      if (action === "reassign" && (!before.active || !open)) {
        throw dependency("Only an active assigned route can be reassigned.");
      }
      const closedAssignment = await closeOpenAssignment(command.id, now, session);
      await Assignment.create([{
        _id: assignmentId,
        route: command.id,
        source_company: target.companyId,
        source_granularity: target.granularityId,
        effective_from: now,
        active: true,
        created_by: actorSnapshot(actor),
        change_reason: command.reason?.trim() || undefined,
      }], { session });
      const after = await Route.findByIdAndUpdate(
        command.id,
        {
          $set: { active: true, ever_activated: true, phone_locked: true },
          $unset: { archived_at: 1, deactivation_reason: 1 },
        },
        { returnDocument: "after", session },
      ).lean().exec();
      audit.before = before as unknown as Record<string, unknown>;
      audit.after = after as unknown as Record<string, unknown>;
      audit.metadata = {
        closed_assignment: closedAssignment,
        assignment_id: assignmentId.toString(),
        source_company_id: target.companyId,
        source_granularity_id: target.granularityId,
        effective_from: now.toISOString(),
      };
      return after;
    },
  }, deps);
  return getRingCentralInboundRoute(command.id);
}

async function closeOpenAssignment(
  routeId: string,
  at: Date,
  session: ClientSession,
): Promise<Record<string, unknown> | null> {
  const Assignment = getRingCentralInboundRouteAssignmentModel();
  const rows = await Assignment.find({
    route: routeId,
    effective_until: { $exists: false },
  }).session(session).select({ _id: 1 }).lean().exec();
  if (rows.length > 1) throw dependency("The route has multiple open assignments.");
  if (rows[0]) {
    const before = await Assignment.findById(rows[0]._id)
      .session(session)
      .lean()
      .exec();
    await Assignment.updateOne(
      { _id: rows[0]._id, effective_until: { $exists: false } },
      { $set: { effective_until: at, active: false } },
      { session },
    ).exec();
    return before
      ? {
          id: String(before._id),
          source_company_id: String(before.source_company),
          source_granularity_id: String(before.source_granularity),
          effective_from: before.effective_from,
          effective_until: at,
        }
      : null;
  }
  return null;
}

async function loadAssignmentTarget(
  granularityId: string,
  session: ClientSession,
): Promise<{ granularityId: string; companyId: string }> {
  const granularity = await getLeadSourceGranularityModel()
    .findById(granularityId).session(session).lean().exec();
  if (!granularity) {
    throw new RegistryError("Source Granularity not found.", {
      registryCode: REGISTRY_ERROR_CODES.NOT_FOUND,
    });
  }
  if (!granularity.active || granularity.channel !== "call") {
    throw dependency("RingCentral routes require an active call Source Granularity.");
  }
  const company = await getLeadSourceCompanyModel()
    .findById(granularity.source_company).session(session).lean().exec();
  if (!company?.active) throw dependency("The assigned Source Company must be active.");
  return {
    granularityId: String(granularity._id),
    companyId: String(company._id),
  };
}

function validationUpdate(
  result: RingCentralRouteValidationResult,
  actor: RegistryActorContext,
  at: Date,
): Record<string, unknown> {
  const common = {
    validation_status: result.status === "valid"
      ? "valid"
      : result.status === "invalid" ? "invalid" : "unvalidated",
    validation_code: result.code,
    validation_message: result.message,
    validated_at: at,
    validated_by: actorSnapshot(actor),
  };
  if (result.status !== "valid") {
    return {
      $set: common,
      $unset: {
        ringcentral_phone_number_id: 1,
        ringcentral_extension_id: 1,
        ringcentral_queue_id: 1,
        ringcentral_queue_name: 1,
      },
    };
  }
  return {
    $set: {
      ...common,
      ringcentral_phone_number_id: result.phoneNumberId,
      ringcentral_extension_id: result.extensionId,
      ringcentral_queue_id: result.queueId,
      ringcentral_queue_name: result.queueName,
      observed_target_names: result.observedTargetNames,
    },
  };
}

function assertValidFreshValidation(
  route: Record<string, unknown>,
  now: Date,
): void {
  if (route.validation_status !== "valid") {
    throw new RegistryError("The RingCentral route has not passed validation.", {
      registryCode: route.validation_status === "invalid"
        ? REGISTRY_ERROR_CODES.RINGCENTRAL_ROUTE_INVALID
        : REGISTRY_ERROR_CODES.RINGCENTRAL_ROUTE_UNVALIDATED,
      remediation: { summary: "Validate the route against RingCentral first." },
    });
  }
  const validatedAt = route.validated_at instanceof Date
    ? route.validated_at
    : new Date(String(route.validated_at ?? ""));
  const configured = Number(process.env.RINGCENTRAL_ROUTE_VALIDATION_MAX_AGE_MS);
  const maxAge = Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_VALIDATION_MAX_AGE_MS;
  if (
    Number.isNaN(validatedAt.getTime()) ||
    now.getTime() - validatedAt.getTime() > maxAge
  ) {
    throw new RegistryError("The RingCentral route validation is stale.", {
      registryCode: REGISTRY_ERROR_CODES.RINGCENTRAL_ROUTE_UNVALIDATED,
      remediation: { summary: "Validate the route again before activation." },
    });
  }
}

async function enrichRouteAssignments(
  routes: RingCentralRouteItem[],
): Promise<RingCentralRouteItem[]> {
  const assignments = routes.flatMap((route) => [
    ...(route.current_assignment ? [route.current_assignment] : []),
    ...(route.assignment_history ?? []),
  ]);
  const companyIds = [
    ...new Set(assignments.map((assignment) => assignment.source_company_id).filter(Boolean)),
  ];
  const feedIds = [
    ...new Set(assignments.map((assignment) => assignment.source_granularity_id).filter(Boolean)),
  ];
  if (!companyIds.length && !feedIds.length) return routes;
  const [companies, feeds] = await Promise.all([
    companyIds.length
      ? getLeadSourceCompanyModel()
          .find({ _id: { $in: companyIds } })
          .select({ name: 1, owner_label: 1, company_slug: 1 })
          .lean()
          .exec()
      : Promise.resolve([]),
    feedIds.length
      ? getLeadSourceGranularityModel()
          .find({ _id: { $in: feedIds } })
          .select({ owner_label: 1, granularity_key: 1, channel: 1 })
          .lean()
          .exec()
      : Promise.resolve([]),
  ]);
  const companyById = new Map(
    companies.map((company) => [
      String(company._id),
      {
        name: String(company.owner_label ?? company.name),
        company_slug: String(company.company_slug),
      },
    ]),
  );
  const feedById = new Map(
    feeds.map((feed) => [
      String(feed._id),
      {
        display_name: String(feed.owner_label),
        granularity_key: String(feed.granularity_key),
        channel: feed.channel === "call" ? ("call" as const) : ("form" as const),
      },
    ]),
  );
  const decorate = (assignment: RingCentralRouteAssignmentItem): RingCentralRouteAssignmentItem => {
    const company = companyById.get(assignment.source_company_id);
    const feed = feedById.get(assignment.source_granularity_id);
    return {
      ...assignment,
      ...(company
        ? {
            lead_source_name: company.name,
            lead_source_company_slug: company.company_slug,
          }
        : {}),
      ...(feed
        ? {
            feed_display_name: feed.display_name,
            granularity_key: feed.granularity_key,
            channel: feed.channel,
          }
        : {}),
    };
  };
  return routes.map((route) => ({
    ...route,
    ...(route.current_assignment
      ? { current_assignment: decorate(route.current_assignment) }
      : {}),
    ...(route.assignment_history
      ? { assignment_history: route.assignment_history.map(decorate) }
      : {}),
  }));
}

function toRouteItem(
  row: Record<string, unknown>,
  assignments: Record<string, unknown>[],
  includeHistory: boolean,
): RingCentralRouteItem {
  const history = assignments.map(toAssignmentItem);
  const current = history.find((assignment) => !assignment.effective_until);
  return {
    id: String(row._id),
    provider: "ringcentral",
    phone_number: String(row.phone_number),
    phone_locked: row.phone_locked === true,
    display_label: String(row.display_label),
    active: row.active === true,
    ever_activated: row.ever_activated === true,
    archived_at: optionalDate(row.archived_at),
    deactivation_reason: optionalString(row.deactivation_reason),
    ringcentral_phone_number_id: optionalString(row.ringcentral_phone_number_id),
    ringcentral_extension_id: optionalString(row.ringcentral_extension_id),
    ringcentral_queue_id: optionalString(row.ringcentral_queue_id),
    ringcentral_queue_name: optionalString(row.ringcentral_queue_name),
    observed_target_names: Array.isArray(row.observed_target_names)
      ? row.observed_target_names.map(String)
      : [],
    validation_status: row.validation_status === "valid"
      ? "valid"
      : row.validation_status === "invalid" ? "invalid" : "unvalidated",
    validation_code: optionalString(row.validation_code),
    validation_message: optionalString(row.validation_message),
    validated_at: optionalDate(row.validated_at),
    last_seen_in_call_log_at: optionalDate(row.last_seen_in_call_log_at),
    last_seen_in_webhook_at: optionalDate(row.last_seen_in_webhook_at),
    created_from: String(row.created_from ?? "admin"),
    ...(current ? { current_assignment: current } : {}),
    ...(includeHistory ? { assignment_history: history } : {}),
  };
}

function toAssignmentItem(row: Record<string, unknown>): RingCentralRouteAssignmentItem {
  return {
    id: String(row._id),
    route_id: String(row.route),
    source_company_id: String(row.source_company),
    source_granularity_id: String(row.source_granularity),
    effective_from: optionalDate(row.effective_from) ?? new Date(0),
    effective_until: optionalDate(row.effective_until),
    active: row.active === true,
    change_reason: optionalString(row.change_reason),
  };
}

function actorSnapshot(actor: RegistryActorContext) {
  return {
    actor_type: actor.actorType,
    actor_id: actor.actorId,
    actor_label: actor.actorLabel,
    actor_role: actor.actorRole,
  };
}
function assertOwner(actor: RegistryActorContext): void {
  if (actor.actorRole !== "owner") {
    throw new RegistryError("Owner role is required.", {
      registryCode: REGISTRY_ERROR_CODES.FORBIDDEN,
    });
  }
}
function notFound(): RegistryError {
  return new RegistryError("RingCentral route not found.", {
    registryCode: REGISTRY_ERROR_CODES.NOT_FOUND,
  });
}
function invalid(message: string): RegistryError {
  return new RegistryError(message, {
    registryCode: REGISTRY_ERROR_CODES.RINGCENTRAL_ROUTE_INVALID,
  });
}
function dependency(message: string): RegistryError {
  return new RegistryError(message, {
    registryCode: REGISTRY_ERROR_CODES.DEPENDENCY_CONFLICT,
  });
}
function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
function optionalDate(value: unknown): Date | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  return undefined;
}
