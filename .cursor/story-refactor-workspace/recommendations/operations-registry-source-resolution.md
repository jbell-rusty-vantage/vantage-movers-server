# Say Which Live Feed This Hint Would Stamp — Company First, Then Exact Key Or CRM Label Or Source Site, Then Local Or Long Distance, Then Leftover Alias By Unique Highest Priority, Then The Company Channel Default — One Match Or Missing Or Ambiguous — Never Invent A Company — Never Pick The First Of Two Equal-Priority Aliases — Selected Company Must Be Active — Never Load Mongo — Never Throw — Never Write An Operational Event — operational story

- Status: recommended; refreshed 2026-10-29.
- Target: `src/services/operationsRegistry/sourceResolution.ts`
- Domain evidence: `docs/knowledge/services/operations-registry.md`
- Current exported operations/constants: `previewSourceAttribution`.
- Current exported types: `RegistrySourceChannel`, `RegistrySourceCompanyRecord`, `RegistrySourceGranularityRecord`, `SourceAttributionInput`, `SourceAttribution`, `SourceResolutionPreview`.
- Direct import sites found: `src/services/operationsRegistry/index.ts`, `src/services/operationsRegistry/sourceRegistry.ts`, `src/services/operationsRegistry/sourceResolution.test.ts`.
- Related tests: `src/services/operationsRegistry/sourceResolution.test.ts`

## Current boundary and parity

The Registry is the live source, route and cost catalog. Preserve effective-dated assignments and the existing Registry mutation, authorization and audit boundaries. Lead creation resolves the period covering its business timestamp; duplicates cost zero. Correction jobs and stamps remain separate from live Insights pricing and Sheet Sync.

The target and its direct callers are the authority for the exact implementation. Preserve the public signatures, persisted identifiers, transaction and side-effect ordering, error shapes, and idempotency while migrating callers. Keep any existing public name as an alias until its callers move. Do not introduce an additional service class or move policy into a route.

## Remaining cleanup

Read the exported operations above in their actual order and rename only an operation whose name obscures its current outcome or scope. Keep separate operations separate where their callers own different decisions; extract a private helper only when it gives a real decision a clearer name. Migrate the direct callers together, then cover the existing success, refusal, retry and side-effect boundaries relevant to this module with targeted tests. This is a behavior-preserving naming and module-shape pass, not authorization to add effects or change business policy.

## Specific implementation checks from the original brief

1. **Pick the company from the hint — or leave the field open** — `selectCompany`. Fold the slug (`trim` + lowercase). Empty slug → `{ status: "resolved" }` with **no** company (the later ladder considers active same-channel Feeds across companies, then validates the selected Feed's parent company). One live company whose slug or alias matches → that company. Two live companies → `ambiguous` / `company`. Zero → `not_found` / `company`, unless leftover Lead assignment set `allow_company_identifier_fallback` — then a miss becomes “field open” so a leftover alias can still match globally. This beat does **not** invent a company. This beat does **not** look at archived companies.

2. **Walk the live-Feed ladder** — the body of `previewSourceAttribution` after the company beat. Keep only Feeds that are active, on this channel, and (when a company was picked) on that company. Without a selected company, this candidate filter does not remove Feeds whose parent company is inactive; they may contribute to ambiguity before `resolved()` checks company activity on a sole winner. Then, in this order: (a) the first nonempty of `granularity_key` / `crm_label` / `source_site` — one match stamps `exact`; more than one is `ambiguous` / `exact`; zero and no leftover alias is `not_found` / `exact`; zero **with** a leftover alias continues; (b) `local` / `long_distance` among the remaining candidates — one match stamps **`exact`** (the name lies; see Precise logic); more than one is `ambiguous` / `exact`; zero continues; (c) leftover `fallback_alias` against Feed `aliases[]` — unique highest `priority` stamps `fallback`; two Feeds at that same priority are `ambiguous` / `fallback` (and the preview carries that priority); zero continues when a company was picked, else `not_found` / `fallback`; (d) that company’s channel default (`default_form_granularity` or `default_call_granularity`) among the remaining candidates — found stamps `default`; missing default id or an inactive / wrong-channel default is `not_found` / `default`. This beat does **not** break a tie on exact identifiers with priority. This beat does **not** consult leftover nested `granularities[]`. This beat does **not** consult leftover `SOURCE_LABEL_TO_COMPANY` at runtime.

1. **`local` / `long_distance` stamps `match_kind: "exact"`.** Knowledge’s exact identifiers are Feed key, CRM label, and source site. Local is a later ladder rung. Leftover enrichment/recon tests lock `match_kind`. Do not silently add a stored `"local"` kind so “the ladder name wins” without a paired interface test. Rename the beat (`matchLocalOrLongDistance`) so the lie is visible. Re-label stored values only as a separate, tested change.

3. **An exact miss with a leftover alias continues to local, then alias, then default.** A typo’d Feed key plus a leftover alias can still stamp. That order is load-bearing for leftover Lead assignment (`fallback_alias: input.value`). Do not silently return `not_found` / `exact` whenever a typed key misses so “wrong keys fail closed.”

4. **`allow_company_identifier_fallback` is the leftover Lead path, not Owner HTTP.** Wave B `sourceResolutionPreviewSchema` has no such flag and no `local`. Leftover `resolveLeadSourceAssignment` sets the flag when the raw value is not an explicit company slug (and defaults a missing value to `main_site` **before** it **asks** leftover resolve — that default is leftover Lead interpretation, not this file). Do not silently treat every company miss as field-open so “Owner preview can search globally.” Do not silently add `local` / the flag to Wave B Zod in this rename.

5. **Exact identifiers never use `priority`.** Two live same-channel Feeds with the same CRM label or source site are `ambiguous` even when priorities differ. Knowledge already says exact identifiers must be unique. Leftover activate already refuses that clash. Do not silently pick the higher priority on exact so “alias rules apply everywhere.”

6. **`normalize` is `trim` + lowercase only.** Live label mappings use their own NFKC and whitespace fold; keep that separate from this hint resolver. Do not silently upgrade this `normalize` so “folds match the spec.” The label-mapping collection and collection-first resolution are already live; do not recreate them.

## Parent-company eligibility is checked after selection

`selectCompany` sees active companies, but a global Feed search does not join that active-company set before exact/local/alias matching. An active Feed on an inactive company can create an ambiguity, or be the sole winner and return `not_found`/`company` from `resolved()`. Do not claim all inactive-company Feeds are invisible at every ladder rung. Filtering them earlier would be a behavior change requiring its own decision and paired parity tests.
