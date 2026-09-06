# Look At The Two Tabs By Immutable IDs — Say Whether We May Swap, Already Swapped, Or Cannot Tell — Then Name The Hidden Staging Tab And The Recovery Tab — operational story

- Status: recommended
- Service: `reporting` (Wave A, in-progress)
- Pass: 19 of this service — `promotion.ts`
- Remaining in this service: `promotionReservation.ts`, `snapshotAdapter.ts`, `reportingObservability.ts`, `cleanup.ts`, `ownershipMarker.ts`, `registryFilters.ts`, remaining `google/*` adapters, remaining `live/*` harness
- Target: `src/services/reporting/promotion.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (primary code is `reporting.service.ts`. Role: Owner-designed, checksum-bound reports. Happy path: preview → immutable revision → two-step confirmed run → **worker write**. Knowledge never names this file, `inspectReplaceTabPromotion`, `PromotionInspection`, `ready_to_promote`, `already_promoted`, `staging_still_hidden`, `recoveryTabTitle`, or `stagingTabTitle` — do not add a Reporting Service file in this rename so “the Service sentence wins”). Distinct from already-recommended claim / write / promote: [`reporting-reporting-worker.md`](reporting-reporting-worker.md) (`recoverRenameBatchSubmitted` **asks** inspect and **requires** `already_promoted`; `executeReplaceTabPromotion` **asks** inspect then sibling `planPromotionRecovery` then `recoveryTabTitle` — this file never claims a lease). Distinct from already-recommended RAW write / swap: [`reporting-delivery-engine.md`](reporting-delivery-engine.md) (`createOrResumeDeliveryArtifact` **asks** inspect on a marker miss so already-promoted recovery can resume, and **asks** `stagingTabTitle` when it creates replace-tab staging; `promoteOrRecoverReplaceTab` **asks** inspect before Google, after a failed `promoteStagingTab`, and again as the final prove — this file never calls `promoteStagingTab`). Distinct from next-pass reservation: sibling `promotionReservation.ts` (`planPromotionRecovery` **consumes** `PromotionInspection`; it never `listSheets`). Distinct from leftover Google rename: `google/reportingSheetsAdapter.ts` (`promoteStagingTab` renames old → recovery title and staging → published title + unhide in one batch; `createHiddenStagingTab` refuses a title collision). Distinct from leftover snapshot title: delivery-engine snapshot uses `report_<runId-8>`, not `stagingTabTitle`. Distinct from leftover verify: `verifyStagingContents` re-reads cells after a swap; this file never reads values. Distinct from leftover Wave B `src/routes/reporting.routes.ts` (Owner run GET does not import this file). This is not Admin Analytics and not Sheet Sync. This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR).
- Callers: `deliveryEngine.ts` (**asks** `inspectReplaceTabPromotion` from create-or-resume when replace-tab markers miss after a title change, and three times from `promoteOrRecoverReplaceTab`; **asks** `stagingTabTitle` only on replace-tab create; **asks** `recoveryTabTitle` before `promoteStagingTab`). `reportingWorker.ts` (**asks** inspect from `recoverRenameBatchSubmitted` — must be `already_promoted` or `PROMOTION_AMBIGUOUS`; **asks** inspect then `recoveryTabTitle` from `executeReplaceTabPromotion` when the reservation has no recovery title). Tests: `reportingDelivery.test.ts` **asks** inspect once after deleting staging and asserts `ambiguous` plus the old published title still present — it never **asks** `ready_to_promote`, `already_promoted`, `staging_still_hidden`, `stagingTabTitle`, or `recoveryTabTitle`. `promotionReservation.test.ts` **imports the type only** and builds fixture states; it never lists sheets. `reportingDelivery.regressions.test.ts` / `reporting.test.ts` do **not** import this file. **No runtime caller** for `PromotionInspection` except sibling reservation’s plan input. Confirm / heartbeat / Owner GET do **not** import this file.
- Seams callers need: inspect-the-two-tabs (`inspectReplaceTabPromotion`) vs name-the-hidden-staging-tab (`stagingTabTitle`) vs name-the-recovery-tab (`recoveryTabTitle`). The immutable-sheet-id / stale-title **seam** exists because Google rename changes titles and callers must look up `oldSheetId` / `stagingSheetId`, never “the tab named Weekly Report.” The four-state **seam** exists because `ready_to_promote` / `already_promoted` / `staging_still_hidden` / `ambiguous` are what sibling reservation plans on — this file does not reserve. The inspect / swap **seam** exists because this file only looks; `promoteStagingTab` lives on the Google **adapter**. The replace-tab staging title / snapshot title **seam** exists because snapshot names `report_<runId-8>` in the engine and must not learn `stagingTabTitle`. There is no lease **seam**. There is no reservation **seam**. There is no cell-read **seam**. There is no begin / complete Domain Command **seam**. There is no Analytics **seam**. There is no Sheet Sync **seam**.
- Split later (only if the file outgrows one sitting): this ~86-line file is one sitting if you read it as look at the two tabs by immutable IDs, say whether we may swap, already swapped, or cannot tell, then name the hidden staging tab and the recovery tab. Do **not** split into `create.ts` / `update.ts` / `delete.ts`. Do **not** split into `inspect.ts` / `title.ts` so “each verb owns a file.” Do **not** pull engine swap / worker lease / reservation CAS / Google `promoteStagingTab` here so “one promotion file owns the company.” If it later splits: `lookAtTheTwoTabsByIdAndSayWhetherWeMaySwap.ts` / `nameTheHiddenStagingTabAndTheRecoveryTab.ts` only as later story files, never CRUD.

`inspectReplaceTabPromotion` / `recoveryTabTitle` / `stagingTabTitle` are executor mechanics. The owner question is: *The worker is about to swap the managed tab, or resume after Google may already have swapped it. Look up the old published tab and the staging tab by their sheet IDs — never by title. Say whether the old tab still holds the published name and staging is still hidden (we may swap), whether staging already holds the published name and the old tab does not (already swapped), whether the old tab still holds the published name but staging is visible under another name (Google is mid-rename or someone unhid staging), or whether we cannot tell (a tab is missing, both look published, or the titles do not match those stories). Name the hidden staging tab from the published title and this run’s last eight characters. Name the recovery tab from the published title, this run’s last six characters, and this instant. Do not rename Google. Do not swap. Do not reserve a lease. Do not write cells. Do not commit the destination CAS.*

Engine swap, worker lease, reservation plan, and Google rename already live in other **modules**. Do not pull those in.

## What this file actually does

Three operations of one “look at the two tabs by immutable IDs, say whether we may swap, already swapped, or cannot tell, then name the hidden staging tab and the recovery tab” story, not “a promotion CRUD service,” and not the Google rename:

1. **Look up both tabs by immutable sheet ID; refuse to guess if either is missing** — `inspectReplaceTabPromotion` **asks** `sheets.listSheets`. Find `oldSheetId` and `stagingSheetId`. Either miss → `{ state: "ambiguous", oldPublished: false, stagingPublished: false }` with no titles. Callers treat that the same as every other `ambiguous`: keep the old tab. This file does not throw. This file does not read cells.

2. **Say which of the four Google stories is true** — published means `title === publishedTitle && !hidden`. `already_promoted`: staging is published and the old tab is not. `ready_to_promote`: the old tab is published and staging is hidden (staging title is not checked). `staging_still_hidden`: the old tab is published and staging is **not** published — after the hidden check, that means staging is visible under another title. Anything else, including both published, → `ambiguous`. Returns `oldPublished` / `stagingPublished` plus the live titles when both IDs resolved. Sibling reservation plans on these four strings. Worker recover-rename accepts only `already_promoted`. Engine promote treats `ready_to_promote` and `staging_still_hidden` as “call Google,” and treats `already_promoted` as “skip Google, still verify cells.”

3. **Name the hidden staging tab and the recovery tab — never rename Google** — `stagingTabTitle` is `__vantage_staging_${publishedTitle}_${runId.slice(-8)}`. Engine create-or-resume **asks** it only for replace-tab. Snapshot does not. Google `createHiddenStagingTab` refuses a collision on that exact title. `recoveryTabTitle` is `${publishedTitle}__vantage_recovery_${runId.slice(-6)}_${isoStamp}` where `isoStamp` is `now.toISOString()` with `:` and `.` replaced by `-`. Engine **asks** it before `promoteStagingTab`. Worker **asks** it only when the reservation has no recovery title. This file does not `renameSheet`.

`PromotionInspection` is the handoff sibling reservation already consumes. It is not an extra owner operation.

## Organization

Keep one file. This is the screenplay for “look at the two tabs by immutable IDs, say whether we may swap, already swapped, or cannot tell, then name the hidden staging tab and the recovery tab.” Sibling engine swap, sibling worker lease, sibling reservation plan, leftover Google rename already live in deeper **modules**. Do not pull those in. Do not invent a `PromotionService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second inspect **adapter** beside `listSheets`. Do not invent a second rename **adapter** beside `promoteStagingTab`.

Do not split inspect / titles into CRUD files. The four-state inspect stays with the two title helpers because engine create, engine promote, and worker recover-rename already **ask** this one module as “what do the tabs look like, and what should we call them.” Do not start `promoteStagingTab` from this file. Do not start `planPromotionRecovery` from this file. Do not start `writePromotionReservationUnderLease` from this file.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `inspectReplaceTabPromotion` | `lookAtTheTwoTabsByIdAndSayWhetherWeMaySwap` | engine create-or-resume + engine promote + worker recover-rename + worker replace-tab + one delivery test |
| `stagingTabTitle` | `nameTheHiddenStagingTabForThisRun` | engine replace-tab create only |
| `recoveryTabTitle` | `nameTheRecoveryTabForThisInstant` | engine promote + worker when the reservation has no title |
| `PromotionInspection` | `WhatTheTwoTabsLookLike` | sibling reservation plan **consumes** this; do not duplicate the four states |

Keep the old names as one-line aliases until `deliveryEngine.ts`, `reportingWorker.ts`, and `reportingDelivery.test.ts` migrate. Do not make the consumer learn `lookAtTheTwoTabsByIdAndSayWhetherWeMaySwap` — the consumer **asks** the worker. Do not make reservation tests learn `listSheets` so “one test owns both stories.” Do not export a fifth state so “mid-rename is public.”

**No class for the workflow.** Do **not** turn this into a `ReplaceTabPromotion` class. The type that *does* earn a name is the inspection sibling reservation already consumes:

```ts
type WhatTheTwoTabsLookLike = {
  state:
    | "ready_to_promote"
    | "already_promoted"
    | "staging_still_hidden"
    | "ambiguous"
  oldPublished: boolean
  stagingPublished: boolean
  oldTitle?: string
  stagingTitle?: string
}
```

That is the handoff from “we listed the workbook by ID” to “the reservation may decide reserve / adopt / fail, and the engine may decide swap or keep the old tab.” Do **not** put lease owner / epoch on this type. Do **not** put recovery title on this type. Do **not** put cell checksums on this type. Do **not** move it into a new `types/` folder.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// promotion.ts
// The worker is about to swap the managed tab,
// or resume after Google may already have swapped it.
// Look up the old published tab and the staging tab by sheet ID.
// Never look them up by title.
// Say whether we may swap, already swapped, or cannot tell.
// Name the hidden staging tab and the recovery tab.
// Do not rename Google.
// Do not swap.
// Do not reserve a lease.
// Do not write cells.
// Do not commit the destination CAS.

// ── 1. Look up both tabs by immutable sheet ID ────────────

export async function lookAtTheTwoTabsByIdAndSayWhetherWeMaySwap(input)
// listSheets; find oldSheetId and stagingSheetId
// either miss → ambiguous, both published flags false, no titles

function thisTabHoldsThePublishedName(sheet, publishedTitle)
// title === publishedTitle && !hidden

// ── 2. Say which of the four Google stories is true ───────

// already_promoted      — staging holds the published name; old does not
// ready_to_promote      — old holds the published name; staging is hidden
// staging_still_hidden  — old holds the published name; staging is visible
//                         under another title (the name lies — see precise logic)
// ambiguous             — missing tab, both published, or no story matches

// ── 3. Name the hidden staging tab and the recovery tab ───

export function nameTheHiddenStagingTabForThisRun({ publishedTitle, runId })
// __vantage_staging_${publishedTitle}_${runId.slice(-8)}

export function nameTheRecoveryTabForThisInstant({ publishedTitle, runId, now })
// ${publishedTitle}__vantage_recovery_${runId.slice(-6)}_${isoStamp}
// isoStamp = now.toISOString() with : and . replaced by -
```

Read the first-swap path out loud: *The engine already created hidden staging under `nameTheHiddenStagingTabForThisRun`. Cells are written and verified. Promote **asks** this inspect. Old tab still holds the published name and staging is hidden → `ready_to_promote`. Engine names the recovery tab, **asks** Google to rename old → recovery and staging → published + unhide, then inspects again. Final state must be `already_promoted`. This file never sent the batchUpdate.*

Read the crash-after-Google path out loud: *Google already swapped. Worker recover-rename **asks** this inspect. Staging holds the published name and the old tab does not → `already_promoted`. Reservation **asks** adopt / complete-CAS. This file does not write Mongo. If either ID is missing, or both tabs look published, say `ambiguous` and keep the old tab.*

That is the operation. `inspectReplaceTabPromotion` is not.

## Precise logic I would tighten while renaming

These are the smells I would keep as comments or tickets, not silent behavior changes.

1. **`staging_still_hidden` is a lying name.** The third branch is reached only after `oldPublished && staging.hidden` already returned `ready_to_promote`. So this state is: old tab still published, staging **visible** under a title that is not the published name. Engine promote treats it like `ready_to_promote` and still **asks** `promoteStagingTab`. Reservation treats it like `ready_to_promote` (`reserve_fresh` / `reuse_own_reservation` / `takeover_and_promote`). Do not silently rename the string this pass — sibling reservation and engine compare the literal. Do not delete the branch so “hidden already covers it.” The honest story name is “old tab still published, staging visible under another title.” Keep the exported state until callers migrate.

2. **`ready_to_promote` does not look at the staging title.** Hidden is enough. A hidden tab that already has the published title (Google would normally refuse that collision) still returns `ready_to_promote`. Do not silently add a title check so “ready means staging is still `__vantage_staging_…`.” Leave the predicate.

3. **`already_promoted` is title plus visibility, not markers.** Worker recover-rename and engine promote re-check ownership / run markers after this inspect. Do not fold those marker reads into this file so “inspect owns the proof.” Do not skip the caller marker checks so “inspect already said already_promoted.”

4. **Run-id slices disagree.** Staging uses the last **eight** characters. Recovery uses the last **six**. Do not silently make them the same length in this rename. Google `createHiddenStagingTab` collides on the exact staging title; changing the slice would mint a different tab name for the same run.

5. **Missing-tab `ambiguous` looks like a blank inspection.** Both published flags are false and titles are omitted. Both-published `ambiguous` returns both flags true and the live titles. Callers only switch on `state`. Do not silently throw on a missing ID so “missing is louder.” Engine create-or-resume already needs a non-throwing miss to fall through to run-marker scan.

6. **No test locks the four states or the two titles.** Delivery **asks** inspect only after deleting staging (`ambiguous`). Reservation tests invent `ready` / `applied` / `ambiguous` fixtures and never call this file. `staging_still_hidden`, `already_promoted`, `ready_to_promote`, `stagingTabTitle`, and `recoveryTabTitle` have no assertion here. Do not “fix” that by editing tests in this Cloud pass.

7. **Leave sibling files alone.** Swap stays in `deliveryEngine.ts`. Lease / recover-rename stay in `reportingWorker.ts`. Reservation plan / CAS stay in `promotionReservation.ts`. Google rename stays in `google/reportingSheetsAdapter.ts`. Do not open unvisited `promotionReservation.ts` this pass.

## Testing

The interface is the story-named exports, not the helpers.

There is one existing assert: deleted staging → `ambiguous`. Add proofs at the new names (later implementer; not this Cloud pass):

- look up both tabs by immutable sheet ID: missing old or missing staging → `ambiguous` with both published flags false and no titles; callers do not throw
- say we may swap: old title matches published and is visible, staging is hidden → `ready_to_promote` (staging title may be `__vantage_staging_…` or anything else)
- say already swapped: staging title matches published and is visible, old title does not (or old is hidden) → `already_promoted`
- say cannot tell: both tabs hold the published name; or neither story matches → `ambiguous`
- say staging is visible under another title: old still published, staging visible with a non-published title → today’s `staging_still_hidden` (keep the literal until callers migrate)
- name the hidden staging tab: `__vantage_staging_Weekly Report_<last8>`
- name the recovery tab: `Weekly Report__vantage_recovery_<last6>_<iso-with-colons-and-dots-as-dashes>`
- never rename: `promoteStagingTab` / `renameSheet` are not called
- never look up by title: inspect **asks** `listSheets` and matches `sheetId`

Do not add helper-unit tests for `thisTabHoldsThePublishedName`. Do not boot live Google, the queue publisher, run claim, or destination CAS. Do not replace `promotionReservation.test.ts` fixtures with this file so “one test owns both stories.”

## What I would not do

- I would not implement this pass.
- I would not rewrite `recommendations/form-lead.md`.
- I would not edit `src/`, tests, routes, models, or `docs/knowledge/`.
- I would not invent a CONTEXT.md term or an ADR. CONTEXT.md does not define Reporting.
- I would not open Wave B (`src/routes/reporting.routes.ts`, `src/models/`).
- I would not write a whole-folder Reporting recommendation.
- I would not introduce a `PromotionService` class or a `create.ts` / `update.ts` / `delete.ts` split.
- I would not split inspect / titles into separate persist files.
- I would not pull engine swap, worker lease, reservation CAS, or Google `promoteStagingTab` into this file.
- I would not start `planPromotionRecovery` from this file so “inspect owns the reservation.”
- I would not silently rename the `staging_still_hidden` string while callers still compare the literal.
- I would not silently equalize the run-id slice lengths.
- I would not silently add a staging-title check to `ready_to_promote`.
- I would not fold ownership-marker reads into this inspect.
- I would not teach snapshot create to **ask** `stagingTabTitle`.
- I would not open unvisited `promotionReservation.ts` while this checklist still has unchecked modules after this row.
- I would not silently reorder ADR-known side effects.
