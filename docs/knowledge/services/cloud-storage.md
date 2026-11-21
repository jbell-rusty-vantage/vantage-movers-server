---
type: Service
title: Cloud Storage
description: One deep module for every Google Cloud Storage interaction. Create-only put with a pinned read-back (generation plus SHA-256), verified reads, named holds, conditional expiry and generation-fenced delete, configured from Mongo. Module and tests only; no caller is migrated yet.
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
  at: 2026-11-21T22:15:00Z
---
**Platform glossary:** [`../../operations/shared-glossary.md`](../../operations/shared-glossary.md)  
**Primary code:** [`src/services/cloudStorage/`](../../../src/services/cloudStorage/)  
**Program:** [workstream 1](../../operations/NEXT-PROGRAM-2026-11-20.md#1-google-cloud-storage-service)  
**Proven rules it carries:** [Granot storage retention](../granot-lifecycle/storage-retention-operations.md), [capture](../granot-lifecycle/capture.md), [hot-storage study](../../operations/GRANOT-HOT-STORAGE-2026-11-18.md)

# Cloud Storage

**Role.** One module owns every Google Cloud Storage interaction: authentication, create-only writes, verified read-back, holds, conditional expiry and generation-fenced deletion. Each service calls one contract instead of carrying its own client code. MongoDB keeps the locator (`hash`, `generation`); the object keeps the bytes.

**State (2026-11-21).**
- Implemented and tested offline: the contract, the GCS driver, the in-memory fake bucket and Mongo runtime configuration.
- Not integrated: no caller uses the module, and runtime behavior is unchanged. Each caller migrates in its own PR (see [Migration](#call-sites-and-migration-order)).
- The real-bucket proof has not been run.

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
| `put({ name, bytes, contentType, customTime?, metadata? })` | Create-only insert (`ifGenerationMatch: "0"`). If the name exists, applies the store's reuse policy. Then reads back the pinned generation and requires the same length and SHA-256 (`verification_failed`). Returns `{ name, generation, sha256, size, created, persisted }`. Callers decode `persisted`, never their input. Identical bytes are idempotent: the same generation comes back with `created: false`. |
| `readVerified({ name, generation?, sha256, size? })` | Downloads the pinned generation and verifies SHA-256 and the optional size. `generation` may be absent only for a legacy locator; the read then uses the live generation and still verifies SHA-256. |
| `stat(name, generation?)` | `ObjectState`: generation, metageneration, size, recovery-clock marker, named holds, `independentHold`, `retentionLocked`, metadata, `updated`. |
| `list({ prefix, pageToken?, maxResults? })` | Live objects under a prefix inside the store prefix, page by page. |
| `hold(ref, { holder, token?, replaces?, metadata? })` | Adds a named hold to an exact generation in one compare-and-swap. It can replace other holders (a release review replaces the publisher hold) and write extra metadata (review evidence). Extra metadata cannot name a hold key; those change only through `holder` / `replaces`. |
| `release(ref, holder, token?)` | Drops one named hold. Idempotent. The provider hold stays on while another named hold remains. |
| `startRecoveryClock(ref, guard)` | Conditional expiry. It stamps the recovery-clock marker (GCS `customTime`) on a verified generation, and the bucket lifecycle deletes the generation once the recovery window has passed. Idempotent once started. |
| `deleteIfGeneration(ref, guard)` | Immediate delete of the live generation, with generation and metageneration preconditions. |
| `lifecycle()` | Bucket lifecycle rules, read-only. Use `checkRecoveryPolicy(rules, scope, days)` to assert them. |

Error codes: `invalid_name`, `invalid_configuration`, `not_found`, `generation_mismatch`, `verification_failed`, `held`, `independent_hold`, `referenced`, `hold_not_drained`, `released`.

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
   With `guard.requireHold`, the named review hold must be active with the same token, and its `updated` time must be at least `heldForMs` old. For Granot that is 800 seconds, the publication drain window. The marker can only move forward. A released generation can only be protected again by a hold, never un-released.
5. **Reuse protects before reading.** Under the Granot `rehold` policy, a `put` that finds a released or under-review generation first cancels the review and sets the publisher hold, in one compare-and-swap. A released generation held by neither the publisher nor a cancellable review is refused (`independent_hold`). The Sales Intelligence `refuse_released` policy refuses a generation whose clock has started **unless this `put` itself stamps `customTime`** (a sealed catalog, matching today's `seal()` 412 retry). A pack put without `customTime` still refuses.
6. **Original-ID lookups fall back to the archive.** Callers keep that rule. The module only guarantees that a verified read returns the exact bytes the locator recorded.

The module never writes lifecycle rules, bucket retention, versioning or soft-delete settings. Those are Owner-approved bucket changes.

## Configuration

| Value | Lives in | Notes |
| --- | --- | --- |
| Bucket, prefix, recovery days | Mongo `cloud_storage_control`, `{ _id: "<namespace>", bucket?, prefix?, recovery_days?, updated_at, updated_by, reason }` | A missing document or field means the code default, which is today's production value, so adopting the module changes nothing until the Owner writes a document. A present but invalid value fails closed (`invalid_configuration`). Read with `readCloudStorageConfig(db, namespace)` or `openObjectStore(db, namespace)`. |
| Hold metadata keys, reuse policy, timeouts | Code (`CLOUD_STORAGE_NAMESPACES`) | These are part of the stored object format. Changing them would change object metadata. |
| Lifecycle rules | The GCS bucket | Read-only here. `checkRecoveryPolicy` requires exactly one Delete rule covering the database-scoped prefix, with `daysSinceCustomTime` equal to the recovery days and no other condition. |
| Credentials | Env: `GOOGLE_SERVICE_ACCOUNT_JSON` / `_BASE64`, `TEST_MODE` test variants, `SERVICE_ACCOUNT_LOCAL_FILE` | Unchanged. See [environment](../environment.md#google-sheets-and-ingestion). |
| Real-bucket test opt-in | Env, test only: `CLOUD_STORAGE_CONTRACT_TESTS`, `CLOUD_STORAGE_CONTRACT_BUCKET` | Never set in Vercel. |

Namespaces and their defaults:

| Namespace | Bucket | Prefix | Object name | Hold keys | Reuse | Timeouts read / write |
| --- | --- | --- | --- | --- | --- | --- |
| `granot-history` | `vantage-mongodb-backups-496816` | `history/granot/v1/` | `<prefix><database>/<hh>/<sha256>.bson.gz` | `publisher` → `granotPublisherHold`, `review` → `granotReleaseReview` (evidence in `granotReleaseEvidence`) | `rehold` | 15 s / 30 s |
| `sales-intelligence-packs` | `vantage-mongodb-backups-496816` | `history/sales-intelligence/v1/` | `<prefix><database>/<run uuid>/<sha256>.bson.gz` or `catalog.json` | none | `refuse_released` | 30 s / 60 s |

Both namespaces have a 30-day recovery window. Bucket soft delete adds seven days after lifecycle deletion.

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
- **Granot retention ceiling.** The two-minute cron runs about 720 times a day. Its code budgets allow at most 16 scheduled runs (two objects each), 16 webhook receipts, one evidence page and up to 64 receipt reviews per invocation. Scenario: 120 puts per invocation would be 86,400 puts a day, about $0.43 a day in Class A plus about $0.03 in Class B. That ceiling is roughly $14 a month in requests, before egress. Actual arrivals are far below the budget. Measure them before using this number: the November 19 scheduled-run cutover archived 992 runs in total.
- **Bytes at rest (measured).** Sales Intelligence rollback packs: 38.72 MiB in GCS on November 19. Granot raw rollback exports: 149.65 MB compressed on November 18, in addition to application archives. At list price, 1 GiB costs about $0.02 a month, plus the same again during the seven days of soft delete.
- **What this module adds.** `startRecoveryClock` and `deleteIfGeneration` add one verified download each, compared with today's release script. That is one Class B operation plus the object's egress, the price of the "no delete without a verified generation" rule.

## Call sites and migration order

Today `src/` has exactly one GCS client: `src/services/granotHistory/archiveObjects.ts`. Every Granot service reaches GCS through its `storeArchiveObject` and `readArchiveObject`, which callers inject as a seam. The other clients live under `ops/`.

| # | Call site | GCS operations today | Locator in Mongo | Can objects and locators stay byte-identical? | PR |
| --- | --- | --- | --- | --- | --- |
| 1 | `src/services/granotHistory/archiveObjects.ts` (`storeArchiveObject`, `readArchiveObject`) | insert `ifGenerationMatch: 0`; on 412, stat, then a publisher re-hold compare-and-swap; pinned `alt=media` read-back | `{ hash, generation }`; name derived from database and hash | **Yes.** Same name (test: `granotHistoryObjectName` equals `archiveObject` for 192 cases), same bytes, same content type, same hold metadata and fences (test: emulated request shapes). The patch and stat requests add a `fields` list. The existing error messages need a thin mapping in the shim. | 1. Granot history |
| 1a | Its Granot callers: `publishArchiveChunk.ts`, `monthArchive.ts`, `scheduledRunArchive.ts`, `prepareClosedRun.ts`, `closedAutomationRun.ts`, `archiveReads.ts`, `evidencePage.ts` | through #1 | `granot_history_archive_chunks`, `granot_closed_automation_runs`, `granot_automation_runs.archive_summary` | **Yes**, unchanged code above the seam. Legacy chunks without `generation` keep reading the live generation with SHA-256 verification. | 1 |
| 1b | Operator readers: `ops/granot-archive-run-closure.ts`, `ops/granot-targeted-deletion-dry-run.ts`, `ops/granot-history-archive.ts`, `ops/granot-closed-cohort.ts`, `ops/verify-granot-history-archive.ts` | through #1 | operator manifests | **Yes.** | 1 |
| 2 | `ops/granot-release-archive-generation.ts` (begin and release) | full-control stat; review hold patch; recovery-clock patch | evidence JSON (`hash`, `generation`) | **Yes** for objects and metadata: begin = `hold(review, replaces publisher, evidence)`; release = `startRecoveryClock(requireHold review, heldForMs 800000, references = stillReferenced)`. Two behavior differences: release adds a verified read before stamping, and "review already started" stays a caller check on the evidence digest, because today's review token is a fresh UUID on each run. | 1 (same PR as the writer it pairs with) |
| 3 | `ops/sales-outreach/retire-historical-jobs.cjs` (Sales Intelligence rollback packs) | insert `ifGenerationMatch: 0` (`application/gzip`); on 412, refuse a discharged object; pinned read with SHA-256; bucket lifecycle assert; `customTime` patch fenced on generation and metageneration; sealed `catalog.json` inserted with `customTime` | operator manifest and the sealed catalog in GCS | **Yes.** Same names (test), bytes, content types and `{ customTime }` patch body, under `refuse_released`. Today's lifecycle assertion is a strict `deepEqual`. Keep it beside `checkRecoveryPolicy` or tighten the check. The task brief named `src/services/salesIntelligence/jobs.ts`, but that file has no GCS code: its retired-stage fence is Mongo-only. | 2. Sales Intelligence packs |
| 4 | Granot receipt retirement: `completedWebhooks.ts` (`retireWebhookReceipt`, `readRetiredLifecycleReceipt`), `futureRetention.ts`, `retireLeadEvidence.ts`, `settledLeadEvidence.ts` | through #1 (injected `store` / `read`) | `granot_archived_receipts`, `granot_webhook_receipts.evidence_archive` / `history_archive` | **Yes.** A later PR retypes the injected seams to `ObjectStore` and moves their tests onto the fake bucket. No object or locator changes in this module PR. | 3. Granot receipt retirement |
| 5 | `ops/cloud/mongodb-backup/backup.mjs` | `@google-cloud/storage`: resumable file upload `ifGenerationMatch: 0` with SHA-256 custom metadata, metadata verify, server-side copy to `weekly/`, manifest save; age-based lifecycle (8 and 29 days) | the success manifest in GCS | **Does not fit as is.** It is a separate ESM Cloud Run package (excluded from `tsconfig`) with its own runtime identity (ADC) and its own dependency. It needs streaming file upload and server-side copy, which the contract does not have, and its expiry is age-based rather than marker-based. Objects could stay byte-identical, but adopting the module means bundling it into the job image. | 4, only if the Owner wants it; otherwise keep its client and mirror the contract shape |

Each migration PR must show:
- the existing archive replay and original-ID read tests still pass;
- an emulated request-shape comparison for every call it replaces;
- no change to any stored object, metadata key or locator field.

## Tests

Run all of them offline with `pnpm test`:

- `fakeBucket.test.ts`: the contract suite on the fake bucket, plus these cases:
  - corruption fails a verified read and blocks delete;
  - a read-back mismatch refuses the write;
  - generations stay unique after a delete;
  - independent and event-based holds;
  - the 800-second drain window under an injected clock;
  - reuse cancels a review;
  - an unreleased reuse makes no metadata change;
  - `refuse_released`;
  - a `customTime` put (sealed catalog) and its 412 retry;
  - extra metadata cannot overwrite a hold key;
  - stacked holds;
  - a lost compare-and-swap;
  - legacy locators without a generation;
  - unknown holders.
- `gcsDriver.test.ts`: the contract suite through the GCS driver over a JSON API emulator, plus these checks:
  - today's exact Granot insert and read-back requests;
  - the re-hold patch body and fences;
  - retry boundaries (insert retried, compare-and-swap not);
  - error mapping;
  - scopes.
- `namespaces.test.ts`:
  - defaults equal production;
  - Mongo overrides apply;
  - invalid configuration fails closed;
  - Granot and Sales Intelligence names are byte-identical to today's code;
  - the lifecycle check passes today's three rule sets.
- `gcsDriver.contract.test.ts`: the same contract suite against a real bucket, **skipped by default**.

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

The suite writes only under `contract/<uuid>/` and deletes everything it wrote at the end. It covers write, read-back, holds, conditional delete, generation mismatch, the recovery clock and re-hold, and prefix listing. If a run is interrupted, delete `contract/` from the bucket by hand. Soft-deleted objects bill for seven days.

## Open questions for the Owner

1. **Moving a namespace.** Locators store `hash` and `generation` but not the bucket or prefix. Changing either in `cloud_storage_control` for a namespace that already has objects would point readers at the wrong place. The options:
   - a copy migration before the change;
   - adding the bucket to new locators, a locator format change;
   - refusing changes once objects exist.
   Until the Owner decides, change these values only before the first write.
2. **Backup job.** Bundle the module into the Cloud Run image (#5), or leave the backup job on its own client?
3. **Lifecycle assertion strictness.** Keep today's strict `deepEqual` for the Sales Intelligence pack rule, or accept `checkRecoveryPolicy`? It also accepts one rule listing several prefixes, as the Granot rule does.
4. **Verified read before the recovery clock.** It adds one download per release. The recommendation is to keep it.
5. **Operator runbook.** The program also asks for a runbook in `docs/operations/`. Write it with the first migration PR, when there is an operator command to document.
