# PROGRESS — Referral review Release-first owner commands

**This is the live ledger. Every issue updates it — on pickup and on close.**
It is a navigation aid, not an authority. Where it disagrees with the
repository, the repository is right and the next agent fixes this file.

Pack created 2026-09-14. Protocol: [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md).
Contract: [`referral-review-release-first-specification.md`](referral-review-release-first-specification.md).

## Issue status

| Issue | Title | Prereqs | Status | Owner / agent | Started | Closed | Report |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [RRF-01](issues/RRF-01.md) | Server policy helper + tests | current owner commands | `complete` | coordinator / RRF-01 implementer | 2026-09-14 | 2026-09-14 | [RRF-01-completion.md](reports/RRF-01-completion.md) |
| [RRF-02](issues/RRF-02.md) | Admin 409 copy | RRF-01 preferred | `complete` | coordinator / RRF-02 implementer | 2026-09-14 | 2026-09-14 | [RRF-02-completion.md](reports/RRF-02-completion.md) |
| [RRF-03](issues/RRF-03.md) | Knowledge restamp | RRF-01 | `complete` | coordinator / docs-keeper | 2026-09-14 | 2026-09-14 | [RRF-03-completion.md](reports/RRF-03-completion.md) |

Status vocabulary: `ready` · `active` · `blocked` · `complete` · `deferred`.

## Session plan

| Session | Issues | Notes |
| --- | --- | --- |
| 1 | RRF-01 | Only startable work. TDD then helper. No Admin UI. |
| 2 | RRF-02 | 409 copy in intake-copy + three forms. |
| 3 | RRF-03 | docs-keeper on booking-reconciliation + pointer. |

## Specification coverage

| Spec § | Subject | Issue | Done | Evidence |
| --- | --- | --- | --- | --- |
| §4–§5 | `assertActiveReferralPolicy` accepts Booked or Release | RRF-01 | ☑ | `isAcceptedReferralPolicyAction`; helper conjunct swap |
| §8.1–§8.2 | Unit + replica | RRF-01 | ☑ | unit 9/9; replica written, opt-in skipped locally |
| §6, §8.3 | Admin 409 copy | RRF-02 | ☑ | `intakeOwnerCommandConflictCopy`; intakes-components 26/26 |
| §10 | Knowledge restamp | RRF-03 | ☑ | pointer landed; first-evidence Booked or Release on Service |

## Acceptance criteria (specification §9)

| # | Criterion | Issue | Done |
| --- | --- | --- | --- |
| AC-RRF-01 | Release-first Referral review No Action | RRF-01 | ☑ |
| AC-RRF-02 | Same seed Update; one Booking | RRF-01 | ☑ |
| AC-RRF-03 | Cancel still latest-Release-only | RRF-01 | ☑ |
| AC-RRF-04 | Create Referral minting still Booked-only | RRF-01 | ☑ |
| AC-RRF-05 | Dead Referral policy 422 | RRF-01 | ☑ |
| AC-RRF-06 | Evidence append does not stale case_revision | RRF-01 | ☑ |
| AC-RRF-07 | Admin 409 copy | RRF-02 | ☑ |
| AC-RRF-08 | Live 5558690 after deploy (ops, not this pack’s code) | after deploy | ☐ |

## Cross-issue findings

| Found in | Belongs to | Finding | Recorded in issue |
| --- | --- | --- | --- |
| RRF-02 | leftover (out of pack) | `discrepancy-detail.tsx`, `referral-booking-form.tsx`, and `booking-command-form.tsx` still use generic 409 buckets. Not the RRF-02 helper. | RRF-02 |

## Issue log

| When | Issue | Event |
| --- | --- | --- |
| 2026-09-14 | pack | Pack authored. RRF-01 is the only `ready` issue. |
| 2026-09-14 | RRF-01 | Picked up. Repo `vantage-main-server`, branch `main`. §4 reverified: `assertActiveReferralPolicy` still requires first-evidence `booked` at `bookingOwnerCommands.ts` ~579. |
| 2026-09-14 | RRF-01 | Closed. Predicate-only helper + unit 9/9 + typecheck. Replica written, opt-in skipped. Unblocks RRF-02 and RRF-03. |
| 2026-09-14 | RRF-02 | Picked up. Repo `vantage-admin`, branch `main`. §4 reverified: `no-action-form.tsx` maps every 409 to case-revision copy. |
| 2026-09-14 | RRF-02 | Closed. `intakeOwnerCommandConflictCopy` wired on No Action / Update / booking Cancel. Identity copy does not say case revision changed. |
| 2026-09-14 | RRF-03 | Picked up after RRF-01 green. Knowledge restamp only. |
| 2026-09-14 | RRF-03 | Closed. Pointer landed. Service states first-evidence Booked or Release; latest action still gates Cancel. |
