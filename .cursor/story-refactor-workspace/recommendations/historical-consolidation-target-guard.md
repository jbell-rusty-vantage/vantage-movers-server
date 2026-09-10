# Authorize This Connected Historical Target — Refuse Leftover Apply Unless `--apply` And The Connected Name Match The Selected Rehearsal Or Live Checklist, Refuse Leftover Rollback Unless `--apply` And The Narrower Live Phrase, Then Return — Never Plant The Seat, Never Take The Fence, Never Write Mongo, Never Parse Argv — operational story

- Status: recommended
- Service: `historicalConsolidation` (Wave A, in-progress)
- Pass: 8 of this service — `targetGuard.ts`
- Remaining in this service: `operationalLock.ts`, `schemaValidation.ts`, `normalization.ts`, `dateParsing.ts`, `stableJson.ts`, `mongoValues.ts`
- Target: `src/services/historicalConsolidation/targetGuard.ts`
- Knowledge: none for this folder. The staged-merge spec is [`historical-consolidation-rules-and-staging-spec.md`](../../../docs/index.md) (Planner module seam: the applier accepts an approved manifest plus an explicitly selected target and migration context; “the migration context disables outbound integrations and requires the selected database to match the intended rehearsal/[REDACTED] gate”). Hardening plan: [`historical-consolidation-final-hardening-and-pre-run-implementation-plan.md`](../../../docs/index.md) (Target and [REDACTED] safety gates: every apply is dry-run by default; rehearsal needs `--apply`, connected `testvantagemovers`, fresh snapshot/restore metadata, outbound disabled by leftover context, and no other writer; live needs `--apply` plus a separate leftover `[REDACTED]-apply` flag, exact connected `vantagemovers`, database-name confirmation, exact manifest SHA, reviewed Git SHA, backup id, restore-test evidence, zero unresolved blocking cases, successful two-apply rehearsal evidence, and an immediate human confirmation; Phase 1: “Add package commands only after target-guard tests pass”; required tests: “Target database guard and [REDACTED] confirmation tests”). Owner runbook: dry-run and apply on the rehearsal database; leftover rollback against `vantagemovers` needs its own exact hash and immediate confirmation phrase. Already-recommended siblings: [historical-consolidation-classification.md](historical-consolidation-classification.md), [historical-consolidation-planner.md](historical-consolidation-planner.md) (never writes Mongo; never **asks** this file), [historical-consolidation-manifest.md](historical-consolidation-manifest.md) (seals hashes; leftover `manifest.test.ts` **asks** this file — that beat is this **interface**, not the sealer), [historical-consolidation-apply.md](historical-consolidation-apply.md) (raw insert / compare-and-swap; **asks leftover** `assertApplyAuthorized` then leftover context then leftover lock; leftover preflight also throws unresolved blocking conflicts — rehearsal apply still hits that throw *after* this file returns), [historical-consolidation-verify.md](historical-consolidation-verify.md) (stamps leftover `verified` **without** this authorize), [historical-consolidation-rollback.md](historical-consolidation-rollback.md) (raw undo; **asks leftover** `assertRollbackAuthorized` — narrower than leftover apply — then leftover context then leftover lock), [historical-consolidation-migration-context.md](historical-consolidation-migration-context.md) (path-fenced ALS seat — this file never **asks** leftover `createHistoricalMigrationRunner` / leftover `requireHistoricalMigrationContext`). Distinct from leftover `operationalLock.ts` (the Mongo fence — this file never **asks** leftover `acquireHistoricalOperationalLock`). Distinct from already-recommended [employee-bookings-migration-apply-safety.md](employee-bookings-migration-apply-safety.md) (Registry CLI `--apply` vs leftover `TEST_MODE` vs leftover `--confirm-<live>-db=vantagemovers` — that file reads argv; this file never does). Distinct from leftover `ingest-historical-sheets.ts` (the write-capable row-by-row upsert the spec forbids becoming the planner, the applier, *or* this authorize). `package.json` still names `pnpm historical:apply` / `pnpm historical:rollback`; the staged-merge script folder is **absent** from this checkout. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — do not invent “Historical Target Guard” copies. `docs/adr/` is absent here — do not invent ADR copies. Do not add a Historical Consolidation Service in this rename.
- Callers: **leftover apply, leftover rollback, the barrel type, plus one fixture.** Leftover `apply.ts` imports leftover `assertApplyAuthorized` and leftover `ApplyAuthorization` from this file and **asks** leftover `assertApplyAuthorized(manifest, db.databaseName, authorization)` before leftover context / leftover lock / leftover preflight. Leftover `rollback.ts` imports leftover `assertRollbackAuthorized` only and **asks** leftover `assertRollbackAuthorized(db.databaseName, manifest.manifest_hash, authorization.apply, authorization.database_confirmation, authorization.manifest_hash_confirmation, authorization.human_confirmation)` — it does **not** take leftover `ApplyAuthorization`. Barrel `historicalConsolidation/index.ts` re-exports leftover `ApplyAuthorization` only — not leftover `assertApplyAuthorized`, not leftover `assertRollbackAuthorized`. Folder `manifest.test.ts` leftover “rehearsal and [REDACTED] target guards fail closed” **asks** both leftover asserts — that beat **is** this **interface**. Already-recommended planner / sealer / classifier / leftover verify / leftover migration context do **not** import this file. Scripts in this checkout do **not** import this file. Not this **interface**: leftover `requireHistoricalMigrationContext`, leftover `createHistoricalMigrationRunner`, leftover `acquireHistoricalOperationalLock`, leftover `applyHistoricalManifest`, leftover `rollbackHistoricalManifest`, leftover `preflightHistoricalManifest`, leftover `verifyHistoricalManifest`, leftover `assertMigrationApplyAuthorized`, leftover `ingest-historical-sheets.ts`.
- Seams callers need: leftover apply authorize vs leftover rollback authorize (two checklists — leftover rollback never reads leftover `[REDACTED]_apply`, leftover `git_sha`, leftover `backup_id`, leftover rehearsal evidence, or leftover blocking conflicts); leftover connected name vs leftover `authorization.target` (leftover apply only); leftover rehearsal short-circuit vs leftover live checklist; this planted card vs argv (this file never reads leftover `process.argv`); this authorize vs leftover ALS **require** vs leftover lock vs leftover mutate (leftover apply / leftover rollback **ask** this, then those siblings); leftover dry-run throw vs a write-nothing **adapter** (there is none). There is no begin / complete Domain Command **seam**. There is no live Form / Booking **adapter**. There is no Sheet Sync **adapter**. There is no HTTP **adapter**. There is no argv **adapter**. There is no Mongo **adapter**.
- Split later (only if the file outgrows one sitting): this ~48-line file is one sitting if you read it as authorize this connected historical target. If it later splits by **story**: do not. One leftover apply authorize plus one leftover rollback authorize. Never `create.ts` / `update.ts` / `delete.ts` / `authorize.ts`. Leftover apply, leftover rollback, leftover verify, leftover migration context, leftover lock, leftover employee-bookings apply safety, and live Form / Booking / Sheet Sync stay siblings / other services.

`assertApplyAuthorized` / `assertRollbackAuthorized` are executor mechanics. The owner question is: *The missing apply or rollback script already connected a database and already planted a card. Refuse leftover apply unless the connected name is the selected target, `--apply` is on, and either the selected target is rehearsal `testvantagemovers` without the leftover live-apply flag, or the selected target is live `vantagemovers` and every leftover live field is present — leftover `[REDACTED]_apply`, leftover `--confirm-database=vantagemovers`, leftover exact hash, leftover reviewed Git SHA, leftover backup id, leftover restore-test evidence, leftover planted rehearsal evidence, leftover exact `APPLY ${hash} TO vantagemovers`, and zero unresolved blocking conflicts. Refuse leftover rollback unless `--apply` is on, and if the connected name is `vantagemovers` also leftover exact database, leftover exact hash, and leftover `ROLLBACK ${hash} FROM vantagemovers`. This file does not plant the leftover seat. This file does not take the lock. This file does not write Mongo. This file does not read argv. This file does not start leftover apply or leftover rollback.*

Who plants the ALS suppress flags, who owns the fence, who inserts or undoes sealed rows, and who proves the live copy after the write already live in leftover **modules**. Do not pull those in.

## What this file actually does

Two “authorize this connected historical target” stories in one sitting, not “a guard helper,” and not Apply This Approved Manifest / Undo This Applied Manifest / Plant This Historical Migration Seat / Say Whether This CLI May Write:

1. **Refuse leftover apply unless the connected name is the selected target, `--apply` is on, and either rehearsal or the leftover live checklist** — `assertApplyAuthorized(manifest, connectedDatabase, authorization)`. leftover `connectedDatabase !== authorization.target` throws “Connected database … does not match selected target …”. leftover `authorization.apply` false throws “Apply is dry-run by default; pass --apply to authorize mutation”. leftover `authorization.target === "testvantagemovers"`: leftover `[REDACTED]_apply` true throws leftover “cannot be used for a rehearsal target”; otherwise return. leftover `authorization.target === "vantagemovers"` accumulates leftover failures: missing leftover `[REDACTED]_apply` → leftover `--[REDACTED]-apply`; leftover `database_confirmation !== "vantagemovers"` → leftover `--confirm-database=vantagemovers`; leftover `manifest_hash_confirmation !== manifest.manifest_hash` → leftover “exact --confirm-manifest-hash”; missing leftover `git_sha` or leftover `git_sha !== manifest.git_sha` → leftover “reviewed Git SHA”; missing leftover `backup_id` → leftover `--backup-id`; missing leftover `restore_test_evidence` → leftover `--restore-test-evidence`; leftover `rehearsal_evidence` missing, leftover `rehearsal.manifest_hash !== manifest.manifest_hash`, or any of leftover `first_apply_verified` / leftover `second_apply_noop` / leftover `rollback_verified` false → leftover “successful rehearsal evidence”; leftover `human_confirmation !== \`APPLY ${manifest.manifest_hash} TO vantagemovers\`` → leftover “exact immediate human confirmation”; leftover `manifest.conflicts.some(blocking && status !== "decision_supplied")` → leftover “zero unresolved blocking conflicts”. Any leftover failure throws leftover `authorization failed: ${failures.join(", ")}`. This beat does **not** compare leftover `manifest.target_database` to leftover `connectedDatabase`. This beat does **not** **ask** leftover `requireHistoricalMigrationContext`. This beat does **not** **ask** leftover `preflightHistoricalManifest`. This beat does **not** read leftover `process.argv`. This beat does **not** start leftover `applyHistoricalManifest`.

2. **Refuse leftover rollback unless `--apply` is on, and if the connected name is live `vantagemovers` also the exact database, hash, and leftover `ROLLBACK` phrase** — `assertRollbackAuthorized(target, manifestHash, apply, databaseConfirmation?, manifestHashConfirmation?, humanConfirmation?)`. leftover `apply` false throws “Rollback is dry-run by default; pass --apply to authorize mutation”. leftover `target === "vantagemovers"` also needs leftover `databaseConfirmation === "vantagemovers"`, leftover `manifestHashConfirmation === manifestHash`, and leftover `humanConfirmation === \`ROLLBACK ${manifestHash} FROM vantagemovers\`` — else leftover “rollback requires exact database, manifest hash, and immediate human confirmation”. Any other leftover `target` string (including leftover `testvantagemovers`) returns after leftover `apply` is true. This beat does **not** take leftover `ApplyAuthorization`. This beat does **not** read leftover `[REDACTED]_apply`, leftover `git_sha`, leftover `backup_id`, leftover `restore_test_evidence`, leftover `rehearsal_evidence`, or leftover `manifest.conflicts`. This beat does **not** compare leftover `target` to a selected leftover `authorization.target` field — leftover rollback passes leftover `db.databaseName` as leftover `target`. This beat does **not** **ask** leftover `assertApplyAuthorized`. This beat does **not** start leftover `rollbackHistoricalManifest`.

There is no third plant, lock, apply, or prove operation. Re-export leftover `ApplyAuthorization` through the barrel is convenience for a missing `pnpm historical:apply` script’s argument type. leftover `assertApplyAuthorized` / leftover `assertRollbackAuthorized` stay off the barrel on purpose — leftover apply / leftover rollback import this file.

## Organization

Keep one file. This is the screenplay for “authorize this connected historical target.” Raw write already lives on already-recommended `apply.ts`. Raw undo already lives on already-recommended `rollback.ts`. Prove-after-write already lives on already-recommended `verify.ts`. ALS suppress flags already live on already-recommended `migrationContext.ts`. The Mongo fence already lives on leftover `operationalLock.ts`. Registry CLI `--apply` already lives on already-recommended `employeeBookings/migrationApplySafety.ts`. Do not pull those in. Do not invent a `HistoricalTargetGuardService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent an argv **adapter** so “the missing script’s flags live here.” Do not invent an HTTP **adapter** so “a route can authorize.” Do not invent a Mongo **adapter** so “this file proves the backup or the rehearsal journals.” Do not invent a CRUD folder so “apply authorize and rollback authorize each get a file.”

Do not move leftover `assertApplyAuthorized` into leftover `apply.ts` so “apply owns the checklist.” Do not move leftover `assertRollbackAuthorized` into leftover `rollback.ts` so “rollback owns the phrase.” Do not merge the two leftover asserts so “one checklist owns every mutate.” Do not start leftover `createHistoricalMigrationRunner` here so “one seat owns authorize and plant.” Do not split `create.ts` / `update.ts` / `delete.ts` / `authorize.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `assertApplyAuthorized` | `refuseUnlessThisConnectedDatabaseMayReceiveThisHistoricalApply` | leftover apply must refuse rehearsal / live before it takes leftover context or leftover lock |
| `assertRollbackAuthorized` | `refuseUnlessThisConnectedDatabaseMayReceiveThisHistoricalRollback` | leftover rollback must refuse on a narrower phrase — not leftover apply’s leftover live checklist |
| `ApplyAuthorization` | `ThisHistoricalApplyAuthorization` | the leftover apply card (leftover `apply`, leftover `[REDACTED]_apply`, leftover `target`, leftover confirmations, leftover planted rehearsal evidence) |

Keep the old names as one-line aliases until leftover `apply.ts`, leftover `rollback.ts`, the barrel type, and the leftover `manifest.test.ts` fixture migrate. Do not make callers learn leftover `failures.push` as the domain language. Do **not** export leftover `failures`. Do **not** put leftover `assertApplyAuthorized` / leftover `assertRollbackAuthorized` on the barrel so “one export owns authorize” — leftover apply / leftover rollback already import this file. Do **not** rename leftover `ApplyAuthorization` field names (`apply`, leftover `[REDACTED]_apply`, leftover `target`, leftover `database_confirmation`, leftover `manifest_hash_confirmation`, leftover `git_sha`, leftover `backup_id`, leftover `restore_test_evidence`, leftover `rehearsal_evidence`, leftover `human_confirmation`, leftover `rehearsal_evidence.first_apply_verified` / leftover `second_apply_noop` / leftover `rollback_verified`). Do **not** rename the leftover throw strings (`dry-run by default`, leftover rehearsal-vs-live-apply sentence, leftover live-apply failed join, leftover live-rollback exact-phrase sentence, leftover `Connected database … does not match selected target`). Do **not** rename the leftover human phrases (`APPLY ${hash} TO vantagemovers`, leftover `ROLLBACK ${hash} FROM vantagemovers`). Do **not** rename leftover failure tokens (`--[REDACTED]-apply`, leftover `--confirm-database=vantagemovers`, leftover `exact --confirm-manifest-hash`, leftover `reviewed Git SHA`, leftover `--backup-id`, leftover `--restore-test-evidence`, leftover `successful rehearsal evidence`, leftover `exact immediate human confirmation`, leftover `zero unresolved blocking conflicts`).

**No workflow class.** The one type that *does* earn a name is the leftover apply card:

```ts
type ThisHistoricalApplyAuthorization = {
  apply: boolean
  [REDACTED]_apply: boolean
  target: "testvantagemovers" | "vantagemovers"
  database_confirmation?: string
  manifest_hash_confirmation?: string
  git_sha?: string
  backup_id?: string
  restore_test_evidence?: string
  rehearsal_evidence?: {
    manifest_hash: string
    first_apply_verified: boolean
    second_apply_noop: boolean
    rollback_verified: boolean
  }
  human_confirmation?: string
}
```

That is today’s leftover `ApplyAuthorization` — the handoff from “the missing apply script planted a card” to “leftover apply may see that this connected database is the selected target.” Leftover rollback’s argument stays the narrower inline card on leftover `rollback.ts` (`apply`, leftover confirmations) — do **not** move that card onto leftover `ApplyAuthorization` so “one type owns both mutates.” Leftover `HistoricalMigrationContext` stays on already-recommended `migrationContext.ts`. Leftover `HistoricalOperationalLock` stays on leftover `operationalLock.ts`. Do **not** add leftover `db` or leftover `manifest` onto leftover rollback’s signature so “the July type lives here.” Do **not** add leftover `process.argv` here so “one file owns the missing script.”

Leave leftover `applyHistoricalManifest` on already-recommended `apply.ts`. Leave leftover `rollbackHistoricalManifest` on already-recommended `rollback.ts`. Leave leftover `requireHistoricalMigrationContext` on already-recommended `migrationContext.ts`. Leave leftover `acquireHistoricalOperationalLock` on leftover `operationalLock.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// targetGuard.ts
// The missing apply or rollback script already connected a database
// and already planted a card.
// Refuse leftover apply unless the connected name is the selected
// target, --apply is on, and either rehearsal testvantagemovers
// without the leftover live-apply flag, or live vantagemovers
// with every leftover live field.
// Refuse leftover rollback unless --apply is on, and if the
// connected name is vantagemovers also the exact database, hash,
// and ROLLBACK phrase.
// Do not plant the seat. Do not take the lock. Do not write Mongo.
// Do not read argv.

// ── 1. Refuse leftover apply unless rehearsal or the leftover live checklist ──

export function refuseUnlessThisConnectedDatabaseMayReceiveThisHistoricalApply(
  manifest,
  connectedDatabase,
  authorization: ThisHistoricalApplyAuthorization,
): void
function refuseWhenTheConnectedNameIsNotTheSelectedTarget(connectedDatabase, authorization)
function refuseWhenLeftoverApplyDidNotPassApply(authorization) // dry-run by default
function allowRehearsalTestvantagemoversWithoutTheLeftoverLiveApplyFlag(authorization)
  // leftover [REDACTED]_apply true → leftover “cannot be used for a rehearsal target”
function refuseLiveVantagemoversUnlessEveryLeftoverLiveFieldIsPresent(manifest, authorization)
  // leftover [REDACTED]_apply, confirm-database, exact hash, reviewed git_sha,
  // backup_id, restore_test_evidence, planted rehearsal_evidence,
  // APPLY ${hash} TO vantagemovers, zero unresolved blocking conflicts

// ── 2. Refuse leftover rollback unless --apply and the narrower live phrase ─

export function refuseUnlessThisConnectedDatabaseMayReceiveThisHistoricalRollback(
  target,
  manifestHash,
  apply,
  databaseConfirmation?,
  manifestHashConfirmation?,
  humanConfirmation?,
): void
function refuseWhenLeftoverRollbackDidNotPassApply(apply) // dry-run by default
function refuseLiveVantagemoversRollbackUnlessTheExactPhraseIsPresent(
  target,
  manifestHash,
  databaseConfirmation,
  manifestHashConfirmation,
  humanConfirmation,
) // ROLLBACK ${hash} FROM vantagemovers
```

Read the primary path out loud: *Refuse leftover apply unless the connected name is the selected target and `--apply` is on. Rehearsal `testvantagemovers` returns once the leftover live-apply flag is off. Live `vantagemovers` needs leftover `[REDACTED]_apply`, leftover `--confirm-database=vantagemovers`, leftover exact hash, leftover reviewed Git SHA, leftover backup id, leftover restore-test evidence, leftover planted rehearsal evidence, leftover `APPLY ${hash} TO vantagemovers`, and zero unresolved blocking conflicts. Refuse leftover rollback unless `--apply` is on. Live `vantagemovers` rollback also needs leftover exact database, leftover exact hash, and leftover `ROLLBACK ${hash} FROM vantagemovers`. Any other leftover rollback target string returns after `--apply`. Do not plant the leftover seat. Do not take the lock. Do not write Mongo. Do not read argv.*

That is the operation. `failures.push` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Hardening rehearsal checklist is wider than this file.** Hardening still wants `--apply`, connected `testvantagemovers`, fresh leftover snapshot/restore metadata matching the manifest baseline, outbound disabled by leftover context, and no API / queue / cron / other migration against the rehearsal database. This file only leftover-compares leftover `connectedDatabase` to leftover `authorization.target`, leftover-requires leftover `apply: true`, and leftover-refuses leftover `[REDACTED]_apply` on rehearsal. Do not **ask** leftover `requireHistoricalMigrationContext` here so “outbound silence lives on the authorize,” and do not read leftover snapshot hashes here so “the sentence becomes true.” Those **asks** stay on leftover apply / leftover migration context.

2. **Hardening live checklist is only partly this file.** Hardening still wants a reviewed manifest path, fresh source and target preflight checksums, a verified backup identifier, restore-test evidence, and a successful two-apply rehearsal from a fresh leftover snapshot. This file leftover-checks leftover `backup_id` and leftover `restore_test_evidence` as nonempty strings, leftover-compares leftover `git_sha` to leftover `manifest.git_sha` (not leftover `process` git), and leftover-reads a planted leftover `rehearsal_evidence` object. It does **not** open leftover verify / leftover rollback journals. Do not query leftover `historical_import_apply_journal` here so “the planted card becomes true,” and do not leftover-compare leftover `manifest.target_collection_checksums` here so “preflight lives on the authorize.” Leftover apply leftover-asks leftover `preflightHistoricalManifest` after this file returns.

3. **`dry-run by default` is a throw, not a write-nothing adapter.** leftover `authorization.apply` false throws. leftover apply / leftover rollback then always plant leftover `dry_run: false`. There is no walk in this file. The runbook still says “dry-run and apply.” Do not add a leftover dry-run return so “the name stops lying,” and do not start leftover `preflightHistoricalManifest` from this throw so “dry-run is rehearsal.” That contradiction is already open from the apply / rollback passes.

4. **Sealed leftover `manifest.target_database` is always leftover `vantagemovers`.** Rehearsal leftover `authorization.target` is leftover `testvantagemovers`. This file leftover-compares leftover `connectedDatabase` to leftover `authorization.target`, not to the sealed field. Do not add leftover `manifest.target_database === connectedDatabase` so “the artifact owns the database,” without proving rehearsal leftover apply still authorizes leftover `testvantagemovers`.

5. **Leftover rollback does not share leftover apply’s leftover live checklist.** leftover `assertRollbackAuthorized` never leftover-reads leftover `[REDACTED]_apply`, leftover `git_sha`, leftover `backup_id`, leftover `restore_test_evidence`, leftover `rehearsal_evidence`, or leftover `manifest.conflicts`. leftover `target === "vantagemovers"` is the only extra gate. leftover `target === "testvantagemovers"` — or any other leftover string — returns after leftover `apply` is true. Do not **ask** leftover `assertApplyAuthorized` from leftover rollback so “one checklist owns every mutate,” and do not add leftover `[REDACTED]_apply` onto leftover rollback so “live undo matches live apply.” Leave the narrower phrase.

6. **Leftover rollback’s first argument is the connected name, not a selected leftover `target` field.** leftover `rollback.ts` leftover-passes leftover `db.databaseName`. There is no leftover `authorization.target` on that card, so leftover rollback never leftover-throws leftover “does not match selected target.” A leftover `assertRollbackAuthorized("otherdb", hash, true)` returns. Do not add leftover `ApplyAuthorization.target` onto leftover rollback so “connected must match selected,” without an **interface** proof that leftover rehearsal undo still authorizes leftover `testvantagemovers` with only leftover `apply: true`.

7. **Unresolved blocking conflicts are leftover-live-apply only on this file.** leftover apply leftover-preflight leftover-throws leftover “Manifest has unresolved blocking conflicts” on rehearsal *and* live, after this file returns. Rehearsal leftover `assertApplyAuthorized` leftover-returns even when leftover `manifest.conflicts` still leftover-blocks. Do not add that leftover `some` onto the leftover rehearsal branch so “one conflict check owns authorize,” and do not delete this leftover live check so “preflight owns every conflict.” Leftover apply leftover-asks this file *before* leftover preflight.

8. **This file never reads argv.** Hardening still shows leftover `pnpm historical:apply -- --manifest=… --target=testvantagemovers --apply`. The missing script must plant leftover `ApplyAuthorization`. leftover `employeeBookings/migrationApplySafety.ts` leftover-reads leftover `process.argv`. Do not import leftover `isMigrationApplyRequested` here so “one `--apply` owns every CLI,” and do not parse leftover `--confirm-database` here so “the missing script lives here.”

9. **leftover `rehearsal_evidence` is planted, not proven.** leftover `first_apply_verified` / leftover `second_apply_noop` / leftover `rollback_verified` are leftover booleans on the card. leftover verify leftover-stamps leftover `verified` without leftover authorization. Do not leftover-require leftover `verifyHistoricalManifest` from this file so “the planted flags become true.”

10. **leftover `backup_id` and leftover `restore_test_evidence` are presence-only.** Any nonempty leftover string leftover-passes. Do not leftover-compare them to leftover `manifest` hashes or leftover Cloud Run backup ids so “the sentence becomes true” in this rename.

11. **leftover `manifest.test.ts` is this interface, parked on the sealer.** The leftover “rehearsal and [REDACTED] target guards fail closed” test leftover-asks this file. Already-recommended leftover `manifest.md` already said that beat is not the sealer **interface**. Do not keep proving leftover `buildHistoricalManifest` as this **interface**. Do not add leftover `applyHistoricalManifest` into that fixture so “one test owns authorize and write.”

12. **The barrel exports the leftover apply type only.** leftover `assertApplyAuthorized` / leftover `assertRollbackAuthorized` stay file-local to leftover apply / leftover rollback. Do not put those leftover asserts on the barrel so “HTTP can authorize,” and do not delete leftover `ApplyAuthorization` from the barrel so “no leftover script means dead type.”

13. **leftover verify never **asks** this file.** Already-recommended leftover `verifyHistoricalManifest` leftover-stamps leftover `verified` without leftover authorization. Do not add leftover `assertApplyAuthorized` there so “verify matches apply’s seat” — that contradiction is already open from the verify pass.

14. **The staged-merge CLI is missing here.** `package.json` still names `pnpm historical:apply` / `pnpm historical:rollback`; the folder they point at is not in this checkout. Do not invent the script in this rename, and do not treat leftover `ingest-historical-sheets.ts` or leftover `assertMigrationApplyAuthorized` as the caller.

15. **Leave sibling modules and live writes alone.** Leftover `applyHistoricalManifest` / leftover `preflightHistoricalManifest`, leftover `rollbackHistoricalManifest`, leftover `verifyHistoricalManifest`, leftover `requireHistoricalMigrationContext` / leftover `createHistoricalMigrationRunner`, leftover `acquireHistoricalOperationalLock`, leftover `assertMigrationApplyAuthorized`, and already-recommended live Form / Booking writes are not this file. Do not inline them so “the authorize is one sitting.”

## Testing

The **interface** is the test surface: `refuseUnlessThisConnectedDatabaseMayReceiveThisHistoricalApply` (today `assertApplyAuthorized`) and `refuseUnlessThisConnectedDatabaseMayReceiveThisHistoricalRollback` (today `assertRollbackAuthorized`). leftover `ApplyAuthorization` may stay exported as an alias.

`manifest.test.ts` today leftover-proves leftover rehearsal leftover `apply: false` throws leftover `/dry-run by default/`, leftover rehearsal leftover `apply: true` with leftover `[REDACTED]_apply: false` leftover-does-not-throw, leftover live leftover `apply: true` plus leftover `[REDACTED]_apply: true` without the rest leftover-throws leftover `/authorization failed/`, leftover live leftover full card leftover-does-not-throw, leftover live leftover rollback missing leftover hash leftover-throws leftover `/exact database, manifest hash/`, and leftover live leftover rollback with leftover `ROLLBACK ${hash} FROM vantagemovers` leftover-does-not-throw. Keep that as this **interface**. Do not treat leftover `buildHistoricalManifest` / leftover `parseHistoricalManifest` in the same file as this **interface**. There is no `targetGuard.test.ts`.

Add only what this **interface** still hides. Do **not** point leftover apply / leftover rollback at live `vantagemovers` from this fixture.

**Refuse leftover apply unless rehearsal or the leftover live checklist**
- leftover `connectedDatabase !== authorization.target` → throw leftover `/does not match selected target/`.
- leftover `apply: false` on leftover `testvantagemovers` → throw leftover `/dry-run by default/`.
- leftover `apply: true`, leftover `[REDACTED]_apply: false`, leftover `target: "testvantagemovers"`, leftover connected leftover `testvantagemovers` → return (today’s leftover happy rehearsal).
- leftover `apply: true`, leftover `[REDACTED]_apply: true`, leftover `target: "testvantagemovers"` → throw leftover `/cannot be used for a rehearsal target/`.
- leftover `apply: true`, leftover `[REDACTED]_apply: true`, leftover `target: "vantagemovers"`, leftover connected leftover `vantagemovers`, leftover empty rest → throw leftover `/authorization failed/` and leftover-include leftover `--confirm-database=vantagemovers` (prove the leftover join; do **not** require leftover apply to run).
- leftover full leftover live card (today’s leftover happy live) → return.
- leftover full leftover live card with leftover `git_sha` leftover-unequal leftover `manifest.git_sha` → throw leftover `/reviewed Git SHA/`.
- leftover full leftover live card with leftover `rehearsal_evidence.manifest_hash` leftover-unequal leftover `manifest.manifest_hash` → throw leftover `/successful rehearsal evidence/`.
- leftover full leftover live card with leftover `human_confirmation` leftover-unequal leftover `APPLY ${hash} TO vantagemovers` → throw leftover `/exact immediate human confirmation/`.
- leftover full leftover live card plus leftover `conflicts: [{ blocking: true, status: "unresolved" }]` → throw leftover `/zero unresolved blocking conflicts/`.
- leftover rehearsal leftover `apply: true` plus the same leftover unresolved leftover blocking conflict → today’s walk leftover-returns (prove the gap; do **not** “fix” leftover rehearsal here). Do **not** add leftover `preflightHistoricalManifest` so “one test owns authorize and preflight.”
- leftover `manifest.target_database` leftover-stays leftover `vantagemovers` on leftover rehearsal leftover authorize — do **not** require leftover `connectedDatabase === manifest.target_database`.

**Refuse leftover rollback unless `--apply` and the narrower live phrase**
- leftover `apply: false` → throw leftover `/dry-run by default/`.
- leftover `target: "vantagemovers"` leftover-missing leftover hash or leftover phrase → throw leftover `/exact database, manifest hash/`.
- leftover `target: "vantagemovers"` plus leftover `ROLLBACK ${hash} FROM vantagemovers` → return (today’s leftover happy live undo).
- leftover `target: "testvantagemovers"`, leftover `apply: true`, leftover no leftover confirmations → today’s walk leftover-returns.
- leftover `target: "otherdb"`, leftover `apply: true` → today’s walk leftover-returns (prove the gap; do **not** “fix” leftover unknown leftover target in the test).
- Do **not** require leftover `[REDACTED]_apply`, leftover `git_sha`, leftover `backup_id`, leftover `rehearsal_evidence`, or leftover `manifest.conflicts` on leftover rollback.
- Do **not** require leftover `verifyHistoricalManifest` or leftover `acquireHistoricalOperationalLock` as this **interface**.

Do **not** add a test per helper (`refuseWhenTheConnectedNameIsNotTheSelectedTarget`, `allowRehearsalTestvantagemoversWithoutTheLeftoverLiveApplyFlag`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

leftover `ApplyAuthorization` may stay exported as an alias. It is not a second test surface.

## What I would not do

- A `HistoricalTargetGuardService` class with `authorize` / `apply` / `rollback` / `create` / `update` / `delete`.
- Thirty two-line functions that only wrap leftover `failures.push`.
- Moving this into a CRUD folder, or a `guard/` folder that also swallows leftover `apply.ts`, leftover `rollback.ts`, leftover `migrationContext.ts`, leftover `operationalLock.ts`, and leftover `employeeBookings/migrationApplySafety.ts`.
- Treating leftover `applyHistoricalManifest`, leftover `rollbackHistoricalManifest`, leftover `verifyHistoricalManifest`, leftover `preflightHistoricalManifest`, leftover `requireHistoricalMigrationContext`, leftover `acquireHistoricalOperationalLock`, leftover `assertMigrationApplyAuthorized`, leftover `createFormLead`, or leftover `ingest-historical-sheets.ts` as this story.
- Inventing a Domain Command **seam** that has only this leftover throw list as an **adapter**.
- Inventing an argv **adapter** so “the missing script’s flags live here.”
- Inventing an HTTP **adapter** so “a route can authorize.”
- Asking leftover `assertApplyAuthorized` from leftover rollback so “one checklist owns every mutate.”
- Adding leftover `requireHistoricalMigrationContext` or leftover `preflightHistoricalManifest` here so “the hardening rehearsal sentences become true.”
- Querying leftover verify / leftover rollback journals so “leftover `rehearsal_evidence` is proven.”
- Comparing leftover `manifest.target_database` to leftover `connectedDatabase` so “the artifact owns the database.”
- Putting leftover `assertApplyAuthorized` on leftover verify so “verify matches apply’s seat.”
- Opening leftover `operationalLock.ts` in this pass, or writing a whole-folder recommendation for `historicalConsolidation`.
