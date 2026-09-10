# Undo This Applied Historical Manifest — Take Leftover Rollback Authorization And Leftover Context And The Fence, Reverse The Sealed List, Then Delete An Unreferenced Insert Or Deactivate A Referenced Catalog Insert Or Restore An Update From Before, Stamp Rolled Back, And Journal The Card — Never Recalculate, Never Call Live Form Or Booking Services, Never Enable Sheet Sync Or CRM, Never Verify — operational story

- Status: recommended
- Service: `historicalConsolidation` (Wave A, in-progress)
- Pass: 6 of this service — `rollback.ts`
- Remaining in this service: `migrationContext.ts`, `targetGuard.ts`, `operationalLock.ts`, `schemaValidation.ts`, `normalization.ts`, `dateParsing.ts`, `stableJson.ts`, `mongoValues.ts`
- Target: `src/services/historicalConsolidation/rollback.ts`
- Knowledge: none for this folder. The staged-merge spec is [`historical-consolidation-rules-and-staging-spec.md`](../../../docs/index.md) (Stage G is review and apply; rollback is the abort path, not a second planner). Hardening plan: [`historical-consolidation-final-hardening-and-pre-run-implementation-plan.md`](../../../docs/index.md) (`rollbackHistoricalManifest(manifest, target, migrationContext): RollbackResult`; delete only deterministic IDs this manifest inserted and only when no non-migration references appeared after apply; restore updates only when the live field still equals the manifest-applied value; reverse dependency order; deactivate, rather than hard-delete, migration-created catalog records when any reference exists; journal rollback the same idempotent way as apply; stop and emit a conflict when a later live write makes automatic undo unsafe). Owner runbook: dry-run and apply rollback on the rehearsal database, then restore a fresh copy and reapply; rollback against `vantagemovers` needs its own exact manifest-hash and immediate confirmation phrase. Already-recommended siblings: [historical-consolidation-classification.md](historical-consolidation-classification.md), [historical-consolidation-planner.md](historical-consolidation-planner.md) (never writes Mongo), [historical-consolidation-manifest.md](historical-consolidation-manifest.md) (seals hashes / operation ids; leftover rollback never **asks** `parseHistoricalManifest`), [historical-consolidation-apply.md](historical-consolidation-apply.md) (insert / compare-and-swap under leftover apply authorization — same leftover lock family, not this **interface**; leftover apply journals `apply_failed` on throw — this file does **not**), [historical-consolidation-verify.md](historical-consolidation-verify.md) (proves the live copy and stamps leftover `verified` — this file may undo `applied` **or** leftover `verified` and never **asks** leftover prove). Distinct from leftover `targetGuard.ts` / leftover `migrationContext.ts` / leftover `operationalLock.ts` (this file **asks** all three; leftover `assertRollbackAuthorized` is narrower than leftover `assertApplyAuthorized`). Distinct from leftover `stableJson.ts` (`assertArtifactHash` — this file **asks** it). Distinct from leftover `mongoValues.ts` (`mongoDocument` / `matchesPlanned` — this file **asks** both; leftover `comparable` is not this file). Distinct from leftover `schemaValidation.ts` (this file does **not** **ask** it). Distinct from already-recommended live [form-lead.md](form-lead.md) / [leads-call-lead.md](leads-call-lead.md) / [bookings-booked-lead.md](bookings-booked-lead.md) / [cancellations-cancelled-lead.md](cancellations-cancelled-lead.md) / [customers-customer.md](customers-customer.md) / [agents-agent-allocation.md](agents-agent-allocation.md) — those write through application services and tell sheets; this file only `deleteOne` / `$set` / `$unset` on raw collections. Distinct from leftover `ingest-historical-sheets.ts` (the write-capable row-by-row upsert the spec forbids becoming the planner, the applier, *or* the undo). `package.json` still names `pnpm historical:rollback`; the staged-merge script folder is **absent** from this checkout. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — do not invent “Historical Rollback” copies. `docs/adr/` is absent here — do not invent ADR copies. Do not add a Historical Consolidation Service in this rename.
- Callers: **the barrel, plus one helper fixture.** Barrel `historicalConsolidation/index.ts` re-exports `rollbackHistoricalManifest` (not leftover `buildRollbackUpdate`). Folder `rollback.test.ts` **asks leftover** `buildRollbackUpdate` only — that helper is **not** the public **interface**. Folder `manifest.test.ts` **asks leftover** `assertRollbackAuthorized` — that beat is leftover `targetGuard.ts`, not this **interface**. Already-recommended apply / verify / planner / sealer / classifier do **not** import this file. Scripts in this checkout do **not** import this file. Not this **interface**: leftover `assertRollbackAuthorized`, leftover `requireHistoricalMigrationContext`, leftover `acquireHistoricalOperationalLock`, leftover `applyHistoricalManifest`, leftover `verifyHistoricalManifest`, leftover `parseHistoricalManifest`, leftover `createFormLead` / leftover `deleteFormLead` / leftover `createBookedLead`, leftover `ingest-historical-sheets.ts`.
- Seams callers need: leftover rollback authorization vs this mutate (narrower than leftover apply’s checklist — `vantagemovers` needs exact database + hash + `ROLLBACK ${hash} FROM vantagemovers`; `testvantagemovers` needs only leftover `apply: true`); leftover migration-context **require** vs this mutate (the missing script must wrap — this file does not start the ALS); leftover lock acquire / in-transaction fence / after-batch heartbeat / release (same leftover `historical-consolidation` lock as leftover apply); leftover in-memory `assertArtifactHash` vs already-recommended `parseHistoricalManifest` (this file never opens bytes); reverse sealed-list walk vs leftover apply’s forward walk; registry missing / leftover `rolled_back` skip vs leftover apply’s leftover `applied` / leftover `verified` skip; leftover `matchesPlanned` refuse vs leftover apply’s compare-and-swap throw; catalog deactivate vs hard delete; conflict accumulate-and-return vs leftover apply’s throw; before-commit batch transaction vs after-commit heartbeat and `rollback_complete` journal. There is no leftover verify **seam**. There is no leftover `rollback_failed` journal **seam**. There is no begin / complete Domain Command **seam**. There is no live Form / Booking service **adapter**. There is no Sheet Sync **adapter**. There is no dry-run write **adapter**. There is no parse-bytes **adapter**.
- Split later (only if the file outgrows one sitting): this ~122-line file is one sitting if you read it as undo this applied historical manifest. If it later splits by **story**: `undoTheseSealedHistoricalInserts.ts`, `restoreTheseSealedHistoricalUpdatesFromBefore.ts` — never `create.ts` / `update.ts` / `delete.ts`. Leftover apply, leftover verify, leftover target guard, leftover lock, leftover migration context, leftover hasher, leftover mongo values, and live Form / Booking writes stay siblings / other services.

`rollbackHistoricalManifest` is executor mechanics. The owner question is: *Apply already wrote every sealed operation. Hash the in-memory manifest. Refuse unless leftover rollback authorization, leftover migration context, and leftover lock say this connected database may undo. Reverse the sealed list. Journal the start. For each bounded batch, prove the fence. Skip a missing or already-rolled-back registry row. If the live document no longer matches the planned insert or set, remember a conflict and leave it. Delete an insert that nothing outside this manifest still points at. Deactivate an insert on leftover `agents` / leftover `merchants` / leftover `lead_source_companies` / leftover `lead_source_granularities` when an outside document still points at it. Conflict a non-catalog insert that still has an outside pointer. Restore an update from leftover `before` and unset fields the precondition said were originally absent. Stamp leftover `rolled_back`. Journal each committed batch. Heartbeat the fence. Journal the finish. This file does not recalculate the plan. This file does not call live Form Lead or Booking services. This file does not turn on Sheet Sync or CRM Posting. This file does not verify.*

Who authorizes the narrower rollback phrase, who plants the ALS suppress flags, who owns the fence, who hashes the artifact, and who materializes `$oid` / `$date` already live in leftover **modules**. Do not pull those in.

## What this file actually does

Four “undo this applied historical manifest” stories in one sitting, not “a CRUD deleter,” and not Plan This Historical Merge / Seal This Historical Manifest / Apply This Approved Manifest / Prove This Applied Manifest:

1. **Refuse unless leftover rollback authorization, leftover migration context, and leftover lock say we may undo, then journal start** — `rollbackHistoricalManifest` open. **Ask** leftover `assertArtifactHash` on the in-memory object. **Ask** leftover `assertRollbackAuthorized(db.databaseName, manifest.manifest_hash, authorization.apply, …)` — not leftover `assertApplyAuthorized`. Leftover `apply: false` throws “dry-run by default.” Connected `vantagemovers` also needs leftover `database_confirmation === "vantagemovers"`, leftover `manifest_hash_confirmation === manifest.manifest_hash`, and leftover `human_confirmation === \`ROLLBACK ${hash} FROM vantagemovers\``. Connected `testvantagemovers` needs only leftover `apply: true`. **Ask** leftover `requireHistoricalMigrationContext()` — this file does **not** call leftover `createHistoricalMigrationRunner().run`. Acquire leftover `acquireHistoricalOperationalLock` (`lock_owner` or `pid:uuid:rollback`; batch size clamped 1–500, default 100). Reverse leftover `manifest.operations`. Journal `rollback_start` with `fencing_token` **outside** a transaction. This beat does **not** **ask** leftover `preflightHistoricalManifest`. This beat does **not** compare leftover `target_cluster_fingerprint` or leftover `target_collection_checksums`. This beat does **not** **ask** leftover `verifyHistoricalManifest`. This beat does **not** require leftover `apply_start` / leftover `apply_complete`. This beat does **not** count leftover `SIDE_EFFECT_COLLECTIONS`. This beat does **not** return `dry_run: true`; leftover authorization throws when `apply` is false, and the result always plants `dry_run: false`.

2. **Skip an already-undone row, or refuse a live document that no longer matches the plan** — inside leftover `session.withTransaction`, **ask** leftover `assertHistoricalOperationalFence`. For each reversed operation, find leftover `historical_import_registry` by leftover `operation_id` **only** (not leftover `manifest_hash`). Missing row, or leftover `state === "rolled_back"`, increments leftover `already_rolled_back` and `continue`s (no live-document read). Else load `{ _id: ObjectId(target_id) }`. Planned image is leftover `document` on insert and leftover `set` on update. Missing live row, missing planned image, or leftover `matchesPlanned(current, applied)` false pushes leftover `operation_id` onto leftover `conflicts` and `continue`s — it does **not** throw. This beat does **not** compare leftover `before` yet. This beat does **not** use leftover `precondition` as a compare-and-swap filter (leftover apply does). This beat does **not** treat leftover `verified` as forbidden — leftover `applied` and leftover `verified` both undo.

3. **Undo each sealed insert or restore each sealed update, then stamp rolled_back** — **Insert:** leftover `hasNonMigrationReference` walks leftover `form_leads` / leftover `call_leads` / leftover `booked_leads` / leftover `cancelled_leads` for leftover `receiver_agent` / leftover `lead_source_company` / leftover `source_granularity_id` / leftover `customer` / leftover `lead_ref` / leftover `agent_allocations.agent` / leftover `booked_lead`. A live pointer whose leftover `target_entity_id` has **no** other leftover `applied` / leftover `verified` registry row is leftover “external.” External + catalog collection (`agents`, `merchants`, `lead_source_companies`, `lead_source_granularities`) → `$set { active: false, deactivation_reason: "historical rollback ${hash}" }` and count leftover `restored`. External + any other collection → leftover `conflicts` and leave the document. No external pointer → leftover `deleteOne` and count leftover `deleted`. **Update:** leftover `buildRollbackUpdate(before ?? {}, precondition)` leftover `mongoDocument`s leftover `before` into leftover `$set`, then leftover `$unset`s every precondition field whose leftover `$exists === false` (and deletes that key from leftover `$set`). leftover `updateOne({ _id })` — not leftover apply’s `{ _id, ...precondition }` filter. Count leftover `restored`. Then leftover `$set` registry leftover `state: "rolled_back"` plus leftover `rolled_back_at` and leftover `$inc state_revision`. This beat does **not** **ask** leftover `deleteFormLead` / leftover `createBookedLead`. This beat does **not** write leftover `sheet_sync` jobs. This beat does **not** scan leftover `booked_leads.merchant`. This beat does **not** deactivate leftover `customers`.

4. **Journal the batch and the finish, then release the fence** — leftover `rollback_batch_committed` with leftover `batch_offset`, leftover `operation_ids`, leftover `fencing_token`, and the batch card **inside** the same transaction. After commit, **ask** leftover `heartbeatHistoricalOperationalLock` (outside the transaction). After the reversed list, journal leftover `rollback_complete` with leftover `deleted` / leftover `restored` / leftover `already_rolled_back` / leftover `conflicts`. `finally` **asks** leftover `releaseHistoricalOperationalLock`. There is **no** leftover `rollback_failed` journal — a mid-walk throw releases the fence and surfaces, with no failure card. Return leftover `RollbackResult` (`manifest_hash`, connected `target_database`, `dry_run: false`, counters, leftover `conflicts`). A second call that still holds leftover authorization and leftover context walks the same reversed list and counts leftover `already_rolled_back` for rows already stamped. Conflicts stay conflicts. This beat does **not** **ask** leftover `verifyHistoricalManifest`. This beat does **not** **ask** leftover `applyHistoricalManifest`.

There is no fifth plan, classify, apply, or prove operation. Leftover `buildRollbackUpdate` / leftover `hasNonMigrationReference` are folds operations 2–3 **ask**. Re-export through the barrel is convenience for a missing `pnpm historical:rollback` script. Leftover `buildRollbackUpdate` is exported only because the folder fixture imports it.

## Organization

Keep one file. This is the screenplay for “undo this applied historical manifest.” Raw insert / compare-and-swap already lives on already-recommended `apply.ts`. Prove-after-write already lives on already-recommended `verify.ts`. Authorization already lives on leftover `targetGuard.ts`. ALS suppress flags already live on leftover `migrationContext.ts`. The fence already lives on leftover `operationalLock.ts`. Artifact hash already lives on leftover `stableJson.ts`. `$oid` / `$date` / planned-field compare already live on leftover `mongoValues.ts`. Do not pull those in. Do not invent a `HistoricalRollbackService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a live Form / Booking **adapter** so “the spec’s application-services sentence becomes true.” Do not invent a filesystem **adapter** so “rollback opens the artifact.” Do not invent a dry-run **adapter** that writes nothing while this export still returns `dry_run: false`. Do not invent a CRUD folder so “delete and restore each get a file.”

Do not merge this into already-recommended `apply.ts` so “one function owns write and undo.” Do not move leftover `assertRollbackAuthorized` here so “rollback owns the target-guard checklist.” Do not start the leftover runner here so “rollback owns the ALS.” Do not **ask** leftover verify first so “undo may run only after leftover `ok: true`.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `rollbackHistoricalManifest` | `undoThisAppliedHistoricalManifest` | the missing rollback script must undo under leftover authorization + leftover context + leftover lock |
| `RollbackResult` | `ThisHistoricalRollbackOutcome` | deleted / restored / already_rolled_back / conflicts; `dry_run` is always `false` |
| `buildRollbackUpdate` | alias only until the helper fixture migrates | leftover `$set` / leftover `$unset` fold; not a second public **interface** |

Keep the old names as one-line aliases until the barrel and a later rollback fixture migrate. Do not make callers learn leftover `hasNonMigrationReference` / leftover `buildRollbackUpdate` as the domain language. Do **not** export leftover `hasNonMigrationReference`. Do **not** rename persisted collection names (`historical_import_registry`, `historical_import_apply_journal`) or journal `kind` strings (`rollback_start`, `rollback_batch_committed`, `rollback_complete`). Do **not** rename persisted registry `state` tokens (`rolled_back`, `applied`, `verified`). Do **not** rename leftover `RollbackResult` field names (`already_rolled_back`, `dry_run`, `conflicts`, `deleted`, `restored`). Do **not** rename leftover `deactivation_reason` text.

**No workflow class.** The two types that *do* earn a name are the undo seat the missing script plants and the outcome it reads:

```ts
type ThisHistoricalRollbackSeat = {
  batch_size?: number
  lock_owner?: string
}

type ThisHistoricalRollbackOutcome = {
  manifest_hash: string
  target_database: string
  dry_run: false
  deleted: number
  restored: number
  already_rolled_back: number
  conflicts: string[]
}
```

That is the handoff from “the owner confirmed the exact hash” to “the rehearsal database can be restored, or a conflict list waits for a human.” Leftover `ApplyAuthorization` stays on leftover `targetGuard.ts` — this file’s argument is a narrower inline card (`apply`, leftover confirmations), not that type. Leftover `HistoricalMigrationContext` stays on leftover `migrationContext.ts`. Leftover `HistoricalOperationalLock` stays on leftover `operationalLock.ts`. Do **not** move those cards here. Do **not** add `migrationContext` or `target` as a function argument so “the July type becomes true” in this rename — the ALS **require** plus the connected `db` are the current **seam**.

Leave write on already-recommended `apply.ts`. Leave prove on already-recommended `verify.ts`. Leave the target-guard checklist on leftover `targetGuard.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// rollback.ts
// Apply already wrote every sealed operation.
// Hash the in-memory manifest.
// Refuse unless leftover rollback authorization, leftover context,
// and leftover lock say we may undo.
// Reverse the sealed list.
// Delete an unreferenced insert, deactivate a referenced catalog insert,
// or restore an update from before.
// Stamp rolled_back. Journal the card.
// Do not recalculate. Do not call live Form or Booking services.
// Do not turn on Sheet Sync. Do not verify.

// ── 1. Refuse unless leftover authorization, leftover context, and leftover lock say we may undo ──

export async function undoThisAppliedHistoricalManifest(manifest, db, authorization, seat)
// ask leftover assertArtifactHash
// ask leftover assertRollbackAuthorized — not leftover assertApplyAuthorized
// ask leftover requireHistoricalMigrationContext — do not start the runner
// ask leftover acquireHistoricalOperationalLock (owner suffix :rollback)
function reverseTheSealedOperations(manifest)
function journalRollbackStart(manifest, db, lock) // outside the transaction

// ── 2. Skip already undone, or refuse a live document that drifted ─

function undoThisSealedBatchUnderTheFence(manifest, db, lock, batch, offset)
// ask leftover assertHistoricalOperationalFence inside the transaction
function skipAMissingOrAlreadyRolledBackRegistryRow(operation, db, session)
function refuseALiveDocumentThatNoLongerMatchesThePlan(operation, db, session)
  // leftover matchesPlanned(current, insert.document | update.set)
  // conflict, do not throw

// ── 3. Undo each insert or restore each update ────────────

function deleteThisUnreferencedInsertOrDeactivateAReferencedCatalog(operation, db, session)
function decideWhetherAnOutsideDocumentStillPointsHere(targetId, operationId, db, session)
  // form / call / booked / cancelled only; merchant on a Booking is not this walk
function restoreThisSealedUpdateFromBefore(operation, db, session)
  // leftover buildRollbackUpdate(before ?? {}, precondition)
  // $set before; $unset $exists:false; filter is {_id} only
function rememberThisUndoInTheRegistry(operation, db, session) // state rolled_back

// ── 4. Journal the batch and the finish, then release ─────

function journalThisCommittedRollbackBatch(manifest, db, lock, offset, outcome, session)
// ask leftover heartbeatHistoricalOperationalLock after commit
function journalRollbackComplete(manifest, db, outcome)
// no journalRollbackFailed — a throw releases the fence and surfaces
// finally ask leftover releaseHistoricalOperationalLock
```

Read the primary path out loud: *Hash the in-memory manifest. Refuse unless leftover rollback authorization, leftover migration context, and leftover lock say this connected database may undo. Reverse the sealed list. Journal the start. For each bounded batch, prove the fence, skip a missing or already-rolled-back registry row, refuse a live document that no longer matches the plan, then delete an unreferenced insert, deactivate a referenced catalog insert, or restore an update from before, and stamp rolled_back. Heartbeat. Journal the finish. A second undo on the same hash counts already_rolled_back. A later live write becomes a conflict, not a throw. Do not walk the sheets again. Do not call live Form Lead or Booking delete. Do not turn on Sheet Sync. Do not verify.*

That is the operation. `buildRollbackUpdate` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **July spec still says the apply path uses application services; this undo is the same raw walk backwards.** Stage G / the planner-module seam still say the write path “uses application services with a migration context.” This file leftover `deleteOne` / leftover `updateOne`. It never **asks** leftover `deleteFormLead`, leftover `createBookedLead`, or leftover Operations Registry deactivation. Do not start calling those so “the sentence becomes true.” That would silently schedule Sheet Sync, CRM Posting, Lead Messaging, and owner events unless every live write path honors leftover ALS flags — a different, tested change. Keep the raw undo. The ALS **require** is a seat fence, not a suppress that this file reads.

2. **July type plants `target` and `migrationContext` as arguments.** Hardening plan: `rollbackHistoricalManifest(manifest, target, migrationContext)`. Current export is `(manifest, db, authorization, options)` and **asks** leftover `requireHistoricalMigrationContext()`. The missing `pnpm historical:rollback` script must wrap leftover `createHistoricalMigrationRunner(scriptPath).run`. Do not add a context or `target` argument so “the July type lives here,” and do not start the runner inside this file so “rollback owns the ALS.” Leave the runner on leftover `migrationContext.ts`.

3. **This file never opens bytes.** It **asks leftover** `assertArtifactHash` on an in-memory object. Already-recommended `parseHistoricalManifest` is the disk **seam** and is still uncalled by leftover rollback. Do not route this export through parse so “one function owns every hash” in this rename. That contradiction is already open from the sealer / apply / verify passes.

4. **`dry_run` is a lie on the result card.** Leftover `RollbackResult.dry_run` is always `false`. Leftover `assertRollbackAuthorized` throws when `authorization.apply` is false (“dry-run by default”). There is no write-nothing path in this file. The runbook still says “dry-run and apply rollback.” Do not add a dry-run walk that still returns this card without an **interface** proof, and do not delete the field so “the name stops lying” until a later script stops reading it.

5. **Leftover rollback authorization is not leftover apply authorization.** Leftover `assertRollbackAuthorized` does not check leftover `git_sha`, leftover `backup_id`, leftover rehearsal evidence, leftover unresolved blocking conflicts, or leftover `authorization.target === db.databaseName`. The argument type is a narrower inline card, not leftover `ApplyAuthorization`. Do not **ask** leftover `assertApplyAuthorized` here so “one checklist owns every mutate,” and do not move leftover `assertRollbackAuthorized` into this file so “rollback owns the phrase.”

6. **Missing registry counts as already undone.** Leftover apply treats a missing registry row as “write now.” This file treats a missing row as leftover `already_rolled_back` and never reads the live document. An orphan insert whose registry row was deleted by hand is left in place. Do not start deleting a live `_id` with no registry row so “orphan inserts get cleaned,” without an **interface** proof. Do not treat leftover `verified` as a refuse — both leftover `applied` and leftover `verified` undo.

7. **Spec says deactivate catalog when any reference exists; this file deactivates only an outside reference.** Leftover `hasNonMigrationReference` returns false when the pointing document itself has another leftover `applied` / leftover `verified` registry row. A Form Lead this manifest inserted, still leftover `applied` because its own undo conflicted, lets the earlier catalog insert leftover `deleteOne` the Agent. Hardening plan: “when any reference exists.” Do not switch the walk to “any live pointer” so “the sentence becomes true” in this rename — reverse-order undo currently relies on owned pointers being deleted first. Name the gap.

8. **Merchant on a Booking is not in the pointer walk.** Leftover `booked_leads` filters leftover `customer` / leftover `lead_ref` / leftover `agent_allocations.agent`. It does **not** read leftover `merchant`. Leftover `merchants` is in the catalog deactivate list, so a Merchant insert with only a Booking leftover `merchant` pointer leftover `deleteOne`s. Leftover `customers` is **not** in the catalog list — an external Customer pointer conflicts. Do not add leftover `merchant` to the filter so “the catalog list becomes true,” and do not add leftover `customers` to the deactivate list, without an **interface** proof.

9. **Reverse is list reverse, not a dependency graph.** This file leftover `[...operations].reverse()`. It trusts leftover planner order. A conflict on a later Booking insert can leave the Booking live while an earlier Lead insert still leftover `deleteOne`s (owned pointer). Do not sort by leftover `model` so “Bookings always undo first” in this rename.

10. **Update restore does not compare-and-swap leftover `precondition`.** Leftover apply’s update filter is `{ _id, ...precondition }`. This file already leftover `matchesPlanned` the applied image, then leftover `updateOne({ _id })`. Leftover `before` is optional here (`?? {}`) and required-unused on leftover apply. Leftover `$exists: false` fields are unset even when leftover `before` planted a null. Do not copy leftover apply’s precondition filter onto this restore so “one CAS owns both files,” and do not start requiring leftover `before` so “the apply throw lives here.”

11. **Catalog deactivate counts as leftover `restored`.** Soft-deactivating an insert is not restoring leftover `before`. Do not split a third counter so “deactivate has its own field,” and do not rename leftover `restored` on leftover `RollbackResult` in this rename.

12. **Conflicts accumulate; leftover apply throws.** A drifted live document or an unsafe non-catalog pointer pushes leftover `operation_id` and continues. The function still journals leftover `rollback_complete` and returns leftover `conflicts`. Do not start throwing on the first conflict so “rollback matches apply,” and do not **ask** leftover verify after the walk so “undo proves the restore.”

13. **There is no leftover `rollback_failed` card.** Leftover apply journals leftover `apply_failed` then rethrows. This file’s `try` has no `catch`. A lost fence mid-batch releases the lock and surfaces with only leftover `rollback_start` / whatever leftover `rollback_batch_committed` already committed. Do not add leftover `rollback_failed` so “the journal matches apply,” without an **interface** proof.

14. **Heartbeat sits after commit.** A batch can persist and then leftover `heartbeatHistoricalOperationalLock` can throw. The next retry must resume from leftover `rolled_back` rows, not rewind the batch. Do not move heartbeat inside the transaction so “one commit owns the clock,” and do not silently swallow a fenced heartbeat. Journal leftover `rollback_start` / leftover `rollback_complete` stay outside the batch transaction; leftover `rollback_batch_committed` stays inside. Do not reorder that **seam**.

15. **The folder fixture proves the helper, not this interface.** `rollback.test.ts` leftover `buildRollbackUpdate` only. `manifest.test.ts` leftover `assertRollbackAuthorized` is leftover `targetGuard.ts`. Do not keep those as this **interface**. Do not move leftover `buildRollbackUpdate` into leftover `mongoValues.ts` so “one materializer owns restore.”

16. **The staged-merge CLI is missing here.** `package.json` still names `pnpm historical:rollback`; the folder it points at is not in this checkout. Do not invent the script in this rename, and do not treat leftover `ingest-historical-sheets.ts` as the caller.

17. **Leave sibling modules and live writes alone.** Leftover `assertRollbackAuthorized`, leftover `requireHistoricalMigrationContext`, leftover `acquireHistoricalOperationalLock` / leftover fence / leftover heartbeat / leftover release, leftover `assertArtifactHash`, leftover `mongoDocument` / leftover `matchesPlanned`, leftover `applyHistoricalManifest`, leftover `verifyHistoricalManifest`, and already-recommended `sealThisHistoricalManifest` are not this file. Do not inline them so “the undo is one sitting.”

## Testing

The **interface** is the test surface: `undoThisAppliedHistoricalManifest` (today `rollbackHistoricalManifest`). Leftover `RollbackResult` may stay exported as an alias. Leftover `buildRollbackUpdate` may stay exported as an alias until the helper fixture migrates; it is not a second public **interface**.

`rollback.test.ts` today proves leftover `buildRollbackUpdate` only. Do not treat that helper test, or leftover `manifest.test.ts` leftover-authorization proofs, as this **interface**.

Add only what this **interface** still hides. Tests must wrap leftover `createHistoricalMigrationRunner` with a path under `/scripts/historical_[REDACTED]_db_staged_merge_ingestion/` and plant leftover rollback authorization. Use a disposable database. Do **not** point at live `vantagemovers`.

**Refuse unless leftover authorization, leftover context, and leftover lock say we may undo**
- Missing leftover migration context → throw “without migration context”; no journal row.
- Leftover `authorization.apply` false → leftover target-guard dry-run throw; no lock, no journal.
- Connected `vantagemovers` missing leftover hash confirmation or leftover `ROLLBACK ${hash} FROM vantagemovers` → throw; no lock.
- Connected `testvantagemovers` + leftover `apply: true` → lock acquired, leftover `rollback_start` with leftover `fencing_token`.
- Another live leftover lock owner → throw “Another historical migration holds the target lock.”
- Bad leftover `manifest_hash` → leftover `assertArtifactHash` throws; no journal row.
- Do **not** require leftover `preflightHistoricalManifest`, leftover `verifyHistoricalManifest`, leftover `apply_start`, or leftover `SIDE_EFFECT_COLLECTIONS`.

**Skip already undone, or refuse a drifted live document**
- Missing registry row → leftover `already_rolled_back` += 1; live document is not read.
- Registry leftover `rolled_back` → leftover `already_rolled_back`; document is not written again.
- Registry leftover `applied` or leftover `verified` + leftover `matchesPlanned` false → leftover `conflicts` includes leftover `operation_id`; document and registry stay.
- Registry leftover `applied` + missing live `_id` → leftover `conflicts`; no delete.

**Undo each insert or restore each update**
- Insert, no live pointer → leftover `deleted: 1`, document gone, registry leftover `rolled_back`, journal leftover `rollback_batch_committed` then leftover `rollback_complete`.
- Insert on leftover `agents` / leftover `merchants` / leftover `lead_source_companies` / leftover `lead_source_granularities` with an external Form / Call / Booking / Cancellation pointer (no other leftover `applied` / leftover `verified` registry row for that pointer) → leftover `active: false`, leftover `restored: 1`, document remains, registry leftover `rolled_back`.
- Insert on leftover `form_leads` with an external Booking leftover `lead_ref` → leftover `conflicts`; Form Lead remains leftover `applied`.
- Insert on leftover `merchants` whose only pointer is leftover `booked_leads.merchant` → today’s walk leftover `deleteOne`s (prove the gap; do **not** “fix” the filter in the test).
- Update whose live document leftover `matchesPlanned` leftover `set` → leftover `$set` equals leftover `mongoDocument(before)` minus leftover `$exists: false` keys, those keys leftover `$unset`, leftover `restored: 1`.
- Update with leftover `before` omitted → leftover `$set` is `{}` plus whatever leftover `$unset` the precondition planted; do **not** throw.
- Registry leftover `verified` + matching live insert → undo proceeds (do **not** require leftover prove to refuse).
- Second undo of the same sealed list → leftover `already_rolled_back` equals the operation count; leftover `deleted` and leftover `restored` stay 0.
- Lost fence inside the transaction → throw; that batch does not journal leftover `rollback_batch_committed`.

**Journal finish and release**
- Success → leftover `rollback_complete` plus leftover lock row gone; leftover `dry_run` is `false`.
- Mid-walk throw → leftover lock row gone, **no** leftover `rollback_failed` card, then the error surfaces.
- Leftover `conflicts.length > 0` still journals leftover `rollback_complete` and **returns** (does not throw).
- Do **not** require leftover verify after the walk.
- Do **not** require leftover apply’s leftover `apply_failed` shape.

Do **not** add a test per helper (`decideWhetherAnOutsideDocumentStillPointsHere`, `restoreThisSealedUpdateFromBefore`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

`RollbackResult` / leftover `buildRollbackUpdate` may stay exported as aliases. They are not a second test surface.

## What I would not do

- A `HistoricalRollbackService` class with `rollback` / `delete` / `restore` / `create` / `update`.
- Thirty two-line functions that only wrap leftover `assertArtifactHash` or leftover `collection.deleteOne`.
- Moving this into a CRUD folder, or a `rollback/` folder that also swallows leftover `apply.ts`, leftover `verify.ts`, leftover `targetGuard.ts`, leftover `operationalLock.ts`, and leftover `migrationContext.ts`.
- Treating leftover `planHistoricalConsolidation`, leftover `buildHistoricalManifest`, leftover `parseHistoricalManifest`, leftover `applyHistoricalManifest`, leftover `verifyHistoricalManifest`, leftover `assertApplyAuthorized`, leftover `assertRollbackAuthorized`, leftover `deleteFormLead`, or leftover `ingest-historical-sheets.ts` as this story.
- Inventing a Domain Command **seam** that has only this raw Mongo walk as an **adapter**.
- Inventing a live Form / Booking **adapter** so “the spec’s application-services sentence becomes true.”
- Routing this export through `parseHistoricalManifest` so “one function owns every hash” in this rename.
- Starting leftover `createHistoricalMigrationRunner` inside this file so “rollback owns the ALS.”
- Asking leftover `verifyHistoricalManifest` first so “undo may run only after leftover `ok: true`.”
- Asking leftover `assertApplyAuthorized` so “one checklist owns every mutate.”
- Switching leftover `hasNonMigrationReference` to “any live pointer,” adding leftover `booked_leads.merchant`, or adding leftover `customers` to the deactivate list, so “the hardening sentences become true.”
- Sorting the reversed list by leftover `model` so “Bookings always undo first.”
- Copying leftover apply’s precondition filter onto the restore, or requiring leftover `before`, so “one CAS owns both files.”
- Adding leftover `rollback_failed`, or throwing on the first leftover conflict, so “the journal matches apply.”
- Reordering journal-outside-transaction vs leftover `rollback_batch_committed`-inside vs heartbeat-after-commit.
- Opening leftover `migrationContext.ts` in this pass, or writing a whole-folder recommendation for `historicalConsolidation`.
