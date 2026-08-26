# Show The Owner The Work Queue, One Case, The Attachable Leads, The Job Story, And Whether The Machine Is Alive — operational story

- Status: recommended
- Service: `granotLifecycle` (Wave A, in-progress)
- Pass: 15 of this service — `projections.ts`
- Remaining in this service: `creatingObservation.ts` and the rest of the `granotLifecycle` checklist in TRAVERSAL.md
- Target: `src/services/granotLifecycle/projections.ts`
- Knowledge: [`docs/knowledge/granot-lifecycle/projections.md`](../../../docs/knowledge/granot-lifecycle/projections.md). That Service file also lists `creatingObservation.ts`, `bookingPriorityPairing.ts`, `alerts.ts`, the admin routes, and Zod as primary code — they are siblings, not this pass. Health instrumentation is also listed on [`observability.md`](../../../docs/knowledge/granot-lifecycle/observability.md). Distinct from receipt insert: [recommendations/granot-lifecycle-capture.md](granot-lifecycle-capture.md). Distinct from queue wake-up: [recommendations/granot-lifecycle-queue-publisher.md](granot-lifecycle-queue-publisher.md). Distinct from turning a claimed receipt into a Decision: [recommendations/granot-lifecycle-processor.md](granot-lifecycle-processor.md). Distinct from starting the clock / requeue: [recommendations/granot-lifecycle-operations.md](granot-lifecycle-operations.md). Distinct from unused Lead contact cards: [recommendations/granot-lifecycle-lead-contact-projection.md](granot-lifecycle-lead-contact-projection.md). Distinct from Owner-only creating Granot statement: next module `creatingObservation.ts`. Distinct from fenced claim / pending clock: `drainer.ts`. Distinct from pairing class: `bookingPriorityPairing.ts`. Distinct from discrepancy DTOs: `discrepancyProjections.ts`. Distinct from seven rollout alerts: `alerts.ts`. Distinct from official Booking / Cancellation Owner commands: `bookingOwnerCommands.ts` / `releaseOwnerCommands.ts`. This checkout’s `CONTEXT.md` does not define Granot Observation / Booking Reconciliation Case / Job Number — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: `routes/granot-lifecycle-admin.routes.ts` (`GET .../cases` → `listGranotLifecycleCases`; `GET .../cases/:case_id` → `getGranotLifecycleCaseDetail`; `GET .../cases/:case_id/candidates` → `listGranotLifecycleCaseCandidates` after `requireRegistryOwnerActor`; `GET .../jobs/:normalized_job_no` → `projectGranotJob`; `GET /api/v1/admin/leads/:lead_model/:lead_id/lifecycle` → `projectGranotLeadTimeline`; `GET .../operations/health` → `projectGranotLifecycleHealth`; Owner/Admin via `requireRegistryReadActor` except candidates). `operationsRegistry/crmSourceOutboundSms.ts` (`maskContactLabel` only). Replica proofs: `projections.replica.test.ts` (reads leave mutation-sensitive counts unchanged); `releaseReconciliation.replica.test.ts` (merged queue / cursor / Release candidates null); `referralBooking.replica.test.ts` (Referral filter + empty candidates); `operations.replica.test.ts` (health after seed). Tests: `projections.test.ts` (AC-23 rank / AC-20 timeline / AC-31 flags / AC-35 path+guard+discrepancy mask / AC-37 due filter / AC-P4–P7 pairing / intake contact). Not callers: `creatingObservation.ts` (own route), `discrepancyProjections.ts`, `processor.ts`, `drainer.ts`, `operations.ts` (writes the clock; does not compose health), `leadContactProjection.ts`.
- Seams callers need: Owner/Admin case-job-lead-health vs Owner-only candidates; intake-visible contact vs discrepancy/SMS mask; Job timeline vs Lead-follows-links timeline; due-work filter shared with drain; credential/raw-transport guard vs not-a-PII-gate; health DTO vs instrumentation persist of alert transitions
- Split later (only if the file outgrows one sitting): this ~2,161-line file cannot be read in one sitting. Later story files, never CRUD: `showTheOwnerTheOpenBookingAndReleaseWork.ts` / `openThisCaseSoTheOwnerCanSeeGranotVsOfficialFacts.ts` / `letTheOwnerBrowseLeadsToAttachWithoutAttachingOne.ts` / `tellThisJobsStoryAsATimeline.ts` / `tellThisLeadsStoryThroughItsJobs.ts` / `showWhetherTheLifecycleIsAlive.ts` — never `list.ts` / `get.ts` / `health.ts` / `create.ts` / `update.ts` / `delete.ts`

`listGranotLifecycleCases` / `getGranotLifecycleCaseDetail` / `listGranotLifecycleCaseCandidates` / `projectGranotJob` / `projectGranotLeadTimeline` / `projectGranotLifecycleHealth` are executor mechanics. The owner question is: *Show the Owner the Booking and Release work they must do, one case at a time, the Leads they may attach, the Job’s story, this Lead’s story through its Jobs, and whether the machine is alive. Contact follows the work: the Owner who has to call sees the whole contact; surfaces nobody acts on stay masked. These reads never attach a Lead, never confirm a Booking, never cancel. Health may stamp alert transitions and gauges; that is instrumentation, not a business write. This file does not claim a receipt. This file does not `$set` a Lead. This file does not write an official Booking or Cancellation.*

Creating-observation, pairing class, discrepancy DTOs, alert evaluation, and drain already live in other **modules**. Do not pull those in.

## What this file actually does

Six operations of one Admin-read story, not “a projection CRUD service,” and not the creating-observation / pairing / discrepancy / drain modules:

1. **Show the Owner the open Booking and Release work** — default the queue to open cases, newest evidence first. Merge Booking and Release collections, then apply the selected timestamp-plus-id cursor so a page neither duplicates nor omits a cross-collection row. `kind` or `mode=release` can drop one stream. Referral rows without Source Scope take the reviewed Registry source from the first Decision’s `source_policy`. Each row names the customer the Owner must call (`customerLabel`: name, else phone, else email). Compact Priority pairing rides along only when the creating evidence is Booked; Release and Priority-5-only rows omit it; `has_later_priority_5` is always computed. This function does not return raw evidence arrays. This function does not attach a Lead.

2. **Open one case so the Owner can see Granot vs official facts** — load Booking first, else Release. Keep immutable Granot evidence (ids, action, captured-at, outcome) visibly separate from live official Booking / Cancellation fields. `official_draft` stays empty and never copies Granot numbers. Case-detail contact is the whole captured contact (`projectOwnerVisibleContact` / stored observed contact), not an initial and four digits. Submitted/ingested and accepted-Granot cards stay two labels; if the Lead has no Granot snapshot, fall back to the first Observation’s contact. Candidate search is off for Referral and for Release. Booking-without-Lead may deep-link the existing Employee Booking Lead Reconciliation work. Commands are true only when the case is open **and** the matching effect flag is on. This function does not confirm a Booking. This function does not invent a second matcher.

3. **Let the Owner browse Leads to attach, without attaching one** — Booking cases only. Missing case is null (route 404). Referral mode or an official Referral Booking returns an empty page. Policy candidates come from `searchBookingLeadCandidates` + `projectBookingCandidateBrowserPolicy` (sibling). Browse may search Form/Call inside Source Scope or across scopes; Duplicate and Bad Form Leads stay out. On the first page with no `q` and no cursor, pin suggested then high-confidence identity matches ahead of the ObjectId browse stream so the strongest match is never on page two. An explicit `q` owns its page and pins nothing. Each row carries the reachable contact plus `customerLabel`. This function does not `$set` `lead_ref`. This function does not run a confirm command.

4. **Tell this Job’s story as a timeline** — normalize the path to a Job Number or 400. Compose every Observation, Priority effect, Booked/Release action, Decision, case open/refresh/resolve, discrepancy, Record Link change, Entity Change, and current official Booking/Cancellation as its own entry. Sort ascending `(event_at, type_priority, id)` with locked priorities 10 through 100. Invalid authoritative time fails projection; request time is never substituted. Paginate with an opaque cursor; `next_cursor` means more rows, not a hidden 100-row cap. This function does not contact-match. This function does not collapse two evidence rows into one “status.”

5. **Tell this Lead’s story through its Jobs** — prove the Form or Call Lead exists (`null` → generic “Lead not found”). Follow persisted Record Links to Job Numbers. Dedup on `type:id`. Never phone- or email-match at read time. Then the same timeline page as the Job story. This function does not invent a Job the Lead is not linked to.

6. **Show whether the lifecycle is alive** — named flag booleans (not `process.env`), masked activation id, Mongo due/claim/dead-letter counts using the same due filter the drain uses (pending/retry plus claimed only when the lease expired), 24-hour Decision groups, open Booking/Release cases and discrepancies, command conflicts, last queue/cron run, RingCentral lease/cursor, and the seven rollout alerts. Counts come from current models. After the DTO is built: persist alert transitions, stamp due gauges, stamp open-case / open-discrepancy metrics. This function does not start the clock. This function does not claim a receipt. This function does not treat historical_shadow / live_shadow Decision counts as promoted effects.

There is no seventh mutate operation. `dueWorkFilter`, `paginateTimeline`, `compareTimelineEntries`, `rankBookingCandidateProjections`, `projectOwnerVisibleContact`, `customerLabel`, `maskContactLabel`, `flagsToNamedBooleans`, `assertProjectionSafe`, and the pairing wrappers are shared folds, not public stories. `normalizeJobProjectionPath` is the Job door the route already validated.

## Organization

Keep one file as the screenplay for “show the Owner the work, the case, the attachable Leads, the Job story, the Lead story, and whether the machine is alive.” Creating-observation, pairing class, discrepancy DTOs, alert evaluation, and drain already live in deeper **modules**. Do not pull those in. Do not invent a `GranotLifecycleProjectionService` class. Do not invent a canonical-command `begin` / `complete` **seam** here — these are reads; the one after-read persist is instrumentation inside health. Do not invent a channel **seam** that has only one **adapter** here.

This file cannot be read in one sitting. If it later splits, split by the six stories above. Do not split into `list.ts` / `get.ts` / `health.ts`. Do not move `getIntakeCreatingObservation` here so “knowledge lists both as primary code.” Do not move `projectBookingPriorityPairing` here so “pairing lives with the DTO.” Do not move `listGranotLifecycleDiscrepancies` here so “every Admin list lives together.” Do not merge `leadContactProjection.ts` here so “every contact card lives together.” Do not merge `operations.ts` here so “activation and health live together.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `listGranotLifecycleCases` | `showTheOwnerTheOpenBookingAndReleaseWork` | Admin queue; merged cursor |
| `getGranotLifecycleCaseDetail` | `openThisCaseSoTheOwnerCanSeeGranotVsOfficialFacts` | Admin detail; evidence ≠ official |
| `listGranotLifecycleCaseCandidates` | `letTheOwnerBrowseLeadsToAttachWithoutAttachingOne` | Owner-only; pin then browse |
| `projectGranotJob` | `tellThisJobsStoryAsATimeline` | Job Number is the primary story |
| `projectGranotLeadTimeline` | `tellThisLeadsStoryThroughItsJobs` | Lead exists, then follow links |
| `projectGranotLifecycleHealth` | `showWhetherTheLifecycleIsAlive` | flags, due work, alerts |
| `dueWorkFilter` | `theSameDueWorkTheDrainUses` | health counts = drain eligibility |
| `projectOwnerVisibleContact` | `handTheOwnerTheWholeContact` | intake; Owner has to call |
| `customerLabel` | `nameTheCustomerOnThisJob` | list / candidate row title |
| `maskContactLabel` | `maskTheContactNobodyHasToActOn` | discrepancy queue + outbound SMS |
| `assertProjectionSafe` | `refuseRawTransportAndCredentials` | key-name guard, not a PII gate |
| `paginateTimeline` / `compareTimelineEntries` | `pageTheStoryWithoutCollapsingIt` | locked 10–100 order + cursor |
| `rankBookingCandidateProjections` | `pinTheStrongestMatchOnTheFirstPage` | suggested → high → medium |
| `flagsToNamedBooleans` | `nameTheTenFlagsWithoutPromotingEffects` | health DTO; checked-in defaults |

Keep the old names as one-line aliases until the admin router, SMS logger, and replica proofs migrate. Do not make callers learn `LifecycleCaseListRow` / `toContact` / `buildTimelineForJob` as the domain language.

**No class for the workflow.** The type that *does* earn a name is the page Admin already treats as the Job’s current facts:

```ts
type WhatThisJobLooksLikeRightNow = {
  record_link?: SafeRecordLinkProjection
  booking?: SafeBookingProjection
  cancellation?: SafeCancellationProjection
}
```

That is the handoff from “we walked every evidence row” to “here is the current link, Booking, and Cancellation.” Do **not** add `official_booking_details` so “detail can confirm,” and do **not** add `raw_payload` so “the Owner can see Granot.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// projections.ts
// Show the Owner the Booking and Release work they must do.
// Open one case. Keep Granot evidence off the official Booking.
// Let them browse Leads to attach. Do not attach one.
// Tell the Job’s story. Tell this Lead’s story through its Jobs.
// Say whether the machine is alive.
// Contact follows the work.
// These reads never write a Lead, Booking, or Cancellation.
// Health may stamp alerts. That is not a business write.

// ── 1. Show the Owner the open Booking and Release work ───

export async function showTheOwnerTheOpenBookingAndReleaseWork(query)

function mergeTheTwoQueuesWithoutLosingARow(bookingRows, releaseRows, sort)
function nameTheReviewedSourceEvenWhenTheCaseHasNoScope(row, decisions)
function nameTheCustomerOnThisJob(contact)               // customerLabel
async function stampCompactPairingOnlyOnBookedCreatingEvidence(rows)

// ── 2. Open one case so Granot and official facts stay apart ─

export async function openThisCaseSoTheOwnerCanSeeGranotVsOfficialFacts(caseId)

async function loadBookingFirstElseRelease(caseId)
function keepGranotEvidenceOffTheOfficialBooking(row, observations, decisions)
function handTheOwnerTheWholeContact(value)              // projectOwnerVisibleContact
function showSubmittedAndGranotAsTwoCards(lead, firstObservation)
function sayWhetherCommandsAreOnForThisOpenCase(kind, mode, flags)
function deepLinkEmployeeReconInsteadOfInventingAMatcher(bookingId)

// ── 3. Let the Owner browse Leads to attach, without attaching ─

export async function letTheOwnerBrowseLeadsToAttachWithoutAttachingOne(caseId, query)

function refuseReferralCandidateBrowse(row, officialReferral)
async function pinTheStrongestMatchOnTheFirstPage(policyRows)  // unless q / cursor
async function browseEligibleFormAndCallLeads(query, scope)
function attachTheReachableContactWithoutTheRawLead(lead)

// ── 4. Tell this Job’s story as a timeline ────────────────

export async function tellThisJobsStoryAsATimeline(rawJobNo, query)
export function theJobPathMustNormalize(raw)             // normalizeJobProjectionPath

async function composeEveryEvidenceRowForThisJob(normalizedJobNo)
  // observation 10, priority 20, action 30, decision 40,
  // case 50, discrepancy 60, record link 70, entity change 80,
  // official booking 90, official cancellation 100
export function pageTheStoryWithoutCollapsingIt(timeline, query)
export function compareTimelineEntries(left, right)      // event_at, priority, id
function failIfTheAuthoritativeTimeIsMissing(value, field)  // never use request time

// ── 5. Tell this Lead’s story through its Jobs ────────────

export async function tellThisLeadsStoryThroughItsJobs(model, leadId, query)

async function proveTheLeadExists(model, leadId)         // null → Lead not found
async function followPersistedRecordLinksOnly(model, leadId)
function dedupOnTypeAndId(items)                         // never contact-match

// ── 6. Show whether the lifecycle is alive ────────────────

export async function showWhetherTheLifecycleIsAlive(now?)
export function theSameDueWorkTheDrainUses(now)          // dueWorkFilter
export function nameTheTenFlagsWithoutPromotingEffects(flags)

async function countDueClaimDeadLetterAndOpenWork(now)
async function askAlertsThenStampTransitionsAndGauges(counts)
export function refuseRawTransportAndCredentials(dto)    // assertProjectionSafe
export function maskTheContactNobodyHasToActOn(contact)  // discrepancy + SMS
```

Read the primary path out loud: *Admin opens the queue. Open Booking and Release cases sit in one list, newest evidence first. A cursor that is only a time and an id walks both collections without repeating a row. Each card names the customer the Owner will call. Compact pairing says whether Priority 5 came before the Booked statement; a later 5 is computed, not remembered. The Owner opens one case. Granot evidence is labeled “not official Vantage values.” The official Booking and Cancellation sit in another box. The draft is empty. If this is a Booking without a Lead, the existing Employee recon case is a link, not a new matcher. Referral and Release do not offer candidate search. On a Booking case the Owner may browse Leads. Suggested and high-confidence matches are pinned on page one. A typed search owns its page. Picking a row here does not attach it. Someone else confirms. Separately, the Owner asks for a Job Number and sees every statement in time order — Observation, Priority, Booked or Release, Decision, case, discrepancy, link, Change, official facts — none collapsed. Asking for a Lead first proves the Lead, then follows Record Links, and never phones the database. Health names the ten flags, the write-once clock, due work the drain would claim, open cases, and the seven alerts. After that DTO, stamp alert transitions and gauges. Do not start the clock. Do not claim. Do not `$set` a Lead. Do not write a Booking.*

That is the operation. `listGranotLifecycleCases` is not. `projectGranotLifecycleHealth` is not a drain story.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Knowledge still says Unit 31 masks every case-detail contact.** The file and `granot-lifecycle-capture.mdc` now say contact follows the work: intake detail / list / candidates / official Booking customer name are owner-visible; `maskContactLabel` remains for the discrepancy queue and outbound SMS. AC-35’s discrepancy-mask test and the intake-contact test lock both. Do not remask case detail so the Unit-31 paragraph “wins,” and do not delete `maskContactLabel` so “intake is unmasked.”

2. **`SafeBookingProjection.customer_name` JSDoc lies.** The type comment says “Masked for lifecycle/Admin transport; never the raw Booking customer name.” `projectBooking` assigns `booking.customer_name ?? null`. The software map says the official Booking carries the real name. Do not start calling `maskContactLabel` here so the comment “wins,” and do not delete the real name so “Unit 31 still applies.”

3. **`assertProjectionSafe` is a key-name guard, not a PII gate.** Forbidden keys are payload / headers / credentials / token. `customer_name`, `phone_number`, and `email` are allowed. Owner-daily notes already warn that an unmasked phone will pass. Do not add those keys to `JOB_PROJECTION_FORBIDDEN_KEYS` so “the guard catches PII,” and do not drop the guard so “intake is allowed to leak.”

4. **Health is a read that writes instrumentation.** Knowledge Role: “Reads never invoke mutations.” After the DTO, this file calls `persistGranotLifecycleAlertTransitions` (incidents / events), `applyDueGauges`, and `setGranotLifecycleOpenCases` / `setGranotLifecycleOpenDiscrepancies`. Replica AC-18 proves case/job/lead/candidate reads leave mutation-sensitive counts unchanged and does **not** call health. `operations.replica.test.ts` does call health. Do not delete the persist so the Role line “wins,” and do not move health into `alerts.ts` so “writes live with alerts.”

5. **Due work is one filter with two callers.** `dueWorkFilter` is the Section 26 shape: pending / retry_scheduled / claimed, `next_attempt_at <= now`, and claimed only when the lease expired. Drain uses the same meaning. Do not invent a second due query so “health can be cheaper,” and do not import `claimAndProcessOrPoll` so “health should drain.”

6. **Knowledge lists creating-observation and pairing as this file’s primary code.** `GET .../creating-observation` calls `creatingObservation.ts`. Pairing class lives in `bookingPriorityPairing.ts`; this file only wraps list/detail and computes `has_later_priority_5`. Do not move those siblings here so the Primary-code line “wins.”

7. **Admin case UI never imported `projectRoleSafeLeadContacts`.** This file’s `projectLeadContacts` reads `ingested_contact_snapshot` / `granot_contact_snapshot` (or the first Observation) and ships owner-visible cards. The unused sibling masks with log helpers. Do not wire `leadContactProjection.ts` into detail so UNIT-18 “wins,” and do not delete that sibling from this pass.

8. **Observed-context contact bypasses `projectOwnerVisibleContact`.** Detail assigns `row.observed_context.contact` raw. Lead cards and the Granot fallback go through `toContact`. Do not silently route observed-context through `toContact` in this rename unless a test already locks the shape — the stored bag is already `{ name, phone_number, email }`.

9. **Merged-queue cursors can over-fetch.** Each collection takes `limit + 1`, then the merge sorts and slices. A busy Booking stream can hide a Release row that would have been next. Replica already walks mixed pages. Do not “fix” the merge by querying one collection so “the cursor is simpler.”

10. **Referral source is Decision policy, not case scope.** List and detail look up `source_policy.granot_crm_source_id` when `source_scope` is absent. Do not copy that id onto the case so “every row has scope,” and do not hide the source so “Referral has no Source Scope.”

11. **Candidate pin vs search is two pages.** Ranked identity matches prepend only when there is no cursor and no `q`. Cursor pages continue browse only, so a pinned row is never returned twice. Do not pin on every page so “the suggestion is sticky,” and do not rank a `q` page so “search should boost identity.”

12. **Lead timeline is links, not phones.** After `findById`, the only query is Record Links by `lead_ref`. Do not add a phone/email fallback so “the Owner still sees the Job.”

13. **Cancellation omits reason.** `projectCancellation` drops `reason`. Knowledge Unit 31 still wants that. Do not add free-form reason so “detail is complete.”

14. **`official_draft` is always `{}`.** Create-missing does not prefill Granot estimate / payment / move date. Do not derive defaults from `observed_context` so “the Owner can confirm faster.”

15. **Leave sibling modules alone.** Creating-observation stays in `creatingObservation.ts`. Pairing class stays in `bookingPriorityPairing.ts`. Discrepancy lists stay in `discrepancyProjections.ts`. Alert evaluation stays in `alerts.ts`. Claim/lease stays in `drainer.ts`. Clock write stays in `operations.ts`. ObjectId construction stays in `utils/objectId.ts`. Job normalize stays in `bookingIdentity.ts`.

16. **Do not treat confirm, cancel, attach, or drain as this story.** Those write official facts or claim a receipt. This file only shows.

17. **Do not write a whole-folder recommendation for `granotLifecycle`.**

## Testing

The **interface** is the test surface: `showTheOwnerTheOpenBookingAndReleaseWork` (today `listGranotLifecycleCases`), `openThisCaseSoTheOwnerCanSeeGranotVsOfficialFacts` (today `getGranotLifecycleCaseDetail`), `letTheOwnerBrowseLeadsToAttachWithoutAttachingOne` (today `listGranotLifecycleCaseCandidates`), `tellThisJobsStoryAsATimeline` (today `projectGranotJob`), `tellThisLeadsStoryThroughItsJobs` (today `projectGranotLeadTimeline`), and `showWhetherTheLifecycleIsAlive` (today `projectGranotLifecycleHealth`). Shared folds that already leak across modules stay on the **interface**: `dueWorkFilter`, `projectOwnerVisibleContact`, `customerLabel`, `maskContactLabel`, `assertProjectionSafe`, `paginateTimeline`, `rankBookingCandidateProjections`, `flagsToNamedBooleans`.

Today’s `projections.test.ts` already locks Job-path 400, discrepancy mask, intake label + whole contact, candidate rank, timeline order + cursor, forbidden-key guard, named flags, due filter, and pairing omit/include. `projections.replica.test.ts` already locks that case/job/lead/candidate reads do not change mutation-sensitive counts. Keep those. Add the gaps that name the operation:

**Show the open work / open one case**
- Merged open queue, newest evidence, Referral source from Decision policy (replica already walks mixed pages).
- Detail keeps `official_draft` empty and omits Cancellation reason (add these; today’s unit file never asserts either).
- Observed Granot contact and official Booking `customer_name` are owner-visible (add the Booking-name half; intake contact is already locked).
- This function does not attach a Lead or confirm a Booking — do not add a test that it writes `BookedLead`.

**Browse Leads without attaching**
- First page pins suggested then high (already locked as a pure rank).
- `q` / cursor pages do not re-pin (add this; today’s unit never opens browse).
- Referral returns `[]` (replica already locks).
- Release case is `null` (replica already locks).

**Job story / Lead story**
- Entries stay individual; order is `(event_at, type_priority, id)` (already locked).
- Bad authoritative time 400s; request time is not substituted (add this).
- Missing Lead is `null` / generic 404; the function does not phone-match (add the no-match half).

**Whether the machine is alive**
- Ten named flags match checked-in defaults and do not promote effects (already locked).
- Due filter includes expired claims and excludes a live lease (already locked).
- Activation id is masked (operations AC-35 / health seed).
- This function may persist alert transitions — do not add a test that health is side-effect free.
- This function does not call `claimAndProcessOrPoll` or `activateGranotLifecycle`.

Do **not** add a test per helper (`mergeTheTwoQueuesWithoutLosingARow`, `composeEveryEvidenceRowForThisJob`, `escapeRegExp`, `isListCursor`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test creating-observation envelopes, discrepancy lists, or Owner confirm here. Do not add a test that this file reads `writeGranotSourcePolicyCache`, `$set`s a Lead, or confirms an official Booking. Do not rewrite `operations.replica.test.ts` as if it covered this module’s case DTOs.

## What I would not do

- A `GranotLifecycleProjectionService` class with `list` / `get` / `health`.
- Thirty two-line functions that only wrap `find().lean()`.
- Moving this into a CRUD folder, or into `creatingObservation.ts` / `operations.ts` / `alerts.ts` “for cleanliness.”
- Splitting `list.ts` / `get.ts` / `health.ts` so each admin route owns a file.
- Remasking intake contact so the Unit-31 paragraph “wins.”
- Turning `assertProjectionSafe` into a PII gate.
- Deleting `persistGranotLifecycleAlertTransitions` so “reads never write.”
- Calling `claimAndProcessOrPoll` or `activateGranotLifecycle` from health.
- Deriving `official_draft` from Granot evidence.
- Contact-matching a Lead timeline.
- Wiring `projectRoleSafeLeadContacts` into case detail.
- Writing a whole-folder recommendation for `granotLifecycle`.
