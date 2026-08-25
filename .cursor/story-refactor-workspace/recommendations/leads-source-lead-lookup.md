# Source Lead Pointer — operational story

- Status: recommended
- Service: `leads` (Wave A, in-progress)
- Pass: 10 of this service — `sourceLeadLookup.service.ts`
- Remaining in this service: `callLeadSourceMatch.ts`, `leadSourceCompatibility.ts`
- Target: `src/services/leads/sourceLeadLookup.service.ts`
- Knowledge: `docs/knowledge/services/bookings.md` (direct create “Load linked lead”; from-source Form is this load by `form_lead_id`), `docs/knowledge/services/cancelled-lead.md` (`lead_id` only → resolve source lead, then require booked), `docs/knowledge/services/cancellation-mirror.md` (“Always load via `getLinkedLead`”). No dedicated Service file for this module. This checkout’s `CONTEXT.md` does not define a source-lead-pointer term — do not invent a glossary copy.
- Callers: `bookings/bookedLead.service.ts` + `bookingMirror.service.ts` + `bookingSourceResolver.ts` (named load), `cancellations/cancellationResolver.ts` (id-only) + `cancelledLead.service.ts` + `cancellationMirror.service.ts` (named load), `sheetSync/sheetSyncSourceLookup.ts` + `drainer/jobPlanner.ts`, `employeeBookings/bookingLeadAttachment.service.ts` (named load before claim)
- Seams callers need: we already named Form or Call and the id vs we only have an id (cancellation create)
- Split later (only if the file outgrows one sitting): keep one file — this is already one sitting. Never `create.ts` / `update.ts` / `delete.ts`

## What this file actually does

Two operations, not “a getById helper” and not booking or cancellation:

1. **Load the source lead we already named** — the caller already has `FormLead` or `CallLead` plus an id (booking `lead_ref`/`lead_model`, from-source Form `form_lead_id`, a sheet-sync chain, an employee attach). Load that document in that collection. If it is missing, 404. Do **not** look in the other collection. Do **not** refuse because it is a Duplicate Lead, already booked, already cancelled, or `created_on_unmatched`. Those filters belong to the caller (employee claim, phone pick, sheet skip).
2. **Name which collection this id belongs to** — cancellation create sometimes sends only `lead_id`. Look in Form and Call at the same time. If both documents exist, 409 — the id is not a pointer. If neither exists, 404. If exactly one exists, return that lead and the model name. This file does **not** require `lead.booked`; the cancellation resolver does that next.

`getLinkedLead` / `resolveSourceLeadById` are executor mechanics. The owner question is: *which Form or Call is this booking, cancellation, or sheet row talking about — and did they already tell us the collection?*

`findFormLead` is not this file. That enrichment lookup 404s Duplicate Leads. Job-number Call match, phone pick, unmatched create, Granot identity, employee candidate lists, and admin browse each load leads their own way. Referral / leadless bookings have no source lead and skip this file.

## Organization

Keep one file. This is the screenplay for “the pointer we were given.” Mirrors, sheet chains, employee claim, and cancellation “is it booked?” already live in deeper **modules**. Do not pull those in. Do not invent a `SourceLeadLookupService` class.

Do not split this 70-line file. Named load vs id-only are two **seams** on one story, not two folders. Do not move the named load into `bookings/` “because most callers book.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `getLinkedLead` | `loadTheSourceLeadWeAlreadyNamed` | booking, mirror, sheet chain, employee attach — pointer is `(model, id)` |
| `resolveSourceLeadById` | `nameWhichCollectionThisLeadIdBelongsTo` | cancellation create with only `lead_id` — must detect a two-collection collision |
| `SourceLeadDocument` | `SourceLeadDocument` | the hydrated Form-or-Call document mirrors and sheet sync `.save()` / `.populate()` / `.get()` |

Keep the old names as one-line aliases until bookings, cancellations, sheet-sync (direct import, not only the barrel), employee attach, and `domainCommands/existingWrites` migrate. Do not make callers learn `get` / `resolve` / `ById` as the domain language.

**No class for the workflow.** The type that *does* earn a name is the pointer the named load already requires:

```ts
type NamedSourceLeadPointer = {
  leadModel: LeadModelName  // "FormLead" | "CallLead"
  leadId: string
}

type IdentifiedSourceLead = {
  lead: SourceLeadDocument
  leadModel: LeadModelName
}
```

`SourceLeadDocument` stays exported. Booking mirror, booking source resolve, and sheet sync already import it so they can write the same document they loaded. Do not replace it with a lean POJO.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// sourceLeadLookup.service.ts
// A booking, a cancellation, or a sheet row points at a Form or a Call.
// If they already named the collection, load that document.
// If they only sent an id, look in both — and refuse if both claim it.
// This file does not decide whether the lead may be booked,
// cancelled, or shown on a sheet.

// ── 1. Load the source lead we already named ──────────────

export async function loadTheSourceLeadWeAlreadyNamed(leadModel, leadId, session?)

function openTheCollectionWeWereTold(leadModel)   // FormLead or else CallLead
function attachTheCallerSession(query, session)   // only when a session was passed
function refuseWhenThatDocumentIsMissing(lead, leadModel, leadId)  // 404

// ── 2. Name which collection this id belongs to ───────────

export async function nameWhichCollectionThisLeadIdBelongsTo(leadId, session?)

async function lookInFormAndCallAtTheSameTime(leadId, session)
function refuseWhenBothCollectionsClaimTheId(formLead, callLead, leadId)  // 409
function returnTheLeadAndItsModel(formLead, callLead)
function refuseWhenNeitherCollectionHasIt(leadId)  // 404
```

Read the named load out loud: *They already told us Form or Call and the id. Open that collection. If the caller is inside a transaction, stay in it. If the document is not there, say not found. Do not peek at the other collection. Do not ask whether it is a Duplicate, booked, cancelled, or an unmatched stub — that is the caller’s next beat.*

Read the id-only path out loud: *They only gave us an id. Look in Form and Call together. If both have a document, the id is not a pointer — conflict. If exactly one has it, that is the source lead and we now know the model. If neither has it, not found. Whether that lead is booked is the cancellation resolver.*

That is the operation. `getLinkedLead` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **The two seams are not one function with an optional model.** Named load 404s when the told collection misses, even if the other collection has that id. Id-only must query **both** so a collision can 409. Do not add “if Form misses, try Call.” Do not short-circuit id-only to `if (formLead) return form` — that hides a two-collection claim. Cancellation knowledge already treats a model/id mismatch against the booking as a later 409; this file’s job is the pointer, not the booking chain.

2. **Collision is 409, not “prefer Form.”** Same ObjectId in `form_leads` and `call_leads` is treated as corrupt data. Do not pick newest, prefer Form, or log-and-continue. The message stays `Lead id matched both form and call leads`.

3. **Two 404 messages are two seams.** Named miss: `Linked source lead not found` + `{ leadModel, leadId }`. Id-only miss: `Source lead not found` + `{ leadId }`. Keep them. Callers and logs already tell the stories apart.

4. **This file does not filter eligibility.** `findFormLead` hides Duplicate Leads. `claimAvailableLeadForBooking` refuses booked / cancelled / duplicate / unmatched Call stubs. Phone pick prefers open. Sheet drain **loads** an unmatched Call Lead here, then skips the write in `jobPlanner` / `syncSourceLead`. Keep those rules in those **modules**. Do not 404 a Duplicate or unmatched stub from this load so “lookup always means bookable.”

5. **Hydrated document is the contract.** Mirrors `.save()`, sheet sync `.populate("booked")` and `.get("created_on_unmatched")`, domain-command snapshots `.toObject()`. Do not switch to `lean()`. Do not return `{ id, model }` and make every caller reload.

6. **Session attach is two dialects in one file.** Named load does `session ? query.session(session) : query`. Id-only always `.session(session ?? null)`. Do not silently unify mongoose `undefined` vs `null` session during the rename. Callers that pass a session (booking/cancel txn, employee attach, `existingWrites`) must stay in that txn. Sheet drain and from-source Form load pass no session — that is correct; they are not in the write.

7. **Anything not `FormLead` is CallLead.** `leadModel === "FormLead" ? Form : Call`. `LeadModelName` is only those two today, so TypeScript holds the door. Name the branch. Do not throw on an unexpected string in this rename, and do not add a third collection here.

8. **Invalid ObjectId is today’s 404.** `findById` on garbage returns null, then `NotFoundError`. Routes should have validated already. Do not add `mongoose.isValidObjectId` here so the **interface** grows a 400 unless a caller actually needs that split.

9. **Errors stay `NotFoundError` / `ConflictError`.** Cancellation resolver then throws `V1ServiceError` 409 for “Source lead is not booked” and booking-chain mismatches. Do not wrap this file in `V1ServiceError`. Do not move the booked check into the id-only export.

10. **Ad-hoc `findById` still exists on purpose.** From-source Call uses `CallLead.find({ job_no })`, then the phone pick. Granot identity, search, enrichment, admin browse, and `synchronizeLeadFromGranot`’s own `loadLeadSnapshot` are different stories. Cancellation mirror knowledge says *that* path must use this named load — do not treat that sentence as “every Form/Call `findById` in the repo.”

11. **`existingWrites.loadLeadSnapshot` is a caller pass-through.** It calls this named load and `.toObject()`, and its return type lies (`| null`) because this file throws. `updateSourceOwnedLead` already loaded the lead once for the Best Relocation guard, then loads again. Do not add a snapshot export here so “commands have a third seam.” Fix the double-load on the command **adapter** later.

12. **Referral / leadless skip this file.** Those bookings have no `lead_ref`. Do not invent `loadTheSourceLeadWeAlreadyNamed` that returns `undefined` for a missing pointer. Callers already branch.

13. **Leave sibling modules alone.** Phone pick, Duplicate / Form Fill, source assignment, CPL, booking mirror writes, cancellation “is it booked?”, and sheet unmatched-skip stay where they are.

## Testing

The **interface** is the test surface: `loadTheSourceLeadWeAlreadyNamed`, `nameWhichCollectionThisLeadIdBelongsTo`.

There is no `sourceLeadLookup.service.test.ts` today. Booking and cancellation tests exercise callers; they do not lock the collision or the “wrong collection” 404.

Add a focused test file. Prove the **interface**, not `openTheCollectionWeWereTold` alone.

**Load the source lead we already named**
- Form id + `FormLead` returns that Form Lead (including a Duplicate Lead).
- Call id + `CallLead` returns that Call Lead (including `created_on_unmatched: true`).
- A Call id asked as `FormLead` → 404 `Linked source lead not found` (do not return the Call).
- Missing id → 404 with `{ leadModel, leadId }`.
- Returned document is hydrated (has `.save` / `.get`), not lean.

**Name which collection this id belongs to**
- Only Form exists → `{ lead, leadModel: "FormLead" }`.
- Only Call exists → `{ lead, leadModel: "CallLead" }`.
- Same id in both collections → 409 `Lead id matched both form and call leads`.
- Neither → 404 `Source lead not found` with `{ leadId }` only.
- An unbooked lead still returns — “Source lead is not booked” is the cancellation resolver.

Do **not** add a test per helper (`attachTheCallerSession`, `refuseWhenBothCollectionsClaimTheId`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Booking tests should keep proving: from-source Form uses this named load; missing `form_lead_id` is 404; job-number / phone / unmatched create stay on the booking **interface**. Cancellation tests should keep proving: `lead_id` only requires booked after this identify; both ids disagree → 409. Do not re-test sheet unmatched-skip here (`sheetSync` already owns that).

## What I would not do

- A `SourceLeadLookupService` class with `get` / `resolve` / `find`.
- Thirty two-line functions that only wrap `findById`.
- Moving this into a CRUD folder, or into `bookings/` / `cancellations/` “because they call it.”
- Merging the two seams into one optional-model function.
- Short-circuiting id-only to the first hit so collisions cannot 409.
- 404ing Duplicate Leads, booked/cancelled leads, or unmatched stubs from this file.
- Switching the return to `lean()` or `{ id, model }`.
- Routing Granot identity, phone pick, job-number match, or enrichment through this load.
- Returning `undefined` for referral / leadless so “missing pointer is fine.”
- Wrapping throws in `V1ServiceError`, or moving the booked check into the id-only export.
- Silently unifying the two session-attach dialects, or adding `isValidObjectId`, during the rename.
- Inventing a third public snapshot **seam** that only `existingWrites` would import.
