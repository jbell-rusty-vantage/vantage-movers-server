# Book This Lead — operational story

- Status: recommended
- Service: `bookings` (Wave A, in-progress)
- Pass: 1 of this service — `bookedLead.service.ts`
- Remaining in this service: `bookedLeadFromSource.service.ts`, `referralBooking.service.ts`, `leadlessBooking.service.ts`, `bookingMirror.service.ts`, `bookingSourceResolver.ts`, `bookingIdentity.ts`
- Target: `src/services/bookings/bookedLead.service.ts`
- Knowledge: `docs/knowledge/services/bookings.md` (this file is the lead-attached write; the Service also covers from-source, referral, leadless, and the mirror). This checkout’s `CONTEXT.md` does not define Booking terms — do not invent a glossary copy.
- Callers: `domainCommands/existingWrites.ts` (`createBookingFromLead` begin/complete, `updateBookedLead`, `deleteBookedLead`), `bookedLeadFromSource.service.ts` (delegates after the lead is found), `bookings/index.ts` → `v1.service.ts`, `routes/v1.routes.ts` (`findAllBookedLeads`; mutating `/booked-leads` already goes through the command adapters), `formLead.service.ts` / `callLead.service.ts` (cascade removal via the `v1.service` facade), `customers/customer.service.ts` (same facade, cycle break). Referral and leadless only import `populateBookedLead`.
- Seams callers need: public `book` vs canonical `begin` / `complete`; correction may run inside a command transaction; removal returns a `finalize`; from-source is a different origin that still uses this write
- Split later (only if the file outgrows one sitting): `bookThisLead.ts`, `correctThisBooking.ts`, `removeThisBooking.ts` — never `create.ts` / `update.ts` / `delete.ts`

Knowledge still titles this “Core CRUD.” The names agree: `createBookedLeadInTransaction`, `persistBookedLeadCreateInTransaction`, `finalizeBookedLeadCreateAfterCommit`. Those are executor mechanics. The owner question is: *this Form or Call is already in Mongo. Book it, tell the Lead, tell the sheets — or correct it, or take it off.*

## What this file actually does

Four operations, not “a CRUD service”:

1. **Book this Lead** — a Form or Call that already has a Mongo id becomes a Booking. Agents and Merchant are resolved first. Then one write either ignores a repeat `submission_id`, refreshes the one Booking already hanging off that Lead, or inserts a new one. The Lead is mirrored in the same write. Sheets and the owner are told after commit.
2. **Correct this Booking** — merchant, deposit, agents, local. Referral and leadless are refused. The Lead is mirrored again. Canonical correction may no-op when no booked fields changed; the leftover public function always writes.
3. **List recent Bookings** — last 200, with customer and agents populated.
4. **Remove this Booking** — optionally the Cancellation too. The surviving Lead is cleared. Sheets are tombstoned (queued) or deleted inline (legacy). Referral and leadless may be removed without a Lead.

From-source, Referral, Leadless, employee claim, and Granot Owner confirm are not this file. They either find a Lead and then call this write, or they write a Booking with no Lead at all.

## Organization

Keep one file. This is the screenplay. Agent Allocation, Merchant, Customer upsert, Lead load, Form-Lead company correction, Best Relocation import fence, zero-binder warnings, Lead ↔ Booking mirror, and Sheet Sync already live in deeper **modules**. Do not pull those in. Do not invent a `BookedLeadService` class.

If it later outgrows one sitting, split by **story**, not CRUD. Booking this Lead and correcting it may become sibling story files because they are different owner moves, not because one is create and the other is update.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `createBookedLead` | `bookThisLead` | leftover public / from-source path: run the whole story |
| `createBookedLeadInTransaction` | `beginBookingThisLead` | canonical `createBookingFromLead` needs the write before commit |
| `persistBookedLeadCreateInTransaction` | `writeTheBookingAndMirrorTheLead` | shared write: ignore / rebook / insert |
| `finalizeBookedLeadCreateAfterCommit` | `completeBookingThisLead` | sheets + `booking.created` / `upserted` / `duplicate_submission_ignored` after commit |
| `updateBookedLead` | `correctThisBooking` | leftover public path (always writes) |
| `updateBookedLeadInTransaction` | `correctThisBookingInTransaction` | same correction inside a command (may no-op) |
| `findAllBookedLeads` | `listRecentBookings` | last 200 |
| `deleteBookedLead` | `removeThisBooking` | standalone / cascade-from-Lead / customer wipe |
| `deleteBookedLeadInTransaction` | `beginBookingRemoval` | command delete + returned `finalize` |
| `populateBookedLead` | `loadTheBookingForTheOwner` | customer + agent allocations; `orFail` if it vanished |

Keep the old names as one-line aliases until `existingWrites`, from-source, `v1.service`, and the cascade deletes are migrated. Do not make callers learn `InTransaction` as the domain language.

**No class for the workflow.** A class here would be a folder with a constructor. The one type that *does* earn a name is the pending book bag:

```ts
type BookingThisLeadInProgress = {
  kind: "create" | "upsert" | "duplicate"
  bookingId: ObjectId
  totalBinderAmount: number
  sourceCompany: SourceCompany | null
  warnings: string[]
  job?: FullSheetSyncJob
}
```

That is the handoff from “the Booking is saved and the Lead already says booked” to “tell the sheets and the owner which of the three things just happened.”

Today `CreateBookedLeadServiceInput` is the extra bag from-source needs (`job_no` optional, customer override, inactive agents, primary-as-receiver, Best Relocation `ingestion_source`). Keep it. Do not promote it to a public Zod schema.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// bookedLead.service.ts
// A Form or Call already lives in Mongo.
// The owner books it, later corrects the deposit or the agents,
// or takes the Booking off.
// Finding that Lead (from-source), booking with no Lead
// (referral / leadless), and the mirror implementation are other files.

// ── 1. Book this Lead ─────────────────────────────────────

export async function bookThisLead(input)
export async function beginBookingThisLead(input, tx)
export async function completeBookingThisLead(pending)

async function prepareTheBookingBeforeTheWrite(input)
  // agents (optionally inactive), Merchant, total Binder, zero-binder warnings
  // strip control fields so they never land on BookedLead

async function writeTheBookingAndMirrorTheLead(input, prepared, tx)
async function loadTheLeadWeAreBooking(input, session)
function refuseUnlessBestRelocationOwnsThisLead(input, lead)   // import fence only
function nameTheBookingSourceForTheSheets(lead, input)        // display label, not assignment
function requireLocalWhenThisIsAFormLead(input, lead)
async function rememberTheCustomer(input, lead, session)

async function ignoreARepeatSubmission(existing, input)       // same submission_id; no sheet job
async function rebookTheSameLead(existing, prepared, lead)    // one Booking per Lead; booking_chain upsert
async function writeANewBooking(prepared, lead)               // booking_chain create

async function stampThePrimaryAgentAsReceiverWhenAsked(lead, allocations, input)
async function rememberBookingChainSheetSync(job, session)

async function tellTheOwnerTheSubmissionWasADuplicate(pending)
async function projectTheBookingChain(job)
async function tellTheOwnerTheLeadWasBooked(pending, kind)

// ── 2. Correct this Booking ───────────────────────────────

export async function correctThisBooking(id, patch)
export async function correctThisBookingInTransaction(id, patch, tx)

async function loadTheLiveBooking(id, session)
function refuseReferralOrLeadlessCorrection(booking)
function refuseWhenTheLeadLinkIsMissing(booking)
async function applyTheAllowedPatch(booking, patch)           // merchant, deposit thresholds, agents
function mergeOrReplaceTheAgents(booking, incoming, mode)
function nothingOnTheBookingChanged(before, after)            // BOOKED_LEAD_CHANGE_PATHS; command only
async function persistTheCorrectionAndMirrorTheLead(booking, lead, tx)
  // mirror does not pass a source-company override on correction

// ── 3. Lookup ─────────────────────────────────────────────

export async function listRecentBookings()
export async function loadTheBookingForTheOwner(id)

// ── 4. Remove this Booking ────────────────────────────────

export async function removeThisBooking(id, cascade)
export async function beginBookingRemoval(id, cascade, tx)

function refuseRemovalIfCancelledWithoutCascade(booking, cascade)
function refuseWhenThereIsNoLeadAndThisIsNotReferralOrLeadless(booking)
async function removeTheAttachedCancellationFirst(booking, cascade, session)
async function clearTheLeadSoItIsUnbooked(leadModel, leadId, session)
async function tombstoneTheBookingSheets(booking, session)    // queued
async function eraseTheBookingFromSheetsInline(booking)       // legacy
async function eraseTheBooking(booking, session)
```

Read the book path out loud: *Prepare the agents, the Merchant, and the Binder. Load the Lead. Fence Best Relocation import. Name the source the sheets will show. Require Move Type when this is a Form Lead. Remember the customer. If this Lead already has a Booking and the same submission came again, give that Booking back and stop. If it already has a Booking from a different submission, refresh it. Otherwise write a new one. In the same write, stamp the Lead booked and remember Booking Chain Sheet Sync. After commit: project the chain, then tell the owner whether this was new, a rebook, or a duplicate submission.*

That is the operation. `createBookedLeadInTransaction` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Two remove implementations.** `removeThisBooking` and `beginBookingRemoval` copy the cancelled-without-cascade, missing-lead, cascade-cancellation, clear-the-Lead, and queued-vs-legacy sheet rules. One story, two **adapters** (standalone / cascade-from-Lead vs command). Shared beats: refuse, cascade cancellation, clear Lead, tombstone or inline erase, erase Booking. Only the transaction / `finalize` wrapper and the EntityChange mutations differ.

2. **`beginBookingThisLead` duplicates `bookThisLead`’s prepare.** Agents, Merchant, Binder, warnings, and the control-field strip are copied above `persist`. Extract `prepareTheBookingBeforeTheWrite`. Agent catalog writes stay **outside** the booking transaction — that comment is load-bearing.

3. **`persistBookedLeadCreateInTransaction` is not a persist.** It may ignore a repeat submission, rebook the same Lead, or insert. The name should say that (`writeTheBookingAndMirrorTheLead`). The three `kind`s are the story, not “create succeeded.”

4. **Public correction always writes; the command may no-op.** Knowledge already records this. `correctThisBookingInTransaction` returns early when `BOOKED_LEAD_CHANGE_PATHS` is empty — no save, no mirror, no sheet job. `correctThisBooking` still `Object.assign`s, saves, mirrors, and enqueues `booked_lead.update` even when nothing material changed. Rename both so the gap is visible. Do **not** silently teach the public function the no-op. Routes already use the command.

5. **Public correction mutates the document before the write.** `updateBookedLead` loads the Booking, patches it in memory, then enters `runSheetSyncWrite` to save. If the write fails, the in-memory object is already dirty for any later reuse of that instance. The command path patches inside the transaction. Do not “fix” the leftover public order while renaming.

6. **Zero-binder warnings use the incoming list, not the merged one.** On correction, `buildBookedLeadWarnings(resolvedAllocations)` runs on what the owner just sent. A patch-mode merge can leave other agents at zero and stay silent. Do not switch the warning to the merged list so the name “feels fair.”

7. **`resolveBookedLeadSource` names a display label.** It is not Source Assignment. Assignment is from-source (override written onto the Lead before this file) and the mirror when `sourceCompany` is passed. This function picks: Form-Lead company correction → CRM / granularity / company snapshot → resolved Lead company label → request `source`. Keep that ladder. Do not call `resolveLeadSourceAssignment` from here.

8. **Form Lead requires `local`; Call Lead does not.** The throw is only `lead_model !== "CallLead"`. A Call Lead may be booked before Move Type exists. Do not require `local` on every book so the names line up.

9. **One Booking per Lead is not one Booking per Job.** The create lookup is `{ lead_ref, lead_model }`. A second book of the same Lead upserts unless `submission_id` matches. Job uniqueness is the `normalized_job_no` index on the model, not this file. Do not add a job-collision throw here because referral / leadless do that.

10. **The lying JSDoc on `deleteBookedLeadInTransaction`.** It currently says it “Loads a booked lead with the populated relations expected by route responses.” That is `populateBookedLead`. Fix the comment when renaming; do not change `orFail` behavior.

11. **Leave sibling modules alone.** `resolveBookingSourceLead`, `createBookedLeadFromSource`, `createReferralBooking`, `createLeadlessBooking`, `mirrorBookingToLead`, `clearBookingFromLead`, `claimAvailableLeadForBooking`, and `classifyLeadSourceCompatibility` stay where they are. This file orchestrates the lead-attached write.

12. **Do not silently drop legacy Sheet Sync on remove.** Queued mode tombstones; legacy deletes rows inline (`deleteBookedLeadFromSheets` / `deleteCancelledLeadFromSheets`) and `clearBookingFromLead` may sync the Lead inline. Both adapters still branch. Keep the branch.

13. **Do not treat Granot Owner confirm as this story.** `domainCommands/bookings.ts` `updateBooking` / Owner confirm compose official fields and case CAS. They are a different origin. Employee `claimAvailableLeadForBooking` is the mirror file.

14. **`createBookedLead` is no longer the HTTP path.** `POST /api/v1/booked-leads` is `createBookingFromLead` → `begin` / `complete`. The leftover public function remains because from-source’s non-command helper and any facade caller still run the whole story. Do not delete it “because the route moved.”

## Testing

The **interface** is the test surface: `bookThisLead`, `begin` / `complete` for commands, `correctThisBooking` / `correctThisBookingInTransaction`, `removeThisBooking`.

There is no `bookedLead.service.test.ts`. `domainCommands.test.ts` only asserts that the `InTransaction` names still exist. Mirror, identity, and the Best Relocation fence have their own files. That is not enough for a story this long.

Add tests that name the operation. Do not add a test per helper.

**Book this Lead**
- A Form Lead with `local` is saved as a Booking; the Lead is marked booked in the same write; Booking Chain Sheet Sync is remembered **before** commit and dispatched **after**.
- A Form Lead without `local` and without `input.local` is refused.
- A Call Lead may book without `local`.
- Same Lead + same `submission_id` → existing Booking returned, `booking.duplicate_submission_ignored`, **no** sheet job.
- Same Lead + different submission → upsert, `booking_chain` / `booked_lead.upsert`, `booking.upserted`.
- No existing Booking → insert, `booked_lead.create`, `booking.created`.
- Best Relocation `ingestion_source` on a non-`best_relocation_leads` Lead is refused.
- Customer name override upserts from contact; otherwise from the Lead.
- Agents and Merchant are resolved **before** the Mongo write.
- Missing `job_no` is allowed on this **interface** (from-source / Call booked before a Job Number). Public Zod still requires it on `/booked-leads`.

**Correct this Booking**
- Referral → 409. Leadless → 409. Missing `lead_ref` / `lead_model` → 409.
- Deposit patch retargets `over_2000` / `over_4000`.
- `agent_allocation_mode: replace` replaces; default patches.
- Command path: no `BOOKED_LEAD_CHANGE_PATHS` diffs → no save, no mirror, no sheet job.
- Leftover public path: still writes + mirrors + `booked_lead.update` when fields are unchanged. Lock that until a separate change.
- Mirror on correction does **not** pass a source-company override.
- Warnings come from the incoming allocation list, not the merged list.

**Lookup / removal**
- List is last 200, newest first, customer and agents populated.
- Cancelled Booking refuses delete without `cascade`.
- Cascade queued mode tombstones the Cancellation and the Booking, clears the Lead (`syncAfterClear: false`), enqueues `source_lead` / `delete_booked_lead`.
- Referral / leadless may be removed without a Lead.
- A Booking that is neither linked nor referral/leadless → 409.
- Form / Call Lead cascade delete and customer wipe still call this removal (via `v1.service`).

Do **not** add a test per helper (`nameTheBookingSourceForTheSheets`, `ignoreARepeatSubmission`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

`begin` / `complete` stay exported because canonical commands are a second real **adapter**, not a test leak.

Do not re-test `resolveBookingSourceLead`, unmatched Call stub creation, Referral job collision, leadless reconciliation cases, or `claimAvailableLeadForBooking` here.

## What I would not do

- A `BookedLeadService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `save` or `mirrorBookingToLead`.
- Moving this into a CRUD folder “for cleanliness.”
- Breaking the before-commit / after-commit **seam**. Sheets and owner events must not sit inside the Mongo write.
- Teaching public `correctThisBooking` the command no-op, or teaching the command to always write, so the two **adapters** “agree.”
- Calling `resolveLeadSourceAssignment` from the display-label ladder.
- Requiring `local` on Call Lead book, or adding a job-number collision throw that belongs to referral / leadless.
- Pulling from-source, Referral, Leadless, employee claim, or Granot Owner confirm into this file.
- Writing a whole-folder `bookings` recommendation in this pass.
