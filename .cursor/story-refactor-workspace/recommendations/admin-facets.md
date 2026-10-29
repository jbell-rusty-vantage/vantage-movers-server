# Present Admin Filter Facets

- Target: `src/services/admin/adminFacets.service.ts`
- Evidence: `src/services/admin/filterCatalog.ts`, `docs/knowledge/services/admin-search.md`

`getAdminFacets` loads the production catalog, builds compatibility arrays and caches the result for five minutes; Registry invalidations containing `facets` clear the cache. Consider naming the private `withCompatibility` projection for the legacy arrays; preserve `getAdminFacets` and `resetAdminFacetsCacheForTests` for callers. No historical or combined database catalog remains.

Verify catalog projection, blank CRM label filtering, cache reuse and Registry invalidation through the public interface.

**Target-specific checks:** Preserve these existing behaviors: getAdminFacets builds a structured catalog from first-class collections; registry facets invalidation evicts the catalog cache. See `src/services/admin/adminFacets.service.test.ts`.
