export const SUCCESSFUL_LEAD_MESSAGE_STATUSES = [
  "accepted",
  "sent",
  "delivered",
] as const;

export type SuccessfulLeadMessageStatus =
  (typeof SUCCESSFUL_LEAD_MESSAGE_STATUSES)[number];

export const GRANOT_SEARCH_EVENT_CLASSES = [
  "lead_created",
  "priority_updated",
  "booking_status_changed",
] as const;

export type GranotSearchEventClass =
  (typeof GRANOT_SEARCH_EVENT_CLASSES)[number];

export const BOOKING_ACTION_EVENT_TYPES = ["Booked", "Releas"] as const;

export type BookingActionEventType = (typeof BOOKING_ACTION_EVENT_TYPES)[number];

export type ConversionRate = {
  numerator: number;
  denominator: number;
  rate: number;
  percent: number;
};

export type ConversionSlice = {
  key: string;
  leads: number;
  booked: number;
  cancelled: number;
  booked_of_leads: ConversionRate;
  cancelled_of_leads: ConversionRate;
};

export type ConversionReport = {
  sms_successfully_sent_then_booked: ConversionSlice;
  sms_by_origin: ConversionSlice[];
  received_by_agent: ConversionSlice;
  received_by_agent_by_lead_model: ConversionSlice[];
  notes: string[];
};

export type SuccessfulSmsLeadRow = {
  lead_id: string;
  origin: string;
  booked: boolean;
  cancelled: boolean;
};

export type ReceivedLeadRow = {
  lead_id: string;
  lead_model: "FormLead" | "CallLead";
  booked: boolean;
  cancelled: boolean;
};

export type GranotSearchQuery = {
  job_no: string;
  event_class?: GranotSearchEventClass;
  booking_action_event_type?: BookingActionEventType;
};

export type SearchObservationRow = {
  id: string;
  captured_at: string;
  normalized_job_no?: string;
  route_event_class?: string;
  payload_event_type_raw?: string;
  booking_action_raw?: string;
  booking_action_normalized?: string;
  priority_canonical?: string;
  normalization_result?: string;
};

export type SearchDecisionRow = {
  id: string;
  observation_id: string;
  attempt: number;
  outcome: string;
  reason_code: string;
  execution_mode: string;
  decided_at: string;
};

export type SearchCommandRow = {
  id: string;
  command_name: string;
  observation_id: string;
  applied_at: string;
  entity_models: string[];
};

export type GranotSearchCatalog = {
  observations: SearchObservationRow[];
  decisions: SearchDecisionRow[];
  commands: SearchCommandRow[];
};

export type GranotSearchHit = {
  observation: SearchObservationRow;
  latest_decision: SearchDecisionRow | null;
  commands: SearchCommandRow[];
};

export type TimelineSearchSeed = {
  normalized_job_no: string;
  observation_ids: string[];
  command_ids: string[];
  event_class: GranotSearchEventClass | null;
  booking_action_event_type: BookingActionEventType | null;
};

export type GranotSearchPage = {
  query: {
    raw_job_no: string;
    normalized_job_no: string;
    event_class: GranotSearchEventClass | null;
    booking_action_event_type: BookingActionEventType | null;
  };
  hits: GranotSearchHit[];
  timeline_seed: TimelineSearchSeed;
};
