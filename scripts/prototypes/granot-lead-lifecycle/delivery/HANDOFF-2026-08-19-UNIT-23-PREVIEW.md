# Granot lifecycle Unit 23 preview deployment handoff

Date: 2026-08-19 (updated after Preview deploy)

## Current position

The Unit 23 read-only Granot lifecycle review surface is deployed to Vercel Preview on both repositories. Synthetic redacted fixtures are in Atlas `testvantagemovers`. Production was not changed. Owner review is ready and is still the Unit 24 gate.

Do not start Unit 24 commands until the Owner explicitly accepts this read-only Preview.

Authoritative contracts remain:

- `scripts/prototypes/granot-lead-lifecycle/delivery/issues/UNIT-23.md`
- `scripts/prototypes/granot-lead-lifecycle/delivery/issues/UNIT-24.md`
- `scripts/prototypes/granot-lead-lifecycle/delivery/UNIT-STATUS.md`

## Deployed Preview (use these)

### Server

- Repository: `vantage-main-server`
- Branch: `granot-lead-lifecycle`
- Commit: `f6c8adf` — `Fix Vercel preview TypeScript ObjectId and Google API typing.`
- URL: `https://vantage-movers-main-server-qixyrlard-vantage-4d3db9ef.vercel.app`
- Deployment: `dpl_GBwe3bMhzjnTC5UZPU18TxLAqXdN`
- Inspector: `https://vercel.com/vantage-4d3db9ef/vantage-movers-main-server/GBwe3bMhzjnTC5UZPU18TxLAqXdN`
- Target: Preview (`githubCommitRef=granot-lead-lifecycle`)
- Functions: seven intended lambdas (`api/index` plus the six queue consumers). No `*.test.func`.
- Build: READY, no TypeScript failures in the remote logs.

Do not use the earlier READY deployment `dpl_A1dwH6Py3oBb78dshvzBq8SLGAQc`. It predates the compatibility commit.

### Admin

- Repository: `vantage-admin`
- Branch: `granot-lead-lifecycle` (now pushed)
- Commit: `239dc0f` — `unit 23 in the granot lead lifecycle complete`
- URL: `https://vantage-admin-9hzabj3zw-vantage-4d3db9ef.vercel.app`
- Deployment: `dpl_zaXPxTr8TykNx2R3icLxvqk4W6Hd`
- Inspector: `https://vercel.com/vantage-4d3db9ef/vantage-admin/zaXPxTr8TykNx2R3icLxvqk4W6Hd`
- Target: Preview (`githubCommitRef=granot-lead-lifecycle`)
- Branch-specific Preview env: `VANTAGE_API_BASE_URL=https://vantage-movers-main-server-qixyrlard-vantage-4d3db9ef.vercel.app`
- The existing Production+Preview `VANTAGE_API_BASE_URL` from 78 days ago was left in place.

Owner-only entry:

- Queue: `https://vantage-admin-9hzabj3zw-vantage-4d3db9ef.vercel.app/ingestion/granot/lifecycle`

## Safety envelope (unchanged)

Server Preview branch `granot-lead-lifecycle` still has:

```text
TEST_MODE=true
SHEET_SYNC_MODE=disabled
GRANOT_LIFECYCLE_PROCESSING_ENABLED=true
GRANOT_LIFECYCLE_SHADOW_MODE=true
GRANOT_LIFECYCLE_LEAD_WRITES_ENABLED=false
GRANOT_LIFECYCLE_LEAD_CREATION_ENABLED=false
GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED=false
GRANOT_LIFECYCLE_BOOKING_COMMANDS_ENABLED=false
GRANOT_LIFECYCLE_RELEASE_CASES_ENABLED=false
GRANOT_LIFECYCLE_RELEASE_COMMANDS_ENABLED=false
GRANOT_LIFECYCLE_REFERRAL_BOOKING_ENABLED=false
GRANOT_LIFECYCLE_EMAIL_ENABLED=false
```

`TEST_MODE=true` selects Mongo database `testvantagemovers`. Production `vantagemovers` was not written by this seed.

## Verification already completed

- Server focused Unit 23 suite: 33/33 after the compatibility commit.
- Server Preview inspect: READY, seven functions, no test function, no `error TS` in logs.
- Unsigned Preview `GET /api/v1/admin/granot-lifecycle/cases` returns `401 {"ok":false,"error":"Unauthorized"}`.
- Unauthenticated Admin `/ingestion/granot/lifecycle` returns `307` to login.
- Local projection verify against the seeded fixtures passed: default open queue contains the create-missing case; detail uses `Granot evidence — not official Vantage values`; source-scope candidates exclude Bad/Duplicate; Priority-5 plus existing Booking has no case row; Booked and Release actions coexist on one Job timeline.

## Synthetic review fixtures

Seeded only into `testvantagemovers` with job prefix `U23P` and source label `U23 Preview Synthetic Source`.

Reseed or clean:

```text
TEST_MODE=true SHEET_SYNC_MODE=disabled node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/prototypes/granot-lead-lifecycle/seed-unit23-preview-fixtures.ts
TEST_MODE=true SHEET_SYNC_MODE=disabled node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/prototypes/granot-lead-lifecycle/seed-unit23-preview-fixtures.ts --cleanup
```

Current review URLs (Owner login required):

| Scenario | URL |
| --- | --- |
| Default queue | https://vantage-admin-9hzabj3zw-vantage-4d3db9ef.vercel.app/ingestion/granot/lifecycle |
| AC-18/19 create-missing, high candidate, Bad/Duplicate exclusion | https://vantage-admin-9hzabj3zw-vantage-4d3db9ef.vercel.app/ingestion/granot/lifecycle/cases/6a853488bb59311027d565f0 |
| AC-19 review-existing, medium candidate, official Booking + Cancellation | https://vantage-admin-9hzabj3zw-vantage-4d3db9ef.vercel.app/ingestion/granot/lifecycle/cases/6a853489bb59311027d565f8 |
| AC-20 later sequence after a resolved sequence | https://vantage-admin-9hzabj3zw-vantage-4d3db9ef.vercel.app/ingestion/granot/lifecycle/cases/6a853489bb59311027d56605 |
| Ambiguous / no suggestion | https://vantage-admin-9hzabj3zw-vantage-4d3db9ef.vercel.app/ingestion/granot/lifecycle/cases/6a85348abb59311027d5660b |
| AC-39 missing-Lead Employee reconciliation delegation | https://vantage-admin-9hzabj3zw-vantage-4d3db9ef.vercel.app/ingestion/granot/lifecycle/cases/6a85348abb59311027d56617 |
| AC-18 Priority-5 existing Booking, no case | https://vantage-admin-9hzabj3zw-vantage-4d3db9ef.vercel.app/ingestion/granot/lifecycle/jobs/U23PNOCASE1 |
| AC-40 Booked + Release observations, no Release case | https://vantage-admin-9hzabj3zw-vantage-4d3db9ef.vercel.app/ingestion/granot/lifecycle/jobs/U23PBOTH01 |

Candidate browsing remains inside the 24-hour refresh window from each case `opened_at`. Reseed if that window expires.

## Owner review focus

Follow UNIT-23 acceptance. In particular:

- Queue defaults to open Booking/Release kinds, newest evidence first, URL-backed filters/cursors.
- List contact is masked; detail separates observed Granot evidence from official current facts.
- Create-missing has blank official fields; review-existing shows one deterministic Booking and no second Booking/mutation control.
- Evidence refresh must not clear local draft state or change `case_revision`.
- High/medium/ambiguous candidates, Owner all-scope warning, and zero selection/attachment.
- Bad/Duplicate Form Leads never appear as candidates.
- Missing-Lead detail deep-links Employee Booking Lead Reconciliation.
- Booked and Release observations render separately.
- No Confirm/Create/Update/No Action button exists.
- Zero Booking/Lead/Cancellation/link/case-resolution/Command/Change/outbox/notification writes.

This Preview review is not a real-database dry run. Shadow processing still persists evidence when the processor runs. Historical observation/certification belongs to UNIT-31.

## Remaining work

1. Owner signs into the Admin Preview and walks the table above.
2. Record explicit acceptance or findings. Only acceptance unblocks Unit 24.
3. Optionally commit the seed script and this updated handoff (`scripts/prototypes/granot-lead-lifecycle/seed-unit23-preview-fixtures.ts` is currently local).

## Explicit non-actions

- No Production environment values were changed except that they were left untouched.
- No Production deployment was made or promoted.
- No effect flag was enabled.
- No real-database dry run was attempted.
- Owner review is not claimed complete.
- Unit 24 was not started.
