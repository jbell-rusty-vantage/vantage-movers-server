# Assemble the Admin Filter Catalog

- Target: `src/services/admin/filterCatalog.ts`
- Evidence: `src/services/admin/adminFacets.service.ts`, `docs/knowledge/services/admin-search.md`

`loadProductionCatalog` assembles companies, granularities, agents and merchants including inactive entries; `findCatalogGranularity` matches normalized key, owner label or CRM label. Keep those exports and clarify private mapping names where needed. Historical distinct overlays and combined-database merges no longer exist; do not restore them.

Prove normalized lookup, sorted output, inactive entries and `safeList` failure behavior through these exports and the facets caller.

**Specific parity:** List Registry companies and granularities plus catalog agents and merchants with inactive rows included; preserve independent safe-list failures and normalized key, owner-label and CRM-label lookup.
