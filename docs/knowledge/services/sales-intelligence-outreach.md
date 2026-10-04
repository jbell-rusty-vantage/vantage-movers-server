---
type: Service
title: "Outreach and follow-ups"
description: "Retired by server-admin slimming (2026-10). The legacy Outreach planner, follow-ups, Attention snapshots, Closed, Overview, Case File, Lead progress and their Owner commands were removed."
tags: [sales-intelligence, outreach, retired]
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

# Outreach and follow-ups (retired)

CSI-06 and its successors planned Outreach records per Number, kept follow-ups, staffed clocks and bands, published Attention snapshots and served the Owner All Outreach / Needs Attention / Closed / Overview / Case File views. The Owner asked for the outreach intelligence snapshots to go; the interim `/sales-intelligence` keeps only Numbers and RingCentral Accounts (specification §1, §7.3–7.4). A new Sales Outreach Desk will be built against its own specification, not from this planner.

## Removed

- `src/services/salesIntelligence/{outreach,overview,followups,casefile,backfill}/**`, `roster.ts`, `review/restrictions.ts` (AI spoken-restriction writer) and `repIdentity/worker.ts`.
- Models `OutreachRecord`, `OutreachFollowup`, `SalesIntelligenceAttentionSnapshot`, Attention artifacts, band transitions and rep days.
- Owner routes for Attention, Outreach, Closed history, Overview, follow-ups, Start/End the call, Case File, the Outreach timeline and `POST /backfill`; they return 404.
- Crons `sales-intelligence-outreach-ensure`, `-attention-publish`, `-overview-refresh` and `-backfill-step`; job stages `outreach_ensure`, `outreach_derive` and `backfill` (late rows are terminalized as `retired`).
- Flags `SALES_INTELLIGENCE_{OUTREACH_ENSURE,ATTENTION_V2,ATTENTION_EVOLUTION,LEAD_PROGRESS,PROGRESS_PLAN,CASE_FILE,TIMELINE_V2,LIVE_SSE}` and the Outreach due-time bootstrap settings.
- The post-commit Granot Outreach wake-up. Lead changes now wake the Lead attachment job instead ([processor.md](../granot-lifecycle/processor.md)).

## Still in place

- Numbers and RingCentral Accounts: [number-activity-reads.md](./number-activity-reads.md), [sales-intelligence-attachment.md](./sales-intelligence-attachment.md), [sales-intelligence-rep-identity.md](./sales-intelligence-rep-identity.md), [sales-intelligence-nudges.md](./sales-intelligence-nudges.md). Number reads use retained attachments and canonical Leads/Bookings/Cancellations directly; they read no Outreach data.
- `sales_intelligence_owner_instructions`, `sales_intelligence_review_items` (identity reviews), `sales_intelligence_contact_restrictions` and `owner_rep_nudges` stay as human-facing history. `owner_rep_nudges.outreach_record_id` stays on historical rows only.
- Official Booking/Cancellation and accepted Granot closure evidence are untouched.

## Stored data

`outreach_records`, `outreach_followups`, `outreach_band_transitions`, `outreach_rep_days`, `sales_intelligence_attention_snapshots` and `sales_intelligence_attention_artifacts` are in the exclusive drop manifest ([DELETION-MANIFEST.md](../../server-admin-slimming/DELETION-MANIFEST.md)). `outreach_records` and `outreach_followups` are backed up first as the inert human-facts handoff. Old `/outreach/:id` links are unavailable.

## Previous body

The last live version of this Service (with every invariant it described) is in git history: `git show 6a374fab:docs/knowledge/services/sales-intelligence-outreach.md`. Read it as history only.
