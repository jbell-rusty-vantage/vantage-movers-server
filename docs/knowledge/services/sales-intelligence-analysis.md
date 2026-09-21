---
okf_version: "0.2"
type: Service
title: Scoped Intelligence runtime, evidence and application
description: Scoped MCP evidence, bounded agent execution, durable application, current number analysis and exact-version Owner interventions.
tags: [sales-intelligence, durable-work]
status: draft
stale_after: 2026-12-19
resource: src/services/salesIntelligence/analysis/submit.ts
applies_to:
  - src/services/salesIntelligence/analysis/ownerCommands.ts
  - src/services/salesIntelligence/analysis/ownerReads.ts
  - src/services/salesIntelligence/analysis/ownerReanalysis.ts
  - src/services/salesIntelligence/analysis/contracts.ts
  - src/services/salesIntelligence/analysis/run.ts
  - src/services/salesIntelligence/analysis/lease.ts
  - src/services/salesIntelligence/analysis/reads.ts
  - src/services/salesIntelligence/analysis/operational.ts
  - src/services/salesIntelligence/analysis/capture.ts
  - src/services/salesIntelligence/analysis/submit.ts
  - src/services/salesIntelligence/analysis/runtime.ts
  - src/services/salesIntelligence/analysis/coverage.ts
  - src/services/salesIntelligence/analysis/worker.ts
  - src/services/salesIntelligence/analysis/apply.ts
  - src/services/salesIntelligence/analysis/readiness.ts
  - src/services/salesIntelligence/analysis/sources.ts
  - src/services/salesIntelligence/analysis/scheduling.ts
  - src/routes/sales-intelligence-internal.routes.ts
owners: [team:main-server]
sources:
  - id: contract
    resource: docs/call-sales-intelligence/10-intelligence-agent-contract.md
  - id: handoff
    resource: docs/call-sales-intelligence/workspace/evidence/csi-17/HANDOFF.md
---

# Scoped Intelligence runtime, evidence and application — CSI-17/13

## CSI-15 historical admission and retention

Historical-only interaction provenance flows through discovery/media/STT to lower-priority analysis and stored `backfill` run mode. Existing live priority 0 outranks historical -100, including explicit queue delivery. Provider Retry-After, permission and budget admission use durable pause/retry semantics without consuming a genuine-failure attempt; raising the ceiling or activating a period resumes the saved stage. These paths reuse the original run/job rather than retranscribing completed source audio.

Retention marks purged runs and source snapshots, erases copied content through privileged raw transactions, and invalidates derived conversation/number summaries. Since derived context does not carry complete transitive provenance, retention conservatively invalidates the affected number's analysis cache while retaining newer source transcripts. Batches cover at most 50 runs; a started-purge marker blocks source reads until completion. Capture, authorized reads, submission and application check retention state/fences; a held copy must not republish erased evidence. Owner evidence reads expose non-content tombstones and original-evidence reruns return `ORIGINAL_EVIDENCE_UNAVAILABLE`. Audio expiry alone does not erase a still-retained transcript. The dedicated [CSI-15 checks](../../call-sales-intelligence/workspace/evidence/csi-15/CHECKS.md) distinguish implemented assertions from completed proof.

Main server determines authority from a stored Intelligence Run and its active leased job. The dedicated MCP endpoint in `vantage-movers-mcp` exposes bounded reads and one submission. It grants no Owner command, Lead/Booking mutation, attachment, customer message, or rep message. CSI-13 executes the bounded agent and applies permitted findings through the existing Outreach commands; CSI-18 Owner correction/confirmation/reanalysis controls remain separate.

## Admission, runtime limits and drain (September 21, 2026)

`analysis/admission.ts:decideAnalysisAdmission` is the pure admission for one invocation. It returns one of three distinct refusals with the evaluated, non-secret numbers (`AdmissionEvidence`: estimated cents, per-recording ceiling, month, remaining cents, model, pricing version, runtime limits): `no_active_period`, `per_recording_ceiling` (conversation analysis only; number synthesis is not gated by the per-recording ceiling), `monthly_budget`. `reserveCsiBudget` remains the atomic monthly authority; the pre-check only reports. The worker persists the evidence on the paused job's `result.admission` and sets the run's `processing_reason` to the refusal, so a paused run is reproducible from stored data.

The per-recording refusal pauses the job with its own reason, `per_recording_ceiling`. `resumeBudgetPausedJobs` does not touch it; `updateCsiPolicy` resumes it only when the per-recording ceiling rises. Period and monthly refusals keep `budget_exhausted`, resumed by period activation or a monthly increase. Before this change every refusal was `budget_exhausted`, and a job whose single invocation exceeded the ceiling was re-admitted and refused again on every drain: 306 of 355 stored runs were paused this way while the month still held $63.68.

`DEFAULT_RUNTIME_LIMITS` are 4 steps, 128k context bytes, 8k output tokens, 512k/32k cumulative tokens, 95 s elapsed. Evidence is captured before the provider loop, so the contract's target is one submission and at most one repair; the previous 12-step reservation (1.5M input tokens) exceeded the default 25-cent per-recording ceiling at list pricing, and its 180 s elapsed limit could never finish inside the deployed 120 s function, which is how a started reservation is left unresolved. `SALES_INTELLIGENCE_ANALYSIS_LIMITS_JSON` still overrides. The reservation formula is unchanged and still funds every configured step.

`drainIntelligenceJobs` processes jobs until `INTELLIGENCE_DRAIN_BUDGET_MS` (105 s) would not leave room for one more full invocation, instead of exactly one job per cron. Signals, no-ops and stale checks finish in well under a second, so a queue of 1,434 `number_refresh` signals no longer drains at one per five minutes. `readOwnerCoverage` exposes `analysis_admission` (status, evidence, paused counts by reason, and started reservations older than an hour that never reported complete usage; their estimate stays reserved on purpose). `leadRelevance` uses the indexed normalized phone paths from `leadContactPhoneIndexes`, the same join the attachment worker uses, instead of an unanchored raw-phone regex.

## Entry points and authority

`prepareIntelligenceRun(lease, input)` in `analysis/run.ts` is a trusted orchestration seam, never an MCP tool or HTTP run-creation endpoint. It requires an existing leased `analysis` or `number_refresh` job, freezes the rendered prompt/version/schema digest, and issues the existing signed run credential. `recoverIntelligenceSubmission(runId, lease)` is the trusted worker seam when the model credential expires. `renderIntelligencePrompt` and `intelligenceSchemaDigest` expose exact pinning inputs. The schema derives from the strict `csi-envelope-v1` Zod contract.

The internal router adds these endpoints after the existing CSI boundary:

| Method and suffix under `/api/v1/internal/sales-intelligence/runs/:id` | Behavior |
| --- | --- |
| `GET /context` | Captured `get_intelligence_context`; empty arguments |
| `POST /read` | Closed `intelligenceReadSchema` discriminator and strict per-tool arguments |
| `POST /submit` | Immutable intake; `202 {run_id, submission_id, application_job_id, status:"submitted"}` |
| `GET /submission` | Pure receipt/status and pinned prompt context read |

Both the named dedicated scoped key and `x-vantage-intelligence-run-token` are required. Browser Owner, broad secret, or token alone are insufficient. `requireCsiRun` verifies signature, run/subject/tool/dataset/deployment/nonce/expiry and lease epoch. `loadAuthorizedRun` and `fenceAuthorizedLease` recheck stored authority inside capture/intake transactions. The job write fence prevents a concurrent lease loss from committing evidence or a submission under stale authority.

## Read contract

`loadReadScope(storedRun)` derives Contact Number, conversation, Outreach subject, relevant Lead edges and RingCentral account from server joins. A conversation must belong to the run's Contact Number; a supplied Outreach Record must match the number and, for nonconversation subjects, the exact subject. A validated conversation subject may include a persisted same-number Outreach pointer chosen by trusted orchestration; its actual Lead subject is included when reading Owner instructions. No supplied ObjectId establishes read authority. For conversation analysis, the CSI-12 snapshot in the analysis job's `input_refs[1]` pins transcript evidence despite a newer conversation cache.

`readIntelligenceEvidence(scope, input)` returns `ReadContent`: a strict `ReadPage`, optional immutable transcript page, Coverage, permitted followup IDs, observed Owner instruction revisions, and reviewed speaker references. `readContentSchema` is exported for capture and replay validation. The transport adds server-owned snapshot ID, content digest, tool and retrieval time.

| Read | Official source and bounds |
| --- | --- |
| Context | CSI Contact Number/attachment/restriction/instruction/Outreach/followup models; official pure `stateWithActions` derives Outreach state. At most 100 edges, instructions and followups, 50 restrictions, and 200 returned records. Oversize context fails closed instead of omitting Owner precedence. |
| Lead search/get | Dataset-scoped `form_leads` / `call_leads` projections, shared any-known-contact phone paths and `normalizePhoneNumberForMatch`; relevant Lead edges or matching full number only. Default page 20, maximum 50. User query is escaped text, never a filter document. |
| Booking search/get | `booked_leads` matching bounded relevant Lead references or their Job Numbers. Relevant-Lead expansion exceeding 100 fails closed. An arbitrary Booking ID is denied. |
| Cancellations dataset | `readCancellations` projects `cancelled_leads` through relevant Booking IDs or Lead/live snapshot references. Immutable Lead correlation snapshots preserve scoped visibility after a Booking disappears. Related Lead/Booking sets are capped at 100; foreign IDs fail closed. |
| Number activity | Official `getNumberTimeline`, including canonical interactions, messages, conversations and Outreach history. Preflight guards its attachment/Outreach joins at 100 and its recording-interaction scan at 2000; no provider refresh or domain writes. |
| Transcript | Existing immutable CSI-12 snapshot; Mongo `$slice` returns at most 100 segments. Version, source snapshot ID, nullable timing, timing source and unknown speaker survive. No STT or media access. Missing transcript is explicitly incomplete. |
| Rep Identity | Scoped canonical Call Interaction's user extensions and call time; bounded link query (100) feeds official pure `resolveRepIdentityAt`. Half-open historical intervals permit reviewed retired links before their end; proposed/conflicting/unknown links never create Agent authority. |
| Operational datasets/provider reads | `analysis/operational.ts` closed datasets and fixed scoped RingCentral read adapter. The owner-requested additions do not accept Mongo operators, collections, arbitrary URLs or provider credentials in arguments. See CSI-17 handoff/contracts for precise added tools. |

Broad official CRUD services import global models and mutation dependencies, so scoped Lead/Booking reads reuse pure normalization/search vocabulary with explicit configured-dataset projections instead of importing those services. Likewise `outreach/reads.ts` imports nudge history and performs unbounded joins: the Intelligence context uses its official state helper over explicitly bounded model reads. This adaptation does not duplicate a write invariant or invoke nudge code.

Lead/Booking cursors bind run, dataset/model and search string with an ObjectId keyset; merged Lead pages use the total order `(ObjectId, model)` so equal IDs in different collections remain reachable. Strict decoding rejects operator injection and cross-filter reuse. Activity wraps the official timeline cursor in a strict run binding. Transcript cursors bind run and immutable snapshot plus segment offset. A partial transcript page has `complete:false`, `segments_before:N` / `segments_after:N` missing ranges, and a next cursor where applicable; the final page never claims the entire transcript was returned when earlier segments are absent. Text projections redact through the existing transcript redactor and reject excessive free text rather than silently truncating it.

## Capture, replay and durable intake

`captureIntelligenceRead` captures each normalized tool+arguments response once per run. Repeated and concurrent equivalent reads converge on the immutable stored response. Each transaction increments the run revision/evidence counters and fences the job lease. Limits are 128 captured responses, 512,000 bytes per response, and 8,000,000 evidence bytes per run. Reads compute evidence before the transaction; only captured responses leave the boundary. Finalization conflicts with late writes, so no read silently enlarges a submitted manifest.

Original-evidence runs retrieve the parent's retained tool response for the exact normalized call, preserve its data/retrieval time, and append a new run-scoped snapshot. They never fall back to current reads. Missing retained response/prompt/manifest or a missing transcript source required at intake yields `ORIGINAL_EVIDENCE_UNAVAILABLE`.

`submitIntelligenceAnalysis` strictly parses one envelope and assembles authorization only from persisted snapshots: record IDs and exposed field paths, transcript versions, reviewed speaker references, observed Owner instruction revisions and followup targets. The model supplies assertions, never its own manifest. Exact quotation/timestamp/entailment checks remain deferred.

Envelope, immutable receipt, finalized run/manifest, audit and one `application` job commit atomically. An identical run/key/envelope replays the same receipt; changed key or payload conflicts. The application job is durably paused with `invocation_pending` while the enabled orchestrator finishes, otherwise `consumer_unavailable`. `resumeApplicationIntents` validates the exact run/submission/job binding before resuming compatible legacy intents; other reasons remain paused. Receipt recovery resolves uncertain delivery without a second run or application job.

## CSI-13 runtime and scheduling

`analysis/worker.ts:runIntelligenceJob(jobId?, stage?, deps?)` is shared by the existing queue dispatcher and cron recovery for `analysis` and `number_refresh`. `analysis` retains CSI-12's immutable `[conversation_id, transcript_snapshot_id]`; `conversationAnalysisInput` rechecks current eligibility, transcript version and media digest before any provider work. `numberAnalysisInput` selects currently eligible pinned transcripts and rechecks their versions before synthesis; it returns terminal `no_transcript_evidence` when none remain, so a record-only number refresh does not reserve budget or invoke the provider. Neither invokes transcription. Existing Outreach `number_refresh` intents become coalesced number-owned jobs without mutating their original subjects. `scheduleNumberIntelligence` stores a meaningful-source fingerprint and generation on ContactNumber; only one active job exists per number and publication/recovery schedules at most one successor for changed sources. The existing SyncState/lease infrastructure scans five numbers per sweep. Generic updatedAt, clocks, and semantically unchanged replacement finding IDs are excluded; oversized source sets create a visible paused intent.

`analysis/runtime.ts:invokeIntelligenceAgent` uses installed AI SDK `ToolLoopAgent` through AI Gateway and the remote HTTP `/api/intelligence-mcp`. Both dedicated headers come from trusted orchestration. It retrieves `sales_intelligence_analyze_v1` and `csi://schemas/csi-envelope-v1`, checks exact stored prompt and schema digest, and exposes exactly the delivered twelve remote tools. The AI SDK/MCP packages have different provider type versions; each AI tool is built from the discovered remote JSON schema and forwards execution only to MCP. There are no direct domain/model tools.

Before invocation, bounded MCP pagination captures context, activity, official Leads/Bookings, reviewed identities and all selected transcript pages. Number context includes original conversation findings and transcripts, not only generated summaries. Each page is durable captured evidence. Incomplete/oversized coverage pauses visibly; nullable timing/speaker remains usable. The default ceiling is 8 steps, 128,000 conservative UTF-8 bytes per context (an upper token bound), 6,000 output tokens per step, 512,000 cumulative input tokens, 24,000 output tokens, 120 seconds and 80 preflight pages. Provider retries are disabled. At most one schema repair is allowed, with invalid submissions counted durably across retries. `INVALID_INPUT` returns sanitized Zod issue paths (no submitted claims, quotes, or received values) so the model can repair; those paths are also logged. Only a durable receipt is success; final prose is insufficient, and uncertain submission is recovered before more model work.

Reserve the complete bounded loop from the existing activated shared budget, including per-step integer-cent rounding. Explicit positive input/output prices and a pricing version are required; no dated catalog price is billing truth. Each reservation records model, pricing and input/output/reasoning usage. Completed invocations reconcile unused reservation, including bounded invalid/prose-only outcomes. Pre-provider failures release it; missing cost or ambiguous provider termination retains unresolved reservation and nullable run cost. A changed configured model cannot silently replace a running run's pinned model. Allowed extraction models are `CSI_EXTRACTION_MODELS`: `openai/gpt-5-mini`, `openai/gpt-5-nano`, and `openai/gpt-5.6-luna`. Budget/policy initialization remains outside this worker.

Registration reuses the existing bootstrapped queue consumer and cron router: `/api/cron/sales-intelligence-extract` and `/api/cron/sales-intelligence-apply`, every five minutes, plus minute recovery. `ENABLED` and `EXTRACTION_ENABLED` default off; application additionally requires `OUTREACH_ENSURE`. Failed wakeup publication leaves durable pending intent. No application attempts are consumed while disabled.

## CSI-13 application and publication

`analysis/apply.ts:runIntelligenceApplicationJob(jobId?, deps?)` consumes `[run_id, submission_id]`, verifies immutable envelope and manifest digests, and persists at most five findings per fenced transaction. Finding cursor, CSI-06 effects and review outcomes commit together; retries resume at the cursor. Date/money wording is preserved and resolved server-side. One finding can record Number Review creation and a followup outcome. Number synthesis persists findings and publishes number analysis; conversation extraction owns operational commitments.

`applyOutreachEffect` remains semantic authority for Owner precedence, historical fulfillment/official closure, restrictions, assignments, safe revisions and cross-run commitment matching. Its narrow conversation adapter requires the persisted Outreach pointer, exact source conversation/interaction, same primary number and current authoritative event attachment. Candidate/likely matches and foreign records cannot grant Lead effect authority. Number-only clear commitments use `ensureNumberReview`, never Lead creation. Unknown identity cannot assign a rep. Promised-by, action responsibility and overall Outreach responsibility remain distinct.

Application rechecks current records and captured followup revisions. Prior same-conversation assertion overrides require review rather than revival. Unclear/missing targets remain review; strategy stays suggestion-only. Booking/payment/objection/competitor/non-sales evidence never writes official records or sends messages. Number-only restrictions call the existing `applySpokenRestriction`; unresolved until/unclear restrictions remain review. `outreach/effects.ts:applyUnboundContactTypeEffect` shares contact-type decisions and `ensureInteraction` transitions when no Outreach exists, updates conversation and interaction provenance, and preserves Owner contact-type decisions. Snapshot membership/scope, at least one captured transcript, and complete captured transcript page chains are mandatory: every captured page for a conversation must be reachable exactly once from its initial cursor, so duplicate-cursor or orphan pages fail the gate. Locator and entailment remain `not_run`.

Publication occurs only after every finding batch, independent of blocked/permitted effect counts. It publishes the compatible conversation summary/current-run pointer or ContactNumber running summary and completes the run/job transactionally. Newer current runs cannot be overwritten by older workers; replaced or newly ineligible transcript sources also prevent current publication. CSI-18 Owner reruns carry server-authorized correction references and explicit correction context; ordinary runs keep an empty correction selection.

Runtime configuration and synthetic proof details: [CSI-13 handoff](../../call-sales-intelligence/workspace/evidence/csi-13/HANDOFF.md). No live model quality or deployment is established by these tests.

## Proof and operations

`node --import tsx --import ./scripts/test-setup.ts --test src/services/salesIntelligence/analysis/reads.test.ts` passed 4 synthetic tests. `node --import tsx scripts/test-csi-intelligence-reads.ts` passed 9 tests on the existing loopback `csi01` replica using fresh `testvantagemovers_csi17reads*` databases and guarded cleanup. The latter proves real Mongo relevance/pagination, arbitrary-ID denial, old pinned transcript pagination, null timing, historical/proposed/conflicting/unknown identity, Owner restrictions/context, official activity projection and byte-identical domain/job/original-evidence state after reads. Its fetch trap forbids network/provider calls. See [exact read checks](../../call-sales-intelligence/workspace/evidence/csi-17/READS-CHECKS.md) and the CSI-17 handoff for whole-slice transport/intake/checkpoint results; read tests alone are not whole-app approval.

Feature defaults remain off; provider reads additionally require their explicit stage flag and a cached, unexpired token through the existing store. No live model, STT, Blob, RingCentral, deployed MCP, production database or message proof is claimed. Rollback disables CSI flags/registration while retaining immutable evidence, submissions and paused application intent. No production migration, credential provisioning or configuration enablement is part of CSI-17.

## CSI-18 Owner intervention implementation (September 19, 2026)

`ownerCommands.ts` owns exact-version confirmation, targeted correction/retraction, explicit suggestion application and rerun requests. Owner commands use the existing trusted actor and transactional durable command ledger. Run confirmation checks the output digest and run revision; finding commands check the finding revision and parent output digest. Both fence the current published pointer. Confirmation changes review projections and appends audit; it never invokes the effect application worker or changes the model assertion.

Correction stores an immutable assertion instruction and delegates selected action changes to CSI-06 in the same transaction. `action_changes` explicitly names the fields to change, including nullable due dates and responsibility. The follow-up must belong to the finding's effect/provenance and its expected revision is mandatory. Retraction cancels only still-open work created by this assertion with no later independent Owner/model work; completed work, closure, unrelated work and non-reversible effects remain protected with recorded blocked outcomes. Non-follow-up reversals require their existing explicit Owner workflow. Targeted unclear-commitment/Owner-conflict reviews resolve only when no reversal is blocked. Correction/retraction queues current-context reanalysis by default; unavailable evidence is reported without rolling back the immediate Owner decision.

Suggestions require the exact run revision and suggestion digest plus the current Outreach revision. CSI-06 creates Owner-origin work, preserving nullable due date and explicit responsibility. A blocked official-closure result is recorded as blocked, never reported as an applied suggestion.

`ownerReanalysis.ts` schedules durable existing analysis/number-refresh jobs with a server-issued future run id, source run, mode and authorized correction references. Optional `focus_finding_id` must be a live Finding of that run (else `RUN_SCOPE_DENIED`); it is provenance for why the rerun was asked for and changes neither run scoping nor evidence rules. It is stored on `owner_reanalysis` and surfaced on `reanalysis_requests[]`. Original mode validates retained manifest, response digests, source transcript presence and purge markers, then replays the exact captured calls and pinned prompt plus explicit Owner correction context. Current mode captures fresh context through existing preparation. Neither mode invokes STT. Number reruns remain synthesis-only. Existing reservation, receipt recovery and live effect validation apply; a new run starts with unreviewed assertions. Explicit disagreements produce instruction-version-specific Owner-conflict review; absent assessments remain Cannot determine.

Owner reads are side-effect-free: run list, original output, recorded effects, current actions, attributed instructions/assessments, paged immutable review history and paged evidence. Purged evidence yields an unavailable tombstone and never falls back to current content. Queued requests are visible on the source analysis even before a worker prepares a new run. Server and dashboard acceptance are tracked separately in `docs/call-sales-intelligence/workspace/evidence/csi-18/`.

## CSI-18 source freshness at replay/application

Current-context transcript reads reject explicitly requested obsolete versions. Before applying each batch and publishing a summary, captured transcript sources must still match the current eligible sources (the exact set for a Number, or the pinned eligible source for a Conversation). Original-evidence mode may still analyze a retained historical version: its findings/assessments remain available, but stale transcript evidence cannot apply operational effects or replace the current summary. Such a run is recorded as stale with `transcript_evidence_stale`; it is not silently rebuilt from fresh content. Number synthesis never applies Conversation effects.


## CSI-16 evidence restamp

Current local certification is recorded in [CSI-16 checks](../../call-sales-intelligence/workspace/evidence/csi-16/CHECKS.md) and the [execution matrix](../../call-sales-intelligence/workspace/ACCEPTANCE.md). CSI-15 backfill/retention/budget recovery is landed on main. Fresh synthetic and isolated browser evidence does not certify production grants or deployed revisions. G4 retains the media Retry-After clock failure; G5 remains partial and the generic conversation replay label fails integration. Exact owners are in [GAPS](../../call-sales-intelligence/workspace/evidence/csi-16/GAPS.md). [G6](../../call-sales-intelligence/workspace/evidence/csi-16/G6.md) is not probed. Owner full rollout follows separately in AFTER-16 D+E; no capability was enabled by this restamp.
