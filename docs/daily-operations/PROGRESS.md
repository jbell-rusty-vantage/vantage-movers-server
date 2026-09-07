# PROGRESS — Daily Operations

**This is the live ledger. Every issue updates it — on pickup and on close.**
It is a navigation aid, not an authority. Where it disagrees with the
repository, the repository is right and the next agent fixes this file.

Pack created 2026-09-06. Protocol: [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md).
Contract: [`daily-operations-specification.md`](daily-operations-specification.md).

## Issue status

| Issue | Title | Prereqs | Status | Owner / agent | Started | Closed | Report |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [DOP-01](issues/DOP-01.md) | Models, writer, Redis client | current server | `ready` | — | — | — | — |
| [DOP-02](issues/DOP-02.md) | Domain hooks | DOP-01 | `blocked` | — | — | — | — |
| [DOP-03](issues/DOP-03.md) | Granot hooks | DOP-01 | `blocked` | — | — | — | — |
| [DOP-04](issues/DOP-04.md) | Snapshot, events, rebuild, close | DOP-01 | `blocked` | — | — | — | — |
| [DOP-05](issues/DOP-05.md) | SSE live + Redis doorbell | DOP-01, DOP-04 | `blocked` | — | — | — | — |
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
| §12–13 | Models, kinds, writer, Redis client | DOP-01 | ☐ | — |
| §8.4–8.5, §15.1–15.2, §15.6–15.8 | Domain hooks, deferred text, zip miss | DOP-02 | ☐ | — |
| §15.3–15.5 | Granot hooks | DOP-03 | ☐ | — |
| §16.1, §16.3, §18 | Snapshot, events, rebuild, close | DOP-04 | ☐ | — |
| §11, §16.2 | SSE + Redis doorbell | DOP-05 | ☐ | — |
| §3, §5–6 | Admin chrome, tiles, origins, companies, pace | DOP-06 | ☐ | — |
| §2, §7–8 | Category panels, cards, links | DOP-07 | ☐ | — |
| §23 | Browser walk + pointers | DOP-08 | ☐ | — |

## Acceptance criteria (specification §23)

| # | Criterion | Issue | Done |
| --- | --- | --- | --- |
| 1 | Owner opens `/daily` and sees today's counts + pace | DOP-06 | ☐ |
| 2 | Category panels show facts in the right stack | DOP-07 | ☐ |
| 3 | Held text shows resolved 8:00 AM send-at | DOP-02, DOP-07 | ☐ |
| 4 | Zip miss is an Exception and a Lead chip; Lead still counts | DOP-02, DOP-07 | ☐ |
| 5 | New fact ticks a tile without refresh (SSE) | DOP-05, DOP-06 | ☐ |
| 6 | Confirm still happens on `/intakes`, not `/daily` | DOP-07 | ☐ |
| 7 | Admin cannot open `/daily` | DOP-06 | ☐ |
| 8 | No Redis `INCR` as the Owner total | DOP-01, DOP-05 | ☐ |
| 9 | Test runner never writes Redis | DOP-01 | ☐ |

## Cross-issue findings

Work discovered in one issue that belongs to another. Do not fix it in
place — record it here and in the target issue.

| Found in | Belongs to | Finding | Recorded in issue |
| --- | --- | --- | --- |
| — | — | — | — |

## Issue log

| When | Issue | Event |
| --- | --- | --- |
| 2026-09-06 | pack | Pack authored. DOP-01 is the only `ready` issue. Formal spec supersedes the pre-spec one-feed layout with category panels. |
