# Call Lead Phone Match — operational story

- Status: recommended
- Service: `leads` (Wave A, in-progress)
- Pass: 9 of this service — `leadPhoneMatching.ts`
- Remaining in this service: `sourceLeadLookup.service.ts`, `callLeadSourceMatch.ts`, `leadSourceCompatibility.ts`
- Target: `src/services/leads/leadPhoneMatching.ts`
- Knowledge: `docs/knowledge/services/bookings.md` (from-source Call: job number first, else this pick, else unmatched create), `docs/knowledge/services/form-lead.md` / `docs/knowledge/services/call-lead.md` (Duplicate Form Lead and Form Fill reuse the sieve only). No dedicated Service file for this module. This checkout’s `CONTEXT.md` does not define a phone-match term — do not invent a glossary copy.
- Callers: `bookings/bookingSourceResolver.ts` (the pick), `leads/duplicateLead.service.ts` (the sieve), `leads/index.ts` (barrel). Search, enrichment, booked-call-lead reconciliation, and employee candidate query **copy** a different regex and do not import this file.
- Seams callers need: widen stored phones for Mongo (sieve; caller still verifies) vs pick the one Call Lead a from-source booking should attach to (optional Source Company filter)
- Split later (only if the file outgrows one sitting): keep one file — this is already one sitting. Never `create.ts` / `update.ts` / `delete.ts`

## What this file actually does

Two operations, not “a phone helper” and not phone normalize:

1. **Sieve stored phones that could be this number** — Mongo cannot treat `(561) 988-9998` and `15619889998` as the same last ten digits. Build a regex that hits any stored `phone_number` whose digits contain this number and then end (or hit a non-digit). That is only a widen. The caller still proves `normalizePhoneNumberForMatch(stored) === the number we asked for`.
2. **Pick the Call Lead this booking should attach to** — a from-source Call booking already failed to find a job number. Load Call Leads that could be this phone (and, when asked, this Source Company). Drop regex false hits. Prefer an **open** Call Lead — not booked, not cancelled. If every verified hit is already booked or cancelled, take the newest of those. Recency is `timestamp`, then `createdAt`. If nothing verifies, return nothing. This file does **not** write `job_no` or `phone_number`, and it does **not** create an unmatched Call Lead.

`buildPhoneRegex` / `findBestCallLeadMatchByPhone` are executor mechanics. The owner question is: *is this the same phone we already stored, and if we are booking from a Call with only a phone, which Call Lead do we attach?*

`normalizePhoneNumberForMatch` is not this file. That util owns last-ten / `+1` / foreign digits. Job-number match, unmatched create, Form Fill, Duplicate Form Lead classification, RingCentral’s 90-day guard, enrichment’s source-compatible pick, employee candidate lists, and Granot identity ladders are not this file.

## Organization

Keep one file. This is the screenplay for “same phone?” and “which Call Lead do we book.” Normalize, job-number resolve, unmatched create, Duplicate / Form Fill, and the other matchers already live elsewhere. Do not pull those in. Do not invent a `LeadPhoneMatchingService` class.

Do not split this 70-line file. Sieve vs pick are two **seams** on one story, not two folders. Do not move the pick into `bookings/` “because only from-source calls it.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `buildPhoneRegex` | `sieveStoredPhonesThatCouldBeThisNumber` | Duplicate Form Lead, Form Fill, and this pick — Mongo widen only |
| `findBestCallLeadMatchByPhone` | `pickTheCallLeadToBookByPhone` | from-source Call booking after job number missed — one Call Lead or none |

Keep the old names as one-line aliases until booking source resolve, Duplicate Form Lead, and the leads barrel migrate. Do not make callers learn `Regex` / `BestMatch` as the domain language.

`compareCallLeadRecency` / `getCallLeadTime` stay children of the pick. Un-export them. No other module imports them.

**No class for the workflow.** The type that *does* earn a name is the already-normalized number the pick requires:

```ts
type NormalizedPhoneForMatch = string
type CallLeadPhonePickOptions = { sourceCompany?: string }
```

Callers must pass a number that already went through `normalizePhoneNumberForMatch`. Passing `(561) 988-9998` into the pick compares that raw string to a stored last-ten and misses. The sieve itself strips non-digits, so a raw form is accidentally “fine” for Duplicate / Form Fill only because those callers normalize first.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// leadPhoneMatching.ts
// A stored phone may have dashes, a leading 1, or extra digits.
// Mongo can only sieve.
// Prove the last-ten (or foreign) digits in memory.
//
// When a Call booking has no job number:
// prefer an open Call Lead for this phone.
// If every hit is already booked or cancelled, take the newest.
// If none verify, say so — unmatched create is the booking resolver.

// ── 1. Sieve stored phones that could be this number ──────

export function sieveStoredPhonesThatCouldBeThisNumber(normalizedPhone)

function takeDigitsOnly(normalizedPhone)
function allowSeparatorsBetweenDigits(digits)   // 5\D*6\D*1…
function stopAtTheEndOfTheNumber()              // (?:\D|$) — do not eat a longer prefix

// ── 2. Pick the Call Lead this booking should attach to ───

export async function pickTheCallLeadToBookByPhone(normalizedPhone, options?)

async function loadCallLeadsThatCouldBeThisPhone(normalizedPhone, sourceCompany?)
  // $or: stored last-ten field, or raw phone ~ sieve
  // optional source_company (Best Relocation import)
  // newest createdAt, cap 25
function keepOnlyExactPhoneMatches(leads, normalizedPhone)
function preferAnOpenCallLead(leads)            // !booked && !cancelled, else the full set
function breakTiesByRecency(leads)              // timestamp, then createdAt
function noVerifiedHitMeansNone()
```

Read the sieve out loud: *Mongo cannot compare formatted phones. Build a pattern that finds stored values whose digits could be this number and then stop. Do not trust the pattern alone — prove the normalized stored phone equals the number we asked for.*

Read the booking pick out loud: *They booked a Call and we did not find a job number. Look at Call Leads that could be this phone, and this Source Company when the import asked. Throw away regex false hits. If we have an open Call Lead — not booked, not cancelled — attach that. If they are all already booked or cancelled, attach the newest one. If none verify, return nothing so the resolver can create an unmatched Call Lead.*

That is the operation. `findBestCallLeadMatchByPhone` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Two regex dialects.** This sieve is tail-only: `${digits}\D*…(?:\D|$)`. Search, enrichment, booked-call-lead reconciliation, and employee candidates copy a **leading** `(?:^|\D)` so a stored longer prefix (`15619889998` vs asked `5619889998`) does not even enter the candidate set. Their comments say that difference is deliberate versus “the leads helper.” Duplicate Form Lead and Form Fill import **this** dialect. Do not silently add the leading boundary here so “every phone regex is one.” Do not delete the copies from those services in this pass.

2. **Sieve plus verify is the contract.** The regex can hit the suffix of a longer stored value. `normalized_phone_number` in the `$or` already handles a stored last-ten. The in-memory `normalizePhoneNumberForMatch(lead.phone_number)` is what drops a sieve false hit — including a lead that only matched because `normalized_phone_number` was stale and the raw phone now normalizes differently. Do not drop the verify. Do not treat the regex as equality.

3. **The pick requires a pre-normalized number.** `=== normalizedPhone` is exact. Booking resolve already runs `normalizePhoneNumberForMatch`. Do not normalize again inside the pick “to be safe” unless every caller is audited — a second pass can change foreign / `+1` / sub-8-digit behavior. Do not accept raw display phones on this **interface**.

4. **Cap of 25 is a `createdAt` window, not the ranking.** Mongo sorts `createdAt` descending and stops at 25. Recency ranking uses `timestamp` then `createdAt`. An older-createdAt Call Lead with a newer `timestamp` can lose the window. An open Call Lead older than 25 newer booked hits never appears, so the pick can return a booked lead while an open one exists. Name the window. Do not silently raise the cap or sort Mongo by `timestamp` in this rename.

5. **Open is a filter, not a score.** If any verified lead is unbooked and uncancelled, booked and cancelled leads are dropped entirely, then recency runs. If none are open, recency runs on the full verified set — the pick **will** return a booked or cancelled Call Lead. Booked-call-lead reconciliation’s eligible set is the opposite: never `booked`, never `cancelled`, never `created_on_unmatched`. Do not import that rule here so “phone match always means open.”

6. **`created_on_unmatched` is visible.** A stub Call Lead created on a previous unmatched booking can be re-picked on the next from-source phone. Reconciliation and employee claim refuse those stubs. Keep the pick as-is. Do not exclude unmatched stubs so the two matchers “agree.” Unmatched **create** stays in `bookingSourceResolver`.

7. **Source Company is an optional string, not Registry depth.** Best Relocation import passes `source_company: best_relocation_leads`. There is no `lead_source_company` / `source_granularity_id` on this **interface**. Duplicate Form Lead requires exact granularity. Granot identity always includes granularity. Do not add source-policy here.

8. **This file does not write.** The resolver stamps submitted `job_no` / `phone_number` on a hit, then `save()`. Keep writes in the booking story. Do not “helpfully” persist from the pick.

9. **This file does not look at Form Leads.** From-source Form is `getLinkedLead` by id (`sourceLeadLookup.service.ts`, next pass). Employee candidates query both collections. Do not add a Form pick so “phone match is one function.”

10. **Other phone stories stay out.** RingCentral 90-day Duplicate Lead, enrichment’s `selectSourceCompatibleCallLead`, booked-call-lead reconciliation (job + phone + skip stubs), employee candidate lists, Customer upsert-by-phone, Best Relocation sheet matching, and Granot identity (multiple Call phone hits are `conflict`, not “pick one”) each have their own rule. Do not route them through `pickTheCallLeadToBookByPhone`.

11. **Leave sibling modules alone.** After this pick returns none, the resolver assigns a source, detects Form Fill, prices with `applicable: false`, and creates `created_on_unmatched`. Those beats are bookings + `duplicateLead` + `leadCplResolution`.

## Testing

The **interface** is the test surface: `sieveStoredPhonesThatCouldBeThisNumber`, `pickTheCallLeadToBookByPhone`.

There is no `leadPhoneMatching.test.ts` today. Booking tests do not lock this pick. Duplicate Form Lead tests lock the verify, not the regex shape.

Add a focused test file. The sieve is pure. The pick needs Call Lead fixtures (or an injected find) — prove the **interface**, not `compareCallLeadRecency` alone.

**Sieve stored phones that could be this number**
- Digits `5619889998` match stored `(561) 988-9998` (separators).
- Same digits match stored `15619889998` (leading 1) — tail-only dialect.
- Same digits do **not** match a longer number that only shares a prefix (`56198899980`).
- Callers still must verify; a sieve hit is not a match by itself.

**Pick the Call Lead this booking should attach to**
- Two open Call Leads, same phone → newest `timestamp` (not Mongo `createdAt` if they disagree).
- One open + one newer booked → the open lead.
- Only booked / cancelled hits → newest of those, not `undefined`.
- A regex-only hit whose raw phone normalizes to a different number is dropped.
- `sourceCompany` omits other companies.
- Empty verified set → `undefined` (unmatched create is the caller’s next beat).
- Raw display phone as `normalizedPhone` does not equal a stored last-ten — document that the **interface** requires a normalized number.

Do **not** add a test per helper (`preferAnOpenCallLead`, `stopAtTheEndOfTheNumber`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

From-source booking tests should prove: job number wins over this pick; a phone hit writes submitted `job_no` / `phone_number`; no hit creates `created_on_unmatched`. Keep those on the booking **interface**. Duplicate / Form Fill tests stay on that sibling. Do not re-test normalize last-ten here (`utils/phone.test.ts` already does).

## What I would not do

- A `LeadPhoneMatchingService` class with `build` / `find` / `match`.
- Thirty two-line functions that only wrap `RegExp` and `filter`.
- Moving this into a CRUD folder, or into `bookings/` / `search/` “because it talks to phones.”
- Merging the leading-boundary copies from search, enrichment, reconciliation, or employee candidates into this sieve.
- Replacing Duplicate Form Lead / Form Fill candidate loads with `pickTheCallLeadToBookByPhone`.
- Routing RingCentral duplicate, Granot identity, enrichment, or employee lists through this pick.
- Writing `job_no` / `phone_number`, or creating an unmatched Call Lead, from this file.
- Excluding `created_on_unmatched`, or refusing booked/cancelled, so this pick matches reconciliation eligibility.
- Silently raising the 25-cap or changing Mongo sort to `timestamp` during the rename.
- Inventing a second public sieve “with leading boundary” that only one later service would import.
