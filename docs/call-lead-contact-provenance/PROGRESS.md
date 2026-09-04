# PROGRESS — Call Lead contact provenance

**This is the live ledger. Every issue updates it — on pickup and on close.**
It is a navigation aid, not an authority. Where it disagrees with the
repository, the repository is right and the next agent fixes this file.

Pack created 2026-09-04. Protocol: [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md).
Contract: [`call-lead-contact-provenance-specification.md`](call-lead-contact-provenance-specification.md).

## Issue status

| Issue | Title | Prereqs | Status | Owner / agent | Started | Closed | Report |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [CLCP-01](issues/CLCP-01.md) | Planner + synchronize: snapshot-only Call contact | spec | `ready` | — | — | — | — |
| [CLCP-02](issues/CLCP-02.md) | Call identity: Job wins, skip competing phone | CLCP-01 | `blocked` | — | — | — | — |
| [CLCP-03](issues/CLCP-03.md) | CSV / preview: no live name/email | CLCP-01 | `blocked` | — | — | — | — |
| [CLCP-04](issues/CLCP-04.md) | Knowledge and BILA pointer | CLCP-02, CLCP-03 | `blocked` | — | — | — | — |
| [CLCP-05](issues/CLCP-05.md) | Optional Owner desk any-known-contact | Owner un-defer | `deferred` | — | — | — | — |

Status vocabulary: `ready` · `active` · `blocked` · `complete` · `deferred`.

## Session plan

| Session | Issues | Notes |
| --- | --- | --- |
| 1 | CLCP-01 | Only startable work. Invert AC-12. |
| 1 or 2 | CLCP-02 | May start in the same session after CLCP-01 tests are green. |
| 2 | CLCP-03 | CSV must not write live name/email. |
| 3 | CLCP-04 | docs-keeper. No flag apply. |
| — | CLCP-05 | Do not pick up. |

## Specification coverage

One row per specification section that this pack owns. A row is ticked
by the issue that closes it, with the evidence named.

| Spec § | Subject | Issue | Done | Evidence |
| --- | --- | --- | --- | --- |
| §4.1–4.3 / §5.1–5.3 | Snapshot-only qualified Call contact; live phone locked | CLCP-01 | ☐ | — |
| §4.4–4.5 / §6 | Job-wins Call identity; no snapshot phone query | CLCP-02 | ☐ | — |
| §5.5–5.6 | CSV/preview do not write live contact | CLCP-03 | ☐ | — |
| §7 | Booking intake Call `q` unchanged; automatic match Job else phone | CLCP-02 (identity), CLCP-04 (docs) | ☐ | — |
| §11 | Knowledge Services + BILA pointer | CLCP-04 | ☐ | — |
| §2 / CLCP-05 | Owner desk any-known-contact | CLCP-05 | deferred | — |

## Acceptance criteria (specification §12)

| # | Criterion | Issue | Done |
| --- | --- | --- | --- |
| 1 | RC Call + Priority 1/5 → snapshot only; live contact unchanged | CLCP-01 | ☐ |
| 2 | Later same Job, different Granot phone → coalesce; no phone conflict vs other ANI | CLCP-01, CLCP-02 | ☐ |
| 3 | First bind still granularity + operational/ingested phone | CLCP-02 | ☐ |
| 4 | Conflicting Jobs / two Job candidates / Form WordPress unchanged | CLCP-01, CLCP-02 | ☐ |
| 5 | No mint on `priority_updated` / `booking_status_changed` | all | ☐ |
| 6 | CSV never writes live phone; after CLCP-03 never live name/email | CLCP-03 | ☐ |
| 7 | Booking-intake Call `q` unchanged in required issues | CLCP-01–04 | ☐ |
| 8 | No effect flags; `sourcePolicy.ts` unchanged | all | ☐ |
| 9 | Knowledge matches shipped code | CLCP-04 | ☐ |

## Cross-issue findings

Work discovered in one issue that belongs to another. Do not fix it in
place — record it here and in the target issue.

| Found in | Belongs to | Finding | Recorded in issue |
| --- | --- | --- | --- |
| — | — | — | — |

## Issue log

| When | Issue | Event |
| --- | --- | --- |
| 2026-09-04 | pack | Pack authored. CLCP-01 is the only `ready` issue. CLCP-05 is `deferred`. |
