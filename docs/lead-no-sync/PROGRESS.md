# PROGRESS — No-Sync Lead

**This is the live ledger. Every issue updates it — on pickup and on close.**
It is a navigation aid, not an authority. Where it disagrees with the
repository, the repository is right and the next agent fixes this file.

Pack created 2026-09-06. Protocol: [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md).
Contract: [`lead-no-sync-specification.md`](lead-no-sync-specification.md).

## Issue status

| Issue | Title | Prereqs | Status | Owner / agent | Started | Closed | Report |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [LNS-01](issues/LNS-01.md) | Field, Manual default, planner delete, contains Not expected | spec | `ready` | — | — | — | — |
| [LNS-02](issues/LNS-02.md) | Owner mark / unmark via `updateSourceOwnedLead` | LNS-01 | `blocked` | — | — | — | — |
| [LNS-03](issues/LNS-03.md) | Desk filter, column, Manual checkbox, contains copy | LNS-01 | `blocked` | — | — | — | — |
| [LNS-04](issues/LNS-04.md) | Knowledge and pointer sentences | LNS-02, LNS-03 | `blocked` | — | — | — | — |

Status vocabulary: `ready` · `active` · `blocked` · `complete` · `deferred`.

## Session plan

| Session | Issues | Notes |
| --- | --- | --- |
| 1 | LNS-01 | Only startable work. Server only. |
| 2 | LNS-02 | Mark control. Needs planner deletes. |
| 3 | LNS-03 | Desk + Manual. May follow LNS-02 on the same desk. |
| 4 | LNS-04 | Knowledge after both UI issues. |

## Specification coverage

One row per specification section that this pack owns. A row is ticked
by the issue that closes it, with the evidence named.

| Spec § | Subject | Issue | Done | Evidence |
| --- | --- | --- | --- | --- |
| §5 | Field, create default, PATCH path list | LNS-01, LNS-02 | ☐ | — |
| §6 | Planner skip + living-lead deletes; Booking Chain Booked Deals | LNS-01 | ☐ | — |
| §7 | Owner mark / unmark UI | LNS-02 | ☐ | — |
| §8 | Contains `no_sync` → Not expected | LNS-01, LNS-03 | ☐ | — |
| §9 | Desk filter/column; Manual checkbox | LNS-03 | ☐ | — |
| §3.3 / §12.7 | Bad / Duplicate orders unchanged when `no_sync` is false | LNS-01 | ☐ | — |
| §14 | Knowledge sentences | LNS-04 | ☐ | — |

## Acceptance criteria (specification §12)

| # | Criterion | Issue | Done |
| --- | --- | --- | --- |
| 1 | Field stored; Admin create defaults true; other origins cannot client-force true | LNS-01 | ☐ |
| 2 | Planner never upserts Master Leads; deletes existing rows | LNS-01 | ☐ |
| 3 | Booking Chain still writes Booked Deals + Mongo Lead ID | LNS-01 | ☐ |
| 4 | PATCH flips, EntityChange, source-lead job | LNS-02 | ☐ |
| 5 | Desk filter + column; No includes missing-field | LNS-03 | ☐ |
| 6 | Contains Not expected, never Missing for No-Sync | LNS-01, LNS-03 | ☐ |
| 7 | Bad dual-write and Call stale-delete unchanged when syncable | LNS-01 | ☐ |
| 8 | Unmatched unchanged when not no-sync | LNS-01 | ☐ |
| 9 | CPL, CRM, identity, scored search unchanged | all | ☐ |

## Cross-issue findings

Work discovered in one issue that belongs to another. Do not fix it in
place — record it here and in the target issue.

| Found in | Belongs to | Finding | Recorded in issue |
| --- | --- | --- | --- |
| — | — | — | — |

## Issue log

| When | Issue | Event |
| --- | --- | --- |
| 2026-09-06 | pack | Pack authored. LNS-01 is the only `ready` issue. Glossary term No-Sync Lead added to workspace-root `CONTEXT.md`. |
