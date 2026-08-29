# Refuse This Spreadsheet As A Reporting Destination If It Is Already Reserved For Sheet Sync Or Best Relocation Ingest, And If The Live Host Cannot See Every Required Reserved ID Refuse Every Destination Until The List Is Complete; Mask IDs So Inspect And Logs Never Leak The Full String — Never Choose A Destination, Never Write A Cell, Never Ingest Best Relocation, Never Drain Sheet Sync — operational story

- Status: recommended
- Service: `operationalWorkbooks` (Wave A, visited after this pass)
- Pass: 1 of this service — `registry.ts`
- Remaining in this service: none — `registrations.ts` skipped (env catalog), `index.ts` skipped (default registry)
- Target: `src/services/operationalWorkbooks/registry.ts`
- Knowledge: none for this folder. Closest: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (Owner-gated destinations and Google workbooks as a **delivery surface** — it names leftover `reportingDestination.service.ts` / leftover `reportingWorker.ts` and “destination port safety / checksum drift, fail closed”; it never names this file). Distinct from leftover destination: `reporting/reportingDestination.service.ts` (create / update / verify / `buildValidatedDestinationSnapshot` **ask** `operationalWorkbookRegistry.assertConfigurationComplete`; replace-tab create / update / verify also **ask** already-recommended `assertWorkbookNotDenylisted`; the snapshot **asks** `evaluateReportingDestination` and remaps any refuse to generic `destination_unsafe`; snapshot-folder destinations skip evaluate). Distinct from leftover worker: `reporting/reportingWorker.ts` (pre-write **asks** assert; replace-tab **asks** evaluate; `DENYLIST_INCOMPLETE` emits leftover `emitReportingDenylistUnavailable`, then `DESTINATION_UNSAFE`; snapshot-folder still asserts). Distinct from Wave B health cron: `routes/reporting-cron.routes.ts` (**asks** assert; `OperationalWorkbookConfigurationError` → `denylistIncomplete` + `missing_registration_keys`). Distinct from already-recommended Owner Picker: [recommendations/google-drive-oauth-picker.md](google-drive-oauth-picker.md) (`validatePickerSelectionMetadata` / `validatePickerSelectionReferenceMetadata` / `assertWorkbookNotDenylisted` **ask** `getOperationalWorkbookRegistry().evaluateReportingDestination` and surface `safe_message` + `code`; leftover destination **asks** that already-recommended refuse without a full re-prove). Distinct from leftover env catalog: `registrations.ts` (Master Leads / Master Booked required; per-source Sheet Sync optional; two Best Relocation ingest IDs required; `BEST_RELOCATION_STAGE_2_REGISTRATION_CHECKLIST` is unused). Distinct from leftover default registry: `index.ts` (`createOperationalWorkbookRegistry({ registrations: CURRENT_OPERATIONAL_WORKBOOK_REGISTRATIONS })`; `operationalWorkbookRegistry` is always that default; `getOperationalWorkbookRegistry` honors `setOperationalWorkbookRegistryForTests`). Distinct from Wave B name book: `config/domain/sheets.ts` (env-var **names** only; never reads `process.env`). Distinct from Wave B Sheet Sync runtime: `config/domain/runtime.ts` (`TEST_` prefix when `isTestMode()` — this file does **not** ask that fold; leftover catalog stores the unprefixed `MASTER_*` / `TBM_*` keys). Distinct from already-recommended name-the-destinations: [recommendations/google-sheets-targets.md](google-sheets-targets.md) (Master first, source sheet only when the flag is on — that file **writes**; this file **refuses**). Distinct from already-recommended Sheet Sync coordinator / drain (those files project onto the reserved IDs; they do not ask this denylist). Distinct from leftover Best Relocation inspect: `bestRelocationSheetIngest/provider.ts` (**asks** `maskSpreadsheetId` only). Distinct from Wave B ingest inspect: `routes/ingestion.routes.ts` (same mask). Distinct from leftover live denylist proof: `reporting/live/liveTestDenylistProof.ts` (Picker + leftover create must fail with `OPERATIONAL_WORKBOOK`; `DENYLIST_INCOMPLETE` is a failed proof, not a pass). Distinct from leftover reporting observability: `emitReportingDenylistUnavailable` (later Wave A `observability` persist). Distinct from already-recommended managed tab / Drive metadata (ownership marker and live file proof — this file never talks to Drive). Distinct from later Wave A `reporting` / `ingestion` / `bestRelocationSheetIngest` / `ringcentral` (do not open those folders here). This checkout’s `CONTEXT.md` does not define an operational workbook / denylist term — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: **six runtime import sites, plus the folder test and three leftover reporting / Picker tests.** Leftover destination: `reportingDestination.service.ts` — `operationalWorkbookRegistry` (the default export, **not** `getOperationalWorkbookRegistry`). Leftover worker: `reportingWorker.ts` — same default. Wave B reporting health cron — same default + `OperationalWorkbookConfigurationError`. Already-recommended Picker: `picker.service.ts` — `getOperationalWorkbookRegistry()`. Leftover BR inspect + Wave B ingest inspect — `maskSpreadsheetId` only. Tests: `registry.test.ts` locks URL-or-raw refuse, live fail-closed, mask, compose-without-mutate, and leftover catalog’s two required BR rows. Leftover `reportingDestination.test.ts` / `reportingDelivery.test.ts` construct a **fresh** registry (not the process default). Already-recommended `pickerVerification.test.ts` is the one caller of `setOperationalWorkbookRegistryForTests`. Not this **interface**: leftover destination `destination_unsafe` remap, leftover worker `DESTINATION_UNSAFE`, Wave B 200 health JSON, already-recommended Picker `BadRequestError`, leftover live proof, leftover `emitReportingDenylistUnavailable`, Wave B `TEST_` prefix, already-recommended Sheet Sync write.
- Seams callers need: structured evaluate (`allowed` / `OPERATIONAL_WORKBOOK` / `DENYLIST_INCOMPLETE` / `INVALID_SPREADSHEET_ID`) vs throwing assert; default process registry vs `getOperationalWorkbookRegistry` test override; live required-ID fail-closed vs optional source-lead miss; raw env_key vs Wave B `TEST_` prefix (do not silently join them); mask for inspect vs full ID inside evaluate
- Split later (only if the file outgrows one sitting): this ~180-line file is one sitting if you read it as refuse this spreadsheet as a reporting destination if it is already reserved for Sheet Sync or Best Relocation ingest, and if live cannot see every required reserved ID refuse every destination until the list is complete; mask IDs so inspect and logs never leak the full string; never choose a destination, never write a cell, never ingest Best Relocation, never drain Sheet Sync. If it later splits: `refuseThisSpreadsheetAsAReportingDestinationIfItIsReservedOrTheReservedListIsIncomplete.ts` / `failClosedWhenARequiredLiveOperationalWorkbookIdIsMissing.ts` / `maskASpreadsheetIdSoInspectAndLogsDoNotLeakIt.ts` — story files, never `create.ts` / `get.ts` / `update.ts` / `delete.ts` / `evaluate.ts`, and never merge leftover destination, leftover worker, already-recommended Picker, leftover `registrations.ts`, leftover `index.ts`, Wave B `sheets.ts` / `runtime.ts`, or already-recommended `targets.ts` into this file

`createOperationalWorkbookRegistry` / `evaluateReportingDestination` / `assertConfigurationComplete` / `listResolved` are executor mechanics. The owner question is: *Reporting may write only onto a workbook the Owner picked. Master Leads, Master Booked, the Source Company Sheet Sync books, and the two Best Relocation ingest books are already reserved for live operations. If the candidate ID matches a reserved ID, refuse. If we are on the live host and a required reserved env is missing or not a spreadsheet ID, refuse every candidate — an incomplete denylist is not a denylist. Mask the ID when inspect or logs speak. Do not pick a reporting folder. Do not write a cell. Do not ingest Best Relocation. Do not drain Sheet Sync. Do not invent the Owner Drive token.*

Leftover destination, leftover worker, already-recommended Picker, leftover catalog, leftover default registry, Wave B name book, Wave B `TEST_` runtime, already-recommended Sheet Sync write, leftover BR inspect, and leftover denylist events already live in other **modules**. Do not pull those in.

## What this file actually does

Three operations of one “refuse this spreadsheet as a reporting destination if it is already reserved for Sheet Sync or Best Relocation ingest, and if live cannot see every required reserved ID refuse every destination until the list is complete; mask IDs so inspect and logs never leak the full string — never choose a destination, never write a cell, never ingest Best Relocation, never drain Sheet Sync” story, not “a workbook CRUD registry,” and not leftover destination / leftover worker / already-recommended Picker:

1. **Refuse this spreadsheet as a reporting destination if it is reserved or the reserved list is incomplete** — `evaluateReportingDestination(spreadsheetId)`. Trim / URL-extract / 20+ `[A-Za-z0-9_-]` via `normalizeSpreadsheetId`. Not a spreadsheet ID → `{ allowed: false, code: "INVALID_SPREADSHEET_ID" }`. Else resolve the injected registrations against the injected env (or `process.env`): empty / invalid ID is a miss; a valid ID becomes `{ ...registration, spreadsheet_id }`. If the live-host flag is on and any leftover-catalog live-required registration missed → `{ allowed: false, code: "DENYLIST_INCOMPLETE" }` **even when the candidate is not reserved**. Else if a resolved ID equals the candidate → `{ allowed: false, code: "OPERATIONAL_WORKBOOK", matched_registration_key }`. Else `{ allowed: true }`. This beat does **not** throw. This beat does **not** talk to Drive. This beat does **not** write a reporting destination. Already-recommended Picker surfaces `safe_message` + `code`. Leftover destination snapshot remaps any refuse to `destination_unsafe`. Leftover worker maps refuse to `DESTINATION_UNSAFE` and only `DENYLIST_INCOMPLETE` emits leftover `emitReportingDenylistUnavailable`.

2. **Fail closed when a required live operational workbook ID is missing** — `assertConfigurationComplete()`. Same resolve. If live missing keys exist, throw `OperationalWorkbookConfigurationError` (`code: "DENYLIST_INCOMPLETE"`, `missing_registration_keys`). Non-live missing required keys are not missing. Optional source-lead misses never throw. Leftover destination calls this **before** create / update / verify / snapshot. Leftover worker calls this **before** evaluate, including snapshot-folder runs that have no workbook id. Wave B health cron catches the error and names the keys. This beat does **not** evaluate a candidate. This beat does **not** emit the leftover denylist event — leftover worker / leftover observability do.

3. **Mask a spreadsheet ID so inspect and logs do not leak it** — `maskSpreadsheetId(value)`. Same normalize. Invalid → `"[invalid]"`. Length ≤ 8 → `"********"`. Else first four + `…` + last four. Leftover BR inspect and Wave B ingest inspect are the runtime callers. Evaluate and assert speak the full ID only in memory; they do not mask. This beat does **not** refuse a destination.

There is no choose-destination operation. There is no Sheet Sync write operation. There is no Best Relocation ingest operation. There is no Drive / Picker operation. Leftover `createReportingDestination` still picks the folder. Already-recommended `getLeadTargets` still names Master first. Leftover BR inspect still reads the ingest books. Already-recommended Picker still consumes the nonce.

`createOperationalWorkbookRegistry` / `composeOperationalWorkbookRegistrations` / `normalizeSpreadsheetId` / `validateRegistrations` / `listResolved` are beats operations 1–3 already use. They are not extra owner operations. `listResolved` is unused outside this file. `composeOperationalWorkbookRegistrations` is test-only. `createOperationalWorkbookRegistry` exists because leftover reporting tests and already-recommended Picker tests inject `env` + `live`.

## Organization

Keep one file as the screenplay for “refuse this spreadsheet as a reporting destination if it is already reserved for Sheet Sync or Best Relocation ingest, and if live cannot see every required reserved ID refuse every destination until the list is complete; mask IDs so inspect and logs never leak the full string — never choose a destination, never write a cell, never ingest Best Relocation, never drain Sheet Sync.” Leftover destination, leftover worker, already-recommended Picker, leftover `registrations.ts`, leftover `index.ts`, Wave B `sheets.ts` / `runtime.ts`, already-recommended `targets.ts`, leftover BR inspect, and leftover `emitReportingDenylistUnavailable` already live in deeper **modules**. Do not pull those in. Do not invent an `OperationalWorkbookService` class. Do not invent a persist / finalize **seam** here — this file never writes Mongo. Do not invent a Drive **adapter** beside already-recommended Picker / metadata. Do not invent a Sheet Sync **adapter** beside already-recommended coordinator. Do not invent a `TEST_` **adapter** beside Wave B `getRuntimeSheetContainerEnvVar`.

Do not split this into `create.ts` / `get.ts` / `update.ts` / `delete.ts` / `evaluate.ts`. Those are HTTP verbs / registry nouns, not the owner story. Do not move this into leftover `reportingDestination.service.ts` so “destination already owns safety.” Do not move this into already-recommended `picker.service.ts` so “Picker already refuses.” Do not move this into leftover `registrations.ts` so “the catalog can also deny.” Do not move this into Wave B `runtime.ts` so “TEST_ can also denylist.” Do not silently teach leftover destination to import `getOperationalWorkbookRegistry` so “one accessor” without a paired test that today’s default export is what create / worker / cron actually call. Do not silently prefix `TEST_` so “denylist matches Sheet Sync” — that is a safety change, not this rename.

**External interface** stays small (this is the test surface). Refuse, fail-closed, and mask are one story’s reserved-workbook denylist, not four CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `evaluateReportingDestination` | `refuseThisSpreadsheetAsAReportingDestinationIfItIsReservedOrTheReservedListIsIncomplete` | leftover snapshot, leftover worker, and already-recommended Picker need `{ allowed, code }` without a throw |
| `assertConfigurationComplete` | `failClosedWhenARequiredLiveOperationalWorkbookIdIsMissing` | leftover destination / leftover worker / Wave B cron need a throw they can catch |
| `maskSpreadsheetId` | `maskASpreadsheetIdSoInspectAndLogsDoNotLeakIt` | leftover BR inspect and Wave B ingest inspect need `1Mas…7890`, never the raw id |
| `createOperationalWorkbookRegistry` | `openAReservedWorkbookDenylistFromTheseRegistrationsAndThisEnv` | leftover reporting tests and already-recommended Picker tests inject env + live |
| `normalizeSpreadsheetId` | `readASpreadsheetIdFromARawValueOrAGoogleUrl` | today’s file test locks URL vs raw; evaluate and mask **ask** it |
| `composeOperationalWorkbookRegistrations` | `freezeRegistrationGroupsWithoutSharingMutableState` | today’s file test locks compose; leftover catalog does **not** call it at runtime |
| `OperationalWorkbookConfigurationError` | `ReservedWorkbookDenylistIncompleteError` | Wave B cron reads `missing_registration_keys` |
| `DestinationSafetyResult` | `ReportingDestinationSafety` | evaluate’s structured refuse |
| `OperationalWorkbookRegistry` | `ReservedWorkbookDenylist` | the three-method **interface** leftover destination and already-recommended Picker already share |

Keep the old names as one-line aliases until leftover destination, leftover worker, Wave B cron, already-recommended Picker, leftover BR inspect, and Wave B ingest inspect migrate. Do not make callers learn `required_in_live` / `docs.google.com/spreadsheets/d/` / `registration_key` as the domain language.

**Principle: old exports stay as aliases.** `evaluateReportingDestination` remains the imported name until leftover snapshot / leftover worker / already-recommended Picker migrate. `assertConfigurationComplete` remains the imported name until leftover destination / leftover worker / Wave B cron migrate. `maskSpreadsheetId` remains the imported name until leftover BR inspect and Wave B ingest inspect migrate.

**No class for the workflow.** Today’s `createOperationalWorkbookRegistry` already returns a three-method object. Do not grow it into `OperationalWorkbookService`. The type that *does* earn a name is the structured refuse leftover snapshot and already-recommended Picker already branch on:

```ts
type ReportingDestinationSafety =
  | { allowed: true }
  | {
      allowed: false
      code: "OPERATIONAL_WORKBOOK" | "DENYLIST_INCOMPLETE" | "INVALID_SPREADSHEET_ID"
      matched_registration_key?: string
      safe_message: string
    }
```

That is the handoff from “this process compared the candidate to the reserved list” to “Picker may show the safe sentence, leftover destination may throw `destination_unsafe`, leftover worker may fail `DESTINATION_UNSAFE`.” Do **not** add `folder_id` so “this file can replace Picker,” do **not** add `TEST_` so “this file can replace Wave B runtime,” and do **not** add `sheet_sync[]` so “this file can replace already-recommended targets.”

`normalizeSpreadsheetId` stays exported because today’s file test **asks** it without building a registry. It is not a fourth owner operation. Do not add `listResolved` as a public story **seam** — no runtime caller imports it. Do not add `getMasterLeadsSheetContainerId` as a public **seam** on this file — Wave B runtime already owns that read. Do not add `assertWorkbookNotDenylisted` as a public **seam** on this file — already-recommended Picker already owns that throw.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// registry.ts
// Reporting may write only onto a workbook the Owner picked.
// Master Leads, Master Booked, the Source Company Sheet Sync books,
// and the two Best Relocation ingest books are already reserved.
// If the candidate ID matches a reserved ID, refuse.
// If we are on the live host and a required reserved env is missing
// or not a spreadsheet ID, refuse every candidate —
// an incomplete denylist is not a denylist.
// Mask the ID when inspect or logs speak.
// Do not pick a reporting folder.
// Do not write a cell.
// Do not ingest Best Relocation.
// Do not drain Sheet Sync.

// ── 1. Refuse this spreadsheet as a reporting destination ─

export function refuseThisSpreadsheetAsAReportingDestinationIfItIsReservedOrTheReservedListIsIncomplete(
  spreadsheetId: string,
): ReportingDestinationSafety

function readASpreadsheetIdFromARawValueOrAGoogleUrl(value)
function resolveTheReservedWorkbooksFromEnv()             // miss vs resolved; live required miss → missing[]
function refuseWhenTheIdIsNotASpreadsheet()
function refuseWhenTheReservedListIsIncomplete()
function refuseWhenTheIdMatchesAReservedWorkbook(normalized)

// ── 2. Fail closed when a required live ID is missing

export function failClosedWhenARequiredLiveOperationalWorkbookIdIsMissing()

function throwWhenLiveCannotSeeEveryRequiredReservedId(missing)

// ── 3. Mask a spreadsheet ID so inspect and logs do not leak it

export function maskASpreadsheetIdSoInspectAndLogsDoNotLeakIt(value: string): string

function showOnlyTheFirstFourAndLastFour(normalized)
```

Read the primary path out loud: *Read the candidate as a raw spreadsheet ID or a Google Sheets URL. If it is not twenty-plus safe characters, it is not a destination. Resolve every leftover-catalog registration against this process’s env. A required live miss means the reserved list is incomplete — refuse this candidate and every other candidate until those IDs are present. If the list is complete and the candidate equals a reserved ID, refuse and name the registration key. Otherwise allow. Separately, leftover destination, leftover worker, and Wave B cron may ask the same resolve to throw before they touch a destination at all. When leftover BR inspect or Wave B ingest inspect speak, show `1Mas…7890`, never the raw id. Do not write the sheet. Do not pick the folder. Do not drain Sheet Sync.*

That is the operation. `evaluateReportingDestination` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`evaluateReportingDestination` / `assertConfigurationComplete` are executor mechanics.** The owner story is “refuse this spreadsheet if it is reserved or the reserved list is incomplete” and “fail closed when a required live ID is missing.” Keep the old names as aliases. Do not grow an `OperationalWorkbookService` with `evaluate` / `assert` / `list` / `mask`.

2. **Evaluate and assert share one resolve.** Operation 1 returns a structured refuse. Operation 2 throws the same missing keys. One story, two **adapters** (Picker / leftover snapshot / leftover worker vs leftover destination create / leftover worker pre-write / Wave B cron). Shared beat: resolve registrations against env. Do not silently make assert call evaluate so “one function” — evaluate needs a candidate ID and returns `INVALID_SPREADSHEET_ID` / `OPERATIONAL_WORKBOOK` that assert must not invent. Do not silently make leftover destination skip assert so “evaluate is enough” — snapshot-folder destinations never call evaluate, and leftover worker’s comment says a newly missing registration must still fail after the run was confirmed.

3. **Two process accessors lie about the same registry.** Leftover destination, leftover worker, and Wave B cron import `operationalWorkbookRegistry` — always the leftover `index.ts` default, built from leftover catalog + `process.env`. Already-recommended Picker **asks** `getOperationalWorkbookRegistry()`, which honors `setOperationalWorkbookRegistryForTests`. Already-recommended `pickerVerification.test.ts` is the only override caller. Leftover reporting tests construct a **fresh** registry and never touch the override. Name that. Do not silently switch leftover destination to `getOperationalWorkbookRegistry` so “one accessor” without a paired test that create / worker / cron still see live env, not a leftover Picker stub. Do not silently delete the override so “there is one singleton.”

4. **Fail-closed is load-bearing.** A missing required live ID refuses **every** candidate, including a workbook the Owner just picked that is not reserved. That is the incomplete-denylist **seam**. Leftover catalog’s live-required flag is the `required_in_*` field whose suffix is the live `NODE_ENV` value; today’s factory option is the same live-host boolean (defaults to `NODE_ENV` being that live value). Do not silently allow an unrelated ID so “we can still report while Master is unset.” Do not silently treat optional source-lead misses as required so “the denylist is complete” — leftover catalog marks those source rows live-required false. Do not silently throw from evaluate so “one fail-closed” and break already-recommended Picker’s `safe_message` bag.

5. **This file does not use Wave B `TEST_` prefix.** Leftover catalog stores `MASTER_LEADS_SHEET_ID` / `BEST_RELOCATION_SYNC_SHEET_ID`. Wave B `getRuntimeSheetContainerEnvVar` reads `TEST_MASTER_LEADS_SHEET_ID` when `isTestMode()`. This file reads `env[registration.env_key]` as written. Name that. Do not silently ask `getRuntimeSheetContainerEnvVar` so “denylist matches Sheet Sync” — leftover live denylist proof and leftover reporting tests inject unprefixed keys; joining `TEST_` here would hide a reserved live ID or miss a test ID without an owner decision.

6. **Leftover destination hides the refuse code.** `buildValidatedDestinationSnapshot` sets `operationalWorkbookMatch = !safety.allowed` then throws generic `destination_unsafe`, and the persisted snapshot still stamps `operationalWorkbookMatch: false`. Leftover worker distinguishes only `DENYLIST_INCOMPLETE` for the leftover event. Already-recommended Picker keeps `code` on `BadRequestError.metadata`. Do not silently teach leftover destination to return `OPERATIONAL_WORKBOOK` so “one code” in this rename — that is leftover destination’s remap, not this file. Do not silently drop `safe_message` so “codes are enough.”

7. **Snapshot-folder destinations skip evaluate.** Leftover create of `strategy: "snapshot"` asserts complete and never evaluates a workbook id (there is none yet). Leftover worker still asserts on that path. Do not silently require a workbook id on snapshot so “every destination is evaluated.” Do not silently skip assert on snapshot so “there is nothing to deny.”

8. **Invalid env values count as missing, not as reserved.** A required live key whose value fails normalize is pushed to `missing[]` and is **not** pushed to `resolved`. Evaluate then returns `DENYLIST_INCOMPLETE`, not `OPERATIONAL_WORKBOOK`. Name that. Do not silently treat `"not-an-id"` as a reserved ID so “the key was set.” Do not silently ignore a required invalid value so “empty and garbage are different.”

9. **URL extract and raw ID share one fold.** `https://docs.google.com/spreadsheets/d/{id}/…` and a padded raw id both become the same candidate. Today’s file test locks both. Do not silently refuse URLs so “callers already normalized.” Do not accept a shorter id so “Drive file ids vary” without a paired leftover destination / Picker test.

10. **Mask is not evaluate.** Leftover BR inspect and Wave B ingest inspect **ask** mask and never ask refuse. Evaluate never masks. Do not silently log `matched_registration_key` through mask so “the owner can see the sheet.” Do not add mask to leftover destination’s `destination_unsafe` envelope in this rename.

11. **`listResolved` and `composeOperationalWorkbookRegistrations` are not owner operations.** No runtime caller imports `listResolved`. Compose is the file test’s “groups stay frozen” lock. Keep compose as the freeze **seam** the test already uses. Do not add a helper-unit test for `validateRegistrations`. Do not export `listResolved` as a reporting catalog so “admin can browse reserved sheets” — that would leak IDs leftover mask exists to hide.

12. **`purpose: "operational_projection"` and `owner_module: "operations"` are unused by leftover catalog.** Leftover catalog uses `sheet_sync_target` / `ingestion_source` and `sheet_sync` / `best_relocation_ingestion`. Leftover reporting tests invent `operational_projection` + `operations`. Do not silently drop those union members so “the catalog is the type.” Do not silently add an `operational_projection` row in leftover catalog in this rename.

13. **`BEST_RELOCATION_STAGE_2_REGISTRATION_CHECKLIST` lives on leftover catalog and is unused.** This file does not import it. Do not pull that checklist here so “assert can name env keys instead of registration keys.” Wave B cron already reads `missing_registration_keys`.

14. **Leave sibling modules alone.** Leftover `CURRENT_OPERATIONAL_WORKBOOK_REGISTRATIONS`, leftover `operationalWorkbookRegistry` / `getOperationalWorkbookRegistry`, leftover `createReportingDestination` / `buildValidatedDestinationSnapshot`, leftover `reportingWorker` pre-write, Wave B health cron, already-recommended `assertWorkbookNotDenylisted`, Wave B `getRuntimeSheetContainerEnvVar`, already-recommended `getLeadTargets`, leftover `maskSpreadsheetId` callers, and leftover `emitReportingDenylistUnavailable` stay where they are. This file orchestrates reserved-list resolve → structured refuse / throw / mask.

## Testing

The **interface** is the test surface: `refuseThisSpreadsheetAsAReportingDestinationIfItIsReservedOrTheReservedListIsIncomplete` (old name `evaluateReportingDestination`), `failClosedWhenARequiredLiveOperationalWorkbookIdIsMissing` (old name `assertConfigurationComplete`), `maskASpreadsheetIdSoInspectAndLogsDoNotLeakIt` (old name `maskSpreadsheetId`), plus `createOperationalWorkbookRegistry` / `normalizeSpreadsheetId` / `composeOperationalWorkbookRegistrations` the current file test already locks. Live fail-closed, URL-or-raw match, optional source-lead miss, and the forbidden Sheet Sync / ingest / Drive calls are part of that **interface**.

Today’s `registry.test.ts` locks deny-by-id, deny-by-URL, allow-unrelated, live throw + evaluate `DENYLIST_INCOMPLETE`, mask, compose-without-mutate, and leftover catalog’s two required BR rows. That is closer than a stub-only file, and it still does not name the leftover destination / leftover worker / already-recommended Picker **adapters**.

Replace the helper-ish style with tests that name the operation. Inject `env` + `live` at `createOperationalWorkbookRegistry`; do not boot Drive, Sheet Sync, or leftover destination.

**Refuse this spreadsheet as a reporting destination if it is reserved or the reserved list is incomplete**
- Raw reserved ID → `{ allowed: false, code: "OPERATIONAL_WORKBOOK", matched_registration_key }`. Leftover destination is **not** called.
- Google URL for the same ID → same refuse.
- Unrelated valid ID + complete list → `{ allowed: true }`.
- `"not-an-id"` / empty / short → `{ allowed: false, code: "INVALID_SPREADSHEET_ID" }`. No `OPERATIONAL_WORKBOOK`.
- Live + required env missing → `{ allowed: false, code: "DENYLIST_INCOMPLETE" }` even for an unrelated valid ID.
- Live + required env present but not a spreadsheet ID → same `DENYLIST_INCOMPLETE` (invalid counts as missing).
- Optional source-lead env missing + required IDs present → unrelated valid ID is still allowed.
- Non-live + required env missing → unrelated valid ID is allowed; reserved ID (if resolved) still refuses.

**Fail closed when a required live operational workbook ID is missing**
- Live + required miss → throws `OperationalWorkbookConfigurationError` with those `missing_registration_keys`.
- Live + all required present → does not throw, even when optional source-lead keys are empty.
- Non-live + required miss → does not throw.
- The function does not take a candidate ID and does not return `OPERATIONAL_WORKBOOK`.

**Mask a spreadsheet ID so inspect and logs do not leak it**
- Valid id → `1Mas…7890` shape; the raw id is not a substring.
- Invalid → `"[invalid]"`.
- Leftover destination / leftover worker / already-recommended Picker are **not** called.

**Normalize / compose (keep the existing cases; they lock the URL fold and freeze)**
- Padded raw id and Google URL → the same id.
- `"not-an-id"` → `undefined`.
- Compose concatenates groups and does not mutate the input arrays.
- Duplicate `registration_key` / empty key / empty env key / empty label → `TypeError` at `create` / compose (today’s `validateRegistrations`).

**Not this interface**
- Leftover `destination_unsafe` / snapshot `operationalWorkbookMatch: false` stay on leftover `reportingDestination.service.ts`.
- Leftover `DESTINATION_UNSAFE` / `emitReportingDenylistUnavailable` stay on leftover `reportingWorker.ts` / leftover observability.
- Wave B health `denylistIncomplete` JSON stays on `reporting-cron.routes.ts`.
- Already-recommended `assertWorkbookNotDenylisted` / Picker `BadRequestError` stay on `picker.service.ts`.
- `TEST_MASTER_LEADS_SHEET_ID` stays on Wave B `runtime.ts`.
- Master-first destinations stay on already-recommended `targets.ts`.
- Leftover live `proveDenylistBlocksLiveDestination` stays on leftover `liveTestDenylistProof.ts`.
- Leftover catalog rows stay on `registrations.ts`.

Do **not** add a test per helper (`refuseWhenTheIdIsNotASpreadsheet`, `showOnlyTheFirstFourAndLastFour`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not add a test that this file writes a reporting destination — it must not. Do not add a test that this file calls Drive / Picker — it must not. Do not add a test that this file reads `TEST_MASTER_LEADS_SHEET_ID` — it must not, in this rename. Do not add a test that this file drains Sheet Sync or inspects Best Relocation tabs — it must not. Do not add a test that leftover destination now imports Geocoding or Drive metadata — it must not. Do not add a test that `operationalWorkbookRegistry` honors `setOperationalWorkbookRegistryForTests` — today’s default export must not, and already-recommended Picker is the override path.

## What I would not do

- An `OperationalWorkbookService` class with `evaluate` / `assert` / `list` / `mask`.
- Thirty two-line functions that only wrap `normalizeSpreadsheetId`.
- Moving this into a CRUD folder, or into leftover `reportingDestination.service.ts` / already-recommended `picker.service.ts` / leftover `registrations.ts` / Wave B `runtime.ts` / already-recommended `targets.ts` “for cleanliness.”
- Breaking the fail-closed **seam**, the structured-evaluate **seam**, the live-required vs optional-source **seam**, or the mask **seam**.
- Treating leftover destination create, leftover worker fail, already-recommended Picker throw, Wave B `TEST_` prefix, already-recommended Sheet Sync write, leftover BR ingest, or leftover `emitReportingDenylistUnavailable` as this story.
- Inventing a Drive **seam** that has only one **adapter** here, or a `TEST_` **seam** that has only one **adapter** here, or a Sheet Sync write **seam** that has only one **adapter** here.
- Silently prefixing `TEST_`, or silently allowing an unrelated ID when the reserved list is incomplete, or silently switching leftover destination onto `getOperationalWorkbookRegistry` without a paired accessor test, or silently teaching evaluate to throw, or silently treating an invalid required env as a reserved ID, or silently requiring a workbook id on snapshot-folder destinations, or silently exporting `listResolved` as an admin catalog.
- Writing a whole-folder recommendation that pretends leftover `reporting` / leftover `bestRelocationSheetIngest` / already-recommended `googleSheets` / already-recommended `sheetSync` are this service.
- Opening `ringcentral` in this same pass — leftover `registrations.ts` and leftover `index.ts` skip as env catalog / default registry; the next run enumerates `ringcentral`.
- Making a Form Lead 201 depend on this denylist, or making leftover Sheet Sync drain wait on `evaluateReportingDestination`.
