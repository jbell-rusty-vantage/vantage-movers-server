# Read and Update the Agent and Merchant Catalog

- Target: `src/services/catalog/catalog.service.ts`
- Evidence: `src/services/catalog/catalog.service.ts`, `docs/knowledge/services/catalog.md`

Keep the existing public facade names unless callers demonstrate a useful story rename. Registry owns signed Owner mutation transactions, uniqueness, aliases, audit and invalidation; this facade must not duplicate those rules or create a second CRUD implementation. Preserve list/get, create/update, Agent resolution and Merchant display-name resolution as distinct operations.

Agent list/get now call `withDeskMembership` and make one bounded membership read for the whole list. Their DTO includes `id` and `_id`, name/normalized name, activation and created_from, with conditional username, nonempty aliases, archive metadata and outreach_desk. Agent reads attach desk_membership only when the membership map contains that Agent. Username prefers flat value then nested identity. The DTO does omit nested identity, but **does not omit aliases**. Merchant reads only flatten Registry data and do not read desk membership. Create/update return the flattened mutation result without the read-side membership enrichment; do not add that network/database work to them as a cleanup.

Create forwards Agent name/role/Granot username/outreach_desk/active/created_from to Registry; Merchant forwards its supported fields only. Update forwards id, supported changes and reason; keep omission versus null username semantics. Activation and dependency preview remain route/Registry operations and must not be pulled into this facade. Name lookup and normalization live in Registry; Agent lookup returns full RegistryCatalogItem and supports includeInactive, Merchant lookup returns canonical display string and remains active-only. Unknown/inactive misses keep their current 400 copy. Standard Booking allocation never auto-creates an Agent.

Prove Agent list/get include membership and aliases, Merchant never invokes membership, includeInactive forwarding, create/update forwarding of outreach_desk and null username, and Agent-object versus Merchant-string return types. Existing name-resolution tests do not qualify these newer DTO paths. Preserve signed Owner audit failure propagation rather than swallowing it here. Keep exact export aliases if any caller migration is chosen; do not split this facade into per-verb files.


## Source-verified implementation constraints (2026-10-29)

The old brief described a narrower DTO than current code and omitted Agent desk membership reads. Keep this facade over Registry, preserve actual DTO fields and prove read/write distinctions.
