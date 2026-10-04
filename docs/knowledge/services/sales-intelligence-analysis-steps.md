---
type: Service
title: "What the analysis model steps are shown and what they produce"
description: "Retired by server-admin slimming (2026-10). The three model steps (call summary, findings, Move assessment) and their Subject Story, Prior Analysis and Case File inputs were removed with the server AI pipeline."
tags: [sales-intelligence, durable-work, move-assessment, retired]
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

# What the analysis model steps are shown and what they produce (retired)

This page explained what each model step was shown and what the server did with each output. Every model step was removed (specification §7.1); the server makes no LLM call.

## Removed

- The call-summary, findings and Move assessment steps, their prompts (`analyze_v*`), Subject Story and Prior Analysis pages and the Case File layout (`SALES_INTELLIGENCE_CASE_FILE`).
- Running Summary and stored analysis sections on `contact_numbers` (`running_summary`, `intelligence_schedule`, analysis rollups).
- Model and pricing settings (`SALES_INTELLIGENCE_EXTRACTION_MODEL`, `SALES_INTELLIGENCE_ANALYSIS_*`, AI ceilings) and the AI budget ledger.

## Still in place

- Deterministic Number Activity ([number-activity-capture.md](./number-activity-capture.md), [number-activity-reads.md](./number-activity-reads.md)) and Number↔Lead attachment ([sales-intelligence-attachment.md](./sales-intelligence-attachment.md)).
- The Sales Outreach Desk will be built against its own specification, not from these steps.

## Stored data

See [sales-intelligence-analysis.md](./sales-intelligence-analysis.md) for the dropped collections and [DELETION-MANIFEST.md](../../server-admin-slimming/DELETION-MANIFEST.md) for the `contact_numbers` field cleanup.

## Previous body

The last live version of this Service (with every invariant it described) is in git history: `git show 6a374fab:docs/knowledge/services/sales-intelligence-analysis-steps.md`. Read it as history only.
