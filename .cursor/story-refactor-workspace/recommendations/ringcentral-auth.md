# Hand This Process A Live RingCentral Access Token — Reuse The Cache When It Still Has More Than Two Minutes — Refresh When The Access Token Is Stale But The Refresh Token Is Still Good — Exchange The Company JWT When Refresh Cannot Help — Persist The New Cache — Forget The Cache After A 401 So The Next Mint Starts From JWT — Never Log The Token, Never Return It From A Route, Never Talk To Call Log, Never Create A Call Lead — operational story

- Status: recommended
- Service: `ringcentral` (Wave A, visited after this pass)
- Pass: 16 of this service — `auth.ts`
- Remaining in this service: none — `ringcentral` is visited (every checklist module is recommended or skipped)
- Target: `src/services/ringcentral/auth.ts`
- Knowledge: [`docs/knowledge/services/ringcentral-call-lead-qualification.md`](../../../docs/knowledge/services/ringcentral-call-lead-qualification.md) (never names this file; the only token sentence is “No … credential, token, or header ever enters state, metrics, logs, or events”). The JWT / refresh / 120-second reuse / 401-delete-then-JWT contract lives in `.cursor/rules/ringcentral-integration.mdc`, not in knowledge. Distinct from skipped HTTP client: `client.ts` (`ringCentralRequest` — **asks** `getValidToken` before every API call; on `401` **asks** `clearRingCentralTokenCache` then `exchangeJwtForToken` and retries once; re-exports `getValidToken` with **no** importer in this checkout). Distinct from skipped store factory: `token-store.ts` (`createTokenStore` — `RC_TOKEN_STORE=mongo` → skipped `MongoTokenStore`; else skipped `FileTokenStore(".ringcentral-token-cache.json")`). Distinct from skipped token adapters: `mongo-token-store.ts` (`integration_tokens`, key `ringcentral:oauth-token`, runtime unique + TTL indexes) and `file-token-store.ts` (gitignored `0o600` JSON). Distinct from skipped config: `ringcentral-config.ts` (collection names / write flags — this file **asks** Wave B `getRequiredEnv` for `RC_SERVER_URL` / `RC_CLIENT_ID` / `RC_CLIENT_SECRET` / `RC_JWT` and never those helpers). Distinct from already-recommended sweep: [recommendations/ringcentral-call-log-sync.md](ringcentral-call-log-sync.md) (**asks** skipped client, never this file). Distinct from already-recommended Analytics: [recommendations/ringcentral-analytics-reconcile.md](ringcentral-analytics-reconcile.md) (same — **asks** skipped client). Distinct from leftover registry validation: unvisited `operationsRegistry/ringCentralValidation.ts` (**asks** skipped client). Distinct from already-recommended promote / Call Log vet / evaluate / webhook keep — those never talk to OAuth. This checkout’s `CONTEXT.md` does not define a RingCentral token / JWT grant — the knowledge file links a parent glossary this tree does not ship. Do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: **one runtime import site. No file test.** Skipped `client.ts` imports `getValidToken`, `clearRingCentralTokenCache`, `exchangeJwtForToken` and re-exports `getValidToken`. Already-recommended sweep, already-recommended Analytics, leftover `ringCentralValidation` **ask** skipped client, not this file. `refreshAccessToken` and `getRingCentralTokenStore` have **no** importer in this checkout. Gitignored `scripts/dev_ops/ringcentral/*` are the intended operator **askers** of leftover `getValidToken` / leftover store (rules name those runners; the folder is not in this tree). Wave B cron / webhook HTTP never import this file. There is **no** `auth.test.ts`.
- Seams callers need: live token (skipped client **asks** the same export before every Bearer call); 401 restart (forget the cache, then JWT — skip refresh); persist vs forget (grant children `set`; 401 `del`); file vs mongo store is skipped `createTokenStore`, not a second owner operation
- Split later (only if the file outgrows one sitting): this ~211-line file is one sitting if you read it as hand this process a live RingCentral access token, reuse the cache when it still has more than two minutes, refresh when the access token is stale but the refresh token is still good, exchange the company JWT when refresh cannot help, persist the new cache, forget the cache after a 401 so the next mint starts from JWT — never log the token, never return it from a route, never talk to Call Log, never create a Call Lead. If it later splits: `handThisProcessALiveRingCentralAccessToken.ts` / `exchangeTheCompanyJwtForANewAccessToken.ts` / `forgetTheCachedRingCentralToken.ts` — story files, never `create.ts` / `update.ts` / `delete.ts` / `auth.ts` as a CRUD split, and never merge skipped client 401 retry, skipped token stores, skipped config names, already-recommended sweep, already-recommended Analytics, leftover registry validation, or Wave B cron HTTP into this file

`getValidToken` / `exchangeJwtForToken` / `refreshAccessToken` / `clearRingCentralTokenCache` are executor mechanics. The owner question is: *Before Call Log, Analytics, or a registry validation can ask RingCentral anything, this process needs a live access token. If the cache still has more than two minutes, reuse it. If the access token is stale but the refresh token is still good, refresh and persist. If refresh fails or there is no usable refresh token, exchange the company JWT and persist. After a 401, forget the cache so the next mint starts from JWT. Never log the token. Never return it from a route. Do not talk to Call Log. Do not create a Call Lead.*

Skipped HTTP client, skipped token-store factory, skipped mongo / file adapters, skipped config names, already-recommended sweep, already-recommended Analytics, leftover registry validation, and Wave B cron HTTP already live in other **modules**. Do not pull those in.

## What this file actually does

Four operations of one “hand this process a live RingCentral access token — reuse the cache when it still has more than two minutes — refresh when the access token is stale but the refresh token is still good — exchange the company JWT when refresh cannot help — persist the new cache — forget the cache after a 401 so the next mint starts from JWT — never log the token, never return it from a route, never talk to Call Log, never create a Call Lead” story, not “an OAuth CRUD helper,” and not skipped client / skipped token stores:

1. **Hand a live access token** — `getValidToken`. **Ask** the module-load singleton from skipped `createTokenStore()`. If `access_token_expires_at - now > 120_000`, return the cache (no network). Else if a refresh token exists and `refresh_token_expires_at - now > 120_000`, **ask** operation 3. Refresh throw → warn `ringcentral.auth.refresh.failed` with status only (no token), **ask** operation 4, then fall through. No usable cache / no usable refresh → **ask** operation 2. This beat does **not** POST Call Log. This beat does **not** send Bearer to a business endpoint. This beat does **not** create a Call Lead.

2. **Exchange the company JWT for a new access token** — `exchangeJwtForToken`. `POST ${RC_SERVER_URL}/restapi/oauth/token` with Basic `RC_CLIENT_ID:RC_CLIENT_SECRET` and `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer` + `assertion: RC_JWT`. Fold `expires_in` into `access_token_expires_at`. Persist via `tokenStore.set`. Log `ringcentral.auth.jwt_exchange.succeeded` with scope / owner / expiry only. Skipped client **asks** this after operation 4 on `401`. This beat does **not** try refresh first. This beat does **not** retry the failed business request — skipped client owns that.

3. **Refresh the stale access token from the cached refresh token** — `refreshAccessToken`. Same OAuth URL, `grant_type=refresh_token`. Persist. Log `ringcentral.auth.refresh.succeeded` the same PII-free way. Only operation 1 **asks** this today. A failed refresh is not retried. This beat does **not** delete the cache — operation 1 does that after the throw.

4. **Forget the cached token** — `clearRingCentralTokenCache` → `tokenStore.del()`. Skipped client **asks** this on `401` **before** operation 2. Operation 1 **asks** this after a failed refresh. This beat does **not** mint. This beat does **not** retry.

There is no fifth Call Log operation. There is no Analytics operation. There is no promote operation. There is no webhook-subscription POST. Skipped `ringCentralRequest` is the business-HTTP **adapter**. Skipped `createTokenStore` is the persistence **adapter**. Wave B cron HTTP is a trigger **adapter**. Already-recommended `ingestRingCentralQualifiedCall` is the only promotion **adapter** — this file never **asks** it.

`TOKEN_EXPIRY_BUFFER_MS` / `RingCentralAuthError` / `getRingCentralTokenStore` sit on the hand-a-token path. They are not extra owner operations. Do not invent a dashboard for `getRingCentralTokenStore` in this rename. Do not export `postTokenRequest` / `normalizeTokenResponse` / `getBasicAuthValue` as a public **seam**.

## Organization

Keep one file as the screenplay for “hand this process a live RingCentral access token, reuse the cache when it still has more than two minutes, refresh when the access token is stale but the refresh token is still good, exchange the company JWT when refresh cannot help, persist the new cache, forget the cache after a 401 so the next mint starts from JWT — never log the token, never return it from a route, never talk to Call Log, never create a Call Lead.” Skipped client 401 retry, skipped token-store factory, skipped mongo / file adapters, skipped config names, already-recommended sweep, already-recommended Analytics, leftover registry validation, and Wave B cron HTTP already live in deeper **modules**. Do not pull those in. Do not invent a `RingCentralAuthService` class. Do not invent a begin / complete **seam** — this file never writes a Lead and never sits in a command transaction. Do not invent a business-HTTP **adapter** beside skipped `ringCentralRequest`. Do not invent a second token-store **adapter** beside skipped `createTokenStore`. Do not invent a JWT-env **adapter** beside Wave B `getRequiredEnv("RC_JWT")`.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `auth.ts` as a CRUD folder. Those are persistence verbs, not the owner story. Do not move skipped client’s 401 retry into this file so “one file owns token and request.” Do not move skipped `MongoTokenStore` into this file so “auth owns persist.” Do not silently log `access_token` so “debug is easier.” Do not silently return the token from a Wave B route so “the owner can copy it.” Do not silently **ask** already-recommended promote after a JWT exchange so “a new token means ingest.”

**External interface** stays small (this is the test surface). Hand-a-token, JWT mint, refresh, and forget are one story’s live credential, not four CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `getValidToken` | `handThisProcessALiveRingCentralAccessToken` | skipped client **asks** this before every Bearer call |
| `exchangeJwtForToken` | `exchangeTheCompanyJwtForANewAccessToken` | skipped client 401 after forget; also the last beat of hand-a-token |
| `refreshAccessToken` | `refreshTheStaleAccessTokenFromTheCachedRefreshToken` | only hand-a-token **asks** it today; keep the alias so a later file test can mint without going through JWT |
| `clearRingCentralTokenCache` | `forgetTheCachedRingCentralToken` | skipped client 401 first beat; hand-a-token **asks** it after a failed refresh |
| `getRingCentralTokenStore` | `theTokenStoreThisProcessAlreadyChose` | no importer in this checkout; operator probes may need the singleton skipped `createTokenStore` already built |
| `RingCentralAuthError` | `RingCentralTokenRequestFailed` | grant failure carries `status`; refresh-fail logging reads it |

Keep the old names as one-line aliases until skipped client migrates. Do not make callers learn `postTokenRequest` / `TOKEN_EXPIRY_BUFFER_MS` / `URLSearchParams` as the domain language.

**Principle: old exports stay as aliases.** `getValidToken` remains the imported name until skipped client’s Bearer path migrates. `exchangeJwtForToken` / `clearRingCentralTokenCache` remain the imported names until skipped client’s 401 restart migrates.

**No class for the workflow.** The type that *does* earn a name is the cache bag skipped `types.ts` already owns and this file already returns:

```ts
type LiveRingCentralAccessToken = {
  access_token: string
  refresh_token?: string
  issued_at: number
  access_token_expires_at: number
  refresh_token_expires_at?: number | null
  scope?: string
  owner_id?: string
  endpoint_id?: string
}
```

That is the handoff from “this process may talk to RingCentral” to “skipped client may send Bearer.” Do **not** add `call_log_id` so “the token owns the sweep,” do **not** add `authorization_header` so “the route can echo it,” and do **not** put `raw` on the public **interface** — `raw` stays on the stored row.

Do not add `ringCentralRequest` as a public **seam** — skipped client already owns that. Do not add `createTokenStore` as a public **seam** — skipped `token-store.ts` already owns that. Do not add `isRingCentralCallLogSyncEnabled` as a public **seam** — skipped config already owns that.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// auth.ts
// Before Call Log, Analytics, or a registry validation
// can ask RingCentral anything, this process needs a live access token.
// If the cache still has more than two minutes, reuse it.
// If the access token is stale but the refresh token is still good,
// refresh and persist.
// If refresh fails or there is no usable refresh token,
// exchange the company JWT and persist.
// After a 401, forget the cache so the next mint starts from JWT.
// Never log the token.
// Never return it from a route.
// Do not talk to Call Log.
// Do not create a Call Lead.

// ── 1. Hand a live access token ───────────────────────────

export async function handThisProcessALiveRingCentralAccessToken()
function theCachedAccessTokenStillHasMoreThanTwoMinutes(cached, now)
function theCachedRefreshTokenStillHasMoreThanTwoMinutes(cached, now)

// ── 2. Exchange the company JWT ───────────────────────────

export async function exchangeTheCompanyJwtForANewAccessToken()

// ── 3. Refresh the stale access token ─────────────────────

export async function refreshTheStaleAccessTokenFromTheCachedRefreshToken(
  refreshToken,
)

async function postTheOAuthTokenGrant(form, grant) // "jwt" | "refresh"
function foldTheTokenResponseOrRefuseWithoutAccessTokenOrExpiry(payload)
function logThatATokenWasMintedWithoutLoggingTheToken(message, token)

// ── 4. Forget the cached token ────────────────────────────

export async function forgetTheCachedRingCentralToken()
export function theTokenStoreThisProcessAlreadyChose()
```

Read the primary path out loud: *Look in the cache. If the access token still has more than two minutes, hand it back and do not call RingCentral. If it is stale and the refresh token still has more than two minutes, refresh, persist, and hand the new token back. If refresh fails, forget the cache. If there was no usable refresh token, or after that forget, exchange the company JWT, persist, and hand that token back. After a 401 the HTTP client forgets first, then exchanges JWT, then retries the business call once. Never log the token. Never create a Call Lead.*

That is the operation. `getValidToken` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`refreshAccessToken` is a public export with no external caller.** Only `handThisProcessALiveRingCentralAccessToken` **asks** it. Keep the one-line alias. Do not teach skipped client to refresh on `401` — the 401 story is forget-then-JWT.

2. **`getRingCentralTokenStore` has no importer in this checkout.** Do not invent a status route that returns the store. Operator probes may keep the alias. Do not log `access_token` from it.

3. **After `del()`, `getValidToken` would also JWT.** Skipped client still **asks** `exchangeJwtForToken` explicitly. That is the 401 **seam** (“do not refresh after 401”), not a second grant. Do not silently collapse skipped client to `forget` + `getValidToken` in this rename without a paired client test. After `del()` the outcomes match today; the names should keep the 401 path readable.

4. **The token store is a module-load singleton.** `createTokenStore()` runs at import. Tests cannot inject a store. `RC_TOKEN_STORE` must be set before the first import. Do not silently lazy-init so “tests can swap” without a paired interface test.

5. **OAuth HTTP is not skipped `ringCentralRequest`.** This file POSTs `/restapi/oauth/token` with Basic + form. Skipped client POSTs business paths with Bearer + JSON. Do not merge them so “one fetch owns RingCentral.” A 401 on OAuth is a grant failure (`RingCentralAuthError`), not a Bearer retry.

6. **`readJson` swallows parse errors and returns `{}`.** The later fold then throws “did not include access_token.” Do not silently throw on parse in this rename — that changes the failure string callers may already match.

7. **`logTokenSummary` already omits secrets.** Keep that. Do not add `raw` to the log line so “the owner can see the payload.”

8. **Leave sibling stores alone.** Skipped `MongoTokenStore` creates a unique `{ key }` index and a TTL on `refresh_token_expires_at_date` at runtime. Already-recommended Call Log state store refuses to create its unique index at runtime. Do not “fix” token-store indexes in this pass. Do not pull `mongo-token-store.ts` / `file-token-store.ts` into this file.

9. **Do not silently mint on every call.** The 120-second buffer is the reuse **seam**. The integration rule already names it. Reorder or shrink it only as a separate, tested change.

## Testing

The **interface** is the test surface: `handThisProcessALiveRingCentralAccessToken` (`getValidToken`), `exchangeTheCompanyJwtForANewAccessToken`, `forgetTheCachedRingCentralToken`. `refreshAccessToken` stays exported because a file test may mint a refresh grant without going through JWT — not because skipped client should call it.

There is **no** `auth.test.ts` today. A later implementer must prove the operation, not `toNumber`.

**Reuse**
- A cache whose `access_token_expires_at` is more than 120 seconds away is returned with **no** OAuth POST.
- A cache that expires in 119 seconds is **not** reused.

**Refresh**
- Stale access + refresh still good → `grant_type=refresh_token`, persist, return the new cache.
- Refresh `RingCentralAuthError` → `del`, then JWT grant, persist.
- Refresh expired / missing → JWT grant, no refresh POST.

**JWT**
- `exchangeJwtForToken` POSTs `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer` and persists.
- A non-OK OAuth response throws `RingCentralAuthError` with `status` and does not persist.
- A 200 without `access_token` or with `expires_in <= 0` throws and does not persist.

**Forget**
- `clearRingCentralTokenCache` **asks** `del`. The next `getValidToken` mints from JWT.

**Never leak**
- Succeeded / failed logs carry scope, owner, expiry, grant, status — never `access_token`, `refresh_token`, `RC_JWT`, `RC_CLIENT_SECRET`, or `Authorization`.
- This file never **asks** already-recommended promote, already-recommended sweep, or Detailed Call Log.

Skipped `client.ts` owns the 401 retry proof (clear → JWT → one retry). Do **not** add that as this file’s test. Wave B cron proves cron secrets, not this **interface**.

Do **not** add a test per helper (`theCachedAccessTokenStillHasMoreThanTwoMinutes`, `foldTheTokenResponseOrRefuseWithoutAccessTokenOrExpiry`, `toNumber`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

## What I would not do

- A `RingCentralAuthService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `token.ts`) for cleanliness.
- Breaking the 401 forget-then-JWT **seam**. A Bearer 401 must not refresh the same cache and retry forever.
- Treating skipped client, skipped token stores, already-recommended sweep, already-recommended Analytics, leftover registry validation, or Wave B cron HTTP as this story.
- Inventing a **seam** that has only one **adapter**.
- Silently “fixing” a known order gap while recommending a rename: do not log tokens; do not return tokens from a route; do not merge OAuth fetch into skipped `ringCentralRequest`; do not lazy-init the store; do not create Call Log / Analytics / promote from a mint; do not move mongo-token-store runtime indexes into this file; do not shrink the 120-second buffer.
- Jumping to the next service while this one has unchecked modules.
- Writing a whole-folder recommendation for `ringcentral`.
