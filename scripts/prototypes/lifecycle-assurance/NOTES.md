# Prototype verdict

Production read completed on 2026-08-27 against `vantagemovers`, with a rolling
24-hour window and no database mutation.

## Answer

- Granot is internally reconcilable at high confidence: every receipt in the
  checked window had an Observation and latest Decision, and every one of the
  174 applied/created latest Decisions had exact EntityChange evidence.
- RingCentral has stronger source assurance than initially assumed. Its durable
  processed-call ledger reconciled 20/20 materialized outcomes to Call Leads,
  and the successful Call Log cursor was less than ten minutes behind the
  report. Assurance is valid only through that cursor.
- WordPress Lead creation is visible in `form_leads` and command-backed Changes,
  but there is no independent submission receipt ledger. Source completeness is
  therefore bounded.
- Lead Message records and provider statuses answer whether Vantage attempted
  and delivered a text. Absence is not automatically failure because messaging
  gates may intentionally block a message.
- Booking and Cancellation intake cases are strong evidence of owner work, but
  are not official facts. `booked_leads` and `cancelled_leads` remain the official
  facts.
- Historical Cancellation Job Number traceability is incomplete: 48 official
  Cancellations exist, but only 11 retain a surviving Booking from which Job
  Number can be recovered. The Cancellation row itself stores only Booking ID.
- Sheet Sync outbox status proves intent and worker completion, not present-day
  Google row equality. Google read-back remains required for verified destination
  assurance.
- Move completion is not represented in the current system of record.

The durable answer is the generated `scripts/output/lifecycle-assurance/assurance-latest.md`.
The prototype should be absorbed into an Owner Daily assurance module only after
the confidence vocabulary and the two missing edge proofs (WordPress receipts,
Google read-back) are accepted.
