# JTE-04 — Enhanced Owner UI

> **Contract maturity: implementation-ready.** Session 3. Render the v2
> page the server already evaluates. Do not recompute outcome, attention,
> or limitations in the browser.

## 1. Authority and required reading

- **Enhancement specification:** §9 in full, §6 (what the client may read),
  §13.2 test 18.
- **Admin orientation:** `vantage-admin/uxdocs/HANDOFF-job-timeline-enhancement.md`
- **JTE-03 golden pages** in `vantage-main-server/src/services/jobNumberTimeline/`
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)
- **Admin map:** `vantage-admin/.cursor/rules/project-organization.mdc`,
  `vantage-admin/.cursor/rules/job-number-timeline.mdc`

## 2. Objective

Replace the current coverage-chip Job timeline with the enhanced page
hierarchy so an Owner can scan the story and open proof without visiting
the forensic Granot lifecycle screen.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-admin` only, except a shared type export if
  JTE-03 already published one you can import. Prefer copying the
  **already tested** DTO types into `lib/api/jobNumberTimeline.ts`
  additively — Admin types are never the semantic authority.
- **Branch:** `job-timeline-enhancement` in `vantage-admin`.
- **Prerequisite:** JTE-03 `complete` with golden pages.
- Route, Owner gates, proxy path, and `queryKeys.jobNumberTimeline` already
  exist. Do not recreate them.

## 4. Current-state evidence to verify

Observed 2026-08-27; reverify after JTE-03.

- Page: `app/(dashboard)/job-timeline/page.tsx` → `JobTimelineDashboard`.
- Search state is the URL: `?job=` plus optional source filters.
  `buildJobTimelineHref` already exists. Keep it as the shareable state.
- Header: `job-timeline-header.tsx` + `coverage-chips.tsx` (present/absent
  labels including “Booking absent” / “Cancellation absent”).
- Cards: `owner-timeline.tsx` over `timeline.tsx`. Headlines locked.
  `ALLOWED_DETAIL_KEYS` is a client-side allow-list of safe `data` keys.
- Types in `lib/api/jobNumberTimeline.ts` are a v1 duplicate. Tests:
  `tests/job-number-timeline.test.ts`, `lib/api/jobNumberTimeline.test.ts`.
- Forensic `components/granot-lifecycle/job-timeline.tsx` is a different
  page. Do not mount it here.
- Florida time: `lib/floridaTime.ts` / `formatDateTime`. Display occurred
  time in Florida time.

## 5. Locked decisions and invariants at risk

- **Server is the only evaluator.** Render `current_outcome`,
  `stage_assessments`, `attention`, and `limitations` as given.
- **Filtering hides presentation rows only.** It does not change summary,
  stages, outcome, or attention.
- **Activity grouping is presentation only.** Expanding a group reveals
  each original event and clock. Official Booking and official Cancellation
  stay independently visible.
- **No raw JSON.** No contact. A forensic deep link may open the existing
  Granot lifecycle page for permitted users; it is not the default card.
- **v1 fixtures remain renderable** during migration (named test 18).
- **No catalog.** Typed search only. URL remains shareable page state.
- **Locked headlines stay locked.**

## 6. Deliverables and exact contract

### 6.1 Page hierarchy (top to bottom)

1. Typed Job Number search (existing `JobNumberSearch`).
2. Job identity and current outcome (plain language).
3. “What we know” stage strip — replace `CoverageChips`.
4. Attention panel, **only when** `attention.length > 0`.
5. Oldest-first lifecycle story, optionally grouped by `activity_id`.
6. Collapsed “Proof boundaries” panel from `limitations`.

### 6.2 Header

Show Job Number, current outcome, origin label and source granularity,
latest activity time, assembled/freshness time, attention count.

Recommended stage labels (specification §9.2): Lead recorded; Text
delivered / Text skipped / No text recorded; Booking intake open /
Booked / Not yet booked; Cancellation intake open / Cancelled / No
cancellation activity; Sheet caught up / Sheet pending / Sheet failed /
Google not verified.

### 6.3 Cards

Default: stage marker + distinct icon, locked headline, one summary
sentence, occurred time in Florida time, status + evidence-strength badge.

Expanded “View evidence”: both clocks with field names, source and
command, safe changed-field groups, correlation explanation, related
steps in the same `activity_id`, safe evidence refs. Keyboard accessible.

### 6.4 Density filters

Default **Lifecycle story**. Also: All evidence, Attention only, Customer
lifecycle, System processing. Specification §9.4 defines membership.
URL may record the filter (`?view=`) so a share stays honest; if you add
it, keep `job` as the retrieval key.

### 6.5 Files

Prefer extending the existing folder over a rewrite:

```text
components/job-number-timeline/
  job-timeline-dashboard.tsx     # compose the hierarchy
  job-timeline-header.tsx        # outcome + stage strip
  stage-strip.tsx                # new; retire coverage-chips from the page
  attention-panel.tsx            # new
  proof-boundaries.tsx           # new
  owner-timeline.tsx             # grouping + expand
  evidence-details.tsx           # new expanded panel
  density-filter.tsx             # new
  kind-visual.ts                 # add source_received
lib/api/jobNumberTimeline.ts     # additive v2 types
```

`coverage-chips.tsx` may remain only as the v1-fixture fallback.

## 7. Explicitly out of scope

- Deep links from other Owner surfaces — JTE-05.
- Live production proof — JTE-05.
- Recomputing codes from events.
- Job catalog or contact search.
- Daily View / Assurance chrome.
- Editing or retrying anything.

## 8. Flags and runtime posture

No new Admin feature flag unless JTE-05 later needs one. Owner-only
gates already include `/job-timeline` and the proxy path.

## 9. Migration and indexes

None.

## 10. Acceptance criteria

- [x] Coverage chips are gone from the default v2 render. Stage strip
      uses server `stage_assessments`.
      Evidence: `v2 default render uses stage assessments and hides coverage chips`.
- [x] Attention panel is absent when `attention` is empty.
      Evidence: `attention panel is absent when attention is empty`.
- [x] Proof boundaries are collapsed by default and quote Google-not-
      verified / WordPress-receipt / RingCentral-cursor language from the
      server, not invented client copy for those codes.
      Evidence: `proof boundaries stay collapsed and quote server limitation labels`
      (Google + WordPress labels from JTE-03). RingCentral uses the same
      `limitation.label` render path.
- [x] Density filters hide rows only; header counts stay stable.
      Evidence: `density filters hide rows only and keep header counts stable`.
- [x] Activity groups retain every event when expanded.
      Evidence: `activity groups retain every event when expanded`.
- [x] Official Booking and official Cancellation remain independently
      visible.
      Evidence: `official Booking and official Cancellation remain independently visible`.
- [x] Named test: `v1 fixture remains renderable during client migration`.
- [x] Existing not-found / invalid / filtered-out copy still holds.
      Evidence: existing tests plus `invalid_job_number and filtered_out copy still hold`.
- [x] No forbidden fields rendered. No raw JSON.
      Evidence: `v2 render never dumps raw JSON or contact`.
- [x] Keyboard: search, expand evidence, and filter are reachable without
      a pointer.
      Evidence: native search form, `<details>/<summary>`, density `role="radio"`.
- [x] `pnpm test && pnpm typecheck && pnpm lint` in `vantage-admin`.
      Evidence: 321 tests pass; `tsc --noEmit` exit 0; JTE-04 files eslint
      exit 0. Repo-wide `pnpm lint` still has 3 pre-existing errors in
      `granot-crm-sources-manager.tsx` (untouched).

## 11. Required tests and commands

```bash
cd vantage-admin && pnpm test && pnpm typecheck && pnpm lint
```

Focused: `tests/job-number-timeline.test.ts`,
`lib/api/jobNumberTimeline.test.ts`, plus new tests for stage strip,
attention visibility, density-filter stability, and v1 fixture render.

## 12. Live/staging verification

Use JTE-03 goldens and existing Owner session against a **test** API if
one is already running. Do not hit production customer Jobs in this
issue. Visual check of `/job-timeline?job=` on a golden-shaped fixture
is enough; JTE-05 owns the live proof.

If browser tools are available, exercise search → result → expand
evidence → each density filter → empty attention. That is the session
exit, not a screenshot of first paint.

## 13. Rollback

Restore header + `CoverageChips` + current `OwnerTimeline`. v2 fields on
the wire can remain; the v1 render ignores them.

## 14. Required completion handoff

Report: files added; which v1 paths remain as fallback; filter URL
decision; a11y notes for JTE-05; screenshots only if redacted.

**Unblocks:** JTE-05.
