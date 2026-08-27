# Mint This No-Lead Referral From The Accepted Granot Job — operational story

- Status: recommended
- Service: `granotLifecycle` (Wave A, in-progress)
- Pass: 26 of this service — `referralBooking.ts`
- Remaining in this service: `releaseReconciliation.ts` and the rest of the `granotLifecycle` checklist in TRAVERSAL.md
- Target: `src/services/granotLifecycle/referralBooking.ts`
- Knowledge: [`docs/knowledge/granot-lifecycle/booking-reconciliation.md`](../../../docs/knowledge/granot-lifecycle/booking-reconciliation.md) lists this file as primary code beside `bookingReconciliation.ts`, `bookingPriorityPairing.ts`, `bookingConfirmation.ts`, `bookingOwnerCommands.ts`, the case model, and `processor.ts` — they are siblings, not this pass. Owner Referral mint, booking-only Record Link, and post-commit master sheet: same file. Executor / `EntityChange` / “this command *is* on the registry object”: [`docs/knowledge/services/domain-commands.md`](../../../docs/knowledge/services/domain-commands.md) (`canonicalDomainCommands.createReferralBooking` → `createReferralBookingCanonical`). Flags: [`docs/knowledge/granot-lifecycle/revisions.md`](../../../docs/knowledge/granot-lifecycle/revisions.md) (`GRANOT_LIFECYCLE_BOOKING_COMMANDS_ENABLED` **and** `GRANOT_LIFECYCLE_REFERRAL_BOOKING_ENABLED`). Derived allocations: [`docs/knowledge/services/agent-allocation.md`](../../../docs/knowledge/services/agent-allocation.md). Distinct from opening the case: [recommendations/granot-lifecycle-booking-reconciliation.md](granot-lifecycle-booking-reconciliation.md). Distinct from minting a Booking on a Lead: [recommendations/granot-lifecycle-booking-confirmation.md](granot-lifecycle-booking-confirmation.md). Distinct from official replace / No Action (including Referral review): [recommendations/granot-lifecycle-booking-owner-commands.md](granot-lifecycle-booking-owner-commands.md). Distinct from public no-Lead Referral: [recommendations/bookings-referral-booking.md](bookings-referral-booking.md). Distinct from Leadless: [recommendations/bookings-leadless-booking.md](bookings-leadless-booking.md). Distinct from pairing: [recommendations/granot-lifecycle-booking-priority-pairing.md](granot-lifecycle-booking-priority-pairing.md). Software map: `.cursor/rules/granot-lifecycle-capture.mdc` (`referralBooking.ts` row). This checkout’s `CONTEXT.md` does not define Referral Booking / Granot Booking Reconciliation Case / Granot Record Link / Entity Change — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: **one HTTP caller via the case barrel, plus the registry adapter.** `routes/granot-lifecycle-admin.routes.ts` (`POST .../booking-cases/:id/create-referral-booking` → `createReferralBooking` imported from `bookingReconciliation.ts` as `createGranotReferralBooking`; 201, or 200 on replay / `already_satisfied`; `requireRegistryOwnerActor` + one `Idempotency-Key`). Registry: `domainCommands/index.ts` (`canonicalDomainCommands.createReferralBooking` → `createReferralBookingCanonical`). Type-only: `bookingConfirmation.ts` (`BookingOwnerCommandResult`). Tests: `referralBooking.test.ts` (AC-28: persisted name + non-owner refuse before storage). Replica proof: `referralBooking.replica.test.ts` (AC-28 / AC-32: atomic mint, exact replay, checksum conflict, `already_satisfied`, competing Owners, mint-versus-No-Action one winner, policy drift, incompatible link, injected-boundary rollback; then seeds `updateExistingBooking` / `noAction` from `bookingOwnerCommands.ts` — those are the previous module). Route unit stubs `deps.createReferralBooking`. Ingestion tests mock registry `createReferralBooking` — that is this file’s canonical, not `bookings/referralBooking.service.ts`. Not callers: `processor.ts`, `bookingReconciliation.ts` (re-export only), `bookingConfirmation.ts` (owns the shared result type), `bookingOwnerCommands.ts` (except the replica that calls this file first), `bookings/referralBooking.service.ts`, `domainCommands/existingWrites.ts` (`createExistingReferralBooking` is the public origin), public `POST /api/v1/referral-bookings`.
- Seams callers need: admin mint vs registry `createReferralBookingCanonical` (same `applyReferralBooking`; only admin finalizes sheets); mint vs `already_satisfied`; new booking-only Record Link vs command-owned CAS of `booking_ref` with no Lead / no Source Scope; Owner initiator vs processor actor from first evidence; this Granot command vs public `bookAReferral`
- Split later (only if the file outgrows one sitting): keep one file — this ~545-line command is one screenplay for “mint this no-Lead Referral from the accepted Granot Job.” If it later splits: `mintThisNoLeadReferralFromTheAcceptedGranotJob.ts` / `attachThisJobToThatReferralBooking.ts` / `projectTheMasterBookedSheetAfterMint.ts` — story files, never `create.ts` / `apply.ts` / `link.ts`, and never merge confirm / official replace / public Referral into this file

`createReferralBooking` / `createReferralBookingCanonical` / `applyReferralBooking` are executor mechanics. The owner question is: *Granot booked this Job from a reviewed Referral source. There is no Lead and there must never be one. We opened Owner work in `create_referral_booking`. The owner typed official details only — Book Date, one Binder, Deposit, Merchant, a primary Agent, maybe a second Agent. If Booking commands and Referral are both on, the case is still open at the revision they drafted, first evidence still names the same Booked Observation / live Decision, and the reviewed Referral source is still active with no Source Scope: mint one `BookedLead` stamped Referral, attach a booking-only Record Link, resolve the case. After commit, project the Master Booked sheet. If that exact Referral Booking already exists with a matching link, just resolve the case. Never attach a Lead. Never CRM-post. Never upsert a Customer. Never confirm onto a Lead. Never call public `POST /api/v1/referral-bookings`. This file does not open the case. This file does not review an existing Referral.*

Case open/refresh, Lead-attached confirm, official replace / No Action, public Referral, and derived allocations already live in other **modules**. Do not pull those in.

## What this file actually does

Three operations of one Owner Referral-mint story, not “a booking CRUD service,” and not the case open / the Lead-attached confirm / the official replace / public Book A Referral:

1. **Mint the no-Lead Referral Booking the owner authorized — or recognize it already exists** — refuse a missing / non-owner actor, a missing idempotency key, or a case with no first-evidence Receipt / Observation / Decision. Inside the transaction: reread the case. Refuse unless it is still open `booked` / `create_referral_booking` at the expected `case_revision`, **both** Booking-command and Referral flags are on, the case has no `source_scope` and no `suggested_lead`, first evidence still names the same Observation / Decision, the accepted Observation is an actual Booked row for this Job with a raw Job Number captured after activation, the Decision is live and still points at that Observation, and the reviewed Granot source is still enabled `referral_booking` / `observation_only` / no company / empty routes at the Decision’s policy version. Agents / Merchant must still be active. If a Booking already exists for this normalized Job: it must already be a Referral (`is_referral_booking`, `source: "referral"`, not leadless, no `lead_ref` / `lead_model`) with a matching active booking-only link and the same official facts → resolve `already_satisfied` with no Change and no outbox; any mismatch → `IDENTITY_CONFLICT`. Otherwise insert one `BookedLead` (`is_referral_booking: true`, `is_leadless_booking: false`, `source: "referral"`, no Lead pointer, allocations from `officialBookingAllocations`, deposit thresholds from the typed Deposit, `customer_name` from the Observation contact, `job_no` from the Observation raw Job). Remember two `EntityChange` rows (Booking from empty, Record Link). Resolve the case `referral_booking_created`. Enqueue `booked_lead` / `referral_booking.create` in the same session. This function does not CRM-post. This function does not upsert a Customer. This function does not `$set` official fields on an existing Booking. This function does not write a Lead Change.

2. **Attach this Job to that Referral Booking** — if no active Granot link exists, establish one that names this Booking and this Job and never a Lead or Source Scope. If an active link exists, ordinary model updates forbid `booking_ref`; this command uses a collection CAS (`state: "active"` + `domain_revision`) to set Booking and clear dispute. A leftover Lead pointer, Source Scope, existing `booking_ref`, or dispute is `IDENTITY_CONFLICT` before the write. A lost CAS is `DOMAIN_REVISION_CONFLICT`. This function does not dispute. This function does not attach a second Job. This function does not write `lead_ref`.

3. **After commit, project the Master Booked sheet only when we actually minted** — reload the durable command, resolved case, Booking, and link, or throw. `finalizeSheetSync` runs only when this attempt was not a replay **and** the case resolved `referral_booking_created`. Replay and `already_satisfied` do not dispatch. The planner targets only `master_booked`. This function does not persist the outbox after commit. The registry adapter does not call this beat at all.

There is no fourth mutate operation. `loadCausalContext` / `loadActiveCatalog` / `resolveCase` / `sameOfficialBooking` are beats, not public stories. Admin mint and registry mint are two **adapters** of one “mint this no-Lead Referral” rule. New link vs command-owned CAS are two **adapters** of one “attach this Job with no Lead” rule. The executor `operation` plus the manual after-commit finalize is the before-commit / after-commit **seam**, not a second public export. `BookingOwnerCommandResult` is the shared Owner-command envelope; this file returns `referral_booking_created` or `already_satisfied`.

## Organization

Keep one file as the screenplay for “the owner authorized this Granot Referral Job; mint the no-Lead Booking, attach the Job with no Lead, then tell the Master Booked sheet.” Case open, Lead-attached confirm, official replace / No Action, public Referral, and even-cent split already live in deeper **modules**. Do not pull those in. Do not invent a `ReferralBookingService` class. Do not invent a second `begin` / `complete` export — `executeIdempotentCanonicalCommand` plus the post-commit `finalizeSheetSync` already is that **seam**. Do not invent a write **seam** that has only one **adapter** here — admin and registry already are two.

Do not move this into `bookingReconciliation.ts` so “knowledge lists both as primary code.” Do not move this into `bookingConfirmation.ts` so “one confirm.” Do not move this into `bookingOwnerCommands.ts` so “Referral review lives with Referral mint.” Do not move this into `bookings/referralBooking.service.ts` so “one Referral write.” Do not split `create.ts` / `apply.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `createReferralBooking` | `mintThisNoLeadReferralFromTheAcceptedGranotJob` | admin mint’s write + after-commit master sheet |
| `createReferralBookingCanonical` | `mintThisNoLeadReferralAsACanonicalCommand` | registry `canonicalDomainCommands.createReferralBooking`; no sheet finalize |
| `ReferralBookingInput` | `AReferralMintTheOwnerMayCommit` | case + revision + official details + owner + key |
| `CREATE_REFERRAL_BOOKING_COMMAND_NAME` | keep — persisted `createReferralBooking` | durable command name; do not “fix” the collision with public `createExistingReferralBooking` |

Keep the old names as one-line aliases until the admin route, the case barrel, and `canonicalDomainCommands` migrate. Do not make callers learn `applyReferralBooking` / `commandBody` / `persistReferralLink` as the domain language.

**Principle: old exports stay as aliases.** `createReferralBooking` and `createReferralBookingCanonical` remain the imported names until `granot-lifecycle-admin.routes.ts`, `bookingReconciliation.ts`, and `domainCommands/index.ts` point at the story names.

**No class for the workflow.** The type that *does* earn a name is the pending bag handed across commit:

```ts
type ReferralMintInProgress = {
  outcome: "referral_booking_created" | "already_satisfied"
  bookingId?: string
}
```

That is the handoff from “the Referral Booking, booking-only link, and case are saved” to “project the Master Booked sheet only when we actually minted.” Do **not** add Customer upsert or CRM Posting so “Referral matches public Book A Referral,” do **not** write `lead_ref` so “every Booking has a Lead,” and do **not** `$set` official fields on an existing Booking so “already_satisfied can correct.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// referralBooking.ts
// Granot booked this Job from a reviewed Referral source.
// There is no Lead and there must never be one.
// The owner typed official details only.
// Mint one BookedLead stamped Referral. Attach the Job
// with no Lead and no Source Scope. Resolve the case.
// If that exact Referral Booking already exists, just resolve the case.
// After commit, project the Master Booked sheet.
// Never CRM-post. Never upsert a Customer. Never confirm onto a Lead.
// This file does not open the case.
// This file does not review an existing Referral.
// This file does not book a public Referral.

// ── 1. Mint the no-Lead Referral the owner authorized ─────

export async function mintThisNoLeadReferralFromTheAcceptedGranotJob(input)
  refuseUnlessTheOwnerBroughtAKey()
  rememberTheFirstEvidenceAsCausalContext()
  // then executeIdempotentCanonicalCommand:
  //   beginTheReferralMint(session)
  //   completeTheMintByProjectingTheMasterBookedSheet(pending)

export async function mintThisNoLeadReferralAsACanonicalCommand(input)
  refuseUnlessTheOwnerIsOnTheContext()
  refuseUnlessTheContextAlreadyNamesTheCase()
  rereadTheCaseAndRefuseAJobOrObservationMismatch()
  // then the same beginTheReferralMint — no sheet finalize

async function beginTheReferralMint(input, session, now)
  rereadTheOpenCreateReferralCase()
  refuseUnlessBookingCommandsAndReferralAreOn()
  refuseIfTheCaseHasSourceScopeOrASuggestedLead()
  refuseUnlessFirstEvidenceStillMatches()
  refuseUnlessTheAcceptedObservationIsThisJobsBookedRow()
  refuseUnlessTheDecisionIsLiveAndStillPointsAtIt()
  refuseUnlessTheReviewedReferralSourceIsStillActive()
  loadActiveAgentsAndMerchant()
  ifABookingAlreadyExistsForThisJob,
    resolveAlreadySatisfiedOrRefuseAConflict()
  assertTheActiveLinkDoesNotClaimALeadOrAnotherBooking()
  mintTheReferralBookingFromTheOwnersDetails()
  attachThisJobToThatReferralBooking()
  rememberTwoEntityChanges()                      // BookedLead + GranotRecordLink
  resolveTheCaseReferralBookingCreated()
  rememberMasterBookedSheetSyncIntent()

function mintTheReferralBookingFromTheOwnersDetails(observation, details)
  takeCustomerNameFromTheObservationContact()     // not from the owner body
  takeJobNumberFromTheObservationRawJob()
  deriveAllocationsEvenly()                       // officialBookingAllocations
  stampSourceReferral()
  saveIsReferralTrueAndIsLeadlessFalse()
  deriveDepositThresholdsFromTheTypedDeposit()
  doNotCopyObservedEstimateOrPayment()

function resolveAlreadySatisfiedOrRefuseAConflict(existing, link, input)
  ifSameOfficialFactsAndMatchingReferralLink,
    resolveTheCaseAlreadySatisfied()              // no Change, no outbox
  else refuseIdentityConflict()

// ── 2. Attach this Job to that Referral Booking ──────────

async function attachThisJobToThatReferralBooking(job, booking)
  ifNoActiveLink, establishABookingOnlyRecordLink()
  ifActiveLink, casBookingRefOnTheLink()          // never lead_ref / source_scope

// ── 3. After commit, project the Master Booked sheet ─────

async function completeTheMintByProjectingTheMasterBookedSheet(pending)
  reloadTheCommittedCaseBookingAndLink()
  ifWeMintedAndThisIsNotAReplay, projectTheMasterBookedSheet()
```

Read the primary path out loud: *The processor already opened Owner work because Granot said this Job is booked and the reviewed source is Referral. That case is not a Booking. There is no Lead suggestion and there must never be a Lead. The owner is looking at the case. They type Book Date, one Binder, Deposit, Merchant, a primary Agent, and maybe a second Agent. Per-agent allocations are rejected; the server splits the Binder evenly. They do not type a Job Number, a customer, a source, or a Lead. Booking commands and Referral are both on. The case is still open `create_referral_booking` at the revision they drafted. First evidence still names the same Booked Observation. The reviewed Referral source is still active with no company and no routes. Mint one `BookedLead` stamped Referral, customer name from the Observation, Job Number from the Observation, referral true and leadless false. Attach a booking-only Record Link — ordinary model updates cannot write `booking_ref`, so this command does, and it never writes a Lead pointer. Remember two Changes and resolve the case. After commit, project the Master Booked sheet. If that exact Referral Booking already exists with a matching link, just resolve the case and do not dispatch sheets. Nobody CRM-posts. Nobody upserts a Customer. Nobody confirms onto a Lead. Nobody calls public Book A Referral. Nobody reviews official fields — that is the next case’s update command.*

That is the operation. `createReferralBooking` is not a CRUD create. `applyReferralBooking` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This `createReferralBooking` is not public Book A Referral.** `bookings/referralBooking.service.ts` takes an owner-typed Job Number and customer, refuses a raw `job_no` collision, upserts a Customer, and is reached as `createExistingReferralBooking`. This file takes a case id, derives Job and customer from the accepted Observation, and needs both lifecycle flags. Same English name, two origins. Do not call `createReferralBookingInTransaction` so “one Referral write,” and do not delete the public file so “Granot already mints Referrals.”

2. **The registry adapter never finalizes sheets.** `createReferralBookingCanonical` runs the same `applyReferralBooking` (intent stays in-session) and returns `outcome.result`. Only the admin export reloads evidence and calls `finalizeSheetSync`. Knowledge says Sheet delivery is post-commit only. Do not move `finalizeSheetSync` inside `applyReferralBooking` so “the projection is atomic,” and do not add finalize to the registry adapter in this rename so “both adapters complete” — that is a tested after-commit change, not a rename. Do not switch this file to `executeCanonicalCommandWithPostCommit` so “Create-Lead already has the helper.”

3. **Command-door gates are required; the route already checked the owner.** The route requires `requireRegistryOwnerActor` and one `Idempotency-Key`. This file still asserts owner + key, then rereads case mode / revision / both flags / Referral source / catalogs inside the transaction. That is two **adapters**, not a duplicate to delete. Do not drop the door so “the route already authorized,” and do not skip the route gate so “the command can take a raw mint.”

4. **`already_satisfied` is not an update.** Same official facts + matching Referral Booking + matching booking-only link resolves the case with zero Changes and zero outbox. A deposit off by a cent is `IDENTITY_CONFLICT`, not a correction — like confirm, unlike review. Do not `$set` official fields so “mint can also review,” and do not treat a mismatch as `already_satisfied` so “the Job is already booked.”

5. **Referral is `is_leadless_booking: false` even though there is no Lead.** Leadless is a different origin (`bookings/leadlessBooking.service.ts`). Replica AC-28 locks `is_referral_booking: true`, `is_leadless_booking: false`, empty `lead_ref` / `lead_model`. Do not stamp leadless true so “no Lead means Leadless,” and do not attach a Lead so “every Booking has a pointer.”

6. **`booking_ref` is a command-owned CAS, not a model save.** Same **seam** as confirm: ordinary Record Link updates intentionally forbid `booking_ref`. `persistReferralLink` uses `collection.updateOne` on `_id` + `state: "active"` + `domain_revision`. The Referral CAS never writes `lead_ref` or `source_scope`. Do not switch to `findByIdAndUpdate` so “one Mongoose write,” do not lift that CAS into confirm so “one link writer,” and do not copy confirm’s Lead + Source Scope `$set` so “every attach looks the same.”

7. **Customer name and Job Number come from the Observation, not the owner body.** The Zod body is exactly `{ expected_case_revision, official_booking_details }`. Replica locks `customer_name` from `contact.display_name` and `job_no` from `identity.job_no_raw`. Observed estimate / payment / balance never become Deposit or Binder (Deposit is 2500.5, not 111.11). Do not accept a caller customer / Job / source so “Referral matches public Book A Referral,” and do not copy financials so “Granot already priced it.”

8. **Source is the literal `"referral"`, not a reviewed company slug.** Confirm stamps source from the reviewed company. This file hard-codes `source: "referral"`. The reviewed Referral row has `lead_source_company: null`. Do not copy a company slug so “confirm and Referral match,” and do not invent a Source Scope so “every Booking case has one.”

9. **Two Changes, never a Lead Change.** Confirm remembers three (Booking, Lead, link). This file remembers Booking from empty and the link only. Replica AC-28 locks count `2`. Do not add a Lead Change so “the envelope matches confirm,” and do not skip the link Change so “we only minted a Booking.”

10. **This file wraps a second 11000 retry around an executor that already handles 11000 — on the admin adapter only.** `executeIdempotentCanonicalCommand` already reloads a duplicate-key. The admin export’s outer `for attempt < 2` retries the whole execute. The registry adapter has no outer loop. Do not delete the inner executor handling so “this file owns replay,” do not silently drop the admin loop without a race test that still keeps one Booking, and do not add the loop to the registry adapter so “both adapters match” without that same race test.

11. **The registry adapter rereads `expected_case_revision` from the live case.** Admin uses the owner-drafted revision. Canonical rebuilds `ownerInput.expected_case_revision` from `caseRow.case_revision` after checking Job + first Observation. That is a real **seam**: registry callers do not send a draft revision. Do not make admin ignore the owner revision so “canonical wins,” and do not make canonical require `expected_case_revision` so “one input type.”

12. **`createReferralBooking` is on `canonicalDomainCommands`; confirm and update are not.** Domain-commands knowledge already lists this file as the registry Referral. Confirm / Owner update / No Action still call the executor without a registry row. Do not remove this file from the registry so “Owner Booking commands match,” and do not add confirm / update in this rename so “every command is registered.”

13. **Knowledge lists this file under the case persist.** `booking-reconciliation.md` Primary code is open/refresh + pairing + confirm + update / No Action + this mint + processor. This file does not open a case and does not replace official fields. Do not move it into `bookingReconciliation.ts` so the Primary-code line “wins,” and do not start opening cases here so “mint can create the work.”

14. **The replica file tests this mint, then seeds the previous module.** `referralBooking.replica.test.ts` locks mint first, then `updateExistingBooking` / `noAction` on a later `review_existing_booking` / leftover `create_referral_booking`. Those review / No Action cases already belong to [recommendations/granot-lifecycle-booking-owner-commands.md](granot-lifecycle-booking-owner-commands.md). Do not pull official replace / No Action into this file so “the test file is the module,” and do not drop those seeds.

15. **Injected failure points are a test seam, not a product export.** `test_fail_after` exists so replica AC-32 can abort after booking, link, Changes, case, or outbox and prove the transaction hides all of it. Do not delete the hooks so “runtime has no test flags,” and do not promote them onto the public **interface**.

16. **Leave sibling modules alone.** Case open stays in `bookingReconciliation.ts`. Confirm stays in `bookingConfirmation.ts`. Official replace / No Action stay in `bookingOwnerCommands.ts`. Public Referral stays in `bookings/referralBooking.service.ts`. Even-cent split stays in `agents/agentAllocation.service.ts`. Executor / `EntityChange` stay in `domainCommands/`. Sheet finalize stays in `sheetSync`. ObjectId construction stays in `utils/objectId.ts`. Pairing stays in `bookingPriorityPairing.ts`.

17. **Do not treat Lead-attached confirm, official replace, case open, public Book A Referral, Leadless, or drain as this story.** Those mint a Booking on a Lead, replace official fields, open Owner work, book an owner-typed Job, stamp leadless, or claim a receipt. This file only mints a no-Lead Referral on an open `create_referral_booking` case.

18. **Do not write a whole-folder recommendation for `granotLifecycle`.**

## Testing

The **interface** is the test surface: `mintThisNoLeadReferralFromTheAcceptedGranotJob` (today `createReferralBooking`) and `mintThisNoLeadReferralAsACanonicalCommand` (today `createReferralBookingCanonical`). `ReferralBookingInput` is part of that **interface**. `referralBooking.test.ts` only locks the persisted name and a non-owner refuse before storage. `referralBooking.replica.test.ts` is the real proof for mint — and it also seeds the previous module’s Referral review / Referral No Action. Keep the mint cases. Add command-level names for the gaps (replica may stay the Mongo proof):

**Mint the no-Lead Referral the owner authorized**
- Concurrent same-case mints commit one Booking, one command, two Changes, one outbox (already locked).
- Exact replay returns the same command id and does not add Changes or outbox (already locked).
- Same key / different official Deposit is `DOMAIN_COMMAND_IDEMPOTENCY_CONFLICT` and creates no second Booking (already locked).
- Same official Referral + matching link on a later create-referral case is `already_satisfied` with zero Changes (already locked).
- Mint versus No Action on the same case-revision commits one Command (already locked).
- Disabled Referral source is `POLICY_BLOCKED` and leaves Booking / link / command / case-open invisible (already locked).
- Active link that already names a Lead is `IDENTITY_CONFLICT` and writes no Booking (already locked).
- Injected failure after booking / link / Changes / case / outbox leaves Booking, link, case-open, Command, Changes, and outbox invisible (already locked).
- `is_referral_booking: true`, `is_leadless_booking: false`, empty `lead_ref` / `lead_model`, `source: "referral"` (already locked).
- Observed estimate / payment / balance never become Deposit or Binder (already locked: Deposit is 2500.5, not 111.11).
- Customer name is the Observation display name (already locked).
- Flag-off (either Booking commands or Referral) is `POLICY_BLOCKED` and writes nothing (add this; today’s replica always injects both true).
- Stale `case_revision`, `create_missing_booking`, or `review_existing_booking` mode is `CASE_REVISION_CONFLICT` (add mode refuse; today’s mint never hits those modes except as a later review seed).
- A case with `source_scope` or `suggested_lead` is `CASE_REVISION_CONFLICT` (add this).
- Inactive Agent / Merchant is `VALIDATION_FAILED` (add this).
- Non-owner is `OWNER_REQUIRED` before storage (already locked in the unit).
- Do not add a test that this file writes a Lead Change or upserts a Customer.

**Attach this Job to that Referral Booking**
- No active link → establish booking-only + `booking_ref` (already locked by the mint path).
- Pre-existing compatible empty link receives `booking_ref` via CAS and stays lead-less (add this; today’s happy path has no link before mint).
- Incompatible `lead_ref` / `source_scope` / existing `booking_ref` is `IDENTITY_CONFLICT` (lead-ref already locked).
- Do not add a test that this file writes `lead_ref` or Source Scope.

**After commit, project the Master Booked sheet**
- `referral_booking.create` intent is remembered before commit; `finalizeSheetSync` runs after a non-replay mint; planner targets only `master_booked` (already locked).
- Replay and `already_satisfied` do not dispatch a second job (already locked).
- The registry adapter does not finalize (add this; today’s replica only calls the admin export).
- Do not add a test that finalize runs inside the transaction.

Do **not** add a test per helper (`cents`, `sameOfficialBooking`, `commandBody`, `failAfter`, `assertStableEvidence`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test Lead-attached confirm, official replace, No Action, case open/refresh, or public Book A Referral here. Do not add a test that this file upserts a Customer, CRM-posts, or `$set`s official fields on an existing Booking. Do not add a test that mint lives in `bookings/referralBooking.service.ts`.

## What I would not do

- A `ReferralBookingService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `save`.
- Moving this into a CRUD folder, or into `bookingReconciliation.ts` / `bookingConfirmation.ts` / `bookingOwnerCommands.ts` / `bookings/referralBooking.service.ts` / `leadlessBooking.service.ts` “for cleanliness.”
- Splitting `create.ts` / `apply.ts` / `link.ts`.
- Calling `createReferralBookingInTransaction` or upserting a Customer so “one public Referral write.”
- Writing `lead_ref` or stamping `is_leadless_booking: true` so “no Lead means Leadless.”
- `$set`ting official fields on an existing Booking so “mint can also review.”
- Dispatching sheets on replay or `already_satisfied`.
- Moving `finalizeSheetSync` inside the transaction so “the projection is atomic.”
- Opening the case from this file so “mint can create the work.”
- Writing a whole-folder recommendation for `granotLifecycle`.
