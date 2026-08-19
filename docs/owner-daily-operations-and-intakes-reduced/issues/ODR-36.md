# ODR-36 — Leads and Completed tabs with the provenance drawer

> **Contract maturity: implementation-ready.** The tab where the Owner spends his time and the drawer that answers "how did this record come to exist?". The provenance chain is an **existing, tested server projection rendered through an existing Admin component** — this issue mounts it, it does not build it. Read-only; adds no mutation.

## 1. Authority and required reading

- **Reduced specification:** [`owner-daily-reduced-specification.md`](../owner-daily-reduced-specification.md) — §2.3 (name display), §4, §5 (**the provenance answer**), §6, §8.
- **Full specification:** [`owner-daily-operations-view-specification.md`](../../granot-lead-lifecycle/owner-daily-operations-view-specification.md) — challenges 0.3 and 0.6; §3.2, §3.5; §6.4, §6.6, §6.8.
- **Wireframes (illustrative only):** `vantage-admin/uxdocs/owner-daily-view-planned.txt` §3, §4, §4a, §6, §7, §11.
- **Predecessor:** [`ODR-35.md`](./ODR-35.md) — the window contract, capability projection, `DailyWindowEcho`, cursor conventions, and Owner-only authorization all come from there.
- **Patterns to reuse, not reinvent:**
  - `src/services/granotLifecycle/projections.ts` — `projectGranotLeadTimeline` (`:384`), `projectGranotJob` (`:375`), `paginateTimeline`, `maskContactLabel`, the `{ sort_value, id }` cursor.
  - `vantage-admin/components/granot-lifecycle/job-timeline.tsx` — `<JobTimeline page={…} />`.
  - `vantage-admin/components/ui/side-panel.tsx` — the drawer base.

## 2. Objective

Deliver the **Leads** tab and the **Completed** tab, and the right-side detail drawer that both open, with a Provenance tab rendering the full Granot evidence chain for leads, bookings, and cancellations alike.

At the end of this issue the Owner can scan every lead that arrived in the window, every booking and cancellation recorded in it, click any row, and see the chain — Granot observation → decision → record link → entity change → official booking — that produced it.

## 3. Repository, branch, and prerequisites

- **Repositories/branches:** `vantage-main-server` and `vantage-admin`, both on the reduced-pack branch.
- **Prerequisite:** ODR-35 merged. This issue consumes `resolveDailyWindow`, `DailyWindowEcho`, `DailyCapabilities`, `queryKeys.ownerDaily.*`, and the Owner-only authorization entries. **Do not re-declare any of them.**
- **May run in parallel with ODR-37.** The only shared file is `lib/api/ownerDaily.ts`, extended additively.
- Build the server contract first. Admin consumes exported, tested DTOs.
- Ordinary checks use redacted synthetic data. Runtime reads require `TEST_MODE=true` and an explicit test database.
- No commit, push, deploy, production flag change, production index apply, live payload read, or external send.

## 4. Current-state evidence to verify

Observed 2026-08-19; **reverify at implementation**.

**The provenance chain already exists end to end. This is the single most important fact in this issue.**

- `projectGranotLeadTimeline("FormLead" | "CallLead", leadId, query)` — `projections.ts:384`. Resolves the lead's `GranotRecordLink` rows, builds a timeline per `normalized_job_no`, dedupes on `type:id`, and paginates. Returns `GranotTimelinePage | null`.
- `projectGranotJob(rawJobNo, query)` — `projections.ts:375`. The same page keyed by Job Number.
- Both are **already exposed**:
  - `GET /api/v1/admin/leads/:lead_model/:lead_id/lifecycle` — `granot-lifecycle-admin.routes.ts:266`, gated by `requireRegistryReadActor`.
  - `GET /api/v1/admin/granot-lifecycle/jobs/:normalized_job_no` — same router, `:181`.
- `GranotTimelinePage.current` already carries `record_link`, `booking`, and `cancellation` safe projections — this is the "snapshot display" half of the Owner's request.
- `GranotTimelineEntry` already covers `observation` (10), `priority_effect` (20), `booking_action` (30), `decision` (40), `case` (50), `discrepancy` (60), `record_link_change` (70), `entity_change` (80), `official_booking` (90), `official_cancellation` (100).
- `vantage-admin/components/granot-lifecycle/job-timeline.tsx:55` exports `JobTimeline({ page })` and `:106` exports `GranotJobTimelinePage({ jobNo })`. The first is the reusable one.

Other state to confirm:

- `booked_leads` carries `timestamp`, `book_date`, `normalized_job_no`, `deposit_amount`, `total_binder_amount`, `agent_allocations`, and `agent_name_snapshot`.
- `cancelled_leads` carries `createdAt`, `cancel_date`, and a reference to the Booking it cancelled.
- `maskContactLabel` (`:1203`) returns `F•••` from a name, `•••1234` from a phone, `f•••@domain` from an email — in that precedence order. For §2.3 the list needs the **full name separately**; do not try to coax it out of this helper.
- The four window indexes from ODR-35 are declared. Verify the collision report before relying on them.

## 5. Locked decisions and invariants at risk

- **Do not build a second provenance chain.** Full spec §0.6 is binding. The drawer renders `GranotTimelinePage`. Adding a new timeline entry type, a parallel chain, a second cursor, or a bespoke "history" endpoint is a review failure.
- **`GranotTimelineEntry` is not extended in this pack.** The full spec's `ringcentral_call` and `conversation` entry types exist only to carry conversation evidence, which is cut — reduced spec §2.4.
- **`assertProjectionSafe` and `JOB_PROJECTION_FORBIDDEN_KEYS` are not modified.** The chain keeps its existing masking. The §2.3 name decision applies to `ownerDaily` list and detail DTOs **only**.
- **Two date columns, always.** `Recorded` is `activity_at` and bounds the window. `Book date` / `Cancel date` is what the Owner typed and bounds nothing. Showing both is what makes the §6.4 rule self-evident instead of surprising.
- **`activity_at` binds; a business date never does.** The named regression test from ODR-35 is repeated here against the Completed list, not just the totals.
- **Overlay drawer, not a split pane.** Full spec §6.8. The content is a formatted entity state plus a tall chain; a split pane on a 1440px laptop leaves the list too narrow to scan *and* the detail too narrow to read.
- **The drawer is deep-linked** as `?open=<kind>:<id>` and survives refresh and sharing.
- **Full contact is drawer-only.** The list carries `customer_name` plus a masked phone/email label. The unmasked phone and email appear only in the drawer, only to an Owner.
- **Rows never reorder** on refetch, and the client keys on `id`.
- This issue is read-only. No Command, Change, revision, outbox entry, case, or notification.

## 6. Deliverables and exact contract

### 6.1 `src/services/ownerDaily/leads.service.ts`

```ts
export type DailyLeadRow = {
  id: string;                       // "<form_lead|call_lead>:<mongo id>"
  kind: "form_lead" | "call_lead";
  activity_at: string;              // ISO — the bound
  customer_name: string | null;     // full — Owner-only surface, §2.3
  masked_contact: string;           // maskContactLabel — phone/email
  source_label: string | null;      // source_company_label_snapshot
  source_granularity_label: string | null;
  job_no: string | null;            // normalized_job_no when linked
  ref_no: string | null;            // form leads
  receiver_agent_name: string | null;  // receiver_agent_name_snapshot
  booked: boolean;
  booking_job_no: string | null;
  status: "open" | "booked" | "bad_lead";
  call: { duration_seconds: number | null; direction: string | null } | null;
};

export async function listDailyLeads(input: {
  window: DailyWindow;
  kind?: "form" | "call";
  q?: string;
  booked?: boolean;
  source_id?: string;
  cursor?: string;
  limit: number;
}): Promise<{ items: DailyLeadRow[]; next_cursor: string | null; window: DailyWindowEcho }>;
```

- When `kind` is absent, both collections are queried in parallel and merge-sorted by `(activity_at DESC, _id DESC)` — the same merge shape `listGranotLifecycleCases` already uses for two case collections. **Read that implementation before writing this one.**
- `q` is a server-side search over name, phone, job number, and ref number. Debounced client-side.
- Labels come from the denormalized snapshots. **No `$lookup`.**

### 6.2 `src/services/ownerDaily/completed.service.ts`

```ts
export type DailyBookingRow = {
  id: string;                     // "booking:<mongo id>"
  recorded_at: string;            // ISO — `timestamp`, the bound
  book_date: string | null;       // displayed, never bounds
  job_no: string | null;
  customer_name: string | null;
  masked_contact: string;
  agent_labels: string[];         // from agent_allocations snapshots; "Jacob +1" is a UI concern
  binder_amount: number | null;
  deposit_amount: number | null;
  merchant_label: string | null;
};

export type DailyCancellationRow = {
  id: string;                     // "cancellation:<mongo id>"
  recorded_at: string;            // ISO — `createdAt`, the bound
  cancel_date: string | null;     // displayed, never bounds
  job_no: string | null;
  customer_name: string | null;
  masked_contact: string;
  refund_amount: number | null;
  reason: string | null;
  recorded_by_label: string | null;
  booking_id: string | null;      // the Booking it cancelled
};

export async function listCompletedBookings(input: { … }): Promise<…>;
export async function listCompletedCancellations(input: { … }): Promise<…>;
```

Both return window totals alongside the page so the table footer (`Total in window`) does not require a second request.

### 6.3 `src/services/ownerDaily/detail.service.ts`

Deliberately thin. It returns the entity snapshot and a **pointer** to the provenance; it does not build a chain.

```ts
export type DailyDetailKind = "form_lead" | "call_lead" | "booking" | "cancellation";

export type DailyDetailResponse = {
  kind: DailyDetailKind;
  id: string;
  headline: string;

  contact: {                       // Owner-only, drawer-only
    name: string | null;
    phone_number: string | null;   // UNMASKED — drawer only
    email: string | null;
  };

  fields: Array<{ label: string; value: string; emphasis?: "money" | "warn" }>;

  provenance: 
    | { available: true;  via: "lead"; lead_model: "FormLead" | "CallLead"; lead_id: string }
    | { available: true;  via: "job";  normalized_job_no: string }
    | { available: false; reason: string };

  window: DailyWindowEcho;
};

export async function getDailyDetail(
  kind: DailyDetailKind,
  id: string,
  window: DailyWindow,
): Promise<DailyDetailResponse | null>;
```

Provenance resolution, exact:

| Kind | `provenance` |
| --- | --- |
| `form_lead` / `call_lead` | `via: "lead"` — the Admin then calls `GET /api/v1/admin/leads/:lead_model/:lead_id/lifecycle` |
| `booking` | `via: "job"` on the Booking's `normalized_job_no` |
| `cancellation` | `via: "job"` on the cancelled Booking's `normalized_job_no` |
| any of the above with no `normalized_job_no` and no record link | `{ available: false, reason: "No Granot provenance on file for this record." }` |

**The `available: false` case is a first-class state, not an error.** A leadless booking, a manually entered booking, and a pre-Granot historical record all land here legitimately. Rendering an empty timeline for them would be indistinguishable from a broken chain.

### 6.4 Routes

Added to the existing `src/routes/owner-daily-admin.routes.ts` from ODR-35. Same Owner-only gating, same envelope, same validation module.

```text
GET /api/v1/admin/owner-daily/leads                   ?window&kind=form|call&q&booked&source_id&cursor&limit
GET /api/v1/admin/owner-daily/completed-bookings      ?window&q&cursor&limit
GET /api/v1/admin/owner-daily/completed-cancellations ?window&q&cursor&limit
GET /api/v1/admin/owner-daily/detail/:kind/:id        ?window
```

`:kind` validates against the `DailyDetailKind` union; anything else is a 400, not a 404.

**No new provenance route is added.** The two existing lifecycle routes are the provenance API.

### 6.5 Admin — Leads tab

`components/daily/leads-tab.tsx`.

```text
[ All (68) │ Form (41) │ Call (27) ]
[ Search name, phone, job, ref… ]   [ Booked ▾ ]  [ Source ▾ ]  [ Reset ]
Chips: [ Source: Best Relocation ✕ ]  [ Booked: No ✕ ]

Time   Kind  Name              Source            Job / Ref   Status
6:09   Call  Robert Martinez   Best Relocation   P5562401    ● Booked
6:04   Form  Jenna Torres      Top10 Forms       ref 88213   Open
```

- **Segmented control, not two tables.** The Owner scans one chronological stream and narrows when he has a reason to.
- **The name column is the full name** — reduced spec §2.3, the Owner's own note on the wireframe. Phone and email are masked in the list.
- Server-side debounced search; filters are URL state; infinite scroll on the ODR-35 cursor contract.
- Row click opens the drawer and sets `?open=<kind>:<id>`.
- **No `Conv.` column.** Conversations are cut from this pack.

### 6.6 Admin — Completed tab

`components/daily/completed-tab.tsx`, segmented `Bookings | Cancellations`.

```text
Recorded  Book date  Job       Customer          Agents    Binder   Deposit  Merchant
6:01 AM   Aug 12     P5562014  Carla Hughes      Patrick   $770     $814     Stripe
5:44 AM   Aug 19     P5562444  Chris Adler       Jacob     $1,020   $1,064   Stripe
────────────────────────────────────────────────────────────────────────────────────
Total in window                                            $1,790   $1,878
```

The `Recorded` vs `Book date` split is the entire reason for the `activity_at` rule. A row where they differ by more than a day gets a subtle marker, because that row is the one that would have silently vanished under a `book_date` filter.

`Jacob +1` denotes a multi-agent allocation; the split is shown in the drawer. Merchant and agent **filters** are ODV-B and out of scope — the columns display, they do not filter.

### 6.7 Admin — the drawer

`components/daily/record-drawer.tsx`. Right-side overlay extending `components/ui/side-panel.tsx` from `max-w-3xl` to `max-w-4xl`, with a drag-resize handle persisted to local storage.

Two tabs:

| Tab | Content |
| --- | --- |
| **Details** | `DailyDetailResponse.contact` (full, Owner-only) + the `fields` list, money emphasized |
| **Provenance** | `<JobTimeline page={…} />` fed by the existing lifecycle route named in `provenance`; `[ Load earlier ]` uses the timeline's own `next_cursor` |

- Deep-linked as `?open=call_lead:6a761d3d7ceae445794c57bd`. Refresh reopens it. Click-outside and `Esc` close it and clear the param.
- When `provenance.available` is `false`, the Provenance tab renders the `reason` — never an empty timeline.
- The `current` block of `GranotTimelinePage` (record link, booking, cancellation) renders as a summary header above the chain. That is the "snapshot display" the Owner asked for.
- Below the tablet breakpoint the drawer becomes a full-screen sheet and tables become card rows.

### 6.8 Admin — data layer

Extend, do not fork:

- `lib/api/ownerDaily.ts` — add the four fetchers.
- `lib/api/granotLifecycle.ts` — reuse the existing lead-timeline and job-timeline fetchers if present; add them here, not in `ownerDaily.ts`, if absent.
- `lib/query/keys.ts` — extend `queryKeys.ownerDaily.*` with `leads`, `completedBookings`, `completedCancellations`, `detail`, each keyed by `{ window, filters }`.
- Lists use `useInfiniteQuery` on the ODR-35 cursor contract.

## 7. Explicitly out of scope

- The Intakes tab and the live feed — **ODR-37**.
- The Today tab, window contract, capabilities, authorization — **ODR-35**, already merged.
- Any conversation surface: `LeadConversation`, transcripts, audio, the `Conv.` column, a Conversation drawer tab — **ODV-D/E**, cut.
- Agent metrics — **ODV-F**, cut.
- Merchant and agent **filters** on Completed Bookings — ODV-B. Columns display only.
- Discrepancy panes — Granot Unit 29.
- Any new timeline entry type, any second provenance chain, any change to `granotLifecycle/projections.ts` masking.
- Any write path, Granot flag change, or `/` change.

## 8. Flags and runtime posture

- No new flag.
- Granot lifecycle flags are read only and unchanged.
- Both tabs must render correctly with every Granot effect flag false. In that posture a lead's provenance chain legitimately contains only `observation` and shadow `decision` entries — the drawer must render that as a valid short chain, **not** as an error or an empty state.

## 9. Migration and indexes

**None expected.** The four window indexes landed in ODR-35.

Before adding anything: the drawer's provenance queries run through `projectGranotLeadTimeline` and `projectGranotJob`, which use the record-link and job indexes declared by Granot Units 13, 22–23, and 26. If profiling on the test database shows a missing index, add it to `scripts/migrations/owner-daily-indexes.ts` **report-first**, with the collision report in the completion handoff. Do not add one speculatively.

## 10. Acceptance criteria

- [ ] The Leads tab renders form and call leads in one chronological stream, correctly segmented by All/Form/Call, with counts matching the Today tab totals for the same window.
- [ ] A `BookedLead` with `book_date` 14 days ago and `timestamp` 1 hour ago **appears** in the 24h Completed Bookings list. One with `book_date` today and `timestamp` 5 days ago **does not**.
- [ ] Completed Bookings and Completed Cancellations each render two date columns, and the footer total matches the sum of the rows in the window.
- [ ] Clicking a **lead** row opens the drawer; the Provenance tab renders the chain from `GET /api/v1/admin/leads/:lead_model/:lead_id/lifecycle`.
- [ ] Clicking a **booking** row and a **cancellation** row each render the chain from `GET /api/v1/admin/granot-lifecycle/jobs/:normalized_job_no`.
- [ ] A booking with no `normalized_job_no` renders `provenance.available: false` with its reason — **not** an empty timeline and not an error.
- [ ] The drawer is deep-linked: loading `/daily?tab=leads&open=call_lead:<id>` directly opens it on that record.
- [ ] `<JobTimeline>` is the component rendering every chain. `grep` confirms no second timeline renderer was added under `components/daily/`.
- [ ] `GranotTimelineEntry` is unchanged. `assertProjectionSafe` and `JOB_PROJECTION_FORBIDDEN_KEYS` are byte-identical to their pre-issue state.
- [ ] The Leads list shows the **full customer name** and a **masked** phone/email. An unmasked phone or email appears in the `detail` response only, never in a list response.
- [ ] Search, `booked`, and `source_id` filters are URL state and survive a refresh.
- [ ] Infinite scroll uses the ODR-35 cursor; no second cursor implementation exists in the pack.
- [ ] No Daily View pipeline contains `$lookup`.
- [ ] A non-Owner admin session receives 403 from the server **and** is blocked by `canProxyVantagePath` for all four new endpoints, proven independently.
- [ ] With every Granot effect flag false, a lead drawer renders a short valid chain rather than an error.
- [ ] No Command, `EntityChange`, revision transition, outbox row, case, or notification is produced by any request in this issue.

## 11. Required tests and commands

```bash
pnpm test
pnpm typecheck
cd ../vantage-admin && pnpm test && pnpm typecheck && pnpm build
```

Focused tests:

- `src/services/ownerDaily/leads.service.test.ts` — the two-collection merge preserves `(activity_at DESC, _id DESC)` across a page boundary; a cursor resumed mid-merge does not skip or duplicate a row.
- `src/services/ownerDaily/completed.service.test.ts` — the `book_date` vs `timestamp` case as a **named test**; window totals match the row sum.
- `src/services/ownerDaily/detail.service.test.ts` — all four kinds resolve the correct `provenance` pointer; the no-job-number case returns `available: false`.
- `src/routes/owner-daily-admin.routes.test.ts` — extended: Owner-only gating on the four new routes, `:kind` validation returning 400 for an unknown kind, envelope parity.
- **Masking test:** assert no list response contains a value matching an unmasked phone or email pattern; assert the `detail` response does.
- Admin: drawer deep-link round-trip; `provenance.available: false` renderer; segmented control URL state.

Zero-mutation proof as in ODR-35, extended to the four new endpoints.

## 12. Live/staging verification

Preview deploy of both repositories against `TEST_MODE` with the test database. Verify against seeded synthetic data: a lead whose chain includes an observation, a decision, a record link, and an entity change renders all four in causal order; a booking whose `book_date` precedes the window still appears; a booking with no job number renders the honest no-provenance panel; the drawer survives a refresh. Capture deployment ids.

**No production deploy, no production index apply, no live payload read.**

## 13. Rollback

Remove the two tab components from `daily-shell.tsx` — the tabs revert to the ODR-35 placeholders and all reachability is gone. Then remove the four routes and the three services. Nothing was written and no index was added, so there is nothing to reverse.

## 14. Required completion handoff

Report: files added; test and typecheck output for both repositories; preview deployment ids; the `activity_at` acceptance case output verbatim; a screenshot or serialized page of one lead chain and one booking chain; explicit confirmation that `GranotTimelineEntry`, `assertProjectionSafe`, and `JOB_PROJECTION_FORBIDDEN_KEYS` are unchanged, that no second timeline renderer was added, and that no mutation occurred.

**Unblocks:** nothing in this pack. ODV-B, ODV-E, and ODV-F extend these components later.
