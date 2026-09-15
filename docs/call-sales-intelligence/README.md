# Call & Sales Intelligence — specification pack

**Status:** implementation-ready specification. Not shipped.
**Date:** September 14, 2026.
**Supersedes for build purposes:** `docs/sales-intelligence/recommendation-specification.md` (Sept 11 evidence base) and `docs/sales-intelligence/number-activity-consolidation.md` (Sept 14 product cut). Both stay as evidence; this pack is the build contract.
**Source brief:** `scripts/dev_ops/ringcentral/OWNER-TRANSFER-call-intelligence.md` (gitignored; a copy of its decisions is folded into `01-specification.md`).

## What this pack is

The complete contract for the Call & Sales Intelligence system: a searchable record of what happened on every customer phone number, honest outreach state on every eligible Lead, review-only conversation intelligence, and an Owner "command post" on the Admin Dashboard that can find Unworked and Overdue work and message a Sales Rep on their RingCentral account.

It is built beside the existing Call Qualification pipeline, never through it. It is not a second CRM.

## Reading order

| # | File | Read it when |
| --- | --- | --- |
| 01 | [`01-specification.md`](01-specification.md) | You need the product rules: goals, proposed glossary, the four state machines with full transition tables, derived signals, scenarios, invariants, Owner language. |
| 02 | [`02-domain-models.md`](02-domain-models.md) | You are creating `src/models/*` files. Every collection, field, index, and the `LeadConversation` extension, with TypeScript schema examples. |
| 03 | [`03-server-pipeline-and-jobs.md`](03-server-pipeline-and-jobs.md) | You are building capture, reconcile, attachment, outreach derivation, media fetch, transcription, extraction, nudges, crons, queues, config flags, budgets, retention. Includes the LLM processing points. |
| 04 | [`04-server-routes.md`](04-server-routes.md) | You are adding routes, Zod validators, DTOs, SSE, and Admin proxy authorization. Request/response examples for every endpoint. |
| 05 | [`05-owner-dashboard-ux.md`](05-owner-dashboard-ux.md) | You are building `vantage-admin` `/sales-intelligence`. Text wireframes, copy rules, Owner strings, component and client file plan, live behavior, states. |
| 06 | [`06-delivery-plan-and-acceptance.md`](06-delivery-plan-and-acceptance.md) | You are opening branches. Issue pack CSI-01 … CSI-16, acceptance gates, tests, rollout flags, open decisions and their defaults. |

## Decisions already made (do not re-litigate)

1. **Number Activity, not Sales Opportunity.** Work hangs off an eligible Form Lead or Call Lead, or off a Contact Number as a Number Review. No Sales Opportunity peer of Lead.
2. **Call Qualification stays closed.** Inbound, mapped RingCentral Inbound Number, answered, ≥ 120 s, caller phone present. `ingestRingCentralQualifiedCall` is never widened and never imported by the new modules.
3. **All-direction capture is a second worker** with its own cursor and lease. It never moves the qualified-call cursor.
4. **Four orthogonal machines**: Contact Number classification, Number↔Lead attachment, Outreach, Conversation processing. Overdue / No Owner / Cooldown are derived signals, never states.
5. **Findings are review-only.** No transcript ever writes a Booking, a contact field, a Lead, or a due date without an Owner command.
6. **Owner Rep Nudge is an explicit Owner command** after a reviewed Rep Identity Link. Team Messaging is primary; SMS-to-rep-DID and company pager are optional. Never the customer. Never automatic.
7. **Capability honesty.** Unknown ≠ zero. "No observed outbound in this RingCentral account" is the only allowed phrasing for a missing call.
8. **MongoDB stays the system of record.** Redis is a doorbell. Vercel Queue is a wake-up. Cron is recovery.
9. **First home is the Admin Dashboard** at `/sales-intelligence`, Owner-only. A standalone app later reuses the same server routes.

## Branches

| Repo | Branch | Scope |
| --- | --- | --- |
| `vantage-main-server` | `feature/call-sales-intelligence` | Models, services under `src/services/salesIntelligence/` and `src/services/numberActivity/`, routes, crons, config, migrations, knowledge doc. |
| `vantage-admin` | `feature/sales-intelligence-dashboard` | `/sales-intelligence` page, components, API client, live BFF, authorization, nav. |

Each branch ships behind flags that default off. See `06-delivery-plan-and-acceptance.md`.

## Glossary status

New terms in `01-specification.md §3` are **proposed**. When the Owner agrees a term, add it to workspace `CONTEXT.md` in the glossary format (`**Term**:` definition, `_Avoid_:` line). Do not paste this pack into `CONTEXT.md`.
