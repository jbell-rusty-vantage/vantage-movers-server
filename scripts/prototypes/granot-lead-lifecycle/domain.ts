/**
 * PROTOTYPE — not production code.
 *
 * Question: can one small, pure interface explain Granot observations and
 * authoritative Vantage booking/cancellation commands without collapsing
 * transport, matching, state transition, provenance, and projection concerns?
 *
 * The intentionally deep interface is `advanceLeadLifecycle`. Everything else
 * in this file is implementation detail or a plain domain type used to inspect
 * the result. No database, queue, HTTP, or Google Sheets calls occur here.
 */

export type LeadModel = "FormLead" | "CallLead";
export type LeadChannel = "form" | "call";
export type ObservationChannel =
  | "granot_webhook"
  | "browser_extension"
  | "granot_http_automation";

export type GranotRouteEventType =
  | "lead_created"
  | "priority_updated"
  | "booking_status_changed";

export type SourceScope = {
  granot_label: string;
  source_company: string;
  source_granularity_key: string;
  channel: LeadChannel;
};

export type AgentIdentity = {
  id: string;
  name: string;
  granot_crm_username?: string;
  active: boolean;
};

export type MerchantIdentity = {
  name: string;
  active: boolean;
};

export type PrototypeCatalog = {
  sources: SourceScope[];
  agents: AgentIdentity[];
  merchants: MerchantIdentity[];
  booking_intake_email_enabled: boolean;
  cancellation_intake_email_enabled: boolean;
};

export type LeadSnapshot = {
  id: string;
  model: LeadModel;
  source_company: string;
  source_granularity_key: string;
  duplicate: boolean;
  created_on_unmatched?: boolean;
  ref_no?: string;
  name?: string;
  phone_number?: string;
  normalized_phone_number?: string;
  email?: string;
  job_no?: string;
  quoted?: boolean;
  cubic_feet?: number;
  pickup_city?: string;
  pickup_state?: string;
  pickup_zip?: string;
  delivery_city?: string;
  delivery_state?: string;
  delivery_zip?: string;
  receiver_agent?: string;
  booked?: string;
  cancelled?: string;
  revision: number;
};

export type BookingSnapshot = {
  id: string;
  lead_ref: string;
  lead_model: LeadModel;
  job_no: string;
  book_date: string;
  agent_allocations: Array<{
    agent: string;
    agent_name_snapshot: string;
    binder_amount: number;
  }>;
  total_binder_amount: number;
  deposit_amount: number;
  merchant: string;
  source: string;
  cancelled?: string;
  revision: number;
};

export type CancellationSnapshot = {
  id: string;
  booked_lead: string;
  lead_ref: string;
  lead_model: LeadModel;
  cancel_date: string;
  refund_amount: number;
  reason?: string;
  notes?: string;
  cancelled_by?: string;
};

export type GranotRecordLink = {
  normalized_job_no: string;
  lead_ref: string;
  lead_model: LeadModel;
  booking_ref?: string;
  state: "active" | "disputed";
  established_by_observation_id: string;
  last_observed_at: string;
  owner_correction?: {
    booking_intake_case_id: string;
    previous_lead_ref: string;
    previous_lead_model: LeadModel;
    actor_id: string;
    corrected_at: string;
  };
};

export type EntityChange = {
  change_id: string;
  entity: { model: LeadModel | "BookedLead" | "CancelledLead"; id: string };
  command_name: string;
  changed_fields: string[];
  revision_before: number;
  revision_after: number;
  provenance: {
    source_system: "granot" | "vantage";
    observation_channel?: ObservationChannel;
    actor_type: "system" | "owner";
    actor_id: string;
    receipt_id?: string;
    observation_id?: string;
    command_id: string;
    occurred_at?: string;
  };
  applied_at: string;
};

export type GranotBookingDiscrepancy = {
  key: string;
  lead_ref: string;
  lead_model: LeadModel;
  normalized_job_no: string;
  reason:
    | "granot_booking_conflicts_with_vantage_booking"
    | "granot_record_link_conflict";
  observation_id: string;
  state: "open" | "dismissed";
};

export type SuggestedBookingLead = {
  lead_ref: string;
  lead_model: LeadModel;
  confidence: "high" | "medium" | "low";
  match_method:
    | "granot_record_link"
    | "form_ref_no_exact"
    | "call_job_no_exact"
    | "source_scoped_contact"
    | "owner_search";
  display: {
    name?: string;
    phone_number?: string;
    email?: string;
    source_granularity_key: string;
  };
};

export type GranotBookingIntakeCase = {
  case_id: string;
  normalized_job_no: string;
  state: "open" | "completed" | "dismissed";
  revision: number;
  opened_by_observation_id: string;
  last_observation_id: string;
  source_scope: SourceScope;
  observed: {
    job_no: string;
    service_type?: string;
    first_name?: string;
    last_name?: string;
    phone_number?: string;
    email?: string;
    move_date?: string;
    estimated_cubic_feet?: number;
    estimate?: number;
    assigned_username?: string;
  };
  suggested_booking_lead: SuggestedBookingLead;
  selected_booking_lead?: { lead_ref: string; lead_model: LeadModel };
  suggested_agent?: { agent_id: string; agent_name: string; evidence: string };
  booking_ref?: string;
  opened_at: string;
  completed_at?: string;
};

export type BookingIntakeNotification = {
  notification_id: string;
  booking_intake_case_id: string;
  channel: "dashboard" | "email";
  state: "visible" | "queued" | "acted" | "dismissed";
  dedupe_key: string;
  created_at: string;
};

export type LinkedCancellationBooking = {
  booking_ref: string;
  lead_ref: string;
  lead_model: LeadModel;
  job_no: string;
  book_date: string;
  deposit_amount: number;
  merchant: string;
  source: string;
};

export type GranotReleaseOwnerPath = "confirm_cancellation" | "update_booking";
export type GranotCancellationIntakeResolution =
  | "confirm_cancellation"
  | "update_booking"
  | "dismiss";

export type GranotCancellationIntakeCase = {
  case_id: string;
  normalized_job_no: string;
  state: "open" | "completed" | "dismissed";
  revision: number;
  opened_by_observation_id: string;
  last_observation_id: string;
  source_scope: SourceScope;
  linked_cancellation_booking: LinkedCancellationBooking;
  offered_owner_paths: GranotReleaseOwnerPath[];
  observed: {
    job_no: string;
    raw_booking_status: string;
    granot_priority?: string;
    payment?: number;
    balance?: number;
    estimate?: number;
    first_name?: string;
    last_name?: string;
    assigned_username?: string;
  };
  resolution_action?: GranotCancellationIntakeResolution;
  cancellation_ref?: string;
  opened_at: string;
  completed_at?: string;
};

export type CancellationIntakeNotification = {
  notification_id: string;
  cancellation_intake_case_id: string;
  channel: "dashboard" | "email";
  state: "visible" | "queued" | "acted" | "dismissed";
  dedupe_key: string;
  created_at: string;
};

export type GranotCancellationDiscrepancy = {
  key: string;
  lead_ref: string;
  lead_model: LeadModel;
  normalized_job_no: string;
  reason:
    | "releas_without_vantage_booking"
    | "granot_record_link_conflict"
    | "granot_booked_after_vantage_cancellation";
  observation_id: string;
  state: "open" | "resolved" | "dismissed";
};

export type LifecycleWorld = {
  leads: LeadSnapshot[];
  bookings: BookingSnapshot[];
  cancellations: CancellationSnapshot[];
  granot_record_links: GranotRecordLink[];
  entity_changes: EntityChange[];
  granot_booking_intake_cases: GranotBookingIntakeCase[];
  booking_intake_notifications: BookingIntakeNotification[];
  granot_booking_discrepancies: GranotBookingDiscrepancy[];
  granot_cancellation_intake_cases: GranotCancellationIntakeCase[];
  cancellation_intake_notifications: CancellationIntakeNotification[];
  granot_cancellation_discrepancies: GranotCancellationDiscrepancy[];
  processed_receipt_ids: string[];
};

export type GranotWebhookReceiptInput = {
  receipt_id: string;
  route_event_type: GranotRouteEventType;
  received_at: string;
  occurred_at?: string;
  payload: Record<string, string | undefined>;
};

export type ObserveGranotAction = {
  kind: "observe_granot";
  observation_channel: ObservationChannel;
  actor: { actor_type: "system" | "owner"; actor_id: string };
  receipt: GranotWebhookReceiptInput;
};

export type RecordBookingAction = {
  kind: "record_booking";
  command_id: string;
  actor_id: string;
  booking: Omit<BookingSnapshot, "revision" | "cancelled">;
};

export type RecordCancellationAction = {
  kind: "record_cancellation";
  command_id: string;
  actor_id: string;
  cancellation: CancellationSnapshot;
};

export type ConfirmGranotBookingAction = {
  kind: "confirm_granot_booking";
  command_id: string;
  actor_id: string;
  booking_intake_case_id: string;
  expected_case_revision: number;
  selected_booking_lead: { lead_ref: string; lead_model: LeadModel };
  official_booking_details: {
    booking_id: string;
    book_date: string;
    agent_allocations: BookingSnapshot["agent_allocations"];
    total_binder_amount: number;
    deposit_amount: number;
    merchant: string;
  };
};

export type ConfirmGranotCancellationAction = {
  kind: "confirm_granot_cancellation";
  command_id: string;
  actor_id: string;
  cancellation_intake_case_id: string;
  expected_case_revision: number;
  official_cancellation_details: {
    cancellation_id: string;
    cancel_date: string;
    refund_amount: number;
    reason?: string;
    notes?: string;
    cancelled_by?: string;
  };
};

export type UpdateGranotBookingAction = {
  kind: "update_granot_booking";
  command_id: string;
  actor_id: string;
  cancellation_intake_case_id: string;
  expected_case_revision: number;
  official_booking_details: {
    book_date: string;
    agent_allocations: BookingSnapshot["agent_allocations"];
    total_binder_amount: number;
    deposit_amount: number;
    merchant: string;
  };
};

export type DismissGranotCancellationIntakeAction = {
  kind: "dismiss_granot_cancellation_intake";
  command_id: string;
  actor_id: string;
  cancellation_intake_case_id: string;
  expected_case_revision: number;
  reason?: string;
};

export type LifecycleAction =
  | ObserveGranotAction
  | RecordBookingAction
  | RecordCancellationAction
  | ConfirmGranotBookingAction
  | ConfirmGranotCancellationAction
  | UpdateGranotBookingAction
  | DismissGranotCancellationIntakeAction;

export type SynchronizationDecisionOutcome =
  | "applied"
  | "linked"
  | "already_current"
  | "already_processed"
  | "stale"
  | "pending_match"
  | "ambiguous"
  | "conflict"
  | "blocked"
  | "invalid";

export type LifecycleEffect =
  | { kind: "granot_record_link_established"; normalized_job_no: string }
  | { kind: "entity_change_recorded"; change_id: string }
  | {
      kind: "sheet_sync_requested";
      resource: "source_lead" | "booking_chain" | "cancellation_chain";
      operation: string;
      entity_id: string;
    }
  | { kind: "granot_booking_discrepancy_opened"; key: string }
  | {
      kind: "granot_record_link_corrected";
      normalized_job_no: string;
      lead_ref: string;
    }
  | { kind: "granot_booking_intake_opened"; case_id: string }
  | {
      kind: "booking_intake_notification_requested";
      case_id: string;
      channel: "dashboard" | "email";
    }
  | { kind: "granot_booking_confirmed"; case_id: string; booking_id: string }
  | { kind: "granot_cancellation_intake_opened"; case_id: string }
  | {
      kind: "cancellation_intake_notification_requested";
      case_id: string;
      channel: "dashboard" | "email";
    }
  | {
      kind: "granot_cancellation_confirmed";
      case_id: string;
      cancellation_id: string;
    }
  | { kind: "granot_booking_updated"; case_id: string; booking_id: string }
  | { kind: "granot_cancellation_intake_dismissed"; case_id: string }
  | { kind: "granot_cancellation_intake_reopened"; case_id: string }
  | { kind: "granot_cancellation_discrepancy_opened"; key: string };

export type LifecycleResult = {
  world: LifecycleWorld;
  decision: {
    outcome: SynchronizationDecisionOutcome;
    reason: string;
    observation_id?: string;
    target?: { model: LeadModel | "BookedLead" | "CancelledLead"; id: string };
    match_method?:
      | "granot_record_link"
      | "form_ref_no_exact"
      | "call_job_no_exact"
      | "source_scoped_contact";
    source_scope?: SourceScope;
    raw_granot_priority?: string;
    proposed_fields: string[];
    warnings: string[];
  };
  effects: LifecycleEffect[];
};

type NormalizedGranotObservation = {
  observation_id: string;
  receipt_id: string;
  kind: "lead_created" | "priority_snapshot" | "booking_status_snapshot";
  provider_event_type?: string;
  observed_at: string;
  occurred_at?: string;
  source_label: string;
  job_no: string;
  normalized_job_no: string;
  ref_no?: string;
  first_name?: string;
  last_name?: string;
  phone_number?: string;
  email?: string;
  normalized_phone?: string;
  normalized_email?: string;
  service_type?: string;
  move_date?: string;
  granot_priority?: string;
  raw_booking_status?: string;
  estimated_cubic_feet?: number;
  estimate?: number;
  payment?: number;
  balance?: number;
  pickup_city?: string;
  pickup_state?: string;
  pickup_zip?: string;
  delivery_city?: string;
  delivery_state?: string;
  delivery_zip?: string;
  assigned_username?: string;
  normalization_warnings: string[];
};

type MatchResult =
  | {
      outcome: "matched";
      lead: LeadSnapshot;
      method:
        | "granot_record_link"
        | "form_ref_no_exact"
        | "call_job_no_exact"
        | "source_scoped_contact";
    }
  | { outcome: "pending_match"; reason: string }
  | { outcome: "ambiguous" | "conflict"; reason: string };

/**
 * Deep prototype interface. It owns normalization, source resolution,
 * channel-aware identity, legal transition policy, provenance, idempotent
 * desired-state application, and projection/reconciliation intent planning.
 */
export function advanceLeadLifecycle(
  current: LifecycleWorld,
  action: LifecycleAction,
  catalog: PrototypeCatalog,
): LifecycleResult {
  const world = structuredClone(current);
  if (action.kind === "record_booking") {
    return recordBooking(world, action, catalog);
  }
  if (action.kind === "record_cancellation") {
    return recordCancellation(world, action);
  }
  if (action.kind === "confirm_granot_booking") {
    return confirmGranotBooking(world, action, catalog);
  }
  if (action.kind === "confirm_granot_cancellation") {
    return confirmGranotCancellation(world, action);
  }
  if (action.kind === "update_granot_booking") {
    return updateGranotBooking(world, action, catalog);
  }
  if (action.kind === "dismiss_granot_cancellation_intake") {
    return dismissGranotCancellationIntake(world, action);
  }
  return observeGranot(world, action, catalog);
}

function observeGranot(
  world: LifecycleWorld,
  action: ObserveGranotAction,
  catalog: PrototypeCatalog,
): LifecycleResult {
  const { receipt } = action;
  if (world.processed_receipt_ids.includes(receipt.receipt_id)) {
    return result(world, "already_processed", "Receipt was already processed.");
  }

  const normalized = normalizeGranotReceipt(receipt);
  world.processed_receipt_ids.push(receipt.receipt_id);
  if ("error" in normalized) {
    return result(world, "invalid", normalized.error, {
      observation_id: normalized.observation_id,
      warnings: normalized.warnings,
    });
  }
  const observation = normalized.observation;
  const sourceScope = catalog.sources.find(
    (source) => source.granot_label === observation.source_label,
  );
  if (!sourceScope) {
    return result(
      world,
      "blocked",
      `Granot source label "${observation.source_label}" has no approved Source Scope.`,
      {
        observation_id: observation.observation_id,
        raw_granot_priority: observation.granot_priority,
        warnings: observation.normalization_warnings,
      },
    );
  }

  const match = matchLead(world, observation, sourceScope);
  if (match.outcome !== "matched") {
    return result(world, match.outcome, match.reason, {
      observation_id: observation.observation_id,
      source_scope: sourceScope,
      raw_granot_priority: observation.granot_priority,
      warnings: observation.normalization_warnings,
    });
  }

  const effects: LifecycleEffect[] = [];
  const link = establishOrRefreshLink(world, observation, match.lead);
  if (link.established) {
    effects.push({
      kind: "granot_record_link_established",
      normalized_job_no: observation.normalized_job_no,
    });
  }

  if (observation.kind === "lead_created") {
    return {
      ...result(
        world,
        link.established ? "linked" : "already_current",
        link.established
          ? "Granot job was linked to the existing Vantage Lead."
          : "Granot job was already linked to this Vantage Lead.",
        {
          observation_id: observation.observation_id,
          target: { model: match.lead.model, id: match.lead.id },
          match_method: match.method,
          source_scope: sourceScope,
          warnings: observation.normalization_warnings,
        },
      ),
      effects,
    };
  }

  if (observation.kind === "booking_status_snapshot") {
    return handleBookingStatusObservation(
      world,
      observation,
      match,
      sourceScope,
      catalog,
      effects,
    );
  }

  return handlePriorityObservation(
    world,
    observation,
    match,
    sourceScope,
    action.observation_channel,
    action.actor,
    catalog,
    effects,
  );
}

function normalizeGranotReceipt(
  receipt: GranotWebhookReceiptInput,
):
  | { observation: NormalizedGranotObservation }
  | { observation_id: string; error: string; warnings: string[] } {
  const payload = receipt.payload;
  const observationId = `granot-observation:${receipt.receipt_id}`;
  const sourceLabel = clean(payload.source ?? payload.Source);
  const jobNo = clean(payload.job_no);
  const providerEventType = clean(payload.event_type);
  if (!sourceLabel || !jobNo) {
    return {
      observation_id: observationId,
      error: "Granot Observation requires source and job_no.",
      warnings: [],
    };
  }

  const kind =
    receipt.route_event_type === "lead_created"
      ? "lead_created"
      : receipt.route_event_type === "priority_updated"
        ? "priority_snapshot"
        : "booking_status_snapshot";
  const warnings: string[] = [];
  if (
    kind === "priority_snapshot" &&
    providerEventType &&
    providerEventType !== "priority_update"
  ) {
    warnings.push(
      `Route says priority_updated while payload event_type is "${providerEventType}".`,
    );
  }

  return {
    observation: {
      observation_id: observationId,
      receipt_id: receipt.receipt_id,
      kind,
      provider_event_type: providerEventType,
      observed_at: receipt.received_at,
      occurred_at: receipt.occurred_at,
      source_label: sourceLabel,
      job_no: jobNo,
      normalized_job_no: normalizeJobNo(jobNo),
      ref_no: clean(payload.ref_no),
      first_name: clean(payload.first_name),
      last_name: clean(payload.last_name),
      phone_number: clean(payload.phone_number),
      email: clean(payload.email)?.toLowerCase(),
      normalized_phone: normalizePhone(payload.phone_number),
      normalized_email: clean(payload.email)?.toLowerCase(),
      service_type: clean(payload.service_type),
      move_date: clean(payload.move_date),
      granot_priority: clean(payload.priority),
      raw_booking_status:
        kind === "booking_status_snapshot" ? providerEventType : undefined,
      estimated_cubic_feet: parseNonNegativeNumber(payload.est_cf),
      estimate: parseNonNegativeNumber(payload.estimate),
      payment: parseNonNegativeNumber(payload.payment),
      balance: parseNonNegativeNumber(payload.balance),
      pickup_city: clean(payload.from_city),
      pickup_state: clean(payload.from_state)?.toUpperCase(),
      pickup_zip: clean(payload.from_zip),
      delivery_city: clean(payload.to_city),
      delivery_state: clean(payload.to_state)?.toUpperCase(),
      delivery_zip: clean(payload.to_zip),
      assigned_username: clean(payload.user ?? payload.rep)?.toUpperCase(),
      normalization_warnings: warnings,
    },
  };
}

function matchLead(
  world: LifecycleWorld,
  observation: NormalizedGranotObservation,
  sourceScope: SourceScope,
): MatchResult {
  const existingLink = world.granot_record_links.find(
    (link) =>
      link.normalized_job_no === observation.normalized_job_no &&
      link.state === "active",
  );
  if (existingLink) {
    const linked = world.leads.find(
      (lead) =>
        lead.id === existingLink.lead_ref &&
        lead.model === existingLink.lead_model,
    );
    if (!linked) {
      return {
        outcome: "conflict",
        reason: "Active Granot Record Link points to a missing Vantage Lead.",
      };
    }
    if (!leadBelongsToSource(linked, sourceScope)) {
      return {
        outcome: "conflict",
        reason: "Active Granot Record Link conflicts with the observed Source Scope.",
      };
    }
    return { outcome: "matched", lead: linked, method: "granot_record_link" };
  }

  const eligible = world.leads.filter(
    (lead) =>
      lead.model === (sourceScope.channel === "form" ? "FormLead" : "CallLead") &&
      lead.duplicate !== true &&
      lead.created_on_unmatched !== true,
  );

  if (sourceScope.channel === "form" && observation.ref_no) {
    const exactRef = eligible.filter(
      (lead) => lead.ref_no === observation.ref_no,
    );
    if (exactRef.length > 1) {
      return {
        outcome: "ambiguous",
        reason: "Multiple non-duplicate Form Leads share the exact Tracking Reference.",
      };
    }
    if (exactRef.length === 1) {
      if (!leadBelongsToSource(exactRef[0], sourceScope)) {
        return {
          outcome: "conflict",
          reason: "Exact Form Lead Tracking Reference conflicts with Source Scope.",
        };
      }
      return {
        outcome: "matched",
        lead: exactRef[0],
        method: "form_ref_no_exact",
      };
    }
  }

  if (sourceScope.channel === "call") {
    const exactJob = eligible.filter(
      (lead) =>
        normalizeJobNo(lead.job_no) === observation.normalized_job_no &&
        leadBelongsToSource(lead, sourceScope),
    );
    if (exactJob.length > 1) {
      return {
        outcome: "ambiguous",
        reason: "Multiple Call Leads share the same source-scoped Job Number.",
      };
    }
    if (exactJob.length === 1) {
      return {
        outcome: "matched",
        lead: exactJob[0],
        method: "call_job_no_exact",
      };
    }
  }

  const contactMatches = eligible.filter(
    (lead) =>
      leadBelongsToSource(lead, sourceScope) &&
      ((observation.normalized_phone &&
        lead.normalized_phone_number === observation.normalized_phone) ||
        (sourceScope.channel === "form" &&
          observation.normalized_email &&
          lead.email?.toLowerCase() === observation.normalized_email)),
  );
  if (contactMatches.length > 1) {
    return {
      outcome: "ambiguous",
      reason: "Multiple Leads match contact identity within the Source Scope.",
    };
  }
  if (contactMatches.length === 1) {
    return {
      outcome: "matched",
      lead: contactMatches[0],
      method: "source_scoped_contact",
    };
  }
  return {
    outcome: "pending_match",
    reason:
      sourceScope.channel === "call"
        ? "No qualified RingCentral Call Lead is available yet; keep the observation pending."
        : "No Form Lead is available yet; keep the observation pending for the ingestion race window.",
  };
}

function handlePriorityObservation(
  world: LifecycleWorld,
  observation: NormalizedGranotObservation,
  match: Extract<MatchResult, { outcome: "matched" }>,
  sourceScope: SourceScope,
  observationChannel: ObservationChannel,
  actor: ObserveGranotAction["actor"],
  catalog: PrototypeCatalog,
  effects: LifecycleEffect[],
): LifecycleResult {
  const priority = observation.granot_priority;
  if (!priority) {
    return result(world, "invalid", "Priority Snapshot has no Granot Priority.", {
      observation_id: observation.observation_id,
      target: { model: match.lead.model, id: match.lead.id },
      match_method: match.method,
      source_scope: sourceScope,
      warnings: observation.normalization_warnings,
    });
  }
  if (isStaleGranotObservation(world, match.lead, observation)) {
    return result(
      world,
      "stale",
      "Granot Observation occurred before a newer applied Granot Observation for this Lead.",
      {
        observation_id: observation.observation_id,
        target: { model: match.lead.model, id: match.lead.id },
        match_method: match.method,
        source_scope: sourceScope,
        raw_granot_priority: priority,
        warnings: observation.normalization_warnings,
      },
    );
  }
  if (!["0", "1", "5"].includes(priority)) {
    return result(
      world,
      "blocked",
      `Granot Priority ${priority} has no approved Vantage transition policy.`,
      {
        observation_id: observation.observation_id,
        target: { model: match.lead.model, id: match.lead.id },
        match_method: match.method,
        source_scope: sourceScope,
        raw_granot_priority: priority,
        warnings: observation.normalization_warnings,
      },
    );
  }

  const lead = world.leads.find(
    (candidate) =>
      candidate.id === match.lead.id && candidate.model === match.lead.model,
  )!;
  const patch = buildGranotLeadPatch(lead, observation, priority, catalog);
  const changedFields = Object.keys(patch);
  if (changedFields.length > 0) {
    const revisionBefore = lead.revision;
    Object.assign(lead, patch);
    lead.revision += 1;
    const change = entityChange({
      entity: { model: lead.model, id: lead.id },
      commandName: "ApplyGranotLeadSnapshot",
      changedFields,
      revisionBefore,
      revisionAfter: lead.revision,
      actorId: actor.actor_id,
      actorType: actor.actor_type,
      sourceSystem: "granot",
      observationChannel,
      receiptId: observation.receipt_id,
      observationId: observation.observation_id,
      occurredAt: observation.occurred_at,
      appliedAt: observation.observed_at,
    });
    world.entity_changes.push(change);
    effects.push(
      { kind: "entity_change_recorded", change_id: change.change_id },
      {
        kind: "sheet_sync_requested",
        resource: lead.booked ? "booking_chain" : "source_lead",
        operation:
          lead.model === "FormLead"
            ? "form_lead.granot_snapshot.apply"
            : "call_lead.granot_snapshot.apply",
        entity_id: lead.booked ?? lead.id,
      },
    );
  }

  if (priority === "5" && !lead.booked) {
    openOrRefreshGranotBookingIntake(
      world,
      lead,
      match.method,
      sourceScope,
      observation,
      catalog,
      effects,
    );
  }

  const bookingIntakeCreated = effects.some(
    (effect) => effect.kind === "granot_booking_intake_opened",
  );
  const applied = changedFields.length > 0 || bookingIntakeCreated;
  return {
    ...result(
      world,
      applied ? "applied" : "already_current",
      applied
        ? "Granot Lead Snapshot produced approved Vantage effects."
        : "Granot Lead Snapshot is already reflected in Vantage state.",
      {
        observation_id: observation.observation_id,
        target: { model: lead.model, id: lead.id },
        match_method: match.method,
        source_scope: sourceScope,
        raw_granot_priority: priority,
        proposed_fields: changedFields,
        warnings: observation.normalization_warnings,
      },
    ),
    effects,
  };
}

function buildGranotLeadPatch(
  lead: LeadSnapshot,
  observation: NormalizedGranotObservation,
  priority: string,
  catalog: PrototypeCatalog,
): Partial<LeadSnapshot> {
  const patch: Partial<LeadSnapshot> = {};
  if (lead.model === "FormLead" && ["1", "5"].includes(priority) && !lead.quoted) {
    patch.quoted = true;
  }
  if (
    ["1", "5"].includes(priority) &&
    observation.estimated_cubic_feet !== undefined &&
    lead.cubic_feet !== observation.estimated_cubic_feet
  ) {
    patch.cubic_feet = observation.estimated_cubic_feet;
  }
  if (lead.model === "CallLead" && !lead.job_no) {
    patch.job_no = observation.job_no;
  }
  fillMissing(patch, "pickup_city", lead.pickup_city, observation.pickup_city);
  fillMissing(patch, "pickup_state", lead.pickup_state, observation.pickup_state);
  fillMissing(patch, "pickup_zip", lead.pickup_zip, observation.pickup_zip);
  fillMissing(patch, "delivery_city", lead.delivery_city, observation.delivery_city);
  fillMissing(patch, "delivery_state", lead.delivery_state, observation.delivery_state);
  fillMissing(patch, "delivery_zip", lead.delivery_zip, observation.delivery_zip);
  if (!lead.receiver_agent && observation.assigned_username) {
    const matches = catalog.agents.filter(
      (agent) =>
        agent.granot_crm_username === observation.assigned_username &&
        agent.active,
    );
    if (matches.length === 1) patch.receiver_agent = matches[0].id;
  }
  return patch;
}

function handleBookingStatusObservation(
  world: LifecycleWorld,
  observation: NormalizedGranotObservation,
  match: Extract<MatchResult, { outcome: "matched" }>,
  sourceScope: SourceScope,
  catalog: PrototypeCatalog,
  effects: LifecycleEffect[],
): LifecycleResult {
  const lead = world.leads.find(
    (candidate) => candidate.id === match.lead.id && candidate.model === match.lead.model,
  )!;
  const rawStatus = observation.raw_booking_status ?? "";
  const isBookedAssertion = /^booked$/i.test(rawStatus);
  const isReleaseAssertion = isGranotReleaseEventType(rawStatus);
  const linked = resolveLinkedCancellationBooking(world, lead, observation);

  if (isBookedAssertion) {
    if (linked.kind === "conflict") {
      const discrepancy = openGranotCancellationDiscrepancy(
        world,
        lead,
        observation,
        "granot_record_link_conflict",
        effects,
      );
      return {
        ...result(
          world,
          discrepancy.opened ? "conflict" : "already_current",
          "Granot Booked assertion conflicts with the established Record Link or Booking identity.",
          {
            observation_id: observation.observation_id,
            target: { model: lead.model, id: lead.id },
            match_method: match.method,
            source_scope: sourceScope,
            warnings: observation.normalization_warnings,
          },
        ),
        effects,
      };
    }
    if (linked.kind === "found" && linked.booking.cancelled) {
      const discrepancy = openGranotCancellationDiscrepancy(
        world,
        lead,
        observation,
        "granot_booked_after_vantage_cancellation",
        effects,
      );
      return {
        ...result(
          world,
          discrepancy.opened ? "conflict" : "already_current",
          "Granot reports Booked after an official Vantage Cancellation; the Cancellation is retained.",
          {
            observation_id: observation.observation_id,
            target: { model: "CancelledLead", id: linked.booking.cancelled },
            match_method: match.method,
            source_scope: sourceScope,
            warnings: observation.normalization_warnings,
          },
        ),
        effects,
      };
    }
    if (linked.kind === "found") {
      refreshOpenCancellationIntake(world, observation, linked.booking);
      return {
        ...result(
          world,
          "already_current",
          "Granot Booked assertion is already represented by this Job Number's Vantage Booking. The owner may update that Booking if a Release intake is still open; a second Booking is not created.",
          {
            observation_id: observation.observation_id,
            target: { model: "BookedLead", id: linked.booking.id },
            match_method: match.method,
            source_scope: sourceScope,
            warnings: observation.normalization_warnings,
          },
        ),
        effects,
      };
    }
    openOrRefreshGranotBookingIntake(
      world,
      lead,
      match.method,
      sourceScope,
      observation,
      catalog,
      effects,
    );
    const created = effects.some((effect) => effect.kind === "granot_booking_intake_opened");
    return {
      ...result(
        world,
        created ? "applied" : "already_current",
        "Granot reports Booked without official Vantage booking details; a Granot Booking Intake Case is ready for owner confirmation.",
        {
          observation_id: observation.observation_id,
          target: { model: lead.model, id: lead.id },
          match_method: match.method,
          source_scope: sourceScope,
          warnings: observation.normalization_warnings,
        },
      ),
      effects,
    };
  }

  if (isReleaseAssertion) {
    if (linked.kind === "conflict") {
      const discrepancy = openGranotCancellationDiscrepancy(
        world,
        lead,
        observation,
        "granot_record_link_conflict",
        effects,
      );
      return {
        ...result(
          world,
          discrepancy.opened ? "conflict" : "already_current",
          "Granot release status cannot be confirmed because the Record Link and Booking identity conflict.",
          {
            observation_id: observation.observation_id,
            target: { model: lead.model, id: lead.id },
            match_method: match.method,
            source_scope: sourceScope,
            warnings: observation.normalization_warnings,
          },
        ),
        effects,
      };
    }
    if (linked.kind === "missing") {
      const discrepancy = openGranotCancellationDiscrepancy(
        world,
        lead,
        observation,
        "releas_without_vantage_booking",
        effects,
      );
      return {
        ...result(
          world,
          discrepancy.opened ? "conflict" : "already_current",
          "Granot Release has no Vantage Booking to cancel or update; official facts cannot be invented.",
          {
            observation_id: observation.observation_id,
            target: { model: lead.model, id: lead.id },
            match_method: match.method,
            source_scope: sourceScope,
            warnings: observation.normalization_warnings,
          },
        ),
        effects,
      };
    }
    if (linked.booking.cancelled) {
      refreshCompletedCancellationIntake(world, observation, linked.booking);
      return {
        ...result(
          world,
          "already_current",
          "Granot Release is already reflected by an official Vantage Cancellation.",
          {
            observation_id: observation.observation_id,
            target: { model: "CancelledLead", id: linked.booking.cancelled },
            match_method: match.method,
            source_scope: sourceScope,
            warnings: observation.normalization_warnings,
          },
        ),
        effects,
      };
    }
    const intake = openOrRefreshGranotCancellationIntake(
      world,
      lead,
      linked.booking,
      sourceScope,
      observation,
      catalog,
      effects,
    );
    const created = effects.some(
      (effect) => effect.kind === "granot_cancellation_intake_opened",
    );
    const reopened = effects.some(
      (effect) => effect.kind === "granot_cancellation_intake_reopened",
    );
    return {
      ...result(
        world,
        created || reopened ? "applied" : "already_current",
        created || reopened
          ? "Granot reports Release for an active Vantage Booking. The owner may confirm a Cancellation, update the existing Booking, or dismiss; no Vantage change is required."
          : "Granot Cancellation Intake Case was refreshed; the owner may still cancel, update the Booking, or dismiss.",
        {
          observation_id: observation.observation_id,
          target: { model: "BookedLead", id: intake.linked_cancellation_booking.booking_ref },
          match_method: match.method,
          source_scope: sourceScope,
          warnings: observation.normalization_warnings,
        },
      ),
      effects,
    };
  }

  return {
    ...result(world, "already_current", "Booking Status Snapshot requires no Vantage mutation.", {
      observation_id: observation.observation_id,
      target: { model: lead.model, id: lead.id },
      match_method: match.method,
      source_scope: sourceScope,
      warnings: observation.normalization_warnings,
    }),
    effects,
  };
}

function confirmGranotBooking(
  world: LifecycleWorld,
  action: ConfirmGranotBookingAction,
  catalog: PrototypeCatalog,
): LifecycleResult {
  const intake = world.granot_booking_intake_cases.find(
    (candidate) => candidate.case_id === action.booking_intake_case_id,
  );
  if (!intake) {
    return result(world, "invalid", "Granot Booking Intake Case was not found.");
  }
  if (intake.state !== "open") {
    return result(world, "already_current", "Granot Booking Intake Case is no longer open.");
  }
  if (intake.revision !== action.expected_case_revision) {
    return result(
      world,
      "conflict",
      "Granot Booking Intake Case changed after the owner opened it; refresh before confirming.",
    );
  }

  const selectedLead = world.leads.find(
    (lead) =>
      lead.id === action.selected_booking_lead.lead_ref &&
      lead.model === action.selected_booking_lead.lead_model,
  );
  if (
    !selectedLead ||
    selectedLead.duplicate ||
    selectedLead.created_on_unmatched ||
    selectedLead.booked ||
    selectedLead.cancelled ||
    !leadBelongsToSource(selectedLead, intake.source_scope)
  ) {
    return result(
      world,
      "blocked",
      "Confirm Granot Booking requires an eligible owner-selected Lead in the intake case Source Scope.",
    );
  }

  const official = action.official_booking_details;
  const bookingResult = recordBooking(
    world,
    {
      kind: "record_booking",
      command_id: action.command_id,
      actor_id: action.actor_id,
      booking: {
        id: official.booking_id,
        lead_ref: selectedLead.id,
        lead_model: selectedLead.model,
        job_no: intake.observed.job_no,
        book_date: official.book_date,
        agent_allocations: official.agent_allocations,
        total_binder_amount: official.total_binder_amount,
        deposit_amount: official.deposit_amount,
        merchant: official.merchant,
        source: intake.source_scope.granot_label,
      },
    },
    catalog,
    "ConfirmGranotBooking",
  );
  if (bookingResult.decision.outcome !== "applied") return bookingResult;

  const link = world.granot_record_links.find(
    (candidate) =>
      candidate.normalized_job_no === intake.normalized_job_no &&
      candidate.state === "active",
  );
  const linkWasCorrected =
    link !== undefined &&
    (link.lead_ref !== selectedLead.id || link.lead_model !== selectedLead.model);
  if (link && linkWasCorrected) {
    link.owner_correction = {
      booking_intake_case_id: intake.case_id,
      previous_lead_ref: link.lead_ref,
      previous_lead_model: link.lead_model,
      actor_id: action.actor_id,
      corrected_at: official.book_date,
    };
    link.lead_ref = selectedLead.id;
    link.lead_model = selectedLead.model;
    link.booking_ref = official.booking_id;
  }

  return {
    ...bookingResult,
    decision: {
      ...bookingResult.decision,
      reason:
        "Owner confirmed the Granot Booking Intake Case with official booking details; the Booking was created and queued for its Booking Chain.",
    },
    effects: [
      ...bookingResult.effects,
      {
        kind: "granot_booking_confirmed",
        case_id: intake.case_id,
        booking_id: official.booking_id,
      },
      ...(linkWasCorrected
        ? [
            {
              kind: "granot_record_link_corrected" as const,
              normalized_job_no: intake.normalized_job_no,
              lead_ref: selectedLead.id,
            },
          ]
        : []),
    ],
  };
}

function confirmGranotCancellation(
  world: LifecycleWorld,
  action: ConfirmGranotCancellationAction,
): LifecycleResult {
  if (!action.actor_id.trim() || !action.command_id.trim()) {
    return result(
      world,
      "invalid",
      "Confirm Granot Cancellation requires an owner actor and idempotency key.",
    );
  }
  const intake = world.granot_cancellation_intake_cases.find(
    (candidate) => candidate.case_id === action.cancellation_intake_case_id,
  );
  if (!intake) {
    return result(world, "invalid", "Granot Cancellation Intake Case was not found.");
  }
  if (intake.state !== "open") {
    return result(
      world,
      "already_current",
      "Granot Cancellation Intake Case is no longer open.",
    );
  }
  if (intake.revision !== action.expected_case_revision) {
    return result(
      world,
      "conflict",
      "Granot Cancellation Intake Case changed after the owner opened it; refresh before confirming.",
    );
  }

  const official = action.official_cancellation_details;
  if (!official.cancel_date.trim()) {
    return result(world, "invalid", "Confirm Granot Cancellation requires an official Cancel Date.");
  }
  if (!Number.isFinite(official.refund_amount) || official.refund_amount < 0) {
    return result(
      world,
      "invalid",
      "Confirm Granot Cancellation requires a non-negative official Refund.",
    );
  }

  const booking = world.bookings.find(
    (candidate) => candidate.id === intake.linked_cancellation_booking.booking_ref,
  );
  if (!booking || booking.cancelled) {
    return result(
      world,
      "blocked",
      "Confirm Granot Cancellation requires the current Linked Cancellation Booking to still be eligible.",
    );
  }

  const cancellationResult = recordCancellation(
    world,
    {
      kind: "record_cancellation",
      command_id: action.command_id,
      actor_id: action.actor_id,
      cancellation: {
        id: official.cancellation_id,
        booked_lead: booking.id,
        lead_ref: booking.lead_ref,
        lead_model: booking.lead_model,
        cancel_date: official.cancel_date,
        refund_amount: official.refund_amount,
        reason: official.reason,
        notes: official.notes,
        cancelled_by: official.cancelled_by ?? action.actor_id,
      },
    },
    "ConfirmGranotCancellation",
  );
  if (cancellationResult.decision.outcome !== "applied") return cancellationResult;

  return {
    ...cancellationResult,
    decision: {
      ...cancellationResult.decision,
      reason:
        "Owner confirmed the Granot Cancellation Intake Case with official cancellation details; the Cancellation was created and queued for its Cancellation Chain.",
    },
    effects: [
      ...cancellationResult.effects,
      {
        kind: "granot_cancellation_confirmed",
        case_id: intake.case_id,
        cancellation_id: official.cancellation_id,
      },
    ],
  };
}

function updateGranotBooking(
  world: LifecycleWorld,
  action: UpdateGranotBookingAction,
  catalog: PrototypeCatalog,
): LifecycleResult {
  if (!action.actor_id.trim() || !action.command_id.trim()) {
    return result(
      world,
      "invalid",
      "Update Granot Booking requires an owner actor and idempotency key.",
    );
  }
  const intake = world.granot_cancellation_intake_cases.find(
    (candidate) => candidate.case_id === action.cancellation_intake_case_id,
  );
  if (!intake) {
    return result(world, "invalid", "Granot Cancellation Intake Case was not found.");
  }
  if (intake.state !== "open") {
    return result(
      world,
      "already_current",
      "Granot Cancellation Intake Case is no longer open.",
    );
  }
  if (intake.revision !== action.expected_case_revision) {
    return result(
      world,
      "conflict",
      "Granot Cancellation Intake Case changed after the owner opened it; refresh before updating.",
    );
  }

  const official = action.official_booking_details;
  if (!official.book_date.trim()) {
    return result(world, "invalid", "Update Granot Booking requires an official Book Date.");
  }
  if (
    official.agent_allocations.length === 0 ||
    official.agent_allocations.some(
      (allocation) =>
        !catalog.agents.some((agent) => agent.id === allocation.agent && agent.active),
    )
  ) {
    return result(
      world,
      "invalid",
      "Update Granot Booking requires at least one active Agent Allocation.",
    );
  }
  if (!catalog.merchants.some((merchant) => merchant.name === official.merchant && merchant.active)) {
    return result(
      world,
      "invalid",
      "Update Granot Booking requires an active Merchant with its canonical name.",
    );
  }
  if (official.total_binder_amount < 0 || official.deposit_amount < 0) {
    return result(world, "invalid", "Booking financial amounts cannot be negative.");
  }
  const allocatedBinder = official.agent_allocations.reduce(
    (sum, allocation) => sum + allocation.binder_amount,
    0,
  );
  if (Math.abs(allocatedBinder - official.total_binder_amount) >= 0.001) {
    return result(
      world,
      "invalid",
      "Official Binder must equal the sum of the confirmed Agent Allocations.",
    );
  }

  const booking = world.bookings.find(
    (candidate) => candidate.id === intake.linked_cancellation_booking.booking_ref,
  );
  if (!booking || booking.cancelled) {
    return result(
      world,
      "blocked",
      "Update Granot Booking requires the current Linked Cancellation Booking to still be eligible.",
    );
  }

  const revisionBefore = booking.revision;
  booking.book_date = official.book_date;
  booking.agent_allocations = official.agent_allocations.map((allocation) => ({ ...allocation }));
  booking.total_binder_amount = official.total_binder_amount;
  booking.deposit_amount = official.deposit_amount;
  booking.merchant = official.merchant;
  booking.revision += 1;
  intake.state = "completed";
  intake.resolution_action = "update_booking";
  intake.completed_at = official.book_date;
  intake.revision += 1;
  intake.linked_cancellation_booking = linkedCancellationBooking(booking);
  for (const notification of world.cancellation_intake_notifications) {
    if (notification.cancellation_intake_case_id === intake.case_id) {
      notification.state = "acted";
    }
  }
  const change = entityChange({
    entity: { model: "BookedLead", id: booking.id },
    commandName: "UpdateGranotBooking",
    changedFields: [
      "book_date",
      "agent_allocations",
      "total_binder_amount",
      "deposit_amount",
      "merchant",
    ],
    revisionBefore,
    revisionAfter: booking.revision,
    actorId: action.actor_id,
    sourceSystem: "vantage",
    appliedAt: official.book_date,
    commandId: action.command_id,
  });
  world.entity_changes.push(change);
  return {
    ...result(
      world,
      "applied",
      "Owner updated the existing Vantage Booking for this Job Number; no second Booking and no Cancellation were created.",
      {
        target: { model: "BookedLead", id: booking.id },
        proposed_fields: [
          "book_date",
          "agent_allocations",
          "total_binder_amount",
          "deposit_amount",
          "merchant",
        ],
      },
    ),
    effects: [
      { kind: "entity_change_recorded", change_id: change.change_id },
      {
        kind: "sheet_sync_requested",
        resource: "booking_chain",
        operation: "booking.update",
        entity_id: booking.id,
      },
      {
        kind: "granot_booking_updated",
        case_id: intake.case_id,
        booking_id: booking.id,
      },
    ],
  };
}

function dismissGranotCancellationIntake(
  world: LifecycleWorld,
  action: DismissGranotCancellationIntakeAction,
): LifecycleResult {
  if (!action.actor_id.trim() || !action.command_id.trim()) {
    return result(
      world,
      "invalid",
      "Dismiss Granot Cancellation Intake requires an owner actor and idempotency key.",
    );
  }
  const intake = world.granot_cancellation_intake_cases.find(
    (candidate) => candidate.case_id === action.cancellation_intake_case_id,
  );
  if (!intake) {
    return result(world, "invalid", "Granot Cancellation Intake Case was not found.");
  }
  if (intake.state !== "open") {
    return result(
      world,
      "already_current",
      "Granot Cancellation Intake Case is no longer open.",
    );
  }
  if (intake.revision !== action.expected_case_revision) {
    return result(
      world,
      "conflict",
      "Granot Cancellation Intake Case changed after the owner opened it; refresh before dismissing.",
    );
  }

  intake.state = "dismissed";
  intake.resolution_action = "dismiss";
  intake.completed_at = new Date().toISOString();
  intake.revision += 1;
  for (const notification of world.cancellation_intake_notifications) {
    if (notification.cancellation_intake_case_id === intake.case_id) {
      notification.state = "dismissed";
    }
  }
  return {
    ...result(
      world,
      "applied",
      "Owner dismissed the Granot Cancellation Intake Case without changing the Vantage Booking or creating a Cancellation.",
      {
        target: { model: "BookedLead", id: intake.linked_cancellation_booking.booking_ref },
      },
    ),
    effects: [
      {
        kind: "granot_cancellation_intake_dismissed",
        case_id: intake.case_id,
      },
    ],
  };
}

function recordBooking(
  world: LifecycleWorld,
  action: RecordBookingAction,
  catalog: PrototypeCatalog,
  commandName = "RecordBooking",
): LifecycleResult {
  const input = action.booking;
  const lead = world.leads.find(
    (candidate) => candidate.id === input.lead_ref && candidate.model === input.lead_model,
  );
  if (!lead || lead.duplicate || lead.created_on_unmatched) {
    return result(world, "blocked", "Booking requires an eligible source Lead.");
  }
  if (lead.booked || world.bookings.some((booking) => booking.id === input.id)) {
    return result(world, "already_current", "Lead already has this Booking.", {
      target: { model: "BookedLead", id: input.id },
    });
  }
  const existingJobBooking = world.bookings.find(
    (booking) =>
      normalizeJobNo(booking.job_no) === normalizeJobNo(input.job_no) && !booking.cancelled,
  );
  if (existingJobBooking) {
    return result(
      world,
      "already_current",
      "A Vantage Booking already exists for this Job Number.",
      {
        target: { model: "BookedLead", id: existingJobBooking.id },
      },
    );
  }
  if (
    input.agent_allocations.length === 0 ||
    input.agent_allocations.some(
      (allocation) =>
        !catalog.agents.some(
          (agent) => agent.id === allocation.agent && agent.active,
        ),
    )
  ) {
    return result(world, "invalid", "Booking requires at least one active Agent Allocation.");
  }
  if (!catalog.merchants.some((merchant) => merchant.name === input.merchant && merchant.active)) {
    return result(world, "invalid", "Booking requires an active Merchant with its canonical name.");
  }
  if (input.total_binder_amount < 0 || input.deposit_amount < 0) {
    return result(world, "invalid", "Booking financial amounts cannot be negative.");
  }
  const allocatedBinder = input.agent_allocations.reduce(
    (sum, allocation) => sum + allocation.binder_amount,
    0,
  );
  if (Math.abs(allocatedBinder - input.total_binder_amount) >= 0.001) {
    return result(
      world,
      "invalid",
      "Official Binder must equal the sum of the confirmed Agent Allocations.",
    );
  }
  if (!input.book_date.trim()) {
    return result(world, "invalid", "Booking requires an official Book Date.");
  }

  world.bookings.push({ ...input, revision: 1 });
  const leadRevisionBefore = lead.revision;
  lead.booked = input.id;
  lead.revision += 1;
  const leadChange = entityChange({
    entity: { model: lead.model, id: lead.id },
    commandName,
    changedFields: ["booked"],
    revisionBefore: leadRevisionBefore,
    revisionAfter: lead.revision,
    actorId: action.actor_id,
    sourceSystem: "vantage",
    appliedAt: input.book_date,
    commandId: action.command_id,
  });
  world.entity_changes.push(leadChange);
  const link = world.granot_record_links.find(
    (candidate) => candidate.lead_ref === lead.id && candidate.state === "active",
  );
  if (link) link.booking_ref = input.id;
  completeGranotBookingIntakes(world, input);
  for (const signal of world.granot_booking_discrepancies) {
    if (signal.lead_ref === lead.id && signal.state === "open") signal.state = "dismissed";
  }
  return {
    ...result(world, "applied", "Vantage Booking was recorded and attached to the Lead.", {
      target: { model: "BookedLead", id: input.id },
      proposed_fields: ["booked"],
    }),
    effects: [
      { kind: "entity_change_recorded", change_id: leadChange.change_id },
      {
        kind: "sheet_sync_requested",
        resource: "booking_chain",
        operation: "booking.create",
        entity_id: input.id,
      },
    ],
  };
}

function recordCancellation(
  world: LifecycleWorld,
  action: RecordCancellationAction,
  commandName = "RecordCancellation",
): LifecycleResult {
  const input = action.cancellation;
  const booking = world.bookings.find((candidate) => candidate.id === input.booked_lead);
  if (!booking) return result(world, "invalid", "Cancellation requires an existing Booking.");
  if (booking.cancelled) {
    return result(world, "already_current", "Booking is already cancelled.", {
      target: { model: "BookedLead", id: booking.id },
    });
  }
  const lead = world.leads.find(
    (candidate) => candidate.id === booking.lead_ref && candidate.model === booking.lead_model,
  );
  if (!lead) return result(world, "conflict", "Booking source Lead is missing.");
  if (!input.cancel_date.trim()) {
    return result(world, "invalid", "Cancellation requires an official Cancel Date.");
  }
  if (!Number.isFinite(input.refund_amount) || input.refund_amount < 0) {
    return result(world, "invalid", "Cancellation refund amount cannot be negative.");
  }

  world.cancellations.push(input);
  booking.cancelled = input.id;
  booking.revision += 1;
  const revisionBefore = lead.revision;
  lead.cancelled = input.id;
  lead.revision += 1;
  const change = entityChange({
    entity: { model: lead.model, id: lead.id },
    commandName,
    changedFields: ["cancelled"],
    revisionBefore,
    revisionAfter: lead.revision,
    actorId: action.actor_id,
    sourceSystem: "vantage",
    appliedAt: input.cancel_date,
    commandId: action.command_id,
  });
  world.entity_changes.push(change);
  completeGranotCancellationIntakes(world, input);
  return {
    ...result(
      world,
      "applied",
      "Cancellation was recorded; the Lead remains Booked and is now Cancelled.",
      {
        target: { model: "BookedLead", id: booking.id },
        proposed_fields: ["cancelled"],
      },
    ),
    effects: [
      { kind: "entity_change_recorded", change_id: change.change_id },
      {
        kind: "sheet_sync_requested",
        resource: "cancellation_chain",
        operation: "cancellation.create",
        entity_id: input.id,
      },
    ],
  };
}

function establishOrRefreshLink(
  world: LifecycleWorld,
  observation: NormalizedGranotObservation,
  lead: LeadSnapshot,
): { established: boolean; value: GranotRecordLink } {
  const existing = world.granot_record_links.find(
    (link) => link.normalized_job_no === observation.normalized_job_no,
  );
  if (existing) {
    existing.last_observed_at = observation.observed_at;
    return { established: false, value: existing };
  }
  const value: GranotRecordLink = {
    normalized_job_no: observation.normalized_job_no,
    lead_ref: lead.id,
    lead_model: lead.model,
    state: "active",
    established_by_observation_id: observation.observation_id,
    last_observed_at: observation.observed_at,
  };
  world.granot_record_links.push(value);
  return { established: true, value };
}

function openOrRefreshGranotBookingIntake(
  world: LifecycleWorld,
  lead: LeadSnapshot,
  matchMethod: SuggestedBookingLead["match_method"],
  sourceScope: SourceScope,
  observation: NormalizedGranotObservation,
  catalog: PrototypeCatalog,
  effects: LifecycleEffect[],
): GranotBookingIntakeCase {
  const caseId = `granot-booking-intake:${observation.normalized_job_no}`;
  const existing = world.granot_booking_intake_cases.find(
    (candidate) => candidate.case_id === caseId && candidate.state === "open",
  );
  if (existing) {
    const nextContext = observedBookingContext(observation);
    if (JSON.stringify(existing.observed) !== JSON.stringify(nextContext)) {
      existing.observed = nextContext;
      existing.revision += 1;
    }
    existing.last_observation_id = observation.observation_id;
    return existing;
  }

  const suggestedAgentMatches = observation.assigned_username
    ? catalog.agents.filter(
        (agent) =>
          agent.active &&
          agent.granot_crm_username === observation.assigned_username,
      )
    : [];
  const intake: GranotBookingIntakeCase = {
    case_id: caseId,
    normalized_job_no: observation.normalized_job_no,
    state: "open",
    revision: 1,
    opened_by_observation_id: observation.observation_id,
    last_observation_id: observation.observation_id,
    source_scope: { ...sourceScope },
    observed: observedBookingContext(observation),
    suggested_booking_lead: {
      lead_ref: lead.id,
      lead_model: lead.model,
      confidence:
        matchMethod === "source_scoped_contact" ? "medium" : "high",
      match_method: matchMethod,
      display: {
        name: lead.name,
        phone_number: lead.phone_number,
        email: lead.email,
        source_granularity_key: lead.source_granularity_key,
      },
    },
    suggested_agent:
      suggestedAgentMatches.length === 1
        ? {
            agent_id: suggestedAgentMatches[0].id,
            agent_name: suggestedAgentMatches[0].name,
            evidence: `Granot user ${observation.assigned_username}`,
          }
        : undefined,
    opened_at: observation.observed_at,
  };
  world.granot_booking_intake_cases.push(intake);
  effects.push({ kind: "granot_booking_intake_opened", case_id: caseId });

  const dashboardNotification: BookingIntakeNotification = {
    notification_id: `booking-intake-notification:dashboard:${caseId}`,
    booking_intake_case_id: caseId,
    channel: "dashboard",
    state: "visible",
    dedupe_key: `booking-intake:${caseId}:dashboard`,
    created_at: observation.observed_at,
  };
  world.booking_intake_notifications.push(dashboardNotification);
  effects.push({
    kind: "booking_intake_notification_requested",
    case_id: caseId,
    channel: "dashboard",
  });

  if (catalog.booking_intake_email_enabled) {
    world.booking_intake_notifications.push({
      notification_id: `booking-intake-notification:email:${caseId}`,
      booking_intake_case_id: caseId,
      channel: "email",
      state: "queued",
      dedupe_key: `booking-intake:${caseId}:email`,
      created_at: observation.observed_at,
    });
    effects.push({
      kind: "booking_intake_notification_requested",
      case_id: caseId,
      channel: "email",
    });
  }
  return intake;
}

function observedBookingContext(
  observation: NormalizedGranotObservation,
): GranotBookingIntakeCase["observed"] {
  return {
    job_no: observation.job_no,
    service_type: observation.service_type,
    first_name: observation.first_name,
    last_name: observation.last_name,
    phone_number: observation.phone_number,
    email: observation.email,
    move_date: observation.move_date,
    estimated_cubic_feet: observation.estimated_cubic_feet,
    estimate: observation.estimate,
    assigned_username: observation.assigned_username,
  };
}

function completeGranotBookingIntakes(
  world: LifecycleWorld,
  booking: Omit<BookingSnapshot, "revision" | "cancelled">,
): void {
  for (const intake of world.granot_booking_intake_cases) {
    if (
      intake.state === "open" &&
      intake.normalized_job_no === normalizeJobNo(booking.job_no)
    ) {
      intake.state = "completed";
      intake.selected_booking_lead = {
        lead_ref: booking.lead_ref,
        lead_model: booking.lead_model,
      };
      intake.booking_ref = booking.id;
      intake.completed_at = booking.book_date;
      intake.revision += 1;
      for (const notification of world.booking_intake_notifications) {
        if (notification.booking_intake_case_id === intake.case_id) {
          notification.state = "acted";
        }
      }
    }
  }
}

function resolveLinkedCancellationBooking(
  world: LifecycleWorld,
  lead: LeadSnapshot,
  observation: NormalizedGranotObservation,
):
  | { kind: "found"; booking: BookingSnapshot }
  | { kind: "missing" }
  | { kind: "conflict" } {
  const link = world.granot_record_links.find(
    (candidate) =>
      candidate.normalized_job_no === observation.normalized_job_no &&
      candidate.state === "active",
  );
  const leadBooking = lead.booked
    ? world.bookings.find((booking) => booking.id === lead.booked)
    : undefined;
  const jobBookings = world.bookings.filter(
    (booking) => normalizeJobNo(booking.job_no) === observation.normalized_job_no,
  );
  const linkedBooking = link?.booking_ref
    ? world.bookings.find((booking) => booking.id === link.booking_ref)
    : undefined;

  if (link && (link.lead_ref !== lead.id || link.lead_model !== lead.model)) {
    return { kind: "conflict" };
  }
  if (linkedBooking && leadBooking && linkedBooking.id !== leadBooking.id) {
    return { kind: "conflict" };
  }
  if (jobBookings.length > 1) {
    return { kind: "conflict" };
  }
  if (
    jobBookings.length === 1 &&
    leadBooking &&
    jobBookings[0].id !== leadBooking.id
  ) {
    return { kind: "conflict" };
  }
  if (
    jobBookings.length === 1 &&
    linkedBooking &&
    jobBookings[0].id !== linkedBooking.id
  ) {
    return { kind: "conflict" };
  }

  const booking = leadBooking ?? linkedBooking ?? jobBookings[0];
  return booking ? { kind: "found", booking } : { kind: "missing" };
}

function openOrRefreshGranotCancellationIntake(
  world: LifecycleWorld,
  _lead: LeadSnapshot,
  booking: BookingSnapshot,
  sourceScope: SourceScope,
  observation: NormalizedGranotObservation,
  catalog: PrototypeCatalog,
  effects: LifecycleEffect[],
): GranotCancellationIntakeCase {
  const caseId = `granot-cancellation-intake:${observation.normalized_job_no}`;
  const existing = world.granot_cancellation_intake_cases.find(
    (candidate) => candidate.case_id === caseId,
  );
  const nextObserved = observedReleaseContext(observation);
  const nextLinked = linkedCancellationBooking(booking);
  const offeredOwnerPaths: GranotReleaseOwnerPath[] = [
    "confirm_cancellation",
    "update_booking",
  ];
  if (existing?.state === "open") {
    const contextChanged =
      JSON.stringify(existing.observed) !== JSON.stringify(nextObserved) ||
      JSON.stringify(existing.linked_cancellation_booking) !==
        JSON.stringify(nextLinked);
    if (contextChanged) existing.revision += 1;
    existing.observed = nextObserved;
    existing.linked_cancellation_booking = nextLinked;
    existing.last_observation_id = observation.observation_id;
    existing.offered_owner_paths = offeredOwnerPaths;
    return existing;
  }
  if (existing) {
    existing.state = "open";
    existing.revision += 1;
    existing.observed = nextObserved;
    existing.linked_cancellation_booking = nextLinked;
    existing.last_observation_id = observation.observation_id;
    existing.offered_owner_paths = offeredOwnerPaths;
    existing.resolution_action = undefined;
    existing.cancellation_ref = undefined;
    existing.completed_at = undefined;
    existing.opened_at = observation.observed_at;
    reopenCancellationIntakeNotifications(world, existing, observation, catalog, effects);
    effects.push({ kind: "granot_cancellation_intake_reopened", case_id: caseId });
    return existing;
  }

  const intake: GranotCancellationIntakeCase = {
    case_id: caseId,
    normalized_job_no: observation.normalized_job_no,
    state: "open",
    revision: 1,
    opened_by_observation_id: observation.observation_id,
    last_observation_id: observation.observation_id,
    source_scope: { ...sourceScope },
    linked_cancellation_booking: nextLinked,
    offered_owner_paths: offeredOwnerPaths,
    observed: nextObserved,
    opened_at: observation.observed_at,
  };
  world.granot_cancellation_intake_cases.push(intake);
  effects.push({ kind: "granot_cancellation_intake_opened", case_id: caseId });
  queueCancellationIntakeNotifications(world, intake, observation, catalog, effects);
  return intake;
}

function queueCancellationIntakeNotifications(
  world: LifecycleWorld,
  intake: GranotCancellationIntakeCase,
  observation: NormalizedGranotObservation,
  catalog: PrototypeCatalog,
  effects: LifecycleEffect[],
): void {
  const caseId = intake.case_id;
  if (
    !world.cancellation_intake_notifications.some(
      (notification) => notification.dedupe_key === `cancellation-intake:${caseId}:dashboard`,
    )
  ) {
    world.cancellation_intake_notifications.push({
      notification_id: `cancellation-intake-notification:dashboard:${caseId}`,
      cancellation_intake_case_id: caseId,
      channel: "dashboard",
      state: "visible",
      dedupe_key: `cancellation-intake:${caseId}:dashboard`,
      created_at: observation.observed_at,
    });
    effects.push({
      kind: "cancellation_intake_notification_requested",
      case_id: caseId,
      channel: "dashboard",
    });
  }

  if (
    catalog.cancellation_intake_email_enabled &&
    !world.cancellation_intake_notifications.some(
      (notification) => notification.dedupe_key === `cancellation-intake:${caseId}:email`,
    )
  ) {
    world.cancellation_intake_notifications.push({
      notification_id: `cancellation-intake-notification:email:${caseId}`,
      cancellation_intake_case_id: caseId,
      channel: "email",
      state: "queued",
      dedupe_key: `cancellation-intake:${caseId}:email`,
      created_at: observation.observed_at,
    });
    effects.push({
      kind: "cancellation_intake_notification_requested",
      case_id: caseId,
      channel: "email",
    });
  }
}

function reopenCancellationIntakeNotifications(
  world: LifecycleWorld,
  intake: GranotCancellationIntakeCase,
  observation: NormalizedGranotObservation,
  catalog: PrototypeCatalog,
  effects: LifecycleEffect[],
): void {
  let restored = false;
  for (const notification of world.cancellation_intake_notifications) {
    if (notification.cancellation_intake_case_id !== intake.case_id) continue;
    notification.state = notification.channel === "email" ? "queued" : "visible";
    restored = true;
  }
  if (!restored) {
    queueCancellationIntakeNotifications(world, intake, observation, catalog, effects);
  }
}

function observedReleaseContext(
  observation: NormalizedGranotObservation,
): GranotCancellationIntakeCase["observed"] {
  return {
    job_no: observation.job_no,
    raw_booking_status: observation.raw_booking_status ?? observation.provider_event_type ?? "",
    granot_priority: observation.granot_priority,
    payment: observation.payment,
    balance: observation.balance,
    estimate: observation.estimate,
    first_name: observation.first_name,
    last_name: observation.last_name,
    assigned_username: observation.assigned_username,
  };
}

function linkedCancellationBooking(booking: BookingSnapshot): LinkedCancellationBooking {
  return {
    booking_ref: booking.id,
    lead_ref: booking.lead_ref,
    lead_model: booking.lead_model,
    job_no: booking.job_no,
    book_date: booking.book_date,
    deposit_amount: booking.deposit_amount,
    merchant: booking.merchant,
    source: booking.source,
  };
}

function openGranotCancellationDiscrepancy(
  world: LifecycleWorld,
  lead: LeadSnapshot,
  observation: NormalizedGranotObservation,
  reason: GranotCancellationDiscrepancy["reason"],
  effects: LifecycleEffect[],
): { discrepancy: GranotCancellationDiscrepancy; opened: boolean } {
  const key = `granot-cancellation-discrepancy:${observation.normalized_job_no}:${reason}`;
  const existing = world.granot_cancellation_discrepancies.find(
    (candidate) => candidate.key === key,
  );
  if (existing) {
    existing.observation_id = observation.observation_id;
    return { discrepancy: existing, opened: false };
  }
  const discrepancy: GranotCancellationDiscrepancy = {
    key,
    lead_ref: lead.id,
    lead_model: lead.model,
    normalized_job_no: observation.normalized_job_no,
    reason,
    observation_id: observation.observation_id,
    state: "open",
  };
  world.granot_cancellation_discrepancies.push(discrepancy);
  effects.push({ kind: "granot_cancellation_discrepancy_opened", key });
  return { discrepancy, opened: true };
}

function refreshOpenCancellationIntake(
  world: LifecycleWorld,
  observation: NormalizedGranotObservation,
  booking: BookingSnapshot,
): void {
  const intake = world.granot_cancellation_intake_cases.find(
    (candidate) =>
      candidate.normalized_job_no === observation.normalized_job_no &&
      candidate.state === "open" &&
      candidate.linked_cancellation_booking.booking_ref === booking.id,
  );
  if (!intake) return;
  intake.last_observation_id = observation.observation_id;
  intake.observed = observedReleaseContext(observation);
  intake.linked_cancellation_booking = linkedCancellationBooking(booking);
}

function refreshCompletedCancellationIntake(
  world: LifecycleWorld,
  observation: NormalizedGranotObservation,
  booking: BookingSnapshot,
): void {
  const intake = world.granot_cancellation_intake_cases.find(
    (candidate) =>
      candidate.normalized_job_no === observation.normalized_job_no &&
      candidate.linked_cancellation_booking.booking_ref === booking.id,
  );
  if (!intake) return;
  intake.last_observation_id = observation.observation_id;
  intake.observed = observedReleaseContext(observation);
}

function completeGranotCancellationIntakes(
  world: LifecycleWorld,
  cancellation: CancellationSnapshot,
): void {
  for (const intake of world.granot_cancellation_intake_cases) {
    if (
      intake.state === "open" &&
      intake.linked_cancellation_booking.booking_ref === cancellation.booked_lead
    ) {
      intake.state = "completed";
      intake.resolution_action = "confirm_cancellation";
      intake.cancellation_ref = cancellation.id;
      intake.completed_at = cancellation.cancel_date;
      intake.revision += 1;
      for (const notification of world.cancellation_intake_notifications) {
        if (notification.cancellation_intake_case_id === intake.case_id) {
          notification.state = "acted";
        }
      }
    }
  }
}

function isGranotReleaseEventType(rawStatus: string): boolean {
  const normalized = rawStatus.trim().toLowerCase();
  return normalized === "releas" || normalized === "release";
}

function isStaleGranotObservation(
  world: LifecycleWorld,
  lead: LeadSnapshot,
  observation: NormalizedGranotObservation,
): boolean {
  if (!observation.occurred_at) return false;
  const occurredAt = Date.parse(observation.occurred_at);
  if (Number.isNaN(occurredAt)) return false;
  const latestComparableChange = world.entity_changes
    .filter(
      (change) =>
        change.entity.model === lead.model &&
        change.entity.id === lead.id &&
        change.provenance.source_system === "granot" &&
        change.provenance.occurred_at,
    )
    .map((change) => Date.parse(change.provenance.occurred_at!))
    .filter((value) => !Number.isNaN(value))
    .sort((left, right) => right - left)[0];
  return latestComparableChange !== undefined && occurredAt < latestComparableChange;
}

function entityChange(input: {
  entity: EntityChange["entity"];
  commandName: string;
  changedFields: string[];
  revisionBefore: number;
  revisionAfter: number;
  actorId: string;
  actorType?: "system" | "owner";
  sourceSystem: "granot" | "vantage";
  observationChannel?: ObservationChannel;
  receiptId?: string;
  observationId?: string;
  occurredAt?: string;
  appliedAt: string;
  commandId?: string;
}): EntityChange {
  const commandId =
    input.commandId ?? `command:${input.observationId ?? input.appliedAt}`;
  return {
    change_id: `change:${commandId}:${input.entity.model}:${input.entity.id}:${input.revisionAfter}`,
    entity: input.entity,
    command_name: input.commandName,
    changed_fields: [...input.changedFields].sort(),
    revision_before: input.revisionBefore,
    revision_after: input.revisionAfter,
    provenance: {
      source_system: input.sourceSystem,
      observation_channel: input.observationChannel,
      actor_type: input.actorType ?? (input.sourceSystem === "granot" ? "system" : "owner"),
      actor_id: input.actorId,
      receipt_id: input.receiptId,
      observation_id: input.observationId,
      command_id: commandId,
      occurred_at: input.occurredAt,
    },
    applied_at: input.appliedAt,
  };
}

function result(
  world: LifecycleWorld,
  outcome: SynchronizationDecisionOutcome,
  reason: string,
  details: Partial<LifecycleResult["decision"]> = {},
): LifecycleResult {
  return {
    world,
    decision: {
      outcome,
      reason,
      proposed_fields: [],
      warnings: [],
      ...details,
    },
    effects: [],
  };
}

function leadBelongsToSource(lead: LeadSnapshot, source: SourceScope): boolean {
  return (
    lead.source_company === source.source_company &&
    lead.source_granularity_key === source.source_granularity_key
  );
}

function fillMissing<K extends keyof LeadSnapshot>(
  patch: Partial<LeadSnapshot>,
  field: K,
  current: LeadSnapshot[K],
  observed: LeadSnapshot[K],
): void {
  if ((current === undefined || current === "" || current === "not_found") && observed) {
    patch[field] = observed;
  }
}

function clean(value: string | undefined): string | undefined {
  return value?.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim() || undefined;
}

function normalizePhone(value: string | undefined): string | undefined {
  const digits = value?.replace(/\D/g, "");
  return digits ? digits.slice(-10) : undefined;
}

function normalizeJobNo(value: string | undefined): string {
  return clean(value)?.replace(/\s+/g, "").toLowerCase() ?? "";
}

function parseNonNegativeNumber(value: string | undefined): number | undefined {
  const normalized = clean(value)?.replace(/[$,]/g, "");
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}
