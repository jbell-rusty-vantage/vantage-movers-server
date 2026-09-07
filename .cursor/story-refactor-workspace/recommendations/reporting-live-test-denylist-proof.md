# Prove The Connected Test Owner, Pick The Reserved Workbook's Actual Authorized Parent — Never Create An Unmarked Folder — Then Only Count OPERATIONAL_WORKBOOK From Official Destination Create — An Incomplete Denylist Is A Failed Proof, Not A Pass — operational story

- Status: recommended
- Service: `reporting` (Wave A, in-progress)
- Pass: 38 of this service — `live/liveTestDenylistProof.ts`
- Remaining in this service: `live/livePickerContractRunner.ts`, then remaining `live/*` harness
- Target: `src/services/reporting/live/liveTestDenylistProof.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (primary code is `reporting.service.ts`. Role: Owner-designed, checksum-bound reports. Happy path: preview → immutable revision → two-step confirmed run → **worker write**. Cron table names `/api/cron/reporting-delivery-heartbeat` (+ health-scan, cleanup, test-artifact janitor). Knowledge names volatile `denylistCheckedAt` on estimate checksum only. It never names this file, `proveDenylistBlocksProductionDestination`, `interpretDenylistProductionRejection`, `DENYLIST_PROOF_REJECTION_CODE`, `OPERATIONAL_WORKBOOK`, `DENYLIST_INCOMPLETE`, Picker-verified parent, or a live-test denylist proof — do not add a Reporting Service file in this rename so “the Service sentence wins”). Distinct from already-recommended live orchestration: [`reporting-live-google-orchestration.md`](reporting-live-google-orchestration.md) (that file **asks** this proof as step `denylist_rejection` after leftover refuse / leftover live-account-identity refuse / leftover principal / leftover export-root / leftover env apply; not ok → throw; later leftover replace-tab create uses leftover `createFolderName`, not this Picker path). Distinct from already-recommended leftover refuse / leftover principal: [`reporting-live-test-security.md`](reporting-live-test-security.md) (this file **asks** leftover reject only; leftover wrap **asks** leftover reject + leftover principal; this file never **asks** leftover live-account-identity refuse, leftover export-root, or leftover trash fence). Distinct from already-recommended leftover wrap: [`reporting-live-test-oauth-adapters.md`](reporting-live-test-oauth-adapters.md) (this file **asks** leftover prove-then-wrap and keeps leftover `driveApi` only). Distinct from already-recommended leftover destination desk: [`reporting-destination.md`](reporting-destination.md) (this file **asks** leftover `setReportingDestinationDeps` then leftover `createReportingDestination` replace-tab with leftover Picker references; leftover orchestration later **asks** leftover create-name). Distinct from already-recommended leftover reserved-workbook denylist: [`operational-workbooks-registry.md`](operational-workbooks-registry.md) (`evaluateReportingDestination` / leftover `assertConfigurationComplete`; `OPERATIONAL_WORKBOOK` vs `DENYLIST_INCOMPLETE`; leftover destination create **asks** leftover default `operationalWorkbookRegistry.assertConfigurationComplete`; leftover Picker **asks** leftover `getOperationalWorkbookRegistry()`). Distinct from already-recommended leftover Owner pick: [`google-drive-oauth-picker.md`](google-drive-oauth-picker.md) (leftover bootstrap / leftover verify / leftover consume; leftover spreadsheet verify and leftover consume **ask** leftover evaluate then **remap** leftover `BadRequestError` to leftover `picker_invalid_selection`; leftover `assertWorkbookNotDenylisted` keeps leftover `OPERATIONAL_WORKBOOK`). Distinct from already-recommended leftover Drive metadata get: [`google-drive-oauth-drive-metadata.md`](google-drive-oauth-drive-metadata.md) (this file **asks** leftover `fetchDriveFileMetadata` for leftover first parent). Distinct from already-recommended leftover official leftover janitor: [`reporting-cleanup.md`](reporting-cleanup.md) (never **asks** this file). Distinct from already-recommended leftover worker: [`reporting-reporting-worker.md`](reporting-reporting-worker.md) (pre-write leftover evaluate; leftover `DENYLIST_INCOMPLETE` emits leftover `emitReportingDenylistUnavailable`; this file never **asks** leftover worker). Distinct from already-skipped leftover env pin: `live/liveTestEnv.ts`. Distinct from already-recommended leftover stamp / leftover trash-the-set: [`reporting-live-test-cleanup.md`](reporting-live-test-cleanup.md) (this file never stamps and never `files.update`). Distinct from unvisited leftover picker contract: `live/livePickerContractRunner.ts` (leftover orchestration **asks** leftover picker contract after leftover replace-tab create; this file **asks** leftover bootstrap / leftover verify only). Distinct from unvisited leftover later janitor / leftover registry / leftover evaluate / leftover mask / leftover synthetic page / leftover retry wrapper. Distinct from Wave B `src/config/domain/reportingLiveTest.ts` (`REPORTING_LIVE_TEST_DENYLIST_WORKBOOK_ID`; leftover orchestration **asks** leftover `config.denylistWorkbookId`). Distinct from Wave B `scripts/reporting/run-live-google-harness.ts` (never imports this file). This is not Admin Analytics and not Sheet Sync. This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR). <!-- pragma: allowlist secret -->
- Callers: already-recommended `live/liveGoogleOrchestration.ts` (**asks** leftover `proveDenylistBlocksProductionDestination` with leftover `config.denylistWorkbookId`, leftover `runTag`, leftover `HARNESS_ACTOR`; leftover `ok: false` → throw leftover `denylistProof.detail`). No other `src/` import. Tests: `live/liveTestReleaseSafety.test.ts` **asks** leftover `interpretDenylistProductionRejection` only (`OPERATIONAL_WORKBOOK` pass / leftover `DENYLIST_INCOMPLETE` fail / leftover other code fail). That test file also **asks** leftover registry binding, leftover picker parent mismatch, leftover env snapshot — those are sibling **interfaces**. `live/liveGoogleHarness.test.ts` / `live/liveTestSecurity.test.ts` / `reporting.test.ts` / `reportingDestination.test.ts` do not import this file. Leftover destination tests prove leftover evaluate codes on a **fresh** leftover registry, not this proof. Owner HTTP destination create never **asks** this file. **No HTTP route** mounts this file. <!-- pragma: allowlist secret -->
- Seams callers need: decide-whether-official-create-refused-because-this-workbook-is-reserved (`interpretDenylistProductionRejection`) vs prove-the-reserved-workbook-cannot-become-an-official-destination (`proveDenylistBlocksProductionDestination`). The leftover interpret / leftover prove **seam** exists because leftover orchestration only **asks** leftover prove; leftover tests only **ask** leftover interpret. The leftover this-file-create / leftover destination-desk **seam** exists because leftover prove **asks** leftover `createReportingDestination` after leftover inject; leftover unexpected success is leftover `ok: false`, not leftover archive. The leftover this-file-picker-verify / leftover picker-remap **seam** exists because leftover spreadsheet leftover verify and leftover consume **ask** leftover evaluate then remap leftover `OPERATIONAL_WORKBOOK` / leftover `DENYLIST_INCOMPLETE` to leftover `picker_invalid_selection` **before** leftover `assertWorkbookNotDenylisted` can throw leftover `OPERATIONAL_WORKBOOK`. The leftover `OPERATIONAL_WORKBOOK` / leftover `DENYLIST_INCOMPLETE` **seam** exists because leftover interpret treats leftover reserved-id refuse as leftover pass and leftover incomplete list as leftover failed proof. The leftover this-file-inject / leftover destination-deps **seam** exists because leftover prove **asks** leftover `setReportingDestinationDeps({ driveClient })` and leftover `finally` restores leftover `{}`. The leftover this-file-reject / leftover wrap-reject **seam** exists because leftover prove **asks** leftover reject, then leftover wrap **asks** leftover reject + leftover principal. The leftover Picker-parent / leftover create-name **seam** exists because this file **asks** leftover actual leftover `parentFolderIds[0]` and never leftover `createFolderName`. There is no begin / complete Domain Command **seam**. There is no leftover worker **seam**. There is no leftover `files.update` `{ trashed: true }` **seam**. There is no Analytics **seam**. There is no Sheet Sync **seam**. <!-- pragma: allowlist secret -->
- Split later (only if the file outgrows one sitting): this ~120-line file is one sitting if you read it as prove the connected test owner, pick the reserved workbook’s actual authorized parent — never create an unmarked folder — then only count `OPERATIONAL_WORKBOOK` from official destination create; an incomplete denylist is a failed proof, not a pass. Do **not** split into `interpret.ts` / `prove.ts` / `create.ts` / `update.ts` / `delete.ts`. Do **not** pull leftover orchestration, leftover refuse, leftover wrap, leftover destination desk, leftover reserved-workbook denylist, leftover Owner pick, leftover picker contract, leftover official leftover janitor, or leftover worker here so “one denylist file owns the company.” If it later splits: `decideWhetherOfficialCreateRefusedBecauseThisWorkbookIsReserved.ts` / `proveTheReservedWorkbookCannotBecomeAnOfficialDestination.ts` only as later story files, never CRUD.

`proveDenylistBlocksProductionDestination` / `interpretDenylistProductionRejection` / `DENYLIST_PROOF_REJECTION_CODE` are executor mechanics. The owner question is: *Live Google testing must prove a reserved operational workbook cannot become an official reporting destination. Prove the connected test owner. Do not use the company service account. Pick the reserved workbook’s actual authorized parent — never create an unmarked folder for the proof. Then official destination create must refuse with `OPERATIONAL_WORKBOOK`. An incomplete reserved list is a failed proof, not a pass. If create unexpectedly succeeds, the proof failed — and that path already wrote a destination onto the reserved book. Do not start leftover worker. Do not trash a folder from this file. Do not hit HTTP. Do not sync the Master Sheet.* <!-- pragma: allowlist secret -->

Already-recommended leftover orchestration, leftover refuse / leftover principal, leftover wrap, leftover destination desk, leftover reserved-workbook denylist, leftover Owner pick, leftover Drive metadata get, leftover official leftover janitor, leftover worker already live in other **modules**. Leftover picker contract, leftover later janitor, leftover registry, leftover mask, leftover synthetic page stay sibling **modules**. Do not pull those in.

## What this file actually does

Two operations of one “prove the connected test owner, pick the reserved workbook’s actual authorized parent, then only count `OPERATIONAL_WORKBOOK` from official destination create — an incomplete denylist is a failed proof” story, not “a denylist CRUD helper,” and not leftover destination desk / leftover reserved-workbook denylist / leftover Owner pick:

1. **Decide whether official create refused because this workbook is reserved** — `interpretDenylistProductionRejection`. Not leftover `BadRequestError` → rethrow. Leftover `metadata.code === "DENYLIST_INCOMPLETE"` → leftover `{ ok: false, rejectionCode, detail }`. Leftover code !== leftover `DENYLIST_PROOF_REJECTION_CODE` (`"OPERATIONAL_WORKBOOK"`) → leftover `{ ok: false, rejectionCode: code ?? "destination_rejected", detail }`. Leftover reserved-id refuse → leftover `{ ok: true, rejectionCode: "OPERATIONAL_WORKBOOK", detail }`. Leftover prove **asks** this **seam** only inside leftover create leftover catch. Leftover `liveTestReleaseSafety.test.ts` **asks** this **seam**. Leftover orchestration never **asks** this **seam** directly. <!-- pragma: allowlist secret -->

2. **Prove the reserved workbook cannot become an official destination** — `proveDenylistBlocksProductionDestination`. **Asks** leftover `rejectServiceAccountCredentialsForLiveTest`. **Asks** leftover `createLiveTestGoogleAdapters` and keeps leftover `driveApi` only. Builds leftover `driveClient.getFileMetadata` as leftover `fetchDriveFileMetadata(driveApi, fileId)`. **Asks** leftover `setReportingDestinationDeps({ driveClient })`. Leftover `finally` restores leftover `{}`. Leftover `getFileMetadata(denylistWorkbookId)` leftover first parent missing → leftover `{ ok: false, detail: "Denylist workbook has no parent folder for picker verification." }` with no leftover Picker. Else leftover `bootstrapGooglePicker("folder")` + leftover `verifyGooglePickerSelection` on leftover first parent. Then leftover `bootstrapGooglePicker("spreadsheet")` + leftover `verifyGooglePickerSelection` on leftover reserved workbook + leftover `parentFolderId`. Then leftover inner try leftover `createReportingDestination` `{ strategy: "replace_tab", folderSelectionReference, workbookSelectionReference, managedTabName: "Denylist Proof Tab" }` with leftover `actor`. Leftover unexpected success → leftover `{ ok: false, detail: "createReportingDestination unexpectedly succeeded." }`. Leftover catch **asks** leftover interpret; leftover interpret leftover `ok` → leftover `assert.equal` leftover `OPERATIONAL_WORKBOOK`; return leftover interpreted. Leftover `runTag` is accepted and never read. Leftover orchestration **asks** this **seam**. <!-- pragma: allowlist secret -->

`DenylistProductionProofResult` / leftover `DENYLIST_PROOF_REJECTION_CODE` are the leftover bag leftover orchestration already branches on, not extra owner operations. <!-- pragma: allowlist secret -->

## Organization

Keep one file. This is the screenplay for “prove the connected test owner, pick the reserved workbook’s actual authorized parent, then only count `OPERATIONAL_WORKBOOK` from official destination create.” Leftover orchestration, leftover refuse / leftover principal, leftover wrap, leftover destination desk, leftover reserved-workbook denylist, leftover Owner pick, leftover Drive metadata get already live in deeper **modules**. Do not pull those in. Do not invent a `LiveTestDenylistProofService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second leftover evaluate **adapter** beside leftover `evaluateReportingDestination`. Do not invent a second leftover destination-create **adapter** beside leftover `createReportingDestination`. Do not invent a second leftover Picker **adapter** beside leftover bootstrap / leftover verify.

Do not split leftover interpret / leftover prove into CRUD files. Leftover prove stays with leftover interpret because leftover prove **asks** leftover interpret after leftover create. Do not move leftover evaluate here so “the proof owns the denylist.” Do not move leftover `assertWorkbookNotDenylisted` here so “the proof owns the throw.” Do not start leftover `createFolderName` from this file so “the proof can mint a parent.” Do not start leftover worker from this file so “one harness file owns Google.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `interpretDenylistProductionRejection` | `decideWhetherOfficialCreateRefusedBecauseThisWorkbookIsReserved` | leftover prove leftover catch + leftover interpret test | <!-- pragma: allowlist secret -->
| `proveDenylistBlocksProductionDestination` | `proveTheReservedWorkbookCannotBecomeAnOfficialDestination` | leftover orchestration leftover `denylist_rejection` | <!-- pragma: allowlist secret -->
| `DENYLIST_PROOF_REJECTION_CODE` | `ReservedWorkbookRefuseCode` | leftover interpret + leftover interpret test |

Keep leftover `DenylistProductionProofResult` until leftover orchestration migrates. Keep the old names as one-line aliases until leftover `liveGoogleOrchestration.ts` / leftover `liveTestReleaseSafety.test.ts` migrate. Do not make leftover Wave B leftover destination desk learn leftover `proveTheReservedWorkbookCannotBecomeAnOfficialDestination`. Do not persist a new leftover harness marker version in this rename. <!-- pragma: allowlist secret -->

**No class for the workflow.** The type that *does* earn a name is the leftover bag leftover orchestration already destructures:

```ts
type LiveTestDenylistProofWeMayReturn = {
  ok: boolean
  rejectionCode?: string
  detail?: string
}
```

That is the handoff from “leftover official create refused, or leftover Picker / leftover create lied” to “leftover orchestration may continue leftover replace-tab create-name.” Do **not** put leftover `ZZ1` / leftover `ZY1` on this type. Do **not** put leftover `createFolderName` on this type. Do **not** put leftover `trashed: true` on this type.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// liveTestDenylistProof.ts
// Live Google testing must prove a reserved operational
// workbook cannot become an official reporting destination.
// Prove the connected test owner.
// Do not use the company service account.
// Pick the reserved workbook's actual authorized parent —
// never create an unmarked folder for the proof.
// Then official destination create must refuse
// with OPERATIONAL_WORKBOOK.
// An incomplete reserved list is a failed proof, not a pass.
// If create unexpectedly succeeds, the proof failed.
// Do not start leftover worker.
// Do not trash a folder from this file.

// ── 1. Decide whether official create refused because reserved ─

export function decideWhetherOfficialCreateRefusedBecauseThisWorkbookIsReserved(error)
  // not BadRequestError → rethrow
  // DENYLIST_INCOMPLETE → ok: false
  // other code → ok: false (code ?? "destination_rejected")
  // OPERATIONAL_WORKBOOK → ok: true
export const interpretDenylistProductionRejection = <!-- pragma: allowlist secret -->
  decideWhetherOfficialCreateRefusedBecauseThisWorkbookIsReserved
export const DENYLIST_PROOF_REJECTION_CODE = "OPERATIONAL_WORKBOOK"

// ── 2. Prove the reserved workbook cannot become a destination ─

export async function proveTheReservedWorkbookCannotBecomeAnOfficialDestination(input)
  // refuseAServiceAccountForLiveGoogleTests
  // proveTheConnectedTestOwnerThenWrapThoseAdapters — keep driveApi
  // inject leftover fetchDriveFileMetadata as leftover destination driveClient
  // finally restore leftover destination deps to {}
  // leftover first parent missing → ok: false, no leftover Picker
  // leftover bootstrap + leftover verify leftover folder
  // leftover bootstrap + leftover verify leftover reserved workbook
  // leftover createReportingDestination replace-tab leftover Picker refs
  // leftover unexpected success → ok: false
  // leftover catch → decideWhetherOfficialCreateRefusedBecauseThisWorkbookIsReserved
  // leftover runTag is accepted and never read
export const proveDenylistBlocksProductionDestination = <!-- pragma: allowlist secret -->
  proveTheReservedWorkbookCannotBecomeAnOfficialDestination
```

Read the primary path out loud: *Refuse a service account. Prove the connected test owner and wrap that OAuth client as Drive. Inject that metadata client into leftover destination desk. Read the reserved workbook’s actual first parent. Pick that folder. Pick that workbook. Then leftover official create must refuse with `OPERATIONAL_WORKBOOK`. An incomplete reserved list is a failed proof. If leftover Picker remaps the refuse to `picker_invalid_selection` before leftover create, leftover interpret never sees leftover `OPERATIONAL_WORKBOOK`. If leftover create unexpectedly succeeds, a destination and leftover “Denylist Proof Tab” already landed on the reserved book. Restore leftover destination deps. Never create an unmarked folder. Never start leftover worker.*

That is the operation. `proveDenylistBlocksProductionDestination` is not. <!-- pragma: allowlist secret -->

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Leftover Picker remaps leftover `OPERATIONAL_WORKBOOK` before leftover interpret can pass.** Leftover spreadsheet leftover verify **asks** leftover `validatePickerSelectionMetadata`, which **asks** leftover evaluate and throws leftover `BadRequestError` leftover `OPERATIONAL_WORKBOOK`. Leftover verify leftover catch remaps that to leftover `picker_invalid_selection`. That throw sits **outside** leftover prove’s leftover inner leftover create leftover catch, so leftover interpret never runs and leftover orchestration sees an uncaught leftover `picker_invalid_selection`. Leftover consume does the same remap before leftover `assertWorkbookNotDenylisted`. Rename the leftover verify / leftover consume remap so leftover “only count leftover `OPERATIONAL_WORKBOOK` from leftover create” is visible. Do not silently unwrap leftover Picker remap in leftover verify so “the proof can pass” — leftover Owner pick already named consume-after-validate. Do not silently move leftover interpret around leftover verify so “any leftover `BadRequestError` counts.”

2. **Leftover `assertWorkbookNotDenylisted` is unreachable on this Picker path when leftover denylist works.** Leftover create leftover consume leftover spreadsheet leftover evaluate leftover remaps first. Leftover `assertWorkbookNotDenylisted` is the only leftover throw that keeps leftover `OPERATIONAL_WORKBOOK`. Rename that gap. Do not silently skip leftover Picker leftover evaluate so “leftover create can throw the code leftover interpret wants” — leftover Owner pick leftover spreadsheet leftover evaluate is load-bearing.

3. **Leftover unexpected success already wrote the reserved book.** Leftover `createReportingDestination` leftover insert leftover unverified leftover destination **before** leftover managed-tab leftover create. Leftover prove then returns leftover `ok: false` and does **not** leftover archive. Rename the leftover write-then-fail. Do not silently leftover archive on leftover unexpected success so “the proof cleans up” without a paired leftover test.

4. **Leftover `runTag` is a lie.** Leftover prove accepts leftover `runTag` and never reads it. Leftover orchestration still passes leftover `runTag`. Rename the unused argument. Do not silently stamp leftover “Denylist Proof Tab” with leftover `runTag` so “the parameter starts working.”

5. **Leftover `DENYLIST_INCOMPLETE` is a failed proof, leftover `assertConfigurationComplete` is an uncaught throw.** Leftover interpret leftover `ok: false` on leftover `DENYLIST_INCOMPLETE`. Leftover create leftover first **asks** leftover default leftover `operationalWorkbookRegistry.assertConfigurationComplete()`, which throws leftover `OperationalWorkbookConfigurationError` (not leftover `BadRequestError`). Leftover interpret leftover rethrows. Leftover Picker leftover evaluate leftover remaps leftover `DENYLIST_INCOMPLETE` to leftover `picker_invalid_selection` earlier. Already named leftover default vs leftover `getOperationalWorkbookRegistry()` on leftover reserved-workbook denylist. Do not silently catch leftover `OperationalWorkbookConfigurationError` so “incomplete is always leftover interpret.”

6. **Leftover reject runs twice, leftover principal once, leftover live-account-identity never.** Leftover prove **asks** leftover reject, then leftover wrap **asks** leftover reject + leftover principal. Leftover orchestration already **asked** leftover reject / leftover live-account-identity / leftover principal / leftover export-root before leftover prove. Rename the leftover pile-up. Do not silently drop leftover inner leftover reject so “callers own leftover refuse.” Do not silently add leftover live-account-identity refuse here so “every leftover live path separates identity.”

7. **Leftover first parent only.** A reserved workbook whose leftover `parentFolderIds[0]` is missing fails before leftover Picker. Leftover other parents are never walked. Leftover picker leftover parent-mismatch test already locks leftover expected parent before leftover denylist. Do not silently walk leftover other parents so “any parent counts.”

8. **Leftover inject is process-global.** Leftover `setReportingDestinationDeps` leftover mutates leftover destination leftover module state. Leftover `finally` restores leftover `{}`. Concurrent leftover destination HTTP would see leftover injected leftover `driveClient`. Rename the leftover process-global leftover inject. Do not silently thread leftover `driveClient` as leftover create leftover argument so “the proof owns leftover destination” without a paired leftover test.

9. **No test **asks** leftover prove.** Leftover `liveTestReleaseSafety.test.ts` leftover interpret only. Leftover picker leftover parent mismatch leftover **asks** leftover `validatePickerSelectionReferenceMetadata`, not this file. That is not enough for a story that leftover bootstraps leftover Picker and leftover **asks** leftover official create against a reserved book.

10. **Leave sibling modules alone.** Leftover `createReportingDestination`, leftover `assertWorkbookNotDenylisted`, leftover `evaluateReportingDestination`, leftover `bootstrapGooglePicker`, leftover `createLiveTestGoogleAdapters`, leftover `rejectServiceAccountCredentialsForLiveTest`, and leftover `runLivePickerServerContractTests` are already the right **depth**. This file leftover picks leftover actual leftover parent and leftover interprets leftover official leftover create.

## Testing

The **interface** is the test surface: `decideWhetherOfficialCreateRefusedBecauseThisWorkbookIsReserved`, `proveTheReservedWorkbookCannotBecomeAnOfficialDestination` (today `interpretDenylistProductionRejection` / `proveDenylistBlocksProductionDestination`). <!-- pragma: allowlist secret -->

Today `liveTestReleaseSafety.test.ts` leftover proves leftover interpret leftover `OPERATIONAL_WORKBOOK` leftover pass / leftover `DENYLIST_INCOMPLETE` leftover fail / leftover other leftover code leftover fail. It does **not** leftover **ask** leftover prove. That is not enough for a story that leftover **asks** leftover official leftover create.

Replace the missing coverage with tests that name the operation. Use `TEST_MODE`. Do not boot live Google.

**Interpret**
- Leftover `OPERATIONAL_WORKBOOK` leftover `ok: true`.
- Leftover `DENYLIST_INCOMPLETE` leftover `ok: false`.
- Leftover `picker_invalid_selection` leftover `ok: false` (leftover remap is leftover failed proof today).
- Leftover non-`BadRequestError` leftover rethrows.

**Prove**
- Leftover missing leftover first parent leftover returns leftover `ok: false` and never leftover bootstrap.
- Leftover spreadsheet leftover verify leftover remapped leftover `picker_invalid_selection` leftover escapes leftover interpret (name the leftover uncaught leftover remap). Do not silently leftover wrap leftover verify in leftover interpret in this rename.
- Leftover create leftover `OPERATIONAL_WORKBOOK` leftover returns leftover `ok: true` when leftover create leftover throw leftover reaches leftover interpret.
- Leftover unexpected leftover create leftover success leftover returns leftover `ok: false` and leftover does **not** leftover archive.
- Leftover `runTag` may be leftover `"unused"` and leftover prove leftover still leftover runs.
- Leftover `finally` leftover restores leftover destination leftover deps even leftover when leftover verify leftover throws.
- Leftover worker / leftover `createFolderName` / leftover `files.update` `{ trashed: true }` are not **asked**.

Do **not** add a test per helper (the leftover `driveClient` leftover wrapper, leftover `assert.equal`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** boot leftover official leftover janitor, leftover worker, leftover queue publish, Analytics, or Sheet Sync inside these tests. Leftover evaluate leftover codes stay leftover `reportingDestination.test.ts` / leftover `registry.test.ts`. Leftover Picker leftover remap stays leftover `pickerVerification.test.ts`. Live Google stays `pnpm reporting:live-google-harness`.

## What I would not do

- I would not implement this pass.
- I would not rewrite recommendations/form-lead.md.
- I would not edit src/, tests, routes, models, or docs/knowledge/.
- I would not invent a CONTEXT.md term or an ADR. CONTEXT.md does not define Reporting.
- I would not open Wave B (`src/config/domain/reportingLiveTest.ts`, `src/routes/reporting.routes.ts`, `scripts/reporting/run-live-google-harness.ts`).
- I would not write a whole-folder Reporting recommendation.
- I would not introduce a `LiveTestDenylistProofService` class or a `interpret.ts` / `prove.ts` / `create.ts` / `update.ts` / `delete.ts` split.
- I would not invent a second leftover evaluate **adapter** beside leftover `evaluateReportingDestination`.
- I would not invent a second leftover destination-create **adapter** beside leftover `createReportingDestination`.
- I would not silently unwrap leftover Picker leftover remap so “leftover interpret can pass.”
- I would not silently leftover archive leftover unexpected leftover create leftover success.
- I would not silently start leftover reading leftover `runTag`.
- I would not silently leftover catch leftover `OperationalWorkbookConfigurationError` so “incomplete is always leftover interpret.”
- I would not silently leftover merge this file with leftover `livePickerContractRunner.ts` or leftover `reportingDestination.service.ts`.
- I would not silently leftover start leftover `createFolderName` from this file.
- I would not open `live/livePickerContractRunner.ts` while this checklist still has unchecked modules after this row.
- I would not silently reorder ADR-known side effects.
