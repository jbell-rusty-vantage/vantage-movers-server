# Show The Successful Registry Change Cards — Flatten Secrets On The Way Out Again — Never Stamp A Card — Never Count The Shelf — Never Write A Finding — Never Decide Who May Speak — operational story

- Status: recommended; refreshed 2026-10-29.
- Target: `src/services/operationsRegistry/queries/changes.ts`
- Domain evidence: `docs/knowledge/services/operations-registry.md`
- Current exported operations/constants: `listRegistryChanges`.
- Current exported types: types declared by the target.
- Direct import sites found: `src/services/operationsRegistry/index.ts`.
- Related tests: Locate existing callers and targeted tests before changing this module.

## Current boundary and parity

The Registry is the live source, route and cost catalog. Preserve effective-dated assignments and the existing Registry mutation, authorization and audit boundaries. Lead creation resolves the period covering its business timestamp; duplicates cost zero. Correction jobs and stamps remain separate from live Insights pricing and Sheet Sync.

The target and its direct callers are the authority for the exact implementation. Preserve the public signatures, persisted identifiers, transaction and side-effect ordering, error shapes, and idempotency while migrating callers. Keep any existing public name as an alias until its callers move. Do not introduce an additional service class or move policy into a route.

## Remaining cleanup

Read the exported operations above in their actual order and rename only an operation whose name obscures its current outcome or scope. Keep separate operations separate where their callers own different decisions; extract a private helper only when it gives a real decision a clearer name. Migrate the direct callers together, then cover the existing success, refusal, retry and side-effect boundaries relevant to this module with targeted tests. This is a behavior-preserving naming and module-shape pass, not authorization to add effects or change business policy.

## Specific implementation checks from the original brief

2. **Flatten secrets on the way out again** — leftover `toListItem` maps `_id` → `id` string, copies entity / action / actor / `request_id`, sets `reason` to `doc.reason ?? null`, ISO-stamps `created_at`, and **asks** skipped `sanitizeRegistrySnapshot` for `before` / `after` and skipped `sanitizeRegistryMetadata` for `metadata`. Already-recommended stamp already **asked** the same flatten before persist. This beat runs again so a leftover pre-flatten card, or a raw insert that skipped the stamp, still redacts secret-like keys and bounds depth before Wave B returns `{ ok, data }`. This beat does **not** invent a second redact **adapter**. This beat does **not** echo a token that skipped flatten already replaced with `[redacted]`.

There is no stamp operation. There is no count-the-shelf operation. There is no finding operation. There is no who-may-speak operation. Leftover `buildFilter` / leftover `toListItem` are keep-or-drop / flatten-or-skip beats, not public **seams**.

Do not export `buildFilter` as a public **seam**. Do not export `toListItem` as a public **seam**. Do not export a standalone `countRegistryChanges` leftover overview could call without the page. Do not export leftover `getRegistryOverview` from this file.

2. **`page` is not clamped. `limit` is.** `query.page ?? 1` keeps `0` (and any negative) because `??` only replaces nullish. Wave B Zod `min(1)` saves HTTP. A barrel caller passing `page: 0` computes `skip = -limit`. Do not silently clamp `page` to ≥ 1 so “the service matches Zod” without a paired barrel / TEST_MODE skip test. Do not silently remove the leftover `limit` clamp so “Zod owns paging” — the barrel can call this file without Zod.

4. **The filter is exact match only.** Leftover health finds leftover migration evidence with `actor_id: { $regex: /^operations-registry-m\d+$/ }`. This file matches leftover `actor_id` as a string. The owner cannot ask “every leftover `operations-registry-m*` card” without knowing the exact id. Do not silently add a regex / leftover `actor_type=system` filter so “the list can find leftover migration cards.” Do not silently pin the latest leftover migration card to page 1 so “health and list agree.”

5. **The filter omits leftover `actor_type` and leftover `actor_role`.** Those fields are on every card and on leftover `toListItem`. Do not silently add them so “the owner can hide leftover `system`” without a paired Wave B Zod + leftover dashboard test. Do not silently drop them from the DTO so “the list only shows who / what / when.”

6. **Flatten runs twice — on stamp and on read.** Already-recommended stamp already **asks** skipped flatten before persist. Do not silently drop leftover `toListItem`’s flatten so “write already redacted.” A leftover card stamped before flatten, or a raw `OperationsRegistryChange.create` that skipped the stamp, would leak. Do not silently move skipped flatten into this file so “the list owns redact.”

8. **`total` is the filtered match count, not leftover overview `registry_changes_total`.** Overview is all-time, unfiltered. This page’s `total` shrinks with the filter. Do not silently copy leftover overview’s all-time count onto this bag so “the numbers match.” Do not silently count leftover Events into `total` so “failures are history.”

10. **Sort is `created_at` desc, then `_id` desc.** Leftover `request_id` is unique; leftover `created_at` can collide. Do not silently drop the `_id` tie-break so “time is enough.”
