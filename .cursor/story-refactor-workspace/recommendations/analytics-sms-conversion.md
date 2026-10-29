# Rate These Successfully Texted Leads By Whether They Booked

- Status: reviewed starter, 2026-10-29
- Target: `src/services/analytics/smsConversion.service.ts`
- Current declared exports: `SmsConversionOriginRow`, `SmsConversionItem`, `smsConversionOriginLabel`, `smsConversionFromOriginRows`, `getSmsSuccessfullySentThenBooked`.
- Evidence: `src/services/analytics/smsConversion.service.ts`, `docs/knowledge/services/analytics.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `docs/knowledge/services/insights.md`

## Recommendation

Keep `getSmsSuccessfullySentThenBooked` as the public seam; consider a shorter story name only if it improves the live callers, and retain an exact compatibility alias. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

These reports remain compatibility endpoints; Insights is the dashboard path. The historical database and combined-database merge are gone. Preserve the current response, filters and calculations; do not restore historical scope.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Target-specific checks:** Preserve these existing behaviors: SMS booked rate uses successfully texted Leads as the denominator; an empty texted-lead cohort is a zero rate, not missing data; production SMS conversion matches successful statuses and official booked refs. See `src/services/analytics/smsConversion.service.test.ts`.

## Source-verified implementation constraints (2026-10-29)

Keep successful-status filtering before joining Leads; date/source/local filters apply to the joined Lead. Deduplicate by Lead id, choosing origin with the existing unsorted `$first`, then group by origin; do not impose earliest/latest message attribution as a cleanup. Official `lead.booked` is the success authority. The helper keeps an all-zero totals row for no cohort. Prove multiple successful messages for one Lead count once, unsuccessful messages do not count, and Lead dates (not message dates) govern inclusion.
