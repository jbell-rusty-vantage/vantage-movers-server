import type {
  GranotWebhookReceiptInput,
  LifecycleWorld,
  PrototypeCatalog,
} from "./domain";

/**
 * Real Vantage/Granot/RingCentral/Agent/Merchant names; deliberately fake IDs
 * and contact values. This prototype never connects to live systems.
 */
export const PROTOTYPE_CATALOG: PrototypeCatalog = {
  booking_intake_email_enabled: true,
  cancellation_intake_email_enabled: true,
  sources: [
    {
      granot_label: "Top10 Forms",
      source_company: "top10_leads",
      source_granularity_key: "top10_leads_form",
      channel: "form",
    },
    {
      granot_label: "Top10 Inbounds",
      source_company: "top10_leads",
      source_granularity_key: "top10_leads_call",
      channel: "call",
    },
    {
      granot_label: "10best Inbounds",
      source_company: "tbm_leads",
      source_granularity_key: "tbm_leads_call",
      channel: "call",
    },
    {
      granot_label: "TBM Forms",
      source_company: "tbm_leads",
      source_granularity_key: "tbm_leads_form",
      channel: "form",
    },
    {
      granot_label: "BestRelocation Inbounds",
      source_company: "best_relocation_leads",
      source_granularity_key: "best_relocation_leads_call",
      channel: "call",
    },
  ],
  agents: [
    {
      id: "agent-mike",
      name: "Mike",
      granot_crm_username: "MIKEM",
      active: true,
    },
    {
      id: "agent-austin",
      name: "Austin",
      granot_crm_username: "AUSTIN",
      active: true,
    },
    {
      id: "agent-roys",
      name: "Roys",
      granot_crm_username: "ROY",
      active: true,
    },
  ],
  merchants: [
    { name: "Cardpointe", active: true },
    { name: "Elavon", active: true },
  ],
};

export function emptyWorld(): LifecycleWorld {
  return {
    leads: [],
    bookings: [],
    cancellations: [],
    granot_record_links: [],
    entity_changes: [],
    granot_booking_intake_cases: [],
    booking_intake_notifications: [],
    granot_booking_discrepancies: [],
    granot_cancellation_intake_cases: [],
    cancellation_intake_notifications: [],
    granot_cancellation_discrepancies: [],
    processed_receipt_ids: [],
  };
}

export function worldWithTop10FormLead(): LifecycleWorld {
  const world = emptyWorld();
  world.leads.push({
    id: "form-lead-top10-001",
    model: "FormLead",
    source_company: "top10_leads",
    source_granularity_key: "top10_leads_form",
    duplicate: false,
    ref_no: "DT_PROTOTYPE_TOP10_001",
    normalized_phone_number: "5550101001",
    email: "prototype.form@example.invalid",
    quoted: false,
    revision: 1,
  });
  return world;
}

export function worldWithTop10CallLead(): LifecycleWorld {
  const world = emptyWorld();
  world.leads.push({
    id: "call-lead-top10-001",
    model: "CallLead",
    source_company: "top10_leads",
    source_granularity_key: "top10_leads_call",
    duplicate: false,
    normalized_phone_number: "5550102001",
    revision: 1,
  });
  return world;
}

export function worldWithBestRelocationBookingCandidates(): LifecycleWorld {
  const world = emptyWorld();
  world.leads.push(
    {
      id: "call-lead-best-relocation-suggested",
      model: "CallLead",
      source_company: "best_relocation_leads",
      source_granularity_key: "best_relocation_leads_call",
      duplicate: false,
      name: "Sara Example",
      phone_number: "(555) 010-2372",
      normalized_phone_number: "5550102372",
      email: "sara.booking@example.test",
      revision: 1,
    },
    {
      id: "call-lead-best-relocation-alternative",
      model: "CallLead",
      source_company: "best_relocation_leads",
      source_granularity_key: "best_relocation_leads_call",
      duplicate: false,
      name: "Sara Alternate",
      phone_number: "(555) 010-8899",
      normalized_phone_number: "5550108899",
      revision: 1,
    },
  );
  return world;
}

export function top10FormReceipt(input: {
  receipt_id: string;
  route_event_type: GranotWebhookReceiptInput["route_event_type"];
  priority?: string;
  event_type?: string;
  occurred_at?: string;
}): GranotWebhookReceiptInput {
  return {
    receipt_id: input.receipt_id,
    route_event_type: input.route_event_type,
    received_at: `2026-08-13T16:${input.receipt_id.slice(-2).padStart(2, "0")}:00.000Z`,
    occurred_at: input.occurred_at,
    payload: {
      event_type:
        input.event_type ??
        (input.route_event_type === "lead_created"
          ? "lead_created"
          : input.route_event_type === "priority_updated"
            ? "priority_update"
            : "Booked"),
      source: "Top10 Forms",
      job_no: "P-PROTOTYPE-FORM-001",
      ref_no: "DT_PROTOTYPE_TOP10_001",
      phone_number: "+1 (555) 010-1001",
      email: "prototype.form@example.invalid",
      priority: input.priority,
      est_cf: "1250",
      from_city: "Miami",
      from_state: "FL",
      from_zip: "33101",
      to_city: "Orlando",
      to_state: "FL",
      to_zip: "32801",
      user: "MIKEM",
    },
  };
}

export function top10InboundReceipt(input: {
  receipt_id: string;
  route_event_type: GranotWebhookReceiptInput["route_event_type"];
  priority?: string;
}): GranotWebhookReceiptInput {
  return {
    receipt_id: input.receipt_id,
    route_event_type: input.route_event_type,
    received_at: `2026-08-13T17:${input.receipt_id.slice(-2).padStart(2, "0")}:00.000Z`,
    payload: {
      event_type:
        input.route_event_type === "lead_created"
          ? "lead_created"
          : "priority_update",
      source: "Top10 Inbounds",
      job_no: "P-PROTOTYPE-CALL-001",
      phone_number: "+1 (555) 010-2001",
      priority: input.priority,
      est_cf: "900",
      from_city: "Tampa",
      from_state: "FL",
      from_zip: "33602",
      to_city: "Atlanta",
      to_state: "GA",
      to_zip: "30303",
      user: "AUSTIN",
    },
  };
}

/**
 * Shape mirrors the supplied Priority 5 example. Customer identifiers are
 * deliberately replaced with prototype-only values.
 */
export function bestRelocationPriorityFiveReceipt(
  receiptId: string,
): GranotWebhookReceiptInput {
  return {
    receipt_id: receiptId,
    route_event_type: "priority_updated",
    received_at: "2026-08-13T18:30:00.000Z",
    payload: {
      event_type: "priority_update",
      job_no: "PROTO-5562372",
      service_type: "Long Distance",
      source: "BestRelocation Inbounds",
      ref_no: "",
      priority: "5",
      user: "ROY",
      rep: "ROY",
      first_name: "Sara",
      last_name: "Example",
      phone_number: "(555) 010-2372",
      email: "sara.booking@example.test",
      move_date: "08/28/2026",
      est_cf: "390",
      from_city: "Owens Cross Roads",
      from_state: "AL",
      from_zip: "35763",
      to_city: "Walnut Creek",
      to_state: "CA",
      to_zip: "94597",
      estimate: "2400.00",
    },
  };
}

/**
 * Shape mirrors a captured booking-status snapshot. Customer identifiers are
 * prototype-only. Granot names the CRM button `Release`; captured payloads
 * truncate it to `Releas`. Both spellings are the same Granot Booking Action.
 */
export function bestRelocationBookingStatusReceipt(input: {
  receipt_id: string;
  event_type: "Booked" | "Releas" | "Release";
  priority?: string;
}): GranotWebhookReceiptInput {
  return {
    receipt_id: input.receipt_id,
    route_event_type: "booking_status_changed",
    received_at: "2026-08-13T19:15:00.000Z",
    payload: {
      event_type: input.event_type,
      job_no: "PROTO-5562372",
      service_type: "Long Distance",
      source: "BestRelocation Inbounds",
      ref_no: "",
      priority: input.priority ?? "0",
      user: "ROY",
      rep: "ROY",
      first_name: "Sara",
      last_name: "Example",
      phone_number: "(555) 010-2372",
      email: "sara.booking@example.test",
      move_date: "08/28/2026",
      est_cf: "390",
      from_city: "Owens Cross Roads",
      from_state: "AL",
      from_zip: "35763",
      to_city: "Walnut Creek",
      to_state: "CA",
      to_zip: "94597",
      estimate: "2400.00",
      payment: "646.40",
      balance: "1753.60",
    },
  };
}
