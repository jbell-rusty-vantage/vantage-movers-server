# Persist The Proven Pick As A One-Time Hashed Selection Reference For The Configured Owner And This Flow, Look Up The Unused Unexpired Reference Only When Owner And Flow Still Match, And Consume It Only Once After Leftover Destination Has Already Re-Proven Drive — Never Mint The Raw Reference, Never Hash The Raw Ticket, Never Fetch Drive, Never Consume The Nonce, Never Trust The Stored Display Name Over A Later Drive Get — operational story

- Status: recommended
- Service: `googleDriveOAuth` (Wave A, in-progress after this pass)
- Pass: 9 of this service — `pickerSelectionStore.ts`
- Remaining in this service: `driveMetadata.service.ts`, `managedTab.service.ts` (`workbook.service.ts` / `picker.types.ts` / `index.ts` skipped on open; `googleDriveOAuth.service.ts` / `tokenEncryption.ts` / `oauthScopes.ts` / `oauthSecurity.ts` / `ownerAuth.ts` / `spreadsheet.service.ts` / `picker.service.ts` / `pickerNonceStore.ts` already recommended)
- Target: `src/services/googleDriveOAuth/pickerSelectionStore.ts`
- Knowledge: none for this folder. Closest: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (Owner-gated destinations and Google workbooks as a **delivery surface** — it never names this selection store; leftover `reportingDestination.service.ts` **asks** already-recommended `picker.service.ts` to consume a selection reference, which **asks** this file to find / spend the unused hashed row). Distinct from already-recommended Owner pick: [recommendations/google-drive-oauth-picker.md](google-drive-oauth-picker.md) (that file hands the Picker, verifies the pick, **asks** this file’s `create` after the nonce is spent, later **asks** this file’s find / consume, re-proves a known id — it mints the raw 32-byte reference and leftover destination hashes it; this file never sees the raw ticket). Distinct from already-recommended unused nonce ticket: [recommendations/google-drive-oauth-picker-nonce-store.md](google-drive-oauth-picker-nonce-store.md) (find / consume the **nonce**; that file has **no** `create` — already-recommended bootstrap still writes `GooglePickerNonce.create` itself; this file **is** the write for the **selection-reference** ticket and also hosts `resetPickerVerificationStoresForTests`, which puts **both** stores back to Mongo). Distinct from already-recommended Owner login: [recommendations/google-drive-oauth-google-drive-oauth.md](google-drive-oauth-google-drive-oauth.md) (begin / complete / live client / health / disconnect — this file never sees a refresh token). Distinct from already-recommended token lock: [recommendations/google-drive-oauth-token-encryption.md](google-drive-oauth-token-encryption.md) (AES-256-GCM + owner-email AAD — this file stores a SHA-256 **hash** leftover destination already folded, not a ciphertext bag). Distinct from already-recommended grant allowlist: [recommendations/google-drive-oauth-oauth-scopes.md](google-drive-oauth-oauth-scopes.md). Distinct from already-recommended public failure: [recommendations/google-drive-oauth-oauth-security.md](google-drive-oauth-oauth-security.md) (Wave B `sendApiError` maps already-recommended `picker_invalid_reference` — this file returns `null`). Distinct from already-recommended signed-owner HTTP gate: [recommendations/google-drive-oauth-owner-auth.md](google-drive-oauth-owner-auth.md) (Wave B mounts that middleware **in front** of bootstrap / verify; leftover destination has its own Owner gate; this file never inspects `req`; there is **no** consume HTTP route). Distinct from already-recommended Owner Drive create: [recommendations/google-drive-oauth-spreadsheet.md](google-drive-oauth-spreadsheet.md). Distinct from skipped `workbook.service.ts` (one-line create facade). Distinct from skipped `picker.types.ts` (`PickerFlow` only). Distinct from later `driveMetadata.service.ts` (get metadata / accessible / owned-by-me / mime / parent — already-recommended consume **asks** those asserts **between** this file’s find and this file’s consume). Distinct from later `managedTab.service.ts`. Distinct from leftover `reporting/destinationIdentity.ts` (`hashPickerSelectionReference` / `expectedConfiguredOwnerEmail` — already-recommended verify / consume **ask** those folds **before** this file; this file never sees the raw reference). Distinct from leftover destination resolve (`resolveDestinationFolder` / `resolveDestinationWorkbook` — Picker-vs-create-vs-export **choice**; this file is only the hashed ticket). Distinct from later Wave A `operationalWorkbooks` (denylist — already-recommended consume asks it **before** this file’s spend). Distinct from Wave B `models/GooglePickerSelection.ts` (`google_picker_selections`: unique `reference_hash`, TTL on `expires_at`, `consumed_at` default null, optional `parent_folder_id` — this file **asks** `create` / `findOne` / `findOneAndUpdate`; it does **not** own the schema). Distinct from Wave B `config/domain/reporting.ts` (15-minute selection TTL — already-recommended verify **asks** that clock when it writes `expires_at`). Distinct from skipped barrel `index.ts` (does **not** re-export this file — already-recommended `picker.service.ts` re-exports `InMemoryPickerSelectionStore` / `setPickerSelectionStoreForTests` / `resetPickerVerificationStoresForTests` so tests can import one path). This checkout’s `CONTEXT.md` does not define a Drive Picker / selection-reference term — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: **already-recommended verify’s persist plus already-recommended consume’s find / spend. Tests lock this store through those two, not this file.** Already-recommended `picker.service.ts` — `verifyGooglePickerSelection` asks `getPickerSelectionStore().create({ reference_hash, owner_email, flow, file_id, mime_type, name, url, parent_folder_id?, expires_at })` only after already-recommended nonce consume wins; `consumePickerSelectionReference` asks `findActive({ referenceHash, ownerEmail, flow })` then, only after later metadata validates, `consumeActive({ referenceHash, ownerEmail, flow })`; re-exports `InMemoryPickerSelectionStore` / `setPickerSelectionStoreForTests` / `resetPickerVerificationStoresForTests`. Leftover `reporting/reportingDestination.service.ts` — `resolveDestinationFolder` / `resolveDestinationWorkbook` ask already-recommended consume (folder vs spreadsheet + optional parent), **not** this file. Leftover live harnesses ask already-recommended consume the same way. Tests: `pickerVerification.test.ts` seeds `InMemoryPickerSelectionStore`, injects it, and locks consume-after-validate / replay / concurrent one-winner on already-recommended consume (invalid mime / trash / inaccessible / denylist leave `consumed_at` null; replay is `picker_invalid_reference`; concurrent valid consumes yield one winner); verify tests lock that a failed metadata beat leaves `records.length === 0` and a concurrent verify issues at most one row. Not this **interface**: leftover `hashPickerSelectionReference` (SHA-256 fold), later metadata get, already-recommended nonce find / consume, leftover destination **choice**, Wave B Zod, Wave B owner gate. `pickerValidation.test.ts` locks leftover `hashPickerSelectionReference` — that belongs on leftover `destinationIdentity.ts`, not this **interface**. `countActive` has **no** runtime caller.
- Seams callers need: persist-after-prove vs find-unused vs consume-once (verify persists only after the nonce is spent; leftover destination must find, re-prove Drive, then spend; a miss on consume is the concurrent-loser **seam**); process-global Mongo **adapter** vs injected in-memory **adapter** (tests never boot Mongo); hashed ticket + owner email + **caller flow** (this file never sees the raw reference; unlike already-recommended nonce store, flow is a match key); null miss (wrong owner / wrong flow / expired / already used / missing are the same `null` — already-recommended consume maps that to `picker_invalid_reference`)
- Split later (only if the file outgrows one sitting): this ~381-line file is one sitting if you read it as persist the proven pick as a one-time hashed selection reference for the configured owner and this flow, look up the unused unexpired reference only when owner and flow still match, and consume it only once after leftover destination has already re-proven Drive, never mint the raw reference, never hash the raw ticket, never fetch Drive, never consume the nonce, never trust the stored display name over a later Drive get. If it later splits: `persistTheProvenPickAsAOneTimeSelectionReference.ts` / `findTheUnusedSelectionReferenceForThisOwnerAndFlow.ts` / `consumeTheSelectionReferenceOnce.ts` — story files, never `create.ts` / `find.ts` / `update.ts` / `delete.ts` / `store.ts`, and never merge already-recommended `picker.service.ts`, already-recommended `pickerNonceStore.ts`, leftover `destinationIdentity.ts`, later `driveMetadata.service.ts`, or Wave B `GooglePickerSelection` into this file

`create` / `findActive` / `consumeActive` / `getPickerSelectionStore` are executor mechanics. The owner question is: *Already-recommended verify just proved a folder or spreadsheet against live Drive and spent the one-time nonce. It minted a raw 32-byte selection reference. Leftover destination hashed that ticket. Persist the hash, the configured owner, the nonce’s flow, the Drive-proven file id / mime / name / url, spreadsheet parent when the flow is a workbook, and the 15-minute clock. Hand leftover destination a chance to spend that ticket later: look up the unused, unexpired row for that hash, that owner, and the caller’s flow. Hand back the stored `file_id` so leftover destination can fetch Drive again — the stored display name and URL do not win. After later metadata says the pick still holds (parent optional; operational workbooks fail closed), spend the same row once: owner still matches, flow still matches, still unused, still unexpired. Concurrent spenders yield one winner — the loser gets null. Do not mint the raw reference. Do not hash the raw ticket. Do not fetch Drive. Do not consume the nonce. Do not invent a Picker bootstrap row. Do not talk to Google.*

Already-recommended Owner pick, already-recommended unused nonce ticket, already-recommended Owner login, already-recommended token lock, later metadata get, leftover hash fold, leftover destination **choice**, Wave B selection model, and Wave B Zod already live in other **modules**. Do not pull those in.

## What this file actually does

Three operations of one “persist the proven pick as a one-time hashed selection reference for the configured owner and this flow, look up the unused unexpired reference only when owner and flow still match, and consume it only once after leftover destination has already re-proven Drive — never mint the raw reference, never hash the raw ticket, never fetch Drive, never consume the nonce, never trust the stored display name over a later Drive get” story, not “a selection CRUD store,” and not the Owner pick / the unused nonce ticket / leftover destination choice:

1. **Persist the proven pick as a one-time selection reference** — `PickerSelectionStore.create(record)` where `record` omits `consumed_at`. In-memory **adapter**: push `{ ...record, consumed_at: null }` onto a public array. Mongo **adapter**: `connectMongo` then `GooglePickerSelection.create(record)` (schema default `consumed_at: null`). Already-recommended verify asks this **seam** only after already-recommended nonce `consumeActive` wins, with leftover `hashPickerSelectionReference(selectionReference)`, leftover `expectedConfiguredOwnerEmail`, the **consumed nonce’s** flow, file id / mime / name / url from **that** Drive get, `parent_folder_id` only when flow is `"spreadsheet"` (`metadata.parentFolderIds[0]`), and Wave B `REPORTING_PICKER_SELECTION_TTL_MS` (15 minutes). This beat does **not** mint the raw reference. This beat does **not** hash. This beat does **not** fetch Drive. This beat does **not** spend a nonce.

2. **Find the unused selection reference for this owner and this flow** — `PickerSelectionStore.findActive({ referenceHash, ownerEmail, flow, now? })`. In-memory **adapter**: array find by `reference_hash`; refuse if missing, `owner_email` ≠ caller, `flow` ≠ caller, `consumed_at !== null`, or `expires_at <= now` (default `new Date()`); return a shallow copy. Mongo **adapter**: `connectMongo` then `GooglePickerSelection.findOne({ reference_hash, owner_email, flow, expires_at: { $gt: now }, consumed_at: null }).lean()` and fold through `toPickerSelectionRecord` (`parent_folder_id` null → undefined). Already-recommended consume asks this **seam** after leftover `hashPickerSelectionReference` + leftover `expectedConfiguredOwnerEmail` + leftover destination’s **caller flow**. Miss → already-recommended consume throws `picker_invalid_reference` **before** later Drive get. This beat **does** filter by flow — leftover destination must spend a folder ticket as a folder and a workbook ticket as a workbook. This beat does **not** write. This beat does **not** see the raw reference. This beat does **not** return leftover destination’s `{ fileId, name, url }` — already-recommended consume re-fetches Drive for those.

3. **Consume the selection reference once** — `PickerSelectionStore.consumeActive({ referenceHash, ownerEmail, flow, now? })`. Same unused / owner / flow / unexpired guard. In-memory **adapter**: set `consumed_at = now` on the array row and return a copy with that stamp. Mongo **adapter**: `findOneAndUpdate` with the same filter plus `{ $set: { consumed_at: now } }`, `returnDocument: "after"`. Already-recommended consume asks this **seam** only after later metadata validates (and later denylist, when the flow is a workbook). Miss → `picker_invalid_reference` (the concurrent-loser **seam**). This beat does **not** fetch Drive. This beat does **not** trust stored `name` / `url` as the leftover destination return — already-recommended consume returns **this** Drive get.

There is no mint operation. There is no hash operation. There is no Drive-metadata operation. There is no nonce-consume operation. Already-recommended verify still mints `randomBytes(32).toString("base64url")`. Leftover `hashPickerSelectionReference` still folds the raw ticket. Later `createDriveMetadataClient` still fetches the file. Already-recommended `pickerNonceStore` still owns the unused nonce ticket.

`countActive` sits on `PickerSelectionStore` and both **adapters** implement it (unused + unexpired count, no owner / flow filter). It has **no** runtime caller and is **not** an owner operation. Do not invent a dashboard for it in this rename. `toPickerSelectionRecord` / `getPickerSelectionStore` / `setPickerSelectionStoreForTests` / `resetPickerVerificationStoresForTests` / `InMemoryPickerSelectionStore.seed` / `get` / `clear` / public `records` are beats the three operations and the test **adapter** already use. They are not extra owner operations. The process-global default is the Mongo **adapter**. Tests swap it. `resetPickerVerificationStoresForTests` puts **both** this store and already-recommended nonce store back to Mongo.

## Organization

Keep one file as the screenplay for “persist the proven pick as a one-time hashed selection reference for the configured owner and this flow, look up the unused unexpired reference only when owner and flow still match, and consume it only once after leftover destination has already re-proven Drive — never mint the raw reference, never hash the raw ticket, never fetch Drive, never consume the nonce, never trust the stored display name over a later Drive get.” Already-recommended `picker.service.ts`, already-recommended `pickerNonceStore.ts`, leftover `destinationIdentity.ts`, later `driveMetadata.service.ts`, leftover destination resolve, Wave B `GooglePickerSelection`, and Wave B reporting TTL already live in deeper **modules**. Do not pull those in. Do not invent a `PickerSelectionService` class. Do not invent a mint **seam** here besides the persist beat this story already exposes — already-recommended picker still mints the raw reference itself. Do not invent a hash **adapter** beside leftover `hashPickerSelectionReference`. Do not invent a metadata-get **adapter** beside later `createDriveMetadataClient`. Do not invent a nonce **adapter** beside already-recommended `pickerNonceStore`.

Do not split this into `create.ts` / `find.ts` / `update.ts` / `delete.ts` / `store.ts`. Those are persistence verbs, not the owner story. Do not move this into already-recommended `picker.service.ts` so “the pick can also persist.” Do not move this into already-recommended `pickerNonceStore.ts` so “one ticket store.” Do not move this into leftover `destinationIdentity.ts` so “the hasher can also look up.” Do not silently drop `create` so “verify can write the model itself” without a verify test on already-recommended picker’s **interface**. Do not silently teach consume to `findOne` the model so “one persistence path” and break the injected-store tests.

**External interface** stays small (this is the test surface). Persist, find, and consume are one story’s one-time selection-reference ticket, not three CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `create` | `persistTheProvenPickAsAOneTimeSelectionReference` | already-recommended verify needs the hashed row after the nonce is spent |
| `findActive` | `findTheUnusedSelectionReferenceForThisOwnerAndFlow` | already-recommended consume needs the unused row (and its `file_id`) before later Drive get |
| `consumeActive` | `consumeTheSelectionReferenceOnce` | already-recommended consume spends only after metadata holds; concurrent loser → `null` |
| `getPickerSelectionStore` | `thePickerSelectionStore` | process-global **adapter** (Mongo default; tests swap) |
| `setPickerSelectionStoreForTests` | `useThisPickerSelectionStoreInTests` | `pickerVerification.test.ts` injects in-memory |
| `resetPickerVerificationStoresForTests` | `putBothPickerTicketStoresBackToMongoInTests` | afterEach puts **this** store and already-recommended nonce store back |
| `InMemoryPickerSelectionStore` | `InMemoryOneTimeSelectionReferenceStore` | test **adapter**: `seed` / `get` / public `records` / persist / find / consume / `clear` without Mongo |
| `PickerSelectionStore` | `OneTimeSelectionReferenceStore` | the **seam** both **adapters** implement |
| `PickerSelectionRecord` | `UnusedSelectionReference` | hash + owner + flow + file snapshot + expires + consumed — the ticket leftover destination re-proves |

Keep the old names as one-line aliases until already-recommended verify / consume, leftover destination (through already-recommended consume), and `pickerVerification.test.ts` migrate. Do not make callers learn `findOne` / `findOneAndUpdate` / `GooglePickerSelection.create` as the domain language.

**Principle: old exports stay as aliases.** `create` remains the imported name until already-recommended verify’s persist points at the story name. `findActive` / `consumeActive` remain the imported names until already-recommended consume migrates. `getPickerSelectionStore` / `setPickerSelectionStoreForTests` / `InMemoryPickerSelectionStore` / `resetPickerVerificationStoresForTests` remain the imported names until the test **adapter** migrates.

**No class for the workflow.** `InMemoryPickerSelectionStore` is a test **adapter**, not a workflow class — keep it. The type that *does* earn a name is the unused ticket already-recommended consume reads before the second Drive get:

```ts
type UnusedSelectionReference = {
  reference_hash: string
  owner_email: string
  flow: OwnerPickKind
  file_id: string
  mime_type: string
  name: string
  url: string
  parent_folder_id?: string
  expires_at: Date
  consumed_at: Date | null
}
```

That is the handoff from “already-recommended verify persisted the proven pick” to “leftover destination may re-prove **this** `file_id` once.” Do **not** add `selection_reference` so “the store can skip the hash,” do **not** add `ownedByMe` so “consume can skip Drive,” and do **not** add `refresh_token` so “leftover destination can skip health.” Stored `name` / `url` / `mime_type` are snapshots from verify’s Drive get. Already-recommended consume returns the **later** get.

`toPickerSelectionRecord` stays unexported. It is a fold, not a fourth public operation. Do not add `hashPickerSelectionReference` as a public **seam** on this file — leftover `destinationIdentity.ts` already owns the fold. Do not add `getFileMetadata` as a public **seam** on this file — later `driveMetadata.service.ts` already owns the get. Do not add `consumeActive` for the nonce as a public **seam** on this file — already-recommended `pickerNonceStore.ts` already owns that ticket. Do not promote `countActive` to an owner **seam** in this rename — it has no caller.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// pickerSelectionStore.ts
// Already-recommended verify just proved a folder
// or spreadsheet against live Drive
// and spent the one-time nonce.
// It minted a raw 32-byte selection reference.
// Leftover destination hashed that ticket.
// Persist the hash, the configured owner,
// the nonce’s flow, the Drive-proven file id,
// mime / name / url, spreadsheet parent
// when the flow is a workbook,
// and the 15-minute clock.
// Later leftover destination spends that ticket:
// look up the unused, unexpired row
// for that hash, that owner, and the caller’s flow.
// Hand back the stored file_id
// so leftover destination can fetch Drive again —
// the stored display name and URL do not win.
// After later metadata says the pick still holds,
// spend the same row once:
// owner still matches, flow still matches,
// still unused, still unexpired.
// Concurrent spenders yield one winner —
// the loser gets null.
// Do not mint the raw reference.
// Do not hash the raw ticket.
// Do not fetch Drive.
// Do not consume the nonce.
// Do not invent a Picker bootstrap row.
// Do not talk to Google.

// ── 1. Persist the proven pick as a one-time selection reference

export async function persistTheProvenPickAsAOneTimeSelectionReference(
  record: Omit<UnusedSelectionReference, "consumed_at">,
): Promise<void>

function startTheTicketUnused(record)                 // consumed_at = null
// Mongo unique reference_hash; in-memory array push

// ── 2. Find the unused selection reference for this owner and this flow

export async function findTheUnusedSelectionReferenceForThisOwnerAndFlow(input: {
  referenceHash: string
  ownerEmail: string
  flow: OwnerPickKind
  now?: Date
}): Promise<UnusedSelectionReference | null>

function refuseUnlessThisReferenceIsUnusedForThisOwnerAndFlow(
  record,
  ownerEmail,
  flow,
  now,
)
// missing / wrong owner / wrong flow / consumed / expired → null
function handBackTheTicketWithoutTheRawReference(record)
// shallow copy; file_id rides along; name / url are snapshots

// ── 3. Consume the selection reference once ───────────────

export async function consumeTheSelectionReferenceOnce(input: {
  referenceHash: string
  ownerEmail: string
  flow: OwnerPickKind
  now?: Date
}): Promise<UnusedSelectionReference | null>

function spendTheSameUnusedRowOnce(record, now)       // in-memory array stamp
// Mongo: findOneAndUpdate consumed_at: null → now; loser → null

export function thePickerSelectionStore(): OneTimeSelectionReferenceStore
export function useThisPickerSelectionStoreInTests(
  store: OneTimeSelectionReferenceStore | undefined,
)
export function putBothPickerTicketStoresBackToMongoInTests()
export class InMemoryOneTimeSelectionReferenceStore
  implements OneTimeSelectionReferenceStore
```

Read the primary path out loud: *Wave B verify already passed the API secret and the signed configured Drive Owner. Already-recommended verify spent the unused nonce and asked this file to persist a hashed 15-minute selection-reference row for that owner and that flow, with the Drive-proven file id. Leftover destination create later hashed the raw reference the Owner pasted and asked already-recommended consume to find the unused row for that hash, that owner, and the caller’s flow. Missing, expired, already used, a different owner, or a folder ticket spent as a workbook is the same null — consume calls that an invalid reference and never talks to Drive. A hit hands back the stored file_id. Later metadata then proves the file is still accessible, owned, the right mime for that flow, still in the expected parent when leftover destination asked, and not a denylisted workbook. Only then this file spends the same row once. Two spends at once yield one winner. The raw reference never sits on the row. The refresh token never sits on the row. The stored display name never wins over the later Drive get. This file never mints. This file never hashes. This file never fetches Drive. This file never consumes a nonce.*

That is the operation. `findActive` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`create` / `findActive` / `consumeActive` are executor mechanics.** The owner story is “persist the proven pick as a one-time selection reference” / “find the unused selection reference for this owner and this flow” / “consume the selection reference once.” Keep the old names as aliases. Do not grow a `PickerSelectionService` with `create` / `find` / `consume`.

2. **This file has `create`. Already-recommended nonce store does not.** Already-recommended verify asks this store to persist. Already-recommended bootstrap still writes `GooglePickerNonce.create` itself. Do not silently drop `create` so “both tickets write the model” and break injected verify tests (`records.length` after success / failure). Do not silently add `create` to already-recommended nonce store in this rename so “the two stores match.” Do not silently teach verify to `GooglePickerSelection.create` so “we can delete the store.”

3. **Find-then-consume is the concurrent-loser seam, not a second lookup.** Already-recommended consume finds, re-proves Drive, then consumes. Two valid leftover destination creates can both `findActive`. Only one `consumeActive` wins. Mongo’s `findOneAndUpdate` on `consumed_at: null` is the atomic spend. In-memory stamps the array row; the second call sees `consumed_at !== null` and returns null. Do not silently consume inside `findActive` so “we cannot replay a bad pick” — that breaks already-recommended consume-after-validate (invalid mime / trash / inaccessible / denylist must leave `consumed_at` null). Do not silently skip `findActive` and only consume so “one query” — leftover destination needs the stored `file_id` **before** Drive get.

4. **The unused guard is duplicated.** In-memory `findActive` and `consumeActive` copy owner / flow / consumed / expired. Mongo copies the same filter on `findOne` and `findOneAndUpdate`. One story, two beats, two **adapters**. Align by story later. Do not silently extract a shared helper as a new public **seam**. Do not silently drop the consume-time guard so “find already checked” — that is the concurrent-loser **seam**.

5. **This store filters by flow. Already-recommended nonce store does not.** Already-recommended nonce `findActive` matches hash + owner and returns stored `flow`. This file requires caller `flow` on find and consume. Leftover destination passes `"folder"` or `"spreadsheet"`. A workbook ticket spent as a folder is `null` → `picker_invalid_reference`. Do not silently drop `flow` from `findActive` so “the two stores match.” Do not silently take stored `flow` and ignore the caller so “Picker already filtered views.”

6. **Wrong owner, wrong flow, expired, consumed, and missing are the same `null`.** Already-recommended consume maps every miss to `picker_invalid_reference`. Do not silently throw `NotFoundError` vs `BadRequestError` from this file so “ops can tell them apart.” Do not silently return the consumed row from `findActive` so “we can inspect” — in-memory `get` is the test inspect; it is not the owner **seam**. Do not log the raw reference hash on miss.

7. **The hash is leftover destination’s fold.** Callers pass `hashPickerSelectionReference(selectionReference)`. This file stores and matches `reference_hash`. Do not silently hash inside `create` / `findActive` so “verify can pass the raw reference.” Do not silently persist the raw reference so “ops can replay.” `pickerValidation.test.ts` already locks leftover SHA-256 — that test stays on leftover `destinationIdentity.ts`.

8. **Stored name / url / mime are snapshots, not the leftover destination return.** Already-recommended consume returns `{ fileId, name, url, mimeType, parentFolderId }` from the **second** Drive get. `parentFolderId` on that return is `metadata.parentFolderIds[0]` even for folder flow. Do not silently return stored `name` / `url` from already-recommended consume so “we can skip Drive.” Do not silently overwrite stored snapshots on consume. That return shape stays on already-recommended picker’s **interface**.

9. **Spreadsheet parent is stored only at persist time.** Already-recommended verify writes `parent_folder_id` only when flow is `"spreadsheet"`. Folder persist leaves it undefined. Later leftover destination may still pass `expectedParentFolderId` on workbook consume; later metadata asserts the **live** parent, not this stored field. Do not silently require `parent_folder_id` on folder persist. Do not silently spend using stored parent so “we can skip `assertParentFolderRelationship`.”

10. **In-memory `get` / `seed` / `clear` / public `records` are the test adapter, not owner operations.** `pickerVerification.test.ts` seeds a hashed row, then `get`s `consumed_at` after a failed / successful consume, and checks `records.length` after verify. Do not add `get` to `PickerSelectionStore` so “Mongo can inspect.” Do not add `seed` to the Mongo **adapter** so “verify can skip `create`.” Do not export `clear` as an ops-facing reset. Do not silently switch in-memory to a Map so “it matches the nonce store” without updating `records.length` tests.

11. **In-memory persist does not enforce unique `reference_hash`.** Mongo has unique `{ reference_hash: 1 }`. In-memory `create` always pushes. Two persists of the same hash would leave two array rows; `find` would return the first unused match. Already-recommended verify mints a fresh 32-byte ticket per success, so the live path should not collide. Do not silently upsert on hash so “replay can refresh TTL.” Do not silently swallow a Mongo duplicate as `null` so “verify looks like a miss.”

12. **`countActive` is a leftover inventory method.** Both **adapters** count unused + unexpired rows with **no** owner / flow filter. No runtime caller. Do not invent an ops dashboard for it in this rename. Do not silently delete it without a test that names why it existed. Do not silently teach leftover destination to call it so “we can rate-limit picks.”

13. **The process-global swap is load-bearing for tests.** Default is Mongo. `setPickerSelectionStoreForTests(store)` replaces it. `undefined` puts Mongo back. `resetPickerVerificationStoresForTests` asks that reset **and** already-recommended `setPickerNonceStoreForTests(undefined)`. Do not silently make `getPickerSelectionStore` construct a new Mongo client per call so “we avoid mutable state” and lose the injected **adapter**. Do not silently move the dual reset onto already-recommended picker so “the screenplay owns tests” — already-recommended picker already re-exports it.

14. **Mongo TTL is defense in depth, not this file’s clock.** Wave B `GooglePickerSelection` has `expireAfterSeconds: 0` on `expires_at`. Both **adapters** still refuse `expires_at <= now`. Already-recommended verify sets `expires_at` from Wave B `REPORTING_PICKER_SELECTION_TTL_MS` (15 minutes — longer than the 10-minute nonce). Do not silently drop the query `expires_at: { $gt: now }` so “TTL will delete it.” Do not silently move the 15-minute clock into this file so “the store owns TTL.” Do not silently make this TTL match the nonce clock so “the two tickets agree.”

15. **Leave sibling modules alone.** Already-recommended hand / verify / consume-reference / re-prove, already-recommended unused nonce find / consume, leftover SHA-256 reference fold, later metadata get / mime / owned-by-me / parent, later managed-tab ownership marker, leftover destination Picker-vs-create-vs-export **choice**, already-recommended begin / complete / live client / health, already-recommended AES lock, already-recommended grant allowlist, already-recommended canned 403, already-recommended signed-owner gate, already-recommended folder / probe-tab create, and Wave B Zod stay where they are. This file orchestrates persist proven pick → (already-recommended consume re-proves Drive) → consume once.

## Testing

The **interface** is the test surface: the persist / find / consume exports (story names, old names as aliases), the process-global get / set / dual reset, the in-memory **adapter**, and the unused-ticket type. Consume-once, concurrent one-winner, owner / flow / expiry / consumed miss, “raw reference never stored,” and “failed metadata leaves the ticket unused” are part of that **interface**. Do not boot Google. Do not boot Drive. Prefer the in-memory **adapter**. A Mongo spend test is allowed only if it names consume-once and does not pull already-recommended consume.

Today `pickerVerification.test.ts` locks already-recommended verify / consume through this store: invalid mime / trash / inaccessible / denylist leave `consumed_at` null; replay after success is `picker_invalid_reference`; concurrent valid consumes yield one leftover destination winner; failed verify leaves `records.length === 0`; concurrent valid verifies issue at most one row. Those tests belong on already-recommended picker’s **interface**; they prove this store’s persist-after-prove and consume-after-validate **seams** as a caller. Add (or keep) file tests that name **this** operation:

**Persist the proven pick as a one-time selection reference**
- Hash + owner + flow + file snapshot + `expires_at` → one unused row (`consumed_at === null`).
- Spreadsheet persist may store `parent_folder_id`; folder persist leaves it undefined.
- Returned / stored record does not contain the raw reference.
- Does not call later `getFileMetadata`.
- Does not import leftover `hashPickerSelectionReference`.
- Does not call already-recommended nonce `consumeActive`.

**Find the unused selection reference for this owner and this flow**
- Hash + matching owner + matching flow + unused + unexpired → the row, including stored `file_id`.
- Wrong owner → `null`.
- Wrong flow (folder hash asked as spreadsheet) → `null`.
- `consumed_at !== null` → `null`.
- `expires_at <= now` → `null`.
- Missing hash → `null`.
- Returned record does not contain the raw reference.
- Does not call later `getFileMetadata`.

**Consume the selection reference once**
- Happy path stamps `consumed_at` and returns the row.
- Second consume of the same hash + owner + flow → `null` (today’s replay, at this **interface**).
- Concurrent valid consumes yield one row and one `null` (today’s concurrent leftover destination create, at this **interface**).
- Wrong owner / wrong flow / expired still `null` and leave `consumed_at` null if the row was never this owner’s unused ticket for that flow.
- In-memory `get` after a failed already-recommended consume still shows `consumed_at === null` — that assertion stays on already-recommended picker’s tests; do not move it here as “find consumed.”

**Not this interface**
- Hand the Owner a one-time Picker / mint raw reference / 15-minute clock stay on already-recommended `picker.service.ts`.
- Verify’s metadata remap / denylist / display-field ignore stay on already-recommended `picker.service.ts`.
- Consume’s second Drive get / optional parent / leftover destination return stay on already-recommended `picker.service.ts`.
- Unused nonce find / consume stay on already-recommended `pickerNonceStore.ts`.
- SHA-256 reference fold stays on leftover `destinationIdentity.ts` (`pickerValidation.test.ts` already locks it).
- Metadata get / mime / owned-by-me / parent stay on later `driveMetadata.service.ts`.
- Leftover destination Picker-vs-create-vs-export **choice** stays on leftover `reportingDestination.service.ts`.
- Begin / complete / live client / health stay on already-recommended `googleDriveOAuth.service.ts`.
- AES-GCM / owner-email AAD stay on already-recommended `tokenEncryption.ts`.
- Signed-owner HTTP gate stays on already-recommended `ownerAuth.ts`.
- Wave B selection schema / TTL index stay on `models/GooglePickerSelection.ts`.

Do **not** add a test per helper (`refuseUnlessThisReferenceIsUnusedForThisOwnerAndFlow`, `handBackTheTicketWithoutTheRawReference`, `startTheTicketUnused`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not add a test that this file mints a raw reference — it must not. Do not add a test that this file hashes a raw reference — it must not. Do not add a test that this file fetches Drive — it must not. Do not add a test that this file consumes a nonce — it must not. Do not add a test that `findActive` now consumes — it must not. Do not add a test that persist now spends the nonce — it must not. Do not add a test that this file stores the raw reference — it must not. Do not add a test that consume now returns stored `name` / `url` as leftover destination’s payload — that return stays on already-recommended consume. Do not add a test that `countActive` is now an owner dashboard — it must not, in this rename. Do not add a test that skipped `index.ts` now re-exports this store — it must not, in this rename. Do not add a test that leftover destination now imports this file — it must not. Do not add a test that this file begins OAuth — it must not. Do not add a test that this file and already-recommended nonce store are now one class — it must not.

## What I would not do

- A `PickerSelectionService` class with `create` / `find` / `consume`.
- Thirty two-line functions that only wrap `create` / `findOne` / `findOneAndUpdate`.
- Moving this into a CRUD folder, or into already-recommended `picker.service.ts` / already-recommended `pickerNonceStore.ts` / leftover `destinationIdentity.ts` / Wave B `GooglePickerSelection` “for cleanliness.”
- Breaking the persist-after-prove **seam**, the find-then-consume **seam**, the concurrent-one-winner **seam**, the injected in-memory **adapter** **seam**, or the leftover-destination-must-re-prove-Drive **seam**.
- Treating already-recommended `picker.service.ts` / already-recommended `pickerNonceStore.ts` / leftover `destinationIdentity.ts` / later `driveMetadata.service.ts` / leftover `reportingDestination.service.ts` / already-recommended `googleDriveOAuth.service.ts` / Wave B `GooglePickerSelection` as this story.
- Inventing a mint **seam** that has only one **adapter** here, or a hash **seam** that has only one **adapter** here, or a metadata-get **seam** that has only one **adapter** here, or a `countActive` dashboard **seam** that has only one **adapter** here.
- Silently dropping `create`, or silently consuming inside `findActive`, or silently hashing the raw reference, or silently fetching Drive, or silently merging this ticket with already-recommended nonce rows, or silently teaching consume to query the model, or silently dropping the flow match, or silently returning stored display name from leftover destination, or silently adding these exports to skipped `index.ts`.
- Writing a whole-folder recommendation that pretends later metadata / managed-tab / leftover reporting are this module.
- Opening `driveMetadata.service.ts` in this same pass — stay on `googleDriveOAuth`; that file is the next unchecked module.
- Making a Form Lead 201 wait on `persistTheProvenPickAsAOneTimeSelectionReference`.
