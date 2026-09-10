# Prove This Applied Historical Manifest — Every Sealed Index And Write Still Matches, Counts And References Hold, Apply Started And Outbound Collections Did Not Grow, Then Stamp Verified And Journal The Card — Never Recalculate, Never Take The Fence, Never Authorize, Never Rollback — operational story

- Status: recommended
- Service: `historicalConsolidation` (Wave A, in-progress)
- Pass: 5 of this service — `verify.ts`
- Remaining in this service: `rollback.ts`, `migrationContext.ts`, `targetGuard.ts`, `operationalLock.ts`, `schemaValidation.ts`, `normalization.ts`, `dateParsing.ts`, `stableJson.ts`, `mongoValues.ts`
- Target: `src/services/historicalConsolidation/verify.ts`
- Knowledge: none for this folder. The staged-merge spec is [`historical-consolidation-rules-and-staging-spec.md`](../../../docs/index.md) (Stage G after apply: the owner must prove the live copy before workers start; Planner module seam: verify accepts a sealed manifest plus an explicitly selected target and cannot read Sheets or recalculate). Hardening plan: [`historical-consolidation-final-hardening-and-pre-run-implementation-plan.md`](../../../docs/index.md) (`verifyHistoricalManifest(manifest, target): VerificationResult`; `pnpm historical:verify -- --manifest=<path> --target=testvantagemovers`; rehearsal must report `ok: true` and prohibited side-effect deltas of zero). Owner runbook in the staged-merge plan folder (stop on any count, reference, allocation, duplicate-job, or side-effect verification error; do not start runtime workers until `ok: true`). Already-recommended siblings: [historical-consolidation-classification.md](historical-consolidation-classification.md), [historical-consolidation-planner.md](historical-consolidation-planner.md) (never writes Mongo), [historical-consolidation-manifest.md](historical-consolidation-manifest.md) (seals hashes / operation ids; leftover verify never **asks** `parseHistoricalManifest`), [historical-consolidation-apply.md](historical-consolidation-apply.md) (plants leftover `apply_start.side_effect_baseline` and leftover `SIDE_EFFECT_COLLECTIONS`; leftover preflight **throws** on index / fingerprint / first-run checksum drift and **skips** leftover `historical_import_registry` indexes — this file **accumulates** errors, **includes** every sealed index, and does **not** re-check fingerprint or checksums). Distinct from leftover `rollback.ts` (undo under leftover rollback authorization — same leftover lock family, not this **interface**). Distinct from leftover `targetGuard.ts` / leftover `migrationContext.ts` / leftover `operationalLock.ts` (already-recommended apply **asks** all three; this file **asks none**). Distinct from leftover `stableJson.ts` (`assertArtifactHash` — this file **asks** it). Distinct from leftover `mongoValues.ts` (`matchesPlanned` — this file **asks** it; leftover `mongoDocument` / leftover `comparable` are not this file). Distinct from already-recommended live [form-lead.md](form-lead.md) / [leads-call-lead.md](leads-call-lead.md) / [bookings-booked-lead.md](bookings-booked-lead.md) / [cancellations-cancelled-lead.md](cancellations-cancelled-lead.md) / [customers-customer.md](customers-customer.md) / [agents-agent-allocation.md](agents-agent-allocation.md) — those write through application services; this file only **reads** live documents and planned fields. `package.json` still names `pnpm historical:verify`; the staged-merge script folder is **absent** from this checkout. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — do not invent “Historical Verify” copies. `docs/adr/` is absent here — do not invent ADR copies. Do not add a Historical Consolidation Service in this rename.
- Callers: **the barrel only.** Barrel `historicalConsolidation/index.ts` re-exports `verifyHistoricalManifest`. There is **no** `verify.test.ts`. Folder `manifest.test.ts` / leftover `rollback.test.ts` do **not** import this file. Already-recommended apply / planner / sealer / classifier do **not** import this file. Leftover `rollback.ts` does **not** import this file. Scripts in this checkout do **not** import this file. Not this **interface**: leftover `assertApplyAuthorized`, leftover `assertRollbackAuthorized`, leftover `requireHistoricalMigrationContext`, leftover `acquireHistoricalOperationalLock`, leftover `applyHistoricalManifest`, leftover `preflightHistoricalManifest`, leftover `rollbackHistoricalManifest`, leftover `parseHistoricalManifest`, leftover `createFormLead` / leftover `createBookedLead`.
- Seams callers need: leftover in-memory `assertArtifactHash` vs already-recommended `parseHistoricalManifest` (this file never opens bytes); leftover `matchesPlanned` vs this prove; leftover `SIDE_EFFECT_COLLECTIONS` plus journaled `apply_start.side_effect_baseline` vs this subtract; registry `applied` / `verified` skip vs this stamp `verified`; accumulate-and-return `ok` vs leftover apply preflight’s throw; journal `verification` vs leftover apply’s `apply_start` / `apply_complete` (this file always journals the card, even when `ok` is false). There is no leftover authorization **seam**. There is no leftover migration-context **seam**. There is no leftover lock **seam**. There is no begin / complete Domain Command **seam**. There is no live Form / Booking service **adapter**. There is no parse-bytes **adapter**.
- Split later (only if the file outgrows one sitting): this ~110-line file is one sitting if you read it as prove this applied historical manifest. If it later splits by **story**: `proveTheseSealedWritesStillMatchTheLiveCopy.ts`, `stampTheseHistoricalOperationsVerified.ts` — never `create.ts` / `update.ts` / `delete.ts`. Leftover apply, leftover rollback, leftover hasher, leftover mongo values, leftover lock, leftover target guard, and leftover migration context stay siblings.

`verifyHistoricalManifest` is executor mechanics. The owner question is: *Apply already wrote every sealed operation and journaled the outbound counts. Hash the in-memory manifest. Walk every sealed index and every sealed write. The live document must still match the planned insert or set, and a registry row must already say applied or verified. Then prove the sealed after-counts, the booking Job Numbers, the planned references, and the binder allocation sum. Prove an `apply_start` journal row exists and that leftover outbound collections did not grow from that baseline. If every check holds, stamp those registry rows verified. Always journal the card. This file does not recalculate the plan. This file does not take the fence. This file does not ask leftover authorization or leftover migration context. This file does not rollback.*

Who authorizes the target, who plants the ALS suppress flags, who owns the fence, who hashes the artifact, who materializes `$oid` / `$date`, and who undoes the write already live in leftover **modules**. Do not pull those in.

## What this file actually does

Four “prove this applied historical manifest” stories in one sitting, not “a CRUD verifier,” and not Plan This Historical Merge / Seal This Historical Manifest / Apply This Approved Manifest / Undo This Applied Manifest:

1. **Prove every sealed index still exists** — `verifyHistoricalManifest` open. **Ask** leftover `assertArtifactHash` on the in-memory object. For every leftover `expected_indexes` row — **including** leftover `historical_import_registry` — load `collection.indexes()`, find the sealed `name`, and require the same `unique` flag and `JSON.stringify(key)`. A miss pushes `Missing or mismatched index ${collection}.${name}` and continues. This beat does **not** throw. This beat does **not** skip the registry collection (leftover apply preflight does). This beat does **not** compare leftover `target_cluster_fingerprint`. This beat does **not** re-scan leftover `target_collection_checksums`. This beat does **not** **ask** leftover `assertApplyAuthorized`. This beat does **not** **ask** leftover `parseHistoricalManifest`.

2. **Prove each sealed write still matches the live document** — the operation walk. For each leftover `operations` row, find leftover `historical_import_registry` by `operation_id` **and** `manifest_hash`. Missing row, or `state` not `applied` / `verified`, pushes `Operation ${id} has no applied registry record` and `continue`s (no live-document read). Else load `{ _id: ObjectId(target_id) }` from leftover `operation.collection`. Planned fields are leftover `document` on insert and leftover `set` on update. Missing target, missing planned image, or leftover `matchesPlanned(target, expected)` false pushes `Operation ${id} target does not match the manifest` and `continue`s. A match increments leftover `verified`. This beat does **not** compare leftover `before`. This beat does **not** compare leftover `precondition`. This beat does **not** write the registry yet. This beat does **not** treat `verified_operations` as “already stamped”; a still-`applied` match counts.

3. **Prove counts, booking identities, and planned references still hold** — leftover `verifyExpectedCounts`, leftover `verifyBookingIdentities`, leftover `verifyReferences`. Every leftover `expected_counts` entry must have live `countDocuments() === after`, and sealed `before + inserts === after` (a sealed-arithmetic miss is reported even when the live count matches). Then a global `booked_leads` aggregate groups non-empty `normalized_job_no` and pushes up to twenty `Duplicate normalized_job_no` errors — **not** scoped to this manifest. Then each planned image (insert `document` / update `set`) is walked for references: Form / Call → `lead_source_company` / `source_granularity_id` / `receiver_agent`; Booking → `customer` plus `lead_ref` (`CallLead` → `call_leads`, else `form_leads`); Cancellation → `booked_lead` / `customer` / `lead_ref`. A string or `{ $oid }` that is a valid ObjectId must exist; an invalid id is **skipped**, not an error. Catalog collections (`agents`, `merchants`, `lead_source_companies`, `lead_source_granularities`, `operations_registry_changes`, `customers`) plant no reference list. Each Booking also **asks** leftover `verifyBookingAllocations`: missing live booking returns; else every leftover `agent_allocations[].agent` must be an ObjectId that exists on leftover `agents`, and rounded binder cents must equal leftover `total_binder_amount` cents. This beat does **not** read the live document for the planned-reference walk (only allocations do). This beat does **not** **ask** leftover `createBookedLead`.

4. **Prove apply started and outbound collections did not grow, then stamp verified and journal the card** — load the oldest leftover `historical_import_apply_journal` row with `kind: "apply_start"` for this hash. Missing start pushes `Apply journal has no apply_start record`. For each leftover `SIDE_EFFECT_COLLECTIONS` member (`sheet_sync_jobs`, `lead_messages`, `operational_events`, `notification_deliveries`), `current - baseline` must be `0`. Missing start **falls back** to `current` as the baseline, so the subtract is a no-op and only the missing-journal error remains. A non-zero delta pushes `Prohibited side-effect collection ${name} changed by ${count} during apply`. When `errors.length === 0`, `updateMany` leftover registry rows for this hash still `applied` to `state: "verified"` plus `verified_at` and `$inc state_revision`. Always build leftover `VerificationResult` (`ok` is `errors.length === 0`, `checked_operations` is the sealed list length, `verified_operations` is the match count, `prohibited_side_effect_counts` is the subtract map, `target_database` is the connected name) and insert leftover journal `kind: "verification"` with that card. Return the card. This beat does **not** require leftover `apply_complete`. This beat does **not** **ask** leftover `acquireHistoricalOperationalLock`. This beat does **not** **ask** leftover `requireHistoricalMigrationContext`. This beat does **not** **ask** leftover `rollbackHistoricalManifest`. A second call that still matches walks the same list, counts the same `verified_operations`, finds no leftover `applied` rows to stamp, and journals another `verification` card.

There is no fifth plan, classify, or apply operation. Leftover `verifyExpectedCounts` / leftover `verifyBookingIdentities` / leftover `verifyReferences` / leftover `verifyBookingAllocations` are folds operations 3 **asks**. Re-export through the barrel is convenience for a missing `pnpm historical:verify` script.

## Organization

Keep one file. This is the screenplay for “prove this applied historical manifest.” Raw insert / compare-and-swap already lives on already-recommended `apply.ts`. Undo already lives on leftover `rollback.ts`. Authorization already lives on leftover `targetGuard.ts`. ALS suppress flags already live on leftover `migrationContext.ts`. The fence already lives on leftover `operationalLock.ts`. Artifact hash already lives on leftover `stableJson.ts`. Planned-field compare already lives on leftover `mongoValues.ts`. Do not pull those in. Do not invent a `HistoricalVerifyService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a leftover lock **adapter** so “verify owns the fence.” Do not invent a leftover authorization **adapter** so “the July target type becomes true.” Do not invent a filesystem **adapter** so “verify opens the artifact.” Do not invent a CRUD folder so “index / count / reference each get a file.”

Do not merge this into already-recommended `apply.ts` so “one function owns write and prove.” Do not move leftover `SIDE_EFFECT_COLLECTIONS` here so “verify owns the outbound list.” Do not start leftover `createHistoricalMigrationRunner` here so “verify owns the ALS.” Do not split `create.ts` / `update.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `verifyHistoricalManifest` | `proveThisAppliedHistoricalManifest` | the missing verify script must prove the live copy and stamp leftover `verified` |
| `VerificationResult` | `ThisHistoricalVerificationOutcome` | `ok`, checked / verified counts, `errors`, leftover `prohibited_side_effect_counts` |

Keep the old names as one-line aliases until the barrel and a later verify fixture migrate. Do not make callers learn leftover `verifyExpectedCounts` / leftover `verifyBookingIdentities` / leftover `verifyReferences` / leftover `verifyBookingAllocations` as the domain language. Do **not** export those folds. Do **not** rename persisted collection names (`historical_import_registry`, `historical_import_apply_journal`) or journal `kind` strings (`apply_start`, `verification`). Do **not** rename persisted registry `state` tokens (`applied`, `verified`). Do **not** rename leftover `SIDE_EFFECT_COLLECTIONS` members — this file subtracts those exact keys. Do **not** rename leftover `VerificationResult` field names (`checked_operations`, `verified_operations`, `prohibited_side_effect_counts`, `ok`).

**No workflow class.** The one type that *does* earn a name is the card the missing script reads:

```ts
type ThisHistoricalVerificationOutcome = {
  manifest_hash: string
  target_database: string
  ok: boolean
  checked_operations: number
  verified_operations: number
  errors: string[]
  prohibited_side_effect_counts: Record<string, number>
}
```

That is the handoff from “apply finished writing” to “the owner may start workers, or leftover rollback may undo.” Leftover `ApplyAuthorization` stays on leftover `targetGuard.ts`. Leftover `HistoricalMigrationContext` stays on leftover `migrationContext.ts`. Leftover `HistoricalOperationalLock` stays on leftover `operationalLock.ts`. Do **not** move those cards here. Do **not** add `target` or `migrationContext` as a function argument so “the July type becomes true” in this rename — the connected `db` is the current **seam**.

Leave write on already-recommended `apply.ts`. Leave undo on leftover `rollback.ts`. Leave the target-guard checklist on leftover `targetGuard.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// verify.ts
// Apply already wrote every sealed operation and journaled the outbound counts.
// Hash the in-memory manifest.
// Prove every sealed index still exists.
// Prove each sealed write still matches the live document.
// Prove counts, booking Job Numbers, planned references, and binder cents.
// Prove apply started and leftover outbound collections did not grow.
// If every check holds, stamp verified. Always journal the card.
// Do not recalculate. Do not take the fence. Do not authorize. Do not rollback.

// ── 1. Prove every sealed index still exists ──────────────

export async function proveThisAppliedHistoricalManifest(manifest, db)
// ask leftover assertArtifactHash
function accumulateAMissingOrChangedExpectedIndex(manifest, db, errors)
  // include leftover historical_import_registry — do not copy apply's skip

// ── 2. Prove each sealed write still matches ──────────────

function proveThisSealedWriteStillMatchesTheLiveDocument(operation, manifest, db, errors)
function refuseAMissingAppliedOrVerifiedRegistryRow(operation, manifest, db, errors)
function refuseALiveDocumentThatNoLongerMatchesThePlan(operation, db, errors)
  // insert → document; update → set; ask leftover matchesPlanned
  // do not start comparing before or precondition in this rename

// ── 3. Prove counts, identities, and references ───────────

function proveTheseSealedAfterCountsStillHold(manifest, db, errors)
function refuseSealedCountArithmeticThatDoesNotAddUp(expected)
function refuseDuplicateNormalizedJobNumbersOnTheLiveBook(db, errors) // global; limit 20
function proveThesePlannedReferencesStillExist(manifest, db, errors)
function skipAnInvalidObjectIdReference(value) // not an error
function proveThisBookingAllocationStillAddsUp(operationId, targetId, db, errors)
  // live booking only; missing booking returns

// ── 4. Prove outbound silence, stamp, journal ─────────────

function loadTheOldestApplyStartJournalRow(manifest, db)
function subtractTheJournaledOutboundBaseline(start, db)
  // missing start → baseline is current; still push the missing-journal error
function stampAppliedRegistryRowsVerifiedWhenEveryCheckHolds(manifest, db, errors)
function journalThisVerificationCard(manifest, db, outcome) // always, even when ok is false
```

Read the primary path out loud: *Hash the in-memory manifest. Accumulate a missing or changed index, a sealed write with no applied registry row, or a live document that no longer matches the plan. Refuse a drifted after-count, broken sealed arithmetic, a duplicate live Job Number, a missing planned reference, or a binder sum that does not add up. Refuse a missing `apply_start` or a grown leftover outbound collection. If the error list is empty, stamp leftover `verified`. Always journal the card. A second prove that still matches is a no-op stamp plus another journal row. Do not walk the sheets again. Do not take the fence. Do not ask leftover authorization. Do not rollback.*

That is the operation. `verifyExpectedCounts` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This prove writes, and it writes without the fence.** Leftover apply takes leftover authorization, leftover migration context, and leftover lock before it mutates. This file stamps leftover `verified` and inserts leftover `verification` with none of those three. Hardening plan types `verifyHistoricalManifest(manifest, target)` and says the lock prevents concurrent applies — it never says verify is unfenced. Do not add leftover `assertApplyAuthorized` / leftover `requireHistoricalMigrationContext` / leftover `acquireHistoricalOperationalLock` so “verify matches apply’s seat” in this rename. That would invent a leftover authorization **seam** this export does not have. A later, tested change may plant the fence; this pass only names that the stamp races leftover apply.

2. **July type plants `target`, not `db`.** Hardening plan: `verifyHistoricalManifest(manifest, target)`. Current export is `(manifest, db)`. There is no leftover authorization argument and no leftover context argument. Do not add those arguments so “the July type lives here,” and do not start leftover `createHistoricalMigrationRunner` inside this file so “verify owns the ALS.” Leave the runner on leftover `migrationContext.ts`.

3. **This file never opens bytes.** It **asks leftover** `assertArtifactHash` on an in-memory object. Already-recommended `parseHistoricalManifest` is the disk **seam** and is still uncalled by leftover verify. Do not route this export through parse so “one function owns every hash” in this rename. That contradiction is already open from the sealer / apply passes.

4. **Missing `apply_start` zeros the outbound subtract.** When the journal row is absent, each leftover `SIDE_EFFECT_COLLECTIONS` baseline becomes `current`, so `current - baseline` is `0` and the “changed by” error never fires. The only record is `Apply journal has no apply_start record`. Do not treat a missing start as “outbound grew by current,” and do not drop the fallback so “every missing journal fails two ways,” without an **interface** proof. Keep both: the missing-journal error, and the no-op subtract.

5. **Index prove is stricter than leftover apply preflight, and quieter.** Leftover `preflightHistoricalManifest` **throws** and **skips** leftover `historical_import_registry`. This file **accumulates** and **includes** every sealed index. Do not copy the registry skip here so “one index walk owns both files,” and do not start throwing on the first miss so “verify matches preflight.” The accumulate-and-return `ok` card is this **seam**.

6. **Fingerprint and checksums are not this prove.** Leftover apply preflight owns cluster fingerprint and first-run collection checksums. This file never re-reads them. Do not add those walks here so “every prove is a fresh preflight.” A mid-apply resume already skipped checksums; leftover verify running after a successful apply would then hash its own inserts.

7. **Duplicate Job Number is a live-book scan, not a manifest walk.** Leftover `verifyBookingIdentities` aggregates leftover `booked_leads` globally and caps twenty errors. A pre-existing live duplicate fails this prove even when this hash inserted none of them. Do not scope the aggregate to leftover `operations` so “only this apply’s Jobs count,” without an **interface** proof that the owner wanted the weaker check.

8. **Invalid ObjectId references are skipped.** A planned `$oid` / string that fails `ObjectId.isValid` is not an error. Only a valid id that is missing from the target collection pushes. Do not start failing closed on a bad id so “every planned pointer is proven,” without proving sealed `$oid` materialization already ran.

9. **References read the plan; allocations read the live booking.** Leftover `verifyReferences` walks leftover `document` / leftover `set`. Leftover `verifyBookingAllocations` loads the live Booking and sums leftover `agent_allocations`. A planned binder that drifted from the live sum can pass the planned-field match (if binder was not in leftover `set`) and still fail allocations — or the reverse. Do not point allocations at the planned image so “one document owns both checks.”

10. **Sealed count arithmetic is reported as a live error.** `before + inserts !== after` is a sealed-manifest bug. This file still pushes it next to a live `countDocuments` miss. Do not drop the arithmetic check so “only the live count matters,” and do not move it back into already-recommended `manifest.ts` in this rename.

11. **Stamp and journal are two writes, not one transaction.** Success `$set`s leftover `verified`, then inserts leftover `verification`. A crash between them leaves stamped rows without a card, or — if the journal is written last, as today — a later retry stamps nothing and journals again. Do not wrap stamp + journal in leftover `session.withTransaction` so “one commit owns the card,” and do not move the journal ahead of the stamp so “the card is durable first,” without an **interface** proof. Do not require leftover `apply_complete` before stamping.

12. **`verified_operations` is the match count, not the stamp count.** An operation that already is leftover `verified` still increments. Later count / reference / side-effect errors can leave `ok: false` with `verified_operations > 0` and **no** stamp. Do not treat the counter as “rows moved to verified.”

13. **The folder has no verify fixture.** There is no `verify.test.ts`. Leftover `rollback.test.ts` proves leftover `buildRollbackUpdate` only. Do not keep leftover `manifest.test.ts` leftover-authorization proofs as this **interface**.

14. **The staged-merge CLI is missing here.** `package.json` still names `pnpm historical:verify`; the folder it points at is not in this checkout. Do not invent the script in this rename, and do not treat leftover `ingest-historical-sheets.ts` as the caller.

15. **Leave sibling modules and live writes alone.** Leftover `assertArtifactHash`, leftover `matchesPlanned`, leftover `SIDE_EFFECT_COLLECTIONS`, leftover `applyHistoricalManifest`, leftover `rollbackHistoricalManifest`, leftover `assertApplyAuthorized`, leftover `requireHistoricalMigrationContext`, leftover `acquireHistoricalOperationalLock`, and already-recommended `sealThisHistoricalManifest` are not this file. Do not inline them so “the verifier is one sitting.”

## Testing

The **interface** is the test surface: `proveThisAppliedHistoricalManifest` (today `verifyHistoricalManifest`). Leftover `VerificationResult` may stay exported as an alias.

There is no `verify.test.ts`. Do not treat leftover `manifest.test.ts` leftover-authorization / leftover-runner proofs, or leftover `rollback.test.ts` leftover `buildRollbackUpdate`, as this **interface**.

Add only what this **interface** still hides. Tests may plant leftover `apply_start` and leftover registry rows directly. Use a disposable database. Do **not** point at live `vantagemovers`. Do **not** require leftover `createHistoricalMigrationRunner` on this export — this file does not **ask** it.

**Prove every sealed index still exists**
- Sealed index present with matching unique/key → no index error.
- Missing name, unique drift, or key drift → `ok: false` and the missing-index string; the function **returns**, it does not throw.
- Sealed leftover `historical_import_registry` index is checked (do **not** copy leftover apply’s skip).
- Bad leftover `manifest_hash` → leftover `assertArtifactHash` throws; no journal row.

**Prove each sealed write still matches**
- Registry `applied` + live document leftover `matchesPlanned` the insert `document` or update `set` → `verified_operations` increments.
- Missing registry row, or `state` not `applied` / `verified` → no-applied-registry error; live document is not read.
- Registry `verified` already + still matching → increments again; `ok` can still be true.
- Live `_id` missing, or leftover `matchesPlanned` false → target-does-not-match error.
- Update `before` / leftover `precondition` may drift; this export does **not** read them.

**Prove counts, identities, and references**
- Live `countDocuments() === expected.after` and `before + inserts === after` → no count error.
- Live count drift → collection-has-N error.
- Sealed `before + inserts !== after` even when the live count matches `after` → arithmetic error.
- Two live Bookings sharing a non-empty `normalized_job_no` → duplicate-job error (global; not scoped to this hash).
- Planned valid `$oid` missing from the named collection → missing-reference error.
- Planned invalid ObjectId → **no** reference error.
- Booking whose live leftover `agent_allocations` cents ≠ leftover `total_binder_amount` cents → allocation-sum error.
- Booking whose allocation `agent` is missing on leftover `agents` → missing-agent-allocation error.
- Catalog-only operations plant no reference walk.

**Prove outbound silence, stamp, journal**
- Oldest leftover `apply_start` plus zero leftover `SIDE_EFFECT_COLLECTIONS` growth + empty errors → leftover registry `applied` becomes `verified`, journal `verification` with `ok: true`, `prohibited_side_effect_counts` all `0`.
- Leftover outbound collection grew by N → `ok: false`, no stamp, journal still written, `prohibited_side_effect_counts[name] === N`.
- Missing leftover `apply_start` → missing-journal error, outbound subtract is `0`, no stamp (unless that was the only planted failure — it is enough to keep `ok` false).
- Later count / reference error with every operation matching → `verified_operations > 0`, `ok: false`, no stamp, journal written.
- Second prove after a successful stamp → `verified_operations` still equals the list, no leftover `applied` rows remain, another `verification` journal row.
- Do **not** require leftover `apply_complete`.
- Do **not** require leftover authorization, leftover migration context, or leftover lock.
- Do **not** require leftover rollback.

Do **not** add a test per helper (`accumulateAMissingOrChangedExpectedIndex`, `proveThisBookingAllocationStillAddsUp`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

`VerificationResult` may stay exported as an alias. It is not a second test surface.

## What I would not do

- A `HistoricalVerifyService` class with `verify` / `check` / `create` / `update`.
- Thirty two-line functions that only wrap leftover `assertArtifactHash` or leftover `matchesPlanned`.
- Moving this into a CRUD folder, or a `verify/` folder that also swallows leftover `apply.ts`, leftover `rollback.ts`, leftover `targetGuard.ts`, leftover `operationalLock.ts`, and leftover `migrationContext.ts`.
- Treating leftover `planHistoricalConsolidation`, leftover `buildHistoricalManifest`, leftover `parseHistoricalManifest`, leftover `applyHistoricalManifest`, leftover `rollbackHistoricalManifest`, leftover `assertApplyAuthorized`, leftover `createFormLead`, or leftover `ingest-historical-sheets.ts` as this story.
- Inventing a Domain Command **seam** that has only this prove as an **adapter**.
- Inventing a leftover lock / leftover authorization / leftover migration-context **adapter** so “verify matches apply’s seat.”
- Routing this export through `parseHistoricalManifest` so “one function owns every hash” in this rename.
- Starting leftover `createHistoricalMigrationRunner` inside this file so “verify owns the ALS.”
- Copying leftover apply preflight’s registry-index skip, fingerprint walk, or checksum walk here so “one preflight owns both files.”
- Scoping leftover duplicate-job scan to this hash, or failing closed on an invalid ObjectId, so “unused tightness becomes true.”
- Wrapping stamp + journal in a transaction, or requiring leftover `apply_complete`, so “one commit owns the card.”
- Opening `rollback.ts` in this pass, or writing a whole-folder recommendation for `historicalConsolidation`.
