import type { Db, Document } from "mongodb";
import mongoose from "mongoose";
import { PRODUCTION_CONFIRMATION } from "../../../migrations/operations-registry-inventory.lib.js";
import { TEST_DATABASE } from "../../../migrations/operations-registry-migration.lib.js";
import { isObjectIdString, toObjectId } from "../../../../src/utils/objectId.js";
import { equivalentNormalizedJobFilter } from "./normalize.js";
import type {
  BookingRow,
  CancellationRow,
  CaseRow,
  CrmSourceRow,
  DecisionRow,
  DiscrepancyRow,
  EntityChangeRow,
  GranularityRow,
  JobTimelineRows,
  LeadMessageRow,
  LeadRow,
  ObservationRow,
  RecordLinkRow,
  SheetSyncJobRow,
} from "./rows.js";
import type { JobTimelineLeadModel } from "./types.js";

export const PRODUCTION_DATABASE = "vantagemovers";
export { TEST_DATABASE, PRODUCTION_CONFIRMATION };

function asId(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && "toHexString" in value) {
    return String((value as { toHexString: () => string }).toHexString());
  }
  return String(value);
}

function asMongoId(value: string): string | ReturnType<typeof toObjectId> {
  return isObjectIdString(value) ? toObjectId(value) : value;
}

function asIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return "";
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function observationJobFilter(normalizedJobNo: string): Document {
  const filter = equivalentNormalizedJobFilter(normalizedJobNo);
  if ("normalized_job_no" in filter && typeof filter.normalized_job_no === "string") {
    return { "identity.normalized_job_no": filter.normalized_job_no };
  }
  const clauses = "$or" in filter ? filter.$or : [];
  return {
    $or: clauses.map((clause) => ({
      "identity.normalized_job_no": clause.normalized_job_no,
    })),
  };
}

export function resolveTimelineDatabase(args: readonly string[]): string {
  if (args.includes(PRODUCTION_CONFIRMATION)) {
    return PRODUCTION_DATABASE;
  }
  return TEST_DATABASE;
}

export function assertTimelineDatabaseAllowed(
  databaseName: string,
  args: readonly string[],
): void {
  if (databaseName === PRODUCTION_DATABASE && !args.includes(PRODUCTION_CONFIRMATION)) {
    throw new Error(
      `Refusing ${PRODUCTION_DATABASE} read without ${PRODUCTION_CONFIRMATION}.`,
    );
  }
  if (databaseName !== PRODUCTION_DATABASE && databaseName !== TEST_DATABASE) {
    throw new Error(`Refusing unknown database ${databaseName}.`);
  }
}

export async function timelineDatabase(
  connection: typeof mongoose,
  databaseName: string,
): Promise<Db> {
  const db = connection.connection.getClient().db(databaseName);
  if (db.databaseName !== databaseName) {
    throw new Error(`Refusing read against ${db.databaseName}. Expected ${databaseName}.`);
  }
  return db;
}

function mapObservation(row: Document): ObservationRow {
  const identity = (row.identity ?? {}) as Document;
  const priority = (row.priority ?? {}) as Document;
  const bookingAction = (row.booking_action ?? {}) as Document;
  const issues = Array.isArray(row.issues) ? row.issues : [];
  return {
    id: asId(row._id),
    captured_at: asIso(row.captured_at),
    normalized_job_no: asString(identity.normalized_job_no),
    job_no_snapshot: asString(identity.job_no_raw),
    receipt_id: row.receipt_id ? asId(row.receipt_id) : undefined,
    route_event_class: asString(row.route_event_class),
    normalization_result: asString(row.normalization_result),
    priority_canonical: asString(priority.canonical),
    priority_valid: priority.valid === true,
    booking_action_normalized: asString(bookingAction.normalized),
    issue_codes: issues
      .map((issue) => (issue && typeof issue === "object" ? asString((issue as Document).code) : undefined))
      .filter((code): code is string => Boolean(code)),
    granot_crm_source_id: row.granot_crm_source_id ? asId(row.granot_crm_source_id) : undefined,
  };
}

function mapDecision(row: Document): DecisionRow {
  const scope = (row.source_scope ?? {}) as Document;
  const target = row.target as Document | undefined;
  const effects = Array.isArray(row.effects) ? row.effects : [];
  const gates = Array.isArray(row.evaluated_gates) ? row.evaluated_gates : [];
  return {
    id: asId(row._id),
    observation_id: asId(row.observation_id),
    attempt: typeof row.attempt === "number" ? row.attempt : 0,
    decided_at: asIso(row.decided_at),
    execution_mode: asString(row.execution_mode),
    outcome: asString(row.outcome),
    reason_code: asString(row.reason_code),
    match_method: asString(row.match_method),
    target: target?.id && target.model
      ? { model: String(target.model), id: asId(target.id) }
      : undefined,
    source_granularity_id: scope.source_granularity_id ? asId(scope.source_granularity_id) : undefined,
    source_company_id: scope.lead_source_company ? asId(scope.lead_source_company) : undefined,
    effect_kinds: effects
      .map((effect) => (effect && typeof effect === "object" ? asString((effect as Document).kind) : undefined))
      .filter((kind): kind is string => Boolean(kind)),
    evaluated_gates: gates.flatMap((gate) => {
      if (!gate || typeof gate !== "object") return [];
      const record = gate as Document;
      const name = asString(record.gate);
      if (!name) return [];
      return [{ gate: name, allowed: record.allowed === true }];
    }),
  };
}

function mapCase(row: Document, kind: "booking" | "release"): CaseRow {
  const evidence = Array.isArray(row.evidence) ? row.evidence : [];
  return {
    id: asId(row._id),
    kind,
    normalized_job_no: String(row.normalized_job_no ?? ""),
    job_no_snapshot: asString(row.job_no_snapshot),
    state: row.state === "resolved" ? "resolved" : "open",
    mode: asString(row.mode) ?? (kind === "release" ? "release" : undefined),
    sequence_number: typeof row.sequence_number === "number" ? row.sequence_number : undefined,
    case_revision: typeof row.case_revision === "number" ? row.case_revision : undefined,
    evidence_revision: typeof row.evidence_revision === "number" ? row.evidence_revision : undefined,
    opened_at: asIso(row.opened_at),
    resolved_at: row.resolved_at ? asIso(row.resolved_at) : undefined,
    evidence: evidence.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Document;
      return [{
        observation_id: asId(record.observation_id),
        captured_at: asIso(record.captured_at),
      }];
    }),
  };
}

export async function loadCompanyGranularityIds(
  db: Db,
  sourceCompanyId: string,
): Promise<string[]> {
  const rows = await db.collection("lead_source_granularities").find({
    source_company: asMongoId(sourceCompanyId),
  }).project({ _id: 1 }).toArray();
  return rows.map((row) => asId(row._id));
}

export async function loadJobNumberTimelineRows(
  db: Db,
  normalizedJobNo: string,
): Promise<JobTimelineRows> {
  const jobFilter = equivalentNormalizedJobFilter(normalizedJobNo);
  const [
    observations,
    record_links,
    bookings,
    booking_cases,
    release_cases,
    booking_discrepancies,
    release_discrepancies,
  ] = await Promise.all([
    db.collection("granot_observations").find(observationJobFilter(normalizedJobNo)).toArray(),
    db.collection("granot_record_links").find(jobFilter).toArray(),
    db.collection("booked_leads").find(jobFilter).toArray(),
    db.collection("granot_booking_reconciliation_cases").find(jobFilter).toArray(),
    db.collection("granot_release_reconciliation_cases").find(jobFilter).toArray(),
    db.collection("granot_booking_discrepancies").find(jobFilter).toArray(),
    db.collection("granot_release_discrepancies").find(jobFilter).toArray(),
  ]);

  const observationIds = observations.map((row) => row._id);
  const decisions = observationIds.length > 0
    ? await db.collection("synchronization_decisions").find({ observation_id: { $in: observationIds } }).toArray()
    : [];

  const mappedObservations = observations.map(mapObservation);
  const mappedDecisions = decisions.map(mapDecision);
  const mappedLinks: RecordLinkRow[] = record_links.map((row) => {
    const leadRef = row.lead_ref as Document | undefined;
    const scope = (row.source_scope ?? {}) as Document;
    return {
      id: asId(row._id),
      normalized_job_no: String(row.normalized_job_no ?? ""),
      job_no_snapshot: asString(row.job_no_snapshot),
      state: String(row.state ?? ""),
      established_at: asIso(row.established_at),
      lead_ref: leadRef?.id && (leadRef.model === "FormLead" || leadRef.model === "CallLead")
        ? { model: leadRef.model, id: asId(leadRef.id) }
        : undefined,
      source_granularity_id: scope.source_granularity_id ? asId(scope.source_granularity_id) : undefined,
      source_company_id: scope.lead_source_company ? asId(scope.lead_source_company) : undefined,
    };
  });
  const mappedBookings: BookingRow[] = bookings.map((row) => ({
    id: asId(row._id),
    normalized_job_no: String(row.normalized_job_no ?? ""),
    job_no_snapshot: asString(row.job_no),
    lead_ref: row.lead_ref ? asId(row.lead_ref) : undefined,
    lead_model: row.lead_model === "CallLead" || row.lead_model === "FormLead"
      ? row.lead_model
      : undefined,
    last_changed_at: row.last_changed_at ? asIso(row.last_changed_at) : undefined,
    timestamp: row.timestamp ? asIso(row.timestamp) : undefined,
    createdAt: row.createdAt ? asIso(row.createdAt) : undefined,
  }));
  const mappedBookingCases = booking_cases.map((row) => mapCase(row, "booking"));
  const mappedReleaseCases = release_cases.map((row) => mapCase(row, "release"));
  const mappedBookingDiscrepancies: DiscrepancyRow[] = booking_discrepancies.map((row) => ({
    id: asId(row._id),
    normalized_job_no: String(row.normalized_job_no ?? ""),
  }));
  const mappedReleaseDiscrepancies: DiscrepancyRow[] = release_discrepancies.map((row) => ({
    id: asId(row._id),
    normalized_job_no: String(row.normalized_job_no ?? ""),
  }));

  const bookingIds = mappedBookings.map((row) => row.id);
  const cancellations = bookingIds.length > 0
    ? await db.collection("cancelled_leads").find({
        booked_lead: { $in: bookingIds.map(asMongoId) },
      }).toArray()
    : [];
  const mappedCancellations: CancellationRow[] = cancellations.map((row) => ({
    id: asId(row._id),
    booked_lead: row.booked_lead ? asId(row.booked_lead) : undefined,
    last_changed_at: row.last_changed_at ? asIso(row.last_changed_at) : undefined,
    createdAt: row.createdAt ? asIso(row.createdAt) : undefined,
  }));

  const leadRef = mappedLinks.find((row) => row.state === "active" && row.lead_ref)?.lead_ref
    ?? (mappedBookings.find((row) => row.lead_ref && row.lead_model)
      ? {
          model: mappedBookings.find((row) => row.lead_ref && row.lead_model)!.lead_model as JobTimelineLeadModel,
          id: mappedBookings.find((row) => row.lead_ref && row.lead_model)!.lead_ref as string,
        }
      : undefined)
    ?? mappedDecisions.find((row) =>
      (row.outcome === "applied" || row.outcome === "created")
      && (row.target?.model === "FormLead" || row.target?.model === "CallLead"),
    )?.target;

  let leads: LeadRow[] = [];
  let entity_changes: EntityChangeRow[] = [];
  let lead_messages: LeadMessageRow[] = [];
  if (leadRef && (leadRef.model === "FormLead" || leadRef.model === "CallLead")) {
    const collection = leadRef.model === "FormLead" ? "form_leads" : "call_leads";
    const leadDoc = await db.collection(collection).findOne({
      _id: asMongoId(leadRef.id),
    } as Document);
    if (leadDoc) {
      const granularityId = leadDoc.source_granularity_id ? asId(leadDoc.source_granularity_id) : undefined;
      leads = [{
        id: asId(leadDoc._id),
        model: leadRef.model,
        ingestion_origin: asString(leadDoc.ingestion_origin),
        timestamp: leadDoc.timestamp ? asIso(leadDoc.timestamp) : undefined,
        createdAt: leadDoc.createdAt ? asIso(leadDoc.createdAt) : undefined,
        change_history_started_at: leadDoc.change_history_started_at
          ? asIso(leadDoc.change_history_started_at)
          : undefined,
        source_granularity_id: granularityId,
        source_company_id: leadDoc.source_company_id ? asId(leadDoc.source_company_id) : undefined,
      }];
      const changes = await db.collection("entity_changes").find({
        "entity.model": leadRef.model,
        "entity.id": asId(leadDoc._id),
      }).toArray();
      entity_changes = changes.map((row) => ({
        id: asId(row._id),
        entity_model: String((row.entity as Document | undefined)?.model ?? ""),
        entity_id: asId((row.entity as Document | undefined)?.id),
        command_name: String(row.command_name ?? ""),
        applied_at: asIso(row.applied_at),
        changed_paths: Array.isArray(row.changed_paths) ? row.changed_paths.map(String) : [],
      }));
      const messageFilter: Document = leadRef.model === "FormLead"
        ? { $or: [{ "lead_ref.id": leadDoc._id }, { form_lead: leadDoc._id }] }
        : { "lead_ref.id": leadDoc._id };
      const messages = await db.collection("lead_messages").find(messageFilter).toArray();
      lead_messages = messages.map((row) => ({
        id: asId(row._id),
        lead_id: row.lead_ref && typeof row.lead_ref === "object"
          ? asId((row.lead_ref as Document).id)
          : undefined,
        form_lead: row.form_lead ? asId(row.form_lead) : undefined,
        origin: asString(row.origin),
        purpose: asString(row.purpose),
        status: asString(row.status),
        skip_reason: asString(row.skip_reason) ?? null,
        observation_id: row.observation_id ? asId(row.observation_id) : undefined,
        consent_basis: asString(row.consent_basis),
        delivered_at: row.delivered_at ? asIso(row.delivered_at) : undefined,
        sent_at: row.sent_at ? asIso(row.sent_at) : undefined,
        accepted_at: row.accepted_at ? asIso(row.accepted_at) : undefined,
        createdAt: row.createdAt ? asIso(row.createdAt) : undefined,
      }));
    }
  }

  const bookingChanges = bookingIds.length > 0
    ? await db.collection("entity_changes").find({
        "entity.model": "BookedLead",
        "entity.id": { $in: bookingIds },
      }).toArray()
    : [];
  const cancellationIds = mappedCancellations.map((row) => row.id);
  const cancellationChanges = cancellationIds.length > 0
    ? await db.collection("entity_changes").find({
        "entity.model": "CancelledLead",
        "entity.id": { $in: cancellationIds },
      }).toArray()
    : [];
  entity_changes = [
    ...entity_changes,
    ...bookingChanges.map((row) => ({
      id: asId(row._id),
      entity_model: "BookedLead",
      entity_id: asId((row.entity as Document | undefined)?.id),
      command_name: String(row.command_name ?? ""),
      applied_at: asIso(row.applied_at),
      changed_paths: Array.isArray(row.changed_paths) ? row.changed_paths.map(String) : [],
    })),
    ...cancellationChanges.map((row) => ({
      id: asId(row._id),
      entity_model: "CancelledLead",
      entity_id: asId((row.entity as Document | undefined)?.id),
      command_name: String(row.command_name ?? ""),
      applied_at: asIso(row.applied_at),
      changed_paths: Array.isArray(row.changed_paths) ? row.changed_paths.map(String) : [],
    })),
  ];

  const entityIds = [
    ...leads.map((row) => row.id),
    ...mappedBookings.map((row) => row.id),
    ...mappedCancellations.map((row) => row.id),
  ];
  const sheetJobs = entityIds.length > 0
    ? await db.collection("sheet_sync_jobs").find({ entity_id: { $in: entityIds } }).toArray()
    : [];
  const mappedSheetJobs: SheetSyncJobRow[] = sheetJobs.map((row) => ({
    id: asId(row._id),
    entity_id: String(row.entity_id ?? ""),
    entity_model: asString(row.entity_model),
    resource: String(row.resource ?? ""),
    operation: String(row.operation ?? ""),
    status: String(row.status ?? ""),
    attempts: typeof row.attempts === "number" ? row.attempts : 0,
    created_by: asString(row.created_by),
    createdAt: asIso(row.createdAt),
    updatedAt: row.updatedAt ? asIso(row.updatedAt) : undefined,
    target_hints: Array.isArray(row.target_hints) ? row.target_hints.map(String) : [],
  }));

  const sourceIds = mappedObservations
    .map((row) => row.granot_crm_source_id)
    .filter((id): id is string => Boolean(id));
  const crmSources = sourceIds.length > 0
    ? await db.collection("granot_crm_sources").find({
        _id: { $in: sourceIds.map(asMongoId) },
      } as Document).toArray()
    : [];
  const mappedSources: CrmSourceRow[] = crmSources.map((row) => {
    const route = (row.reviewed_route ?? row.route ?? {}) as Document;
    return {
      id: asId(row._id),
      source_granularity_id: route.source_granularity_id ? asId(route.source_granularity_id) : undefined,
      review_state: asString(row.review_state),
    };
  });

  const granularityIds = [
    ...leads.map((row) => row.source_granularity_id),
    ...mappedLinks.map((row) => row.source_granularity_id),
    ...mappedDecisions.map((row) => row.source_granularity_id),
    ...mappedSources.map((row) => row.source_granularity_id),
  ].filter((id): id is string => Boolean(id));
  const granularities = granularityIds.length > 0
    ? await db.collection("lead_source_granularities").find({
        _id: { $in: granularityIds.map(asMongoId) },
      } as Document).toArray()
    : [];
  const mappedGranularities: GranularityRow[] = granularities.map((row) => ({
    id: asId(row._id),
    source_company_id: row.source_company ? asId(row.source_company) : row.source_company_id ? asId(row.source_company_id) : undefined,
    owner_label: asString(row.owner_label),
    label: asString(row.label),
  }));

  return {
    observations: mappedObservations,
    decisions: mappedDecisions,
    record_links: mappedLinks,
    bookings: mappedBookings,
    cancellations: mappedCancellations,
    booking_cases: mappedBookingCases,
    release_cases: mappedReleaseCases,
    booking_discrepancies: mappedBookingDiscrepancies,
    release_discrepancies: mappedReleaseDiscrepancies,
    leads,
    entity_changes,
    lead_messages,
    sheet_sync_jobs: mappedSheetJobs,
    granot_crm_sources: mappedSources,
    source_granularities: mappedGranularities,
  };
}
