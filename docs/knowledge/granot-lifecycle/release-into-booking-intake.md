---
type: Reference
title: Release into booking intake and Live Events link
description: Pointer to the Release-into-booking-intake contract. Does not copy spec rules.
tags: [granot-lifecycle, spec, booking, owner-dashboard]
status: draft
stale_after: 2027-03-01
resource: docs/granot-lead-lifecycle/release-into-booking-intake-specification.md
applies_to:
  - docs/granot-lead-lifecycle/release-into-booking-intake-specification.md
  - src/services/granotLifecycle/bookingReconciliation.ts
  - src/services/granotLifecycle/processor.ts
  - vantage-admin/app/(dashboard)/intakes
  - vantage-admin/components/intakes/intake-copy.ts
owners: [team:main-server, team:vantage-admin]
sources:
  - id: spec
    resource: docs/granot-lead-lifecycle/release-into-booking-intake-specification.md
    title: Release into booking intake and Live Events intake link
generated:
  by: process:docs-keeper
  at: 2026-09-01T18:20:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**Authority:** [`release-into-booking-intake-specification.md`](../../granot-lead-lifecycle/release-into-booking-intake-specification.md)

# Release into booking intake and Live Events link

This file is a **Reference** pointer only. It does not copy contract rules.

- [Release into booking intake](../../granot-lead-lifecycle/release-into-booking-intake-specification.md) — `Releas` / `Release` upsert onto the Granot Booking Reconciliation Case; cancellation intakes retired; Live Events **Open booking intake** when that receipt’s Observation is on the case.

Service docs describe current behavior: [`booking-reconciliation.md`](./booking-reconciliation.md), [`release-reconciliation.md`](./release-reconciliation.md), [`processor.md`](./processor.md), [`projections.md`](./projections.md). Locked rules stay in the spec. The Live Events page and its receipt list/SSE reads were retired in the 2026-10 server/admin slimming (SLIM-02), so the Live Events **Open booking intake** link no longer has a host page.
