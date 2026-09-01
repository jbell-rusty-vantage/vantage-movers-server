# ODR-35 — Daily shell, window contract, capabilities, and the Today tab

> **Contract maturity: implementation-ready.** Foundation issue of the reduced pack. It establishes the rolling window, the per-pane capability projection, the shared DTOs, the cursor conventions, the Owner-only authorization, and the Today tab. ODR-36 and ODR-37 both depend on it and can then run in parallel. Read-only; adds no mutation.

## 1. Authority and required reading

- **Reduced specification:** [`owner-daily-reduced-specification.md`](../owner-daily-reduced-specification.md) — §2 (deviations), §4, §6, §8, §10. This is the pack contract.
- **Full specification:** [`owner-daily-operations-view-specification.md`](../../granot-lead-lifecycle/owner-daily-operations-view-specification.md) — challenges 0.1, 0.3, 0.5; §3.1–3.5; §6.1–6.3; §8. Wins on anything the reduced spec does not deviate from.
- **Wireframes (illustrative only, never a contract):** `vantage-admin/uxdocs/owner-daily-view-planned.txt` §1, §2, §10.
- **Repository conventions:** `.cursor/rules/project-organization.mdc` — routes thin, logic in `src/services/<domain>/`.
- **Patterns to reuse, not reinvent:**
  - `src/services/granotLifecycle/projections.ts` — cursor encode/decode, `maskContactLabel`, `assertProjectionSafe`, `projectGranotLifecycleHealth`.
  - `src/routes/granot-lifecycle-admin.routes.ts` — router shape, actor gating, `sendError` envelope.
  - `src/services/analytics/overview.service.ts` — parallel section assembly.

## 2. Objective

Deliver the `/daily` shell and its **Today** tab. Establish the single source of truth for the rolling window, the Florida-time display contract, the 10-minute super-recent sub-window, the per-pane capability states, the shared `DailyFeedEvent` DTO, and the Owner-only authorization on both gates.

At the end of this issue the Owner can open `/daily`, see real counts for the last 12/24/48 hours, see what is waiting on him, and see the four tabs — three of which render an honest "arriving in ODR-36 / ODR-37" state rather than an empty table.

## 3. Repository, branch, and prerequisites

- **Repositories/branches:** `vantage-main-server` and `vantage-admin`, both on the new reduced-pack branch (proposed `owner-daily-reduced`), cut after the Granot Lead Lifecycle sprint closes.
- **Prerequisite:** Granot Units 22–26 landed. This issue reads their flags and case counts; it does not require them enabled.
- Build the server contract first. Admin consumes exported, tested DTOs. Admin types are never the semantic authority.
- Ordinary checks use redacted synthetic data. Runtime reads require `TEST_MODE=true` and an explicit test database.
- No commit, push, deploy, production flag change, production index apply, live payload read, or external send.
- Preserve unrelated and user changes in both repositories.

## 4. Current-state evidence to verify

Observed 2026-08-19 in the repository; **reverify at implementation**.

- `src/services/ownerDaily/` does not exist. `src/routes/owner-daily-admin.routes.ts` does not exist. `vantage-admin/app/(dashboard)/daily/` does not exist.
- `granot-lifecycle-admin.routes.ts` is mounted **after** the `/api/v1` guard inside `v1.routes.ts`. Mount the new router the same way, adjacent to it.
- `projections.ts` already exports `maskContactLabel` (`:1203`), `paginateTimeline` (`:940`), `compareTimelineEntries` (`:965`), `assertProjectionSafe` (`:1493`), `JOB_PROJECTION_FORBIDDEN_KEYS` (`:1452`), and the opaque `{ sort_value, id }` list cursor. **Reuse them; do not write a second cursor implementation.**
- `projectGranotLifecycleHealth()` (`:1308`) returns named boolean flags via `flagsToNamedBooleans` (`:1291`), including `GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED` and `GRANOT_LIFECYCLE_RELEASE_CASES_ENABLED` (`:1301`). The capability projection derives from **this**, never from `process.env`.
- `listGranotLifecycleCases()` (`:420`) accepts `kind: "booking" | "release"` and merges both case collections behind one cursor. ODR-35 calls it only for the NEEDS YOU counts; ODR-37 owns the list.
- `form_leads` and `call_leads` carry `timestamp`; `booked_leads` carries both `timestamp` and `book_date`; `cancelled_leads` carries `createdAt` and `cancel_date`. **No collection currently has a bare descending time index suitable for an unqualified window scan.**
- Denormalized label snapshots exist and must be used instead of `$lookup`: `source_company_label_snapshot`, `source_granularity_label_snapshot`, `receiver_agent_name_snapshot`, `agent_name_snapshot`.
- `vantage-admin` is Next.js 16 / React 19 / TanStack Query. Browser traffic reaches the server only through `app/api/proxy/[...path]/route.ts`, which buffers JSON.
- `vantage-admin/lib/floridaTime.ts` exists with `FLORIDA_TIME_ZONE = "America/New_York"`.
- `server/auth/authorization.ts` has `OWNER_ONLY_PAGE_PREFIXES = ["/audit-log", "/settings", "/bookings/reconciliation", "/ingestion/granot"]` and `canProxyVantagePath`. **Neither mentions `/daily`.**
- `components/layout/dashboard-nav.tsx:36` is the `Form Leads` nav entry. The new Daily entry goes immediately above it.

## 5. Locked decisions and invariants at risk

- **`activity_at` binds every window, never a business date.** Reduced spec §6.4 is the binding table. A Booking with `book_date` two weeks ago and `timestamp` now **must** appear in the 24h pane. This is the single most consequential rule in the pack.
- **The window is rolling and has exactly three positions: `"12h" | "24h" | "48h"`, default `24h`.** Reduced spec §2.1. Display renders in Florida time; the bound is a rolling instant. **Do not add a business-day, calendar-day, or "Today (Florida)" mode.** `resolveDailyWindow` stays one function with one behaviour.
- **`/daily` does not replace `/`.** `/` stays `HomeOverview` (waiting intakes + this-week pulse; not Daily View). New sidebar entry above Form Leads. This pack does not rewrite `/`.
- **The window toggle is global and lives in the URL.** Every tab, count, and shared link agree.
- **Capability, never an empty table.** Every pane resolves to `available`, `not_activated`, or `not_built` and renders the reason.
- **Release Reconciliation are `not_activated` on a flag, not `not_built`.** Granot Unit 26 is complete — reduced spec §2.2. Do not copy the full spec's `not_built` panel for this pane.
- **`DailyFeedEvent` is declared exactly once**, in `src/services/ownerDaily/types.ts`. ODR-37 imports it. A parallel declaration is a review failure, not a style preference — reduced spec §10.
- **The customer name is shown in full on this Owner-only surface; phone and email stay masked.** Reduced spec §2.3. **No masking rule in `granotLifecycle/projections.ts` may be relaxed to achieve this.**
- **No `$lookup` on any Daily View hot path.** Labels come from snapshots.
- **Owner-only on every method**, enforced independently in the Admin BFF and on the server.
- This issue is read-only. It creates no aggregate mutation, Command, Change, revision, outbox entry, case, or notification.

## 6. Deliverables and exact contract

### 6.1 `src/services/ownerDaily/window.ts`

```ts
export type DailyWindowMode = "12h" | "24h" | "48h";

export type DailyWindow = {
  mode: DailyWindowMode;
  from: Date;               // now - 12h | 24h | 48h
  to: Date;                 // now
  super_recent_from: Date;  // now - 10m
  timezone: "America/New_York";
};

export function resolveDailyWindow(
  mode: DailyWindowMode,
  now?: Date,
): DailyWindow;
```

`now` is injectable so tests are deterministic. There is no other place in the codebase that computes a daily window.

### 6.2 `src/services/ownerDaily/types.ts`

Shared DTOs. Both the Overview payload and ODR-37's feed import from here.

```ts
export type DailyWindowEcho = {
  mode: DailyWindowMode;
  from: string;             // ISO
  to: string;               // ISO
  timezone: "America/New_York";
  activity_field: string;   // the field that bounded this pane
};

export type DailyFeedEvent = {
  id: string;               // "<kind>:<mongo id>" — the client keys on this
  kind:
    | "granot_receipt" | "granot_decision"
    | "form_lead" | "call_lead"
    | "booking" | "cancellation"
    | "booking_intake" | "cancellation_intake";
  event_at: string;
  headline: string;
  customer_name: string | null;  // Owner-only surface — reduced spec §2.3
  masked_label: string;          // maskContactLabel — phone/email only
  job_no: string | null;
  href: string | null;           // deep link, "/daily?tab=…&open=<kind>:<id>"
  badges: string[];
};
```

`activity_field` is **required** on every response so a screenshot is self-describing and a reviewer can see which field bounded the pane without reading the service.

### 6.3 `src/services/ownerDaily/capabilities.ts`

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
};

export async function projectDailyCapabilities(): Promise<DailyCapabilities>;
```

Derivation rules, exact:

| Pane | Rule |
| --- | --- |
| `form_leads`, `call_leads`, `completed_bookings`, `completed_cancellations` | always `available` |
| `granot_events` | `available` when lifecycle processing is on; otherwise `not_activated` naming the processing flag |
| `booking_intakes` | `available` when `GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED`; otherwise `not_activated` with that **exact** flag name |
| `cancellation_intakes` | `available` when `GRANOT_LIFECYCLE_RELEASE_CASES_ENABLED`; otherwise `not_activated` with that **exact** flag name |

Flags are read through `projectGranotLifecycleHealth()`. **Never read `process.env` directly here.**

The type deliberately omits `conversations` and `agents`. ODV-D and ODV-F add those keys additively.

### 6.4 Routes

New focused router `src/routes/owner-daily-admin.routes.ts`, mounted after the `/api/v1` guard adjacent to the Granot lifecycle router. Routes stay policy-free.

```text
GET /api/v1/admin/owner-daily/capabilities
GET /api/v1/admin/owner-daily/overview        ?window=12h|24h|48h
```

Both **Owner-only** via `requireRegistryOwnerActor` — not the read actor. Response envelope `{ ok: true, data }`. Error envelope matches `granot-lifecycle-admin.routes.ts` `sendError` exactly, including the Zod issue shape.

Validation lives in `src/validation/v1/ownerDaily.validation.ts`. Unknown keys reject. `window` defaults to `24h`.

### 6.5 Overview payload

```ts
export type DailyOverviewResponse = {
  window: DailyWindowEcho;
  generated_at: string;
  capabilities: DailyCapabilities;

  needs_you: {
    booking_intakes:      { open: number; oldest_opened_at: string | null };
    cancellation_intakes: { open: number; oldest_opened_at: string | null };
    last_resolved_at: string | null;   // powers the "all clear" collapsed band
  };

  totals: {
    form_leads:     { count: number; booked: number; booked_rate: number };
    call_leads:     { count: number; booked: number; booked_rate: number };
    bookings:       { count: number; deposit_total: number; binder_total: number; average_deposit: number };
    cancellations:  { count: number; refund_total: number };
  };

  super_recent: {
    leads:         DailyFeedEvent[];   // <= 10, event_at desc
    granot_events: DailyFeedEvent[];   // <= 10, event_at desc
  };
};
```

`needs_you` intake counts come from `listGranotLifecycleCases({ state: "open", kind })` — one call per kind, or one call and a group-by. When a pane's capability is not `available`, its count is `0` and the Admin renders the capability reason instead of a zero.

There is no `failed_conversations` key. Conversations are cut from this pack — reduced spec §2.4.

### 6.6 Mongo retrieval

One `$facet` pipeline per collection, all four executed with `Promise.all`. Full spec §3.4 carries the pipeline shape. Requirements:

- The `$match` on `activity_at` is always first and always indexed.
- `super_recent` is a `$facet` branch on the same pipeline, **not** a second query.
- Every projected field is explicitly named. No `$$ROOT`, no unbounded projection.
- Cancellations need their Booking only for `job_no` and the customer label. If that needs a join, do it in the service as a second bounded `$in` query — **never** a `$lookup` in the pipeline.

### 6.7 Admin

| Path | Deliverable |
| --- | --- |
| `app/(dashboard)/daily/page.tsx` | Route; reads `?tab` and `?window` from the URL |
| `app/(dashboard)/daily/layout.tsx` | Owner guard |
| `components/daily/daily-shell.tsx` | Header, global window toggle, four tabs with action-only badges, live-indicator slot (inert here) |
| `components/daily/window-toggle.tsx` | URL-backed 12h/24h/48h control |
| `components/daily/pane-capability.tsx` | Shared `not_activated` / `not_built` renderer |
| `components/daily/today-tab.tsx` | NEEDS YOU band, totals band, two static recent columns |
| `components/daily/coming-soon-tab.tsx` | Honest placeholder for Leads / Intakes / Completed, naming the issue that delivers each |
| `lib/api/ownerDaily.ts` | Typed fetchers for the two endpoints |
| `lib/query/keys.ts` | New `queryKeys.ownerDaily.*` namespace keyed by `{ window, tab, filters }` |
| `components/layout/dashboard-nav.tsx` | New "Daily" entry immediately **above** the Form Leads entry |

Authorization, both places in `server/auth/authorization.ts`:

- Add `/daily` to `OWNER_ONLY_PAGE_PREFIXES`.
- Add `/api/v1/admin/owner-daily` to `canProxyVantagePath` as Owner-only for **all** methods, not only mutations.

UI rules that are requirements, not polish:

- The NEEDS YOU band **collapses to a single line when empty; it never disappears.** An absent band reads as a bug; a green line reads as "clear".
- The live-indicator slot renders `○ Live off` in this issue. ODR-37 gives it real states.
- Genuinely empty window renders "Nothing yet in the last 24 hours" with a `[ Switch to 48h ]` action — distinct from a capability panel and distinct from a loading skeleton.

## 7. Explicitly out of scope

- Live polling, the feed endpoint, `useDailyFeed`, the live indicator's active states, and the Intakes tab body — **ODR-37**.
- Leads and Completed tabs, the detail drawer, provenance rendering — **ODR-36**.
- `LeadConversation`, transcripts, audio, the `Conv.` column, a Conversations tab — **ODV-D/E**, cut from this pack.
- Agent metrics — **ODV-F**, cut from this pack.
- Any change to Granot flags, activation, or write paths.
- Any business-day, calendar-day, or "Today" window mode.
- Any change to `/`, `HomeOverview`, or another admin's landing experience.

## 8. Flags and runtime posture

- **No new flag.** The Daily View is gated by Owner authorization, not a feature flag.
- Granot lifecycle flags are **read only** and unchanged. Checked-in effect flags stay false.
- The Today tab must render correctly with **every** Granot effect flag false. That is the expected day-one posture and it is a test, not a caveat.

## 9. Migration and indexes

New `scripts/migrations/owner-daily-indexes.ts`, run as `pnpm migration:owner-daily:indexes`, following `scripts/migrations/granot-lifecycle-indexes.ts` exactly: **collision report first, explicit authorized apply second, never implicit `autoIndex`.**

| Collection | Index | Purpose |
| --- | --- | --- |
| `form_leads` | `{ timestamp: -1, _id: -1 }` | Window scan + stable cursor |
| `call_leads` | `{ timestamp: -1, _id: -1 }` | Window scan + stable cursor |
| `booked_leads` | `{ timestamp: -1, _id: -1 }` | Completed Bookings window |
| `cancelled_leads` | `{ createdAt: -1, _id: -1 }` | Completed Cancellations window |

All four are non-unique and additive. **Before adding anything for the two reconciliation case collections, verify what Granot Units 22–23 and 26 already declared on `last_evidence_at`** — do not duplicate an existing index.

Report on the test database first. **No production apply is authorized by this issue.**

## 10. Acceptance criteria

- [ ] `resolveDailyWindow("12h" | "24h" | "48h", fixedNow)` returns exactly `now - N` to `now`, with `super_recent_from` at `now - 10m`, for all three modes.
- [ ] A `BookedLead` with `book_date` 14 days ago and `timestamp` 1 hour ago **appears** in the 24h overview totals. A `BookedLead` with `book_date` today and `timestamp` 5 days ago **does not**.
- [ ] Every response carries a `window` echo including a correct `activity_field`.
- [ ] With `GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED` false, `capabilities.booking_intakes` is `not_activated` naming that exact flag, and the Admin pane renders the reason — **not** an empty table.
- [ ] With `GRANOT_LIFECYCLE_RELEASE_CASES_ENABLED` false, `capabilities.cancellation_intakes` is `not_activated` naming that exact flag. It is **never** `not_built`.
- [ ] `DailyFeedEvent` is declared in exactly one file. `grep -rn "kind: \"granot_receipt\"" src/` returns one type declaration.
- [ ] Overview returns in one HTTP request; the server issues at most four aggregate round trips plus bounded label and intake-count resolution.
- [ ] No Daily View pipeline contains `$lookup`.
- [ ] Every `super_recent` card carries `masked_label` from `maskContactLabel`. **No unmasked phone or email appears in any Overview response.** `customer_name` may be present and unmasked; that is the §2.3 decision and applies to `ownerDaily` DTOs only.
- [ ] No masking rule in `src/services/granotLifecycle/projections.ts` was changed. `assertProjectionSafe` and `JOB_PROJECTION_FORBIDDEN_KEYS` are byte-identical to their pre-issue state.
- [ ] A non-Owner admin session receives 403 from the server **and** is blocked by `canProxyVantagePath`, proven independently.
- [ ] `/daily` is unreachable for a non-Owner via `canAccessDashboardPath`.
- [ ] The NEEDS YOU band renders a collapsed "nothing open" line when all counts are zero, and does not disappear.
- [ ] The window toggle round-trips through the URL: changing it changes `?window=` and every count on screen.
- [ ] The Today tab renders correctly with every Granot effect flag false.
- [ ] The Leads, Intakes, and Completed tabs render a placeholder naming the delivering issue — not an empty table and not a crash.
- [ ] No Command, `EntityChange`, revision transition, outbox row, case, or notification is produced by any request in this issue.

## 11. Required tests and commands

```bash
pnpm test
pnpm typecheck
pnpm migration:owner-daily:indexes            # report mode only
cd ../vantage-admin && pnpm test && pnpm typecheck && pnpm build
```

Focused tests:

- `src/services/ownerDaily/window.test.ts` — injected `now`, all three modes, super-recent boundary, and a DST transition across the Florida display boundary.
- `src/services/ownerDaily/capabilities.test.ts` — each flag combination maps to the exact declared state, including both intake flags off, one on, both on.
- `src/services/ownerDaily/overview.service.test.ts` — the `book_date` vs `timestamp` case is a **named test**, not an assertion buried in a fixture.
- `src/routes/owner-daily-admin.routes.test.ts` — Owner-only gating, validation rejection of unknown keys, error-envelope parity with the Granot router.
- Admin: window toggle URL round-trip; capability renderer for all three states; NEEDS YOU collapsed state.

Zero-mutation proof: run both endpoints against a seeded test database and assert `domain_command_executions`, `entity_changes`, `granot_booking_reconciliation_cases`, and `granot_release_reconciliation_cases` counts are unchanged.

## 12. Live/staging verification

Preview deploy of both repositories against `TEST_MODE` with the test database. Verify: the toggle changes counts and the URL across all three modes; the NEEDS YOU collapsed state; a `not_activated` pane renders its exact flag name; the sidebar entry sits above Form Leads; a non-Owner cannot reach `/daily`. Capture deployment ids in the completion report.

**No production deploy, no production index apply, no live payload read.**

## 13. Rollback

Remove the Admin `/daily` route and the sidebar entry first — that removes all reachability in one step. Then unmount `owner-daily-admin.routes.ts`. The four indexes are additive and non-unique; leave them, they cost nothing and harm nothing. No data was written, so there is nothing to reverse.

## 14. Required completion handoff

Report: files added; the four index definitions and their collision-report output verbatim; test and typecheck output for both repositories; preview deployment ids; explicit confirmation that no Granot flag changed, no `projections.ts` masking rule changed, and no mutation occurred; and the `activity_at` acceptance case output verbatim.

**Unblocks:** ODR-36 and ODR-37, which may then run in parallel.
