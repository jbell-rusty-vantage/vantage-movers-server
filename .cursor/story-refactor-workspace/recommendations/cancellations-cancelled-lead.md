# Cancel This Booking — operational story

- Status: recommended
- Service: `cancellations` (Wave A, in-progress)
- Pass: 1 of this service — `cancelledLead.service.ts`
- Remaining in this service: `cancellationResolver.ts`, `cancellationMirror.service.ts`
- Target: `src/services/cancellations/cancelledLead.service.ts`
- Knowledge: `docs/knowledge/services/cancelled-lead.md` (this file is the write; the Service also covers the resolver and the Lead mirror). This checkout’s `CONTEXT.md` does not define Cancellation terms — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: `domainCommands/existingWrites.ts` (`createCancellation` begin / Sheet Sync complete, `updateCancelledLead`, `deleteCancelledLead`), `granotLifecycle/releaseOwnerCommands.ts` (`confirmCancellation` → the verified CAS write only), `cancellations/index.ts` → `v1.service.ts` (leftover public exports), `routes/v1.routes.ts` (`findAllCancelledLeads`; mutating `/cancelled-leads` already goes through the command adapters), `domainCommands.test.ts` (greps the `InTransaction` / `persist` names)
- Seams callers need: leftover public `cancel` vs canonical `begin` / `complete`; verified Granot Release CAS is a different write; correction may no-op inside a command; removal returns a `finalize`
- Split later (only if the file outgrows one sitting): `cancelThisBooking.ts`, `cancelAVerifiedBooking.ts`, `correctThisCancellation.ts`, `removeThisCancellation.ts` — never `create.ts` / `update.ts` / `delete.ts`

Knowledge still titles this “CRUD: create, update, delete, list.” The names agree: `createCancelledLeadInTransaction`, `persistCancelledLeadCreateInTransaction`, `createCancellationForVerifiedBookingInTransaction`. Those are executor mechanics. The owner question is: *this Booking is already in Mongo. Cancel it, snapshot what the sheets will need, tell the Lead, tell the sheets — or correct the refund later, or take the Cancellation off. If Granot Release already verified the Booking, claim it and write the official Cancellation without resolving from a client id.*

## What this file actually does

Five operations, not “a CRUD service”:

1. **Cancel this Booking** — the owner (or Best Relocation import) points at a Booking, or at the Lead that Booking hangs off. Resolve that Booking. Snapshot customer / job / agent / book-date / source so the Cancellation row still works after the Booking is later mutated or deleted. Write the Cancellation, stamp `booking.cancelled`, mirror `cancelled` onto the linked Lead when one exists, dismiss a pending employee `BookingLeadReconciliationCase`, and remember Cancellation Chain Sheet Sync. After commit, project the chain. The leftover public function also tells observability `cancellation.created`; the command path does not.
2. **Cancel a verified Booking** — Granot Release already revalidated the case, the link, and the Booking identity. This primitive only CAS-claims the Booking (`domain_revision` + `normalized_job_no` + unset `cancelled`), writes the official Cancellation, and optionally CAS-mirrors the Lead. The caller owns policy, Entity Changes, case resolution, and the outbox. Referral may cancel here with no Lead mirror. Checked-in Release flags stay false.
3. **Correct this Cancellation** — refund, reason, notes, dates, who cancelled. Does not re-snapshot the Booking or touch Lead refs. Canonical correction may no-op when no cancelled fields changed; the leftover public function always writes.
4. **List recent Cancellations** — last 200, newest first.
5. **Remove this Cancellation** — unwind `booking.cancelled`, clear the Lead’s `cancelled`, tombstone (queued) or delete the sheet row inline (legacy), erase the Cancellation last on the leftover path so upstream wipes settle even if the final delete fails.

Finding the Booking (resolver) and stamping the Lead (mirror) are sibling files. Booking-delete cascade that removes a Cancellation is `bookedLead.service.ts`, not this file.

## Organization

Keep one file. This is the screenplay. Booking resolve, Lead load, Best Relocation import fence, primary-agent snapshot, Lead ↔ Cancellation mirror, employee-case dismiss, and Sheet Sync already live in deeper **modules**. Do not pull those in. Do not invent a `CancelledLeadService` class.

If it later outgrows one sitting, split by **story**, not CRUD. Cancel this Booking and Cancel a verified Booking may become sibling story files because they are different owner moves (resolve-and-snapshot vs CAS claim), not because one is create.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `createCancelledLead` | `cancelThisBooking` | leftover public path: run the whole story + owner event |
| `createCancelledLeadInTransaction` | `beginCancellingThisBooking` | canonical `createCancellation` needs the write before commit |
| `persistCancelledLeadCreateInTransaction` | `writeTheCancellationAndMirrorTheChain` | shared write: resolve, snapshot, stamp Booking, optional Lead, dismiss employee case, sheet intent |
| leftover after-commit (today inlined) | `completeCancellingThisBooking` | Cancellation Chain + leftover `cancellation.created` |
| `createCancellationForVerifiedBookingInTransaction` | `cancelAVerifiedBooking` | Granot Release CAS claim; caller owns outbox / case / changes |
| `updateCancelledLead` | `correctThisCancellation` | leftover public path (always writes) |
| `updateCancelledLeadInTransaction` | `correctThisCancellationInTransaction` | same correction inside a command (may no-op) |
| `findAllCancelledLeads` | `listRecentCancellations` | last 200 |
| `deleteCancelledLead` | `removeThisCancellation` | leftover standalone unwind |
| `deleteCancelledLeadInTransaction` | `beginCancellationRemoval` | command delete + returned `finalize` |

Keep the old names as one-line aliases until `existingWrites`, `releaseOwnerCommands`, `v1.service`, and the leftover barrel migrate. Do not make callers learn `InTransaction` as the domain language. `domainCommands.test.ts` greps this file for the `InTransaction` / `persist` strings — leave those aliases until that assertion moves.

**No class for the workflow.** A class here would be a folder with a constructor. The one type that *does* earn a name is the pending cancel bag:

```ts
type CancellingThisBookingInProgress = {
  cancellation: HydratedDocument<CancelledLeadDocument>
  job: FullSheetSyncJob
  booking: HydratedDocument<BookedLeadDocument>
}
```

That is the handoff from “the Cancellation is saved, the Booking already says cancelled, the Lead already says cancelled” to “tell the sheets (and, on the leftover path, the owner).”

The verified write already returns `{ cancellation, booking_after, lead_before, lead_after }`. Keep that shape. It is the handoff the Release command needs to persist Entity Changes. Do not wrap it in a class.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// cancelledLead.service.ts
// A Booking already lives in Mongo.
// The owner cancels it, later corrects the refund,
// or takes the Cancellation off.
// Finding that Booking (resolver) and stamping the Lead (mirror)
// are other files. Granot Release uses a second write that
// claims a Booking already verified by the case.

// ── 1. Cancel this Booking ────────────────────────────────

export async function cancelThisBooking(input, options)
export async function beginCancellingThisBooking(input, options, tx)
export async function completeCancellingThisBooking(pending)

async function writeTheCancellationAndMirrorTheChain(input, options, tx)
async function findTheBookingWeAreCancelling(input, session)
function refuseUnlessBestRelocationOwnsThisImport(booking, options, session)
function refuseAReferralOnThePublicPath(booking)          // 409; Release is the other write
function snapshotWhatTheCancellationMustRemember(booking, input, timestamp)
async function stampTheBookingCancelled(booking, cancellation, session)
async function tellTheLeadItIsCancelled(booking, cancellation, session)  // sibling mirror
async function dismissThePendingEmployeeCase(booking, input, session)
async function rememberCancellationChainSheetSync(job, session)

async function projectTheCancellationChain(job)
async function tellTheOwnerTheBookingWasCancelled(cancellation, booking) // leftover public only

// ── 2. Cancel a verified Booking ──────────────────────────

export async function cancelAVerifiedBooking(input, tx)

async function claimTheBookingIfTheRevisionStillMatches(booking, expected, job, cancellationId, session)
function snapshotFromTheVerifiedBooking(booking, official, now)  // cancel_date = UTC midnight; customer_name may fall back
async function writeTheOfficialCancellation(snapshot, cancellationId, session)
async function claimTheLeadIfItStillNamesThisBooking(booking, cancellationId, session)  // GRANOT_IDENTITY_CONFLICT
function failAfterTheInjectedBeat(input)                   // Unit 27 test_fail_after; keep

// ── 3. Correct this Cancellation ──────────────────────────

export async function correctThisCancellation(id, patch)
export async function correctThisCancellationInTransaction(id, patch, tx)

async function loadTheLiveCancellation(id, session)
function applyTheAllowedPatch(cancellation, patch)         // timestamp, cancel_date, refund, reason, notes, cancelled_by
function nothingOnTheCancellationChanged(before, after)    // CANCELLED_LEAD_CHANGE_PATHS; command only
async function persistTheCorrectionAndRememberSheets(cancellation, tx)

// ── 4. Lookup ─────────────────────────────────────────────

export async function listRecentCancellations()

// ── 5. Remove this Cancellation ───────────────────────────

export async function removeThisCancellation(id)
export async function beginCancellationRemoval(id, tx)

async function loadTheCancellationWeAreRemoving(id, session)
async function unstampTheBooking(cancellation, session)
async function clearTheLeadSoItIsNoLongerCancelled(leadModel, leadId, session)  // syncAfterClear: false
async function tombstoneTheCancellationSheets(cancellation, session)            // queued
async function rememberTheSurvivingBookingOrLeadSheets(booking, lead, session)
async function eraseTheCancellationFromSheetsInline(cancellation)               // legacy
async function eraseTheCancellation(cancellation, session)
```

Read the cancel path out loud: *Find the Booking from the id the owner sent, or from the Lead that Booking hangs off. Fence Best Relocation import. Refuse a Referral on this path. Snapshot the customer, the Job, the agent, and the source. Write the Cancellation. Stamp the Booking cancelled. Tell the Lead it is cancelled. Dismiss a pending employee case if one is sitting on that Booking. Remember Cancellation Chain Sheet Sync. After commit: project the chain, then — on the leftover public path — tell the owner the Booking was cancelled.*

That is the operation. `persistCancelledLeadCreateInTransaction` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Two remove implementations.** `removeThisCancellation` and `beginCancellationRemoval` copy the unset-Booking, clear-Lead (`syncAfterClear: false`), queued-vs-legacy sheet, and erase-last rules. One story, two **adapters** (leftover standalone vs command). Shared beats: load, unstamp Booking, clear Lead, tombstone or inline erase, remember surviving booking/lead sheets, erase Cancellation. Only the transaction / `finalize` wrapper and the EntityChange mutations differ.

2. **`createCancelledLeadInTransaction` is a pass-through.** It only calls `persistCancelledLeadCreateInTransaction`. Delete the extra name after the aliases settle. `beginCancellingThisBooking` should be the command **adapter**; the write already is `writeTheCancellationAndMirrorTheChain`.

3. **`persistCancelledLeadCreateInTransaction` is not a persist.** It resolves, fences Best Relocation, refuses Referral, snapshots, writes, stamps the Booking, mirrors the Lead, dismisses an employee case, and remembers Sheet Sync. The name should say that.

4. **Public correction always writes; the command may no-op.** Knowledge already records this. `correctThisCancellationInTransaction` returns early when `CANCELLED_LEAD_CHANGE_PATHS` is empty — no save, no sheet job. `correctThisCancellation` still `findByIdAndUpdate`s and enqueues `cancelled_lead.update` even when nothing material changed. Rename both so the gap is visible. Do **not** silently teach the leftover public function the no-op. Routes already use the command.

5. **Leftover cancel tells the owner; the command does not.** `cancelThisBooking` records `cancellation.created` after Sheet Sync. `createCancellation` → `begin` / `complete` only finalizes sheets. Knowledge’s operational-events table still names the leftover event as “Create.” Rename so the gap is visible. Do not add the event to the command, or drop it from the leftover path, in this rename.

6. **Two 409 sentences for the same public fence.** The resolver throws `Standalone booking cancellation is not supported yet` for Referral, unauthorized leadless, or a Booking missing Lead refs. The write then throws `Referral booking cancellation is not supported yet` when the Booking is not leadless and still lacks Lead refs. Do not silently merge the copy. The resolver is the next module.

7. **Customer name is snapshotted differently on the two writes.** Public cancel uses populated `customer.full_name` only. The verified write may fall back to `booking.customer_name` and parses official `cancel_date` as UTC midnight. Knowledge already records this. Do not “fix” the public snapshot to match Release, or the other way around.

8. **Best Relocation `allowLeadless` is provenance on the command and a body flag on the leftover path.** Leftover `cancelThisBooking` honors `input.ingestion_source === "best_relocation_sheet"`. `runExistingCreateCancellation` stamps that flag from `provenance.origin === "external_sheet_ingestion"` and drops the body value. `POST /api/v1/cancelled-leads` builds ordinary admin provenance, so a body flag on that route never authorizes leadless cancel. Do not silently teach the leftover path the provenance rule.

9. **Leave sibling modules alone.** `resolveBookedLeadForCancellation`, `getBookedLeadForCancellation`, `mirrorCancellationToLead`, and `clearCancellationFromLead` stay where they are. This file orchestrates them. The verified write does **not** call the mirror helper — it CAS-updates the Lead itself. Do not route Release through the helper so the names “agree.”

10. **Do not merge public Referral 409 into gated Release.** Knowledge names this `public-v1-referral-cancel-vs-gated-release`. `cancelAVerifiedBooking` may cancel a Referral with no Lead mirror. Checked-in Release flags stay false. Public cancel stays 409.

11. **Do not silently drop legacy Sheet Sync on remove.** Queued mode tombstones + `finalizeSheetSyncDelete`. Legacy deletes the Cancelled Deals row first (`deleteCancelledLeadFromSheets`), then Mongo, then inline `syncBookingAndSource` / `syncSourceLeadById`. Both **adapters** still branch. Keep the branch. Leftover remove erases the Cancellation last so sheet wipes settle if the final delete fails — keep that order.

12. **`createCancelledLead` is no longer the HTTP path.** `POST /api/v1/cancelled-leads` is `createCancellation` → `begin` / `complete`. The leftover public function remains because the barrel still exports the whole story (and the owner event). Do not delete it “because the route moved.” Knowledge’s HTTP table still names the leftover function.

13. **`test_fail_after` is a Unit 27 seam.** The verified write can throw after the Booking claim, after the Cancellation insert, or after the Lead claim. `releaseOwnerCommands` maps those plus its own later beats. Do not remove the hooks so the story “reads cleaner.”

14. **Booking-delete cascade is not this story.** `bookedLead.service.ts` may erase a linked Cancellation when the Booking is removed with `cascade`. That path does not call `removeThisCancellation`. Do not pull it in.

## Testing

The **interface** is the test surface: `cancelThisBooking`, `begin` / `complete` for commands, `cancelAVerifiedBooking`, `correctThisCancellation` / `correctThisCancellationInTransaction`, `removeThisCancellation`.

There is no `cancelledLead.service.test.ts`. `cancellationResolver.test.ts` locks authorized leadless resolve and a Cancellation that validates without Lead metadata. `domainCommands.test.ts` only asserts that the `InTransaction` / `persist` names still exist. That is not enough for a story this long.

Add tests that name the operation. Do not add a test per helper.

**Cancel this Booking**
- A lead-attached Booking is saved as a Cancellation; the Booking and Lead are stamped cancelled in the same write; Cancellation Chain Sheet Sync is remembered **before** commit and dispatched **after**.
- `booked_lead` only, `lead_id` only, and both-when-they-agree all cancel the same Booking (resolver). Both-when-they-disagree → 409.
- Source Lead not booked → 409. Booking already cancelled → 409.
- Referral → 409 on this path (`Standalone…` at resolve and/or `Referral…` at write). Do not lock only one sentence.
- Ordinary leadless / missing Lead refs → 409. Best Relocation import (`allowLeadless`) may cancel leadless.
- Best Relocation `requiredSourceConnectionKey`: lead-attached must be `best_relocation_leads`; leadless must have a matching `createLeadlessBooking` execution or 400.
- Pending `BookingLeadReconciliationCase` on that Booking is dismissed with `booking_cancelled`.
- Snapshot: `customer_name` is populated `customer.full_name` only (not `booking.customer_name`). `agent` is `primaryAgentName`. `cancel_date` defaults to `timestamp`.
- Leftover public path emits `cancellation.created` after sheets. Command path does **not**. Lock that until a separate change.
- Command path: body `ingestion_source` is overwritten from provenance. Leftover path honors the body flag.

**Cancel a verified Booking**
- Matching `domain_revision` + `normalized_job_no` + unset `cancelled` claims the Booking and inserts the official Cancellation.
- Stale revision or already cancelled → `DOMAIN_REVISION_CONFLICT`.
- Lead present but `booked` no longer names this Booking → `GRANOT_IDENTITY_CONFLICT`.
- No Lead (Referral) → Cancellation + Booking only; no Lead write.
- `cancel_date` is official `YYYY-MM-DD` at UTC midnight. `customer_name` may fall back to `booking.customer_name`.
- Does **not** persist Sheet Sync, dismiss an employee case, or record `cancellation.created`. The Release command owns those.
- `test_fail_after` still throws after booking / cancellation / lead.

**Correct this Cancellation**
- Missing id → 404.
- Patchable: `timestamp`, `cancel_date`, `refund_amount`, `reason`, `notes`, `cancelled_by`. Booking and Lead refs are untouched.
- Command path: no `CANCELLED_LEAD_CHANGE_PATHS` diffs → no save, no sheet job.
- Leftover public path: still writes + `cancelled_lead.update` when fields are unchanged. Lock that until a separate change.

**Lookup / removal**
- List is last 200, newest first.
- Missing id → 404.
- Queued mode: unset Booking, clear Lead (`syncAfterClear: false`), tombstone `delete_cancelled_lead`, enqueue `booking_chain` when Booking + Lead survive else `source_lead`, erase Cancellation, `finalizeSheetSyncDelete`.
- Legacy: sheet row first, then unset / clear / inline sync, Cancellation last.
- A Cancellation without Lead metadata still unwinds (unresolved employee Booking). Missing `leadId` is a no-op on the Lead clear.

Do **not** add a test per helper (`snapshotWhatTheCancellationMustRemember`, `refuseAReferralOnThePublicPath`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

`begin` / `complete` stay exported because canonical commands are a second real **adapter**, not a test leak. `cancelAVerifiedBooking` stays exported because Granot Release is a third real **adapter**.

Do not re-test `resolveBookedLeadForCancellation` match ladders, `mirrorCancellationToLead` save semantics, or Release case / policy / already-satisfied here.

## What I would not do

- A `CancelledLeadService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `save` or `mirrorCancellationToLead`.
- Moving this into a CRUD folder “for cleanliness.”
- Breaking the before-commit / after-commit **seam**. Sheets and the leftover owner event must not sit inside the Mongo write.
- Teaching leftover `correctThisCancellation` the command no-op, or teaching the command to always write, so the two **adapters** “agree.”
- Routing the verified write through the public resolver or the Lead-mirror helper so one cancel path “owns everything.”
- Merging public Referral 409 into gated Release, or enabling a Release flag in this rename.
- Dropping `test_fail_after`, or dropping the leftover `cancellation.created` event so knowledge “matches the command.”
- Pulling the resolver, the mirror, Booking-delete cascade, or `confirmCancellation` policy into this file.
- Writing a whole-folder `cancellations` recommendation in this pass.
