# 05 — Owner dashboard behavior and presentation

Status: build contract, not implemented. Revised September 17, 2026. [Product](01-specification.md) · [Routes](04-server-routes.md). [07](07-claude-design-brief.md) defines adaptation of the received `vantage-sales-intelligence` components/tokens; this specification defines features and behavior. September 19 execution order is in [SPRINT-PLAN](workspace/SPRINT-PLAN.md). The supplied here.now editor was not successfully inspected during the interview.

## 1. Placement and views

Owner-only `/sales-intelligence` in `vantage-admin`, within the existing dashboard shell. Preserve four views: Attention, Numbers/Search, Reps, Coverage. No Sales Opportunity object or rep portal. Server DTOs supply ranks, reasons, eligibility, certainty and legal actions; do not copy business rules into client hooks.

Keep URL-addressable number/Outreach panels, current filters and scroll on close. Search by phone/name/Job Number/Agent. Every row/detail shows source/Lead connections and known coverage; unknown is never a zero. Official Lead/Booking actions open their existing Vantage workflows with context.

## 2. Attention

Seven ordered categories: Promised callbacks overdue; No call yet after form submission; Missed calls with no callback; Follow-ups due; Being worked, but no next step; Open work nobody owns; Going cold. **Needs review** is a visible group/filter alongside them. Default view renders each subject once under its highest-priority reason, with secondary reasons and Needs review badges on that row. Review-only closed/blocked subjects remain visible without a Call now action.

Row anatomy: number/name → Lead/Booking chips with certainty → reason and age/deadline → last exact call outcome → overall owner and action owner where different → secondary reasons/review blockers → available actions. Show latest outcome and meaningful-contact age separately. No answer today must not imply the customer was reached today.

Examples:

- Promised callback overdue · Promised by Jordan · Callback assigned to Jordan · Outreach owned by Alex.
- Customer requested callback · Friday, 10 a.m. Eastern · Unassigned.
- Customer called—spoke with Alex · No next step.
- Customer called—missed · Callback needed · Due in 8 staffed minutes.
- Send estimate · Due date needed · AI extracted from Thursday's call.
- Calling paused · Customer said “Don't call again” · Owner review needed.
- Closed by you · New callback request received · Review before reopening.

First-call and missed-call categories appear immediately, not only after overdue. After-hours deadlines show the next opening. Going cold uses human contact only; future agreed actions/customer waits suppress that reason until due. Cooldown is explanatory; it never makes explicit overdue promises disappear. One row may contain several independently due actions; opening it exposes all.

## 3. Outreach detail

Show summary, overall responsible Agent, all active follow-ups, Needs review, connected Leads/Bookings/Cancellations, recent activity, analysis and notes. Completed/cancelled/superseded actions have a history section. Never replace multiple actions with a single date field.

Owner actions:

| Action | Interaction |
| --- | --- |
| Set callback date / Add next step | Create or edit a specific action; date may be absent and visibly needs clarification. Show action kind, description, responsible Agent and origin. |
| Assign | Clearly choose overall Outreach or one follow-up. Show current value/source. Never alter Received by or Booking allocations. |
| Mark as worked | Optional note; can finish without next step. Result may show No next step. |
| Complete action | Record actual outcome, optional evidence and optional next step. No forced fabricated contact. |
| Close | Reason and consequence: active follow-ups will be cancelled with history. Official Booked/Cancelled are not manually selectable shortcuts. |
| Reopen | Rechecks official eligibility; cancelled actions remain history until explicitly recreated. |
| Add note | Attributed context only; no hidden date/assignment/status changes. |
| Message rep | Explicit preview/edit/send to a current account User; no automatic send on assign/mark worked/analysis. A reviewed Agent match is not required. |
| Review attachment | Confirm/reject/detach with evidence; preserve ambiguous context until resolved. |
| Open official workflow | Navigate to existing Lead/Booking detail/reconciliation with context. |

Owner-set fields show who, when, prior value, and source. If another rep made the promise, keep Promised by separate from Assigned to. Unknown rep identity is stated rather than inferred from names. Existing Owner-controlled actions do not jump when new AI output arrives.

## 4. Analysis and evidence

Show sectioned summary (overview, customer wanted, money/dates, outcome, commitments, discrepancies), typed assertions, model next-step suggestion, effect outcomes, and analysis version. Badges distinguish Said on call, Confirmed by Vantage records, Model inference; AI-applied, Owner-set, Confirmed by you, Corrected by you.

Assertions display supporting conversation/record, original wording where available, actor, action status, date interpretation and applied effect. Exact transcript locator validation is deferred: label AI-provided reference / Location not checked rather than Verified quote. Missing or inaccurate segment positions do not hide the analysis. Always let the Owner open the relevant transcript version even if a precise jump is unavailable.

Actions: Confirm analysis, Confirm assertion, Correct, Retract, Re-analyze original evidence, Re-analyze current context. Confirming an already applied promise does not create it again. Correcting its date changes the action immediately and displays Analysis refresh pending; AI failure cannot roll back the Owner's correction. Retraction cancels the corresponding active commitment while preserving history and any independent later Owner changes.

Alongside each Owner instruction show latest model assessment **Agrees**, **Disagrees**, or **Cannot determine**, with rationale and evidence. A new run cannot silently inherit old confirmation. Display old assessment as stale if it references an older instruction revision. Model silence is Cannot determine. Disagreement opens Needs review but never replaces the instruction.

Model-generated strategy appears in a separate Suggested next step card with **Apply**. It is not a promise, not a scheduled follow-up, and not shown as overdue. Applying it is an explicit Owner command, with chosen date/Agent displayed.

## 5. Needs review resolution

| Cause | Owner action |
| --- | --- |
| Identity unclear | Compare candidate Leads; attach/reject in this panel. |
| Due date needed / unclear commitment | Inspect wording, set date or correct/retract assertion. |
| Rep identity or action responsibility missing | Review RingCentral link or explicitly assign. |
| Possible missing Booking/payment discrepancy | Open existing official workflow, then reconcile updated context. |
| Suggested closure | Close with reason or dismiss suggestion. |
| Contact restriction | Confirm/edit/lift scoped restriction; dialing stays blocked until permitted. |
| Model disagrees with Owner | Keep Owner instruction, correct evidence, or explicitly change instruction. |
| New request on closed work | Inspect and reopen only if eligible, or resolve without reopening. |

Resolution includes actor/time/reason and affected commands. Dismissing a card alone does not resolve identity ambiguity or lift a restriction. Ordinary AI-unconfirmed assertions do not all appear here. Review counts count unresolved decisions separately from distinct subjects.

## 6. Number Activity and connected records

Number panel preserves every eligible observed call regardless of Lead existence, audio or analysis availability. Timeline merges calls, Lead Messages, transcript/analysis versions, follow-ups, notes, assignments, restrictions, reviews, Owner messages and official context. Show event time and indicate late arrival/backfill. Transfer/queue legs stay within their canonical interaction.

Display all attachment edges and relevant Outreach records, not an arbitrary newest Lead. Each has Exact/Likely/Unsure/Confirmed by you. Booking/payment assertions are visually separate from official records. An unlinked number is not a Lead. A Number Review allows work without manufacturing one.

Voicemail labels distinguish Customer left voicemail / Rep left voicemail / Voicemail—speaker unknown. Provider-connected without evidence reads Connected—contact unknown. Full voicemail analysis is available. Calls after closure continue in the timeline and analysis without reopening work.

## 7. Reps and messaging

Backfill directory↔Agent link proposals with evidence and effective dates. Only reviewed links establish rep metrics, automatic assignment, and reviewed-rep outbound analysis. Display unmapped/uncertain history explicitly. Messaging destinations are current User extensions on the stored directory snapshot; the Owner picks the User. An Agent can have multiple extensions; one current extension cannot map to multiple Agents. Shared/dialer/service identities do not become Sales Reps by a name match.

Message rep dialog lists current account Users from the stored snapshot, shows the chosen User, permitted channel and editable masked context. A reviewed Agent name may appear when a current reviewed link exists; unmatched Users stay selectable. Preview then explicit Send; preserve idempotency across retries. Team Messaging only with a stored person id; optional SMS-to-rep only for a single stored DID; pager from the extension number. Sent/failed/unknown delivery are different outcomes. Do not show “sent” when only queued, and do not auto-resend ambiguous delivery. No message ever goes to a customer from this workflow.

## 8. Coverage and settings

Show all-direction history watermark/gaps, recording access, pending discovery/media/STT/analysis/application, oldest queued age, failures/retry, mapping hygiene, active features, model availability and budget. Missing recording or denied grant does not block work based on calls and Vantage events.

Owner-editable defaults: Mon–Sat 8 a.m.–8 p.m. America/New_York; first action 30 staffed minutes; missed callback 15 staffed minutes; Going cold two sales days; AI budget $80/month. Explain that explicit spoken dates override staffed-hours defaults. Record setting changes/version; existing explicit promises do not move silently.

Show actual spend, reserved spend and pending backlog. Budget exhausted: **Analysis paused—budget reached. Call history, follow-ups, and Owner actions still work.** Raising the limit resumes eligible work. Do not assert $80 covers all traffic. Historical backfill is Owner-triggered, range-limited, lower priority than current work and reconciled against newer activity before creating current obligations.

## 9. Live behavior and implementation map

Use SSE invalidations and refetch authoritative DTOs. Subscribe to interactions, Outreach, actions, analysis, review items, restrictions, assignments and settings. Time-derived badges update at deadlines even if no new call happens. Keep focused rows stable during editing; revision conflict refetches and shows changed values, never silently overwrites them. Reconnect with cursor and refresh after gaps.

Admin implementation areas: `app/(dashboard)/sales-intelligence/page.tsx` (verify actual route group); components under `components/sales-intelligence/`; typed client `lib/api/salesIntelligence.ts`; query invalidation and live hook; existing Owner page/proxy authorization and dashboard nav. Reuse existing operational detail panels and auth conventions after reading Admin CONTEXT and rules. Main server remains semantic authority.

Components: view shell, attention row, review group, Outreach panel, number panel, follow-up list/editor, assignment selector, analysis/assertion panel, evidence/version viewer, Owner-instruction assessment, message dialog, rep links, coverage/settings, and existing official-record links. No new standalone design system.

## 10. Acceptance walks

Test the complete Owner flow: fresh Form Lead → inbound human conversation → automatic commitment → actual attempted callback → no next step → Owner date/assignment → later model disagreement → immediate correction while AI unavailable → confirmation without duplicate effect → close → later missed call review without reopen. Include multiple actions, undated action, cross-rep ownership, voicemail, ambiguous identity, non-customer exclusion, budget pause, and stale history.

Exact string examples are not permission to hardcode fixture names. All reason codes have explicit Owner copy; unknown/unavailable never renders as zero or Spoke. Test keyboard/dialog navigation and narrow layouts as well as endpoint behavior.

## 11. Codebase alignment requirements

Use the fixed Current records scope described in 04 §8. Historical RingCentral backfill is older activity in the current dataset, not Admin's historical database scope. Never overwrite the shared scope preference just by opening CSI.

Adapt the existing conversation panel and typed client for run-specific evidence endpoints in 04. The current client returns latest detail only, and the panel contains demo/replay footer copy; remove that assumption from live CSI rendering and update the existing test that asserts it. Load signed audio only on Play, not on every list render. A purged evidence version displays its tombstone and disables original-evidence rerun; it never shows today's transcript under an old run.

Show snoozed-until separately from the original promised date, with contractual lateness preserved. Server `attention_due_at` controls action ranking; another unsnoozed reason may still keep the subject visible. Expired Attention snapshot refreshes the list. Contact-type correction is an explicit evidence correction with a reason; Mark worked alone never marks Spoke.

Team E implements the BFF idempotency/error/streaming changes and server-supplied ActionAvailabilityDto in 04, with Owner/Admin authorization tests. Preserve navigation ordering contracts or update the intentional ordering and its tests together. Component styling from Claude may change presentation, never these rules.
