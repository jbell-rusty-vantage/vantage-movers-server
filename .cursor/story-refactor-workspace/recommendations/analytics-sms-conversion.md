# Rate These Successfully Texted Leads By Whether They Booked — operational story

- Status: recommended
- Service: `analytics` (Wave A, in-progress)
- Pass: 10 of this service — `smsConversion.service.ts`
- Remaining in this service: `agentSalesReport.service.ts`, `leadCost.service.ts`, `analyticsExport.service.ts`, `analyticsFilters.ts`, `analyticsMerge.ts`, `sourceHierarchy.ts`
- Target: `src/services/analytics/smsConversion.service.ts`
- Knowledge: [`docs/knowledge/services/analytics.md`](../../../docs/knowledge/services/analytics.md) (`sms-successfully-sent-then-booked`: `lead_messages` + form/call (`lead.booked`). Successful text = leftover `SUCCESSFUL_LEAD_MESSAGE_STATUSES` `accepted` | `sent` | `delivered`. One Lead, one vote (`lead_ref.id`, fallback `form_lead`). Booked is the official Lead `booked` ref, not a `booked_leads` lookup. Rate = distinct texted-and-booked / distinct texted. Payload is an `all` totals row plus a breakout by message `origin`. Date/source/`local` chips apply to the joined Lead, not the message. Historical skip: leftover dispatcher returns `unsupportedSmsConversionReport()` (`items: []` + `historical_sms_conversion_supported: false`). Combined merge keeps live rows and a Lead Message warning. Role line on that Service is the leftover dispatcher, not this file. Combined add of `{ items }` by leftover-lowercased `origin` lives in leftover merge, not here. CSV: leftover flatten emits `origin` / `label` / `texted_leads` / `booked_leads` / `not_booked_leads` / `booking_rate`). Distinct from already-recommended named-report dispatcher: [`analytics-analytics.md`](analytics-analytics.md) (`analytics.service.ts` — `GET /api/v1/admin/analytics/sms-successfully-sent-then-booked` **asks** this; this file **does not** pick live / historical / combined — leftover dispatcher returns the empty card on historical). Distinct from already-recommended home Overview: [`analytics-overview.md`](analytics-overview.md) (Summary + top Agents + leftover last-week by-source — **does not** import this file). Distinct from already-recommended Summary totals: [`analytics-summary.md`](analytics-summary.md) (four-collection `{ totals }` — **does not** open Lead Messages). Distinct from already-recommended Revenue Trend: [`analytics-revenue-trend.md`](analytics-revenue-trend.md) (period buckets on booked `$report_date` — **does not** open Lead Messages). Distinct from already-recommended Source Company scorecards: [`analytics-source-performance.md`](analytics-source-performance.md) (nests catalog children; funnel counts Form / Call refs — **does not** open Lead Messages). Distinct from already-recommended Agent ranking: [`analytics-agent-performance.md`](analytics-agent-performance.md) (unwind Booking allocations, hard top 50, Deposit sort — **does not** open Lead Messages). Distinct from already-recommended Cancellation rating: [`analytics-cancellation-analytics.md`](analytics-cancellation-analytics.md) (booked `is_cancelled` — **does not** open Lead Messages). Distinct from already-recommended place ranking: [`analytics-geographic-analytics.md`](analytics-geographic-analytics.md) (local / lanes / states — **does not** open Lead Messages). Distinct from already-recommended Receiver-Agent ranking: [`analytics-receiver-agent-performance.md`](analytics-receiver-agent-performance.md) (Form + Call on `timestamp`, Booking / Cancellation lookups, same historical-empty shape — **does not** open Lead Messages; `booked_leads` there is a Lead **or** a Booking row). Distinct from already-recommended remember / send-or-wake / claim-and-send: [`lead-messaging-lead-messaging.md`](lead-messaging-lead-messaging.md). Distinct from already-recommended Granot six-gate confirmation: [`lead-messaging-granot-created-lead.md`](lead-messaging-granot-created-lead.md). Distinct from leftover successful-status set: `src/config/domain/leadMessaging.ts` (`SUCCESSFUL_LEAD_MESSAGE_STATUSES` — this file **asks** it; it does **not** own Twilio). Distinct from leftover booked-prefix / lead match / rate helpers: later `analyticsFilters.ts` (this file **asks** `leadMatchForQuery`, leftover `numberValue`, leftover `rate`). Distinct from leftover combined add: later `analyticsMerge.ts` (dispatcher **asks** `mergeAnalyticsPayload` — key `origin`; leftover rewrite of warning metadata; leftover `deriveRates` recomputes `not_booked_leads` and `booking_rate`). Distinct from leftover CSV flatten: later `analyticsExport.service.ts` **asks** the leftover dispatcher, then emits the six SMS columns. Distinct from leftover Agent Sales / Lead Cost / catalog nest. Distinct from already-recommended Admin Dashboard desk / typeahead / chips. Distinct from already-recommended RingCentral count-only reconcile: [`ringcentral-analytics-reconcile.md`](ringcentral-analytics-reconcile.md). This checkout’s `CONTEXT.md` does not define Analytics / Lead Message / Booking — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Do not add an sms-conversion Service file in this rename.
- Callers: already-recommended dispatcher `analytics.service.ts` (`case "sms-successfully-sent-then-booked"` — historical **asks** `unsupportedSmsConversionReport`; live **asks** `getSmsSuccessfullySentThenBooked`). Barrel `analytics/index.ts` does **not** export these four. Wave B `src/routes/v1.routes.ts` (`handleAnalyticsReport` for that string — `GET /api/v1/admin/analytics/sms-successfully-sent-then-booked`; `analyticsQuerySchema`) **asks** the leftover dispatcher, not this file. Leftover CSV **asks** the leftover dispatcher then flatten (`GET /api/v1/admin/exports/analytics/sms-successfully-sent-then-booked.csv`). Already-recommended Overview / leftover Summary / leftover Source Company scorecards / leftover Agent ranking / leftover Cancellation rating / leftover place ranking / leftover Receiver-Agent ranking do **not** import this file. Tests: `smsConversion.service.test.ts` (**asks** `smsConversionFromOriginRows` for All + origin rates and the empty-cohort zero rate; **asks** `unsupportedSmsConversionReport`; **asks** `getSmsSuccessfullySentThenBooked` and proves leftover `accepted` / `sent` / `delivered`, no `failed` / `undelivered` / `skipped`, `$lead._id` / `$lead.booked`, no `"from":"booked_leads"`). `analytics.service.test.ts` leftover-merges `"sms-successfully-sent-then-booked"` with an empty historical card and leftover-parses the report string — **does not call these four exports**.
- Seams callers need: rate-these-texted-leads (`getSmsSuccessfullySentThenBooked`: one `{ items, metadata }` list for already-scoped form / call models + chips, after a successful Lead Message) vs paint-the-card-from-origin-counts (`smsConversionFromOriginRows`: the same `{ items, metadata }` without Mongo — tests and the ranking **ask** this) vs hand-back-the-empty-card (`unsupportedSmsConversionReport`: leftover dispatcher **asks** this on historical) vs run-this-named-report (already-recommended dispatcher **asks** one of the two, then optionally leftover merge) vs flatten-to-spreadsheet (leftover CSV **asks** the dispatcher). There is no write **seam**. There is no begin / complete **seam**. There is no database-scope **seam** — callers already picked the model set. There is no combined-add **seam**. There is no nest **seam**. There is no CSV-column **seam**. There is no Twilio-send **seam**. There is no Receiver-Agent **seam**. There is no RingCentral **seam**.
- Split later (only if the file outgrows one sitting): this ~201-line file is one sitting if you read it as rate these successfully texted Leads by whether they booked, paint All plus each origin, and hand back the empty historical card. Do **not** split `getSmsSuccessfullySentThenBooked` and `smsConversionFromOriginRows` into `get.ts` / `fromRows.ts` on this pass — they are one rate, not a CRUD folder. Do **not** pull leftover filters / merge here so “the SMS file owns the match.” Do **not** pull leftover Receiver-Agent ranking here so “every historical-empty card lives together.” If it later splits: `rateTheseSuccessfullyTextedLeadsByWhetherTheyBooked.ts` and `handBackTheEmptyTextedLeadCard.ts` only as later story files, never `create.ts` / `update.ts` / `delete.ts` / `get.ts` / `list.ts`

`getSmsSuccessfullySentThenBooked` / `smsConversionFromOriginRows` / `unsupportedSmsConversionReport` / `smsConversionOriginLabel` are executor mechanics. The owner questions are: *I asked how many Leads we successfully texted later booked. Take confirmation texts whose status is accepted, sent, or delivered. Join each text to its Form Lead or Call Lead — `lead_ref.id` first, else the leftover public-form `form_lead`. Drop a text with no Lead. A Lead counts once even if we texted twice. Booked means the official Lead booked ref is set — do not go hunting for a Booking row. Date, source, and local chips apply to the joined Lead, not the text. Break the rate out by why we sent the text. Always put All first. An empty cohort is a zero rate, not missing data. Historical has no Lead Messages — hand back the empty card when the leftover dispatcher asks. This file does not pick live versus historical. This file does not add the two collections. This file does not send texts. This file does not flatten a spreadsheet.*

Already-recommended dispatcher / Overview / Summary / Revenue Trend / Source Company scorecards / Agent ranking / Cancellation rating / place ranking / Receiver-Agent ranking, leftover filters / merge / CSV / Agent Sales / Lead Cost, leftover successful-status set, already-recommended Lead Message writes, leftover scope pick, already-recommended Admin Dashboard desk, and already-recommended RingCentral reconcile already live in other **modules**. Do not pull those in.

## What this file actually does

Three exports of one “rate these successfully texted Leads by whether they booked” story, not “an SMS CRUD report service,” and not the Receiver-Agent ranking:

1. **Rate these successfully texted Leads by whether they booked** — `getSmsSuccessfullySentThenBooked`. Callers already handed a concrete `AdminModels` set and leftover `AnalyticsQuery` chips. Open leftover `getLeadMessageModel()` (the live Lead Message collection — **not** a handed Admin model). `$match` leftover `SUCCESSFUL_LEAD_MESSAGE_STATUSES`. `$set joined_lead_id` from `$lead_ref.id`, else leftover `$form_lead`. Drop null. `$lookup` handed `models["form-leads"].collection.collectionName` and/or `models["call-leads"].collection.collectionName` — the leftover `lead_type` chip empties the other lookup to `[]` before Mongo. `$set lead` prefers form[0], else call[0]. Drop a missing Lead. Optional leftover `leadMatchForQuery` (prefixed `lead.`) on joined Lead `timestamp` / `local` / source chips. `$group` `_id` is `$lead._id` (one Lead, one vote). Origin is `$first` of `$ifNull: ["$origin", "unknown"]`. Booked is `$max` of leftover `lead.booked` set (1 or 0). Then `$group` `_id` is `$origin` with `texted_leads` / `booked_leads`. **Ask** `smsConversionFromOriginRows`. This file never mutates Mongo, never enqueues Sheet Sync, never reads Reporting Sheets, never calls `concreteScopes` / `getAdminModels`, never opens the handed booked / cancelled models, and never talks to Twilio.

2. **Paint the All-plus-origin card from origin counts** — `smsConversionFromOriginRows`. Drop origin rows with `texted_leads <= 0`. Sort leftover texted desc, then leftover label. Sum texted and booked. Prepend `origin: "all"`. Stamp the live-only warning. An empty input still returns one All row at rate 0. Tests **ask** this without Mongo.

3. **Hand back the empty historical card** — `unsupportedSmsConversionReport`. `{ items: [], metadata }` with `sms_conversion_scope: "unsupported"` and the switch-to-live-or-combined message. Leftover dispatcher **asks** this when the concrete scope is historical. Combined leftover merge then keeps the live `{ items }` and rewrites the warning.

There is no fourth owner operation. `smsConversionOriginLabel` titles `public_form` / `granot_lead_created` / `all` / blank → Unknown / leftover title-case. Combined add of two `{ items }` lists is leftover merge after the leftover dispatcher calls this twice (or once plus the empty card). Do not export leftover `leadMatchForQuery` from this file as if this story owned every Lead chip. Do not export leftover `mergeAnalyticsPayload` from this file as if this story owned both databases. Do not export leftover `SUCCESSFUL_LEAD_MESSAGE_STATUSES` from this file as if this story owned Twilio.

## Organization

Keep one file. This is the screenplay for “rate these successfully texted Leads by whether they booked.” Chip match, combined add, successful-status set, Lead Message writes, home Overview, named-report dispatch, Receiver-Agent ranking, and CSV columns already live in deeper **modules**. Do not pull those in. Do not invent a `SmsConversionService` class. Do not invent a begin / complete **seam** — this is a read. Do not invent a scope **adapter** beside leftover `getAdminModels`. Do not invent a merge **adapter** beside leftover `mergeAnalyticsPayload`. Do not invent a filter **adapter** beside leftover `leadMatchForQuery`. Do not invent a status **adapter** beside leftover `SUCCESSFUL_LEAD_MESSAGE_STATUSES`.

Do not split this by HTTP report string on this pass. The ranking and the All-plus-origin paint are two beats of one texted-Lead sitting. Do not move this into `leadMessaging/` so “the write folder owns every SMS table.” Do not add Receiver-Agent / Agent Sales / Lead Cost cases here.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `getSmsSuccessfullySentThenBooked` | `rateTheseSuccessfullyTextedLeadsByWhetherTheyBooked` | leftover dispatcher **asks** the `{ items, metadata }` rate |
| `smsConversionFromOriginRows` | `paintTheTextedLeadBookingRateFromOriginCounts` | the ranking and the existing tests **ask** All + origin without re-running Mongo |
| `unsupportedSmsConversionReport` | `handBackTheEmptyTextedLeadCard` | leftover dispatcher **asks** the empty historical card |
| `smsConversionOriginLabel` | `labelThisTextOrigin` | leftover title for `public_form` / `granot_lead_created` / `all` — keep as a one-line alias; do not teach Wave B this name |

Keep the old names as one-line aliases until already-recommended `analytics.service.ts` migrates. Do not make callers learn `$lookup` / `joinedLeadMatch` / `prefixMatchKeys` as the domain language. Do not export these from `analytics/index.ts` so Wave B can skip the leftover dispatcher.

`rateTheseSuccessfullyTextedLeadsByWhetherTheyBooked` should keep calling `paintTheTextedLeadBookingRateFromOriginCounts`. Do not keep a second copy of All / rate / sort.

**No class for the workflow.** The types that *do* earn a name are the cards the Admin Dashboard already paints:

```ts
type ThisTextedLeadBookingRate = {
  origin: string                 // "all", "public_form", "granot_lead_created", or leftover "$first"
  label: string                  // "All", "Public form", "Granot lead created", else title-case
  texted_leads: number           // distinct Leads that got a successful text
  booked_leads: number           // those Leads whose official booked ref is set
  not_booked_leads: number       // max(texted - booked, 0)
  booking_rate: number           // booked / texted — 0 when none texted
}

type TheseTextedLeadBookingRates = {
  items: ThisTextedLeadBookingRate[]   // All first, then origins with texted > 0
  metadata: {
    sms_conversion_scope: string       // live-only on the ranking; "unsupported" on the empty card
    historical_sms_conversion_supported: false
    historical_excluded_from_sms_conversion_metrics: true
    message: string
  }
}
```

That is the handoff from “we counted the matching successful texts” to “paint All plus each origin.” Combined `items` is leftover merge of two of these lists, not a third database this file sees. A quiet origin is omitted, not a zero row — except All, which is always present.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// smsConversion.service.ts
// The owner asked how many Leads we
// successfully texted later booked.
// Take confirmation texts whose status
// is accepted, sent, or delivered.
// Join each text to its Form Lead or Call Lead —
// lead_ref.id first, else the leftover public-form form_lead.
// Drop a text with no Lead.
// A Lead counts once even if we texted twice.
// Booked means the official Lead booked ref is set —
// do not go hunting for a Booking row.
// Date, source, and local chips apply to the joined Lead,
// not the text.
// Break the rate out by why we sent the text.
// Always put All first.
// An empty cohort is a zero rate, not missing data.
// Historical has no Lead Messages —
// hand back the empty card when asked.
// This file does not pick live versus historical.
// This file does not add the two collections.
// This file does not send texts.
// This file does not flatten a spreadsheet.

// ── 1. Rate these successfully texted Leads ───────────────

export async function rateTheseSuccessfullyTextedLeadsByWhetherTheyBooked(models, query)

async function takeTheSuccessfulConfirmationTexts()
  // leftover getLeadMessageModel + leftover SUCCESSFUL_LEAD_MESSAGE_STATUSES
function joinEachTextToItsFormOrCallLead()
  // lead_ref.id, else leftover form_lead
  // handed form / call collection names
  // leftover lead_type chip empties the other lookup
async function keepLeadsThatMatchTheChips(query)
  // asks leftover leadMatchForQuery; prefixes lead.
function countEachLeadOnce()
function countBookedOnlyFromTheOfficialLeadRef()
function groupThoseLeadsByWhyWeSentTheText()

// ── 2. Paint All plus each origin ─────────────────────────

export function paintTheTextedLeadBookingRateFromOriginCounts(rows)
function dropOriginsWithNoTextedLeads()
function putAllFirstThenSortByHowManyWeTexted()
function rateBookedAgainstTexted()
function stampTheLiveOnlyWarning()

// ── 3. Hand back the empty historical card ────────────────

export function handBackTheEmptyTextedLeadCard()
```

Read the ranking path out loud: *The owner asked for SMS Successfully Sent Then Booked on a database someone else already picked, plus leftover chips. Take leftover live Lead Messages whose status is accepted, sent, or delivered. Join each text to its Form Lead or Call Lead. Drop a text with no Lead. Count each Lead once. Booked is the official Lead booked ref, not a Booking lookup. Rate booked over texted. Put All first, then each origin. Hand `{ items, metadata }` back. Historical asks the empty card next door. Live versus historical, adding the two collections, sending the text, and flattening a spreadsheet live next door.*

That is the operation. `getSmsSuccessfullySentThenBooked` is not a different story. `smsConversionFromOriginRows` is not a second report. Combined is not a third System of Record this file merges.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`get*` is an executor name.** The owner asked to rate these successfully texted Leads by whether they booked. The name should say that. Do not teach Wave B `getSmsSuccessfullySentThenBooked` as if this file owned the leftover dispatcher envelope.

2. **This file never sees `combined` or `historical` on the ranking path.** Leftover dispatcher **asks** the empty card on historical, and **asks** the ranking on live. Combined add is leftover merge after those two calls. Do not call leftover merge here so “the SMS file can add,” and do not teach this file `concreteScopes`. Do not run the ranking on historical models so “the empty card can go away.”

3. **Lead Messages are not a handed Admin model.** `getLeadMessageModel()` always opens the live `lead_messages` collection. Form / Call lookups use handed `collection.collectionName`. Already-recommended Receiver-Agent ranking hardcodes `agents` / `booked_leads` / `cancelled_leads`. Do not switch this file to hardcoded `form_leads` / `call_leads` so “SMS matches Receiver,” and do not teach Receiver handed `collectionName` so “every lookup matches SMS.” Do not add `lead_messages` to leftover `AdminModels` in this rename so “every collection is scoped.”

4. **Booked here is the official Lead ref, not a Booking row.** `$lead.booked` set. Already-recommended Receiver-Agent ranking also `$lookup`s `booked_leads`. The existing test proves this pipeline does **not** mention `"from":"booked_leads"`. A Lead whose Booking exists without `lead.booked` paints on Receiver and misses here. Do not add the Booking lookup so “booked means the same as Receiver,” and do not drop Receiver’s lookup so “every Lead report matches SMS.”

5. **One Lead, one vote — origin is `$first` without a sort.** Two successful texts on the same Lead collapse to one row. If those texts have different leftover origins (`public_form` vs `granot_lead_created`), Mongo keeps whichever document it saw first. Do not `$sum` texts so “each SMS is a vote,” and do not `$sort` origin so “Granot wins” or “public form wins.”

6. **Date chips are joined Lead `timestamp`, not the text clock.** Leftover `leadMatchForQuery` matches `timestamp`. Leftover `sent_at` / `delivered_at` / `createdAt` on the Lead Message are ignored. Do not `$match` message `sent_at` so “the cohort is when we texted,” and do not teach leftover `leadMatchForQuery` a message date so “every SMS report shares send time.”

7. **When both lead types are included, leftover match is the Form Lead clause.** `joinedLeadMatch` strips `lead_type` and **asks** leftover `leadMatchForQuery("FormLead")` unless the chip is `CallLead`. On the live path the Form vs Call granularity extras are the same (the leftover historical `company_slug` clause does not fire). Do not **ask** leftover match twice and `$or` so “each type owns its catalog channel,” and do not teach leftover `leadMatchForQuery` to ignore `leadType` so “SMS owns the match.”

8. **The leftover `lead_type` chip empties the other lookup.** `lead_type=form` sets `call: []` before Mongo. A Granot text whose `lead_ref` is a Call Lead then drops. Already-recommended Receiver-Agent ranking returns `[]` for the other aggregate, then adds. Do not keep both lookups and filter `lead_model` so “a Call text still paints on a form chip,” and do not split this rate into form/call lists so “SMS matches lanes.”

9. **Form wins when both lookups hit.** `$ifNull` form[0], else call[0]. Same ObjectId in both collections is not a product path. Do not `$concatArrays` so “a Lead can be both,” and do not prefer Call so “Granot origin owns the join.”

10. **A text with neither `lead_ref.id` nor `form_lead` is dropped.** Phase-1 backfill copied `form_lead` onto `lead_ref` for public-form rows. A leftover row that missed both pointers never enters the cohort. Do not count those as `origin: "unknown"` so “every successful text paints.”

11. **All is synthesized in this file; leftover combined add keys `origin` independently.** `paintTheTextedLeadBookingRateFromOriginCounts` prepends All from the origin sums. Leftover merge then adds two All rows by leftover-lowercased `origin` and recomputes `not_booked_leads` / `booking_rate`. It does **not** re-sum All from the merged origins. Historical is empty, so today’s combined All equals live All. Do not drop the All row so “CSV can total,” and do not teach leftover merge to rebuild All from children so “combined matches this file’s paint.”

12. **An empty cohort still paints All at rate 0.** `smsConversionFromOriginRows([])` returns one All row, not `{ items: [] }`. The historical empty card is `{ items: [] }`. Do not return `[]` on live so “empty looks like historical,” and do not put All on the historical card so “every payload has All.”

13. **Origins with `texted_leads <= 0` are omitted.** Mongo `$sum: 1` after the Lead group should not emit a zero-texted origin. The filter is the paint’s belt. Do not seed leftover `LEAD_MESSAGE_ORIGINS` so “Public form and Granot always appear.”

14. **Leftover `source` / `agent` / `merchant` / `receiver_agent` / `granularity` chips are ignored.** Lead match knows timestamp, local, leftover `source_company`, and leftover `source_granularity_key`. Booking-only chips do not apply. Do not point this ranking at leftover `bookedLeadPrefix` so “every booked rate shares book date.”

15. **`smsConversionOriginLabel` has no runtime caller outside this file.** Tests prove “Public form” through the paint. Do not export it from `analytics/index.ts` so Wave B can title a chip.

16. **Unused `prefixMatchKeys` is a real decision, not a one-liner.** Leftover `$and` / `$or` / `$nor` recurse; other keys get `lead.` unless they already start with `$`. Do not inline it into the ranking name so “the story owns Mongo prefixing.”

17. **Leave sibling modules alone.** `leadMatchForQuery` / `rate` stay in later `analyticsFilters.ts`. Combined add stays in later `analyticsMerge.ts`. Successful-status set stays in leftover `config/domain/leadMessaging.ts`. Scope pick stays in leftover `adminScope.service.ts`. Home Overview, named-report dispatch, Summary totals, Revenue Trend, Source Company scorecards, Agent ranking, Cancellation rating, place ranking, Receiver-Agent ranking, CSV flatten, and leftover Agent Sales / Lead Cost stay in their files. This file orchestrates leftover successful texts → Form/Call join → leftover Lead chips → one vote per Lead → origin group → All-plus-origin paint.

18. **Do not treat already-recommended Receiver-Agent ranking as this story.** Form + Call on `timestamp`, Booking / Cancellation lookups, same historical-empty shape. Do not import it here, and do not teach that file Lead Messages.

19. **Do not treat already-recommended Lead Message writes as this story.** `persistLeadMessageIntent` / `dispatchOrQueuePersistedLeadMessage` mutate a Lead Message. Do not import them here, and do not teach this file quiet hours or Twilio SIDs.

20. **Do not treat leftover Agent Sales / Lead Cost as this story.** Agent Sales hard-codes live booked models. Lead Cost is Overview-only stored CPL. Do not import them here.

21. **Do not treat already-recommended RingCentral analytics reconcile as this story.** Count-only Call Log math. Do not import it here, and do not teach that file `{ items }` by origin.

## Testing

The **interface** is the test surface: `rateTheseSuccessfullyTextedLeadsByWhetherTheyBooked` (`getSmsSuccessfullySentThenBooked`), `paintTheTextedLeadBookingRateFromOriginCounts` (`smsConversionFromOriginRows`), and `handBackTheEmptyTextedLeadCard` (`unsupportedSmsConversionReport`). The `{ items, metadata }` cards are part of that **interface**.

Today’s `smsConversion.service.test.ts` already proves All + origin rates, the empty-cohort zero rate, the historical empty card, leftover successful statuses, `$lead._id` / `$lead.booked`, and no `booked_leads` lookup. Keep that proof. Fill the gap the story names make obvious:

**Rate these successfully texted Leads by whether they booked**
- **Asks** leftover `getLeadMessageModel().aggregate` once — not the handed booked / cancelled models.
- Pipeline `$match`es leftover `accepted` / `sent` / `delivered` and does **not** mention `failed` / `undelivered` / `skipped` / `pending`.
- `joined_lead_id` is `$lead_ref.id`, else leftover `$form_lead`. A null id is dropped.
- Form / Call `$lookup` `from` values are the handed `collection.collectionName`.
- `lead_type=FormLead` sets `call: []`. `lead_type=CallLead` sets `form: []`.
- **Asks** leftover `leadMatchForQuery` with `lead_type` stripped. Date field on that match is `timestamp`, prefixed `lead.`.
- `$group` `_id` is `$lead._id` before origin. Two texts on one Lead are one vote.
- `booked_leads` is leftover `lead.booked` set. Pipeline does **not** `$lookup` `booked_leads`.
- Returns `{ items, metadata }` with All first and `historical_sms_conversion_supported: false`.
- Does **not** call leftover `concreteScopes` / `getAdminModels` / `mergeAnalyticsPayload`.
- Does **not** mutate Mongo, enqueue Sheet Sync, or talk to Twilio.

**Paint the All-plus-origin card from origin counts**
- `public_form` 2/1 plus `granot_lead_created` 1/0 → All 3/1, rate `1/3`, Public form rate `0.5`.
- Empty input → one All row, `texted_leads: 0`, `booking_rate: 0`.
- Origin with `texted_leads: 0` is omitted. All is still present.
- Sort is texted desc, then leftover label. All stays first.

**Hand back the empty historical card**
- `{ items: [], metadata.sms_conversion_scope: "unsupported", historical_sms_conversion_supported: false }`.
- Does **not** query Mongo.

**Not this file**
- Do **not** assert leftover dispatcher `{ report, database_scope, generated_at, data }` — that is already-recommended `analytics.service.ts`.
- Do **not** assert leftover merge of live All + empty historical, or leftover rewrite of the combined warning — that is a later sitting (`analyticsMerge.ts`). The existing leftover test already covers that add.
- Do **not** assert leftover booked-prefix employee-snapshot order or leftover lead-match catalog load — that is a later sitting (`analyticsFilters.ts`).
- Do **not** assert leftover CSV columns — that is a later sitting (`analyticsExport.service.ts`).
- Do **not** assert leftover Receiver-Agent Booking-without-ref — that is already-recommended `receiverAgentPerformance.service.ts`.
- Do **not** assert leftover `SUCCESSFUL_LEAD_MESSAGE_STATUSES` membership as a config unit — that is leftover `leadMessaging.ts` (`leadMessaging.test.ts` already lists them).
- Do **not** assert leftover persist / dispatch / quiet hours — that is already-recommended `leadMessaging.service.ts`.
- Do **not** assert leftover Summary `{ totals }` — that is already-recommended `summary.service.ts`.

Do **not** add a test per helper (`joinEachTextToItsFormOrCallLead`, `countEachLeadOnce`, `putAllFirstThenSortByHowManyWeTexted`, `stampTheLiveOnlyWarning`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test leftover booked-prefix employee-snapshot order, leftover merge parent/leaf math, leftover catalog “leaves or a childless company,” leftover Summary rates, leftover Agent ranking 50-cut, leftover Receiver-Agent `$cpl` vs `cpl_resolution_status`, or RingCentral reconcile here.

## What I would not do

- A `SmsConversionService` class with `get` / `list` / `export`.
- Thirty two-line functions that only wrap leftover `$lookup`.
- Moving this into a CRUD folder, or into `leadMessaging/` / `admin/` “because those also store SMS.”
- Splitting `getSmsSuccessfullySentThenBooked` and `smsConversionFromOriginRows` into two files on this pass.
- Pulling leftover filters / merge / Overview / dispatcher / CSV flatten / Receiver-Agent ranking / Lead Message writes into this file.
- Teaching this file `concreteScopes` / `database_scope: "combined"` so it can add the two collections itself.
- Pointing Wave B `GET /api/v1/admin/analytics/receiver-agent-performance` or `GET /api/v1/admin/lead-messages` at this file, or pointing the SMS report route past the leftover dispatcher.
- Pointing the ranking at leftover `bookedLeadPrefix` so “every booked rate shares book date.”
- Adding a `booked_leads` `$lookup` so “booked means the same as Receiver.”
- Counting each successful text instead of each Lead, or `$sort`ing origin so “one origin wins.”
- `$match`ing message `sent_at` so “the cohort is when we texted.”
- Seeding leftover `LEAD_MESSAGE_ORIGINS` so “Public form and Granot always appear.”
- Returning `{ items: [] }` on a live empty cohort so “empty looks like historical.”
- Treating leftover Receiver-Agent ranking, leftover Agent Sales, leftover Lead Cost, leftover Source Company funnel, leftover place ranking, already-recommended Lead Message writes, leftover Overview last-week by-source, or already-recommended RingCentral analytics reconcile as this story.
- Writing a whole-folder recommendation for `analytics`.
