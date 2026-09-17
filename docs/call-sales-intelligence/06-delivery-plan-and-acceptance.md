# 06 — Delivery plan and acceptance

Status: build contract, not implemented. Revised September 17, 2026. Execution home: [workspace/README.md](workspace/README.md). This revision replaces the old acceptance-gated AI plan. [09](09-owner-workflow-interview.md) preserves interview decisions; [10](10-intelligence-agent-contract.md) is the agent contract.

## 1. Repositories and rollout

Runtime belongs in `vantage-main-server`, Owner UI in `vantage-admin`, and scoped MCP adapters/prompts in `vantage-movers-mcp`. Preserve each repo's guidance. No runtime changes, branches, deployments, live sends, subscription changes, or production backfills were performed by this specification task.

Owner-required branch: agents must perform all Call & Sales Intelligence implementation work on `sales-intelligence` in both `vantage-main-server` (server) and `vantage-admin` (dashboard). Inspect the current branch and working tree before edits; use the existing branch or create that exact branch if absent, preserving uncommitted work. Do not implement on the default branch or substitute a differently named team branch. Record repository, branch and owned files in the workspace ledger and handoff. Coordinate agents sharing a checkout; Git cannot check out the same branch in multiple worktrees of one repository, so use separate clones when independent checkouts are necessary, and coordinate integration to avoid divergent pushes. This documentation update does not itself create or switch branches.

Implement behind flags defaulting off. Owner-editable settings cannot override deployment kill switches. Test on isolated data; production capability grants, credentials and rollout are deployment work. Capture/operational features work while AI/media remains unavailable. Do not label specification completion as feature shipment.

## 2. Issues and dependency graph

| Issue | Scope | Depends on | Acceptance emphasis |
| --- | --- | --- | --- |
| CSI-01 | Contract types, config, revised models/indexes, CAS/audit/jobs/policy foundation | none | Strict envelope and multiple nullable-due follow-ups; durable full audit; migrations and test DB boundary. |
| CSI-02 | All-direction projection and authoritative Call Log reconciliation | 01 | Canonical identity, out-of-order/double replay, independent qualified cursor, honest watermark. |
| CSI-03 | Webhook fan-out and subscription lifecycle | 01,02 | Fast durable capture, all directions, validation echo, renewal/repair; no qualified-ingest change. |
| CSI-04 | Number Activity, search and projection rebuild | 02 | Unlinked numbers, all connections, complete cursor search/timeline, no read mutations. |
| CSI-05 | Attachment suggestion and Owner attach/reject/detach | 01,02 | Exact identity versus Likely; ambiguity blocks Lead effects; rejection durable. |
| CSI-06 | Outreach, multiple follow-ups, assignment, restrictions, notes, clocks, reviews | 01,02,05 | All 01 rules; inbound human counts; explicit attempts; Owner overrides; distinct action ownership. |
| CSI-07 | Live invalidations and Admin SSE BFF | 04,06 | Reconnect/refetch; clock-only changes visible; Owner-only. |
| CSI-08 | Owner Attention/Search/panels/commands | 04,05,06,07 | One row per subject, all reasons, Needs review and connected official workflows. |
| CSI-09 | Coverage/settings and existing Lead detail entry point | 01,04,06 | Editable accepted defaults, stage health, denied/unknown distinct, no false zeros. |
| CSI-10 | Rep Identity Link proposals/review/backfill | 01,02 | Effective-dated identity, unknown speaker, no name-only auto-review. |
| CSI-11 | Recording discovery/media | 01,02,05,10 | All accepted eligibility cases; no duration gate; delayed recordings/retries/private media. |
| CSI-12 | STT/redaction/versioned transcript evidence | 11 | Immutable redacted versions, no raw persistence, retry without duplicate STT. |
| CSI-17 | Scoped MCP read/submit tools and versioned prompt/schema | 01 | Main-server boundary, least-authority token, bounded reads captured as evidence, no mutation/message tools. |
| CSI-13 | AI SDK agent runs, submission, application, number refresh | 06,10,12,17 | Unattended permitted effects, no exact-locator gate, stable dedupe, live-state and historical reconciliation. |
| CSI-18 | Owner analysis confirmation/correction/reanalysis and UI | 08,13 | Immediate corrections, original/current evidence modes, agreement and immutable history, no reapplication on confirm. |
| CSI-14 | Explicit Owner Rep Nudge | 06,08,10 | Reviewed rep target, preview/send, never automatic/customer, unknown delivery repair. |
| CSI-15 | Historical backfill, budget recovery and retention | 02,06,12,13 | Live work priority, no obsolete promises revived, purge all evidence copies, resumable windows. |
| CSI-16 | Integrated certification, capability proof and docs restamp | all above | Acceptance matrix and Owner walkthrough with artifacts; staged rollout remains separate. |

The original CSI identifiers are retained; CSI-17 and CSI-18 add MCP and intervention work. Teams may parallelize after the shared contracts are frozen, using strict fixtures before dependencies are integrated. Do not merge a DTO fork or contradictory schema to save time.

## 3. Required acceptance matrix

| Area | Required proof |
| --- | --- |
| Capture | Duplicate webhook/page replay, transferred/queue/internal calls, late terminal/update/recording, withheld/malformed number, 429/checkpoint recovery; qualified cursor unchanged. |
| Eligibility | Short linked call, inbound/outbound Form and Call Lead, Number Review, mapped inbound without Lead, reviewed-rep outbound without Lead, voicemail, closed Lead; internal/non-customer exclusion. |
| Attribution | Inbound human clears Unworked, missed inbound does not, outbound no-answer/voicemail opens with actual outcome, provider-connected unknown never means Spoke. |
| Clocks | 30 staffed minutes, 15 staffed minutes without repeat extension, two sales days human-contact clock, after-hours/DST, day-only wait cutoff/next opening, explicit outside-hours promise, ambiguous date undated. |
| Follow-ups | Multiple actions, nullable date, rep promise/customer request/model suggestion distinguished, unique completion/reschedule, unrelated activity does not complete estimate, attempts fulfill only relevant callbacks. |
| Assignment | Owner remains, first clear rep fills unassigned, unknown stays unknown, Alex owns Outreach/Jordan owns callback, specific Owner callback assignment wins, receiver Agent/allocations unchanged. |
| Review/closure | Needs review grouping, closed-work new request without reopen, official closure while identity-blocked, unresolved restriction pauses channel, no permanent AI suppression/closure, rejected attachment never re-suggested. |
| Agent | Tools actually used to gather context; scoped denied tools/subjects; prompt injection in transcript cannot gain authority; one submit receipt; schema invalid output handled; no exact-citation/entailment gate. |
| Envelope | Typed sales context, source versus record versus inference, clear actions auto-apply, unclear wait/date no fabricated deadline, actual effect status separate from review status. |
| Races | Duplicate submissions, changed same-run payload conflict, expired leases fenced, concurrent Owner edit wins, newer call/Booking makes effect stale, semantic cross-run commitment dedupe. |
| Owner intervention | Confirm run/finding without duplicate effects, immediate date correction/retraction while AI offline, same-evidence replay, current-context rerun, new output not auto-confirmed, agrees/disagrees/cannot-determine. |
| History | Backfill after later fulfillment/closure, incomplete coverage explicit, new analysis failure preserves previous result, all provenance retained until configured purge. |
| Budget/failure | $80 default, concurrent reservation admission, actual reconciliation/release, resume after cap increase, throttles/permission pauses, dead-letter/retry at failed stage, no operational blockage. |
| Messaging | Owner command only, reviewed rep, destination guard, idempotent send, no worker/model send, uncertain delivery not blindly duplicated. |
| UI/auth | Owner/Admin/service separation, single Attention row/all reasons, review-only closed rows, exact outcome copy, no stale edit overwrite, explicit action vs overall owner. |

Use meaningful unit tests for pure clocks/rank/identity/effect planner, replica-backed tests for CAS/transaction/lease races, tool/route contract tests, and targeted browser walks. No need to test unchanged production integrations repeatedly without a new failure. Check each affected repo's own package scripts rather than assuming identical commands.

## 4. Defaults and remaining deployment checks

Accepted Owner defaults: Mon–Sat 08:00–20:00 America/New_York; first-call 30 staffed minutes; missed callback 15; Going cold two sales days; monthly AI budget **$80**. Owner interaction/AI authority is settled in 01 and 10.

Preserved engineering defaults: backfill off until explicitly requested; Team Messaging primary and optional SMS-to-rep/pager off; audio retention 90 days, redacted content 365 days, activity/audit 730 days; initial per-recording reservation limit 25 cents visibly configurable; all feature flags off. These were retained from the earlier pack, not newly asserted as Owner-selected values. Validate capacity/retention during implementation; do not silently drop eligible long calls because of a spend limit.

Deployment checks: current recording-read permission (historically denied Sept 14), actual RingCentral subscriptions and renewal ownership, Agent/extension mappings, MCP scoped credentials, Gateway model/STT/tool compatibility and current pricing, private Blob availability, deployed duration/payload limits, queues and cron configuration. RingSense/ACE remain out of scope. No renewed capability probe was performed in this documentation task. Agent-facing compact of the Sept 14–15 proofs: [workspace/RINGCENTRAL-CAPABILITY.md](workspace/RINGCENTRAL-CAPABILITY.md).

## 5. Launch targets

Targets to measure, not guarantees: p95 webhook→visible interaction under 60 seconds; Call Log reconcile lag under 15 minutes; Attention under 800 ms at 10k open records; Owner command under 2 seconds; SSE reconnect under 5 seconds. AI latency begins at recording/transcript availability and includes provider limits; expose stage/backlog rather than claiming instantaneous analysis.

First enable should prove schema/authority/effect correctness with functional fixtures and a bounded evaluation sample. Exact transcript locator/entailment perfection and a mandatory 50–100-call precision threshold are explicitly deferred by the Owner. Retain evaluation artifacts for future robustness tuning without restoring the rejected human-review gate.

## 6. Completion and rollout gates

Each issue has implementation evidence, actual checks run, remaining limitations and review recorded in the workspace ledger. Full completion requires contracts aligned across all three repos, relevant tests/typechecks/lint passing, migrations verified on test DB, Owner preview walkthrough, independent capability checks, updated glossary/knowledge/docs pointers, and deployment plan. Live sends/subscription/migration/production enablement are distinct authorized actions, never implied by a docs status.

Read the execution workspace for file ownership, handoffs and acceptance evidence. “Ready for implementation” does not mean deployed or capabilities granted.

## September 17 codebase alignment

[Audit and required adaptations](11-codebase-alignment-audit.md) are part of this delivery contract. Complete the rows assigned to this team and provide integration evidence; current runtime helpers do not already satisfy the revised contracts. [Design intake](07-claude-design-brief.md) governs the forthcoming Claude artifact; its arrival is not assumed.

## Owner infrastructure update

[12](12-deployment-inputs-and-model-policy.md) supplies implementation inputs for Gateway/model selection, existing deployed MCP, Blob/optional Redis reuse, rep mapping and the historical capability probe. Model choices there are proposed starting settings; live capability evidence remains a deployment check.
