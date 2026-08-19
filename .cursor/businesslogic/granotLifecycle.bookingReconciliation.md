**Platform glossary:** [`../../../CONTEXT.md`](../../../CONTEXT.md)  
**Primary code:** `src/services/granotLifecycle/bookingReconciliation.ts`, `bookingConfirmation.ts`, `bookingOwnerCommands.ts`, `src/models/GranotBookingReconciliationCase.ts`, `src/services/granotLifecycle/processor.ts`
**Domain terms used:** Granot Booking Reconciliation Case, Update Existing Booking, No Action, Synchronization Decision, Granot Observation, Source Scope

# Granot Booking reconciliation (`granotLifecycle/bookingReconciliation`)

**Role:** Persist evidence-backed owner work for Priority `5` and actual Booked observations. A case is not a Booking. Official Booking changes occur only through explicit Owner commands.

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

Open starts with `case_revision=1`, `evidence_revision=1`. A new Observation appends the four-field evidence tuple and increments only `evidence_revision`; exact replay changes nothing. Suggestion/current-work changes increment `case_revision`. Resolved rows cannot be reopened or otherwise modified, and later evidence creates the next sequence. Evidence refresh therefore never stales an Owner draft keyed by `case_revision`.

## Owner commands

Every command requires the exact Owner-derived actor, one strict `Idempotency-Key`, the first case-evidence Receipt/Observation/Decision chain, an enabled Booking-command gate, and current reviewed Registry/source facts. Checked-in command defaults remain false.

- `confirmGranotBooking` resolves an open `create_missing_booking` case. It requires an eligible selected Lead (Duplicate/Bad/cancelled rejected; all-scope needs a 10–500 override) and explicit official Booking details. Same-state existing Booking plus matching Record Link is `already_satisfied`.
- `updateBooking` is available only for open `review_existing_booking`. It revalidates the deterministic active Booking, normalized Job, linked Lead/source, optional active Record Link, exact Booking/case revisions, and active Agent/Merchant IDs. It fully replaces only Book Date, Agent allocations, total Binder, Deposit, and Merchant; derived deposit thresholds alone may mirror to the already-linked Lead. One transaction writes aggregate Change(s), case resolution, Command, and one coalescible queued Booking Chain intent. Identity/source/contact/local/submission/cancellation fields cannot change.
- `resolveGranotBookingCaseNoAction` is available for open standard create-missing or review-existing cases. Optional reason code/text are metadata only. Its transaction writes the Command plus one case resolution/revision and creates no aggregate revision, `EntityChange`, Sheet Sync intent, link, discrepancy, notification, or replacement case.

Exact replay returns the durable result. A same-state update resolves `already_satisfied` without aggregate Change/outbox. Case and Booking compare-and-swap filters produce one winner; stale case, stale/cancelled Booking, and link/Job/source incompatibility fail closed. External Sheet delivery is post-commit only.

## Suggestions, privacy, and posture

Suggestions are projections of the current Unit 14 identity result. Record Link, exact Form, exact Call Job, and Booking-owner evidence are high confidence; Source Scope contact is medium; ambiguity has no suggestion. Unit 23's case-scoped browser additionally queries current eligible Leads for Owner review, defaults to Source Scope, and marks all-scope rows with override-warning metadata. Duplicate Form and Bad Form rows are excluded server-side. Browsing and the 24-hour identity refresh never attach or correct a Lead.

Evidence contains IDs, capture time, and action only. Bounded display context is separate and never becomes an official Booking input. Open/refresh events contain masked IDs; `granot_lifecycle_open_cases{kind="booking",mode}` is recomputed cardinality, so evidence refresh does not increment it.

Checked-in `GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED=false` and `GRANOT_LIFECYCLE_BOOKING_COMMANDS_ENABLED=false`; Release/Referral/email flags also remain false. Protected reads advertise standard confirm/update/No Action only when the Booking-command flag is true. Deployment, production index verification, and narrow source/effect enablement remain separately authorized.
