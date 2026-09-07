# Prove These Source Keys Are Live And Nested, Freeze The Snapshot, Then Gather Only Those Companies — And Only Named Granularities Under Their Own Company — Never Invent A Company — Never Use An Inactive Card — Never Narrow A Sister Company — operational story

- Status: recommended
- Service: `reporting` (Wave A, in-progress)
- Pass: 25 of this service — `registryFilters.ts`
- Remaining in this service: remaining `google/*` adapters, remaining `live/*` harness
- Target: `src/services/reporting/registryFilters.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (primary code is `reporting.service.ts`. Role: Owner-designed, checksum-bound reports. Happy path: preview → immutable revision → two-step confirmed run → **worker write**. Knowledge names Source Company / optional granularity on `source_performance` and says unknown filter keys reject — it never names this file, `validateRegistrySelection`, `registryMongoPredicate`, `invalid_registry_selection`, `registry_snapshot`, or sibling `registryHierarchyPredicate` — do not add a Reporting Service file in this rename so “the Service sentence wins”). Distinct from already-recommended preview / freeze / estimate / confirm: [`reporting-reporting.md`](reporting-reporting.md) (**asks** Wave B `validateReportingDraft`, which **asks** `validateRegistrySelection`; save persists `registry_snapshot`; estimate **asks** `revisionToQueryInput` frozen snapshot and does **not** re-**ask** prove). Distinct from already-recommended gather / paint: [`reporting-canonical-reporting.md`](reporting-canonical-reporting.md) (`countCanonicalCohort` / `loadCanonicalLeadCohort` **ask** `registryMongoPredicate` on Form Lead / Call Lead `timestamp` queries; orphans **ask** sibling `registryHierarchyPredicate` — this file never owns employee-snapshot / submission / cancellation paths). Distinct from already-recommended Eastern window: [`reporting-timezone.md`](reporting-timezone.md) (`halfOpenDatePredicate` is the clock; this file is company / granularity). Distinct from already-recommended Operations Registry book: [`operations-registry-source-registry.md`](operations-registry-source-registry.md) (`listSourceCompanies` / `listSourceGranularities` / activate — this file **asks** `LeadSourceCompany` / `LeadSourceGranularity` models with `active: true` and never writes a card). Distinct from already-recommended hint stamp: [`operations-registry-source-resolution.md`](operations-registry-source-resolution.md) / [`leads-source-company.md`](leads-source-company.md) (Lead attribution **asks** `resolveSourceAttribution` — this file never stamps a Lead). Distinct from already-recommended Admin Filter Catalog: [`admin-filter-catalog.md`](admin-filter-catalog.md) (desk **asks** lists with `includeInactive: true` — this file refuses inactive). Distinct from already-recommended Analytics chips: [`analytics-analytics-filters.md`](analytics-analytics-filters.md) (`bookedLeadPrefix` / `leadMatchForQuery` **ask** Filter Catalog chips — not `registry_snapshot`). Distinct from Wave B `src/validation/reporting.validation.ts` (`sourceSelection` Zod `companyKeys` 1..50, `granularityKeys` 0..200, slug regex; `validateReportingDraft` **asks** prove after window / columns). Distinct from catalog type: `catalog/types.ts` `RegistrySelectionSnapshot` — this file returns it, does not own it. This is not Admin Analytics and not Sheet Sync. This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets / Source Company / Source Granularity — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR).
- Callers: Wave B `src/validation/reporting.validation.ts` (**asks** `validateRegistrySelection(draft.sources)`). Already-recommended `reporting.service.ts` (**asks** `validateReportingDraft` on preview and save; persists `registry_snapshot: validated.registry`; `toQueryInput` copies `validated.registry`; `revisionToQueryInput` reads frozen `revision.registry_snapshot` — estimate / confirm do **not** **ask** prove). Already-recommended `query/canonicalReporting.ts` (**asks** `registryMongoPredicate(input.registry)` on Form / Call `timestamp` count and load). `live/liveTestRunFactory.ts` writes `registry_snapshot` from a fixture query input — does **not** import this file. Tests: `reporting.test.ts` **asks** `validateReportingDraft` for unknown filters / window days / 101 agent keys — 51 company keys fail Zod `max(50)` **before** this file. “Every orphan predicate narrows granularities per parent company” **asks** `registryHierarchyPredicate`, **not** `registryMongoPredicate`. `reportingDelivery.test.ts` does **not** import this file. **No runtime caller** of `unique`.
- Seams callers need: prove-these-keys-are-live-and-nested (`validateRegistrySelection`) vs gather-only-those-leads (`registryMongoPredicate`). The live-prove / frozen-snapshot **seam** exists because preview / save **ask** prove against today’s active book; estimate / worker **ask** `registryMongoPredicate` on frozen `registry_snapshot` and must not re-prove so a later archive cannot rewrite yesterday’s revision. The company-wide / per-company-narrow **seam** exists because named granularities only `$in` on that company’s `$or` branch; a sister company with no named keys stays whole. The lead-cohort / orphan **seam** exists because `registryMongoPredicate` hardcodes `lead_source_company` + `source_granularity_key`; sibling `registryHierarchyPredicate` takes `companyPath` / `granularityPath` / `companyValue`. The Zod-shape / live-book **seam** exists because Wave B `sourceSelection` bounds slug shape and count; this file proves those keys are live and nested. There is no begin / complete Domain Command **seam**. There is no Google write **seam**. There is no Analytics **seam**. There is no Sheet Sync **seam**. There is no Registry-write **seam**.
- Split later (only if the file outgrows one sitting): this ~80-line file is one sitting if you read it as prove these source keys are live and nested, freeze the snapshot, then gather only those companies — and only named granularities under their own company — never invent a company — never use an inactive card — never narrow a sister company. Do **not** split into `validate.ts` / `predicate.ts` / `create.ts` / `update.ts` / `delete.ts`. Do **not** pull Wave B Zod, sibling `registryHierarchyPredicate`, Operations Registry lists, Lead attribution, Admin Filter Catalog, Analytics chips, preview persist, or gather / paint here so “one registry file owns the company.” If it later splits: `proveTheseSourceKeysAreLiveAndNested.ts` / `gatherOnlyThoseCompaniesAndNamedGranularities.ts` only as later story files, never CRUD.

`validateRegistrySelection` / `registryMongoPredicate` are executor mechanics. The owner question is: *I picked these Source Companies, and maybe these Source Granularities. Refuse if a company key is missing, duplicated, unknown, or inactive. Refuse if a granularity key is duplicated, unknown, inactive, or not under one of those companies. Remember the live ids and labels, sorted by key. Later, when we gather Form Leads and Call Leads, those companies count. If I named granularities for a company, only those keys count for that company. A sister company I also picked stays whole. Do not invent a company. Do not look at archived cards. Do not write the revision. Do not write Google. Do not run Analytics.*

Already-recommended preview / freeze, gather / paint, Operations Registry book, Lead attribution, Admin Filter Catalog, and Analytics chips already live in other **modules**. Wave B Zod `sourceSelection` stays Wave B. Sibling `registryHierarchyPredicate` stays gather. Do not pull those in.

## What this file actually does

Two operations of one “prove these source keys are live and nested, freeze the snapshot, then gather only those companies — and only named granularities under their own company” story, not “a registry filter helper,” and not Operations Registry write or Lead attribution:

1. **Prove these source keys are live and nested, then freeze the snapshot** — `validateRegistrySelection`. Fold keys (`trim` + lowercase + drop empty). Company keys must be nonempty and unique versus the raw array length — else `invalid_registry_selection` “Company keys are required and must be unique.” Granularity keys must be unique versus the raw array length — else “Granularity keys must be unique.” Load active Source Companies by `company_slug $in` folded keys. Count must match — else “Unknown or inactive Source Company key.” Load active Source Granularities by `granularity_key $in` only when keys were named. Count must match, and every row’s `source_company` must sit in the selected company-id set — else “Granularity must be active beneath a selected company.” Return `{ companies, granularities }` with ids, keys, labels (`owner_label || name` on companies; `owner_label` on granularities), `companyId` on each granularity, both lists sorted by key. This file does not persist `registry_snapshot`. Preview and save **ask** this; estimate and confirm read the frozen copy.

2. **Gather only those companies — and only named granularities under their own company** — `registryMongoPredicate`. Build `{ $or: companies.map(...) }`. Each branch is `{ lead_source_company: company.id }`. If that company has named granularities, add `source_granularity_key: { $in: those keys }`. A sister company with no named keys stays `{ lead_source_company: sister.id }` with no `$in`. Canonical count and load **ask** this on Form Lead / Call Lead `timestamp` queries. Orphan Bookings / recon / conflicts / cancellations **ask** sibling `registryHierarchyPredicate` with other paths. This file does not list sheets. This file does not write Google.

`unique` is a fold of prove. It is not a third owner operation. Do not export it. Do not teach Wave B Zod to **ask** `unique` instead of the slug regex.

## Organization

Keep one file. This is the screenplay for “prove these source keys are live and nested, freeze the snapshot, then gather only those companies.” Wave B Zod, sibling orphan predicate, Operations Registry lists, Lead attribution, Admin Filter Catalog, Analytics chips, and preview persist already live in deeper **modules**. Do not pull those in. Do not invent a `ReportingRegistryFiltersService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second live-book **adapter** beside this prove. Do not invent a second lead-cohort **adapter** beside `registryMongoPredicate`. Do not invent a second orphan **adapter** beside sibling `registryHierarchyPredicate`.

Do not split prove / gather into CRUD files. Prove stays with gather because preview **asks** prove and the worker **asks** gather on the same snapshot shape. Do not start `listSourceCompanies` from this file so “one registry owns prove.” Do not start `registryHierarchyPredicate` from this file so “one predicate owns every path.” Do not re-prove on `prepareManualRun` so “we always use today’s active book.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `validateRegistrySelection` | `proveTheseSourceKeysAreLiveAndNested` | Wave B `validateReportingDraft` on preview and save |
| `registryMongoPredicate` | `gatherOnlyThoseCompaniesAndNamedGranularities` | canonical count / load of Form and Call Leads |

Keep the old names as one-line aliases until Wave B `reporting.validation.ts` and `query/canonicalReporting.ts` migrate. Do not make estimate learn `proveTheseSourceKeysAreLiveAndNested` as a second live lookup. Do not make orphan count learn `gatherOnlyThoseCompaniesAndNamedGranularities` as `registryHierarchyPredicate`. Do not persist a new `invalid_registry_selection` string in this rename.

**No class for the workflow.** The type that *does* earn a name is the snapshot prove already returns (owned by `catalog/types.ts` — do not move it here):

```ts
type FrozenSourceSelection = {
  companies: Array<{ id: string; key: string; label: string }>
  granularities: Array<{ id: string; key: string; label: string; companyId: string }>
}
```

That is the handoff from “the owner named these slugs” to “canonical count / load may **ask** `gatherOnlyThoseCompaniesAndNamedGranularities`.” Do **not** put destination snapshot or Eastern window on this type. Do **not** put Analytics chips on this type. Do **not** put `includeInactive` on this type.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// registryFilters.ts
// The owner named these Source Companies,
// and maybe these Source Granularities.
// Refuse if a company key is missing, duplicated,
// unknown, or inactive.
// Refuse if a granularity key is duplicated, unknown,
// inactive, or not under one of those companies.
// Remember the live ids and labels, sorted by key.
// Later, gather Form Leads and Call Leads for those companies.
// Named granularities narrow only their own company.
// A sister company stays whole.
// Do not invent a company. Do not look at archived cards.
// Do not write the revision. Do not write Google.

// ── 1. Prove these keys are live and nested ───────────────

export async function proveTheseSourceKeysAreLiveAndNested(input)
  // fold keys: trim, lowercase, drop empty
  // refuse empty or duplicate company keys
  // refuse duplicate granularity keys
  // load active companies by company_slug
  // refuse unknown or inactive company
  // load active granularities by granularity_key when named
  // refuse a granularity that is missing, inactive, or under another company
  // return ids, keys, labels, sorted by key

export const validateRegistrySelection = proveTheseSourceKeysAreLiveAndNested

function foldSourceKeys(values)
  // trim, lowercase, drop empty, unique by Set

// ── 2. Gather only those companies ────────────────────────

export function gatherOnlyThoseCompaniesAndNamedGranularities(snapshot)
  // $or one branch per company
  // named granularities $in only on that company's branch
  // sister company with no named keys stays whole

export const registryMongoPredicate = gatherOnlyThoseCompaniesAndNamedGranularities
```

Read the preview path out loud: *Wave B already checked slug shape and count. This file folds the keys, loads today’s active companies, refuses an unknown or inactive slug, loads named granularities, refuses one that is not active under a selected company, and returns ids and labels sorted by key. Preview copies that snapshot onto the query. This file never wrote the revision.*

Read the save path out loud: *Save asks prove again against today’s book. The revision stores `registry_snapshot`. Estimate and the worker read that frozen copy. They do not ask prove again. An archive tomorrow does not rewrite yesterday’s revision.*

Read the gather path out loud: *Canonical count and load spread this snapshot onto Form Lead and Call Lead `timestamp` queries. Company A with named `forms` is `lead_source_company` plus `source_granularity_key $in ["forms"]`. Company B with no named keys is only `lead_source_company`. Orphans ask the sibling predicate with other paths. This file never saw an employee snapshot.*

That is the operation. `validateRegistrySelection` is not.

## Precise logic I would tighten while renaming

These are the smells I would keep as comments or tickets, not silent behavior changes.

1. **Sibling `$or` is almost this file.** `registryHierarchyPredicate` in `query/canonicalReporting.ts` builds the same per-company `$or`, with configurable paths and `companyValue` id|key. The orphan test already locks “named granularities narrow only their parent; sister stays whole.” Do not silently move the sibling here so “one predicate owns every path.” Lead cohort hardcodes `lead_source_company` / `source_granularity_key`. Orphans need `employee_source_snapshot.*`, `submission.source_assignment.*`, and cancellation join paths.

2. **Live prove vs frozen snapshot.** Preview and save **ask** prove. Estimate and confirm **ask** `revision.registry_snapshot`. Do not silently re-prove on `prepareManualRun` so “we always use today’s active book.” A later archive must not rewrite yesterday’s revision.

3. **One company error for empty-after-fold and duplicates.** Fold drops blanks, then compares unique length to raw length. All-whitespace and `["a","a"]` share “Company keys are required and must be unique.” Do not silently split those letters so “the message is honest” in this rename.

4. **One granularity error for unknown, inactive, and wrong parent.** Count miss and `source_company` outside the selected id set share “Granularity must be active beneath a selected company.” Do not silently split those letters in this rename.

5. **This file loads models, not Operations Registry lists.** `getLeadSourceCompanyModel().find({ company_slug, active: true })` can drift from `listSourceCompanies({ active: true })`. Do not silently start **asking** `listSourceCompanies` so “one registry owns prove.”

6. **`registryMongoPredicate` has no interface test.** The per-company-narrow story is locked on the sibling. Do not treat that orphan test as this export.

7. **Fold lowercases; Zod already requires lowercase slugs.** Direct callers get the fold. Do not silently drop lowercase so “Zod already did it.”

8. **Snapshot sort by key is checksum-stable.** Mongo return order is not the snapshot order. Do not silently switch to input order so “the owner’s list is preserved.”

9. **Channel is not checked.** A call-only Feed still counts if its key is active under a selected company. Do not silently refuse by channel so “form reports stay form.”

10. **Leave sibling modules alone.** Wave B Zod stays Wave B. Sibling `registryHierarchyPredicate` stays gather. Operations Registry lists stay Operations Registry. Lead attribution stays `leadSourceCompany.ts`. Admin Filter Catalog stays admin. Analytics chips stay analytics. Preview persist stays `reporting.service.ts`. Do not open unvisited `google/cellSerialization.ts` this pass.

## Testing

The **interface** is the test surface. Existing asserts: Wave B Zod refuses 51 company keys before this file; `validateReportingDraft` refuses unknown filters and overlong windows; sibling `registryHierarchyPredicate` locks per-company narrow. No prove of unknown / inactive / wrong-parent keys is locked. No `registryMongoPredicate` assert is locked. No “estimate does not re-prove” proof is locked.

Add proofs at the new names (later implementer; not this Cloud pass):

- prove: unique companies required; duplicate company keys refuse; unknown or inactive company refuse; duplicate granularity keys refuse; granularity not under a selected company refuse
- prove: empty granularity list is company-wide; snapshot sorted by key; company label is `owner_label || name`
- gather: company-only snapshot → `$or` of `lead_source_company`; one company narrowed + sister whole (same shape as the sibling orphan test)
- freeze: preview / save **ask** prove; estimate / confirm read `registry_snapshot` and do not **ask** prove
- never write Google: Drive / Sheets are not called from this file
- never stamp a Lead: `resolveSourceAttribution` is not called from this file
- never include inactive: `active: true` stays on both finds

Do not add helper-unit tests for `foldSourceKeys`. Do not boot live Google, destination desk, or the worker. Do not replace sibling `registryHierarchyPredicate` tests with this file so “one test owns both stories.” Do not assert Analytics chips as if they were `registry_snapshot`.

## What I would not do

- I would not implement this pass.
- I would not rewrite `recommendations/form-lead.md`.
- I would not edit `src/`, tests, routes, models, or `docs/knowledge/`.
- I would not invent a CONTEXT.md term or an ADR. CONTEXT.md does not define Reporting.
- I would not open Wave B (`src/validation/reporting.validation.ts`, `src/routes/reporting.routes.ts`).
- I would not write a whole-folder Reporting recommendation.
- I would not introduce a `ReportingRegistryFiltersService` class or a `create.ts` / `update.ts` / `delete.ts` / `validate.ts` / `predicate.ts` split.
- I would not invent a second live-book **adapter** beside this prove.
- I would not pull Wave B Zod, sibling `registryHierarchyPredicate`, Operations Registry lists, Lead attribution, Admin Filter Catalog, Analytics chips, preview persist, or gather / paint into this file.
- I would not silently merge sibling `registryHierarchyPredicate` into this file.
- I would not silently re-prove on `prepareManualRun`.
- I would not silently start **asking** `listSourceCompanies` from this file.
- I would not open unvisited `google/cellSerialization.ts` while this checklist still has unchecked modules after this row.
- I would not silently reorder ADR-known side effects.
