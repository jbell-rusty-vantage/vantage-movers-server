# Lead Location — operational story

- Status: recommended
- Service: `leads` (Wave A, in-progress)
- Pass: 7 of this service — `leadLocation.service.ts`
- Remaining in this service: `leadName.service.ts`, `leadPhoneMatching.ts`, `sourceLeadLookup.service.ts`, `callLeadSourceMatch.ts`, `leadSourceCompatibility.ts`
- Target: `src/services/leads/leadLocation.service.ts`
- Knowledge: `docs/knowledge/services/form-lead.md` (required location + `deriveFormLeadLocal`; Best Relocation create may keep a trusted `local`), `docs/knowledge/services/call-lead.md` (optional location; Move Type may stay unknown until Call Lead Enrichment), `docs/knowledge/services/booked-call-lead-reconciliation.md` (shared `deriveLocal` after Granot `from`/`to` parse). No dedicated Service file for this module. This checkout’s `CONTEXT.md` does not define Move Type — do not invent a glossary copy.
- Callers: `formLead.service.ts` (ingest + correct), `callLead.service.ts` (Admin/sheet ingest + correct; **not** RingCentral create), `employeeBookings/bookingLeadAttachment.service.ts` (recon Form locate + classify; recon Call calls optional with `{}`), `enrichment/callLeadEnrichmentRows.ts` (`deriveLocal` only), `reconciliation/bookedCallLeadRows.ts` (`deriveLocal` only)
- Seams callers need: Form must persist a state (`not_found` when the zip and the caller both miss) vs Call may leave a state blank; classify from two known states is its own export because enrichment and booked-call-lead reconciliation already looked the zips up themselves
- Split later (only if the file outgrows one sitting): `locateTheFormMove.ts`, `locateTheCallMove.ts` — never `create.ts` / `update.ts` / `delete.ts`

## What this file actually does

Three operations, not “a location helper” and not geocoding:

1. **Locate the Form Move** — a quote already has both zip codes. Ask the zip book what state each one is. Prefer that answer over a state the form typed. If both miss, write `not_found` and warn the owner. This file does **not** decide Move Type on this path; the caller asks operation 3.
2. **Locate the Call Move** — a Call may have no zip yet. Look up only the zips that exist. Never write `not_found`. When both states are known, classify the Move Type here. When they are not, keep the `local` the caller already sent.
3. **Classify the Move Type** — two known states: same is `local`, different is `long_distance`. Form adds one conservative rule: if either side is `not_found`, call it `long_distance`.

`resolveRequiredLocation` / `resolveOptionalLocation` are executor mechanics. The owner question is: *which states is this move between, and is it a local move — or did we have to guess?*

`getStateCodeForZip` is not this file. That util owns Google first, then Zippopotam.us. `googleMaps/geocoding.ts` is not this file. That is the Google **adapter**. `utils/location/granotLocation.ts` is not this file. That parses Granot `City, ST` strings for enrichment and booked-call-lead reconciliation.

## Organization

Keep one file. This is the screenplay for “where is this move, and is it local.” Zip lookup, Granot city-state parse, Form/Call ingest, Source Assignment, and CPL already live elsewhere. Do not pull those in. Do not invent a `LeadLocationService` class.

If it later outgrows one sitting, split by **story** (Form locate vs Call locate), not by Form vs Call folders and not by zip vs state CRUD.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `resolveRequiredLocation` | `locateTheFormMove` | Form ingest, Form correct, employee recon Form create — both zips present; must persist a state |
| `resolveOptionalLocation` | `locateTheCallMove` | Admin/sheet Call ingest + correct — zips optional; blank is allowed; classify when both states exist |
| `deriveLocal` | `classifyTheMoveType` | enrichment + booked-call-lead reconciliation already have states |
| `deriveFormLeadLocal` | `classifyTheFormMoveType` | Form must not treat `not_found` as a real same-state local move |
| `normalizeState` | `normalizeTheStateCode` | Form correct compares an explicit typed state to the zip answer |

Keep the old names as one-line aliases until Form/Call ingest, employee-booking attach, enrichment, and booked-call-lead reconciliation migrate. Do not make callers learn `resolveRequired` / `resolveOptional` as the domain language.

`LocationWorkflowContext` stays. It is only the owner-event `workflow` string (`form_lead_create`, `form_lead_update`, `call_lead_create`, `call_lead_update`, `booking_reconciliation_create_*`). It is not a second operation.

An injectable `deps.lookupStateForZip` earns a test **seam**, the same way CPL injects the Registry. It is not a second public operation. Default remains `getStateCodeForZip`. Do not invent a second live lookup **adapter** here.

**No class for the workflow.** The types that *do* earn names are the Form ask, the Call ask, and the two answers:

```ts
type FormMoveToLocate = {
  pickup_zip: string
  destination_zip: string          // Form field name; Call uses delivery_zip
  pickup_state?: string
  delivery_state?: string
}

type LocatedFormMove = {
  pickup_state: string             // always set; may be FORM_LEAD_UNKNOWN_STATE ("not_found")
  delivery_state: string
}

type CallMoveToLocate = {
  pickup_zip?: string
  delivery_zip?: string
  pickup_state?: string
  delivery_state?: string
  local?: LocalType
}

type LocatedCallMove = {
  pickup_state: string | undefined
  delivery_state: string | undefined
  local: LocalType | undefined
}
```

Do not export the missing-lookup event bodies. They are children of locate.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// leadLocation.service.ts
// A quote or a call is about to be saved.
// We have zip codes, or we don't.
// Find the states. Say whether the move is local.
// If a Form zip tells us nothing, write not_found — never invent a state.

// ── 1. Locate the Form Move ───────────────────────────────

export async function locateTheFormMove(ask, context?, deps?)

async function askTheZipBookForBothEnds(pickupZip, destinationZip, lookup)
function preferTheZipAnswerOverATypedState(fromZip, typed)
function writeNotFoundWhenBothMiss(state)
async function warnTheOwnerTheZipDidNotResolve(ask, missing, context)

// ── 2. Locate the Call Move ───────────────────────────────

export async function locateTheCallMove(ask, context?, deps?)

async function askTheZipBookOnlyForZipsWeHave(ask, lookup)
function keepABlankStateBlank(fromZip, typed)          // no not_found
function classifyWhenBothStatesAreKnown(pickup, delivery, callerLocal)
async function noteAnOptionalZipThatDidNotResolve(ask, missing, context)

// ── 3. Classify the Move Type ─────────────────────────────

export function classifyTheMoveType(pickupState, deliveryState)
  // same → local; else long_distance

export function classifyTheFormMoveType(pickupState, deliveryState)
  // either not_found → long_distance; else classifyTheMoveType

export function normalizeTheStateCode(value)
  // trim; preserve literal not_found; otherwise UPPERCASE
```

Read the Form ingest path out loud: *take both zips. Ask Google, then Zippopotam.us, what state each is. Prefer that answer over a state the form typed. If we still do not know, write not_found and warn the owner. Then: if either side is not_found, call the move long distance; if the states match, call it local.*

Read the Call ingest path out loud: *a zip may be missing. Look up only the zips we have. Leave a blank state blank. If we know both states, same-state is local. If we do not, keep the local the caller already sent. Tell the owner at info, not warn, and do not make it a notification.*

Read the enrichment path out loud: *the row parser already pulled City, ST and 5-digit zips from Granot. It asked the zip book itself. It only needs classify — same states local, otherwise long distance, or leave local unset.*

That is the operation. `resolveRequiredLocation` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Form create and Form correct disagree on who wins.** Create prefers zip over typed state (`fromZip ?? typed`). Correct calls `locateTheFormMove`, then overwrites with an explicit `/^[A-Z]{2}$/` typed state (`isStateCode` lives in `formLead.service.ts`). Keep that override in Form correct. Do not silently move it into `locateTheFormMove` so create and correct “look the same.”

2. **`destination_zip` vs `delivery_zip` is the Form/Call field split.** Required input uses Form’s `destination_zip`. Optional input uses Call’s `delivery_zip`. Do not rename the persisted fields from here. Do not invent a third `to_zip` on this **interface**.

3. **Two missing-lookup event blocks are the same story at different severity.** Form is `zip_state.lookup.missing` at `warn`. Call is `zip_state.optional_lookup.missing` at `info` with `reportable: false`. Both skip unless `shouldCaptureZipStateEvents()`. Both set `notificationCandidate: false`. One shared child that takes the event key and level is enough. Do not collapse them into one event key “for cleanliness.”

4. **`not_found` is Form-only.** Optional locate never writes the sentinel. `normalizeTheStateCode` preserves the literal `FORM_LEAD_UNKNOWN_STATE` (`"not_found"`) so a later Form correct does not uppercase it to `NOT_FOUND`. Do not “fix” Call to persist `not_found` so the statuses look symmetric. Call Lead Enrichment is how a sparse Call learns states.

5. **Best Relocation trusted `local` is a caller override.** Form ingest does `(ingestion_source === "best_relocation_sheet" ? input.local : undefined) ?? classifyTheFormMoveType(...)`. Do not read `ingestion_source` from this file. Do not make `locateTheFormMove` return `local`.

6. **Employee recon Call locate with `{}` is a no-op.** `createAndAttachReconciliationCallLead` calls `locateTheCallMove({}, { workflow: "booking_reconciliation_create_call" })` and then uses `prepared.local`. Name that in the employee-booking pass. Do not start looking up booking zips from here so the call “does something.”

7. **Enrichment and booked-call-lead reconciliation reimplement zip lookup.** They parse Granot `from`/`to` / `from_zip` / `to_zip`, call `getStateCodeForZip` themselves, then `classifyTheMoveType`. Do not pull those parsers into this file. Do not make them call `locateTheCallMove` “for DRY” — they have cities and warnings this file does not own.

8. **RingCentral create and Granot create do not call this file.** RC ingest is phone-first; location waits for Enrichment. `createLeadFromGranot` writes Observation origin/destination states and `local: source.local` (the source-policy Move Type), not `classifyTheFormMoveType`. `form-lead.md` says Granot create “derives `local` only from accepted origin/destination state facts.” The code stamps `source.local`. Do not silently merge. Do not route Granot through this file so it “looks like ingest.”

9. **Leave the zip book and Google Maps alone.** Google-then-Zippopotam.us, 5-digit validation, and `zip_state.google_maps.failed` stay in `pickupZipState` / `googleMaps/geocoding.ts`. Do not reimplement fetch here. Do not move `getStateCodeForZip` into `leads/`.

10. **Leave sibling modules alone.** After locate, Form/Call ask Source Assignment with the Move Type they decided. This file does not assign a source, price a Lead, or parse a name.

## Testing

The **interface** is the test surface: `locateTheFormMove`, `locateTheCallMove`, `classifyTheMoveType`, `classifyTheFormMoveType`. `normalizeTheStateCode` is exercised through Form locate/correct, not as its own suite.

There is no `leadLocation.service.test.ts` today. Form/Call service tests do not lock these operations. The model test that defaults missing Form states to `not_found` is a schema default, not this file.

Add a focused test file that injects `lookupStateForZip` (and, for events, does not need live observability):

**Locate the Form Move**
- Zip answers `NY` / `CA` → those states, even if the caller typed something else.
- Zip misses and the caller typed `fl` → `FL`.
- Zip and caller both miss → `not_found` / `not_found`.
- One side misses → that side `not_found`, the other side the zip or typed state.
- Default `workflow` is `form_lead_create`. Callers that pass `form_lead_update` keep that string on the event.

**Locate the Call Move**
- Missing zips → undefined states; `local` is the caller’s `local`.
- Both zips resolve to the same state → `local: "local"`.
- Both zips resolve to different states → `local: "long_distance"`.
- A zip is present and the lookup misses → that state stays undefined (not `not_found`); `local` falls back to the caller.
- Default `workflow` is `call_lead_create`.

**Classify**
- `NY`/`NY` → `local`. `NY`/`CA` → `long_distance`.
- Form: either side `not_found` → `long_distance`, even if the other side matches a real state.
- `normalizeTheStateCode(" not_found ")` stays `not_found`, not `NOT_FOUND`.

Do **not** add a test per helper (`preferTheZipAnswerOverATypedState`, `writeNotFoundWhenBothMiss`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** add live Google or Zippopotam.us tests here. The injectable lookup is the **adapter**. Provider failure events are `googleMaps` tests.

Form ingest tests should prove they located before Source Assignment and that Best Relocation may keep a trusted `local`. Call ingest tests should prove RingCentral create does **not** locate. Do not re-test those caller choices in this file.

## What I would not do

- A `LeadLocationService` class with `resolve` / `derive` / `normalize`.
- Thirty two-line functions that only `Promise.all` two zip calls.
- Moving this into a CRUD folder, or into `googleMaps/` / `utils/location/` “because it talks to zips.”
- Treating Google geocoding, Granot `City, ST` parse, or sheet `localCell` as this story.
- Writing `not_found` onto Call Leads, or making Form locate return `local`.
- Moving Form correct’s explicit-state override into locate, or Best Relocation’s trusted `local` into this file.
- Routing RingCentral create or `createLeadFromGranot` through locate so every origin “has a location step.”
- Pulling enrichment / booked-call-lead row parsers in, or calling Source Assignment / CPL from here.
- Silently merging `form-lead.md`’s “Granot derives local from origin/destination states” with the code’s `local: source.local`.
