# Export Admin Resources as CSV

- Target: `src/services/admin/adminExport.service.ts`
- Evidence: `src/services/admin/adminBrowse.service.ts`, `docs/knowledge/services/admin-search.md`

`exportAdminResourceCsv` asks the browse service for rows and emits a resource-named CSV. Keep this public seam; improve private flattening names only where helpful. Preserve each current resource's fixed column order, booked/cancelled ID flattening, agent-name join and customer-name fallback. Analytics export remains a separate compatibility endpoint.

Check empty rows still produce the expected header, populated references flatten correctly, and the query reaches the browse export unchanged. Do not reinstate historical scope or retired observability exports.
