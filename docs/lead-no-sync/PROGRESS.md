# PROGRESS — No-Sync Lead

**This is the live ledger. Every issue updates it — on pickup and on close.**
It is a navigation aid, not an authority. Where it disagrees with the
repository, the repository is right and the next agent fixes this file.

Pack created 2026-09-06. Protocol: [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md).
Contract: [`lead-no-sync-specification.md`](lead-no-sync-specification.md).

## Issue status

| Issue | Title | Prereqs | Status | Owner / agent | Started | Closed | Report |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [LNS-01](issues/LNS-01.md) | Field, Manual default, planner delete, contains Not expected | spec | `complete` | coordinator + LNS-01 agent | 2026-09-06 | 2026-09-06 | [reports/LNS-01-completion.md](reports/LNS-01-completion.md) |
| [LNS-02](issues/LNS-02.md) | Owner mark / unmark via `updateSourceOwnedLead` | LNS-01 | `complete` | coordinator + LNS-02 agent | 2026-09-06 | 2026-09-06 | [reports/LNS-02-completion.md](reports/LNS-02-completion.md) |
| [LNS-03](issues/LNS-03.md) | Desk filter, column, Manual checkbox, contains copy | LNS-01 | `complete` | coordinator + LNS-03 agent | 2026-09-06 | 2026-09-06 | [reports/LNS-03-completion.md](reports/LNS-03-completion.md) |
| [LNS-04](issues/LNS-04.md) | Knowledge and pointer sentences | LNS-02, LNS-03 | `complete` | coordinator + docs-keeper | 2026-09-06 | 2026-09-06 | [reports/LNS-04-completion.md](reports/LNS-04-completion.md) |

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
| §5 | Field, create default, PATCH path list | LNS-01, LNS-02 | ☑ | LNS-01: field + Admin create default. LNS-02: update Zod + CHANGE_PATHS. [LNS-02-completion.md](reports/LNS-02-completion.md) |
| §6 | Planner skip + living-lead deletes; Booking Chain Booked Deals | LNS-01 | ☑ | [LNS-01-completion.md](reports/LNS-01-completion.md) planner write lists |
| §7 | Actions-tab hide / show + confirm; no post-mark sheet scan | LNS-02 | ☑ | [LNS-02-completion.md](reports/LNS-02-completion.md) `HideFromMasterLeadsControl` |
| §8 | Contains `no_sync` → Not expected | LNS-01, LNS-03 | ☑ | LNS-01: skipReason + `not_expected`, no tab reads. LNS-03: Owner sentence + browser Not expected. [LNS-03-completion.md](reports/LNS-03-completion.md) |
| §9 | Hidden from Master Leads Status filter/column; Manual checkbox | LNS-03 | ☑ | [LNS-03-completion.md](reports/LNS-03-completion.md) |
| §3.3 / §12.7 | Bad / Duplicate sheet routing untouched even when `no_sync` is stored | LNS-01 | ☑ | Twin planner tests in [LNS-01-completion.md](reports/LNS-01-completion.md) |
| §14 | Knowledge sentences | LNS-04 | ☑ | [LNS-04-completion.md](reports/LNS-04-completion.md) |

## Acceptance criteria (specification §12)

| # | Criterion | Issue | Done |
| --- | --- | --- | --- |
| 1 | Field stored; Admin create defaults true; other origins cannot client-force true | LNS-01 | ☑ |
| 2 | Planner never upserts Master Leads; deletes existing rows | LNS-01 | ☑ |
| 3 | Booking Chain writes Booked Deals + Mongo Lead ID and does not upsert Forms/Calls | LNS-01 | ☑ |
| 4 | PATCH flips, EntityChange, source-lead job; Actions-tab confirm | LNS-02 | ☑ |
| 5 | Hidden from Master Leads filter + column; No includes missing-field | LNS-03 | ☑ |
| 6 | Contains Not expected, never Missing for No-Sync | LNS-01, LNS-03 | ☑ |
| 7 | Bad / Duplicate sheet routing untouched even when `no_sync` is stored | LNS-01 | ☑ |
| 8 | Unmatched unchanged when not no-sync | LNS-01 | ☑ |
| 9 | CPL, CRM, identity, scored search unchanged | all | ☑ |

## Cross-issue findings

Work discovered in one issue that belongs to another. Do not fix it in
place — record it here and in the target issue.

| Found in | Belongs to | Finding | Recorded in issue |
| --- | --- | --- | --- |
| LNS-02 | LNS-03 | Filter / column label is **Hidden from Master Leads**. Do not reuse `OPERATIONAL_COPY.hideFromMasterLeads.hideAction` ("Hide from Master Leads") for Status. Browser §11 steps 4–5 are unblocked. | [LNS-03.md](issues/LNS-03.md) |

## Issue log

| When | Issue | Event |
| --- | --- | --- |
| 2026-09-06 | pack | Pack authored. LNS-01 is the only `ready` issue. Glossary term No-Sync Lead added to workspace-root `CONTEXT.md`. |
| 2026-09-06 | pack | Scope tighten: `no_sync` is ordinary Forms/Calls only. Bad Lead and Duplicate sheet routing are untouched; no deletes on those tabs until billable treatment is decided. |
| 2026-09-06 | pack | Owner lock: Forms/Calls only; provenance and Booking Chain stay; Booking Chain must not upsert Forms/Calls when the matched Lead is no-sync; contains Not expected is the desk proof (no leftover-row read); search is desk Find + filter; Owner unmark is the only revival; Manual create is the expected path, mark-to-remove is rare. |
| 2026-09-06 | pack | Owner copy: Hide / Show / Hidden from Master Leads. Hide control is Actions-tab only with confirm and success/failure. No post-mark full-tab sheet scan. Hidden from Master Leads Status filter is required on both lead desks. |
| 2026-09-06 | LNS-01 | Picked up. Status `active`. Server repo on branch `lead-no-sync`. Session 1 implementation starting. |
| 2026-09-06 | LNS-01 | §4 reverified: no `no_sync`; unmatched skip is empty-plan; contains skipReason is only `created_on_unmatched`; Bad dual-write and Call stale-delete unchanged. No §4 drift. Starting predicate + planner. |
| 2026-09-06 | LNS-01 | Predicate module + planner Form/Call/Booking Chain/unmatched/Bad/Duplicate twins written. |
| 2026-09-06 | LNS-01 | Contains skipReason `no_sync` + create stamp/outbox skip written. Running tests. |
| 2026-09-06 | LNS-01 | Full suite: historical consolidation schemaValidation needed `no_sync` on the insert-default allowlist (mongoose default false). Not LNS-02. Re-running suite. |
| 2026-09-06 | LNS-01 | Closed. Status `complete`. `pnpm test` 2063 pass / 0 fail / 108 pre-existing skips. `pnpm typecheck` pass. LNS-02 and LNS-03 unblocked to `ready`. Report: `reports/LNS-01-completion.md`. |
| 2026-09-06 | LNS-02 | Picked up. Status `active`. Server on `lead-no-sync`. Admin branch `lead-no-sync` created from clean main. |
| 2026-09-06 | LNS-02 | §4 reverified: `runExistingUpdateSourceOwnedLead` still uses `updateSourceOwnedLead`; update Zod `.strict()` still rejects `no_sync`; both CHANGE_PATHS omit it; empty field diff still no EntityChange / outbox; `MarkBadLeadControl` PATCHes `{ bad_lead }` on Form only; edit form uses `updateProductionRecord`. No §4 drift. Starting Zod + CHANGE_PATHS. |
| 2026-09-06 | LNS-02 | Server Zod + CHANGE_PATHS + STORED_PATHS written. Admin `HideFromMasterLeadsControl` on Actions for Form and Call. Running tests. |
| 2026-09-06 | LNS-02 | Closed. Status `complete`. Server `pnpm test` 2070 pass / 0 fail / 108 pre-existing skips. Admin `pnpm test` 513 pass / 0 fail. Both `pnpm typecheck` pass. LNS-03 stays `ready`. LNS-04 stays `blocked`. Report: `reports/LNS-02-completion.md`. |
| 2026-09-06 | LNS-03 | Picked up. Status `active`. LNS-02 mark control is already shipped, so browser walk includes spec §11 steps 4–5. |
| 2026-09-06 | LNS-03 | §4 reverified: `adminQueryBase` still has booked/cancelled only; browse boolean loop still uses `presenceClause` except `active`; `STATUS_FILTER_KEYS` still throws; Find `q` already matches 24-hex IDs; Manual payload still omits `no_sync`; contains panel still special-cases unmatched + missing_from_mongo only. No §4 drift. Starting browse query. |
| 2026-09-06 | LNS-03 | Browse clause + desk filter/column + Manual checkbox + contains Owner sentence written. Server `pnpm test` 2076 pass / 0 fail / 108 pre-existing skips (`duration_ms` 340700). Admin `pnpm test` 520 pass / 0 fail. Both `pnpm typecheck` pass. |
| 2026-09-06 | LNS-03 | Browser §11 steps 1–6 finished on local Admin/API. Steps 4–5 did not wait on LNS-02. Local Sheet Sync drain is off: step 4 Lead contains Missing-until-drain; step 6 Booked Deals Missing-until-drain (pending job). Lead contains stayed Not expected after booking attach. |
| 2026-09-06 | LNS-03 | Closed. Status `complete`. LNS-04 unblocked to `ready`. Report: `reports/LNS-03-completion.md`. |
| 2026-09-06 | LNS-04 | Picked up. Status `active`. Knowledge sentences from shipped LNS-01–03 reports. docs-keeper next. |
| 2026-09-06 | LNS-04 | Closed. Status `complete`. §14 Services updated; Unmatched kept distinct; Bad/Duplicate orders not rewritten. `CONTEXT.md` unchanged. `catalog.md` untouched. `pnpm okf:query --type Service` count 46. Pack acceptance #9 ticked — this pack did not touch CPL, CRM, identity, or scored search. Report: `reports/LNS-04-completion.md`. |
