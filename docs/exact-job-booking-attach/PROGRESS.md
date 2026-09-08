# PROGRESS — Exact Job Booking Attach

**This is the live ledger. Every issue updates it — on pickup and on close.**
It is a navigation aid, not an authority. Where it disagrees with the
repository, the repository is right and the next agent fixes this file.

Pack created 2026-09-08. Protocol: [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md).
Contract: [`exact-job-booking-attach-specification.md`](exact-job-booking-attach-specification.md).

## Issue status

| Issue | Title | Prereqs | Status | Owner / agent | Started | Closed | Report |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [EJBA-01](issues/EJBA-01.md) | Job-only employee match and rematch | spec | `ready` | | | | |
| [EJBA-02](issues/EJBA-02.md) | Precise Form create + owner_booking case + Connect fence | EJBA-01 | `blocked` | | | | |
| [EJBA-03](issues/EJBA-03.md) | Precise Booking Form UI | EJBA-02 | `blocked` | | | | |
| [EJBA-04](issues/EJBA-04.md) | Knowledge pointers | EJBA-02, EJBA-03 | `blocked` | | | | |

Status vocabulary: `ready` · `active` · `blocked` · `complete` · `deferred`.

## Session plan

| Session | Issues | Notes |
| --- | --- | --- |
| 1 | EJBA-01 | Server only. Employee + rematch. |
| 2 | EJBA-02 | From-source + leadless + Connect fence. |
| 3 | EJBA-03 | Admin Precise Booking Form. |
| 4 | EJBA-04 | Knowledge after both runtime issues. |

## Specification coverage

| Spec § | Subject | Issue | Done | Evidence |
| --- | --- | --- | --- | --- |
| §3 | Exact Job Booking Attach + default rules | EJBA-01 | ☐ | |
| §4.1 | Employee create outcomes | EJBA-01 | ☐ | |
| §6 | Rematch job-only; `no_match` in default reasons | EJBA-01 | ☐ | |
| §4.2–§4.6 | Precise Form create + case snapshot | EJBA-02 | ☐ | |
| §5.1, §5.3 | `owner_booking` origin; Connect fence | EJBA-02 | ☐ | |
| §7 | Precise Booking Form UI | EJBA-03 | ☐ | |
| §12 | Knowledge | EJBA-04 | ☐ | |

## Cross-issue findings

| Found in | Belongs to | Note |
| --- | --- | --- |
| | | |

## Issue log

| When | Issue | Event |
| --- | --- | --- |
| 2026-09-08 | pack | Specification and ledger created. No runtime work. |
