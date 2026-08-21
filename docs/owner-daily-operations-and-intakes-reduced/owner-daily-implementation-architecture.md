---
type: Reference
title: Owner Daily Operations (Reduced) — implementation architecture for ODR-35/36/37
description: The code-level blueprint for the three-issue reduced pack. Corrects the pack's current-state evidence against the repository as it reads on 2026-08-21, fixes the server DTOs to the models that actually exist, and specifies the Admin layering — providers, hooks, copy module, presentational components — that this feature establishes as the pattern for the rest of vantage-admin.
tags:
  - granot
  - owner-dashboard
  - vantage-admin
  - architecture
status: draft
stale_after: 2026-11-19
generated:
  by: claude-opus-5
  at: 2026-08-21T00:00:00Z
sources:
  - id: reduced-spec
    resource: ./owner-daily-reduced-specification.md
  - id: odr-35
    resource: ./issues/ODR-35.md
  - id: odr-36
    resource: ./issues/ODR-36.md
  - id: odr-37
    resource: ./issues/ODR-37.md
  - id: owner-copy
    resource: ./owner-daily-owner-copy.md
owners: [team:main-server, team:vantage-admin]
applies_to:
  - src/services/ownerDaily/**
  - src/routes/owner-daily-admin.routes.ts
  - vantage-admin/app/(dashboard)/daily/**
  - vantage-admin/lib/daily/**
  - vantage-admin/components/daily/**
---

# Owner Daily Operations (Reduced) — implementation architecture

## 0. What this document is

The reduced specification is the **contract**. The three issues are the **work
orders**. This document is the **blueprint**: the exact modules, signatures,
providers, and hooks, checked against the repository as it reads on
**2026-08-21**.

It does three things:

1. **§1 corrects the pack.** Eleven of the issues' "current-state evidence"
   bullets are now stale or wrong. Some of them would produce broken code if
   followed literally. Fix the issue files before starting.
2. **§2–§4 specify the server** against the models that actually exist.
3. **§5–§9 specify the Admin layering.** This is the part the team asked to
   generalize. `/daily` is the reference implementation of the pattern that the
   rest of `vantage-admin` gets refactored onto.

Owner-visible English is **not in this document**. It lives in
[`owner-daily-owner-copy.md`](./owner-daily-owner-copy.md), and §6 of this
document explains why that separation is architectural rather than editorial.

---

## 1. Current-state corrections

Verified against the working tree on 2026-08-21. Each row is a statement in the
pack that is now false, what is actually true, and what breaks if it is not
fixed.

### 1.1 Blocking — these produce wrong code

| # | Pack says | Repository says | Consequence |
| - | --- | --- | --- |
| C1 | ODR-35 §4: `OWNER_ONLY_PAGE_PREFIXES = ["/audit-log", "/settings", "/bookings/reconciliation", "/ingestion/granot"]` | `server/auth/authorization.ts:4` already includes `"/intakes"` | Cosmetic on its own, but it is the tell that the whole §4 block predates the Intakes work. Re-verify every bullet. |
| C2 | ODR-37 §4/§5: "Granot **Unit 27** (release owner commands) is **blocked**. Release case detail is therefore read-only … `resolvable` is `false` for every release row." | Unit 27 landed. `releaseOwnerCommands.ts`, `releaseReconciliation.ts` (`confirmCancellation`, `updateExistingBooking`, `noAction`), routes at `/api/v1/admin/granot-lifecycle/release-cases/:id/{confirm-cancellation,update-booking,no-action}`, and `components/granot-lifecycle/release-owner-actions.tsx` all exist. | A hardcoded `resolvable: false` for release would lie to the Owner and would need unwinding. **Derive `resolvable` from the health flags** — see §3.5. |
| C3 | Reduced spec §6.4 and ODR-35 §9: Completed Cancellations bind on `createdAt`; index `{ createdAt: -1, _id: -1 }`. | `models/CancelledLead.ts:10` — `timestamp: { type: Date, required: true, default: Date.now }` exists, exactly like the other three collections. | Binding on `createdAt` forks the `activity_at` rule for one pane with no reason. **Use `timestamp`.** Index `{ timestamp: -1, _id: -1 }`. |
| C4 | ODR-35 §6.6: "Cancellations need their Booking only for `job_no` and the customer label … do it as a second bounded `$in` query." | `CancelledLead` already carries `job_no`, `customer_name`, `merchant`, `source`, `book_date`, `agent`, `refund_amount`, `reason`, `cancelled_by`. | The join is unnecessary. Delete that requirement; the cancellation pane is a single-collection scan. |
| C5 | ODR-36 §6.2: `DailyBookingRow.merchant_label`, and "labels come from `source_company_label_snapshot`". | `models/BookedLead.ts` has **no** top-level `source_company_label_snapshot`. It has `source: String`, `merchant: String`, and `employee_source_snapshot.*` (populated only for employee bookings). | Reading `source_company_label_snapshot` off a booking returns `undefined` for every non-employee booking. Use `merchant` and `source` directly; they are already denormalized strings. |
| C6 | ODR-36 §6.1: `DailyLeadRow.ref_no` for both kinds. | `ref_no` is on `FormLead` only. `CallLead` has `job_no` / `normalized_job_no`, `duration_seconds`, `start_time`, `ringcentral.*`. | `ref_no` must be `null` for call leads and the column header must not promise it. See copy deck §5.3. |
| C7 | ODR-37 §9: "**None expected.** The feed's seven predicates are covered by the four ODR-35 window indexes plus … Units 02–04, 07." | `GranotObservationReceipt` indexes `{ route_event_class: 1, captured_at: -1 }` and `{ "processing.state": 1, "processing.next_attempt_at": 1, captured_at: 1 }` — **no bare `{ captured_at: -1, _id: -1 }`**. `SynchronizationDecision` indexes `{ outcome: 1, decided_at: -1 }` and two others — **no bare `{ decided_at: -1, _id: -1 }`**. | A 3-second poll doing two collection scans. ODR-37's own acceptance criterion ("`explain()` shows an index scan") will fail. **Two more indexes are required** — §4.2. |
| C8 | Reduced spec §8 and ODR-37 §6.4: intake rows hand off to `/ingestion/granot/lifecycle/cases/:id?return=/daily?tab=intakes`. | `/intakes` **already exists** as the Owner-facing booking/cancellation workbench: `app/(dashboard)/intakes/`, `components/intakes/{intakes-dashboard,intake-list,intake-copy}.tsx`, in-place case view at `/intakes?case=<id>`, with `intakeCaseHref()` as the canonical link builder. | Handing off to the *technical* lifecycle page sends the Owner to a page written for engineers, and creates two Owner intake surfaces with two vocabularies. **Hand off to `intakeCaseHref(caseId)` → `/intakes?case=<id>`.** §5.7. |
| C9 | ODR-36 §6.7 and §5: "`<JobTimeline page={…} />` … `grep` confirms no second timeline renderer was added under `components/daily/`." | `components/granot-lifecycle/job-timeline.tsx:17–53` renders `Observation`, `Decision`, `Record Link change`, `Entity Change`, `revision 3 → 4`, and a raw Mongo id per row. | This is the correct component for `/ingestion/granot`. It is the **wrong** component for a non-engineer. The rule that must not be broken is "**one provenance projection**", not "one renderer". See §5.6 — a second *renderer* over the same `GranotTimelinePage` is required, and it is the highest-value UI in the pack. |

### 1.2 Non-blocking — worth knowing

| # | Note |
| - | --- |
| C10 | **Granot Unit 29 (discrepancies) landed.** `discrepancyProjections.ts`, `discrepancyOwnerCommands.ts`, routes under `/granot-lifecycle/discrepancies`, and `components/granot-lifecycle/discrepancy-{queue,list,detail}.tsx` exist. The pack excludes discrepancy *panes* — keep that. But "records where Granot and Vantage disagree" is squarely a thing the Owner needs to know about. **Recommendation:** one NEEDS-YOU line reading from `projectGranotLifecycleHealth().open_discrepancies` (already in the health DTO, zero new server work) linking to the existing page. Not a tab. Copy deck §5.2. |
| C11 | **`assertProjectionSafe` is key-name based**, not value based (`projections.ts:1927–1973`). `customer_name`, `phone_number`, and `email` are **not** in `JOB_PROJECTION_FORBIDDEN_KEYS`. So `ownerDaily` may call it freely without touching it — but it will **not** catch an unmasked phone in a list payload. The "no unmasked contact in a list" acceptance criterion needs its own guard: §3.6. |
| C12 | **`maskContactLabel` precedence is name → phone → email** (`projections.ts:1430–1446`). Calling it with a contact that has a name returns `R•••` — a masked *name*, rendered next to the full name the §2.3 deviation puts in the same row. Useless, and it looks like a bug. **Always call it with `{ phone_number, email }` and no `name`** on Daily list DTOs. §3.6. |
| C13 | `vantage-admin` runs **React Compiler** (`next.config.ts: reactCompiler: true`). Do not hand-write `useMemo`/`useCallback` for render performance. Do keep `useMemo` where the value is a **query-key input** or crosses a context boundary — identity there is correctness, not optimization. |
| C14 | The Admin test runner globs `"{lib,server,tests}/**/*.test.ts"` (`package.json`). A `*.test.ts` under `components/` **will not run**. All Daily pure logic must live under `lib/daily/` to be testable; component tests go in `tests/daily-*.test.ts` alongside the existing `tests/intakes-components.test.ts`. §8. |
| C15 | `QueryProvider` defaults are `staleTime: 30_000, refetchOnWindowFocus: false` (`lib/query/client.tsx`). The feed's 3-second interval must set its own `staleTime: 0`; the 30s default would otherwise suppress most polls. |

---

## 2. Server — module map

`src/services/ownerDaily/`, per `project-organization.mdc` (routes thin, logic
in the domain folder).

| File | Owns | Issue |
| --- | --- | --- |
| `window.ts` | `resolveDailyWindow(mode, now?)` — the only place a Daily window is computed | ODR-35 |
| `types.ts` | `DailyWindowEcho`, `DailyFeedEvent`, `DailyPaneCapability`, `DailyCapabilities`, row types | ODR-35 |
| `capabilities.ts` | `projectDailyCapabilities()` — derived from `projectGranotLifecycleHealth()`, never `process.env` | ODR-35 |
| `safety.ts` | `assertOwnerDailyListSafe()` — the list-payload contact guard (§3.6) | ODR-35 |
| `overview.service.ts` | The Summary tab in one round | ODR-35 |
| `leads.service.ts` | Windowed Form/Call lead list | ODR-36 |
| `completed.service.ts` | Windowed Completed Bookings and Cancellations | ODR-36 |
| `detail.service.ts` | Drawer entity snapshot + provenance **pointer** | ODR-36 |
| `intakes.service.ts` | Window/capability adapter over `listGranotLifecycleCases` | ODR-37 |
| `feed.service.ts` | `since`-watermark merge | ODR-37 |
| `index.ts` | Barrel | ODR-35 |

`src/routes/owner-daily-admin.routes.ts` — one focused router, mounted in
`v1.routes.ts` immediately after `router.use(granotLifecycleAdminRoutes)`
(`v1.routes.ts:265`), i.e. **after** the `/api/v1` guard at `:263`.

Follow `granot-lifecycle-admin.routes.ts` exactly:

- `createOwnerDailyAdminRouter(deps: OwnerDailyAdminRouteDeps = {})` with every
  service injectable, so route tests need no database. This is the pattern that
  makes `granot-lifecycle-admin.routes.test.ts` cheap; copy it.
- `await connect()` then `requireRegistryOwnerActor(req, auth(req))` — the
  **Owner** actor on every route including GET, not `requireRegistryReadActor`.
- `res.json({ ok: true, data })`.
- A local `sendError(res, error, requestId(req))` with the identical `ZodError`
  branch (`{ ok: false, code, error, request_id, issues: [{ path, message }] }`).
  Reuse `GRANOT_LIFECYCLE_ERROR_CODES.VALIDATION_FAILED` /
  `.OWNER_REQUIRED` rather than minting a parallel code table.

Validation: `src/validation/v1/ownerDaily.validation.ts`, `.strict()` on every
schema, `window` defaulting to `"24h"`.

---

## 3. Server — corrected contracts

Only the deltas from the issue files are given. Everything not mentioned stands.

### 3.1 `window.ts`

Unchanged from ODR-35 §6.1. One function, injectable `now`, three modes,
`super_recent_from = now - 10m`, `timezone: "America/New_York"`.

The DST test named in ODR-35 §11 is a **display** test, not a window test —
`resolveDailyWindow` does arithmetic on instants and is DST-immune by
construction. Assert that explicitly rather than testing something that cannot
fail; the real DST risk is in `formatDateTime` (`components/data-table/formatters.ts`,
already `timeZone: "America/New_York"`).

### 3.2 The `activity_at` table, corrected

| Pane | Collection | `activity_at` | Also displayed |
| --- | --- | --- | --- |
| Form Leads | `form_leads` | `timestamp` | `createdAt`, `ref_no` |
| Call Leads | `call_leads` | `timestamp` | `start_time`, `duration_seconds` |
| Completed Bookings | `booked_leads` | `timestamp` | **`book_date`** |
| Completed Cancellations | `cancelled_leads` | **`timestamp`** *(was `createdAt` — C3)* | **`cancel_date`** |
| Waiting-on-you (both kinds) | reconciliation cases | `last_evidence_at`, open rows unbounded | `opened_at` |
| Granot events | receipts / decisions | `captured_at` / `decided_at` | — |

### 3.3 `leads.service.ts` — corrected row

```ts
export type DailyLeadRow = {
  id: string;                          // "form_lead:<id>" | "call_lead:<id>"
  kind: "form_lead" | "call_lead";
  activity_at: string;                 // `timestamp` — the bound
  customer_name: string | null;        // FULL — Owner-only surface, reduced spec §2.3
  masked_contact: string;              // maskContactLabel({ phone_number, email }) — NO name (C12)
  source_label: string | null;         // source_company_label_snapshot
  source_granularity_label: string | null;
  job_no: string | null;               // normalized_job_no when present
  ref_no: string | null;               // form leads only — null for call leads (C6)
  receiver_agent_name: string | null;  // receiver_agent_name_snapshot
  booked: boolean;                     // Boolean(doc.booked)
  booking_job_no: string | null;
  status: "open" | "booked" | "bad_lead";
  call: { duration_seconds: number | null; start_time: string | null } | null;
};
```

`status` derivation, exact — the Owner sees three states and no fourth:

```
booked   -> Boolean(doc.booked)
bad_lead -> Boolean(doc.bad_lead?.is_bad_lead)   // FormLead only; CallLead is never bad_lead
open     -> otherwise
```

Both `FormLead` and `CallLead` carry `source_company_label_snapshot`,
`source_granularity_label_snapshot`, and `receiver_agent_name_snapshot` — so the
"no `$lookup`" rule holds for the leads pane with no work. It does **not** hold
for bookings (C5); use `booked_leads.source` and `booked_leads.merchant`.

### 3.4 `completed.service.ts` — corrected rows

```ts
export type DailyBookingRow = {
  id: string;                     // "booking:<id>"
  recorded_at: string;            // `timestamp` — the bound
  book_date: string | null;       // displayed, never bounds
  back_dated_days: number;        // whole days between book_date and recorded_at; 0 when same day
  job_no: string | null;          // normalized_job_no
  customer_name: string | null;
  masked_contact: string;
  agent_labels: string[];         // agent_allocations[].agent_name_snapshot
  binder_amount: number | null;   // total_binder_amount
  deposit_amount: number | null;
  merchant_label: string | null;  // booked_leads.merchant (a string) — C5
  source_label: string | null;    // booked_leads.source (a string) — C5
  is_referral: boolean;           // is_referral_booking
  is_leadless: boolean;           // is_leadless_booking
};

export type DailyCancellationRow = {
  id: string;                     // "cancellation:<id>"
  recorded_at: string;            // `timestamp` — the bound (C3)
  cancel_date: string | null;
  back_dated_days: number;
  job_no: string | null;          // cancelled_leads.job_no, denormalized (C4)
  customer_name: string | null;
  masked_contact: string;
  refund_amount: number | null;
  reason: string | null;
  recorded_by_label: string | null;  // cancelled_by
  booking_id: string | null;         // booked_lead
};
```

`back_dated_days` is computed **server-side**, deliberately. It is what drives
the copy deck's back-dated chip, and computing it in two clients on two date
libraries is how the two panes end up disagreeing about the same row.

`is_referral` / `is_leadless` matter because those are exactly the bookings whose
provenance will honestly be `available: false` (§3.7). Carrying the flag on the
row lets the drawer say *why* before the Owner clicks.

Both list functions return window totals beside the page, as ODR-36 §6.2 says.

### 3.5 `intakes.service.ts` — corrected row and `resolvable`

Make `DailyIntakeRow` a **superset of `GranotLifecycleCaseListItem`**, not a
reshaping of it. This is load-bearing: it is what lets the Admin reuse
`components/intakes/intake-copy.ts` verbatim (§5.7) instead of writing a second
vocabulary for the same cases.

```ts
import type { GranotLifecycleCaseListItem } from "…/projections";

export type DailyIntakeRow = GranotLifecycleCaseListItem & {
  age_seconds: number;    // against window.to, computed server-side
  detail_href: string;    // "/intakes?case=<id>" — C8
  resolvable: boolean;    // see below — C2
};
```

`resolvable` is derived, never hardcoded:

```ts
// src/services/ownerDaily/intakes.service.ts
const flags = health.flags;                       // projectGranotLifecycleHealth()
const resolvable = row.kind === "booking"
  ? flags.GRANOT_LIFECYCLE_BOOKING_COMMANDS_ENABLED
  : flags.GRANOT_LIFECYCLE_RELEASE_COMMANDS_ENABLED;
```

**Day-one posture, stated plainly because it drives the copy:** both command
flags are checked in `false` (`config/domain/granotLifecycle.ts`
`GRANOT_LIFECYCLE_FLAG_DEFAULTS`). So on the day this ships, **every** intake row
is `resolvable: false`. That is not a bug and it is not a permission problem, and
the Owner must not be shown a disabled button that implies either. Copy deck
§5.5 handles it; the acceptance criteria in §9 test it.

The open-cases-unbounded rule from ODR-37 §6.1 stands, including the
`activity_field: "last_evidence_at (open cases unbounded)"` echo. Note that
`listGranotLifecycleCases` bounds on `opened_at` for `opened_from`/`opened_to`
(`projections.ts:511–516`) while sorting on `last_evidence_at` — so the resolved
half must be filtered on `last_evidence_at` **after** the projection returns, or
by passing a window that is correct for `opened_at`. Read `:486–552` before
choosing; the issue says "verify, do not assume", and this is the specific line
it means.

### 3.6 `safety.ts` — the list guard

`assertProjectionSafe` will not catch an unmasked phone (C11). Add a
Daily-specific guard, and apply it to **list** payloads only:

```ts
// src/services/ownerDaily/safety.ts
const OWNER_DAILY_LIST_FORBIDDEN_KEYS = ["phone_number", "email", "normalized_phone_number"] as const;

/** List DTOs carry customer_name in full (reduced spec §2.3) but never raw contact. */
export function assertOwnerDailyListSafe(payload: unknown): void;
```

It runs on every response from `leads`, `completed-bookings`,
`completed-cancellations`, `intakes`, `feed`, and `overview`. It deliberately
does **not** run on `detail`, which is the one endpoint allowed to carry
`contact.phone_number` and `contact.email` unmasked.

And the masking helper, used everywhere a Daily row needs a masked label:

```ts
// Correct — yields "•••4192"
maskContactLabel({ phone_number: doc.phone_number, email: doc.email })

// Wrong — yields "R•••", a masked name printed beside the full name (C12)
maskContactLabel(doc)
```

Make that a named export (`maskDailyContact`) rather than a convention, so the
mistake is not available.

### 3.7 `detail.service.ts` — provenance pointer

As ODR-36 §6.3, with two corrections:

- `cancellation` resolves its job number from **`cancelled_leads.job_no`**
  normalized through `normalizeJobNo` — `CancelledLead` has no
  `normalized_job_no` field. Do not join to the booking for it (C4).
- The `{ available: false }` branch carries a **reason code**, not English:

```ts
provenance:
  | { available: true;  via: "lead"; lead_model: "FormLead" | "CallLead"; lead_id: string }
  | { available: true;  via: "job";  normalized_job_no: string }
  | { available: false; code: "no_job_number" | "referral_booking" | "leadless_booking" | "no_record_link" }
```

Four codes, four different sentences in the copy deck (§5.6). One generic
"No Granot provenance on file" sentence for four genuinely different situations
is the kind of thing that makes an Owner stop trusting a panel.

### 3.8 Routes

```text
GET /api/v1/admin/owner-daily/capabilities                                        ODR-35
GET /api/v1/admin/owner-daily/overview                ?window                     ODR-35
GET /api/v1/admin/owner-daily/leads                   ?window&kind&q&booked&source_id&cursor&limit   ODR-36
GET /api/v1/admin/owner-daily/completed-bookings      ?window&q&cursor&limit      ODR-36
GET /api/v1/admin/owner-daily/completed-cancellations ?window&q&cursor&limit      ODR-36
GET /api/v1/admin/owner-daily/detail/:kind/:id        ?window                     ODR-36
GET /api/v1/admin/owner-daily/intakes                 ?window&kind&state&cursor&limit   ODR-37
GET /api/v1/admin/owner-daily/feed                    ?window&since&limit         ODR-37
```

Admin proxy, `server/auth/authorization.ts` — **two** edits, both Owner-only for
**all** methods:

```ts
const OWNER_ONLY_PAGE_PREFIXES = [
  "/audit-log", "/settings", "/bookings/reconciliation",
  "/ingestion/granot", "/intakes",
  "/daily",                                    // ← ODR-35
] as const;

const OWNER_DAILY_PREFIX = "/api/v1/admin/owner-daily";
// inside canProxyVantagePath, before the `input.method === "GET"` fallthrough:
if (path === OWNER_DAILY_PREFIX || path.startsWith(`${OWNER_DAILY_PREFIX}/`)) {
  return false;                                // owner returned true at the top
}
```

Place the `owner-daily` check **above** the generic `if (input.method === "GET") return true;`
at `authorization.ts:153`. Below it, every GET leaks to Admin. That single
ordering mistake is the whole of the "Owner-only on every method including GET"
requirement, and it is why ODR-35's acceptance criterion asks for the two gates
to be proven **independently**.

---

## 4. Server — indexes

Report-first through `scripts/migrations/owner-daily-indexes.ts`, following
`scripts/migrations/granot-lifecycle-indexes.ts`. Six, not four.

| # | Collection | Index | Why | Issue |
| - | --- | --- | --- | --- |
| 1 | `form_leads` | `{ timestamp: -1, _id: -1 }` | Window scan + stable cursor | ODR-35 |
| 2 | `call_leads` | `{ timestamp: -1, _id: -1 }` | Window scan + stable cursor | ODR-35 |
| 3 | `booked_leads` | `{ timestamp: -1, _id: -1 }` | Completed Bookings window | ODR-35 |
| 4 | `cancelled_leads` | `{ timestamp: -1, _id: -1 }` | Completed Cancellations window — **`timestamp`, not `createdAt`** (C3) | ODR-35 |
| 5 | `granot_webhook_receipts` | `{ captured_at: -1, _id: -1 }` | Feed predicate — not covered by the two compound indexes that lead on other keys (C7) | ODR-37 |
| 6 | `synchronization_decisions` | `{ decided_at: -1, _id: -1 }` | Feed predicate — same reason (C7) | ODR-37 |

All six are non-unique and additive. `cancelled_leads` currently declares **no**
indexes at all beyond `_id` and the inline `index: true` fields — expect a clean
collision report there.

Do **not** add anything to the two reconciliation case collections until the
report proves a gap; Units 22–23 and 26 already declare `last_evidence_at`.

---

## 5. Admin — the architecture that generalizes

This is the section the team asked for. `/daily` is the first place
`vantage-admin` gets a deliberate layering, and it is the pattern the operational
pages get refactored onto.

### 5.1 The five layers

```
app/(dashboard)/daily/            ROUTE      server components, auth, Suspense
  layout.tsx                                 Owner guard (server) + provider mount
  page.tsx                                   Suspense boundary → <DailyShell/>

lib/daily/                        LOGIC      pure + hooks; the only place that fetches
  window.ts            pure       parseWindowMode, formatWindowRange, ageLabel
  feed-merge.ts        pure       mergeDailyFeed(previous, incoming) — testable
  daily-window-context.tsx        DailyWindowProvider + useDailyWindow()
  daily-feed-context.tsx          DailyFeedProvider  + useDailyFeed()
  use-daily-overview.ts           useDailyOverview()
  use-daily-leads.ts              useDailyLeads()
  use-daily-completed.ts          useDailyCompletedBookings/Cancellations()
  use-daily-intakes.ts            useDailyIntakes()
  use-daily-detail.ts             useDailyDetail() + useDailyProvenance()
  use-record-drawer.ts            useRecordDrawer()  — URL-backed

components/daily/                 VIEW       presentational; never fetch
  daily-copy.ts                   ALL owner-visible English
  provenance-story.ts             GranotTimelineEntry → owner sentences
  daily-shell.tsx, window-toggle.tsx, live-indicator.tsx, pane-capability.tsx,
  summary-tab.tsx, leads-tab.tsx, completed-tab.tsx, intakes-tab.tsx,
  record-drawer.tsx, provenance-panel.tsx, needs-you-band.tsx, totals-band.tsx

lib/api/ownerDaily.ts             TRANSPORT  typed fetchers, proxy URLs only
lib/query/keys.ts                 CACHE      queryKeys.ownerDaily.*
```

**The four rules that make it a pattern rather than a folder:**

1. **A component in `components/daily/` never imports from `lib/api/`.** It takes
   DTOs as props or calls a hook from `lib/daily/`. Enforced by `grep` in the
   ODR-37 handoff, and it is the same rule that makes the ODV-I SSE swap a
   transport change.
2. **A hook in `lib/daily/` never contains a user-visible string.** It returns
   data and discriminated states. English comes from `daily-copy.ts`.
3. **Pure logic lives in a `.ts` file with no `"use client"`**, so the Node test
   runner can import it (C14).
4. **Shared state is a provider only when more than one sibling subtree needs it
   *and* it has an owner.** Everything else is URL state. §5.3 applies this test
   honestly rather than reaching for context by default.

### 5.2 Route segment

```tsx
// app/(dashboard)/daily/layout.tsx  — server component
// Copy app/(dashboard)/intakes/layout.tsx verbatim; it is already the correct pattern.
export default async function DailyLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const accessToken = getAccessTokenCookie(cookieStore);
  const admin = accessToken ? await getAdminFromAccessToken(accessToken) : null;
  if (!admin) redirect("/login");
  if (admin.role !== "owner") redirect("/");
  return <DailyProviders>{children}</DailyProviders>;   // client boundary
}
```

```tsx
// app/(dashboard)/daily/page.tsx
export default function DailyPage() {
  return (
    <Suspense fallback={<DailyShellSkeleton />}>
      <DailyShell />
    </Suspense>
  );
}
```

The `Suspense` boundary is **required**, not stylistic: `useSearchParams()` in a
Next 16 client component without one opts the whole route into client-side
rendering at build time. The existing `intakes/page.tsx` already does this.

The fallback is `<DailyShellSkeleton />`, not a `<p>Loading…</p>` — the shell is
tall and the layout shift on a board the Owner opens every morning is the kind of
thing he will notice every morning.

`server/auth/routeGuard.ts` + `proxy.ts` already cover reachability once
`/daily` is in `OWNER_ONLY_PAGE_PREFIXES`; the layout guard is the second,
independent gate.

### 5.3 Global context — what actually earns one

Applying rule 4 to each candidate:

| State | Provider? | Why |
| --- | --- | --- |
| **Window mode** | **Yes** — `DailyWindowProvider` | Read by the toggle, the header range, all four tabs, the drawer, and every query key. URL is the source of truth; the provider is the memoized *accessor* so eight components don't each re-parse `useSearchParams()` and each produce a new object identity for a query key. |
| **Live feed** | **Yes** — `DailyFeedProvider` | Three unrelated subtrees consume it (Summary event columns, tab badges, live indicator) and the merged list + watermark is single-owner state. Also the ODV-I seam: one provider to swap. |
| **Drawer target** | **No** | It is `?open=<kind>:<id>` in the URL. `useRecordDrawer()` is a hook over `useSearchParams`, not a provider. Bookmarkable, shareable, survives refresh — a provider would take that away. |
| **Tab** | **No** | `?tab=` in the URL, same reasoning. |
| **List filters** | **No** | `?q=`, `?kind=`, `?booked=`, `?source_id=` in the URL. Reuse `lib/api/url-state.ts`. |
| **Admin role** | **No** | `useDashboardRole()` already exists, and this page is Owner-only at three gates. Do not re-derive it. |
| **Database scope** | **No** | `/daily` is production-only. Do **not** mount `DatabaseScopeProvider` semantics into Daily queries; the historical database has no live board. |

Two providers. That is the whole answer, and the discipline of writing the table
is the transferable part.

```tsx
// app/(dashboard)/daily/daily-providers.tsx
"use client";
export function DailyProviders({ children }: { children: React.ReactNode }) {
  return (
    <DailyWindowProvider>
      <DailyFeedProvider>{children}</DailyFeedProvider>
    </DailyWindowProvider>
  );
}
```

`DailyFeedProvider` nests inside `DailyWindowProvider` because the feed's query
key contains the window mode. The nesting order is a contract, not an accident —
note it in the file.

### 5.4 `DailyWindowProvider`

```ts
export type DailyWindowMode = "12h" | "24h" | "48h";

export type DailyWindowValue = {
  mode: DailyWindowMode;
  setMode: (mode: DailyWindowMode) => void;   // router.replace, preserves every other param
  /** Client-side range for display only. The server echo is authoritative for data. */
  range: { from: Date; to: Date };
  label: string;                              // "Wed Aug 19, 6:12 AM → Thu Aug 20, 6:12 AM (Florida time)"
};

export function useDailyWindow(): DailyWindowValue;   // throws outside the provider
```

Three details that are correctness, not polish:

- **`setMode` uses `router.replace`, not `push`.** Toggling 24h→48h→24h three
  times should not put three entries in the Owner's back stack. `useUrlTableState.update`
  uses `push` (`lib/api/url-state.ts`) — the window toggle is the exception, and
  the exception should be commented.
- **`range` recomputes on mount and on mode change only, not on every render.**
  A rolling `to: new Date()` evaluated during render makes the header text
  change on every keystroke in the search box. Hold it in state, refresh it when
  the feed reports a successful poll.
- **`mode` is parsed defensively.** `?window=business-day` — from an old
  bookmark or a hand-edited URL — resolves to `"24h"`, silently. There is no
  fourth mode and there is no error state for asking for one.

### 5.5 `DailyFeedProvider` — the cache-resident merge

The interesting problem: the endpoint returns a **watermark delta**, but the UI
needs an **accumulated, deduped, stably-ordered list**. TanStack Query v5 has no
`onSuccess` on `useQuery`, and doing the accumulation in a `useEffect` or a
`useRef` puts the list outside the cache, where it is invisible to devtools,
lost on remount, and untestable.

Do the merge **inside `queryFn`**, reading the previous value out of the cache:

```ts
// lib/daily/daily-feed-context.tsx
const queryClient = useQueryClient();
const key = queryKeys.ownerDaily.feed(mode);

const query = useQuery({
  queryKey: key,
  staleTime: 0,                                     // C15 — the 30s default would suppress polls
  refetchIntervalInBackground: false,
  refetchInterval: () => (enabled ? intervalMs : false),
  queryFn: async ({ signal }) => {
    const previous = queryClient.getQueryData<DailyFeedState>(key);
    const page = await fetchDailyFeed({ window: mode, since: previous?.cursor, signal });
    return mergeDailyFeed(previous, page);          // pure, in lib/daily/feed-merge.ts
  },
});
```

```ts
// lib/daily/feed-merge.ts  — pure, no React, unit-tested under `lib/**`
export type DailyFeedState = {
  events: DailyFeedEvent[];   // event_at DESC, id DESC; capped at MAX_FEED_EVENTS
  cursor: string;             // ISO watermark
  counts: { open_booking_intakes: number; open_cancellation_intakes: number };
  seenIds: string[];          // ids in list order, for the 1.5s "new" highlight
};

export const MAX_FEED_EVENTS = 200;

export function mergeDailyFeed(
  previous: DailyFeedState | undefined,
  page: DailyFeedResponse,
): DailyFeedState;
```

`mergeDailyFeed` is where all four ODR-37 acceptance criteria actually live, and
all four are testable without a browser:

1. Keyed on `event.id` — a repeat **replaces in place**, never appends.
2. Existing rows never reorder — merge, then sort by `(event_at DESC, id DESC)`,
   which is stable for unchanged rows because `id` breaks every tie.
3. An empty `page.events` returns the **same `cursor`** and the same `events`
   array identity, so React re-renders nothing in the steady state.
4. The cap truncates the tail, never the head.

Backoff, as a plain function of two observable conditions:

```ts
const intervalMs =
  documentHidden      ? 60_000 :
  idleForOverFiveMin  ? 15_000 :
                         3_000;
```

`documentHidden` from a `visibilitychange` listener; `idleForOverFiveMin` from
the last `pointerdown`/`keydown` timestamp. Both are provider-owned; no component
sees them.

Public value:

```ts
export type DailyFeedValue = {
  events: DailyFeedEvent[];
  counts: { open_booking_intakes: number; open_cancellation_intakes: number };
  status: "live" | "paused" | "reconnecting" | "off";
  lastSuccessAt: number | null;
  newEventIds: ReadonlySet<string>;   // ids first seen in the last ~1.5s
  retry: () => void;
  setEnabled: (enabled: boolean) => void;
};

export function useDailyFeed(): DailyFeedValue;
```

`status` derives from real conditions — `off` when disabled, `paused` when
hidden, `reconnecting` when `query.isError && query.data !== undefined`, `live`
otherwise. Never a value the caller passes in.

**The seam rule, restated precisely because ODR-37 makes it an acceptance
criterion:** `fetchDailyFeed` is imported by exactly one file
(`daily-feed-context.tsx`), and `queryKeys.ownerDaily.feed` is referenced by
exactly one file (the same one). Everything else calls `useDailyFeed()`. ODV-I
then replaces the body of one provider.

**Never blank on failure:** because the merged state lives in the cache and the
`queryFn` only ever *adds*, a failed poll leaves `query.data` intact by
construction. There is no code to write for "keep the last good data" — there is
only code to write for *not* throwing it away, i.e. do not use
`placeholderData: undefined` and do not `reset()` on error.

### 5.6 Provenance — one projection, two renderers

This is C9, and it is the most important UI decision in the pack.

The rule from full spec §0.6 is **"do not build a second provenance chain."**
That is a statement about the *server projection* — do not add a timeline entry
type, do not add a second cursor, do not add a `/history` endpoint. All of that
stands.

It is **not** a statement about the React component. `JobTimeline`
(`components/granot-lifecycle/job-timeline.tsx`) renders:

```
Observation            valid; 0 issue(s)
Decision               matched: granot_priority
Record Link change     established; revision 1
Entity Change          revision 3 → 4
6a761d3d7ceae445794c57bd
```

That is correct and useful on `/ingestion/granot/lifecycle/jobs/:jobNo`, which is
a page for whoever is debugging the pipeline. Putting it in front of a moving
company owner and calling it "the provenance chain he asked for" answers a
different question than the one he asked.

**Therefore:**

- `components/daily/provenance-story.ts` — a **pure** function
  `toProvenanceStory(page: GranotTimelinePage): ProvenanceStory` that maps the
  same `GranotTimelineEntry[]` to owner sentences. No fetching, no server change,
  no new entry type. Every string in it comes from `daily-copy.ts`.
- `components/daily/provenance-panel.tsx` — renders the story, plus a
  one-sentence summary at the top, plus a `<details>` labelled "Technical
  detail" that renders `<JobTimeline page={page} />` **unchanged** for the times
  the Owner forwards a screenshot to us.

That last point is what preserves the intent of the acceptance criterion:
`JobTimeline` is still the only component that renders raw timeline entries, and
`grep` still finds exactly one of it. Amend ODR-36's criterion to:

> `<JobTimeline>` remains the only renderer of raw `GranotTimelineEntry` data.
> `components/daily/provenance-story.ts` maps the same `GranotTimelinePage`
> to owner-facing sentences and is pure; no second server projection, no new
> entry type, no second cursor.

The story mapping and the summary sentence are specified in the copy deck §5.6.

Provenance fetching reuses the existing clients — `fetchGranotLeadTimeline` /
`fetchGranotJobTimeline` in `lib/api/granotLifecycle.ts` are already written and
already unwrap the envelope. Do **not** add lookalikes to `lib/api/ownerDaily.ts`
(ODR-36 §6.8 says this; it is right).

One authorization note: those two GETs are `requireRegistryReadActor` on the
server and Owner/Admin at the proxy. `/daily` reaching them is fine — the Owner
is a superset. No change.

### 5.7 The Intakes tab hands off to `/intakes`, not to the lifecycle page

C8. The concrete consequences:

- `intakes-tab.tsx` imports from `components/intakes/intake-copy.ts` and uses
  `intakeWhyHere`, `intakeWhatVantageHas`, `intakeNextStep`, `intakeActionLabel`,
  `intakeStatusLabel`, `intakeKindFromCase`, `intakeKindLabel`, and
  `intakeCaseHref` **unchanged**. It writes no new sentence about a case. This
  is only possible because `DailyIntakeRow` is a superset of
  `GranotLifecycleCaseListItem` (§3.5) — that is why it is specified that way.
- Row action href is `intakeCaseHref(row.case_id, { tab, state })`, which
  produces `/intakes?case=<id>`.
- `masked_contact_label` is used **as-is** from the projection. The §2.3
  full-name deviation does not extend to case rows; that projection is shared
  with `/intakes` and its masking is not ours to relax.
- **One small, named change to `intake-copy.ts`** so the Owner can get back:

```ts
// components/intakes/intake-copy.ts
const ALLOWED_CASE_RETURN_PREFIXES = ["/intakes", "/daily"] as const;

export function isAllowedIntakeReturn(value: string | undefined | null): value is string {
  if (!value) return false;
  if (value.includes("://") || value.includes("//")) return false;
  return ALLOWED_CASE_RETURN_PREFIXES.some((p) => value === p || value.startsWith(`${p}?`));
}
```

  Same guard, one more prefix, existing tests extended. `GranotLifecycleCasePage`
  already takes `returnTo` and `backLabel` (see `intakes-dashboard.tsx:288–292`),
  so the back-link work is a prop, not a feature.

This deletes ODR-37's requirement to modify
`app/(dashboard)/ingestion/granot/lifecycle/cases/[caseId]/page.tsx` — that page
is no longer on the Owner's path.

### 5.8 `lib/query/keys.ts`

Additive namespace, matching the file's existing shape and its `stableFilters`
helper:

```ts
ownerDaily: {
  all: ["owner-daily"] as const,
  capabilities: () => [...queryKeys.ownerDaily.all, "capabilities"] as const,
  overview: (window: string) =>
    [...queryKeys.ownerDaily.all, "overview", window] as const,
  leads: (window: string, filters?: QueryFilters) =>
    [...queryKeys.ownerDaily.all, "leads", window, stableFilters(filters)] as const,
  completedBookings: (window: string, filters?: QueryFilters) =>
    [...queryKeys.ownerDaily.all, "completed-bookings", window, stableFilters(filters)] as const,
  completedCancellations: (window: string, filters?: QueryFilters) =>
    [...queryKeys.ownerDaily.all, "completed-cancellations", window, stableFilters(filters)] as const,
  intakes: (window: string, filters?: QueryFilters) =>
    [...queryKeys.ownerDaily.all, "intakes", window, stableFilters(filters)] as const,
  detail: (kind: string, id: string) =>
    [...queryKeys.ownerDaily.all, "detail", kind, id] as const,
  feed: (window: string) =>
    [...queryKeys.ownerDaily.all, "feed", window] as const,
},
```

`window` is the **second** segment of every key, so switching 12h/24h/48h is one
clean cache boundary and `queryClient.removeQueries({ queryKey: queryKeys.ownerDaily.all })`
is a complete reset. Note that `queryKeys.ownerDaily` is **isolated from
`queryKeys.granotLifecycle`** — the drawer's provenance query uses the
`granotLifecycle` keys deliberately, so a case command elsewhere in the app
invalidates the chain the Owner is looking at. `lib/query/granotLifecycle.ts`
(`invalidateGranotLifecycleCommandViews`) gains `queryKeys.ownerDaily.intakes`
and `queryKeys.ownerDaily.overview`, so finishing a booking at `/intakes` updates
the Daily badge without a refresh.

`/daily` is read-only, so it invalidates nothing itself. That is the whole
mutation story for this pack.

### 5.9 Hook inventory

| Hook | File | Returns | Notes |
| --- | --- | --- | --- |
| `useDailyWindow()` | `lib/daily/daily-window-context.tsx` | mode, setMode, range, label | Throws outside the provider |
| `useDailyFeed()` | `lib/daily/daily-feed-context.tsx` | events, counts, status, newEventIds, retry, setEnabled | The **only** feed seam |
| `useDailyCapabilities()` | `lib/daily/use-daily-capabilities.ts` | `DailyCapabilities` | `staleTime: 5 * 60_000`; flags don't move |
| `useDailyOverview()` | `lib/daily/use-daily-overview.ts` | overview + `isPending`/`isError` | `useQuery`, window from context |
| `useDailyLeads(filters)` | `lib/daily/use-daily-leads.ts` | `useInfiniteQuery` page + flat rows | `getNextPageParam: (last) => last.next_cursor` |
| `useDailyCompletedBookings(filters)` | `lib/daily/use-daily-completed.ts` | rows + window totals | ditto |
| `useDailyCompletedCancellations(filters)` | `lib/daily/use-daily-completed.ts` | rows + window totals | ditto |
| `useDailyIntakes(filters)` | `lib/daily/use-daily-intakes.ts` | rows, capability, counts | `counts` also arrive on the feed; prefer the feed for badges |
| `useDailyDetail(target)` | `lib/daily/use-daily-detail.ts` | `DailyDetailResponse` | `enabled: Boolean(target)` |
| `useDailyProvenance(pointer)` | `lib/daily/use-daily-detail.ts` | `GranotTimelinePage` | Switches on `pointer.via`; `enabled` only when the Provenance tab is open |
| `useRecordDrawer()` | `lib/daily/use-record-drawer.ts` | `{ target, open, close }` | Parses `?open=<kind>:<id>`; `close()` deletes the param |
| `useDailyFilters()` | `lib/daily/use-daily-filters.ts` | typed URL filters + setters | Thin wrapper over `lib/api/url-state.ts` |

Three deliberate omissions:

- **No `useDailyPolling()`.** Polling is a private detail of `DailyFeedProvider`.
- **No `useDebounce()` in `lib/daily/`.** `components/filters/debounced-search-input.tsx`
  already exists and is already used across the operational pages. Reuse it.
- **No `useDailyTab()`.** `?tab=` is read once in `daily-shell.tsx`. A hook for a
  single call site is indirection, not abstraction.

### 5.10 Rendering and interaction rules

- **Lists are keyed on the DTO `id`** (`"call_lead:<mongo id>"`), never on array
  index. This is what makes the "rows never reorder" criterion hold through a
  refetch.
- **The new-row highlight is CSS**, driven by `newEventIds` — a
  `data-new="true"` attribute and a 1.5s animation. No `setTimeout` per row, and
  it respects `prefers-reduced-motion`.
- **The drawer traps focus and restores it** to the row that opened it on close.
  `Esc` closes and clears `?open=`. `components/ui/side-panel.tsx` currently
  does neither — extending it (`max-w-3xl` → `max-w-4xl`, focus trap, `Esc`) is
  ODR-36 work and benefits every existing consumer.
- **Money is `formatMoney`, timestamps are `formatDateTime`, dates are
  `formatDate`** — all from `components/data-table/formatters.ts`, all already
  Florida-correct. No new date helper. `lib/daily/window.ts` may add `ageLabel`
  only because `components/intakes/intake-list.tsx:19` already has a private copy
  worth de-duplicating.
- **Tables become card rows below the tablet breakpoint** and the drawer becomes
  a full-screen sheet. Wireframe §11.

---

## 6. Why the copy lives in one Admin module

Three properties, in priority order:

1. **One voice.** `intake-copy.ts` already proved this works — `/intakes` reads
   like one person wrote it because one file did. A board assembled from strings
   scattered across nine components will not.
2. **Reviewable without reading code.** The copy deck can be handed to the Owner
   and marked up. Strings inlined in JSX cannot.
3. **The server stays a data plane.** The server emits `code`, `flag`, `state`,
   and numbers. The Admin owns every sentence. This is what makes the same
   endpoints reusable by the MCP server sprint later without dragging a
   dashboard's phrasing into an API.

Applied to the two places the pack currently puts English on the server:

- `DailyPaneCapability` becomes `{ state: "not_activated"; flag: string }` — the
  flag name stays (ODR-35's acceptance criterion needs it) but the `reason`
  sentence moves to `daily-copy.ts`.
- `provenance: { available: false }` carries a `code`, not a `reason` (§3.7).

**The flag-name reconciliation:** ODR-35 requires the exact flag name in the
payload and in the rendered pane. `GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED` is
also meaningless to the Owner. Both are satisfied by rendering the Owner's
sentence as the panel body and the flag name inside a collapsed
`<details>Technical detail</details>` — present in the DOM, present in a
screenshot, absent from what he reads.

---

## 7. Issue-file edit list

Apply before starting. Each is one paragraph.

**ODR-35**
- §4: `/intakes` is already in `OWNER_ONLY_PAGE_PREFIXES` (C1).
- §6.6: delete the cancellation `$in` join requirement (C4).
- §9: `cancelled_leads` index is `{ timestamp: -1, _id: -1 }` (C3).
- §6.3: `DailyPaneCapability` drops `reason`; keeps `flag` / `unit` (§6).
- §11: reframe the DST test as a display test (§3.1).
- Add: `safety.ts` and `assertOwnerDailyListSafe` (§3.6).
- Add: the `authorization.ts` ordering requirement (§3.8).

**ODR-36**
- §5 / §10: amend the `JobTimeline` criterion to the wording in §5.6.
- §6.1: `ref_no` is form-only (C6).
- §6.2: `merchant_label` ← `booked_leads.merchant`; add `source_label`,
  `back_dated_days`, `is_referral`, `is_leadless`; `recorded_at` for
  cancellations is `timestamp` (C3, C5).
- §6.3: `provenance.available: false` carries a `code`, not a `reason` (§3.7).
- Add: `provenance-story.ts` + `provenance-panel.tsx` as deliverables.
- Add: `side-panel.tsx` focus trap / `Esc` / `max-w-4xl` as a deliverable.

**ODR-37**
- §4 / §5 / §6.1 / §10: Unit 27 landed; `resolvable` derives from the command
  flags; both are `false` on day one (C2).
- §6.4 / §10: hand off to `/intakes?case=<id>` via `intakeCaseHref`; reuse
  `intake-copy.ts`; drop the lifecycle-case-page change; add the
  `isAllowedIntakeReturn` prefix change (C8, §5.7).
- §9: two additional indexes are required (C7).
- §6.5: specify the cache-resident merge and `mergeDailyFeed` (§5.5).
- Optional: add the discrepancies NEEDS-YOU line (C10).

---

## 8. Testing placement

**Server** — focused `*.test.ts` beside each service, as the pack says. Route
tests use `createOwnerDailyAdminRouter(deps)` with stubbed services, matching
`granot-lifecycle-admin.routes.test.ts`.

**Admin** — the runner globs `{lib,server,tests}/**/*.test.ts` (C14):

| Test | File |
| --- | --- |
| `mergeDailyFeed` — dedupe, no-reorder, empty-poll idempotence, cap | `lib/daily/feed-merge.test.ts` |
| `parseWindowMode`, `formatWindowRange`, `ageLabel` | `lib/daily/window.test.ts` |
| `toProvenanceStory` — every entry type, empty chain, unknown type | `lib/daily/provenance-story.test.ts` * |
| `queryKeys.ownerDaily.*` shape | `lib/query/keys.test.ts` (extend) |
| Capability renderer, NEEDS-YOU collapsed state, drawer deep link, window URL round-trip | `tests/daily-components.test.ts` |
| `isAllowedIntakeReturn` with `/daily` | `tests/intakes-components.test.ts` (extend) |

\* `provenance-story.ts` is listed under `components/daily/` in §5.1 for
cohesion, but the test glob means it must physically live under `lib/daily/` and
be re-exported. Put it in `lib/daily/provenance-story.ts` and let
`components/daily/provenance-panel.tsx` import from there. Pick the testable
location over the tidy one.

---

## 9. Acceptance criteria added by this document

Beyond what the three issues already list:

- [ ] `cancelled_leads` rows are bounded by `timestamp`. A cancellation with
      `cancel_date` 14 days ago and `timestamp` 1 hour ago appears in the 24h
      pane. Named test.
- [ ] No Daily service reads `source_company_label_snapshot` off `booked_leads`.
- [ ] `maskContactLabel` is never called with a `name` on a Daily list DTO.
      `grep` shows every call site goes through `maskDailyContact`.
- [ ] `assertOwnerDailyListSafe` runs on all six list-shaped responses and
      rejects `phone_number` / `email`; the `detail` response is exempt and
      carries them.
- [ ] With both command flags false, every intake row is `resolvable: false`,
      the Admin renders the "not switched on yet" copy, and **no disabled
      button** is rendered.
- [ ] An intake row's action href is `/intakes?case=<id>`. `grep` shows no
      `/ingestion/granot/lifecycle/cases/` link under `components/daily/`.
- [ ] `components/daily/**` contains no import from `lib/api/`.
- [ ] `lib/daily/**` contains no user-visible English string.
- [ ] `fetchDailyFeed` and `queryKeys.ownerDaily.feed` each have exactly one
      importer.
- [ ] `explain()` on all six new indexes plus the two case-collection predicates
      shows an index scan.
- [ ] The Provenance panel renders owner sentences; `JobTimeline` renders only
      inside the collapsed technical section.
- [ ] `/daily` returns 403 at the proxy for an Admin session on **every** method,
      proven by a test that asserts the `owner-daily` branch is reached before
      the generic `GET → true` fallthrough.
