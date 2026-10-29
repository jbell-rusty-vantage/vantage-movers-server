# Jump Across The Admin Dashboard By Typed Text

- Status: reviewed starter, 2026-10-29
- Target: `src/services/admin/adminSearch.service.ts`
- Current declared exports: `AdminSearchItem`, `AdminSearchGroup`, `globalAdminSearch`.
- Evidence: `src/services/admin/adminSearch.service.ts`, `docs/knowledge/services/admin-search.md`, `docs/knowledge/services/form-lead-search.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`

## Recommendation

Consider renaming `globalAdminSearch` to `jumpAcrossTheAdminDashboardByTypedText` if the live callers still benefit; keep `globalAdminSearch` as an exact alias until callers migrate. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

The historical database, Operational Events and Lead Conversations were retired. Keep only effects and dependencies present in the live module; do not restore retired side effects.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

## Source-verified implementation constraints (2026-10-29)

Keep `globalAdminSearch` unless a caller-driven rename earns its cost; the proposed sentence does not add a new seam. Four production resources search in parallel. Escape regex input, add an exact ObjectId clause without removing regex alternatives, retain newest-first per-resource limits, omit empty groups and preserve group order. Search includes any-known-contact paths but labels still use operational live fields; it includes duplicate Leads and has no browse facet/date filters. Prove a Granot-snapshot-only match still labels the submitted/Called contact, exact-id and literal-regex queries, and empty-group omission.
