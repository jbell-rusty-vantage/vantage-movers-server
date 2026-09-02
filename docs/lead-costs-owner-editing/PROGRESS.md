# PROGRESS — Lead Costs Owner date-range editing

**This is the live ledger. Every issue updates it — on pickup and on close.**
It is a navigation aid, not an authority. Where it disagrees with the
repository, the repository is right and the next agent fixes this file.

Pack created 2026-09-02. Protocol: [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md).
Contract: [`lead-costs-owner-editing-specification.md`](lead-costs-owner-editing-specification.md).

## Issue status

| Issue | Title | Prereqs | Status | Owner / agent | Started | Closed | Report |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [LCE-01](issues/LCE-01.md) | Server `set_range` | current schedule module | `ready` | — | — | — | — |
| [LCE-02](issues/LCE-02.md) | By date default form | LCE-01 | `blocked` | — | — | — | — |
| [LCE-03](issues/LCE-03.md) | Copy, language, URL, handoff | LCE-02 | `blocked` | — | — | — | — |
| [LCE-04](issues/LCE-04.md) | Structured rebuild; no JSON | LCE-02 | `blocked` | — | — | — | — |
| [LCE-05](issues/LCE-05.md) | Browser proof and docs | LCE-02, LCE-03, LCE-04 | `blocked` | — | — | — | — |

Status vocabulary: `ready` · `active` · `blocked` · `complete` · `deferred`.

## Session plan

| Session | Issues | Notes |
| --- | --- | --- |
| 1 | LCE-01 | Only startable work. Server construction. No Admin UI. |
| 2 | LCE-02 | By date form. 21st.dev: date-range + timeline. |
| 3 | LCE-03 | Copy / language / URL. No rebuild editor. |
| 4 | LCE-04 | Structured rebuild. 21st.dev: multi-row period editor. |
| 5 | LCE-05 | Browser walk + docs-keeper. |

## Specification coverage

One row per specification section that this pack owns. A row is ticked
by the issue that closes it, with the evidence named.

| Spec § | Subject | Issue | Done | Evidence |
| --- | --- | --- | --- | --- |
| §5 | `set_range` construction + API | LCE-01 | ☐ | — |
| §6.1–6.2 | By date form, timeline, no IDs/commands | LCE-02 | ☐ | — |
| §6.3–6.4 | Rebuild tool + client types | LCE-04 | ☐ | — |
| §4.1, §7, §8, §9 | Labels, Simple/Corrections, handoff, URL | LCE-03 | ☐ | — |
| §10.3 / §11 | Browser walk | LCE-05 | ☐ | — |

## Acceptance criteria (specification §11)

| # | Criterion | Issue | Done |
| --- | --- | --- | --- |
| 1 | One-save From + Through + Amount via `set_range` | LCE-01, LCE-02 | ☐ |
| 2 | By date default; no command dropdown / Period ID / JSON | LCE-02, LCE-04 | ☐ |
| 3 | Ongoing is explicit and replaces later rates | LCE-01, LCE-02 | ☐ |
| 4 | Schedule save does not write Leads; handoff offered | LCE-01, LCE-03 | ☐ |
| 5 | Owner labels + language deck | LCE-03 | ☐ |
| 6 | Four old Advanced operations still on the API | LCE-01 | ☐ |
| 7 | Legacy CPL / Analytics / ingest / correction workers unchanged | all | ☐ |
| 8 | Package checks in the repo the issue touches | each | ☐ |
| 9 | Browser walk §10.3 | LCE-05 | ☐ |

## Cross-issue findings

Work discovered in one issue that belongs to another. Do not fix it in
place — record it here and in the target issue.

| Found in | Belongs to | Finding | Recorded in issue |
| --- | --- | --- | --- |
| — | — | — | — |

## Issue log

| When | Issue | Event |
| --- | --- | --- |
| 2026-09-02 | pack | Pack authored. LCE-01 is the only `ready` issue. |
