---
type: Session note
title: Local Admin is on localhost:3001
description: Current local Vantage Admin URL for Job Timeline work. Not a product authority.
status: ready
stale_after: 2026-09-10
owners: [team:vantage-admin]
---

# Local Admin — live here

The Owner dashboard for this machine is running at:

**http://localhost:3001**

- Login: `http://localhost:3001/login`
- Job timeline: `http://localhost:3001/job-timeline`
- Next chose **3001** because **3000** was already in use.

Sign in with `ADMIN_SEED_EMAIL` and `ADMIN_SEED_PASSWORD` from
`vantage-admin/.env`. Do not paste those values into chat, commits, or
this pack.

Local Atlas SRV lookups fail unless `MONGO_DNS_SERVERS` is set in
`vantage-admin/.env` (same override as `vantage-main-server`). Without it,
`/login` can show "Invalid email or password" on a Mongo DNS 500.

This is a local session fact. It is not the production Admin URL.
