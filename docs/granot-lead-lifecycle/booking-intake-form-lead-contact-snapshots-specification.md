---
type: Specification
title: Booking intake — Form Lead contact snapshots in lead search and selection
description: Draft. Let the Owner find a WordPress Form Lead by any known contact when choosing who a booking is for, and show Form submitted vs Granot so the two cards are understandable. This file is not fully developed.
tags:
  - form-lead
  - booking-intake
  - admin-dashboard
  - search
  - granot-lifecycle
status: draft
stale_after: 2026-11-28
owners: [team:main-server, team:vantage-admin]
applies_to:
  - src/services/granotLifecycle/projections.ts
  - src/routes/granot-lifecycle-admin.routes.ts
  - ../vantage-admin/components/granot-lifecycle/lead-candidate-browser.tsx
  - ../vantage-admin/components/granot-lifecycle/candidate-lead-facts.tsx
  - ../vantage-admin/components/intakes/matched-lead-panel.tsx
  - ../vantage-admin/components/intakes/intake-copy.ts
sources:
  - id: glossary
    resource: ../../CONTEXT.md
    title: Platform glossary
  - id: parent-display-search
    resource: ../form-lead-contact-snapshots-display-and-search-specification.md
    title: Form Lead contact snapshots — Admin display and any-known-contact search
  - id: owner-booking-intake
    resource: ./owner-booking-intake-and-lead-attachment-specification.md
  - id: projections
    resource: ../knowledge/granot-lifecycle/projections.md
  - id: identity
    resource: ../knowledge/granot-lifecycle/identity.md
  - id: form-lead
    resource: ../knowledge/services/form-lead.md
---

# Booking intake — Form Lead contact snapshots in lead search and selection

> **This specification is not fully developed.** The Owner will add at least
> one more requirement to this file. Do not treat it as implementation-ready.
> Do not start coding from this draft. Product rules already written below
> are the intended direction for the booking-intake search and display slice;
> they can still change until this banner is removed and the status becomes
> `proposed-final`.
>
> File citations are evidence; reverify line numbers at implementation.
> This file does not change Granot write rules, scored Form Lead Search,
> processor identity, or Call Lead display.

**Prepared:** 2026-08-28
**Repos:** `vantage-main-server`, `vantage-admin`
**Owner-facing labels:** Form submitted, Granot, Changed in Granot
**Canonical fields:** [Ingested Contact Snapshot](../../CONTEXT.md), [Granot Contact Snapshot](../../CONTEXT.md), [Form Submitted Contact](../../CONTEXT.md)
**Parent contract (shipped):** [Form Lead contact snapshots — Admin display and any-known-contact search](../form-lead-contact-snapshots-display-and-search-specification.md)

---

## 0. Completeness

| Area | State |
| --- | --- |
| Problem and surfaces in scope for booking-intake lead search / selection | Drafted below. Still reviewable. |
| Shared search path lists (reuse, do not copy) | Drafted below. |
| Owner-facing display of Form submitted vs Granot on the matched customer and on search rows | Drafted below. |
| Tests and browser checks for that slice | Drafted below. |
| Further Owner requirements | **Not written.** Reserved in §11. |

Until §11 is empty or explicitly deferred, agents must not implement this file.

---

## 1. Decision

Admin Form Leads can already find a WordPress Form Lead by any known contact
and show Form submitted beside Granot. Booking intake cannot.

The Owner finishes a booking at `/intakes` by choosing **who this booking is
for**. That search is `GET /api/v1/admin/granot-lifecycle/cases/:case_id/candidates`
(`listGranotLifecycleCaseCandidates` → `browseCandidateLeadViews`). Today `q`
matches only live `name` / `first_name` / `last_name` / `email` / `phone_number`
plus `job_no` / `ref_no`. The candidate card prints only live contact. A
Granot-only name or phone that already works on `/form-leads` misses the same
customer here.

This work (once this file is complete) does two things on booking intake:

1. **Search** Form Lead name, email, and phone as any-known-contact — live
   fields plus [Ingested Contact Snapshot](../../CONTEXT.md) plus
   [Granot Contact Snapshot](../../CONTEXT.md) — when the Owner types in
   **Find the right customer**.
2. **Display** Form submitted and Granot as two labeled facts on the matched
   customer and on each selectable search row, with a short explanation of
   what the two cards mean.

Do not replace the headline customer name with the Granot name. Do not change
how Granot writes a Lead. Do not change scored `POST /api/v1/form-leads/search`.
Do not change processor identity (`findFormLeadsByScopedContact` already ORs
snapshots).

---

## 2. How the stored facts work (do not re-decide)

The write path and Admin Form Leads display/search are already shipped. Read
the parent spec §2 before coding. Do not add fields. Do not expose snapshots
on PATCH.

**WordPress Form Lead.** Live name, phone, and email stay
[Form Submitted Contact](../../CONTEXT.md). Qualified Granot contact lives
only on `granot_contact_snapshot`.

**Call Lead / Granot-born Form Lead.** Live fields already are the enrichment.
Call identity does not query `granot_contact_snapshot`. This file does not
add a Granot chip to Call Lead candidate rows.

**Processor identity vs Owner desk search.** Identity already ORs current,
ingested, and Granot phone/email inside one Source Company and Source
Granularity. The Owner candidate browser does not. That gap is why a later
Granot phone can attach automatically in some identity paths and still be
unfindable when the Owner types it in **Find the right customer**.

---

## 3. Scope

### In (this slice, once the spec is complete)

| Surface | Change |
| --- | --- |
| `GET .../cases/:case_id/candidates` `q` | For Form Leads, OR live + ingested + Granot contact paths. Keep `job_no` and `ref_no`. |
| Candidate DTO | Carry Form submitted (live) and Granot snapshot facts when present. |
| Booking intake **Who this booking is for** (`MatchedLeadPanel`) | Show both contacts and a short meaning line. Headline stays Form submitted. |
| Booking intake **Find the right customer** (`LeadCandidateBrowser` / `LeadCandidateResults`) | Same search and same two labeled facts on each row. |
| Technical Booking case page | Same components; one change covers `/intakes` and `/ingestion/granot/lifecycle/cases/:id`. |
| Owner strings | Only in `vantage-admin/components/intakes/intake-copy.ts`. |

### Out

| Surface | Why |
| --- | --- |
| Further Owner requirements | Not written yet. See §11. |
| Scored `POST /api/v1/form-leads/search` | Parent spec. Identity weights and ambiguity stay alone. |
| `src/services/granotLifecycle/identity.ts` | Already searches snapshots. Do not change. |
| Granot write planner, sync, create | Already correct. |
| Admin `/form-leads` table, detail, browse, typeahead | Already shipped in the parent spec. |
| Extension `GET /api/v1/form-leads` desk browse | Already shipped. Do not add a Granot chip to extension Search cards. |
| Call Lead candidate rows / Call browse | Live fields are the enrichment. |
| Cancellation intake | No customer-matching step. |
| Booking-lead reconciliation browser (`/bookings/reconciliation`) | Different API. Not this pass unless §11 adds it. |
| Confirm / Update / Referral official fields | Snapshots are not official Booking facts. |
| CSV, new Mongo indexes, edit form, move snapshots | Same as the parent spec. |

---

## 4. Shared search paths

Reuse the three named lists in `src/services/search/leadBrowseShared.ts`.
Do not copy the arrays into `projections.ts`.

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

---

## 5. Candidate DTO

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

---

## 6. Owner display

Owner-facing words only. Never print `ingested_contact_snapshot`,
`granot_contact_snapshot`, `differs_from_ingested`, `wordpress_form`, or
`legacy_baseline`.

Allowed: `Form submitted`, `Granot`, `Changed in Granot`, `Granot contact`,
and one short meaning line from `intake-copy.ts`.

Proposed meaning line (edit in `intake-copy.ts`, not inline):

> Form submitted is what they typed on the website. Granot is the later card
> from the CRM when we have one.

### 6.1 Who this booking is for

Headline name and the reach line stay Form submitted (`contact`).

When `known_contacts.granot` exists, show the same chip as Admin Form Leads:

| Snapshot | Chip |
| --- | --- |
| missing | omit the chip (do not show `—` on this hero) |
| present and `differs_from_ingested !== true` | muted **Granot** |
| present and `differs_from_ingested === true` | emphasis **Changed in Granot** |

Under the meaning line, two cards (`sm:grid-cols-2`):

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

### 6.2 Find the right customer

Search placeholder / label may say the Owner can search the website contact
or the later Granot contact. Keep job number and reference in the same box.

Each selectable row:

- Title stays Form submitted name.
- Chip when a Granot snapshot exists (same rules as §6.1).
- The two cards, compact if needed, so a Granot-only search hit is obviously
  the same person as the Form submitted name.

Do not put `observation_id` in a tooltip. Optional tooltip: Granot name and
phone.

### 6.3 Shared helper

Prefer one read of the snapshot for chip + cards. Admin already has
`vantage-admin/components/operational/form-lead-contacts.tsx`. Either reuse
it from intake or extract a thin shared helper so the two surfaces cannot
drift. Do not fork a third copy of the chip rules. Intake sentences stay in
`intake-copy.ts`.

---

## 7. Tests the agent must add (when this file is implementation-ready)

### Server — `listGranotLifecycleCaseCandidates`

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

### Admin UI

Render `MatchedLeadPanel` and `LeadCandidateResults` with fixtures:

- No snapshot → Form submitted only, no Granot chip on the hero.
- Snapshot `differs_from_ingested: false` → chip **Granot**, both cards.
- Snapshot `differs_from_ingested: true` → **Changed in Granot**, headline
  stays the Form submitted name.
- Call Lead fixture → no Granot card.
- Owner strings come from `intake-copy.ts`. Markup never contains the
  forbidden field names.

### Browser (required for the intake UI)

Sign in with `ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD` from
`vantage-admin/.env`. Do not paste those values into chat, commits, or this
file.

1. Open a Booking intake that has a WordPress Form Lead with a Granot
   snapshot. Confirm the hero shows Form submitted name and both cards.
2. Open **Find the right customer**. Search a Granot-only name or phone that
   differs from the form. The row appears. Headline is still Form submitted.
3. Search the Form submitted phone. The same row appears.
4. Confirm a Call Lead row has no Granot chip.
5. Confirm `/form-leads` behavior from the parent spec is unchanged.

---

## 8. Knowledge updates after ship

Do not rewrite these as current until this spec is complete **and** the code
is merged.

| Doc | What to add |
| --- | --- |
| `docs/knowledge/granot-lifecycle/projections.md` | Candidate `q` for Form Leads also hits ingested and Granot snapshot contact paths. DTO carries `known_contacts`. Labels stay live. |
| `docs/knowledge/granot-lifecycle/owner-booking-intake.md` | Pointer only — intake search/display of Form submitted vs Granot. |

`docs/knowledge/services/form-lead-search.md` stays “search ignores snapshots.”
The parent Form Leads Admin spec stays the authority for `/form-leads`.

---

## 9. Implementation order (do not start yet)

1. Finish §11 or mark leftover items deferred.
2. Remove the “not fully developed” banner and set `status: proposed-final`.
3. Select snapshots on Form candidate reads; add `known_contacts` to the DTO.
4. Expand Form `q` using the shared path lists.
5. Server tests.
6. Chip + two cards on matched customer and search rows; `intake-copy.ts`.
7. Admin UI tests.
8. Browser verification on `/intakes`.
9. Knowledge updates in §8.

---

## 10. Done when (this slice only)

1. Typing a Granot-only Form Lead name, email, or phone in booking-intake
   customer search returns that WordPress Form Lead.
2. Typing the Form submitted values still returns that lead.
3. Job number and reference search still work.
4. The matched customer and each Form search row show Form submitted and
   Granot as two labeled facts when a snapshot exists, and **Changed in
   Granot** when `differs_from_ingested` is true.
5. The headline name is still Form submitted.
6. Call Lead rows, cancellation intake, scored search, identity, and Granot
   writes are unchanged.
7. Snapshots remain non-editable.

---

## 11. Open additions (not yet specified)

The Owner will append at least one more requirement here. Until that lands,
this file is incomplete.

- _Reserved. Do not invent work to fill this list._

---

## 12. Current-code map (evidence, reverify)

| Piece | Path |
| --- | --- |
| Candidate list + `q` | `src/services/granotLifecycle/projections.ts` `listGranotLifecycleCaseCandidates`, `browseCandidateLeadViews` |
| Candidate projection (no snapshots today) | `CANDIDATE_LEAD_PROJECTION` in the same file |
| Case-detail contact pair (ingested vs Granot, not this UI) | `projectLeadContacts` in the same file |
| Route | `GET /api/v1/admin/granot-lifecycle/cases/:case_id/candidates` |
| Shared path lists | `src/services/search/leadBrowseShared.ts` |
| Identity already ORs snapshots | `src/services/granotLifecycle/identity.ts` |
| Intake story + copy | `vantage-admin/components/intakes/intake-copy.ts` |
| Matched customer | `vantage-admin/components/intakes/matched-lead-panel.tsx` |
| Search + selection | `vantage-admin/components/granot-lifecycle/lead-candidate-browser.tsx` |
| Row facts | `vantage-admin/components/granot-lifecycle/candidate-lead-facts.tsx` |
| Admin Form Leads chip/cards (shipped) | `vantage-admin/components/operational/form-lead-contacts.tsx` |
| Candidate client type | `vantage-admin/lib/api/granotLifecycle.ts` `GranotLifecycleCandidateItem` |
