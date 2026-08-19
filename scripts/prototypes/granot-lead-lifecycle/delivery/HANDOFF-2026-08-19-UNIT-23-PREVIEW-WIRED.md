# Unit 23 Preview — test-database wiring restored

Date: 2026-08-19

Owner review of this Preview was accepted on 2026-08-19. Unit 23 is complete and Unit 24 is ready after repository re-verification. Production merge, production index apply, and any effect-flag enablement remain separately authorized later gates.

Authoritative contracts: `delivery/issues/UNIT-23.md`, `delivery/issues/UNIT-24.md`, `delivery/UNIT-STATUS.md`.
Prior incident: `delivery/HANDOFF-2026-08-19-UNIT-23-PREVIEW-BLANK-DETAIL.md`.

## What was wrong

CLI Previews (`source: cli`, `target: null`) do not inherit `Preview (granot-lead-lifecycle)` env. They inherit the shared Preview+Production values:

- Admin `VANTAGE_API_BASE_URL` → production API (`https://vantage-movers-main-server.vercel.app`)
- Server `TEST_MODE` → empty string → Mongo `vantagemovers`

Production does not have Unit 23 routes (`404 Cannot GET /api/v1/admin/granot-lifecycle/cases/:id`). The intended server Preview does, but it is behind Vercel Authentication, so Admin’s server-side proxy was blocked unless it sent the **server** project’s Protection Bypass for Automation header.

The later Admin crash-guards then painted default empty objects whenever a fetch “succeeded” without a case projection. That is the blank `# ·` detail.

`testvantagemovers` still has the `U23P` fixtures. The ambiguous case `6a85348abb59311027d5660b` / `U23PAMBIG1` was never blank in Mongo.

## What was fixed (Preview only)

1. Redeployed the server CLI Preview with explicit runtime env: `TEST_MODE=true`, `SHEET_SYNC_MODE=disabled`, processing/shadow true, every Lead/Booking/Release/Referral/email effect flag false.
2. Admin proxy now sends Preview-only `VANTAGE_API_PROTECTION_BYPASS` as `x-vercel-protection-bypass` (the server project’s existing automation bypass — not Admin’s own `VERCEL_AUTOMATION_BYPASS_SECRET`).
3. `asGranotLifecycleCaseDetail` fails closed with `GRANOT_CASE_PROJECTION_MISSING` when `case_id` is absent after unwrap. Crash-guards stay for nested fields.
4. Redeployed Admin CLI Preview with explicit `VANTAGE_API_BASE_URL` = the new TEST_MODE server and the bypass secret.

Production env, Production deploys, and effect flags were not changed.

## Proven on the new server Preview

Signed Owner GET + bypass of `GET /api/v1/admin/granot-lifecycle/cases/6a85348abb59311027d5660b`:

```text
200 { ok: true }
case_id=6a85348abb59311027d5660b
job_no=U23PAMBIG1
kind=booking
mode=create_missing_booking
evidence.length=1
observed_context.contact.name=Synthetic Ambiguous
estimate=1200
```

That is the `testvantagemovers` row. Production still 404s this path.

## Use these Previews (do not mix with older URLs)

### Server

- URL: `https://vantage-movers-main-server-7k8f494r1-vantage-4d3db9ef.vercel.app`
- Deployment: `dpl_5iySwhe9FSS7c5MWZtC2QwRGNK5C`
- Inspector: `https://vercel.com/vantage-4d3db9ef/vantage-movers-main-server/5iySwhe9FSS7c5MWZtC2QwRGNK5C`
- Commit: `f6c8adf`
- CLI `--env`: `TEST_MODE=true` → Mongo `testvantagemovers`

Do not use `dpl_GBwe3bMhzjnTC5UZPU18TxLAqXdN` for this review. That CLI deploy did not lock `TEST_MODE=true`.

### Admin

- URL: `https://vantage-admin-d99mllh7i-vantage-4d3db9ef.vercel.app`
- Deployment: `dpl_E1pv6Mp5SqwPp4nQoKELtWSQ7etQ`
- Inspector: `https://vercel.com/vantage-4d3db9ef/vantage-admin/E1pv6Mp5SqwPp4nQoKELtWSQ7etQ`
- Queue: `https://vantage-admin-d99mllh7i-vantage-4d3db9ef.vercel.app/ingestion/granot/lifecycle`

Do not use `dpl_8qDKmf71oLosAB4W9mj9S27pwURG` / `8wmr9gxn8`. That Preview talked to production and painted empty defaults.

## Owner review URLs

| Scenario | URL |
| --- | --- |
| Default queue | https://vantage-admin-d99mllh7i-vantage-4d3db9ef.vercel.app/ingestion/granot/lifecycle |
| Create-missing / high / Bad+Duplicate exclusion | https://vantage-admin-d99mllh7i-vantage-4d3db9ef.vercel.app/ingestion/granot/lifecycle/cases/6a853488bb59311027d565f0 |
| Review-existing / medium / official Booking+Cancellation | https://vantage-admin-d99mllh7i-vantage-4d3db9ef.vercel.app/ingestion/granot/lifecycle/cases/6a853489bb59311027d565f8 |
| Later open sequence (seq 2) | https://vantage-admin-d99mllh7i-vantage-4d3db9ef.vercel.app/ingestion/granot/lifecycle/cases/6a853489bb59311027d56605 |
| Ambiguous / no suggestion | https://vantage-admin-d99mllh7i-vantage-4d3db9ef.vercel.app/ingestion/granot/lifecycle/cases/6a85348abb59311027d5660b |
| Missing-Lead Employee link | https://vantage-admin-d99mllh7i-vantage-4d3db9ef.vercel.app/ingestion/granot/lifecycle/cases/6a85348abb59311027d56617 |
| Priority-5 + existing Booking, no case | https://vantage-admin-d99mllh7i-vantage-4d3db9ef.vercel.app/ingestion/granot/lifecycle/jobs/U23PNOCASE1 |
| Booked + Release observations | https://vantage-admin-d99mllh7i-vantage-4d3db9ef.vercel.app/ingestion/granot/lifecycle/jobs/U23PBOTH01 |

Candidate browsing remains valid for 24 hours from each case `opened_at` (seeded 2026-08-19 ~00:13–03:58 UTC). Reseed if that window expires; IDs change on reseed.

## Later CLI deploys

Git-triggered deploys stay disabled. Every later `vercel deploy` must pass:

```text
# server
--env TEST_MODE=true --env SHEET_SYNC_MODE=disabled
# plus the false effect flags listed in HANDOFF-2026-08-19-UNIT-23-PREVIEW.md

# admin
--env VANTAGE_API_BASE_URL=<that server Preview URL>
--env VANTAGE_API_PROTECTION_BYPASS=<server project automation bypass>
```

Do not put the bypass on Production Admin. Do not point Production Admin at the test server.

## Remaining work

1. Owner review of this Preview was accepted on 2026-08-19. Unit 24 is officially ready.
2. Production merge must keep TEST_MODE, Mongo target, protection-bypass, API host, and every effect flag exact. Do not copy Preview-only wiring into production.
3. Admin wiring changes are local until someone asks to commit (`lib/env/server.ts`, proxy client/response, `asGranotLifecycleCaseDetail` fail-closed, tests).
