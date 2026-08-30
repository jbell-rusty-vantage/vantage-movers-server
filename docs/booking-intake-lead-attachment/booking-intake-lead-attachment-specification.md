---
type: Specification
title: Booking intake robustness — contact snapshots, optional Lead, Connect from Bookings
description: >-
  Implementation-ready contract for three Owner desk changes. Booking intake
  finds and shows Form submitted vs Granot contact. Confirm Granot Booking may
  omit a Lead and auto-attaches only a unique High-Confidence Booking Lead.
  The Owner connects a stored Lead to a Leadless Booking from the Bookings tab
  and that command writes EntityChange plus Sheet Sync.
tags:
  - form-lead
  - booking-intake
  - admin-dashboard
  - search
  - granot-lifecycle
  - bookings
status: proposed-final
stale_after: 2026-11-28
owners: [team:main-server, team:vantage-admin]
applies_to:
  - src/services/granotLifecycle/projections.ts
  - src/services/granotLifecycle/bookingConfirmation.ts
  - src/services/granotLifecycle/bookingOwnerCommands.ts
  - src/routes/granot-lifecycle-admin.routes.ts
  - src/validation/v1/granotLifecycle.validation.ts
  - ../vantage-admin/components/intakes/matched-lead-panel.tsx
  - ../vantage-admin/components/intakes/intake-copy.ts
  - ../vantage-admin/components/granot-lifecycle/lead-candidate-browser.tsx
  - ../vantage-admin/components/granot-lifecycle/booking-command-form.tsx
  - ../vantage-admin/components/operational/operational-resource-page.tsx
sources:
  - id: glossary
    resource: ../../CONTEXT.md
    title: Platform glossary
  - id: parent-display-search
    resource: ../form-lead-contact-snapshots-display-and-search-specification.md
    title: Form Lead contact snapshots — Admin display and any-known-contact search
  - id: snapshots-draft
    resource: ../granot-lead-lifecycle/booking-intake-form-lead-contact-snapshots-specification.md
    title: Absorbed draft — booking-intake snapshot search and display
  - id: owner-booking-intake
    resource: ../granot-lead-lifecycle/owner-booking-intake-and-lead-attachment-specification.md
    title: Owner booking intake — even Binder, optional Lead, Connect Booking to Lead
  - id: projections
    resource: ../knowledge/granot-lifecycle/projections.md
  - id: identity
    resource: ../knowledge/granot-lifecycle/identity.md
  - id: form-lead
    resource: ../knowledge/services/form-lead.md
  - id: bookings
    resource: ../knowledge/services/bookings.md
---

# Booking intake robustness — contact snapshots, optional Lead, Connect from Bookings

> **Contract maturity: implementation-ready.** Product rules in this file win
> for the three slices below. File citations are evidence; reverify line
> numbers at implementation. Agents work from
> [`README.md`](README.md) → [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md) → the
> matching issue. Do not start coding from the absorbed draft.

**Prepared:** 2026-08-28
**Repos:** `vantage-main-server`, `vantage-admin`
**Owner-facing labels:** Form submitted, Granot, Changed in Granot, No stored lead, Connect a lead
**Canonical fields and commands:** [Ingested Contact Snapshot](../../../CONTEXT.md), [Granot Contact Snapshot](../../../CONTEXT.md), [Form Submitted Contact](../../../CONTEXT.md), [High-Confidence Booking Lead](../../../CONTEXT.md), [Leadless Booking](../../../CONTEXT.md), [Confirm Granot Booking](../../../CONTEXT.md), [Connect Booking to Lead](../../../CONTEXT.md)

This file synthesizes three Owner requirements into one contract:

1. **Enhanced lead search and display** — booking-intake customer search uses any-known-contact (live + both snapshots) and makes the website-form → Granot-contact cycle obvious.
2. **Confirm without a required Lead** — the Owner may finish official details with no Lead selected. The server attaches a Lead only when a unique High-Confidence Booking Lead exists.
3. **Connect from the Bookings tab** — the Owner selects a Leadless Booking, searches Leads, connects one, and that command writes the Booking/Lead CRUD plus Sheet Sync.

---

## 0. Authority

Read in this order. Stop and report contradictions; do not silently merge.

| Order | Authority | Wins on |
| --- | --- | --- |
| 1 | **This file** | Snapshot search/display on intake and Connect search; optional-Lead Confirm UX; Bookings-tab Connect UX; issue sequencing |
| 2 | [Owner booking intake and lead attachment](../granot-lead-lifecycle/owner-booking-intake-and-lead-attachment-specification.md) | Confirm/Connect command shapes, eligibility, Sheet Sync resource/operation names, processor follow-through for a Granot Leadless Booking, even Binder (already shipped) |
| 3 | [Form Lead contact snapshots — Admin display and search](../form-lead-contact-snapshots-display-and-search-specification.md) | Snapshot write rules, shared path lists, Admin `/form-leads` (already shipped). Do not re-decide storage. |
| 4 | Glossary [`CONTEXT.md`](../../../CONTEXT.md) | Words |
| 5 | Current repository code | The seam each issue extends |

**Absorbed, do not implement from:** [booking-intake-form-lead-contact-snapshots-specification.md](../granot-lead-lifecycle/booking-intake-form-lead-contact-snapshots-specification.md). That draft is now a pointer.

**Where this file and the 2026-08-24 intake spec disagree:** this file wins on the **Connect surface**. Connect Booking to Lead is first-class on `/bookings`. Intakes Connect, Daily Completed Connect, and the Ingestion case redirect are **out of this pack**.

Even Binder (§5 of the 2026-08-24 spec) has already landed. Do not reopen it.

A case is still not a Booking. Official Booking writes stay on gated Owner commands.

---

## 1. Decision

Admin Form Leads already find a WordPress Form Lead by any known contact and show Form submitted beside Granot. Booking intake cannot. Confirm Granot Booking still requires a Lead. There is no Owner command that later attaches a stored Lead to a Granot Leadless Booking from the Bookings desk.

This work does three things:

1. **Search** Form Lead name, email, and phone as any-known-contact when the Owner types in **Find the right customer** (intake) or **Connect a lead** (Bookings). **Display** Form submitted and Granot as two labeled facts, with **Changed in Granot** when the later card differs, so the website-form → Granot-contact cycle is obvious.
2. Let the Owner submit Confirm Granot Booking **without attaching a Lead**. Create the official Booking and sync Master Booked. Attach a Lead automatically **only** when a unique High-Confidence Booking Lead exists. Anything else — medium confidence, ambiguity, no match — stays Leadless for later.
3. Add **Connect Booking to Lead** as a Bookings-tab flow: select a Leadless Booking → search eligible Leads (same contact story) → connect → EntityChange + Sheet Sync (`booking_chain` / `booked_lead.connect_lead`).

Do not replace the headline customer name with the Granot name. Do not change how Granot writes a Lead. Do not change scored `POST /api/v1/form-leads/search`. Do not change processor identity (`findFormLeadsByScopedContact` already ORs snapshots). Do not send a medium-confidence contact match through auto-attach. Do not use Booking Lead Reconciliation for this path.

---

## 2. How the stored facts work (do not re-decide)

The write path and Admin Form Leads display/search are already shipped. Read the parent spec §2 before coding. Do not add fields. Do not expose snapshots on PATCH.

**WordPress Form Lead.** Live name, phone, and email stay [Form Submitted Contact](../../../CONTEXT.md). Qualified Granot contact lives only on `granot_contact_snapshot`.

**Call Lead / Granot-born Form Lead.** Live fields already are the enrichment. Call identity does not query `granot_contact_snapshot`. This file does not add a Granot chip to Call Lead rows.

**Processor identity vs Owner desk search.** Identity already ORs current, ingested, and Granot phone/email inside one Source Company and Source Granularity. The Owner candidate browser does not. That gap is why a later Granot phone can attach automatically in some identity paths and still be unfindable when the Owner types it in **Find the right customer**.

---

## 3. Scope

### In

| Slice | Surface | Change |
| --- | --- | --- |
| 1 | `GET .../cases/:case_id/candidates` `q` | For Form Leads, OR live + ingested + Granot contact paths. Keep `job_no` and `ref_no`. |
| 1 | Candidate DTO | Carry Form submitted (live) and Granot snapshot facts when present. |
| 1 | Booking intake **Who this booking is for** and **Find the right customer** | Show both contacts, **Changed in Granot**, and a short cycle line. Headline stays Form submitted. |
| 1 | Technical Booking case page | Same components; one change covers `/intakes` and `/ingestion/granot/lifecycle/cases/:id`. |
| 2 | Confirm Granot Booking | `selected_lead` optional. Server auto-attaches a unique High-Confidence Booking Lead only. Otherwise Leadless + Master Booked. |
| 2 | Intake form + `useMatchedLead` / `pickBestCandidate` | Submit without a Lead. Do not pre-select medium confidence. |
| 2 | Processor + Update + Cancel | A Granot Leadless Booking stays official. Later Booked opens `review_existing_booking`. Update and Confirm Granot Cancellation work without a Lead. |
| 3 | `GET /api/v1/admin/bookings/:bookingId/connect-lead-candidates` | Eligible unbooked Lead search with the same any-known-contact paths and `known_contacts`. |
| 3 | `POST /api/v1/admin/bookings/:bookingId/connect-lead` | Connect Booking to Lead. EntityChange + `booking_chain`. |
| 3 | `/bookings` list + detail | Find Leadless rows, open the booking, search, connect. |

Owner-facing intake strings stay in `vantage-admin/components/intakes/intake-copy.ts`. Bookings-tab Connect strings live next to the Bookings operational UI (one small copy module; do not inline sentences in JSX).

### Out

| Surface | Why |
| --- | --- |
| Scored `POST /api/v1/form-leads/search` | Parent spec. Identity weights stay alone. |
| `src/services/granotLifecycle/identity.ts` | Already searches snapshots. |
| Granot write planner, sync, create | Already correct. |
| Admin `/form-leads` table, detail, browse, typeahead | Already shipped. |
| Extension `GET /api/v1/form-leads` desk browse | Already shipped. |
| Call Lead browse / Call candidate Granot chip | Live fields are the enrichment. |
| Cancellation intake | No customer-matching step. |
| `/bookings/reconciliation` | Employee Booking Lead Reconciliation. Different command. |
| Confirm / Update / Referral official field shape | Even Binder already shipped. Snapshots are not official Booking facts. |
| Auto-creating a Lead from a Granot Booked payload | Owner did not ask. |
| Auto-attaching medium-confidence `source_scoped_contact` | Explicitly forbidden. |
| Connect on `/intakes`, Daily Completed, or Ingestion case redirect | Later consumers. Same command if they appear; not this pack. |
| Uneven binder splits, more than two Agents | Already locked elsewhere. |
| CSV, new Mongo indexes, edit-form snapshot fields | Same as the parent spec. |

---

## 4. Slice 1 — Enhanced lead search and contact display

### 4.1 Shared search paths

Reuse the three named lists in `src/services/search/leadBrowseShared.ts`.
Do not copy the arrays into `projections.ts` or a Connect search module.

```ts
FORM_LEAD_CONTACT_NAME_PATHS
FORM_LEAD_CONTACT_EMAIL_PATHS
FORM_LEAD_CONTACT_PHONE_PATHS
```

`browseCandidateLeadViews` today:

```ts
common.$or = [
  { name: search },
  { first_name: search },
  { last_name: search },
  { phone_number: search },
  { email: search },
  { job_no: search },
  { ref_no: search },
];
```

Change for **Form Lead** queries: contact clauses become those three lists
(substring `/i`, same `escapeRegExp` style as today). Keep `job_no` and
`ref_no`. Call Lead queries stay on live name parts, email, phone, and
`job_no`. Do not import `normalizePhoneNumberForMatch`. Do not use scored
digit-flex.

When `lead_model` is omitted, Form rows use the expanded paths and Call rows
do not. Do not add a `contact_changed_in_granot` query key.

Ranked identity pins (no `q`) stay as they are. An explicit `q` still owns
the whole page and pins nothing (`listGranotLifecycleCaseCandidates`).
Duplicate and Bad Form Leads stay excluded.

Connect-candidate search (slice 3) uses the same Form path lists plus Call
live fields. It adds eligibility filters. It does not use case Source Scope
as a hard filter — the Owner is attaching after the fact — but the Connect
command still requires the override reason when the Lead is outside the
Booking's Source Scope / source assignment.

### 4.2 Candidate DTO

`CANDIDATE_LEAD_PROJECTION` today omits both snapshots. Select them on Form
Lead reads (browse and ranked load). Call Lead projection does not need
`granot_contact_snapshot`.

Keep `contact` as the live headline card so existing `candidateLeadName` and
selection labels stay Form submitted on WordPress:

```ts
contact: { name, phone_number, email }  // live fields
```

Add a sibling the UI can render without reading raw snapshot keys:

```ts
known_contacts: {
  form_submitted: { name?, first_name?, last_name?, phone_number?, email? };
  granot?: {
    name?, first_name?, last_name?, phone_number?, email?;
    differs_from_ingested: boolean;
    captured_at?: string; // ISO date when present
  };
}
```

`form_submitted` is live fields, not `ingested_contact_snapshot`. If an Owner
later PATCHed live contact, the headline and this card stay consistent.

`granot` is present only when `granot_contact_snapshot` exists. Use the stored
`differs_from_ingested` flag. Do not recompute equality. Do not send
`observation_id` or `evidence_status`.

`customer_label` stays built from live contact. Do not label a row with the
Granot name.

Referral cases still return `{ items: [], next_cursor: null }`.

Connect-candidate items reuse this `known_contacts` shape so intake and
Bookings cannot tell two stories.

### 4.3 Owner display — make the cycle obvious

Owner-facing words only. Never print `ingested_contact_snapshot`,
`granot_contact_snapshot`, `differs_from_ingested`, `wordpress_form`, or
`legacy_baseline`.

Allowed: `Form submitted`, `Granot`, `Changed in Granot`, `Granot contact`,
and the cycle line from copy.

Cycle line (edit in `intake-copy.ts` on intake; Bookings copy module on
`/bookings`):

> Form submitted is what they typed on the website. Granot is the later card
> from the CRM when we have one.

When `known_contacts.granot.differs_from_ingested === true`, add one more
sentence so the cycle is unmistakable:

> Granot later changed this contact.

Do not invent a third “ingested vs live” card. Do not draw a technical
pipeline diagram. The two labeled cards plus the chip plus those two
sentences are the cycle.

#### 4.3.1 Who this booking is for

Headline name and the reach line stay Form submitted (`contact`).

When `known_contacts.granot` exists, show the same chip as Admin Form Leads:

| Snapshot | Chip |
| --- | --- |
| missing | omit the chip (do not show `—` on this hero) |
| present and `differs_from_ingested !== true` | muted **Granot** |
| present and `differs_from_ingested === true` | emphasis **Changed in Granot** |

Under the cycle line, two cards (`sm:grid-cols-2`):

**Form submitted** (always, live fields)

| Label | Source |
| --- | --- |
| Name | `known_contacts.form_submitted.name` / live `contact.name` |
| Phone | live phone |
| Email | live email |

**Granot** (only when `known_contacts.granot` exists)

| Label | Source |
| --- | --- |
| Name | Granot name |
| Phone | Granot phone |
| Email | Granot email |
| Recorded | `captured_at` as a date |

If `differs_from_ingested === true`, put **Changed in Granot** on the Granot
card. Empty leaves are `—`.

The folded **Everything on this customer's lead** block must not go back to
a single Name/Phone/Email that hides the Granot card. Reuse the same two
cards (or the shared helper) so the Owner does not see two different stories.

Granot-born Form Leads may show matching cards and a muted **Granot** chip.
That is correct. Do not hide the Granot card because origin is not WordPress.

Call Lead matches: no Granot card, no chip. Live contact is enough.

#### 4.3.2 Find the right customer

Search placeholder / label may say the Owner can search the website contact
or the later Granot contact. Keep job number and reference in the same box.

Each selectable row:

- Title stays Form submitted name.
- Chip when a Granot snapshot exists (same rules as §4.3.1).
- The two cards, compact if needed, so a Granot-only search hit is obviously
  the same person as the Form submitted name.

Do not put `observation_id` in a tooltip. Optional tooltip: Granot name and
phone.

#### 4.3.3 Shared helper

Prefer one read of the snapshot for chip + cards. Admin already has
`vantage-admin/components/operational/form-lead-contacts.tsx`. Reuse or
extract a thin shared helper so `/form-leads`, intake, and Bookings Connect
cannot drift. Do not fork a third copy of the chip rules. Intake sentences
stay in `intake-copy.ts`.

---

## 5. Slice 2 — Confirm without a required Lead

Command contract, eligibility, persist outcomes, and Sheet Sync names are
locked in the 2026-08-24 spec §§6, 8, and 10. This section restates them so
this file is implementable without hunting, and locks the intake UX.

### 5.1 Submit contract

`POST /api/v1/admin/granot-lifecycle/booking-cases/:id/confirm-booking`

Unchanged: Owner actor, `Idempotency-Key`, `expected_case_revision`,
booking-command gate, first-evidence causal chain, blank official fields
from the Owner.

Changed: `selected_lead` is optional.

```ts
{
  expected_case_revision: number;
  selected_lead?: { lead_model: "FormLead" | "CallLead"; lead_id: string };
  out_of_scope_override_reason?: string;  // required only when selected_lead is out of Source Scope
  official_booking_details: { /* already shipped even-Binder shape */ };
}
```

### 5.2 Attachment resolution (server, inside the command transaction)

Evaluate in this order. Do not attach in the Admin client.

| Condition | Result |
| --- | --- |
| Owner sent `selected_lead` | Validate eligibility and attach that Lead. Out-of-scope still requires the override reason. |
| No `selected_lead`, and the case has exactly one High-Confidence Booking Lead | Attach that Lead. |
| No `selected_lead`, and there is no unique High-Confidence Booking Lead | Create a Leadless Booking. Do not open a Booking Lead Reconciliation Case. |

**High-Confidence Booking Lead** means the current suggestion/candidate
confidence is `high` and the match method is one of:

- `granot_record_link`
- `form_ref_no_exact`
- `form_mongo_id_compatibility`
- `form_job_no_exact`
- `call_job_no_exact`
- Booking-owner evidence already classified as high

`source_scoped_contact` is **medium**. It may be shown and Owner-selected.
It is never auto-attached.

Unique means exactly one eligible high-confidence candidate (or the
persisted suggestion when it is high and unambiguous). Zero, two, or more
high-confidence candidates → Leadless.

Eligibility for an attached Lead is unchanged: not Duplicate, not Bad, not
cancelled, not already booked. Claim remains compare-and-swap. A lost claim
fails the command with the current conflict envelope; it does **not**
silently fall through to Leadless on that same attempt.

An explicit Owner Lead selection always wins. It may be high or medium
confidence, in or out of Source Scope (out-of-scope still needs the 10–500
character reason).

### 5.3 Persist outcomes

**Attached (Owner-selected or high-confidence auto):**

- Same official Booking write as today, `is_leadless_booking: false`
- Mirror booked / deposit thresholds onto the Lead
- Active Granot Record Link to that Lead when the case has Source Scope
- Case resolves `booking_created` (or `already_satisfied` on exact replay)
- Sheet Sync: `booking_chain` / `booked_lead.create` — Master Booked **and** the source Lead row (Master Leads)

**Leadless:**

- Official Booking with `is_leadless_booking: true`, no `lead_ref` / `lead_model`
- Customer from observed/submitted contact already on the case — display and customer upsert only; never as official Binder/Deposit/Agents
- Booking-only Record Link is allowed (job identity without a Lead), same posture as Referral’s booking-only link
- Case resolves `booking_created`
- Sheet Sync: `booked_lead` / `granot_booking.create_leadless` (or reuse `leadless_booking.create`) — **Master Booked only**
- Response tells the Owner the Booking was created without a Lead and can be connected later from Bookings

Owner-readable success copy, not an internal mode name:

> Booking saved to Master Booked. No stored lead was attached. You can connect a lead later from Bookings.

### 5.4 Intake form behavior

Lead section title stays **Who this booking is for**. It is optional.

- If a unique High-Confidence Booking Lead exists, pre-fill it and say it
  will be attached when he submits.
- If only medium-confidence or no match exists, show an empty state:
  “No strong match. You can search, or save the booking now and connect a
  lead later from Bookings.”
- Submit is enabled without a Lead once official details are valid.
- Lead search stays beside the form for the uncommon “wrong customer / no
  auto match” case.
- Review must state either the attached Lead (name, phone, email, job,
  Lead ID) or **No lead — Master Booked only**.

`pickBestCandidate` / `useMatchedLead` must **not** pre-select a medium
confidence row. That is the current form’s most important foot-gun.
`pickBestCandidate` returns a high-confidence item only (prefer
`suggested` when that suggestion is itself high). Medium rows remain
visible in search; they attach only when the Owner clicks one.

`BookingCommandForm` must stop pushing “Choose the customer this booking
belongs to before you file it.” Official details alone enable Review.

Update `intakeNextStep` / `intakeCaseHowToFinish` so they do not say
“choose a lead” as if it were required.

### 5.5 Processor and later evidence

Required. Without these a legal Leadless Booking becomes a dead end.

| Later fact | Required behavior |
| --- | --- |
| Actual Booked, one active Granot Leadless Booking | Open/refresh `review_existing_booking`. Do **not** delegate to Booking Lead Reconciliation. Do **not** fail closed. |
| Actual Booked, one active Referral Booking | Unchanged: review-existing, no Lead. |
| Employee pending Leadless Booking (`booking_origin=employee_booking`) | Unchanged: keep delegating to the employee case. |
| Update Existing Booking on a Granot Leadless Booking | Allowed. Official fields only. No Lead identity check. Sheet job is `booked_lead` update (Master Booked), not `booking_chain`. |
| Confirm Granot Cancellation on a Granot Leadless Booking | Allowed, same as Referral: no Lead mirror. Cancellation Chain / master cancelled projection only. |
| Connect Booking to Lead after review-existing is open | Allowed. Connecting does not resolve the review case by itself. |

`updateExistingBooking` must drop the current `is_leadless_booking` hard
reject for Granot official bookings.

---

## 6. Slice 3 — Connect Booking to Lead from the Bookings tab

### 6.1 What it is

A completed Leadless Booking already exists and is already on Master Booked.
The Owner later points it at one stored Lead that is not part of a Booking.

This is **not**:

- Confirm Granot Booking (that creates the Booking)
- Booking Lead Reconciliation (employee pending cases)
- Creating a Lead
- Creating a second Booking
- A new `/bookings/reconciliation` queue

### 6.2 Why the Bookings tab (UX decision)

The Owner already works `/bookings` as **list → select a row → read the
official booking**. Connect belongs on that same desk.

Rejected alternatives:

| Alternative | Why not |
| --- | --- |
| Table-only modal over the list | The Owner loses job, customer, binder, and book date while searching. He selected a booking; that booking must stay on screen. |
| New “leadless queue” or reuse `/bookings/reconciliation` | That page is Employee Booking Lead Reconciliation (`attach_existing`). Mixing the two commands will attach the wrong story and the wrong eligibility. |
| Force a return to `/intakes` | The Booking is already official. Intakes is for finishing a case, not for a later identity fix. |
| Typeahead that labels rows with the Granot name | Breaks the Form submitted headline rule and hides the cycle. |

Locked flow:

1. **Find** — `/bookings` already has a Leadless filter. Add a visible
   **No stored lead** chip on leadless, non-referral rows so the Owner can
   see them without opening every row.
2. **Select** — clicking the row opens the existing booking detail. Official
   facts stay where they are.
3. **Stored lead** — a first-class section after Summary:
   - Attached Lead: Form submitted vs Granot cards (same helper as intake).
   - Leadless and not Referral: empty state “This booking has no stored lead”
     plus **Connect a lead**.
   - Referral: no Connect. Referral stays no-Lead by definition.
   - Cancelled Leadless: no Connect.
4. **Search in place** — the search panel opens on the same detail. The
   booking job number, customer, and official facts stay visible above it.
   Search is any-known-contact. Rows show Form submitted + Granot +
   **Changed in Granot**.
5. **Review and connect** — selecting a Lead shows a short review
   (booking identity + lead identity + the two contact cards + override
   reason when required) and **Connect lead**.
6. **Afterward** — the section switches to the attached Lead. Copy says
   Master Leads and Master Booked will update. A 200/201 does not mean the
   sheet row is already visible.

Optional deep link: `/bookings?id=:bookingId&connect=1` (or the operational
page’s existing detail-open query) may open the same section with search
already expanded. Do not add a second route.

Do not put Connect on the table as the only path. A row action that opens
the same detail with search expanded is allowed as a shortcut.

### 6.3 Routes

```text
GET  /api/v1/admin/bookings/:bookingId/connect-lead-candidates
POST /api/v1/admin/bookings/:bookingId/connect-lead
```

Owner-only (`requireRegistryOwnerActor`). POST takes one strict
`Idempotency-Key`. Mount next to the existing admin booking / Granot
lifecycle admin router (same `/api/v1` guard). Admin BFF
`canProxyVantagePath` must allow both paths for Owner; deny Admin role on
the mutation and on the candidate GET (Owner-only, same as intake
candidates).

Command name: `connectBookingToLead`.

```ts
// POST body
{
  expected_booking_revision: number;
  selected_lead: { lead_model: "FormLead" | "CallLead"; lead_id: string };
  out_of_scope_override_reason?: string; // 10–500 chars when the Lead is outside the Booking's Source Scope / source assignment
}
```

GET query: `q?`, `lead_model?`, `limit?`, `cursor?`. Empty `q` may return
an empty page or a short unbooked list — prefer empty-until-typed so the
Owner is searching, not browsing the whole book. Duplicate, Bad, cancelled,
already-booked, and `created_on_unmatched` Call Leads never appear.

### 6.4 Eligibility

**Booking** must be:

- present, not cancelled
- Leadless (`is_leadless_booking === true` or missing `lead_ref`)
- **not** a Referral Booking (Referral stays no-Lead by definition)

**Lead** must be:

- present
- not booked, not cancelled, not Duplicate, not Bad
- Form Lead or Call Lead
- not a Call Lead created as `created_on_unmatched`

If the Booking already has this exact Lead, return `already_satisfied` (200)
with no new Change. If it has a **different** Lead, fail closed
(`IDENTITY_CONFLICT`). If another Booking already owns the Lead, fail closed.

Source-scope / source-assignment mismatch requires the override reason.
Same-source attach does not.

### 6.5 Transaction

One command transaction:

1. CAS the Booking revision.
2. Claim the Lead (`claimAvailableLeadForBooking` or the Granot equivalent).
3. Set `lead_ref`, `lead_model`, `is_leadless_booking: false`. Do not rewrite official Binder, Agents, Deposit, Merchant, or book date.
4. Mirror booked + deposit thresholds onto the Lead. Do not rewrite CPL (`preserveExistingCpl`).
5. Correct or create the Granot Record Link to the selected Lead when a job link exists; keep the previous association as evidence if an Owner override changes it.
6. Persist `EntityChange` rows for Booking and Lead.
7. Queue **one** coalescible `booking_chain` intent — Master Leads sync plus a Master Booked identity refresh so the booked row is no longer leadless.

Post-commit: `finalizeSheetSync`. Exact replay returns the durable result.

### 6.6 Bookings list chip

Keep existing columns. Add one column after Customer (or after Phone):

```ts
{ key: "stored_lead", label: "Stored lead", path: "lead_ref" }
```

Not sortable.

| Booking | Chip |
| --- | --- |
| Referral | omit or muted **Referral** — never **Connect** |
| Leadless, not cancelled | emphasis **No stored lead** |
| Has `lead_ref` | muted dash or omit — do not print the Lead ID in the table |
| Cancelled leadless | muted **No stored lead** — Connect stays off in detail |

The existing **Leadless** filter stays. Do not add a second filter key.

Owner-facing words only. Never print `is_leadless_booking` or `lead_ref` in
the table.

---

## 7. Sheet Sync

| Command outcome | Resource | Operation | Sheets |
| --- | --- | --- | --- |
| Confirm, Lead attached | `booking_chain` | `booked_lead.create` | Master Booked + source Lead (Master Leads) |
| Confirm, Leadless | `booked_lead` | `granot_booking.create_leadless` | Master Booked only |
| Update, Lead attached | `booking_chain` | `booked_lead.update` | Master Booked + source Lead |
| Update, Leadless or Referral | `booked_lead` | `booked_lead.update` / `referral_booking.update` | Master Booked only |
| Connect Booking to Lead | `booking_chain` | `booked_lead.connect_lead` | Master Leads + Master Booked identity refresh |

Mongo remains the system of record. A 201/200 does not mean the sheet row
is already visible. Owner copy must never say “synced to the sheet” as a
done fact.

---

## 8. Admin authorization and flags

- No new feature flag. Booking-command and Booking-case flags already gate Confirm / Update / Referral / No Action.
- Connect Booking to Lead uses the same Booking-command gate. Flag-off is **422** `POLICY_BLOCKED`.
- Add `GET/POST /api/v1/admin/bookings/:id/connect-lead*` to `canProxyVantagePath` as Owner-only.
- Candidate GET is Owner-only (same posture as intake candidates).
- Non-owners keep operational PATCH on `/bookings` as today. They do not get Connect.

Checked-in Granot effect flags stay false until a separately authorized enablement.

---

## 9. Tests the agent must add

### 9.1 Slice 1 — `listGranotLifecycleCaseCandidates`

Assert the **filter** and the **DTO**, not helper internals.

- Form `q` for a Granot-only name includes `granot_contact_snapshot.name`.
- Form `q` for an ingested-only email includes `ingested_contact_snapshot.email`.
- Form `q` for a typed phone substring hits live and snapshot phone paths.
  Do not assert a digit-flex regex.
- Form `q` still hits `job_no` and `ref_no`.
- Call `q` still omits `granot_contact_snapshot`.
- Empty `q` still pins ranked identity matches first.
- Explicit `q` still pins nothing.
- Form item with a snapshot returns `known_contacts.granot` and live
  `contact.name` stays Form submitted when the Granot name differs.
- Form item without a snapshot omits `known_contacts.granot`.
- DTO omits `observation_id` on `known_contacts`.
- Duplicate and Bad Form Leads still excluded.

Do **not** add scored `searchFormLeads` cases.

Admin UI — render `MatchedLeadPanel` and `LeadCandidateResults` with fixtures:

- No snapshot → Form submitted only, no Granot chip on the hero.
- Snapshot `differs_from_ingested: false` → chip **Granot**, both cards, cycle line.
- Snapshot `differs_from_ingested: true` → **Changed in Granot**, “Granot later changed this contact.”, headline stays Form submitted.
- Call Lead fixture → no Granot card.
- Owner strings come from `intake-copy.ts`. Markup never contains the forbidden field names.

### 9.2 Slice 2 — Confirm optional Lead

- Confirm optional `selected_lead` Zod (omit allowed; unknown keys still reject).
- High-confidence unique auto-attach; medium-only → leadless; ambiguous high → leadless.
- Owner-selected medium attach; out-of-scope without reason rejected.
- Lost claim does not fall through to Leadless.
- Leadless confirm sheet intent is Master Booked only.
- Attached confirm sheet intent is `booking_chain`.
- Processor: Booked + existing Granot Leadless Booking → `review_existing_booking`, not employee delegate.
- Update and cancel on Granot Leadless Booking.
- Admin: submit without a Lead is allowed; medium-confidence suggestion is not pre-selected; review states attached Lead or **No lead — Master Booked only**.

### 9.3 Slice 3 — Connect

- Connect happy path, already_satisfied replay, lead-already-booked, referral reject, cancelled reject, stale booking revision.
- Candidates `q` hits snapshot paths; ineligible Leads omitted.
- Admin: Leadless detail shows Connect; Referral and cancelled do not; search rows show Form submitted vs Granot; success invalidates bookings queries.

### 9.4 Browser (required for Owner UI)

Sign in with `ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD` from
`vantage-admin/.env`. Do not paste those values into chat, commits, or this
file. Local Admin is on **http://localhost:3001** — see [`LOCAL-ADMIN.md`](LOCAL-ADMIN.md).

**Intake**

1. Open a Booking intake that has a WordPress Form Lead with a Granot snapshot. Confirm the hero shows Form submitted name, both cards, and the cycle line.
2. Open **Find the right customer**. Search a Granot-only name or phone that differs from the form. The row appears. Headline is still Form submitted. **Changed in Granot** is visible when the flag is true.
3. Search the Form submitted phone. The same row appears.
4. Confirm a Call Lead row has no Granot chip.
5. On an intake with only a medium match: no customer is pre-selected; Review is enabled once official details are valid; submit creates a Leadless Booking.
6. On an intake with a unique high-confidence match: that customer is pre-filled and submit attaches it without the Owner re-picking.

**Bookings**

7. Filter Leadless. Open a leadless non-referral booking. Confirm **No stored lead** and **Connect a lead**.
8. Search a Granot-only contact. Select. Connect. Detail now shows the attached Lead with both cards. Copy does not claim the sheet already updated.
9. Confirm a Referral booking has no Connect.
10. Confirm `/form-leads` behavior from the parent spec is unchanged.
11. Confirm `/bookings/reconciliation` is unchanged.

---

## 10. Knowledge updates after ship

Do not rewrite these as current until the matching issue is merged.

| Doc | What to add |
| --- | --- |
| `docs/knowledge/granot-lifecycle/projections.md` | Candidate `q` for Form Leads also hits ingested and Granot snapshot contact paths. DTO carries `known_contacts`. Labels stay live. |
| `docs/knowledge/granot-lifecycle/owner-booking-intake.md` | Pointer to this pack. Optional Lead and Connect from Bookings. |
| `docs/knowledge/services/bookings.md` | Connect Booking to Lead command. Leadless Granot Booking is official. |
| `vantage-admin/CONTEXT.md` | This pack is the authority; snapshots-on-intake is no longer “do not implement.” |
| `vantage-admin/.cursor/rules/project-organization.mdc` | Bookings detail owns Connect; intake lead is optional. |

`docs/knowledge/services/form-lead-search.md` stays “search ignores snapshots.”
The parent Form Leads Admin spec stays the authority for `/form-leads`.

---

## 11. Implementation order

| Issue | Slice | Repos |
| --- | --- | --- |
| [BILA-01](issues/BILA-01.md) | Search + display of Form submitted vs Granot on intake (and the shared helper Connect will reuse) | both |
| [BILA-02](issues/BILA-02.md) | Optional Lead on Confirm, high-confidence auto-attach, Leadless follow-through | both |
| [BILA-03](issues/BILA-03.md) | Connect Booking to Lead command + Bookings-tab flow | both |

Do not start BILA-02 until BILA-01’s DTO and cards exist — optional-Lead
review must be able to show the same contact story. Do not start BILA-03
until BILA-01’s helper exists; the Connect command itself may be written
on the server in the same session as BILA-02 if BILA-02 finishes early,
but the Bookings UI waits for the helper.

---

## 12. Done when

1. Typing a Granot-only Form Lead name, email, or phone in booking-intake customer search returns that WordPress Form Lead. Form submitted values, job number, and reference still work. The matched customer and each Form search row show Form submitted and Granot as two labeled facts when a snapshot exists, and **Changed in Granot** when `differs_from_ingested` is true. The headline name is still Form submitted. The cycle line is visible.
2. Confirm without `selected_lead` and with exactly one High-Confidence Booking Lead attaches that Lead and enqueues `booking_chain`. Confirm without a unique high-confidence Lead creates a Leadless Booking and enqueues Master Booked only. Medium `source_scoped_contact` never auto-attaches. An explicit Owner selection still wins. The Admin form can submit with no Lead selected once official details are valid. Medium is not pre-selected.
3. From `/bookings`, the Owner can filter or spot a Leadless Booking, open it, search any-known-contact, connect one eligible Lead, and that command writes Booking + Lead EntityChange and queues `booking_chain`. Referral and cancelled bookings cannot connect. `/bookings/reconciliation` is untouched.
4. Call Lead rows, cancellation intake, scored search, identity, and Granot writes are unchanged. Snapshots remain non-editable.

---

## 13. Current-code map (evidence, reverify)

| Piece | Path |
| --- | --- |
| Candidate list + `q` | `src/services/granotLifecycle/projections.ts` `listGranotLifecycleCaseCandidates`, `browseCandidateLeadViews` |
| Candidate projection (no snapshots today) | `CANDIDATE_LEAD_PROJECTION` in the same file |
| Confirm requires Lead | `src/validation/v1/granotLifecycle.validation.ts` `granotLifecycleConfirmBookingCommandSchema`; `src/services/granotLifecycle/bookingConfirmation.ts` |
| Update rejects leadless | `src/services/granotLifecycle/bookingOwnerCommands.ts` |
| Shared path lists | `src/services/search/leadBrowseShared.ts` |
| Identity already ORs snapshots | `src/services/granotLifecycle/identity.ts` |
| Intake story + copy | `vantage-admin/components/intakes/intake-copy.ts` |
| Matched customer | `vantage-admin/components/intakes/matched-lead-panel.tsx` |
| Search + pre-select (currently includes medium) | `vantage-admin/components/granot-lifecycle/lead-candidate-browser.tsx` `pickBestCandidate` |
| Confirm form blocks empty Lead | `vantage-admin/components/granot-lifecycle/booking-command-form.tsx` |
| Admin Form Leads chip/cards (shipped) | `vantage-admin/components/operational/form-lead-contacts.tsx` |
| Bookings list/detail | `vantage-admin/components/operational/operational-resource-page.tsx` resource `bookings` |
| Bookings page | `vantage-admin/app/(dashboard)/bookings/page.tsx` |
| Candidate client type | `vantage-admin/lib/api/granotLifecycle.ts` `GranotLifecycleCandidateItem` |
| Proxy ACL | `vantage-admin/server/auth/authorization.ts` `canProxyVantagePath` |
