# Refuse Any Google Grant That Is Not Exactly Openid, Email, And Drive.file — Treat Google's Userinfo.email URI As Email, Fold Whitespace And Order, Fail Closed On Extra Scopes (Especially Full Drive) Or Missing Scopes — Never Persist, Never Invent The Company Sheets Scope — operational story

- Status: recommended
- Service: `googleDriveOAuth` (Wave A, in-progress after this pass)
- Pass: 3 of this service — `oauthScopes.ts`
- Remaining in this service: `oauthSecurity.ts`, `ownerAuth.ts`, `spreadsheet.service.ts`, `picker.service.ts`, `pickerNonceStore.ts`, `pickerSelectionStore.ts`, `driveMetadata.service.ts`, `managedTab.service.ts` (`workbook.service.ts` / `picker.types.ts` / `index.ts` skipped on open; `googleDriveOAuth.service.ts` / `tokenEncryption.ts` already recommended)
- Target: `src/services/googleDriveOAuth/oauthScopes.ts`
- Knowledge: none for this folder. Closest: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (Owner-gated destinations and Google workbooks as a **delivery surface** — it never names this allowlist file; leftover reporting adapters **ask** already-recommended `googleDriveOAuth.service.ts` for a live client or token health, which **asks** this file to refuse a stored grant that is not exactly openid + email + `drive.file`). Distinct from already-recommended Owner login: [recommendations/google-drive-oauth-google-drive-oauth.md](google-drive-oauth-google-drive-oauth.md) (that file begins / completes consent, upserts the connection, hands the live client, proves refresh, disconnects — it **asks** this file for the allowlist on begin, folds + refuses on complete, and refuses again on status / client / health; it does **not** own the exact-set math). Distinct from already-recommended token lock: [recommendations/google-drive-oauth-token-encryption.md](google-drive-oauth-token-encryption.md) (AES-256-GCM + owner-email AAD — that file does **not** look at scopes). Distinct from already-recommended company identity: [recommendations/google-auth-service-account.md](google-auth-service-account.md) (that file picks how this **process** talks to Google **as the company**; leftover live reporting **refuses** that identity). Distinct from already-recommended company Sheets facade: [recommendations/google-sheets-google-sheets.md](google-sheets-google-sheets.md) (Master / Source Company reporting rows via the service account — skipped `googleSheets/auth.ts` asks Google for `https://www.googleapis.com/auth/spreadsheets`, a **company** scope this file must never grow). Distinct from later `oauthSecurity.ts` (public 403 / `oauth_scope_violation` — this file throws `OAuthScopeViolationError`; later sanitizer maps it). Distinct from later `ownerAuth.ts` (signed Owner **HTTP** gate — not the grant allowlist). Distinct from later Picker (asks already-recommended health; maps `scope_violation` to “Reconnect owner OAuth” — it does **not** import this file). Distinct from Wave B `config/domain/googleDriveOAuth.ts` (env-var **names**, owner email, client id/secret — no scope list). Distinct from Wave B `models/GoogleDriveConnection.ts` (stores `scopes[]` this file folds; it does **not** allowlist). Distinct from skipped barrel `index.ts` (re-exports the four public names; no runtime caller outside this folder imports them). This checkout’s `CONTEXT.md` does not define a Drive OAuth / Owner grant-allowlist term — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: **two runtime import sites. Tests live on this file.** Already-recommended `googleDriveOAuth.service.ts` — `beginGoogleDriveOAuth` copies `[...ALLOWED_GOOGLE_OAUTH_SCOPES]` onto `generateAuthUrl({ scope })`; `completeGoogleDriveOAuth` asks `normalizeOAuthScopes(tokens.scope)` then `assertAllowedOAuthScopes(grantedScopes, "oauth_callback")` and persists the **normalized granted** list (not the assert return); `getGoogleDriveConnectionStatus` asks `assertAllowedOAuthScopes(connection.scopes, "stored_connection")`; `getConnectedGoogleOAuthClient` asks `assertAllowedOAuthScopes(..., "oauth_client")` and **throws**; `getGoogleDriveAccessTokenHealth` try/catches `assertAllowedOAuthScopes(..., "access_token_health")` into `{ healthy: false, reason: "scope_violation" }`. Later `oauthSecurity.ts` — `sanitizeGoogleDriveApiError` / `categorizeOAuthCallbackFailure` map `OAuthScopeViolationError` to public `oauth_scope_violation` (does **not** call fold/assert). Barrel `index.ts` re-exports `ALLOWED_GOOGLE_OAUTH_SCOPES` / `assertAllowedOAuthScopes` / `normalizeOAuthScopes` / `scopesMatchAllowedSet` (not the error, not the two URI constants). Tests: `oauthScopes.test.ts` locks exact-set match, extra-`drive` refuse, order-insensitive fold, and `userinfo.email` → `email`. Not this **interface**: Wave B routes (they never import this file), later owner HTTP gate, later Picker bootstrap, leftover reporting adapters, already-recommended company service account, skipped Sheets `SHEETS_SCOPE`, already-recommended AES lock.
- Seams callers need: fold-without-throwing vs refuse-with-typed-error; boolean exact-set match vs throw (health maps the catch; complete / status / client let it throw); canonical allowlist (what begin asks Google for) vs granted tokens persisted on the connection (what complete stores after fold)
- Split later (only if the file outgrows one sitting): this ~61-line file is one sitting if you read it as refuse any Google grant that is not exactly openid, email, and `drive.file`, treat Google's `userinfo.email` URI as email, fold whitespace and order, fail closed on extra scopes (especially full `drive`) or missing scopes, never persist, never invent the company Sheets scope. If it later splits: `foldTheGrantGoogleReturned.ts` / `refuseUnlessTheGrantIsExactlyTheOwnerDriveAllowlist.ts` — story files, never `create.ts` / `validate.ts` / `assert.ts` / `update.ts` / `delete.ts`, and never merge already-recommended `googleDriveOAuth.service.ts`, already-recommended `tokenEncryption.ts`, later `oauthSecurity.ts`, later `ownerAuth.ts`, later Picker, leftover reporting adapters, skipped Sheets `SHEETS_SCOPE`, or already-recommended company service account into this file

`normalizeOAuthScopes` / `scopesMatchAllowedSet` / `assertAllowedOAuthScopes` are executor mechanics. The owner question is: *Google just granted this process some scopes because the Owner completed Drive consent, or a stored connection already has a scope list. This process may only act as the Owner in Drive with exactly openid, email, and drive.file. Fold the tokens (space-separated string or array), treat Google's userinfo.email URI as email, unique and sort. If the set is not exactly those three, fail closed. Extra full Drive is an overgrant. Missing openid is an undergrant. Both fail. Do not persist. Do not talk to Google. Do not invent the company Sheets scope. Do not map the typed error to a public 403 — later oauthSecurity does that.*

Already-recommended Owner login, already-recommended token lock, later public error categories, later owner HTTP gate, later Picker / folder / metadata / managed-tab, leftover reporting adapters, already-recommended company identity, and skipped company Sheets scope already live in other **modules**. Do not pull those in.

## What this file actually does

Two operations of one “refuse any Google grant that is not exactly openid, email, and `drive.file` — treat Google's `userinfo.email` URI as email, fold whitespace and order, fail closed on extra scopes (especially full `drive`) or missing scopes — never persist, never invent the company Sheets scope” story, not “a scope CRUD helper,” and not the Owner login / the token lock / the public 403:

1. **Fold the grant Google returned** — `normalizeOAuthScopes(value)`. Accept a space-separated string, a string array, or null/undefined. Split / copy, trim, drop empties, rewrite `https://www.googleapis.com/auth/userinfo.email` to `email` (the only alias), unique via `Set`, sort. Empty / null / undefined → `[]`. This beat does not throw. This beat does not persist. This beat does not talk to Google. Already-recommended complete asks this **seam** on `tokens.scope` before it asserts, then stores that folded list.

2. **Refuse unless the grant is exactly the Owner Drive allowlist** — `scopesMatchAllowedSet` + `assertAllowedOAuthScopes(scopes, context)`. Both sides go through operation 1. Same length **and** every sorted index equal → true. Extra token (test locks full `https://www.googleapis.com/auth/drive` beside the three allowed) → false. Missing token → false. `assertAllowedOAuthScopes` throws `OAuthScopeViolationError(context)` (`Google OAuth scopes are not permitted (oauth_callback).` / `stored_connection` / `oauth_client` / `access_token_health`) and otherwise returns a **fresh copy** of `ALLOWED_GOOGLE_OAUTH_SCOPES` (`openid`, `email`, `https://www.googleapis.com/auth/drive.file`). Callers today ignore that return. This beat does not persist. This beat does not map to HTTP. Later `oauthSecurity.ts` maps the class to public 403. Already-recommended health swallows the throw into `scope_violation`; status / client / complete let it throw.

There is no third persist operation. There is no public-403 operation. There is no company-Sheets-scope operation. Already-recommended begin / complete / status / client / health, later error categories, and skipped `SHEETS_SCOPE` already live in other files.

The allowlist constant is the policy those two operations share, not a third owner operation. `GOOGLE_DRIVE_FILE_SCOPE` / `GOOGLE_USERINFO_EMAIL_SCOPE` are the two URIs the policy names. `AllowedGoogleOAuthScope` is the union of the three tokens begin is allowed to ask for.

## Organization

Keep one file as the screenplay for “refuse any Google grant that is not exactly openid, email, and `drive.file` — treat Google's `userinfo.email` URI as email, fold whitespace and order, fail closed on extra scopes (especially full `drive`) or missing scopes — never persist, never invent the company Sheets scope.” Already-recommended `googleDriveOAuth.service.ts`, already-recommended `tokenEncryption.ts`, later `oauthSecurity.ts`, later `ownerAuth.ts`, later Picker / folder / metadata / managed-tab, leftover reporting adapters, already-recommended `serviceAccount.ts`, and skipped Sheets `SHEETS_SCOPE` already live in deeper **modules**. Do not pull those in. Do not invent an `OAuthScopeService` class. Do not invent a persist / finalize **seam** here — this file never writes Mongo. Do not invent a public-403 **adapter** beside later `sanitizeGoogleDriveApiError`. Do not invent a company-Sheets-scope **adapter** beside skipped `googleSheets/auth.ts`.

Do not split this into `create.ts` / `validate.ts` / `assert.ts` / `update.ts` / `delete.ts`. Those are HTTP verbs / checker verbs, not the owner story. Do not move this into `googleDriveOAuth.service.ts` so “the login already allowlists.” Do not move this into later `oauthSecurity.ts` so “the 403 file can also fold.” Do not move this into skipped `googleSheets/auth.ts` so “we already have a Google scope.” Do not silently add `https://www.googleapis.com/auth/spreadsheets` so “reporting can write cells as the Owner.” Do not silently treat a subset as allowed so “at least `drive.file` is enough.”

**External interface** stays small (this is the test surface). Fold and refuse are one story’s grant allowlist, not four CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `ALLOWED_GOOGLE_OAUTH_SCOPES` | `theOwnerDriveGrantThisProcessMayAskFor` | already-recommended begin copies this onto `generateAuthUrl`; tests name the exact three tokens |
| `normalizeOAuthScopes` | `foldTheGrantGoogleReturned` | complete needs a persistable list without throwing; tests need order / alias without the refuse |
| `scopesMatchAllowedSet` | `theGrantIsExactlyTheOwnerDriveAllowlist` | boolean exact-set; tests lock overgrant without constructing the error |
| `assertAllowedOAuthScopes` | `refuseUnlessTheGrantIsExactlyOpenidEmailAndDriveFile` | complete / status / client / health need the typed throw; health maps the catch |
| `OAuthScopeViolationError` | `OwnerDriveGrantIsNotPermitted` | later `oauthSecurity.ts` `instanceof` this class; tests lock the throw |
| `AllowedGoogleOAuthScope` | `OwnerDriveAllowedScope` | the three tokens begin may ask for |
| `GOOGLE_DRIVE_FILE_SCOPE` | `driveFileScopeGoogleAllows` | the one Drive URI in the allowlist (`drive.file`, never full `drive`) |
| `GOOGLE_USERINFO_EMAIL_SCOPE` | `emailScopeUriGoogleOftenReturns` | the only alias: fold this URI to `email` |

Keep the old names as one-line aliases until already-recommended begin / complete / status / client / health and later `oauthSecurity.ts` migrate. Do not make callers learn `Set` / `sort` / `SCOPE_ALIASES` as the domain language.

**Principle: old exports stay as aliases.** `assertAllowedOAuthScopes` remains the imported name until already-recommended complete points at the story name. `normalizeOAuthScopes` remains the imported name until complete migrates. `OAuthScopeViolationError` remains the imported name until later `oauthSecurity.ts` migrates.

**No class for the workflow.** The type that *does* earn a name is the three-token grant begin is allowed to ask for:

```ts
type OwnerDriveAllowedScope =
  | "openid"
  | "email"
  | "https://www.googleapis.com/auth/drive.file"
```

That is the handoff from “this process may ask Google for these three” to “Google came back with a string we must fold and refuse.” Do **not** add `https://www.googleapis.com/auth/drive` onto this type so “Picker can see every file,” do **not** add `https://www.googleapis.com/auth/spreadsheets` so “the Owner can write Sheets without `drive.file`,” and do **not** add `https://www.googleapis.com/auth/userinfo.email` as a fourth allowed token so “Google’s URI can skip the alias” — the URI folds to `email`; it is not a fourth grant.

`SCOPE_ALIASES` stays unexported. It is a beat, not a second public operation. Do not add `sanitizeGoogleDriveApiError` as a public **seam** on this file — later `oauthSecurity.ts` already owns the 403. Do not add `generateAuthUrl` as a public **seam** on this file — already-recommended begin already owns consent.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// oauthScopes.ts
// Google just granted this process some scopes
// because the Owner completed Drive consent,
// or a stored connection already has a scope list.
// This process may only act as the Owner in Drive
// with exactly openid, email, and drive.file.
// Fold the tokens (space-separated string or array),
// treat Google's userinfo.email URI as email,
// unique and sort.
// If the set is not exactly those three, fail closed.
// Extra full Drive is an overgrant.
// Missing openid is an undergrant.
// Both fail.
// Do not persist.
// Do not talk to Google.
// Do not invent the company Sheets scope.
// Do not map the typed error to a public 403.

const theOwnerDriveGrantThisProcessMayAskFor = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/drive.file",
] as const

// ── 1. Fold the grant Google returned ─────────────────────

export function foldTheGrantGoogleReturned(
  value: string | readonly string[] | null | undefined,
): string[]

function splitASpaceSeparatedGrantOrCopyTheArray(value)
function dropEmptyTokensAfterTrim(tokens)
function treatGooglesUserinfoEmailUriAsEmail(token) // only alias
function uniqueAndSort(tokens)

// ── 2. Refuse unless the grant is exactly the allowlist ───

export function theGrantIsExactlyTheOwnerDriveAllowlist(
  scopes: readonly string[],
): boolean

export function refuseUnlessTheGrantIsExactlyOpenidEmailAndDriveFile(
  scopes: readonly string[],
  context: string,
): OwnerDriveAllowedScope[]

function refuseAnOvergrantOrUndergrant(context) // OAuthScopeViolationError
function handBackTheCanonicalThreeTokens()     // not the granted list
```

Read the primary path out loud: *The Owner finished Google consent. Complete already has `tokens.scope`. Ask this file to fold it: split if it is a string, trim, treat Google's userinfo.email URI as email, unique and sort. Then refuse unless that set is exactly openid, email, and drive.file. Extra full Drive fails. Missing openid fails. Complete stores the folded grant, not a freshly minted allowlist. Later status and the live client ask the same refuse and throw. Later token health asks the same refuse and maps the throw to scope_violation so Picker can say reconnect. Begin copied the same three tokens onto the consent URL. This file never writes Mongo. This file never talks to Google. The company Sheets scope is a different person. The public 403 is a later file.*

That is the operation. `assertAllowedOAuthScopes` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`normalizeOAuthScopes` / `scopesMatchAllowedSet` / `assertAllowedOAuthScopes` are executor mechanics.** The owner story is “fold the grant Google returned” / “refuse unless the grant is exactly openid, email, and `drive.file`.” Keep the old names as aliases. Do not grow an `OAuthScopeService` with `validate` / `assert` / `normalize`.

2. **Exact set, not subset.** Match requires same length **and** every sorted index equal. Extra `drive` fails (test). Missing `openid` also fails (no test today). Do not silently switch to “every granted token is in the allowlist” so “Google can omit openid.” Do not silently switch to “every allowlist token is in the grant” so “Google can add `drive`.” Both directions fail today; keep both.

3. **Assert returns the canonical three; complete persists the folded grant.** After a successful refuse, `assertAllowedOAuthScopes` returns `[...ALLOWED_GOOGLE_OAUTH_SCOPES]`. Complete ignores that and upserts `scopes: grantedScopes` (the fold of `tokens.scope`). Same three tokens after a happy path, two bags. Do not silently persist the assert return so “the document always stores canonical order” without a migrate of existing `google_drive_connections.scopes`. Do not silently persist the raw `tokens.scope` string so “we can skip fold on the way in” — status / client / health fold again via assert.

4. **One alias only.** `https://www.googleapis.com/auth/userinfo.email` → `email`. Google often returns that URI. There is no alias for `openid` or for `drive.file`. Do not silently accept `https://www.googleapis.com/auth/plus.me` as `openid`. Do not silently accept `https://www.googleapis.com/auth/drive` as `drive.file`. Do not add `email` as a fourth allowed token beside the URI so “both can sit on the document.”

5. **Health swallows; everyone else throws.** Same `assertAllowedOAuthScopes`, two **adapters**. Picker / leftover live harness need a reason. Status / client / complete need a hard fail. Later `oauthSecurity.ts` maps the thrown class to public 403. Do not silently make health throw so “one assert.” Do not silently make the live client return `null` so “callers can branch.” Do not silently catch inside this file so “assert never throws” — later sanitizer `instanceof` the class.

6. **Context string is the caller, not the grant.** `"oauth_callback"` / `"stored_connection"` / `"oauth_client"` / `"access_token_health"` land in `Google OAuth scopes are not permitted (${context}).` Later sanitizer **drops** that string and returns the same public sentence. Do not silently interpolate the granted tokens into the error so “ops can see the overgrant” without a later log-redact pass. Do not silently drop `context` so “one message.”

7. **This file does not persist.** Complete upserts `scopes`. Status / client / health only read. This file returns a list / a boolean / a throw. Do not import `GoogleDriveConnection` so “assert can rewrite a bad row.” Do not import `getGoogleDriveOAuthConfig` so “the allowlist can come from env.”

8. **This file does not talk to Google.** It never constructs `OAuth2Client`, never calls `generateAuthUrl`, never calls `getToken`. Do not call already-recommended `beginGoogleDriveOAuth` so “fold can re-ask.” Do not import later Picker so “the allowlist can bootstrap.”

9. **Company Sheets scope is a different person.** Skipped `googleSheets/auth.ts` uses `https://www.googleapis.com/auth/spreadsheets` on the **company** service account. This file allowlists a **user** grant. `drive.file` is how the Owner’s connected account creates files this app created. Do not add the Sheets scope here so “reporting can skip Drive.” Do not add full `drive` so “Picker can see every folder in the Owner’s account.” Do not read `GOOGLE_SERVICE_ACCOUNT_*` here so “we already have a key.”

10. **Barrel re-exports four names; no outside caller uses them.** Skipped `index.ts` exports allowlist / fold / match / assert. Wave B routes import begin / complete / status / sanitize — not these. Later `oauthSecurity.ts` imports the error **directly**. Do not add `OAuthScopeViolationError` to the barrel so “routes can catch it” — routes already go through later sanitizer. Do not teach leftover reporting to import `assertAllowedOAuthScopes` so “adapters can skip the live client.”

11. **`GOOGLE_DRIVE_FILE_SCOPE` is unused outside this file.** Only the allowlist and the tests name the URI. Keep the constant so the allowlist does not hide a string. Do not silently inline it in three tests and lose the one-Drive-URI rule.

12. **Leave sibling modules alone.** Already-recommended begin / complete / status / client / health, already-recommended lock / unlock, later public 403, later owner HTTP gate, later Picker / folder / metadata / managed-tab, leftover reporting adapters, already-recommended company identity, and skipped Sheets `SHEETS_SCOPE` stay where they are. This file orchestrates fold → exact-set refuse.

## Testing

The **interface** is the test surface: the fold / match / refuse exports (story names, old names as aliases) plus the allowlist constant, the typed error, and the two URI constants. Exact-set match, overgrant refuse, undergrant refuse, order / alias fold, and the forbidden identities are part of that **interface**. Do not boot Google. Do not boot Mongo. Do not boot Drive.

Today `oauthScopes.test.ts` locks exact allowed set, extra-`drive` refuse (match false + assert throws), order-insensitive fold (string vs array), and `userinfo.email` → `email` (fold + match). Those tests belong on this **interface**. Add (or keep) file tests that name the operation:

**Fold the grant Google returned**
- Space-separated string and array of the same three tokens fold to the same sorted list (today’s order test).
- `https://www.googleapis.com/auth/userinfo.email` folds to `email` (today’s alias test).
- Duplicates collapse (`email email openid drive.file` → three tokens).
- Null / undefined / `""` fold to `[]`.
- Surrounding whitespace on a token is trimmed.
- `https://www.googleapis.com/auth/drive` does **not** fold to `drive.file`.

**Refuse unless the grant is exactly the Owner Drive allowlist**
- The three allowed tokens match (today).
- Extra full `drive` does not match and assert throws `OAuthScopeViolationError` (today).
- Missing `openid` (only `email` + `drive.file`) does not match.
- Empty list does not match.
- Happy-path assert returns a fresh copy of the canonical three (`openid`, `email`, `drive.file`) — not the input array object.
- Error message includes the caller `context` (`oauth_callback`).
- `userinfo.email` URI in place of `email` still matches (today).

**Not this interface**
- Consume-state / owner-email 403 / missing refresh token stay on already-recommended `googleDriveOAuth.service.ts`.
- AES-GCM / owner-email AAD stay on already-recommended `tokenEncryption.ts`.
- Public 403 / `oauth_scope_violation` stay on later `oauthSecurity.ts`.
- Signed admin proxy / scoped-key 403 stay on later `ownerAuth.ts`.
- Picker “Reconnect owner OAuth” stay on later `picker.service.ts` (it reads already-recommended health `scope_violation`).
- Folder URL parse stays on later `spreadsheet.service.ts`.
- Company JSON / TEST_MODE file fence stay on already-recommended `serviceAccount.ts`.
- Company `SHEETS_SCOPE` stays on skipped `googleSheets/auth.ts`.
- Leftover `rejectServiceAccountCredentialsForLiveTest` stays on leftover `liveTestSecurity.ts`.

Do **not** add a test per helper (`treatGooglesUserinfoEmailUriAsEmail`, `uniqueAndSort`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not add a test that this file reads `GOOGLE_SERVICE_ACCOUNT_JSON` — it must not. Do not add a test that this file reads `GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY` — it must not. Do not add a test that this file writes `GoogleDriveConnection` — it must not. Do not add a test that a subset (missing `openid`) matches — it must not. Do not add a test that extra `drive` matches — it must not. Do not add a test that `https://www.googleapis.com/auth/spreadsheets` is now in the allowlist — it must not. Do not add a test that leftover reporting now imports this file — it must not, in this rename. Do not add a test that Wave B routes now import `assertAllowedOAuthScopes` — they must not, in this rename. Do not add a test that this file constructs `OAuth2Client` — it must not. Do not add a test that `assertAllowedOAuthScopes` returns HTTP 403 — it must not (later sanitizer does). Do not add a test that health’s catch now lives in this file — it must not.

## What I would not do

- An `OAuthScopeService` class with `validate` / `assert` / `normalize`.
- Thirty two-line functions that only wrap `Set` / `sort`.
- Moving this into a CRUD folder, or into `googleDriveOAuth.service.ts` / `oauthSecurity.ts` / `googleSheets/auth.ts` / `googleAuth/serviceAccount.ts` / leftover reporting adapters “for cleanliness.”
- Breaking the exact-set **seam**, the `userinfo.email` → `email` **seam**, the fold-does-not-throw **seam**, or the refuse-does-not-persist **seam**.
- Treating already-recommended `googleDriveOAuth.service.ts` / already-recommended `tokenEncryption.ts` / later `oauthSecurity.ts` / later `ownerAuth.ts` / later `picker.service.ts` / leftover reporting adapters / already-recommended `serviceAccount.ts` / skipped Sheets `SHEETS_SCOPE` as this story.
- Inventing a public-403 **seam** that has only one **adapter** here, or a persist-scopes **seam** that has only one **adapter** here, or a company-Sheets-scope **seam** that has only one **adapter** here.
- Silently treating a subset as allowed, or silently adding full `drive` or `spreadsheets` to the allowlist, or silently persisting the assert return without a migrate, or silently catching inside assert so “health can skip try,” or silently teaching leftover reporting to import this file, or silently constructing the company service account from this file, or silently writing Mongo from refuse.
- Writing a whole-folder recommendation that pretends later Picker / folder / managed-tab / leftover reporting are this module.
- Opening `oauthSecurity.ts` in this same pass — stay on `googleDriveOAuth`; that file is the next unchecked module.
- Making a Form Lead 201 wait on `refuseUnlessTheGrantIsExactlyOpenidEmailAndDriveFile`.
