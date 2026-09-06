# Name The Owner And The Files Without Keeping The Raw Email Or The One-Time Tickets — operational story

- Status: recommended
- Service: `reporting` (Wave A, in-progress)
- Pass: 5 of this service — `destinationIdentity.ts`
- Remaining in this service: `reportingDestination.service.ts`, `reportingDestinationRepository.ts`, `reportingDestinationPort.adapter.ts`, `query/canonicalReporting.ts`, `query/pagination.ts`, `reportingWorker.ts`, `deliveryEngine.ts`, `executionStream.ts`, `queue.ts`, `reportingRunRepository.ts`, `reportingDeliveryRepository.ts`, `reportingManifestRepository.ts`, `manifestPageAdapter.ts`, `promotion.ts`, `promotionReservation.ts`, `snapshotAdapter.ts`, `reportingObservability.ts`, `cleanup.ts`, `ownershipMarker.ts`, `registryFilters.ts`, leftover `google/*` adapters, leftover `live/*` harness
- Target: `src/services/reporting/destinationIdentity.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (primary code is leftover `reporting.service.ts`. Role: Owner-designed, checksum-bound reports. Happy path: estimate / confirm bind **stable destination identity**. Knowledge names destinations as an Owner desk and never names this file, `stable_owner_id`, picker hashes, or Drive URLs — do not add a Reporting Service file in this rename so “the Service sentence wins”). Distinct from already-recommended leftover preview / freeze / estimate / confirm: [`reporting-reporting.md`](reporting-reporting.md) (does **not** import this file; leftover estimate binds leftover contract’s stable-identity digest, not this owner hash). Distinct from already-recommended leftover prove-this-destination: [`reporting-destination-contract.md`](reporting-destination-contract.md) (hashes the destination snapshot / stable folder-tab identity; leftover `citeThisSavedDestinationRecord` **reads** persisted `owner_identity_snapshot.stable_owner_id` / `masked_email` and remaps them to camelCase — this file **writes** the snake_case stamp leftover desk persists). Distinct from already-recommended leftover keep-the-frozen-revision: [`reporting-destination-lineage.md`](reporting-destination-lineage.md) (predecessor sheet IDs — not an owner email). Distinct from already-recommended leftover Eastern window: [`reporting-timezone.md`](reporting-timezone.md). Distinct from leftover destination desk: sibling `reportingDestination.service.ts` (**asks** `ownerIdentitySnapshotFromEmail` on snapshot and replace-tab create; **asks** `driveFolderUrl` / `spreadsheetUrl` only through unused `destinationFolderArtifact` / `destinationWorkbookArtifact`; create itself reads `getGoogleDriveOAuthConfig().ownerEmail` and does **not** **ask** `expectedConfiguredOwnerEmail`). Distinct from leftover repository: sibling `reportingDestinationRepository.ts` (persists the snapshot leftover desk already built). Distinct from leftover Wave B `src/models/ReportingDestination.ts` (`OwnerIdentitySchema` requires snake_case `stable_owner_id` + `masked_email` — this file’s stamp is what that schema accepts). Distinct from leftover `src/utils/logging/sanitizeFormLeadForLog.ts` (`maskEmailForLog` — this file **asks** it; CRM payload and leftover Granot contact projection **ask** that util directly). Distinct from leftover Wave B `src/config/domain/googleDriveOAuth.ts` (`GOOGLE_OAUTH_OWNER_EMAIL` already lowercased — this file reads it through leftover `expectedConfiguredOwnerEmail`). Distinct from already-recommended Owner pick: [`google-drive-oauth-picker.md`](google-drive-oauth-picker.md) (**asks** `expectedConfiguredOwnerEmail` + `hashPickerNonce` + `hashPickerSelectionReference`; leftover picker mints the raw tickets; this file only folds). Distinct from already-recommended unused nonce ticket: [`google-drive-oauth-picker-nonce-store.md`](google-drive-oauth-picker-nonce-store.md) (stores `nonce_hash`; never sees the raw nonce). Distinct from already-recommended unused selection-reference ticket: [`google-drive-oauth-picker-selection-store.md`](google-drive-oauth-picker-selection-store.md) (stores `reference_hash`; leftover picker hashes first). Distinct from leftover live harness: `live/piiSafeEvidence.ts` (its **own** `maskGoogleFileId` — different ≤10 / `"***"` fold; leftover janitor and leftover live tests **ask** that copy; this file’s `maskGoogleFileId` has **no** caller). This is not Admin Analytics and not Sheet Sync. This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR).
- Callers: leftover `reportingDestination.service.ts` (`createReportingDestination` **asks** `ownerIdentitySnapshotFromEmail` for both strategies; unused `destinationFolderArtifact` / `destinationWorkbookArtifact` **ask** `driveFolderUrl` / `spreadsheetUrl`). Already-recommended `picker.service.ts` (`bootstrapGooglePicker` / `verifyGooglePickerSelection` / `consumePickerSelectionReference` **ask** `expectedConfiguredOwnerEmail`; bootstrap + verify **ask** `hashPickerNonce`; verify + consume **ask** `hashPickerSelectionReference`). Tests: `destinationIdentity.test.ts` proves snake_case keys, 32 hex `stable_owner_id`, masked ≠ raw, mongoose reject of camelCase, mongoose accept of the helper stamp. `pickerValidation.test.ts` proves nonce / reference hashes are 64 hex, deterministic, and not the raw ticket. `pickerVerification.test.ts` seeds leftover stores with those hashes. **Does not name** `stableOwnerIdFromEmail` / `expectedConfiguredOwnerEmail` / `driveFolderUrl` / `spreadsheetUrl` as operations. Leftover `reporting.test.ts` does not import this file. Leftover desk create does **not** **ask** `expectedConfiguredOwnerEmail`.
- Seams callers need: stamp-the-owner-we-persist (`ownerIdentitySnapshotFromEmail`) vs read-the-configured-Drive-owner (`expectedConfiguredOwnerEmail`) vs hash-the-one-time-Picker-tickets (`hashPickerNonce` / `hashPickerSelectionReference`) vs point-at-the-public-Drive-URL (`driveFolderUrl` / `spreadsheetUrl`). The persist / configured-email **seam** exists because leftover desk stamps Mongo and leftover picker looks up tickets by the live config email — they must stay the same owner. The nonce-hash / reference-hash **seam** exists because leftover stores must not mix tickets even though both folds are SHA-256. There is no begin / complete Domain Command **seam**. There is no Google write **seam**. There is no destination-checksum **seam** (leftover contract hashes). There is no picker-consume **seam**. There is no destination-desk **seam**. There is no Analytics **seam**. There is no Sheet Sync **seam**.
- Split later (only if the file outgrows one sitting): this ~48-line file is one sitting if you read it as name the owner and the files without keeping the raw email or the one-time tickets. Do **not** split into `owner.ts` / `hash.ts` / `urls.ts`. Do **not** split into `create.ts` / `update.ts` / `delete.ts`. Do **not** pull leftover desk create / leftover picker consume / leftover contract checksum here so “one identity file owns the company.” If it later splits: `stampTheOwnerIdentityWePersist.ts` / `hashThisOneTimePickerTicket.ts` only as later story files, never CRUD.

`stableOwnerIdFromEmail` / `ownerIdentitySnapshotFromEmail` / `hashPickerNonce` / `hashPickerSelectionReference` are executor mechanics. The owner question is: *When I create a destination or hand a Picker, name me by a stable hash of my configured Drive email, not the raw address. Store a masked email next to that hash so logs can say who without reprinting the inbox. Hash the one-time Picker nonce and selection reference so Mongo never sees the raw tickets. If leftover desk has a folder or workbook id and no URL, point at the public Drive / Sheets URL. Do not create the destination. Do not consume the ticket. Do not hash the destination snapshot. Do not write Google.*

Leftover destination desk, leftover prove-this-destination, leftover keep-the-frozen-revision, leftover picker consume, leftover nonce / selection stores already live in other **modules**. Do not pull those in.

## What this file actually does

Four operations of one “name the owner and the files without keeping the raw email or the one-time tickets” story, not “an identity helper,” and not leftover destination desk or leftover picker consume:

1. **Stamp the owner identity we persist** — `ownerIdentitySnapshotFromEmail`. Trim + lowercase. `stable_owner_id` is leftover `stableOwnerIdFromEmail` (SHA-256, first 32 hex chars). `masked_email` is leftover `maskEmailForLog` (first local character + `***` + domain; no `@` → `[redacted]`). Keys are snake_case because leftover `ReportingDestination.owner_identity_snapshot` rejects camelCase. Leftover desk create **asks** this for snapshot and replace-tab. Leftover `stableOwnerIdFromEmail` is a beat of this stamp, not a second owner operation — it has no other caller. Leftover contract / leftover desk live snapshot later remap the persisted snake_case onto camelCase `ownerIdentitySnapshot` for the checksum payload. This file does not hash the destination.

2. **Read the configured Drive owner email** — `expectedConfiguredOwnerEmail`. One line: leftover `getGoogleDriveOAuthConfig().ownerEmail` (Wave B config already lowercases `GOOGLE_OAUTH_OWNER_EMAIL`). Leftover picker bootstrap / verify / consume **ask** this before they hash or look up a ticket. Leftover desk create does **not** **ask** this — it reads the same config itself. This file does not compare the two.

3. **Hash the one-time Picker tickets so stores never see the raw nonce or reference** — `hashPickerNonce` and `hashPickerSelectionReference`. Full SHA-256 hex of the raw string. No trim. No lowercase. Leftover picker bootstrap writes `nonce_hash` after minting 32 random bytes. Leftover verify hashes the caller nonce, finds / spends leftover nonce store, mints a selection reference, then hashes that reference for leftover selection store. Leftover consume hashes the caller reference before find / spend. Already-recommended stores never see the raw ticket. Same algorithm, two names — leftover stores must not mix a nonce row with a selection row.

4. **Point at the folder / spreadsheet with a public URL when leftover desk has no URL** — `driveFolderUrl` / `spreadsheetUrl`. `https://drive.google.com/drive/folders/${id}` and `https://docs.google.com/spreadsheets/d/${id}/edit`. Leftover unused `destinationFolderArtifact` / `destinationWorkbookArtifact` **ask** these as `url ??` fallbacks. Leftover desk resolve today already takes a URL from leftover picker consume, leftover folder create, leftover workbook create, or leftover re-prove — those wrappers have **no** caller. Do not start calling them from leftover resolve so “the fallback is used.”

`maskGoogleFileId` is exported and unused. Leftover `live/piiSafeEvidence.ts` ships a different fold (`length <= 10` → `"***"`; this file’s copy is `length <= 8` → `"********"`). Leftover janitor and leftover live tests **ask** the live copy. Do not promote this unused export to a fifth owner operation.

## Organization

Keep one file. This is the screenplay for “name the owner and the files without keeping the raw email or the one-time tickets.” Destination create / verify, snapshot checksum, managed-tab lineage, picker mint / consume, and live PII sanitizer already live in deeper **modules**. Do not pull those in. Do not invent a `ReportingIdentityService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second owner-email **adapter** beside leftover `getGoogleDriveOAuthConfig`. Do not invent a second ticket-hash **adapter** beside leftover `createHash("sha256")`. Do not invent a second email-mask **adapter** beside leftover `maskEmailForLog`.

Do not split owner / ticket / URL into CRUD files. Persist stamp and picker hash stay together because leftover desk create and leftover picker must name the same configured owner. Do not start checking `REPORTING_GOOGLE_DELIVERY_ENABLED`. Do not start consuming a nonce.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `ownerIdentitySnapshotFromEmail` | `stampTheOwnerIdentityWePersist` | leftover desk create; snake_case Mongo stamp |
| `stableOwnerIdFromEmail` | `hashThisOwnerEmailToAStableId` | beat of the stamp; keep exported until leftover desk / tests drop it |
| `expectedConfiguredOwnerEmail` | `readTheConfiguredDriveOwnerEmail` | leftover picker looks up tickets by this email |
| `hashPickerNonce` | `hashThisOneTimePickerNonce` | leftover picker / leftover nonce store |
| `hashPickerSelectionReference` | `hashThisOneTimePickerSelectionReference` | leftover picker / leftover selection store |
| `driveFolderUrl` | `publicDriveFolderUrlForThisId` | leftover unused folder artifact fallback |
| `spreadsheetUrl` | `publicSpreadsheetUrlForThisId` | leftover unused workbook artifact fallback |
| `maskGoogleFileId` | (do not promote) | unused here; leftover live sanitizer owns the live fold |

Keep the old names as one-line aliases until leftover `reportingDestination.service.ts`, already-recommended `picker.service.ts`, `destinationIdentity.test.ts`, `pickerValidation.test.ts`, and `pickerVerification.test.ts` migrate. Do not make leftover desk learn `stableOwnerIdFromEmail` as the persist stamp — leftover mongoose **asks** `stampTheOwnerIdentityWePersist`. Do not make leftover picker learn one `hashThisTicket` for both stores.

**No class for the workflow.** The type that *does* earn a name is the persisted stamp leftover mongoose already requires:

```ts
type PersistedOwnerIdentity = {
  stable_owner_id: string
  masked_email: string
}
```

That is the handoff from “leftover desk has the configured email” to “leftover contract / leftover list can cite the owner without the inbox.” Do **not** put a Drive folder on this type. Do **not** collapse leftover contract’s camelCase `ownerIdentitySnapshot` into this type — that remap is leftover contract’s checksum payload. Do **not** put a picker hash on this type.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// destinationIdentity.ts
// The owner is about to create a destination or hand a Picker.
// Name them by a stable hash of the configured Drive email,
// not the raw address. Store a masked email next to that hash.
// Hash the one-time Picker nonce and selection reference
// so Mongo never sees the raw tickets.
// If leftover desk has a folder or workbook id and no URL,
// point at the public Drive / Sheets URL.
// Do not create the destination. Do not consume the ticket.
// Do not hash the destination snapshot.

// ── 1. Stamp the owner identity we persist ───────────────

export function stampTheOwnerIdentityWePersist(email) // snake_case stamp
export function hashThisOwnerEmailToAStableId(email)  // sha256, first 32 hex

function foldTheOwnerEmail(email)                     // trim + lowercase
function maskTheOwnerEmailForLogs(email)              // leftover maskEmailForLog

// ── 2. Read the configured Drive owner email ─────────────

export function readTheConfiguredDriveOwnerEmail()    // leftover getGoogleDriveOAuthConfig().ownerEmail

// ── 3. Hash the one-time Picker tickets ──────────────────

export function hashThisOneTimePickerNonce(nonce)     // full sha256 hex; no trim
export function hashThisOneTimePickerSelectionReference(reference)

function sha256Hex(value)

// ── 4. Point at the public Drive / Sheets URL ────────────

export function publicDriveFolderUrlForThisId(folderId)
export function publicSpreadsheetUrlForThisId(spreadsheetId)

/** @deprecated Use stampTheOwnerIdentityWePersist */
export const ownerIdentitySnapshotFromEmail = stampTheOwnerIdentityWePersist
/** @deprecated Use hashThisOwnerEmailToAStableId */
export const stableOwnerIdFromEmail = hashThisOwnerEmailToAStableId
/** @deprecated Use readTheConfiguredDriveOwnerEmail */
export const expectedConfiguredOwnerEmail = readTheConfiguredDriveOwnerEmail
/** @deprecated Use hashThisOneTimePickerNonce */
export const hashPickerNonce = hashThisOneTimePickerNonce
/** @deprecated Use hashThisOneTimePickerSelectionReference */
export const hashPickerSelectionReference = hashThisOneTimePickerSelectionReference
/** @deprecated Use publicDriveFolderUrlForThisId */
export const driveFolderUrl = publicDriveFolderUrlForThisId
/** @deprecated Use publicSpreadsheetUrlForThisId */
export const spreadsheetUrl = publicSpreadsheetUrlForThisId
```

Read the primary path out loud: leftover desk create reads the configured Drive email and **asks** this file to stamp snake_case `stable_owner_id` + `masked_email` onto the destination row. Leftover picker bootstrap reads that same configured email, mints a nonce, and **asks** this file to hash it before leftover nonce store writes the row. Leftover verify hashes the caller nonce, spends that row, mints a selection reference, and hashes the reference before leftover selection store writes. Leftover consume hashes the caller reference the same way. Leftover contract later cites the persisted stamp inside the destination checksum. Nobody in this file talks to Drive.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Leftover desk create does not ask `readTheConfiguredDriveOwnerEmail`.** It calls leftover `getGoogleDriveOAuthConfig().ownerEmail` itself, then **asks** `stampTheOwnerIdentityWePersist`. Leftover picker always **asks** this file. Do not silently route leftover desk through this export so “one reader owns the company.” Do not start comparing the two so “we prove they match” in this rename. If they ever diverge, leftover persist and leftover picker tickets would name different owners.

2. **Two ticket hashes are the same SHA-256.** `hashThisOneTimePickerNonce("x")` equals `hashThisOneTimePickerSelectionReference("x")`. Keep both names. Leftover nonce store and leftover selection store are different tickets. Do not merge them so “one hash owns the company.” Do not start prefixing the digest (`nonce:` / `reference:`) so “the stores cannot collide” — leftover rows already live in different collections.

3. **Owner id is 32 hex. Ticket hashes are 64 hex.** Do not lengthen `stable_owner_id` so “all hashes share one shape.” Leftover mongoose and leftover contract already persist / cite the truncated stamp. Do not shorten ticket hashes so “one width owns the company” — leftover picker tests lock 64 hex.

4. **Owner fold trims and lowercases. Ticket hashes do not.** Do not start trimming a nonce so “all hashes share one fold.” A leftover picker mint is already `base64url`; a caller space would miss the store on purpose.

5. **`hashThisOwnerEmailToAStableId` lowercases again after the stamp already did.** Harmless today. Do not delete the inner fold so “one normalize owns the company” without a test that `Owner@Example.com` and `owner@example.com` still match. Wave B config already lowercases `GOOGLE_OAUTH_OWNER_EMAIL` before either function runs.

6. **`maskGoogleFileId` on this file is dead.** Leftover live sanitizer’s copy uses a different threshold and a different placeholder. Do not merge them so “one mask owns the company.” Leftover janitor evidence would change from `1AbC…StUv` / `"***"` to this file’s `"********"` for short ids. Do not delete the unused export in this rename if a leftover desk log later grows onto it — leave it unused until leftover live agrees.

7. **`publicDriveFolderUrlForThisId` / `publicSpreadsheetUrlForThisId` have no live caller.** Leftover unused artifact helpers **ask** them. Leftover desk resolve already takes URLs from leftover picker / leftover create / leftover re-prove. Do not wire leftover resolve through the unused helpers so “the fallback is used.” Already-recommended leftover spreadsheet create already builds its own `folder_url` / `spreadsheet_url`.

8. **Leftover contract remaps snake_case → camelCase for the checksum payload.** Do not start persisting camelCase so “the snapshot type wins.” `destinationIdentity.test.ts` already refuses camelCase on leftover mongoose.

9. **`maskTheOwnerEmailForLogs` keeps the domain.** `Owner@Example.com` becomes something like `o***@example.com`, not `[redacted]`. Do not switch to full redaction so “PII is cleaner” — leftover destination list paints this stamp. Do not start hashing the domain.

10. **Leave sibling modules alone.** Leftover `createReportingDestination`, leftover `validateDestinationSnapshot`, leftover `hashPickerNonce` callers, leftover `maskEmailForLog`, leftover live `maskGoogleFileId` are already the right **depth**. This file does not create destinations, consume tickets, or write Google.

## Testing

The **interface** is the test surface: `stampTheOwnerIdentityWePersist`, `readTheConfiguredDriveOwnerEmail`, `hashThisOneTimePickerNonce`, `hashThisOneTimePickerSelectionReference`, `publicDriveFolderUrlForThisId`, `publicSpreadsheetUrlForThisId`.

Today’s `destinationIdentity.test.ts` already names snake_case keys, 32 hex, masked ≠ raw, mongoose reject of camelCase, mongoose accept of the helper. `pickerValidation.test.ts` already names 64-hex deterministic ticket hashes. Keep those. Add the missing named operations:

**Stamp the owner identity we persist**
- `Owner@Example.com` and `owner@example.com` → the same `stable_owner_id`.
- Keys stay `stable_owner_id` / `masked_email` (existing).
- `masked_email` is not the raw inbox and keeps the domain.
- No `@` → leftover `maskEmailForLog` `[redacted]`; still a 32-hex id.
- Leftover mongoose accepts the stamp and rejects camelCase (existing).

**Read the configured Drive owner email**
- Returns leftover `getGoogleDriveOAuthConfig().ownerEmail`.
- Do not boot leftover picker or leftover desk inside this test.

**Hash the one-time Picker tickets**
- Same nonce twice → same 64-hex digest; digest ≠ raw (existing).
- Same reference twice → same digest (existing).
- `hashThisOneTimePickerNonce("x")` equals `hashThisOneTimePickerSelectionReference("x")` — document that, do not “fix” it.
- Leading space on a nonce changes the digest (no trim).

**Point at the public Drive / Sheets URL**
- Folder id `folder-1` → `https://drive.google.com/drive/folders/folder-1`.
- Spreadsheet id `sheet-1` → `https://docs.google.com/spreadsheets/d/sheet-1/edit`.

Do **not** add a test per helper (`foldTheOwnerEmail`, `sha256Hex`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** start leftover desk create / leftover picker consume / leftover contract checksum / leftover live janitor inside these tests. Leftover `createReportingDestination` stays a desk test. Leftover `verifyGooglePickerSelection` stays a picker test. Leftover live `maskGoogleFileId` stays a live-harness test.

## What I would not do

- A `ReportingIdentityService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap leftover `createHash("sha256")`.
- Moving the module into `owner.ts` / `hash.ts` / `urls.ts` or `create.ts` / `update.ts` / `delete.ts`.
- Breaking the persist / configured-email **seam** (leftover desk stamp and leftover picker lookup must name the same owner).
- Treating leftover destination desk, leftover prove-this-destination, leftover keep-the-frozen-revision, leftover picker consume, leftover nonce / selection stores, leftover live sanitizer, leftover Analytics, or leftover Sheet Sync as this story.
- Inventing an owner-email **seam** that has only one **adapter** beside leftover `getGoogleDriveOAuthConfig`.
- Silently “fixing” leftover desk’s direct config read, unused `maskGoogleFileId`, unused URL artifact helpers, or the identical nonce / reference SHA-256 while recommending a rename.
- Jumping to `reportingDestination.service.ts`’s leftover destination desk — next pass is that module; do not pull it into this file. Do not jump to `ingestion` (or Wave B) while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `reporting`.
