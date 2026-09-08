# DOP-09 — Arrivals band on /daily

> **Contract maturity: implementation-ready.** Session 7. Complementary
> motion on the Owner board. Same page, same socket, same cards.
> Category panels stay the way the Owner reads each lane.

## 1. Authority and required reading

- **Pack specification:** [`../daily-operations-specification.md`](../daily-operations-specification.md)
  — §2.1 (mixed feed still forbidden as the only view), §3.2 (five
  bands; placement locked), §3.4 (Arrivals), §4.1 (1.5s highlight),
  §4.2, §4.4, §7–8, §17, §21.18.
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md),
  [`../LOCAL-ADMIN.md`](../LOCAL-ADMIN.md)
- **Reuse:** `event-card.tsx`, `daily-shell.tsx` EventSource,
  `dailyOperationsLive.ts` merge, `dailyOperationsBoard.ts` Quiet /
  company filters, `daily-copy.ts`
- **Reports:** [`../reports/DOP-06-completion.md`](../reports/DOP-06-completion.md)
  (temporary list), [`../reports/DOP-07-completion.md`](../reports/DOP-07-completion.md)
  (panels replaced it)
- **Glossary:** workspace-root `CONTEXT.md` — Daily Operations,
  Daily Operations Event, Daily Operations Panel, Arrivals

## 2. Objective

The Owner stays on `/daily` and feels facts arrive — a newest-first
Arrivals strip of Daily Operations Events from every lane — without
opening Live Events and without turning the board into a mixed
firehose. Tiles still tick. Panels still own each category.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-admin` only (except pack-doc drift).
- **Branch:** `daily-operations` (already exists). Do not open a
  per-issue branch.
- **Prerequisites:** DOP-07 `complete` (cards, fan-out, Quiet
  priorities, one EventSource).
- 21st.dev allowed only for the **Arrivals shell**. Search first
  (activity / arrivals / live strip). Do not invent a second drawer,
  socket, or API.
- Verify at http://localhost:3000 ([`LOCAL-ADMIN.md`](../LOCAL-ADMIN.md)).
  Local API is on **3001**.
- No commit, push, deploy, or live payload read unless asked.
- Do not paste `ADMIN_SEED_*` or live PII.

## 4. Current-state evidence to verify

Observed 2026-09-08; **reverify before coding.**

- `/daily` is four bands in `components/daily/daily-shell.tsx`:
  chrome → `HeadlineTiles` → origins + companies → `CategoryPanels`.
  There is no Arrivals strip.
- One native `EventSource(DAILY_OPERATIONS_LIVE_PATH)` in
  `daily-shell.tsx`. BFF:
  `vantage-admin/app/api/daily-operations-live/route.ts`.
- Merge by `event_id`, newest-first, per-lane memory cap 200:
  `lib/api/dailyOperationsLive.ts` (`mergeDailyOperationsEvents`).
- Panel fan-out, Quiet priorities (`granot.priority_updated` cards
  only), `?company=` filter:
  `lib/api/dailyOperationsBoard.ts`.
- Shared card + desk links: `components/daily/event-card.tsx`. No
  insert highlight / slide-in yet. Name + last four already.
- Leftover unused copy: `DAILY_COPY.eventPipe = "Live facts"` and
  `eventPipeEmpty` (temp list removed in DOP-07). Replace; do not
  show "Live facts" to the Owner.
- Live Events stays `/live-events` (`live-webhooks.tsx` has its own
  EventSource). Do not reuse or merge those sockets.
- DOP-08 walked an empty local New York day. If today has counts,
  Arrivals should move when the next fact lands. Do not invent a
  seed issue to prove this.

## 5. Locked decisions and invariants at risk

- Home is `/daily`. Do not "just enhance Live Events."
- Category panels stay. Not tabs. Not a page per category. Not a
  mixed feed as the default / only view (§2.1).
- **Placement (locked):** after the origins / Source Company mix,
  before the category panel grid. Not under the headline tiles
  (that splits the scoreboard the Owner already likes). Not below
  the panels (motion falls off the page).
- One EventSource. Arrivals reads `board.events`. No second
  socket. No Redis in the browser. No 3s snapshot poll while live.
- Default **20** newest across lanes after Quiet priorities and
  `?company=`. `?lane=` focus does **not** filter or hide Arrivals
  — a Cancellation must stay visible when Granot floods and when
  the Owner is focused on Leads.
- Quiet priorities hides `granot.priority_updated` cards only;
  tile / panel counts unchanged.
- Same card shell and desk links as DOP-07. Name + last four only.
  No Confirm on `/daily`.
- 1.5s highlight + slide-in on insert (§4.1). Existing cards shift
  down; they do not reshuffle.
- Owner copy: band **Arrivals**. Empty **Nothing has arrived yet
  today.** Relative stamp **Just now** is allowed on a card that
  inserted this session. Do not say Daily View, SMS (except Twilio),
  partner, or unqualified "webhook event."
- Do not increment Leads on `granot.minted` (Cross-issue finding).

## 6. Deliverables and exact contract

1. `components/daily/arrivals-stream.tsx` (name may differ; keep it
   in `components/daily/`). Compact strip, not a second panel grid.
2. Mount it in `daily-shell.tsx` **between** the origins/companies
   row and `CategoryPanels`.
3. Copy in `daily-copy.ts`: `arrivals`, empty, optional `justNow`.
   Delete or stop exporting unused `eventPipe` / `eventPipeEmpty`
   so "Live facts" cannot leak.
4. Selector in `dailyOperationsBoard.ts` (or sibling): newest-first
   slice of 20 after Quiet + company. Do not fan-out by lane here.
5. Reuse `DailyOperationsEventCard`. Add an insert highlight /
   slide-in prop (1.5s) for newly arrived `event_id`s. Do not fork
   a second card.
6. Exactly one `EventSource` for Daily Operations. Session deltas
   on tiles continue from the existing `metrics` / `event` path.
7. Tests listed in §8.
8. Browser walk of an insert (real current-day fact, or a fact you
   create through an existing local desk — Form Lead, etc.). Paste
   what you saw. No credentials. No live PII.

## 7. Out of scope

- New main-server kinds or hooks.
- Live Events rewrite, merge, or second Granot accordion.
- Confirm Granot Booking on `/daily`.
- 24h/48h Daily View.
- A second EventSource or Redis `INCR`.
- A Lead increment on `granot.minted`.
- DOP-10 seed / demo harness. If today's New York day has facts,
  prove with those. If it is empty, create one fact through an
  existing local path and say so. Do not open a seed issue.

## 8. Tests

Client tests, not a new server suite.

- Mixed insert order: a Cancellation remains in the Arrivals slice
  when a burst of Granot facts arrives after it (newest-first, cap
  20 — seed enough Granot that a buried mixed-feed would hide the
  Cancellation from a naive "first 20 of granot only" view; the
  Cancellation must still be visible because Arrivals is cross-lane).
- Quiet priorities: `granot.priority_updated` cards hidden;
  counts / other kinds unchanged.
- `?company=` filters Arrivals; `?lane=` does not.
- `daily-shell` (or the live hook) opens **one** EventSource to
  `DAILY_OPERATIONS_LIVE_PATH`. Arrivals does not construct another.
- Insert highlight applies to a newly merged `event_id` and clears
  after 1.5s (unit / fake timers).

## 9. Knowledge updates after this issue ships

Invoke **docs-keeper** so the admin map / knowledge pointer say
Daily Operations is category panels **plus** complementary
Arrivals on `/daily`, not Daily View and not Live Events.

## 10. Acceptance criteria

- [x] `/daily` shows Arrivals between mix and panels.
      Evidence: `daily-shell.tsx` mount; browser
      [`../reports/DOP-09-browser.md`](../reports/DOP-09-browser.md).
- [x] Default slice is ~20 newest across lanes.
      Evidence: `DAILY_OPERATIONS_ARRIVALS_LIMIT = 20`; board tests.
- [x] A Cancellation card remains visible in Arrivals when Granot
      floods.
      Evidence: unit test (Cancellation ~15th newest; naive Granot-only
      first-20 omits it). Not exercised in the one-Lead browser day.
- [x] Quiet priorities hides priority cards only; counts unchanged.
      Evidence: board test; `dailyOperationsPanelCount` unchanged.
- [x] `?company=` applies; `?lane=` focus does not hide or
      lane-filter Arrivals.
      Evidence: selector ignores `lane`; hydration is `events("all")`;
      browser: Texts focused empty, Form Lead still in Arrivals;
      `?company=best_relocation_leads` kept the card.
- [x] New insert: slide-in + 1.5s highlight. Tiles still tick.
      Evidence: fake-timer 1500ms; browser Just now + residual amber;
      tiles Leads 1 `+ 1` without refresh. Slide-in start not watched
      (SSE while on Manual).
- [x] Same card shell and desk links as DOP-07. Name + last four
      only. No Confirm control.
      Evidence: `DailyOperationsEventCard`; walk ••0999; no Confirm.
- [x] Exactly one Daily Operations EventSource. No Redis in the
      browser.
      Evidence: source-scan one `EventSource` in the shell; none in
      Arrivals.
- [x] Owner strings come from `daily-copy.ts`. Band is Arrivals.
      "Live facts" is gone.
      Evidence: `tests/daily-copy.test.ts`; browser heading Arrivals.
- [x] `pnpm test && pnpm typecheck` in vantage-admin. Browser proof
      of a real or locally created insert; paste what you saw (no
      credentials, no live PII). If the local New York day is empty
      and you could not create a fact, say so honestly — do not
      invent DOP-10.
      Evidence: 557 pass; typecheck 0; Manual Form Lead; no DOP-10.

## 11. Commands

```bash
cd vantage-admin && pnpm test && pnpm typecheck
```

Browser per LOCAL-ADMIN: `/daily` (default), then `?lane=text`,
`?company=` on a known slug, Quiet priorities on. Watch Arrivals
while a fact lands. Paste what you saw.

## 12. Risks

- Reintroducing a mixed feed as the only view (ripping out panels
  or hiding them behind an Arrivals tab).
- Putting Arrivals under the tiles and splitting the scoreboard.
- Opening a second EventSource "for the stream."
- Filtering Arrivals by `?lane=` so it becomes a duplicate of the
  focused panel.
- Showing "Live facts" / Daily View / webhook event copy.
- Embedding Live Events JSON on the card.
- Confirm on this page.
- Counting a Lead on `granot.minted`.

## 13. Rollback

Remove `arrivals-stream` and the mount in `daily-shell`. Tiles,
mix, and category panels remain. Copy keys can stay unused.

## 14. Handoff list for the completion report

- Final component path and placement in `daily-shell`.
- Arrivals selector (limit, filters).
- How insert highlight is keyed (event_id + timer).
- EventSource count proof.
- Browser paste (no credentials, no live PII).
- Whether the local New York day already had facts or you created
  one through an existing desk.
- Gaps.

**Unblocks:** nothing in this pack. Pack remains open only until
this issue closes.
