# Show The Admin Dashboard Desk For This Resource

- Status: reviewed starter, 2026-10-29
- Target: `src/services/admin/adminBrowse.service.ts`
- Current declared exports: `AdminBrowseResult`, `browseAdminResource`, `getAdminResourceDetail`, `exportAdminResourceRows`.
- Evidence: `src/services/admin/adminBrowse.service.ts`, `docs/knowledge/services/admin-search.md`, `docs/knowledge/services/lead-browse.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`

## Recommendation

Consider renaming `browseAdminResource` to `showTheAdminDashboardDesk` if the live callers still benefit; keep `browseAdminResource` as an exact alias until callers migrate. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

The historical database, Operational Events and Lead Conversations were retired. Keep only effects and dependencies present in the live module; do not restore retired side effects.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

## Source-verified implementation constraints (2026-10-29)

Keep browse, detail and bounded export as three public operations. Factor shared filter construction only if it preserves the same count/list filter: omitted or false `duplicate` excludes duplicate Leads; true selects duplicates. Source Granularity wins over legacy Source Company, matching exact key/snapshot or catalog id; contact filters search live, ingested and Granot paths. Preserve `no_sync=false` matching missing values, attachment-presence filters, the Form-only past-move-date comparison, resource sort/date allowlists and inclusive `to`. Detail distinguishes invalid-id 400 from missing 404. Form lists enrich only `sms_message_sent`; detail additionally returns the latest message. Export walks browse pages of at most 250, stops on an empty page, and slices to 5,000 by default. Prove these through public browse/detail/export calls; a generic create-success test cannot protect the filters.
