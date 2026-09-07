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
| [DOP-05](issues/DOP-05.md) | SSE live + Redis doorbell | DOP-01, DOP-04 | `ready` | — | — | — | — |
| [DOP-06](issues/DOP-06.md) | Admin chrome, tiles, mix, pace | DOP-04, DOP-05 | `blocked` | — | — | — | — |
| [DOP-07](issues/DOP-07.md) | Category panels, cards, links | DOP-06 | `blocked` | — | — | — | — |
| [DOP-08](issues/DOP-08.md) | Browser proof and docs | DOP-02, DOP-03, DOP-07 | `blocked` | — | — | — | — |

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

## Specification coverage

One row per specification section that this pack owns. A row is ticked
by the issue that closes it, with the evidence named.

| Spec § | Subject | Issue | Done | Evidence |
| --- | --- | --- | --- | --- |
| §12–13 | Models, kinds, writer, Redis client | DOP-01 | ☑ | [reports/DOP-01-completion.md](reports/DOP-01-completion.md) |
| §8.4–8.5, §15.1–15.2, §15.6–15.8 | Domain hooks, deferred text, zip miss | DOP-02 | ☑ | [reports/DOP-02-completion.md](reports/DOP-02-completion.md) |
| §15.3–15.5 | Granot hooks | DOP-03 | ☑ | [reports/DOP-03-completion.md](reports/DOP-03-completion.md) |
| §16.1, §16.3, §18 | Snapshot, events, rebuild, close | DOP-04 | ☑ | [reports/DOP-04-completion.md](reports/DOP-04-completion.md) |
| §11, §16.2 | SSE + Redis doorbell | DOP-05 | ☐ | — |
| §3, §5–6 | Admin chrome, tiles, origins, companies, pace | DOP-06 | ☐ | — |
| §2, §7–8 | Category panels, cards, links | DOP-07 | ☐ | — |
| §23 | Browser walk + pointers | DOP-08 | ☐ | — |

## Acceptance criteria (specification §23)

| # | Criterion | Issue | Done |
| --- | --- | --- | --- |
| 1 | Owner opens `/daily` and sees today's counts + pace | DOP-06 | ☐ |
| 2 | Category panels show facts in the right stack | DOP-07 | ☐ |
| 3 | Held text shows resolved 8:00 AM send-at | DOP-02, DOP-07 | ☑ (server fact; Admin card still DOP-07) |
| 4 | Zip miss is an Exception and a Lead chip; Lead still counts | DOP-02, DOP-07 | ☑ (server fact; Admin chip still DOP-07) |
| 5 | New fact ticks a tile without refresh (SSE) | DOP-05, DOP-06 | ☐ |
| 6 | Confirm still happens on `/intakes`, not `/daily` | DOP-07 | ☐ |
| 7 | Admin cannot open `/daily` | DOP-06 | ☐ |
| 8 | No Redis `INCR` as the Owner total | DOP-01, DOP-05 | ☑ |
| 9 | Test runner never writes Redis | DOP-01 | ☑ |

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
