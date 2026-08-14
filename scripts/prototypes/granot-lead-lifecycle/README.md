# PROTOTYPE — Granot / Vantage Lead Lifecycle

This disposable prototype asks one question:

> Can one small, pure module explain Granot observations and authoritative
> Vantage Booking/Cancellation commands while preserving Lead identity,
> transition invariants, provenance, reconciliation, and Sheet Sync intent?

It uses real platform names from `docs/operations-name-link-inventory.md`:
`Top10 Forms`, `Top10 Inbounds`, `top10_leads`,
`top10_leads_form`, `top10_leads_call`, Agent `Mike` / username `MIKEM`, and
Merchant `Cardpointe`. IDs, phone numbers, emails, job numbers, and financial
values are deliberately fake.

It does not connect to MongoDB, Granot, RingCentral, Google Sheets, Vercel
Queues, or any other live system.

Run interactively:

```powershell
pnpm prototype:granot-lifecycle
```

In the terminal: `[p]` Priority 5, `[b]` confirm Booking, `[c]` receive
Release, `[u]` update Booking, `[x]` confirm Cancellation, `[d]` dismiss.

Run the executable scenario assertions:

```powershell
pnpm prototype:granot-lifecycle -- --scenarios
```

The portable candidate is `domain.ts`; `cli.ts`, `fixtures.ts`, and
`scenarios.ts` are disposable exploration shells. Delete or absorb this folder
after the model is accepted.

The proposed production persistence depth, concrete Mongoose schema sketches,
and lifecycle/provenance illustrations are in
[`SUGGESTED-DOMAIN-MODELS-AND-PROVENANCE.md`](./SUGGESTED-DOMAIN-MODELS-AND-PROVENANCE.md).

The owner-hidden Priority 5 → notification → editable Suggested Booking Lead →
Confirm Granot Booking flow is documented and exercised in
[`GRANOT-BOOKING-INTAKE-PROTOTYPE.md`](./GRANOT-BOOKING-INTAKE-PROTOTYPE.md).

The owner-hidden `booking_status_changed` / `Releas`|`Release` → notification →
Linked Cancellation Booking → Confirm Granot Cancellation **or** Update Granot
Booking **or** dismiss flow is documented and exercised in
[`GRANOT-CANCELLATION-INTAKE-PROTOTYPE.md`](./GRANOT-CANCELLATION-INTAKE-PROTOTYPE.md).
Granot confirmed that `Booked` and `Release` are CRM button actions, a job can
have many of each, and `job_no` is the identity that must stay idempotent.
Captured payloads truncate `Release` to `Releas`; both spellings are aliases.

Which fields exist at ingest versus after Granot enrichment — including the
WordPress form path, the RingCentral call path, Booking/Cancellation links, and
captured webhook payloads that are not yet in the lifecycle — is in
[`LEAD-ENRICHMENT-STATES-AND-FIELDS.md`](./LEAD-ENRICHMENT-STATES-AND-FIELDS.md).

The production naming, additive route plan, and webhook processing
recommendation (capture `202` + Mongo claim + Vercel Queue wake-up + cron
safety net; `waitUntil` publishes only) are in
[`GRANOT-LIFECYCLE-PRODUCTION-SPEC.md`](./GRANOT-LIFECYCLE-PRODUCTION-SPEC.md).
Hand that file to the next agent as the specification source.
