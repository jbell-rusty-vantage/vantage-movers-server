# Book From The Source Form — operational story

- Status: recommended
- Service: `bookings` (Wave A, in-progress)
- Pass: 2 of this service — `bookedLeadFromSource.service.ts`
- Remaining in this service: `referralBooking.service.ts`, `leadlessBooking.service.ts`, `bookingMirror.service.ts`, `bookingSourceResolver.ts`, `bookingIdentity.ts`
- Target: `src/services/bookings/bookedLeadFromSource.service.ts`
- Knowledge: `docs/knowledge/services/bookings.md` (section 1, From source). This checkout’s `CONTEXT.md` does not define Booking terms — do not invent a glossary copy.
- Callers: `domainCommands/existingWrites.ts` (`runExistingCreateBookedLeadFromSource` → `createBookingFromLead`), `bookings/index.ts` → `v1.service.ts` (leftover public export). `POST /api/v1/booked-leads/from-source` already goes through the command adapter. Best Relocation sheet ingest hits that route, not this file. `domainCommands.test.ts` only asserts the `InTransaction` name still exists.
- Seams callers need: leftover public `book` vs canonical `begin` / `complete`; source override writes the Lead **before** the Booking; missing CPL is reported on different sides of commit depending on the adapter
- Split later (only if the file outgrows one sitting): keep one file — this is already one origin. Do not split into `create.ts`. Finding the Lead stays in `bookingSourceResolver.ts`.

Knowledge still titles this “Form/phone submission bridge → `createBookedLead`.” The names agree: `createBookedLeadFromSource`, `createBookedLeadFromSourceInTransaction`. Those are executor mechanics. The owner question is: *a Google Form or a phone booking arrived. Which Lead is that, did the form change the Source, and then book it.*

## What this file actually does

One operation, not “a CRUD service” and not Book This Lead:

1. **Book from the source form** — a Form or phone submission names a Lead by Form id, Call Job Number, or phone (not by `lead_ref`). Find that Lead, or let the resolver invent an Unmatched Call Lead. If the form sent a `source_company` override, assign that Source onto the Lead and reprice it **before** the Booking exists. Fence Best Relocation import against both the assigned company and the Lead’s stored company. Name the display `source` the sheets will show. Then hand the Mongo ids to **Book This Lead**.

Finding the Lead, inventing an Unmatched Call, job-number 409, and phone-match writes are `bookingSourceResolver.ts`. The Booking write, ignore / rebook / insert, Lead mirror, and sheets are `bookedLead.service.ts`. Referral, Leadless, employee claim, and Granot Owner confirm are not this file.

## Organization

Keep one file. This is the screenplay for “the form told us which Lead.” Lead lookup, Source Assignment, CPL snapshot, Best Relocation fence, agent-name split, and Book This Lead already live in deeper **modules**. Do not pull those in. Do not invent a `BookedLeadFromSourceService` class.

If it later outgrows one sitting, the split is still this origin vs the resolver, never CRUD.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `createBookedLeadFromSource` | `bookFromTheSourceForm` | leftover public path: run the whole story |
| `createBookedLeadFromSourceInTransaction` | `beginBookingFromTheSourceForm` | canonical `createBookingFromLead` needs the write before commit |
| returned `finalize` | `completeBookingFromTheSourceForm` | Book This Lead’s after-commit, then missing CPL if the override left a hole |

Keep the old names as one-line aliases until `existingWrites` and the leftover barrel migrate. Do not make callers learn `InTransaction` as the domain language.

**No class for the workflow.** A class here would be a folder with a constructor. The one type that *does* earn a name is the pending book-from-form bag:

```ts
type BookingFromTheSourceFormInProgress = {
  input: CreateBookedLeadFromSourceInput
  lead: SourceLeadDocument
  leadModel: "FormLead" | "CallLead"
  jobNo?: string
  bookingSource: string
  isBestRelocationImport: boolean
  overrideResolution?: LeadSourceAssigned
  pendingBook: BookingThisLeadInProgress   // today’s createBookedLeadInTransaction result
}
```

That is the handoff from “the Lead is found (and maybe reassigned) and Book This Lead has written” to “tell the sheets, then tell the owner if the override left a CPL hole.”

Today the command adapter returns `result: undefined` and builds EntityChange mutations in this file. Keep that **seam**. Do not move mutation planning into `existingWrites` “because the direct book path does it there.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// bookedLeadFromSource.service.ts
// A Google Form or phone booking arrived.
// Find the Form or Call it means. If the form overrode the Source,
// rewrite that onto the Lead first. Then book it.
// Finding / inventing that Lead is bookingSourceResolver.ts.
// The Booking write is bookedLead.service.ts.

// ── 1. Book from the source form ──────────────────────────

export async function bookFromTheSourceForm(input)
export async function beginBookingFromTheSourceForm(raw, tx)
export async function completeBookingFromTheSourceForm(pending)

async function readTheSourceForm(raw)                 // command adapter parses Zod; public is already typed
async function findTheLeadTheFormNamed(input)         // resolveBookingSourceLead — sibling
async function maybeReassignTheLeadSource(input, lead, leadModel, session?)
  // only when source_company is on the form; channel from the Lead model
async function repriceTheLeadAfterTheOverride(lead, leadModel, assignment)
async function rememberTheSourceOverride(lead, assignment, session?)
async function fenceBestRelocationImport(input, assignedCompany, leadStoredCompany)
  // first: assigned/effective company; if that is a BR import, again: Lead’s stored company
function nameTheBookingSourceForTheSheets(lead, assignment?, effectiveCompany)
async function splitTheFormAgents(input)              // deriveBookedLeadAgentAllocations — sibling
async function handOffToBookThisLead(prepared, tx?)   // begin or leftover public book
function planTheOverrideAndBookingMutations(pending)  // command only; skip Booking/booked rows on duplicate
async function reportAMissingCplAfterTheOverride(lead, assignment)
```

Read the path out loud: *Read the form. Find the Lead it named, or let the resolver invent an Unmatched Call. If the form sent a Source Company, assign it, reprice, and save that onto the Lead before any Booking exists. Fence Best Relocation: the assigned company and the Lead’s stored company must both be `best_relocation_leads`. Name the display source from the snapshots, else the company. Split the form’s agent names. Hand the Mongo ids to Book This Lead. After commit: finish Book This Lead, then if the override left a missing CPL rate, tell the owner.*

That is the operation. `createBookedLeadFromSourceInTransaction` is not.

The leftover public path says the same story, except missing CPL is reported **right after the Lead save**, before Book This Lead runs.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Two copies of the whole story.** `bookFromTheSourceForm` and `beginBookingFromTheSourceForm` both find the Lead, resolve an optional override, double-fence Best Relocation, pick the display source, split agents, and hand off. One story, two **adapters** (leftover public vs command). Shared beats: find Lead, maybe reassign, fence, name display source, split agents, hand off. Only the transaction / `finalize` wrapper, EntityChange mutations, and *when* missing CPL is reported differ.

2. **Missing CPL sits on different sides of commit.** Knowledge already records this. Public `bookFromTheSourceForm` calls `recordMissingLeadCplRate` immediately after `lead.save()`, **before** Book This Lead. Canonical `completeBookingFromTheSourceForm` reports it after the Booking commit. That is why the command can roll back an override: the Lead save uses `tx.session`. The public path cannot. Rename both so the gap is visible. Do **not** silently teach the public function to wait, or the command to report inside the write.

3. **Best Relocation is fenced twice on purpose.** First `requireBestRelocationImportSource(ingestion_source, assignedOrLeadCompany)`. If that returns true, require again with `effectiveBookingSourceCompany(undefined, lead)` — the Lead’s stored company, ignoring the override. A form cannot make a non-BR Lead importable by overriding to `best_relocation_leads`, and cannot import a BR Lead while overriding it away. Knowledge only says “requires `best_relocation_leads`.” Do not collapse to one check so the name “feels simpler.”

4. **`effectiveBookingSourceCompany`’s override branch is unused here.** Both call sites pass `undefined` and read the Lead. The override already went through `resolveLeadSourceAssignment`. Do not start passing the raw form string into this helper — that helper casts the trim to `SourceCompany` without Registry assignment.

5. **`complete` rebuilds the Book This Lead bag and drops the BR flags.** `allow_inactive_agents`, `set_primary_agent_as_receiver`, and `receiver_agent_source_value` are passed into `begin` and omitted from `finalizeBookedLeadCreateAfterCommit`. Finalize only projects sheets and owner events; it does not resolve agents again. Keep the omit. Do not “complete the type” by sending the flags through.

6. **Source override is not gated on “we wrote a new Booking.”** A repeat `submission_id` still saves the override (public and command) and still records the Lead `source_company` EntityChange (command). Booking / `booked` mutations are skipped on `kind === "duplicate"`. Do not skip the override because “nothing booked.”

7. **Command `revision_before` is read after the write.** The Booking mutation does `BookedLead.findById` after `beginBookingThisLead`. The Lead `booked` mutation uses `revisionBefore + 1` when an override just saved, else `lead.domain_revision` after the mirror. Direct `createBookingFromLead` in `existingWrites` does the same post-write read. Do not silently “correct” the numbers here.

8. **Command parses Zod again.** The route already parsed `createBookedLeadFromSourceSchema`. `begin` parses `rawInput` a second time. Public assumes a typed object. Keep the command parse — `existingWrites` forwards `unknown`. Do not delete it “because the route already validated.”

9. **Public override can survive a failed book.** `lead.save()` has no session. If Book This Lead throws, the Lead already has the new assignment and a missing-rate event may already have fired. The command rolls both back together. Do not wrap the leftover public path in a transaction so the adapters “agree.”

10. **Display `source` is a label, then Book This Lead may pick again.** This file prefers CRM / granularity / company snapshots, else the effective company slug, and passes that as `input.source`. `bookedLead.service.ts` then runs its own ladder (Form-Lead company correction → snapshots → resolved company label → request `source`). After an override, the Lead already has new snapshots, so the second ladder usually agrees. Do not call `resolveBookedLeadSource` from here, and do not delete this file’s label so “only one function names the source.”

11. **Leave sibling modules alone.** `resolveBookingSourceLead`, Unmatched Call create, job-number 409, phone-match writes, `resolveLeadSourceAssignment`, `resolveLeadCplSnapshot`, `deriveBookedLeadAgentAllocations`, `requireBestRelocationImportSource`, and Book This Lead stay where they are. This file orchestrates them.

12. **Do not treat Book This Lead, Referral, Leadless, employee claim, or Granot Owner confirm as this story.** Direct `POST /api/v1/booked-leads` already has a Mongo `lead_ref`. Referral / leadless write a Booking with no Lead. Employee claim is the mirror file. Owner confirm is `domainCommands/bookings.ts`.

13. **`createBookedLeadFromSource` is no longer the HTTP path.** `POST /api/v1/booked-leads/from-source` is `runExistingCreateBookedLeadFromSource` → `begin` / `complete`. The leftover public function remains because the barrel and `v1.service` still export it. Do not delete it “because the route moved.”

## Testing

The **interface** is the test surface: `bookFromTheSourceForm`, `begin` / `complete` for commands.

There is no `bookedLeadFromSource.service.test.ts`. Zod coverage lives in `v1.validation.test.ts`. `domainCommands.test.ts` only asserts that the `InTransaction` name still exists. Resolver, fence, CPL, and Book This Lead have their own files. That is not enough for a story this long.

Add tests that name the operation. Do not add a test per helper.

**Book from the source form**
- A Form Lead id plus `job_no` is found, then Book This Lead is called with that `lead_ref` / `lead_model` and the form’s job number.
- A Call Job Number / phone is found (or an Unmatched Call is invented) by the resolver, then handed off. Do not re-test job 409 or unmatched-stub field defaults here.
- No `source_company` on the form → Lead is not saved for assignment; display source comes from existing snapshots or the stored company.
- `source_company` override → `assignLeadSource` (channel `form` vs `call` from the Lead model, Move Type and site from the Lead) writes the assignment + a new CPL snapshot onto the Lead **before** Book This Lead.
- Public path: missing CPL is reported after that Lead save and **before** Book This Lead.
- Command path: missing CPL is reported in `complete`, **after** Book This Lead’s after-commit. A thrown book rolls back the override (session).
- Repeat `submission_id` still persists a source override; command still emits the Lead `source_company` mutation and skips Booking / `booked` mutations.
- Best Relocation `ingestion_source` + assigned company `best_relocation_leads` + Lead stored company `best_relocation_leads` → `allow_inactive_agents`, `set_primary_agent_as_receiver`, `receiver_agent_source_value: Booked Deals:<job>`.
- Best Relocation + override to `best_relocation_leads` when the Lead is **not** that company → refused (second fence).
- Best Relocation + override **away** from `best_relocation_leads` → refused (first fence).
- Agents come from `agent` / optional `split_agent` / `binder_amount`, not `agent_allocations[]`.
- Optional `customer_name` / `customer_phone` are forwarded. Missing `job_no` on a Call path is allowed on this **interface** (resolver may return none).
- `complete` does not pass the Best Relocation agent flags into `finalizeBookedLeadCreateAfterCommit`.

Do **not** add a test per helper (`nameTheBookingSourceForTheSheets`, `fenceBestRelocationImport`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

`begin` / `complete` stay exported because canonical commands are a second real **adapter**, not a test leak.

Do not re-test `resolveBookingSourceLead`, Unmatched Call create, Book This Lead’s ignore / rebook / insert, Referral job collision, leadless reconciliation cases, or `claimAvailableLeadForBooking` here.

## What I would not do

- A `BookedLeadFromSourceService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `resolveBookingSourceLead` or `createBookedLead`.
- Moving this into a CRUD folder “for cleanliness.”
- Breaking the before-commit / after-commit **seam**. Command missing-CPL must not sit inside the Mongo write; public missing-CPL must not be silently moved after book.
- Collapsing the two Best Relocation fences, or passing the raw form string into `effectiveBookingSourceCompany`.
- Teaching the leftover public path a transaction, or deleting it because the route already uses the command.
- Pulling Lead lookup, Unmatched Call create, Book This Lead, Referral, Leadless, employee claim, or Granot Owner confirm into this file.
- Writing a whole-folder `bookings` recommendation in this pass.
