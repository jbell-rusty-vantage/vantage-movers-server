import type { Db, Document } from "mongodb";
import mongoose from "mongoose";
import type { JobTimelinePage } from "../../job-number-timeline/src/types.js";
import { assembleJobNumberTimeline } from "../../job-number-timeline/src/assemble.js";
import { scoreJobNumberTimeline } from "../../job-number-timeline/src/discover.js";
import { loadJobNumberTimelineRows } from "../../job-number-timeline/src/load.js";
import type {
  BookingEvidence,
  CancellationEvidence,
  CaseEvidence,
  ChangeEvidence,
  DecisionEvidence,
  LeadEvidence,
  LifecycleEvidence,
  MessageEvidence,
  ObservationEvidence,
  ReceiptEvidence,
  SheetJobEvidence,
  RingCentralProcessedEvidence,
  RingCentralSyncStateEvidence,
  WindowSpec,
} from "./types.js";

export const ASSURANCE_COLLECTIONS = [
  "granot_webhook_receipts",
  "granot_observations",
  "synchronization_decisions",
  "form_leads",
  "call_leads",
  "lead_messages",
  "entity_changes",
  "granot_booking_reconciliation_cases",
  "booked_leads",
  "granot_release_reconciliation_cases",
  "cancelled_leads",
  "sheet_sync_jobs",
  "ringcentral_processed_calls",
  "ringcentral_call_log_sync_state",
] as const;

function id(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object" && "toHexString" in value) {
    return String((value as { toHexString: () => string }).toHexString());
  }
  return String(value);
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  return "";
}

function text(value: unknown, fallback = "unknown"): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export async function countAssuranceCollections(db: Db): Promise<Record<string, number>> {
  const pairs = await Promise.all(ASSURANCE_COLLECTIONS.map(async (collection) => [
    collection,
    await db.collection(collection).countDocuments({}),
  ] as const));
  return Object.fromEntries(pairs);
}

function mapReceipt(row: Document): ReceiptEvidence {
  return {
    id: id(row._id),
    captured_at: iso(row.captured_at),
    route: text(row.route_event_class),
    state: text((row.processing as Document | undefined)?.state),
  };
}

function mapObservation(row: Document): ObservationEvidence {
  const identity = (row.identity ?? {}) as Document;
  const priority = (row.priority ?? {}) as Document;
  const action = (row.booking_action ?? {}) as Document;
  return {
    id: id(row._id),
    receipt_id: row.receipt_id ? id(row.receipt_id) : null,
    captured_at: iso(row.captured_at),
    route: text(row.route_event_class),
    priority: optionalText(priority.canonical),
    action: optionalText(action.normalized),
    normalization_result: optionalText(row.normalization_result),
    normalized_job_no: optionalText(identity.normalized_job_no),
  };
}

function mapDecision(row: Document): DecisionEvidence {
  const effects = Array.isArray(row.effects) ? row.effects : [];
  return {
    id: id(row._id),
    observation_id: id(row.observation_id),
    attempt: typeof row.attempt === "number" ? row.attempt : 0,
    decided_at: iso(row.decided_at),
    execution_mode: text(row.execution_mode),
    outcome: text(row.outcome),
    reason_code: text(row.reason_code),
    effects: effects.flatMap((raw) => {
      if (!raw || typeof raw !== "object") return [];
      const effect = raw as Document;
      const ref = (effect.ref ?? {}) as Document;
      return [{
        kind: text(effect.kind),
        ref_model: optionalText(ref.model),
        ref_id: ref.id ? id(ref.id) : null,
        changed_paths: Array.isArray(effect.changed_paths)
          ? effect.changed_paths.filter((path): path is string => typeof path === "string")
          : [],
      }];
    }),
  };
}

function mapLead(row: Document, model: "FormLead" | "CallLead"): LeadEvidence {
  return {
    id: id(row._id),
    model,
    created_at: iso(row.timestamp ?? row.createdAt),
    ingestion_origin: text(row.ingestion_origin, "legacy_unknown"),
    normalized_job_no: optionalText(row.normalized_job_no),
    domain_revision: typeof row.domain_revision === "number" ? row.domain_revision : null,
  };
}

function mapMessage(row: Document): MessageEvidence {
  const ref = (row.lead_ref ?? {}) as Document;
  return {
    id: id(row._id),
    created_at: iso(row.createdAt),
    origin: text(row.origin),
    purpose: text(row.purpose),
    status: text(row.status),
    lead_model: optionalText(ref.model) ?? (row.form_lead ? "FormLead" : null),
    lead_id: ref.id ? id(ref.id) : row.form_lead ? id(row.form_lead) : null,
  };
}

function mapChange(row: Document, inWindow = true): ChangeEvidence {
  const entity = (row.entity ?? {}) as Document;
  const provenance = (row.provenance ?? {}) as Document;
  return {
    id: id(row._id),
    entity_model: text(entity.model),
    entity_id: id(entity.id),
    command_name: text(row.command_name),
    decision_id: provenance.decision_id ? id(provenance.decision_id) : null,
    applied_at: iso(row.applied_at),
    changed_paths: Array.isArray(row.changed_paths)
      ? row.changed_paths.filter((path): path is string => typeof path === "string")
      : [],
    in_window: inWindow,
  };
}

function mapBooking(row: Document, inWindow = true): BookingEvidence {
  return {
    id: id(row._id),
    activity_at: iso(row.timestamp ?? row.createdAt),
    normalized_job_no: optionalText(row.normalized_job_no),
    lead_id: row.lead_ref ? id(row.lead_ref) : null,
    booking_origin: text(row.booking_origin, "legacy_unknown"),
    in_window: inWindow,
  };
}

function mapCancellation(row: Document, inWindow = true): CancellationEvidence {
  return {
    id: id(row._id),
    booked_lead_id: id(row.booked_lead),
    activity_at: iso(row.createdAt ?? row.timestamp),
    in_window: inWindow,
  };
}

function mapCase(row: Document, kind: "booking" | "cancellation"): CaseEvidence {
  return {
    id: id(row._id),
    kind,
    normalized_job_no: optionalText(row.normalized_job_no),
    state: text(row.state),
    mode: kind === "cancellation" ? "release" : text(row.mode),
    opened_at: iso(row.opened_at),
    last_evidence_at: iso(row.last_evidence_at),
    resolved_at: row.resolved_at ? iso(row.resolved_at) : null,
    deterministic_booking_id: row.deterministic_booking_id ? id(row.deterministic_booking_id) : null,
    resolution_outcome: optionalText((row.resolution as Document | undefined)?.outcome),
  };
}

function mapSheetJob(row: Document, inWindow = true): SheetJobEvidence {
  return {
    id: id(row._id),
    entity_id: text(row.entity_id, ""),
    entity_model: text(row.entity_model),
    resource: text(row.resource),
    operation: text(row.operation),
    status: text(row.status),
    created_at: iso(row.createdAt),
    updated_at: iso(row.updatedAt ?? row.createdAt),
    in_window: inWindow,
  };
}

function mapRingCentralState(row: Document | null): RingCentralSyncStateEvidence | null {
  if (!row) return null;
  return {
    last_sync_from: row.lastSyncFrom ? iso(row.lastSyncFrom) : null,
    last_sync_to: row.lastSyncTo ? iso(row.lastSyncTo) : null,
    last_run_at: row.lastRunAt ? iso(row.lastRunAt) : null,
    last_run_status: optionalText(row.lastRunStatus),
    last_error: optionalText(row.lastError),
    last_processed_count: typeof row.lastProcessedCount === "number" ? row.lastProcessedCount : null,
    last_qualified_count: typeof row.lastQualifiedCount === "number" ? row.lastQualifiedCount : null,
    last_lead_action_count: typeof row.lastLeadActionCount === "number" ? row.lastLeadActionCount : null,
  };
}

async function timelinePages(
  db: Db,
  jobNos: string[],
  candidateLimit: number,
): Promise<JobTimelinePage[]> {
  const pages: Array<{ page: JobTimelinePage; score: number }> = [];
  for (const jobNo of jobNos.slice(0, candidateLimit)) {
    const rows = await loadJobNumberTimelineRows(db, jobNo);
    const result = assembleJobNumberTimeline({ rawJobNo: jobNo, rows });
    if (result.status === "ok") {
      pages.push({ page: result.page, score: scoreJobNumberTimeline(result.page) });
    }
  }
  const unique = new Map<string, { page: JobTimelinePage; score: number }>();
  for (const row of pages) {
    const fingerprint = row.page.events.map((event) => event.id).sort().join("|");
    const current = unique.get(fingerprint);
    if (!current || row.score > current.score) unique.set(fingerprint, row);
  }
  const ranked = [...unique.values()].sort((left, right) => right.score - left.score);
  const selected: typeof ranked = [];
  for (const shape of ["wordpress_born", "ringcentral_born", "granot_born", "other"] as const) {
    const row = ranked.find((candidate) => candidate.page.proof_shape === shape);
    if (row) selected.push(row);
  }
  const officialCancellation = ranked.find((candidate) => candidate.page.coverage.official_cancellation);
  if (officialCancellation && !selected.includes(officialCancellation)) {
    selected.push(officialCancellation);
  }
  for (const row of ranked) {
    if (selected.length >= 6) break;
    if (!selected.includes(row)) selected.push(row);
  }
  return selected.map((row) => row.page);
}

export async function loadLifecycleEvidence(input: {
  db: Db;
  database: string;
  window: WindowSpec;
  generatedAt: Date;
  collectionCountsBefore: Record<string, number>;
  timelineCandidateLimit: number;
}): Promise<Omit<LifecycleEvidence, "collection_counts_after">> {
  const { db, window } = input;
  const range = { $gte: window.from, $lt: window.to };
  const caseRange = {
    $or: [
      { opened_at: range },
      { last_evidence_at: range },
      { resolved_at: range },
    ],
  };
  const [
    activation,
    receiptRows,
    observationRows,
    formRows,
    callRows,
    messageRows,
    changeRows,
    bookingRows,
    cancellationRows,
    bookingCaseRows,
    releaseCaseRows,
    sheetActivityRows,
    ringCentralProcessedRows,
    ringCentralStateRow,
  ] = await Promise.all([
    db.collection("granot_lifecycle_activations").findOne({ key: "granot_lifecycle" }),
    db.collection("granot_webhook_receipts").find({ captured_at: range }).project({
      _id: 1, captured_at: 1, route_event_class: 1, "processing.state": 1,
    }).toArray(),
    db.collection("granot_observations").find({ captured_at: range }).project({
      _id: 1, receipt_id: 1, captured_at: 1, route_event_class: 1,
      "identity.normalized_job_no": 1, "priority.canonical": 1,
      "booking_action.normalized": 1, normalization_result: 1,
    }).toArray(),
    db.collection("form_leads").find({ timestamp: range }).project({
      _id: 1, timestamp: 1, createdAt: 1, ingestion_origin: 1,
      normalized_job_no: 1, domain_revision: 1,
    }).toArray(),
    db.collection("call_leads").find({ timestamp: range }).project({
      _id: 1, timestamp: 1, createdAt: 1, ingestion_origin: 1,
      normalized_job_no: 1, domain_revision: 1,
    }).toArray(),
    db.collection("lead_messages").find({ createdAt: range }).project({
      _id: 1, createdAt: 1, origin: 1, purpose: 1, status: 1,
      lead_ref: 1, form_lead: 1,
    }).toArray(),
    db.collection("entity_changes").find({ applied_at: range }).project({
      _id: 1, entity: 1, command_name: 1, "provenance.decision_id": 1,
      applied_at: 1, changed_paths: 1,
    }).toArray(),
    db.collection("booked_leads").find({ timestamp: range }).project({
      _id: 1, timestamp: 1, createdAt: 1, normalized_job_no: 1,
      lead_ref: 1, booking_origin: 1,
    }).toArray(),
    db.collection("cancelled_leads").find({ createdAt: range }).project({
      _id: 1, booked_lead: 1, createdAt: 1, timestamp: 1,
    }).toArray(),
    db.collection("granot_booking_reconciliation_cases").find(caseRange).project({
      _id: 1, normalized_job_no: 1, state: 1, mode: 1, opened_at: 1,
      last_evidence_at: 1, resolved_at: 1, deterministic_booking_id: 1,
    }).toArray(),
    db.collection("granot_release_reconciliation_cases").find(caseRange).project({
      _id: 1, normalized_job_no: 1, state: 1, opened_at: 1,
      last_evidence_at: 1, resolved_at: 1, deterministic_booking_id: 1,
    }).toArray(),
    db.collection("sheet_sync_jobs").find({ $or: [{ createdAt: range }, { updatedAt: range }] }).project({
      _id: 1, entity_id: 1, entity_model: 1, resource: 1, operation: 1,
      status: 1, createdAt: 1, updatedAt: 1,
    }).toArray(),
    db.collection("ringcentral_processed_calls").find({ firstProcessedAt: range }).project({
      status: 1, ingestionSource: 1, firstProcessedAt: 1, callLeadId: 1,
    }).toArray(),
    db.collection("ringcentral_call_log_sync_state").findOne({ key: "account" }, {
      projection: {
        lastSyncFrom: 1, lastSyncTo: 1, lastRunAt: 1, lastRunStatus: 1,
        lastError: 1, lastProcessedCount: 1, lastQualifiedCount: 1,
        lastLeadActionCount: 1,
      },
    }),
  ]);

  const ringCentralLeadIds = ringCentralProcessedRows
    .map((row) => optionalText(row.callLeadId))
    .filter((value): value is string => value != null && mongoose.Types.ObjectId.isValid(value));
  const ringCentralLeadRows = ringCentralLeadIds.length > 0
    ? await db.collection("call_leads").find({
      _id: { $in: ringCentralLeadIds.map((value) => new mongoose.Types.ObjectId(value)) },
    }).project({ _id: 1 }).toArray()
    : [];
  const existingRingCentralLeadIds = new Set(ringCentralLeadRows.map((row) => id(row._id)));
  const materializedStatuses = new Set([
    "lead_created", "lead_created_duplicate", "lead_adopted", "lead_adopted_duplicate",
  ]);
  const ringCentralProcessed: RingCentralProcessedEvidence[] = ringCentralProcessedRows.map((row) => {
    const leadId = optionalText(row.callLeadId);
    const expected = materializedStatuses.has(text(row.status));
    return {
      status: text(row.status),
      ingestion_source: text(row.ingestionSource),
      first_processed_at: iso(row.firstProcessedAt),
      call_lead_expected: expected,
      call_lead_exists: Boolean(leadId && existingRingCentralLeadIds.has(leadId)),
    };
  });

  const observations = observationRows.map(mapObservation);
  const observationIds = observationRows.map((row) => row._id);
  const decisionRows = observationIds.length > 0
    ? await db.collection("synchronization_decisions").find({ observation_id: { $in: observationIds } }).project({
      _id: 1, observation_id: 1, attempt: 1, decided_at: 1, execution_mode: 1,
      outcome: 1, reason_code: 1, effects: 1,
    }).toArray()
    : [];
  const decisions = decisionRows.map(mapDecision);
  const decisionLeadIds = [...new Set(decisions.flatMap((row) =>
    row.effects.map((effect) => effect.ref_id).filter((value): value is string => Boolean(value)),
  ))];
  const decisionIds = decisions.map((row) => row.id);
  const [causalChangeRows, causalSheetRows] = await Promise.all([
    decisionIds.length > 0
      ? db.collection("entity_changes").find({ "provenance.decision_id": { $in: decisionIds } }).project({
        _id: 1, entity: 1, command_name: 1, "provenance.decision_id": 1,
        applied_at: 1, changed_paths: 1,
      }).toArray()
      : [],
    decisionLeadIds.length > 0
      ? db.collection("sheet_sync_jobs").find({ entity_id: { $in: decisionLeadIds } }).project({
        _id: 1, entity_id: 1, entity_model: 1, resource: 1, operation: 1,
        status: 1, createdAt: 1, updatedAt: 1,
      }).toArray()
      : [],
  ]);

  const changesById = new Map<string, ChangeEvidence>();
  for (const row of changeRows) {
    const mapped = mapChange(row, true);
    changesById.set(mapped.id, mapped);
  }
  for (const row of causalChangeRows) {
    const mapped = mapChange(row, false);
    if (!changesById.has(mapped.id)) changesById.set(mapped.id, mapped);
  }
  const sheetById = new Map<string, SheetJobEvidence>();
  for (const row of sheetActivityRows) {
    const mapped = mapSheetJob(row, true);
    sheetById.set(mapped.id, mapped);
  }
  for (const row of causalSheetRows) {
    const mapped = mapSheetJob(row, false);
    if (!sheetById.has(mapped.id)) sheetById.set(mapped.id, mapped);
  }

  const bookings = bookingRows.map((row) => mapBooking(row));
  const cancellations = cancellationRows.map((row) => mapCancellation(row));
  const cancelledBookingIds = cancellations.map((row) => row.booked_lead_id).filter(Boolean);
  const cancelledBookingRows = cancelledBookingIds.length > 0
    ? await db.collection("booked_leads").find({ _id: { $in: cancellationRows.map((row) => row.booked_lead) } }).project({
      _id: 1, normalized_job_no: 1,
    }).toArray()
    : [];
  const allCancellationRefs = await db.collection("cancelled_leads")
    .find({})
    .project({ booked_lead: 1 })
    .toArray();
  const survivingCancellationBookingRows = allCancellationRefs.length > 0
    ? await db.collection("booked_leads").find({
      _id: { $in: allCancellationRefs.map((row) => row.booked_lead) },
    }).project({ normalized_job_no: 1 }).toArray()
    : [];
  const bookingCases = bookingCaseRows.map((row) => mapCase(row, "booking"));
  const cancellationCases = releaseCaseRows.map((row) => mapCase(row, "cancellation"));
  const caseBookingIds = [...new Set([
    ...bookingCases.map((row) => row.deterministic_booking_id),
    ...cancellationCases.map((row) => row.deterministic_booking_id),
  ].filter((value): value is string => Boolean(value)))];
  const supplementalBookingRows = caseBookingIds.length > 0
    ? await db.collection("booked_leads").find({ _id: { $in: caseBookingIds.map((value) => new mongoose.Types.ObjectId(value)) } }).project({
      _id: 1, timestamp: 1, createdAt: 1, normalized_job_no: 1,
      lead_ref: 1, booking_origin: 1,
    }).toArray()
    : [];
  const supplementalCancellationRows = caseBookingIds.length > 0
    ? await db.collection("cancelled_leads").find({ booked_lead: { $in: caseBookingIds.map((value) => new mongoose.Types.ObjectId(value)) } }).project({
      _id: 1, booked_lead: 1, createdAt: 1, timestamp: 1,
    }).toArray()
    : [];
  const bookingById = new Map(bookings.map((row) => [row.id, row]));
  for (const row of supplementalBookingRows) {
    const mapped = mapBooking(row, false);
    if (!bookingById.has(mapped.id)) bookingById.set(mapped.id, mapped);
  }
  const cancellationById = new Map(cancellations.map((row) => [row.id, row]));
  for (const row of supplementalCancellationRows) {
    const mapped = mapCancellation(row, false);
    if (!cancellationById.has(mapped.id)) cancellationById.set(mapped.id, mapped);
  }

  const jobNos = [...new Set([
    ...survivingCancellationBookingRows.map((row) => optionalText(row.normalized_job_no)),
    ...releaseCaseRows.map((row) => optionalText(row.normalized_job_no)),
    ...bookingCaseRows.map((row) => optionalText(row.normalized_job_no)),
    ...cancelledBookingRows.map((row) => optionalText(row.normalized_job_no)),
    ...bookings.map((row) => row.normalized_job_no),
    ...observations.map((row) => row.normalized_job_no),
    ...formRows.map((row) => optionalText(row.normalized_job_no)),
    ...callRows.map((row) => optionalText(row.normalized_job_no)),
  ].filter((value): value is string => Boolean(value)))];

  return {
    database: input.database,
    generated_at: input.generatedAt.toISOString(),
    window: { from: window.from.toISOString(), to: window.to.toISOString() },
    activated_at: activation?.activated_at ? iso(activation.activated_at) : null,
    receipts: receiptRows.map(mapReceipt),
    observations,
    decisions,
    leads: [
      ...formRows.map((row) => mapLead(row, "FormLead")),
      ...callRows.map((row) => mapLead(row, "CallLead")),
    ],
    messages: messageRows.map(mapMessage),
    changes: [...changesById.values()],
    bookings: [...bookingById.values()],
    cancellations: [...cancellationById.values()],
    booking_cases: bookingCases,
    cancellation_cases: cancellationCases,
    sheet_jobs: [...sheetById.values()],
    ringcentral_processed: ringCentralProcessed,
    ringcentral_sync_state: mapRingCentralState(ringCentralStateRow),
    cancellation_traceability: {
      total: allCancellationRefs.length,
      with_surviving_booking: survivingCancellationBookingRows.length,
      with_resolvable_job: survivingCancellationBookingRows.filter((row) => optionalText(row.normalized_job_no)).length,
    },
    timeline_pages: await timelinePages(db, jobNos, input.timelineCandidateLimit),
    collection_counts_before: input.collectionCountsBefore,
  };
}
