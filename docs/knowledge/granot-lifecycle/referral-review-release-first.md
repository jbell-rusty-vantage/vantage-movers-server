---
type: Reference
title: Referral review Release-first owner commands
description: Pointer to the Referral review Release-first contract. Does not copy spec rules.
tags: [granot-lifecycle, spec, booking, referral]
status: landed
stale_after: 2026-12-14
resource: docs/referral-review-release-first/referral-review-release-first-specification.md
applies_to:
  - docs/referral-review-release-first/referral-review-release-first-specification.md
  - src/services/granotLifecycle/bookingOwnerCommands.ts
  - vantage-admin/components/granot-lifecycle/no-action-form.tsx
  - vantage-admin/components/intakes/intake-copy.ts
owners: [team:main-server, team:vantage-admin]
sources:
  - id: spec
    resource: docs/referral-review-release-first/referral-review-release-first-specification.md
    title: Referral review Release-first owner commands
generated:
  by: process:docs-keeper
  at: 2026-09-14T20:35:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**Authority:** [`referral-review-release-first-specification.md`](../../referral-review-release-first/referral-review-release-first-specification.md)

# Referral review Release-first owner commands

This file is a **Reference** pointer only. It does not copy contract rules.

- [Referral review Release-first specification](../../referral-review-release-first/referral-review-release-first-specification.md) — Owner No Action / Update / Confirm Granot Cancellation on a Referral `review_existing_booking` whose first evidence may be Release. Create Referral Booking minting stays Booked-only. Delivery: [`README.md`](../../referral-review-release-first/README.md).

**Shipped:** The leftover booked-first check is shipped. Referral review revalidates first-evidence Decision/policy; first action may be Booked or Release. Latest action still gates Confirm Granot Cancellation. Service current-state: [`booking-reconciliation.md`](./booking-reconciliation.md).
