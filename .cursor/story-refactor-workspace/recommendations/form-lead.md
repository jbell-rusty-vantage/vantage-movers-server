# Form Lead — operational story

- Status: recommended
- Service: `leads` (Wave A, in-progress)
- Pass: 1 of this service — `formLead.service.ts`
- Remaining in this service: `callLead.service.ts` and the rest of the `leads` checklist in TRAVERSAL.md
- Target: `src/services/leads/formLead.service.ts`
- Knowledge: `docs/knowledge/services/form-lead.md`
- Callers: `domainCommands/existingWrites.ts`, `leads/index.ts`, `v1.service.ts`, `routes/v1.routes.ts`, `granotCrmCsv/sync.service.ts`, `leadProvenance.replica.test.ts`
- Seams callers need: public `ingest` (WordPress) vs canonical `begin` / `complete`; correction may run inside a command transaction
- Split later (only if the file outgrows one sitting): `ingestFormLead.ts`, `correctFormLead.ts`, `findFormLead.ts`, `removeFormLead.ts` — never `create.ts` / `update.ts` / `delete.ts`

This is the quality bar. Later recommendations should match this depth, not this domain.

## What this file actually does

Four operations, not “a CRUD service”:

1. **Form Lead Ingestion** — a quote form becomes a Form Lead, then the rest of the company is told.
2. **Form Lead Correction** — an existing Form Lead is patched, with guards, then the Booking Chain is refreshed.
3. **Enrichment lookup** — the extension may see a live Form Lead; a Duplicate Lead is not a target.
4. **Removal** — the Form Lead is deleted, and sheets/booking follow only when allowed.

Create already tells that story. The names do not: `createFormLeadInTransaction`, `finalizeFormLeadCreateAfterCommit`, `persistFormLeadUpdateInTransaction`. Those are executor mechanics. Canonical commands need the before-commit / after-commit **seam**. The names should say what the operation is doing at that moment.

## Organization

Keep one file. This is the screenplay. Location, source assignment, duplicate detection, CPL, provenance, Sheet Sync, Lead Messaging, and CRM Posting already live in deeper **modules**. Do not pull those in. Do not invent a `FormLeadService` class.

If it later outgrows one sitting, split by **story**, not CRUD.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `createFormLead` | `ingestFormLead` | public / WordPress path: run the whole story |
| `createFormLeadInTransaction` | `beginFormLeadIngestion` | canonical command needs the write before commit |
| `finalizeFormLeadCreateAfterCommit` | `completeFormLeadIngestion` | messaging, sheets, CRM Posting, owner events after commit |
| `updateFormLead` | `correctFormLead` | admin / CSV / ordinary Form Edit |
| `updateFormLeadInTransaction` | `correctFormLeadInTransaction` | same correction inside a command |
| `findFormLead` | `findFormLeadForEnrichment` | 404 if missing **or** Duplicate Lead |
| `findAllFormLeads` | `listRecentFormLeads` | last 200 |
| `deleteFormLead` | `removeFormLead` | standalone delete |
| `deleteFormLeadInTransaction` | `beginFormLeadRemoval` | command delete + returned `finalize` |

Keep the old names as one-line aliases until `existingWrites`, `v1.service`, and the CSV sync are migrated. Do not make callers learn `InTransaction` as the domain language.

**No class for the workflow.** A class here would be a folder with a constructor. The one type that *does* earn a name is the pending create bag:

```ts
type FormLeadIngestionInProgress = { /* today's FormLeadCreateTransactionResult */ }
```

That is the handoff from “the lead is saved” to “tell Granot, the sheets, messaging, and the owner.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// formLead.service.ts
// A landing-page quote becomes a Form Lead.
// Later the owner may correct it, the extension may look it up,
// or the owner may remove it.

// ── 1. Form Lead Ingestion ────────────────────────────────

export async function ingestFormLead(input)
export async function beginFormLeadIngestion(input, tx)
export async function completeFormLeadIngestion(pending)

async function prepareTheQuoteForIngestion(input, tx)
function normalizeTheCustomer(form)
async function locateTheMove(form)
async function assignTheSourceGranularity(form, moveType)
async function detectADuplicateLead(source, phone, email, timestamp)
function decideWhetherToPostToGranot(requested, duplicate)
async function priceTheLead(sourceGranularity, timestamp)
function giveTheLeadAnIdentity(form)                  // lid, tracking ref, move_date
function rememberHowTheLeadArrived(origin, contact, move)
async function writeTheFormLead(prepared, session)
async function markMatchingCallLeadsAsFormFill(lead, session)  // skip if Duplicate Lead
async function rememberSheetSync(jobs, session)
async function rememberLeadMessaging(lead, input, session)

async function reportAMissingCplRate(lead)
async function sendTheLeadMessage(pending)
async function projectTheLeadOntoSheets(jobs)
async function postTheLeadToGranotWhenDue(lead, shouldPost, crmLabel)
async function recordWhatTheOwnerNeedsToKnow(pending, crm, messaging)

// ── 2. Form Lead Correction ───────────────────────────────

export async function correctFormLead(id, patch, options)
export async function correctFormLeadInTransaction(id, patch, tx, options)

async function loadTheLiveFormLead(id, expected, session)
function refuseIllegalCorrections(lead, patch)        // quoted/cuft on duplicate; bad on booked/cancelled
function applyTheAllowedPatch(lead, patch)            // strips lifecycle fields
async function relocateTheMoveIfAddressesChanged(lead, patch)
async function reassignTheSourceIfAttributionChanged(lead, patch)
async function repriceIfTheCostBasisChanged(lead, patch)
async function assignTheReceiverAgent(lead, patch)
function nothingMaterialChanged(before, after)
async function persistTheCorrectionAndRefreshTheBookingChain(lead, tx)

// ── 3. Lookup ─────────────────────────────────────────────

export async function listRecentFormLeads()
export async function findFormLeadForEnrichment(id)    // not found if Duplicate Lead

// ── 4. Removal ────────────────────────────────────────────

export async function removeFormLead(id, cascade)
export async function beginFormLeadRemoval(id, cascade, tx)

function refuseRemovalIfBookedWithoutCascade(lead, cascade)
async function removeTheAttachedBookingFirst(lead, cascade, tx)
async function tombstoneSheetSync(lead, session)
async function eraseTheFormLead(lead, session)
```

Read the create path out loud: *prepare the quote, normalize the customer, locate the move, assign the Source Granularity, detect a Duplicate Lead, decide whether to post to Granot, price the lead, give it an identity, remember how it arrived, write the Form Lead, mark matching Call Leads as Form Fill, remember Sheet Sync, remember Lead Messaging. After commit: report a missing CPL, send the message, project onto sheets, post to Granot when due, record what the owner needs to know.*

That is the operation. `createFormLeadInTransaction` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Two delete implementations.** `removeFormLead` and `beginFormLeadRemoval` copy the booked/cascade/tombstone rules. One story, two **adapters** (standalone vs command). Shared beats: refuse, cascade booking, tombstone, erase. Only the transaction/finalize wrapper differs.

2. **`updateFormLeadInTransaction` is a pass-through.** Delete it. `correctFormLead` already accepts an optional transaction.

3. **`persistFormLeadUpdateInTransaction` is not an update.** It saves, refreshes the Booking Chain, and remembers Sheet Sync. The name should say that (`persistTheCorrectionAndRefreshTheBookingChain`).

4. **`findFormLead` lies.** It is enrichment lookup and it hides Duplicate Leads. The name should say that, or the 404 will keep surprising people.

5. **Do not silently fix ADR-0002 in this pass.** `completeFormLeadIngestion` currently projects sheets **before** CRM Posting. The knowledge doc already flags that as reversed from ADR-0002. Rename the beats (`projectTheLeadOntoSheets` then `postTheLeadToGranotWhenDue`) so the order is visible. Reorder only as a separate, tested change.

6. **Leave sibling modules alone.** `normalizeLeadName`, `resolveRequiredLocation`, `resolveLeadSourceAssignment`, `findDuplicateFormLeadMatch`, `resolveLeadCplSnapshot` are already the right **depth**. This file orchestrates them.

## Testing

The **interface** is the test surface: `ingestFormLead`, `begin`/`complete` for commands, `correctFormLead`, `findFormLeadForEnrichment`, `removeFormLead`.

Today’s `formLead.service.test.ts` only stubs `findById` for duplicate quarantine and a couple of correction guards. That is not enough for a story this long.

Replace the stub style with tests that name the operation:

**Ingestion**
- A WordPress quote is saved as a Form Lead with `ingestion_origin: wordpress_form`.
- A Duplicate Lead is still saved, `post_to_granot` is forced off, Call Leads are **not** marked Form Fill, CRM Posting is skipped.
- A non-duplicate marks matching Call Leads as Form Fill and enqueues those Sheet Sync jobs in the same write.
- Sheet Sync intent and Lead Messaging intent are remembered **before** commit; dispatch and CRM happen **after**.
- Missing CPL is reported after commit, not inside the write.
- Best Relocation create may keep a trusted `local`; everyone else derives Move Type from states.

**Correction**
- Quoted / cubic feet / extension username-match on a Duplicate Lead → conflict.
- Bad Lead on duplicate, Booked, or Cancelled → conflict.
- Preview drift (`expected` miss or version error) → reload conflict.
- Zip/state patch relocates and may reassign source and reprice.
- No material field changes → no Sheet Sync, no booking refresh.

**Lookup / removal**
- Duplicate Lead is not found for enrichment.
- Booked Form Lead refuses delete without cascade.
- Queued mode tombstones Sheet Sync with the Duplicate Lead flag preserved.

Do **not** add a test per helper (`normalizeTheCustomer`, `decideWhetherToPostToGranot`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

`begin`/`complete` stay exported because canonical commands are a second real **adapter**, not a test leak.

## What I would not do

- A `FormLeadService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder “for cleanliness.”
- Breaking the before-commit / after-commit **seam**. Messaging and CRM Posting must not sit inside the Mongo write.
- Treating Granot `createLeadFromGranot` as this story. That command is a different origin and never CRM-posts.
