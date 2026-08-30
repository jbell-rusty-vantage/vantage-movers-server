# JTE-04 completion

Closed 2026-08-27 on `job-timeline-enhancement` in `vantage-admin`
(created from clean `main`; not pushed). `vantage-main-server` stayed on
its existing `job-timeline-enhancement` branch for the ledger and
read-only goldens/types. No extra feature branches.

The Owner page now renders the server-evaluated v2 page. The browser does
not recompute `current_outcome`, `stage_assessments`, `attention`, or
`limitations`.

## Files added

```text
vantage-admin/components/job-number-timeline/stage-strip.tsx
vantage-admin/components/job-number-timeline/attention-panel.tsx
vantage-admin/components/job-number-timeline/proof-boundaries.tsx
vantage-admin/components/job-number-timeline/density-filter.tsx
vantage-admin/components/job-number-timeline/evidence-details.tsx
vantage-admin/components/job-number-timeline/v2.ts
vantage-admin/tests/job-timeline-fixtures.ts
```

## Files extended

```text
vantage-admin/lib/api/jobNumberTimeline.ts          # additive v2 DTO types
vantage-admin/lib/api/jobNumberTimeline.test.ts
vantage-admin/components/job-number-timeline/job-timeline-dashboard.tsx
vantage-admin/components/job-number-timeline/job-timeline-header.tsx
vantage-admin/components/job-number-timeline/owner-timeline.tsx
vantage-admin/components/job-number-timeline/kind-visual.ts  # source_received
vantage-admin/tests/job-number-timeline.test.ts
```

Unchanged on purpose: `app/(dashboard)/job-timeline/page.tsx`,
`job-number-search.tsx`, `queryKeys.jobNumberTimeline`,
`buildJobTimelineHref` (additive `view` only), Owner gates,
`canProxyVantagePath`, forensic `components/granot-lifecycle/job-timeline.tsx`.

## v1 fallback paths

Pages without `schema_version: "job_timeline.v2"` keep:

- `CoverageChips` in the header
- the existing flat `timeline.tsx` (nyxbui 1074) cards
- locked headlines and `ALLOWED_DETAIL_KEYS`

`coverage-chips.tsx` remains on disk as that fallback only. It is not
mounted on a v2 page.

## Filter URL decision

Density is recorded as `?view=` when it is not the default
(`lifecycle`). `job` remains the retrieval key. `view` is **not** part of
`queryKeys.jobNumberTimeline` — changing density does not refetch and
does not change header counts, outcome, or attention.

Membership:

| `view` | Rows shown |
| --- | --- |
| `lifecycle` (default) | all events, activity-clustered |
| `all` | all events, one card per event |
| `attention` | events in `attention[].event_ids` or stages with `state === "attention"` |
| `customer` | Lead / text / Job Number / intake / official facts |
| `system` | receipt, update, observation, decision, Sheet Sync |

Official Booking and official Cancellation never enter a cluster.

## 21st.dev story

Catalog search found no Owner lifecycle story. nyxbui Timeline 1074 and
other marketing timelines were rejected. Generated clustered spine:

- https://21st.dev/ai/6e776855-13dc-4091-bdd5-dc4562e66466 (Take 1)
- prior: https://21st.dev/ai/dba79914-d479-4a56-9612-f47dea6cfda5

Adapted into `owner-timeline.tsx` + `evidence-details.tsx`. No second
page. `timeline.tsx` stays for v1 fixtures only.

21st driver: [21st.dev lifecycle story](fbc0e415-a57c-4d6b-80e1-8510d978449b).

## §4 reverify (after JTE-03)

Still true: `/job-timeline` → `JobTimelineDashboard`; URL `?job=` plus
optional source filters; `buildJobTimelineHref`; Owner page and proxy
gates; Florida time via `formatDateTime` (`America/New_York`); forensic
timeline is a different page. Types were still the v1 duplicate until
this issue copied the tested server DTO additively. No issue-text
correction required.

## Named-test output

```text
cd vantage-admin && pnpm test
# 321 pass, 0 fail

✔ v1 fixture remains renderable during client migration
✔ v2 default render uses stage assessments and hides coverage chips
✔ attention panel is absent when attention is empty
✔ proof boundaries stay collapsed and quote server limitation labels
✔ density filters hide rows only and keep header counts stable
✔ activity groups retain every event when expanded
✔ official Booking and official Cancellation remain independently visible
✔ invalid_job_number and filtered_out copy still hold

pnpm typecheck
# tsc --noEmit exit 0

pnpm exec eslint components/job-number-timeline lib/api/jobNumberTimeline.ts \
  lib/api/jobNumberTimeline.test.ts tests/job-number-timeline.test.ts \
  tests/job-timeline-fixtures.ts
# exit 0

pnpm lint
# repo-wide: 3 pre-existing errors in
# components/operations-registry/granot-crm-sources-manager.tsx
# (untouched by this issue) plus one pre-existing hook warning
```

Proof-boundary fixture quotes the server labels:

- `Sheet Sync completion is not current Google destination equality.`
- `Lead creation is recorded; independent WordPress submission receipt is unavailable.`

Never “Sheet verified”.

## Browser session

Opened `http://localhost:3001/login` on the JTE-04 dev server. Owner
sign-in failed: Admin Mongo SRV `ECONNREFUSED`. Seed script hit the same
error. `VANTAGE_API_BASE_URL` in Admin `.env` points at production; this
issue did not search a live customer Job.

Session-exit states were exercised in SSR against a golden-shaped v2
fixture (search empty / not_found / ok → outcome → `View evidence` →
every density → empty attention hidden). That is not live proof.

**Live proof and deep links are JTE-05.**

## a11y notes for JTE-05

- Search, density radios, and `View evidence` (`<details>/<summary>`)
  are keyboard-reachable. Focus ring is `focus-visible:ring-gold`.
- Density uses `role="radiogroup"` / `role="radio"` but not arrow-key
  roving tabindex. JTE-05 should certify that.
- Proof boundaries start collapsed (`<details>` without `open`).
- Hydration warning on `components/brand/brand-logo.tsx` is pre-existing
  and outside this folder.
- Contrast, skip links, and live-page axe are JTE-05.

## What this issue did not do

- Deep links from Lead / Booking / Cancellation / intakes — JTE-05.
- Live production proof, count-stability on a real read, or security
  review of a live payload — JTE-05.
- Recomputing codes from events.
- Job catalog or contact search.
- Daily View / Assurance chrome.
- Editing or retrying anything.
- Server runtime changes.

JTE-01 residual stands: CLI company/granularity mismatch prints
`filtered_out` (exit 0). Not reverted.

JTE-02 residuals stand: module stamps `assembled_at` with
`input.now ?? new Date()`; RingCentral `source_received` is qualified
ledger statuses only; Mongo does not query orphan Cancellations by
snapshot (no field, no index — JTE-06).

No commit. Not pushed.
