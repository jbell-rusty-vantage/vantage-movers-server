# Hand This HTTP Request A Trusted Vantage Admin Bag — Mint A Command Id And Checksum First, Then Name The Speaker From The Already-Judged Auth: Owner Extension User, Admin Headers Plus API Secret, Scoped-Key Fingerprint, Or The Compatibility API-Secret System Actor — Never Trust A Client Actor Field, Never Store A Credential, Never Build Granot Or RingCentral Provenance, Never Connect Mongo, Never Apply — operational story

- Status: recommended
- Service: `domainCommands` (Wave A, in-progress)
- Pass: 5 of this service — `existingWriteContext.ts`
- Remaining in this service: `existingWrites.ts`, `bookings.ts`
- Target: `src/services/domainCommands/existingWriteContext.ts`
- Knowledge: [`docs/knowledge/services/domain-commands.md`](../../../docs/knowledge/services/domain-commands.md) section **Compatibility context** (`applies_to` names this file). Distinct from who may speak: already-recommended [domain-commands-command-context.md](domain-commands-command-context.md) — that file **judges** a bag this file **builds**; this file never **asks** `assertCommandContext`. Distinct from apply-once / replay / after-commit finalize: already-recommended [domain-commands-idempotency.md](domain-commands-idempotency.md) — later adapters **ask** that executor with this bag; this file never applies. Distinct from telephony proof: already-recommended [domain-commands-ringcentral-provenance.md](domain-commands-ringcentral-provenance.md) — RingCentral is never this origin. Distinct from append-only Entity Change: already-recommended [domain-commands-entity-change.md](domain-commands-entity-change.md). Distinct from public Form/Call/Booking/Cancellation adapters: later `existingWrites.ts` (they **receive** this bag). Distinct from exact `updateBooking` / attach: later `bookings.ts`. Distinct from Wave B `requireVantageAuth` — that **adapter** already set `req.vantageAuth`; this file only reads it. Distinct from Registry HMAC: already-recommended [operations-registry-trusted-actor.md](operations-registry-trusted-actor.md) — that file verifies `x-vantage-admin-signature`; this file reads user-id / email / role only. Distinct from leftover Employee Booking submit: already-recommended [employee-bookings-submit-employee-booking.md](employee-bookings-submit-employee-booking.md) — that path never **asks** this factory. Distinct from actor factories: `durableWork/actors.ts` (Wave A, still unvisited — do not open; Best Relocation / Granot / RingCentral speakers live there). Distinct from the thin registry object: `index.ts` (skipped on open; **this file is re-exported** so routes can build the bag). Checked-in Granot Lead-write / Booking / Release / Referral effect flags stay false — do not describe those Owner paths as live. This checkout’s `CONTEXT.md` is a pointer to a parent glossary that is not in this tree — do not invent “Durable Actor” / “Command Origin” copies. `docs/adr/` is absent here — do not invent ADR-0001 copies. Do not add this path to knowledge in this rename.
- Callers: **one runtime factory, plus two compatibility actor builders for tests.** Wave B `v1.routes.ts` `handleCanonicalCreate` / `handleCanonicalUpdate` / `handleCanonicalDelete` **ask** `existingWriteContextFromRequest` for Call / Booking / from-source / Referral / Leadless / Cancellation create, Call / Booking / Cancellation correct, and Form / Call / Booking / Cancellation delete. The same file’s Form create / Form correct handlers **ask** it by name (not through the helper). Barrel `domainCommands/index.ts` **does** re-export this file — that is load-bearing. Later `existingWrites.ts` and later `bookings.ts` **receive** the bag; they do not import this file. Already-recommended executor / speaker-gate never import this file. Tests: `existingWriteContext.test.ts` (Owner JWT maps; Owner+Sales maps; Sales / Customer Service / both refuse). `domainCommands.test.ts` AC-21 (compatibility API-secret and scoped-key actors pass `vantage_admin`) and AC-32 (actor JSON has no secret; v1 routes name this factory). `entityChange.integration.test.ts` **asks** `createVantageApiSecretActor` as a fixture. Not this **interface**: `assertCommandContext`, `executeCanonicalCommandWithPostCommit`, `runExistingCreateFormLead`, `durableActorFromRegistryActor`, leftover Employee submit.
- Seams callers need: HTTP bag **here** vs speaker-gate **next door**; already-set `vantageAuth` vs this read; minted command id / idempotency / checksum **here** vs apply-or-replay **later**; compatibility system ids this file mints vs speaker-gate accepts. There is no Granot **adapter**. There is no RingCentral **adapter**. There is no HMAC **adapter**. There is no Sheet **adapter**.
- Split later (only if the file outgrows one sitting): keep one file — this is already one sitting (~180 lines). If it later splits: `handThisHttpRequestATrustedVantageAdminBag.ts` — never `create.ts` / `update.ts` / `delete.ts` / `actor.ts` / one file per auth kind. Speaker-gate, apply-once, public adapters, Registry HMAC, and leftover `durableWork/actors.ts` stay siblings / other services.

`existingWriteContextFromRequest` is executor mechanics. The owner question is: *A public v1 write already passed Wave B auth. The body named a Form Lead, Call Lead, Booking, or Cancellation — it did not name who may speak. Before later adapters apply the named command, hand that request a trusted Vantage Admin bag. Mint a server ObjectId command id. If the body carried a non-empty `submission_id`, the idempotency key is `existing:{command_name}:{that id}`; otherwise it is `request:{command_name}:{this request}`. Checksum the canonical `{command_name, resource_id, payload}` — never the API secret. Then name the speaker from `req.vantageAuth`, not from the body: an Owner extension user; or API secret plus `x-vantage-admin-user-id` / email / role `owner` or `admin`; or the scoped-key fingerprint already on auth; or the compatibility `vantage-api-secret` system actor. Actor and initiator are the same snapshot. Provenance origin is always `vantage_admin` with empty run / receipt / connection. Sales, Customer Service, and leftover Employee cannot build this bag. A client cannot supply actor, origin, or command id. This file does not connect. This file does not apply. This file does not judge Granot or RingCentral.*

Who may speak, who applies the named command, who appends Entity Change, and who mutates the Lead or Booking already live in other **modules**. Do not pull those in.

## What this file actually does

Two operations of one “hand this HTTP request a trusted Vantage Admin bag” story, not “a context helper,” and not Apply This Named Command Once / Say Whether This Speaker May Issue This Command / Form Lead Ingestion:

1. **Name this HTTP write** — mint `command_id` as a fresh ObjectId hex (`new mongoose.Types.ObjectId()`, no `connect`). Read the request id from `req.id`, then `x-request-id`, then mint. If `payload.submission_id` is a non-empty string, idempotency is `existing:{command_name}:{submission_id}`; otherwise `request:{command_name}:{requestId}`. Checksum is SHA-256 of canonical JSON `{ command_name, resource_id, payload }` (dates as ISO, keys sorted, `undefined` omitted). `resource_id` is the route id on correct / delete, else `null`. This beat does not hash a credential. This beat does not read `wordpress_submission_key`.

2. **Name the speaker from already-judged auth** — `compatibilityActorFromAuth` walks `req.vantageAuth` in this order. `kind: "user"` plus `hasExtensionRole(..., "owner")` → owner Durable Actor (`actor_id` = user id, `actor_label` = email). Any other extension role throws `DomainCommandContextError` (“Existing write commands require an owner or admin actor.”). `kind: "secret"` plus complete `x-vantage-admin-user-id` / email / role `owner` or `admin` → that human (`actor_type` / `actor_role` = the header role). `kind: "scoped_key"` → `createVantageScopedApiKeyActor` from `auth.scopedKeyFingerprint` (16–64 hex or throw). Bare `kind: "secret"` → `createVantageApiSecretActor`. Missing auth throws (“trusted server-built actor”). Actor and initiator are the same object. Provenance is always `{ origin: "vantage_admin", run_id: null, source_receipt_id: null, source_connection_key: null }`.

There is no third mutate operation. `fingerprintScopedApiKey` is a leftover hash (SHA-256 hex, first 32) with **no runtime caller** — Wave B `requireVantageAuth` already stored the same slice on `scopedKeyFingerprint`. `readRequestId` / `durableBusinessKey` / `hashExistingWritePayload` / `stableJson` / `canonicalize` are folds. Re-export of the two labels is convenience, not a second story.

## Organization

Keep one file. This is the screenplay for “hand this HTTP request a trusted Vantage Admin bag.” Who may speak already lives on already-recommended `commandContext.ts`. Apply-once already lives on already-recommended `idempotency.ts`. Public adapters already live on later `existingWrites.ts`. Exact Booking replace already lives on later `bookings.ts`. HMAC already lives on already-recommended `trustedActor.ts`. Best Relocation / Granot / RingCentral speakers already live on leftover `durableWork/actors.ts`. Wave B auth already lives on `requireVantageAuth`. Do not pull those in. Do not invent an `ExistingWriteContextService` class. Do not invent a Granot **seam**. Do not invent an HMAC **seam**. Do not invent a fifth origin so “the landing page can speak as WordPress.”

Do not move this factory into `commandContext.ts` so “one file builds and judges.” Do not move `createVantageApiSecretActor` into leftover `durableWork/actors.ts` so “every system speaker shares a folder” while Wave A still has this checklist open. Do not add `assertCommandContext` here so “the route can pre-check.” Do not drop this file from `index.ts` so “routes stop importing the bag.” Do not split `create.ts` / `update.ts` / `delete.ts` or one file per auth kind.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `existingWriteContextFromRequest` | `handThisHttpRequestATrustedVantageAdminBag` | routes **ask** after Zod; later adapters **receive** the bag |
| `createVantageApiSecretActor` | `theCompatibilityApiSecretSpeaker` | AC-21 / replica fixtures; speaker-gate accepts this id |
| `createVantageScopedApiKeyActor` | `theCompatibilityScopedKeySpeaker` | same pair; refuses a blank / non-hex fingerprint |
| `fingerprintScopedApiKey` | `hashThisScopedKeyWithoutStoringIt` | leftover; Wave B already hashed — keep as alias until a caller appears |
| `VANTAGE_API_SECRET_ACTOR_LABEL` / `VANTAGE_SCOPED_API_KEY_ACTOR_LABEL` | `theCompatibilitySpeakerLabels` | stored labels; ids live on `types.ts` |

Keep the old names as one-line aliases until Wave B `v1.routes.ts` and the AC-21 fixtures migrate. Do not make callers learn `FromRequest` as the domain language.

`CanonicalCommandContext` stays on `types.ts`. Do not move the type here so “the factory owns the bag.” `VANTAGE_API_SECRET_ACTOR_ID` / `VANTAGE_SCOPED_API_KEY_ACTOR_PREFIX` stay on `types.ts` so speaker-gate and this factory share one string.

**No class for the workflow.** The one type that *does* earn a name is the bag this file always returns:

```ts
type ThisTrustedVantageAdminBag = CanonicalCommandContext & {
  // actor === initiator
  // provenance.origin === "vantage_admin"
  // run / receipt / connection always null
}
```

That is the handoff from “Wave B already judged the HTTP request” to “later adapters may apply.” Do **not** add `origin` so “sheet ingest can reuse the route.” Do **not** add `actor` on the body so “the client can attest.” Do **not** add `secret_fingerprint` on the bag so “we can audit the raw key.”

Leave the speaker-gate on `commandContext.ts`. Leave apply-once on `idempotency.ts`. Leave public adapters on `existingWrites.ts`. Leave HMAC on `trustedActor.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// existingWriteContext.ts
// A public v1 write already passed Wave B auth.
// The body named a Lead, Booking, or Cancellation — not who may speak.
// Mint a command id and a checksum.
// Name the speaker from the already-judged auth.
// Actor and initiator are the same snapshot.
// Provenance is always Vantage Admin.
// Sales cannot build this bag.
// A client cannot supply the actor.
// Do not connect. Do not apply.

// ── 1. Name this HTTP write ───────────────────────────────

export function handThisHttpRequestATrustedVantageAdminBag({
  req, command_name, payload, resource_id,
})
  const requestId = readThisRequestId(req)          // req.id → x-request-id → mint
  const speaker = nameTheSpeakerFromAlreadyJudgedAuth(req, requestId)
  return {
    command_id: mintAServerCommandId(),             // ObjectId hex; never the body
    idempotency_key: nameThisWriteOnce(command_name, payload, requestId),
    payload_checksum: checksumThisWrite({ command_name, resource_id, payload }),
    actor: speaker,
    initiator: speaker,
    provenance: emptyVantageAdminProvenance(),      // origin only; no run/receipt
  }

function nameThisWriteOnce(command_name, payload, requestId)
  const submissionId = readSubmissionId(payload)    // trim; ignore wordpress_submission_key
  return submissionId
    ? `existing:${command_name}:${submissionId}`
    : `request:${command_name}:${requestId}`

// ── 2. Name the speaker from already-judged auth ──────────

function nameTheSpeakerFromAlreadyJudgedAuth(req, requestId)
  const auth = req.vantageAuth
  if (auth?.kind === "user")
    if (!thisExtensionUserIsAnOwner(auth.roles))
      throw "Existing write commands require an owner or admin actor."
    return theOwnerExtensionSpeaker(auth, requestId)
  if (auth?.kind === "secret" && completeAdminHeaders(req))
    return theAdminHeaderSpeaker(req, requestId)    // owner | admin; no HMAC here
  if (auth?.kind === "scoped_key")
    return theCompatibilityScopedKeySpeaker({
      requestId,
      fingerprint: auth.scopedKeyFingerprint,       // already hashed next door
    })
  if (auth?.kind === "secret")
    return theCompatibilityApiSecretSpeaker(requestId)
  throw "Existing write commands require a trusted server-built actor."

export function theCompatibilityApiSecretSpeaker(requestId)
  // actor_id vantage-api-secret; origin vantage_admin

export function theCompatibilityScopedKeySpeaker({ requestId, fingerprint })
  // refuse unless 16–64 hex; id vantage-scoped-api-key:{lower}
```

Read the factory path out loud: *the route already authenticated the request and parsed the body. Mint a command id the client never chose. If this Booking carried a submission id, remember the write as that submission; otherwise remember it as this request. Checksum the command name, the resource id, and the body — never the secret. Then look at the auth the middleware already set. An Owner extension user speaks as that Owner. API secret plus complete admin headers speaks as that owner or admin. A scoped key speaks as its fingerprint, not as the key. Bare API secret speaks as the compatibility system actor. Anyone else, including Sales on a Bearer token, is refused. The bag always says Vantage Admin. Later the speaker-gate will judge it. This file does not apply the command.*

That is the operation. `existingWriteContextFromRequest` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **The file is named existingWriteContext.** It does not run an existing write. It hands the HTTP request a trusted Vantage Admin bag. The adapters that *run* the write are later `existingWrites.ts`. The file name should say the story (`handThisHttpRequestATrustedVantageAdminBag` / keep the path and alias the old file name until Wave B routes move).

2. **Knowledge says “Employee role throws.” The user path throws every non-Owner.** Sales, Customer Service, and leftover Employee all hit the same sentence. The error says “owner or admin actor,” but the JWT fold only **asks** `hasExtensionRole(..., "owner")`. `admin` is a header role, not an Extension User role. Do not silently let Sales through so “tariff-adjacent Bearer can book,” and do not rewrite the Service sentence in this rename. Parked in `CONTRADICTIONS.md`.

3. **Admin headers are not HMAC here.** Already-recommended Registry `trustedActor.ts` verifies `x-vantage-admin-signature`. This file reads user-id / email / role when `auth.kind === "secret"` and the three headers are present. Incomplete headers fall through to the API-secret system actor — they do not throw. Do not silently **ask** HMAC so “we match Registry,” and do not throw on incomplete headers so “partial admin cannot look like the system actor.”

4. **`fingerprintScopedApiKey` has no runtime caller.** Wave B `requireVantageAuth` already stores `sha256(secret).hex.slice(0, 32)` on `scopedKeyFingerprint`. This export hashes again with the same slice. Do not start hashing the raw secret inside `nameTheSpeakerFromAlreadyJudgedAuth` so “one file owns the fingerprint,” and do not delete the export so “dead code is gone” until a caller is proven unused by tests.

5. **Idempotency reads `submission_id`, not `wordpress_submission_key`.** Public Booking / from-source / Leadless bodies may carry `submission_id`. Form create carries `wordpress_submission_key` and therefore gets `request:{command_name}:{requestId}`. Leftover Employee submit has its own unique `submission_id` and never **asks** this factory. Do not silently treat `wordpress_submission_key` as the durable key so “every form is apply-once by receipt,” and do not pull leftover Employee submit in.

6. **Routes connect Mongo before this factory.** `handleCanonical*` and the Form handlers `await connectMongo()` then **ask** this export. This file mints ObjectIds and never `connect`s. Do not move `connectMongo` here so “context owns the session,” and do not teach the speaker-gate that this file already connected.

7. **The barrel exports this file.** That is load-bearing. Speaker-gate and Entity Change stay off the barrel. Do not remove the re-export so “only adapters import,” and do not add `assertCommandContext` beside it so “routes can pre-check.” A second judge would duplicate the fail-closed **seam** the executor already owns.

8. **Canonicalize is copied.** This file’s `canonicalize` / `stableJson` match already-recommended Entity Change’s fold (dates as ISO, keys sorted, `undefined` omitted). Do not silently import the Change helper so “one canonicalize owns checksum and contact,” and do not start hashing contact here.

9. **Leave sibling modules alone.** `assertCommandContext`, `executeCanonicalCommandWithPostCommit`, later `runExistingCreateFormLead`, leftover `createBestRelocationIngestionActor`, and already-recommended `resolveTrustedRegistryActor` are already the right **depth**. This file **asks** none of them except `hasExtensionRole` and the two id constants.

10. **This factory cannot speak as Granot or RingCentral.** Provenance is hardcoded `vantage_admin`. Do not add an `origin` argument so “one helper builds every bag.” Leftover Granot / RingCentral modules build their own bags and never import this file.

## Testing

The **interface** is the test surface: `handThisHttpRequestATrustedVantageAdminBag`, `theCompatibilityApiSecretSpeaker`, `theCompatibilityScopedKeySpeaker`.

Today’s `existingWriteContext.test.ts` only maps Owner JWT and refuses Sales / Customer Service. `domainCommands.test.ts` AC-21 / AC-32 prove the compatibility actors **through the executor**, plus a source scan that v1 names this factory. Keep proving the operations, not `canonicalize` / `readRequestId`. A later implementer may **ask** this export with a stubbed `Request` so a fail-closed test does not have to stand up a route — that is still the same **interface**.

**Name this HTTP write**
- Fresh `command_id` is an ObjectId hex. The body cannot choose it.
- `{ submission_id: "sub-1" }` → idempotency `existing:{command_name}:sub-1`. Empty / missing / whitespace → `request:{command_name}:{requestId}`.
- Same payload with shuffled keys → same checksum. `resource_id` on correct / delete is part of the hash. The checksum JSON must not contain the API secret or scoped-key value (today’s AC-32 actor JSON proof stays).

**Name the speaker**
- Owner JWT → `actor_type: "owner"`, `actor_id` = user id, initiator === actor, origin `vantage_admin`.
- Owner+Sales JWT → still owner (today’s test).
- Sales, Customer Service, or both → throw the owner-or-admin sentence (today’s loop).
- `kind: "secret"` plus complete owner/admin headers → that human. Incomplete headers → API-secret system actor, not throw.
- `kind: "scoped_key"` with a 32-hex fingerprint → `vantage-scoped-api-key:{lower}`. Blank fingerprint → throw.
- Bare `kind: "secret"` → `vantage-api-secret`. Missing auth → trusted-server-built-actor throw.
- Provenance run / receipt / connection are always `null`. `origin` is never `granot_lifecycle` or `ringcentral`.

**Do not add**
- A test per helper (`readThisRequestId`, `durableBusinessKey`, `canonicalize`).
- A test that `assertCommandContext` ran — that is already-recommended speaker-gate.
- A test that later `runExistingCreateFormLead` persisted a Change — that is later existing-writes.
- A test that Registry HMAC ran — that is already-recommended trusted-actor.
- A helper-unit test that has to change when `nameTheSpeakerFromAlreadyJudgedAuth` is inlined.
- A live Mongo network test.

`theCompatibilityApiSecretSpeaker` / `theCompatibilityScopedKeySpeaker` stay exported because AC-21 memory-store tests and the replica fixture are a second real **adapter**, not a test leak.

## What I would not do

- An `ExistingWriteContextService` / `HttpContextService` class with `create` / `update` / `delete` / `fromRequest`.
- Thirty two-line functions that only wrap `createHash`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or `actor.ts` / `checksum.ts` “for cleanliness.”
- Breaking the HTTP-bag-before-apply **seam**. This factory must stay ahead of later adapters and must not `connect` / persist.
- Treating Apply This Named Command Once, Say Whether This Speaker May Issue This Command, Form Lead Ingestion, leftover Granot confirm, leftover RingCentral adopt, or leftover Employee submit as this story. Those **judge**, **apply**, or **build a different bag**.
- Inventing a Granot **seam**, an HMAC **seam**, or a WordPress-receipt **seam** that has only one **adapter** inside this file.
- Silently verifying HMAC, silently treating `wordpress_submission_key` as the durable key, silently letting Sales through, silently moving the compatibility actors into leftover `durableWork/actors.ts`, or silently dropping this file from the barrel.
- Writing a whole-folder recommendation for `domainCommands`.
- Jumping to `durableWork` while this checklist still has unchecked modules.
