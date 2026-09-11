# Hand The Owner At Most Three Recent Official Booking Job Numbers Newest Book Date First With A Safe Projection And A Named Booked-At Clock — Prefer The Live Job Number Then Normalized, Skip A Row Without A Job Number, Never Copy Contact — Never Paginate, Never Catalog, Never Assemble A Timeline, Never Call Module.Read, Never Invent An Official Booking, Never Mutate, Never Call The Forensic Granot Timeline — operational story

- Status: recommended
- Service: `jobNumberTimeline` (Wave A, visited)
- Pass: 8 of this service — `recent-official-bookings.ts`
- Remaining in this service: none
- Target: `src/services/jobNumberTimeline/recent-official-bookings.ts`
- Knowledge: [`docs/knowledge/services/job-number-timeline.md`](../../../docs/knowledge/services/job-number-timeline.md) (Owner-only typed [Job Number](../../../../CONTEXT.md) chain; a separate Owner-only bounded sample of at most three official [Booking](../../../../CONTEXT.md) Job Numbers — not `module.read`, not a Job Number catalog, dropdown, or paginated list; `GET /api/v1/admin/job-number-timeline/recent-official-bookings` is registered first on the same router; success envelope `{ ok: true, data: { bookings: Array<{ job_no: string; booked_at: string }> } }`; hard cap of 3; newest official Booking `book_date` first (`booked_leads`); safe projection only: `job_no`, `normalized_job_no`, `book_date`, `createdAt`, `timestamp`; no contact; not `GET /api/v1/admin/granot-lifecycle/jobs/:normalized_job_no`). Distinct from leftover HTTP/CLI facade: sibling `module.ts` (`createJobNumberTimelineModule({ loader }).read` — this file **does not import** it; Wave B **asks** this file on the sample path and **asks** `module.read` on the typed Job Number path). Distinct from leftover Mongo hop: already-recommended [job-number-timeline-mongo-evidence-loader.md](job-number-timeline-mongo-evidence-loader.md) (`loadJobNumberTimelineRows` hops one typed Job Number; this file samples three official Bookings and **does not** hop receipts, cancellations, leads, or Sheet Sync). Distinct from leftover v1 emit: already-recommended [job-number-timeline-assemble.md](job-number-timeline-assemble.md) (`assembleJobNumberTimeline` is a pure function over already-loaded rows — this file **does not** emit). Distinct from leftover v2 wrap / clocks / evidence / outcome / attention: already-recommended [job-number-timeline-projector.md](job-number-timeline-projector.md), [job-number-timeline-clocks.md](job-number-timeline-clocks.md), [job-number-timeline-evidence.md](job-number-timeline-evidence.md), [job-number-timeline-outcome.md](job-number-timeline-outcome.md), [job-number-timeline-attention.md](job-number-timeline-attention.md) (those files **read** a typed Job Number page; they do not list three recent Bookings). Distinct from leftover Job Number identity: already-recommended [bookings-booking-identity.md](bookings-booking-identity.md) (this file **does not ask** `normalizeJobNo` / `equivalentNormalizedJobFilter`; it paints the live `job_no` or trimmed `normalized_job_no` as the string the owner will type). Distinct from leftover official Booking write: already-recommended [bookings-booked-lead.md](bookings-booked-lead.md) (this file **reads** `booked_leads`; it does not persist a Booking). Distinct from leftover Admin browse: already-recommended [admin-browse.md](admin-browse.md) (`booked-leads` page + metrics — **not** this sample). Distinct from leftover forensic Granot job page: already-recommended [granot-lifecycle-projections.md](granot-lifecycle-projections.md) (`GranotTimelineEntry` — **does not import** this file; this file **must not** import `projections.ts`). Distinct from leftover Owner-actor gate: already-recommended [operations-registry-trusted-actor.md](operations-registry-trusted-actor.md) (`requireRegistryOwnerActor` sits on the route, not here). CLI `render` / `discover` / `proof` **do not ask** this file. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Job Number](../../../../CONTEXT.md), [Booking](../../../../CONTEXT.md); do not invent glossary copies. `docs/adr/` is absent here — do not invent ADR copies. Knowledge cites an enhancement pack at `docs/job-number-timeline/`; that folder is absent in this checkout — do not invent it. Do not add a Job Number Timeline Service file in this rename.
- Callers: **one runtime import site in `src/` plus the barrel re-export.** Wave B `job-number-timeline-admin.routes.ts` **asks** `listRecentOfficialBookingExamples(createMongoRecentOfficialBookingLister(db))` inside `defaultListRecentOfficialBookings`. The same file also exposes `deps.listRecentOfficialBookings` so route tests can inject the envelope without this **interface**. Barrel `jobNumberTimeline/index.ts` re-exports `listRecentOfficialBookingExamples`, `RECENT_OFFICIAL_BOOKING_EXAMPLE_LIMIT`, and `RecentOfficialBookingExample` — it does **not** re-export `createMongoRecentOfficialBookingLister` (the route imports that from the file). Sibling `module.ts` does **not** **ask** this file. Tests on this **interface**: `recent-official-bookings.test.ts` (cap of three + newest `book_date` first + safe projection omits `customer_name`; skip a blank Job Number; never copy contact; prefer live `job_no` then `normalized_job_no`). Wave B `job-number-timeline-admin.routes.test.ts` (“Owner recent official booking examples return only Job Numbers”; “Admin cannot read recent official booking examples”) **asks** the injected route dep, not this **interface**. `assemble.test.ts` / `module.test.ts` / `evaluators.test.ts` / `v2.test.ts` / `masking.test.ts` do **not** **ask** this **interface**. CLI does **not** import this file. `v1.service.ts` does **not** re-export this file. Not this **interface**: `assembleJobNumberTimeline`, `projectEnhancedPage`, `createJobNumberTimelineModule`, `loadJobNumberTimelineRows`, `evaluateCurrentOutcome`, `evaluateAttention`, leftover `projections.ts`.
- Seams callers need: sample **interface** vs Mongo **adapter** (HTTP binds `createMongoRecentOfficialBookingLister`; tests inject `findBookings`; the story owns filter / projection / sort / limit); sample vs catalog (hard cap of 3, no cursor, no company filter, no dropdown contract); safe projection vs full Booking document (never `customer_name`, phone, deposit, agent allocations); live `job_no` vs `normalized_job_no` (prefer the live string the owner will type; whitespace-only is not an example); sort clocks vs named `booked_at` (`book_date` then `createdAt` for order; `book_date` then `createdAt` then `timestamp` for the painted clock). There is no write **seam**. There is no begin / complete Domain Command **seam**. There is no emit **seam**. There is no loader **port**. There is no redact **seam** — this file never loads contact. Owner-actor lives on the route, not here. Admin displays `{ job_no, booked_at }`; it does not query `booked_leads`.
- Split later (only if the file outgrows one sitting): this ~87-line file is one sitting if you read it as ask `booked_leads` for the newest official Bookings that already store a Job Number — name each surviving row as `job_no` plus `booked_at` — bind Mongo to that sample. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `list.ts` / `booking.ts`. Assemble / projector / Mongo loader stay siblings. `module.read` stays the typed-job HTTP/CLI **seam**. This file stays the sample HTTP **seam**.

`listRecentOfficialBookingExamples` / `createMongoRecentOfficialBookingLister` / `RECENT_OFFICIAL_BOOKING_EXAMPLE_LIMIT` are executor mechanics. The owner question is: *The owner opened the Job Number timeline desk and has not typed a Job Number yet. Hand them at most three official Booking Job Numbers they can type — newest `book_date` first — and the booked-at clock for each. Do not list the company. Do not paginate. Do not include contact. A Booking without a Job Number is not an example. Prefer the live `job_no`; if that is blank, use trimmed `normalized_job_no`. `booked_at` is `book_date`, else `createdAt`, else `timestamp`, else empty. This file does not assemble a page. This file does not call `module.read`. This file does not hop receipts, cancellations, leads, or Sheet Sync. This file does not invent an official Booking. This file does not write. This file does not call the forensic Granot timeline.*

Who hops one typed Job Number already lives in already-recommended `mongo-evidence-loader.ts`. Who assembles the owner-facing chain already lives in already-recommended `assemble.ts`. Who **asks** the evidence-loader port already lives in sibling `module.ts`. Who wraps v2, outcome, and attention already live in already-recommended `projector.ts` / `outcome.ts` / `attention.ts`. Who persists an official Booking already lives in already-recommended `bookedLead.service.ts`. Who pages `booked-leads` for Admin already lives in already-recommended `adminBrowse.service.ts`. Do not pull those in.

## What this file actually does

Two “hand the owner three official Booking Job Numbers they can type” stories in one sitting, not “a Booking CRUD service,” and not Assemble The Chain / Hop The Typed Job / Browse Booked Leads:

1. **Hand the owner at most three recent official Booking Job Numbers** — `listRecentOfficialBookingExamples(deps)` **asks** `deps.findBookings` with:
   - Filter `HAS_JOB_NUMBER`: `job_no` or `normalized_job_no` is a non-empty string (`$type: "string", $ne: ""`).
   - Projection `SAFE_PROJECTION`: `job_no`, `normalized_job_no`, `book_date`, `createdAt`, `timestamp` only.
   - Sort `{ book_date: -1, createdAt: -1 }`.
   - Limit `RECENT_OFFICIAL_BOOKING_EXAMPLE_LIMIT` (`3`).
   Then walk the rows and keep at most three survivors: skip a row whose live `job_no` and `normalized_job_no` are both blank after trim; paint `{ job_no, booked_at }` where `job_no` prefers the live string and `booked_at` is the first parseable `book_date` / `createdAt` / `timestamp` as ISO, else `""`. This beat does **not** page. This beat does **not** filter by Source Company or Source Granularity. This beat does **not** copy contact even when a test **adapter** hands `customer_name` / `phone` on the raw row.

2. **Bind `booked_leads` to the sample lister** — `createMongoRecentOfficialBookingLister(db)` is the Mongo **adapter**. It `find` / `project` / `sort` / `limit` / `toArray` on `booked_leads` and returns documents. It does **not** own the filter, the cap, or the painted example. Tests do **not** **ask** this factory; they inject `findBookings`.

There is no third assemble, hop, or catalog operation. `asJobNo` / `asBookedAt` are beats inside story 1. `RecentOfficialBookingLister` is the **port** the story **asks**.

## Organization

Keep one file. This is the screenplay for “ask `booked_leads` for the newest official Bookings that already store a Job Number, name each surviving row, bind Mongo to that sample.” Typed-job emit already lives in already-recommended `assemble.ts`. Typed-job hop already lives in already-recommended `mongo-evidence-loader.ts`. Typed-job HTTP/CLI already lives in sibling `module.ts`. Official Booking write already lives in already-recommended `bookedLead.service.ts`. Admin `booked-leads` browse already lives in already-recommended `adminBrowse.service.ts`. Forensic Granot timeline already lives in already-recommended `projections.ts`. Owner-actor already lives on Wave B `job-number-timeline-admin.routes.ts`. Do not pull those in. Do not invent a `RecentOfficialBookingService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent an emit **adapter** so “the sample can invent `official_booking`.” Do not invent a catalog **adapter** so “the desk can page every Job Number.” Do not invent a CRUD folder so “list gets its own file.”

Do not move `listRecentOfficialBookingExamples` into `mongo-evidence-loader.ts` so “one Mongo module lists Bookings.” Do not move it into `module.read` so “one function owns the desk.” Do not teach Admin to query `booked_leads` so “the desk can paint without the server sample.” Do not import leftover `projections.ts` so “one timeline owns the company.” Do not split `create.ts` / `update.ts` / `delete.ts` / `list.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `listRecentOfficialBookingExamples` | `handTheOwnerAtMostThreeRecentOfficialBookingJobNumbers` | Wave B route **asks** it; tests inject the lister |
| `createMongoRecentOfficialBookingLister` | `bindBookedLeadsToTheOfficialBookingSampleLister` | HTTP binds `{ db }`; tests do not |
| `RECENT_OFFICIAL_BOOKING_EXAMPLE_LIMIT` | `AT_MOST_THREE_RECENT_OFFICIAL_BOOKING_EXAMPLES` | the hard cap is a named policy, not a page size the route may raise |

Keep the old names as one-line aliases until Wave B `job-number-timeline-admin.routes.ts` and the barrel migrate. Do not make callers learn `asJobNo` / `asBookedAt` / `HAS_JOB_NUMBER` / `SAFE_PROJECTION` as the domain language — those stay internal beats. Do **not** put these names onto leftover `v1.service.ts` so “every admin read lives on the barrel.” Do **not** re-export `createMongoRecentOfficialBookingLister` from `jobNumberTimeline/index.ts` so “CLI can bind Mongo through the barrel.” Do **not** add `customer_name` / `phone` / `lead_ref` onto the painted example so “the desk can preview the Booking.” Do **not** add `source_company_id` onto this **interface** so “the sample matches the typed-job company filter” — that would be a catalog.

**No workflow class.** The one type that *does* earn a name is the owner-facing example this file already returns:

```ts
type OfficialBookingExampleForTheOwner = {
  job_no: string
  booked_at: string  // ISO, or "" when no clock parsed
}
```

That is the handoff from “Mongo (or a test **adapter**) handed a safe Booking row” to “the owner can type this Job Number.” Today it is `RecentOfficialBookingExample`. Do **not** add a Mongo `ClientSession` onto `handTheOwnerAtMostThreeRecentOfficialBookingJobNumbers` so “the sample is one snapshot.” Do **not** add `$lookup` so “the sample can show the Lead name.”

Leave `loadJobNumberTimelineRows` on already-recommended `mongo-evidence-loader.ts`. Leave `createJobNumberTimelineModule` on sibling `module.ts`. Leave Owner-actor on the Wave B route.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// recent-official-bookings.ts
// The owner opened the Job Number timeline desk.
// Hand them at most three official Booking Job Numbers they can type.

export const AT_MOST_THREE_RECENT_OFFICIAL_BOOKING_EXAMPLES = 3

export type OfficialBookingExampleForTheOwner = {
  job_no: string
  booked_at: string
}

export type OfficialBookingSampleLister = {
  findBookings(query: {
    filter: Document
    projection: Document
    sort: Document
    limit: number
  }): Promise<Document[]>
}

// ── 1. Hand the owner at most three recent official Booking Job Numbers ─

export async function handTheOwnerAtMostThreeRecentOfficialBookingJobNumbers(
  deps: OfficialBookingSampleLister,
): Promise<OfficialBookingExampleForTheOwner[]> {
  const rows = await deps.findBookings({
    filter: aBookingThatAlreadyStoresAJobNumber(),
    projection: onlyJobNumberAndBookingClocks(),
    sort: newestBookDateThenCreatedAt(),
    limit: AT_MOST_THREE_RECENT_OFFICIAL_BOOKING_EXAMPLES,
  })

  const examples: OfficialBookingExampleForTheOwner[] = []
  for (const row of rows) {
    if (examples.length >= AT_MOST_THREE_RECENT_OFFICIAL_BOOKING_EXAMPLES) break
    const job_no = preferTheLiveJobNumberThenNormalized(row)
    if (!job_no) continue
    examples.push({ job_no, booked_at: nameTheBookedAtClock(row) })
  }
  return examples
}

function aBookingThatAlreadyStoresAJobNumber()
function onlyJobNumberAndBookingClocks()
function newestBookDateThenCreatedAt()
function preferTheLiveJobNumberThenNormalized(row): string | undefined
function nameTheBookedAtClock(row): string   // book_date → createdAt → timestamp → ""

// ── 2. Bind booked_leads to the sample lister ─────────────────────────

export function bindBookedLeadsToTheOfficialBookingSampleLister(
  db: Db,
): OfficialBookingSampleLister {
  return {
    async findBookings({ filter, projection, sort, limit }) {
      return db
        .collection("booked_leads")
        .find(filter)
        .project(projection)
        .sort(sort)
        .limit(limit)
        .toArray()
    },
  }
}

export const listRecentOfficialBookingExamples =
  handTheOwnerAtMostThreeRecentOfficialBookingJobNumbers
export const createMongoRecentOfficialBookingLister =
  bindBookedLeadsToTheOfficialBookingSampleLister
export const RECENT_OFFICIAL_BOOKING_EXAMPLE_LIMIT =
  AT_MOST_THREE_RECENT_OFFICIAL_BOOKING_EXAMPLES
```

Read the sample path out loud: *Ask booked_leads for Bookings that already store a Job Number. Project only the Job Number fields and the three booking clocks. Sort newest book_date, then createdAt. Take three. Skip a row whose live job_no and normalized_job_no are both blank after trim. Prefer the live job_no. Name booked_at from book_date, else createdAt, else timestamp. Never copy contact. Bind Mongo only as the adapter that runs that find.*

That is the operation. `listRecentOfficialBookingExamples` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Sort clock and named `booked_at` can disagree.** Sort is `book_date` then `createdAt`. `nameTheBookedAtClock` also falls back to `timestamp`. A row whose only clock is `timestamp` sorts as if it has no clock, then paints a `timestamp` `booked_at`. Either include `timestamp` in the sort, or stop naming `timestamp` as `booked_at`. Do not silently pick one while renaming.

2. **Empty `booked_at` is a silent miss.** When none of the three clocks parse, the example is still returned with `booked_at: ""`. The owner cannot tell “no clock” from a typed Job Number that has no booking date. Skip the row, or refuse to name it. Do not start inventing `booked_at` from `_id`.

3. **`HAS_JOB_NUMBER` then `preferTheLiveJobNumberThenNormalized` is two filters.** Mongo `$type: "string", $ne: ""` still lets whitespace-only through; the paint beat trims and skips. Tests lock the skip. Keep the beat. Do not drop the trim so “the query already filtered.”

4. **The Mongo adapter is a one-line pass-through** of filter / projection / sort / limit. That is correct — the story owns the query. Do not move `HAS_JOB_NUMBER` / `SAFE_PROJECTION` into the adapter so “Mongo owns the sample.” Do not teach the adapter to paint `{ job_no, booked_at }` so “the port returns examples.”

5. **No company or granularity filter.** The sample is account-wide newest three official Bookings with a Job Number. That is not a catalog and not the typed-job company filter already-recommended `nameThisCompanysGranularityIds` owns. Do not add `source_company_id` here so “the dropdown matches the typed filter.”

6. **This file does not fold Job Number identity.** It paints the live `job_no` or trimmed `normalized_job_no` as the string the owner will type. Do not **ask** sibling `normalize.ts` / already-recommended `bookingIdentity.ts` so “one identity owns the sample” — a typed-job hop key is not this story.

7. **Barrel re-exports the story and the cap, not the Mongo adapter.** Keep it that way so CLI / leftover `v1.service.ts` cannot bind `booked_leads` through the barrel.

8. **Wave B injects `deps.listRecentOfficialBookings`.** Route tests prove Owner `200` / Admin `403` / envelope shape on that dep. Do not move Owner-actor or the `{ ok, data: { bookings } }` envelope into this file so “the sample owns HTTP.”

9. **Leave sibling modules alone.** `loadJobNumberTimelineRows`, `assembleJobNumberTimeline`, `createJobNumberTimelineModule`, `browseBookedLeads` are already the right **depth**. This file does not orchestrate them.

10. **Do not silently invent a fourth example, a cursor, or a contact field while renaming.** Knowledge already stamps “not a catalog” and “no contact.” Do not reorder ADR-known side effects — this file has none; it does not write.

## Testing

The **interface** is the test surface: `handTheOwnerAtMostThreeRecentOfficialBookingJobNumbers` and `bindBookedLeadsToTheOfficialBookingSampleLister` (today `listRecentOfficialBookingExamples` and `createMongoRecentOfficialBookingLister`).

Today’s `recent-official-bookings.test.ts` already names the cap, newest `book_date` first, safe projection, blank-Job skip, and no contact — and it **asks** this **interface**. Keep that. Add the missing clock and adapter proofs onto the same **interface**.

Name the operation:

**Sample**
- Four official Bookings with Job Numbers → three examples, newest `book_date` first. Limit **asked** of the lister is `3`.
- A row whose `job_no` is whitespace and whose `normalized_job_no` is empty is skipped. A row with only `normalized_job_no` is kept under that string.
- A raw row that also has `customer_name` / `phone` still paints only `{ job_no, booked_at }`.
- Projection **asked** of the lister includes `job_no` / `normalized_job_no` / `book_date` and omits `customer_name`.
- Filter **asked** of the lister requires a non-empty string Job Number (`$or` on `job_no` / `normalized_job_no`).

**Clocks**
- `book_date` Date → ISO `booked_at`. Sort key is `book_date: -1`.
- Missing `book_date`, parseable `createdAt` → that ISO.
- Missing `book_date` and `createdAt`, parseable `timestamp` → that ISO (today’s code). Lock the current fallback; do not “fix” sort-vs-paint in the same pass.
- No parseable clock → `booked_at: ""` (today’s code). Lock it until a later pass decides skip-vs-empty.

**Adapter**
- `bindBookedLeadsToTheOfficialBookingSampleLister(db).findBookings(...)` reads `booked_leads` with the filter / projection / sort / limit the story passed. A TEST_MODE replica (or injected `Db`) is enough. Today’s tests never **ask** this factory.

Do **not** add a test per helper (`preferTheLiveJobNumberThenNormalized`, `nameTheBookedAtClock`, `aBookingThatAlreadyStoresAJobNumber`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

`createJobNumberTimelineModule` / `loadJobNumberTimelineRows` / Wave B `deps.listRecentOfficialBookings` are not a second **adapter** on this file. They are sibling **modules** or a route dep. Do not add helper-unit tests for them here. The existing route tests may stay; they are not this **interface**.

## What I would not do

- A `RecentOfficialBookingService` class with `create` / `update` / `delete` / `list`.
- Thirty two-line functions that only wrap `deps.findBookings` or `row.job_no.trim()`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `list.ts`) “for cleanliness.”
- Breaking the sample **port**. HTTP must still bind the Mongo **adapter**; tests must still inject `findBookings`. The story must still own filter / projection / sort / limit.
- Breaking the not-a-catalog **seam**. Hard cap stays 3. No cursor. No company filter. No dropdown contract.
- Breaking the safe-projection **seam**. Never copy contact, deposit, agent allocations, Lead id, or Sheet id.
- Treating leftover `projections.ts` / `GranotTimelineEntry` as this story.
- Treating already-recommended `assemble.ts`, `projector.ts`, `clocks.ts`, `evidence.ts`, `outcome.ts`, `attention.ts`, or `mongo-evidence-loader.ts` as this story.
- Treating already-recommended `bookedLead.service.ts` or `adminBrowse.service.ts` as this story.
- Inventing an emit **seam** that has only these three examples as an **adapter**.
- Inventing a catalog **seam** that has only this hard cap as an **adapter**.
- Silently “fixing” sort-vs-`timestamp`, empty `booked_at`, or adding `source_company_id` while renaming.
- Teaching Admin to query `booked_leads`.
- Teaching `module.read` to return these three examples so “one function owns the desk.”
- Teaching leftover CLI `discover` to list these examples so “discover is a catalog.”
- Jumping to Wave B while listed Wave A row 42 `tariff` is still `unvisited`.
- Writing a whole-folder recommendation for `jobNumberTimeline`.
