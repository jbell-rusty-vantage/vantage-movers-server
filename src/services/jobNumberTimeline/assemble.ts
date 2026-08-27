import { jobsEquivalent, normalizeTypedJobNo } from "./normalize.js";
import { projectEnhancedPage } from "./projector.js";
import type { JobTimelineAssembleInput } from "./rows.js";
import type {
  BookingRow,
  CancellationRow,
  CaseRow,
  DecisionRow,
  EntityChangeRow,
  LeadMessageRow,
  LeadRow,
  ObservationReceiptRow,
  ObservationRow,
  ProcessedCallRow,
  RecordLinkRow,
  SheetSyncJobRow,
} from "./rows.js";
import {
  JOB_TIMELINE_TYPE_PRIORITY,
  SUCCESSFUL_LEAD_MESSAGE_STATUSES,
  type JobTimelineAssembleResult,
  type JobTimelineEvent,
  type JobTimelineEventKind,
  type JobTimelineLeadModel,
  type JobTimelinePage,
  type JobTimelineProofShape,
  type JobTimelineResolvedScope,
} from "./types.js";

const CREATE_COMMANDS = new Set([
  "createFormLead",
  "createCallLead",
  "createLeadFromGranot",
]);
const UPDATE_COMMANDS = new Set([
  "synchronizeLeadFromGranot",
  "updateSourceOwnedLead",
]);
const JOB_NUMBER_PATHS = new Set(["job_no", "normalized_job_no"]);
const APPLIED_OUTCOMES = new Set(["applied", "created"]);
const QUALIFIED_PROCESSED_CALL_STATUSES = new Set([
  "lead_created",
  "lead_created_duplicate",
  "lead_adopted",
  "lead_adopted_duplicate",
]);

function asList<T>(value: T[] | undefined): T[] {
  return value ?? [];
}

function observationJobNo(row: ObservationRow): string | undefined {
  return row.normalized_job_no || row.identity?.normalized_job_no;
}

function observationSnapshot(row: ObservationRow): string | undefined {
  return row.job_no_snapshot || row.identity?.job_no_raw;
}

function changeModel(row: EntityChangeRow): string {
  return row.entity_model || row.entity?.model || "";
}

function changeId(row: EntityChangeRow): string {
  return row.entity_id || row.entity?.id || "";
}

function messageLeadId(row: LeadMessageRow): string | undefined {
  return row.lead_id || row.lead_ref?.id;
}

function flattenRows(input: JobTimelineAssembleInput): JobTimelineAssembleInput {
  const rows = input.rows;
  const cases = asList(rows.cases);
  return {
    ...input,
    rows: {
      ...rows,
      observations: asList(rows.observations).map((row) => ({
        ...row,
        normalized_job_no: observationJobNo(row),
        job_no_snapshot: observationSnapshot(row),
        priority_canonical: row.priority_canonical ?? row.priority?.canonical,
        priority_valid: row.priority_valid ?? row.priority?.valid,
        booking_action_normalized: row.booking_action_normalized ?? row.booking_action?.normalized,
      })),
      decisions: asList(rows.decisions).map((row) => ({
        ...row,
        source_granularity_id: row.source_granularity_id ?? row.source_scope?.source_granularity_id,
        source_company_id: row.source_company_id ?? row.source_scope?.lead_source_company,
        effect_kinds: row.effect_kinds ?? row.effects?.map((effect) => effect.kind).filter((kind): kind is string => Boolean(kind)),
      })),
      booking_cases: [
        ...asList(rows.booking_cases),
        ...cases.filter((row) => row.kind === "booking"),
      ],
      release_cases: [
        ...asList(rows.release_cases),
        ...cases.filter((row) => row.kind === "release"),
      ],
      entity_changes: asList(rows.entity_changes).map((row) => ({
        ...row,
        entity_model: changeModel(row),
        entity_id: changeId(row),
      })),
      lead_messages: asList(rows.lead_messages).map((row) => ({
        ...row,
        lead_id: messageLeadId(row),
      })),
      granot_crm_sources: asList(rows.granot_crm_sources).map((row) => ({
        ...row,
        source_granularity_id: row.source_granularity_id ?? row.lifecycle_routes?.[0]?.source_granularity_id,
      })),
      source_granularities: [
        ...asList(rows.source_granularities),
        ...asList(rows.granularities),
      ],
    },
  };
}

function matchesJob(stored: string | undefined, query: string): boolean {
  return Boolean(stored && jobsEquivalent(stored, query));
}

function sortEvents(events: JobTimelineEvent[]): JobTimelineEvent[] {
  return [...events].sort((left, right) => {
    if (left.event_at !== right.event_at) {
      return left.event_at.localeCompare(right.event_at);
    }
    if (left.type_priority !== right.type_priority) {
      return left.type_priority - right.type_priority;
    }
    return left.id.localeCompare(right.id);
  });
}

function event(
  kind: JobTimelineEventKind,
  input: Omit<JobTimelineEvent, "kind" | "type_priority">,
): JobTimelineEvent {
  return {
    ...input,
    kind,
    type_priority: JOB_TIMELINE_TYPE_PRIORITY[kind],
  };
}

function latestDecisions(rows: DecisionRow[]): DecisionRow[] {
  const byObservation = new Map<string, DecisionRow>();
  for (const row of rows) {
    const current = byObservation.get(row.observation_id);
    if (!current || row.attempt > current.attempt) {
      byObservation.set(row.observation_id, row);
    }
  }
  return [...byObservation.values()];
}

function firstHop(input: JobTimelineAssembleInput, normalized: string) {
  const observations = asList(input.rows.observations).filter((row) =>
    matchesJob(row.normalized_job_no, normalized),
  );
  const record_links = asList(input.rows.record_links).filter((row) =>
    matchesJob(row.normalized_job_no, normalized),
  );
  const bookings = asList(input.rows.bookings).filter((row) =>
    matchesJob(row.normalized_job_no, normalized),
  );
  const booking_cases = asList(input.rows.booking_cases).filter((row) =>
    matchesJob(row.normalized_job_no, normalized),
  );
  const release_cases = asList(input.rows.release_cases).filter((row) =>
    matchesJob(row.normalized_job_no, normalized),
  );
  const booking_discrepancies = asList(input.rows.booking_discrepancies).filter((row) =>
    matchesJob(row.normalized_job_no, normalized),
  );
  const release_discrepancies = asList(input.rows.release_discrepancies).filter((row) =>
    matchesJob(row.normalized_job_no, normalized),
  );
  return {
    observations,
    record_links,
    bookings,
    booking_cases,
    release_cases,
    booking_discrepancies,
    release_discrepancies,
  };
}

function resolveLead(input: {
  links: RecordLinkRow[];
  bookings: BookingRow[];
  decisions: DecisionRow[];
  leads: LeadRow[];
}): LeadRow | undefined {
  const activeLink = input.links.find((link) => link.state === "active" && link.lead_ref);
  if (activeLink?.lead_ref) {
    return input.leads.find(
      (lead) => lead.id === activeLink.lead_ref?.id && lead.model === activeLink.lead_ref.model,
    ) ?? {
      id: activeLink.lead_ref.id,
      model: activeLink.lead_ref.model,
    };
  }

  const booking = input.bookings.find((row) => row.lead_ref && row.lead_model);
  if (booking?.lead_ref && booking.lead_model) {
    return input.leads.find(
      (lead) => lead.id === booking.lead_ref && lead.model === booking.lead_model,
    ) ?? {
      id: booking.lead_ref,
      model: booking.lead_model,
    };
  }

  const applied = [...input.decisions]
    .filter((row) => APPLIED_OUTCOMES.has(row.outcome ?? "") && (
      row.target?.model === "FormLead" || row.target?.model === "CallLead"
    ))
    .sort((left, right) => right.decided_at.localeCompare(left.decided_at) || right.attempt - left.attempt)[0];
  if (applied?.target && (applied.target.model === "FormLead" || applied.target.model === "CallLead")) {
    const model = applied.target.model;
    return input.leads.find((lead) => lead.id === applied.target?.id && lead.model === model) ?? {
      id: applied.target.id,
      model,
    };
  }

  return undefined;
}

function leadChanges(changes: EntityChangeRow[], lead: LeadRow): EntityChangeRow[] {
  return changes.filter((row) => row.entity_id === lead.id && row.entity_model === lead.model);
}

function createChange(changes: EntityChangeRow[]): EntityChangeRow | undefined {
  return changes
    .filter((row) => CREATE_COMMANDS.has(row.command_name))
    .sort((left, right) => left.applied_at.localeCompare(right.applied_at))[0];
}

function jobNumberChange(changes: EntityChangeRow[]): EntityChangeRow | undefined {
  return changes
    .filter((row) =>
      row.changed_paths.some((path) => JOB_NUMBER_PATHS.has(path))
      && (row.command_name === "synchronizeLeadFromGranot" || row.command_name === "createLeadFromGranot"),
    )
    .sort((left, right) => left.applied_at.localeCompare(right.applied_at))[0];
}

function onlyJobNumberPaths(paths: string[]): boolean {
  return paths.length > 0 && paths.every((path) => JOB_NUMBER_PATHS.has(path));
}

function emitSourceReceived(input: {
  observations: ObservationRow[];
  receipts: ObservationReceiptRow[];
  processedCalls: ProcessedCallRow[];
  lead?: LeadRow;
}): JobTimelineEvent[] {
  const events: JobTimelineEvent[] = [];
  const receiptsById = new Map(input.receipts.map((row) => [row.id, row]));

  for (const observation of input.observations) {
    if (!observation.receipt_id) continue;
    const receipt = receiptsById.get(observation.receipt_id);
    if (!receipt) continue;
    events.push(event("source_received", {
      id: `source_received:granot:${receipt.id}`,
      event_at: receipt.captured_at,
      clock_field: "receipt.captured_at",
      coverage: "evidence_only",
      headline: "Source received (granot)",
      data: {
        ingress: "granot",
        receipt_id: receipt.id,
        observation_id: observation.id,
        route_event_class: receipt.route_event_class ?? observation.route_event_class ?? null,
        processing_state: receipt.processing_state ?? null,
        observation_channel: receipt.observation_channel ?? null,
        channel_operation_kind: receipt.channel_operation_kind ?? null,
      },
    }));
  }

  if (input.lead?.model === "CallLead") {
    for (const row of input.processedCalls.filter((call) =>
      call.callLeadId === input.lead?.id
      && QUALIFIED_PROCESSED_CALL_STATUSES.has(call.status),
    )) {
      events.push(event("source_received", {
        id: `source_received:ringcentral:${row.id}`,
        event_at: row.firstProcessedAt,
        clock_field: "processed_call.firstProcessedAt",
        coverage: "evidence_only",
        headline: "Source received (ringcentral)",
        data: {
          ingress: "ringcentral",
          status: row.status,
          qualification_outcome: row.qualificationReason ?? null,
          processed_at: row.firstProcessedAt,
          ingestion_source: row.ingestionSource ?? null,
          duplicate: row.duplicate ?? false,
        },
      }));
    }
  }

  return events;
}

function cancellationAttachedBySnapshot(
  row: CancellationRow,
  normalized: string,
): boolean {
  const snapshot = row.normalized_job_no_snapshot
    || (row.job_no_snapshot ? normalizeTypedJobNo(row.job_no_snapshot) : null);
  return Boolean(snapshot && matchesJob(snapshot, normalized));
}

function selectCancellations(input: {
  rows: CancellationRow[];
  bookingIds: Set<string>;
  normalized: string;
}): { cancellations: CancellationRow[]; viaSnapshot: boolean } {
  const linked = input.rows.filter((row) => row.booked_lead && input.bookingIds.has(row.booked_lead));
  if (linked.length > 0) {
    return { cancellations: linked, viaSnapshot: false };
  }
  const snapped = input.rows.filter((row) => cancellationAttachedBySnapshot(row, input.normalized));
  return { cancellations: snapped, viaSnapshot: snapped.length > 0 };
}

function emitLeadCreated(lead: LeadRow, changes: EntityChangeRow[]): JobTimelineEvent {
  const created = createChange(changes);
  if (created) {
    return event("lead_created", {
      id: `lead_created:${created.id}`,
      event_at: created.applied_at,
      clock_field: "entity_change.applied_at",
      coverage: "command_backed",
      headline: `Lead created (${lead.ingestion_origin ?? "unknown"})`,
      data: {
        ingestion_origin: lead.ingestion_origin ?? null,
        command_name: created.command_name,
        lead_model: lead.model,
      },
    });
  }
  const clock = lead.timestamp || lead.createdAt || lead.change_history_started_at || "";
  return event("lead_created", {
    id: `lead_created:${lead.id}`,
    event_at: clock,
    clock_field: lead.timestamp
      ? "lead.timestamp"
      : lead.createdAt
        ? "lead.createdAt"
        : "lead.change_history_started_at",
    coverage: "official_fact_only",
    headline: `Lead created (${lead.ingestion_origin ?? "legacy_unknown"})`,
    data: {
      ingestion_origin: lead.ingestion_origin ?? "legacy_unknown",
      command_name: null,
      lead_model: lead.model,
    },
  });
}

function emitMessages(lead: LeadRow, messages: LeadMessageRow[]): JobTimelineEvent[] {
  return messages
    .filter((row) => row.lead_id === lead.id || (lead.model === "FormLead" && row.form_lead === lead.id))
    .map((row) => {
      const clock = row.delivered_at || row.sent_at || row.accepted_at || row.createdAt || "";
      const clock_field = row.delivered_at
        ? "lead_message.delivered_at"
        : row.sent_at
          ? "lead_message.sent_at"
          : row.accepted_at
            ? "lead_message.accepted_at"
            : "lead_message.createdAt";
      return event("lead_message", {
        id: `lead_message:${row.id}`,
        event_at: clock,
        clock_field,
        coverage: "command_backed",
        headline: `Text ${row.status ?? "unknown"} (${row.purpose ?? "unknown"})`,
        data: {
          origin: row.origin ?? null,
          purpose: row.purpose ?? null,
          status: row.status ?? null,
          skip_reason: row.skip_reason ?? null,
          observation_id: row.observation_id ?? null,
          consent_basis: row.consent_basis ?? null,
        },
      });
    });
}

function emitJobNumberAcquired(input: {
  lead?: LeadRow;
  changes: EntityChangeRow[];
  links: RecordLinkRow[];
  observations: ObservationRow[];
}): JobTimelineEvent | undefined {
  const jobChange = input.lead ? jobNumberChange(input.changes) : undefined;
  if (jobChange) {
    const acquiredAtCreate = jobChange.command_name === "createLeadFromGranot";
    return event("job_number_acquired", {
      id: `job_number_acquired:${jobChange.id}`,
      event_at: jobChange.applied_at,
      clock_field: "entity_change.applied_at",
      coverage: "command_backed",
      headline: acquiredAtCreate ? "Job Number present at create" : "Job Number acquired",
      data: { acquired_at_create: acquiredAtCreate, command_name: jobChange.command_name },
    });
  }

  const createFromGranot = input.changes.find((row) => row.command_name === "createLeadFromGranot");
  if (createFromGranot) {
    return event("job_number_acquired", {
      id: `job_number_acquired:${createFromGranot.id}`,
      event_at: createFromGranot.applied_at,
      clock_field: "entity_change.applied_at",
      coverage: "command_backed",
      headline: "Job Number present at create",
      data: { acquired_at_create: true, command_name: createFromGranot.command_name },
    });
  }

  const linked = input.links
    .filter((row) => row.lead_ref && row.established_at)
    .sort((left, right) => (left.established_at ?? "").localeCompare(right.established_at ?? ""))[0];
  if (linked?.established_at) {
    return event("job_number_acquired", {
      id: `job_number_acquired:${linked.id}`,
      event_at: linked.established_at,
      clock_field: "record_link.established_at",
      coverage: "evidence_only",
      headline: "Job Number acquired",
      data: { acquired_at_create: false },
    });
  }

  const firstObservation = [...input.observations].sort((left, right) =>
    left.captured_at.localeCompare(right.captured_at),
  )[0];
  if (firstObservation) {
    return event("job_number_acquired", {
      id: `job_number_acquired:${firstObservation.id}`,
      event_at: firstObservation.captured_at,
      clock_field: "observation.captured_at",
      coverage: "evidence_only",
      headline: "Job Number acquired",
      data: { acquired_at_create: false },
    });
  }

  return undefined;
}

function emitLeadUpdates(
  changes: EntityChangeRow[],
  create: EntityChangeRow | undefined,
  jobAcquired: EntityChangeRow | undefined,
): JobTimelineEvent[] {
  return changes
    .filter((row) => UPDATE_COMMANDS.has(row.command_name))
    .filter((row) => row.id !== create?.id)
    .filter((row) => {
      if (row.id !== jobAcquired?.id) return true;
      return !onlyJobNumberPaths(row.changed_paths);
    })
    .map((row) =>
      event("lead_updated", {
        id: `lead_updated:${row.id}`,
        event_at: row.applied_at,
        clock_field: "entity_change.applied_at",
        coverage: "command_backed",
        headline: `Lead updated (${row.command_name}: ${row.changed_paths.join(", ")})`,
        data: { command_name: row.command_name, changed_paths: row.changed_paths },
      }),
    );
}

function emitObservations(rows: ObservationRow[]): JobTimelineEvent[] {
  return rows.map((row) => {
    const extras: string[] = [];
    if (row.priority_valid && row.priority_canonical) {
      extras.push(` priority ${row.priority_canonical}`);
    }
    if (row.booking_action_normalized) {
      extras.push(` ${row.booking_action_normalized}`);
    }
    return event("granot_observation", {
      id: `granot_observation:${row.id}`,
      event_at: row.captured_at,
      clock_field: "observation.captured_at",
      coverage: "evidence_only",
      headline: `Granot ${row.route_event_class ?? "observation"}${extras.join("")}`,
      data: {
        observation_id: row.id,
        receipt_id: row.receipt_id ?? null,
        route_event_class: row.route_event_class ?? null,
        normalization_result: row.normalization_result ?? null,
        priority: row.priority_valid && row.priority_canonical
          ? { canonical: row.priority_canonical }
          : undefined,
        booking_action: row.booking_action_normalized
          ? { normalized: row.booking_action_normalized }
          : undefined,
        issue_codes: row.issue_codes ?? [],
      },
    });
  });
}

function emitDecisions(rows: DecisionRow[]): JobTimelineEvent[] {
  return rows.map((row) =>
    event("synchronization_decision", {
      id: `synchronization_decision:${row.id}`,
      event_at: row.decided_at,
      clock_field: "decision.decided_at",
      coverage: "evidence_only",
      headline: `Decision ${row.outcome ?? "unknown"} / ${row.reason_code ?? "unknown"}`,
      data: {
        decision_id: row.id,
        observation_id: row.observation_id,
        attempt: row.attempt,
        execution_mode: row.execution_mode ?? null,
        outcome: row.outcome ?? null,
        reason_code: row.reason_code ?? null,
        match_method: row.match_method ?? null,
        effect_kinds: row.effect_kinds ?? [],
        evaluated_gates: (row.evaluated_gates ?? []).map((gate) => ({
          gate: gate.gate,
          allowed: gate.allowed,
        })),
      },
    }),
  );
}

function emitIntakes(kind: "booking_intake" | "cancellation_intake", cases: CaseRow[]): JobTimelineEvent[] {
  const events: JobTimelineEvent[] = [];
  for (const row of cases) {
    const evidence = [...asList(row.evidence)].sort((left, right) =>
      left.captured_at.localeCompare(right.captured_at),
    );
    const openedAt = evidence[0]?.captured_at || row.opened_at || "";
    const openedObservation = evidence[0]?.observation_id;
    const verbOpen = "opened";
    const mode = kind === "booking_intake" ? (row.mode ?? "unknown") : "release";
    events.push(event(kind, {
      id: `${kind}:${row.id}:opened`,
      event_at: openedAt,
      clock_field: evidence[0] ? "observation.captured_at" : "case.opened_at",
      coverage: "evidence_only",
      headline: kind === "booking_intake"
        ? `Booking intake ${verbOpen} (${mode})`
        : `Cancellation intake ${verbOpen}`,
      data: {
        case_id: row.id,
        kind: row.kind,
        event: "opened",
        state: row.state,
        mode,
        sequence_number: row.sequence_number ?? null,
        case_revision: row.case_revision ?? null,
        evidence_revision: row.evidence_revision ?? null,
        observation_id: openedObservation ?? null,
      },
    }));
    for (const item of evidence.slice(1)) {
      events.push(event(kind, {
        id: `${kind}:${row.id}:refreshed:${item.observation_id}`,
        event_at: item.captured_at,
        clock_field: "observation.captured_at",
        coverage: "evidence_only",
        headline: kind === "booking_intake"
          ? `Booking intake refreshed (${mode})`
          : "Cancellation intake refreshed",
        data: {
          case_id: row.id,
          kind: row.kind,
          event: "refreshed",
          state: row.state,
          mode,
          sequence_number: row.sequence_number ?? null,
          case_revision: row.case_revision ?? null,
          evidence_revision: row.evidence_revision ?? null,
          observation_id: item.observation_id,
        },
      }));
    }
    if (row.resolved_at) {
      events.push(event(kind, {
        id: `${kind}:${row.id}:resolved`,
        event_at: row.resolved_at,
        clock_field: "case.resolved_at",
        coverage: "evidence_only",
        headline: kind === "booking_intake"
          ? `Booking intake resolved (${mode})`
          : "Cancellation intake resolved",
        data: {
          case_id: row.id,
          kind: row.kind,
          event: "resolved",
          state: "resolved",
          mode,
          sequence_number: row.sequence_number ?? null,
          case_revision: row.case_revision ?? null,
          evidence_revision: row.evidence_revision ?? null,
        },
      }));
    }
  }
  return events;
}

function emitOfficialBooking(
  booking: BookingRow | undefined,
  changes: EntityChangeRow[],
): JobTimelineEvent | undefined {
  if (!booking) return undefined;
  const change = changes.find((row) => row.entity_id === booking.id && row.entity_model === "BookedLead");
  const clock = booking.last_changed_at || booking.timestamp || booking.createdAt || "";
  const clock_field = booking.last_changed_at
    ? "booking.last_changed_at"
    : booking.timestamp
      ? "booking.timestamp"
      : "booking.createdAt";
  return event("official_booking", {
    id: `official_booking:${booking.id}`,
    event_at: clock,
    clock_field,
    coverage: change ? "command_backed" : "official_fact_only",
    headline: "Official Booking recorded",
    data: { booking_id: booking.id },
  });
}

function emitOfficialCancellation(
  cancellation: { id: string; last_changed_at?: string; createdAt?: string } | undefined,
  changes: EntityChangeRow[],
): JobTimelineEvent | undefined {
  if (!cancellation) return undefined;
  const change = changes.find((row) => row.entity_id === cancellation.id && row.entity_model === "CancelledLead");
  const clock = cancellation.last_changed_at || cancellation.createdAt || "";
  return event("official_cancellation", {
    id: `official_cancellation:${cancellation.id}`,
    event_at: clock,
    clock_field: cancellation.last_changed_at
      ? "cancellation.last_changed_at"
      : "cancellation.createdAt",
    coverage: change ? "command_backed" : "official_fact_only",
    headline: "Official Cancellation recorded",
    data: { cancellation_id: cancellation.id },
  });
}

function emitSheetSync(jobs: SheetSyncJobRow[]): JobTimelineEvent[] {
  return jobs.map((row) => {
    const terminal = row.status === "synced" || row.status === "failed" || row.status === "cancelled";
    const clock = terminal ? (row.updatedAt || row.createdAt) : row.createdAt;
    return event("sheet_sync", {
      id: `sheet_sync:${row.id}`,
      event_at: clock,
      clock_field: terminal ? "sheet_sync_job.updatedAt" : "sheet_sync_job.createdAt",
      coverage: "command_backed",
      headline: `Sheet Sync ${row.status} (${row.resource} / ${row.operation})`,
      data: {
        job_id: row.id,
        resource: row.resource,
        operation: row.operation,
        entity_model: row.entity_model ?? null,
        entity_id: row.entity_id,
        status: row.status,
        attempts: row.attempts ?? 0,
        created_by: row.created_by ?? null,
        requested_at: row.createdAt,
        target_hints: row.target_hints ?? [],
      },
    });
  });
}

function sheetCoverage(jobs: SheetSyncJobRow[]): JobTimelinePage["coverage"]["sheet_sync"] {
  if (jobs.length === 0) return "absent";
  const live = new Set(["pending", "retrying", "processing"]);
  if (jobs.every((job) => live.has(job.status))) return "pending";
  if (jobs.every((job) => job.status === "synced")) return "synced";
  if (jobs.some((job) => job.status === "failed") && jobs.every((job) => !live.has(job.status))) {
    return "failed";
  }
  return "mixed";
}

function intakeCoverage(cases: CaseRow[]): "absent" | "open" | "resolved" {
  if (cases.length === 0) return "absent";
  if (cases.some((row) => row.state === "open")) return "open";
  return "resolved";
}

function proofShape(lead: LeadRow | undefined, created: JobTimelineEvent | undefined, acquired: JobTimelineEvent | undefined): JobTimelineProofShape {
  const origin = lead?.ingestion_origin;
  if (origin === "granot_lead_created" || created?.data.command_name === "createLeadFromGranot") {
    return "granot_born";
  }
  if (origin === "wordpress_form" || created?.data.command_name === "createFormLead") {
    return "wordpress_born";
  }
  if (origin === "ringcentral" || created?.data.command_name === "createCallLead") {
    return "ringcentral_born";
  }
  if (origin === "legacy_unknown") {
    return "other";
  }
  if (created && acquired && created.event_at < acquired.event_at) {
    return "wordpress_born";
  }
  return "other";
}

function requestedGranularities(input: JobTimelineAssembleInput): string[] {
  const requested = new Set<string>();
  if (input.filters?.source_granularity_id) {
    requested.add(input.filters.source_granularity_id);
  }
  for (const id of input.filters?.company_granularity_ids ?? []) {
    requested.add(id);
  }
  return [...requested];
}

function resolvedScopes(input: {
  lead?: LeadRow;
  links: RecordLinkRow[];
  decisions: DecisionRow[];
  observations: ObservationRow[];
  crmSources: Array<{ id: string; source_granularity_id?: string; review_state?: string }>;
  granularities: Array<{ id: string; owner_label?: string; label?: string; source_company_id?: string }>;
}): JobTimelineResolvedScope[] {
  const scopes: JobTimelineResolvedScope[] = [];
  const labelFor = (id: string | undefined) =>
    input.granularities.find((row) => row.id === id);

  if (input.lead?.source_granularity_id) {
    const meta = labelFor(input.lead.source_granularity_id);
    scopes.push({
      kind: "lead",
      source_granularity_id: input.lead.source_granularity_id,
      source_granularity_label: meta?.owner_label ?? meta?.label ?? null,
      source_company_id: input.lead.source_company_id ?? meta?.source_company_id ?? null,
      owner_label: meta?.owner_label ?? null,
    });
  }

  const active = input.links.find((row) => row.state === "active" && row.source_granularity_id);
  if (active?.source_granularity_id) {
    const meta = labelFor(active.source_granularity_id);
    scopes.push({
      kind: "record_link",
      source_granularity_id: active.source_granularity_id,
      source_granularity_label: meta?.owner_label ?? meta?.label ?? null,
      source_company_id: active.source_company_id ?? meta?.source_company_id ?? null,
      owner_label: meta?.owner_label ?? null,
    });
  }

  const latest = [...input.decisions].sort((left, right) =>
    right.decided_at.localeCompare(left.decided_at),
  )[0];
  if (latest?.source_granularity_id) {
    const meta = labelFor(latest.source_granularity_id);
    scopes.push({
      kind: "decision",
      source_granularity_id: latest.source_granularity_id,
      source_granularity_label: meta?.owner_label ?? meta?.label ?? null,
      source_company_id: latest.source_company_id ?? meta?.source_company_id ?? null,
      owner_label: meta?.owner_label ?? null,
    });
  }

  for (const observation of input.observations) {
    if (!observation.granot_crm_source_id) continue;
    const source = input.crmSources.find((row) => row.id === observation.granot_crm_source_id);
    if (!source?.source_granularity_id) continue;
    const meta = labelFor(source.source_granularity_id);
    scopes.push({
      kind: "observation_route",
      source_granularity_id: source.source_granularity_id,
      source_granularity_label: meta?.owner_label ?? meta?.label ?? null,
      source_company_id: meta?.source_company_id ?? null,
      owner_label: meta?.owner_label ?? null,
    });
  }

  return scopes;
}

export function assembleJobNumberTimeline(
  rawInput: JobTimelineAssembleInput,
): JobTimelineAssembleResult {
  const input = flattenRows(rawInput);
  const normalized = normalizeTypedJobNo(input.rawJobNo);
  if (!normalized) {
    return { status: "invalid_job_number", normalized_job_no: null };
  }

  const hop = firstHop(input, normalized);
  const firstHopEmpty =
    hop.observations.length === 0
    && hop.record_links.length === 0
    && hop.bookings.length === 0
    && hop.booking_cases.length === 0
    && hop.release_cases.length === 0
    && hop.booking_discrepancies.length === 0
    && hop.release_discrepancies.length === 0;
  if (firstHopEmpty) {
    return { status: "not_found", normalized_job_no: normalized };
  }

  const observationIds = new Set(hop.observations.map((row) => row.id));
  const decisions = latestDecisions(
    asList(input.rows.decisions).filter((row) => observationIds.has(row.observation_id)),
  );
  const lead = resolveLead({
    links: hop.record_links,
    bookings: hop.bookings,
    decisions,
    leads: asList(input.rows.leads),
  });
  const changes = lead ? leadChanges(asList(input.rows.entity_changes), lead) : [];
  const booking = hop.bookings[0];
  const bookingIds = new Set(hop.bookings.map((row) => row.id));
  const selectedCancellations = selectCancellations({
    rows: asList(input.rows.cancellations),
    bookingIds,
    normalized,
  });
  const cancellations = selectedCancellations.cancellations;
  const cancellation = cancellations[0];
  const allowedEntityIds = new Set<string>([
    ...(lead ? [lead.id] : []),
    ...hop.bookings.map((row) => row.id),
    ...cancellations.map((row) => row.id),
  ]);
  const sheetJobs = lead || booking || cancellation
    ? asList(input.rows.sheet_sync_jobs).filter((row) => allowedEntityIds.has(row.entity_id))
    : [];

  const scopes = resolvedScopes({
    lead,
    links: hop.record_links,
    decisions,
    observations: hop.observations,
    crmSources: asList(input.rows.granot_crm_sources),
    granularities: asList(input.rows.source_granularities),
  });
  const requested = requestedGranularities(input);
  if (requested.length > 0) {
    const matched = scopes.some((scope) =>
      scope.source_granularity_id != null && requested.includes(scope.source_granularity_id),
    );
    if (!matched) {
      return { status: "filtered_out", normalized_job_no: normalized, scopes };
    }
  }

  const events: JobTimelineEvent[] = [];
  events.push(...emitSourceReceived({
    observations: hop.observations,
    receipts: asList(input.rows.observation_receipts),
    processedCalls: asList(input.rows.processed_calls),
    lead,
  }));
  let created: JobTimelineEvent | undefined;
  if (lead) {
    created = emitLeadCreated(lead, changes);
    events.push(created);
    events.push(...emitMessages(lead, asList(input.rows.lead_messages)));
  }

  const acquired = emitJobNumberAcquired({
    lead,
    changes,
    links: hop.record_links,
    observations: hop.observations,
  });
  if (acquired) events.push(acquired);

  if (lead) {
    events.push(...emitLeadUpdates(changes, createChange(changes), jobNumberChange(changes)));
  }

  events.push(...emitObservations(hop.observations));
  events.push(...emitDecisions(decisions));
  events.push(...emitIntakes("booking_intake", hop.booking_cases));
  events.push(...emitIntakes("cancellation_intake", hop.release_cases));
  const officialBooking = emitOfficialBooking(booking, asList(input.rows.entity_changes));
  if (officialBooking) events.push(officialBooking);
  const officialCancellation = emitOfficialCancellation(cancellation, asList(input.rows.entity_changes));
  if (officialCancellation) events.push(officialCancellation);
  events.push(...emitSheetSync(sheetJobs));

  const sorted = sortEvents(events);
  const jobSnapshot =
    hop.record_links[0]?.job_no_snapshot
    || hop.bookings[0]?.job_no_snapshot
    || hop.observations[0]?.job_no_snapshot
    || hop.booking_cases[0]?.job_no_snapshot
    || hop.release_cases[0]?.job_no_snapshot
    || null;

  const primaryScope = scopes[0];
  const page: JobTimelinePage = {
    normalized_job_no: normalized,
    job_no_snapshot: jobSnapshot,
    proof_shape: proofShape(lead, created, acquired),
    source: {
      source_company_id: lead?.source_company_id ?? primaryScope?.source_company_id ?? null,
      source_company_label: lead?.source_company_label ?? null,
      source_granularity_id: lead?.source_granularity_id ?? primaryScope?.source_granularity_id ?? null,
      source_granularity_label:
        lead?.source_granularity_label ?? primaryScope?.source_granularity_label ?? null,
    },
    coverage: {
      lead: lead ? "resolved" : "unresolved",
      lead_message: sorted.some((row) => row.kind === "lead_message") ? "present" : "absent",
      job_number_at_create: Boolean(acquired?.data.acquired_at_create),
      booking_intake: intakeCoverage(hop.booking_cases),
      cancellation_intake: intakeCoverage(hop.release_cases),
      official_booking: Boolean(officialBooking),
      official_cancellation: Boolean(officialCancellation),
      sheet_sync: sheetCoverage(sheetJobs),
    },
    current: {
      ...(lead ? { lead_ref: { model: lead.model, id: lead.id } } : {}),
      ...(lead?.ingestion_origin ? { ingestion_origin: lead.ingestion_origin } : {}),
      ...(hop.record_links.find((row) => row.state === "active")
        ? { record_link_id: hop.record_links.find((row) => row.state === "active")?.id }
        : {}),
      ...(booking ? { booking_id: booking.id } : {}),
      ...(cancellation ? { cancellation_id: cancellation.id } : {}),
    },
    events: sorted,
  };

  return {
    status: "ok",
    page: projectEnhancedPage({
      page,
      rows: input.rows,
      now: rawInput.now,
      cancellationViaSnapshot: selectedCancellations.viaSnapshot,
    }),
  };
}

export function hasSuccessfulLeadMessage(events: JobTimelineEvent[]): boolean {
  return events.some((row) => {
    if (row.kind !== "lead_message") return false;
    const status = String(row.data.status ?? "");
    return (SUCCESSFUL_LEAD_MESSAGE_STATUSES as readonly string[]).includes(status);
  });
}
