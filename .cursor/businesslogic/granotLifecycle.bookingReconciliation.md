**Platform glossary:** [`../../../CONTEXT.md`](../../../CONTEXT.md)  
**Primary code:** `src/services/granotLifecycle/bookingReconciliation.ts`, `src/models/GranotBookingReconciliationCase.ts`, `src/services/granotLifecycle/processor.ts`, `scripts/migrations/granot-lifecycle-indexes.ts`  
**Domain terms used:** Granot Booking Reconciliation Case, Synchronization Decision, Granot Observation, Source Scope, Booking Lead Reconciliation

# Granot Booking reconciliation (`granotLifecycle/bookingReconciliation`)

**Role:** Persist evidence-backed owner work for Priority `5` and actual Booked observations. A case is not a Booking and never changes an official Lead, Booking, Cancellation, Record Link, or employee reconciliation workflow.

## Trigger and routing

The channel-neutral processor is the only caller. It passes only immutable Observation/Decision IDs after activation, live-mode classification, source policy/identity, and the exact Booking-case gate snapshot. Historical shadow, live shadow, disabled gates, Release, missing Job, and unsupported evidence create no case.

| Current evidence/fact | Result |
| --- | --- |
| Priority `5`, eligible Lead, no Booking | open/refresh `create_missing_booking` |
| Priority `5`, existing Booking | no case |
| actual Booked, no Booking | open/refresh `create_missing_booking`; ambiguous Lead means no suggestion |
| actual Booked, one active Booking | open/refresh `review_existing_booking` with its ID |
| Booking without Lead | delegate to existing `BookingLeadReconciliationCase`; fail closed if missing |
| officially cancelled Booking | typed `booked_after_official_cancellation` routing only |
| Referral | Unit 28; no Unit 22 case |
| identity/Job/source conflict | typed Unit 29 routing only |

Priority validity never suppresses a valid actual Booked action. Priority `5` alone never opens review-existing. Booking work never reads, closes, or mutates Release work.

## Transaction, uniqueness, and revisions

Within one Mongo transaction the service rereads the Observation, active link, current Unit 14 identity, deterministic Booking/Cancellation facts, and current employee reconciliation work. It finds the open `{job, booked}` case; otherwise it allocates `max(sequence_number)+1`. The case write and effect-bearing immutable Decision commit together. Duplicate/open/sequence races receive at most one explicit retry.

The exact unique indexes are open `{normalized_job_no, action_kind}` (partial on `state:"open"`) and `{normalized_job_no, action_kind, sequence_number}`. Three additional read indexes cover state/evidence time, Booking/state, and suggested Lead/state. Migration report masks Job/document identifiers, reports collisions before unique creation, creates non-unique definitions first, and never applies without explicit authorization.

Open starts with `case_revision=1`, `evidence_revision=1`. A new Observation appends the four-field evidence tuple and increments only `evidence_revision`; exact replay changes nothing. Suggestion/current-work changes increment `case_revision`. Resolved rows cannot be reopened or otherwise modified, and later evidence creates the next sequence. Unit 22 exposes no resolution writer.

## Suggestions, privacy, and posture

Suggestions/candidates are projections of the current Unit 14 identity result, not a second matcher. Record Link, exact Form, exact Call Job, and Booking-owner evidence are high confidence; Source Scope contact is medium; ambiguity has no suggestion. Duplicate Form and Bad Form rows are excluded. Candidate search rereads current identity and is available internally for 24 hours only; it never attaches or corrects a Lead.

Evidence contains IDs, capture time, and action only. Bounded display context is separate and never becomes an official Booking input. Open/refresh events contain masked IDs; `granot_lifecycle_open_cases{kind="booking",mode}` is recomputed cardinality, so evidence refresh does not increment it.

Checked-in `GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED=false` and every Booking/Release/Referral/email command flag remains false. Unit 23 owns read APIs/Admin review before a separately approved case enablement; Units 24–25 own owner commands.
