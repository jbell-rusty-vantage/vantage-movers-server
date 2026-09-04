# Say Who This Registry Call Is Speaking As — Refuse A Read Unless They Are A Signed Owner Or Admin, Or An Unsigned Preview Read When That Hatch Is On, Or An Extension Owner Bearer For Catalog — Refuse A Mutation Unless They Are A Signed Owner, Or An Extension Owner Bearer Creating Or Correcting An Agent — Never Let Unsigned Preview Authorize A Write — Never Let Sales Or Employee Speak — Never Check The Drive Owner Email — Never Write A Registry Change — operational story

- Status: recommended
- Service: `operationsRegistry` (Wave A, in-progress)
- Pass: 13 of this service — `trustedActor.ts`
- Remaining in this service: `registryAudit.ts`, `runtimeTelemetry.ts`, `queries/overview.ts`, `queries/health.ts`, `queries/changes.ts`
- Target: `src/services/operationsRegistry/trustedActor.ts`
- Knowledge: [`docs/knowledge/services/operations-registry.md`](../../../docs/knowledge/services/operations-registry.md) (Authorization and audit: approved signed dashboard roles may read; only a verified Owner may mutate; HTTP mutations require a signed Owner actor). Software rule: [`.cursor/rules/operations-registry.mdc`](../../../.cursor/rules/operations-registry.mdc) (canonical signing is admin ID, normalized email, role, timestamp, request ID, HTTP method, and path using `VANTAGE_ADMIN_PROXY_SIGNING_SECRET`; replay-window and preview compatibility live in leftover `config.ts`; never document secret values). Already-recommended Drive extra check: [recommendations/google-drive-oauth-owner-auth.md](google-drive-oauth-owner-auth.md) (**asks** `requireRegistryOwnerActor` then compares `actorLabel` to `GOOGLE_OAUTH_OWNER_EMAIL`; this file does **not** know that email). Already-recommended Agent write: [recommendations/operations-registry-catalog-registry.md](operations-registry-catalog-registry.md) (Owner actor on every write — this file is who that actor is, not the card write). Already-recommended Granot name / SMS / automation-pointer writes all **ask** leftover `withRegistryMutation` after Wave B already passed this gate. Skipped sibling: `trustedActorCanonical.ts` (header names + canonical newline payload). Leftover next: `registryAudit.ts` (`withRegistryMutation`). Skipped: `config.ts` (secret / max-age / preview hatch), `snapshotSanitizer.ts` (bounded audit redact — **not** this file’s unused `redactSensitiveActorSnapshot`), `types.ts` (`RegistryActorContext`). Wave B `requireApiSecret` is the API-secret / Bearer **adapter** this file reads as `auth`; it does **not** decide Registry role. This checkout’s `CONTEXT.md` does not define signed actor / Owner / Admin — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: Wave B `v1.routes.ts` (catalog / sources / CPL / Granot names / registry overview). Wave B `granot-lifecycle-admin.routes.ts`, `ringcentral-registry.routes.ts`, `reporting.routes.ts`, `ingestion.routes.ts`, `granot-automation.routes.ts`, `job-number-timeline-admin.routes.ts`, `conversations-admin.routes.ts` (Owner or Owner/Admin mounts). Already-recommended Drive gate **asks** `requireRegistryOwnerActor`. Operator script `scripts/api/vantageApi.ts` **asks** `signAdminActorPayload` + skipped header names (does **not** verify). Barrel: `operationsRegistry/index.ts`. Tests: `trustedActor.test.ts` (signed Owner/Admin, expired / tampered / method-path miss, unsigned preview never mutates, extension Owner catalog read + Agent create, extension Employee miss). Route tests (`granot-lifecycle-admin`, `conversations-admin`, `job-number-timeline-admin`, Drive `ownerAuth.test.ts`) **ask** `computeAdminActorSignature` to mint headers. Leftover `registryAudit.ts` / skipped `snapshotSanitizer.ts` **do not import this file**.
- Seams callers need: say-who (`verifyRegistryActor` on method / path / headers / optional Bearer) vs HTTP refuse-read / refuse-mutate (`requireRegistryReadActor` / `requireRegistryOwnerActor` on `Request`); signed dashboard HMAC vs unsigned preview read vs extension Owner Bearer; `requireOwner` vs read; script/test HMAC mint (`signAdminActorPayload` / `computeAdminActorSignature`) vs this file’s verify. There is no persist **seam**. Drive-owner-email is **not** this **seam**.
- Split later (only if the file outgrows one sitting): this ~342-line file is one sitting if you read it as say who this Registry call is speaking as — refuse a read unless they are a signed Owner or Admin, or an unsigned preview read when that hatch is on, or an extension Owner Bearer for catalog — refuse a mutation unless they are a signed Owner, or an extension Owner Bearer creating or correcting an Agent — never let unsigned preview authorize a write — never let Sales or Employee speak — never check the Drive owner email — never write a Registry Change. If it later splits: `sayWhoThisRegistryCallIsSpeakingAs.ts` / `refuseThisRegistryReadUnlessTheyMaySpeak.ts` / `refuseThisRegistryMutationUnlessASignedOwnerIsSpeaking.ts` — story files, never `create.ts` / `update.ts` / `delete.ts` / `auth.ts` / `middleware.ts`, and never merge skipped canonical payload, leftover `config.ts`, leftover `registryAudit.ts`, skipped `snapshotSanitizer.ts`, already-recommended Drive email check, Wave B `requireApiSecret`, or Wave B route mounts into this file

`verifyRegistryActor` / `requireRegistryReadActor` / `requireRegistryOwnerActor` are executor mechanics. The owner question is: *Someone just hit a Registry route. Say who they are speaking as. A signed dashboard Owner or Admin may read. Only a signed Owner may mutate. An unsigned preview hatch may stand in for a signature on a read, never on a write, and never when leftover live-runtime check is true. An extension Owner Bearer may read catalog and may create or correct an Agent without HMAC; every other mutation still needs the signed dashboard Owner. Sales and Employee cannot speak. Prefer a present HMAC over the extension Bearer. This file does not write a Registry Change. This file does not forget caches. This file does not check the Drive owner email. This file does not flatten an audit snapshot.*

Skipped canonical payload, leftover env toggles, leftover `withRegistryMutation`, skipped audit redact, already-recommended Drive email check, Wave B `requireApiSecret`, and Wave B route mounts already live in other **modules**. Do not pull those in.

## What this file actually does

Three operations of one “say who this Registry call is speaking as — refuse a read unless they are a signed Owner or Admin, or an unsigned preview read when that hatch is on, or an extension Owner Bearer for catalog — refuse a mutation unless they are a signed Owner, or an extension Owner Bearer creating or correcting an Agent — never let unsigned preview authorize a write — never let Sales or Employee speak — never check the Drive owner email — never write a Registry Change” story, not “an auth CRUD helper,” and not leftover audit / leftover Drive email:

1. **Say who this Registry call is speaking as** — `verifyRegistryActor`. Fold the path through skipped `normalizeAdminPath`. If there is no signature and `auth` is an extension `user` whose role is `owner`, return that Owner (`requestId` from the header or `extension:${userId}`). On a read, that is enough. On a mutation, only `POST /api/v1/admin/agents` and `PATCH /api/v1/admin/agents/:24-hex` are enough — every other write falls through. A mutation then always **asks** the signed-dashboard beat (`requireOwner: true` even when the preview hatch is on). A read with a signature, or without the leftover preview hatch, **asks** the same signed beat. A read with the hatch and no signature **asks** the unsigned-preview beat. Signed beat: leftover `getAdminProxySigningSecret` missing → `ACTOR_SIGNATURE_MISSING`. Any of user id / email / role / request id / timestamp / signature missing → same code. Role must be `owner` or `admin` (skipped `APPROVED_REGISTRY_READ_ROLES`); anyone else → `FORBIDDEN`. `requireOwner` and role `admin` → `FORBIDDEN` (`Registry mutations require an Owner actor.`). Timestamp must be digits; stale beyond leftover max-age → `ACTOR_SIGNATURE_EXPIRED` with `action: "retry"`. Canonical payload (skipped `buildCanonicalAdminActorPayload`) HMAC must match in constant time → else `ACTOR_SIGNATURE_INVALID`. Returns `{ actorType, actorId, actorLabel: normalizeAdminEmail(email), actorRole, requestId }`. Unsigned-preview beat: same four headers required (no timestamp / signature); same role / Owner rules; if `auth.kind === "user"` and `auth.role === "owner"`, prefer the Bearer `userId` / email over the headers. This beat does **not** write HTTP. This beat does **not** persist. This beat does **not** compare `GOOGLE_OAUTH_OWNER_EMAIL`.

2. **Refuse this Registry read unless they may speak** — `requireRegistryReadActor(req, auth)`. Read leftover dashboard headers off `Request`, fold `originalUrl` / `url` without query, **ask** operation 1 with `requireOwner: false`. Wave B GET / list / detail / health / dependencies mounts this. Catalog Agent GET is how the extension Owner Bearer enters operation 1 without HMAC.

3. **Refuse this Registry mutation unless a signed Owner is speaking** — `requireRegistryOwnerActor(req, auth)`. Same headers and path fold; **ask** operation 1 with `requireOwner: true`. Wave B POST / PATCH / activation / Granot / reporting / ingestion / conversations mounts this. Already-recommended Drive gate **asks** this and then adds the configured-email check. The extension Owner Bearer may pass only on the two Agent catalog write paths.

There is no persist operation. There is no Drive-email operation. There is no audit-snapshot operation. HMAC mint (`computeAdminActorSignature` / `signAdminActorPayload`) is the dashboard-proxy **adapter** for tests and `vantageApi({ signAdmin: true })`, not a fourth owner story. `verifyAdminActorSignature` is the constant-time compare those two share. `readAdminActorHeaders` is the HTTP header fold operations 2–3 share. `redactSensitiveActorSnapshot` is an unused top-level key redact — skipped `snapshotSanitizer.ts` already owns bounded audit redact.

Do not export `verifySignedActor` / `verifyPreviewUnsignedActor` / `extensionOwnerActor` / `isExtensionOwnerCatalogMutationPath` as a public **seam**. Do not export `assertApprovedReadRole` as domain language for “Sales is forbidden.”

## Organization

Keep one file as the screenplay for “say who this Registry call is speaking as, refuse a read unless they are a signed Owner or Admin or an unsigned preview read when that hatch is on or an extension Owner Bearer for catalog, refuse a mutation unless they are a signed Owner or an extension Owner Bearer creating or correcting an Agent, never let unsigned preview authorize a write, never let Sales or Employee speak, never check the Drive owner email, never write a Registry Change.” Skipped canonical payload, leftover `config.ts`, leftover `registryAudit.ts`, skipped `snapshotSanitizer.ts`, already-recommended Drive email check, Wave B `requireApiSecret`, and Wave B route mounts already live in deeper **modules**. Do not pull those in. Do not invent a `TrustedActorService` class. Do not invent a persist / finalize **seam** here — this file never writes Mongo. Do not invent a Drive-email **adapter** beside already-recommended `ownerAuth.ts`. Do not invent a second HMAC **adapter** beside skipped `buildCanonicalAdminActorPayload`. Do not invent a second redact **adapter** beside skipped `sanitizeRegistrySnapshot`.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `auth.ts` / `middleware.ts`. Those are HTTP verbs / framework nouns, not the owner story. Do not move skipped header names into this file so “one file owns the proxy contract.” Do not move leftover preview / max-age env into this file so “the gate owns config.” Do not move already-recommended Drive email here so “Registry Owner is enough for Drive.” Do not move leftover `withRegistryMutation` here so “the actor write owns audit.” Do not silently let unsigned preview authorize a write so “local dashboard can mutate.” Do not silently widen the extension path to Source Companies or Granot names so “the extension can run Registry.”

**External interface** stays small (this is the test surface). Say-who, refuse-read, and refuse-mutate are one story’s speaking gate, not three CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `verifyRegistryActor` | `sayWhoThisRegistryCallIsSpeakingAs` | tests and any later non-HTTP caller need the actor / throw without writing `res` |
| `requireRegistryReadActor` | `refuseThisRegistryReadUnlessTheyMaySpeak` | Wave B GET / list / detail mounts |
| `requireRegistryOwnerActor` | `refuseThisRegistryMutationUnlessASignedOwnerIsSpeaking` | Wave B mutations; already-recommended Drive gate |
| `computeAdminActorSignature` | `signThisDashboardActorAsTheAdminProxyWould` | this file’s tests + Wave B route tests mint headers |
| `signAdminActorPayload` | `signThisCanonicalDashboardPayload` | `scripts/api/vantageApi.ts` already built the skipped payload |
| `verifyAdminActorSignature` | `theSignaturesMatchInConstantTime` | tests lock length-mismatch + hex case fold |
| `readAdminActorHeaders` | `readTheDashboardActorHeaders` | operations 2–3; keep as alias |
| `redactSensitiveActorSnapshot` | keep as alias only | unused at runtime; do not promote |

Keep the old names as one-line aliases until Wave B routes, already-recommended Drive, `vantageApi.ts`, and the tests migrate. Do not make callers learn `requireOwner` / `hasSignature` / `ACTOR_SIGNATURE_MISSING` as the domain language.

**Principle: old exports stay as aliases.** `requireRegistryOwnerActor` remains the imported name until Wave B mutations and already-recommended Drive point at the story name. Persisted header names (`x-vantage-admin-*`) and leftover error codes stay those strings — they are the dashboard-proxy contract and HTTP bodies, not story names.

**No class for the workflow.** The type that *does* earn a name is the leftover actor this file already returns (today `RegistryActorContext` in skipped `types.ts`):

```ts
type WhoThisRegistryCallIsSpeakingAs = {
  actorType: "owner" | "admin"
  actorId: string
  actorLabel: string // already normalizeAdminEmail
  actorRole: "owner" | "admin"
  requestId: string
}
```

That is the handoff from “this process may continue this Registry call” to “leftover `withRegistryMutation` can stamp the Change, or already-recommended Drive can compare the email.” Do **not** add `kind: "scoped_key"` onto this type so “integrations can mutate Registry.” Do **not** add `google_email` so “the connected Google account is the person.” Do **not** store this bag on `req` in this rename — Wave B reads the return value.

Do not add `buildCanonicalAdminActorPayload` as a public **seam** on this file — skipped `trustedActorCanonical.ts` already owns the newline contract. Do not add `isOperationsRegistryPreviewUnsignedAllowed` as a public **seam** — leftover `config.ts` already owns the hatch. Do not add `sanitizeRegistrySnapshot` as a public **seam** — skipped `snapshotSanitizer.ts` already owns bounded redact. Do not add `enforceGoogleDriveOwnerAccess` as a public **seam** — already-recommended Drive already owns HTTP stop.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// trustedActor.ts
// Someone just hit a Registry route.
// Say who they are speaking as.
// A signed dashboard Owner or Admin may read.
// Only a signed Owner may mutate.
// An unsigned preview hatch may stand in for a signature
// on a read, never on a write, and never when leftover
// leftover live-runtime check is true.
// An extension Owner Bearer may read catalog and may
// create or correct an Agent without HMAC.
// Every other mutation still needs the signed dashboard Owner.
// Prefer a present HMAC over the extension Bearer.
// Sales and Employee cannot speak.
// This file does not write a Registry Change.
// This file does not check the Drive owner email.

// ── 1. Say who this Registry call is speaking as ──────────

export function sayWhoThisRegistryCallIsSpeakingAs(input)

function thereIsADashboardSignature(headers)
function thisIsAnExtensionOwnerBearer(auth)
function thisIsTheNarrowAgentCatalogWrite(method, path)
function sayTheyAreTheExtensionOwner(auth, requestId)
function refuseUnlessTheRoleMayReadTheRegistry(role)
function refuseUnlessTheyAreOwnerWhenTheCallMutates(role, requireOwner)
function refuseUnlessTheDashboardSignatureIsLiveAndMatches(input)
function refuseUnlessTheUnsignedPreviewHeadersArePresent(input)

// ── 2. Refuse this Registry read unless they may speak ────

export function refuseThisRegistryReadUnlessTheyMaySpeak(req, auth)

// ── 3. Refuse this Registry mutation unless a signed Owner is speaking

export function refuseThisRegistryMutationUnlessASignedOwnerIsSpeaking(req, auth)

function readTheDashboardActorHeaders(req)
function foldTheRequestPathWithoutQuery(req)

// dashboard-proxy adapter (tests + vantageApi) — not a fourth owner story
export function signThisDashboardActorAsTheAdminProxyWould(fields, secret)
export function signThisCanonicalDashboardPayload(payload, secret)
export function theSignaturesMatchInConstantTime(provided, expected)
```

Read the primary path out loud: *Someone hit a Registry route. Fold the path. If there is no HMAC and they are an extension Owner Bearer, let them read; if this is create or correct an Agent, let them mutate. Otherwise a mutation always needs a signed Owner — unsigned preview never writes, even locally. A read with a signature, or without the preview hatch, needs a signed Owner or Admin whose HMAC matches the canonical payload inside the replay window. A read with the hatch and no signature still needs the dashboard headers. Sales and Employee cannot speak. Do not write a Registry Change. Do not check the Drive owner email.*

That is the operation. `verifyRegistryActor` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Unsigned preview never writes.** Leftover `isOperationsRegistryPreviewUnsignedAllowed` is read-only. `requireOwner: true` always **asks** the signed beat, including in `NODE_ENV=test` with the hatch on. Do not silently let a local unsigned Owner mutate so “preview can stamp cards” without a paired mutation-forbidden test.

2. **A present HMAC wins over the extension Owner Bearer.** `hasSignature` skips the extension beat entirely. A dashboard Admin signature on a catalog GET is an Admin, even if the Bearer is Owner. Do not silently prefer Bearer so “the session is the person” without a paired signed-vs-Bearer test.

3. **Extension Employee / Sales fail as `ACTOR_SIGNATURE_MISSING`, not `FORBIDDEN`.** They never reach `assertApprovedReadRole`. A signed dashboard `sales` header *does* reach `FORBIDDEN`. The same person, two codes. Do not silently swap the extension miss to `FORBIDDEN` so “one refuse code” without a paired extension + signed-role test. Do not silently start treating `customer_service` as a read role.

4. **The Agent PATCH path is untested.** Operation 1 allows `PATCH /api/v1/admin/agents/:24-hex` for the extension Owner. Tests lock POST create, not PATCH correct, and not a 23-character or uppercase-hex miss. Do not silently drop PATCH so “create is enough” without a paired catalog-write test. Do not silently add Source Company / Granot name paths so “the extension can run Registry.”

5. **Unsigned preview + Owner Bearer prefers the Bearer identity.** `verifyPreviewUnsignedActor` overwrites header `adminId` / email with `auth.userId` / `auth.email` when the Bearer is Owner. Two people can be in one request. Do not silently always keep the headers so “the dashboard proxy is the person” without a paired identity test.

6. **`redactSensitiveActorSnapshot` is unused and thinner than skipped sanitizer.** Top-level keys only; pattern omits `credential` / `signing`. Barrelled, never imported by leftover `registryAudit.ts`. Do not silently delete it from this rename without a paired “no caller” check. Do not silently route audit snapshots through it so “the actor file owns redact.”

7. **Signed and unsigned beats copy the Owner-role refuse.** `assertApprovedReadRole` plus `requireOwner && role !== "owner"` appear twice. Shared refuse is fine; do not extract a third public **seam**. Do not silently let signed `admin` mutate when `requireOwner` is true.

8. **Leave sibling modules alone.** Skipped `buildCanonicalAdminActorPayload`, leftover `getAdminProxySigningSecret` / `isOperationsRegistryPreviewUnsignedAllowed`, leftover `withRegistryMutation`, skipped `sanitizeRegistrySnapshot`, and already-recommended `requireGoogleDriveOwnerActor` are already the right **depth**. This file orchestrates who may speak.

9. **Do not silently change persisted header names or leftover error codes.** `x-vantage-admin-*` and `ACTOR_SIGNATURE_*` / `FORBIDDEN` are the dashboard-proxy contract. Story names live on the functions.

## Testing

The **interface** is the test surface: `sayWhoThisRegistryCallIsSpeakingAs`, `refuseThisRegistryReadUnlessTheyMaySpeak`, `refuseThisRegistryMutationUnlessASignedOwnerIsSpeaking`. HMAC mint stays exported because scripts and route tests are a second real **adapter**, not a test leak.

Today `trustedActor.test.ts` already proves signed Owner, signed Admin read, Admin mutation `FORBIDDEN`, missing headers, expired replay window, tampered / method-path miss, constant-time compare, unsigned preview disabled when leftover live-runtime check is true, unsigned preview never mutates, unsigned preview still needs a request id, extension Owner catalog GET, extension Owner Agent POST, extension Owner cannot POST Source Companies, extension Employee is not an actor. Keep those. Add tests that name the operation:

**Say who this Registry call is speaking as**
- Signed Owner → `actorRole: "owner"`, `actorLabel` is folded email (already on disk — keep it).
- Signed Admin read → `actorRole: "admin"` (already on disk — keep it). Signed Admin mutation → `FORBIDDEN` (already on disk — keep it).
- Signed `sales` / `employee` / `customer_service` → `FORBIDDEN` (`Registry access is not permitted for this role.`). Add this; today only Admin-vs-Owner is locked.
- Missing signing secret → `ACTOR_SIGNATURE_MISSING` even when every header is present.
- Non-digit timestamp → `ACTOR_SIGNATURE_INVALID`. Keep digits-only until a paired ISO-timestamp change.
- Extension Owner `PATCH /api/v1/admin/agents/:24-hex` without HMAC succeeds today. Add that. A path that is not 24 hex still needs a signature.
- Extension Owner + present HMAC → the signed dashboard person wins (Admin signature stays Admin).
- Extension Employee / Sales catalog GET → `ACTOR_SIGNATURE_MISSING` today (already Employee on disk — keep the code until a paired `FORBIDDEN` change).
- Unsigned preview mutation → `ACTOR_SIGNATURE_MISSING` even with hatch + Owner headers (already on disk — keep it).
- Leftover live-runtime check + hatch on → still refuses unsigned (already on disk — keep it).

**Refuse this Registry read / mutation (HTTP adapters)**
- `refuseThisRegistryReadUnlessTheyMaySpeak` on a catalog GET with extension Owner Bearer returns the extension Owner.
- `refuseThisRegistryMutationUnlessASignedOwnerIsSpeaking` on `POST /api/v1/admin/source-companies` with extension Owner Bearer still throws `ACTOR_SIGNATURE_MISSING`.
- Do not retest already-recommended Drive email mismatch here. That lives on `ownerAuth.test.ts`.

Do **not** add a test per helper (`thereIsADashboardSignature`, `thisIsTheNarrowAgentCatalogWrite`, `refuseUnlessTheDashboardSignatureIsLiveAndMatches`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** retest leftover `withRegistryMutation` order, leftover `sanitizeRegistrySnapshot` depth, leftover preview env parsing, or already-recommended Drive canned 403 here. Those already have (or will have) their own interface tests. Wave B **asks** this gate; prove the gate, not the route table.

## What I would not do

- A `TrustedActorService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `verifySignedActor`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `auth.ts` / `middleware.ts`) for cleanliness.
- Breaking the signed-mutation / unsigned-preview-read-only **seam**. A failed audit is leftover `registryAudit.ts`; a missing HMAC must not become an Owner.
- Treating leftover `registryAudit.ts`, leftover `config.ts`, skipped canonical payload, skipped `snapshotSanitizer.ts`, already-recommended Drive email check, Wave B `requireApiSecret`, Wave B route mounts, or `vantageApi` live-write confirm as this story.
- Inventing a **seam** that has only one **adapter**.
- Silently "fixing" a known gap while recommending a rename: do not let unsigned preview mutate; do not prefer Bearer over a present HMAC; do not swap extension Employee/Sales to `FORBIDDEN` without a paired test; do not drop the untested Agent PATCH path; do not widen the extension path to other Registry writes; do not delete unused `redactSensitiveActorSnapshot` without a paired check; do not route audit snapshots through it; do not merge Drive email into this file; do not rename persisted `x-vantage-admin-*` headers or leftover `ACTOR_SIGNATURE_*` codes.
- Jumping to the next service while this one has unchecked modules.
- Writing a whole-folder recommendation for `operationsRegistry`.
