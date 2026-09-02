# PROGRESS — Inbound Call create_if_missing and RingCentral convergence

**This is the live ledger. Every issue updates it — on pickup and on close.**
It is a navigation aid, not an authority. Where it disagrees with the
repository, the repository is right and the next agent fixes this file.

Pack created 2026-09-02. Protocol: [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md).
Contract: [`granot-inbound-call-creation-convergence-specification.md`](granot-inbound-call-creation-convergence-specification.md).

## Issue status

| Issue | Title | Prereqs | Status | Owner / agent | Started | Closed | Report |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [GICC-01](issues/GICC-01.md) | Call create_if_missing on priority_updated | spec | `ready` | | | | |
| [GICC-02](issues/GICC-02.md) | Both arrival orders and always-on phone fence | GICC-01 | `blocked` | | | | |
| [GICC-03](issues/GICC-03.md) | Knowledge and Owner rollout checklist | GICC-02 | `blocked` | | | | |

Status vocabulary: `ready` · `active` · `blocked` · `complete` · `deferred`.

## Session plan

| Session | Issues | Notes |
| --- | --- | --- |
| 1 | GICC-01 | Event-class only. Do not flip Registry policy. |
| 2 | GICC-02 | Fences + both races. Needs GICC-01 planner/command. |
| 3 | GICC-03 | Docs + Owner checklist. No production apply. |

## Specification coverage

| Spec § | Subject | Issue | Done | Evidence |
| --- | --- | --- | --- | --- |
| §1.4 / §4.1 | No new Registry policy; `requested_effect` stays `lead_created` | GICC-01 | ☐ | |
| §4.1–4.3 | Call create on `lead_created` or `priority_updated` | GICC-01 | ☐ | |
| §4.2 | Form `lead_created` still eligible; Form / link_only / booked never create from `priority_updated` | GICC-01 | ☐ | |
| §4.3 | Best Relocation Inbounds inherits existing confirmation SMS | GICC-03 | ☐ | |
| §5 | RingCentral-first synchronize + always-on phone fence | GICC-02 | ☐ | |
| §6 | Granot-first adopt; adoption companion named | GICC-02 | ☐ | |
| §7 | Residual holes documented, not papered over | GICC-03 | ☐ | |
| §8–§9 | Flags, Registry checklist, forbidden effects | GICC-03 | ☐ | |
| §10 | Tests | GICC-01, GICC-02 | ☐ | |
| §11 | Knowledge updates | GICC-03 | ☐ | |

## Acceptance criteria (specification §13)

| # | Criterion | Issue | Done |
| --- | --- | --- | --- |
| 1 | Unmatched inbound Call `priority_updated` + `create_if_missing` mints one Call Lead | GICC-01 | ☐ |
| 2 | Existing RingCentral Call Lead at granularity + phone is synchronized, never twinned, even with adoption off | GICC-02 | ☐ |
| 3 | Later qualified call adopts exactly one pending Granot-created Call Lead | GICC-02 | ☐ |
| 4 | Form create, `link_only`, and `booking_status_changed` unchanged | GICC-01 | ☐ |
| 5 | Knowledge docs match shipped gates | GICC-03 | ☐ |

## Cross-issue findings

| Found in | Belongs to | Finding | Recorded in issue |
| --- | --- | --- | --- |
| spec review 2026-09-02 | pack | No new `lead_created_policy` value. Form `lead_created` regression. Command guard after snapshot. Both Granot lock sites. Concurrent race is adoption on. Best Relocation SMS inheritance. 0-or-1 RC assignment. | spec §1.4, §4, §5.2, §8.2, §10; GICC-01/02/03 |

## Issue log

| When | Issue | Event |
| --- | --- | --- |
| 2026-09-02 | pack | Pack authored. GICC-01 is the only `ready` issue. |
| 2026-09-02 | pack | Spec + GICC issues integrated: no new policy; Form regression; two Granot lock sites; concurrent race adoption-on; Best Relocation SMS inheritance. |
