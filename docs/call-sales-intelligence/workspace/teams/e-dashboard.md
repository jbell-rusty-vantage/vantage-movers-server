# Team E — Owner dashboard and intervention UI

## CSI-18 delivered — September 19 (current)

UI local acceptance is complete on the existing CSI-08 panels, with actual server run/finding/evidence/history reads and confirmation, correction, retraction, Apply suggestion and original/current rerun controls. Original assertions, effect outcomes and attributed Owner changes/assessments are separate; missing assessments read Cannot determine. URL selection, Owner/Current BFF, live refetch, preserved drafts/focus and explicit conflict acknowledgement remain intact. Browser desktop/narrow/keyboard/lost-response/access checks and Admin626/typecheck/focused lint passed. Full Admin lint still has unrelated baseline failures. Server local acceptance is separately complete. [Handoff](../evidence/csi-18/HANDOFF.md), [checks](../evidence/csi-18/CHECKS.md), [review](../evidence/csi-18/REVIEW.md). CSI-09/14/15/16 remain separate; historical next-session text below is superseded.

## CSI-08 operational continuation — September 19 (latest)

CSI-08 is complete locally. Its workflows are implemented and exercised against the guarded local API: search/filter/pagination and expiry, review-only Leads, manual/candidate attachments, all existing follow-up/Outreach commands, restriction/review decisions, timeline, official links, Lead/latest-call facts, and Reps stored read/review. Unknown-outcome replay, explicit revision acknowledgement, unsaved draft/focus preservation, reconnect and clock refresh have new browser proof. [CSI-08 handoff](../evidence/csi-08/HANDOFF.md), [intake](../evidence/csi-08/INTAKE.md), [checks](../evidence/csi-08/CHECKS.md), [review/checkpoint](../evidence/csi-08/REVIEW.md). Required checkpoint ran: automated checks passed, but final review failed on inaccurate prose introduced by an isolated CSI-14 proposal; that proposal is wholly unapplied and independent final approval is not claimed. Earlier partial descriptions below are historical.

CSI-14 P2/send dialogs, CSI-18 corrections/reanalysis, CSI-09 Coverage/settings and CSI-15 remain separate. Do not restart CSI-07 or run the old broad kickoff below.

## CSI-09 — September 19 (current)

Coverage/settings and Lead-detail entry are locally complete on `main` after the merge. Owner GET `/coverage` is the full 04/05 DTO. GET/PATCH `/settings` use existing policy commands with CAS/audit. Admin has the fourth Coverage view, settings editor, and official Lead entry. Isolated replica + 3107/3108 browser proof: [handoff](../evidence/csi-09/HANDOFF.md), [checks](../evidence/csi-09/CHECKS.md). CSI-14 dialogs, CSI-15 backfill execution, and flag enablement stay separate.

## Current next session — September 19

Use [NEXT-SESSION](../NEXT-SESSION.md) and [SPRINT-PLAN](../SPRINT-PLAN.md). CSI-07/08/09/18 are locally complete on `main`. Next is the named 1–2 subject seed (P5562014, 5564480), not CSI-14 dialogs or CSI-15. Do not run the broad original kickoff as one undifferentiated task.

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

## CSI-07 / initial CSI-08 handoff — September 19

Local read slice implemented in Admin, using actual scoped export presentation and existing host auth/query/navigation. See [handoff](../evidence/csi-07/HANDOFF.md), [intake](../evidence/csi-07/INTAKE.md) and [checks](../evidence/csi-07/CHECKS.md). CSI-08 stays partial. The older broad kickoff above is not the next task.

Next CSI-08 scope: implement real Number search and Attention pagination (snapshot expiry/refetch), review-only Lead resolution and Needs review filters, attachments/identity commands, follow-up create/patch/complete/snooze/cancel, overall versus action assignment, notes/mark-worked/wait/close/reopen with idempotency and revision conflicts. Add Number Activity timeline using cursor/limit, all official-record links with verified host destinations, latest call outcome/Lead display facts when supplied by server. Reconcile absent overview and missing Attention q/source_label with owning server contracts; do not manufacture counts/DTO values. Add Reps read/review UI from current contracts. Preserve URL panel/filter state and drafts during live refetch; current slice has no editable command forms.

CSI-14 remains disabled until its P2 repair and dedicated preview/send dialog. CSI-09 owns full Coverage/settings/Lead entry points; CSI-15 owns backfill/retention. Team D may implement CSI-18 server independently of remaining CSI-08; E consumes those endpoints later. No correction/reanalysis controls were introduced here.
