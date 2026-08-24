---
type: Specification
title: Admin Filter Catalog — collection-backed Source Company options for lead search and analytics
description: Replace hardcoded source slugs and CRM-label maps on Form Lead, Call Lead, duplicate, and Analytics surfaces with one Filter Catalog loaded from Operations Registry collections. The only source filter is a Source Company dropdown whose options are channel-scoped Source Granularities, spelled exactly as owner_label.
tags:
  - admin-dashboard
  - analytics
  - source-attribution
  - operations-registry
  - form-lead
  - call-lead
status: proposed-final
stale_after: 2026-11-24
owners: [team:main-server, team:vantage-admin]
applies_to:
  - src/models/LeadSourceCompany.ts
  - src/models/LeadSourceGranularity.ts
  - src/models/FormLead.ts
  - src/models/CallLead.ts
  - src/services/admin/adminFacets.service.ts
  - src/services/admin/adminBrowse.service.ts
  - src/services/analytics/**
  - src/services/operationsRegistry/sourceRegistry.ts
  - src/validation/v1/analytics.validation.ts
  - src/validation/v1/admin.validation.ts
  - ../vantage-admin/app/(dashboard)/form-leads/**
  - ../vantage-admin/app/(dashboard)/call-leads/**
  - ../vantage-admin/app/(dashboard)/duplicate-form-leads/**
  - ../vantage-admin/app/(dashboard)/duplicate-call-leads/**
  - ../vantage-admin/app/(dashboard)/analytics/**
  - ../vantage-admin/components/operational/operational-resource-page.tsx
  - ../vantage-admin/components/analytics/analytics-dashboard.tsx
  - ../vantage-admin/components/dashboard/home-overview.tsx
  - ../vantage-admin/lib/api/facets.ts
  - ../vantage-admin/lib/api/admin.ts
  - ../vantage-admin/lib/constants/domain.ts
sources:
  - id: glossary
    resource: ../../CONTEXT.md
    title: Platform glossary
  - id: source-connections
    resource: ./operations-registry-source-connections-owner-ui-specification.md
  - id: operations-registry
    resource: ./knowledge/services/operations-registry.md
  - id: analytics
    resource: ./knowledge/services/analytics.md
  - id: lead-browse
    resource: ./knowledge/services/lead-browse.md
---

# Admin Filter Catalog — specification

> **Contract maturity: implementation-ready.** Product rules in §§1–2 and §9
> win. Current-code citations in §3 and §16 are evidence; reverify at
> implementation. This file does not change Source Company / Source Granularity
> write rules.

**Prepared:** 2026-08-24
**Repos:** `vantage-main-server`, `vantage-admin`
**Owner-facing filter name:** Source Company
**Canonical option identity:** [Source Granularity](../../CONTEXT.md)

---

## Why this document exists

Form Lead search, Call Lead search, their duplicate lists, and Analytics all
need the same source choices. Those choices already live in MongoDB:

- `lead_source_companies` — the company-level **Source Company**
- `lead_source_granularities` — the exact **Source Granularity** / Feed

The Admin Dashboard does not use that catalog as the filter authority. It
mixes three incompatible lists:

| Surface today | What the dropdown actually offers | What the owner needs |
| --- | --- | --- |
| Form / Call / Duplicate filter `Source company` | Hardcoded company slugs (`tbm_leads`, `top10_leads`, …) later swapped for company `owner_label` | The Form or Call Source Granularities, spelled as stored |
| Same pages, second dropdown `Source granularity` | `granularity_key` labeled `owner_label (channel)` | Remove this extra control |
| Same pages, edit `Source company` | Hardcoded CRM labels (`FORM_LEAD_SOURCE_LABELS` / `CALL_LEAD_SOURCE_LABELS`) | The same collection spellings as the filter |
| Analytics `Source company` | Company slugs / company `owner_label` | The same Source Granularity list |
| Analytics `Source granularity` | `granularity_key` with a constructed label | Remove this extra control |
| Analytics `Source` | CRM labels (`crm_label`) | Remove this extra source control |

That split is wrong in two ways. Selecting **Top 10 Forms** (the company
label) or `top10_leads` (the slug) includes both **Top10 Forms** and
**Top10 Inbounds**. And the spelling is invented: the company catalog says
`Top 10 Forms` while the Form Source Granularity is stored as `Top10 Forms`.

This specification makes the collections the only predefined option source
and puts that same catalog on every listed search and Analytics surface.

---

## 0. Authority and required reading

Read in this order. Stop and report contradictions; do not silently merge.

1. **This file** — wins on Filter Catalog payload, the one Source Company
   dropdown, browse/analytics matching for that control, catalog-complete
   Analytics source rows, and the listed Admin client contracts.
2. **[Operations Registry source connections](./operations-registry-source-connections-owner-ui-specification.md)**
   — still wins on Source Company / Source Granularity identity, `owner_label`
   spelling, first-class `lead_source_granularities`, and write rules.
3. **Glossary:** [`CONTEXT.md`](../../CONTEXT.md) — Source Company, Source
   Granularity, Single-Feed Source Company, Paid Overflow, Referral Booking,
   Analytics, Admin Dashboard. This document does not change those terms.
4. **Current service docs (reverify, do not copy as contract):**
   [`analytics.md`](./knowledge/services/analytics.md),
   [`operations-registry.md`](./knowledge/services/operations-registry.md),
   [`lead-browse.md`](./knowledge/services/lead-browse.md).

Where current admin or analytics code disagrees, **the catalog and this
specification win**.

---

## 1. Decision

There is one **Filter Catalog**. Production reads first-class Operations
Registry collections. Historical and combined scopes add distinct values
observed on the lead and booking collections. Every listed Admin surface
consumes that catalog. No surface hardcodes Source Company slugs, CRM
labels, or `SOURCE_LABEL_TO_COMPANY` maps as dropdown options.

On Form Leads, Call Leads, Duplicate Form Leads, Duplicate Call Leads, and
Analytics there is **exactly one source filter**. Its Owner-facing name is
**Source Company**. Its options are **Source Granularities**, channel-scoped,
displayed with `owner_label` copied character-for-character from the
collection.

```text
Filter Catalog (one payload)
  ├─ Source Companies          (graph parent only; not a lead-search option)
  ├─ Source Granularities      (the Source Company dropdown options)
  ├─ Agents
  └─ Merchants

Form Leads / Duplicate Form Leads
  └─ Source Company dropdown = form-channel Source Granularities

Call Leads / Duplicate Call Leads
  └─ Source Company dropdown = call-channel Source Granularities

Analytics (every tab) + Home overview source tables
  └─ Source Company dropdown = all catalog Source Granularities
      (narrowed to form or call when Lead type is set)
  └─ Source reports list every catalog Source Granularity
```

Selecting **Top10 Forms** returns only that Form Source Granularity. It
never expands to the whole Top10 Source Company.

The deep module is the Filter Catalog behind `GET /api/v1/admin/facets`.
Callers learn one payload. They do not assemble options from hardcoded
enums, embedded `granularities[]`, or a second `GET /source-companies`
join.

---

## 2. Vocabulary

Do not invent a second meaning for **Source Company**. The glossary stays
unchanged.

| Term | Meaning here |
| --- | --- |
| **Source Company** | Company-level attribution owner (`LeadSourceCompany`). Parent in the catalog graph. |
| **Source Granularity** | Exact lead stream (`LeadSourceGranularity`). The filter option. |
| **Source Company dropdown** | The single source filter control on the listed surfaces. Options are Source Granularities. This is UI copy, not a glossary change. |
| **Filter Catalog** | The one read model of predefined options loaded from collections. |
| **`owner_label`** | The exact Owner-facing spelling. Filters, table cells, charts, and CSV source names use this string as stored. |
| **`crm_label`** | What Vantage sends to Granot. Never the default filter display. |
| **`company_slug` / `granularity_key`** | Immutable internal keys. Submitted as the filter value; never shown as the option text. |
| **`source_company` on a Lead** | Legacy slug / compatibility string. Not the filter option identity. |

| Avoid on these surfaces | Use |
| --- | --- |
| A second **Source granularity** filter | One **Source Company** dropdown |
| A second **Source** / CRM-label filter | The same dropdown |
| `tbm_leads`, `top10_leads`, `main_site` as option text | `TBM Forms`, `Top10 Forms`, `Main Site Forms` |
| `Top 10 Forms` (company label) as a form-lead option | `Top10 Forms` (Form Source Granularity `owner_label`) |
| `10best Inbounds` rewritten to `TBM Leads` | `10best Inbounds` as stored |
| Humanized slugs (`Top10 Leads`) | Collection `owner_label` |
| Embedded `LeadSourceCompany.granularities[]` as authority | First-class `lead_source_granularities` |

Operations Registry Owner copy (**Lead source** / **Feed**) stays on
`/operations-registry`. These search and Analytics pages keep **Source
Company** because that is how the owner filters leads today.

---

## 3. Current-state evidence (repository, 2026-08-24)

Reverify at implementation. These are the facts this specification changes.

### 3.1 Three lists, none of them the catalog

`vantage-admin/lib/constants/domain.ts` still ships `SOURCE_COMPANIES`,
`SOURCE_COMPANY_LABELS`, `FORM_LEAD_SOURCE_LABELS`, `CALL_LEAD_SOURCE_LABELS`,
and `SOURCE_LABEL_TO_COMPANY`. Form/Call filters start from company slugs.
Edit fields start from hardcoded CRM labels.

Production option loading is split:

| Client read | What it actually uses |
| --- | --- |
| `GET /api/v1/admin/facets` | Five **string** arrays: company slugs, `granularity_key`s, `crm_label`s, agent names, merchant names. Active rows only. |
| `GET /api/v1/admin/source-companies` | Full company objects **including embedded `granularities[]`**. Production dropdowns are built from this join, not from facets. |
| `useCatalogOptions` | Separate agents/merchants read. |

`useFacetOptions` then builds three different option sets from the same
registry payload: company `owner_label` for the filter, `crm_label` for
edits, and `owner_label (channel)` for the extra granularity filter.
`withFacetOptions` branches on sentinel values (`tbm_leads`,
`Main Site Forms`, `Main Site Inbounds`).

Facets cache is a 5-minute in-process `Map`. Registry mutations already
emit a `"facets"` invalidation key. `adminFacets.service.ts` does not
subscribe, so TTL is the only expiry.

### 3.2 Company filter selects the wrong stream

Analytics `source_company` resolves aliases through
`resolveSourceCompany` / `SOURCE_LABEL_TO_COMPANY` and matches the company
slug. Choosing anything in the Top10 family includes both form and call
streams.

Admin browse `source_company` is worse: it `orContains` (unanchored
substring) across `source_company`, `source_company_label_snapshot`,
`source_granularity_label_snapshot`, and `crm_source_label_snapshot`. A
slug such as `tbm_leads` can hit `tbm_prime_leads`.

Browse `source_granularity_key` is already anchored exact on that one
field. Analytics `source_granularity_key` is already exact on
`source_granularity_key` / `derived_source_granularity_key`. Those matches
are the correct identity; the UI simply does not treat them as the one
Source Company dropdown.

### 3.3 Analytics does not show the full catalog

Source-performance, funnel, and lead-cost nest children under companies,
but only for observed keys in the window. Historical scope drops children
entirely (`companyOnlySourceRows`). The extra Analytics **Source** control
still offers CRM labels. The catalog’s Form and Call Source Granularities
are not the complete, consistent option and row set.

Per-report source dimension today:

| Report | Groups by | Nested children? |
| --- | --- | --- |
| `source-company-performance` | prod: company + `source_granularity_key`; hist: company | prod only |
| `source-company-funnel` | same | prod only |
| `lead-cost` / Home tables | same | prod only |
| `booking-cancellation-ratio` | `derived_source_company` only | never |
| `lead-source-performance` | `booked_leads.source` (CRM string) | never |
| `receiver-agent-source-breakdown` | CRM `source_label`, not granularity | never |
| `summary`, trends, geography, agent reports | no source rows | n/a |

`loadProductionSourceLabelIndex` already reads first-class companies and
granularities with `includeInactive: true`. It is labels-only. It never
seeds zero rows.

`GET /api/v1/admin/analytics/overview` accepts only `database_scope`. Home
source tables cannot be filtered by the client. The Analytics **overview
tab** still sends `source_company` / `source_granularity_key` to the
tab’s reports (`summary`, `source-company-performance`,
`receiver-agent-performance`). Those are different endpoints.

### 3.4 Embedded arrays are not the catalog

`listSourceCompanies` still projects embedded `granularities[]`. Writes
already reject embeds. First-class `lead_source_granularities` is the
writable catalog. Filter options must be composed from
`listSourceCompanies` **plus** `listSourceGranularities`, the same way
employee-booking options and analytics `sourceHierarchy` already do.
Embedded arrays are migration evidence only.

### 3.5 Historical schemas are thinner

Historical Form Lead / Call Lead models store `source_company` and do not
define `source_granularity_key` or the three label snapshots. Distincts on
those fields are usually empty unless extra Mongo fields exist. Historical
bookings store `source` (a CRM / sheet string) and an
`employee_source_snapshot` that browse/facets do not read.

The Filter Catalog must still build historical options from whatever
distinct evidence exists. It must not invent production children it cannot
prove.

### 3.6 Edit and filter already disagree on the same label

| Control | Field key | Value submitted | Option text |
| --- | --- | --- | --- |
| List **Source company** | `source_company` | `tbm_leads` | company `owner_label` or hardcoded label |
| List **Source granularity** | `source_granularity_key` | `tbm_leads_form` | `owner_label (channel)` |
| Edit **Source company** | `source_company` | `"TBM Forms"` (`crm_label`) | `crm_label` |
| Analytics **Source** | `source` | `crm_label` / booked `source` | same string |

Lead PATCH already accepts `source_granularity_key` and re-resolves
through `resolveLeadSourceAssignment`. The edit form does not send it. It
sends the CRM label as `source_company`.

Table **Source** cells prefer `crm_source_label_snapshot`, then
granularity snapshot, then company snapshot, then the raw slug.

---

## 4. Filter Catalog

### 4.1 One module, one payload

Add a deep read module behind the existing admin facets seam
(`GET /api/v1/admin/facets`). Callers learn one interface: given a
`database_scope` and optional channel, they receive interconnected catalog
documents. They do not assemble options from hardcoded enums.

Required payload. `catalog` is the option authority.

```ts
type AdminFacets = {
  catalog: FilterCatalog;
  // Compatibility only — derived from catalog / distincts.
  // Listed surfaces must not read these arrays as option authority.
  agents: string[];
  source_companies: string[];
  source_granularities: string[];
  sources: string[];
  merchants: string[];
};

type FilterCatalog = {
  source_companies: FilterCatalogCompany[];
  source_granularities: FilterCatalogGranularity[];
  agents: FilterCatalogAgent[];
  merchants: FilterCatalogMerchant[];
};

type FilterCatalogCompany = {
  id: string;                       // Source Company ObjectId, empty when historical-only
  company_slug: string;
  owner_label: string;              // parent spelling for hierarchy rows; not a lead-search option
  active: boolean;                  // true for historical-only
  origin: "registry" | "historical_distinct";
};

type FilterCatalogGranularity = {
  id: string;                       // Source Granularity ObjectId, empty when historical-only
  source_company_id: string;        // parent Source Company ObjectId, empty when unknown
  company_slug: string;             // parent slug when known
  company_owner_label: string;      // parent spelling when known; not the option text
  granularity_key: string;          // submitted filter value
  channel: "form" | "call";
  owner_label: string;              // option text, exact collection spelling
  crm_label?: string;               // available for edit resolution; not option text
  local?: "local" | "long_distance";
  active: boolean;
  origin: "registry" | "historical_distinct";
};

type FilterCatalogAgent = {
  id: string;                       // empty when historical-only
  name: string;                     // option text
  active: boolean;
  origin: "registry" | "historical_distinct";
};

type FilterCatalogMerchant = {
  id: string;                       // empty when historical-only
  name: string;
  active: boolean;
  origin: "registry" | "historical_distinct";
};
```

Compatibility arrays, when kept, are projections of the same catalog so
they cannot drift:

| Array | Projection |
| --- | --- |
| `source_companies` | `catalog.source_companies[].company_slug` |
| `source_granularities` | `catalog.source_granularities[].granularity_key` |
| `sources` | `catalog.source_granularities[].crm_label` when present, else historical booked `source` |
| `agents` | `catalog.agents[].name` |
| `merchants` | `catalog.merchants[].name` |

Bookings and Cancellations may keep reading those arrays until the
follow-on in §6.5. Listed surfaces must not.

Closed domain enums that are **not** catalog documents stay local:
Move Type (`local` / `long_distance`), move size, booked/cancelled,
Analytics date bucket (`day` / `month`), and lead type (`form` / `call`).

### 4.2 Production load

For `database_scope=production`:

1. `listSourceCompanies({ includeInactive: true })`
2. `listSourceGranularities({ includeInactive: true })`
3. `listCatalogItems("agents", { includeInactive: true })` and
   `listCatalogItems("merchants", { includeInactive: true })`
4. Attach each Source Granularity to its Source Company by ObjectId
5. Sort Source Granularities by `owner_label` using `en` / base sensitivity
6. Sort companies, agents, and merchants the same way (`owner_label` or
   `name`)

Include inactive rows. Mark them in the UI as `{owner_label} (inactive)`
or `{name} (inactive)`. The owner still has historical leads on retired
feeds. Default **create** workflows elsewhere continue to use active
records only.

Do not:

- distinct-scan `form_leads` / `call_leads` to build production options;
- read embedded `LeadSourceCompany.granularities[]`;
- remap through `SOURCE_COMPANY_CONFIGS` or `SOURCE_LABEL_TO_COMPANY`;
- humanize `granularity_key` when `owner_label` is present;
- call `GET /api/v1/admin/source-companies` from the listed surfaces to
  build these dropdowns. That route remains for Operations Registry.

### 4.3 Historical and combined load

Historical has no Operations Registry. Build options from distinct stored
evidence, then overlay production catalog identity when a key or label
matches.

Read, per historical collection:

| Collection | Distinct fields |
| --- | --- |
| `form_leads` | `source_granularity_key`, `source_granularity_label_snapshot`, `source_company` |
| `call_leads` | same |
| `booked_leads` | `source`, `employee_source_snapshot.source_granularity_key`, `employee_source_snapshot.source_granularity_label_snapshot`, agent-allocation names, merchants |

The historical Form Lead / Call Lead schemas may not declare
`source_granularity_key` or snapshots. Distinct those fields anyway.
Empty results are expected. Do not fail the catalog load.

A historical-only Source Granularity row:

- `origin: "historical_distinct"`
- `owner_label` = the stored snapshot spelling, otherwise the stored key,
  otherwise the stored `source_company` / booked `source` string
- `granularity_key` = stored key when present, otherwise the snapshot or
  source string used as the submitted value
- `channel` = form vs call from the collection it was observed on.
  Booked-only evidence with no lead join stays unscoped and appears only
  on Analytics (both channels), not on the four lead pages
- `id` / `source_company_id` empty unless the production catalog matches
  that key or snapshot exactly

A historical-only company, agent, or merchant row follows the same
`origin` / empty-id rules. `owner_label` / `name` is the stored spelling.

Combined merges production catalog rows with historical-distinct extras.
Dedup Source Granularities by `granularity_key` (case-insensitive).
Registry `owner_label` wins when both exist. Keep historical-only
spellings that the registry does not know. Dedup agents and merchants by
normalized name; registry id and `active` win.

### 4.4 Option contract

| Surface | Options | Display | Submitted value |
| --- | --- | --- | --- |
| Form Leads, Duplicate Form Leads | `channel === "form"` | `owner_label` | `granularity_key` |
| Call Leads, Duplicate Call Leads | `channel === "call"` | `owner_label` | `granularity_key` |
| Analytics, Home overview filter | all channels; if `lead_type=form` or `call`, that channel only | `owner_label` | `granularity_key` |
| Form / Call edit `Source company` | same channel list as that page’s filter | `owner_label` | `granularity_key` |

Receiver-agent options submit **agent id**. Merchant options submit
**name** (bookings still store the name). Those contracts do not change.

Rules:

- One option per Source Granularity. Best Relocation local and long-distance
  Form feeds are two options, each with its stored `owner_label`.
- Paid Overflow is whatever Form or Call Source Granularity the catalog
  actually stores, spelled as stored. Do not hide a single-feed company
  behind a company-only option.
- Referral is a Booking attribute, not a Form or Call Source Granularity.
  It does not appear on the four lead surfaces. Analytics does not add a
  synthetic Referral option to this dropdown.
- `not_provided` is not a catalog Source Granularity. Do not add it.
- Do not prefix or suffix the spelling except the inactive marker.
- Do not show `granularity_key`, ObjectId, or `(form)` / `(call)` in the
  option text. Channel is implied by which page or by the Lead type filter.

Example Form Lead options (illustrative spellings; live values come from
the collection):

```text
Best Relocation Forms
Best Relocation Locals
GetMovers Forms
Main Site Forms
Paid Overflow
TBM Forms
TBM Prime Forms
Top10 Forms
```

Example Call Lead options:

```text
10best Inbounds
Best Relocation Inbounds
GetMovers Inbounds
Main Site Inbounds
TBM Prime Inbounds
Top10 Inbounds
```

If the catalog later adds or renames a feed, these lists change on the next
facets load. That is the point.

### 4.5 Cache and invalidation

Keep the short facets cache (5 minutes) for historical distinct scans.

`adminFacets.service.ts` **must** subscribe to
`onRegistryCacheInvalidation`. When the emitted keys include `"facets"`,
clear the production (and combined-derived) cache entry immediately.

Source Company, Source Granularity, Agent, and Merchant registry mutations
already emit `"facets"`. After this change that emission must actually
evict the structured catalog, not only sit unused.

Admin React Query keys for facets must be invalidated on the same
mutations the Operations Registry UI already performs, or share a stale
time no longer than the server TTL. Do not keep a second
`sourceCompanies.list` query on the listed surfaces.

---

## 5. How a selected option matches records

The dropdown is labeled Source Company. The query identity is the Source
Granularity.

### 5.1 Query parameter

Listed surfaces submit **`source_granularity_key`**. They stop submitting
`source_company` and `source` for this control.

Existing `source_company` browse/analytics matching remains only as
compatibility for old bookmarked URLs. New UI never writes it. When both
are present, `source_granularity_key` wins.

Analytics also stops submitting the extra `source` CRM-label filter from
these pages. The server may keep the param for other callers.

### 5.2 Production match (leads)

Exact match, case-insensitive, on either:

1. `source_granularity_key`, or
2. `source_granularity_id` when the catalog row has an id and the lead
   stores that id

Do **not** OR-match `source_company`, company snapshots, or `crm_label`.
Do **not** expand one Source Granularity to its sibling feeds.
Do **not** `orContains` / unanchored substring on this control.

A Form Lead stored as Top10 Forms with slug `top10_leads` matches **Top10
Forms** and does not match **Top10 Inbounds**.

Admin browse already has `orExact` for `source_granularity_key`. Use that
helper (or the id equality clause). Stop using `orContains` for the Source
Company dropdown.

### 5.3 Production match (bookings and cancellations in Analytics)

Reuse the existing derived fields, but filter them as a Source Granularity,
not a Source Company:

- `derived_source_granularity_key` from employee snapshot, then form key,
  then call key
- exact match to the selected `granularity_key`

Stop applying `sourceCompanyMatch` / `sourceCompanyRegexes` for the Source
Company dropdown. Alias expansion that turns `Top10 Forms` into
`top10_leads` is a defect for this control.

`query.source` remains a booking-`source` match for non-listed callers. The
listed Analytics UI does not send it.

### 5.4 Historical match

Prefer `source_granularity_key` exact when the option has a real key
(registry key or observed key). Otherwise exact-match
`source_granularity_label_snapshot` (and booking `source` only when that
is the only stored evidence and the option originated as a historical
distinct). No slug alias map.

A historical option whose submitted value is a stored `source_company`
slug matches that slug exactly on historical leads. It does not expand
through `SOURCE_LABEL_TO_COMPANY`.

### 5.5 Empty selection

No source clause. The page or report shows every stream.

### 5.6 Edit save

Form Lead and Call Lead edit **Source company** uses the same channel
options and submits `source_granularity_key` on the existing PATCH:

```text
PATCH /api/v1/form-leads/:id
{ "source_granularity_key": "top10_leads_form" }

PATCH /api/v1/call-leads/:id
{ "source_granularity_key": "tbm_leads_call" }
```

Do not send the CRM label as `source_company`. The existing
`updateFormLead` / `updateCallLead` path already accepts
`source_granularity_key` and must keep resolving it through
`resolveLeadSourceAssignment` to write `lead_source_company`,
`source_granularity_id`, `source_granularity_key`, `source_company`
(slug), and the three label snapshots. This specification does not invent
a new edit command.

Default selected option is the lead’s stored `source_granularity_key`.
Fall back to `source_granularity_id` against the catalog. Do not default
from `getFormLeadSourceLabel(slug)` / `getCallLeadSourceLabel(slug)`.

Duplicate pages stay read-only.

---

## 6. Surfaces

### 6.1 Form Leads and Duplicate Form Leads

`/form-leads` and `/duplicate-form-leads` share the Form Lead filter set
(`formLeadFilters` in `operational-resource-page.tsx`).

**Remove** the `Source granularity` dropdown.

**Replace** the `Source company` filter with:

```ts
{ key: "source_granularity_key", label: "Source company", type: "select" }
```

No static `options`. Options come from the Filter Catalog, form channel
only.

Keep the other existing filters (receiver agent, name, email, phone, ref,
booked, cancelled, past move date, move size). Those are not source
filters. Receiver agent and any future catalog dropdowns read the same
Filter Catalog.

Table **Source** cells already prefer snapshots. After this change they
must prefer `source_granularity_label_snapshot`, then `crm_source_label_snapshot`,
then catalog `owner_label` for the lead’s `source_granularity_key`, then
`source_company_label_snapshot`. They must not run
`getFormLeadSourceLabel(slug)` as the primary display.

Edit **Source company** field key becomes `source_granularity_key` with
the same Owner label. Same form-channel options.

### 6.2 Call Leads and Duplicate Call Leads

Same contract with call-channel rows. No `getCallLeadSourceLabel(slug)` as
the display or option source. Call filters keep job number and local type.

### 6.3 Analytics filters

`/analytics` keeps its six tabs and non-source filters (date range, lead
type, receiver agent, sales agent, merchant, move type, date bucket).

**Every tab** has one source control: **Source Company**, fed by the Filter
Catalog. Remove from `TAB_CONFIGS`:

- `source_granularity_key` as a second control (the remaining control
  submits that param under the Source Company label)
- `source` / CRM-label on Sales and Cancellations

`TAB_SPECIFIC_FILTERS` drops `source`. The one Source Company control
survives tab changes the same way `source_company` does today, but the
submitted key is `source_granularity_key`.

When Lead type is **Form leads** or **Call leads**, the dropdown shows only
that channel. Clearing Lead type restores both channels.

Selecting a Source Granularity applies `source_granularity_key` to every
report on the tab, including summary, revenue trend, agent performance,
geography, cancellations, receiver-agent reports, and CSV export.

Home `/` (`HomeOverview`) stays unfiltered. It does not gain a filter bar.
`overviewQuerySchema` stays `database_scope` only.

### 6.4 Adding the catalog to Analytics

“Add everything to Analytics” means the Analytics source dimension is the
full Filter Catalog, not the observed company-slug rollup.

#### 6.4.1 Reports that list source rows

These production reports must consume the complete catalog:

| Report / table | Today | After |
| --- | --- | --- |
| `source-company-performance` | Observed company + granularity leaves | Catalog-complete granularity leaves, nested under Source Company |
| `source-company-funnel` | same | same |
| `lead-cost` (overview payload) | same | same |
| Home `by_source_company` / lead-cost tables | same | same |
| `booking-cancellation-ratio` `by_source_company` | Company totals only | Same hierarchy: granularity leaves, parent = sum of children |
| `lead-source-performance` | `booked_leads.source` strings, top 75 | Same granularity hierarchy. Stop grouping by CRM `source`. |
| `receiver-agent-source-breakdown` | CRM `source_label` | `source_granularity_key` + catalog `owner_label`. Keep receiver-agent and lead-type dimensions. |

For each of those production reports:

1. Group observed leaves by `source_granularity_key` (bookings: derived
   key; leads: stored key).
2. Label every leaf with catalog `owner_label`.
3. **Include every catalog Source Granularity** in the current channel
   scope, including zero-activity rows for the selected date window.
4. Nest zeros and observed rows under their Source Company parent for the
   existing hierarchy table. Parent totals remain the sum of children.
5. Use registry `owner_label` for the parent company name. That parent is
   a grouping row, not a selectable filter option.

Zero-seed algorithm (production):

```text
candidates = catalog.source_granularities in current channel scope
for each candidate:
  if an observed leaf has the same granularity_key (case-insensitive):
    keep observed metrics; force label = catalog.owner_label
  else:
    emit a zero leaf (counts, money, rates = 0)
nest under catalog.source_companies
omit a parent that has no children in the current channel scope
```

Do not seed `unknown` as a catalog row. An observed leaf whose key is
missing from the catalog still appears, labeled with the stored snapshot
or `"Unknown"`.

Historical reports that cannot nest children still label rows with the
historical-distinct `owner_label` from the Filter Catalog. They do not
invent company children they cannot prove. If historical distincts include
real `source_granularity_key` values, nest those; otherwise keep
company-only rows.

Combined:

- Start from the production catalog-complete tree (zeros included).
- Merge historical extras by `granularity_key`. Registry `owner_label`
  wins.
- Historical-only keys become extra leaves under their matched parent, or
  a childless historical company when no parent exists.
- Combined CSV still emits leaf-or-childless-company, never both. After
  zero-seeding, production CSV therefore includes zero leaves.

#### 6.4.2 Reports that only filter

These reports grow no source rows. They still honor the one
`source_granularity_key` filter:

`summary`, `revenue-trend`, `agent-performance`, `cancellation-reasons`,
`local-vs-long-distance`, `geographic-lanes`, `pickup-state-performance`,
`delivery-state-performance`, `receiver-agent-performance`,
`receiver-agent-trend`.

#### 6.4.3 Labels, charts, CSV

CSV flatten stays leaf-or-childless-company, never both. Leaf names are
Source Granularity `owner_label` values. After this change,
`booking-cancellation-ratio` CSV uses the same flatten as
`source-company-performance` (overall row may remain first).
`lead-source-performance` CSV columns become the hierarchy fields
(`source_company`, `source_company_label`, `source_granularity_key`,
`source_granularity_label`, …), not `lead_source`.

Charts use the same leaf labels. Do not humanize keys when a catalog
label exists. Do not collapse the pie/bar to company rollups when
children exist — the leaf **is** the source the owner selected.

`loadProductionSourceLabelIndex` is folded into, or fed by, the Filter
Catalog so analytics labels and dropdown labels cannot drift.

### 6.5 Surfaces this issue does not rewrite

Bookings and Cancellations still have their own source controls and still
use hardcoded maps. They **must** consume the same Filter Catalog in a
follow-on change; this issue does not redesign those pages. The catalog
module is shared so that follow-on is a caller swap, not a second design.

Operations Registry, Granot names, employee booking options, and Custom
Sheet Reports already have their own catalog contracts. Do not fork a
fourth source list for them.

`GET /api/v1/admin/analytics/overview` and Agent Sales stay unfiltered by
this dropdown.

---

## 7. Admin client

`useFacetOptions` becomes a thin adapter over `facets.catalog`.

- Production and historical use the same shaped payload.
- Listed surfaces stop calling `fetchLeadSourceCompanies()` /
  `GET /api/v1/admin/source-companies` for these dropdowns.
- `formSourceOptions` / `callSourceOptions` are channel filters over
  `catalog.source_granularities` (`value: granularity_key`,
  `label: owner_label` plus inactive marker).
- Analytics `sourceCompanyOptions` is that same list (optionally
  channel-narrowed). Delete the extra `sourceGranularityOptions` control.
- Delete the `hasOption(field, "tbm_leads")` / `"Main Site Forms"` /
  `"Main Site Inbounds"` branching in `withFacetOptions`.
- Operational filter config for the four lead pages has one source select:
  `source_granularity_key`, label **Source Company**, no static `options`.
- Edit field config uses the same key and the same channel list.
- `resolveEditFieldValue` / `buildUpdatePayload` send
  `source_granularity_key`, not a CRM label as `source_company`.
- Stop importing `SOURCE_COMPANY_OPTIONS`, `FORM_LEAD_SOURCE_LABEL_OPTIONS`,
  and `CALL_LEAD_SOURCE_LABEL_OPTIONS` on these pages.

`AdminFacets` in `lib/api/admin.ts` gains `catalog`. Compatibility arrays
may remain typed until the bookings follow-on.

Hardcoded source maps in `lib/constants/domain.ts` may remain only as
temporary compatibility for bookings/cancellations until that follow-on.
They are not an allowed fallback when the Filter Catalog is empty in
production. An empty production catalog is a loading or registry failure,
not a reason to show `tbm_leads`.

Empty / error UI: show an empty dropdown and the existing load-error
treatment. Do not render slug fallbacks.

---

## 8. Server callers

| Caller | Required change |
| --- | --- |
| `adminFacets.service.ts` | Return `catalog` plus derived compatibility arrays. Production uses first-class lists with `includeInactive: true`. Subscribe to `"facets"` invalidation. |
| `adminBrowse.service.ts` | Exact Source Granularity match for the four lead resources. Stop contains-matching `source_company` for this control. Keep `source_company` as bookmark compatibility only. |
| `analyticsFilters.ts` | Source Company dropdown → `sourceGranularityMatch` only. Do not run `sourceCompanyRegexes` for it. |
| `sourceHierarchy.ts` | Seed hierarchy children from the Filter Catalog, then add observed metrics. Zeros remain. Reuse or fold `loadProductionSourceLabelIndex`. |
| `sourcePerformance.service.ts` | Performance, funnel, and `lead-source-performance` consume that complete hierarchy. `lead-source-performance` stops grouping by `booked_leads.source`. |
| `cancellationAnalytics.service.ts` | `booking-cancellation-ratio` `by_source_company` uses the same hierarchy. |
| `receiverAgentPerformance.service.ts` | Source breakdown groups by `source_granularity_key` and catalog `owner_label`. |
| `leadCost.service.ts` / `overview.service.ts` | Consume the complete hierarchy. Overview API stays unfiltered. |
| `analyticsExport.service.ts` | Export catalog `owner_label` on leaves. Flatten ratio and lead-source reports the same way as performance. |
| `analytics.validation.ts` | Keep `source_granularity_key`. Treat leftover `source_company` and `source` as compatibility only. |
| Lead PATCH (`formLead.service.ts` / `callLead.service.ts`) | No new command. Keep resolving submitted `source_granularity_key`. |

---

## 9. Invariants

1. One Filter Catalog payload feeds lead search, duplicate lists, Analytics
   filters, Analytics source rows, and Home overview source tables.
2. The only source filter on the listed surfaces is the Source Company
   dropdown.
3. That dropdown’s options are Source Granularities, never Source Company
   slugs.
4. Option text is `owner_label` exactly as stored, plus an inactive marker
   when needed.
5. Submitted identity is `granularity_key` (and id when matching stored
   leads).
6. A selected Form Source Granularity never returns Call Leads, and the
   reverse.
7. First-class `lead_source_granularities` is the production option
   authority. Embedded arrays are not.
8. Analytics source reports include every catalog Source Granularity in
   scope, including zeros.
9. Hardcoded `SOURCE_COMPANIES` / CRM-label maps are not production
   fallbacks for these surfaces.
10. Renaming a Source Granularity `owner_label` changes the next dropdown
    and chart label. Historical leads keep their snapshots. Matching still
    uses `granularity_key`.
11. Production facets cache evicts when registry mutations emit `"facets"`.

---

## 10. Acceptance

### Form / Call / Duplicate search

- Form Leads and Duplicate Form Leads show one source dropdown labeled
  **Source Company**.
- Its options are exactly the production form-channel Source Granularities,
  spelled as `owner_label`.
- Call Leads and Duplicate Call Leads do the same for call-channel rows.
- There is no **Source granularity** dropdown.
- Choosing **Top10 Forms** returns only Form Leads with that
  `source_granularity_key` / id. Top10 Inbounds leads are absent.
- Choosing **10best Inbounds** does not return TBM form leads.
- Inactive feeds appear and remain selectable.
- Creating a new Form Source Granularity in Operations Registry makes it
  appear on Form Leads and Analytics after cache invalidation, without a
  frontend enum change.
- Production with an empty catalog shows an empty dropdown / load error,
  not the old slug list.
- Edit **Source company** offers the same options, submits
  `source_granularity_key`, and leaves snapshots consistent with the
  selected feed.
- Table **Source** cells show the granularity `owner_label` snapshot (or
  catalog label for that key), not `Top 10 Forms` / `TBM Leads`.

### Analytics

- Every Analytics tab has the one Source Company dropdown and no second
  source control.
- Options are the same catalog rows, narrowed by Lead type when set.
- Source-performance, funnel, lead-cost, lead-source-performance,
  booking-cancellation-ratio by source, receiver-agent source breakdown,
  and Home overview source tables list every catalog Source Granularity in
  scope, labeled with `owner_label`, including zeros.
- Filtering Analytics to **TBM Prime Forms** does not include TBM Prime
  Inbounds bookings or leads.
- CSV leaf names match the dropdown spellings.
- Combined scope shows registry spellings plus any historical-only extras.
- Charts label leaves with those same spellings.

### Consistency

- The same `granularity_key` selected on Form Leads, Duplicate Form Leads,
  and Analytics (lead type = form) means the same Source Granularity.
- Table cells, chart labels, and dropdown text for a known key all show
  the same `owner_label`.

---

## 11. Test seams

The interface under test is the Filter Catalog and the match helpers.
Do not assert hardcoded slug lists or embedded `granularities[]`.

| Seam | Prove |
| --- | --- |
| `getAdminFacets("production")` | Structured catalog from first-class collections; inactive included; no slug/CRM arrays as authority; embeds unused. |
| `getAdminFacets("historical")` | Distinct-built rows; empty granularity distincts do not fail; overlay when a production key matches. |
| `getAdminFacets("combined")` | Registry `owner_label` wins; historical-only extras remain. |
| Registry mutation → facets cache | Creating/renaming/deactivating a Source Granularity evicts production cache. |
| `adminBrowse` form/call | `source_granularity_key=top10_leads_form` returns only that feed; `tbm_leads` substring does not leak through this control. |
| Bookmark compat | `source_company` alone still accepted; loses when both params are present. |
| `sourceGranularityMatch` | Bookings use derived key only; `sourceCompanyRegexes` not applied for this dropdown. |
| `nestSourceCompanyRows` + catalog seed | Production performance/funnel/lead-cost emit every catalog child, including zeros; parent totals = sum of children. |
| `lead-source-performance` | Groups by granularity, not `booked_leads.source`. |
| `booking-cancellation-ratio` | `by_source_company` has catalog children. |
| CSV flatten | Leaves (including zeros) or a childless company, never both; labels = `owner_label`. |
| Admin adapter | One Source Company control; no `SOURCE_COMPANY_OPTIONS` import on listed pages; edit PATCH body has `source_granularity_key`. |

Prior art: `analytics.service.test.ts` (prefix + CSV flatten),
`sourceHierarchy.test.ts` (labels), `admin.service.test.ts` (browse
filters). Several of those tests lock **current** company-alias and
production-children-only behavior; update them to the contracts above
rather than preserving the defect.

---

## 12. Migration and rollout

1. Server: expand `GET /api/v1/admin/facets` with `catalog`; include
   inactive; subscribe to `"facets"` invalidation; derive compatibility
   arrays from the catalog.
2. Server: browse exact Source Granularity match; keep `source_company`
   as bookmark compatibility.
3. Server: analytics filter uses `sourceGranularityMatch` only; seed
   catalog-complete source rows; switch lead-source-performance and
   booking-cancellation-ratio and receiver-agent source breakdown to
   granularity leaves.
4. Admin: `useFacetOptions` reads `catalog`; one Source Company control;
   edit PATCH sends `source_granularity_key`; table cells prefer
   granularity snapshot.
5. Keep `domain.ts` maps only for Bookings / Cancellations.
6. Observe: empty production catalog must surface as a load failure, not
   a silent slug fallback.
7. Follow-on (separate issue): Bookings / Cancellations consume the same
   catalog. Then delete the compatibility string arrays and the leftover
   hardcoded maps.

No production registry mutation is authorized by this specification.
No CONTEXT.md term change.

---

## 13. Out of scope

- Changing Source Company / Source Granularity write rules, CPL, or Granot
  connections.
- Deleting embedded `granularities[]` (already owned by the source-connections
  specification).
- Rewriting Bookings / Cancellations filters (follow-on, same catalog).
- Extension lead browse (`GET /api/v1/form-leads`) beyond keeping its
  existing `source_granularity_key` exact match honest.
- Adding new Analytics report types.
- Filtering Home overview or Agent Sales by this dropdown.
- Bad Call (still not implemented).
- CONTEXT.md term changes.

---

## 14. Implementation notes (not product rules)

The deletion test for the Filter Catalog: if each page kept building its
own source list, company-vs-feed mistakes and spelling drift would return
in every caller. The complexity belongs behind one facets/catalog
interface.

Preferred seam: expand `GET /api/v1/admin/facets` rather than adding a
second options route. Production adapter reads Operations Registry.
Historical adapter reads distincts. Combined merges them. Admin and
Analytics tests cross that same seam.

Suggested module split inside the facets service (private to the
implementation): `loadProductionCatalog`, `loadHistoricalCatalog`,
`mergeCatalogs`. Callers never see the split.

When implementing, update [`analytics.md`](./knowledge/services/analytics.md)
and the admin browse notes so they describe Source Granularity filtering
and catalog-complete source rows. Do not copy this specification into
those Service files.

---

## 15. Current-code findings that drive this specification

- First-class `lead_source_granularities` already exist and already feed
  `loadProductionSourceLabelIndex` and employee-booking options.
- `GET /api/v1/admin/facets` already exists but returns five string
  arrays. Production lists are **active-only** slugs / keys / `crm_label`s.
- Production admin dropdowns do not even use those arrays. They join
  `GET /api/v1/admin/source-companies` and read embedded `granularities[]`.
- `"facets"` is emitted by registry mutations and never consumed by the
  facets cache.
- Admin browse `source_company` is unanchored `orContains` across slug +
  three snapshots. Extension browse on the same fields is already exact.
- Analytics `source_granularity_key` match is already exact. The defect is
  the UI still submitting `source_company` / `source` and reports still
  grouping by company slug or CRM `source`.
- Historical lead schemas usually have no granularity key. Historical
  facets therefore cannot invent a full child tree.
- Lead PATCH already accepts `source_granularity_key`. The edit form sends
  `crm_label` as `source_company` instead.
- `lead-source-performance` is a different dimension (`booked_leads.source`)
  from the company/granularity tables. Receiver-agent source breakdown
  uses CRM `source_label`. Both must move onto the catalog leaf.
- Overview and Agent Sales APIs cannot be source-filtered today. Home
  stays that way. The Analytics overview **tab** is a different caller and
  does apply the one dropdown to its reports.
- Combined hierarchy CSV currently drops historical parent totals by
  emitting only production children. After zero-seeding, production leaves
  (including zeros) are the CSV rows; historical-only extras remain as
  additional leaves or childless companies.
