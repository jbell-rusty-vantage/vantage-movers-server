# Book A Leadless Job — operational story

- Status: recommended
- Service: `bookings` (Wave A, in-progress)
- Pass: 4 of this service — `leadlessBooking.service.ts`
- Remaining in this service: `bookingMirror.service.ts`, `bookingSourceResolver.ts`, `bookingIdentity.ts`
- Target: `src/services/bookings/leadlessBooking.service.ts`
- Knowledge: `docs/knowledge/services/bookings.md` (section 4, Leadless). This checkout’s `CONTEXT.md` does not define Booking terms — do not invent a glossary copy.
- Callers: `domainCommands/existingWrites.ts` (`runExistingCreateLeadlessBooking` → `createLeadlessBookingInTransaction`), `bookings/index.ts` → `v1.service.ts` (leftover public export). `POST /api/v1/leadless-bookings` already goes through the command adapter. Best Relocation sheet ingest hits `applyPlan` → domain `createLeadlessBooking`, not this file. `domainCommands.test.ts` only asserts the `InTransaction` / `persist` names still exist. Ingestion tests mock the command.
- Seams callers need: leftover public `book` vs canonical `begin` / `complete`; Best Relocation import is provenance on the command and a body flag on the leftover path; job collision is checked before the write; sheets run after commit
- Split later (only if the file outgrows one sitting): keep one file — this is already one origin. Do not split into `create.ts`. Employee public submit writes its own Leadless + case in `employeeBookings/`.

Knowledge still titles this “Leadless bookings; Best Relocation import may open a `BookingLeadReconciliationCase`.” The names agree: `createLeadlessBooking`, `createLeadlessBookingInTransaction`, `persistLeadlessBookingCreateInTransaction`. Those are executor mechanics. The owner question is: *there is no Lead in Mongo. Someone typed a Job Number, a Source Company, agents, and a deposit. Book that as Leadless, or stop if that Job already exists. If Best Relocation imported the row, also open a pending case so a Lead can be attached later.*

## What this file actually does

One operation, not “a CRUD service” and not Book a Referral:

1. **Book a Leadless Job** — no Form or Call is attached. Resolve a Source from the company (and optional label). Refuse if that raw `job_no` already exists. Resolve agents (name + optional split; inactive allowed only on Best Relocation import) and Merchant first. Remember the customer only when a name was typed. Write a Booking stamped `is_leadless_booking` with a display `source`. If this is a Best Relocation import, open a pending `BookingLeadReconciliationCase` (`origin: external_sheet_ingestion`, `reason: no_match`) in the same write. Remember Master Booked Sheet Sync. After commit, project that row.

Finding a Lead, booking a Lead, Referral, employee claim, and attaching a Lead later (`attachBookingToLead`) are not this file. Correction, public delete, and public cancel live on `bookedLead.service.ts` / cancelled-lead and already 409 Leadless update and ordinary cancel.

## Organization

Keep one file. This is the screenplay for “the owner booked a Job with a Source and no Lead.” Source Assignment, the Best Relocation fence, agent name-split, Merchant, Customer upsert, zero-binder warnings, and Sheet Sync already live in deeper **modules**. Do not pull those in. Do not invent a `LeadlessBookingService` class.

If it later outgrows one sitting, the split is still this origin vs employee Leadless, never CRUD.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `createLeadlessBooking` | `bookALeadlessJob` | leftover public path: run the whole story |
| `createLeadlessBookingInTransaction` | `beginBookingALeadlessJob` | canonical `createLeadlessBooking` needs the write before commit |
| `persistLeadlessBookingCreateInTransaction` | `writeTheLeadlessJob` | shared write: customer, Booking, optional BR case, sheet intent |
| leftover / command after-commit | `completeBookingALeadlessJob` | Master Booked Sheet Sync + populate after commit |

Keep the old names as one-line aliases until `existingWrites` and the leftover barrel migrate. Do not make callers learn `InTransaction` as the domain language. `domainCommands.test.ts` greps this file for the `InTransaction` / `persist` strings — leave those aliases until that assertion moves.

**No class for the workflow.** A class here would be a folder with a constructor. The one type that *does* earn a name is the pending leadless bag:

```ts
type BookingALeadlessJobInProgress = {
  booking: BookedLeadDocument
  warnings: string[]
}
```

That is the handoff from “the Leadless Job is saved, the optional BR case is open, and Master Booked intent is remembered” to “project that row and give the owner the populated Booking.”

Today the leftover public path does `finalizeSheetSync` + `populateBookedLead` inline. The command adapter repeats that pair in `existingWrites`. Referral already returns `finalize` from `begin`. Export `completeBookingALeadlessJob` so both adapters share it. Do not leave the after-commit beat only in the route adapter “because `begin` has no finalize today.”

Today the command adapter builds one `BookedLead` EntityChange here (`revision_before: 0`). Keep that **seam**. Do not move mutation planning into `existingWrites` “because the leftover public path has none.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// leadlessBooking.service.ts
// There is no Lead in Mongo.
// Someone typed a Job Number, a Source Company, agents, and a deposit.
// Book that as Leadless, or stop if that Job already exists.
// If Best Relocation imported the row, open a pending case
// so a Lead can be attached later.
// Booking a Lead, Referral, and employee public submit are other files.

// ── 1. Book a Leadless Job ────────────────────────────────

export async function bookALeadlessJob(input)
export async function beginBookingALeadlessJob(input, tx)
export async function writeTheLeadlessJob(input, prepared, tx)
export async function completeBookingALeadlessJob(pending)

async function assignTheSourceForThisJob(sourceCompany, sourceLabel?)
  // value = label ?? company; channel = /inbound|call/i on the label only
function thisIsABestRelocationImport(ingestionSource, companySlug)
  // requireBestRelocationImportSource — sibling fence
function refuseIfThisJobAlreadyExists(jobNo, session?)
  // raw job_no after trim — not normalized_job_no
async function prepareTheLeadlessJobBeforeTheWrite(input, resolvedSource, isBrImport)
  // derive allocations; resolve agents (inactive only if BR); Merchant; warnings
  // stored source = typed label or assignment snapshot
async function rememberTheCustomerWhenANameWasTyped(name, phone, session)
  // skip upsert when the name is blank
async function writeTheLeadlessBooking(prepared, customer, now, session)
  // is_leadless_booking: true, no lead_ref / lead_model
  // over_2000 / over_4000 from deposit
async function openAPendingImportCaseWhenBestRelocationImported(booking, prepared, session)
  // origin external_sheet_ingestion, reason no_match, empty candidates
async function rememberMasterBookedSheetSync(bookingId, session)
  // booked_lead / leadless_booking.create — not booking_chain
async function projectTheLeadlessJobOntoSheets(bookingId)
```

Read the path out loud: *Assign the Source from the company or the optional label. Fence Best Relocation to that resolved company. Refuse if this Job Number already exists. Prepare the agents and the Merchant. Remember the customer only if they typed a name. Write a Booking that is Leadless — no Lead, a real Source. If Best Relocation imported it, open a pending case. Remember Master Booked Sheet Sync. After commit: project that row.*

That is the operation. `createLeadlessBookingInTransaction` is not.

The leftover public path says the same story, except the clock is `new Date()` instead of `tx.now`, the job collision check has no session, and Best Relocation is the body `ingestion_source` flag. The command path stamps that flag from `provenance.origin === "external_sheet_ingestion"` and drops the body value.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Two copies of the prepare story.** `bookALeadlessJob` and `beginBookingALeadlessJob` both assign the Source, fence BR, refuse the Job, split agents, resolve Merchant, then call `writeTheLeadlessJob`. One story, two **adapters** (leftover public vs command). Shared beats: assign Source, fence, refuse Job, prepare, write. Only the transaction / `complete` wrapper, the clock (`tx.now` vs `new Date()`), how BR is detected, and EntityChange mutations differ.

2. **After-commit is copied, not returned.** Referral’s `begin` returns `finalize`. This file’s leftover public calls `finalizeSheetSync` + `populateBookedLead` itself. The command adapter repeats that pair in `existingWrites`. Extract `completeBookingALeadlessJob`. Do not leave sheets in the adapter “because this begin has no finalize.”

3. **Command BR is provenance, leftover BR is the body flag.** `runExistingCreateLeadlessBooking` sets `ingestion_source: "best_relocation_sheet"` only when `context.provenance.origin === "external_sheet_ingestion"`, else `undefined`. `POST /api/v1/leadless-bookings` always builds `vantage_admin` provenance, so a body `ingestion_source` on that route never opens a case. The leftover public function still honors the body flag. Knowledge says “case only when `ingestion_source=best_relocation_sheet`” without that split. Do **not** silently teach the command to honor the body, or the leftover path to ignore it.

4. **A leftover public BR write cannot later attach or cancel as an import.** `attachBookingToLead` and cancelled-lead’s `requiredSourceConnectionKey` look for a `DomainCommandExecution` with `command_name: "createLeadlessBooking"` and matching `source_connection_key`. The leftover public path never writes that row. Do not wrap leftover public in a command so attach/cancel “agree.”

5. **Job collision is the raw string, not the unique index.** Both adapters `findOne({ job_no: trimmed })`. Knowledge already records this. The model unique contract is partial `{ normalized_job_no }`. `bookingIdentity.ts` already knows digit-core equivalence (`P100` vs `100`). A differently cased or prefixed Job can pass this 409 and still fail the unique index — or miss a sibling Booking the owner would call “the same Job.” Rename `refuseIfThisJobAlreadyExists` so the raw lookup is visible. Do **not** silently switch to `equivalentNormalizedJobFilter`. Referral copies the same raw check; leave that file alone.

6. **The leftover public clock is wall time.** Command stamps `toFloridaTimestamp(tx.now)`. Public stamps `toFloridaTimestamp(new Date())`. The BR case `match_attempts[0].attempted_at` is `new Date()` even on the command path. Canonical replay / executor time is the command clock. Do not teach the leftover path `tx.now`, or the case attempt `tx.now`, so the clocks “agree.”

7. **Public job check has no session.** Two leftover public writers can both pass `findOne` and then one hits the unique index. The command check uses `tx.session`. Do not wrap the leftover public path in a transaction so they “agree.”

8. **Channel is the optional label, not the company.** `assignTheSourceForThisJob` sets `channel: "call"` only when `source` matches `/inbound|call/i`. A `source_company` of `"Best Relocation Inbounds"` with no `source` is still `form`. The assignment `value` is `sourceLabel ?? sourceCompany` — when a label is present, `source_company` is not passed as `company_slug`. Rename so that fallback is visible. Do not also regex the company, or pass both fields, so resolution “feels complete.”

9. **Stored `source` is a display label.** Typed `source` wins after trim. Otherwise the assignment snapshot (crm / granularity / company label, then slug). This is not Referral’s constant `"referral"`. Do not write `source_company` onto the Booking, or stamp `source: "leadless"`.

10. **Agents and Merchant stay outside the write.** Same load-bearing comment as Book This Lead / Referral. Catalog resolves run before `runSheetSyncWrite` / the command transaction. Customer upsert stays **inside** the write (session), and only when a name was typed. Do not move agent resolve inside, or customer upsert outside, while renaming.

11. **Customer is optional.** Referral requires a name. This file skips `upsertCustomerFromBookingContact` when `customer_name` is blank, and omits `customer_name` / `customer` on the Booking. Phone alone does not create a Customer. Do not upsert from phone so Leadless “matches Referral.”

12. **No `booking.created` event.** Book This Lead tells the owner `created` / `upserted` / `duplicate_submission_ignored`. This file only returns a message string and warnings. Do not add an observability event so Leadless “matches” lead-attached book.

13. **Sheet Sync is Master Booked, not the Booking Chain.** Job is `resource: "booked_lead"`, `operation: "leadless_booking.create"`. There is no source-lead row to refresh. Do not enqueue `booking_chain` because lead-attached book does.

14. **Binder is the owner’s total, then split.** `deriveBookedLeadAgentAllocations` is called with `binder_amount: input.total_binder_amount`. This file never calls `resolveTotalBinderAmount`. Stored `total_binder_amount` is the request field. Do not recompute from allocations here so the name “feels honest.”

15. **Client cannot stamp Leadless.** Zod rejects `is_leadless_booking`. The server writes `is_leadless_booking: true`. `local` is optional on this Zod (same `bookedLeadFields.local` as Referral). Do not accept the flag from the body “for flexibility.”

16. **Best Relocation may use inactive agents and must open the import case.** `resolveAgentAllocations(..., { includeInactive })` and `openAPendingImportCaseWhenBestRelocationImported` are the import flavor, not a second operation. The case is `pending` / `no_match`, `origin: "external_sheet_ingestion"`, empty `latest_candidates`, hash `${jobNo}:external_sheet_ingestion`, policy `best-relocation-conservative-v1`, no enabled rules. Phone sentinels are `"not provided"` / `"not_provided"`. Do not copy employee matching candidates or `employee_booking` origin into this case so the two Leadless writers “share a case builder.”

17. **Ordinary admin does not open a case.** Knowledge already says this. The HTTP command path cannot open one even with a body flag (see 3). Do not add a case on every Leadless write “so attach has somewhere to go.”

18. **Command parses Zod again.** The route already parsed `createLeadlessBookingSchema`. `runExistingCreateLeadlessBooking` parses `raw` a second time, then calls `begin`. This file assumes a typed object. Keep the command parse — `existingWrites` forwards `unknown`. Do not delete it “because the route already validated.”

19. **Leave sibling modules alone.** `resolveLeadSourceAssignment`, `requireBestRelocationImportSource`, `deriveBookedLeadAgentAllocations`, `resolveAgentAllocations`, `resolveActiveMerchantName`, `upsertCustomerFromBookingContact`, `buildBookedLeadWarnings`, `populateBookedLead`, `normalizeJobNo` / `normalizeComparisonName`, Sheet Sync, Referral, Book This Lead, and `employeeBookings/submitEmployeeBooking.service.ts` stay where they are. This file orchestrates the public Leadless write.

20. **Do not treat employee Leadless as this story.** Public employee submit writes `is_leadless_booking: true` and its own `BookingLeadReconciliationCase` (employee matching policy, candidates, retry) inside `submitEmployeeBooking.service.ts`. It does **not** call this file. Attaching a Lead later is `attachBookingToLead` / `bookingLeadAttachment.service.ts`.

21. **`createLeadlessBooking` is no longer the HTTP path.** `POST /api/v1/leadless-bookings` is `runExistingCreateLeadlessBooking` → `begin` + adapter `complete`. The leftover public function remains because the barrel and `v1.service` still export it. Do not delete it “because the route moved.” Knowledge’s HTTP table still names the leftover function — do not silently rewrite the Service doc in this pass.

22. **Correction, delete, and cancel are not this file.** Public update of a Leadless is 409 in `bookedLead.service.ts`. Public cancel is 409 unless cancelled-lead is given `allowLeadless` (Best Relocation import). Public delete is allowed (no Lead to clear). Do not pull those guards here.

## Testing

The **interface** is the test surface: `bookALeadlessJob`, `begin` / `complete` for commands.

There is no `leadlessBooking.service.test.ts`. Zod coverage lives in `v1.validation.test.ts` (owner fields, optional customer, rejected `is_leadless_booking`). `domainCommands.test.ts` only asserts that the `InTransaction` / `persist` names still exist. Ingestion tests mock domain `createLeadlessBooking`. That is not enough for this story.

Add tests that name the operation. Do not add a test per helper.

**Book a Leadless Job**
- Owner fields (Job, `source_company`, agent, binder, deposit, merchant) write a Booking with `is_leadless_booking: true`, a display `source`, and **no** `lead_ref` / `lead_model`.
- Same raw `job_no` already on a Booking → 409, **no** write, **no** sheet job, **no** case.
- A differently normalized sibling Job (`P100` vs `100`, or case-only) is **not** refused by this 409 (lock the raw lookup). Unique-index failure remains the model’s job.
- Blank `customer_name` → no Customer upsert, no `customer` / `customer_name` on the Booking. Phone alone does not create a Customer.
- Typed name upserts from name / optional phone, not from a Lead.
- Agents come from `agent` / optional `split_agent` / `total_binder_amount`, not `agent_allocations[]`. Same name as split → 400 from the derive helper (do not re-test the helper’s arithmetic).
- Merchant is resolved **before** the Mongo write. Agents are active-only on the ordinary path.
- Optional `source` matching `/inbound|call/i` assigns channel `call`; `source_company` containing “Inbounds” with no `source` stays `form`.
- When `source` is omitted, stored `source` is the assignment snapshot, not the raw `source_company` string (unless that is what the snapshot chose).
- Deposit drives `over_2000` / `over_4000` (`>` 2000 / 4000).
- Sheet Sync intent `booked_lead` / `leadless_booking.create` is remembered **before** commit and dispatched **after**. No `booking_chain`. No `booking.created` event.
- Ordinary leftover public / `vantage_admin` command path: **no** `BookingLeadReconciliationCase`.
- Leftover public with body `ingestion_source: "best_relocation_sheet"` and resolved company `best_relocation_leads`: inactive agents allowed, case opened (`external_sheet_ingestion` / `no_match` / empty candidates).
- Leftover public with that flag and a non-BR resolved company → 400, no write.
- Command path with `provenance.origin: "external_sheet_ingestion"`: same BR case, even if the parsed body omitted `ingestion_source`.
- Command path with `vantage_admin` provenance: no case even if the body included `ingestion_source: "best_relocation_sheet"`.
- Command path stamps Florida time from `tx.now`. Leftover public path stamps `new Date()`. Case `attempted_at` stays wall time on both.
- Command path: a thrown write rolls back the Booking, the customer upsert, and the case (session). Leftover public uses `runSheetSyncWrite` for that set.
- `complete` populates customer + agents and returns `message: "Leadless booking created."`

Do **not** add a test per helper (`assignTheSourceForThisJob`, `writeTheLeadlessBooking`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

`begin` / `complete` stay exported because canonical commands are a second real **adapter**, not a test leak. Keep exporting `writeTheLeadlessJob` (today’s `persist`) until the name-grep test moves.

Do not re-test Book This Lead’s ignore / rebook / insert, from-source override, Referral’s `"referral"` stamp, `claimAvailableLeadForBooking`, employee Leadless cases, or `attachBookingToLead` ownership here.

## What I would not do

- A `LeadlessBookingService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `save` or `persistSheetSyncIntent`.
- Moving this into a CRUD folder “for cleanliness.”
- Breaking the before-commit / after-commit **seam**. Sheets must not sit inside the Mongo write.
- Switching the Job 409 to `normalized_job_no` / digit-core equivalence so it “matches the unique index.”
- Teaching the leftover public path `tx.now` or a command transaction, or deleting it because the route already uses the command.
- Teaching the command to honor body `ingestion_source`, or leftover public to ignore it, so BR “agrees.”
- Enqueueing `booking_chain`, emitting `booking.created`, calling `mirrorBookingToLead`, or opening a recon case on every Leadless write.
- Pulling Referral, Book This Lead, employee submit, or `attachBookingToLead` into this file.
- Writing a whole-folder `bookings` recommendation in this pass.
