# DOP-10 — Live workspace: focus without loss, trend %, full cards, kind colors

> **Contract maturity: implementation-ready.** Session 8. Owner-requested
> reorganization of `/daily` after using DOP-09. Same board, same
> EventSource, same kinds. Category panels stay. Arrivals stays. What
> changes is how the Owner reads them and how much the cards tell.

## 1. Authority and required reading

- **Owner request (2026-09-08):** (a) the panel controls at the bottom do
  not make sense and choosing a panel loses the multi-panel view; (b)
  reconfigure the UI/UX so Arrivals, panels, and the overview work
  together, and compute percentage changes versus the previous day or
  two; (c) do not hide information on the cards; (d) give each event
  type its own colour and let the Owner customise it; (e) a live
  streaming feel; (f) Live Events gets the same treatment.
- **Pack specification:** [`../daily-operations-specification.md`](../daily-operations-specification.md)
  — §2.2 (focus), §3.2 (bands), §3.3 (live chrome), §3.4 (Arrivals),
  §4 (look and feel), §5 (tiles), §7 (panels), §8 (cards), §16.1
  (snapshot body), §17 (client). This issue **amends** §2.2, §3.2,
  §4.1, §4.2, §5, and §16.1 as recorded in §6 below. The spec is
  edited in the same change; the amendments are marked `DOP-10`.
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md),
  [`../LOCAL-ADMIN.md`](../LOCAL-ADMIN.md)
- **Reports:** [`../reports/DOP-09-completion.md`](../reports/DOP-09-completion.md)
- **Glossary:** workspace-root `CONTEXT.md`

## 2. Objective

The Owner keeps every category on screen while looking closer at one,
sees how today compares with yesterday and the day before at this
hour as a percentage, reads every stored fact on a card without
expanding anything, recognises event types by colour at a glance, and
feels the board stream.

## 3. Repository, branch, and prerequisites

- **Repositories:** `vantage-main-server` (snapshot only) and
  `vantage-admin` (board).
- **Branches:** admin `daily-operations` (equal to `main` at pickup);
  server `main` working tree (the `daily-operations` branch there is
  behind `main` and the local API serves from `main`). No commit,
  push, or deploy unless asked.
- **Prerequisites:** DOP-09 `complete`.
- 21st.dev (`user-21st`) allowed for the **live stream shell** and
  **status dot** craft targets only. Searched; adapted patterns from
  "Data Stream" (type-coloured dots, stream header counter, fade-in
  rows) and "Status Dot" (rippling live indicator). No install; no
  second design system; no invented endpoint.

## 4. Current-state evidence to verify

Observed 2026-09-08 on DOP-09's tree; **reverify before coding.**

- `daily-shell.tsx`: chrome → `HeadlineTiles` → origins + companies →
  `ArrivalsStream` → `CategoryPanels`. One `EventSource`.
- `category-panels.tsx`: `?lane=` focus renders **only** the focused
  panel; the others collapse to a pill count rail
  (`data-testid="daily-count-rail"`). Quiet priorities and Sheet Sync
  buttons sit in the Panels section header (bottom of the page).
- `event-card.tsx`: shows title, `name · ••last4`, company, origin, a
  handful of chips, links. Not shown although stored on the card:
  pickup / delivery ZIP + state, text status / send-at, Granot
  decision, exception code, entity type. `Open lead` and `Open list`
  resolve to the same href.
- `headline-tiles.tsx`: pace chip is a count delta; yesterday and
  yesterday-by-now live in a `title` tooltip only. No percent.
- Server snapshot loads **today and yesterday** only. No day-before.
- `live-webhooks.tsx`: rows are collapsed `<details>`; facts require a
  click; no per-class colour beyond the badge.

## 5. Locked decisions kept

- Category panels on one board. Not tabs. Not a page per category.
  Not a mixed feed as the only view.
- One EventSource. Arrivals reads `board.events`. No Redis in the
  browser. No snapshot poll while live.
- Arrivals default 20 newest after Quiet + `?company=`; `?lane=` does
  not filter Arrivals. Same card shell. Name + last four. No Confirm.
- Mongo is SoR. No new kinds, hooks, or increments. No Lead increment
  on `granot.minted`.
- Owner strings live in `daily-copy.ts`.

## 6. Deliverables and exact contract

### 6.1 Server — snapshot gains the day before (amends §16.1)

`getDailyOperationsSnapshot` loads **three** day documents: today,
yesterday, day before yesterday. Additive fields only:

- `day_before: "YYYY-MM-DD"` next to `today` / `yesterday`.
- Every `DailyOperationsHeadlinePace` gains `day_before: number|null`
  and `day_before_by_now: number|null` (hourly `0..currentNyHour`).
- `webhooks.*` gain `day_before: number|null`.
- Companies gain `day_before_total: number|null`.
- `hourly.day_before: DailyOperationsHourlyBucket[]`.

Missing day → `null` (UI shows `—`), same rule as yesterday. Existing
fields unchanged so the DOP-09 client keeps working during deploy.

### 6.2 Client — trend % (amends §2.2, §5)

- `percentChange(today, baseline)` → `{ pct, tone }`. Baseline `null`
  → `missing` (`—`). Baseline `0` and today `0` → `even`. Baseline
  `0` and today `> 0` → `ahead` with label `new`.
- Tiles and panel headers show, **visibly** (no tooltip-only facts):
  today; `+N` / `−N` versus yesterday at this hour; `+12%` versus
  yesterday at this hour; and a secondary line
  `Yesterday by now 31 · Yesterday 38 · Day before 35`.
- A **2-day average at this hour** percentage is shown when both
  prior days exist.
- Tiles carry a 24-bucket hourly sparkline for today when the
  snapshot has hourly data.

### 6.3 Client — focus without losing the board (amends §2.2, §3.2)

- `?lane=<lane>` **expands** that panel in place: it moves to the
  first grid cell, spans the full grid width, shows up to 40 cards
  and **Load earlier**. Every other panel remains in the grid at its
  default size. The count rail is removed.
- Clicking the same header / tile again, or **Collapse**, clears
  `?lane=`.
- Each panel gets **Show all (N)** to reveal every in-memory card for
  that lane without focusing.
- Quiet priorities, Sheet Sync, and Colours move to a **board
  toolbar** in the chrome (top). They are no longer in the Panels
  section header.

### 6.4 Client — layout (amends §3.2)

Five bands stay, with the fourth and fifth sharing one workspace on
`xl` and up:

1. Chrome: title, Eastern day, live indicator with rippling dot and
   `last fact {n}s ago`, board toolbar.
2. Headline tiles.
3. Overview row: **Hourly rhythm** (today vs yesterday vs day before,
   `now` marker) · Ingestion Origin · Source Company.
4. Arrivals as a **live rail** (sticky, scrollable) — DOM order still
   before the panels; on narrow screens it stacks above them.
5. Category panels grid beside the rail.

### 6.5 Client — cards show everything stored (amends §8.1)

The shared card renders every populated field of the small stored
payload, as labelled facts, not chips only: name · ••last4, Source
Company, Ingestion Origin, Form / Call, Job Number, pickup → delivery
(ZIP + state, `state not found` when missing), move type, text
purpose / status / send-at / skip reason, Granot class / booking action
/ decision, booking kind, exception code / detail, entity type. Server
`title` appears as a second line when it differs from the catalog
sentence. `Open list` opens the list without a record. Relative time
(`12s ago`, `3m ago`) ticks on Arrivals cards; clock stays on panel
cards. No raw JSON. No Granot payload accordion.

### 6.6 Client — colour per event type (amends §4.1)

- `lib/api/dailyOperationsColors.ts`: a fixed set of named **tones**
  (static Tailwind class bundles), a default tone per **kind** (every
  entry of the closed catalog) and per **lane**, and
  `localStorage` overrides under `vantage-admin-daily-kind-colors`.
- Card left rail, kind dot, kind badge, panel header accent, and
  Arrivals dot all read the resolved tone.
- **Colours** panel in the toolbar: every kind grouped by lane with a
  swatch picker; **Reset colours**. Persisted; URL untouched.
- Exceptions panel keeps `bg-amber-50` when `today > 0` (§4.1).

### 6.7 Live Events

`live-webhooks.tsx`: rippling live dot and count in the header,
per-class colour rail using the same tone set as Daily Operations
(`granot.lead_created`, `granot.priority_updated`,
`granot.booked` / `granot.release`), origin → destination and move
date visible on the collapsed row, relative time next to the clock,
link to `/daily`. The payload accordion and `Show details` stay.

### 6.8 Tests

Admin: `pnpm test && pnpm typecheck`; `pnpm lint` on touched files.
Server: `pnpm test -- src/services/dailyOperations/snapshot.test.ts`
plus the admin route and live stream suites.

## 7. Out of scope

- New kinds, hooks, or metric increments.
- A second EventSource, Redis in the browser, snapshot polling.
- Confirm Granot Booking on `/daily`.
- 24h/48h Daily View. Tabs. A page per category.
- Lead cost, binder, deposit.
- Historical trend beyond two prior days (Analytics owns that).

## 8. Tests

- Server: day-before totals and `day_before_by_now` for the same
  fixture that proves `yesterday_by_now`; missing day-before → `null`;
  `hourly.day_before` has 24 buckets.
- Client: `percentChange` (missing / zero / new / ahead / behind);
  two-day average; kind tone defaults cover every catalog kind; override
  read / write / reset; `CategoryPanels` with `lane="lead"` still
  renders `data-panel="text"` and `data-panel="exception"`; card
  renders pickup → delivery, text send-at, Granot decision, exception
  code; Arrivals keeps `data-band="arrivals"` and one EventSource in
  the shell; toolbar lives outside `CategoryPanels`.

## 9. Knowledge updates after this issue ships

Invoke **docs-keeper** so the admin map / knowledge pointer describe
the live workspace: expanded focus, trend %, kind colours, Arrivals
rail, snapshot `day_before`.

## 10. Acceptance criteria

- [x] `?lane=lead` keeps every other panel visible; the count rail is
      gone.
- [x] Tiles and panel headers show `%` versus yesterday at this hour
      and the yesterday / day-before line without hover.
- [x] Snapshot body has `day_before`, `day_before_by_now`,
      `hourly.day_before`, `day_before_total`; missing day → `null`.
- [x] A card shows every populated stored field; `Open list` and
      `Open lead` differ.
- [x] Every catalog kind has a default tone; the Owner can change a
      kind's tone and it persists across reload; Reset restores.
- [x] Arrivals is a live rail with rippling dot and last-fact clock;
      still 20 newest, cross-lane, `?lane=` ignored, one EventSource.
- [x] Quiet priorities / Sheet Sync / Colours live in the chrome
      toolbar.
- [x] Live Events rows show origin → destination on the collapsed row
      with a per-class colour rail; payload accordion still present.
- [x] `pnpm test && pnpm typecheck` in vantage-admin; server
      `dailyOperations` suites pass. Browser walk pasted.

## 11. Commands

```bash
cd vantage-main-server && pnpm test -- src/services/dailyOperations src/routes/daily-operations-admin.routes.test.ts
cd vantage-admin && pnpm test && pnpm typecheck
```

Browser per LOCAL-ADMIN: `/daily`, `/daily?lane=lead`, Colours panel,
`/live-events`.

## 12. Risks

- Turning focus back into a hide-the-board mode.
- A second EventSource "for the rail".
- Dynamic Tailwind class strings that the compiler cannot see (tones
  must be static bundles).
- Percent against a zero baseline rendering `Infinity`.
- Showing raw JSON or a payload accordion on `/daily`.

## 13. Rollback

Restore DOP-09 `daily-shell.tsx`, `category-panels.tsx`,
`event-card.tsx`, `headline-tiles.tsx`, `arrivals-stream.tsx`. The
server fields are additive and can stay.

## 14. Handoff list for the completion report

- Snapshot fields added and the test that proves `day_before_by_now`.
- Focus behaviour and where the toolbar lives.
- Card fact list.
- Tone set, default map, storage key.
- Layout on `xl` and on narrow screens.
- EventSource count proof.
- Browser paste (no credentials, no live PII).
- Gaps.

**Unblocks:** nothing. Pack closes when this issue closes.
