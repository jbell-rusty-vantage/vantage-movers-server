# Advance This Record If We Still Hold This Revision — operational story

- Status: recommended
- Service: `granotLifecycle` (Wave A, in-progress)
- Pass: 18 of this service — `aggregateRevision.ts`
- Remaining in this service: `trustedLeadCreateValidation.ts` and the rest of the `granotLifecycle` checklist in TRAVERSAL.md
- Target: `src/services/granotLifecycle/aggregateRevision.ts`
- Knowledge: [`docs/knowledge/granot-lifecycle/revisions.md`](../../../docs/knowledge/granot-lifecycle/revisions.md). That Service file also lists `src/models/granotLifecycleSchemas.ts`, `trustedLeadCreateValidation.ts`, and the Lead-provenance / aggregate-revision migrations as primary code — they are siblings, not this pass. Distinct from receipt claim / lease: [recommendations/granot-lifecycle-drainer.md](granot-lifecycle-drainer.md). Distinct from Decision orchestration: [recommendations/granot-lifecycle-processor.md](granot-lifecycle-processor.md). Distinct from the executor Change stamp: `domainCommands/entityChange.ts` (`stampAggregateRevision`). Distinct from matched-Lead / create-if-missing commands: next-but-later `synchronizeLeadFromGranot.ts` / `createLeadFromGranot.ts`. Distinct from Owner Booking / Release filters that add “not cancelled” or Job Number: `bookingOwnerCommands.ts` / `releaseOwnerCommands.ts` / `domainCommands/bookings.ts` / `cancellations/cancelledLead.service.ts`. Distinct from error tokens: `errors.ts` (already skipped). Distinct from trusted Granot create validators: next module `trustedLeadCreateValidation.ts`. This checkout’s `CONTEXT.md` does not define System of Record / Form Lead / Call Lead / Booking / Cancellation — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: **no live service import.** Tests: `aggregateRevision.test.ts` (AC-21 filter + token). `aggregateRevision.replica.test.ts` (sequential loser + concurrent one winner). `scripts/migrations/granot-lifecycle-revisions.replica.test.ts` (same disposable-collection proof). `domainCommands/idempotency.integration.test.ts` (AC-21 executor: winner `$inc`s once; loser is `DOMAIN_REVISION_CONFLICT` with no Decision / Command). Token reuse only: `errors.ts` (`DOMAIN_REVISION_CONFLICT` is the spec string, not `GRANOT_` prefixed). `domainCommands/types.ts` (`DomainRevisionConflictError.code`). Processor / Owner commands throw the same string after their own filters. Not callers: `processor.ts` (Record Link refresh `$inc`s without this export), `entityChange.ts` (rewrites the filter and `$set`s `last_change_*`), `synchronizeLeadFromGranot.ts`, `createLeadFromGranot.ts`, `bookingOwnerCommands.ts`, `releaseOwnerCommands.ts`, `bookingConfirmation.ts`, `referralBooking.ts`.
- Seams callers need: `{ _id, domain_revision }` filter vs leftover write without it; `{ ok:true, domain_revision: expected+1 }` vs `{ ok:false, code: DOMAIN_REVISION_CONFLICT }`; optional `ClientSession` so a command can abort on miss; injected `Collection` so the replica proof is not a Lead model
- Split later (only if the file outgrows one sitting): keep one file — this ~47-line claim is one sitting. Never `assert.ts` / `swap.ts` / `create.ts` / `update.ts` / `delete.ts`

`compareAndSwapDomainRevision` / `assertDomainRevisionCasFilter` are executor mechanics. The owner question is: *Two writers want to advance the same Lead, Booking, Cancellation, or Record Link. Filter `{ _id, domain_revision: expected }` and increment once. If Mongo matches zero rows, the expected revision is gone — stop, return `DOMAIN_REVISION_CONFLICT`, and do not write a replacement. This file does not persist an Entity Change. This file does not stamp `last_change_id`. This file does not confirm a Booking.*

Schema defaults, trusted Granot create validators, revision migrations, Entity Change stamping, and official Owner commands already live in other **modules**. Do not pull those in.

## What this file actually does

Two beats of one revision-claim story, not “an aggregate CRUD service,” and not the executor Change stamp / the Lead sync command:

1. **Refuse a filter that is not this record and this revision** — `_id` must be present. `domain_revision` must be a nonnegative finite integer. A missing id, a negative, a fraction, or a non-number throws before Mongo. This function does not write. This function does not invent `0` for a missing revision.

2. **Advance this record if we still hold this revision** — `updateOne` with exactly `{ _id, domain_revision }` and `{ $inc: { domain_revision: 1 } }`. Optional session rides along so a lost claim can abort the command transaction. Zero `matchedCount` → `{ ok: false, code: DOMAIN_REVISION_CONFLICT }`. A match → `{ ok: true, domain_revision: expected + 1 }`. There is no fallback write that drops the revision filter. This function does not `$set` `last_change_id` / `last_changed_at`. This function does not add `cancelled` / Job Number / `state:"active"` to the filter. This function does not persist a Decision or an Entity Change.

There is no third mutate operation. `DOMAIN_REVISION_CONFLICT` is the spec token **seam**, re-exported from `errors.ts`. `DomainRevisionCasFilter` / `DomainRevisionCasResult` are the typed handoff, not a second story.

## Organization

Keep one file as the screenplay for “advance this record if we still hold this revision.” Schema fields, trusted create validators, migrations, Entity Change stamps, and Owner command filters already live in deeper **modules**. Do not pull those in. Do not invent a `DomainRevisionService` class. Do not invent a canonical-command `begin` / `complete` **seam** here — the sibling commands own that **seam**. The revision **seam** is the filter plus the `$inc`, not a Domain Command. Do not invent a Lead-vs-Booking **seam** that has only one **adapter** here — the caller passes the collection.

Do not move `stampAggregateRevision` here so “knowledge says later mutations use this primitive.” Do not move `trustedLeadCreateValidation.ts` here so the Primary-code line “wins.” Do not move the revision migrations here so “backfill lives with CAS.” Do not merge this file into `drainer.ts` so “every claim is one file.” Do not merge this file into `processor.ts` so “Decision already increments.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `assertDomainRevisionCasFilter` | `refuseAFilterThatIsNotThisRecordAndRevision` | AC-21; throw before Mongo |
| `compareAndSwapDomainRevision` | `advanceThisRecordIfWeStillHoldThisRevision` | one winner; leftover conflict |
| `DOMAIN_REVISION_CONFLICT` | `DOMAIN_REVISION_CONFLICT` | spec token; keep the string |
| `DomainRevisionCasFilter` | `ThisRecordAtThisRevision` | `{ _id, domain_revision }` |
| `DomainRevisionCasResult` | `WhetherThisRevisionAdvanced` | `{ ok:true, next }` or `{ ok:false, code }` |

Keep the old names as one-line aliases until the replica proofs and the AC-21 executor test migrate. Do not make callers learn `matchedCount` / `$inc` as the domain language.

**No class for the workflow.** The type that *does* earn a name is the expected-revision bag before Mongo runs:

```ts
type ThisRecordAtThisRevision = {
  _id: ObjectId
  domain_revision: number  // nonnegative integer; 0 means no post-boundary change yet
}
```

That is the handoff from “we loaded the current revision” to “increment once, or stop.” Do **not** add `last_change_id` so “the primitive already recorded the Change,” and do **not** add `not_cancelled` so “a Booking claim belongs here.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// aggregateRevision.ts
// Two writers want the same Lead, Booking, Cancellation, or Record Link.
// Filter { _id, domain_revision: expected } and increment once.
// Zero rows means someone else already advanced it — stop.
// Do not write a replacement without the revision filter.
// This file does not persist an Entity Change.
// This file does not stamp last_change_id.
// This file does not confirm a Booking.

// ── 1. Refuse a filter that is not this record and this revision ─

export function refuseAFilterThatIsNotThisRecordAndRevision(filter)
  // missing _id → throw
  // domain_revision not a nonnegative finite integer → throw

// ── 2. Advance this record if we still hold this revision ─

export async function advanceThisRecordIfWeStillHoldThisRevision(
  collection,
  filter,
  session?,
)
  refuseAFilterThatIsNotThisRecordAndRevision(filter)
  updateOne({ _id, domain_revision }, { $inc: { domain_revision: 1 } }, session?)
  matchedCount === 0 → { ok: false, code: DOMAIN_REVISION_CONFLICT }
  else → { ok: true, domain_revision: expected + 1 }

export const DOMAIN_REVISION_CONFLICT = "DOMAIN_REVISION_CONFLICT"
```

Read the primary path out loud: *A command loaded this Lead at `domain_revision: 0`. It asks this file to advance that exact row. Mongo matches `{ _id, domain_revision: 0 }` and increments to `1`. A second command still holding `0` matches zero rows and hears `DOMAIN_REVISION_CONFLICT`. The loser writes no Decision and no Command. The stored revision stays `1`. This file never `$set`s `last_change_id`. This file never drops the revision filter. A Booking command that also needs “not cancelled” keeps that extra predicate in its own file.*

That is the operation. `compareAndSwapDomainRevision` is not a CRUD update.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Knowledge lists this primitive as what later mutations must use. Live commands do not import it.** `stampAggregateRevision` in `domainCommands/entityChange.ts` reprints `{ _id, domain_revision: revision_before }` and then `$set`s `last_change_id`, `last_changed_at`, and `domain_revision: revision_before + 1`. Owner Booking / Release / Cancellation writes add Job Number and “not cancelled” and throw the same string. Do not move those stamps here so the Primary-code line “wins,” and do not delete this file so “the executor already CASes.”

2. **`$inc` here is not the executor `$set`.** This primitive increments only `domain_revision`. The Change stamp writes the `last_change_*` pair in the same update. A delete skips the stamp and removes the aggregate. Do not add `last_change_id` to this `$inc` so “one write does both,” and do not switch the primitive to `$set` so the stamp “wins.”

3. **Processor Record Link refresh `$inc`s without the expected revision.** `defaultPersistDecisionAndLink` filters `{ _id, state: "active" }` and `$inc`s `domain_revision` with no `domain_revision: expected`. Knowledge says a leftover write without the revision filter is forbidden. Do not add `state:"active"` here so “the processor can call this,” and do not silently add the missing filter in the processor as part of this rename.

4. **No live service caller.** The only `compareAndSwapDomainRevision` imports are tests (unit, replica, migration replica, AC-21 executor). Units 10–11 were supposed to wire this into command execution. They throw `DOMAIN_REVISION_CONFLICT` after their own filters instead. Do not invent a live caller in this pass so “the primitive is live.”

5. **`DOMAIN_REVISION_CONFLICT` is the spec string, not `GRANOT_` prefixed.** `errors.ts` already skipped; this file re-exports the same token. `DomainRevisionConflictError` in `domainCommands/types.ts` repeats the code. Keep the string. Do not rename it `GRANOT_DOMAIN_REVISION_CONFLICT` so “every lifecycle code matches.”

6. **Revision `0` is a real expected value.** It means no authoritative post-boundary change yet. The assert allows `0`. Do not treat `0` as “unset” and skip the filter.

7. **The replica proof uses a disposable collection, not a Lead model.** `u09_domain_revision_cas` proves one winner / one leftover. Do not retarget that proof at `FormLead` so “CAS is a Lead write,” and do not add `last_change_id` to the inserted document so “the primitive recorded history.”

8. **Knowledge also lists `trustedLeadCreateValidation.ts` and the revision migrations as this Service’s primary code.** Validators force `post_to_granot=false` on trusted Granot create. Migrations fill missing `domain_revision: 0` and the history boundary; they never write `last_change_*`. Do not move those files here so the Primary-code line “wins.”

9. **Leave sibling modules alone.** Schema defaults stay in `granotLifecycleSchemas.ts`. Tokens stay in `errors.ts`. Change stamps stay in `entityChange.ts`. Receipt claim stays in `drainer.ts`. Official Booking / Cancellation filters stay on those commands. This file owns only the generic revision claim.

10. **Do not treat match, create-Lead, confirm, cancel, or drain as this story.** Those write official facts or claim a receipt. This file only advances `domain_revision` when the expected filter still matches.

11. **Do not write a whole-folder recommendation for `granotLifecycle`.**

## Testing

The **interface** is the test surface: `advanceThisRecordIfWeStillHoldThisRevision` (today `compareAndSwapDomainRevision`) and `refuseAFilterThatIsNotThisRecordAndRevision` (today `assertDomainRevisionCasFilter`).

Today’s `aggregateRevision.test.ts` already locks the token string, a legal `{ _id, 0 }` filter, and throws on `-1` / `1.5`. Replica already locks sequential leftover + concurrent one winner on a disposable collection, stored revision `1`. The migration replica reprints that proof. The AC-21 executor proof already locks: winner increments `0→1`; loser is `DOMAIN_REVISION_CONFLICT` with no Decision / Command. Keep those. Add the gaps that name the operation:

**Refuse a bad filter**
- Missing `_id` throws (add this; today’s unit never passes a null id).
- Non-finite / non-integer still throws (already locked for `1.5` / `-1`).
- `0` is legal (already locked).

**Advance if we still hold this revision**
- Winner returns `{ ok: true, domain_revision: expected + 1 }` (already locked on replica).
- Leftover returns `{ ok: false, code: DOMAIN_REVISION_CONFLICT }` and does not write a second increment (already locked).
- Concurrent pair has exactly one winner (already locked).
- Session is accepted — do not add a helper-unit that asserts the options object. The executor replica already runs it inside a transaction.
- This function does not `$set` `last_change_id` — do not add a test that it wrote an Entity Change.

Do **not** add a test per type alias. Those names exist so the parent reads. If a helper test has to change when the assert is inlined, it was testing past the **interface**.

Do **not** re-test Owner confirm, Lead sync, Entity Change classification, or receipt drain here. Do not rewrite `entityChange.integration.test.ts` as if it covered this file — that proof calls `stampAggregateRevision`. Do not add a test that this file `$set`s a Lead, confirms a Booking, or fills a missing revision from `__v`.

## What I would not do

- A `DomainRevisionService` class with `create` / `update` / `increment`.
- Thirty two-line functions that only wrap `updateOne`.
- Moving this into a CRUD folder, or into `entityChange.ts` / `processor.ts` / `drainer.ts` / `trustedLeadCreateValidation.ts` “for cleanliness.”
- Splitting `assert.ts` / `swap.ts` so the filter owns a file.
- Adding `last_change_id` to this `$inc` so “one write does both.”
- Adding `not_cancelled` / Job Number / `state:"active"` so Owner commands can call this.
- Moving `stampAggregateRevision` here so the revisions.md “must use this primitive” line “wins.”
- Silently adding `{ domain_revision: expected }` to the processor Record Link refresh so the leftover-write sentence “wins.”
- Renaming the token `GRANOT_DOMAIN_REVISION_CONFLICT`.
- Treating `0` as unset and skipping the filter.
- Writing a whole-folder recommendation for `granotLifecycle`.
