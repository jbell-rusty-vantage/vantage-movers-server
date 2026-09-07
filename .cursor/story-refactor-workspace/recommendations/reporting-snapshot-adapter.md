# Read The Freeze Through One Mongo Snapshot, Stamp That Cluster Moment On The Token, Or Say Snapshot Reads Are Unavailable — Never Stamp Source-Read-Through, Never Paint Preview, Never Persist The Manifest — operational story

- Status: recommended
- Service: `reporting` (Wave A, in-progress)
- Pass: 21 of this service — `snapshotAdapter.ts`
- Remaining in this service: `reportingObservability.ts`, `cleanup.ts`, `ownershipMarker.ts`, `registryFilters.ts`, remaining `google/*` adapters, remaining `live/*` harness
- Target: `src/services/reporting/snapshotAdapter.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (primary code is `reporting.service.ts`. Role: Owner-designed, checksum-bound reports. Happy path: preview → immutable revision → two-step confirmed run → **worker write**. Knowledge names **source read-through** as “captured by the worker under the active lease owner/epoch” — it never names this file, `capture`, `MongoReportingSnapshotAdapter`, `ReportingSnapshotTokenV1`, `SnapshotConsistencyUnavailableError`, `getReportingSnapshotAdapter`, `setReportingSnapshotAdapter`, `operationTime`, or `mongodb_snapshot` — do not add a Reporting Service file in this rename so “the Service sentence wins”). Distinct from already-recommended stamp-the-fence-once: [`reporting-run-repository.md`](reporting-run-repository.md) (`captureReportingSourceReadThrough` writes `source_read_through` + `query_plan_checksum` on the queued run under the lease — this file never touches `ReportingRun`). Distinct from already-recommended gather / freeze / prove: [`reporting-canonical-reporting.md`](reporting-canonical-reporting.md) (`buildReportingCandidateManifest` **asks** `getReportingSnapshotAdapter().capture` and stamps `manifestCapturedAt` / `snapshotToken` from the returned token; `validateReportingManifestEntries` **proves** fingerprints against `sourceReadThrough` **without** this adapter). Distinct from already-recommended persist-the-freeze: [`reporting-manifest-repository.md`](reporting-manifest-repository.md) (stores `snapshot_token` Mixed and reconstructs it — this file never inserts). Distinct from already-recommended stream capture → persist once: [`reporting-execution-stream.md`](reporting-execution-stream.md) (`prepareManifest` **asks** leftover freeze, which **asks** this file; `captureSourceReadThrough` is an ISO formatter, not a Mongo snapshot). Distinct from already-recommended claim / write: [`reporting-reporting-worker.md`](reporting-reporting-worker.md) (stamps source-read-through first, then **asks** stream `prepareManifest` — it never imports this file). Distinct from already-recommended leftover preview / estimate: [`reporting-reporting.md`](reporting-reporting.md) (preview paints fifty samples **without** a snapshot session). Distinct from leftover live harness: `live/syntheticLiveTestManifest.ts` (`registerSyntheticLiveTestSnapshotAdapter` **asks** `setReportingSnapshotAdapter` with a **second** snapshot transaction that hardcodes `operationTime: "1"` and does not map unavailable). Distinct from leftover Wave B `src/models/ReportingRunManifest.ts` (`snapshot_token` is `Schema.Types.Mixed`). Distinct from leftover Wave B `src/routes/reporting.routes.ts` (Owner preview / run do not import this file). This is not Admin Analytics and not Sheet Sync. This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR).
- Callers: `query/canonicalReporting.ts` (`buildReportingCandidateManifest` **asks** `getReportingSnapshotAdapter().capture` with the cohort / outcomes / page-mapping read; it is the **only** runtime **ask** of `capture`). Tests: `reporting.test.ts` **asks** `getReportingSnapshotAdapter` / `setReportingSnapshotAdapter` to swap a fake for leftover freeze fixtures and restore in `finally`; the “snapshot adapter contract” test **asks** a local fake plus `SnapshotConsistencyUnavailableError` / sibling `CanonicalSourceChangedError` **shape** — it never constructs `MongoReportingSnapshotAdapter` and never starts a session. Leftover live: `live/syntheticLiveTestManifest.ts` **asks** `setReportingSnapshotAdapter` from `registerSyntheticLiveTestSnapshotAdapter`; `live/liveGoogleOrchestration.ts` **asks** that register after `connectMongo` and never restores the default. `reportingDelivery.test.ts` / `reportingDelivery.regressions.test.ts` / `executionStream.test.ts` build a token **literal** and do **not** import this file. **No runtime caller** for `MongoReportingSnapshotAdapter` except this module’s default slot. Confirm / preview / Owner GET / leftover persist / leftover prove do **not** import this file.
- Seams callers need: read-the-freeze-through-one-snapshot (`MongoReportingSnapshotAdapter.capture`) vs stamp-source-read-through-on-the-run (`captureReportingSourceReadThrough`) vs prove-those-fingerprints-later (`validateReportingManifestEntries`) vs persist-the-freeze (`persistReportingCandidateManifest`) vs point-this-process-at-a-snapshot-read (`getReportingSnapshotAdapter` / `setReportingSnapshotAdapter`). The source-read-through / snapshot-token **seam** exists because the worker stamps the fence instant on the queued run **before** leftover freeze **asks** this file — `operationTime` is the cluster moment of the freeze read, not `source_read_through`. The freeze / prove **seam** exists because leftover prove re-reads after the snapshot session is gone and compares `updatedAt` to source-read-through, not to this token. The preview / freeze **seam** exists because leftover preview never **asks** this file. The process-slot / one-Mongo-adapter **seam** exists because tests and leftover live harness swap the slot — do **not** invent a second runtime **adapter**. There is no persist **seam**. There is no lease **seam**. There is no Google write **seam**. There is no begin / complete Domain Command **seam**. There is no Analytics **seam**. There is no Sheet Sync **seam**.
- Split later (only if the file outgrows one sitting): this ~81-line file is one sitting if you read it as read the freeze through one Mongo snapshot, stamp that cluster moment on the token, or say snapshot reads are unavailable — never stamp source-read-through, never paint preview, never persist the manifest. Do **not** split into `create.ts` / `update.ts` / `delete.ts`. Do **not** split into `adapter.ts` / `token.ts` / `error.ts` so “each type owns a file.” Do **not** pull leftover freeze / leftover prove / leftover persist / leftover source-read-through / leftover live register here so “one snapshot file owns the company.” If it later splits: `readTheFreezeThroughOneMongoSnapshotAndStampThatMoment.ts` / `pointThisProcessAtASnapshotRead.ts` only as later story files, never CRUD. Leave `isSnapshotUnsupported` internal.

`capture` / `getReportingSnapshotAdapter` / `setReportingSnapshotAdapter` are executor mechanics. The owner question is: *The worker is about to freeze the IDs it will write. Open one Mongo snapshot transaction on the primary, run that read, stamp the cluster operation time and this wall-clock instant on a token, and commit — or refuse if this process cannot offer snapshot-consistent reads (no operation time, not a replica set, transactions not allowed). Hand the token back so leftover freeze can checksum it onto the candidate set. Do not stamp source-read-through. Do not paint leftover preview. Do not persist the manifest. Do not prove fingerprints. Do not claim a lease. Do not write Google.*

Sibling leftover freeze, sibling leftover prove, sibling leftover persist, sibling leftover source-read-through stamp, leftover live register already live in other **modules**. Do not pull those in.

## What this file actually does

Two operations of one “read the freeze through one Mongo snapshot, stamp that cluster moment on the token, or say snapshot reads are unavailable — never stamp source-read-through, never paint preview, never persist the manifest” story, not “a snapshot CRUD adapter,” and not leftover freeze / leftover prove / leftover persist:

1. **Read the freeze through one Mongo snapshot and stamp that cluster moment — or say snapshot reads are unavailable** — `MongoReportingSnapshotAdapter.capture`. `connectMongo`. `startSession`. Start a transaction with `readConcern: { level: "snapshot" }` and `readPreference: "primary"`. Run the caller’s `read(session)`. If `session.operationTime` is missing → `SnapshotConsistencyUnavailableError` (`code: "snapshot_consistency_unavailable"`, `retryable: true`). Else stamp `ReportingSnapshotTokenV1`: `adapter: "mongodb_snapshot"`, `operationTime: operationTime.toString()`, `capturedAt: new Date().toISOString()`. Commit. Return `{ value, token }`. On error: abort if still in a transaction; map this unavailable error **or** leftover `isSnapshotUnsupported` (message matches `/snapshot|transaction numbers are only allowed|replica set/i`) to a **new** `SnapshotConsistencyUnavailableError`; rethrow everything else. Always `endSession`. This file does not load leads. This file does not checksum. This file does not persist.

2. **Point this process at a snapshot read** — module slot defaults to `new MongoReportingSnapshotAdapter()`. `getReportingSnapshotAdapter` returns it. `setReportingSnapshotAdapter` replaces it for this process. Leftover freeze **asks** get. Leftover tests and leftover live harness **ask** set. This is not an owner-facing second click; it is the process-slot **seam** leftover freeze already needs so fixtures and leftover live synthetic can stand in without constructing Mongo. Do **not** export a second runtime class so “Postgres can snapshot too.”

`isSnapshotUnsupported` is an internal message fold. It is not a third owner operation. Do not teach leftover freeze to **ask** it.

## Organization

Keep one file. This is the screenplay for “read the freeze through one Mongo snapshot, stamp that cluster moment on the token, or say snapshot reads are unavailable.” Sibling leftover freeze, sibling leftover prove, sibling leftover persist, sibling leftover source-read-through stamp already live in deeper **modules**. Do not pull those in. Do not invent a `SnapshotAdapterService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second snapshot **adapter** beside this Mongo one. Do not invent a second source-read-through **adapter** beside leftover `captureReportingSourceReadThrough`.

Do not split capture / get / set into CRUD files. Capture stays with the slot because leftover freeze **asks** get then capture, and leftover tests restore the same slot. Do not start `buildReportingCandidateManifest` from this file. Do not start `captureReportingSourceReadThrough` from this file. Do not start `persistReportingCandidateManifest` from this file. Do not start `validateReportingManifestEntries` from this file. Do not start leftover `registerSyntheticLiveTestSnapshotAdapter` from this file.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `MongoReportingSnapshotAdapter.capture` | `readTheFreezeThroughOneMongoSnapshotAndStampThatMoment` | leftover freeze is the one runtime **ask** |
| `getReportingSnapshotAdapter` | `theSnapshotReadThisProcessUsesRightNow` | leftover freeze **asks** get, then capture |
| `setReportingSnapshotAdapter` | `pointThisProcessAtASnapshotRead` | leftover tests + leftover live harness |
| `SnapshotConsistencyUnavailableError` | `SnapshotReadsAreUnavailable` | leftover freeze / leftover worker may retry |
| `ReportingSnapshotTokenV1` | `TheClusterMomentWeReadThrough` | leftover freeze checksums it; leftover persist stores it |
| `ReportingSnapshotAdapter` | `ASnapshotReadThisProcessMayUse` | leftover tests / leftover live implement `capture` |

Keep the old names as one-line aliases until leftover `canonicalReporting.ts`, leftover `reporting.test.ts`, and leftover `syntheticLiveTestManifest.ts` migrate. Do not make leftover freeze learn `MongoReportingSnapshotAdapter` as the import — leftover freeze **asks** the slot. Do not export `isSnapshotUnsupported` as a second refuse **seam**. Do not persist a new `adapter` string in this rename.

**No class for the workflow.** Do **not** turn this into a `ReportingSnapshotService` class. The existing `MongoReportingSnapshotAdapter` stays the one runtime **adapter** — it is not a `*Service`. The type that *does* earn a name is the token leftover freeze already checksums:

```ts
type TheClusterMomentWeReadThrough = {
  adapter: "mongodb_snapshot"
  operationTime: string
  capturedAt: string
}
```

That is the handoff from “we read the freeze under one snapshot” to “leftover persist may store the token and leftover prove may run later without this session.” Do **not** put `sourceReadThrough` on this type. Do **not** put fingerprint entries on this type. Do **not** put destination snapshot checksum on this type. Do **not** move leftover catalog’s inline `snapshotToken` shape into a new `types/` folder. Leave both clocks (`operationTime` cluster, `capturedAt` wall) until callers migrate.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// snapshotAdapter.ts
// The worker is about to freeze the IDs it will write.
// Open one Mongo snapshot on the primary.
// Run that read.
// Stamp the cluster operation time and this wall-clock instant.
// Commit — or refuse if this process cannot offer snapshot reads.
// Do not stamp source-read-through.
// Do not paint leftover preview.
// Do not persist the manifest.
// Do not prove fingerprints.
// Do not claim a lease.
// Do not write Google.

// ── 1. Read through one snapshot and stamp that moment ────

export class MongoReportingSnapshotAdapter {
  async readTheFreezeThroughOneMongoSnapshotAndStampThatMoment(read)
  // connectMongo
  // startSession + snapshot + primary
  // value = await read(session)
  // missing operationTime → SnapshotReadsAreUnavailable
  // token = { adapter: "mongodb_snapshot", operationTime, capturedAt }
  // commit
  // snapshot / replica-set / “transaction numbers…” → SnapshotReadsAreUnavailable
}

export class SnapshotReadsAreUnavailable
// code snapshot_consistency_unavailable, retryable true

function thisErrorMeansSnapshotReadsAreUnavailable(error)
// today's isSnapshotUnsupported — leave internal

// ── 2. Point this process at a snapshot read ──────────────

export function theSnapshotReadThisProcessUsesRightNow()
export function pointThisProcessAtASnapshotRead(adapter)
// default: new MongoReportingSnapshotAdapter()
```

Read the first-freeze path out loud: *Worker already stamped `source_read_through` on the queued run. Stream `prepareManifest` asks leftover freeze. Leftover freeze asks this slot’s `capture` with the cohort read. This file opens a snapshot on the primary, runs that read, stamps `operationTime` and `capturedAt`, and commits. Leftover freeze puts the token on the candidate bag and checksums it. Leftover persist stores `snapshot_token`. This file never wrote the run and never proved a fingerprint.*

Read the standalone-Mongo path out loud: *This process is not a replica set, or the session has no operation time. `capture` refuses with `SnapshotReadsAreUnavailable`. Leftover freeze does not persist a half bag. Do not silently fall through to an ordinary `find` so “preview still works.” Preview never asked this file.*

That is the operation. `capture` is not.

## Precise logic I would tighten while renaming

These are the smells I would keep as comments or tickets, not silent behavior changes.

1. **Source-read-through is a different instant.** Worker leftover `captureReportingSourceReadThrough` writes the fence **before** leftover freeze **asks** this file. Token `capturedAt` is a new `Date()` inside `capture`. `operationTime` is cluster time. Do not silently copy `sourceReadThrough` onto the token so “one clock owns the freeze.” Do not silently stamp source-read-through from `capturedAt` so “the adapter owns the fence.”

2. **Leftover prove does not use this session.** `validateReportingManifestEntries` re-reads after commit and compares `updatedAt` to `sourceReadThrough`. Do not silently wrap leftover prove in `capture` so “one snapshot owns prove too.” Do not start comparing fingerprints to `operationTime`.

3. **Leftover preview never asks this file.** `previewReportingQuery` paints fifty samples without a snapshot session. Do not silently wrap leftover preview so “every paint is consistent.” That would change leftover estimate latency and leftover TEST_MODE standalone Mongo.

4. **The contract test never calls Mongo.** `reporting.test.ts` “snapshot adapter contract” **asks** a local fake and the error class. `MongoReportingSnapshotAdapter.capture` has no file test. Do not “fix” that by editing tests in this Cloud pass.

5. **Leftover live register is a second snapshot transaction.** `registerSyntheticLiveTestSnapshotAdapter` opens snapshot **without** `readPreference: "primary"`, skips the missing-`operationTime` refuse, hardcodes `operationTime: "1"`, and does not map replica-set errors. It never restores the default slot. Do not silently delete that register so “one adapter owns live.” Do not silently teach it to construct `MongoReportingSnapshotAdapter` so “the class wins” without keeping the hardcoded token leftover synthetic manifest also stamps as `"1"`.

6. **`isSnapshotUnsupported` is a broad message fold.** Any thrown message matching `snapshot`, `transaction numbers are only allowed`, or `replica set` becomes unavailable — including a query error that happens to say “snapshot.” The catch also **rebuilds** `SnapshotConsistencyUnavailableError`, dropping the first stack. Do not silently narrow the regex so “real query errors surface.” Do not silently rethrow the original unavailable instance so “the stack is honest.” Leave the map.

7. **Catalog duplicates the token.** Leftover `ReportingCandidateManifestV1.snapshotToken` inlines the same three fields. This file exports `ReportingSnapshotTokenV1`. Do not silently move the catalog type here so “one type file owns tokens.” Do not invent a `types/` folder.

8. **`adapter` is always `mongodb_snapshot`.** Leftover test fakes and leftover live synthetic still stamp that literal. Do not invent `adapter: "in_memory"` so “the field earns its keep.” That would invent a second **adapter** the checksum would start hashing.

9. **The process slot is global.** `setReportingSnapshotAdapter` mutates module state. Leftover tests restore in `finally`. Leftover live orchestration never restores. Do not silently make leftover live restore so “the slot is polite” in this rename. Concurrent leftover tests can race the same slot — leave that.

10. **Leave sibling files alone.** Leftover freeze stays in `query/canonicalReporting.ts`. Leftover source-read-through stays in `reportingRunRepository.ts`. Leftover persist stays in `reportingManifestRepository.ts`. Leftover prove stays on leftover freeze. Leftover live register stays in `live/syntheticLiveTestManifest.ts`. Do not open unvisited `reportingObservability.ts` this pass.

## Testing

The interface is the story-named exports, not the helpers.

Existing asserts: a local fake `capture` returns `{ value, token }` with `adapter: "mongodb_snapshot"` / `operationTime: "100:1"`; `SnapshotConsistencyUnavailableError` has `code: "snapshot_consistency_unavailable"` and `retryable: true` (same test also locks sibling `CanonicalSourceChangedError` — that is leftover prove, not this file). Leftover freeze fixtures **ask** set / get to inject a session-less fake. No test starts `MongoReportingSnapshotAdapter` or a real snapshot transaction.

Add proofs at the new names (later implementer; not this Cloud pass):

- read through one snapshot: caller `read` receives the session; return value is the read’s `T`; token `adapter` is `mongodb_snapshot`; `operationTime` is `session.operationTime.toString()`; `capturedAt` is ISO
- refuse missing operation time: `operationTime` absent → `SnapshotReadsAreUnavailable`, transaction aborted
- refuse standalone Mongo: message matching leftover `isSnapshotUnsupported` → same unavailable, not the raw driver error
- other errors rethrow: a `TypeError` from leftover freeze is not remapped
- session always ends: success, unavailable, and other-error paths call `endSession`
- never stamp source-read-through: `ReportingRun` is not updated
- never persist: `persistReportingCandidateManifest` is not called
- never prove: `validateReportingManifestEntries` is not called
- point this process: leftover freeze **asks** get after set and sees the stand-in; leftover tests restore the default

Do not add helper-unit tests for `thisErrorMeansSnapshotReadsAreUnavailable`. Do not boot leftover live Google, leftover queue publisher, or leftover destination desk. Do not replace leftover freeze tests with this file so “one test owns both stories.” Do not assert leftover live’s hardcoded `operationTime: "1"` as if it were `readTheFreezeThroughOneMongoSnapshotAndStampThatMoment`.

## What I would not do

- I would not implement this pass.
- I would not rewrite `recommendations/form-lead.md`.
- I would not edit `src/`, tests, routes, models, or `docs/knowledge/`.
- I would not invent a CONTEXT.md term or an ADR. CONTEXT.md does not define Reporting.
- I would not open Wave B (`src/routes/reporting.routes.ts`, `src/models/ReportingRunManifest.ts`).
- I would not write a whole-folder Reporting recommendation.
- I would not introduce a `SnapshotAdapterService` class or a `create.ts` / `update.ts` / `delete.ts` split.
- I would not invent a second runtime snapshot **adapter** beside this Mongo one.
- I would not pull leftover freeze, leftover prove, leftover persist, leftover source-read-through, or leftover live register into this file.
- I would not silently wrap leftover preview in `capture`.
- I would not silently stamp `source_read_through` from `capturedAt`.
- I would not silently rename `adapter: "mongodb_snapshot"` or drop `epoch`-style dual clocks on the token.
- I would not silently narrow `isSnapshotUnsupported` or stop rebuilding the unavailable error.
- I would not teach leftover prove to **ask** this session.
- I would not open unvisited `reportingObservability.ts` while this checklist still has unchecked modules after this row.
- I would not silently reorder ADR-known side effects.
