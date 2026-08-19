---
type: Specification
title: Owner Daily Operations (Reduced) — /daily, provenance, and intake reconciliation in three issues
description: A deliberately small subset of the Owner Daily Operations View, sized for three issues that ship immediately after the Granot Lead Lifecycle sprint. Four tabs over a rolling window — Today, Leads, Intakes, Completed — with the provenance chain on every record and a cursor-polled live feed. Conversations, agent metrics, and SSE are excluded by design.
tags:
  - granot
  - owner-dashboard
  - reduced-scope
  - delivery
status: draft
stale_after: 2026-11-19
generated:
  by: claude-opus-5
  at: 2026-08-19T00:00:00Z
sources:
  - id: full-spec
    resource: ../granot-lead-lifecycle/owner-daily-operations-view-specification.md
  - id: full-delivery-pack
    resource: ../owner-daily-operations/README.md
  - id: owner-message
    resource: ./message_from_me.md
  - id: wireframes
    resource: ../../../vantage-admin/uxdocs/owner-daily-view-planned.txt
  - id: lifecycle-projections
    resource: ../../src/services/granotLifecycle/projections.ts
  - id: lifecycle-admin-routes
    resource: ../../src/routes/granot-lifecycle-admin.routes.ts
  - id: unit-status
    resource: ../../scripts/prototypes/granot-lead-lifecycle/delivery/UNIT-STATUS.md
owners: [team:main-server, team:vantage-admin]
applies_to:
  - src/services/ownerDaily/**
  - src/routes/owner-daily-admin.routes.ts
  - vantage-admin/app/(dashboard)/daily/**
---

# Owner Daily Operations (Reduced) — specification

## Why this document exists

The full [Owner Daily Operations View specification](../granot-lead-lifecycle/owner-daily-operations-view-specification.md)
is nine units. It is correct and it stays the long-term contract. It is also
too large to sit between the Granot Lead Lifecycle sprint and the AI Agent
control-plane / MCP-server sprints.

This document carves out **three issues** that give the Owner a surface he opens
every morning, shipped in the gap. It is a **strict subset**: every line of code
it authorizes is code the full pack would have written anyway. Nothing here is
throwaway, and nothing here has to be unwound when ODV-D through ODV-I land.

**Authority order.** The full specification wins on every conflict *except* the
four deviations recorded in §2, which are deliberate and are marked as such.

---

## 1. What ships, in one screen

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Daily Operations                        [ 12h │ 24h │ 48h ]   ● Live · 2s ago │
│ Wed Aug 19, 6:12 AM – Thu Aug 20, 6:12 AM  (Florida)                         │
├──────────────────────────────────────────────────────────────────────────────┤
│  Today  │  Leads  │  Intakes ③  │  Completed                                  │
└──────────────────────────────────────────────────────────────────────────────┘
```

Four tabs. One rolling window that binds all of them and lives in the URL.

| Tab | Contents | Provenance |
| --- | --- | --- |
| **Today** | NEEDS YOU band, window totals, live event strip (leads + Granot receipts) | — |
| **Leads** | Form + Call leads in window, one chronological stream | Drawer → full chain |
| **Intakes** | Booking reconciliation **and** Release reconciliation cases, open first | Handoff to existing case detail |
| **Completed** | Completed Bookings + Completed Cancellations in window | Drawer → full chain |

That is the Owner's message, in order: *leads, booking intakes, cancellation
intakes, completed bookings, completed cancellations*, a separate tab for the
intake reconciliations, provenance on the records he cares about, and Granot
receipt polling.

---

## 2. Deviations from the full specification

Four, all deliberate. Everything else is inherited unchanged.

### 2.1 The window toggle gains a 12h position

Full spec §0.3 fixes the window at `24h | 48h` and forbids a third mode. The
prohibition is aimed at a **business-day** mode — a different *semantics* that
would fork `window.ts` into two behaviours. A 12h position is the same rolling
function with a different offset: one more member of a string union, zero extra
query cost, no second code path.

**Decision: `"12h" | "24h" | "48h"`, default `24h`.** This is the Owner's own
instinct in `message_from_me.md`, and 12h is the mode that makes the board read
as *"this shift"* rather than *"yesterday and today"*. §0.3's actual rule —
`window.ts` stays a single function with one behaviour — is preserved.

**Still forbidden:** any calendar-day, business-day, or "Today (Florida)" mode.

### 2.2 Cancellation Intakes ship now, not later

Full spec §0.2 and the ODV pack both gate Cancellation Intakes on Granot Unit 26
and specify a `not_built` panel. **Unit 26 is complete.** Verified in the
repository:

- `src/services/granotLifecycle/releaseReconciliation.ts` exists with focused and
  replica tests.
- `listGranotLifecycleCases()` already accepts `kind: "booking" | "release"`,
  already queries `getGranotReleaseReconciliationCaseModel()`, and already merges
  both collections behind **one** cursor
  (`projections.ts:420` onward).
- `GranotLifecycleCaseListItem` already carries `kind`, `masked_contact_label`,
  `latest_action`, `evidence_count`, `opened_at`, `last_evidence_at`.
- The health projection already exposes `GRANOT_LIFECYCLE_RELEASE_CASES_ENABLED`
  (`projections.ts:1301`).

So the Cancellation Intake half is **capability-gated on a flag, not on a missing
unit**. It renders `not_activated` when the flag is off, exactly like the Booking
half — never `not_built`.

**Consequence:** the Intakes tab ships whole. Release cases are **read-only** —
Granot Unit 27 owns the release owner commands and is still blocked — so a
release row's `[Open →]` lands on the existing read-only case detail.

### 2.3 The customer name is shown unmasked in Owner-only lists

The wireframe carries the Owner's own note: *"Please show the name — he uses it a
lot for determining bookings."* The full spec masks contact in every list.

**Decision:** on `/daily` only, which is Owner-only at both gates, the list DTO
carries `customer_name` in full. **Phone and email stay masked** via the existing
`maskContactLabel`; full contact appears only in the drawer.

**Boundary that must not move:** this applies to the `ownerDaily` list DTOs
*only*. `GranotTimelineEntry`, `projectGranotJob`, `projectGranotLeadTimeline`,
and `assertProjectionSafe` are untouched — the provenance chain keeps its
existing masking. A reviewer should be able to `grep` and confirm no
`granotLifecycle/projections.ts` masking rule was relaxed to satisfy this.

### 2.4 Everything conversation-shaped is cut, not deferred-in-place

The full spec ships a `LeadConversation` model, a redactor, Owner-only read
routes, and one seeded record even with the pipeline deferred (ODV-D/E). **None
of that is in this pack.** No model, no migration, no route, no seed, no
`Conv.` column, no Conversations tab.

Reason: it is the only part of the full spec that carries recurring cost, PCI
exposure, and an unresolved consent question (full spec §7). A pack whose purpose
is *"ship something for the CEO in the gap"* should not be the pack that lands
the first customer transcript in Mongo. ODV-D/E/H remain the authority for that
work, unchanged, and they are additive when their gates clear.

---

## 3. What is explicitly excluded

Named here so no one implements them from the wireframes, and so the estimate is
honest. Each points at the authority that still owns it.

| Excluded | Owned by |
| --- | --- |
| `LeadConversation` model, redactor, conversation read routes, seeding script | ODV-D |
| Conversations tab, drawer conversation panel, audited signed audio URL, the `Conv.` column | ODV-E |
| Automated conversation discovery / transcription / summarization | ODV-H (deferred on §7 gates) |
| Agents tab — `leads_received` / `received_leads_booked` / `booking_credit` | ODV-F |
| SSE transport | ODV-I (optional) |
| Release **owner commands** (cancel, booking update, no-action) | Granot Unit 27 |
| Booking/Release discrepancy panes | Granot Unit 29 |
| Merchant and multi-agent-allocation filters on Completed Bookings | ODV-B |
| Any business-day or calendar-day window | Nothing — permanently rejected, §0.3 |

The Daily View shell must render correctly with all of the above absent. That is
a test in ODR-35, not a caveat.

---

## 4. Inherited without change

These carry over from the full specification verbatim. They are the rules most
likely to be broken by someone reading only this document.

- **`activity_at` binds every window, never an Owner-typed business date**
  (full spec §3.2). A Booking with `book_date` two weeks ago and `timestamp` one
  hour ago **must** appear in the 24h Completed pane. `book_date` and
  `cancel_date` are displayed as columns and never bound anything.
- **Rolling, not calendar.** The window is `now - N` to `now`. Display renders in
  Florida time via the existing `vantage-admin/lib/floridaTime.ts`.
- **`/daily` is its own page.** `/` stays `HomeOverview`, unchanged. New sidebar
  entry above Form Leads.
- **Capability, never an empty table.** Every pane resolves to `available`,
  `not_activated`, or `not_built` and renders the reason.
- **Owner-only at both gates** — Admin BFF *and* server, independently, on every
  method including GET.
- **No `$lookup` on any Daily View hot path.** Labels come from the existing
  denormalized snapshots (`source_company_label_snapshot`,
  `receiver_agent_name_snapshot`, `agent_name_snapshot`).
- **Read-time merge, not an event-sourcing projection** (full spec §0.5).
- **The Daily View is a reader.** In this reduced pack it writes *nothing at all* —
  not even a conversation record. Its only mutations are the ones it hands off to
  existing Granot endpoints by navigation.
- **Migrations are report-first.** Collision report, then explicit authorized
  apply. Never implicit `autoIndex`.

---

## 5. The provenance answer — it is almost entirely free

The Owner asked for a provenance chain on Completed Bookings and Completed
Cancellations, and a provenance/snapshot display on Leads. **The server work for
this is zero.** Verified in the repository:

| Need | Already exists |
| --- | --- |
| Lead provenance | `projectGranotLeadTimeline("FormLead" \| "CallLead", id)` — `projections.ts:384`, exposed at `GET /api/v1/admin/leads/:lead_model/:lead_id/lifecycle` |
| Booking / Cancellation provenance | `projectGranotJob(normalized_job_no)` — `projections.ts:375`, exposed at `GET /api/v1/admin/granot-lifecycle/jobs/:normalized_job_no` |
| Rendering | `vantage-admin/components/granot-lifecycle/job-timeline.tsx` — `<JobTimeline page={…} />` already renders a `GranotTimelinePage` |
| Ordering, cursor, masking | `paginateTimeline`, `compareTimelineEntries`, `assertProjectionSafe` |

`GranotTimelinePage.current` already returns the `record_link`, `booking`, and
`cancellation` safe projections, which is the "snapshot display" half of the
request.

**Therefore:** provenance in this pack is *mounting an existing projection in a
new drawer*. The full spec's two new timeline entry types (`ringcentral_call`,
`conversation`) existed only to carry conversation evidence — cut with §2.4, so
`GranotTimelineEntry` is **not extended** here and `JOB_PROJECTION_FORBIDDEN_KEYS`
is **not touched**.

Bookings and Cancellations reach their chain through `normalized_job_no`. A
record with no `normalized_job_no` — a leadless or non-Granot booking — renders
an honest *"No Granot provenance on file"* panel, not an empty timeline.

---

## 6. Server contract

### 6.1 New domain `src/services/ownerDaily/`

Per `project-organization.mdc`: routes stay thin, logic lives in the service
folder.

| File | Owns | Issue |
| --- | --- | --- |
| `window.ts` | `resolveDailyWindow(mode, now?)` — the only place a window is computed | ODR-35 |
| `capabilities.ts` | Per-pane `available` / `not_activated` / `not_built`, derived from the health projection | ODR-35 |
| `types.ts` | Shared DTOs, including `DailyFeedEvent` used by both Overview and the feed | ODR-35 |
| `overview.service.ts` | The Today tab in one round | ODR-35 |
| `leads.service.ts` | Windowed Form/Call lead list | ODR-36 |
| `completed.service.ts` | Windowed Completed Bookings and Cancellations | ODR-36 |
| `detail.service.ts` | Drawer entity snapshot + provenance pointer | ODR-36 |
| `intakes.service.ts` | Window-bounded, capability-gated adapter over `listGranotLifecycleCases` | ODR-37 |
| `feed.service.ts` | `since`-watermark merge | ODR-37 |
| `index.ts` | Barrel | ODR-35 |

### 6.2 Routes

One new router `src/routes/owner-daily-admin.routes.ts`, mounted after the
`/api/v1` guard adjacent to `granot-lifecycle-admin.routes.ts`. Error envelope
and Zod issue shape match that router's `sendError` exactly.

```text
GET /api/v1/admin/owner-daily/capabilities                                    ODR-35
GET /api/v1/admin/owner-daily/overview                ?window                 ODR-35
GET /api/v1/admin/owner-daily/leads                   ?window&kind&q&booked&source_id&cursor&limit   ODR-36
GET /api/v1/admin/owner-daily/completed-bookings      ?window&q&cursor&limit  ODR-36
GET /api/v1/admin/owner-daily/completed-cancellations ?window&q&cursor&limit  ODR-36
GET /api/v1/admin/owner-daily/detail/:kind/:id                                ODR-36
GET /api/v1/admin/owner-daily/intakes                 ?window&kind&state&cursor&limit   ODR-37
GET /api/v1/admin/owner-daily/feed                    ?window&since&limit     ODR-37
```

All Owner-only via `requireRegistryOwnerActor`. Response envelope
`{ ok: true, data }`. Validation in
`src/validation/v1/ownerDaily.validation.ts`; unknown keys reject; `window`
defaults to `24h`.

**One `/intakes` endpoint, not two.** The underlying projection already takes
`kind`, so a `kind` query parameter is the natural shape and avoids two routes
that would differ only in a constant.

### 6.3 The window echo

Every response — overview, every list, the feed — carries:

```ts
window: {
  mode: "12h" | "24h" | "48h";
  from: string;             // ISO
  to: string;               // ISO
  timezone: "America/New_York";
  activity_field: string;   // the field that actually bounded this pane
}
```

`activity_field` is mandatory so a screenshot is self-describing and a reviewer
can see which field bounded the pane without reading the service.

### 6.4 The `activity_at` table for this pack

| Pane | Collection | `activity_at` | Also displayed |
| --- | --- | --- | --- |
| Form Leads | `form_leads` | `timestamp` | `createdAt`, `ref_no` |
| Call Leads | `call_leads` | `timestamp` | `ringcentral.start_time` |
| Completed Bookings | `booked_leads` | `timestamp` | **`book_date`** |
| Completed Cancellations | `cancelled_leads` | `createdAt` | **`cancel_date`** |
| Booking Intakes | `granot_booking_reconciliation_cases` | `last_evidence_at` | `opened_at` |
| Cancellation Intakes | `granot_release_reconciliation_cases` | `last_evidence_at` | `opened_at` |
| Granot events | receipts / decisions | `captured_at` / `decided_at` | — |

### 6.5 Cursor contract

Reused verbatim from `projections.ts`: opaque base64 over `{ sort_value, id }`,
sorted `activity_at DESC, _id DESC`, ties on `_id`. Every list returns
`{ items, next_cursor, window }`. Admin uses `useInfiniteQuery`. No second cursor
implementation is written anywhere in this pack.

### 6.6 Indexes

Four additive non-unique indexes, report-first through
`scripts/migrations/owner-daily-indexes.ts`:

| Collection | Index |
| --- | --- |
| `form_leads` | `{ timestamp: -1, _id: -1 }` |
| `call_leads` | `{ timestamp: -1, _id: -1 }` |
| `booked_leads` | `{ timestamp: -1, _id: -1 }` |
| `cancelled_leads` | `{ createdAt: -1, _id: -1 }` |

The two reconciliation case collections already index `last_evidence_at` from
Granot Units 22–23 and 26. Verify before adding anything.

---

## 7. Live feed — the Granot receipt polling the Owner asked for

Cursor poll, not SSE. Full spec §4.1 is binding and its reasoning is unchanged:
producers are separate Vercel lambdas, so an in-process `EventEmitter` **cannot**
work in production even though it will appear to work in `next dev`.

`GET /owner-daily/feed?since=<iso>` merges **six** sources in this pack — the
full spec's eight minus conversations, and with both case collections behind the
one existing `listGranotLifecycleCases` call:

```text
granot_observation_receipts   captured_at > since
synchronization_decisions     decided_at   > since
form_leads                    timestamp    > since
call_leads                    timestamp    > since
booked_leads                  timestamp    > since
cancelled_leads               createdAt    > since
reconciliation cases          last_evidence_at > since   (booking + release, one call)
```

Each bounded by the window floor and `limit 50`, run with `Promise.all`,
merge-sorted by `(event_at DESC, id DESC)`, truncated, cursor = newest
`event_at`.

`DailyFeedEvent` is one flat maskable shape, **defined once** in
`ownerDaily/types.ts` in ODR-35 and imported by ODR-37 — not declared twice:

```ts
{
  id: string;            // "<kind>:<mongo id>" — client keys on this
  kind: "granot_receipt" | "granot_decision" | "form_lead" | "call_lead"
      | "booking" | "cancellation" | "booking_intake" | "cancellation_intake";
  event_at: string;
  headline: string;
  customer_name: string | null;   // Owner-only surface, §2.3
  masked_label: string;           // maskContactLabel — phone/email
  job_no: string | null;
  href: string | null;            // deep link into the drawer
  badges: string[];
}
```

**Idempotent by construction.** The client keys on `id`, so a retried poll
replaces rather than appends. Rows never reorder.

Polling posture: `refetchInterval: 3000` focused, `refetchIntervalInBackground:
false`, back off to 15s after five minutes idle and 60s when the document is
hidden. The live indicator states its own condition honestly —
`● Live · 2s ago` / `◌ Paused (background)` / `⚠ Reconnecting…` / `○ Live off`.
Never blank a populated pane because a poll failed: keep the last good data, say
how old it is, offer a retry.

---

## 8. Admin surface

New route group `vantage-admin/app/(dashboard)/daily/`.

| Path | Deliverable | Issue |
| --- | --- | --- |
| `app/(dashboard)/daily/page.tsx` + `layout.tsx` | Route, Owner guard, URL state | ODR-35 |
| `components/daily/daily-shell.tsx` | Header, global window toggle, 4 tabs, action-only badges, live-indicator slot | ODR-35 |
| `components/daily/window-toggle.tsx` | URL-backed 12h/24h/48h | ODR-35 |
| `components/daily/pane-capability.tsx` | Shared `not_activated` / `not_built` renderer | ODR-35 |
| `components/daily/today-tab.tsx` | NEEDS YOU band, totals band, two recent columns | ODR-35 |
| `components/daily/leads-tab.tsx` | Segmented All/Form/Call, server search, infinite scroll | ODR-36 |
| `components/daily/completed-tab.tsx` | Segmented Bookings/Cancellations, two-date columns | ODR-36 |
| `components/daily/record-drawer.tsx` | Right overlay, Details + Provenance tabs, `?open=` deep link | ODR-36 |
| `components/daily/intakes-tab.tsx` | Segmented Booking/Cancellation, handoff to case detail | ODR-37 |
| `lib/api/ownerDaily.ts` | Typed fetchers | ODR-35 → extended |
| `lib/query/keys.ts` | `queryKeys.ownerDaily.*` keyed by `{ window, tab, filters }` | ODR-35 |
| `lib/query/ownerDailyFeed.ts` | `useDailyFeed()` — the single transport seam | ODR-37 |
| `components/layout/dashboard-nav.tsx` | New "Daily" entry **above** Form Leads | ODR-35 |
| `server/auth/authorization.ts` | `/daily` in `OWNER_ONLY_PAGE_PREFIXES`; `/api/v1/admin/owner-daily` Owner-only in `canProxyVantagePath` for **all** methods | ODR-35 |

**URL state is the whole contract:**
`/daily?tab=<tab>&window=12h|24h|48h&open=<kind>:<id>`. Bookmarkable, shareable,
and a clean TanStack Query cache boundary when the window changes.

**Drawer, not split pane** (full spec §6.8). Right-side overlay extending the
existing `components/ui/side-panel.tsx` to `max-w-4xl`. Content is a formatted
entity state plus a tall provenance chain; a split pane on a 1440px laptop leaves
the list too narrow to scan *and* the detail too narrow to read.

**Intakes hand off, they do not embed** (full spec §0.8). `[Open →]` routes to
the existing case detail at
`/ingestion/granot/lifecycle/cases/:id?return=/daily?tab=intakes`. Confirming a
booking is exact-cent data entry with revision guards, an `Idempotency-Key`, and
a draft-preserving `409`. Duplicating that form would fork the concurrency logic
that most needs not to be forked — and the candidate lead search the Owner wanted
already exists there.

---

## 9. Issue ledger

Three issues. Numbered to continue past the Granot ledger's Unit 34, as the Owner
requested.

| Issue | Title | Depends on | Size | Subset of |
| --- | --- | --- | --- | --- |
| [**ODR-35**](issues/ODR-35.md) | Daily shell, window contract, capabilities, and the Today tab | Granot 22–26 landed | Large | ODV-A |
| [**ODR-36**](issues/ODR-36.md) | Leads and Completed tabs with the provenance drawer | ODR-35 | Large | ODV-B |
| [**ODR-37**](issues/ODR-37.md) | Intakes tab (both halves) and the live cursor feed | ODR-35 | Medium–Large | ODV-C + ODV-G |

**ODR-36 and ODR-37 can run in parallel** once ODR-35 lands. They touch disjoint
services and disjoint Admin components; the only shared file is
`lib/api/ownerDaily.ts`, extended additively by each.

**Suggested branch:** `owner-daily-reduced` in both repositories, cut after
`granot-lead-lifecycle` closes.

---

## 10. Forward compatibility with the full pack

This is the test of whether the reduction was done correctly: **can ODV-D through
ODV-I land later without unwinding anything here?**

| Later unit | Lands as | Rework here |
| --- | --- | --- |
| ODV-D/E — conversations | New model, new routes, a fifth tab, a `Conv.` column on the Leads table, a third drawer tab | None. Additive. `capabilities` gains a `conversations` key; the drawer gains a tab. |
| ODV-F — agents | Sixth tab, new service, new route | None. Additive. |
| ODV-G — richer intake filters | Extends `intakes.service.ts` | None. Same endpoint, more query params. |
| ODV-I — SSE | Swaps the transport inside `useDailyFeed()` | None, **provided** every component consumes the hook and nothing consumes the transport. This is an acceptance criterion in ODR-37. |
| Granot Unit 27 — release commands | Release rows gain actions on the existing case detail | None. `/daily` links out; it never embedded the form. |

The two things that would create rework if done wrong, and are therefore called
out as acceptance criteria rather than advice:

1. **`DailyFeedEvent` declared twice** — once in Overview, once in the feed.
   Define it in `ownerDaily/types.ts` in ODR-35; ODR-37 imports it.
2. **A component reaching past `useDailyFeed()` to the fetcher** — that is the
   seam the SSE swap depends on.

---

## 11. Verification standard

Inherited from the Granot pack. Per issue:

- Focused `*.test.ts` alongside each service.
- **The window test is named, not incidental:** a `BookedLead` with `book_date`
  14 days ago and `timestamp` 1 hour ago **appears** in the 24h Completed pane; a
  `BookedLead` with `book_date` today and `timestamp` 5 days ago **does not**.
- **Capability tests:** with each case flag false, the pane returns
  `not_activated` naming that exact flag and never an empty list.
- **Masking tests:** no unmasked phone or email in any list payload; the
  provenance chain's existing masking is unchanged — assert
  `assertProjectionSafe` still rejects what it rejected before.
- **Owner-only tests at both gates, independently:** an Admin-role session is
  refused by `canProxyVantagePath` *and* by the server.
- **Zero-mutation proof:** run every endpoint in the pack against a seeded test
  database and assert `domain_command_executions`, `entity_changes`,
  `granot_booking_reconciliation_cases`, and
  `granot_release_reconciliation_cases` counts are unchanged. This pack writes
  nothing.
- `pnpm test` and `pnpm typecheck` in both repositories;
  `pnpm build` in `vantage-admin`.
- Redacted synthetic fixtures only. No live Granot payload, no unmasked contact
  in fixtures, logs, projections, or issue text.

## 12. Standing prohibitions

- No production deploy, production index apply, production flag change, live
  payload read, or external send is authorized by this specification or by any
  issue in it.
- No Granot lifecycle flag or activation posture changes. Checked-in effect flags
  stay exactly as the lifecycle sprint left them.
- No change to how Leads, Bookings, Cancellations, Booking cases, Release cases,
  or Decisions are **written**.
- No change to `/` or `HomeOverview`.
- No new Booking, Cancellation, Release, or Referral command.
