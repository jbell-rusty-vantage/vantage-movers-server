# Plant Three Fake Form Leads So Official Freeze Can Still Name Cohort Entries — Never Paint Those Documents — Swap The Snapshot Adapter So Freeze Can Capture Without A Real Replica-Set Clock — And Say Out Loud That Painted Rows Are Synthetic — Do Not Build A Second Freeze Nobody Asks — operational story

- Status: recommended
- Service: `reporting` (Wave A, in-progress)
- Pass: 41 of this service — `live/syntheticLiveTestManifest.ts`
- Remaining in this service: `live/syntheticManifestPageAdapter.ts`, then remaining `live/*` harness
- Target: `src/services/reporting/live/syntheticLiveTestManifest.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (primary code is `reporting.service.ts`. Role: Owner-designed, checksum-bound reports. Happy path: preview → immutable revision → two-step confirmed run → **worker write**. Cron table names `/api/cron/reporting-delivery-heartbeat` (+ health-scan, cleanup, test-artifact janitor). Knowledge never names this file, `LIVE_TEST_HARNESS_LIMITATION`, `seedLiveTestCanonicalFormLeads`, `liveTestFormLeadObjectIds`, `registerSyntheticLiveTestSnapshotAdapter`, `buildSyntheticLiveTestManifest`, `LIVE_TEST_FORM_LEAD_IDS`, `operationTime: "1"`, or a live-test synthetic freeze — do not add a Reporting Service file in this rename so “the Service sentence wins”). Distinct from already-recommended live orchestration: [`reporting-live-google-orchestration.md`](reporting-live-google-orchestration.md) (that file **asks** register snapshot adapter, seed Form Leads, and the limitation sentence on every evidence bag; it never **asks** `buildSyntheticLiveTestManifest` or `liveTestFormLeadObjectIds`). Distinct from already-recommended seed-a-queued-run: [`reporting-live-test-run-factory.md`](reporting-live-test-run-factory.md) (that file names `SYN-LIVE-*` rows and plants the queued run; this file **asks** those rows only inside the dead builder; this file re-exports `LIVE_TEST_COLUMNS` with no importer). Distinct from already-recommended official freeze: [`reporting-canonical-reporting.md`](reporting-canonical-reporting.md) (worker **asks** `buildReportingCandidateManifest` under the swapped snapshot adapter; this file **asks** `buildOutputPageMappings` only from the dead builder). Distinct from already-recommended snapshot slot: [`reporting-snapshot-adapter.md`](reporting-snapshot-adapter.md) (this file **asks** `setReportingSnapshotAdapter`; official `MongoReportingSnapshotAdapter` **asks** `readPreference: "primary"` and refuses a missing `operationTime`; this file hardcodes `"1"` and never restores the default). Distinct from already-recommended official page reader: [`reporting-manifest-page-adapter.md`](reporting-manifest-page-adapter.md) (official reader **asks** Mongo row payloads; unvisited `syntheticManifestPageAdapter.ts` injects synthetic rows instead). Distinct from already-recommended persist freeze: [`reporting-manifest-repository.md`](reporting-manifest-repository.md) (never **asks** this file). Distinct from already-recommended worker: [`reporting-reporting-worker.md`](reporting-reporting-worker.md) (orchestration **asks** `runReportingDeliveryWorker` after this file has swapped the slot and planted Form Leads; this file names the worker only in the limitation sentence). Distinct from already-recommended stamp / trash-the-set: [`reporting-live-test-cleanup.md`](reporting-live-test-cleanup.md) (never **asks** this file). Distinct from already-recommended harness-run registry: [`reporting-live-test-harness-run-registry.md`](reporting-live-test-harness-run-registry.md) (never **asks** this file). Distinct from unvisited synthetic page adapter: `live/syntheticManifestPageAdapter.ts` (orchestration **asks** that file to paint `SYN-LIVE-*`; this file does not register the page adapter). Distinct from unvisited mask: `live/piiSafeEvidence.ts` (orchestration **asks** `buildMaskedLiveTestEvidence` with this file’s `limitation`). Distinct from unvisited retry wrapper / later janitor / evaluate. Distinct from Wave B `src/routes/reporting.routes.ts` and Wave B `scripts/reporting/run-live-google-harness.ts` (**asks** the facade, never this file). Distinct from Wave B Form Lead ingest (`formLead.service.ts`). This is not Admin Analytics and not Sheet Sync. This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR).
- Callers: already-recommended `live/liveGoogleOrchestration.ts` (**asks** `registerSyntheticLiveTestSnapshotAdapter` after `connectMongo` + `registerReportingStage4Foundation`; **asks** `seedLiveTestCanonicalFormLeads`; **asks** `LIVE_TEST_HARNESS_LIMITATION` on success evidence, catch `buildFailureResult`, and skip `skippedResult`). No other `src/` import. `buildSyntheticLiveTestManifest` has **no caller**. `liveTestFormLeadObjectIds` has **no caller**. `LIVE_TEST_COLUMNS` re-export has **no importer** (the factory already exports it). Tests: **no test imports this file**. `live/liveGoogleHarness.test.ts` skip / mask only. `reporting.test.ts` **asks** `setReportingSnapshotAdapter` for freeze fixtures — not this register. `reportingDelivery.test.ts` builds a token literal. Owner HTTP never **asks** this file. Queue consumer never **asks** this file. **No HTTP route** mounts this file.
- Seams callers need: say-the-live-test-limitation-out-loud (`LIVE_TEST_HARNESS_LIMITATION`) vs plant-three-fake-form-leads-so-official-freeze-can-still-name-cohort-entries (`seedLiveTestCanonicalFormLeads` / `liveTestFormLeadObjectIds`) vs swap-the-snapshot-adapter-so-freeze-can-capture-without-a-real-replica-set-clock (`registerSyntheticLiveTestSnapshotAdapter`) vs build-a-synthetic-freeze-nobody-asks (`buildSyntheticLiveTestManifest`). The limitation / mask **seam** exists because orchestration **asks** this sentence and sibling mask only stores it. The seed / official-freeze **seam** exists because worker **asks** `buildReportingCandidateManifest` after this seed; page paint never reads those documents. The seed / factory-empty-registry **seam** exists because the factory query `registry: { companies: [], granularities: [] }` becomes `$or: []` on official freeze. The register / official-snapshot **seam** exists because official capture **asks** primary + real `operationTime`; this register hardcodes `"1"` and never restores. The this-file-builder / official-freeze **seam** exists because `buildSyntheticLiveTestManifest` has no caller; worker freeze stays `buildReportingCandidateManifest`. The this-file / page-adapter **seam** exists because this file does not register paint; unvisited `syntheticManifestPageAdapter.ts` does. There is no begin / complete Domain Command **seam**. There is no worker **seam**. There is no `files.update` `{ trashed: true }` **seam**. There is no HTTP **seam**. There is no Analytics **seam**. There is no Sheet Sync **seam**.
- Split later (only if the file outgrows one sitting): this ~140-line file is one sitting if you read it as plant three fake Form Leads so official freeze can still name cohort entries — never paint those documents — swap the snapshot adapter so freeze can capture without a real replica-set clock — and say out loud that painted rows are synthetic. Do not build a second freeze nobody asks. Do **not** split into `seed.ts` / `snapshot.ts` / `manifest.ts` / `create.ts` / `update.ts` / `delete.ts`. Do **not** pull orchestration, factory seed-run, official freeze, official snapshot class, or the page adapter here so “one synthetic file owns the company.” If it later splits: `sayTheLiveTestLimitationOutLoud.ts` / `plantThreeFakeFormLeadsForOfficialFreeze.ts` / `swapTheSnapshotAdapterSoFreezeCanCaptureWithoutARealReplicaSetClock.ts` only as later story files, never CRUD.

`LIVE_TEST_HARNESS_LIMITATION` / `seedLiveTestCanonicalFormLeads` / `registerSyntheticLiveTestSnapshotAdapter` / `buildSyntheticLiveTestManifest` are executor mechanics. The owner question is: *After live Google testing connects Mongo, plant three fake Form Leads in the January window so official freeze can still name cohort entries. Do not paint those documents. The tab still gets three synthetic `SYN-LIVE-*` rows from the page adapter. Swap the snapshot adapter so freeze can capture without a real replica-set clock. Say out loud that painted rows are synthetic and that the worker still runs lease / checkpoint / verify / promotion / Owner OAuth in this process — not HTTP, not cron, not the queue consumer. Do not build a second freeze and call it done. Do not start the worker from this file. Do not trash a folder. Do not hit HTTP. Do not sync the Master Sheet.*

Already-recommended orchestration, factory seed-run, official freeze, snapshot slot, official page reader, persist freeze, and worker already live in other **modules**. Page adapter, mask, retry wrapper, later janitor stay sibling **modules**. Do not pull those in.

## What this file actually does

Four operations of one “plant three fake Form Leads so official freeze can still name cohort entries — never paint those documents — swap the snapshot adapter so freeze can capture without a real replica-set clock — and say out loud that painted rows are synthetic” story, not “a synthetic-manifest CRUD helper,” and not official freeze / page paint / factory seed-run:

1. **Say the live-test limitation out loud** — `LIVE_TEST_HARNESS_LIMITATION`. One sentence: canonical Mongo row payloads are not read for page content; synthetic rows are injected via the live-test manifest page adapter while worker lease / checkpoint / verify / promotion / Google OAuth still execute; the harness **asks** `runReportingDeliveryWorker` in-process and does not exercise HTTP routes, Vercel cron, or the reporting queue consumer. Orchestration stamps this on success, failure, and skip evidence.

2. **Plant three fake Form Leads so official freeze can still name cohort entries** — `seedLiveTestCanonicalFormLeads` + unused `liveTestFormLeadObjectIds`. Dynamic-imports `FormLead`. `collection.insertMany` three fixed ids (`64b0000000000000000a0001`–`a0003`), `updatedAt` / `createdAt` `2026-01-15T12:00:00.000Z`, `timestamp` `2026-01-10T12:00:00.000Z`, source `live-test-co` / `live-test-granularity`, name `Synthetic Live Lead`, phone `+15555550100`, email `live-test@example.invalid`. `{ ordered: false }`. Swallows duplicate-key `11000` and any error without a `code`. Does not **ask** `ingestFormLead`. Does not paint Google.

3. **Swap the snapshot adapter so freeze can capture without a real replica-set clock** — `registerSyntheticLiveTestSnapshotAdapter`. **Asks** `setReportingSnapshotAdapter` with an inline `capture` that starts a snapshot transaction, **asks** the caller `read`, commits, and returns `adapter: "mongodb_snapshot"`, `operationTime: "1"`, `capturedAt` now. No `readPreference: "primary"`. No missing-`operationTime` refuse. No replica-set error map. Never restores the default slot. Orchestration **asks** this once after `connectMongo` and never again.

4. **Build a synthetic freeze nobody asks** — `buildSyntheticLiveTestManifest`. Maps the three factory `SYN-LIVE-*` rows onto those Form Lead ids, **asks** `buildOutputPageMappings` with `_dependencyKeys`, checksums a `ReportingCandidateManifestV1` whose snapshot token is also `operationTime: "1"`. **No caller.** The no-op spread `...(index >= rows.length ? {} : {})` is empty on both sides.

`LIVE_TEST_COLUMNS` re-export is not a fifth owner operation.

## Organization

Keep one file. This is the screenplay for “plant three fake Form Leads so official freeze can still name cohort entries — never paint those documents.” Orchestration, factory seed-run, official freeze, official snapshot class, official page reader, and the synthetic page adapter already live in deeper **modules**. Do not pull those in. Do not invent a `SyntheticLiveTestManifestService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second freeze **adapter** beside `buildReportingCandidateManifest`. Do not invent a second snapshot class beside `MongoReportingSnapshotAdapter`. Do not invent a second page-paint **adapter** beside `registerSyntheticLiveTestManifestPageAdapter`.

Do not split limitation / seed / register / dead builder into CRUD files. Seed stays with register because orchestration **asks** both before the first worker claim. Do not move official freeze here so “the harness owns the manifest.” Do not start the worker from this file so “one synthetic file owns Google.” Do not start `ingestFormLead` from this file so “every Form Lead uses public ingest.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `LIVE_TEST_HARNESS_LIMITATION` | `sayTheLiveTestLimitationOutLoud` | orchestration stamps every evidence bag |
| `seedLiveTestCanonicalFormLeads` | `plantThreeFakeFormLeadsSoOfficialFreezeCanStillNameCohortEntries` | orchestration after connect |
| `liveTestFormLeadObjectIds` | `nameTheThreeFakeFormLeadIdsNobodyAsks` | dead export — keep until a caller exists or a later tested delete |
| `registerSyntheticLiveTestSnapshotAdapter` | `swapTheSnapshotAdapterSoFreezeCanCaptureWithoutARealReplicaSetClock` | orchestration after connect; never restores |
| `buildSyntheticLiveTestManifest` | `buildASyntheticFreezeNobodyAsks` | dead export — keep until a caller exists or a later tested delete |
| `LIVE_TEST_COLUMNS` | `reExportTheThreeLiveTestColumnsNobodyImports` | factory already owns the columns |

Keep the old names as one-line aliases until `live/liveGoogleOrchestration.ts` migrates. Do not make orchestration learn `plantThreeFakeFormLeadsSoOfficialFreezeCanStillNameCohortEntries` as a new import path in this rename. Do not persist a new harness marker version in this rename.

**No class for the workflow.** The type that *does* earn a name is the planted-lead bag official freeze already keys on:

```ts
type FakeFormLeadTheOfficialFreezeMayName = {
  id: "64b0000000000000000a0001" | "64b0000000000000000a0002" | "64b0000000000000000a0003"
  timestamp: "2026-01-10T12:00:00.000Z"
  createdAt: "2026-01-15T12:00:00.000Z"
  lead_source_company: "live-test-co"
}
```

That is the handoff from “we planted these documents” to “official freeze may list them as entries.” Do **not** put `SYN-LIVE-*` on this type — those are factory paint rows. Do **not** put `trashed: true` on this type. Do **not** put `refresh_token` on this type. Do **not** put official `ReportingRun` ids on this type.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// syntheticLiveTestManifest.ts
// After live Google testing connects Mongo,
// plant three fake Form Leads in the January window
// so official freeze can still name cohort entries.
// Do not paint those documents.
// The tab still gets three synthetic SYN-LIVE-* rows
// from the page adapter.
// Swap the snapshot adapter so freeze can capture
// without a real replica-set clock.
// Say out loud that painted rows are synthetic
// and that the worker still runs lease / checkpoint /
// verify / promotion / Owner OAuth in this process —
// not HTTP, not cron, not the queue consumer.
// Do not build a second freeze and call it done.
// Do not start the worker from this file.
// Do not trash a folder.

// ── 1. Say the live-test limitation out loud ─────────────

export const sayTheLiveTestLimitationOutLoud =
  "Canonical Mongo row payloads are not read for page content; …"
export const LIVE_TEST_HARNESS_LIMITATION = sayTheLiveTestLimitationOutLoud

// ── 2. Plant three fake Form Leads ───────────────────────

export function nameTheThreeFakeFormLeadIdsNobodyAsks()
export const liveTestFormLeadObjectIds = nameTheThreeFakeFormLeadIdsNobodyAsks

export async function plantThreeFakeFormLeadsSoOfficialFreezeCanStillNameCohortEntries()
  // FormLead.collection.insertMany — bypasses the model
  // swallow 11000 and any error without a code
export const seedLiveTestCanonicalFormLeads =
  plantThreeFakeFormLeadsSoOfficialFreezeCanStillNameCohortEntries

// ── 3. Swap the snapshot adapter ─────────────────────────

export function swapTheSnapshotAdapterSoFreezeCanCaptureWithoutARealReplicaSetClock()
  // setReportingSnapshotAdapter({ capture })
  // snapshot transaction, no primary preference
  // operationTime: "1" — never restore default
export const registerSyntheticLiveTestSnapshotAdapter =
  swapTheSnapshotAdapterSoFreezeCanCaptureWithoutARealReplicaSetClock

// ── 4. Build a synthetic freeze nobody asks ──────────────

export function buildASyntheticFreezeNobodyAsks(input)
  // liveTestSyntheticRows + buildOutputPageMappings
  // checksum a ReportingCandidateManifestV1
  // no caller
export const buildSyntheticLiveTestManifest = buildASyntheticFreezeNobodyAsks
```

Read the primary path out loud: *Connect Mongo. Swap the snapshot adapter so the next official freeze can capture without a real replica-set clock — the token will say `operationTime: "1"`. Plant three fake Form Leads dated January 10 in the live-test source. Do not ingest them through the public Form Lead path. Do not paint their name, phone, or email onto a tab. Register the page adapter later; it will paint `SYN-LIVE-001` booked, `SYN-LIVE-002` cancelled, `SYN-LIVE-003` open. Start the worker in this process. Lease, checkpoint, verify, promote, and Owner OAuth still run. HTTP, cron, and the queue consumer do not. Stamp that limitation on the evidence bag even when the harness skips. Do not call `buildSyntheticLiveTestManifest`. That builder has no caller.*

That is the operation. `buildSyntheticLiveTestManifest` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **The file is named after the export nobody asks.** `buildSyntheticLiveTestManifest` has no caller. Official freeze stays `buildReportingCandidateManifest`. Rename the lie. Do not silently start orchestration **asking** this builder so “the parameter starts working.” Do not silently delete it in this rename without a paired test that names “no caller.”

2. **Planted Form Leads may never enter official freeze.** Factory query `registry: { companies: [], granularities: [] }` becomes `registryMongoPredicate` `{ $or: [] }`. Empty `$or` matches nobody. Seed still writes `live-test-co`. Rename the gap. Do not silently add `live-test-co` to the factory registry so “the seed starts working.” Do not silently delete the seed so “page adapter owns paint” without a paired test that names whether freeze entries are empty.

3. **Page paint never reads the planted documents.** Limitation says canonical Mongo row payloads are not read for page content. Seed writes `Synthetic Live Lead` / `+15555550100` / `live-test@example.invalid`. Page adapter paints `SYN-LIVE-*`. Rename the split. Do not silently start the official page reader so “live test proves Mongo paint.”

4. **Snapshot register never restores the default.** Already named on [`reporting-snapshot-adapter.md`](reporting-snapshot-adapter.md) and [`reporting-live-google-orchestration.md`](reporting-live-google-orchestration.md). This file owns the swap. Official capture **asks** primary + real `operationTime` + replica-set map. This register skips all three and hardcodes `"1"`. Do not silently construct `MongoReportingSnapshotAdapter` so “the class wins.” Do not silently restore the default in this rename.

5. **`collection.insertMany` bypasses the Form Lead model.** Same pattern as factory `collection.insertOne`. No validators, no CPL, no provenance, no Sheet Sync. Rename the beat (`insertTheFakeFormLeadsWithoutTheModel`). Do not silently switch to `FormLead.create` so “the model owns every insert” unless a later tested change says the validators must run. Do not silently **ask** `ingestFormLead`.

6. **Duplicate swallow is broader than `11000`.** The catch rethrows only when `error.code !== 11000`. An error without a `code` is swallowed. Rename the silent catch. Do not silently narrow it to `11000` only without a paired test for a connection failure.

7. **`liveTestFormLeadObjectIds` is a lie sitting next to the seed.** No caller. The seed inlines `LIVE_TEST_FORM_LEAD_IDS`. Rename as name-the-three-fake-form-lead-ids-nobody-asks. Do not silently start using it from the dead builder so “the helper earns a caller.”

8. **`LIVE_TEST_COLUMNS` has two barrels.** Factory exports it. This file re-exports it. No importer **asks** this barrel. Do not delete the re-export in this rename without a paired test that names “no importer.” Do not move the columns here so “the manifest file owns the columns.”

9. **Dead builder’s no-op spread.** `...(index >= rows.length ? {} : {})` is empty on both sides. Three factory rows and three ids always line up. Rename the leftover. Do not silently start attaching extra fields there so “the spread starts working.”

10. **Dead builder hardcodes the same `operationTime: "1"` as the swapped adapter.** Official freeze under the swapped adapter also stamps `"1"`. Two checksums, one fake clock. Rename the twin. Do not silently start reading `session.operationTime` in the dead builder.

11. **Dynamic `FormLead.js` import.** Seed is the only live-test path that loads the model this way. Factory seed-run imports `ReportingDefinition` at the top. Rename the split. Do not silently hoist the import so “every seed looks the same” without a paired test for circular load.

12. **No test asks this file.** `reporting.test.ts` leftover freeze fixtures **ask** `setReportingSnapshotAdapter` with a session-less fake. That is not enough for a story that plants Form Leads and swaps the live slot.

13. **Leave sibling modules alone.** `buildReportingCandidateManifest`, `setReportingSnapshotAdapter`, `seedLiveTestQueuedRun`, `registerSyntheticLiveTestManifestPageAdapter`, and `runReportingDeliveryWorker` are already the right **depth**. This file plants documents, swaps the slot, and names the limitation.

## Testing

The **interface** is the test surface: `sayTheLiveTestLimitationOutLoud`, `plantThreeFakeFormLeadsSoOfficialFreezeCanStillNameCohortEntries`, `swapTheSnapshotAdapterSoFreezeCanCaptureWithoutARealReplicaSetClock`, `buildASyntheticFreezeNobodyAsks` (today `LIVE_TEST_HARNESS_LIMITATION` / `seedLiveTestCanonicalFormLeads` / `registerSyntheticLiveTestSnapshotAdapter` / `buildSyntheticLiveTestManifest`).

Today **no test imports this file**. That is not enough for a story that writes Form Leads and swaps the process-wide snapshot slot.

Replace the missing coverage with tests that name the operation. Use `TEST_MODE`. Do not boot live Google.

**Limitation**
- The sentence names synthetic page content, in-process worker, and no HTTP / cron / queue consumer.

**Plant**
- Three documents land at the fixed ids with January 10 timestamps and `live-test-co`.
- A second plant swallows `11000` and does not throw.
- An error without a `code` is swallowed today (name the gap). Do not silently narrow the catch in this rename.
- `ingestFormLead` / Sheet Sync / CRM Posting are not **asked**.

**Swap**
- After register, `getReportingSnapshotAdapter().capture` returns `operationTime: "1"` and `adapter: "mongodb_snapshot"`.
- `readPreference: "primary"` is not **asked**.
- Default `MongoReportingSnapshotAdapter` is not restored (name the gap). Do not silently restore in this rename.

**Dead builder**
- `buildSyntheticLiveTestManifest` has no runtime caller.
- `liveTestFormLeadObjectIds` has no runtime caller.
- `LIVE_TEST_COLUMNS` re-export has no importer.

Do **not** add a test per helper (the `11000` type-guard, the empty spread). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** boot official janitor, worker write, queue publish, Analytics, or Sheet Sync inside these tests. Official freeze stays `reporting.test.ts`. Live Google stays `pnpm reporting:live-google-harness`. Restore the snapshot slot in `finally` if a later implementer **asks** register from a test.

## What I would not do

- I would not implement this pass.
- I would not rewrite recommendations/form-lead.md.
- I would not edit src/, tests, routes, models, or docs/knowledge/.
- I would not invent a CONTEXT.md term or an ADR. CONTEXT.md does not define Reporting or Reporting Sheets.
- I would not open Wave B (`src/routes/reporting.routes.ts`, `src/config/domain/reportingLiveTest.ts`, `scripts/reporting/run-live-google-harness.ts`).
- I would not write a whole-folder Reporting recommendation.
- I would not introduce a `SyntheticLiveTestManifestService` class or a `seed.ts` / `snapshot.ts` / `manifest.ts` / `create.ts` / `update.ts` / `delete.ts` split.
- I would not invent a second freeze **adapter** beside `buildReportingCandidateManifest`.
- I would not silently start orchestration **asking** `buildSyntheticLiveTestManifest`.
- I would not silently delete `buildSyntheticLiveTestManifest` or `liveTestFormLeadObjectIds`.
- I would not silently add `live-test-co` to the factory registry.
- I would not silently construct `MongoReportingSnapshotAdapter` from this register.
- I would not silently restore the default snapshot slot.
- I would not silently **ask** `ingestFormLead` or `FormLead.create`.
- I would not silently merge this file with `liveTestRunFactory.ts` or `syntheticManifestPageAdapter.ts`.
- I would not silently start the worker from this file.
- I would not open `live/syntheticManifestPageAdapter.ts` while this checklist still has unchecked modules after this row.
- I would not silently reorder ADR-known side effects.
