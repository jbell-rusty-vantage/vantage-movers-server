# Name Each Best Relocation Row With A Stable Identity That Survives Reorder — Mint vantage: For Calls And Refunds, lead: For Forms, booking: For Jobs — Then Refuse A Copy Except Two-Agent Booked Deals, And Checksum What The Sheet Owns — Never Write A Cell, Never Fall Back To Row Number, Never Put LID On The Walk — operational story

- Status: recommended
- Service: `bestRelocationSheetIngest` (Wave A, in-progress)
- Pass: 7 of this service — `identity.ts`
- Remaining in this service: `sourceChangePolicy.ts`, `canonicalLeadAdoption.ts`, `bootstrap.ts`, `updatePolicy.ts`, `apply.ts`, `dryRun.ts`, `dryRunReports.ts`
- Target: `src/services/bestRelocationSheetIngest/identity.ts`
- Knowledge: [`docs/knowledge/services/ingestion.md`](../../../docs/knowledge/services/ingestion.md). Skip/fail: copied / malformed managed identities **block** inspect/repair; preview never writes identity cells. Health: `duplicate_source_identity` always alerts. Primary-code list names `canonicalLeadAdoption.ts` / `sheets.ts` / `dryRunReports.ts`, not this file — do not add a second Ingestion Service so “identity owns the happy path.” Distinct from already-recommended six-tab read / window: [`best-relocation-sheet-ingest-sheets.md`](best-relocation-sheet-ingest-sheets.md). Distinct from already-recommended parse: [`best-relocation-sheet-ingest-parsing.md`](best-relocation-sheet-ingest-parsing.md) (this file **asks** `normalizeJobNo` again for Booked Deals; parse’s `provenance.source_row_key` is `${workbook}:${tab}:${sheet_row}` — this file never uses that). Distinct from already-recommended HTTP screenplay: [`best-relocation-sheet-ingest-plan.md`](best-relocation-sheet-ingest-plan.md) (`sourceLeadKey` can fall back to `source_row_key` on a Form and to `sheet_row` on a Call; this file **throws** on a Form without `lead_id` / `ref_no` and names a Call by `vantage:` only). Distinct from already-recommended remap: [`best-relocation-sheet-ingest-application-plan.md`](best-relocation-sheet-ingest-application-plan.md) (**asks** `assertUniqueSourceIdentities` / `stableSourceRowId` / `sourceOwnedContentHash`; it does not mint). Distinct from already-recommended inspect / fenced write: [`best-relocation-sheet-ingest-provider.md`](best-relocation-sheet-ingest-provider.md) (**asks** `MANAGED_ID_HEADER` / `isValidManagedIngestionId` / `newManagedIngestionId`; unused `managedId`; column find is a different regex). Distinct from already-recommended Booking Job stamp: [`bookings-booking-identity.md`](bookings-booking-identity.md) — `bookingIdentity.normalizeJobNo` keeps a space (`P-123` → `P 123`); this file **asks** parse’s strip (`P-123` → `P123`). Distinct from already-recommended Granot Lead identity: [`granot-lifecycle-identity.md`](granot-lifecycle-identity.md) — that file matches a Granot statement to a Mongo Lead; this file names a sheet row. Distinct from later receipt skip: `sourceChangePolicy.ts` (compares this file’s `content_hash`; it does not mint). Distinct from later Mongo adopt: `canonicalLeadAdoption.ts` / `bootstrap.ts`. Distinct from later HTTP apply: `apply.ts`. Folder `HANDOFF.md` is not knowledge — do not copy it (Call idempotency is still “source company + phone + date/time,” not `vantage:`). This checkout’s `CONTEXT.md` does not define Ingestion Origin or Best Relocation — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001).
- Callers: `applicationPlan.ts` **asks** `assertUniqueSourceIdentities` on Forms + Local Forms + Calls + Best Relocation Booked Deals + selected Refunds (no `LID_BestRelo`), then `stableSourceRowId` / `sourceOwnedContentHash` on remap, Job poison, unmatched-refund / leadless conflicts, and invalid rows. `provider.ts` **asks** `MANAGED_ID_HEADER` / `isValidManagedIngestionId` / `newManagedIngestionId` (unused `managedId`). `ingestion/ingestion.test.ts` **asks** `stableSourceRowId` + `sourceOwnedContentHash` for “stable managed identity survives row reordering” (`managed("1")` is a valid UUID v4 with a trailing digit). Folder `bestRelocationSheetIngest.test.ts` does **not** import this file. Barrel `index.ts` `export *`. Wave B `src/routes/ingestion.routes.ts` does not import this file. CLI does not import this file. `canonicalSourceValues` has **no** caller.
- Seams callers need: this-file / inspect mint (`vantage:` UUID only — provider writes the cell); this-file / remap (stable id + unique + content hash); this-file / HTTP screenplay (this file never falls back to sheet row; `plan.sourceLeadKey` still can); this-file / parse Job fold (Booked Deals only); this-file / durable checksum (`computeChecksum` artifact `ingestion_plan`). There is no sheet-write **seam**. There is no Domain Command **seam**. There is no Mongo-adopt **seam**. There is no LID **seam**.
- Split later (only if the file outgrows one sitting): this ~123-line file is one sitting if you read it as name each Best Relocation row with a stable identity that survives reorder. Do **not** split into `mint.ts` / `hash.ts` / `unique.ts` / `create.ts` / `update.ts` / `delete.ts`. Do **not** pull `provider.ts`, `applicationPlan.ts`, `parsing.ts`, or `plan.ts` here. If it later splits: `mintAVantageManagedIngestionId.ts` / `nameTheStableSourceRowId.ts` / `refuseACopiedSourceIdentityExceptTwoAgentBookedDeals.ts` only as later story files, never CRUD.

`stableSourceRowId` / `newManagedIngestionId` / `assertUniqueSourceIdentities` / `sourceOwnedContentHash` are executor mechanics. The owner question is: *A Call or Refund has no Lead ID. Give it a vantage UUID so the same row still has the same name after someone sorts the tab. A Form is `lead:` plus Lead ID or Tracking Reference — never the sheet row. A Booking is `booking:` plus the Best Relocation Job fold — two agents on that Job share one name. Then refuse a copied identity, except those two Booked Deal rows. Checksum the values the sheet still owns so a later receipt skip can say “nothing changed.” This file does not write a cell. This file does not fall back to row number. This file does not put LID_BestRelo on the walk.*

Inspect write, HTTP screenplay, remap, receipt skip, Mongo adopt, and apply already live in other **modules**. Do not pull those in.

## What this file actually does

Four operations of one “name each Best Relocation row with a stable identity that survives reorder” story, not “an identity CRUD helper,” and not inspect write / HTTP idempotency / Mongo adopt.

1. **Mint and validate a vantage: UUID v4** — `newManagedIngestionId` is `vantage:` plus `randomUUID()`. `isValidManagedIngestionId` is the strict UUID v4 regex (`vantage:` + version `4` + variant `8|9|a|b`). Provider **asks** both when a fenced bootstrap / schedule / retry writes empty Call and Refund cells. This function does not write a cell. This function does not name a Form or a Booking.

2. **Name the stable source row id** — `stableSourceRowId`. Form (`kind === "form"`): `lead:${(lead_id || ref_no).toLowerCase()}`; missing both **throws** (`no durable lead identity`). Call (`kind === "call"`): `managedIdentity` on `provenance.raw`. Booked Deal (`source_tab === "Booked Deals"`): `booking:${normalized_job_no ?? parsing.normalizeJobNo(job_no)}`; missing Job **throws**. Everything else (Refund): `managedIdentity` on `provenance.raw`. `managedId` walks exact aliases `vantage_ingestion_id` / `Vantage Ingestion ID` / `vantage ingestion id` and returns the first trimmed cell. Private `managedIdentity` requires `/^vantage:[0-9a-f-]{36}$/i` (looser than the mint regex) and **lowercases**. Missing or malformed **throws** (`requires a valid vantage_ingestion_id`). `LID_BestRelo` is not an `AuthoritativeObservation`. This function does not use `provenance.source_row_key`. This function does not use `sheet_row`.

3. **Refuse a copied identity except two-agent Booked Deals** — `assertUniqueSourceIdentities` walks the remap’s authoritative set. Same `stableSourceRowId` twice **throws**, unless both rows are Booked Deals (two agents on one Job share `booking:${job}`). Application plan **asks** this before remap. A Form vs Form copy, a Call vs Call copy, or a Refund vs Refund copy is a hard refuse. This function does not open a conflict row — it throws so plan never starts.

4. **Checksum what the sheet owns for this row** — `sourceOwnedContentHash` **asks** `durableWork.computeChecksum` with `checksum_version: 1`, `artifact_kind: "ingestion_plan"`, caller `schema_version`, payload `{ stable_source_row_id, source_owned_values }`. Remap passes the mutation’s source-owned bag (drops `booked_lead` / `form_lead_id` / `ingestion_source` / `notes`). Conflict / invalid rows pass `provenance.raw` or `{ reason, raw }`. Later `sourceChangePolicy.ts` compares this hash; this file does not skip receipts.

Shared beats, not owner operations: `MANAGED_ID_HEADER` (`vantage_ingestion_id`), `MANAGED_ID_ALIASES`, unused `canonicalSourceValues` (`JSON.parse(canonicalJson(value))` — no caller).

## Organization

Keep one file as the screenplay for “name each Best Relocation row with a stable identity that survives reorder — mint vantage: for Calls and Refunds, lead: for Forms, booking: for Jobs — then refuse a copy except two-agent Booked Deals, and checksum what the sheet owns — never write a cell, never fall back to row number, never put LID on the walk.” Inspect write, HTTP screenplay, remap, parse Job fold, receipt skip, Mongo adopt, and apply already live in deeper **modules**. Do not pull those in. Do not invent a `BestRelocationIdentityService` class. Do not invent a begin / complete **seam** here — naming a row is not a Domain Command. Do not invent a second Job **adapter** beside `parsing.normalizeJobNo`. Do not invent a second checksum **adapter** beside `durableWork.computeChecksum`. Do not invent a sheet-write **adapter** here — `provider.ts` already owns the fenced empty-cell write.

**External interface** stays small (this is the test surface). Faces `applicationPlan.ts` / `provider.ts` / `ingestion.test.ts` already import:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `stableSourceRowId` | `nameTheStableSourceRowId` | remap, Job poison, conflicts, reorder test |
| `assertUniqueSourceIdentities` | `refuseACopiedSourceIdentityExceptTwoAgentBookedDeals` | application plan before remap |
| `sourceOwnedContentHash` | `checksumWhatTheSheetOwnsForThisRow` | remap + later receipt skip |
| `newManagedIngestionId` | `mintAVantageManagedIngestionId` | provider fenced repair |
| `isValidManagedIngestionId` | `thisIsAStrictVantageUuidV4` | provider refuse malformed / copied |
| `managedId` | `readTheManagedIngestionIdFromTheRawRow` | Call / Refund name; provider imports and does not call |
| `MANAGED_ID_HEADER` | keep | provider writes this header string |
| `AuthoritativeObservation` | `BestRelocationAuthoritativeRow` | Form / Call / Booked Deal / Refund — never LID |

Keep the old names as one-line aliases until `applicationPlan.ts`, `provider.ts`, the barrel, and `ingestion.test.ts` migrate. Do not export `managedIdentity` / `MANAGED_ID_ALIASES` / `canonicalSourceValues` as a new public story. Do not make callers learn `InTransaction` or CRUD verbs.

**No class for the workflow.** The one type that earns a name is the row this file is allowed to name:

```ts
type BestRelocationAuthoritativeRow =
  | ParsedFormLead
  | ParsedCallLead
  | ParsedBookedDeal
  | ParsedRefund
```

That is the handoff from “parse already typed the tab” to “remap may key an action.” Do not put `LidBestReloEntry` on that union so “LID can be an action.” Do not put `sheet_row` on the id so “reorder still works.” Do not put `plan_checksum` on the hash so “identity owns approve.”

`SheetRow` / `Parsed*` stay on sibling `types.ts`. Do not move those cards here.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// identity.ts
// A Call or Refund has no Lead ID.
// Mint a vantage UUID so the same row keeps its name after a sort.
// A Form is lead: plus Lead ID or Tracking Reference — never the sheet row.
// A Booking is booking: plus the Best Relocation Job fold.
// Two agents on that Job share one name.
// Refuse a copied identity, except those two Booked Deal rows.
// Checksum the values the sheet still owns.
// This file does not write a cell.
// This file does not fall back to row number.
// This file does not put LID_BestRelo on the walk.

// ── 1. Mint and validate a vantage: UUID v4 ───────────────

export function mintAVantageManagedIngestionId()
export function thisIsAStrictVantageUuidV4(value)

// ── 2. Name the stable source row id ──────────────────────

export function nameTheStableSourceRowId(row)
export function readTheManagedIngestionIdFromTheRawRow(raw)  // exact aliases
function requireAManagedIdentityOnACallOrRefund(raw, tab, rowNumber)
function nameAFormByLeadIdOrTrackingReference(row)          // throws if neither
function nameABookingByTheBestRelocationJobFold(row)        // parsing.normalizeJobNo

// ── 3. Refuse a copied identity ───────────────────────────

export function refuseACopiedSourceIdentityExceptTwoAgentBookedDeals(rows)

// ── 4. Checksum what the sheet owns ───────────────────────

export function checksumWhatTheSheetOwnsForThisRow(row, sourceOwnedValues, schemaVersion)
```

Read the primary path out loud: *Mint a vantage UUID v4 when inspect must fill an empty Call or Refund cell. Name a Form `lead:` plus Lead ID or Tracking Reference — throw if both are missing. Name a Call or Refund by the vantage cell, never by phone or sheet row. Name a Booking `booking:` plus the Best Relocation Job fold so two agents share one name. Refuse a copied identity unless both rows are Booked Deals on that Job. Checksum the values the sheet still owns. Do not write a cell. Do not fall back to row number. Do not put LID_BestRelo on the walk.*

That is the operation. `stableSourceRowId` is not.

## Precise logic I would tighten while renaming

1. **Two validators.** Mint / provider refuse use the strict UUID v4 regex. Call / Refund naming uses `/^vantage:[0-9a-f-]{36}$/i`. A `vantage:` string with 36 hex/dash characters can name a row and still fail inspect. Do not silently unify the two regexes so “one validator owns vantage.”

2. **Two header recognizers.** This file’s `managedId` walks three exact aliases. Provider column find is `/^vantage[ _]ingestion[ _]id$/i`. Provider imports `managedId` and never calls it. Do not start **asking** `managedId` from provider in this rename so “one header owns identity.”

3. **HTTP screenplay still falls back to sheet row.** `plan.sourceLeadKey` is `form:${SOURCE_COMPANY}:${lead_id ?? ref_no ?? source_row_key}` and `call:${SOURCE_COMPANY}:${phone}:${day}:${time || sheet_row}`. This file **throws** on a Form without durable identity and names a Call by `vantage:` only. Do not start reading `source_row_key` here so “one key owns the Form.” Do not start naming a Call by phone + day so “HANDOFF wins.”

4. **`canonicalSourceValues` has no caller.** Remap hashes the mutation bag or `provenance.raw` directly. Do not start wrapping those bags so “one canonicalize owns the hash.”

5. **Two Job folds.** This file **asks** `parsing.normalizeJobNo` (strip non-alphanumerics). `bookingIdentity.normalizeJobNo` keeps a space. Do not silently switch Booked Deal naming onto Booking Identity so “one Job owns both.”

6. **Two-agent Booked Deals share one id.** Unique assert **continues** when both rows are Booked Deals. A Form/Call/Refund copy throws. Do not start allowing two Calls with the same `vantage:` so “every tab may share.”

7. **`LID_BestRelo` is absent.** `AuthoritativeObservation` has no LID member. Application plan never puts LID on the walk. Do not add it so “every tab has a stable id.”

8. **This file does not write.** Provider owns the fenced `findReplace` `^$`. Do not start a Sheets client here so “identity owns repair.”

9. **Leave sibling modules alone.** `provider.ts` fenced write, `applicationPlan.ts` remap, `plan.ts` HTTP keys, `parsing.normalizeJobNo`, `durableWork.computeChecksum`, later `sourceChangePolicy.ts` receipt skip are already the right **depth**.

10. **Do not silently fix `HANDOFF.md`.** It still names Call idempotency as source company + phone + date/time, and Form as source company + sheet UUID/ref. This file names Call by `vantage:` and Form by `lead:` without `SOURCE_COMPANY`. Name the drift. Do not rewrite the handoff in this pass.

## Testing

The **interface** is the test surface: `nameTheStableSourceRowId`, `refuseACopiedSourceIdentityExceptTwoAgentBookedDeals`, `checksumWhatTheSheetOwnsForThisRow`, `mintAVantageManagedIngestionId`, `thisIsAStrictVantageUuidV4`.

Today’s `ingestion.test.ts` already **asks** `stableSourceRowId` + `sourceOwnedContentHash` for reorder: two Call rows keep the same ids and the same hash after the tab is sorted (`managed("1")` / `managed("2")` are strict UUID v4). Folder `bestRelocationSheetIngest.test.ts` never imports this file. Application-plan tests prove unique-identity throw and two-agent Job poison through `buildBestRelocationApplicationPlan`, not this file’s exports. That is close, but it does not name the four operations.

Replace the fixture-as-plan style with tests that name the operation:

**Mint and validate**
- `mintAVantageManagedIngestionId` matches the strict UUID v4 regex.
- `copied-row-2` fails the strict regex and still matches the loose 36-char Call/Refund reader — prove both, do not unify.

**Name the stable source row id**
- Form with `lead_id` → `lead:` + lowercased id. `ref_no` is unused when `lead_id` is present.
- Form with only `ref_no` → `lead:` + lowercased ref.
- Form with neither → **throws** (`no durable lead identity`). `source_row_key` is ignored.
- Call named by `vantage_ingestion_id` survives row reorder. Phone / date / `sheet_row` do not change the id.
- Call missing the cell → **throws** (`requires a valid vantage_ingestion_id`).
- Booked Deal → `booking:` + parse Job fold (`P-123` → `booking:P123`, not `booking:P 123`).
- Two Booked Deal rows on the same Job share one id.
- Refund named by `vantage:`, not by Job.
- `LID_BestRelo` is not accepted.

**Refuse a copied identity**
- Two Forms with the same `lead_id` → **throws**.
- Two Calls with the same `vantage:` → **throws**.
- Two Booked Deals on the same Job → **does not throw**.
- A Form `lead:x` and a Call `vantage:…` may coexist.

**Checksum what the sheet owns**
- Same stable id + same source-owned bag + schema `2` → same 64-hex hash after reorder.
- Changing a source-owned phone changes the hash.
- Runtime callers still work when `canonicalSourceValues` is unused.

Do **not** add a helper-unit test that has to change when `managedIdentity` is inlined. Do not add a test per alias string if the parent already proves one header is enough.

Caller to keep green: `applicationPlan.ts` still **asks** unique + stable id + hash; `provider.ts` still **asks** mint / strict validate / header string and still does not call `managedId`; `ingestion.test.ts` reorder case; HTTP `plan.sourceLeadKey` still falls back to sheet row.

## What I would not do

- A `BestRelocationIdentityService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `toLowerCase`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or a `mint.ts` / `hash.ts` / `unique.ts` split “for cleanliness.”
- Breaking pair-then-threshold, inspect 409, or the before-commit / after-commit **seam** on a later apply.
- Treating `provider.ts` fenced write, `plan.ts` HTTP keys, `applicationPlan.ts` remap, `canonicalLeadAdoption.ts` Mongo adopt, or `sourceChangePolicy.ts` receipt skip as this story.
- Making `LID_BestRelo` an authoritative row, falling back to `source_row_key` / `sheet_row`, or naming a Call by phone + day.
- Silently “fixing” the two validators, the two header recognizers, unused `canonicalSourceValues`, unused provider `managedId`, the two Job folds, or `HANDOFF.md` Call idempotency.
- Starting Owner approve, Sheets write, or `runSheetSyncDrain` from this file.
- Editing `src/`, tests, routes, models, or `docs/knowledge` in this pass.

---

**Glossary:** this checkout's `CONTEXT.md` does not define Ingestion Origin or Best Relocation. The stamped service is `docs/knowledge/services/ingestion.md`. `docs/adr/` is absent here; do not invent copies. Knowledge cites ADR-0001 (Sheets are a projection).
