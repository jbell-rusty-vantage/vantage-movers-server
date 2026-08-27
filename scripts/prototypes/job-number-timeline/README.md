# Job Number timeline

Typed Job Number search that assembles the owner-facing chain —
including events that happened **before** the Lead had a Job Number —
plus the Sheet Sync jobs those writes requested.

The product is **retrieval + how the timeline looks**. There is no
catalog of every Job Number.

## Scripts

```text
pnpm prototype:job-number-timeline -- render --job-no <raw>
pnpm prototype:job-number-timeline -- discover
pnpm test:prototype:job-number-timeline
```

Optional filters: `--source-granularity-id`, `--source-company-id`.
Discover also accepts `--limit` and `--min-score`.

Default live target is `testvantagemovers`. Production reads require
`--confirm-production-db=vantagemovers`. Zero writes.

**Specification:** [`specs/job-number-timeline-prototype-specification.md`](./specs/job-number-timeline-prototype-specification.md)

## Admin tab

Owner-only `/job-timeline` in `vantage-admin` (`isNew` + `NewFeatureBadge`).
Components live under `vantage-admin/components/job-number-timeline/`.
The tab consumes `JobTimelinePage` from
`GET /api/v1/admin/job-number-timeline?job_no=`. It does not mount the
forensic `JobTimeline`.

## 21st.dev

- Write generation (code, 3 directions): https://21st.dev/ai/b92494f4-46ff-425c-b97a-d042290ce762
- Registry installed into the tab: Timeline demo 1074 (nyxbui) as `components/job-number-timeline/timeline.tsx`, plus Chrono Board 9216 card chrome and Origin UI search 159. The Admin tab does not mount forensic `JobTimeline`.
