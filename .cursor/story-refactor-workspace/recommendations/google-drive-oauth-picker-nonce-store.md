# Look Up The Unused One-Time Picker Nonce For The Configured Owner, And Consume It Only Once After The Pick Has Already Been Proven — Never Mint The Nonce, Never Hash The Raw Ticket, Never Fetch Drive Metadata, Never Write The Bootstrap Row (Already-Recommended Picker Writes The Model Itself) — operational story

- Status: recommended
- Service: `googleDriveOAuth` (Wave A, in-progress after this pass)
- Pass: 8 of this service — `pickerNonceStore.ts`
- Remaining in this service: `pickerSelectionStore.ts`, `driveMetadata.service.ts`, `managedTab.service.ts` (`workbook.service.ts` / `picker.types.ts` / `index.ts` skipped on open; `googleDriveOAuth.service.ts` / `tokenEncryption.ts` / `oauthScopes.ts` / `oauthSecurity.ts` / `ownerAuth.ts` / `spreadsheet.service.ts` / `picker.service.ts` already recommended)
- Target: `src/services/googleDriveOAuth/pickerNonceStore.ts`
- Knowledge: none for this folder. Closest: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (Owner-gated destinations and Google workbooks as a **delivery surface** — it never names this nonce store; leftover `reportingDestination.service.ts` **asks** already-recommended `picker.service.ts` to verify / consume, which **asks** this file to find / spend the unused nonce). Distinct from already-recommended Owner pick: [recommendations/google-drive-oauth-picker.md](google-drive-oauth-picker.md) (that file hands the Picker, verifies the pick, issues the selection reference, consumes the reference, re-proves a known id — it **asks** this file on verify’s find / consume; bootstrap today writes `GooglePickerNonce.create` **itself** and does **not** call this store). Distinct from already-recommended Owner login: [recommendations/google-drive-oauth-google-drive-oauth.md](google-drive-oauth-google-drive-oauth.md) (begin / complete / live client / health / disconnect — this file never sees a refresh token). Distinct from already-recommended token lock: [recommendations/google-drive-oauth-token-encryption.md](google-drive-oauth-token-encryption.md) (AES-256-GCM + owner-email AAD — this file stores a SHA-256 **hash** leftover destination already folded, not a ciphertext bag). Distinct from already-recommended grant allowlist: [recommendations/google-drive-oauth-oauth-scopes.md](google-drive-oauth-oauth-scopes.md). Distinct from already-recommended public failure: [recommendations/google-drive-oauth-oauth-security.md](google-drive-oauth-oauth-security.md) (Wave B `sendApiError` maps already-recommended `picker_invalid_nonce` — this file returns `null`). Distinct from already-recommended signed-owner HTTP gate: [recommendations/google-drive-oauth-owner-auth.md](google-drive-oauth-owner-auth.md) (Wave B mounts that middleware **in front** of bootstrap / verify; this file never inspects `req`). Distinct from already-recommended Owner Drive create: [recommendations/google-drive-oauth-spreadsheet.md](google-drive-oauth-spreadsheet.md). Distinct from skipped `workbook.service.ts` (one-line create facade). Distinct from later `pickerSelectionStore.ts` (create / find / consume the **selection reference** — that file also resets this store in `resetPickerVerificationStoresForTests`; it is a different ticket). Distinct from skipped `picker.types.ts` (`PickerFlow` only). Distinct from later `driveMetadata.service.ts` (get metadata / accessible / owned-by-me / mime / parent — already-recommended verify **asks** those asserts **between** this file’s find and this file’s consume). Distinct from later `managedTab.service.ts`. Distinct from leftover `reporting/destinationIdentity.ts` (`hashPickerNonce` / `expectedConfiguredOwnerEmail` — already-recommended verify **asks** those folds **before** this file; this file never sees the raw nonce). Distinct from Wave B `models/GooglePickerNonce.ts` (`google_picker_nonces`: unique `nonce_hash`, TTL on `expires_at`, `consumed_at` default null — this file **asks** `findOne` / `findOneAndUpdate`; it does **not** own the schema). Distinct from Wave B `config/domain/reporting.ts` (10-minute nonce TTL — already-recommended bootstrap **asks** that clock when it writes the row). Distinct from skipped barrel `index.ts` (does **not** re-export this file — already-recommended `picker.service.ts` re-exports `InMemoryPickerNonceStore` / `setPickerNonceStoreForTests` so tests can import one path). This checkout’s `CONTEXT.md` does not define a Drive Picker / nonce-store term — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: **already-recommended verify plus the test reset. Tests lock this store through verify, not this file.** Already-recommended `picker.service.ts` — `verifyGooglePickerSelection` asks `getPickerNonceStore().findActive({ nonceHash, ownerEmail })` then, only after later metadata validates, `consumeActive({ nonceHash, ownerEmail })`; re-exports `InMemoryPickerNonceStore` / `setPickerNonceStoreForTests`. Later `pickerSelectionStore.ts` — `resetPickerVerificationStoresForTests` asks `setPickerNonceStoreForTests(undefined)`. Tests: `pickerVerification.test.ts` seeds `InMemoryPickerNonceStore`, injects it, and locks consume-after-validate / replay / concurrent one-winner on already-recommended verify (invalid mime / inaccessible leave `consumed_at` null; replay is `picker_invalid_nonce`; concurrent valid verifies yield one selection). Not this **interface**: already-recommended `bootstrapGooglePicker` (writes `GooglePickerNonce.create` after `connectMongo` — **not** this store), leftover `hashPickerNonce` (SHA-256 fold), later metadata get, later selection-reference create / find / consume, leftover destination resolve, Wave B Zod, Wave B owner gate. `pickerValidation.test.ts` locks leftover `hashPickerNonce` — that belongs on leftover `destinationIdentity.ts`, not this **interface**.
- Seams callers need: find-unused vs consume-once (verify must find, prove Drive, then spend; a miss on consume is the concurrent-loser **seam**); process-global Mongo **adapter** vs injected in-memory **adapter** (tests never boot Mongo); hashed ticket + owner email (this file never sees the raw nonce); null miss (wrong owner / expired / already used / missing are the same `null` — already-recommended verify maps that to `picker_invalid_nonce`)
- Split later (only if the file outgrows one sitting): this ~141-line file is one sitting if you read it as look up the unused one-time picker nonce for the configured owner, and consume it only once after the pick has already been proven, never mint the nonce, never hash the raw ticket, never fetch Drive metadata, never write the bootstrap row. If it later splits: `findTheUnusedPickerNonceForThisOwner.ts` / `consumeThePickerNonceOnce.ts` — story files, never `create.ts` / `find.ts` / `update.ts` / `delete.ts` / `store.ts`, and never merge already-recommended `picker.service.ts`, later `pickerSelectionStore.ts`, leftover `destinationIdentity.ts`, later `driveMetadata.service.ts`, or Wave B `GooglePickerNonce` into this file

`findActive` / `consumeActive` / `getPickerNonceStore` are executor mechanics. The owner question is: *The Owner just picked a file in Google Picker. Already-recommended verify has a raw nonce and the configured owner email. Leftover destination already hashed the nonce. Look up the unused, unexpired row for that hash and that owner. Hand back the stored flow so verify can prove the file against the ticket, not against the UI. After later metadata says the pick is fit, spend the same row once: owner still matches, still unused, still unexpired. Concurrent spenders yield one winner — the loser gets null. Do not mint a nonce. Do not hash the raw ticket. Do not fetch Drive. Do not write the bootstrap row — already-recommended picker still calls `GooglePickerNonce.create` itself. Do not invent a selection-reference row. Do not talk to Google.*

Already-recommended Owner pick, already-recommended Owner login, already-recommended token lock, later selection-reference store, later metadata get, leftover hash fold, Wave B nonce model, and Wave B Zod already live in other **modules**. Do not pull those in.

## What this file actually does

Two operations of one “look up the unused one-time picker nonce for the configured owner, and consume it only once after the pick has already been proven — never mint the nonce, never hash the raw ticket, never fetch Drive metadata, never write the bootstrap row” story, not “a nonce CRUD store,” and not the Owner pick / the selection-reference ticket / leftover destination choice:

1. **Find the unused picker nonce for this owner** — `PickerNonceStore.findActive({ nonceHash, ownerEmail, now? })`. In-memory **adapter**: Map get by hash; refuse if missing, `owner_email` ≠ caller, `consumed_at !== null`, or `expires_at <= now` (default `new Date()`); return a shallow copy. Mongo **adapter**: `connectMongo` then `GooglePickerNonce.findOne({ nonce_hash, owner_email, expires_at: { $gt: now }, consumed_at: null }).lean()` and fold through `toPickerNonceRecord`. Already-recommended verify asks this **seam** after leftover `hashPickerNonce` + leftover `expectedConfiguredOwnerEmail`. Miss → verify throws `picker_invalid_nonce` **before** later Drive get. This beat does **not** filter by flow — the stored `flow` rides on the record so verify can prove mime against the **ticket**. This beat does **not** write. This beat does **not** see the raw nonce.

2. **Consume the picker nonce once** — `PickerNonceStore.consumeActive({ nonceHash, ownerEmail, now? })`. Same unused / owner / unexpired guard. In-memory **adapter**: set `consumed_at = now` on the Map row and return a copy with that stamp. Mongo **adapter**: `findOneAndUpdate` with the same filter plus `{ $set: { consumed_at: now } }`, `returnDocument: "after"`. Already-recommended verify asks this **seam** only after later metadata validates. Miss → `picker_invalid_nonce` (the concurrent-loser **seam**). This beat does **not** create a selection-reference row — later `pickerSelectionStore.create` is a different ticket. This beat does **not** fetch Drive.

There is no mint operation. There is no hash operation. There is no bootstrap-write operation. There is no Drive-metadata operation. Already-recommended `bootstrapGooglePicker` still calls `GooglePickerNonce.create` after `connectMongo`. Leftover `hashPickerNonce` still folds the raw ticket. Later `createDriveMetadataClient` still fetches the file. Later `pickerSelectionStore` still owns the selection-reference ticket.

`toPickerNonceRecord` / `getPickerNonceStore` / `setPickerNonceStoreForTests` / `InMemoryPickerNonceStore.seed` / `get` / `clear` are beats the two operations and the test **adapter** already use. They are not extra owner operations. The process-global default is the Mongo **adapter**. Tests swap it. Later `resetPickerVerificationStoresForTests` puts Mongo back.

## Organization

Keep one file as the screenplay for “look up the unused one-time picker nonce for the configured owner, and consume it only once after the pick has already been proven — never mint the nonce, never hash the raw ticket, never fetch Drive metadata, never write the bootstrap row.” Already-recommended `picker.service.ts`, later `pickerSelectionStore.ts`, leftover `destinationIdentity.ts`, later `driveMetadata.service.ts`, Wave B `GooglePickerNonce`, and Wave B reporting TTL already live in deeper **modules**. Do not pull those in. Do not invent a `PickerNonceService` class. Do not invent a bootstrap-write **seam** here besides the two ticket beats this story already exposes — already-recommended picker still writes the model itself. Do not invent a hash **adapter** beside leftover `hashPickerNonce`. Do not invent a metadata-get **adapter** beside later `createDriveMetadataClient`. Do not invent a selection-reference **adapter** beside later `pickerSelectionStore`.

Do not split this into `create.ts` / `find.ts` / `update.ts` / `delete.ts` / `store.ts`. Those are persistence verbs, not the owner story. Do not move this into already-recommended `picker.service.ts` so “the pick can also persist.” Do not move this into later `pickerSelectionStore.ts` so “one ticket store.” Do not move this into leftover `destinationIdentity.ts` so “the hasher can also look up.” Do not silently add `create` so “bootstrap can use the store” without a bootstrap test on already-recommended picker. Do not silently teach verify to `findOne` the model so “one persistence path” and break the injected-store tests.

**External interface** stays small (this is the test surface). Find and consume are one story’s one-time nonce ticket, not two CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `findActive` | `findTheUnusedPickerNonceForThisOwner` | already-recommended verify needs the unused row (and its `flow`) before later Drive get |
| `consumeActive` | `consumeThePickerNonceOnce` | already-recommended verify spends only after metadata holds; concurrent loser → `null` |
| `getPickerNonceStore` | `thePickerNonceStore` | process-global **adapter** (Mongo default; tests swap) |
| `setPickerNonceStoreForTests` | `useThisPickerNonceStoreInTests` | `pickerVerification.test.ts` injects in-memory; later selection-store reset puts Mongo back |
| `InMemoryPickerNonceStore` | `InMemoryOneTimePickerNonceStore` | test **adapter**: `seed` / `get` / find / consume / `clear` without Mongo |
| `PickerNonceStore` | `OneTimePickerNonceStore` | the **seam** both **adapters** implement |
| `PickerNonceRecord` | `UnusedPickerNonce` | hash + owner + flow + expires + consumed — the ticket verify reads |

Keep the old names as one-line aliases until already-recommended verify, later selection-store reset, and `pickerVerification.test.ts` migrate. Do not make callers learn `findOne` / `findOneAndUpdate` / `GooglePickerNonce.create` as the domain language.

**Principle: old exports stay as aliases.** `findActive` remains the imported name until already-recommended verify points at the story name. `consumeActive` remains the imported name until verify’s spend migrates. `getPickerNonceStore` / `setPickerNonceStoreForTests` / `InMemoryPickerNonceStore` remain the imported names until the test **adapter** migrates.

**No class for the workflow.** `InMemoryPickerNonceStore` is a test **adapter**, not a workflow class — keep it. The type that *does* earn a name is the unused ticket already-recommended verify reads before Drive get:

```ts
type UnusedPickerNonce = {
  nonce_hash: string
  owner_email: string
  flow: OwnerPickKind
  expires_at: Date
  consumed_at: Date | null
}
```

That is the handoff from “leftover destination hashed the raw nonce” to “already-recommended verify may prove the file against this ticket’s flow.” Do **not** add `selection_nonce` so “the store can skip the hash,” do **not** add `file_id` so “verify can skip Drive,” and do **not** add `refresh_token` so “bootstrap can skip health.”

`toPickerNonceRecord` stays unexported. It is a fold, not a second public operation. Do not add `create` as a public **seam** on this file in this rename — already-recommended bootstrap still writes the model itself; the already-recommended picker pass already called that write/read split load-bearing. Do not add `hashPickerNonce` as a public **seam** on this file — leftover `destinationIdentity.ts` already owns the fold. Do not add `getFileMetadata` as a public **seam** on this file — later `driveMetadata.service.ts` already owns the get.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// pickerNonceStore.ts
// The Owner just picked a file in Google Picker.
// Already-recommended verify has a raw nonce
// and the configured owner email.
// Leftover destination already hashed the nonce.
// Look up the unused, unexpired row
// for that hash and that owner.
// Hand back the stored flow
// so verify can prove the file against the ticket,
// not against the UI.
// After later metadata says the pick is fit,
// spend the same row once:
// owner still matches, still unused, still unexpired.
// Concurrent spenders yield one winner —
// the loser gets null.
// Do not mint a nonce.
// Do not hash the raw ticket.
// Do not fetch Drive.
// Do not write the bootstrap row —
// already-recommended picker still calls
// GooglePickerNonce.create itself.
// Do not invent a selection-reference row.
// Do not talk to Google.

// ── 1. Find the unused picker nonce for this owner ────────

export async function findTheUnusedPickerNonceForThisOwner(input: {
  nonceHash: string
  ownerEmail: string
  now?: Date
}): Promise<UnusedPickerNonce | null>

function refuseUnlessThisNonceIsUnusedForThisOwner(record, ownerEmail, now)
// missing / wrong owner / consumed / expired → null
function handBackTheTicketWithoutTheRawNonce(record)  // shallow copy; flow rides along

// ── 2. Consume the picker nonce once ──────────────────────

export async function consumeThePickerNonceOnce(input: {
  nonceHash: string
  ownerEmail: string
  now?: Date
}): Promise<UnusedPickerNonce | null>

function spendTheSameUnusedRowOnce(record, now)       // in-memory Map stamp
// Mongo: findOneAndUpdate consumed_at: null → now; loser → null

export function thePickerNonceStore(): OneTimePickerNonceStore
export function useThisPickerNonceStoreInTests(
  store: OneTimePickerNonceStore | undefined,
)
export class InMemoryOneTimePickerNonceStore implements OneTimePickerNonceStore
```

Read the primary path out loud: *Wave B verify already passed the API secret and the signed configured Drive Owner. Already-recommended verify hashed the raw nonce and asked this file to find the unused row for that hash and that owner. Missing, expired, already used, or a different owner is the same null — verify calls that an invalid nonce and never talks to Drive. A hit hands back the stored flow. Later metadata then proves the file is accessible, owned, the right mime for that flow, and not a denylisted workbook. Only then this file spends the same row once. Two spends at once yield one winner. The raw nonce never sits on the row. The refresh token never sits on the row. This file never writes the bootstrap nonce — already-recommended picker still inserts that row itself. This file never hashes. This file never fetches Drive. This file never creates a selection reference.*

That is the operation. `findActive` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`findActive` / `consumeActive` are executor mechanics.** The owner story is “find the unused picker nonce for this owner” / “consume the picker nonce once.” Keep the old names as aliases. Do not grow a `PickerNonceService` with `find` / `consume` / `create`.

2. **This file has no `create`.** Already-recommended bootstrap still calls `GooglePickerNonce.create` after `connectMongo`. Injected in-memory stores therefore cannot cover bootstrap — the already-recommended picker pass already named that write/read split. Do not silently add `create` so “one persistence path” without a bootstrap test on already-recommended picker’s **interface**. Do not silently teach verify to `GooglePickerNonce.findOne` so “we can delete the store” and break `pickerVerification.test.ts`. Do not silently switch bootstrap to this store in this rename.

3. **Find-then-consume is the concurrent-loser seam, not a second lookup.** Verify finds, proves Drive, then consumes. Two valid verifies can both `findActive`. Only one `consumeActive` wins. Mongo’s `findOneAndUpdate` on `consumed_at: null` is the atomic spend. In-memory stamps the Map row; the second call sees `consumed_at !== null` and returns null. Do not silently consume inside `findActive` so “we cannot replay a bad pick” — that breaks already-recommended consume-after-validate (invalid mime / inaccessible must leave `consumed_at` null). Do not silently skip `findActive` and only consume so “one query” — verify needs the stored `flow` **before** Drive get.

4. **The unused guard is duplicated.** In-memory `findActive` and `consumeActive` copy owner / consumed / expired. Mongo copies the same filter on `findOne` and `findOneAndUpdate`. One story, two beats, two **adapters**. Align by story later. Do not silently extract a shared helper as a new public **seam**. Do not silently drop the consume-time guard so “find already checked” — that is the concurrent-loser **seam**.

5. **This store does not filter by flow.** Later `pickerSelectionStore.findActive` requires caller `flow`. This file matches hash + owner only and returns the stored `flow`. Already-recommended verify uses the **nonce’s** flow, not a caller-supplied flow. Do not silently add `flow` to `findActive` so “the UI can change its mind.” Do not silently ignore stored `flow` so “Picker already filtered views.”

6. **Wrong owner, expired, consumed, and missing are the same `null`.** Already-recommended verify maps every miss to `picker_invalid_nonce`. Do not silently throw `NotFoundError` vs `BadRequestError` from this file so “ops can tell them apart.” Do not silently return the consumed row from `findActive` so “we can inspect” — in-memory `get` is the test inspect; it is not the owner **seam**. Do not log the raw nonce hash on miss.

7. **The hash is leftover destination’s fold.** Callers pass `hashPickerNonce(selectionNonce)`. This file stores and matches `nonce_hash`. Do not silently hash inside `findActive` so “verify can pass the raw nonce.” Do not silently persist the raw nonce so “ops can replay.” `pickerValidation.test.ts` already locks leftover SHA-256 (`^[a-f0-9]{64}$`, not equal to the raw nonce) — that test stays on leftover `destinationIdentity.ts`.

8. **In-memory `get` / `seed` / `clear` are the test adapter, not owner operations.** `pickerVerification.test.ts` seeds a hashed row, then `get`s `consumed_at` after a failed / successful verify. Do not add `get` to `PickerNonceStore` so “Mongo can inspect.” Do not add `seed` to the Mongo **adapter** so “bootstrap can skip `create`.” Do not export `clear` as an ops-facing reset.

9. **The process-global swap is load-bearing for tests.** Default is Mongo. `setPickerNonceStoreForTests(store)` replaces it. `undefined` puts Mongo back. Later `resetPickerVerificationStoresForTests` asks that reset. Do not silently make `getPickerNonceStore` construct a new Mongo client per call so “we avoid mutable state” and lose the injected **adapter**. Do not silently put the swap on already-recommended picker so “the screenplay owns tests.”

10. **Mongo TTL is defense in depth, not this file’s clock.** Wave B `GooglePickerNonce` has `expireAfterSeconds: 0` on `expires_at`. Both **adapters** still refuse `expires_at <= now`. Already-recommended bootstrap sets `expires_at` from Wave B `REPORTING_PICKER_NONCE_TTL_MS` (10 minutes). Do not silently drop the query `expires_at: { $gt: now }` so “TTL will delete it.” Do not silently move the 10-minute clock into this file so “the store owns TTL.”

11. **Leave sibling modules alone.** Already-recommended hand / verify / consume-reference / re-prove, later selection-reference create / find / consume, leftover SHA-256 nonce fold, later metadata get / mime / owned-by-me / parent, later managed-tab ownership marker, leftover destination Picker-vs-create-vs-export **choice**, already-recommended begin / complete / live client / health, already-recommended AES lock, already-recommended grant allowlist, already-recommended canned 403, already-recommended signed-owner gate, already-recommended folder / probe-tab create, and Wave B Zod stay where they are. This file orchestrates find unused ticket → (already-recommended verify proves Drive) → consume once.

## Testing

The **interface** is the test surface: the find / consume exports (story names, old names as aliases), the process-global get / set, the in-memory **adapter**, and the unused-ticket type. Consume-once, concurrent one-winner, owner / expiry / consumed miss, and “raw nonce never stored” are part of that **interface**. Do not boot Google. Do not boot Drive. Prefer the in-memory **adapter**. A Mongo spend test is allowed only if it names consume-once and does not pull already-recommended verify.

Today `pickerVerification.test.ts` locks already-recommended verify through this store: invalid mime / inaccessible leave `consumed_at` null; replay after success is `picker_invalid_nonce`; concurrent valid verifies yield one selection. Those tests belong on already-recommended picker’s **interface**; they prove this store’s consume-after-validate **seam** as a caller. Add (or keep) file tests that name **this** operation:

**Find the unused picker nonce for this owner**
- Hash + matching owner + unused + unexpired → the row, including stored `flow`.
- Wrong owner → `null`.
- `consumed_at !== null` → `null`.
- `expires_at <= now` → `null`.
- Missing hash → `null`.
- Returned record does not contain the raw nonce.
- Does not call later `getFileMetadata`.
- Does not import leftover `hashPickerNonce`.

**Consume the picker nonce once**
- Happy path stamps `consumed_at` and returns the row.
- Second consume of the same hash + owner → `null` (today’s replay, at this **interface**).
- Concurrent valid consumes yield one row and one `null` (today’s concurrent verify, at this **interface**).
- Wrong owner / expired still `null` and leave `consumed_at` null if the row was never this owner’s unused ticket.
- In-memory `get` after a failed already-recommended verify still shows `consumed_at === null` — that assertion stays on already-recommended picker’s tests; do not move it here as “find consumed.”

**Not this interface**
- Hand the Owner a one-time Picker / allowlist / `GooglePickerNonce.create` stay on already-recommended `picker.service.ts`.
- Verify’s metadata remap / denylist / display-field ignore stay on already-recommended `picker.service.ts`.
- Selection-reference create / find / consume stay on later `pickerSelectionStore.ts`.
- SHA-256 nonce fold stays on leftover `destinationIdentity.ts` (`pickerValidation.test.ts` already locks it).
- Metadata get / mime / owned-by-me / parent stay on later `driveMetadata.service.ts`.
- Begin / complete / live client / health stay on already-recommended `googleDriveOAuth.service.ts`.
- AES-GCM / owner-email AAD stay on already-recommended `tokenEncryption.ts`.
- Signed-owner HTTP gate stays on already-recommended `ownerAuth.ts`.
- Wave B nonce schema / TTL index stay on `models/GooglePickerNonce.ts`.

Do **not** add a test per helper (`refuseUnlessThisNonceIsUnusedForThisOwner`, `handBackTheTicketWithoutTheRawNonce`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not add a test that this file mints a nonce — it must not. Do not add a test that this file hashes a raw nonce — it must not. Do not add a test that this file calls `GooglePickerNonce.create` — it must not. Do not add a test that this file fetches Drive — it must not. Do not add a test that `findActive` now consumes — it must not. Do not add a test that consume now creates a selection-reference row — it must not. Do not add a test that this file stores the raw nonce — it must not. Do not add a test that skipped `index.ts` now re-exports this store — it must not, in this rename. Do not add a test that leftover destination now imports this file — it must not. Do not add a test that this file begins OAuth — it must not.

## What I would not do

- A `PickerNonceService` class with `find` / `consume` / `create`.
- Thirty two-line functions that only wrap `findOne` / `findOneAndUpdate`.
- Moving this into a CRUD folder, or into already-recommended `picker.service.ts` / later `pickerSelectionStore.ts` / leftover `destinationIdentity.ts` / Wave B `GooglePickerNonce` “for cleanliness.”
- Breaking the find-then-consume **seam**, the concurrent-one-winner **seam**, the injected in-memory **adapter** **seam**, or the bootstrap-writes-the-model-itself **seam**.
- Treating already-recommended `picker.service.ts` / later `pickerSelectionStore.ts` / leftover `destinationIdentity.ts` / later `driveMetadata.service.ts` / already-recommended `googleDriveOAuth.service.ts` / Wave B `GooglePickerNonce` as this story.
- Inventing a bootstrap-write **seam** that has only one **adapter** here, or a hash **seam** that has only one **adapter** here, or a metadata-get **seam** that has only one **adapter** here.
- Silently adding `create`, or silently consuming inside `findActive`, or silently hashing the raw nonce, or silently fetching Drive, or silently merging this ticket with later selection-reference rows, or silently teaching verify to query the model, or silently adding these exports to skipped `index.ts`.
- Writing a whole-folder recommendation that pretends later selection-store / metadata / managed-tab / leftover reporting are this module.
- Opening `pickerSelectionStore.ts` in this same pass — stay on `googleDriveOAuth`; that file is the next unchecked module.
- Making a Form Lead 201 wait on `findTheUnusedPickerNonceForThisOwner`.
