---
type: Session note
title: Local Admin is on localhost:3000
description: Current local Vantage Admin URL for booking-intake lead-attachment work. Not a product authority.
status: ready
stale_after: 2026-09-28
owners: [team:vantage-admin]
---

# Local Admin — live here

The Owner dashboard for this machine is running at:

**http://localhost:3000**

- Login: `http://localhost:3000/login`
- Booking intakes: `http://localhost:3000/intakes`
- Bookings tab: `http://localhost:3000/bookings`
- Form Leads (parent already shipped): `http://localhost:3000/form-leads`

The local main-server API is on **http://localhost:3001**. An earlier session note put Admin on 3001 because 3000 was busy; this desk has Admin on 3000 again.

Sign in with `ADMIN_SEED_EMAIL` and `ADMIN_SEED_PASSWORD` from
`vantage-admin/.env`. Do not paste those values into chat, commits, or
this pack.

Local Atlas SRV lookups fail unless `MONGO_DNS_SERVERS` is set in
`vantage-admin/.env` (same override as `vantage-main-server`). Without it,
`/login` can show "Invalid email or password" on a Mongo DNS 500.

This is a local session fact. It is not the production Admin URL.
