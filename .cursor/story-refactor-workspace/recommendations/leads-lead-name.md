# Lead Display Name — operational story

- Status: recommended
- Service: `leads` (Wave A, in-progress)
- Pass: 8 of this service — `leadName.service.ts`
- Remaining in this service: `leadPhoneMatching.ts`, `sourceLeadLookup.service.ts`, `callLeadSourceMatch.ts`, `leadSourceCompatibility.ts`
- Target: `src/services/leads/leadName.service.ts`
- Knowledge: `docs/knowledge/services/form-lead.md` (create step 1 “Normalize: Name”; Form `name` is required), `docs/knowledge/services/call-lead.md` (Admin/sheet create “Normalize name”; Call `name` is optional), `docs/knowledge/services/customer.md` (booking upsert reads `lead.name` only). No dedicated Service file for this module. This checkout’s `CONTEXT.md` does not define a display-name term — do not invent a glossary copy.
- Callers: `formLead.service.ts` (ingest + correct), `callLead.service.ts` (Admin/sheet/RingCentral ingest + correct), `employeeBookings/bookingLeadAttachment.service.ts` (recon Form/Call create — already passes a full `name`)
- Seams callers need: compose on create (trimmed `name` wins, else join first + last) vs rebuild on correction (explicit `name` wins; first/last keys trigger a merge with the live Lead)
- Split later (only if the file outgrows one sitting): keep one file — this is already one sitting. Never `create.ts` / `update.ts` / `delete.ts`

## What this file actually does

Two operations, not “a name helper” and not Customer upsert:

1. **Compose the Lead’s display name** — a quote or call is about to be saved. If they sent a full `name`, trim it and use that. If they only sent `first_name` and/or `last_name`, join those with a space. If they sent nothing usable, leave `name` missing. This file does **not** invent first and last from a full name.
2. **Rebuild the Lead’s display name on correction** — an explicit trimmed `name` wins and first/last are not used to rebuild. If the patch mentions `first_name` or `last_name`, rebuild `name` from the patched parts plus whatever the live Lead already had. If the patch mentions neither, leave `name` alone.

`normalizeLeadName` / `normalizeLeadNameUpdate` are executor mechanics. The owner question is: *what do we write in Name when the form sent a full name, or only first and last, or a later edit changed one part?*

`splitNameForCrm` is not this file. That is the CRM **adapter** that later peels `lead.name` into Granot `firstname` / `lastname`. `upsertCustomerFromLead` is not this file. That booking helper reads the already-composed `name`. Granot Observation `display_name` is not this file.

## Organization

Keep one file. This is the screenplay for “what Name do we store.” Phone normalize, Ingestion Origin snapshots, CRM split, Customer upsert, SMS `{first_name}`, and Granot Observation contact already live elsewhere. Do not pull those in. Do not invent a `LeadNameService` class.

Do not split this 40-line file. Create vs correct are two **seams** on one story, not two folders.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `normalizeLeadName` | `composeTheLeadDisplayName` | Form/Call ingest and employee recon create — write `name` before persist |
| `normalizeLeadNameUpdate` | `rebuildTheLeadDisplayName` | Form/Call correct — `name` wins, or first/last merge with the live Lead |

Keep the old names as one-line aliases until Form/Call ingest and employee-booking attach migrate. Do not make callers learn `normalize` / `Update` as the domain language.

`buildLeadNameFromParts` is a child of both operations. Un-export it. No other module imports it.

**No class for the workflow.** The type that *does* earn a name is the bag both seams already share:

```ts
type LeadNameParts = {
  name?: string | null
  first_name?: string | null
  last_name?: string | null
}
```

Do not export `hasOwnInput`. Form and Call already have their own copy for zip/source patches. That duplication is a caller smell, not a second **interface** here.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// leadName.service.ts
// A quote or a call is about to be saved.
// The owner will see one Name.
// Prefer the full name they typed.
// If they only typed first and last, put those together.
// Do not invent first and last from a full name —
// CRM posting splits later; SMS peels the first word if it must.

// ── 1. Compose the Lead’s display name ────────────────────

export function composeTheLeadDisplayName(input)

function joinFirstAndLast(first, last)   // trim; drop blanks; space
function aTrimmedFullNameWins(name)
function leaveNameMissingWhenNothingUsable(input)

// ── 2. Rebuild the Lead’s display name on correction ──────

export function rebuildTheLeadDisplayName(patch, current)

function anExplicitFullNameWins(patch)
function thePatchDidNotMentionFirstOrLast(patch)   // leave name alone
function mergePatchedPartsWithTheLiveLead(patch, current)
function leaveNameOffThePatchWhenPartsAreEmpty(patch)
```

Read the Form ingest path out loud: *if they typed a full name, keep that (trimmed). If they only typed first and last, put those together with a space. Store first and last as they came — do not split the full name back into parts. Write that Name on the Form Lead and on the ingested-contact snapshot. Form already had to send name or first or last; the model requires Name.*

Read the Call ingest path out loud: *same compose. A RingCentral Call is usually phone-only — leave Name missing. Admin/sheet create may send a name. Do not invent a caller name from the telephony record here.*

Read the correction path out loud: *if they sent a new full name, that is the Name. If they changed first or last, rebuild Name from the new parts plus whatever we already had. If they did not mention first or last, do not touch Name.*

Read the employee recon path out loud: *the submission already has a full name. Compose just trims it. There are no first/last on that call.*

That is the operation. `normalizeLeadNameUpdate` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Create does not invent first and last.** A WordPress quote that only sends `name: "Jane Doe"` stores empty `first_name` / `last_name`. CRM posting later runs `splitNameForCrm(lead.name)` (first token / last token; a single token is copied to both because Granot rejects a blank last name). Confirmation SMS uses `first_name`, else the first word of `name`, else `there`. Do not start splitting inside this file so “the parts match.” Do not make SMS read this module.

2. **A name-only correction leaves first and last stale.** `rebuildTheLeadDisplayName` trims `name` and returns. Stored `first_name` / `last_name` can disagree with Name. Keep that. Do not silently resplit. The snapshot on create already copied the pre-correction parts; correction does not restamp Ingestion Origin evidence.

3. **Whitespace-only `name` is not the same on both seams.** Create treats `"   "` as missing and falls through to first/last. Correct without first/last keys returns the patch unchanged, spaces still on `name` — Mongoose `trim: true` may clean it on save, but the function lied. Treat whitespace as “no explicit name” on both seams.

4. **`first_name: undefined` counts as “mentioned.”** `hasOwnInput` is `hasOwnProperty`. A spread that put the key on the patch rebuilds Name from `undefined ?? current.first_name` and can overwrite a custom full name that did not match the parts. Today Zod partials omit missing keys, so live routes are safe. Do not “fix” this by treating any undefined as absent if a caller starts sending explicit clears — `null` vs omitted vs `""` are three different asks. Empty string drops that part; `null` / `undefined` keep the live part via `??`.

5. **`buildLeadNameFromParts` is an unused export.** Un-export it. Do not grow a public “join” **interface** so Granot can import it.

6. **Granot compose is a different story.** `createLeadFromGranot`, `leadDesiredState.observationContact`, `normalization.ts`, Booking/Release case labels, and `projections.leadName` all join first + last themselves. They prefer Observation `display_name`, not Lead `name`. `createLeadFromGranot` writes the Lead directly and never calls this file. Do not route Granot through `composeTheLeadDisplayName` so every origin “has a name step.” Do not pull `display_name` onto this **interface**.

7. **Customer upsert and employee match read `name`, not the parts.** `upsertCustomerFromLead` returns no Customer when `lead.name` is blank. FormLead `pre("validate")` sets `normalized_contact_name` from `name` for employee candidate match. Do not lowercase or persist `normalized_contact_name` from here. Do not call Customer upsert from here.

8. **Form requires Name; Call does not.** Zod `hasLeadName` is the Form HTTP gate (name or first or last). Call create accepts phone-or-job with no name. Do not move the Zod refine into this file. Do not fail compose when Call name is missing.

9. **Search ignores first and last.** `form-lead-search.md` / `call-lead-search.md` accept the keys and then drop them. Browse `$or`s `name` / `first_name` / `last_name`. That is search, not this story. Do not add a search export here.

10. **Leave sibling modules alone.** After compose, Form/Call still locate, assign a source, detect a Duplicate Lead, and price. This file does not touch those.

## Testing

The **interface** is the test surface: `composeTheLeadDisplayName`, `rebuildTheLeadDisplayName`.

There is no `leadName.service.test.ts` today. Form/Call service tests do not lock these operations.

Add a focused test file. The functions are pure — no Mongo, no Registry.

**Compose the Lead’s display name**
- `name: " Jane Doe "` → `name: "Jane Doe"`; first/last unchanged.
- `first_name: "Jane"`, `last_name: "Doe"`, no name → `name: "Jane Doe"`.
- Only `first_name: "Jane"` → `name: "Jane"`.
- `name: "   "` plus first/last → falls through to the join, not the spaces.
- Nothing usable → input unchanged; `name` stays missing.
- Extra fields on the input (`phone_number`, `email`) pass through.

**Rebuild the Lead’s display name**
- Patch `{ name: " Jane Doe " }` → trimmed name; first/last on the patch untouched.
- Patch `{ first_name: "Ada" }` against a Lead named `Jane Doe` with last `Doe` → `name: "Ada Doe"`.
- Patch `{ first_name: "", last_name: "" }` → no `name` written on the patch; live Name stays for the caller to keep.
- Patch with neither first nor last (zip-only, quoted-only) → `name` not added.
- Patch `{ name: "   " }` with no first/last → treat as no explicit name (same as create), not a stored `"   "`.

Do **not** add a test per helper (`joinFirstAndLast`, `thePatchDidNotMentionFirstOrLast`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Form ingest tests should prove the composed `name` is what the snapshot and the required Form field get. Call ingest tests should prove RingCentral create may persist with no name. CRM payload tests stay on `splitNameForCrm`. Do not re-test those caller choices here.

## What I would not do

- A `LeadNameService` class with `normalize` / `build` / `update`.
- Thirty two-line functions that only `trim` and `join`.
- Moving this into a CRUD folder, or into `customers/` / `crm/` “because it talks to names.”
- Splitting a full name into first/last here, or merging `splitNameForCrm` into this file.
- Routing `createLeadFromGranot`, Observation normalization, or intake projections through this file.
- Writing `normalized_contact_name`, upserting a Customer, or rendering `{first_name}` from here.
- Forcing a name onto RingCentral create, or failing compose when Call name is missing.
- Silently resyncing first/last on a name-only patch so the parts “match.”
- Exporting `hasOwnInput` or growing `buildLeadNameFromParts` into a Granot **adapter**.
