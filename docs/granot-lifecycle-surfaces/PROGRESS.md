# PROGRESS — Granot Lifecycle surfaces

**This is the live ledger. Every issue updates it — on pickup and on close.**
It is a navigation aid, not an authority. Where it disagrees with the
repository, the repository is right and the next agent fixes this file.

Pack created 2026-09-01. Protocol: [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md).
Contract: [`granot-lifecycle-surfaces-specification.md`](granot-lifecycle-surfaces-specification.md).

## Issue status

| Issue | Title | Prereqs | Status | Owner / agent | Started | Closed | Report |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [GLS-01](issues/GLS-01.md) | Ingestion cleanup and Granot Lifecycle Health home | current nav | `ready` | | | | |
| [GLS-02](issues/GLS-02.md) | Owner webhook receipt search API | current receipts | `ready` | | | | |
| [GLS-03](issues/GLS-03.md) | Receipts tab on Granot Lifecycle | GLS-01, GLS-02 | `blocked` | | | | |

Status vocabulary: `ready` · `active` · `blocked` · `complete` · `deferred`.

## Session plan

| Session | Issues | Notes |
| --- | --- | --- |
| 1 | GLS-01 | Admin IA. Startable immediately. |
| 1 (parallel) | GLS-02 | Server API. Startable immediately in the other repo. |
| 2 | GLS-03 | Receipts UI. Wait for both. |

## Specification coverage

One row per specification section that this pack owns. A row is ticked
by the issue that closes it, with the evidence named.

| Spec § | Subject | Issue | Done | Evidence |
| --- | --- | --- | --- | --- |
| §2.1–2.3 | Sidebar Granot Lifecycle; Ingestion order; Automation-only Granot workflow | GLS-01 | ☐ | |
| §2.4–2.5 | Redirects and moved deep links | GLS-01 | ☐ | |
| §3 | Auth: Owner Receipts, Owner/Admin Health | GLS-01, GLS-02 | ☐ | |
| §4–6 | Receipt list object, filters, DTO | GLS-02 | ☐ | |
| §7 | Receipts UI | GLS-03 | ☐ | |
| §8 | Server search module | GLS-02 | ☐ | |

## Acceptance criteria (specification §12)

| # | Criterion | Issue | Done |
| --- | --- | --- | --- |
| 1 | Owner sidebar shows Granot Lifecycle; Admin does not | GLS-01 | ☐ |
| 2 | Ingestion is Granot workflow then Best Relocation; no inner nest | GLS-01 | ☐ |
| 3 | Intakes and Job Timeline stay their sidebar homes | GLS-01 | ☐ |
| 4 | Health at `/granot-lifecycle/health`; old URL redirects | GLS-01 | ☐ |
| 5 | Lifecycle queue and job URLs redirect | GLS-01 | ☐ |
| 6 | Owner receipt search; Admin 403 | GLS-02, GLS-03 | ☐ |
| 7 | Rows deep-link Job Timeline and Intake; no raw payload | GLS-03 | ☐ |
| 8 | Live Events, Intakes commands, Job Timeline, Automation apply unchanged | all | ☐ |

## Cross-issue findings

Work discovered in one issue that belongs to another. Do not fix it in
place — record it here and in the target issue.

| Found in | Belongs to | Finding | Recorded in issue |
| --- | --- | --- | --- |
| — | — | — | — |

## Issue log

| When | Issue | Event |
| --- | --- | --- |
| 2026-09-01 | pack | Pack authored. GLS-01 and GLS-02 are `ready`. GLS-03 is `blocked`. |
