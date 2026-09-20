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

CSI-12 adds optional `kind: stt` on transcription reservations and an optional existing transaction session on `reconcileCsiBudget`, allowing cost, transcript evidence and next-stage work to commit together. Either monthly or per-recording ceiling increases wake budget-paused jobs. Unknown provider spend remains reserved; no estimated charge is recorded as actual. See [transcription](sales-intelligence-transcription.md).

Owner routes use the signed Registry Owner verifier after the unchanged v1 authentication chain. Agent routes require both a dedicated scoped key and a signed token bound to the stored run, subject, tools, dataset and active lease. A broad API secret is insufficient. Envelope parsing only validates shape; evidence authorization uses a trusted snapshot manifest; Team C separately validates business effects.

Run the report/apply/verify migration before enabling writers. Missing unique indexes fail closed. Account-scoped recording identity requires evidence-backed legacy attribution. No automatic production migration or data deletion is performed. Multiple follow-ups may have null dates; no single-active-action index is permitted. Existing LeadConversation text summaries and nullable provider metadata remain readable.

Owner HTTP GET/PATCH `/settings` now consume `readCsiSettings` / `commandCsiSettings` over `resolvePolicy`, `initializeCsiPolicy` and `updateCsiPolicy`. GET never writes. Environment bootstrap numbers persist only on first initialize; later Owner edits win. Deployment `csiFlag` kill switches are displayed and are not PATCH-able.

Call reconciliation, clocks, Outreach effects, MCP tools, provider orchestration, queue dispatch and Owner screens are not supplied by this foundation. Team B/C/D handlers must use these primitives and revalidate business preconditions. Privileged raw collection migration/retention operations are outside application immutability hooks.

## CSI-15 integration

`jobs.ts:continueCsiJob` commits a bounded batch under the existing lease fence and returns the same job to pending without charging a failed attempt. Historical work uses priority -100; existing priority 0 remains live. Claim admission also checks due/leased live AI work when a historical queue wake-up supplies an explicit job id. Budget and provider admission pauses retain the saved stage and do not count toward the eight genuine-failure limit.

`budgetPeriod.ts:ensureCurrentCsiBudgetPeriod` is the runtime period seam for enabled drains. Any existing covering period retains its original bounds, timezone, ceiling, actual spend and reservations even after policy changes. An unactivated covering period activates once and resumes budget-paused jobs; otherwise the helper computes the policy timezone's calendar month with the shared staffing clock and initializes it idempotently. Multiple overlapping periods fail closed. The helper does not reset a current allowance or repeatedly wake paused jobs merely because a drain runs. `budgetPeriod.test.ts` covers local month/year boundaries and DST; `scripts/test-csi15-period.ts` verifies activation, preservation and rollover on the isolated replica.

`backfill/plan.ts` reuses Owner command receipts and daily Sync Window uniqueness. `backfill/step.ts` uses a separate backfill lease and per-window epoch; page checkpoint, complete marker, upper capture watermark and activation job commit atomically. The live reconcile lease is never held across historical pages. `retention.ts` uses its own lease and privileged raw transactions because application immutability hooks must not prevent required erasure; independent default clocks are 90-day audio, 365-day redacted content and 730-day activity. Persisted retention policy wins over engineering defaults. Validation and exact limits: [CSI-15 packet](../../call-sales-intelligence/workspace/evidence/csi-15/HANDOFF.md).
`CSI-15` media cleanup: if purge wins while audio uploads, the completed media job retains a private `result.pending_blob_delete` pointer. Immediate deletion is best effort; daily retention retries pending pointers in a bounded, lease-fenced pass and clears them only after deletion succeeds. No evidence pointer is restored.
