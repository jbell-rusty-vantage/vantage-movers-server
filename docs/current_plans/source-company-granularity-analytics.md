# Source Company Granularity Analytics — Implementation Plan

Status: ready to implement  
Surfaces: Overview home + Analytics Lead Sources (production-first)  
Repos: `vantage-main-server` analytics APIs, `vantage-admin` overview/analytics UI

## 1. Outcome

Make Source Company breakdowns show **parent company → child granularity** the way the Operations Registry already models them.

Example (production):

```
TBM Prime Leads                 12 bookings · $48,000 deposits
  TBM Prime Forms                8 bookings · $31,000
  TBM Prime Inbounds             4 bookings · $17,000
```

Same hierarchy for lead-cost tables (leads + CPL dollars).

Owners should see Forms vs Inbounds (and any other active granularities) without filtering one key at a time.

**Critical constraint:** Historical cannot be treated like production for this feature. See §2. Granularity children are **production-only**.

## 2. Historical vs production — do not treat the same

Historical is a **separate Mongo database** with a **reduced model set**. It is not a second copy of the production domain.

| | Production | Historical |
|---|---|---|
| Database | Primary app DB (e.g. `vantagemovers`) | `vantagemovershistorical` via `useDb` |
| Registration | Full production models + Operations Registry | `registerHistoricalModels()` only |
| Models present | Form/Call/Booked/Cancelled leads, customers, agents, **plus** `LeadSourceCompany`, `LeadSourceGranularity`, CPL, reporting, etc. | **Only** Agent, Customer, FormLead, CallLead, BookedLead, CancelledLead |

Source of truth for the historical surface:

- `src/models/historical/index.ts` — `HISTORICAL_DATABASE_NAME`, `registerHistoricalModels`
- No registry collections are registered there
- Dashboard/historical analytics are partly **deprecated relative to production**; keep company rollups working, but do not extend historical to full Source Company hierarchy

### 2.1 Field reality (why Multi-Index cannot work on historical)

Production form/call/booked leads carry registry-linked identity, for example:

- `source_company` (slug)
- `lead_source_company` (ObjectId)
- `source_granularity_id` / `source_granularity_key`
- `source_company_label_snapshot` / `source_granularity_label_snapshot`
- `crm_source_label_snapshot` (where applicable)

Historical form/call leads (`src/models/historical/FormLead.ts`, `CallLead.ts`) carry approximately:

- `source_company` (slug enum/string)
- `source_company_site` (optional legacy)

They do **not** have granularity keys, registry ObjectIds, or label snapshots. There is nothing durable to group into “TBM Prime Forms” vs “TBM Prime Inbounds” under a parent without inventing data.

### 2.2 Hard rules for this plan

1. **Never** assume historical leads can `$group` by `source_granularity_key` the way production does.
2. **Never** join historical leads to `lead_source_companies` / `lead_source_granularities` as if those collections lived in `vantagemovershistorical` — they do not.
3. **Never** backfill or fabricate granularity children from form-vs-call heuristics in v1 just to make the UI look symmetric (that would misrepresent registry grain and Best Relocation’s multi-form children).
4. For `database_scope=historical`: company-level rows only; `granularities: []` (or omit). Labels from slug / `SOURCE_COMPANY_CONFIGS` only.
5. For `database_scope=combined`: merge **company** metrics across scopes; attach `granularities` **only from the production concrete scope**. Do not invent children for the historical half.
6. Overview production-only blocks (`last_7_days`, lead cost) stay gated on `production` as today — do not “enable” them on historical by mapping through registry.
7. Admin UI copy must not imply historical has Forms/Inbounds breakdowns.

### 2.3 Implementation branching

In analytics services (`getAdminModels(scope)`, `concreteScopes`):

- When `scope === "production"`: dual-dimension aggregate + registry label index + nest children.
- When `scope === "historical"`: keep existing company-only `$group` on `source_company`; return empty `granularities`.
- When building combined payloads: nest children on production rows before/while merging; strip or ignore any accidental historical granularity fields.

If shared helpers accept a `supportsSourceGranularity: boolean` (or `scope`), default it from concrete scope — **do not** infer support from “source_company is present.”

## 3. Why this is needed (product gap on production)

| Layer | Today |
|---|---|
| Registry (`lead_source_companies` / `lead_source_granularities`) | Parent/child exists (`tbm_prime_leads` → `tbm_prime_leads_form` / `_call`) — **production DB only** |
| Production leads | Carry `source_company`, `source_granularity_key`, label snapshots |
| Historical leads | `source_company` only — **no granularity identity** |
| Reporting UI / `source_performance` | Already selects company → granularities (production canonical data) |
| Overview + Analytics | Aggregate **only** by `source_company` |

Analytics already accepts `source_granularity_key` as a **filter**, not as a row dimension. Overview `SourceCompanyTable` is a flat company list. Funnel exposes `form_leads` / `call_leads` as columns on the company row — close, but not registry-labeled child rows. Funnel channel columns are **not** a substitute for historical granularity (and must not be used to fake historical children).

## 4. Non-goals

- Do not retire historical analytics; keep company-level rollups where historical data exists.
- Do not migrate, attach, or mirror Source Company registry models into `vantagemovershistorical`.
- Do not schema-expand historical FormLead/CallLead for granularity as part of this plan.
- Do not rebuild Reporting’s full `source_performance` dataset for Overview.
- Do not change booking/lead write paths or registry schemas.
- Do not make Multi-Index the default chart series in Analytics (table first; charts can stay company-level).

## 5. Scope rules (summary)

| `database_scope` | Parent company rows | Granularity children |
|---|---|---|
| `production` | Yes | Yes (lead granularity keys + registry / snapshot labels) |
| `historical` | Yes (`source_company` slug only) | **None** — always empty; do not invent |
| `combined` | Merged company rows | **Production children only** |

Overview extras that already gate on production (`last_7_days`, lead cost) stay production-only.

## 6. Target response shapes

### 6.1 Shared nested row (server + admin types)

```ts
type SourceGranularityMetricRow = {
  source_granularity_key: string;
  source_granularity_label: string;
  channel?: "form" | "call" | string | null;
  // metric fields depend on report (sales vs lead cost vs funnel)
};

type SourceCompanyMetricRow = {
  source_company: string;
  source_company_label: string;
  // rolled-up metrics at company level
  granularities: SourceGranularityMetricRow[];
};
```

### 6.2 Overview — `GET /api/v1/admin/analytics/overview`

Keep existing totals / top agents. Extend source breakdowns:

**Sales rows** (`last_7_days.by_source_company`):

```ts
{
  source_company: "tbm_prime_leads",
  source_company_label: "TBM Prime Leads",
  bookings: 12,
  total_deposit_amount: 48000,
  granularities: [
    {
      source_granularity_key: "tbm_prime_leads_form",
      source_granularity_label: "TBM Prime Forms",
      channel: "form",
      bookings: 8,
      total_deposit_amount: 31000
    },
    {
      source_granularity_key: "tbm_prime_leads_call",
      source_granularity_label: "TBM Prime Inbounds",
      channel: "call",
      bookings: 4,
      total_deposit_amount: 17000
    }
  ]
}
```

**Lead cost rows** (`all_time.lead_cost.by_source_company` and `last_7_days.lead_cost.by_source_company`):

```ts
{
  source_company: "tbm_prime_leads",
  source_company_label: "TBM Prime Leads",
  lead_count: 40,
  total_lead_cost: 1900,
  unresolved_cpl_count: 0,
  granularities: [
    {
      source_granularity_key: "tbm_prime_leads_form",
      source_granularity_label: "TBM Prime Forms",
      channel: "form",
      lead_count: 25,
      total_lead_cost: 1250,
      unresolved_cpl_count: 0
    },
    /* … */
  ]
}
```

Backward compatibility: keep top-level company metric fields. Older clients that ignore `granularities` / labels still work.

Optional later (same shape): all-time sales-by-source for production. Not required for v1 of this plan; last-7 + lead-cost tables are the Overview priority.

### 6.3 Analytics — Lead Sources reports

Extend production payloads for:

| Report key | Change |
|---|---|
| `source-company-performance` | Nest `granularities[]` under each company item (bookings, deposits, binders, rates as applicable) |
| `source-company-funnel` | Nest children with lead / booking reconciliation metrics; keep company-level `form_leads` / `call_leads` for chart stability **or** derive chart series from children |
| `lead-cost` (if shown by source on Overview path already via overview; analytics lead-cost report if present) | Same nested lead-cost shape |

Prefer additive nesting over a brand-new report key so filters, export, and tab wiring stay stable. If nesting risks chart breakage, add query flag:

`include_granularity=true` (default `true` for production overview internals; default `false` for existing analytics chart endpoints until admin opts into table view).

**Recommendation:** default nested rows on for Overview always; for Analytics, return nested rows always but keep chart flatteners company-only (`granularities` ignored by pie/bar).

## 7. Server implementation

### 7.1 Building blocks (already exist)

| Piece | Location |
|---|---|
| `derived_source_company` / `derived_source_granularity_key` | `analyticsFilters.ts` (`sourceCompanyExpression`, `sourceGranularityExpression`, `bookedLeadPrefix`) |
| Company-only sales group | `overview.service.ts` → `getSalesBySourceCompany` |
| Company-only lead cost | `leadCost.service.ts` → `leadCostRowsBySource` |
| Company performance / funnel | `sourcePerformance.service.ts` |
| Registry list | `operationsRegistry/sourceRegistry.ts`, models `LeadSourceCompany` / `LeadSourceGranularity` |
| Domain labels | `config/domain/sources.ts` |

### 7.2 Aggregation strategy

Dual-dimension leaf aggregate applies **only when `supportsSourceGranularity`** (production concrete scope). Historical must use company-only `$group` (§2).

1. **Leaf aggregate (production only)** — `$group` by both dimensions:

```js
_id: {
  source_company: "$derived_source_company", // or "$source_company" on form/call
  source_granularity_key: {
    $ifNull: ["$derived_source_granularity_key", "unknown"]
  }
}
```

Use the same money/count expressions as today.

2. **Nest in process** — fold leaf rows into `Map<company, { metrics, granularities[] }>`.

3. **Label resolution** (production only — registry lives on the production DB):

   Preference order per row:
   1. Lead snapshot labels when grouping from booked joins that expose them (`source_company_label_snapshot`, `source_granularity_label_snapshot`) if available in the pipeline.
   2. Else registry lookup: `company_slug` / `granularity_key` → `owner_label` (or `name` / `crm_label`).
   3. Else humanize slug (`tbm_prime_leads` → `Tbm Prime Leads`) — last resort.

   Load registry once per request (`listSourceCompanies` + granularities), index by slug/key. Do not N+1. **Do not** call registry loaders against the historical connection.

4. **Company rollup** — sum child metrics; do not re-query for parent totals (avoids double-count drift). Parent totals must equal sum of children for additive metrics (bookings, deposits, lead_count, lead_cost). Rates (`booking_rate`, etc.) recompute from rolled counts.

5. **Unknown / missing granularity** (production) — keep a child row with key `unknown` (or omit if count is 0). Do not drop leads from company totals.

6. **Historical** — company-only `$group` on `source_company`; `granularities: []`; company label from slug / `SOURCE_COMPANY_CONFIGS` only. No registry. No form/call heuristic children (§2).

### 7.3 Files to change (server)

| File | Work |
|---|---|
| `src/services/analytics/sourceHierarchy.ts` (**new**) | Shared nest + label helpers: `nestSourceCompanyRows`, `resolveSourceLabels`, types |
| `src/services/analytics/overview.service.ts` | Dual-dimension sales aggregate; nest for `by_source_company` |
| `src/services/analytics/leadCost.service.ts` | Dual-dimension lead-cost aggregate; nest `by_source_company` |
| `src/services/analytics/sourcePerformance.service.ts` | Nest performance + funnel items |
| `src/services/analytics/analyticsMerge.ts` | Merge keys: company-only for historical/combined parents; when merging production trees, merge children by `source_granularity_key` |
| `src/services/analytics/analyticsExport.service.ts` | Flatten nested rows to CSV (company + granularity columns) |
| `src/validation/v1/analytics.validation.ts` | Optional `include_granularity` if used; no breaking query changes required if always additive |
| `overview.service.test.ts`, `leadCost.service.test.ts`, source performance tests | Fixtures with two granularities under one company |

### 7.4 Helper sketch

```ts
// sourceHierarchy.ts
export function nestBySourceCompany<TLeaf extends {
  source_company?: string;
  source_granularity_key?: string;
}>(
  leaves: TLeaf[],
  labels: SourceLabelIndex,
  rollup: (leaves: TLeaf[]) => Omit<SourceCompanyMetricRow, "granularities" | "source_company" | "source_company_label">,
  mapLeaf: (leaf: TLeaf) => SourceGranularityMetricRow,
): SourceCompanyMetricRow[]
```

Keep rollup pure and unit-tested with in-memory leaf arrays (no Mongo).

### 7.5 Label index

```ts
type SourceLabelIndex = {
  companyBySlug: Map<string, { label: string }>;
  granularityByKey: Map<string, { label: string; channel?: string; companySlug: string }>;
};
```

Populate from registry in the **production** path only. Cache in-request only (no global TTL required for v1). Historical path must not require this index for children.

## 8. Admin implementation

### 8.1 Types — `vantage-admin/lib/api/admin.ts`

Extend `OverviewSourceRow`, `OverviewLeadCost.by_source_company`, and analytics row typing to include:

- `source_company_label?`
- `granularities?`

Keep optional fields so partial responses do not break.

### 8.2 Overview UI — `home-overview.tsx`

Replace flat `SourceCompanyTable` with a Multi-Index table component (same file or `components/dashboard/source-company-hierarchy-table.tsx`):

**Behavior**

- Parent row: company label (prefer `source_company_label`, fallback `formatSourceLabel(source_company)`), rolled metrics, subtle weight/background.
- Child rows: indented granularity label, metrics aligned in the same columns.
- Expand/collapse optional; default **expanded** so Forms/Inbounds are visible without a click (matches “clear about granularity”).
- Empty children: show parent only (historical / no keys).
- Loading / empty states unchanged.

**Where to use**

1. All Time → Lead Cost by Source  
2. Last 7 Days → Sales by Source Company  
3. Last 7 Days → Lead Cost by Source  

Copy updates:

- “By source company and Forms / Inbounds granularity (production).”
- Do not show these Multi-Index source tables when `scope !== "production"` (existing gate). Historical overview must not claim granularity breakdowns.

### 8.3 Analytics UI — `analytics-dashboard.tsx`

Lead Sources tab:

- Table view: render Multi-Index when `granularities?.length` (production). Historical/combined with empty children → flat company rows only.
- Chart view: continue flattening company-level metrics only (ignore children) so pie/bar deposit mix stays readable.
- Filter `source_granularity_key` remains meaningful on production; on historical it will typically no-op / empty facets — do not imply otherwise in UI copy.

Export CSV: use server flatten (company + granularity columns). If client-side export exists, mirror that flatten; omit granularity columns when children are empty.

### 8.4 Files to change (admin)

| File | Work |
|---|---|
| `lib/api/admin.ts` | Nested types |
| `components/dashboard/source-company-hierarchy-table.tsx` (**new**, preferred) | Reusable Multi-Index table |
| `components/dashboard/home-overview.tsx` | Wire hierarchy table |
| `components/analytics/analytics-dashboard.tsx` | Table renderer + copy; chart flatten stays company-level |
| Tests colocated if present (`*.test.ts(x)`) | Hierarchy rollup display / label fallback |

## 9. Implementation sequence

### Phase A — Server nesting (Overview path)

1. Add `sourceHierarchy.ts` + unit tests for nest/rollup/labels **and** historical empty-children path.  
2. Extend `getSalesBySourceCompany` + lead-cost aggregation to leaf grain on production only; nest.  
3. Update overview tests for production tree **and** historical company-flat.  
4. Manual check: `GET .../analytics/overview?database_scope=production` shows TBM Prime → Forms / Inbounds; `database_scope=historical` has no fabricated children.

### Phase B — Overview UI

1. Hierarchy table component.  
2. Swap three Overview tables (still production-gated).  
3. Visual check: production Multi-Index vs historical scope (no false granularity claims).

### Phase C — Analytics Lead Sources

1. Nest `source-company-performance` + `source-company-funnel` for production concrete scope.  
2. Table view hierarchy; charts unchanged.  
3. CSV export flatten.  
4. Combined merge: production children only (§2).

### Phase D — Polish

1. Consistent labels with registry `owner_label` (e.g. “TBM Prime Forms”).  
2. Copy: granularity breakdowns are production-only; historical is company-level.  
3. Optional: all-time sales-by-source Multi-Index on Overview (production only).

## 10. Test plan

### Server

- Two granularities under one company → parent totals = sum of children for additive fields.  
- Missing granularity key → `unknown` child; parent still includes counts.  
- Historical scope → company rows only, `granularities: []`; no registry dependency.  
- Historical models path does not query `lead_source_granularities`.  
- Lead cost unresolved CPL rolls correctly at parent and child (production).  
- Funnel rates recomputed from rolled numerators/denominators.  
- Combined merge does not duplicate or invent historical children.

### Admin

- Overview production: Multi-Index visible with Forms/Inbounds labels.  
- Overview historical: no production extras (existing); no fake children.  
- Analytics table shows children on production; pie chart still one slice per company.  
- Filter by one granularity key still loads without error on production.

### Manual QA (production data)

Known registry pair to verify:

| Company slug | Children |
|---|---|
| `tbm_prime_leads` | `tbm_prime_leads_form` (TBM Prime Forms), `tbm_prime_leads_call` (TBM Prime Inbounds) |
| `main_site` | `main_site_form`, `main_site_call` |
| `best_relocation_leads` | form local / form long-distance / call (three children) |

Best Relocation has **three** granularities — UI must not assume exactly two children.

## 11. Acceptance criteria

1. Production Overview last-7 sales table shows company parent rows with expandable/visible granularity children and aligned metrics.  
2. Production Overview lead-cost tables (all-time + last-7) use the same hierarchy.  
3. Child labels match registry owner labels (Forms / Inbounds / Locals, etc.), not raw keys.  
4. Parent additive metrics equal the sum of children.  
5. Historical scope does not error, does not query registry/granularity collections, and does not claim Forms/Inbounds (or any) child breakdowns.  
6. Analytics Lead Sources table shows the hierarchy on production; existing company charts remain usable.  
7. No regression to Overview totals, top agents, or non-source analytics tabs.

## 12. Risks and decisions

| Risk | Mitigation |
|---|---|
| Chart double-encoding if children plotted | Flatten company-only in chart path |
| Label drift vs CRM | Prefer registry `owner_label`; snapshots as secondary |
| Treating historical like production | §2 hard rules; company-only path; no heuristic children |
| Combined scope merge complexity | Production children only; document limitation |
| Best Relocation 3 children | Design table for N children, not Forms/Inbounds hardcode |
| Performance of dual group + registry fetch | Single registry load on production only; same indexes as current company group |

**Open decision (default chosen):** always return nested `granularities` on Overview (empty on historical); Analytics charts ignore children. Alternative is `include_granularity` query flag — only add if a client breaks.

## 13. Out-of-band notes

- Reporting Google delivery / destination health is a separate track; this plan does not depend on it.
- Reporting already has company → granularity selection for exports; this work brings Overview/Analytics to the same mental model, not the same delivery pipeline.
- Historical DB consolidation / backfill of granularity onto historical leads is **out of scope**; if that ever happens, revisit this plan rather than silently enabling children.

## 14. Done definition

Phases A–C merged with tests green; production Overview clearly answers “how much did TBM Prime Forms vs Inbounds do?” without leaving the page or applying a granularity filter — without implying historical can answer the same question.
