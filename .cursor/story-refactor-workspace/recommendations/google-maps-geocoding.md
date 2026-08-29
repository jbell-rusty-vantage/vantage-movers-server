# Ask The Company Google Identity What US State A Five-Digit ZIP Belongs To, And If Google Cannot Answer Stay Silent So The Leftover Zip Book Can Try Zippopotam.us; Separately Prove That Same Identity Can Still Turn A Test ZIP Into A State Without Throwing — Never Call Zippopotam.us From This File, Never Decide Move Type, Never Write not_found, Never Invent The Owner Drive Token — operational story

- Status: recommended
- Service: `googleMaps` (Wave A, visited after this pass)
- Pass: 1 of this service — `geocoding.ts`
- Remaining in this service: none — `googleMaps` is visited (the folder has one runtime module; `geocoding.test.ts` is the file test, not a checklist row)
- Target: `src/services/googleMaps/geocoding.ts`
- Knowledge: none for this folder. Closest: already-recommended locate: [recommendations/leads-lead-location.md](leads-lead-location.md) (Form must persist a state, Call may leave a blank, classify Move Type — that file **asks** leftover `getStateCodeForZip`, not this file; it already named this file as the Google **adapter** and leftover `pickupZipState.ts` as Google-then-Zippopotam.us). Distinct from leftover zip book: `src/utils/location/pickupZipState.ts` (5-digit fold, **asks** this file, then Zippopotam.us `api.zippopotam.us/us/{zip}` when this file returns `undefined`; `getStateCodeForPickupZip` is a one-line alias). Distinct from leftover state-name fold: `src/utils/location/stateNamesToCodes.ts` (this file **asks** `stateNameToCode` when Google’s administrative area is a full name; leftover zip book **asks** the same fold for Zippopotam.us `place.state`). Distinct from leftover Granot city-state parse: `src/utils/location/granotLocation.ts` (already-recommended enrichment / booked-call-lead rows parse `from` / `to` / zips, then **ask** leftover zip book). Distinct from already-recommended company identity: [recommendations/google-auth-service-account.md](google-auth-service-account.md) (this file is the one runtime caller of `createGoogleServiceAccountAuth` + required `getGoogleServiceAccountProjectId`; it does **not** parse JSON or choose `TEST_*`). Distinct from skipped Sheets diagnostics: `googleSheets/diagnostics.ts` (`resolveAuthConfigSummary` **re-parses** the same env; health + the once-log **ask** that summary and do **not** import already-recommended identity). Distinct from skipped Sheets factory: `googleSheets/auth.ts` (Sheets scopes + cache; this file uses cloud-platform + maps-platform.geocode and caches `{ auth, projectId }`). Distinct from already-recommended company Sheets facade: [recommendations/google-sheets-google-sheets.md](google-sheets-google-sheets.md). Distinct from already-recommended Owner Drive login: [recommendations/google-drive-oauth-google-drive-oauth.md](google-drive-oauth-google-drive-oauth.md) (Owner user token — this file never reads it). Distinct from already-recommended live Drive metadata: [recommendations/google-drive-oauth-drive-metadata.md](google-drive-oauth-drive-metadata.md). Distinct from later Wave A `observability` (`recordOperationalEvent` is the write this file **asks**; `zip_state.lookup.missing` / `zip_state.optional_lookup.missing` stay on already-recommended locate). Distinct from Wave B `config/domain/observability.ts` (`shouldCaptureZipStateEvents` — observability on **and** `OBSERVABILITY_CAPTURE_ZIP_STATE_EVENTS` default true). Distinct from Wave B `GET /api/v1/admin/google-maps/geocoding-health` (v1 `requireApiSecret` only; optional `?zip=`; 200 vs 503 from `data.ok`; no Mongo; no registry Owner gate). Distinct from Wave A `legacy-root` (no leftover barrel re-exports this file). This checkout’s `CONTEXT.md` does not define a ZIP-state / geocoding term — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: **one leftover zip-book import and one Wave B health route. File test covers extract only.** Leftover `utils/location/pickupZipState.ts` — `getStateCodeForZip` refuses non-5-digit, **asks** `getGoogleStateCodeForZip`, and only then Zippopotam.us. Wave B `routes/v1.routes.ts` `handleGoogleMapsGeocodingHealth` **asks** `checkGoogleMapsGeocodingHealth(zip)` and returns `{ ok: data.ok, data }` with HTTP 200 / 503. Indirect leftover zip-book callers (not this **interface**): already-recommended `leads/leadLocation.service.ts` (Form required + Call optional), already-recommended `enrichment/callLeadEnrichmentRows.ts`, already-recommended `reconciliation/bookedCallLeadRows.ts`. Tests: `geocoding.test.ts` locks `extractStateCodeFromGoogleGeocodeResponse` (postal `administrativeArea` `"ca"` → `"CA"`; `administrative_area_level_1` long `"New York"` / short `"NY"` → `"NY"`). No test for silent-undefined, once-per-cold-start events, health 503, or the Zippopotam.us handoff. Not this **interface**: leftover Zippopotam.us fetch, already-recommended `not_found` / Move Type, already-recommended identity parse, skipped Sheets client, Owner Drive, Wave B Zod.
- Seams callers need: silent `undefined` (leftover zip book may try Zippopotam.us) vs structured health (Wave B 200 / 503, never throw); once-per-cold-start `zip_state.google_maps.failed` / `unavailable` vs every health call; cached company Maps `{ auth, projectId }` vs already-recommended construct; Geocoding v4 HTTP fail vs auth/token throw (two event keys)
- Split later (only if the file outgrows one sitting): this ~360-line file is one sitting if you read it as ask the company Google identity what US state a five-digit ZIP belongs to, and if Google cannot answer stay silent so the leftover zip book can try Zippopotam.us; separately prove that same identity can still turn a test ZIP into a state without throwing; never call Zippopotam.us from this file, never decide Move Type, never write `not_found`, never invent the Owner Drive token. If it later splits: `askGoogleTheUsStateForThisFiveDigitZipAndStaySilentIfGoogleCannotAnswer.ts` / `proveTheCompanyMapsIdentityCanStillTurnATestZipIntoAState.ts` — story files, never `create.ts` / `get.ts` / `update.ts` / `delete.ts` / `health.ts`, and never merge leftover `pickupZipState.ts`, already-recommended `leadLocation.service.ts`, already-recommended `serviceAccount.ts`, skipped `diagnostics.ts`, or later `observability` into this file

`getGoogleStateCodeForZip` / `checkGoogleMapsGeocodingHealth` / `extractStateCodeFromGoogleGeocodeResponse` are executor mechanics. The owner question is: *A lead, an enrichment row, or a booked-call-lead row already has a US ZIP. Ask Google, as the company, which state that ZIP is in. If the ZIP is not five digits, or Google returns an HTTP error, or the company identity / token / project is missing, stay silent — leftover zip book will try Zippopotam.us, and already-recommended locate will write `not_found` or leave a blank only after both providers miss. Do not flood the owner: log every HTTP miss, but record `zip_state.google_maps.failed` and `zip_state.google_maps.unavailable` once per cold start. Separately, the owner may prove the same company identity can still turn a test ZIP (default 10001) into a state: auth summary, token, geocode, extract. That prove never throws and never calls Zippopotam.us. Do not decide local vs long-distance. Do not invent the Owner’s Drive login.*

Already-recommended locate, leftover zip book, leftover state-name fold, already-recommended company identity, skipped Sheets diagnostics, later observability persist, already-recommended Owner Drive, and Wave B health HTTP already live in other **modules**. Do not pull those in.

## What this file actually does

Two operations of one “ask the company Google identity what US state a five-digit ZIP belongs to, and if Google cannot answer stay silent so the leftover zip book can try Zippopotam.us; separately prove that same identity can still turn a test ZIP into a state without throwing — never call Zippopotam.us from this file, never decide Move Type, never write not_found, never invent the Owner Drive token” story, not “a geocoding CRUD helper,” and not leftover zip book / already-recommended locate:

1. **Ask Google the US state for this five-digit ZIP, and stay silent if Google cannot answer** — `getGoogleStateCodeForZip(zipCode)`. Trim. Not `^\d{5}$` → `undefined` (no auth, no event). Else ask the cached company Maps context (already-recommended `getGoogleServiceAccountProjectId` required, else throw into the catch; already-recommended `createGoogleServiceAccountAuth` with cloud-platform + maps-platform.geocode). Token from `auth.getClient()` / `getAccessToken()` (string or `{ token }`; missing → throw into the catch). `GET https://geocode.googleapis.com/v4/geocode/address?address.postalCode={zip}&address.regionCode=US` with `Authorization: Bearer` and `X-Goog-User-Project`. HTTP not ok → `logger.warn` `google_maps.geocoding.zip_state_failed` **every time** (zip / status / projectId / body); if `shouldCaptureZipStateEvents()` and this process has not yet recorded, write `zip_state.google_maps.failed` once (`notificationCandidate: false`) and set `recordedHttpFailureEvent`; return `undefined`. HTTP ok → JSON as `GoogleGeocodeResponse`, then extract (postal `administrativeArea` first, else `administrative_area_level_1` short then long; 2-letter upper, else leftover `stateNameToCode`). Catch (auth / token / fetch / JSON): `logAuthOrRequestFailure` **once** per process (`google_maps.geocoding.unavailable` / “falling back to Zippopotamus”); if capture on and this process has not yet recorded, write `zip_state.google_maps.unavailable` once (`fallback: "zippopotamus"`) and set `recordedUnavailableEvent`; return `undefined`. This beat does **not** fetch Zippopotam.us. This beat does **not** write `FORM_LEAD_UNKNOWN_STATE`. This beat does **not** derive `local`. Leftover zip book is the only runtime caller.

2. **Prove the company Maps identity can still turn a test ZIP into a state** — `checkGoogleMapsGeocodingHealth(testZip = "10001")`. Never throws. Trim; not five digits → substitute `"10001"` (the owner’s `?zip=` is ignored when invalid). Seed `ok: false` with skipped `resolveAuthConfigSummary` (catch → `authSource: "missing"` + `error`). `resolvedProjectId` prefers already-recommended project id. Auth-summary error → return immediately (`token` / `geocoding` still false). Else same cached context + token + Geocoding v4 URL as operation 1. Body kept as text; `responsePreview` is the first 1000 characters. HTTP not ok → `geocoding.error` HTTP sentence, return (`health.ok` stays false). HTTP ok → parse, extract; `geocoding.ok` is Boolean(state); missing state → `"Google response did not include a state code"`; `health.ok` is auth **and** token **and** geocoding. Catch: if token is still false, `token.error`; else `geocoding.error`. This beat does **not** record `zip_state.google_maps.*`. This beat does **not** call leftover zip book. This beat does **not** connect Mongo. Wave B maps `health.ok` onto HTTP 200 / 503.

There is no Zippopotam.us operation. There is no locate / `not_found` operation. There is no Move Type operation. There is no Owner Drive operation. Leftover `getZippopotamusStateCodeForZip` still fetches `api.zippopotam.us`. Already-recommended `locateTheFormMove` still writes `not_found`. Already-recommended `classifyTheMoveType` still decides local vs long-distance. Already-recommended `handCallersAScopedGoogleAuthOrRefuse` still constructs the client this file **asks**.

`getGoogleMapsAuthContext` / `createGoogleMapsAuthContext` / `getGoogleMapsAccessToken` / `extractStateCodeFromGoogleGeocodeResponse` / `toStateCode` / `getSafeAuthConfigSummary` / `logGoogleMapsAuthConfigOnce` / `logAuthOrRequestFailure` are beats operations 1–2 already use. They are not extra owner operations. The extract export exists because today’s file test imports it; leftover zip book and Wave B do **not**.

## Organization

Keep one file as the screenplay for “ask the company Google identity what US state a five-digit ZIP belongs to, and if Google cannot answer stay silent so the leftover zip book can try Zippopotam.us; separately prove that same identity can still turn a test ZIP into a state without throwing — never call Zippopotam.us from this file, never decide Move Type, never write not_found, never invent the Owner Drive token.” Leftover `pickupZipState.ts`, already-recommended `leadLocation.service.ts`, already-recommended `serviceAccount.ts`, skipped `diagnostics.ts`, leftover `stateNamesToCodes.ts`, later observability persist, already-recommended Owner Drive, and Wave B health HTTP already live in deeper **modules**. Do not pull those in. Do not invent a `GoogleMapsService` class. Do not invent a Zippopotam.us **adapter** beside leftover `getZippopotamusStateCodeForZip`. Do not invent a `not_found` **seam** beside already-recommended locate. Do not invent a Drive-token **adapter** beside already-recommended `getConnectedGoogleOAuthClient`. Do not invent a persist / finalize **seam** here — this file never writes a Lead.

Do not split this into `create.ts` / `get.ts` / `update.ts` / `delete.ts` / `health.ts`. Those are HTTP verbs / Maps nouns, not the owner story. Do not move this into leftover `pickupZipState.ts` so “the zip book owns Google.” Do not move this into already-recommended `leadLocation.service.ts` so “locate can also fetch.” Do not move this into already-recommended `serviceAccount.ts` so “identity can also geocode.” Do not silently fetch Zippopotam.us inside operation 1 so “one function owns both providers” and hide leftover zip book’s handoff. Do not silently throw from operation 1 so “the owner sees Google’s error” and skip Zippopotam.us. Do not silently record every failed ZIP so “the stream is complete” and flood `zip_state`. Do not silently teach health to call leftover zip book so “health matches the live leftover-zip-book lookup.”

**External interface** stays small (this is the test surface). Ask-and-stay-silent and prove-without-throwing are one story’s company Maps ZIP answer, not four CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `getGoogleStateCodeForZip` | `askGoogleTheUsStateForThisFiveDigitZipAndStaySilentIfGoogleCannotAnswer` | leftover zip book needs `string \| undefined` before Zippopotam.us |
| `checkGoogleMapsGeocodingHealth` | `proveTheCompanyMapsIdentityCanStillTurnATestZipIntoAState` | Wave B health needs a structured bag and must not throw |
| `extractStateCodeFromGoogleGeocodeResponse` | `readAUsStateCodeFromAGoogleGeocodeBody` | today’s file test locks postal-area vs component without Google |
| `GoogleMapsGeocodingHealth` | `CompanyMapsZipLookupProof` | Wave B JSON `data` |
| `GoogleGeocodeResponse` | `GoogleGeocodeBody` | extract / tests |

Keep the old names as one-line aliases until leftover zip book and Wave B health migrate. Do not make callers learn `geocode.googleapis.com` / `X-Goog-User-Project` / `administrative_area_level_1` as the domain language.

**Principle: old exports stay as aliases.** `getGoogleStateCodeForZip` remains the imported name until leftover `getStateCodeForZip` migrates. `checkGoogleMapsGeocodingHealth` remains the imported name until Wave B `handleGoogleMapsGeocodingHealth` migrates.

**No class for the workflow.** The type that *does* earn a name is the proof Wave B already returns:

```ts
type CompanyMapsZipLookupProof = {
  ok: boolean
  checkedAt: string
  testZip: string
  scopes: string[]
  auth: { ok: boolean; authSource: string; clientEmail: string | null; projectId: string | null; resolvedProjectId: string | null; privateKeyPresent: boolean; keyFile: string | null; error: string | null }
  token: { ok: boolean; error: string | null }
  geocoding: { ok: boolean; endpoint: string; status: number | null; statusText: string | null; stateCode: string | null; resultCount: number | null; responsePreview: string | null; error: string | null }
}
```

That is the handoff from “this process asked Google as the company” to “Wave B may show 200 or 503.” Do **not** add `fallback: "zippopotamus"` so “health can skip leftover zip book,” do **not** add `refresh_token` so “Maps can skip Owner Drive,” and do **not** add `pickup_state` / `local` so “this file can replace locate.”

`extractStateCodeFromGoogleGeocodeResponse` stays exported because today’s file test **asks** it without a live token. It is not a third owner operation. Do not add `getStateCodeForZip` as a public **seam** on this file — leftover zip book already owns Google-then-Zippopotam.us. Do not add `resolveRequiredLocation` as a public **seam** on this file — already-recommended locate already owns `not_found`. Do not add `recordOperationalEvent` as a public **seam** on this file — later observability already owns persist.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// geocoding.ts
// A lead, an enrichment row, or a booked-call-lead row
// already has a US ZIP.
// Ask Google, as the company, which state that ZIP is in.
// If the ZIP is not five digits,
// or Google returns an HTTP error,
// or the company identity / token / project is missing,
// stay silent — leftover zip book will try Zippopotam.us,
// and already-recommended locate will write not_found
// or leave a blank only after both providers miss.
// Do not flood the owner: log every HTTP miss,
// but record failed / unavailable once per cold start.
// Separately, the owner may prove the same company identity
// can still turn a test ZIP into a state.
// That prove never throws and never calls Zippopotam.us.
// Do not decide local vs long-distance.
// Do not invent the Owner's Drive login.

// ── 1. Ask Google the US state for this five-digit ZIP ────

export async function askGoogleTheUsStateForThisFiveDigitZipAndStaySilentIfGoogleCannotAnswer(
  zipCode: string,
): Promise<string | undefined>

function refuseUnlessTheZipIsFiveDigits(zipCode)          // trim; else undefined
async function openTheCachedCompanyMapsContext()          // project id required; clear cache on throw
async function mintACompanyMapsAccessToken(auth)          // string or { token }; missing → throw
async function askGeocodingV4ForThisUsPostalCode(zip, token, projectId)
async function rememberAMapsHttpFailureOnce(zip, status, projectId, body)
async function rememberThatMapsWasUnavailableOnce(error)  // fallback named zippopotamus; do not fetch it
function readAUsStateCodeFromAGoogleGeocodeBody(data)     // postal area, else admin_area_1
function foldAnAdministrativeAreaToAStateCode(value)      // 2-letter upper, else leftover stateNameToCode

// ── 2. Prove the company Maps identity can still turn a test ZIP into a state

export async function proveTheCompanyMapsIdentityCanStillTurnATestZipIntoAState(
  testZip = "10001",
): Promise<CompanyMapsZipLookupProof>

function substituteManhattanIfTheTestZipIsNotFiveDigits(testZip)
function summarizeTheCompanyIdentityWithoutThrowing()     // skipped diagnostics; catch → missing
function markAuthTokenAndGeocodeOnTheProof(health, ...)   // never throw; 1000-char preview
```

Read the primary path out loud: *Trim the ZIP. If it is not five digits, stay silent. Open the cached company Maps context — the same already-recommended identity Sheets already uses, but with Maps scopes and a required project id. Mint a token. Ask Geocoding v4 for that US postal code. If Google answers a state, hand the two-letter code back and leftover zip book is done. If Google’s HTTP is not ok, log the miss every time, record `zip_state.google_maps.failed` once per cold start, and stay silent so leftover zip book can try Zippopotam.us. If the company identity, token, or fetch throws, log unavailable once, record `zip_state.google_maps.unavailable` once, and stay silent the same way. Do not fetch Zippopotam.us here. Do not write `not_found`. Do not classify the move. The owner’s health route is the same identity and the same URL, but it never stays silent: it returns a proof bag and Wave B turns `ok` into 200 or 503.*

That is the operation. `getGoogleStateCodeForZip` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`getGoogleStateCodeForZip` is executor mechanics.** The owner story is “ask Google the US state for this five-digit ZIP and stay silent if Google cannot answer.” Keep the old name as an alias. Do not grow a `GoogleMapsService` with `get` / `check` / `extract`.

2. **Lookup and health copy the same URL + fetch + extract.** Operation 1 and operation 2 both build `address.postalCode` + `address.regionCode=US`, both send Bearer + `X-Goog-User-Project`, both extract the same way. One story, two **adapters** (silent leftover-zip-book path vs Wave B proof). Shared beats: open context, mint token, ask Geocoding v4, extract. Only the miss handling differs (undefined + once-events vs structured `ok: false`). Do not silently make health call operation 1 so “one fetch” — that would drop the 1000-character preview, the HTTP status fields, and the “invalid zip → 10001” substitute, and it would start recording `zip_state.google_maps.*` on a health probe. Do not silently make leftover zip book call health so “one proof owns lookup.”

3. **Five-digit refuse is duplicated.** This file trims and tests `^\d{5}$`. Leftover zip book does the same **before** it **asks** this file, and Zippopotam.us does it again. Name the fold. Do not silently drop this file’s check so “the caller already validated” — a future direct caller would hit Google with `"12"` / `"10001-1234"`. Do not move leftover zip book’s fold here so “Maps owns five digits” and hide the Zippopotam.us path’s own refuse.

4. **Stay-silent is load-bearing.** Operation 1 never throws to leftover zip book. HTTP miss, auth miss, token miss, and JSON miss are all `undefined`. That is the Google-then-Zippopotam.us **seam**. Do not silently rethrow so “the owner sees Google’s error” on Form ingest. Do not silently return `"not_found"` so “locate can skip the sentinel” — `FORM_LEAD_UNKNOWN_STATE` is already-recommended locate’s job after **both** providers miss.

5. **Once-per-cold-start events are load-bearing.** `recordedHttpFailureEvent` / `recordedUnavailableEvent` / `loggedAuthFailure` fence a misconfigured Maps integration so leftover zip book’s fallback cannot flood `zip_state`. `logger.warn` on HTTP miss is **every** call. Do not silently record every ZIP so “the stream is complete.” Do not silently drop the HTTP log so “events are enough.” Do not reset the flags on a later success so “recovery is visible” without an owner decision that a healed config should speak again in the same process.

6. **Health substitutes 10001 when `?zip=` is not five digits.** Wave B passes the query through. This file ignores a bad zip and proves Manhattan instead. The proof’s `testZip` then says `"10001"`, not the owner’s string. Name that. Do not silently 400 a bad zip so “health matches lookup refuse” without a paired route test — today’s 503/200 bag would change. Do not silently geocode the raw query so “the owner’s zip is honored” and send `"abc"` to Google.

7. **Health never records `zip_state.google_maps.*`.** A failing probe is a 503 bag, not an operational event. Operation 1’s once-flags are for the live leftover-zip-book path. Do not silently emit `zip_state.google_maps.failed` from health so “the owner sees the probe.” Do not silently skip leftover zip book’s events because health already ran.

8. **Auth cache clears only on construct throw.** `cachedAuthContext` is a process-lifetime Promise. Failure in `createGoogleMapsAuthContext` (missing project id) nulls it so the next ask retries. A later token miss does **not** clear the cache. Do not cache the token. Do not add a module-level `GoogleAuth` cache on already-recommended identity so “Maps and Sheets share a client” — scopes differ. Do not silently keep a rejected Promise so “one fail is forever.”

9. **Project id is required here and optional on already-recommended identity.** Missing `project_id` / `GOOGLE_CLOUD_PROJECT` / `GCLOUD_PROJECT` throws before construct (“Google Maps geocoding auth requires project_id…”). That throw becomes operation 1’s unavailable event, or health’s `token.error` / early auth summary. Do not silently send Geocoding v4 without `X-Goog-User-Project` so “identity can stay optional.” Do not silently read Drive’s project so “we already have a Google project.”

10. **Health auth summary is skipped diagnostics, not already-recommended identity.** `getSafeAuthConfigSummary` **asks** `resolveAuthConfigSummary` (env_json vs env_base64 vs key_file vs missing). Already-recommended identity collapses JSON and base64 into `{ credentials }`. Do not silently switch health to `getGoogleServiceAccountAuthSource` so “one parser” if that drops the finer `authSource` label Wave B already shows. Do not pull `formatGoogleApiError` here.

11. **Extract prefers postal address, then the admin-area component.** `postalAddress.administrativeArea` wins even when `addressComponents` also exist. Short text wins over long text on the component. 2-letter wins over leftover `stateNameToCode`. Do not silently prefer the component so “types are more precise.” Do not copy leftover Zippopotam.us “abbreviation after name” order here so “both providers match” — Zippopotam.us is a sibling **adapter**.

12. **`extractStateCodeFromGoogleGeocodeResponse` is exported for the file test.** Leftover zip book and Wave B do not import it. Keep the export as the extract **seam** the test already uses. Do not add a helper-unit test for `toStateCode` / `foldAnAdministrativeAreaToAStateCode`. Do not hide extract behind operation 1 only so “the test must boot Google.”

13. **This file does not call Zippopotam.us.** The unavailable event’s `fallback: "zippopotamus"` is a label for leftover zip book’s next beat. Do not fetch `api.zippopotam.us` here so “the event tells the truth by doing the fallback.” Do not drop the label so “this file does not mention Zippopotam.us.”

14. **Leave sibling modules alone.** Leftover `getStateCodeForZip`, already-recommended `locateTheFormMove` / `locateTheCallMove` / `classifyTheMoveType`, already-recommended `handCallersAScopedGoogleAuthOrRefuse`, skipped `resolveAuthConfigSummary`, leftover `stateNameToCode`, later `recordOperationalEvent`, already-recommended Owner Drive, and Wave B `handleGoogleMapsGeocodingHealth` stay where they are. This file orchestrates company Maps ask → silent miss / structured proof.

## Testing

The **interface** is the test surface: `askGoogleTheUsStateForThisFiveDigitZipAndStaySilentIfGoogleCannotAnswer` (old name `getGoogleStateCodeForZip`), `proveTheCompanyMapsIdentityCanStillTurnATestZipIntoAState` (old name `checkGoogleMapsGeocodingHealth`), and the extract export the current file test already locks. Silent-undefined, once-per-cold-start events, health’s no-throw bag, and the forbidden Zippopotam.us / locate / Drive calls are part of that **interface**.

Today’s `geocoding.test.ts` only stubs two extract bodies. That is not enough for a story whose load-bearing **seam** is “stay silent so Zippopotam.us can run.”

Replace the stub-only style with tests that name the operation. Inject `fetch` / auth / `recordOperationalEvent` / `shouldCaptureZipStateEvents` at the **interface**; do not boot Google.

**Ask Google the US state for this five-digit ZIP, and stay silent if Google cannot answer**
- `"10001"` + a postal `administrativeArea` `"ny"` body → `"NY"`. Leftover zip book is **not** called.
- `"12"` / `"10001-1234"` / `"  "` → `undefined`. No fetch. No event.
- HTTP 403 / 500 → `undefined`. `google_maps.geocoding.zip_state_failed` logged. `zip_state.google_maps.failed` recorded **once** across two calls in the same process when capture is on.
- Auth / missing project id / missing token → `undefined`. `zip_state.google_maps.unavailable` recorded **once**. Details name `fallback: "zippopotamus"`. This file’s `fetch` is never `api.zippopotam.us`.
- Capture off (`shouldCaptureZipStateEvents() === false`) → still stay silent; **no** `zip_state.google_maps.*` row.
- HTTP ok but no administrative area → `undefined` (not a throw, not `not_found`).

**Prove the company Maps identity can still turn a test ZIP into a state**
- Default / `"10001"` + a state in the body → `ok: true`, `geocoding.stateCode` set, `geocoding.ok` true.
- Invalid `testZip` → proof `testZip` is `"10001"` (today’s substitute). Do not “fix” that to a 400 in this rename.
- Auth-summary throw → `ok: false`, `auth.error` set, no token fetch.
- HTTP 403 → `ok: false`, `geocoding.error` names the HTTP status, `responsePreview` is a prefix of the body. **No** `zip_state.google_maps.failed` row.
- Missing state in a 200 body → `ok: false`, `geocoding.error` is the missing-state sentence, `resultCount` is `results.length`.
- Token throw → `ok: false`, `token.error` set, `geocoding.ok` false. The function does not throw.

**Extract (keep the existing two cases; they lock the postal-first / component-name fold)**
- Postal `"ca"` → `"CA"`.
- Component long `"New York"` / short `"NY"` → `"NY"`.

**Not this interface**
- Zippopotam.us `places[0].state` / `"state abbreviation"` stay on leftover `pickupZipState.ts`.
- `FORM_LEAD_UNKNOWN_STATE` / `deriveLocal` stay on already-recommended `leadLocation.service.ts`.
- `*_TEST_*` JSON / refuse-file stay on already-recommended `serviceAccount.ts`.
- `env_json` vs `env_base64` labels stay on skipped `diagnostics.ts`.
- Owner Drive login / Picker stay on already-recommended `googleDriveOAuth`.
- Wave B 200 vs 503 mapping stays on `handleGoogleMapsGeocodingHealth` (assert the bag here; HTTP status there).
- `zip_state.lookup.missing` / `zip_state.optional_lookup.missing` stay on already-recommended locate.

Do **not** add a test per helper (`refuseUnlessTheZipIsFiveDigits`, `foldAnAdministrativeAreaToAStateCode`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not add a test that this file fetches `api.zippopotam.us` — it must not. Do not add a test that this file writes `not_found` or `local` — it must not. Do not add a test that this file reads a Drive refresh token — it must not. Do not add a test that this file records `zip_state.google_maps.failed` on every HTTP miss in one process — it must not. Do not add a test that health emits `zip_state.google_maps.*` — it must not. Do not add a test that leftover zip book now imports Geocoding v4 — it must not. Do not add a test that already-recommended locate now imports this file — it must not, in this rename.

## What I would not do

- A `GoogleMapsService` class with `get` / `check` / `extract`.
- Thirty two-line functions that only wrap `fetch`.
- Moving this into a CRUD folder, or into `pickupZipState.ts` / `leadLocation.service.ts` / `serviceAccount.ts` / `googleSheets/auth.ts` “for cleanliness.”
- Breaking the stay-silent **seam**, the once-per-cold-start event **seam**, the five-digit refuse **seam**, or the health no-throw **seam**.
- Treating leftover Zippopotam.us, already-recommended locate, already-recommended company identity, skipped Sheets diagnostics, already-recommended Owner Drive, or Wave B 200 / 503 mapping as this story.
- Inventing a Zippopotam.us **seam** that has only one **adapter** here, or a `not_found` **seam** that has only one **adapter** here, or a Drive-token **seam** that has only one **adapter** here.
- Silently fetching Zippopotam.us from this file, or silently throwing from the leftover-zip-book path, or silently recording every failed ZIP, or silently emitting `zip_state.google_maps.*` from health, or silently teaching health to call leftover `getStateCodeForZip`, or silently writing `not_found` / `local` here, or silently constructing Owner Drive from this file, or silently sending Geocoding v4 without a project id.
- Writing a whole-folder recommendation that pretends `leadLocation` / `googleAuth` / `googleDriveOAuth` / leftover `pickupZipState` are this service.
- Opening `operationalWorkbooks` in this same pass — this file is the only `googleMaps` runtime module; the next run enumerates `operationalWorkbooks`.
- Making a Form Lead 201 depend on health, or making Wave B health wait on leftover Zippopotam.us.
