import type {
  AssuranceFinding,
  AssuranceReport,
  ChangeEvidence,
  CountRow,
  DecisionEvidence,
  LifecycleEvidence,
  TimelineProof,
} from "./types.js";

function distribution(values: string[]): CountRow[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = value || "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

function latestDecisions(decisions: DecisionEvidence[]): DecisionEvidence[] {
  const latest = new Map<string, DecisionEvidence>();
  for (const decision of decisions) {
    const current = latest.get(decision.observation_id);
    if (!current || decision.attempt > current.attempt) {
      latest.set(decision.observation_id, decision);
    }
  }
  return [...latest.values()];
}

function hasExactChange(decision: DecisionEvidence, changes: ChangeEvidence[]): boolean {
  const effect = decision.effects.find((row) =>
    (row.kind === "lead_updated" || row.kind === "lead_created") && row.ref_id,
  );
  if (!effect) return false;
  const expectedCommand = effect.kind === "lead_created"
    ? "createLeadFromGranot"
    : "synchronizeLeadFromGranot";
  return changes.some((change) =>
    change.decision_id === decision.id
    && change.entity_id === effect.ref_id
    && change.command_name === expectedCommand
    && effect.changed_paths.every((path) => change.changed_paths.includes(path)),
  );
}

function effectLeadId(decision: DecisionEvidence): string | null {
  return decision.effects.find((row) =>
    (row.kind === "lead_updated" || row.kind === "lead_created") && row.ref_id,
  )?.ref_id ?? null;
}

function timelineProofs(evidence: LifecycleEvidence): TimelineProof[] {
  const desired = [
    "lead_created",
    "lead_message",
    "lead_updated",
    "booking_intake",
    "official_booking",
    "cancellation_intake",
    "official_cancellation",
    "sheet_sync",
  ];
  return evidence.timeline_pages.slice(0, 6).map((page, index) => {
    const present = new Set(page.events.map((event) => event.kind));
    return {
      label: `Job ${String.fromCharCode(65 + index)}`,
      proof_shape: page.proof_shape,
      stages: desired.filter((stage) => present.has(stage as never)),
      missing_stages: desired.filter((stage) => !present.has(stage as never)),
      events: page.events.map((event) => ({
        event_at: event.event_at,
        kind: event.kind,
        headline: event.headline,
      })),
    };
  });
}

export function buildAssuranceReport(evidence: LifecycleEvidence): AssuranceReport {
  const latest = latestDecisions(evidence.decisions);
  const receiptIds = new Set(evidence.receipts.map((row) => row.id));
  const observationReceiptIds = new Set(
    evidence.observations.map((row) => row.receipt_id).filter((id): id is string => Boolean(id)),
  );
  const decisionObservationIds = new Set(latest.map((row) => row.observation_id));
  const attempts = new Map<string, number>();
  for (const decision of evidence.decisions) {
    attempts.set(decision.observation_id, (attempts.get(decision.observation_id) ?? 0) + 1);
  }

  const completedReceiptIds = new Set(
    evidence.receipts.filter((row) => row.state === "completed").map((row) => row.id),
  );
  const completedWithoutObservation = [...completedReceiptIds]
    .filter((id) => !observationReceiptIds.has(id)).length;
  const observationsWithoutReceipt = evidence.observations
    .filter((row) => !row.receipt_id || !receiptIds.has(row.receipt_id)).length;
  const observationsWithoutDecision = evidence.observations
    .filter((row) => !decisionObservationIds.has(row.id)).length;

  const applied = latest.filter((row) => row.outcome === "applied" || row.outcome === "created");
  const exactChanges = applied.filter((row) => hasExactChange(row, evidence.changes));
  const appliedLeadIds = new Set(applied.map(effectLeadId).filter((id): id is string => Boolean(id)));
  const appliedSheetJobs = evidence.sheet_jobs.filter((row) => appliedLeadIds.has(row.entity_id));
  const appliedWithSheet = new Set(appliedSheetJobs.map((row) => row.entity_id)).size;

  const activityChanges = evidence.changes.filter((row) => row.in_window);
  const activitySheetJobs = evidence.sheet_jobs.filter((row) => row.in_window);
  const createChanges = activityChanges.filter((row) =>
    row.command_name === "createFormLead"
    || row.command_name === "createCallLead"
    || row.command_name === "createLeadFromGranot",
  );
  const createdLeadIds = new Set(evidence.leads.map((row) => row.id));
  const leadsWithCreateChange = new Set(
    createChanges.filter((row) => createdLeadIds.has(row.entity_id)).map((row) => row.entity_id),
  ).size;

  const findings: AssuranceFinding[] = [];
  findings.push(observationsWithoutDecision === 0
    ? { severity: "ok", code: "granot_decision_coverage", statement: "Every Granot Observation in the window has a latest Decision." }
    : { severity: "gap", code: "granot_decision_gap", statement: "Granot Observations are missing a Decision.", count: observationsWithoutDecision });
  findings.push(completedWithoutObservation === 0
    ? { severity: "ok", code: "granot_receipt_observation_coverage", statement: "Every completed Granot receipt in the window has an Observation." }
    : { severity: "gap", code: "granot_receipt_observation_gap", statement: "Completed Granot receipts are missing an Observation.", count: completedWithoutObservation });
  findings.push(exactChanges.length === applied.length
    ? { severity: "ok", code: "granot_change_coverage", statement: "Every applied/created latest Granot Decision has exact EntityChange evidence." }
    : { severity: "gap", code: "granot_change_gap", statement: "Applied/created Granot Decisions are missing exact EntityChange evidence.", count: applied.length - exactChanges.length });
  const terminalFailures = activitySheetJobs.filter((row) => row.status === "failed").length;
  findings.push(terminalFailures === 0
    ? { severity: "ok", code: "sheet_terminal_failures", statement: "No Sheet Sync job active in the window is terminally failed." }
    : { severity: "gap", code: "sheet_terminal_failures", statement: "Sheet Sync jobs are terminally failed.", count: terminalFailures });
  findings.push({
    severity: "attention",
    code: "sheet_destination_unverified",
    statement: "Outbox evidence proves scheduling/execution state, not current Google Sheet row equality.",
  });
  if (evidence.cancellation_traceability.with_resolvable_job < evidence.cancellation_traceability.total) {
    findings.push({
      severity: "attention",
      code: "historical_cancellation_job_walkback_gap",
      statement: "Historical Cancellations cannot all walk back to Job Number because some referenced Bookings no longer exist.",
      count: evidence.cancellation_traceability.total - evidence.cancellation_traceability.with_resolvable_job,
    });
  }
  findings.push({
    severity: "attention",
    code: "upstream_completeness_unverified",
    statement: "WordPress submissions have no independent receipt ledger; RingCentral is assured only through its last successful Call Log cursor.",
  });

  const deltas: Record<string, number> = {};
  for (const [collection, before] of Object.entries(evidence.collection_counts_before)) {
    deltas[collection] = (evidence.collection_counts_after[collection] ?? before) - before;
  }

  const hasActivity = evidence.receipts.length > 0
    || evidence.leads.length > 0
    || evidence.messages.length > 0
    || activityChanges.length > 0
    || evidence.bookings.some((row) => row.in_window)
    || evidence.cancellations.some((row) => row.in_window)
    || evidence.booking_cases.length > 0
    || evidence.cancellation_cases.length > 0
    || activitySheetJobs.length > 0;
  const activatedAt = evidence.activated_at ? new Date(evidence.activated_at).valueOf() : null;
  const preActivationObservations = activatedAt == null
    ? 0
    : evidence.observations.filter((row) => new Date(row.captured_at).valueOf() < activatedAt).length;
  const postActivationObservations = evidence.observations.length - preActivationObservations;
  const officialBookings = evidence.bookings.filter((row) => row.in_window);
  const officialCancellations = evidence.cancellations.filter((row) => row.in_window);
  const bookingIds = new Set(evidence.bookings.map((row) => row.id));
  const cancellationBookingIds = new Set(evidence.cancellations.map((row) => row.booked_lead_id));
  const finalizedBookingCases = evidence.booking_cases.filter((row) =>
    row.resolution_outcome === "booking_created"
    || row.resolution_outcome === "booking_updated"
    || row.resolution_outcome === "referral_booking_created"
    || row.resolution_outcome === "already_satisfied",
  );
  const finalizedCancellationCases = evidence.cancellation_cases.filter((row) =>
    row.resolution_outcome === "cancellation_created"
    || row.resolution_outcome === "already_satisfied",
  );
  const resolvedBookingCases = evidence.booking_cases.filter((row) => row.state === "resolved");
  const resolvedCancellationCases = evidence.cancellation_cases.filter((row) => row.state === "resolved");
  const ringCentralMaterialized = evidence.ringcentral_processed.filter((row) => row.call_lead_expected);
  const ringCentralMaterializedPresent = ringCentralMaterialized.filter((row) => row.call_lead_exists);
  const cursorLagMinutes = evidence.ringcentral_sync_state?.last_sync_to
    ? Math.max(0, (new Date(evidence.generated_at).valueOf() - new Date(evidence.ringcentral_sync_state.last_sync_to).valueOf()) / 60_000)
    : null;
  if (ringCentralMaterializedPresent.length === ringCentralMaterialized.length) {
    findings.push({
      severity: "ok",
      code: "ringcentral_materialization_coverage",
      statement: "Every RingCentral ledger outcome that claims Lead materialization resolves to a Call Lead.",
    });
  } else {
    findings.push({
      severity: "gap",
      code: "ringcentral_materialization_gap",
      statement: "RingCentral ledger outcomes claim Lead materialization without a Call Lead.",
      count: ringCentralMaterialized.length - ringCentralMaterializedPresent.length,
    });
  }
  if (evidence.ringcentral_sync_state?.last_run_status === "success" && cursorLagMinutes != null && cursorLagMinutes <= 90) {
    findings.push({
      severity: "ok",
      code: "ringcentral_cursor_fresh",
      statement: "RingCentral Call Log sync has a recent successful high-water mark.",
    });
  } else {
    findings.push({
      severity: "attention",
      code: "ringcentral_cursor_not_fresh",
      statement: "RingCentral Call Log sync does not have a successful high-water mark within the 90-minute assurance threshold.",
    });
  }
  const internallyClean = !findings.some((finding) => finding.severity === "gap");

  return {
    database: evidence.database,
    generated_at: evidence.generated_at,
    window: { ...evidence.window, timezone: "America/New_York" },
    activated_at: evidence.activated_at,
    verdict: !hasActivity
      ? "No lifecycle activity was found in this window, so the prototype cannot validate the chain from this run."
      : internallyClean
      ? "The stored lifecycle is internally reconciled for the checked joins, with bounded assurance at the upstream-source and Google-destination edges."
      : "The stored lifecycle has named internal reconciliation gaps in this window; upstream-source and Google-destination assurance also remain bounded.",
    stages: [
      {
        stage: "Lead created",
        confidence: "bounded",
        result: `${evidence.leads.length} stored Leads; ${leadsWithCreateChange} have creation EntityChange evidence in this window.`,
        evidence: "form_leads / call_leads plus creation EntityChange; RingCentral also has processed-call ledger and Call Log high-water mark",
        limitation: "No independent WordPress submission ledger is included. RingCentral is covered only through the last successful provider cursor.",
      },
      {
        stage: "Lead text messaged",
        confidence: "strong",
        result: `${evidence.messages.length} Lead Message records initiated in the window.`,
        evidence: "lead_messages status, attempts, origin, purpose, and provider lifecycle",
        limitation: "Delivered status is provider evidence; absence of a Lead Message is not automatically an error because messaging gates may block it.",
      },
      {
        stage: "Lead updated",
        confidence: observationsWithoutDecision === 0 && exactChanges.length === applied.length ? "verified" : "bounded",
        result: `${activityChanges.length} Lead/Booking/Cancellation Entity Changes in the window; ${exactChanges.length}/${applied.length} applied Granot Decisions match exact change evidence.`,
        evidence: "latest Synchronization Decision plus append-only EntityChange and changed_paths",
        limitation: "Legacy/public updates without EntityChange cannot be reconstructed field-by-field.",
      },
      {
        stage: "Booking intake",
        confidence: "strong",
        result: `${evidence.booking_cases.length} Booking cases active in the window.`,
        evidence: "granot_booking_reconciliation_cases with immutable Observation evidence",
        limitation: "A case is owner work, not an official Booking.",
      },
      {
        stage: "Booking finalized",
        confidence: "strong",
        result: `${officialBookings.length} official Bookings recorded in the activity window; ${finalizedBookingCases.filter((row) => row.deterministic_booking_id && bookingIds.has(row.deterministic_booking_id)).length}/${finalizedBookingCases.length} finalizing Booking cases resolve to an official Booking fact.`,
        evidence: "booked_leads is the Mongo system of record",
        limitation: "Historical Bookings may be official_fact_only when no EntityChange exists.",
      },
      {
        stage: "Cancellation intake",
        confidence: "strong",
        result: `${evidence.cancellation_cases.length} Cancellation cases active in the window.`,
        evidence: "granot_release_reconciliation_cases with immutable Observation evidence",
        limitation: "A Release case is owner work, not an official Cancellation.",
      },
      {
        stage: "Cancellation finalized",
        confidence: "strong",
        result: `${officialCancellations.length} official Cancellations recorded in the activity window; ${finalizedCancellationCases.filter((row) => row.deterministic_booking_id && cancellationBookingIds.has(row.deterministic_booking_id)).length}/${finalizedCancellationCases.length} finalizing Cancellation cases resolve to an official Cancellation fact.`,
        evidence: "cancelled_leads linked to booked_leads",
        limitation: "Historical Cancellations may lack command-backed EntityChange evidence; deleted Bookings break Job Number walk-back because Cancellation stores only booked_lead ID.",
      },
      {
        stage: "Sheets caught up",
        confidence: "bounded",
        result: `${activitySheetJobs.length} Sheet Sync jobs active in the window; ${terminalFailures} terminal failures.`,
        evidence: "sheet_sync_jobs durable outbox and drainer status",
        limitation: "No Google Sheets read-back was performed, so destination equality is not verified.",
      },
      {
        stage: "Move completed",
        confidence: "unknown",
        result: "No move-completion system-of-record collection is available to this prototype.",
        evidence: "none",
        limitation: "The currently observable lifecycle ends at official Booking or official Cancellation.",
      },
    ],
    granot: {
      receipts: evidence.receipts.length,
      observations: evidence.observations.length,
      latest_decisions: latest.length,
      completed_receipts_without_observation: completedWithoutObservation,
      observations_without_receipt: observationsWithoutReceipt,
      observations_without_decision: observationsWithoutDecision,
      observations_with_multiple_attempts: [...attempts.values()].filter((count) => count > 1).length,
      pre_activation_observations: preActivationObservations,
      post_activation_observations: postActivationObservations,
      receipt_states: distribution(evidence.receipts.map((row) => `${row.route} / ${row.state}`)),
      observation_routes: distribution(evidence.observations.map((row) => `${row.route} / ${row.action ?? row.priority ?? "no action"}`)),
      decision_outcomes: distribution(latest.map((row) => `${row.outcome} / ${row.reason_code}`)),
      applied_or_created: applied.length,
      applied_with_exact_entity_change: exactChanges.length,
      applied_with_entity_sheet_job: appliedWithSheet,
      applied_sheet_statuses: distribution(appliedSheetJobs.map((row) => row.status)),
    },
    ringcentral: {
      processed_calls: evidence.ringcentral_processed.length,
      statuses: distribution(evidence.ringcentral_processed.map((row) => row.status)),
      ingestion_sources: distribution(evidence.ringcentral_processed.map((row) => row.ingestion_source)),
      materialized_expected: ringCentralMaterialized.length,
      materialized_with_call_lead: ringCentralMaterializedPresent.length,
      covered_through: evidence.ringcentral_sync_state?.last_sync_to ?? null,
      cursor_lag_minutes: cursorLagMinutes == null ? null : Math.round(cursorLagMinutes * 10) / 10,
      last_run_status: evidence.ringcentral_sync_state?.last_run_status ?? null,
      last_error: evidence.ringcentral_sync_state?.last_error ?? null,
      last_run_counts: {
        processed: evidence.ringcentral_sync_state?.last_processed_count ?? null,
        qualified: evidence.ringcentral_sync_state?.last_qualified_count ?? null,
        lead_actions: evidence.ringcentral_sync_state?.last_lead_action_count ?? null,
      },
    },
    lifecycle: {
      leads_by_origin: distribution(evidence.leads.map((row) => `${row.model} / ${row.ingestion_origin}`)),
      leads_with_create_change: leadsWithCreateChange,
      messages_by_status: distribution(evidence.messages.map((row) => row.status)),
      messages_by_origin: distribution(evidence.messages.map((row) => `${row.origin} / ${row.purpose}`)),
      changes_by_command: distribution(activityChanges.map((row) => row.command_name)),
      changed_paths: distribution(activityChanges.flatMap((row) => row.changed_paths)),
      booking_cases_by_state: distribution(evidence.booking_cases.map((row) => `${row.state} / ${row.mode}`)),
      official_bookings: officialBookings.length,
      resolved_booking_cases: resolvedBookingCases.length,
      resolved_booking_cases_with_official_fact: resolvedBookingCases.filter((row) =>
        row.deterministic_booking_id != null && bookingIds.has(row.deterministic_booking_id),
      ).length,
      finalized_booking_cases: finalizedBookingCases.length,
      finalized_booking_cases_with_official_fact: finalizedBookingCases.filter((row) =>
        row.deterministic_booking_id != null && bookingIds.has(row.deterministic_booking_id),
      ).length,
      cancellation_cases_by_state: distribution(evidence.cancellation_cases.map((row) => row.state)),
      official_cancellations: officialCancellations.length,
      resolved_cancellation_cases: resolvedCancellationCases.length,
      resolved_cancellation_cases_with_official_fact: resolvedCancellationCases.filter((row) =>
        row.deterministic_booking_id != null && cancellationBookingIds.has(row.deterministic_booking_id),
      ).length,
      finalized_cancellation_cases: finalizedCancellationCases.length,
      finalized_cancellation_cases_with_official_fact: finalizedCancellationCases.filter((row) =>
        row.deterministic_booking_id != null && cancellationBookingIds.has(row.deterministic_booking_id),
      ).length,
      historical_cancellations: evidence.cancellation_traceability.total,
      historical_cancellations_with_surviving_booking: evidence.cancellation_traceability.with_surviving_booking,
      historical_cancellations_with_resolvable_job: evidence.cancellation_traceability.with_resolvable_job,
    },
    sheets: {
      jobs: activitySheetJobs.length,
      statuses: distribution(activitySheetJobs.map((row) => `${row.status} / ${row.resource}`)),
      terminal_failures: terminalFailures,
      destination_verified: false,
    },
    findings,
    timelines: timelineProofs(evidence),
    read_only_proof: {
      collection_count_deltas: deltas,
      source_operations: ["find", "aggregate", "countDocuments"],
      note: "The prototype contains no Mongo insert, update, delete, bulkWrite, save, or index operation. Count deltas can still occur from normal concurrent production traffic.",
    },
  };
}
