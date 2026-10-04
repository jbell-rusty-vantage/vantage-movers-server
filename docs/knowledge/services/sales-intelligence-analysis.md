---
type: Service
title: "Scoped Intelligence runtime, evidence and application"
description: "Retired by server-admin slimming (2026-10). Scoped MCP evidence, bounded agent runs, durable application, current-number analysis and Owner reanalysis were removed with the server AI pipeline."
tags: [sales-intelligence, durable-work, retired]
status: retired
retired_on: 2026-10-04
resource: docs/server-admin-slimming/SPECIFICATION.md
applies_to: []
owners: [team:main-server]
sources:
  - id: retirement
    resource: docs/server-admin-slimming/SPECIFICATION.md
    title: Server and Admin slimming specification
  - id: ledger
    resource: docs/server-admin-slimming/LEDGER.md
    title: Slimming execution ledger
generated:
  by: process:docs-keeper
  at: 2026-10-04T00:00:00Z
---

**Status: retired.** Retired by server-admin slimming (2026-10). Contract: [slimming specification](../../server-admin-slimming/SPECIFICATION.md). Execution record: [ledger](../../server-admin-slimming/LEDGER.md). Do not build on this capability; nothing in `src/` implements it any more.

# Scoped Intelligence runtime, evidence and application (retired)

This Service ran the bounded analysis agent over a Number's calls through the scoped Intelligence MCP, stored evidence snapshots, submissions, findings and effects, and applied accepted suggestions. The Owner removed all server-owned AI processing (specification §7.1).

## Removed

- `src/services/salesIntelligence/{analysis,story,evidence,companyContext,aiBudget,budgetPeriod}*`, `src/validation/intelligence/**` and the AI SDK callsites. No module under `src/` or `api/` imports `ai`, `openai`, `@ai-sdk/*` or `@vercel/blob` (guard test `history/aiRetirement.test.ts`).
- The scoped run router `/api/v1/internal/sales-intelligence/runs/:id/{context,read,submit,submission}` and its run tokens (`SALES_INTELLIGENCE_RUN_TOKEN_SECRET`). The boundary answers 404; the scoped key is refused everywhere else.
- The `/api/intelligence-mcp` endpoint in `vantage-movers-mcp` (its only client).
- Owner reanalysis, admission, replay and finding commands; the `extract` and `apply` crons; job stages `analysis` and `application` (late rows are terminalized as `retired`).

## Still in place

- Canonical, deterministic history reads for the Vantage MCP general endpoint: `GET /api/v1/internal/sales-intelligence/history/{contact-number,lead-candidates,lead}` (`src/services/salesIntelligence/history/`, broad secret only). They return no analysis text.
- Contact restrictions that earlier analyses recorded (`sales_intelligence_contact_restrictions`) are kept as human-facing facts and are never cleared by the purge.

## Stored data

`intelligence_runs`, `intelligence_evidence_snapshots`, `intelligence_submissions`, `intelligence_findings`, `intelligence_effects`, `sales_intelligence_ai_budget` and `sales_intelligence_ai_reservations` are in the exclusive drop manifest ([DELETION-MANIFEST.md](../../server-admin-slimming/DELETION-MANIFEST.md)). The purge backup keeps `intelligence_findings` and `intelligence_runs` because they are the only source of the recorded restriction findings.

## Previous body

The last live version of this Service (with every invariant it described) is in git history: `git show 6a374fab:docs/knowledge/services/sales-intelligence-analysis.md`. Read it as history only.
