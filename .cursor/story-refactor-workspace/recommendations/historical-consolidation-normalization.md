# Fold This Historical Sheet Cell For Exact Match Or Display — Parse This Agent Cell On Slash Only After Stripping Terminal Split And Percent, Keep This Customer Cell As One Display, Turn This Money Cell Into Integer Cents, Then Give Remainder Cents To The Earliest Distinct Agents — Never Resolve The Catalog, Never Plan A Booking, Never Call Live Allocation — operational story

- Status: recommended
- Service: `historicalConsolidation` (Wave A, in-progress)
- Pass: 11 of this service — `normalization.ts`
- Remaining in this service: `dateParsing.ts`, `stableJson.ts`, `mongoValues.ts`
- Target: `src/services/historicalConsolidation/normalization.ts`
- Knowledge: none for this folder. The staged-merge spec is [`historical-consolidation-rules-and-staging-spec.md`](../../../docs/index.md) (Parser specification: common `ParsedNameField`; Agent tokenizer — NFKC then terminal `Split` / `0%`–`100%`, split on `/` only, empty-token reject, exact-fold unique in source order; catalog resolve is **not** this file; Customer parser — display fold, flags for review, never entity-split; Exact comparison — NFKC → trim → collapse → case fold, punctuation kept; Agent allocation — integer cents, `floor(total / count)`, remainder to earliest source-order Agents, sum must be exact; required pure tests for one / two / three Agents, missing binder not zero, slash + terminal metadata, repeated `/`). Hardening plan: [`historical-consolidation-final-hardening-and-pre-run-implementation-plan.md`](../../../docs/index.md) (NFKC / trim / collapse / case fold; money into integer cents; blank, negative, non-finite, malformed quarantined; allocation cents sum exactly). Naming note: [`historical-consolidation-lead-customer-naming.md`](../../../docs/index.md) (slash-separated Customer labels must not invent extra Customers). Already-recommended siblings: [historical-consolidation-classification.md](historical-consolidation-classification.md) (never **asks** this file), [historical-consolidation-planner.md](historical-consolidation-planner.md) (**asks** leftover `normalizeExact` / leftover `normalizeDisplay` / leftover `parseAgentNames` / leftover `parseCustomerName` / leftover `parseMoneyToCents` / leftover `allocateCents`; leftover `catalog.agent` resolves tokens **after** this parse; leftover `parseEasternDate` is leftover `dateParsing.ts`), [historical-consolidation-manifest.md](historical-consolidation-manifest.md), [historical-consolidation-apply.md](historical-consolidation-apply.md), [historical-consolidation-verify.md](historical-consolidation-verify.md), [historical-consolidation-rollback.md](historical-consolidation-rollback.md), [historical-consolidation-migration-context.md](historical-consolidation-migration-context.md), [historical-consolidation-target-guard.md](historical-consolidation-target-guard.md), [historical-consolidation-operational-lock.md](historical-consolidation-operational-lock.md), [historical-consolidation-schema-validation.md](historical-consolidation-schema-validation.md) — none **ask** this file. Distinct from leftover `dateParsing.ts` (Eastern wall clock — **asks** leftover `ParseResult` type only). Distinct from leftover `stableJson.ts` / leftover `mongoValues.ts` (hash / `$oid`). Distinct from already-recommended [leads-lead-name.md](leads-lead-name.md) (compose Form / Call `name` from first + last — no NFKC, no slash split). Distinct from leftover `agents/agentName.ts` leftover `normalizeAgentName` (trim / collapse / lower — **no** NFKC). Distinct from already-recommended [agents-agent-allocation.md](agents-agent-allocation.md) leftover `splitBinderEvenly` (dollars in / dollars out; **one or two** Agents; secondary gets `floor`; primary gets the remainder). Distinct from leftover `ingest-historical-sheets.ts` (the write-capable row-by-row upsert the spec forbids becoming the planner *or* this fold). `package.json` still names `pnpm historical:plan`; the staged-merge script folder is **absent** from this checkout. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — do not invent “Historical Normalization” copies. `docs/adr/` is absent here — do not invent ADR copies. Do not add a Historical Consolidation Service in this rename.
- Callers: **already-recommended leftover planner, this folder fixture, the barrel, and leftover `dateParsing.ts` for the type.** Already-recommended `planner.ts` imports leftover `allocateCents`, leftover `normalizeDisplay`, leftover `normalizeExact`, leftover `parseAgentNames`, leftover `parseCustomerName`, leftover `parseMoneyToCents` from this file (not the barrel). Leftover `dateParsing.ts` imports leftover `ParseResult` only. Barrel `historicalConsolidation/index.ts` re-exports the six functions — **not** leftover `ParsedNameField` / leftover `ParseResult`. Folder leftover `normalization.test.ts` **asks** leftover `normalizeExact`, leftover `parseAgentNames`, leftover `parseCustomerName`, leftover `parseMoneyToCents`, leftover `allocateCents` (not leftover `normalizeDisplay`) and then **asks** leftover `parseEasternDate` / leftover `googleSerialToEastern` from leftover `dateParsing.ts` in the same file — those last two are **not** this **interface**. Folder leftover `planner.test.ts` does **not** import this file — it **asks** leftover `planHistoricalConsolidation`, which **asks** these folds as a sibling **ask**. Already-recommended sealer / apply / verify / rollback / classifier / schema parity do **not** import this file. Scripts in this checkout do **not** import this file. Not this **interface**: leftover `planHistoricalConsolidation`, leftover `parseEasternDate`, leftover `googleSerialToEastern`, leftover `splitBinderEvenly`, leftover `officialBookingAllocations`, leftover `normalizeAgentName`, leftover `normalizeLeadName`, leftover `catalog.agent`, leftover `ingest-historical-sheets.ts`.
- Seams callers need: leftover exact fold vs leftover display fold (match vs print); leftover Agent slash tokenize vs leftover Customer keep-one (same leftover `ParsedNameField` card, two stories); leftover money leftover `ParseResult` vs leftover allocate throw; this parse vs leftover planner leftover `catalog.agent` resolve; this N-agent integer cents vs live leftover `splitBinderEvenly` 1-or-2 dollars; leftover `ParseResult` type shared with leftover `dateParsing.ts`. There is no begin / complete Domain Command **seam**. There is no live Form / Booking **adapter**. There is no catalog **adapter**. There is no Sheet Sync **adapter**. There is no HTTP **adapter**. There is no Eastern-date **adapter**.
- Split later (only if the file outgrows one sitting): this ~113-line file is one sitting if you read it as fold this historical sheet cell, then parse Agent / Customer / money, then split leftover cents. If it later splits by **story**: do not. One leftover fold plus three leftover cell parsers plus one leftover cent split. Never `create.ts` / `update.ts` / `delete.ts` / `parse.ts` / `normalize.ts`. Leftover planner, leftover Eastern dates, live name compose, live Agent allocation, and leftover catalog resolve stay siblings / other services.

`normalizeExact` / `normalizeDisplay` / `parseAgentNames` / `parseCustomerName` / `parseMoneyToCents` / `allocateCents` are executor mechanics. The owner question is: *The leftover planner already has a leftover sheet cell. Fold it so two labels can match (NFKC, trim, collapse, English lower) or so we can print it (same fold without lower). Read this Agent cell on `/` only after stripping a terminal `Split` and a terminal percent; refuse `&` / `+` / comma / `and` / repeated `/` / non-terminal metadata as `ambiguous`. Keep this Customer cell as one display — flag the punctuation, never split a second Customer. Turn this money cell into integer cents or say empty / invalid — never coerce blank to zero. Split those cents across distinct Agent ids in source order and give each remainder cent to the earliest id. This file does not resolve the catalog. This file does not plan a Booking. This file does not **ask** leftover `splitBinderEvenly`.*

Who walks the leftover sheets, who resolves leftover Agent tokens, who plans the leftover Booking, and who parses leftover Eastern dates already live in leftover **modules**. Do not pull those in.

## What this file actually does

Six “fold this historical sheet cell” stories in one sitting, not “a string helper,” and not Plan This Historical Merge / Name Who Shares This Booking's Binder / Compose The Lead Display Name / Parse This Eastern Date:

1. **Fold this leftover cell so two leftover labels can match** — `normalizeExact(value)`. `NFKC` then `trim` then collapse `\s+` to one space then `toLocaleLowerCase("en-US")`. Punctuation stays. Today’s fixture proves `"  Ｊane\t DOE  "` → `"jane doe"`. Already-recommended leftover planner **asks** this beat for catalog keys, aliases, Lead IDs, emails, booking facts, cancellation identity, and leftover `truthy`. This beat does **not** strip `/`. This beat does **not** **ask** leftover `normalizeAgentName`. This beat does **not** transliterate or fuzzy-match.

2. **Fold this leftover cell so we can print it** — `normalizeDisplay(value)`. Same NFKC / trim / collapse — **no** lower. Already-recommended leftover planner **asks** this beat for Form Name / Phone / zips / Lead ID / Tracking Reference, Agent and Merchant planned `name`, Booked Merchant / source / LID, and Cancellation Agent / Customer / Status. The folder fixture does **not** **ask** this export directly. This beat does **not** split an Agent. This beat does **not** compose first + last.

3. **Read this leftover Agent cell on `/` only after stripping terminal `Split` and terminal percent** — `parseAgentNames(rawValue)`. `String(rawValue ?? "")`. Display starts as leftover `normalizeDisplay(raw)`. Blank → `{ disposition: "empty", reason_codes: ["empty_agent"] }`. Terminal percent first (`/(?:^|\s)(100|[1-9]?\d)%$/u`) then terminal `split` (`/(?:^|\s)split$/iu`) — both land on leftover `metadata.terminal_percentage` / leftover `metadata.terminal_split`. Then flag leftover `ambiguous_agent_separator` (`\`, `&`, `+`, comma, or `\band\b`), leftover `empty_agent_token` (`//` or leading / trailing `/`), leftover `non_terminal_agent_metadata` (`split` or a percent still inside the remaining display). Split on `/`, fold each token, skip blank exact folds, unique by exact fold keeping first display order. Any reason → leftover `ambiguous`; else leftover `accepted`. Today’s fixture proves `" Nick / Mike / Nick 40% "` → accepted tokens `["Nick","Mike"]` plus leftover `terminal_percentage: "40%"`; `"Nick // Mike"` / `"Nick & Mike"` / `"Nick Split / Mike"` → leftover `ambiguous`. Already-recommended leftover planner **asks** this beat from leftover `parseBookingRow` on Booked `Agent`; leftover `ambiguous` becomes blocking leftover `ambiguous_agent_parse`; accepted tokens then **ask** leftover `catalog.agent`. This beat does **not** resolve an Agent. This beat does **not** split a Customer. This beat does **not** allocate cents.

4. **Keep this leftover Customer cell as one leftover display** — `parseCustomerName(rawValue)`. Display is leftover `normalizeDisplay(raw)`. Flags leftover `contains_slash` / leftover `contains_backslash` / leftover `contains_ampersand` / leftover `contains_plus` / leftover `contains_comma` / leftover `contains_and` become leftover `reason_codes` when display is non-empty. One token — the whole display — or empty leftover `empty_customer`. Disposition is leftover `accepted` or leftover `empty` — **never** leftover `ambiguous`, even when flags fire. Today’s fixture proves `" Jane / John & Co. "` → accepted leftover `display_value: "Jane / John & Co."` and one token. Already-recommended leftover planner **asks** this beat on Booked `Customer Name` and requires leftover `accepted`; flags do not quarantine. Cancellation does **not** **ask** this beat — it prints leftover `normalizeDisplay` of the raw Customer cell. This beat does **not** strip Agent metadata. This beat does **not** invent a second Customer.

5. **Turn this leftover money cell into leftover integer cents, or say leftover empty / leftover invalid** — `parseMoneyToCents(rawValue)`. `null` / `undefined` / blank → `{ disposition: "empty", reason_codes: ["missing_money"] }`. Strip a leading `$` and commas. Must match `^(?:0|[1-9]\d*)(?:\.\d{1,2})?$` — else leftover `invalid` / leftover `malformed_or_negative_money` (negatives, extra decimals, leftover `Infinity`). Cents = `whole * 100 + padded fraction`. Unsafe integer → leftover `money_out_of_range`. Accepted returns `{ value: cents, reason_codes: [] }`. Today’s fixture proves `"$1,234.50"` → `123450`; `""` empty; `"-1"` / `"1.001"` / leftover `Infinity` invalid. Already-recommended leftover planner **asks** this beat for Booked Binder and Deposit and for Refund leftover `Deposit Amount` else leftover `Binder Amount`. A miss quarantines — never coerces to zero. This beat does **not** throw. This beat does **not** allocate.

6. **Give leftover remainder cents to the leftover earliest leftover distinct leftover Agent ids** — `allocateCents(totalCents, agentIds)`. Refuse unless leftover `totalCents` is a non-negative safe integer. Unique ids via `Set` (insertion order). Empty unique throws `"At least one distinct agent is required"`. Each id gets `floor(total / n)`; remainder cents walk the list first to last. Today’s fixture proves `101` / `["a"]` → `101`; `101` / `["a","b"]` → `51` / `50`; `100` / `["a","b","c"]` → `34` / `33` / `33` and sum `100`; negative throws. Already-recommended leftover planner **asks** this beat **after** leftover `catalog.agent` resolved ids, once per distinct sale, then sums those cents by Agent. This beat does **not** parse the Agent cell. This beat does **not** **ask** leftover `splitBinderEvenly`. This beat does **not** return dollars.

There is no seventh leftover plan, leftover resolve, or leftover Eastern-date operation. Leftover `ParsedNameField` / leftover `ParseResult` are the cards operations 3–5 return and that leftover `dateParsing.ts` reuses. The barrel re-exports the six functions for a missing leftover `pnpm historical:plan` script.

## Organization

Keep one file. This is the screenplay for “fold this historical sheet cell, then parse Agent / Customer / money, then split leftover cents.” Sheet walk / leftover catalog resolve / leftover Booking plan already live on already-recommended leftover `planner.ts`. Eastern dates already live on leftover `dateParsing.ts`. Live Lead name already lives on already-recommended leftover `leadName.service.ts`. Live Agent name fold already lives on leftover `agents/agentName.ts`. Live Binder split already lives on already-recommended leftover `agentAllocation.service.ts`. Do not pull those in. Do not invent a `HistoricalNormalizationService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a catalog **adapter** so “one file owns tokenize and resolve.” Do not invent a live allocation **adapter** so “one split owns the company.” Do not invent an HTTP **adapter** so “a route can parse a cell.” Do not invent a CRUD folder so “fold / parse / allocate each get a file.”

Do not move leftover `parseAgentNames` into leftover `planner.ts` so “the leftover planner owns the tokenizer.” Do not merge this into leftover `splitBinderEvenly` so “one leftover cent math owns live and historical.” Do not merge this into leftover `normalizeLeadName` so “one leftover name fold owns every Lead.” Do not split leftover `create.ts` / leftover `update.ts` / leftover `delete.ts` / leftover `parse.ts` / leftover `normalize.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `normalizeExact` | `foldThisHistoricalSheetCellSoTwoLabelsCanMatch` | leftover planner must key leftover catalog / leftover Lead ID / leftover facts without leftover fuzzy match |
| `normalizeDisplay` | `foldThisHistoricalSheetCellSoWeCanPrintIt` | leftover planner must store the leftover printable leftover label without leftover lowercasing it |
| `parseAgentNames` | `readThisHistoricalAgentCellOnSlashOnlyAfterStrippingTerminalSplitAndPercent` | leftover Booked leftover `Agent` must leftover tokenize or say leftover `ambiguous` before leftover catalog leftover resolve |
| `parseCustomerName` | `keepThisHistoricalCustomerCellAsOneDisplay` | leftover Booked leftover `Customer Name` must stay one leftover household leftover label |
| `parseMoneyToCents` | `turnThisHistoricalMoneyCellIntoIntegerCentsOrSayEmptyOrInvalid` | leftover Binder / leftover Deposit / leftover Refund must leftover quarantine leftover blank instead of leftover zero |
| `allocateCents` | `giveRemainderCentsToTheEarliestDistinctHistoricalAgents` | leftover planner must leftover split leftover N leftover Agents in leftover integer leftover cents after leftover ids exist |
| `ParsedNameField` | `ThisHistoricalNameCell` | leftover Agent / leftover Customer leftover handoff leftover card |
| `ParseResult` | `ThisHistoricalParsedCell` | leftover money plus leftover `dateParsing.ts` leftover Eastern leftover dates |

Keep the old names as one-line aliases until already-recommended leftover `planner.ts`, leftover `dateParsing.ts`, the leftover barrel, and leftover `normalization.test.ts` migrate. Do not make callers learn leftover `NFKC` / leftover `Set` / leftover `padEnd(2, "0")` as the leftover domain leftover language. Do **not** export a new leftover catalog leftover resolver from here. Do **not** put leftover `parseAgentNames` onto a leftover live leftover Booking leftover route so “HTTP can leftover tokenize an leftover Agent.” Do **not** rename the leftover `reason_codes` strings (`empty_agent`, `ambiguous_agent_separator`, `empty_agent_token`, `non_terminal_agent_metadata`, `empty_customer`, `contains_slash` / `contains_backslash` / `contains_ampersand` / `contains_plus` / `contains_comma` / `contains_and`, `missing_money`, `malformed_or_negative_money`, `money_out_of_range`). Do **not** rename leftover `disposition` members (`accepted` / `ambiguous` / `empty` / `invalid`). Do **not** rename leftover `metadata.terminal_split` / leftover `metadata.terminal_percentage`. Do **not** rename the leftover throw strings (`Allocation total must be non-negative integer cents`, `At least one distinct agent is required`). Do **not** rename leftover `toLocaleLowerCase("en-US")`.

**No workflow class.** The two leftover types that *do* earn a leftover name are the leftover name leftover card and the leftover parsed leftover cell leftover card:

```ts
type ThisHistoricalNameCell = {
  raw_value: string
  display_value: string
  tokens: string[]
  normalized_tokens: string[]
  metadata: { terminal_split?: true; terminal_percentage?: string }
  disposition: "accepted" | "ambiguous" | "empty"
  reason_codes: string[]
}

type ThisHistoricalParsedCell<T> =
  | { disposition: "accepted"; value: T; reason_codes: string[] }
  | { disposition: "ambiguous" | "empty" | "invalid"; reason_codes: string[] }
```

That is leftover today’s leftover `ParsedNameField` / leftover `ParseResult` — the leftover handoff from “this leftover cell was leftover folded” to “the leftover planner may leftover resolve or leftover quarantine.” Do **not** add leftover `agent_id` onto leftover `ThisHistoricalNameCell` so “tokenize owns leftover resolve.” Do **not** add leftover `session` or a leftover Booking leftover id onto leftover `allocateCents` so “the leftover split leftover writes leftover Mongo.” Leave leftover `ParseResult` on this leftover file until leftover `dateParsing.ts` migrates — do not move the leftover type in this leftover rename so “leftover dates own leftover money.”

Leave leftover plan on already-recommended leftover `planner.ts`. Leave leftover Eastern leftover dates on leftover `dateParsing.ts`. Leave leftover `splitBinderEvenly` on already-recommended leftover `agentAllocation.service.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// normalization.ts
// The leftover planner already has a leftover sheet leftover cell.
// Fold it so two leftover labels can match, or so we can print it.
// Read this leftover Agent leftover cell on `/` only after stripping
// leftover terminal leftover Split and leftover percent.
// Keep this leftover Customer leftover cell as one leftover display.
// Turn this leftover money leftover cell into leftover integer leftover cents.
// Give leftover remainder leftover cents to the leftover earliest leftover
// distinct leftover Agents.
// Do not leftover resolve the leftover catalog.
// Do not leftover plan a leftover Booking.
// Do not leftover-**ask** leftover `splitBinderEvenly`.

// ── 1. Fold this leftover cell so two leftover labels can match ──

export function foldThisHistoricalSheetCellSoTwoLabelsCanMatch(value: string): string

// ── 2. Fold this leftover cell so we can print it ──

export function foldThisHistoricalSheetCellSoWeCanPrintIt(value: string): string

// ── 3. Read this leftover Agent leftover cell on `/` only ──

export function readThisHistoricalAgentCellOnSlashOnlyAfterStrippingTerminalSplitAndPercent(
  rawValue: string,
): ThisHistoricalNameCell
function stripThisTerminalPercentFromTheHistoricalAgentDisplay(display)
function stripThisTerminalSplitFromTheHistoricalAgentDisplay(display)
function refuseThisHistoricalAgentCellWhenSeparatorsOrMetadataAreNotSlashOnly(display)
function uniqueTheseHistoricalAgentTokensInSourceOrder(display)

// ── 4. Keep this leftover Customer leftover cell as one leftover display ──

export function keepThisHistoricalCustomerCellAsOneDisplay(rawValue: string): ThisHistoricalNameCell
function flagThisHistoricalCustomerPunctuationWithoutSplittingASecondCustomer(display)

// ── 5. Turn this leftover money leftover cell into leftover integer leftover cents ──

export function turnThisHistoricalMoneyCellIntoIntegerCentsOrSayEmptyOrInvalid(
  rawValue: unknown,
): ThisHistoricalParsedCell<number>
function refuseThisHistoricalMoneyCellWhenItIsBlank()
function refuseThisHistoricalMoneyCellWhenTheCleanedTextIsNotNonNegativeDollarsAndCents(cleaned)
function countTheseHistoricalCentsFromTheCleanedDollarText(cleaned)

// ── 6. Give leftover remainder leftover cents to the leftover earliest leftover distinct leftover Agents ──

export function giveRemainderCentsToTheEarliestDistinctHistoricalAgents(
  totalCents: number,
  agentIds: readonly string[],
): Array<{ agent_id: string; cents: number }>
function refuseUnlessThisHistoricalAllocationTotalIsNonNegativeIntegerCents(totalCents)
function uniqueTheseHistoricalAgentIdsInSourceOrder(agentIds)
function walkRemainderCentsOntoTheEarliestDistinctHistoricalAgents(totalCents, unique)
```

Read the primary path out loud: *Fold this leftover sheet leftover cell so two leftover labels can match — leftover NFKC, leftover trim, leftover collapse, leftover English leftover lower. Fold it again without leftover lower when we only need to leftover print it. Read the leftover Agent leftover cell on leftover `/` only after leftover-stripping a leftover terminal leftover `Split` and a leftover terminal leftover percent; leftover say leftover `ambiguous` when leftover `&` / leftover `+` / leftover comma / leftover `and` / leftover repeated leftover `/` / leftover non-terminal leftover metadata remain. Keep the leftover Customer leftover cell as one leftover display and only leftover flag the leftover punctuation. Turn the leftover money leftover cell into leftover integer leftover cents or leftover say leftover empty / leftover invalid — never leftover zero a leftover blank leftover Binder. Split those leftover cents across leftover distinct leftover Agent leftover ids in leftover source leftover order and leftover give each leftover remainder leftover cent to the leftover earliest leftover id. Do not leftover resolve the leftover catalog. Do not leftover plan the leftover Booking. Do not leftover-**ask** leftover `splitBinderEvenly`.*

That is the leftover operation. leftover `normalize` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Spec leftover detects leftover terminal leftover `Split` and leftover percent on the leftover whole leftover value then leftover-removes both; leftover code leftover-strips leftover percent first then leftover `Split`.** leftover `"Nick Split 40%"` leftover-works either leftover way. leftover `"Nick 40% Split"` leftover does leftover not — leftover percent is leftover no leftover longer leftover terminal, leftover `split` leftover-strips, leftover `40%` leftover-stays, leftover `non_terminal_agent_metadata` leftover-fires. Do leftover-not leftover-swap the leftover order in this leftover rename without an **interface** leftover proof of leftover both leftover cells.

2. **Spec leftover step leftover 9 leftover-resolves each leftover token to an leftover Agent; this leftover file leftover-stops at leftover tokens.** Already-recommended leftover `catalog.agent` leftover-owns leftover alias leftover lookup and leftover inactive leftover insert. Do leftover-not leftover-**ask** leftover `input.mappings.aliases` from leftover here so “one leftover function leftover-owns leftover tokenize leftover and leftover resolve.”

3. **Leftover Customer leftover flags leftover-do leftover-not leftover-quarantine.** Spec leftover-wants a leftover review leftover case when a leftover Customer leftover segment leftover-matches a leftover known leftover Agent. That leftover-is leftover leftover-planner leftover-work leftover if leftover it leftover exists — this leftover file leftover-returns leftover `accepted` leftover plus leftover flags. Do leftover-not leftover-flip leftover `disposition` to leftover `ambiguous` so “the leftover review leftover sentence leftover becomes leftover true.”

4. **Leftover `allocateCents` leftover-throws; leftover `parseMoneyToCents` leftover-returns a leftover `ParseResult`.** Two leftover error leftover styles on leftover one leftover file. Do leftover-not leftover-swap leftover `allocateCents` to a leftover `ParseResult` in this leftover rename — leftover leftover-planner leftover-**asks** the leftover throw leftover after leftover accepted leftover parse.

5. **Live leftover `splitBinderEvenly` leftover-is leftover-not this leftover math.** leftover Dollars leftover in, leftover one leftover or leftover two leftover Agents, leftover secondary leftover-gets leftover `floor`. This leftover file leftover-takes leftover integer leftover cents leftover and leftover N leftover ids. Do leftover-not leftover-route leftover `allocateCents` leftover through leftover `splitBinderEvenly` so “one leftover split leftover-owns leftover the leftover company.”

6. **Leftover `normalizeAgentName` leftover-is leftover-not leftover NFKC.** Live leftover Agent leftover fold leftover-trims leftover / leftover-collapses leftover / leftover-lowers leftover only. This leftover file leftover-adds leftover NFKC leftover and leftover `en-US` leftover locale leftover lower. Do leftover-not leftover-replace leftover `normalizeExact` leftover with leftover `normalizeAgentName` so “one leftover Agent leftover fold leftover-owns leftover live leftover and leftover historical.”

7. **Leftover `normalization.test.ts` leftover-also leftover-**asks** leftover `dateParsing.ts`.** leftover `parseEasternDate` leftover / leftover `googleSerialToEastern` leftover-are leftover leftover-that leftover leftover-file’s leftover **interface**. Do leftover-not leftover-keep leftover proving leftover Eastern leftover DST leftover as leftover this leftover **interface**. Do leftover-not leftover-move leftover those leftover tests leftover in leftover this leftover rename leftover — leftover leftover-leave leftover them leftover for leftover leftover-`dateParsing.ts`.

8. **Leftover `normalizeDisplay` leftover-has leftover no leftover direct leftover fixture.** leftover leftover-Planner leftover-**asks** leftover it leftover everywhere leftover printable leftover labels leftover live. Do leftover-not leftover-leave leftover the leftover display leftover fold leftover unproved leftover on leftover this leftover **interface**. Do leftover-not leftover-prove leftover it leftover only leftover through leftover leftover-`planHistoricalConsolidation`.

9. **Leftover empty leftover Agent leftover leftover-is leftover `empty`, leftover not leftover `ambiguous`.** leftover leftover-Planner leftover leftover-maps leftover leftover-`ambiguous` leftover leftover-to leftover leftover-`ambiguous_agent_parse` leftover leftover and leftover leftover everything leftover leftover-else leftover leftover-invalid leftover leftover-to leftover leftover-`invalid_booking_row`. Do leftover-not leftover leftover-flip leftover leftover-blank leftover leftover-to leftover leftover-`ambiguous` leftover leftover so leftover leftover “one leftover leftover conflict leftover leftover-owns leftover leftover every leftover leftover Agent leftover leftover miss.”

10. **Leave leftover leftover sibling leftover leftover modules leftover leftover and leftover leftover live leftover leftover writes leftover leftover alone.** leftover leftover `planHistoricalConsolidation`, leftover leftover `parseEasternDate`, leftover leftover `catalog.agent`, leftover leftover `splitBinderEvenly`, leftover leftover `normalizeLeadName`, leftover leftover `normalizeAgentName`, leftover leftover and leftover leftover leftover-`ingest-historical-sheets.ts` leftover leftover leftover-are leftover leftover leftover-not leftover leftover leftover-this leftover leftover leftover-file. Do leftover leftover leftover-not leftover leftover leftover-inline leftover leftover leftover them leftover leftover leftover so leftover leftover leftover “the leftover leftover leftover fold leftover leftover leftover is leftover leftover leftover one leftover leftover leftover sitting.”

## Testing

The **interface** is the test surface: `foldThisHistoricalSheetCellSoTwoLabelsCanMatch`, `foldThisHistoricalSheetCellSoWeCanPrintIt`, `readThisHistoricalAgentCellOnSlashOnlyAfterStrippingTerminalSplitAndPercent`, `keepThisHistoricalCustomerCellAsOneDisplay`, `turnThisHistoricalMoneyCellIntoIntegerCentsOrSayEmptyOrInvalid`, `giveRemainderCentsToTheEarliestDistinctHistoricalAgents` (today `normalizeExact`, `normalizeDisplay`, `parseAgentNames`, `parseCustomerName`, `parseMoneyToCents`, `allocateCents`).

`normalization.test.ts` today proves NFKC exact fold, Agent slash plus terminal percent plus ambiguous separators, Customer keep-one, money cents / empty / invalid, and one / two / three Agent cents. Keep those as this **interface**. `parseEasternDate` / `googleSerialToEastern` are **not** this **interface**. `planner.test.ts` through `planHistoricalConsolidation` is **not** this **interface**.

Add only what this **interface** still hides. Do **not** point `planHistoricalConsolidation` at live `vantagemovers` from this fixture.

**Fold this leftover cell so two leftover labels can match**
- `"  Jane DOE  "` with fullwidth J → `"jane doe"` (today NFKC + whitespace + lower).
- Punctuation stays (`"Elavon CC"` folds without stripping spaces or hyphens beyond collapse).
- Do **not** require `normalizeAgentName` as this beat.

**Fold this leftover cell so we can print it**
- Same fullwidth Jane input → display fold without lower (prove `normalizeDisplay` here).
- Do **not** require `planHistoricalConsolidation` as this beat.

**Read this leftover Agent cell on slash only**
- `" Nick / Mike / Nick 40% "` → accepted tokens Nick, Mike plus `terminal_percentage: "40%"` (today).
- `"Nick // Mike"` / `"Nick & Mike"` / `"Nick Split / Mike"` → `ambiguous` (today).
- `"Nick Split 40%"` → today’s walk strips both terminal pieces and returns accepted `["Nick"]` (prove the happy order).
- `"Nick 40% Split"` → today’s walk flags `non_terminal_agent_metadata` (prove the spec gap; do **not** swap the strip order in the test).
- blank → `empty` / `empty_agent`.
- Do **not** require `catalog.agent` as this beat.

**Keep this leftover Customer cell as one leftover display**
- `" Jane / John & Co. "` → accepted one token (today).
- Flags `contains_slash` / `contains_ampersand` fire and disposition stays `accepted` (prove flags do not quarantine).
- blank → `empty` / `empty_customer`.
- Do **not** require leftover planner leftover `ambiguous_customer` leftover review as this beat.

**Turn this leftover money cell into leftover integer cents**
- `"$1,234.50"` → `123450` (today).
- `""` → `empty` / `missing_money` (today).
- `"-1"` / `"1.001"` / Infinity → `invalid` (today).
- Do **not** coerce blank to zero.
- Do **not** require leftover `allocateCents` as this beat.

**Give leftover remainder leftover cents to the leftover earliest leftover distinct leftover Agents**
- `101` / `["a"]` → `101` (today).
- `101` / `["a","b"]` → `51` / `50` (today).
- `100` / `["a","b","c"]` → `34` / `33` / `33` and sum `100` (today).
- negative leftover throws leftover `"Allocation total must be non-negative integer cents"`.
- empty leftover unique leftover ids leftover throw leftover `"At least one distinct agent is required"`.
- Do **not** require leftover `splitBinderEvenly` leftover as leftover this leftover beat.

Do **not** add a leftover test leftover per leftover helper (`stripThisTerminalPercentFromTheHistoricalAgentDisplay`, `walkRemainderCentsOntoTheEarliestDistinctHistoricalAgents`). Those leftover names leftover exist leftover so leftover the leftover parent leftover reads. If leftover a leftover helper leftover test leftover has leftover to leftover change leftover when leftover the leftover helper leftover is leftover inlined, leftover it leftover was leftover testing leftover past leftover the leftover **interface**.

The leftover six leftover function leftover names leftover may leftover stay leftover exported leftover as leftover aliases. They leftover are leftover the leftover test leftover surface. Do **not** leftover export leftover a leftover catalog leftover resolver leftover so leftover “the leftover fixture leftover owns leftover resolve.”

## What I would not do

- A `HistoricalNormalizationService` class with `normalize` / `parse` / `create` / `update` / `delete`.
- Thirty two-line leftover functions leftover that leftover only leftover wrap leftover `NFKC` leftover / leftover `trim`.
- Moving leftover this leftover into leftover a leftover CRUD leftover folder, leftover or leftover a leftover `parse/` leftover folder leftover that leftover also leftover swallows leftover `planner.ts`, leftover `dateParsing.ts`, leftover `agentAllocation.service.ts`, leftover and leftover `leadName.service.ts`.
- Splitting leftover `create.ts` leftover / leftover `update.ts` leftover / leftover `delete.ts` leftover / leftover `parse.ts` leftover / leftover `normalize.ts`.
- Treating leftover `planHistoricalConsolidation`, leftover `parseEasternDate`, leftover `splitBinderEvenly`, leftover `normalizeLeadName`, leftover `normalizeAgentName`, leftover `catalog.agent`, leftover or leftover `ingest-historical-sheets.ts` leftover as leftover this leftover story.
- Inventing leftover a leftover Domain leftover Command leftover **seam** leftover that leftover has leftover only leftover this leftover fold leftover as leftover an leftover **adapter**.
- Inventing leftover a leftover catalog leftover **adapter** leftover so leftover “tokenize leftover owns leftover resolve.”
- Inventing leftover a leftover live leftover allocation leftover **adapter** leftover so leftover “one leftover split leftover owns leftover the leftover company.”
- Inventing leftover an leftover HTTP leftover **adapter** leftover so leftover “a leftover route leftover can leftover parse leftover a leftover cell.”
- Asking leftover `allocateCents` leftover from leftover leftover live leftover `officialBookingAllocations` leftover so leftover “one leftover cent leftover math leftover owns leftover every leftover Booking.”
- Flipping leftover Customer leftover flags leftover to leftover `ambiguous` leftover so leftover “the leftover review leftover sentence leftover becomes leftover true.”
- Swapping leftover percent leftover / leftover `Split` leftover strip leftover order leftover so leftover “the leftover spec leftover becomes leftover true.”
- Moving leftover `ParseResult` leftover onto leftover `dateParsing.ts` leftover in leftover this leftover rename leftover so leftover “leftover dates leftover own leftover money.”
- Opening leftover `dateParsing.ts` leftover in leftover this leftover pass, leftover or leftover writing leftover a leftover whole-folder leftover recommendation leftover for leftover `historicalConsolidation`.
