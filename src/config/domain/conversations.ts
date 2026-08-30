export const LEAD_CONVERSATION_COLLECTION = "lead_conversations";

export const LEAD_CONVERSATION_PROVIDERS = ["ringcentral"] as const;
export type LeadConversationProvider = (typeof LEAD_CONVERSATION_PROVIDERS)[number];

export const LEAD_CONVERSATION_LEAD_MODELS = ["FormLead", "CallLead"] as const;
export type LeadConversationLeadModel =
  (typeof LEAD_CONVERSATION_LEAD_MODELS)[number];

export const LEAD_CONVERSATION_MATCH_METHODS = [
  "call_lead_telephony_session",
  "call_lead_call_log_id",
  "form_lead_outbound_phone_window",
  "owner_manual_attach",
] as const;
export type LeadConversationMatchMethod =
  (typeof LEAD_CONVERSATION_MATCH_METHODS)[number];

export const LEAD_CONVERSATION_MATCH_CONFIDENCES = ["high", "medium"] as const;
export type LeadConversationMatchConfidence =
  (typeof LEAD_CONVERSATION_MATCH_CONFIDENCES)[number];

export const LEAD_CONVERSATION_DIRECTIONS = ["Inbound", "Outbound"] as const;
export type LeadConversationDirection =
  (typeof LEAD_CONVERSATION_DIRECTIONS)[number];

export const LEAD_CONVERSATION_STATES = [
  "discovered",
  "media_stored",
  "transcribed",
  "complete",
  "no_recording",
  "failed",
  "dead_letter",
] as const;
export type LeadConversationState = (typeof LEAD_CONVERSATION_STATES)[number];

export const CONVERSATION_STT_MODEL = "gpt-4o-mini-transcribe";
export const CONVERSATION_SUMMARY_MODEL = "gpt-4.1-nano";
export const CONVERSATION_PROMPT_VERSION = "owner-demo-v1";
export const CONVERSATION_AUDIO_URL_TTL_MS = 5 * 60 * 1000;

export const CONVERSATION_BLOB_PREFIX = "conversations";

export function conversationBlobPathname(providerRecordingId: string): string {
  return `${CONVERSATION_BLOB_PREFIX}/${providerRecordingId}.mp3`;
}
