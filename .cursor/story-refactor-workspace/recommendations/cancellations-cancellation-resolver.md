# Find The Booking This Cancellation Names — operational story

- Status: recommended
- Service: `cancellations` (Wave A, in-progress)
- Pass: 2 of this service — `cancellationResolver.ts`
- Remaining in this service: `cancellationMirror.service.ts`
- Target: `src/services/cancellations/cancellationResolver.ts`
- Knowledge: `docs/knowledge/services/cancelled-lead.md` (Resolver table + `getBookedLeadForCancellation` fences). Id-only Lead load is `leads-source-lead-lookup.md`. Public vs gated Release is `cancellations-cancelled-lead.md`. This checkout’s `CONTEXT.md` does not define Cancellation / Referral Booking — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: `cancelledLead.service.ts` (`writeTheCancellationAndMirrorTheChain` / today’s `persistCancelledLeadCreateInTransaction` — leftover public and canonical `createCancellation` both enter here), `cancellations/index.ts` barrel (resolver is **not** re-exported by `v1.service.ts`). Tests call `getBookedLeadForCancellation` directly. Granot Release `cancelAVerifiedBooking` does **not** import this file.
- Seams callers need: named Booking vs Lead-id-only vs both-must-agree; `allowLeadless` is a caller flag, not provenance; customer is populated for the write’s snapshot
- Split later (only if the file outgrows one sitting): keep one file — this is already one sitting. Never `create.ts` / `update.ts` / `delete.ts`

Knowledge still titles this “resolve target booking + enforce lead/booking match invariants.” The names agree: `resolveBookedLeadForCancellation`, `getBookedLeadForCancellation`. Those are lookup mechanics. The owner question is: *the owner (or Best Relocation import) pointed at a Booking, or at the Lead that Booking hangs off. Which Booking do they mean? And is this public cancel path allowed to cancel it?*

## What this file actually does

Two operations, not “a resolver helper” and not Cancel This Booking:

1. **Find the Booking this cancellation names** — `booked_lead` only: load that Booking. `lead_id` only: name which Form or Call it is, require `lead.booked`, load **that** Booking, then require the Booking still names that Lead. Both: same Lead path, then 409 if the sent Booking id is a different document. Neither: 400.
2. **Load a Booking we may cancel on this public path** — every find goes through this. Missing → 404. Already cancelled → 409. Referral → 409. Unauthorized leadless → 409. A Booking that is not leadless and still lacks `lead_ref` / `lead_model` → 409. Leadless is allowed only when the caller passed `allowLeadless: true`. Populate `customer` so the write can snapshot `full_name`.

Cancel This Booking (snapshot, stamp, sheets), Cancel a verified Booking (Granot Release CAS), correction, unwind, and the Lead mirror are not this file. They call these **interfaces**, or they never ask “which Booking.”

## Organization

Keep one file. This is the screenplay for “which Booking does this cancel request mean, and may this path cancel it.” Source-lead id lookup, Best Relocation import fence, snapshot, and the write already live in deeper **modules**. Do not pull those in. Do not invent a `CancellationResolverService` class.

Do not split this 90-line file. Find vs load-and-fence are two **seams** on one story, not two folders. Do not move the load into `cancelledLead.service.ts` “because only create calls it.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `resolveBookedLeadForCancellation` | `findTheBookingThisCancellationNames` | leftover public cancel and canonical `createCancellation` both need the same Booking before they write |
| `getBookedLeadForCancellation` | `loadABookingWeMayCancelOnThisPath` | the find always loads here; the test locks authorized leadless on this **seam** |

Keep the old names as one-line aliases until `cancelledLead.service.ts` and the cancellations barrel migrate. Do not make callers learn `resolve` / `get` as the domain language.

**No class for the workflow.** A class here would be a folder with a constructor. The one type that *does* earn a name is the handoff the write already treats as “the Booking plus its customer”:

```ts
type BookingWeMayCancelOnThisPath = mongoose.HydratedDocument<BookedLeadDocument>
```

That is today’s return: *here is a live, not-yet-cancelled Booking this public path is allowed to cancel, with `customer` populated for the snapshot.* Referral, unauthorized leadless, and a Booking missing Lead refs never become this type.

The caller option is not a second type. Keep `{ allowLeadless?: boolean }`. Do not invent `PublicCancelPolicy`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// cancellationResolver.ts
// The owner pointed at a Booking, or at the Lead that Booking hangs off.
// Find that Booking.
// Refuse Referral, unauthorized leadless, or a Booking that
// is not leadless and still has no Lead.
// Best Relocation import may cancel leadless when the caller
// says so. Granot Release does not come through this file.
// Writing the Cancellation is cancelledLead.

// ── 1. Find the Booking this cancellation names ───────────

export async function findTheBookingThisCancellationNames(
  input, session, { allowLeadless } = {},
)

function theyNamedTheBookingOnly(input)                 // booked_lead && !lead_id
function theyNamedNoBookingAndNoLead(input)             // 400
async function nameTheLeadTheyPointedAt(leadId, session)
  // resolveSourceLeadById — sibling; 404 / two-collection 409
function theLeadIsNotBooked(lead)                       // 409 Source lead is not booked
function theyNamedBothAndTheIdsDisagree(sentId, booking) // 409 booked_lead does not match…
function theBookingNoLongerNamesThisLead(booking, lead, leadModel)
  // 409 Booked lead does not match the source lead

// ── 2. Load a Booking we may cancel on this public path ───

export async function loadABookingWeMayCancelOnThisPath(
  bookedLeadId, session, { allowLeadless } = {},
)

async function loadTheBookingAndItsCustomer(bookedLeadId, session)
  // BookedLead.findById + populate("customer")
function theBookingIsMissing(booking)                   // 404
function theBookingIsAlreadyCancelled(booking)          // 409
function thisIsAReferral(booking)                       // 409 Standalone… — even if allowLeadless
function thisIsUnauthorizedLeadless(booking, allowLeadless)
function thisBookingIsNotLeadlessAndHasNoLead(booking)  // missing lead_ref or lead_model
```

Read the Lead-id path out loud: *Name which Form or Call that id is. If it is not booked, stop. Load the Booking that Lead points at, populate the customer, and refuse it if it is already cancelled, a Referral, unauthorized leadless, or a non-leadless Booking with no Lead. If they also sent a Booking id, it must be this document. Then the Booking must still name that Lead.*

Read the Booking-id-only path out loud: *Load that Booking and its customer. Apply the same public-path fences. Do not look up a Lead. Do not check that a Lead still names this Booking.*

That is the operation. `resolveBookedLeadForCancellation` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Three fences, one sentence.** Referral, unauthorized leadless, and “not leadless and missing Lead refs” all throw `Standalone booking cancellation is not supported yet`. The write then throws `Referral booking cancellation is not supported yet` when the Booking is not leadless and still lacks Lead refs. A Referral with `is_referral_booking` never reaches that second sentence. Do not silently merge the copy, and do not split the first sentence into three HTTP messages in this rename. Record the three reasons as child names.

2. **`allowLeadless` never unlocks Referral.** The Referral clause is first in the `||`. Best Relocation import can cancel leadless. It cannot cancel a Referral through this file. Do not teach `allowLeadless` to skip Referral so “import owns standalone.”

3. **`allowLeadless` is a caller flag, not provenance.** The leftover write sets it from `input.ingestion_source === "best_relocation_sheet"`. Canonical `createCancellation` stamps that field from `provenance.origin === "external_sheet_ingestion"` and drops the body value. Ordinary `POST /cancelled-leads` admin provenance never authorizes leadless via the body. This file only sees the boolean. Do not read `ingestion_source` here so “the resolver owns the import rule.”

4. **Booking-id-only never checks the Lead.** `booked_lead` without `lead_id` loads and fences. It does not require `lead.booked`, and it does not run `theBookingNoLongerNamesThisLead`. A Booking whose Lead was re-pointed still cancels if they only sent the Booking id. Do not add the bidirectional check to this branch so “both paths agree.”

5. **Lead-id path is bidirectional after load.** First the Lead must have `booked`. Then the loaded Booking’s `lead_model` / `lead_ref` must still be that Lead. A Lead that names Booking A while Booking A names Lead B is 409. Do not drop the second check because “we already followed `lead.booked`.”

6. **Zod already requires `booked_lead` or `lead_id`.** The resolver’s 400 is a second fence for callers that skip the schema (tests, leftover internal). Keep it. Do not delete the 400 “because Zod already said that.”

7. **Customer populate is for the snapshot, not the fence.** The resolve decision does not read `customer`. The write snapshots `customer.full_name` only (not `booking.customer_name`). A missing customer still returns the Booking. Do not 404 when populate is empty, and do not move populate into the write so this file is “pure identity.”

8. **`getBookedLeadForCancellation` is not a free load.** `getLinkedLead` returns Duplicate / booked / cancelled / unmatched stubs and lets the caller decide. This load already refuses cancelled, Referral, unauthorized leadless, and missing Lead refs. Do not teach it the Lead-lookup “return everything” rule so the two `get`s “agree.”

9. **The barrel exports this for future reuse. Nothing outside the folder imports it.** `v1.service.ts` re-exports only leftover cancel / correct / list / remove. Booking-delete cascade does not call this file. Do not invent a second **adapter** so the JSDoc’s “future callers” come true.

10. **Leave sibling modules alone.** `resolveSourceLeadById`, `writeTheCancellationAndMirrorTheChain`, `cancelAVerifiedBooking`, `requireBestRelocationImportSource`, and the Lead mirror stay where they are. This file finds the Booking. The write still repeats the “not leadless and no Lead refs” fence with different copy. Do not delete that write-side 409 so one file “owns Referral.”

11. **Do not merge public Referral 409 into gated Release.** Knowledge names this `public-v1-referral-cancel-vs-gated-release`. `cancelAVerifiedBooking` may cancel a Referral with no Lead mirror and does not call this file. Checked-in Release flags stay false.

12. **Session is the cancel transaction.** Leftover public and the command both pass `tx.session`. Do not drop the session so “a lookup does not need a txn.”

## Testing

The **interface** is the test surface: `findTheBookingThisCancellationNames`, `loadABookingWeMayCancelOnThisPath`.

Today’s `cancellationResolver.test.ts` only stubs `findById` for authorized leadless load, plus a CancelledLead schema test that this file does not own. That is not enough for a story this long.

Add tests that name the operation. Do not add a test per helper.

**Find the Booking this cancellation names**
- `booked_lead` only → that Booking (customer populated). Does **not** load a Lead.
- `lead_id` only + `lead.booked` → that Booking. `lead_model` / `lead_ref` must still name that Lead.
- Both, same Booking → that Booking.
- Both, different Booking ids → 409 `booked_lead does not match the source lead booking`.
- Neither → 400 `Either booked_lead or lead_id must be provided`.
- Source Lead not booked → 409 `Source lead is not booked`.
- Lead names this Booking, Booking names a different Lead → 409 `Booked lead does not match the source lead`.

**Load a Booking we may cancel on this public path**
- Missing id → 404 `Booked lead not found`.
- `booking.cancelled` set → 409 `Booked lead is already cancelled`.
- Referral → 409 `Standalone…` even when `allowLeadless: true`.
- Leadless + `allowLeadless !== true` → 409 `Standalone…`.
- Leadless + `allowLeadless: true` → returns that Booking (keep the existing test; rename it to the story).
- Not leadless, not Referral, missing `lead_ref` or `lead_model` → 409 `Standalone…`.
- Customer is populated when present. Missing customer still returns the Booking.

Do **not** add a test per helper (`theyNamedTheBookingOnly`, `thisIsAReferral`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not re-test `resolveSourceLeadById` two-collection collision, Best Relocation `requiredSourceConnectionKey`, snapshot `full_name` vs `booking.customer_name`, leftover vs command `ingestion_source`, or Release CAS. Those belong to the sibling write and the Lead-lookup **module**.

Move the CancelledLead-validates-without-Lead-metadata test out of this file when an implementer is next in here. It is a schema fact, not this **interface**.

## What I would not do

- A `CancellationResolverService` class with `resolve` / `get`.
- Thirty two-line functions that only wrap `findById` or `resolveSourceLeadById`.
- Moving this into a CRUD folder, or into `leads/` “because it loads a Lead.”
- Merging the three `Standalone…` reasons into the write’s `Referral…` sentence, or deleting the write-side 409 so one file owns the fence.
- Teaching `allowLeadless` to cancel Referral, or reading `ingestion_source` / provenance inside this file.
- Adding the bidirectional Lead check to the Booking-id-only path so both branches “agree.”
- Teaching this load to return cancelled / Referral / leadless like `getLinkedLead`.
- Routing Granot Release through this file so one cancel path “owns identity.”
- Pulling snapshot, Best Relocation connection-key, Sheet Sync, or the Lead mirror into this file.
- Writing a whole-folder `cancellations` recommendation in this pass.
