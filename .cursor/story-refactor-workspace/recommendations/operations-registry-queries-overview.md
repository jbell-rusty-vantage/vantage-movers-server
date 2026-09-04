# Count How Many Catalog Books Sit On The Shelf — Show Whether This Process Can Still Verify A Signed Owner — Fold Leftover-Path Events From The Last Day Into This Process's Resolver Clocks — Never Write A Health Finding — Never List Registry Changes — Never Resolve A Source — Never Stamp A Card — operational story

- Status: recommended
- Service: `operationsRegistry` (Wave A, in-progress)
- Pass: 16 of this service — `queries/overview.ts`
- Remaining in this service: `queries/health.ts`, `queries/changes.ts`, `labelMappings.ts`, `ownerGranotNames.ts`, `leadSourceSetup.ts`, `queries/leadSourceProjection.ts`
- Target: `src/services/operationsRegistry/queries/overview.ts`
- Knowledge: [`docs/knowledge/services/operations-registry.md`](../../../docs/knowledge/services/operations-registry.md) (Authorization and audit: approved signed dashboard roles may read; Registry Changes are authoritative successful mutation history; Operational Events are reserved for failures, ambiguity, drift, and leftover-path walks — leftover Event key `operations_registry.compatibility_read`). Software rule: [`.cursor/rules/operations-registry.mdc`](../../../.cursor/rules/operations-registry.mdc) (routes import queries from this folder; this file is the Owner/Admin overview read). Already-recommended remember / show / fold: [recommendations/operations-registry-runtime-telemetry.md](operations-registry-runtime-telemetry.md) (`getRegistryRuntimeTelemetry` + `mergeDurableCompatibilityTelemetry` — this file **asks** both; it does **not** tick a resolver and does **not** write the leftover Event). Already-recommended leftover fourteen-slot CPL that **writes** those Events: [recommendations/cpl-cpl-rate.md](cpl-cpl-rate.md). Already-recommended leftover label walk that **writes** leftover `sheet_legacy_resolution` Events: leftover next `labelMappings.ts` (not this file). Leftover next health: `queries/health.ts` (same leftover Event query + a **complete** `isCompatibilityConsumer` copy that includes `sheet_legacy_resolution`; `buildRuntimeRegistryHealthFindings` turns stale / leftover-path rows into findings — **does not** live here). Leftover next list: `queries/changes.ts` (**reads** Change cards; this file only **counts** them). Already-recommended who-may-speak: [recommendations/operations-registry-trusted-actor.md](operations-registry-trusted-actor.md) (Wave B `requireRegistryReadActor` **asks** that file **before** this one). Already-recommended stamp: [recommendations/operations-registry-registry-audit.md](operations-registry-registry-audit.md) (**does not** import this file). Leftover config: `config.ts` (secret / preview-unsigned / max-age — never echo the secret). This checkout’s `CONTEXT.md` does not define Registry overview / leftover compatibility path — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: Wave B `src/routes/v1.routes.ts` (`handleOperationsRegistryOverview`: leftover `registryOverviewQuerySchema` empty-strict query, leftover `requireRegistryReadActor`, then this file; `GET /api/v1/admin/operations-registry/overview`). Barrel: `operationsRegistry/index.ts` (`getRegistryOverview` only). Tests: **none on this file**. Wave B `v1.routes.test.ts` only asserts the route string is registered next to leftover Lead Source projection / leftover setup. Leftover `trustedActor.test.ts` uses the overview **path** as a signing fixture — that is leftover who-may-speak’s **interface**, not this one. Leftover next `queries/health.test.ts` **asks** leftover `buildRuntimeRegistryHealthFindings` with a fixture snapshot — leftover health’s **interface**. Already-recommended `runtimeTelemetry.test.ts` proves the remember / merge this file **asks**; it does not prove this file counted the shelf or dropped a leftover `sheet_legacy_resolution` Event. Leftover next `queries/changes.ts` / already-recommended stamp / leftover next Lead Source projection **do not import this file**.
- Seams callers need: show-the-shelf (`getRegistryOverview`: count the catalog books + show whether this process can still verify a signed Owner + fold last-day leftover-path Events into this process's resolver clocks). There is no health-finding **seam**. There is no list-Registry-Change **seam**. There is no resolve-Source **seam**. There is no stamp **seam**. There is no who-may-speak **seam**.
- Split later (only if the file outgrows one sitting): this ~119-line file is one sitting if you read it as count how many catalog books sit on the shelf — show whether this process can still verify a signed Owner — fold leftover-path Events from the last day into this process's resolver clocks — never write a health finding — never list Registry Changes — never resolve a Source — never stamp a card. Do **not** split count vs signing vs fold into three public modules a caller could import independently so “health only sees leftover-path Events” — leftover next health already **asks** the same leftover Event query and leftover merge itself. If it later splits: `countHowManyCatalogBooksSitOnTheShelf.ts` only as a later story file, never `create.ts` / `update.ts` / `delete.ts` / `get.ts` / `overview.ts`, and never merge leftover next health findings, leftover next Change list, leftover next Lead Source projection, already-recommended remember, already-recommended stamp, leftover who-may-speak, leftover config, or Wave B HTTP into this file

`getRegistryOverview` is executor mechanics. The owner question is: *How many catalog books are on the shelf right now, and can this process still verify a signed Owner? Also show this process’s leftover resolver clocks, plus leftover-path walks other processes already persisted in the last day. This page does not say which book is broken. This page does not list the Change cards. This page does not say which Feed a hint stamps. This page does not decide who may speak.*

Already-recommended remember / show / fold, leftover next health, leftover next Change list, leftover next Lead Source projection, leftover who-may-speak, leftover config, already-recommended stamp, and Wave B HTTP already live in other **modules**. Do not pull those in.

## What this file actually does

Three operations of one “count how many catalog books sit on the shelf — show whether this process can still verify a signed Owner — fold leftover-path Events from the last day into this process's resolver clocks — never write a health finding — never list Registry Changes — never resolve a Source — never stamp a card” story, not “an overview CRUD helper,” and not leftover health / leftover Change list:

1. **Count how many catalog books sit on the shelf** — after leftover `connectMongo`, twelve `countDocuments` in one `Promise.all`: Agent / Merchant / Source Company / Source Granularity / RingCentral inbound-route **total** and **active**, plus all-time `OperationsRegistryChange` rows. Active means `{ active: true }`. This beat does **not** count leftover Granot names, leftover label mappings, leftover CPL periods, or leftover Lead Source projections. This beat does **not** load the cards. This beat does **not** write a finding.

2. **Show whether this process can still verify a signed Owner** — leftover `config.ts`: `secret_configured` is whether leftover `getAdminProxySigningSecret()` returned a string (never the secret); `preview_unsigned_allowed` is leftover `isOperationsRegistryPreviewUnsignedAllowed()` (always false in leftover [REDACTED] runtime); `signature_max_age_ms` is leftover `getAdminProxySignatureMaxAgeMs()` (env or five minutes, never above five minutes). This beat does **not** verify a header. This beat does **not** decide who may speak. Wave B already **asked** leftover `requireRegistryReadActor` before this file ran.

3. **Fold leftover-path Events from the last day into this process's resolver clocks** — same `Promise.all` loads up to 100 leftover `operations_registry.compatibility_read` Events with `occurred_at` ≥ now minus 24 hours, newest first. **Ask** already-recommended `getRegistryRuntimeTelemetry()` (this process’s three resolver clocks + process-local leftover-path counts), then already-recommended `mergeDurableCompatibilityTelemetry` with Events this file keeps (`details.compatibility_path` is a string **and** leftover `isCompatibilityConsumer`). This beat does **not** write an Operational Event. This beat does **not** write a finding. Leftover next health already runs the same leftover Event query and leftover merge, then **asks** leftover `buildRuntimeRegistryHealthFindings`.

There is no finding operation. There is no list-Change operation. There is no resolve operation. There is no stamp operation. `isCompatibilityConsumer` is the keep-or-drop beat of operation 3, copied here and **missing** leftover `sheet_legacy_resolution` (leftover next health’s copy includes it; already-recommended leftover `RegistryCompatibilityConsumer` includes it). `generated_at` is `new Date().toISOString()` **after** the queries return.

Do not export `isCompatibilityConsumer` as a public **seam**. Do not export a standalone `countRegistryCatalogBooks` a leftover dashboard could call without the signing / leftover-path fold. Do not export `buildRuntimeRegistryHealthFindings` from this file.

## Organization

Keep one file as the screenplay for “count how many catalog books sit on the shelf, show whether this process can still verify a signed Owner, fold leftover-path Events from the last day into this process's resolver clocks, never write a health finding, never list Registry Changes, never resolve a Source, never stamp a card.” Already-recommended remember / show / fold, leftover next health, leftover next Change list, leftover next Lead Source projection, leftover who-may-speak, leftover config, already-recommended stamp, and Wave B HTTP already live in deeper **modules**. Do not pull those in. Do not invent a `RegistryOverviewService` class. Do not invent a persist / finalize **seam** — this file is a read. Do not invent a second leftover Event **adapter** beside leftover `getOperationalEventModel`. Do not invent a second finding **adapter** beside leftover `buildRuntimeRegistryHealthFindings`. Do not invent a second who-may-speak **adapter** beside leftover `requireRegistryReadActor`.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `get.ts`. Those are persistence nouns, not the owner story. Do not move leftover findings into this file so “overview owns health.” Do not move leftover Change rows into this file so “one page owns history.” Do not move leftover Lead Source projection into this file so “overview lists Feeds.” Do not silently count leftover Granot names so “the shelf is complete.”

**External interface** stays small (this is the test surface). Count, signing, and fold are one story’s read, not three CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `getRegistryOverview` | `showHowManyCatalogBooksSitOnTheShelfAndWhetherThisProcessCanStillVerifyASignedOwner` | Wave B Owner/Admin overview |

Keep the old name as a one-line alias until Wave B `v1.routes.ts` and the barrel migrate. Do not make callers learn `counts` / `signing` / `runtime` as the domain language.

**Principle: old exports stay as aliases.** `getRegistryOverview` remains the imported name until Wave B points at the story name. Persisted leftover Event key `operations_registry.compatibility_read` and leftover consumer strings stay those strings — they are the leftover health query and HTTP `runtime` bag, not story names. HTTP field names `generated_at` / `counts` / `signing` / `runtime` stay those names.

**No class for the workflow.** The type that *does* earn a name is the leftover bag leftover `types.ts` already exports (today `RegistryOverviewResult`):

```ts
type HowManyCatalogBooksSitOnTheShelf = {
  generated_at: string
  counts: {
    agents_total: number
    agents_active: number
    merchants_total: number
    merchants_active: number
    source_companies_total: number
    source_companies_active: number
    source_granularities_total: number
    source_granularities_active: number
    ringcentral_routes_total: number
    ringcentral_routes_active: number
    registry_changes_total: number
  }
  signing: {
    secret_configured: boolean
    preview_unsigned_allowed: boolean
    signature_max_age_ms: number
  }
  runtime: ThisProcesssResolverClocksAndLeftoverPathCounts
}
```

That is the handoff from “the shelf was counted and leftover-path Events were folded” to “Wave B returns `{ ok, data }`.” Do **not** add `findings` onto this bag so “overview owns health.” Do **not** add leftover Change `items` onto this bag so “overview owns history.” Do **not** add leftover Granot / leftover label-mapping / leftover CPL-period counts so “the shelf matches leftover health’s inventory.” Do **not** store a token on `signing`.

Do not add `requireRegistryReadActor` as a public **seam** on this file — Wave B already owns who may speak. Do not add `buildRuntimeRegistryHealthFindings` as a public **seam** — leftover next `queries/health.ts` already owns findings. Do not add `listRegistryChanges` as a public **seam** — leftover next `queries/changes.ts` already owns the card list. Do not add `getLeadSourceProjection` as a public **seam** — leftover next `queries/leadSourceProjection.ts` already owns the Feed page.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// queries/overview.ts
// How many catalog books sit on the shelf right now,
// and can this process still verify a signed Owner?
// Also show this process’s leftover resolver clocks,
// plus leftover-path walks other processes already
// persisted in the last day.
// Do not say which book is broken.
// Do not list the Change cards.
// Do not say which Feed a hint stamps.
// Do not decide who may speak.

// ── 1. Count how many catalog books sit on the shelf ──

async function countHowManyCatalogBooksSitOnTheShelf() // Agent / Merchant / Source Company / Source Granularity / inbound-route total+active + all-time Change count

// ── 2. Show whether this process can still verify a signed Owner ──

function showWhetherThisProcessCanStillVerifyASignedOwner() // leftover config: secret present? preview unsigned? max age — never the secret

// ── 3. Fold leftover-path Events from the last day into this process's resolver clocks ──

async function loadLeftoverPathEventsFromTheLastDay() // last 24h, key operations_registry.compatibility_read, newest 100
function keepThisLeftoverPathEventIfSomeoneWeRecognizeWalkedIt(event) // today's isCompatibilityConsumer — currently drops sheet_legacy_resolution

export async function showHowManyCatalogBooksSitOnTheShelfAndWhetherThisProcessCanStillVerifyASignedOwner()
```

Read the primary path out loud: *Open Mongo. Count every Agent, Merchant, Source Company, Source Granularity, and inbound-route book, and how many of those are still active. Count every Registry Change that has ever been stamped. Say whether this process has a signing secret, whether unsigned preview is allowed, and how old a signature may be — never the secret itself. Load leftover-path Events from the last day (at most 100). Keep a walk only when the path is a string and the consumer is one this copy recognizes. Fold those walks into this process’s resolver clocks. Stamp `generated_at`. Do not write a finding. Do not list Change cards. Do not resolve a Source. Do not stamp a card.*

That is the operation. `getRegistryOverview` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This copy of `isCompatibilityConsumer` drops leftover `sheet_legacy_resolution`.** Already-recommended leftover `RegistryCompatibilityConsumer` and leftover next health’s copy include it. Leftover next `labelMappings.ts` records leftover `operations_registry.compatibility_read` with that consumer. Overview silently drops those Events before leftover merge, so Wave B `runtime.compatibility_reads` can hide a leftover sheet/legacy walk that leftover health will count. Do not silently add the string so “the copies match” without a paired leftover health + leftover label-mapping test. Do not silently move leftover health’s copy into this file so “overview owns the union.” Do not silently drop leftover health’s string so “only overview’s five consumers exist.”

2. **The leftover-path window is last 24 hours and 100 Events. Leftover health’s finding text says 2026-09-01.** Leftover `buildRuntimeRegistryHealthFindings` evidence is `observation_window_started_at: "2026-09-01"` while both files query `now - 24h` and `limit(100)`. Overview embeds the merged leftover-path rows; leftover health turns those rows into leftover `registry.compatibility_reads_remaining`. A walk older than 24 hours, or the 101st newest walk today, never reaches this bag. Do not silently raise the limit or switch overview to 2026-09-01 so “the page matches the finding sentence.” Do not silently change leftover health’s sentence in this rename.

3. **`registry_changes_total` is all-time. Leftover-path Events are last-day.** The owner can read “12 leftover walks” next to “4,000 Changes” and think both windows match. Do not silently count Changes since yesterday so “the windows align.” Do not silently count leftover-path Events all-time so “drift is never lost.”

4. **The shelf omits leftover Granot names, leftover label mappings, leftover CPL periods, and leftover Lead Source cards.** Leftover next health already loads those books to write findings. Leftover next `queries/leadSourceProjection.ts` already lists Feeds. Do not silently add those counts so “overview is the inventory.” Do not silently delete RingCentral route counts so “only catalog cards belong.”

5. **There is no test on this interface.** Wave B only proves the route string exists. Leftover who-may-speak tests the path as a signing fixture. Already-recommended leftover telemetry tests the merge this file **asks**, not that this file dropped a leftover `sheet_legacy_resolution` Event or counted `{ active: true }` Agents. A later implementer must add the tests below before renaming.

6. **Model access is mixed.** Agent / Merchant / Source Company / Change use the leftover named models. Source Granularity / inbound-route / leftover Events use leftover `get*Model()` factories. Do not silently switch Source Company to leftover `getLeadSourceCompanyModel()` (leftover next health already does) so “one factory owns every count” without a paired TEST_MODE collection-suffix test.

7. **`generated_at` is after `Promise.all`.** The twelve counts and the leftover Event query already ran. A clock that used `generated_at` as “when the counts were observed” is slightly late. Do not silently move `generated_at` before the queries so “the stamp is the start” without saying the counts can finish after that stamp.

8. **Signing never echoes the secret.** `secret_configured` is a boolean. Do not silently add a fingerprint, last-four, or leftover `preview_unsigned_allowed` reason so “the owner can debug signing.” Leftover who-may-speak already owns verify.

9. **Leave sibling modules alone.** Already-recommended `getRegistryRuntimeTelemetry` / `mergeDurableCompatibilityTelemetry`, leftover `getAdminProxySigningSecret` / leftover `isOperationsRegistryPreviewUnsignedAllowed` / leftover `getAdminProxySignatureMaxAgeMs`, leftover next `getRegistryHealth` / leftover next `buildRuntimeRegistryHealthFindings`, leftover next `listRegistryChanges`, leftover next `getLeadSourceProjection`, leftover `requireRegistryReadActor`, and already-recommended `withRegistryMutation` are already the right **depth**. This file counts and folds; it does not judge the shelf.

10. **Do not silently change leftover Event keys or leftover consumer strings.** `operations_registry.compatibility_read` and leftover `admin_list` / leftover `unknown` / leftover `sheet_legacy_resolution` are leftover health’s query and leftover fourteen-slot CPL / leftover label-mapping contract. Story names live on the functions.

## Testing

The **interface** is the test surface: `showHowManyCatalogBooksSitOnTheShelfAndWhetherThisProcessCanStillVerifyASignedOwner` (today `getRegistryOverview`). Do not make `isCompatibilityConsumer` the named surface.

Today there is **no** `queries/overview.test.ts`. Wave B `v1.routes.test.ts` only asserts the route is registered. Add tests that name the operation:

**Count how many catalog books sit on the shelf**
- Two Agents (one `{ active: true }`) → `agents_total: 2`, `agents_active: 1`. Same shape for Merchant / Source Company / Source Granularity / inbound-route.
- Zero Registry Changes → `registry_changes_total: 0`. One leftover stamp → `1`.
- Do not add a leftover Granot-name count assertion. This file does not count that book.
- Do not retest leftover `countDocuments` adapters. Prove the bag.

**Show whether this process can still verify a signed Owner**
- Leftover secret unset → `secret_configured: false`. Leftover secret set → `true`. The value is never in the bag.
- Leftover preview-unsigned env on a non-[REDACTED] runtime → `preview_unsigned_allowed: true`. Leftover [REDACTED] runtime → `false` even when the env is on (leftover `config.ts` already owns that; prove this file surfaces it).
- Missing leftover max-age env → `signature_max_age_ms` is 300000. An env above five minutes still returns 300000.
- Do not add a leftover `requireRegistryReadActor` 403 test here. Wave B + leftover who-may-speak already own that **adapter**.

**Fold leftover-path Events from the last day into this process's resolver clocks**
- Empty clocks + one leftover Event (`legacy_cpl_rates` / leftover `admin_list`, inside 24h) → `runtime.compatibility_reads` has `count: 1`.
- Leftover Event with leftover `sheet_legacy_resolution` is **dropped** by today’s copy (lock that, or pair the add with leftover health). Name the test “leftover sheet/legacy walk does not appear on overview until this copy recognizes it.”
- Leftover Event older than 24 hours does not appear.
- Leftover Event with an unknown `consumer_category` is dropped (already implied — say it).
- Resolver clocks come from already-recommended leftover `getRegistryRuntimeTelemetry` (this process). Do not retest leftover attempt / stale-serve ticks here.
- The bag has **no** `findings` key and **no** Change `items`.

Do **not** add a test per helper (`countHowManyCatalogBooksSitOnTheShelf`, `keepThisLeftoverPathEventIfSomeoneWeRecognizeWalkedIt`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** retest leftover `buildRuntimeRegistryHealthFindings` codes (`registry.cache_stale` / `registry.compatibility_reads_remaining`), leftover Change pagination, leftover Lead Source projection, leftover who-may-speak signatures, leftover stamp rollback, or Wave B route mounts here. Those already have (or will have) their own interface tests. Wave B **asks** the show. Prove the shelf, not the finding.

## What I would not do

- A `RegistryOverviewService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `countDocuments`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `get.ts`) for cleanliness.
- Breaking the count / signing / leftover-path-fold **seam**. A public Event query leftover health could import without the shelf counts is the forbidden split. Returning leftover findings from this file is the same break.
- Treating leftover next health, leftover next Change list, leftover next Lead Source projection, already-recommended remember, already-recommended stamp, leftover who-may-speak, leftover config, leftover next label mappings, or Wave B HTTP as this story.
- Inventing a **seam** that has only one **adapter**.
- Silently "fixing" a known gap while recommending a rename: do not add leftover `sheet_legacy_resolution` to this copy without a paired leftover health + leftover label-mapping test; do not switch the leftover-path window to 2026-09-01; do not raise the Event limit; do not count leftover Granot names / leftover label mappings / leftover CPL periods; do not add `findings` or Change `items` to the bag; do not echo the signing secret; do not move leftover `requireRegistryReadActor` into this file; do not merge leftover health’s Event query here; do not rename persisted leftover Event keys or leftover consumer strings; do not align `registry_changes_total` to last-day.
- Jumping to the next service while this one has unchecked modules.
- Writing a whole-folder recommendation for `operationsRegistry`.
