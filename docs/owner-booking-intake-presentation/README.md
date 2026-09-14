---
type: Delivery Pack
title: Owner booking intake presentation
description: >-
  Navigation for the Owner /intakes copy and CTA spec. Presentation
  only. Does not change case open/refresh.
tags:
  - granot-lifecycle
  - booking
  - owner-dashboard
  - delivery
status: proposed-final
stale_after: 2026-12-14
owners: [team:main-server, team:vantage-admin]
applies_to:
  - vantage-admin/components/intakes/intake-copy.ts
  - vantage-admin/components/intakes/intake-list.tsx
  - vantage-main-server/src/services/granotLifecycle/projections.ts
---

# Owner booking intake presentation

The specification wins:
[`owner-booking-intake-presentation-specification.md`](owner-booking-intake-presentation-specification.md).

Owner `/intakes` copy and CTAs. Two postures. List-level **No
Action** on review cards. **Confirm Granot Cancellation** is not
shown on that desk. **Release** is not a **Cancellation**.

This pack does **not** change case open/refresh, even **Binder**,
optional **Lead**, or public Referral / Leadless cancel.
