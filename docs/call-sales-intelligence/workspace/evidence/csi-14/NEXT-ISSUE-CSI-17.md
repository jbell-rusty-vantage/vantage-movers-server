# Next implementation prompt — CSI-17 only

Copy the prompt below into the next implementation task. Attach the listed files in full; other paths are explicit reading references. This is an implementation brief, not authorization to start implementation from the review task that prepared it.

---

Files loaded in full:

- `vantage-main-server/docs/call-sales-intelligence/10-intelligence-agent-contract.md`
- `vantage-main-server/docs/call-sales-intelligence/06-delivery-plan-and-acceptance.md`
- `vantage-main-server/docs/call-sales-intelligence/workspace/teams/d-intelligence.md`
- `vantage-main-server/docs/call-sales-intelligence/workspace/CONTRACTS.md`
- `vantage-main-server/docs/call-sales-intelligence/workspace/evidence/csi-01/STEP2-HANDOFF.md`
- `vantage-main-server/docs/call-sales-intelligence/workspace/evidence/csi-14/INDEPENDENT-REVIEW.md`
- `vantage-movers-mcp/CONTEXT.md`

Implement **CSI-17 only — scoped MCP reads, one durable analysis submission, and versioned prompt/schema** in `vantage-main-server` and `vantage-movers-mcp`.

Complete the server/MCP implementation, registration, contract tests, disposable replica proof, documentation, and handoff. Team D owns this slice. Main server remains the semantic authority. CSI-13 owns model invocation, analysis scheduling/application, findings/effect publication, and number synthesis. Team E owns the dashboard.

Implementing the scoped capability is authorized. Calling live models, RingCentral, deployed MCP, production APIs/databases, or private production media is not authorized. Use synthetic evidence and local/fake transport. No deployment, production configuration, migration, backfill, live message, commit, or push.

## 1. Establish the baseline before editing

- Inspect branch, HEAD, Git remote and working tree in **both repositories** before any edit. Identify owners from remotes, not the signed-in account.
- Main server must be on `sales-intelligence`; otherwise stop and report without switching it.
- MCP was last inspected on `main`. For this task, creating/checking out the exact local branch `sales-intelligence` in MCP is authorized, provided all existing work is preserved. Inspect whether it already exists; never force a switch, discard changes, reset, clean, or invent another team branch. If preserving changes makes the switch unsafe, report the concrete conflict.
- Record actual baselines. The previous main-server observation was `3355c6dcf68ed2c092824dc1dbb87c71a3f0c343` with CSI-10/14 uncommitted changes; this is historical context, not a required hash or cleanliness assumption. The user may have committed since then.
- Read the fresh CSI-14 independent review. Preserve its unresolved findings and exact review scope. Do not silently fix messaging in CSI-17 or call the whole app independently approved. If a finding affects the scoped boundary you consume, resolve that dependency explicitly; otherwise keep it tracked as separate CSI-14 follow-up.
- Preserve the distinction between old checkpoint snapshots and direct current-source checks: CSI-06 had a failed snapshot; CSI-10 had passing snapshot checks/review but became stale; CSI-14 had two failed final reviews on snapshot documentation contradictions with passing automated checks and later source corrections. The fresh independent review is a separate artifact.
- Claim CSI-17 in the server workspace `LEDGER.md` before implementation edits. Record both repositories, branches, HEADs, owned files, coordinated shared files, and dashboard untouched.
- Inspect actual CSI-01/04/05/06/10/12 status and contracts. CSI-17 formally depends on CSI-01; consume the implemented read/identity/transcript services rather than recreating them. CSI-13 is not yet delivered.
- No reset, clean, force-push, production operation, credential provisioning, or flag enablement. No commit or push unless separately requested.

## 2. Read these files in full, in this order

Paths below are relative to `vantage-main-server` unless explicitly prefixed with another repository.

First: delivery state and scope

1. `docs/call-sales-intelligence/workspace/evidence/csi-14/INDEPENDENT-REVIEW.md`
2. `docs/call-sales-intelligence/workspace/evidence/csi-14/HANDOFF.md`, `CHECKS.md`, `REVIEW.md`, `API-CONTRACT.md`
3. `docs/call-sales-intelligence/workspace/evidence/csi-01/STEP2-HANDOFF.md`, `STEP2-CHECKS.md`, `STEP2-INDEPENDENT-REVIEW.md`
4. `docs/call-sales-intelligence/workspace/evidence/csi-06/HANDOFF.md`, `CHECKS.md`, `REVIEW.md`
5. `docs/call-sales-intelligence/workspace/evidence/csi-10/HANDOFF.md`, `CHECKS.md`, `REVIEW.md`
6. `docs/call-sales-intelligence/workspace/evidence/csi-12/HANDOFF.md`, `CHECKS.md`, `INDEPENDENT-REVIEW.md`
7. `docs/call-sales-intelligence/workspace/teams/d-intelligence.md`
8. `docs/call-sales-intelligence/06-delivery-plan-and-acceptance.md`

Next: authoritative contracts

9. `docs/call-sales-intelligence/10-intelligence-agent-contract.md` — all sections; emphasize tools, evidence, transport, submission, and no-send boundary.
10. `docs/call-sales-intelligence/01-specification.md` — uncertainty, subject scope, identity, Owner precedence, and effect boundaries.
11. `docs/call-sales-intelligence/02-domain-models.md` — existing run, snapshot, submission, finding/effect, audit/job models.
12. `docs/call-sales-intelligence/04-server-routes.md` — especially §6 internal routes and §7 auth/errors.
13. `docs/call-sales-intelligence/03-server-pipeline-and-jobs.md` — durable protocol and §14 MCP integration; distinguish CSI-17 transport from CSI-13 execution.
14. `docs/call-sales-intelligence/workspace/CONTRACTS.md` — concrete CSI-01/04/05/06/10/12 imports.
15. `docs/call-sales-intelligence/11-codebase-alignment-audit.md`
16. `docs/call-sales-intelligence/12-deployment-inputs-and-model-policy.md` — infrastructure reuse; no live model proof in this issue.

Then: repository guidance and Service documentation

17. `docs/call-sales-intelligence/workspace/AGENTS.md`, `README.md`, `LEDGER.md`, `HANDOFF-TEMPLATE.md`
18. `AGENTS.md`, `CLOUD_AGENTS.md`, `docs/quality-checkpoints.md`, `docs/index.md`
19. `docs/knowledge/services/sales-intelligence-foundation.md`
20. `docs/knowledge/services/number-activity-reads.md`
21. `docs/knowledge/services/sales-intelligence-attachment.md`
22. `docs/knowledge/services/sales-intelligence-outreach.md`
23. `docs/knowledge/services/sales-intelligence-rep-identity.md`
24. `docs/knowledge/services/sales-intelligence-transcription.md`
25. `docs/knowledge/services/sales-intelligence-nudges.md` — consume the explicit no-model-send boundary, not messaging implementation ownership.
26. Applicable server `.cursor/rules/` files for service boundaries, validation, testing, auth, and deployment.
27. `vantage-movers-mcp/CONTEXT.md`, `README.md`, `package.json`, any actual `AGENTS.md` and applicable local rules found in that repository.
28. Shared `C:\Users\Pinda\Proyectos\vantage\CONTEXT.md` and `docs\agents\domain.md`.

Read these targeted sources before widening searches. Historical documents do not override current source contracts or grant production access.

## 3. Start from these existing implementation points

| Concern | Start here |
| --- | --- |
| Scoped run credentials already implemented | Server `src/services/salesIntelligence/auth.ts`: `requireCsiRun`, `issueCsiRunToken`, `runClaimsSchema`, `RunClaims` |
| Existing v1 key guard and exact internal allowlist | `src/middleware/requireApiSecret.ts`; `src/routes/sales-intelligence-boundary.routes.ts` and tests; `src/routes/v1.routes.ts` |
| Strict envelope and fixtures | `src/validation/intelligence/intelligenceEnvelope.validation.ts`, `fixtures.ts` |
| Evidence authorization | `src/services/salesIntelligence/evidence.ts`: `validateEnvelopeEvidence` |
| Existing persistence | `src/models/IntelligenceRun.ts`, `IntelligenceEvidenceSnapshot.ts`, `IntelligenceSubmission.ts`; implementations in `src/models/salesIntelligence/intelligence.ts` |
| Durable transaction/audit/job primitives | `src/services/salesIntelligence/transactions.ts`, `jobs.ts`; `src/models/salesIntelligence/registry.ts` |
| Dataset, tool/error enums and flags | `src/config/domain/salesIntelligence.ts`, `src/services/salesIntelligence/policy.ts` |
| Operational read surfaces | `src/services/numberActivity/{contactNumbers,search,timeline,coverage}.ts`; `src/services/salesIntelligence/outreach/reads.ts`; attachment read contracts |
| Historical reviewed identity | `src/services/salesIntelligence/repIdentity/resolve.ts`; use call-time half-open intervals, not nudge current-recipient rules |
| Immutable redacted transcript evidence | `src/services/salesIntelligence/conversations/{transcript,transcriptionScheduling,transcribe}.ts`; `src/services/conversations/redaction.ts` |
| Existing foundation/replica proof | `src/services/salesIntelligence/foundation.test.ts`; `scripts/test-csi-foundation{,.replica.test}.ts`; `scripts/test-csi-transcription{,.replica.test}.ts` |
| Queue/consumer boundary | `src/services/numberActivity/jobDispatch.ts`, `api/queues/sales-intelligence-consumer.ts`; CSI-13 application worker remains downstream |
| Existing broad MCP endpoint — must remain separate | MCP `app/api/mcp/route.ts`, `lib/tools/register.ts` |
| MCP request credentials/context | MCP `lib/auth.ts`, `lib/request-context.ts` |
| Existing API transport and Lead tools | MCP `lib/vantage-api.ts`, `lib/tools/leads.ts` and tests |
| Existing general Mongo tools — forbidden to intelligence identity | MCP `lib/tools/mongo-ops.ts`, `lib/mongo.ts` |
| Installed MCP API/version | MCP `package.json`, lockfile, installed `mcp-handler` and `@modelcontextprotocol/server` types/docs |

Foundation already supplies models, schema, run-token issuance/verification, evidence validation and boundary routing. Extend and consume these; do not create a competing token protocol, envelope, snapshot collection, command framework or job system. Inspect real official read Services and fields before mapping Lead/Booking/Cancellation context.

## 4. Deliver CSI-17

### Dedicated transport and least authority

- Implement and register MCP `/api/intelligence-mcp`, separate from `/api/mcp`.
- Expose exactly the agreed tools: `get_intelligence_context`, `get_call_transcript`, `list_number_activity`, `search_leads`, `get_lead`, `search_bookings`, `get_booking`, `get_rep_identity`, `submit_intelligence_analysis`.
- Do not register broad Lead mutation, Mongo, arbitrary HTTP, attachment, Owner-command, customer-message or rep-message tools on the dedicated endpoint. Deny direct `tools/call` attempts as well as excluding them from listing.
- A signed run credential binds run, subject, tools, dataset/deployment, audience, nonce, expiry and active lease epoch. Verify at MCP and revalidate against stored run/job at main server. Do not merely decode claims or rely on model instructions.
- Main-server requests require both the named dedicated scoped key and `x-vantage-intelligence-run-token`. A broad API secret, browser Owner identity, token alone, stale lease or another deployment is insufficient.
- Keep request context isolated across concurrent MCP requests. Do not leak a token, secret, subject or allowed-tool set into another invocation. The model cannot choose or replace the trusted actor/run context through tool arguments.
- Reuse the existing issuance function for active leased runs. Expose a concrete CSI-13 integration API without building the scheduler or permitting model-initiated run creation/token minting.
- Preserve the existing broad MCP endpoint for its intended clients; the intelligence credential must not gain access to it.

### Main-server routes and bounded reads

Implement handlers after the existing boundary for:

- GET `/api/v1/internal/sales-intelligence/runs/:id/context`
- POST `/api/v1/internal/sales-intelligence/runs/:id/read`
- POST `/api/v1/internal/sales-intelligence/runs/:id/submit`
- GET `/api/v1/internal/sales-intelligence/runs/:id/submission`

Use a closed tool discriminator with strict per-tool arguments and result DTOs. Reject arbitrary filters/operators/URLs/collection names and extra operational fields. Bound pages, total evidence and transcript coverage; use cursors and honest completeness/coverage. Never silently truncate a long transcript and label it complete.

Return only authorized redacted context. Lead/Booking searches may discover relevant candidates outside the starting subject, but server-controlled relevance and evidence admission are required; a discovered ID is not general read or cross-subject effect authority. Do not hardcode unrestricted get-by-ID merely because a model supplied a valid ObjectId.

Reuse official reads, Outreach state/actions, attachment certainty, restrictions, Owner instructions and temporal identity. Unknown speaker/rep and incomplete coverage are valid results. Do not substitute proposed/name-matched identity for reviewed call-time attribution. Never use a customer phone as messaging authority.

Intelligence reads may append their required immutable evidence snapshots, but cannot mutate domain state, refresh providers, attach records, send messages, or trigger extraction. Distinguish this evidence capture from the no-domain-mutation rule.

### Evidence capture and replay

- Capture each authorized response before returning it: server-owned snapshot ID, run/subject, tool, normalized arguments, retrieval time, record revisions, redacted content, digest and completeness metadata.
- Construct manifests from persisted snapshots. A model-supplied manifest, record ID or field path cannot authorize itself.
- Handle repeated/concurrent reads and submission races explicitly. Submission must freeze the evidence it validates; a late read cannot silently extend a finalized manifest.
- Reuse immutable CSI-12 transcript versions without retranscribing. Preserve nullable timing, source/speaker uncertainty and the exact consumed version.
- Original-evidence mode replays stored responses and prompt context; it must not expand into current reads. Missing retained evidence yields `ORIGINAL_EVIDENCE_UNAVAILABLE`, never a silent current-context substitution.
- Do not add a mandatory exact-quotation, timestamp-location or entailment check. Valid snapshot membership and subject authority are mandatory; exact-locator/entailment verification remains deferred.

### Versioned prompt and schema

- Publish MCP prompt `sales_intelligence_analyze_v1` and its versioned schema resource using the installed SDK APIs.
- Derive the schema from the frozen server envelope contract or a tested artifact with explicit parity checking; do not hand-maintain a divergent permissive schema.
- Provide a concrete retrieval/rendering contract so CSI-13 explicitly loads, pins and persists the exact rendered prompt/schema version. Listing a prompt does not load it into a model.
- Treat transcripts, notes and tool results as untrusted evidence. Preserve requested/promised/completed/conditional distinctions, uncertainty and source versus inference.
- Explain single submission, bounded context/loop expectations, no official writes and no sends. Do not reinstate an Owner-confirmation gate for all permitted downstream effects.

### Durable one-submission boundary

- Reuse `IntelligenceSubmission` and existing durable jobs. Same run/key/payload yields the existing immutable receipt; changed payload conflicts. Concurrent duplicates create one submission and one application intent.
- Parse strict `csi-envelope-v1`, validate real run-scoped evidence/speakers/targets/instruction revisions, and persist envelope, manifest binding, audit and downstream application intent atomically.
- Return the documented `202 {run_id, submission_id, application_job_id, status:"submitted"}` or replay result. Acceptance does not mean effects have applied.
- Implement pure submission-status reads for uncertain delivery. A timeout must be resolvable without a second run or duplicate application job. Define expired-token/lease recovery through trusted orchestration; do not loosen service auth for recovery.
- CSI-13's application handler is not part of this issue. Make the durable handoff explicit and safe while that consumer is absent: never mark work applied/completed, silently drop it, or repeatedly burn retries as if a missing implementation were a provider failure. Do not register a fake successful worker to satisfy integration.
- Provider/model calls remain outside transactions and are not needed for this task. No nudge import or messaging route is available to this identity.

## 5. Boundaries

Do not implement CSI-13 ToolLoopAgent/model invocation, automatic effect application, number synthesis, CSI-18 corrections/UI, CSI-15 backfills/retention, or Team E dashboard/SSE work.

Do not change official Lead/Booking/Cancellation/Agent/Extension User records, qualification behavior, attachments, Outreach assignments/actions/restrictions, or nudge state from a tool read/submit. The only submission write is the authorized immutable analysis intake and its durable downstream intent; application remains CSI-13.

No live model/STT/Blob/RingCentral/MCP/provider proof, production credentials, subscriptions, refreshes, migrations/backfills, deployments, flag enablement or messages. No automatic messages under any circumstance.

Own the new dedicated MCP route/scoped adapters/tools/prompt/schema/tests, main-server scoped read/evidence/submission services/internal router/tests, and CSI-17 evidence. Coordinate shared auth/model/schema/config/router/job changes in `CONTRACTS.md`. Prefer additive registration and narrow changes.

## 6. Prove the behavior

Use synthetic records and redacted transcripts, `555-01xx` numbers, fake/local HTTP and the disposable replica pattern. Never load production credentials or rely on a deployed URL default.

Include:

- Exact tool/prompt/resource discovery through the actual dedicated MCP transport, successful authorized tool calls and denied hidden/direct calls.
- Global secret, Owner browser, token-only, wrong named key, tampered/expired token, wrong run/subject/tool/dataset/deployment/nonce/lease, completed run and revoked/expired lease denial.
- Concurrent request-context isolation and inability to override actor/run through args.
- Intelligence credential denied general MCP mutation/Mongo tools; existing broad endpoint's intended auth behavior preserved.
- Strict arguments, bounded search/pagination/transcript coverage, relevant-candidate evidence admission, arbitrary ID/field/operator/URL rejection.
- Unknown identity, effective-dated historical identity, retired current link with valid historical interval, conflicting/proposed/name-only mapping, missing transcript and incomplete coverage.
- No official/domain mutation or provider access from tools; no nudge submission or repair reachable.
- Immutable redacted tool snapshots, digest/version/revision accuracy, returned response matching persisted evidence, repeated/concurrent reads and finalized-manifest races.
- Original-evidence replay, forbidden current expansion, missing original evidence, no repeated STT.
- Prompt/schema version parity, prompt-injection content remaining data, no hidden message or official-mutation tool authority.
- Concurrent duplicate submission, changed same-run payload, foreign snapshot/target/instruction/speaker rejection, transaction rollback, timeout after durable commit, restart and same receipt/status recovery.
- Durable application handoff with absent CSI-13 consumer; no false effect success and no lost intent.
- All feature flags remain off outside isolated tests; no raw transcript/secret/provider body in errors or logs.

Run server typecheck, lint, focused tests, replica checks and relevant foundation/reads/Outreach/identity/transcription regressions; run its required offline suite. MCP currently has `pnpm test`, `pnpm typecheck`, and `pnpm build`, but no lint script: inspect actual scripts and run applicable checks rather than inventing one or claiming it ran. Use only safe synthetic build configuration.

Run the required server quality checkpoint after source stabilizes: follow `docs/quality-checkpoints.md`; the preceding task used `pnpm finish-work --provider codex --no-apply` to preserve the checkout. Inspect findings and proposed patches before integrating relevant fixes. Follow actual MCP guidance if it adds another required check. Record checkpoint input HEAD/fingerprint/status separately from direct current-source results. Failed or stale snapshots are not independent final approval.

Record exact commands and actual output under server `docs/call-sales-intelligence/workspace/evidence/csi-17/`. Distinguish implementation failures, local environment blockers, unsupported downstream application, and intentionally unexecuted live proofs.

## 7. Finish the handoff

- Publish concrete imports/routes/tool arguments/result DTOs, errors, cursor/coverage semantics, prompt/schema versions, token issuance/verification contract and evidence/submission lifecycle in `CONTRACTS.md`.
- Identify CSI-13's exact starting points: create/lease run, issue scoped token, retrieve/render pinned prompt/schema, consume CSI-12 transcript evidence, invoke tools, receive/recover one submission, then implement the separate application consumer. Do not claim CSI-13 is implemented.
- Provide reproducible local MCP request/response fixtures including forbidden calls and uncertain-submit recovery; no production secrets or identifiers.
- Update ledger and Team D work file; update both repositories' appropriate Service/catalog/README guidance.
- Write `evidence/csi-17/HANDOFF.md` using the template, including both repository baselines and changed files, races/crash results, concrete consumers, defaults, rollback, unresolved review findings and separately gated live proofs.
- Preserve existing CSI-14 independent findings as separate tracked work; do not turn previous pass counts into a claim those findings are fixed.
- No commit or push.

Kickoff principle: The server-created run defines authority. Tools return bounded captured evidence; the model submits assertions once. Main server decides effects later. Neither a prompt, a transcript, a search result nor a scoped service identity grants Owner authority or permission to send a message.
