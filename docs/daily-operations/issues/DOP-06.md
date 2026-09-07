# DOP-06 — Admin chrome, headline, origins, companies, pace

> **Contract maturity: implementation-ready.** Session 4. Owner-only
> `/daily` with the pulse and mix bands live over SSE. **Category
> panels are DOP-07 — this issue may render a temporary single list
> of events so the pipe is visible, but do not ship the board as
> done.**

## 1. Authority and required reading

- **Pack specification:** [`../daily-operations-specification.md`](../daily-operations-specification.md)
  — §3–6, §17.
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md),
  [`../LOCAL-ADMIN.md`](../LOCAL-ADMIN.md)
- **Admin map:** `vantage-admin/.cursor/rules/project-organization.mdc`
- **Pattern:** Live Events BFF `app/api/granot-live-receipts/route.ts`,
  Overview `MetricCard`, `floridaTime`, `SOURCE_COMPANY_LABELS`
- **Glossary:** workspace-root `CONTEXT.md`

## 2. Objective

The Owner (and only the Owner) can open `/daily` after Overview in
the Today group, see today's counts versus yesterday-at-this-hour,
see Ingestion Origin and Source Company mix (zeros visible), and
watch tiles tick from SSE without a page refresh.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-admin` only (except pack-doc drift).
- **Prerequisites:** DOP-04 and DOP-05 `complete` (local API must
  serve snapshot + live).
- 21st.dev allowed only for the **headline tile strip** and **origins
  / company mix** shells. Search first. Do not invent endpoints.
- Verify at http://localhost:3000 ([`LOCAL-ADMIN.md`](../LOCAL-ADMIN.md)).
- No commit, push, deploy, or live payload read unless asked.

## 4. Current-state evidence to verify

Observed 2026-09-06; **reverify before coding.**

- `dashboard-nav.tsx` Today group: Overview, Live Events, Lead
  Conversations, Intakes, Manual. No Daily Operations.
- `OWNER_ONLY_PAGE_PREFIXES` in `server/auth/authorization.ts` and
  `ownerOnlyPagePrefixes` in `dashboard-shell.tsx` do **not** include
  `/daily`. Shell list is already incomplete vs authorization — add
  `/daily` only; do not "fix" the rest.
- No `app/(dashboard)/daily/`.
- `queryKeys` has no `dailyOperations`.
- Live Events BFF is the clone target for
  `app/api/daily-operations-live/route.ts`.
- Overview tiles: `text-xs uppercase tracking-wide text-muted-foreground`
  + `tabular-nums text-3xl`.

## 5. Locked decisions and invariants at risk

- Label is Daily Operations. Not Daily View.
- Pace is `yesterday_by_now`, not full yesterday (full yesterday is
  secondary).
- `wordpress_form: 0` stays visible.
- Silent Source Companies stay as zero rows.
- Native EventSource reconnect. No 3s snapshot poll while live.
- No Redis credentials in the browser.
- No mutations.

## 6. Deliverables and exact contract

1. Nav item after Overview, `ownerOnly: true`. Auth prefixes + proxy
   ACL for `/api/v1/admin/daily-operations` (all methods Owner-only).
2. `app/(dashboard)/daily/page.tsx` + `components/daily/daily-copy.ts`
   + `daily-shell.tsx` + `headline-tiles.tsx` + `origins-panel.tsx` +
   `companies-table.tsx`.
3. `lib/api/dailyOperations.ts`, `dailyOperationsLive.ts`,
   `queryKeys.dailyOperations.snapshot`.
4. BFF `app/api/daily-operations-live/route.ts` (`runtime = "nodejs"`,
   `maxDuration = 300`, Owner-only, forward `last-event-id`).
5. Live chrome states in spec §3.3. Session `+1` flash on metric
   touches.
6. Clicking a tile writes `?lane=` (DOP-07 will honor it). Clicking a
   company writes `?company=`.
7. Tests: Owner nav order; Admin cannot see or open `/daily`;
   `canAccessDashboardPath("admin", "/daily")` is false.

## 7. Out of scope

- Category panel grid, card chrome, Quiet priorities, zip/held copy
  (DOP-07). A temporary unstyled event list is allowed for pipe proof.
- Confirm Granot Booking.
- Changing Overview or Live Events.

## 8. Tests

Nav / auth tests next to existing `visibleDashboardNav` /
`canAccessDashboardPath` cases. Copy module tests for labels.

## 9. Knowledge updates after this issue ships

Update `vantage-admin/.cursor/rules/project-organization.mdc` and
`vantage-admin/CONTEXT.md` pointers only if you touch nav — prefer
DOP-08 for the full map sentence.

## 10. Acceptance criteria

- [ ] Owner nav: Overview, Daily Operations, Live Events, …
- [ ] Admin role: no nav item; `/daily` blocked; live BFF 403.
- [ ] Tiles show today + pace vs `yesterday_by_now` + session delta.
- [ ] Origins include WordPress form at zero when the snapshot says 0.
- [ ] Company table includes zero rows.
- [ ] EventSource to `/api/daily-operations-live`; tiles update on
      `metrics` without refresh (browser or client-unit proof).
- [ ] `pnpm test && pnpm typecheck && pnpm lint` in vantage-admin
      (scoped lint on files you touch is acceptable if full-repo lint
      already fails on pre-existing files — record that).

## 11. Commands

```bash
cd vantage-admin && pnpm test && pnpm typecheck
```

Browser: sign in per LOCAL-ADMIN, open `/daily`, confirm tiles and
live indicator. Paste what you saw (no credentials).

## 12. Risks

- Putting Daily Operations under Insight or System.
- Polling snapshot every 3s while SSE is live.
- Showing full yesterday as the pace number.
- Forking a second SidePanel.

## 13. Rollback

Remove the nav item, page, BFF, and query keys. Server stays.

## 14. Handoff list for the completion report

- Query key and live merge helpers DOP-07 should use.
- URL params already written (`lane`, `company`).
- What the temporary event list looks like (if any).

**Unblocks:** DOP-07.
