# Resolve This Granot Carrier Code To The Moving Carrier Legal Name And DOT Cell That Master Will Write — Never Write The Raw Code, Never Invent A Carrier, Never Filter Active, Never Stamp The Seed List, Never Append Master — operational story

- Status: recommended
- Service: `tariff` (Wave A, visited)
- Pass: 2 of this service — `resolveCarrier.ts`
- Remaining in this service: none — `index.ts` already skipped
- Target: `src/services/tariff/resolveCarrier.ts`
- Knowledge: [`docs/knowledge/services/tariff.md`](../../../docs/knowledge/services/tariff.md) (append-only [Tariff Adjustment](../../../../CONTEXT.md) rows to `TARIFF_SHEET_ID` / `Master`; Carrier is the resolved [Moving Carrier](../../../../CONTEXT.md) legal name and DOT for the [Granot Carrier Code](../../../../CONTEXT.md); lookup is `moving_carriers.granot_carrier_code`; unknown codes are 400; **not Sheet Sync**). Distinct from already-recommended sibling append: [tariff-append.md](tariff-append.md) (`appendTariffAdjustmentRows` **asks** this file as `options.resolveCarrier ?? resolveTariffCarrierCell`; this file does **not** talk to Google). Distinct from already-recommended Moving Carrier catalog: [moving-carriers-moving-carrier.md](moving-carriers-moving-carrier.md) (desk list / record / correct / CSV — **does not import** this file; this file **does not import** that file; identity there is DOT+MC; this file matches only `granot_carrier_code`). Distinct from already-recommended seed plan: [moving-carriers-granot-carrier-code-seed.md](moving-carriers-granot-carrier-code-seed.md) (`planGranotCarrierCodeSeed` — **does not import** this file; this file does **not** read `GRANOT_CARRIER_CODE_SEEDS`). Distinct from leftover Granot-code fold: Wave B `src/config/domain/granotCarrierCodes.ts` (`normalizeGranotCarrierCode` — this file **asks** it; the 21-row seed list stays unused here). Distinct from leftover Wave B model setter: `src/models/MovingCarrier.ts` (same trim / collapse / uppercase on write; unique partial `{ granot_carrier_code }` among non-empty). Distinct from leftover error class: `src/services/v1ServiceError.ts` (`V1ServiceError` 400 → leftover `AppError` / `ERROR_CODES.BAD_REQUEST`). Distinct from Wave B HTTP: `src/routes/tariff-adjustments.routes.ts` (`connectMongo` so this lookup can run; maps leftover `AppError` to `{ ok: false, error }`; does **not** import this file). Distinct from Wave B pair contract: `src/validation/v1/tariffAdjustments.validation.ts` (`carrier` is the raw Granot Carrier Code; Zod does **not** resolve it). Distinct from Wave B Bearer: `src/middleware/requireApiSecret.ts` (`TARIFF_ADJUSTMENT_BEARER_ROUTE`). Proof runner: `scripts/prove-tariff-append.ts` **asks** sibling append, not this file. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Tariff Adjustment](../../../../CONTEXT.md), [Moving Carrier](../../../../CONTEXT.md), [Granot Carrier Code](../../../../CONTEXT.md); do not invent glossary copies. `docs/adr/` is absent here — do not invent ADR copies. Knowledge cites `docs/tariff-adjustment/tariff-adjustment-specification.md`; that folder is absent in this checkout — do not invent it. This checkout has no `src/services/dailyOperations/`. Do not add a Tariff Service file in this rename.
- Callers: **one runtime import site plus the barrel and the folder test.** Sibling `append.ts` **asks** `resolveTariffCarrierCell` unless the caller injects `resolveCarrier` (Wave B route and the proof inject nothing, so live HTTP and the proof hit this file). Barrel `tariff/index.ts` re-exports `resolveTariffCarrierCell`, `formatTariffCarrierCell`, and `TariffCarrierLookup`. Tests on this **interface**: `tariff.service.test.ts` (fold `"c2c"` → `"C2C"` then paint `"COAST TO COAST VAN LINES INC 4168983"`; unknown → 400 `"Unknown Granot Carrier Code: UNKNOWN"`; leftover `formatTariffCarrierCell` is asked separately). Wave B `tariff-adjustments.routes.ts` does **not** import this file. Wave B `tariff-adjustments.routes.test.ts` injects `appendRows` and never hits this lookup. Already-recommended `movingCarrier.service.ts` does **not** import this file. Already-recommended `granotCarrierCodeSeed.ts` does **not** import this file. `v1.service.ts` does **not** re-export this file. Not this **interface**: `appendTariffAdjustmentRows`, `listMovingCarriers`, `createMovingCarrier`, `planGranotCarrierCodeSeed`, leftover `normalizeGranotCarrierCode` itself, leftover `GRANOT_CARRIER_CODE_SEEDS`.
- Seams callers need: public resolve (sibling append’s default) vs injected `lookup` (folder test binds name + DOT or `null`); this file’s lookup inject (catalog row or `null`) vs sibling append’s `resolveCarrier` inject (already-painted cell string); leftover `V1ServiceError` 400 vs Wave B `AppError` JSON; route `connectMongo` vs this file’s `MovingCarrier.findOne` (this file does not connect); live Mongo `granot_carrier_code` vs unused Owner seed list; catalog default-active desk vs this file’s no-`active` filter. There is no begin / complete Domain Command **seam**. There is no Google write **seam**. There is no catalog create **seam**. There is no seed-stamp **seam**. There is no Owner-actor **seam**. There is no `active` **seam**.
- Split later (only if the file outgrows one sitting): this ~43-line file is one sitting if you read it as fold the Granot Carrier Code — refuse blank — find the Moving Carrier that already has that code — refuse unknown or a row without name or DOT — paint legal name then DOT. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `lookup.ts` / `format.ts`. Sibling append stays the already-recommended pass. Catalog stays `movingCarriers/`. Seed plan stays the already-recommended sibling of that folder.

`resolveTariffCarrierCell` / `formatTariffCarrierCell` / `lookupMovingCarrierByGranotCode` are executor mechanics. The owner question is: *The Granot Forms View sent a Granot Carrier Code. Before Master writes the Carrier column, fold that code, find the Moving Carrier that already has it, and paint the legal name then the DOT. If the code is blank after fold, refuse 400. If no document has that code, or the document has no name or no DOT, refuse 400 as unknown. Do not write the raw code onto Master. Do not invent a Moving Carrier. Do not hide an inactive carrier. Do not read the Owner seed list. Do not append Master. Mongo connect lives on the route. This file only answers the cell.*

Who appends onto Master already lives in already-recommended `append.ts`. Who lists / records / imports Moving Carriers already lives in already-recommended `movingCarrier.service.ts`. Who plans seed stamps already lives in already-recommended `granotCarrierCodeSeed.ts`. Who folds the code already lives in Wave B `granotCarrierCodes.ts`. Do not pull those in.

## What this file actually does

One “resolve this Granot Carrier Code to the Moving Carrier legal name and DOT cell that Master will write” story in one sitting, not “a carrier CRUD helper,” and not Append Onto Master / Record A Moving Carrier / Plan The Seed Stamp:

1. **Resolve this Granot Carrier Code to the Moving Carrier legal name and DOT cell** — `resolveTariffCarrierCell(granotCarrierCode, lookup?)`. Fold through leftover `normalizeGranotCarrierCode` (`trim`, strip interior space, uppercase). Empty after fold → leftover `V1ServiceError` 400 `"Granot Carrier Code is required"` before lookup. Then `lookup(folded)` (default `lookupMovingCarrierByGranotCode`: `MovingCarrier.findOne({ granot_carrier_code: folded })`, select `name` + `dot_number` only, lean). Missing document, missing `name`, or missing `dot_number` → leftover `V1ServiceError` 400 `"Unknown Granot Carrier Code: ${folded}"`. Success paints leftover `formatTariffCarrierCell`: `` `${name} ${dot_number}` ``. This beat does **not** filter `active`. This beat does **not** select `mc_number` / `created_from`. This beat does **not** read `GRANOT_CARRIER_CODE_SEEDS`. This beat does **not** `connectMongo`. This beat does **not** create a carrier. This beat does **not** append Master. This beat does **not** write the raw Granot Carrier Code.

There is no second update or delete operation. `formatTariffCarrierCell` / `lookupMovingCarrierByGranotCode` are beats inside story 1. `formatTariffCarrierCell` is exported today because the folder test and the barrel treat the paint as the **interface** — that is a leak, not a second owner story. `lookupMovingCarrierByGranotCode` is already private.

## Organization

Keep one file. This is the screenplay for “fold the Granot Carrier Code — refuse blank — find the Moving Carrier that already has that code — refuse unknown or a row without name or DOT — paint legal name then DOT.” Sibling append already lives in already-recommended `append.ts`. Desk catalog already lives in already-recommended `movingCarrier.service.ts`. Seed plan already lives in already-recommended `granotCarrierCodeSeed.ts`. Code fold already lives in Wave B `granotCarrierCodes.ts`. Route connect + `AppError` mapping already live on Wave B `tariff-adjustments.routes.ts`. Do not pull those in. Do not invent a `TariffCarrierService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a Google **adapter** so “resolve can append.” Do not invent a catalog **adapter** so “unknown codes create a carrier.” Do not invent a seed **adapter** so “unknown codes fall back to `GRANOT_CARRIER_CODE_SEEDS`.” Do not invent an `active` **seam** so “inactive carriers 400.” Do not invent a CRUD folder so “lookup / format / resolve each get a file.”

Do not move `resolveTariffCarrierCell` into `append.ts` so “one service owns tariff.” Do not move it into `movingCarrier.service.ts` so “one service owns carriers.” Do not teach `planGranotCarrierCodeSeed` to **ask** this file so “a missing seed can still paint.” Do not teach leftover `normalizeGranotCarrierCode` a Mongo hop so “fold owns lookup.” Do not split `create.ts` / `update.ts` / `delete.ts` / `lookup.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `resolveTariffCarrierCell` | `resolveThisGranotCarrierCodeToTheMovingCarrierNameAndDotCell` | sibling append’s default; tests inject `lookup` |
| `TariffCarrierLookup` | `MovingCarrierNameAndDotForTheTariffCell` | injected lookup returns name + DOT or `null` |
| `formatTariffCarrierCell` | leftover paint leak | folder test + barrel only — unexport after the test names the resolve |

Keep the old names as one-line aliases until sibling `append.ts`, `tariff/index.ts`, and `tariff.service.test.ts` migrate. Do not make callers learn `findOne` / `granot_carrier_code` / leftover `V1ServiceError` as the domain language. Do **not** keep `formatTariffCarrierCell` as a public **seam** after the test moves onto resolve. Do **not** put these names onto leftover `v1.service.ts` so “every public resolve lives on the barrel.” Do **not** export `lookupMovingCarrierByGranotCode`. Do **not** rename persisted `granot_carrier_code` / `dot_number`. Do **not** rename the 400 strings — Wave B HTTP returns `error.message` as JSON.

**No workflow class.** The one type that *does* earn a name is the name-and-DOT bag the injected lookup already returns:

```ts
type MovingCarrierNameAndDotForTheTariffCell = {
  name: string
  dot_number: string
}
```

That is the handoff from “Mongo (or the test) found a carrier” to “Master’s Carrier cell is legal name, one space, DOT.” Do **not** add `mc_number` / `active` / `granot_carrier_code` onto that bag so “the cell can show MC.” Do **not** add a Mongo `ClientSession` onto `resolveThisGranotCarrierCodeToTheMovingCarrierNameAndDotCell` so “tariff is a Domain Command.”

Leave sibling `appendTariffAdjustmentRows` on `append.ts`. Leave desk catalog on already-recommended `movingCarrier.service.ts`. Leave seed plan on already-recommended `granotCarrierCodeSeed.ts`. Leave fold on Wave B `granotCarrierCodes.ts`. Leave `connectMongo` on the route.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// resolveCarrier.ts
// The Granot Forms View sent a Granot Carrier Code.
// Paint the Moving Carrier legal name and DOT that Master will write.

export type MovingCarrierNameAndDotForTheTariffCell = {
  name: string
  dot_number: string
}

// ── 1. Resolve this Granot Carrier Code to the name-and-DOT cell ─

export async function resolveThisGranotCarrierCodeToTheMovingCarrierNameAndDotCell(
  granotCarrierCode: string,
  lookup: (
    foldedGranotCarrierCode: string,
  ) => Promise<MovingCarrierNameAndDotForTheTariffCell | null> = findTheMovingCarrierThatAlreadyHasThisGranotCode,
): Promise<string> {
  const folded = foldThisGranotCarrierCode(granotCarrierCode)
  refuseABlankGranotCarrierCode(folded)

  const carrier = await lookup(folded)
  refuseAnUnknownOrIncompleteMovingCarrier(folded, carrier)

  return paintLegalNameThenDot(carrier)
}

function foldThisGranotCarrierCode(raw) // leftover normalizeGranotCarrierCode
function refuseABlankGranotCarrierCode(folded) // 400 "Granot Carrier Code is required"
async function findTheMovingCarrierThatAlreadyHasThisGranotCode(folded)
  // MovingCarrier.findOne({ granot_carrier_code: folded }).select({ name, dot_number })
  // missing name or missing DOT → null
function refuseAnUnknownOrIncompleteMovingCarrier(folded, carrier)
  // 400 `Unknown Granot Carrier Code: ${folded}`
function paintLegalNameThenDot(carrier) // `${name} ${dot_number}`

export const resolveTariffCarrierCell =
  resolveThisGranotCarrierCodeToTheMovingCarrierNameAndDotCell
export const formatTariffCarrierCell = paintLegalNameThenDot
```

Read the resolve path out loud: *Fold the Granot Carrier Code. If it is blank, refuse 400. Find the Moving Carrier that already has that folded code. If none, or the row has no name or no DOT, refuse 400 as unknown. Paint legal name, one space, DOT. Hand the cell to append. Do not write the raw code. Do not invent a carrier. Do not hide an inactive row. Do not read the seed list. Do not append Master.*

That is the operation. `formatTariffCarrierCell` is not a second product.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`formatTariffCarrierCell` is a leftover paint leak.** The folder test asks it with a hand-built `{ name, dot_number }` and never goes through refuse. After rename, the test must **ask** `resolveThisGranotCarrierCodeToTheMovingCarrierNameAndDotCell` and assert the painted cell — not a leftover helper that still accepts any two strings. Unexport after the barrel stops re-exporting it.

2. **Missing name or missing DOT is sold as unknown.** A document can exist and still return `null` when `name` or `dot_number` is empty. The 400 string is still `"Unknown Granot Carrier Code: ${folded}"`. Do not silently split a second 400 so “incomplete rows say incomplete.” Lock the current string. Schema says both fields are required, so this is a defensive miss, not a second owner story.

3. **Whitespace-only `name` still paints.** `!doc?.name` is false for `"   "`, so the cell becomes `"    4168983"`. Do not silently trim here so “the cell looks clean.” Catalog record already folds display name. Lock the current truthy check.

4. **This file does not filter `active`.** Already-recommended `listMovingCarriers` defaults to active only. Already-recommended receiver-username find is active-only. This lookup will paint an inactive carrier that still has a Granot code. Do not silently add `active: true` so “we match the desk.” Inactive-with-code is a live cell today.

5. **The Owner seed list is not a fallback.** Wave B `GRANOT_CARRIER_CODE_SEEDS` has `C2C` / `4168983`. This file never reads it. An unknown live code is 400 even when the seed list knows the DOT. Do not silently fall back to seeds so “proof can run without Mongo.” Already-recommended `planGranotCarrierCodeSeed` stays the report; the stamp script stays the write.

6. **This file does not go through the catalog service.** `MovingCarrier.findOne` is the right **depth**. Already-recommended `listMovingCarriers` pages and regexes. Do not silently **ask** `listMovingCarriers({ q: code })` so “one service owns carriers.” Do not move this query into `movingCarrier.service.ts` in the same rename.

7. **Fold happens twice in the company, once here.** Wave B model setter uses the same trim / collapse / uppercase on write. This file folds the inbound code before query. Stored codes should already match. Do not silently skip the inbound fold so “Mongo setter already did it” — HTTP / proof still send `"c2c"`. The folder test locks that fold.

8. **Two inject seams are not the same adapter.** Sibling append injects `(code) => paintedCell`. This file injects `(folded) => nameAndDot | null`. The append test never hits this refuse path. Do not silently make append inject this lookup so “one inject owns both.” Leave append’s cell inject; leave this file’s catalog inject.

9. **`connectMongo` is not this file’s write.** The route connects so `findOne` can run. The proof’s live append also needs a connected catalog for the default resolver. This file talks to Mongoose. Do not silently `connectMongo` inside resolve so “the service can look up without the route.”

10. **Leftover `V1ServiceError` is the 400.** Wave B maps leftover `AppError`. New typed `ValidationError` would change `code` only if someone swaps the class. Do not silently switch to `ValidationError` so “new code prefers subclasses.” Lock leftover `V1ServiceError` and the two messages.

11. **Leave sibling modules alone.** `normalizeGranotCarrierCode`, `MovingCarrier.findOne`, leftover `V1ServiceError`, and sibling `appendTariffAdjustmentRows` are already the right **depth**. This file orchestrates fold + lookup + refuse + paint.

## Testing

The **interface** is the test surface: `resolveThisGranotCarrierCodeToTheMovingCarrierNameAndDotCell`.

Today’s `tariff.service.test.ts` already names the happy fold and the unknown 400. Keep them, and make the leftover paint test ask the resolve:

**Resolve the Carrier cell**
- `"c2c"` folds to `"C2C"` before lookup; the painted cell is `"COAST TO COAST VAN LINES INC 4168983"` (already locked).
- `""` / whitespace-only refuse 400 `"Granot Carrier Code is required"` before lookup.
- Injected lookup `null` refuses 400 `"Unknown Granot Carrier Code: UNKNOWN"` (already locked).
- Injected lookup `{ name: "", dot_number: "4168983" }` or missing DOT is the same unknown 400 — only if you keep the current incomplete-as-unknown rule.
- The painted cell is legal name, one space, DOT — not `C2C`, not MC, not parentheses.
- Injected lookup receives the folded code, not the raw string.

**Not this file**
- Sibling append unique-code map, Florida Timestamp, `"Rule "` ensure, `INSERT_ROWS`, and receipt `spreadsheetId` stay on already-recommended [tariff-append.md](tariff-append.md).
- HTTP pair, forbidden customer / job keys, Bearer, hidden `spreadsheetId`, and `connectMongo` stay on Wave B route + Zod tests.
- Desk list / record / CSV and seed `will_set` / `will_replace` stay on already-recommended moving-carriers files.

Do **not** add a test per helper (`foldThisGranotCarrierCode`, `refuseABlankGranotCarrierCode`, `paintLegalNameThenDot`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

`formatTariffCarrierCell` stays exported only until the folder test migrates onto the resolve.

## What I would not do

- A `TariffCarrierService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `findOne`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or into `movingCarriers/` “for cleanliness.”
- Breaking the live-resolve **seam**: do not write the raw Granot Carrier Code, do not invent a carrier, do not append Master, do not stamp the seed list.
- Treating already-recommended `appendTariffAdjustmentRows`, `listMovingCarriers`, or `planGranotCarrierCodeSeed` as this story.
- Inventing an `active` **seam** that has only one **adapter** so “inactive carriers 400.”
- Silently “fixing” the unknown-vs-incomplete 400, the whitespace-only name paint, the unused seed list, leftover `V1ServiceError`, or the missing `active` filter while recommending a rename.
- Jumping to Wave B while this pass is open. After this file, listed Wave A is complete — the next run opens Wave B. Do not open Wave B in the same sitting.
- Writing a whole-folder recommendation for `tariff`.
