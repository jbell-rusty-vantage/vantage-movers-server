# Apply This Approved Historical Manifest — Prove The Live Cluster And Indexes Still Match, Take The Fence, Journal The Baseline, Then Insert Or Compare-And-Swap Each Sealed Write And Remember It In The Registry — Never Recalculate, Never Call Live Form Or Booking Services, Never Enable Sheet Sync Or CRM, Never Verify Or Rollback — operational story

- Status: recommended
- Service: `historicalConsolidation` (Wave A, in-progress)
- Pass: 4 of this service — `apply.ts`
- Remaining in this service: `verify.ts`, `rollback.ts`, `migrationContext.ts`, `targetGuard.ts`, `operationalLock.ts`, `schemaValidation.ts`, `normalization.ts`, `dateParsing.ts`, `stableJson.ts`, `mongoValues.ts`
- Target: `src/services/historicalConsolidation/apply.ts`
- Knowledge: none for this folder. The staged-merge spec is [`historical-consolidation-rules-and-staging-spec.md`](../../../docs/index.md) (Stage G: review and apply — blocking cases resolved, preconditions pass, two applies on a fresh `testvantagemovers` prove the second is a no-op; Planner module seam: the applier accepts only an approved manifest plus an explicitly selected target and migration context, cannot read Sheets or recalculate, and the context disables outbound integrations). Hardening plan: [`historical-consolidation-final-hardening-and-pre-run-implementation-plan.md`](../../../docs/index.md) (target-local `historical_import_registry` / `historical_import_apply_journal` / `historical_import_locks`; `applyHistoricalManifest(manifest, target, migrationContext)`; bounded transactional batches; compare-and-swap; fencing token before commit). Already-recommended siblings: [historical-consolidation-classification.md](historical-consolidation-classification.md), [historical-consolidation-planner.md](historical-consolidation-planner.md) (never writes Mongo), [historical-consolidation-manifest.md](historical-consolidation-manifest.md) (seals hashes / operation ids; leftover apply never **asks** `parseHistoricalManifest`). Distinct from leftover `verify.ts` (proves targets, counts, references, and leftover `SIDE_EFFECT_COLLECTIONS` growth — this file only plants the journal baseline). Distinct from leftover `rollback.ts` (undo under leftover rollback authorization — same leftover lock family, not this **interface**). Distinct from leftover `targetGuard.ts` / leftover `migrationContext.ts` / leftover `operationalLock.ts` (this file **asks** all three). Distinct from leftover `stableJson.ts` (`assertArtifactHash` / `sha256` — this file **asks** both). Distinct from leftover `mongoValues.ts` (`mongoDocument` / `matchesPlanned` / `comparable` — this file **asks** all three). Distinct from leftover `schemaValidation.ts` (Mongoose parity at seal time — this file does **not** **ask** it). Distinct from already-recommended live [form-lead.md](form-lead.md) / [leads-call-lead.md](leads-call-lead.md) / [bookings-booked-lead.md](bookings-booked-lead.md) / [cancellations-cancelled-lead.md](cancellations-cancelled-lead.md) / [customers-customer.md](customers-customer.md) — those write through application services and tell sheets. Distinct from leftover `ingest-historical-sheets.ts` (the write-capable row-by-row upsert the spec forbids becoming the planner *or* the applier). `package.json` still names `pnpm historical:apply`; the staged-merge script folder is **absent** from this checkout. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — do not invent “Historical Apply” copies. `docs/adr/` is absent here — do not invent ADR copies. Do not add a Historical Consolidation Service in this rename.
- Callers: **the barrel, plus leftover verify for one constant.** Barrel `historicalConsolidation/index.ts` re-exports `applyHistoricalManifest` and `preflightHistoricalManifest` (not leftover `SIDE_EFFECT_COLLECTIONS`). Leftover `verify.ts` imports leftover `SIDE_EFFECT_COLLECTIONS` from this file and subtracts the journaled `apply_start.side_effect_baseline` from live counts. There is **no** `apply.test.ts`. Folder `manifest.test.ts` **asks leftover** `assertApplyAuthorized` / leftover `createHistoricalMigrationRunner` — those beats are **not** this **interface**. Leftover `rollback.ts` does **not** import this file. Already-recommended planner / sealer / classifier do **not** import this file. Scripts in this checkout do **not** import this file. Not this **interface**: leftover `assertApplyAuthorized`, leftover `requireHistoricalMigrationContext`, leftover `acquireHistoricalOperationalLock`, leftover `verifyHistoricalManifest`, leftover `rollbackHistoricalManifest`, leftover `parseHistoricalManifest`, leftover `createFormLead` / `createBookedLead` / `createCancelledLead`, leftover `ingest-historical-sheets.ts`.
- Seams callers need: leftover authorization vs this mutate; leftover migration-context **require** vs this mutate (the missing script must wrap — this file does not start the ALS); leftover lock acquire / in-transaction fence / after-batch heartbeat / release; leftover in-memory `assertArtifactHash` vs already-recommended `parseHistoricalManifest` (this file never opens bytes); exported preflight vs apply (rehearsal may **ask** prove-the-target alone); journaled side-effect baseline vs leftover verify; registry `applied` / `verified` skip vs insert or compare-and-swap; before-commit batch transaction vs after-commit heartbeat and `apply_complete` journal. There is no begin / complete Domain Command **seam**. There is no live Form / Booking service **adapter**. There is no Sheet Sync **adapter**. There is no dry-run write **adapter**. There is no parse-bytes **adapter**.
- Split later (only if the file outgrows one sitting): this ~133-line file is one sitting if you read it as apply this approved historical manifest. If it later splits by **story**: `proveThisLiveTargetStillMatchesTheSealedManifest.ts`, `writeTheseSealedHistoricalOperationsUnderTheFence.ts` — never `create.ts` / `update.ts` / `delete.ts`. Leftover verify, leftover rollback, leftover target guard, leftover lock, leftover migration context, leftover hasher, leftover mongo values, and live Form / Booking writes stay siblings / other services.

`applyHistoricalManifest` is executor mechanics. The owner question is: *The planner already listed every write. The sealer already stamped ids and hashes. Prove the live cluster fingerprint, the collection checksums (unless a registry row already says we started), and the expected indexes still match, and that no blocking case is still unresolved. Then, only while leftover authorization, leftover migration context, and leftover lock say I may write, journal the start and the outbound-collection counts. Walk every sealed operation in a bounded batch. Insert a new document, or compare-and-swap an update. Remember each write in the registry so a second apply is a no-op. Journal each committed batch. Heartbeat the fence. Journal the finish. This file does not recalculate the plan. This file does not call live Form Lead or Booking services. This file does not turn on Sheet Sync or CRM Posting. This file does not verify. This file does not rollback.*

Who authorizes the target, who plants the ALS suppress flags, who owns the fence, who hashes the artifact, who materializes `$oid` / `$date`, and who proves the live copy after the write already live in leftover **modules**. Do not pull those in.

## What this file actually does

Four “apply this approved historical manifest” stories in one sitting, not “a CRUD applier,” and not Plan This Historical Merge / Seal This Historical Manifest / Prove This Applied Manifest / Undo This Applied Manifest:

1. **Prove the live target still matches the sealed manifest** — `preflightHistoricalManifest`. **Ask** leftover `assertArtifactHash` on the in-memory object. A blocking conflict whose `status` is not `decision_supplied` throws. `db.command({ hello: 1 })` becomes leftover `sha256({ setName, sorted hosts })` and must equal `manifest.target_cluster_fingerprint`. Count leftover `historical_import_registry` rows for this `manifest_hash`. When that count is **zero**, every `target_collection_checksums` entry is a full `_id`-sorted scan through leftover `comparable` and leftover `sha256` — a drift throws. When the count is **greater than zero**, checksums are skipped (resume). Then every leftover `expected_indexes` row except leftover `historical_import_registry` must exist with the same name, `unique` flag, and `JSON.stringify(key)`. Return `{ ok: true, target_database: db.databaseName, resume_operations }`. This beat does **not** compare `manifest.target_database` to `db.databaseName`. This beat does **not** **ask** leftover `assertApplyAuthorized`. This beat does **not** **ask** leftover `validateManifestOperations`. This beat does **not** **ask** leftover `parseHistoricalManifest`. This beat does **not** check leftover `expected_counts`. This beat does **not** write.

2. **Refuse unless leftover authorization, leftover migration context, and leftover lock say we may write, then journal start and the outbound baseline** — `applyHistoricalManifest` open. **Ask** leftover `assertArtifactHash` again. **Ask** leftover `assertApplyAuthorized(manifest, db.databaseName, authorization)`. **Ask** leftover `requireHistoricalMigrationContext()` — this file does **not** call leftover `createHistoricalMigrationRunner().run`. **Ask** operation 1. Create leftover unique `operation_id` / `migration_key` indexes on the registry and the journal index. Acquire leftover `acquireHistoricalOperationalLock` (`lock_owner` or `pid:uuid`; batch size clamped 1–500, default 100). Count leftover `sheet_sync_jobs`, `lead_messages`, `operational_events`, `notification_deliveries`. Journal `apply_start` with `fencing_token` and that baseline **outside** a transaction. This beat does **not** assert those counts stay put — leftover verify does. This beat does **not** start Sheet Sync, Lead Messaging, observability, or notifications. This beat does **not** return `dry_run: true`; leftover authorization throws when `apply` is false, and the result always plants `dry_run: false`.

3. **Write each sealed operation under the fence, remember it, journal the batch, heartbeat** — the batch loop. Each slice runs leftover `session.withTransaction`. Inside the transaction **ask** leftover `assertHistoricalOperationalFence` (owner + fencing token + unexpired). For each operation: registry `applied` or `verified` → `alreadyApplied` and skip the document. Else materialize leftover `mongoDocument`. **Insert:** missing `document` throws; a live `_id` without an applied registry row throws *even when the live document already matches*; else `insertOne`. **Update:** missing `set` or `before` throws (`before` is never compared); `updateOne` filter is `{ _id, ...precondition }`; `matchedCount !== 1` is allowed only when leftover `matchesPlanned(existing, set)` — otherwise throw compare-and-swap failed. Then upsert leftover `historical_import_registry` to `state: "applied"` (`$setOnInsert` migration key / hash / model / provenance / target id). Journal `batch_committed` **inside** the same transaction. After commit, **ask** leftover `heartbeatHistoricalOperationalLock` (outside the transaction). This beat does **not** **ask** leftover `createFormLead` / `createBookedLead` / `createCancelledLead` / leftover Operations Registry commands. This beat does **not** write `sheet_sync` jobs. This beat does **not** stamp leftover `verified`.

4. **Journal finish or failure, then release the fence** — `apply_complete` with inserted / updated / already_applied / batches, or `apply_failed` with the error message and rethrow. `finally` **asks** leftover `releaseHistoricalOperationalLock`. Return leftover `ApplyResult` (`manifest_hash`, connected `target_database`, `dry_run: false`, counters). A second call that still holds leftover authorization and leftover context walks the same list and counts `alreadyApplied`. This beat does **not** **ask** leftover `verifyHistoricalManifest`. This beat does **not** **ask** leftover `rollbackHistoricalManifest`.

There is no fifth plan or classify operation. Leftover `applyOperation` / leftover `ensureOperationalIndexes` / leftover `withTransaction` are folds operations 2–3 **ask**. Re-export through the barrel is convenience for a missing `pnpm historical:apply` script. Leftover `SIDE_EFFECT_COLLECTIONS` is the handoff leftover verify **asks**.

## Organization

Keep one file. This is the screenplay for “apply this approved historical manifest.” Authorization already lives on leftover `targetGuard.ts`. ALS suppress flags already live on leftover `migrationContext.ts`. The fence already lives on leftover `operationalLock.ts`. Artifact hash already lives on leftover `stableJson.ts`. `$oid` / `$date` / planned-field compare already live on leftover `mongoValues.ts`. Prove-after-write already lives on leftover `verify.ts`. Undo already lives on leftover `rollback.ts`. Seal already lives on already-recommended `manifest.ts`. Do not pull those in. Do not invent a `HistoricalApplyService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a live Form / Booking **adapter** so “the spec’s application-services sentence becomes true.” Do not invent a filesystem **adapter** so “apply opens the artifact.” Do not invent a dry-run **adapter** that writes nothing while this export still returns `dry_run: false`. Do not invent a CRUD folder so “insert and update each get a file.”

Do not merge this into already-recommended `manifest.ts` so “one function owns seal and write.” Do not move leftover `assertApplyAuthorized` here so “apply owns the target-guard checklist.” Do not start the leftover runner here so “apply owns the ALS.” Do not move leftover verify’s side-effect subtract here so “apply proves outbound silence.” Do not split `create.ts` / `update.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `preflightHistoricalManifest` | `proveThisLiveTargetStillMatchesTheSealedManifest` | rehearsal / the missing apply script may prove cluster, checksums, and indexes without writing |
| `applyHistoricalManifest` | `applyThisApprovedHistoricalManifest` | the missing apply script must write under leftover authorization + leftover context + leftover lock |
| `SIDE_EFFECT_COLLECTIONS` | `collectionsLeftoverVerifyMustProveDidNotGrow` | leftover verify subtracts the journaled baseline; this file only counts |
| `ApplyResult` | `ThisHistoricalApplyOutcome` | inserted / updated / already_applied / batches; `dry_run` is always `false` |

Keep the old names as one-line aliases until the barrel, leftover `verify.ts`, and a later apply fixture migrate. Do not make callers learn leftover `applyOperation` / leftover `withTransaction` / leftover `ensureOperationalIndexes` as the domain language. Do **not** export leftover `applyOperation`. Do **not** rename persisted collection names (`historical_import_registry`, `historical_import_apply_journal`) or journal `kind` strings (`apply_start`, `batch_committed`, `apply_complete`, `apply_failed`). Do **not** rename persisted registry `state` tokens (`applied`, `verified`). Do **not** rename leftover `SIDE_EFFECT_COLLECTIONS` members — leftover verify subtracts those exact keys. Do **not** rename leftover `ApplyResult` field names (`already_applied`, `dry_run`, `batches`).

**No workflow class.** The two types that *do* earn a name are the apply seat the missing script plants and the outcome it reads:

```ts
type ThisHistoricalApplySeat = {
  batch_size?: number
  lock_owner?: string
}

type ThisHistoricalApplyOutcome = {
  manifest_hash: string
  target_database: string
  dry_run: false
  inserted: number
  updated: number
  already_applied: number
  batches: number
}
```

That is the handoff from “the owner approved a hash” to “leftover verify can prove the live copy.” Leftover `ApplyAuthorization` stays on leftover `targetGuard.ts`. Leftover `HistoricalMigrationContext` stays on leftover `migrationContext.ts`. Leftover `HistoricalOperationalLock` stays on leftover `operationalLock.ts`. Do **not** move those cards here. Do **not** add `migrationContext` as a function argument so “the July type becomes true” in this rename — the ALS **require** is the current **seam**.

Leave prove-after-write on leftover `verify.ts`. Leave undo on leftover `rollback.ts`. Leave the target-guard checklist on leftover `targetGuard.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// apply.ts
// The planner already listed every write. The sealer already stamped ids.
// Prove the live cluster, checksums, and indexes still match.
// Then write only while leftover authorization, leftover context,
// and leftover lock say we may.
// Insert or compare-and-swap. Remember each write.
// Journal start, each batch, and finish.
// Do not recalculate. Do not call live Form or Booking services.
// Do not enable Sheet Sync or CRM. Do not verify. Do not rollback.

// ── 1. Prove the live target still matches ────────────────

export async function proveThisLiveTargetStillMatchesTheSealedManifest(manifest, db)
// ask leftover assertArtifactHash
function refuseUnresolvedBlockingConflicts(manifest)
function refuseAClusterFingerprintDrift(manifest, db) // hello setName + sorted hosts
function skipCollectionChecksumsWhenTheRegistryAlreadyStarted(manifest, db)
function refuseAChangedCollectionChecksum(manifest, db) // only when resume is 0
function refuseAMissingOrChangedExpectedIndex(manifest, db) // skip the registry collection

// ── 2. Take the fence and journal the baseline ────────────

export async function applyThisApprovedHistoricalManifest(manifest, db, authorization, seat)
// ask leftover assertArtifactHash
// ask leftover assertApplyAuthorized
// ask leftover requireHistoricalMigrationContext — do not start the runner
// ask proveThisLiveTargetStillMatchesTheSealedManifest
function ensureTheRegistryAndJournalIndexes(db)
// ask leftover acquireHistoricalOperationalLock
function countTheOutboundCollectionsTheVerifierMustWatch(db)
function journalApplyStart(manifest, db, lock, baseline) // outside the transaction

// ── 3. Write each sealed operation under the fence ────────

function writeThisSealedBatchUnderTheFence(manifest, db, lock, batch, offset)
// ask leftover assertHistoricalOperationalFence inside the transaction
function skipAnAlreadyAppliedOrVerifiedRegistryRow(operation, db, session)
function insertThisSealedDocumentOrRefuseABareIdCollision(operation, db, session)
function compareAndSwapThisSealedUpdate(operation, db, session)
  // before must be present; do not start comparing it in this rename
function rememberThisWriteInTheRegistry(manifest, operation, db, session)
function journalThisCommittedBatch(manifest, db, lock, offset, outcome, session)
// ask leftover heartbeatHistoricalOperationalLock after commit

// ── 4. Journal finish and release ─────────────────────────

function journalApplyComplete(manifest, db, outcome)
function journalApplyFailed(manifest, db, error) // then rethrow
// finally ask leftover releaseHistoricalOperationalLock
```

Read the primary path out loud: *Hash the in-memory manifest. Refuse an unresolved blocking case, a cluster fingerprint drift, a first-run checksum drift, or a missing index. Refuse unless leftover authorization, leftover migration context, and leftover lock say this connected database may mutate. Journal the start and the outbound counts. For each bounded batch, prove the fence, then insert a missing document or compare-and-swap an update, skip a registry row that is already applied or verified, and remember the write. Heartbeat. Journal the finish. A second apply on the same hash is a no-op. Do not walk the sheets again. Do not call live Form Lead or Booking create. Do not turn on Sheet Sync. Do not verify. Do not rollback.*

That is the operation. `applyOperation` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **July spec says the applier invokes application services.** Stage G / the planner-module seam still say the apply path “uses application services with a migration context.” This file writes leftover `collection.insertOne` / `updateOne`. It never **asks** leftover `createFormLead`, leftover `createBookedLead`, leftover `createCancelledLead`, or leftover Operations Registry commands. Do not start calling those so “the sentence becomes true.” That would silently schedule Sheet Sync, CRM Posting, Lead Messaging, and owner events unless every live write path honors leftover ALS flags — a different, tested change. Keep the raw write. The ALS **require** is a seat fence, not a suppress that this file reads.

2. **July type plants `migrationContext` as an argument.** Hardening plan: `applyHistoricalManifest(manifest, target, migrationContext)`. Current export is `(manifest, db, authorization, options)` and **asks** leftover `requireHistoricalMigrationContext()`. The missing `pnpm historical:apply` script must wrap leftover `createHistoricalMigrationRunner(scriptPath).run`. Do not add a context argument so “the July type lives here,” and do not start the runner inside this file so “apply owns the ALS.” Leave the runner on leftover `migrationContext.ts`.

3. **This file never opens bytes.** It **asks leftover** `assertArtifactHash` on an in-memory object. Already-recommended `parseHistoricalManifest` is the disk **seam** and is still uncalled by leftover apply. Do not route this export through parse so “one function owns every hash” in this rename. That contradiction is already open from the sealer pass.

4. **`dry_run` is a lie on the result card.** Leftover `ApplyResult.dry_run` is always `false`. Leftover `assertApplyAuthorized` throws when `authorization.apply` is false (“dry-run by default”). There is no write-nothing path in this file. Do not add a dry-run walk that still returns this card without an **interface** proof, and do not delete the field so “the name stops lying” until leftover verify / a later script stop reading it.

5. **`manifest.target_database` is not this preflight.** The sealed body types `target_database: "vantagemovers"`. Rehearsal leftover authorization allows connected `testvantagemovers`. Operation 1 never compares the sealed field to `db.databaseName`. Leftover `assertApplyAuthorized` compares connected name to `authorization.target`. Do not add the sealed-field check here so “the manifest owns the database,” without proving rehearsal still applies to `testvantagemovers`.

6. **Resume skips every collection checksum.** One leftover `historical_import_registry` row for this hash turns checksums off, even after a failed first batch. That is how a second apply can continue. Do not re-enable checksums on resume so “every apply is a fresh preflight” — a mid-apply retry would then throw on its own inserts. Do not treat `resume_operations` as “already applied count”; it is “registry rows for this hash,” including states leftover verify later stamps `verified`.

7. **Insert collision has no planned-match fallback.** Update may succeed when the CAS misses but leftover `matchesPlanned(existing, set)`. Insert throws on any live `_id` without an applied registry row, even when the live document already equals the planned insert. Keep the throw in this rename. Do not copy the update fallback onto insert so “idempotent insert matches update,” without an **interface** proof that a crashed insert-before-registry cannot silently skip.

8. **`before` is required and unused.** Update throws when `before` is missing, then never reads it. Preconditions are `operation.precondition`. Do not start comparing `before` to the live document so “the field becomes true” in this rename. Leftover rollback is the sibling that may need the image.

9. **Side-effect baseline is evidence, not a fence.** This file counts leftover `SIDE_EFFECT_COLLECTIONS` and journals them. It never throws when they grow. Leftover verify subtracts and errors. Do not move that subtract here so “apply proves outbound silence.” Do not drop the export because the barrel does not re-export it.

10. **Heartbeat sits after commit.** A batch can persist and then leftover `heartbeatHistoricalOperationalLock` can throw. The next retry must resume from the registry, not rewind the batch. Do not move heartbeat inside the transaction so “one commit owns the clock,” and do not silently swallow a fenced heartbeat. Journal `apply_start` / `apply_complete` / `apply_failed` stay outside the batch transaction; `batch_committed` stays inside. Do not reorder that **seam**.

11. **The folder has no apply fixture.** `manifest.test.ts` proves leftover authorization and leftover runner. Those are leftover `targetGuard.ts` and leftover `migrationContext.ts`. Do not keep them as this **interface**. Do not move them into this file so “apply owns the checklist.”

12. **The staged-merge CLI is missing here.** `package.json` still names `pnpm historical:apply`; the folder it points at is not in this checkout. Do not invent the script in this rename, and do not treat leftover `ingest-historical-sheets.ts` as the caller.

13. **Leave sibling modules and live writes alone.** Leftover `assertApplyAuthorized`, leftover `requireHistoricalMigrationContext`, leftover `acquireHistoricalOperationalLock` / leftover fence / leftover heartbeat / leftover release, leftover `assertArtifactHash` / leftover `sha256`, leftover `mongoDocument` / leftover `matchesPlanned` / leftover `comparable`, leftover `verifyHistoricalManifest`, leftover `rollbackHistoricalManifest`, and already-recommended `sealThisHistoricalManifest` are not this file. Do not inline them so “the applier is one sitting.”

## Testing

The **interface** is the test surface: `applyThisApprovedHistoricalManifest` and `proveThisLiveTargetStillMatchesTheSealedManifest` (today `applyHistoricalManifest` / `preflightHistoricalManifest`). Leftover `SIDE_EFFECT_COLLECTIONS` may stay exported as an alias; leftover verify is its caller, not a second apply test surface.

There is no `apply.test.ts`. Do not treat leftover `manifest.test.ts` leftover-authorization / leftover-runner proofs as this **interface**.

Add only what this **interface** still hides. Tests must wrap leftover `createHistoricalMigrationRunner` with a path under `/scripts/historical_[REDACTED]_db_staged_merge_ingestion/` and plant leftover authorization. Use a disposable database. Do **not** point at live `vantagemovers`.

**Prove the live target still matches**
- Sealed hash + matching fingerprint + empty registry + matching checksums + matching indexes → `{ ok: true, resume_operations: 0 }`.
- Blocking conflict still `unresolved` → throw.
- `hello` fingerprint drift → throw.
- First run (resume 0) with a drifted collection checksum → throw.
- Registry already has one row for this hash + drifted checksum → preflight succeeds (`resume_operations >= 1`); checksum is skipped.
- Missing expected index, or unique/key drift, on a non-registry collection → throw.
- Expected index named on leftover `historical_import_registry` → ignored by this export.
- Do **not** require leftover `authorization.apply` on preflight.

**Take the fence and journal the baseline**
- Missing leftover migration context → throw “without migration context”; no journal row.
- Leftover `authorization.apply` false → leftover target-guard dry-run throw; no lock, no journal.
- Happy start → one `apply_start` with `fencing_token` and a baseline key for each leftover `SIDE_EFFECT_COLLECTIONS` member.
- Another live leftover lock owner → throw “Another historical migration holds the target lock.”

**Write each sealed operation**
- Insert of a missing `_id` → `inserted: 1`, registry `applied`, journal `batch_committed` then `apply_complete`.
- Second apply of the same sealed list → `already_applied` equals the operation count; `inserted` and `updated` stay 0; checksums are not re-scanned.
- Insert onto a live `_id` with no applied registry row → throw target-id collision (even when the live document matches).
- Update whose precondition matches → `updated: 1` and `$set` equals leftover `mongoDocument(set)`.
- Update whose precondition misses but leftover `matchesPlanned(existing, set)` → counts as `updated` and still upserts registry `applied`.
- Update whose precondition misses and the live document does not match `set` → throw compare-and-swap failed; no registry `applied`.
- Update missing `set` or `before` → throw.
- Registry already `verified` → `alreadyApplied`; document is not written again.
- Lost fence inside the transaction → throw; that batch does not journal `batch_committed`.

**Journal finish and release**
- Success → `apply_complete` plus leftover lock row gone.
- Mid-walk throw → `apply_failed` plus leftover lock row gone, then the error surfaces.
- Result `dry_run` is `false` on the happy path.
- Do **not** require leftover verify’s side-effect subtract here.
- Do **not** require leftover rollback.

Do **not** add a test per helper (`refuseAClusterFingerprintDrift`, `insertThisSealedDocumentOrRefuseABareIdCollision`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

`ApplyResult` / leftover `SIDE_EFFECT_COLLECTIONS` may stay exported as aliases. They are not a second test surface.

## What I would not do

- A `HistoricalApplyService` class with `apply` / `preflight` / `create` / `update`.
- Thirty two-line functions that only wrap leftover `assertArtifactHash` or leftover `collection.insertOne`.
- Moving this into a CRUD folder, or an `apply/` folder that also swallows leftover `verify.ts`, leftover `rollback.ts`, leftover `targetGuard.ts`, leftover `operationalLock.ts`, and leftover `migrationContext.ts`.
- Treating leftover `planHistoricalConsolidation`, leftover `buildHistoricalManifest`, leftover `parseHistoricalManifest`, leftover `verifyHistoricalManifest`, leftover `rollbackHistoricalManifest`, leftover `assertApplyAuthorized`, leftover `createFormLead`, or leftover `ingest-historical-sheets.ts` as this story.
- Inventing a Domain Command **seam** that has only this raw Mongo walk as an **adapter**.
- Inventing a live Form / Booking **adapter** so “the spec’s application-services sentence becomes true.”
- Routing this export through `parseHistoricalManifest` so “one function owns every hash” in this rename.
- Starting leftover `createHistoricalMigrationRunner` inside this file so “apply owns the ALS.”
- Moving leftover verify’s side-effect subtract here so “apply proves outbound silence.”
- Comparing `before` to the live document, or copying the update planned-match fallback onto insert, so “unused fields become true.”
- Re-enabling first-run checksums on resume so “every apply is a fresh preflight.”
- Reordering journal-outside-transaction vs `batch_committed`-inside vs heartbeat-after-commit.
- Opening `verify.ts` in this pass, or writing a whole-folder recommendation for `historicalConsolidation`.
