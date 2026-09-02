# PROGRESS — Inbound Call create_if_missing and RingCentral convergence

**This is the live ledger. Every issue updates it — on pickup and on close.**
It is a navigation aid, not an authority. Where it disagrees with the
repository, the repository is right and the next agent fixes this file.

Pack created 2026-09-02. Protocol: [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md).
Contract: [`granot-inbound-call-creation-convergence-specification.md`](granot-inbound-call-creation-convergence-specification.md).

## Issue status

| Issue | Title | Prereqs | Status | Owner / agent | Started | Closed | Report |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [GICC-01](issues/GICC-01.md) | Call create_if_missing on priority_updated | spec | `complete` | coordinator + GICC-01 implementer | 2026-09-02 | 2026-09-02 | [reports/GICC-01-completion.md](reports/GICC-01-completion.md) |
| [GICC-02](issues/GICC-02.md) | Both arrival orders and always-on phone fence | GICC-01 | `complete` | coordinator + GICC-02 implementer | 2026-09-02 | 2026-09-02 | [reports/GICC-02-completion.md](reports/GICC-02-completion.md) |
| [GICC-03](issues/GICC-03.md) | Knowledge and Owner rollout checklist | GICC-02 | `complete` | coordinator + GICC-03 implementer + docs-keeper | 2026-09-02 | 2026-09-02 | [reports/GICC-03-completion.md](reports/GICC-03-completion.md) |

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
| §1.4 / §4.1 | No new Registry policy; `requested_effect` stays `lead_created` | GICC-01 | ☑ | `requested_effect: "lead_created"` hardcoded in executeCreation; processor `requestedEffect()` unchanged. No sourcePolicy.ts diff. |
| §4.1–4.3 | Call create on `lead_created` or `priority_updated` | GICC-01 | ☑ | planNoMatch Call `priority_updated` branch; command snapshot guard. 37 focused tests. |
| §4.2 | Form `lead_created` still eligible; Form / link_only / booked never create from `priority_updated` | GICC-01 | ☑ | Regression tests in leadDesiredState.test.ts |
| §4.3 | Best Relocation Inbounds inherits existing confirmation SMS | GICC-03 | ☑ | Activation §7.2 + processor.md finalize: existing `sendGranotCreatedLeadConfirmation`; other inbound families silent until separate `outbound_sms` command. |
| §5 | RingCentral-first synchronize + always-on phone fence | GICC-02 | ☑ | Both Granot lock sites phone-gated, adoption-flag removed. Race A replica (unit 19) 10 pass. Ingest lock still flagged. |
| §6 | Granot-first adopt; adoption companion named | GICC-02 | ☑ | Unit 20 replica 13 pass: adopt, adopt-duplicate, Job-only not adopted, concurrent adoption-on + create. |
| §7 | Residual holes documented, not papered over | GICC-03 | ☑ | Activation §8 names Job-only twin, Booked-first (no `booking_status_changed` create), unmapped numbers, adoption-off Race B twin. |
| §8–§9 | Flags, Registry checklist, forbidden effects | GICC-03 | ☑ | Activation §7 Owner checklist: 0-or-1 assignment, adoption + create mode first, still three policy values, not already flipped. |
| §10 | Tests | GICC-01, GICC-02 | ☑ | GICC-01: 37 pass. GICC-02 unit: 97 pass / 1 skip. Replica unit 19 = 10; unit 20 = 13. |
| §11 | Knowledge updates | GICC-03 | ☑ | processor / desired-state / call-lead / RC qualification / source-policy / operations-registry / activation + `granot-lifecycle-capture.mdc`. |

## Acceptance criteria (specification §13)

| # | Criterion | Issue | Done |
| --- | --- | --- | --- |
| 1 | Unmatched inbound Call `priority_updated` + `create_if_missing` mints one Call Lead | GICC-01 | ☑ |
| 2 | Existing RingCentral Call Lead at granularity + phone is synchronized, never twinned, even with adoption off | GICC-02 | ☑ |
| 3 | Later qualified call adopts exactly one pending Granot-created Call Lead | GICC-02 | ☑ |
| 4 | Form create, `link_only`, and `booking_status_changed` unchanged | GICC-01 | ☑ |
| 5 | Knowledge docs match shipped gates | GICC-03 | ☑ |

## Cross-issue findings

| Found in | Belongs to | Finding | Recorded in issue |
| --- | --- | --- | --- |
| spec review 2026-09-02 | pack | No new `lead_created_policy` value. Form `lead_created` regression. Command guard after snapshot. Both Granot lock sites. Concurrent race is adoption on. Best Relocation SMS inheritance. 0-or-1 RC assignment. | spec §1.4, §4, §5.2, §8.2, §10; GICC-01/02/03 |
| GICC-01 2026-09-02 | GICC-03 | Best Relocation Inbounds inherits `priority_updated` create and existing `sendGranotCreatedLeadConfirmation` finalize. Knowledge Services still describe create as `lead_created`-shaped; do not enable `outbound_sms` on other inbound families. | spec §4.3, §11 |
| GICC-03 2026-09-02 | pack | Knowledge now describes shipped Call `priority_updated` create, always-on Granot fence, flagged ingest lock, three policy values, Owner checklist, and residual holes. | GICC-03 knowledge + activation §7–§8 |
| GICC-02 2026-09-02 | GICC-03 | Fence always on when Observation has a phone; adoption still flags ingest lock and Race B mutations; Job-only hole still named. | spec §5.2, §6.3, §7 |

## Issue log

| When | Issue | Event |
| --- | --- | --- |
| 2026-09-02 | pack | Pack authored. GICC-01 is the only `ready` issue. |
| 2026-09-02 | pack | Spec + GICC issues integrated: no new policy; Form regression; two Granot lock sites; concurrent race adoption-on; Best Relocation SMS inheritance. |
| 2026-09-02 | GICC-01 | Picked up. Status `active`. Repo `vantage-main-server`, branch `main` (desk already has the pack commit; unrelated working-tree doc deletions left untouched). |
| 2026-09-02 | GICC-01 | Coordinator review passed. 37 focused tests. Report `reports/GICC-01-completion.md`. Status `complete`. |
| 2026-09-02 | GICC-02 | Unblocked after GICC-01. Status `ready` then immediately `active`. Same repo/branch `vantage-main-server` `main`. |
| 2026-09-02 | GICC-02 | Coordinator review passed. Unit 97 pass / 1 skip; replica unit 19 = 10; unit 20 = 13. Report `reports/GICC-02-completion.md`. Status `complete`. |
| 2026-09-02 | GICC-03 | Unblocked after GICC-02. Status `ready` then immediately `active`. Same repo/branch `vantage-main-server` `main`. |
| 2026-09-02 | GICC-03 | Knowledge + Owner checklist written. Specification-coverage §4.3 / §7 / §8–§9 / §11 and AC-5 ticked. Status stays `active`. No production mutation. No completion report. Docs-keeper matching layer is coordinator-after-review. |
| 2026-09-02 | GICC-03 | Coordinator review passed. docs-keeper updated `.cursor/rules/granot-lifecycle-capture.mdc` only. Report `reports/GICC-03-completion.md`. Status `complete`. Production not applied. |
