# 19 — Task specification: Sales Intelligence system walkthrough and Owner demo backfill

Date: September 21, 2026. Assigned agent: Fable 5.1. Requested by the user after the [18 efficiency implementation](18-efficiency-implementation-2026-09-21.md).

Two deliverables, in order. Deliverable 1 is a written report for the user personally. Deliverable 2 is a backfill of four real Number↔Lead connections through the full pipeline, with evidence the Owner can be shown on the desk.

## 0. Read before doing anything

1. [18 — efficiency implementation](18-efficiency-implementation-2026-09-21.md): what changed on branch `feat/sales-intelligence-efficiency`, including why analysis was paused (per-recording admission) and how the Owner now sees admission.
2. [17 — handoff](17-storage-throughput-and-llm-efficiency-handoff.md) §3 product model and §4 baseline numbers.
3. Service docs, in this order: [foundation](../knowledge/services/sales-intelligence-foundation.md), [webhook fan-out](../knowledge/services/sales-intelligence-webhook-fanout.md), [number activity capture](../knowledge/services/number-activity-capture.md), [attachment](../knowledge/services/sales-intelligence-attachment.md), [outreach](../knowledge/services/sales-intelligence-outreach.md), [recording media](../knowledge/services/sales-intelligence-recording-media.md), [transcription](../knowledge/services/sales-intelligence-transcription.md), [analysis](../knowledge/services/sales-intelligence-analysis.md), [live](../knowledge/services/sales-intelligence-live.md).
4. Product contract: [01 specification](../call-sales-intelligence/01-specification.md), [03 pipeline and jobs](../call-sales-intelligence/03-server-pipeline-and-jobs.md), [10 intelligence agent contract](../call-sales-intelligence/10-intelligence-agent-contract.md), [13 number analysis surfaces](../call-sales-intelligence/13-number-analysis-surfaces.md).
5. Glossary: workspace-root `CONTEXT.md`. Use its words.

Starting state of the checkout: branch `feat/sales-intelligence-efficiency` in `vantage-main-server` holds uncommitted work (18 §3 lists the files) plus the older uncommitted Attention chunking work. Do not discard either. Decide with the user whether to commit before deploying; nothing in this task requires a commit, but Deliverable 2 requires the deployed API to be current (see §3.2).

## 1. Constraints that apply to both deliverables

- **Never print, log or paste a customer phone number, name, transcript line or audio.** Every existing `scripts/dev_ops` inspector prints redacted ids and job numbers only; keep that standard. Reports refer to subjects by Job Number, Contact Number id and Outreach Record id.
- **Production database is `vantagemovers` behind `MONGO_URI` in `.env`.** Reads are fine. Every write must be an explicit, narrow, idempotent command through existing services (enqueue a durable job, run a worker, issue an Owner command), never a raw update. Do not delete anything. Do not touch `vantagemovershistorical`.
- **Budget.** Analysis reserves against the Owner's monthly ceiling ($80) and per-recording ceiling (25 cents). Four conversations plus up to four number syntheses is well within both. Do not raise either ceiling without asking the user; if admission refuses, report the `analysis_admission` evidence and stop.
- **Flags.** Production flag values live in the gitignored `sales-intelligence.env` (local copy) and in the Vercel project. `MEDIA_ENABLED`, `STT_ENABLED`, `EXTRACTION_ENABLED`, `ATTACHMENT_REFRESH`, `OUTREACH_ENSURE` and `PROVIDER_READS` gate the stages you need. Read them from the Owner coverage endpoint (`flags`) before planning; do not change a production flag without asking.
- **Model provider.** The extraction model is `openai/gpt-5-mini` through the AI Gateway (`CSI_EXTRACTION_MODELS` allowlist). The Owner's Anthropic spend is not an instruction to switch providers.
- **Local proof first.** Replica suites run against the Docker `csi01` replica set on `127.0.0.1:27189` (`pnpm test:csi:*:replica`). Prefer proving a step locally with synthetic fixtures before touching production.

## 2. Deliverable 1 — the walkthrough report

**Audience:** the user, personally. Technical, but a narrative that can be read top to bottom in one sitting, not a code index. Roughly 2,500–4,000 words. Diagrams as Mermaid. Save it as `docs/call-sales-intelligence-new/20-how-sales-intelligence-works-walkthrough.md`.

**Required shape: follow one call from trigger to completed Outreach and analysis**, naming at each hop the trigger, the durable job stage, the worker, the collections written, what the Owner sees, and what can stall. Cover every hop below. For each, cite the file and function so the user can open it, but keep code out of the prose.

1. **Triggers.** RingCentral webhook (`api/queues` consumer and receipt), call-log reconcile cron, Owner-planned historical backfill. What a Call Interaction is, how identity is chosen (telephony session, session id, call log id), when a call becomes terminal, and how recordings are observed.
2. **Contact Number.** Normalization to E.164 and `national_ten`, classification (`customer`, `company`, `non_customer`, `unknown`), eligibility, `last_activity_at`, rollups, the search terms the Numbers view searches.
3. **Number↔Lead attachment.** Evidence kinds (exact RingCentral identity vs phone-in-window), the Form Lead and Call Lead windows, candidate → ambiguous → attached → rejected, `AUTO_ATTACH` and its 0.90/0.95 confidence rule, Owner attach/reject/detach, `resolveAtInteraction` at event time, and why `likely` is enough to attach but not enough to let a finding change Outreach. Explain what the desk's provenance badge means in each state.
4. **Outreach.** What creates an Outreach Record (Lead arrival, unanswered inbound, Owner open, clear sales commitment), the states, how a call moves it (`ensureInteraction`: attributable attempt, human conversation, missed episode), follow-ups and waits, the staffed clocks (30 / 15 / 1440 staffed minutes, Eastern, Monday–Saturday), how bookings and cancellations close it through EntityChange and the Lead repair sweep, and the bounded maintenance from 18 §1.
5. **Attention.** The seven bands in order, that the lowest matching band wins, that bands are derived on read and republished every minute into an immutable snapshot, and what `pending_projection` means.
6. **Recording discovery and media.** Eligibility decision (`decideAnalysisEligibility`: lead-linked, number review, mapped sales inbound, reviewed rep outbound; excluded internal/company/non-customer), the recording availability window, private blob storage, retention clocks.
7. **Transcription.** Budget reservation, immutable redacted transcript versions, the `analysis` job it enqueues.
8. **Analysis.** Run preparation and pinning (prompt version, schema digest, permitted tools), the scoped MCP in `vantage-movers-mcp`, what is preloaded before the model loop (context, activity, leads, bookings, rep identity, transcript), the bounded loop (4 steps, one repair), submission receipt, admission (period, per-recording, monthly) and what pauses look like.
9. **Application.** How findings become effects (`applyOutreachEffect`), the plan statuses (`applied`, `no_change`, `blocked_identity`, `blocked_owner`, `blocked_closed`, `needs_review`, `stale`), Owner precedence, restrictions, the `outreach_binding_unavailable` case, and number synthesis (`number_refresh`, fingerprint, Running Summary).
10. **What the Owner sees where.** Map each stored artifact to the desk: Attention row, Number detail tabs (Activity, Running Summary, Number Analysis, Matches, Work), Coverage, Settings, Reps. Include the new admission card and the Lead-actionable vs number-only note.
11. **Failure and stall catalogue.** One table: symptom on the desk → stage → stored evidence to inspect → the script or query that shows it. Include: `pending_projection`, empty bands, `budget_exhausted` vs `per_recording_ceiling`, `eligibility_undetermined`, `recording_pending`, `permission_denied` on recordings, `schema_exhausted`, `bounds_exhausted`, `incomplete_coverage`, `outreach_binding_unavailable`, deployed API behind `main`.

Method: read the Service docs and the code they cite. Where a doc and the code disagree, the code on this branch is the truth; note the discrepancy in an appendix so the docs can be fixed. Verify at least the band order, the clocks, the eligibility reasons and the admission reasons directly in source. Do not invent behaviour from memory.

## 3. Deliverable 2 — Owner demo backfill on four real connections

### 3.1 First, find out what happened to the earlier records

The user believes three or four banded Outreach records were created earlier and later disappeared. Establish which of these is true before backfilling, and put the answer at the top of the evidence report:

- The earlier work targeted three subjects (job numbers `5564662` and `5564549` plus one unbooked Call Lead) with `scripts/run-csi-attention-subjects.ts`, `scripts/status-csi-attention-subjects.ts`, `scripts/inspect-csi-run-blockers.ts` and `scripts/continue-csi-booked-analysis.ts`. Run the status script first.
- Likely explanations, each checkable read-only:
  - **The desk was stuck, not the data.** As of this morning the deployed API is behind `main` and Attention returned `pending_projection` with no items (see the memory note "Sales Intelligence deployed API is behind main" and 17 §4). Check `GET /api/v1/admin/sales-intelligence/attention` on production and the newest `sales_intelligence_attention_snapshots` document.
  - **Booked subjects are closed, not banded.** A Lead that is booked or cancelled closes its Outreach Record through official closure (`officialClosure`), and closed records never carry a band. The two booked subjects were never going to appear in Attention; they appear under Numbers with a closed Work tab and, once analysed, a Running Summary. Say this plainly to the user.
  - **Analysis never completed.** 306 of 355 runs were paused `budget_exhausted` because the 12-step reservation exceeded the 25-cent per-recording ceiling (18 §1). Check the runs for the three subjects and their `processing_reason`.
  - **Records still exist.** Query `outreach_records` by `subject.id` for the three Leads; `purged_at` and `closed_reason` tell the rest. No migration in the CSI models deletes rows; retention only purges content past its clock.

### 3.2 Preconditions

- Deployed API at or beyond the commit you are demonstrating. Confirm via the Owner coverage read (`analysis_admission` present means branch 18 is deployed) or by an endpoint that exists only on the target revision. If it is behind, stop and tell the user; a demo against a stale deploy will reproduce the symptoms from §3.1.
- `analysis_admission.status` is `admitted` with an estimate at or under the per-recording ceiling. If it is `per_recording_ceiling`, the Owner can raise the ceiling in Settings or the deployment can set `SALES_INTELLIGENCE_ANALYSIS_LIMITS_JSON`; either is the user's decision.
- Flags on: `ENABLED`, `ATTACHMENT_REFRESH`, `OUTREACH_ENSURE`, `MEDIA_ENABLED`, `STT_ENABLED`, `EXTRACTION_ENABLED`. `PROVIDER_READS` if any recording still has to be fetched from RingCentral.
- An Owner credential that works against the deployed Admin, so the desk can be checked in a browser. Ask the user; do not reset passwords or use the seed values.

### 3.3 Selection criteria — exactly four subjects

Search the production database read-only. Print only redacted ids and job numbers. Candidate queries start from `lead_conversations` and `call_interactions`, not from Leads:

- A conversation with usable audio: `lead_conversations` where `media.blob_pathname` is a string and `media.purged_at` is null (already stored), or `call_interactions.recordings` non-empty with `recording_discovery.state` not `no_recording` and the recording inside the provider availability window. Prefer already-stored media; it avoids provider reads.
- Its Call Interaction is terminal, direction Inbound or Outbound, not Internal, not monitoring, and its Contact Number is `kind: external` with classification `customer` or `unknown`.
- An attachment edge exists on that Contact Number with `state: attached` (certainty `exact` or `owner_confirmed`, or `likely` if `AUTO_ATTACH` promoted it) to a Form Lead or Call Lead whose window covers the call. Use `resolveAtInteraction` semantics, not lifetime counts: the call must resolve to exactly one Lead. This is what makes the analysis Lead-actionable rather than number-only.
- **Two booked:** the attached Lead has `booked` set (or a `booked_leads` row with matching `lead_ref`/`lead_model`), ideally with a cancellation absent. Expected outcome: Outreach closed `booked`, analysis completes, effects `blocked_closed`/`no_change`, Running Summary populated, findings visible on Number Analysis. These demonstrate "the system knows this customer booked" and the transcript intelligence.
- **Two not booked:** the attached Lead has no booking and no cancellation, `duplicate`/`bad_lead`/`no_sync` unset. Prefer one Form Lead and one Call Lead, and prefer calls with a spoken commitment or callback (the transcript will show it) so an effect can actually create a follow-up. Expected outcome: Outreach `open` or `unworked`, a band on Attention, analysis completes, at least one effect `applied` or `needs_review` with a follow-up or review item on the Work tab.
- Exclude numbers with an active contact restriction, numbers whose Lead pair the Owner rejected, and numbers already used as the three earlier subjects unless the user prefers continuity.

Present the shortlist (up to eight candidates with why each qualifies) to the user before running anything that costs money. Then proceed with the four the user picks.

### 3.4 Execution — one subject at a time, verified at each hop

For each subject, run the pipeline through existing workers and durable jobs, and record the job ids, run ids and timestamps:

1. **Attachment.** If the edge is missing or only `candidate`, enqueue an `attachment-lead:` refresh for the Lead (or have the Owner attach it on Matches). Verify the edge and the Outreach `lead_attachment` mirror.
2. **Outreach.** Confirm the Outreach Record exists, its state, and that every call on the number has been applied (`outreach_call_applied` audit rows). If not, enqueue `outreach-number:` replay for the number revision (branch 18) or the per-call `number:` job.
3. **Recording discovery and media.** Confirm `lead_conversations.state` reaches `media_stored` with `media.blob_pathname`. If audio must be fetched, the `media_fetch` job needs `PROVIDER_READS`; the existing `scripts/continue-csi-booked-analysis.ts` shows the shape.
4. **Transcription.** Confirm an `intelligence_evidence_snapshots` transcript row with `completeness.complete` and the conversation's `latest_transcript_version`.
5. **Analysis.** Let the `analysis` job run through the extract cron or the queue; do not call the provider yourself. Verify the run reaches `submitted` then `completed`, `usage` is recorded, and the reservation is reconciled. `scripts/dev_ops/enqueue-named-csi-analysis.ts` is the reference for enqueuing a named conversation that already has a transcript.
6. **Application.** Verify effects and their statuses, follow-ups created, review items opened, and the Outreach revision moved.
7. **Number synthesis.** Verify a `number_refresh` run completed and `contact_numbers.running_summary` is populated.
8. **Attention.** Verify the next published snapshot contains the two unbooked subjects with the expected band and that the two booked ones are absent from Attention but present under Numbers.

Use `scripts/measure-csi-efficiency.ts` before and after so the report can state job growth for the whole exercise.

### 3.5 Evidence report for the user

Save as `docs/call-sales-intelligence-new/21-owner-demo-backfill-evidence-2026-09.md`:

- §3.1 answer: what happened to the earlier records, with the queries that show it.
- The four subjects: Job Number, Lead model, Contact Number id, Outreach id, attachment certainty, booked or not, call date.
- Per subject, the hop table from §3.4 with ids, timestamps and any stall and how it was cleared.
- Model usage and cost per subject from `intelligence_runs.usage` and the reservation rows; unknown cost reported as unknown, not zero.
- A short Owner walkthrough script: for each subject, which view to open on the desk and what he will see (band, provenance badge, Running Summary, findings, follow-up on Work, Lead-actionable or number-only note).
- Before/after aggregates from `measure-csi-efficiency.ts`.
- Anything the demo cannot show yet and why.

## 4. Acceptance

- Deliverable 1 exists, covers all eleven sections, and every behavioural claim was verified in source on the branch; discrepancies with the Service docs are listed.
- Deliverable 2: four subjects processed end to end; two closed-by-booking with completed analysis and Running Summary; two open with a band on the published Attention snapshot and completed analysis with at least one visible effect or review item; total analysis cost reported; no phone numbers or transcript text in any file or chat message; no raw database writes; no flag or ceiling changed without the user's explicit yes.
- The §3.1 question is answered in one paragraph the user can repeat to the Owner.

## 5. If blocked

State the blocker, the evidence, and the smallest decision that unblocks it, then continue with everything that does not depend on it. Typical blockers: deployed API behind `main`; admission refusing at the per-recording ceiling; no working Owner credential; recordings outside the provider availability window (choose different subjects); `PROVIDER_READS` off when media must be fetched.
