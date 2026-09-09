# Apply This Public Write Through The Command — Parse The Body And Stamp Best Relocation Only From Provenance, Then Begin The Sibling Write Inside The Executor Transaction, Persist Entity Change When Something Actually Changed, And After A First Successful Commit Tell Sheets And The Rest Of The Company — Never Connect Yourself, Never Call withTransaction, Never Finalize A Replay Or A No-Op, Never Treat Granot Confirm Or Exact updateBooking As This Story — operational story

- Status: recommended
- Service: `domainCommands` (Wave A, in-progress)
- Pass: 6 of this service — `existingWrites.ts`
- Remaining in this service: `bookings.ts`
- Target: `src/services/domainCommands/existingWrites.ts`
- Knowledge: [`docs/knowledge/services/domain-commands.md`](../../../docs/knowledge/services/domain-commands.md) section **Public / existing-write adapters** (`applies_to` names this file). Distinct from who may speak: already-recommended [domain-commands-command-context.md](domain-commands-command-context.md) — later adapters **receive** a bag that file **judged**. Distinct from the HTTP bag factory: already-recommended [domain-commands-existing-write-context.md](domain-commands-existing-write-context.md) — that file **builds** the bag; this file never **asks** `existingWriteContextFromRequest`. Distinct from apply-once / replay / after-commit finalize: already-recommended [domain-commands-idempotency.md](domain-commands-idempotency.md) — this file **asks** `executeCanonicalCommandWithPostCommit` once per adapter; it never opens a session. Distinct from append-only Entity Change: already-recommended [domain-commands-entity-change.md](domain-commands-entity-change.md) — this file **asks** `persistEntityChangeMutations` / `collectDocumentFieldChanges`; it does not classify paths. Distinct from exact `updateBooking` / attach: later `bookings.ts`. Distinct from leftover public `ingestFormLead` / `createBookedLead` / `createCancelledLead`: already-recommended [form-lead.md](form-lead.md), [bookings-booked-lead.md](bookings-booked-lead.md), [cancellations-cancelled-lead.md](cancellations-cancelled-lead.md) — those leftover wrappers are not the HTTP path. Distinct from Granot create / sync / Owner Booking / Release / Referral / discrepancy: already-recommended granot-lifecycle modules — those call the executor directly and never import this file. Distinct from RingCentral adopt: already-recommended [ringcentral-call-lead-convergence.md](ringcentral-call-lead-convergence.md). Distinct from the thin registry object: `index.ts` (skipped on open; **this file is re-exported** so Wave B routes can **ask** the adapters). Distinct from thin facades `leads.ts` / `cancellations.ts` (skipped — they return `.command` only). Distinct from Sheet Sync persist / finalize: already-recommended [sheet-sync-coordinator.md](sheet-sync-coordinator.md) — this file only decides *whether* a pending bag exists. Checked-in Granot Lead-write / Booking / Release / Referral effect flags stay false — do not describe those Owner paths as live. This checkout’s `CONTEXT.md` is a pointer to a parent glossary that is not in this tree — do not invent “Domain Command” / “Entity Change” copies. `docs/adr/` is absent here — do not invent ADR-0001 copies. Do not add this path to knowledge in this rename.
- Callers: **Wave B public mutating routes, plus the thin command-only facades Best Relocation already uses.** `v1.routes.ts` **asks** every `runExisting*` export: Form create / Form correct by name; Call / Booking / from-source / Referral / Leadless / Cancellation create, Call / Booking / Cancellation correct, and Form / Call / Booking / Cancellation delete through `handleCanonical*`. Barrel `domainCommands/index.ts` **does** re-export this file — that is load-bearing. Skipped `leads.ts` / `cancellations.ts` and later `bookings.ts` wrap these and return `.command` onto `canonicalDomainCommands` / `existingWriteCanonicalCommands`. Leftover [ingestion-apply-plan.md](ingestion-apply-plan.md) **asks** those registry names (`createFormLead`, `createCallLead`, `updateSourceOwnedLead`, `createBookingFromLead`, `createLeadlessBooking`, `createCancellation`) with an `external_sheet_ingestion` bag — it never imports this file. Tests: `domainCommands.test.ts` AC-32 (v1 names every adapter; this file **asks** persist + post-commit and never `withTransaction` / `runSheetSyncWrite` / Granot create / `updateBooking`). `entityChange.integration.test.ts` (opt-in replica: Form correct commits Command / Change / revision / outbox; same-key replay is `already_applied` and writes no second Change; empty-diff no-op writes no Change; Booking correct commits a Change). Not this **interface**: `existingWriteContextFromRequest`, `assertCommandContext`, `updateBooking`, `attachBookingToLead`, `createLeadFromGranot`, leftover `ingestFormLead`, leftover Employee submit.
- Seams callers need: trusted bag **already built** vs this apply; sibling `begin` inside the executor session vs sibling `complete` after a first successful **non-replay**; `pending` defined vs no-op / empty-diff skip finalize; reused Form Lead / duplicate Booking skip Change but still finalize; HTTP `{ command, data }` vs registry `.command` only; persisted `command_name` string vs story function name. There is no Granot **adapter**. There is no RingCentral **adapter**. There is no exact-`updateBooking` **adapter**. There is no HMAC **adapter**.
- Split later (only if the file outgrows one sitting): this is already long (~860 lines). If it later splits, split by **story**: `applyThisPublicFormLeadIngestion.ts`, `applyThisPublicCallLeadIngestion.ts`, `correctThisSourceOwnedLeadThroughTheCommand.ts`, `bookThisLeadThroughTheCommand.ts` (direct + from-source), `bookWithoutALeadThroughTheCommand.ts`, `bookThisPublicReferralThroughTheCommand.ts`, `cancelThisPublicBookingThroughTheCommand.ts`, `correctThisPublicBookingThroughTheCommand.ts`, `correctThisPublicCancellationThroughTheCommand.ts`, `removeThisPublicRecordThroughTheCommand.ts` — never `create.ts` / `update.ts` / `delete.ts` / one file per HTTP verb. Executor, HTTP bag, Entity Change, exact `updateBooking`, and leftover public wrappers stay siblings / other services.

`runExistingCreate*` / `runExistingUpdate*` / `runExistingDelete*` are executor mechanics. The owner question is: *A trusted bag already named the speaker. The body named a Form Lead, Call Lead, Booking, or Cancellation. Apply that public write through the command once. Parse the body again. Stamp Best Relocation only when provenance already says sheet ingestion — never from a client `ingestion_source`. Begin the sibling write inside the executor session. Persist Entity Change only when something actually changed. After a first successful commit, tell sheets and the rest of the company. A reused Form Lead or a duplicate Booking still finalizes the existing record and writes no Change. An empty correction writes no Change, no outbox, no finalize. This file does not connect. This file does not open a transaction. This file does not confirm a Granot Booking. This file does not replace a Booking by exact revision.*

Who may speak, who applies-or-replays, who appends Entity Change, and who mutates the Lead or Booking already live in other **modules**. Do not pull those in.

## What this file actually does

One “apply this public write through the command” story with six owner operations, not “a CRUD dump of fourteen runExisting helpers,” and not Apply This Named Command Once / Hand This HTTP Request A Trusted Vantage Admin Bag / Book This Lead / Confirm This Granot Booking:

1. **Ingest this public Lead** — Form (`createFormLead`) or Call (`createCallLead`). Derive Ingestion Origin from the bag, not from the client. Form may reuse an already-attached WordPress receipt Lead (`reusedExistingLead`) and then skip Entity Change. Call always writes a Change. Both complete the sibling after-commit story (sheets / CRM / messaging / owner events) only after a first apply.

2. **Correct this source-owned Lead** — one persisted name `updateSourceOwnedLead` for Form or Call. Sheet-ingestion bags must already point at a Best Relocation Source Company. Empty field diff → no Change, no outbox, no finalize. Form may carry a leftover `expected` preview filter; Call never does. Current v1 PATCH does not pass `expected`.

3. **Book** — four public origins, three persisted names. Direct Book This Lead and Book From Source both persist `createBookingFromLead`. Leadless persists `createLeadlessBooking`. Public Referral persists `createExistingReferralBooking` — not Granot `createReferralBooking`. A duplicate Booking-from-Lead skips Change and still completes the existing Booking after-commit hook. Leadless complete is Sheet Sync only; the HTTP body is a second populate after the command returns.

4. **Cancel this public Booking** — persisted name `createCancellation`. Writes Cancellation + Booking + optional mirrored Lead Changes (up to three). Sheet-ingestion bags stamp `ingestion_source` and may pass `requiredSourceConnectionKey`. Ordinary admin provenance never authorizes leadless cancel from the body. This is not gated Release confirm. Public v1 still 409s a Referral Booking.

5. **Correct this public Booking or Cancellation** — `updateBookedLead` / `updateCancelledLead`. Sibling `noop` omits `pending` so finalize is skipped. This is not exact `updateBooking` (CAS on `{ _id, domain_revision, not cancelled }` + official Binder). That primitive lives on later `bookings.ts`.

6. **Remove this public record** — Form / Call / Booking / Cancellation. Sibling removal returns mutations + `finalize`. This file persists those Changes (including `$deleted` `reference_only`) and then **asks** `pending.finalize()` after commit. Cascade is a query flag on Lead / Booking delete; Cancellation delete has no cascade.

There is no seventh mutate operation. `persistPlannedMutations` / `assignChangeIds` / `preallocatedChangeIds` / `createFields` / `loadLeadSnapshot` / `finalizeDelete` are folds. Re-export through the barrel is convenience for Wave B, not a second story.

## Organization

Keep one file until a later sitting splits by **story**. This is the screenplay for “apply this public write through the command.” Who may speak already lives on already-recommended `commandContext.ts`. The HTTP bag already lives on already-recommended `existingWriteContext.ts`. Apply-once already lives on already-recommended `idempotency.ts`. Entity Change already lives on already-recommended `entityChange.ts`. Exact Booking replace / attach already live on later `bookings.ts`. Sibling begin / complete already live on already-recommended Form / Call / Booking / Cancellation / Referral / Leadless / From-source modules. Best Relocation import fence already lives on skipped `bestRelocationImportGuard.ts`. Do not pull those in. Do not invent an `ExistingWriteService` class. Do not invent a Granot **seam**. Do not invent an exact-revision **seam**. Do not invent a CRUD folder so “create / update / delete each get a file.”

Do not move these adapters into `idempotency.ts` so “the executor owns every public write.” Do not move `beginFormLeadIngestion` here so “the command owns Form Lead.” Do not merge public `createCancellation` with gated Release so “one cancel.” Do not merge public `createExistingReferralBooking` with Granot Referral so “one Referral.” Do not give from-source its own persisted `command_name` so “the two HTTP posts look different in Mongo.” Do not drop this file from `index.ts` so “only facades import.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `runExistingCreateFormLead` | `applyThisPublicFormLeadIngestion` | Wave B Form POST and registry `createFormLead` |
| `runExistingCreateCallLead` | `applyThisPublicCallLeadIngestion` | Wave B Call POST and registry `createCallLead` |
| `runExistingUpdateSourceOwnedLead` | `correctThisSourceOwnedLeadThroughTheCommand` | Wave B Form / Call PATCH and registry `updateSourceOwnedLead` |
| `runExistingCreateBookingFromLead` | `bookThisLeadThroughTheCommand` | Wave B `POST /booked-leads` and registry `createBookingFromLead` |
| `runExistingCreateBookedLeadFromSource` | `bookThisLeadFromSourceThroughTheCommand` | Wave B `POST /booked-leads/from-source`; **same** persisted name |
| `runExistingCreateLeadlessBooking` | `bookWithoutALeadThroughTheCommand` | Wave B leadless POST and registry `createLeadlessBooking` |
| `runExistingCreateReferralBooking` | `bookThisPublicReferralThroughTheCommand` | Wave B referral POST; persisted name `createExistingReferralBooking` |
| `runExistingCreateCancellation` | `cancelThisPublicBookingThroughTheCommand` | Wave B cancel POST and registry `createCancellation` |
| `runExistingUpdateBookedLead` | `correctThisPublicBookingThroughTheCommand` | Wave B Booking PATCH; not exact `updateBooking` |
| `runExistingUpdateCancelledLead` | `correctThisPublicCancellationThroughTheCommand` | Wave B Cancellation PATCH |
| `runExistingDeleteFormLead` | `removeThisPublicFormLeadThroughTheCommand` | Wave B Form DELETE |
| `runExistingDeleteCallLead` | `removeThisPublicCallLeadThroughTheCommand` | Wave B Call DELETE |
| `runExistingDeleteBookedLead` | `removeThisPublicBookingThroughTheCommand` | Wave B Booking DELETE |
| `runExistingDeleteCancelledLead` | `removeThisPublicCancellationThroughTheCommand` | Wave B Cancellation DELETE |

Keep the old names as one-line aliases until Wave B `v1.routes.ts`, skipped facades, and AC-32 source scans migrate. Do not make callers learn `runExisting` as the domain language. Do **not** rename persisted `command_name` strings — those are the durable idempotency identity.

**No class for the workflow.** The one type that *does* earn a name is the HTTP handoff this file always returns on create / correct:

```ts
type ThisPublicWriteThroughTheCommand<TData> = {
  command: CompatibilityCanonicalCommandResult
  data: TData
}
```

That is the handoff from “the command applied or replayed” to “the route can 201 the sibling record.” Delete adapters return the command only because Wave B answers 204. Do **not** add `replayed` on `data` so “HTTP can tell.” Do **not** add `ingestion_source` on the client bag so “the landing page can claim Best Relocation.” Do **not** add `command_name` as a caller-chosen string so “one helper runs every verb.”

Leave apply-once on `idempotency.ts`. Leave the HTTP bag on `existingWriteContext.ts`. Leave exact `updateBooking` on later `bookings.ts`. Leave sibling begin / complete on the already-recommended Lead / Booking / Cancellation modules.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// existingWrites.ts
// A trusted bag already named the speaker.
// The body named a Lead, Booking, or Cancellation.
// Apply that public write through the command once.
// Stamp Best Relocation only from provenance.
// Begin the sibling write inside the executor session.
// Persist Entity Change only when something actually changed.
// After a first apply, tell sheets and the rest of the company.
// A replay or an empty correction does not finalize.
// Do not connect. Do not open a transaction.
// Do not confirm a Granot Booking. Do not replace by exact revision.

function applyThisPublicWriteThroughTheCommand({
  command_name, context, beginInsideTheExecutorWrite, completeAfterTheFirstApply,
})
  return executeCanonicalCommandWithPostCommit({
    command_name,              // persisted string; do not rename
    context,
    operation: beginInsideTheExecutorWrite,
    finalize: completeAfterTheFirstApply,
  })

function stampBestRelocationOnlyFromProvenance(origin, body)
  // inject ingestion_source / require the BR Source Company
  // never honor a client ingestion_source on vantage_admin

function persistAChangeOnlyWhenSomethingChanged(command_name, context, tx, mutations, changeIds)
  if (mutations.length === 0) return
  await persistEntityChangeMutations({ ..., mutations: assignChangeIds(mutations, changeIds) })

// ── 1. Ingest this public Lead ────────────────────────────

export async function applyThisPublicFormLeadIngestion({ data, context })
  const parsed = parseFormLead(data, context)       // BR injects before Zod
  refuseUnlessBestRelocationSourceWhenSheetIngest(context, parsed)
  const command = await applyThisPublicWriteThroughTheCommand({
    command_name: "createFormLead",
    beginInsideTheExecutorWrite: async (tx) => {
      const pending = await beginFormLeadIngestion(parsed, {
        ...tx,
        ingestion_origin: deriveFormLeadIngestionOrigin({
          commandOrigin: context.provenance.origin,
          actorType: context.actor.actor_type,
        }),
      })
      if (!pending.reusedExistingLead)
        await persistAChangeOnlyWhenSomethingChanged(..., createFields(pending.lead, FORM_LEAD_CHANGE_PATHS))
      return { entity_refs: [theFormLead], pending }
    },
    completeAfterTheFirstApply: completeFormLeadIngestion,
  })
  return { command, data: theCompletedFormLead }

export async function applyThisPublicCallLeadIngestion({ data, context })
  // same beat; always writes a Change; origin from command only

// ── 2. Correct this source-owned Lead ─────────────────────

export async function correctThisSourceOwnedLeadThroughTheCommand({
  lead_model, lead_id, patch, context, expected,
})
  refuseUnlessBestRelocationSourceWhenSheetIngest(context, loadedLead)
  const before = loadLeadSnapshot(...)
  const after = lead_model === "FormLead"
    ? await correctFormLead(lead_id, patch, { transaction: tx, expected })
    : await correctCallLead(lead_id, patch, { transaction: tx })
  const fields = collectDocumentFieldChanges(before, after, paths)
  if (fields.length === 0) return { entity_refs, pending: undefined }   // no finalize
  await persistAChangeOnlyWhenSomethingChanged(...)
  return { pending: { resource: "source_lead", operation: form_or_call_update } }

// ── 3. Book ───────────────────────────────────────────────

export async function bookThisLeadThroughTheCommand({ data, context })
  // command_name "createBookingFromLead"
  // BR also sets allow_inactive_agents + receiver from Booked Deals:job
  // duplicate outcome → no Change; still completeBookingThisLead

export async function bookThisLeadFromSourceThroughTheCommand({ data, context })
  // same persisted command_name
  // sibling already planned mutations + finalize()

export async function bookWithoutALeadThroughTheCommand({ data, context })
  // command_name "createLeadlessBooking"
  // complete = finalizeSheetSync leadless_booking.create
  // HTTP data = populateBookedLead after the command (replay → null)

export async function bookThisPublicReferralThroughTheCommand({ data, context })
  // persisted command_name "createExistingReferralBooking"
  // not Granot createReferralBooking

// ── 4. Cancel this public Booking ─────────────────────────

export async function cancelThisPublicBookingThroughTheCommand({ data, context })
  // command_name "createCancellation"
  // Cancellation + Booking + optional Lead Changes
  // 409 Referral stays in the sibling begin

// ── 5. Correct this public Booking or Cancellation ────────

export async function correctThisPublicBookingThroughTheCommand(...)
  // command_name "updateBookedLead"; sibling noop omits pending
export async function correctThisPublicCancellationThroughTheCommand(...)
  // command_name "updateCancelledLead"

// ── 6. Remove this public record ──────────────────────────

export async function removeThisPublicFormLeadThroughTheCommand(...)
export async function removeThisPublicCallLeadThroughTheCommand(...)
export async function removeThisPublicBookingThroughTheCommand(...)
export async function removeThisPublicCancellationThroughTheCommand(...)
  // persist sibling mutations (including $deleted), then pending.finalize()
```

Read the Form ingest path out loud: *the route already handed this file a trusted Vantage Admin bag and a parsed body. Parse the body again. If this write is sheet ingestion, stamp Best Relocation and refuse any other Source Company. Ask the executor to apply `createFormLead` once. Inside that write, begin Form Lead Ingestion with an origin this file derived — the client cannot supply it. If this is a new Lead, persist one Entity Change from revision 0. If this is a reused WordPress receipt, write no Change. After a first successful commit, complete Form Lead Ingestion: missing CPL, message, sheets, CRM when due. A replay hands back the stored apply and does not complete again. This file never connects. This file never talks to Granot inside the transaction.*

That is the operation. `runExistingCreateFormLead` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **The file is named existingWrites.** It does not discover an existing write. It applies a public write through the command. The HTTP bag factory next door is already-recommended `existingWriteContext.ts`. The file name should say the story (`applyThisPublicWriteThroughTheCommand` / keep the path and alias the old file name until Wave B routes move).

2. **Fourteen exports look like CRUD.** They are six owner operations plus a shared apply beat. Group them in that reading order. Do not sort them create / update / delete so “the HTTP verbs line up,” and do not split `create.ts` / `update.ts` / `delete.ts`.

3. **Persisted `command_name` is load-bearing.** Direct Book This Lead and Book From Source both store `createBookingFromLead`. Public Referral stores `createExistingReferralBooking`. Public cancel stores `createCancellation` — the same string gated Release also registers. Do not silently give from-source its own stored name so “the two POSTs audit apart,” and do not rename `createCancellation` so “public and Release stop colliding.” Parked in `CONTRADICTIONS.md`.

4. **HTTP `data` is assigned only when the operation or finalize runs.** Form / Call / Booking-from-Lead / Referral assign `finalized` inside `finalize`. Leadless assigns `bookingId` inside `operation`, then populates after the command. On replay the executor skips both, so `{ command, data }` can be `{ already_applied, undefined | null }` and Wave B still 201s that body. Do not silently reload the aggregate on replay so “HTTP always has a record,” and do not change 201 to 200 in this rename.

5. **Empty correction and reused / duplicate creates disagree about finalize.** Source-owned / Booking / Cancellation correct omit `pending` when the field diff is empty. Reused Form Lead and duplicate Booking-from-Lead still pass `pending` and complete the sibling after-commit hook. Knowledge already names that Booking-from-Lead beat. Do not silently skip Form / Booking finalize on reuse so “no-op means no after-commit,” and do not start finalizing empty corrections so “PATCH always syncs sheets.”

6. **Best Relocation is provenance, not a body flag.** Form injects `ingestion_source: "best_relocation_sheet"` before Zod when origin is `external_sheet_ingestion`. Call only **asks** `requireBestRelocationImportSource` and derives origin from the command. Leadless / Cancellation stamp the flag from origin and drop a client value. Ordinary `POST /leadless-bookings` and `POST /cancelled-leads` build `vantage_admin`, so a body flag on those routes never opens a reconciliation case or authorizes leadless cancel. Already parked. Do not silently honor the body so “the leftover public path and the command agree.”

7. **Zod is parsed twice.** Wave B `handleCanonicalCreate` / Form handlers parse, then this file parses again. Keep the command parse — leftover ingestion and tests forward `unknown`. Do not delete it “because the route already validated.” `correctThisSourceOwnedLeadThroughTheCommand` parses at the top **and** parses again inside the Form / Call branch — that second parse is a pass-through. Delete the inner one.

8. **`expected` is a leftover preview seam with no HTTP caller.** The Form branch forwards `input.expected`. Call ignores it. `handleUpdateFormLead` and Call PATCH do not pass it. `buildGranotSyncExpectedFilter` in Wave B is a different filter. Do not start threading Granot-sync expected here so “one expected owns preview,” and do not delete the argument until a caller is proven unused.

9. **`finalizeDelete` and unused `finalizeSheetSyncDelete`.** Delete adapters already received `pending.finalize` from the sibling. `finalizeDelete` only calls it. `finalizeSheetSyncDelete` is imported and never used — queued tombstones live inside the sibling begin. Do not **ask** `finalizeSheetSyncDelete` here so “delete owns sheets twice.”

10. **Leadless HTTP populate is after-commit and outside finalize.** `populateBookedLead` runs after the command returns, not inside `completeAfterTheFirstApply`. Replay therefore cannot populate. Do not move populate into finalize so “replay still skips it,” and do not move it inside the transaction so “the write waits on populate.”

11. **From-source assigns `finalized` twice.** Once from `pending.result` inside the operation, then again from `pending.finalize()` after commit. The first assign is dead on a first apply and missing on replay. Do not keep both so “the route has something during the write.”

12. **Change-id preallocation is a ceiling, not a count.** Cancellation reserves three and may persist two. Deletes reserve four. Form create reserves one and may persist zero. Already-recommended Entity Change can mint a leftover id per mutation. Do not silently resize the array to `mutations.length` so “the ceiling becomes a count” without proving the preallocated ids stay stable across transaction-callback retry (executor already reuses the same ids).

13. **The barrel exports this file.** That is load-bearing. Exact `updateBooking` stays off the barrel’s `existingWriteCanonicalCommands` list and on `canonicalDomainCommands` via later `bookings.ts`. Do not add `updateBooking` here so “every Booking write is public,” and do not remove the re-export so “only facades import.”

14. **Leave sibling modules alone.** `beginFormLeadIngestion`, `beginCallLeadIngestion`, `createBookedLeadInTransaction`, `createBookedLeadFromSourceInTransaction`, `createLeadlessBookingInTransaction`, `createReferralBookingInTransaction`, `createCancelledLeadInTransaction`, `correctFormLead`, `correctCallLead`, `updateBookedLeadInTransaction`, `updateCancelledLeadInTransaction`, the four `*InTransaction` removals, `derive*IngestionOrigin`, `requireBestRelocationImportSource`, `persistEntityChangeMutations`, and `executeCanonicalCommandWithPostCommit` are already the right **depth**. This file orchestrates them.

15. **This file cannot speak as Granot or RingCentral.** It will apply a bag those origins built if a caller passes one, but no Granot / RingCentral module imports it. Do not add an `origin` switch so “one adapter runs every command.”

## Testing

The **interface** is the test surface: the fourteen story-named adapters (old names stay as aliases).

Today’s `domainCommands.test.ts` AC-32 only source-scans that v1 names the old exports and that this file **asks** persist + post-commit and never `withTransaction` / `runSheetSyncWrite` / Granot create / `updateBooking`. `entityChange.integration.test.ts` proves Form correct and Booking correct through this **interface** on an opt-in replica. Keep proving the operations. A later implementer may **ask** these exports with a trusted bag so a fail-closed test does not have to stand up a route — that is still the same **interface**.

**Shared apply beat**
- Every adapter **asks** `applyThisNamedCommandThenCompleteAfterCommit` once. Source scan: no `withTransaction`, no `runSheetSyncWrite`, no `createLeadFromGranot`, no `updateBooking`.
- Persisted names stay `createFormLead` / `createCallLead` / `updateSourceOwnedLead` / `createBookingFromLead` (both booking adapters) / `createLeadlessBooking` / `createExistingReferralBooking` / `createCancellation` / `updateBookedLead` / `updateCancelledLead` / `deleteFormLead` / `deleteCallLead` / `deleteBookedLead` / `deleteCancelledLead`.

**Ingest this public Lead**
- Form / Call derive Ingestion Origin from the bag. Client `ingestion_origin` is ignored.
- Sheet-ingestion Form injects `best_relocation_sheet` and refuses a non-BR Source Company. `vantage_admin` does not inject.
- Reused Form Lead → no Change, finalize still runs on first apply.
- Call always writes a Change from revision 0.
- Replay → stored `already_applied`, no second Change, no second complete. HTTP `data` may be undefined (today’s assign-in-finalize). Do not “fix” that in the rename.

**Correct this source-owned Lead**
- Empty field diff → `status: "applied"`, no Change, no revision bump, no finalize (today’s replica no-op).
- Material Form `quoted` → one Change, revision 0→1, outbox, no phone in the Change JSON (today’s replica).
- Same command id / key replay → `already_applied`, still one Change.

**Book / cancel / remove**
- Duplicate Booking-from-Lead → no Change, still `completeBookingThisLead`.
- Public Referral persists `createExistingReferralBooking`, not `createReferralBooking`.
- Public cancel writes Cancellation + Booking (+ Lead when linked). Referral 409 stays in sibling begin.
- Delete persists sibling `$deleted` mutations and **asks** `pending.finalize()` only after first apply.

**Do not add**
- A test per helper (`persistPlannedMutations`, `createFields`, `assignChangeIds`, `finalizeDelete`).
- A test that `assertCommandContext` ran — that is already-recommended speaker-gate.
- A test that `existingWriteContextFromRequest` minted the bag — that is already-recommended HTTP bag.
- A test that exact `updateBooking` CAS’d — that is later `bookings.ts`.
- A test that leftover `ingestFormLead` posted CRM — that is already-recommended Form Lead.
- A helper-unit test that has to change when `stampBestRelocationOnlyFromProvenance` is inlined.
- A live Mongo network test in the default suite. Replica proof stays opt-in.

The fourteen adapters stay exported because Wave B routes and the command-only facades are a second real **adapter**, not a test leak.

## What I would not do

- An `ExistingWriteService` / `PublicCommandService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `executeCanonicalCommandWithPostCommit`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or one file per HTTP verb “for cleanliness.”
- Breaking the begin-inside-the-executor / complete-after-first-apply **seam**. Sheets, CRM, messaging, and populate must not sit inside the Mongo write.
- Treating Apply This Named Command Once, Hand This HTTP Request A Trusted Vantage Admin Bag, leftover Form Lead Ingestion, leftover Book This Lead, Granot confirm, exact `updateBooking`, leftover Employee submit, or RingCentral adopt as this story. Those **judge**, **apply-or-replay**, **build a different bag**, or **write a different official fact**.
- Inventing a Granot **seam**, an exact-revision **seam**, or a WordPress-receipt **seam** that has only one **adapter** inside this file.
- Silently renaming persisted `command_name` strings, silently honoring client `ingestion_source`, silently reloading `data` on replay, silently merging public cancel with Release, silently merging public Referral with Granot Referral, silently moving begin / complete into this file, or silently dropping this file from the barrel.
- Writing a whole-folder recommendation for `domainCommands`.
- Jumping to `durableWork` while this checklist still has unchecked modules.
