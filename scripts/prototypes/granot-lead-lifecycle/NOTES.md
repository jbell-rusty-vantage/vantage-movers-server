# Prototype verdict

Initial automated scenarios support the following candidate decisions:

- A Lead Lifecycle is derived from linked records and facts, not one status enum.
- `lead_created` establishes a Granot Record Link; it does not ingest a Lead.
- Granot Priority `1` and `5` can drive the existing enrichment policy.
- Granot Priority `5` opens a Granot Booking Intake Case when official Booking
  details are missing. Missing details are expected intake work, not a conflict.
- The Suggested Booking Lead is owner-changeable and never attaches itself.
- Only Confirm Granot Booking with official Book Date, Agent Allocations,
  Binder, Deposit, and Merchant creates the Booking and Booking Chain.
- Granot estimate is context only; it never becomes Binder or Deposit.
- Granot Booking Discrepancy is reserved for conflict with an existing Booking
  or established Granot Record Link.
- A complete Vantage Booking command—not Granot Priority—sets `Lead.booked`.
- Cancellation is additive: `Lead.booked` remains while `Lead.cancelled` is set.
- `booking_status_changed` with `Releas` or `Release` opens a Granot
  Cancellation Intake Case when an active Booking exists. It never creates a
  Cancellation or mutates a Booking by itself. The owner may cancel, update
  the existing Job Number Booking, dismiss, or leave the case open.
- Granot confirmed `Booked` and `Release` are CRM button actions. A job can
  have many of each. Stay idempotent on `job_no`. Captured payloads truncate
  `Release` to `Releas`; both spellings are aliases.
- `event_type` (`Booked` / `Releas` / `Release`) and Granot Priority are
  separate snapshot fields. Captured receipts pair both actions with Priority
  `0`, `1`, and `5`. `Booked` + Priority `0` is not unbooked. A Release at
  Priority `0` is a snapshot, not cancel-by-priority.
- The Linked Cancellation Booking is deterministic. A wrong link is a Granot
  Cancellation Discrepancy, not a dropdown.
- Only Confirm Granot Cancellation with official Refund and Cancel Date
  creates the Cancellation and Cancellation Chain. Only Update Granot Booking
  mutates the existing Booking. Granot payment stays context only.
- Observation Channels converge through desired state and provenance.
- Unknown priorities and source labels remain explicit blocked decisions.
- Call Lead creation remains owned by RingCentral Call Qualification.
- Routine synchronization remains hidden from the owner's primary workflow;
  only policy-promoted booking intake, cancellation intake, and conflict cases
  are surfaced.

Before absorbing the module, confirm remaining Granot Priority meanings
(`2`, `3`, `7`, `8`, `9`) documented in
`docs/granot-webhook-domain-service-model.md`. Booking-status vocabulary
(`Booked` / `Release`, `Releas` alias, Job Number idempotency) is confirmed.
