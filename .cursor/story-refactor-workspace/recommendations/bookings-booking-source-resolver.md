# Find The Lead This Booking Names — operational story

- Status: recommended
- Service: `bookings` (Wave A, in-progress)
- Pass: 6 of this service — `bookingSourceResolver.ts`
- Remaining in this service: `bookingIdentity.ts`
- Target: `src/services/bookings/bookingSourceResolver.ts`
- Knowledge: `docs/knowledge/services/bookings.md` (from-source step 1; Unmatched Call Leads; `resolveBookedLeadSource` ladder). Phone pick is `docs/knowledge/services/bookings.md` plus `leads-lead-phone-matching.md`. This checkout’s `CONTEXT.md` does not define Booking / Unmatched Call Lead — do not invent a glossary copy.
- Callers: `bookedLeadFromSource.service.ts` (`resolveBookingSourceLead` + `effectiveBookingSourceCompany(undefined, lead)`), `bookedLead.service.ts` (`getFormLeadSourceCompanyForBooking` on Book This Lead), `bookings/index.ts` barrel. No dedicated test file. Zod covers from-source identity; `domainCommands.test.ts` greps the from-source `InTransaction` name, not this file.
- Seams callers need: named Form load vs Call job / phone / invent; Best Relocation import filter on Call search only; Lead writes here commit before Book This Lead; Form company correction vs read-the-Lead-company
- Split later (only if the file outgrows one sitting): `findTheLeadThisBookingNames.ts`, `inventAnUnmatchedCallLead.ts`, `nameTheCompanyThisBookingWillPersist.ts` — never `create.ts` / `update.ts` / `delete.ts`

Knowledge still titles this a helper under “From source.” The names agree: `resolveBookingSourceLead`, `effectiveBookingSourceCompany`, `getFormLeadSourceCompanyForBooking`. Those are lookup mechanics. The owner question is: *a Google Form or a phone booking arrived. Which Form or Call is that? If we cannot find a Call, invent an Unmatched Call so we still have something to book. And when we already have a Lead, which Source Company should the Booking — and maybe the Form Lead — remember?*

## What this file actually does

Three operations, not “a resolver helper” and not Book From The Source Form:

1. **Find the Lead this booking names** — Form: load the id they typed. Call: look for that raw Job Number (409 if more than one in the newest five). Else pick a Call Lead by phone. Else invent an Unmatched Call Lead (`created_on_unmatched: true`) so Book From The Source Form still has a Lead to hand to Book This Lead.
2. **Read the company the Booking will persist from the Lead** — after from-source has already run Registry assignment (or decided there is no override), read `lead.source_company`, or `"not_provided"`. The “override” argument is unused at both call sites.
3. **Correct the Form Lead company when the Booking source maps differently** — Book This Lead only. If this is a Form Lead and `input.source` maps (config aliases, not Registry) to a different company than the Lead stores, return that company so the Booking display ladder and the Lead mirror can rewrite it. Call Leads return nothing; their company was settled when the Lead was found or invented.

Book From The Source Form, Book This Lead, phone pick, Form Fill detect, Source Assignment, CPL stamp, Referral, Leadless, employee claim, and Granot Owner confirm are not this file. They call these three **interfaces**, or they never ask “which Lead.”

## Organization

Keep one file. This is the screenplay for “which Lead, and which company, does this booking mean.” Named load, phone pick, Form Fill detect, Source Assignment, CPL snapshot, and the Best Relocation search filter already live in deeper **modules**. Do not pull those in. Do not invent a `BookingSourceResolverService` class.

If it later outgrows one sitting, split by **story** (find / invent unmatched / name the company), never CRUD. Do not move the find into `bookedLeadFromSource.service.ts` “because only from-source calls it.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `resolveBookingSourceLead` | `findTheLeadThisBookingNames` | from-source leftover and command both need a Lead (or an invented Unmatched Call) before they book |
| `effectiveBookingSourceCompany` | `readTheLeadCompanyThisBookingWillUse` | from-source Best Relocation fence #2 and display fallback read the Lead, ignoring the form override |
| `getFormLeadSourceCompanyForBooking` | `correctTheFormLeadCompanyIfTheBookingSourceDisagrees` | Book This Lead may rewrite a Form Lead’s company from the display `source` string |

Keep the old names as one-line aliases until from-source, Book This Lead, and the bookings barrel migrate. Do not make callers learn `resolve` / `effective` as the domain language.

**No class for the workflow.** A class here would be a folder with a constructor. The one type that *does* earn a name is the handoff from-source already destructures:

```ts
type SourceLeadThisBookingNamed = {
  lead: SourceLeadDocument
  leadModel: "FormLead" | "CallLead"
  jobNo?: string
}
```

That is today’s return: *here is the Form or Call, and here is the Job Number the Booking should store.* Form always returns the submitted `job_no`. Call returns the trimmed `call_job_no` even when the Lead was found by phone or invented.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// bookingSourceResolver.ts
// A Google Form or a phone booking arrived.
// Find the Form or Call it means.
// If we cannot find a Call, invent an Unmatched Call
// so we still have something to book.
// Then say which Source Company the Booking (and maybe
// the Form Lead) should remember.
// Booking the Lead is bookedLeadFromSource / bookedLead.

// ── 1. Find the Lead this booking names ───────────────────

export async function findTheLeadThisBookingNames(input)

async function loadTheFormTheyNamed(formLeadId, jobNo)
  // getLinkedLead("FormLead", id) — 404 if missing
  // does not write job_no onto the Form Lead
async function lookForThatCallJobNumber(jobNo, importLeadFilter)
  // raw job_no, newest createdAt, cap 5
  // Best Relocation adds source_company=best_relocation_leads
function refuseIfMoreThanOneCallSharesThatJob(leads, jobNo)  // 409
async function writeTheSubmittedPhoneOntoTheJobHit(lead, submittedPhone)
  // raw display phone; save() with no session
async function pickACallLeadByPhone(normalizedPhone, importLeadFilter)
  // findBestCallLeadMatchByPhone — sibling
async function writeJobAndPhoneOntoThePhoneHit(lead, jobNo, submittedPhone)
  // save() with no session
async function inventAnUnmatchedCallLead(input, jobNo, submittedPhone)

async function assignTheCallSourceForTheStub(sourceCompanyHint)
  // channel always "call"; empty hint → Registry main_site
async function detectFormFillOnTheStub(assignment, submittedPhone)
async function priceTheStubAsNotApplicable(assignment, timestamp)
  // applicable: false — never missing_rate
async function writeTheUnmatchedCall(fields)
  // created_on_unmatched: true; CallLead.create, no session

// ── 2. Read the company the Booking will persist ──────────

export function readTheLeadCompanyThisBookingWillUse(
  unusedOverride, lead,
)
  // callers pass undefined; trim+cast if someone ever sent a string
  // else String(lead.source_company ?? "not_provided")

// ── 3. Correct the Form Lead company if source disagrees ──

export function correctTheFormLeadCompanyIfTheBookingSourceDisagrees(
  lead, { lead_model, source },
)

function thisIsNotAFormLead(leadModel)            // Call → undefined
function mapTheBookingSourceToACompany(source)    // resolveSourceCompany — config aliases
function theLeadAlreadyHasThatCompany(lead, mapped)
```

Read the Call path out loud: *Look for that raw Job Number among Call Leads, and only Best Relocation Calls when this is a BR import. If two of the newest five share it, stop. If one hit, maybe overwrite its phone and hand it over. If none, pick a Call Lead by phone — including booked, cancelled, or an old unmatched stub — and write the submitted Job and phone onto it. If the pick returns nothing, assign a Call Source (empty hint becomes Main Site), detect Form Fill, stamp CPL as not applicable, and invent an Unmatched Call so from-source can still book.*

Read the Form path out loud: *Load the Form they named. If it is gone, 404. Hand back that Form and the Job Number they typed. Do not write the Job onto the Form Lead.*

That is the operation. `resolveBookingSourceLead` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Finder writes commit before Book This Lead.** Job-match phone overwrite, phone-match Job/phone write, and Unmatched Call `create` all save with **no session**. From-source leftover and command both call this file, then maybe override + book (command uses `tx.session` only after this returns). If Book This Lead throws, the phone/Job rewrite or the unmatched stub **stays**. Name that. Do **not** silently pass the booking session in so “they roll back together,” and do not delete the writes “because from-source should be read-only.”

2. **Job match is raw `job_no`, not `normalized_job_no`.** Newest `createdAt`, cap 5, 409 if more than one in that window. A sixth older Call with the same Job is invisible, so we do not 409 and we do not attach it. Referral / Leadless collision is also raw `job_no`. Do not switch this search to the unique Booking index so “Job means one thing.”

3. **Phone pick can return booked, cancelled, or `created_on_unmatched`.** Then this file writes submitted Job/phone onto that Lead. Reconciliation and employee claim refuse those stubs. The pick already documented that (`leads-lead-phone-matching.md`). Do not add those filters here so “from-source only attaches an open Call.”

4. **A previous unmatched stub can be re-picked.** Next from-source phone hits the stub, writes Job/phone, and from-source books **that** Lead. We do not invent a second stub. Sheet Sync still skips a Calls row while `created_on_unmatched` stays true — this file does not clear the flag. Do not unset `created_on_unmatched` on a phone hit so “it looks like a real Call now.”

5. **Unmatched create always assigns channel `"call"`.** Form Fill is detect-only (`hasFormFillForCallLead`); no Call-row Sheet Sync job. CPL is `applicable: false` (the only caller). No customer name, no `local`, no `ingestion_origin` beyond model defaults. Empty `source_company` on the form becomes Registry **Main Site** inside `assignLeadSource`. Do not price this as ordinary Call ingest, and do not emit `lead.cpl.missing_rate`.

6. **Form path does not write `job_no` onto the Form Lead.** The submitted Job is only returned for the Booking. Call job/phone paths write onto the Call Lead. Do not “complete the Form” by saving `job_no` here.

7. **Submitted phone is stored raw.** Job-match and phone-match write `call_phone_number` as typed, not `normalizePhoneNumberForMatch`. The pick already required a normalized number. Do not normalize on the way into Mongo so “storage matches the pick.”

8. **`effectiveBookingSourceCompany`’s JSDoc is a lie.** It promises label lookup then parse. The body casts `trim()` as `SourceCompany`, or `String(lead.source_company ?? "not_provided")`. Both from-source call sites pass `undefined`. The real display-source → company map is `getFormLeadSourceCompanyForBooking` → `resolveSourceCompany`. Do not teach this helper Registry assignment, and do not start passing the raw form string into it (see `bookings-booked-lead-from-source.md`).

9. **Form company correction is config aliases, not Registry.** `resolveSourceCompany` walks slugs, labels, and `SOURCE_LABEL_TO_COMPANY`. An unmapped `input.source` returns `undefined` — no Form Lead rewrite. Empty string maps to `not_provided` and **would** rewrite if Book This Lead ever sent one. Do not call `assignLeadSource` from here so “every company write asks the Registry.”

10. **Call Leads never take this correction.** Comment says their company is settled at find/invent time. Book This Lead still runs its own display-source ladder (`resolveBookedLeadSource`). Do not return a mapped company for Call so the two helpers “agree.”

11. **Best Relocation filter is Call search only.** Job find and phone pick get `source_company=best_relocation_leads` when `ingestion_source=best_relocation_sheet`. Form load ignores it. Unmatched assign uses the form’s `source_company` hint (or Main Site), not the BR slug. From-source then double-fences the assigned/stored companies. Do not add the BR slug to unmatched assign “so invent stays on BR.”

12. **`getLinkedLead` is not an eligibility filter.** Missing Form → 404. Duplicate, booked, cancelled, unmatched stubs all return. Book This Lead / claim decide what to do next. Do not teach the named load the claim filter (see `leads-source-lead-lookup.md`).

13. **Leave sibling modules alone.** `getLinkedLead`, `findBestCallLeadMatchByPhone`, `hasFormFillForCallLead`, `resolveLeadSourceAssignment`, `resolveLeadCplSnapshot`, `bestRelocationImportLeadFilter`, Book From The Source Form, and Book This Lead stay where they are. This file orchestrates the find.

14. **Do not treat Book From The Source Form, Referral, Leadless, employee matching, or Granot identity as this story.** From-source is the caller. Referral / Leadless have no Lead. Employee candidates and Granot identity use different ladders (Granot: multiple Call phone hits are `conflict`, not “pick one and write Job”).

## Testing

The **interface** is the test surface: `findTheLeadThisBookingNames`, `readTheLeadCompanyThisBookingWillUse`, `correctTheFormLeadCompanyIfTheBookingSourceDisagrees`.

There is no `bookingSourceResolver.test.ts`. Zod locks from-source identity (`call_job_no` or phone; Form needs `form_lead_id` + `job_no`). Phone pick, Form Fill, Source Assignment, and CPL have their own files. That is not enough for a story this long.

Add tests that name the operation. Do not add a test per helper.

**Find the Lead this booking names — Form**
- `form_lead_id` loads that Form (including Duplicate / booked). Missing → 404.
- Returned `jobNo` is the submitted `job_no`. The Form document is **not** saved.
- `ingestion_source=best_relocation_sheet` does **not** change the Form load.

**Find — Call Job Number**
- One Call with that raw `job_no` → that Lead. Submitted phone overwrites `phone_number` and saves. No phone → no save.
- Two of the newest five share the Job → 409 listing both ids. A sixth older same-Job Call is not in the error and is not attached.
- Best Relocation import omits a non-`best_relocation_leads` Call with the same Job, then falls through to phone / invent.
- Job match wins over phone. Do not re-test the phone pick’s recency here.

**Find — Call phone, then invent**
- No Job hit + phone pick → write submitted `job_no` / raw phone onto that Lead (including a booked or unmatched stub). Do not clear `created_on_unmatched`.
- No Job, no phone pick, has Job or phone (Zod already requires one) → invent `created_on_unmatched: true`, channel `call`, Form Fill from detect, CPL `applicable: false`, Florida `timestamp`. Empty `source_company` → Main Site assignment.
- Invent does **not** emit `lead.cpl.missing_rate`.
- Phone pick `sourceCompany` is only set on BR import.

**Read the company the Booking will persist**
- `undefined` override + Lead `source_company` → that slug.
- `undefined` override + missing company → `"not_provided"`.
- A non-empty override string is returned as-is (cast). Do not lock a Registry lookup that does not exist. From-source tests should keep passing `undefined`.

**Correct the Form Lead company if source disagrees**
- Call Lead → `undefined` even when `source` maps to another company.
- Form Lead + `source` maps to the stored company → `undefined`.
- Form Lead + `source` maps to a different slug (label or alias) → that slug.
- Form Lead + unmapped `source` → `undefined` (no rewrite).

Do **not** add a test per helper (`lookForThatCallJobNumber`, `priceTheStubAsNotApplicable`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not re-test `findBestCallLeadMatchByPhone` ranking, `hasFormFillForCallLead` arithmetic, `assignLeadSource` Registry miss, Book This Lead ignore / rebook / insert, from-source override save, or `claimAvailableLeadForBooking` here.

## What I would not do

- A `BookingSourceResolverService` class with `resolve` / `get` / `effective`.
- Thirty two-line functions that only wrap `getLinkedLead` or `CallLead.find`.
- Moving this into a CRUD folder, or into `leads/` “because it creates a Call Lead.”
- Wrapping finder writes in the booking session, or deleting them so this file is read-only.
- Switching Job search to `normalized_job_no`, or excluding booked / unmatched stubs from the phone path.
- Clearing `created_on_unmatched` on a re-picked stub, or pricing the stub as ordinary Call ingest.
- Passing the raw form `source_company` into `effectiveBookingSourceCompany`, or teaching that helper label lookup to match its JSDoc.
- Calling `assignLeadSource` from Form company correction, or returning a mapped company for Call Leads.
- Pulling Book From The Source Form, Book This Lead, phone pick, Form Fill mark, Referral, Leadless, employee matching, or Granot identity into this file.
- Writing a whole-folder `bookings` recommendation in this pass.
