# PROGRESS — Daily Operations

**This is the live ledger. Every issue updates it — on pickup and on close.**
It is a navigation aid, not an authority. Where it disagrees with the
repository, the repository is right and the next agent fixes this file.

Pack created 2026-09-06. Protocol: [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md).
Contract: [`daily-operations-specification.md`](daily-operations-specification.md).

## Issue status

| Issue | Title | Prereqs | Status | Owner / agent | Started | Closed | Report |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [DOP-01](issues/DOP-01.md) | Models, writer, Redis client | current server | `complete` | coordinator / DOP-01 implementer | 2026-09-06 | 2026-09-06 | [reports/DOP-01-completion.md](reports/DOP-01-completion.md) |
| [DOP-02](issues/DOP-02.md) | Domain hooks | DOP-01 | `complete` | coordinator / DOP-02 implementer | 2026-09-06 | 2026-09-06 | [reports/DOP-02-completion.md](reports/DOP-02-completion.md) |
| [DOP-03](issues/DOP-03.md) | Granot hooks | DOP-01 | `complete` | coordinator / DOP-03 implementer | 2026-09-06 | 2026-09-06 | [reports/DOP-03-completion.md](reports/DOP-03-completion.md) |
| [DOP-04](issues/DOP-04.md) | Snapshot, events, rebuild, close | DOP-01 | `complete` | coordinator / DOP-04 implementer | 2026-09-06 | 2026-09-06 | [reports/DOP-04-completion.md](reports/DOP-04-completion.md) |
| [DOP-05](issues/DOP-05.md) | SSE live + Redis doorbell | DOP-01, DOP-04 | `complete` | coordinator / DOP-05 implementer | 2026-09-08 | 2026-09-08 | [reports/DOP-05-completion.md](reports/DOP-05-completion.md) |
| [DOP-06](issues/DOP-06.md) | Admin chrome, tiles, mix, pace | DOP-04, DOP-05 | `complete` | coordinator / DOP-06 implementer | 2026-09-08 | 2026-09-08 | [reports/DOP-06-completion.md](reports/DOP-06-completion.md) |
| [DOP-07](issues/DOP-07.md) | Category panels, cards, links | DOP-06 | `complete` | coordinator / DOP-07 implementer | 2026-09-08 | 2026-09-08 | [reports/DOP-07-completion.md](reports/DOP-07-completion.md) |
| [DOP-08](issues/DOP-08.md) | Browser proof and docs | DOP-02, DOP-03, DOP-07 | `complete` | coordinator / DOP-08 implementer | 2026-09-08 | 2026-09-08 | [reports/DOP-08-completion.md](reports/DOP-08-completion.md) |
| [DOP-09](issues/DOP-09.md) | Arrivals band on /daily | DOP-07 | `complete` | coordinator / DOP-09 agents | 2026-09-08 | 2026-09-08 | [reports/DOP-09-completion.md](reports/DOP-09-completion.md) |
| [DOP-10](issues/DOP-10.md) | Live workspace: focus without loss, trend %, full cards, kind colours | DOP-09 | `complete` | DOP-10 agent | 2026-09-08 | 2026-09-08 | [reports/DOP-10-completion.md](reports/DOP-10-completion.md) |
| [DOP-11](issues/DOP-11.md) | Board motion, solo panels, full-stream overlay, live clock | DOP-10 | `complete` | DOP-11 agent | 2026-09-08 | 2026-09-08 | [reports/DOP-11-completion.md](reports/DOP-11-completion.md) |

Status vocabulary: `ready` · `active` · `blocked` · `complete` · `deferred`.

## Session plan

| Session | Issues | Notes |
| --- | --- | --- |
| 1 | DOP-01 | Only startable work. Models + writer. |
| 2 | DOP-02 and/or DOP-03, DOP-04 | Hooks and snapshot may overlap after DOP-01. |
| 3 | DOP-05 | SSE after snapshot exists. |
| 4 | DOP-06 | Admin chrome + headline. |
| 5 | DOP-07 | Category panels. Do not ship `/daily` before this. |
| 6 | DOP-08 | Browser walk + docs-keeper. |
| 7 | DOP-09 | Complementary Arrivals on `/daily`. Pack reopened. |
| 8 | DOP-10 | Owner-requested live workspace: focus keeps the board, trend %, full cards, kind colours, Live Events polish. **Superseded in part by DOP-11:** expand-in-place focus is replaced by the Panel view solo strip. Trend %, full cards, kind colours, toolbar, and Arrivals rail stay. |
| 9 | DOP-11 | Solo Panel view, full-stream overlay, motion, live like-hour clock, count per `event`, 5-minute snapshot resync. |

## Specification coverage

One row per specification section that this pack owns. A row is ticked
by the issue that closes it, with the evidence named.

| Spec § | Subject | Issue | Done | Evidence |
| --- | --- | --- | --- | --- |
| §12–13 | Models, kinds, writer, Redis client | DOP-01 | ☑ | [reports/DOP-01-completion.md](reports/DOP-01-completion.md) |
| §8.4–8.5, §15.1–15.2, §15.6–15.8 | Domain hooks, deferred text, zip miss | DOP-02 | ☑ | [reports/DOP-02-completion.md](reports/DOP-02-completion.md) |
| §15.3–15.5 | Granot hooks | DOP-03 | ☑ | [reports/DOP-03-completion.md](reports/DOP-03-completion.md) |
| §16.1, §16.3, §18 | Snapshot, events, rebuild, close | DOP-04 | ☑ | [reports/DOP-04-completion.md](reports/DOP-04-completion.md) |
| §11, §16.2 | SSE + Redis doorbell | DOP-05 | ☑ | [reports/DOP-05-completion.md](reports/DOP-05-completion.md) |
| §3, §5–6 | Admin chrome, tiles, origins, companies, pace | DOP-06 | ☑ | [reports/DOP-06-completion.md](reports/DOP-06-completion.md) |
| §2, §7–8 | Category panels, cards, links | DOP-07 | ☑ | [reports/DOP-07-completion.md](reports/DOP-07-completion.md) |
| §23 | Browser walk + pointers | DOP-08 | ☑ | [reports/DOP-08-completion.md](reports/DOP-08-completion.md) |
| §3.2, §3.4, §21.18 | Complementary Arrivals band | DOP-09 | ☑ | [reports/DOP-09-completion.md](reports/DOP-09-completion.md) |
| §2.2, §2.3, §3.2, §4.1, §4.2, §5, §8.1, §16.1 (DOP-10 amendments) | Expand-in-place focus *(superseded by DOP-11 solo view)*, trend % + day before, one workspace, kind tones, full-fact cards | DOP-10 | ☑ | [reports/DOP-10-completion.md](reports/DOP-10-completion.md) |
| §2.2, §2.3, §3.2, §3.4, §4.1, §4.2, §5, §16.1, §16.2, §17, §15.9, §16.3 (DOP-11 amendments) | Solo Panel view, overlay, motion, live clock, count per `event`, 5-min resync, per-lane Load earlier; Sheet Sync drain hook (panel count + facts) | DOP-11 | ☑ | [reports/DOP-11-completion.md](reports/DOP-11-completion.md) |

## Acceptance criteria (specification §23)

| # | Criterion | Issue | Done |
| --- | --- | --- | --- |
| 1 | Owner opens `/daily` and sees today's counts + pace | DOP-06, DOP-08 | ☑ (empty NY day: tiles 0, pace `—`) |
| 2 | Category panels show facts in the right stack | DOP-07, DOP-08 | ☑ (seven panels; empty copy honest) |
| 3 | Held text shows resolved 8:00 AM send-at | DOP-02, DOP-07, DOP-08 | ☑ (server fact; Admin card from `send_at`; no local fact today) |
| 4 | Zip miss is an Exception and a Lead chip; Lead still counts | DOP-02, DOP-07, DOP-08 | ☑ (server fact; Admin chip on Lead + Exceptions; no local fact today) |
| 5 | New fact ticks a tile without refresh (SSE) | DOP-05, DOP-06, DOP-08, DOP-09 | ☑ (Manual Form Lead: Leads 1 `+ 1` without refresh) |
| 6 | Confirm still happens on `/intakes`, not `/daily` | DOP-07, DOP-08 | ☑ (no Confirm control on `/daily`) |
| 7 | Admin cannot open `/daily` | DOP-06, DOP-08 | ☑ (unit-equivalent; no second Admin session) |
| 8 | No Redis `INCR` as the Owner total | DOP-01, DOP-05 | ☑ |
| 9 | Test runner never writes Redis | DOP-01 | ☑ |
| 10 | Arrivals shows newest facts across lanes; Cancellation still visible when Granot floods; one EventSource | DOP-09 | ☑ (browser Form Lead; flood in unit tests; one EventSource) |
| 11 | Focus keeps every panel on screen; tiles / headers show `%` vs yesterday by now; cards show every stored fact; kind tones persist; toolbar in chrome | DOP-10 | ☑ (browser `?lane=granot`, Colours → rose persisted; trend by fixture — no local prior day). **DOP-11:** expand-in-place focus superseded by solo view — `?lane=` now renders that panel alone. Trend / cards / tones / toolbar unchanged. |
| 12 | Solo Panel view; Open all / Open full stream overlay; motion; like-hour baselines follow the browser clock; count per `event`; 5-min / hidden-240s / day-rollover resync; per-lane Load earlier; Sheet Sync drain hook (panel count + facts) | DOP-11 | ☑ (unit + typecheck; focused server 138; admin 585; count stays 0 until the deployed drainer records the first job) |

## Cross-issue findings

Work discovered in one issue that belongs to another. Do not fix it in
place — record it here and in the target issue.

| Found in | Belongs to | Finding | Recorded in issue |
| --- | --- | --- | --- |
| DOP-03 | DOP-02 / DOP-08 | `createLeadFromGranot` writes the Lead directly and never calls `completeFormLeadIngestion` / `completeCallLeadIngestion`. `granot.minted` correctly omits `leads.*`, so Granot-minted Lead volume is not incremented anywhere today. | This table; [reports/DOP-03-completion.md](reports/DOP-03-completion.md) |

## Issue log

| When | Issue | Event |
| --- | --- | --- |
| 2026-09-06 | pack | Pack authored. DOP-01 is the only `ready` issue. Formal spec supersedes the pre-spec one-feed layout with category panels. |
| 2026-09-06 | DOP-01 | Picked up. Repo `vantage-main-server`, branch `daily-operations`. Session 1: models, writer, Redis client. |
| 2026-09-06 | DOP-01 | Complete. Writer, models, kinds, Redis client. 22 tests pass; typecheck pass. No Redis INCR. Test runner never publishes. DOP-02, DOP-03, DOP-04 are `ready`. Report: `reports/DOP-01-completion.md`. |
| 2026-09-06 | DOP-02 | Picked up after coordinator re-ran DOP-01 (22 pass, typecheck 0). Repo `vantage-main-server`, branch `daily-operations`. Domain hooks only. |
| 2026-09-06 | DOP-02 | Complete. Form / Call / Booking / Cancellation / Lead Message hooks, quiet-hours deferred, zip miss, CRM fail, adoption conflict. Test sink so existing suite does not open Mongo. 121 focused tests pass; typecheck 0. DOP-08 stays `blocked` (still needs DOP-03 + DOP-07). Report: `reports/DOP-02-completion.md`. |
| 2026-09-06 | DOP-03 | Picked up after coordinator re-ran DOP-02 (121 pass). Repo `vantage-main-server`, branch `daily-operations`. Granot hooks only. |
| 2026-09-06 | DOP-03 | Complete. Receipt / mint / link / observe / intake / dead-letter hooks. Booked/Release counted once (capture classifies from raw `event_type`; process adds booked/release only when capture could not). 143 focused tests pass; 1 pre-existing replica skip; typecheck 0. `granot.minted` is `decisions.minted` only. DOP-08 stays `blocked` (still needs DOP-07). Report: `reports/DOP-03-completion.md`. |
| 2026-09-06 | DOP-04 | Complete. Snapshot GET, events page (newest-first, `{occurred_at_iso}:{event_id}`), open-day rebuild (counters only), close cron `5 * * * *` at `/api/cron/daily-operations-close`. 23 focused tests pass; 83 `dailyOperations/*.test.ts` pass; typecheck 0. DOP-05 is `ready`. DOP-06 stays `blocked` until DOP-05. Report: `reports/DOP-04-completion.md`. |
| 2026-09-08 | DOP-05 | Picked up. Repo `vantage-main-server`, branch `daily-operations`. Session 3: SSE live + Redis doorbell. No Admin BFF. |
| 2026-09-08 | DOP-05 | Complete. Owner SSE `GET /api/v1/admin/daily-operations/live` wakes from Redis `XREAD COUNT 25` and degrades to Mongo tail. Snapshot matches DOP-04 GET. Last-Event-ID reuses events-page cursor helpers. 93 `dailyOperations/*.test.ts` pass; 101 with admin routes; typecheck 0. No Upstash from tests. No BFF. DOP-06 is `ready`. DOP-07 and DOP-08 stay `blocked`. Report: `reports/DOP-05-completion.md`. |
| 2026-09-08 | DOP-06 | Picked up after coordinator re-ran DOP-05 (93 pass, typecheck 0). Repo `vantage-admin`, branch `daily-operations` created from clean `main`. Chrome, tiles, mix, pace, live BFF. No category panels. |
| 2026-09-08 | DOP-06 | Complete. Owner `/daily` after Overview: tiles, origin/company mix, pace vs `yesterday_by_now`, SSE live chrome, temporary event list. 534 admin tests pass; typecheck 0. Browser: empty local day, ● Live, WordPress form 0, company zeros. Admin gated by unit tests. DOP-07 is `ready`. DOP-08 stays `blocked`. Report: `reports/DOP-06-completion.md`. |
| 2026-09-08 | DOP-07 | Picked up after coordinator re-ran DOP-06 (534 pass, typecheck 0) and spot-checked Owner `/daily` (empty NY day, lane/company URL params, no category panels yet). Repo `vantage-admin`, branch `daily-operations`. Category panels, cards, links. |
| 2026-09-08 | DOP-07 | Complete. Category panels on one board, shared cards, desk links, Quiet priorities. 544 admin tests pass; typecheck 0. Browser: empty local NY day; empty copy; focus + company + Quiet URL. Cards/links proven by fixtures. DOP-08 is `ready`. Report: `reports/DOP-07-completion.md`. |
| 2026-09-08 | DOP-08 | Picked up after coordinator re-ran DOP-07 (544 pass, typecheck 0) and walked Owner `/daily` + `?lane=text`. No new features. Browser proof + docs-keeper pointers. |
| 2026-09-08 | DOP-08 | Complete. Re-walked Owner `/daily`, `?lane=lead`, `?lane=text`, `/live-events`. Empty local NY day (honest zeros). Held-text / zip-miss: no local fact; paths named. Admin role: unit-equivalent. docs-keeper pointer Service + admin map. 544 admin tests pass; typecheck 0; `okf:query` one Service. Pack Owner-ready. Report: `reports/DOP-08-completion.md`. |
| 2026-09-08 | pack | Pack reopened; Arrivals append. DOP-09 `ready` (Admin only). No DOP-10 — prove Arrivals with the current day's facts or one fact created through an existing local desk. |
| 2026-09-08 | DOP-09 | Picked up. Repo `vantage-admin`, branch `daily-operations`. Session 9: complementary Arrivals on `/daily`. Coordinator starts with orientation/review of §4 vs current Admin tree before implementation. |
| 2026-09-08 | DOP-09 | Orientation complete. §4 reverified against vantage-admin. Note: reports/DOP-09-orientation.md. |
| 2026-09-08 | DOP-09 | Implementation landed in vantage-admin. Arrivals strip + selector + highlight. Tests recorded in reports/DOP-09-implementation.md. Browser walk still open. |
| 2026-09-08 | DOP-09 | Review fix: highlight seeds from unfiltered board events; per-id 1.5s timers. Hydration and company/Quiet no longer fake-insert. |
| 2026-09-08 | DOP-09 | Coordinator: seed after events query (empty day included) so the first live fact still highlights. 557 admin tests pass. |
| 2026-09-08 | DOP-09 | Browser walk recorded in reports/DOP-09-browser.md. |
| 2026-09-08 | DOP-09 | Hydration fetch is all-lanes so `?lane=` remount cannot empty Arrivals. Re-walk: Texts focused empty; Form Lead card still in Arrivals. |
| 2026-09-08 | DOP-09 | docs-keeper: pointer + admin map say category panels plus complementary Arrivals. |
| 2026-09-08 | DOP-09 | Complete. Arrivals strip on `/daily` between mix and panels. Selector newest-20 after Quiet + company; `?lane=` ignored; hydration all-lanes. One EventSource. 557 admin tests pass; typecheck 0. Browser: empty NY day then Manual Form Lead (••0999, Just now, tiles +1). Report: `reports/DOP-09-completion.md`. |
| 2026-09-08 | DOP-10 | Picked up after Owner review of DOP-09. Repos: `vantage-admin` on `daily-operations` (equal to `main`), `vantage-main-server` on `main` working tree (snapshot only). Focus without losing the board, trend % vs yesterday / day before, cards show every stored fact, per-kind colours, live rail, Live Events polish. |
| 2026-09-08 | DOP-10 | Complete. Server snapshot loads the day before (`day_before`, `day_before_by_now`, `hourly.day_before`, `day_before_total`; 29 dailyOperations/route tests pass). Admin: focus expands in place (count rail removed), toolbar in chrome, tiles + panel headers show `%` and visible baseline line, Hourly rhythm, Arrivals sticky live rail, full-fact cards, 12 tones with per-kind overrides + Colours panel, Live Events rows show every lead fact with class rails. 569 admin tests pass; typecheck 0; lint failures pre-existing only. Spec §2.2/§2.3/§3.2/§4.1/§4.2/§5/§8.1/§16.1 amended (`DOP-10`). Browser: `/daily`, `?lane=granot`, Colours, `/live-events`. Report: `reports/DOP-10-completion.md`. docs-keeper next. **DOP-11 (2026-09-08): expand-in-place focus superseded by the Panel view solo strip. Do not delete this row.** |
| 2026-09-08 | DOP-11 | Complete. Panel view strip (All panels / solo `?lane=`); full-stream overlay; enter/exit motion + tweened counts (reduced-motion off); `withLiveDailyOperationsClock` rebases `*_by_now` from the browser clock; count per `event` (`metrics` ignored by Admin; server frame keeps multiplicity); 5-min / hidden ≥ 240s / New York day-rollover snapshot resync; per-lane Load earlier; preference store; per-lane backfill when a panel holds fewer facts than its default slots (`min(count, 8)`). 583 admin tests pass; typecheck 0; daily eslint clean; 103 server dailyOperations. Spec amended (`DOP-11`). Browser walk recorded in the report (three fixes: cached-query fold on remount, panel backfill, Granot pairing dedupe). **Sheet Sync drain hook landed** (`runSheetSyncDrain` records `sheet_sync.completed` / `sheet_sync.failed`; panel count + facts). Focused server dailyOperations + sheetSync + admin-route tests: 138 pass. Admin: 585 pass. Report: `reports/DOP-11-completion.md`. |
