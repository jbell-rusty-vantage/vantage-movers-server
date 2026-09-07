# Never A Service Account, Never Ambient ADC — Prove The Connected Test Owner, Then Wrap That OAuth Client As Official Drive And Sheets Adapters For This Harness — operational story

- Status: recommended
- Service: `reporting` (Wave A, in-progress)
- Pass: 36 of this service — `live/liveTestOAuthAdapters.ts`
- Remaining in this service: `live/liveTestCleanup.ts`, then remaining `live/*` harness
- Target: `src/services/reporting/live/liveTestOAuthAdapters.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (primary code is `reporting.service.ts`. Role: Owner-designed, checksum-bound reports. Happy path: preview → immutable revision → two-step confirmed run → **worker write**. Cron table names `/api/cron/reporting-delivery-heartbeat` (+ health-scan, cleanup, test-artifact janitor). Knowledge never names this file, `createLiveTestGoogleAdapters`, `buildLiveTestGoogleAdaptersFromOAuthClient`, `setLiveTestGoogleApiFactoryForTests`, `google.auth.getClient`, ambient ADC, or a live-test wrap of official from-API adapters — do not add a Reporting Service file in this rename so “the Service sentence wins”). Distinct from already-recommended refuse / prove / export-root / trash fence: [`reporting-live-test-security.md`](reporting-live-test-security.md) (this file **asks** reject on both builders; prove-then-wrap also **asks** principal; this file never **asks** live-account-identity refuse, export-root prove, or the trash fence). Distinct from already-recommended live orchestration: [`reporting-live-google-orchestration.md`](reporting-live-google-orchestration.md) (that file **asks** this wrap after it already **asked** reject / live-account-identity refuse / principal / export-root; error-path tag **asks** this wrap again for `driveApi` only). Distinct from already-recommended official Drive wrap: [`reporting-reporting-drive-adapter.md`](reporting-reporting-drive-adapter.md) (`createReportingDriveAdapter` **asks** `getConnectedGoogleOAuthClient` and does **not** refuse a service account; this file **asks** `createReportingDriveAdapterFromApi` only). Distinct from already-recommended official Sheets wrap: [`reporting-reporting-sheets-adapter.md`](reporting-reporting-sheets-adapter.md) (`createReportingSheetsAdapter` same get-connected-without-refuse; this file **asks** `createReportingSheetsAdapterFromApi` only). Distinct from already-recommended Owner login: [`google-drive-oauth-google-drive-oauth.md`](google-drive-oauth-google-drive-oauth.md) (`handCallersALiveOwnerOAuthClient` — this file **asks** it after principal; Owner login never **asks** this file). Distinct from already-recommended company identity: [`google-auth-service-account.md`](google-auth-service-account.md) (this file **refuses** that identity and never **asks** `google.auth.getClient`). Distinct from already-recommended seed: [`reporting-live-test-run-factory.md`](reporting-live-test-run-factory.md) (queued Mongo insert; never **asks** this file). Distinct from already-skipped inject: `live/liveTestWorkerHooks.ts`. Distinct from unvisited cleanup: `live/liveTestCleanup.ts` (**asks** principal then this wrap for `driveApi`; owns `files.update` `{ trashed: true }`). Distinct from unvisited denylist: `live/liveTestDenylistProof.ts` (**asks** reject then this wrap for `driveApi`). Distinct from unvisited later janitor: `live/testArtifactJanitor.ts` (**asks** reject / principal / export-root then this wrap for `driveApi`). Distinct from unvisited env / picker / mask / synthetic page / retry wrapper. Distinct from Wave B `src/config/domain/reportingLiveTest.ts` (env reject; harness tests **ask** Wave B, not this file). Distinct from Wave B `scripts/reporting/run-live-google-harness.ts` (never imports this file). Distinct from Wave B consumer / cleanup cron (`createReportingDriveAdapter` / `createReportingSheetsAdapter` — official get-connected, no live refuse). This is not Admin Analytics and not Sheet Sync. This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR).
- Callers: already-recommended `live/liveGoogleOrchestration.ts` (**asks** `createLiveTestGoogleAdapters` after reject / live-account-identity refuse / principal / export-root; uses `driveApi` + `drive` + `sheets`; error-path tag **asks** this wrap again and keeps only `driveApi`). Unvisited `live/testArtifactJanitor.ts` (**asks** reject / principal / export-root then this wrap; keeps `driveApi` only). Unvisited `live/liveTestCleanup.ts` (**asks** principal then this wrap; keeps `driveApi` only). Unvisited `live/liveTestDenylistProof.ts` (**asks** reject then this wrap; keeps `driveApi` only). No other `src/` import. Tests: `live/liveTestOAuthAdapters.test.ts` **asks** the factory inject and `buildLiveTestGoogleAdaptersFromOAuthClient` refuse; it never **asks** `createLiveTestGoogleAdapters`. `live/liveTestSecurity.test.ts` / `live/liveGoogleHarness.test.ts` / `reporting.test.ts` / `reportingDelivery.test.ts` do not import this file. Official `createReportingDriveAdapter` / `createReportingSheetsAdapter` never **ask** this file. Owner HTTP confirm never **asks** this file. **No HTTP route** mounts this file.
- Seams callers need: wrap-an-already-held-oauth-client-as-live-test-adapters (`buildLiveTestGoogleAdaptersFromOAuthClient`) vs prove-the-connected-test-owner-then-wrap-those-adapters (`createLiveTestGoogleAdapters`). The already-held-client / prove-then-get-connected **seam** exists because the from-client builder **asks** reject and does **not** **ask** principal (the caller already holds an OAuth client); prove-then-wrap **asks** reject, principal, then `getConnectedGoogleOAuthClient`, then the from-client builder. The this-file-wrap / official-from-connected **seam** exists because official `createReportingDriveAdapter` / `createReportingSheetsAdapter` **ask** `getConnectedGoogleOAuthClient` and never refuse a service account; live must **ask** this file, then official `createReporting*AdapterFromApi`. The raw-Drive-api / wrapped-official-adapter **seam** exists because janitor / cleanup / denylist / error-path tag keep `driveApi`; leftover worker **asks** wrapped `drive` + `sheets`. The factory-inject / default-googleapis **seam** exists because tests replace `liveTestGoogleApiFactory`; default **asks** `google.drive` v3 + `google.sheets` v4 with the explicit client and the `as unknown as Options` cast. The this-file-reject / Wave B config-reject **seam** exists because both export the same two names; this file **asks** leftover security reject, not Wave B. The this-file-principal / leftover-security-principal **seam** exists because prove-then-wrap **asks** leftover `assertLiveTestOAuthPrincipal`; leftover security already **asks** reject inside principal. There is no begin / complete Domain Command **seam**. There is no Google write **seam**. There is no `files.update` `{ trashed: true }` **seam**. There is no Analytics **seam**. There is no Sheet Sync **seam**.
- Split later (only if the file outgrows one sitting): this ~73-line file is one sitting if you read it as never a service account, never ambient ADC — prove the connected test owner, then wrap that OAuth client as official Drive and Sheets adapters for this harness. Do **not** split into `create.ts` / `build.ts` / `factory.ts` / `update.ts` / `delete.ts`. Do **not** pull leftover refuse / leftover principal / leftover official from-connected create / leftover cleanup trash / leftover janitor / leftover denylist / leftover worker here so “one OAuth file owns the company.” If it later splits: `wrapAnAlreadyHeldOauthClientAsLiveTestDriveAndSheetsAdapters.ts` / `proveTheConnectedTestOwnerThenWrapThoseAdapters.ts` only as later story files, never CRUD.

`createLiveTestGoogleAdapters` / `buildLiveTestGoogleAdaptersFromOAuthClient` / `setLiveTestGoogleApiFactoryForTests` are executor mechanics. The owner question is: *Live Google testing may not use the company service account. It may not use `google.auth.getClient` or ambient application-default credentials. Prove the connected Owner login is the configured test owner. Take that OAuth client. Build Drive v3 and Sheets v4 from that client only. Then wrap those APIs as the official reporting adapters the leftover worker already knows. Do not call official `createReportingDriveAdapter` or `createReportingSheetsAdapter` — those skip the refuse. Do not write Google from this file. Do not trash a folder from this file. Do not hit HTTP. Do not sync the Master Sheet.*

Already-recommended leftover refuse / leftover principal, leftover official from-API wrap, leftover Owner login, leftover company identity, and leftover live orchestration already live in other **modules**. Cleanup trash, later janitor, denylist, env, picker, mask, synthetic page, and Wave B config stay sibling **modules**. Do not pull those in.

## What this file actually does

Two operations of one “never a service account, never ambient ADC — prove the connected test owner, then wrap that OAuth client as official Drive and Sheets adapters for this harness” story, not “an OAuth adapter CRUD factory,” and not official from-connected create / leftover refuse / leftover trash:

1. **Wrap an already-held OAuth client as live-test Drive and Sheets adapters** — `buildLiveTestGoogleAdaptersFromOAuthClient`. **Asks** leftover `rejectServiceAccountCredentialsForLiveTest`. **Asks** `liveTestGoogleApiFactory(auth)` (default: `google.drive` `{ version: "v3", auth }` and `google.sheets` `{ version: "v4", auth }`, both `as unknown as Options`). Returns `{ driveApi, sheetsApi, drive: createReportingDriveAdapterFromApi(driveApi), sheets: createReportingSheetsAdapterFromApi(sheetsApi) }`. Does **not** **ask** leftover principal. Does **not** **ask** `getConnectedGoogleOAuthClient`. Does **not** **ask** leftover live-account-identity refuse. Does **not** **ask** leftover export-root prove. Comment says never `google.auth.getClient` or ambient ADC — the factory is the only client construction. Prove-then-wrap **asks** this **seam**. The factory-inject test **asks** this **seam** for the refuse. No other `src/` caller.

2. **Prove the connected test owner, then wrap those adapters** — `createLiveTestGoogleAdapters`. **Asks** leftover reject. **Asks** leftover `assertLiveTestOAuthPrincipal` (leftover principal **asks** leftover reject again). **Asks** leftover `getConnectedGoogleOAuthClient` (Mongo connection row, decrypt refresh token, stamp `last_used_at` — does not call `getAccessToken`). Then **asks** the from-client builder, which **asks** leftover reject a third time. Orchestration / janitor / cleanup / denylist **ask** this **seam**. Orchestration keeps `driveApi` + `drive` + `sheets` for leftover worker. Janitor / cleanup / denylist / error-path tag keep `driveApi` only.

`setLiveTestGoogleApiFactoryForTests` / `getLiveTestGoogleApiFactoryForTests` / `defaultLiveTestGoogleApiFactory` / `LiveTestGoogleApiClients` / `LiveTestGoogleApiFactory` are the test inject and the return bag, not extra owner operations. `null` restores the default factory. The module starts on the default.

## Organization

Keep one file. This is the screenplay for “never a service account, never ambient ADC — prove the connected test owner, then wrap that OAuth client as official Drive and Sheets adapters for this harness.” Leftover refuse / leftover principal, leftover official from-API wrap, leftover Owner login, leftover company identity, leftover live orchestration, leftover cleanup trash, leftover later janitor, leftover denylist already live in deeper **modules**. Do not pull those in. Do not invent a `LiveTestOAuthAdapterService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second official from-connected **adapter** beside `createReportingDriveAdapter` / `createReportingSheetsAdapter`. Do not invent a second refuse **adapter** beside leftover security (or Wave B config) in this rename — name the pile-up; do not silently delete either export.

Do not split from-client wrap / prove-then-wrap into CRUD files. Prove-then-wrap stays with from-client wrap because prove-then-wrap **asks** the from-client builder after it holds the client. Do not move leftover refuse or leftover principal here so “one OAuth file owns security.” Do not start official `createReportingDriveAdapter` from this file so “one getConnected wins.” Do not move `files.update` `{ trashed: true }` here so “adapters own trash.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `buildLiveTestGoogleAdaptersFromOAuthClient` | `wrapAnAlreadyHeldOauthClientAsLiveTestDriveAndSheetsAdapters` | prove-then-wrap + the refuse test |
| `createLiveTestGoogleAdapters` | `proveTheConnectedTestOwnerThenWrapThoseAdapters` | orchestration / janitor / cleanup / denylist |
| `setLiveTestGoogleApiFactoryForTests` | `installTheLiveTestGoogleApiFactoryForTests` | this file’s test inject |
| `getLiveTestGoogleApiFactoryForTests` | `readTheLiveTestGoogleApiFactoryForTests` | this file’s test reads the inject |

Keep `LiveTestGoogleApiClients` / `LiveTestGoogleApiFactory` as the inject types until tests migrate. Keep the old names as one-line aliases until `liveGoogleOrchestration.ts` / `liveTestCleanup.ts` / `liveTestDenylistProof.ts` / `testArtifactJanitor.ts` migrate. Do not make official Wave B consumer learn this file. Do not persist a new harness marker version in this rename.

**No class for the workflow.** The type that *does* earn a name is the bag orchestration already destructures and leftover worker already **asks**:

```ts
type LiveTestGoogleAdaptersWeMayUse = {
  driveApi: drive_v3.Drive
  sheetsApi: sheets_v4.Sheets
  drive: ReportingDriveAdapter
  sheets: ReportingSheetsAdapter
}
```

That is the handoff from “we proved the test owner and held that OAuth client” to “the leftover worker may write, and the harness may list / tag / trash through raw Drive.” Do **not** put official `createReportingDriveAdapter` on this type. Do **not** put `trashed: true` on this type. Do **not** put `google.auth.getClient` on this type.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// liveTestOAuthAdapters.ts
// Live Google testing may not use the company service account.
// It may not use google.auth.getClient or ambient ADC.
// Prove the connected Owner login is the configured test owner.
// Take that OAuth client.
// Build Drive v3 and Sheets v4 from that client only.
// Then wrap those APIs as the official reporting adapters
// the leftover worker already knows.
// Do not call official createReportingDriveAdapter.
// Do not call official createReportingSheetsAdapter.
// Those skip the refuse.
// Do not write Google from this file.
// Do not trash a folder from this file.

// ── 1. Wrap an already-held OAuth client ──────────────────

export function wrapAnAlreadyHeldOauthClientAsLiveTestDriveAndSheetsAdapters(auth)
  // refuseAServiceAccountForLiveGoogleTests
  // ask the factory (default: google.drive v3 + google.sheets v4
  //   from this explicit client — never getClient, never ADC)
  // ask openAReportingDriveAdapterFromThisGoogleApi
  // ask openAReportingSheetsAdapterFromThisGoogleApi
  // return { driveApi, sheetsApi, drive, sheets }
export const buildLiveTestGoogleAdaptersFromOAuthClient =
  wrapAnAlreadyHeldOauthClientAsLiveTestDriveAndSheetsAdapters

function buildDriveAndSheetsApisFromThisExplicitClient(auth)
  // google.drive({ version: "v3", auth }) as unknown as Options
  // google.sheets({ version: "v4", auth }) as unknown as Options
  // comment: library Options reject auth without the cast
function defaultLiveTestGoogleApiFactory =
  buildDriveAndSheetsApisFromThisExplicitClient

export function installTheLiveTestGoogleApiFactoryForTests(factory)
  // null restores buildDriveAndSheetsApisFromThisExplicitClient
export const setLiveTestGoogleApiFactoryForTests =
  installTheLiveTestGoogleApiFactoryForTests

export function readTheLiveTestGoogleApiFactoryForTests()
export const getLiveTestGoogleApiFactoryForTests =
  readTheLiveTestGoogleApiFactoryForTests

// ── 2. Prove the connected test owner, then wrap ──────────

export async function proveTheConnectedTestOwnerThenWrapThoseAdapters()
  // refuseAServiceAccountForLiveGoogleTests
  // proveTheConnectedPrincipalIsTheConfiguredTestOwner
  //   (leftover principal asks leftover reject again)
  // handCallersALiveOwnerOAuthClient
  // wrapAnAlreadyHeldOauthClientAsLiveTestDriveAndSheetsAdapters
  //   (asks leftover reject a third time)
export const createLiveTestGoogleAdapters =
  proveTheConnectedTestOwnerThenWrapThoseAdapters
```

Read the primary path out loud: *Refuse a service account. Prove the connected Owner login is the configured test owner. Take that OAuth client — never `google.auth.getClient`, never ambient ADC. Build Drive v3 and Sheets v4 from that client. Wrap those APIs as the official reporting adapters the leftover worker already knows. Do not call official from-connected create. Do not write Google. Do not trash a folder.*

That is the operation. `createLiveTestGoogleAdapters` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Triple refuse on the prove-then-wrap path.** `createLiveTestGoogleAdapters` **asks** leftover reject. Leftover principal **asks** leftover reject again. The from-client builder **asks** leftover reject a third time. Orchestration / janitor / denylist also **ask** leftover reject before they **ask** this file. Cleanup **asks** leftover principal (which **asks** leftover reject) then this file. Rename the nested refuses so the pile-up is visible. Do not silently drop the inner **asks** so “callers own refuse.”

2. **Callers already prove principal, then this file proves again.** Orchestration **asks** leftover principal + leftover export-root (export-root **asks** leftover principal again) then this wrap. Janitor does the same. Cleanup **asks** leftover principal then this wrap. Denylist **asks** leftover reject only and relies on this file for leftover principal. Rename the nested prove so the double prove is visible. Do not silently drop the inner **ask** so “callers own principal.” Do not silently add leftover principal to denylist so “every live path matches.”

3. **Official from-connected create skips the refuse.** Leftover `createReportingDriveAdapter` / `createReportingSheetsAdapter` already **ask** leftover `getConnectedGoogleOAuthClient` and leftover from-API wrap. They never **ask** leftover reject. Live must **ask** this file. Do not silently call official from-connected create from this file so “one getConnected wins.”

4. **Error-path orchestration rebuilds the whole bag for `driveApi`.** Happy path already holds `driveApi`. The catch **asks** `createLiveTestGoogleAdapters` again — another refuse + leftover principal + leftover get-connected — and keeps only `driveApi` to tag. Rename the second wrap so the rebuild is visible. Do not silently reuse the happy-path client in this rename so “one wrap owns the run.” That rebuild lives in leftover orchestration.

5. **Raw API vs wrapped adapter is the real split.** Janitor / cleanup / denylist / error-path tag keep `driveApi`. Leftover worker **asks** wrapped `drive` + `sheets`. Do not silently stop returning `driveApi` so “one adapter owns Google.” Do not silently stop wrapping official adapters so “raw APIs are enough.”

6. **`buildLiveTestGoogleAdaptersFromOAuthClient` has no `src/` caller except prove-then-wrap.** The from-client **seam** exists for prove-then-wrap’s last step and for the refuse test. Do not invent a second `src/` caller in this rename. Do not delete the export so “one function is enough” and lose the already-held-client **seam**.

7. **Module-level mutable factory.** `setLiveTestGoogleApiFactoryForTests` writes a module singleton. The factory-inject test restores `null` in `finally`. A later test that forgets `finally` leaks. Do not silently pass the factory as an argument so “no singleton” in this rename.

8. **`as unknown as Options` is the library gap.** Already named in `.cursor/rules/library-typing.mdc`. Do not invent a new factory wrapper to hide the cast. Do not silently drop the cast so “Options accepts auth.”

9. **Tests never **ask** prove-then-wrap.** `liveTestOAuthAdapters.test.ts` proves the factory received the explicit client and that from-client wrap throws on a service-account env indicator. It does **not** prove leftover principal, leftover `getConnectedGoogleOAuthClient`, or that official from-API wrap received the factory APIs. That is not enough for the path orchestration actually **asks**.

10. **Leave sibling modules alone.** Leftover `rejectServiceAccountCredentialsForLiveTest`, leftover `assertLiveTestOAuthPrincipal`, leftover `getConnectedGoogleOAuthClient`, leftover `createReportingDriveAdapterFromApi`, leftover `createReportingSheetsAdapterFromApi`, leftover `trashHarnessContainerWithConfirmation`, and leftover `runReportingDeliveryWorker` are already the right **depth**. This file refuses, proves, takes the client, and wraps.

## Testing

The **interface** is the test surface: `wrapAnAlreadyHeldOauthClientAsLiveTestDriveAndSheetsAdapters`, `proveTheConnectedTestOwnerThenWrapThoseAdapters` (today `buildLiveTestGoogleAdaptersFromOAuthClient` / `createLiveTestGoogleAdapters`). The factory inject stays exported because tests are a second real **adapter**.

Today `liveTestOAuthAdapters.test.ts` proves the factory received the explicit OAuth2 client and that from-client wrap throws `/reject service-account/i` when `GOOGLE_SERVICE_ACCOUNT_ENV_VARS.json` is set. It does **not** prove prove-then-wrap **asks** leftover principal then leftover `getConnectedGoogleOAuthClient` then the from-client builder. It does **not** prove official from-API wrap received the factory APIs. That is not enough for a story that can hand leftover worker a live client.

Replace the missing coverage with tests that name the operation. Use `TEST_MODE`. Do not boot live Google.

**Wrap an already-held client**
- Factory receives the same OAuth2 client the caller passed. Never `google.auth.getClient`.
- Service-account env json throws leftover “Remove:” (this file **asks** leftover security reject, not Wave B).
- Returned `drive` / `sheets` are the official from-API wraps of the factory APIs (identity or a recorded from-API **ask**). Do not boot leftover `files.create`.

**Prove then wrap**
- Leftover principal throw never reaches leftover `getConnectedGoogleOAuthClient`.
- Leftover get-connected throw never reaches the from-client builder.
- After leftover principal and leftover get-connected succeed, the from-client builder receives that client and leftover reject still runs.

Do **not** add a test per helper (`buildDriveAndSheetsApisFromThisExplicitClient`, `defaultLiveTestGoogleApiFactory`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** boot leftover official `createReportingDriveAdapter`, leftover `assertSafeToTrashReportingArtifact`, leftover orchestration, leftover cleanup `files.update`, Analytics, or Sheet Sync inside these tests. Official trash proofs stay `reportingDelivery.regressions.test.ts`. Live Google stays `pnpm reporting:live-google-harness`.

## What I would not do

- I would not implement this pass.
- I would not rewrite recommendations/form-lead.md.
- I would not edit src/, tests, routes, models, or docs/knowledge/.
- I would not invent a CONTEXT.md term or an ADR. CONTEXT.md does not define Reporting.
- I would not open Wave B (`src/config/domain/reportingLiveTest.ts`, `src/routes/reporting.routes.ts`, `scripts/reporting/run-live-google-harness.ts`).
- I would not write a whole-folder Reporting recommendation.
- I would not introduce a `LiveTestOAuthAdapterService` class or a `create.ts` / `build.ts` / `factory.ts` / `update.ts` / `delete.ts` split.
- I would not invent a second official from-connected **adapter** beside `createReportingDriveAdapter` / `createReportingSheetsAdapter`.
- I would not silently call official from-connected create so “one getConnected wins.”
- I would not silently drop the inner leftover refuse or leftover principal so “callers own security.”
- I would not silently reuse the happy-path client on leftover orchestration’s error path.
- I would not silently stop returning `driveApi` so “one adapter owns Google.”
- I would not silently move `files.update` `{ trashed: true }` into this file.
- I would not open `live/liveTestCleanup.ts` while this checklist still has unchecked modules after this row.
- I would not silently reorder ADR-known side effects.
