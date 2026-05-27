# 05 Cancellation Services Refactor

## Purpose

Extract cancellation lifecycle, cancellation booking resolution, and cancellation mirror behavior from `api/services/v1.service.ts`.

This task should happen after lead lookup and booking mirror modules exist.

## Read First

- `api/services/v1.service.ts`
- `api/models/CancelledLead.ts`
- `api/models/BookedLead.ts`
- `api/models/FormLead.ts`
- `api/models/CallLead.ts`
- `api/validation/v1.validation.ts`
- `api/services/bookings/` if already created
- `api/services/leads/` if already created
- `api/services/sheetSync/` if already created

## Current Functions To Extract

Cancellation lifecycle:

- `createCancelledLead`
- `updateCancelledLead`
- `findAllCancelledLeads`
- `deleteCancelledLead`

Cancellation resolution:

- `resolveBookedLeadForCancellation`
- `getBookedLeadForCancellation`

Cancellation mirror behavior:

- `mirrorCancellationToLead`
- `clearCancellationFromLead`
- cancellation portions of booking/source sync chain if not already moved to sheet sync

## Target Files

```text
api/services/cancellations/
  cancelledLead.service.ts
  cancellationResolver.ts
  cancellationMirror.service.ts
  index.ts
```

Suggested ownership:

- `cancelledLead.service.ts`: create/update/find/delete cancellation records and call resolver/mirror/sync helpers.
- `cancellationResolver.ts`: resolve booking by `booked_lead` or source `lead_id`, including conflict behavior.
- `cancellationMirror.service.ts`: mirror cancellation state to booked lead and source lead documents, and clear it on delete.

## Compatibility Exports

Keep these exported from `api/services/v1.service.ts`:

- `createCancelledLead`
- `updateCancelledLead`
- `findAllCancelledLeads`
- `deleteCancelledLead`

## Agent Instructions

1. Move resolver logic first.
2. Move mirror helpers next.
3. Move `createCancelledLead` and `updateCancelledLead` after resolver and mirror helpers compile.
4. Move `deleteCancelledLead` last because it clears mirror state and sheet state.
5. Keep current conflict status codes and messages.
6. Keep sheet sync calls delegated to `services/sheetSync/`.
7. Re-export route-facing functions from `v1.service.ts`.
8. Run `pnpm typecheck` and `pnpm test`.

## Behavioral Invariants

- Create must still require either `booked_lead` or `lead_id` through validation.
- Resolver conflict behavior must not change when the provided booking/source lead do not match.
- Already-cancelled booking handling must not change.
- Cancellation must still mirror to booked lead and source lead.
- Delete must still clear mirrored cancellation state.
- Sheet sync scheduling must happen at the same points as before.

## Suggested Tests

- Resolve by booked lead ID.
- Resolve by source lead ID.
- Resolve mismatch conflict.
- Missing booking or lead.
- Already-cancelled booking.
- Create mirrors cancellation state.
- Delete clears cancellation state.

## Handoff To Next Agent

Report:

- Whether cancellation modules still import anything from `v1.service.ts`.
- Whether mirror services depend on booking modules cleanly.
- Any remaining delete cascade behavior that should become a shared orchestration module.

The next agent can then work on search, enrichment, and reconciliation services with the core lifecycle services separated.
