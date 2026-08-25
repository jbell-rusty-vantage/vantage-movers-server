# Book A Referral — operational story

- Status: recommended
- Service: `bookings` (Wave A, in-progress)
- Pass: 3 of this service — `referralBooking.service.ts`
- Remaining in this service: `leadlessBooking.service.ts`, `bookingMirror.service.ts`, `bookingSourceResolver.ts`, `bookingIdentity.ts`
- Target: `src/services/bookings/referralBooking.service.ts`
- Knowledge: `docs/knowledge/services/bookings.md` (section 3, Referral). This checkout’s `CONTEXT.md` does not define Booking terms — do not invent a glossary copy.
- Callers: `domainCommands/existingWrites.ts` (`runExistingCreateReferralBooking` → `createExistingReferralBooking`), `bookings/index.ts` → `v1.service.ts` (leftover public export). `POST /api/v1/referral-bookings` already goes through the command adapter. `domainCommands.test.ts` only asserts the `InTransaction` name still exists. Ingestion tests mock canonical `createReferralBooking` — that is the Granot Owner command, not this file.
- Seams callers need: leftover public `book` vs canonical `begin` / `complete`; job collision is checked before the write; sheets run after commit
- Split later (only if the file outgrows one sitting): keep one file — this is already one origin. Do not split into `create.ts`. Granot Owner Referral stays in `granotLifecycle/referralBooking.ts`.

Knowledge still titles this “Referral bookings (no source lead).” The names agree: `createReferralBooking`, `createReferralBookingInTransaction`. Those are executor mechanics. The owner question is: *there is no Lead. The owner typed a Job Number, a customer, agents, and a deposit. Book that as a Referral, or stop if that Job already exists.*

## What this file actually does

One operation, not “a CRUD service” and not Book This Lead:

1. **Book a Referral** — no Form or Call is attached. Refuse if that raw `job_no` already exists. Resolve agents (name + optional split) and Merchant first. Remember the customer from the contact the owner typed. Write a Booking stamped `is_referral_booking` and `source: "referral"`. Remember Master Booked Sheet Sync in the same write. After commit, project that row.

Finding a Lead, booking a Lead, Leadless, employee claim, and the gated Granot Owner Referral command are not this file. Correction, public delete, and public cancel live on `bookedLead.service.ts` / `cancelled-lead` and already 409 Referral update and cancel.

## Organization

Keep one file. This is the screenplay for “the owner booked a Referral.” Agent name-split, Merchant, Customer upsert, zero-binder warnings, and Sheet Sync already live in deeper **modules**. Do not pull those in. Do not invent a `ReferralBookingService` class.

If it later outgrows one sitting, the split is still this origin vs Granot Owner Referral, never CRUD.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `createReferralBooking` | `bookAReferral` | leftover public path: run the whole story |
| `createReferralBookingInTransaction` | `beginBookingAReferral` | canonical `createExistingReferralBooking` needs the write before commit |
| returned `finalize` | `completeBookingAReferral` | Master Booked Sheet Sync after commit |

Keep the old names as one-line aliases until `existingWrites` and the leftover barrel migrate. Do not make callers learn `InTransaction` as the domain language.

**No class for the workflow.** A class here would be a folder with a constructor. The one type that *does* earn a name is the pending referral bag:

```ts
type BookingAReferralInProgress = {
  booking: BookedLeadDocument
  warnings: string[]
  finalize: () => Promise<{
    booking: PopulatedBookedLead
    message: "Referral booking created."
    warnings: string[]
    total_binder_amount: number
  }>
}
```

That is the handoff from “the Referral is saved and Master Booked intent is remembered” to “project that row and give the owner the populated Booking.”

Today the command adapter builds one `BookedLead` EntityChange here (`revision_before: 0`). Keep that **seam**. Do not move mutation planning into `existingWrites` “because the leftover public path has none.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// referralBooking.service.ts
// There is no Lead.
// The owner typed a Job Number, a customer, agents, and a deposit.
// Book that as a Referral, or stop if that Job already exists.
// Booking a Lead, Leadless, and the Granot Owner Referral
// command are other files.

// ── 1. Book a Referral ────────────────────────────────────

export async function bookAReferral(input)
export async function beginBookingAReferral(input, tx)
export async function completeBookingAReferral(pending)

function refuseIfThisJobAlreadyExists(jobNo, session?)
  // raw job_no after trim — not normalized_job_no
async function prepareTheReferralBeforeTheWrite(input)
  // derive allocations from agent / split_agent / total_binder_amount
  // resolve active catalog agents; resolve Merchant; zero-binder warnings
async function rememberTheCustomerFromTheTypedContact(name, phone, session)
async function writeTheReferralBooking(prepared, customer, now, session)
  // source: "referral", is_referral_booking: true, no lead_ref / lead_model
  // over_2000 / over_4000 from deposit
async function rememberMasterBookedSheetSync(bookingId, session)
  // booked_lead / referral_booking.create — not booking_chain
async function projectTheReferralOntoSheets(bookingId)
```

Read the path out loud: *Refuse if this Job Number already exists. Prepare the agents and the Merchant. Remember the customer from the name they typed. Write a Booking that is a Referral — no Lead, source referral. Remember Master Booked Sheet Sync. After commit: project that row.*

That is the operation. `createReferralBookingInTransaction` is not.

The leftover public path says the same story, except the clock is `new Date()` instead of `tx.now`, and the job collision check has no session.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Two copies of the whole story.** `bookAReferral` and `beginBookingAReferral` both refuse the Job, split agents, resolve Merchant, upsert the customer, write the Referral, and remember Sheet Sync. One story, two **adapters** (leftover public vs command). Shared beats: refuse Job, prepare, remember customer, write, remember sheets. Only the transaction / `finalize` wrapper, the clock (`tx.now` vs `new Date()`), and EntityChange mutations differ.

2. **Job collision is the raw string, not the unique index.** Both adapters `findOne({ job_no: trimmed })`. Knowledge already records this. The model unique contract is partial `{ normalized_job_no }`. `bookingIdentity.ts` already knows digit-core equivalence (`P100` vs `100`). A differently cased or prefixed Job can pass this 409 and still fail the unique index — or miss a sibling Booking the owner would call “the same Job.” Rename `refuseIfThisJobAlreadyExists` so the raw lookup is visible. Do **not** silently switch to `equivalentNormalizedJobFilter`. Leadless copies the same raw check; leave that file alone.

3. **The leftover public clock is wall time.** Command stamps `toFloridaTimestamp(tx.now)`. Public stamps `toFloridaTimestamp(new Date())`. Canonical replay / executor time is the command clock. Do not teach the leftover path `tx.now` so the adapters “agree.”

4. **Public job check has no session.** Two leftover public writers can both pass `findOne` and then one hits the unique index. The command check uses `tx.session`. Do not wrap the leftover public path in a transaction so they “agree.”

5. **Agents and Merchant stay outside the write.** Same load-bearing comment as Book This Lead. Catalog resolves run before `runSheetSyncWrite` / the command transaction. Customer upsert stays **inside** the write (session). Do not move agent resolve inside, or customer upsert outside, while renaming.

6. **No `booking.created` event.** Book This Lead tells the owner `created` / `upserted` / `duplicate_submission_ignored`. This file only returns a message string and warnings. Do not add an observability event so Referral “matches” lead-attached book.

7. **Sheet Sync is Master Booked, not the Booking Chain.** Job is `resource: "booked_lead"`, `operation: "referral_booking.create"`. There is no source-lead row to refresh. Do not enqueue `booking_chain` because lead-attached book does.

8. **Binder is the owner’s total, then split.** `deriveBookedLeadAgentAllocations` is called with `binder_amount: input.total_binder_amount`. This file never calls `resolveTotalBinderAmount`. Stored `total_binder_amount` is the request field. Do not recompute from allocations here so the name “feels honest.”

9. **Client cannot stamp Referral.** Zod rejects `source` and `is_referral_booking`. The server writes `REFERRAL_SOURCE` (`"referral"`) and `is_referral_booking: true`. `local` is required on this Zod (unlike Call Lead book). Do not accept those flags from the body “for flexibility.”

10. **No inactive agents, no Best Relocation fence.** Referral is not an import path. `resolveAgentAllocations` is called with no `includeInactive`. Do not add the from-source / leadless BR flags so the three no-Lead writers “share a prepare.”

11. **Command parses Zod again.** The route already parsed `createReferralBookingSchema`. `runExistingCreateReferralBooking` parses `raw` a second time, then calls `begin`. This file assumes a typed object. Keep the command parse — `existingWrites` forwards `unknown`. Do not delete it “because the route already validated.”

12. **Leave sibling modules alone.** `deriveBookedLeadAgentAllocations`, `resolveAgentAllocations`, `resolveActiveMerchantName`, `upsertCustomerFromBookingContact`, `buildBookedLeadWarnings`, `populateBookedLead`, Sheet Sync, Leadless, Book This Lead, and `granotLifecycle/referralBooking.ts` stay where they are. This file orchestrates the public Referral write.

13. **Do not treat Granot Owner Referral as this story.** `createReferralBooking` in `granotLifecycle/referralBooking.ts` is a different origin: gated flags, accepted Observation / Decision, official fields (`primary_agent_id` / even-cent `officialBookingAllocations`), Record Link, case CAS, two Changes. It writes the same no-Lead shape and the same `referral_booking.create` intent. It does **not** call this file. Checked-in Referral flags stay false.

14. **`createReferralBooking` is no longer the HTTP path.** `POST /api/v1/referral-bookings` is `runExistingCreateReferralBooking` → `begin` / `complete`. The leftover public function remains because the barrel and `v1.service` still export it. Do not delete it “because the route moved.”

15. **Correction, delete, and cancel are not this file.** Public update of a Referral is 409 in `bookedLead.service.ts`. Public cancel is 409 in cancelled-lead. Public delete is allowed (no Lead to clear). Gated Granot Release may cancel a Referral — that split is already recorded (`public-v1-referral-cancel-vs-gated-release`). Do not pull those guards here.

## Testing

The **interface** is the test surface: `bookAReferral`, `begin` / `complete` for commands.

There is no `referralBooking.service.test.ts`. Zod coverage lives in `v1.validation.test.ts` (owner fields, optional phone, rejected `source` / `is_referral_booking`). `domainCommands.test.ts` only asserts that the `InTransaction` name still exists. Granot replica tests cover the other file. That is not enough for this story.

Add tests that name the operation. Do not add a test per helper.

**Book a Referral**
- Owner fields (Job, customer name, agent, binder, deposit, merchant, `local`) write a Booking with `is_referral_booking: true`, `source: "referral"`, and **no** `lead_ref` / `lead_model`.
- Same raw `job_no` already on a Booking → 409, **no** write, **no** sheet job.
- A differently normalized sibling Job (`P100` vs `100`, or case-only) is **not** refused by this 409 (lock the raw lookup). Unique-index failure remains the model’s job.
- Customer is upserted from the typed name / optional phone, not from a Lead.
- Agents come from `agent` / optional `split_agent` / `total_binder_amount`, not `agent_allocations[]` and not Granot agent ids. Same name as split → 400 from the derive helper (do not re-test the helper’s arithmetic).
- Merchant is resolved **before** the Mongo write. Agents are active-only.
- Deposit drives `over_2000` / `over_4000` (`>` 2000 / 4000).
- Sheet Sync intent `booked_lead` / `referral_booking.create` is remembered **before** commit and dispatched **after**. No `booking_chain`. No `booking.created` event.
- Command path stamps Florida time from `tx.now`. Leftover public path stamps `new Date()`.
- Command path: a thrown write rolls back the Booking and the customer upsert (session). Leftover public uses `runSheetSyncWrite` for that pair.
- `complete` populates customer + agents and returns `message: "Referral booking created."`

Do **not** add a test per helper (`refuseIfThisJobAlreadyExists`, `writeTheReferralBooking`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

`begin` / `complete` stay exported because canonical commands are a second real **adapter**, not a test leak.

Do not re-test Book This Lead’s ignore / rebook / insert, from-source override, Leadless source assignment / BR cases, `claimAvailableLeadForBooking`, or Granot `createReferralBooking` gates / Record Link / case CAS here.

## What I would not do

- A `ReferralBookingService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `save` or `persistSheetSyncIntent`.
- Moving this into a CRUD folder “for cleanliness.”
- Breaking the before-commit / after-commit **seam**. Sheets must not sit inside the Mongo write.
- Switching the Job 409 to `normalized_job_no` / digit-core equivalence so it “matches the unique index.”
- Teaching the leftover public path `tx.now` or a command transaction, or deleting it because the route already uses the command.
- Enqueueing `booking_chain`, emitting `booking.created`, or calling `mirrorBookingToLead`.
- Pulling Leadless, Book This Lead, employee claim, or Granot Owner Referral into this file.
- Writing a whole-folder `bookings` recommendation in this pass.
