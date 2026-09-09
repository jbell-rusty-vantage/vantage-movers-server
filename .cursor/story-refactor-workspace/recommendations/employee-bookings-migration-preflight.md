# Say Whether These Employee-Job Identities May Be Locked — Group Already-Loaded Bookings By The Same Job Stamp And Employee Submission Id, Then Refuse Only Those Two Fights — Never Block On Lead Collisions Or Prefix Twins, Never Load Mongo, Never Apply Indexes — operational story

- Status: recommended
- Service: `employeeBookings` (Wave A, in-progress)
- Pass: 8 of this service — `migrationPreflight.ts`
- Remaining in this service: `migrationApplySafety.ts`
- Target: `src/services/employeeBookings/migrationPreflight.ts`
- Knowledge: [`docs/knowledge/services/employee-bookings.md`](../../../docs/knowledge/services/employee-bookings.md) does **not** name this file in `applies_to` — do not invent a second Service. Duplicate-submission and Job-already-booked live on the happy-path table there; unique-index apply lives on [`bookings.md`](../../../docs/knowledge/services/bookings.md) (“One Booking per normalized Job Number remains the unique partial index contract; collisions block unique-index apply”; `employee_submission_id_unique` is the employee-origin `submission_id` index). This checkout’s `CONTEXT.md` defines `employee booking submission`, `booking lead reconciliation case`, `employee booking origin`, and `matching unavailable` — link those terms; do not invent a second glossary. `docs/adr/` is absent here — do not invent ADR copies. This inspect is **not** Book The Employee Job, **not** rematch, **not** Registry inventory, and **not** sibling apply-authorization.
- Callers: `scripts/migrations/operations-registry-inventory.lib.ts` borrows only `collectNormalizedCollisions` (Agents, Merchants, granularity keys / CRM labels — not this report). Barrel `employeeBookings/index.ts` does **not** re-export this file. `buildEmployeeBookingMigrationReport` and `reportHasBlockingCollisions` have **no** runtime caller — only `migrationPreflight.test.ts`. Submit, desk, attach, rematch, and policy do **not** import this file.
- Seams callers need: inspect these already-loaded bags vs refuse the lock. There is no Mongo load **adapter** and no apply **adapter**. Sibling `migrationApplySafety.ts` is a different fence (which connected database may `--apply`). Inventory’s borrow of the grouper is not a second employee-job **adapter**.
- Split later (only if the file outgrows one sitting): keep one file — this is already one sitting. Never `create.ts` / `update.ts` / `delete.ts` / `report.ts`. Identity stamps, options catalog, and apply-authorization stay siblings / other services.

`buildEmployeeBookingMigrationReport` / `reportHasBlockingCollisions` are executor mechanics. The owner question is: *We are about to lock the two unique Booking identities the employee form depends on — one Job Number per Booking, one submission id per employee Job. Someone already loaded the Bookings, Call Leads, Form Leads, and legacy Source Companies. Group Bookings that share the same Job stamp. Group employee Jobs that share a trimmed submission id. If either group has more than one id, refuse the lock. Also list Call Job, Form LID, phone, and name collisions, and active legacy granularities that are not form or call — but those never refuse. Empty stamps are not collisions. A manual Booking sharing a submission id with an employee Job is not a collision. Prefix twins are not a collision here. This file does not load Mongo. This file does not apply indexes. This file does not authorize a live-database apply.*

## What this file actually does

Two operations of one “say whether these employee-job identities may be locked” story, not “a CRUD preflight helper,” and not Book The Employee Job:

1. **Inspect already-loaded identities** — given bags of Bookings, Call Leads, Form Leads, and legacy Source Companies, group documents that share a normalized stamp. Bookings: every `job_no` through `normalizeJobNo` (the same stamp BookedLead `pre("validate")` writes to `normalized_job_no`). Employee Jobs only: trimmed `submission_id` where `booking_origin === "employee_booking"`. Call Leads: Job stamp. Form Leads: LID stamp, match phone, match name. Active legacy granularities whose channel is not `form` and not `call`. Empty / missing stamps skip. Groups sort by more ids first, then the stamp.
2. **Refuse the lock when a Booking identity collision exists** — true only when a Job-stamp group or an employee-submission group has more than one id. Call / Form / channel findings never flip the gate.

Grouping is a child of inspect. Finding candidates, booking the Job, rematch, and “may this CLI apply to this database” are other files. This file never writes Mongo, never POSTs Granot, and never creates an index.

## Organization

Keep one file. This is the screenplay for “may we lock these employee-job identities.” Job / LID / name stamps already live on `bookings/bookingIdentity.ts`. Phone match already lives on `utils/phone`. The unique index definitions already live on `BookedLead`. Do not pull those in. Do not invent a `MigrationPreflightService` class. Do not invent a load / apply **seam** — nobody fetches here, and sibling apply-authorization is the other fence.

Do not split this 90-line file. Inspect and refuse are two **seams** on one lock story, not two folders.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `buildEmployeeBookingMigrationReport` | `inspectEmployeeJobUniqueIdentities` | a later CLI / report **adapter** would hand already-loaded bags; none exists yet |
| `reportHasBlockingCollisions` | `refuseToLockWhenABookingIdentityCollisionExists` | apply must stop on Job or employee-submission fights only |

Keep the old names as one-line aliases until a real **adapter** migrates. Do not make callers learn `buildReport` or `HasBlocking` as the domain language.

`collectNormalizedCollisions` is a child of inspect. Keep the old name as a one-line alias because Registry inventory already imports it. Do not export it as domain language. Do not move it to `src/utils/`. Do not add `beginInspect` until a second real **adapter** exists.

**No class for the workflow.** The one type that earns a name is the inspection bag:

```ts
type EmployeeJobIdentityInspection = {
  bookedLeadJobNoCollisions: IdentityCollision[]
  bookedLeadSubmissionIdCollisions: IdentityCollision[]
  callLeadJobNoCollisions: IdentityCollision[]
  formLeadLidCollisions: IdentityCollision[]
  formLeadNormalizedPhoneCollisions: IdentityCollision[]
  formLeadNormalizedNameCollisions: IdentityCollision[]
  invalidSourceChannels: Array<{
    company_slug: string
    granularity_key: string
    channel: string
  }>
}

type IdentityCollision = { normalized: string; ids: string[] }
```

That is the handoff from “here are the live documents” to “may we lock.” Today’s `CollisionRecord` / `ReturnType<typeof build…>` is that bag without a name.

Leave `LeadSourceCompanyItem` on the legacy company **module**. Leave `normalizeJobNo` / `normalizeSubmissionLid` / `normalizeComparisonName` on booking identity. Leave `--apply` authorization on the sibling.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// migrationPreflight.ts
// We are about to lock the two unique Booking identities
// the employee form depends on.
// Someone already loaded the Bookings, Call Leads,
// Form Leads, and legacy Source Companies.
// Group Bookings that share the same Job stamp.
// Group employee Jobs that share a trimmed submission id.
// If either group has more than one id, refuse the lock.
// Also list Lead collisions and odd channels — they never refuse.
// Empty stamps are not collisions.
// Prefix twins are not collisions here.
// Loading Mongo and applying indexes are other files.

// ── 1. Inspect already-loaded identities ──────────────────

export function inspectEmployeeJobUniqueIdentities({
  bookedLeads,
  callLeads,
  formLeads,
  sourceCompanies,
})
  // Job stamp on every Booking
  // trimmed submission id on employee Jobs only
  // Job stamp on Call Leads (inventory)
  // LID / phone / name on Form Leads (inventory)
  // active legacy granularities that are not form or call (inventory)

function groupDocumentsThatShareThisNormalizedIdentity(docs, stamp)
  // skip missing / empty stamps
  // more than one id → a collision
  // sort: more ids first, then the stamp

function theJobStampOnThisBooking(doc)
  // sibling normalizeJobNo(job_no) — not the stored normalized_job_no column

function theEmployeeSubmissionId(doc)
  // only when booking_origin is employee_booking
  // trim; do not fold case or punctuation

function theOddActiveLegacyChannels(companies)
  // active && channel !== form && channel !== call

// ── 2. Refuse the lock when a Booking identity collision exists

export function refuseToLockWhenABookingIdentityCollisionExists(inspection)
  // Job-stamp groups > 0 OR employee-submission groups > 0
  // Call / Form / channel lists do not flip this
```

Read the path out loud: *Hand this file the already-loaded Bookings, Call Leads, Form Leads, and legacy Source Companies. Stamp each Booking Job the same way BookedLead pre-validate does. Group Bookings that share that stamp. Group employee Jobs that share a trimmed submission id. If either group has more than one id, refuse the unique-index lock. Also list Call Jobs, Form LIDs, phones, names, and active legacy granularities that are not form or call — but those never refuse. Empty stamps skip. A manual Booking sharing a submission id with an employee Job is not a collision. P5562366 and 5562366 are not a collision here — the unique index is the exact stamp. Then stop. Never load Mongo. Never apply indexes. Never authorize a live-database apply.*

That is the operation. `buildEmployeeBookingMigrationReport` is not.

Submit already 409s a second Job and 200s a duplicate employee submission. The unique indexes are the same contract under a race. This file is the inventory that must be clean before those indexes can be applied or trusted. Sibling apply-authorization is “which connected database may `--apply`.” Registry inventory only borrowed the grouper.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **The report and the gate have no runtime caller.** Only tests ask them. Inventory borrows the grouper for Agents and Merchants. Leave that honest. Do not invent a Mongo loader in this file so “preflight can run,” or delete the report so “nothing calls it.”

2. **Job collisions use `normalizeJobNo(job_no)`, not the stored `normalized_job_no`.** The unique index is on the stored column. If a row’s stamp drifted from pre-validate, this inspect can disagree with the index. Leave the live `job_no` stamp — that is what a new save would write. Do not switch to the stored column so “we match the index bytes” without a separate, tested pass.

3. **Job collisions are every Booking, not only `employee_booking`.** The unique partial index is global (`normalized_job_no` is a string). Do not filter to employee origin so “this is the employee folder,” or the lock would miss a Referral / leadless / ordinary Booking fighting the same Job.

4. **Submission collisions are employee origin only.** Matches `employee_submission_id_unique` (`booking_origin: "employee_booking"` and `submission_id` is a string). A manual Booking with the same trimmed id is ignored. Do not include every origin so “submission id should be globally unique,” or skip the origin filter so “the test that proves the partial scope fails.”

5. **Submission id is trim only.** No uppercase, no punctuation fold. `"Sub-1"` and `"sub-1"` are not a collision. Job stamps fold. Do not run `normalizeJobNo` on submission id so “everything is a stamp,” or the unique index (raw string) would disagree.

6. **Empty stamps are not collisions.** Missing `job_no`, blank submission id, blank LID / phone / name skip. That matches the partial `$type: "string"` indexes (null / missing rows stay out). Do not group empty as `""` so “we found the blanks.”

7. **Prefix twins are not a collision here.** `P5562366` and `5562366` are the same Job for Granot identity (`jobNumbersEquivalent`) and a different stored stamp for the unique index. This inspect groups the exact stamp. Do not call `jobNumbersEquivalent` so “the owner thinks they are the same Job,” or the lock report would refuse rows the index accepts.

8. **Call / Form / channel lists never refuse.** Lead Job Number is not globally unique (S08 indexes are non-unique). Duplicate LID / phone / name are auto-match inventory, not a Booking-index block. Do not OR those lengths into the gate so “leads should be unique too,” or drop them from the report so “the gate is the only list.”

9. **`invalidSourceChannels` is likely dead on the typed bag.** `LeadSourceChannel` is `"form" | "call"`. Legacy `toGranularityItem` folds anything else to `form`. Options now read Registry companies and **drop** non-form/call instead of reporting them. Leave the list. Do not switch this inspect to Registry `listSourceCompanies` so “options and preflight match” in this pass, or treat a folded `"form"` as odd.

10. **Sort is more ids first, then the stamp.** Operators see the worst pile first. Do not sort by first-seen id so “stable insert order,” or drop the sort so “maps are enough.”

11. **This file does not apply indexes and does not authorize `--apply`.** Sibling `migrationApplySafety.ts` is the connected-database fence. Do not import `assertMigrationApplyAuthorized` so “preflight is the whole migration,” or call `createIndex` so “a clean report should lock.”

12. **Registry inventory is not this story.** It groups Agent names, Merchant names, granularity keys, and CRM labels. Same child, different owner question. Do not pull inventory findings into this report so “one collision file,” or move the grouper to `src/utils/collisions.ts` so “DRY.”

13. **Today’s first test is a helper-unit test** of `collectNormalizedCollisions` with a toy `replace(/[-\s]/g, "")` that is not `normalizeJobNo`. That is not the story. Do not add another helper-unit test for the sort or the empty skip.

14. **Leave sibling modules alone.** `normalizeJobNo`, `normalizeSubmissionLid`, `normalizeComparisonName`, `normalizePhoneNumberForMatch`, and `assertMigrationApplyAuthorized` stay where they are. This file inspects and refuses.

15. **Do not treat Book The Employee Job, rematch, or Granot unique-index repair as this story.** Submit 409s / 200s at write time. `granot-lifecycle-indexes` / `granot-lifecycle-unique-index-repairs` own lifecycle indexes. RingCentral processed-call collisions are another script.

16. **Do not treat Sheet Sync drain or Domain Command begin / complete as this story.** There is no persist **seam**.

## Testing

The **interface** is the test surface: `inspectEmployeeJobUniqueIdentities`, `refuseToLockWhenABookingIdentityCollisionExists`.

Today’s `migrationPreflight.test.ts` proves a toy grouper, a Job+submission refuse, and the employee-origin filter on submission id. That is the right three beats, but the first test is past the **interface**.

Replace the helper-unit style with tests that name the operation:

**Inspect**
- `J-1` and `J 1` on two Bookings → one Job-stamp collision (ids of both).
- Two employee Jobs with the same trimmed `submission_id` → one submission collision.
- Employee + manual with the same `submission_id` → no submission collision (already locked).
- Missing / blank `job_no` or `submission_id` → not a collision.
- `P5562366` and `5562366` → no Job-stamp collision (exact stamp, not digit core).
- Two Call Leads with the same Job, two Form Leads with the same LID / phone / name → those lists are non-empty.

**Refuse the lock**
- Either Booking collision → refuse.
- Only Call / Form / channel findings → do not refuse.
- Empty bags → do not refuse.

**Refuse is not**
- Does not load Mongo. Does not apply an index. Does not call apply-authorization. Does not use `jobNumbersEquivalent`.

Do **not** add a test per helper (`groupDocumentsThatShareThisNormalizedIdentity`, `theEmployeeSubmissionId`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

`collectNormalizedCollisions` stays exported because Registry inventory is a real second caller of the child, not a test leak. Do not make inventory the test surface for this story.

## What I would not do

- A `MigrationPreflightService` class with `build` / `report` / `hasBlocking`.
- Thirty two-line functions that only wrap `Map.set`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or `report.ts`.
- Inventing a Mongo load **adapter** or an apply **adapter** so “preflight is complete.”
- Merging this with sibling `migrationApplySafety.ts`.
- Blocking on Call / Form / channel inventory, or treating prefix twins as the same Job here.
- Filtering Job collisions to `employee_booking` so “this folder is employee-only.”
- Moving `collectNormalizedCollisions` to `src/utils/` or folding Registry inventory into this report.
- Treating Book The Employee Job, rematch, Granot index repair, or RingCentral processed-call collisions as this story.
- Opening Wave B or the next service while this checklist has unchecked modules.
