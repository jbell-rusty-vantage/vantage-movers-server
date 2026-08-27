# JTE-05 completion

Closed 2026-08-27 on `job-timeline-enhancement` in `vantage-admin` and
`vantage-main-server` (existing pack branch in both; no extra feature
branches; not pushed).

This issue certified the shipped JTE-04 page and added Owner deep links.
It did not recompute outcome, stages, attention, or limitations. The v1
client fallback stays. `/daily` was not created.

## Deep-link call sites

All use `buildJobTimelineHref({ job })` → `/job-timeline?job=`. No
catalog. No contact search.

| Surface | File | What was added |
| --- | --- | --- |
| Form / Call Lead list + detail | `vantage-admin/components/operational/operational-resource-page.tsx` | Job cell via `JobTimelineDeepLink` when `job_no` is present. Form Leads gained a Job column so a present `job_no` is visible. |
| Booking list + detail | same | existing Job column now links |
| Cancellation list + detail | same | existing Job column now links |
| Intake list | `components/intakes/intake-list.tsx` | `Open Job timeline` next to forensic `Open job history` |
| Booking / Cancellation workbench | `booking-intake-workbench.tsx`, `cancellation-intake-workbench.tsx` | headline Job Number links to the owner page |
| Intake reference drawer | `intake-reference.tsx` | `Open Job timeline` **in addition to** the forensic `JobTimeline` drawer |

Unchanged on purpose: Home `OverviewJobTimelineLink` (`/job-timeline`),
sidebar nav, Granot nav. Employee booking and other non-Owner pages
were not linked.

Browser check on local Owner session: Bookings list had 50+
`/job-timeline?job=` hrefs plus the existing nav `/job-timeline`. No
production timeline read was submitted (Admin API still points at
production; live proof used the test-DB CLI).

## Live proof path

```text
cd vantage-main-server
pnpm prototype:job-number-timeline -- proof --max-jobs 200 --warm-runs 12
```

Redacted report: [`JTE-05-live-proof.md`](JTE-05-live-proof.md).
Gitignored machine JSON:
`scripts/output/job-number-timeline/proof-2026-08-27T21-09-24.021Z.json`.

Target: `testvantagemovers`. No `--confirm-production-db`.

## Count-stability

Loader collections counted before and after the 75-job read. Every
delta is 0 (`collection_count_deltas: {}`). Counts included
`granot_observations` 30, `booked_leads` 22, `cancelled_leads` 25,
`form_leads` 37, `call_leads` 7, `sheet_sync_jobs` 92,
`ringcentral_processed_calls` 0.

## Forbidden-field scan

Named test `serialized v2 page contains no forbidden fields or contact`
now serializes all ten v2 goldens through `assertPageSafe` plus §12
tokens. Live proof scanned all 67 ok pages: `forbidden_scan: pass`.

## Owner vs Admin 403 (re-run)

```text
✔ Admin cannot read the owner Job Number timeline   # server route 403
✔ Job Number timeline proxy read is Owner-only      # Admin canProxyVantagePath
```

## a11y notes

Named tests:

- `v2 page exposes screen-reader names on outcome, attention, and evidence`
- `density radios stay tabbable without roving tabindex`

Live Owner session on `http://localhost:3001/job-timeline`: Job number
searchbox is labeled and focusable; Search control is named
`Search Job Number`. Density, evidence, and proof controls were
certified from the v2 fixture (no production Job was typed).

JTE-04 notes still hold: density is a radiogroup without roving
tabindex (Tab reaches each radio). Brand-logo hydration warning on
`components/brand/brand-logo.tsx` is pre-existing.

Color is not the only status cue: stage chips expose state in
`aria-label` and an `sr-only` suffix; attention and evidence use text
labels.

## Measured latency

Warm p95 on `testvantagemovers`: **471 ms** (55 warm samples; median
351 ms). First proof run was 475 ms. No alert was added.

## Leftover §17 items

Ticked by this issue with evidence:

| # | Criterion | Evidence |
| --- | --- | --- |
| 13 | Existing + named tests pass | Server 1715 / 1628 pass / 87 skip; Admin 325 pass |
| 14 | Production proof is read-only, masked, count-stable | Live proof on test DB; production not authorized |
| 15 | Timeline sends no notification and performs no reconciliation write | CLI/proof stay zero-mutation; no write path added |
| 16 | Daily Assurance can link without importing query logic | URL-only `buildJobTimelineHref({ job })`; `/daily` not created |

Honest leftovers (not this pack):

- Live `granot_born` / `ringcentral_born` pages were absent from
  `testvantagemovers` (0 RingCentral processed-call rows). Goldens still
  render those shapes.
- Live `cancellation_intake` event was absent from 67 ok pages (3
  release-case rows exist). Golden open-intake page still renders.
  JTE-06 snapshot correlation stays deferred.
- JTE-06 / JTE-07 stay leftover pending write / source-assurance
  approval.
- v1 client fallback kept (no evidence every deployed client consumes
  v2).

## Files added

```text
vantage-admin/components/job-number-timeline/job-timeline-deep-link.tsx
vantage-admin/tests/job-timeline-deep-link.test.ts
vantage-main-server/scripts/prototypes/job-number-timeline/src/live-proof.ts
vantage-main-server/scripts/prototypes/job-number-timeline/src/live-proof.test.ts
vantage-main-server/docs/job-number-timeline/reports/JTE-05-live-proof.md
```

## Files extended

```text
vantage-admin/components/operational/operational-resource-page.tsx
vantage-admin/components/intakes/intake-list.tsx
vantage-admin/components/intakes/booking-intake-workbench.tsx
vantage-admin/components/intakes/cancellation-intake-workbench.tsx
vantage-admin/components/intakes/intake-reference.tsx
vantage-admin/components/job-number-timeline/job-timeline-header.tsx
vantage-admin/components/job-number-timeline/stage-strip.tsx
vantage-admin/components/job-number-timeline/attention-panel.tsx
vantage-admin/components/job-number-timeline/evidence-details.tsx
vantage-admin/components/job-number-timeline/proof-boundaries.tsx
vantage-admin/tests/job-number-timeline.test.ts
vantage-admin/tests/intakes-components.test.ts
vantage-main-server/src/services/jobNumberTimeline/v2.test.ts
vantage-main-server/scripts/prototypes/job-number-timeline/src/cli.ts
vantage-main-server/scripts/prototypes/job-number-timeline/src/cli.test.ts
```

## Commands

```text
cd vantage-main-server && pnpm test && pnpm typecheck
# 1715 tests, 1628 pass, 87 skipped, 0 fail
# tsc --noEmit exit 0

cd vantage-admin && pnpm test && pnpm typecheck
# 325 pass, 0 fail
# tsc --noEmit exit 0

pnpm exec eslint components/job-number-timeline \
  lib/api/jobNumberTimeline.ts tests/job-number-timeline.test.ts \
  tests/job-timeline-deep-link.test.ts tests/intakes-components.test.ts \
  components/intakes/intake-list.tsx \
  components/intakes/booking-intake-workbench.tsx \
  components/intakes/cancellation-intake-workbench.tsx \
  components/intakes/intake-reference.tsx
# exit 0

pnpm lint
# repo-wide: 3 pre-existing errors in
# components/operations-registry/granot-crm-sources-manager.tsx
# plus the pre-existing operational-resource-page hook warning
```

## What this issue did not do

- JTE-06 / JTE-07 writes.
- Remove v1 client fallback.
- Create `/daily` or Daily Assurance.
- Production live read.
- Turn 750 ms into an alert.
- Fix untouched Admin lint in `granot-crm-sources-manager.tsx`.

Residuals not reverted: JTE-01 CLI `filtered_out` exit 0; JTE-02
`assembled_at` / qualified RingCentral receipts / no Mongo snapshot hop
(JTE-06).

No commit. Not pushed.
