# Plant This Historical Migration Seat — Refuse A Path Outside The Missing Staged-Merge Script Folder, Run The Callback With The Hash And Apply Clock And Every Outbound Flag Forced Off, Then Require That Seat Before Leftover Apply Or Leftover Rollback May Mutate — Never Authorize The Target, Never Take The Fence, Never Write Mongo, Never Turn Those Flags Into Live Service Reads — operational story

- Status: recommended
- Service: `historicalConsolidation` (Wave A, in-progress)
- Pass: 7 of this service — `migrationContext.ts`
- Remaining in this service: `targetGuard.ts`, `operationalLock.ts`, `schemaValidation.ts`, `normalization.ts`, `dateParsing.ts`, `stableJson.ts`, `mongoValues.ts`
- Target: `src/services/historicalConsolidation/migrationContext.ts`
- Knowledge: none for this folder. The staged-merge spec is [`historical-consolidation-rules-and-staging-spec.md`](../../../docs/index.md) (Planner module seam: the applier accepts an approved manifest plus an explicitly selected target and migration context; the context disables outbound integrations; apply “uses application services with a migration context that disables Sheet Sync, CRM Posting, Lead Messages, and other outbound effects”). Hardening plan: [`historical-consolidation-final-hardening-and-pre-run-implementation-plan.md`](../../../docs/index.md) (`SHEET_SYNC_MODE=disabled` alone is not an adequate migration context; implement an explicit context that forces bounded Mongo transactions, suppresses Sheet Sync / CRM / lead-message / notification / ordinary observability / geocoding, uses a fixed apply timestamp, and cannot be enabled by a normal HTTP request; Phase 1: “Create a side-effect-free migration context”). Already-recommended siblings: [historical-consolidation-classification.md](historical-consolidation-classification.md), [historical-consolidation-planner.md](historical-consolidation-planner.md) (never writes Mongo; never **asks** this file), [historical-consolidation-manifest.md](historical-consolidation-manifest.md) (seals hashes; leftover `manifest.test.ts` **asks** this file — that beat is this **interface**, not the sealer), [historical-consolidation-apply.md](historical-consolidation-apply.md) (raw insert / compare-and-swap; **asks leftover** `requireHistoricalMigrationContext()` and discards the card; never starts this runner), [historical-consolidation-verify.md](historical-consolidation-verify.md) (stamps leftover `verified` **without** this seat), [historical-consolidation-rollback.md](historical-consolidation-rollback.md) (raw undo; **asks leftover** `requireHistoricalMigrationContext()` and discards the card; never starts this runner). Distinct from leftover `targetGuard.ts` (who may write this connected database — this file never **asks** leftover `assertApplyAuthorized` / leftover `assertRollbackAuthorized`). Distinct from leftover `operationalLock.ts` (the Mongo fence — this file never **asks** leftover `acquireHistoricalOperationalLock`). Distinct from leftover `SHEET_SYNC_MODE` on already-recommended [sheet-sync-coordinator.md](sheet-sync-coordinator.md) (tri-state env; this file does not read it). Distinct from already-recommended live [form-lead.md](form-lead.md) / [leads-call-lead.md](leads-call-lead.md) / [bookings-booked-lead.md](bookings-booked-lead.md) / [cancellations-cancelled-lead.md](cancellations-cancelled-lead.md) / [lead-messaging-lead-messaging.md](lead-messaging-lead-messaging.md) / [crm-crm-service.md](crm-crm-service.md) / [observability-record-operational-event.md](observability-record-operational-event.md) / [leads-lead-location.md](leads-lead-location.md) — none of those **ask** this store. Distinct from leftover `ingest-historical-sheets.ts` (the write-capable row-by-row upsert the spec forbids becoming the planner, the applier, *or* this seat). `package.json` still names `pnpm historical:apply` / `pnpm historical:rollback`; the staged-merge script folder is **absent** from this checkout. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — do not invent “Historical Migration Context” copies. `docs/adr/` is absent here — do not invent ADR copies. Do not add a Historical Consolidation Service in this rename.
- Callers: **the barrel, leftover apply, leftover rollback, plus one fixture.** Barrel `historicalConsolidation/index.ts` re-exports leftover `createHistoricalMigrationRunner` only — not leftover `requireHistoricalMigrationContext`, not leftover `HistoricalMigrationContext`. Leftover `apply.ts` and leftover `rollback.ts` import leftover `requireHistoricalMigrationContext` from this file and **discard the return**. Folder `manifest.test.ts` leftover “cannot be enabled outside the canonical local adapter” **asks** leftover `createHistoricalMigrationRunner` + leftover `requireHistoricalMigrationContext` — that beat **is** this **interface**. Already-recommended planner / sealer / classifier / leftover verify do **not** import this file. Scripts in this checkout do **not** import this file. Not this **interface**: leftover `assertApplyAuthorized`, leftover `assertRollbackAuthorized`, leftover `acquireHistoricalOperationalLock`, leftover `applyHistoricalManifest`, leftover `rollbackHistoricalManifest`, leftover `verifyHistoricalManifest`, leftover `getSheetSyncMode`, leftover `createFormLead` / leftover `createBookedLead`, leftover `ingest-historical-sheets.ts`.
- Seams callers need: leftover path-fenced runner **create** vs leftover ALS **run** (the missing script must wrap leftover apply / leftover rollback — those files do not start the ALS); leftover **require** vs leftover apply / leftover rollback mutate (presence only — they do not read leftover `manifest_hash`, leftover `apply_timestamp`, or any leftover `suppress_*`); this planted card vs live Form / Booking / Sheet Sync / CRM / messaging / observability / geocoding (none **ask** the store); this string-path fence vs leftover target-guard authorization vs leftover Mongo lock. There is no begin / complete Domain Command **seam**. There is no live Form / Booking **adapter**. There is no Sheet Sync **adapter**. There is no HTTP **adapter**. There is no transaction **adapter**. There is no env **adapter**.
- Split later (only if the file outgrows one sitting): this ~48-line file is one sitting if you read it as plant this historical migration seat. If it later splits by **story**: do not. One runner plus one require. Never `create.ts` / `update.ts` / `delete.ts`. Leftover apply, leftover rollback, leftover verify, leftover target guard, leftover lock, and live Form / Booking / Sheet Sync stay siblings / other services.

`createHistoricalMigrationRunner` / `requireHistoricalMigrationContext` are executor mechanics. The owner question is: *The missing apply or rollback script wants to write. Refuse unless the path it handed us sits under the canonical staged-merge script folder. Then, for this callback only, remember the manifest hash, the apply clock, and that Sheet Sync, CRM Posting, Lead Messages, notifications, ordinary observability, and enrichment are all off. When leftover apply or leftover rollback later asks, throw if that seat is missing. This file does not authorize the connected database. This file does not take the lock. This file does not write Mongo. This file does not start a transaction. This file does not turn those suppress flags into real service reads — leftover apply and leftover rollback never read the returned card, and live Form / Booking / Sheet Sync / CRM / messaging / observability / geocoding never ask this store.*

Who authorizes the target, who owns the fence, who inserts or undoes sealed rows, and who proves the live copy after the write already live in leftover **modules**. Do not pull those in.

## What this file actually does

Two “plant this historical migration seat” stories in one sitting, not “an ALS helper,” and not Apply This Approved Manifest / Undo This Applied Manifest / Prove This Applied Manifest / Authorize This Connected Database:

1. **Refuse a runner unless the entrypoint is under the missing staged-merge script folder, then plant the seat for this callback** — `createHistoricalMigrationRunner(scriptEntrypoint)`. Fold leftover `\` to `/`. If the string does **not** include leftover `/scripts/historical_[REDACTED]_db_staged_merge_ingestion/`, throw “Historical migration context is restricted to the canonical local command adapters.” Close over leftover `capability` (a module `Symbol`) and return leftover `{ run }`. leftover `run(manifestHash, applyTimestamp, callback)` leftover `storage.run`s a card whose leftover `manifest_hash` and leftover `apply_timestamp` are the arguments and whose six leftover `suppress_*` fields are the literal `true` (sheet sync, CRM, messages, notifications, observability, enrichment). The leftover `if (token !== capability)` check cannot fail: leftover `token` is that same closed-over symbol. This beat does **not** read leftover `import.meta.url` or leftover `process.argv[1]`. This beat does **not** **ask** leftover `assertApplyAuthorized`. This beat does **not** start leftover `applyHistoricalManifest`. This beat does **not** start a Mongo session. This beat does **not** compare leftover `manifestHash` to a sealed leftover `manifest.manifest_hash`.

2. **Refuse an exact historical write or undo when the seat is missing** — `requireHistoricalMigrationContext()`. leftover `storage.getStore()`. Missing store throws “Exact historical operation attempted without migration context.” Present store returns the card. Leftover `applyHistoricalManifest` and leftover `rollbackHistoricalManifest` **ask** this and **discard the return**. Leftover `verifyHistoricalManifest` does **not** **ask** this. This beat does **not** compare leftover `manifest_hash` to the sealed artifact. This beat does **not** read leftover `apply_timestamp`. This beat does **not** **ask** leftover `getSheetSyncMode`. This beat does **not** walk live Form / Booking / Sheet Sync / CRM / messaging / observability / geocoding.

There is no third authorize, lock, apply, or prove operation. Re-export leftover `createHistoricalMigrationRunner` through the barrel is convenience for a missing `pnpm historical:apply` / `pnpm historical:rollback` script. leftover `requireHistoricalMigrationContext` stays off the barrel on purpose — leftover apply / leftover rollback import this file.

## Organization

Keep one file. This is the screenplay for “plant this historical migration seat.” Authorization already lives on leftover `targetGuard.ts`. The Mongo fence already lives on leftover `operationalLock.ts`. Raw write already lives on already-recommended `apply.ts`. Raw undo already lives on already-recommended `rollback.ts`. Prove-after-write already lives on already-recommended `verify.ts`. Tri-state Sheet Sync already lives on already-recommended `sheetSync`. Do not pull those in. Do not invent a `HistoricalMigrationContextService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a live Form / Booking **adapter** so “the spec’s application-services sentence becomes true.” Do not invent a Sheet Sync **adapter** so “the suppress flags become true.” Do not invent an HTTP **adapter** so “a route can plant the seat.” Do not invent a transaction **adapter** so “the hardening ‘forces bounded Mongo transactions’ sentence lives here.” Do not invent a CRUD folder so “create and require each get a file.”

Do not move leftover `requireHistoricalMigrationContext` into leftover `apply.ts` so “apply owns the ALS.” Do not start leftover `createHistoricalMigrationRunner` inside leftover apply / leftover rollback so “the July type lives there.” Do not move leftover `assertApplyAuthorized` here so “one seat owns the target-guard checklist.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `createHistoricalMigrationRunner` | `openThisHistoricalMigrationSeat` | the missing apply / rollback script must prove its path before it can plant flags |
| `HistoricalMigrationRunner.run` | `plantThisHistoricalMigrationSeatAndRun` | wrap leftover apply / leftover rollback so the ALS is present for that callback |
| `requireHistoricalMigrationContext` | `requireThisHistoricalMigrationSeat` | leftover apply / leftover rollback must refuse without the seat |
| `HistoricalMigrationContext` | `ThisHistoricalMigrationSeat` | the planted card (hash, clock, six leftover `suppress_*: true`) |
| `HistoricalMigrationRunner` | `ThisHistoricalMigrationRunner` | the wrap the missing script holds |

Keep the old names as one-line aliases until the barrel, leftover `apply.ts`, leftover `rollback.ts`, and the leftover `manifest.test.ts` fixture migrate. Do not make callers learn leftover `storage.run` / leftover `capability` as the domain language. Do **not** export leftover `storage` or leftover `capability`. Do **not** rename leftover `HistoricalMigrationContext` field names (`manifest_hash`, `apply_timestamp`, `suppress_sheet_sync`, `suppress_crm`, `suppress_messages`, `suppress_notifications`, `suppress_observability`, `suppress_enrichment`) — leftover apply / leftover rollback do not read them today, but a later live-service **ask** would. Do **not** rename the leftover throw strings (`restricted to the canonical local command adapters`, `Exact historical operation attempted without migration context`). Do **not** put leftover `requireHistoricalMigrationContext` on the barrel so “one export owns plant and require” — leftover apply / leftover rollback already import this file.

**No workflow class.** The one type that *does* earn a name is the planted seat:

```ts
type ThisHistoricalMigrationSeat = {
  manifest_hash: string
  apply_timestamp: Date
  suppress_sheet_sync: true
  suppress_crm: true
  suppress_messages: true
  suppress_notifications: true
  suppress_observability: true
  suppress_enrichment: true
}
```

That is today’s leftover `HistoricalMigrationContext` — the handoff from “the missing script proved its path” to “leftover apply / leftover rollback may see that a seat exists.” Leftover `ApplyAuthorization` stays on leftover `targetGuard.ts`. Leftover `HistoricalOperationalLock` stays on leftover `operationalLock.ts`. Do **not** move those cards here. Do **not** add leftover `target` or leftover `db` here so “the July apply type lives here.” Do **not** add leftover `SHEET_SYNC_MODE` here so “one env owns silence.”

Leave leftover `assertApplyAuthorized` on leftover `targetGuard.ts`. Leave leftover `acquireHistoricalOperationalLock` on leftover `operationalLock.ts`. Leave leftover `applyHistoricalManifest` on already-recommended `apply.ts`. Leave leftover `rollbackHistoricalManifest` on already-recommended `rollback.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// migrationContext.ts
// The missing apply or rollback script wants to write.
// Refuse unless the path it handed us sits under the
// canonical staged-merge script folder.
// For this callback only, remember the hash, the apply clock,
// and that every outbound flag is off.
// When leftover apply or leftover rollback later asks,
// throw if that seat is missing.
// Do not authorize the database. Do not take the lock.
// Do not write Mongo. Do not turn those flags into live service reads.

// ── 1. Refuse a runner unless the path is the missing script folder, then plant the seat ──

export function openThisHistoricalMigrationSeat(scriptEntrypoint: string): ThisHistoricalMigrationRunner
function refuseAPathOutsideTheMissingStagedMergeScriptFolder(scriptEntrypoint)
  // leftover \ → / ; must include /scripts/historical_[REDACTED]_db_staged_merge_ingestion/
async function plantThisHistoricalMigrationSeatAndRun(manifestHash, applyTimestamp, callback)
  // leftover storage.run({ hash, clock, six suppress: true }, callback)
  // leftover token !== capability cannot fail — same closed-over Symbol

// ── 2. Refuse an exact historical write or undo when the seat is missing ─

export function requireThisHistoricalMigrationSeat(): ThisHistoricalMigrationSeat
  // missing store → "Exact historical operation attempted without migration context"
  // leftover apply / leftover rollback ask this and discard the card
```

Read the primary path out loud: *Refuse unless the path sits under the missing staged-merge script folder. Plant the hash, the apply clock, and every leftover suppress flag as true. Run the callback. Leftover apply and leftover rollback must see that seat or throw. They do not read the hash, the clock, or the flags. Live Form Lead, Booking, Sheet Sync, CRM Posting, Lead Messaging, observability, and geocoding never ask this store. Do not authorize the connected database. Do not take the lock. Do not write Mongo.*

That is the operation. `AsyncLocalStorage.run` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **July spec still says apply uses application services with a context that disables outbound; this file plants flags nobody reads.** Stage G / the planner-module seam still say the write path “uses application services with a migration context that disables Sheet Sync, CRM Posting, Lead Messages, and other outbound effects.” Hardening plan lists six suppressions plus bounded transactions plus a fixed apply timestamp. Leftover apply leftover `insertOne` / leftover `updateOne`. Leftover rollback leftover `deleteOne` / leftover `$set`. Neither reads leftover `requireHistoricalMigrationContext()`’s return. Already-recommended live Form / Booking / Sheet Sync / CRM / messaging / observability / geocoding never leftover `storage.getStore()`. Do not start calling leftover `createFormLead` from leftover apply so “the sentence becomes true,” and do not add leftover `getStore()` **asks** to those live services in this rename. That would be a different, tested change. Keep the planted card. Name that leftover apply’s leftover **require** is a seat fence, not a suppress those writes honor.

2. **July type plants `migrationContext` as an argument on leftover apply / leftover rollback.** Hardening plan: `applyHistoricalManifest(manifest, target, migrationContext)` and `rollbackHistoricalManifest(manifest, target, migrationContext)`. Current leftover apply / leftover rollback take leftover `db` + leftover authorization + leftover options and **ask** leftover `requireHistoricalMigrationContext()`. The missing script must wrap leftover `createHistoricalMigrationRunner(scriptPath).run`. Do not add a context argument on leftover apply / leftover rollback so “the July type lives there,” and do not start the runner inside those files so “apply owns the ALS.” Leave the runner here.

3. **The planted leftover `manifest_hash` is never compared to the sealed artifact.** leftover `run("hash-A", clock, () => applyHistoricalManifest(manifestB, …))` succeeds at this **interface**. leftover apply leftover `assertArtifactHash`s leftover `manifestB` and never leftover **asks** this card’s leftover `manifest_hash`. Do not start comparing the two so “one hash owns the seat” in this rename — leftover apply / leftover rollback would have to read the return they currently discard.

4. **leftover `apply_timestamp` is planted and unused.** Hardening plan: “Uses a fixed apply timestamp where the manifest requires deterministic provenance.” This file stores the `Date`. Leftover apply leftover `new Date()`s leftover `applied_at` / leftover journal `created_at`. Leftover planner leftover `planning_timestamp` is a different clock. Do not thread leftover `apply_timestamp` into leftover apply so “the sentence becomes true” in this rename.

5. **Hardening plan says the context forces bounded Mongo transactions.** This file does not open a leftover `ClientSession`. Leftover apply / leftover rollback leftover `withTransaction` themselves. Do not start a session here so “one seat owns the transaction,” and do not move leftover `withTransaction` here so “the ALS owns the batch.”

6. **The path fence is a substring, not the process entrypoint.** leftover `includes("/scripts/historical_[REDACTED]_db_staged_merge_ingestion/")` after leftover `\` → `/`. A relative leftover `scripts/historical_[REDACTED]_db_staged_merge_ingestion/apply.ts` (no leading slash) throws. A leftover `C:/repo/scripts/historical_[REDACTED]_db_staged_merge_ingestion/apply.ts` passes — that is the leftover fixture. Any HTTP handler that passes that string would pass too. This file does **not** read leftover `process.argv[1]`. Hardening “cannot be enabled by a normal HTTP request” is true today only because no route imports the runner. Do not start reading leftover `import.meta.url` so “the sentence becomes true,” and do not accept a relative leftover `scripts/…` path so “the fixture’s Windows string stops being special.”

7. **leftover `token !== capability` cannot fail.** leftover `const token = capability` is closed over in leftover `createHistoricalMigrationRunner`. The check is dead. Do not invent a second factory so “the Symbol earns a seam,” and do not delete the check so “dead code disappears” until a later **interface** proof says the runner can be forged.

8. **Six leftover `suppress_*` fields are `true` literals on the type, not booleans.** A caller cannot plant leftover `suppress_sheet_sync: false`. That is the story. Do not widen them to `boolean` so “a test can turn CRM back on.” Do not add a seventh leftover `suppress_sheet_sync_mode` so “one field owns leftover `SHEET_SYNC_MODE`.”

9. **leftover verify never **asks** this file.** Already-recommended leftover `verifyHistoricalManifest` stamps leftover `verified` without leftover authorization, leftover context, or leftover lock. Do not add leftover `requireHistoricalMigrationContext` there so “verify matches apply’s seat” — that contradiction is already open from the verify pass.

10. **leftover `manifest.test.ts` is this interface, parked on the sealer.** The leftover “cannot be enabled outside the canonical local adapter” test **asks** this file. Already-recommended leftover `manifest.md` already said that beat is not the sealer **interface**. Do not keep proving leftover `assertApplyAuthorized` as this **interface**. Do not add leftover `applyHistoricalManifest` into that fixture so “one test owns plant and write.”

11. **The staged-merge CLI is missing here.** `package.json` still names `pnpm historical:apply` / `pnpm historical:rollback`; the folder they point at is not in this checkout. The barrel export has no runtime script caller. Do not invent the script in this rename, and do not treat leftover `ingest-historical-sheets.ts` as the caller.

12. **Leave sibling modules and live writes alone.** Leftover `assertApplyAuthorized` / leftover `assertRollbackAuthorized`, leftover `acquireHistoricalOperationalLock` / leftover fence / leftover heartbeat / leftover release, leftover `applyHistoricalManifest`, leftover `rollbackHistoricalManifest`, leftover `verifyHistoricalManifest`, leftover `getSheetSyncMode`, and already-recommended live Form / Booking writes are not this file. Do not inline them so “the seat is one sitting.”

## Testing

The **interface** is the test surface: `openThisHistoricalMigrationSeat` (today `createHistoricalMigrationRunner`) and `requireThisHistoricalMigrationSeat` (today `requireHistoricalMigrationContext`). leftover `HistoricalMigrationContext` / leftover `HistoricalMigrationRunner` may stay exported as aliases.

`manifest.test.ts` today leftover-proves a bad leftover `src/routes/v1.routes.ts` path, then a leftover Windows canonical path, then leftover `require` inside leftover `run` equals six leftover `true`s. Keep that as this **interface**. Do not treat leftover `assertApplyAuthorized` / leftover `assertRollbackAuthorized` in the same file as this **interface**. There is no `migrationContext.test.ts`.

Add only what this **interface** still hides. Do **not** point leftover apply / leftover rollback at live `vantagemovers` from this fixture.

**Refuse a runner unless the path is the missing script folder, then plant the seat**
- leftover `src/routes/v1.routes.ts` → throw `/restricted/`; leftover `require` outside leftover `run` still throws.
- leftover `scripts/historical_[REDACTED]_db_staged_merge_ingestion/apply.ts` (no leading `/`) → today’s walk throws (prove the gap; do **not** “fix” the slash in the test).
- leftover `C:/repo/scripts/historical_[REDACTED]_db_staged_merge_ingestion/apply.ts` → leftover `run` plants leftover `manifest_hash`, leftover `apply_timestamp`, and six leftover `suppress_*: true`.
- leftover `run` leftover `apply_timestamp` equals the `Date` argument (prove the plant; do **not** require leftover apply to read it).
- After leftover `run` resolves, leftover `require` throws “without migration context.”
- A leftover `run` whose leftover `manifestHash` is `"hash-A"` does **not** refuse leftover apply of a different sealed hash — that compare is not this file. Do **not** add leftover `applyHistoricalManifest` here so “one test owns the mismatch.”

**Refuse an exact historical write or undo when the seat is missing**
- leftover `require` with no leftover `run` → throw “Exact historical operation attempted without migration context.”
- leftover `require` inside leftover `run` returns the same card leftover `run` planted.
- Do **not** require leftover `verifyHistoricalManifest` to **ask** this file.
- Do **not** require leftover `assertApplyAuthorized` or leftover `acquireHistoricalOperationalLock` as this **interface**.

Do **not** add a test per helper (`refuseAPathOutsideTheMissingStagedMergeScriptFolder`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

leftover `HistoricalMigrationContext` / leftover `HistoricalMigrationRunner` may stay exported as aliases. They are not a second test surface.

## What I would not do

- A `HistoricalMigrationContextService` class with `create` / `run` / `require` / `update` / `delete`.
- Thirty two-line functions that only wrap leftover `storage.run` or leftover `storage.getStore`.
- Moving this into a CRUD folder, or a `context/` folder that also swallows leftover `apply.ts`, leftover `rollback.ts`, leftover `targetGuard.ts`, and leftover `operationalLock.ts`.
- Treating leftover `applyHistoricalManifest`, leftover `rollbackHistoricalManifest`, leftover `verifyHistoricalManifest`, leftover `assertApplyAuthorized`, leftover `acquireHistoricalOperationalLock`, leftover `createFormLead`, leftover `getSheetSyncMode`, or leftover `ingest-historical-sheets.ts` as this story.
- Inventing a Domain Command **seam** that has only this ALS wrap as an **adapter**.
- Inventing a live Form / Booking / Sheet Sync **adapter** so “the spec’s suppress sentences become true.”
- Starting leftover `createHistoricalMigrationRunner` inside leftover apply / leftover rollback so “those files own the ALS.”
- Adding leftover `requireHistoricalMigrationContext` to leftover verify so “verify matches apply’s seat.”
- Comparing leftover `run`’s leftover `manifest_hash` to leftover `manifest.manifest_hash`, or threading leftover `apply_timestamp` into leftover apply, so “the planted card is honored.”
- Opening a leftover `ClientSession` here so “the hardening transaction sentence lives here.”
- Reading leftover `import.meta.url` / leftover `process.argv[1]`, or accepting a relative leftover `scripts/…` path, so “the HTTP sentence / the slash gap become true.”
- Widening leftover `suppress_*: true` to `boolean` so “a test can turn CRM back on.”
- Opening leftover `targetGuard.ts` in this pass, or writing a whole-folder recommendation for `historicalConsolidation`.
