# PROGRESS — Booking intake robustness

**This is the live ledger. Every issue updates it — on pickup and on close.**
It is a navigation aid, not an authority. Where it disagrees with the
repository, the repository is right and the next agent fixes this file.

Pack created 2026-08-28. Protocol: [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md).
Contract: [`booking-intake-lead-attachment-specification.md`](booking-intake-lead-attachment-specification.md).

## Issue status

| Issue | Title | Prereqs | Status | Owner / agent | Started | Closed | Report |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [BILA-01](issues/BILA-01.md) | Intake any-known-contact search and Form submitted vs Granot display | current intake | `complete` | agent | 2026-08-28 | 2026-08-28 | [reports/BILA-01-completion.md](reports/BILA-01-completion.md) |
| [BILA-02](issues/BILA-02.md) | Confirm without a required Lead; high-confidence auto-attach | BILA-01 | `complete` | agent | 2026-08-28 | 2026-08-28 | [reports/BILA-02-completion.md](reports/BILA-02-completion.md) |
| [BILA-03](issues/BILA-03.md) | Connect Booking to Lead from `/bookings` | BILA-01, BILA-02 | `complete` | agent | 2026-08-28 | 2026-08-28 | [reports/BILA-03-completion.md](reports/BILA-03-completion.md) |

Status vocabulary: `ready` · `active` · `blocked` · `complete` · `deferred`.

## Session plan

| Session | Issues | Notes |
| --- | --- | --- |
| 1 | BILA-01 | Only startable work. |
| 2 | BILA-02 | Optional Lead. Do not parallelize with BILA-01. |
| 3 | BILA-03 | Bookings-tab Connect. Server command may start at the end of session 2 if BILA-02 is green. |

## Specification coverage

One row per specification section that this pack owns. A row is ticked
by the issue that closes it, with the evidence named.

| Spec § | Subject | Issue | Done | Evidence |
| --- | --- | --- | --- | --- |
| §4.1–4.2 | Form candidate `q` uses shared snapshot paths; DTO carries `known_contacts` | BILA-01 | ☑ | `projections.candidates.test.ts`; live candidates GET (redacted) |
| §4.3 | Intake hero + search rows show Form submitted / Granot / Changed in Granot and the cycle line | BILA-01 | ☑ | Admin fixture tests + browser steps 1–4 |
| §5.1–5.3 | Confirm `selected_lead` optional; unique high auto-attach; else Leadless | BILA-02 | ☑ | `confirmAttachment.test.ts`; Zod omit in `granotLifecycle.validation.test.ts` |
| §5.4 | Intake form submits without a Lead; medium not pre-selected | BILA-02 | ☑ | Admin `pickBestCandidate` tests; browser steps 5–6 (review only; no live Confirm) |
| §5.5 | Granot Leadless Booking stays official; review-existing / update / cancel | BILA-02 | ☑ | `bookingReconciliation.test.ts`; update/cancel unit + skipped replica names |
| §6 | Connect command + `/bookings` find → select → search → connect | BILA-03 | ☑ | `connectLead.test.ts`; `connectLeadCandidates.test.ts`; Admin Stored lead section |
| §7 | Sheet Sync intents per outcome | BILA-02, BILA-03 | ☑ | Confirm/Update in `confirmAttachment.test.ts`; Connect `booking_chain` / `booked_lead.connect_lead` in `connectLead.test.ts` |

## Acceptance criteria (specification §12)

| # | Criterion | Issue | Done |
| --- | --- | --- | --- |
| 1 | Granot-only contact search works on intake; two cards + cycle line; headline stays Form submitted | BILA-01 | ☑ |
| 2 | Confirm without unique high → Leadless; unique high auto-attaches; medium never auto; Owner selection wins; form can omit a Lead | BILA-02 | ☑ |
| 3 | Bookings tab Connect writes EntityChange + `booking_chain`; Referral/cancelled cannot; reconciliation page unchanged | BILA-03 | ☑ |
| 4 | Call rows, cancellation intake, scored search, identity, Granot writes, snapshot immutability unchanged | all | ☑ |

## Cross-issue findings

Work discovered in one issue that belongs to another. Do not fix it in
place — record it here and in the target issue.

| Found in | Belongs to | Finding | Recorded in issue |
| --- | --- | --- | --- |
| — | — | — | — |

## Issue log

| When | Issue | Event |
| --- | --- | --- |
| 2026-08-28 | pack | Pack authored. BILA-01 is the only `ready` issue. |
| 2026-08-28 | BILA-01 | Picked up. Status → `active`. Repos: `vantage-main-server` then `vantage-admin`. Both desks are on `main` (no `granot-lead-lifecycle` checkout; trees already have unrelated pack/docs edits, so no extra feature branch). |
| 2026-08-28 | BILA-01 | Closed. Status → `complete`. BILA-02 → `ready`. Report: `reports/BILA-01-completion.md`. |
| 2026-08-28 | BILA-02 | Picked up. Status → `active`. Repos: `vantage-main-server` then `vantage-admin`. Both desks are on `main` (no extra feature branch; trees already have unrelated pack/docs edits). |
| 2026-08-28 | BILA-02 | Closed. Status → `complete`. BILA-03 → `ready`. Report: `reports/BILA-02-completion.md`. |
| 2026-08-28 | BILA-03 | Picked up. Status → `active`. Repos: `vantage-main-server` then `vantage-admin`. Both desks are on `main` (no extra feature branch; trees already have unrelated pack/docs edits). |
| 2026-08-28 | BILA-03 | Closed. Status → `complete`. Report: `reports/BILA-03-completion.md`. Pack specification coverage for §6 and Connect Sheet Sync is ticked. |
