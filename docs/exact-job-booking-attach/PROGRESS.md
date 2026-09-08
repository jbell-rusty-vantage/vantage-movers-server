# PROGRESS — Exact Job Booking Attach

**This is the live ledger. Every issue updates it — on pickup and on close.**
It is a navigation aid, not an authority. Where it disagrees with the
repository, the repository is right and the next agent fixes this file.

Pack created 2026-09-08. Protocol: [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md).
Contract: [`exact-job-booking-attach-specification.md`](exact-job-booking-attach-specification.md).

## Issue status

| Issue | Title | Prereqs | Status | Owner / agent | Started | Closed | Report |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [EJBA-01](issues/EJBA-01.md) | Job-only employee match and rematch | spec | `complete` | coordinator + grok-4.6 | 2026-09-08 | 2026-09-08 | [EJBA-01-completion.md](reports/EJBA-01-completion.md) |
| [EJBA-02](issues/EJBA-02.md) | Precise Form create + owner_booking case + Connect fence | EJBA-01 | `complete` | coordinator + grok-4.6 | 2026-09-08 | 2026-09-08 | [EJBA-02-completion.md](reports/EJBA-02-completion.md) |
| [EJBA-03](issues/EJBA-03.md) | Precise Booking Form UI | EJBA-02 | `complete` | coordinator + grok-4.6 | 2026-09-08 | 2026-09-08 | [EJBA-03-completion.md](reports/EJBA-03-completion.md) |
| [EJBA-04](issues/EJBA-04.md) | Knowledge pointers | EJBA-02, EJBA-03 | `complete` | coordinator + grok-4.6 | 2026-09-08 | 2026-09-08 | [EJBA-04-completion.md](reports/EJBA-04-completion.md) |

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
| §3 | Exact Job Booking Attach + default rules | EJBA-01 | ☑ | `employeeBookingMatching.test.ts` + `leadMatchEvaluator.test.ts` (52/52 targeted; see completion report) |
| §4.1 | Employee create outcomes | EJBA-01 | ☑ | Evaluator linked / `no_match` / `channel_conflict`; submit pending→Leadless+case unchanged. No new HTTP 201 test |
| §6 | Rematch job-only; `no_match` in default reasons | EJBA-01 | ☑ | `bookingReconciliation.test.ts` default reasons; `reconciliationRematch.service.test.ts` job-only snapshot + attach |
| §4.2–§4.6 | Precise Form create + case snapshot | EJBA-02 | ☑ | `ownerBookingAttach.test.ts` + `bookedLeadFromSource.service.test.ts` + `leadlessBooking.service.test.ts` (see completion report) |
| §5.1, §5.3 | `owner_booking` origin; Connect fence | EJBA-02 | ☑ | Case/BookedLead/list Zod `owner_booking`; `connectLead.test.ts` + `confirmAttachment.test.ts`; dismiss leaves Leadless |
| §7 | Precise Booking Form UI | EJBA-03 | ☑ | `booking-form.test.ts` + `booking-stored-lead.test.ts` + `booking-reconciliation-dashboard.test.ts` (52/52 targeted with granot-lifecycle-components; see completion report) |
| §12 | Knowledge | EJBA-04 | ☑ | `employee-bookings.md` job-only + rematch `no_match`; `bookings.md` Owner Call Lead / Owner leadless / Connect fence; `owner-booking-intake.md` pointer; Admin `project-organization.mdc` Precise Form + desk copy. See completion report |

## Coordinator emphasis (user)

The Owner must be able to **close a Booking Lead Reconciliation Case
with no Lead attached**. Some Precise Booking Form creates are
intentional Leadless Bookings: the Owner wanted the Booking filed and
does not want a syncable Lead.

- Do **not** invent a new case action. Spec §5 keeps `dismiss`.
- `dismiss` is the valid no-Lead close. The Booking stays filed and
  Leadless. The case can be reopened later.
- EJBA-02 must prove an `owner_booking` pending case can be dismissed
  without attaching a Lead, and that the Booking remains Leadless.
- EJBA-03 must treat this as a valid Owner close on Precise Form /
  `owner_booking` cases (copy: keep without a lead), not as abandoning
  a failed match.

## Cross-issue findings

| Found in | Belongs to | Note |
| --- | --- | --- |
| coordinator / user | EJBA-02, EJBA-03 | Owner can dismiss an `owner_booking` case with no Lead. Booking stays Leadless. Do not add a second action. |
| EJBA-01 | EJBA-04 | `docs/knowledge/services/employee-bookings.md` still lists the five-rule table and rematch reasons `matching_unavailable` only. Runtime is now job-only / `exact-job-v1`. |
| EJBA-02 | EJBA-01 | Two Call Leads with the same Job Number were `identity_conflict` because any two primary identities conflicted. Coordinator review changed the evaluator: same-kind job (or LID) multiples are `multiple_matches`; LID vs Job on different Leads stays `identity_conflict`. |

## Issue log

| When | Issue | Event |
| --- | --- | --- |
| 2026-09-08 | pack | Specification and ledger created. No runtime work. |
| 2026-09-08 | EJBA-01 | Picked up. Repo `vantage-main-server`, branch `exact-job-booking-attach` from clean `main`. Coordinator launching sequential Grok 4.6 implementer. |
| 2026-09-08 | EJBA-01 | Implementation started on `exact-job-booking-attach`. Changing `employeeBookingMatching.ts`, `bookingReconciliation.ts`, `leadMatchEvaluator.ts`, `leadCandidateQueries.ts`, rematch/reconciliation snapshots, `BookedLead` auto-match enum, and matching tests. |
| 2026-09-08 | EJBA-01 | Complete. Job-only employee match + rematch. Report `reports/EJBA-01-completion.md`. EJBA-02 unblocked (`ready`). |
| 2026-09-08 | EJBA-02 | Picked up after coordinator review of EJBA-01. Repo `vantage-main-server`, branch `exact-job-booking-attach`. Coordinator launching sequential Grok 4.6 implementer. Extra emphasis: Owner no-match always opens a case; dismiss closes it with no Lead; Booking stays Leadless. |
| 2026-09-08 | EJBA-02 | Implementation started on `exact-job-booking-attach`. Changing from-source / leadless create, `owner_booking` origin enums, Connect fence (`connectLead`, `confirmAttachment`, `connectBookingToLead`, `projections`), Zod Call Lead refine, `existingWrites` leadless DTO, and Precise Form / dismiss tests. |
| 2026-09-08 | EJBA-02 | Complete. Owner Call Lead Exact Job Booking Attach or Leadless + `owner_booking` case; Owner leadless always cases; Connect fence; dismiss leaves Leadless. Report `reports/EJBA-02-completion.md`. EJBA-03 unblocked (`ready`). |
| 2026-09-08 | EJBA-01 / EJBA-02 | Coordinator review: two same-job Call Leads are `multiple_matches`, not `identity_conflict`. |
| 2026-09-08 | EJBA-03 | Picked up after coordinator review of EJBA-02. Repo `vantage-admin` on existing `main` (unrelated Daily Operations dirty files — do not touch). Server pack docs stay on `vantage-main-server` `exact-job-booking-attach`. Extra emphasis: Dismiss on Precise Form cases is a valid keep-without-a-lead close. |
| 2026-09-08 | EJBA-03 | Implementation started. Admin `main` only Precise Form / Connect / Booking Lead Reconciliation files. Copy modules, optional Call phone, pending deep link, Connect hide by origin, reconciliation origin + keep-without-a-lead dismiss copy. |
| 2026-09-08 | EJBA-03 | Complete. Precise Form optional Call phone, pending deep link, Connect hide, Precise Booking Form origin label, keep-without-a-lead dismiss copy. Report `reports/EJBA-03-completion.md`. EJBA-04 unblocked (`ready`). |
| 2026-09-08 | EJBA-03 | Coordinator browser re-check after API restart: Call phone optional; job-only Call Lead submit left the client. Live create returned mongoose VersionError (“record changed”). Tests still cover the pending path. |
| 2026-09-08 | EJBA-04 | Picked up. Coordinator launching docs-keeper. |
| 2026-09-08 | EJBA-04 | Knowledge pass started. Reverified shipped code on `vantage-main-server` `exact-job-booking-attach` and `vantage-admin` `main`. |
| 2026-09-08 | EJBA-04 | Complete. Knowledge + Admin map describe Exact Job Booking Attach and `owner_booking` as shipped. Report `reports/EJBA-04-completion.md`. |
