# PROGRESS — Operational surfaces

**This is the live ledger. Every issue updates it — on pickup and on close.**
It is a navigation aid, not an authority. Where it disagrees with the
repository, the repository is right and the next agent fixes this file.

Pack created 2026-09-01. Protocol: [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md).
Contract: [`operational-surfaces-specification.md`](operational-surfaces-specification.md).

## Issue status

| Issue | Title | Prereqs | Status | Owner / agent | Started | Closed | Report |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [OSE-01](issues/OSE-01.md) | Extract operational configs, filters, detail, and actions | current shell | `ready` | — | — | — | — |
| [OSE-02](issues/OSE-02.md) | Tabbed detail panel; remove JSON dumps | OSE-01 | `blocked` | — | — | — | — |
| [OSE-03](issues/OSE-03.md) | Row identity, status chips, Actions cluster | OSE-01, OSE-02 | `blocked` | — | — | — | — |
| [OSE-04](issues/OSE-04.md) | Grouped filter sidebar | OSE-01, OSE-03 | `blocked` | — | — | — | — |
| [OSE-05](issues/OSE-05.md) | Cross-route browser proof | OSE-02, OSE-03, OSE-04 | `blocked` | — | — | — | — |

Status vocabulary: `ready` · `active` · `blocked` · `complete` · `deferred`.

## Session plan

| Session | Issues | Notes |
| --- | --- | --- |
| 1 | OSE-01 | Only startable work. Extract, no visual change except the duplicate banner. |
| 2 | OSE-02 | Tabbed panel. 21st.dev: tabbed sheet. |
| 3 | OSE-03 | Rows. 21st.dev: status chips + sticky actions. |
| 4 | OSE-04 | Filters. 21st.dev: grouped filter sidebar. |
| 5 | OSE-05 | All eight routes + historical + deep links. |

## Specification coverage

One row per specification section that this pack owns. A row is ticked
by the issue that closes it, with the evidence named.

| Spec § | Subject | Issue | Done | Evidence |
| --- | --- | --- | --- | --- |
| §5 | Extract seams; resource-aware duplicate banner | OSE-01 | ☐ | — |
| §6 | Tabbed panel, `?panel=`, hide rules, no JSON | OSE-02 | ☐ | — |
| §7 | Identity cell, status chips, Actions cluster, selected row | OSE-03 | ☐ | — |
| §8 | Filter groups, same keys, chips + Reset | OSE-04 | ☐ | — |
| §11.3 / §12 | Browser walk on all eight routes | OSE-05 | ☐ | — |

## Acceptance criteria (specification §12)

| # | Criterion | Issue | Done |
| --- | --- | --- | --- |
| 1 | Eight routes still use `OperationalResourcePage` | OSE-01 | ☐ |
| 2 | Tabbed panel; both JSON dumps gone | OSE-02 | ☐ |
| 3 | `?panel=` shareable, stripped, falls back | OSE-02 | ☐ |
| 4 | Rows: identity + chips + cluster + selected | OSE-03 | ☐ |
| 5 | Filters grouped; same keys | OSE-04 | ☐ |
| 6 | Contacts, Connect, Job Number, Bad Lead meaning unchanged | all | ☐ |
| 7 | No Daily View / Conversation / Bad Call / Sync / new APIs | all | ☐ |
| 8 | `pnpm test && pnpm typecheck && pnpm lint` in vantage-admin | each | ☐ |
| 9 | Browser walk §11.3 | OSE-05 | ☐ |

## Cross-issue findings

Work discovered in one issue that belongs to another. Do not fix it in
place — record it here and in the target issue.

| Found in | Belongs to | Finding | Recorded in issue |
| --- | --- | --- | --- |
| — | — | — | — |

## Issue log

| When | Issue | Event |
| --- | --- | --- |
| 2026-09-01 | pack | Pack authored. OSE-01 is the only `ready` issue. |
