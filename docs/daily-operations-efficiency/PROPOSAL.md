# Daily Operations efficiency proposal and implementation specification

**Status:** implementation authorized 23 October 2026; release implementation and verification in progress. See [release runbook](RELEASE.md).
**Date/evidence cutoff:** 23 October 2026, approximately 19:49 UTC.
**Decision:** remove Redis and long-lived streams from Daily Operations. Use one shared, visible-tab poll every 60 seconds against a globally coalesced Mongo read view. Stop generating redundant no-change display facts; preserve canonical business/audit evidence and retained Sheet Sync facts. Eventual consistency is explicitly accepted for these indicators.

## Implemented release decisions

The final implementation uses permanent null/false Redis compatibility helpers, rather than the earlier reversible transport gate described in the phased proposal. The authenticated legacy live endpoint returns 204 immediately; it never falls back to a Mongo tail. Server deploys before Admin, with a short interval of unavailable legacy indicators instead of high-frequency compatibility queries. Old milestone bundles may still retry an empty 204 every 30 seconds until reloaded. Core business processing is unaffected by that presentation interval.

The shared read view, persisted retry deadlines, five-minute auxiliary scopes, no-op suppression, transactional counter writer and rebuild revision fencing are implemented. The historical evidence and proposed phases below are retained for context; [RELEASE.md](RELEASE.md) describes the shipped contract, validation, deployment order and rollback constraints.
## 1. Scope and invariants

This changes a low-priority presentation/projection surface: Today → Operations (`/?tab=operations`), its milestone toasts, and its ancillary spend/goals displays. It does not change lead ingestion, Granot synchronization decisions, Bookings, Cancellations, official money calculations, Sheet Sync processing, security controls, or the core Outreach Desk's required freshness.

MongoDB remains the System of Record, consistent with workspace ADR-0001. Preserve immutable Synchronization Decisions, Granot Observation Receipts, business records, existing append-only Daily Operations Events, and their retention. No historical purge, credential deletion, database migration to another provider, billing change, or production write test is part of this proposal. The separate Mission Control sprint is out of scope.

The user authorized implementation on main, documentation updates and deployment by pushing main on 23 October 2026. The earlier investigation-only scope is superseded for that implementation; prohibitions on destructive historical pruning, billing changes and unrelated work remain.

## 2. Verified production and measured evidence

The checkout is `C:\Users\Pinda\Proyectos\vantage`. Git remotes identify the work repositories as `jbell-rusty-vantage/vantage-movers-server` and `jbell-rusty-vantage/vantage-admin`.

The authenticated Vercel CLI user is `overton77`, with access to team `Vantage` (`vantage-4d3db9ef`, `team_tVdLH8ZMMtS3MsmAdbRsoGDv`). Production metadata confirms:

- Server: https://vantage-movers-main-server.vercel.app ; deployment `dpl_4waKQmzE21namq6PmRPS3DgMpyZ1`, READY, commit `e6908692266e1eae89d63b0b4041a99ee007f164`.
- Admin: https://vantage-admin-rho.vercel.app ; deployment `dpl_836vWXCAhL6hxSVesDpMCrG1i6e3`, commit `27d899eaba7e471bd03621782abaf037c28c59d5`.
- Both hashes match local HEAD. Relevant application files were not among the existing uncommitted changes.

The supplied provider notice establishes that the Upstash Free allowance of **500,000 monthly commands** was exhausted **21 October at 14:55:45 UTC**. The exact supplied console is https://console.upstash.com/vercel/kv/6795bad2-c0a2-4c8a-a40f-6229c54256ba . It redirected to Vercel sign-in in this browser; authenticated CLI logs and Mongo reads were available. Vercel's Pro team plan does not establish an Upstash upgrade.

Observed consequences:

- A production log at **23 October 19:44:14.295 UTC**, `/api/webhooks/granot/priority-updated`, records `daily_operations.redis.xadd_failed` with `ERR max requests limit exceeded. Limit: 500000, Usage: 500000`; the request returned **202**. A bounded 100-entry sample contained 41 quota-error entries over approximately 18:30–19:44 UTC. This is a sample, not a total outage count.
- Mongo contains **51,970 new Daily Operations Events since the cutoff**, starting at **14:55:46.577 UTC**. None has a successful Redis stream ID. Latest successful publication marker: **21 October 14:47:04.207 UTC**. No later recovery/upgrade was verified.
- Those facts include **85 Form Leads created, 20 Call Leads created, 12 Bookings created, 80 texts sent, and 4,525 Sheet Sync completions**. Workflows continued; this does not prove every expected workflow succeeded or every text was delivered.
- Five existing `/api/v1/admin/daily-operations/live` requests returned HTTP 200 between **19:34 and 19:47 UTC** on October 23, including repeated roughly four-minute openings. The verified `/health` returned 200 `ok`. Neither signal proves all SSE cards rendered successfully.

Read-only aggregation measured the last complete week, **16–22 October UTC**:

| Fact | Count | Meaning |
|---|---:|---|
| All Daily Operations Events | 152,784 | ~21,826/day; ~676,615/month at 31 days |
| `granot.observed`, `already_current` | 111,715 | New display fact despite no changed state |
| `granot.observed`, `stale` | 12,814 | Repeated stale-observation display fact |
| `granot.linked` | 12,750 | Retain; distinguish meaningful application/link evidence |
| `sheet_sync.completed` | 13,104 | Retain; used as durable completion evidence in rebuild |

The two no-change outcomes are **81.5%** of all facts. Other `granot.observed` outcomes include policy blocks/conflicts; they must not be filtered indiscriminately. October-to-date contained 218,449 facts, including 165,024 `granot.observed` (75.5%).

## 3. Current paths, storage, and amplification

### Redis inventory

The current runtime client owner is [`src/config/domain/dailyOperations.ts`](../../src/config/domain/dailyOperations.ts). Runtime inventory across server, Admin, clients and MCP found no other current Redis owner.

| Key | Contents | Retention/purpose |
|---|---|---|
| `dailyops:{production|preview|local}:stream:{YYYY-MM-DD}` | `event_id`, `day`, `kind`, `lane`, `occurred_at`, `dedupe_key` | Disposable live doorbell; `XADD MAXLEN ~ 2000`; **no key TTL/EXPIRE** in current code |

Day keys use New York time. Environment prefixes separate names, not provider quotas when credentials are shared. Local/preview can publish when credentials exist. TEST_MODE/test runner suppress Redis. The optional pub/sub channel in the historical spec is unused. No Redis-backed session, authentication, rate limiter, lock, business record, or job queue was found. Actual old keys and other external consumers were not scanned.

Mongo stores the real cards in `daily_operations_events`, counters in `daily_operations_days`, and canonical facts in the business/audit collections. Existing Daily Operations Events have a **400-day Mongo TTL**, distinct from the Redis stream's retention.

### Read and connection multipliers

- [`liveStream.ts:20`](../../src/services/dailyOperations/liveStream.ts) defines a one-second sleep. The live router injects it at [`daily-operations-admin.routes.ts:104`](../../src/routes/daily-operations-admin.routes.ts). Each connection issues one logical XREAD per loop, including empty reads. Network latency/reconnect gaps slightly reduce the nominal rate.
- The 240-second stream lifetime leads to reconnection, not a spending cap. A valid Last-Event-ID normally causes a Mongo remembered-event lookup; otherwise startup performs a snapshot and newest-event query. Normal Redis polling resumes.
- Admin `components/daily/daily-shell.tsx:366` opens the board EventSource. Its visibility handler at line 306 changes the Paused label but does not close the transport.
- **A second global stream** is opened by `components/daily/milestone-toast.tsx:89`, mounted by `components/layout/dashboard-shell.tsx:260` for Owner/Manager and `components/outreach-desk/shell/desk-shell.tsx:224` for non-reps. Hiding its toast on the board does not close it. An Operations tab can have **two** one-second readers; another dashboard page can retain one.
- One connection at 8h × 22 days is **633,600 reads/month**; two are **1,267,200**. A continuous connection for 31 days is **2,678,400**. The old spec incorrectly labeled the 28,800 daily total as a monthly total.
- On successful Redis reads, the server looks up each notified event in Mongo for **each connection**, even if a toast later discards it. When XREAD throws or Redis is absent, [`liveStream.ts:149`](../../src/services/dailyOperations/liveStream.ts) performs **one indexed Mongo tail query per connection per second**. It retries Redis next loop, with no circuit breaker. An empty successful read does not invoke fallback.
- [`snapshot.ts:126`](../../src/services/dailyOperations/snapshot.ts) performs **five Mongo queries**: three day documents, open-intake count, held-message count. The board initially fetches this separately from the SSE snapshot, also refreshes every five minutes, and can perform lane backfills. The local display clock does not query the network.
- Daily Operations `lead-spend-panel.tsx:13` polls every 30 seconds and receives extra lead-event invalidations. `team-call-goals.tsx:63` opens the separate Outreach stream plus its 30-second team fallback poll. These lower-priority widgets need separate slower display reads; do not globally slow the working Outreach Desk.
- Admin `app/api/daily-operations-live/route.ts:68` does not pass `request.signal` to upstream fetch. Verify cancellation while a compatibility stream exists.

### Mongo writes

For each newly inserted event on an existing open day, [`recordDailyOperationsFact.ts:129`](../../src/services/dailyOperations/recordDailyOperationsFact.ts) performs:

1. Insert event.
2. Read day status.
3. Read day existence again.
4. Increment day counters.
5. If Redis succeeds, update the event's Redis stream ID.

That is **2 reads + 2 mutations during exhaustion**, or **2 reads + 3 mutations when Redis works**; the first event/day adds a seed insert. This is code-derived operation count, not Atlas billing telemetry. Transactions, authentication, indexes and driver metadata have additional costs.

[`recordGranotFacts.ts:229`](../../src/services/dailyOperations/recordGranotFacts.ts) maps already-current/stale outcomes to `granot.observed`, deduping by a new decision ID. The immutable Synchronization Decision and receipt are already persisted independently by the lifecycle processor. Duplicating that outcome into a second long-lived display record is unnecessary.

No runtime consumer of `DailyOperationsDay.decisions.*` was found beyond its writer/rebuild. The snapshot API does not expose these fields. Conversely, [`rebuild.ts:403`](../../src/services/dailyOperations/rebuild.ts) explicitly uses per-job Sheet Sync events as the durable completion record; suppressing them would lose reconstructability.

## 4. Selected architecture and freshness contract

### A. Zero Redis, no Daily Operations SSE

Daily Operations will construct no Redis client, issue no XADD/XREAD, and open no SSE transport in the selected mode. Keep the existing credentials and unrelated dependencies during rollout; no destructive housekeeping is needed. This provides **zero Daily Operations Redis commands**, including during cache expiry, Mongo failure, hidden tabs, reconnects, and background fact recording.

The current exhausted quota remains exhausted until the provider resets it or an independently authorized plan change occurs. This change stops dependence on that quota; it does not restore it.

### B. One visible-tab read coordinator

One provider, mounted once for an authorized dashboard shell, feeds both the Operations board and milestone toast. Poll **no more than once every 60 seconds**, use jitter that never shortens that interval, single-flight requests, and abort on hide/unmount. No overlapping timer, focus invalidation, per-event invalidation, or independent toast transport. On return to visibility, make one shared refresh if due. Preserve per-request active-user/token-version checks; do not trade security checks for caching.

Core counters and bounded retained feed: **60–120 seconds of normal lag**, plus at most 5 seconds of source-refresh work. Show the actual generated time. Mark data stale above 180 seconds, retain last-good values, and show unavailable if no complete value exists; never replace unavailable data with zeros.

Spend and Daily Operations-only goal displays: **five-minute source refresh**, yielding approximately **5–6 minutes** of normal lag. Reuse a narrow summary of existing authoritative services, with separate permission-safe cache scope. Eliminate this page's Outreach stream/30-second poll without changing core Outreach behavior or official money calculations.

Milestone toasts become best-effort delayed UI notifications. Facts remain durable. On initial load establish a baseline; subsequent unique IDs may toast once per session, within a 15-minute age window. Keep at most 50 recent milestone candidates, report truncation/available history, and avoid replaying old celebrations after a long absence. A bounded feed is not the audit archive.

### C. Demand-driven, globally shared Mongo read view

Add a versioned internal `daily_operations_read_views` collection, unique on `{environment, New_York_day, permission_scope, schema_version}`. Store one complete projected response, revision/content ETag, generated time, source coverage, next refresh time, and a fenced refresh lease. The production base view uses one shared `dailyops_core` permission scope for the fields already authorized identically for Owner/Manager; do not create duplicate per-user or per-role core producers. Owner-only spend remains in an Owner-only scope. The server selects one active schema version; clients cannot request competing materializers. Preview/local/test use isolated keys/collections and do not build the production view. HTTP remains private; never expose a shared public/CDN cache.

Refresh at most once/minute **across Vercel instances**, only while reads create demand:

1. Read the cached view. Return it immediately if fresh.
2. If due, atomically claim a 15-second lease only when `next_attempt_at <= now` and no valid owner exists. In that same claim, set `next_attempt_at = now + 60 seconds` (300 seconds for auxiliary bundles), so even a crashed owner cannot cause a new source build after each 15-second lease expiry. Use an unguessable lease token plus monotonic generation. A unique index handles concurrent first creation. Lease heartbeat writes are unnecessary within the five-second build budget.
3. The winner awaits a bounded build; do not launch an unawaited background promise. Other requests receive last-good data and its age. A cold miss without a complete value returns explicit initializing/unavailable plus Retry-After, not a fabricated empty board.
4. Build the base snapshot using **one `$in` query for the three day documents**, the two existing current-state counts, and one indexed newest retained-events page (80). A separate indexed milestone-kind query (50) makes **five source queries for the complete core+toast view**, rather than pretending that milestone history is free. A core-only build without it is four. No per-envelope findById loop.
5. Publish the entire result with a compare-and-set on token/generation and unexpired lease; increment content revision only when content changes. Release the lease in that update. An expired worker cannot overwrite a successor. Failed builds retain last-good data, set bounded retry/backoff, and cannot attempt more than once/minute.

Set per-query `maxTimeMS` and a total five-second build budget; use projections/lean results and response-size bounds. Index the retained event queries by day/order, and day/kind/order for milestone selection; validate plans before rollout. Cache auxiliary summaries at five minutes under their own scopes. Their actual source-query counts must be recorded and fit an explicit bounded bundle before enabling them; do not use the full team payload when only goals are needed. No periodic full-day domain/decision scan is part of a normal refresh. With no viewers, no refresh work runs.

Return `schema_version`, `day`, `timezone`, `revision`, `generated_at`, `freshness`, `poll_after_ms >= 60000`, `snapshot`, bounded `events`, bounded `milestones`, and coverage/truncation flags. Conditional requests may return 304 after authorization/cache lookup. Apply snapshots by **replacement**, not by replaying metric increments. Retain paginated event-history endpoints for explicit navigation.

The current business-time cursor can miss a newly inserted backdated event. Do not promise lossless incremental delivery using `occurred_at` alone. The bounded periodically replaced display and authoritative counter snapshot recover presentation; complete audit history remains paginated. Any future lossless incremental transport needs an ingestion/projection revision and late-commit handling, not an invented `createdAt` on SynchronizationDecision (that schema has no timestamps).

### D. Remove redundant facts; make retained projection writes atomic

- At the Daily Operations hook only, return before insertion for outcome **already_current** or **stale**. Keep original durable receipts/decisions and their retention unchanged. Do not stop Granot collection or synchronization.
- Retain policy-block/conflict/unsupported/error cases and meaningful applied/linked/minted/pending/unmatched events; retain business, Sheet Sync completion/failure, exception, and milestone facts.
- Retire unused `DailyOperationsDay.decisions.*` updates and their rebuild scan explicitly. Keep historical fields compatible/read-only; no data purge. Removing only display counters must not alter Granot Health/audit reporting. Align the catalog, rebuild and agreement tests so a rebuild cannot silently reintroduce retired counts.
- Retained events with **no remaining counter touches** need only one deduped event insert, not day reads or an empty day increment.
- For retained events with counters, use one Mongo transaction for the conditional day update and deduped event insert. Allocate stable event identity/dedupe key/time outside the retry callback. No Redis/external calls inside. A duplicate event aborts the transaction, so it cannot increment counters twice.
- Implement the day update as a tested day-key-only conditional pipeline: initialize a missing seed; change counters and revision only while status is open; return status so a closed-day event is inserted with empty touches. Do not combine `{day,status:'open'}` with unconditional upsert (closed-day unique-key failure), or conflicting parent `$setOnInsert` and child `$inc` paths. If a safe pipeline cannot be verified, ship one transactional status read first rather than compromising correctness.
- Writers, day close and rebuild serialize through the same day document. Every counter mutation/close advances revision. Fix existing rebuild replacement to filter `{day,status:'open',revision:observedRevision}`; bounded conflicts recompute/retry, otherwise return 409. Current code accepts `previousRevision` but does not use it as a filter. Do not introduce periodic full rebuilds.

Existing after-commit business ordering and never-throw display failure behavior remain. Record bounded failure telemetry and use existing canonical rebuild/repair paths where applicable. Keep Sheet Sync fact persistence/caller ordering and reconstruction tests; this proposal does not delete or weaken its required completion history. A transient in-memory batch buffer is not acceptable durability for retained facts.

## 5. Budgets and expected reductions

Use a 31-day month and count backend operations separately from billable provider commands. Global materializer figures below apply to the single active production core scope/schema. Auxiliary bundles are separate; additional isolated environments/scopes must be counted explicitly rather than hidden in that production total.

| Component | Proposed budget/model |
|---|---:|
| Daily Operations Redis, per tab and whole system | **0 commands**; all 500,000 allowance left available for any separately verified consumers after reset |
| Shared periodic HTTP requests/cache reads, active tab 8h × 22 days | **10,560/month** |
| Shared periodic HTTP requests/cache reads, continuous active tab | **44,640/month** |
| Authentication reads | Additional per authenticated request; preserve them and measure separately |
| Core global materializer, continuously demanded | At most **44,640 builds/month** |
| Complete core+toast source queries, five/build | At most **223,200/month**, independent of tab count |
| Lease + publication physical mutations, two/build | At most **89,280/month**; failed contenders add bounded operation attempts, not successful materializations |
| Auxiliary source builds at five minutes | At most **8,928/month per permission-safe bundle**; record its query cost separately |

With N continuous visible tabs, cache reads are approximately `44,640 × N`; there is no second toast poll. Authentication and lease-contention attempts are additional. A request may attempt at most one lease claim; cache losers must not busy-wait or poll for the winner. A failed build uses a bounded failure publication in place of its success publication, not an additional per-retry telemetry write. No shared read cache may bypass authorization. Explicit history navigation and operator rebuilds have their own measured costs; do not hide them inside the periodic budget.

At the measured write mix, suppressing only already-current/stale display facts reduces projected new events from **676,615 to 125,129/month** (81.5%). It avoids approximately **249,058 Mongo reads and 249,058–373,587 mutations per measured week**, depending on Redis availability. These savings exclude canonical receipt/decision writes, which remain.

For remaining events, the transaction/pipeline targets at most two physical data mutations with counters, one without counters, and no preliminary day-status/existence reads. The conservative all-retained-events-two-writes ceiling is ~**250,258 mutations/month**, before view-cache writes, transaction overhead, and independent domain work. Retiring unused decision-only increments improves it further; measure rather than promise an unverified total Atlas billing reduction.

For comparison, current exhaustion can cause up to ~**5.36 million Mongo tail queries/month per continuously open Operations tab** with its two streams, plus snapshots and ancillary widgets. A healthy Redis stream still performs duplicated event lookups for each consumer. Replacing that with bounded shared views is the principal read reduction.

Do not count pipelining as billable command savings. If an unforeseen Redis consumer is found, give it a separate explicit budget targeting **<=350,000/month**, at least 150,000 headroom, before enabling it. The selected Daily Operations architecture needs none.

## 6. Immediate operation and phased implementation

**While quota is exhausted, before any approved deployment:** existing XREAD errors fall back to Mongo and XADD errors are swallowed after persistence. Close unneeded Owner/Manager dashboard/desk tabs entirely; merely switching Admin pages leaves the global toast stream active. Use necessary business surfaces normally. Do not prune keys, run Redis diagnostic commands, stop essential workflows, or claim the quota has reset.

Proposed implementation sequence (separate reviewable commits/releases):

1. **Transport containment/server compatibility.** `src/config/domain/dailyOperations.ts`, `liveStream.ts`, writer and live router: introduce a reversible Redis-off gate defaulting off, applied to both construction/read and publish. Add the board-read service/model/route and scoped cache. Old SSE clients can temporarily use the existing Mongo compatibility path; explicitly time-box this overlap. Do not deploy a disabled SSE endpoint that causes old clients to spin reconnect loops. Keep current security gates. Required server indices are additive and verified before enabling the cache.
2. **Admin transport migration.** `components/daily/daily-shell.tsx`, `milestone-toast.tsx`, `components/layout/dashboard-shell.tsx`, `components/outreach-desk/shell/desk-shell.tsx`, `lib/api/dailyOperations*.ts`, query keys, and a new shared read-provider/hook: one 60-second visible poll, authoritative replacement, once-per-session milestone handling, abort/backoff, stale UX. Add a BFF route for the new read API using existing trusted signed actor headers. Update `team-call-goals.tsx` and `lead-spend-panel.tsx` to the scoped slower summaries; preserve core Outreach services/cadence. Require existing Owner/Manager dashboard/desk tabs to reload or close after deployment. Once the new Admin is available, the retired live endpoint returns authenticated **204 with no stream/source query**, and the BFF must forward 204 explicitly before its current missing-body error branch. Native board EventSource stops retrying on 204; the already-loaded old milestone host can still manually retry every 30 seconds until its tab reloads. Do not pretend that old JavaScript can be remotely patched. Monitor those legacy requests and require their drain/reload before declaring rollout complete. Verify cached tabs and BFF cancellation behavior.
3. **Write reduction.** `recordGranotFacts.ts`, `recordDailyOperationsFact.ts`, `kinds.ts`, `dayDocument.ts`, `DailyOperationsDay.ts`, `rebuild.ts`, `closeDay.ts`: exact no-op classification suppression, retire unused decision projection, no-touch fast path, atomic retained writer, revision/CAS correctness. Preserve Sheet Sync facts. Ship the simple transactional read variant first if pipeline correctness would delay the safe reduction.
4. **Contracts and measurement.** Update the current Daily Operations Service/contract, Admin API types/UX docs and environment inventory in the eventual implementation. Document changed freshness, retired internal counters, milestone delivery semantics and corrected old cost table. This proposal task itself adds only this file, not those edits.

The transport containment release can immediately remove Redis failures without waiting for a monthly reset. Complete the Admin migration in the same release window so containment does not leave the high-frequency Mongo fallback running long term. Deployment order must keep the current Admin compatible until the new read API is ready. Tag the containment release as the oldest supported rollback target; rolling back to a binary that predates the Redis-off gate would restore the incident behavior.

## 7. Verification and release gates

Tests must be offline/mocked or use an isolated replica-set test database. No production write tests.

- Writer: suppress only two no-op classes; canonical decision/receipt behavior unchanged; preserve conflict/error/Sheet Sync/milestone facts; duplicate concurrent writers; retry/crash at either transaction step; missing-day races; hourly arrays and New York DST; closed-day ordering; no-touch insert-only path.
- Rebuild/close: real revision CAS prevents lost updates; conflicts retry boundedly; closed days never reopen; retained Sheet Sync events reconstruct counts; retirement of decision fields agrees between live/rebuild. Use existing `recordDailyOperationsFact.test.ts`, `rebuild.test.ts`, `closeDay.test.ts`, `snapshot.test.ts`, `liveRebuildAgreement.test.ts` plus replica integration seams.
- Read view: one source build under concurrent misses across instances; unique-key race; lease expiry/fencing; crash between claim/publish; failed query/time limit; stale-last-good and cold-cache unavailability; query plans and bounded response size; Owner/Manager permission isolation and denial of Rep/generic Admin. The new model must use isolated TEST_MODE/test-runner collection naming and must never create or refresh a production view from tests.
- Admin: board+toast cause one request; hidden/unmounted tabs cause zero periodic requests; return-to-visible and multiple consumers coalesce; no overlap; no SSE/Redis construction; repeated revision does not double-count or toast; backdated facts, day rollover/DST, stale recovery, history truncation, and supplementary summaries respect their slower cadence.
- Compatibility: old Admin bundles do not reconnect indefinitely or multiply fallback reads after rollout; actual cancellation reaches the server. Rollback never silently re-enables Redis or the global one-second streams.

Before production enablement, instrument sampled/aggregated counts for: Redis commands attempted by module (must remain zero), active legacy SSE connections, view hits/misses/age, refresh attempts/winners/lease loss, source query count/time, fact attempts/inserted/duplicate/suppressed by closed outcome class, transaction retries, counter conflicts, retained-fact failures, and ancillary summary query cost. Use existing logs/Mongo/hosting metrics; instrumentation must not use Redis or create a new per-loop telemetry write.

Acceptance: zero Daily Operations Redis attempts; zero new Admin Daily Operations SSE connections after compatibility drain; <=1 periodic request/minute/visible tab; one successful global core materialization/minute maximum; no hidden polling; exactly-once retained counters under races; 81.5% measured no-op fact reduction reproduced on the frozen evidence mix; unchanged business/security tests; core age normally <=125 seconds and auxiliary age <=365 seconds when dependencies are healthy. Compare a representative workday before/after, then provider totals at the next verified reset; never promise a future total from an unverified traffic mix.

## 8. Recovery, rollback, and unresolved facts

- Mongo unavailable: show last-good client data and age, back off (60/120/300 seconds), do not fail business writes because of this optional read surface, and do not fall back to Redis. No complete cache means explicit unavailable. Rebuild on the next demand after recovery.
- Cache loss/expired lease: reconstruct from existing durable day/event records under a new fenced owner; no lost required facts. Date/scope/schema keys prevent yesterday/another permission scope masquerading as the current board.
- Rollback: disable the new view producer and serve the existing snapshot/events with a **slower visible-only** direct-read fallback. Keep Redis off. Revert writer optimization only after aligning counter/rebuild semantics; do not replay suppressed old no-ops or delete retained history. Existing historical fields and credentials remain available. Any full application rollback that would restore the old one-second global stream needs an explicit incident decision and short time limit.
- Browser Upstash/Admin sessions were signed out. Current key counts/bytes, legacy keys, provider reset date, actual command attribution, credential sharing, Atlas billing totals, and the complete rendered user journey remain unverified. Exact source caller/channel attribution for all repeated Granot outcomes was not performed; do not disable synchronization based on display volume.
- Existing fact evidence and production logs establish continuing business work and ongoing Redis failure, not a universal guarantee that all work succeeded. No current recovery was verified. There is no automatic-approval denial or unresolved mutating action in this investigation.

**Delivery authorization:** implementation, the additive query index and production rollout are authorized. Complete the release checks in [RELEASE.md](RELEASE.md). No billing change or historical pruning is required or authorized.

Focused internal review completed: monthly arithmetic was recomputed from 44,640 minutes and the measured seven-day fact mix; durable decisions/receipts and Sheet Sync rebuild evidence remain preserved; per-tab polling, global refresh, retry/lease, authentication and auxiliary costs are separated. The lease-claim retry deadline and single shared production scope above are required to make the stated Mongo bounds hold after crashes and under concurrent viewers.
