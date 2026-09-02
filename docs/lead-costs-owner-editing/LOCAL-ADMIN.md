---
type: Session note
title: Local Admin is on localhost:3000
description: Current local Vantage Admin URL for Lead Costs work. Not a product authority.
status: ready
stale_after: 2026-12-02
owners: [team:vantage-admin]
---

# Local Admin — live here

The Owner dashboard for this machine is running at:

**http://localhost:3000**

- Login: `http://localhost:3000/login`
- Lead costs: `http://localhost:3000/operations-registry?tab=lead-costs`
- By date: `http://localhost:3000/operations-registry?tab=lead-costs&cpl_mode=advanced`
- Existing leads: `http://localhost:3000/operations-registry?tab=lead-costs&cpl_mode=corrections`

The local main-server API is on **http://localhost:3001**.

Sign in with `ADMIN_SEED_EMAIL` and `ADMIN_SEED_PASSWORD` from
`vantage-admin/.env`. Do not paste those values into chat, commits, or
this pack.

Local Atlas SRV lookups fail unless `MONGO_DNS_SERVERS` is set in
`vantage-admin/.env` (same override as `vantage-main-server`). Without
it, `/login` can show "Invalid email or password" on a Mongo DNS 500.

This is a local session fact. It is not the production Admin URL.
