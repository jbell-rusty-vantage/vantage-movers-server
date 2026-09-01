# Operator apply — Release cases + evidence index

**Date:** 2026-09-01  
**Database:** `vantagemovers`  
**Flags:** unchanged

## Release cases into booking intake

```
pnpm migration:granot-lifecycle:release-cases-into-booking-intake -- --report
pnpm migration:granot-lifecycle:release-cases-into-booking-intake -- --apply --confirm-production=vantagemovers
pnpm migration:granot-lifecycle:release-cases-into-booking-intake -- --verify --confirm-production=vantagemovers
```

Apply result:

- 1 booking case opened (job `5556796`, sequence 2, `review_existing_booking`)
- 5 booking cases refreshed with Release evidence
- 6 Release cases resolved (`no_action` / `migrated_to_booking_intake`)
- 0 official Booking or Cancellation writes
- 11 `release_without_vantage_booking` discrepancies left historical

Verify: `ok: true`, 0 open Release cases remaining.

Manifests under `scripts/output/granot-lifecycle-release-cases-into-booking-intake/`.

## Evidence index

Did **not** run the full `migration:granot-lifecycle:indexes` catalog apply (that CLI collision-scans every lifecycle collection and can stop on known Record Link uniques).

Created only `granot_booking_case_evidence_observation_id` on `granot_booking_reconciliation_cases` (`evidence.observation_id: 1`). Verified present after create.
