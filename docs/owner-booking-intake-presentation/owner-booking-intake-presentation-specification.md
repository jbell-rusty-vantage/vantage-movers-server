---
type: Specification
title: Owner booking intake presentation
description: >-
  Owner /intakes copy and CTAs. Two postures: Finalize Booking when
  Vantage has no Booking, Possibly Fix Booking when one exists.
  Release is not a Cancellation signal. Confirm Granot Cancellation
  is not shown on Intakes. Review cards offer list-level No Action
  and an optional public cancel link.
tags:
  - granot-lifecycle
  - booking
  - owner-dashboard
status: proposed-final
stale_after: 2026-12-14
owners: [team:main-server, team:vantage-admin]
applies_to:
  - vantage-admin/components/intakes/intake-copy.ts
  - vantage-admin/components/intakes/intake-list.tsx
  - vantage-admin/components/intakes/booking-intake-workbench.tsx
  - vantage-admin/components/intakes/intakes-dashboard.tsx
  - vantage-admin/components/granot-lifecycle/booking-owner-actions.tsx
  - vantage-admin/components/dashboard/needs-you.tsx
  - vantage-admin/lib/api/granotLifecycle.ts
  - src/services/granotLifecycle/projections.ts
sources:
  - id: glossary
    resource: ../../../CONTEXT.md
    title: Platform glossary
  - id: booking-reconciliation
    resource: ../knowledge/granot-lifecycle/booking-reconciliation.md
    title: Granot Booking reconciliation Service
  - id: owner-booking-intake
    resource: ../knowledge/granot-lifecycle/owner-booking-intake.md
    title: Owner booking intake pointer
  - id: cancelled-lead
    resource: ../knowledge/services/cancelled-lead.md
    title: Cancelled Lead Service
---

# Owner booking intake presentation

> **Contract maturity: implementation-ready.** Product rules in this
> file win on Owner `/intakes` copy, CTAs, and which commands that
> desk shows. File citations are evidence; reverify line numbers at
> implementation. Do not start coding from chat notes.

**Prepared:** 2026-09-14  
**Repos:** `vantage-admin` (list, workbench, Overview waiting cards,
copy). `vantage-main-server` (list projection field for the public
cancel link only).  
**Canonical facts:** [Granot Booking Reconciliation Case](../../../CONTEXT.md),
[Granot Booking Action](../../../CONTEXT.md),
[Confirm Granot Booking](../../../CONTEXT.md),
[Update Existing Booking](../../../CONTEXT.md),
[No Action](../../../CONTEXT.md),
[Confirm Granot Cancellation](../../../CONTEXT.md),
[Linked Release Booking](../../../CONTEXT.md),
[Cancellation](../../../CONTEXT.md),
[Referral Booking](../../../CONTEXT.md),
[Leadless Booking](../../../CONTEXT.md)

---

## 0. Authority

Read in this order. Stop and report contradictions; do not silently merge.

| Order | Authority | Wins on |
| --- | --- | --- |
| 1 | **This file** | Owner `/intakes` (and Overview waiting cards) copy, CTA labels, list-level **No Action**, hiding **Confirm Granot Cancellation** on that desk, public cancel option |
| 2 | [`booking-reconciliation.md`](../knowledge/granot-lifecycle/booking-reconciliation.md) | Case open/refresh, modes, revisions, command table |
| 3 | [`referral-review-release-first-specification.md`](../referral-review-release-first/referral-review-release-first-specification.md) | Referral server policy if `confirm-cancellation` is still called from another surface |
| 4 | [`cancelled-lead.md`](../knowledge/services/cancelled-lead.md) | Public **Cancellation** create; Referral / ordinary Leadless stay 409 |
| 5 | Workspace-root [`CONTEXT.md`](../../../CONTEXT.md) | Words. Do not invent synonyms |
| 6 | FINAL SPEC (via [`spec-hub.md`](../knowledge/granot-lifecycle/spec-hub.md)) | One **Booking** per **Job Number**; Granot never writes official records |

**Finalize Booking** and **Possibly Fix Booking** are Owner button
labels. They are not glossary terms and must not replace **Confirm
Granot Booking** or **Update Existing Booking** in server language.

**No-Op** in Owner speech is **No Action**. Processor
`already_current` is not an Owner button.

---

## 1. What this is / is not

**This is** presentation of the existing **Granot Booking
Reconciliation Case** on Owner `/intakes`.

**This is not** a new case kind, a new **Cancellation** intake, a
change to case open/refresh, a change to even **Binder**, optional
**Lead**, or **Connect Booking to Lead**.

**Release / Releas** is a **Granot Booking Action**. It is not a
Vantage **Cancellation**. The Owner cannot tell cancel from edit from
that action alone. Therefore Owner Intakes must not offer **Confirm
Granot Cancellation**.

---

## 2. State model

Two postures. The second has three ways out. Most review rows end in
**No Action**.

| Owner posture | Server `mode` | Latest **Granot Booking Action** | Owner work |
| --- | --- | --- | --- |
| **Finalize Booking** | `create_missing_booking` or `create_referral_booking` | **Booked**, or **Release** with no Vantage **Booking** | **Confirm Granot Booking** / create **Referral Booking**, or **No Action** inside the case |
| **Possibly Fix Booking** | `review_existing_booking` | **Booked** or **Release** | List-level **No Action** (common), or open and **Update Existing Booking**, or follow the public cancel option |

Do not add a third intake kind. **Referral Booking** uses the same
two postures.

Processor `already_current` (already-cancelled **Booking** +
**Release**) still opens no case. That silence stays.

---

## 3. Command surface on Owner Intakes

| Command | `/intakes` list card | `/intakes` workbench | Technical `/ingestion/granot/lifecycle` |
| --- | --- | --- | --- |
| **Confirm Granot Booking** | No. Card opens the case | Yes, create-missing | Unchanged |
| Create **Referral Booking** | No. Card opens the case | Yes, create-referral | Unchanged |
| **Update Existing Booking** | No. **Possibly Fix Booking** opens the case | Yes, review-existing | Unchanged |
| **No Action** | **Yes, review-existing only** | Yes, all three open modes | Unchanged |
| **Confirm Granot Cancellation** | **Never** | **Never** | May remain |
| Public **Cancellation** | Optional link when allowed (§5) | Same optional link | Not this spec |

`capabilities.confirm_cancellation` is ignored on `/intakes`. Do not
mount `CancellationCommandForm` from `BookingIntakeWorkbench` or
`BookingOwnerActions` when the surface is Owner Intakes.

The server `POST …/booking-cases/:id/confirm-cancellation` route is
not deleted. This file only removes it from the Owner desk.

---

## 4. CTA matrix

Ban **Finish booking** and **Finish the booking**.

| Posture | Latest action | Primary card control | Second card control | Quiet option |
| --- | --- | --- | --- | --- |
| No Vantage **Booking** | Booked or Release | **Finalize Booking** → `/intakes?case=` | none | **No Action** only after opening |
| **Booking** exists | Booked or Release | **No Action** | **Possibly Fix Booking** → `/intakes?case=` | **Cancel this booking** when §5 allows |

Overview **Waiting for you** booking rows use the same controls.
Finished rows have no **No Action**.

Job number still opens the case. **Open job history** / **Open Job
timeline** stay secondary.

---

## 5. Public cancel option

Show **Cancel this booking** on a review-existing card only when all
of these are true:

1. Case `state === "open"`
2. `mode === "review_existing_booking"`
3. `deterministic_booking.present === true`
4. Public **Cancellation** create would not 409 for this **Booking**
   (ordinary sourced **Booking**. Not **Referral Booking**. Not
   ordinary **Leadless Booking**.)

Href: `/cancellations/new?booked_lead={bookingId}`. Same form as
Bookings **Cancel this booking**. Do not rebuild it on Intakes.

The link is navigation only. It does **not** resolve the **Granot
Booking Reconciliation Case**. If the Owner files that
**Cancellation**, they still **No Action** the waiting card (or
**No Action** first if they already know the official record should
leave the queue). Do not auto-close the case from public cancel in
this spec.

**List projection:** `deterministic_booking` already has `present`
and `masked_ref`. Add `id` (the official **Booking** id) when
present so the list can link without opening the case. This is an
operational id, not Granot payload. Keep `assertProjectionSafe`.

If `id` is absent, hide the cancel option; do not guess from **Job
Number**.

**Referral / Leadless gap:** public cancel stays 409
([`cancelled-lead.md`](../knowledge/services/cancelled-lead.md)).
This spec does not unlock those cancels and does not put **Confirm
Granot Cancellation** back on Intakes to paper over the gap. Those
rows still get list **No Action** and **Possibly Fix Booking**.

---

## 6. List-level No Action

The Owner can see a review card whose official **Booking** is already
right and close it without opening the case.

**Shown when:**

- `state === "open"`
- `mode === "review_existing_booking"`
- `capabilities.commands` (or the list equivalent: booking commands
  enabled)
- Not shown on `create_missing_booking` or `create_referral_booking`.
  Closing those without a **Booking** is the dangerous path; keep
  the in-case **Review No Action** → **Resolve — No Action** confirm.

**Click:**

1. Lightweight confirm: *Close this intake? The official Booking
   will not change.*
2. `POST …/booking-cases/:id/no-action` with
   `expected_case_revision` from the list item.
3. `reason_code`: `booking_still_valid`. No reason picker. No reason
   text.
4. On success, the row leaves **Waiting for you**. Toast: *Intake
   closed. No official record changed.*
5. On `GRANOT_CASE_REVISION_CONFLICT` / 409: *This intake changed.
   Refresh and try again.* Keep the row. Do not retry blindly.

Do not hide an open case. Do not say dismiss. Do not auto-**No
Action**.

The in-case **No Action** form stays for create-missing,
create-referral, and anyone who opened a review case.

---

## 7. Copy deck

Use **Intake**, **Booking**, **Job Number**, **Binder**, **Lead**,
**Leadless Booking**, **No Action**. Do not say Finish Booking,
deal, webhook, or dismiss.

### Page chrome (`/intakes`)

- **Eyebrow:** Owner review
- **Title:** Intakes
- **Body:** Granot can mark a job **Booked** or **Release**. Vantage
  does not copy those numbers. If there is no **Booking** yet,
  finalize it here. If a **Booking** already exists, the official
  record is probably already right — choose **No Action**. Open the
  case only to change official numbers. **Release** is not a
  **Cancellation** by itself; cancel from Bookings when you mean to.

### A. Finalize — first **Booked**, no Vantage **Booking**

| Surface | Copy |
| --- | --- |
| Why it is here | Granot marked this job **Booked**. Vantage does not have a **Booking** yet. |
| What Vantage has | No official **Booking** yet |
| Next step | Enter **Binder**, up to two **Agents**, **Deposit**, and **Merchant**. A **High-Confidence Booking Lead** attaches on its own. You can save as a **Leadless Booking**. |
| Card CTA | **Finalize Booking** |
| How-to title | How to finalize this booking |
| How-to body | Granot marked this job **Booked**. That is not a Vantage **Booking**. Enter the official sale here. Granot estimate and payment stay as reference. |
| Form title | Official **Booking** details |
| Form submit | Review official details → **Create Booking** |

### B. Finalize — **Release**, still no **Booking**

Same CTA. Different why. There is nothing to cancel.

| Surface | Copy |
| --- | --- |
| Why it is here | Granot released this job. Vantage still has no **Booking**. |
| Next step | If the sale is real, finalize the **Booking**. If it should not be filed, open the case and choose **No Action**. |
| Card CTA | **Finalize Booking** |

### C. Review — **Booking** exists, latest **Booked** or **Release**

| Surface | Copy |
| --- | --- |
| Why it is here (Booked) | Granot sent another **Booked** on a job Vantage already booked. |
| Why it is here (Release) | Granot released this job. That may be an edit. It is not a Vantage **Cancellation** by itself. |
| What Vantage has | Vantage already has a **Booking** |
| Next step | If the official **Booking** is still right, choose **No Action**. Open the case only to change official numbers. |
| Primary card control | **No Action** |
| Second card control | **Possibly Fix Booking** |
| Quiet option | **Cancel this booking** (when §5 allows) |
| How-to title | How to review this booking |
| How-to body | This **Booking** is already official. A new **Booked** or **Release** does not change it by itself. Update Book Date, **Binder**, **Agents**, **Deposit**, or **Merchant** only if those official values are wrong. If nothing official changed, choose **No Action**. To cancel, use **Cancel this booking** — do not treat **Release** as the cancel. |
| Form submit | Review **Booking** update → **Update Booking** |

Show a compact official-**Booking**-now strip on the workbench
(Book Date, **Binder**, **Deposit**, **Merchant**, **Agents**,
**Lead** or **Leadless Booking**). Prefill from the live **Booking**,
never from Granot.

### D. Empty / error

| State | Copy |
| --- | --- |
| Empty waiting | No booking intakes waiting. When Granot records a **Booked** or **Release** job, it shows up here. |
| Empty finished | No finished booking intakes match this view. |
| List load error | Unable to load intakes. Try Refresh. |
| Commands flag off | Vantage is not ready to file **Bookings** from this screen. This **Intake** keeps waiting. |
| List **No Action** 409 | This intake changed. Refresh and try again. |

---

## 8. Already specified — do not copy

Processor routing, official-field blankness, even **Binder**,
**High-Confidence Booking Lead** attach, **Connect Booking to Lead**
on `/bookings`, evidence-only Granot numbers, `case_revision` vs
evidence append, Referral no-**Lead** on mint, AC-20 evidence refresh
while open.

---

## 9. Acceptance (Owner-visible)

1. First **Booked** with no **Booking**: list says Vantage has no
   **Booking**; button is **Finalize Booking**; no list **No Action**;
   no cancel link.
2. Existing **Booking** + later **Booked** or **Release**: **No
   Action** is on the card; second button is **Possibly Fix
   Booking**; no **Finish booking**; no **Confirm Granot
   Cancellation** / **Create Cancellation** form.
3. List **No Action** on a review card closes the case, writes no
   **Booking** / **Cancellation**, and removes the row from Waiting
   for you.
4. List **No Action** is absent on create-missing and
   create-referral cards.
5. **Cancel this booking** appears only when §5 allows, and opens
   `/cancellations/new?booked_lead=`. It does not close the intake.
6. **Release** + no **Booking** still says finalize, not cancel.
7. Overview waiting booking cards match the `/intakes` card
   controls for the same posture.

---

## 10. Explicitly forbidden

- Treating **Release** / **Releas** as a **Cancellation**.
- Mounting **Confirm Granot Cancellation** on Owner `/intakes`.
- Recreating a cancellation intake or a second cancel form.
- List-level **No Action** on create-missing / create-referral.
- Auto-**No Action**. Auto-close from public cancel (out of scope).
- Inventing glossary synonyms for **No Action**, **Update Existing
  Booking**, or **Confirm Granot Booking**.
- Putting **Connect Booking to Lead** on `/intakes`.
- Unlocking public Referral / Leadless cancel in this file.
