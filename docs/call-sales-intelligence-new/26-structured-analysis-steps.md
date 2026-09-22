# Structured analysis steps — September 22, 2026

This successor implements the summary/context/findings slice of §5 and Phase 2 in the workspace `CALL-SALES-INTELLIGENCE-SYSTEM-CHANGE-SPECIFICATION.md`. It does not migrate orchestration to Vercel Workflows, Redis or another queue. Earlier locked CSI contracts remain historical.

## Decisions

The first-party worker calls server-owned authorization, evidence and submission services in process. External agents retain the existing remote MCP and its V1/V2 contracts. This supersedes the earlier requirement that first-party reasoning travel through MCP; authority remains a signed credential bound to the stored run and current job lease.

New runs use `csi-analysis-steps-v1` by default. Existing pinned legacy runs retain their tool runtime. `SALES_INTELLIGENCE_ANALYSIS_V3=false` selects the legacy runtime for new runs; it does not reinterpret already pinned runs.

1. Generate a transcript summary and typed said-on-call facts. Validate every cited segment against the retained redacted transcript. Persist a canonical artifact keyed by dataset, conversation, transcript version, prompt version and model, then capture a separately authorized copy for each run.
2. Assemble current context deterministically. Load the read scope and coverage once, batch Lead and reviewed rep-identity joins, collect existing pages, and persist one context artifact with its citation inventory. This step makes no model call.
3. Generate findings from the summaries, context and Owner corrections. The model supplies semantic values and local evidence references. The server assigns snapshot IDs, field paths, keys, versions and reviewed rep identity, validates the existing full envelope, and submits once with the run ID as its idempotency key.

Number synthesis consumes cached call summaries and current context. `original_evidence` replays the exact retained artifacts and pinned step contracts; `current_context` reuses the summary and refreshes context/findings. Purged or changed contracts fail closed.

## Limits and accounting

Structured calls have no tool-step, page-loop, output-token or repair-count budget. Each model step has a 600-second elapsed deadline. A 740-second invocation checkpoints before starting a step it cannot finish; the saved summary is reused on the next claim. A timed-out step receives one durable retry, then pauses. Provider throttling uses the existing Retry-After path.

Existing server evidence-size, record-count and retention limits remain enforced. These are storage and authorization boundaries, so pathological context still fails closed. The manual runner supports one to four concurrent conversations. A deployment-wide Redis semaphore is outside this slice; existing worker scheduling remains in place.

Each step reserves its trailing-30-day p95 cost (bootstrap summary 2¢, findings 5¢). Monthly actual plus reserved spend prevents starting another step at the ceiling; an already started step can finish. Every observed response, including local repairs, is booked before final reconciliation. Missing or uncertain provider usage is reported as incomplete. Per-recording cost is reported on the run instead of refusing admission. Legacy runs retain legacy limits and admission.

## Manual rollout and backfill

Run from the server repository with the usual configured environment. Never commit the local manifests.

```powershell
node --env-file=.env --env-file=sales-intelligence.env --import tsx scripts/migrations/csi-analysis-artifacts.ts --apply
node --env-file=.env --env-file=sales-intelligence.env --import tsx scripts/backfill-csi-structured-analysis.ts --shadow --limit 1 --manifest .codex/csi-structured-shadow-canary.json --confirm-write
node --env-file=.env --env-file=sales-intelligence.env --import tsx scripts/backfill-csi-structured-analysis.ts --shadow --concurrency 4 --manifest .codex/csi-structured-shadow-full.json --confirm-write
```

The index migration is additive; without `--apply` it only verifies. The backfill defaults to a read-only cohort inventory without `--confirm-write`. It selects retained current conversation transcripts whose latest completed summary predates this pipeline. A manifest pins the cutoff and cohort, stores only operational identifiers/results, and resumes completed entries without repeating them. It stops scheduling new entries on a failure while allowing active entries to finish. Monthly policy remains authoritative.

Deploy the updated server before applying the backfill: the old server's strict evidence reader cannot render the new summary artifact. Then create a separate apply manifest by omitting `--shadow`, initially with `--limit 1`, followed by the full cohort. Generate this apply manifest after shadow processing because Owner reanalysis advances source revisions. Application uses the normal worker and effects service; no summary, finding or effect is inserted directly by the script. Shadow runs have an immutable application-disabled fence checked by submission, readiness and application.

The script reports submitted/completed states, application outcomes, cost and usage completeness. This is validation and cost evidence, not a claim of semantic equality with prior nondeterministic outputs. Owner precedence, attachment eligibility and current Booking state remain application-time checks.

## Verification

Pure tests cover compact contracts, citation expansion, artifact integrity, cost measurement, metadata removal, admission and resumable bounded backfill. `scripts/dev_ops/test-csi-structured.ts` runs thirteen real-worker checks against a disposable loopback Mongo replica on port 27189 (replica set `csi01`), with synthetic data and a mocked model that rejects tool usage. It covers normal application, shadow fencing, local repair, checkpoint reuse, purge refusal, number synthesis, original-evidence pinning, provider 429, per-recording reporting and exact monthly reconciliation. Regression checks prove that canonical summaries are erased across all purged transcript versions, original number replay retains its captured prior summary, and a replaced transcript starts a clean number generation instead of mixing checkpoint evidence.

The first live shadow canary on September 22 submitted successfully with complete usage accounting at 2¢ and application disabled. Full-cohort results are recorded separately after the run.
