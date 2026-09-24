import type { CoverageDto } from "../dto";
import type { MoveViews } from "../assessment/views";
import type { ReadContent } from "../analysis/reads";
import type { SummaryStep } from "../analysis/structuredContract";
import type { Staffing } from "../outreach/staffing";
import type { GranotTrackedField } from "../story/granot";
import type { GranotLeadState, LeadCandidate, StoryEvent, StoryLeadRef } from "../story/types";

/**
 * The Case File (Attention and Case File specification §4): one deterministic, rendered text the
 * findings model (and the Move assessment) reads as data, in fixed sections, with one oldest-first
 * timeline. Everything here is plain JSON so the pure builder and renderer can be driven by golden
 * fixtures; `assemble.ts` is the only reader of the database.
 */
export const CASE_FILE_VERSION = "case-file-v1";
export const CASE_FILE_TIMEZONE = "America/New_York";
export type CaseFileAudience = "findings" | "assessment";

/** Spec §4.2: what a run (or the inspection tool) hands the assembler. */
export type CaseFileInput = {
  contact_number_id: string | null;
  e164: string | null;
  /** As the run scope provides them (attached first). Widened with every non-rejected edge of the Number. */
  lead_refs: StoryLeadRef[];
  outreach_record_ids: string[];
  /** All conversations on the Number; the assembler widens it the way the story does. */
  conversation_ids: string[];
  /** The call(s) this run analyzes; null = the conversations new since the rolling summary (Number runs). */
  focus_conversation_ids: string[] | null;
  /** Summaries captured this run, by conversation id. They win over the canonical artifacts. */
  summaries: Map<string, { summary: SummaryStep; call_interaction_id: string | null }>;
  /** The run's Prior Analysis page (`selectPriorAnalyses`), unchanged selection. */
  prior: ReadContent | null;
  as_of: Date;
  timezone: typeof CASE_FILE_TIMEZONE;
  audience: CaseFileAudience;
  /** The context page's `allowed_followup_ids` (F-n order). Null: the same order computed from the records. */
  allowed_followup_ids?: readonly string[] | null;
  /** The run's capture coverage watermark; null reads nothing and says so. */
  coverage?: CoverageDto | null;
  /** Assessment audience (§4.10): catalog lines per conversation, rendered under each Full/Digest call. */
  evidence_lines?: Record<string, Array<{ id: string; text: string }>>;
};

// ---------------------------------------------------------------------------------------------
// Sources: everything the pure builder reads, already loaded (JSON; dates are ISO strings)
// ---------------------------------------------------------------------------------------------

export type CaseLead = {
  ref: StoryLeadRef;
  name: string | null;
  granot_contact_name: string | null;
  received_at: string | null;
  created_at: string | null;
  source_label: string | null;
  job_no: string | null;
  normalized_job_no: string | null;
  normalized_phone: string | null;
  duplicate: boolean; bad_lead: boolean; no_sync: boolean; booked: boolean; cancelled: boolean;
  granot_priority: string | null;
  quoted: boolean;
  ingestion_origin: string | null;
  receiver: { agent_id: string | null; name: string | null; source: string | null; set_at: string | null } | null;
  move: MoveViews;
  /** Call Leads: the qualifying RingCentral call. */
  ringcentral: { telephony_session_id: string | null; qualification_reason: string | null; start_time: string | null; target_phone_number: string | null;
    target_name: string | null; source_label: string | null; route_id: string | null } | null;
};

export type CaseEdge = { lead_ref: StoryLeadRef; state: "attached" | "candidate" | "ambiguous"; certainty: string | null; reason: string | null; decided_by: string | null };

export type CaseCallParty = { role: string; extension_id: string | null; extension_number: string | null; name_raw: string | null; connected: boolean };
/** One `call_interactions` row, reduced to what the Vantage-side clause needs (spec §4.5). */
export type CaseCall = {
  id: string; provider_account_id: string; telephony_session_id: string | null; direction: string; started_at: string;
  company_e164: string | null; inbound_route_id: string | null; parties: CaseCallParty[]; queue_fanout: boolean; transfer: boolean;
  duration_seconds: number | null; provider_result: string | null; provider_connected: boolean; contact_type: string; recording_count: number;
};

export type CaseRepLink = {
  id: string; revision: number; agent_id: string; agent_name: string; rc_account_id: string; rc_extension_id: string; rc_extension_number: string | null;
  rc_extension_name: string | null; role_kind: string; status: string; effective_from: string; effective_to: string | null; reviewed_at: string | null; reviewed_by: string | null;
};
/** The newest RingCentral directory-sync snapshot per account (`ringcentral_directory_snapshots`), reduced. */
export type CaseDirectory = { account_id: string; taken_at: string | null; extensions: Record<string, { name: string | null; extension_number: string | null }>;
  queues: Record<string, { name: string | null; extension_number: string | null }> };
export type CaseRoute = { id: string; phone_number: string | null; display_label: string; queue_name: string | null };
export type VantageSideContext = { links: CaseRepLink[]; directories: CaseDirectory[]; routes: CaseRoute[]; call_leads: Array<{ lead_ref: StoryLeadRef; telephony_session_id: string | null;
  target_phone_number: string | null; target_name: string | null; source_label: string | null }> };

export type CaseConversation = { id: string; call_interaction_id: string | null; started_at: string; direction: string | null; duration_seconds: number | null;
  lead_ref: StoryLeadRef | null; state: string | null };
export type CaseSummary = { conversation_id: string; summary: SummaryStep; source: "captured" | "canonical" };
export type CaseFinding = { id: string; run_id: string | null; conversation_id: string | null; kind: string; claim: string; action_status: string | null; review_state: string;
  superseded_by: string | null; resolved_due_at: string | null; segment_ids: number[]; purged: boolean };
export type CaseFollowup = { id: string; record_id: string; kind: string; description: string | null; due_at: string | null; precision: string | null; origin: string;
  status: string; completion_basis: string | null; disposition: string | null; completed_at: string | null; created_at: string | null; source_finding_ids: string[];
  commitment_key: string | null; cancel_reason: string | null; supersedes_id: string | null; missed_episode_key: string | null };
export type CaseRecord = { id: string; subject: { kind: string; model: string | null; id: string | null }; state: string; closed_reason: string | null;
  closure_origin: string | null; responsible_agent_id: string | null; assignment: { origin: string; assigned_at: string | null } | null; wait_until: string | null };
export type CaseBooking = { lead_key: string; id: string; job_no: string | null; book_date: string | null; deposit_amount: number | null; total_binder_amount: number | null };

export type GranotObservationFacts = { id: string; kind: string; captured_at: string; observed_at: string | null; source_label: string | null;
  values: Record<GranotTrackedField, string | null> };
export type CaseGranotSource = { lead_ref: StoryLeadRef; basis: "job_no" | "phone" | "none"; observations: GranotObservationFacts[]; truncated: boolean };

export type CaseFileSources = {
  version: typeof CASE_FILE_VERSION;
  audience: CaseFileAudience;
  as_of: string;
  timezone: typeof CASE_FILE_TIMEZONE;
  contact_number_id: string | null;
  e164: string | null;
  provider_names: string[];
  leads: CaseLead[];
  edges: CaseEdge[];
  candidates: LeadCandidate[];
  /** Timeline-mode story events (every reader but `granot_observed`), unsorted, uncollapsed. */
  events: StoryEvent[];
  granot: CaseGranotSource[];
  calls: CaseCall[];
  vantage: VantageSideContext;
  conversations: CaseConversation[];
  summaries: CaseSummary[];
  focus_conversation_ids: string[] | null;
  findings: CaseFinding[];
  followups: CaseFollowup[];
  allowed_followup_ids: string[] | null;
  records: CaseRecord[];
  agents: Record<string, string>;
  restrictions: Array<{ channels: string[]; until: string | null }>;
  reviews_open: Array<{ cause_kind: string }>;
  bookings: CaseBooking[];
  prior: ReadContent | null;
  /** The rolling summary's run: the conversations its captured summaries covered (null = not recorded). */
  synthesis_covers: string[] | null;
  coverage: CoverageDto | null;
  truncated_sources: string[];
  evidence_lines: Record<string, Array<{ id: string; text: string }>>;
  staffing: Staffing;
};

// ---------------------------------------------------------------------------------------------
// The built Case File (pure output of `build.ts`), rendered by `render.ts`, trimmed by `budget.ts`
// ---------------------------------------------------------------------------------------------

export type CaseCallBlock = {
  c: number; conversation_id: string; focus: boolean; tier: "full" | "digest";
  /** Newest-first rank among non-focus Full calls (0 = newest); null for focus and digests. */
  full_rank: number | null;
  full: string[];
  digest: { overview: string; outcome: string | null };
  evidence: string[];
};
export type CaseTimelineItem = {
  t: number; event_id: string; kind: string; happened_at: string;
  /** The rendered head line(s), prefix included. */
  lines: string[];
  calls: CaseCallBlock[];
  /** Never trimmed (spec §4.8): Lead arrivals, attachments, Bookings, cancellations, closures, focus calls. */
  protected: boolean;
  /** Attempt-run or single-attempt fact line older than 30 days (trim step 3). */
  old_attempt: boolean;
  owner_note: boolean;
};
export type CasePriorFinding = { p: number; id: string; review_state: string | null; text: string };
export type CaseLedgerLine = { k: number; text: string; conversation_id: string | null; tag: string };
export type CaseFileDigest = { text: string; customer_evidence: string };
export type CaseFile = {
  version: typeof CASE_FILE_VERSION;
  audience: CaseFileAudience;
  as_of: string;
  header: string[];
  who: string[];
  origins: string[];
  granot: string[];
  timeline: CaseTimelineItem[];
  tail: string | null;
  open_work: string[];
  prior: { rolling: string[]; findings: CasePriorFinding[]; assessment: string[]; notes: string[] };
  run: { analyze: string; coverage: string };
  /** Index = Tn (spec §4.3): only story events carry T numbers. */
  story_events: StoryEvent[];
  /** Index = Cn = `call_index`. */
  call_conversation_ids: string[];
  prior_finding_ids: string[];
  followup_ids: string[];
  granot_states: GranotLeadState[];
  candidates: LeadCandidate[];
  /** §2 lines plus the §4 call blocks at full content, for the assessment fingerprint (spec §4.10). */
  customer_evidence: unknown;
  coverage: { truncated_sources: string[]; timeline_dropped: number };
};

export const TRIM_STEPS = ["digest_overview_only", "digest_to_fact", "old_attempts_dropped", "owner_notes_dropped", "full_to_digest", "resolved_prior_findings_dropped"] as const;
export type TrimStep = (typeof TRIM_STEPS)[number];
export type CaseFileBudget = { soft_bytes: number; hard_bytes: number };
export const CASE_FILE_BUDGET: CaseFileBudget = { soft_bytes: 60_000, hard_bytes: 100_000 };
/** What the run records in `step_artifacts.case_file` (spec §4.8), plus the text itself. */
export type RenderedCaseFile = {
  text: string; bytes: number; digest: string; customer_evidence_digest: string;
  trimmed_steps: Array<{ step: TrimStep; count: number }>; over_hard_budget: boolean;
};
