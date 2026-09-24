---
type: Service
title: Call and Sales Intelligence foundation
description: Shared CSI-01 contracts, persistence, authorization and transaction primitives; feature services remain downstream.
tags: [sales-intelligence, conversations, durable-work]
status: draft
stale_after: 2026-12-17
resource: src/services/salesIntelligence/
applies_to:
  - src/services/salesIntelligence/
  - src/models/salesIntelligence/
owners: [team:main-server]
sources:
  - id: specification
    resource: docs/call-sales-intelligence/01-specification.md
  - id: contracts
    resource: docs/call-sales-intelligence/workspace/CONTRACTS.md
---

# Call and Sales Intelligence foundation

CSI-01 is complete; G1 foundation contracts are frozen after independent GPT-6 review and resolution of all five findings. Downstream feature integration remains open. All feature flags default off. The [contract pack](../../call-sales-intelligence/README.md) is authoritative for product behavior; [concrete imports](../../call-sales-intelligence/workspace/CONTRACTS.md) and the [review packet](../../call-sales-intelligence/workspace/evidence/csi-01/STEP2-HANDOFF.md) describe implemented boundaries.

Mongo is authoritative. Commands atomically combine CAS, idempotency receipts, CSI audit and downstream jobs when callers use the supplied transaction session. Jobs fence lease owner, epoch and expiry at effect commit. Budget reservations atomically enforce remaining allowance and reconcile once. Reuse `db.withTransaction`, runtime database routing and canonical payload hashing. Do not add CSI origins or entities to official domain-command enums.

CSI-12 adds optional `kind: stt` on transcription reservations and an optional existing transaction session on `reconcileCsiBudget`, allowing cost, transcript evidence and next-stage work to commit together. Unknown provider spend remains reserved; no estimated charge is recorded as actual. Since September 21, 2026 `failCsiJob` has a third paused reason beside `permission_denied` and `budget_exhausted`: `per_recording_ceiling`, used by analysis and transcription when one invocation's reservation exceeds the Owner's per-recording ceiling. A monthly increase or period activation wakes only `budget_exhausted`; a per-recording increase wakes both. See [analysis](sales-intelligence-analysis.md) and [transcription](sales-intelligence-transcription.md).

Completed jobs remain on the 14-day TTL. The dominant growth was not retention but insertion: cycle-keyed Outreach repair jobs ([outreach](sales-intelligence-outreach.md)), per-call attachment fan-out ([attachment](sales-intelligence-attachment.md)) and `updatedAt`-keyed Lead watermark jobs. Those keys are now semantic, so an idle corpus inserts nothing; `scripts/measure-csi-efficiency.ts` reproduces the job, run, pause and reservation aggregates read-only for before/after comparison.

Owner routes use the signed Registry Owner verifier after the unchanged v1 authentication chain. Agent routes require both a dedicated scoped key and a signed token bound to the stored run, subject, tools, dataset and active lease. A broad API secret is insufficient. Envelope parsing only validates shape; evidence authorization uses a trusted snapshot manifest; Team C separately validates business effects.

Run the report/apply/verify migration before enabling writers. Missing unique indexes fail closed. Account-scoped recording identity requires evidence-backed legacy attribution. No automatic production migration or data deletion is performed. Multiple follow-ups may have null dates; no single-active-action index is permitted. Existing LeadConversation text summaries and nullable provider metadata remain readable.

Owner HTTP GET/PATCH `/settings` now consume `readCsiSettings` / `commandCsiSettings` over `resolvePolicy`, `initializeCsiPolicy` and `updateCsiPolicy`. GET never writes. Environment bootstrap numbers persist only on first initialize; later Owner edits win. Deployment `csiFlag` kill switches are displayed and are not PATCH-able.

Call reconciliation, clocks, Outreach effects, MCP tools, provider orchestration, queue dispatch and Owner screens are not supplied by this foundation. Team B/C/D handlers must use these primitives and revalidate business preconditions. Privileged raw collection migration/retention operations are outside application immutability hooks.

## CSI-15 integration

`jobs.ts:continueCsiJob` commits a bounded batch under the existing lease fence and returns the same job to pending without charging a failed attempt. Historical work uses priority -100; existing priority 0 remains live. Claim admission also checks due/leased live AI work when a historical queue wake-up supplies an explicit job id. Budget and provider admission pauses retain the saved stage and do not count toward the eight genuine-failure limit.

`budgetPeriod.ts:ensureCurrentCsiBudgetPeriod` is the runtime period seam for enabled drains. Any existing covering period retains its original bounds, timezone, ceiling, actual spend and reservations even after policy changes. An unactivated covering period activates once and resumes budget-paused jobs; otherwise the helper computes the policy timezone's calendar month with the shared staffing clock and initializes it idempotently. Multiple overlapping periods fail closed. The helper does not reset a current allowance or repeatedly wake paused jobs merely because a drain runs. `budgetPeriod.test.ts` covers local month/year boundaries and DST; `scripts/test-csi15-period.ts` verifies activation, preservation and rollover on the isolated replica.

`backfill/plan.ts` reuses Owner command receipts and daily Sync Window uniqueness. `backfill/step.ts` uses a separate backfill lease and per-window epoch; page checkpoint, complete marker, upper capture watermark and activation job commit atomically. The live reconcile lease is never held across historical pages. `retention.ts` uses its own lease and privileged raw transactions because application immutability hooks must not prevent required erasure; independent default clocks are 90-day audio, 365-day redacted content and 730-day activity. Persisted retention policy wins over engineering defaults. Validation and exact limits: [CSI-15 packet](../../call-sales-intelligence/workspace/evidence/csi-15/HANDOFF.md).
`CSI-15` media cleanup: if purge wins while audio uploads, the completed media job retains a private `result.pending_blob_delete` pointer. Immediate deletion is best effort; daily retention retries pending pointers in a bounded, lease-fenced pass and clears them only after deletion succeeds. No evidence pointer is restored.


## CSI-16 evidence restamp

Current local certification is recorded in [CSI-16 checks](../../call-sales-intelligence/workspace/evidence/csi-16/CHECKS.md) and the [execution matrix](../../call-sales-intelligence/workspace/ACCEPTANCE.md). CSI-15 backfill/retention/budget recovery is landed on main. Fresh synthetic and isolated browser evidence does not certify production grants or deployed revisions. G4 retains the media Retry-After clock failure; G5 remains partial and the generic conversation replay label fails integration. Exact owners are in [GAPS](../../call-sales-intelligence/workspace/evidence/csi-16/GAPS.md). [G6](../../call-sales-intelligence/workspace/evidence/csi-16/G6.md) is not probed. Owner full rollout follows separately in AFTER-16 D+E; no capability was enabled by this restamp.

## S8-REP rep access (2026-09-24)

Behind `SALES_INTELLIGENCE_REP_ACCESS` (default off), a rep AdminUser linked to one Agent reads its own scope (assignment addendum §4.2, E8–E11, E23). Off, a request signed as `rep` takes the Owner path and gets `OWNER_REQUIRED` exactly as before.

- **Signed scope.** The admin proxy adds `x-vantage-admin-agent-id` for a rep only and signs it as an eighth line of the canonical actor payload (`buildCanonicalRepActorPayload`). Owner and Admin payloads stay seven lines, so their signatures are unchanged. `requireCsiReader` verifies it; the Registry never admits `rep`. A trusted actor's `role` and `agent_id` are non-enumerable, so persisted actors keep `{ kind, id, request_id, run_id }`; a rep's persisted `kind` is `rep`.
- **Reads.** `GET /attention`, `/outreach/closed-history` and `/overview` are forced to the rep's Agent (client `agent_id` / `unassigned` ignored; cursors bind to it; the desk's tiles and chip counts are recomputed over the rep's index entries). Record-, Number- and conversation-keyed reads (`/outreach/:id`, its timeline, assessment and findings; `/numbers/:id/conversations`; `/conversations/:id/transcript` and `/media`) answer 404 outside the E11 scope (`repScope.ts`: responsible, or any follow-up responsible or promised by the rep; a Number is in scope when one of its records is). The detail carries an empty nudge page for a rep. Media plays are audited with the rep.
- **Commands.** Only `complete_followup`, `snooze_followup` and a re-date (`patch_followup` changing `due_at` only), each with a note, on a follow-up whose `responsible_agent_id` is the rep's Agent. Anything else is `FORBIDDEN` (403). A rep change writes no Owner instruction (no Owner precedence), completes with `completion_basis: rep_confirmation`, audits the rep and its note, and nominates no paid `number_refresh`.
- **Live.** Frames carry no subject for anyone; a rep's stream forwards only the `attention`, `outreach`, `analysis` and `number` topics.
- Every other Sales Intelligence route stays Owner-only (`OWNER_REQUIRED` for a rep, as for Admin). The access matrix is `src/routes/sales-intelligence-rep-access.test.ts`.
