---
type: Service
title: Insights
description: Insights › Analytics (period vs comparison, rankings with rank change, five tabs), Reviews, the Outreach Desk's lead cost per rep, the live Daily Operations lead spend and Today's Money tab. Every lead is priced live from the Operations Registry lead-cost schedule.
tags: [analytics, insights, cpl, owner-dashboard]
status: draft
stale_after: 2027-01-06
resource: src/services/insights/
applies_to:
  - src/services/insights/**
  - src/routes/insights-admin.routes.ts
  - vantage-admin/lib/api/insights.ts
  - vantage-admin/components/insights/**
  - vantage-admin/components/daily/lead-spend-panel.tsx
  - vantage-admin/components/outreach-desk/views/lead-cost-card.tsx
owners: [team:main-server, team:vantage-admin]
sources:
  - id: primary
    resource: src/services/insights/
  - id: design
    resource: ../dashboard-redesign-proposal/09-analytics-redesign.md
    title: Analytics redesign (workspace root)
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
generated:
  by: agent:claude-code
  at: 2026-10-06T23:00:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)
**Design:** workspace `dashboard-redesign-proposal/09-analytics-redesign.md` (Owner request 2026-10-06: live lead cost,
comparisons first, live daily spend, lead cost per rep on the Desk).
**Domain terms used:** [CPL](../../../../CONTEXT.md), [Source Company](../../../../CONTEXT.md), [Source Granularity](../../../../CONTEXT.md), [Agent Allocation](../../../../CONTEXT.md), [Receiver Agent](../../../../CONTEXT.md)

# Insights

Read-only. Replaces the admin's use of the `analytics/*` reports for the Insights › Analytics page; those reports and
their CSV export stay for compatibility ([`analytics.md`](./analytics.md)).

## Lead cost is read live

`pricing.ts`: a lead costs the CPL its feed (Source Granularity) has in the Operations Registry schedule
(`cpl_rate_periods`, non-archived) for the lead's **New York business day**, read on every request. Changing a feed's
lead cost in Setup therefore changes Analytics, Today and the Desk on the next read, without waiting for a CPL correction
job. The stamped `Lead.cpl` is not read here (it still feeds the Sheets and the correction job).

Same rule as `resolveCplFromPeriods`: duplicates cost $0 (`duplicate`), a lead with no feed has no cost (`no_feed`), a
feed with no single period covering the day is `unpriced` (counted, $0, surfaced as a data-quality number, never hidden).
Call Leads with `created_on_unmatched` are not leads (the Daily Operations rule).

The Lead cost sheet in Setup offers "All leads, past and future" (effective date = the schedule's first day), which
re-prices history; a dated change re-prices from that day.

## Time

`period.ts`. A period is a half-open run of New York business dates `[start, end_exclusive)`. Presets: today,
yesterday, this/last week (Monday weeks), this/last month, last 30/90 days (include today), quarter/year to date,
custom (≤ 2 years). Comparison: `previous` (to-date presets compare the same elapsed span of the previous unit; full
spans compare the span immediately before) or `last_year`; `coverage` is `none`/`partial` before the first recorded lead
(2026-04-30). Buckets are days up to 31 days, Monday weeks above.

Stored conventions: a lead's day is its real arrival day through `leadInstant` (wall clock for every ingestion path
except Granot-created leads), exactly as Daily Operations counts it; `book_date`, `cancel_date` and `review_date` are
date-only values matched as `[D 00:00Z, D+1 00:00Z)`. This fixes the old reports' `$lte to` that cut off the last day.

## Facts and bases

`facts.ts` loads lean rows per period (≈2k leads, ≈230 bookings a month; ~1.2 s for two 30- or 90-day periods on
production, measured 2026-10-06) and everything else is in-memory and unit-tested:

- **Activity** (Overview, Team, Bookings): bookings whose book date is in the period ÷ leads that arrived in it.
- **Cohort** (Sources, receivers, the Desk): of the leads that arrived in the period, those booked as of now
  (`Lead.booked` → `booked_leads`). `cohort_maturing` while the period is younger than the median time to book.
- Booking source: `employee_source_snapshot` first, then the lead's feed; referral bookings → `referral`, leadless or
  lead-less bookings → `no_lead`, else `unknown`.
- **Split credit**: each allocation credits its own `binder_amount` and the same share of the deposit
  (`binder share`, or 1/n when the booking binder is 0); the booking counts once per agent. Agent deposits sum to the
  bookings' deposits (the legacy `agent-performance` report credits the full deposit to each agent).

## Comparison rules (`metrics.ts`)

Counts and money carry `delta` and `delta_pct`; rates carry points (`delta`, `delta_pct` null). `tone` follows what is
good for the business (`better`: up / down / none). Below `INSIGHTS_MIN_BASE` (20) on either side `small_base` is set and
`delta_pct` withheld. Rankings carry `rank` and `rank_change` (null + `is_new` when absent before).

## HTTP (`insights-admin.routes.ts`, behind `requireApiSecret`, `{ ok, data }`, `Cache-Control: no-store`)

| Route | Returns | Access |
|---|---|---|
| `GET /api/v1/admin/insights/analytics?period&compare&from&to&sources` | `InsightsAnalyticsReport`: scorecards, current + comparison series, movers (sentences), data quality, sources (companies with feeds, local/LD, pickup states, lanes), team (sales agents, receivers), bookings (merchants, mix, time to book, cancellations), definitions | Owner, Admin |
| `GET /api/v1/admin/insights/reviews?period&compare&from&to` | `InsightsReviewsReport` (published testimonials: averages, star histogram, monthly, newest three, `last_ingested_at`, `stale` after 14 days) | Owner, Admin |
| `GET /api/v1/admin/insights/allocation-cost?period&compare` | `InsightsAllocationReport`: per receiver agent (the Desk's assignment) leads, allocated spend, share, by source company and feed, booked, cost per booked; every active rep and an Unassigned row | Owner (signed actor) |
| `GET /api/v1/admin/daily-operations/lead-spend` | `InsightsLeadSpendDay`: spend today / yesterday / day before (and by this hour), hourly, by company with rate labels | Owner (signed actor) |
| `GET /api/v1/admin/money/spend?range=today\|yesterday\|this_week\|this_month` | Today › Money (SERVER-WORK T1); `rep_cost` null + `compensation_missing` until rep pay is recorded (T3) | Owner (signed actor) |

`sources` is a comma list of Source Company slugs; it narrows leads, bookings and cancellations together.

## Invariants

- Read-only; no models are compiled for writes (raw collection reads through `insightsCollection`).
- One pricing rule for every surface (`priceLead`); do not sum stamped `cpl` in new reads.
- Add a metric in `analyticsReport.ts` with its definition in `INSIGHTS_DEFINITIONS` and mirror the type in the admin.

## Tests

`src/services/insights/insights.test.ts` (period engine, live pricing incl. re-pricing on a cost change, comparison
rules, split credit, rank change, cohort vs activity, sources filter, time to book, movers, allocation, live daily
spend, money, reviews); `src/routes/insights-admin.routes.test.ts` (Owner gates, validation, envelope).
CPL save regression (the "multiple documents unless `ordered: true`" error): `ops/insights/cpl-schedule.replica.ts`
on the local `csi01` replica (`node --import tsx ops/insights/cpl-schedule.replica.ts`).
Browser walk against the real server (2026-10-06): `node --import tsx ops/insights/seed-synthetic.ts
--database=testvantagemovers_insights` (≈150 days of synthetic leads, bookings, cancellations, lead costs, reviews on
the loopback replica), then `ops/local-integration/serve.ts` and the Admin per `ops/local-integration/README.md`.
