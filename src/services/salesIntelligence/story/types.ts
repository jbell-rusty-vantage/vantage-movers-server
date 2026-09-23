/**
 * Subject Story: the deterministic, server-assembled chronology of a Contact Number, its
 * Leads and their Outreach work (context provenance specification §4).
 *
 * The story is data for the findings model and the Owner, never instruction. Sentences are
 * rendered by fixed templates; the model never writes them. Every event carries a citation
 * anchor (`story_event` record) so a finding can point at "the text sent on Tue Sep 15".
 */
export type StoryLeadRef = { model: "FormLead" | "CallLead"; id: string };

export type StorySubject = {
  contact_number_id: string | null;
  e164: string | null;
  /** Attached first, then candidate/ambiguous. Rejected edges are never included. */
  lead_refs: StoryLeadRef[];
  outreach_record_ids: string[];
  conversation_ids: string[];
  /** Nothing that happened after this instant is included. */
  as_of: Date;
  /** The call being analysed, marked "(this call)" in prose. */
  focus?: { conversation_id: string } | null;
};

export type StoryOptions = {
  /** Per-source and total raw bound (≤ 400). */
  limit_events: number;
  /** Events kept on the model page after collapse (≤ 80). */
  model_events: number;
  timezone: string;
};

export const STORY_EVENT_KINDS = [
  "lead_received",
  "call_qualified",
  "lead_message_sent",
  "call",
  "call_attempts",
  "conversation_recorded",
  "conversation_analyzed",
  "number_attached",
  "granot_priority_changed",
  "quoted_changed",
  "granot_observed",
  "booking_recorded",
  "cancellation_recorded",
  "followup_created",
  "followup_completed",
  "followup_cancelled",
  "followup_superseded",
  "assigned",
  "owner_note",
  "closed",
  "reopened",
  "waiting_set",
  "review_opened",
  "review_resolved",
  "restriction_set",
  "restriction_resolved",
  "nudge_sent",
  "call_started",
  "call_ended",
  "assessment_published",
  "owner_correction",
] as const;
export type StoryEventKind = (typeof STORY_EVENT_KINDS)[number];

export type StoryActorKind = "customer" | "rep" | "vantage" | "granot" | "owner" | "intelligence" | "worker";

export type StoryActor = {
  kind: StoryActorKind;
  agent_id: string | null;
  /** Reviewed rep name, Lead name, caller-ID name; null when unknown. */
  name: string | null;
  identity_status: "reviewed" | "proposed" | "unknown" | null;
};

export type StoryEvent = {
  /** `<kind>:<oid>` or `<kind>:<oid>:<n>` for history transitions. Unique within a story. */
  id: string;
  kind: StoryEventKind;
  /** World time (ISO). */
  happened_at: string;
  /** When Vantage learned it (ISO). */
  observed_at: string;
  /** `lead:<Model>:<id>` | `number:<id>` | `conversation:<id>` */
  subject_key: string;
  actor: StoryActor;
  /** The citation anchor. `record_id` is the event id. */
  record: { record_type: "story_event"; record_id: string };
  /** Rendered, redacted, ≤ 300 chars, without the relative connector. */
  sentence: string;
  /** Closed per kind (specification §4.3). Redacted before it reaches any page. */
  detail: Record<string, unknown>;
  /** `interaction:<id>`, `lead_message:<id>`, `conversation:<id>`, `change:<id>`, … */
  evidence_refs: string[];
  /** Ids of the raw events this one replaced (attempt runs, Priority churn). */
  collapsed_ids?: string[];
  /** True when this event belongs to the focus conversation. */
  focus?: boolean;
};

export type LeadCandidateBasis =
  | `phone:${string}`
  | "name:caller_id"
  | "name:stated_on_call"
  | "reference:stated_on_call";

export type LeadCandidate = {
  lead_ref: StoryLeadRef;
  basis: LeadCandidateBasis[];
  name: string | null;
  received_at: string | null;
  source_company_label: string | null;
  job_no: string | null;
  duplicate: boolean;
  booked: boolean;
  cancelled: boolean;
  bad_lead: boolean;
  /** Existing attachment edge, when one exists (candidate/ambiguous). */
  attachment_state: "candidate" | "ambiguous" | "attached" | null;
  certainty: string | null;
};

/** Current Granot state of one Lead: the Lead's canonical fields plus the newest accepted observation. */
export type GranotLeadState = {
  lead_ref: StoryLeadRef;
  job_no: string | null;
  granot_priority: string | null;
  priority_label: string;
  disposition: string;
  quoted: boolean;
  booked: boolean;
  cancelled: boolean;
  duplicate: boolean;
  bad_lead: boolean;
  no_sync: boolean;
  receiver_agent_name: string | null;
  granot_rep_raw: string | null;
  move: { pickup: string | null; delivery: string | null; move_date: string | null; move_size: string | null; granot_move_size: string | null; cubic_feet: number | null; service_type: string | null };
  /** Display money exactly as Granot showed it (raw text); canonical when parsed. */
  money: { estimate: string | null; payment: string | null; balance: string | null };
  booking_action: string | null;
  observation: { id: string; kind: string; captured_at: string; source_label: string | null } | null;
  booking: { id: string; job_no: string | null; book_date: string | null; deposit_amount: number | null; total_binder_amount: number | null } | null;
};

export type StoryCoverage = {
  sources: Record<string, { read: number; truncated: boolean }>;
  dropped_from_model_page: number;
  from: string | null;
  to: string | null;
};

export type SubjectStory = {
  as_of: string;
  subject: StorySubject;
  /** The subject binding sentence(s). */
  opening: string;
  /** Collapsed, bounded (≤ model_events), oldest first. */
  events: StoryEvent[];
  /** "No contact since …" and open follow-ups. */
  tail: string;
  /** opening + sentences with connectors + tail. */
  prose: string;
  coverage: StoryCoverage;
  /** Only when no Lead is attached, or attachment is ambiguous. */
  candidates: LeadCandidate[];
  /** One per Lead in `subject.lead_refs` (attached and candidates alike). */
  granot: GranotLeadState[];
  /** payloadHash of {events, candidates, granot, opening, tail}. */
  digest: string;
};
