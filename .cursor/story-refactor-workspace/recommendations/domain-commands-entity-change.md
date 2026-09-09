# Append This Entity Change — Diff The Named Paths And Hide Contact First, Then Write One Append-Only Row Per Aggregate And Stamp The Surviving Revision — Never Store Phone Or Address, Never Hash Contact, Never Stamp A Deleted Document, Never Rewrite A Prior Change — operational story

- Status: recommended
- Service: `domainCommands` (Wave A, in-progress)
- Pass: 4 of this service — `entityChange.ts`
- Remaining in this service: `existingWriteContext.ts`, `existingWrites.ts`, `bookings.ts`
- Target: `src/services/domainCommands/entityChange.ts`
- Knowledge: [`docs/knowledge/services/domain-commands.md`](../../../docs/knowledge/services/domain-commands.md) section **EntityChange** (`applies_to` names this file). Distinct from apply-once / replay / after-commit finalize: already-recommended [domain-commands-idempotency.md](domain-commands-idempotency.md) — that file owns the transaction; this file **asks** to be called *inside* `operation({ session })` and never finalizes. Distinct from who may speak: already-recommended [domain-commands-command-context.md](domain-commands-command-context.md) — this file copies the already-judged bag onto Change provenance and does not re-judge. Distinct from telephony proof: already-recommended [domain-commands-ringcentral-provenance.md](domain-commands-ringcentral-provenance.md). Distinct from HTTP → trusted admin bag: later `existingWriteContext.ts`. Distinct from public Form/Call/Booking/Cancellation adapters: later `existingWrites.ts` (`persistPlannedMutations` **asks** this persist). Distinct from exact `updateBooking` / attach: later `bookings.ts`. Distinct from already-recommended Form / Call / Booking / Cancellation begin-complete: those **collect** on this file’s path lists and return planned mutations; they do not persist. Distinct from leftover Granot create / sync / Owner Booking / Connect / Referral / Release / official Cancellation / discrepancy: those **ask** this persist inside their own executor `operation`. Distinct from leftover RingCentral adopt / leftover convergence-conflict: leftover `callLeadConvergence.service.ts` **asks** this persist. Distinct from already-recommended revision CAS: [granot-lifecycle-aggregate-revision.md](granot-lifecycle-aggregate-revision.md) — that file `$inc`s `domain_revision` only and returns `{ ok:false }`; this file `$set`s `last_change_id` / `last_changed_at` / `domain_revision` and **throws** `DOMAIN_REVISION_CONFLICT`. Distinct from leftover Granot timeline reads: leftover `projections.ts` **asks** `getEntityChangeModel()` and never this file. Distinct from the write-once model hooks: Wave B `src/models/EntityChange.ts` (application update/delete rejected; hashed reserved). Distinct from the thin registry object: `index.ts` (skipped on open; this file is **not** re-exported). Checked-in Granot Lead-write / Booking / Release / Referral effect flags stay false — do not describe those Owner paths as live. This checkout’s `CONTEXT.md` is a pointer to a parent glossary that is not in this tree — do not invent “Entity Change” copies. `docs/adr/` is absent here — do not invent ADR-0001 copies. Do not add this path to knowledge in this rename.
- Callers: **persist is the write interface; collect is the read interface.** Later `existingWrites.ts` `persistPlannedMutations` **asks** `persistEntityChangeMutations` for every public create / correct / delete. Later `bookings.ts` `updateBooking` / attach **asks** persist directly. Leftover Granot `createLeadFromGranot.ts`, `synchronizeLeadFromGranot.ts`, `bookingConfirmation.ts`, `bookingOwnerCommands.ts`, `connectBookingToLead.ts`, `referralBooking.ts`, `releaseOwnerCommands.ts`, `officialCancellationWrite.ts`, `discrepancyOwnerCommands.ts` **ask** persist inside their executor `operation`. Leftover `ringcentral/callLeadConvergence.service.ts` **asks** persist on leftover adopt / leftover conflict. Already-recommended `formLead.service.ts` / `callLead.service.ts` / `bookedLead.service.ts` / `cancelledLead.service.ts` **ask** `collectDocumentFieldChanges` plus the path lists (and return `deleted: true` on removal); they do not persist. Barrel `domainCommands/index.ts` does **not** re-export this file. Tests: `entityChange.test.ts` AC-32 (classify contact/address/`$deleted` as `reference_only`; builders omit raw contact; no-op collect is empty). `entityChange.integration.test.ts` opt-in replica: existing write commits Command / Change / revision / outbox; replay and rollback do not; JSON of the Change must not contain the phone. `domainCommands.test.ts` AC-32 source-scan only checks that later `existingWrites.ts` names persist. Not this **interface**: `executeCanonicalCommandWithPostCommit`, `compareAndSwapDomainRevision`, `getEntityChangeModel` reads on leftover projections, `existingWriteContextFromRequest`.
- Seams callers need: collect-then-persist (empty collect → no Change, no stamp, later adapters omit `pending`); stored values vs `reference_only` (contact / address / `$deleted` never store raw or hash); stamp the surviving aggregate vs skip stamp on delete; this persist **inside** the executor transaction vs after-commit finalize **next door**. There is no HTTP **adapter**. There is no Sheet **adapter**. There is no hashed-contact **adapter**. There is no Customer / Agent **adapter**.
- Split later (only if the file outgrows one sitting): keep one file — this is already one sitting (~490 lines, most of it named path lists). If it later splits: `nameWhatChangedWithoutWritingContact.ts` / `appendThisEntityChange.ts` — never `create.ts` / `update.ts` / `delete.ts` / `classify.ts` / one file per aggregate. Executor apply-once, HTTP context, public adapters, leftover Granot Owner commands, and already-recommended `$inc` CAS stay siblings / other services.

`persistEntityChangeMutations` / `collectDocumentFieldChanges` / `classifyEntityChangePath` are executor mechanics. The owner question is: *Someone already named a command, already mutated a Form Lead, Call Lead, Booking, Cancellation, or Record Link inside the executor’s Mongo write, and already knows which paths that kind of record may remember. Diff those named paths. If nothing material changed, write nothing. If contact, address, or delete changed, remember that the path changed and do not write the value — not even a hash. Low-risk relationship and lifecycle values may keep before and after. Unknown future paths hide the same way contact does. Then append one Entity Change per planned mutation, `revision_after` one more than `revision_before`, with provenance copied from the already-judged speaker (Granot → `granot`, RingCentral → `ringcentral`, everything else → `vantage`). Stamp `last_change_id` / `last_changed_at` / `domain_revision` on a surviving aggregate only while that aggregate still holds the expected revision. A delete writes the Change and skips the stamp — the missing document must not keep `last_change_id`. A stale revision throws `DOMAIN_REVISION_CONFLICT` so the whole command rolls back. This file does not apply the command. This file does not judge the speaker. This file does not talk to sheets.*

Who applies the named command, who may speak, who builds the HTTP bag, and who mutates the Lead or Booking already live in other **modules**. Do not pull those in.

## What this file actually does

Two operations of one “append this Entity Change” story, not “a CRUD helper,” and not Apply This Named Command Once / Form Lead Ingestion / leftover Granot confirm:

1. **Name what changed, without writing contact** — `collectDocumentFieldChanges` walks an allowlist (`FORM_LEAD_CHANGE_PATHS` / `CALL_LEAD_CHANGE_PATHS` / `BOOKED_LEAD_CHANGE_PATHS` / `CANCELLED_LEAD_CHANGE_PATHS` / `RECORD_LINK_CHANGE_PATHS`) on before and after. Same JSON (dates as ISO, ObjectIds as strings, keys sorted, `undefined` omitted) is a no-op and emits nothing. `classifyEntityChangePath` then `buildEntityChangeFields`: `$deleted` and contact/address paths are `reference_only` with **no** `before` / `after` / hash. A path in `STORED_PATHS` (or a dotted part that is) may keep values. Unknown future paths are `reference_only`. Duplicate paths collapse; blank paths drop; output sorts by path. `buildDeleteChangeFields` is the delete descriptor (`$deleted`, `reference_only`). Hashed mode is reserved on the model and is **not** invented here for contact.

2. **Append the Change and stamp the surviving aggregate** — `persistEntityChangeMutations` no-ops on an empty mutation list or a mutation whose built fields are empty. Otherwise insert one append-only `entity_changes` row per mutation (`_id` is the caller’s preallocated `change_id`; `revision_after === revision_before + 1`; `applied_at` is the executor’s `now`; provenance copies actor / initiator / request id, optional Observation Channel, and ObjectId-hex receipt / Observation / Decision / case / discrepancy / run). Then, only when `deleted` is not set, CAS-stamp the writable aggregate (`FormLead` / `CallLead` / `BookedLead` / `CancelledLead` / `GranotRecordLink`) `{ _id, domain_revision: revision_before }` → `$set` `last_change_id`, `last_changed_at`, `domain_revision + 1`. Zero match → throw `DOMAIN_REVISION_CONFLICT`. Delete writes the Change and **skips** the stamp. This beat does not erase the aggregate (already-recommended removal does). This beat does not connect Mongo. This beat does not rewrite a prior Change (the model rejects update/delete).

There is no third mutate operation. `sourceSystemForOrigin` is the origin fold (`granot_lifecycle` → `granot`, `ringcentral` → `ringcentral`, else `vantage`). `writableAggregateModel` is the five-model **adapter**. `readPath` / `sameJson` / `canonicalize` / `objectIdOrUndefined` are folds. Re-export of `EntityChange` / `DELETED_ENTITY_CHANGE_PATH` is convenience, not a second story.

## Organization

Keep one file. This is the screenplay for “append this Entity Change.” Apply-once already lives on already-recommended `idempotency.ts`. Who may speak already lives on already-recommended `commandContext.ts`. HTTP bag already lives on later `existingWriteContext.ts`. Public adapters already live on later `existingWrites.ts`. Exact Booking replace already lives on later `bookings.ts`. `$inc`-only CAS already lives on already-recommended `aggregateRevision.ts`. Write-once schema hooks already live on Wave B `models/EntityChange.ts`. Do not pull those in. Do not invent an `EntityChangeService` class. Do not invent an HTTP **seam**. Do not invent a hashed-contact **seam**. Do not invent a Customer **adapter** so “every collection has a Change.”

Do not move this persist into `idempotency.ts` so “apply includes the Change.” Do not move `stampAggregateRevision` into already-recommended `aggregateRevision.ts` so “one CAS owns every revision.” Do not move `collectDocumentFieldChanges` into later `existingWrites.ts` so “the adapter owns the diff.” Do not add this file to `index.ts` so “routes can append.” Do not split `create.ts` / `update.ts` / `delete.ts` or one file per aggregate.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `persistEntityChangeMutations` | `appendThisEntityChange` | adapters **ask** inside the executor write; empty list is a no-op |
| `collectDocumentFieldChanges` | `nameWhatChangedOnThesePaths` | empty → later adapters skip Change, stamp, outbox, finalize |
| `classifyEntityChangePath` | `hideContactOnThisPath` | stored vs `reference_only`; unknown future hides |
| `buildEntityChangeFields` | `describeTheChangedFields` | omit raw contact; sort and collapse paths |
| `buildDeleteChangeFields` | `describeThisDelete` | `$deleted` is `reference_only` |
| `FORM_LEAD_CHANGE_PATHS` / `CALL_LEAD_CHANGE_PATHS` / `BOOKED_LEAD_CHANGE_PATHS` / `CANCELLED_LEAD_CHANGE_PATHS` / `RECORD_LINK_CHANGE_PATHS` | `theNamedPathsForThisKind` | allowlist **seam**; callers do not invent paths per write |
| `sourceSystemForOrigin` | `whichCompanyBookThisCameFrom` | command origin → `vantage` / `granot` / `ringcentral` |
| `AggregateMutationPlan` / `PlannedAggregateMutation` | `ThisMutationToRemember` | preallocated `change_id` vs plan-before-id |

Keep the old names as one-line aliases until later `existingWrites.ts`, later `bookings.ts`, leftover Granot Owner modules, leftover RingCentral adopt, and already-recommended begin-complete migrate. Do not make callers learn `persist` / `classify` as the domain language.

**No class for the workflow.** The one type that *does* earn a name is the already-planned mutation:

```ts
type ThisMutationToRemember = {
  change_id: ObjectId           // caller preallocates so stamp and row share one id
  entity: EntityRef             // FormLead | CallLead | BookedLead | CancelledLead | GranotRecordLink
  revision_before: number
  fields: Array<{ path; before?; after? }>
  deleted?: boolean             // write the Change, skip the stamp
}
```

That is the handoff from “the adapter mutated the aggregate” to “the company book remembers it.” Do **not** add `hashed: true` so “contact can be a digest.” Do **not** add `model: "Customer"` so “every collection stamps.” Do **not** add `rewrite_change_id` so “a retry can patch the row.”

Leave apply-once on `idempotency.ts`. Leave `$inc` CAS on `aggregateRevision.ts`. Leave HTTP context on `existingWriteContext.ts`. Leave public adapters on `existingWrites.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// entityChange.ts
// Someone already mutated a Lead, Booking, Cancellation, or Record Link
// inside the named command’s Mongo write.
// Diff the named paths.
// Remember that contact changed. Do not write the phone.
// Append one Entity Change per aggregate.
// Stamp the surviving revision.
// A delete writes the Change and leaves no last_change_id on a missing document.
// A stale revision refuses the whole command.

// ── 1. Name what changed, without writing contact ─────────

export function nameWhatChangedOnThesePaths(before, after, theNamedPathsForThisKind)
  // skip same JSON; emit { path, before?, after? }

export function hideContactOnThisPath(path)
  // $deleted | contact | address → reference_only
  // STORED_PATHS (or a dotted part) → stored
  // unknown future → reference_only

export function describeTheChangedFields(fields)
  // collapse blank/duplicate paths, sort, drop raw values on reference_only

export function describeThisDelete()
  // [{ path: "$deleted", value_mode: "reference_only" }]

export const theNamedPathsForThisKind = {
  FormLead, CallLead, BookedLead, CancelledLead, GranotRecordLink
}

// ── 2. Append the Change and stamp the surviving aggregate ─

export async function appendThisEntityChange({
  session, now, command_name, command_execution_id, context, mutations,
})
  for (const mutation of mutations)
    const fields = mutation.deleted
      ? describeThisDelete()
      : describeTheChangedFields(mutation.fields)
    if (fields.length === 0) continue
    await writeTheAppendOnlyRow({ ...mutation, fields, provenance: copyTheSpeaker(context) })
    if (!mutation.deleted)
      await stampTheSurvivingRevision(mutation) // CAS; miss → DOMAIN_REVISION_CONFLICT

function whichCompanyBookThisCameFrom(origin)
  // granot_lifecycle → granot; ringcentral → ringcentral; else vantage

async function stampTheSurvivingRevision({ entity, change_id, revision_before, applied_at, session })
  // updateOne { _id, domain_revision } $set last_change_id / last_changed_at / domain_revision+1
```

Read the append path out loud: *diff the named paths on the document we had and the document we have now. If nothing material changed, stop. If the phone or the address changed, remember the path and throw the value away. Write one append-only Entity Change whose next revision is this one plus one, and copy the speaker who already passed the gate. If the record still lives, stamp that it was this Change, but only if nobody else advanced the revision first. If we deleted the record, write the Change and do not stamp a missing document.*

That is the operation. `persistEntityChangeMutations` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **The file is named entityChange.** It is not the Entity Change collection. It appends the company book of what this command changed. The write-once schema already lives on Wave B `models/EntityChange.ts`. The file name should say the story (`appendThisEntityChange` / keep the path and alias the old file name until later `existingWrites.ts` moves).

2. **Two revision CAS primitives.** Already-recommended `compareAndSwapDomainRevision` `$inc`s and returns `{ ok:false }`. This stamp `$set`s `last_change_*` and **throws** the same string. Knowledge names both. Do not silently route this stamp through the `$inc` helper so “one CAS owns every revision,” and do not teach the `$inc` helper to write `last_change_id` so “knowledge says later mutations use that primitive.”

3. **Contact regex is copied on the model.** `CONTACT_OR_ADDRESS_PATH` lives here and again on Wave B `EntityChange.ts`, which also rejects `FORBIDDEN_RAW_PATH` (payload / secret / token) this file never checks. Save-time validation is the backstop. Do not delete the model copy so “one regex owns PII,” and do not start emitting `hashed` here so “the reserved mode is used.”

4. **RingCentral receipts usually are not ObjectIds.** `objectIdOrUndefined` drops `source_receipt_id` / observation / Decision when the string is not hex. Leftover telephony identity is a session or Call Log id. Those Changes store `source_system: "ringcentral"` and no `receipt_id`. Do not silently persist the raw telephony string so “every origin has a receipt,” and do not require ObjectId receipts on RingCentral so “provenance is complete.”

5. **Sheet ingestion and Vantage Admin share `vantage`.** `sourceSystemForOrigin` maps only `granot_lifecycle` and `ringcentral`. Best Relocation sheet writes look like admin on the Change. Do not add `external_sheet_ingestion → ingestion` so “three books match three origins” — `run_id` already rides on provenance when present.

6. **Two path lists can drift.** `theNamedPathsForThisKind` is what callers walk. `STORED_PATHS` is what may keep values. Contact paths sit on both lists and classify as `reference_only` (regex wins). A new stored field added only to the Form list still hides. Do not silently union the lists so “one set owns classify,” and do not drop contact from the named lists so “we never record that the phone changed.”

7. **This file does not erase.** Already-recommended removal returns `deleted: true` and erases the aggregate. This persist writes `$deleted` and skips the stamp. Do not `findByIdAndDelete` here so “one file owns delete,” and do not stamp a missing document so “every Change has a last_change_id.”

8. **The barrel does not export this file.** That is load-bearing. Adapters and leftover Granot / RingCentral modules import the path. Do not add `persistEntityChangeMutations` to `index.ts` so “every route can append.” A second call site outside the executor write would break the before-commit **seam**.

9. **Leave sibling modules alone.** `executeCanonicalCommandWithPostCommit`, `compareAndSwapDomainRevision`, later `persistPlannedMutations`, leftover `beginFormLeadRemoval`, leftover Granot confirm are already the right **depth**. This file **asks** none of them except the five writable models.

10. **Later `createBookingFromLead` sometimes invents three fields by hand** (`job_no` / `lead_ref` / `lead_model`) instead of collecting. That is later `existingWrites.ts`. Do not “fix” that adapter in this rename.

## Testing

The **interface** is the test surface: `appendThisEntityChange`, `nameWhatChangedOnThesePaths`, `hideContactOnThisPath`.

Today’s `entityChange.test.ts` already names AC-32 classify / builder / empty collect. Keep proving the operations, not `canonicalize` / `readPath`. The opt-in replica (`entityChange.integration.test.ts`) already proves Command + Change + revision + outbox through later existing-write adapters, plus replay / rollback / no phone in the Change JSON. A later implementer may **ask** persist with a stubbed writable model so a fail-closed test does not have to stand up Sheet Sync — that is still the same **interface**.

**Name what changed**
- Same before/after on the named paths → `[]`. Persist is not asked.
- `quoted` false → true is stored with values. `phone_number` change is `reference_only` with no values. `$deleted` is `reference_only`.
- Unknown future path is `reference_only`. Duplicate `quoted` collapses. Output paths sort.

**Append and stamp**
- One mutation → one Change, `revision_after === revision_before + 1`, surviving aggregate `domain_revision + 1` and `last_change_id` equals the Change `_id`.
- `deleted: true` → Change with `$deleted`, aggregate stamp is **not** asked.
- Empty mutation list or empty built fields → no insert, no stamp.
- Stale `revision_before` → throw `DOMAIN_REVISION_CONFLICT` (replica already proves the executor rolls back Command + Change).
- `granot_lifecycle` → `source_system: "granot"`. `ringcentral` → `ringcentral`. Sheet / admin → `vantage`.
- Non-ObjectId `source_receipt_id` is omitted (do not require it on RingCentral).

**Do not add**
- A test per helper (`sameJson`, `readPath`, `objectIdOrUndefined`).
- A test that leftover confirm called leftover `officialBookingAllocations` — that is leftover confirm’s **interface**.
- A test that already-recommended `$inc` CAS ran — that is already-recommended aggregate revision.
- A helper-unit test that has to change when `stampTheSurvivingRevision` is inlined.
- A live Mongo network test.
- Changing the replica fixture so “createBookingFromLead collects” inside this suite.

`ThisMutationToRemember` stays exported because later adapters and leftover Granot / RingCentral already share that bag — not a test leak.

## What I would not do

- An `EntityChangeService` / `MutationService` class with `create` / `update` / `delete` / `persist`.
- Thirty two-line functions that only wrap `JSON.stringify`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or `formLead.ts` / `bookedLead.ts` “for cleanliness.”
- Breaking the inside-the-executor-write **seam**. Persist must stay in `operation({ session })`. Sheets and CRM stay out.
- Treating Apply This Named Command Once, Form Lead Ingestion, leftover Granot confirm, or leftover RingCentral adopt as this story. Those **plan** mutations or **ask** this persist.
- Inventing a hashed-contact **seam** or a Customer **seam** that has only one **adapter** inside this file.
- Silently merging this stamp into already-recommended `$inc` CAS, silently exporting this file from the barrel, silently storing telephony receipts as strings, or silently inventing hashed contact.
- Writing a whole-folder recommendation for `domainCommands`.
- Jumping to `durableWork` while this checklist still has unchecked modules.
