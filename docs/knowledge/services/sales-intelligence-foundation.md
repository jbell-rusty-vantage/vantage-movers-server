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

Owner routes use the signed Registry Owner verifier after the unchanged v1 authentication chain. Agent routes require both a dedicated scoped key and a signed token bound to the stored run, subject, tools, dataset and active lease. A broad API secret is insufficient. Envelope parsing only validates shape; evidence authorization uses a trusted snapshot manifest; Team C separately validates business effects.

Run the report/apply/verify migration before enabling writers. Missing unique indexes fail closed. Account-scoped recording identity requires evidence-backed legacy attribution. No automatic production migration or data deletion is performed. Multiple follow-ups may have null dates; no single-active-action index is permitted. Existing LeadConversation text summaries and nullable provider metadata remain readable.

Call reconciliation, clocks, Outreach effects, MCP tools, provider orchestration, queue dispatch and Owner screens are not supplied by this foundation. Team B/C/D handlers must use these primitives and revalidate business preconditions. Privileged raw collection migration/retention operations are outside application immutability hooks.
