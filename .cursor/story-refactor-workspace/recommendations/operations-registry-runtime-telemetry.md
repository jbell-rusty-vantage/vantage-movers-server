# Remember Whether This Live Lookup Tried, Succeeded, Failed, Or Handed Back A Stale Book — Remember That Someone Still Walked A Leftover Compatibility Path Without Failing That Read — Show This Process's Resolver Clocks And Leftover-Path Counts — Fold In Durable Leftover-Path Events From Other Processes — Never Resolve A Source — Never Price A Lead — Never Load A RingCentral Book — Never Write A Health Finding — Never Stamp A Registry Change — operational story

- Status: recommended
- Service: `operationsRegistry` (Wave A, in-progress)
- Pass: 15 of this service — `runtimeTelemetry.ts`
- Remaining in this service: `queries/overview.ts`, `queries/health.ts`, `queries/changes.ts`
- Target: `src/services/operationsRegistry/runtimeTelemetry.ts`
- Knowledge: [`docs/knowledge/services/operations-registry.md`](../../../docs/knowledge/services/operations-registry.md) (Authorization and audit: Operational Events are reserved for failures, ambiguity, drift, and migration outcomes — leftover-path walks are the **drift** Event `operations_registry.compatibility_read`; Registry Changes stay mutation history). Software rule: [`.cursor/rules/observability-service.mdc`](../../../.cursor/rules/observability-service.mdc) (observability is best-effort; Event write must not break the leftover read). Already-recommended leftover fourteen-slot CPL that **asks** this file: [recommendations/cpl-cpl-rate.md](cpl-cpl-rate.md) (`getCplRate` / `listCplRates` **ask** `recordDurableCompatibilityRead`; leftover read must still return if the Event write fails). Already-recommended Source lookup that **asks** the resolver ticks: [recommendations/operations-registry-source-registry.md](operations-registry-source-registry.md) (`resolveSourceAttribution` ticks attempt / success / query-fail / ambiguous / not-found; the ambiguous / not-found **Operational Events live there**, not here). Already-recommended period price that **asks** the CPL ticks: [recommendations/operations-registry-cpl-schedule.md](operations-registry-cpl-schedule.md) (`resolveCpl` ticks attempt / success-after-the-period-query / query-fail; `resolveCplFromPeriods` does **not** tick). Already-recommended inbound-number book that **asks** the RingCentral ticks: [recommendations/operations-registry-ring-central-snapshot.md](operations-registry-ring-central-snapshot.md) (rebuild attempt / success / `snapshot_refresh_failed` / stale-serve; the refresh-failed **Operational Event lives there**; a five-minute cache hit ticks nothing). Already-recommended stamp: [recommendations/operations-registry-registry-audit.md](operations-registry-registry-audit.md) (**does not** import this file). Leftover next: `queries/overview.ts` (embeds the merged snapshot as `runtime`) and `queries/health.ts` (`buildRuntimeRegistryHealthFindings` turns stale / leftover-path rows into findings — **does not** write those findings here). Leftover observability persist: leftover `observability/recordOperationalEvent` (test sink / disabled / log-only all return `null`). This checkout’s `CONTEXT.md` does not define Registry resolver / leftover compatibility path — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: already-recommended `sourceRegistry.ts` (`recordRegistryResolverAttempt` / `Success` / `Failure` on `"source"`). Already-recommended `cplSchedule.ts` (same three on `"cpl"`). Already-recommended `ringCentralSnapshot.ts` (those three plus `recordRegistryResolverStaleServe` on `"ringcentral"`). Already-recommended leftover fourteen-slot CPL (`recordDurableCompatibilityRead("legacy_cpl_rates", "unknown" | "admin_list")`). Leftover next `queries/overview.ts` and leftover next `queries/health.ts` (`getRegistryRuntimeTelemetry` + `mergeDurableCompatibilityTelemetry` over last-24h `operations_registry.compatibility_read` Events, limit 100). Barrel: `operationsRegistry/index.ts` (all remember / show / merge exports; `recordCompatibilityRead` is barrelled and has **no** Owner-command caller). Tests: `runtimeTelemetry.test.ts` (bounded resolver view + leftover-path counters; durable write falls back locally when persist returns nothing; merge sums durable Events). Leftover next `queries/health.test.ts` **asks** leftover `buildRuntimeRegistryHealthFindings` with a fixture snapshot — that is leftover health’s **interface**, not this one. Already-recommended stamp / already-recommended who-may-speak / leftover `queries/changes.ts` **do not import this file**. Wave B routes **ask** leftover overview / leftover health, not this file.
- Seams callers need: remember-this-live-lookup (`recordRegistryResolverAttempt` / `Success` / `Failure` / `StaleServe`) vs remember-this-leftover-path (`recordDurableCompatibilityRead`: leftover Event when persist returns a row vs process-local increment when persist returns `null` or throws); show-this-process (`getRegistryRuntimeTelemetry(now)`) vs fold-in-other-processes (`mergeDurableCompatibilityTelemetry`); test reset (`resetRegistryRuntimeTelemetryForTests`). There is no resolve-Source **seam**. There is no price-a-Lead **seam**. There is no load-RingCentral-book **seam**. There is no health-finding **seam**. There is no Registry Change **seam**.
- Split later (only if the file outgrows one sitting): this ~224-line file is one sitting if you read it as remember whether this live lookup tried, succeeded, failed, or handed back a stale book — remember that someone still walked a leftover compatibility path without failing that read — show this process's resolver clocks and leftover-path counts — fold in durable leftover-path events from other processes — never resolve a Source — never price a Lead — never load a RingCentral book — never write a health finding — never stamp a Registry Change. Do **not** split remember-lookup vs remember-leftover-path into two public modules a caller could import independently so “health only sees leftover CPL” — leftover overview / leftover health already **ask** both from one snapshot. If it later splits: `rememberWhetherThisLiveLookupTried.ts` / `rememberThatSomeoneStillWalkedALeftoverCompatibilityPath.ts` only as later story files, never `create.ts` / `update.ts` / `delete.ts` / `metrics.ts` / `events.ts`, and never merge already-recommended Source / CPL / RingCentral lookups, leftover fourteen-slot CPL, leftover overview, leftover health findings, leftover Event persist, leftover stamp, or Wave B HTTP into this file

`recordRegistryResolverAttempt` / `recordDurableCompatibilityRead` / `getRegistryRuntimeTelemetry` are executor mechanics. The owner question is: *A live Registry lookup just ran. Remember whether this process tried, succeeded, failed, or handed back a stale RingCentral book. If someone still walked a leftover compatibility path (today the old fourteen-slot CPL book), remember that too — write the leftover drift Event when you can, but never fail the leftover read. When leftover overview or leftover health asks, show this process’s resolver clocks plus leftover-path counts, and fold in leftover-path Events other processes already persisted. This file does not say which Feed a hint stamps. This file does not price a Lead. This file does not load the inbound-number book. This file does not write a health finding. This file does not stamp a Registry Change. This file does not decide who may speak.*

Already-recommended Source / CPL / RingCentral lookups, already-recommended leftover fourteen-slot CPL, leftover Event persist, leftover next overview / health, leftover stamp, leftover who-may-speak, and Wave B HTTP already live in other **modules**. Do not pull those in.

## What this file actually does

Three operations of one “remember whether this live lookup tried, succeeded, failed, or handed back a stale book — remember that someone still walked a leftover compatibility path without failing that read — show this process's resolver clocks and leftover-path counts — fold in durable leftover-path events from other processes — never resolve a Source — never price a Lead — never load a RingCentral book — never write a health finding — never stamp a Registry Change” story, not “a telemetry CRUD helper,” and not leftover health / leftover overview:

1. **Remember whether this live lookup tried, succeeded, failed, or handed back a stale book** — process-local clocks for `"source"` / `"cpl"` / `"ringcentral"`. Attempt increments `refreshAttempts`. Success stamps `lastSuccessAt` (`loadedAt` or now), optional `maxAgeMs`, clears `lastErrorCode`, clears `servingStale`. Failure increments `refreshFailures` and stores the caller’s **safe** code (`resolution_query_failed` / `ambiguous_resolution` / `not_found` / `snapshot_refresh_failed`). Stale-serve flips `servingStale` (only already-recommended leftover inbound-number book **asks** this, after a rebuild fail while a book younger than thirty minutes is still here). Baked `mode` never changes: source and CPL stay `direct_db`; RingCentral stays `snapshot`. This beat does **not** write an Operational Event. This beat does **not** load Mongo. This beat does **not** survive another Vercel instance.

2. **Remember that someone still walked a leftover compatibility path — never fail that leftover read** — `recordDurableCompatibilityRead(path, consumer, usedAt)`. Try leftover `recordOperationalEvent` (`info`, `operations_registry.compatibility_read`, `admin` / `operations_registry`, leftover `notificationCandidate: false`, leftover `ownerVisible: true`, leftover `reportable: false`, leftover `piiPolicy: "none"`, details `{ compatibility_path, consumer_category }`). If persist returns a row, stop — leftover next overview / leftover next health will fold that Event later. If persist returns `null` (leftover test sink, leftover observability off, leftover log-only) **or** throws, increment the process-local leftover-path counter (`recordCompatibilityRead`, keyed `path:consumer`). A throw from leftover persist must not become a throw to leftover fourteen-slot CPL. Live leftover consumers today are only leftover `unknown` (hot leftover slot read) and leftover `admin_list` (leftover admin page). Reserved leftover `booking_legacy_parse` / `enrichment` / `reconciliation` have **no** Owner-command recorder. This beat does **not** price a Lead. This beat does **not** write a Registry Change.

3. **Show this process's resolver clocks and leftover-path counts — fold in durable leftover-path events from other processes** — `getRegistryRuntimeTelemetry(now)` projects the three clocks (`last_success_at` ISO or null; `age_ms` from `now` minus success, floored at 0, or null; `max_age_ms`; attempt / failure counts; `last_error_code`; `serving_stale`) plus leftover-path rows sorted by path then consumer. `mergeDurableCompatibilityTelemetry` copies those leftover-path rows, then adds one count per leftover Event (`path` + `consumer_category` + `occurred_at`), keeping the later `last_used_at`. Resolver clocks are **not** merged from Events — leftover next health already reads leftover Source miss Events and leftover RingCentral refresh-fail Events on their own keys. This beat does **not** write findings. This beat does **not** query Mongo.

There is no resolve operation. There is no price operation. There is no inbound-number-book operation. There is no finding operation. There is no stamp operation. `recordCompatibilityRead` is the process-local fallback beat of operation 2, barrelled and unused outside this file plus tests. `resetRegistryRuntimeTelemetryForTests` is the test **adapter**. `resolverView` / `initialResolverState` stay internal.

Do not export `resolverStates` / `compatibilityReads` as a public **seam**. Do not export `recordCompatibilityRead` as domain language for “count a leftover walk.” Do not export a standalone `writeCompatibilityOperationalEvent` a leftover reader could await without the fallback.

## Organization

Keep one file as the screenplay for “remember whether this live lookup tried, succeeded, failed, or handed back a stale book, remember that someone still walked a leftover compatibility path without failing that read, show this process's resolver clocks and leftover-path counts, fold in durable leftover-path events from other processes, never resolve a Source, never price a Lead, never load a RingCentral book, never write a health finding, never stamp a Registry Change.” Already-recommended Source / CPL / RingCentral lookups, already-recommended leftover fourteen-slot CPL, leftover Event persist, leftover next overview / health, leftover stamp, leftover who-may-speak, and Wave B HTTP already live in deeper **modules**. Do not pull those in. Do not invent a `RegistryTelemetryService` class. Do not invent a persist / finalize **seam** for resolver ticks — those clocks are process-local on purpose beside the leftover Events those lookups already write. Do not invent a second leftover-CPL **adapter** beside already-recommended `getCplRate`. Do not invent a second finding **adapter** beside leftover `buildRuntimeRegistryHealthFindings`. Do not invent a second Event **adapter** beside leftover `recordOperationalEvent`.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `metrics.ts` / `events.ts`. Those are persistence / observability nouns, not the owner story. Do not move leftover findings into this file so “telemetry owns health.” Do not move leftover Event persist into this file so “one file owns drift.” Do not move already-recommended Source / CPL / RingCentral lookups here so “the counter owns the lookup.” Do not silently persist resolver ticks as Operational Events so “every instance shows up in health.” Do not silently fail leftover fourteen-slot CPL when the Event write throws so “drift is never lost.”

**External interface** stays small (this is the test surface). Remember-lookup, remember-leftover-path, and show-plus-fold are one story’s memory, not three CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `recordRegistryResolverAttempt` | `rememberThisLiveLookupTried` | already-recommended Source / CPL / RingCentral lookups |
| `recordRegistryResolverSuccess` | `rememberThisLiveLookupSucceeded` | same three lookups (CPL = period query ran; RingCentral may pass `loadedAt` / `maxAgeMs`) |
| `recordRegistryResolverFailure` | `rememberThisLiveLookupFailed` | same three lookups pass a **safe** code |
| `recordRegistryResolverStaleServe` | `rememberThisLiveLookupHandedBackAStaleBook` | already-recommended leftover inbound-number book only |
| `recordDurableCompatibilityRead` | `rememberThatSomeoneStillWalkedALeftoverCompatibilityPath` | already-recommended leftover fourteen-slot CPL |
| `recordCompatibilityRead` | keep as alias only | process-local fallback; barrelled; no Owner-command caller; do not promote |
| `getRegistryRuntimeTelemetry` | `showThisProcesssResolverClocksAndLeftoverPathCounts` | leftover next overview / leftover next health |
| `mergeDurableCompatibilityTelemetry` | `foldInDurableLeftoverPathEventsFromOtherProcesses` | leftover next overview / leftover next health already queried Events |
| `resetRegistryRuntimeTelemetryForTests` | `forgetThisProcesssResolverClocksForTests` | this file’s tests |
| `RegistryRuntimeTelemetry` | `ThisProcesssResolverClocksAndLeftoverPathCounts` | leftover `types.ts` overview `runtime` bag |
| `RegistryResolverTelemetry` | `ThisProcesssResolverClock` | leftover health fixture |
| `RegistryCompatibilityTelemetry` | `ThisLeftoverPathCount` | leftover health fixture |
| `RegistryResolverName` | `WhichLiveLookup` | `"source"` \| `"cpl"` \| `"ringcentral"` |
| `RegistryResolverMode` | `HowThisLiveLookupAnswers` | baked `direct_db` \| `snapshot` |
| `RegistryCompatibilityConsumer` | `WhoStillWalkedTheLeftoverPath` | leftover next overview / leftover next health fold |

Keep the old names as one-line aliases until already-recommended lookups, leftover fourteen-slot CPL, leftover next overview / health, the barrel, and `runtimeTelemetry.test.ts` migrate. Do not make callers learn `refreshAttempts` / `servingStale` / `compatibilityReads` as the domain language.

**Principle: old exports stay as aliases.** `recordDurableCompatibilityRead` remains the imported name until leftover fourteen-slot CPL points at the story name. Persisted leftover Event key `operations_registry.compatibility_read` and leftover consumer strings stay those strings — they are the leftover health query and HTTP `runtime` bag, not story names.

**No class for the workflow.** The type that *does* earn a name is the leftover snapshot leftover overview already embeds (today `RegistryRuntimeTelemetry`):

```ts
type ThisProcesssResolverClocksAndLeftoverPathCounts = {
  resolvers: Record<WhichLiveLookup, {
    mode: HowThisLiveLookupAnswers
    last_success_at: string | null
    age_ms: number | null
    max_age_ms: number | null
    refresh_attempts: number
    refresh_failures: number
    last_error_code: string | null
    serving_stale: boolean
  }>
  compatibility_reads: Array<{
    path: string
    consumer_category: WhoStillWalkedTheLeftoverPath
    count: number
    last_used_at: string
  }>
}
```

That is the handoff from “this process remembered the live lookups and leftover walks” to “leftover overview embeds `runtime`, leftover health turns stale / leftover-path rows into findings.” Do **not** add `findings` onto this bag so “telemetry owns health.” Do **not** add resolver Event rows onto `compatibility_reads` so “one list owns every tick.” Do **not** store a Lead identity or a token in leftover-path details.

Do not add `recordOperationalEvent` as a public **seam** on this file — leftover observability already owns persist. Do not add `buildRuntimeRegistryHealthFindings` as a public **seam** — leftover next `queries/health.ts` already owns findings. Do not add `resolveSourceAttribution` / `resolveCpl` / `loadRingCentralRouteSnapshot` as a public **seam** — already-recommended lookups already own those answers. Do not add `withRegistryMutation` as a public **seam** — already-recommended stamp already owns the Change.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// runtimeTelemetry.ts
// A live Registry lookup just ran.
// Remember whether this process tried, succeeded, failed,
// or handed back a stale RingCentral book.
// If someone still walked a leftover compatibility path,
// remember that too — write the leftover drift Event when you can,
// but never fail the leftover read.
// When leftover overview or leftover health asks,
// show this process’s resolver clocks plus leftover-path counts,
// and fold in leftover-path Events other processes already persisted.
// Do not say which Feed a hint stamps.
// Do not price a Lead.
// Do not load the inbound-number book.
// Do not write a health finding.
// Do not stamp a Registry Change.

// ── 1. Remember whether this live lookup tried, succeeded, failed, or handed back a stale book ──

export function rememberThisLiveLookupTried(which)
export function rememberThisLiveLookupSucceeded(which, whenTheBookLoaded?)
export function rememberThisLiveLookupFailed(which, safeErrorCode)
export function rememberThisLiveLookupHandedBackAStaleBook(which)

// ── 2. Remember that someone still walked a leftover compatibility path ──

export async function rememberThatSomeoneStillWalkedALeftoverCompatibilityPath(
  path,
  who,
  when,
)
function rememberTheLeftoverPathInThisProcessOnly(path, who, when) // today's recordCompatibilityRead — fallback only

// ── 3. Show this process's clocks — fold in other processes' leftover-path Events ──

export function showThisProcesssResolverClocksAndLeftoverPathCounts(now)
export function foldInDurableLeftoverPathEventsFromOtherProcesses(snapshot, events)

export function forgetThisProcesssResolverClocksForTests()
```

Read the primary path out loud: *A live lookup ran. Remember that this process tried. Remember whether it succeeded, failed with a safe code, or handed back a stale RingCentral book. If someone still opened the leftover fourteen-slot CPL book, write the leftover drift Event when observability will persist it; if that write returns nothing or throws, count the walk in this process only and still let the leftover read return. When leftover overview or leftover health asks, show this process’s three resolver clocks and leftover-path counts, then add leftover-path Events other processes already wrote. Do not resolve a Source. Do not price a Lead. Do not load the inbound-number book. Do not write a finding. Do not stamp a Registry Change.*

That is the operation. `recordRegistryResolverAttempt` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Resolver clocks die with the instance.** Operation 1 is process-local. Leftover merge exists only for leftover-path Events. Another Vercel instance’s Source / CPL / RingCentral ticks never appear here. Do not silently persist resolver ticks as Operational Events so “health sees every instance” — already-recommended Source already writes leftover `operations_registry.source_resolution_ambiguous` / `…_not_found`; already-recommended leftover inbound-number book already writes leftover `ringcentral.route_cache.refresh_failed`; leftover next health already queries those keys. Do not silently drop operation 1 so “Events are enough” without a paired “cache hit ticks nothing / stale-serve still shows” test.

2. **The durable leftover-path test is the leftover observability test sink, not a thrown persist.** Leftover `recordOperationalEvent` returns `null` when leftover `isTestObservabilitySinkActive()`. Today’s “falls back locally when persistence is unavailable” always takes the `if (!persisted)` branch. The `catch` that also increments locally is untested at this **interface**. Prove: leftover read still leaves a process-local row when persist returns `null`, **and** when persist throws. Do not silently delete the `catch` so “null is enough.” Do not silently rethrow so “the owner sees the Event error.”

3. **`recordCompatibilityRead` is barrelled and unused at Owner-command callers.** Grep finds the definition, the durable fallback, the barrel, and this file’s tests. Already-recommended leftover fourteen-slot CPL **asks** only `recordDurableCompatibilityRead`. Do not silently make leftover CPL call the local increment beside the durable export so “double count before merge.” Do not silently delete the export from this rename without a paired “no caller” check.

4. **Reserved leftover consumers have no recorder.** `booking_legacy_parse` / `enrichment` / `reconciliation` exist on the union and on leftover next `isCompatibilityConsumer` copies. No Owner-command module **asks** this file with those strings. Do not silently start recording from leftover booking parse / leftover enrichment / leftover reconciliation so “the union is live.” Do not silently drop those strings so “only CPL exists” without leftover next overview / leftover next health agreeing.

5. **CPL success means the period query ran, not that a Lead was priced.** Already-recommended `resolveCpl` ticks success before leftover `resolveCplFromPeriods` may return leftover `missing_rate` / leftover `not_applicable`. Do not silently move success to “an amount came back” so “success means a rate.” Already-recommended leftover CPL schedule already named this; this file must not “fix” it.

6. **A five-minute RingCentral cache hit ticks nothing.** Already-recommended leftover inbound-number book returns the young book before `rememberThisLiveLookupTried`. Do not silently tick attempt on every leftover load so “every inbound call is metered.” Stale-serve after a rebuild fail is the only leftover `serving_stale: true` writer.

7. **Baked `mode` never changes.** Source and CPL are born `direct_db`; RingCentral is born `snapshot`. Success / failure / stale-serve do not rewrite `mode`. Do not silently flip source to `snapshot` so “the name matches RC.” Do not silently add a `recordRegistryResolverMode` **seam** that has only one **adapter**.

8. **Leftover-path details must stay path + consumer.** Leftover Event details are `{ compatibility_path, consumer_category }`. Do not silently add a phone, a Lead id, or a CPL amount so “the owner can see who walked.” Leftover `piiPolicy: "none"` and leftover `notificationCandidate: false` stay those values — leftover knowledge already reserves paging for failures and ambiguity, not leftover-slot reads.

9. **Merge does not de-dupe a walk this process already persisted.** Durable success skips the local increment, so leftover next health’s Event query plus this process’s local fallback are complementary. A thrown persist that later retries and succeeds can double-count after merge. Do not silently de-dupe by Event id so “counts are exact” without a paired leftover health test. Do not silently increment locally on durable success so “this process always has a row.”

10. **Leave sibling modules alone.** Already-recommended `resolveSourceAttribution`, already-recommended `resolveCpl`, already-recommended `loadRingCentralRouteSnapshot`, already-recommended leftover `getCplRate`, leftover `recordOperationalEvent`, leftover next `getRegistryOverview` / leftover next `getRegistryHealth`, leftover `buildRuntimeRegistryHealthFindings`, leftover `isCompatibilityConsumer` copies, and already-recommended `withRegistryMutation` are already the right **depth**. This file remembers; it does not answer the lookup.

11. **Do not silently change leftover Event keys or leftover consumer strings.** `operations_registry.compatibility_read` and `legacy_cpl_rates` / `admin_list` / `unknown` are the leftover health query and leftover fourteen-slot CPL contract. Story names live on the functions.

## Testing

The **interface** is the test surface: `rememberThisLiveLookupTried` / `Succeeded` / `Failed` / `HandedBackAStaleBook`, `rememberThatSomeoneStillWalkedALeftoverCompatibilityPath`, `showThisProcesssResolverClocksAndLeftoverPathCounts`, `foldInDurableLeftoverPathEventsFromOtherProcesses`. `resetRegistryRuntimeTelemetryForTests` stays exported because the process-local clocks are a real test **adapter**, not a test leak. Do not make `recordCompatibilityRead` the named surface.

Today `runtimeTelemetry.test.ts` already proves a RingCentral attempt / success / fail / stale-serve plus a local leftover-path row project the bounded snapshot, durable write with leftover persist returning nothing leaves a local leftover-path row, and merge sums two leftover Events onto an empty local map. Keep those. Add tests that name the operation:

**Remember whether this live lookup tried, succeeded, failed, or handed back a stale book**
- Source / CPL / RingCentral each keep their baked `mode` after success and after failure (already implied — say it).
- Success without `loadedAt` stamps `now`; `age_ms` at a later `now` is the delta, never negative.
- Failure does not clear `last_success_at` (today it does not — lock that, or the leftover health stale finding loses the last good book).
- Stale-serve without a prior success still projects `serving_stale: true` and `last_success_at: null`.
- Do not add a “every cache hit increments attempt” test. Already-recommended leftover inbound-number book does not tick on a young book.

**Remember that someone still walked a leftover compatibility path**
- Persist returns a row → process-local leftover-path list stays empty (the walk will appear only after leftover next health merges Events). Today’s test cannot prove this while leftover test sink returns `null`; add a persist **adapter** or a paired replica. Do not retest leftover Event fingerprinting here.
- Persist returns `null` → one process-local leftover-path row (already on disk — keep it). Name it “leftover read still remembered in this process.”
- Persist throws → same process-local row, no throw to the caller. This is the untested `catch`.
- Same `path:consumer` twice locally increments `count` and moves `last_used_at`.
- Do not add a leftover `booking_legacy_parse` recorder test. That consumer has no Owner-command **adapter**.

**Show this process's clocks — fold in other processes' leftover-path Events**
- Empty clocks + two leftover Events on the same path/consumer → `count: 2`, later `last_used_at` (already on disk — keep it).
- Local leftover-path row plus a later leftover Event on the same key increments `count` and may move `last_used_at`.
- Leftover Event with an unknown `consumer_category` is leftover next overview / leftover next health’s fold (`isCompatibilityConsumer`), not this **interface**. Do not retest that filter here.
- Resolver clocks are unchanged by merge (already implied — say it).

Do **not** add a test per helper (`rememberTheLeftoverPathInThisProcessOnly`, `resolverView`, `initialResolverState`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** retest already-recommended Source miss Events, already-recommended leftover RingCentral refresh-fail Events, leftover `buildRuntimeRegistryHealthFindings` codes (`registry.cache_stale` / `registry.compatibility_reads_remaining`), leftover fourteen-slot CPL amounts, leftover stamp, leftover who-may-speak, or Wave B route mounts here. Those already have (or will have) their own interface tests. Lookups **ask** the remember; leftover overview / leftover health **ask** the show. Prove the memory, not the finding.

## What I would not do

- A `RegistryTelemetryService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `refreshAttempts += 1`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `metrics.ts` / `events.ts`) for cleanliness.
- Breaking the leftover-path persist / local-fallback **seam**. A public Event write a leftover reader could await without the fallback is the forbidden split. Failing leftover fourteen-slot CPL because observability threw is the same break.
- Treating already-recommended Source / CPL / RingCentral lookups, already-recommended leftover fourteen-slot CPL, leftover Event persist, leftover next overview, leftover next health findings, leftover stamp, leftover who-may-speak, or Wave B HTTP as this story.
- Inventing a **seam** that has only one **adapter**.
- Silently "fixing" a known gap while recommending a rename: do not persist resolver ticks as Operational Events; do not tick attempt on a young RingCentral book; do not move CPL success to “an amount came back”; do not start recording leftover `booking_legacy_parse` / leftover enrichment / leftover reconciliation; do not delete unused `recordCompatibilityRead` without a paired check; do not increment locally on durable success; do not rethrow persist failures; do not raise leftover-path Events to `error` / leftover `notificationCandidate: true`; do not add Lead identity to leftover-path details; do not move leftover findings into this file; do not merge leftover `isCompatibilityConsumer` copies here; do not rename persisted leftover Event keys or leftover consumer strings.
- Jumping to the next service while this one has unchecked modules.
- Writing a whole-folder recommendation for `operationsRegistry`.
