# Lead Source Assignment — operational story

- Status: recommended
- Service: `leads` (Wave A, in-progress)
- Pass: 5 of this service — `leadSourceCompany.ts`
- Remaining in this service: `leadCplResolution.ts`, `leadLocation.service.ts`, `leadName.service.ts`, `leadPhoneMatching.ts`, `sourceLeadLookup.service.ts`, `callLeadSourceMatch.ts`, `leadSourceCompatibility.ts`
- Target: `src/services/leads/leadSourceCompany.ts`
- Knowledge: `docs/knowledge/services/form-lead.md` (create/correct Source Company step), `docs/knowledge/services/call-lead.md` (Admin/sheet create + correct; RingCentral supplies its own bag), `docs/knowledge/services/operations-registry.md` (source attribution), `docs/knowledge/services/bookings.md` (from-source override, unmatched Call create, leadless, mirror). No dedicated Service file for this module. This checkout’s `CONTEXT.md` does not define Source Company / Source Granularity — do not invent a glossary copy.
- Callers: `formLead.service.ts` (ingest + correct), `callLead.service.ts` (Admin/sheet ingest + correct), `bookings/bookedLeadFromSource.service.ts`, `bookings/bookingSourceResolver.ts`, `bookings/bookingMirror.service.ts`, `bookings/leadlessBooking.service.ts`, `employeeBookings/bookingLeadAttachment.service.ts`, `enrichment/callLeadEnrichmentRows.ts`, `reconciliation/bookedCallLeadRows.ts`
- Seams callers need: interpret the hint (missing → Main Site, raw label vs explicit slug) vs ask the Registry; stampable assignment vs full attribution (`match_kind`); Registry miss becomes `ValidationError` on `source_company` (enrichment/recon catch that and warn)
- Split later (only if the file outgrows one sitting): `interpretLeadSourceHint.ts`, `stampLeadSourceAssignment.ts` — never `create.ts` / `update.ts` / `delete.ts`

## What this file actually does

One operation, not “a source-company helper” and not catalog CRUD:

1. **Assign the Lead's Source** — a Form, Call, Booking, enrichment row, or reconciliation row arrives with a hint (raw label, slug, granularity key, site, Move Type, channel). Decide what to ask the Operations Registry. If the Registry answers, stamp the Source Company, Source Granularity, and the three label snapshots the rest of ingest/booking can write. If it refuses, fail as a `source_company` validation, not a raw Registry error.

`resolve*` / `sourceAssignmentFields` are executor mechanics. The owner question is: *which Source Company and which Source Granularity does this Lead belong to, and what do we write down so CPL, Duplicate Lead, Form Fill, CRM label, and sheets can see it?*

`leadSourceCompanies/` is not this file. That folder is the leftover catalog read. Admin writes already go through Operations Registry. RingCentral Call ingest is not this file: qualification already decided the route, and `createRingCentralCallLeadInTransaction` copies the same stampable bag inline.

## Organization

Keep one file. This is the screenplay for “this Lead belongs here.” Registry lookup, company/granularity records, and alias priority already live in `operationsRegistry` (`resolveSourceAttribution` / `previewSourceAttribution`). Do not pull those in. Do not pull `leadSourceCompanies`, Form/Call ingest, or booking. Do not invent a `LeadSourceCompanyService` class.

If it later outgrows one sitting, split by **story** (interpret the hint vs stamp the assignment), not by Form vs Call folders.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `resolveLeadSourceAssignment` | `assignLeadSource` | every Lead/Booking write that does not already hold a Registry attribution must ask, then stamp |

Keep the old name as a one-line alias until Form/Call ingest, booking, employee-booking attach, enrichment, and booked-call-lead reconciliation migrate. Do not make callers learn `resolve` as the domain language.

Do not export `sourceAssignmentFields`. It is a child of stamp. Tests go through `assignLeadSource`.

The injectable `deps.resolver` stays. It is the test **seam** for “we interpreted the hint this way,” not a second public operation.

**No class for the workflow.** The types that *do* earn names are the hint and the stampable bag:

```ts
type LeadSourceHint = {
  channel: "form" | "call"
  value?: string | null            // raw label / leftover source_company
  company_slug?: string | null
  granularity_key?: string | null
  source_site?: string | null
  local?: LocalType
}

type LeadSourceAssignment = {
  source_company
  lead_source_company
  source_granularity_id
  source_granularity_key
  source_company_label_snapshot
  source_granularity_label_snapshot
  crm_source_label_snapshot
}

type LeadSourceAssigned = {
  resolution: SourceAttribution    // match_kind + registry_revision
  assignment: LeadSourceAssignment
}
```

Drop `requireActive` and `inbound_phone_number` from the public hint. They are on today’s input type and never sent to the Registry.

`resolution` stays on the return because enrichment and booked-call-lead reconciliation need to know it resolved (and tests lock `match_kind`). Most write callers only spread `assignment`. That dual return is the **seam**, not leftover typing.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// leadSourceCompany.ts
// A Lead (or a Booking that must invent one) arrives with a source hint.
// Ask the Registry which Source Company and Source Granularity it is.
// Stamp what the rest of ingest and booking will write.

// ── 1. Assign the Lead's Source ───────────────────────────

export async function assignLeadSource(hint, deps?)

function readTheExplicitSlug(hint)                 // trim + lower company_slug
function readTheRawLabel(hint)                     // trim + lower value
function aBlankOrNotProvidedLabelIsMainSite()      // no slug + missing/"not_provided"
function aRawLabelWithoutASlugIsTheCompanyHint()   // slug := label; also crm_label + fallback
function anExplicitSlugSpeaksForTheCompany()       // do not promote value to crm_label
function stillKeepTheRawLabelAsAFallbackAlias()    // always pass value through
function allowCompanyIdentifierFallbackOnlyWhenTheSlugWasInferred()
async function askTheRegistry(prepared, resolver)
function aRegistryRefusalIsASourceCompanyValidation(error)
function stampWhatTheLeadWillRemember(attribution)
```

Read the WordPress path out loud: *there is no company slug. The form sent nothing, or it sent `not_provided`. Treat that as Main Site. Ask the Registry on the form channel with that slug, the Move Type, and the site if we have one. Do not offer a CRM label or a company-identifier fallback. If the Registry answers, stamp the slug, both ObjectIds, and the three snapshots. If it refuses, fail as a source_company validation.*

Read the legacy-label path out loud: *there is still no slug, but the row said “legacy alias.” That string is the company hint, the CRM label, and the fallback alias, and we allow the Registry to miss the company id and keep looking. Owner-created sources that already know their slug skip that promotion: the slug is enough; the raw label stays only as a fallback alias.*

That is the operation. `resolveLeadSourceAssignment` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **The file name collides with catalog CRUD.** `leadSourceCompany.ts` next to `leadSourceCompanies/leadSourceCompany.service.ts` reads as “the Source Company service.” This file never creates a company. Rename the story (`assignLeadSource`) so a later implementer does not merge the folders.

2. **`value` / `company_slug` / `fallback_alias` are one decision.** No explicit slug + blank/`not_provided` → `main_site`. No explicit slug + a real label → inferred slug **and** `crm_label` **and** `allow_company_identifier_fallback`. Explicit slug → do not set `crm_label` from `value`, but still pass `value` as `fallback_alias`. Name those three beats. Do not collapse them into “always send everything.”

3. **`crm_label` uses the raw `value`, not the normalized slug.** Case and spacing stay for exact CRM-label match. The slug side is trimmed/lowercased. Keep that split visible. Do not lowercase the CRM label “for consistency.”

4. **`requireActive` and `inbound_phone_number` are dead.** They are on the input type, never read, never forwarded. Drop them from the hint type. Do not invent Registry wiring for an inbound number here — that is RingCentral inbound-route attribution.

5. **Form/Call correction passes the live slug as `company_slug`.** `company_slug: input.company_slug ?? lead.source_company` means a `source_company`-only patch keeps the old slug as explicit and sends the new label only as `fallback_alias`. That is a caller choice in `formLead.service` / `callLead.service`, not a bug to “fix” inside assign. Name it in those later passes. Do not change the default here so a label-only patch silently wins.

6. **RingCentral already stamps the same bag without calling this file.** `createRingCentralCallLeadInTransaction` copies ObjectIds and snapshots from `source_resolution`. That is the RingCentral **adapter** (qualification already ran). Do not route RingCentral create through `assignLeadSource`. Do not export `stampWhatTheLeadWillRemember` just to DRY those seven fields.

7. **Enrichment and booked-call-lead reconciliation catch `ValidationError` and warn.** Unknown labels become `Skipped unknown source "…"` and the row continues without an assignment. Lead ingest and booking create do not catch — they fail closed. Do not make assign return `null` “so callers can choose.” The **seam** is the thrown validation.

8. **`createLeadFromGranot` does not call this file.** Trusted Granot create already holds a reviewed Source Granularity. Do not pull the command in. Do not silently route Granot create through assign.

9. **Leave the Registry and the leftover catalog alone.** `resolveSourceAttribution`, alias priority, exact key / CRM label / site uniqueness, and channel defaults stay in `operationsRegistry`. `leadSourceCompanies` stays a later Wave A service. Do not move preview matching into this file “so leads owns resolution.”

10. **CPL is the next module.** Assign returns the granularity id; `leadCplResolution.ts` prices it. Do not call `resolveLeadCplSnapshot` from here.

## Testing

The **interface** is the test surface: `assignLeadSource` (today `resolveLeadSourceAssignment`).

Today’s `leadSourceCompany.test.ts` injects a resolver and covers two happy paths: owner-created explicit slug, and a raw label that becomes slug + `crm_label` + `fallback_alias` + company-identifier fallback. Keep the injectable resolver. Fill the gaps the story names make obvious:

**Interpret the hint**
- No slug + missing `value` → Registry `company_slug` is `main_site`; no `crm_label`; `allow_company_identifier_fallback` is false.
- No slug + `not_provided` (any case / padding) → same Main Site default.
- No slug + `"legacy alias"` → `company_slug` / `crm_label` / `fallback_alias` are that label; fallback allowed (today’s second test).
- Explicit `company_slug` + a different `value` → slug wins for the company; `crm_label` is absent; `fallback_alias` is still the raw `value`; fallback is not allowed (today’s first test plus the leftover alias).
- `granularity_key`, `source_site`, `local`, and `channel` are forwarded unchanged.
- `crm_label` keeps the caller’s raw `value` (not the lowercased slug).

**Ask and stamp**
- Attribution ObjectIds become `lead_source_company` and `source_granularity_id`; snapshots and `source_company` come from the Registry slug, not the hint.
- `match_kind` (`exact` / `fallback` / `default`) is returned on `resolution` and is not copied onto the assignment.

**Refuse**
- A Registry error becomes `ValidationError` with `field: "source_company"` and `registry_code`.
- A non-Registry throw is rethrown unchanged.

Do **not** add a test per helper (`aBlankOrNotProvidedLabelIsMainSite`, `stampWhatTheLeadWillRemember`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** add Mongo or live Registry tests here. The injectable resolver is the **adapter**. Registry uniqueness and alias priority are `operationsRegistry` tests.

Form/Call ingest tests should prove they called assign and wrote `assignment`, not re-implement Main Site vs inferred-slug.

## What I would not do

- A `LeadSourceCompanyService` class with `resolve` / `assign` / `validate`.
- Thirty two-line functions that only trim a string or spread seven fields.
- Moving this into a CRUD folder, or into `leadSourceCompanies/` / `operationsRegistry/` “because it talks to the catalog.”
- Treating RingCentral inbound-route attribution, Granot `createLeadFromGranot`, or admin Source Company writes as this story.
- Forwarding `inbound_phone_number` into the Registry, or dropping `fallback_alias` when a slug is present “to simplify.”
- Changing Form/Call correction so a `source_company`-only patch infers a new slug.
- Making assign return `null` on a Registry miss, or catching validation inside this file for enrichment.
- Calling CPL, Duplicate Lead, or Form Fill from here.
- Silently “fixing” Main Site as the blank-source default.
