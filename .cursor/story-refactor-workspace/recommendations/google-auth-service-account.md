# Pick How This Process Is Allowed To Talk To Google As The Company — Environment JSON First (TEST_* When TEST_MODE), Then A Local Key File Only When We Are Not In A Test Run — Fail Closed If Neither Exists — Never Invent A Drive User Token, Never Silently Fall Through To Live Company Keys From A Test Run — operational story

- Status: recommended
- Service: `googleAuth` (Wave A, visited after this pass)
- Pass: 1 of this service — `serviceAccount.ts`
- Remaining in this service: none — `googleAuth` is visited (the folder has one service module)
- Target: `src/services/googleAuth/serviceAccount.ts`
- Knowledge: none for this folder. Closest: [`docs/knowledge/services/google-sheets.md`](../../../docs/knowledge/services/google-sheets.md) (external Google calls belong in skipped `googleSheets/auth.ts` / later tabs / already-recommended retry — not in lead/booking services; this file is the **company identity** those clients already ask, not the Sheets client). Distinct from already-recommended live facade: [recommendations/google-sheets-google-sheets.md](google-sheets-google-sheets.md) (that file **asks** skipped `getSheetsClient` after it already chose tabs; it does not load a key). Distinct from skipped `googleSheets/auth.ts` (Sheets-only client factory: cache, Sheets scope, `=`-prefix warn, Sheets-worded fail — it **asks** this file for the source, then rebuilds `GoogleAuth` itself). Distinct from skipped `googleSheets/diagnostics.ts` (log summary + error format: **re-parses** the same env and does **not** import this file). Distinct from leftover Best Relocation workbook read: `bestRelocationSheetIngest/sheets.ts` (`serviceAccountAuthSource` is a **third** reader — hardcoded prod JSON names, extra `SERVICE_ACCOUNT_LOCAL_FILE_JSON`, **no** TEST_MODE file fence). Distinct from leftover Maps ZIP lookup: `googleMaps/geocoding.ts` (the one caller of `createGoogleServiceAccountAuth` + `getGoogleServiceAccountProjectId`; project id is required there). Distinct from leftover reporting live harness: `reporting/live/liveTestSecurity.ts` `rejectServiceAccountCredentialsForLiveTest` (**refuses** this identity so live reporting uses Drive OAuth — do not teach that file to call this one). Distinct from Wave B `config/domain/googleAuth.ts` (env-var **names** only: `GOOGLE_SERVICE_ACCOUNT_JSON` / `_BASE64` vs `*_TEST_*`; this file **asks** those selectors). Distinct from later `googleDriveOAuth` (Owner user token, not the company service account). Distinct from already-recommended wait-then-retry: [recommendations/google-sheets-retry.md](google-sheets-retry.md) (this file never talks to Google after it builds `GoogleAuth`). Distinct from leftover root barrel `src/services/googleSheets.service.ts` (Wave A `legacy-root` — does **not** re-export this file). This checkout’s `CONTEXT.md` does not define a Google service account — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: **two runtime import sites. No file test.** Skipped Sheets factory: `googleSheets/auth.ts` — `getSheetsClient` asks `getGoogleServiceAccountAuthSource` + `getGoogleServiceAccountFile`, then constructs `google.auth.GoogleAuth` itself (does **not** call `createGoogleServiceAccountAuth`). Leftover Maps: `googleMaps/geocoding.ts` — `createGoogleMapsAuthContext` asks `getGoogleServiceAccountProjectId` (missing → throw) then `createGoogleServiceAccountAuth(MAPS_GEOCODING_SCOPES)`; health + once-log also ask project id. Leftover BR ingest / skipped diagnostics / leftover reporting reject / later Drive OAuth / Wave B name selectors / scripts do **not** import this file. Tests: none on this **interface**. Sibling `config/domain/googleAuth.test.ts` locks the four env-var **names** only (Wave B). Sibling `reporting/live/liveTestSecurity.test.ts` / `liveGoogleHarness.test.ts` lock “service-account indicators must be absent for live reporting” — not this export. Not this **interface**: Sheets client cache, Maps token + ZIP lookup, BR workbook read, Drive OAuth, reporting OAuth principal.
- Seams callers need: parsed inline credentials vs local key file; TEST_MODE refuse-file vs prod allow-file; fail-closed `GoogleAuth` vs Sheets’ own constructor + cache; project id for Maps `X-Goog-User-Project` vs the auth client; raw JSON wins over base64
- Split later (only if the file outgrows one sitting): this ~113-line file is one sitting if you read it as pick how this process is allowed to talk to Google as the company, environment JSON first (`TEST_*` when TEST_MODE), then a local key file only when we are not in a test run, fail closed if neither exists, never invent a Drive user token, never silently fall through to live company keys from a test run. If it later splits: `readTheCompanyGoogleIdentityThisProcessMayUse.ts` / `handCallersAScopedGoogleAuthOrRefuse.ts` / `nameTheGoogleProjectThisIdentityBelongsTo.ts` — story files, never `create.ts` / `load.ts` / `parse.ts` / `update.ts` / `delete.ts`, and never merge skipped `googleSheets/auth.ts`, skipped `diagnostics.ts`, leftover BR `serviceAccountAuthSource`, leftover Maps geocode, leftover reporting reject, later Drive OAuth, or Wave B name selectors into this file

`createGoogleServiceAccountAuth` / `getGoogleServiceAccountAuthSource` / `getGoogleServiceAccountCredentials` are executor mechanics. The owner question is: *This process needs to talk to Google as the company — Sheets, Maps, later a reader that still copies the same key. TEST_MODE must read the `*_TEST_*` JSON and must not open a laptop key file. Outside TEST_MODE the process may use environment JSON (raw first, else base64) or a local file path. If neither exists, refuse. Do not invent the Owner’s Drive login. Do not silently read the non-test JSON from a test run. Do not talk to Google after the client is built. Do not choose a spreadsheet. Do not geocode a ZIP.*

Skipped Sheets factory, skipped diagnostics parse, leftover BR copy, leftover Maps ZIP lookup, leftover reporting reject, later Drive OAuth, and Wave B env-var names already live in other **modules**. Do not pull those in.

## What this file actually does

Three operations of one “pick how this process is allowed to talk to Google as the company — environment JSON first (`TEST_*` when TEST_MODE), then a local key file only when we are not in a test run — fail closed if neither exists — never invent a Drive user token, never silently fall through to live company keys from a test run” story, not “an auth CRUD helper,” and not the Sheets client / the Maps ZIP lookup / the Owner Drive login:

1. **Read the company Google identity this process may use** — `getGoogleServiceAccountCredentials`. Ask Wave B `getGoogleServiceAccountJsonEnvVar` / `getGoogleServiceAccountJsonBase64EnvVar` (those names swap to `GOOGLE_SERVICE_ACCOUNT_TEST_JSON` / `GOOGLE_SERVICE_ACCOUNT_TEST_JSON_BASE64` when `isTestMode()` is true — `TEST_MODE=true` or the runtime override). Prefer trimmed raw JSON. Else decode trimmed base64 to UTF-8. Empty / missing → `undefined` (not a throw). Parse JSON. If `private_key` is a string, replace `\\n` with real newlines. If `client_email` is missing or whitespace, `logger.warn` `google.auth.credentials_incomplete` (boolean `hasPrivateKey` only — never the key) and **still return** the parsed object. Parse failure logs `google.auth.json_parse_failed` with the env-var **name** (not the value) and rethrows. This beat does not read `SERVICE_ACCOUNT_LOCAL_FILE`. This beat does not construct `GoogleAuth`. This beat does not talk to Google.

2. **Choose how we present that identity, then hand a scoped GoogleAuth or refuse** — `getGoogleServiceAccountAuthSource` then `createGoogleServiceAccountAuth(scopes)`. Source: credentials object first (`{ credentials }`). Else `getGoogleServiceAccountFile`: TEST_MODE → `undefined` even when `SERVICE_ACCOUNT_LOCAL_FILE` is set; otherwise trimmed `SERVICE_ACCOUNT_LOCAL_FILE` joined to `process.cwd()`. Else `undefined`. `createGoogleServiceAccountAuth` asks that source. Missing → throw. TEST_MODE message names only the JSON env var. Non-test message names the JSON env var **or** `SERVICE_ACCOUNT_LOCAL_FILE`. Present → `new google.auth.GoogleAuth({ ...authSource, scopes })`. This beat does not cache. This beat does not pick Sheets vs Maps scopes — the caller passes them. This beat does not warn about a leading `=` on the file path (skipped Sheets factory does). This beat does not log a config summary (skipped diagnostics / skipped Sheets factory / leftover Maps do).

3. **Name the Google Cloud project that identity belongs to** — `getGoogleServiceAccountProjectId`. Trimmed `project_id` from operation 1, else trimmed `GOOGLE_CLOUD_PROJECT`, else trimmed `GCLOUD_PROJECT`, else `undefined`. Leftover Maps **requires** this string before it asks operation 2 (`X-Goog-User-Project`). This beat does not construct `GoogleAuth`. This beat does not read Drive OAuth. This beat re-parses credentials (it calls operation 1 again).

There is no fourth mutate operation. Sheets client cache, Maps token, BR workbook read, Drive OAuth, and reporting’s “refuse this identity” already live in other files. There is no persist / finalize **seam**.

## Organization

Keep one file as the screenplay for “pick how this process is allowed to talk to Google as the company — environment JSON first (`TEST_*` when TEST_MODE), then a local key file only when we are not in a test run — fail closed if neither exists — never invent a Drive user token, never silently fall through to live company keys from a test run.” Skipped `getSheetsClient`, skipped `resolveAuthConfigSummary`, leftover BR `serviceAccountAuthSource`, leftover Maps geocode, leftover `rejectServiceAccountCredentialsForLiveTest`, later Drive OAuth, and Wave B name selectors already live in deeper **modules**. Do not pull those in. Do not invent a `GoogleAuthService` class. Do not invent a persist / finalize **seam** here — this file never writes Mongo. Do not invent a Drive-token **adapter** beside later `googleDriveOAuth`. Do not invent a second Sheets-client **adapter** beside skipped `getSheetsClient`. Do not invent a second BR-credential **adapter** beside leftover `serviceAccountAuthSource` in this rename.

Do not split this into `create.ts` / `load.ts` / `parse.ts` / `update.ts` / `delete.ts`. Those are HTTP verbs, not the owner story. Do not move this into `googleSheets/auth.ts` so “Sheets already owns Google.” Do not move this into `googleMaps/geocoding.ts` so “Maps already builds the client.” Do not move this into `config/domain/googleAuth.ts` so “the names file can also parse.” Do not move this into `bestRelocationSheetIngest/sheets.ts` so “ingest already has a key reader.” Do not silently teach skipped Sheets factory to call `createGoogleServiceAccountAuth` so “one constructor” without keeping the Sheets cache / `=` warn / Sheets-worded fail. Do not silently teach leftover BR to use `TEST_*` names so “ingest is safe” — that is a safety change, not this rename.

**External interface** stays small (this is the test surface). Identity, fail-closed client, and project name are one story’s company Google login, not five CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `getGoogleServiceAccountCredentials` | `readTheCompanyGoogleIdentityThisProcessMayUse` | skipped diagnostics / leftover Maps project-id path already need the parsed JSON; tests need parse / unescape / incomplete-email without constructing `GoogleAuth` |
| `getGoogleServiceAccountAuthSource` | `chooseHowThisProcessPresentsTheCompanyGoogleIdentity` | skipped Sheets factory asks the source, then builds its own client |
| `getGoogleServiceAccountFile` | `allowALocalKeyFileOnlyOutsideTestMode` | skipped Sheets factory also asks the raw file string so it can warn on a leading `=` |
| `createGoogleServiceAccountAuth` | `handCallersAScopedGoogleAuthOrRefuse` | leftover Maps is the one constructor caller; Sheets does **not** use this export today |
| `getGoogleServiceAccountProjectId` | `nameTheGoogleProjectThisIdentityBelongsTo` | leftover Maps requires it before geocode |
| `ServiceAccountCredentials` | `CompanyGoogleIdentity` | parsed JSON bag (`client_email` / `private_key` / `project_id`) |
| `GoogleServiceAccountAuthSource` | `CompanyGoogleAuthSource` | `{ credentials }` \| `{ keyFile }` |

Keep the old names as one-line aliases until skipped Sheets factory and leftover Maps migrate. Do not make callers learn `getGoogleServiceAccountJsonEnvVar` / `path.join` / `GoogleAuth` as the domain language.

**Principle: old exports stay as aliases.** `createGoogleServiceAccountAuth` remains the imported name until leftover Maps points at the story name. `getGoogleServiceAccountAuthSource` / `getGoogleServiceAccountFile` remain the imported names until skipped `getSheetsClient` migrates.

**No class for the workflow.** The type that *does* earn a name is the source both constructors already spread into `GoogleAuth`:

```ts
type CompanyGoogleAuthSource =
  | { credentials: CompanyGoogleIdentity }
  | { keyFile: string }
```

That is the handoff from “this process may talk to Google as the company” to “Sheets or Maps may construct a client.” Do **not** add `spreadsheetId` so “this file can write,” do **not** add `access_token` so “this file can be Drive,” and do **not** add `scopes` onto the source so “the identity owns Maps vs Sheets.”

`getGoogleServiceAccountFile` stays exported because skipped Sheets factory needs the un-joined env string for the `=` warn. It is not a second public operation. Do not add `formatGoogleApiError` as a public **seam** so “auth can explain 403.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// serviceAccount.ts
// This process needs to talk to Google as the company.
// TEST_MODE must read the *_TEST_* JSON
// and must not open a laptop key file.
// Outside TEST_MODE the process may use environment JSON
// (raw first, else base64)
// or a local file path.
// If neither exists, refuse.
// Do not invent the Owner's Drive login.
// Do not silently read the non-test JSON from a test run.
// Do not talk to Google after the client is built.
// Do not choose a spreadsheet.
// Do not geocode a ZIP.

// ── 1. Read the company Google identity this process may use ─

export function readTheCompanyGoogleIdentityThisProcessMayUse()
  : CompanyGoogleIdentity | undefined

function pickTheModeAwareJsonEnvVar()          // Wave B selector — do not copy the names
function pickTheModeAwareBase64EnvVar()
function preferRawJsonThenDecodedBase64(raw, base64)
function unescapeThePrivateKeyNewlines(parsed)
function warnIfTheClientEmailIsMissing(parsed) // still return
function refuseUnparseableJson(error, envVarName)

// ── 2. Choose how we present that identity, then hand a scoped GoogleAuth or refuse

export function chooseHowThisProcessPresentsTheCompanyGoogleIdentity()
  : CompanyGoogleAuthSource | undefined

export function allowALocalKeyFileOnlyOutsideTestMode()
  : string | undefined                 // TEST_MODE → undefined

export function handCallersAScopedGoogleAuthOrRefuse(scopes)

function refuseWhenNoCompanyIdentityIsConfigured()  // TEST message vs prod message
function buildGoogleAuthFromTheChosenSource(source, scopes)

// ── 3. Name the Google Cloud project that identity belongs to ─

export function nameTheGoogleProjectThisIdentityBelongsTo()
  : string | undefined
  // credentials.project_id → GOOGLE_CLOUD_PROJECT → GCLOUD_PROJECT
```

Read the primary path out loud: *Ask the mode-aware JSON name. If TEST_MODE, that name is the TEST JSON, not the non-test JSON. Prefer the raw JSON. Else decode base64. Unescape the private-key newlines. A missing client email is a warning, not a refuse. Then: if we have credentials, that is the source. Else, if we are not in TEST_MODE and a local file path is set, join it to cwd. Else there is no source. Maps (or anyone who should not copy-paste GoogleAuth) now asks for a scoped client: no source → throw with the mode-aware message; source → construct GoogleAuth with the caller’s scopes. Maps also asks which Google project this identity belongs to before it geocodes. Sheets does not ask for the constructed client today — it asks for the source and builds its own cached Sheets client. Do not open a laptop key file in TEST_MODE. Do not invent the Owner’s Drive token. Do not talk to Google after the client is built.*

That is the operation. `createGoogleServiceAccountAuth` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`createGoogleServiceAccountAuth` is executor mechanics.** The owner story is “hand callers a scoped GoogleAuth or refuse.” Keep the old name as an alias. Do not grow a `GoogleAuthService` with `create` / `load` / `delete`.

2. **Sheets rebuilds `GoogleAuth` instead of asking this constructor.** Skipped `getSheetsClient` already asks `getGoogleServiceAccountAuthSource`. Then it copies the fail-closed + `new google.auth.GoogleAuth` beats, adds a process-lifetime cache, a Sheets-worded error, a once-log, and a leading-`=` warn. One story, two **adapters** (Maps uses this constructor; Sheets builds its own). Align by story later. Do not silently switch Sheets to `handCallersAScopedGoogleAuthOrRefuse` in this rename so “one constructor” — that would drop the Sheets cache / `=` warn / Sheets-worded fail unless those move with it. Do not move the Sheets cache here so “auth owns every Google client.”

3. **Diagnostics re-parses the same env.** Skipped `resolveAuthConfigSummary` reads the same Wave B names, distinguishes `env_json` vs `env_base64` vs `key_file` vs `missing`, and unescapes `private_key` — and does **not** import this file. `getGoogleServiceAccountAuthSource` collapses JSON and base64 into `{ credentials }`. The log **seam** needs the finer source label. Do not silently make diagnostics call this file so “one parser” if that drops `env_json` vs `env_base64`. Do not add `authSource: "env_json" | "env_base64"` onto this export so “the identity can log” without a caller that needs it. Do not pull skipped `formatGoogleApiError` here.

4. **Best Relocation ingest has a third credential reader.** Leftover `serviceAccountAuthSource` hardcodes `GOOGLE_SERVICE_ACCOUNT_JSON` / `_BASE64` (never `*_TEST_*`), allows `SERVICE_ACCOUNT_LOCAL_FILE_JSON`, uses `path.resolve` instead of `path.join`, and does **not** refuse a local file in TEST_MODE. That is a known gap. Name it. Do not silently teach leftover BR to call this file in this rename so “ingest is safe.” Do not silently add `SERVICE_ACCOUNT_LOCAL_FILE_JSON` here so “we match ingest.” Do not silently drop BR’s extra env name so “one file list.”

5. **Incomplete credentials still return.** Missing `client_email` warns and still hands `{ credentials }`. `createGoogleServiceAccountAuth` will then construct `GoogleAuth` that later fails at Google. The name `credentials_incomplete` already tells the truth. Do not silently throw so “configured means usable” without a paired test that today’s warn-and-return stays or becomes refuse on purpose. Do not log the email or the key.

6. **`getGoogleServiceAccountProjectId` re-reads the JSON.** It calls `getGoogleServiceAccountCredentials()` again. Maps also calls it three times (health, create, once-log). That is a pass-through smell, not a second identity. Do not cache credentials on the module so “project id is cheap” without an owner decision that a rotated env mid-process should stay invisible. Do not return skipped diagnostics’ `projectId` so “one summary owns the project.”

7. **TEST_MODE refuse-file is load-bearing.** `getGoogleServiceAccountFile` returns `undefined` when `isTestMode()` is true. Wave B name selectors already pointed the JSON at `*_TEST_*`. Together they are the “never open a laptop key / never read the non-test JSON from a test run” **seam**. Do not silently allow `SERVICE_ACCOUNT_LOCAL_FILE` in TEST_MODE so “local tests can use a file.” Do not silently read `GOOGLE_SERVICE_ACCOUNT_JSON` when TEST_MODE is true so “one env name is simpler.”

8. **Raw JSON wins over base64.** Both env vars may be set. This file prefers raw. Skipped diagnostics does the same. Leftover BR does the same. Do not silently prefer base64 so “Vercel’s base64 is newer.” Lock the winner if you touch the beat.

9. **This file does not cache.** Skipped Sheets factory caches `google.sheets`. Leftover Maps caches `{ auth, projectId }` and clears on failure. Do not add a module-level `GoogleAuth` cache here so “Maps and Sheets share a client” — scopes differ (Sheets vs cloud-platform + geocode).

10. **This file does not talk to Google after construct.** `createGoogleServiceAccountAuth` returns the client. Leftover Maps later calls `getClient` / `getAccessToken`. Skipped Sheets later calls `spreadsheets.values`. Do not call `getAccessToken` here so “auth can prove the key.” Do not import already-recommended `withSheetsRetry` so “auth can heal 429.”

11. **Reporting live harness refuses this identity.** Leftover `rejectServiceAccountCredentialsForLiveTest` throws when any service-account env or local-file indicator is present, then leftover Drive OAuth must be the Owner. That is the opposite of this story. Do not call that reject here so “auth can be safe for reporting.” Do not teach reporting to construct `GoogleAuth` from this file so “one Google login.”

12. **Drive OAuth is a different person.** Later `googleDriveOAuth` is the Owner’s user token (Picker, managed folders, live reporting principal). This file is the company service account. Do not read Drive tokens here so “we already have Google.” Do not write a refresh token here so “service account can become the Owner.”

13. **Wave B owns the env-var names.** `getGoogleServiceAccountJsonEnvVar` / `getGoogleServiceAccountJsonBase64EnvVar` stay in `config/domain/googleAuth.ts`. Do not copy the four string literals into this file so “the service owns its env.” Do not open Wave B in this pass.

14. **Leave sibling modules alone.** Skipped `getSheetsClient` / skipped `resolveAuthConfigSummary` / leftover Maps geocode / leftover BR `serviceAccountAuthSource` / leftover reporting reject / later Drive OAuth / Wave B name selectors stay where they are. This file orchestrates mode-aware JSON → source choice → fail-closed client / project name.

## Testing

The **interface** is the test surface: the five exports (story names, old names as aliases). Mode-aware JSON, refuse-file, fail-closed construct, project-id fallback, and the forbidden identities are part of that **interface**. Do not boot Google. Do not boot Sheets. Do not boot Maps. Pass env and assert source / throw / project id.

There is no `serviceAccount.test.ts` today. Wave B `config/domain/googleAuth.test.ts` only locks the four **names**. Add a file test that names the operation:

**Read the company Google identity this process may use**
- `TEST_MODE=true` reads `GOOGLE_SERVICE_ACCOUNT_TEST_JSON`, not `GOOGLE_SERVICE_ACCOUNT_JSON`.
- `TEST_MODE=true` reads `GOOGLE_SERVICE_ACCOUNT_TEST_JSON_BASE64` when the TEST raw JSON is empty.
- Non-test reads `GOOGLE_SERVICE_ACCOUNT_JSON`, not the TEST name.
- Raw JSON wins when both raw and base64 are set.
- `private_key` `\\n` becomes real newlines.
- Missing / blank both JSON vars → `undefined` (not a throw).
- Invalid JSON throws (and does not return a partial object).
- Missing `client_email` still returns the parsed object (today’s warn-and-return). Do not “fix” that to a throw in this rename.

**Choose how we present that identity, then hand a scoped GoogleAuth or refuse**
- Credentials present → `{ credentials }` even when `SERVICE_ACCOUNT_LOCAL_FILE` is also set (JSON wins).
- `TEST_MODE=true` + only `SERVICE_ACCOUNT_LOCAL_FILE` → no source; `createGoogleServiceAccountAuth` throws and the message names the TEST JSON var, not the file.
- Non-test + only `SERVICE_ACCOUNT_LOCAL_FILE` → `{ keyFile }` joined to `process.cwd()`.
- Non-test + neither → throw; message names the JSON var **or** `SERVICE_ACCOUNT_LOCAL_FILE`.
- Present source + scopes `[...]` → a `GoogleAuth` constructed with those scopes (assert the options, do not call Google).

**Name the Google Cloud project that identity belongs to**
- `project_id` on the JSON wins over `GOOGLE_CLOUD_PROJECT`.
- Missing `project_id` → `GOOGLE_CLOUD_PROJECT`, else `GCLOUD_PROJECT`, else `undefined`.
- TEST_MODE still reads `project_id` from the TEST JSON, not the non-test JSON.

**Not this interface**
- Sheets client cache / `=` warn / Sheets-worded fail stay on skipped `googleSheets/auth.ts`.
- `env_json` vs `env_base64` log labels stay on skipped `googleSheets/diagnostics.ts`.
- Maps token / ZIP / Zippopotamus fallback stay on leftover `googleMaps/geocoding.ts`.
- BR workbook ids / `SERVICE_ACCOUNT_LOCAL_FILE_JSON` stay on leftover `bestRelocationSheetIngest/sheets.ts`.
- “Refuse service-account indicators” stays on leftover `rejectServiceAccountCredentialsForLiveTest`.
- Owner Drive login stays on later `googleDriveOAuth`.
- Env-var **name** swap stays on Wave B `config/domain/googleAuth.ts` (existing test may keep covering it; do not move those assertions onto this export).

Do **not** add a test per helper (`preferRawJsonThenDecodedBase64`, `unescapeThePrivateKeyNewlines`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not add a test that this file reads Drive tokens — it must not. Do not add a test that this file calls `spreadsheets.values` or geocode — it must not. Do not add a test that TEST_MODE opens `SERVICE_ACCOUNT_LOCAL_FILE` — it must not. Do not add a test that TEST_MODE reads `GOOGLE_SERVICE_ACCOUNT_JSON` — it must not. Do not add a test that this file prefers base64 over raw JSON — it must not. Do not add a test that this file logs the private key or the JSON value — it must not. Do not add a test that leftover BR now imports this file — it must not, in this rename. Do not add a test that skipped Sheets factory now calls `createGoogleServiceAccountAuth` — it must not, in this rename.

## What I would not do

- A `GoogleAuthService` class with `create` / `load` / `delete`.
- Thirty two-line functions that only wrap `JSON.parse`.
- Moving this into a CRUD folder, or into `googleSheets/auth.ts` / `googleMaps/geocoding.ts` / `config/domain/googleAuth.ts` / `bestRelocationSheetIngest/sheets.ts` “for cleanliness.”
- Breaking the TEST_MODE refuse-file **seam**, the `*_TEST_*` JSON **seam**, the raw-JSON-wins **seam**, or the fail-closed **seam**.
- Treating `getSheetsClient` / `resolveAuthConfigSummary` / leftover BR `serviceAccountAuthSource` / leftover Maps geocode / leftover reporting reject / later Drive OAuth as this story.
- Inventing a Drive-token **seam** that has only one **adapter** here, or a Sheets-cache **seam** that has only one **adapter** here, or a BR-ingest **seam** that has only one **adapter** here.
- Silently teaching skipped Sheets factory to call `createGoogleServiceAccountAuth`, or silently teaching leftover BR to use `TEST_*` names / this file, or silently allowing a local key file in TEST_MODE, or silently reading the non-test JSON from a test run, or silently preferring base64, or silently throwing on missing `client_email`, or silently adding `SERVICE_ACCOUNT_LOCAL_FILE_JSON`, or silently constructing Drive OAuth from this file, or silently calling Google after construct.
- Writing a whole-folder recommendation that pretends `googleDriveOAuth` / `googleMaps` / `googleSheets` are this service.
- Opening `googleDriveOAuth` in this same pass — this file is the only `googleAuth` module; the next run enumerates `googleDriveOAuth`.
- Making a Form Lead 201 wait on `handCallersAScopedGoogleAuthOrRefuse`.
