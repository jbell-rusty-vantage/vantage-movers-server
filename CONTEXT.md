# Vantage Main Server

Express API and system of record for leads, bookings, cancellations, and server-side integrations (Granot CRM posting, Sheet Sync, Ring Central, Workflow Observational).

**Platform domain language:** [`../CONTEXT.md`](../CONTEXT.md)

**ADRs:** [`../docs/adr/`](../docs/adr/)

**Agent consumer rules:** [`../docs/agents/domain.md`](../docs/agents/domain.md)

Codebase-specific domain terms, if any, will be added here later. Shared vocabulary always defers to the root glossary.

## Employee Booking Reconciliation

- `employee booking submission`: public/employee intake command that always aims
  to create exactly one booking, even when lead matching is ambiguous.
- `booking lead reconciliation case`: owner-facing work item for attaching or
  correcting the source lead for an already-created employee booking.
- `employee booking origin`: `BookedLead.booking_origin === "employee_booking"`,
  used to scope idempotency, reconciliation, rematch, and cancellation parity.
- `matching unavailable`: technical matcher failure where Mongo remains writable,
  so the booking and reconciliation case still commit.
