# Persist The Frozen Candidate Set Once — Never The Rows — Expire It In Seven Days, And Resume Only The Same Checksum — operational story

- Status: recommended
- Service: `reporting` (Wave A, in-progress)
- Pass: 17 of this service — `reportingManifestRepository.ts`
- Remaining in this service: `manifestPageAdapter.ts`, `promotion.ts`, `promotionReservation.ts`, `snapshotAdapter.ts`, `reportingObservability.ts`, `cleanup.ts`, `ownershipMarker.ts`, `registryFilters.ts`, remaining `google/*` adapters, remaining `live/*` harness
- Target: `src/services/reporting/reportingManifestRepository.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (primary code is `reporting.service.ts`. Role: Owner-designed, checksum-bound reports. Happy path: preview → immutable revision → two-step confirmed run → **worker write**. Source read-through is captured by the worker under the active lease owner/epoch. Preview persist is a 15-minute TTL; confirmation TTL is 10 minutes; this freeze is a **seven-day** TTL. Knowledge never names this file, `persistReportingCandidateManifest`, `loadReportingCandidateManifest`, `assertNoRowPayload`, `REPORTING_MANIFEST_TTL_MS`, `reporting_manifest_checksum_conflict`, or the unique `{ run_id }` freeze — do not add a Reporting Service file in this rename so “the Service sentence wins”). Distinct from already-recommended gather / freeze / prove: [`reporting-canonical-reporting.md`](reporting-canonical-reporting.md) (`buildReportingCandidateManifest` **builds** the freeze the stream **asks**; `validateReportingManifestEntries` **proves** fingerprints resume **asks**; this file never queries leads). Distinct from already-recommended freeze-once / emit: [`reporting-execution-stream.md`](reporting-execution-stream.md) (`prepareManifest` **asks** sibling build then the caller’s `persist` callback — the worker **injects** `persistReportingCandidateManifest`; the stream never imports this file). Distinct from already-recommended claim / write / promote: [`reporting-reporting-worker.md`](reporting-reporting-worker.md) (**asks** `load` first; miss **asks** `prepareManifest` with persist; promoting **asks** `load` again and `INTERNAL_FAILURE` if missing). Distinct from already-recommended RAW write / resume prove: [`reporting-delivery-engine.md`](reporting-delivery-engine.md) (`assertPersistedManifestStructure` / `validatePersistedManifestForResume` **prove** version / source-read-through / page map / batched entries **after** this file returns a freeze; the engine does **not** import this file). Distinct from already-recommended claim / graph: [`reporting-run-repository.md`](reporting-run-repository.md) (the worker stamps source-read-through **before** persist; this file never leases). Distinct from already-recommended delivery fence: [`reporting-delivery-repository.md`](reporting-delivery-repository.md) (unique `run_id` there is delivery progress; unique `run_id` here is freeze metadata). Distinct from sibling page reader: `manifestPageAdapter.ts` (the stream **asks** `open` against a freeze this file already persisted). Distinct from sibling snapshot token: `snapshotAdapter.ts` (the freeze **asks** capture; this file stores `snapshot_token` as Mixed). Distinct from live synthetic freeze: `live/syntheticLiveTestManifest.ts` **builds** in memory and never **asks** this file. Distinct from Wave B `src/models/ReportingRunManifest.ts` (schema + unique `{ run_id }` + TTL `expires_at` `expireAfterSeconds: 0` + mongoose hooks that **throw** on mutate / `save` of an existing row — “mutations require the narrow Stage 4 repository”). Distinct from Wave B `src/routes/reporting.routes.ts` (Owner run GET does **not** import this file). This is not Admin Analytics and not Sheet Sync. This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR).
- Callers: `reportingWorker.ts` (**asks** `loadReportingCandidateManifest` after queued → querying; miss **asks** `requireLease` then `reportingStage4StreamV1.prepareManifest` with `persistReportingCandidateManifest`; always **asks** `validatePersistedManifestForResume` after load or persist; promoting **asks** `load` again and `failRun(..., "INTERNAL_FAILURE")` if missing). Tests: `reportingDelivery.test.ts` **asks** `assertNoRowPayload` (clean fixture does not throw; `outputPages[].rows` throws `/row payloads/`). `reporting.test.ts` / `executionStream.test.ts` / `reportingDelivery.regressions.test.ts` do **not** import this file. **No runtime caller** for `REPORTING_MANIFEST_TTL_MS` except persist. **No runtime caller** for `{ inserted }` — the worker ignores the boolean. Confirm / heartbeat / Owner GET / live harness do **not** import this file.
- Seams callers need: persist-once (`persist`) vs rebuild (the worker never **asks** `prepareManifest` when `load` hits). Same-checksum resume vs checksum conflict (`11000` + matching checksum → `{ inserted: false }`; mismatch → `reporting_manifest_checksum_conflict`). Refuse-row-payloads here vs resume prove in the engine (this file checks `row` / `values` / `cells` on entries and pages; the engine then proves version, source-read-through, page map, and batched fingerprints). The mongoose-hooks / native-collection **seam** exists because `ReportingRunManifest.ts` throws on mongoose mutate of an existing row; persist and load **must** use `ReportingRunManifest.collection`. The seven-day TTL / preview 15-minute TTL **seam** exists because preview is a short estimate artifact and this freeze is the worker’s durable candidate set. There is no lease **seam**. There is no fence **seam**. There is no begin / complete Domain Command **seam**. There is no Google write **seam**. There is no Analytics **seam**. There is no Sheet Sync **seam**.
- Split later (only if the file outgrows one sitting): this ~119-line file is one sitting if you read it as persist the frozen candidate set once — never the rows — expire it in seven days, and resume only the same checksum. Do **not** split into `create.ts` / `update.ts` / `delete.ts`. Do **not** split into `persist.ts` / `load.ts` / `assert.ts` so “each persist verb owns a file.” Do **not** pull stream build / resume prove / page reader / worker Google write here so “one freeze file owns the company.” If it later splits: `persistTheFrozenCandidateSetOnce.ts` / `resumeOnlyTheSameChecksum.ts` only as later story files, never CRUD.

`persistReportingCandidateManifest` / `loadReportingCandidateManifest` / `assertNoRowPayload` are executor mechanics. The owner question is: *The worker already claimed this run and stamped source-read-through. Freeze the records we used: IDs, versions, fingerprints, and the page map. Never store the rows. Write that freeze once for this run. If we already wrote it, keep going only when the checksum is the same. If the checksum differs, refuse — that is a different freeze, not this run. Expire the freeze in seven days. When we resume write or promote, load that same freeze. Do not rebuild it. Do not prove the source did not move here. Do not write Google. Do not claim a lease. Do not swap the managed tab. Do not publish the poke.*

Stream build, resume prove, page reader, worker Google write, and run claim already live in other **modules**. Do not pull those in.

## What this file actually does

Four operations of one “persist the frozen candidate set once — never the rows — expire it in seven days, and resume only the same checksum” story, not “a manifest CRUD repository,” and not stream build or Google write:

1. **Refuse row payloads before anything is written** — `assertNoRowPayload`. Entries must not carry `row` / `values` / `cells`. Pages must not carry `rows` / `values` / `cells`. TypeError: “Reporting candidate manifests must not persist row payloads.” / “Reporting output page maps must not persist row payloads.” Persist **asks** this first. Tests **ask** the clean fixture and `outputPages[].rows`. The JSON scan of `rows` / `sample` / `values` / `cells` / `payload` is a no-op — the `if` body is empty. This is not `assertPersistedManifestStructure` (version, source-read-through match, and page-number safety live in the engine).

2. **Persist the frozen candidate set once for this run** — `persistReportingCandidateManifest`. Native `ReportingRunManifest.collection.insertOne`. Unique `run_id`. Stores `version: 1`, `source_read_through`, `manifest_captured_at`, `snapshot_token`, entries (`model` / `id` / `version` / `fingerprint` only), output pages (`pageNumber` / `afterCursor` / `nextCursor` / `dependencyKeys` only), `checksum` as given (not lowercased), `expires_at` = `now` + `REPORTING_MANIFEST_TTL_MS` (seven days). Returns `{ inserted: true }`. Invalid run id throws `TypeError("Invalid reporting run ID.")`. The worker **asks** this only inside `prepareManifest` after `load` missed. This file does not call `buildReportingCandidateManifest`. This file does not insert `ReportingRun`.

3. **Resume only the same checksum** — insert `11000` **asks** `load`. Matching `checksum` returns `{ inserted: false }`. Mismatch throws `Error("reporting_manifest_checksum_conflict")`. Other errors rethrow. The worker ignores `{ inserted }` and keeps the in-memory `prepared` the stream returned. Two workers that built different freezes for the same run fail closed.

4. **Load the freeze for this run** — `loadReportingCandidateManifest`. Native `findOne` `{ run_id }`. Miss → `null`. Hit reconstructs `ReportingCandidateManifestV1`: ISO `sourceReadThrough` / `manifestCapturedAt`, `snapshotToken` as stored, entries copied, pages with `afterCursor` / `nextCursor` default `null`, `checksum` via `String`. `expires_at` is persist-only and is not returned. The worker **asks** load first (miss builds once) and again at promoting (miss is `INTERNAL_FAILURE`). Owner GET does not **ask** this file.

Unused `mongoose` import is not an operation. `asObjectId` / `isDuplicateKeyError` are beats. There is no update export and no delete export — Mongo TTL on `expires_at` janitors the row.

## Organization

Keep one file. This is the screenplay for “persist the frozen candidate set once — never the rows — expire it in seven days, and resume only the same checksum.” Stream build, resume prove, page reader, worker Google write, and run claim already live in deeper **modules**. Do not pull those in. Do not invent a `ReportingManifestRepository` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second freeze-build **adapter**. Do not invent a lease **adapter** beside run persist.

Do not split persist / load / refuse into CRUD files. Persist and same-checksum resume stay together because `11000` is not overwrite. Do not mongoose `create` from this file so “we match destination persist” — Wave B hooks throw on mutate of an existing row and persist already uses `.collection.insertOne`. Do not `publishReportingWakeup` from this file. Do not `validatePersistedManifestForResume` from this file so “one freeze file owns prove.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `persistReportingCandidateManifest` | `persistTheFrozenCandidateSetOnce` | worker first write via `prepareManifest` |
| `loadReportingCandidateManifest` | `loadTheFreezeForThisRun` | worker first-write miss / promoting reload |
| `assertNoRowPayload` | `refuseRowPayloadsBeforeTheFreezeIsWritten` | persist first beat; tests |
| `REPORTING_MANIFEST_TTL_MS` | `SEVEN_DAY_FREEZE_TTL_MS` | persist `expires_at` only |

Keep the old names as one-line aliases until `reportingWorker.ts` and `reportingDelivery.test.ts` migrate. Do not make confirm learn `persistTheFrozenCandidateSetOnce` as run insert. Do not make the stream learn `persistTheFrozenCandidateSetOnce` as build. Do not make the engine learn `refuseRowPayloadsBeforeTheFreezeIsWritten` as resume prove.

**Principle: old exports stay as aliases.** `persistReportingCandidateManifest` remains the imported name until the worker points at the story name.

**No class for the workflow.** The types that *do* earn names are the freeze the worker already injects and the persist result the worker already ignores:

```ts
type FrozenCandidateSet = {
  version: 1
  sourceReadThrough: string
  manifestCapturedAt: string
  snapshotToken: { adapter: "mongodb_snapshot"; operationTime: string; capturedAt: string }
  entries: Array<{ model: string; id: string; version: string; fingerprint: string }>
  outputPages: Array<{
    pageNumber: number
    afterCursor: string | null
    nextCursor: string | null
    dependencyKeys: string[]
  }>
  checksum: string
}

type FreezePersistResult = { inserted: boolean }
```

That is the handoff from “the stream built the freeze” to “the worker may resume write or promote from the same checksum.” Do **not** put row cells on `FrozenCandidateSet`. Do **not** move `validatePersistedManifestForResume` into this file so “every prove lives next to persist.”

There is no deps bag today. Do not invent `PersistTheFrozenCandidateSetOnceDeps` unless a later test **adapter** needs to inject `ReportingRunManifest.collection`. Default remains native collection.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// reportingManifestRepository.ts
// The worker already claimed this run and stamped source-read-through.
// Freeze the records we used: IDs, versions, fingerprints, and the page map.
// Never store the rows.
// Write that freeze once for this run.
// If we already wrote it, keep going only when the checksum is the same.
// If the checksum differs, refuse — that is a different freeze, not this run.
// Expire the freeze in seven days.
// When we resume write or promote, load that same freeze.
// Do not rebuild it.
// Do not prove the source did not move here.
// Do not write Google.
// Do not claim a lease.
// Do not swap the managed tab.
// Do not publish the poke.
// ReportingRunManifest mongoose hooks throw if you mutate an existing row
// the ordinary way — persist and load must use .collection.

// ── 1. Refuse row payloads before anything is written ─────

export function refuseRowPayloadsBeforeTheFreezeIsWritten(manifest)
// entries: no row / values / cells
// pages: no rows / values / cells
// JSON scan of rows/sample/values/cells/payload is a no-op today

// ── 2. Persist the frozen candidate set once ──────────────

export async function persistTheFrozenCandidateSetOnce(input)
// insertOne unique run_id; seven-day expires_at; { inserted: true }

// ── 3. Resume only the same checksum ──────────────────────

// 11000 → load; matching checksum → { inserted: false }
// mismatch → reporting_manifest_checksum_conflict

// ── 4. Load the freeze for this run ───────────────────────

export async function loadTheFreezeForThisRun(runId)
// null if missing; reconstructs v1; expires_at is persist-only
```

Read the worker first-write path out loud: *load the freeze for this run. If it is missing, keep the five-minute lease, ask the stream to freeze the records we used, then persist that freeze once — never the rows. If another worker already wrote the same checksum, keep going. If the checksum differs, refuse. Always **ask** the engine `validatePersistedManifestForResume` after load or persist. Do not rebuild a freeze `load` already returned.*

Read the promoting path out loud: *load the freeze for this run again. If it is gone, fail `INTERNAL_FAILURE`. Do not persist a new freeze here. The engine proves version / source-read-through / page map / fingerprints after this file returns the freeze.*

That is the operation. `persistReportingCandidateManifest` is not.

## Precise logic I would tighten while renaming

These are the smells I would keep as comments or tickets, not silent behavior changes.

1. **The JSON forbidden-key scan is a no-op.** `assertNoRowPayload` stringifies the freeze and loops `rows` / `sample` / `values` / `cells` / `payload`, then does nothing (the `if` body is empty). Entry / page field checks are the real refuse. Do not silently throw from the JSON scan while renaming so “the comment wins.” Do not delete the scan in this rename.

2. **`{ inserted }` has no runtime caller.** Persist returns it. Same-checksum `11000` returns `{ inserted: false }`. The worker ignores the boolean and keeps the in-memory `prepared` the stream returned. Do not start branching on `inserted` in the worker so “the boolean owns resume.”

3. **Checksum is stored as given.** Run persist lowercases `query_plan_checksum`. This file does not lowercase `checksum`. Load `String`s it. Do not silently lowercase while renaming.

4. **This file never leases.** The worker `requireLease`s before `prepareManifest`. Persist has no `lease_owner` / fence match. Do not require a lease here so “every persist looks like run persist.”

5. **This file never proves source-read-through.** The engine `assertPersistedManifestStructure` matches `sourceReadThrough`. This file stores the instant and reconstructs ISO. Do not merge the two refuses so “one assert owns the freeze.”

6. **Unused `mongoose` import.** Drop it on rename. Do not start mongoose `findOneAndUpdate` on `ReportingRunManifest` so “we match destination persist” — Wave B hooks throw.

7. **Leave sibling files alone.** Stream build stays in `query/canonicalReporting.ts`. Persist-once orchestration stays in `executionStream.ts`. Resume prove stays in `deliveryEngine.ts`. Page reader stays in `manifestPageAdapter.ts`. Worker Google write stays in `reportingWorker.ts`. Run claim stays in `reportingRunRepository.ts`. Do not open unvisited `durableWork/`.

## Testing

The interface is the story-named exports, not the helpers.

Keep the existing test that already locks this file: `assertNoRowPayload` in `reportingDelivery.test.ts` (clean fixture does not throw; `outputPages[].rows` throws `/row payloads/`).

Add Mongo `TEST_MODE` proofs at the new names:

- persist the frozen candidate set once: unique `run_id`; stores IDs / versions / fingerprints / page maps; `expires_at` is now + seven days; invalid run id throws
- refuse row payloads before the freeze is written: entries with `row` / `values` / `cells` throw; pages with `rows` / `values` / `cells` throw; JSON scan stays a no-op
- resume only the same checksum: second persist with matching checksum returns `{ inserted: false }`; mismatch throws `reporting_manifest_checksum_conflict`
- load the freeze for this run: reconstructs v1 ISO dates; missing is `null`; `expires_at` is not returned
- worker first-write: `load` miss **asks** `prepareManifest` then persist; `load` hit never rebuilds
- promoting miss: `load` null is `INTERNAL_FAILURE`, not a second persist

Do not add helper-unit tests for `asObjectId` or `isDuplicateKeyError`. Do not boot live Google, the queue publisher, run claim, or resume prove.

## What I would not do

- I would not implement this pass.
- I would not rewrite `recommendations/form-lead.md`.
- I would not edit `src/`, tests, routes, models, or `docs/knowledge/`.
- I would not invent a CONTEXT.md term or an ADR. CONTEXT.md does not define Reporting.
- I would not open Wave B (`src/routes/reporting.routes.ts`, `src/models/ReportingRunManifest.ts`).
- I would not write a whole-folder Reporting recommendation.
- I would not introduce a `ReportingManifestRepository` class or a `create.ts` / `update.ts` / `delete.ts` split.
- I would not split persist / load / refuse into separate persist files.
- I would not pull stream build, resume prove, page reader, worker Google write, or run claim into this file.
- I would not switch persist / load to mongoose `findOneAndUpdate` on `ReportingRunManifest`.
- I would not require a lease or fence on persist.
- I would not silently throw from the JSON forbidden-key scan so “the comment wins.”
- I would not start the worker branching on `{ inserted }`.
- I would not silently lowercase `checksum`.
- I would not open unvisited `durableWork/`.
- I would not silently reorder ADR-known side effects.
