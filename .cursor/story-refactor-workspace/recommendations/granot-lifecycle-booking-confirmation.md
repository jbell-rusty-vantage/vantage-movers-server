# Confirm This Granot Job As An Official Booking On The Lead The Owner Picked — operational story

- Status: recommended
- Service: `granotLifecycle` (Wave A, in-progress)
- Pass: 23 of this service — `bookingConfirmation.ts`
- Remaining in this service: `bookingOwnerCommands.ts` and the rest of the `granotLifecycle` checklist in TRAVERSAL.md
- Target: `src/services/granotLifecycle/bookingConfirmation.ts`
- Knowledge: [`docs/knowledge/granot-lifecycle/booking-reconciliation.md`](../../../docs/knowledge/granot-lifecycle/booking-reconciliation.md) lists this file as primary code beside `bookingReconciliation.ts`, `bookingPriorityPairing.ts`, `bookingOwnerCommands.ts`, `referralBooking.ts`, the case model, and `processor.ts` — they are siblings, not this pass. Owner-command door, official details, and post-commit sheets: same file. Executor / `EntityChange` / “not on the registry object”: [`docs/knowledge/services/domain-commands.md`](../../../docs/knowledge/services/domain-commands.md). Flag: [`docs/knowledge/granot-lifecycle/revisions.md`](../../../docs/knowledge/granot-lifecycle/revisions.md) (`GRANOT_LIFECYCLE_BOOKING_COMMANDS_ENABLED`). Derived allocations: [`docs/knowledge/services/agent-allocation.md`](../../../docs/knowledge/services/agent-allocation.md). Distinct from opening the case: [recommendations/granot-lifecycle-booking-reconciliation.md](granot-lifecycle-booking-reconciliation.md). Distinct from full official replace / No Action: next module `bookingOwnerCommands.ts`. Distinct from no-Lead Referral mint: `referralBooking.ts`. Distinct from public Book This Lead: [recommendations/bookings-booked-lead.md](bookings-booked-lead.md). Distinct from authorized Granot Lead mint: [recommendations/granot-lifecycle-create-lead-from-granot.md](granot-lifecycle-create-lead-from-granot.md). Distinct from CSV Booked Jobs: [recommendations/reconciliation-booked-call-lead.md](reconciliation-booked-call-lead.md). Software map: `.cursor/rules/granot-lifecycle-capture.mdc` (`bookingConfirmation.ts` row). This checkout’s `CONTEXT.md` does not define Granot Booking Reconciliation Case / Booking / Granot Record Link / Entity Change — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: **one HTTP confirm caller, via the case barrel.** `routes/granot-lifecycle-admin.routes.ts` (`POST .../booking-cases/:id/confirm-booking` → `confirmBooking` imported from `bookingReconciliation.ts`, which re-exports this file; 201, or 200 on replay / `already_satisfied`; `requireRegistryOwnerActor` + one `Idempotency-Key`). Type-only: `bookingOwnerCommands.ts` and `referralBooking.ts` (`BookingOwnerCommandResult`). Tests: `bookingConfirmation.replica.test.ts` (AC-21 / AC-22 / AC-23 / AC-32 confirm: atomic mint, exact replay, checksum conflict, `already_satisfied`, inactive catalog rollback, simultaneous one-winner). The same replica file then seeds update / No Action from `bookingOwnerCommands.ts` — those are the next module, not this pass. Route unit stubs `deps.confirmBooking`. Not callers: `processor.ts`, `bookingReconciliation.ts` (re-export only), `createLeadFromGranot.ts`, `synchronizeLeadFromGranot.ts`, `bookingOwnerCommands.ts` (except the shared result type), `referralBooking.ts` (except the type), `bookings/bookedLead.service.ts`, public `/api/v1/booked-leads`, `canonicalDomainCommands` (this command is **not** on the registry object).
- Seams callers need: public confirm vs executor `operation` / after-commit `finalizeSheetSync` (manual; this file does not use `executeCanonicalCommandWithPostCommit`); mint vs `already_satisfied`; new Record Link vs command-owned CAS of `booking_ref`; Owner initiator vs processor actor from first evidence
- Split later (only if the file outgrows one sitting): keep one file — this ~560-line command is one screenplay for “confirm this Granot Job as an official Booking on the Lead the owner picked.” If it later splits: `mintTheOfficialBookingTheOwnerConfirmed.ts` / `attachThisJobToThatBooking.ts` / `projectTheBookingChainAfterConfirm.ts` — story files, never `create.ts` / `update.ts` / `apply.ts`, and never merge update / No Action / Referral mint into this file

`confirmBooking` / `applyConfirmation` are executor mechanics. The owner question is: *Granot booked this Job. We opened Owner work. The owner picked a Lead and typed official details. If Booking commands are on, the case is still open `create_missing_booking`, the revision still matches, the reviewed source is still active, and the Lead is still eligible: write one `BookedLead`, point the Lead at it, attach the Job, resolve the case. If that official Booking already exists with the same facts and the same link, just resolve the case. After commit, project the Booking Chain. Never CRM-post. Never upsert a Customer. Never replace official fields on a Booking we already have — that is the review command. Never mint a Referral. Public Book This Lead is a different origin. This file does not open the case. This file does not plan a Lead.*

Case open/refresh, update / No Action, Referral mint, public Book This Lead, and derived allocations already live in other **modules**. Do not pull those in.

## What this file actually does

Three operations of one confirm story, not “a booking CRUD service,” and not the case open / the official replace / the Referral mint / public Book This Lead:

1. **Mint the official Booking the owner confirmed — or recognize it already exists** — refuse a missing / non-owner actor, a missing idempotency key, or a case with no first-evidence Receipt / Observation / Decision. Inside the transaction: reread the case. Refuse unless it is still open `booked` / `create_missing_booking` at the expected `case_revision`, Booking commands are on, Source Scope is present, first evidence still names the same Observation / Decision, the reviewed Granot source + company + channel-matching granularity are still active, the selected Lead exists and is not Duplicate / Bad / cancelled, and Agents / Merchant are active. Out-of-scope Lead needs a 10–500 trimmed override. An incompatible active Record Link (wrong Booking or wrong source claim) is `IDENTITY_CONFLICT`. If a Booking already exists for this normalized Job: same official facts, same Lead, and a matching active link → resolve `already_satisfied` with no Change and no outbox; any mismatch → `IDENTITY_CONFLICT`. If the Lead is already booked, or another Booking hangs off that Lead, refuse. Otherwise insert one `BookedLead` (`is_referral_booking: false`, `is_leadless_booking: false`, source slug from the reviewed company, allocations from `officialBookingAllocations`, deposit thresholds from the typed Deposit). CAS the Lead `booked` pointer and thresholds. Remember three `EntityChange` rows (Booking from empty, Lead, Record Link). Resolve the case `booking_created`. Enqueue `booking_chain` / `booked_lead.create` in the same session. This function does not CRM-post. This function does not upsert a Customer. This function does not `$set` official fields on an existing Booking.

2. **Attach this Job to that Booking** — if no active Granot link exists, establish one that names this Lead, this Booking, and the case Source Scope. If an active link exists, ordinary model updates forbid `booking_ref`; this command uses a collection CAS (`state: "active"` + `domain_revision`) to set Lead + Booking and clear dispute. A lost CAS is `DOMAIN_REVISION_CONFLICT`. This function does not dispute. This function does not attach a second Job.

3. **After commit, project the Booking Chain onto sheets** — reload the durable command, resolved case, Booking, and link, or throw. `finalizeSheetSync` runs only when this attempt was not a replay **and** the case resolved `booking_created`. Replay and `already_satisfied` do not dispatch. This function does not persist the outbox after commit.

There is no fourth mutate operation. `loadCausalContext` / `loadActiveSourceScope` / `loadActiveCatalog` / `resolveCase` are beats, not public stories. Form and Call Lead persist are two **adapters** of one “point this Lead at the Booking” rule. The executor `operation` plus the manual after-commit finalize is the before-commit / after-commit **seam**, not a second public export. `BookingOwnerCommandResult` is the shared Owner-command envelope; this file only ever returns `booking_created` or `already_satisfied`.

## Organization

Keep one file as the screenplay for “the owner confirmed this Granot Job; mint the Booking on the Lead they picked, attach the Job, then tell sheets.” Case open, official replace, No Action, Referral mint, public Book This Lead, and even-cent split already live in deeper **modules**. Do not pull those in. Do not invent a `BookingConfirmationService` class. Do not invent a second `begin` / `complete` export — `executeIdempotentCanonicalCommand` plus the post-commit `finalizeSheetSync` already is that **seam**. Do not invent a write **seam** that has only one **adapter** here.

Do not move this into `bookingReconciliation.ts` so “knowledge lists both as primary code.” Do not move this into `bookedLead.service.ts` so “every Book This Lead is one write.” Do not merge this file into `bookingOwnerCommands.ts` so “one Owner command file.” Do not merge this file into `referralBooking.ts` so “one confirm.” Do not split `create.ts` / `apply.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `confirmBooking` | `confirmThisGranotJobAsAnOfficialBooking` | admin confirm’s only write |
| `ConfirmBookingInput` | `AConfirmTheOwnerMayCommit` | case + selected Lead + official details + owner + key |
| `BookingOwnerCommandResult` | `WhatTheOwnerCommandDid` | shared envelope for confirm / update / Referral / No Action |

Keep the old names as one-line aliases until the admin route and the case barrel migrate. Do not make callers learn `applyConfirmation` / `commandBody` / `persistLink` as the domain language.

**Principle: old exports stay as aliases.** `confirmBooking` remains the imported name until `granot-lifecycle-admin.routes.ts` and `bookingReconciliation.ts` point at the story name.

**No class for the workflow.** The type that *does* earn a name is the pending bag handed across commit:

```ts
type BookingConfirmInProgress = {
  outcome: "booking_created" | "already_satisfied"
  bookingId?: string
}
```

That is the handoff from “the Booking, Lead, link, and case are saved” to “project the Booking Chain only when we actually minted.” Do **not** add Customer upsert or CRM Posting so “confirm matches public Book This Lead,” and do **not** `$set` official fields on an existing Booking so “already_satisfied can correct.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// bookingConfirmation.ts
// Granot booked this Job. The owner picked a Lead and typed official details.
// Mint one BookedLead on that Lead. Attach the Job. Resolve the case.
// If the same official Booking already exists, just resolve the case.
// After commit, project the Booking Chain.
// Never CRM-post. Never upsert a Customer. Never replace official fields.
// This file does not open the case.
// This file does not mint a Referral.

// ── 1. Mint the official Booking the owner confirmed ──────

export async function confirmThisGranotJobAsAnOfficialBooking(input)
  refuseUnlessTheOwnerBroughtAKey()
  rememberTheFirstEvidenceAsCausalContext()
  // then executeIdempotentCanonicalCommand:
  //   beginTheConfirm(session)
  //   completeTheConfirmByProjectingTheBookingChain(pending)

async function beginTheConfirm(input, session, now)
  rereadTheOpenCreateMissingCase()
  refuseUnlessBookingCommandsAreOn()
  refuseUnlessTheReviewedSourceIsStillActive()
  refuseUnlessTheSelectedLeadIsEligible()
  requireAnOverrideWhenTheLeadIsOutOfScope()
  refuseIfTheLeadIsAlreadyCancelled()
  loadActiveAgentsAndMerchant()
  assertTheActiveLinkDoesNotClaimAnotherBooking()
  ifABookingAlreadyExistsForThisJob,
    resolveAlreadySatisfiedOrRefuseAConflict()
  refuseIfThisLeadAlreadyHasABooking()
  mintTheOfficialBookingFromTheOwnersDetails()
  pointTheLeadAtThatBooking()                     // CAS booked + thresholds
  attachThisJobToThatBooking()
  rememberThreeEntityChanges()
  resolveTheCaseBookingCreated()
  rememberSheetSyncIntent()

function mintTheOfficialBookingFromTheOwnersDetails(caseRow, lead, details)
  deriveAllocationsEvenly()                       // officialBookingAllocations
  stampSourceFromTheReviewedCompany()
  deriveDepositThresholds()
  saveIsReferralFalseAndIsLeadlessFalse()

function resolveAlreadySatisfiedOrRefuseAConflict(existing, link, input)
  ifSameOfficialFactsAndSameLeadAndMatchingLink,
    resolveTheCaseAlreadySatisfied()              // no Change, no outbox
  else refuseIdentityConflict()

// ── 2. Attach this Job to that Booking ───────────────────

async function attachThisJobToThatBooking(job, lead, booking)
  ifNoActiveLink, establishANewRecordLink()
  ifActiveLink, casBookingRefOnTheLink()          // model forbids ordinary booking_ref

// ── 3. After commit, project the Booking Chain ───────────

async function completeTheConfirmByProjectingTheBookingChain(pending)
  reloadTheCommittedCaseBookingAndLink()
  ifWeMintedAndThisIsNotAReplay, projectTheBookingChainOntoSheets()
```

Read the primary path out loud: *The processor already opened an Owner work case because Granot said this Job is booked. That case is not a Booking. The owner is looking at the case. They pick an eligible Lead — Duplicate, Bad, and cancelled are refused; all-scope needs a written override — and they type Book Date, one Binder, Deposit, Merchant, a primary Agent, and maybe a second Agent. Per-agent allocations are rejected; the server splits the Binder evenly. Booking commands are on. The case is still open `create_missing_booking` at the revision they drafted. The reviewed source is still active. First evidence still names the same Observation. Mint one `BookedLead` on that Lead, source slug from the reviewed company, referral and leadless false. Point the Lead at it. Attach the Job on an active Record Link — ordinary model updates cannot write `booking_ref`, so this command does. Remember three Changes and resolve the case. After commit, project the Booking Chain. If that official Booking already exists with the same facts, just resolve the case and do not dispatch sheets. Nobody CRM-posts. Nobody upserts a Customer. Nobody replaces official fields — that is the review command. Nobody mints a Referral. Nobody calls public Book This Lead.*

That is the operation. `confirmBooking` is not a CRUD create. `applyConfirmation` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Command-door gates are required; the route already checked the owner.** The route requires `requireRegistryOwnerActor` and one `Idempotency-Key`. This file still asserts owner + key, then rereads case mode / revision / flag / source / Lead / catalogs inside the transaction. That is two **adapters**, not a duplicate to delete. Do not drop the door so “the route already authorized,” and do not skip the route gate so “the command can take a raw confirm.”

2. **`already_satisfied` is not an update.** Same official facts + same Lead + matching link resolves the case with zero Changes and zero outbox. A deposit off by a cent is `IDENTITY_CONFLICT`, not a correction. Do not `$set` official fields so “confirm can also review,” and do not treat a mismatch as `already_satisfied` so “the Job is already booked.”

3. **The shared result type lies about this file.** `BookingOwnerCommandResult.outcome` includes `booking_updated` / `referral_booking_created` / `no_action`. After commit this file remaps anything that is not `already_satisfied` to `booking_created`. Do not start returning those sibling outcomes from confirm so “the union is honest,” and do not move the type into a `types.ts` CRUD folder. Leave the envelope here until update / Referral / No Action migrate; then the type can follow the last caller.

4. **`booking_ref` is a command-owned CAS, not a model save.** The comment is the **seam**: ordinary Record Link updates intentionally forbid `booking_ref`. `persistLink` uses `collection.updateOne` on `_id` + `state: "active"` + `domain_revision`. Do not switch to `findByIdAndUpdate` so “one Mongoose write,” and do not lift that CAS into `synchronizeLeadFromGranot` so “one link writer.” Establish-only mint refuses an existing link; confirm must fill `booking_ref`.

5. **This file wraps a second 11000 retry around an executor that already handles 11000.** `executeIdempotentCanonicalCommand` already reloads a duplicate-key and returns the durable row when name/checksum agree. The outer `for attempt < 2` catches 11000 and retries the whole execute. Do not delete the inner executor handling so “this file owns replay,” and do not silently drop the outer loop without a race test that still keeps one Booking.

6. **Finalize is manual, not `executeCanonicalCommandWithPostCommit`.** Create-Lead uses the helper. Confirm reloads evidence, then calls `finalizeSheetSync` only for non-replay `booking_created`. Knowledge says Sheet delivery is post-commit only; intent stays in-session. Do not move `finalizeSheetSync` inside `applyConfirmation` so “the projection is atomic,” and do not dispatch on `already_satisfied` or replay so “the case resolved.”

7. **Confirm does not upsert a Customer and does not CRM-post.** Public Book This Lead upserts a Customer and may tell other systems. This command snapshots `customer_name` from the Lead and stops. Do not call `upsertCustomer` so “every Booking has a Customer row,” and do not call `createBookedLead` so “one Book This Lead write.”

8. **Source slug comes from the reviewed company, not the Lead’s original `source_company`.** Replica locks the Lead’s original source / granularity / origin / CPL unchanged. The Booking `source` is the reviewed `company_slug`. Do not copy the Lead’s landing-page source onto the Booking so “the Lead is the source of truth,” and do not `$set` the Lead source so “they match.”

9. **Official details reject `agent_allocations[]`; this file derives them.** `officialBookingAllocations` even-cent splits Binder across primary / optional secondary. Do not accept a caller allocation list so “the owner typed the split,” and do not pull `splitBinderEvenly` into this file so “one allocation writer.”

10. **Deposit thresholds are derived twice.** Booking stores `over_2000` / `over_4000` from the typed Deposit. The Lead CAS copies those two flags. Do not derive them again on the Lead from a different number, and do not skip the Lead mirror so “the Booking already has them.”

11. **Lead CAS is the eligibility filter, not a second eligibility story.** Insert filter requires not Duplicate, not booked, not cancelled, and Form `bad_lead` empty. A lost match is `DOMAIN_REVISION_CONFLICT`. Do not `$set` without those predicates so “we already checked,” and do not treat a lost CAS as `already_satisfied`.

12. **`confirmGranotBooking` is not on `canonicalDomainCommands`.** Domain-commands knowledge lists this module as an executor caller that is missing from the registry object. Do not add it to the registry in this rename so “every command is registered,” and do not route confirm through `createBookingFromLead` so “one Booking command.”

13. **Knowledge lists this file under the case persist.** `booking-reconciliation.md` Primary code is open/refresh + pairing + this confirm + update / No Action + Referral + processor. This file does not open a case and does not replace official fields. Do not move it into `bookingReconciliation.ts` so the Primary-code line “wins,” and do not start opening cases here so “confirm can create the work.”

14. **The replica file tests three Owner commands.** `bookingConfirmation.replica.test.ts` locks confirm, then seeds `updateExistingBooking` and `noAction`. Those are the next module. Do not pull update / No Action into this file so “the test file is the module,” and do not drop those cases until the next pass owns them.

15. **Leave sibling modules alone.** Case open stays in `bookingReconciliation.ts`. Update / No Action stay in `bookingOwnerCommands.ts`. Referral mint stays in `referralBooking.ts`. Even-cent split stays in `agents/agentAllocation.service.ts`. Public Book This Lead stays in `bookings/bookedLead.service.ts`. Executor / `EntityChange` stay in `domainCommands/`. Sheet finalize stays in `sheetSync`. ObjectId construction stays in `utils/objectId.ts`.

16. **Do not treat public Book This Lead, Referral mint, official replace, case open, or drain as this story.** Those write a Booking from a Mongo Lead id, mint a no-Lead Referral, replace official fields, open Owner work, or claim a receipt. This file only confirms an open create-missing case.

17. **Do not write a whole-folder recommendation for `granotLifecycle`.**

## Testing

The **interface** is the test surface: `confirmThisGranotJobAsAnOfficialBooking` (today `confirmBooking`). `ConfirmBookingInput` and `BookingOwnerCommandResult` are part of that **interface**. There is no `bookingConfirmation.test.ts`. `bookingConfirmation.replica.test.ts` is the real proof for confirm — and it also seeds the next module’s update / No Action. Keep the confirm cases. Add command-level names for the gaps (replica may stay the Mongo proof):

**Mint the official Booking the owner confirmed**
- Concurrent same-case confirms commit one Booking, one command, three Changes, one outbox (already locked).
- Exact replay returns the same command id and does not add Changes or outbox (already locked).
- Same key / different official Deposit is `DOMAIN_COMMAND_IDEMPOTENCY_CONFLICT` and creates no second Booking (already locked).
- Inactive Agent / Merchant leaves Booking, link, command, Changes, and case-open invisible (already locked).
- Same official Booking + matching link on a later create-missing case is `already_satisfied` with zero Changes (already locked).
- Duplicate / Bad / cancelled / already-booked Lead is `IDENTITY_CONFLICT` (add these; today’s replica only seeds a clean Form).
- Out-of-scope Lead without a 10–500 override is `VALIDATION_FAILED`; with override it mints (add both).
- Flag-off is `POLICY_BLOCKED` and writes nothing (add this; today’s replica always injects `booking_commands_enabled: true`).
- Stale `case_revision` or `review_existing_booking` mode is `CASE_REVISION_CONFLICT` (add mode refuse; today’s confirm never hits review-existing except as a later update seed).
- Lead original source / origin / CPL stay unchanged; Booking `source` is the reviewed slug (already locked).
- Observed estimate / payment / balance never become Deposit or Binder (already locked: Deposit is 2500.5, not 111.11).

**Attach this Job to that Booking**
- No active link → establish + `booking_ref` (already locked by the mint path).
- Pre-existing compatible lead-only link receives `booking_ref` via CAS (add this; today’s seed has no link before confirm).
- Incompatible `booking_ref` or source claim is `IDENTITY_CONFLICT` (add this).
- Do not add a test that this file disputes a link or attaches a second Job.

**After commit, project the Booking Chain**
- `booked_lead.create` intent is remembered before commit; `finalizeSheetSync` runs after a non-replay mint (replica outbox count already locked).
- Replay and `already_satisfied` do not dispatch a second job (already locked).
- Do not add a test that finalize runs inside the transaction.

Do **not** add a test per helper (`cents`, `validOverride`, `leadDisplayName`, `commandBody`, `sameOfficialBooking`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test official replace, No Action, Referral mint, case open/refresh, or public Book This Lead here. Do not add a test that this file upserts a Customer, CRM-posts, or `$set`s official fields on an existing Booking. Do not add a test that confirm lives in `bookingOwnerCommands.ts`.

## What I would not do

- A `BookingConfirmationService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `save`.
- Moving this into a CRUD folder, or into `bookingReconciliation.ts` / `bookingOwnerCommands.ts` / `bookedLead.service.ts` / `referralBooking.ts` “for cleanliness.”
- Splitting `create.ts` / `apply.ts` / `link.ts`.
- Calling `createBookedLead` or upserting a Customer so “one Book This Lead write.”
- `$set`ting official fields on an existing Booking so “confirm can also review.”
- Dispatching sheets on replay or `already_satisfied`.
- Opening the case from this file so “confirm can create the work.”
- Writing a whole-folder recommendation for `granotLifecycle`.
