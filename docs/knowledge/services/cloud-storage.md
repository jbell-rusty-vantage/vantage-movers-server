---
type: Service
title: Cloud Storage
description: One deep module for every Google Cloud Storage interaction. Create-only put with a pinned read-back (generation plus SHA-256), verified reads, named holds, conditional expiry and generation-fenced delete, configured from Mongo. The Granot history writer and reader run on it; the Sales Intelligence packs and the release script are still to migrate.
tags: [cloud-storage, granot-lifecycle, operations]
status: draft
stale_after: 2027-02-28
resource: src/services/cloudStorage/
applies_to:
  - src/services/cloudStorage/contract.ts
  - src/services/cloudStorage/objectStore.ts
  - src/services/cloudStorage/driver.ts
  - src/services/cloudStorage/gcsDriver.ts
  - src/services/cloudStorage/fakeBucket.ts
  - src/services/cloudStorage/namespaces.ts
  - src/services/cloudStorage/contractSuite.ts
  - src/services/granotHistory/archiveObjects.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/cloudStorage/objectStore.ts
  - id: program
    resource: docs/operations/NEXT-PROGRAM-2026-11-20.md
    title: Next program, workstream 1 (Google Cloud Storage service)
  - id: granot-archive
    resource: src/services/granotHistory/archiveObjects.ts
    title: Today's Granot archive writer and reader
  - id: granot-release
    resource: ops/granot-release-archive-generation.ts
    title: Today's Granot release review
  - id: sales-intelligence-packs
    resource: ops/sales-outreach/retire-historical-jobs.cjs
    title: Today's Sales Intelligence rollback packs
  - id: retention
    resource: docs/knowledge/granot-lifecycle/storage-retention-operations.md
  - id: hot-storage
    resource: docs/operations/GRANOT-HOT-STORAGE-2026-11-18.md
  - id: glossary
    resource: docs/operations/shared-glossary.md
    title: Platform glossary
generated:
  by: process:agent
  at: 2026-11-21T22:00:00Z
---
**Platform glossary:** [`../../operations/shared-glossary.md`](../../operations/shared-glossary.md)  
**Primary code:** [`src/services/cloudStorage/`](../../../src/services/cloudStorage/)  
**Program:** [workstream 1](../../operations/NEXT-PROGRAM-2026-11-20.md#1-google-cloud-storage-service)  
**Proven rules it carries:** [Granot storage retention](../granot-lifecycle/storage-retention-operations.md), [capture](../granot-lifecycle/capture.md), [hot-storage study](../../operations/GRANOT-HOT-STORAGE-2026-11-18.md)

# Cloud Storage

**Role.** One module owns every Google Cloud Storage interaction: authentication, create-only writes, verified read-back, holds, conditional expiry and generation-fenced deletion. Each service calls one contract instead of carrying its own client code. MongoDB keeps the locator (`hash`, `generation`); the object keeps the bytes.

**State (2026-11-21).**
- Implemented and tested offline: the contract, the GCS driver, the in-memory fake bucket and Mongo runtime configuration.
- **Integrated (PR #257):** every Granot history write and read in `src/` goes through `granotArchiveStorage` in `archiveObjects.ts`, over the `granot-history` namespace. That covers chunks, month pages, evidence pages, closed runs, scheduled runs and retired receipts. Object names, bytes, content type and hold metadata are unchanged. The Granot unit and replica tests run on the fake bucket.
- Still to migrate: `ops/granot-release-archive-generation.ts` (its reference check is now `archiveObjectReferenced` in `src/`), the Sales Intelligence packs and the operator readers under `ops/` that build their own client.
- The real-bucket proof has not been run. **The Nov 23 attempt (Owner-approved) was blocked before any write.** Creating the disposable bucket in the test project `just-cosmos-437222-b7` returned 403 *"The billing account for the owning project is disabled"*. No bucket or object was created, and `vantage-sheets-496816` was not touched. See [running the proof](#running-the-real-bucket-proof-owner-or-operator).

**`daily-operations-events` namespace (2026-11-23).** Prefix `history/daily-operations-events/v1/`, 90 recovery days, the same sealed pack shape. Used by validated retirement of closed-day Daily Operations Events ([Daily Operations](daily-operations.md#closed-day-retirement-and-the-dedupe-fence)); its catalog is `daily_operations_event_archive_packs`. The bucket rule is added by `pnpm dailyops:event-retirement install`.

**`ringcentral-webhook-receipts` namespace (2026-11-23).** Prefix `history/ringcentral-webhook-receipts/v1/`, 90 recovery days, the same sealed pack shape as `sales-intelligence-retirement`. Used by validated retirement of RingCentral webhook receipts ([Number Activity capture](number-activity-capture.md#retention-and-what-stays-in-mongodb)); its catalog is `ringcentral_webhook_receipt_archive_packs`. The bucket rule is added by `pnpm ringcentral:receipt-retirement install`.

**`sales-intelligence-retirement` namespace (2026-11-22).** Prefix `history/sales-intelligence/v2/`, 90 recovery days, every pack sealed at birth (`<db>/<YYYY-MM-DD>/<sha256>.bson.gz`, created with its recovery clock started), no holds. Used by [validated retirement](../validated-retirement.md) of Sales Intelligence jobs; its catalog is `sales_intelligence_job_archive_packs` in MongoDB. The bucket rule is added by `pnpm outreach:job-retirement install` under a metageneration precondition.

## Shape

A deep module: one small interface over a thin provider driver.

| File | Responsibility |
| --- | --- |
| `contract.ts` | `ObjectStore` interface, locator types, `CloudStorageError` codes, `sha256Hex`. |
| `objectStore.ts` | The only implementation of the rules: hashing, read-back, hold bookkeeping, reuse, reference refusals, generation fences. |
| `driver.ts` | `BucketDriver`: one primitive per provider request (insert, stat, download, patch, remove, list, lifecycle). |
| `gcsDriver.ts` | GCS JSON API driver over the shared service-account auth (`googleAuth/serviceAccount.ts`), with least-privilege scopes, timeouts and transient retries. |
| `fakeBucket.ts` | In-memory driver with GCS semantics, plus test hooks (corruption, independent holds, event-based holds, lifecycle). |
| `namespaces.ts` | Namespace registry, Mongo runtime configuration, today's object-name functions and the lifecycle check. |
| `contractSuite.ts` | Behavior every driver must give the store. It runs against the fake, the GCS driver over an emulated API and, on opt-in, a real bucket. |

The fake bucket and GCS run the same `objectStore.ts`, so a rule cannot drift between tests and production.

## Contract

A store handle is scoped to one bucket and one prefix. A name outside the prefix, a name containing `..`, `//` or control characters, or a generation that is not a decimal string is refused before any request (`invalid_name`).

| Operation | Behavior |
| --- | --- |
| `put({ name, bytes, contentType, customTime?, metadata? })` | Create-only insert (`ifGenerationMatch: "0"`), then a pinned read-back that must match length and SHA-256 (`verification_failed`). If the name exists, the existing generation is read back and compared first, and only matching bytes go on to the store's reuse policy, so a different object under the name is never re-held. Returns `{ name, generation, sha256, size, created, persisted }`. Callers decode `persisted`, never their input. Identical bytes are idempotent: the same generation comes back with `created: false`. `customTime` is refused (`not_permitted`) unless the namespace lists the name as sealed (`sealedNames`: only the Sales Intelligence `catalog.json`). Otherwise a Granot or pack put could create an object that the lifecycle deletes with no hold, review, drain or reference check. |
| `readVerified({ name, generation?, sha256, size? })` | Downloads the pinned generation and verifies SHA-256 and the optional size. `generation` may be absent only for a legacy locator; the read then uses the live generation and still verifies SHA-256. |
| `stat(name, generation?)` | `ObjectState`: generation, metageneration, size, recovery-clock marker, named holds, `independentHold`, `retentionLocked`, metadata, `updated`. |
| `list({ prefix, pageToken?, maxResults? })` | Live objects under a prefix inside the store prefix, page by page. |
| `hold(ref, { holder, token?, replaces?, metadata? })` | Adds a named hold to an exact generation in one compare-and-swap. It can replace other holders (a release review replaces the publisher hold) and write extra metadata (review evidence). Extra metadata may not name a hold key, so it cannot clear another holder's hold. |
| `release(ref, holder, token?)` | Drops one named hold. Idempotent. The provider hold stays on while another named hold remains. |
| `startRecoveryClock(ref, { references, reviewToken? })` | Conditional expiry. It stamps the recovery-clock marker (GCS `customTime`) on a verified generation, and the bucket lifecycle deletes the generation once the recovery window has passed. In a namespace with a review policy, `reviewToken` must name the drained review hold. Idempotent once started. |
| `deleteIfGeneration(ref, { references, reviewToken })` | Immediate delete of the live generation. Only a namespace with a review policy can delete, and only under its drained review hold (rule 7). Every other namespace expires through the lifecycle only (`not_permitted`). |
| `lifecycle()` | Bucket lifecycle rules, read-only. Use `checkRecoveryPolicy(rules, scope, days)` to assert them. |

Error codes: `invalid_name`, `invalid_configuration`, `not_found`, `generation_mismatch`, `verification_failed`, `held`, `independent_hold`, `referenced`, `hold_not_drained`, `released`, `not_permitted`.

**Vocabulary.** The Granot docs say "releasing a generation" when they mean starting its recovery clock. In this contract, `release` only drops a hold, and `startRecoveryClock` starts the clock.

## Holds and conditional delete

These are the production rules, in contract form.

1. **No delete or expiry without a verified generation.** `deleteIfGeneration` requires the locator generation to be the live generation (`generation_mismatch`). It also requires the bytes to verify against the recorded SHA-256 (`verification_failed`). `startRecoveryClock` verifies the bytes before stamping. Both use the generation and metageneration as compare-and-swap fences, so a concurrent change loses with `generation_mismatch`.
2. **Reference holds.** Every destructive or expiring call takes `guard.references`, a caller function that returns true while any MongoDB locator still points at the object. It runs immediately before the change and refuses with `referenced`. The Granot reference set is `stillReferenced` in `ops/granot-release-archive-generation.ts`: archive chunks, closed runs, archived receipts, webhook receipts and automation-run summaries.
3. **Named holds.** Each holder is recorded under its own metadata key, and the provider temporary hold is on while any named hold is non-empty. Release sets the key to `""`, exactly as production does today. A temporary hold that no named holder recorded is an independent hold (`independentHold`). The store refuses to add a hold over it, and refuses to delete or expire while it is present.
4. **Conditional expiry.** `startRecoveryClock` refuses while any of these is true:
   - a locator references the object;
   - provider retention applies (an event-based hold or object retention), which the module never sets;
   - an independent hold or any other named hold is active.
   In a namespace with a review policy (`CLOUD_STORAGE_NAMESPACES[ns].review`, a code constant), the review hold must be active under `guard.reviewToken`, alone, and its `updated` time must be at least the namespace drain window old. For Granot that is 800 seconds, the server's maximum invocation lifetime. A caller cannot shorten or skip it. A namespace without a review policy refuses any hold. The marker can only move forward. A released generation can only be protected again by a hold, never un-released.
5. **Reuse protects before reading.** Under the Granot `rehold` policy, a `put` that finds matching bytes in a released or under-review generation cancels the review and sets the publisher hold, in one compare-and-swap, before it returns. A released generation held by neither the publisher nor a cancellable review is refused (`independent_hold`). The Sales Intelligence `refuse_released` policy refuses any generation whose clock has started. The exception is a put that itself starts the clock (`customTime`, the sealed `catalog.json`). On retry it accepts the existing generation only when that generation already has its `customTime`, as `seal()` in `retire-historical-jobs.cjs` asserts; otherwise it refuses with `generation_mismatch`.
6. **Release capability.** `openObjectStore(db, ns, { capability: "release" })` returns a store that can start recovery clocks or delete only after it has read the bucket lifecycle and `checkRecoveryPolicy` has matched `<prefix><database>/` to the namespace's recovery days. Every other store, including `storeForNamespace`, refuses both with `not_permitted`.
7. **Direct delete cannot strand a new locator.** A re-put of identical bytes to an unheld, unreleased Granot object writes nothing, and its writer records the locator only after `put` returns. A reference check alone would therefore miss a reader that is about to appear. `deleteIfGeneration` closes that gap in three layers:
   - The namespace review hold must be in place and drained, as for the recovery clock. Any writer that obtained the generation before the review has finished and written its locator by then, so `references` sees it. A re-put during the review cancels the review, and the delete refuses.
   - The delete then stamps the recovery-clock marker in a fenced patch. A re-put racing the delete re-holds the generation and advances the metageneration.
   - The final delete is fenced on that metageneration, so it refuses.
   `fakeBucket.test.ts` interleaves a re-put and locator write at each of these points and proves that the object survives.
8. **Original-ID lookups fall back to the archive.** Callers keep that rule. The module only guarantees that a verified read returns the exact bytes the locator recorded.

The module never writes lifecycle rules, bucket retention, versioning or soft-delete settings. Those are Owner-approved bucket changes.

### The drain assumption

The review drain (rule 4 and rule 7) is safe only if **every publisher saves its MongoDB locator within the 800-second window after its `put` returns**. A writer that obtained a generation before the review began must have written its locator by the time the drain ends, so that `references` sees it. The bound holds for the server: a Vercel invocation lives at most 800 seconds, and each server publisher writes its locator in the same invocation.

These local publishers have **no such bound**. They run on an operator machine with no invocation lifetime, and can pause between upload and locator for any length of time:
- `ops/granot-history-archive.ts --publish`;
- `ops/granot-archive-run-closure.ts`;
- `ops/granot-closed-cohort.ts`;
- `ops/granot-retire-used-receipts.ts --apply`. It writes each receipt's locator seconds after its put. A crash in between leaves an unheld, unreleased object that never expires, so the crash is safe. A paused process is not bounded.

Do not begin or release a review while any of them is running. Record that in the review's `external_writer_clearance`.

**Clock skew.** The drain compares the server's clock with the provider's `updated` time on the review hold. A server clock that runs ahead of GCS shortens the effective window by the skew; one that runs behind lengthens it. Vercel and GCS clocks are NTP-disciplined to well under a second, which the 800-second window absorbs, but an operator machine with a wrong clock is not. Run releases from the server environment or a host with a synchronized clock.

## Configuration

| Value | Lives in | Notes |
| --- | --- | --- |
| Bucket, prefix, recovery days | Mongo `cloud_storage_control`, `{ _id: "<namespace>", bucket?, prefix?, recovery_days?, updated_at, updated_by, reason }` | A missing document or field means the code default, which is today's production value, so adopting the module changes nothing until the Owner writes a document. A present but invalid value fails closed (`invalid_configuration`). **Until the Owner decides how a namespace may move (open question 1), `bucket` and `prefix` may only restate the built-in values. Any other value is refused**, because a prefix under another lifecycle rule (the 8-day backup rule) would expire live objects. `recovery_days` may change, but a release store opens only if the bucket rule agrees. Read with `readCloudStorageConfig(db, namespace)` or `openObjectStore(db, namespace, { capability })`. |
| Hold metadata keys, reuse policy, review holder and drain window, timeouts | Code (`CLOUD_STORAGE_NAMESPACES`) | These are part of the stored object format. Changing them would change object metadata. |
| Lifecycle rules | The GCS bucket | Read-only here. `checkRecoveryPolicy` requires exactly one Delete rule covering the database-scoped prefix, with `daysSinceCustomTime` equal to the recovery days and no other condition. |
| Credentials | Env: `GOOGLE_SERVICE_ACCOUNT_JSON` / `_BASE64`, `TEST_MODE` test variants, `SERVICE_ACCOUNT_LOCAL_FILE` | Unchanged. See [environment](../environment.md#google-sheets-and-ingestion). |
| Real-bucket test opt-in | Env, test only: `CLOUD_STORAGE_CONTRACT_TESTS`, `CLOUD_STORAGE_CONTRACT_BUCKET` | Never set in Vercel. |

Namespaces and their defaults:

| Namespace | Bucket | Prefix | Object name | Hold keys | Reuse | Timeouts read / write |
| --- | --- | --- | --- | --- | --- | --- |
| `granot-history` | `vantage-mongodb-backups-496816` | `history/granot/v1/` | `<prefix><database>/<hh>/<sha256>.bson.gz` | `publisher` → `granotPublisherHold`, `review` → `granotReleaseReview` (evidence in `granotReleaseEvidence`) | `rehold` | 15 s / 30 s |
| `sales-intelligence-packs` | `vantage-mongodb-backups-496816` | `history/sales-intelligence/v1/` | `<prefix><database>/<run uuid>/<sha256>.bson.gz` or `catalog.json` | none | `refuse_released` | 30 s / 60 s |

Every namespace has a 90-day recovery window (Owner decision 1, 2026-11-23; the two retirement namespaces, `sales-intelligence-retirement` and `ringcentral-webhook-receipts`, have had 90 days since they shipped). The bucket rule for each prefix must agree, or a release store refuses to open. Bucket soft delete adds seven days after lifecycle deletion.

Scopes stay least-privilege, as today:
- reads, stat, list and lifecycle use `devstorage.read_only`;
- inserts use `devstorage.read_write`;
- holds, recovery clocks and deletes use `devstorage.full_control`.

The driver builds one client per scope and reuses it. Today's writer builds a new auth client on every call.

**Retries.** Idempotent requests retry on 408, 429 and 5xx responses and on network resets, three attempts in total with backoff from 250 ms:
- downloads, stat, list and lifecycle;
- the create-only insert. A lost insert response that later conflicts goes down the existing-object path and its read-back.

Compare-and-swap patches and deletes are never blindly retried. After a lost response the caller re-reads state.

## Cost notes

No GCS request rate or byte volume was measured for this PR: it has no production access, and nothing in it runs in production. The figures below are scenario math from code budgets and earlier measurements. They use Google list prices for `us-east1` Standard storage, the prices the [backup deployment record](../../mongodb-backup-automation/deployment-record.md#estimated-monthly-cost) used: storage about $0.020 per GiB-month, Class A operations (insert, patch, list) $0.005 per 1,000, Class B operations (get) $0.0004 per 1,000. Verify them on the billing account before any capacity decision.

- **Per verified put:** one insert (Class A) and one pinned download (Class B). The download is also egress from GCS to Vercel. A reused generation adds a stat and possibly one patch.
- **Granot retention ceiling.** The two-minute cron runs about 720 times a day. Its code budgets allow at most 16 scheduled runs (two objects each), 16 webhook receipts, one evidence page and up to 32 retire-on-use reviews per invocation (one object each). Scenario: 120 puts per invocation would be 86,400 puts a day, about $0.43 a day in Class A plus about $0.03 in Class B. That ceiling is roughly $14 a month in requests, before egress. Actual arrivals are far below the budget. Measure them before using this number: the November 19 scheduled-run cutover archived 992 runs in total.
- **Bytes at rest (measured).** Sales Intelligence rollback packs: 38.72 MiB in GCS on November 19. Granot raw rollback exports: 149.65 MB compressed on November 18, in addition to application archives. At list price, 1 GiB costs about $0.02 a month, plus the same again during the seven days of soft delete.
- **What this module adds.** `startRecoveryClock` and `deleteIfGeneration` add one verified download each, compared with today's release script. That is one Class B operation plus the object's egress, the price of the "no delete without a verified generation" rule.

## Call sites and migration order

Today `src/` has exactly one GCS client: `src/services/granotHistory/archiveObjects.ts`. Every Granot service reaches GCS through its `storeArchiveObject` and `readArchiveObject`, which callers inject as a seam. The other clients live under `ops/`.

| # | Call site | GCS operations today | Locator in Mongo | Can objects and locators stay byte-identical? | PR |
| --- | --- | --- | --- | --- | --- |
| 1 | `src/services/granotHistory/archiveObjects.ts` (`storeArchiveObject`, `readArchiveObject`) | insert `ifGenerationMatch: 0`; on 412, stat, then a publisher re-hold compare-and-swap; pinned `alt=media` read-back | `{ hash, generation }`; name derived from database and hash | **Yes.** Same name (test: `granotHistoryObjectName` equals `archiveObject` for 48 cases), same bytes, same content type, same hold metadata and fences (test: emulated request shapes). Request differences: the patch and stat requests add a `fields` list, and on a name conflict the read-back now runs before the re-hold patch rather than after it. Failures now surface as `CloudStorageError` codes; no caller matched the old messages. | **Done in #257** |
| 1a | Its Granot callers: `publishArchiveChunk.ts`, `monthArchive.ts`, `scheduledRunArchive.ts`, `prepareClosedRun.ts`, `closedAutomationRun.ts`, `archiveReads.ts`, `evidencePage.ts` | through #1 | `granot_history_archive_chunks`, `granot_closed_automation_runs`, `granot_automation_runs.archive_summary` | **Yes**, unchanged code above the seam. Legacy chunks without `generation` keep reading the live generation with SHA-256 verification. | 1 |
| 1b | Operator readers: `ops/granot-archive-run-closure.ts`, `ops/granot-targeted-deletion-dry-run.ts`, `ops/granot-history-archive.ts`, `ops/granot-closed-cohort.ts`, `ops/verify-granot-history-archive.ts` | through #1 | operator manifests | **Yes.** | 1 |
| 2 | `ops/granot-release-archive-generation.ts` (begin and release) | full-control stat; review hold patch; recovery-clock patch | evidence JSON (`hash`, `generation`) | **Yes** for objects and metadata: begin = `hold(review, replaces publisher, evidence)`; release = `startRecoveryClock({ reviewToken, references: stillReferenced })` on a `release` store, with the 800-second drain enforced by the namespace. Two behavior differences: release adds a verified read before stamping, and "review already started" stays a caller check on the evidence digest, because today's review token is a fresh UUID on each run. | 1 (same PR as the writer it pairs with) |
| 3 | `ops/sales-outreach/retire-historical-jobs.cjs` (Sales Intelligence rollback packs) | insert `ifGenerationMatch: 0` (`application/gzip`); on 412, refuse a discharged object; pinned read with SHA-256; bucket lifecycle assert; `customTime` patch fenced on generation and metageneration; sealed `catalog.json` inserted with `customTime` | operator manifest and the sealed catalog in GCS | **Yes.** Same names (the test reads the script's own constants), bytes, content types and `{ customTime }` patch body, under `refuse_released`. A lost `catalog.json` response retries onto the existing generation, as production does. Request differences: the catalog body is a Buffer rather than a one-chunk stream (same bytes), and stat requests add a `fields` list. Today's lifecycle assertion is a strict `deepEqual`. Keep it beside `checkRecoveryPolicy` or tighten the check. The task brief named `src/services/salesIntelligence/jobs.ts`, but that file has no GCS code: its retired-stage fence is Mongo-only. | 2. Sales Intelligence packs |
| 4 | Granot receipt retirement: `retireOnUse.ts`, `completedWebhooks.ts`, `retiredRecords.ts`, `retireLeadEvidence.ts` (replacing `futureRetention.ts` and `settledLeadEvidence.ts`) | through #1 (injected `ArchiveStorage`) | `granot_archived_receipts`, `granot_webhook_receipts.evidence_archive` | **Yes** for existing objects and locators. New channel-operation receipts add one locator format, `channel-receipt-bson-v1`. Replica tests run on the fake bucket. | **Done in #257** |
| 5 | `ops/cloud/mongodb-backup/backup.mjs` | `@google-cloud/storage`: resumable file upload `ifGenerationMatch: 0` with SHA-256 custom metadata, metadata verify, server-side copy to `weekly/`, manifest save; age-based lifecycle (8 and 29 days) | the success manifest in GCS | **Does not fit as is.** It is a separate ESM Cloud Run package (excluded from `tsconfig`) with its own runtime identity (ADC) and its own dependency. It needs streaming file upload and server-side copy, which the contract does not have, and its expiry is age-based rather than marker-based. Objects could stay byte-identical, but adopting the module means bundling it into the job image. | 4, only if the Owner wants it; otherwise keep its client and mirror the contract shape |

Each migration PR must show:
- the existing archive replay and original-ID read tests still pass;
- an emulated request-shape comparison for every call it replaces;
- no change to any stored object, metadata key or locator field.

## Tests

Owner rule (November 21): keep tests lean and purposeful. Each test below guards verification, holds, conditional delete, naming parity or configuration safety. All run offline with `pnpm test`.

| File | Tests | What each protects |
| --- | --- | --- |
| `contractSuite.ts` | 5, run twice: on the fake bucket and on the GCS driver over a JSON API emulator | 1. Put and read verify generation and SHA-256, cover idempotent re-put and legacy locators. 2. Holds block expiry and delete until released. 3. `deleteIfGeneration` refuses a mismatch, a missing review and a reference. 4. The recovery clock needs the review, and a re-put re-holds. 5. Prefix confinement. |
| `fakeBucket.test.ts` | 6 | Corruption is never deleted; the 800 s review drain; **put and locator-write interleaved with delete at four points, the object survives**; unattributed holds; reuse policies (bytes checked before re-hold, the provider hold kept while another named hold remains, `customTime` only for a sealed catalog whose retry must find it on its clock); store options that would weaken a rule are refused at construction. |
| `gcsDriver.test.ts` | 2 | Granot requests equal today's archive writer (insert, read-back, re-hold fences); retry and error-mapping boundaries. |
| `namespaces.test.ts` | 4 | Runtime configuration (defaults, refused moves); release capability needs a matching lifecycle rule; object names equal today's Granot and Sales Intelligence code; the lifecycle check. |
| `gcsDriver.contract.test.ts` | the contract suite against a real bucket | **Skipped by default.** |

### Running the real-bucket proof (Owner or operator)

This writes to GCS. Run it only with a disposable bucket, after Owner approval.

1. Create a throwaway bucket whose name contains `test`, `disposable` or `scratch`, preferably in a test project. Give it no retention policy, no default event-based hold and no versioning. The suite refuses `vantage-mongodb-backups-496816`, `vantage-sheets-496816` and any name without one of those words.
2. Grant a test service account `roles/storage.objectAdmin` on that bucket only.
3. From the server root:

   ```sh
   CLOUD_STORAGE_CONTRACT_TESTS=true CLOUD_STORAGE_CONTRACT_BUCKET=<bucket> \
   TEST_MODE=true GOOGLE_SERVICE_ACCOUNT_TEST_JSON_BASE64=<test key> \
   node --import tsx --import ./ops/test-setup.ts --test src/services/cloudStorage/gcsDriver.contract.test.ts
   ```

The suite also refuses to run without `TEST_MODE=true`, so it always uses the test credential. It writes only under `contract/<uuid>/` and deletes everything it wrote at the end. It covers write, read-back, holds, conditional delete, generation mismatch, the recovery clock and re-hold, and prefix listing. If a run is interrupted, delete `contract/` from the bucket by hand. Soft-deleted objects bill for seven days.

**Prerequisite found on Nov 23.** The test project needs an active billing account. Without one, bucket creation fails with 403 before anything is written. The local `gcloud` CLI is unreliable on the operator laptop, so create and delete the bucket through `googleapis` in Node with `GOOGLE_SERVICE_ACCOUNT_TEST_JSON`, which holds `storage.buckets.create` and `storage.buckets.delete` in `just-cosmos-437222-b7`. Create the bucket with versioning off, uniform bucket-level access and a zero-day soft-delete policy. After the suite:
1. list `contract/` with all versions and delete anything left;
2. delete the bucket;
3. confirm that a `get` on it returns 404.

## Open questions for the Owner

1. **Moving a namespace.** Locators store `hash` and `generation` but not the bucket or prefix. Changing either in `cloud_storage_control` for a namespace that already has objects would point readers at the wrong place. The options:
   - a copy migration before the change;
   - adding the bucket to new locators, a locator format change;
   - refusing changes once objects exist.
   Until the Owner decides, the module refuses any `bucket` or `prefix` value that differs from the built-in one.
2. **Backup job.** Bundle the module into the Cloud Run image (#5), or leave the backup job on its own client?
3. **Lifecycle assertion strictness.** Keep today's strict `deepEqual` for the Sales Intelligence pack rule, or accept `checkRecoveryPolicy`? It also accepts one rule listing several prefixes, as the Granot rule does.
4. **Verified read before the recovery clock.** It adds one download per release. The recommendation is to keep it.
5. **Operator runbook.** The receipt retirement runbook (enable, backlog dry run and apply, rollback, fetch by ID) is in [storage retention](../granot-lifecycle/storage-retention-operations.md#enabling-rollback-and-recovery). A general Cloud Storage runbook in `docs/operations/` waits for the release-script migration.
