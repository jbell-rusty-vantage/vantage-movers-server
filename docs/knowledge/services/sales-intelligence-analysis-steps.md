---
okf_version: "0.2"
type: Service
title: What the analysis model steps are shown and what they produce
description: The three fixed model steps (call summary, findings, Move assessment), the pages each one is shown (calls, context, Subject Story, Granot state, Prior Analysis), the exact outputs each one returns, and what the server does with every output.
tags: [sales-intelligence, durable-work, move-assessment]
status: draft
stale_after: 2026-12-23
resource: src/services/salesIntelligence/analysis/structuredRuntime.ts
applies_to:
  - src/services/salesIntelligence/analysis/structuredRuntime.ts
  - src/services/salesIntelligence/analysis/structuredContract.ts
  - src/services/salesIntelligence/analysis/structuredPrompt.ts
  - src/services/salesIntelligence/analysis/prior.ts
  - src/services/salesIntelligence/analysis/relations.ts
  - src/services/salesIntelligence/analysis/reads.ts
  - src/services/salesIntelligence/story/
  - src/services/salesIntelligence/companyContext.ts
  - src/services/salesIntelligence/assessment/contract.ts
---

# What the analysis model steps are shown and what they produce

This is the reader's map of the Call & Sales Intelligence model pipeline as it runs today (September 23, 2026). It answers three questions for each step: what the model is given, what it must return, and what the server does with the answer. Authority for the rules lives in [sales-intelligence-analysis.md](sales-intelligence-analysis.md) (runtime, capture, application), [sales-intelligence-move-assessment.md](sales-intelligence-move-assessment.md) and the root specification `SALES-INTELLIGENCE-CONTEXT-PROVENANCE-SPECIFICATION.md`; this document does not restate their invariants.

## The pipeline in one paragraph

A recorded call becomes a Lead Conversation with a redacted transcript. Every analysis run belongs to one Contact Number and is either a **conversation run** (one call, triggered by a new transcript) or a **number run** (all eligible calls on the number, triggered when the number's evidence fingerprint changes). Both use the same three fixed, server-owned steps (`analysis_pipeline: csi-analysis-steps-v1`): the model has **no tools**; everything it may cite is captured by the server first as an immutable evidence snapshot, and the model's output is validated against those snapshots before anything is written. The model used in production is `openai/gpt-5.6-luna` through the AI Gateway.

| Step | Model call | Prompt version | Shown | Returns | Retained as |
| --- | --- | --- | --- | --- | --- |
| 1 Summary | one per call, cached per transcript version | `csi-summary-v2` | the redacted transcript of one call, plus the subject binding | six-section summary, `said_on_call` facts, `move_evidence` | canonical summary snapshot (`source_type: summary`, `artifact_key`) |
| 2 Context | none | `csi-context-v2` | — | the **context**, **story** and **prior** pages | three run-scoped snapshots (`context`, `story`, `prior`) |
| 3 Findings | one per run | `sales_intelligence_analyze_v4` | all summaries + the three pages | findings envelope + prior relations + story discrepancies | `IntelligenceRun.output` (expanded) and `raw_output` (exact model object) |
| Move assessment | one per Outreach subject, nominated after step 1 | `csi-move-assessment-v1` | Lead views, official flags, Owner corrections, every call summary, retained findings | scores, views, inventory, conflicts, engagement | `move_assessment_artifacts` (`model_output` retained) |

Every prompt opens with the trusted company block (`VANTAGE_COMPANY_CONTEXT`: Vantage Movers LLC, a moving broker in Boynton Beach, the rep speaks for Vantage). The findings prompt additionally opens with `VANTAGE_DOMAIN_CONTEXT`: how Form Leads (WordPress forms on partner sites), Call Leads (qualified RingCentral inbound calls), Call Interactions (RingCentral webhooks and call logs), Granot observations (Job number, rep, Priority, Quoted, estimate, payment, balance, booking actions), Lead Messages (Twilio confirmation texts), Bookings, Cancellations, attachments and Outreach come to exist, and the Owner-confirmed Priority meanings: `0` Fresh, `1` Quoted, `3` Rep discretion, `7` CRM bad/unusable, `8` CRM dead opportunity; every other code, including `5`, is stated as unknown.

## Step 1 — Call summary (`structuredContract.ts` `summaryGenerationSchema`)

**Shown.** `{ subject_binding: [{id, model, certainty, state}], segments: [{sid, start_ms, end_ms, timing_source, speaker, text}] }` for one call. Nothing about other calls, Leads or Outreach: the summary is meant to be a faithful, reusable record of that one conversation, cached by `(conversation, transcript_version, prompt, model)` and reused by every later run and by the Move assessment.

**Returns.**

- `summary`: `overview`, `customer_wanted`, `money_and_dates`, `outcome`, `commitments`, `discrepancies` (≤ 4,000 characters together).
- `said_on_call[]`: facts in the finding taxonomy (`contact_type`, `intent`, `move_fact`, `quoted_amount`, `promised_callback`, `customer_requested_callback`, `customer_will_call`, `next_step`, `completion_claim`, `reschedule`, `contact_restriction`, `booking_claim`, `payment_claim`, `objection`, `competitor_mention`, `coaching_note`), each with `claim`, `value`, `actor`, `clarity`, `action_status`, `speaker` and the transcript `segment_ids` that support it. `target_followup_id` is always null at this step.
- `move_evidence`: `observations[]` (pickup/delivery, move date, size, services, access, money), `inventory[]`, `intent_signals[]`, each with speaker and segment ids. This block feeds the Move assessment only.

**Server.** Segment ids are checked against the transcript; the six sections and facts become the citable evidence of step 3 (a finding may cite only segments a `said_on_call` fact already cites). The summary is what the Owner sees as "Conversation summary" and what every prior-analysis page quotes.

## Step 2 — Context pages (no model call)

Assembled once per run after the summaries, captured as snapshots and restored unchanged on retry and on an `original_evidence` replay.

### Context page (`reads.ts` `context()` + `search_leads`, `search_bookings`, `list_number_activity`)

`contact_number` (E.164, eligibility, classification); Owner instructions and contact restrictions; attachment edges as `lead` records (`certainty`, `status`); the official Lead projection (`projectLead`: name, phone, job number, source label, booked/cancelled/duplicate/bad/no-sync flags, `received_at`, `pickup`, `delivery`, `move_date`, `move_size`, `granot_priority` + `priority_label`, `quoted`, `agent_name`, `ingestion_origin`); Bookings; the number's Outreach records with their follow-ups (every run, and only these follow-ups may be targeted); Number Activity rows (calls, Lead Messages, conversations, Outreach audit); reviewed rep identities per call.

### Subject Story page (`story/`, record type `story_event`, plus `granot_state` and candidate `lead` records)

The deterministic chronology of the number and its Leads, oldest first, rendered by fixed sentence templates; the model never writes it. Event kinds: `lead_received`, `call_qualified`, `lead_message_sent` (never the body), `call` (direction, result, duration, recording, reviewed rep name), `call_attempts` (collapsed runs of unanswered attempts), `conversation_analyzed` (first sentence of the earlier summary, finding count), `number_attached`, `granot_priority_changed`, `quoted_changed`, `granot_observed`, `booking_recorded`, `cancellation_recorded`, `followup_created|completed|cancelled|superseded`, Owner actions (`assigned`, `owner_note`, `closed`, `reopened`, `waiting_set`, `review_opened`, `review_resolved`, `restriction_set|resolved`, `nudge_sent`, `call_started|ended`), `assessment_published`, `owner_correction`. Bounded at 400 raw and 80 on the model page; Lead received, attachments, bookings, cancellations, closures and the focus call are never dropped.

`granot_state` — one record per Lead: `granot_priority`, `priority_label`, disposition, `quoted`, `estimate`, `payment`, `balance` (as Granot displays them), booking action, move facts, receiver rep, the observation it came from, and the official Booking when one exists.

When no Lead is attached the server runs the candidate search itself (phone paths, caller-ID name, a name or job number the customer stated) and lists candidates as `lead` records with `certainty: candidate:<basis>` and `status: not_attached`. Nothing here attaches.

The page also carries the prose (`story.opening`, `story.prose`, `story.tail`, `coverage`, `candidates`, `granot`, `digest`). Example of what the model reads:

> Tyler Grenier (+13525091459) called TBM Leads on Sat Sep 19, 2026 at 9:20 AM ET; the call qualified as a Call Lead (Job 5564659). Later that day Granot Priority was set to 1 (Quoted). Minutes later Granot recorded the Lead with Priority 1 (Quoted), estimate 6600.00. 2 days later Brian made an outbound call: connected, 46 s, recorded, voicemail. That call was analyzed: "The call reached an unavailable number and a full mailbox…" (1 finding). Minutes later this number was attached to the Lead (Likely, automatic_high_confidence). … No contact since Tue Sep 22 (1 day before this analysis).

### Prior Analysis page (`analysis/prior.ts`, record types `prior_summary`, `prior_finding`, `prior_assessment`)

- `prior_summary` per other conversation on the number (newest 40): the canonical six sections, `said_on_call` kinds and claims, when the call happened; plus one `kind: number_synthesis` record for the newest completed number run (its six sections and next-step suggestion). This replaces the old frozen `prior_running_summary` string.
- `prior_finding` (≤ 60): claim, kind, actor, action status, review state, when, value, and the effects it produced (follow-up created, review opened, …). Retracted and already-superseded findings are excluded.
- `prior_assessment` (≤ 1): the Move assessment the Outreach record shows (scores, work status, promised callbacks, next steps).

Everything on this page is labelled to the model as an earlier model output, never as a fact about the customer.

## Step 3 — Findings (`minimalFindingsSchema` → `csi-envelope-v1`)

**Shown.** `{ subject_scope, calls: [{call_index, summary, said_on_call}], context: {records, coverage, allowed_followup_ids}, story: {opening, events: [{index, id, at, sentence}], tail, granot_state, candidates}, prior: {summaries, number_synthesis, findings: [{index, id, kind, description, actor, action_status, review_state, at, effects}], assessment}, instructions, owner_corrections }`. Transport metadata (snapshot ids, field paths) is stripped; the model cites calls by `call_index` + segment ids and records by `record` type + id.

**Returns.**

- `summary`: the six sections, written as the current state of this customer's move with Vantage (not a recap of one call).
- `findings[]`: the taxonomy above, each with `basis` (`said_on_call` | `vantage_record` | `model_inference`), `actor`, `clarity`, `action_status` and evidence citations.
- `next_step`: one suggested action (`call`, `text_customer_via_lead_message`, `send_estimate`, `check_availability`, `review`, `wait`, `reconcile_identity`, `other`) with rationale; may target only a listed follow-up id.
- `owner_instruction_assessments[]`: agrees / disagrees / cannot_determine per Owner instruction shown.
- `prior_finding_relations[]` (new): for every prior finding shown, `relation` ∈ `still_true | superseded | fulfilled | contradicted | cannot_determine`, the index of the new finding that supersedes it (if any), evidence and a note.
- `story_discrepancies[]` (new): story events a call contradicts (a text the customer says never arrived, a callback the story shows was made, a booking the story does not show), with evidence.

**Server.** `expandStructuredFindings` turns indices into record ids and snapshot citations, refuses anything not captured (`record_not_in_context`, `segment_not_in_summary`, `prior_not_observed`, `story_event_not_observed`), and produces the accepted envelope. `submitIntelligenceAnalysis` writes `output` (accepted) and `raw_output` (the exact provider object) in one finalizing update. The application job then, per finding, creates or completes follow-ups, sets contact type, pauses channels or opens review items (see the analysis Service); and per relation (`relations.ts`) links `superseded_by` with a `supersede` effect on an unreviewed prior (`blocked_owner` if the Owner confirmed or corrected it), opens `prior_fulfilled_unclaimed` when the prior's follow-up is still open with no completion claim, opens `prior_contradiction`, and opens `record_disputed_on_call` for a disputed sent text or completed follow-up. Publication updates the conversation's summary or the number's running summary. Nothing in this path retracts a finding, closes work or overrides an Owner instruction.

## Move assessment (`assessment/contract.ts`, `move-assessment-v1`)

Nominated after every summary step for the Outreach subject of the number; its own context (`assessment/context.ts`): Lead views (original submission vs canonical current), official flags, Owner corrections, every call summary with `move_evidence`, retained findings of seven kinds. Returns `scores` (`transaction_intent`, `move_likelihood`: level, confidence, rationale, evidence ids, conditions), `move_details` (locations, date window, size, service, access, money), `inventory` (items, coverage, limitations), `conflicts`, and `engagement` (`work_status`, promised callbacks, next steps). The server maps levels to numbers, publishes the artifact onto the Outreach record and applies deterministic band effects and follow-ups from `engagement`. The findings step sees the published assessment as a `prior_assessment` record; the assessment does not read the story.

## Where to look at a run

- Owner: Analysis route → Full output shows the model object (`raw_output`) and the accepted envelope separately, with the summaries and evidence chain.
- Server: `IntelligenceRun.step_artifacts = { summaries[], context, story, prior, *_digest, lineage: { prior_run_ids, prior_summary_ids, prior_finding_ids, assessment_artifact_id, story_events, story_from, story_to } }`, `predecessor_run_id`; snapshots in `intelligence_evidence_snapshots` by `run_id` and `source_type`.
- Agents and operators: the general MCP endpoint's history tools (`get_subject_story`, `get_prior_analyses`, `list_analyses`, `get_analysis`, `get_conversation`, `get_move_assessment`, `get_lead_history`, `find_contact_number`, `find_lead_candidates`) call the read-only routes under `/api/v1/internal/sales-intelligence/history/*` and return exactly the pages the model read.
- Locally: `scripts/dev_ops/inspect-story.ts <number_id | +1phone | lead:Model:id>` prints the story and prior page; `scripts/dev_ops/inspect-context-run.ts <run_id>` prints a run's relations, discrepancies, effects and review items.

## Versions and replay

Prompt and schema versions are pinned on the run (`prompt_version`, `step_contracts`, `schema_digest`). A run checkpointed before a prompt bump fails once with `ORIGINAL_EVIDENCE_UNAVAILABLE` and is re-prepared; an `original_evidence` replay reproduces exactly the pages its parent saw (a parent from before the story/prior pages replays without them). Envelope schema digests of earlier renderings stay recognised (`LEGACY_SCHEMA_DIGESTS`). Story and prior pages are not part of the scheduling fingerprint: a Priority change or a text does not by itself trigger a new run.
