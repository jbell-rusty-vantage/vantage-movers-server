# Next-agent instruction — CSI-13 only

Attach the six files below in full, in this order, then paste the implementation instruction. All paths are relative to `C:/Users/Pinda/Proyectos/vantage`. Other documents are navigation references, to read at the indicated stage rather than loading the entire specification pack upfront.

## Load in full

1. `vantage-main-server/docs/call-sales-intelligence/10-intelligence-agent-contract.md` — required behavior and authority boundaries.
2. `vantage-main-server/docs/call-sales-intelligence/workspace/evidence/csi-17/HANDOFF.md` — what exists, what remains absent, and review limitations.
3. `vantage-main-server/docs/call-sales-intelligence/workspace/evidence/csi-17/API-CONTRACT.md` — exact runtime integration, authentication, evidence, submission and recovery protocol.
4. `vantage-main-server/docs/call-sales-intelligence/workspace/evidence/csi-12/HANDOFF.md` — pinned transcript inputs and upstream eligibility/accounting constraints.
5. `vantage-main-server/docs/knowledge/services/sales-intelligence-outreach.md` — existing effect authority; consume this implementation instead of recreating its rules.
6. `vantage-main-server/docs/call-sales-intelligence/06-delivery-plan-and-acceptance.md` — CSI-13 scope, dependencies and acceptance, with CSI-18 kept separate.

## Copy from here

Implement **CSI-13 only: bounded model invocation, durable scheduling and recovery, findings/effect application, and current number analysis**. Main server owns semantics and orchestration. Use the implemented CSI-17 scoped MCP surface as the model's only tool provider. Complete implementation, registration, synthetic integration proof, documentation and handoff.

CSI-13 depends on CSI-06/10/12/17. CSI-17 is implemented locally; model invocation, application and synthesis are not. CSI-12 already creates analysis jobs. CSI-06 already supplies Outreach effect rules. Do not rebuild these capabilities.

Implementation and local synthetic validation are authorized. No live paid model/STT, RingCentral, private Blob, deployed MCP, production API/database/media, deployment, production flag/configuration change, migration, backfill campaign, message send, commit or push. Existing credentials do not expand this authorization. Dashboard work and CSI-18 Owner correction/confirmation/reanalysis controls are outside this issue. Preserve the replay seams already implemented, but do not claim CSI-18 is complete.

### 1. Establish the actual baseline

- Inspect Git branch, HEAD, remotes and tracked/untracked changes in server and MCP. Both were last on `sales-intelligence`; verify rather than assuming. Stop and report if the server is on another branch. Do not reset, clean or discard existing work. CSI-17 and earlier changes may still be uncommitted.
- Read applicable repository instructions: shared `AGENTS.md`, `CONTEXT.md`, `docs/agents/domain.md`; server `AGENTS.md`, `CLOUD_AGENTS.md` where present; applicable `.cursor/rules`; and the CSI workspace `AGENTS.md`, `README.md`, `LEDGER.md`, `HANDOFF-TEMPLATE.md`. Follow the Service catalog navigation before broad source exploration.
- Claim CSI-13 in `docs/call-sales-intelligence/workspace/LEDGER.md` before implementation edits. Record actual baselines, ownership and shared-file coordination. Read `workspace/teams/d-intelligence.md`, but its combined CSI-17/13/18 kickoff does not enlarge this issue.
- Preserve unresolved review findings. CSI-14 has a separate P2 concerning editable review-context message bodies bypassing call restrictions. CSI-17's required checkpoint ended failed/verify, with snapshot file-read failures and a proposed CSI-10 empty-recording identity replay fix left unapplied. Later direct tests passed; they are not independent final approval. Read CSI-17 `CHECKS.md` and CSI-14 `INDEPENDENT-REVIEW.md` before finalizing the baseline; consult linked logs only as needed. Do not silently absorb unrelated fixes.

### 2. Read references in stages

All paths in the remainder are server-relative unless prefixed with the MCP repository name.

| When | Read |
|---|---|
| Before implementation design | `docs/knowledge/services/sales-intelligence-analysis.md`, `sales-intelligence-foundation.md`, `sales-intelligence-transcription.md`, `sales-intelligence-rep-identity.md`; `docs/call-sales-intelligence/workspace/CONTRACTS.md` sections CSI-01/06/10/12/17 |
| Before scheduling/runtime | `docs/call-sales-intelligence/03-server-pipeline-and-jobs.md` sections 6.4, 9, 11, 13–15; `12-deployment-inputs-and-model-policy.md`; `04-server-routes.md` internal/auth sections |
| Before application/publication | Relevant rules in `docs/call-sales-intelligence/01-specification.md` and `02-domain-models.md`, especially runs, findings, effects, instructions, budget and Outreach; CSI-06 handoff and attachment Service when following attachment authority |
| Before changing MCP | `vantage-movers-mcp/CONTEXT.md`, `README.md`, `docs/intelligence-mcp.md`, applicable repository rules and CSI-17 MCP checks |
| Before completion | CSI-13 acceptance row/matrix, `11-codebase-alignment-audit.md` Team D obligations, workspace handoff template and current quality-checkpoint rules |

Bare numbered document names in this table are under `docs/call-sales-intelligence/`. Historical “not implemented” labels and original nine-tool lists can be stale: CSI-17's API contract and generated schema describe the delivered twelve-tool interface and Owner-added citation kinds. Preserve product requirements; investigate contradictions explicitly.

### 3. Use the existing seams

Start with these source entry points; expand through their imports only when needed:

| Concern | Entry points under `src/services/salesIntelligence/` |
|---|---|
| Run, credential and immutable evidence lifecycle | `analysis/run.ts`, `analysis/lease.ts`, `analysis/capture.ts`, `analysis/submit.ts`, `analysis/contracts.ts`; existing internal router |
| Upstream transcript and eligibility | `conversations/transcribe.ts`, its scheduling/eligibility imports, immutable evidence snapshot model |
| Jobs, policy and shared budget | `jobs.ts`, `policy.ts`, `aiBudget.ts`, `numberActivity/jobDispatch.ts`; `src/config/domain/salesIntelligence.ts` |
| Effect decisions and writes | `outreach/effects.ts`, `outreach/numberReview.ts`, `outreach/ensure.ts`, `outreach/staffing.ts`, `review/restrictions.ts`, `review/items.ts` and existing followup commands |
| Durable publication | Existing IntelligenceRun/Submission/Finding/Effect models, current analysis/read DTOs and transactional helpers |
| Delivery/recovery | Existing queue consumer, cron routes, bootstrap and `vercel.json`; existing change scans/watermarks before inventing another scheduler |

**Resolve these two concrete integration gaps:**

1. CSI-17 creates every `application` intent as `paused/consumer_unavailable`. Register a real consumer, coordinate new-intent readiness, and explicitly resume compatible existing intents when enabled. Do not blanket-unpause other reasons or consume attempts while disabled.
2. `applyOutreachEffect` currently requires `run.subject_key === subjectKey(record.subject)`. CSI-12 analysis jobs are conversation-scoped, while CSI-17 permits a trusted same-number Outreach pointer. Add the smallest coordinated authority adapter/check needed for those runs. Preserve the immutable run/job subject. Validate the persisted Outreach binding, source interaction and current event attachment; same number alone never grants Lead effect authority. Test rejection of foreign and merely candidate subjects.

### 4. Implement the runtime and scheduling

- Use AI SDK `ToolLoopAgent` through AI Gateway and remote HTTP MCP `/api/intelligence-mcp`. Verify installed SDK versions, types, transport and usage APIs before coding; consult current official documentation where needed. Treat proposed model names/prices in planning documents as proposals. No mandatory second-model gate, automatic expensive escalation, direct model tools, general Mongo, filesystem or Eve runtime.
- Claim existing `analysis`/`number_refresh` jobs and call `prepareIntelligenceRun(lease,input)`. Preserve CSI-12 `input_refs=[conversation_id,transcript_snapshot_id]`; recheck live eligibility and the consumed version before paid work. An analysis retry must not retranscribe.
- Supply both dedicated `x-api-secret` and `x-vantage-intelligence-run-token` headers from trusted orchestration. Retrieve `sales_intelligence_analyze_v1` and `csi://schemas/csi-envelope-v1`, verify the pinned digest and use the stored rendered prompt. Discovery alone does not load a prompt. Keep secrets out of model context/logs.
- Bound steps, input/output/context tokens, elapsed time and evidence coverage. Long transcripts need explicit bounded coverage/checkpoints; incomplete processing is not successful empty analysis. Nullable timestamps/speakers remain valid uncertainty.
- Success requires the durable submission receipt. Stop after acceptance; final prose cannot substitute for submission. Permit at most the contracted single schema-repair attempt. Before repeating expensive work after timeout/crash, recover submission status; use `recoverIntelligenceSubmission(runId,lease)` after reclaiming the same job when the old token expires. Accepted output/evidence stay immutable.
- Reserve from the existing shared STT/analysis monthly budget before invocation. Account for every step, repair and retry; persist model/pricing versions, actual usage including reasoning tokens, and cost. Reconcile unused reservations correctly. Missing billed usage remains unresolved, not zero. Budget pauses do not burn retries; policy changes/period rollover resume only eligible work. Do not initialize production policy or budget.
- Use actual job stages `analysis`, `application`, `number_refresh`, not parallel queues derived from older conceptual names. Queue delivery and cron recovery must use the same claim/process paths. Register routes/bootstrap/config with flags off by default; failed wakeup publication must leave recoverable durable intent.
- Fingerprint meaningful source changes: transcript/call revisions, attachments, reviewed rep identity, relevant official context, followups, restrictions and Owner instructions. Avoid clock/generic updatedAt triggers. Coalesce bursts; allow at most one successor for changes during a run. Prevent older workers from replacing newer current analysis.

### 5. Apply findings and publish analysis

- Consume `[run_id,submission_id]` under the application-job lease. Persist findings and per-effect outcomes, calling existing CSI-06 commands with server-resolved intents. One finding may produce multiple effects. Use transactions/CAS and resumable bounded work so retries converge and partial failures cannot claim full publication.
- Revalidate current Owner instructions, reviewed call-time identity, attachment, work-request state, restrictions and followup revision immediately before effects. Keep overall Outreach owner, followup responsible agent and promised-by identity distinct. Unknown/proposed identity cannot assign an agent; historical reviewed intervals remain usable. Later calls do not automatically replace an existing owner.
- Apply permitted clear commitments automatically, including appropriate callback/customer-request/customer-wait distinctions, uniquely matched completion, and safe rescheduling. Clear commitments with unresolved dates remain undated with a Due date needed review. Resolve dates and money on the server, preserving original wording and resolution basis. Number-only eligible sales commitments may open Number Review through `ensureNumberReview`; never create a Lead from them.
- Reuse spoken restriction handling without overwriting Owner plans or weakening permanent restrictions. Strategy remains suggestion-only. Booking/payment/decline/booked-elsewhere/non-sales assertions are evidence/review, never official Lead/Booking/Cancellation/Agent writes, autonomous messages, automatic closure or suppression. Do not add a blanket Owner-approval gate to permitted effects.
- Identify the same obligation across runs using stable source interaction/commitment identity; run ID, quote hash or finding ordinal alone is insufficient. Ambiguous matches require review. Check later fulfillment, cancellation, official context and Owner retraction before historical activation. Incomplete history cannot confidently create overdue work or revive a resolved obligation.
- Preserve mandatory snapshot membership and scope checks. Exact quotation/location/entailment verification remains deferred (`not_run`); do not add a hidden second verifier or perfect-citation gate.
- Number synthesis uses the same scoped MCP architecture and captured source evidence, findings and official context, including disagreements and coverage. Do not recursively summarize summaries as the only evidence. Publish current analysis only after the intended durable boundary, independently of whether each effect applied or was blocked.
- Keep existing original-evidence replay semantics. `owner_correction_ids` currently must be empty; CSI-18 owns correction selection and user controls.

### 6. Prove the result and hand it off

Use a fake provider with the actual ToolLoopAgent and local MCP HTTP transport into real server handlers and a disposable replica database. Do not mock away capture/submission/application in the integration proof. Prove prompt/resource retrieval, allowed tools, forbidden authority, receipt recovery and resulting persisted effects. Record that live model quality remains unmeasured.

Cover: duplicate delivery; crashes around submission acknowledgment and application commit; lease expiry; bounded repair/exhaustion; budget reservation/reconciliation and reason-specific resume; queue publication failure; stale publication; Owner edits during application; cross-run commitment deduplication; later fulfillment/Booking before historical work; incomplete history/transcript; unknown speaker/date; conversation-run Outreach authority; number synthesis grounded in sources; and no STT repeat or clock-only model work.

Run relevant new tests plus existing foundation, Outreach, rep identity, transcription, scoped intake/read and number-read regressions. Run server typecheck/lint/offline suite and the required `pnpm finish-work --provider codex --no-apply` after source stabilizes, following current repository instructions. Inspect proposed fixes before applying; retain unrelated findings. Run expensive suites/builds/checkpoints sequentially. If MCP changes, run its tests/typecheck and safe isolated build using synthetic configuration. Distinguish checkpoint snapshot results from final direct-source results.

Update owning Service/catalog documentation, `workspace/CONTRACTS.md`, Team D and the ledger. Write `workspace/evidence/csi-13/HANDOFF.md` using the template, with exact imports/consumer DTOs, fixtures, checks, limitations, defaults/rollback and CSI-18 handoff. Preserve prior review status accurately. Finish with implemented behavior, validation and outstanding risks; do not claim deployment or live model proof.
