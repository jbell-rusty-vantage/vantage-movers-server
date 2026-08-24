# Call Lead — operational story

- Status: recommended
- Service: `leads` (Wave A, in-progress)
- Pass: 2 of this service — `callLead.service.ts`
- Remaining in this service: `duplicateLead.service.ts`, `leadIngestionProvenance.ts`, `leadSourceCompany.ts`, `leadCplResolution.ts`, `leadLocation.service.ts`, `leadName.service.ts`, `leadPhoneMatching.ts`, `sourceLeadLookup.service.ts`, `callLeadSourceMatch.ts`, `leadSourceCompatibility.ts`
- Target: `src/services/leads/callLead.service.ts`
- Knowledge: `docs/knowledge/services/call-lead.md`
- Callers: `domainCommands/existingWrites.ts`, `ringcentral/ringcentral-call-lead-ingest.service.ts`, `leads/index.ts`, `v1.service.ts`, `leadProvenance.replica.test.ts`
- Seams callers need: Admin/sheet `ingest` vs RingCentral `ingest`; canonical `begin` / `complete`; correction may run inside a command transaction; removal returns a `finalize`
- Split later (only if the file outgrows one sitting): `ingestCallLead.ts`, `ingestRingCentralCallLead.ts`, `correctCallLead.ts`, `removeCallLead.ts` — never `create.ts` / `update.ts` / `delete.ts`

## What this file actually does

Four operations, not “a CRUD service”:

1. **Call Lead Ingestion** — a sparse call becomes a Call Lead, then sheets and the owner are told. Two adapters share Form Fill, Florida time, CPL, provenance, and Sheet Sync: Admin/sheet (source is resolved here; Duplicate Lead is never set) and RingCentral (source and Duplicate Lead arrive already decided).
2. **Call Lead Correction** — an existing Call Lead is patched, with guards, then the Booking Chain is refreshed.
3. **List recent** — last 200 by `createdAt`. A Duplicate Lead stays visible.
4. **Removal** — the Call Lead is deleted, and the Booking plus both Calls / Duplicate Calls sheet tabs follow only when allowed.

Create already tells that story. The names do not: `createCallLeadInTransaction`, `createRingCentralCallLeadInTransaction`, `finalizeCallLeadCreateAfterCommit`, `persistCallLeadUpdateInTransaction`. Those are executor mechanics. Canonical commands and RingCentral ingest need the before-commit / after-commit **seam**. The names should say what the operation is doing at that moment.

`createLeadFromGranot` is not this file. Call Lead Enrichment and the RingCentral duplicate guard are not this file.

## Organization

Keep one file. This is the screenplay. Name, optional location, source assignment, Form Fill, CPL, provenance, Sheet Sync, Booking Chain refresh, and RingCentral qualification already live in deeper **modules**. Do not pull those in. Do not invent a `CallLeadService` class.

If it later outgrows one sitting, split by **story**, not CRUD. Admin/sheet ingest and RingCentral ingest may become sibling story files because they are different origins, not because one is create and the other is also create.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `createCallLead` | `ingestCallLead` | leftover public / `v1.service` path: run the whole Admin story (`ingestion_origin: vantage_admin`) |
| `createCallLeadInTransaction` | `beginCallLeadIngestion` | canonical command needs the write before commit; caller supplies origin |
| `finalizeCallLeadCreateAfterCommit` | `completeCallLeadIngestion` | sheets, missing-CPL, `lead.call.created`, Form Fill event after commit |
| `createRingCentralCallLead` | `ingestRingCentralCallLead` | injectable ingest adapter; own after-commit (no `lead.call.created`) |
| `createRingCentralCallLeadInTransaction` | `beginRingCentralCallLeadIngestion` | default ingest and replica tests need the write before commit |
| `updateCallLead` | `correctCallLead` | admin / CSV / ordinary Call Edit |
| `updateCallLeadInTransaction` | `correctCallLeadInTransaction` | same correction inside a command |
| `findAllCallLeads` | `listRecentCallLeads` | last 200; GET `/call-leads` already uses browse, not this |
| `deleteCallLead` | `removeCallLead` | standalone delete |
| `deleteCallLeadInTransaction` | `beginCallLeadRemoval` | command delete + returned `finalize` |
| `buildCallLeadDeletePreviousTargets` | `rememberBothCallSheetTabsForTombstone` | delete must hit Calls **and** Duplicate Calls even when `sheet_sync` is empty |

Keep the old names as one-line aliases until `existingWrites`, RingCentral ingest, `v1.service`, and the replica test are migrated. Do not make callers learn `InTransaction` as the domain language.

**No class for the workflow.** A class here would be a folder with a constructor. The one type that *does* earn a name is the pending create bag (Admin and RingCentral already return the same shape):

```ts
type CallLeadIngestionInProgress = { /* today's { lead, job, source_company, sourceAssignment, form_fill } */ }
```

That is the handoff from “the Call Lead is saved” to “tell the sheets and the owner.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// callLead.service.ts
// A phone call becomes a Call Lead.
// Admin / Best Relocation type it in. RingCentral promotes a qualified call.
// Later the owner may correct it, list recent ones, or remove it.

// ── 1a. Call Lead Ingestion — Admin / sheet ───────────────

export async function ingestCallLead(input)                 // origin hardcoded vantage_admin
export async function beginCallLeadIngestion(input, tx)     // caller supplies origin
export async function completeCallLeadIngestion(pending)

function normalizeTheCaller(input)
async function locateTheMoveIfWeHaveZips(input)
async function assignTheSourceGranularity(input, local)     // channel: call
async function detectFormFill(source, phone)
function stampFloridaTime(timestamp)
async function priceTheLead(sourceGranularity, timestamp)   // never passes duplicate
function rememberHowTheLeadArrived(origin, contact)
async function writeTheCallLead(prepared, session)
async function rememberSheetSync(job, session)

async function projectTheLeadOntoSheets(job)
async function reportAMissingCplRate(lead)
async function recordThatACallLeadWasCreated(lead)
async function recordFormFillWhenTrue(lead)

// ── 1b. Call Lead Ingestion — RingCentral ─────────────────

export async function ingestRingCentralCallLead(input)
export async function beginRingCentralCallLeadIngestion(input, tx)

function acceptTheAlreadyResolvedSource(input)              // ingest already assigned it
function acceptTheDuplicateLeadFlag(input)                  // 90-day guard is upstream
async function detectFormFill(source, phone)                // same beat as Admin
function stampFloridaTime(timestamp)
async function priceTheLead(sourceGranularity, timestamp, duplicate)  // duplicate_zero when Duplicate Lead
function rememberRingCentralTransport(input)
function rememberHowTheLeadArrived(/* origin: ringcentral */)
async function writeTheCallLead(prepared, session)
async function rememberSheetSync(job, session)
// after commit: project, missing CPL, Form Fill — not lead.call.created
// ingest itself records ringcentral.call_lead.created / duplicate_created

// ── 2. Call Lead Correction ───────────────────────────────

export async function correctCallLead(id, patch, options)
export async function correctCallLeadInTransaction(id, patch, tx)

async function loadTheLiveCallLead(id, session)
function refuseToMarkABookedCallAsDuplicate(lead, patch)
function applyTheAllowedPatch(lead, patch)                  // strips lifecycle fields; Florida time if patched
async function relocateTheMoveIfAddressesChanged(lead, patch)
async function reassignTheSourceIfAttributionChanged(lead, patch)
async function repriceIfTheCostBasisChanged(lead, patch)    // source, timestamp, or duplicate
async function assignTheReceiverAgent(lead, patch)
function nothingMaterialChanged(before, after)
async function persistTheCorrectionAndRefreshTheBookingChain(lead, tx)

// ── 3. List ───────────────────────────────────────────────

export async function listRecentCallLeads()                 // last 200; Duplicate Leads stay visible

// ── 4. Removal ────────────────────────────────────────────

export async function removeCallLead(id, cascade)
export async function beginCallLeadRemoval(id, cascade, tx)
export function rememberBothCallSheetTabsForTombstone(lead)

function refuseRemovalIfBookedWithoutCascade(lead, cascade)
async function removeTheAttachedBookingFirst(lead, cascade, tx)
async function tombstoneBothCallSheetTabs(lead, session)
async function eraseTheCallLead(lead, session)
```

Read the Admin ingest path out loud: *normalize the caller, locate the move if we have zips, assign the Source Granularity, detect Form Fill, stamp Florida time, price the lead, remember how it arrived, write the Call Lead, remember Sheet Sync. After commit: project onto sheets, report a missing CPL, record that a Call Lead was created, record Form Fill when true.*

Read the RingCentral ingest path out loud: *accept the already-resolved source, accept the Duplicate Lead flag, detect Form Fill, stamp Florida time, price the lead (zero if Duplicate Lead), remember RingCentral transport, remember how it arrived, write the Call Lead, remember Sheet Sync. After commit: project onto sheets, report a missing CPL, record Form Fill when true. Ingest records the RingCentral created event.*

That is the operation. `createRingCentralCallLeadInTransaction` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Two after-commit adapters that disagree.** `ingestRingCentralCallLead` projects sheets, reports missing CPL, and records Form Fill — it does **not** emit `lead.call.created`. `completeCallLeadIngestion` does emit it. Default-path `ingestRingCentralQualifiedCall` (no `createLead` override) calls `beginRingCentralCallLeadIngestion` then `completeCallLeadIngestion`, so a live RingCentral create currently gets both `lead.call.created` and `ringcentral.call_lead.created`. Knowledge says the RingCentral function does not emit `lead.call.created`. Rename both completes so the split is visible. Do not silently drop or add an event in this pass.

2. **`createRingCentralCallLead` is not the default write.** Ingest only uses that injectable when a test passes `dependencies.createLead`. The default path uses the transaction + `finalize` pair. Keep the injectable **seam**; stop talking as if the public RC function is what ingest runs.

3. **Two delete implementations.** `removeCallLead` and `beginCallLeadRemoval` copy the booked/cascade/tombstone rules. Standalone cascade still goes through `v1.service.deleteBookedLead`; the command path dynamically imports `bookings/bookedLead.service`. One story, two **adapters**. Shared beats: refuse, cascade booking, tombstone both tabs, erase. Only the transaction/finalize wrapper differs.

4. **`updateCallLeadInTransaction` is a pass-through.** Delete it. `correctCallLead` already accepts an optional transaction.

5. **`persistCallLeadUpdateInTransaction` is not an update.** It saves, refreshes the Booking Chain, and remembers Sheet Sync. The name should say that (`persistTheCorrectionAndRefreshTheBookingChain`).

6. **Missing CPL on correction can fire before command commit.** Standalone correction reports it after `finalizeSheetSync`. The in-transaction path still calls `recordMissingLeadCplRate` before the command returns. Rename so the early report is visible. Move it only as a separate, tested change.

7. **`ingestCallLead` is no longer the HTTP path.** `POST /api/v1/call-leads` goes through `runExistingCreateCallLead` → `begin` / `complete` with a derived origin. Keep the public function as an alias for `v1.service`. Do not teach new callers the hardcoded `vantage_admin` wrapper.

8. **Leave sibling modules alone.** `normalizeLeadName`, `resolveOptionalLocation`, `resolveLeadSourceAssignment`, `hasFormFillForCallLead`, `resolveLeadCplSnapshot`, `callLeadCreationProvenanceFields`, `classifyRingCentralCallLeadDuplicate`, and Call Lead Enrichment are already the right **depth**. This file orchestrates them.

## Testing

The **interface** is the test surface: `ingestCallLead`, `begin` / `complete` for commands, `beginRingCentralCallLeadIngestion`, `ingestRingCentralCallLead`, `correctCallLead`, `listRecentCallLeads`, `removeCallLead`, `rememberBothCallSheetTabsForTombstone`.

Today’s `callLead.service.test.ts` only covers tombstone fallbacks (both sheet tabs; preserve known row numbers). Provenance origin / `quoted=false` lives on `leadIngestionProvenance` and the replica test. That is not enough for a story this long.

Replace the stub style with tests that name the operation:

**Admin / sheet ingestion**
- An Admin call is saved as a Call Lead with `ingestion_origin: vantage_admin` and `quoted: false`.
- A Best Relocation command derives `best_relocation_sheet` and still never sets Duplicate Lead.
- Form Fill is true only when a non-duplicate Form Lead shares source + phone; missing phone stays false.
- Sheet Sync intent is remembered **before** commit; dispatch and owner events happen **after**.
- Missing CPL is reported after commit, not inside the write.
- `lead.call.created` fires; `lead.call.form_fill_detected` fires only when Form Fill is true.
- No CRM Posting.

**RingCentral ingestion**
- Ingest-supplied Duplicate Lead stores `cpl = 0` / `duplicate_zero` and still Sheet Syncs.
- Non-duplicate takes the registry CPL snapshot.
- `ringcentral.*` transport and `ingestion_origin: ringcentral` are written; nested `ingestion_source` stays transport, not origin.
- Telephony-session unique index: a second insert of the same session fails; that is not a business Duplicate Lead.
- `ingestRingCentralCallLead` does **not** emit `lead.call.created`.
- Default ingest (`begin` + `complete`) currently **does** emit `lead.call.created` and ingest still emits `ringcentral.call_lead.created`. Prove today’s pair. Do not “fix” it in this pass.

**Correction**
- Booked Call Lead + `duplicate: true` → conflict. The 90-day guard is not re-run.
- Zip/state/`local` patch relocates and may reassign source and reprice.
- Source / timestamp / duplicate patch reprices; unrelated patches keep the CPL snapshot.
- Missing receiver agent → 404.
- No material field changes → no Sheet Sync, no booking refresh.

**List / removal**
- Duplicate Lead remains in the last-200 list.
- Booked Call Lead refuses delete without cascade.
- Queued mode tombstones **both** Calls and Duplicate Calls tabs, keeping known `sheet_sync` row numbers.

Do **not** add a test per helper (`detectFormFill`, `acceptTheDuplicateLeadFlag`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

`begin` / `complete` stay exported because canonical commands and RingCentral ingest are real **adapters**, not a test leak.

## What I would not do

- A `CallLeadService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder “for cleanliness.”
- Breaking the before-commit / after-commit **seam**. Sheet dispatch and owner events must not sit inside the Mongo write.
- Treating Granot `createLeadFromGranot` as this story. That command is a different origin and may create a Job-only Call Lead.
- Treating Call Lead Enrichment, RingCentral qualification, or the 90-day duplicate guard as this story.
- Silently dropping `lead.call.created` from the default RingCentral `complete` path, or adding it to `ingestRingCentralCallLead`, to make the knowledge doc look tidy.
- Pulling `refreshAttachedBookingFromLead` or `deleteBookedLead` into this file as if they were Call Lead beats.
