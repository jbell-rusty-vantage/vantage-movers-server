# Load The Book Of Inbound Numbers That Have Ever Been Turned On And Still Carry A Valid Stamp — Rebuild From Cards And Assignment Intervals Whose Company And Call Feed Are Still Live — Say Which Live Call Feed This Number Pointed At When The Call Started — Half-Open So The Switch Instant Belongs To The New Feed — Reuse A Book Younger Than Five Minutes — If Rebuild Fails Keep Serving One Younger Than Thirty Minutes — Forget Immediately When The Owner Writes A Number, Company, Or Feed — Never Record The Card — Never Ask RingCentral If The Account Can See The Number — Never Decide Whether The Call Was Answered Long Enough To Become A Call Lead — operational story

- Status: recommended
- Service: `operationsRegistry` (Wave A, in-progress)
- Pass: 7 of this service — `ringCentralSnapshot.ts`
- Remaining in this service: `ringCentralValidation.ts`, `granotCrmSources.ts`, `crmSourceOutboundSms.ts`, `granotCrmSourceProjections.ts`, `granotAutomationSources.ts`, `trustedActor.ts`, `registryAudit.ts`, `runtimeTelemetry.ts`, `queries/overview.ts`, `queries/health.ts`, `queries/changes.ts`
- Target: `src/services/operationsRegistry/ringCentralSnapshot.ts`
- Knowledge: [`docs/knowledge/services/operations-registry.md`](../../../docs/knowledge/services/operations-registry.md) (lumps leftover `ringCentralRegistry.ts` / leftover `ringCentralValidation.ts` as “inbound-route snapshot used at Call Qualification time” — that sentence names **this** file, not leftover Owner write and not leftover account inventory). Call Qualification **asks** this file: [`docs/knowledge/services/ringcentral-call-lead-qualification.md`](../../../docs/knowledge/services/ringcentral-call-lead-qualification.md) (webhook uses the shared cached book; each Call Log run loads one immutable book; “Target-number gating always uses `resolveRingCentralInboundRoute(snapshot, phone, callStartedAt)`. There is no static fallback.”). Owner UI spec already names this file’s ingest gates: [`docs/operations-registry-source-connections-owner-ui-specification.md`](../../../docs/operations-registry-source-connections-owner-ui-specification.md) §3.6.1. Already-recommended leftover Owner write: [recommendations/operations-registry-ring-central-registry.md](operations-registry-ring-central-registry.md) (**asks** leftover `RINGCENTRAL_ROUTE_CACHE_KEY` after commit; does **not** resolve a call). Already-recommended leftover Call Log sweep: [recommendations/ringcentral-call-log-sync.md](ringcentral-call-log-sync.md) (**asks** leftover `loadRingCentralRouteSnapshot` once per sweep). Already-recommended leftover Call Log vet: [recommendations/ringcentral-call-log-vetting.md](ringcentral-call-log-vetting.md) (**asks** leftover `resolveRingCentralInboundRoute`). Already-recommended leftover webhook subscribe: [recommendations/ringcentral-webhook-subscriptions.md](ringcentral-webhook-subscriptions.md) (**asks** leftover load + leftover `listActiveRingCentralSnapshotNumbers` in per-number mode). Already-recommended leftover Analytics counts: [recommendations/ringcentral-analytics-reconcile.md](ringcentral-analytics-reconcile.md) (**asks** leftover load + leftover list-active; never resolves a call; never creates a Call Lead). Leftover account inventory: leftover `ringCentralValidation.ts` (next module). Leftover phone fold: leftover `ringcentral/phone-normalization.ts`. Leftover cache notify: leftover `cacheInvalidation.ts`. Leftover telemetry counters: leftover `runtimeTelemetry.ts`. Leftover `queries/health.ts` reads leftover resolver telemetry and leftover `validation_status === "invalid"` on the models — it does **not** import this file. Leftover `queries/overview.ts` counts routes on the models — it does **not** import this file. This checkout’s `CONTEXT.md` does not define inbound number / inbound route / Call Qualification — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: Wave B `ringcentral-webhook.routes.ts` leftover `enrichRingCentralSourceEvents` (**asks** leftover `loadRingCentralRouteSnapshot` then leftover `resolveRingCentralInboundRoute`, then leftover last-seen). Already-recommended leftover Call Log sweep (**asks** leftover load once, then leftover vet). Already-recommended leftover Call Log vet (**asks** leftover resolve; default empty frozen book). Already-recommended leftover webhook subscribe (**asks** leftover load + leftover list-active). Already-recommended leftover Analytics reconcile (**asks** leftover load + leftover list-active). Already-recommended leftover Owner write (**asks** leftover `RINGCENTRAL_ROUTE_CACHE_KEY` only). Barrel: `operationsRegistry/index.ts`. Tests: `ringCentralSnapshot.test.ts` (interval switch, gap / unknown, inactive company, closed history vs list-active, in-flight invalidation discards stale refresh). Leftover `call-log-vetting.test.ts` **asks** leftover `buildRingCentralRouteSnapshot` as a fixture. Already-recommended leftover evaluate / leftover promote / leftover session persist **do not import this file** — they read a leftover `routeResolution` leftover webhook enrich already stamped.
- Seams callers need: leftover load (process-memory book + stale serve) vs leftover build (pure from cards) vs leftover resolve (pure lookup); leftover serve-fresh-cache vs leftover `forceRefresh` vs leftover serve-stale-on-fail vs throw; leftover injectable `snapshotLoader` (file-test **adapter**); leftover `RINGCENTRAL_ROUTE_CACHE_KEY` forget (leftover Owner write after commit) vs leftover generation retry mid-refresh; leftover webhook shared cached book vs leftover Call Log one immutable book per sweep
- Split later (only if the file outgrows one sitting): this ~293-line file is one sitting if you read it as load the book of inbound numbers that have ever been turned on and still carry a valid stamp — rebuild from cards and assignment intervals whose company and call Feed are still live — say which live call Feed this number pointed at when the call started — half-open so the switch instant belongs to the new Feed — reuse a book younger than five minutes — if rebuild fails keep serving one younger than thirty minutes — forget immediately when the Owner writes a number, company, or Feed — never record the card — never ask RingCentral if the account can see the number — never decide whether the call was answered long enough to become a Call Lead. If it later splits: `loadTheInboundNumberBook.ts` / `rebuildTheInboundNumberBookFromCardsAndIntervals.ts` / `sayWhichLiveCallFeedThisNumberPointedAtWhenTheCallStarted.ts` — story files, never `create.ts` / `update.ts` / `delete.ts` / `cache.ts`, and never merge leftover Owner inbound-number write, leftover account inventory, leftover last-seen, leftover Call Qualification, leftover Call Lead promote, leftover phone fold, leftover telemetry, leftover health findings, or Wave B webhook HTTP into this file

`loadRingCentralRouteSnapshot` / `buildRingCentralRouteSnapshot` / `resolveRingCentralInboundRoute` are executor mechanics. The owner question is: *When an inbound call starts, which live call Feed does this RingCentral number point at? Load the book of numbers that have ever been turned on and still carry a valid stamp. For each assignment interval whose company and Feed are still live and on the call channel, fold the phone and remember the interval. Then, given a number and a call start, pick the latest interval that contains that instant — half-open, so the switch instant belongs to the new Feed. If the book is younger than five minutes, reuse it. If a rebuild fails, keep serving a book that is still younger than thirty minutes. If the Owner just wrote a number, a company, or a Feed, forget the book immediately and rebuild. This file does not record inbound-number cards. It does not ask RingCentral whether this account can see a number. It does not decide whether the call was answered long enough to become a Call Lead.*

Leftover Owner inbound-number write, leftover account inventory, leftover last-seen, leftover Call Qualification, leftover Call Lead promote, leftover phone fold, leftover cache notify, leftover telemetry, leftover health findings, leftover Granot “exactly one assignment,” and Wave B webhook HTTP already live in other **modules**. Do not pull those in.

## What this file actually does

Four operations of one “load the book of inbound numbers that have ever been turned on and still carry a valid stamp — rebuild from cards and assignment intervals whose company and call Feed are still live — say which live call Feed this number pointed at when the call started — half-open so the switch instant belongs to the new Feed — reuse a book younger than five minutes — if rebuild fails keep serving one younger than thirty minutes — forget immediately when the Owner writes a number, company, or Feed — never record the card — never ask RingCentral if the account can see the number — never decide whether the call was answered long enough to become a Call Lead” story, not “a RingCentral route cache helper,” and not leftover Owner write / leftover Call Qualification:

1. **Load or rebuild the inbound-number book** — `loadRingCentralRouteSnapshot`. If leftover `forceRefresh` is off and a book exists whose age is `<= max_age_ms` (env leftover `RINGCENTRAL_REGISTRY_SNAPSHOT_MAX_AGE_MS`, default 5 minutes) → return that book. No leftover telemetry. No leftover Operational Event. Else if a rebuild is already in flight → return that same promise. Else leftover `recordRegistryResolverAttempt("ringcentral")`, then leftover `refreshSnapshot`. Rebuild success freezes the book, leftover `recordRegistryResolverSuccess`, return it. Rebuild throw → leftover Operational Event `ringcentral.route_cache.refresh_failed` (`error`, leftover `notificationCandidate: true`, stale age + leftover `causeMessage` only), leftover `recordRegistryResolverFailure(..., "snapshot_refresh_failed")`. If a prior book is still younger than leftover `RINGCENTRAL_REGISTRY_LAST_KNOWN_VALID_MAX_AGE_MS` (default 30 minutes) → leftover `recordRegistryResolverStaleServe`, return that prior book. Else rethrow. Mid-rebuild, leftover Owner write / leftover company / leftover Feed forget bumps leftover `cacheGeneration` and nulls the book; leftover `refreshSnapshot` retries until the generation it started with is still current. This beat does **not** resolve a call. This beat does **not** ask RingCentral. This beat does **not** write a Registry Change.

2. **Rebuild the book from cards and assignment intervals** — `buildRingCentralRouteSnapshot` (pure) and leftover `loadSnapshotFromDatabase` (Mongo **adapter**). Leftover loader selects leftover `{ ever_activated: true, validation_status: "valid" }` routes, every assignment sorted by leftover `effective_from`, every company, leftover `channel: "call"` Feeds, plus leftover env `RINGCENTRAL_REGISTRY_MAPPING_CHECKSUM`. Leftover build walks assignments: missing leftover route / leftover company / leftover Feed → skip; leftover `company.active === false` or leftover `granularity.active === false` → skip; leftover Feed not leftover `call` → skip; leftover Feed’s leftover `source_company` ≠ leftover company → skip; leftover phone fold miss or missing leftover `effective_from` → skip. It does **not** read leftover `assignment.active`. It does **not** read leftover `route.active`. It does **not** re-check leftover `ever_activated` / leftover `valid` (those live only on leftover loader). Fold leftover `effective_until`. Push leftover `RingCentralRouteSnapshotEntry`. Sort each phone’s intervals by leftover `effective_from`. Freeze. This beat does **not** pick an interval for a call. This beat does **not** ask leftover Owner write.

3. **Say which live call Feed this number pointed at when the call started** — `resolveRingCentralInboundRoute`. Fold the phone. Invalid leftover `callStartedAt` or leftover fold miss → `null`. Walk that phone’s intervals **newest first**. Hit when leftover `effective_from <= at` and (no leftover `effective_until` **or** leftover `at < effective_until`). Return leftover `RingCentralRouteResolution` (ids, slugs, leftover label snapshots) **without** the dates. Miss / unknown number / gap → `null`. There is no static leftover `call-lead-sources.ts` fallback. This beat does **not** decide leftover answered / leftover two minutes. This beat does **not** stamp leftover last-seen.

4. **List the numbers in the book — or only those that have a live interval now** — `listRingCentralSnapshotNumbers` (every folded phone in the book, sorted) and `listActiveRingCentralSnapshotNumbers` (same list, keep leftover resolve ≠ `null` at leftover `at`, default `now`). Already-recommended leftover subscribe (per-number) and leftover Analytics counts **ask** leftover list-active. This beat does **not** resolve one incoming call. This beat does **not** POST a leftover subscription.

There is no fifth Owner-write operation. There is no leftover account-inventory operation. There is no leftover last-seen operation. There is no leftover Call Qualification operation. Leftover `loadSnapshotFromDatabase` is the Mongo **adapter**. Leftover `setRingCentralSnapshotLoaderForTests` is the file-test **adapter**. Leftover `onRegistryCacheInvalidation` is the forget **adapter**. Leftover `normalizePhoneNumberToE164Like` is the phone-fold **adapter**. Leftover `recordRegistryResolver*` is the counter **adapter**. Wave B leftover webhook enrich is a second load+resolve **adapter**; already-recommended leftover Call Log sweep is a third (one book per sweep). Already-recommended leftover evaluate / leftover promote read a leftover `routeResolution` leftover enrich already stamped — they are not this story.

`resetRingCentralRouteSnapshotForTests` / leftover `toDate` / leftover `readPositiveMs` sit on the load and rebuild paths. They are not extra owner operations. Do not export leftover `refreshSnapshot` / leftover `loadSnapshotFromDatabase` / leftover `getLastKnownValidMaxAgeMs` as a public **seam**. Do not invent a dashboard for leftover `mapping_checksum` in this rename — no caller reads it.

## Organization

Keep one file as the screenplay for “load the book of inbound numbers that have ever been turned on and still carry a valid stamp, rebuild from cards and assignment intervals whose company and call Feed are still live, say which live call Feed this number pointed at when the call started, half-open so the switch instant belongs to the new Feed, reuse a book younger than five minutes, if rebuild fails keep serving one younger than thirty minutes, forget immediately when the Owner writes a number, company, or Feed, never record the card, never ask RingCentral if the account can see the number, never decide whether the call was answered long enough to become a Call Lead.” Leftover Owner inbound-number write, leftover account inventory, leftover last-seen, leftover Call Qualification, leftover Call Lead promote, leftover phone fold, leftover cache notify, leftover telemetry, leftover health findings, leftover Granot “exactly one assignment,” and Wave B webhook HTTP already live in deeper **modules**. Do not pull those in. Do not invent a `RingCentralSnapshotService` class. Do not invent a begin / complete **seam** — this file has no transaction. Do not invent a second resolve **adapter** beside leftover `resolveRingCentralInboundRoute`. Do not invent a second forget **adapter** beside leftover `RINGCENTRAL_ROUTE_CACHE_KEY` + leftover `onRegistryCacheInvalidation`.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `cache.ts` as a CRUD folder. Those are persistence verbs, and this file does not persist cards. Do not move leftover Owner write into this file so “one file owns inbound mapping.” Do not move leftover account inventory into this file so “the book owns valid.” Do not silently add leftover `active: true` to leftover loader so “archive hides the card from ingest” — leftover archive already stops ingest by closing the assignment interval. Do not silently start reading leftover `assignment.active` so “closed rows drop out of history.”

**External interface** stays small (this is the test surface). Load, rebuild, resolve, and list-active are one story’s inbound-number book, not four CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `loadRingCentralRouteSnapshot` | `loadTheInboundNumberBook` | leftover webhook enrich, leftover Call Log sweep, leftover subscribe, leftover Analytics counts |
| `buildRingCentralRouteSnapshot` | `rebuildTheInboundNumberBookFromCardsAndIntervals` | leftover loader **asks** this; leftover tests and leftover Call Log vet fixtures pass in-memory cards |
| `resolveRingCentralInboundRoute` | `sayWhichLiveCallFeedThisNumberPointedAtWhenTheCallStarted` | leftover webhook enrich and leftover Call Log vet both **ask** this; leftover list-active **asks** it too |
| `listRingCentralSnapshotNumbers` | `listTheNumbersInTheInboundNumberBook` | leftover list-active walks this; barrel already exports it |
| `listActiveRingCentralSnapshotNumbers` | `listTheNumbersThatHaveALiveIntervalNow` | leftover subscribe (per-number) and leftover Analytics counts |
| `RINGCENTRAL_ROUTE_CACHE_KEY` | `forgetTheInboundNumberBookKey` | leftover Owner write invalidates this **after** commit |
| `RingCentralRouteSnapshot` | `InboundNumberBook` | leftover Call Log sweep holds one per run; leftover webhook reuses the cached one |
| `RingCentralRouteResolution` | `LiveCallFeedStampAtCallStart` | leftover ingest / leftover session already copy these ids and leftover label snapshots |
| `resetRingCentralRouteSnapshotForTests` / `setRingCentralSnapshotLoaderForTests` | keep as test **adapters** | leftover in-flight invalidation proof |

Keep the old names as one-line aliases until leftover Call Log sweep, leftover Call Log vet, leftover webhook enrich, leftover subscribe, leftover Analytics, leftover Owner write, the barrel, and leftover `ringCentralSnapshot.test.ts` migrate. Do not make callers learn `refreshSnapshot` / `loadSnapshotFromDatabase` / `entries_by_phone` as the domain language.

**Principle: old exports stay as aliases.** `loadRingCentralRouteSnapshot` / `resolveRingCentralInboundRoute` remain the imported names until leftover Call Log and leftover webhook enrich migrate. Leftover cache key string `ringcentral_routes` stays that string — leftover Owner write already sends it. Leftover env names stay those names.

**No class for the workflow.** The types that *do* earn names are the book leftover Call Log already holds for one sweep and the stamp leftover ingest already copies:

```ts
type InboundNumberBook = Readonly<{
  version: 1
  built_at: Date
  max_age_ms: number
  mapping_checksum?: string
  entries_by_phone: ReadonlyMap<string, readonly InboundNumberInterval[]>
}>

type InboundNumberInterval = LiveCallFeedStampAtCallStart & {
  effective_from: Date
  effective_until?: Date
}

type LiveCallFeedStampAtCallStart = {
  route_id: string
  assignment_id: string
  normalized_target_number: string
  company_id: string
  company_slug: string
  company_label_snapshot: string
  granularity_id: string
  granularity_key: string
  granularity_label_snapshot: string
  crm_label_snapshot: string
}
```

That is the handoff from “the book is loaded” to “leftover webhook enrich / leftover Call Log vet may stamp a call, leftover subscribe / leftover Analytics may list live numbers, leftover promote may copy the stamp onto a Call Lead.” Do **not** add leftover `active` so “the book owns archive,” do **not** add leftover `validation_status` so “the book owns leftover ask-RingCentral,” and do **not** drop leftover `assignment_id` so “one stamp is enough for leftover ingest.”

Do not add leftover `withRegistryMutation` as a public **seam** — leftover `registryAudit.ts` already owns that. Do not add leftover `validateRingCentralNumberAgainstAccount` as a public **seam** — leftover `ringCentralValidation.ts` already owns that. Do not add leftover `createOrUpdateRingCentralRoute` as a public **seam** — leftover `ringCentralRegistry.ts` already owns that. Do not add leftover `normalizePhoneNumberToE164Like` as a public **seam** — leftover `ringcentral/phone-normalization.ts` already owns that. Do not add leftover `qualifyRingCentralCall` as a public **seam** — leftover Call Qualification already owns that.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// ringCentralSnapshot.ts
// When an inbound call starts, which live call Feed does this number point at?
// Load the book of numbers that have ever been turned on and still carry a valid stamp.
// Rebuild from cards and assignment intervals whose company and call Feed are still live.
// Pick the latest interval that contains the call start — half-open,
// so the switch instant belongs to the new Feed.
// Reuse a book younger than five minutes.
// If rebuild fails, keep serving a book younger than thirty minutes.
// If the Owner just wrote a number, a company, or a Feed, forget immediately.
// This file does not record the card.
// This file does not ask RingCentral if the account can see the number.
// This file does not decide whether the call was answered long enough
// to become a Call Lead.

// ── 1. Load or rebuild the inbound-number book ────────────

export async function loadTheInboundNumberBook(options?: { forceRefresh?: boolean; now?: Date })

async function rebuildUntilTheForgetGenerationIsStillCurrent(startedAt)
function serveThePriorBookIfItIsStillYoungEnoughOrRethrow(error, now)

// ── 2. Rebuild from cards and assignment intervals ────────

export function rebuildTheInboundNumberBookFromCardsAndIntervals(input, builtAt?)

async function loadEverActivatedValidCardsAndEveryAssignment(now)
function skipUnlessTheCompanyAndCallFeedAreStillLiveAndBelongTogether(assignment, cards)
function foldThePhoneAndRememberTheInterval(assignment, route, company, feed)

// ── 3. Say which live call Feed at call start ─────────────

export function sayWhichLiveCallFeedThisNumberPointedAtWhenTheCallStarted(
  book,
  phoneNumber,
  callStartedAt,
)  // [from, until); newest interval that contains `at`; no static fallback

// ── 4. List numbers — or only those live now ──────────────

export function listTheNumbersInTheInboundNumberBook(book)
export function listTheNumbersThatHaveALiveIntervalNow(book, at?)
```

Read the primary path out loud: *An inbound call starts. Load the book — reuse it when it is younger than five minutes, rebuild when it is older or forgotten. Rebuild only from numbers that have ever been turned on and still carry a valid stamp, and only from assignment intervals whose company and call Feed are still live and belong together. Fold the phone. Pick the latest interval that contains the call start; the switch instant belongs to the new Feed. A gap, an unknown number, or a missing start is no Feed. If rebuild fails, keep serving a book younger than thirty minutes, else fail closed. Forget the book after an Owner write lands. Do not record the card. Do not ask RingCentral. Do not decide whether the call becomes a Call Lead.*

That is the operation. `loadRingCentralRouteSnapshot` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Leftover loader does not read leftover `active`.** Leftover `{ ever_activated: true, validation_status: "valid" }` is the ingest gate. Leftover archive stops leftover resolve by **closing the assignment interval**, not by leftover `active: false`. A later leftover invalid stamp drops the card from leftover loader while leftover Owner list can still say leftover-active. Leftover Owner UI spec already names this. Do not silently add leftover `active: true` so “archive hides the card” — leftover `ringCentralRegistry.ts` already recommended that leftover close is the stop.

2. **Leftover `assignment.active` is ignored.** Leftover build keys only leftover `effective_from` / leftover `effective_until`. Leftover tests stamp leftover `active: false` on a closed interval and leftover resolve still returns that history. Do not silently skip leftover `active: false` rows so “closed assignments drop out of the book” — leftover Call Log of last week’s call would miss the Feed it used.

3. **Leftover build skips an inactive company or Feed for every interval, including history.** Leftover archive of a Feed (leftover `granularity.active === false`) removes that assignment from the book entirely. A leftover Call Log sweep of a call from last week then leftover-resolves `null`. Leftover Owner UI spec condition 4 names the live-Feed check. Do not silently keep historical intervals for an archived Feed so “history survives Feed archive” without a paired leftover Call Log test.

4. **Leftover build does not re-check leftover `ever_activated` / leftover `valid`.** Those filters live only on leftover `loadSnapshotFromDatabase`. Leftover `ringCentralSnapshot.test.ts` and leftover `call-log-vetting.test.ts` already leftover-resolve books built without those fields. Do not silently add those filters to leftover build so “one function owns ingest gates” without rewriting those fixtures.

5. **The book lives in process memory.** Leftover `cachedSnapshot` is one instance. Leftover Owner write forgets leftover `RINGCENTRAL_ROUTE_CACHE_KEY` on the instance that committed. Other leftover Vercel instances wait up to leftover five minutes. Leftover Owner UI spec says “activation invalidates it immediately through `cacheInvalidation`.” That sentence is true only on the writing instance. Do not silently invent a shared leftover Redis book so “forget is cluster-wide” in this rename.

6. **Leftover stale serve does not rewind leftover `built_at`.** A leftover refresh fail that leftover-serves the prior book leaves leftover `built_at` old, so the next leftover load still tries leftover rebuild. Leftover `serving_stale` lives on leftover telemetry, not on the book. Do not silently stamp leftover `built_at = now` on leftover stale serve so “we stop retrying.”

7. **Leftover Operational Event fires even when leftover stale serve then succeeds.** Leftover `ringcentral.route_cache.refresh_failed` is leftover `notificationCandidate: true` before leftover `recordRegistryResolverStaleServe`. Leftover health later reads leftover telemetry, not this event, for leftover “stale snapshot” findings. Do not silently skip the event when leftover stale serve happens so “the Owner is not paged for a still-usable book” without a paired leftover health test.

8. **Leftover `mapping_checksum` is copied from leftover env and never read.** No leftover Call Log / leftover webhook / leftover health caller compares it. Do not silently start refusing leftover resolve when leftover checksum mismatches so “we detect a mapping drift.”

9. **Leftover last-seen does not forget this book.** Already-recommended leftover Owner write named that leftover `stampLastSeenOnTheInboundNumber` skips leftover `RINGCENTRAL_ROUTE_CACHE_KEY`. This file does not key on leftover `last_seen_*`. Do not silently listen for leftover last-seen so “the card looks fresher.”

10. **Leftover list-all includes historically-only numbers; leftover list-active does not.** Leftover subscribe and leftover Analytics **ask** leftover list-active. Do not silently point those leftover callers at leftover list-all so “we keep watching archived numbers.”

11. **There is no leftover test for leftover stale serve, leftover five-minute reuse, leftover loader `ever_activated`+`valid`, or leftover inactive Feed dropping history.** Leftover interval / leftover gap / leftover inactive company / leftover closed-history list-active / leftover in-flight invalidation are the proofs on disk. A later implementer must add the proofs below — do not treat leftover Call Log vet fixtures as leftover loader proofs.

12. **Leave sibling modules alone.** Leftover `createOrUpdateRingCentralRoute` / leftover `activateRingCentralRoute`, leftover `validateRingCentralNumberAgainstAccount`, leftover `recordRingCentralRouteObservation`, leftover `vetRingCentralCallLogRecord`, leftover `qualifyRingCentralCall`, leftover `ingestRingCentralQualifiedCall`, leftover `normalizePhoneNumberToE164Like`, leftover `onRegistryCacheInvalidation`, leftover `recordRegistryResolver*`, leftover Granot `assertSingleActiveRingCentralAssignment`, leftover health findings, and Wave B leftover webhook enrich are already the right **depth**. This file orchestrates the inbound-number book.

13. **Knowledge’s “`ringCentralRegistry.ts` / `ringCentralValidation.ts` — inbound-route snapshot used at Call Qualification time” sentence is this file.** Do not “fix” that sentence in this rename by moving leftover `buildRingCentralRouteSnapshot` into leftover Owner write or leftover account inventory.

14. **Do not silently change leftover `RINGCENTRAL_ROUTE_CACHE_KEY`.** Leftover Owner write already sends leftover `ringcentral_routes`. Re-label that string only as a separate, tested change with leftover `withRegistryMutation` after-commit.

## Testing

The **interface** is the test surface: `loadTheInboundNumberBook`, `rebuildTheInboundNumberBookFromCardsAndIntervals`, `sayWhichLiveCallFeedThisNumberPointedAtWhenTheCallStarted`, `listTheNumbersThatHaveALiveIntervalNow`.

Today leftover `ringCentralSnapshot.test.ts` proves leftover interval switch, leftover gap / unknown, leftover inactive company, leftover closed-history vs leftover list-active, and leftover in-flight invalidation. Keep those. Add tests that name the operation:

**Rebuild / resolve**
- Leftover switch instant belongs to the **new** Feed (`effective_from <= at < effective_until`). Already on disk — keep the leftover ISO times.
- Leftover gap after leftover `effective_until` → `null`. Leftover unknown number → `null`. Leftover invalid leftover `callStartedAt` → `null`. Leftover fold miss → `null`.
- Leftover `assignment.active: false` on a closed interval still leftover-resolves inside that interval.
- Leftover inactive company → leftover list-active `[]` (already on disk). Leftover inactive Feed → same skip. Leftover Feed whose leftover `source_company` ≠ leftover company → skip.
- Leftover build given a leftover unvalidated / leftover never-activated route still leftover-resolves (leftover loader, not leftover build, owns those gates). Do **not** change that without a paired leftover loader test.

**Load / forget / stale**
- Leftover book younger than leftover five minutes → leftover reuse; leftover `recordRegistryResolverAttempt` is **not** called.
- Leftover `forceRefresh` rebuilds even when leftover young.
- Leftover Owner write leftover-invalidates leftover `RINGCENTRAL_ROUTE_CACHE_KEY` / leftover `source_companies` / leftover `source_granularities` mid-rebuild → leftover generation retry, leftover stale book discarded (already on disk).
- Leftover rebuild throw + leftover prior book younger than leftover thirty minutes → leftover Operational Event `ringcentral.route_cache.refresh_failed`, leftover `snapshot_refresh_failed`, leftover stale serve, return leftover prior book.
- Leftover rebuild throw + leftover prior book older than leftover thirty minutes, or no leftover prior book → leftover rethrow. Leftover Call Log sweep already maps leftover `route_snapshot` failure to leftover fail-closed.

**List-active**
- Leftover closed-only history at leftover `at` after leftover `effective_until` → `[]` (already on disk).
- Leftover open interval at leftover `now` → that leftover folded phone. Leftover subscribe / leftover Analytics **ask** this list, not leftover list-all.

Do **not** add a test per helper (`skipUnlessTheCompanyAndCallFeedAreStillLiveAndBelongTogether`, `serveThePriorBookIfItIsStillYoungEnoughOrRethrow`, `foldThePhoneAndRememberTheInterval`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

`buildRingCentralRouteSnapshot` stays exported because leftover Call Log vet fixtures and leftover in-memory tests are a second real **adapter**, not a test leak. Leftover `setRingCentralSnapshotLoaderForTests` stays injectable because leftover in-flight invalidation is a second real **adapter**. Leftover `RINGCENTRAL_ROUTE_CACHE_KEY` stays exported because leftover Owner write is a second real **adapter**. Do **not** retest leftover phone fold or leftover telemetry counters here.

## What I would not do

- A `RingCentralSnapshotService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap leftover `normalizePhoneNumberToE164Like` or leftover `Map.get`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `cache.ts`) for cleanliness.
- Breaking the leftover serve-fresh-cache / leftover rebuild / leftover serve-stale-on-fail / leftover throw **seam**. A leftover rebuild fail must not invent a book. A leftover forget mid-rebuild must not publish leftover stale cards.
- Treating leftover Owner inbound-number write, leftover account inventory, leftover last-seen, leftover Call Qualification, leftover Call Lead promote, leftover phone fold, leftover health findings, leftover Granot “exactly one assignment,” leftover Source Feed activate, or Wave B webhook HTTP as this story.
- Inventing a **seam** that has only one **adapter**.
- Silently “fixing” a known order gap while recommending a rename: do not filter leftover `active` on leftover loader; do not skip leftover `assignment.active: false`; do not keep historical intervals for an archived Feed without a paired leftover Call Log test; do not add leftover `ever_activated` / leftover `valid` to leftover build without rewriting leftover fixtures; do not invent a shared leftover Redis book; do not stamp leftover `built_at = now` on leftover stale serve; do not skip leftover `refresh_failed` when leftover stale serve happens; do not refuse leftover resolve on leftover `mapping_checksum`; do not forget the book on leftover last-seen; do not point leftover subscribe / leftover Analytics at leftover list-all; do not move leftover Owner write or leftover account inventory into this file; do not “fix” leftover knowledge’s leftover registry/validation sentence by relocating leftover build.
- Jumping to the next service while this one has unchecked modules.
- Writing a whole-folder recommendation for `operationsRegistry`.
