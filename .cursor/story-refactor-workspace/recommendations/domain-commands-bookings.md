# Replace This Official Booking By Exact Revision — Load The Booking That Still Sits At The Expected Revision And Is Not Cancelled, Require Live Agents And Merchant, Write Only Book Date Allocations Binder Deposit And Merchant, Persist Entity Change When Those Fields Moved, And After A First Mutating Apply Tell The Booking Chain — Never Open A Granot Case, Never Mirror The Lead, Never Patch Arbitrary Fields — Then Attach This Ingestion Leadless Booking To The Named Lead When The Owner Desk Case Exists — operational story

- Status: recommended
- Service: `domainCommands` (Wave A, visited)
- Pass: 7 of this service — `bookings.ts`
- Remaining in this service: none
- Target: `src/services/domainCommands/bookings.ts`
- Knowledge: [`docs/knowledge/services/domain-commands.md`](../../../docs/knowledge/services/domain-commands.md) sections **Registry vs executor callers** and **Public / existing-write adapters** (`updateBooking` exact aggregate; `attachBookingToLead` on the registry). `applies_to` omits this file — do not add the path in this rename. Distinct from apply-once / replay / after-commit finalize: already-recommended [domain-commands-idempotency.md](domain-commands-idempotency.md) — exact replace **asks** `executeIdempotentCanonicalCommand` and owns its own after-commit; attach **asks** `executeCanonicalCommandWithPostCommit`. Distinct from who may speak: already-recommended [domain-commands-command-context.md](domain-commands-command-context.md) — this file **receives** a bag. Distinct from the HTTP bag factory: already-recommended [domain-commands-existing-write-context.md](domain-commands-existing-write-context.md) — this file never **asks** `existingWriteContextFromRequest`. Distinct from public Form / Call / Booking / Cancellation adapters: already-recommended [domain-commands-existing-writes.md](domain-commands-existing-writes.md) — the five one-line exports here only unwrap `.command`. Distinct from append-only Entity Change: already-recommended [domain-commands-entity-change.md](domain-commands-entity-change.md). Distinct from even-cent official split: already-recommended [agents-agent-allocation.md](agents-agent-allocation.md) — this file **asks** `officialBookingAgentIds` / `officialBookingAllocations`. Distinct from leftover Book A Leadless Job: already-recommended [bookings-leadless-booking.md](bookings-leadless-booking.md) — that sibling **opens** the pending desk case this attach later **works**. Distinct from the Owner desk write: already-recommended [employee-bookings-booking-lead-reconciliation.md](employee-bookings-booking-lead-reconciliation.md) and [employee-bookings-booking-lead-attachment.md](employee-bookings-booking-lead-attachment.md) — attach **asks** `resolveBookingLeadReconciliationInTransaction` with `attach_existing` only; it never imports the attachment sibling. Distinct from Granot confirm / case-owned official replace / Referral mint: already-recommended [granot-lifecycle-booking-confirmation.md](granot-lifecycle-booking-confirmation.md), [granot-lifecycle-booking-owner-commands.md](granot-lifecycle-booking-owner-commands.md), [granot-lifecycle-referral-booking.md](granot-lifecycle-referral-booking.md) — those persist the same `updateBooking` **string** on a case and never import this file. Distinct from Granot Connect Booking to Lead: leftover `connectBookingToLead.ts` (already-recommended as a Granot Owner command; different persisted name). Distinct from gated Release `updateBooking`: already-recommended [granot-lifecycle-release-owner-commands.md](granot-lifecycle-release-owner-commands.md). Distinct from public Booking PATCH: `runExistingUpdateBookedLead` — arbitrary fields, no CAS, no official Binder. Distinct from Best Relocation apply-plan create: already-recommended [ingestion-apply-plan.md](ingestion-apply-plan.md) — that file **asks** registry `createBookingFromLead` / `createLeadlessBooking`; it never **asks** `updateBooking`. Distinct from the thin registry object: `index.ts` (skipped — **this file is the source** of `updateBooking` / `attachBookingToLead` on `canonicalDomainCommands`). Distinct from skipped `reconciliation.ts` (one-line re-export of attach). Distinct from skipped `leads.ts` / `cancellations.ts` (command-only facades with no second story). Checked-in Granot Lead-write / Booking / Release / Referral effect flags stay false — do not describe those Owner paths as live. This checkout’s `CONTEXT.md` is a pointer to a parent glossary plus four employee-booking terms — link `booking lead reconciliation case`; do not invent “Domain Command” / “Official Booking” copies. `docs/adr/` is absent here — do not invent ADR-0001 copies. Do not add this path to knowledge in this rename.
- Callers: **one live attach caller, plus the registry object.** Wave B `ingestion.routes.ts` `POST .../conflicts/:id/resolve` `attach_booking` **asks** `canonicalDomainCommands.attachBookingToLead` with an `external_sheet_ingestion` bag (run / receipt from the conflict; connection key `best_relocation`). Barrel `domainCommands/index.ts` puts `updateBooking` and `attachBookingToLead` on `canonicalDomainCommands`, and puts the five public Booking aliases on `canonicalDomainCommands` / `existingWriteCanonicalCommands`. Skipped `reconciliation.ts` re-exports attach. Leftover [ingestion-apply-plan.md](ingestion-apply-plan.md) **asks** `createBookingFromLead` / `createLeadlessBooking` from the injected registry — those one-liners unwrap already-recommended public adapters; apply-plan’s `switch` has no `update_booking` arm. Tests: `domainCommands.test.ts` (this file must not import Express / Google / Best Relocation parsers; sibling `InTransaction` desk begin must not `withTransaction` / `runSheetSyncWrite` / `finalizeSheetSync`). `ingestion.test.ts` source-scans the conflict route for `canonicalDomainCommands.attachBookingToLead` and injects a mock `updateBooking` on the registry (the mock never runs this file). Granot admin `update-booking` **asks** leftover `updateGranotBooking` / `updateExistingBooking`, not this export. Not this **interface**: `runExistingUpdateBookedLead`, `confirmBooking`, `updateExistingBooking`, `connectBookingToLead`, leftover `createBookedLead`, leftover Employee HTTP resolve.
- Seams callers need: exact Booking-id replace vs case-owned Owner replace (same persisted `updateBooking` string); apply-once that owns after-commit vs apply-then-complete; official Binder fields vs public Booking PATCH; BR ownership proof (this source’s `createLeadlessBooking` execution) vs ordinary attach; `attach_existing` only vs mint / reassign / dismiss. There is no Granot case **adapter**. There is no Lead-threshold **adapter**. There is no HMAC **adapter**. There is no HTTP bag **adapter**.
- Split later (only if the file outgrows one sitting): this is already two stories in one sitting (~310 lines). If it later splits: `replaceThisOfficialBookingByExactRevision.ts`, `attachThisLeadlessBookingToTheNamedLead.ts` — never `create.ts` / `update.ts` / `delete.ts` / `attach.ts`, and never merge the five public aliases into those files. Public adapters stay on already-recommended `existingWrites.ts`. Case-owned Owner replace stays on already-recommended `bookingOwnerCommands.ts`.

`updateBooking` / `attachBookingToLead` / `createBookingFromLead` are executor mechanics. The owner questions are: *We already have a Booking. Someone typed official details and the revision they last saw. If that Booking still sits at that revision and is not cancelled, and the Agents and Merchant are still active: replace only Book Date, even-cent allocations, Binder, Deposit, Merchant, and the two deposit flags. Persist Entity Change only when those fields moved. After a first mutating apply, tell the Booking Chain. Do not open a Granot case. Do not touch the Lead. Do not accept a public PATCH bag.* And: *Best Relocation booked this Job without a Lead. The owner named a Form or Call on the conflict desk. If this write is sheet ingestion, the Lead must already be a Best Relocation Source Company and this Booking must already belong to this connection as `createLeadlessBooking`. The pending Owner desk case must exist. Attach that Lead. Persist Changes on Booking and Lead when fields moved. After a first apply, finalize every sheet job the desk queued. Do not mint a Lead. Do not reassign. Do not confirm a Granot Job.*

Who may speak, who applies-or-replays, who appends Entity Change, who splits the Binder, who opens the desk case, and who mutates official fields from a Granot case already live in other **modules**. Do not pull those in.

## What this file actually does

Two owner operations of one “exact official Booking facts, or attach this Leadless Job to the Lead the owner named” story, not “a Booking CRUD dump,” and not Apply This Public Write / Confirm This Granot Job / Replace Official Fields On The Booking This Case Already Named:

1. **Replace this official Booking by exact revision** — persisted name `updateBooking`. Preallocate one Change id. **Ask** apply-once (not the post-commit wrapper). Load `BookedLead` on `{ _id, domain_revision: expected, not cancelled }`. Miss → throw `DOMAIN_REVISION_CONFLICT`. Load the official Agent ids and Merchant **inside** the executor session; any inactive or missing row → throw `GRANOT_VALIDATION_FAILED`. Build desired official fields only: Book Date as UTC midnight from `YYYY-MM-DD`, allocations from already-recommended even-cent split plus catalog name snapshots, rounded Binder / Deposit, Merchant name, `over_2000` / `over_4000` from Deposit. CAS `$set` on `{ _id, expected revision, the same normalized Job, not cancelled }`. Lost CAS → `DOMAIN_REVISION_CONFLICT`. Reload. Collect booked-lead paths. Empty diff → no Change, no outbox, no finalize. Material diff → persist one Entity Change and queue `booking_chain` / `booked_lead.update` in the same session. After a first successful apply **and** a material diff, **ask** `finalizeSheetSync` for that same job. Replay never finalizes. This function does not load a Granot case. This function does not `$set` Job, source, customer, Lead pointer, or cancellation. This function does not mirror deposit flags onto a linked Lead.

2. **Attach this Leadless Booking to the named Lead** — persisted name `attachBookingToLead`. Preallocate two Change ids. **Ask** apply-then-complete. If the bag is `external_sheet_ingestion`: load the named Lead, **ask** `requireBestRelocationImportSource` on its Source Company, then require a `DomainCommandExecution` for this origin + `createLeadlessBooking` + this connection key + this Booking id. Missing ownership → 409 *Booking does not belong to this ingestion source*. Then require a `booking lead reconciliation case` for this Booking. Missing case → 404. Load Booking and Lead snapshots. **Ask** `resolveBookingLeadReconciliationInTransaction` with `attach_existing` only (case revision + Lead model/id; no `source_resolution`, no warning overrides). Reload both aggregates. Persist Entity Changes only for paths that moved. Return those sheet jobs as `pending`. After a first apply, finalize each job. Replay does not finalize. This function does not mint a Lead. This function does not reassign. This function does not dismiss. This function does not write a Granot Record Link.

There is no third mutate operation. The five public Booking exports (`createBookingFromLead`, `createLeadlessBooking`, `createExistingReferralBooking`, `updateBookedLead`, `deleteBookedLead`) are registry **aliases** of already-recommended `existingWrites.ts` — they unwrap `.command` (delete already returns the command). `actorContext` is a fold from the trusted bag to the desk actor string. Re-export through the barrel and skipped `reconciliation.ts` is convenience for Wave B / ingestion, not a second story.

## Organization

Keep one file until a later sitting splits by **story**. This is the screenplay for “replace official fields on this Booking by exact revision, or attach this Leadless Job to the Lead the owner named.” Who may speak already lives on already-recommended `commandContext.ts`. Apply-once already lives on already-recommended `idempotency.ts`. Entity Change already lives on already-recommended `entityChange.ts`. Public Booking create / patch / delete already live on already-recommended `existingWrites.ts`. Even-cent split already lives on already-recommended `agentAllocation.service.ts`. The pending desk case already opens on already-recommended `leadlessBooking.service.ts`. The desk write already lives on already-recommended employee reconciliation / attachment. Case-owned Owner replace already lives on already-recommended `bookingOwnerCommands.ts`. Granot Connect already lives on leftover `connectBookingToLead.ts`. Do not pull those in. Do not invent a `BookingCommandService` class. Do not invent a Granot-case **seam**. Do not invent a Lead-threshold **seam**. Do not invent a CRUD folder so “create / update / delete / attach each get a file.”

Do not move exact replace into `bookingOwnerCommands.ts` so “one `updateBooking`.” Do not move attach into `existingWrites.ts` so “every public Booking write is one file.” Do not move attach into `bookingLeadAttachment.service.ts` so “one attach.” Do not move attach into `connectBookingToLead.ts` so “one connect.” Do not expand the five aliases so “this file owns Book This Lead.” Do not split `create.ts` / `update.ts` / `delete.ts` / `attach.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `updateBooking` | `replaceThisOfficialBookingByExactRevision` | registry primitive: Booking id + expected revision + official details; no case |
| `attachBookingToLead` | `attachThisLeadlessBookingToTheNamedLead` | BR conflict resolve and registry attach; `attach_existing` only |
| `createBookingFromLead` | keep as alias of `bookThisLeadThroughTheCommand` | registry `.command` for leftover apply-plan / `canonicalDomainCommands` |
| `createLeadlessBooking` | keep as alias of `bookWithoutALeadThroughTheCommand` | same |
| `createExistingReferralBooking` | keep as alias of `bookThisPublicReferralThroughTheCommand` | `existingWriteCanonicalCommands` |
| `updateBookedLead` | keep as alias of `correctThisPublicBookingThroughTheCommand` | public PATCH, not exact replace |
| `deleteBookedLead` | keep as alias of `removeThisPublicBookingThroughTheCommand` | public DELETE |

Keep the old names as one-line aliases until `canonicalDomainCommands`, the conflict route, and AC source scans migrate. Do not make callers learn `runExisting` as the domain language. Do **not** rename persisted `command_name` strings — `updateBooking` and `attachBookingToLead` are durable idempotency identity. Do **not** give the five aliases new story files in this pass.

**No class for the workflow.** The one type that *does* earn a name is the attach handoff:

```ts
type ThisLeadlessAttachInProgress = FullSheetSyncJob[]
```

That is the handoff from “the desk attached the Lead inside the executor session” to “finalize every queued sheet job after a first apply.” Exact replace has no pending bag — it owns after-commit with a material-diff flag. Do **not** add `pending` on exact replace so “every Booking write uses the wrapper.” Do **not** add `expected_case_revision` on exact replace so “the registry can review a Granot case.” Do **not** add `source_resolution` on attach so “conflict resolve can rewrite Source” without a proven caller.

Leave apply-once on `idempotency.ts`. Leave public adapters on `existingWrites.ts`. Leave case-owned Owner replace on `bookingOwnerCommands.ts`. Leave even-cent split on `agents`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// bookings.ts
// We already have a Booking.
// Either replace only the official facts at the revision the caller last saw,
// or attach this Leadless Job to the Lead the owner named.
// Do not open a Granot case. Do not patch arbitrary fields.
// Do not mint a Lead. Do not confirm a Granot Job.
// Public Book This Lead / Leadless / Referral / PATCH / DELETE
// already live next door — keep those exports as aliases.

export const createBookingFromLead = (...args) =>
  bookThisLeadThroughTheCommand(...args).then((row) => row.command)
export const createLeadlessBooking = (...args) =>
  bookWithoutALeadThroughTheCommand(...args).then((row) => row.command)
export const createExistingReferralBooking = (...args) =>
  bookThisPublicReferralThroughTheCommand(...args).then((row) => row.command)
export const updateBookedLead = (...args) =>
  correctThisPublicBookingThroughTheCommand(...args).then((row) => row.command)
export const deleteBookedLead = removeThisPublicBookingThroughTheCommand

// ── 1. Replace this official Booking by exact revision ────

export async function replaceThisOfficialBookingByExactRevision({
  booking_id, expected_domain_revision, official_booking_details, context,
})
  const changeId = preallocatedChangeId()
  let officialFieldsMoved = false
  const outcome = await applyThisNamedCommandOnce({
    command_name: "updateBooking",   // persisted; same string as Owner review / Release
    context,
    operation: async (tx) => {
      const before = await loadTheBookingAtThisRevisionIfStillLive(
        booking_id, expected_domain_revision, tx,
      )
      if (!before) refuseWithRevisionConflict()
      const catalog = await loadActiveOfficialAgentsAndMerchant(
        official_booking_details, tx,
      )
      if (catalog.missing) refuseWithGranotValidationFailed()
      const desired = officialFieldsOnly({
        book_date: utcMidnight(official_booking_details.book_date),
        allocations: officialBookingAllocations(official_booking_details)
          .map((row) => snapshotName(row, catalog.names)),
        total_binder_amount, deposit_amount, merchant: catalog.merchant.name,
        over_2000: deposit > 2000,
        over_4000: deposit > 4000,
      })
      const write = await casOfficialFieldsOnThisBooking({
        id: before._id,
        expected_domain_revision,
        normalized_job_no: before.normalized_job_no,  // do not let Job drift
        desired,
        tx,
      })
      if (write.matchedCount !== 1) refuseWithRevisionConflict()
      const after = await reloadTheBooking(before._id, tx)
      const fields = collectDocumentFieldChanges(before, after, BOOKED_LEAD_CHANGE_PATHS)
      if (fields.length === 0) return { entity_refs: [thisBooking], warnings: [] }
      officialFieldsMoved = true
      await persistEntityChangeMutations({ change_id: changeId, fields, ... })
      await persistSheetSyncIntent({
        resource: "booking_chain",
        operation: "booked_lead.update",
        bookingId: booking_id,
      }, tx.session)
      return { entity_refs: [thisBooking], warnings: [] }
    },
  })
  if (!outcome.replayed && officialFieldsMoved)
    await finalizeSheetSync({ resource: "booking_chain", operation: "booked_lead.update", bookingId })
  return outcome.result   // durable { status: "applied" }, not compatibility already_applied

// ── 2. Attach this Leadless Booking to the named Lead ─────

export async function attachThisLeadlessBookingToTheNamedLead({
  booking_id, lead_model, lead_id, expected_revision, context,
})
  return applyThisNamedCommandThenCompleteAfterCommit({
    command_name: "attachBookingToLead",
    context,
    operation: async (tx) => {
      if (context.provenance.origin === "external_sheet_ingestion") {
        const lead = await getLinkedLead(lead_model, lead_id, tx.session)
        requireBestRelocationImportSource("best_relocation_sheet", lead.source_company)
        const owned = await findThisConnectionLeadlessBookingExecution({
          origin: "external_sheet_ingestion",
          command_name: "createLeadlessBooking",
          source_connection_key: context.provenance.source_connection_key,
          booking_id,
          tx,
        })
        if (!owned) refuseWithConflict("Booking does not belong to this ingestion source")
      }
      const deskCase = await findDeskCaseForThisBooking(booking_id, tx)
      if (!deskCase) refuseWithNotFound("Booking lead reconciliation case not found")
      const before = { booking: snapshot(booking_id), lead: snapshot(lead_id) }
      const jobs = await beginWorkingTheOwnerCase(
        deskCase.id,
        { action: "attach_existing", revision: expected_revision, lead_model, lead_id },
        actorContext(context),
        tx,
      )
      const after = { booking: snapshot(booking_id), lead: snapshot(lead_id) }
      await persistEntityChangeMutations({
        mutations: changedPathsOnly([bookingChange, leadChange]),
      })
      return { entity_refs: [thisBooking, thisLead], pending: jobs }
    },
    finalize: async (jobs) => {
      for (const job of jobs) await finalizeSheetSync(job)
    },
  })
```

Read the exact-replace path out loud: *someone already handed this file a trusted bag, a Booking id, the revision they last saw, and official details. Ask the executor to apply `updateBooking` once. Inside that write, load the Booking only if it still sits at that revision and is not cancelled. Require every official Agent and the Merchant to be active in this same session. Write only Book Date, the even-cent allocations with catalog names, Binder, Deposit, Merchant name, and the two deposit flags. CAS on id + revision + the Job Number we already had + not cancelled. If those official fields did not move, write no Change and queue no sheets. If they moved, persist one Entity Change and remember Booking Chain update. After a first successful apply that actually moved fields, tell sheets. A replay hands back the stored apply and does not tell sheets again. This file never opens a Granot case. This file never patches the Lead. This file never accepts a public Booking PATCH bag.*

That is the operation. `updateBooking` as a verb is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **The file is named `bookings.ts`.** It is not every Booking write. Public Book / Leadless / Referral / PATCH / DELETE already live on already-recommended `existingWrites.ts`. This file owns exact official replace and Leadless attach. Keep the path and alias the old file name until the registry import moves, or rename to the two stories if a later sitting splits.

2. **Five public aliases sit on top of the screenplay.** They exist so leftover apply-plan and `canonicalDomainCommands` can **ask** `.command` without importing `existingWrites`. Do not grow them. Do not document them as operations of this file. `leads.ts` / `cancellations.ts` were correctly skipped as thin facades; this file was not skipped because of the two real commands.

3. **Three persisted `updateBooking` strings.** This registry primitive takes a Booking id and no case. Already-recommended Owner review takes a case + both revisions and may mirror Lead thresholds / resolve the case. Already-recommended Release review is a third. Do not silently route Owner review or Release through this export so “one `updateBooking`.” Already parked in `CONTRADICTIONS.md`.

4. **No live HTTP caller for exact replace.** Granot admin `POST .../update-booking` **asks** leftover `updateExistingBooking`. Apply-plan has no `update_booking` command. Ingestion tests mock `updateBooking` on the registry and never invoke this function. Keep the export — the registry type and knowledge name it. Do not add a public PATCH → exact-replace hop so “the primitive is live,” and do not delete it so “no caller means dead code.”

5. **The file comment lies.** It says reconciliation composes this primitive with its case CAS. Already-recommended `bookingOwnerCommands.ts` reimplements the official `$set` and does not import this file. Do not start calling this function from Owner review in this rename so “the comment becomes true.”

6. **`officialFieldsMoved` is a closure outside the operation.** Executor transaction-callback retries reuse clock and Change id. The flag is not reset at the start of `operation`. A first attempt that collected fields, then a retry that did not, can still finalize. Reset the flag at the top of `operation`, or return `{ pending: sheetJob | undefined }` through already-recommended apply-then-complete so empty diff skips finalize the same way public PATCH does. Do not silently switch wrappers without proving replay still skips sheets.

7. **Revision / catalog failures are raw `Error` strings.** Sibling Entity Change throws `DomainRevisionConflictError`. This file throws `new Error("DOMAIN_REVISION_CONFLICT")` and `new Error("GRANOT_VALIDATION_FAILED")`. Callers that `instanceof` the typed error miss. Do not silently swap the class in this rename without proving Wave B / Granot error mapping still 409s.

8. **Exact replace does not mirror the Lead.** Owner review `$set`s `over_2000` / `over_4000` on an already-linked Lead when thresholds drifted. This primitive writes those flags on the Booking only. Do not add a Lead Change so “the registry matches Owner review.”

9. **Exact replace does not use the post-commit wrapper.** Return type is durable `CanonicalCommandResult` (`applied`), not compatibility `already_applied`. Attach uses the wrapper and returns compatibility. Do not wrap exact replace so “every Booking command counts `already_applied`,” and do not unwrap attach so “ingestion can read stored status.”

10. **Attach is `attach_existing` only.** It does not pass `source_resolution` or `overridden_warnings`. Already-recommended desk write 409s a Source conflict without `source_resolution`. Conflict resolve today never sends those fields. Do not thread them here so “the command can rewrite Source,” and do not drop the 409 so “ingestion always attaches.”

11. **BR ownership is an execution row, not a Booking flag.** Sheet-ingestion attach requires `createLeadlessBooking` on this origin + this `source_connection_key` + this Booking id. Ordinary `vantage_admin` skips that proof and still needs the desk case. Do not honor a client `ingestion_source` so “public leadless can attach,” and do not skip the execution lookup so “any BR Lead may claim any Booking.”

12. **CAS keeps `normalized_job_no` from before.** Official details have no Job field. Do not drop Job from the filter so “id + revision is enough,” and do not accept a Job on official details so “replace can retarget.”

13. **Book Date is UTC midnight from `YYYY-MM-DD`.** Wave B official-details Zod already requires a calendar-valid day. This file does not re-parse Zod. Do not start parsing Florida-local midnight so “Book Date matches leftover Book This Lead.”

14. **Leave sibling modules alone.** `officialBookingAllocations`, `persistEntityChangeMutations`, `executeIdempotentCanonicalCommand`, `executeCanonicalCommandWithPostCommit`, `resolveBookingLeadReconciliationInTransaction`, `requireBestRelocationImportSource`, `finalizeSheetSync`, and `persistSheetSyncIntent` are already the right **depth**. This file orchestrates them.

## Testing

The **interface** is the test surface: `replaceThisOfficialBookingByExactRevision` and `attachThisLeadlessBookingToTheNamedLead` (old names stay as aliases).

Today’s `domainCommands.test.ts` only source-scans that this file does not import Express / Google / Best Relocation parsers, and that the desk `InTransaction` begin does not open its own transaction. `ingestion.test.ts` proves the conflict route names `canonicalDomainCommands.attachBookingToLead`. There is no replica that **asks** this file’s exact replace. Keep proving the operations. A later implementer may **ask** these exports with a trusted bag so a fail-closed test does not have to stand up a route — that is still the same **interface**.

**Replace this official Booking by exact revision**
- Live Booking at `expected_domain_revision` + active Agents / Merchant → `$set` only official fields; Job / source / customer / Lead pointer unchanged.
- Material official diff → one Entity Change, revision stamps, outbox `booking_chain` / `booked_lead.update` inside the session; first apply finalizes that job.
- Empty official diff → `status: "applied"`, no Change, no revision bump, no finalize (same beat as public PATCH no-op).
- Missing / cancelled / revision-miss / lost CAS → `DOMAIN_REVISION_CONFLICT`. Do not write a Change.
- Inactive or missing Agent / Merchant → `GRANOT_VALIDATION_FAILED`. Do not write.
- Replay same origin + key + checksum → stored apply, no second Change, no second finalize.
- Name / checksum disagree → idempotency conflict. Do not run the operation.

**Attach this Leadless Booking to the named Lead**
- Sheet-ingestion bag + this connection’s `createLeadlessBooking` execution + pending desk case + `attach_existing` → Booking and Lead Changes when fields moved; first apply finalizes every returned job.
- Sheet-ingestion bag without that execution → 409 *Booking does not belong to this ingestion source*. No attach.
- Missing desk case → 404. No attach.
- `vantage_admin` bag skips the execution lookup and still requires the case.
- Replay → stored compatibility result, no second finalize.
- Source scan: this file never **asks** `create_and_attach`, `reassign`, `dismiss`, `connectBookingToLead`, or `updateExistingBooking`.

**Do not add**
- A test per helper (`actorContext`, `officialFieldsOnly`, `loadTheBookingAtThisRevisionIfStillLive`).
- A test that the five public aliases unwrap `.command` — that is already-recommended `existingWrites.ts`.
- A test that `officialBookingAllocations` split cents — that is already-recommended agents.
- A test that Owner review resolved a case — that is already-recommended `bookingOwnerCommands.ts`.
- A test that Granot Connect wrote a Record Link — that is leftover `connectBookingToLead.ts`.
- A test that `assertCommandContext` ran — that is already-recommended speaker-gate.
- A helper-unit test that has to change when `casOfficialFieldsOnThisBooking` is inlined.
- A live Mongo network test in the default suite. Replica proof stays opt-in.

The two story exports stay on `canonicalDomainCommands` because leftover apply-plan / conflict resolve / the registry type are a second real **adapter**, not a test leak. The five aliases stay exported because the registry already names them.

## What I would not do

- A `BookingCommandService` / `OfficialBookingService` class with `create` / `update` / `delete` / `attach`.
- Thirty two-line functions that only wrap `executeIdempotentCanonicalCommand`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `attach.ts`) or one file per HTTP verb “for cleanliness.”
- Breaking the apply-once / after-commit **seam** on exact replace, or the begin-inside-the-executor / complete-after-first-apply **seam** on attach. Sheets must not sit inside the Mongo write.
- Treating Apply This Public Write, Confirm This Granot Job, Replace Official Fields On The Booking This Case Already Named, Granot Connect Booking to Lead, leftover Book This Lead, leftover Employee HTTP resolve, or public Booking PATCH as this story. Those **apply a different bag**, **open a case**, **write a Record Link**, or **patch arbitrary fields**.
- Inventing a Granot-case **seam**, a Lead-threshold **seam**, or an HMAC **seam** that has only one **adapter** inside this file.
- Silently renaming persisted `command_name` strings, silently routing Owner review through this primitive, silently mirroring Lead thresholds, silently wrapping exact replace in apply-then-complete, silently adding `source_resolution`, silently honoring client `ingestion_source`, or silently deleting exact replace because no HTTP route calls it.
- Writing a whole-folder recommendation for `domainCommands`.
- Jumping to `durableWork` before this checklist row is marked.
