# Call & Sales Intelligence — specification pack

**Status:** revised build contract and agent-team workspace ready. Runtime not shipped by this task.
**Revised:** September 17, 2026 after the Owner interview.
**Supersedes for build purposes:** `docs/sales-intelligence/recommendation-specification.md` (Sept 11 evidence base) and `docs/sales-intelligence/number-activity-consolidation.md` (Sept 14 product cut). Both stay as evidence; this pack is the build contract.
**Source brief:** `scripts/dev_ops/ringcentral/OWNER-TRANSFER-call-intelligence.md` (gitignored; a copy of its decisions is folded into `01-specification.md`).

## What this pack is

The complete contract for the Call & Sales Intelligence system: a searchable record of what happened on every customer phone number, honest outreach state on every eligible Lead, automatically applied conversation intelligence with immediate Owner correction and versioned provenance, and an Owner "command post" on the Admin Dashboard that can find Unworked and Overdue work and message a Sales Rep on their RingCentral account.

It is built beside the existing Call Qualification pipeline, never through it. It is not a second CRM.

## Reading order

| # | File | Read it when |
| --- | --- | --- |
| 01 | [`01-specification.md`](01-specification.md) | You need the product rules: goals, proposed glossary, the four state machines with full transition tables, derived signals, scenarios, invariants, Owner language. |
| 02 | [`02-domain-models.md`](02-domain-models.md) | You are creating `src/models/*` files. Capture/provider schemas, revised action/finding contracts, immutable runs/evidence/effects, jobs and policy indexes. |
| 03 | [`03-server-pipeline-and-jobs.md`](03-server-pipeline-and-jobs.md) | You are building capture, reconcile, attachment, outreach derivation, media fetch, transcription, extraction, nudges, crons, queues, config flags, budgets, retention. Includes the event-to-job matrix, recovery and MCP-agent processing boundaries. |
| 04 | [`04-server-routes.md`](04-server-routes.md) | Owner and internal MCP routes, strict command/DTO contracts, service authorization and live reads. |
| 05 | [`05-owner-dashboard-ux.md`](05-owner-dashboard-ux.md) | Owner views/actions, analysis intervention, exact outcome copy, provenance and component plan. |
| 06 | [`06-delivery-plan-and-acceptance.md`](06-delivery-plan-and-acceptance.md) | You are opening branches. Issue pack CSI-01 … CSI-18, dependencies, acceptance, settled defaults and remaining deployment checks. |
| 07 | [`07-claude-design-brief.md`](07-claude-design-brief.md) | Current intake contract for forthcoming Claude components/styling; original brief archived under history/. |
| 08 | [`08-intelligence-envelope-handoff.md`](08-intelligence-envelope-handoff.md) | Historical prior-session evidence. Decisions and contradictions are reconciled by 09 and the revised build contract. |
| 09 | [`09-owner-workflow-interview.md`](09-owner-workflow-interview.md) | Accepted Owner interview decisions; historical record, now incorporated. |
| 10 | [`10-intelligence-agent-contract.md`](10-intelligence-agent-contract.md) | AI SDK + scoped MCP tools, typed envelope, evidence, auto-application, correction and reruns. |
| 11 | [`11-codebase-alignment-audit.md`](11-codebase-alignment-audit.md) | Verified server/Admin/MCP gaps, required adaptations and evidence. |
| Workspace | [`workspace/README.md`](workspace/README.md) | Team kickoff briefs, file ownership, dependency waves, contracts, ledger and end-to-end acceptance. |

## Decisions already made (do not re-litigate)

1. **Number Activity, not Sales Opportunity.** Work hangs off an eligible Form Lead or Call Lead, or off a Contact Number as a Number Review. No Sales Opportunity peer of Lead.
2. **Call Qualification stays closed.** Inbound, mapped RingCentral Inbound Number, answered, ≥ 120 s, caller phone present. `ingestRingCentralQualifiedCall` is never widened and never imported by the new modules.
3. **All-direction capture is a second worker** with its own cursor and lease. It never moves the qualified-call cursor.
4. **Four orthogonal machines**: Contact Number classification, Number↔Lead attachment, Outreach, Conversation processing. Overdue / No Owner / Cooldown are derived signals, never states.
5. **The agent submits; server rules apply.** Vercel AI SDK + scoped Vantage MCP, no filesystem agent. Clear commitments can create/update/complete follow-ups automatically; contact restrictions pause the affected channel. Owner correction/assignment/closure takes precedence. No official-record writes, autonomous messages, AI closure, or exact-citation verification gate. Full contract: [10](10-intelligence-agent-contract.md).
6. **Owner Rep Nudge is an explicit Owner command** after a reviewed Rep Identity Link. Team Messaging is primary; SMS-to-rep-DID and company pager are optional. Never the customer. Never automatic.
7. **Capability honesty.** Unknown ≠ zero. Use coverage-qualified absence wording and exact call outcomes; provider-connected never means Spoke.
8. **MongoDB stays the system of record.** Redis is a doorbell. Vercel Queue is a wake-up. Cron is recovery.
9. **First home is the Admin Dashboard** at `/sales-intelligence`, Owner-only. A standalone app later reuses the same server routes.

## Execution workspace

Start at [workspace/README.md](workspace/README.md). Team A freezes contracts; B–E own capture, Outreach, intelligence/MCP and Owner UI; F integrates/certifies. The ledger starts unclaimed. Accepted settings: Mon–Sat 08:00–20:00 Eastern, 30-minute first call, 15-minute missed callback, two-sales-day Going cold, **$80 monthly AI cap**.

## Branches

| Repo | Branch | Scope |
| --- | --- | --- |
| `vantage-main-server` | `sales-intelligence` | Models, services under `src/services/salesIntelligence/` and `src/services/numberActivity/`, routes, crons, config, migrations, knowledge doc. |
| `vantage-movers-mcp` | `feature/sales-intelligence-mcp` | Scoped read/submit tools, credentials, versioned prompts/schema and adapter tests. |
| `vantage-admin` | `sales-intelligence` | `/sales-intelligence` page, components, API client, live BFF, authorization, nav. |

Owner-required branch: agents must perform all Call & Sales Intelligence implementation work on `sales-intelligence` in both `vantage-main-server` (server) and `vantage-admin` (dashboard). Inspect the current branch and working tree before edits; use the existing branch or create that exact branch if absent, preserving uncommitted work. Do not implement on the default branch or substitute a differently named team branch. Record repository, branch and owned files in the workspace ledger and handoff. Coordinate agents sharing a checkout; Git cannot check out the same branch in multiple worktrees of one repository, so use separate clones when independent checkouts are necessary, and coordinate integration to avoid divergent pushes. This documentation update does not itself create or switch branches.

The MCP branch suggestion remains separate from this server/dashboard requirement.

Each branch ships behind flags that default off. See `06-delivery-plan-and-acceptance.md`.

## Glossary status

New terms in `01-specification.md §3` are **proposed**. When the Owner agrees a term, add it to workspace `CONTEXT.md` in the glossary format (`**Term**:` definition, `_Avoid_:` line). Do not paste this pack into `CONTEXT.md`.

Authority: revised 01–06 and 10 govern implementation; 07 governs design intake, 08 is historical evidence, 09 records the interview, and 11 records codebase alignment. The showcase editor could not be inspected; no claims of visual parity are made.
