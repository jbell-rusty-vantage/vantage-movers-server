# PROGRESS — Operational surfaces

**This is the live ledger. Every issue updates it — on pickup and on close.**
It is a navigation aid, not an authority. Where it disagrees with the
repository, the repository is right and the next agent fixes this file.

Pack created 2026-09-01. Protocol: [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md).
Contract: [`operational-surfaces-specification.md`](operational-surfaces-specification.md).

## Issue status

| Issue | Title | Prereqs | Status | Owner / agent | Started | Closed | Report |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [OSE-01](issues/OSE-01.md) | Extract operational configs, filters, detail, and actions | current shell | `complete` | coordinator / OSE-01 implementer | 2026-09-02 | 2026-09-02 | [reports/OSE-01-completion.md](reports/OSE-01-completion.md) |
| [OSE-02](issues/OSE-02.md) | Tabbed detail panel; remove JSON dumps | OSE-01 | `complete` | coordinator / OSE-02 implementer | 2026-09-02 | 2026-09-02 | [reports/OSE-02-completion.md](reports/OSE-02-completion.md) |
| [OSE-03](issues/OSE-03.md) | Row identity, status chips, Actions cluster | OSE-01, OSE-02 | `complete` | coordinator / OSE-03 implementer | 2026-09-02 | 2026-09-02 | [reports/OSE-03-completion.md](reports/OSE-03-completion.md) |
| [OSE-04](issues/OSE-04.md) | Grouped filter sidebar | OSE-01, OSE-03 | `complete` | coordinator / OSE-04 implementer | 2026-09-02 | 2026-09-02 | [reports/OSE-04-completion.md](reports/OSE-04-completion.md) |
| [OSE-05](issues/OSE-05.md) | Cross-route browser proof | OSE-02, OSE-03, OSE-04 | `complete` | coordinator / OSE-05 implementer | 2026-09-02 | 2026-09-02 | [reports/OSE-05-completion.md](reports/OSE-05-completion.md) |

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
| §5 | Extract seams; resource-aware duplicate banner | OSE-01 | ☑ | `vantage-admin` extract + `tests/operational-copy.test.ts` |
| §6 | Tabbed panel, `?panel=`, hide rules, no JSON | OSE-02 | ☑ | `visibleDetailTabs` + tabbed `DetailPanel`; JSON dumps removed |
| §7 | Identity cell, status chips, Actions cluster, selected row | OSE-03 | ☑ | `rowIdentity` / `rowStatusChips` / `rowActionCluster` + `DataTable` `isRowSelected` |
| §8 | Filter groups, same keys, chips + Reset | OSE-04 | ☑ | `operational-filter-groups.ts` + `tests/operational-filter-groups.test.ts` |
| §11.3 / §12 | Browser walk on all eight routes | OSE-05 | ☑ | [reports/OSE-05-completion.md](reports/OSE-05-completion.md) — eight routes + historical + dup-call banner + `?panel=message` reload |

## Acceptance criteria (specification §12)

| # | Criterion | Issue | Done |
| --- | --- | --- | --- |
| 1 | Eight routes still use `OperationalResourcePage` | OSE-01 | ☑ |
| 2 | Tabbed panel; both JSON dumps gone | OSE-02 | ☑ |
| 3 | `?panel=` shareable, stripped, falls back | OSE-02 | ☑ |
| 4 | Rows: identity + chips + cluster + selected | OSE-03 | ☑ |
| 5 | Filters grouped; same keys | OSE-04 | ☑ |
| 6 | Contacts, Connect, Job Number, Bad Lead meaning unchanged | all | ☑ | Walk: Form submitted vs Granot on Form Lead A + Booking A Contact; `?connect=1` Leadless Booking A lands Contact; Job Number still a table deep link; Bad Lead Form Lead only |
| 7 | No Daily View / Conversation / Bad Call / Sync / new APIs | all | ☑ | Walk + source: no Daily View tabs, no ConversationPanel, no Bad Call, no Sync button, no new main-server endpoints |
| 8 | `pnpm test && pnpm typecheck && pnpm lint` in vantage-admin | each | ☑ | 436 pass, typecheck clean; scoped lint 0 errors. Full-repo lint still fails on pre-existing `needs-you.tsx`, `job-timeline-dashboard.tsx`, `global-search.tsx` |
| 9 | Browser walk §11.3 | OSE-05 | ☑ | [reports/OSE-05-completion.md](reports/OSE-05-completion.md) — every §11.3 step pass after two seam fixes |

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
| 2026-09-02 | OSE-01 | Picked up. Repo `vantage-admin`, branch `operational-surfaces` (created from clean `main` @ 171881d). Extract only; no tabs / rows / filter groups. |
| 2026-09-02 | OSE-01 | Closed. Extract shipped; banner resource-aware. Unblocks OSE-02. |
| 2026-09-02 | OSE-01 | Coordinator review: seams match §5; eight wrappers unchanged; JSON dumps still present; no `?panel=`. Independent `pnpm test` 395/395 + typecheck clean. Scoped lint on extract: 0 errors, 1 copied exhaustive-deps warning. Full-repo lint still fails on pre-existing files outside this pack. |
| 2026-09-02 | OSE-02 | Picked up. Repo `vantage-admin`, branch `operational-surfaces`. Tabbed panel + JSON dump removal only. |
| 2026-09-02 | OSE-02 | Closed. Destination tabs + `?panel=`; both JSON dumps gone. 21st.dev none used. Unblocks OSE-03. Browser smoke blocked — Admin :3000 and API :3001 were down. |
| 2026-09-02 | OSE-02 | Coordinator review: matrix, strip list, JSON removal, copy, and Contact/Source tabs match §6. `?connect=1` with no/`message` panel lands Contact; a visible `panel=summary` is kept so tab switches are not forced back while `connect` remains. Typical Connect URL has no `panel`. Browser still down at review. |
| 2026-09-02 | OSE-03 | Picked up. Repo `vantage-admin`, branch `operational-surfaces`. Rows only — no filter groups. |
| 2026-09-02 | OSE-03 | Closed. Identity + chips + sticky-right Actions cluster + `aria-selected`. Floating bar removed. 21st.dev none used. Unblocks OSE-04. Browser smoke on `/form-leads` and `/bookings` passed. |
| 2026-09-02 | OSE-03 | Coordinator review: helpers + tests match §7; prepended action columns gone; phone/boolean columns replaced; DataTable `isRowSelected` + sticky-right present. No filter-group leak. |
| 2026-09-02 | OSE-04 | Picked up. Repo `vantage-admin`, branch `operational-surfaces`. Grouped filters only — same keys. |
| 2026-09-02 | OSE-04 | Closed. Find / Status / Attribution / Record fields. Same URL keys. 21st.dev searched (Collapsible 847); disclosure header used instead. Unblocks OSE-05. Browser smoke on `/form-leads` and `/cancellations` passed. |
| 2026-09-02 | OSE-04 | Coordinator review: membership map matches §8.1; unknown keys throw; empty Status omitted; Reset still only keeps `database_scope`. |
| 2026-09-02 | OSE-05 | Picked up. Repo `vantage-admin`, branch `operational-surfaces`. Browser walk only; fix regressions in shipped seams. |
| 2026-09-02 | OSE-05 | Closed. §11.3 / §12 walk passed on local Admin. Fixed record/`panel` URL race and Reset leaving the panel open. Pack complete. |
| 2026-09-02 | OSE-05 | Coordinator review: eight wrappers still `OperationalResourcePage`; URL merge + Reset-close fixes are scoped and tested; walk notes redacted; no Daily View / Conversation / Bad Call / Sync. Pack closed on `vantage-admin` / `operational-surfaces` (uncommitted). |
