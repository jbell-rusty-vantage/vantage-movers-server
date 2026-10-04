---
type: Service
title: "Move assessment step, projection, reads and presentation"
description: "Retired by server-admin slimming (2026-10). The Move assessment model step, its projection, Owner reads and presentation adapters were removed with the server AI pipeline."
tags: [sales-intelligence, outreach, move-assessment, retired]
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

# Move assessment step, projection, reads and presentation (retired)

Move assessment scored a move from call evidence and exposed current/versioned assessments to the Owner. It was model output and was removed with the AI pipeline (specification §7.1–7.2).

## Removed

- `src/services/salesIntelligence/assessment/**`, models `IntelligenceOwnerAssessment` and `MoveAssessmentArtifact`, the `move_assessment` job stage and the `SALES_INTELLIGENCE_MOVE_ASSESSMENT` / `PROGRESS_PLAN` flags.
- Owner Move assessment reads (current, versions, detail, full output, evidence) and the score sorts on Attention; they return 404.

## Still in place

- `history/moveViews.ts` is unrelated: it builds deterministic move views (original ingestion and canonical current) from the Lead's own fields for the history reads. It is not an assessment.

## Stored data

`intelligence_owner_assessments` and `move_assessment_artifacts` are in the exclusive drop manifest ([DELETION-MANIFEST.md](../../server-admin-slimming/DELETION-MANIFEST.md)).

## Previous body

The last live version of this Service (with every invariant it described) is in git history: `git show 6a374fab:docs/knowledge/services/sales-intelligence-move-assessment.md`. Read it as history only.
