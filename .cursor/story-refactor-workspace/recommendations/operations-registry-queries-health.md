# Walk The Catalog And Write A Finding For Each Broken Book — Judge This One Lead Source's Books When Leftover Lead Source Projection Asks — Judge Leftover-Path Clocks, Last-Day Source Misses, And The Leftover Migration Card Only On The Whole Walk — Never Count The Shelf — Never List Registry Changes — Never Resolve A Source — Never Stamp A Card — Never Translate A Finding Into Owner Language — operational story

- Status: recommended
- Service: `operationsRegistry` (Wave A, in-progress)
- Pass: 17 of this service — `queries/health.ts`
- Remaining in this service: `queries/changes.ts`, `labelMappings.ts`, `ownerGranotNames.ts`, `leadSourceSetup.ts`, `queries/leadSourceProjection.ts`
- Target: `src/services/operationsRegistry/queries/health.ts`
- Knowledge: [`docs/knowledge/services/operations-registry.md`](../../../docs/knowledge/services/operations-registry.md) (Health: label-mapping destination/collision; Granot destination, route-shape, and normalized-label collision; SMS gate inconsistency `registry.granot_sms_gate_inconsistent`; stored `daily_cap` > 0 is `registry.granot_sms_daily_cap_configured` and is not a working safety control; leftover-path walks count against an observation window that started 2026-09-01 as `registry.compatibility_reads_remaining`. Static maps, embedded granularities, indexes, and stored `daily_cap` remain — do not treat §9.8 removals as done. Authorization and audit: approved signed dashboard roles may read; Operational Events are reserved for failures, ambiguity, drift, and leftover-path walks). Software rule: [`.cursor/rules/operations-registry.mdc`](../../../.cursor/rules/operations-registry.mdc) (routes import queries from this folder; leftover `findingTranslation.ts` must have an Owner row for every code this file emits). Already-recommended count / signing / leftover-path fold: [recommendations/operations-registry-queries-overview.md](operations-registry-queries-overview.md) (`getRegistryOverview` **asks** the same leftover Event query + leftover merge; it **does not** write a finding; its `isCompatibilityConsumer` copy **drops** leftover `sheet_legacy_resolution`). Already-recommended remember / show / fold: [recommendations/operations-registry-runtime-telemetry.md](operations-registry-runtime-telemetry.md) (`getRegistryRuntimeTelemetry` + `mergeDurableCompatibilityTelemetry` — this file **asks** both, then **asks** leftover `buildRuntimeRegistryHealthFindings`). Already-recommended leftover fourteen-slot CPL that **writes** leftover Events: [recommendations/cpl-cpl-rate.md](cpl-cpl-rate.md). Already-recommended Source miss Events: [recommendations/operations-registry-source-resolution.md](operations-registry-source-resolution.md) / [recommendations/operations-registry-source-registry.md](operations-registry-source-registry.md) (leftover keys `operations_registry.source_resolution_ambiguous` / `operations_registry.source_resolution_not_found` — this file **reads** those Events; it does **not** write them). Already-recommended period validate that this file **asks**: [recommendations/operations-registry-cpl-schedule.md](operations-registry-cpl-schedule.md) (`validateCplSchedule`). Already-recommended Granot name semantics that this file **asks**: leftover `validateGranotCrmSourceSemantics` (model, not a recommended story). Leftover next Change list: `queries/changes.ts` (**reads** Change cards; this file only looks for one leftover migration actor). Leftover next label mappings: `labelMappings.ts` (**writes** leftover `sheet_legacy_resolution` Events this copy **keeps**). Leftover next Lead Source projection: `queries/leadSourceProjection.ts` (**asks** the five book-family judges; passes unpaid Lead count `0`; **asks** leftover `findingTranslation.ts` after). Leftover skip finding fold: `queries/findingTranslation.ts` (every code this file can emit has an Owner row; unknown codes surface as themselves). Already-recommended who-may-speak: [recommendations/operations-registry-trusted-actor.md](operations-registry-trusted-actor.md) (Wave B `requireRegistryReadActor` **asks** that file **before** this one). Already-recommended stamp: [recommendations/operations-registry-registry-audit.md](operations-registry-registry-audit.md) (**does not** import this file). Leftover config: `config.ts` (`getAdminProxySigningSecret` — never echo the secret). Report-only drift script: `scripts/migrations/granot-source-semantic-drift.ts` (**asks** leftover `buildGranotSourceHealthFindings` only). This checkout’s `CONTEXT.md` does not define Registry Health / leftover finding — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: Wave B `src/routes/v1.routes.ts` (`handleOperationsRegistryHealth`: leftover `registryHealthQuerySchema` empty-strict query, leftover `requireRegistryReadActor`, then leftover `getRegistryHealth`; `GET /api/v1/admin/operations-registry/health`). Barrel: `operationsRegistry/index.ts` (`getRegistryHealth` only — the book-family judges are **not** barrelled). Leftover next `queries/leadSourceProjection.ts` `connectionFindings` **asks** leftover `buildSourceRegistryHealthFindings` / leftover `buildLabelMappingHealthFindings` / leftover `buildGranotSourceHealthFindings` / leftover `buildRingCentralHealthFindings` / leftover `buildCplRegistryHealthFindings` (unpaid Lead count `0`, no correction-job counts) and **does not** ask leftover `getRegistryHealth`, leftover `buildRuntimeRegistryHealthFindings`, or leftover `buildSourceResolutionEventFindings`. Report-only `scripts/migrations/granot-source-semantic-drift.ts` **asks** leftover `buildGranotSourceHealthFindings` only. Tests: `queries/health.test.ts` **asks** the five book-family judges plus leftover `buildRuntimeRegistryHealthFindings` with fixtures — **does not** call leftover `getRegistryHealth` and **does not** ask leftover `buildSourceResolutionEventFindings`. Already-recommended `runtimeTelemetry.test.ts` proves the remember / merge this file **asks**; it does not prove this file wrote leftover `registry.cache_stale`. Leftover skip `findingTranslation` tests prove Owner rows, not this walk. Leftover `trustedActor.test.ts` uses the health **path** as a signing fixture — that is leftover who-may-speak’s **interface**. Wave B `v1.routes.test.ts` only asserts the route string is registered. Already-recommended leftover overview / leftover next Change list / already-recommended stamp **do not import this file**.
- Seams callers need: walk-the-catalog (`getRegistryHealth`: load every book + write a finding for each broken one + stamp `generated_at`). Judge-this-Lead-Source (`buildSourceRegistryHealthFindings` / `buildLabelMappingHealthFindings` / `buildGranotSourceHealthFindings` / `buildRingCentralHealthFindings` / `buildCplRegistryHealthFindings`: leftover Lead Source projection **asks** these for one company; the drift script **asks** the Granot judge). Judge-leftover-path-and-stale-clocks (`buildRuntimeRegistryHealthFindings`) vs judge-last-day-Source-misses (`buildSourceResolutionEventFindings`) — parent only; leftover Lead Source projection does **not** ask these. There is no count-the-shelf **seam**. There is no list-Registry-Change **seam**. There is no resolve-Source **seam**. There is no stamp **seam**. There is no who-may-speak **seam**. There is no Owner-language **seam**.
- Split later (only if the file outgrows one sitting): this ~1092-line file is one sitting if you read it as walk the catalog and write a finding for each broken book — judge this one Lead Source's books when leftover Lead Source projection asks — judge leftover-path clocks, last-day Source misses, and the leftover migration card only on the whole walk — never count the shelf — never list Registry Changes — never resolve a Source — never stamp a card — never translate a finding into Owner language. Do **not** split the five book-family judges into five public modules a leftover dashboard could import independently so “CPL health lives next to leftover `validateCplSchedule`” — leftover Lead Source projection already **asks** all five from one `connectionFindings`. Do **not** split leftover `getRegistryHealth` away from the judges so “the walk only loads” — the parent is the walk **and** the write. If it later splits: `walkTheCatalogAndWriteAFindingForEachBrokenBook.ts` / `judgeThisOneLeadSourcesBooks.ts` only as later story files, never `create.ts` / `update.ts` / `delete.ts` / `get.ts` / `health.ts`, and never merge leftover next overview counts, leftover next Change list, leftover next Lead Source projection, leftover skip finding translation, already-recommended remember, already-recommended stamp, leftover who-may-speak, leftover config, or Wave B HTTP into this file

`getRegistryHealth` is executor mechanics. The owner question is: *Walk every catalog book and write a finding when something is broken. When leftover Lead Source projection asks about one Lead Source, reuse the same book-family judges — do not invent a second CPL / Granot / inbound / label / default check. Leftover-path clocks, last-day Source misses, the leftover migration card, the signing secret, and inactive Agents / Merchants appear only on the whole walk. This page does not say how many books sit on the shelf. This page does not list the Change cards. This page does not say which Feed a hint stamps. This page does not decide who may speak. This page does not rewrite a finding into Owner language.*

Already-recommended leftover overview, leftover next Change list, leftover next Lead Source projection, leftover skip finding translation, leftover next label mappings, leftover next Granot create, leftover next setup, already-recommended remember, leftover who-may-speak, leftover config, already-recommended stamp, and Wave B HTTP already live in other **modules**. Do not pull those in.

## What this file actually does

Three operations of one “walk the catalog and write a finding for each broken book — judge this one Lead Source's books when leftover Lead Source projection asks — judge leftover-path clocks, last-day Source misses, and the leftover migration card only on the whole walk — never count the shelf — never list Registry Changes — never resolve a Source — never stamp a card — never translate a finding into Owner language” story, not “a health CRUD helper,” and not leftover overview / leftover Change list / leftover Lead Source projection:

1. **Walk the catalog and write a finding for each broken book** — after leftover `connectMongo`, one `Promise.all` loads inactive Agent / Merchant counts, every Source Company / Source Granularity / unarchived CPL period / inbound route / open inbound assignment / label mapping / Granot name, Form+Call Leads with `cpl_resolution_status: "missing_rate"`, failed and stalled CPL correction jobs, last-day Source-miss Events (keys `operations_registry.source_resolution_ambiguous` / `operations_registry.source_resolution_not_found`, newest 100), last-day leftover-path Events (key `operations_registry.compatibility_read`, newest 100), and the latest leftover Change whose `actor_id` matches `/^operations-registry-m\d+$/`. Then the parent writes walk-only findings (signing secret missing; inactive Agents / Merchants retained; leftover migration card present or missing) and **asks** operations 2 and 3. `finalizeHealthFindings` fills `first_observed_at` / `last_observed_at` / `actionable` (actionable defaults to whether leftover `remediation.action` is set). `generated_at` is `new Date().toISOString()` **after** the queries return. This beat does **not** count active vs total books. This beat does **not** return Change `items`. This beat does **not** resolve a hint. This beat does **not** stamp a card. This beat does **not** call leftover `translateFindings`.

2. **Judge this one Lead Source's books** — five exported judges leftover next `queries/leadSourceProjection.ts` `connectionFindings` **asks** for one company (and the drift script **asks** the Granot judge alone). Source: active Feed under a missing / inactive Lead Source; active form/call Feeds without an active same-company default; two active Feeds share a folded `crm_label` / `source_site`; two active Feeds share an alias at the same priority. Inbound: provider `invalid`; active route without `valid` plus exactly one open assignment; that assignment’s Feed is inactive, not `call`, or not the stored Lead Source. CPL: leftover `validateCplSchedule` throws on an active Feed; unpaid Lead count > 0; failed or stalled correction jobs > 0. Accepted label: active mapping points at a missing / inactive / mismatched Feed or Lead Source; two active mappings share `namespace` + `normalized_label`. Granot name: enabled `source_scoped_lead` points at a missing / inactive / mismatched Lead Source or Feed; leftover `validateGranotCrmSourceSemantics` route-shape failure; customer text shown on while a source-level gate is false; stored `daily_cap` > 0 (warn — not a working safety control); two names share a normalized spelling. Leftover Lead Source projection passes unpaid Lead count `0` and omits correction-job counts, so leftover `registry.cpl_missing_rate_leads` / leftover `registry.cpl_correction_jobs_unhealthy` **never** appear on that page. This beat does **not** load Mongo. This beat does **not** fold leftover-path Events.

3. **Judge leftover-path clocks, last-day Source misses, and the leftover migration card only on the whole walk** — **ask** already-recommended `getRegistryRuntimeTelemetry` + leftover `mergeDurableCompatibilityTelemetry` with leftover-path Events this copy keeps (`details.compatibility_path` is a string **and** leftover `isCompatibilityConsumer`, which **includes** leftover `sheet_legacy_resolution`). Leftover `buildRuntimeRegistryHealthFindings` writes leftover `registry.cache_stale` when a resolver is `serving_stale` or older than `max_age_ms`, and leftover `registry.compatibility_reads_remaining` when any leftover-path row remains (finding text / evidence say the observation window started `2026-09-01`; the query is last 24 hours and 100 Events). Leftover `buildSourceResolutionEventFindings` writes one leftover `registry.source_resolution_failures` error from the last-day sample. The leftover migration card is one info (`registry.migration_evidence_present`) or one warn (`registry.migration_evidence_missing`). Leftover Lead Source projection does **not** ask this operation. Already-recommended leftover overview **asks** the same leftover Event query + leftover merge and **does not** write these findings.

There is no count-the-shelf operation. There is no list-Change operation. There is no resolve operation. There is no stamp operation. There is no Owner-language operation. `isCompatibilityConsumer` / `finalizeHealthFindings` / `granotDestinationInvalid` / `isRouteShapeFailure` / leftover collision helpers are keep-or-drop / stamp-or-skip beats, not public **seams**.

Do not export `isCompatibilityConsumer` as a public **seam**. Do not export `finalizeHealthFindings` as a public **seam**. Do not export a standalone `countInactiveAgents` a leftover dashboard could call without the walk. Do not export leftover `getRegistryOverview` from this file.

## Organization

Keep one file as the screenplay for “walk the catalog and write a finding for each broken book, judge this one Lead Source's books when leftover Lead Source projection asks, judge leftover-path clocks / last-day Source misses / the leftover migration card only on the whole walk, never count the shelf, never list Registry Changes, never resolve a Source, never stamp a card, never translate a finding into Owner language.” Already-recommended leftover overview, leftover next Change list, leftover next Lead Source projection, leftover skip finding translation, leftover next label mappings, already-recommended remember, leftover who-may-speak, leftover config, already-recommended stamp, leftover `validateCplSchedule`, leftover `validateGranotCrmSourceSemantics`, and Wave B HTTP already live in deeper **modules**. Do not pull those in. Do not invent a `RegistryHealthService` class. Do not invent a persist / finalize **seam** — this file is a read. Do not invent a second leftover Event **adapter** beside leftover `getOperationalEventModel`. Do not invent a second Owner-language **adapter** beside leftover `translateFindings`. Do not invent a second who-may-speak **adapter** beside leftover `requireRegistryReadActor`.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `get.ts`. Those are persistence nouns, not the owner story. Do not move leftover overview counts into this file so “health owns the shelf.” Do not move leftover Change rows into this file so “one page owns history.” Do not move leftover `translateFindings` into this file so “health speaks Owner.” Do not silently add leftover Lead Source projection’s unpaid-Lead `0` onto the whole walk so “the pages match.”

**External interface** stays small (this is the test surface). Walk, judge-this-Lead-Source, and walk-only leftover-path / Source-miss / migration are one story’s read, not CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `getRegistryHealth` | `walkTheCatalogAndWriteAFindingForEachBrokenBook` | Wave B Owner/Admin health |
| `buildSourceRegistryHealthFindings` | `writeAFindingWhenThisLeadSourceHasBrokenDefaultsOrSharedLabels` | leftover Lead Source projection **asks** this for one company |
| `buildRingCentralHealthFindings` | `writeAFindingWhenThisInboundNumberIsBroken` | leftover Lead Source projection **asks** this for that company’s numbers |
| `buildCplRegistryHealthFindings` | `writeAFindingWhenThisFeedLacksContinuousCplOrUnpaidLeadsRemain` | leftover Lead Source projection **asks** this with unpaid `0` |
| `buildLabelMappingHealthFindings` | `writeAFindingWhenThisAcceptedLabelPointsAtADeadFeed` | leftover Lead Source projection **asks** this for that company’s mappings |
| `buildGranotSourceHealthFindings` | `writeAFindingWhenThisGranotNameIsBroken` | leftover Lead Source projection **asks** this; the drift script **asks** this alone |
| `buildRuntimeRegistryHealthFindings` | `writeAFindingWhenThisProcessIsServingAStaleBookOrSomeoneStillWalkedALeftoverPath` | parent only — leftover overview **asks** the merge, not this judge |
| `buildSourceResolutionEventFindings` | `writeAFindingWhenSomeoneFailedToResolveASourceInTheLastDay` | parent only |
| `GranotHealthSourceInput` | `ThisGranotNameToJudge` | the one type the Granot judge and the drift script share |

Keep the old names as one-line aliases until Wave B `v1.routes.ts`, leftover next `queries/leadSourceProjection.ts`, the drift script, and the barrel migrate. Do not make callers learn `build` / `findings` as the domain language.

**Principle: old exports stay as aliases.** `getRegistryHealth` remains the imported name until Wave B points at the story name. Persisted leftover Event keys `operations_registry.compatibility_read` / `operations_registry.source_resolution_ambiguous` / `operations_registry.source_resolution_not_found`, leftover consumer strings, and leftover finding codes (`registry.*`) stay those strings — they are leftover skip finding translation’s table and HTTP `findings[].code`, not story names. HTTP field names `generated_at` / `findings` stay those names.

**No class for the workflow.** The type that *does* earn a name is the leftover bag leftover `types.ts` already exports (today `RegistryHealthResult`):

```ts
type WalkTheCatalogAndWriteAFindingForEachBrokenBook = {
  generated_at: string
  findings: BrokenBookFinding[]
}
```

That is the handoff from “every book was judged” to “Wave B returns `{ ok, data }`.” Do **not** add leftover overview `counts` / `signing` / `runtime` onto this bag so “health owns the shelf.” Do **not** add leftover Change `items` onto this bag so “health owns history.” Do **not** add leftover `owner_message` onto a finding so “health speaks Owner” — leftover skip `findingTranslation.ts` already owns that **adapter**. Do **not** store a token on a finding.

Do not add `requireRegistryReadActor` as a public **seam** on this file — Wave B already owns who may speak. Do not add `translateFindings` as a public **seam** — leftover skip `findingTranslation.ts` already owns Owner rows. Do not add `getRegistryOverview` as a public **seam** — already-recommended leftover overview already owns the shelf. Do not add `listRegistryChanges` as a public **seam** — leftover next `queries/changes.ts` already owns the card list. Do not add `getLeadSourceProjection` as a public **seam** — leftover next `queries/leadSourceProjection.ts` already owns the Feed page.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// queries/health.ts
// Walk every catalog book and write a finding
// when something is broken.
// When leftover Lead Source projection asks
// about one Lead Source, reuse the same judges.
// Leftover-path clocks, last-day Source misses,
// and the leftover migration card appear
// only on the whole walk.
// Do not count the shelf.
// Do not list the Change cards.
// Do not say which Feed a hint stamps.
// Do not decide who may speak.
// Do not rewrite a finding into Owner language.

// ── 1. Walk the catalog and write a finding for each broken book ──

async function loadEveryCatalogBookForThisWalk() // Promise.all: companies, Feeds, periods, routes, mappings, Granot names, unpaid Leads, correction jobs, last-day Events, leftover migration card
function writeAFindingWhenThisProcessCannotVerifyASignedOwner() // leftover config secret missing — never the secret
function writeAFindingWhenInactiveAgentsOrMerchantsAreStillOnTheShelf() // info; today's inactiveAgentsUsedRecently is a count, not a recency filter
function writeAFindingWhenTheLeftoverMigrationCardIsPresentOrMissing() // latest Change actor /^operations-registry-m\d+$/
function stampWhenEachFindingWasSeen(findings, observedAt) // today's finalizeHealthFindings

export async function walkTheCatalogAndWriteAFindingForEachBrokenBook()

// ── 2. Judge this one Lead Source's books ──

export function writeAFindingWhenThisLeadSourceHasBrokenDefaultsOrSharedLabels(companies, feeds)
export function writeAFindingWhenThisInboundNumberIsBroken(routes, openAssignments, companies, feeds)
export function writeAFindingWhenThisFeedLacksContinuousCplOrUnpaidLeadsRemain(activeFeedIds, periods, unpaidLeadCount, failedJobs, stalledJobs)
export function writeAFindingWhenThisAcceptedLabelPointsAtADeadFeed(mappings, companies, feeds)
export function writeAFindingWhenThisGranotNameIsBroken(names, companies, feeds)

function thisGranotNamePointsAtADeadLeadSourceOrFeed(name, companies, feeds) // only when leftover source_scoped_lead
function thisRouteShapeFailureIsAboutFeeds(message) // today's isRouteShapeFailure string-includes

// ── 3. Judge leftover-path clocks, last-day Source misses, and the leftover migration card only on the whole walk ──

function keepThisLeftoverPathEventIfSomeoneWeRecognizeWalkedIt(event) // today's isCompatibilityConsumer — includes sheet_legacy_resolution
export function writeAFindingWhenThisProcessIsServingAStaleBookOrSomeoneStillWalkedALeftoverPath(clocks)
export function writeAFindingWhenSomeoneFailedToResolveASourceInTheLastDay(events)
```

Read the primary path out loud: *Open Mongo. Load every catalog book, last-day Source-miss Events, last-day leftover-path Events, and the latest leftover migration card. Write a finding when the signing secret is missing, when inactive Agents or Merchants are still retained, when a Lead Source’s defaults or labels collide, when an inbound number is not fully mapped, when a Feed lacks continuous CPL or unpaid Leads / stalled jobs remain, when this process is serving a stale book or someone still walked a leftover path, when someone failed to resolve a Source in the last day, when the leftover migration card is present or missing, when an accepted label points at a dead Feed, and when a Granot name is broken. Stamp `generated_at`. Do not count the shelf. Do not list Change cards. Do not resolve a Source. Do not stamp a card. Do not rewrite a finding into Owner language.*

That is the operation. `getRegistryHealth` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`inactiveAgentsUsedRecently` is a lying name.** The query is `Agent.countDocuments({ active: false })` — every inactive Agent, no recency filter. The finding code / summary already say “retained for historical references.” Do not silently add a last-used window so “the variable becomes true.” Do not silently rename the finding code so “recently used” becomes the contract.

2. **This copy of `isCompatibilityConsumer` keeps leftover `sheet_legacy_resolution`. Already-recommended leftover overview’s copy drops it.** Already-recommended leftover `RegistryCompatibilityConsumer` includes the string. Leftover next `labelMappings.ts` records leftover `operations_registry.compatibility_read` with that consumer. This walk will write leftover `registry.compatibility_reads_remaining` for a leftover sheet/legacy walk that leftover overview hides. Do not silently drop the string from this copy so “the pages match.” Do not silently add it to leftover overview in this rename. Pair any union change with leftover overview + leftover label-mapping tests.

3. **The leftover-path query is last 24 hours and 100 Events. The finding text says 2026-09-01.** Leftover `buildRuntimeRegistryHealthFindings` evidence is `observation_window_started_at: "2026-09-01"` while this file and leftover overview both query `now - 24h` and `limit(100)`. A walk older than 24 hours, or the 101st newest walk today, never reaches leftover `registry.compatibility_reads_remaining`. Do not silently raise the limit or switch the query to 2026-09-01 so “the finding sentence becomes true.” Do not silently change the sentence in this rename. Knowledge already names the 2026-09-01 window.

4. **Leftover Lead Source projection asks the five book-family judges with unpaid Lead count `0` and no correction-job counts.** The whole walk **does** load Form+Call `missing_rate` and failed / stalled jobs. A Lead Source page can look clean while leftover `GET .../health` shows leftover `registry.cpl_missing_rate_leads`. Do not silently pass the unpaid count into leftover `connectionFindings` so “the pages match” without a paired leftover Lead Source projection test. Do not silently drop unpaid Leads from this walk so “only the Feed schedule matters.”

5. **Leftover Lead Source projection does not ask leftover `buildRuntimeRegistryHealthFindings` or leftover `buildSourceResolutionEventFindings`.** Stale clocks, leftover-path walks, last-day Source misses, the leftover migration card, the signing secret, and inactive Agents / Merchants are walk-only. Do not silently call those judges from leftover `connectionFindings` so “one Lead Source owns leftover-path drift.”

6. **There is no test on leftover `getRegistryHealth` and none on leftover `buildSourceResolutionEventFindings`.** Today’s `queries/health.test.ts` **asks** the book-family judges and leftover `buildRuntimeRegistryHealthFindings` with fixtures. That is a real **seam** leftover Lead Source projection and the drift script need — it is not the walk. Wave B only proves the route string exists. A later implementer must add the walk tests below before renaming.

7. **Source-label / source-site / fallback collision findings omit `entity_id`.** The identifier sits in leftover `remediation.summary`. Do not silently attach the first colliding Feed id so “every error has an entity” without a paired leftover skip finding-translation / leftover Lead Source projection test (those pages already render codes without ids).

8. **Leftover Granot destination is judged only when leftover `lifecycle_disposition === "source_scoped_lead"`.** An enabled leftover deferred / leftover referral name with a broken company writes no leftover `registry.granot_source_destination_invalid`. Do not silently judge every enabled name so “enabled means destination” — leftover `granotDestinationInvalid` already documents the disposition gate.

9. **`isRouteShapeFailure` is string-includes on leftover `validateGranotCrmSourceSemantics` messages.** A wording change in the model helper can silence leftover `registry.granot_source_route_shape_invalid`. Do not silently switch to leftover `shape.code` in this rename if the helper still returns `{ ok, message }`. Do not silently treat every leftover `!shape.ok` as a route-shape finding so “policy failures become Feed failures.”

10. **CPL periods are remapped with a hardcoded leftover `America/New_York`.** Leftover next `queries/leadSourceProjection.ts` already imports leftover `CPL_BUSINESS_TIME_ZONE` from the period model. Do not silently switch this file to that constant so “one timezone owns both” without a paired TEST_MODE period test.

11. **Model access is mixed.** Agent / Merchant / leftover `OperationsRegistryChange` use leftover named models. Source Company / Source Granularity / periods / Leads / jobs / routes / assignments / Events / mappings / Granot names use leftover `get*Model()` factories. Already-recommended leftover overview still uses leftover named `LeadSourceCompany`. Do not silently switch Agent to leftover `getAgentModel()` so “one factory owns the walk” without a paired TEST_MODE collection-suffix test.

12. **`generated_at` is after `Promise.all`.** The books and Events already loaded. A clock that used `generated_at` as “when the walk started” is slightly late. Do not silently move `generated_at` before the queries so “the stamp is the start” without saying the findings can finish after that stamp.

13. **Signing is a finding here and a boolean on leftover overview.** Leftover `secret_configured` never writes leftover `registry.signing_secret_missing`. Do not silently add leftover overview `signing` onto this bag so “one page owns both.” Do not silently echo the secret.

14. **Leave sibling modules alone.** Already-recommended `getRegistryRuntimeTelemetry` / `mergeDurableCompatibilityTelemetry`, leftover `getAdminProxySigningSecret`, leftover `validateCplSchedule`, leftover `validateGranotCrmSourceSemantics`, leftover next `getRegistryOverview`, leftover next `listRegistryChanges`, leftover next `getLeadSourceProjection`, leftover `translateFindings`, leftover `requireRegistryReadActor`, and already-recommended `withRegistryMutation` are already the right **depth**. This file walks and writes findings; it does not count the shelf, list cards, project a Feed, or speak Owner.

15. **Do not silently change leftover Event keys, leftover consumer strings, or leftover finding codes.** `operations_registry.compatibility_read`, leftover `sheet_legacy_resolution`, leftover `registry.compatibility_reads_remaining`, and the rest of leftover `FINDING_TRANSLATION_TABLE` are leftover skip finding translation’s contract. Story names live on the functions.

## Testing

The **interface** is the test surface: `walkTheCatalogAndWriteAFindingForEachBrokenBook` (today `getRegistryHealth`) plus the five book-family judges leftover Lead Source projection **asks** and the two walk-only judges the parent **asks**. Do not make `isCompatibilityConsumer` / `finalizeHealthFindings` / `granotDestinationInvalid` the named surface.

Today `queries/health.test.ts` already names leftover `buildSourceRegistryHealthFindings` / leftover `buildCplRegistryHealthFindings` / leftover `buildRuntimeRegistryHealthFindings` / leftover `buildLabelMappingHealthFindings` / leftover `buildGranotSourceHealthFindings` with fixtures. Keep those as the judge-this-Lead-Source **seam**. Add the missing walk and Source-miss tests. Do not replace the judge tests with helper-unit tests of leftover `collisionFindings`.

**Walk the catalog and write a finding for each broken book**
- Leftover secret unset → leftover `registry.signing_secret_missing`. Leftover secret set → that code is absent. The secret value is never in leftover `evidence`.
- One `{ active: false }` Agent → leftover `registry.inactive_agents_present` with count `1`. Same for Merchant.
- No leftover Change whose `actor_id` matches `/^operations-registry-m\d+$/` → leftover `registry.migration_evidence_missing`. One matching card → leftover `registry.migration_evidence_present` with that `actor_id`.
- The bag has **no** `counts` key, **no** `signing` key, **no** `runtime` key, and **no** Change `items`.
- Do not add a leftover `requireRegistryReadActor` 403 test here. Wave B + leftover who-may-speak already own that **adapter**.
- Do not add a leftover `owner_message` assertion here. Leftover skip finding translation already owns that **adapter**.

**Judge this one Lead Source's books**
- Keep today’s source default / collision / inactive-company, CPL invalid + unpaid + stalled, label destination + collision, and Granot destination / shape / collision / SMS-gate / daily-cap / quiet fixtures.
- Name that leftover Lead Source projection **asks** these judges with unpaid `0` — do not assert leftover `registry.cpl_missing_rate_leads` from leftover `connectionFindings` here (that file is leftover next).
- The drift script **asks** leftover `buildGranotSourceHealthFindings` only. Do not retest the script’s report printer.

**Judge leftover-path clocks, last-day Source misses, and the leftover migration card only on the whole walk**
- Keep today’s leftover `buildRuntimeRegistryHealthFindings` stale RingCentral + leftover `legacy_cpl_rates` / leftover `admin_list` fixture → leftover `registry.cache_stale` + leftover `registry.compatibility_reads_remaining`.
- Add: leftover Event with leftover `sheet_legacy_resolution` **is kept** by this copy (lock that; name the test “leftover sheet/legacy walk appears on health even when leftover overview drops it”).
- Add leftover `buildSourceResolutionEventFindings`: one leftover `_not_found` + one leftover `_ambiguous` inside the sample → leftover `registry.source_resolution_failures` with leftover `evidence.missing: 1` and leftover `evidence.ambiguous: 1`. Empty sample → no finding.
- Do not retest leftover `recordRegistryResolverAttempt` / leftover `recordDurableCompatibilityRead` here. Already-recommended leftover telemetry already owns those **adapters**.

Do **not** add a test per helper (`loadEveryCatalogBookForThisWalk`, `keepThisLeftoverPathEventIfSomeoneWeRecognizeWalkedIt`, `thisGranotNamePointsAtADeadLeadSourceOrFeed`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** retest leftover overview shelf counts, leftover Change pagination, leftover Lead Source projection round-trips, leftover `FINDING_TRANSLATION_TABLE` rows, leftover who-may-speak signatures, leftover stamp rollback, leftover `validateCplSchedule` period math, or Wave B route mounts here. Those already have (or will have) their own interface tests. Wave B **asks** the walk. Leftover Lead Source projection **asks** the judges. Prove the findings, not the Owner sentence.

## What I would not do

- A `RegistryHealthService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap leftover `countDocuments`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `get.ts`) for cleanliness.
- Breaking the walk / judge-this-Lead-Source / walk-only leftover-path **seam**. A public Event query leftover overview could import without the findings is the forbidden split. Returning leftover overview `counts` from this file is the same break. Calling leftover `translateFindings` from this file is the same break.
- Treating leftover next overview, leftover next Change list, leftover next Lead Source projection, leftover skip finding translation, leftover next label mappings, leftover next Granot create, leftover next setup, already-recommended remember, already-recommended stamp, leftover who-may-speak, leftover config, leftover `validateCplSchedule`, leftover `validateGranotCrmSourceSemantics`, or Wave B HTTP as this story.
- Inventing a **seam** that has only one **adapter**.
- Silently "fixing" a known gap while recommending a rename: do not drop leftover `sheet_legacy_resolution` from this copy so “overview and health match”; do not switch the leftover-path window to 2026-09-01; do not raise the Event limit; do not pass unpaid Leads into leftover `connectionFindings`; do not add leftover overview `counts` / `signing` / `runtime` or Change `items` to the bag; do not echo the signing secret; do not add a recency filter onto inactive Agents; do not judge leftover Granot destinations when leftover disposition is not leftover `source_scoped_lead`; do not move leftover `requireRegistryReadActor` or leftover `translateFindings` into this file; do not merge leftover overview’s Event query here; do not rename persisted leftover Event keys, leftover consumer strings, or leftover finding codes; do not attach `entity_id` onto collision findings without a paired leftover translation test.
- Jumping to the next service while this one has unchecked modules.
- Writing a whole-folder recommendation for `operationsRegistry`.
