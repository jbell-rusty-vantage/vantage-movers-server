# Team E — Owner dashboard and intervention UI

## Current next session — September 19

Use [NEXT-SESSION](../NEXT-SESSION.md) and [SPRINT-PLAN](../SPRINT-PLAN.md). The design export exists at `vantage/vantage-sales-intelligence/`; copy/adapt its real components and scoped tokens into Admin while preserving the source. First deliver CSI-07 plus the initial CSI-08 Attention/detail read slice against the local API. Full CSI-08, CSI-09, CSI-14 dialogs and CSI-18 UI remain distinct acceptance work. Do not run the broad original kickoff as one undifferentiated task. Reconcile export DTOs, auth placeholders, proxy idempotency forwarding and SSE before treating it as integrated.

Own CSI-07/08/09 and UI CSI-18/14. Read Admin CONTEXT/rules, [05](../../05-owner-dashboard-ux.md), [04](../../04-server-routes.md), [01](../../01-specification.md). Start from A's DTO fixtures; integrate B/C/D without inventing server rules.

## Deliver

1. Owner-only `/sales-intelligence` with Attention, Numbers/Search, Reps and Coverage in existing dashboard shell, navigation and proxy auth.
2. One Attention row per subject, all reasons and Needs review; blocked/closed review items stay visible with explicit blockers. Multiple action dates/owners are visible, not compressed to one misleading field.
3. Number Activity, attachments, all official connections and links to existing mutation/reconciliation workflows. Verify actual destination URLs in Admin. Search never implicitly attaches.
4. Owner date/next step/action assignment, overall assignment, mark worked, notes, close/reopen, per-action completion, identity review, rep mapping and explicit nudge preview/send.
5. Analysis/evidence/version panel, source/inference labels, exact action outcomes, confirmation/correction/retraction, original/current reanalysis, and instruction-specific model agreement. Correction displays immediately even if AI is paused.
6. Coverage/settings with accepted defaults, $80 budget/usage, permission/backlog/retry, live invalidations and clock-driven refresh. Preserve focused edits on live updates; revisions resolve conflicts explicitly.

## File ownership

`vantage-admin` Sales Intelligence page/components, API/query/live code, Owner auth/proxy changes and nav/official links. Coordinate shared UI files with other active tasks. B/C provide operational reads/live sources; D provides analysis. No duplicate derivation or mutation policy in client hooks.

## Proof and handoff

Browser-walk the scenarios in [ACCEPTANCE](../ACCEPTANCE.md); include missing audio, budget pause, multi-action/cross-rep assignments, undated due, voicemail, closed review row, AI-vs-Owner conflict and stale correction. Test Owner/Admin gates, keyboard/dialog usability, narrow viewport and exact copy. Record actual checks/screenshots with redacted data. Give F usable Preview and synthetic fixture instructions, not only component screenshots.

## Kickoff prompt

> Implement the Owner dashboard from 05 using the frozen server contracts. Make what happened, what is due, who owns each action, and why review is needed explicit. Include all Owner interventions and model agreement/provenance. Reuse existing Vantage official-record workflows. Integrate real APIs/live updates, verify Owner-only access and browser scenarios, and hand proof to F. Do not recreate business rules in the UI.

## September 17 codebase alignment

[Audit and required adaptations](../../11-codebase-alignment-audit.md) are part of this delivery contract. Complete the rows assigned to this team and provide integration evidence; current runtime helpers do not already satisfy the revised contracts. [Design intake](../../07-claude-design-brief.md) governs the received design export; see the September 19 sprint revision for adoption and contract reconciliation.
