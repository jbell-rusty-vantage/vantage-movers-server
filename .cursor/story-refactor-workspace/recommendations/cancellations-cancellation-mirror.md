# Keep The Lead And The Cancellation In Agreement — operational story

- Status: recommended
- Service: `cancellations` (Wave A, visited after this pass)
- Pass: 3 of this service — `cancellationMirror.service.ts`
- Remaining in this service: none
- Target: `src/services/cancellations/cancellationMirror.service.ts`
- Knowledge: `docs/knowledge/services/cancellation-mirror.md` (this file) and `docs/knowledge/services/cancelled-lead.md` (Lead mirror on create / unwind). Booking-delete take-off is `bookings-booking-mirror.md` (`clearBookingFromLead` also clears `cancelled`). This checkout’s `CONTEXT.md` does not define Cancellation terms — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: `cancelledLead.service.ts` (stamp once on public / command create; take-off on leftover queued delete, leftover legacy delete, and command delete). Barrel `cancellations/index.ts` re-exports both; `v1.service.ts` does **not**. Granot Release `cancelAVerifiedBooking` does **not** import this file. Tests: none.
- Seams callers need: stamp vs take-off (set `cancelled`, keep `booked`); `syncAfterClear` on take-off (queued caller enqueues; default still runs inline `syncSourceLead`); missing `leadId` is a no-op on take-off only
- Split later (only if the file outgrows one sitting): keep one file — this is already one sitting. Never `create.ts` / `update.ts` / `delete.ts`

Knowledge still titles this “stamp or clear `cancelled` on the source Form Lead or Call Lead.” The names agree: `mirrorCancellationToLead`, `clearCancellationFromLead`. Those are pointer mechanics. The owner question is: *this Form or Call still has a Booking. After we cancel that Booking, stamp the Lead cancelled too. When the Cancellation comes off, take cancelled off the Lead but leave booked. Booking delete is the other mirror — that take-off clears booked and cancelled together.*

## What this file actually does

Two operations, not “a CRUD service” and not Cancel This Booking:

1. **Tell the Lead it is cancelled** — the Cancellation already exists (or is about to). Load the Form or Call through `getLinkedLead`. Write `cancelled` with that Cancellation id. **Keep `booked`.** Save in the caller’s session. Do not touch deposit flags, Move Type, Source, or CPL.
2. **Take the Cancellation off the Lead** — Cancellation delete. Missing `leadId` → return (legacy / leadless rows with no Lead link). Otherwise load the same way, unset `cancelled`, **keep `booked`**, save. Inline `syncSourceLead` only when `syncAfterClear` is left on (legacy default). Every current caller passes `false` and enqueues or inlines its own sheet refresh.

Cancel This Booking, Cancel a verified Booking, correction, resolver fences, and Booking-delete cascade are not this file. Public / command create call the stamp **interface**. Unwind calls take-off. Release CAS-writes `cancelled` itself. Booking delete calls `takeTheBookingOffTheLead`.

## Organization

Keep one file. This is the screenplay for “the Lead and the Cancellation still agree.” Linked-Lead load and Sheet Sync already live in deeper **modules**. Do not pull those in. Do not invent a `CancellationMirrorService` class.

Do not split this 52-line file. Stamp vs take-off are two **seams** on one story, not two folders. Do not move the stamp into `cancelledLead.service.ts` “because only create calls it.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `mirrorCancellationToLead` | `tellTheLeadItIsCancelled` | public / command cancel need the Lead write in the same session |
| `clearCancellationFromLead` | `takeTheCancellationOffTheLead` | queued vs legacy `syncAfterClear`; missing `leadId` must no-op |

Keep the old names as one-line aliases until `cancelledLead.service.ts` and the cancellations barrel migrate. Do not make callers learn “mirror” as the domain language.

**No class for the workflow.** A class here would be a folder with a constructor. Neither export returns a handoff bag — both are void because the caller already holds the Cancellation and the sheet job. Do not invent `CancellationMirrorResult`. The optional `leadId` on take-off is the story: *if this Cancellation never named a Lead, leave the Lead alone.*

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// cancellationMirror.service.ts
// A Form or Call still has its Booking.
// After we cancel that Booking, stamp the Lead cancelled.
// When the Cancellation comes off, take cancelled off the Lead
// and leave booked. Booking delete is the other file —
// that take-off clears both. Granot Release writes cancelled
// itself and does not come through here.

// ── 1. Tell the Lead it is cancelled ──────────────────────

export async function tellTheLeadItIsCancelled(
  leadModel, leadId, cancellationId, session?,
)

async function loadTheLeadThisCancellationNames(leadModel, leadId, session)
  // getLinkedLead — sibling; 404 if missing
function stampCancelledAndKeepBooked(lead, cancellationId)
  // does not touch booked, deposit, local, source, cpl
async function saveTheLead(lead, session)

// ── 2. Take the Cancellation off the Lead ─────────────────

export async function takeTheCancellationOffTheLead(
  leadModel, leadId?, syncAfterClear = true, session?,
)

function thisCancellationNeverNamedALead(leadId)        // no-op
async function loadTheLeadWeAreUncancelling(leadModel, leadId, session)
function clearCancelledAndKeepBooked(lead)
async function saveTheClearedLead(lead, session)
async function syncTheLeadRowInlineWhenAsked(lead, leadModel, syncAfterClear)
  // default true (legacy); every current caller passes false
```

Read the stamp path out loud: *Load the Form or Call this Cancellation names. Write the Cancellation id onto `cancelled`. Leave `booked` alone — the Booking is still there. Save in the same session as the Cancellation write.*

Read the take-off path out loud: *If this Cancellation never named a Lead, stop. Otherwise load that Form or Call, take `cancelled` off, leave `booked`, and only refresh the Lead row inline when the caller did not already schedule sheets.*

That is the operation. `mirrorCancellationToLead` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Two ways to stamp `cancelled`.** `tellTheLeadItIsCancelled` loads a hydrated Lead and `save`s. `cancelAVerifiedBooking` is an atomic `updateOne` that also requires `domain_revision` and `booked === this Booking`. Public / command create call **this** helper. Release never does. Do not route Release through the helper so the names “agree,” or wrap this stamp in the same `updateOne` “for safety.” The public write already holds the Booking in the cancel transaction and does not claim the Lead by revision.

2. **Stamp does not check the Lead still names this Booking.** `getLinkedLead` returns whatever document that id is — Duplicate Lead, unmatched Call stub, already cancelled, or a Lead whose `booked` now points at someone else. The resolver’s Lead-id path already ran the bidirectional check; the Booking-id-only path never did. Do not add `lead.booked === this Booking` here so “both cancel paths agree.” That check belongs to the finder, or to Release’s CAS.

3. **Stamp overwrites an existing `cancelled`.** A second cancel of the same Lead replaces the pointer. There is no “already cancelled → 409” in this file. The Booking already-cancelled fence lives on the resolver / write. Do not 409 here because the Lead already has a Cancellation id.

4. **Take-off keeps `booked`.** That is the whole difference from `takeTheBookingOffTheLead`. Booking delete clears `booked`, `cancelled`, and the deposit flags. Cancellation-only unwind must leave the Lead booked. Do not call the booking helper from take-off “to share a clear,” or stop clearing `cancelled` on booking take-off so the two mirrors “own one field each.” See `bookings-booking-mirror.md`.

5. **`syncAfterClear` default is unused.** Knowledge Role says this module “Does not … Sheet Sync directly.” The default `true` calls `syncSourceLead` after save. Every current caller (leftover queued, leftover legacy, command delete) passes `false` and does its own `booking_chain` / `source_lead` / inline `syncBookingAndSource`. Rename so the default is visible. Do **not** flip it to `false` “because queued is the real path,” or delete the inline branch so knowledge “matches the Role line.”

6. **Missing `leadId` is a no-op; missing Lead is a throw.** Take-off returns when `leadId` is empty (legacy / leadless / unresolved employee Booking). `getLinkedLead` still 404s `Linked source lead not found` when the id is present and the document is gone. Callers also guard `if (leadModel && leadId)` before they call. Keep both fences. Do not teach take-off to swallow a 404 so “unwind always succeeds.”

7. **Stamp requires a Lead id.** There is no missing-id no-op on stamp. Callers already skip the helper when `lead_ref` / `lead_model` are absent (Referral / leadless). Do not add the take-off no-op to stamp “for symmetry.”

8. **The barrel exports this for future reuse. Nothing outside the folder imports it.** `v1.service.ts` re-exports only leftover cancel / correct / list / remove. Booking-delete cascade does not call this file. Do not invent a second **adapter** so the JSDoc’s “future callers” come true.

9. **Leave sibling modules alone.** `getLinkedLead`, `syncSourceLead`, `writeTheCancellationAndMirrorTheChain`, `cancelAVerifiedBooking`, and `takeTheBookingOffTheLead` stay where they are. This file stamps or clears one field. The verified write does **not** call this helper. Do not pull Release’s CAS, Entity Changes, or Cancellation Chain jobs in.

10. **Do not treat Booking-delete cascade as this story.** `bookedLead.service.ts` may erase a linked Cancellation when the Booking is removed with `cascade`. That path clears the Lead through `clearBookingFromLead`, not here.

11. **Correction never calls this file.** Refund / reason / notes patches do not re-stamp or clear the Lead. Do not start mirroring on correct so “the pointer stays fresh.”

12. **Session is the cancel transaction.** Stamp and take-off both accept the caller’s session. Do not drop the session so “a pointer write does not need a txn.”

## Testing

The **interface** is the test surface: `tellTheLeadItIsCancelled`, `takeTheCancellationOffTheLead`.

There is no `cancellationMirror.test.ts`. `cancellationResolver.test.ts` does not lock the pointer. `domainCommands.test.ts` does not grep these names. That is not enough for a story this short and this easy to merge with the booking mirror.

Add tests that name the operation. Do not add a test per helper.

**Tell the Lead it is cancelled**
- Writes `cancelled` to the Cancellation id. Leaves `booked`, `over_2000`, `over_4000`, `local`, and Source Assignment untouched.
- Missing Lead → `NotFoundError` `Linked source lead not found` (do not re-test `getLinkedLead`’s Duplicate / unmatched return).
- Duplicate Lead / unmatched Call stub still get `cancelled` when the caller passed that id. Eligibility is the caller.
- A Lead whose `booked` already names a different Booking still gets `cancelled` (this file does not re-check identity).
- Save uses the caller’s session.

**Take the Cancellation off the Lead**
- Clears `cancelled`. Leaves `booked` and deposit flags.
- Missing / empty `leadId` → no load, no save, no `syncSourceLead`.
- Present `leadId` but Lead gone → 404, not a no-op.
- `syncAfterClear: false` → no `syncSourceLead`.
- Default / `true` → inline `syncSourceLead` after save.

Do **not** add a test per helper (`stampCancelledAndKeepBooked`, `thisCancellationNeverNamedALead`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not re-test Cancel This Booking’s snapshot / Referral 409 / employee-case dismiss, Release CAS / `GRANOT_IDENTITY_CONFLICT` / `test_fail_after`, resolver match ladders, or `takeTheBookingOffTheLead` clearing both flags.

## What I would not do

- A `CancellationMirrorService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `save` or `getLinkedLead`.
- Moving this into a CRUD folder, or into `bookings/` “because the other mirror lives there.”
- Routing Granot Release through this helper, or wrapping stamp in `updateOne` so it “matches Release.”
- Teaching take-off to clear `booked`, or teaching booking take-off to call this helper.
- Flipping `syncAfterClear` to default `false`, or deleting the inline `syncSourceLead` so the knowledge Role line “wins.”
- Swallowing a missing-Lead 404 on take-off, or adding a missing-id no-op to stamp.
- Pulling Cancel This Booking, the resolver, Booking-delete cascade, or Release policy into this file.
- Writing a whole-folder `cancellations` recommendation in this pass.
