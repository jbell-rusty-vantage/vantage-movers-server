# Show Every Lead Source With Its Feeds And Counted Connections — Open This Lead Source And List Every Accepted Label, Granot Landing, Inbound Number, Leftover Finding, And Leftover Gate — Never Write — Never Activate — Never Price The Lead — Never Hang A Name — Never Walk The Whole Catalog — Never Translate A Finding In This File — operational story

- Status: recommended
- Service: `operationsRegistry` (Wave A, visited after this pass)
- Pass: 22 of this service — `queries/leadSourceProjection.ts`
- Remaining in this service: none — this was the last unchecked [REDACTED] module
- Target: `src/services/operationsRegistry/queries/leadSourceProjection.ts`
- Knowledge: [`docs/knowledge/services/operations-registry.md`](../../../docs/knowledge/services/operations-registry.md) (aggregate Owner reads `GET /api/v1/admin/operations-registry/lead-sources` and `/:id`; Feeds, accepted labels, Granot landings, inbound numbers, CPL readiness, and translated findings; does not invent stored identifiers. Authorization and audit: approved signed dashboard roles may read). Software rule: [`.cursor/rules/operations-registry.mdc`](../../../.cursor/rules/operations-registry.mdc) (aggregate Owner reads live here + leftover skip `findingTranslation.ts`; leftover `ownerLanguageDeck.ts` must match the Admin copy; runtime policy reads stay in `granotLifecycle/sourcePolicy.ts`). Already-recommended leftover setup: [recommendations/operations-registry-lead-source-setup.md](operations-registry-lead-source-setup.md) (`buildReadinessPlan` — this file **asks** that leftover gate list, then maps English `gate` onto leftover Owner `action` / leftover `done` / `blocked` / `suggested` / `ready`; leftover setup **writes** the draft this page **reads**). Already-recommended leftover health: [recommendations/operations-registry-queries-health.md](operations-registry-queries-health.md) (`connectionFindings` **asks** leftover `buildSourceRegistryHealthFindings` / leftover `buildLabelMappingHealthFindings` / leftover `buildGranotSourceHealthFindings` / leftover `buildRingCentralHealthFindings` / leftover `buildCplRegistryHealthFindings` with unpaid Lead count `0` and no correction-job counts; this file **does not** ask leftover `getRegistryHealth`, leftover `buildRuntimeRegistryHealthFindings`, or leftover `buildSourceResolutionEventFindings`). Already-recommended leftover CPL validate this file **asks** for per-Feed `lead_cost`: [recommendations/operations-registry-cpl-schedule.md](operations-registry-cpl-schedule.md) (`validateCplSchedule`). Already-recommended leftover overview: [recommendations/operations-registry-queries-overview.md](operations-registry-queries-overview.md) (**counts** Source Company / Source Granularity totals; it does **not** load this card). Already-recommended leftover Change list: [recommendations/operations-registry-queries-changes.md](operations-registry-queries-changes.md) (**does not** import this file). Already-recommended leftover hang / leftover Granot write / leftover SMS / leftover label mappings / leftover inbound: [recommendations/operations-registry-owner-granot-names.md](operations-registry-owner-granot-names.md), [recommendations/operations-registry-granot-crm-sources.md](operations-registry-granot-crm-sources.md), [recommendations/operations-registry-crm-source-outbound-sms.md](operations-registry-crm-source-outbound-sms.md), [recommendations/operations-registry-label-mappings.md](operations-registry-label-mappings.md), [recommendations/operations-registry-ring-central-registry.md](operations-registry-ring-central-registry.md) (those **write**; this page **reads**). Already-recommended who-may-speak: [recommendations/operations-registry-trusted-actor.md](operations-registry-trusted-actor.md) (Wave B `requireRegistryReadActor` **asks** that file **before** this one). Already-recommended leftover stamp: [recommendations/operations-registry-registry-audit.md](operations-registry-registry-audit.md) (**does not** import this file). Skipped leftover Owner-language leak check: `ownerLanguageDeck.ts` (Owner-facing strings say Lead source and Feed; this DTO is the deck’s fixture). Skipped leftover finding fold: `queries/findingTranslation.ts` (this file **asks** leftover `translateFindings` one leftover draft at a time; unknown codes surface as themselves). Wave B Zod: `src/validation/v1/leadSourceSetup.validation.ts` (`leadSourceListQuerySchema` / `leadSourceDetailQuerySchema` — empty-strict query; unknown keys refused). This checkout’s `CONTEXT.md` does not define Lead Source / Feed / leftover projection — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: Wave B `src/routes/v1.routes.ts` (`handleLeadSourceProjectionList` — `GET /api/v1/admin/operations-registry/lead-sources`, leftover empty-strict query, leftover `requireRegistryReadActor`, then leftover `listLeadSourceProjections`; `handleLeadSourceProjectionDetail` — `GET /api/v1/admin/operations-registry/lead-sources/:id`, leftover empty-strict query, leftover `getValidObjectId`, leftover `requireRegistryReadActor`, then leftover `getLeadSourceProjection`). Barrel: `operationsRegistry/index.ts` (list / detail / leftover round-trip count / leftover reset / leftover `PROJECTION_ROUND_TRIP_BOUNDS` plus leftover list / detail / leftover gate-row types). Tests: `queries/leadSourceProjection.test.ts` (one-request Best Relocation connections, two move-type Feeds keep separate label sets, empty sections never absent, list/detail stay under leftover bounds and write nothing, Owner finding copy keeps leftover banned words out). Skipped leftover `ownerLanguageDeck.test.ts` **asks** leftover `getLeadSourceProjection` as the leak-check fixture — that is leftover deck’s **interface**, not a second projection story. Wave B `v1.routes.test.ts` asserts the two leftover route strings. Wave B `lead-source-setups.routes.test.ts` refuses leftover `include_inactive` / leftover extra query keys. Leftover `trustedActor.test.ts` does **not** sign these leftover paths. Already-recommended leftover setup / leftover health / leftover hang / leftover SMS / leftover stamp **do not import this file**.
- Seams callers need: show-every-Lead-Source (`listLeadSourceProjections`: Wave B list; counted connections + per-Feed leftover readiness; leftover `blocking_finding_count` is the constant `0`) vs open-this-Lead-Source (`getLeadSourceProjection`: Wave B detail; every accepted label / Granot landing / inbound number + leftover translated findings + leftover Owner gate plan). Leftover `connect` on leftover `LeadSourceProjectionDeps` is the TEST_MODE skip, not a second public **seam**. Leftover `getProjectionRoundTripCount` / leftover `resetProjectionRoundTripCount` / leftover `PROJECTION_ROUND_TRIP_BOUNDS` are the test bound, not Owner operations. There is no write **seam**. There is no activate **seam**. There is no price-the-lead **seam**. There is no hang-a-name **seam**. There is no walk-the-whole-catalog **seam**. There is no Owner-language **seam** as a public export. There is no who-may-speak **seam**.
- Split later (only if the file outgrows one sitting): this ~907-line file is one sitting if you read it as show every Lead Source with its Feeds and counted connections — open this Lead Source and list every accepted label, Granot landing, inbound number, leftover finding, and leftover gate — never write — never activate — never price the lead — never hang a name — never walk the whole catalog — never translate a finding in this file. Do **not** split list vs detail into two public modules Wave B could import independently so “the shelf owns counts and the card owns findings.” Do **not** split leftover `connectionFindings` into a second sitting so “projection never judges.” If it later splits: `showEveryLeadSourceWithItsFeedsAndCountedConnections.ts` / `openThisLeadSourceAndListEveryConnectionAndLeftoverGate.ts` only as later story files, never `create.ts` / `update.ts` / `delete.ts` / `get.ts` / `list.ts` / `projection.ts`, and never merge leftover setup, leftover health walk, leftover skip finding translation, leftover hang, leftover SMS, leftover stamp, leftover who-may-speak, leftover CPL `set_range`, leftover skip Owner-language deck, Wave B Zod, or Wave B HTTP into this file

`listLeadSourceProjections` / `getLeadSourceProjection` are executor mechanics. The owner question is: *Show every Lead Source with its Feeds. On the shelf I only need counted accepted labels, counted Granot names, counted inbound numbers on a call Feed, and whether this Feed can go live (Lead Source on, Feed on, lead cost ready). When I open one Lead Source, list every accepted label, every Granot landing (one Feed or local / long-distance by move type), every inbound number on a call Feed, the leftover findings in Owner English, and the leftover gates that still keep this draft off. Empty shelves stay visible empty boxes, never missing keys. This page does not write. This page does not activate. This page does not price the lead. This page does not hang a Granot name. This page does not walk every catalog book. This page does not invent a stored identifier.*

Already-recommended leftover setup, leftover health walk, leftover skip finding translation, leftover hang, leftover Granot write, leftover SMS, leftover label mappings, leftover inbound, leftover CPL, leftover overview, leftover Change list, leftover who-may-speak, leftover stamp, leftover skip Owner-language deck, Wave B Zod, and Wave B HTTP already live in other **modules**. Do not pull those in.

## What this file actually does

Two operations of one “show every Lead Source with its Feeds and counted connections — open this Lead Source and list every accepted label, Granot landing, inbound number, leftover finding, and leftover gate — never write — never activate — never price the lead — never hang a name — never walk the whole catalog — never translate a finding in this file” story, not “a Lead Source CRUD helper,” and not leftover setup / leftover health walk:

1. **Show every Lead Source with its Feeds and counted connections** — `listLeadSourceProjections`. Wave B list. After leftover `connectMongo` (or leftover `deps.connect`), leftover `resetProjectionRoundTripCount`. Load every leftover Source Company sorted by leftover `owner_label`. Load every leftover Feed for those companies. One `Promise.all` then counts, per leftover Feed id: leftover accepted-label rows (select leftover `source_granularity` only), leftover Granot names whose leftover `lifecycle_routes.source_granularity_id` lands in those Feeds (select leftover `lifecycle_routes` only), leftover **active** inbound assignments with no leftover `effective_until` (select leftover `source_granularity` only), leftover unarchived CPL periods sorted by leftover `effective_from`. Per Feed: leftover `feedReadiness` (Lead Source on, Feed on, leftover `validateCplSchedule` → leftover `lead_cost` `ready` / `missing` / `invalid`, leftover `live` only when all three). Call Feeds also get leftover `inbound_number_count`; form Feeds omit that key. Leftover `blocking_finding_count` is the constant `0`. Leftover `feeds` is leftover `section` (`empty` + `items`, never absent). `generated_at` is `new Date().toISOString()` **after** the queries return. Leftover `_round_trips` is the process counter (bound 6). This beat does **not** load leftover finding drafts. This beat does **not** ask leftover `buildReadinessPlan`. This beat does **not** load leftover RingCentral route cards. This beat does **not** write.

2. **Open this Lead Source and list every accepted label, Granot landing, inbound number, leftover finding, and leftover gate** — `getLeadSourceProjection`. Wave B detail. Missing company → leftover `RegistryError` / leftover `NOT_FOUND` (`Lead source not found.`). Load this company’s leftover Feeds. One `Promise.all`: leftover accepted labels sorted by leftover `namespace` + leftover `normalized_label`; leftover Granot names whose leftover route lands in those Feeds **or** leftover `lead_source_company` is this company (when there are no Feeds, still load company-level names); leftover inbound assignments with no leftover `effective_until` (**no** leftover `active: true` filter); leftover unarchived CPL periods. Then load leftover RingCentral route cards for the assignment leftover `route` ids. Per Feed: leftover readiness again; leftover accepted-label items; leftover `granotLandingsForFeed` (leftover `one_feed` vs leftover `form_by_move_type` with leftover `MOVE_TYPE_SELECTION_RULE`; leftover `when_lead_arrives` from leftover `lead_created_policy`; leftover `text_state` only when leftover `create_if_missing`); leftover inbound numbers on call Feeds only (phone + leftover nickname + leftover `effective_from`). Then leftover `connectionFindings` **asks** the five leftover book-family judges (CPL unpaid Lead count `0`, no correction-job counts). Leftover `translateFindings` runs **one leftover draft at a time** so leftover `source_granularity` / leftover inbound phone can specialize leftover `deep_link`. Leftover `ownerReadinessPlan` **asks** leftover `buildReadinessPlan` (`granotOmitted` = no leftover names loaded; leftover `createIfMissing` = any leftover `lead_created_policy === "create_if_missing"`), then leftover `GATE_ACTION` maps English leftover `gate` onto leftover Owner `action`. Leftover `done` / leftover `blocked` use leftover **all-Feeds** / leftover **all-names** predicates (every Feed’s leftover lead cost ready; every Feed active; every leftover name leftover `lifecycle_enabled`). Leftover `blocking_finding_count` is how many leftover translated rows have leftover `severity === "blocking"`. Leftover `advanced.raw_findings` keeps leftover `code` / leftover `summary` / leftover `entity_type` / leftover `entity_id`. Leftover `_round_trips` bound 10. This beat does **not** take a session. This beat does **not** stamp. This beat does **not** call leftover `setSourceCompanyActivation` / leftover `setGranotCrmSourceOutboundSms` / leftover `createGranotNameFromOwnerIntent`. This beat does **not** ask leftover `getRegistryHealth`.

There is no third write operation. There is no activate operation. There is no price-the-lead operation. There is no hang-a-name operation. There is no walk-the-whole-catalog operation. Leftover `counted` / leftover `section` / leftover `sheetConfig` / leftover `arrivalFromPolicy` / leftover `textState` / leftover `routeShape` sit on the list and detail paths. They are not extra owner operations. Do not export leftover `connectionFindings` / leftover `ownerReadinessPlan` / leftover `feedReadiness` / leftover `GATE_ACTION` as a public **seam**.

Do not export leftover `listLeadSourceProjections` as domain language for “the shelf already judged.” Do not export leftover `getLeadSourceProjection` as domain language for “the draft is live.” Do not export leftover `buildReadinessPlan` from this file so “projection owns leftover setup.”

## Organization

Keep one file as the screenplay for “show every Lead Source with its Feeds and counted connections, open this Lead Source and list every accepted label, Granot landing, inbound number, leftover finding, and leftover gate, never write, never activate, never price the lead, never hang a name, never walk the whole catalog, never translate a finding in this file.” Already-recommended leftover setup, leftover health walk, leftover skip finding translation, leftover hang, leftover Granot write, leftover SMS, leftover label mappings, leftover inbound, leftover CPL, leftover overview, leftover Change list, leftover who-may-speak, leftover stamp, leftover skip Owner-language deck, Wave B Zod, `connectMongo`, and Wave B HTTP already live in deeper **modules**. Do not pull those in. Do not invent a `LeadSourceProjectionService` class. Do not invent a persist / finalize **seam** — this file is a read. Do not invent a second leftover gate list beside leftover `buildReadinessPlan`. Do not invent a second leftover finding book beside leftover `translateFindings`. Do not invent a second leftover CPL validate beside leftover `validateCplSchedule`. Do not invent a second leftover who-may-speak **adapter** beside leftover `requireRegistryReadActor`.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `get.ts` / `list.ts`. Those are persistence nouns, not the owner story. Do not move leftover `getRegistryHealth` into this file so “one page owns the walk.” Do not move leftover `previewLeadSourceSetup` into this file so “the shelf opens drafts.” Do not silently start writing leftover `blocking_finding_count` on the list so “the shelf already judged.”

**External interface** stays small (this is the test surface). List and detail are one story’s book, not two CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `listLeadSourceProjections` | `showEveryLeadSourceWithItsFeedsAndCountedConnections` | Wave B list |
| `getLeadSourceProjection` | `openThisLeadSourceAndListEveryConnectionAndLeftoverGate` | Wave B detail |
| `LeadSourceListResult` / `LeadSourceDetailResult` | `EveryLeadSourceWithCountedConnections` / `ThisLeadSourceWithConnectionsAndLeftoverGates` | Wave B `{ ok, data }` bags |
| `OwnerReadinessPlanRow` / `OwnerReadinessAction` | `ThisLeftoverGateOnThisLeadSource` / leftover Owner action enum | leftover setup **asks** English leftover `gate`; this file maps leftover `action` |
| `PROJECTION_ROUND_TRIP_BOUNDS` / `getProjectionRoundTripCount` / `resetProjectionRoundTripCount` | leftover list/detail bound (6 / 10) | tests lock the Mongo walks; not Owner language |
| `LeadSourceProjectionDeps` | leftover `connect` skip | TEST_MODE / fixture skip; Wave B does not send this |

Keep the old names as one-line aliases until Wave B `v1.routes.ts`, the barrel, `queries/leadSourceProjection.test.ts`, leftover `ownerLanguageDeck.test.ts`, and Wave B Zod tests migrate. Do not make callers learn leftover `connectionFindings` / leftover `GATE_ACTION` / leftover `open_cpl` as the domain language.

**Principle: old exports stay as aliases.** `listLeadSourceProjections` remains the imported name until Wave B list migrates. `getLeadSourceProjection` remains the imported name until Wave B detail migrates. HTTP field names `generated_at` / `feeds.empty` / `readiness.lead_cost` / `readiness_plan[].action` / leftover `when_lead_arrives` / leftover `text_state` / leftover `advanced.raw_findings` stay those names. Leftover `GATE_ACTION` English leftover `gate` strings (`Set the lead cost`, `Activate the lead source`, `Activate the feed`, `Switch the Granot name live`, `Turn on the customer text`, `Connect a Granot name`) stay those strings — they are leftover setup’s leftover `buildReadinessPlan` contract, not story names. Leftover Owner `action` strings (`open_lead_costs`, `activate_lead_source`, `activate_feed`, `switch_granot_name_live`, `turn_on_customer_text`, `connect_granot_name`) stay those strings — they are the Admin leftover button ids. Leftover stored leftover `company_slug` / leftover `granularity_key` / leftover `lead_created_policy` stay those fields — this file does not invent stored identifiers.

**No class for the workflow.** The types that *do* earn names are the leftover list card, the leftover detail card, and the leftover gate row leftover setup already shares:

```ts
type EveryLeadSourceWithCountedConnections = {
  generated_at: string
  items: Array<{
    id: string
    company_slug: string
    name: string
    owner_label: string
    active: boolean
    aliases: string[]
    sheet_config: { spreadsheet_id?: string; has_bad_tabs: boolean; projection_mode: "derived_import" | "direct_write" }
    feeds: { empty: boolean; items: ThisFeedWithCountedConnections[] }
    blocking_finding_count: 0 // today's list always writes 0
  }>
}

type ThisLeadSourceWithConnectionsAndLeftoverGates = EveryLeadSourceWithCountedConnections["items"][number] & {
  findings: OwnerFinding[]
  readiness_plan: ThisLeftoverGateOnThisLeadSource[]
  advanced: { raw_findings: Array<{ code: string; summary: string; entity_type?: string; entity_id?: string }> }
}

type ThisLeftoverGateOnThisLeadSource = {
  gate: string // leftover setup English — do not rename
  action: OwnerReadinessAction
  status: "done" | "ready" | "blocked" | "suggested"
  blocked_until?: string
}
```

That is the handoff from “the leftover cards were read” to “Wave B returns `{ ok, data }`.” Do **not** add leftover overview `counts` / leftover health walk-only findings onto this bag so “one page owns the shelf.” Do **not** add leftover Change `items` onto this bag so “the Lead Source owns history.” Do **not** store a leftover session on the bag.

Do not add leftover `requireRegistryReadActor` as a public **seam** on this file — Wave B already owns who may speak. Do not add leftover `translateFindings` as a public **seam** — leftover skip `findingTranslation.ts` already owns Owner rows. Do not add leftover `getRegistryHealth` as a public **seam** — already-recommended leftover health already owns the walk. Do not add leftover `buildReadinessPlan` as a public **seam** — already-recommended leftover setup already owns the leftover gate list. Do not add leftover `previewLeadSourceSetup` as a public **seam** — leftover setup already owns the draft sitting.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// queries/leadSourceProjection.ts
// Show every Lead Source with its Feeds
// and counted connections.
// When the Owner opens one Lead Source,
// list every accepted label, Granot landing,
// inbound number, leftover finding, and leftover gate.
// Do not write.
// Do not activate.
// Do not price the lead.
// Do not hang a name.
// Do not walk every catalog book.
// Do not rewrite a finding into Owner language here.

// ── 1. Show every Lead Source with its Feeds and counted connections ──

export async function showEveryLeadSourceWithItsFeedsAndCountedConnections(deps)
async function loadEveryLeadSourceAndItsFeeds()
async function countAcceptedLabelsGranotNamesInboundNumbersAndLeadCostsForThoseFeeds()
function sayWhetherThisFeedCanGoLive(leadSourceOn, feedOn, periods) // today's feedReadiness
function countHowManyGranotNamesLandInThisFeed(names) // unique leftover source per leftover Feed

// ── 2. Open this Lead Source and list every connection and leftover gate ──

export async function openThisLeadSourceAndListEveryConnectionAndLeftoverGate(id, deps)
async function loadThisLeadSourceOrSayItIsMissing(id) // leftover NOT_FOUND
async function loadThisLeadSourcesFeedsLabelsGranotNamesInboundNumbersAndLeadCosts()
function listTheAcceptedLabelsOnThisFeed(mappings)
function listTheGranotLandingsOnThisFeed(names, feedId, thisCompanysFeedIds) // leftover one_feed vs leftover form_by_move_type
function listTheInboundNumbersOnThisCallFeed(assignments, routes)
function askTheFiveLeftoverJudgesAboutThisLeadSourceOnly() // today's connectionFindings; unpaid 0
function askLeftoverOwnerEnglishForEachFinding(drafts) // leftover translateFindings one leftover draft at a time
function mapLeftoverSetupGatesOntoThisLeadSourcesCards() // leftover GATE_ACTION + leftover all-Feeds / leftover all-names

function sayHowThisGranotNameLands(routes, thisCompanysFeedIds) // today's routeShape
function sayWhatHappensWhenALeadArrives(policy) // leftover create_if_missing / leftover link_only → existing_only / else watch_only
function sayWhetherThisGranotNameCanText(source) // leftover not_available unless leftover create_if_missing
```

Read the primary path out loud: *Open Mongo. Load every Lead Source and its Feeds. Count accepted labels, Granot names, inbound numbers on call Feeds, and whether each Feed’s lead cost is ready. On the shelf, leftover blocking findings stay zero. When the Owner opens one Lead Source, load that card or say it is missing. List every accepted label, every Granot landing (one Feed or local / long-distance by move type), every inbound number on a call Feed, leftover findings in Owner English, and leftover gates leftover setup already named. Stamp `generated_at`. Do not write. Do not activate. Do not price the lead. Do not hang a name. Do not walk every catalog book.*

That is the operation. `getLeadSourceProjection` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **List leftover `blocking_finding_count` is always `0`.** The field lives on leftover `LeadSourceListItem`. Detail actually counts leftover `severity === "blocking"`. The shelf never **asks** leftover `connectionFindings`. Do not silently run the five leftover judges on the list so “the number becomes true” without a paired leftover bound-6 test (that walk would blow leftover `PROJECTION_ROUND_TRIP_BOUNDS.list`). Do not silently drop the field from the list bag so “the TypeScript type shrinks” without a paired Admin leftover list test.

2. **List inbound counts leftover `active: true` assignments. Detail lists leftover open assignments with no leftover `active` filter.** A leftover inactive leftover assignment raises leftover `inbound_number_count` on the card and still appears on leftover `inbound_numbers.items`. Do not silently add leftover `active: true` onto the detail query so “the pages match” without a paired leftover empty-section + leftover inbound test. Do not silently drop leftover `active: true` from the list so “counts include archived numbers.”

3. **List Granot query is leftover route-only. Detail also loads leftover `lead_source_company`.** A leftover name hung on the company with no leftover route in these Feeds still enters leftover `ownerReadinessPlan` leftover `hasGranot` / leftover `granotLive` / leftover `textOn` on detail, and never increments leftover `granot_name_count` on the list. Do not silently drop the leftover company `$or` so “only landings count as leftover names” without a paired leftover zero-Feed company test (today leftover zero-Feed detail still queries leftover `lead_source_company`). Do not silently add leftover company match onto the list select so “the shelf counts orphan names.”

4. **Leftover `ownerReadinessPlan` uses leftover all-Feeds / leftover all-names predicates.** Leftover setup’s leftover `buildReadinessPlan` described one leftover sitting (one leftover Feed). This page says leftover lead cost is leftover `done` only when **every** Feed is leftover `ready`, leftover Feed activate leftover `done` only when **every** Feed is on, leftover Granot live leftover `done` only when **every** leftover name is leftover `lifecycle_enabled`. One leftover missing-CPL Feed keeps leftover `Set the lead cost` leftover `ready` on a company that already priced the others. Do not silently switch to leftover “any Feed” so “Best Relocation locals unlock the company” without a paired leftover mixed-CPL test. Do not silently **ask** leftover `buildReadinessPlan` per Feed so “each Feed owns leftover gates.”

5. **Unknown leftover `GATE_ACTION` falls back to leftover `open_lead_costs`.** If leftover setup renames leftover `gate` English, leftover `done` for leftover cost can light up from leftover `leadCostReady` on a leftover Connect-a-Granot-name row. Already-recommended leftover setup named this drift. Do not silently rename leftover English leftover `gate` strings in this pass so “the leftover setup map breaks.” Do not silently throw on an unknown leftover `gate` so “typos fail closed” without a paired leftover setup + leftover projection test.

6. **Leftover `translateFindings` runs one leftover draft at a time.** The leftover skip already accepts a leftover array. This file maps leftover `source_granularity_id` / leftover inbound phone per leftover draft, then takes leftover `[0]!`. An empty leftover translation would throw. Do not silently switch to leftover `translateFindings(rawFindings, { lead_source_id })` so “one scope owns every leftover deep_link” — leftover CPL leftover `deep_link` specialization **asks** leftover `source_granularity_id`. Do not silently drop leftover `[0]!` without a paired leftover empty-translation test.

7. **Leftover `connectionFindings` passes unpaid Lead count `0` and no correction-job counts.** Already-recommended leftover health named this. A Lead Source page can look clean while leftover `GET .../health` shows leftover `registry.cpl_missing_rate_leads`. Do not silently load leftover `missing_rate` Leads here so “the pages match” without a paired leftover bound-10 test. Do not silently **ask** leftover `getRegistryHealth` from detail so “one walk owns both pages.”

8. **`arrivalFromPolicy` maps every unknown `lead_created_policy` to `watch_only`.** `link_only` becomes `existing_only`. `observation_only` and garbage become Watch only. Do not silently surface `observation_only` as a fourth Owner word so “the stored policy is honest” — skipped `ownerLanguageDeck.ts` already bans `policy`. Do not silently treat `observation_only` as `create_if_missing` so “texts become `not_available` vs `off`.”

9. **Process-global `projectionRoundTrips`.** `resetProjectionRoundTripCount` runs at the start of each export. Two overlapping Wave B reads in one process can share the counter. `_round_trips` is also HTTP `data`. Do not silently move the counter onto `deps` so “one request owns the bound” without a paired concurrent-list test. Do not silently drop `_round_trips` from HTTP so “only tests see the bound” without saying Wave B already forwards `data`.

10. **Form channel is the default.** `channel === "call" ? "call" : "form"` treats missing / garbage as form. Inbound numbers then omit. Do not silently 400 a missing `channel` so “the stored Feed is invalid” without a paired empty-section test. Do not silently show inbound numbers on form Feeds so “every assignment is visible.”

11. **`sheet_config.projection_mode` defaults `derived_import`.** Missing / garbage becomes `derived_import`. `has_bad_tabs` is `=== true`. Do not silently require `spreadsheet_id` so “direct_write is honest” — knowledge already says `direct_write` does not itself enable Sheet Sync writes. Do not silently invent a spreadsheet id.

12. **Owner-language deck vs stored `granularity_key`.** Skipped `ownerLanguageDeck.ts` bans `granularity` on Owner-facing copy and skips `advanced`. This DTO still returns `granularity_key` on Feed items (knowledge: does not invent stored identifiers). `ownerLanguageDeck.test.ts` **asks** detail as the leak fixture. Do not silently rename `granularity_key` to `feed_key` on this DTO so “the deck goes green” without a paired Admin field test. Do not silently move `granularity_key` under `advanced` so “the deck no longer sees it.”

13. **Leave sibling modules alone.** Already-recommended `buildReadinessPlan`, `buildSourceRegistryHealthFindings` / `buildLabelMappingHealthFindings` / `buildGranotSourceHealthFindings` / `buildRingCentralHealthFindings` / `buildCplRegistryHealthFindings`, `validateCplSchedule`, `translateFindings`, `requireRegistryReadActor`, `getRegistryOverview`, `getRegistryHealth`, `previewLeadSourceSetup`, `createGranotNameFromOwnerIntent`, `setGranotCrmSourceOutboundSms`, `withRegistryMutation`, skipped `findOwnerLanguageLeaks`, and Wave B empty-strict query are already the right **depth**. This file lists Lead Sources and opens one card; it does not open a draft, walk leftover-path Events, or decide who may speak.

14. **Do not silently change English `gate` strings, Owner `action` strings, HTTP `when_lead_arrives` / `text_state`, stored `company_slug` / `granularity_key`, or finding `code`s.** Those are leftover setup `GATE_ACTION`, Admin button ids, HTTP bags, stored identifiers, and skipped `FINDING_TRANSLATION_TABLE`. Story names live on the functions.

## Testing

The **interface** is the test surface: `showEveryLeadSourceWithItsFeedsAndCountedConnections` / `openThisLeadSourceAndListEveryConnectionAndLeftoverGate` (today `listLeadSourceProjections` / `getLeadSourceProjection`). `PROJECTION_ROUND_TRIP_BOUNDS` stays exported because the Mongo-walk bound is a second real **adapter**, not a test leak. Do not make `connectionFindings` / `ownerReadinessPlan` / `counted` / `GATE_ACTION` the named surface.

Today `queries/leadSourceProjection.test.ts` covers one-request Best Relocation connections (local / long-distance `form_by_move_type`, call `one_feed`, inbound `+19545550142`, bound 10, writes 0), two move-type Feeds keeping separate label sets, empty sections never absent (zero-Feed company `feeds.empty`, empty call Feed `accepted_labels` / `granot_names` / `inbound_numbers`), list bound 6, and Owner finding copy keeping `lifecycle` / `disposition` / `route_key` / `lead_model` / `policy_version` out. Keep those **asks**. Name the operation:

**Show every Lead Source with its Feeds and counted connections**
- Best Relocation company + local / long / call Feeds → three Feed items, `accepted_label_count` 1 / 1 / 0, `granot_name_count` 1 / 1 / 1, `inbound_number_count` only on call, `blocking_finding_count === 0`.
- Zero-Feed company → `feeds.empty === true`, `feeds.items` `[]`.
- `_round_trips` `<= 6`. `EntityChange.create` / `OperationsRegistryChange.create` stay 0.
- Do not add a `requireRegistryReadActor` 403 test here. Wave B + leftover who-may-speak already own that **adapter**.

**Open this Lead Source and list every connection and leftover gate**
- Missing id → `RegistryError` / `NOT_FOUND`.
- Best Relocation detail lists local `Best Relocation Locals`, long `Best Relocation Forms`, split Granot on both form Feeds with `form_by_move_type` `selection_rule` including `move`, call `one_feed`, inbound phone, `generated_at`, `_round_trips` `<= 10`, writes 0.
- Empty call Feed still has `accepted_labels.empty` / `granot_names.empty` / `inbound_numbers.empty` (keys present).
- Findings each have `owner_action` + `deep_link` + `advanced.raw_code`. Banned words stay out of `owner_message` / `owner_action`.
- `readiness_plan` maps English `gate` onto `open_lead_costs` / `activate_lead_source` / `activate_feed` / `switch_granot_name_live` / `turn_on_customer_text` / `connect_granot_name`. Do not retest `buildReadinessPlan` English here — leftover setup already owns that **adapter**.
- Add: mixed CPL (one Feed `ready`, one `missing`) keeps `Set the lead cost` **not** `done`. Lock that all-Feeds predicate.
- Add: list `inbound_number_count` ignores inactive assignments; detail still lists them. Name the test “inactive inbound number appears on the card and not on the shelf count.”
- Do not add a `requireRegistryReadActor` 403 test here. Wave B + leftover who-may-speak already own that **adapter**.
- Do not retest `FINDING_TRANSLATION_TABLE` rows here. Skipped finding translation already owns that **adapter**.
- Do not retest `findOwnerLanguageLeaks` here. Skipped `ownerLanguageDeck.test.ts` already **asks** this DTO.

Do **not** add a test per helper (`sayWhetherThisFeedCanGoLive`, `sayHowThisGranotNameLands`, `sayWhatHappensWhenALeadArrives`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** retest leftover setup collisions, leftover health walk leftover-path Events, leftover hang POST, leftover SMS enable gates, leftover `/activation` active-company rules, leftover CPL `set_range`, leftover Change pagination, leftover overview shelf counts, leftover who-may-speak signatures, leftover stamp rollback, or Wave B route mounts here. Those already have their own interface tests. Wave B **asks** list / detail. Skipped deck **asks** detail as a fixture. Prove the card, not the walk.

## What I would not do

- A `LeadSourceProjectionService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `find({}).lean()`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `get.ts` / `list.ts`) for cleanliness.
- Breaking the list-counts / detail-connections **seam**. A public `connectionFindings` leftover health walk could import without `translateFindings` is the forbidden split. Returning `getRegistryHealth` from this file is the same break. Calling `createLeadSourceSetup` from list so “the shelf opens drafts” is the same break. Writing `blocking_finding_count` on the list by walking `missing_rate` Leads is the same break.
- Treating leftover setup, leftover health walk, skipped finding translation, leftover hang, leftover SMS, leftover stamp, leftover who-may-speak, leftover CPL `set_range`, leftover overview, leftover Change list, skipped Owner-language deck, Wave B Zod, Wave B HTTP, `EntityChange`, or mint `createLeadFromGranot` as this story.
- Inventing a **seam** that has only one **adapter**.
- Silently "fixing" a known gap while recommending a rename: do not run leftover judges on the list so “`blocking_finding_count` becomes true”; do not add `active: true` onto detail inbound; do not drop the company `$or` from Granot detail; do not switch readiness to “any Feed”; do not rename English `gate` strings; do not pass unpaid Leads into `connectionFindings`; do not **ask** `getRegistryHealth` from detail; do not rename `granularity_key` so the deck goes green; do not invent stored identifiers; do not move `requireRegistryReadActor` / `translateFindings` / `buildReadinessPlan` into this file; do not rename HTTP `when_lead_arrives` / Owner `action` strings / finding `code`s.
- Jumping to the next service while this one has unchecked modules (none remain after this pass).
- Writing a whole-folder recommendation for `operationsRegistry`.
