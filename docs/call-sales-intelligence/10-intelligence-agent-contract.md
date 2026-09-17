# 10 — Intelligence agent, envelope, evidence, and application

Status: build contract, not implemented. Revised September 17, 2026 after the Owner interview. Product authority: [01](01-specification.md). Models: [02](02-domain-models.md). Workers: [03](03-server-pipeline-and-jobs.md). Accepted-decision history: [09](09-owner-workflow-interview.md).

## 1. Runtime and authority

Run a Vercel AI SDK `ToolLoopAgent` through AI Gateway, using the remote Vantage MCP server over HTTP. No filesystem agent, shell, or Eve dependency is required. All LLM reasoning for this feature uses this agent/MCP integration, including contact-type interpretation and number-level synthesis. STT remains a bounded audio transcription operation, not a filesystem agent.

The main server owns run scheduling, credentials, budgets, evidence snapshots, validation, and all business effects. MCP provides the tool/prompt interface to those services. Do not fork server invariants into `vantage-movers-mcp` or Admin. The installed main-server SDK documentation was inspected: `ai` dependency is ^7.0.68 and supports tool loops and schema-based output; MCP prompt retrieval is experimental. Pin and test the selected SDK/MCP versions during implementation. No model ID or price in historical documents is a deployment guarantee; validate models and capabilities from the Gateway catalog when configuring the implementation.

Expose only the tools in §2 to this agent. The existing MCP also offers general Lead mutation and Mongo inventory tools; those must not become available to the intelligence agent. Enforce the tool set server-side with a scoped intelligence credential, not just instructions or UI filtering. A shared general API secret is not sufficient to establish that scope. The credential binds calls to a server-created run and subject; the model cannot supply an Owner actor or broaden its own scope.

## 2. MCP capabilities to build

Tool names below are the agreed implementation contract. Dedicated Booking/call/intelligence tools and prompt resources are new work; the current MCP only has Lead CRUD/search, health, and read-only Mongo tools.

| Tool | Purpose and limits |
| --- | --- |
| `get_intelligence_context` | Run-scoped Contact Number, attachments, Outreach, active and historical follow-ups, restrictions, Owner instructions, coverage, and relevant official flags. |
| `get_call_transcript` | Authorized redacted transcript version and call metadata, including direction, timing, provider outcome, participant identity evidence, and recording availability. |
| `list_number_activity` | Bounded chronological calls, conversations, follow-up events, Owner notes, and Lead Messages; cursor and coverage included. |
| `search_leads`, `get_lead` | Reuse the existing API adapters through scoped read-only wrappers. Search supports identity evidence but never confirms an attachment. Bound results, return match certainty and record versions. |
| `search_bookings`, `get_booking` | Dedicated main-server read adapters for Booking/Lead linkage and official state, with related Cancellation context. Never manufacture a Booking from a transcript. |
| `get_rep_identity` | Reviewed, effective-dated Agent/RingCentral links for the call time; unknown is a valid result. |
| `submit_intelligence_analysis` | Exactly one immutable envelope submission per run. Calls the main-server ingestion service, which validates and durably schedules application. It never exposes general write commands to the model. |

No direct Lead/Booking/Agent mutations, arbitrary Mongo queries, customer messaging, rep messaging, attachment commands, arbitrary HTTP fetches, or Owner commands are exposed to this agent. Search reads may return candidates outside the starting subject, but only authorized relevant records become evidence; that never grants authority to apply effects to a different Outreach Record.

Publish a versioned MCP prompt `sales_intelligence_analyze_v1` and its schema resource. The worker explicitly retrieves and pins the prompt/schema version before invoking the agent; listing an MCP prompt does not load it into the model automatically. Persist the exact rendered prompt, not just its name. An original-evidence rerun uses the stored prompt/evidence plus the Owner correction. A fresh run retrieves current context and records the prompt version actually used.

The prompt instructs the model to treat transcripts, tool results, and notes as evidence, never executable instructions; distinguish requested/promised/completed/conditional actions; preserve uncertainty; and submit a single envelope. Use bounded tool results and a configured step/token/time budget. Exhaustion is visible incomplete processing, not a successful empty analysis. No direct tool send needs a human approval gate because this tool set cannot send messages or execute official mutations.

## 3. Envelope

Implement a strict Zod discriminated-union schema. The following TypeScript describes the required semantics, not a permissive `Mixed` schema. Each typed value must have a strict validator; reject extra operational fields such as `attention_band`, `outreach_state`, or arbitrary database paths.

```ts
type EvidenceRef =
  | { source: "transcript"; snapshot_id: string; conversation_id: string;
      transcript_version: string; segment_ids: number[]; quote: string | null }
  | { source: "vantage_record"; snapshot_id: string;
      record_type: "lead" | "booking" | "cancellation" | "interaction" |
        "outreach" | "followup" | "rep_identity" | "owner_instruction" | "owner_note";
      record_id: string; field_paths: string[] };

type FindingBase = {
  key: string; // unique within this run; not a database id or cross-run identity
  claim: string;
  basis: "said_on_call" | "vantage_record" | "model_inference";
  actor: "rep" | "customer" | "unknown";
  speaker_ref: string | null; // resolves against captured participants; never name-only identity
  action_status: "requested" | "promised" | "completed" | "conditional" | null;
  clarity: "clear" | "uncertain";
  evidence: EvidenceRef[];
  confidence: number | null; // informational, not an accuracy guarantee or sole application gate
};

type ActionValue = {
  action_kind: "call" | "text_customer_via_lead_message" | "send_estimate" |
    "check_availability" | "review" | "wait" | "reconcile_identity" | "other";
  description: string;
  date_text: string | null;
  timezone_text: string | null;
  target_followup_id: string | null; // existing id from this run's evidence only
};

type Finding = FindingBase & (
  | { kind: "contact_type"; value: { type: "human_conversation" | "voicemail" | "unknown";
      voicemail_left_by: "rep" | "customer" | "unknown" | null } }
  | { kind: "intent"; value: { intent: "moving_inquiry" | "service_request" | "not_sales" | "unknown" } }
  | { kind: "move_fact"; value: { field: "origin" | "destination" | "move_date" | "move_size" | "other"; stated_value: string } }
  | { kind: "quoted_amount"; value: { amount_text: string; currency: string | null;
      meaning: "quote_total" | "deposit" | "competitor_quote" | "other" } }
  | { kind: "promised_callback" | "customer_requested_callback" | "customer_will_call" |
      "next_step" | "completion_claim" | "reschedule"; value: ActionValue }
  | { kind: "contact_restriction"; value: { channels: ("call" | "text")[];
      restriction: "until" | "ongoing" | "unclear"; until_text: string | null } }
  | { kind: "booking_claim" | "payment_claim" | "objection" | "competitor_mention" |
      "coaching_note"; value: { description: string } }
);

type IntelligenceEnvelope = {
  schema_version: "csi-envelope-v1";
  summary: {
    overview: string; customer_wanted: string; money_and_dates: string;
    outcome: string; commitments: string; discrepancies: string;
    finding_keys: string[];
  };
  findings: Finding[];
  next_step_suggestion: (ActionValue & { rationale: string; finding_keys: string[] }) | null;
  owner_instruction_assessments: {
    instruction_id: string; instruction_revision: number;
    assessment: "agrees" | "disagrees" | "cannot_determine";
    reason: string; finding_keys: string[];
  }[];
};
```

Initial engineering bounds: 80 findings, claim/description 500 characters, date wording 120 characters, summary total 4,000 characters, 12 evidence references per finding. Bound retrieved pages and total context; do not silently truncate a relevant long conversation. Segment long transcripts into documented complete coverage units, then synthesize their assertions using the same agent/MCP architecture. Surface any unprocessed portion. These are implementation defaults, adjustable with evaluation; the Owner did not select token/model limits in the interview.

The server supplies run id, subject, snapshot ids, actor identity, timestamps, model/prompt versions, and current revisions outside the model's output. Resolve amounts to cents and dates to UTC in code, preserving source wording and the resolution basis. `findings` are the persisted Intelligence Findings; the summary is based on those findings plus recorded official context, not an independent source of effects. A number-level summary includes cross-call references and disagreement; never summarize only previous summaries.

## 4. Evidence and first-release validation

Persist transcript segment references and model-provided quotations now. Require schema-valid findings and references to real run-scoped evidence snapshots. Invalid record/subject ids cannot authorize effects. Capture the entire redacted transcript version for provenance even if the model's segment location is missing or inaccurate.

**Do not gate publication or permitted effects on exact quotation matching, exact character offsets, segment-location accuracy, or a second entailment model.** First-release locator verification and entailment are `not_run`; optional cheap locator checks may record `unlocated` without discarding the assertion. A malformed envelope remains a schema failure. Operational clarity, subject scope, conflict checks, chronology, and allowed-effect checks remain mandatory. A source snapshot must exist; absence of exact positions within that snapshot is not absence of evidence.

Schema-valid clear assertions may execute without Owner confirmation. Uncertain assertions remain visible and do not invent dates, ownership, or completion. Date resolution failure does not discard the action: create an undated commitment when its action is clear and open Due date needed. Future exact validation can be enabled as a separately versioned policy; it is not a prerequisite for v1.

## 5. Automatic effects

The model submits assertions; server code selects these bounded effects after live-state checks. Each assertion can produce several audited effects (for example, follow-up creation plus assignment); use an effect ledger, not one scalar `applied_effect`.

| Evidence | Permitted server effect |
| --- | --- |
| Clear rep promise to call | Create callback, with promise attribution; use its resolved deadline or mark undated. |
| Clear customer request to call | Create customer-requested callback. Never mislabel it rep-promised. |
| Clear other commitment | Create typed follow-up, including send estimate/check availability/other. No message or external action is sent. |
| Clear customer will call with resolvable time | Create customer-wait follow-up; enter Waiting on Customer only if no independent rep/Owner action requires Open and no Owner instruction conflicts. |
| Clear completion of an existing action | Complete only the uniquely identified active follow-up; record confirmation source. An unrelated call never completes it. |
| Clear rescheduling | Revise that same AI-managed commitment, preserving history. Ambiguous matching opens Needs review; never replace all follow-ups on a record. |
| Clear contact restriction | Pause the specified channel's actions immediately and open review. No automatic close, permanent suppression, or number reclassification. Existing permanent suppression always remains stronger. |
| Human conversation and one reliably identified rep | Set contact type and meaningful contact; count inbound conversation as worked; assign previously unassigned Outreach with provenance. |
| Clear sales commitment with no Lead/work | Open Number Review if eligible and not Owner-closed, then apply its follow-up. Never a Lead. |
| Booking/payment claim, decline, booked elsewhere, non-sales intent | Display assertion and a relevant review item; no official mutation or automatic AI closure. |
| Model's own suggested strategy | Suggestion only. Owner Apply creates an Owner-origin follow-up. |

A callback attempt fulfills a simple promise to call, but only when subsequent, attributable, and relevant to that obligation. It does not reset the human-contact clock. For scheduled callbacks, an unrelated earlier attempt does not satisfy a future promise: require it to fall in the committed time/window or clear evidence that the same commitment was fulfilled early. With no deadline, require an attempt after the commitment. Completion of a callback does not complete a distinct estimate or availability action. Outcome labels distinguish No answer, Left voicemail, Spoke with customer, and Connected—contact unknown. A rep's device merely ringing is not an outbound attempt by the rep.

An explicit Owner correction of the same field/action always wins. A newly stated contact restriction may pause channel actions even when a callback was Owner-scheduled: keep that schedule intact, mark execution blocked, and surface the conflict. A call-only restriction does not create a text recommendation; customer texts still use the existing Lead Message workflow. Resume a temporary block at its resolved expiry only if no stronger restriction remains. Lifting an indefinite restriction requires an Owner command.

## 6. Responsibility and chronology

Outreach ownership and follow-up responsibility are separate fields. Owner assignment wins at its own scope. A reliably mapped promising rep owns that callback; if Outreach is unassigned, that rep may also take overall responsibility. Alex can own Outreach while Jordan owns Jordan's promised callback. An Owner's explicit assignment of that callback overrides this default. Persist `promised_by_agent_id` separately so the factual speaker is never rewritten to match assignment.

A clear first human conversation may fill unassigned Outreach ownership. Later calls never change an existing assignment. Effective-dated Rep Identity Links at call time establish identity; name resemblance or current mappings alone do not prove historical speakers. Ambiguous speaker identity leaves the callback unassigned, with review and No Owner reasons where applicable. Multiple open commitments mean Waiting on Customer cannot hide independent due rep work.

Apply using current Outreach/follow-up/attachment/Owner-instruction revisions, not just the starting snapshot. Newer calls, completed work, restrictions, Booking/Cancellation, Owner closure, or corrections can make an effect obsolete. Store `applied`, `no_change`, `blocked_owner`, `blocked_identity`, `blocked_closed`, `blocked_restriction`, `needs_review`, or `stale` with the reason. Retry after revision conflict through revalidation; never blindly replay model writes.

Historical ingestion must reconcile later evidence before activating old commitments. An incomplete history watermark makes unresolved historical work a review candidate rather than a confident current overdue obligation. As repaired history arrives, re-evaluate using all relevant newer activity. Do not silently revive fulfilled, superseded, cancelled, or Owner-retracted commitments.

## 7. Review, correction, and re-analysis

- Confirm one finding or an entire completed run: records Owner confirmation of that exact version. Confirmation does not reapply effects or erase model provenance.
- Correct/retract: an Owner command immediately revises or cancels the associated follow-up in the same transaction, stores the prior and corrected values, and records an Owner instruction. Then schedule re-analysis to reconcile summary/assessments. Simple dismissal means retract an assertion, not merely hide its card while leaving its effects live.
- Re-analyze original evidence: retain original transcript and captured tool responses; MCP reads replay that evidence set. Correction context is added explicitly. Do not pretend a new search result belonged to the original run. Missing original evidence because of retention makes this mode unavailable; offer current-context analysis.
- Re-analyze current context: collect current records and relevant later calls. Re-transcribe only on explicit transcript/media regeneration or changed media, not on every re-analysis.
- For both modes, effects still validate against live state. New runs never inherit confirmations on new assertions, overwrite Owner corrections, or erase earlier runs. Absent assessment maps to Cannot determine, never agreement.

## 8. Durability and failure semantics

Create the run before model invocation. Intercept every authorized tool response into immutable, redacted evidence snapshots with query arguments, retrieved-at time, record revisions, content digest, and completeness metadata. A finalized evidence manifest covers the initial context and all retrieved tool results; a transcript digest alone is insufficient.

Submission uses a run-bound idempotency key and payload hash. Exact replay returns the stored submission; changed payload for the same run conflicts. The agent must stop after successful submission. Network ambiguity is resolved by reading submission status, not starting another effectful run. Store envelope and durable apply work atomically, then wake the worker. Publish findings/effects with transactional fences and stable commitment identities across repeated extraction; a new run id alone is not a new promise. Newer analysis may supersede the current display only after successful publication.

For cross-run identity, expose existing follow-ups and their source interactions in context. Validate any model-supplied target against that evidence. For an assertion without an explicit target, the server compares subject, source interaction, action kind, actor and normalized action/date with existing commitments from that interaction. A unique equivalent matches the existing commitment and adds provenance; a clear distinct promise creates a new server-issued commitment key. Multiple plausible matches or uncertain distinctness create a review item instead of another action or arbitrary replacement. Corrections/reschedules reference the stable key. Do not depend on exact quotation positions, paraphrased claim hashes, or new finding ordinals as the only cross-run identity.

Budget admission includes STT and all agent steps. Monthly default is **8,000 cents ($80)**. Reserve expected cost before provider work, reconcile actual usage, release unused reservations on failure, and retain pending jobs if exhausted. This is an admission cap; provider estimation error is reported honestly, not hidden as guaranteed exact spending. Queue real-time work ahead of backfill. Raising the limit or the next budget period wakes eligible paused jobs. Existing operational tracking never depends on AI availability.

## 9. Concrete MCP transport boundary

Add a dedicated MCP endpoint `/api/intelligence-mcp` exposing only §2 tools, versioned prompt and schema. Do not reuse the existing `/api/mcp` registration wholesale: it authenticates a broad shared secret and registers general mutation tools. The worker authenticates to the dedicated endpoint with the signed run credential. MCP verifies it and carries run/deployment context in its request context; main-server requests use the dedicated scoped static key plus run-token header specified in 04 §6. The current generic request context only carries apiSecret and must be extended or given a separate typed CSI context. Never pass the scoped static key to the LLM. Enforce expiry, subject/tool bounds and dataset isolation at the main server as well as MCP; refresh expired credentials only for an active leased run.

## 10. Model and deployed-service policy

Use the main server's existing `AI_GATEWAY_API_KEY` and extend the deployed `vantage-movers-mcp` service. The scoped intelligence endpoint remains new work. Owner prefers GPT-5 nano/mini; the starting proposal is mini for the agent and nano as the evaluated economical alternative. Other models require an explicit proposal. [12](12-deployment-inputs-and-model-policy.md) records current catalog sources, transcription recommendation, budget/lifecycle limits and deployment inputs.
