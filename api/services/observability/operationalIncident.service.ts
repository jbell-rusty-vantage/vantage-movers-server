import type mongoose from "mongoose";
import {
  type IncidentSeverity,
  observabilityLevelRank,
} from "../../config/domain/observability";
import {
  getOperationalIncidentModel,
  type OperationalIncidentDocument,
} from "../../models/OperationalIncident";

/**
 * Incident dedupe/upsert + auto-resolution logic built on top of
 * `operational_incidents`. An incident is the stateful issue record the owner
 * acts on; repeated failures with the same fingerprint increment `count` on a
 * single open incident.
 *
 * This service performs Mongo writes only. Notification decisions live in
 * `notificationPolicy.ts`; incident records are updated for notification state
 * there via `markIncidentNotified` / `markIncidentSuppressed`.
 */

export type UpsertIncidentInput = {
  eventId: mongoose.Types.ObjectId;
  severity: IncidentSeverity;
  fingerprint: string;
  dedupeKey: string;
  eventKey: string;
  category: string;
  workflow: string;
  title: string;
  summary: string;
  environment: string;
  service: string;
  sourceCompany: string | null;
  route: string | null;
  entityType: string | null;
  entityId: string | null;
  leadName: string | null;
  leadPhone: string | null;
  leadEmail: string | null;
  runId: string | null;
  lastDetails: Record<string, unknown>;
  ownerVisible: boolean;
  occurredAt: Date;
};

export type UpsertIncidentResult = {
  incident: OperationalIncidentDocument;
  isNew: boolean;
};

function worseSeverity(
  current: IncidentSeverity | undefined,
  incoming: IncidentSeverity,
): IncidentSeverity {
  if (!current) {
    return incoming;
  }
  return observabilityLevelRank(incoming) > observabilityLevelRank(current)
    ? incoming
    : current;
}

/**
 * Upserts the open/acknowledged incident for a fingerprint. New incidents are
 * created `open`; existing ones get `count++` and refreshed last-seen fields.
 */
export async function upsertIncidentForEvent(
  input: UpsertIncidentInput,
): Promise<UpsertIncidentResult> {
  const Incident = getOperationalIncidentModel();

  const before = await Incident.findOne({
    fingerprint: input.fingerprint,
    status: { $in: ["open", "acknowledged"] },
  })
    .select({ _id: 1, severity: 1 })
    .lean();

  const incident = await Incident.findOneAndUpdate(
    {
      fingerprint: input.fingerprint,
      status: { $in: ["open", "acknowledged"] },
    },
    {
      $setOnInsert: {
        status: "open",
        severity: input.severity,
        fingerprint: input.fingerprint,
        dedupe_key: input.dedupeKey,
        event_key: input.eventKey,
        category: input.category,
        workflow: input.workflow,
        title: input.title,
        environment: input.environment,
        service: input.service,
        first_event_id: input.eventId,
        first_seen_at: input.occurredAt,
        owner_visible: input.ownerVisible,
      },
      $set: {
        severity: worseSeverity(before?.severity as IncidentSeverity | undefined, input.severity),
        summary: input.summary,
        source_company: input.sourceCompany,
        route: input.route,
        entity_type: input.entityType,
        entity_id: input.entityId,
        lead_name: input.leadName,
        lead_phone: input.leadPhone,
        lead_email: input.leadEmail,
        run_id: input.runId,
        latest_event_id: input.eventId,
        last_seen_at: input.occurredAt,
        last_details: input.lastDetails,
      },
      $inc: { count: 1 },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    },
  );

  return {
    incident: incident as OperationalIncidentDocument,
    isNew: !before,
  };
}

/**
 * Auto-resolves any open/acknowledged incidents matching the given dedupe key
 * (or fingerprint). Used when a matching success event is recorded, for
 * example a clean `sheet_sync.drain.completed` after a partial failure.
 *
 * Returns the number of incidents resolved.
 */
export async function autoResolveIncidents(params: {
  dedupeKey?: string | null;
  fingerprint?: string | null;
  now?: Date;
}): Promise<number> {
  const { dedupeKey, fingerprint } = params;
  if (!dedupeKey && !fingerprint) {
    return 0;
  }

  const Incident = getOperationalIncidentModel();
  const now = params.now ?? new Date();

  const match: Record<string, unknown> = {
    status: { $in: ["open", "acknowledged"] },
  };
  if (fingerprint) {
    match.fingerprint = fingerprint;
  } else if (dedupeKey) {
    match.dedupe_key = dedupeKey;
  }

  const result = await Incident.updateMany(match, {
    $set: { status: "auto_resolved", resolved_at: now },
  });

  return result.modifiedCount ?? 0;
}
