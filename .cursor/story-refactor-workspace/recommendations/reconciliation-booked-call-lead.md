# Refresh The Call Lead And Booking From A Booked Jobs Row — operational story

- Status: recommended
- Service: `reconciliation` (Wave A, in-progress)
- Pass: 1 of this service — `bookedCallLeadReconciliation.service.ts`
- Remaining in this service: `bookedCallLeadRows.ts`
- Target: `src/services/reconciliation/bookedCallLeadReconciliation.service.ts`
- Knowledge: `docs/knowledge/services/booked-call-lead-reconciliation.md`. Distinct from Follow Up refresh: `docs/knowledge/services/enrichment.md` + `recommendations/enrichment-call-lead-enrichment.md`. Distinct from Book This Lead / from-source: `docs/knowledge/services/bookings.md` + `recommendations/bookings-booked-lead.md` / `bookings-booked-lead-from-source.md`. Distinct from Owner Granot Booking cases: `docs/knowledge/granot-lifecycle/booking-reconciliation.md`. Distinct from Owner receipt apply on the same URL: `docs/knowledge/granot-lifecycle/extension-apply.md`. Distinct from HTTP automation apply: `docs/knowledge/services/granot-http-collector.md` + `docs/knowledge/granot-lifecycle/automation-apply.md`. Source-fit yes/no already recommended: `recommendations/leads-call-lead-source-match.md` (this file pastes it). Receiver stamp already recommended: `recommendations/agents-receiver-agent-crm-username.md`. CSV `job_no` required: `.cursor/rules/granot-crm-csv-s3-sync.mdc`. This checkout’s `CONTEXT.md` does not define Call Lead / Booking Chain / Job Number / Sheet Sync — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: `routes/v1.routes.ts` `POST /api/v1/call-leads/booked-reconciliation/preview` (legacy barrel `bookedCallLeadReconciliation.service.ts`). `granotCrmCsv/sync.service.ts` `processBookedCallRow` (dry-run → preview; `--apply` → sync, no identity options; always `section: "bookedJobs"`). `granotHttpCollector/runWorkflow.ts` `planCallWorkflow` and `granotHttpCollector/automation.ts` `runGranotAutomation` preview mode (preview only; apply captures a receipt). Barrel: `reconciliation/index.ts`. `extension-granot-apply.test.ts` only asserts `typeof syncBookedCallLeadReconciliation === "function"` — not a caller. `POST /api/v1/call-leads/booked-reconciliation/sync` is `applyExtensionGranotItem` (`booking_action_apply` only) and does **not** import this file.
- Seams callers need: the per-row status card (preview never writes) vs CSV apply (write + schedule Sheet Sync after commit); booking-chain vs call-lead-only sheet target; the `/booked-reconciliation/sync` URL is a different story
- Split later (only if the file outgrows one sitting): keep one file — showing the refresh and applying it are one sitting. Never `preview.ts` / `sync.ts`, and never `create.ts` / `update.ts` / `delete.ts`

`previewBookedCallLeadReconciliation` / `syncBookedCallLeadReconciliation` / `resolveReconciliationRow` are executor mechanics. The owner question is: *someone has Granot Booked Jobs rows. Which existing Call Lead and Booking would each row refresh, and may CSV write those diffs? This file never creates a Booking or a Call Lead. The extension URL that still says `/booked-reconciliation/sync` is Owner receipt apply, not this write.*

Follow Up enrichment, ordinary Call create/correct, Book This Lead, from-source, Granot Owner Booking cases, and lifecycle apply already live in other **modules**. Do not pull those in.

## What this file actually does

One story with two adapters, not “a booked-jobs CRUD service,” and not Book This Lead:

1. **Show what this Booked Jobs row would refresh on a Call Lead and Booking** — parse the CRM row (sibling). Invalid when `job_no` is missing, source is missing or unknown, or the row is not `section: "bookedJobs"` and `prior` is not `"5"`. Find a Booking by exact stored `job_no`. If one exists, it must name a Call Lead; a Form Booking or a missing `lead_ref` is `conflict`. Assigned sources that disagree are `conflict`. Diff Call fields, Booking `source` / `local` / `book_date`, and whether a Customer should be inserted-or-linked by phone (`$setOnInsert` only). If no Booking exists, find an open Call Lead by exact `job_no` first (up to 25, never unmatched / booked / cancelled). Assigned-source miss on that job pick is `conflict`. Then phone (leading-boundary sieve + in-memory exact digits). Assigned-source miss on phone is `no_match`. Prefer phone hits whose stored `job_no` is empty or matches the row; a stored Job Number that differs is a warning and apply will not overwrite it. Booked Call Leads are **not** in this no-Booking pool. This adapter never mutates Mongo and never schedules Sheet Sync.

2. **Refresh the Call Lead and Booking from this Booked Jobs row** — run the same match and diff. Leftover identity / receiver drift options throw and become `failed` when a caller passes them; CSV does not. Write only when the card is `updateable` or `unchanged` **and** there is a lead update, a booking update, a customer link, or a receiver stamp. `conflict` / `no_match` / `invalid` do not write. Stamp a receiver from `granot_crm_username` only on apply, after the match, via `applyGranotCrmUsernameReceiverMatch` (`already_linked` / `not_found` warn; `matched` copies the approved snapshots onto the re-read lead). Re-price whenever a lead patch is present, not only when `local` or source changed. If preview expected no Booking (`expectedBookingId === null`) and one appears before apply, throw. After commit, schedule `booked_call_lead.reconciliation.sync` (booking chain) or `booked_call_lead.call_lead_only.sync` (lead only), plus a receiver job when the stamp changed. Status becomes `updated`. This adapter does not write phone, does not create a Booking, and does not change `lead_ref` / `lead_model`.

There is no third create operation. `no_match` stays `no_match`. `booking_missing` is in the type union and the CSV mapper; this file never emits it.

## Organization

Keep one file. This is the screenplay for “refresh the Call Lead and Booking from a Booked Jobs row.” Row parse, source-fit yes/no, receiver stamp, CPL snapshot, Customer upsert, and Sheet Sync already live in deeper **modules** — except this file still pastes the source-fit five. Do not pull parse or Book This Lead in. Do not invent a `BookedCallLeadReconciliationService` class. Do not invent a canonical-command `begin` / `complete` **seam** — CSV apply is the write **adapter**, not a Domain Command. Do not invent a Form-shaped `found` / `ambiguous` **seam** that has only one real adapter.

Do not split this ~980-line file into `preview.ts` and `sync.ts`. The write reuses the same match. Do not split “booking pick” vs “call-lead-only pick” into two files. Do not move the pick into `callLeadSourceMatch.ts` “because reconciliation pastes it.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `previewBookedCallLeadReconciliation` | `showWhatThisBookedJobsRowWouldRefreshOnTheCallLeadAndBooking` | public POST preview + HTTP automation plan + CSV dry-run |
| `syncBookedCallLeadReconciliation` | `refreshTheCallLeadAndBookingFromThisBookedJobsRow` | Granot CSV Booked Jobs `--apply` only |
| `BookedCallLeadReconciliationResult` | `BookedJobsRowRefreshCard` | every caller branches on `status`, `call_lead_id`, `booking_id`, `changes`, `warnings` |
| `BookedCallLeadReconciliationStatus` | `BookedJobsRowRefreshStatus` | preview: `invalid` \| `no_match` \| `conflict` \| `updateable` \| `unchanged`; apply may add `updated` \| `failed`; `booking_missing` stays unused |
| `BookedCallLeadMatchMethod` | `HowTheBookedJobsRowFoundTheCallLead` | `job_no_with_booking` \| `job_no_only` \| `phone_only` \| `none` |

Keep the old names as one-line aliases until the v1 preview handler (via the leftover barrel), CSV Booked Jobs, HTTP automation plan, and `reconciliation/index.ts` migrate. Do not make callers learn `$or` / `limit(25)` / `canWrite` / `syncTarget` as the domain language.

**No class for the workflow.** The type that *does* earn a name is the pending refresh bag:

```ts
type BookedJobsRowRefreshInProgress = {
  result: BookedJobsRowRefreshCard
  booking?: HydratedDocument<BookedLeadDocument>
  lead?: HydratedDocument<CallLeadDocument>
  leadUpdate?: Partial<CallLeadDocument>
  bookingUpdate?: Partial<BookedLeadDocument>
  customerInput?: { full_name: string; phone_number: string; email?: string }
  syncTarget?: "booking_chain" | "call_lead"
}
```

That is the handoff from “we matched and diffed” to “CSV may write and schedule Sheet Sync.” Preview returns only `result`. Do **not** collapse this into a Domain Command pending bag so “every write looks like Form ingest,” and do **not** add a persist-intent field so “every write looks like Follow Up enrichment.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// bookedCallLeadReconciliation.service.ts
// Someone has Granot Booked Jobs rows.
// Show which existing Call Lead and Booking each row would refresh.
// CSV may then write those diffs.
// Job Number first — Booking, then open Call Lead — then phone.
// Assigned sources that disagree stop the booking path and the job pick.
// A phone-path source miss is no_match, not conflict.
// A stored Job Number that differs is left as-is.
// The no-Booking pool never includes booked, cancelled, or unmatched stubs.
// This file does not create a Booking or a Call Lead.
// This file does not refresh Follow Up Estimates unless prior is 5.
// This file is not POST /call-leads/booked-reconciliation/sync.

// ── 1. Show what this Booked Jobs row would refresh ───────

export async function showWhatThisBookedJobsRowWouldRefreshOnTheCallLeadAndBooking(batch)

async function matchAndDiffTheBookedJobsRow(row)   // today's resolveReconciliationRow
function refuseWhenJobOrSourceIsMissing(parsed)    // sibling validateParsedRow
async function findTheBookingByTheTypedJobNumber(jobNo) // exact stored job_no
function refuseWhenTheBookingIsNotACallLead(booking)
async function loadTheLinkedCallLead(booking)
function refuseWhenAssignedSourcesDisagree(lead, parsed)
function diffTheFollowUpFieldsOntoTheCallLead(lead, parsed)
function diffTheBookingSourceLocalAndBookDate(booking, parsed)
async function sayWhetherACustomerShouldBeLinked(booking, parsed) // $setOnInsert later

async function findAnOpenCallLeadWhenThereIsNoBooking(parsed)
async function findByTheTypedJobNumberFirst(jobNo)  // 25 newest open eligible
async function findByTheNormalizedPhoneNext(phone)  // sieve + exact digits
function keepSourceCompatibleOrUnassigned(pool, parsed)
function phoneSourceMissIsNoMatchNotConflict(parsed) // job-path miss stays conflict
function preferPhoneHitsWhoseJobIsEmptyOrMatches(compatible, parsed)
function leaveADisagreeingJobNumberAsIs(lead, parsed)
function pickTheNewestEligibleCallLead(compatible)

// ── 2. Refresh the Call Lead and Booking from this row ────

export async function refreshTheCallLeadAndBookingFromThisBookedJobsRow(batch, options)

function refuseWhenTheApprovedLeadOrBookingDrifted(resolved, options) // leftover; CSV omits
async function stampAReceiverFromTheCrmUsername(lead, username) // apply only
function refuseUnlessTheCardMayWrite(card, leadUpdate, bookingUpdate, customer, receiver)
async function writeTheRefreshInsideOneSession(pending, receiver, options)
async function repriceWheneverALeadPatchIsPresent(lead, update)
function copyTheApprovedReceiverSnapshots(lead, approved)
function bumpTheCallLeadVersionWhenOnlyTheBookingMoved(lead) // CAS __v
async function insertOrLinkTheCustomerByPhone(booking, customerInput) // $setOnInsert
function refuseIfABookingAppearedAfterANoBookingPreview(lead, jobNo, options)
async function scheduleSheetsAfterCommit(pending, receiver)
function markTheCardUpdated(card, leadId, bookingId, receiver)
```

Read the primary path out loud: *parse the Booked Jobs row. If there is no Job Number or no known source, or this is a Follow Up row whose prior is not 5, the row is invalid. Look for a Booking by that Job Number. If one exists, it must already point at a Call Lead; assigned sources that disagree stop the row. Diff the Call fields, the Booking source/local/book date, and whether a Customer should be linked by phone. If there is no Booking, look for an open Call Lead by Job Number first, then phone. Booked, cancelled, and unmatched stubs stay out. Assigned sources that miss on the job pick are a conflict; on the phone pick they are no_match. A stored Job Number that differs stays. Preview stops there. CSV apply re-reads the lead and booking, stamps a receiver only when the existing one is empty, prices whenever a lead patch is present, writes Mongo, and schedules Sheet Sync after commit.*

That is the operation. `resolveReconciliationRow` is not a different story. `/booked-reconciliation/sync` is not this write.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`POST /call-leads/booked-reconciliation/sync` is not this file.** The route calls `applyExtensionGranotItem` with `booking_action_apply` items. Knowledge already says so. HTTP automation approved apply also must not call `syncBookedCallLeadReconciliation`. CSV Booked Jobs `--apply` is the remaining write helper. Do not point the URL back at this function so the path “matches the name,” and do not delete `syncBookedCallLeadReconciliation` so the route table “wins.”

2. **Identity / receiver drift options have no current caller.** `expectedCallLeadId`, `expectedCallLeadUpdatedAt`, `expectedBookingId`, `expectedBookingUpdatedAt`, `expectedReceiverAgent`, and `targetReceiverAgent` still throw `failed` when passed. CSV `processBookedCallRow` calls `syncBookedCallLeadReconciliation(payload)` with no options. Do not delete the guards so “CSV does not need them,” and do not wire the extension URL back through them so “preview approval is enforced.”

3. **Preview never stamps a receiver.** `showWhatThisBookedJobsRowWouldRefreshOnTheCallLeadAndBooking` does not import `applyGranotCrmUsernameReceiverMatch`. Automation `planCallWorkflow` uses find elsewhere to bind `target_receiver_agent` when the Call Lead has none. Apply stamps after the match, mutates the hydrated lead in memory, then copies those snapshots onto the re-read document inside the write. Do not start stamping during preview so the preview lead is dirty, and do not skip the in-transaction copy so “the in-memory lead is already updated.”

4. **Job Number first, then phone — and Booking before either Call pick.** Enrichment is phone first, then job, and never looks at `BookedLead`. Do not flip this file to phone-first so “the two CRM rows match the same way,” and do not OR phone+job+booking into one query so this file can reuse Call lookup.

5. **Job Number here is exact stored `job_no`.** Same as Call lookup and booked-from-source find. Identity / Granot use digit-core. Call browse contains. `P5562366` does not find `5562366`. CONTRADICTIONS already has the four Job meanings. Do not add `normalized_job_no` or `jobNumbersEquivalent` so “reconciliation finds the Job.”

6. **A stored Job Number that differs is a warning, not `conflict`.** Only on the no-Booking phone path. Apply leaves `job_no` as-is and may still write other fields. Source-fit disagreement on the booking path or the job pick is `conflict` and does not write. Do not promote the job mismatch to `conflict` so “every identity disagreement stops the row.”

7. **Phone-path source miss is `no_match`. Job-path source miss is `conflict`.** Knowledge already says so. `leads-call-lead-source-match.md` already said a later pass should import the five yes/no helpers and **leave this pool and these statuses alone**. Do not change phone-miss to `conflict` so “every assigned miss is a conflict,” and do not move the pick into `callLeadSourceMatch.ts` in this pass.

8. **The no-Booking pool is stricter than enrichment.** Eligible = not `created_on_unmatched`, not booked, not cancelled. Enrichment prefers open leads, then falls back to booked/cancelled. Book This Lead may invent an Unmatched Call. This path never creates a Booking and never refreshes a booked Call Lead when no `BookedLead` row exists for that `job_no`. Do not include booked/cancelled so “enrichment and recon share a pool,” and do not open Book This Lead because `has_booking` is false.

9. **When a Booking exists, booked Call Leads do refresh.** Path A loads the linked Call Lead even if `lead.booked` is set. Path B would have excluded that same lead. Do not refuse Path A so “recon only touches open leads.”

10. **This file pastes `isLeadSourceCompatible`.** Same five functions, same OR-ladder, same sentence as `callLeadSourceMatch.ts`. A later pass should import those five. Do not “fix” unassigned to also require empty `lead_source_company` so the four-way classifier “agrees.” Do not delete the booking-path `buildAssignedSourceConflict` so “the pick already filtered” — Path A never runs the pick.

11. **Phone sieve here has a leading boundary.** Same as enrichment. The leads helper omits the leading boundary on purpose. Callers still re-check `normalizePhoneNumberForMatch` in memory. CONTRADICTIONS already has the four phone meanings. Do not import the tail-only sieve so “phone helpers match,” and do not extract this regex in this pass.

12. **This file does not write phone.** The row carries `phone`. The lead diff never assigns it. Customer insert uses the parsed phone as the upsert key. Do not add `phone_number` to the lead update so “the CRM row looks complete.”

13. **CPL runs on every lead patch, not only `local` / source.** Follow Up enrichment prices only when those keys are in the update. Knowledge already flags the difference. Do not narrow this file so “every CRM write matches enrichment,” and do not reprice when the only write is a receiver stamp or a booking/customer change.

14. **Sheet Sync is scheduled after commit, not remembered inside the write.** Enrichment `persistSheetSyncIntent` sits inside the transaction and `finalizeSheetSync` sits after. This file calls `scheduleBookingChainSheetSync` / `scheduleCallLeadSheetSync` after `commitTransaction`. Do not add persist-intent so “every write looks like enrichment,” and do not move `schedule*` inside the session so “sheets cannot miss a committed write” without a tested change. Leave the after-commit **seam** visible.

15. **A lead-unchanged booking write still bumps Call `__v`.** When only the booking or customer moved, the session `updateOne`s `{ _id, __v }` with `$inc: { __v: 1 }` and `timestamps: false`. Drift during that bump throws. Do not skip the bump so “the Call Lead did not change,” and do not turn it into `lead.save()` so timestamps move.

16. **Customer write is `$setOnInsert` by phone.** Existing Customer fields are not overwritten. Change keys are `booking.customer` and `customer.create_or_link` only when the booking has no customer or the existing one is a different phone. Do not `$set` name/email so “the CRM customer wins,” and do not pull `upsertCustomerFromLead` in so “every customer write is one helper.”

17. **`unchanged` plus no receiver / customer / booking patch is not a write.** `canWrite` includes `unchanged`, then the next gate still requires an update, a customer input, or a receiver change. The card stays `unchanged`, not `updated`. Do not force `updated` so “sync always means wrote.”

18. **`no_match` does not create.** Unknown job/phone stays `no_match` with the retention-window sentence. Book-This-Lead and Granot Owner confirm may create. Do not insert a Call Lead or a Booking here so “every Booked Jobs row has a home.”

19. **`booking_missing` is leftover.** The status union and CSV `mapCallStatus` still name it. This file emits `no_match` when both the Booking and the Call Lead miss. Do not start emitting `booking_missing` so the union “wins,” and do not delete the CSV case in this pass.

20. **Follow Up Estimates are not this story unless `prior === "5"`.** CSV booked exports always send `section: "bookedJobs"`. A Follow Up row handed here without prior 5 is `invalid`. Ordinary Follow Up call rows stay in enrichment. Do not drop the prior-5 door so “booked-jobs is bookedJobs only,” and do not route prior-5 through enrichment so “every Follow Up row is one file.”

21. **Leave sibling modules alone.** `parseBookedCallLeadRow` / `validateParsedRow` stay in `bookedCallLeadRows.ts` (next module). `isLeadSourceCompatible` / `buildAssignedSourceConflict` should later import from `callLeadSourceMatch.ts` — not this pass’s rewrite of that file. `applyGranotCrmUsernameReceiverMatch` stays in `agents/`. `resolveLeadCplSnapshot`, Customer upsert, and Sheet Sync stay where they are. Book This Lead stays in `bookings/`. This file orchestrates parse → booking-then-open-call pick → source-fit → diff → (CSV) write + after-commit schedule.

22. **Do not treat Follow Up enrichment, Book This Lead, or Granot Booking cases as this story.** `previewCallLeadEnrichment` is the previous service. `createBookedLeadFromSource` books. `GranotBookingReconciliationCase` is Owner work, not an official Booking. Do not write a whole-folder reconciliation recommendation.

## Testing

The **interface** is the test surface: `showWhatThisBookedJobsRowWouldRefreshOnTheCallLeadAndBooking` and `refreshTheCallLeadAndBookingFromThisBookedJobsRow` (today `previewBookedCallLeadReconciliation` / `syncBookedCallLeadReconciliation`). The per-row card (`status`, `call_lead_id`, `booking_id`, `match_method`, `changes`, `warnings`) is part of that **interface**.

Today’s `bookedCallLeadReconciliation.service.test.ts` stubs `BookedLead.findOne` missing and `CallLead.find` for unassigned phone pick, assigned-source phone `no_match`, phone-path job-number warning, and prefer-empty-job-over-conflicting-job. That is not enough for a story this long.

Replace the stub style with tests that name the operation:

**Show what this Booked Jobs row would refresh**
- Missing `job_no`, missing/unknown source, or Follow Up with `prior !== "5"` → `invalid`. No `BookedLead.findOne`.
- Booking by exact `job_no` linked to a Call Lead → `job_no_with_booking`. Field diffs → `updateable` with `lead.*` / `booking.*` keys. No diffs → `unchanged`.
- Booking `lead_model !== "CallLead"` or missing `lead_ref` → `conflict`.
- Booking path assigned-source miss → `conflict`, no changes.
- No Booking; source-compatible open Call Lead by exact `job_no` → `job_no_only`. `P5562366` does **not** match `5562366`.
- No Booking; job pick hits only a different assigned Source Company → `conflict`. Phone fallback does **not** run after a job-path source miss — prove today’s short-circuit.
- No Booking; job miss; source-compatible phone among mixed companies → `phone_only`. Assigned-source-only phone hits → `no_match` (not `conflict`).
- Unassigned (`not_provided` / empty) phone match → `updateable`, `lead.source_company` in `changes`, “Claiming unassigned …” warning.
- Several compatible phone hits → newest eligible + “selected newest …” warning.
- Phone hits a lead with a different stored `job_no` and another with empty `job_no` → the empty one; `lead.job_no` is in `changes`.
- Phone hits only a different stored `job_no` → warning; `lead.job_no` is **not** in `changes`; other diffs may still be `updateable`.
- Booked / cancelled / `created_on_unmatched` Call Leads are absent from the no-Booking pool.
- Unknown job and phone → `no_match`. No insert. Status is never `booking_missing`.
- Preview never emits `updated` or `failed`. Preview does not call receiver stamp. Preview does not call `schedule*SheetSync`.

**Refresh the Call Lead and Booking from this Booked Jobs row**
- Assigned-source `conflict` / phone `no_match` / `invalid` → status stays; no save; no Sheet Sync.
- `updateable` with a Booking → transaction save of lead + booking, optional `$setOnInsert` customer, `scheduleBookingChainSheetSync` **after** commit, status `updated`.
- `updateable` with no Booking → lead save only; `scheduleCallLeadSheetSync` (`booked_call_lead.call_lead_only.sync`) after commit.
- `unchanged` and no receiver / customer / booking patch → no write; status stays `unchanged`.
- Receiver `matched` with no field diffs → write copies the approved snapshots; `changes` include `receiver_agent`; extra `booked_call_lead.receiver_agent_crm_username.sync`.
- Receiver `already_linked` / `not_found` → warning; does not overwrite.
- Any lead patch → `resolveLeadCplSnapshot` runs. Receiver-only or booking-only write does not.
- Booking-only write still bumps Call `__v` without moving `updatedAt`.
- Passed `expectedCallLeadId` / `expectedBookingId` / `updatedAt` mismatch → `failed`. `expectedBookingId === null` plus a Booking that appeared → `failed`. CSV’s no-options path does not take these branches.
- Phone is not in the assigned lead update. `lead_ref` / `lead_model` do not change. No `BookedLead` insert.

Do **not** add a test per helper (`findByTheTypedJobNumberFirst`, `leaveADisagreeingJobNumberAsIs`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test `parseBookedCallLeadRow` placeholders, `isLeadSourceCompatible`’s OR-ladder, receiver-stamp unit cases, Follow Up enrichment, Book This Lead, or `applyExtensionGranotItem` here. Do not add a test that `POST /booked-reconciliation/sync` calls this file — it must not.

## What I would not do

- A `BookedCallLeadReconciliationService` class with `preview` / `sync` / `apply`.
- Thirty two-line functions that only wrap `assignIfChanged`.
- Moving this into a CRUD folder, or splitting `preview.ts` / `sync.ts` “for cleanliness.”
- Pointing `POST /call-leads/booked-reconciliation/sync` at `syncBookedCallLeadReconciliation`, or deleting the CSV write so the route table “wins.”
- Teaching HTTP automation apply to call this write, or teaching this file to capture a Granot Observation Receipt or open a Granot Booking case.
- Creating a Call Lead or a Booking on `no_match`, or calling Book This Lead because the CRM row is booked and Vantage is not.
- Flipping to phone-first, importing the tail-only phone sieve, switching job find to digit-core, or including booked/cancelled/unmatched stubs in the no-Booking pool so “recon matches enrichment / lookup / identity.”
- Changing phone-path source miss from `no_match` to `conflict`.
- Stamping a receiver during preview, or narrowing CPL to `local` / source so “every CRM write matches enrichment.”
- Adding persist-intent inside the Mongo write so “every write looks like Follow Up enrichment.” Leave the after-commit `schedule*` **seam**.
- Pulling row parse, Book This Lead, or Customer from-lead into this file.
- Writing a whole-folder recommendation for `reconciliation`.
