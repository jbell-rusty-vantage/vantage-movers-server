# Look At The Reservation And The Two Tabs — Say Whether We Reserve Fresh, Adopt A Swap Google Already Did, Or Take Over A Dead Owner — Then Write It Under The Lease, Mark Applied After Google Swaps, And CAS The Destination In One Transaction — operational story

- Status: recommended
- Service: `reporting` (Wave A, in-progress)
- Pass: 20 of this service — `promotionReservation.ts`
- Remaining in this service: `snapshotAdapter.ts`, `reportingObservability.ts`, `cleanup.ts`, `ownershipMarker.ts`, `registryFilters.ts`, remaining `google/*` adapters, remaining `live/*` harness
- Target: `src/services/reporting/promotionReservation.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (primary code is `reporting.service.ts`. Role: Owner-designed, checksum-bound reports. Happy path: preview → immutable revision → two-step confirmed run → **worker write**. Knowledge never names this file, `planPromotionRecovery`, `writePromotionReservationUnderLease`, `markPromotionReservationProviderApplied`, `commitPromotionDestinationCas`, `PromotionRecoveryPlan`, `STALE_PROMOTION_CAS`, or `promotion_reservation` — do not add a Reporting Service file in this rename so “the Service sentence wins”). Distinct from already-recommended inspect-and-name: [`reporting-promotion.md`](reporting-promotion.md) (`inspectReplaceTabPromotion` **lists** sheets and returns the four states; this file **consumes** `PromotionInspection` and never `listSheets`). Distinct from already-recommended claim / write / promote: [`reporting-reporting-worker.md`](reporting-reporting-worker.md) (`executeReplaceTabPromotion` **asks** plan then write / skip-provider / `promoteOrRecoverReplaceTab` then mark then `finishDestinationCasAndComplete`; `recoverRenameBatchSubmitted` **asks** write as `provider_applied` without plan; `finishDestinationCasAndComplete` **asks** commit and classifies transient — this file never claims a lease and never calls Google). Distinct from already-recommended RAW write / swap: [`reporting-delivery-engine.md`](reporting-delivery-engine.md) (`promoteOrRecoverReplaceTab` renames tabs; this file never `promoteStagingTab`). Distinct from already-recommended run persist: [`reporting-run-repository.md`](reporting-run-repository.md) (claim / renew / transition; this file writes `promotion_reservation` through native `ReportingRun.collection`, not that repository). Distinct from already-recommended delivery persist: [`reporting-delivery-repository.md`](reporting-delivery-repository.md) (`commitSnapshotDeliveryAndRunCompletion` is the snapshot twin — this file’s commit is replace-tab only; worker snapshot finish **asks** that sibling, not this commit). Distinct from already-recommended destination persist: [`reporting-destination-repository.md`](reporting-destination-repository.md) (`casUpdateManagedSheetAfterPromotion` is the orphaned sheet-id helper with **no runtime caller** — same `$set` / `$addToSet` / `$inc version` minus expected version and minus the run/delivery transaction). Distinct from leftover Wave B `src/models/ReportingRun.ts` (`promotion_reservation` is `Schema.Types.Mixed`, default null). Distinct from leftover Wave B `src/routes/reporting.routes.ts` (Owner run GET does not import this file). This is not Admin Analytics and not Sheet Sync. This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR).
- Callers: `reportingWorker.ts` (`executeReplaceTabPromotion` **asks** `planPromotionRecovery` then `writePromotionReservationUnderLease` as `reserved` or `provider_applied`; **asks** `markPromotionReservationProviderApplied` only after Google and a successful renew; `recoverRenameBatchSubmitted` **asks** write as `provider_applied` when the loaded reservation is missing or a different generation — it never **asks** plan; `finishDestinationCasAndComplete` **asks** `commitPromotionDestinationCas` then `isTransientPromotionTransactionError` for the bounded three-attempt retry; snapshot finish **asks** the transient classifier too, never this commit). Tests: `promotionReservation.test.ts` **asks** plan (four fixtures), `promotionReservationFilter` (prior-generation match only), `simulatePromotionLeaseInterleaving` (five interleavings), and `isTransientPromotionTransactionError` / `StalePromotionCasError`. It never writes Mongo and never **asks** `adopt_already_promoted`, `reuse_own_reservation`, `complete_cas_only`, or `staging_still_hidden`. `reportingDelivery.test.ts` / `reportingDelivery.regressions.test.ts` / `reporting.test.ts` do **not** import this file. **No runtime caller** for `promotionReservationFilter` except this file’s write. **No runtime caller** for `simulatePromotionLeaseInterleaving` except the test. Confirm / heartbeat / Owner GET do **not** import this file.
- Seams callers need: decide-the-next-step (`planPromotionRecovery`) vs write-the-reservation-under-the-lease (`writePromotionReservationUnderLease`) vs mark-applied-after-Google (`markPromotionReservationProviderApplied`) vs cas-the-destination-and-complete-the-run (`commitPromotionDestinationCas`) vs say-whether-the-transaction-may-retry (`isTransientPromotionTransactionError`). The inspect / plan **seam** exists because this file never lists sheets — sibling inspect names the four Google stories and this file plans on the literals. The write / mark **seam** exists because adopt, recover-already-applied, and rename-batch resume **write** `provider_applied` in one shot, while the first-swap path writes `reserved` and **marks** only after Google plus a renew. The mark / commit **seam** exists because commit matches `promotion_reservation.status: "provider_applied"` plus lease, fence, and `status: "promoting"` — a reserved row cannot complete. The replace-tab commit / snapshot commit **seam** exists because snapshot completion lives on sibling delivery persist. The runtime commit / orphaned destination helper **seam** exists because leftover `casUpdateManagedSheetAfterPromotion` must not start getting called. The stale / transient **seam** exists because `STALE_PROMOTION_CAS` is not a retryable network blip — worker treats stale as `LeaseLostError` and retries only classified Mongo transients, three times. There is no lease-claim **seam**. There is no Google rename **seam**. There is no begin / complete Domain Command **seam**. There is no Analytics **seam**. There is no Sheet Sync **seam**.
- Split later (only if the file outgrows one sitting): this ~513-line file is one sitting if you read it as look at the reservation and the two tabs, say whether we reserve fresh, adopt a swap Google already did, or take over a dead owner, then write it under the lease, mark applied after Google swaps, and CAS the destination in one transaction. Do **not** split into `create.ts` / `update.ts` / `delete.ts`. Do **not** split into `plan.ts` / `write.ts` / `cas.ts` so “each persist verb owns a file.” Do **not** pull worker lease / engine swap / sibling inspect / orphaned destination CAS here so “one promotion file owns the company.” If it later splits: `sayWhetherWeReserveFreshAdoptOrTakeOver.ts` / `writeTheReservationOntoTheRunWhileWeStillHoldTheLease.ts` / `pointTheDestinationAtTheNewSheetAndCompleteTheRunInOneTransaction.ts` only as later story files, never CRUD. Move `simulatePromotionLeaseInterleaving` into the test file if it later leaves — it is not a fifth owner operation.

`planPromotionRecovery` / `writePromotionReservationUnderLease` / `commitPromotionDestinationCas` are executor mechanics. The owner question is: *Google is about to swap the managed tab, or already did, and another worker may hold a leftover reservation. Look at the reservation on this run and the inspection of the two tabs. If there is no reservation and the old tab still holds the published name, reserve fresh. If Google already swapped and we have no reservation, adopt that swap. If we already reserved this generation, reuse it or finish the CAS we already marked applied. If a dead owner reserved and Google has not swapped, take over and promote once. If a dead owner reserved and Google already swapped, recover without a second rename. If we cannot tell, keep the old tab. Write that reservation onto the run only while this lease owner and epoch still hold `leased_until`. After Google swaps, mark it applied. Then, in one Mongo transaction, point the destination at the new sheet, complete the run, and patch the delivery — or say stale and leave Google alone. Do not list sheets. Do not rename Google. Do not claim a lease. Do not write RAW cells.*

Sibling inspect, sibling worker lease, sibling engine swap, sibling snapshot complete, leftover orphaned destination CAS already live in other **modules**. Do not pull those in.

## What this file actually does

Five operations of one “look at the reservation and the two tabs, say whether we reserve fresh, adopt a swap Google already did, or take over a dead owner, then write it under the lease, mark applied after Google swaps, and CAS the destination in one transaction” story, not “a reservation CRUD service,” and not the Google rename:

1. **Say whether we reserve fresh, adopt a swap Google already did, reuse our own reservation, take over a dead owner, or keep the old tab** — `planPromotionRecovery` is pure. Inputs: this lease owner / epoch, the persisted `ReportingPromotionReservation` or none, and sibling `PromotionInspection`. No prior + `ready_to_promote` / `staging_still_hidden` → `reserve_fresh`. No prior + `already_promoted` → `adopt_already_promoted`. No prior + anything else → `fail_ambiguous` (`inspection_ambiguous`). Own reservation (`owner === leaseOwner` **and** `generation === leaseEpoch`): `provider_applied` / `completed` → `complete_cas_only`; Google already swapped → `recover_already_applied`; still ready / staging-visible → `reuse_own_reservation`; else `fail_ambiguous` (`own_reservation_ambiguous`). Other owner: already swapped → `recover_already_applied`; still ready / staging-visible → `takeover_and_promote`; else `fail_ambiguous` (`prior_reservation_ambiguous_google_state`). This file does not write Mongo here. This file does not call Google.

2. **Write the reservation onto the run only while this lease still holds** — `writePromotionReservationUnderLease` **asks** `promotionReservationFilter`: run id + `lease_owner` + `lease_epoch` + `leased_until > now`, plus either `expectedPriorGeneration` or the `$or` “no reservation **or** this epoch already.” `$set`s the whole `promotion_reservation` bag. Stamps `generation`, `owner`, and `epoch` from **this** lease epoch — caller-supplied generation / owner / reserved_at are ignored. Miss → `null`; worker throws `LeaseLostError`. Recover-rename may write `provider_applied` in one shot. First-swap writes `reserved`.

3. **Mark the reservation applied after Google swapped** — `markPromotionReservationProviderApplied` matches the same lease **and** `promotion_reservation.generation === leaseEpoch` **and** `status: "reserved"`. Sets `provider_applied`, `recovery_title`, and `published_sheet_id`. Miss → `false`; worker throws `LeaseLostError`. Adopt / recover-already-applied / recover-rename skip this mark because they already wrote `provider_applied`.

4. **Point the destination at the new sheet, complete the run, and patch the delivery in one transaction — or say stale** — `commitPromotionDestinationCas` updates three collections under `withTransaction` (or a caller session). Run must be `promoting`, this lease, this fence generation/owner, reservation generation + `provider_applied`. Then destination must be `active` / `replace_tab` / expected version / old immutable sheet id; `$set`s the new sheet id and published name, `$addToSet`s the old id onto predecessors, `$inc`s version. If that destination match misses, a second find accepts “already advanced with that predecessor” — otherwise stale. Delivery must match this fence; miss → stale. `StalePromotionCasError` becomes `"stale"` (worker → `LeaseLostError`, never terminal-fail). Other errors rethrow. Snapshot finish does **not** **ask** this function.

5. **Say whether a transaction error may retry under the same lease** — `isTransientPromotionTransactionError`. `StalePromotionCasError` is **not** transient. Named Mongo network / selection / write-concern errors are. Message fragments (`transienttransactionerror`, `not primary`, `econnreset`, …) are. Worker retries three times, then abandons. This is not an owner-facing fifth click; it is the retry **seam** commit already needs.

`simulatePromotionLeaseInterleaving` is a deterministic test model of acquire → reserve → provider → renew → CAS. It is not an owner operation. Do not teach the worker to **ask** it.

## Organization

Keep one file. This is the screenplay for “look at the reservation and the two tabs, say whether we reserve fresh, adopt a swap Google already did, or take over a dead owner, then write it under the lease, mark applied after Google swaps, and CAS the destination in one transaction.” Sibling inspect, sibling worker lease, sibling engine swap, sibling snapshot complete already live in deeper **modules**. Do not pull those in. Do not invent a `PromotionReservationService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second inspect **adapter**. Do not invent a second destination-CAS **adapter** beside this commit.

Do not split plan / write / mark / commit into CRUD files. The plan stays with the writes because the worker already **asks** this one module as “what do we do next, then persist it under the lease we still hold.” Do not start `inspectReplaceTabPromotion` from this file. Do not start `promoteOrRecoverReplaceTab` from this file. Do not start `casUpdateManagedSheetAfterPromotion` from this file. Do not start `commitSnapshotDeliveryAndRunCompletion` from this file.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `planPromotionRecovery` | `sayWhetherWeReserveFreshAdoptOrTakeOver` | worker replace-tab only |
| `writePromotionReservationUnderLease` | `writeTheReservationOntoTheRunWhileWeStillHoldTheLease` | worker replace-tab + rename-batch resume |
| `markPromotionReservationProviderApplied` | `markTheReservationAppliedAfterGoogleSwapped` | worker replace-tab after Google + renew |
| `commitPromotionDestinationCas` | `pointTheDestinationAtTheNewSheetAndCompleteTheRunInOneTransaction` | worker finish-destination-CAS only |
| `isTransientPromotionTransactionError` | `thisTransactionErrorMayRetryUnderTheSameLease` | worker replace-tab CAS + snapshot CAS retries |
| `StalePromotionCasError` | `ThisGenerationNoLongerHoldsTheCas` | commit maps it to `"stale"` |
| `ReportingPromotionReservation` | `TheReservationWeWroteOnThisRun` | worker loads Mixed and passes it back in |
| `PromotionRecoveryPlan` | `WhatWeDoWithThisReservationNext` | seven actions; do not flatten to boolean |

Keep the old names as one-line aliases until `reportingWorker.ts` and `promotionReservation.test.ts` migrate. Do not make the consumer learn `sayWhetherWeReserveFreshAdoptOrTakeOver` — the consumer **asks** the worker. Do not export `promotionReservationFilter` as a second write **seam** — only write **asks** it at runtime. Do not export a new plan action so “mid-rename is public.” Do not persist new status strings in this rename.

**No class for the workflow.** Do **not** turn this into a `PromotionReservation` class. The type that *does* earn a name is the reservation the run already stores:

```ts
type TheReservationWeWroteOnThisRun = {
  generation: number
  owner: string
  epoch: number
  reserved_at: Date
  workbook_id: string
  staging_sheet_id: number
  old_sheet_id: number
  published_title: string
  status: "reserved" | "provider_applied" | "completed"
  recovery_title: string | null
  published_sheet_id: number | null
}
```

That is the handoff from “we decided the next step” to “Mongo may write it only while this lease still holds.” Do **not** put lease `leased_until` on this type. Do **not** put inspection state on this type. Do **not** put cell checksums on this type. Do **not** move it into a new `types/` folder. `generation` and `epoch` are both stamped from `leaseEpoch` today — leave both fields until callers migrate.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// promotionReservation.ts
// Google is about to swap the managed tab, or already did.
// Another worker may hold a leftover reservation.
// Look at the reservation on this run and the two tabs we just inspected.
// Say whether we reserve fresh, adopt a swap Google already did,
// reuse our own reservation, or take over a dead owner.
// Write that reservation only while this lease still holds.
// After Google swaps, mark it applied.
// Then point the destination at the new sheet and complete the run
// in one transaction — or say stale and leave Google alone.
// Do not list sheets.
// Do not rename Google.
// Do not claim a lease.
// Do not write RAW cells.

// ── 1. Say whether we reserve, adopt, reuse, or take over ─

export function sayWhetherWeReserveFreshAdoptOrTakeOver(input)
// no prior + ready / staging_still_hidden → reserve_fresh
// no prior + already_promoted             → adopt_already_promoted
// no prior + else                         → fail_ambiguous
// own generation + applied / completed    → complete_cas_only
// own generation + already_promoted       → recover_already_applied
// own generation + ready / staging_visible→ reuse_own_reservation
// other owner + already_promoted          → recover_already_applied
// other owner + ready / staging_visible   → takeover_and_promote
// else                                    → fail_ambiguous

function weStillOwnThisReservation(prior, leaseOwner, leaseEpoch)
// prior.owner === leaseOwner && prior.generation === leaseEpoch

// ── 2. Write the reservation onto the run under the lease ─

export async function writeTheReservationOntoTheRunWhileWeStillHoldTheLease(input)
// filter: this lease + leased_until > now
//         + expected prior generation, or none / this epoch
// stamp generation / owner / epoch from this lease epoch
// miss → null

function theLeaseAndPriorGenerationThisWriteMustStillMatch(input)
// today's promotionReservationFilter

// ── 3. Mark applied after Google swapped ──────────────────

export async function markTheReservationAppliedAfterGoogleSwapped(input)
// same lease + generation + status reserved
// set provider_applied + recovery title + published sheet id
// miss → false

// ── 4. Point the destination and complete in one TX ───────

export async function pointTheDestinationAtTheNewSheetAndCompleteTheRunInOneTransaction(input)
// run: promoting + lease + fence + reservation provider_applied → completed
// destination: active replace_tab + version + old sheet id → new sheet id
//              or already advanced with that predecessor
// delivery: this fence → deliverySet
// stale → "stale"; other errors rethrow

export class ThisGenerationNoLongerHoldsTheCas

// ── 5. Say whether the transaction may retry ──────────────

export function thisTransactionErrorMayRetryUnderTheSameLease(error)
// stale is not transient
```

Read the first-swap path out loud: *Inspect said `ready_to_promote`. No reservation. Plan says `reserve_fresh`. Write `reserved` under this lease. Renew. Engine swaps. Renew again. Mark `provider_applied`. Commit points the destination at the staging sheet id, completes the run, and patches the delivery. This file never sent the batchUpdate.*

Read the crash-after-Google path out loud: *Lease died after Google swapped. New worker inspects `already_promoted`. Plan says `recover_already_applied` (or `adopt_already_promoted` if the old reservation is gone). Write `provider_applied` under the new epoch. Skip Google. Commit. If inspect is `ambiguous`, fail and keep the old tab. A stale CAS is not a terminal fail — leave Google and the promoting run for the next lease.*

That is the operation. `planPromotionRecovery` is not.

## Precise logic I would tighten while renaming

These are the smells I would keep as comments or tickets, not silent behavior changes.

1. **`generation` and `epoch` are the same number.** Write always stamps both from `leaseEpoch`. `weStillOwnThisReservation` compares `generation === leaseEpoch` and never reads `prior.epoch`. Do not silently drop `epoch` in this rename. Do not start comparing `prior.epoch` so “the field earns its keep.” Leave both until callers migrate.

2. **`complete_cas_only` includes `completed`.** Own reservation + `status === "completed"` still returns `complete_cas_only`. Commit then matches `promotion_reservation.status: "provider_applied"` and misses → `"stale"` → `LeaseLostError`. Do not silently stop returning `complete_cas_only` for `completed` so “the plan tells the truth.” Do not silently let commit match `completed` so “resume is quieter.” Leave the literals. The worker has no other complete path for a reservation that is already `completed`.

3. **The simulator lets a dead lease mark `provider_applied`; the Mongo mark does not.** `simulatePromotionLeaseInterleaving` applies the provider after `expire_lease` if the reservation is still `reserved` by that worker — comment: Google may still mutate. `markPromotionReservationProviderApplied` requires `leased_until > now`. After a real expiry the reservation stays `reserved` while Google is already swapped; the next worker must **write** `provider_applied` via adopt / recover, not mark. Do not silently make the simulator require an active lease so “the model matches mark.” Do not silently drop the lease check on mark so “the model wins.” The interleaving tests lock today’s model.

4. **`staging_still_hidden` is planned like `ready_to_promote`.** Same pairing sibling inspect already documented: the literal means old tab still published and staging visible under another title. Do not silently drop that branch so “hidden already covers it.” Do not rename the inspection string from this file.

5. **`expectedPriorGeneration === null` can overwrite this epoch’s reservation.** The `$or` is “no reservation **or** `generation === leaseEpoch`.” `reserve_fresh` and adopt pass `null`. A second write in the same epoch replaces the bag, including `reserved_at`. Do not silently require a missing reservation only so “fresh means empty.”

6. **Caller-supplied generation / owner / reserved_at are ignored.** The input type allows `Partial<Pick<…>>` of those fields, then overwrites them. Do not start honoring caller generation so “the type stops lying.” Leave the stamp.

7. **Orphaned destination CAS must stay unused.** Sibling `casUpdateManagedSheetAfterPromotion` writes the same destination `$set` / `$addToSet` / `$inc` without expected version and without the run/delivery transaction. Do not start calling it from this commit so “one CAS owns the company.” Do not delete it in this rename. Do not merge the two helpers.

8. **Snapshot complete is a different commit.** Worker snapshot finish **asks** `commitSnapshotDeliveryAndRunCompletion`. This file’s commit is replace-tab + reservation + destination sheet id. Do not teach snapshot to **ask** this function. Do not put snapshot workbook ids on `TheReservationWeWroteOnThisRun`.

9. **No Mongo test locks write, mark, or commit.** Plan has four fixtures. Filter has one prior-generation assert. Interleaving and transient live in-process. `adopt_already_promoted`, `reuse_own_reservation`, `complete_cas_only`, own-generation `recover_already_applied`, and the null-generation `$or` are unasserted. Do not “fix” that by editing tests in this Cloud pass.

10. **Leave sibling files alone.** Inspect stays in `promotion.ts`. Lease claim / renew / `executeReplaceTabPromotion` stay in `reportingWorker.ts`. Swap stays in `deliveryEngine.ts`. Snapshot complete stays in `reportingDeliveryRepository.ts`. Orphaned destination CAS stays in `reportingDestinationRepository.ts`. Do not open unvisited `snapshotAdapter.ts` this pass.

## Testing

The interface is the story-named exports, not the helpers.

Existing asserts: no-prior + ready → `reserve_fresh`; other-owner + already_promoted → `recover_already_applied`; other-owner + ready → `takeover_and_promote`; other-owner + ambiguous → `fail_ambiguous`; filter matches prior generation; five interleavings (expiry before provider still “applies” in the model but cannot CAS; expiry during provider blocks CAS; stale A after B takeover cannot CAS; takeover of applied rename CAS-only in the model; takeover of not-applied re-reserves then promotes); CAS refused while still `reserved`; stale is not transient; `MongoNetworkError` is.

Add proofs at the new names (later implementer; not this Cloud pass):

- say reserve fresh: no reservation + `ready_to_promote` or `staging_still_hidden` → `reserve_fresh`
- say adopt: no reservation + `already_promoted` → `adopt_already_promoted`
- say keep the old tab: no reservation + `ambiguous` → `fail_ambiguous` / `inspection_ambiguous`
- say reuse our own: same owner + same generation + `reserved` + ready / staging-visible → `reuse_own_reservation`
- say finish the CAS we already marked: same owner + same generation + `provider_applied` → `complete_cas_only`
- say recover our own applied Google: same owner + same generation + `already_promoted` + still `reserved` → `recover_already_applied`
- say take over a dead owner: other owner + ready → `takeover_and_promote`; other owner + already swapped → `recover_already_applied`
- write under the lease: miss when lease expired or prior generation mismatches → `null`; stamp `generation === epoch === leaseEpoch`
- write adopt / recover as `provider_applied` without going through `reserved`
- mark applied: only `reserved` + this generation + active lease → true; expired lease → false (the Mongo mark, not the simulator)
- commit: run + destination + delivery all match → `"committed"`; destination already advanced with the predecessor still commits if run/delivery match; any other miss → `"stale"`, not a thrown stale to the worker
- never list sheets: plan does not **ask** `inspectReplaceTabPromotion`
- never rename: `promoteStagingTab` is not called
- never claim: `claimNextQueuedReportingRun` is not called

Do not add helper-unit tests for `weStillOwnThisReservation` or `theLeaseAndPriorGenerationThisWriteMustStillMatch`. Do not boot live Google, the queue publisher, or destination desk. Do not replace worker replace-tab tests with this file so “one test owns both stories.” Do not assert the simulator’s post-expiry `provider_applied` as if it were `markTheReservationAppliedAfterGoogleSwapped`.

## What I would not do

- I would not implement this pass.
- I would not rewrite `recommendations/form-lead.md`.
- I would not edit `src/`, tests, routes, models, or `docs/knowledge/`.
- I would not invent a CONTEXT.md term or an ADR. CONTEXT.md does not define Reporting.
- I would not open Wave B (`src/routes/reporting.routes.ts`, `src/models/ReportingRun.ts`).
- I would not write a whole-folder Reporting recommendation.
- I would not introduce a `PromotionReservationService` class or a `create.ts` / `update.ts` / `delete.ts` split.
- I would not split plan / write / mark / commit into separate persist files.
- I would not pull sibling inspect, worker lease, engine swap, or snapshot complete into this file.
- I would not start `casUpdateManagedSheetAfterPromotion` from this commit.
- I would not start `inspectReplaceTabPromotion` from this file so “plan owns the list.”
- I would not silently drop `epoch` or change `complete_cas_only` to exclude `completed`.
- I would not silently make the simulator require an active lease before `provider_apply`.
- I would not silently rename `staging_still_hidden` or the seven plan-action strings.
- I would not teach snapshot finish to **ask** this commit.
- I would not open unvisited `snapshotAdapter.ts` while this checklist still has unchecked modules after this row.
- I would not silently reorder ADR-known side effects.
