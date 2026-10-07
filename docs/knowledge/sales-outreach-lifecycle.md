---
okf_version: "0.2"
type: Reference
title: Sales Outreach Desk lifecycle
description: How the outreach lifecycle of the Sales Outreach Desk works as deployed on 2026-10-06 (server main@6b585f5b, configuration revision 10) — how a Lead enters, moves through and leaves the desk; the cadence clock, deadlines and the status ladder with verification and coverage_wait; how RingCentral calls and SMS become progress, with latencies, association reasons, count scopes and freshness; the words that confuse; every cron and job with its dedupe key; the daily operator checklist, repair and backfill commands, the Owner PATCH procedure and rollback; decisions and known limits.
tags: [sales-outreach-desk, sales-intelligence]
status: current
stale_after: 2027-04-06
resource: src/services/salesOutreach/
applies_to:
  - src/services/salesOutreach/**
  - src/models/salesOutreach/**
  - src/routes/sales-outreach.routes.ts
  - src/routes/sales-outreach-cron.routes.ts
  - src/routes/sales-outreach-contact-cron.routes.ts
  - src/validation/v1/salesOutreach.ts
  - src/validation/v1/salesOutreachReads.ts
  - src/validation/v1/salesOutreachEnrollment.ts
  - src/config/domain/salesOutreach.ts
  - src/config/domain/salesOutreachContacts.ts
  - src/services/ringcentral/repSms/**
  - src/services/ringcentral/webhook-subscription-lifecycle.ts
  - src/services/ringcentral/subscriptionHealth.ts
  - src/services/numberActivity/callLogIsyncLane.ts
  - src/services/numberActivity/leadContactNumber.ts
  - ops/sales-outreach/**
owners: [team:main-server]
sources:
  - id: service
    resource: docs/knowledge/services/sales-outreach-desk.md
    title: Sales Outreach Desk Service doc (as built, per module)
  - id: packet
    resource: docs/sales-outreach-desk/
    title: Build contract (SPECIFICATION, FINAL-POLICY-REVIEW, RINGCENTRAL-CAPTURE, DECISIONS)
  - id: repair
    resource: outreach-lifecycle-repair/
    title: Outreach lifecycle repair workspace (vantage root, outside this repo) — plan, findings, decisions, LEDGER
---

# Sales Outreach Desk lifecycle

This is the one place to learn how the outreach lifecycle works without reading code: how a Lead enters and leaves the desk, how the cadence clock and its deadlines work, how RingCentral activity becomes progress, what the crons and jobs do, what each state word means, and how to check health and run repairs. It describes production as deployed on 2026-10-06: server `main@6b585f5b` (Outreach lifecycle repair waves 0–3 and the SMS-coverage hotfix `521d0fff`), admin `main@8c3f403`, configuration revision 10. Per-module detail, DTO fields and every operator script flag are in the Service doc [sales-outreach-desk.md](services/sales-outreach-desk.md); business policy is the packet SPECIFICATION §§2–14 and FINAL-POLICY-REVIEW ([`docs/sales-outreach-desk/`](../sales-outreach-desk/README.md)). Glossary words (Lead, Form Lead, Call Lead, Duplicate Lead, Bad Lead, No-Sync Lead, Unmatched Call Lead, Receiver agent, Contact Number, All Numbers, Accounts, Agent, Owner) are the workspace `CONTEXT.md` terms.

Task tags such as "B6" or "C8" name the Outreach lifecycle repair work package that built a rule (workspace `outreach-lifecycle-repair/IMPLEMENTATION-PLAN.md` §2, outside this repo). The desk is deterministic: no model, transcription or suggestion is involved anywhere below.

## 1. Lead lifecycle

### 1.1 Sources and eligibility

1. **Subjects are Leads.** Only Form Leads and Call Leads become desk subjects. Each carries an immutable origin: website form, RingCentral call, Best Relocation sheet, Vantage admin, Granot-created, or legacy (`legacy_unknown` / `legacy_import`).
2. **Eligibility (P05h, `subjects/eligibility.ts`).** An official Booking, an official Cancellation or a Bad Lead closes the Lead for the desk. A Duplicate Lead and an Unmatched Call Lead (created only to anchor a Booking) are excluded and get no subject. No-Sync and Form Fill are not read: a viable No-Sync Lead stays eligible.
3. **Received time.** The Lead's `timestamp` is read through the `leadInstant` adapter (wall-clock Form and Call Leads vs real-instant Granot Leads). A missing time, or one after now or before 2010, is never guessed: the Lead is held for review (§1.4).

### 1.2 The policy decision

With an accepted Granot priority the configured `cadence.priority_map` decides: 0 New, 1 Quoted, 3 Rep discretion (open, no routine cadence), 5/7/8 closed (booked in Granot / CRM bad / CRM dead). Any other code is "No policy configured" (an active subject with a `none` period, Owner review). Codes 2 and 9 are still unmapped (decision D4 waits for their Granot labels).

Without an accepted priority the source's intake default (`cadence.intake_default_rule`) applies:

| Origin | Intake default |
| --- | --- |
| website form, Best Relocation, RingCentral call, Vantage admin | New |
| Granot-created | **New since configuration revision 8** (D3, amendment P05e-1, 2026-10-06 23:24Z); `review` before |
| legacy | no default: the Lead stays on the review list |

Granot Priority 0 is never written by the desk. A priority arrives only with a later accepted Granot observation.

Only `priority_map` and `intake_default_rule` decide the workflow. Each subject stores the `decision_fingerprint` of the configuration it was last decided under (B2); when a PATCH changes either key, the 5-minute reconcile re-decides every open subject (§1.6).

### 1.3 Subject, periods and the three statuses

- **Subject.** One `sales_outreach_subjects` row per enrolled Lead: display facts, priority provenance, the assignee, the linked Contact Numbers (All Numbers: numbers whose `lead` or `other_leads` hold the Lead), status `active` / `review` / `closed` (closed is final) and `review_reasons`. The Lead stays the system of record and is always the source: a subject is rebuilt from the Lead's current facts.
- **Policy periods.** A subject is a sequence of periods (`new`, `quoted`, `discretion`, `none`, `closed`), each starting as `intake` (fresh arrival), `transition` (accepted priority change), or `activation` (enrollment boundary, or a late first period). A later accepted priority closes the active period and opens the next at the observation's capture time; a repeated code is a no-op; a closed period never reopens. Age never resets: the cadence counts from the original received date.
- **Late first period (B1).** A subject that becomes decidable after enrollment (a held or review subject whose priority is accepted later) opens its first period with `start_kind: activation` at `max(boundary, fact time)` — never back at the received time. Nothing is owed before that instant.
- **Configuration-driven re-decision (B2).** A remap by PATCH opens the new period at `max(fact time, configuration time)` (`time_basis: configuration_activated_at`), never backdated. Closures (official Booking/Cancellation, Bad Lead) are never re-decided by the map.

### 1.4 Review: what keeps a Lead or subject off the cadence

"Review" has four meanings; the desk shows each differently.

| Meaning | Where | Reasons | What moves it |
| --- | --- | --- | --- |
| Review-list Lead (not enrolled) | enrollment report / `GET /enrollment/candidates?partition=review` | `unmapped_priority` (codes 2/9), `unsupported_intake_source` (legacy), `received_time_missing`/`_unreliable`, `ambiguous_identity`, `malformed_priority`, `legacy_closed_reopening_required`, `lead_not_found` | new Granot evidence (B6 admits it automatically, §1.5) or a policy PATCH plus a dated enrollment run |
| Review subject, held (B8) | `status: review`, no period | `ambiguous_identity` (another non-duplicate Lead carries the Job Number), `received_time_missing`/`_unreliable` | the Lead's own change, or the reconcile's 15-minute hold re-check once the other Lead is marked Duplicate; the hold clears with a B1 late first period at that instant |
| Review subject, no callable number (D-C2c, on since revision 6) | `status: review`, periods kept | `no_contact_number`: no linked Contact Number and no phone that forms an E.164 number | a number's link gains the Lead, or the Lead gets a phone; the subject returns to `active` with its original age and deadlines |
| "No policy configured" | `status: active`, `none` period, engine flag `no_policy_configured` | an accepted unmapped code (2/9) on an enrolled subject | a priority change, or the D4 PATCH |

`priority_needs_review` (a Granot-created Lead without a priority) is no longer produced while `granot_created` is `new`: the Granot-created Leads without a priority that were in scope were enrolled by `expansion-granot-new-2026-10-06` (210 in that run, including 6 already in scope; verify consistent). A review subject owes nothing. The queue's `state=pending` filter lists review subjects together with rows whose `flags.pending` is true.

### 1.5 The ways in

| Way in | Trigger | Boundary (`activation_at`) | Cohort / kind |
| --- | --- | --- | --- |
| **Intake** (gate on since `intake_admission_at` 2026-10-05T18:14:15.820Z) | a Lead created **and** received after the gate, eligible, non-legacy, not closed by priority; admitted by its creation job within about a minute | the received time (held Leads: `max(gate, created_at)` when the received time is unusable) | `intake:<gate>`, `kind: intake` |
| **Automatic expansion admission** (B6, on since revision 9, decision D7, amendment P10b-1) | a later change of a non-subject Lead touches a decision path (`granot_priority`, `last_accepted_granot_observation`, `duplicate`, `booked`, `cancelled`, `bad_lead`, `created_on_unmatched`, `timestamp`, `normalized_job_no`, `move_date`, `ingestion_origin`) and the Lead is then `in_scope` under the FAST-01 backfill scope (received in the last 90 days or an upcoming move; eligible; decidable New/Quoted; reliable time; unambiguous Job Number) | the admission instant (a P10a partial start; nothing owed before) | `admission:<New York date>`, `kind: expansion` |
| **Dated enrollment run** (operator or Owner) | report → apply → verify on a frozen selection (`pnpm outreach:enrollment`) | the apply instant | `expansion:<date>` etc., run key e.g. `expansion-granot-new-2026-10-06` |
| **Owner one-click Enroll** | Settings → Enrollment "Ready to enroll" (`in_scope`) or "Older"; the same report/apply with `selection: selected` | the apply instant | `owner-enroll-<New York date>` |

B6 does not cover Leads that become eligible because of a configuration PATCH (D3, D4) or Leads that never change: those need one dated run (the "Ready to enroll" list shows them). Runs so far: `backfill-2026-10-05` (782), `expansion-gap-2026-10-06` (6), `expansion-granot-new-2026-10-06` (210, verify consistent).

Every created subject re-derives its Lead's calls and SMS since New York midnight of its activation date (C4), so same-day earlier calls are subtracted from the start date's quota (P05f/P10a) and shown in history.

### 1.6 Assignment, changes and the ways out

- **Assignment.** The assignee (`assigned_agent_id`) is the Lead's Receiver agent only while that Agent is a **desk rep** — `active` in Setup → People and holding a reviewed `sales_rep` link (P08a-1, since 2026-10-07); otherwise Unassigned. Deactivating an Agent re-syncs that Agent's open subjects to Unassigned the same way a disconnect does; reassignment targets and Rep sign-ins need a desk rep too. The Receiver agent comes from Granot's rep, the extension's CRM username, a desk reassignment (`manual`, never overridden by Granot) or the reviewed rep who most recently called the Lead (`ringcentral_rep_call`, a placeholder Granot's rep replaces). An Accounts connect, change or disconnect re-syncs the affected subjects at once. Sil was connected by the Owner on 2026-10-06 and added to the goals roster at revision 7; Jason waits for his extension (D2).
- **Lead changes reach the desk** through the `entity_changes` tail (every minute) plus the 5-minute revision reconcile; the subject is rebuilt from current facts in an `outreach_lead_change` job. A desk assignment that finds a stale copy refreshes the subject, publishes live and answers 409 `assignment_changed` with `message: "refreshed"` (B9).
- **Ways out.** An official Booking or Cancellation, a Bad Lead, or an accepted Priority 5/7/8 closes the subject permanently. Priority 3 or an unmapped code keeps it open with no routine cadence. Reassignment never changes age or history.

## 2. The clock

1. **Dates.** Every instant is UTC; every date is a New York calendar date computed with `Intl` (next day by calendar arithmetic, never +24 h). The received date is Day 1; age advances every date, including Quoted, closed and restricted ones.
2. **New.** Each working date gets its band's call deadlines (Days 1–5: 12:00 and 20:00 ET; Day 6+: 20:00) and an SMS due 20:00 on the fixed Days 1/2/3/6/9/12…. A fresh arrival gets the 30-working-minute initial response instead of the noon slot and the arrival caps (before 18:00 two calls, through 19:30 one, later none; SMS only through 19:30). A transition or activation start gets the same caps minus earlier same-date confirmed calls, every call due 20:00, no initial clock; the 60-minute spacing anchor is seeded from the last counted prior same-date call (A6, D-A6).
3. **Quoted.** One call per working date from the first required date: the selected date (08:00–20:00; a same-day selection opens at the command time), else the next working date strictly after entry.
4. **Callbacks** open at the appointment and are due 15 minutes later; they suspend routine calls (not SMS) until the end of the appointment date.
5. **Terminations** in precedence order: closure cancels, a restriction waives its channel until the resume opening, a callback suspends, a priority change supersedes. A termination at or before the deadline is never a miss.
6. **Evidence walk.** Confirmed, unrestricted contact events in time order with the 60-minute spacing anchor (calls only; it moves only on a credited call). One call can fulfil a callback, the initial response, the period's catch-up and the earliest open ordinary requirement of its date; SMS fulfils only SMS. Windows that close unmet become one bounded catch-up per channel per period.
7. **Obligation outcomes at `as_of`** (engine): `scheduled`, `open`, `pending` (with why: `coverage` — capture does not reach the deadline yet — or `evidence` — unconfirmed evidence exists), `overdue` (proven unmet, window open), `missed` (proven, window closed), `fulfilled` / `fulfilled_late`, and the no-miss terminations. A miss is only ever recorded once coverage proves it.
8. **Channel status ladder** (engine `sod-engine-v2`, A1, decision D-A1b): blocked → overdue (verified) → `pending` → `due` → completed → scheduled → not_required.
   - A passed deadline that only coverage cannot prove yet reads **`due`** with its past `due_at` (`flags.needs_contact` true, `flags.pending` false): the Lead stays in Needs contact and the reads add `verification {state: unverified, verified_through, unverified_since}` ("Due — not yet verified"). Its obligation outcome stays `pending`; no miss is counted.
   - **`pending`** is narrowed to evidence uncertainty: unconfirmed evidence that could fulfil a passed deadline, a channel with no coverage at all (SMS not connected), or a suspended initial response.
9. **Read-time verification (A2).** Every read applies one rule with C = the channel's cadence coverage: stored `overdue` → overdue, verified; stored `due` whose `due_at` ≤ `as_of` and ≤ C → overdue, verified; ≤ `as_of` but > C → due, unverified. Team and rep overdue counts filter `queue_keys.call_due ≤ min(as_of, C_call)` or `queue_keys.sms_due ≤ min(as_of, C_sms)` in Mongo; unknown call coverage makes them null (`coverage_incomplete`), never a partial number. Stored and read states agree, so the 12:00 and 20:00 deadlines no longer dip to `pending` (no sawtooth).
10. **When a subject is re-evaluated.**
    - `next_evaluation_at` = the earliest future instant among every obligation's open/due/close, every termination, restriction start/release/resume, callback windows, cooldown expiry and the next New York midnight. **Closed and dateless review subjects have `null`** (A4): no midnight rewrite; a closed subject counts nothing "today" and its window history ends at closure.
    - `coverage_wait {call, sms}` = per channel, the earliest deadline whose verdict waits on coverage. The evaluate cron pulls these rows as soon as cadence coverage passes them (§5), so a 20:00 verdict lands at about 20:19–20:23 ET instead of at the next structural instant. Nothing is re-evaluated while capture is behind.
    - Commands, Lead changes, restriction changes and contact-event revisions nominate the subject directly. An identical result, policy and subject facts write nothing.
11. **Responsibility** at each deadline is the assignee at that instant (Unassigned otherwise); work inherited from a previous assignee is flagged.

## 3. Activity → progress

### 3.1 Hops and latencies (staffed hours)

A call shows on the desk twice: first as **awaiting confirmation** seconds after the RingCentral webhook, then as **confirmed** credit when the Call Log lists it, 1–2 minutes after hang-up. Only confirmed calls count. Nothing polls RingCentral per call.

| Hop | Trigger | Expected latency | Call state |
| --- | --- | --- | --- |
| RingCentral telephony webhook → stored receipt (verification token checked) → `capture_projection` job | webhook; queue wake; minute job recovery as the net | 1–5 s | — |
| `capture_projection` → `call_interactions` row (+ Contact Number, lead link) → `outreach_contact_change`, same transaction | job completion | seconds | webhook-only: `terminal: false`, `call_log_state: null` |
| `outreach_contact_change` → contact event → `outreach_rep_day` recount | queue; contact-events cron steps 3–4 as the net | ≤ 1 min | `goal_credit: awaiting_confirmation`; rep-day `actual_awaiting_confirmation` +1 |
| Hang-up → Call Log lists the call | provider | 15–30 s | — |
| Call Log ISync lane → touched rows → wake → re-derive → recount | `* * * * *` in [07:45, 20:30) ET, except UTC minute ≡ 3 mod 5 (the reconcile carries ISync there) | 60–120 s after hang-up, worst ≈ 3 min | `call_log_state` set → `confirmed` +1, awaiting −1 |
| Fallbacks | `call_log_refresh` at +5 min (retries +5/+15, `already_confirmed` when ISync won); reconcile `3-59/5`; nightly 36-h sweep 07:40Z | — | — |
| Capture watermarks (reconcile only) | `known_complete_through` = window end − 15 min, capped by the oldest provisional row and by ISync time − 15; `observed_complete_through` = the same without the provisional cap (A3) | 15–20 min behind | drive coverage (§3.4) |
| Cadence verdict on a passed deadline | evaluate cron coverage repair once cadence coverage passes the deadline | ≈ 19–23 min after the deadline | due/unverified → overdue/missed, or fulfilled |
| Rep-day row `complete` | goal coverage reaches `as_of` − 25 min | ≈ 25 min after the rep's last call | zero-call reps read a recorded 0 |
| SMS: message-store webhook → `rep_sms_sync` (10-s bucket, due +2 s) → mailbox ISync → evidence → wake → derive | webhook; 5-minute stable-slot poll as the net | 2–12 s to sync, then as calls | `sms_sent` confirmed on Sent/Delivered; never goal credit |

### 3.2 Association (who a contact credits)

- **Rule (IMPL-07, All Numbers).** A call credits the number's **current Lead** (`contact_numbers.lead`) when that Lead is an active desk subject with `activation_at ≤ event_at` and no `closed` period started by then. An SMS takes the current Lead of each counterpart number (several Leads → `ambiguous`). Anything else is association `none`: the call still earns the initiating rep's all-outbound goal credit but shows as "Other outbound" and never satisfies a requirement. The optional `evidence.call_association_rule: single_active_subject_on_link` (D-C2d) is **off**.
- **Every Lead's phone has a Contact Number** (C2b): the Lead's `lead_link` job mints it (Call Leads always, `created_via: call_lead`), so a subject is no longer left with `contact_number_ids: []` until its first call.
- **Re-derivation.** A lead-link change re-derives the number's newest 200 calls and SMS in the same transaction; a created subject or a past-effective period change re-derives the Lead's sources (C4); an Accounts change re-maps the mailbox's last 7 days of SMS identity (`rep_sms_remap`, C7). A same-date contact before `activation_at` keeps association `none` and its goal credit but carries the `subject_id`, so the start date's quota subtracts it.
- **`association_reason`** (C8) on every contact event says why: `eligible` (unique, New/Quoted period), `not_new_quoted`, `ambiguous`, `no_lead`, `lead_not_enrolled`, `before_activation`, `lead_closed`; null for rows excluded before association (merged, purged, internal, unknown direction, not external, duplicate SMS copy). Rep-day rows store "Other outbound" broken down by these reasons (`other_outbound.breakdown`, plus `unknown` for events derived before C8); the team read sums the roster reps.

### 3.3 Goal rows and count scope

- One `sales_outreach_rep_day_projections` row per rep per New York date with activity, plus a frozen zero row for each roster rep's past day without activity (C5). Goal = effective-dated override, else the scheduled goal, else 0; `remaining = max(0, goal − actual)`; team goal = sum of roster goals. Yesterday's snapshot freezes on the first recount after midnight.
- **Who is on the roster (P08a-1, F1/F2, 2026-10-07).** With `goals.roster_rule: desk_reps` the roster is derived: every Agent that is `active` (Setup → People) and holds a reviewed `sales_rep` link (Accounts) at the roster instant — now for today, the end of the New York day for a past day. Those **desk reps** are the only Daily call goals rows, the only goal holders, the only C5 zero rows and the team denominator; `goals.rep_work_schedules` keeps per-rep working days and goals (a rep without a row: every weekday, the default goal) and may name Agents who are not reps yet. Connecting an active Agent in Accounts, or activating a connected one, enrolls them at once; disconnecting or deactivating removes them at once (today's denominator moves; frozen past days do not). Calls by anyone else keep their credit on the contact events but are not rows: the Owner sees "Also today: N outbound calls by M people not on the roster" under the table. With the key absent (`explicit`) the configured list is the roster, as before.
- **Count scope from configuration (C1a, decision D1 A).** `goals.count_scope_schedule[] {from_day, scope}` decides the headline per day; absent = `all_outbound` every day. It is absent in production, so the headline is all confirmed outbound calls. A PATCH may only change days after today (`count_scope_not_prospective`).
- **Both scopes are stored (C1b).** Each row stores `actual_{confirmed,awaiting}_{all,eligible}`; the read serves the headline scope and the other as `alternate_scope` (team: `goals.outbound_calls.alternate`), shown as "97 outbound · 12 to enrolled Leads". The alternate count never drives remaining, progress or goal reached.

### 3.4 Coverage and freshness (exact tolerances)

All tolerances are runtime configuration read through `deskTimingOf` (`config/timing.ts`); none is set in production, so the code defaults apply.

| Value | Key (default) | Used for |
| --- | --- | --- |
| Settlement allowance | `evidence.call_settlement_allowance_minutes` (2) | subtracted from capture before any verdict or count |
| Today tolerance | `evidence.today_coverage_tolerance_minutes` (25) | today is `complete` when coverage reaches `as_of` − 25 min; must exceed settlement + 15 |
| Capture freshness | `evidence.capture_freshness_tolerance_minutes` (10) | calls confirmation age; SMS mailbox coverage age |
| Webhook silence | `evidence.webhook_silence_minutes` (30) | newest call webhook age once today's stream has started |

- **Cadence coverage (calls)** = min(capped `known_complete_through` − allowance, the contact-event derivation watermark). It is used for every verdict that can establish a miss.
- **Goal coverage (calls, D-A3)** = min(max(observed, known) − allowance, max(observed, known) of the derivation watermark). It ignores the provisional-row cap, so a stuck provisional Call Log row no longer holds a rep-day `partial`. Rep-day coverage `complete` / `partial` / `unknown`: a zero is shown only when complete; otherwise the count is null (Pending) and a positive count is a lower bound.
- **SMS coverage** = the worst `known_complete_through` over the **current** reviewed `sales_rep` mailboxes only (hotfix `521d0fff`): a retired or re-roled mailbox keeps its sync row but no longer holds coverage back. Null while SMS capture is off or a current mailbox has no watermark yet.
- **Calls freshness ("Calls updated")** (A3-fresh, RINGCENTRAL-CAPTURE §8):
  - `last_confirmation_at` = max(ISync lane success, the reconcile's own sync success); outside staffed hours only the reconcile confirms. Both stamps are sticky.
  - `last_webhook_at` = the newest telephony webhook receipt. Inside [07:45, 20:30) ET, once today's call webhook stream has started, "Calls updated" = min(confirmation, webhook); before the day's first call webhook, and outside the window, it is the confirmation.
  - `fresh` needs: confirmation ≤ 10 min old; coverage (max(observed, known)) within 25 + 2 min; and, once today's stream has started, the newest webhook ≤ 30 min old.
  - Otherwise `delayed` with the first `reason` that applies: the reconcile's error code, `confirmation_stale`, `coverage_behind`, `webhook_silent`. `unknown` (`no_capture_state`) when there is neither a confirmation nor a watermark. `webhook_silent` never fires between 07:45 and the first call of the day; a missing, expired or blacklisted subscription is reported by the subscription health rows, not by this chip.
- **SMS freshness** = `not_connected` while capture is off, else the worst current mailbox, `fresh` within 10 min. `freshness.sms.pending` (C7) counts SMS contact events of the last 7 days still `pending_identity` / `pending_association`, per current mailbox.

### 3.5 The RingCentral subscription lifecycle

- Two owned subscriptions: `calls` (one account-level telephony-session filter) and `rep_sms` (one message-store filter per current reviewed `sales_rep` mailbox). Each create generates a `deliveryMode.verificationToken`; the webhook route refuses (403, nothing stored) a delivery for a token-bearing subscription whose `Verification-Token` header is missing or wrong, and counts the refusal on the subscription row.
- **A token can only be set at create.** RingCentral ignores `verificationToken` on `PUT`. A `PUT` (renewal, filter drift) therefore never mints or records a token (CW2). Adding a token, or recovering a subscription whose deliveries are refused, takes `replace`: create a new subscription with a fresh token, record it, then delete the old one.
- Incident 2026-10-05 17:12Z → 2026-10-06 15:20Z: an operator `--apply` `PUT` a new token onto `calls`; RingCentral kept delivering without the header, every telephony delivery was refused for about 22 hours and RingCentral blacklisted the subscription. Calls were not lost (the Call Log lane captured them); awaiting-confirmation, live fan-out and the freshness chip were dead. It was repaired by delete + create and fixed in code by CW2.
- Health (`*/5`, read-only): `webhook_subscription_health:{calls,rep_sms}` `last_run.error_code` null when healthy, else `subscription_missing`, `expired`, `blacklisted`, `filter_drift`, `token_missing`, `deliveries_refused` (Active at the provider while the route refuses its deliveries: at least 3 refusals within 30 min and no stored delivery since, so one stray POST naming our subscription id never triggers a replace; clears on the first stored delivery or 30 min after the last refusal), and for `rep_sms` `no_mailboxes` / `not_connected`. The daily 06:15Z cron renews, `PUT`s drifted filters and applies a `calls` `replace`; it never replaces `rep_sms` (the operator script does).

## 4. Vocabulary that confuses

| Word | Means | Does not mean |
| --- | --- | --- |
| `due` + `verification.state: unverified` ("Due — not yet verified") | a passed deadline that capture cannot prove yet; the Lead stays in Needs contact | a miss, or nothing to do |
| `pending` (channel status, `flags.pending`) | evidence uncertainty: unconfirmed evidence that could fulfil a passed deadline, or no coverage at all for the channel | a coverage wait (that is `due` + unverified since engine v2) |
| `pending` (obligation outcome) | the engine cannot settle the obligation yet (`coverage` or `evidence`) | a channel status |
| `pending` (read / `counts.projection_pending`) | a subject without a projection yet | either of the above |
| `job_pending` | the Lead has no Granot Job Number yet | a pending job |
| `awaiting_confirmation` | a webhook-only call: shown, never counted, never a miss | a confirmed call |
| "Other outbound" (`unattributed`) | confirmed outbound calls with no eligible subject, broken down by `association_reason`; counted toward the all-outbound headline | calls lost or ignored |
| `review` | one of the four meanings in §1.4 | a failure state |
| `coverage_wait` | the earliest deadline per channel whose verdict waits on coverage | a timed retry |
| coverage `partial` on today's rows | capture is still inside the 25-minute tail or behind | an outage (see freshness for that) |
| `delayed` / `webhook_silent` | the newest call webhook is older than 30 min after today's stream started | a missing subscription (the health rows report that) |
| `admission` | B6 automatic expansion admission (`admission:<date>` cohort) or the B8 admissions read | intake |
| desk rep | an Agent that is `active` and holds a reviewed `sales_rep` link at the instant in question (P08a-1): on the roster, assignable, able to sign in as a Rep | any Agent with a RingCentral extension, or any reviewed link (a deactivated Agent's link stays reviewed but makes nobody a rep) |

## 5. Crons, jobs and identities

### 5.1 Crons

| Cron | Schedule | Does |
| --- | --- | --- |
| `/api/cron/sales-outreach-lead-changes` | `* * * * *` | `entity_changes` tail loop (≤ 100 per pass, 2-min overlap, ≤ `migration.feed_max_passes_per_run` 10 passes / `feed_budget_seconds` 15 s) → `outreach_lead_change` nominations (incl. B6 admission) → drain ≤ 100 jobs (40 s) |
| `/api/cron/sales-outreach-revision-reconcile` | `*/5 * * * *` | open subjects in pages of 100 (≤ 50 pages): Lead revision moved → `outreach_lead_change`; decision fingerprint differs → decision job (≤ `migration.decision_reconcile_per_run` 300 per run); held `ambiguous_identity` subjects → 15-minute hold re-check |
| `/api/cron/sales-outreach-evaluate` | `* * * * *` | (1) clock repair: `next_evaluation_at ≤ now`, ≤ 500; (2) coverage repair per channel: `coverage_wait ≤` cadence coverage, ≤ 500 each; (3) policy reconcile: missing projection or other policy fingerprint, ≤ 500; (4) drain `outreach_evaluate` with `operations.evaluate_drain_*` (**300 jobs / 50 s / concurrency 2 since revision 10**; code default 100 / 40 s / 1). Steps 1–3 skip a nomination whose job already exists (A5) |
| `/api/cron/sales-outreach-contact-events` | `* * * * *` | calls sweep 25 s → SMS sweep 8 s → (2b) SMS pending counters, at most every 5 min → drain `outreach_contact_change` ≤ 100 (10 s) → drain `outreach_rep_day` ≤ 100 (5 s) → refresh today/yesterday rows (incomplete coverage, unfrozen goal, scope or field drift) and yesterday's zero rows |
| `/api/cron/sales-intelligence-call-log-isync` | `* * * * *`, [07:45, 20:30) ET | one Heavy Call Log ISync; confirms calls; wakes the desk for touched rows |
| `/api/cron/sales-intelligence-call-log-reconcile` | `3-59/5 * * * *` | windowed Call Log reconcile (+ its own ISync); moves `known_complete_through` / `observed_complete_through` |
| `/api/cron/sales-intelligence-call-log-sweep` | `40 7 * * *` | 36-hour Call Log sweep (not a derivation net) |
| `/api/cron/sales-intelligence-rep-sms-poll` | `* * * * *`, [07:45, 20:30) ET | each current mailbox once per 5 min, skipped when synced < 4 min ago |
| `/api/cron/sales-intelligence-webhook-subscription` | `15 6 * * *` | renew; `PUT` drifted filters; apply a `calls` `replace` |
| `/api/cron/sales-intelligence-subscription-health` | `*/5 * * * *` | read-only health rows (§3.5) |
| `/api/cron/sales-intelligence-job-recovery` | `* * * * *` | drains queued `sales_intelligence_jobs` stages incl. `capture_projection`, `lead_link`, `rep_sms_sync`, `rep_sms_remap` |

The lead-change, reconcile and evaluate crons answer `{ ok, skipped: true }` while the configuration is not active (evaluate additionally requires `controls.cadence_shadow_enabled` or `cadence_enforcement_enabled` on); the contact-events cron's steps skip (cursor unmoved) unless it is active with `desk_enabled` or `goal_metrics_enabled`. No env flag gates desk behaviour; switches live in `sales_outreach_configuration`. (The capture crons above the desk keep their own `SALES_INTELLIGENCE_*` gates; see [environment.md](environment.md).)

### 5.2 Job stages and dedupe keys

| Stage | Dedupe key patterns (`sales_intelligence_jobs.dedupe_key`) |
| --- | --- |
| `outreach_lead_change` | `sod:lead-change:<model>:<id>:r<lead revision>` (tail, reconcile, creation `:r1`); `…:decision:<fp16>:c<configuration revision>` (B2); `…:hold:<YYYYMMDDTHHmm>` (B8, UTC 15-min bucket); `…:admission:r<lead revision>` (B6); `…:link:<number id>:r<link revision>` (lead link); `…:<tag>` (Accounts re-sync, `numbers:desk-resync`, e.g. `lane-c-review-rule-r6`) |
| `outreach_evaluate` | `sod:evaluate:<subject>:r<subject revision>`; `…:r<rev>:contacts:<digest>` (contact events moved); `…:due:<ms>` (clock repair); `…:coverage:<call\|sms>:<wait ms>:<5-min coverage bucket>` (coverage repair); `…:policy:<fp16>` (policy reconcile); `…:plan:r<plan revision>` (Quoted date / callback); `…:assignment:l<lead revision>`; `…:restriction:<id>:r<n>`; `…:repair:<period id>` (B1 script) |
| `outreach_contact_change` | `sod:contact_change:<call\|sms>:<source id>:r<revision>` or `:m<winner>`; `…:admit:<subject>` (C4 create); `…:period:<subject>:<sha16(transition key)>` (C4 period); `…:link<revision>` (lead link); `…:repair:<period id>` (B1 script) |
| `outreach_rep_day` | `sod:rep-day:<agent>:<YYYY-MM-DD>:<digest of event versions>` |
| `rep_sms_sync` | `rc:rep_sms_sync:<extension>:<10-s bucket>` |
| `rep_sms_remap` (C7) | `rep-sms-remap:<extension>:<command id>` |
| `capture_projection` (shared) | `csi:capture_projection:receipt:<uuid>` (or `receipt_id:<id>`) |
| `call_log_refresh` (shared) | `csi:call_log_refresh:session:<telephony session id>:1` |
| `lead_link` (shared) | `csi:lead-link:<policy version>:lead:<model>:<id>:<fingerprint>` |

Completed jobs are kept 14 days (`GET /enrollment/admissions` reads them). The configuration pointer is re-read at job admission and inside each job transaction; a moved pointer retries.

## 6. Operating the desk

### 6.1 Daily checks (`pnpm outreach:desk-state --target=vantagemovers`, read-only)

Run from a server checkout with `.env`. It refuses a mismatched target, has no write mode, and prints one JSON summary (`summary_version` 3). Healthy reads:

| Section | Healthy |
| --- | --- |
| `configuration` | `state: active`; `integrity.raw_hash_matches` and `parsed_hash_matches` true; revision as expected (10 at 2026-10-06 23:34Z) |
| `jobs` | `dead_letters_total` 0; pending/retry due now ≈ 0 outside a drain |
| `projections` | all `sod-engine-v2`; `next_evaluation.past_due` 0; `closed_scheduled` ≈ 0 |
| `watermarks` | `call_log` lag ≤ ~20 min, error null; subscription maintenance (after 06:15Z) and both `subscription_health_*` rows `error_code` null |
| `freshness_inputs.calls` (staffed hours) | `served.state: fresh`; `confirmation_lag_min` ≤ 10; `webhook_lag_min` ≤ 30 after the first call of the day |
| `rep_days` | today `count_scope` all `all_outbound`; `today_served.actual_basis` has no `pending` once coverage is complete; `pending_without_row` 0 |
| `subjects_without_numbers` | `active_lead_has_phone` 0 |
| `call_interactions` | unconfirmed `before_cc04.inbound_outbound` 0 |
| `wave2_acceptance` (after a deadline) | 20:00 ET: note `call.read_due_unverified`; ≈ 20:25 ET: `call.stored_overdue` ≈ that minus calls confirmed since; `coverage_wait.*.proven` drains to 0; `distinct_overdue_leads.served_rule` = `design_count` |

Also each day: `GET /api/v1/admin/sales-outreach/enrollment/admissions?business_day=<date>` (Owner; Settings → "New-lead intake") for intake and admission counts and refusals in words; after the first B6 admissions of a day, verify the cohort (`POST /enrollment/verify {cohort_id: "admission:<date>"}`) → `consistent: true`; the enrollment report's `in_scope` stays near 0 (what remains are Leads that never changed: enroll them with one click or a dated run). Midnight check (optional): `--out=closed.json` before 00:00 ET and `--compare=closed.json` after 00:15 ET → `closed_publication.comparison.increased` 0.

### 6.2 Commands

All production writes pass the production-writer guard (local HEAD must equal the deployed commit) and are dry runs unless `--apply`. Flags and summaries: Service doc "Operator scripts".

| Need | Command |
| --- | --- |
| Build declared indexes (after each deploy that adds one) | `pnpm outreach:indexes --target=vantagemovers` → `--apply` |
| Install / check the approved policy | `pnpm outreach:install-policy --target=vantagemovers` (refuses `policy_drift` once an Owner PATCH differs from FINAL-01; never `--force-policy` without a decision) |
| Flip controls or refresh the goals roster | `pnpm outreach:install-policy --target=vantagemovers --set-controls [--enable/--disable=…] [--refresh-roster [--drop-unreviewed]] [--apply]` |
| Enroll a cohort | `pnpm outreach:enrollment --target=vantagemovers` (report) → `apply --run-key=<kind>-<label>-<date>` → `verify --run-key=…` |
| Verify an automatic cohort | `POST /enrollment/verify {cohort_id}`, or `node --env-file=.env --import tsx <workspace>/outreach-lifecycle-repair/workspace/tools/verify-cohort.mts admission:<date>` (outside this repo) |
| Subjects without numbers | `pnpm outreach:subjects-without-numbers --target=vantagemovers --pretty` |
| Mint missing Lead Contact Numbers | `pnpm numbers:mint-lead-numbers --target=vantagemovers` → `--apply` (desk scope; `--scope=all` is the Owner's call) |
| Re-sync every open subject (after a rule PATCH) | `node --env-file=.env --import tsx ops/numbers-v2/desk-resync.ts --target=vantagemovers --all-open` → `--apply` |
| Recount rep-days (both scopes, zero rows) | `pnpm outreach:recount-rep-days --target=vantagemovers --from=<day> [--materialize-roster]` → `--apply` |
| Re-derive contact events (reasons, association rule change) | `pnpm outreach:rederive-contact-events --target=vantagemovers --from=<day>` → `--apply` (off-peak, after 20:30 ET) |
| Repair late first periods (pre-B1 rows) | `pnpm outreach:repair-late-first-periods --target=vantagemovers` → `--apply` (done; re-run reports 0) |
| Settle pre-CC-04 calls | `pnpm outreach:settle-pre-cc04 --target=vantagemovers` (done 2026-10-06, 1,360 calls; a second apply matches 0) |
| Subscriptions | `node --env-file=.env --import tsx ops/ringcentral/outreach-subscriptions.ts --target=<RingCentral account id> --database=vantagemovers --purpose=calls\|rep_sms\|all` → `--apply`; a plan reading `replace` creates first, then deletes |
| Numbers phase-B cleanup | `pnpm numbers:cleanup --target=vantagemovers` (already complete; the dry run plans nothing) |
| SMS access proof | `node --env-file=.env --import tsx ops/ringcentral/prove-rep-sms-access.ts --target=<account id> --database=vantagemovers` |

### 6.3 Changing the configuration (Owner PATCH)

- **Owner:** `/outreach-desk?view=settings` → configuration editor (goal counts, lead rules, new-lead defaults, the read-only priority map, timing tunables, expansion admission, no-number rule). An absent key reads as the server default; a refusal reads by its code (`count_scope_not_prospective`, `engine_policy_unavailable`, …). The editor's "Off" for expansion admission **removes** the key.
- **Operators:** `node --env-file=.env --import tsx <workspace>/outreach-lifecycle-repair/workspace/tools/owner-config.mts get <out.json>` (from the admin checkout; outside this repo) → edit only the decided key → `… patch <revision> <value.json>` (prints the key-level diff only) → the same with `--apply`. It sends the full value with `expected_revision` and a fresh `Idempotency-Key`, signed as the Owner.
- Rules: one PATCH per decision; never both the editor and the script for the same decision; record it in the repair DECISIONS log and LEDGER. After each PATCH: desk-state revision +1 with both hash flags true, dead letters 0, and every open subject's `decision_fingerprint` stamped again within about (open subjects ÷ 300) × 5 min when `priority_map` or `intake_default_rule` changed. A PATCH that changes eligibility (D3, D4) also needs a dated enrollment run.

### 6.4 Rollback

- **R0 — new keys before old code.** Every key added after revision 5 is optional with no default, and older code's strict schema reads an unknown stored key as `invalid_value`: the configuration becomes unavailable and every desk read, cron and the intake gate fail closed with 503 `CONFIGURATION_UNAVAILABLE`. Before any server code rollback, PATCH a value with each key the target commit does not know **removed** (not set to `false` or `null`).

| Rolling the server back below | First PATCH out | Present in production now |
| --- | --- | --- |
| P08a-1 F1/F2 (the commit after `ebfc07ef`) | `goals.roster_rule` (the derived roster; the explicit list keeps working without it — re-add the retired reps' rows only if the Owner wants them back) | set to `desk_reps` on 2026-10-07 (see §7.1) |
| wave 3 (`6b585f5b` → e.g. `521d0fff`) | `transition.expansion_admission_enabled` (B6) | yes, `true` (revision 9) |
| wave 2 (`0159ec52`) | `cadence.no_contact_number_rule`, `evidence.call_association_rule`, `migration.decision_reconcile_per_run`; and set `intake_default_rule.granot_created` back to `review` (pre-B3 code refuses `new` as `policy_unavailable`) | `no_contact_number_rule` yes (revision 6); `granot_created: new` yes (revision 8) |
| wave 0 (`11c9adee`, A0) | `operations`, `evidence.*_minutes`, `migration.feed_*`, `goals.count_scope_schedule` | `operations` yes (revision 10) |

- Switching a behaviour off **without** a code rollback may use the value (`expansion_admission_enabled: false`, `granot_created: review`). Neither un-enrolls: admitted and enrolled subjects keep their periods (P05e retention).
- Stored extra fields (`coverage_wait`, `queue_keys.sms_due`, `decision_fingerprint`, `association_reason`, both counts, the breakdown, `rep_sms_pending`, `delivery_refusals`) are harmless to older code; indexes may stay. Revert the admin only after the server.

## 7. Decisions and limits

### 7.1 Decisions in force (2026-10-06)

| Id | Decision | Applied |
| --- | --- | --- |
| D1 A | headline stays all outbound; eligible count shown beside it | no PATCH (`count_scope_schedule` absent); C1a/C1b |
| D2 | Sil and Jason become desk reps on their own extensions | Sil connected (Owner, 16:52Z) and on the roster (revision 7); **Jason: extension owed** |
| D3 A (P05e-1) | Granot-created Leads without a priority are New | revision 8; run `expansion-granot-new-2026-10-06` (210, consistent) |
| D4 | map codes 2/9 through the configuration | **labels owed**; codes stay `none` / unmapped (379 Leads on the review list at 23:08Z) |
| D5 (i) | legacy-origin Leads are left alone | none; they leave the 90-day window by 2026-11-17 |
| D6 | P05g kept: a passed move date is a label, cadence continues | none (revisit with a week of data) |
| D7 (P10b-1) | automatic bounded expansion admission | revision 9 |
| D-A1b | a passed deadline capture cannot prove reads due + unverified | engine v2 |
| D-A3 | goal coverage (and header freshness) without the provisional cap | C0, A3-fresh |
| D-A6 | spacing anchor seeded from prior same-date calls | engine v2 |
| D-C2c | no usable phone → review, no cadence | revision 6 + desk re-sync |
| D-C2d | `single_active_subject_on_link` built, **left off** | none |
| D-C3 | rep-day rows before 2026-10-05 freeze with the roster of the day they were frozen | none |
| A5 / OPS-6 | evaluate drain 300 jobs / 50 s / concurrency 2 | revision 10 |
| P08a-1 (F1/F2, user 2026-10-07) | the roster is the desk reps: active Agents with a reviewed `sales_rep` link; automatic enrollment and removal; non-rep callers are an Owner footnote; event-level credit unchanged; deactivation retires no link | `goals.roster_rule: desk_reps` (revision 11), the four retired reps' settings rows dropped (revision 12); see the LEDGER for the instants |

The packet record with approval references is [DECISIONS.md](../sales-outreach-desk/DECISIONS.md) ("Outreach lifecycle repair" entries).

### 7.2 Known limits

- **Codes 2 and 9** have no meaning until the Owner reads their Granot labels (D4); then one PATCH (P05d-2), the B2 re-decision of enrolled subjects and a dated run `expansion-codes-29-<date>`.
- **Legacy Leads** (`unsupported_intake_source`, 1,421 in scope at 23:08Z) stay on the review list until they age out (2026-11-17).
- **Unassigned work.** Leads whose Receiver agent is not a reviewed `sales_rep` are Unassigned; Jason's subjects stay Unassigned until his extension is known. An aging rule for untouched old New Leads is not approved (D2 option 3).
- **Passed move dates** keep cadence (P05g, D6).
- **B6 coverage.** Configuration-caused eligibility and Leads with no change are not admitted automatically (dated run or one-click Enroll). A Lead deferred to intake that intake then refuses for a reason expansion would accept is not re-nominated; it surfaces in `in_scope`. Every newer Granot observation of a non-subject Lead nominates an admission job: watch `outreach_lead_change` depth.
- **B8 hold.** A priority-map closure (for example Priority 5 while held) does not bypass the hold; the subject stays in review until the hold clears or the official Booking arrives (nothing is owed). The admissions aggregation has no index on `completed_at`.
- **SMS coverage** is the worst current mailbox: one current mailbox that never syncs freezes SMS verdicts at its watermark (they read due + unverified, never a false miss).
- **Subscriptions.** The daily cron rarely sees a refusal ≤ 30 min old, so a `deliveries_refused` subscription is healed by the operator `--apply` (`replace`) during staffed hours, not by the 06:15Z cron. A failed DELETE after a successful `replace` create leaves two subscriptions (delete the leftover).
- **What the engine hard-codes or ignores** (FINDINGS T7): credit rules are code (`engine/credit.ts`); `evidence.*` labels; per-day open/close minutes must be uniform and `quoted_open_minute` must equal the opening; the P05f reentry thresholds reuse `late_arrival_rule`; the P10a Quoted activation cutoff reuses `quoted_same_day_cutoff_minute`; 400-day horizon and 30-date window history.
- **Minor edges** (FINDINGS T8): 19:30:59 counts as "through 19:30"; a Quoted date more than 400 days out reads `not_required`.
- **Historic rep-days** before 2026-10-05 carry the roster snapshot of the day they were frozen (D-C3). Days frozen before P08a-1 (2026-10-05 and 2026-10-06) keep the explicit roster of revision 7–10, which still names the four retired reps at goal 100.
- **`Agent.active` has no history** (P08a-1). The identity links are temporal, so a past day's roster reads the link that was effective at that day's end but the Agent's *current* active flag; it only matters for a past day without a frozen row (C5 freezes every desk rep's row after midnight).
- **Not covered by the C4 wake:** a subject created later does not re-derive a number where its Lead is only in `other_leads`.
