---
type: Specification
title: Form Lead contact snapshots — Admin display and any-known-contact search
description: Show Form submitted contact and Granot Contact Snapshot as two labeled facts on Admin Form Leads. Expand Admin browse, Admin typeahead, and extension Form Lead browse so name, email, and phone match live fields plus both snapshots. Do not change scored Form Lead Search.
tags:
  - form-lead
  - admin-dashboard
  - search
  - granot-lifecycle
status: proposed-final
stale_after: 2026-11-28
owners: [team:main-server, team:vantage-admin]
applies_to:
  - src/services/search/formLeadBrowse.service.ts
  - src/services/search/leadBrowseShared.ts
  - src/services/admin/adminBrowse.service.ts
  - src/services/admin/adminSearch.service.ts
  - src/services/admin/admin.service.test.ts
  - ../vantage-admin/components/operational/operational-resource-page.tsx
  - ../vantage-admin/components/record-detail/detail-section.tsx
sources:
  - id: glossary
    resource: ../../CONTEXT.md
    title: Platform glossary
  - id: form-lead
    resource: ./knowledge/services/form-lead.md
  - id: lead-browse
    resource: ./knowledge/services/lead-browse.md
  - id: form-lead-search
    resource: ./knowledge/services/form-lead-search.md
  - id: admin-search
    resource: ./knowledge/services/admin-search.md
  - id: desired-state
    resource: ./knowledge/granot-lifecycle/desired-state.md
  - id: identity
    resource: ./knowledge/granot-lifecycle/identity.md
---

# Form Lead contact snapshots — display and search

> **Contract maturity: implementation-ready.** Product rules in §§1–6 win.
> File citations are evidence; reverify line numbers at implementation.
> This file does not change Granot write rules, scored Form Lead Search, or
> Call Lead display.

**Prepared:** 2026-08-28
**Repos:** `vantage-main-server`, `vantage-admin`
**Owner-facing labels:** Form submitted, Granot, Changed in Granot
**Canonical fields:** [Ingested Contact Snapshot](../../CONTEXT.md), [Granot Contact Snapshot](../../CONTEXT.md), [Form Submitted Contact](../../CONTEXT.md)

---

## 1. Decision

A WordPress-born Form Lead keeps two contacts. The landing-page name, phone,
and email stay on the live fields. Qualified Granot contact is stored beside
them and never overwrites them.

Admin Form Leads today show and search only the live fields. Searching the
later Granot name or phone misses the lead.

This work does two things:

1. **Display** Form submitted and Granot as two labeled facts on Admin
   `/form-leads` and `/duplicate-form-leads`.
2. **Search** name, email, and phone as “any known contact” on Admin browse,
   Admin typeahead, and extension `GET /api/v1/form-leads`.

Do not replace the Name or Phone column with the Granot values. Do not change
how Granot writes a Lead. Do not change scored `POST /api/v1/form-leads/search`.

---

## 2. How the stored facts work (do not re-decide)

Read these before coding. The write path is already shipped.

| Fact | Storage | Who may change it |
| --- | --- | --- |
| Live contact | `name`, `first_name`, `last_name`, `email`, `phone_number`, `normalized_phone_number` | WordPress: frozen at submit (admin PATCH may still edit). Call / Granot-born: Granot overwrites these at Priority 1 or 5 |
| [Ingested Contact Snapshot](../../CONTEXT.md) | `ingested_contact_snapshot` | Nobody after insert. Guarded in `src/models/granotLifecycleSchemas.ts` (`IMMUTABLE_LEAD_PROVENANCE_PATHS`) |
| [Granot Contact Snapshot](../../CONTEXT.md) | `granot_contact_snapshot` | Granot lifecycle only, Priority 1 or 5 |

**WordPress Form Lead** (`ingestion_origin === "wordpress_form"`).
`planQualifiedContact` in `src/services/granotLifecycle/leadDesiredState.ts`
writes `granot_contact_snapshot` only. Live name, phone, and email stay off
`changed_paths`. `synchronizeLeadFromGranot` stamps
`differs_from_ingested`, `observation_id`, and `captured_at` on that snapshot.
It does not copy Granot name onto `name`.

**Call Lead / Granot-born Form Lead.** Qualified Granot contact writes onto
the live fields. Call identity does not query `granot_contact_snapshot`.
Granot-born Form create writes both snapshots as the same card with
`differs_from_ingested: false` (`src/services/granotLifecycle/createLeadFromGranot.ts`).

**Move is a different rule.** Qualified Granot may overwrite current
pickup/delivery/date/cubic feet even on WordPress. `ingested_move_snapshot`
stays immutable. This spec does not display or search move snapshots.

**Granot identity already searches snapshots.**
`findFormLeadsByScopedContact` in `src/services/granotLifecycle/identity.ts`
ORs current, ingested, and Granot phone/email inside one Source Company and
Source Granularity. Do not change that module. Admin and extension desk
search do not.

Schema (do not add fields):

```text
ingested_contact_snapshot
  first_name, last_name, name, phone_number, normalized_phone_number, email
  captured_at, evidence_status   // captured_at_ingestion | legacy_baseline

granot_contact_snapshot
  first_name, last_name, name, phone_number, normalized_phone_number, email
  differs_from_ingested, observation_id, captured_at
```

Defined in `src/models/granotLifecycleSchemas.ts`
(`ingestedContactSnapshotSchema`, `granotContactSnapshotSchema`). Spread onto
Form Lead via `formLeadProvenanceSchemaFields` in `src/models/FormLead.ts`.
Public/admin write DTOs already reject these paths
(`PUBLIC_LEAD_FORBIDDEN_LIFECYCLE_FIELDS`). Do not expose them on PATCH.

Admin browse already returns the full lean document
(`normalizeDoc` spreads the doc). Snapshots are already on `AdminRecord` when
present. Display does not need a new API. Search needs field-list expansion.

---

## 3. Scope

### In

| Surface | Change |
| --- | --- |
| Admin `/form-leads` table | Keep Name / Phone as Form submitted. Add a Granot contact chip column |
| Admin `/form-leads` detail | New **Contacts** section: Form submitted card + Granot card |
| Admin `/duplicate-form-leads` | Same columns and detail. It already shares `formLeadColumns` |
| Admin browse `q`, `name`, `email`, `phone_number` | OR across live + ingested + Granot contact paths |
| Admin typeahead `GET /api/v1/admin/search` Form Lead group | Same contact paths |
| Extension `GET /api/v1/form-leads` (`browseFormLeads`) `q` / `name` / `email` / `phone_number` | Same contact paths |

### Out

| Surface | Why |
| --- | --- |
| `POST /api/v1/form-leads/search` (`searchFormLeads`) | Identity resolution with weights and ambiguity. Granot match already has its own snapshot ladder. Changing weights affects quoted-updates and CSV fallback |
| Extension Search workspace cards | Search finds the lead. The card still shows live Form submitted fields. Do not add a Granot chip there in this pass |
| Call Leads table / detail / browse / search | Live fields already are the enrichment. Zero Call rows currently have `granot_contact_snapshot` |
| `ingested_move_snapshot` / current city columns | Separate decision |
| CSV export (`adminExport.service.ts`) | Out of this pass |
| New Mongo indexes | Identity already queries these paths. Do not add a snapshot index unless browse latency proves it |
| Edit form | Snapshots are not editable. Live name / email / phone stay on the existing edit fields |
| Granot write planner, sync, create, identity | Already correct |
| Scored confidence, digit-flex phone, duplicate quarantine | Leave those contracts alone |

---

## 4. Shared search paths (one list, three callers)

Put the path lists in **one** server module so Admin browse, Admin typeahead,
and extension Form browse cannot drift. Preferred home:
`src/services/search/leadBrowseShared.ts` (already the browse filter helper).
Export named constants. Import them from `adminBrowse.service.ts` and
`adminSearch.service.ts`. Do not copy the arrays into three files.

```ts
export const FORM_LEAD_CONTACT_NAME_PATHS = [
  "name",
  "first_name",
  "last_name",
  "ingested_contact_snapshot.name",
  "ingested_contact_snapshot.first_name",
  "ingested_contact_snapshot.last_name",
  "granot_contact_snapshot.name",
  "granot_contact_snapshot.first_name",
  "granot_contact_snapshot.last_name",
] as const;

export const FORM_LEAD_CONTACT_EMAIL_PATHS = [
  "email",
  "ingested_contact_snapshot.email",
  "granot_contact_snapshot.email",
] as const;

export const FORM_LEAD_CONTACT_PHONE_PATHS = [
  "phone_number",
  "normalized_phone_number",
  "ingested_contact_snapshot.phone_number",
  "ingested_contact_snapshot.normalized_phone_number",
  "granot_contact_snapshot.phone_number",
  "granot_contact_snapshot.normalized_phone_number",
] as const;
```

`q` / typeahead also keep today’s non-contact fields (source snapshots,
`ref_no`, `lid`, cities). Those stay local to each caller.

Match **style** stays per surface. Only the **paths** expand.

| Surface | Name | Email | Phone |
| --- | --- | --- | --- |
| Extension browse `name` / `email` / `phone_number` | `fieldContainsClause` on every name path | lowercase input, contains on every email path | typed substring contains on every phone path. Do **not** import `normalizePhoneNumberForMatch`. Do **not** use the scored digit-flex regex |
| Admin browse `name` / `email` / `phone_number` | `orContains` on name paths | `orContains` on email paths | `orContains` on phone paths (Admin already included live `normalized_phone_number`) |
| Admin browse `q` | `addQClause` on today’s `qFields` plus all three contact path lists | same | same |
| Admin typeahead `q` | substring `/i` on today’s Form fields plus all three contact path lists | same | same |

Do not add a `contact_changed_in_granot` query key. Do not add a second
“Granot name” filter.

---

## 5. Server implementation

### 5.1 Extension Form browse

**File:** `src/services/search/formLeadBrowse.service.ts`

Today:

- `FULL_TEXT_FIELDS` is live name parts, email, phone, source snapshots, `ref_no`.
- `name` ORs `name` / `first_name` / `last_name`.
- `email` contains `email`.
- `phone_number` contains `phone_number` only.

Change:

1. Append the three snapshot path lists to `FULL_TEXT_FIELDS` (keep source
   snapshots and `ref_no`).
2. `name` → `$or` of `fieldContainsClause` over `FORM_LEAD_CONTACT_NAME_PATHS`.
3. `email` → `$or` of `fieldContainsClause` over `FORM_LEAD_CONTACT_EMAIL_PATHS`
   (keep lowercasing the input).
4. `phone_number` → `$or` of `fieldContainsClause` over
   `FORM_LEAD_CONTACT_PHONE_PATHS`.

Do **not** add snapshot objects to `FormLeadBrowseResult`. Extension cards
stay live-field cards. Zod `browseFormLeadsQuerySchema` does not change
(`.strict()`, no new keys).

`GET /api/v1/form-leads` in `src/routes/v1.routes.ts` stays pointed at
`browseFormLeads`. Do not point it at `searchFormLeads` or
`findAllFormLeads`.

Call browse (`callLeadBrowse.service.ts`) does not change.

### 5.2 Admin browse

**File:** `src/services/admin/adminBrowse.service.ts`

`RESOURCE_CONFIGS["form-leads"]` today:

```ts
qFields: [
  "name", "first_name", "last_name", "email", "phone_number",
  "source_company", "source_company_label_snapshot",
  "source_granularity_label_snapshot", "crm_source_label_snapshot",
  "ref_no", "lid", "pickup_city", "delivery_city",
]
stringFilters: {
  name: ["name", "first_name", "last_name"],
  email: ["email"],
  phone_number: ["phone_number", "normalized_phone_number"],
  // … source / location / move_size unchanged
}
```

Replace the contact entries with the shared path lists. Keep source, location,
`ref_no`, `lid`, and cities on `qFields`.

`buildFilter` already turns `stringFilters.name` into `orContains`. No new
filter helper. Duplicate Form Leads use the same `form-leads` resource with
`query.duplicate === true` (`applyResourceFilter`). One config change covers
both pages.

Do not project snapshots away. `normalizeDoc` already spreads the lean doc.

### 5.3 Admin typeahead

**File:** `src/services/admin/adminSearch.service.ts`

`SEARCH_CONFIGS["form-leads"].fields` today:

```ts
"name", "email", "phone_number",
"source_company", /* three label snapshots */, "source_granularity_key",
"ref_no", "lid"
```

Append the snapshot name / email / phone paths (or spread the shared lists
and dedupe `name` / `email` / `phone_number`). Keep source and `ref_no` /
`lid`.

Primary / secondary **labels** stay live `name` / `email` / `phone_number`.
Do not label a typeahead row with the Granot name. The owner still lands on
the Form Lead whose Form submitted name is in the table.

Call typeahead fields do not change.

### 5.4 Validation

No new query keys. Do not add snapshot fields to
`createFormLeadSchema` / `updateFormLeadSchema`. They are already on
`PUBLIC_LEAD_FORBIDDEN_LIFECYCLE_FIELDS` (locked in
`src/validation/v1.validation.test.ts`).

---

## 6. Admin display

**File:** `vantage-admin/components/operational/operational-resource-page.tsx`

Shared table + detail already owned here. Prefer a small helper next to it
(same folder or `components/operational/form-lead-contacts.tsx`) so the chip
and the detail cards share one read of the snapshot. Do not fork
`/form-leads/page.tsx`.

`getValue(record, path)` already walks dotted paths. Snapshots arrive as
nested objects on `AdminRecord`.

### 6.1 Table chip

Keep existing Name / Phone / Email columns pointed at live fields. Name
label stays **Name** (that is Form submitted on WordPress). Do not rename it
to “Form submitted” in the table header — the chip carries the Granot fact.

Add one column **after Phone**:

```ts
{ key: "granot_contact", label: "Granot contact", path: "granot_contact_snapshot" }
```

Not sortable. Do not add `sort`. First / last / email stay in
`hiddenTableColumnsByResource` for form and duplicate form leads.

`formatCell` special-cases this column the way it special-cases `bad_lead`
and `job_no`. Render:

| Snapshot | Chip |
| --- | --- |
| missing / null | `—` |
| present and `differs_from_ingested !== true` | muted chip **Granot** |
| present and `differs_from_ingested === true` | emphasis chip **Changed in Granot** |

Use the stored `differs_from_ingested` flag. Do not recompute equality in
the UI. The write path stamps that flag with the same semantic contact
compare as the planner: US phone digits (so `5089899090` and `+15089899090`
are the same), case-insensitive email, and case/whitespace-insensitive
name parts. A name-only landing-page card is the same person as Granot
first/last peeled the same way CRM posts (`splitNameForCrm`). A row still
flags when first/last, phone, or email identity actually moved.

Optional tooltip on the chip: Granot name and phone when present. Do not
show `observation_id`.

Owner-facing words only. Never print `granot_contact_snapshot` or
`differs_from_ingested` in the table.

### 6.2 Detail Contacts section

Insert a **Contacts** `DetailSection` after **Summary** and before
**Source Metadata**, only for `form-leads` and `duplicate-form-leads`.

Description: `The landing-page contact stays on the lead. Granot contact is stored beside it when Granot has a qualified card.`

Two cards in a two-column grid (`sm:grid-cols-2`):

**Form submitted** (always)

| Label | Path |
| --- | --- |
| Name | `name` |
| First | `first_name` |
| Last | `last_name` |
| Phone | `phone_number` |
| Email | `email` |

Use live fields, not `ingested_contact_snapshot`. On WordPress they match.
If an Owner later PATCHed live contact, the table and this card stay
consistent.

**Granot** (only when `granot_contact_snapshot` exists)

| Label | Path |
| --- | --- |
| Name | `granot_contact_snapshot.name` |
| First | `granot_contact_snapshot.first_name` |
| Last | `granot_contact_snapshot.last_name` |
| Phone | `granot_contact_snapshot.phone_number` |
| Email | `granot_contact_snapshot.email` |
| Recorded | `granot_contact_snapshot.captured_at` as a date |

If `differs_from_ingested === true`, show the same **Changed in Granot**
badge on this card. Omit empty leaf values as `—`.

Do not render `observation_id`, `evidence_status`, or
`ingestion_origin` in this section. Do not add snapshot fields to
`formLeadEditFields`.

Granot-born Form Leads (`ingestion_origin === "granot_lead_created"`) may
show matching cards and a muted **Granot** chip. That is correct. Do not
hide the Granot card because origin is not WordPress.

Legacy rows with ingested only and no Granot snapshot: table unchanged,
Contacts section shows Form submitted only.

### 6.3 Copy

Allowed: `Form submitted`, `Granot`, `Changed in Granot`, `Granot contact`,
`No Granot contact yet` (only if you add an empty-state line under the Form
submitted card when the snapshot is missing — optional).

Forbidden in UI: `ingested_contact_snapshot`, `granot_contact_snapshot`,
`differs_from_ingested`, `wordpress_form`, `legacy_baseline`.

---

## 7. Tests the agent must add

### Server

There is no `formLeadBrowse.service.test.ts`. Add one. Stub `FormLead.find`
the same way `admin.service.test.ts` stubs browse. Assert the **filter**,
not helper internals.

**Extension browse (`browseFormLeads`)**

- `q: "granot-only-name"` includes `granot_contact_snapshot.name` in the `$or`.
- `name` includes ingested and Granot name paths.
- `email` includes `ingested_contact_snapshot.email` and
  `granot_contact_snapshot.email`.
- `phone_number: "555-1234"` contains that typed string on live and snapshot
  phone paths. Do not assert a digit-flex regex.
- Empty query still `find({})` (view all). Duplicate Leads still included.
- Result card still omits snapshot objects.

**Admin browse (`browseAdminResource("form-leads")`)**

- `q` filter includes a snapshot contact path (inspect the captured filter).
- `name` / `email` / `phone_number` filters include snapshot paths.
- Default still excludes duplicates (`duplicate: { $ne: true }`).
- Duplicate resource (`duplicate: true`) uses the same contact paths.

**Admin typeahead (`globalAdminSearch`)**

- Form Lead `fields` / captured filter includes a Granot snapshot phone or
  email path.
- Call Lead fields still omit `granot_contact_snapshot`.

Do **not** add scored `searchFormLeads` cases that start hitting snapshots.
Existing scored tests must keep passing unchanged.

### Admin UI

Colocate or add `tests/` coverage that renders the operational page (or a
extracted helper) with fixture records:

- No snapshot → chip `—`, Contacts shows Form submitted only.
- Snapshot `differs_from_ingested: false` → chip **Granot**, both cards.
- Snapshot `differs_from_ingested: true` → chip **Changed in Granot**.
- Live name stays the Form submitted name when Granot name differs.
- Edit fields still do not include snapshot keys.

### Browser verification (required for the Admin UI)

Sign in with `ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD` from
`vantage-admin/.env`. Do not paste those values into chat, commits, or the
spec report.

1. Open `/form-leads`. Confirm Name / Phone still show live Form submitted
   values.
2. Find a WordPress row with a Granot snapshot (chip visible). Open detail.
   Confirm two cards. Confirm Granot name is not copied into the Name column.
3. Search Name or Phone for a Granot-only value that differs from the form.
   The row appears.
4. Search the Form submitted phone. The same row appears.
5. Open `/duplicate-form-leads` and confirm the chip column is there.
6. Open `/call-leads`. No Granot contact column.

If local data has no differing snapshot, construct a test fixture for unit
tests and still walk the empty-chip and Form-submitted-only detail states in
the browser.

---

## 8. Knowledge updates after ship

Do not rewrite these as current until the code is merged. Then update:

| Doc | What to add |
| --- | --- |
| `docs/knowledge/services/lead-browse.md` | Form `q` / name / email / phone also hit ingested and Granot snapshot contact paths. Card shape unchanged |
| `docs/knowledge/services/admin-search.md` | Form typeahead fields include those snapshot paths. Labels stay live |
| `docs/knowledge/services/form-lead.md` | Admin list/detail show Form submitted vs Granot; search is any-known-contact. Writes unchanged |

`docs/knowledge/services/form-lead-search.md` stays “search ignores snapshots.”

---

## 9. Implementation order

1. Export the three path lists from `leadBrowseShared.ts`.
2. Wire extension browse, then Admin browse, then Admin typeahead.
3. Server tests.
4. Admin chip + Contacts section + helper.
5. Admin UI tests.
6. Browser verification on `/form-leads` and `/duplicate-form-leads`.
7. Knowledge updates listed in §8.

---

## 10. Done when

1. Typing a Granot-only name, email, or phone on Admin Form Leads or
   extension `GET /form-leads` returns the WordPress Form Lead.
2. Typing the Form submitted values still returns that lead.
3. `/form-leads` and `/duplicate-form-leads` show a Granot chip when a
   snapshot exists, and **Changed in Granot** when `differs_from_ingested`
   is true.
4. Detail shows two labeled cards. Name column is still Form submitted.
5. Scored `POST /form-leads/search` behavior is unchanged.
6. Call Leads UI and Call browse/search are unchanged.
7. Snapshots remain non-editable and rejected on public/admin write DTOs.

---

## 11. Current-code map (evidence, reverify)

| Piece | Path |
| --- | --- |
| Form Lead model + indexes | `src/models/FormLead.ts` |
| Snapshot schemas + immutability | `src/models/granotLifecycleSchemas.ts` |
| Create stamps ingested snapshots | `src/services/leads/leadIngestionProvenance.ts` |
| WordPress contact freeze | `src/services/granotLifecycle/leadDesiredState.ts` `planQualifiedContact` |
| Snapshot stamp + `differs_from_ingested` | `src/services/granotLifecycle/synchronizeLeadFromGranot.ts` `buildLeadUpdate` |
| Granot-born both snapshots | `src/services/granotLifecycle/createLeadFromGranot.ts` |
| Identity already ORs snapshots | `src/services/granotLifecycle/identity.ts` `findFormLeadsByScopedContact` |
| Extension desk browse | `src/services/search/formLeadBrowse.service.ts` |
| Browse helpers | `src/services/search/leadBrowseShared.ts` |
| Scored search (leave alone) | `src/services/search/formLeadSearch.service.ts` |
| Admin list/detail | `src/services/admin/adminBrowse.service.ts` |
| Admin typeahead | `src/services/admin/adminSearch.service.ts` |
| Browse query Zod | `src/validation/v1/leads.validation.ts` `browseFormLeadsQuerySchema` |
| Admin UI table + detail | `vantage-admin/components/operational/operational-resource-page.tsx` |
| Detail primitives | `vantage-admin/components/record-detail/detail-section.tsx` |
| Admin record client | `vantage-admin/lib/api/admin.ts` |
| Form / duplicate pages | `vantage-admin/app/(dashboard)/form-leads/page.tsx`, `duplicate-form-leads/page.tsx` (thin wrappers; do not fork) |
