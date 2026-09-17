import type { EndpointKind } from "./phone";

export type InteractionDirection = "Inbound" | "Outbound" | "Internal" | "Unknown";
export type PartyDirection = "Inbound" | "Outbound" | null;
export type PartyRole =
  | "external"
  | "user"
  | "queue"
  | "ivr"
  | "voicemail"
  | "monitoring"
  | "unknown";
export type IdentityBasis = "telephony_session_id" | "session_id" | "call_log_id";
export type AliasKind = IdentityBasis;
export type ContactType = "unknown" | "voicemail" | "human_conversation";
export type CaptureSource = "webhook" | "call_log_reconcile" | "backfill";

export type ProjectedParty = {
  party_id: string | null;
  last_webhook_sequence: number | null;
  last_event_at: Date | null;
  role: PartyRole;
  direction: PartyDirection;
  extension_id: string | null;
  extension_number: string | null;
  phone_number_raw: string | null;
  e164: string | null;
  name_raw: string | null;
  connected: boolean;
  answered_at: Date | null;
  terminal_at: Date | null;
  terminal_status: string | null;
};

export type ProjectedLeg = {
  call_log_id: string | null;
  leg_type: string | null;
  direction: string | null;
  result: string | null;
  start_time: Date | null;
  duration_seconds: number | null;
  extension_id: string | null;
  transfer_target_session_id: string | null;
  recording_id: string | null;
};

export type ProjectedRecording = {
  provider_recording_id: string;
  recording_type: string | null;
  observed_at: Date;
  lead_conversation_id: string | null;
};

/**
 * Pure projection of one canonical Call Interaction. Storage adds `_id`,
 * `contact_number_id`, `projection_revision`, `first_observed_at`,
 * `last_observed_at` and `merged_into_id`; those are not projection facts.
 */
export type InteractionProjection = {
  provider: "ringcentral";
  provider_account_id: string;
  telephony_session_id: string | null;
  session_id: string | null;
  call_log_ids: string[];
  identity_basis: IdentityBasis;
  direction: InteractionDirection;
  external_e164: string | null;
  external_endpoint_kind: EndpointKind | null;
  company_e164: string | null;
  inbound_route_id: string | null;
  started_at: Date;
  answered_at: Date | null;
  ended_at: Date | null;
  duration_seconds: number | null;
  provider_result: string | null;
  provider_connected: boolean;
  contact_type: ContactType;
  contact_type_basis: string | null;
  parties: ProjectedParty[];
  legs: ProjectedLeg[];
  legs_overflow_count: number;
  connected_user_extension_ids: string[];
  queue_fanout: boolean;
  transfer: boolean;
  monitoring: boolean;
  recordings: ProjectedRecording[];
  sources: CaptureSource[];
  provider_last_modified_at: Date | null;
  terminal: boolean;
  max_observed_webhook_sequence: number | null;
};

/** One normalized party event from an account telephony-session webhook delivery. */
export type WebhookPartyObservation = {
  webhook_uuid: string | null;
  subscription_id: string | null;
  event_path: string | null;
  event_time: Date | null;
  received_at: Date;
  sequence: number | null;
  account_id: string | null;
  telephony_session_id: string;
  session_id: string | null;
  party_id: string;
  extension_id: string | null;
  direction: string | null;
  status_code: string | null;
  call_started_at: Date | null;
  from: WebhookEndpoint;
  to: WebhookEndpoint;
  queue_call: boolean | null;
  missed_call: boolean | null;
  stand_alone: boolean | null;
  recordings: Array<{ id: string; active: boolean | null }>;
};

export type WebhookEndpoint = {
  phone_number: string | null;
  name: string | null;
  extension_id: string | null;
  extension_number: string | null;
};

export type InteractionIdentity = {
  telephony_session_id: string | null;
  session_id: string | null;
  call_log_ids: string[];
};

export type ProjectionOutcome = {
  next: InteractionProjection;
  /** Semantic difference from `existing`; false means no write, revision, audit or job. */
  changed: boolean;
  created: boolean;
  newly_terminal: boolean;
  new_recording_ids: string[];
  new_aliases: Array<{ kind: AliasKind; value: string }>;
  /** Party events fenced as stale or duplicate by that party's own sequence. */
  fenced_party_events: number;
  /** Call Log record older than stored provider modification; only additive evidence applied. */
  stale_call_log: boolean;
};

export type RouteResolver = (
  companyE164: string | null,
  startedAt: Date,
) => string | null;
