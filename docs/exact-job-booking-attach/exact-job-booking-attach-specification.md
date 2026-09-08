---
type: Specification
title: Exact Job Booking Attach — Employee submit and Precise Booking Form
description: >-
  Automatic Lead attach on Employee Booking Submission and the Owner Precise
  Booking Form is unique Job Number only. The Booking always files. When
  nothing exact attaches, the server writes a Leadless Booking and opens a
  Booking Lead Reconciliation Case so the Owner can attach the Call Lead
  (or Form Lead) later. Phone, email, name, and LID never auto-attach on
  these paths. Do not mint an Unmatched Call Lead from the Precise Booking Form.
tags:
  - booking
  - employee-booking
  - call-lead
  - owner-dashboard
status: proposed-final
stale_after: 2026-12-08
owners: [team:main-server, team:vantage-admin]
applies_to:
  - src/config/domain/employeeBookingMatching.ts
  - src/config/domain/bookingReconciliation.ts
  - src/services/employeeBookings/leadMatchEvaluator.ts
  - src/services/employeeBookings/submitEmployeeBooking.service.ts
  - src/services/employeeBookings/reconciliationRematch.service.ts
  - src/services/bookings/bookingSourceResolver.ts
  - src/services/bookings/leadlessBooking.service.ts
  - src/models/BookingLeadReconciliationCase.ts
  - src/services/granotLifecycle/connectLead.ts
  - src/services/granotLifecycle/confirmAttachment.ts
  - ../vantage-admin/components/forms/booking-form.tsx
  - ../vantage-admin/app/(dashboard)/bookings/new/page.tsx
  - ../vantage-admin/components/reconciliation/booking-reconciliation-dashboard.tsx
sources:
  - id: glossary
    resource: ../../../CONTEXT.md
    title: Platform glossary
  - id: employee-bookings
    resource: ../knowledge/services/employee-bookings.md
    title: Employee Bookings
  - id: bookings
    resource: ../knowledge/services/bookings.md
    title: Bookings
  - id: bila
    resource: ../booking-intake-lead-attachment/booking-intake-lead-attachment-specification.md
    title: Booking intake robustness (BILA-02 / BILA-03 shipped)
  - id: owner-intake
    resource: ../granot-lead-lifecycle/owner-booking-intake-and-lead-attachment-specification.md
    title: Owner booking intake and lead attachment
---

# Exact Job Booking Attach — Employee submit and Precise Booking Form

> **Contract maturity: implementation-ready.** Product rules in this file
> win. File citations are evidence; reverify line numbers at
> implementation. Agents work from [`README.md`](README.md) →
> [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md) → the matching issue. Do not
> start coding from chat notes.

**Prepared:** 2026-09-08
**Repos:** `vantage-main-server` (match policy, from-source, leadless
create, rematch, Connect fence). `vantage-admin` (Precise Booking Form
copy and success path; Reconciliation desk origin).
**Owner-facing labels:** Precise Booking Form, Booking saved — connect a
lead from Booking Reconciliation, No exact job match
**Canonical facts:** [Exact Job Booking Attach](../../../CONTEXT.md),
[Employee Booking Submission](../../../CONTEXT.md),
[Precise Booking Form](../../../CONTEXT.md),
[Booking Lead Reconciliation](../../../CONTEXT.md),
[Booking Lead Reconciliation Case](../../../CONTEXT.md),
[Leadless Booking](../../../CONTEXT.md),
[Connect Booking to Lead](../../../CONTEXT.md),
[Unmatched Call Lead](../../../CONTEXT.md),
[Call Lead](../../../CONTEXT.md),
[Form Lead](../../../CONTEXT.md),
[Call Lead Enrichment](../../../CONTEXT.md)

---

## 0. Authority

Read in this order. Stop and report contradictions; do not silently merge.

| Order | Authority | Wins on |
| --- | --- | --- |
| 1 | **This file** | Exact Job Booking Attach; Employee submit auto-match; Precise Booking Form from-source / leadless create; which creates open a Booking Lead Reconciliation Case; rematch rule set; Connect fence for these origins |
| 2 | [Owner booking intake](../granot-lead-lifecycle/owner-booking-intake-and-lead-attachment-specification.md) + [BILA](../booking-intake-lead-attachment/booking-intake-lead-attachment-specification.md) | Confirm Granot Booking (high-confidence allowlist, official Leadless, **no** Booking Lead Reconciliation Case). Connect Booking to Lead for Granot official Leadless only |
| 3 | Glossary [`CONTEXT.md`](../../../CONTEXT.md) | Words |
| 4 | Current repository code | The seam each issue extends |

**Where this file and BILA disagree:** BILA said Connect is the later-attach
desk for Granot official Leadless and told agents not to use Booking Lead
Reconciliation for Confirm. That stays. This file adds Booking Lead
Reconciliation to **Employee Booking Submission** (already true) and to
the **Precise Booking Form** (`/bookings/new`). It does **not** open a
Booking Lead Reconciliation Case from Confirm Granot Booking.

**Where this file and current employee-bookings knowledge disagree:** this
file wins. Phone, LID, email, and name no longer auto-attach on Employee
Booking Submission.

---

## 1. Decision

Two Owner-adjacent create paths still auto-attach a Call Lead by phone
(or mint an Unmatched Call Lead). That is too weak for Inbounds that
were never RingCentral-qualified and have no Job Number.

This work does four things:

1. **Exact Job Booking Attach** is the only automatic attach on Employee
   Booking Submission and on the Precise Booking Form when the Owner did
   not pick a stored Lead. Unique Job Number. One eligible Lead.
2. **The Booking always files.** No-match is not a 4xx. The result is a
   Leadless Booking plus a pending Booking Lead Reconciliation Case.
3. **The Precise Booking Form opens that case** the same way Employee
   submit already does. Explicit Leadless mode on `/bookings/new` also
   opens a case. Referral does not.
4. **Rematch stays, job-only.** When [Call Lead Enrichment](../../../CONTEXT.md)
   later writes the Job Number onto a Call Lead, rematch may attach that
   unique Lead. It must not attach on phone.

Do not mint an Unmatched Call Lead from the Precise Booking Form. Do not
phone-match on from-source for that form. Do not auto-attach on LID,
email, or name on Employee submit. Do not open a Booking Lead
Reconciliation Case from Confirm Granot Booking. Do not move Connect
onto `/bookings/reconciliation`.

---

## 2. Current code (do not re-decide except as §3–§8)

Observed 2026-09-08. Reverify before coding.

### 2.1 Employee Booking Submission

`POST /api/v1/employee-booking-submissions` → `submitEmployeeBooking` →
`evaluateEmployeeBookingMatch`.

Default enabled rules: `form_lid_exact`, `call_job_no_exact`,
`form_contact_triple_exact`, `form_email_phone_exact`,
`channel_phone_exact`. Env `EMPLOYEE_BOOKING_AUTO_MATCH_RULES` can
narrow or set `none`.

Unique `call_job_no_exact` or a unique preferred-model phone at exact
Source Granularity **links**. Everything else saves a Leadless Booking
(`booking_origin=employee_booking`) and a Booking Lead Reconciliation
Case (`origin` defaults to `employee_booking`). Sheet:
`booked_lead` / `employee_booking.create_pending`.

Claim refuses Call Leads with `created_on_unmatched: true` (treated as
`no_match`).

### 2.2 Booking Lead Reconciliation Case

One case per Booking (`booking` unique). Origins today:
`employee_booking`, `external_sheet_ingestion`. Statuses: `pending`,
`resolved`, `dismissed`. Owner actions on `/bookings/reconciliation`:
`attach_existing`, `create_and_attach`, `dismiss`, `reopen`, `reassign`,
`update_pending`. Candidate search is any-known-contact. Automatic
submit match does not search Granot snapshot paths.

Auto-rematch cron (`/api/cron/booking-reconciliation-rematch`) uses the
**same evaluator**, including `channel_phone_exact`. Default reason list
is only `matching_unavailable`. Delays `5,30,120` minutes.

### 2.3 Precise Booking Form (`/bookings/new`)

`BookingForm` → `createBookingFromSource` | `createLeadlessBooking` |
`createReferralBooking`.

| Mode | Today | Gap |
| --- | --- | --- |
| Form Lead + Mongo ID | Attach that Lead | Keep. This is Owner-selected, not auto-match. |
| Call Lead | Job (limit 5; **409** if more than one), then `findBestCallLeadMatchByPhone`, else mint Unmatched Call Lead | Too weak. Phone can bind the wrong inbound. Stub is not a real Call Lead. Ambiguous job must not 409 the Booking. |
| Leadless | Leadless, **no** case (except Best Relocation import) | Owner has no reconciliation work item. |
| Referral | Referral Booking, no Lead | Keep. Not a missing-Lead problem. |

Zod already allows Call Lead with only `call_job_no`. The Admin form
still requires phone for Call Lead mode.

### 2.4 Connect Booking to Lead

`isConnectableLeadlessBooking` is any non-cancelled, non-referral
Leadless Booking (or missing `lead_ref`). It does **not** exclude
`booking_origin=employee_booking` and does **not** look for an open
Booking Lead Reconciliation Case. An Owner can Connect from `/bookings`
today while the case stays `pending`; later `attach_existing` 409s.
Granot official Leadless is the narrower
`isGranotOfficialLeadlessBooking` (excludes employee origin).

BILA-03 shipped Connect on `/bookings` and `/manual`. That command is
for Granot official Leadless. This pack must stop Connect from applying
to Employee / Precise Form pending Bookings **and** to any Booking that
already has an open Booking Lead Reconciliation Case.

### 2.5 Confirm Granot Booking

`resolveConfirmAttachment`: Owner `selected_lead` wins; else unique high
+ allowlisted method; else official Leadless. **No** Booking Lead
Reconciliation Case. Out of this pack.

### 2.6 Best Relocation import

`ingestion_source=best_relocation_sheet` may still phone-match, mint an
Unmatched Call Lead, or open a case with
`origin=external_sheet_ingestion`. This pack does not change import.

---

## 3. Exact Job Booking Attach

A shared server policy. Employee submit, rematch, and Precise Booking
Form Call-Lead / omitted-Lead creates **ask** it. They do not each
re-implement a different phone rule.

### 3.1 Links when

All of the following are true:

1. The submitted / stored Job Number is present and normalizes.
2. Exactly one eligible Lead has that equivalent Job Number.
3. That Lead’s model matches the preferred channel of the create
   (`form` → Form Lead, `call` → Call Lead). Precise Booking Form Call
   Lead mode prefers Call Lead. Employee submit prefers the submitted
   Source Granularity channel.
4. The Lead is source-compatible with the submitted assignment
   (exact Source Granularity for automatic attach).
5. The Lead is eligible: not Duplicate, not Bad, not cancelled, not
   already booked, and not `created_on_unmatched`.

Rule names (keep the existing enum style):

| Rule | Preferred model | Meaning |
| --- | --- | --- |
| `call_job_no_exact` | Call Lead | Unique Call Lead Job Number |
| `form_job_no_exact` | Form Lead | Unique Form Lead Job Number |

`form_job_no_exact` is new on the employee matcher. Form Leads often
lack a Job Number until [Call Lead Enrichment](../../../CONTEXT.md) /
Form Lead Enrichment. That is fine: no job → no automatic attach →
case.

### 3.2 Never links when

These are **not** automatic attach, on create or rematch:

- Phone at any scope (`channel_phone_exact`,
  `findBestCallLeadMatchByPhone`, `source_scoped_contact`)
- Email, name, or contact triple
- Form LID (`form_lid_exact`)
- Ambiguous Job Number (two or more eligible Leads)
- Opposite-channel-only Job Number (Call Lead job on a form-channel
  submit, or the reverse) — pending `channel_conflict`
- Owner did not send a Job Number on a path that is trying to
  auto-match a Call Lead

### 3.3 Owner-selected Lead is not this policy

If the Precise Booking Form sends a Form Lead Mongo ID, attach that
Lead after the same eligibility checks used today. That is Owner
selection, the same idea as Confirm `selected_lead`. Do not open a
case.

A future Call Lead Mongo ID field on the Precise Booking Form, if
added, is the same: Owner-selected, not Exact Job Booking Attach.

### 3.4 Default enabled rules

Replace the five-rule default with:

```text
call_job_no_exact,form_job_no_exact
```

Policy version default becomes `exact-job-v1` (env
`EMPLOYEE_BOOKING_AUTO_MATCH_POLICY_VERSION` may override).

`EMPLOYEE_BOOKING_AUTO_MATCH_RULES=none` still disables automatic
attach (every Employee submit opens a case). The env must **reject**
`form_lid_exact`, `form_contact_triple_exact`,
`form_email_phone_exact`, and `channel_phone_exact` after this pack
ships — or accept them as unknown. Do not leave a backdoor that
re-enables phone attach.

Rematch and Precise Form Call-Lead auto-attach use this same list.
They do not read a second env.

---

## 4. Create outcomes

One Job Number still means one Booking. Collision remains **409**.
Throttle, auth, and Zod failures stay as today.

### 4.1 Employee Booking Submission

| Match | Booking | Case | Sheet |
| --- | --- | --- | --- |
| Unique Exact Job Booking Attach, claim wins | Linked. `booking_origin=employee_booking`. `is_leadless_booking=false`. | None | `booking_chain` / `employee_booking.create_linked` |
| No unique job, conflict, ineligible, or lost claim | Leadless. Same origin. | Pending. `origin=employee_booking`. Reason from the evaluator (`no_match`, `multiple_matches`, `channel_conflict`, …). | `booked_lead` / `employee_booking.create_pending` |

HTTP stays **201** `booked_and_linked` or `booked_pending_lead`. Do not
fail closed on “no Call Lead with this phone.”

### 4.2 Precise Booking Form — Form Lead

Owner supplied `form_lead_id`. Load that Form Lead. Eligible → attach
via existing `createBookedLead` / from-source Form path. No case.

Ineligible (missing, Duplicate, Bad, cancelled, already booked) →
**409** as today. This is an explicit ID, not a search miss.

### 4.3 Precise Booking Form — Call Lead

Require `call_job_no` at the **Admin form** (job is already required in
the UI). Server Zod: Call Lead create from this Owner path must have a
Job Number. Phone is optional and is stored on the case snapshot only.

| Match | Booking | Case | Must not |
| --- | --- | --- | --- |
| Unique `call_job_no_exact` | Linked. `booking_origin=owner_booking`. | None | Write phone onto a different Call Lead. Mint an Unmatched Call Lead. |
| Two or more Call Leads with that job | Leadless. Same origin. **201**, not today’s from-source **409**. | Pending `multiple_matches`. | Fail the create. |
| Anything else | Leadless. `booking_origin=owner_booking`. `is_leadless_booking=true`. | Pending. `origin=owner_booking`. Reason `no_match` / `channel_conflict` / … | Call `findBestCallLeadMatchByPhone`. `CallLead.create` with `created_on_unmatched`. |

HTTP **201**. Owner-readable notice when a case opened: the Booking is
on Master Booked; connect the Call Lead from Booking Reconciliation.

Sheet: linked uses existing from-source `booking_chain` /
`booked_lead.create`. Pending uses `booked_lead` /
`owner_booking.create_pending` (new operation name; do not reuse
`employee_booking.create_pending` on an Owner create).

### 4.4 Precise Booking Form — Leadless

Always Leadless. Always open a pending case
(`origin=owner_booking`, `reason=no_match`) unless Best Relocation
import (`origin=external_sheet_ingestion`) which this pack does not
re-specify.

Set `booking_origin=owner_booking` so the row is not a Granot official
Leadless Booking.

Sheet: keep `booked_lead` / `leadless_booking.create` **or** switch the
Owner-form (non-import) path to `owner_booking.create_pending`. Pick
one in implementation and document it in knowledge. Import stays on
today’s `leadless_booking.create`.

### 4.5 Precise Booking Form — Referral

Unchanged. No Lead. No Booking Lead Reconciliation Case.
`is_referral_booking: true`.

### 4.6 Case submission snapshot (Owner create)

The case `submission` schema already requires name, phone, job, binder,
deposit, merchant, agent, book date, and a source assignment.

For Precise Form pending creates, fill from the form:

- `job_no` / `normalized_job_no` from the submitted Job Number
- `phone_number` from Call phone or customer phone, or the literal
  `not provided` (same pattern as Best Relocation)
- `lead_name` from customer name or `Unknown`
- `submission_id` stable per create (`owner-booking:{normalized_job_no}`
  or the Booking id). Do not collide with employee `submission_id`.
- `source_assignment` from the selected Source Company (channel `call`
  when the Owner chose Call Lead or the source label matches inbound /
  call; otherwise `form`)

Do not invent a LID.

---

## 5. Booking Lead Reconciliation (unchanged actions, wider origin)

The desk stays `/bookings/reconciliation`. Owner actions stay
`attach_existing`, `create_and_attach`, `dismiss`, `reopen`, `reassign`.
Overrideable warnings stay as today.

### 5.1 Origin

Add `owner_booking` to `BookingLeadReconciliationCase.origin`.

| Origin | Who created the Booking |
| --- | --- |
| `employee_booking` | Employee Booking Submission |
| `owner_booking` | Precise Booking Form (Call Lead miss or Leadless) |
| `external_sheet_ingestion` | Best Relocation import (unchanged) |

List and filters show origin. Do not invent a second queue.

### 5.2 What the Owner does when the Call Lead “shows”

Typical Inbound story: the Booking exists; a Call Lead later appears
with that Job Number after Call Lead Enrichment or RingCentral ingest.

1. Rematch (§6) may attach automatically if the job match is unique.
2. Otherwise the Owner searches the case (any-known-contact) and
   `attach_existing` that Call Lead.

`create_and_attach` remains for a Lead that will never exist in Mongo
otherwise. Do not use it as the default for Inbounds.

### 5.3 Connect is not this desk

A Booking is **not** connectable via Connect Booking to Lead when any
of these is true:

- `booking_origin` is `employee_booking` or `owner_booking`
- an open (`pending`) Booking Lead Reconciliation Case exists for it
- it is not a Granot official Leadless Booking

Tighten `isConnectableLeadlessBooking` (or the command preconditions)
to Granot official Leadless only:
`isGranotOfficialLeadlessBooking`, **and** no open Booking Lead
Reconciliation Case. Employee and Precise Form pending rows stay on
Booking Lead Reconciliation. Connecting must not leave an orphan
pending case.

`isGranotOfficialLeadlessBooking` must treat `owner_booking` the same
as `employee_booking` (not official Granot Leadless).

Intakes that already deep-link Employee cases to
`/bookings/reconciliation?case=` stay. After Precise Form success, the
Admin notice links the same way when a case id is returned.

---

## 6. Auto-rematch

Rematch **asks Exact Job Booking Attach**. It must not call
`channel_phone_exact` or phone search.

Default rematch reasons become:

```text
matching_unavailable,no_match
```

so a later unique Job Number on a Call Lead can close a `no_match`
case without the Owner. `multiple_matches` and conflict reasons stay
Owner-only unless an env explicitly adds them.

Delays stay `5,30,120` minutes. Flag
`BOOKING_RECONCILIATION_AUTO_REMATCH_ENABLED` unchanged. When rematch
attaches, resolution history `auto_attach_delayed` as today. When the
job is still missing, refresh candidates and schedule the next delay.

Do not rematch Best Relocation cases onto a phone rule. Import cases
already store `enabled_auto_match_rules: []`. Keep that.

---

## 7. Precise Booking Form UI

`/bookings/new` — “Precise Booking Form”.

- Call Lead: Job Number required. Phone optional (“helps Booking
  Reconciliation later”). Do not require phone to submit. The Call Lead
  desk “Book this lead” deep link today sends `call_phone_number`; keep
  that as a snapshot fill-in, and pass `call_job_no` when the Lead has
  one.
- After success with a case: say the Booking was saved and a lead can
  be connected from Booking Reconciliation. Link
  `/bookings/reconciliation?case={id}`.
- After success with an attached Lead: today’s “Booking created”
  sentence.
- Leadless: same pending notice + link.
- Do not show Connect on a row that has an open Booking Lead
  Reconciliation Case. The Bookings stored-lead / Connect section
  stays Granot official Leadless only.

Owner-visible strings live in one copy module next to the form. Do not
print `is_leadless_booking`, `owner_booking`, or `created_on_unmatched`.

---

## 8. Do not break

- One Booking per normalized Job Number.
- `claimAvailableLeadForBooking` compare-and-swap. Lost claim → pending
  case, not a second Booking.
- Confirm Granot Booking and official Granot Leadless (BILA-02 / BILA-03).
- Referral Booking.
- Best Relocation import matching and `external_sheet_ingestion` cases.
- Granot identity `source_scoped_contact` (intake suggestion / Confirm
  auto-attach allowlist). This pack does not change `identity.ts`.
- Unmatched Call Leads that already exist. New Precise Form creates
  must not mint more.
- Booking Lead Reconciliation Owner actions and override rules.
- Public employee throttle.

---

## 9. Tests that must exist

### Employee

- Unique Call Lead Job Number still links.
- Unique Form Lead Job Number on form channel links (`form_job_no_exact`).
- Same phone, no job → pending `no_match`, Leadless, case opened.
- `channel_phone_exact` / LID / email+phone no longer link even if env
  tries to list the old names (config parse fails or rule is ignored —
  pick one and test it).
- Rematch attaches only when a unique job appears; phone-only Call Lead
  does not attach.

### Precise Booking Form / from-source

- Call Lead + unique job → linked, no case, `booking_origin=owner_booking`.
- Call Lead + job, no Call Lead row → 201 Leadless + `owner_booking` case.
  Zero new `created_on_unmatched` Call Leads.
- Call Lead + job + phone that matches a **different** Call Lead without
  that job → still Leadless + case (phone must not win).
- Form Lead + id → linked, no case (Owner-selected).
- Explicit Leadless → 201 + `owner_booking` case.
- Referral → no case.
- Connect command rejects `owner_booking` and `employee_booking` Leadless
  rows (`IDENTITY_CONFLICT`).
- `isGranotOfficialLeadlessBooking` is false for `owner_booking`.

### Admin

- Call Lead submit without phone succeeds when job is present.
- Pending success copy includes the reconciliation deep link.

---

## 10. Proposed issue split

| Issue | Repos | Why this size |
| --- | --- | --- |
| [EJBA-01](issues/EJBA-01.md) | server | Policy + employee evaluator + rematch + config. Nothing Owner-form yet. |
| [EJBA-02](issues/EJBA-02.md) | server | From-source Call Lead, leadless create, `owner_booking` origin, Connect fence. |
| [EJBA-03](issues/EJBA-03.md) | admin | Precise Booking Form copy, optional phone, success link, Connect hidden on these rows. |
| [EJBA-04](issues/EJBA-04.md) | server docs | Knowledge + glossary pointers after runtime lands. |

Do not start EJBA-02 before EJBA-01 is `complete`. EJBA-03 may start once
EJBA-02 returns a case id on pending create. EJBA-04 after EJBA-02 and
EJBA-03.

---

## 11. Out of scope

- Confirm Granot Booking attach rules (already high-only / Leadless).
- Opening a Booking Lead Reconciliation Case from intake Confirm.
- Connect on `/bookings/reconciliation`, `/intakes`, or Daily.
- Best Relocation import matcher.
- Creating a Call Lead from Granot Booked.
- Changing Call Qualification or RingCentral ingest.
- Uneven binder, more than two Agents.
- Production flag enablement beyond the config defaults in this file.

---

## 12. Knowledge after ship

docs-keeper updates, do not copy this file into them:

- [`employee-bookings.md`](../knowledge/services/employee-bookings.md) —
  rule table is job-only; rematch reasons.
- [`bookings.md`](../knowledge/services/bookings.md) — from-source Call
  Lead; leadless Owner create opens a case; `booking_origin=owner_booking`.
- [`owner-booking-intake.md`](../knowledge/granot-lifecycle/owner-booking-intake.md) —
  pointer: Precise Form pending ≠ Granot official Leadless; Connect
  unchanged for Confirm.
- Admin `.cursor/rules/project-organization.mdc` — Precise Form pending
  notice + origin on the reconciliation desk.
