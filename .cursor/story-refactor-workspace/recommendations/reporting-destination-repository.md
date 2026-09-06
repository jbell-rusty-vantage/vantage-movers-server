# Remember The Destination Row, CAS The Version We Agreed To, Keep Health And Denylist Young Together, Hide The Drive Connection — operational story

- Status: recommended
- Service: `reporting` (Wave A, in-progress)
- Pass: 7 of this service — `reportingDestinationRepository.ts`
- Remaining in this service: `reportingDestinationPort.adapter.ts`, `query/canonicalReporting.ts`, `query/pagination.ts`, `reportingWorker.ts`, `deliveryEngine.ts`, `executionStream.ts`, `queue.ts`, `reportingRunRepository.ts`, `reportingDeliveryRepository.ts`, `reportingManifestRepository.ts`, `manifestPageAdapter.ts`, `promotion.ts`, `promotionReservation.ts`, `snapshotAdapter.ts`, `reportingObservability.ts`, `cleanup.ts`, `ownershipMarker.ts`, `registryFilters.ts`, leftover `google/*` adapters, leftover `live/*` harness
- Target: `src/services/reporting/reportingDestinationRepository.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (primary code is leftover `reporting.service.ts`. Role: Owner-designed, checksum-bound reports. HTTP: Destinations `GET/POST/PATCH/DELETE .../destinations`, `POST .../verify` → leftover desk, which **asks** this file. Happy path: estimate / confirm bind **stable destination identity**, not volatile `healthVerifiedAt` / `denylistCheckedAt`. Skip / fail: destination port safety / checksum drift fail closed. Knowledge names destinations as an Owner desk and never names this file, version CAS, health refresh, or promotion sheet-id CAS — do not add a Reporting Service file in this rename so “the Service sentence wins”). Distinct from already-recommended leftover point-reports-at-this-Drive-place: [`reporting-destination.md`](reporting-destination.md) (**asks** list / get / insert / version CAS / archive / safe-read; does **not** **ask** leftover `refreshDestinationHealthAndDenylist` or leftover `casUpdateManagedSheetAfterPromotion`). Distinct from already-recommended leftover preview / freeze / estimate / confirm: [`reporting-reporting.md`](reporting-reporting.md) (**asks** `getReportingDestinationById` then leftover `refreshDestinationHealthAndDenylist` after leftover lineage accepts the live tab; leftover preview **asks** leftover port, not this file). Distinct from already-recommended leftover prove-this-destination: [`reporting-destination-contract.md`](reporting-destination-contract.md) (this file **asks** `snapshotChecksumFromDestinationRecord` on leftover safe-read; leftover estimate’s health refresh is why leftover confirm binds leftover stable identity). Distinct from already-recommended leftover keep-the-frozen-revision: [`reporting-destination-lineage.md`](reporting-destination-lineage.md) (this file **writes** `predecessor_sheet_ids` only through leftover orphaned promotion CAS; leftover `extractPredecessorSheetIds` only reads). Distinct from already-recommended leftover name-the-owner: [`reporting-destination-identity.md`](reporting-destination-identity.md) (leftover desk stamps the snapshot this file persists). Distinct from leftover destination port adapter: sibling `reportingDestinationPort.adapter.ts` (one Stage-4 **adapter**; **asks** leftover desk live prove, not this persist). Distinct from leftover promotion reservation: sibling `promotionReservation.ts` (`commitPromotionDestinationCas` is the runtime sheet-id writer — same `$set` / `$addToSet` / `$inc version`, plus `expectedDestinationVersion`, inside a Mongo transaction with run completion). Distinct from leftover worker write: sibling `reportingWorker.ts` (**asks** get + leftover health refresh; leftover promotion **asks** leftover `commitPromotionDestinationCas`, never this file’s promotion helper). Distinct from leftover Wave B `src/models/ReportingDestination.ts` (schema + `{ state, updated_at, _id }` index; mongoose `timestamps` only fire on leftover mongoose `findOneAndUpdate`). Distinct from leftover Wave B `src/routes/reporting.routes.ts` (Owner destination desk; list Zod defaults `state: "active"`). This is not Admin Analytics and not Sheet Sync. This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR).
- Callers: already-recommended leftover `reportingDestination.service.ts` (`listReportingDestinationSummaries` **asks** list + safe-read; `getReportingDestinationSummary` **asks** get + safe-read; snapshot / replace-tab create **ask** insert; replace-tab mark-verified / rename reserve / rename clear / verify persist **ask** version CAS; archive **asks** archive + safe-read; live prove **asks** get only). Already-recommended leftover `reporting.service.ts` (`prepareManualRunCore` **asks** get then leftover `refreshDestinationHealthAndDenylist` after leftover lineage). Leftover `reportingWorker.ts` (**asks** get for leftover `resolveDestinationForWorker` / leftover capacity / leftover promotion expected version; **asks** leftover health refresh after leftover operational-workbook allow — replace-tab and snapshot). Tests: `reportingDestination.test.ts` **asks** leftover `safeReportingDestinationForRead` (omits `drive_connection_id` / `created_by` / `updated_by`). `reportingDelivery.regressions.test.ts` **asks** leftover `casUpdateManagedSheetAfterPromotion` as typeof + `Number.NaN` throw only. `reporting.test.ts` does not import this file. **Does not name** `ReportingDestinationRecord` as an operation. **No runtime caller** for leftover `casUpdateManagedSheetAfterPromotion`.
- Seams callers need: load-the-row (`list` / `get`) vs remember-the-row (`insert`) vs cas-this-active-version (`updateReportingDestination` / `archiveReportingDestination`) vs keep-health-and-denylist-young-together (`refreshDestinationHealthAndDenylist`) vs hand-the-owner-a-credential-stripped-citation (`safeReportingDestinationForRead`) vs cas-the-managed-sheet-after-promotion (`casUpdateManagedSheetAfterPromotion`). The version-CAS / health-refresh **seam** exists because leftover rename reserve matches `expectedVersion` and leftover estimate must not bump that version when it only stamps health. The mongoose-version-CAS / native-sheet-id-CAS **seam** exists because leftover desk patches go through mongoose `findOneAndUpdate` (timestamps fire) and leftover promotion / leftover health refresh go through `ReportingDestination.collection` (they set `updated_at` themselves). The orphaned-promotion-helper / leftover-transaction-writer **seam** exists because leftover worker **asks** leftover `commitPromotionDestinationCas`, not this helper. There is no begin / complete Domain Command **seam**. There is no Google write **seam**. There is no destination-desk Drive **seam**. There is no Analytics **seam**. There is no Sheet Sync **seam**.
- Split later (only if the file outgrows one sitting): this ~170-line file is one sitting if you read it as remember the destination row, CAS the version we agreed to, keep health and denylist young together, hide the Drive connection. Do **not** split into `create.ts` / `update.ts` / `delete.ts`. Do **not** split into `list.ts` / `cas.ts` / `promotion.ts` so “each persist verb owns a file.” Do **not** pull leftover desk Drive work / leftover promotion transaction / leftover contract checksum here so “one destination file owns the company.” If it later splits: `casThisActiveDestinationVersion.ts` / `keepHealthAndDenylistYoungTogetherAfterALiveAllow.ts` only as later story files, never CRUD.

`listReportingDestinations` / `insertReportingDestination` / `updateReportingDestination` / `archiveReportingDestination` are executor mechanics. The owner question is: *I pointed reports at a Drive place. Remember that row. When two clicks race, only the one that still holds this version may write — leftover rename reserve, leftover mark-verified, leftover verify persist, leftover archive all share that match. After leftover estimate or leftover worker allows the destination live, stamp health and denylist together so one timestamp cannot age out alone — and do not bump the version, or leftover rename reservations would 409 after a harmless estimate. When I list destinations, hide the Drive connection and the actors; leftover contract may paint a checksum from the saved record without going live. After a successful replace-tab promotion, Mongo must still see the old immutable sheet id or the write misses. Do not preview. Do not freeze. Do not write Google. Do not talk to Drive.*

Leftover destination desk, leftover prove-this-destination, leftover keep-the-frozen-revision, leftover name-the-owner, leftover promotion reservation, leftover worker write already live in other **modules**. Do not pull those in.

## What this file actually does

Seven operations of one “remember the destination row, CAS the version we agreed to, keep health and denylist young together, hide the Drive connection” story, not “a destination CRUD repository,” and not leftover destination desk or leftover worker write:

1. **Load the destination rows we already remembered** — `listReportingDestinations` / `getReportingDestinationById`. List: optional `state`, newest `updated_at` then `_id`, default limit 50. Omitting `state` returns active **and** archived. Wave B list Zod defaults `state: "active"` before leftover desk **asks** list. Get: invalid ObjectId → `null`, not a throw. Leftover estimate and leftover worker **ask** get so leftover lineage can read `managed_tab.predecessor_sheet_ids` and leftover promotion can read `version`. Does not talk to Drive.

2. **Remember a destination row** — `insertReportingDestination`. First write. Caller supplies `version: 1` and the whole bag (snapshot already verified, or replace-tab still unverified). `ReportingDestination.create` then `toObject()`. Not a version CAS. If leftover desk’s later Google tab create throws, this unverified row is already in Mongo — leftover verify then 409s “incomplete.” Do not silently move insert after Google.

3. **CAS this exact active version** — `updateReportingDestination`. Match `{ _id, version: expectedVersion, state: "active" }`, `$set` the patch, `$inc` version. Miss → `null`. Leftover desk **asks** this four times: mark replace-tab verified at version `1`; reserve a rename (`access_status: "unverified"` + `mutation_pending`); clear the reservation after Google (`expectedVersion + 1`); persist leftover verify at the current version. Mongoose `findOneAndUpdate` so leftover schema timestamps stamp `updated_at`. This is not leftover `casUpdateManagedSheetAfterPromotion`.

4. **Keep health and denylist young together after a live allow** — `refreshDestinationHealthAndDenylist`. Match `{ _id, state: "active", access_status: "verified" }`. `$set` both instants + `updated_at`. **Does not `$inc` version.** Invalid ObjectId → `false`. Miss (archived / unverified / missing) → `false`. Leftover estimate **asks** this after leftover lineage accepts the live tab. Leftover worker **asks** this after leftover operational-workbook allow (replace-tab and snapshot). Native `collection.updateOne` — mongoose timestamps do not fire, so `updated_at` is set by hand. Does not write `updated_by`.

5. **Archive this exact active version** — `archiveReportingDestination`. Same version + active match as operation 3. `$set` `state: "archived"`, `access_status: "unhealthy"`, `updated_by`. `$inc` version. Miss → `null`. Leftover desk refuses archive while `mutation_pending` is set **before** **asking** this. Does not delete the Google folder, workbook, or tab.

6. **Hand the owner a credential-stripped citation** — `safeReportingDestinationForRead`. Copies provider / leftover owner snapshot / folder / strategy / workbook / managed tab / type / ownership / access / health / denylist / capacity / state / version / timestamps. **Omits** `drive_connection_id`, `created_by`, `updated_by`. Leftover `snapshotChecksumFromDestinationRecord` may paint `snapshot_checksum` when the saved row is active + verified and has the pieces leftover contract needs; otherwise omit, not throw. This is not leftover `buildValidatedDestinationSnapshot` and does not go live.

7. **CAS the managed sheet after a verified replace_tab promotion** — `casUpdateManagedSheetAfterPromotion`. Native `collection.findOneAndUpdate`: match active + `strategy: "replace_tab"` + `managed_tab.immutable_sheet_id === expectedOldSheetId`. `$set` next sheet id, published title, verified, both health instants, `updated_at`. `$addToSet` the old sheet onto `predecessor_sheet_ids`. `$inc` version. Unsafe integers throw `TypeError`. **No runtime caller.** Leftover worker **asks** leftover `commitPromotionDestinationCas` (same sheet-id match **plus** `expectedDestinationVersion`, inside a transaction with run completion and an already-advanced resume). Tests only prove typeof + `Number.NaN` throw. Do not start calling this from leftover worker so “one CAS owns the company.”

`ReportingDestinationRecord` is `Record<string, unknown>` — a bag, not an eighth owner operation.

## Organization

Keep one file. This is the screenplay for “remember the destination row, CAS the version we agreed to, keep health and denylist young together, hide the Drive connection.” Leftover desk Drive / rename reserve, leftover contract checksum / validate, leftover lineage read, leftover owner-email hash, leftover promotion transaction already live in deeper **modules**. Do not pull those in. Do not invent a `ReportingDestinationRepository` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second live **adapter** beside leftover `reportingDestinationPort.adapter.ts`. Do not invent a second checksum **adapter** beside leftover `snapshotChecksumFromDestinationRecord`. Do not invent a second promotion-transaction **adapter** beside leftover `commitPromotionDestinationCas`.

Do not split list / insert / CAS / archive into CRUD files. Version CAS and health refresh stay together because leftover estimate must not bump the version leftover rename reserve matches. Do not start checking `REPORTING_GOOGLE_DELIVERY_ENABLED`. Do not start talking to Drive.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `listReportingDestinations` | `listTheDestinationRowsWeAlreadyRemembered` | leftover desk list |
| `getReportingDestinationById` | `loadThisDestinationRow` | leftover desk / leftover estimate / leftover worker |
| `insertReportingDestination` | `rememberThisDestinationRow` | leftover desk create; first write |
| `updateReportingDestination` | `casThisActiveDestinationVersion` | leftover desk mark-verified / reserve / persist verify |
| `refreshDestinationHealthAndDenylist` | `keepHealthAndDenylistYoungTogetherAfterALiveAllow` | leftover estimate / leftover worker; no version bump |
| `archiveReportingDestination` | `archiveThisActiveDestinationVersion` | leftover desk archive |
| `safeReportingDestinationForRead` | `handTheOwnerACredentialStrippedCitation` | leftover desk HTTP; leftover contract may paint checksum |
| `casUpdateManagedSheetAfterPromotion` | `casTheManagedSheetAfterAVerifiedReplaceTabPromotion` | orphaned; leftover promotion reservation is the runtime writer |
| `ReportingDestinationRecord` | `SavedDestinationRow` | lean Mongo bag |

Keep the old names as one-line aliases until leftover `reportingDestination.service.ts`, leftover `reporting.service.ts`, leftover `reportingWorker.ts`, `reportingDestination.test.ts`, and `reportingDelivery.regressions.test.ts` migrate. Do not make leftover desk learn `updateReportingDestination` as “any destination patch” — the story is the version match. Do not make leftover estimate learn `casTheManagedSheetAfterAVerifiedReplaceTabPromotion` as the health refresh. Do not make leftover worker learn this file’s promotion helper as the runtime writer.

**No class for the workflow.** The leftover Stage-4 port class stays in leftover `reportingDestinationPort.adapter.ts`. The type that *does* earn a name is the owner citation:

```ts
type DestinationCitationForTheOwner = {
  // provider, hashed owner, folder, strategy, workbook?, managed_tab?,
  // access / health / denylist / capacity / state / version / timestamps
  // never drive_connection_id, never created_by, never updated_by
  snapshot_checksum?: string
}
```

That is the handoff from “Mongo still has the Drive connection and the actors” to “leftover desk may paint the Owner list.” Do **not** put leftover contract’s camelCase `ProvenDestinationSnapshot` on this type — leftover `citeThisSavedDestinationRecord` reads the snake_case row. Do **not** put `mutation_pending` on this citation — leftover safe-read already omits it.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// reportingDestinationRepository.ts
// The owner pointed reports at a Drive place.
// Remember that row.
// Two clicks may not share a version.
// After leftover estimate or leftover worker allows the destination live,
// stamp health and denylist together — and do not bump the version.
// When the owner lists destinations, hide the Drive connection and the actors.
// After a successful replace-tab promotion, Mongo must still see the old sheet
// or the write misses.
// Do not preview. Do not freeze. Do not write Google. Do not talk to Drive.

// ── 1. Load the destination rows we already remembered ───

export async function listTheDestinationRowsWeAlreadyRemembered(filter)
export async function loadThisDestinationRow(id) // null if missing or not an ObjectId

// ── 2. Remember a destination row ────────────────────────

export async function rememberThisDestinationRow(value) // first write; not a CAS

// ── 3. CAS this exact active version ─────────────────────

export async function casThisActiveDestinationVersion(id, expectedVersion, patch)
// null if version is stale or the row is not active

// ── 4. Keep health and denylist young together ───────────

export async function keepHealthAndDenylistYoungTogetherAfterALiveAllow(input)
// verified + active only; does not $inc version

// ── 5. Archive this exact active version ─────────────────

export async function archiveThisActiveDestinationVersion(id, expectedVersion, actor)

// ── 6. Hand the owner a credential-stripped citation ─────

export function handTheOwnerACredentialStrippedCitation(row)
// leftover contract may paint snapshot_checksum; omit credentials

// ── 7. CAS the managed sheet after a verified promotion ─

export async function casTheManagedSheetAfterAVerifiedReplaceTabPromotion(input)
// orphaned; leftover commitPromotionDestinationCas is the runtime writer
```

Read the leftover estimate path out loud: *load this destination row so leftover lineage can read the predecessor sheet IDs, accept the live tab for the frozen revision, then keep health and denylist young together after a live allow. Do not bump the version. Leftover confirm still binds leftover stable identity.*

Read the leftover rename reserve path out loud: *leftover desk already refused a pending mutation and a stale version. CAS this exact active version to unverified plus mutation_pending. Miss means another click already took the version. Google has not been called yet.*

That is the operation. `updateReportingDestination` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`updateReportingDestination` is a dump.** One version CAS serves leftover mark-verified, leftover rename reserve, leftover reservation clear, and leftover verify persist. The name says “any destination update.” Call it `casThisActiveDestinationVersion` and keep the patch argument. Do not invent four persist functions that only wrap `$set`.

2. **`casUpdateManagedSheetAfterPromotion` has no runtime caller.** Leftover worker **asks** leftover `commitPromotionDestinationCas`. The two `$set` / `$addToSet` / `$inc version` blocks are nearly the same, except leftover reservation also matches `expectedDestinationVersion` and runs in a transaction with run completion plus an already-advanced resume. Do not start calling this helper from leftover worker so “one CAS owns the company.” Do not delete it in this rename. Do not merge it into leftover `promotionReservation.ts`.

3. **This file’s promotion CAS does not match expected version.** Leftover `commitPromotionDestinationCas` does. Do not silently add `version: expectedDestinationVersion` to this helper so “the two writers match.” That would be a second, tested change.

4. **Health refresh must not `$inc` version.** If someone “fixes” it for consistency with leftover version CAS, leftover rename reserve and leftover verify CAS 409 after leftover estimate. The missing `$inc` is the **seam**. Do not add `updated_by` either — leftover estimate is not an owner patch.

5. **Two persist paths, two clocks.** Leftover version CAS / leftover archive go through mongoose `findOneAndUpdate` so leftover schema `timestamps` stamp `updated_at`. Leftover health refresh / leftover promotion CAS go through `ReportingDestination.collection` and set `updated_at` by hand. Do not “unify on mongoose” in this rename — native writes skip leftover timestamps.

6. **`_id` is a string on leftover version CAS and a `toObjectId` on leftover native writes.** Leftover mongoose path relies on cast. Leftover native path **asks** leftover `src/utils/objectId.ts`. Do not re-export a local `toObjectId`. Do not “fix” the string `_id` by constructing ObjectIds on leftover version CAS in the same pass.

7. **Leftover safe-read omits `mutation_pending`.** Leftover desk list / get will not show a pending rename reservation. Owners recover through leftover verify, not by reading the citation. Do not start copying `mutation_pending` onto leftover `DestinationCitationForTheOwner` so “the list tells the truth.”

8. **`ReportingDestinationRecord` lies.** It is `Record<string, unknown>`. Leftover desk already casts `workbook` / `managed_tab` / `mutation_pending` at the call site. Do not invent a full destination document type in this persist so “the repository owns the schema” — leftover Wave B model is the schema.

9. **Leave sibling modules alone.** Leftover `snapshotChecksumFromDestinationRecord`, leftover `commitPromotionDestinationCas`, leftover desk `renameTheManagedTabWithoutTwoOwnersColliding` are already the right **depth**. This file persists. It does not orchestrate Drive.

## Testing

The **interface** is the test surface: `listTheDestinationRowsWeAlreadyRemembered`, `loadThisDestinationRow`, `rememberThisDestinationRow`, `casThisActiveDestinationVersion`, `keepHealthAndDenylistYoungTogetherAfterALiveAllow`, `archiveThisActiveDestinationVersion`, `handTheOwnerACredentialStrippedCitation`, `casTheManagedSheetAfterAVerifiedReplaceTabPromotion`.

Today’s `reportingDestination.test.ts` **asks** leftover `handTheOwnerACredentialStrippedCitation` (omits `drive_connection_id` / actors). Keep that. Today’s `reportingDelivery.regressions.test.ts` **asks** leftover promotion helper as typeof + `Number.NaN` throw. Keep that throw. Replace the sibling-dump style with tests that name these persist operations (Mongo in `TEST_MODE`; do not boot leftover live Google; do not call leftover desk):

**Load / remember**
- List newest `updated_at`, default limit 50. Omitting `state` returns archived rows too. Wave B’s `state: "active"` default stays a route test.
- Get with a non-ObjectId → `null`.
- Insert returns the lean object leftover desk then safe-reads.

**CAS this exact active version**
- Happy path: match version `1` + active, `$inc` to `2`, patch lands.
- Stale version → `null` and the row is unchanged.
- Archived row → `null`.
- Two updates at the same `expectedVersion`: second returns `null` (this is leftover rename reserve’s fail-closed).

**Keep health and denylist young together**
- Verified + active: both instants and `updated_at` move; `version` is unchanged.
- Unverified or archived → `false` and no write.
- Invalid ObjectId → `false`.
- Do **not** assert leftover confirm still binds leftover stable identity here — that stays a leftover-reporting / leftover-contract test. This test only proves the version did not bump.

**Archive this exact active version**
- Active + matching version → `state: "archived"`, `access_status: "unhealthy"`, version ++.
- Miss → `null`. Does not delete Google (no Drive **adapter** in this file).

**Hand the owner a credential-stripped citation**
- Existing omit-credentials proof stays.
- Verified row with leftover contract’s pieces may include `snapshot_checksum`.
- Unverified row omits `snapshot_checksum` (leftover `citeThisSavedDestinationRecord` returns `null`).
- Still omits `mutation_pending`.

**CAS the managed sheet after a verified replace_tab promotion**
- Keep the `Number.NaN` / unsafe-integer throw.
- If a later implementer adds a Mongo proof: match the old immutable sheet id, `$addToSet` predecessor, next sheet becomes current, version ++. Already-advanced sheet (live already `nextSheetId`) → `null`. Do **not** start leftover `commitPromotionDestinationCas` inside this test.

Do **not** add a test per helper. There are no child helpers to unit-test. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** start leftover preview / leftover freeze / leftover desk Drive / leftover worker RAW write / leftover promotion transaction inside these tests. Leftover `pointReportsAtThisDrivePlace` stays a leftover-desk test. Leftover `validateDestinationSnapshot` stays a leftover-contract test. Leftover `commitPromotionDestinationCas` stays a leftover-promotion-reservation test.

## What I would not do

- A `ReportingDestinationRepository` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap leftover mongoose `find` / `create` / `findOneAndUpdate`.
- Moving the module into `create.ts` / `update.ts` / `delete.ts` or `list.ts` / `cas.ts` / `promotion.ts`.
- Breaking the version-CAS / health-refresh **seam** (leftover estimate must not `$inc` version).
- Breaking leftover desk’s reserve-before-Google **seam** by making leftover rename reserve skip this version match.
- Treating leftover destination desk / leftover prove-this-destination / leftover keep-the-frozen-revision / leftover name-the-owner / leftover promotion transaction / leftover worker write / leftover Analytics / leftover Sheet Sync as this story.
- Inventing a second promotion-transaction **seam** that has only one **adapter** beside leftover `commitPromotionDestinationCas`.
- Silently “fixing” the orphaned promotion helper, the missing version match on that helper, unused `mutation_pending` on leftover safe-read, string `_id` vs `toObjectId`, or the unverified-row-if-Google-throws gap while recommending a rename.
- Starting to check `REPORTING_GOOGLE_DELIVERY_ENABLED` inside this file.
- Jumping to `reportingDestinationPort.adapter.ts`’s leftover Stage-4 port — next pass is that module; do not pull it into this file. Do not jump to `ingestion` (or Wave B) while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `reporting`.
