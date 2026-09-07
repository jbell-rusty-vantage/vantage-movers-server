---
type: Session note
title: Local Admin is on localhost:3000
description: Current local Vantage Admin URL for Daily Operations work. Not a product authority.
status: ready
stale_after: 2026-12-06
owners: [team:vantage-admin]
---

# Local Admin — live here

The Owner dashboard for this machine is running at:

**http://localhost:3000**

- Login: `http://localhost:3000/login`
- Daily Operations (after DOP-06): `http://localhost:3000/daily`
- Overview: `http://localhost:3000/`
- Live Events: `http://localhost:3000/live-events`
- Intakes: `http://localhost:3000/intakes`
- Form Leads: `http://localhost:3000/form-leads`
- Call Leads: `http://localhost:3000/call-leads`
- Bookings: `http://localhost:3000/bookings`
- Cancellations: `http://localhost:3000/cancellations`

The local main-server API is on **http://localhost:3001**.

Sign in with `ADMIN_SEED_EMAIL` and `ADMIN_SEED_PASSWORD` from
`vantage-admin/.env`. Do not paste those values into chat, commits, or
this pack.

Local Atlas SRV lookups fail unless `MONGO_DNS_SERVERS` is set in
`vantage-admin/.env` (same override as `vantage-main-server`). Without it,
`/login` can show "Invalid email or password" on a Mongo DNS 500.

Redis doorbell (optional local proof): `KV_REST_API_URL` +
`KV_REST_API_TOKEN` or `UPSTASH_REDIS_*` in `vantage-main-server/.env`.
Do not paste tokens. Tests must not hit the real Upstash project.

This is a local session fact. It is not the production Admin URL.
