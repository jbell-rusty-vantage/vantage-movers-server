# Unit A — Daily window contract, capability projection, and Overview

> **Contract maturity: implementation-ready.** This is the foundation unit. It establishes the `activity_at` window contract, the per-pane capability projection, the cursor conventions, and the Overview tab. Every other unit in this pack depends on it. It is read-only and adds no mutation.

## 1. Authority and required reading

- **Specification:** [`owner-daily-operations-view-specification.md`](../../granot-lead-lifecycle/owner-daily-operations-view-specification.md) — challenges 0.1 and 0.3, §1, §3.1–3.5, §6.1–6.3, §8. The specification wins on every conflict.
- **Wireframes (illustrative only):** `vantage-admin/uxdocs/owner-daily-view-planned.txt` §1, §2, §10.
- **Admin orientation:** `vantage-admin/uxdocs/HANDOFF-owner-daily-view.md`.
- **Repository conventions:** `.cursor/rules/project-organization.mdc` — routes stay thin, logic lives in `src/services/<domain>/`.
- **Patterns to reuse, not reinvent:** `src/services/granotLifecycle/projections.ts` (cursor encode/decode, `maskContactLabel`, `assertProjectionSafe`), `src/routes/granot-lifecycle-admin.routes.ts` (router shape, actor gating, error envelope), `src/services/analytics/overview.service.ts` (parallel section assembly).

## 2. Objective

Deliver the Daily View shell and its Overview tab. Establish the single source of truth for the 24h/48h window, the Florida-time display contract, the 10-minute "super recent" sub-window, the per-pane capability states, and the list cursor convention that Units B, C, E, F, and G all consume. Ship the Overview tab rendering the NEEDS YOU band, the window totals band, and two live columns that are static on first paint (Unit C makes them live).

## 3. Repository, branch, and prerequisites

- **Repositories/branches:** `vantage-main-server` and `vantage-admin`, both on the new sprint branch (proposed `owner-daily-operations`), created after the Granot Lead Lifecycle sprint closes.
- **Prerequisite:** Granot Units 22–25 landed. This unit reads their flags and case counts; it does not depend on them being enabled.
- Build the server contract first. Admin consumes exported, tested DTOs. Admin types are never the semantic authority.
- Ordinary checks use redacted synthetic data. Runtime reads require `TEST_MODE=true` and an explicit test database.
- No commit, push, deploy, production flag change, production index apply, live payload read, or external send.
- Preserve unrelated and user changes in both repositories.

## 4. Current-state evidence to verify

Observed 2026-08-19; reverify at implementation:

- `src/services/ownerDaily/` does not exist. `src/routes/owner-daily-admin.routes.ts` does not exist.
- `granot-lifecycle-admin.routes.ts` is mounted **after** the `/api/v1` guard inside `v1.routes.ts`. Mount the new router the same way, adjacent to it.
- `projections.ts` already exports `maskContactLabel`, `paginateTimeline`, `compareTimelineEntries`, `assertProjectionSafe`, `JOB_PROJECTION_FORBIDDEN_KEYS`, and the opaque `{ sort_value, id }` list cursor. Reuse them; do not write a second cursor implementation.
- `projectGranotLifecycleHealth()` already returns `flags: Record<GRANOT_LIFECYCLE_FLAG_NAMES, boolean>`. The capability projection derives from this, not from `process.env`.
- `form_leads` and `call_leads` carry `timestamp`; `booked_leads` carries both `timestamp` and `book_date`; `cancelled_leads` carries `createdAt` and `cancel_date`. **No collection currently has a bare descending time index suitable for an unqualified window scan.**
- Denormalized label snapshots exist and must be used instead of `$lookup`: `source_company_label_snapshot`, `source_granularity_label_snapshot`, `receiver_agent_name_snapshot`, `agent_name_snapshot`.
- `vantage-admin` is Next.js 16 / React 19 / TanStack Query. Browser traffic reaches the server only through `app/api/proxy/[...path]/route.ts`, which buffers JSON.
- `vantage-admin/lib/floridaTime.ts` exists with `FLORIDA_TIME_ZONE = "America/New_York"`.
- `server/auth/authorization.ts` has `OWNER_ONLY_PAGE_PREFIXES` and `canProxyVantagePath`. Neither mentions `/daily`.

## 5. Locked decisions and invariants at risk

- **`activity_at` binds every window, never a business date.** Specification §3.2 is the binding table. A Booking with `book_date` two weeks ago and `timestamp` now **must** appear in the 24h pane. This is the single most consequential rule in the pack.
- **The window is rolling — DECIDED 2026-08-19.** 24h or 48h back from `now`, not a Florida calendar day. Display renders in Florida time; the bound is a rolling instant. **Do not add a business-day mode, a "Today" mode, or any third mode.** Specification challenge 0.3 records the reasoning; comparable day-over-day numbers are an analytics concern and already live in `/analytics`, `/`, and the agent sales report.
- **`/daily` does not replace `/` — DECIDED 2026-08-19.** `/` stays `HomeOverview` (waiting intakes + this-week pulse; not Daily View). Daily View is a new sidebar entry above Form Leads. Daily View work does not rewrite `/`.
- **The window toggle is global and lives in the URL.** Every tab, count, and shared link agree.
- **No `$lookup` on any Daily View hot path.** Labels come from snapshots.
- **Capability, never an empty table.** Every pane resolves to `available`, `not_activated`, or `not_built` and renders the reason. An empty table is indistinguishable from a broken one.
- **Owner-only on every method**, enforced independently in the Admin BFF and on the server.
- This unit is read-only. It creates no aggregate mutation, Command, Change, revision, outbox entry, case, or notification.

## 6. Deliverables and exact contract

### 6.1 `src/services/ownerDaily/window.ts`

```ts
export type DailyWindowMode = "24h" | "48h";

export type DailyWindow = {
  mode: DailyWindowMode;
  from: Date;              // now - 24h or now - 48h
  to: Date;                // now
  super_recent_from: Date; // now - 10m
  timezone: "America/New_York";
};

export function resolveDailyWindow(
  mode: DailyWindowMode,
  now?: Date,
): DailyWindow;
```

`now` is injectable so tests are deterministic. Every list response echoes:

```ts
window: {
  mode: DailyWindowMode;
  from: string;            // ISO
  to: string;              // ISO
  timezone: "America/New_York";
  activity_field: string;  // e.g. "timestamp", "book_date is NOT the bound"
}
```

`activity_field` is required on every response so a screenshot is self-describing and a reviewer can see which field bounded the pane.

### 6.2 `src/services/ownerDaily/capabilities.ts`

```ts
export type DailyPaneCapability =
  | { state: "available" }
  | { state: "not_activated"; flag: string; reason: string }
  | { state: "not_built"; unit: string; reason: string };

export type DailyCapabilities = {
  form_leads: DailyPaneCapability;
  call_leads: DailyPaneCapability;
  completed_bookings: DailyPaneCapability;
  completed_cancellations: DailyPaneCapability;
  booking_intakes: DailyPaneCapability;
  cancellation_intakes: DailyPaneCapability;
  granot_events: DailyPaneCapability;
  conversations: DailyPaneCapability;
  agents: DailyPaneCapability;
};

export async function projectDailyCapabilities(): Promise<DailyCapabilities>;
```

Derivation rules, exact:

| Pane | Rule at this unit |
| --- | --- |
| `form_leads`, `call_leads`, `completed_bookings`, `completed_cancellations`, `agents` | always `available` |
| `granot_events` | `available` when lifecycle processing is on; otherwise `not_activated` naming the processing flag |
| `booking_intakes` | `available` when `GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED`; otherwise `not_activated` with that exact flag name |
| `cancellation_intakes` | `not_built`, `unit: "Granot Unit 26"` — until Release Reconciliation exists |
| `conversations` | `not_built`, `unit: "ODV-D"` — Unit D flips it to `available` |

Flags are read through `projectGranotLifecycleHealth()` / `src/config/domain/granotLifecycle.ts`. **Never read `process.env` directly here.**

### 6.3 Routes

New focused router `src/routes/owner-daily-admin.routes.ts`, mounted after the `/api/v1` guard, adjacent to the Granot lifecycle router. Routes stay policy-free.

```text
GET /api/v1/admin/owner-daily/capabilities
GET /api/v1/admin/owner-daily/overview        ?window=24h|48h
```

Both are **Owner-only**: `requireRegistryOwnerActor`, not the read actor. Response envelope `{ ok: true, data }`. Error envelope matches `granot-lifecycle-admin.routes.ts` `sendError` exactly, including the Zod issue shape.

Validation lives in `src/validation/v1/ownerDaily.validation.ts`. Unknown keys reject. `window` defaults to `24h`.

### 6.4 Overview payload

```ts
export type DailyOverviewResponse = {
  window: DailyWindowEcho;
  generated_at: string;
  capabilities: DailyCapabilities;

  needs_you: {
    booking_intakes: { open: number; oldest_opened_at: string | null };
    cancellation_intakes: { open: number; oldest_opened_at: string | null };
    failed_conversations: { count: number };
    last_resolved_at: string | null;   // powers the "all clear" collapsed band
  };

  totals: {
    form_leads: { count: number; booked: number; booked_rate: number };
    call_leads: { count: number; booked: number; booked_rate: number };
    bookings: { count: number; deposit_total: number; binder_total: number; average_deposit: number };
    cancellations: { count: number; refund_total: number };
  };

  super_recent: {
    leads: DailyOverviewCard[];        // <= 10, activity_at desc
    granot_events: DailyOverviewCard[];// <= 10, activity_at desc
  };
};

export type DailyOverviewCard = {
  id: string;              // "<kind>:<mongo id>"
  kind: string;
  event_at: string;
  headline: string;
  masked_label: string;    // maskContactLabel — never an unmasked contact
  job_no: string | null;
  href: string | null;
  badges: string[];
};
```

`DailyOverviewCard` is intentionally the same shape Unit C will name `DailyFeedEvent`. **Define it once, in `src/services/ownerDaily/types.ts`, and have Unit C import it** rather than declaring a parallel type.

### 6.5 Mongo retrieval

One `$facet` pipeline per collection, all four executed with `Promise.all`. Specification §3.4 carries the pipeline shape. Requirements:

- The `$match` on `activity_at` is always first and always indexed.
- `super_recent` is a `$facet` branch on the same pipeline, not a second query.
- Every projected field is explicitly named. No `$$ROOT`, no unbounded document projection.
- Cancellations join their Booking only for `job_no` and customer label; if that requires a lookup, denormalize at read time in the service by a second bounded `$in` query, not by `$lookup` in the pipeline.

### 6.6 Admin

| Path | Deliverable |
| --- | --- |
| `app/(dashboard)/daily/page.tsx` | Route, reads `?tab` and `?window` from URL |
| `app/(dashboard)/daily/layout.tsx` | Owner guard |
| `components/daily/daily-shell.tsx` | Header, global window toggle, tab bar with action-only badges, live-indicator slot (inert until Unit C) |
| `components/daily/overview-tab.tsx` | NEEDS YOU band, totals band, two static recent columns |
| `components/daily/pane-capability.tsx` | Shared `not_activated` / `not_built` renderer |
| `components/daily/window-toggle.tsx` | URL-backed 24h/48h control |
| `lib/api/ownerDaily.ts` | Typed fetchers |
| `lib/query/keys.ts` | New `queryKeys.ownerDaily.*` namespace keyed by `{ window, tab, filters }` |

Authorization, both files:

- `server/auth/authorization.ts` — add `/daily` to `OWNER_ONLY_PAGE_PREFIXES`.
- `canProxyVantagePath` — add `/api/v1/admin/owner-daily` as Owner-only for **all** methods, not only mutations.

The NEEDS YOU band **collapses to a single line when empty; it never disappears.** An absent band reads as a bug.

## 7. Explicitly out of scope

- Live polling, the feed endpoint, `useDailyFeed`, and the live indicator's active states — Unit C. Render the indicator slot as `○ Live off`.
- Leads, Bookings, Cancellations tabs and the detail drawer — Unit B.
- `LeadConversation`, transcripts, audio — Units D and E.
- Agent metrics — Unit F.
- Intake tab bodies — Unit G. This unit ships only their capability states.
- Any change to Granot flags, activation, or write paths.
- Any business-day, calendar-day, or "Today" window mode. `resolveDailyWindow` takes exactly `"24h" | "48h"`.
- Any change to `/` or `HomeOverview`.

## 8. Flags and runtime posture

- **No new flag.** The Daily View is gated by Owner authorization, not by a feature flag.
- Granot lifecycle flags are **read only** and unchanged. Checked-in effect flags stay false.
- Overview must render correctly with every Granot effect flag false — that is the expected day-one posture, and it is a test, not a caveat.

## 9. Migration and indexes

New `scripts/migrations/owner-daily-indexes.ts`, run as `pnpm migration:owner-daily:indexes`, following `scripts/migrations/granot-lifecycle-indexes.ts` exactly: **collision report first, explicit authorized apply second, never implicit `autoIndex`.**

| Collection | Index | Purpose |
| --- | --- | --- |
| `form_leads` | `{ timestamp: -1, _id: -1 }` | Window scan + stable cursor |
| `call_leads` | `{ timestamp: -1, _id: -1 }` | Window scan + stable cursor |
| `booked_leads` | `{ timestamp: -1, _id: -1 }` | Completed Bookings window |
| `cancelled_leads` | `{ createdAt: -1, _id: -1 }` | Completed Cancellations window |

All four are non-unique and additive. Report on the test database first. **No production apply is authorized by this issue.**

## 10. Acceptance criteria

- [ ] `resolveDailyWindow("24h", fixedNow)` returns exactly `now - 24h` to `now`, with `super_recent_from` at `now - 10m`.
- [ ] A `BookedLead` with `book_date` 14 days ago and `timestamp` 1 hour ago **appears** in the 24h overview totals. A `BookedLead` with `book_date` today and `timestamp` 5 days ago **does not**.
- [ ] Every list and overview response carries a `window` echo including `activity_field`.
- [ ] With `GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED` false, `capabilities.booking_intakes` is `not_activated` naming that exact flag, and the Admin pane renders the reason — **not** an empty table.
- [ ] `capabilities.cancellation_intakes` is `not_built` naming Granot Unit 26.
- [ ] `capabilities.conversations` is `not_built` naming ODV-D.
- [ ] Overview returns in one HTTP request; the server issues at most four aggregate round trips plus bounded label resolution.
- [ ] No Daily View pipeline contains `$lookup`.
- [ ] Every `super_recent` card carries `masked_label` from `maskContactLabel`; **no unmasked phone, email, or full name appears in any Overview response.**
- [ ] A non-Owner admin session receives 403 from the server **and** is blocked by `canProxyVantagePath`, proven independently.
- [ ] `/daily` is unreachable for a non-Owner via `canAccessDashboardPath`.
- [ ] The NEEDS YOU band renders a collapsed "nothing open" line when all counts are zero.
- [ ] Overview renders correctly with every Granot effect flag false.
- [ ] No Command, `EntityChange`, revision transition, outbox row, case, or notification is produced by any request in this unit.

## 11. Required tests and commands

```bash
pnpm test
pnpm typecheck
pnpm migration:owner-daily:indexes            # report mode only
cd ../vantage-admin && pnpm test && pnpm typecheck && pnpm build
```

Focused tests:

- `src/services/ownerDaily/window.test.ts` — injected `now`, both modes, super-recent boundary, DST transition across the Florida display boundary.
- `src/services/ownerDaily/capabilities.test.ts` — each flag combination maps to the exact declared state.
- `src/services/ownerDaily/overview.service.test.ts` — the `book_date` vs `timestamp` acceptance case is a named test, not an assertion buried in a fixture.
- `src/routes/owner-daily-admin.routes.test.ts` — Owner-only gating, validation rejection of unknown keys, error envelope parity with the Granot router.
- Admin: window toggle URL round-trip, capability renderer for all three states.

Zero-mutation proof: run the overview and capability endpoints against a seeded test database and assert `domain_command_executions`, `entity_changes`, and `granot_booking_reconciliation_cases` counts are unchanged.

## 12. Live/staging verification

Preview deploy of both repositories against `TEST_MODE` with the test database. Verify: the window toggle changes counts and the URL; the NEEDS YOU collapsed state; a `not_activated` pane renders its flag name; a `not_built` pane renders its unit. Capture the deployment ids in the completion report.

**No production deploy, no production index apply, no live payload read.**

## 13. Rollback

Remove the Admin `/daily` route and the sidebar entry first — that removes all reachability. Then unmount `owner-daily-admin.routes.ts`. The four indexes are additive and non-unique; leave them, they cost nothing and harm nothing. No data was written, so there is nothing to reverse.

## 14. Required completion handoff

Report: files added; the four index definitions and their collision-report output; test and typecheck output for both repositories; preview deployment ids; explicit confirmation that no Granot flag changed and no mutation occurred; and the `activity_at` acceptance case output verbatim.

**Unblocks:** ODV-B, ODV-C, ODV-D, ODV-F, and the Booking Reconciliation half of ODV-G.
